/**
 * Electromagnet — a coil whose magnetic field is the point. Electrically it is an
 * inductor (it reuses the inductor solver in DC, transient, and AC); what's new is the
 * surfaced field. This checks the field math (with iron saturation), the inductance
 * DERIVED from the coil geometry (one source of truth with the field), the holding pull
 * F = B²·A/2μ₀, the live readings from a DC solve, and the current ramp on L/R.
 */

import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import {
  coilInductanceHenries,
  MU_0,
  magneticPullForceNewtons,
  magnetomotiveForceAmpereTurns,
  solenoidFluxDensityTesla,
} from '../src/electromagnet-model.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { partReadings } from '../src/renderer/part-readings.ts'
import { solveTransient } from '../src/transient-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

const coilParams = () => ({
  turns: scalar(500, 'dimensionless'),
  relative_permeability: scalar(1000, 'dimensionless'),
  magnetic_path_length: scalar(0.08, 'metre'),
  core_area: scalar(2.5e-5, 'm^2'),
  saturation_flux_density: scalar(2.0, 'tesla'),
  winding_resistance: scalar(40, 'ohm'),
})

const supply = (volts: number, ri = 0) => ({
  nominal_voltage: scalar(volts, 'volt'),
  internal_resistance: scalar(ri, 'ohm'),
})

const g = (s: string, sh: string, t: string, th: string) => ({
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
})

describe('electromagnet — field math', () => {
  test('magnetomotive force is N times the current (ampere-turns), always positive', () => {
    expect(magnetomotiveForceAmpereTurns(500, 0.2)).toBeCloseTo(100, 9)
    expect(magnetomotiveForceAmpereTurns(500, -0.2)).toBeCloseTo(100, 9)
  })

  test('the cored solenoid field follows B = μ₀·μ_r·N·I/l, and the iron core multiplies it', () => {
    const b = solenoidFluxDensityTesla(500, 0.2, 1000, 0.08) // no B_sat → pure linear
    expect(b).toBeCloseTo((MU_0 * 1000 * 500 * 0.2) / 0.08, 12)
    // an iron core (μ_r = 1000) makes a field 1000× a bare air core (μ_r = 1)
    expect(b).toBeCloseTo(1000 * solenoidFluxDensityTesla(500, 0.2, 1, 0.08), 12)
  })

  test('iron saturation rolls the field off toward B_sat (tanh), below the linear value', () => {
    const linear = solenoidFluxDensityTesla(500, 0.2, 1000, 0.08)
    const saturated = solenoidFluxDensityTesla(500, 0.2, 1000, 0.08, 2.0)
    expect(saturated).toBeLessThan(linear) // saturation pulls it down
    expect(saturated).toBeCloseTo(2.0 * Math.tanh(linear / 2.0), 12)
    // push 5× the current — B approaches but does not pass B_sat (the tanh asymptote)
    const hard = solenoidFluxDensityTesla(500, 1, 1000, 0.08, 2.0)
    expect(hard).toBeGreaterThan(1.95)
    expect(hard).toBeLessThan(2.0)
  })

  test('inductance is DERIVED from the coil geometry, L = μ₀·μ_r·N²·A/l', () => {
    const l = coilInductanceHenries(500, 1000, 2.5e-5, 0.08)
    expect(l).toBeCloseTo((MU_0 * 1000 * 500 * 500 * 2.5e-5) / 0.08, 15)
    expect(l).toBeCloseTo(0.0982, 3) // ~98 mH for this small iron-core coil
  })

  test('the holding pull is F = B²·A / 2μ₀ (Maxwell stress, ∝ B²)', () => {
    expect(magneticPullForceNewtons(1.5, 2.5e-5)).toBeCloseTo((1.5 * 1.5 * 2.5e-5) / (2 * MU_0), 9)
    // doubling the field quadruples the force
    expect(magneticPullForceNewtons(2, 2.5e-5)).toBeCloseTo(
      4 * magneticPullForceNewtons(1, 2.5e-5),
      9,
    )
  })

  test('zero geometry is guarded (no divide-by-zero)', () => {
    expect(solenoidFluxDensityTesla(500, 0.2, 1000, 0)).toBe(0)
    expect(coilInductanceHenries(500, 1000, 2.5e-5, 0)).toBe(0)
    expect(magneticPullForceNewtons(1.5, 0)).toBe(0)
  })
})

