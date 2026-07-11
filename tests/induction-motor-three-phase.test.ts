/**
 * The TRUE three-phase induction motor — three phase ports + the wye star point, fed by real
 * wires (no synthesized phases). The flagship: the real three-phase ALTERNATOR drives it and it
 * spins up onto the Steinmetz operating point with a balanced, zero-neutral three-phase set.
 * The classic physics must EMERGE: swap two leads and it runs backward; lose a phase and it
 * cannot start (single-phasing, named); DC phase→neutral sees exactly one winding (R1) and
 * line-to-line two in series (2·R1) — in both engines.
 */

import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import {
  createDqMotor3,
  dq3CommitMotor,
  dq3StampMotor,
  dqInductancesFromParams,
} from '../src/induction-motor-dq.ts'
import {
  type InductionMotorParams,
  inductionMotorOperatingPoint,
} from '../src/induction-motor-model.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { buildMathView } from '../src/renderer/math-view.ts'
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
const INERTIA = 0.0152 // the shipped ABB M2BAX 112MLA 4 rotor

// The shipped ~4 kW 4-pole 230 V (per-phase) 50 Hz machine.
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

const motorParameters = (
  loadTorque: number,
  inertia: number | null,
  overrides: Record<string, unknown> = {},
) => ({
  supply_voltage: scalar(230, 'volt'),
  line_frequency: scalar(50, 'hertz'),
  pole_count: scalar(4, 'dimensionless'),
  stator_resistance: scalar(2, 'ohm'),
  stator_reactance: scalar(4, 'ohm'),
  rotor_resistance: scalar(2, 'ohm'),
  rotor_reactance: scalar(4, 'ohm'),
  magnetizing_reactance: scalar(80, 'ohm'),
  load_torque: scalar(loadTorque, 'N*m'),
  viscous_friction: scalar(0.002, 'N*m*s/rad'),
  ...(inertia === null ? {} : { rotor_inertia: scalar(inertia, 'kg*m^2') }),
  ...overrides,
})

// A 2-pole-pair alternator at 1500 RPM makes exactly 50 Hz; k sized for 230 V RMS per phase.
const OMEGA_E = 2 * ((1500 * 2 * Math.PI) / 60)
const FLUX_LINKAGE = (230 * Math.SQRT2) / OMEGA_E

/** The flagship rig: the real three-phase alternator wired phase-for-phase into the motor,
 *  star points joined and grounded — generation to rotation, all real parts. */
const alternatorRig = (
  loadTorque: number,
  inertia: number | null,
  motorOverrides: Record<string, unknown> = {},
  wireNeutral = true,
) => {
  const nodes: CanvasNode[] = [
    {
      id: 'alt',
      definition: 'alternator_three_phase',
      parameters: {
        flux_linkage: scalar(FLUX_LINKAGE, 'V*s/rad'),
        winding_resistance: scalar(0.01, 'ohm'),
        pole_pairs: scalar(2, 'dimensionless'),
        drive_speed: scalar(1500, 'rpm'),
        viscous_friction: scalar(1e-5, 'N*m*s/rad'),
      },
    },
    {
      id: 'm1',
      definition: 'induction_motor_three_phase',
      parameters: motorParameters(loadTorque, inertia, motorOverrides),
    },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    g('alt', 'phase_a', 'm1', 'phase_a'),
    g('alt', 'phase_b', 'm1', 'phase_b'),
    g('alt', 'phase_c', 'm1', 'phase_c'),
    ...(wireNeutral ? [g('alt', 'neutral', 'm1', 'neutral')] : []),
    g('alt', 'neutral', 'gnd', 'reference_terminal'),
  ]
  return canvasToWorld(nodes, edges)
}

/** RMS of one recorded current key over [tStart, tEnd]. */
const rmsOf = (result: TransientResult, key: string, tStart: number, tEnd: number) => {
  let sum = 0
  let n = 0
  for (const p of result.series) {
    if (p.time < tStart - 1e-12 || p.time > tEnd + 1e-12) continue
    const i = p.currents?.get(key) ?? 0
    sum += i * i
    n += 1
  }
  return Math.sqrt(sum / n)
}

