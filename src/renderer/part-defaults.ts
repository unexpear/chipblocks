import type { Instance } from '../cross-fk-validator.ts'
import { readEnumParam, readScalarParam } from '../instance-params.ts'
import { formatEng } from './units.ts'

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
    // Lumped thermal model (stage 7): θ_JA derived from the 1/4 W film derating
    // curve (full power at 70 °C ambient, zero at 155 °C → (155−70)/0.25).
    thermal_resistance_junction_ambient: scalar(340, 'kelvin_per_watt'),
    max_operating_temperature: scalar(155, 'celsius'),
    // Electro-thermal feedback: carbon film drifts DOWN as it heats (negative
    // tempco) — R(T) = R₀·(1 + α·ΔT).
    temperature_coefficient: scalar(-0.0005, 'per_kelvin'),
  },
  power_source: {
    // 9 V alkaline (6LR61), per ANSI/IEC 60086-2 — same family as the anchor battery.
    // ac_amplitude / frequency 0 = a pure DC source (a battery has no AC component);
    // the AC presets in the Properties panel set them, V(t) = DC + A·sin(2πft).
    nominal_voltage: scalar(9, 'volt'),
    internal_resistance: scalar(1, 'ohm'),
    ac_amplitude: scalar(0, 'volt'),
    frequency: scalar(0, 'hertz'),
    // How many leads the source brings out (S19-v3-74). 2 = a plain source.
    // 3–6 = a tapped stack of identical sections (each section contributes
    // nominal_voltage behind internal_resistance — like cells with taps brought
    // out). 1 = a supply rail lead whose return is bonded to ground.
    terminal_count: scalar(2, 'count'),
  },
  capacitor: {
    // 100 µF aluminum electrolytic, 16 V class — a standard E12 value. With the
    // default 470 Ω resistor, τ = R·C ≈ 47 ms: a charging curve the Scope shows well.
    capacitance: scalar(100e-6, 'farad'),
    voltage_rating: scalar(16, 'volt'),
  },
  inductor: {
    // 10 mH radial-lead ferrite choke class (Bourns RLB0914 family): real small
    // inductors of this value carry tens of ohms of winding DCR and ~60 mA rating.
    inductance: scalar(0.01, 'henry'),
    winding_resistance: scalar(25, 'ohm'),
    current_rating: scalar(0.06, 'ampere'),
  },
  transformer: {
    // Small EI mains transformer class, ~1:10 step-up from the low-voltage winding
    // (turns ratio ≈ √(L2/L1)); k 0.98 iron core; winding DCRs scale with turns.
    primary_inductance: scalar(0.1, 'henry'),
    secondary_inductance: scalar(10, 'henry'),
    coupling_coefficient: scalar(0.98, 'dimensionless'),
    primary_resistance: scalar(0.5, 'ohm'),
    secondary_resistance: scalar(50, 'ohm'),
    // Core realism: iron loss as the classic parallel resistance; saturation as
    // the core's volt-second capacity (≈1.4× the nominal 12 V / 50 Hz swing).
    core_loss_resistance: scalar(200, 'ohm'),
    saturation_flux_linkage: scalar(0.075, 'weber'),
  },
  transformer_center_tapped: {
    // Push-pull inverter transformer class (12-0-12 : mains): each primary half is
    // L1/4, so a 12 V half-swing steps up by k·√(L2/(L1/4)) ≈ 19.6 → ~230 V AC.
    primary_inductance: scalar(0.1, 'henry'),
    secondary_inductance: scalar(10, 'henry'),
    coupling_coefficient: scalar(0.98, 'dimensionless'),
    primary_resistance: scalar(1, 'ohm'),
    secondary_resistance: scalar(50, 'ohm'),
    core_loss_resistance: scalar(200, 'ohm'),
    saturation_flux_linkage: scalar(0.075, 'weber'),
  },
  diode_silicon_rectifier: {
    // 1N4007 class — the universal 1 A axial rectifier: forward drop ≤ 1.0 V
    // at the 1 A rating (the Shockley calibration point; the curve then gives
    // the realistic ~0.7 V at smaller currents), blocking up to 1000 V PIV.
    // Thermal values are DO-41 axial class (lead-length dependent) pending the
    // queued datasheet-verification pass.
    forward_voltage: scalar(1.0, 'volt'),
    max_forward_current: scalar(1, 'ampere'),
    peak_inverse_voltage: scalar(1000, 'volt'),
    n_side: { value: 'silicon_n_type' },
    p_side: { value: 'silicon_p_type' },
    thermal_resistance_junction_ambient: scalar(100, 'kelvin_per_watt'),
    max_operating_temperature: scalar(150, 'celsius'),
  },
  led: {
    // Typical 5 mm red LED (Kingbright WP7113SRD-D class): 2.0 V at 20 mA max,
    // ~640 nm red emission — sets the on-canvas glow color. n_side/p_side are the
    // real semiconductor (red AlGaInP, the device-led default); the Color picker
    // sets the material together with the matching wavelength + forward voltage.
    forward_voltage: scalar(2.0, 'volt'),
    max_forward_current: scalar(0.02, 'ampere'),
    peak_wavelength: scalar(640, 'nanometer'),
    n_side: { value: 'aluminum_gallium_indium_phosphide_n_type' },
    p_side: { value: 'aluminum_gallium_indium_phosphide_p_type' },
    thermal_resistance_junction_ambient: scalar(300, 'kelvin_per_watt'),
    max_operating_temperature: scalar(85, 'celsius'),
  },
  led_uv_algan: {
    // AlGaN UV LED: ~3.4 V at 20 mA, ~340 nm (invisible UV → a faint violet glow).
    forward_voltage: scalar(3.4, 'volt'),
    max_forward_current: scalar(0.02, 'ampere'),
    peak_wavelength: scalar(340, 'nanometer'),
    n_side: { value: 'aluminum_gallium_nitride_n_type' },
    p_side: { value: 'aluminum_gallium_nitride_p_type' },
    thermal_resistance_junction_ambient: scalar(300, 'kelvin_per_watt'),
    max_operating_temperature: scalar(85, 'celsius'),
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
  transistor_bjt_npn: {
    // 2N3904 (onsemi) — the classic jellybean small-signal NPN. beta + I_S are
    // part-specific, so the device definition carries no builtin numeric default
    // (device-power-source convention); these are the cited canvas drop defaults.
    saturation_current: scalar(1e-14, 'ampere'),
    forward_current_gain: scalar(100, 'dimensionless'),
    reverse_current_gain: scalar(2, 'dimensionless'),
    max_collector_current: scalar(0.2, 'ampere'),
    collector_emitter_breakdown_voltage: scalar(40, 'volt'),
    thermal_resistance_junction_ambient: scalar(200, 'kelvin_per_watt'),
    max_operating_temperature: scalar(150, 'celsius'),
  },
  transistor_bjt_pnp: {
    // 2N3906 (onsemi) — the 2N3904's standard PNP complement; same class numbers.
    saturation_current: scalar(1e-14, 'ampere'),
    forward_current_gain: scalar(100, 'dimensionless'),
    reverse_current_gain: scalar(2, 'dimensionless'),
    max_collector_current: scalar(0.2, 'ampere'),
    collector_emitter_breakdown_voltage: scalar(40, 'volt'),
    thermal_resistance_junction_ambient: scalar(200, 'kelvin_per_watt'),
    max_operating_temperature: scalar(150, 'celsius'),
  },
  transistor_mosfet_nmos: {
    // 2N7000 (TO-92 N-channel) — the classic hobby NMOS. k is DERIVED from the
    // datasheet saturation point I_D(on) ≥ 75 mA at V_GS = 4.5 V with V_th 2.1 V:
    // k = 2·I/(V_GS − V_th)² ≈ 26 mA/V². That k independently reproduces the
    // separate R_DS(on) ≤ 5 Ω at V_GS = 10 V spec line (unit-tested). λ is a
    // textbook Level-1 class value — NOT on the datasheet, affects only the
    // slight current rise in saturation. θ_JA derived from the 400 mW power
    // rating: (150 − 25) °C / 0.4 W.
    threshold_voltage: scalar(2.1, 'volt'),
    transconductance_parameter: scalar(0.026, 'ampere_per_volt_squared'),
    channel_length_modulation: scalar(0.02, 'per_volt'),
    max_drain_current: scalar(0.2, 'ampere'),
    drain_source_breakdown_voltage: scalar(60, 'volt'),
    max_gate_source_voltage: scalar(20, 'volt'),
    body_region: { value: 'silicon_p_type' },
    source_drain_regions: { value: 'silicon_n_type' },
    gate_dielectric: { value: 'silicon_dioxide' },
    thermal_resistance_junction_ambient: scalar(312.5, 'kelvin_per_watt'),
    max_operating_temperature: scalar(150, 'celsius'),
  },
  transistor_mosfet_pmos: {
    // BS250 (TO-92 P-channel) — the 2N7000's standard complement. k derived the
    // same way from I_D(on) ≥ −175 mA at V_GS = −10 V with V_th −2.5 V:
    // k = 2·0.175/7.5² ≈ 6.2 mA/V² (p-channel mobility is lower — the smaller k
    // is real silicon physics, not a typo). θ_JA derived from the 700 mW power
    // rating: (150 − 25) °C / 0.7 W.
    threshold_voltage: scalar(-2.5, 'volt'),
    transconductance_parameter: scalar(0.0062, 'ampere_per_volt_squared'),
    channel_length_modulation: scalar(0.02, 'per_volt'),
    max_drain_current: scalar(0.23, 'ampere'),
    drain_source_breakdown_voltage: scalar(45, 'volt'),
    max_gate_source_voltage: scalar(20, 'volt'),
    body_region: { value: 'silicon_n_type' },
    source_drain_regions: { value: 'silicon_p_type' },
    gate_dielectric: { value: 'silicon_dioxide' },
    thermal_resistance_junction_ambient: scalar(178.6, 'kelvin_per_watt'),
    max_operating_temperature: scalar(150, 'celsius'),
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
    thermal_resistance_junction_ambient: 'from 1/4 W film derating: (155−70)°C / 0.25 W',
    max_operating_temperature: '155 °C film-resistor class',
    temperature_coefficient: 'carbon-film TCR class: −200…−800 ppm/°C; −500 typical',
  },
  power_source: {
    nominal_voltage: 'ANSI/IEC 60086-2 — 9 V 6LR61 (PP3)',
    internal_resistance: '~1 Ω fresh 9 V alkaline (Duracell MN1604)',
    ac_amplitude: '0 = pure DC (a battery has no AC component)',
    frequency: '0 = pure DC; set by the AC source types',
    terminal_count:
      '2 = plain source; 3–6 = a tapped stack of identical sections; 1 = a rail lead returning through ground',
  },
  capacitor: {
    capacitance: 'E12 standard — 100 µF aluminum electrolytic',
    voltage_rating: '16 V electrolytic voltage class',
  },
  inductor: {
    inductance: '10 mH radial ferrite choke class (Bourns RLB0914 family)',
    winding_resistance: 'winding DCR, tens of Ω typical at 10 mH (RLB0914 class)',
    current_rating: '~60 mA rated current (RLB0914 class)',
  },
  transformer: {
    primary_inductance: 'small EI mains transformer class, low-voltage winding',
    secondary_inductance: '≈1:10 turns ratio (√(L2/L1)) — step-up secondary',
    coupling_coefficient: 'iron-core k ≈ 0.95–0.998; 0.98 typical',
    primary_resistance: 'low-voltage winding DCR (few turns of thick wire)',
    secondary_resistance: 'high-voltage winding DCR (many turns of thin wire)',
    core_loss_resistance: 'small EI iron-loss class: ~0.7 W at 12 V (R ≈ V²/P)',
    saturation_flux_linkage: '≈1.4× the nominal 12 V/50 Hz swing (V·√2/ω ≈ 54 mV·s)',
  },
  transformer_center_tapped: {
    primary_inductance: 'push-pull inverter class — 12-0-12 end-to-end',
    secondary_inductance: 'each half steps up ≈ k·√(L2/(L1/4)) → ~230 V from 12 V',
    coupling_coefficient: 'iron-core k ≈ 0.95–0.998; 0.98 typical',
    primary_resistance: 'end-to-end DCR; each half carries half of it',
    secondary_resistance: 'high-voltage winding DCR (many turns of thin wire)',
    core_loss_resistance: 'small EI iron-loss class: ~0.7 W at 12 V (R ≈ V²/P)',
    saturation_flux_linkage: '≈1.4× the nominal 12 V/50 Hz swing (V·√2/ω ≈ 54 mV·s)',
  },
  diode_silicon_rectifier: {
    forward_voltage: '1N4007 class: ≤ 1.0 V at the 1 A rating',
    max_forward_current: '1N400x family rating (1 A continuous)',
    peak_inverse_voltage: '1N4007 variant (1000 V repetitive reverse)',
    thermal_resistance_junction_ambient: 'DO-41 axial class (~100 K/W, lead-length dependent)',
    max_operating_temperature: 'silicon rectifier junction class (150 °C)',
  },
  led: {
    forward_voltage: 'Kingbright WP7113SRD-D (5 mm red)',
    max_forward_current: '5 mm indicator LED standard (20 mA)',
    peak_wavelength: 'AlGaInP red ~640 nm',
    thermal_resistance_junction_ambient: '5 mm epoxy LED class (~300 K/W)',
    max_operating_temperature: '85 °C epoxy LED operating class',
  },
  led_uv_algan: {
    forward_voltage: 'AlGaN UV LED (~3.4 V at 20 mA)',
    max_forward_current: '20 mA',
    peak_wavelength: 'AlGaN UV ~340 nm',
    thermal_resistance_junction_ambient: '5 mm epoxy LED class (~300 K/W)',
    max_operating_temperature: '85 °C epoxy LED operating class',
  },
  switch_spst_toggle: {
    contact_resistance_closed: 'C&K 7101 class (~20 mΩ closed)',
    max_current: 'C&K 7101 (6 A)',
    rated_voltage: 'C&K 7101 (125 V)',
  },
  transistor_bjt_npn: {
    saturation_current: 'small-signal NPN transport I_S ~1e-14 A (2N3904 SPICE IS ~6.7 fA)',
    forward_current_gain: '2N3904 hFE ≥ 100 at I_C = 10 mA (onsemi datasheet)',
    reverse_current_gain: 'reverse β small for an NPN; 2N3904 SPICE BR ~0.74, rounded to 2',
    max_collector_current: '2N3904 I_C(max) 200 mA (onsemi datasheet)',
    collector_emitter_breakdown_voltage: '2N3904 V_CEO 40 V (onsemi datasheet)',
    thermal_resistance_junction_ambient: '2N3904 R_θJA 200 °C/W, TO-92 (onsemi datasheet)',
    max_operating_temperature: '2N3904 T_J max 150 °C (onsemi datasheet)',
  },
  transistor_mosfet_nmos: {
    threshold_voltage: '2N7000 V_GS(th) 2.1 V typical (0.8–3 V range, datasheet)',
    transconductance_parameter:
      'derived from the 2N7000 datasheet point I_D(on) ≥ 75 mA at V_GS 4.5 V: k = 2I/(V_GS−V_th)²; reproduces the independent R_DS(on) ≤ 5 Ω spec',
    channel_length_modulation:
      'textbook Level-1 class value (λ is not on discrete datasheets); affects only the slight current rise in saturation',
    max_drain_current: '2N7000 I_D 200 mA continuous (datasheet)',
    drain_source_breakdown_voltage: '2N7000 V_DS 60 V (datasheet)',
    max_gate_source_voltage: '2N7000 V_GS ±20 V absolute max — beyond it the gate oxide ruptures',
    thermal_resistance_junction_ambient: 'derived: (150−25) °C / 0.4 W TO-92 power rating',
    max_operating_temperature: '2N7000 T_J max 150 °C (datasheet)',
  },
  transistor_mosfet_pmos: {
    threshold_voltage: 'BS250 V_GS(th) −2.5 V class (−1 to −3.5 V range, datasheet)',
    transconductance_parameter:
      'derived from the BS250 datasheet point I_D(on) ≥ −175 mA at V_GS −10 V: k = 2I/(V_GS−V_th)² (p-channel mobility is lower — the smaller k is real)',
    channel_length_modulation: 'textbook Level-1 class value (λ is not on discrete datasheets)',
    max_drain_current: 'BS250 I_D −230 mA continuous (datasheet)',
    drain_source_breakdown_voltage: 'BS250 V_DS −45 V (datasheet)',
    max_gate_source_voltage: 'BS250 V_GS ±20 V absolute max — gate-oxide limit',
    thermal_resistance_junction_ambient: 'derived: (150−25) °C / 0.7 W TO-92 power rating',
    max_operating_temperature: 'BS250 T_J max 150 °C (datasheet)',
  },
  transistor_bjt_pnp: {
    saturation_current: 'small-signal PNP transport I_S ~1e-14 A (2N3906 class)',
    forward_current_gain: '2N3906 hFE ≥ 100 at I_C = 10 mA (onsemi datasheet)',
    reverse_current_gain: 'reverse β small for a PNP; 2N3906 class, rounded to 2',
    max_collector_current: '2N3906 I_C(max) 200 mA (onsemi datasheet)',
    collector_emitter_breakdown_voltage: '2N3906 V_CEO 40 V (onsemi datasheet)',
    thermal_resistance_junction_ambient: '2N3906 R_θJA 200 °C/W, TO-92 (onsemi datasheet)',
    max_operating_temperature: '2N3906 T_J max 150 °C (onsemi datasheet)',
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

/** Does a source carry an AC component (ac_amplitude > 0)? Drives the AC glyph. */
export function sourceIsAc(parameters: Parameters | undefined): boolean {
  return (amountOf(parameters, 'ac_amplitude') ?? 0) > 0
}

/** Is a source's waveform square (the clock shape)? Absent = sine, like the solver. */
export function sourceIsSquare(parameters: Parameters | undefined): boolean {
  return stringOf(parameters, 'waveform') === 'square'
}

/** Is a switch closed (conducting)? Absent state defaults to closed — matches the solver. */
export function switchClosed(parameters: Parameters | undefined): boolean {
  return stringOf(parameters, 'state') !== 'open'
}

/** The opposite state's parameters — flips a switch open↔closed for double-click toggle. */
export function toggledSwitch(parameters: Parameters | undefined): Parameters {
  return { ...parameters, state: { value: switchClosed(parameters) ? 'open' : 'closed' } }
}

/**
 * How many leads a source brings out (S19-v3-74), clamped to the real range.
 * Absent (every pre-existing source) reads as 2 — the plain two-lead source.
 */
export function sourceTerminalCount(parameters: Parameters | undefined): number {
  const raw = amountOf(parameters, 'terminal_count') ?? 2
  return Math.min(6, Math.max(1, Math.round(raw)))
}

/**
 * The lead (handle/terminal) names for a source with `count` leads — THE one
 * naming scheme, shared by the symbol's handles, the Properties stepper's
 * edge-pruning, and the multi-lead expansion that feeds the solver.
 * 1 → [+]; 2 → [+, −]; N → [+, tap_1 … tap_{N−2}, −] ordered top of the stack
 * (highest voltage) downward.
 */
export function sourceTerminalIds(count: number): string[] {
  if (count <= 1) return ['terminal_positive']
  const taps = Array.from({ length: count - 2 }, (_, i) => `tap_${i + 1}`)
  return ['terminal_positive', ...taps, 'terminal_negative']
}

/** The headline value to show on a part (resistance / supply voltage / forward voltage). */
export function primaryValue(
  definition: string,
  parameters: Parameters | undefined,
): string | null {
  if (definition === 'resistor') {
    const r = amountOf(parameters, 'resistance')
    return r === undefined ? null : formatEng(r, 'Ω')
  }
  if (definition === 'power_source') {
    // An AC source headlines its swing + frequency; a DC source its voltage.
    const ac = amountOf(parameters, 'ac_amplitude') ?? 0
    const f = amountOf(parameters, 'frequency') ?? 0
    if (ac > 0 && f > 0) return `${formatEng(ac, 'V')}~ ${formatEng(f, 'Hz')}`
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
  if (definition === 'transistor_bjt_npn' || definition === 'transistor_bjt_pnp') {
    const beta = amountOf(parameters, 'forward_current_gain')
    return beta === undefined ? null : `β ${beta}`
  }
  if (definition === 'capacitor') {
    const c = amountOf(parameters, 'capacitance')
    return c === undefined ? null : formatEng(c, 'F')
  }
  if (definition === 'inductor') {
    const l = amountOf(parameters, 'inductance')
    return l === undefined ? null : formatEng(l, 'H')
  }
  if (definition === 'transformer' || definition === 'transformer_center_tapped') {
    // Headline the turns ratio n ≈ √(L2/L1), e.g. "1:10" for a step-up.
    const l1 = amountOf(parameters, 'primary_inductance')
    const l2 = amountOf(parameters, 'secondary_inductance')
    if (l1 === undefined || l2 === undefined || l1 <= 0 || l2 <= 0) return null
    const n = Math.sqrt(l2 / l1)
    const round = (x: number) => Math.round(x * 10) / 10
    return n >= 1 ? `1:${round(n)}` : `${round(1 / n)}:1`
  }
  return null
}
