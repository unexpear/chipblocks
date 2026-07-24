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
  /** Replace a compiled netlist's gates with the k-LUT COVER, for the equivalence harness. */
  const coverTransform =
    (k: number) =>
    (compiled: CompiledLogic): CompiledLogic => ({
      ...compiled,
      gates: coverToLuts(compiled, k).map((l) => ({
        fn: lutFn(l.config),
        ins: l.inputs,
        out: l.output,
      })),
    })

  // Small designs plus a bigger, more reconvergent one — the 2-bit ripple adder's carry chain (shared
  // sub-functions + deeper cones) is exactly where a cut-enumeration / covering bug would surface.
  for (const block of [HALF_ADDER_BLOCK, FULL_ADDER_BLOCK, RIPPLE_CARRY_2BIT]) {
    test(`${block.name}: the COVERED LUT netlist matches the golden truth table exactly (k=4)`, () => {
      const golden = characterizeBlock(block)
      expect(golden).not.toBeNull()
      // the cover computes the IDENTICAL function as the original gates — the equivalence gate
      expect(characterizeVia(block, coverTransform(4))?.rows).toEqual(golden?.rows)
    })
  }

  test('covering uses FEWER LUTs than the trivial one-LUT-per-gate map (full adder, k=4)', () => {
    const compiled = compileLogic(blockCanvas(FULL_ADDER_BLOCK), [])
    const trivial = mapCompiledToLuts(compiled).length
    const covered = coverToLuts(compiled, 4).length
    expect(covered).toBeGreaterThan(0)
    expect(covered).toBeLessThan(trivial) // a whole cone of 2-input gates folds into each 4-LUT
  })

  test('every covered LUT is k-feasible and well-formed (config length = 2^k, inputs = k)', () => {
    const luts = coverToLuts(compileLogic(blockCanvas(FULL_ADDER_BLOCK), []), 4)
    expect(luts.length).toBeGreaterThan(0)
    expect(luts.every((l) => l.k <= 4)).toBe(true)
    expect(luts.every((l) => l.config.length === lutConfigSize(l.k))).toBe(true)
    expect(luts.every((l) => l.inputs.length === l.k)).toBe(true)
  })

  test('a smaller LUT size (k=3) still covers correctly (equivalence holds at a different k)', () => {
    const golden = characterizeBlock(FULL_ADDER_BLOCK)
    expect(characterizeVia(FULL_ADDER_BLOCK, coverTransform(3))?.rows).toEqual(golden?.rows)
  })
})
