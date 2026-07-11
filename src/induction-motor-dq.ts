/**
 * Induction motor DYNAMIC model — the dq (stationary-reference-frame / αβ0) model of the
 * three-phase squirrel-cage machine, marched in the time domain. This is the real spin-up
 * physics the quasi-static Steinmetz ladder could not do: switch the supply on and the rotor
 * genuinely accelerates from rest — the several-times locked-rotor inrush current at standstill
 * (5–7× running on typical industrial machines), the torque climbing the torque–slip curve as
 * it comes up to speed, and the current tapering to the running value as the slip settles where
 * developed torque meets the load.
 *
 * The machine states are the stator and rotor flux linkages in the stationary frame
 * (λ_αs, λ_βs, λ_αr, λ_βr), the zero-sequence current i₀, and the mechanical speed ω_m:
 *
 *   dλ_αs/dt = v_α − R_s·i_αs                 dλ_αr/dt = −R_r·i_αr − ω_re·λ_βr
 *   dλ_βs/dt = v_β − R_s·i_βs                 dλ_βr/dt = −R_r·i_βr + ω_re·λ_αr
 *   i_αs = (L_r·λ_αs − L_m·λ_αr)/D            i_αr = (L_s·λ_αr − L_m·λ_αs)/D   (β alike)
 *   L_s = L_ls + L_m,  L_r = L_lr + L_m,  D = L_s·L_r − L_m²,  ω_re = (P/2)·ω_m
 *   T_e = (3/2)·(P/2)·(λ_αs·i_βs − λ_βs·i_αs)         J·dω_m/dt = T_e − B·ω_m − T_load
 *
 * At steady state on a balanced sine this reduces EXACTLY to the Steinmetz per-phase circuit
 * Z_in = R₁ + jX₁ + jXm ∥ (R₂/s + jX₂) — the R₂/s term emerges from the −jω_re·λ_r rotor
 * speed-voltage — so the settled waveform agrees with the steady-state readings (below the
 * magnetization knee; a machine whose knee sits under its rated flux saturates at nameplate and
 * reads above the linear readings panel — the solver says so). Reactances
 * are converted to inductances at the nameplate frequency once (L = X/ω_np); inductances are
 * frequency-independent, so the marched machine is honest at ANY drive frequency or waveform.
 *
 * The canvas port carries ONE phase of the balanced machine (the per-phase convention the
 * steady-state analysis already uses). The two unseen phases are the port waveform delayed by
 * one and two thirds of the drive period — for any periodic drive that is a true positive-
 * sequence set (a 60 Hz sine, a 6-step inverter waveform alike). Until a delay has elapsed the
 * unseen phases read 0 V (energizing staggered, like breaker poles closing in sequence; an
 * un-energized phase is held at 0 V — shorted to neutral, not an open pole — a stated fiction
 * of the single-port representation). The zero-sequence path (v₀ = (v_a+v_b+v_c)/3 through
 * R_s + L_ls, a 4-wire-wye convention) is what keeps DC honest: on a battery the αβ dynamics
 * die out and the port degenerates to exactly the stator R₁ the DC solver stamps — and makes
 * no torque, which also falls out of the equations.
 *
 * Numerics: within a circuit time step the four flux states are LINEAR (rotor speed frozen at
 * its last committed value — the mechanical time constant dwarfs the step), so the port is an
 * exact Norton companion i_a = G·v_a + I_hist with G > 0 (a passive one-port; the surrounding
 * Newton iteration sees a linear element). The fluxes integrate by the TRAPEZOIDAL rule — at
 * the machine's lightly-damped low-slip operating point backward-Euler's first-order damping
 * acts like added rotor resistance and visibly inflates the settled slip and current, while
 * the trapezoid holds the settled point to a fraction of a percent at ordinary steps. The
 * zero axis and the mechanical step stay implicit (backward-Euler) for robustness. The load
 * torque opposes motion and the shaft holds at rest until |T_e| exceeds it (a stiction-style
 * convention: the load alone never drives the rotor through zero).
 *
 * MAGNETIC SATURATION (optional, both machines): when the part supplies its magnetization
 * curve (a knee flux + a saturated slope), the MAGNETIZING inductance follows the CHORD of a
 * two-slope λ–i curve at the magnitude of the resultant magnetizing flux vector, updated one
 * step lagged like the frozen rotor speed (verified stable: the lag map's contraction factor is
 * ~0.1 even in deep saturation; the chord — not the incremental slope — is the consistent
 * choice for a flux-state model, and below the knee the code returns the unsaturated constant
 * DIRECTLY, so an unsaturated run is bit-identical to the linear model). Leakage paths stay
 * linear (air-dominated) — the extra STARTING current of real machines from rotor-slot-bridge
 * (leakage) saturation is deliberately out of scope, and a shorted cage suppresses
 * transformer-style flux-doubling at energization; the observable physics here is the
 * super-linear no-load current at overvoltage. Saturation acts on the resultant space vector —
 * exact for balanced sines (constant vector magnitude), the standard main-flux approximation
 * for unbalanced drives (|λ_m| then pulsates at twice line frequency); per-tooth locality and
 * cross-saturation are not modeled. Sources: Hinkkanen et al., "Small-Signal Modeling of Mutual
 * Saturation in Induction Machines," IEEE Trans. Industry Applications 46(3), 2010 (measured
 * chord vs incremental L_m at the rated point); IEEE Std 112 (the no-load test the curve comes
 * from).
 *
 * Verified against: Krause, "Analysis of Electric Machinery" (stationary-frame qd0 model);
 * Fitzgerald, "Electric Machinery"; the steady-state reduction to the Steinmetz circuit and
 * the DC/zero-torque limits proven symbolically and numerically before implementation.
 */

