/**
 * SINGLE-PHASE induction motor — the fan/fridge/washer machine, modeled honestly by the
 * double-revolving-field / cross-field theory WITH its real starting mechanism.
 *
 * A single winding on single-phase AC makes a PULSATING field — equal to two counter-rotating
 * half-amplitude fields. At standstill they cancel exactly: ZERO starting torque, the
 * single-phase curse. Real machines add an AUXILIARY winding in space quadrature whose current
 * is phase-shifted from the main's (by its own higher R/X in a split-phase machine, or by a
 * series START CAPACITOR in a cap-start one) — the two out-of-step currents make a genuinely
 * rotating field that starts the rotor, and a CENTRIFUGAL SWITCH drops the start winding out at
 * ~75 % of synchronous speed. From there the machine runs on the main winding alone: the rotor,
 * already turning, strengthens the field component rotating WITH it (slip s) and weakens the
 * one against it (slip 2 − s) — the true double-revolving-field running condition.
 *
 * DYNAMIC MODEL (the time-domain element): the unsymmetrical two-phase cross-field machine —
 * main winding on the α axis, auxiliary on the −β axis (reversed mounting so a LEADING aux
 * current excites the positive sequence under this solver's rotor-sign convention — the design
 * review caught the shipped default spinning backward on +β), aux quantities referred to the
 * main by the effective turns ratio a (R/a², L/a², the cap as C′ = a²·C with v′_C = v_C/a).
 * Because the stator axes differ, the flux→current inversion carries TWO determinants
 * (D_α ≠ D_β), and the torque must be the MUTUAL form
 *     T_e = (P/2) · L_m · (i_ar·i_bs − i_br·i_as)
 * — the stator-flux form picks up a spurious leakage-difference term (~2 % of locked torque)
 * that rotor-position-independent leakages cannot physically make. Both corrections were caught
 * by the adversarial design verification, along with the exact steady-state reduction of the
 * main-only machine to the textbook double-field circuit (used by the READINGS below).
 *
 * Numerics: per circuit step (rotor speed frozen, like its three-phase siblings) the machine is
 * LINEAR — trapezoid on the four flux states, backward-Euler on the referred cap voltage — so
 * the two-terminal port is an exact Norton companion i = G·v + I_hist (a split-phase machine is
 * the same 5-state system with 1/C′ = 0, freezing v′_C at zero). The centrifugal switch opens
 * one way per run, decided from the COMMITTED speed at a step boundary (never inside a Newton
 * loop): the β stator state drops (i_bs forced 0; λ_bs becomes the dependent (L_m/L_r)·λ_br),
 * the rotor flux linkages carry CONTINUOUSLY across the event (the cage is closed and
 * untouched), and the interrupted aux-leakage energy is the switch arc's — the ideal-switch
 * convention. Real switches re-close near half speed; one-way-per-run is the start sequence.
 *
 * Honest scope: the running READINGS come from the main-only double-field circuit at the
 * nameplate; the marched slip on a light rotor reads slightly above it because the single-phase
 * machine's REAL torque pulsation at twice line frequency ripples the speed (the scope shows
 * the 2f ripple; the phasor analysis assumes constant speed — documented, not smoothed away).
 * Magnetizing saturation is not wired into this machine yet; reversal (swapping the aux leads)
 * is a further rung. Sources: Krause, "Analysis of Electric Machinery" (the unsymmetrical
 * 2-phase machine; the shipped default parameters are his classic ¼-hp 110 V 60 Hz example
 * machine); Fitzgerald, "Electric Machinery" (double-revolving-field theory); Veinott,
 * "Fractional- and Subfractional-Horsepower Electric Motors".
 */

import type { Instance } from './cross-fk-validator.ts'
import { type DqMechanics, speedStep } from './induction-motor-dq.ts'
import { synchronousSpeedRadPerSec } from './induction-motor-model.ts'
import { readScalarParam } from './instance-params.ts'

