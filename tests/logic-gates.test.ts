/**
 * The CMOS logic-gate blocks (Digital chapter) — proof that a gate packaged as a circuit
 * block is genuinely the transistors inside. We wire each gate on a canvas exactly as a user
 * would (drop it, connect the V+/GND rails, drive the input), flatten through the real
 * pipeline (flattenBlocks -> canvasToWorld), and solve. The output must obey the gate's truth
 * table -- produced by real MOSFET switching, not a lookup.
 */

import { describe, expect, test } from 'vitest'
import { solveDCRobust } from '../src/dc-robust.ts'
import {
  type BlockData,
  type CanvasEdgeLike,
  type CanvasNodeLike,
  flattenBlocks,
} from '../src/renderer/blocks.ts'
import {
  AND_BLOCK,
  FULL_ADDER_BLOCK,
  HALF_ADDER_BLOCK,
  INVERTER_BLOCK,
  NAND2_BLOCK,
  NOR2_BLOCK,
  OR_BLOCK,
  RIPPLE_CARRY_2BIT,
  RIPPLE_CARRY_4BIT,
  SR_LATCH_BLOCK,
  XOR_BLOCK,
} from '../src/renderer/builtin-blocks.ts'
import { canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { solveTransient } from '../src/transient-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const supply = (volts: number) => ({
  nominal_voltage: scalar(volts, 'volt'),
  internal_resistance: scalar(0, 'ohm'),
})
const VDD = 5

const wire = (
  id: string,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
): CanvasEdgeLike => ({ id, source, sourceHandle, target, targetHandle })

/**
 * Wire a block on a canvas the way a user would: the V+/GND rails, plus a DC source driving
 * each named input port to the given volts. Flatten through the real pipeline + solve, and
 * return a reader for any output port's voltage. The flatten's own port map resolves a port to
 * its real terminal at any nesting depth (a gate's transistor, an adder's gate's transistor).
 */
function solveBlock(block: BlockData, inputs: Record<string, number>): (portId: string) => number {
  const nodes: CanvasNodeLike[] = [
    { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'block', block } },
    {
      id: 'vdd',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(VDD) },
    },
    { id: 'gnd', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
    ...Object.entries(inputs).map(([portId, volts]) => ({
      id: `in_${portId}`,
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(volts) },
    })),
  ]
  const edges: CanvasEdgeLike[] = [
    wire('w_vdd_p', 'vdd', 'terminal_positive', 'g', 'v_dd'),
    wire('w_vdd_n', 'vdd', 'terminal_negative', 'gnd', 'reference_terminal'),
    wire('w_gnd', 'g', 'gnd', 'gnd', 'reference_terminal'),
    ...Object.keys(inputs).flatMap((portId) => [
      wire(`w_${portId}_p`, `in_${portId}`, 'terminal_positive', 'g', portId),
      wire(`w_${portId}_n`, `in_${portId}`, 'terminal_negative', 'gnd', 'reference_terminal'),
    ]),
  ]
  const flat = flattenBlocks(nodes, edges)
  const world = canvasToWorld(
    flat.nodes.map((n) => ({
      id: n.id,
      definition: n.data.definition,
      parameters: n.data.parameters,
    })),
    flat.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
    })),
  )
  const solution = solveDCRobust(world)
  return (portId: string): number => {
    const t = flat.portTarget.get(`g/${portId}`)
    const net = t
      ? world.instances.get(t.nodeId)?.connects?.find((c) => c.terminal === t.handleId)?.net
      : undefined
    return solution.nodes.get(net ?? '') ?? Number.NaN
  }
}

/** The inverter's output for a given input voltage. */
const inverterOut = (inVolts: number): number => solveBlock(INVERTER_BLOCK, { in: inVolts })('out')

describe('CMOS inverter (NOT) block — the NOT truth table from real transistors', () => {
  test('input LOW -> output HIGH (the PMOS pulls it up to ~V+)', () => {
    expect(inverterOut(0)).toBeGreaterThan(VDD * 0.7) // ~5 V
  })

  test('input HIGH -> output LOW (the NMOS pulls it down to ~0)', () => {
    expect(inverterOut(VDD)).toBeLessThan(VDD * 0.3) // ~0 V
  })
})

/** A 2-input gate's output for inputs A, B. */
const gate2Out = (block: BlockData, aVolts: number, bVolts: number): number =>
  solveBlock(block, { a: aVolts, b: bVolts })('out')

