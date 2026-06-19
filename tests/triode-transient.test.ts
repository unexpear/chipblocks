/**
 * Triode (Audion) — transient solver. A common-cathode amplifier with a small AC
 * signal on the grid: the plate produces a much larger, INVERTED copy of it. This is
 * voltage amplification in the time domain — the thing that made radio and everything
 * after it possible.
 */

import { describe, expect, test } from 'vitest'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { solveTransient } from '../src/transient-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

const triodeParams = () => ({
  amplification_factor: scalar(100, 'dimensionless'),
  reference_plate_voltage: scalar(250, 'volt'),
  reference_grid_voltage: scalar(-2, 'volt'),
  plate_current_at_reference: scalar(0.0012, 'ampere'),
  max_plate_dissipation: scalar(1, 'watt'),
})

/** Common-cathode amp: 300 V B+ → 100 kΩ load → plate; cathode grounded; grid driven
 *  by a −2 V bias + a small 0.1 V AC signal. */
function ampRig() {
  const nodes: CanvasNode[] = [
    {
      id: 'bplus',
      definition: 'power_source',
      parameters: { nominal_voltage: scalar(300, 'volt'), internal_resistance: scalar(0, 'ohm') },
    },
    { id: 'rload', definition: 'resistor', parameters: { resistance: scalar(100000, 'ohm') } },
    { id: 'v1', definition: 'triode', parameters: triodeParams() },
    {
      id: 'vg',
      definition: 'power_source',
      parameters: {
        nominal_voltage: scalar(-2, 'volt'),
        ac_amplitude: scalar(0.1, 'volt'),
        frequency: scalar(1000, 'hertz'),
        internal_resistance: scalar(0, 'ohm'),
      },
    },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    {
      source: 'bplus',
      sourceHandle: 'terminal_positive',
      target: 'rload',
      targetHandle: 'terminal_a',
    },
    { source: 'rload', sourceHandle: 'terminal_b', target: 'v1', targetHandle: 'plate' },
    { source: 'v1', sourceHandle: 'cathode', target: 'gnd', targetHandle: 'reference_terminal' },
    { source: 'vg', sourceHandle: 'terminal_positive', target: 'v1', targetHandle: 'grid' },
    {
      source: 'vg',
      sourceHandle: 'terminal_negative',
      target: 'gnd',
      targetHandle: 'reference_terminal',
    },
    {
      source: 'bplus',
      sourceHandle: 'terminal_negative',
      target: 'gnd',
      targetHandle: 'reference_terminal',
    },
  ]
  const world = canvasToWorld(nodes, edges)
  const net = (id: string, terminal: string) =>
    world.instances.get(id)?.connects?.find((c) => c.terminal === terminal)?.net ?? ''
  return { world, plateNet: net('v1', 'plate'), gridNet: net('v1', 'grid') }
}

describe('triode — transient (amplifier)', () => {
  test('a small grid signal makes a large, inverted plate signal — voltage gain', () => {
    const { world, plateNet, gridNet } = ampRig()
    const result = solveTransient(world, { timeStep: 2e-5, duration: 3e-3 }) // 3 cycles at 1 kHz
    expect(result.status).toBe('solved')
    const plate = result.series.map((p) => p.nodes.get(plateNet) ?? 0)
    const grid = result.series.map((p) => p.nodes.get(gridNet) ?? 0)
    const pp = (a: number[]) => Math.max(...a) - Math.min(...a)
    const gain = pp(plate) / pp(grid)
    expect(pp(grid)).toBeGreaterThan(0.15) // the grid really swings (~0.2 V pp)
    expect(gain).toBeGreaterThan(30) // the plate swings tens of times harder — amplification

    // inversion: at the instant the grid is highest, the plate is at its lowest
    let iGridMax = 0
    let iGridMin = 0
    for (let i = 1; i < grid.length; i++) {
      if ((grid[i] ?? 0) > (grid[iGridMax] ?? 0)) iGridMax = i
      if ((grid[i] ?? 0) < (grid[iGridMin] ?? 0)) iGridMin = i
    }
    expect(plate[iGridMax] ?? 0).toBeLessThan(plate[iGridMin] ?? 0) // grid up ⇒ plate down
  })
})
