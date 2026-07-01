/**
 * The canvas→solver pipeline, tested end to end through the extracted `pipeline/` module.
 *
 * `solveCanvasDispatch` and its lowering pass `canvasWorld` used to live inside the 8100-line App.tsx,
 * where no test could reach them — the orchestration layer was verified only by hand in the running app.
 * Lifting them into src/renderer/pipeline/ made them importable, so this locks the whole seam with a real
 * circuit: build React Flow nodes + wires, dispatch, and check the solve obeys Ohm's law. Same battery +
 * resistor + ground loop as canvas-to-world.test.ts (9 V behind 1 Ω, across 100 Ω → ~89.1 mA), but driven
 * through the FULL pipeline — flatten → lower → cast light → pick the engine → solve → fold back.
 */

import type { Edge, Node } from '@xyflow/react'
import { describe, expect, test } from 'vitest'
import { canvasWorld } from '../src/renderer/pipeline/canvas-world.ts'
import { solveCanvasDispatch } from '../src/renderer/pipeline/solve-canvas.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

const node = (id: string, definition: string, parameters?: Record<string, unknown>): Node =>
  ({
    id,
    position: { x: 0, y: 0 },
    data: { definition, ...(parameters ? { parameters } : {}) },
  }) as unknown as Node

const nodes: Node[] = [
  node('bat', 'power_source', {
    nominal_voltage: scalar(9, 'volt'),
    internal_resistance: scalar(1, 'ohm'),
  }),
  node('r1', 'resistor', { resistance: scalar(100, 'ohm') }),
  node('gnd', 'ground'),
]
const edges: Edge[] = [
  {
    id: 'e1',
    source: 'bat',
    sourceHandle: 'terminal_positive',
    target: 'r1',
    targetHandle: 'terminal_a',
  },
  {
    id: 'e2',
    source: 'r1',
    sourceHandle: 'terminal_b',
    target: 'bat',
    targetHandle: 'terminal_negative',
  },
  {
    id: 'e3',
    source: 'gnd',
    sourceHandle: 'reference_terminal',
    target: 'bat',
    targetHandle: 'terminal_negative',
  },
] as unknown as Edge[]

describe('pipeline: canvas → solver, end to end through the extracted module', () => {
  test('canvasWorld lowers the drawn circuit to a real World', () => {
    const { world } = canvasWorld(nodes, edges)
    // 3 parts + 3 wires (each drawn edge is a real 2-terminal wire element).
    expect(world.instances.size).toBe(6)
    expect([...world.instances.values()].some((i) => i.definition === 'resistor')).toBe(true)
  })

  test('solveCanvasDispatch routes an all-analog canvas to the transistor-level solve and obeys Ohm’s law', () => {
    const result = solveCanvasDispatch(nodes, edges)
    expect(result.solution.status).toBe('solved')
    // 9 V across 100 Ω + the battery's 1 Ω internal resistance → ~89.1 mA through r1.
    expect(Math.abs(result.solution.branches.get('r1') ?? -1)).toBeCloseTo(0.0891, 4)
    // The orchestration folded the solve back into the UI-facing shapes.
    expect(result.edges.length).toBe(3)
    expect(result.readings.has('r1')).toBe(true)
    expect(result.terminalVolts.size).toBeGreaterThan(0)
  })
})
