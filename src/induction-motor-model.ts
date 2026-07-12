/**
 * Three-phase induction (asynchronous) motor — Tesla's rotating-field machine (1888), modeled by
 * its per-phase equivalent circuit (the Steinmetz model — the standard steady-state analysis).
 *
 * A polyphase stator winding makes a magnetic field that ROTATES at the synchronous speed
 * n_s = 120·f / poles (rpm). The rotor — a shorted "squirrel cage" — is dragged along, but always
 * LAGS by the slip s = (n_s − n) / n_s. That lag is the whole point: it is the relative motion that
 * induces the rotor currents (Faraday) which, in the rotating field, make the torque (Lorentz). At
 * exactly synchronous speed (s = 0) there is no relative motion, no induced current, and no torque —
 * so an induction motor MUST run a little slow, and the harder you load it the more it slips.
 *
 * Per phase, referred to the stator: the supply V1 drives the stator R1 + jX1, then the parallel of
 * the magnetizing jXm and the rotor branch R2/s + jX2. The R2/s term carries the speed dependence:
 * at standstill (s = 1) the rotor branch is low-impedance, so the motor gulps a big LOCKED-ROTOR
 * (starting) current — typically 5–7× its running current — and that current tapers as it comes up
 * to speed and R2/s grows. The electromagnetic torque is the air-gap power over the synchronous
 * speed, T = 3·I2²·(R2/s) / ω_s, which rises with slip to a BREAKDOWN (pull-out) torque, then falls.
 *
 * Honest scope: THIS module is the steady-state per-phase analysis at the nameplate supply (the
 * way induction motors are rated and read) — it solves for the operating slip where the torque
 * meets the load, and powers the live readings (speed, slip, torque, currents, efficiency, power
 * factor) and the stall check. In the TIME-DOMAIN solve the motor is the dq (stationary-frame)
 * DYNAMIC model (induction-motor-dq.ts): given a rotor_inertia the rotor genuinely spins up from
 * rest — the locked-rotor inrush, the torque climbing the torque–slip curve, the current tapering
 * as the slip settles where torque meets load — and the marched steady state reduces exactly to
 * this module's phasor circuit. The dynamic model is frequency- and waveform-agnostic (reactances
 * convert to inductances once, at the nameplate frequency), so an off-nameplate drive is marched
 * honestly; the solver still warns that the READINGS panel assumes the nameplate. Without a
 * rotor_inertia the rotor is held at the nameplate operating speed (the quasi-static behavior,
 * kept for old saved circuits) and the solver says so. At DC the machine makes no torque and
 * degenerates to exactly the stator winding resistance R1 the DC solver stamps (the two engines
 * agree on any DC content). Self-heating and thermal protection are unmodeled (no θ_JA is
 * shipped; NOTE for whoever adds one: the terminal power Σv·i is the INPUT power, ~80 % of which
 * leaves as mechanical output at rated load — heat is P_in − P_mech, never the whole terminal
 * ledger). A balanced THREE-phase machine is assumed: the two-terminal canvas port carries ONE
 * phase, and the dynamic model synthesizes the two unseen phases as the port waveform delayed by
 * thirds of the drive period. Magnetic saturation of the magnetizing branch runs in the
 * time-domain model when the part carries its magnetization curve (magnetizing_knee_flux +
 * saturated_magnetizing_reactance — see induction-motor-dq.ts); THIS module's steady analysis
 * stays linear at the catalog Xm (the rated-point chord), consistent for knees at or above rated
 * flux. DEEP-BAR/SKIN EFFECT is modeled when the part carries a second rotor cage
 * (rotor_resistance_2 + rotor_reactance_2): the rotor branch becomes the two cages in parallel —
 * at standstill the inner cage's high leakage chokes it and the current takes the high-R outer
 * path (the strong starting torque of NEMA design B/C machines); at running slip they act as
 * parallel resistances (efficient). The double-cage torque curve is NOT single-peaked (pull-out
 * max → pull-up DIP → rise to standstill), so its operating point comes from a multi-root-aware
 * stable-crossing search, and a start that hangs below the dip is reported as CRAWLING. CORE
 * LOSS is modeled when the part carries core_loss_resistance: R_c sits in parallel with the
 * magnetizing branch (hysteresis + eddy loss driven by the changing magnetizing flux — it draws
 * nothing at DC), the Thévenin folds it in, the developed torque still excludes it (R_c
 * dissipates on the stator side of the air gap), and the input power/efficiency pick it up
 * automatically. Sources: Tesla's 1888
 * polyphase patents; Steinmetz equivalent circuit; Krause, "Analysis of Electric Machinery";
 * Fitzgerald, "Electric Machinery"; Chapman, "Electric Machinery Fundamentals".
 */