export type SinglePhaseMotorParams = {
  supplyVoltage: number // nameplate RMS (V)
  frequency: number // nameplate line frequency (Hz)
  poles: number
  mainResistance: number // R_m (Ω)
  mainReactance: number // X1 main leakage (Ω at nameplate f)
  rotorResistance: number // R2 referred to the MAIN winding (Ω)
  rotorReactance: number // X2 referred to the main (Ω)
  magnetizingReactance: number // Xm referred to the main (Ω)
  auxResistance: number // R_aux, the PHYSICAL start winding (Ω)
  auxReactance: number // X_aux leakage, physical (Ω at nameplate f)
  auxTurnsRatio: number // a = N_aux / N_main
  startCapacitanceF?: number // series start capacitor (F); absent ⇒ split-phase
  switchOpenFraction: number // centrifugal switch opens at this fraction of synchronous speed
  loadTorque: number
  viscousFriction: number
}

export function singlePhaseMotorParamsFromInstance(
  inst: Instance,
): SinglePhaseMotorParams | undefined {
  const supplyVoltage = readScalarParam(inst, 'supply_voltage')
  const frequency = readScalarParam(inst, 'line_frequency')
  const poles = readScalarParam(inst, 'pole_count')
  const mainResistance = readScalarParam(inst, 'main_resistance')
  const mainReactance = readScalarParam(inst, 'main_leakage_reactance')
  const rotorResistance = readScalarParam(inst, 'rotor_resistance')
  const rotorReactance = readScalarParam(inst, 'rotor_reactance')
  const magnetizingReactance = readScalarParam(inst, 'magnetizing_reactance')
  const auxResistance = readScalarParam(inst, 'aux_resistance')
  const auxReactance = readScalarParam(inst, 'aux_leakage_reactance')
  const auxTurnsRatio = readScalarParam(inst, 'aux_turns_ratio')
  if (
    supplyVoltage === undefined ||
    frequency === undefined ||
    poles === undefined ||
    mainResistance === undefined ||
    mainReactance === undefined ||
    rotorResistance === undefined ||
    rotorReactance === undefined ||
    magnetizingReactance === undefined ||
    auxResistance === undefined ||
    auxReactance === undefined ||
    auxTurnsRatio === undefined ||
    !(frequency > 0) ||
    !(poles > 0) ||
    !(rotorResistance > 0) ||
    !(mainResistance > 0) ||
    !(magnetizingReactance > 0) ||
    !(auxResistance > 0) ||
    !(auxTurnsRatio > 0) ||
    mainReactance < 0 ||
    rotorReactance < 0 ||
    auxReactance < 0
  ) {
    return undefined
  }
  const startCapacitanceF = readScalarParam(inst, 'start_capacitance')
  return {
    supplyVoltage,
    frequency,
    poles,
    mainResistance,
    mainReactance,
    rotorResistance,
    rotorReactance,
    magnetizingReactance,
    auxResistance,
    auxReactance,
    auxTurnsRatio,
    ...(startCapacitanceF !== undefined && startCapacitanceF > 0 ? { startCapacitanceF } : {}),
    switchOpenFraction: readScalarParam(inst, 'switch_open_speed') ?? 0.75,
    loadTorque: readScalarParam(inst, 'load_torque') ?? 0,
    viscousFriction: readScalarParam(inst, 'viscous_friction') ?? 0,
  }
}

// --- READINGS: the double-revolving-field steady analysis of the RUNNING machine (main
// winding only — the switch is open at speed). Forward branch at slip s, backward at 2 − s,
// each half-amplitude: Z_f = 0.5·[jXm ∥ (R2/s + jX2)], Z_b = 0.5·[jXm ∥ (R2/(2−s) + jX2)],
// I1 = V/(R1 + jX1 + Z_f + Z_b), torque = (P_gap,f − P_gap,b)/ω_sync. Verified exact against
// the marched dq model at four slips during design. ---

type Cx = { re: number; im: number }
const cAdd = (x: Cx, y: Cx): Cx => ({ re: x.re + y.re, im: x.im + y.im })
const cMul = (x: Cx, y: Cx): Cx => ({
  re: x.re * y.re - x.im * y.im,
  im: x.re * y.im + x.im * y.re,
})
const cDiv = (x: Cx, y: Cx): Cx => {
  const d = y.re * y.re + y.im * y.im
  return { re: (x.re * y.re + x.im * y.im) / d, im: (x.im * y.re - x.re * y.im) / d }
}
const cAbs = (x: Cx): number => Math.hypot(x.re, x.im)

