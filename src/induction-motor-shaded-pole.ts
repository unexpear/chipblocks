/**
 * SHADED-POLE single-phase induction motor — the cheapest, simplest AC motor (fans, microwave
 * turntables, small blowers), modeled honestly with its REAL, passive starting mechanism.
 *
 * A single-phase main winding alone makes a PULSATING field with exactly ZERO starting torque
 * (the single-phase curse). The shaded-pole machine adds NO driven auxiliary winding, NO
 * capacitor and NO centrifugal switch — instead a short-circuited copper SHADING RING sits
 * around part of each pole face. As the main flux rises the ring's induced current (Lenz) delays
 * the flux in the shaded portion, so the pole flux appears to sweep from the unshaded toward the
 * shaded side: a weak TRAVELLING field that gives a small but genuinely NONZERO starting torque.
 * The ring is dominantly RESISTIVE, which is what turns the lag into a real phase shift. Direction
 * is FIXED by the ring's physical position (unshaded → shaded) and cannot be reversed by swapping
 * the supply leads. Efficiency is low (~20-30 %); the ring dissipates continuously.
 *
 * MODEL — the non-quadrature three-winding cross-field machine. The starting torque comes
 * ENTIRELY from the DIRECT main↔shading magnetic coupling (the ring is NOT in exact space
 * quadrature with the main): a single-magnetizing-inductance QUADRATURE model has identically
 * zero starting torque (the axes decouple at standstill and the shorted ring is never excited —
 * verified in the design pass), so this machine carries a real displacement angle γ between the
 * main and the ring, cos γ = X13/X12 (the ratio of the main↔shading to the main↔rotor mutual
 * reactance). Four windings referred to the main — main (α), shading ring (at γ), rotor cage
 * (α, β) — with the full 4×4 coupled-inductance matrix (magnetizing L_m; the ring couples to
 * the main and rotor-α through L_m·cos γ and to rotor-β through L_m·sin γ). Currents i = L⁻¹·λ;
 * the shorted ring's terminal voltage is 0 (dλ_ring/dt = −R_ring·i_ring); the rotor rows carry
 * the speed voltages ∓ω_re·λ. The developed torque is
 *     T_e = (P/2)·L_m·(i_sβ·i_rα − i_sα·i_rβ),   i_sα = i_main + i_ring·cos γ,  i_sβ = i_ring·sin γ
 * — nonzero at standstill (unlike the pure single-phase machine), its sign set by sign(cos γ)
 * (which side is shaded), invariant under supply reversal. Only the MAIN winding connects to the
 * two terminals, so the port current is i_main and at DC the shorted ring carries no steady
 * current: the port degenerates to exactly the main resistance R1 the DC solver stamps.
 *
 * Numerics: per circuit step the rotor speed is frozen (mechanical time constant dwarfs the
 * step), so the four flux states are linear — trapezoid → an exact one-port Norton companion
 * i = G·v + I_hist (G > 0, a passive network). The READINGS solve the same model's steady-state
 * phasor system at the operating slip (verified equal to the marched torque/current at every
 * slip during design), then find the slip where the developed torque meets the load.
 *
 * Honest scope: this uniform-air-gap model reproduces the running operating point but
 * UNDER-produces the starting torque of a real shaded-pole motor — real designs add a stepped
 * (reluctance-augmented) air gap that more than triples it (Nondahl, IEEE PAS-100, 1981), which
 * is not modeled; the shaded-pole machine here starts fan-type (near-zero-at-standstill) loads,
 * its natural application. Magnetic saturation and core loss are not wired into this machine.
 * Sources: Trickey, "An Analysis of the Shaded-Pole Motor," AIEE Trans. 55, 1936 (the shorted-
 * ring quadrature analysis); Šarac & Atanasova-Pačemska, "Determination of a shaded pole motor
 * equivalent circuit..." J. Electrical Engineering 67(4), 2016 (the AKO-16 machine, the default
 * parameters, experiment-validated); Veinott, "Fractional- and Subfractional-Horsepower Electric
 * Motors" (revolving-field theory).
 */