const isHigh = (v: number) => v > VDD * 0.7
const isLow = (v: number) => v < VDD * 0.3

describe('CMOS NAND block — OUT = NOT(A AND B), the universal gate', () => {
  test('the full truth table from four real MOSFETs', () => {
    expect(isHigh(gate2Out(NAND2_BLOCK, 0, 0))).toBe(true) // 0,0 -> 1
    expect(isHigh(gate2Out(NAND2_BLOCK, 0, VDD))).toBe(true) // 0,1 -> 1
    expect(isHigh(gate2Out(NAND2_BLOCK, VDD, 0))).toBe(true) // 1,0 -> 1
    expect(isLow(gate2Out(NAND2_BLOCK, VDD, VDD))).toBe(true) // 1,1 -> 0 (the NMOS stack conducts)
  })
})

describe('CMOS NOR block — OUT = NOT(A OR B)', () => {
  test('the full truth table from four real MOSFETs', () => {
    expect(isHigh(gate2Out(NOR2_BLOCK, 0, 0))).toBe(true) // 0,0 -> 1 (the PMOS stack conducts)
    expect(isLow(gate2Out(NOR2_BLOCK, 0, VDD))).toBe(true) // 0,1 -> 0
    expect(isLow(gate2Out(NOR2_BLOCK, VDD, 0))).toBe(true) // 1,0 -> 0
    expect(isLow(gate2Out(NOR2_BLOCK, VDD, VDD))).toBe(true) // 1,1 -> 0
  })
})

describe('AND block — a NAND then an inverter (nested gate blocks)', () => {
  test('the AND truth table: HIGH only when both inputs are HIGH', () => {
    expect(isLow(gate2Out(AND_BLOCK, 0, 0))).toBe(true) // 0,0 -> 0
    expect(isLow(gate2Out(AND_BLOCK, 0, VDD))).toBe(true) // 0,1 -> 0
    expect(isLow(gate2Out(AND_BLOCK, VDD, 0))).toBe(true) // 1,0 -> 0
    expect(isHigh(gate2Out(AND_BLOCK, VDD, VDD))).toBe(true) // 1,1 -> 1
  })
})

describe('OR block — a NOR then an inverter (nested gate blocks)', () => {
  test('the OR truth table: HIGH when either input is HIGH', () => {
    expect(isLow(gate2Out(OR_BLOCK, 0, 0))).toBe(true) // 0,0 -> 0
    expect(isHigh(gate2Out(OR_BLOCK, 0, VDD))).toBe(true) // 0,1 -> 1
    expect(isHigh(gate2Out(OR_BLOCK, VDD, 0))).toBe(true) // 1,0 -> 1
    expect(isHigh(gate2Out(OR_BLOCK, VDD, VDD))).toBe(true) // 1,1 -> 1
  })
})

describe('XOR block — the four-NAND network, HIGH when the inputs differ', () => {
  test('the XOR truth table from sixteen real MOSFETs', () => {
    expect(isLow(gate2Out(XOR_BLOCK, 0, 0))).toBe(true) // 0,0 -> 0
    expect(isHigh(gate2Out(XOR_BLOCK, 0, VDD))).toBe(true) // 0,1 -> 1
    expect(isHigh(gate2Out(XOR_BLOCK, VDD, 0))).toBe(true) // 1,0 -> 1
    expect(isLow(gate2Out(XOR_BLOCK, VDD, VDD))).toBe(true) // 1,1 -> 0
  })
})

describe('Half adder — SUM = A XOR B, CARRY = A AND B (an XOR gate + an AND gate)', () => {
  test('the truth table, both outputs', () => {
    const ha = (a: number, b: number) => {
      const read = solveBlock(HALF_ADDER_BLOCK, { a, b })
      return { sum: read('sum'), carry: read('carry') }
    }
    let o = ha(0, 0)
    expect([isLow(o.sum), isLow(o.carry)]).toEqual([true, true]) // 0+0 -> sum 0, carry 0
    o = ha(0, VDD)
    expect([isHigh(o.sum), isLow(o.carry)]).toEqual([true, true]) // 0+1 -> sum 1, carry 0
    o = ha(VDD, 0)
    expect([isHigh(o.sum), isLow(o.carry)]).toEqual([true, true]) // 1+0 -> sum 1, carry 0
    o = ha(VDD, VDD)
    expect([isLow(o.sum), isHigh(o.carry)]).toEqual([true, true]) // 1+1 -> sum 0, carry 1 (binary 10)
  })
})