import type { Instance } from './cross-fk-validator.ts'
import { readEnumParam, readScalarParam } from './instance-params.ts'

export type InductionMotorParams = {
  /** Per-phase supply voltage, RMS (V). */
  supplyVoltage: number
  /** Line frequency (Hz). */
  frequency: number
  /** Pole count (even). */
  poles: number
  /** Stator resistance R1 (Ω). */
  statorResistance: number
  /** Stator leakage reactance X1 (Ω, at the line frequency). */
  statorReactance: number
  /** Rotor resistance R2 referred to the stator (Ω). */
  rotorResistance: number
  /** Rotor leakage reactance X2 referred to the stator (Ω). */
  rotorReactance: number
  /** Magnetizing reactance Xm (Ω). */
  magnetizingReactance: number
  /** Shaft load torque T_load (N·m). */
  loadTorque: number
  /** Viscous friction / windage B (N·m·s/rad). */
  viscousFriction: number
  /** Magnetizing saturation knee — the PEAK resultant magnetizing flux linkage (V·s) where the
   *  core leaves the linear region. Optional; with saturatedMagnetizingReactance it activates
   *  the two-slope magnetization curve in the time-domain model. */
  kneeFluxVs?: number
  /** The incremental magnetizing slope ABOVE the knee, as a reactance at the nameplate
   *  frequency (Ω). Optional — see kneeFluxVs. */
  saturatedMagnetizingReactance?: number
  /** Second (inner/running) rotor cage resistance referred to the stator (Ω). Optional; with
   *  rotorReactance2 it activates the DOUBLE-CAGE deep-bar model: the existing rotor params
   *  become the outer (starting) cage — high R, low leakage — and this inner cage carries the
   *  running current. */
  rotorResistance2?: number
  /** Second rotor cage leakage reactance at the nameplate frequency, referred (Ω). Optional —
   *  see rotorResistance2. The inner cage sits deep in the slot, so its leakage is HIGH: that
   *  is what chokes it at standstill and routes the starting current through the outer cage. */
  rotorReactance2?: number
  /** Core-loss (iron-loss) resistance R_c (Ω, per phase, referred), in PARALLEL with the
   *  magnetizing branch — hysteresis + eddy loss driven by the changing magnetizing flux.
   *  Optional; activates the iron branch in both the readings and the time-domain model. */
  coreLossResistance?: number
}

export type InductionMotorOperatingPoint = {
  /** Operating slip s (0 = synchronous, 1 = standstill) — for a double-cage machine, the point
   *  a from-rest start actually reaches (the highest-slip STABLE torque-balance root). */
  slip: number
  /** Synchronous speed (rpm). */
  synchronousRpm: number
  /** Rotor speed (rpm). */
  rotorRpm: number
  /** Developed torque (N·m). */
  torque: number
  /** Running stator current, RMS per phase (A). */
  statorCurrentRms: number
  /** Locked-rotor (starting) current at s = 1, RMS per phase (A) — the inrush. */
  startupCurrentRms: number
  /** Power factor (0..1). */
  powerFactor: number
  /** Net mechanical output power (W). */
  mechanicalPowerW: number
  /** Electrical input power, all three phases (W). */
  inputPowerW: number
  /** Efficiency (0..1). */
  efficiency: number
  /** True if the load exceeds the breakdown torque — the motor cannot run it (stalls). */
  stalled: boolean
  /** Double-cage CRAWLING: a better (lower-slip) stable running point exists, but the torque
   *  DIP between the two cages' peaks sits below the load, so a from-rest start cannot reach
   *  it — the machine hangs at the reported high-slip root (the classic pull-up-torque
   *  failure). Absent on single-cage machines and clean double-cage starts. */
  crawlBetterSlip?: number
}

