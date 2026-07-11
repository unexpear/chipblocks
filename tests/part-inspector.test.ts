/**
 * part-inspector tests — the parameter-edit sign guard. paramMin floors physical
 * magnitudes at 0 so no negative resistance / capacitance / current can enter the circuit,
 * while leaving legitimately-signed params free: a tempco (NTC is negative), a FET threshold
 * (PMOS is negative), a source EMF (a user may reverse it), and any °C temperature (sub-zero).
 */

import { describe, expect, test } from 'vitest'
import { defaultParameters } from '../src/renderer/part-defaults.ts'
import { ENUM_PARAM_OPTIONS, paramMin } from '../src/renderer/part-inspector.tsx'

describe('paramMin — the edit-time sign guard', () => {
  test('physical magnitudes are floored at 0 — a negative value cannot commit', () => {
    expect(paramMin('resistance', 'ohm')).toBe(0)
    expect(paramMin('capacitance', 'farad')).toBe(0)
    expect(paramMin('inductance', 'henry')).toBe(0)
    expect(paramMin('max_forward_current', 'ampere')).toBe(0)
    expect(paramMin('power_rating', 'watt')).toBe(0)
    expect(paramMin('forward_voltage', 'volt')).toBe(0)
    expect(paramMin('frequency', 'hertz')).toBe(0) // 0 Hz (DC) is fine; a negative isn't
  })

  test('legitimately-signed params stay free — no floor', () => {
    expect(paramMin('temperature_coefficient', 'per_kelvin')).toBeUndefined() // NTC < 0
    expect(paramMin('threshold_voltage', 'volt')).toBeUndefined() // PMOS V_th < 0
    expect(paramMin('nominal_voltage', 'volt')).toBeUndefined() // a source can be reversed
  })

  test('a °C temperature is free (sub-zero is real); a kelvin magnitude is floored', () => {
    expect(paramMin('ambient_temperature', 'celsius')).toBeUndefined()
    expect(paramMin('reference_temperature', 'celsius')).toBeUndefined()
    expect(paramMin('max_operating_temperature', 'degC')).toBeUndefined()
    // A kelvin value is absolute (≥ 0) — e.g. a thermistor's B coefficient — so it floors.
    expect(paramMin('beta_coefficient', 'kelvin')).toBe(0)
  })
})

describe('enum parameters — every shipped enum has an editor', () => {
  test('stator_connection is editable: a dropdown with wye + delta, defaulting to a listed value', () => {
    const options = ENUM_PARAM_OPTIONS.stator_connection ?? []
    expect(options.map((o) => o.value)).toEqual(['wye', 'delta'])
    // The shipped default must be one of the dropdown's values — else the select renders blank.
    const shipped = defaultParameters('induction_motor_three_phase').stator_connection?.value
    expect(options.some((o) => o.value === shipped)).toBe(true)
  })
})