/** Half-amplitude field branch: 0.5 · [jXm ∥ (R2/sEff + jX2)]. */
function halfBranch(p: SinglePhaseMotorParams, slipEffective: number): Cx {
  const r2s = p.rotorResistance / Math.max(slipEffective, 1e-9)
  const rotor: Cx = { re: r2s, im: p.rotorReactance }
  const mag: Cx = { re: 0, im: p.magnetizingReactance }
  const par = cDiv(cMul(mag, rotor), cAdd(mag, rotor))
  return { re: 0.5 * par.re, im: 0.5 * par.im }
}

/** Developed torque of the running (main-only) machine at slip s, from the two gap powers. */
export function singlePhaseTorque(slip: number, p: SinglePhaseMotorParams): number {
  const wSync = synchronousSpeedRadPerSec(p.frequency, p.poles)
  if (!(wSync > 0) || slip <= 0 || slip >= 2) return 0
  const zf = halfBranch(p, slip)
  const zb = halfBranch(p, 2 - slip)
  const zIn = cAdd(cAdd({ re: p.mainResistance, im: p.mainReactance }, zf), zb)
  const i1 = p.supplyVoltage / cAbs(zIn)
  return (i1 * i1 * (zf.re - zb.re)) / wSync
}

export type SinglePhaseOperatingPoint = {
  slip: number
  synchronousRpm: number
  rotorRpm: number
  torque: number
  /** Running current (main winding, switch open), RMS (A). */
  currentRms: number
  /** Locked-rotor current of the MAIN winding alone (A) — the aux branch adds to the real
   *  starting draw; the transient shows the whole of it. */
  startupCurrentRms: number
  powerFactor: number
  mechanicalPowerW: number
  inputPowerW: number
  efficiency: number
  /** True when the running machine cannot carry the load (or, with zero starting torque and no
   *  working start winding, cannot reach it). */
  stalled: boolean
}