import { type InductionMotorParams, saturationCurveFromParams } from './induction-motor-model.ts'

export type DqInductances = {
  statorOhms: number // R_s (Ω)
  rotorOhms: number // R_r referred to the stator (Ω)
  statorLeakageH: number // L_ls (H)
  rotorLeakageH: number // L_lr (H)
  statorH: number // L_s = L_ls + L_m (H), at the UNSATURATED L_m
  rotorH: number // L_r = L_lr + L_m (H), at the UNSATURATED L_m
  magnetizingH: number // L_m unsaturated (H) — the catalog Xm
  fluxDet: number // D = L_s·L_r − L_m² (H²), at the unsaturated L_m
  polePairs: number // P/2
  /** The two-slope magnetization curve, when the part supplies it: linear at magnetizingH up to
   *  the knee (PEAK resultant magnetizing flux linkage, V·s), incremental slope magnetizingSatH
   *  above it. Absent ⇒ the magnetizing branch stays linear. */
  saturation?: { kneeFluxVs: number; magnetizingSatH: number }
}

/** The effective inductance set at a (possibly saturated) chord magnetizing inductance. */
function effectiveL(
  L: DqInductances,
  lmEff: number,
): { Ls: number; Lr: number; Lm: number; D: number } {
  const Ls = L.statorLeakageH + lmEff
  const Lr = L.rotorLeakageH + lmEff
  return { Ls, Lr, Lm: lmEff, D: Ls * Lr - lmEff * lmEff }
}

/**
 * The CHORD magnetizing inductance at a given resultant magnetizing-flux magnitude — the
 * consistent choice for a flux-state model (i = Γ·λ at the same instant reproduces the exact
 * magnetization-curve point; the incremental slope belongs only in small-signal Jacobians and
 * would be grossly wrong here). Below the knee this returns the unsaturated constant DIRECTLY —
 * not λ/(λ/L_m) — so an unsaturated run is bit-identical to the linear model.
 */
function saturatedLmEff(L: DqInductances, lamMagnitude: number): number {
  const sat = L.saturation
  if (sat === undefined || lamMagnitude <= sat.kneeFluxVs) return L.magnetizingH
  const iMag =
    sat.kneeFluxVs / L.magnetizingH + (lamMagnitude - sat.kneeFluxVs) / sat.magnetizingSatH
  return lamMagnitude / iMag
}

export type DqMechanics = {
  rotorInertia: number // J (kg·m²)
  viscousFriction: number // B (N·m·s/rad)
  loadTorque: number // T_load (N·m), opposing motion
}

type Vec4 = [number, number, number, number]

type DqStamp = {
  targetTime: number
  conductance: number // G (S) of the Norton companion at the port
  historyCurrent: number // I_hist (A), flowing terminal_a → terminal_b
  fluxKnown: Vec4 // λ at the target time if v_a were 0
  fluxPerVolt: Vec4 // ∂λ/∂v_a
  i0Known: number
  i0PerVolt: number
  uKnown: [number, number] // (v_α, v_β) at the target time, less v_a's (2/3)·v_a share
}

