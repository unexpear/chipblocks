/**
 * Varactor (varicap) diode physics — voltage-controlled capacitance C(V) and its stored charge Q(V).
 *
 * A diode operated in REVERSE bias is a capacitor: the depletion region is the dielectric, and its
 * width — hence the junction capacitance — shrinks as the reverse voltage rises:
 *
 *   C_j(V) = C_j0 / (1 − V/V_j)^m          (V = anode − cathode; negative in reverse)
 *
 * with C_j0 the zero-bias capacitance, V_j the built-in potential (~0.7 V for silicon), and m the
 * grading coefficient (~0.5 abrupt, ~0.33 graded, 1–2 hyperabrupt). More reverse bias → smaller C
 * → how a varactor tunes an LC resonator. Under forward bias a diode ALSO has a diffusion
 * capacitance from stored minority charge, C_d(V) = τ_T · dI/dV (τ_T = transit time); it is
 * negligible in reverse (the varactor's regime) but dominates in forward, so the honest total is
 *
 *   C(V) = C_j(V) + C_d(V),   with stored charge   Q(V) = ∫₀^V C dV' = Q_j(V) + τ_T · I_diode(V).
 *
 * The transient engine integrates the CHARGE (i = dQ/dt, backward-Euler, Newton-linearized at the
 * converged step voltage) rather than freezing C at the step-start voltage — charge-conserving and
 * correct for large swings. The forward region of C_j is clamped (the depletion formula diverges as
 * V → V_j); Q_j continues linearly above the clamp so Q stays C¹.
 *
 * Sources: Sze & Ng, Physics of Semiconductor Devices, 3rd ed., §2 (junction capacitance, grading
 * coefficient) and §2 on diffusion capacitance / charge storage; the SPICE diode model (CJO, VJ, M,
 * TT) — the same parameters.
 */

const FORWARD_CLAMP = 0.1
const EXP_CLAMP = 40

function safeExp(x: number): number {
  return Math.exp(x > EXP_CLAMP ? EXP_CLAMP : x < -EXP_CLAMP ? -EXP_CLAMP : x)
}

export type VaractorParams = {
  /** Zero-bias junction capacitance C_j0 (F). */
  zeroBiasCapacitance: number
  /** Built-in junction potential V_j (V). */
  junctionPotential: number
  /** Grading coefficient m. */
  gradingCoefficient: number
  /** Transit time τ_T (s) for the forward diffusion charge; 0 ⇒ no diffusion term. */
  transitTime: number
  /** Diode saturation current I_S (A), for the forward diffusion charge. */
  saturationCurrent: number
  /** Diode ideality factor n. */
  ideality: number
  /** Thermal voltage kT/q (V). */
  thermalV: number
}

/**
 * Junction capacitance (F) at junction voltage vJunction (anode − cathode; negative = reverse). The
 * denominator base (1 − V/V_j) is floored at FORWARD_CLAMP so the formula stays bounded near / past
 * the built-in potential (a varactor is operated in reverse).
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

/** Stored junction charge Q_j(V) = ∫₀^V C_j dV', with the same forward clamp (constant C above it). */
export function junctionCharge(
  vJunction: number,
  zeroBiasCapacitance: number,
  junctionPotential: number,
  gradingCoefficient: number,
): number {
  const m = gradingCoefficient
  const vClamp = junctionPotential * (1 - FORWARD_CLAMP)
  const v = Math.min(vJunction, vClamp)
  const u = 1 - v / junctionPotential
  const qUnclamped =
    Math.abs(1 - m) < 1e-9
      ? -zeroBiasCapacitance * junctionPotential * Math.log(u)
      : ((zeroBiasCapacitance * junctionPotential) / (1 - m)) * (1 - u ** (1 - m))
  if (vJunction <= vClamp) return qUnclamped
  const cClamp = zeroBiasCapacitance / FORWARD_CLAMP ** m
  return qUnclamped + cClamp * (vJunction - vClamp)
}

/** Forward diffusion capacitance C_d = τ_T · dI/dV (zero when no transit time is given). */
export function diffusionCapacitance(
  vJunction: number,
  transitTime: number,
  saturationCurrent: number,
  ideality: number,
  thermalV: number,
): number {
  if (transitTime <= 0) return 0
  const nVt = ideality * thermalV
  return ((transitTime * saturationCurrent) / nVt) * safeExp(vJunction / nVt)
}

/** Stored diffusion charge Q_d = τ_T · I_diode(V). */
export function diffusionCharge(
  vJunction: number,
  transitTime: number,
  saturationCurrent: number,
  ideality: number,
  thermalV: number,
): number {
  if (transitTime <= 0) return 0
  const nVt = ideality * thermalV
  return transitTime * saturationCurrent * (safeExp(vJunction / nVt) - 1)
}

/** Total small-signal capacitance C(V) = C_junction + C_diffusion. */
export function varactorCapacitance(vJunction: number, p: VaractorParams): number {
  return (
    junctionCapacitance(
      vJunction,
      p.zeroBiasCapacitance,
      p.junctionPotential,
      p.gradingCoefficient,
    ) + diffusionCapacitance(vJunction, p.transitTime, p.saturationCurrent, p.ideality, p.thermalV)
  )
}

/** Total stored charge Q(V) = Q_junction + Q_diffusion — the large-signal state the engine marches. */
export function varactorCharge(vJunction: number, p: VaractorParams): number {
  return (
    junctionCharge(vJunction, p.zeroBiasCapacitance, p.junctionPotential, p.gradingCoefficient) +
    diffusionCharge(vJunction, p.transitTime, p.saturationCurrent, p.ideality, p.thermalV)
  )
}
