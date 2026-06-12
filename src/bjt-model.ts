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
 * plain transport model. Still unmodeled from full Gummel-Poon: reverse Early
 * (VAR), high-level injection (IKF/IKR), leakage diodes (ISE/ISC). Numerical
 * note: the factor needs no clamping — pnjlim keeps junction voltages ~1 V,
 * far from the V_BC = V_AF ≥ ~19 V pole.
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
}

/** Terminal currents (into collector / base / emitter) — Ebers-Moll transport. */
export function bjtCurrents(
  vBE: number,
  vBC: number,
  params: BjtParams,
  thermalV: number,
): { iC: number; iB: number; iE: number } {
  const {
    saturationCurrent: is,
    betaForward: bf,
    betaReverse: br,
    earlyVoltageForward: va,
  } = params
  const expBE = Math.exp(vBE / thermalV) - 1
  const expBC = Math.exp(vBC / thermalV) - 1

  // Transport: I_C = (I_CC − I_EC)·(1 − V_BC/V_AF) − I_EC/β_R — only the
  // collector-emitter TRANSPORT current carries the Early factor; the base
  // current does not (see the header note). V_AF omitted → factor 1.
  const earlyFactor = va === undefined ? 1 : 1 - vBC / va
  const iC = is * (expBE - expBC) * earlyFactor - (is / br) * expBC
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
  const {
    saturationCurrent: is,
    betaForward: bf,
    betaReverse: br,
    earlyVoltageForward: va,
  } = params
  const { iC, iB } = bjtCurrents(vBE, vBC, params, thermalV)
  const gF = (is / thermalV) * Math.exp(vBE / thermalV)
  const gR = (is / thermalV) * Math.exp(vBC / thermalV)
  // d(transport·f)/dV_BC has TWO terms: the junction conductance scaled by f,
  // plus transport·df/dV_BC = −(I_CC − I_EC)/V_AF — the output conductance
  // g_o ≈ I_C/V_A that makes real plateaus tilt. (exp − 1) terms cancel in
  // the transport difference, so it is the bare exponential difference.
  const earlyFactor = va === undefined ? 1 : 1 - vBC / va
  const transport = is * (Math.exp(vBE / thermalV) - Math.exp(vBC / thermalV))
  return {
    iC,
    iB,
    dIC_dVBE: gF * earlyFactor,
    dIC_dVBC: -gR * earlyFactor - (va === undefined ? 0 : transport / va) - gR / br,
    dIB_dVBE: gF / bf,
    dIB_dVBC: gR / br,
  }
}
