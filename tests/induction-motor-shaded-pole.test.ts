/**
 * The SHADED-POLE induction motor — the cheapest AC motor, a shorted copper ring instead of a
 * driven start winding. What must be true: the ring gives a small but genuinely NONZERO starting
 * torque (a pure single-phase machine makes exactly zero); that torque comes ENTIRELY from the
 * direct main↔shading coupling X13 (set X13 → 0 and it reverts to a zero-starting-torque
 * machine); the direction is FIXED (swapping the supply leads does not reverse it); the settled
 * march equals the phasor reading at every slip; on DC both engines see just the main winding R1;
 * a light (fan-type) load self-starts from rest. The machine is the AKO-16 (Šarac 2016).
 */

import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import { synchronousSpeedRadPerSec } from '../src/induction-motor-model.ts'
import {
  createShadedPoleMotor,
  type ShadedPoleMotorParams,
  shadedPoleCommitMotor,
  shadedPoleInductancesFromParams,
  shadedPoleInitMotor,
  shadedPoleOperatingPoint,
  shadedPoleStampMotor,
  shadedPoleSteadyStateAt,
} from '../src/induction-motor-shaded-pole.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { partReadings } from '../src/renderer/part-readings.ts'
import { solveTransient, type TransientResult } from '../src/transient-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const g = (s: string, sh: string, t: string, th: string) => ({
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
})

const PERIOD = 1 / 50

// The AKO-16 machine (Šarac & Atanasova-Pačemska 2016), referred to the main, Ω at 50 Hz.
const ako = (loadTorque = 0, viscousFriction = 0): ShadedPoleMotorParams => ({
  supplyVoltage: 220,
  frequency: 50,
  poles: 2,
  mainResistance: 492.98,
  mainReactance: 498.17,
  rotorResistance: 457.04,
  rotorReactance: 76.71,
  magnetizingReactance: 2163.3,
  shadingResistance: 18474,
  shadingReactance: 127.53,
  shadingMutualReactance: 175.91,
  loadTorque,
  viscousFriction,
})

const motorParameters = (loadTorque: number, overrides: Record<string, unknown> = {}) => ({
  supply_voltage: scalar(220, 'volt'),
  line_frequency: scalar(50, 'hertz'),
  pole_count: scalar(2, 'dimensionless'),
  main_resistance: scalar(492.98, 'ohm'),
  main_leakage_reactance: scalar(498.17, 'ohm'),
  rotor_resistance: scalar(457.04, 'ohm'),
  rotor_reactance: scalar(76.71, 'ohm'),
  magnetizing_reactance: scalar(2163.3, 'ohm'),
  shading_resistance: scalar(18474, 'ohm'),
  shading_leakage_reactance: scalar(127.53, 'ohm'),
  shading_mutual_reactance: scalar(175.91, 'ohm'),
  load_torque: scalar(loadTorque, 'N*m'),
  viscous_friction: scalar(1e-5, 'N*m*s/rad'),
  ...overrides,
})

const runTransient = (
  loadTorque: number,
  cycles: number,
  stepsPerCycle: number,
  overrides: Record<string, unknown> = {},
  dcVolts?: number,
) => {
  const nodes: CanvasNode[] = [
    {
      id: 'v1',
      definition: 'power_source',
      parameters: {
        nominal_voltage: scalar(dcVolts ?? 0, 'volt'),
        ac_amplitude: scalar(dcVolts !== undefined ? 0 : 220 * Math.SQRT2, 'volt'),
        frequency: scalar(50, 'hertz'),
        internal_resistance: scalar(0, 'ohm'),
      },
    },
    {
      id: 'm1',
      definition: 'induction_motor_shaded_pole',
      parameters: motorParameters(loadTorque, overrides),
    },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    g('v1', 'terminal_positive', 'm1', 'terminal_a'),
    g('m1', 'terminal_b', 'v1', 'terminal_negative'),
    g('v1', 'terminal_negative', 'gnd', 'reference_terminal'),
  ]
  const world = canvasToWorld(nodes, edges)
  const result = solveTransient(world, {
    timeStep: PERIOD / stepsPerCycle,
    duration: cycles * PERIOD,
  })
  return { world, result }
}

const rmsOver = (result: TransientResult, tStart: number, tEnd: number) => {
  let sum = 0
  let n = 0
  for (const p of result.series) {
    if (p.time < tStart - 1e-12 || p.time > tEnd + 1e-12) continue
    const i = p.currents?.get('m1/terminal_a') ?? 0
    sum += i * i
    n += 1
  }
  return Math.sqrt(sum / n)
}

/** March the machine open-loop at a FROZEN speed (start it there), return the mean torque and
 *  RMS port current over the last 10 cycles — the clean way to pin a settled operating point. */
