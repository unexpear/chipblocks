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
 * led-reverse-breakdown lands in S15-v3-5.
 */

import type { Instance, World } from './cross-fk-validator.ts'
import type { Solution } from './dc-solver.ts'
import { readScalarParam } from './instance-params.ts'

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export type FailureCode = 'led-overloaded' | 'led-reverse-breakdown' | 'resistor-overpower'

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
    } else if (inst.definition === 'resistor') {
      const overpower = checkResistorOverpower(inst, solution)
      if (overpower !== null) failures.push(overpower)
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
