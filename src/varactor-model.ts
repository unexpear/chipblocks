/**
 * Varactor (varicap) diode physics — voltage-controlled junction capacitance C(V).
 *
 * A diode operated in REVERSE bias is a capacitor: the depletion region is the dielectric, and its
 * width — hence the capacitance — varies with the reverse voltage. The standard junction-capacitance
 * law:
 *
 *   C(V) = C_j0 / (1 − V/V_j)^m
 *
 * where V is the junction voltage (anode − cathode; NEGATIVE in reverse bias), C_j0 the zero-bias
 * capacitance, V_j the built-in (junction) potential (~0.7 V for silicon), and m the grading
 * coefficient: ~0.5 for an abrupt junction, ~0.33 for a graded one, and 1–2 (up to ~4) for a
 * HYPERABRUPT varactor engineered for a wide tuning range. More reverse bias → wider depletion →
 * SMALLER capacitance, which is how a varactor tunes an LC oscillator or filter.
 *
 * The forward region (V → V_j) is clamped — the depletion-cap formula diverges there and a real
 * varactor is never run forward. This is the depletion (junction) capacitance only; the forward
 * diffusion capacitance is the documented successor.
 *
 * Sources: Sze & Ng, Physics of Semiconductor Devices, 3rd ed., §2 (junction capacitance and the
 * grading coefficient); the SPICE diode model parameters CJO, VJ, M — the same three numbers.
 */

const FORWARD_CLAMP = 0.1

/**
 * Junction capacitance (F) at junction voltage vJunction (anode − cathode; negative = reverse). The
 * denominator base (1 − V/V_j) is floored at FORWARD_CLAMP so the formula stays bounded if the
 * device is pushed toward or past the built-in potential (a varactor is operated in reverse).
 */
export function junctionCapacitance(
  vJunction: number,
  zeroBiasCapacitance: number,
  junctionPotential: number,
  gradingCoefficient: number,
): number {
  const base = Math.max(1 - vJunction / junctionPotential, FORWARD_CLAMP)
  return zeroBiasCapacitance / base ** gradingCoefficient
}