describe('three-phase induction motor — the real alternator drives the real motor', () => {
  test('spins up onto the phasor operating point: balanced phases, zero neutral, no warnings', () => {
    const world = alternatorRig(20, INERTIA)
    const result = solveTransient(world, { timeStep: PERIOD / 1000, duration: 15 * PERIOD })
    expect(result.status).toBe('solved')
    expect(result.warnings.filter((w) => w.includes('Skipped'))).toEqual([])
    expect(result.warnings.filter((w) => w.includes('no rotor_inertia'))).toEqual([])
    // The alternator IS the nameplate supply (230 V, 50 Hz) — the readings warning stays quiet.
    expect(result.warnings.some((w) => w.includes('analyzed at its nameplate'))).toBe(false)
    const tEnd = result.series.at(-1)?.time ?? 0
    const op = inductionMotorOperatingPoint(imParams(20))
    const iA = rmsOf(result, 'm1/phase_a', tEnd - 2 * PERIOD, tEnd)
    const iB = rmsOf(result, 'm1/phase_b', tEnd - 2 * PERIOD, tEnd)
    const iC = rmsOf(result, 'm1/phase_c', tEnd - 2 * PERIOD, tEnd)
    expect(Math.abs(iA - op.statorCurrentRms) / op.statorCurrentRms).toBeLessThan(0.03)
    expect(Math.abs(iB - iA) / iA).toBeLessThan(0.02) // balanced —
    expect(Math.abs(iC - iA) / iA).toBeLessThan(0.02)
    const iN = rmsOf(result, 'm1/neutral', tEnd - 2 * PERIOD, tEnd)
    expect(iN).toBeLessThan(0.05 * iA) // — so the star carries (nearly) nothing
    // The inrush was real: cycle 2's current sits near locked-rotor, then tapers.
    const inrush = rmsOf(result, 'm1/phase_a', PERIOD, 2 * PERIOD)
    expect(inrush).toBeGreaterThan(3 * op.statorCurrentRms)
    expect(iA).toBeLessThan(inrush / 2.5)
  })

  test('without a rotor_inertia the rotor is held at the nameplate speed — warned, still solves', () => {
    const world = alternatorRig(20, null)
    const result = solveTransient(world, { timeStep: PERIOD / 1000, duration: 15 * PERIOD })
    expect(result.status).toBe('solved')
    expect(result.warnings.some((w) => w.includes("'m1' has no rotor_inertia"))).toBe(true)
    const tEnd = result.series.at(-1)?.time ?? 0
    const op = inductionMotorOperatingPoint(imParams(20))
    const iA = rmsOf(result, 'm1/phase_a', tEnd - 2 * PERIOD, tEnd)
    expect(Math.abs(iA - op.statorCurrentRms) / op.statorCurrentRms).toBeLessThan(0.03)
  })

  test('magnetic saturation runs through the three-port path too — a below-rated knee draws more', () => {
    // Knee at 0.9 pu of the rated peak flux with a 0.3·Xm saturated slope: at the alternator's
    // rated drive the resultant flux (~0.95 pu) sits past the knee, the chord drops, and the
    // no-load current rises above the linear machine's. Pins the dq3 saturation path end to end.
    const SAT3 = {
      magnetizing_knee_flux: scalar(0.9318, 'V*s'),
      saturated_magnetizing_reactance: scalar(24, 'ohm'),
    }
    const run = (overrides: Record<string, unknown>) => {
      const result = solveTransient(alternatorRig(0, INERTIA, overrides), {
        timeStep: PERIOD / 400,
        duration: 40 * PERIOD,
      })
      const tEnd = result.series.at(-1)?.time ?? 0
      return { result, iRms: rmsOf(result, 'm1/phase_a', tEnd - 2 * PERIOD, tEnd) }
    }
    const linear = run({})
    const saturated = run(SAT3)
    expect(saturated.result.status).toBe('solved')
    expect(
      saturated.result.warnings.some((w) => w.includes('saturates at its nameplate drive')),
    ).toBe(true)
    expect(saturated.iRms).toBeGreaterThan(1.05 * linear.iRms)
    expect(saturated.iRms).toBeLessThan(2 * linear.iRms)
  })

  test('a load beyond breakdown torque stalls it for real — sustained locked-rotor current', () => {
    const stalledOp = inductionMotorOperatingPoint(imParams(200))
    expect(stalledOp.stalled).toBe(true)
    const world = alternatorRig(200, INERTIA)
    const result = solveTransient(world, { timeStep: PERIOD / 1000, duration: 8 * PERIOD })
    expect(result.warnings.some((w) => w.includes("Induction motor 'm1' is STALLED"))).toBe(true)
    const tEnd = result.series.at(-1)?.time ?? 0
    const iA = rmsOf(result, 'm1/phase_a', tEnd - 2 * PERIOD, tEnd)
    expect(Math.abs(iA - stalledOp.startupCurrentRms) / stalledOp.startupCurrentRms).toBeLessThan(
      0.03,
    )
  })
})