describe('electromagnet — DC solve + live readings', () => {
  test('a powered coil reports its current, ampere-turns, (saturated) core field, and pull', () => {
    const nodes: CanvasNode[] = [
      { id: 'v1', definition: 'power_source', parameters: supply(8) },
      { id: 'm1', definition: 'electromagnet', parameters: coilParams() },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      g('v1', 'terminal_positive', 'm1', 'terminal_a'),
      g('m1', 'terminal_b', 'gnd', 'reference_terminal'),
      g('v1', 'terminal_negative', 'gnd', 'reference_terminal'),
    ]
    const world = canvasToWorld(nodes, edges)
    const sol = solveDC(world)
    expect(sol.status).toBe('solved')

    const reading = partReadings(world, sol).get('m1')
    // 8 V across the 40 Ω winding → 0.2 A (a coil conducts DC through its winding R).
    expect(reading?.current).toBeCloseTo(0.2, 4)
    expect(reading?.magnetomotiveForceA).toBeCloseTo(100, 3) // 500 turns × 0.2 A

    const i = reading?.current ?? 0
    const expectedB = solenoidFluxDensityTesla(500, i, 1000, 0.08, 2.0)
    expect(reading?.magneticFluxDensityT).toBeCloseTo(expectedB, 9)
    // saturated: below the 2 T core limit, but below the linear value too
    expect(reading?.magneticFluxDensityT ?? 0).toBeLessThan(2.0)
    expect(reading?.magneticFluxDensityT ?? 0).toBeLessThan(
      solenoidFluxDensityTesla(500, i, 1000, 0.08),
    )
    expect(reading?.magneticFluxDensityT ?? 0).toBeGreaterThan(1) // still a strong field

    const expectedF = magneticPullForceNewtons(expectedB, 2.5e-5)
    expect(reading?.magneticForceN).toBeCloseTo(expectedF, 6)
    expect(reading?.magneticForceN ?? 0).toBeGreaterThan(10) // a real, kg-scale pull
  })
})

describe('electromagnet — transient', () => {
  test('the coil current ramps up on L/R, it cannot jump (inductor behaviour)', () => {
    // 8 V, 10 Ω sense + 40 Ω winding → settles to 0.16 A; L is derived (~98 mH) → τ ≈ 2 ms.
    const nodes: CanvasNode[] = [
      { id: 'v1', definition: 'power_source', parameters: supply(8) },
      { id: 'rs', definition: 'resistor', parameters: { resistance: scalar(10, 'ohm') } },
      { id: 'm1', definition: 'electromagnet', parameters: coilParams() },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      g('v1', 'terminal_positive', 'rs', 'terminal_a'),
      g('rs', 'terminal_b', 'm1', 'terminal_a'),
      g('m1', 'terminal_b', 'gnd', 'reference_terminal'),
      g('v1', 'terminal_negative', 'gnd', 'reference_terminal'),
    ]
    const world = canvasToWorld(nodes, edges)
    const senseNet = world.instances
      .get('m1')
      ?.connects?.find((c) => c.terminal === 'terminal_a')?.net
    const result = solveTransient(world, { timeStep: 5e-4, duration: 1.5e-2 })
    expect(result.status).toBe('solved')
    // Current = (8 − V_node) / 10 across the sense resistor.
    const current = result.series.map((p) => (8 - (p.nodes.get(senseNet ?? '') ?? 0)) / 10)
    const first = current[0] ?? 0
    const last = current[current.length - 1] ?? 0
    expect(first).toBeLessThan(0.05) // starts near zero — current can't jump
    expect(last).toBeGreaterThan(first) // ramps up
    expect(last).toBeCloseTo(0.16, 2) // settles to V / (R_sense + R_winding)
  })
})