export type DqMotorCore = {
  inductances: DqInductances
  /** null ⇒ no rotor_inertia given: the rotor is HELD at lockedOmega (the quasi-static
   *  nameplate operating speed — the pre-dynamic behavior, kept for old saved circuits). */
  mechanics: DqMechanics | null
  lockedOmega: number // mechanical rad/s used when mechanics is null
  period: number // the drive period T the two unseen phases are delayed by
  flux: Vec4
  i0: number
  omega: number // mechanical rad/s — the spin-up state
  torque: number // last committed T_e (N·m)
  lmEffH: number // the chord magnetizing inductance for the NEXT step (saturation state)
  energized: boolean // the port has seen real voltage (gates the did-not-start warning)
  history: { t: number; v: number }[] // committed port-voltage samples (the phase delay line)
  uPrev: [number, number] // (v_α, v_β) at the last committed instant (trapezoid's left edge)
  stamp: DqStamp | null
}

/** Convert the nameplate-reactance parameters to the dq inductance set. Returns null when the
 *  flux model is singular (both leakages zero: D = 0 — stator and rotor flux collinear). */
export function dqInductancesFromParams(p: InductionMotorParams): DqInductances | null {
  const omegaNameplate = 2 * Math.PI * p.frequency
  if (!(omegaNameplate > 0) || !(p.poles > 0)) return null
  const statorLeakageH = p.statorReactance / omegaNameplate
  const rotorLeakageH = p.rotorReactance / omegaNameplate
  const magnetizingH = p.magnetizingReactance / omegaNameplate
  const statorH = statorLeakageH + magnetizingH
  const rotorH = rotorLeakageH + magnetizingH
  const fluxDet = statorH * rotorH - magnetizingH * magnetizingH
  if (!(fluxDet > 0)) return null
  const curve = saturationCurveFromParams(p)
  const saturation =
    curve !== null
      ? { kneeFluxVs: curve.kneeFluxVs, magnetizingSatH: curve.saturatedXm / omegaNameplate }
      : undefined
  return {
    statorOhms: p.statorResistance,
    rotorOhms: p.rotorResistance,
    statorLeakageH,
    rotorLeakageH,
    statorH,
    rotorH,
    magnetizingH,
    fluxDet,
    polePairs: p.poles / 2,
    ...(saturation !== undefined ? { saturation } : {}),
  }
}

export function createDqMotor(
  inductances: DqInductances,
  mechanics: DqMechanics | null,
  lockedOmega: number,
  period: number,
): DqMotorCore {
  return {
    inductances,
    mechanics,
    lockedOmega,
    period,
    flux: [0, 0, 0, 0],
    i0: 0,
    omega: mechanics === null ? lockedOmega : 0,
    torque: 0,
    lmEffH: inductances.magnetizingH,
    energized: false,
    history: [],
    uPrev: [0, 0],
    stamp: null,
  }
}

/** The committed port voltage at an earlier time, linearly interpolated; 0 before any sample
 *  (an unseen phase reads 0 V until its delay has elapsed — the staggered energization). */
function delayedPortVoltage(history: { t: number; v: number }[], t: number): number {
  const first = history[0]
  if (first === undefined || t < first.t) return 0
  const last = history[history.length - 1]
  if (last !== undefined && t >= last.t) return last.v
  // Binary search for the bracketing pair.
  let lo = 0
  let hi = history.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if ((history[mid]?.t ?? 0) <= t) lo = mid
    else hi = mid
  }
  const a = history[lo]
  const b = history[hi]
  if (a === undefined || b === undefined) return 0
  const span = b.t - a.t
  if (!(span > 0)) return a.v
  return a.v + ((b.v - a.v) * (t - a.t)) / span
}

/** Solve the square system M·x = rhs for several right-hand sides at once (Gaussian
 *  elimination, partial pivoting) — one factorization serves them all. */
function solveMulti(M: number[][], rhss: number[][]): number[][] {
  const n = M.length
  const m = rhss.length
  const a = M.map((row, r) => [...row, ...rhss.map((rhs) => rhs[r] ?? 0)])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r]?.[col] ?? 0) > Math.abs(a[pivot]?.[col] ?? 0)) pivot = r
    }
    const pivotRow = a[pivot]
    const colRow = a[col]
    if (pivotRow === undefined || colRow === undefined) break
    if (pivot !== col) {
      a[pivot] = colRow
      a[col] = pivotRow
    }
    const head = a[col]
    if (head === undefined) break
    const p = head[col] ?? 0
    if (p === 0) continue
    for (let r = col + 1; r < n; r++) {
      const row = a[r]
      if (row === undefined) continue
      const f = (row[col] ?? 0) / p
      if (f === 0) continue
      for (let c = col; c < n + m; c++) row[c] = (row[c] ?? 0) - f * (head[c] ?? 0)
    }
  }
  const xs = rhss.map(() => new Array<number>(n).fill(0))
  for (let r = n - 1; r >= 0; r--) {
    const row = a[r]
    if (row === undefined) continue
    const p = row[r] ?? 0
    for (let k = 0; k < m; k++) {
      let s = row[n + k] ?? 0
      for (let c = r + 1; c < n; c++) s -= (row[c] ?? 0) * (xs[k]?.[c] ?? 0)
      const xk = xs[k]
      if (xk !== undefined) xk[r] = p !== 0 ? s / p : 0
    }
  }
  return xs
}

