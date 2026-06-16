/**
 * Equation evaluator.
 *
 * OBJECT-MODEL.md §16 specifies the `kind: equation` value: a formula that
 * computes a property's value from declared inputs. This module:
 *
 *   1. Resolves inputs against an evaluation context (property_ref paths,
 *      catalog constants, input_variable markers)
 *   2. Binds requested physical constants into the expression scope
 *   3. Evaluates with mathjs's unit-aware arithmetic
 *   4. Checks the result's units against the equation's declared output_unit
 *   5. Returns { amount, unit, conditions } or throws a structured error
 *
 * The principle: real units propagate through real arithmetic; mismatches
 * surface at validation time, not after a circuit "works" with nonsense
 * values. Per §16.5, input_variable inputs cause "deferred-evaluation" —
 * Sprint 12 evaluates all-concrete-input equations only; parametric forms
 * (ρ(T), etc.) land when the DC solver supplies callers that can pass T,
 * frequency, and so on.
 *
 * Physical constants are bound from NIST CODATA 2018 values
 * (verified at physics.nist.gov 2026-06-05). See §16.4 for the full table.
 */

import { all, create } from 'mathjs'

// biome-ignore lint/style/noNonNullAssertion: mathjs's `all` is always defined at runtime; its type declaration lists it as possibly undefined.
const math = create(all!)

// ---------------------------------------------------------------------------
// Physical constants — NIST CODATA 2018. Verified at physics.nist.gov 2026-06-05.
// (epsilon_0/mu_0 are the 2018 measured values; h, c, e, k_B, N_A are SI-exact and
// identical across CODATA sets. The 2022 set nudges epsilon_0/mu_0 by ~1e-9 relative
// — negligible for circuit work, a pending refresh.)
// Bound into the mathjs scope when the equation declares constants_used.
// ---------------------------------------------------------------------------

const PHYSICAL_CONSTANTS: Record<string, { amount: number; unit: string }> = {
  h: { amount: 6.62607015e-34, unit: 'J s' },
  c: { amount: 2.99792458e8, unit: 'm/s' },
  e: { amount: 1.602176634e-19, unit: 'C' },
  k_B: { amount: 1.380649e-23, unit: 'J/K' },
  epsilon_0: { amount: 8.8541878128e-12, unit: 'F/m' },
  mu_0: { amount: 1.25663706212e-6, unit: 'H/m' },
  N_A: { amount: 6.02214076e23, unit: '1/mol' },
}

// ---------------------------------------------------------------------------
// Equation value spec — minimal shape needed for evaluation. JSON Schema
// in schemas/ enforces the full shape upstream; the types here only need
// to describe what the evaluator reads.
// ---------------------------------------------------------------------------

export type InputSpec =
  | { kind: 'constant'; amount: number; unit: string }
  | { kind: 'property_ref'; path: string }
  | { kind: 'input_variable'; unit: string; default?: number }

export type EquationValue = {
  kind: 'equation'
  expression: string
  inputs: Record<string, InputSpec>
  output_unit: string
  constants_used?: string[]
  conditions?: Record<string, unknown>
  provenance?: unknown
  notes?: string
}

export type ConcreteValue = { amount: number; unit: string }

/**
 * Evaluation context maps property_ref paths to their resolved concrete values.
 * Callers (the cross-FK validator) build this context by walking the instance's
 * composition graph and pulling each referenced property's value.
 */
export type EvaluationContext = {
  propertyRefs: Record<string, ConcreteValue>
}

export type EvaluationResult =
  | {
      status: 'evaluated'
      amount: number
      unit: string
      conditions?: Record<string, unknown>
    }
  | { status: 'deferred-evaluation'; reason: string }

export type EquationErrorCode =
  | 'derives-unit-mismatch'
  | 'unresolved-input'
  | 'unknown-constant'
  | 'expression-syntax'
  | 'unknown-unit'

