import type { Instance } from './cross-fk-validator.ts'
import { readScalarParam } from './instance-params.ts'

/**
 * Brushed DC motor — the electromechanical model. A motor is, electrically, a winding
 * (armature resistance R_a, inductance L_a) in series with a BACK-EMF source E = k·ω
 * that grows with the rotor speed ω; mechanically, the current makes a torque T = k·I
 * that spins the rotor up against friction and load (J·dω/dt = k·I − B·ω − T_load). The
 * same constant k is both the back-EMF constant (V·s/rad) and the torque constant
 * (N·m/A) — they are equal in SI by energy conservation (E·I = T·ω).
 *
 * At DC STEADY STATE (dω/dt = 0, dI/dt = 0) the whole coupled system collapses to a
 * single LINEAR result. From V = I·R_a + k·ω and k·I = B·ω + T_load:
 *   I = V / R_eff  +  (k·T_load)/(B·R_eff),   R_eff = R_a + k²/B
 * so the motor presents an EFFECTIVE RESISTANCE R_eff to the circuit — larger than R_a,
 * because the back-EMF opposes the supply. A free-spinning motor (small friction B)
 * draws far less than its stalled current V/R_a; load it down and it draws more, up to
 * the stall current V/R_a at zero speed. This file is that steady-state operating point;
 * the spin-up over time is the transient rung.
 */

export type MotorParams = {
  /** Armature (winding) resistance R_a, ohms. */
  armatureResistance: number
  /** Motor constant k — back-EMF constant (V·s/rad) AND torque constant (N·m/A). */
  motorConstant: number
  /** Viscous friction / damping B (N·m·s/rad) — sets the no-load speed and current. */
  viscousFriction: number
  /** External mechanical load torque T_load (N·m); 0 = free-running. */
  loadTorque: number
}

export type MotorOperatingPoint = {
  /** Armature current I (A). */
  current: number
  /** Angular speed ω (rad/s). */
  speed: number
  /** Shaft torque T = k·I (N·m). */
  torque: number
  /** Back-EMF E = k·ω (V). */
  backEmf: number
  /** Mechanical output power T·ω (W). */
  mechanicalPowerW: number
}

/**
 * R_eff = R_a + k²/B, the effective resistance a DC motor presents at steady state. The
 * back-EMF (rising with speed) bucks the supply, so a free-spinning motor draws far less
 * than its stalled R_a alone would suggest; R_eff captures exactly that. A frictionless
 * motor (B = 0) has no defined no-load speed, so this falls back to R_a (the solver
 * requires B > 0 — see motorParamsFromInstance).
 */
export function motorEffectiveResistance(p: MotorParams): number {
  if (!(p.viscousFriction > 0)) return p.armatureResistance
  return p.armatureResistance + (p.motorConstant * p.motorConstant) / p.viscousFriction
}

/** The constant extra current a mechanical load makes the motor draw (0 with no load). */
export function motorLoadCurrentOffset(p: MotorParams): number {
  if (!(p.viscousFriction > 0) || p.loadTorque === 0) return 0
  return (p.motorConstant * p.loadTorque) / (p.viscousFriction * motorEffectiveResistance(p))
}

/**
 * The full DC operating point from the solved terminal voltage. The current is linear in
 * V (I = V/R_eff + load offset); the speed follows from the torque balance
 * ω = (k·I − T_load)/B. Reversing the terminal voltage reverses the current and so the
 * rotation (ω < 0). A load above the stall torque would drive ω negative — beyond the
 * motor's capability — so keep T_load within the stall torque k·V/R_a.
 */
export function motorSteadyState(terminalVoltage: number, p: MotorParams): MotorOperatingPoint {
  const current = terminalVoltage / motorEffectiveResistance(p) + motorLoadCurrentOffset(p)
  const torque = p.motorConstant * current
  const speed = p.viscousFriction > 0 ? (torque - p.loadTorque) / p.viscousFriction : 0
  return {
    current,
    speed,
    torque,
    backEmf: p.motorConstant * speed,
    mechanicalPowerW: torque * speed,
  }
}

/** Read a motor's parameters off an instance (undefined if an essential one is missing or
 *  non-physical — R_a and B must be > 0 for a well-defined steady state). */
export function motorParamsFromInstance(inst: Instance): MotorParams | undefined {
  const armatureResistance = readScalarParam(inst, 'armature_resistance')
  const motorConstant = readScalarParam(inst, 'motor_constant')
  const viscousFriction = readScalarParam(inst, 'viscous_friction')
  if (
    armatureResistance === undefined ||
    motorConstant === undefined ||
    viscousFriction === undefined ||
    !(armatureResistance > 0) ||
    !(viscousFriction > 0)
  ) {
    return undefined
  }
  return {
    armatureResistance,
    motorConstant,
    viscousFriction,
    loadTorque: readScalarParam(inst, 'load_torque') ?? 0,
  }
}

// --- transient (spin-up over time) ---

/** Back-EMF E = k·ω (volts) at the given speed. */
export function motorBackEmf(motorConstant: number, speed: number): number {
  return motorConstant * speed
}

/**
 * One backward-Euler mechanical step: J·dω/dt = k·I − B·ω − T_load, solved
 * semi-implicitly in ω (the damping term taken implicit, so it is stable at any step
 * size). This is what makes the motor SPIN UP over time — the rotor's inertia J means
 * the speed (and so the back-EMF) ramps, which is why a motor draws a big inrush current
 * at switch-on and then settles as it comes up to speed.
 */
export function motorSpeedStep(
  speedPrev: number,
  current: number,
  motorConstant: number,
  viscousFriction: number,
  rotorInertia: number,
  loadTorque: number,
  dt: number,
): number {
  if (!(rotorInertia > 0) || !(dt > 0)) return speedPrev
  const drivingTorque = motorConstant * current - loadTorque
  return (
    (speedPrev + (dt * drivingTorque) / rotorInertia) / (1 + (dt * viscousFriction) / rotorInertia)
  )
}
