/**
 * partReadings tests (Sprint 19) — the per-part current / voltage / power the
 * Properties panel shows. All derived from the real solve, like Falstad's
 * per-component readouts.
 */

import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { partReadings } from '../src/renderer/part-readings.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

describe('partReadings', () => {
  test('reports current / voltage / power for each part of a battery → resistor → LED loop', () => {
    const nodes: CanvasNode[] = [
      {
        id: 'bat',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(9, 'volt'), internal_resistance: scalar(1, 'ohm') },
      },
      { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(470, 'ohm') } },
      {
        id: 'led',
        definition: 'led',
        parameters: {
          forward_voltage: scalar(2, 'volt'),
          max_forward_current: scalar(0.02, 'ampere'),
        },
      },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      {
        source: 'bat',
        sourceHandle: 'terminal_positive',
        target: 'r1',
        targetHandle: 'terminal_a',
      },
      { source: 'r1', sourceHandle: 'terminal_b', target: 'led', targetHandle: 'anode' },
      { source: 'led', sourceHandle: 'cathode', target: 'bat', targetHandle: 'terminal_negative' },
      {
        source: 'gnd',
        sourceHandle: 'reference_terminal',
        target: 'bat',
        targetHandle: 'terminal_negative',
      },
    ]
    const world = canvasToWorld(nodes, edges)
    const readings = partReadings(world, solveDC(world))

    // ~14.9 mA flows through the series loop.
    expect(readings.get('r1')?.current).toBeCloseTo(0.0149, 4)
    // Resistor drops I·R ≈ 14.9 mA × 470 Ω ≈ 7.0 V; dissipates ~0.10 W.
    expect(readings.get('r1')?.voltage).toBeCloseTo(7.0, 1)
    expect(readings.get('r1')?.power).toBeCloseTo(0.104, 2)
    // LED carries the same current, dropping ~1.98 V.
    expect(readings.get('led')?.current).toBeCloseTo(0.0149, 4)
    expect(readings.get('led')?.voltage).toBeCloseTo(1.98, 1)
    // Battery terminal voltage sags to ~8.985 V under its 1 Ω internal drop.
    expect(readings.get('bat')?.voltage).toBeCloseTo(8.985, 2)
    // Ground is a reference — no current, no reading.
    expect(readings.has('gnd')).toBe(false)
  })

  test('an unsolved circuit yields no readings', () => {
    const world = canvasToWorld([{ id: 'r1', definition: 'resistor' }], []) // no ground → not solved
    const readings = partReadings(world, solveDC(world))
    expect(readings.size).toBe(0)
  })
})
