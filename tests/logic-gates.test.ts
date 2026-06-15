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
  XOR_BLOCK,
} from '../src/renderer/builtin-blocks.ts'
import { canvasToWorld } from '../src/renderer/canvas-to-world.ts'

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
  // ~50 transistors flatten out of this, so each solve takes a few seconds. The half-adder and
  // OR are exhaustively tested above; here we check a representative set of rows (both outputs,
  // both carry paths, and Cin's effect) to confirm the composition is wired right.
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
