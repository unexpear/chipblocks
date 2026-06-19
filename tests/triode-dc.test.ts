/**
 * Triode (de Forest's Audion, 1906) — DC solver. The first AMPLIFIER: a small grid
 * voltage controls a large plate current. In a common-cathode amplifier (B+ → plate
 * load → plate, cathode grounded, grid biased), a small grid swing produces a large,
 * inverted plate-voltage swing — voltage gain. The gain approaches the amplification
 * factor μ, reduced by the plate load (A ≈ −μ·R_L/(R_L + r_p)).
 */

import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

// A 12AX7-class triode: μ = 100, calibrated at 250 V plate, −2 V grid, 1.2 mA plate.
const triodeParams = () => ({
  amplification_factor: scalar(100, 'dimensionless'),
  reference_plate_voltage: scalar(250, 'volt'),
  reference_grid_voltage: scalar(-2, 'volt'),
  plate_current_at_reference: scalar(0.0012, 'ampere'),
  max_plate_dissipation: scalar(1, 'watt'),
})

const supply = (volts: number) => ({
  nominal_voltage: scalar(volts, 'volt'),
  internal_resistance: scalar(0, 'ohm'),
})

/** Common-cathode amp: 300 V B+ → 100 kΩ plate load → plate; cathode grounded; grid
 *  held at gridVolts. Returns the solved plate voltage. */
function plateVoltage(gridVolts: number): number {
  const nodes: CanvasNode[] = [
    { id: 'bplus', definition: 'power_source', parameters: supply(300) },
    { id: 'rload', definition: 'resistor', parameters: { resistance: scalar(100000, 'ohm') } },
    { id: 'v1', definition: 'triode', parameters: triodeParams() },
    { id: 'vg', definition: 'power_source', parameters: supply(gridVolts) },
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
  const sol = solveDC(world)
  expect(sol.status).toBe('solved')
  const plateNet = world.instances.get('v1')?.connects?.find((c) => c.terminal === 'plate')?.net
  return sol.nodes.get(plateNet ?? '') ?? Number.NaN
}

describe('triode — the first amplifier', () => {
  test('biases into the active region (plate between cathode and B+)', () => {
    const vp = plateVoltage(-2)
    expect(vp).toBeGreaterThan(50) // conducting, dropping voltage across the load
    expect(vp).toBeLessThan(300) // but not cut off (would sit at the full B+)
  })

  test('a small grid swing makes a large, INVERTED plate swing — voltage gain', () => {
    const vpA = plateVoltage(-2.0)
    const vpB = plateVoltage(-1.9) // grid less negative → more plate current → lower plate V
    const gain = (vpB - vpA) / (-1.9 - -2.0)
    expect(gain).toBeLessThan(0) // inverting (grid up → plate down)
    expect(Math.abs(gain)).toBeGreaterThan(30) // genuine amplification — many times the input
    expect(Math.abs(gain)).toBeLessThan(100) // but below the open-circuit μ (loaded by R_L)
  })

  test('driving the grid more negative cuts the plate current off (toward B+)', () => {
    // Very negative grid → V_eff = V_g + V_p/μ goes negative → the tube stops conducting,
    // so the plate rises toward the full B+ (no drop across the load).
    expect(plateVoltage(-6)).toBeGreaterThan(plateVoltage(-2))
  })
})