import type { Instance } from './cross-fk-validator.ts'
import { type DqMechanics, speedStep } from './induction-motor-dq.ts'
import { synchronousSpeedRadPerSec } from './induction-motor-model.ts'
import { readScalarParam } from './instance-params.ts'

export type ShadedPoleMotorParams = {
  supplyVoltage: number // nameplate RMS (V)
  frequency: number // nameplate line frequency (Hz)
  poles: number
  mainResistance: number // R1 (Ω)
  mainReactance: number // X1 main leakage (Ω at nameplate f)
  rotorResistance: number // R2 referred to the main (Ω)
  rotorReactance: number // X2 referred to the main (Ω)
  magnetizingReactance: number // X12, the main↔rotor mutual (Ω) — the magnetizing
  shadingResistance: number // R3, the shading ring referred to the main (Ω)
  shadingReactance: number // X3, the shading ring's leakage referred (Ω)
  shadingMutualReactance: number // X13, the DIRECT main↔shading mutual (Ω); cos γ = X13/X12
  loadTorque: number
  viscousFriction: number
}

export function shadedPoleMotorParamsFromInstance(
  inst: Instance,
): ShadedPoleMotorParams | undefined {
  const supplyVoltage = readScalarParam(inst, 'supply_voltage')
  const frequency = readScalarParam(inst, 'line_frequency')
  const poles = readScalarParam(inst, 'pole_count')
  const mainResistance = readScalarParam(inst, 'main_resistance')
  const mainReactance = readScalarParam(inst, 'main_leakage_reactance')
  const rotorResistance = readScalarParam(inst, 'rotor_resistance')
  const rotorReactance = readScalarParam(inst, 'rotor_reactance')
  const magnetizingReactance = readScalarParam(inst, 'magnetizing_reactance')
  const shadingResistance = readScalarParam(inst, 'shading_resistance')
  const shadingReactance = readScalarParam(inst, 'shading_leakage_reactance')
  const shadingMutualReactance = readScalarParam(inst, 'shading_mutual_reactance')
  if (
    supplyVoltage === undefined ||
    frequency === undefined ||
    poles === undefined ||
    mainResistance === undefined ||
    mainReactance === undefined ||
    rotorResistance === undefined ||
    rotorReactance === undefined ||
    magnetizingReactance === undefined ||
    shadingResistance === undefined ||
    shadingReactance === undefined ||
    shadingMutualReactance === undefined ||
    !(frequency > 0) ||
    !(poles > 0) ||
    !(mainResistance > 0) ||
    !(rotorResistance > 0) ||
    !(magnetizingReactance > 0) ||
    !(shadingResistance > 0) ||
    // The direct main↔shading coupling is the ENTIRE source of starting torque; it must be a
    // real fraction of the magnetizing (0 < X13 < X12, i.e. 0 < cos γ < 1).
    !(shadingMutualReactance > 0) ||
    !(shadingMutualReactance < magnetizingReactance) ||
    mainReactance < 0 ||
    rotorReactance < 0 ||
    shadingReactance < 0
  ) {
    return undefined
  }
  return {
    supplyVoltage,
    frequency,
    poles,
    mainResistance,
    mainReactance,
    rotorResistance,
    rotorReactance,
    magnetizingReactance,
    shadingResistance,
    shadingReactance,
    shadingMutualReactance,
    loadTorque: readScalarParam(inst, 'load_torque') ?? 0,
    viscousFriction: readScalarParam(inst, 'viscous_friction') ?? 0,
  }
}

// --- The 4×4 coupled-inductance model (main, shading ring, rotor-α, rotor-β), referred to the
// main. Built once (no saturation), inverted once: currents come from fluxes as i = Γ·λ. ---

type ShadedPoleInductances = {
  main: number // R1
  shading: number // R3
  rotor: number // R2
  cosGamma: number // X13 / X12
  sinGamma: number
  magnetizingH: number // L_m
  gamma: number[][] // Γ = L⁻¹ (4×4)
  polePairs: number
}

