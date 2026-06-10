/**
 * Failure-mode detector.
 *
 * Per OBJECT-MODEL.md §19. Consumes the Solution from the DC solver (§18)
 * and compares computed branch currents + node voltages against each
 * instance's declared rating parameters. Fires structured Failure errors
 * when ratings are exceeded.
 *
 * §18 answers "what does the circuit do?"; §19 answers "is that safe?".
 * The educational anchor circuit's 70 mA through a 20 mA LED is the
 * canonical triggering case — detectFailures fires led-overloaded with
 * the exact numbers.
 *
 * Per the "real all the way down" principle: the detector is honest.
 * Missing rating parameters cause a check to SKIP silently — the rating
 * is "unknown," not "infinite" — rather than fake a pass or a fail. Checks
 * fire based on actual computed values vs. actual declared ratings.
 *
 * S15-v3-3 scaffold: Failure type + detectFailures entry point + LED
 * forward-overload check.
 * S15-v3-4 adds resistor-overpower (I²R > power_rating).
 * S15-v3-5 adds led-reverse-breakdown (V_cathode - V_anode >
 * reverse_breakdown_voltage) — the sign-dependent, node-voltage-based check.
 */

import type { Instance, World } from './cross-fk-validator.ts'
import type { Solution } from './dc-solver.ts'
import { readScalarParam } from './instance-params.ts'
import { junctionTemperature } from './thermal-model.ts'

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export type FailureCode =
  | 'led-overloaded'
  | 'led-reverse-breakdown'
  | 'diode-overloaded'
  | 'diode-reverse-breakdown'
  | 'mosfet-overloaded'
  | 'mosfet-gate-overvoltage'
  | 'resistor-overpower'
  | 'capacitor-reverse-polarity'
  | 'capacitor-overvoltage'
  | 'part-overtemperature'

export type FailureSeverity = 'error'