function solve4Two(M: number[][], rhs1: Vec4, rhs2: Vec4): { x1: Vec4; x2: Vec4 } {
  const [x1, x2] = solveMulti(M, [rhs1, rhs2])
  return { x1: (x1 ?? [0, 0, 0, 0]) as Vec4, x2: (x2 ?? [0, 0, 0, 0]) as Vec4 }
}

/** The state matrix A of dλ/dt = A·λ + u at a frozen electrical rotor speed, evaluated at the
 *  step's (possibly saturated, one step lagged — like the frozen speed) chord L_m. */
function stateMatrix(L: DqInductances, lmEff: number, omegaElectrical: number): number[][] {
  const { statorOhms: Rs, rotorOhms: Rr } = L
  const { Ls, Lr, Lm, D } = effectiveL(L, lmEff)
  return [
    [(-Rs * Lr) / D, 0, (Rs * Lm) / D, 0],
    [0, (-Rs * Lr) / D, 0, (Rs * Lm) / D],
    [(Rr * Lm) / D, 0, (-Rr * Ls) / D, -omegaElectrical],
    [0, (Rr * Lm) / D, omegaElectrical, (-Rr * Ls) / D],
  ]
}

/**
 * Prepare the Norton companion for the step ending at targetTime (= previous instant + h):
 * i_a = G·v_a + I_hist. The two unseen phases at the target instant come off the committed
 * delay line (known constants for the whole Newton solve, so the element is exactly linear);
 * the trapezoidal flux update is split into a known part and a ∂/∂v_a sensitivity.
 */
export function dqStampMotor(core: DqMotorCore, targetTime: number, h: number): DqStamp {
  const L = core.inductances
  const eff = effectiveL(L, core.lmEffH)
  const omegaElectrical = L.polePairs * core.omega
  const vB = delayedPortVoltage(core.history, targetTime - core.period / 3)
  const vC = delayedPortVoltage(core.history, targetTime - (2 * core.period) / 3)
  const uKnown: [number, number] = [-(vB + vC) / 3, (vB - vC) / Math.sqrt(3)]
  const v0Known = (vB + vC) / 3

  const A = stateMatrix(L, core.lmEffH, omegaElectrical)
  const half = h / 2
  const lhs = A.map((row, r) => row.map((v, c) => (r === c ? 1 : 0) - half * v))
  // rhs1 = (I + (h/2)A)·λ + (h/2)·(u_prev + u_known); v_a's share of u_α enters via rhs2.
  const rhs1: Vec4 = [0, 0, 0, 0]
  for (let r = 0; r < 4; r++) {
    let s = core.flux[r] ?? 0
    for (let c = 0; c < 4; c++) s += half * (A[r]?.[c] ?? 0) * (core.flux[c] ?? 0)
    rhs1[r] = s
  }
  rhs1[0] += half * ((core.uPrev[0] ?? 0) + uKnown[0])
  rhs1[1] += half * ((core.uPrev[1] ?? 0) + uKnown[1])
  const rhs2: Vec4 = [h / 3, 0, 0, 0] // (h/2)·(2/3) — v_a's Clarke share of v_α
  const { x1: fluxKnown, x2: fluxPerVolt } = solve4Two(lhs, rhs1, rhs2)

  const iAlphaKnown = (eff.Lr * fluxKnown[0] - eff.Lm * fluxKnown[2]) / eff.D
  const iAlphaPerVolt = (eff.Lr * fluxPerVolt[0] - eff.Lm * fluxPerVolt[2]) / eff.D

  // Zero axis, backward-Euler (robust across the staggered-start voltage steps):
  // i₀' = (L_ls·i₀ + h·v₀')/(L_ls + h·R_s), v₀' = v₀_known + v_a/3.
  const denom0 = L.statorLeakageH + h * L.statorOhms
  const i0Known = (L.statorLeakageH * core.i0 + h * v0Known) / denom0
  const i0PerVolt = h / (3 * denom0)

  const stamp: DqStamp = {
    targetTime,
    conductance: iAlphaPerVolt + i0PerVolt,
    historyCurrent: iAlphaKnown + i0Known,
    fluxKnown,
    fluxPerVolt,
    i0Known,
    i0PerVolt,
    uKnown,
  }
  core.stamp = stamp
  return stamp
}

