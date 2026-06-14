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
import { INVERTER_BLOCK, NAND2_BLOCK, NOR2_BLOCK } from '../src/renderer/builtin-blocks.ts'
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

/** Drop the inverter, wire V+ to VDD and GND, drive the input, flatten + solve; return the
 *  output-node voltage. */
function inverterOut(inVolts: number): number {
  const nodes: CanvasNodeLike[] = [
    { id: 'inv', position: { x: 0, y: 0 }, data: { definition: 'block', block: INVERTER_BLOCK } },
    {
      id: 'vdd',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(VDD) },
    },
    {
      id: 'vin',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(inVolts) },
    },
    { id: 'gnd', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
  ]
  const edges: CanvasEdgeLike[] = [
    wire('a', 'vdd', 'terminal_positive', 'inv', 'v_dd'),
    wire('b', 'vdd', 'terminal_negative', 'gnd', 'reference_terminal'),
    wire('c', 'inv', 'gnd', 'gnd', 'reference_terminal'),
    wire('d', 'vin', 'terminal_positive', 'inv', 'in'),
    wire('e', 'vin', 'terminal_negative', 'gnd', 'reference_terminal'),
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
  const outNet = world.instances.get('inv.pmos')?.connects?.find((c) => c.terminal === 'drain')?.net
  return solution.nodes.get(outNet ?? '') ?? Number.NaN
}

describe('CMOS inverter (NOT) block — the NOT truth table from real transistors', () => {
  test('input LOW -> output HIGH (the PMOS pulls it up to ~V+)', () => {
    expect(inverterOut(0)).toBeGreaterThan(VDD * 0.7) // ~5 V
  })

  test('input HIGH -> output LOW (the NMOS pulls it down to ~0)', () => {
    expect(inverterOut(VDD)).toBeLessThan(VDD * 0.3) // ~0 V
  })
})

/** Drop a 2-input gate, wire V+/GND, drive A and B, flatten + solve; return the output. */
function gate2Out(block: BlockData, aVolts: number, bVolts: number): number {
  const nodes: CanvasNodeLike[] = [
    { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'block', block } },
    {
      id: 'vdd',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(VDD) },
    },
    {
      id: 'va',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(aVolts) },
    },
    {
      id: 'vb',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(bVolts) },
    },
    { id: 'gnd', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
  ]
  const edges: CanvasEdgeLike[] = [
    wire('w1', 'vdd', 'terminal_positive', 'g', 'v_dd'),
    wire('w2', 'vdd', 'terminal_negative', 'gnd', 'reference_terminal'),
    wire('w3', 'g', 'gnd', 'gnd', 'reference_terminal'),
    wire('w4', 'va', 'terminal_positive', 'g', 'a'),
    wire('w5', 'va', 'terminal_negative', 'gnd', 'reference_terminal'),
    wire('w6', 'vb', 'terminal_positive', 'g', 'b'),
    wire('w7', 'vb', 'terminal_negative', 'gnd', 'reference_terminal'),
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
  const out = block.ports.find((p) => p.id === 'out')?.inner
  const outNet = out
    ? world.instances.get(`g.${out.nodeId}`)?.connects?.find((c) => c.terminal === out.handleId)
        ?.net
    : undefined
  return solution.nodes.get(outNet ?? '') ?? Number.NaN
}

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
