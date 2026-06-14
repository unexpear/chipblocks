/**
 * Wire thermal-profile tests (the hot-spot model). A current-carrying wire's
 * I²R heat is shed by convection along its length and conduction into its
 * ambient-held ends, so its temperature peaks in the MIDDLE and tapers to
 * ambient at the ends — a real hot spot, not a uniform glow. These pin the
 * load-bearing physical invariants (peak in the middle, cooled ends, symmetry,
 * monotonic in current) plus that a realistically over-current wire actually
 * crosses its insulation limit while a wire at its rated current stays safe.
 */

import { describe, expect, test } from 'vitest'
import { AWG22_AREA_M2, wireResistance } from '../src/renderer/wire-length.ts'
import {
  STANDARD_AMBIENT_C,
  thermalSeverity,
  WIRE_INSULATION_MAX_C,
  wireAmpacity,
  wireThermalProfile,
} from '../src/thermal-model.ts'

const A = STANDARD_AMBIENT_C // 25 °C
const LENGTH_M = 0.2 // a 20 cm bench wire
const AREA = AWG22_AREA_M2 // common hookup gauge
const R = wireResistance(LENGTH_M) // ρL/A for AWG22 copper, ≈ 10.3 mΩ

describe('wireThermalProfile — the hot spot', () => {
  test('a dead wire (no current) sits at ambient everywhere', () => {
    const p = wireThermalProfile(0, R, LENGTH_M, AREA)
    expect(p.peakC).toBe(A)
    expect(p.tempAtFraction(0.5)).toBe(A)
    expect(p.tempAtFraction(0)).toBe(A)
  })

  test('the hot spot is the MIDDLE; the ends stay at ambient', () => {
    const p = wireThermalProfile(12, R, LENGTH_M, AREA)
    // Middle hotter than the quarter point, hotter than the end.
    expect(p.tempAtFraction(0.5)).toBeGreaterThan(p.tempAtFraction(0.25))
    expect(p.tempAtFraction(0.25)).toBeGreaterThan(p.tempAtFraction(0.05))
    // The ends are heat-sunk to ambient by the parts they connect to.
    expect(p.tempAtFraction(0)).toBeCloseTo(A, 6)
    expect(p.tempAtFraction(1)).toBeCloseTo(A, 6)
    // peakC is exactly the middle.
    expect(p.peakC).toBeCloseTo(p.tempAtFraction(0.5), 9)
    // And the middle is genuinely hot under this over-current.
    expect(p.peakC).toBeGreaterThan(A)
  })

  test('the profile is symmetric about the middle', () => {
    const p = wireThermalProfile(12, R, LENGTH_M, AREA)
    expect(p.tempAtFraction(0.3)).toBeCloseTo(p.tempAtFraction(0.7), 9)
    expect(p.tempAtFraction(0.1)).toBeCloseTo(p.tempAtFraction(0.9), 9)
  })

  test('hotter with more current, but sub-quadratically — real convection improves as it heats', () => {
    const lo = wireThermalProfile(6, R, LENGTH_M, AREA).peakC - A
    const hi = wireThermalProfile(12, R, LENGTH_M, AREA).peakC - A
    expect(hi).toBeGreaterThan(lo)
    // I²R generation alone would give 4× for a doubled current. But a hotter wire
    // convects harder (the Churchill–Chu h rises with ΔT), so the real rise grows
    // SUB-quadratically — clearly more than linear (2×), clearly less than the 4×
    // a constant-coefficient model would predict.
    expect(hi / lo).toBeGreaterThan(2)
    expect(hi / lo).toBeLessThan(4)
  })

  test('real outcome: at its rated ~7 A the wire stays safe; a 2× overload crosses the insulation limit', () => {
    const rated = wireThermalProfile(7, R, LENGTH_M, AREA)
    const overloaded = wireThermalProfile(14, R, LENGTH_M, AREA)
    // 7 A (about AWG22's chassis rating): comfortably under the 105 °C limit.
    expect(rated.peakC).toBeLessThan(WIRE_INSULATION_MAX_C)
    // 14 A (a 2× overload): the middle is genuinely over the line.
    expect(overloaded.peakC).toBeGreaterThan(WIRE_INSULATION_MAX_C)
  })

  test('degenerate inputs fall back to ambient (no NaN)', () => {
    expect(wireThermalProfile(10, 0, LENGTH_M, AREA).peakC).toBe(A)
    expect(wireThermalProfile(10, R, 0, AREA).peakC).toBe(A)
    expect(wireThermalProfile(10, R, LENGTH_M, 0).peakC).toBe(A)
  })
})

