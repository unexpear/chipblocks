/**
 * Bipolar junction transistor (BJT) physics — the Ebers-Moll TRANSPORT model +
 * its Newton-Raphson companion (Jacobian + operating-point currents).
 *
 * Pure functions, no circuit/solver coupling — the Newton-Raphson loop in
 * dc-solver.ts will compose these the same way it composes diode-model.ts. The
 * transport form (not the injection form) is what SPICE uses because one set of
 * equations covers every region (active / saturation / cutoff) — no per-region
 * branching.
 *
 * FORMULAS VERIFIED against the SPICE Ebers-Moll transport model (2026-06):
 *   - I_CC = I_S(exp(V_BE/V_T) − 1), I_EC = I_S(exp(V_BC/V_T) − 1)
 *   - β = α/(1 − α); β_F forward, β_R reverse
 *   Sources: Ebers & Moll (1954); home.uncg.edu/~ehhellen/ebers-moll.html;
 *   Circuit Cellar "The Ebers-Moll BJT Model"; Sedra & Smith, Microelectronic
 *   Circuits. (Same first-principles standard as the diode model; both get the
 *   ngspice-grade limiting/convergence treatment in the solver-integration step.)
 *
 * NPN convention: V_BE = V_base − V_emitter, V_BC = V_base − V_collector. The
 * returned terminal currents flow INTO each terminal and sum to zero (KCL).
 *
 * Honest model note (made visible by the curve tracer, 2026-06-12): the
 * transport model has NO Early effect — a real BJT's I_C–V_CE family tilts
 * gently upward in forward-active (I_C grows with V_CE, slope set by the
 * Early voltage V_A); ours draws perfectly flat plateaus. Adding the
 * (1 + V_CE/V_A) factor with a cited V_A is a future increment.
 */

export type BjtParams = {
  /** Transport saturation current I_S (A). ~1e-14 for a small-signal NPN. */
  saturationCurrent: number
  /** Forward current gain β_F (= I_C/I_B in the active region). */
  betaForward: number
  /** Reverse current gain β_R (small, ~1–5). */
  betaReverse: number
}

/** Terminal currents (into collector / base / emitter) — Ebers-Moll transport. */
export function bjtCurrents(
  vBE: number,
  vBC: number,
  params: BjtParams,
  thermalV: number,
): { iC: number; iB: number; iE: number } {
  const { saturationCurrent: is, betaForward: bf, betaReverse: br } = params
  const expBE = Math.exp(vBE / thermalV) - 1
  const expBC = Math.exp(vBC / thermalV) - 1

  // Transport: I_C = I_CC − I_EC(1 + 1/β_R); I_B = I_CC/β_F + I_EC/β_R.
  const iC = is * expBE - is * expBC * (1 + 1 / br)
  const iB = (is / bf) * expBE + (is / br) * expBC
  const iE = -(iC + iB)
  return { iC, iB, iE }
}

/**
 * Newton-Raphson companion model: the operating-point currents plus the 2×2
 * Jacobian ∂(I_C, I_B)/∂(V_BE, V_BC). g_F / g_R are the two junction transport
 * conductances; the gain shows up as ∂I_B/∂V_BE = (∂I_C/∂V_BE) / β_F. The solver
 * stamps these across the collector / base / emitter nodes.
 */
export function bjtCompanion(
  vBE: number,
  vBC: number,
  params: BjtParams,
  thermalV: number,
): {
  iC: number
  iB: number
  dIC_dVBE: number
  dIC_dVBC: number
  dIB_dVBE: number
  dIB_dVBC: number
} {
  const { saturationCurrent: is, betaForward: bf, betaReverse: br } = params
  const { iC, iB } = bjtCurrents(vBE, vBC, params, thermalV)
  const gF = (is / thermalV) * Math.exp(vBE / thermalV)
  const gR = (is / thermalV) * Math.exp(vBC / thermalV)
  return {
    iC,
    iB,
    dIC_dVBE: gF,
    dIC_dVBC: -gR * (1 + 1 / br),
    dIB_dVBE: gF / bf,
    dIB_dVBC: gR / br,
  }
}