export function singlePhaseOperatingPoint(p: SinglePhaseMotorParams): SinglePhaseOperatingPoint {
  const wSync = synchronousSpeedRadPerSec(p.frequency, p.poles)
  const balance = (s: number) =>
    singlePhaseTorque(s, p) - (p.loadTorque + p.viscousFriction * (1 - s) * wSync)
  // The torque curve rises from a small (backward-field-dragged) value near s = 0 to a
  // breakdown peak, then falls toward zero at s = 1 — scan for the peak, then bisect the
  // stable low-slip branch.
  let sPeak = 0.05
  let tPeak = Number.NEGATIVE_INFINITY
  for (let k = 1; k <= 200; k++) {
    const s = k / 200
    const t = singlePhaseTorque(s, p)
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
  const zf = halfBranch(p, slip)
  const zb = halfBranch(p, 2 - slip)
  const zIn = cAdd(cAdd({ re: p.mainResistance, im: p.mainReactance }, zf), zb)
  const zMag = cAbs(zIn)
  const currentRms = zMag > 0 ? p.supplyVoltage / zMag : 0
  const powerFactor = zMag > 0 ? zIn.re / zMag : 0
  const omega = (1 - slip) * wSync
  const torque = singlePhaseTorque(slip, p)
  const mechanicalGrossW = torque * omega
  const frictionLossW = p.viscousFriction * omega * omega
  const mechanicalPowerW = Math.max(0, mechanicalGrossW - frictionLossW)
  const inputPowerW = p.supplyVoltage * currentRms * powerFactor
  const zLocked = cAdd(
    cAdd({ re: p.mainResistance, im: p.mainReactance }, halfBranch(p, 1)),
    halfBranch(p, 1),
  )
  const toRpm = (60 * wSync) / (2 * Math.PI)
  return {
    slip,
    synchronousRpm: toRpm,
    rotorRpm: (1 - slip) * toRpm,
    torque,
    currentRms,
    startupCurrentRms: p.supplyVoltage / cAbs(zLocked),
    powerFactor,
    mechanicalPowerW,
    inputPowerW,
    efficiency: inputPowerW > 0 ? mechanicalPowerW / inputPowerW : 0,
    stalled,
  }
}

// --- The DYNAMIC element: the unsymmetrical two-phase cross-field machine as a one-port
// Norton companion, with the aux branch (and its cap + centrifugal switch) inside. ---

type SpInductances = {
  mainOhms: number // R_m
  auxOhmsRef: number // R_aux / a²
  rotorOhms: number // R_2 (referred to main)
  mainLeakH: number // L_l,main
  auxLeakHRef: number // L_l,aux / a²
  rotorLeakH: number // L_lr
  magnetizingH: number // L_m
  statorAlphaH: number // L_sα = L_l,main + L_m
  statorBetaH: number // L_sβ = L_l,aux′ + L_m
  rotorH: number // L_r = L_lr + L_m
  detAlpha: number // D_α = L_sα·L_r − L_m²
  detBeta: number // D_β = L_sβ·L_r − L_m²
  polePairs: number
  turnsRatio: number // a
  invCapRef: number // 1/C′ = 1/(a²·C); 0 ⇒ split-phase (no cap)
}

export function spInductancesFromParams(p: SinglePhaseMotorParams): SpInductances | null {
  const w = 2 * Math.PI * p.frequency
  const a2 = p.auxTurnsRatio * p.auxTurnsRatio
  const mainLeakH = p.mainReactance / w
  const auxLeakHRef = p.auxReactance / w / a2
  const rotorLeakH = p.rotorReactance / w
  const magnetizingH = p.magnetizingReactance / w
  const statorAlphaH = mainLeakH + magnetizingH
  const statorBetaH = auxLeakHRef + magnetizingH
  const rotorH = rotorLeakH + magnetizingH
  const detAlpha = statorAlphaH * rotorH - magnetizingH * magnetizingH
  const detBeta = statorBetaH * rotorH - magnetizingH * magnetizingH
  if (!(detAlpha > 0) || !(detBeta > 0)) return null
  return {
    mainOhms: p.mainResistance,
    auxOhmsRef: p.auxResistance / a2,
    rotorOhms: p.rotorResistance,
    mainLeakH,
    auxLeakHRef,
    rotorLeakH,
    magnetizingH,
    statorAlphaH,
    statorBetaH,
    rotorH,
    detAlpha,
    detBeta,
    polePairs: p.poles / 2,
    turnsRatio: p.auxTurnsRatio,
    invCapRef: p.startCapacitanceF !== undefined ? 1 / (a2 * p.startCapacitanceF) : 0,
  }
}

type SpStamp = {
  mode: 'starting' | 'running'
  conductance: number
  historyCurrent: number
  xKnown: number[] // states at the target time if v were 0
  xPerVolt: number[] // ∂states/∂v
}

export type SpMotorCore = {
  L: SpInductances
  mechanics: DqMechanics | null
  lockedOmega: number
  /** The connected drive's period (nameplate when ambiguous) — only the did-not-start
   *  warning's minimum-window gate reads it. */
  period: number
  switchThreshold: number // mechanical rad/s — the centrifugal opening speed
  switchClosed: boolean
  /** Closed-switch states [λ_as, λ_bs, λ_ar, λ_br, v′_C]; open-switch uses [λ_as, λ_ar, λ_br]
   *  in slots 0/2/3 (λ_bs dependent, v′_C frozen). */
  flux: [number, number, number, number]
  vCapRef: number
  omega: number
  torque: number
  energized: boolean
  vPrev: number // committed port voltage — the trapezoid's left edge
  stamp: SpStamp | null
}

export function createSpMotor(
  L: SpInductances,
  mechanics: DqMechanics | null,
  lockedOmega: number,
  period: number,
  switchThreshold: number,
): SpMotorCore {
  // The switch state at t = 0 follows the STARTING speed: a locked (no-inertia) machine held
  // above the switch speed begins with the start winding already dropped out (it must not sit
  // energized forever), and a zero threshold — the broken-start-winding knob — keeps the aux
  // out from the very first step even on an inertial machine.
  const initialOmega = mechanics === null ? lockedOmega : 0
  return {
    L,
    mechanics,
    lockedOmega,
    period,
    switchThreshold,
    switchClosed: Math.abs(initialOmega) < switchThreshold,
    flux: [0, 0, 0, 0],
    vCapRef: 0,
    omega: mechanics === null ? lockedOmega : 0,
    torque: 0,
    energized: false,
    vPrev: 0,
    stamp: null,
  }
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

/** The 4×4 flux state matrix at a frozen rotor speed, per-axis determinants and all. */
function spStateMatrix(L: SpInductances, omegaElectrical: number): number[][] {
  const { mainOhms: Rm, auxOhmsRef: Ra, rotorOhms: Rr } = L
  const { statorAlphaH: Lsa, statorBetaH: Lsb, rotorH: Lr, magnetizingH: Lm } = L
  const { detAlpha: Da, detBeta: Db } = L
  return [
    [(-Rm * Lr) / Da, 0, (Rm * Lm) / Da, 0],
    [0, (-Ra * Lr) / Db, 0, (Ra * Lm) / Db],
    [(Rr * Lm) / Da, 0, (-Rr * Lsa) / Da, -omegaElectrical],
    [0, (Rr * Lm) / Db, omegaElectrical, (-Rr * Lsb) / Db],
  ]
}

const spCurrents = (L: SpInductances, flux: number[]) => ({
  iAs: (L.rotorH * (flux[0] ?? 0) - L.magnetizingH * (flux[2] ?? 0)) / L.detAlpha,
  iBs: (L.rotorH * (flux[1] ?? 0) - L.magnetizingH * (flux[3] ?? 0)) / L.detBeta,
  iAr: (L.statorAlphaH * (flux[2] ?? 0) - L.magnetizingH * (flux[0] ?? 0)) / L.detAlpha,
  iBr: (L.statorBetaH * (flux[3] ?? 0) - L.magnetizingH * (flux[1] ?? 0)) / L.detBeta,
})

/**
 * Prepare the one-port Norton for the step ending one h after the last commit. STARTING mode
 * (switch closed): 5 states — trapezoid on the fluxes, backward-Euler on the referred cap; the
 * aux is mounted on −β (drive −v/a, port share −i_bs/a). RUNNING mode: 3 states, main only —
 * the β rotor keeps evolving, which IS the double revolving field.
 */
export function spStampMotor(core: SpMotorCore, h: number): SpStamp {
  const L = core.L
  const omegaElectrical = L.polePairs * core.omega
  const half = h / 2
  const a = L.turnsRatio

  if (core.switchClosed) {
    const A = spStateMatrix(L, omegaElectrical)
    // The marched cap state is the NEGATED referred voltage (−v_C/a): its sign here and in the
    // BE cap row below flip TOGETHER — changing either alone corrupts the physics (the port
    // behavior is identical either way; this convention just spares a third sign in bV).
    const bCap = [0, -1, 0, 0] // v′_C enters the β flux row
    const bV = [1, -1 / a, 0, 0] // the −β mounting: aux driven with −v/a
    // Rows 0..3: (I − (h/2)A)·λ′ − (h/2)·bCap·v′_C′ = λ + (h/2)(A·λ + bCap·v′_C + bV·v_n) + (h/2)bV·v′
    // Row 4 (BE cap): v′_C′ − h·(1/C′)·i_bs(λ′) = v′_C
    const gammaBeta = [0, L.rotorH / L.detBeta, 0, -L.magnetizingH / L.detBeta]
    const M: number[][] = []
    for (let r = 0; r < 4; r++) {
      const row: number[] = []
      for (let c = 0; c < 4; c++) row.push((r === c ? 1 : 0) - half * (A[r]?.[c] ?? 0))
      row.push(-half * (bCap[r] ?? 0))
      M.push(row)
    }
    M.push([...gammaBeta.map((g) => -h * L.invCapRef * g), 1])
    const rhsHist: number[] = []
    for (let r = 0; r < 4; r++) {
      let s = core.flux[r] ?? 0
      for (let c = 0; c < 4; c++) s += half * (A[r]?.[c] ?? 0) * (core.flux[c] ?? 0)
      s += half * (bCap[r] ?? 0) * core.vCapRef
      s += half * (bV[r] ?? 0) * core.vPrev
      rhsHist.push(s)
    }
    rhsHist.push(core.vCapRef)
    const rhsSens = [...bV.map((b) => half * b), 0]
    const [xKnown, xPerVolt] = solveSmall(M, [rhsHist, rhsSens]) as [number[], number[]]
    const portOf = (x: number[]) => {
      const i = spCurrents(L, x)
      return i.iAs - i.iBs / a
    }
    const stamp: SpStamp = {
      mode: 'starting',
      conductance: portOf(xPerVolt),
      historyCurrent: portOf(xKnown),
      xKnown,
      xPerVolt,
    }
    core.stamp = stamp
    return stamp
  }

  // Running (main only): states [λ_as, λ_ar, λ_br]; i_bs = 0, i_br = λ_br/L_r.
  const { mainOhms: Rm, rotorOhms: Rr } = L
  const { statorAlphaH: Lsa, rotorH: Lr, magnetizingH: Lm, detAlpha: Da } = L
  const A3 = [
    [(-Rm * Lr) / Da, (Rm * Lm) / Da, 0],
    [(Rr * Lm) / Da, (-Rr * Lsa) / Da, -omegaElectrical],
    [0, omegaElectrical, -Rr / Lr],
  ]
  const state3 = [core.flux[0], core.flux[2], core.flux[3]]
  const M: number[][] = []
  for (let r = 0; r < 3; r++) {
    const row: number[] = []
    for (let c = 0; c < 3; c++) row.push((r === c ? 1 : 0) - half * (A3[r]?.[c] ?? 0))
    M.push(row)
  }
  const bV3 = [1, 0, 0]
  const rhsHist: number[] = []
  for (let r = 0; r < 3; r++) {
    let s = state3[r] ?? 0
    for (let c = 0; c < 3; c++) s += half * (A3[r]?.[c] ?? 0) * (state3[c] ?? 0)
    s += half * (bV3[r] ?? 0) * core.vPrev
    rhsHist.push(s)
  }
  const rhsSens = bV3.map((b) => half * b)
  const [xKnown, xPerVolt] = solveSmall(M, [rhsHist, rhsSens]) as [number[], number[]]
  const iOf = (x: number[]) => (Lr * (x[0] ?? 0) - Lm * (x[1] ?? 0)) / Da
  const stamp: SpStamp = {
    mode: 'running',
    conductance: iOf(xPerVolt),
    historyCurrent: iOf(xKnown),
    xKnown,
    xPerVolt,
  }
  core.stamp = stamp
  return stamp
}

/** Commit the converged step from the solved port voltage; returns the port current. The
 *  centrifugal switch is decided HERE, from the committed speed, and takes effect at the next
 *  stamp — never inside the Newton loop. */
export function spCommitMotor(core: SpMotorCore, portVolts: number, h: number): number {
  const stamp = core.stamp
  if (stamp === null) return 0
  const L = core.L
  const x = stamp.xKnown.map((k, i) => k + (stamp.xPerVolt[i] ?? 0) * portVolts)
  let iPort: number
  if (stamp.mode === 'starting') {
    core.flux = [x[0] ?? 0, x[1] ?? 0, x[2] ?? 0, x[3] ?? 0]
    core.vCapRef = x[4] ?? 0
    const i = spCurrents(L, core.flux)
    core.torque = L.polePairs * L.magnetizingH * (i.iAr * i.iBs - i.iBr * i.iAs)
    iPort = i.iAs - i.iBs / L.turnsRatio
  } else {
    // λ_bs rides along as the dependent (L_m/L_r)·λ_br; v′_C stays frozen.
    core.flux = [x[0] ?? 0, (L.magnetizingH / L.rotorH) * (x[2] ?? 0), x[1] ?? 0, x[2] ?? 0]
    const iAs = (L.rotorH * (x[0] ?? 0) - L.magnetizingH * (x[1] ?? 0)) / L.detAlpha
    const iBr = (x[2] ?? 0) / L.rotorH
    core.torque = -L.polePairs * L.magnetizingH * iBr * iAs
    iPort = iAs
  }
  const mech = core.mechanics
  core.omega = mech === null ? core.lockedOmega : speedStep(core.omega, core.torque, mech, h)
  if (core.switchClosed && Math.abs(core.omega) >= core.switchThreshold) {
    // The start winding drops out: i_bs is forced to zero from the next stamp on; the rotor
    // flux linkages carry continuously (the cage is closed); the aux leakage energy is the
    // switch arc's (ideal-switch convention); v′_C freezes at its opening value.
    core.switchClosed = false
  }
  if (Math.abs(portVolts) > 1e-3) core.energized = true
  core.vPrev = portVolts
  return iPort
}

/** Seed the trapezoid's left edge from the t = 0 solve (the port sat at zero current). */
export function spInitMotor(core: SpMotorCore, portVolts: number): void {
  core.vPrev = portVolts
}
