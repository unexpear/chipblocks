/**
 * Brushed DC motor — the electromechanical model. Electrically it is a winding (R_a, L_a)
 * with a speed-dependent back-EMF; mechanically the current makes a torque that spins the
 * rotor. This checks the steady-state operating point (no-load, loaded, stall), the live
 * readings from a DC solve, and the transient SPIN-UP (the inrush current tapering as the
 * back-EMF rises).
 */

import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import {
  airGapFluxDensityTesla,
  armatureResistanceFromDesign,
  type MotorParams,
  motorConstantFromDesign,
  motorEffectiveResistance,
  motorSteadyState,
  rotorInertiaFromDesign,
} from '../src/motor-model.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { partReadings } from '../src/renderer/part-readings.ts'
import { solveTransient } from '../src/transient-solver.ts'
import { awgAreaM2 } from '../src/wire-gauge.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

// The shipped small-motor defaults: R_a 2 Ω, k 0.02 V·s/rad, B 5e-6, L_a 1 mH, J 1e-5.
const motorParams = (loadTorque = 0): MotorParams => ({
  armatureResistance: 2,
  motorConstant: 0.02,
  viscousFriction: 5e-6,
  loadTorque,
})

const motorNode = (loadTorque = 0) => ({
  armature_resistance: scalar(2, 'ohm'),
  motor_constant: scalar(0.02, 'V*s/rad'),
  viscous_friction: scalar(5e-6, 'N*m*s/rad'),
  armature_inductance: scalar(1e-3, 'henry'),
  rotor_inertia: scalar(1e-5, 'kg*m^2'),
  load_torque: scalar(loadTorque, 'N*m'),
})

const supply = (volts: number) => ({
  nominal_voltage: scalar(volts, 'volt'),
  internal_resistance: scalar(0, 'ohm'),
})

const g = (s: string, sh: string, t: string, th: string) => ({
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
})

describe('DC motor — steady-state model', () => {
  test('the back-EMF raises the effective resistance well above the bare winding', () => {
    // R_eff = R_a + k²/B = 2 + 0.0004/5e-6 = 82 Ω, far above the 2 Ω winding.
    expect(motorEffectiveResistance(motorParams())).toBeCloseTo(82, 6)
  })

  test('free-running: spins near no-load speed, draws far less than the stall current', () => {
    const op = motorSteadyState(12, motorParams())
    expect(op.current).toBeCloseTo(12 / 82, 6) // ~0.146 A, not the 6 A stall current
    expect(op.backEmf).toBeGreaterThan(11) // back-EMF nearly cancels the 12 V supply
    expect(op.backEmf).toBeLessThan(12)
    expect((op.speed * 60) / (2 * Math.PI)).toBeGreaterThan(5000) // thousands of RPM
  })

  test('a shaft load slows it down and makes it draw more current', () => {
    const free = motorSteadyState(12, motorParams(0))
    const loaded = motorSteadyState(12, motorParams(0.05))
    expect(loaded.current).toBeGreaterThan(free.current) // more torque needs more current
    expect(loaded.speed).toBeLessThan(free.speed) // and it slows down
  })

  test('at the stall torque k·V/R_a the speed is zero and it draws the full stall current', () => {
    const stalled = motorSteadyState(12, motorParams(0.12)) // 0.12 = k·V/R_a
    expect(stalled.speed).toBeCloseTo(0, 4)
    expect(stalled.current).toBeCloseTo(6, 4) // V / R_a = 12 / 2
  })
})