/** Synchronous mechanical speed ω_s = 4πf / poles (rad/s) — i.e. 120·f/poles in rpm. */
export function synchronousSpeedRadPerSec(frequency: number, poles: number): number {
  if (!(poles > 0)) return 0
  return (4 * Math.PI * frequency) / poles
}

// --- a tiny complex helper (the per-phase circuit is phasor algebra) ---
type Cx = { re: number; im: number }
const cMul = (a: Cx, b: Cx): Cx => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
})
const cAdd = (a: Cx, b: Cx): Cx => ({ re: a.re + b.re, im: a.im + b.im })
const cDiv = (a: Cx, b: Cx): Cx => {
  const d = b.re * b.re + b.im * b.im
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }
}
const cAbs = (a: Cx): number => Math.hypot(a.re, a.im)

/** The validated second (inner) rotor cage, or null — the ONE activation predicate every
 *  consumer shares (readings, dq inductances, warnings). Both parameters present and positive;
 *  the inner cage's leakage must be positive (an unchoked X2b = 0 branch would carry the
 *  starting current and defeat the deep-bar physics the second cage exists to model). */
export function doubleCageFromParams(
  p: InductionMotorParams,
): { rotorResistance2: number; rotorReactance2: number } | null {
  const r2b = p.rotorResistance2
  const x2b = p.rotorReactance2
  if (r2b === undefined || x2b === undefined) return null
  if (!(r2b > 0) || !(x2b > 0)) return null
  return { rotorResistance2: r2b, rotorReactance2: x2b }
}

/** A note when the double-cage parameters cannot activate — exactly one given, or non-physical
 *  values. Null when the pair is absent (single cage, no note needed) or valid. */
export function deepBarParamsNote(id: string, p: InductionMotorParams): string | null {
  if (p.rotorResistance2 === undefined && p.rotorReactance2 === undefined) return null
  if (doubleCageFromParams(p) !== null) return null
  return (
    `Induction motor '${id}': the deep-bar double cage needs BOTH rotor_resistance_2 (> 0) and ` +
    'rotor_reactance_2 (> 0) — the rotor stays a single cage'
  )
}

/** The validated core-loss resistance, or null — the ONE activation predicate every consumer
 *  shares. R_c must be positive, and every winding in play needs real leakage AND a real
 *  magnetizing branch (X1, X2, Xm > 0; plus the inner cage's leakage when the double cage is
 *  active) — the dynamic iron-loss formulation reads each winding current off its own leakage
 *  flux and the magnetizing current off L_m. */
export function coreLossFromParams(p: InductionMotorParams): { coreLossOhms: number } | null {
  const rc = p.coreLossResistance
  if (rc === undefined) return null
  if (!(rc > 0)) return null
  if (!(p.statorReactance > 0) || !(p.rotorReactance > 0) || !(p.magnetizingReactance > 0))
    return null
  return { coreLossOhms: rc }
}

/** A note when core_loss_resistance is present but cannot activate. Null when absent or valid. */
export function coreLossParamsNote(id: string, p: InductionMotorParams): string | null {
  if (p.coreLossResistance === undefined) return null
  if (coreLossFromParams(p) !== null) return null
  return (
    `Induction motor '${id}': core loss needs core_loss_resistance > 0 and real leakage + ` +
    'magnetizing reactances (X1, X2, Xm all > 0) — the iron stays lossless'
  )
}