describe('Full adder — A + B + Cin -> SUM, Cout (two half-adders + an OR)', () => {
  // The half-adder and OR are exhaustively tested above, so here we check a representative set of
  // rows (both outputs, both carry paths, and Cin's effect) to confirm the ~50-MOSFET composition
  // is wired right.
  test('representative rows of the three-input truth table, both outputs', () => {
    const fa = (a: number, b: number, cin: number) => {
      const read = solveBlock(FULL_ADDER_BLOCK, { a, b, cin })
      return { sum: read('sum'), cout: read('cout') }
    }
    const L = 0
    const H = VDD
    let o = fa(L, L, L)
    expect([isLow(o.sum), isLow(o.cout)]).toEqual([true, true]) // 0+0+0 = 0 -> sum 0, cout 0
    o = fa(L, L, H)
    expect([isHigh(o.sum), isLow(o.cout)]).toEqual([true, true]) // 0+0+1 = 1 -> sum 1, cout 0
    o = fa(L, H, H)
    expect([isLow(o.sum), isHigh(o.cout)]).toEqual([true, true]) // 0+1+1 = 2 -> sum 0, cout 1 (HA2 carry)
    o = fa(H, H, L)
    expect([isLow(o.sum), isHigh(o.cout)]).toEqual([true, true]) // 1+1+0 = 2 -> sum 0, cout 1 (HA1 carry)
    o = fa(H, H, H)
    expect([isHigh(o.sum), isHigh(o.cout)]).toEqual([true, true]) // 1+1+1 = 3 -> sum 1, cout 1
  }, 45000)
})

describe('2-bit ripple-carry adder — two full-adders, the carry rippling bit to bit', () => {
  // The full-adder is verified above, so a couple of additions here confirm the carry-chain
  // wiring (the carry rippling bit to bit) on the ~100-MOSFET flattened circuit.
  test('adds two 2-bit numbers, carry rippling through both cells', () => {
    // add2(A, B): A = a1a0, B = b1b0; returns the 3-bit result Cout S1 S0 as a number.
    const add2 = (a: number, b: number): number => {
      const read = solveBlock(RIPPLE_CARRY_2BIT, {
        a0: a & 1 ? VDD : 0,
        a1: a & 2 ? VDD : 0,
        b0: b & 1 ? VDD : 0,
        b1: b & 2 ? VDD : 0,
        cin: 0,
      })
      return (
        (isHigh(read('cout')) ? 4 : 0) + (isHigh(read('s1')) ? 2 : 0) + (isHigh(read('s0')) ? 1 : 0)
      )
    }
    expect(add2(2, 1)).toBe(3) // 2 + 1 = 3, no carry past bit 0
    expect(add2(3, 1)).toBe(4) // 3 + 1 = 4, carry ripples bit 0 -> bit 1 -> Cout
  }, 120000)
})

describe('4-bit ripple-carry adder — four full-adders, the nibble adder (~200 transistors)', () => {
  // Practical to solve-test now that the dense-linear solver replaced mathjs on the hot path.
  // Each addition flattens to ~200 real MOSFETs; the carry ripples across all four cells.
  test('adds two 4-bit numbers, carry rippling across all four cells', () => {
    const add4 = (a: number, b: number): number => {
      const read = solveBlock(RIPPLE_CARRY_4BIT, {
        a0: a & 1 ? VDD : 0,
        a1: a & 2 ? VDD : 0,
        a2: a & 4 ? VDD : 0,
        a3: a & 8 ? VDD : 0,
        b0: b & 1 ? VDD : 0,
        b1: b & 2 ? VDD : 0,
        b2: b & 4 ? VDD : 0,
        b3: b & 8 ? VDD : 0,
        cin: 0,
      })
      return (
        (isHigh(read('cout')) ? 16 : 0) +
        (isHigh(read('s3')) ? 8 : 0) +
        (isHigh(read('s2')) ? 4 : 0) +
        (isHigh(read('s1')) ? 2 : 0) +
        (isHigh(read('s0')) ? 1 : 0)
      )
    }
    expect(add4(6, 3)).toBe(9) // 0110 + 0011 = 1001, carry through the middle bits
    expect(add4(9, 7)).toBe(16) // 1001 + 0111, carry ripples all the way to Cout
    expect(add4(15, 1)).toBe(16) // 1111 + 0001, the longest ripple plus overflow
    expect(add4(15, 15)).toBe(30) // 1111 + 1111, the widest sum
  }, 30000)
})