/** Gaussian elimination with partial pivoting, several right-hand sides (small dense systems). */
function solveSmall(M: number[][], rhss: number[][]): number[][] {
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
    const pv = head[col] ?? 0
    if (pv === 0) continue
    for (let r = col + 1; r < n; r++) {
      const row = a[r]
      if (row === undefined) continue
      const f = (row[col] ?? 0) / pv
      if (f === 0) continue
      for (let c = col; c < n + m; c++) row[c] = (row[c] ?? 0) - f * (head[c] ?? 0)
    }
  }
  const xs = rhss.map(() => new Array<number>(n).fill(0))
  for (let r = n - 1; r >= 0; r--) {
    const row = a[r]
    if (row === undefined) continue
    const pv = row[r] ?? 0
    for (let k = 0; k < m; k++) {
      let s = row[n + k] ?? 0
      for (let c = r + 1; c < n; c++) s -= (row[c] ?? 0) * (xs[k]?.[c] ?? 0)
      const xk = xs[k]
      if (xk !== undefined) xk[r] = pv !== 0 ? s / pv : 0
    }
  }
  return xs
}

const matVec = (A: number[][], x: number[]): number[] =>
  A.map((row) => row.reduce((s, v, j) => s + v * (x[j] ?? 0), 0))

export function shadedPoleInductancesFromParams(
  p: ShadedPoleMotorParams,
): ShadedPoleInductances | null {
  const w = 2 * Math.PI * p.frequency
  const cosGamma = p.shadingMutualReactance / p.magnetizingReactance
  if (!(cosGamma > 0) || !(cosGamma < 1)) return null
  const sinGamma = Math.sqrt(1 - cosGamma * cosGamma)
  const Lm = p.magnetizingReactance / w
  const Lmm = p.mainReactance / w + Lm // main self
  const Lss = p.shadingReactance / w + Lm // shading self
  const Lrr = p.rotorReactance / w + Lm // rotor self (both axes)
  const Lms = Lm * cosGamma // main↔shading and shading↔rotorα
  const Lsb = Lm * sinGamma // shading↔rotorβ
  // Order [main, shading, rotor-α, rotor-β].
  const L = [
    [Lmm, Lms, Lm, 0],
    [Lms, Lss, Lms, Lsb],
    [Lm, Lms, Lrr, 0],
    [0, Lsb, 0, Lrr],
  ]
  const identity = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ]
  const cols = solveSmall(L, identity) // cols[j] = j-th column of L⁻¹
  const gamma = [0, 1, 2, 3].map((r) => cols.map((c) => c[r] ?? 0))
  // Reject a singular / non-physical inductance matrix (Γ must be finite AND a true inverse —
  // a singular L, e.g. both the main and rotor leakage zero, makes solveSmall return a
  // finite-but-wrong Γ; verify L·Γ ≈ I and skip by name if not, rather than march wrong physics).
  if (gamma.some((row) => row.some((v) => !Number.isFinite(v)))) return null
  let residual = 0
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const lg = [0, 1, 2, 3].reduce((s, k) => s + (L[r]?.[k] ?? 0) * (gamma[k]?.[c] ?? 0), 0)
      residual = Math.max(residual, Math.abs(lg - (r === c ? 1 : 0)))
    }
  }
  if (residual > 1e-6) return null
  return {
    main: p.mainResistance,
    shading: p.shadingResistance,
    rotor: p.rotorResistance,
    cosGamma,
    sinGamma,
    magnetizingH: Lm,
    gamma,
    polePairs: p.poles / 2,
  }
}

// --- READINGS: the steady-state phasor solve of the SAME 4-winding model at slip s (verified
// equal to the marched torque/current at every slip during design). ---

export type ShadedPoleOperatingPoint = {
  slip: number
  synchronousRpm: number
  rotorRpm: number
  torque: number
  currentRms: number
  /** Locked-rotor (starting) current, RMS (A). */
  startupCurrentRms: number
  /** Developed torque at standstill (s = 1) — small but NONZERO, the self-starting torque. */
  startingTorque: number
  powerFactor: number
  mechanicalPowerW: number
  inputPowerW: number
  efficiency: number
  stalled: boolean
}