/** The rotor speed after one step: implicit in the friction, explicit in the (just-committed)
 *  torque, with the load always opposing motion and a stiction hold at standstill — the load
 *  torque alone never drives the shaft through zero. Exported for the machine family (the
 *  single-phase motor shares the identical mechanics convention). */
export function speedStep(omega: number, torque: number, mech: DqMechanics, h: number): number {
  if (omega === 0 && Math.abs(torque) <= mech.loadTorque) return 0
  const direction = omega !== 0 ? Math.sign(omega) : Math.sign(torque)
  const next =
    (omega + (h / mech.rotorInertia) * (torque - direction * mech.loadTorque)) /
    (1 + (h * mech.viscousFriction) / mech.rotorInertia)
  if (omega !== 0 && Math.sign(next) === -Math.sign(omega)) return 0
  return next
}

/** Commit the converged step: fluxes and i₀ from the solved port voltage (the same linear
 *  relation the stamp presented), the developed torque, the mechanical step, and the port
 *  sample onto the delay line. Returns the committed line current (terminal_a → terminal_b). */
export function dqCommitMotor(core: DqMotorCore, portVolts: number, h: number): number {
  const stamp = core.stamp
  if (stamp === null) return 0
  const L = core.inductances
  const eff = effectiveL(L, core.lmEffH) // the SAME chord the stamp marched with
  const flux: Vec4 = [0, 0, 0, 0]
  for (let r = 0; r < 4; r++)
    flux[r] = (stamp.fluxKnown[r] ?? 0) + (stamp.fluxPerVolt[r] ?? 0) * portVolts
  const iAlpha = (eff.Lr * flux[0] - eff.Lm * flux[2]) / eff.D
  const iBeta = (eff.Lr * flux[1] - eff.Lm * flux[3]) / eff.D
  core.flux = flux
  core.i0 = stamp.i0Known + stamp.i0PerVolt * portVolts
  core.torque = 1.5 * L.polePairs * (flux[0] * iBeta - flux[1] * iAlpha)
  const mech = core.mechanics
  core.omega = mech === null ? core.lockedOmega : speedStep(core.omega, core.torque, mech, h)
  // The saturation state for the NEXT step: the chord L_m at the committed resultant
  // magnetizing flux λ_m = λ_s − L_ls·i_s (lagged one step, like the frozen rotor speed).
  core.lmEffH = saturatedLmEff(
    L,
    Math.hypot(flux[0] - L.statorLeakageH * iAlpha, flux[1] - L.statorLeakageH * iBeta),
  )
  // Arm the did-not-start check on any real drive: 1 mV sits orders of magnitude above solver
  // leakage around an undriven port yet below any voltage that could be meant as a drive.
  if (Math.abs(portVolts) > 1e-3) core.energized = true
  core.uPrev = [stamp.uKnown[0] + (2 / 3) * portVolts, stamp.uKnown[1]]
  core.history.push({ t: stamp.targetTime, v: portVolts })
  // Only 2T/3 of history feeds the delays — prune the dead prefix once it grows. Triggered at
  // two periods of slack but trimmed back to one, so the splice runs once per ~period of steps
  // (a per-commit splice would shift the whole array every step at very fine time steps).
  const keepFrom = stamp.targetTime - core.period
  const first = core.history[0]
  if (core.history.length > 4096 && first !== undefined && first.t < keepFrom - core.period) {
    let drop = 0
    while (drop < core.history.length && (core.history[drop]?.t ?? 0) < keepFrom) drop++
    core.history.splice(0, drop)
  }
  return stamp.conductance * portVolts + stamp.historyCurrent
}

/** Record the t = 0 operating point: the port sat at zero current (an inductive start — the
 *  fluxes cannot jump), but its solved voltage seeds the delay line and the trapezoid's edge. */
export function dqInitMotor(core: DqMotorCore, portVolts: number): void {
  core.history.push({ t: 0, v: portVolts })
  core.uPrev = [(2 / 3) * portVolts, 0]
}

