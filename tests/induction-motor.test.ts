/**
 * AC induction motor tests — Tesla's rotating-field machine. The READINGS side is the per-phase
 * equivalent circuit (Steinmetz): synchronous speed, the torque-slip curve, the operating point
 * under load, the locked-rotor starting current, the no-load run, the stall beyond breakdown
 * torque, and the live readings from a solve. The TIME-DOMAIN side is the dq dynamic model: the
 * rotor genuinely spins up from rest (the locked-rotor inrush tapering onto the phasor operating
 * point), stalls for real under an impossible load, marches an off-nameplate drive honestly,
 * degenerates to exactly the stator R1 on DC, and refuses a too-coarse time step by name.
 */

import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import {
  createDqMotor,
  dqCommitMotor,
  dqInductancesFromParams,
  dqInitMotor,
  dqStampMotor,
} from '../src/induction-motor-dq.ts'
import {
  electromagneticTorque,
  type InductionMotorParams,
  inductionMotorOperatingPoint,
  inductionMotorParamsFromInstance,
  synchronousSpeedRadPerSec,
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

describe('induction motor — the dq dynamic model in the time-domain solve', () => {
  // The dq model must do BOTH: genuinely spin up from rest (the locked-rotor inrush tapering as
  // the rotor accelerates) AND settle exactly onto the PHASOR operating point the steady-state
  // analysis gives — the marched machine reduces to the Steinmetz circuit at steady state.
  const PERIOD = 1 / 50
  const INERTIA = 0.0152 // the shipped ABB M2BAX 112MLA 4 rotor (4 kW, 4-pole)
  const motorParameters = (
    loadTorque: number,
    inertia: number | null,
    overrides: Record<string, { value: { kind: string; amount: number; unit: string } }> = {},
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

  const runTransient = (
    loadTorque: number,
    cycles = 5,
    stepsPerCycle = 1000,
    source: { rms?: number; hz?: number; dc?: number } = {},
    inertia: number | null = INERTIA,
    motorOverrides: Record<string, { value: { kind: string; amount: number; unit: string } }> = {},
  ) => {
    const nodes: CanvasNode[] = [
      {
        id: 'v1',
        definition: 'power_source',
        parameters: {
          nominal_voltage: scalar(source.dc ?? 0, 'volt'),
          ac_amplitude: scalar(
            (source.rms ?? (source.dc !== undefined ? 0 : 230)) * Math.SQRT2,
            'volt',
          ),
          frequency: scalar(source.hz ?? 50, 'hertz'),
          internal_resistance: scalar(0, 'ohm'),
        },
      },
      {
        id: 'm1',
        definition: 'induction_motor',
        parameters: motorParameters(loadTorque, inertia, motorOverrides),
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

  /** RMS voltage/current + power factor + mean absorbed power over [tStart, tEnd]. */
  const windowStats = (
    world: ReturnType<typeof canvasToWorld>,
    result: TransientResult,
    tStart: number,
    tEnd: number,
  ) => {
    const connects = world.instances.get('m1')?.connects ?? []
    const netA = connects.find((c) => c.terminal === 'terminal_a')?.net ?? ''
    const netB = connects.find((c) => c.terminal === 'terminal_b')?.net ?? ''
    let sumV2 = 0
    let sumI2 = 0
    let sumP = 0
    let n = 0
    for (const p of result.series) {
      if (p.time < tStart - 1e-12 || p.time > tEnd + 1e-12) continue
      const v = (p.nodes.get(netA) ?? 0) - (p.nodes.get(netB) ?? 0)
      const i = p.currents?.get('m1/terminal_a') ?? 0
      sumV2 += v * v
      sumI2 += i * i
      sumP += v * i
      n += 1
    }
    const vRms = Math.sqrt(sumV2 / n)
    const iRms = Math.sqrt(sumI2 / n)
    return { vRms, iRms, powerFactor: sumP / n / (vRms * iRms), meanWatts: sumP / n }
  }

  /** The LAST two full cycles — past the spin-up and the switch-on electrical transient. */
  const cycleStats = (
    world: ReturnType<typeof canvasToWorld>,
    result: TransientResult,
    period = PERIOD,
  ) => {
    const tEnd = result.series.at(-1)?.time ?? 0
    return windowStats(world, result, tEnd - 2 * period, tEnd)
  }

  test('switch-on draws the LOCKED-ROTOR inrush, then settles onto the phasor operating point', () => {
    // 15 cycles: the rotor spins up in the first ~6 (J = 0.0152 kg·m²), then the settled slip's
    // magnetizing mode finishes; measure the last two cycles well past both.
    const { world, result } = runTransient(20, 15)
    expect(result.status).toBe('solved')
    expect(result.warnings.filter((w) => w.startsWith('Unsupported element'))).toEqual([])
    expect(result.warnings.filter((w) => w.includes('Skipped induction motor'))).toEqual([])
    expect(result.warnings.filter((w) => w.includes('no rotor_inertia'))).toEqual([])
    const op = inductionMotorOperatingPoint(imParams(20))
    // Cycle 2 (the rotor still slow, slip near 1): the current sits near the locked-rotor value —
    // the REAL 4x inrush, not the settled current the quasi-static model showed from t = 0.
    const inrush = windowStats(world, result, PERIOD, 2 * PERIOD)
    expect(inrush.iRms).toBeGreaterThan(3 * op.statorCurrentRms)
    expect(inrush.iRms).toBeGreaterThan(0.6 * op.startupCurrentRms)
    // Settled: magnitude AND power factor match the steady-state phasor analysis, and the port
    // absorbs positive average power (a motor, not a generator — the companion's sign is right).
    const settled = cycleStats(world, result)
    expect(Math.abs(settled.vRms - 230) / 230).toBeLessThan(0.02)
    expect(Math.abs(settled.iRms - op.statorCurrentRms) / op.statorCurrentRms).toBeLessThan(0.03)
    expect(Math.abs(settled.powerFactor - op.powerFactor)).toBeLessThan(0.03)
    expect(settled.meanWatts).toBeGreaterThan(0)
    expect(settled.iRms).toBeLessThan(inrush.iRms / 2.5) // the inrush genuinely tapered
  })

  test('DC content sees exactly the stator R1 — the transient march agrees with the DC solver', () => {
    // The zero-sequence path's load-bearing property: on a battery the αβ dynamics die out and
    // the port degenerates to R1, so 12 V must drive V/R1 = 6 A — the same answer the DC engine
    // gives. March 1 s and read the settled current.
    const { result } = runTransient(20, 50, 40, { dc: 12 })
    expect(result.status).toBe('solved')
    const last = result.series.at(-1)
    const iFinal = Math.abs(last?.currents?.get('m1/terminal_a') ?? 0)
    expect(Math.abs(iFinal - 12 / 2) / 6).toBeLessThan(0.02)
    // …and the rotor observably stayed at rest — on DC there is no rotating field to start it.
    expect(
      result.warnings.some((w) => w.includes("'m1' did NOT start") && w.includes('DC drive')),
    ).toBe(true)
  })

  test('a load beyond breakdown torque STALLS — warned by name, drawing the locked-rotor current', () => {
    const stalledOp = inductionMotorOperatingPoint(imParams(200))
    expect(stalledOp.stalled).toBe(true)
    const { world, result } = runTransient(200)
    expect(result.warnings.some((w) => w.includes("Induction motor 'm1' is STALLED"))).toBe(true)
    const ratedOp = inductionMotorOperatingPoint(imParams(20))
    // With the dynamics live the stall is EMERGENT: the developed torque never beats the load, the
    // rotor stays at rest, and the locked-rotor current is sustained — not just asserted.
    const { iRms } = cycleStats(world, result)
    expect(iRms).toBeGreaterThan(3 * ratedOp.statorCurrentRms)
    expect(Math.abs(iRms - stalledOp.startupCurrentRms) / stalledOp.startupCurrentRms).toBeLessThan(
      0.03,
    )
  })

  test('an off-nameplate drive warns that the READINGS assume the nameplate…', () => {
    const sixtyHz = runTransient(20, 5, 1000, { hz: 60 })
    expect(sixtyHz.result.warnings.some((w) => w.includes('analyzed at its nameplate'))).toBe(true)
    // …and a nameplate-matched drive stays quiet.
    const matched = runTransient(20)
    expect(matched.result.warnings.some((w) => w.includes('analyzed at its nameplate'))).toBe(false)
  })

  /** The 50 Hz-nameplate machine as it really is at 60 Hz: inductances are frequency-independent,
   *  so every reactance scales ×(60/50) and synchronous speed is 1800 RPM. */
  const op60 = (loadTorque: number) => {
    const scale = 60 / 50
    return inductionMotorOperatingPoint({
      ...imParams(loadTorque),
      frequency: 60,
      statorReactance: 4 * scale,
      rotorReactance: 4 * scale,
      magnetizingReactance: 80 * scale,
    })
  }

  test('…but the MARCH is honest off-nameplate: a 60 Hz drive settles at the 60 Hz operating point', () => {
    // A 10 N·m load (below the 60 Hz STARTING torque, so it can accelerate from rest): the dq
    // march must land on the 60 Hz phasor solution — the old quasi-static model kept the 50 Hz
    // nameplate machine and could not do this.
    const { world, result } = runTransient(10, 30, 1000, { hz: 60 })
    expect(result.status).toBe('solved')
    const op = op60(10)
    expect(op.stalled).toBe(false)
    const settled = cycleStats(world, result, 1 / 60)
    expect(Math.abs(settled.iRms - op.statorCurrentRms) / op.statorCurrentRms).toBeLessThan(0.04)
    expect(Math.abs(settled.powerFactor - op.powerFactor)).toBeLessThan(0.04)
  })

  test('a load above the STARTING torque cannot start — real physics the steady analysis misses', () => {
    // At 60 Hz this machine's locked-rotor torque is ~15 N·m, below the 20 N·m load — yet a
    // running point EXISTS (breakdown ~33 N·m), so the steady-state solve is happy. From rest the
    // torque valley is unreachable: the rotor never moves and the locked-rotor current is
    // sustained. The march shows it, and the solver names it.
    const { world, result } = runTransient(20, 8, 1000, { hz: 60 })
    expect(result.status).toBe('solved')
    expect(result.warnings.some((w) => w.includes("'m1' did NOT start"))).toBe(true)
    // The NAMEPLATE stall check stays quiet — at 50 Hz this load runs fine; only the dynamic
    // march exposes the 60 Hz starting problem.
    expect(result.warnings.some((w) => w.includes('is STALLED'))).toBe(false)
    const { iRms } = cycleStats(world, result, 1 / 60)
    expect(iRms).toBeGreaterThan(2.5 * op60(20).statorCurrentRms)
  })

  test('no-load draws only the magnetizing current — less than the loaded run, matching its phasor', () => {
    const loaded = runTransient(20)
    const idle = runTransient(0, 40, 400) // ~6 τ of the no-load L/R settle, then measure
    const iLoaded = cycleStats(loaded.world, loaded.result).iRms
    const iIdle = cycleStats(idle.world, idle.result).iRms
    expect(iIdle).toBeLessThan(iLoaded)
    const opIdle = inductionMotorOperatingPoint(imParams(0))
    expect(Math.abs(iIdle - opIdle.statorCurrentRms) / opIdle.statorCurrentRms).toBeLessThan(0.03)
  })

  test('without a rotor_inertia the rotor is HELD at the nameplate speed — warned, old behavior kept', () => {
    const { world, result } = runTransient(20, 15, 1000, {}, null)
    expect(result.status).toBe('solved')
    expect(result.warnings.some((w) => w.includes("'m1' has no rotor_inertia"))).toBe(true)
    // No spin-up: cycle 2 already sits near the SETTLED current, not the locked-rotor inrush.
    const op = inductionMotorOperatingPoint(imParams(20))
    const early = windowStats(world, result, PERIOD, 2 * PERIOD)
    expect(early.iRms).toBeLessThan(2 * op.statorCurrentRms)
    const settled = cycleStats(world, result)
    expect(Math.abs(settled.iRms - op.statorCurrentRms) / op.statorCurrentRms).toBeLessThan(0.03)
  })

  test('a time step at or past a third of the drive period is REFUSED by name', () => {
    // The unseen-phase synthesis reads the delay line at t − T/3; a coarser step would silently
    // clamp to stale samples and march a machine that is no longer three-phase. Refuse, honestly.
    const { result } = runTransient(20, 5, 2)
    expect(result.status).toBe('solved')
    expect(
      result.warnings.some(
        (w) => w.includes("Skipped induction motor 'm1'") && w.includes('smaller time step'),
      ),
    ).toBe(true)
    // A refused motor was never marched — it must not also claim its waveform follows the drive.
    expect(result.warnings.some((w) => w.includes('analyzed at its nameplate'))).toBe(false)
  })

  test('a short window on a healthy start stays quiet — did-NOT-start means the clamp HELD', () => {
    // Three cycles is mid-spin-up: the rotor has broken away (ω > 0) but is nowhere near speed.
    // The did-NOT-start warning must not mislabel it.
    const { result } = runTransient(20, 3)
    expect(result.warnings.some((w) => w.includes('did NOT start'))).toBe(false)
  })

  test('a sub-volt drive that cannot start still gets the did-NOT-start warning', () => {
    // 0.5 V RMS is a real (if hopeless) drive — the energized gate sits at a 1 mV noise floor,
    // not at some machine-sized voltage, so the warning is not silently suppressed.
    const { result } = runTransient(20, 5, 1000, { rms: 0.5 })
    expect(result.warnings.some((w) => w.includes("'m1' did NOT start"))).toBe(true)
  })

  test('two AC frequencies on the motor’s circuit fall back to the nameplate period, by name', () => {
    // With more than one drive frequency the unseen-phase delay is ambiguous — the solver says
    // which period it chose instead of silently guessing.
    const nodes: CanvasNode[] = [
      {
        id: 'v1',
        definition: 'power_source',
        parameters: {
          nominal_voltage: scalar(0, 'volt'),
          ac_amplitude: scalar(230 * Math.SQRT2, 'volt'),
          frequency: scalar(50, 'hertz'),
          internal_resistance: scalar(0, 'ohm'),
        },
      },
      {
        id: 'v2',
        definition: 'power_source',
        parameters: {
          nominal_voltage: scalar(0, 'volt'),
          ac_amplitude: scalar(10 * Math.SQRT2, 'volt'),
          frequency: scalar(400, 'hertz'),
          internal_resistance: scalar(0, 'ohm'),
        },
      },
      { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(1000, 'ohm') } },
      { id: 'm1', definition: 'induction_motor', parameters: motorParameters(20, INERTIA) },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      g('v1', 'terminal_positive', 'm1', 'terminal_a'),
      g('m1', 'terminal_b', 'v1', 'terminal_negative'),
      g('v2', 'terminal_positive', 'r1', 'terminal_a'),
      g('r1', 'terminal_b', 'm1', 'terminal_a'),
      g('v2', 'terminal_negative', 'v1', 'terminal_negative'),
      g('v1', 'terminal_negative', 'gnd', 'reference_terminal'),
    ]
    const world = canvasToWorld(nodes, edges)
    const result = solveTransient(world, { timeStep: PERIOD / 1000, duration: 2 * PERIOD })
    expect(result.status).toBe('solved')
    expect(
      result.warnings.some((w) => w.includes('multiple AC source frequencies share its circuit')),
    ).toBe(true)
  })

  test('zero total leakage (X1 = X2 = 0) is refused — the flux model is genuinely singular', () => {
    const { result } = runTransient(20, 2, 1000, {}, INERTIA, {
      stator_reactance: scalar(0, 'ohm'),
      rotor_reactance: scalar(0, 'ohm'),
    })
    expect(result.status).toBe('solved')
    expect(result.warnings.some((w) => w.includes("Skipped induction motor 'm1'"))).toBe(true)
  })

  test('an ALTERNATOR drive is seen by the phase synthesis — same physics as an equal AC source', () => {
    // A 2-pole-pair alternator at 1200 RPM makes 40 Hz. The unseen-phase period must come from
    // the alternator's electrical frequency (the old scan only saw power_source instances and
    // silently synthesized at the 50 Hz nameplate — ~6× the correct current, no warning).
    const omegaElectrical = 2 * ((1200 * 2 * Math.PI) / 60)
    const fluxLinkage = (230 * Math.SQRT2) / omegaElectrical // EMF amplitude = k·ω_e = 230 V RMS
    const nodes: CanvasNode[] = [
      {
        id: 'alt',
        definition: 'alternator',
        parameters: {
          flux_linkage: scalar(fluxLinkage, 'V*s/rad'),
          winding_resistance: scalar(0.001, 'ohm'),
          pole_pairs: scalar(2, 'dimensionless'),
          drive_speed: scalar(1200, 'rpm'),
        },
      },
      { id: 'm1', definition: 'induction_motor', parameters: motorParameters(5, INERTIA) },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      g('alt', 'terminal_positive', 'm1', 'terminal_a'),
      g('m1', 'terminal_b', 'alt', 'terminal_negative'),
      g('alt', 'terminal_negative', 'gnd', 'reference_terminal'),
    ]
    const world = canvasToWorld(nodes, edges)
    const period40 = 1 / 40
    const result = solveTransient(world, { timeStep: period40 / 1000, duration: 12 * period40 })
    expect(result.status).toBe('solved')
    // The 40 Hz alternator is off the 50 Hz nameplate — the readings warning must SEE it too.
    expect(result.warnings.some((w) => w.includes('analyzed at its nameplate'))).toBe(true)
    // Same machine driven by an equal power_source at 40 Hz: the settled currents must agree.
    const viaSource = runTransient(5, 15, 1000, { rms: 230, hz: 40 })
    const altStats = cycleStats(world, result, period40)
    const srcStats = cycleStats(viaSource.world, viaSource.result, period40)
    expect(Math.abs(altStats.iRms - srcStats.iRms) / srcStats.iRms).toBeLessThan(0.02)
  })

  describe('magnetic saturation of the magnetizing branch', () => {
    // Knee at 1.1 pu of the rated peak flux (V·√2/ω = 1.0354 V·s → 1.1389 V·s) and a saturated
    // slope of 0.3·Xm = 24 Ω — inside the measured ranges (Hinkkanen et al. 2010: machines sit
    // near or past the knee at rated; incremental slope ~0.3–0.7× the chord there).
    const SAT = {
      magnetizing_knee_flux: scalar(1.1389, 'V*s'),
      saturated_magnetizing_reactance: scalar(24, 'ohm'),
    }

    test('below the knee the saturated machine IS the linear machine — sample for sample', () => {
      // Rated drive never crosses a 1.1 pu knee (peak |λ_m| ≈ 0.96 pu even during the start), and
      // below the knee the code returns the unsaturated constant directly — identical arithmetic,
      // so the two runs must agree at every recorded instant, not just in aggregate.
      const linear = runTransient(20, 6)
      const saturated = runTransient(20, 6, 1000, {}, INERTIA, SAT)
      expect(saturated.result.series.length).toBe(linear.result.series.length)
      for (let k = 0; k < linear.result.series.length; k += 250) {
        const iLin = linear.result.series[k]?.currents?.get('m1/terminal_a') ?? 0
        const iSat = saturated.result.series[k]?.currents?.get('m1/terminal_a') ?? 0
        expect(Math.abs(iSat - iLin)).toBeLessThan(1e-12)
      }
    })

    test('overvoltage no-load current rises SUPER-linearly — the real overfluxing signature', () => {
      // At 1.3 pu voltage the settled magnetizing flux sits past the knee: the linear model's
      // current scales ×1.3, the saturated machine draws ~1.22× MORE than that (verified against
      // an exact nonlinear reference during design). Balanced drive keeps the resultant flux
      // constant, so the saturated current stays sinusoidal — the chord just drops.
      const lin = runTransient(0, 40, 400, { rms: 299 })
      const sat = runTransient(0, 40, 400, { rms: 299 }, INERTIA, SAT)
      const iLin = cycleStats(lin.world, lin.result).iRms
      const iSat = cycleStats(sat.world, sat.result).iRms
      expect(iSat / iLin).toBeGreaterThan(1.12)
      expect(iSat / iLin).toBeLessThan(1.32)
    })

    test('half a magnetization curve stays linear — warned by name', () => {
      const { world, result } = runTransient(20, 2, 1000, {}, INERTIA, {
        magnetizing_knee_flux: scalar(1.1389, 'V*s'),
      })
      expect(result.status).toBe('solved')
      expect(result.warnings.some((w) => w.includes('magnetizing saturation needs BOTH'))).toBe(
        true,
      )
      const linear = runTransient(20, 2)
      const iLin = cycleStats(linear.world, linear.result).iRms
      const iHalf = cycleStats(world, result).iRms
      expect(Math.abs(iHalf - iLin)).toBeLessThan(1e-12)
    })

    test('a non-physical curve stays linear too — a saturated slope ABOVE Xm is refused', () => {
      const { world, result } = runTransient(20, 2, 1000, {}, INERTIA, {
        magnetizing_knee_flux: scalar(1.1389, 'V*s'),
        saturated_magnetizing_reactance: scalar(120, 'ohm'), // above the 80 Ω Xm — nonsense
      })
      expect(result.warnings.some((w) => w.includes('magnetizing saturation needs BOTH'))).toBe(
        true,
      )
      const linear = runTransient(20, 2)
      expect(
        Math.abs(cycleStats(world, result).iRms - cycleStats(linear.world, linear.result).iRms),
      ).toBeLessThan(1e-12)
    })

    test('a knee BELOW rated flux warns: the machine saturates at its own nameplate drive', () => {
      // Real machines commonly sit past the knee at rated (Hinkkanen 2010) — honest to model,
      // but then the READINGS panel's linear analysis reads low, and the solver must say so.
      const { result } = runTransient(20, 2, 1000, {}, INERTIA, {
        magnetizing_knee_flux: scalar(0.9318, 'V*s'), // 0.9 pu of V·√2/ω
        saturated_magnetizing_reactance: scalar(24, 'ohm'),
      })
      expect(result.status).toBe('solved')
      expect(result.warnings.some((w) => w.includes('saturates at its nameplate drive'))).toBe(true)
      // …and a knee above rated stays quiet.
      const above = runTransient(20, 2, 1000, {}, INERTIA, SAT)
      expect(above.result.warnings.some((w) => w.includes('saturates at its nameplate'))).toBe(
        false,
      )
    })

    test('the lagged chord is robust at a coarse step — T/100 lands near the T/400 answer', () => {
      const fine = runTransient(0, 40, 400, { rms: 299 }, INERTIA, SAT)
      const coarse = runTransient(0, 40, 100, { rms: 299 }, INERTIA, SAT)
      expect(coarse.result.status).toBe('solved')
      const iFine = cycleStats(fine.world, fine.result).iRms
      const iCoarse = cycleStats(coarse.world, coarse.result).iRms
      expect(Math.abs(iCoarse - iFine) / iFine).toBeLessThan(0.1)
    })

    test('a delta stator refers the curve with the winding: knee ÷√3, saturated slope ÷3', () => {
      const inst = {
        id: 'm',
        kind_ref: 'primitive_device',
        definition: 'induction_motor_three_phase',
        parameters: {
          supply_voltage: scalar(230, 'volt'),
          line_frequency: scalar(50, 'hertz'),
          pole_count: scalar(4, 'dimensionless'),
          stator_resistance: scalar(2, 'ohm'),
          stator_reactance: scalar(4, 'ohm'),
          rotor_resistance: scalar(2, 'ohm'),
          rotor_reactance: scalar(4, 'ohm'),
          magnetizing_reactance: scalar(80, 'ohm'),
          stator_connection: { value: 'delta' },
          magnetizing_knee_flux: scalar(1.2, 'V*s'),
          saturated_magnetizing_reactance: scalar(24, 'ohm'),
        },
      }
      const p = inductionMotorParamsFromInstance(inst as never)
      expect(p?.kneeFluxVs).toBeCloseTo(1.2 / Math.sqrt(3), 10)
      expect(p?.saturatedMagnetizingReactance).toBeCloseTo(24 / 3, 10)
    })
  })

  describe('deep-bar / skin effect — the double-cage rotor', () => {
    // The design-verification prototype machine (a 230 V-per-phase 50 Hz 4-pole class): outer
    // cage high-R low-X, inner cage low-R high-X. Marched AND analyzed at the same 230 V.
    const dblParams = (loadTorque: number, viscousFriction = 0.005): InductionMotorParams => ({
      supplyVoltage: 230,
      frequency: 50,
      poles: 4,
      statorResistance: 0.5,
      statorReactance: 1.5,
      rotorResistance: 1.2,
      rotorReactance: 1.0,
      magnetizingReactance: 40,
      rotorResistance2: 0.35,
      rotorReactance2: 2.5,
      loadTorque,
      viscousFriction,
    })
    const DBL_OVERRIDES = {
      stator_resistance: scalar(0.5, 'ohm'),
      stator_reactance: scalar(1.5, 'ohm'),
      rotor_resistance: scalar(1.2, 'ohm'),
      rotor_reactance: scalar(1, 'ohm'),
      magnetizing_reactance: scalar(40, 'ohm'),
      rotor_resistance_2: scalar(0.35, 'ohm'),
      rotor_reactance_2: scalar(2.5, 'ohm'),
      viscous_friction: scalar(0.005, 'N*m*s/rad'),
    }

    /** The RUNNING-EQUIVALENT single cage: the one matching the double-cage machine's rotor
     *  impedance exactly AT its operating slip (R2eq = s·Re(Z_rot(s)), X2eq = Im(Z_rot(s))) —
     *  identical running point by construction, so any starting-torque difference is purely
     *  the deep-bar physics. (X2∥X2b would be ~5× too little leakage — an unfair strawman.) */
    const runningEquivalent = (p: InductionMotorParams, slip: number): InductionMotorParams => {
      const a = { re: p.rotorResistance / slip, im: p.rotorReactance }
      const b = { re: (p.rotorResistance2 ?? 0) / slip, im: p.rotorReactance2 ?? 0 }
      const den = { re: a.re + b.re, im: a.im + b.im }
      const num = { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }
      const d2 = den.re * den.re + den.im * den.im
      const zRot = {
        re: (num.re * den.re + num.im * den.im) / d2,
        im: (num.im * den.re - num.re * den.im) / d2,
      }
      const single = { ...p, rotorResistance: slip * zRot.re, rotorReactance: zRot.im }
      delete (single as Record<string, unknown>).rotorResistance2
      delete (single as Record<string, unknown>).rotorReactance2
      return single
    }

    test('the cited ABB 45 kW machine: the double-cage fit reproduces the catalog starting torque — a single cage cannot', () => {
      // Monjo, Kojooyan-Jafari, Córcoles & Pedra (IEEE Trans. Energy Conversion 30(2), 2015,
      // Table II) fitted BOTH models to the same manufacturer-measured curves of one real ABB
      // 45 kW 400 V 50 Hz 4-pole machine (catalog: T_start/T_N = 2.6, I_start/I_N = 6.0,
      // T_N = 290.4 N·m, I_N = 86 A). Their circuit is exactly ours: two independent rotor
      // branches coupled only through Xm. The double-cage fit lands on the catalog starting
      // torque; the single-cage fit — the best single cage CAN do — misses it ~4×, which is
      // precisely why deep-bar rotors need two cages to model.
      const V = 400 / Math.sqrt(3)
      const dbl: InductionMotorParams = {
        supplyVoltage: V,
        frequency: 50,
        poles: 4,
        statorResistance: 0.15289,
        statorReactance: 0.13013,
        rotorResistance: 0.52409, // outer cage (their branch 2: high R, low X)
        rotorReactance: 0.13013,
        magnetizingReactance: 7.7219,
        rotorResistance2: 0.060444, // inner cage (their branch 1: low R, high X)
        rotorReactance2: 0.42844,
        loadTorque: 290.4,
        viscousFriction: 0,
      }
      const single: InductionMotorParams = {
        supplyVoltage: V,
        frequency: 50,
        poles: 4,
        statorResistance: 0.15289,
        statorReactance: 0.2432,
        rotorResistance: 0.0544,
        rotorReactance: 0.2432,
        magnetizingReactance: 6.6005,
        loadTorque: 290.4,
        viscousFriction: 0,
      }
      const tN = 290.4
      expect(electromagneticTorque(1, dbl) / tN).toBeGreaterThan(2.45) // catalog 2.6; model 2.56
      expect(electromagneticTorque(1, dbl) / tN).toBeLessThan(2.65)
      expect(electromagneticTorque(1, single) / tN).toBeLessThan(0.8) // the single cage's ceiling
      const op = inductionMotorOperatingPoint(dbl)
      expect(op.stalled).toBe(false)
      expect(op.startupCurrentRms / 86).toBeGreaterThan(5.2) // catalog 6.0; model 5.6
      expect(op.startupCurrentRms / 86).toBeLessThan(6.2)
    })

    test('against the running-equivalent single cage: same running point, >3× the locked-rotor torque', () => {
      const dbl = dblParams(40)
      const opDbl = inductionMotorOperatingPoint(dbl)
      const single = runningEquivalent(dbl, opDbl.slip)
      const opSingle = inductionMotorOperatingPoint(single)
      // Identical running point by construction…
      expect(Math.abs(opSingle.slip - opDbl.slip)).toBeLessThan(1e-5)
      expect(
        Math.abs(opSingle.statorCurrentRms - opDbl.statorCurrentRms) / opDbl.statorCurrentRms,
      ).toBeLessThan(1e-3)
      // …and the double cage starts more than 3× harder — the deep-bar payoff, isolated.
      expect(electromagneticTorque(1, dbl)).toBeGreaterThan(3 * electromagneticTorque(1, single))
    })

    test('the 6-state march settles exactly onto the parallel-two-cage phasor circuit', () => {
      const p = dblParams(40)
      const op = inductionMotorOperatingPoint(p)
      const L = dqInductancesFromParams(p)
      expect(L).not.toBeNull()
      if (L === null) throw new Error('unreachable')
      const T = 1 / 50
      const h = T / 400
      const core = createDqMotor(
        L,
        { rotorInertia: 0.05, viscousFriction: 0.005, loadTorque: 40 },
        0,
        T,
      )
      const v = (t: number) => 230 * Math.SQRT2 * Math.cos(2 * Math.PI * 50 * t)
      dqInitMotor(core, v(0))
      const steps = Math.round(2 / h)
      const lastTwoCycles: number[] = []
      for (let k = 1; k <= steps; k++) {
        const t = k * h
        dqStampMotor(core, t, h)
        const i = dqCommitMotor(core, v(t), h)
        if (k > steps - 800) lastTwoCycles.push(i)
      }
      const wSync = synchronousSpeedRadPerSec(50, 4)
      const slipMarch = 1 - core.omega / wSync
      // Absolute slip error, not relative — the trapezoid's absolute error is what is bounded.
      expect(Math.abs(slipMarch - op.slip)).toBeLessThan(1e-4)
      const iRms = Math.sqrt(lastTwoCycles.reduce((s, i) => s + i * i, 0) / lastTwoCycles.length)
      expect(Math.abs(iRms - op.statorCurrentRms) / op.statorCurrentRms).toBeLessThan(0.005)
    })

    test('a load only the deep-bar rotor can start: the running-equivalent machine never leaves standstill', () => {
      const dbl = dblParams(40)
      const opDbl = inductionMotorOperatingPoint(dbl)
      const single = runningEquivalent(dbl, opDbl.slip)
      // The equivalent single cage's starting torque sits BELOW the 40 N·m load (≈27 N·m)…
      expect(electromagneticTorque(1, single)).toBeLessThan(40)
      const cmpOverrides = {
        ...DBL_OVERRIDES,
        rotor_resistance: scalar(single.rotorResistance, 'ohm'),
        rotor_reactance: scalar(single.rotorReactance, 'ohm'),
      }
      delete (cmpOverrides as Record<string, unknown>).rotor_resistance_2
      delete (cmpOverrides as Record<string, unknown>).rotor_reactance_2
      const stuck = runTransient(40, 40, 200, {}, 0.05, cmpOverrides)
      expect(stuck.result.status).toBe('solved')
      expect(stuck.result.warnings.some((w) => w.includes("'m1' did NOT start"))).toBe(true)
      // …while the SAME machine with its real double cage runs straight up onto the phasor point.
      const runs = runTransient(40, 100, 200, {}, 0.05, DBL_OVERRIDES)
      expect(runs.result.warnings.some((w) => w.includes('did NOT start'))).toBe(false)
      const settled = cycleStats(runs.world, runs.result)
      expect(Math.abs(settled.iRms - opDbl.statorCurrentRms) / opDbl.statorCurrentRms).toBeLessThan(
        0.03,
      )
    })

    // The crawl machine (design-verified counterexample): pull-out max ≈95 N·m at s≈0.09, a
    // pull-up DIP ≈87 N·m at s≈0.25, and T(1)≈130 N·m. A 90 N·m load fits UNDER the start
    // torque but ABOVE the dip: the machine starts, then hangs at the high-slip stable root.
    const crawlParams: InductionMotorParams = {
      supplyVoltage: 230,
      frequency: 60,
      poles: 4,
      statorResistance: 0.5,
      statorReactance: 1.0,
      rotorResistance: 2.5,
      rotorReactance: 0.6,
      magnetizingReactance: 30,
      rotorResistance2: 0.35,
      rotorReactance2: 3.5,
      loadTorque: 90,
      viscousFriction: 0,
    }

    test('CRAWLING: the readings report the hang point AND name the better unreachable point', () => {
      const op = inductionMotorOperatingPoint(crawlParams)
      expect(op.stalled).toBe(false)
      expect(op.slip).toBeGreaterThan(0.34) // the high-slip stable root (≈0.353)
      expect(op.slip).toBeLessThan(0.37)
      expect(op.crawlBetterSlip ?? 0).toBeGreaterThan(0.055) // the unreachable run point (≈0.061)
      expect(op.crawlBetterSlip ?? 0).toBeLessThan(0.07)
      // A light load passes through the dip — clean start, no crawl report.
      const light = inductionMotorOperatingPoint({ ...crawlParams, loadTorque: 40 })
      expect(light.crawlBetterSlip).toBeUndefined()
      expect(light.slip).toBeLessThan(0.02)
      // A load beyond everything still stalls at locked rotor.
      const heavy = inductionMotorOperatingPoint({ ...crawlParams, loadTorque: 200 })
      expect(heavy.stalled).toBe(true)
      expect(heavy.slip).toBe(1)
    })

    test('…and the from-rest march genuinely HANGS at that same high-slip point', () => {
      const op = inductionMotorOperatingPoint(crawlParams)
      const L = dqInductancesFromParams(crawlParams)
      expect(L).not.toBeNull()
      if (L === null) throw new Error('unreachable')
      const T = 1 / 60
      const h = T / 300
      const core = createDqMotor(
        L,
        { rotorInertia: 0.03, viscousFriction: 0, loadTorque: 90 },
        0,
        T,
      )
      const v = (t: number) => 230 * Math.SQRT2 * Math.cos(2 * Math.PI * 60 * t)
      dqInitMotor(core, v(0))
      const steps = Math.round(0.8 / h)
      for (let k = 1; k <= steps; k++) {
        const t = k * h
        dqStampMotor(core, t, h)
        dqCommitMotor(core, v(t), h)
      }
      const slipMarch = 1 - core.omega / synchronousSpeedRadPerSec(60, 4)
      expect(Math.abs(slipMarch - op.slip)).toBeLessThan(0.02) // hangs at s≈0.35…
      expect(slipMarch).toBeGreaterThan(0.3) // …nowhere near the better point at s≈0.06
    })

    test('the transient solve NAMES the crawl', () => {
      const crawlOverrides = {
        stator_resistance: scalar(0.5, 'ohm'),
        stator_reactance: scalar(1, 'ohm'),
        rotor_resistance: scalar(2.5, 'ohm'),
        rotor_reactance: scalar(0.6, 'ohm'),
        magnetizing_reactance: scalar(30, 'ohm'),
        rotor_resistance_2: scalar(0.35, 'ohm'),
        rotor_reactance_2: scalar(3.5, 'ohm'),
        line_frequency: scalar(60, 'hertz'),
        viscous_friction: scalar(0, 'N*m*s/rad'),
      }
      const { result } = runTransient(90, 2, 400, { hz: 60 }, 0.03, crawlOverrides)
      expect(result.status).toBe('solved')
      expect(result.warnings.some((w) => w.includes("'m1' CRAWLS"))).toBe(true)
    })

    test('one cage parameter alone: a named note, and the march IS the single-cage march — sample for sample', () => {
      // Both one-param directions AND a non-physical zero — each must warn by name and leave
      // the machine exactly single-cage (a 0 Ω inner branch would be a superconducting cage).
      const plain = runTransient(20, 3)
      const partials = [
        { rotor_resistance_2: scalar(0.6, 'ohm') },
        { rotor_reactance_2: scalar(2.5, 'ohm') },
        { rotor_resistance_2: scalar(0, 'ohm'), rotor_reactance_2: scalar(2.5, 'ohm') },
      ]
      for (const overrides of partials) {
        const half = runTransient(20, 3, 1000, {}, INERTIA, overrides)
        expect(half.result.status).toBe('solved')
        expect(
          half.result.warnings.some((w) => w.includes('deep-bar double cage needs BOTH')),
        ).toBe(true)
        expect(half.result.series.length).toBe(plain.result.series.length)
        for (let k = 0; k < plain.result.series.length; k += 250) {
          const iHalf = half.result.series[k]?.currents?.get('m1/terminal_a') ?? 0
          const iPlain = plain.result.series[k]?.currents?.get('m1/terminal_a') ?? 0
          expect(Math.abs(iHalf - iPlain)).toBeLessThan(1e-12)
        }
      }
    })

    test('DC parity holds with the second cage present: both engines see exactly R1', () => {
      // At DC both rotor circuits carry nothing at steady state — the port is still just the
      // stator winding, in the march AND the DC stamp.
      const cage2 = {
        rotor_resistance_2: scalar(0.6, 'ohm'),
        rotor_reactance_2: scalar(8, 'ohm'),
      }
      const { world, result } = runTransient(20, 50, 40, { dc: 12 }, INERTIA, cage2)
      expect(result.status).toBe('solved')
      const iFinal = Math.abs(result.series.at(-1)?.currents?.get('m1/terminal_a') ?? 0)
      expect(Math.abs(iFinal - 6) / 6).toBeLessThan(0.02) // 12 V / R1 = 6 A
      const dc = solveDC(world)
      expect(Math.abs(dc.branches.get('m1') ?? 0)).toBeCloseTo(6, 3)
    })

    test('saturation composes with the double cage: below the knee it IS the linear double cage', () => {
      const cage2 = {
        rotor_resistance_2: scalar(0.6, 'ohm'),
        rotor_reactance_2: scalar(8, 'ohm'),
      }
      const linear = runTransient(20, 4, 1000, {}, INERTIA, cage2)
      const saturated = runTransient(20, 4, 1000, {}, INERTIA, {
        ...cage2,
        magnetizing_knee_flux: scalar(1.1389, 'V*s'), // 1.1 pu — rated drive never crosses it
        saturated_magnetizing_reactance: scalar(24, 'ohm'),
      })
      expect(saturated.result.series.length).toBe(linear.result.series.length)
      for (let k = 0; k < linear.result.series.length; k += 250) {
        const iLin = linear.result.series[k]?.currents?.get('m1/terminal_a') ?? 0
        const iSat = saturated.result.series[k]?.currents?.get('m1/terminal_a') ?? 0
        expect(Math.abs(iSat - iLin)).toBeLessThan(1e-12)
      }
    })

    test('…and ABOVE the knee the double-cage machine genuinely saturates — the chord runs through the 6-state path', () => {
      // The mutation the below-knee identity cannot see: pin the 6-state path's L_m to the
      // unsaturated constant and nothing changes below the knee. Overvoltage no-load — the same
      // overfluxing drive the single-cage saturation test pins — must draw super-linearly MORE
      // than the linear double-cage machine, proving the lagged chord feeds effectiveL6 for real.
      const cage2 = {
        rotor_resistance_2: scalar(0.6, 'ohm'),
        rotor_reactance_2: scalar(8, 'ohm'),
      }
      const lin = runTransient(0, 40, 400, { rms: 299 }, INERTIA, cage2)
      const sat = runTransient(0, 40, 400, { rms: 299 }, INERTIA, {
        ...cage2,
        magnetizing_knee_flux: scalar(1.1389, 'V*s'),
        saturated_magnetizing_reactance: scalar(24, 'ohm'),
      })
      const iLin = cycleStats(lin.world, lin.result).iRms
      const iSat = cycleStats(sat.world, sat.result).iRms
      expect(iSat / iLin).toBeGreaterThan(1.12)
      expect(iSat / iLin).toBeLessThan(1.32)
    })
  })

  describe('core loss — the iron branch', () => {
    // The default ~4 kW machine plus a core-loss resistance. R_c ≈ 400 Ω on this machine dissipates
    // a few hundred watts of iron loss (E_m ≈ 219 V at no load → ~360 W), a clearly measurable
    // effect. All marched AND analyzed at the nameplate 230 V.
    const RC = 400
    const coreParams = (loadTorque: number): InductionMotorParams => ({
      ...imParams(loadTorque),
      coreLossResistance: RC,
    })
    const CORE_OVERRIDE = { core_loss_resistance: scalar(RC, 'ohm') }

    /** Direct near-synchronous march of the 1-port machine (starts at the operating speed — this
     *  pins the SETTLED point, not the seconds-long spin-up). */
    const marchSettled = (p: InductionMotorParams, h = PERIOD / 400) => {
      const L = dqInductancesFromParams(p)
      if (L === null) throw new Error('null inductances')
      const wSync = synchronousSpeedRadPerSec(50, 4)
      const op = inductionMotorOperatingPoint(p)
      const core = createDqMotor(
        L,
        { rotorInertia: 0.05, viscousFriction: p.viscousFriction, loadTorque: p.loadTorque },
        0,
        PERIOD,
      )
      core.omega = (1 - op.slip) * wSync
      const v = (t: number) => 230 * Math.SQRT2 * Math.cos(2 * Math.PI * 50 * t)
      dqInitMotor(core, v(0))
      const steps = Math.round(2.5 / h)
      const last: number[] = []
      for (let k = 1; k <= steps; k++) {
        const t = k * h
        dqStampMotor(core, t, h)
        const i = dqCommitMotor(core, v(t), h)
        if (k > steps - 800) last.push(i)
      }
      const iRms = Math.sqrt(last.reduce((s, i) => s + i * i, 0) / last.length)
      return { slip: 1 - core.omega / wSync, iRms, op }
    }

    test('readings: the iron branch draws more no-load current and lowers the efficiency', () => {
      const lossless = inductionMotorOperatingPoint(imParams(0, 0))
      const lossy = inductionMotorOperatingPoint(coreParams(0))
      // No-load: the core-loss branch draws a real in-phase current on top of the magnetizing
      // current, so both the current and (especially) the power factor rise.
      expect(lossy.statorCurrentRms).toBeGreaterThan(lossless.statorCurrentRms)
      expect(lossy.powerFactor).toBeGreaterThan(lossless.powerFactor * 1.3)
      // Under load the efficiency honestly drops — the iron loss is real output the shaft never sees.
      const loadedLossless = inductionMotorOperatingPoint(imParams(20))
      const loadedLossy = inductionMotorOperatingPoint(coreParams(20))
      expect(loadedLossy.efficiency).toBeLessThan(loadedLossless.efficiency)
      // …but the developed torque is unchanged: the core loss sits outside the air gap.
      expect(loadedLossy.torque).toBeCloseTo(loadedLossless.torque, 1)
    })

    test('the 6-state iron-loss march settles exactly onto the phasor circuit (R_c ∥ jXm ∥ Z_rot)', () => {
      const { slip, iRms, op } = marchSettled(coreParams(20))
      expect(Math.abs(slip - op.slip)).toBeLessThan(1e-4)
      expect(Math.abs(iRms - op.statorCurrentRms) / op.statorCurrentRms).toBeLessThan(0.005)
    })

    test('the developed torque EXCLUDES the core loss — an unloaded machine does NOT run above synchronous', () => {
      // The trap the shipped stator-flux torque form falls into: with the iron branch it books
      // the core-loss power as shaft torque, settling an unloaded machine ABOVE synchronous speed
      // (negative slip — free energy from a loss resistor). The magnetizing×rotor form excludes
      // it, so a no-load machine settles at a small POSITIVE slip, below synchronous.
      const { slip, op } = marchSettled(coreParams(0), PERIOD / 400)
      expect(slip).toBeGreaterThan(0) // strictly sub-synchronous — no phantom accelerating torque
      expect(Math.abs(slip - op.slip)).toBeLessThan(1e-4)
    })

    test('DC parity holds with the iron branch: both engines see exactly R1 (the core draws nothing at DC)', () => {
      const { world, result } = runTransient(20, 50, 40, { dc: 12 }, INERTIA, CORE_OVERRIDE)
      expect(result.status).toBe('solved')
      const iFinal = Math.abs(result.series.at(-1)?.currents?.get('m1/terminal_a') ?? 0)
      expect(Math.abs(iFinal - 6) / 6).toBeLessThan(0.02) // 12 V / R1 = 6 A
      const dc = solveDC(world)
      expect(Math.abs(dc.branches.get('m1') ?? 0)).toBeCloseTo(6, 3)
    })

    test('a non-physical R_c is refused by name, and the machine stays exactly lossless — sample for sample', () => {
      const plain = runTransient(20, 3)
      const zero = runTransient(20, 3, 1000, {}, INERTIA, {
        core_loss_resistance: scalar(0, 'ohm'),
      })
      expect(zero.result.status).toBe('solved')
      expect(
        zero.result.warnings.some((w) => w.includes('core loss needs core_loss_resistance')),
      ).toBe(true)
      expect(zero.result.series.length).toBe(plain.result.series.length)
      for (let k = 0; k < plain.result.series.length; k += 250) {
        const iZero = zero.result.series[k]?.currents?.get('m1/terminal_a') ?? 0
        const iPlain = plain.result.series[k]?.currents?.get('m1/terminal_a') ?? 0
        expect(Math.abs(iZero - iPlain)).toBeLessThan(1e-12)
      }
    })

    test('the LEAKAGE guard is load-bearing: R_c with a zero leakage stays lossless, not NaN', () => {
      // The iron-loss march reads each winding current off its own leakage flux (i_s = (λ_s −
      // λ_m)/L_ls), so a zero leakage would divide by zero. The predicate's X1/X2/Xm > 0 clause
      // keeps such a machine on the lossless path — where L_ls never appears in a denominator —
      // so it marches finite. A zero stator leakage clears the resolver's own guards (they only
      // refuse a NEGATIVE reactance), so this is the case the iron branch alone must reject.
      const plain = runTransient(20, 3, 1000, {}, INERTIA, { stator_reactance: scalar(0, 'ohm') })
      const withRc = runTransient(20, 3, 1000, {}, INERTIA, {
        stator_reactance: scalar(0, 'ohm'),
        core_loss_resistance: scalar(400, 'ohm'),
      })
      expect(withRc.result.status).toBe('solved')
      expect(withRc.result.warnings.some((w) => w.includes('X1, X2, Xm all > 0'))).toBe(true)
      expect(withRc.result.series.length).toBe(plain.result.series.length)
      for (let k = 0; k < plain.result.series.length; k += 250) {
        const iRc = withRc.result.series[k]?.currents?.get('m1/terminal_a') ?? 0
        const iPlain = plain.result.series[k]?.currents?.get('m1/terminal_a') ?? 0
        expect(Number.isFinite(iRc)).toBe(true) // not NaN
        expect(Math.abs(iRc - iPlain)).toBeLessThan(1e-12)
      }
    })

    test('core loss composes with the double cage: the 8-state march settles onto ITS phasor circuit', () => {
      const p: InductionMotorParams = {
        ...imParams(20),
        rotorResistance2: 0.6,
        rotorReactance2: 8,
        coreLossResistance: RC,
      }
      const { slip, iRms, op } = marchSettled(p)
      expect(slip).toBeGreaterThan(0)
      expect(Math.abs(slip - op.slip)).toBeLessThan(1e-4)
      expect(Math.abs(iRms - op.statorCurrentRms) / op.statorCurrentRms).toBeLessThan(0.006)
    })

    test('core loss composes with saturation: below the knee bit-identical, above the knee still saturates', () => {
      // Below the knee the chord is the unsaturated constant → the iron-loss march is identical
      // with or without the (uncrossed) magnetization curve.
      const linear = runTransient(20, 4, 1000, {}, INERTIA, CORE_OVERRIDE)
      const belowKnee = runTransient(20, 4, 1000, {}, INERTIA, {
        ...CORE_OVERRIDE,
        magnetizing_knee_flux: scalar(1.1389, 'V*s'),
        saturated_magnetizing_reactance: scalar(24, 'ohm'),
      })
      expect(belowKnee.result.series.length).toBe(linear.result.series.length)
      for (let k = 0; k < linear.result.series.length; k += 250) {
        const iLin = linear.result.series[k]?.currents?.get('m1/terminal_a') ?? 0
        const iBk = belowKnee.result.series[k]?.currents?.get('m1/terminal_a') ?? 0
        expect(Math.abs(iBk - iLin)).toBeLessThan(1e-12)
      }
      // Overvoltage past the knee: the iron-loss machine still overfluxes super-linearly (the
      // chord reads |λ_m| straight off the new state and runs through the iron-loss matrices).
      const lin = runTransient(0, 40, 400, { rms: 299 }, INERTIA, CORE_OVERRIDE)
      const sat = runTransient(0, 40, 400, { rms: 299 }, INERTIA, {
        ...CORE_OVERRIDE,
        magnetizing_knee_flux: scalar(1.1389, 'V*s'),
        saturated_magnetizing_reactance: scalar(24, 'ohm'),
      })
      expect(
        cycleStats(sat.world, sat.result).iRms / cycleStats(lin.world, lin.result).iRms,
      ).toBeGreaterThan(1.1)
    })

    test('a delta stator refers the core-loss resistance ÷3 like every impedance', () => {
      const inst = {
        id: 'm',
        kind_ref: 'primitive_device',
        definition: 'induction_motor_three_phase',
        parameters: {
          supply_voltage: scalar(230, 'volt'),
          line_frequency: scalar(50, 'hertz'),
          pole_count: scalar(4, 'dimensionless'),
          stator_resistance: scalar(2, 'ohm'),
          stator_reactance: scalar(4, 'ohm'),
          rotor_resistance: scalar(2, 'ohm'),
          rotor_reactance: scalar(4, 'ohm'),
          magnetizing_reactance: scalar(80, 'ohm'),
          core_loss_resistance: scalar(900, 'ohm'),
          stator_connection: { value: 'delta' },
        },
      }
      const p = inductionMotorParamsFromInstance(inst as never)
      expect(p?.coreLossResistance).toBeCloseTo(900 / 3, 10)
    })
  })
})

describe('induction motor on DC — the branch current is recorded, so the books balance', () => {
  // On DC the motor is its stator R1 (no rotating field, no torque — it just heats). The DC solver
  // must RECORD that Ohm's-law current like its machine siblings: without it the Math panel's KCL
  // re-sum showed a false ±6 A residual at the motor's nets, and the power reading never computed.
  const dcWorld = () => {
    const nodes: CanvasNode[] = [
      {
        id: 'bat',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(12, 'volt'), internal_resistance: scalar(0, 'ohm') },
      },
      {
        id: 'm1',
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
      g('bat', 'terminal_positive', 'm1', 'terminal_a'),
      g('m1', 'terminal_b', 'bat', 'terminal_negative'),
      g('gnd', 'reference_terminal', 'bat', 'terminal_negative'),
    ]
    return canvasToWorld(nodes, edges)
  }

  test('the DC solve records V/R1 through the motor (12 V across 2 Ω → 6 A)', () => {
    const world = dcWorld()
    const sol = solveDC(world)
    expect(sol.status).toBe('solved')
    expect(Math.abs(sol.branches.get('m1') ?? 0)).toBeCloseTo(6, 6)
    // …and the real DC electrical power (all winding heat) computes for the reading.
    const reading = partReadings(world, sol).get('m1')
    expect(reading?.power ?? 0).toBeCloseTo(72, 4)
  })

  test('the Math panel’s KCL re-sum closes at the motor’s nets (no false residual)', () => {
    const world = dcWorld()
    const view = buildMathView(world, solveDC(world))
    expect(view.nets.length).toBeGreaterThan(1)
    for (const net of view.nets) {
      expect(net.sumAmps).not.toBeNull()
      expect(Math.abs(net.sumAmps ?? 1)).toBeLessThan(1e-9)
    }
  })
})