describe('SR latch — two cross-coupled NOR gates, the first bit of memory', () => {
  // SET and RESET each settle to one stable state, so the DC solver finds them directly. The
  // HOLD state (S=R=0) is history-dependent -- that memory only shows up over time, so it is
  // proven in the transient suite, not from a single DC operating point.
  test('SET drives Q high, RESET drives Q low (the outputs stay complementary)', () => {
    const latch = (s: number, r: number) => {
      const read = solveBlock(SR_LATCH_BLOCK, { s: s ? VDD : 0, r: r ? VDD : 0 })
      return { q: read('q'), qbar: read('qbar') }
    }
    let o = latch(1, 0) // SET
    expect([isHigh(o.q), isLow(o.qbar)]).toEqual([true, true]) // Q = 1, Qbar = 0
    o = latch(0, 1) // RESET
    expect([isLow(o.q), isHigh(o.qbar)]).toEqual([true, true]) // Q = 0, Qbar = 1
  })
})

describe('SR latch memory — the hold state, proven over time', () => {
  // The hold state (S=R=0) is bistable: which value Q keeps depends on what was last written --
  // that IS memory. We pulse one input with a 0-5V square wave (the other held at 0), then read Q
  // in the hold window after the pulse falls. From the SAME S=R=0 inputs, a prior set leaves Q
  // high and a prior reset leaves Q low. (No parasitic capacitance is modelled, so the hold is
  // ideal -- the bistable feedback plus the solver's state continuity carry the bit forward.)
  const squareClock = {
    nominal_voltage: scalar(2.5, 'volt'),
    ac_amplitude: scalar(2.5, 'volt'),
    frequency: scalar(1000, 'hertz'),
    waveform: { value: 'square' },
  }
  function qInHoldAfter(pulse: 's' | 'r'): number {
    const nodes: CanvasNodeLike[] = [
      { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'block', block: SR_LATCH_BLOCK } },
      {
        id: 'vdd',
        position: { x: 0, y: 0 },
        data: { definition: 'power_source', parameters: supply(VDD) },
      },
      { id: 'gnd', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
      {
        id: 'in_s',
        position: { x: 0, y: 0 },
        data: { definition: 'power_source', parameters: pulse === 's' ? squareClock : supply(0) },
      },
      {
        id: 'in_r',
        position: { x: 0, y: 0 },
        data: { definition: 'power_source', parameters: pulse === 'r' ? squareClock : supply(0) },
      },
    ]
    const edges: CanvasEdgeLike[] = [
      wire('w_vdd_p', 'vdd', 'terminal_positive', 'g', 'v_dd'),
      wire('w_vdd_n', 'vdd', 'terminal_negative', 'gnd', 'reference_terminal'),
      wire('w_gnd', 'g', 'gnd', 'gnd', 'reference_terminal'),
      wire('w_s_p', 'in_s', 'terminal_positive', 'g', 's'),
      wire('w_s_n', 'in_s', 'terminal_negative', 'gnd', 'reference_terminal'),
      wire('w_r_p', 'in_r', 'terminal_positive', 'g', 'r'),
      wire('w_r_n', 'in_r', 'terminal_negative', 'gnd', 'reference_terminal'),
    ]
    const flat = flattenBlocks(nodes, edges)
    const world = canvasToWorld(
      flat.nodes.map((n) => ({
        id: n.id,
        definition: n.data.definition,
        parameters: n.data.parameters,
      })),
      flat.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
      })),
    )
    // 1 kHz square: HIGH for 0-0.5 ms (writes the bit), LOW for 0.5-1 ms (holds). Read Q mid-hold.
    const result = solveTransient(world, { timeStep: 0.00002, duration: 0.0012 })
    const qt = flat.portTarget.get('g/q')
    const qNet = qt
      ? world.instances.get(qt.nodeId)?.connects?.find((c) => c.terminal === qt.handleId)?.net
      : undefined
    const held = result.series.find((p) => p.time >= 0.00075)
    return held?.nodes.get(qNet ?? '') ?? Number.NaN
  }
  test('Q stays HIGH after a set pulse and LOW after a reset pulse (same S=R=0 hold)', () => {
    expect(isHigh(qInHoldAfter('s'))).toBe(true) // set, then released -> Q remembers 1
    expect(isLow(qInHoldAfter('r'))).toBe(true) // reset, then released -> Q remembers 0
  }, 60000)
})
