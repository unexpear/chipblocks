/**
 * LED optics derived from the semiconductor's real bandgap (Sprint 19 S19-v3-33).
 *
 * The LED device declares its emission wavelength as a derived equation —
 * peak_wavelength = h·c / E_g (device-led.yaml, properties.peak_wavelength),
 * sourcing E_g from the n_side material's bandgap_energy. So an LED's semiconductor
 * is not a cosmetic label: it physically sets the color (and, to first order, the
 * forward voltage). Changing the n_side material in the Properties panel re-derives
 * both from that material's real, cited bandgap — making the material edit real.
 *
 *  - λ = h·c / E_g   (Planck–Einstein relation; exact)
 *  - V_F ≈ E_g / q   (the bandgap voltage — the device's documented first-order
 *                     model "V_F ~ E_g/e"; real LEDs sit a little higher from
 *                     series resistance + ideality, so this is an honest floor the
 *                     user can fine-tune by editing forward_voltage)
 *
 * Pure + unit-tested; the App wires it to the n_side dropdown.
 */

import { representativeAmount } from './material-properties.ts'

/** h·c in eV·nm (NIST CODATA 2022: h = 4.135667696e-15 eV·s, c = 2.99792458e8 m/s). */
const HC_EV_NM = 1239.841984

/**
 * A representative bandgap in eV from a material's `bandgap_energy` property value.
 * Returns null when it isn't a usable eV quantity (wrong unit, or a metal/insulator
 * with no bandgap at all).
 */
export function bandgapEv(value: unknown): number | null {
  return representativeAmount(value, 'electronvolt')
}

export type LedOptics = { peakWavelengthNm: number; forwardVoltageV: number }

/**
 * Emission wavelength (nm) + first-order forward voltage (V) from a bandgap in eV.
 * Rounds to display-sensible precision (0.1 nm, 0.001 V). Null for a non-positive
 * bandgap (e.g. a metal mistakenly chosen as the semiconductor).
 */
export function deriveLedOptics(bandgapElectronvolts: number): LedOptics | null {
  if (!(bandgapElectronvolts > 0)) return null
  return {
    peakWavelengthNm: Math.round((HC_EV_NM / bandgapElectronvolts) * 10) / 10,
    forwardVoltageV: Math.round(bandgapElectronvolts * 1000) / 1000,
  }
}