const marchAtSpeed = (p: ShadedPoleMotorParams, omega: number, vSign = 1) => {
  const L = shadedPoleInductancesFromParams(p)
  if (L === null) throw new Error('null inductances')
  const core = createShadedPoleMotor(L, null, omega, PERIOD)
  core.omega = omega
  const v = (t: number) => vSign * 220 * Math.SQRT2 * Math.cos(2 * Math.PI * 50 * t)
  shadedPoleInitMotor(core, v(0))
  const h = PERIOD / 400
  const steps = 60 * 400
  let sumT = 0
  let sumI2 = 0
  let n = 0
  for (let k = 1; k <= steps; k++) {
    const t = k * h
    shadedPoleStampMotor(core, h)
    const i = shadedPoleCommitMotor(core, v(t), h)
    if (k > steps - 4000) {
      sumT += core.torque
      sumI2 += i * i
      n++
    }
  }
  return { torque: sumT / n, currentRms: Math.sqrt(sumI2 / n) }
}

describe('shaded-pole motor — the shorted ring makes a weak self-starting field', () => {
  test('the readings show a low-efficiency machine running below synchronous', () => {
    const op = shadedPoleOperatingPoint(ako(0.018))
    expect(op.synchronousRpm).toBeCloseTo(3000, 0) // 2-pole, 50 Hz
    expect(op.slip).toBeGreaterThan(0.05)
    expect(op.slip).toBeLessThan(0.3)
    expect(op.rotorRpm).toBeGreaterThan(2000)
    expect(op.currentRms).toBeGreaterThan(0.1)
    expect(op.currentRms).toBeLessThan(0.2) // AKO-16 ~0.126 A
    expect(op.efficiency).toBeGreaterThan(0.1)
    expect(op.efficiency).toBeLessThan(0.4) // low, as a shaded-pole motor is
    expect(op.stalled).toBe(false)
  })

  test('the standstill (starting) torque is small but genuinely NONZERO and positive', () => {
    const op = shadedPoleOperatingPoint(ako(0.018))
    expect(op.startingTorque).toBeGreaterThan(0) // the defining property — it self-starts
    // …and it is WEAK: a small fraction of the running torque (the shaded-pole signature).
    expect(op.startingTorque).toBeLessThan(0.05 * op.torque)
  })

  test('the machine reproduces its golden operating point — an absolute pin on the coupled model', () => {
    // Every coupling in the 4×4 inductance matrix (main↔shading Lm·cosγ, shading↔rotorβ
    // Lm·sinγ, the self terms) feeds these numbers, so an absolute pin on the standstill AND a
    // running-slip point catches any L-matrix regression that the internal-consistency
    // march-vs-phasor check cannot (both sides share the same matrix). Values from the verified
    // design prototype (AKO-16, 220 V, 50 Hz).
    const p = ako()
    const stand = shadedPoleSteadyStateAt(p, 1)
    const rated = shadedPoleSteadyStateAt(p, 0.16)
    expect(stand).not.toBeNull()
    expect(rated).not.toBeNull()
    if (stand === null || rated === null) throw new Error('unreachable')
    expect(stand.torque).toBeCloseTo(6.586e-5, 6) // the weak self-starting torque, exactly
    expect(rated.torque).toBeCloseTo(0.02082, 4) // torque at s = 0.16
    expect(rated.currentRms).toBeCloseTo(0.1334, 3) // AKO-16 line current ~0.126 A (paper)
  })

  test('the starting torque is ENTIRELY the direct main↔shading coupling — kill X13 and it is zero', () => {
    const withRing = shadedPoleOperatingPoint(ako(0.018))
    // With no direct coupling the machine is a pure single-phase motor: the resolver rejects
    // X13 = 0 (0 < X13 < Xm), so the readings return the stalled/zero point.
    const noRing = shadedPoleOperatingPoint({ ...ako(0.018), shadingMutualReactance: 0 })
    expect(withRing.startingTorque).toBeGreaterThan(0)
    expect(noRing.startingTorque).toBe(0)
    expect(noRing.stalled).toBe(true)
    // And a marched machine forced to exact quadrature (cos γ → 0 via X13 → tiny) makes ~zero
    // standstill torque, next to the real ring's nonzero one.
    const ringStand = marchAtSpeed(ako(), 0).torque
    const tinyRing = marchAtSpeed({ ...ako(), shadingMutualReactance: 1e-6 }, 0).torque
    expect(ringStand).toBeGreaterThan(0)
    expect(Math.abs(tinyRing)).toBeLessThan(0.05 * ringStand)
  })

  test('the direction is FIXED — reversing the supply leads does not reverse the torque', () => {
    // Torque is bilinear in the currents, so v → −v leaves it invariant: a shaded-pole motor
    // cannot be reversed electrically (only by re-shading the other pole side).
    const omega = 0.2 * synchronousSpeedRadPerSec(50, 2)
    const forward = marchAtSpeed(ako(), omega, +1).torque
    const reversed = marchAtSpeed(ako(), omega, -1).torque
    expect(Math.sign(forward)).toBe(Math.sign(reversed))
    expect(Math.abs(forward - reversed) / Math.abs(forward)).toBeLessThan(0.01)
  })

  test('the settled march equals the phasor reading at every slip', () => {
    const wSync = synchronousSpeedRadPerSec(50, 2)
    for (const slip of [0.05, 0.16, 0.5]) {
      const p = ako()
      const march = marchAtSpeed(p, (1 - slip) * wSync)
      const phasor = shadedPoleSteadyStateAt(p, slip)
      expect(phasor).not.toBeNull()
      if (phasor === null) throw new Error('unreachable')
      // The marched steady state reduces EXACTLY to the phasor solve of the same model.
      expect(Math.abs(march.torque - phasor.torque) / Math.abs(phasor.torque)).toBeLessThan(0.005)
      expect(Math.abs(march.currentRms - phasor.currentRms) / phasor.currentRms).toBeLessThan(0.005)
    }
  })

  test('a light fan-type load self-starts from rest and spins up', () => {
    const wSync = synchronousSpeedRadPerSec(50, 2)
    const p = ako()
    const L = shadedPoleInductancesFromParams(p)
    if (L === null) throw new Error('null')
    const start = shadedPoleOperatingPoint(p)
    // A load below the standstill torque breaks away and accelerates.
    const load = 0.5 * start.startingTorque
    const core = createShadedPoleMotor(
      L,
      { rotorInertia: 2e-6, viscousFriction: 2e-8, loadTorque: load },
      0,
      PERIOD,
    )
    const v = (t: number) => 220 * Math.SQRT2 * Math.cos(2 * Math.PI * 50 * t)
    shadedPoleInitMotor(core, v(0))
    const h = PERIOD / 200
    const steps = Math.round(2 / h)
    for (let k = 1; k <= steps; k++) {
      const t = k * h
      shadedPoleStampMotor(core, h)
      shadedPoleCommitMotor(core, v(t), h)
    }
    expect(core.omega).toBeGreaterThan(0.5 * wSync) // it genuinely came up to speed
  })
})

