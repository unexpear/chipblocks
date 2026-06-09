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

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export type FailureCode =
  | 'led-overloaded'
  | 'led-reverse-breakdown'
  | 'resistor-overpower'
  | 'capacitor-reverse-polarity'
  | 'capacitor-overvoltage'

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
    } else if (inst.definition === 'resistor') {
      const overpower = checkResistorOverpower(inst, solution)
      if (overpower !== null) failures.push(overpower)
    } else if (inst.definition === 'capacitor') {
      const reversed = checkCapacitorReversePolarity(inst, solution)
      if (reversed !== null) failures.push(reversed)
      const overvolt = checkCapacitorOvervoltage(inst, solution)
      if (overvolt !== null) failures.push(overvolt)
    }
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
  const maxForwardCurrent = readScalarParam(inst, 'max_forward_current')
  if (maxForwardCurrent === undefined || maxForwardCurrent <= 0) return null

  const current = solution.branches.get(inst.id)
  if (current === undefined) return null

  const magnitude = Math.abs(current)
  if (magnitude <= maxForwardCurrent) return null

  return {
    code: 'led-overloaded',
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
  const reverseBreakdown = readScalarParam(inst, 'reverse_breakdown_voltage')
  if (reverseBreakdown === undefined || reverseBreakdown <= 0) return null

  const anodeConnect = inst.connects?.find((c) => c.terminal === 'anode')
  const cathodeConnect = inst.connects?.find((c) => c.terminal === 'cathode')
  if (anodeConnect === undefined || cathodeConnect === undefined) return null

  const V_anode = solution.nodes.get(anodeConnect.net)
  const V_cathode = solution.nodes.get(cathodeConnect.net)
  if (V_anode === undefined || V_cathode === undefined) return null

  const reverseVoltage = V_cathode - V_anode
  if (reverseVoltage <= reverseBreakdown) return null

  return {
    code: 'led-reverse-breakdown',
    source: inst.id,
    kind: 'reverse_breakdown_voltage',
    measured: reverseVoltage,
    rated: reverseBreakdown,
    ratio: reverseVoltage / reverseBreakdown,
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
