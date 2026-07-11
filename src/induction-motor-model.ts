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
 * thirds of the drive period. Magnetic saturation, deep-bar/skin effect, and core loss are
 * unmodeled refinements. Sources: Tesla's 1888 polyphase patents; Steinmetz equivalent circuit;
 * Krause, "Analysis of Electric Machinery"; Fitzgerald, "Electric Machinery"; Chapman, "Electric
 * Machinery Fundamentals".
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
}

export type InductionMotorOperatingPoint = {
  /** Operating slip s (0 = synchronous, 1 = standstill). */
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

/** Thévenin equivalent seen by the rotor branch (folding in V1, R1, X1 and the magnetizing Xm). */
function thevenin(p: InductionMotorParams): { vTh: number; rTh: number; xTh: number } {
  const denom: Cx = { re: p.statorResistance, im: p.statorReactance + p.magnetizingReactance }
  const vTh = cAbs(cDiv({ re: 0, im: p.supplyVoltage * p.magnetizingReactance }, denom))
  const zTh = cDiv(
    cMul({ re: 0, im: p.magnetizingReactance }, { re: p.statorResistance, im: p.statorReactance }),
    denom,
  )
  return { vTh, rTh: zTh.re, xTh: zTh.im }
}

/**
 * Developed electromagnetic torque at a given slip (N·m) — the textbook Thévenin form for a
 * three-phase machine: T = 3·V_th²·(R2/s) / (ω_s·((R_th + R2/s)² + (X_th + X2)²)).
 */
export function electromagneticTorque(slip: number, p: InductionMotorParams): number {
  const wSync = synchronousSpeedRadPerSec(p.frequency, p.poles)
  if (!(wSync > 0) || slip <= 0) return 0
  const { vTh, rTh, xTh } = thevenin(p)
  const r2s = p.rotorResistance / slip
  const denom = (rTh + r2s) ** 2 + (xTh + p.rotorReactance) ** 2
  return denom > 0 ? (3 * vTh * vTh * r2s) / (wSync * denom) : 0
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
  const r2s = slip <= 0 ? 1e12 : p.rotorResistance / slip
  const rotor: Cx = { re: r2s, im: p.rotorReactance }
  const mag: Cx = { re: 0, im: p.magnetizingReactance }
  const parallel = cDiv(cMul(mag, rotor), cAdd(mag, rotor))
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

/** The slip at peak (breakdown) torque: s_max = R2 / sqrt(R_th² + (X_th + X2)²). */
function breakdownSlip(p: InductionMotorParams): number {
  const { rTh, xTh } = thevenin(p)
  const z = Math.sqrt(rTh * rTh + (xTh + p.rotorReactance) ** 2)
  return z > 0 ? p.rotorResistance / z : 1
}

/**
 * The steady-state operating point: the slip where the developed torque equals the load + friction,
 * found on the stable (low-slip) branch where torque rises with slip. If the load exceeds the
 * breakdown torque the motor cannot carry it and stalls (reported at s = 1, locked rotor).
 */
export function inductionMotorOperatingPoint(
  p: InductionMotorParams,
): InductionMotorOperatingPoint {
  const wSync = synchronousSpeedRadPerSec(p.frequency, p.poles)
  const sBreak = Math.min(1, breakdownSlip(p))
  const balance = (s: number) =>
    electromagneticTorque(s, p) - (p.loadTorque + p.viscousFriction * (1 - s) * wSync)
  let slip: number
  let stalled = false
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
  }
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
  }
}