describe('three-phase induction motor — the DELTA stator (wye-delta starting physics)', () => {
  const DELTA = { stator_connection: { value: 'delta' } }
  /** The same coils referred to their exact equivalent wye: every winding impedance / 3. */
  const deltaOp = (loadTorque: number) =>
    inductionMotorOperatingPoint({
      ...imParams(loadTorque),
      statorResistance: 2 / 3,
      statorReactance: 4 / 3,
      rotorResistance: 2 / 3,
      rotorReactance: 4 / 3,
      magnetizingReactance: 80 / 3,
    })

  test('the same coils at standstill pull exactly ~3× the line current in delta', () => {
    // Hold both machines at standstill (a load beyond even the delta's breakdown torque) so the
    // comparison is locked-rotor to locked-rotor: the delta windings see the full line-to-line
    // voltage — 3× the wye's line current, the reason wye-delta starters exist.
    const runLocked = (overrides: Record<string, unknown>, wireNeutral: boolean) => {
      const result = solveTransient(alternatorRig(500, INERTIA, overrides, wireNeutral), {
        timeStep: PERIOD / 1000,
        duration: 5 * PERIOD,
      })
      const tEnd = result.series.at(-1)?.time ?? 0
      return rmsOf(result, 'm1/phase_a', tEnd - 2 * PERIOD, tEnd)
    }
    const wyeLocked = runLocked({}, true)
    const deltaLocked = runLocked(DELTA, false)
    expect(deltaLocked / wyeLocked).toBeGreaterThan(2.9)
    expect(deltaLocked / wyeLocked).toBeLessThan(3.1)
  })

  test('a delta machine spins up onto ITS phasor operating point (params referred / 3)', () => {
    const delta = solveTransient(alternatorRig(20, INERTIA, DELTA, false), {
      timeStep: PERIOD / 1000,
      duration: 15 * PERIOD,
    })
    expect(delta.status).toBe('solved')
    const tEnd = delta.series.at(-1)?.time ?? 0
    const op = deltaOp(20)
    expect(op.stalled).toBe(false)
    const settled = rmsOf(delta, 'm1/phase_a', tEnd - 2 * PERIOD, tEnd)
    expect(Math.abs(settled - op.statorCurrentRms) / op.statorCurrentRms).toBeLessThan(0.03)
  })

  test('a wired neutral on a delta stator is ignored, by name — a delta has no star point', () => {
    const result = solveTransient(alternatorRig(20, INERTIA, DELTA, true), {
      timeStep: PERIOD / 1000,
      duration: 3 * PERIOD,
    })
    expect(result.status).toBe('solved')
    expect(
      result.warnings.some((w) => w.includes('delta-connected') && w.includes('no star point')),
    ).toBe(true)
    // The ignored neutral port records nothing — no zero-sequence path exists in delta.
    expect(result.series.at(-1)?.currents?.get('m1/neutral')).toBeUndefined()
  })

  const deltaDcWorld = (wireC: boolean) => {
    const nodes: CanvasNode[] = [
      {
        id: 'bat',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(12, 'volt'), internal_resistance: scalar(0, 'ohm') },
      },
      {
        id: 'm1',
        definition: 'induction_motor_three_phase',
        parameters: motorParameters(20, INERTIA, DELTA),
      },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      g('bat', 'terminal_positive', 'm1', 'phase_a'),
      g('m1', 'phase_b', 'bat', 'terminal_negative'),
      ...(wireC ? [g('m1', 'phase_c', 'bat', 'terminal_negative')] : []),
      g('gnd', 'reference_terminal', 'bat', 'terminal_negative'),
    ]
    return canvasToWorld(nodes, edges)
  }

  test('DC in delta with B and C tied together: the real winding network answers — both engines', () => {
    // Windings of 2 Ω each; terminals B and C shorted, so winding bc is shorted out and windings
    // ab ∥ ca carry the current: 2 ∥ 2 = 1 Ω → 12 A. The referred wye reproduces it exactly
    // (R/3 legs → Y→Δ legs of R; a to the tied bc node: R ∥ R = 1 Ω).
    const world = deltaDcWorld(true)
    const sol = solveDC(world)
    expect(sol.status).toBe('solved')
    expect(Math.abs(sol.branches.get('bat') ?? 0)).toBeCloseTo(12, 4)
    const transient = solveTransient(world, { timeStep: 0.005, duration: 6 })
    const iFinal = Math.abs(transient.series.at(-1)?.currents?.get('m1/phase_a') ?? 0)
    expect(Math.abs(iFinal - 12) / 12).toBeLessThan(0.02)
  })

  test('DC in delta line-to-line with C open: one winding parallel the other two in series', () => {
    // Windings of 2 Ω: ab ∥ (ca + cb) = 2 ∥ 4 = 4/3 Ω → 12 V drives 9 A — both engines.
    const world = deltaDcWorld(false)
    const sol = solveDC(world)
    expect(sol.status).toBe('solved')
    expect(Math.abs(sol.branches.get('bat') ?? 0)).toBeCloseTo(9, 4)
    const transient = solveTransient(world, { timeStep: 0.005, duration: 6 })
    const iFinal = Math.abs(transient.series.at(-1)?.currents?.get('m1/phase_a') ?? 0)
    expect(Math.abs(iFinal - 9) / 9).toBeLessThan(0.02)
  })

  test('delta single-phasing: one phase open, a loaded machine cannot start — named', () => {
    const nodes: CanvasNode[] = [
      {
        id: 'v1',
        definition: 'power_source',
        parameters: {
          nominal_voltage: scalar(0, 'volt'),
          ac_amplitude: scalar(398 * Math.SQRT2, 'volt'),
          frequency: scalar(50, 'hertz'),
          internal_resistance: scalar(0, 'ohm'),
        },
      },
      {
        id: 'm1',
        definition: 'induction_motor_three_phase',
        parameters: motorParameters(5, INERTIA, DELTA),
      },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      g('v1', 'terminal_positive', 'm1', 'phase_a'),
      g('m1', 'phase_b', 'v1', 'terminal_negative'),
      g('v1', 'terminal_negative', 'gnd', 'reference_terminal'),
    ]
    const result = solveTransient(canvasToWorld(nodes, edges), {
      timeStep: PERIOD / 1000,
      duration: 5 * PERIOD,
    })
    expect(result.status).toBe('solved')
    expect(result.warnings.some((w) => w.includes("'m1' did NOT start"))).toBe(true)
  })
})