export class EquationEvalError extends Error {
  code: EquationErrorCode
  detail: string | undefined
  constructor(code: EquationErrorCode, message: string, detail?: string) {
    super(message)
    this.name = 'EquationEvalError'
    this.code = code
    this.detail = detail
  }
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

/**
 * Public re-export so tests can directly exercise mathjs's unit algebra
 * without re-instantiating their own math instance.
 */
export const mathInstance = math

/**
 * Evaluate an equation-valued property.
 *
 * Returns `{ status: 'evaluated', amount, unit }` on success, or
 * `{ status: 'deferred-evaluation', reason }` if any input is an
 * input_variable (Sprint 12 scope: all-concrete-input only).
 *
 * Throws EquationEvalError with a specific code for:
 *   - unknown-constant: constants_used names something not in NIST table
 *   - unresolved-input: property_ref path missing from context
 *   - unknown-unit: input or output unit string not recognized by mathjs
 *   - expression-syntax: mathjs failed to parse/evaluate
 *   - derives-unit-mismatch: result's units don't match output_unit
 */
export function evaluateEquation(
  spec: EquationValue,
  context: EvaluationContext,
): EvaluationResult {
  // biome-ignore lint/suspicious/noExplicitAny: mathjs scope is intentionally polymorphic
  const scope: Record<string, any> = {}

  // Bind declared physical constants from the NIST CODATA 2022 table
  for (const constantName of spec.constants_used ?? []) {
    const constant = PHYSICAL_CONSTANTS[constantName]
    if (!constant) {
      throw new EquationEvalError(
        'unknown-constant',
        `Unknown physical constant: ${constantName}`,
        `Known constants: ${Object.keys(PHYSICAL_CONSTANTS).join(', ')}`,
      )
    }
    scope[constantName] = safeUnit(constant.amount, constant.unit, constantName)
  }

  // Resolve and bind each input. input_variable triggers Sprint 12 defer.
  for (const [name, input] of Object.entries(spec.inputs)) {
    if (input.kind === 'constant') {
      scope[name] = safeUnit(input.amount, input.unit, name)
      continue
    }
    if (input.kind === 'property_ref') {
      const resolved = context.propertyRefs[input.path]
      if (!resolved) {
        throw new EquationEvalError(
          'unresolved-input',
          `Could not resolve input '${name}' at path '${input.path}'`,
          `Provided paths: ${Object.keys(context.propertyRefs).join(', ') || '(none)'}`,
        )
      }
      scope[name] = safeUnit(resolved.amount, resolved.unit, name)
      continue
    }
    // input_variable — Sprint 12 scope: all-concrete-input only
    return {
      status: 'deferred-evaluation',
      reason: `Equation has input_variable '${name}'; Sprint 12 evaluates all-concrete-input equations only (see OBJECT-MODEL.md §16.5).`,
    }
  }

  // Evaluate the expression with the prepared scope
  // biome-ignore lint/suspicious/noExplicitAny: mathjs return is polymorphic
  let result: any
  try {
    result = math.evaluate(spec.expression, scope)
  } catch (err) {
    throw new EquationEvalError(
      'expression-syntax',
      `Expression evaluation failed: ${spec.expression}`,
      err instanceof Error ? err.message : String(err),
    )
  }

  // Verify the result is a Unit (not a bare number) — bare numbers mean
  // the expression collapsed to dimensionless, which is a unit mismatch
  // against any non-dimensionless output_unit.
  if (math.typeOf(result) !== 'Unit') {
    throw new EquationEvalError(
      'derives-unit-mismatch',
      `Expression did not produce a unit-bearing result`,
      `Expected units: ${spec.output_unit}; got ${math.typeOf(result)} ${String(result)}`,
    )
  }

  // Compare dimensions to the declared output_unit
  const expectedUnit = safeUnit(1, spec.output_unit, 'output_unit')
  if (!result.equalBase(expectedUnit)) {
    throw new EquationEvalError(
      'derives-unit-mismatch',
      `Output units do not match declared output_unit`,
      `Expression: ${spec.expression}; declared: ${spec.output_unit}; computed units: ${result.toString()}`,
    )
  }

  // Convert the result to the declared units for the returned amount
  const amount = result.toNumber(toMathjsUnit(spec.output_unit))
  if (spec.conditions !== undefined) {
    return {
      status: 'evaluated',
      amount,
      unit: spec.output_unit,
      conditions: spec.conditions,
    }
  }
  return {
    status: 'evaluated',
    amount,
    unit: spec.output_unit,
  }
}

/**
 * The catalog writes units in readable snake_case (`ohm_meter`, `square_metre`,
 * `per_kelvin`); mathjs needs its own syntax (`ohm m`, `m^2`, `1/K`). Translate
 * at the evaluation boundary so the catalog stays readable AND real fixture
 * values evaluate. Anything not in this map is passed to mathjs unchanged, so
 * native mathjs unit strings (`ohm m`, `m^2`, `eV`, `nm`, `J s`) keep working.
 */
const UNIT_ALIASES: Record<string, string> = {
  ohm_meter: 'ohm m',
  metre: 'm',
  meter: 'm',
  square_metre: 'm^2',
  square_meter: 'm^2',
  cubic_metre: 'm^3',
  cubic_meter: 'm^3',
  per_kelvin: '1/K',
  volt: 'V',
  ampere: 'A',
  watt: 'W',
  farad: 'F',
  joule: 'J',
  coulomb: 'C',
  hertz: 'Hz',
  henry: 'H',
  kelvin: 'K',
  second: 's',
  kg_per_m3: 'kg/m^3',
  watt_per_meter_kelvin: 'W/(m K)',
}

/** Translate a catalog unit string to mathjs syntax (pass-through if not aliased). */
function toMathjsUnit(unit: string): string {
  return UNIT_ALIASES[unit] ?? unit
}

/**
 * Wrap math.unit() to convert mathjs's "unknown unit" errors into our
 * structured EquationEvalError shape with a clear locus. Dimensionless
 * values (relative permittivity, refractive index, EQE, etc.) are passed
 * as bare numbers — mathjs's unit algebra handles number × Unit arithmetic
 * by treating the number as dimensionless. Recognized dimensionless
 * markers: '', '1', 'dimensionless'.
 */
// biome-ignore lint/suspicious/noExplicitAny: mathjs Unit return is polymorphic
function safeUnit(amount: number, unit: string, locus: string): any {
  if (unit === '' || unit === '1' || unit === 'dimensionless') {
    return amount
  }
  try {
    return math.unit(amount, toMathjsUnit(unit))
  } catch (err) {
    throw new EquationEvalError(
      'unknown-unit',
      `mathjs does not recognize unit '${unit}' for ${locus}`,
      err instanceof Error ? err.message : String(err),
    )
  }
}