type Cx = { re: number; im: number }

/** Solve the model's phasor steady state at slip s; return the port current, torque, power. The
 *  complex 4×4 system K·Λ = [V,0,0,0]ᵀ is assembled as a real 8×8 (K = jω·I + diag(R)·Γ + speed).*/
function shadedPolePhasor(
  L: ShadedPoleInductances,
  p: ShadedPoleMotorParams,
  slip: number,
): { current: number; torque: number; powerFactor: number; inputPowerW: number } {
  const w = 2 * Math.PI * p.frequency
  const wSyncElec = w // pole pairs cancel: ω_re,sync = (P/2)·ω_mech,sync = ω
  const omegaElec = (1 - slip) * wSyncElec
  const R = [L.main, L.shading, L.rotor, L.rotor]
  // Kre = diag(R)·Γ (+ speed couplings on the rotor rows); Kim = ω·I.
  const Kre = L.gamma.map((row, r) => row.map((v) => (R[r] ?? 0) * v))
  const kre2 = Kre[2]
  const kre3 = Kre[3]
  if (kre2 !== undefined) kre2[3] = (kre2[3] ?? 0) + omegaElec // +ω·Λ_rβ in the α-rotor row
  if (kre3 !== undefined) kre3[2] = (kre3[2] ?? 0) - omegaElec
  // Real 8×8: [[Kre, -Kim], [Kim, Kre]] · [Λre; Λim] = [b; 0], Kim = ω·I.
  const A8: number[][] = Array.from({ length: 8 }, () => new Array<number>(8).fill(0))
  for (let r = 0; r < 4; r++) {
    const top = A8[r]
    const bottom = A8[r + 4]
    if (top === undefined || bottom === undefined) continue
    for (let c = 0; c < 4; c++) {
      top[c] = Kre[r]?.[c] ?? 0
      top[c + 4] = r === c ? -w : 0
      bottom[c] = r === c ? w : 0
      bottom[c + 4] = Kre[r]?.[c] ?? 0
    }
  }
  const b8 = [p.supplyVoltage, 0, 0, 0, 0, 0, 0, 0]
  const [x] = solveSmall(A8, [b8]) as [number[]]
  const lamRe = [x[0] ?? 0, x[1] ?? 0, x[2] ?? 0, x[3] ?? 0]
  const lamIm = [x[4] ?? 0, x[5] ?? 0, x[6] ?? 0, x[7] ?? 0]
  const iRe = matVec(L.gamma, lamRe)
  const iIm = matVec(L.gamma, lamIm)
  const im: Cx = { re: iRe[0] ?? 0, im: iIm[0] ?? 0 }
  const is: Cx = { re: iRe[1] ?? 0, im: iIm[1] ?? 0 }
  const ira: Cx = { re: iRe[2] ?? 0, im: iIm[2] ?? 0 }
  const irb: Cx = { re: iRe[3] ?? 0, im: iIm[3] ?? 0 }
  // Stator MMF axis components; RMS-phasor time average ⟨x·y⟩ = Re{x·conj(y)}.
  const isa: Cx = { re: im.re + is.re * L.cosGamma, im: im.im + is.im * L.cosGamma }
  const isb: Cx = { re: is.re * L.sinGamma, im: is.im * L.sinGamma }
  const reCC = (a: Cx, b: Cx) => a.re * b.re + a.im * b.im
  const torque = L.polePairs * L.magnetizingH * (reCC(isb, ira) - reCC(isa, irb))
  const current = Math.hypot(im.re, im.im)
  const inputPowerW = p.supplyVoltage * im.re // Re{V·conj(I)} with V real
  const powerFactor = current > 0 ? im.re / current : 0
  return { current, torque, powerFactor, inputPowerW }
}

/** The steady-state current, torque and power factor at a GIVEN slip — the phasor solve of the
 *  model (equal to the marched values at the same slip). Null on a non-physical machine. */
