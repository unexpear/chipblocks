/**
 * AC induction motor tests — Tesla's rotating-field machine, the per-phase equivalent circuit
 * (Steinmetz). Checks the synchronous speed, the torque-slip curve (zero at synchronous, rising
 * with slip), the operating point under load (running just below synchronous, developing ≈ the load
 * torque, sensible efficiency + power factor), the big locked-rotor starting current, the no-load
 * near-synchronous run, the stall beyond breakdown torque, and the live readings from a solve.
 */

import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import {
  electromagneticTorque,
  type InductionMotorParams,
  inductionMotorOperatingPoint,
  synchronousSpeedRadPerSec,
} from '../src/induction-motor-model.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { partReadings } from '../src/renderer/part-readings.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const g = (s: string, sh: string, t: string, th: string) => ({
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
})

// The shipped ~4 kW 4-pole 230 V (per-phase) 50 Hz defaults.
const imParams = (loadTorque = 20, viscousFriction = 0.002): InductionMotorParams => ({
  supplyVoltage: 230,
  frequency: 50,
  poles: 4,
  statorResistance: 2,
  statorReactance: 4,
  rotorResistance: 2,
  rotorReactance: 4,
  magnetizingReactance: 80,
  loadTorque,
  viscousFriction,
})

describe('induction motor — rotating field + per-phase equivalent circuit', () => {
  test('synchronous speed is 120·f/poles (1500 RPM for a 4-pole 50 Hz machine)', () => {
    expect(synchronousSpeedRadPerSec(50, 4)).toBeCloseTo((4 * Math.PI * 50) / 4, 6)
    expect((synchronousSpeedRadPerSec(50, 4) * 60) / (2 * Math.PI)).toBeCloseTo(1500, 6)
  })

  test('torque is zero at synchronous speed and rises with slip on the stable branch', () => {
    expect(electromagneticTorque(0, imParams())).toBe(0) // s = 0 → no relative motion → no torque
    expect(electromagneticTorque(0.08, imParams())).toBeGreaterThan(
      electromagneticTorque(0.02, imParams()),
    )
  })

  test('under load it runs just below synchronous, developing ≈ the load torque', () => {
    const op = inductionMotorOperatingPoint(imParams(20))
    expect(op.synchronousRpm).toBeCloseTo(1500, 0)
    expect(op.slip).toBeGreaterThan(0)
    expect(op.slip).toBeLessThan(0.15)
    expect(op.rotorRpm).toBeGreaterThan(1300)
    expect(op.rotorRpm).toBeLessThan(1500)
    expect(op.torque).toBeGreaterThan(19.5) // balances the 20 N·m load (+ a little friction)
    expect(op.torque).toBeLessThan(21)
    expect(op.stalled).toBe(false)
    expect(op.efficiency).toBeGreaterThan(0.7)
    expect(op.efficiency).toBeLessThan(0.97)
    expect(op.powerFactor).toBeGreaterThan(0.6)
    expect(op.powerFactor).toBeLessThan(0.95)
  })

  test('the locked-rotor (starting) current is several times the running current', () => {
    const op = inductionMotorOperatingPoint(imParams(20))
    expect(op.startupCurrentRms).toBeGreaterThan(3 * op.statorCurrentRms)
  })

  test('with no load it runs essentially at synchronous speed', () => {
    const op = inductionMotorOperatingPoint(imParams(0, 0))
    expect(op.slip).toBeLessThan(0.001)
    expect(op.rotorRpm).toBeCloseTo(1500, 0)
  })

  test('a load beyond the breakdown torque stalls it (locked rotor)', () => {
    const op = inductionMotorOperatingPoint(imParams(500))
    expect(op.stalled).toBe(true)
    expect(op.slip).toBeCloseTo(1, 6)
  })
})

describe('induction motor — DC solve + live readings', () => {
  test('a placed motor reports slip, speed, torque, running + startup current, efficiency, power factor', () => {
    const nodes: CanvasNode[] = [
      {
        id: 'v1',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(230, 'volt') },
      },
      {
        id: 'im1',
        definition: 'induction_motor',
        parameters: {
          supply_voltage: scalar(230, 'volt'),
          line_frequency: scalar(50, 'hertz'),
          pole_count: scalar(4, 'dimensionless'),
          stator_resistance: scalar(2, 'ohm'),
          stator_reactance: scalar(4, 'ohm'),
          rotor_resistance: scalar(2, 'ohm'),
          rotor_reactance: scalar(4, 'ohm'),
          magnetizing_reactance: scalar(80, 'ohm'),
          load_torque: scalar(20, 'N*m'),
          viscous_friction: scalar(0.002, 'N*m*s/rad'),
        },
      },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      g('v1', 'terminal_positive', 'im1', 'terminal_a'),
      g('im1', 'terminal_b', 'gnd', 'reference_terminal'),
      g('v1', 'terminal_negative', 'gnd', 'reference_terminal'),
    ]
    const world = canvasToWorld(nodes, edges)
    const sol = solveDC(world)
    expect(sol.status).toBe('solved')
    const reading = partReadings(world, sol).get('im1')
    expect(reading?.speedRpm ?? 0).toBeGreaterThan(1300)
    expect(reading?.speedRpm ?? 0).toBeLessThan(1500)
    expect(reading?.slipPercent ?? 0).toBeGreaterThan(0)
    expect(reading?.torqueNm ?? 0).toBeGreaterThan(19)
    expect((reading?.startupCurrentA ?? 0) > (reading?.current ?? 1e9)).toBe(true)
    expect(reading?.powerFactor ?? 0).toBeGreaterThan(0.5)
  })
})