// === The TRUE three-phase machine — three phase ports (+ an optional star-point/neutral) ===
//
// Same verified dq physics, but the three phases arrive on REAL wires: no delayed-phase
// synthesis, no drive-period detection. The Clarke α/β components of the WINDING voltages are
// common-mode invariant, so they read straight off the phase TERMINALS (the star voltage cancels)
// and the machine never needs an internal star node in the matrix. The zero axis lives only when
// the neutral port is wired (a 4-wire wye); an unwired port — the floating star, an open phase —
// is eliminated exactly (its current forced to zero, the textbook open-terminal reduction), which
// is what makes swapped-lead reversal, single-phasing, and the two DC hookup identities
// (phase→neutral = R1, line-to-line = 2·R1) fall out instead of being coded.

/** Port order everywhere below: [phase_a, phase_b, phase_c, neutral]. */
export const DQ3_PORTS = ['phase_a', 'phase_b', 'phase_c', 'neutral'] as const

const SQRT3 = Math.sqrt(3)
// Terminal voltages → (v_α, v_β, v_0): the winding-voltage Clarke, star cancelled out of α/β.
const T_IN_ALPHA = [2 / 3, -1 / 3, -1 / 3, 0]
const T_IN_BETA = [0, 1 / SQRT3, -1 / SQRT3, 0]
const T_IN_ZERO = [1 / 3, 1 / 3, 1 / 3, -1]
const T_IN: number[][] = [T_IN_ALPHA, T_IN_BETA, T_IN_ZERO]
// (i_α, i_β, i_0) → current INTO each terminal (the amplitude-invariant inverse Clarke; the
// neutral returns the three zero-sequence shares, i_N = −3·i_0).
const T_OUT: number[][] = [
  [1, 0, 1],
  [-1 / 2, SQRT3 / 2, 1],
  [-1 / 2, -SQRT3 / 2, 1],
  [0, 0, -3],
]

type Dq3Stamp = {
  /** Reduced Norton over the WIRED ports (row/col order = the wired subset of DQ3_PORTS). */
  conductance: number[][]
  historyCurrents: number[]
  /** Full 4-port pieces, kept to reconstruct the open ports' voltages at commit. */
  fullG: number[][]
  fullIh: number[]
  fluxKnown: Vec4
  sensAlpha: Vec4
  sensBeta: Vec4
  i0Known: number
  i0PerV0: number
}

export type Dq3MotorCore = {
  inductances: DqInductances
  mechanics: DqMechanics | null
  lockedOmega: number
  /** Which of [phase_a, phase_b, phase_c, neutral] is wired; unwired ports are eliminated. */
  wired: [boolean, boolean, boolean, boolean]
  /** The connected drive's period (nameplate when ambiguous) — only the did-not-start
   *  warning's minimum-window gate reads it; nothing is synthesized from it. */
  period: number
  flux: Vec4
  i0: number
  omega: number
  torque: number
  lmEffH: number // the chord magnetizing inductance for the NEXT step (saturation state)
  energized: boolean
  uPrev: [number, number] // committed (v_α, v_β) — the trapezoid's left edge
  stamp: Dq3Stamp | null
}

export function createDqMotor3(
  inductances: DqInductances,
  mechanics: DqMechanics | null,
  lockedOmega: number,
  wired: [boolean, boolean, boolean, boolean],
  period: number,
): Dq3MotorCore {
  return {
    inductances,
    mechanics,
    lockedOmega,
    wired,
    period,
    flux: [0, 0, 0, 0],
    i0: 0,
    omega: mechanics === null ? lockedOmega : 0,
    torque: 0,
    lmEffH: inductances.magnetizingH,
    energized: false,
    uPrev: [0, 0],
    stamp: null,
  }
}

/** Reconstruct the open ports' voltages from the wired ones — the exact open-terminal condition
 *  (each unwired port's current forced to zero), solved on the open sub-block. */
function openPortVoltages(
  stamp: Dq3Stamp,
  wired: [boolean, boolean, boolean, boolean],
  wiredVolts: number[],
): number[] {
  const full = [0, 0, 0, 0]
  let w = 0
  for (let p = 0; p < 4; p++) if (wired[p]) full[p] = wiredVolts[w++] ?? 0
  const open: number[] = []
  for (let p = 0; p < 4; p++) if (!wired[p]) open.push(p)
  if (open.length === 0) return full
  // G_oo · v_o = −(Ih_o + G_ow · v_w)
  const Goo = open.map((r) => open.map((c) => stamp.fullG[r]?.[c] ?? 0))
  const rhs = open.map((r) => {
    let s = stamp.fullIh[r] ?? 0
    for (let p = 0; p < 4; p++) if (wired[p]) s += (stamp.fullG[r]?.[p] ?? 0) * (full[p] ?? 0)
    return -s
  })
  const [vOpen] = solveMulti(Goo, [rhs])
  open.forEach((p, k) => {
    full[p] = vOpen?.[k] ?? 0
  })
  return full
}