/** The rotor branch of the equivalent circuit at slip s: the single cage R2/s + jX2, or — when
 *  the second cage is active — the two cages in PARALLEL. The parallel combination IS the
 *  deep-bar physics in phasor form: at s = 1 the inner cage's high leakage chokes it and the
 *  current takes the high-R outer path (strong starting torque); at running slip both branches
 *  are nearly resistive and act in parallel (low R, efficient). Single-cage machines take the
 *  same literal operations as before (bit-identical requirement). */
function rotorBranchImpedance(slip: number, p: InductionMotorParams): Cx {
  const cage2 = doubleCageFromParams(p)
  if (cage2 === null) {
    // The literal single-cage arithmetic (same clamp, same operations — bit-identical).
    return { re: slip <= 0 ? 1e12 : p.rotorResistance / slip, im: p.rotorReactance }
  }
  const s = slip <= 0 ? 1e-12 : slip
  const outer: Cx = { re: p.rotorResistance / s, im: p.rotorReactance }
  const inner: Cx = { re: cage2.rotorResistance2 / s, im: cage2.rotorReactance2 }
  return cDiv(cMul(outer, inner), cAdd(outer, inner))
}

/** Thévenin equivalent seen by the rotor branch (folding in V1, R1, X1 and the magnetizing Xm). */
function thevenin(p: InductionMotorParams): { vTh: number; rTh: number; xTh: number } {
  const coreLoss = coreLossFromParams(p)
  if (coreLoss === null) {
    // The lossless literal arithmetic (bit-identical without core_loss_resistance).
    const denom: Cx = { re: p.statorResistance, im: p.statorReactance + p.magnetizingReactance }
    const vTh = cAbs(cDiv({ re: 0, im: p.supplyVoltage * p.magnetizingReactance }, denom))
    const zTh = cDiv(
      cMul(
        { re: 0, im: p.magnetizingReactance },
        { re: p.statorResistance, im: p.statorReactance },
      ),
      denom,
    )
    return { vTh, rTh: zTh.re, xTh: zTh.im }
  }
  // With the iron branch the shunt is Z_sh = R_c ∥ jXm — the same fold, complex-general. The
  // Thévenin torque form downstream stays exact: it needs only |v_Th| and Z_Th, and the power
  // into Z_rot is still the whole air-gap power (R_c dissipates on the stator side of the gap).
  const mag: Cx = { re: 0, im: p.magnetizingReactance }
  const rc: Cx = { re: coreLoss.coreLossOhms, im: 0 }
  const zSh = cDiv(cMul(rc, mag), cAdd(rc, mag))
  const z1: Cx = { re: p.statorResistance, im: p.statorReactance }
  const denom = cAdd(z1, zSh)
  const vTh = cAbs(cDiv(cMul({ re: p.supplyVoltage, im: 0 }, zSh), denom))
  const zTh = cDiv(cMul(zSh, z1), denom)
  return { vTh, rTh: zTh.re, xTh: zTh.im }
}

/**
 * Developed electromagnetic torque at a given slip (N·m) — the Thévenin form generalized to a
 * complex rotor branch: T = 3·V_th²·Re(Z_rot(s)) / (ω_s·|Z_th + Z_rot(s)|²). Exact because every
 * rotor resistance enters the branch as R/s, so the air-gap power 3·|I|²·Re(Z_rot) splits
 * (1−s):s into mechanical power and rotor copper loss branch by branch. For the single cage
 * Z_rot = R2/s + jX2 and this is literally the textbook
 * T = 3·V_th²·(R2/s) / (ω_s·((R_th + R2/s)² + (X_th + X2)²)) — the same operations in the same
 * order as before the double cage existed (bit-identical).
 */
export function electromagneticTorque(slip: number, p: InductionMotorParams): number {
  const wSync = synchronousSpeedRadPerSec(p.frequency, p.poles)
  if (!(wSync > 0) || slip <= 0) return 0
  const { vTh, rTh, xTh } = thevenin(p)
  const zRot = rotorBranchImpedance(slip, p)
  const denom = (rTh + zRot.re) ** 2 + (xTh + zRot.im) ** 2
  return denom > 0 ? (3 * vTh * vTh * zRot.re) / (wSync * denom) : 0
}