describe('shaded-pole motor — in the full solver', () => {
  test('DC parity: both engines see exactly the main resistance R1 (the ring carries no DC)', () => {
    const { world, result } = runTransient(0.018, 50, 40, {}, 12)
    expect(result.status).toBe('solved')
    const iFinal = Math.abs(result.series.at(-1)?.currents?.get('m1/terminal_a') ?? 0)
    expect(Math.abs(iFinal - 12 / 492.98) / (12 / 492.98)).toBeLessThan(0.02)
    const dc = solveDC(world)
    expect(dc.status).toBe('solved')
    expect(Math.abs(dc.branches.get('m1') ?? 0)).toBeCloseTo(12 / 492.98, 5)
  })

  test('the live readings report slip, speed, torque, current, efficiency from a DC solve', () => {
    const { world } = runTransient(0.018, 1, 40)
    const sol = solveDC(world)
    const reading = partReadings(world, sol).get('m1')
    expect(reading?.speedRpm ?? 0).toBeGreaterThan(2000)
    expect(reading?.speedRpm ?? 0).toBeLessThan(3000)
    expect(reading?.slipPercent ?? 0).toBeGreaterThan(0)
    expect(reading?.torqueNm ?? 0).toBeGreaterThan(0)
    expect(reading?.efficiencyPercent ?? 0).toBeGreaterThan(0)
    expect(reading?.efficiencyPercent ?? 0).toBeLessThan(40)
  })

  test('an incomplete / non-physical machine is skipped by name (0 < X13 < Xm required)', () => {
    // X13 above the magnetizing reactance is unphysical (cos γ > 1) — skipped, not solved wrong.
    const bad = runTransient(0.018, 2, 40, { shading_mutual_reactance: scalar(3000, 'ohm') })
    expect(
      bad.result.warnings.some((w) => w.includes("Skipped shaded-pole induction motor 'm1'")),
    ).toBe(true)
  })

  test('a SINGULAR inductance matrix is skipped by name, not marched with finite-but-wrong physics', () => {
    // Zero main AND rotor leakage makes the 4×4 L singular (the main and rotor-α rows coincide):
    // the residual check must reject it, so the machine is skipped rather than solved wrong.
    const singular = runTransient(0.018, 2, 40, {
      main_leakage_reactance: scalar(0, 'ohm'),
      rotor_reactance: scalar(0, 'ohm'),
    })
    expect(
      singular.result.warnings.some((w) => w.includes("Skipped shaded-pole induction motor 'm1'")),
    ).toBe(true)
    // The readings likewise refuse it (null inductances → the stalled/zero point).
    expect(
      shadedPoleInductancesFromParams({
        ...ako(0.018),
        mainReactance: 0,
        rotorReactance: 0,
      }),
    ).toBeNull()
  })

  test('AC drive: the machine draws a real current at its running point', () => {
    // No rotor_inertia → quasi-static, held at the nameplate operating speed; the readings and
    // the marched current agree at the running point.
    const { result } = runTransient(0.018, 30, 100)
    expect(result.status).toBe('solved')
    const op = shadedPoleOperatingPoint(ako(0.018))
    const tEnd = result.series.at(-1)?.time ?? 0
    const iRms = rmsOver(result, tEnd - 2 * PERIOD, tEnd)
    expect(Math.abs(iRms - op.currentRms) / op.currentRms).toBeLessThan(0.05)
    // …and it is quasi-static (no rotor_inertia) — the solver says so.
    expect(result.warnings.some((w) => w.includes('no rotor_inertia'))).toBe(true)
  })
})