/**
 * Prepare the multi-port Norton companion for the step ending one h after the last commit:
 * i_wired = G·v_wired + I_hist. Built as the full 4-port composition G = T_out·K·T_in (K = the
 * trapezoidal flux sensitivities + the backward-Euler zero axis), then every unwired port is
 * eliminated by its zero-current condition — one code path for the 4-wire wye, the floating
 * star, and an open phase.
 */
export function dq3StampMotor(core: Dq3MotorCore, h: number): Dq3Stamp {
  const L = core.inductances
  const eff = effectiveL(L, core.lmEffH)
  const A = stateMatrix(L, core.lmEffH, L.polePairs * core.omega)
  const half = h / 2
  const lhs = A.map((row, r) => row.map((v, c) => (r === c ? 1 : 0) - half * v))
  const rhsHist: Vec4 = [0, 0, 0, 0]
  for (let r = 0; r < 4; r++) {
    let s = core.flux[r] ?? 0
    for (let c = 0; c < 4; c++) s += half * (A[r]?.[c] ?? 0) * (core.flux[c] ?? 0)
    rhsHist[r] = s
  }
  rhsHist[0] += half * (core.uPrev[0] ?? 0)
  rhsHist[1] += half * (core.uPrev[1] ?? 0)
  const [fluxKnown, sensAlpha, sensBeta] = solveMulti(lhs, [
    rhsHist,
    [half, 0, 0, 0],
    [0, half, 0, 0],
  ]) as [Vec4, Vec4, Vec4]

  const iOf = (lam: Vec4, r0: number, r2: number) =>
    (eff.Lr * (lam[r0] ?? 0) - eff.Lm * (lam[r2] ?? 0)) / eff.D
  const iAlphaHist = iOf(fluxKnown, 0, 2)
  const iBetaHist = iOf(fluxKnown, 1, 3)
  const K: number[][] = [
    [iOf(sensAlpha, 0, 2), iOf(sensBeta, 0, 2), 0],
    [iOf(sensAlpha, 1, 3), iOf(sensBeta, 1, 3), 0],
    [0, 0, 0],
  ]
  const denom0 = L.statorLeakageH + h * L.statorOhms
  const i0Known = (L.statorLeakageH * core.i0) / denom0
  const i0PerV0 = h / denom0
  const kRow = K[2]
  if (kRow !== undefined) kRow[2] = i0PerV0

  // G = T_out·K·T_in (4×4); Ih = T_out·(iα_hist, iβ_hist, i0_hist).
  const cols = [0, 1, 2, 3]
  const KT = K.map((kr) =>
    cols.map((c) => kr.reduce((s, kv, j) => s + kv * (T_IN[j]?.[c] ?? 0), 0)),
  )
  const fullG = T_OUT.map((or_) =>
    cols.map((c) => or_.reduce((s, ov, j) => s + ov * (KT[j]?.[c] ?? 0), 0)),
  )
  const ih3 = [iAlphaHist, iBetaHist, i0Known]
  const fullIh = T_OUT.map((or_) => or_.reduce((s, ov, j) => s + ov * (ih3[j] ?? 0), 0))

  // Eliminate the open ports: G' = G_ww − G_wo·G_oo⁻¹·G_ow, Ih' = Ih_w − G_wo·G_oo⁻¹·Ih_o.
  const wiredIdx: number[] = []
  const openIdx: number[] = []
  for (let p = 0; p < 4; p++) (core.wired[p] ? wiredIdx : openIdx).push(p)
  let conductance = wiredIdx.map((r) => wiredIdx.map((c) => fullG[r]?.[c] ?? 0))
  let historyCurrents = wiredIdx.map((r) => fullIh[r] ?? 0)
  if (openIdx.length > 0) {
    const Goo = openIdx.map((r) => openIdx.map((c) => fullG[r]?.[c] ?? 0))
    const rhss = [
      ...wiredIdx.map((c) => openIdx.map((r) => fullG[r]?.[c] ?? 0)),
      openIdx.map((r) => fullIh[r] ?? 0),
    ]
    const solved = solveMulti(Goo, rhss)
    conductance = wiredIdx.map((r) =>
      wiredIdx.map(
        (c, ci) =>
          (fullG[r]?.[c] ?? 0) -
          openIdx.reduce((s, o, oi) => s + (fullG[r]?.[o] ?? 0) * (solved[ci]?.[oi] ?? 0), 0),
      ),
    )
    const ihSolved = solved[wiredIdx.length]
    historyCurrents = wiredIdx.map(
      (r, ri) =>
        (historyCurrents[ri] ?? 0) -
        openIdx.reduce((s, o, oi) => s + (fullG[r]?.[o] ?? 0) * (ihSolved?.[oi] ?? 0), 0),
    )
  }

  const stamp: Dq3Stamp = {
    conductance,
    historyCurrents,
    fullG,
    fullIh,
    fluxKnown,
    sensAlpha,
    sensBeta,
    i0Known,
    i0PerV0,
  }
  core.stamp = stamp
  return stamp
}

