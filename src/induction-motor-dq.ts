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
 * speed-voltage — so the settled waveform agrees with the steady-state readings. Reactances
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
 * Verified against: Krause, "Analysis of Electric Machinery" (stationary-frame qd0 model);
 * Fitzgerald, "Electric Machinery"; the steady-state reduction to the Steinmetz circuit and
 * the DC/zero-torque limits proven symbolically and numerically before implementation.
 */

import type { InductionMotorParams } from './induction-motor-model.ts'

export type DqInductances = {
  statorOhms: number // R_s (Ω)
  rotorOhms: number // R_r referred to the stator (Ω)
  statorLeakageH: number // L_ls (H)
  statorH: number // L_s = L_ls + L_m (H)
  rotorH: number // L_r = L_lr + L_m (H)
  magnetizingH: number // L_m (H)
  fluxDet: number // D = L_s·L_r − L_m² (H²)
  polePairs: number // P/2
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
  return {
    statorOhms: p.statorResistance,
    rotorOhms: p.rotorResistance,
    statorLeakageH,
    statorH,
    rotorH,
    magnetizingH,
    fluxDet,
    polePairs: p.poles / 2,
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

/** Solve the 4×4 system M·x = rhs for two right-hand sides (Gaussian elimination, partial
 *  pivoting). One factorization serves both the history and the sensitivity solve. */
function solve4Two(M: number[][], rhs1: Vec4, rhs2: Vec4): { x1: Vec4; x2: Vec4 } {
  const a = M.map((row, r) => [...row, rhs1[r] ?? 0, rhs2[r] ?? 0])
  for (let col = 0; col < 4; col++) {
    let pivot = col
    for (let r = col + 1; r < 4; r++) {
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
    for (let r = col + 1; r < 4; r++) {
      const row = a[r]
      if (row === undefined) continue
      const f = (row[col] ?? 0) / p
      if (f === 0) continue
      for (let c = col; c < 6; c++) row[c] = (row[c] ?? 0) - f * (head[c] ?? 0)
    }
  }
  const x1: Vec4 = [0, 0, 0, 0]
  const x2: Vec4 = [0, 0, 0, 0]
  for (let r = 3; r >= 0; r--) {
    const row = a[r]
    if (row === undefined) continue
    let s1 = row[4] ?? 0
    let s2 = row[5] ?? 0
    for (let c = r + 1; c < 4; c++) {
      s1 -= (row[c] ?? 0) * (x1[c] ?? 0)
      s2 -= (row[c] ?? 0) * (x2[c] ?? 0)
    }
    const p = row[r] ?? 0
    x1[r] = p !== 0 ? s1 / p : 0
    x2[r] = p !== 0 ? s2 / p : 0
  }
  return { x1, x2 }
}

/** The state matrix A of dλ/dt = A·λ + u at a frozen electrical rotor speed. */
function stateMatrix(L: DqInductances, omegaElectrical: number): number[][] {
  const { statorOhms: Rs, rotorOhms: Rr, statorH: Ls, rotorH: Lr, magnetizingH: Lm, fluxDet: D } = L
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
  const omegaElectrical = L.polePairs * core.omega
  const vB = delayedPortVoltage(core.history, targetTime - core.period / 3)
  const vC = delayedPortVoltage(core.history, targetTime - (2 * core.period) / 3)
  const uKnown: [number, number] = [-(vB + vC) / 3, (vB - vC) / Math.sqrt(3)]
  const v0Known = (vB + vC) / 3

  const A = stateMatrix(L, omegaElectrical)
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

  const iAlphaKnown = (L.rotorH * fluxKnown[0] - L.magnetizingH * fluxKnown[2]) / L.fluxDet
  const iAlphaPerVolt = (L.rotorH * fluxPerVolt[0] - L.magnetizingH * fluxPerVolt[2]) / L.fluxDet

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
 *  torque alone never drives the shaft through zero. */
function speedStep(omega: number, torque: number, mech: DqMechanics, h: number): number {
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
  const flux: Vec4 = [0, 0, 0, 0]
  for (let r = 0; r < 4; r++)
    flux[r] = (stamp.fluxKnown[r] ?? 0) + (stamp.fluxPerVolt[r] ?? 0) * portVolts
  const iAlpha = (L.rotorH * flux[0] - L.magnetizingH * flux[2]) / L.fluxDet
  const iBeta = (L.rotorH * flux[1] - L.magnetizingH * flux[3]) / L.fluxDet
  core.flux = flux
  core.i0 = stamp.i0Known + stamp.i0PerVolt * portVolts
  core.torque = 1.5 * L.polePairs * (flux[0] * iBeta - flux[1] * iAlpha)
  const mech = core.mechanics
  core.omega = mech === null ? core.lockedOmega : speedStep(core.omega, core.torque, mech, h)
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
