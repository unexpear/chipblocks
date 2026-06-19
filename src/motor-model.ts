import type { Instance } from './cross-fk-validator.ts'
import { readEnumParam, readScalarParam } from './instance-params.ts'
import { awgAreaM2, COPPER_RESISTIVITY_OHM_M } from './wire-gauge.ts'

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
 * the stall current V/R_a at zero speed.
 *
 * TWO DEPTHS (design_mode): in "block" mode the lumped constants (k, R_a, B, L_a, J) are
 * direct params — use the motor as a black box. In "design" mode k, R_a and J DERIVE from
 * the real assembly — the magnet + core + air gap set the field, the winding (turns +
 * wire gauge) + rotor geometry set the rest — so changing the iron, magnets or winding
 * changes the behaviour (the "open it up and design it" view).
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
  /** Armature inductance L_a (henries) — for the transient spin-up. */
  armatureInductance?: number
  /** Rotor moment of inertia J (kg·m²) — for the transient spin-up. */
  rotorInertia?: number
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

// --- design-it: derive the lumped constants from the real assembly ---

/**
 * Geometry/winding factor folding the pole count, parallel paths and winding
 * distribution of a real DC machine (k = p·Z·Φ/2πa) into one number, so the simplified
 * k = factor·N·B_gap·D·L below lands at a realistic value. Calibrated so the shipped
 * design (≈0.34 T gap, 500 turns, a 22 × 25 mm rotor) gives k ≈ 0.02 V·s/rad.
 */
const MOTOR_CONSTANT_GEOMETRY = 0.216

/**
 * Air-gap flux density from a permanent magnet driving flux across the gap, through the
 * core — a simplified PM load-line. The remanence B_r is cut by how much of the magnetic
 * path is the (high-reluctance) air gap rather than the magnet (gapFactor), and by a poor
 * core that leaks flux instead of carrying it (coreFactor → 1 for high-μ iron, → ~0 for
 * an air / plastic core). Honest scope: ignores magnet recoil, leakage and saturation;
 * directionally correct — a thicker magnet, smaller gap, or better iron → a stronger field.
 */
export function airGapFluxDensityTesla(
  remanenceTesla: number,
  magnetLengthM: number,
  airGapM: number,
  coreRelativePermeability: number,
): number {
  const path = magnetLengthM + airGapM
  if (!(path > 0)) return 0
  const gapFactor = magnetLengthM / path
  const coreFactor =
    coreRelativePermeability > 0 ? coreRelativePermeability / (coreRelativePermeability + 50) : 0
  return Math.max(0, remanenceTesla) * gapFactor * coreFactor
}

/**
 * Motor constant k (= torque & back-EMF constant) from the winding, field and rotor:
 * k = factor·N·B_gap·D·L. More turns, a stronger air-gap field, or a bigger rotor
 * (diameter × stack length) all raise the torque per amp.
 */
export function motorConstantFromDesign(
  turns: number,
  airGapFluxTesla: number,
  rotorDiameterM: number,
  stackLengthM: number,
): number {
  return MOTOR_CONSTANT_GEOMETRY * turns * airGapFluxTesla * rotorDiameterM * stackLengthM
}

/**
 * Armature resistance from the winding — the wire law R = ρ·length/area. The wire is N
 * turns, each ~2·(stack + diameter) long (once around the rotor), of the cross-section
 * the gauge sets (copper). More turns or thinner wire → more resistance.
 */
export function armatureResistanceFromDesign(
  turns: number,
  rotorDiameterM: number,
  stackLengthM: number,
  wireAreaM2: number,
): number {
  if (!(wireAreaM2 > 0)) return Number.POSITIVE_INFINITY
  const meanTurnLengthM = 2 * (stackLengthM + rotorDiameterM)
  return (COPPER_RESISTIVITY_OHM_M * turns * meanTurnLengthM) / wireAreaM2
}

/**
 * Rotor moment of inertia J = ½·m·r² for a solid cylinder, m = ρ·π·r²·L (a denser or
 * fatter rotor takes longer to spin up). Sets the transient spin-up time.
 */
export function rotorInertiaFromDesign(
  rotorDiameterM: number,
  stackLengthM: number,
  rotorDensity: number,
): number {
  const r = rotorDiameterM / 2
  const mass = Math.max(0, rotorDensity) * Math.PI * r * r * Math.max(0, stackLengthM)
  return 0.5 * mass * r * r
}

/**
 * Derive the lumped constants from the design choices (the "design it" depth): the magnet
 * + core + air gap set the air-gap field, and the winding (turns + gauge) + rotor geometry
 * set k, R_a and J. Friction B and the armature inductance L_a stay direct specs (bearings
 * and the full magnetic-circuit inductance are documented further rungs).
 */
function deriveMotorParams(inst: Instance): MotorParams | undefined {
  const turns = readScalarParam(inst, 'winding_turns')
  const gauge = readScalarParam(inst, 'wire_gauge')
  const remanence = readScalarParam(inst, 'magnet_remanence')
  const coreMu = readScalarParam(inst, 'core_relative_permeability')
  const magnetLength = readScalarParam(inst, 'magnet_length')
  const airGap = readScalarParam(inst, 'air_gap')
  const diameter = readScalarParam(inst, 'rotor_diameter')
  const stackLength = readScalarParam(inst, 'stack_length')
  const rotorDensity = readScalarParam(inst, 'rotor_density')
  const viscousFriction = readScalarParam(inst, 'viscous_friction')
  if (
    turns === undefined ||
    gauge === undefined ||
    remanence === undefined ||
    coreMu === undefined ||
    magnetLength === undefined ||
    airGap === undefined ||
    diameter === undefined ||
    stackLength === undefined ||
    rotorDensity === undefined ||
    viscousFriction === undefined ||
    !(turns > 0) ||
    !(diameter > 0) ||
    !(stackLength > 0) ||
    !(viscousFriction > 0)
  ) {
    return undefined
  }
  const fluxDensity = airGapFluxDensityTesla(remanence, magnetLength, airGap, coreMu)
  return {
    armatureResistance: armatureResistanceFromDesign(
      turns,
      diameter,
      stackLength,
      awgAreaM2(gauge),
    ),
    motorConstant: motorConstantFromDesign(turns, fluxDensity, diameter, stackLength),
    viscousFriction,
    loadTorque: readScalarParam(inst, 'load_torque') ?? 0,
    armatureInductance: readScalarParam(inst, 'armature_inductance') ?? 0.001,
    rotorInertia: rotorInertiaFromDesign(diameter, stackLength, rotorDensity),
  }
}

/**
 * Read a motor's parameters off an instance. In "block" mode (the default) the lumped
 * constants are direct params; in "design" mode they DERIVE from the real assembly
 * (deriveMotorParams) — the iron, magnets and winding. Undefined when an essential one is
 * missing or non-physical (R_a and B must be > 0 for a well-defined steady state).
 */
export function motorParamsFromInstance(inst: Instance): MotorParams | undefined {
  if (readEnumParam(inst, 'design_mode') === 'design') return deriveMotorParams(inst)
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
    armatureInductance: readScalarParam(inst, 'armature_inductance') ?? 0,
    rotorInertia: readScalarParam(inst, 'rotor_inertia') ?? 0,
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
