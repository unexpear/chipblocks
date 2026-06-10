/**
 * Thermal model — stage 7's first rung (S19-v3-48): the lumped
 * thermal-resistance network, per SIMULATION-AND-VISUALIZATION-ARC.md ("from-
 * scratch … lumped thermal-resistance networks for PCB-scale modeling").
 *
 * The datasheet-grade steady-state model every manufacturer specifies:
 *   T_junction = T_ambient + P · θ_JA
 * where θ_JA (kelvin per watt) is the package's junction-to-ambient thermal
 * resistance — a real, cited datasheet number (TO-92 ≈ 200 K/W, 5 mm epoxy LED
 * ≈ 300 K/W). P is the part's REAL dissipated power from the solved circuit.
 *
 * Honest scope: steady-state and per-part (each part to ambient independently).
 * Part-to-part conduction across a shared board (the 2-D finite-difference
 * spatial solver over FR4, ~0.3 W/m·K) needs board geometry, which doesn't
 * exist yet — that lands with the PCB layer, not before.
 */

/** Standard datasheet ambient, °C (the 25 °C every θ_JA rating assumes). */
export const STANDARD_AMBIENT_C = 25

/**
 * Steady-state junction/part temperature (°C): ambient plus the real dissipated
 * power times the package's junction-to-ambient thermal resistance.
 */
export function junctionTemperature(
  watts: number,
  thetaJaKelvinPerWatt: number,
  ambientC: number = STANDARD_AMBIENT_C,
): number {
  return ambientC + watts * thetaJaKelvinPerWatt
}
