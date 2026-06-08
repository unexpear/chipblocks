import type { Instance } from '../cross-fk-validator.ts'
import { readEnumParam, readScalarParam } from '../instance-params.ts'

/**
 * Part parameter defaults + display (Sprint 19 S19-v3-20).
 *
 * A part dragged from the palette is a real catalog *definition* but starts with
 * no parameter values. This gives a freshly-dropped part a real, cited default
 * set (the anti-placeholder rule: defaults must be useful, cited, typed, and
 * unit-valid — the user edits them, the solver reads them), and a headline value
 * to show on the part so it reads as real.
 *
 * Values match the catalog's real instances (resistor 100 Ω fixture, 9 V 6LR61
 * battery, 5 mm red LED). Defaults pick common standard values, cited inline.
 */

export type Parameters = NonNullable<Instance['parameters']>

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

const DEFAULTS: Record<string, Parameters> = {
  resistor: {
    // 470 Ω — E12 standard, sized so the 9 V default battery drives the 2 V
    // default LED at ~15 mA: safely under its 20 mA rating, so a dropped
    // battery→resistor→LED loop lights up rather than burning the LED out.
    resistance: scalar(470, 'ohm'),
    tolerance_percent: scalar(5, 'percent'),
    power_rating: scalar(0.25, 'watt'),
    // The declared 470 Ω is trusted by default. resistive_material + geometry give
    // the alternative DERIVED path R = ρL/A (device-resistor.yaml): a 0.1 mm
    // nichrome wire 3.356 m long, sized so ρL/A ≈ 470 Ω. "Derive R" in the panel
    // recomputes R from these for a custom / heating-element resistor.
    resistive_material: { value: 'nichrome' },
    length: scalar(3.356, 'metre'),
    cross_section_area: scalar(7.854e-9, 'square_metre'),
  },
  power_source: {
    // 9 V alkaline (6LR61), per ANSI/IEC 60086-2 — same family as the anchor battery.
    nominal_voltage: scalar(9, 'volt'),
    internal_resistance: scalar(1, 'ohm'),
  },
  led: {
    // Typical 5 mm red LED (Kingbright WP7113SRD-D class): 2.0 V at 20 mA max,
    // ~640 nm red emission — sets the on-canvas glow color. n_side/p_side are the
    // real semiconductor (red AlGaInP, the device-led default): changing n_side
    // re-derives the color + forward voltage from that material's bandgap.
    forward_voltage: scalar(2.0, 'volt'),
    max_forward_current: scalar(0.02, 'ampere'),
    peak_wavelength: scalar(640, 'nanometer'),
    n_side: { value: 'aluminum_gallium_indium_phosphide_n_type' },
    p_side: { value: 'aluminum_gallium_indium_phosphide_p_type' },
  },
  led_uv_algan: {
    // AlGaN UV LED: ~3.4 V at 20 mA, ~340 nm (invisible UV → a faint violet glow).
    forward_voltage: scalar(3.4, 'volt'),
    max_forward_current: scalar(0.02, 'ampere'),
    peak_wavelength: scalar(340, 'nanometer'),
    n_side: { value: 'aluminum_gallium_nitride_n_type' },
    p_side: { value: 'aluminum_gallium_nitride_p_type' },
  },
  switch_spst_toggle: {
    // Panel-mount SPST toggle (C&K 7101 class, matching the anchor switch
    // fixture): copper contacts, ~20 mΩ closed, 6 A, 125 V. Starts closed
    // (conducting) — double-click flips it open. `state` is a runtime enum.
    state: { value: 'closed' },
    contact_material: { value: 'copper' },
    contact_resistance_closed: scalar(0.02, 'ohm'),
    max_current: scalar(6, 'ampere'),
    rated_voltage: scalar(125, 'volt'),
  },
}

/**
 * Where each default value comes from — the cited source behind the DEFAULTS
 * above (Properties-panel provenance: the "real all the way down" identity made
 * visible). Shown only while a part's value still equals its default; once the
 * user edits it, the value is theirs, so no source is claimed.
 */
