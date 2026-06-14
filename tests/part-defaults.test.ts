/**
 * part-defaults tests (S19-v3-20).
 *
 * A dropped part must get real, typed, unit-valid default values, and a part's
 * headline value must format correctly.
 */

import { describe, expect, test } from 'vitest'
import {
  defaultParameters,
  primaryValue,
  sourceIsAc,
  switchClosed,
  toggledSwitch,
} from '../src/renderer/part-defaults.ts'

const param = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

describe('AC source (S19-v3-45)', () => {
  test('a dropped source defaults to pure DC (zero AC amplitude + frequency)', () => {
    const p = defaultParameters('power_source')
    expect(p.ac_amplitude?.value).toEqual({ kind: 'scalar', amount: 0, unit: 'volt' })
    expect(p.frequency?.value).toEqual({ kind: 'scalar', amount: 0, unit: 'hertz' })
    expect(sourceIsAc(p)).toBe(false)
  })
  test('an AC source headlines its swing + frequency in engineering units', () => {
    const p = {
      nominal_voltage: param(0, 'volt'),
      ac_amplitude: param(0.01, 'volt'),
      frequency: param(1000, 'hertz'),
    }
    expect(sourceIsAc(p)).toBe(true)
    expect(primaryValue('power_source', p)).toBe('10.0 mV~ 1.00 kHz')
  })
})

describe('defaultParameters', () => {
  test('a dropped resistor gets a real 470 Ω default', () => {
    const p = defaultParameters('resistor')
    expect(p.resistance?.value).toEqual({ kind: 'scalar', amount: 470, unit: 'ohm' })
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
  test('a dropped switch gets a real closed state + cited contact values', () => {
    const p = defaultParameters('switch_spst_toggle')
    expect(p.state?.value).toBe('closed')
    expect(p.contact_material?.value).toBe('copper')
    expect(p.contact_resistance_closed?.value).toEqual({
      kind: 'scalar',
      amount: 0.02,
      unit: 'ohm',
    })
    expect(p.max_current?.value).toEqual({ kind: 'scalar', amount: 6, unit: 'ampere' })
  })
  test('returns a fresh copy — editing one drop never mutates the next', () => {
    const a = defaultParameters('resistor')
    const value = a.resistance?.value as { amount: number }
    value.amount = 999
    const b = defaultParameters('resistor')
    expect((b.resistance?.value as { amount: number }).amount).toBe(470)
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
    expect(primaryValue('ground', {})).toBeNull()
    expect(primaryValue('resistor', undefined)).toBeNull()
  })
  test('switch → its open/closed state', () => {
    expect(primaryValue('switch_spst_toggle', { state: { value: 'closed' } })).toBe('closed')
    expect(primaryValue('switch_spst_toggle', { state: { value: 'open' } })).toBe('open')
    expect(primaryValue('switch_spst_toggle', {})).toBe('closed') // absent state defaults closed
  })
  test('photodiode → its photocurrent; phototransistor amplifies it by β', () => {
    const base = {
      photocurrent_per_lux: param(1e-8, 'ampere_per_lux'),
      ambient_illuminance: param(1000, 'lux'),
    }
    expect(primaryValue('photodiode', base)).toBe('10.0 µA') // 1e-8 A/lux × 1000 lux
    // The phototransistor MUST apply β (regression: the headline once dropped the
    // definition, so it showed the un-amplified base). 300 × 10 µA = 3 mA.
    expect(
      primaryValue('phototransistor', { ...base, current_gain: param(300, 'dimensionless') }),
    ).toBe('3.00 mA')
  })
})

describe('switch state', () => {
  test('switchClosed defaults to closed; reads open/closed', () => {
    expect(switchClosed(undefined)).toBe(true)
    expect(switchClosed({})).toBe(true)
    expect(switchClosed({ state: { value: 'closed' } })).toBe(true)
    expect(switchClosed({ state: { value: 'open' } })).toBe(false)
  })
  test('toggledSwitch flips the state, preserving other params', () => {
    const closed = defaultParameters('switch_spst_toggle')
    const opened = toggledSwitch(closed)
    expect(opened.state?.value).toBe('open')
    expect(opened.contact_material?.value).toBe('copper') // other params preserved
    expect(toggledSwitch(opened).state?.value).toBe('closed') // flips back
  })
})
