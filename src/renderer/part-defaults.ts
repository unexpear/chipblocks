import type { Instance } from '../cross-fk-validator.ts'
import { readEnumParam, readScalarParam } from '../instance-params.ts'
import { ldrResistance, lightSensorCurrent } from '../light.ts'
import { propagationDelayS } from '../transmission-line-model.ts'
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
    internal_resistance: scalar(1.7, 'ohm'),
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
    // Bourns RLB1014-103KL, a 10 mH radial-lead choke. (Previously cited to the
    // RLB0914 package, which only reaches tens of microhenries — 10 mH lives in the
    // larger RLB1014/RLB1314 cans.) Datasheet/Octopart: 10 mH, 32 Ω max DCR, 135 mA.
    inductance: scalar(0.01, 'henry'),
    winding_resistance: scalar(32, 'ohm'),
    current_rating: scalar(0.135, 'ampere'),
  },
  electromagnet: {
    // A small DC electromagnet / relay-coil class: ~500 turns of fine copper on a
    // soft-iron core (μ_r ~1000), ~0.25 cm² over an 8 cm path. The inductance is DERIVED
    // from this geometry (L = µ₀·µ_r·N²·A/l ≈ 0.098 H), never declared — one source of
    // truth with the field. A fraction of an amp drives it into iron saturation (~2 T)
    // and a real pull on an armature.
    turns: scalar(500, 'dimensionless'),
    relative_permeability: scalar(1000, 'dimensionless'),
    magnetic_path_length: scalar(0.08, 'metre'),
    core_area: scalar(2.5e-5, 'm^2'),
    saturation_flux_density: scalar(2.0, 'tesla'),
    winding_resistance: scalar(40, 'ohm'),
    current_rating: scalar(0.25, 'ampere'),
    winding: { value: 'copper' },
  },
  induction_motor: {
    // A ~4 kW 4-pole 3-phase induction motor on a 400 V line (230 V per phase), 50 Hz. Per-phase
    // equivalent circuit, representative values: R1 2 Ω, X1 4 Ω, R2 2 Ω, X2 4 Ω, Xm 80 Ω. At ~20 N·m
    // load it runs near 1420 RPM (~5% slip) at ~0.85 power factor; the locked-rotor (start) current
    // is several times the running current.
    supply_voltage: scalar(230, 'volt'),
    line_frequency: scalar(50, 'hertz'),
    pole_count: scalar(4, 'dimensionless'),
    stator_resistance: scalar(2, 'ohm'),
    stator_reactance: scalar(4, 'ohm'),
    rotor_resistance: scalar(2, 'ohm'),
    rotor_reactance: scalar(4, 'ohm'),
    magnetizing_reactance: scalar(80, 'ohm'),
    load_torque: scalar(20, 'N*m'),
    viscous_friction: scalar(0.002, 'N*m*s/rad'),
    winding: { value: 'copper' },
  },
  crt: {
    // A small cathode-ray tube (oscilloscope class). The electron gun draws ~0.1 mA from a 2 kV
    // anode (EHT); the grid bias (−10 V against a −50 V cutoff) sets ~80% brightness. Deflection
    // sensitivity ~0.02 of the screen half-width per volt at 2 kV — so ~50 V deflects the spot to the
    // edge (a higher EHT stiffens the beam, deflecting less). Wire X/Y sources to move the spot.
    beam_current: scalar(0.0001, 'ampere'),
    grid_bias: scalar(-10, 'volt'),
    grid_cutoff_voltage: scalar(-50, 'volt'),
    deflection_sensitivity: scalar(0.02, '1/volt'),
    rated_anode_voltage: scalar(2000, 'volt'),
    electrodes: { value: 'tungsten' },
  },
  neon_lamp: {
    // A neon indicator (NE-2 class). It STRIKES at ~90 V, then glows at a ~65 V maintaining voltage,
    // holding until the current drops below ~0.1 mA. Run it from a higher supply through a large
    // BALLAST (~100 kΩ–1 MΩ) that sets the ~0.5 mA glow current. A dim orange indicator (~0.5 lm/W);
    // a fluorescent tube is the same discharge + a phosphor, far more efficient (~60 lm/W). Starts dark.
    maintaining_voltage: scalar(65, 'volt'),
    breakover_voltage: scalar(90, 'volt'),
    holding_current: scalar(0.0001, 'ampere'),
    max_current: scalar(0.005, 'ampere'),
    luminous_efficacy: scalar(0.5, 'lm/W'),
    device_state: { value: 'blocking' },
    electrodes: { value: 'copper' },
  },
  arc_lamp: {
    // A small carbon arc lamp. It STRIKES once ~60 V appears across the gap, then burns on the Ayrton
    // curve V = V_min + B/I — ~50 V at high current, rising as the current falls — until below ~0.5 A. Run it from a
    // ~70 V+ supply through a BALLAST that sets the current — without one it runs away. ~15 lm/W,
    // a ~3800 K crater. Starts extinguished (device_state blocking).
    arc_voltage: scalar(50, 'volt'),
    ayrton_coefficient: scalar(48, 'V·A'),
    breakover_voltage: scalar(60, 'volt'),
    holding_current: scalar(0.5, 'ampere'),
    max_current: scalar(12, 'ampere'),
    luminous_efficacy: scalar(15, 'lm/W'),
    arc_temperature: scalar(3800, 'kelvin'),
    device_state: { value: 'blocking' },
    electrodes: { value: 'tungsten' },
  },
  generator: {
    // A small bench dynamo (~12 V class). Spun at 3000 RPM with k = 0.04 V·s/rad it makes
    // E = k·ω ≈ 12.6 V open-circuit; R_a 1.5 Ω → ~8.4 A into a short. Light friction sets a
    // small windage loss (used by the drive-torque + efficiency readings).
    machine_constant: scalar(0.04, 'V*s/rad'),
    armature_resistance: scalar(1.5, 'ohm'),
    drive_speed: scalar(3000, 'rpm'),
    viscous_friction: scalar(1e-5, 'N*m*s/rad'),
    winding: { value: 'copper' },
  },
  dc_motor: {
    // A small 12 V brushed DC motor (hobby / gearmotor class). R_a 2 Ω; motor constant
    // k ≈ 0.02 V·s/rad (= N·m/A); light friction → ~5600 RPM no-load drawing ~0.15 A.
    // Stalled it draws V/R_a = 6 A and makes k·6 = 0.12 N·m. L_a (armature inductance)
    // and J (rotor inertia) set the spin-up — a fast electrical τ and a slower mechanical one.
    armature_resistance: scalar(2, 'ohm'),
    motor_constant: scalar(0.02, 'V*s/rad'),
    viscous_friction: scalar(5e-6, 'N*m*s/rad'),
    armature_inductance: scalar(1e-3, 'henry'),
    rotor_inertia: scalar(1e-5, 'kg*m^2'),
    load_torque: scalar(0, 'N*m'),
    // Design-it inputs: the same motor as an openable assembly. These derive k, R_a and
    // J (the lumped values above) — chosen so the default design reproduces them: ferrite
    // magnets across a small gap on a ~22 × 25 mm iron rotor, 500 turns of 21 AWG copper.
    design_mode: { value: 'block' },
    winding_turns: scalar(500, 'dimensionless'),
    wire_gauge: scalar(21, 'dimensionless'),
    magnet_remanence: scalar(0.4, 'tesla'),
    core_relative_permeability: scalar(2000, 'dimensionless'),
    magnet_length: scalar(0.005, 'meter'),
    air_gap: scalar(0.0008, 'meter'),
    rotor_diameter: scalar(0.022, 'meter'),
    stack_length: scalar(0.025, 'meter'),
    rotor_density: scalar(7800, 'kilogram/meter^3'),
  },
  transmission_line: {
    // A ~300 m open-wire pair (Z₀ ≈ 300 Ω, velocity factor 0.95 → τ ≈ 1.05 µs end to end).
    // Long enough that the wave delay is visible on the scope's µs timebase — close a
    // switch and the far end stays dark for ~a microsecond before the wave lands.
    characteristic_impedance: scalar(300, 'ohm'),
    length: scalar(300, 'meter'),
    velocity_factor: scalar(0.95, 'dimensionless'),
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
    // 1N4007 — the universal 1 A axial rectifier: forward drop ≤ 1.0 V at the 1 A
    // rating (the Shockley calibration point; the curve then gives the realistic
    // ~0.7 V at smaller currents), blocking up to 1000 V PIV. Thermal: R_thJA
    // 100 K/W per the Diodes Inc. 1N4007 datasheet (Fairchild lists 50 K/W at
    // 9.5 mm lead length — it is mounting/lead-length dependent); T_J max 150 °C.
    forward_voltage: scalar(1.0, 'volt'),
    max_forward_current: scalar(1, 'ampere'),
    peak_inverse_voltage: scalar(1000, 'volt'),
    n_side: { value: 'silicon_n_type' },
    p_side: { value: 'silicon_p_type' },
    thermal_resistance_junction_ambient: scalar(100, 'kelvin_per_watt'),
    max_operating_temperature: scalar(150, 'celsius'),
  },
  diode_zener_silicon: {
    // 1N4733A — a 5.1 V, 1 W silicon zener. Reverse breakdown REGULATES at V_Z
    // (5.1 V); forward it drops like a silicon diode — V_F 1.2 V max at I_F =
    // 200 mA per the 1N4733A datasheet (onsemi/Fairchild). Knee ~1 mA; max zener
    // current ~178 mA (datasheet I_ZM — the 1 W rating derates it below the naive P_max/V_Z ≈ 196 mA).
    // V_Z is selectable across the E24 series (2.4–200 V) per the device fixture.
    zener_voltage: scalar(5.1, 'volt'),
    max_zener_current: scalar(0.178, 'ampere'),
    knee_current: scalar(0.001, 'ampere'),
    forward_voltage: scalar(1.2, 'volt'),
    power_dissipation_max: scalar(1, 'watt'),
    n_side: { value: 'silicon_n_type' },
    p_side: { value: 'silicon_p_type' },
  },
  led: {
    // Kingbright WP7113SRD/D, a 5 mm red LED: 2.0 V at 20 mA max, ~640 nm red
    // emission — sets the on-canvas glow color. n_side/p_side are the real
    // semiconductor (red AlGaInP, the device-led default); the Color picker sets
    // the material together with the matching wavelength + forward voltage.
    // Thermal: +85 °C max operating (datasheet −40 to +85 °C); θ_JA ~300 K/W is
    // the 5 mm-epoxy-LED class value (small LEDs like this do not spec θ_JA).
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
  diode_laser: {
    // 650 nm red laser diode (laser-pointer class, e.g. Ushio HL6501MG): ~2.4 V operating,
    // I_th ~ 25 mA, differential (slope) quantum efficiency ~0.3, ~5 mW near 35 mA. AlGaInP red.
    forward_voltage: scalar(2.4, 'volt'),
    peak_wavelength: scalar(650, 'nanometer'),
    threshold_current: scalar(0.025, 'ampere'),
    external_quantum_efficiency: scalar(0.3, 'dimensionless'),
    max_forward_current: scalar(0.05, 'ampere'),
    n_side: { value: 'aluminum_gallium_indium_phosphide_n_type' },
    p_side: { value: 'aluminum_gallium_indium_phosphide_p_type' },
    thermal_resistance_junction_ambient: scalar(200, 'kelvin_per_watt'),
    max_operating_temperature: scalar(70, 'celsius'),
  },
  diode_tunnel: {
    // 1N3712 (Ge tunnel diode) class: I_P 1 mA at V_P ~65 mV, I_V 0.12 mA at V_V ~350 mV.
    peak_current: scalar(1e-3, 'ampere'),
    peak_voltage: scalar(0.065, 'volt'),
    valley_current: scalar(0.12e-3, 'ampere'),
    valley_voltage: scalar(0.35, 'volt'),
    max_forward_current: scalar(5e-3, 'ampere'),
    n_side: { value: 'silicon_n_type' },
    p_side: { value: 'silicon_p_type' },
    thermal_resistance_junction_ambient: scalar(300, 'kelvin_per_watt'),
    max_operating_temperature: scalar(100, 'celsius'),
  },
  diode_shockley: {
    // 4-layer (PNPN) diode class: breakover ~20 V, holding ~5 mA, ~1.1 V on-state, 1 A rating.
    breakover_voltage: scalar(20, 'volt'),
    holding_current: scalar(5e-3, 'ampere'),
    forward_voltage: scalar(1.1, 'volt'),
    max_forward_current: scalar(1, 'ampere'),
    device_state: { value: 'blocking' },
    n_side: { value: 'silicon_n_type' },
    p_side: { value: 'silicon_p_type' },
    thermal_resistance_junction_ambient: scalar(80, 'kelvin_per_watt'),
    max_operating_temperature: scalar(125, 'celsius'),
  },
  diode_varactor: {
    // Abrupt-junction varactor class (e.g. 1N5461 / BB-series): Cj0 ~100 pF, Vj 0.7 V, m 0.5.
    junction_capacitance_zero_bias: scalar(100e-12, 'farad'),
    junction_potential: scalar(0.7, 'volt'),
    grading_coefficient: scalar(0.5, 'dimensionless'),
    forward_voltage: scalar(0.7, 'volt'),
    max_forward_current: scalar(0.1, 'ampere'),
    transit_time: scalar(1e-9, 'second'),
    n_side: { value: 'silicon_n_type' },
    p_side: { value: 'silicon_p_type' },
    thermal_resistance_junction_ambient: scalar(300, 'kelvin_per_watt'),
    max_operating_temperature: scalar(125, 'celsius'),
  },
  scr: {
    // 2N5060-class SCR (TO-92). Blocks to a high self-breakover; the gate (I_GT ~0.2 mA) fires it
    // well below that. I_H ~5 mA, on-state ~1.7 V, ~0.8 A. R_GK chosen so I_GT·R ≈ 0.7 V (the gate
    // trigger voltage) — the linear stand-in for the gate junction.
    breakover_voltage: scalar(100, 'volt'),
    holding_current: scalar(5e-3, 'ampere'),
    forward_voltage: scalar(1.7, 'volt'),
    max_forward_current: scalar(0.8, 'ampere'),
    gate_trigger_current: scalar(0.2e-3, 'ampere'),
    gate_cathode_resistance: scalar(3500, 'ohm'),
    device_state: { value: 'blocking' },
    n_side: { value: 'silicon_n_type' },
    p_side: { value: 'silicon_p_type' },
    thermal_resistance_junction_ambient: scalar(80, 'kelvin_per_watt'),
    max_operating_temperature: scalar(125, 'celsius'),
  },
  vacuum_diode: {
    // 6AL5 / EB91-class small-signal vacuum rectifier (representative): its plate
    // characteristic passes ~9.5 mA at 10 V → perveance ≈ 3e-4 A/V^1.5. Hot cathode
    // assumed (the heater is documented, not modeled). ~1 W plate, ~330 V peak inverse.
    reference_plate_voltage: scalar(10, 'volt'),
    plate_current_at_reference: scalar(0.0095, 'ampere'),
    max_plate_dissipation: scalar(1, 'watt'),
    max_plate_voltage: scalar(330, 'volt'),
    cathode_material: { value: 'tungsten' },
    plate_material: { value: 'copper' },
  },
  triode: {
    // 12AX7-class high-μ preamp triode (representative): μ = 100, calibrated at a
    // 250 V plate / −2 V grid / 1.2 mA plate operating point → perveance ≈ 3.4e-3.
    // Hot cathode assumed (heater documented, not modeled). ~1 W plate.
    amplification_factor: scalar(100, 'dimensionless'),
    reference_plate_voltage: scalar(250, 'volt'),
    reference_grid_voltage: scalar(-2, 'volt'),
    plate_current_at_reference: scalar(0.0012, 'ampere'),
    max_plate_dissipation: scalar(1, 'watt'),
    max_plate_voltage: scalar(330, 'volt'),
    cathode_material: { value: 'tungsten' },
    grid_material: { value: 'copper' },
    plate_material: { value: 'copper' },
  },
  tetrode: {
    // Small-signal screen-grid tube (representative): the control grid sets the current,
    // the screen (~100 V) accelerates and shields the plate, so the plate barely affects
    // the current (μ_plate ~2000 → a flat, high-r_p characteristic, higher gain than a
    // triode). Calibrated at 250 V plate / −2 V grid / 100 V screen / 3 mA. Cathode hot.
    screen_amplification_factor: scalar(20, 'dimensionless'),
    plate_amplification_factor: scalar(2000, 'dimensionless'),
    reference_plate_voltage: scalar(250, 'volt'),
    reference_grid_voltage: scalar(-2, 'volt'),
    reference_screen_voltage: scalar(100, 'volt'),
    plate_current_at_reference: scalar(0.003, 'ampere'),
    max_plate_dissipation: scalar(2, 'watt'),
    max_plate_voltage: scalar(330, 'volt'),
    cathode_material: { value: 'tungsten' },
    grid_material: { value: 'copper' },
    screen_material: { value: 'copper' },
    plate_material: { value: 'copper' },
  },
  pentode: {
    // EF86-class small-signal pentode (representative): the suppressor grid (tied to the
    // cathode) returns secondary electrons and removes the tetrode kink, so it works
    // cleanly even with the plate below the screen. Very high r_p (μ_plate ~4000) → high
    // gain. Calibrated at 250 V plate / −2 V grid / 140 V screen / 3 mA. Cathode hot.
    screen_amplification_factor: scalar(25, 'dimensionless'),
    plate_amplification_factor: scalar(4000, 'dimensionless'),
    reference_plate_voltage: scalar(250, 'volt'),
    reference_grid_voltage: scalar(-2, 'volt'),
    reference_screen_voltage: scalar(140, 'volt'),
    plate_current_at_reference: scalar(0.003, 'ampere'),
    max_plate_dissipation: scalar(1, 'watt'),
    max_plate_voltage: scalar(330, 'volt'),
    cathode_material: { value: 'tungsten' },
    grid_material: { value: 'copper' },
    screen_material: { value: 'copper' },
    suppressor_material: { value: 'copper' },
    plate_material: { value: 'copper' },
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
  switch_spst_momentary: {
    // 12 mm tactile push button (Omron B3F class): nickel/silver dome,
    // ~100 mΩ closed, signal-level 50 mA / 24 V. Starts OPEN (normally open) —
    // double-click presses it closed, again releases it.
    state: { value: 'open' },
    contact_material: { value: 'copper' },
    contact_resistance_closed: scalar(0.1, 'ohm'),
    max_current: scalar(0.05, 'ampere'),
    rated_voltage: scalar(24, 'volt'),
  },
  switch_spdt: {
    // Panel-mount SPDT toggle (C&K 7201 — the SPDT sibling of the 7101 SPST):
    // copper contacts, ~20 mΩ, 6 A, 125 V. Starts on throw A; double-click
    // flips the common to throw B. `position` is a runtime enum.
    position: { value: 'throw_a' },
    contact_material: { value: 'copper' },
    contact_resistance_closed: scalar(0.02, 'ohm'),
    max_current: scalar(6, 'ampere'),
    rated_voltage: scalar(125, 'volt'),
  },
  potentiometer: {
    // 10 kΩ linear pot (Bourns 3296/3386 cermet class): ±10 %, 0.5 W at 70 °C,
    // linear taper. Wiper starts centered (0.5). track_material is the catalog's
    // resistive stand-in — real pots use a carbon-composition or cermet track the
    // catalog doesn't carry yet, so nichrome holds the resistive role.
    resistance: scalar(10000, 'ohm'),
    track_material: { value: 'nichrome' },
    wiper_position: scalar(0.5, 'dimensionless'),
    taper: { value: 'linear' },
    power_rating: scalar(0.5, 'watt'),
  },
  fuse: {
    // 500 mA 5x20 mm glass fast-blow (Littelfuse 217 series): ~0.9 Ω cold
    // element, 250 V. Starts intact (conducting); blows to OPEN when its current
    // exceeds 500 mA, and stays blown until double-clicked to replace.
    rated_current: scalar(0.5, 'ampere'),
    element_material: { value: 'copper' },
    element_resistance: scalar(0.9, 'ohm'),
    voltage_rating: scalar(250, 'volt'),
    blow_type: { value: 'fast' },
    state: { value: 'intact' },
  },
  thermistor: {
    // 10 kΩ NTC bead (Vishay NTCLE100E3103 class): R25 = 10 kΩ, B25/85 = 3977 K,
    // dissipation ~1.5 mW/°C in still air → θ_JA ≈ 667 °C/W. No ambient_temperature of its own, so it
    // inherits the project-wide ambient (the toolbar's Ambient °C, default 25 °C); set a per-part
    // ambient_temperature to place THIS bead somewhere warmer/cooler, or push current through it to
    // watch self-heating drive the resistance down.
    resistance: scalar(10000, 'ohm'),
    beta_coefficient: scalar(3977, 'kelvin'),
    reference_temperature: scalar(25, 'celsius'),
    sensing_material: { value: 'nichrome' },
    thermal_resistance_junction_ambient: scalar(667, 'kelvin_per_watt'),
    max_operating_temperature: scalar(125, 'celsius'),
  },
  incandescent_bulb: {
    // 120 V / 60 W household incandescent. The HOT resistance is V²/P = 240 Ω at
    // the ~2700 K (2427 °C) operating filament temperature; the tungsten power law
    // puts the COLD (ohmmeter) resistance ~14× lower (~17 Ω), the source of switch-on
    // inrush. The filament is radiation-cooled, so rated_power pins its T⁴ balance —
    // at 120 V it settles right at 60 W / 2427 °C. max 2900 °C is the burnout line
    // (well over the rated temperature, under tungsten's 3422 °C melting point).
    resistance: scalar(240, 'ohm'),
    reference_temperature: scalar(2427, 'celsius'),
    rated_power: scalar(60, 'watt'),
    rated_voltage: scalar(120, 'volt'),
    max_operating_temperature: scalar(2900, 'celsius'),
    filament_material: { value: 'tungsten' },
  },
  photoresistor: {
    // GL5528 CdS photoresistor (the ubiquitous 5 mm hobbyist LDR): ~12 kΩ at
    // 10 lux, γ ≈ 0.6, ~1 MΩ dark. Starts in 100 lux (typical indoor light)
    // → ~3 kΩ; dial incident_illuminance toward darkness to drive its resistance
    // up to ~1 MΩ, toward daylight to drive it down to a few hundred ohms.
    reference_resistance: scalar(12000, 'ohm'),
    reference_illuminance: scalar(10, 'lux'),
    gamma: scalar(0.6, 'dimensionless'),
    dark_resistance: scalar(1000000, 'ohm'),
    ambient_illuminance: scalar(100, 'lux'),
    photoconductive_material: { value: 'nichrome' },
    max_operating_temperature: scalar(70, 'celsius'),
  },
  light_source: {
    // A small lamp: 10 cd (a bright LED indicator; a standard candle is 1 cd). On
    // the 1px=1mm scale, at 100 px (10 cm) it casts E = 10/0.1² = 1000 lux onto a
    // sensor; drag the sensor closer or further and the cast follows 1/d².
    luminous_intensity: scalar(10, 'candela'),
    emitter: { value: 'nichrome' },
  },
  photodiode: {
    // BPW34-class silicon photodiode: ~10 nA/lux, ~900 nm peak, 1 GΩ shunt, 32 V
    // reverse, ~2 nA dark. Starts in 100 lux indoor light → ~1 µA photocurrent.
    photocurrent_per_lux: scalar(1e-8, 'ampere_per_lux'),
    ambient_illuminance: scalar(100, 'lux'),
    shunt_resistance: scalar(1e9, 'ohm'),
    peak_wavelength: scalar(900, 'nanometer'),
    max_reverse_voltage: scalar(32, 'volt'),
    dark_current: scalar(2e-9, 'ampere'),
    photoconductive_material: { value: 'silicon_n_type' },
  },
  phototransistor: {
    // Generic NPN phototransistor: ~10 nA/lux base photocurrent × β 300 ≈ 3 µA/lux
    // collector. Starts in 100 lux → ~0.3 mA; bright light → milliamps.
    photocurrent_per_lux: scalar(1e-8, 'ampere_per_lux'),
    current_gain: scalar(300, 'dimensionless'),
    ambient_illuminance: scalar(100, 'lux'),
    shunt_resistance: scalar(1e8, 'ohm'),
    peak_wavelength: scalar(880, 'nanometer'),
    max_collector_current: scalar(0.05, 'ampere'),
    collector_emitter_voltage: scalar(30, 'volt'),
    photoconductive_material: { value: 'silicon_n_type' },
  },
  relay: {
    // 5 V SPDT signal/power relay (SONGLE SRD-05VDC-SL-C, the ubiquitous blue
    // Arduino-module relay): 70 Ω coil (~71 mA, ~0.36 W at 5 V), must-operate
    // 75 % = 3.75 V, must-release 10 % = 0.5 V, 10 A contacts. Starts at rest
    // (de-energized → common on normally_closed).
    coil_resistance: scalar(70, 'ohm'),
    pull_in_voltage: scalar(3.75, 'volt'),
    drop_out_voltage: scalar(0.5, 'volt'),
    nominal_coil_voltage: scalar(5, 'volt'),
    contact_resistance: scalar(0.1, 'ohm'),
    contact_current_rating: scalar(10, 'ampere'),
    coil_material: { value: 'copper' },
    contact_material: { value: 'copper' },
    coil_state: { value: 'de_energized' },
  },
  transistor_bjt_npn: {
    // 2N3904 (onsemi) — the classic jellybean small-signal NPN. beta + I_S are
    // part-specific, so the device definition carries no builtin numeric default
    // (device-power-source convention); these are the cited canvas drop defaults.
    saturation_current: scalar(1e-14, 'ampere'),
    forward_current_gain: scalar(100, 'dimensionless'),
    reverse_current_gain: scalar(2, 'dimensionless'),
    forward_early_voltage: scalar(74, 'volt'),
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
    forward_early_voltage: scalar(19, 'volt'),
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
    threshold_temperature_coefficient: scalar(-0.0034, 'volt_per_kelvin'),
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
    threshold_temperature_coefficient: scalar(0.0034, 'volt_per_kelvin'),
    max_drain_current: scalar(0.23, 'ampere'),
    drain_source_breakdown_voltage: scalar(45, 'volt'),
    max_gate_source_voltage: scalar(20, 'volt'),
    body_region: { value: 'silicon_n_type' },
    source_drain_regions: { value: 'silicon_p_type' },
    gate_dielectric: { value: 'silicon_dioxide' },
    thermal_resistance_junction_ambient: scalar(178.6, 'kelvin_per_watt'),
    max_operating_temperature: scalar(150, 'celsius'),
  },
  transistor_jfet_n_channel: {
    // 2N5457 (N-JFET) datasheet typicals: V_GS(off) ~ -1.5 V, I_DSS ~ 3 mA →
    // beta = I_DSS / V_P^2 = 3e-3 / 1.5^2 ≈ 1.33 mA/V^2. lambda a Level-1 class value.
    pinch_off_voltage: scalar(-1.5, 'volt'),
    transconductance: scalar(1.33e-3, 'ampere_per_volt_squared'),
    channel_length_modulation: scalar(0.02, 'per_volt'),
    channel_region: { value: 'silicon_n_type' },
    gate_region: { value: 'silicon_p_type' },
    max_drain_current: scalar(0.01, 'ampere'),
    thermal_resistance_junction_ambient: scalar(350, 'kelvin_per_watt'),
    max_operating_temperature: scalar(150, 'celsius'),
  },
  transistor_jfet_p_channel: {
    // 2N5460 (P-JFET) datasheet typicals: V_GS(off) ~ +2 V, |I_DSS| ~ 2 mA →
    // beta = |I_DSS| / V_P^2 = 2e-3 / 2^2 = 0.5 mA/V^2.
    pinch_off_voltage: scalar(2, 'volt'),
    transconductance: scalar(5e-4, 'ampere_per_volt_squared'),
    channel_length_modulation: scalar(0.02, 'per_volt'),
    channel_region: { value: 'silicon_p_type' },
    gate_region: { value: 'silicon_n_type' },
    max_drain_current: scalar(0.01, 'ampere'),
    thermal_resistance_junction_ambient: scalar(350, 'kelvin_per_watt'),
    max_operating_temperature: scalar(150, 'celsius'),
  },
  diode_constant_current: {
    // 1N5305 (current-limiting diode): I_P = 2.0 mA regulated. knee ~ 1.3 V (the minimum
    // voltage to reach regulation). lambda small — a CRD has very high output impedance.
    limiting_current: scalar(2.0e-3, 'ampere'),
    knee_voltage: scalar(1.3, 'volt'),
    channel_length_modulation: scalar(0.005, 'per_volt'),
    channel_region: { value: 'silicon_n_type' },
    gate_region: { value: 'silicon_p_type' },
    thermal_resistance_junction_ambient: scalar(350, 'kelvin_per_watt'),
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
    internal_resistance:
      '~1.7 Ω DC internal resistance of a typical 9 V alkaline (Duracell MN1604 class) — a representative mid-life figure, not the best-case fresh one (a fresh cell can be ~1 Ω, climbing to several ohms as it discharges); the 1 kHz AC impedance runs similar, ~1.7–3 Ω',
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
    inductance: 'Bourns RLB1014-103KL, 10 mH radial-lead choke (the RLB0914 package is µH-only)',
    winding_resistance: '32 Ω max DC resistance (RLB1014-103KL datasheet)',
    current_rating: '135 mA rated current (RLB1014-103KL datasheet)',
  },
  electromagnet: {
    turns: '~500 turns — small DC electromagnet / relay-coil class',
    relative_permeability: 'soft-iron core μ_r ~1000 (effective μ_r is lower across an air gap)',
    magnetic_path_length: '~8 cm magnetic path length (small coil)',
    core_area: '~0.25 cm² core → derived L = µ₀µ_rN²A/l ≈ 0.098 H, and the pole area for the pull',
    saturation_flux_density:
      'soft iron saturates ~1.5–2 T (≈2.1 T pure iron); 2.0 T representative',
    winding_resistance: '≈40 Ω fine-copper coil (relay / small-solenoid class)',
    current_rating: '~0.25 A through fine magnet wire',
  },
  induction_motor: {
    supply_voltage: 'per-phase RMS line voltage (230 V phase of a 400 V 3-phase line)',
    line_frequency: '50 Hz mains (60 Hz elsewhere)',
    pole_count: '4-pole → 1500 RPM synchronous at 50 Hz (120·f/poles)',
    stator_resistance: 'representative per-phase R1 (~2 Ω) for a ~4 kW machine',
    stator_reactance: 'representative stator leakage X1 (~4 Ω at 50 Hz)',
    rotor_resistance: 'referred rotor R2 (~2 Ω) — sets the slip and starting torque',
    rotor_reactance: 'referred rotor leakage X2 (~4 Ω)',
    magnetizing_reactance: 'magnetizing branch Xm (~80 Ω), the no-load magnetizing current',
    load_torque: 'shaft load (~20 N·m) for a ~4 kW class machine near rated slip',
    viscous_friction: 'windage + bearing loss',
  },
  crt: {
    beam_current: 'CRT beam current ~0.1-1 mA (oscilloscope / TV electron gun)',
    grid_bias: 'grid bias that sets the brightness (0 = full beam, cutoff = blanked)',
    grid_cutoff_voltage: 'grid cutoff bias ~−30 to −70 V (the bias that blanks the beam)',
    deflection_sensitivity: 'electrostatic deflection, screen-fraction per volt at the rated EHT',
    rated_anode_voltage: '~2 kV anode (EHT) for a small CRT; TVs use 10-25 kV',
  },
  neon_lamp: {
    maintaining_voltage: 'neon glow-discharge sustaining voltage ~60-65 V (NE-2)',
    breakover_voltage: 'neon striking / ignition voltage ~90 V (NE-2)',
    holding_current: '~0.1 mA minimum to sustain the glow',
    max_current: '~few mA before the electrodes sputter (NE-2)',
    luminous_efficacy: 'neon indicator is dim (~0.5 lm/W); a fluorescent tube reaches ~60 lm/W',
  },
  arc_lamp: {
    arc_voltage:
      'carbon arc burns at ~40-55 V (Ayrton); 50 V representative V_min (high-current asymptote)',
    ayrton_coefficient:
      'Ayrton (1902) falling characteristic V = V_min + B/I; B = c + d·ℓ ≈ 48 V·A for a short carbon arc — condition-dependent, medium confidence',
    breakover_voltage:
      'ignition threshold — a model abstraction (real arcs strike by electrode contact or a higher gap breakdown)',
    holding_current: '~0.5 A minimum to sustain the ionized column',
    max_current: '~12 A electrode rating (above it the carbons erode / overheat fast)',
    luminous_efficacy: 'carbon arc ~10-20 lm/W; 15 representative',
    arc_temperature: 'carbon-arc positive crater ~3800 K (near carbon sublimation)',
  },
  generator: {
    machine_constant: 'k ≈ 0.04 V·s/rad = N·m/A → E = k·ω ≈ 12.6 V at 3000 RPM',
    armature_resistance: 'small bench dynamo, ~1.5 Ω winding (short-circuit ~8.4 A)',
    drive_speed: 'prime-mover speed 3000 RPM (a governed/regulated drive holds it constant)',
    viscous_friction: 'windage/bearing loss — sets the drive torque + efficiency reading',
  },
  dc_motor: {
    armature_resistance: 'small 12 V brushed motor, ~2 Ω winding (hobby / gearmotor class)',
    motor_constant: 'k ≈ 0.02 V·s/rad = N·m/A → ~5600 RPM no-load at 12 V',
    viscous_friction: 'damping set for ~0.15 A no-load current (bearing friction + windage)',
    armature_inductance: '~1 mH armature inductance (electrical τ = L_a/R_a ≈ 0.5 ms)',
    rotor_inertia: '~1e-5 kg·m² rotor inertia (mechanical spin-up ~50 ms)',
    load_torque: 'external shaft load; 0 = free-running (keep ≤ the stall torque k·V/R_a)',
  },
  transmission_line: {
    characteristic_impedance: 'open two-wire line ~300 Ω (Z₀ = (η₀/π)·acosh(D/d))',
    length: '~300 m → τ ≈ 1.05 µs end to end (visible on the µs timebase)',
    velocity_factor: '~0.95 c for open wire in air; ~0.66 for typical coax',
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
    forward_voltage: '1N4007: ~1.0 V typical at 1 A (datasheet V_F max 1.1 V)',
    max_forward_current: '1N4007 rating (1 A continuous)',
    peak_inverse_voltage: '1N4007 (1000 V repetitive reverse)',
    thermal_resistance_junction_ambient:
      '100 K/W (Diodes Inc. 1N4007 datasheet; Fairchild lists 50 K/W at 9.5 mm lead — mounting-dependent)',
    max_operating_temperature: '1N4007 T_J max 150 °C (datasheet)',
  },
  led: {
    forward_voltage: 'Kingbright WP7113SRD-D (5 mm red)',
    max_forward_current: '5 mm indicator LED standard (20 mA)',
    peak_wavelength: 'AlGaInP red ~640 nm',
    thermal_resistance_junction_ambient:
      '~300 K/W, 5 mm-epoxy-LED class (the WP7113 datasheet, like most small LEDs, does not spec θ_JA)',
    max_operating_temperature:
      'Kingbright WP7113SRD-D operating max +85 °C (datasheet −40 to +85 °C)',
  },
  led_uv_algan: {
    forward_voltage: 'AlGaN UV LED (~3.4 V at 20 mA)',
    max_forward_current: '20 mA',
    peak_wavelength: 'AlGaN UV ~340 nm',
    thermal_resistance_junction_ambient:
      '~300 K/W, 5 mm-LED class (θ_JA not specced on small LEDs)',
    max_operating_temperature: '~85 °C, 5 mm-LED operating class',
  },
  diode_laser: {
    forward_voltage:
      '650 nm red laser diode operating ~2.4 V (laser-pointer class, e.g. Ushio HL6501MG)',
    peak_wavelength: 'AlGaInP red laser ~650 nm',
    threshold_current:
      '~25 mA lasing threshold, 650 nm red laser-diode class (medium confidence — typical, not one exact datasheet)',
    external_quantum_efficiency:
      'differential (slope) quantum efficiency ~0.3 above threshold, red edge-emitter class',
    max_forward_current: '~50 mA absolute max, 5 mW red laser-diode class (current-sensitive)',
    thermal_resistance_junction_ambient: 'small laser-diode package class (~200 K/W)',
    max_operating_temperature: '~70 °C max, laser-diode class (threshold climbs with heat)',
  },
  diode_tunnel: {
    peak_current: '1N3712 (Ge tunnel diode) I_P ~1 mA (datasheet class)',
    peak_voltage: 'Ge tunnel diode peak voltage V_P ~65 mV (class-typical)',
    valley_current: '1N3712-class valley current I_V ~0.12 mA (~1/8 of I_P, Ge class)',
    valley_voltage: 'Ge tunnel diode valley voltage V_V ~350 mV (class-typical)',
    max_forward_current: '~5 mA forward rating, small Ge tunnel-diode class',
    thermal_resistance_junction_ambient: 'small axial package class (~300 K/W)',
    max_operating_temperature: '~100 °C, Ge tunnel-diode class',
  },
  diode_shockley: {
    breakover_voltage:
      '4-layer/Shockley diode breakover ~20 V (class-typical low-voltage trigger device)',
    holding_current: 'thyristor-class holding current ~5 mA',
    forward_voltage: 'on-state drop ~1.1 V (a conducting silicon PNPN)',
    max_forward_current: '~1 A on-state rating, small-thyristor class',
    thermal_resistance_junction_ambient: 'small power package class (~80 K/W)',
    max_operating_temperature: 'thyristor T_J max ~125 °C (class-typical)',
  },
  diode_varactor: {
    junction_capacitance_zero_bias:
      'abrupt-junction varactor class Cj0 ~100 pF (e.g. 1N5461 / BB-series)',
    junction_potential: 'silicon built-in potential ~0.7 V',
    grading_coefficient: 'm = 0.5 for an abrupt junction (0.33 graded, 1–2 hyperabrupt)',
    forward_voltage: 'silicon forward drop ~0.7 V',
    max_forward_current: '~100 mA forward rating, small-signal varactor class',
    transit_time: '~1 ns transit time (sets the forward diffusion charge; negligible in reverse)',
    thermal_resistance_junction_ambient: 'small package class (~300 K/W)',
    max_operating_temperature: 'silicon varactor T_J max ~125 °C',
  },
  scr: {
    breakover_voltage: '2N5060-class self-breakover (rated blocking ~30-60 V; modeled at 100 V)',
    holding_current: '2N5060 holding current ~5 mA',
    forward_voltage: 'on-state drop ~1.7 V (a conducting silicon SCR)',
    max_forward_current: '2N5060 ~0.8 A on-state rating',
    gate_trigger_current: '2N5060 gate trigger current I_GT ~0.2 mA',
    gate_cathode_resistance:
      'chosen so I_GT·R ≈ 0.7 V (the gate trigger voltage); linear stand-in for the gate junction',
    thermal_resistance_junction_ambient: 'small power package class (~80 K/W)',
    max_operating_temperature: 'SCR T_J max ~125 °C (class-typical)',
  },
  vacuum_diode: {
    reference_plate_voltage:
      '6AL5 / EB91-class plate-characteristic point (~9.5 mA at 10 V; representative, medium confidence)',
    plate_current_at_reference:
      'small-signal vacuum-diode plate current (typical curve, not one exact datasheet)',
    max_plate_dissipation: '~1 W plate dissipation, signal-diode tube class',
    max_plate_voltage: '~330 V peak inverse, small vacuum-rectifier class',
  },
  triode: {
    amplification_factor: '12AX7-class μ ≈ 100 (high-μ preamp triode; preamp triodes span ~20-100)',
    reference_plate_voltage:
      '12AX7 typical operating point ~250 V plate (datasheet, representative)',
    reference_grid_voltage: '~-2 V grid bias at the 250 V point (12AX7 datasheet, representative)',
    plate_current_at_reference:
      '~1.2 mA plate current at that bias (12AX7 datasheet, representative)',
    max_plate_dissipation: '12AX7 ~1 W per plate (datasheet)',
    max_plate_voltage: '~330 V plate-voltage class (12AX7 design maximum)',
  },
  tetrode: {
    screen_amplification_factor:
      'control-grid-to-screen μ ~20 (screen-grid tube class, representative)',
    plate_amplification_factor:
      'control-grid-to-plate μ ~2000 → high r_p, the flat characteristic (representative, medium confidence)',
    reference_plate_voltage:
      'small-signal screen-grid tube operating point ~250 V plate (representative)',
    reference_grid_voltage: '~-2 V control-grid bias (representative)',
    reference_screen_voltage: '~100 V screen-grid supply (representative)',
    plate_current_at_reference: '~3 mA plate current at that bias (representative)',
    max_plate_dissipation: '~2 W plate dissipation, small screen-grid tube class',
    max_plate_voltage: '~330 V plate-voltage class',
  },
  pentode: {
    screen_amplification_factor:
      'control-grid-to-screen μ ~25 (small-signal pentode class, representative)',
    plate_amplification_factor:
      'control-grid-to-plate μ ~4000 → very high r_p (EF86-class; representative, medium confidence)',
    reference_plate_voltage:
      'EF86-class small-signal pentode operating point ~250 V plate (representative)',
    reference_grid_voltage: '~-2 V control-grid bias (representative)',
    reference_screen_voltage: '~140 V screen-grid supply (representative)',
    plate_current_at_reference: '~3 mA plate current at that bias (representative)',
    max_plate_dissipation: 'EF86 ~1 W plate (small-signal pentode)',
    max_plate_voltage: '~330 V plate-voltage class',
  },
  switch_spst_toggle: {
    contact_resistance_closed: 'C&K 7101 class (~20 mΩ closed)',
    max_current: 'C&K 7101 (6 A)',
    rated_voltage: 'C&K 7101 (125 V)',
  },
  switch_spst_momentary: {
    contact_resistance_closed: '12 mm tactile button (Omron B3F class): 100 mΩ max',
    max_current: 'Omron B3F rated 50 mA at 24 VDC',
    rated_voltage: 'Omron B3F rated 24 VDC',
  },
  switch_spdt: {
    contact_resistance_closed: 'C&K 7201 SPDT class (~20 mΩ closed)',
    max_current: 'C&K 7201 (6 A)',
    rated_voltage: 'C&K 7201 (125 V)',
  },
  potentiometer: {
    resistance: '10 kΩ standard value (Bourns 3296/3386 cermet trimmer class)',
    wiper_position: 'centered (0.5) — a fresh pot at mid-travel',
    power_rating: 'Bourns 3296 0.5 W at 70 °C (datasheet)',
  },
  fuse: {
    rated_current: '500 mA glass fast-blow (Littelfuse 217.500)',
    element_resistance: 'Littelfuse 217.500 nominal cold resistance ~0.9 Ω (datasheet class)',
    voltage_rating: 'Littelfuse 217 series 250 V rating',
  },
  thermistor: {
    resistance: 'R25 = 10 kΩ NTC (Vishay NTCLE100E3103 class)',
    beta_coefficient: 'B25/85 = 3977 K (Vishay NTCLE100E3103 datasheet)',
    thermal_resistance_junction_ambient:
      'derived: 1/δ, dissipation factor ~1.5 mW/°C in still air (Vishay NTCLE100E3)',
    max_operating_temperature: 'epoxy NTC bead operating class (~125 °C)',
  },
  incandescent_bulb: {
    resistance: 'hot filament R = V²/P = 120²/60 = 240 Ω at the 2700 K operating point',
    reference_temperature:
      'standard incandescent filament ~2700 K (~2427 °C); higher-wattage lamps run hotter (medium confidence)',
    rated_power: '60 W household incandescent (nameplate)',
    rated_voltage: '120 V household mains (nameplate; = √(P·R))',
    max_operating_temperature:
      'filament burnout above the rated temperature; tungsten melts 3422 °C, filaments fail below by evaporation (medium confidence)',
  },
  photoresistor: {
    reference_resistance: '~12 kΩ at 10 lux (GL5528 CdS cell, 10–20 kΩ datasheet band)',
    reference_illuminance: '10 lux — the CdS datasheet reference point',
    gamma: 'GL5528 γ(10–100 lux) ≈ 0.6 (CdS cells span 0.5–0.9, datasheet)',
    dark_resistance: 'GL5528 dark resistance ~1 MΩ (datasheet minimum)',
    ambient_illuminance: 'default 100 lux ≈ typical indoor light (illuminance reference table)',
    max_operating_temperature: 'CdS photoresistor operating class (~70 °C)',
  },
  light_source: {
    luminous_intensity:
      '~10 cd, a small LED lamp (a standard candle is 1 cd — the historical candela anchor)',
  },
  photodiode: {
    photocurrent_per_lux:
      'BPW34-class Si photodiode ~10 nA/lux (representative; spectrum/area-dependent, medium confidence)',
    shunt_resistance: 'silicon photodiode shunt resistance ~1 GΩ (high)',
    peak_wavelength: 'BPW34 peak responsivity ~900 nm, near-IR (Vishay datasheet)',
    max_reverse_voltage: 'BPW34 reverse-voltage rating 32 V (datasheet)',
    dark_current: 'BPW34 ~2 nA dark current at 10 V reverse (datasheet)',
  },
  phototransistor: {
    photocurrent_per_lux:
      'base photocurrent ~10 nA/lux (the photodiode responsivity, before gain; representative)',
    current_gain: 'phototransistor current gain β ~300 (typical 100–500)',
    max_collector_current: 'small phototransistor ~50 mA continuous rating (class)',
    collector_emitter_voltage: 'small phototransistor V_CEO ~30 V (class)',
  },
  relay: {
    coil_resistance: 'SONGLE SRD-05VDC-SL-C 70 Ω coil (~0.36 W at 5 V, datasheet)',
    pull_in_voltage: 'must-operate ≤ 75 % of the 5 V nominal coil (datasheet)',
    drop_out_voltage: 'must-release ≥ 10 % of the 5 V nominal coil (datasheet)',
    contact_current_rating: 'SRD-05 10 A contact rating (datasheet)',
  },
  transistor_bjt_npn: {
    saturation_current: 'small-signal NPN transport I_S ~1e-14 A (2N3904 SPICE IS ~6.7 fA)',
    forward_current_gain: '2N3904 hFE ≥ 100 at I_C = 10 mA (onsemi datasheet)',
    reverse_current_gain:
      'reverse β small for an NPN — a class-typical small reverse gain (~1–5); the 2N3904 SPICE BR itself is ~0.74',
    forward_early_voltage: '2N3904 SPICE model VAF 74.03 V (onsemi/Fairchild), rounded to 74',
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
    threshold_temperature_coefficient:
      'derived from the Vishay 2N7000-family V_GS(th)-vs-temperature curve (doc 70226): −3.35 mV/°C least-squares over −55…150 °C at I_D 250 µA, rounded to −3.4',
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
    threshold_temperature_coefficient:
      'magnitude from the N-channel sibling curve (Vishay 70226, −3.4 mV/°C); sign positive for P-channel (threshold magnitude shrinks when hot); BS250 curve not published as data — medium confidence',
    max_drain_current: 'BS250 I_D −230 mA continuous (datasheet)',
    drain_source_breakdown_voltage: 'BS250 V_DS −45 V (datasheet)',
    max_gate_source_voltage: 'BS250 V_GS ±20 V absolute max — gate-oxide limit',
    thermal_resistance_junction_ambient: 'derived: (150−25) °C / 0.7 W TO-92 power rating',
    max_operating_temperature: 'BS250 T_J max 150 °C (datasheet)',
  },
  transistor_jfet_n_channel: {
    pinch_off_voltage: '2N5457 V_GS(off) ~ −1.5 V typical (−0.5 to −6 V range, onsemi datasheet)',
    transconductance:
      'derived from 2N5457 datasheet typicals I_DSS ~ 3 mA, V_P ~ −1.5 V: beta = I_DSS/V_P² ≈ 1.33 mA/V²',
    channel_length_modulation:
      'textbook Level-1 class value (λ is not on discrete JFET datasheets)',
    max_drain_current: '2N5457 small-signal I_DSS-scale rating (~10 mA), onsemi datasheet class',
    thermal_resistance_junction_ambient: 'TO-92 small-signal package class (~350 K/W)',
    max_operating_temperature: '2N5457 T_J max 150 °C (datasheet)',
  },
  transistor_jfet_p_channel: {
    pinch_off_voltage: '2N5460 V_GS(off) ~ +2 V typical (+0.75 to +6 V range, onsemi datasheet)',
    transconductance:
      'derived from 2N5460 datasheet typicals |I_DSS| ~ 2 mA, V_P ~ +2 V: beta = |I_DSS|/V_P² = 0.5 mA/V²',
    channel_length_modulation:
      'textbook Level-1 class value (λ is not on discrete JFET datasheets)',
    max_drain_current: '2N5460 small-signal I_DSS-scale rating (~10 mA), onsemi datasheet class',
    thermal_resistance_junction_ambient: 'TO-92 small-signal package class (~350 K/W)',
    max_operating_temperature: '2N5460 T_J max 150 °C (datasheet)',
  },
  diode_constant_current: {
    limiting_current:
      '1N5305 (current-limiting diode series) I_P 2.0 mA regulated current (datasheet)',
    knee_voltage: '1N5305-class limiting voltage ~ 1.3 V (minimum voltage to reach regulation)',
    channel_length_modulation:
      'small — a CRD has very high dynamic (output) impedance, so the regulated current barely rises with voltage; Level-1 class value',
    thermal_resistance_junction_ambient: 'small-signal axial/TO-92 package class (~350 K/W)',
    max_operating_temperature: '1N5305 T_J max 150 °C (datasheet)',
  },
  transistor_bjt_pnp: {
    saturation_current: 'small-signal PNP transport I_S ~1e-14 A (2N3906 class)',
    forward_current_gain: '2N3906 hFE ≥ 100 at I_C = 10 mA (onsemi datasheet)',
    reverse_current_gain: 'reverse β small for a PNP — a class-typical small reverse gain (~1–5)',
    forward_early_voltage: '2N3906 SPICE model VAF 18.7 V (onsemi/Fairchild), rounded to 19',
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

/** Is an SPDT routed to throw A? Absent position defaults to throw_a — matches the solver. */
export function spdtOnA(parameters: Parameters | undefined): boolean {
  return stringOf(parameters, 'position') !== 'throw_b'
}

/** Flip an SPDT's selected throw — for the double-click toggle. */
export function toggledSpdt(parameters: Parameters | undefined): Parameters {
  return { ...parameters, position: { value: spdtOnA(parameters) ? 'throw_b' : 'throw_a' } }
}

/**
 * A potentiometer's wiper position as a fraction 0..1 (terminal_a → terminal_b),
 * clamped to the real travel. Absent reads 0.5 (mid-travel) — matches the solver's
 * potentiometerSegments default. Drives the sliding wiper arrow on the symbol.
 */
export function wiperFraction(parameters: Parameters | undefined): number {
  const raw = amountOf(parameters, 'wiper_position') ?? 0.5
  return Math.min(1, Math.max(0, raw))
}

/** Is a fuse intact (conducting)? Absent state defaults to intact — matches the solver. */
export function fuseIntact(parameters: Parameters | undefined): boolean {
  return stringOf(parameters, 'state') !== 'blown'
}

/** Blow a fuse — the canvas sets this when its current exceeds the rating. */
export function blownFuse(parameters: Parameters | undefined): Parameters {
  return { ...parameters, state: { value: 'blown' } }
}

/** Fit a fresh fuse — the double-click "replace" action on a blown fuse. */
export function replacedFuse(parameters: Parameters | undefined): Parameters {
  return { ...parameters, state: { value: 'intact' } }
}

/** Is a relay's coil energized? Absent coil_state defaults to de-energized (at rest). */
export function relayEnergized(parameters: Parameters | undefined): boolean {
  return stringOf(parameters, 'coil_state') === 'energized'
}

/** Set a relay's resolved coil state — the canvas syncs this from the solve. */
export function relayWithCoilState(
  parameters: Parameters | undefined,
  state: 'energized' | 'de_energized',
): Parameters {
  return { ...parameters, coil_state: { value: state } }
}

/** Set a Shockley 4-layer diode's resolved latch state — the canvas syncs this from the solve. */
export function shockleyDiodeWithState(
  parameters: Parameters | undefined,
  state: 'blocking' | 'conducting',
): Parameters {
  return { ...parameters, device_state: { value: state } }
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
  if (definition === 'diode_zener_silicon') {
    const vz = amountOf(parameters, 'zener_voltage')
    return vz === undefined ? null : `${vz} V Z`
  }
  if (definition === 'switch_spst_toggle' || definition === 'switch_spst_momentary') {
    return switchClosed(parameters) ? 'closed' : 'open'
  }
  if (definition === 'switch_spdt') {
    return spdtOnA(parameters) ? '→ A' : '→ B'
  }
  if (definition === 'potentiometer') {
    const r = amountOf(parameters, 'resistance')
    if (r === undefined) return null
    return `${formatEng(r, 'Ω')} ${Math.round(wiperFraction(parameters) * 100)}%`
  }
  if (definition === 'fuse') {
    const rated = amountOf(parameters, 'rated_current')
    const label = rated === undefined ? 'fuse' : formatEng(rated, 'A')
    return fuseIntact(parameters) ? label : `${label} blown`
  }
  if (definition === 'thermistor') {
    const r = amountOf(parameters, 'resistance')
    return r === undefined ? 'NTC' : `${formatEng(r, 'Ω')} NTC`
  }
  if (definition === 'incandescent_bulb') {
    // The nameplate (wattage · voltage) is what's printed on a bulb.
    const w = amountOf(parameters, 'rated_power')
    const v = amountOf(parameters, 'rated_voltage')
    if (w !== undefined && v !== undefined) return `${formatEng(w, 'W')} · ${formatEng(v, 'V')}`
    if (w !== undefined) return formatEng(w, 'W')
    const r = amountOf(parameters, 'resistance')
    return r === undefined ? null : formatEng(r, 'Ω')
  }
  if (definition === 'vacuum_diode') {
    // Headline the conduction point: plate current at the rated plate voltage.
    const refV = amountOf(parameters, 'reference_plate_voltage')
    const refI = amountOf(parameters, 'plate_current_at_reference')
    if (refI !== undefined && refV !== undefined)
      return `${formatEng(refI, 'A')} @ ${formatEng(refV, 'V')}`
    return 'tube'
  }
  if (definition === 'triode') {
    // Headline the amplification factor μ — the triode's defining spec.
    const mu = amountOf(parameters, 'amplification_factor')
    return mu === undefined ? 'triode' : `μ=${mu}`
  }
  if (definition === 'tetrode') {
    // Headline the (high) control-grid-to-plate μ — the flat-characteristic / high-gain spec.
    const mu = amountOf(parameters, 'plate_amplification_factor')
    return mu === undefined ? 'tetrode' : `μ=${mu}`
  }
  if (definition === 'pentode') {
    const mu = amountOf(parameters, 'plate_amplification_factor')
    return mu === undefined ? 'pentode' : `μ=${mu}`
  }
  if (definition === 'photoresistor') {
    // Headline the LIVE resistance (computed from the light on it) plus the lux —
    // an LDR's resistance is the whole point and swings 100× with the light. The
    // lux shown is the incident (ambient + cast) once a lamp has been folded in,
    // else the ambient the user set.
    const r = ldrResistance({ parameters } as unknown as Instance)
    if (r === undefined) return 'LDR'
    const lux =
      amountOf(parameters, 'incident_illuminance') ??
      amountOf(parameters, 'ambient_illuminance') ??
      0
    return `${formatEng(r, 'Ω')} @ ${formatEng(lux, 'lx')}`
  }
  if (definition === 'light_source') {
    const i = amountOf(parameters, 'luminous_intensity')
    return i === undefined ? 'lamp' : `${formatEng(i, 'cd')}`
  }
  if (definition === 'photodiode' || definition === 'phototransistor') {
    // Headline the live photocurrent it sources from the light on it. The
    // definition MUST be passed — lightSensorCurrent reads it to apply β for a
    // phototransistor (without it, the headline shows the un-amplified base).
    return formatEng(lightSensorCurrent({ definition, parameters } as unknown as Instance), 'A')
  }
  if (definition === 'relay') {
    const v = amountOf(parameters, 'nominal_coil_voltage')
    const label = v === undefined ? 'relay' : `${formatEng(v, 'V')} relay`
    return relayEnergized(parameters) ? `${label} ⚡` : label
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
  if (definition === 'electromagnet') {
    // Headline the turns — the magnetic identity (N·I sets the field), not the inductance.
    const n = amountOf(parameters, 'turns')
    return n === undefined ? null : `${n} turns`
  }
  if (definition === 'dc_motor') {
    // Headline the motor constant k — speed-per-volt and torque-per-amp in one number.
    const k = amountOf(parameters, 'motor_constant')
    return k === undefined ? null : `k=${formatEng(k, 'V·s/rad')}`
  }
  if (definition === 'generator') {
    // Headline the open-circuit EMF E = k·ω it makes at its drive speed.
    const k = amountOf(parameters, 'machine_constant')
    const rpm = amountOf(parameters, 'drive_speed')
    if (k === undefined || rpm === undefined) return null
    return formatEng((k * rpm * 2 * Math.PI) / 60, 'V')
  }
  if (definition === 'arc_lamp') {
    // Headline the burning arc voltage — what it holds once struck.
    const v = amountOf(parameters, 'arc_voltage')
    return v === undefined ? null : `${formatEng(v, 'V')} arc`
  }
  if (definition === 'neon_lamp') {
    // Headline the striking voltage — what it takes to light the discharge.
    const v = amountOf(parameters, 'breakover_voltage')
    return v === undefined ? null : `${formatEng(v, 'V')} strike`
  }
  if (definition === 'crt') {
    // Headline the anode (EHT) accelerating voltage.
    const v = amountOf(parameters, 'rated_anode_voltage')
    return v === undefined ? null : `${formatEng(v, 'V')} EHT`
  }
  if (definition === 'induction_motor') {
    // Headline the synchronous speed (120·f/poles) — the field's rotation the rotor chases.
    const f = amountOf(parameters, 'line_frequency')
    const poles = amountOf(parameters, 'pole_count')
    if (f === undefined || poles === undefined || poles <= 0) return null
    return `${Math.round((120 * f) / poles)} RPM`
  }
  if (definition === 'transmission_line') {
    // Headline Z₀ and the end-to-end wave delay — the two numbers that define the line.
    const z0 = amountOf(parameters, 'characteristic_impedance')
    const length = amountOf(parameters, 'length')
    const vf = amountOf(parameters, 'velocity_factor')
    if (z0 === undefined) return null
    const tau = length !== undefined && vf !== undefined ? propagationDelayS(length, vf) : undefined
    return tau !== undefined ? `${formatEng(z0, 'Ω')} · ${formatEng(tau, 's')}` : formatEng(z0, 'Ω')
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