export type Failure = {
  code: FailureCode
  /** Instance id where the violation occurs. */
  source: string
  /** Human-readable description of the rating violated (e.g., 'max_forward_current'). */
  kind: string
  /** The actual computed value from the Solution. */
  measured: number
  /** The rating-parameter limit from the instance. */
  rated: number
  /** measured / rated (sign-positive magnitude). */
  ratio: number
  /** Unit string for measured + rated (e.g., 'ampere'). */
  units: string
  /** Sprint 15 reports all violations as errors. */
  severity: FailureSeverity
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

const LED_DEFINITIONS = new Set(['led', 'led_uv_algan'])
/** Plain rectifying diodes — same forward-overload physics, plus a PIV rating. */
const DIODE_DEFINITIONS = new Set(['diode_silicon_rectifier', 'diode_schottky_al_si'])

/**
 * Walk the world's instances and compare each against its rating parameters
 * using the solver's computed values. Returns the list of detected failures
 * (empty when nothing exceeds a rating).
 *
 * Only meaningful on a Solution with status 'solved'; for any other status
 * there are no reliable values to check, so an empty list is returned.
 */
export function detectFailures(world: World, solution: Solution): Failure[] {
  if (solution.status !== 'solved') return []

  const failures: Failure[] = []

  for (const inst of world.instances.values()) {
    if (LED_DEFINITIONS.has(inst.definition)) {
      const overload = checkLedForwardOverload(inst, solution)
      if (overload !== null) failures.push(overload)
      const reverse = checkLedReverseBreakdown(inst, solution)
      if (reverse !== null) failures.push(reverse)
    } else if (DIODE_DEFINITIONS.has(inst.definition)) {
      const overload = checkDiodeForwardOverload(inst, solution)
      if (overload !== null) failures.push(overload)
      const piv = checkDiodePeakInverse(inst, solution)
      if (piv !== null) failures.push(piv)
    } else if (
      inst.definition === 'transistor_mosfet_nmos' ||
      inst.definition === 'transistor_mosfet_pmos'
    ) {
      const overload = checkMosfetOverload(inst, solution)
      if (overload !== null) failures.push(overload)
      const oxide = checkMosfetGateOvervoltage(inst, solution)
      if (oxide !== null) failures.push(oxide)
    } else if (inst.definition === 'resistor') {
      const overpower = checkResistorOverpower(inst, solution)
      if (overpower !== null) failures.push(overpower)
    } else if (inst.definition === 'capacitor') {
      const reversed = checkCapacitorReversePolarity(inst, solution)
      if (reversed !== null) failures.push(reversed)
      const overvolt = checkCapacitorOvervoltage(inst, solution)
      if (overvolt !== null) failures.push(overvolt)
    }
    // Thermal is generic: any part declaring a thermal resistance + max
    // operating temperature gets the lumped T = T_amb + P·θ_JA check (§ stage 7).
    const overtemp = checkOvertemperature(inst, solution)
    if (overtemp !== null) failures.push(overtemp)
  }

  return failures
}

// ---------------------------------------------------------------------------
// Per-check implementations — exposed for unit testing
// ---------------------------------------------------------------------------

/**
 * LED forward-overload check (§19.3 / §19.6).
 * Fires led-overloaded when |I_led| exceeds max_forward_current.
 *
 * Returns the Failure, or null when the check doesn't fire OR the inputs
 * can't be resolved (missing branch current, missing rating — the rating is
 * "unknown," not a failure).
 */
export function checkLedForwardOverload(inst: Instance, solution: Solution): Failure | null {
  return forwardOverloadCheck(inst, solution, 'led-overloaded')
}

/**
 * Rectifier/Schottky forward-overload check — the same thermal-damage physics
 * as the LED's (|I| beyond max_forward_current cooks the junction), reported
 * under its own code so the canvas can speak about the right kind of part.
 */
export function checkDiodeForwardOverload(inst: Instance, solution: Solution): Failure | null {
  return forwardOverloadCheck(inst, solution, 'diode-overloaded')
}

function forwardOverloadCheck(
  inst: Instance,
  solution: Solution,
  code: 'led-overloaded' | 'diode-overloaded',
): Failure | null {
  const maxForwardCurrent = readScalarParam(inst, 'max_forward_current')
  if (maxForwardCurrent === undefined || maxForwardCurrent <= 0) return null

  const current = solution.branches.get(inst.id)
  if (current === undefined) return null

  const magnitude = Math.abs(current)
  if (magnitude <= maxForwardCurrent) return null

  return {
    code,
    source: inst.id,
    kind: 'max_forward_current',
    measured: magnitude,
    rated: maxForwardCurrent,
    ratio: magnitude / maxForwardCurrent,
    units: 'ampere',
    severity: 'error',
  }
}

/**
 * LED reverse-breakdown check (§19.3 / §19.6).
 * Fires led-reverse-breakdown when the reverse voltage across the LED
 * (V_cathode − V_anode) exceeds reverse_breakdown_voltage.
 *
 * Sign-dependent (§19.6): when forward-biased (V_anode > V_cathode) the
 * difference is negative and the check can't fire. The rating is a positive
 * number (e.g., 5 V); the check fires only when the reverse voltage grows
 * beyond it.
 *
 * Returns the Failure, or null when the check doesn't fire OR the inputs
 * can't be resolved (missing rating, missing anode/cathode connect, or
 * either net voltage unresolved).
 */
export function checkLedReverseBreakdown(inst: Instance, solution: Solution): Failure | null {
  return reverseVoltageCheck(inst, solution, 'reverse_breakdown_voltage', 'led-reverse-breakdown')
}

/**
 * Rectifier peak-inverse-voltage check — the diode blocks up to its PIV
 * rating; beyond it the junction avalanches, destructively for a non-Zener.
 * Same sign-dependent shape as the LED check, against `peak_inverse_voltage`.
 */
export function checkDiodePeakInverse(inst: Instance, solution: Solution): Failure | null {
  return reverseVoltageCheck(inst, solution, 'peak_inverse_voltage', 'diode-reverse-breakdown')
}

function reverseVoltageCheck(
  inst: Instance,
  solution: Solution,
  ratingParam: string,
  code: 'led-reverse-breakdown' | 'diode-reverse-breakdown',
): Failure | null {
  const reverseLimit = readScalarParam(inst, ratingParam)
  if (reverseLimit === undefined || reverseLimit <= 0) return null

  const anodeConnect = inst.connects?.find((c) => c.terminal === 'anode')
  const cathodeConnect = inst.connects?.find((c) => c.terminal === 'cathode')
  if (anodeConnect === undefined || cathodeConnect === undefined) return null

  const V_anode = solution.nodes.get(anodeConnect.net)
  const V_cathode = solution.nodes.get(cathodeConnect.net)
  if (V_anode === undefined || V_cathode === undefined) return null

  const reverseVoltage = V_cathode - V_anode
  if (reverseVoltage <= reverseLimit) return null

  return {
    code,
    source: inst.id,
    kind: ratingParam,
    measured: reverseVoltage,
    rated: reverseLimit,
    ratio: reverseVoltage / reverseLimit,
    units: 'volt',
    severity: 'error',
  }
}

/**
 * MOSFET drain-current overload: |I_D| beyond max_drain_current cooks the
 * channel — the same thermal-damage shape as the diode checks.
 */
export function checkMosfetOverload(inst: Instance, solution: Solution): Failure | null {
  const maxDrain = readScalarParam(inst, 'max_drain_current')
  if (maxDrain === undefined || maxDrain <= 0) return null
  const current = solution.branches.get(inst.id)
  if (current === undefined) return null
  const magnitude = Math.abs(current)
  if (magnitude <= maxDrain) return null
  return {
    code: 'mosfet-overloaded',
    source: inst.id,
    kind: 'max_drain_current',
    measured: magnitude,
    rated: maxDrain,
    ratio: magnitude / maxDrain,
    units: 'ampere',
    severity: 'error',
  }
}

/**
 * MOSFET gate-oxide overvoltage: |V_GS| beyond the absolute-maximum rating
 * RUPTURES the gate oxide — instant, permanent, and the classic
 * static-electricity death. Checked from the solved gate and source node
 * voltages against max_gate_source_voltage (a magnitude rating, ±).
 */
export function checkMosfetGateOvervoltage(inst: Instance, solution: Solution): Failure | null {
  const maxGate = readScalarParam(inst, 'max_gate_source_voltage')
  if (maxGate === undefined || maxGate <= 0) return null
  const gate = inst.connects?.find((c) => c.terminal === 'gate')
  const source = inst.connects?.find((c) => c.terminal === 'source')
  if (gate === undefined || source === undefined) return null
  const vGate = solution.nodes.get(gate.net)
  const vSource = solution.nodes.get(source.net)
  if (vGate === undefined || vSource === undefined) return null
  const magnitude = Math.abs(vGate - vSource)
  if (magnitude <= maxGate) return null
  return {
    code: 'mosfet-gate-overvoltage',
    source: inst.id,
    kind: 'max_gate_source_voltage',
    measured: magnitude,
    rated: maxGate,
    ratio: magnitude / maxGate,
    units: 'volt',
    severity: 'error',
  }
}

/**
 * A polarized (aluminum electrolytic) capacitor tolerates only ~1–1.5 V of
 * reverse voltage before the oxide layer degrades (gassing / venting / failure)
 * — the classic backwards-electrolytic mistake. terminal_a is the + lead.
 */
const CAPACITOR_REVERSE_TOLERANCE_V = 1

/**
 * Capacitor reverse-polarity check: fires when V(terminal_a) − V(terminal_b)
 * is more negative than the ~1 V an electrolytic's oxide layer tolerates.
 * Sign-dependent like the LED reverse-breakdown check.
 */
export function checkCapacitorReversePolarity(inst: Instance, solution: Solution): Failure | null {
  const aConnect = inst.connects?.find((c) => c.terminal === 'terminal_a')
  const bConnect = inst.connects?.find((c) => c.terminal === 'terminal_b')
  if (aConnect === undefined || bConnect === undefined) return null

  const vA = solution.nodes.get(aConnect.net)
  const vB = solution.nodes.get(bConnect.net)
  if (vA === undefined || vB === undefined) return null

  const reverseVoltage = vB - vA // positive when the − lead sits above the + lead
  if (reverseVoltage <= CAPACITOR_REVERSE_TOLERANCE_V) return null

  return {
    code: 'capacitor-reverse-polarity',
    source: inst.id,
    kind: 'reverse_polarity',
    measured: reverseVoltage,
    rated: CAPACITOR_REVERSE_TOLERANCE_V,
    ratio: reverseVoltage / CAPACITOR_REVERSE_TOLERANCE_V,
    units: 'volt',
    severity: 'error',
  }
}

/**
 * Capacitor overvoltage check: fires when the forward voltage across the
 * capacitor exceeds its declared voltage_rating (dielectric breakdown).
 */
export function checkCapacitorOvervoltage(inst: Instance, solution: Solution): Failure | null {
  const voltageRating = readScalarParam(inst, 'voltage_rating')
  if (voltageRating === undefined || voltageRating <= 0) return null

  const aConnect = inst.connects?.find((c) => c.terminal === 'terminal_a')
  const bConnect = inst.connects?.find((c) => c.terminal === 'terminal_b')
  if (aConnect === undefined || bConnect === undefined) return null

  const vA = solution.nodes.get(aConnect.net)
  const vB = solution.nodes.get(bConnect.net)
  if (vA === undefined || vB === undefined) return null

  const forwardVoltage = vA - vB
  if (forwardVoltage <= voltageRating) return null

  return {
    code: 'capacitor-overvoltage',
    source: inst.id,
    kind: 'voltage_rating',
    measured: forwardVoltage,
    rated: voltageRating,
    ratio: forwardVoltage / voltageRating,
    units: 'volt',
    severity: 'error',
  }
}

/**
 * Over-temperature check (stage 7, lumped thermal model). For any part that
 * declares BOTH thermal_resistance_junction_ambient (θ_JA) and
 * max_operating_temperature, compute the steady-state part temperature
 * T = 25 °C ambient + P·θ_JA from its real dissipated power (|I|·|V| across its
 * two terminals) and fire when it exceeds the declared maximum. Parts without
 * the thermal ratings skip honestly — the rating is "unknown," not "infinite."
 */
export function checkOvertemperature(inst: Instance, solution: Solution): Failure | null {
  const thetaJa = readScalarParam(inst, 'thermal_resistance_junction_ambient')
  const maxTemperature = readScalarParam(inst, 'max_operating_temperature')
  if (thetaJa === undefined || thetaJa <= 0) return null
  if (maxTemperature === undefined) return null

  const branch = solution.branches.get(inst.id)
  if (branch === undefined) return null
  const connects = inst.connects ?? []
  if (connects.length !== 2) return null
  const vA = solution.nodes.get(connects[0]?.net ?? '')
  const vB = solution.nodes.get(connects[1]?.net ?? '')
  if (vA === undefined || vB === undefined) return null

  const watts = Math.abs(branch) * Math.abs(vA - vB)
  const temperature = junctionTemperature(watts, thetaJa)
  if (temperature <= maxTemperature) return null

  return {
    code: 'part-overtemperature',
    source: inst.id,
    kind: 'max_operating_temperature',
    measured: temperature,
    rated: maxTemperature,
    ratio: temperature / maxTemperature,
    units: 'celsius',
    severity: 'error',
  }
}

/**
 * Resistor overpower check (§19.3 / §19.6).
 * Fires resistor-overpower when the dissipated power I²R exceeds power_rating.
 * I²R is sign-independent, so the branch current's sign doesn't matter.
 *
 * Returns the Failure, or null when the check doesn't fire OR the inputs
 * can't be resolved (missing resistance, missing power_rating, or missing
 * branch current — the rating is "unknown," not a failure).
 */
export function checkResistorOverpower(inst: Instance, solution: Solution): Failure | null {
  const resistance = readScalarParam(inst, 'resistance')
  if (resistance === undefined || resistance <= 0) return null

  const powerRating = readScalarParam(inst, 'power_rating')
  if (powerRating === undefined || powerRating <= 0) return null

  const current = solution.branches.get(inst.id)
  if (current === undefined) return null

  const dissipated = current * current * resistance
  if (dissipated <= powerRating) return null

  return {
    code: 'resistor-overpower',
    source: inst.id,
    kind: 'power_rating',
    measured: dissipated,
    rated: powerRating,
    ratio: dissipated / powerRating,
    units: 'watt',
    severity: 'error',
  }
}
