/**
 * led-optics tests (S19-v3-33) — an LED's color + forward voltage derived from
 * its semiconductor's real bandgap, so changing the material is a real change.
 * Numbers checked against the catalog's cited bandgaps (λ = h·c/E_g).
 */

import { describe, expect, test } from 'vitest'
import { bandgapEv, deriveLedOptics } from '../src/renderer/led-optics.ts'

describe('bandgapEv', () => {
  test('reads a condition_bound amount in eV (AlGaInP 1.9 eV)', () => {
    expect(bandgapEv({ kind: 'condition_bound', amount: 1.9, unit: 'electronvolt' })).toBe(1.9)
  })
  test('reads a range typical (InGaN 2.55 eV)', () => {
    expect(
      bandgapEv({ kind: 'range', min: 2.4, max: 2.7, typical: 2.55, unit: 'electronvolt' }),
    ).toBe(2.55)
  })
  test('falls back to the range midpoint when no typical', () => {
    expect(bandgapEv({ kind: 'range', min: 3.4, max: 6.0, unit: 'electronvolt' })).toBe(4.7)
  })
  test('rejects a non-eV unit, or a non-object', () => {
    expect(bandgapEv({ kind: 'scalar', amount: 5, unit: 'volt' })).toBeNull()
    expect(bandgapEv(null)).toBeNull()
    expect(bandgapEv('1.9')).toBeNull()
  })
})

describe('deriveLedOptics', () => {
  test('AlGaInP red: 1.9 eV → ~653 nm, ~1.9 V', () => {
    const o = deriveLedOptics(1.9)
    expect(o?.peakWavelengthNm).toBeCloseTo(652.5, 1)
    expect(o?.forwardVoltageV).toBeCloseTo(1.9, 3)
  })
  test('InGaN blue: 2.55 eV → ~486 nm', () => {
    expect(deriveLedOptics(2.55)?.peakWavelengthNm).toBeCloseTo(486.2, 1)
  })
  test('GaAs IR: 1.42 eV → ~873 nm', () => {
    expect(deriveLedOptics(1.42)?.peakWavelengthNm).toBeCloseTo(873.1, 1)
  })
  test('AlGaN UV: 4.5 eV → ~276 nm (deep UV)', () => {
    expect(deriveLedOptics(4.5)?.peakWavelengthNm).toBeCloseTo(275.5, 1)
  })
  test('rejects a non-positive bandgap (e.g. a metal as the semiconductor)', () => {
    expect(deriveLedOptics(0)).toBeNull()
    expect(deriveLedOptics(-1)).toBeNull()
  })
})
