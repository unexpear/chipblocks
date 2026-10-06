/**
 * The logic-sim seed — a node-voltage seed for the DC solver computed from the fast logic-sim, so a
 * real-transistor solve can be handed the known digital operating point. This test proves the seed is
 * computed CORRECTLY end to end: every net it pins (each gate's I/O + the supply rails) matches the
 * converged operating point of the full ~250-MOSFET calculator solve, through the
 * canvas-gate-pin → transistor-terminal → world-net mapping.
 *
 * Warm-start note (2026-10-06): the canvas transistor path now passes this seed as `initialNodes`
 * into the robust DC solve. Early gmin levels deliberately ignore it (a final-OP start fights a large
 * shunt — measured). The direct attempt and the pseudo-transient continuation may use it. This file
 * still proves the seed is *correct* vs a converged OP; speed claims stay out of scope here.
 */

import { describe, expect, test } from 'vitest'
import { solveDCRobust } from '../src/dc-robust.ts'
import {
  type BlockData,
  type CanvasEdgeLike,
  type CanvasNodeLike,
  flattenBlocks,
} from '../src/renderer/blocks.ts'
import { CALCULATOR_4BIT } from '../src/renderer/builtin-blocks.ts'
import { canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { digitalSeed } from '../src/renderer/logic-sim.ts'

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

/** Drop a block on a canvas, wire its V+/GND rails, and drive each named input port from a source. */
function blockCanvas(
  block: BlockData,
  inputs: Record<string, number>,
): { nodes: CanvasNodeLike[]; edges: CanvasEdgeLike[] } {
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
  return { nodes, edges }
}

function worldOf(nodes: CanvasNodeLike[], edges: CanvasEdgeLike[]) {
  const flat = flattenBlocks(nodes, edges)
  return canvasToWorld(
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
}

describe('logic-sim seed — the digital operating point', () => {
  test('every pinned net matches the converged operating point (the net mapping is correct)', () => {
    // 0b0011 + 0b0001 (SUB low) on the 4-bit calculator.
    const inputs = { a0: VDD, a1: VDD, a2: 0, a3: 0, b0: VDD, b1: 0, b2: 0, b3: 0, sub: 0 }
    const { nodes, edges } = blockCanvas(CALCULATOR_4BIT, inputs)
    const world = worldOf(nodes, edges)

    const seed = digitalSeed(nodes, edges, world)
    expect(seed).toBeDefined()
    if (!seed) return
    expect(seed.size).toBeGreaterThan(20) // pins the gate I/O + rail nets, not a handful

    const cold = solveDCRobust(world)
    expect(cold.status).toBe('solved')
    // Every seeded net agrees with the real converged operating point → the mapping
    // (gate pin → transistor terminal → world net) is right end to end.
    let disagree = 0
    for (const [net, v] of seed) {
      const converged = cold.nodes.get(net)
      if (converged !== undefined && Math.abs(converged - v) >= 1.0) disagree++
    }
    expect(disagree).toBe(0)
  })
})