describe('three-phase induction motor — the classic physics emerges', () => {
  // Drive the machine model open-loop with prescribed terminal voltages (the element is a
  // voltage-in/current-out companion, so no circuit solve is needed to test the mechanics).
  const marchSequence = (bLeads: boolean) => {
    const inductances = dqInductancesFromParams(imParams(5))
    expect(inductances).not.toBeNull()
    if (inductances === null) throw new Error('unreachable')
    const core = createDqMotor3(
      inductances,
      { rotorInertia: INERTIA, viscousFriction: 0.002, loadTorque: 5 },
      0,
      [true, true, true, true],
      PERIOD,
    )
    const h = PERIOD / 1000
    const V = 230 * Math.SQRT2
    const w = 2 * Math.PI * 50
    const shift = ((bLeads ? +1 : -1) * 2 * Math.PI) / 3
    for (let k = 1; k <= 30_000; k++) {
      const t = k * h
      dq3StampMotor(core, h)
      dq3CommitMotor(
        core,
        [V * Math.cos(w * t), V * Math.cos(w * t + shift), V * Math.cos(w * t - shift), 0],
        h,
      )
    }
    return core.omega
  }

  test('phase sequence sets the rotation: positive sequence forward, swapped leads BACKWARD', () => {
    const syncMech = (2 * Math.PI * 50) / 2 // 157 rad/s for the 4-pole machine
    const forward = marchSequence(false) // B lags A by 120° — positive sequence
    const backward = marchSequence(true) // B and C swapped — negative sequence
    expect(forward).toBeGreaterThan(0.9 * syncMech)
    expect(backward).toBeLessThan(-0.9 * syncMech)
    // The two runs are mirror images — same settled slip, opposite rotation.
    expect(Math.abs(backward + forward) / forward).toBeLessThan(0.01)
  })

  test('single-phasing: with one phase open it CANNOT start from rest — named by the solver', () => {
    // A line-to-line source on phases A and B, phase C and the star left unwired: the field
    // pulses instead of rotating, the starting torque is identically zero, the rotor never moves.
    const nodes: CanvasNode[] = [
      {
        id: 'v1',
        definition: 'power_source',
        parameters: {
          nominal_voltage: scalar(0, 'volt'),
          ac_amplitude: scalar(398 * Math.SQRT2, 'volt'),
          frequency: scalar(50, 'hertz'),
          internal_resistance: scalar(0, 'ohm'),
        },
      },
      {
        id: 'm1',
        definition: 'induction_motor_three_phase',
        parameters: motorParameters(5, INERTIA),
      },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      g('v1', 'terminal_positive', 'm1', 'phase_a'),
      g('m1', 'phase_b', 'v1', 'terminal_negative'),
      g('v1', 'terminal_negative', 'gnd', 'reference_terminal'),
    ]
    const world = canvasToWorld(nodes, edges)
    const result = solveTransient(world, { timeStep: PERIOD / 1000, duration: 5 * PERIOD })
    expect(result.status).toBe('solved')
    expect(result.warnings.some((w) => w.includes("'m1' did NOT start"))).toBe(true)
    // The two energized windings in series carry the big pulsating current the whole time.
    const tEnd = result.series.at(-1)?.time ?? 0
    const iA = rmsOf(result, 'm1/phase_a', tEnd - 2 * PERIOD, tEnd)
    expect(iA).toBeGreaterThan(15)
    // The open phase has no wire, so it records no current at all.
    expect(result.series.at(-1)?.currents?.get('m1/phase_c')).toBeUndefined()
  })
})

