/**
 * Pentode — DC solver. The classic amplifying tube: a tetrode plus a suppressor grid
 * (tied to the cathode) that removes the tetrode kink, so it has a clean, flat plate
 * characteristic and high gain. In this idealized (kink-free) model it reuses the
 * screen-grid tube's physics; this test confirms it amplifies and stays flat, with the
 * suppressor wired to the cathode as in a real pentode.
 */

import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

const pentodeParams = () => ({
  screen_amplification_factor: scalar(25, 'dimensionless'),
  plate_amplification_factor: scalar(4000, 'dimensionless'),
  reference_plate_voltage: scalar(250, 'volt'),
  reference_grid_voltage: scalar(-2, 'volt'),
  reference_screen_voltage: scalar(140, 'volt'),
  plate_current_at_reference: scalar(0.003, 'ampere'),
  max_plate_dissipation: scalar(1, 'watt'),
})

const supply = (volts: number) => ({
  nominal_voltage: scalar(volts, 'volt'),
  internal_resistance: scalar(0, 'ohm'),
})

/** Common-cathode amp: 300 V B+ → load → plate; cathode grounded; control grid at g1V,
 *  screen at +140 V, SUPPRESSOR tied to the cathode (ground). */
function operatingPoint(g1Volts: number, loadOhms = 100000) {
  const nodes: CanvasNode[] = [
    { id: 'bplus', definition: 'power_source', parameters: supply(300) },
    { id: 'rload', definition: 'resistor', parameters: { resistance: scalar(loadOhms, 'ohm') } },
    { id: 'v1', definition: 'pentode', parameters: pentodeParams() },
    { id: 'vg1', definition: 'power_source', parameters: supply(g1Volts) },
    { id: 'vg2', definition: 'power_source', parameters: supply(140) },
    { id: 'gnd', definition: 'ground' },
  ]
  const g = (s: string, sh: string, t: string, th: string) => ({
    source: s,
    sourceHandle: sh,
    target: t,
    targetHandle: th,
  })
  const edges = [
    g('bplus', 'terminal_positive', 'rload', 'terminal_a'),
    g('rload', 'terminal_b', 'v1', 'plate'),
    g('v1', 'cathode', 'gnd', 'reference_terminal'),
    g('v1', 'suppressor_grid', 'gnd', 'reference_terminal'), // suppressor → cathode
    g('vg1', 'terminal_positive', 'v1', 'grid'),
    g('vg1', 'terminal_negative', 'gnd', 'reference_terminal'),
    g('vg2', 'terminal_positive', 'v1', 'screen_grid'),
    g('vg2', 'terminal_negative', 'gnd', 'reference_terminal'),
    g('bplus', 'terminal_negative', 'gnd', 'reference_terminal'),
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

describe('pentode', () => {
  test('biases into the active region and conducts (suppressor tied to the cathode)', () => {
    const { plateV, plateI } = operatingPoint(-3)
    expect(plateV).toBeGreaterThan(40)
    expect(plateV).toBeLessThan(300)
    expect(plateI).toBeGreaterThan(0.0005) // a real plate current (~1.8 mA)
  })

  test('FLAT plate characteristic — runs clean even with the plate below the screen', () => {
    const a = operatingPoint(-3, 80000)
    const b = operatingPoint(-3, 120000)
    expect(Math.abs(a.plateV - b.plateV)).toBeGreaterThan(40) // plate voltage moves a lot
    expect(Math.abs(a.plateI - b.plateI) / a.plateI).toBeLessThan(0.1) // current barely moves
  })

  test('high voltage gain, inverting (the amplifying tube)', () => {
    const a = operatingPoint(-3.0)
    const b = operatingPoint(-2.9)
    const gain = (b.plateV - a.plateV) / (-2.9 - -3.0)
    expect(gain).toBeLessThan(0)
    expect(Math.abs(gain)).toBeGreaterThan(80)
  })
})