/**
 * The per-phase INPUT impedance of the equivalent circuit at a given slip: Z_in = R1 + jX1 + the
 * parallel of jXm and (R2/s + jX2) — the steady-state readings' source of truth (current + power
 * factor below). The time-domain solve marches the dq dynamic model (induction-motor-dq.ts),
 * whose settled steady state reduces exactly to this impedance at the drive frequency.
 */
export function inputImpedanceAtSlip(
  slip: number,
  p: InductionMotorParams,
): { resistance: number; reactance: number } {
  const rotor = rotorBranchImpedance(slip, p)
  const mag: Cx = { re: 0, im: p.magnetizingReactance }
  const coreLoss = coreLossFromParams(p)
  if (coreLoss === null) {
    // The lossless literal arithmetic (bit-identical without core_loss_resistance).
    const parallel = cDiv(cMul(mag, rotor), cAdd(mag, rotor))
    const zIn = cAdd({ re: p.statorResistance, im: p.statorReactance }, parallel)
    return { resistance: zIn.re, reactance: zIn.im }
  }
  // Three-way shunt R_c ∥ jXm ∥ Z_rot(s) by admittance sum — the input current, power factor
  // and so the input power (and efficiency) pick up the core loss with no further change.
  const yShunt = cAdd(
    cAdd(cDiv({ re: 1, im: 0 }, { re: coreLoss.coreLossOhms, im: 0 }), cDiv({ re: 1, im: 0 }, mag)),
    cDiv({ re: 1, im: 0 }, rotor),
  )
  const parallel = cDiv({ re: 1, im: 0 }, yShunt)
  const zIn = cAdd({ re: p.statorResistance, im: p.statorReactance }, parallel)
  return { resistance: zIn.re, reactance: zIn.im }
}

/** Per-phase stator current magnitude (RMS, A) and power factor at a given slip. */
function statorCurrentAndPf(
  slip: number,
  p: InductionMotorParams,
): { current: number; powerFactor: number } {
  const { resistance, reactance } = inputImpedanceAtSlip(slip, p)
  const zMag = Math.hypot(resistance, reactance)
  if (!(zMag > 0)) return { current: 0, powerFactor: 0 }
  return { current: p.supplyVoltage / zMag, powerFactor: resistance / zMag }
}

/** The slip at peak (breakdown) torque: s_max = R2 / sqrt(R_th² + (X_th + X2)²). Single-cage
 *  closed form — the double-cage path never uses it (its torque curve is not single-peaked). */
function breakdownSlip(p: InductionMotorParams): number {
  const { rTh, xTh } = thevenin(p)
  const z = Math.sqrt(rTh * rTh + (xTh + p.rotorReactance) ** 2)
  return z > 0 ? p.rotorResistance / z : 1
}

/** The deterministic slip grid the double-cage root search walks: log-spaced through the
 *  low-slip running region, linear through the rest, always ending exactly at s = 1. */
function doubleCageSlipGrid(): number[] {
  const grid: number[] = []
  for (let i = 0; i < 160; i++) grid.push(10 ** (-5 + (4 * i) / 159))
  for (let j = 1; j <= 240; j++) grid.push(0.1 + (0.9 * j) / 240)
  return grid
}

/**
 * The double-cage machine's operating slip. Its torque–slip curve is NOT single-peaked — the
 * parallel two-cage network generically makes pull-out maximum → pull-up DIP → a second rise
 * toward standstill (the dip is why NEMA defines pull-up torque) — so T(s) = T_load can have
 * several roots and a bisection bracketed by the global peak picks one arbitrarily. Instead:
 * evaluate the balance on a fixed grid, classify every sign change by direction (torque rising
 * through the load as s increases = STABLE — the from-rest march settles there; falling =
 * unstable), and report the HIGHEST-slip stable root when the machine can start (that is where
 * a from-rest start actually lands, so the readings agree with the settled march by
 * construction). A lower-slip stable root that also exists is the classic CRAWL: a better
 * running point the start cannot reach through the dip — reported, not hidden. When the
 * starting torque cannot lift the load (balance ≤ 0 at s = 1) the lowest-slip stable root is
 * reported as the steady running point — the same convention as the single-cage machine, whose
 * readings also show the running point while the march surfaces did-NOT-start.
 */
