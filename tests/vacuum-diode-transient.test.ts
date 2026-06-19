/**
 * Vacuum diode (Fleming valve) — transient solver. An AC source drives the plate
 * through the tube into a load; the tube conducts only on the positive half-cycles
 * (plate positive) and blocks the negative ones, so the load sees half-wave-rectified
 * pulses — exactly what Fleming built the valve to do (detect/rectify radio signals).
 */

import { describe, expect, test } from 'vitest'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { solveTransient } from '../src/transient-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

/** AC source → vacuum diode plate; cathode → load → ground. */
function rectifierRig() {
  const nodes: CanvasNode[] = [
    {
      id: 'src',
      definition: 'power_source',
      parameters: {
        nominal_voltage: scalar(0, 'volt'),
        ac_amplitude: scalar(50, 'volt'),
        frequency: scalar(1000, 'hertz'),
        internal_resistance: scalar(0, 'ohm'),
      },
    },
    {
      id: 'v1',
      definition: 'vacuum_diode',
      parameters: {
        reference_plate_voltage: scalar(10, 'volt'),
        plate_current_at_reference: scalar(0.0095, 'ampere'),
        max_plate_dissipation: scalar(2, 'watt'),
      },
    },
    { id: 'rload', definition: 'resistor', parameters: { resistance: scalar(10000, 'ohm') } },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    { source: 'src', sourceHandle: 'terminal_positive', target: 'v1', targetHandle: 'plate' },
    { source: 'v1', sourceHandle: 'cathode', target: 'rload', targetHandle: 'terminal_a' },
    {
      source: 'rload',
      sourceHandle: 'terminal_b',
      target: 'gnd',
      targetHandle: 'reference_terminal',
    },
    {
      source: 'gnd',
      sourceHandle: 'reference_terminal',
      target: 'src',
      targetHandle: 'terminal_negative',
    },
  ]
  const world = canvasToWorld(nodes, edges)
  const loadNet = world.instances
    .get('rload')
    ?.connects?.find((c) => c.terminal === 'terminal_a')?.net
  return { world, loadNet }
}

describe('vacuum diode — transient (half-wave rectifier)', () => {
  test('it rectifies an AC source: positive pulses, almost nothing on the negatives', () => {
    const { world, loadNet } = rectifierRig()
    const result = solveTransient(world, { timeStep: 1e-5, duration: 3e-3 }) // 3 cycles at 1 kHz
    expect(result.status).toBe('solved')
    const vLoad = result.series.map((p) => p.nodes.get(loadNet ?? '') ?? 0)
    const max = Math.max(...vLoad)
    const min = Math.min(...vLoad)
    const mean = vLoad.reduce((a, b) => a + b, 0) / vLoad.length
    expect(max).toBeGreaterThan(20) // the positive half-cycles drive the load hard
    expect(min).toBeGreaterThan(-2) // the negative half-cycles are blocked (rectified)
    expect(mean).toBeGreaterThan(5) // a real positive DC component — the rectified average
  })

  test('with no tube the same node would swing symmetrically — the tube is what rectifies', () => {
    // Sanity: confirm the source actually swings negative (so the blocked minimum above
    // is the tube working, not a source that never goes negative).
    const { world } = rectifierRig()
    const result = solveTransient(world, { timeStep: 1e-5, duration: 3e-3 })
    const plateNet = world.instances.get('v1')?.connects?.find((c) => c.terminal === 'plate')?.net
    const vPlate = result.series.map((p) => p.nodes.get(plateNet ?? '') ?? 0)
    expect(Math.min(...vPlate)).toBeLessThan(-20) // the plate (source side) does go well negative
  })
})
