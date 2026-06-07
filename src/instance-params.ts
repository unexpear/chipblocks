/**
 * Shared instance-parameter helpers.
 *
 * Small leaf utilities for reading typed values off an instance's parameters.
 * Extracted from dc-solver.ts + failure-detector.ts (both read scalar
 * parameters identically) so there's one place to fix parsing bugs and one
 * place to extend (e.g., if scalar reading ever needs unit conversion or
 * range-kind handling).
 */

import type { Instance } from './cross-fk-validator.ts'

/**
 * Read a scalar parameter's amount from an instance.
 * Returns undefined if the parameter is missing, not a scalar value, or
 * has a non-numeric amount.
 */
export function readScalarParam(inst: Instance, name: string): number | undefined {
  const param = inst.parameters?.[name]
  if (param === undefined) return undefined
  const value = param.value
  if (value === null || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  if (v.kind !== 'scalar') return undefined
  if (typeof v.amount !== 'number') return undefined
  return v.amount
}

/**
 * Read an enum / bare-string parameter (e.g. a switch's `state: open|closed`, or
 * a `contact_material` ref). Returns undefined if missing or not a plain string.
 * Mirrors the `value: <string>` shape the cross-FK validator already resolves for
 * material refs.
 */
export function readEnumParam(inst: Instance, name: string): string | undefined {
  const value = inst.parameters?.[name]?.value
  return typeof value === 'string' ? value : undefined
}