const PROVENANCE: Record<string, Record<string, string>> = {
  resistor: {
    resistance: 'E12 standard value (470 Ω safe for a 9 V LED)',
    tolerance_percent: 'E12 / E24 ±5% band',
    power_rating: 'carbon-film 1/4 W class',
    length: 'nichrome wirewound geometry (≈470 Ω at 0.1 mm dia)',
    cross_section_area: '0.1 mm diameter wire (π/4·d²)',
  },
  power_source: {
    nominal_voltage: 'ANSI/IEC 60086-2 — 9 V 6LR61 (PP3)',
    internal_resistance: '~1 Ω fresh 9 V alkaline (Duracell MN1604)',
  },
  led: {
    forward_voltage: 'Kingbright WP7113SRD-D (5 mm red)',
    max_forward_current: '5 mm indicator LED standard (20 mA)',
    peak_wavelength: 'AlGaInP red ~640 nm',
  },
  led_uv_algan: {
    forward_voltage: 'AlGaN UV LED (~3.4 V at 20 mA)',
    max_forward_current: '20 mA',
    peak_wavelength: 'AlGaN UV ~340 nm',
  },
  switch_spst_toggle: {
    contact_resistance_closed: 'C&K 7101 class (~20 mΩ closed)',
    max_current: 'C&K 7101 (6 A)',
    rated_voltage: 'C&K 7101 (125 V)',
  },
}

/** The cited source for a default parameter value, if known. */
export function defaultProvenance(definition: string, key: string): string | undefined {
  return PROVENANCE[definition]?.[key]
}

/** A real, cited default parameter set for a freshly-dropped part (a fresh copy; editable). */
export function defaultParameters(definition: string): Parameters {
  const preset = DEFAULTS[definition]
  return preset ? (JSON.parse(JSON.stringify(preset)) as Parameters) : {}
}

// readScalarParam reads off an Instance; a dropped part has only its parameters,
// so wrap them — readScalarParam only touches `.parameters`.
const amountOf = (parameters: Parameters | undefined, name: string): number | undefined =>
  parameters ? readScalarParam({ parameters } as unknown as Instance, name) : undefined

const stringOf = (parameters: Parameters | undefined, name: string): string | undefined =>
  parameters ? readEnumParam({ parameters } as unknown as Instance, name) : undefined

/** Is a switch closed (conducting)? Absent state defaults to closed — matches the solver. */
export function switchClosed(parameters: Parameters | undefined): boolean {
  return stringOf(parameters, 'state') !== 'open'
}

/** The opposite state's parameters — flips a switch open↔closed for double-click toggle. */
export function toggledSwitch(parameters: Parameters | undefined): Parameters {
  return { ...parameters, state: { value: switchClosed(parameters) ? 'open' : 'closed' } }
}

/** Component resistance formatted Ω / kΩ / MΩ (distinct from a wire's mΩ scale). */
export function formatComponentOhms(ohms: number): string {
  if (ohms >= 1e6) return `${(ohms / 1e6).toFixed(2)} MΩ`
  if (ohms >= 1e3) return `${(ohms / 1e3).toFixed(2)} kΩ`
  return `${ohms} Ω`
}

/** The headline value to show on a part (resistance / supply voltage / forward voltage). */
export function primaryValue(
  definition: string,
  parameters: Parameters | undefined,
): string | null {
  if (definition === 'resistor') {
    const r = amountOf(parameters, 'resistance')
    return r === undefined ? null : formatComponentOhms(r)
  }
  if (definition === 'power_source') {
    const v = amountOf(parameters, 'nominal_voltage')
    return v === undefined ? null : `${v} V`
  }
  if (definition === 'led' || definition === 'led_uv_algan') {
    const v = amountOf(parameters, 'forward_voltage')
    return v === undefined ? null : `${v} V`
  }
  if (definition === 'switch_spst_toggle') {
    return switchClosed(parameters) ? 'closed' : 'open'
  }
  return null
}