describe('three-phase induction motor — DC sees the real winding topology, in both engines', () => {
  const dcNodes = (hookup: 'phase_to_neutral' | 'line_to_line') => {
    const nodes: CanvasNode[] = [
      {
        id: 'bat',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(12, 'volt'), internal_resistance: scalar(0, 'ohm') },
      },
      {
        id: 'm1',
        definition: 'induction_motor_three_phase',
        parameters: motorParameters(20, INERTIA),
      },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      g('bat', 'terminal_positive', 'm1', 'phase_a'),
      hookup === 'phase_to_neutral'
        ? g('m1', 'neutral', 'bat', 'terminal_negative')
        : g('m1', 'phase_b', 'bat', 'terminal_negative'),
      g('gnd', 'reference_terminal', 'bat', 'terminal_negative'),
    ]
    return canvasToWorld(nodes, edges)
  }

  test('transient: phase→neutral is ONE winding (12 V / 2 Ω = 6 A); line-to-line TWO (3 A)', () => {
    // The DC hookups settle on the slow magnetizing-flux mode (τ ≈ 0.26 s) — march 6 s.
    const one = solveTransient(dcNodes('phase_to_neutral'), { timeStep: 0.005, duration: 6 })
    expect(one.status).toBe('solved')
    const iOne = Math.abs(one.series.at(-1)?.currents?.get('m1/phase_a') ?? 0)
    expect(Math.abs(iOne - 6) / 6).toBeLessThan(0.02)
    const iN = one.series.at(-1)?.currents?.get('m1/neutral') ?? 0
    expect(Math.abs(iN + 6) / 6).toBeLessThan(0.02) // the star returns all of it
    expect(one.warnings.some((w) => w.includes("'m1' did NOT start"))).toBe(true)

    const two = solveTransient(dcNodes('line_to_line'), { timeStep: 0.005, duration: 6 })
    expect(two.status).toBe('solved')
    const iTwo = Math.abs(two.series.at(-1)?.currents?.get('m1/phase_a') ?? 0)
    expect(Math.abs(iTwo - 3) / 3).toBeLessThan(0.02)
  })

  test('DC solver: the floating-star Y→Δ stamp — three phases wired, two shorted together', () => {
    // Tie phase_c to phase_b and drive 12 V across a–b: windings b and c sit in parallel from
    // the (floating) star, in series with winding a → 1.5·R1 = 3 Ω → 4 A. Only the correct
    // Y→Δ legs (3·R1 each) produce this; a wrong leg value gives a visibly different current.
    const nodes: CanvasNode[] = [
      {
        id: 'bat',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(12, 'volt'), internal_resistance: scalar(0, 'ohm') },
      },
      {
        id: 'm1',
        definition: 'induction_motor_three_phase',
        parameters: motorParameters(20, INERTIA),
      },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      g('bat', 'terminal_positive', 'm1', 'phase_a'),
      g('m1', 'phase_b', 'bat', 'terminal_negative'),
      g('m1', 'phase_c', 'bat', 'terminal_negative'),
      g('gnd', 'reference_terminal', 'bat', 'terminal_negative'),
    ]
    const sol = solveDC(canvasToWorld(nodes, edges))
    expect(sol.status).toBe('solved')
    expect(Math.abs(sol.branches.get('bat') ?? 0)).toBeCloseTo(4, 4)
  })

  test('DC solver: the full wye — all three phases to +, the star point to −, three R1 legs', () => {
    const nodes: CanvasNode[] = [
      {
        id: 'bat',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(12, 'volt'), internal_resistance: scalar(0, 'ohm') },
      },
      {
        id: 'm1',
        definition: 'induction_motor_three_phase',
        parameters: motorParameters(20, INERTIA),
      },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      g('bat', 'terminal_positive', 'm1', 'phase_a'),
      g('bat', 'terminal_positive', 'm1', 'phase_b'),
      g('bat', 'terminal_positive', 'm1', 'phase_c'),
      g('m1', 'neutral', 'bat', 'terminal_negative'),
      g('gnd', 'reference_terminal', 'bat', 'terminal_negative'),
    ]
    const sol = solveDC(canvasToWorld(nodes, edges))
    expect(sol.status).toBe('solved')
    // Three 2 Ω windings in parallel: 12 V / (2/3 Ω) = 18 A — all three wye legs must exist.
    expect(Math.abs(sol.branches.get('bat') ?? 0)).toBeCloseTo(18, 4)
  })

  test('a slow off-nameplate drive is judged in DRIVE periods — no premature did-NOT-start', () => {
    // A 5 Hz alternator drive (150 RPM × 2 pole pairs) at nameplate V/f, marched 0.05 s: that is
    // 2.5 NAMEPLATE periods but only a quarter of one drive period — far too early to judge
    // starting. The warning window must scale with the actual drive, like the sibling's.
    const nodes: CanvasNode[] = [
      {
        id: 'alt',
        definition: 'alternator_three_phase',
        parameters: {
          flux_linkage: scalar(FLUX_LINKAGE, 'V*s/rad'),
          winding_resistance: scalar(0.01, 'ohm'),
          pole_pairs: scalar(2, 'dimensionless'),
          drive_speed: scalar(150, 'rpm'),
          viscous_friction: scalar(1e-5, 'N*m*s/rad'),
        },
      },
      {
        id: 'm1',
        definition: 'induction_motor_three_phase',
        parameters: motorParameters(9, INERTIA),
      },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      g('alt', 'phase_a', 'm1', 'phase_a'),
      g('alt', 'phase_b', 'm1', 'phase_b'),
      g('alt', 'phase_c', 'm1', 'phase_c'),
      g('alt', 'neutral', 'm1', 'neutral'),
      g('alt', 'neutral', 'gnd', 'reference_terminal'),
    ]
    const world = canvasToWorld(nodes, edges)
    const result = solveTransient(world, { timeStep: 1e-4, duration: 0.05 })
    expect(result.status).toBe('solved')
    expect(result.warnings.some((w) => w.includes('did NOT start'))).toBe(false)
  })

  test('DC solver: the wye / star-point stamps give the same two answers, and KCL closes', () => {
    const one = dcNodes('phase_to_neutral')
    const solOne = solveDC(one)
    expect(solOne.status).toBe('solved')
    // 12 V across one 2 Ω winding: the source's branch current is 6 A.
    expect(Math.abs(solOne.branches.get('bat') ?? 0)).toBeCloseTo(6, 4)
    const two = dcNodes('line_to_line')
    const solTwo = solveDC(two)
    expect(solTwo.status).toBe('solved')
    expect(Math.abs(solTwo.branches.get('bat') ?? 0)).toBeCloseTo(3, 4)
    // The Math panel: every summable net closes; the motor's nets are noted as multi-terminal.
    for (const world of [one, two]) {
      const view = buildMathView(world, solveDC(world))
      for (const net of view.nets) {
        if (net.sumAmps !== null) expect(Math.abs(net.sumAmps)).toBeLessThan(1e-9)
      }
    }
    // The readings show the nameplate operating point, like the two-terminal sibling.
    const reading = partReadings(one, solOne).get('m1')
    expect(reading?.speedRpm ?? 0).toBeGreaterThan(1300)
    expect(reading?.slipPercent ?? 0).toBeGreaterThan(0)
  })
})
