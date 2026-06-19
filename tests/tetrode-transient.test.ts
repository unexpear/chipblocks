/**
 * Tetrode (screen-grid tube) — transient solver. The same common-cathode amplifier as
 * the triode but with a screen grid: a small AC signal on the control grid comes out
 * the plate amplified and inverted. This exercises the tetrode's time-domain path
 * (resolve → 4-terminal companion stamp → per-step Newton → current recording).
 */

import { describe, expect, test } from 'vitest'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { solveTransient } from '../src/transient-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

const tetrodeParams = () => ({
  screen_amplification_factor: scalar(20, 'dimensionless'),
  plate_amplification_factor: scalar(2000, 'dimensionless'),
  reference_plate_voltage: scalar(250, 'volt'),
  reference_grid_voltage: scalar(-2, 'volt'),
  reference_screen_voltage: scalar(100, 'volt'),
  plate_current_at_reference: scalar(0.003, 'ampere'),
  max_plate_dissipation: scalar(2, 'watt'),
})

const dc = (volts: number) => ({
  nominal_voltage: scalar(volts, 'volt'),
  internal_resistance: scalar(0, 'ohm'),
})

function ampRig() {
  const nodes: CanvasNode[] = [
    { id: 'bplus', definition: 'power_source', parameters: dc(300) },
    { id: 'rload', definition: 'resistor', parameters: { resistance: scalar(100000, 'ohm') } },
    { id: 'v1', definition: 'tetrode', parameters: tetrodeParams() },
    {
      id: 'vg1',
      definition: 'power_source',
      parameters: {
        nominal_voltage: scalar(-3, 'volt'),
        ac_amplitude: scalar(0.1, 'volt'),
        frequency: scalar(1000, 'hertz'),
        internal_resistance: scalar(0, 'ohm'),
      },
    },
    { id: 'vg2', definition: 'power_source', parameters: dc(100) },
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
    { source: 'vg1', sourceHandle: 'terminal_positive', target: 'v1', targetHandle: 'grid' },
    {
      source: 'vg1',
      sourceHandle: 'terminal_negative',
      target: 'gnd',
      targetHandle: 'reference_terminal',
    },
    { source: 'vg2', sourceHandle: 'terminal_positive', target: 'v1', targetHandle: 'screen_grid' },
    {
      source: 'vg2',
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

describe('tetrode — transient (amplifier)', () => {
  test('a small grid signal makes a large, inverted plate signal', () => {
    const { world, plateNet, gridNet } = ampRig()
    const result = solveTransient(world, { timeStep: 2e-5, duration: 3e-3 })
    expect(result.status).toBe('solved')
    const plate = result.series.map((p) => p.nodes.get(plateNet) ?? 0)
    const grid = result.series.map((p) => p.nodes.get(gridNet) ?? 0)
    const pp = (a: number[]) => Math.max(...a) - Math.min(...a)
    expect(pp(grid)).toBeGreaterThan(0.15)
    expect(pp(plate) / pp(grid)).toBeGreaterThan(40) // amplified
    let iGridMax = 0
    let iGridMin = 0
    for (let i = 1; i < grid.length; i++) {
      if ((grid[i] ?? 0) > (grid[iGridMax] ?? 0)) iGridMax = i
      if ((grid[i] ?? 0) < (grid[iGridMin] ?? 0)) iGridMin = i
    }
    expect(plate[iGridMax] ?? 0).toBeLessThan(plate[iGridMin] ?? 0) // inverted
  })
})