describe('DC motor — DC solve + live readings', () => {
  test('a powered motor reports current, speed, torque, back-EMF, efficiency', () => {
    const nodes: CanvasNode[] = [
      { id: 'v1', definition: 'power_source', parameters: supply(12) },
      { id: 'm1', definition: 'dc_motor', parameters: motorNode() },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      g('v1', 'terminal_positive', 'm1', 'terminal_positive'),
      g('m1', 'terminal_negative', 'gnd', 'reference_terminal'),
      g('v1', 'terminal_negative', 'gnd', 'reference_terminal'),
    ]
    const world = canvasToWorld(nodes, edges)
    const sol = solveDC(world)
    expect(sol.status).toBe('solved')

    const reading = partReadings(world, sol).get('m1')
    expect(reading?.current).toBeCloseTo(12 / 82, 4)
    expect(reading?.speedRpm ?? 0).toBeGreaterThan(5000)
    expect(reading?.backEmfV ?? 0).toBeGreaterThan(11)
    expect(reading?.torqueNm ?? 0).toBeGreaterThan(0)
    expect(reading?.efficiencyPercent ?? -1).toBeGreaterThanOrEqual(0)
    expect(reading?.efficiencyPercent ?? 101).toBeLessThanOrEqual(100)
  })
})

describe('DC motor — transient spin-up', () => {
  test('the current rushes in at switch-on, then tapers as the rotor comes up to speed', () => {
    const nodes: CanvasNode[] = [
      { id: 'v1', definition: 'power_source', parameters: supply(12) },
      { id: 'm1', definition: 'dc_motor', parameters: motorNode() },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      g('v1', 'terminal_positive', 'm1', 'terminal_positive'),
      g('m1', 'terminal_negative', 'gnd', 'reference_terminal'),
      g('v1', 'terminal_negative', 'gnd', 'reference_terminal'),
    ]
    const world = canvasToWorld(nodes, edges)
    const result = solveTransient(world, { timeStep: 1e-4, duration: 0.25 })
    expect(result.status).toBe('solved')

    const current = result.series.map((p) => Math.abs(p.currents?.get('m1/terminal_positive') ?? 0))
    const peak = Math.max(...current)
    const settled = current[current.length - 1] ?? 0
    expect(current[0] ?? 0).toBeLessThan(0.5) // starts near zero — the armature inductance
    expect(peak).toBeGreaterThan(1) // inrush, climbing toward the stall current
    expect(settled).toBeLessThan(0.5) // then tapers right down
    expect(peak / Math.max(settled, 1e-9)).toBeGreaterThan(5) // a clear spin-up signature
    expect(settled).toBeCloseTo(12 / 82, 1) // settles to the DC no-load operating point
  })
})

const designParams = (overrides: Record<string, { value?: unknown; ref?: string }> = {}) => ({
  design_mode: { value: 'design' },
  winding_turns: scalar(500, 'dimensionless'),
  wire_gauge: scalar(21, 'dimensionless'),
  magnet_remanence: scalar(0.4, 'tesla'),
  core_relative_permeability: scalar(2000, 'dimensionless'),
  magnet_length: scalar(0.005, 'meter'),
  air_gap: scalar(0.0008, 'meter'),
  rotor_diameter: scalar(0.022, 'meter'),
  stack_length: scalar(0.025, 'meter'),
  rotor_density: scalar(7800, 'kilogram/meter^3'),
  viscous_friction: scalar(5e-6, 'N*m*s/rad'),
  armature_inductance: scalar(1e-3, 'henry'),
  load_torque: scalar(0, 'N*m'),
  ...overrides,
})

function solveDesignMotor(parameters: Record<string, { value?: unknown; ref?: string }>) {
  const nodes: CanvasNode[] = [
    { id: 'v1', definition: 'power_source', parameters: supply(12) },
    { id: 'm1', definition: 'dc_motor', parameters },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    g('v1', 'terminal_positive', 'm1', 'terminal_positive'),
    g('m1', 'terminal_negative', 'gnd', 'reference_terminal'),
    g('v1', 'terminal_negative', 'gnd', 'reference_terminal'),
  ]
  const world = canvasToWorld(nodes, edges)
  const sol = solveDC(world)
  expect(sol.status).toBe('solved')
  return partReadings(world, sol).get('m1')
}

