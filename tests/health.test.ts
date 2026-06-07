/**
 * canvasHealth tests (Sprint 19) — the success/failure animations are driven by
 * real solved currents + declared ratings, never faked.
 *
 * A battery → resistor → LED → ground loop: size the resistor so the LED runs
 * safely (it's `lit`), or starve it of resistance so the LED (and the quarter-watt
 * resistor) exceed their ratings (they're `failed` → they burst on the canvas).
 */

import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { canvasHealth } from '../src/renderer/health.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

const EDGES = [
  { source: 'bat', sourceHandle: 'terminal_positive', target: 'r1', targetHandle: 'terminal_a' },
  { source: 'r1', sourceHandle: 'terminal_b', target: 'led', targetHandle: 'anode' },
  { source: 'led', sourceHandle: 'cathode', target: 'bat', targetHandle: 'terminal_negative' },
  {
    source: 'gnd',
    sourceHandle: 'reference_terminal',
    target: 'bat',
    targetHandle: 'terminal_negative',
  },
]

const nodes = (ohms: number): CanvasNode[] => [
  { id: 'bat', definition: 'power_source', parameters: { nominal_voltage: scalar(9, 'volt') } },
  {
    id: 'r1',
    definition: 'resistor',
    parameters: { resistance: scalar(ohms, 'ohm'), power_rating: scalar(0.25, 'watt') },
  },
  {
    id: 'led',
    definition: 'led',
    parameters: { forward_voltage: scalar(2, 'volt'), max_forward_current: scalar(0.02, 'ampere') },
  },
  { id: 'gnd', definition: 'ground' },
]

describe('canvasHealth', () => {
  test('an LED within its rating is lit (success)', () => {
    const world = canvasToWorld(nodes(470), EDGES) // (9 − 2) / 470 ≈ 15 mA < 20 mA
    const health = canvasHealth(world, solveDC(world))
    expect(health.get('led')?.lit).toBe(true)
    expect(health.get('led')?.failed).toBeFalsy()
    expect(health.get('r1')?.failed).toBeFalsy() // ~0.1 W < 0.25 W
  })

  test('an overdriven LED fails (bursts), not lit — and the small resistor pops too', () => {
    const world = canvasToWorld(nodes(100), EDGES) // (9 − 2) / 100 ≈ 70 mA ≫ 20 mA
    const health = canvasHealth(world, solveDC(world))
    expect(health.get('led')?.failed).toBe(true)
    expect(health.get('led')?.lit).toBeFalsy()
    expect(health.get('r1')?.failed).toBe(true) // ~0.49 W > 0.25 W rating
  })

  test('parts not over a rating and not lit have no health entry', () => {
    const world = canvasToWorld(nodes(470), EDGES)
    const health = canvasHealth(world, solveDC(world))
    expect(health.has('bat')).toBe(false)
    expect(health.has('gnd')).toBe(false)
  })
})
