/**
 * part-defaults tests (S19-v3-20).
 *
 * A dropped part must get real, typed, unit-valid default values, and a part's
 * headline value must format correctly.
 */

import { describe, expect, test } from 'vitest'
import {
  defaultParameters,
  formatComponentOhms,
  primaryValue,
} from '../src/renderer/part-defaults.ts'

const param = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

describe('defaultParameters', () => {
  test('a dropped resistor gets a real 220 Ω default', () => {
    const p = defaultParameters('resistor')
    expect(p.resistance?.value).toEqual({ kind: 'scalar', amount: 220, unit: 'ohm' })
    expect(p.power_rating?.value).toEqual({ kind: 'scalar', amount: 0.25, unit: 'watt' })
  })
  test('a dropped battery gets 9 V + internal resistance', () => {
    const p = defaultParameters('power_source')
    expect(p.nominal_voltage?.value).toEqual({ kind: 'scalar', amount: 9, unit: 'volt' })
    expect(p.internal_resistance?.value).toEqual({ kind: 'scalar', amount: 1, unit: 'ohm' })
  })
  test('a dropped LED gets forward voltage + max current (for the solver + failure check)', () => {
    const p = defaultParameters('led')
    expect(p.forward_voltage?.value).toEqual({ kind: 'scalar', amount: 2.0, unit: 'volt' })
    expect(p.max_forward_current?.value).toEqual({ kind: 'scalar', amount: 0.02, unit: 'ampere' })
  })
  test('a part with no electrical default (ground) gets an empty set', () => {
    expect(defaultParameters('ground')).toEqual({})
  })
  test('returns a fresh copy — editing one drop never mutates the next', () => {
    const a = defaultParameters('resistor')
    const value = a.resistance?.value as { amount: number }
    value.amount = 999
    const b = defaultParameters('resistor')
    expect((b.resistance?.value as { amount: number }).amount).toBe(220)
  })
})

describe('primaryValue', () => {
  test('resistor → resistance, unit-scaled', () => {
    expect(primaryValue('resistor', { resistance: param(220, 'ohm') })).toBe('220 Ω')
    expect(primaryValue('resistor', { resistance: param(2200, 'ohm') })).toBe('2.20 kΩ')
  })
  test('battery → supply voltage', () => {
    expect(primaryValue('power_source', { nominal_voltage: param(9, 'volt') })).toBe('9 V')
  })
  test('LED → forward voltage', () => {
    expect(primaryValue('led', { forward_voltage: param(2, 'volt') })).toBe('2 V')
  })
  test('parts without a headline value return null', () => {
    expect(primaryValue('switch_spst_toggle', {})).toBeNull()
    expect(primaryValue('ground', {})).toBeNull()
    expect(primaryValue('resistor', undefined)).toBeNull()
  })
})

describe('formatComponentOhms', () => {
  test('scales Ω / kΩ / MΩ', () => {
    expect(formatComponentOhms(220)).toBe('220 Ω')
    expect(formatComponentOhms(4700)).toBe('4.70 kΩ')
    expect(formatComponentOhms(1_000_000)).toBe('1.00 MΩ')
  })
})
