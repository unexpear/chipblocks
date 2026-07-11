/**
 * The SINGLE-PHASE induction motor — double-revolving-field physics with the real starting
 * mechanism. What must be true: a lone winding makes ZERO starting torque (kill the start
 * winding and the machine honestly cannot start, named by the solver); the auxiliary winding's
 * out-of-step current makes a rotating field that starts it, and a capacitor phases it better
 * than thin wire alone; the centrifugal switch drops the start winding at speed and the machine
 * settles near the double-field phasor analysis (slightly above it on a light rotor — the REAL
 * 2f torque ripple wobbles the speed, which the constant-speed phasor cannot see); on DC both
 * engines see the main winding (parallel the aux on split-phase; a start cap blocks it).
 * The machine is Krause's classic ¼-hp 110 V 60 Hz split-phase example.
 */

import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import {
  createSpMotor,
  type SinglePhaseMotorParams,
  singlePhaseOperatingPoint,
  spCommitMotor,
  spInductancesFromParams,
  spStampMotor,
} from '../src/induction-motor-single-phase.ts'
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

const PERIOD = 1 / 60
const INERTIA = 2.92e-3 // Krause's ¼-hp rotor

// Krause's ¼-hp 110 V 60 Hz split-phase machine (main / rotor-referred-to-main / aux).
const spParams = (loadTorque = 1): SinglePhaseMotorParams => ({
  supplyVoltage: 110,
  frequency: 60,
  poles: 4,
  mainResistance: 2.02,
  mainReactance: 2.79,
  rotorResistance: 4.12,
  rotorReactance: 2.11,
  magnetizingReactance: 66.8,
  auxResistance: 7.14,
  auxReactance: 3.2,
  auxTurnsRatio: 1.18,
  switchOpenFraction: 0.75,
  loadTorque,
  viscousFriction: 0.0005,
})