export function shadedPoleSteadyStateAt(
  p: ShadedPoleMotorParams,
  slip: number,
): { currentRms: number; torque: number; powerFactor: number } | null {
  const L = shadedPoleInductancesFromParams(p)
  if (L === null) return null
  const r = shadedPolePhasor(L, p, slip)
  return { currentRms: r.current, torque: r.torque, powerFactor: r.powerFactor }
}

export function shadedPoleOperatingPoint(p: ShadedPoleMotorParams): ShadedPoleOperatingPoint {
  const L = shadedPoleInductancesFromParams(p)
  const wSync = synchronousSpeedRadPerSec(p.frequency, p.poles)
  const toRpm = (60 * wSync) / (2 * Math.PI)
  const zero: ShadedPoleOperatingPoint = {
    slip: 1,
    synchronousRpm: toRpm,
    rotorRpm: 0,
    torque: 0,
    currentRms: 0,
    startupCurrentRms: 0,
    startingTorque: 0,
    powerFactor: 0,
    mechanicalPowerW: 0,
    inputPowerW: 0,
    efficiency: 0,
    stalled: true,
  }
  if (L === null || !(wSync > 0)) return zero
  const torqueAt = (s: number) => shadedPolePhasor(L, p, s).torque
  const balance = (s: number) => torqueAt(s) - (p.loadTorque + p.viscousFriction * (1 - s) * wSync)
  // The torque curve rises from a small standstill value to a breakdown peak, then falls toward
  // synchronous — scan for the peak, then bisect the stable low-slip branch.
  let sPeak = 0.05
  let tPeak = Number.NEGATIVE_INFINITY
  for (let k = 1; k <= 200; k++) {
    const s = k / 200
    const t = torqueAt(s)
    if (t > tPeak) {
      tPeak = t
      sPeak = s
    }
  }
  let slip: number
  let stalled = false
  if (balance(sPeak) <= 0) {
    slip = 1
    stalled = true
  } else if (balance(1e-4) >= 0) {
    slip = 1e-4
  } else {
    let lo = 1e-4
    let hi = sPeak
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2
      if (balance(mid) > 0) hi = mid
      else lo = mid
    }
    slip = (lo + hi) / 2
  }
  const op = shadedPolePhasor(L, p, slip)
  const locked = shadedPolePhasor(L, p, 1)
  const omega = (1 - slip) * wSync
  const mechanicalGrossW = op.torque * omega
  const frictionLossW = p.viscousFriction * omega * omega
  const mechanicalPowerW = Math.max(0, mechanicalGrossW - frictionLossW)
  return {
    slip,
    synchronousRpm: toRpm,
    rotorRpm: (1 - slip) * toRpm,
    torque: op.torque,
    currentRms: op.current,
    startupCurrentRms: locked.current,
    startingTorque: locked.torque,
    powerFactor: op.powerFactor,
    mechanicalPowerW,
    inputPowerW: op.inputPowerW,
    efficiency: op.inputPowerW > 0 ? mechanicalPowerW / op.inputPowerW : 0,
    stalled,
  }
}

// --- The DYNAMIC element: the 4-state shaded-pole machine as a one-port Norton companion. ---

type ShadedPoleStamp = {
  conductance: number
  historyCurrent: number
  fluxKnown: number[] // states at the target time if v were 0
  fluxPerVolt: number[] // ∂states/∂v
}

export type ShadedPoleMotorCore = {
  L: ShadedPoleInductances
  mechanics: DqMechanics | null
  lockedOmega: number
  period: number
  flux: number[] // [λ_main, λ_shading, λ_rotorα, λ_rotorβ]
  omega: number
  torque: number
  energized: boolean
  vPrev: number // committed port voltage — the trapezoid's left edge
  stamp: ShadedPoleStamp | null
}

export function createShadedPoleMotor(
  L: ShadedPoleInductances,
  mechanics: DqMechanics | null,
  lockedOmega: number,
  period: number,
): ShadedPoleMotorCore {
  return {
    L,
    mechanics,
    lockedOmega,
    period,
    flux: [0, 0, 0, 0],
    omega: mechanics === null ? lockedOmega : 0,
    torque: 0,
    energized: false,
    vPrev: 0,
    stamp: null,
  }
}