/** Commit the converged step from the solved WIRED terminal voltages (in wired-port order):
 *  reconstruct the open ports, update fluxes / i₀ / torque / speed. Returns the current INTO
 *  each wired terminal, for the recording. */
export function dq3CommitMotor(core: Dq3MotorCore, wiredVolts: number[], h: number): number[] {
  const stamp = core.stamp
  if (stamp === null) return wiredVolts.map(() => 0)
  const L = core.inductances
  const eff = effectiveL(L, core.lmEffH) // the SAME chord the stamp marched with
  const vFull = openPortVoltages(stamp, core.wired, wiredVolts)
  const vAlpha = T_IN_ALPHA.reduce((s, t, p) => s + t * (vFull[p] ?? 0), 0)
  const vBeta = T_IN_BETA.reduce((s, t, p) => s + t * (vFull[p] ?? 0), 0)
  const v0 = T_IN_ZERO.reduce((s, t, p) => s + t * (vFull[p] ?? 0), 0)
  const flux: Vec4 = [0, 0, 0, 0]
  for (let r = 0; r < 4; r++)
    flux[r] =
      (stamp.fluxKnown[r] ?? 0) +
      (stamp.sensAlpha[r] ?? 0) * vAlpha +
      (stamp.sensBeta[r] ?? 0) * vBeta
  const iAlpha = (eff.Lr * flux[0] - eff.Lm * flux[2]) / eff.D
  const iBeta = (eff.Lr * flux[1] - eff.Lm * flux[3]) / eff.D
  core.flux = flux
  core.i0 = core.wired[3] ? stamp.i0Known + stamp.i0PerV0 * v0 : 0
  core.torque = 1.5 * L.polePairs * (flux[0] * iBeta - flux[1] * iAlpha)
  const mech = core.mechanics
  core.omega = mech === null ? core.lockedOmega : speedStep(core.omega, core.torque, mech, h)
  // The saturation state for the NEXT step (lagged one step, like the frozen rotor speed).
  core.lmEffH = saturatedLmEff(
    L,
    Math.hypot(flux[0] - L.statorLeakageH * iAlpha, flux[1] - L.statorLeakageH * iBeta),
  )
  if (Math.max(Math.abs(vAlpha), Math.abs(vBeta), Math.abs(v0)) > 1e-3) core.energized = true
  core.uPrev = [vAlpha, vBeta]
  const wiredIdx: number[] = []
  for (let p = 0; p < 4; p++) if (core.wired[p]) wiredIdx.push(p)
  return wiredIdx.map((_, ri) =>
    wiredVolts.reduce(
      (s, v, ci) => s + (stamp.conductance[ri]?.[ci] ?? 0) * v,
      stamp.historyCurrents[ri] ?? 0,
    ),
  )
}

/** Seed the trapezoid's left edge from the t = 0 solve. With every machine current still zero an
 *  open port's voltage is indeterminate — it reads as the wired phases' mean (one O(h) sample). */
export function dq3InitMotor(core: Dq3MotorCore, wiredVolts: number[]): void {
  const phases: number[] = []
  let w = 0
  for (let p = 0; p < 4; p++) {
    if (!core.wired[p]) continue
    if (p < 3) phases.push(wiredVolts[w] ?? 0)
    w++
  }
  const mean = phases.length > 0 ? phases.reduce((s, v) => s + v, 0) / phases.length : 0
  const full = [mean, mean, mean, 0]
  w = 0
  for (let p = 0; p < 4; p++) if (core.wired[p]) full[p] = wiredVolts[w++] ?? 0
  core.uPrev = [
    T_IN_ALPHA.reduce((s, t, p) => s + t * (full[p] ?? 0), 0),
    T_IN_BETA.reduce((s, t, p) => s + t * (full[p] ?? 0), 0),
  ]
}
