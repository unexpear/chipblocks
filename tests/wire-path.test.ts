/**
 * Wire path geometry tests (S19-v3-61) — the ONE module that computes both the
 * drawn shape and the physical length of a routed wire. The fillet length is
 * checked against the closed-form arc length of the symmetric quadratic
 * Bézier: for a 90° corner with fillet distance r, the curve is
 * B(t) = (r(1−t)², rt²), whose length is 2r·∫₀¹√(2t²−2t+1)dt = 1.623204·r
 * (the integral evaluates to 0.811602 via the standard √(u²+a²) antiderivative).
 */

import { describe, expect, test } from 'vitest'
import {
  CURVE_SIZES,
  polylineLength,
  roundedPathD,
  roundedPathLength,
} from '../src/renderer/wire-path.ts'

describe('polylineLength', () => {
  test('sums straight segments exactly (3-4-5 triangle legs)', () => {
    expect(
      polylineLength([
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 4 },
      ]),
    ).toBeCloseTo(7, 12)
  })
  test('a two-point path is just the distance', () => {
    expect(
      polylineLength([
        { x: 0, y: 0 },
        { x: 3, y: 4 },
      ]),
    ).toBeCloseTo(5, 12)
  })
})

describe('roundedPathLength (curve subtool)', () => {
  test('collinear points round to exactly the straight length', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ]
    expect(roundedPathLength(points)).toBeCloseTo(100, 6)
  })

  test('a 90° corner matches the closed-form quadratic arc length', () => {
    // Arms of 100 px with a 14 px fillet: 86 + 86 straight, plus the Bézier
    // crossing the corner: 1.623204 × 14 = 22.7249 px → 194.7249 total.
    const points = [
      { x: 0, y: 100 },
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]
    const expected = 86 + 86 + 1.623204 * 14
    expect(Math.abs(roundedPathLength(points, 14) - expected)).toBeLessThan(0.2)
  })

  test('rounding CUTS the corner — always shorter than the sharp route', () => {
    const points = [
      { x: 0, y: 100 },
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
    ]
    expect(roundedPathLength(points)).toBeLessThan(polylineLength(points))
  })

  test('the fillet clamps to half of short segments instead of overshooting', () => {
    const points = [
      { x: 0, y: 10 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]
    const length = roundedPathLength(points, 14) // radius bigger than the arms
    expect(length).toBeGreaterThan(10) // it still goes around the corner
    expect(length).toBeLessThan(20) // …but shorter than the sharp route
  })

  test('curve sizes (S19-v3-70): a bigger sweep cuts more corner — really shorter', () => {
    // Long arms so no preset clamps: each size must measure its own length,
    // and Wide < Round < Gentle < sharp. Per corner the saving is
    // (2 − 1.623204)·r, so Gentle→Wide differs by 0.376796 × (56 − 14).
    const points = [
      { x: 0, y: 200 },
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ]
    const sharp = polylineLength(points)
    const sizes = CURVE_SIZES.map((s) => roundedPathLength(points, s.radiusPx))
    const [gentle, round, wide] = sizes
    if (gentle === undefined || round === undefined || wide === undefined) {
      throw new Error('expected three curve sizes')
    }
    expect(wide).toBeLessThan(round)
    expect(round).toBeLessThan(gentle)
    expect(gentle).toBeLessThan(sharp)
    expect(Math.abs(gentle - wide - 0.376796 * (56 - 14))).toBeLessThan(0.2)
  })

  test('an oversized sweep on short arms saturates at the clamp — same as the clamp value', () => {
    const points = [
      { x: 0, y: 30 },
      { x: 0, y: 0 },
      { x: 30, y: 0 },
    ]
    // Both 56 and 15 exceed half the 30 px arms → both clamp to 15.
    expect(roundedPathLength(points, 56)).toBeCloseTo(roundedPathLength(points, 15), 9)
  })
})

describe('roundedPathD (the drawn shape)', () => {
  test('two points draw a plain line', () => {
    expect(
      roundedPathD([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
    ).toBe('M 0,0 L 10,0')
  })
  test('a corner draws line–quadratic–line through the fillet points', () => {
    const d = roundedPathD(
      [
        { x: 0, y: 100 },
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      14,
    )
    expect(d).toContain('Q 0,0') // the control point IS the sharp corner
    expect(d.startsWith('M 0,100')).toBe(true)
    expect(d.endsWith('L 100,0')).toBe(true)
  })
})