function doubleCageOperatingSlip(balance: (s: number) => number): {
  slip: number
  stalled: boolean
  crawlBetterSlip?: number
} {
  const grid = doubleCageSlipGrid()
  const b = grid.map(balance)
  if (b.every((v) => v <= 0)) return { slip: 1, stalled: true } // load beyond every torque
  const refine = (lo0: number, hi0: number): number => {
    let lo = lo0
    let hi = hi0
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2
      if (balance(mid) > 0) hi = mid
      else lo = mid
    }
    return (lo + hi) / 2
  }
  const stableRoots: number[] = []
  for (let k = 0; k + 1 < grid.length; k++) {
    const b0 = b[k] ?? 0
    const b1 = b[k + 1] ?? 0
    if (b0 <= 0 && b1 > 0) stableRoots.push(refine(grid[k] ?? 0, grid[k + 1] ?? 1))
  }
  if (stableRoots.length === 0) return { slip: 1e-5, stalled: false } // essentially no load
  const lowest = stableRoots[0] ?? 1e-5
  const highest = stableRoots[stableRoots.length - 1] ?? lowest
  const canStart = (b[b.length - 1] ?? 0) > 0
  if (!canStart) return { slip: lowest, stalled: false }
  if (stableRoots.length > 1) return { slip: highest, stalled: false, crawlBetterSlip: lowest }
  return { slip: highest, stalled: false }
}

/**
 * The steady-state operating point: the slip where the developed torque equals the load + friction,
 * found on the stable (low-slip) branch where torque rises with slip. If the load exceeds the
 * breakdown torque the motor cannot carry it and stalls (reported at s = 1, locked rotor). A
 * double-cage machine takes the multi-root-aware grid search above; the single cage keeps this
 * closed-form + bisection path verbatim (bit-identical without the cage-2 parameters).
 */
export function inductionMotorOperatingPoint(
  p: InductionMotorParams,
): InductionMotorOperatingPoint {
  const wSync = synchronousSpeedRadPerSec(p.frequency, p.poles)
  const balance = (s: number) =>
    electromagneticTorque(s, p) - (p.loadTorque + p.viscousFriction * (1 - s) * wSync)
  let slip: number
  let stalled = false
  let crawlBetterSlip: number | undefined
  if (doubleCageFromParams(p) !== null) {
    const found = doubleCageOperatingSlip(balance)
    slip = found.slip
    stalled = found.stalled
    crawlBetterSlip = found.crawlBetterSlip
  } else {
    const sBreak = Math.min(1, breakdownSlip(p))
    if (balance(sBreak) <= 0) {
      slip = 1 // the load exceeds breakdown — the motor stalls at locked rotor
      stalled = true
    } else if (balance(1e-5) >= 0) {
      slip = 1e-5 // essentially no load → runs at synchronous speed
    } else {
      let lo = 1e-5
      let hi = sBreak
      for (let i = 0; i < 80; i++) {
        const mid = (lo + hi) / 2
        if (balance(mid) > 0) hi = mid
        else lo = mid
      }
      slip = (lo + hi) / 2
    }
  }
  const omega = (1 - slip) * wSync
  const torque = electromagneticTorque(slip, p)
  const { current, powerFactor } = statorCurrentAndPf(slip, p)
  const startupCurrentRms = statorCurrentAndPf(1, p).current
  const mechanicalGrossW = torque * omega
  const frictionLossW = p.viscousFriction * omega * omega
  const mechanicalPowerW = Math.max(0, mechanicalGrossW - frictionLossW)
  const inputPowerW = 3 * p.supplyVoltage * current * powerFactor
  const efficiency = inputPowerW > 0 ? mechanicalPowerW / inputPowerW : 0
  const toRpm = (60 * wSync) / (2 * Math.PI)
  return {
    slip,
    synchronousRpm: toRpm,
    rotorRpm: (1 - slip) * toRpm,
    torque,
    statorCurrentRms: current,
    startupCurrentRms,
    powerFactor,
    mechanicalPowerW,
    inputPowerW,
    efficiency,
    stalled,
    ...(crawlBetterSlip !== undefined ? { crawlBetterSlip } : {}),
  }
}

