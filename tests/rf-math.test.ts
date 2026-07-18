/**
 * RF MATH / UNITS (analog-RF chapter, increment 2) — the shared dB / dBm / reflection conversions, checked
 * against textbook anchors (0 dBm = 1 mW; VSWR 3 ⇔ |Γ| 0.5 ⇔ 6.02 dB return loss) and for round-trip
 * consistency (each forward conversion undone by its inverse) and the physical edge cases (matched = ∞ return
 * loss, VSWR 1; total reflection = 0 dB, ∞ VSWR).
 */
import { describe, expect, test } from 'vitest'
import {
  amplitudeRatioFromDb,
  dbFromAmplitudeRatio,
  dbFromPowerRatio,
  dbmFromWatts,
  gammaFromReturnLossDb,
  gammaFromVswr,
  powerRatioFromDb,
  returnLossDbFromGamma,
  vswrFromGamma,
  wattsFromDbm,
} from '../src/rf-math.ts'

describe('decibels — power vs amplitude', () => {
  test('a power ratio uses 10·log10; an amplitude ratio 20·log10', () => {
    expect(dbFromPowerRatio(2)).toBeCloseTo(3.0103, 3) // ×2 power ≈ +3 dB
    expect(dbFromPowerRatio(1000)).toBeCloseTo(30, 6) // ×1000 power = +30 dB
    expect(dbFromAmplitudeRatio(2)).toBeCloseTo(6.0206, 3) // ×2 amplitude ≈ +6 dB
    expect(dbFromAmplitudeRatio(10)).toBeCloseTo(20, 6) // ×10 amplitude = +20 dB
    // 0 / negative argument → −∞ (silence), not NaN
    expect(dbFromPowerRatio(0)).toBe(Number.NEGATIVE_INFINITY)
  })

  test('each dB conversion round-trips through its inverse', () => {
    for (const r of [0.001, 0.5, 1, 7, 1234]) {
      expect(powerRatioFromDb(dbFromPowerRatio(r))).toBeCloseTo(r, 6)
      expect(amplitudeRatioFromDb(dbFromAmplitudeRatio(r))).toBeCloseTo(r, 6)
    }
  })
})

describe('dBm — absolute power', () => {
  test('0 dBm = 1 mW, 30 dBm = 1 W, −30 dBm = 1 µW', () => {
    expect(dbmFromWatts(1e-3)).toBeCloseTo(0, 9)
    expect(dbmFromWatts(1)).toBeCloseTo(30, 6)
    expect(dbmFromWatts(1e-6)).toBeCloseTo(-30, 6)
    expect(wattsFromDbm(0)).toBeCloseTo(1e-3, 12)
    expect(wattsFromDbm(30)).toBeCloseTo(1, 9)
  })

  test('watts ↔ dBm round-trips', () => {
    for (const w of [1e-9, 1e-3, 0.25, 5]) expect(wattsFromDbm(dbmFromWatts(w))).toBeCloseTo(w, 12)
  })
})

describe('the reflection triangle — |Γ| ↔ return loss ↔ VSWR', () => {
  test('the canonical mismatch: |Γ| = 0.5 ⇒ 6.02 dB, VSWR 3', () => {
    expect(returnLossDbFromGamma(0.5)).toBeCloseTo(6.0206, 3)
    expect(vswrFromGamma(0.5)).toBeCloseTo(3, 9)
    expect(gammaFromVswr(3)).toBeCloseTo(0.5, 9)
    expect(gammaFromReturnLossDb(6.0206)).toBeCloseTo(0.5, 4)
  })

  test('a perfect match: |Γ| = 0 ⇒ ∞ return loss, VSWR 1', () => {
    expect(returnLossDbFromGamma(0)).toBe(Number.POSITIVE_INFINITY)
    expect(vswrFromGamma(0)).toBeCloseTo(1, 9)
    expect(gammaFromVswr(1)).toBe(0)
  })

  test('total reflection: |Γ| = 1 ⇒ 0 dB return loss, ∞ VSWR', () => {
    expect(returnLossDbFromGamma(1)).toBeCloseTo(0, 9)
    expect(vswrFromGamma(1)).toBe(Number.POSITIVE_INFINITY)
    expect(gammaFromVswr(Number.POSITIVE_INFINITY)).toBe(1)
  })

  test('an active port (|Γ| > 1) has NEGATIVE return loss (returns more than incident)', () => {
    expect(returnLossDbFromGamma(2)).toBeCloseTo(-6.0206, 3)
    expect(vswrFromGamma(2)).toBe(Number.POSITIVE_INFINITY) // VSWR undefined past total reflection
  })

  test('|Γ| ↔ return loss and |Γ| ↔ VSWR round-trip in the passive range', () => {
    for (const g of [0.01, 0.2, 0.5, 0.8, 0.99]) {
      expect(gammaFromReturnLossDb(returnLossDbFromGamma(g))).toBeCloseTo(g, 6)
      expect(gammaFromVswr(vswrFromGamma(g))).toBeCloseTo(g, 9)
    }
  })

  test('an unphysical VSWR below 1 clamps to a match', () => {
    expect(gammaFromVswr(0.5)).toBe(0)
  })
})
