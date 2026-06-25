/**
 * Bare seven-segment display — the REAL raw component (seven LEDs, common cathode, NO built-in
 * resistors), like an actual display you buy. Proves: (1) it flattens to seven real LEDs and nothing
 * else; (2) driven straight off a 5 V supply with no external current-limiting resistor, the LED
 * over-currents and is flagged FAILED — you MUST add a resistor, exactly like the real part; (3) with a
 * proper external 330 Ω resistor it runs safe at the real ~9 mA. The shipped `display_seven_segment` is
 * this plus those resistors (a safe drop-and-go module).
 */

import { describe, expect, test } from 'vitest'
import { solveDCRobust } from '../src/dc-robust.ts'
import { type CanvasEdgeLike, type CanvasNodeLike, flattenBlocks } from '../src/renderer/blocks.ts'
import { SEVEN_SEGMENT_BARE } from '../src/renderer/builtin-blocks.ts'
import { canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { canvasHealth } from '../src/renderer/health.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const supply = (volts: number, rInternal = 0) => ({
  nominal_voltage: scalar(volts, 'volt'),
  internal_resistance: scalar(rInternal, 'ohm'),
})

function solve(nodes: CanvasNodeLike[], edges: CanvasEdgeLike[]) {
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
  return {
    flat,
    solution,
    health: canvasHealth(world, solution),
    branchOf: (id: string) => Math.abs(solution.branches.get(id) ?? 0),
  }
}

const display: CanvasNodeLike = {
  id: 'd',
  position: { x: 0, y: 0 },
  data: { definition: 'block', block: SEVEN_SEGMENT_BARE },
}
const ground: CanvasNodeLike = {
  id: 'gnd',
  position: { x: 0, y: 0 },
  data: { definition: 'ground' },
}
const commonToGnd: CanvasEdgeLike = {
  id: 'common',
  source: 'd',
  sourceHandle: 'common',
  target: 'gnd',
  targetHandle: 'reference_terminal',
}
const supplyNegToGnd: CanvasEdgeLike = {
  id: 'vn',
  source: 'v',
  sourceHandle: 'terminal_negative',
  target: 'gnd',
  targetHandle: 'reference_terminal',
}

describe('bare seven-segment display — the raw component, resistors NOT included', () => {
  test('flattens to seven real LEDs and zero resistors', () => {
    const { flat } = solve([display], [])
    expect(flat.nodes.filter((n) => n.data.definition === 'led').length).toBe(7)
    expect(flat.nodes.filter((n) => n.data.definition === 'resistor').length).toBe(0)
  })

  test('driven straight off 5 V with NO resistor, the LED over-currents and is flagged failed', () => {
    const { solution, health, branchOf } = solve(
      [
        display,
        ground,
        {
          id: 'v',
          position: { x: 0, y: 0 },
          data: { definition: 'power_source', parameters: supply(5, 1) },
        },
      ],
      [
        commonToGnd,
        {
          id: 'drive',
          source: 'v',
          sourceHandle: 'terminal_positive',
          target: 'd',
          targetHandle: 'seg_a',
        },
        supplyNegToGnd,
      ],
    )
    expect(solution.status).toBe('solved')
    // way over the LED's 20 mA rating, and the failure detector flags it — you must add a resistor
    expect(branchOf('d.led_a')).toBeGreaterThan(0.02)
    expect(health.get('d.led_a')?.failed).toBe(true)
  })

  test('with a proper external 330 Ω resistor it runs safe at the real ~9 mA', () => {
    const { solution, health, branchOf } = solve(
      [
        display,
        ground,
        {
          id: 'v',
          position: { x: 0, y: 0 },
          data: { definition: 'power_source', parameters: supply(5) },
        },
        {
          id: 'r',
          position: { x: 0, y: 0 },
          data: { definition: 'resistor', parameters: { resistance: scalar(330, 'ohm') } },
        },
      ],
      [
        commonToGnd,
        {
          id: 'vr',
          source: 'v',
          sourceHandle: 'terminal_positive',
          target: 'r',
          targetHandle: 'terminal_a',
        },
        { id: 'rseg', source: 'r', sourceHandle: 'terminal_b', target: 'd', targetHandle: 'seg_a' },
        supplyNegToGnd,
      ],
    )
    expect(solution.status).toBe('solved')
    const i = branchOf('d.led_a')
    expect(i).toBeGreaterThan(0.005)
    expect(i).toBeLessThan(0.015)
    expect(health.get('d.led_a')?.failed === true).toBe(false)
  })
})