/** A note when a double-cage machine CRAWLS — it starts, but hangs at a high-slip stable point
 *  because the torque dip between the two cages' peaks sits below the load; the better running
 *  point exists and cannot be reached from rest. Null otherwise. */
export function crawlNote(id: string, op: InductionMotorOperatingPoint): string | null {
  const better = op.crawlBetterSlip
  if (better === undefined) return null
  return (
    `Induction motor '${id}' CRAWLS: its double-cage torque curve dips below the load between ` +
    `the two cages' peaks, so a from-rest start hangs at ${(op.slip * 100).toPrecision(3)}% ` +
    `slip (${op.rotorRpm.toFixed(0)} RPM) drawing heavy current — the better running point ` +
    `near ${(better * 100).toPrecision(3)}% slip cannot be reached from rest (the classic ` +
    'pull-up-torque failure; reduce the load to pass through the dip)'
  )
}

/** True when the instance declares a delta-connected stator (the three-phase part's
 *  stator_connection parameter; absent or anything else ⇒ wye). Gated on the definition that
 *  declares the parameter: a stray stator_connection on any other part must never split the
 *  engines (only some consumers of the shared params reader would see the referral). */
export function statorIsDelta(inst: Instance): boolean {
  return (
    inst.definition === 'induction_motor_three_phase' &&
    readEnumParam(inst, 'stator_connection') === 'delta'
  )
}

/**
 * Read an induction motor's parameters off an instance. Undefined when an essential one is missing
 * or non-physical (a defined supply, frequency, poles and the equivalent-circuit values).
 *
 * The impedance parameters are entered PER WINDING — the coils as wound. A DELTA-connected stator
 * (stator_connection on the three-phase part) is referred to its exact equivalent wye by dividing
 * every winding impedance by 3 (the textbook Δ→Y referral, exact for three identical windings at
 * any excitation), so every consumer — the steady-state operating point, the dq inductances, the
 * DC stamp — sees one consistent machine. That is why the same coils deliver 3× the starting
 * torque (and pull 3× the line current) in delta: each winding sees the full line-to-line
 * voltage instead of its 1/√3 share.
 */