describe('DC motor — design it (derived from the assembly)', () => {
  test('air-gap field: a thicker magnet, smaller gap, or better core all raise B_gap', () => {
    const base = airGapFluxDensityTesla(0.4, 0.005, 0.0008, 2000)
    expect(base).toBeGreaterThan(0.2)
    expect(base).toBeLessThan(0.4) // the gap + core cut it below the magnet's remanence
    expect(airGapFluxDensityTesla(0.4, 0.01, 0.0008, 2000)).toBeGreaterThan(base) // thicker magnet
    expect(airGapFluxDensityTesla(0.4, 0.005, 0.0004, 2000)).toBeGreaterThan(base) // smaller gap
    expect(airGapFluxDensityTesla(0.4, 0.005, 0.0008, 50)).toBeLessThan(base) // poorer core
    expect(airGapFluxDensityTesla(0.4, 0.005, 0.0008, 1)).toBeLessThan(0.05) // an air core ~ nothing
  })

  test('k = factor·N·B·D·L — linear in turns, field and rotor size', () => {
    const k = motorConstantFromDesign(500, 0.336, 0.022, 0.025)
    expect(motorConstantFromDesign(1000, 0.336, 0.022, 0.025)).toBeCloseTo(2 * k, 9) // 2× turns
    expect(motorConstantFromDesign(500, 0.672, 0.022, 0.025)).toBeCloseTo(2 * k, 9) // 2× field
    expect(motorConstantFromDesign(500, 0.336, 0.044, 0.025)).toBeCloseTo(2 * k, 9) // 2× diameter
  })

  test('R_a follows the wire law — more turns or thinner wire raise it', () => {
    const r = armatureResistanceFromDesign(500, 0.022, 0.025, awgAreaM2(21))
    expect(r).toBeGreaterThan(1)
    expect(r).toBeLessThan(3) // ~1.9 Ω for the shipped design
    expect(armatureResistanceFromDesign(1000, 0.022, 0.025, awgAreaM2(21))).toBeCloseTo(2 * r, 9)
    expect(armatureResistanceFromDesign(500, 0.022, 0.025, awgAreaM2(24))).toBeGreaterThan(r) // thinner
  })

  test('rotor inertia J = ½·m·r², rises steeply with diameter', () => {
    const j = rotorInertiaFromDesign(0.022, 0.025, 7800)
    expect(j).toBeGreaterThan(0)
    expect(rotorInertiaFromDesign(0.044, 0.025, 7800)).toBeCloseTo(16 * j, 12) // 2× D → r⁴ = 16×
    expect(rotorInertiaFromDesign(0.022, 0.05, 7800)).toBeCloseTo(2 * j, 12) // 2× length
  })

  test('the default design reproduces the lumped motor (k ≈ 0.02, R_a ≈ 2)', () => {
    const reading = solveDesignMotor(designParams())
    expect(reading?.current).toBeGreaterThan(0.1)
    expect(reading?.current).toBeLessThan(0.25)
    expect(reading?.speedRpm ?? 0).toBeGreaterThan(4500)
  })

  test('stronger magnets raise k → it spins slower and draws less', () => {
    const ferrite = solveDesignMotor(designParams())
    const neodymium = solveDesignMotor(designParams({ magnet_remanence: scalar(1.2, 'tesla') }))
    expect(neodymium?.speedRpm ?? 0).toBeLessThan(ferrite?.speedRpm ?? 1)
    expect(neodymium?.current ?? 1).toBeLessThan(ferrite?.current ?? 0)
  })

  test('block mode ignores the design params — its direct k/R_a win', () => {
    const blockWithDesign = {
      ...motorNode(),
      design_mode: { value: 'block' },
      winding_turns: scalar(99999, 'dimensionless'),
      magnet_remanence: scalar(5, 'tesla'),
    }
    const reading = solveDesignMotor(blockWithDesign)
    expect(reading?.current).toBeCloseTo(12 / 82, 3) // the lumped 0.146 A, not derived from 99999 turns
  })
})