/** The 4×4 state matrix A of dλ/dt = A·λ + b·v at a frozen rotor speed: A = −diag(R)·Γ, with the
 *  rotor rows carrying the speed voltages (∓ω_re on the paired rotor flux). */
function shadedPoleStateMatrix(L: ShadedPoleInductances, omegaElectrical: number): number[][] {
  const R = [L.main, L.shading, L.rotor, L.rotor]
  const A = L.gamma.map((row, r) => row.map((v) => -(R[r] ?? 0) * v))
  const a2 = A[2]
  const a3 = A[3]
  if (a2 !== undefined) a2[3] = (a2[3] ?? 0) - omegaElectrical // dλ_rα += −ω·λ_rβ
  if (a3 !== undefined) a3[2] = (a3[2] ?? 0) + omegaElectrical // dλ_rβ += +ω·λ_rα
  return A
}

/** Prepare the one-port Norton for the step ending one h after the last commit — trapezoid on
 *  the four fluxes, only the MAIN winding driven (the ring is shorted), port current = i_main. */
export function shadedPoleStampMotor(core: ShadedPoleMotorCore, h: number): ShadedPoleStamp {
  const L = core.L
  const omegaElectrical = L.polePairs * core.omega
  const A = shadedPoleStateMatrix(L, omegaElectrical)
  const half = h / 2
  const M = A.map((row, r) => row.map((v, c) => (r === c ? 1 : 0) - half * v))
  const bV = [1, 0, 0, 0] // only the main winding sees the port voltage
  const rhsHist = core.flux.map((fr, r) => {
    let s = fr
    for (let c = 0; c < 4; c++) s += half * (A[r]?.[c] ?? 0) * (core.flux[c] ?? 0)
    s += half * (bV[r] ?? 0) * core.vPrev
    return s
  })
  const rhsSens = bV.map((b) => half * b)
  const [fluxKnown, fluxPerVolt] = solveSmall(M, [rhsHist, rhsSens]) as [number[], number[]]
  const portOf = (flux: number[]) => matVec(L.gamma, flux)[0] ?? 0 // i_main = (Γ·λ)_main
  const stamp: ShadedPoleStamp = {
    conductance: portOf(fluxPerVolt),
    historyCurrent: portOf(fluxKnown),
    fluxKnown,
    fluxPerVolt,
  }
  core.stamp = stamp
  return stamp
}

/** Commit the converged step from the solved port voltage; returns the port current i_main. */
export function shadedPoleCommitMotor(
  core: ShadedPoleMotorCore,
  portVolts: number,
  h: number,
): number {
  const stamp = core.stamp
  if (stamp === null) return 0
  const L = core.L
  const flux = stamp.fluxKnown.map((k, i) => k + (stamp.fluxPerVolt[i] ?? 0) * portVolts)
  core.flux = flux
  const i = matVec(L.gamma, flux)
  const iMain = i[0] ?? 0
  const iRing = i[1] ?? 0
  const iRotorA = i[2] ?? 0
  const iRotorB = i[3] ?? 0
  // The stator MMF axis components (the ring is displaced by γ from the main).
  const iStatorA = iMain + iRing * L.cosGamma
  const iStatorB = iRing * L.sinGamma
  core.torque = L.polePairs * L.magnetizingH * (iStatorB * iRotorA - iStatorA * iRotorB)
  const mech = core.mechanics
  core.omega = mech === null ? core.lockedOmega : speedStep(core.omega, core.torque, mech, h)
  if (Math.abs(portVolts) > 1e-3) core.energized = true
  core.vPrev = portVolts
  return iMain
}

/** Seed the trapezoid's left edge from the t = 0 solve (the port sat at zero current). */
export function shadedPoleInitMotor(core: ShadedPoleMotorCore, portVolts: number): void {
  core.vPrev = portVolts
}
