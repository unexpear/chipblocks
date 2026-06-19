/**
 * Tetrode (screen-grid tube) — DC solver. A second grid (the screen), held positive,
 * shields the control grid from the plate. Two consequences the test checks:
 *  1. a FLAT plate characteristic — the plate current barely changes when the plate
 *     voltage changes (a near-constant-current device, very high plate resistance r_p);
 *  2. higher voltage GAIN than a triode for the same load (because r_p ≫ R_load, so the
 *     gain ≈ g_m·R_load instead of being pulled down by a low r_p).
 */

import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'

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

const supply = (volts: number) => ({
  nominal_voltage: scalar(volts, 'volt'),
  internal_resistance: scalar(0, 'ohm'),
})

/** Common-cathode amp: 300 V B+ → load → plate; cathode grounded; control grid at g1V,
 *  screen grid at +100 V. Returns the solved plate voltage and plate current. */
function operatingPoint(g1Volts: number, loadOhms = 100000) {
  const nodes: CanvasNode[] = [
    { id: 'bplus', definition: 'power_source', parameters: supply(300) },
    { id: 'rload', definition: 'resistor', parameters: { resistance: scalar(loadOhms, 'ohm') } },
    { id: 'v1', definition: 'tetrode', parameters: tetrodeParams() },
    { id: 'vg1', definition: 'power_source', parameters: supply(g1Volts) },
    { id: 'vg2', definition: 'power_source', parameters: supply(100) },
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
  const sol = solveDC(world)
  expect(sol.status).toBe('solved')
  const plateNet = world.instances.get('v1')?.connects?.find((c) => c.terminal === 'plate')?.net
  return {
    plateV: sol.nodes.get(plateNet ?? '') ?? Number.NaN,
    plateI: Math.abs(sol.branches.get('v1') ?? 0),
  }
}

describe('tetrode — screen grid', () => {
  test('biases into the active region above the screen voltage', () => {
    const { plateV } = operatingPoint(-3)
    expect(plateV).toBeGreaterThan(100) // above the +100 V screen (the useful flat region)
    expect(plateV).toBeLessThan(300) // conducting (dropping voltage across the load)
  })

  test('FLAT plate characteristic: the plate current barely changes when the load (and plate voltage) does', () => {
    const a = operatingPoint(-3, 80000)
    const b = operatingPoint(-3, 120000)
    // the plate voltage moves a lot between the two loads...
    expect(Math.abs(a.plateV - b.plateV)).toBeGreaterThan(40)
    // ...but the plate current barely moves — the near-constant-current tetrode behaviour
    expect(Math.abs(a.plateI - b.plateI) / a.plateI).toBeLessThan(0.1)
  })

  test('amplifies harder than a triode would on the same load (high r_p)', () => {
    const a = operatingPoint(-3.0)
    const b = operatingPoint(-2.9) // grid less negative → more current → lower plate V
    const gain = (b.plateV - a.plateV) / (-2.9 - -3.0)
    expect(gain).toBeLessThan(0) // inverting
    expect(Math.abs(gain)).toBeGreaterThan(80) // higher than the triode amp's ~75 (screen-grid gain)
  })
})