const motorParameters = (loadTorque: number, overrides: Record<string, unknown> = {}) => ({
  supply_voltage: scalar(110, 'volt'),
  line_frequency: scalar(60, 'hertz'),
  pole_count: scalar(4, 'dimensionless'),
  main_resistance: scalar(2.02, 'ohm'),
  main_leakage_reactance: scalar(2.79, 'ohm'),
  rotor_resistance: scalar(4.12, 'ohm'),
  rotor_reactance: scalar(2.11, 'ohm'),
  magnetizing_reactance: scalar(66.8, 'ohm'),
  aux_resistance: scalar(7.14, 'ohm'),
  aux_leakage_reactance: scalar(3.2, 'ohm'),
  aux_turns_ratio: scalar(1.18, 'dimensionless'),
  switch_open_speed: scalar(0.75, 'dimensionless'),
  load_torque: scalar(loadTorque, 'N*m'),
  rotor_inertia: scalar(INERTIA, 'kg*m^2'),
  viscous_friction: scalar(0.0005, 'N*m*s/rad'),
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
        ac_amplitude: scalar(dcVolts !== undefined ? 0 : 110 * Math.SQRT2, 'volt'),
        frequency: scalar(60, 'hertz'),
        internal_resistance: scalar(0, 'ohm'),
      },
    },
    {
      id: 'm1',
      definition: 'induction_motor_single_phase',
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

describe('single-phase induction motor — the double-revolving-field steady analysis', () => {
  test('under its rated-class load it runs just below synchronous at a sane operating point', () => {
    const op = singlePhaseOperatingPoint(spParams(1))
    expect(op.synchronousRpm).toBeCloseTo(1800, 0)
    expect(op.slip).toBeGreaterThan(0.01)
    expect(op.slip).toBeLessThan(0.06)
    expect(op.rotorRpm).toBeGreaterThan(1700)
    expect(op.torque).toBeGreaterThan(0.9)
    expect(op.torque).toBeLessThan(1.2)
    expect(op.stalled).toBe(false)
    expect(op.startupCurrentRms).toBeGreaterThan(2 * op.currentRms)
    expect(op.powerFactor).toBeGreaterThan(0.3)
  })

  test('an impossible load stalls the running analysis', () => {
    const op = singlePhaseOperatingPoint(spParams(50))
    expect(op.stalled).toBe(true)
  })
})

describe('single-phase induction motor — starting torque is the aux winding’s doing', () => {
  // Drive the machine model open-loop at LOCKED rotor (mechanics null holds ω at 0) with the
  // nameplate sine, and average the developed torque over the last cycles: without the phase
  // split it is identically zero; split-phase makes real torque; a start capacitor makes MORE.
  const lockedAverageTorque = (startCapacitanceF?: number) => {
    const p: SinglePhaseMotorParams = {
      ...spParams(1),
      ...(startCapacitanceF !== undefined ? { startCapacitanceF } : {}),
    }
    const L = spInductancesFromParams(p)
    expect(L).not.toBeNull()
    if (L === null) throw new Error('unreachable')
    const core = createSpMotor(L, null, 0, PERIOD, 0.75 * 188.5) // locked at ω = 0
    const h = PERIOD / 1000
    const V = 110 * Math.SQRT2
    const w = 2 * Math.PI * 60
    let torqueSum = 0
    let n = 0
    for (let k = 1; k <= 6000; k++) {
      const t = k * h
      spStampMotor(core, h)
      spCommitMotor(core, V * Math.cos(w * t), h)
      if (k > 4000) {
        torqueSum += core.torque
        n += 1
      }
    }
    return torqueSum / n
  }

  test('split-phase makes positive average starting torque; a start capacitor makes more', () => {
    const splitPhase = lockedAverageTorque()
    const capStart = lockedAverageTorque(200e-6)
    // The model's deterministic locked averages: split-phase ≈ 1.28 N·m (the −β aux mounting
    // spins it FORWARD — a sign regression goes negative), cap-start ≈ 4.9 N·m.
    expect(splitPhase).toBeGreaterThan(1.0)
    expect(splitPhase).toBeLessThan(1.6)
    expect(capStart).toBeGreaterThan(1.5 * splitPhase)
  })

  test('the centrifugal switch clicks out AT the configured speed — 75% of synchronous', () => {
    // March the full start open-loop and catch the exact step the switch state flips: the
    // committed speed there must be the mechanical threshold 0.75·ω_sync ≈ 141.4 rad/s (not an
    // electrical-radians or pole-pair confusion, which would land at half or double).
    const p: SinglePhaseMotorParams = { ...spParams(1), startCapacitanceF: 200e-6 }
    const L = spInductancesFromParams(p)
    expect(L).not.toBeNull()
    if (L === null) throw new Error('unreachable')
    const wSync = (2 * Math.PI * 60) / 2
    const core = createSpMotor(
      L,
      { rotorInertia: INERTIA, viscousFriction: 0.0005, loadTorque: 1 },
      0,
      PERIOD,
      0.75 * wSync,
    )
    const h = PERIOD / 1000
    const V = 110 * Math.SQRT2
    const w = 2 * Math.PI * 60
    let omegaAtFlip: number | null = null
    for (let k = 1; k <= 30_000 && omegaAtFlip === null; k++) {
      const t = k * h
      spStampMotor(core, h)
      spCommitMotor(core, V * Math.cos(w * t), h)
      if (!core.switchClosed) omegaAtFlip = core.omega
    }
    expect(omegaAtFlip).not.toBeNull()
    expect(omegaAtFlip ?? 0).toBeGreaterThan(0.75 * wSync - 1)
    expect(omegaAtFlip ?? 0).toBeLessThan(0.75 * wSync + 5) // within a few steps of the crossing
  })
})

describe('single-phase induction motor — the time-domain machine', () => {
  test('kill the start winding and it honestly CANNOT start — zero torque, named by the solver', () => {
    // switch_open_speed 0 = the start winding out of action from the first step: a lone winding
    // makes a pulsating field, identically zero torque at standstill.
    const { result } = runTransient(1, 6, 500, { switch_open_speed: scalar(0, 'dimensionless') })
    expect(result.status).toBe('solved')
    expect(result.warnings.some((w) => w.includes("'m1' did NOT start"))).toBe(true)
  })

  test('CAP-START against the rated load: spins up, the switch drops out, settles near the phasor', () => {
    // The capacitor's brisk, well-phased starting torque (~4.9 N·m locked vs the split-phase
    // machine's ~1.3) drives the start straight through the aux-in torque valley to the switch
    // speed and beyond. 200 µF sits in the cited 80–300 µF electrolytic start-cap class.
    const { result } = runTransient(1, 30, 400, {
      start_capacitance: scalar(200e-6, 'farad'),
    })
    expect(result.status).toBe('solved')
    expect(result.warnings.some((w) => w.includes('did NOT start'))).toBe(false)
    const tEnd = result.series.at(-1)?.time ?? 0
    const op = singlePhaseOperatingPoint(spParams(1))
    const settled = rmsOver(result, tEnd - 2 * PERIOD, tEnd)
    // A light real rotor carries the genuine 2f torque ripple, so the marched point sits a few
    // percent above the constant-speed phasor analysis — honest physics, hence the wide band.
    expect(Math.abs(settled - op.currentRms) / op.currentRms).toBeLessThan(0.1)
    // The start draw (both windings, rotor locked) genuinely exceeded the running draw.
    const starting = rmsOver(result, PERIOD, 2 * PERIOD)
    expect(starting).toBeGreaterThan(2 * settled)
  })

  test('the split-phase machine HANGS partway up against this load — the classic start-winding killer', () => {
    // Same machine, no capacitor: its ~1.3 N·m of split-phase starting torque DOES break the
    // 1 N·m load off standstill, but the aux-in torque curve cannot push it through the valley
    // — it hangs near 40% of synchronous, below the 75% switch speed, so the start winding
    // never drops out and the current stays near locked (exactly how real overloaded
    // split-phase motors cook their start windings). Where the cap-start machine settled well
    // inside 30 cycles, this one is nowhere near the running point.
    const { result } = runTransient(1, 30, 400)
    expect(result.status).toBe('solved')
    const tEnd = result.series.at(-1)?.time ?? 0
    const op = singlePhaseOperatingPoint(spParams(1))
    const late = rmsOver(result, tEnd - 2 * PERIOD, tEnd)
    expect(late).toBeGreaterThan(1.5 * op.currentRms) // nowhere near the running point
  })

  test('without a rotor_inertia the rotor is held at the running speed — start winding already out', () => {
    const { result } = runTransient(1, 10, 500, { rotor_inertia: undefined as never })
    expect(result.status).toBe('solved')
    expect(result.warnings.some((w) => w.includes("'m1' has no rotor_inertia"))).toBe(true)
    const tEnd = result.series.at(-1)?.time ?? 0
    const op = singlePhaseOperatingPoint(spParams(1))
    const settled = rmsOver(result, tEnd - 2 * PERIOD, tEnd)
    expect(Math.abs(settled - op.currentRms) / op.currentRms).toBeLessThan(0.05)
  })

  test('DC sees the real winding topology in BOTH engines — aux parallel on split-phase, blocked by a cap', () => {
    // Split-phase: main ∥ aux = 1/(1/2.02 + 1/7.14) ≈ 1.574 Ω → 12 V drives ≈ 7.62 A.
    const split = runTransient(1, 1, 1, {}, 12)
    void split // (built below with proper duration — the helper's cycles are 60 Hz periods)
    const world = split.world
    const dcSol = solveDC(world)
    expect(dcSol.status).toBe('solved')
    expect(Math.abs(dcSol.branches.get('m1') ?? 0)).toBeCloseTo(12 / (1 / (1 / 2.02 + 1 / 7.14)), 3)
    const transient = solveTransient(world, { timeStep: 0.002, duration: 3 })
    const iFinal = Math.abs(transient.series.at(-1)?.currents?.get('m1/terminal_a') ?? 0)
    expect(Math.abs(iFinal - 7.624) / 7.624).toBeLessThan(0.02)
    // Capacitor-start: the cap blocks the aux at DC → exactly the main winding, 12/2.02 A.
    const cap = runTransient(1, 1, 1, { start_capacitance: scalar(200e-6, 'farad') }, 12)
    const capSol = solveDC(cap.world)
    expect(Math.abs(capSol.branches.get('m1') ?? 0)).toBeCloseTo(12 / 2.02, 3)
    const capTransient = solveTransient(cap.world, { timeStep: 0.002, duration: 3 })
    const iCap = Math.abs(capTransient.series.at(-1)?.currents?.get('m1/terminal_a') ?? 0)
    expect(Math.abs(iCap - 12 / 2.02) / (12 / 2.02)).toBeLessThan(0.02)
  })

  test('DC parity holds in the corners too: no rotor_inertia, and the broken-switch knob', () => {
    // A no-inertia split-phase machine on DC cannot be "running" — it is held at rest with the
    // switch closed, so BOTH engines see main ∥ aux (the quasi-static fallback only holds the
    // nameplate speed when an AC drive actually shares the circuit).
    const noJ = runTransient(1, 1, 1, { rotor_inertia: undefined as never }, 12)
    const noJDc = Math.abs(solveDC(noJ.world).branches.get('m1') ?? 0)
    const noJTr = solveTransient(noJ.world, { timeStep: 0.002, duration: 3 })
    const iNoJ = Math.abs(noJTr.series.at(-1)?.currents?.get('m1/terminal_a') ?? 0)
    const parallel = 12 / (1 / (1 / 2.02 + 1 / 7.14))
    expect(noJDc).toBeCloseTo(parallel, 3)
    expect(Math.abs(iNoJ - parallel) / parallel).toBeLessThan(0.02)
    // switch_open_speed = 0 (start winding out of action): main winding only, in BOTH engines.
    const broken = runTransient(1, 1, 1, { switch_open_speed: scalar(0, 'dimensionless') }, 12)
    const brokenDc = Math.abs(solveDC(broken.world).branches.get('m1') ?? 0)
    const brokenTr = solveTransient(broken.world, { timeStep: 0.002, duration: 3 })
    const iBroken = Math.abs(brokenTr.series.at(-1)?.currents?.get('m1/terminal_a') ?? 0)
    expect(brokenDc).toBeCloseTo(12 / 2.02, 3)
    expect(Math.abs(iBroken - 12 / 2.02) / (12 / 2.02)).toBeLessThan(0.02)
  })

  test('the readings show the running double-field operating point', () => {
    const { world } = runTransient(1, 1, 1)
    const sol = solveDC(world)
    const reading = partReadings(world, sol).get('m1')
    expect(reading?.speedRpm ?? 0).toBeGreaterThan(1700)
    expect(reading?.speedRpm ?? 0).toBeLessThan(1800)
    expect(reading?.slipPercent ?? 0).toBeGreaterThan(0)
    expect((reading?.startupCurrentA ?? 0) > (reading?.current ?? 1e9)).toBe(true)
  })
})
