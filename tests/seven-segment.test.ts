/**
 * Seven-segment display — a single alarm-clock digit built from seven REAL LED+resistor segments
 * (common cathode). Driving a segment's pin HIGH (with COMMON grounded) must push real forward
 * current through that segment's LED (so it lights); an undriven segment must carry ~none (stays
 * dark). The on-canvas figure-8 reads exactly this per-segment current via canvasHealth.
 */

import { describe, expect, test } from 'vitest'
import { solveDCRobust } from '../src/dc-robust.ts'
import { type CanvasEdgeLike, type CanvasNodeLike, flattenBlocks } from '../src/renderer/blocks.ts'
import { SEVEN_SEGMENT_DISPLAY } from '../src/renderer/builtin-blocks.ts'
import { canvasToWorld } from '../src/renderer/canvas-to-world.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const supply = (volts: number) => ({
  nominal_voltage: scalar(volts, 'volt'),
  internal_resistance: scalar(0, 'ohm'),
})

/** Drive the listed segments HIGH (5 V), ground COMMON, and return each segment LED's |current| (A). */
function ledCurrents(driven: string[]): Record<string, number> {
  const nodes: CanvasNodeLike[] = [
    {
      id: 'd',
      position: { x: 0, y: 0 },
      data: { definition: 'block', block: SEVEN_SEGMENT_DISPLAY },
    },
    { id: 'gnd', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
    ...driven.map((seg) => ({
      id: `src_${seg}`,
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(5) },
    })),
  ]
  const edges: CanvasEdgeLike[] = [
    {
      id: 'w_common',
      source: 'd',
      sourceHandle: 'common',
      target: 'gnd',
      targetHandle: 'reference_terminal',
    },
    ...driven.flatMap((seg) => [
      {
        id: `w_${seg}_p`,
        source: `src_${seg}`,
        sourceHandle: 'terminal_positive',
        target: 'd',
        targetHandle: `seg_${seg}`,
      },
      {
        id: `w_${seg}_n`,
        source: `src_${seg}`,
        sourceHandle: 'terminal_negative',
        target: 'gnd',
        targetHandle: 'reference_terminal',
      },
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
  const out: Record<string, number> = {}
  // The shipped display nests a bare display in its `core` sub-block, so its LEDs live one level down.
  for (const seg of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
    out[seg] = Math.abs(solution.branches.get(`d.core.led_${seg}`) ?? 0)
  }
  return out
}

describe('seven-segment display — driven segments light, the rest stay dark', () => {
  test('the segments of a "7" (a, b, c) carry LED current; the others carry ~none', () => {
    const i = ledCurrents(['a', 'b', 'c'])
    // lit: above canvasHealth's 0.1 mA floor (a 330 Ω + red LED off 5 V carries ~9 mA)
    expect(i.a).toBeGreaterThan(1e-3)
    expect(i.b).toBeGreaterThan(1e-3)
    expect(i.c).toBeGreaterThan(1e-3)
    // dark: the undriven segments carry essentially nothing
    expect(i.d).toBeLessThan(1e-4)
    expect(i.e).toBeLessThan(1e-4)
    expect(i.f).toBeLessThan(1e-4)
    expect(i.g).toBeLessThan(1e-4)
  })
})
