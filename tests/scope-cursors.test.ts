/**
 * Scope cursor tests (S19-v3-79) — the cursor reads the drawn polyline
 * (linear interpolation between recorded samples), refuses to read outside
 * the record, and the readout deltas are signed B-minus-A.
 */

import { describe, expect, test } from 'vitest'
import { cursorReadout, interpolateSeries } from '../src/renderer/scope-cursors.ts'

describe('interpolateSeries', () => {
  const ramp = [
    { t: 0, v: 0 },
    { t: 1, v: 10 },
    { t: 2, v: 10 },
    { t: 3, v: -10 },
  ]

  test('a cursor on a sample reads that sample exactly', () => {
    expect(interpolateSeries(ramp, 1)).toBe(10)
    expect(interpolateSeries(ramp, 3)).toBe(-10)
  })

  test('between samples it reads the straight segment the plot draws', () => {
    expect(interpolateSeries(ramp, 0.5)).toBeCloseTo(5, 12)
    expect(interpolateSeries(ramp, 2.25)).toBeCloseTo(5, 12)
  })

  test('outside the record it reads nothing, not zero', () => {
    expect(interpolateSeries(ramp, -0.1)).toBeNull()
    expect(interpolateSeries(ramp, 3.1)).toBeNull()
    expect(interpolateSeries([], 0)).toBeNull()
  })

  test('a long record interpolates correctly (binary search path)', () => {
    const sine = Array.from({ length: 1001 }, (_, i) => ({
      t: i / 1000,
      v: Math.sin(2 * Math.PI * (i / 1000)),
    }))
    // Halfway between two samples near the steepest part of the curve.
    const t = 0.2505
    const lo = Math.sin(2 * Math.PI * 0.25)
    const hi = Math.sin(2 * Math.PI * 0.251)
    expect(interpolateSeries(sine, t)).toBeCloseTo((lo + hi) / 2, 12)
  })
})

describe('cursorReadout', () => {
  test('deltas are signed, B minus A', () => {
    const r = cursorReadout({ t: 0.25e-3, v: 4.5 }, { t: 0.75e-3, v: -4.5 })
    expect(r.deltaT).toBeCloseTo(0.5e-3, 12)
    expect(r.inverseDeltaT).toBeCloseTo(2000, 6)
    expect(r.deltaV).toBeCloseTo(-9, 12)
  })

  test('one full period reads 1/deltaT as the source frequency', () => {
    const r = cursorReadout({ t: 0, v: 0 }, { t: 1e-3, v: 0 })
    expect(r.inverseDeltaT).toBeCloseTo(1000, 9)
    expect(r.deltaV).toBe(0)
  })

  test('coincident cursors give no 1/deltaT instead of infinity', () => {
    const r = cursorReadout({ t: 1, v: 2 }, { t: 1, v: 2 })
    expect(r.deltaT).toBe(0)
    expect(r.inverseDeltaT).toBeNull()
  })

  test('a cursor off the record blanks deltaV but not deltaT', () => {
    const r = cursorReadout({ t: 0, v: null }, { t: 1, v: 5 })
    expect(r.deltaV).toBeNull()
    expect(r.deltaT).toBe(1)
  })
})
