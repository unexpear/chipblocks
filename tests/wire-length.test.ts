/**
 * wire-length tests (S19-v3-7).
 *
 * The wire-as-connector physics: drawn length seeds a real length, the math
 * runs on real numbers (R = ρ·L/A), and the visual mapping stays soft + bounded
 * with no hard clamp. These pin all three.
 */

import { describe, expect, test } from 'vitest'
import {
  formatLength,
  formatResistance,
  lengthFromDrawn,
  METRES_PER_PIXEL,
  visualFromLength,
  wireResistance,
} from '../src/renderer/wire-length.ts'

describe('lengthFromDrawn (hybrid seed)', () => {
  test('maps drawn pixels to real metres, linear and uncapped', () => {
    expect(lengthFromDrawn(150)).toBeCloseTo(0.15, 9)
    expect(lengthFromDrawn(1000)).toBeCloseTo(1.0, 9)
    expect(lengthFromDrawn(2000)).toBeCloseTo(2 * lengthFromDrawn(1000), 9) // no cap
  })
  test('never negative', () => {
    expect(lengthFromDrawn(0)).toBe(0)
    expect(lengthFromDrawn(-50)).toBe(0)
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
  test('length unit-scales', () => {
    expect(formatLength(1.5)).toBe('1.50 m')
    expect(formatLength(0.15)).toBe('15.0 cm')
    expect(formatLength(0.005)).toBe('5.0 mm')
  })
  test('resistance unit-scales', () => {
    expect(formatResistance(1.5)).toBe('1.50 Ω')
    expect(formatResistance(0.0077419)).toBe('7.7 mΩ')
    expect(formatResistance(5e-6)).toBe('5.0 µΩ')
  })
})
