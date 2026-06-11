/**
 * Waveform measurement tests (S19-v3-80) — the shared instrument math:
 * levels (Vpp / mean / AC-true-RMS), the Schmitt-hysteresis frequency
 * counter, exact-segment duty cycle, and interpolated 10–90 % rise/fall.
 * Analytic targets: a sine's AC RMS is A/√2 and its 10–90 % rise time is
 * 2·asin(0.8)/(2πf) ≈ 0.2952/f.
 */

import { describe, expect, test } from 'vitest'
import { measureSeries } from '../src/renderer/waveform-measure.ts'

// Whole cycles WITHOUT a duplicated endpoint (t = 0 and t = cycles/hz are the
// same phase — including both would bias the discrete mean/RMS).
function sine(amplitude: number, hz: number, offset: number, cycles: number, perCycle: number) {
  const n = Math.round(cycles * perCycle)
  return Array.from({ length: n }, (_, i) => {
    const t = i / (perCycle * hz)
    return { t, v: offset + amplitude * Math.sin(2 * Math.PI * hz * t) }
  })
}

describe('measureSeries on a sine', () => {
  const m = measureSeries(sine(5, 1000, 0, 3, 500))

  test('levels: Vpp = 2A, mean = 0, RMS = A/√2', () => {
    expect(m.vpp).toBeCloseTo(10, 3)
    expect(m.mean).toBeCloseTo(0, 6)
    expect(m.rmsAc).toBeCloseTo(5 / Math.SQRT2, 3)
  })

  test('timing: 1 kHz, 1 ms period, 50 % duty', () => {
    expect(m.hz).toBeCloseTo(1000, 6)
    expect(m.periodS).toBeCloseTo(1e-3, 9)
    expect(m.dutyHigh).toBeCloseTo(0.5, 3)
  })

  test('rise and fall are the analytic 0.2952/f, symmetric', () => {
    // 10 % → 90 % of the swing spans asin(-0.8)..asin(0.8) of phase.
    const analytic = (2 * Math.asin(0.8)) / (2 * Math.PI * 1000)
    expect(m.riseS).toBeCloseTo(analytic, 7)
    expect(m.fallS).toBeCloseTo(analytic, 7)
  })

  test('a DC offset moves the mean and nothing else', () => {
    const shifted = measureSeries(sine(5, 1000, 4.5, 3, 500))
    expect(shifted.mean).toBeCloseTo(4.5, 6)
    expect(shifted.rmsAc).toBeCloseTo(5 / Math.SQRT2, 3)
    expect(shifted.dutyHigh).toBeCloseTo(0.5, 3)
    expect(shifted.hz).toBeCloseTo(1000, 6)
  })
})

describe('measureSeries on a square wave', () => {
  // 1 kHz, 0..5 V, 30 % high — sampled finely so the edges are one step wide.
  const dt = 1e-6
  const square = Array.from({ length: 3001 }, (_, i) => {
    const t = i * dt
    const phase = (t * 1000) % 1
    return { t, v: phase < 0.3 ? 5 : 0 }
  })
  const m = measureSeries(square)

  test('levels and duty: Vpp 5, mean 1.5, 30 % high', () => {
    expect(m.vpp).toBeCloseTo(5, 6)
    expect(m.mean).toBeCloseTo(1.5, 2)
    expect(m.dutyHigh).toBeCloseTo(0.3, 2)
  })

  test('frequency counts 1 kHz; the edges are as fast as the sampling', () => {
    expect(m.hz).toBeCloseTo(1000, 3)
    // A one-sample edge can't read faster than the sample spacing — honest.
    expect(m.riseS).toBeLessThanOrEqual(dt)
    expect(m.riseS).toBeGreaterThan(0)
  })
})

describe('honest refusals', () => {
  test('a flat line has levels but no timing', () => {
    const flat = measureSeries(Array.from({ length: 100 }, (_, i) => ({ t: i * 1e-5, v: 9 })))
    expect(flat.vpp).toBe(0)
    expect(flat.mean).toBeCloseTo(9, 9)
    expect(flat.rmsAc).toBe(0)
    expect(flat.hz).toBeNull()
    expect(flat.periodS).toBeNull()
    expect(flat.dutyHigh).toBeNull()
    expect(flat.riseS).toBeNull()
    expect(flat.fallS).toBeNull()
  })

  test('a microvolt wiggle keeps its shape numbers but no counted frequency (the counter gate)', () => {
    const m = measureSeries(sine(5e-6, 1000, 0, 3, 500))
    expect(m.vpp).toBeCloseTo(1e-5, 9)
    expect(m.hz).toBeNull()
    expect(m.dutyHigh).toBeCloseTo(0.5, 3)
  })

  test('fewer than two samples returns levels only, never throws', () => {
    const single = measureSeries([{ t: 0, v: 3 }])
    expect(single.mean).toBe(3)
    expect(single.hz).toBeNull()
    expect(measureSeries([]).mean).toBe(0)
  })

  test('a half-wave hump still counts exactly (same-direction events)', () => {
    const hump = Array.from({ length: 1501 }, (_, i) => {
      const t = i / 500000
      const s = Math.sin(2 * Math.PI * 1000 * t)
      return { t, v: s > 0 ? 5 * s : 0 }
    })
    expect(measureSeries(hump).hz).toBeCloseTo(1000, 3)
  })
})
