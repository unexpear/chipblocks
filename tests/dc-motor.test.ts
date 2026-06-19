/**
 * Brushed DC motor — the electromechanical model. Electrically it is a winding (R_a, L_a)
 * with a speed-dependent back-EMF; mechanically the current makes a torque that spins the
 * rotor. This checks the steady-state operating point (no-load, loaded, stall), the live
 * readings from a DC solve, and the transient SPIN-UP (the inrush current tapering as the
 * back-EMF rises).
 */

import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import { type MotorParams, motorEffectiveResistance, motorSteadyState } from '../src/motor-model.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { partReadings } from '../src/renderer/part-readings.ts'
import { solveTransient } from '../src/transient-solver.ts'

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
