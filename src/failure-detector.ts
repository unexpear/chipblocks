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
 * forward-overload check. resistor-overpower lands in S15-v3-4;
 * led-reverse-breakdown in S15-v3-5.
 */

import type { Instance, World } from './cross-fk-validator.ts'
import type { Solution } from './dc-solver.ts'

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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Read a scalar parameter's amount from an instance.
 * Returns undefined if the parameter is missing, not a scalar value, or
 * has a non-numeric amount.
 */
function readScalarParam(inst: Instance, name: string): number | undefined {
  const param = inst.parameters?.[name]
  if (param === undefined) return undefined
  const value = param.value
  if (value === null || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  if (v.kind !== 'scalar') return undefined
  if (typeof v.amount !== 'number') return undefined
  return v.amount
}
