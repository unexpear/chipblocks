/**
 * FPGA fabric — Stage 1, increment 1: the LUT atom + its evaluation (fpga-fabric.ts).
 * Proves the load-bearing foundation: a k-LUT is exactly its truth table (a config lookup, LSB-first),
 * and — crucially — it evaluates through the REAL logic engine (`stepLogic`) with NO change to that
 * engine, because it rides the same `fn: (boolean[]) => boolean[]` gate contract the 0/1 engine already
 * uses. Everything the mini-VPR builds later (mapper, packer, router, sim binding) stands on this.
 */
import { describe, expect, test } from 'vitest'
import type { BlockData, CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import {
  FULL_ADDER_BLOCK,
  HALF_ADDER_BLOCK,
  RIPPLE_CARRY_2BIT,
} from '../src/renderer/builtin-blocks.ts'
import {
  coverToLuts,
  type KLut,
  lutConfigSize,
  lutFn,
  lutIndex,
  lutifyCompiled,
  mapCompiledToLuts,
  synthLutConfig,
} from '../src/renderer/fpga-fabric.ts'
import {
  type CompiledLogic,
  characterizeBlock,
  compileLogic,
  isOutputPort,
  POWER_PORT_IDS,
  stepLogic,
} from '../src/renderer/logic-sim.ts'
import type { Parameters } from '../src/renderer/part-defaults.ts'

/** The LSB-first input pattern for truth-table index i (input j = bit j of i) — the same convention lutIndex uses. */
const inputsFor = (i: number, k: number): boolean[] =>
  Array.from({ length: k }, (_, j) => (i & (1 << j)) !== 0)

describe('LUT index + config size', () => {
  test('a k-LUT holds 2^k config bits', () => {
    expect(lutConfigSize(1)).toBe(2)
    expect(lutConfigSize(4)).toBe(16)
    expect(lutConfigSize(6)).toBe(64)
  })

  test('inputs select the truth-table index LSB-first (input 0 = the LSB)', () => {
    expect(lutIndex([false, false, false, false])).toBe(0)
    expect(lutIndex([true, false, false, false])).toBe(1)
    expect(lutIndex([false, true, false, false])).toBe(2)
    expect(lutIndex([true, false, true, false])).toBe(5)
    expect(lutIndex([true, true, true, true])).toBe(15)
  })
})

describe('lutFn — a LUT is its truth table', () => {
  test('over ALL 2^4 inputs, a 4-LUT returns exactly its config (a wrong index mapping fails)', () => {
    // deliberately irregular so a bit-order or off-by-one bug can't pass by luck
    const config = [
      true,
      false,
      false,
      true,
      true,
      true,
      false,
      false,
      false,
      true,
      true,
      false,
      true,
      false,
      true,
      true,
    ]
    const fn = lutFn(config)
    for (let i = 0; i < 16; i++) expect(fn(inputsFor(i, 4))[0]).toBe(config[i])
  })

  test('a 4-LUT can realize a specific function — 4-input AND', () => {
    const and4 = Array.from({ length: 16 }, (_, i) => i === 15) // high only when all four inputs are high
    const fn = lutFn(and4)
    expect(fn([true, true, true, true])[0]).toBe(true)
    expect(fn([true, true, true, false])[0]).toBe(false)
    expect(fn([false, false, false, false])[0]).toBe(false)
  })

  test('an unset/short config entry reads false, never true', () => {
    expect(lutFn([])([false])[0]).toBe(false)
    expect(lutFn([false, false])([true])[0]).toBe(false)
  })

  test('a KLut config length matches 2^k', () => {
    const lut: KLut = {
      id: 'L0',
      k: 4,
      config: Array(16).fill(false),
      inputs: ['i0', 'i1', 'i2', 'i3'],
      output: 'y',
    }
    expect(lut.config.length).toBe(lutConfigSize(lut.k))
  })
})

describe('a LUT evaluates through the real logic engine (stepLogic) with no engine change', () => {
  test('a hand-built CompiledLogic of one LUT gate matches its truth table over all 16 inputs', () => {
    const config = [
      true,
      false,
      true,
      true,
      false,
      false,
      true,
      false,
      true,
      true,
      false,
      false,
      false,
      true,
      true,
      false,
    ]
    for (let i = 0; i < 16; i++) {
      const bits = inputsFor(i, 4)
      // One LUT gate (the exact `{ fn, ins, out }` shape stepLogic evaluates), inputs fixed by seeds.
      const compiled: CompiledLogic = {
        gates: [{ fn: lutFn(config), ins: ['i0', 'i1', 'i2', 'i3'], out: 'y' }],
        seeds: [
          { net: 'i0', high: bits[0] as boolean },
          { net: 'i1', high: bits[1] as boolean },
          { net: 'i2', high: bits[2] as boolean },
          { net: 'i3', high: bits[3] as boolean },
        ],
        portNet: (_nodeId, handle) => handle,
        cutNets: [],
      }
      const result = stepLogic(compiled)
      expect(result.settled).toBe(true)
      expect(result.value('lut', 'y')).toBe(config[i])
    }
  })
})

const supply = (volts: number): Parameters =>
  ({ nominal_voltage: { value: { kind: 'scalar', amount: volts, unit: 'volt' } } }) as Parameters

/**
 * A verbatim replica of logic-sim's characterizeBlock canvas sweep, with a hook to TRANSFORM the compiled
 * logic before simulating — so the golden gate netlist (identity) and the LUT-mapped fabric
 * (lutifyCompiled) go through the exact same path. So `characterizeVia(block, c => c)` equals
 * `characterizeBlock(block)` by construction (asserted below), and any difference under `lutifyCompiled`
 * is a real mapping bug.
 */
function characterizeVia(
  block: BlockData,
  transform: (c: CompiledLogic) => CompiledLogic,
): { inputs: string[]; outputs: string[]; rows: { in: boolean[]; out: boolean[] }[] } | null {
  const nonPower = block.ports.filter((p) => !POWER_PORT_IDS.has(p.id.toLowerCase()))
  const outputs = nonPower.filter(isOutputPort).map((p) => p.id)
  const inputs = nonPower.filter((p) => !isOutputPort(p)).map((p) => p.id)
  if (inputs.length === 0 || outputs.length === 0) return null
  const vddPort = block.ports.find((p) => ['v_dd', 'vdd', 'vcc'].includes(p.id.toLowerCase()))
  const gndPort = block.ports.find((p) => ['gnd', 'vss', 'vee'].includes(p.id.toLowerCase()))
  const rows: { in: boolean[]; out: boolean[] }[] = []
  for (let combo = 0; combo < 1 << inputs.length; combo++) {
    const inBits = inputs.map((_, i) => ((combo >> i) & 1) === 1)
    const nodes: CanvasNodeLike[] = [
      { id: 'b', position: { x: 0, y: 0 }, data: { definition: 'block', block } },
      { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
      ...inputs.map((_, i) => ({
        id: `s${i}`,
        position: { x: 0, y: 0 },
        data: { definition: 'power_source', parameters: supply(inBits[i] === true ? 5 : 0) },
      })),
      ...(vddPort
        ? [
            {
              id: 'vd',
              position: { x: 0, y: 0 },
              data: { definition: 'power_source', parameters: supply(5) },
            },
          ]
        : []),
    ]
    const edges: CanvasEdgeLike[] = [
      ...inputs.flatMap((port, i) => [
        {
          id: `e${i}p`,
          source: `s${i}`,
          sourceHandle: 'terminal_positive',
          target: 'b',
          targetHandle: port,
        },
        {
          id: `e${i}n`,
          source: `s${i}`,
          sourceHandle: 'terminal_negative',
          target: 'g',
          targetHandle: 'reference_terminal',
        },
      ]),
      ...(vddPort
        ? [
            {
              id: 'evd',
              source: 'vd',
              sourceHandle: 'terminal_positive',
              target: 'b',
              targetHandle: vddPort.id,
            },
          ]
        : []),
      ...(gndPort
        ? [
            {
              id: 'egn',
              source: 'b',
              sourceHandle: gndPort.id,
              target: 'g',
              targetHandle: 'reference_terminal',
            },
          ]
        : []),
    ]
    const compiled = transform(compileLogic(nodes, edges))
    const r = stepLogic(compiled)
    if (!r.settled) return null
    rows.push({ in: inBits, out: outputs.map((o) => r.value('b', o) === true) })
  }
  return { inputs, outputs, rows }
}

const blockCanvas = (block: BlockData): CanvasNodeLike[] => [
  { id: 'b', position: { x: 0, y: 0 }, data: { definition: 'block', block } },
]

describe('trivial tech-map — gates → LUTs, proven identical to the golden gate sim', () => {
  test('synthLutConfig enumerates a gate function into its truth table (2-input XOR)', () => {
    const xor = (ins: boolean[]) => [ins[0] !== ins[1]]
    // LSB-first index: 00→0, 01(a=1)→1, 10(b=1)→1, 11→0
    expect(synthLutConfig(xor, 2)).toEqual([false, true, true, false])
  })

  test('synthLutConfig respects LSB-first input order — an ASYMMETRIC function pins it (A AND NOT B)', () => {
    // XOR above is symmetric, so LSB-first and MSB-first give the same table — this catches a mirrored
    // bit order the future covering mapper would otherwise expose. LSB-first: bit0=A, bit1=B →
    // 00:F, 01(A=1):T, 10(B=1):F, 11:F. MSB-first would instead give [F,F,T,F].
    const andNotB = (ins: boolean[]) => [ins[0] === true && ins[1] !== true]
    expect(synthLutConfig(andNotB, 2)).toEqual([false, true, false, false])
    // and the LUT round-trips the function exactly over every input (bit-order drift end to end fails)
    const fn = lutFn(synthLutConfig(andNotB, 2))
    for (let i = 0; i < 4; i++) {
      const ins = [(i & 1) !== 0, (i & 2) !== 0]
      expect(fn(ins)[0]).toBe(andNotB(ins)[0])
    }
  })

  for (const block of [HALF_ADDER_BLOCK, FULL_ADDER_BLOCK]) {
    test(`${block.name}: one LUT per gate, and the LUT fabric matches the golden truth table exactly`, () => {
      const golden = characterizeBlock(block)
      expect(golden).not.toBeNull()

      // the transform-hook harness with identity must reproduce the real golden (proves the harness faithful)
      expect(characterizeVia(block, (c) => c)?.rows).toEqual(golden?.rows)

      // the LUT-mapped fabric computes the IDENTICAL function — the equivalence gate
      expect(characterizeVia(block, lutifyCompiled)?.rows).toEqual(golden?.rows)

      // and the mapping really emitted one well-formed LUT per compiled gate (not zero, not fused)
      const gateCount = compileLogic(blockCanvas(block), []).gates.length
      const luts = mapCompiledToLuts(compileLogic(blockCanvas(block), []))
      expect(gateCount).toBeGreaterThan(0)
      expect(luts.length).toBe(gateCount)
      expect(luts.every((l) => l.config.length === lutConfigSize(l.k))).toBe(true)
    })
  }
})

describe('LUT-covering mapper (Engine #1) — covers gate cones into fewer k-LUTs, still equivalent', () => {
  /** The nets a cover MUST preserve as its own LUT outputs: the block's primary-output ports, resolved to
   *  nets through the compiled portNet (a covered net absorbed away here would leave the output undriven). */
  const outputNetsOf = (block: BlockData, compiled: CompiledLogic): Set<string> =>
    new Set(
      block.ports
        .filter((p) => !POWER_PORT_IDS.has(p.id.toLowerCase()) && isOutputPort(p))
        .map((p) => compiled.portNet('b', p.id)),
    )

  /** Replace a compiled netlist's gates with the k-LUT COVER, for the equivalence harness. Threads the
   *  block's real output nets in, so the cover is required to drive exactly the ports characterizeVia reads. */
  const coverTransform =
    (k: number, block: BlockData) =>
    (compiled: CompiledLogic): CompiledLogic => ({
      ...compiled,
      gates: coverToLuts(compiled, outputNetsOf(block, compiled), k).map((l) => ({
        fn: lutFn(l.config),
        ins: l.inputs,
        out: l.output,
      })),
    })

  /** A cover is WELL-FORMED iff every LUT is k-feasible with a 2^k config, every internal leaf it reads is
   *  driven by some LUT (or is a primary input), and every primary output is driven — the structural
   *  invariants an equivalence check over a few input rows does not, on its own, pin. */
  const assertWellFormedCover = (
    luts: { k: number; config: boolean[]; inputs: string[]; output: string }[],
    k: number,
    primaryInputs: Set<string>,
    outputs: Set<string>,
  ): void => {
    for (const l of luts) {
      expect(l.k).toBeLessThanOrEqual(k)
      expect(l.inputs.length).toBe(l.k)
      expect(l.config.length).toBe(lutConfigSize(l.k))
    }
    const driven = new Set(luts.map((l) => l.output))
    expect(driven.size).toBe(luts.length) // each net driven at most once — no two LUTs fight one net
    for (const l of luts)
      for (const leaf of l.inputs) expect(primaryInputs.has(leaf) || driven.has(leaf)).toBe(true) // no dangling leaf
    for (const o of outputs) expect(primaryInputs.has(o) || driven.has(o)).toBe(true) // every output driven
  }

  const primaryInputsOf = (compiled: CompiledLogic): Set<string> => {
    const driven = new Set(compiled.gates.map((g) => g.out))
    const ins = new Set<string>()
    for (const g of compiled.gates) for (const net of g.ins) if (!driven.has(net)) ins.add(net)
    return ins
  }

  // Small designs plus a bigger, more reconvergent one — the 2-bit ripple adder's carry chain (shared
  // sub-functions + deeper cones) is exactly where a cut-enumeration / covering bug would surface.
  for (const block of [HALF_ADDER_BLOCK, FULL_ADDER_BLOCK, RIPPLE_CARRY_2BIT]) {
    test(`${block.name}: covered netlist matches the golden truth table AND is a well-formed k-feasible cover (k=4)`, () => {
      const golden = characterizeBlock(block)
      expect(golden).not.toBeNull()
      // the cover computes the IDENTICAL function as the original gates — the equivalence gate
      expect(characterizeVia(block, coverTransform(4, block))?.rows).toEqual(golden?.rows)

      // and it is structurally sound: k-feasible, single-driver, no dangling leaves, every output driven.
      // (Equivalence alone is k-AGNOSTIC — lutFn evaluates an over-wide config happily — so without this a
      // >k LUT slips through; asserted for EVERY block, not just the 3-input full adder.)
      const compiled = compileLogic(blockCanvas(block), [])
      const luts = coverToLuts(compiled, outputNetsOf(block, compiled), 4)
      assertWellFormedCover(luts, 4, primaryInputsOf(compiled), outputNetsOf(block, compiled))
    })
  }

  test('covering uses FEWER LUTs than the trivial one-LUT-per-gate map (full adder, k=4)', () => {
    const compiled = compileLogic(blockCanvas(FULL_ADDER_BLOCK), [])
    const trivial = mapCompiledToLuts(compiled).length
    const covered = coverToLuts(compiled, outputNetsOf(FULL_ADDER_BLOCK, compiled), 4).length
    expect(covered).toBeGreaterThan(0)
    expect(covered).toBeLessThan(trivial) // a whole cone of 2-input gates folds into each 4-LUT
  })

  test('the k bound is LOAD-BEARING: a wide design stays k-feasible even at a large cut cap', () => {
    // RIPPLE_CARRY_2BIT's Cout cone spans 5 primary inputs. At a big cutCap the enumerator finds the wide
    // cuts, so the `leaves.length > k` guard is the ONLY thing keeping every LUT ≤ k — delete it and this
    // fails (widths would reach 5). This is the assertion the default-cutCap tests could not make bind.
    const compiled = compileLogic(blockCanvas(RIPPLE_CARRY_2BIT), [])
    const outs = outputNetsOf(RIPPLE_CARRY_2BIT, compiled)
    for (const k of [4, 3]) {
      const luts = coverToLuts(compiled, outs, k, 64)
      expect(luts.length).toBeGreaterThan(0)
      expect(luts.every((l) => l.k <= k && l.inputs.length <= k)).toBe(true)
    }
  })

  test('a smaller LUT size (k=3) still covers correctly (equivalence holds at a different k)', () => {
    const golden = characterizeBlock(FULL_ADDER_BLOCK)
    expect(characterizeVia(FULL_ADDER_BLOCK, coverTransform(3, FULL_ADDER_BLOCK))?.rows).toEqual(
      golden?.rows,
    )
  })

  test('a primary output that ALSO feeds internal logic (fanout 1) is still emitted and driven', () => {
    // The exact defect the fanout heuristic missed: net N is a primary output AND the single input of gate Z.
    // With only the fanout rule, N (fanout 1) is neither terminal nor shared, gets absorbed into Z's cone,
    // and the output reads an undriven net. Threading N in as an output net forces it to be its own LUT.
    const AND2 = (i: boolean[]) => [i[0] === true && i[1] === true]
    const compiled: CompiledLogic = {
      gates: [
        { fn: AND2, ins: ['a', 'b'], out: 'N' }, // N = a AND b  (a primary output)
        { fn: AND2, ins: ['N', 'c'], out: 'Z' }, // Z = N AND c  (a primary output that consumes N)
      ],
      seeds: [],
      portNet: (_id, handle) => handle,
      cutNets: [],
    }
    const luts = coverToLuts(compiled, new Set(['N', 'Z']), 4)
    const outputs = new Set(luts.map((l) => l.output))
    expect(outputs.has('N')).toBe(true) // the fanout-1 primary output is NOT absorbed away
    expect(outputs.has('Z')).toBe(true)

    // and it simulates correctly: N = a·b, Z = a·b·c, read back through stepLogic over all 8 input combos
    for (let combo = 0; combo < 8; combo++) {
      const [a, b, c] = [(combo & 1) !== 0, (combo & 2) !== 0, (combo & 4) !== 0]
      const sim: CompiledLogic = {
        gates: luts.map((l) => ({ fn: lutFn(l.config), ins: l.inputs, out: l.output })),
        seeds: [
          { net: 'a', high: a },
          { net: 'b', high: b },
          { net: 'c', high: c },
        ],
        portNet: (_id, handle) => handle,
        cutNets: [],
      }
      const r = stepLogic(sim)
      expect(r.value('x', 'N')).toBe(a && b)
      expect(r.value('x', 'Z')).toBe(a && b && c)
    }
  })

  test('a feedback cut point is preserved as a boundary — a cross-coupled pair covers to two mutual LUTs', () => {
    // A NAND SR latch: Q = NAND(s, qb), qb = NAND(r, Q). The loop's cut point (Q) and both outputs are
    // boundaries, so neither gate may be absorbed into the other. Without boundary/self-cut handling the
    // worklist would be empty (both nets fanout 1) and the cover would be [] — the docstring's feedback claim.
    const NAND2 = (i: boolean[]) => [!(i[0] === true && i[1] === true)]
    const compiled: CompiledLogic = {
      gates: [
        { fn: NAND2, ins: ['s', 'qb'], out: 'Q' },
        { fn: NAND2, ins: ['r', 'Q'], out: 'qb' },
      ],
      seeds: [],
      portNet: (_id, handle) => handle,
      cutNets: ['Q'], // compileLogic's cut point for this cycle
    }
    const luts = coverToLuts(compiled, new Set(['Q', 'qb']), 4)
    const outputs = new Set(luts.map((l) => l.output))
    expect(outputs.has('Q')).toBe(true)
    expect(outputs.has('qb')).toBe(true)
    // each LUT reads the OTHER's net as a leaf (no LUT contains its own output — no combinational self-loop)
    for (const l of luts) expect(l.inputs.includes(l.output)).toBe(false)
    const qLut = luts.find((l) => l.output === 'Q')
    const qbLut = luts.find((l) => l.output === 'qb')
    expect(qLut?.inputs).toContain('qb')
    expect(qbLut?.inputs).toContain('Q')
  })
})