describe('wireAmpacity — the current that just reaches the insulation limit', () => {
  test('a wire driven at exactly its ampacity sits right on the limit', () => {
    const amp = wireAmpacity(R, LENGTH_M, AREA)
    expect(amp).toBeGreaterThan(7) // above the safe 7 A, below the 14 A overload
    expect(amp).toBeLessThan(14)
    // the inverse really lands on the limit
    expect(wireThermalProfile(amp, R, LENGTH_M, AREA).peakC).toBeCloseTo(WIRE_INSULATION_MAX_C, 0)
  })
  test('a thicker wire carries more before it overheats', () => {
    const thin = wireAmpacity(wireResistance(LENGTH_M, undefined, 5.09e-8), LENGTH_M, 5.09e-8) // 30 AWG
    const thick = wireAmpacity(wireResistance(LENGTH_M, undefined, 2.075e-6), LENGTH_M, 2.075e-6) // 14 AWG
    expect(thick).toBeGreaterThan(thin)
  })
  test('degenerate inputs give a zero rating, not NaN', () => {
    expect(wireAmpacity(0, LENGTH_M, AREA)).toBe(0)
    expect(wireAmpacity(R, 0, AREA)).toBe(0)
    expect(wireAmpacity(R, LENGTH_M, 0)).toBe(0)
  })
})

describe('wireThermalProfile — real end temperatures (the fin boundary)', () => {
  test('the ends sit at the connected parts temperatures, not ambient', () => {
    const p = wireThermalProfile(8, R, LENGTH_M, AREA, A, 90, 40)
    expect(p.tempAtFraction(0)).toBeCloseTo(90, 0) // end A on a 90 C part
    expect(p.tempAtFraction(1)).toBeCloseTo(40, 0) // end B on a 40 C part
  })

  test('a hot end lifts the wire near it -- the spot is no longer symmetric', () => {
    const p = wireThermalProfile(8, R, LENGTH_M, AREA, A, 95, A) // end A hot, end B ambient
    expect(p.tempAtFraction(0.15)).toBeGreaterThan(p.tempAtFraction(0.85))
  })

  test('both ends on hot parts -> the whole wire runs hotter than with cool ends', () => {
    const cool = wireThermalProfile(8, R, LENGTH_M, AREA).peakC
    const hot = wireThermalProfile(8, R, LENGTH_M, AREA, A, 80, 80).peakC
    expect(hot).toBeGreaterThan(cool)
  })

  test('equal ambient ends reproduce the symmetric middle spot', () => {
    const p = wireThermalProfile(8, R, LENGTH_M, AREA, A, A, A)
    expect(p.tempAtFraction(0.3)).toBeCloseTo(p.tempAtFraction(0.7), 6) // symmetric
    expect(p.tempAtFraction(0.5)).toBeGreaterThan(p.tempAtFraction(0.1)) // middle hottest
  })
})

describe('thermalSeverity — closeness to a real rated maximum', () => {
  test('0 at ambient, 1 exactly at the rating, >1 over it', () => {
    expect(thermalSeverity(A, 105)).toBe(0)
    expect(thermalSeverity(105, 105)).toBeCloseTo(1, 9)
    expect(thermalSeverity(145, 105)).toBeGreaterThan(1) // 40 °C over an 80 °C headroom
    expect(thermalSeverity(145, 105)).toBeCloseTo(1.5, 9)
  })

  test('halfway up the headroom reads 0.5', () => {
    // ambient 25, max 105 → headroom 80; 65 °C is +40, i.e. half.
    expect(thermalSeverity(65, 105)).toBeCloseTo(0.5, 9)
  })

  test('a part cooler than ambient, or a nonsensical rating, never blows up', () => {
    expect(thermalSeverity(10, 105)).toBeLessThan(0) // below ambient → negative, fine
    expect(thermalSeverity(50, A)).toBe(0) // zero headroom → 0, no divide-by-zero
  })
})
