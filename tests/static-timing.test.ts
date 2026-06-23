import { describe, expect, test } from 'vitest'
import {
  analyzeTiming,
  criticalPath,
  gatePropagationDelay,
  holdCheck,
  LN2,
  loadCapacitance,
  type RegisterTiming,
  rcGateDelay,
  setupCheck,
  synchronizerMtbf,
  type TimingPath,
  triodeOnResistance,
} from '../src/static-timing.ts'

const reg: RegisterTiming = { clockToQ: 1e-9, setup: 0.5e-9, hold: 0.2e-9 }
const path = (from: string, to: string, max: number, min: number, gates: string[]): TimingPath => ({
  from,
  to,
  logicDelayMax: max,
  logicDelayMin: min,
  gates,
})

describe('rcGateDelay — real delay from real R and C (t = ln2·R·C)', () => {
  test('1 kΩ driving 1 pF → ~0.69 ns', () => {
    expect(rcGateDelay(1000, 1e-12)).toBeCloseTo(LN2 * 1e-9, 18)
  })
  test('non-positive R or C → 0 (no load, no delay)', () => {
    expect(rcGateDelay(0, 1e-12)).toBe(0)
    expect(rcGateDelay(1000, 0)).toBe(0)
  })
})

describe('setupCheck — clock period must cover t_cq + t_logic,max + t_setup + t_skew', () => {
  test('4.5 ns critical path → ~222 MHz max, positive slack at 5 ns', () => {
    const r = setupCheck(path('A', 'B', 3e-9, 1e-9, ['g1', 'g2']), reg, 5e-9)
    expect(r.minPeriod).toBeCloseTo(4.5e-9, 18)
    expect(1 / r.maxFrequency).toBeCloseTo(4.5e-9, 18) // f_max = 1 / T_min
    expect(r.slack).toBeCloseTo(0.5e-9, 18)
    expect(r.violated).toBe(false)
  })
  test('clocking it too fast (4 ns < 4.5 ns) → negative slack, setup violation', () => {
    const r = setupCheck(path('A', 'B', 3e-9, 1e-9, ['g1']), reg, 4e-9)
    expect(r.slack).toBeCloseTo(-0.5e-9, 18)
    expect(r.violated).toBe(true)
  })
  test('clock skew is charged against setup (raises T_min)', () => {
    const r = setupCheck(path('A', 'B', 3e-9, 1e-9, ['g1']), reg, 5e-9, 0.2e-9)
    expect(r.minPeriod).toBeCloseTo(4.7e-9, 18)
  })
})

describe('holdCheck — fast path must clear the hold window, at ANY clock speed', () => {
  test('slow launch + long min-path → comfortable hold, no violation', () => {
    expect(holdCheck(path('A', 'B', 3e-9, 1e-9, []), reg).violated).toBe(false)
  })
  test('fast flop + short min-path + skew → hold violation (unfixable by the clock)', () => {
    const fast: RegisterTiming = { clockToQ: 0.1e-9, setup: 0.5e-9, hold: 0.3e-9 }
    const r = holdCheck(path('A', 'B', 1e-9, 0.05e-9, []), fast, 0.1e-9)
    expect(r.slack).toBeCloseTo(-0.25e-9, 18) // (0.1 + 0.05) − (0.3 + 0.1)
    expect(r.violated).toBe(true)
  })
})

describe('criticalPath + analyzeTiming — the slowest path sets the clock', () => {
  const paths = [
    path('A', 'B', 3e-9, 1e-9, ['g1', 'g2']),
    path('C', 'D', 6e-9, 2e-9, ['g3', 'g4', 'g5']), // the slow one
    path('E', 'F', 2e-9, 0.5e-9, ['g6']),
  ]
  test('critical path is the largest worst-case delay', () => {
    expect(criticalPath(paths)?.from).toBe('C')
  })
  test('design max frequency is limited by the critical path', () => {
    const report = analyzeTiming(paths, reg, 10e-9)
    expect(report.critical?.from).toBe('C')
    expect(report.minPeriod).toBeCloseTo(7.5e-9, 18) // 1 + 6 + 0.5
    expect(1 / report.maxFrequency).toBeCloseTo(7.5e-9, 18)
    expect(report.setupViolated).toBe(false)
  })
  test('empty design → no critical path, unbounded frequency', () => {
    const report = analyzeTiming([], reg, 10e-9)
    expect(report.critical).toBeUndefined()
    expect(report.maxFrequency).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('synchronizerMtbf — exponential in the settling time available', () => {
  test('doubling t_MET from 200→400 ps (C2=50 ps) multiplies MTBF by e^4 (~54.6×)', () => {
    const a = synchronizerMtbf(200e-12, 50e-12, 1e-9, 100e6, 1e6)
    const b = synchronizerMtbf(400e-12, 50e-12, 1e-9, 100e6, 1e6)
    expect(b / a).toBeCloseTo(Math.exp(4), 3)
  })
  test('a degenerate denominator is treated as infinitely safe rather than dividing by zero', () => {
    expect(synchronizerMtbf(200e-12, 50e-12, 1e-9, 0, 1e6)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('triodeOnResistance — R_on derived from the device model (1/(k·V_OV))', () => {
  test('a 2N7000 at V_GS=10 V reproduces the datasheet R_DS(on) ≤ 5 Ω', () => {
    // k = 26 mA/V², V_th = 2.1 V → overdrive 7.9 V at V_GS = 10 V
    expect(triodeOnResistance(0.026, 7.9)).toBeCloseTo(4.87, 2)
  })
  test('an off transistor (no overdrive) has infinite on-resistance', () => {
    expect(triodeOnResistance(0.026, 0)).toBe(Number.POSITIVE_INFINITY)
    expect(triodeOnResistance(0.026, -1)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('loadCapacitance + gatePropagationDelay — a real, ns-scale gate delay', () => {
  test('load = the fan-out C_iss summed + the wire C', () => {
    expect(loadCapacitance([60e-12, 60e-12, 60e-12, 60e-12], 10e-12)).toBeCloseTo(250e-12, 15)
  })
  test('a 2N7000 driving four gates + 10 pF wire → ~0.84 ns (discrete-logic scale)', () => {
    const t = gatePropagationDelay(0.026, 7.9, [60e-12, 60e-12, 60e-12, 60e-12], 10e-12)
    expect(t).toBeCloseTo(8.44e-10, 11) // ln2 · 4.87 Ω · 250 pF
  })
  test('an off driver never switches → infinite delay', () => {
    expect(gatePropagationDelay(0.026, 0, [60e-12], 0)).toBe(Number.POSITIVE_INFINITY)
  })
})
