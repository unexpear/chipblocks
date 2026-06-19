/**
 * Field / energy-transfer physics — the "energy is carried by the FIELDS, not the
 * electrons" picture (Poynting; Feynman Vol II Ch 27; popularised by Veritasium). The
 * lumped solver computes the steady-state circuit numbers (V, I, power); this module
 * recasts them in the field picture: how slowly the charge carriers actually drift, and
 * how fast the energy front (the fields) travels — so the Math panel can show that the
 * power it reports is energy flowing through the surrounding fields, ∮ S·dA = V·I, the
 * SAME number the circuit gives.
 */

/** Speed of light in vacuum (m/s) — exact since the 2019 SI redefinition. */
export const SPEED_OF_LIGHT_M_S = 299792458

/** Elementary charge (coulombs) — CODATA exact since the 2019 SI redefinition. */
export const ELEMENTARY_CHARGE_C = 1.602176634e-19

/**
 * Free-electron (carrier) density of copper, ≈8.5×10²⁸ per m³ — one conduction electron
 * per atom: n = density·N_A/M = 8960·6.022e23/0.06355 (CRC density + NIST atomic mass).
 * The standard value behind the famously slow drift speed.
 */
export const COPPER_CARRIER_DENSITY_PER_M3 = 8.49e28

/**
 * Electron drift velocity v_d = I / (n·q·A) — how fast the charge carriers themselves
 * actually move along the wire. For a normal bench current in a normal wire this is a
 * fraction of a millimetre per second: the electrons barely crawl, while the ENERGY
 * arrives at nearly the speed of light through the fields. Returns 0 for a degenerate
 * (zero-area / zero-density) conductor.
 */
export function electronDriftVelocityMS(
  amps: number,
  areaM2: number,
  carrierDensityPerM3 = COPPER_CARRIER_DENSITY_PER_M3,
): number {
  if (!(areaM2 > 0) || !(carrierDensityPerM3 > 0)) return 0
  return Math.abs(amps) / (carrierDensityPerM3 * ELEMENTARY_CHARGE_C * areaM2)
}

/**
 * How long light — and so the field / energy front — takes to cross a distance (d/c).
 * The point of the "long wires to the Moon" thought experiment: the field jumps the
 * short gap between the wires in this time, not the time to run their full length.
 */
export function lightTravelTimeS(distanceM: number): number {
  return Math.max(0, distanceM) / SPEED_OF_LIGHT_M_S
}
