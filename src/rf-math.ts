/**
 * RF MATH / UNITS (analog-RF chapter, increment 2) — the small, exact conversion library the RF tools share:
 * decibels (power vs amplitude), absolute power in dBm, and the reflection triangle |Γ| ↔ return loss ↔ VSWR.
 * These are the everyday RF unit conversions; every later increment (S-parameters in dB, a Smith chart from
 * Γ, matching from VSWR, noise figure in dB) reads off them, so they live in one tested place. Pure
 * functions, no state, defined for their physical domains (a matched port's infinite return loss and a
 * total-reflection infinite VSWR are returned as +∞, not a silent NaN).
 *
 * DECIBEL CONVENTION: a POWER ratio is 10·log10 (an S-parameter's power gain, a noise figure); an AMPLITUDE
 * ratio (voltage / current, |S21|) is 20·log10. Both are provided explicitly so a caller never has to
 * remember which factor a given quantity takes. dBm is absolute power referenced to 1 mW.
 */

/** dB of a POWER ratio: 10·log10(P/P₀). */
export const dbFromPowerRatio = (ratio: number): number =>
  ratio > 0 ? 10 * Math.log10(ratio) : Number.NEGATIVE_INFINITY
/** Inverse of dbFromPowerRatio: the power ratio a dB figure represents. */
export const powerRatioFromDb = (db: number): number => 10 ** (db / 10)

/** dB of an AMPLITUDE ratio (voltage / current / |S|): 20·log10(A/A₀). */
export const dbFromAmplitudeRatio = (ratio: number): number =>
  ratio > 0 ? 20 * Math.log10(ratio) : Number.NEGATIVE_INFINITY
/** Inverse of dbFromAmplitudeRatio. */
export const amplitudeRatioFromDb = (db: number): number => 10 ** (db / 20)

/** Absolute power in dBm (dB relative to 1 mW): 10·log10(P_watts / 1 mW). */
export const dbmFromWatts = (watts: number): number =>
  watts > 0 ? 10 * Math.log10(watts / 1e-3) : Number.NEGATIVE_INFINITY
/** Inverse of dbmFromWatts: the power in watts a dBm figure represents. */
export const wattsFromDbm = (dbm: number): number => 1e-3 * 10 ** (dbm / 10)

/**
 * Return loss (dB) from the reflection-coefficient magnitude |Γ|: RL = −20·log10|Γ|. A perfect match
 * (|Γ| = 0) has infinite return loss; a total reflection (|Γ| = 1) is 0 dB; an active (|Γ| > 1) port gives a
 * NEGATIVE return loss (it returns more than was incident). |Γ| is clamped non-negative.
 */
export const returnLossDbFromGamma = (gammaMag: number): number =>
  gammaMag > 0 ? -20 * Math.log10(gammaMag) : Number.POSITIVE_INFINITY
/** Inverse of returnLossDbFromGamma: |Γ| = 10^(−RL/20). */
export const gammaFromReturnLossDb = (returnLossDb: number): number => 10 ** (-returnLossDb / 20)

/**
 * VSWR from |Γ|: (1 + |Γ|)/(1 − |Γ|). A match (|Γ| = 0) is 1; at or beyond total reflection (|Γ| ≥ 1) VSWR is
 * infinite (a standing wave with a true null), returned as +∞.
 */
export const vswrFromGamma = (gammaMag: number): number =>
  gammaMag >= 0 && gammaMag < 1 ? (1 + gammaMag) / (1 - gammaMag) : Number.POSITIVE_INFINITY
/**
 * |Γ| from VSWR: (VSWR − 1)/(VSWR + 1). VSWR is ≥ 1 by definition; a value below 1 is unphysical and clamps
 * to |Γ| = 0 (a match). VSWR = +∞ gives |Γ| = 1.
 */
export const gammaFromVswr = (vswr: number): number => {
  if (!Number.isFinite(vswr)) return 1
  return vswr > 1 ? (vswr - 1) / (vswr + 1) : 0
}
