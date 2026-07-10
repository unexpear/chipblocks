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
  electromagneticTorque,
  type InductionMotorParams,
  inductionMotorOperatingPoint,
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
