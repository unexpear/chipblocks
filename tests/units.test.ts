/**
 * formatEng tests (S19-v3-35) — the one engineering-notation formatter that
 * replaced the per-quantity ones. Verifies the ×1000 prefix ladder, ~3 sig figs,
 * the sign option, and that the pico/giga gaps are closed.
 */

import { describe, expect, test } from 'vitest'
import { formatEng } from '../src/renderer/units.ts'

describe('formatEng', () => {
  test('scales current through the prefix ladder (3 sig figs)', () => {
    expect(formatEng(1.5, 'A')).toBe('1.50 A')
    expect(formatEng(0.069357, 'A')).toBe('69.4 mA')
    expect(formatEng(0.0000123, 'A')).toBe('12.3 µA')
    expect(formatEng(0, 'A')).toBe('0 A')
  })

  test('resistance — one formatter now spans µΩ to GΩ', () => {
    expect(formatEng(5e-6, 'Ω')).toBe('5.00 µΩ')
    expect(formatEng(0.0077419, 'Ω')).toBe('7.74 mΩ')
    expect(formatEng(220, 'Ω')).toBe('220 Ω')
    expect(formatEng(4700, 'Ω')).toBe('4.70 kΩ')
    expect(formatEng(1e6, 'Ω')).toBe('1.00 MΩ')
    expect(formatEng(2.2e9, 'Ω')).toBe('2.20 GΩ') // giga gap closed
  })

  test('voltage + power', () => {
    expect(formatEng(8.9, 'V')).toBe('8.90 V')
    expect(formatEng(0.0123, 'V')).toBe('12.3 mV')
    expect(formatEng(7.4e-6, 'V')).toBe('7.40 µV')
    expect(formatEng(0.104, 'W')).toBe('104 mW')
    expect(formatEng(3e-6, 'W')).toBe('3.00 µW')
  })

  test('pico / femto for capacitor-scale values (gap closed)', () => {
    expect(formatEng(220e-12, 'F')).toBe('220 pF')
    expect(formatEng(1e-12, 'F')).toBe('1.00 pF')
    expect(formatEng(4.7e-15, 'F')).toBe('4.70 fF')
  })

  test('signed option keeps the sign (node potentials); default is magnitude', () => {
    expect(formatEng(-1.5, 'V', { signed: true })).toBe('-1.50 V')
    expect(formatEng(-0.012, 'V', { signed: true })).toBe('-12.0 mV')
    expect(formatEng(0, 'V', { signed: true })).toBe('0 V')
    expect(formatEng(-1.5, 'V')).toBe('1.50 V')
  })

  test('sigFigs option controls precision', () => {
    expect(formatEng(8.98512, 'V', { sigFigs: 5 })).toBe('8.9851 V')
    expect(formatEng(8.98512, 'V')).toBe('8.99 V')
  })

  test('below the smallest prefix (sub-femto) reads as 0', () => {
    expect(formatEng(1e-16, 'A')).toBe('0 A')
  })
})
