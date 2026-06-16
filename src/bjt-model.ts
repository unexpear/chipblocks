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
 * EARLY EFFECT (S20-v3-7): with `earlyVoltageForward` (V_AF) set, the transport
 * current is divided by the first-order Gummel-Poon base-charge factor
 * q_b = 1/(1 − V_BC/V_AF) — i.e. multiplied by (1 − V_BC/V_AF). Physically:
 * a wider collector-base depletion region thins the base (base-width
 * modulation, Early 1952), so the same V_BE collects MORE current as V_CE
 * rises — the family plateaus tilt, extrapolating back to −V_A like every
 * datasheet. The BASE current is NOT scaled (a thinner base collects more,
 * it doesn't recombine more) — so β effectively grows with V_CE, exactly as
 * SPICE's Gummel-Poon does with only VAF set. Omitted V_AF = infinite = the
 * plain transport model.
 *
 * HIGH-LEVEL INJECTION + REVERSE EARLY (the rest of the Gummel-Poon base charge):
 * the transport current is divided by the normalized base charge
 *   q_b   = (q_b1 / 2)·(1 + √(1 + 4·q_b2))
 *   q_b1  = 1/(1 − V_BC/V_AF − V_BE/V_AR)                      (Early, both junctions)
 *   q_b2  = (I_S/I_KF)·(e^{V_BE/V_T}−1) + (I_S/I_KR)·(e^{V_BC/V_T}−1)  (high injection)
 * Above the forward knee current I_KF the q_b2 term grows, so I_C rises slower
 * than I_S·e^{V_BE/V_T} and β rolls off — the high-current β droop on every
 * datasheet's hFE-vs-I_C curve. Each term is OPT-IN: with V_AR, I_KF, I_KR all
 * omitted, q_b2 = 0 and q_b = 1/(1 − V_BC/V_AF) — bit-identical to the forward-
 * Early-only model above. Still unmodeled: leakage diodes (ISE/ISC) and charge
 * storage (junction/diffusion capacitance). Numerical note: the factor needs no
 * clamping — pnjlim keeps junction voltages ~1 V, far from the poles.
 */

export type BjtParams = {
  /** Transport saturation current I_S (A). ~1e-14 for a small-signal NPN. */
  saturationCurrent: number
  /** Forward current gain β_F (= I_C/I_B in the active region). */
  betaForward: number
  /** Reverse current gain β_R (small, ~1–5). */
  betaReverse: number
  /** Forward Early voltage V_AF (V). Omitted → no Early effect (infinite V_A). */
  earlyVoltageForward?: number
  /** Reverse Early voltage V_AR (V) — B-E-junction base-width modulation (matters in saturation/inverse). Omitted → infinite. */
  earlyVoltageReverse?: number
  /** Forward knee current I_KF (A) — onset of high-level injection; above it β rolls off. Omitted → no rolloff (infinite). */
  kneeCurrentForward?: number
  /** Reverse knee current I_KR (A) — high-injection knee for the reverse transport term. Omitted → infinite. */
  kneeCurrentReverse?: number
}

/**
 * Cap on the exponential argument V/V_T — mirrors the diode model's EXP_ARG_CAP. pnjlim keeps a
 * junction near its operating point in normal solves, but a stale .nodeset seed or a future
 * curve-trace sweep could hand bjtCurrents / bjtCompanion an absurd V_BE / V_BC; capping keeps the
 * transport currents and conductances large-but-FINITE so the MNA matrix never overflows to Inf/NaN.
 * A real operating point sits far below the cap (V_BE / V_T ≈ 27 at 0.7 V).
 */
const EXP_ARG_CAP = 80
const safeExp = (x: number): number => Math.exp(Math.min(x, EXP_ARG_CAP))

/**
 * The normalized base-charge factor F = 1/q_b that the transport current carries
 * (I_C_transport = I_S·(e^{V_BE/V_T} − e^{V_BC/V_T})·F), plus its two partials.
 * Folds forward + reverse Early (q_b1) and high-level injection (q_b2):
 *   q1inv = 1 − V_BC/V_AF − V_BE/V_AR              (each term 0 when its V_A is omitted)
 *   q2    = (I_S/I_KF)·expBE + (I_S/I_KR)·expBC    (each term 0 when its I_K is omitted)
 *   F     = q1inv · 2/(1 + √(1 + 4·q2))
 * All terms omitted → F = 1; only V_AF set → F = 1 − V_BC/V_AF (the prior model),
 * including its partials, so the forward-Early path is bit-identical.
 */
function baseChargeFactor(
  vBE: number,
  vBC: number,
  params: BjtParams,
  thermalV: number,
): { factor: number; dFdVBE: number; dFdVBC: number } {
  const {
    saturationCurrent: is,
    earlyVoltageForward: vaf,
    earlyVoltageReverse: varv,
    kneeCurrentForward: ikf,
    kneeCurrentReverse: ikr,
  } = params
  const q1inv = 1 - (vaf === undefined ? 0 : vBC / vaf) - (varv === undefined ? 0 : vBE / varv)
  const expBE = safeExp(vBE / thermalV) - 1
  const expBC = safeExp(vBC / thermalV) - 1
  const q2 =
    (ikf === undefined ? 0 : (is / ikf) * expBE) + (ikr === undefined ? 0 : (is / ikr) * expBC)
  const root = Math.sqrt(1 + 4 * q2)
  const h = 2 / (1 + root)
  // ∂q1inv: −1/V_AR w.r.t. V_BE, −1/V_AF w.r.t. V_BC. ∂q2: (I_S/I_K)·e^{V/V_T}/V_T.
  const dq1dVBE = varv === undefined ? 0 : -1 / varv
  const dq1dVBC = vaf === undefined ? 0 : -1 / vaf
  const dq2dVBE = ikf === undefined ? 0 : ((is / ikf) * safeExp(vBE / thermalV)) / thermalV
  const dq2dVBC = ikr === undefined ? 0 : ((is / ikr) * safeExp(vBC / thermalV)) / thermalV
  // ∂h/∂q2 = −4 / (root·(1 + root)²); chain through q2 for the V partials.
  const dhdq2 = -4 / (root * (1 + root) * (1 + root))
  return {
    factor: q1inv * h,
    dFdVBE: dq1dVBE * h + q1inv * dhdq2 * dq2dVBE,
    dFdVBC: dq1dVBC * h + q1inv * dhdq2 * dq2dVBC,
  }
}

/** Terminal currents (into collector / base / emitter) — Ebers-Moll transport. */
export function bjtCurrents(
  vBE: number,
  vBC: number,
  params: BjtParams,
  thermalV: number,
): { iC: number; iB: number; iE: number } {
  const { saturationCurrent: is, betaForward: bf, betaReverse: br } = params
  const expBE = safeExp(vBE / thermalV) - 1
  const expBC = safeExp(vBC / thermalV) - 1

  // Transport: I_C = (I_CC − I_EC)·F − I_EC/β_R, where F = 1/q_b folds in the
  // Early effect(s) and high-level injection (see baseChargeFactor). Only the
  // collector-emitter transport current carries F; the base current does NOT —
  // so high injection drops I_C while I_B holds and β rolls off, and Early thins
  // the base (raising I_C) so β grows with V_CE. All extra params omitted → F = 1.
  const { factor } = baseChargeFactor(vBE, vBC, params, thermalV)
  const iC = is * (expBE - expBC) * factor - (is / br) * expBC
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
  const gF = (is / thermalV) * safeExp(vBE / thermalV)
  const gR = (is / thermalV) * safeExp(vBC / thermalV)
  // I_C = transport·F − I_EC/β_R. Product rule on transport·F: the junction
  // conductance scaled by F, PLUS transport·∂F/∂V — the output-conductance tilt
  // from Early and the high-injection slope. F and its partials come from
  // baseChargeFactor; (exp − 1) terms cancel in the transport difference, so it
  // is the bare exponential difference.
  const { factor, dFdVBE, dFdVBC } = baseChargeFactor(vBE, vBC, params, thermalV)
  const transport = is * (safeExp(vBE / thermalV) - safeExp(vBC / thermalV))
  return {
    iC,
    iB,
    dIC_dVBE: gF * factor + transport * dFdVBE,
    dIC_dVBC: -gR * factor + transport * dFdVBC - gR / br,
    dIB_dVBE: gF / bf,
    dIB_dVBC: gR / br,
  }
}