export function inductionMotorParamsFromInstance(inst: Instance): InductionMotorParams | undefined {
  const supplyVoltage = readScalarParam(inst, 'supply_voltage')
  const frequency = readScalarParam(inst, 'line_frequency')
  const poles = readScalarParam(inst, 'pole_count')
  const statorResistance = readScalarParam(inst, 'stator_resistance')
  const statorReactance = readScalarParam(inst, 'stator_reactance')
  const rotorResistance = readScalarParam(inst, 'rotor_resistance')
  const rotorReactance = readScalarParam(inst, 'rotor_reactance')
  const magnetizingReactance = readScalarParam(inst, 'magnetizing_reactance')
  if (
    supplyVoltage === undefined ||
    frequency === undefined ||
    poles === undefined ||
    statorResistance === undefined ||
    statorReactance === undefined ||
    rotorResistance === undefined ||
    rotorReactance === undefined ||
    magnetizingReactance === undefined ||
    !(frequency > 0) ||
    !(poles > 0) ||
    !(rotorResistance > 0)
  ) {
    return undefined
  }
  const refer = statorIsDelta(inst) ? 1 / 3 : 1
  // The saturation curve refers with the winding: inductance slopes like every impedance (÷3 in
  // delta), but the knee is a FLUX LINKAGE — the equivalent-wye winding sees the delta winding's
  // voltage ÷√3, and λ = ∫v·dt, so the knee refers ÷√3 (i_knee then refers ×√3, keeping
  // L = λ/i consistent with the impedance referral).
  const kneeFluxVs = readScalarParam(inst, 'magnetizing_knee_flux')
  const saturatedXm = readScalarParam(inst, 'saturated_magnetizing_reactance')
  // The second (inner) rotor cage and the core-loss resistance refer like every impedance:
  // plain ÷3 in delta.
  const rotorResistance2 = readScalarParam(inst, 'rotor_resistance_2')
  const rotorReactance2 = readScalarParam(inst, 'rotor_reactance_2')
  const coreLossResistance = readScalarParam(inst, 'core_loss_resistance')
  return {
    supplyVoltage,
    frequency,
    poles,
    statorResistance: statorResistance * refer,
    statorReactance: statorReactance * refer,
    rotorResistance: rotorResistance * refer,
    rotorReactance: rotorReactance * refer,
    magnetizingReactance: magnetizingReactance * refer,
    loadTorque: readScalarParam(inst, 'load_torque') ?? 0,
    viscousFriction: readScalarParam(inst, 'viscous_friction') ?? 0,
    ...(kneeFluxVs !== undefined ? { kneeFluxVs: kneeFluxVs * Math.sqrt(refer) } : {}),
    ...(saturatedXm !== undefined ? { saturatedMagnetizingReactance: saturatedXm * refer } : {}),
    ...(rotorResistance2 !== undefined ? { rotorResistance2: rotorResistance2 * refer } : {}),
    ...(rotorReactance2 !== undefined ? { rotorReactance2: rotorReactance2 * refer } : {}),
    ...(coreLossResistance !== undefined ? { coreLossResistance: coreLossResistance * refer } : {}),
  }
}

/** The validated magnetization curve, or null — the ONE activation predicate every consumer
 *  (the dq inductance builder and the warning below) shares: both parameters present, the knee
 *  positive, the saturated slope positive and strictly below the unsaturated Xm (saturation
 *  only ever LOWERS the magnetizing inductance). */
export function saturationCurveFromParams(
  p: InductionMotorParams,
): { kneeFluxVs: number; saturatedXm: number } | null {
  const knee = p.kneeFluxVs
  const satX = p.saturatedMagnetizingReactance
  if (knee === undefined || satX === undefined) return null
  if (!(knee > 0) || !(satX > 0) || !(satX < p.magnetizingReactance)) return null
  return { kneeFluxVs: knee, saturatedXm: satX }
}

/** A note when the saturation parameters cannot activate — exactly one given, or non-physical
 *  values. Null when the pair is absent (the linear model, no note needed) or valid. */
export function saturationParamsNote(id: string, p: InductionMotorParams): string | null {
  if (p.kneeFluxVs === undefined && p.saturatedMagnetizingReactance === undefined) return null
  if (saturationCurveFromParams(p) !== null) return null
  return (
    `Induction motor '${id}': magnetizing saturation needs BOTH magnetizing_knee_flux (> 0) and ` +
    'saturated_magnetizing_reactance (> 0, below the unsaturated Xm) — the magnetizing branch ' +
    'stays linear'
  )
}

/** A note when the machine saturates at its own NAMEPLATE drive (the knee sits below the rated
 *  peak flux V·√2/ω): real machines commonly do (Hinkkanen et al. 2010), but the READINGS panel
 *  is the linear analysis at the catalog Xm — the marched current will read above it. */
export function saturatedAtNameplateNote(id: string, p: InductionMotorParams): string | null {
  const curve = saturationCurveFromParams(p)
  if (curve === null) return null
  const ratedPeakFlux = (p.supplyVoltage * Math.SQRT2) / (2 * Math.PI * p.frequency)
  if (curve.kneeFluxVs >= ratedPeakFlux) return null
  return (
    `Induction motor '${id}': its magnetization knee (${curve.kneeFluxVs.toPrecision(3)} V·s) ` +
    `sits below the rated peak flux (${ratedPeakFlux.toPrecision(3)} V·s) — the machine ` +
    'saturates at its nameplate drive, so the time-domain current will read above the READINGS ' +
    "panel's linear analysis (which uses the catalog Xm)"
  )
}
