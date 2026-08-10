/**
 * part-inspector tests — the parameter-edit sign guard. paramMin floors physical
 * magnitudes at 0 so no negative resistance / capacitance / current can enter the circuit,
 * while leaving legitimately-signed params free: a tempco (NTC is negative), a FET threshold
 * (PMOS is negative), a source EMF (a user may reverse it), and any °C temperature (sub-zero).
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { defaultParameters, type Parameters } from '../src/renderer/part-defaults.ts'
import {
  ENUM_PARAM_OPTIONS,
  PartInspector,
  paramMin,
  type SelectedPart,
} from '../src/renderer/part-inspector.tsx'

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

/**
 * DECLARING A LOSS THE PART DOES NOT CARRY. The panel builds its rows from the parameters an instance already
 * has, so a value absent from a part's defaults could not be added from anywhere in the app. That made the AC
 * engine's whole capacitor-loss path unreachable from the canvas: no shipped part declared `esr`, and nothing
 * could add one, so "every capacitor in this app is lossless at AC" was true whatever the solver could read.
 *
 * The offer is derived from the AC engine's own parameter list, so it can never offer a value the engine
 * ignores, and it seeds the row at 0 — an empty declaration to type into, never a number this panel invented.
 */
describe('the Declare-AC-loss affordance', () => {
  const noop = () => {}
  const render = (definition: string, parameters: Parameters) =>
    renderToStaticMarkup(
      createElement(PartInspector, {
        selected: { id: 'dut', definition, parameters } satisfies SelectedPart,
        reading: undefined,
        materials: [],
        validMaterials: {},
        onParam: noop,
        onEnum: noop,
        onFootprint: noop,
        onMaterial: noop,
        onDeriveResistance: noop,
        projectAmbientC: 25,
      }),
    )

  test('a capacitor with no ESR row is offered one', () => {
    const html = render('capacitor', {
      capacitance: { value: { kind: 'scalar', amount: 1e-9, unit: 'farad' } },
    })
    expect(html).toContain('Declare AC loss')
    expect(html).toContain('+ Esr')
    expect(html).toContain('+ Dissipation factor')
  })

  test('a parameter the part already carries is not offered again', () => {
    // The shipped capacitor declares its datasheet tan δ, so only the alternative spelling is left to add.
    const html = render('capacitor', defaultParameters('capacitor'))
    expect(html).toContain('+ Esr')
    expect(html).not.toContain('+ Dissipation factor')
  })

  test('a coil is offered its winding resistance, and a transformer its three losses', () => {
    const coil = render('inductor', {
      inductance: { value: { kind: 'scalar', amount: 1e-6, unit: 'henry' } },
    })
    expect(coil).toContain('+ Winding resistance')
    const transformer = render('transformer', {})
    expect(transformer).toContain('+ Primary resistance')
    expect(transformer).toContain('+ Secondary resistance')
    expect(transformer).toContain('+ Core loss resistance')
  })

  test('a part with no AC loss to declare gets no section', () => {
    const html = render('resistor', {
      resistance: { value: { kind: 'scalar', amount: 470, unit: 'ohm' } },
    })
    expect(html).not.toContain('Declare AC loss')
  })

  test('the shipped transmission line carries all its loss rows already, so none are offered', () => {
    const html = render('transmission_line', defaultParameters('transmission_line'))
    expect(html).not.toContain('Declare AC loss')
  })
})
