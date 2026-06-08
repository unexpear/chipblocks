/**
 * wire-length tests (S19-v3-7; scale band S19-v3-26).
 *
 * The wire-as-connector physics: drawn length seeds a real length clamped to the
 * 0.01 in – 3 ft scale band, the math runs on real numbers (R = ρ·L/A), length
 * reads in imperial, and the visual mapping stays soft + monotonic.
 */

import { describe, expect, test } from 'vitest'
import {
  formatLength,
  lengthFromDrawn,
  MAX_LENGTH_M,
  METRES_PER_PIXEL,
  MIN_LENGTH_M,
  visualFromLength,
  wireResistance,
} from '../src/renderer/wire-length.ts'

describe('lengthFromDrawn (hybrid seed, clamped to the 0.01 in – 3 ft band)', () => {
  test('maps drawn pixels to real metres within the band', () => {
    expect(lengthFromDrawn(150)).toBeCloseTo(0.15, 9) // 15 cm, within band
    expect(lengthFromDrawn(500)).toBeCloseTo(0.5, 9)
  })
  test('clamps an over-long drag to 3 ft', () => {
    expect(MAX_LENGTH_M).toBeCloseTo(0.9144, 9)
    expect(lengthFromDrawn(1000)).toBeCloseTo(MAX_LENGTH_M, 9) // 1 m seed → 3 ft cap
    expect(lengthFromDrawn(5000)).toBeCloseTo(MAX_LENGTH_M, 9)
  })
  test('floors a tiny / zero / negative drag at 0.01 in', () => {
    expect(MIN_LENGTH_M).toBeCloseTo(0.000254, 12)
    expect(lengthFromDrawn(0)).toBeCloseTo(MIN_LENGTH_M, 12)
    expect(lengthFromDrawn(-50)).toBeCloseTo(MIN_LENGTH_M, 12)
  })
  test('scale constant is 1 px = 1 mm', () => {
    expect(METRES_PER_PIXEL).toBeCloseTo(0.001, 12)
  })
})

describe('visualFromLength (soft, bounded, no hard clamp)', () => {
  test('zero maps to zero, near-linear for short bench lengths', () => {
    expect(visualFromLength(0)).toBe(0)
    // 15 cm renders to a sane on-screen length
    expect(visualFromLength(0.15)).toBeCloseTo(277.3, 0)
  })
  test('monotonic and never exceeds the soft maximum', () => {
    const a = visualFromLength(0.1)
    const b = visualFromLength(1)
    const c = visualFromLength(1000)
    expect(b).toBeGreaterThan(a)
    expect(c).toBeGreaterThanOrEqual(b)
    expect(c).toBeLessThanOrEqual(600) // approached asymptotically, never clamped past
  })
  test('a 1000 m wire still reads longer than a 1 m wire (no flat cap below saturation)', () => {
    expect(visualFromLength(2)).toBeGreaterThan(visualFromLength(0.5))
  })
})

describe('wireResistance (R = ρ·L/A, real-number math)', () => {
  test('default copper / 22 AWG, 15 cm ≈ 7.7 mΩ', () => {
    expect(wireResistance(0.15)).toBeCloseTo(0.0077419, 6)
  })
  test('linear in length', () => {
    expect(wireResistance(0.3)).toBeCloseTo(2 * wireResistance(0.15), 9)
  })
  test('honours caller-supplied resistivity and area', () => {
    expect(wireResistance(1, 1.68e-8, 1e-6)).toBeCloseTo(0.0168, 9)
  })
  test('guards a zero/invalid cross-section', () => {
    expect(wireResistance(0.15, 1.68e-8, 0)).toBe(0)
  })
})

describe('formatters', () => {
  test('length reads in imperial (inches under a foot, feet at/above)', () => {
    expect(formatLength(MAX_LENGTH_M)).toBe('3.00 ft') // 3 ft
    expect(formatLength(0.15)).toBe('5.91 in') // 15 cm ≈ 5.91 in
    expect(formatLength(MIN_LENGTH_M)).toBe('0.01 in') // 0.01 in floor
  })
})
