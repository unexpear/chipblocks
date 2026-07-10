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

describe('induction motor — a live R–L load in the time-domain solve', () => {
  // The marched waveform must reproduce the PHASOR operating point: drive the motor from an AC
  // source at its nameplate voltage + frequency, march five cycles, and measure the line current's
  // RMS and the power factor from the samples — they must match the steady-state analysis (the
  // equivalent circuit collapsed to R + jX at the settled slip is the same physics, marched).
  const PERIOD = 1 / 50
  const runTransient = (
    loadTorque: number,
    cycles = 5,
    stepsPerCycle = 1000,
    source: { rms?: number; hz?: number; dc?: number } = {},
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
        parameters: {
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
        },
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

  /** RMS voltage/current + power factor over the LAST two full cycles — past the switch-on
   *  transient (a REAL asymmetric R–L inrush whose DC offset decays with τ = L/R; at no load the
   *  motor is nearly all magnetizing reactance, X/R ≈ 42, so τ ≈ 134 ms — the run must outlast it). */
  const cycleStats = (world: ReturnType<typeof canvasToWorld>, result: TransientResult) => {
    const tEnd = result.series.at(-1)?.time ?? 0
    const tStart = tEnd - 2 * PERIOD
    const connects = world.instances.get('m1')?.connects ?? []
    const netA = connects.find((c) => c.terminal === 'terminal_a')?.net ?? ''
    const netB = connects.find((c) => c.terminal === 'terminal_b')?.net ?? ''
    let sumV2 = 0
    let sumI2 = 0
    let sumP = 0
    let n = 0
    for (const p of result.series) {
      if (p.time < tStart - 1e-12) continue
      const v = (p.nodes.get(netA) ?? 0) - (p.nodes.get(netB) ?? 0)
      const i = p.currents?.get('m1/terminal_a') ?? 0
      sumV2 += v * v
      sumI2 += i * i
      sumP += v * i
      n += 1
    }
    const vRms = Math.sqrt(sumV2 / n)
    const iRms = Math.sqrt(sumI2 / n)
    return { vRms, iRms, powerFactor: sumP / n / (vRms * iRms) }
  }

  test('the marched line current matches the phasor solution — magnitude AND power factor', () => {
    // 15 cycles: the ladder's magnetizing loop adds a slower settle mode than a single R–L —
    // measure the last two cycles well past it.
    const { world, result } = runTransient(20, 15)
    expect(result.status).toBe('solved')
    expect(result.warnings.filter((w) => w.startsWith('Unsupported element'))).toEqual([])
    expect(result.warnings.filter((w) => w.includes('Skipped induction motor'))).toEqual([])
    const op = inductionMotorOperatingPoint(imParams(20))
    const { vRms, iRms, powerFactor } = cycleStats(world, result)
    expect(Math.abs(vRms - 230) / 230).toBeLessThan(0.02) // the source really drives 230 V RMS
    expect(Math.abs(iRms - op.statorCurrentRms) / op.statorCurrentRms).toBeLessThan(0.03)
    expect(Math.abs(powerFactor - op.powerFactor)).toBeLessThan(0.03)
  })

  test('DC content sees exactly the stator R1 — the transient march agrees with the DC solver', () => {
    // The ladder's load-bearing property: at DC the inductances short, so a 12 V battery must drive
    // V/R1 = 6 A — the same answer the DC engine gives (a collapsed R-L would sit ~16x low). The
    // magnetizing loop settles with tau = Lm/R1 ≈ 127 ms, so march 1 s and read the settled current.
    const { result } = runTransient(20, 50, 40, { dc: 12 })
    expect(result.status).toBe('solved')
    const last = result.series.at(-1)
    const iFinal = Math.abs(last?.currents?.get('m1/terminal_a') ?? 0)
    expect(Math.abs(iFinal - 12 / 2) / 6).toBeLessThan(0.02)
  })

  test('a load beyond breakdown torque STALLS — warned by name, drawing the locked-rotor current', () => {
    const stalledOp = inductionMotorOperatingPoint(imParams(200))
    expect(stalledOp.stalled).toBe(true)
    const { world, result } = runTransient(200)
    expect(result.warnings.some((w) => w.includes("Induction motor 'm1' is STALLED"))).toBe(true)
    const ratedOp = inductionMotorOperatingPoint(imParams(20))
    const { iRms } = cycleStats(world, result)
    expect(iRms).toBeGreaterThan(3 * ratedOp.statorCurrentRms) // the big starting current, for real
    expect(Math.abs(iRms - stalledOp.startupCurrentRms) / stalledOp.startupCurrentRms).toBeLessThan(
      0.03,
    )
  })

  test('an off-nameplate drive warns — the slip and reactances assume the nameplate', () => {
    const sixtyHz = runTransient(20, 5, 1000, { hz: 60 })
    expect(sixtyHz.result.warnings.some((w) => w.includes('analyzed at its nameplate'))).toBe(true)
    // …and a nameplate-matched drive stays quiet.
    const matched = runTransient(20)
    expect(matched.result.warnings.some((w) => w.includes('analyzed at its nameplate'))).toBe(false)
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
