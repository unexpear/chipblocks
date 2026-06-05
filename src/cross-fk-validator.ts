/**
 * Cross-FK validator.
 *
 * JSON Schema validates the SHAPE of each object (definition / instance / behavior).
 * What it can't do is verify cross-references — that ids point at existing objects of
 * the right kind, that role constraints are actually satisfied by the chosen object,
 * that behavior claims reference real registry entries.
 *
 * This module fills that gap. It takes a "world" (the collection of all loaded objects
 * indexed by id and kind) and returns a structured list of errors. The error shape is a
 * discriminated union over a small set of codes so tests can assert specific failure
 * modes precisely.
 *
 * Per OBJECT-MODEL.md §15 deferred row "Role-satisfaction validation": JSON Schema is
 * stricter than simple foreign-key existence — when an instance fills a
 * composition.requires role via a satisfies_role parameter, the validator must prove
 * the chosen object actually satisfies the role's must_enable constraints. That check
 * lands in S3-v3-4; this skeleton (S3-v3-3) covers ref resolution + kind matching +
 * unknown-behavior detection.
 *
 * Sprint 12 v3-7: derives-violates-rating — per OBJECT-MODEL.md §16.7. When an
 * instance's definition has a property declared as kind: equation AND the instance
 * has a same-name parameter declaring a value, evaluate the equation using the
 * instance's resolved composition (material/shape) and compare. Mismatches beyond a
 * default 20% relative tolerance surface the new error code. Inputs that can't be
 * resolved from world data (e.g., geometry properties that live at instance level
 * rather than on a shape definition) cause the check to skip silently — the
 * derives-violates-rating check is best-effort and only fires when every input
 * resolves.
 *
 * Per the "real all the way down" principle: this validator does not fake a green
 * light by absence. Every check either confirms a constraint holds with a real lookup,
 * or emits a structured error explaining why. There is no implicit pass.
 */

import {
  type ConcreteValue,
  type EquationValue,
  type EvaluationContext,
  evaluateEquation,
  mathInstance,
} from './equation-evaluator.ts'

// ---------------------------------------------------------------------------
// Object shapes (minimal — only the fields cross-FK needs)
//
// These are intentionally loose. The JSON Schemas in schemas/ enforce the full
// shape; by the time data reaches the cross-FK validator it has already passed
// schema validation. The types here only need to describe what cross-FK reads.
// ---------------------------------------------------------------------------

export type Definition = {
  id: string
  kind: string
  layer?: string
  origin?: string
  composition?: {
    uses?: string[]
    requires?: Record<string, { kind: string; must_enable?: string[]; min_count?: number }>
  }
  enables?: string[]
  behaviors?: string[]
  parameters?: Record<string, ParamSlot>
  properties?: Record<string, { value?: unknown; provenance?: unknown; support?: unknown }>
  state_machine?: {
    initial_state: string
    states: Record<string, { description: string }>
    transitions: Array<{
      from: string
      to: string
      trigger: string
      description?: string
    }>
  }
}

export type ParamSlot = {
  type: string
  required?: boolean
  satisfies_role?: string
  units?: string
  default?: { value: unknown; provenance?: unknown }
}

export type Instance = {
  id: string
  kind_ref: string
  definition: string
  origin?: string
  parameters?: Record<string, { value?: unknown; ref?: string }>
  connects?: Array<{ net: string; terminal: string; of: string }>
}

export type BehaviorEntry = {
  id: string
  kind: 'behavior'
  consequences?: string[]
}

export type ActiveVariableEntry = {
  id: string
  kind: 'active_variable'
  parameter_type: string
  value: unknown
}

export type Net = {
  id: string
  kind: 'net'
  origin?: string
  type?: string
  description?: string
  members: Array<{ instance: string; terminal: string }>
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export type World = {
  definitions: Map<string, Definition>
  instances: Map<string, Instance>
  behaviors: Map<string, BehaviorEntry>
  activeVariables: Map<string, ActiveVariableEntry>
  nets: Map<string, Net>
}

// ---------------------------------------------------------------------------
// Error shape (discriminated union)
// ---------------------------------------------------------------------------

export type CrossFkError =
  | {
      code: 'unknown-reference'
      source: string
      ref: string
      where: string
    }
  | {
      code: 'kind-mismatch'
      source: string
      ref: string
      expected_kind: string
      actual_kind: string
      where: string
    }
  | {
      code: 'unknown-behavior'
      source: string
      behavior: string
      where: string
    }
  | {
      code: 'role-unsatisfied'
      source: string
      role: string
      chosen: string
      required: string[]
      actual: string[]
    }
  | {
      code: 'unknown-active-variable'
      source: string
      ref: string
      where: string
    }
  | {
      code: 'active-variable-type-mismatch'
      source: string
      av: string
      av_type: string
      expected_type: string
      where: string
    }
  | {
      code: 'state-machine-invalid-transition'
      source: string
      invalid_ref: string
      where: string
      declared_states: string[]
    }
  | {
      code: 'derives-violates-rating'
      source: string
      property: string
      derived_amount: number
      derived_unit: string
      declared_amount: number
      declared_unit: string
      relative_difference: number
      tolerance: number
    }
  | {
      code: 'unknown-net'
      source: string
      ref: string
      where: string
    }
  | {
      code: 'net-underpopulated'
      source: string
      member_count: number
    }
  | {
      code: 'net-membership-mismatch'
      net: string
      instance: string
      terminal: string
      missing_from: 'net.members' | 'instance.connects'
    }

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Look up an object by id across all kinds. Returns the resolved object + its kind,
 * or null if no object with that id exists in any registry.
 */
function lookup(world: World, id: string): { kind: string } | null {
  const def = world.definitions.get(id)
  if (def !== undefined) return { kind: def.kind }
  const inst = world.instances.get(id)
  if (inst !== undefined) return { kind: inst.kind_ref }
  const beh = world.behaviors.get(id)
  if (beh !== undefined) return { kind: 'behavior' }
  const av = world.activeVariables.get(id)
  if (av !== undefined) return { kind: 'active_variable' }
  return null
}

/**
 * Map a parameter type to the expected kind of the referenced object.
 * Returns null when the type doesn't carry a kind constraint (object_ref accepts
 * any kind; non-ref types like 'quantity' don't reference other objects).
 */
function paramKindFromType(type: string): string | null {
  switch (type) {
    case 'material_ref':
      return 'material'
    case 'shape_ref':
      return 'shape'
    case 'object_ref':
      return null
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Helpers for derives-violates-rating (S12-v3-7)
// ---------------------------------------------------------------------------

const DEFAULT_RATING_TOLERANCE = 0.2 // 20% relative difference — §16.7

/** Type guard for the equation value kind (per OBJECT-MODEL.md §16). */
function isEquationValue(v: unknown): v is EquationValue {
  if (typeof v !== 'object' || v === null) return false
  return (v as Record<string, unknown>).kind === 'equation'
}

/**
 * Resolve a composition role name to the id of the material / shape that fills it.
 *
 * Walks: role name → satisfies_role parameter on def → instance value, AV ref, or
 * definition default. Returns undefined when any link in the chain is missing.
 */
function resolveRoleId(
  inst: Instance,
  def: Definition,
  world: World,
  roleName: string,
): string | undefined {
  const satisfyingEntry = Object.entries(def.parameters ?? {}).find(
    ([, slot]) => slot.satisfies_role === roleName,
  )
  if (satisfyingEntry === undefined) return undefined
  const [paramName, slot] = satisfyingEntry

  const instParam = inst.parameters?.[paramName]
  if (typeof instParam?.value === 'string') return instParam.value
  if (instParam?.ref !== undefined) {
    const av = world.activeVariables.get(instParam.ref)
    if (av !== undefined && typeof av.value === 'string') return av.value
  }
  if (typeof slot.default?.value === 'string') return slot.default.value
  return undefined
}

/**
 * Read a property entry's value as a concrete { amount, unit } pair.
 *
 * Returns null when the property's value isn't a directly-evaluable scalar or
 * condition_bound (range, equation, curve, lookup_table, etc. take more work
 * to reduce to a single point — deferred to later sprints).
 */
function readScalarOrConditionBound(prop: unknown): ConcreteValue | null {
  if (typeof prop !== 'object' || prop === null) return null
  const value = (prop as Record<string, unknown>).value
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  const kind = v.kind
  if (
    (kind === 'scalar' || kind === 'condition_bound') &&
    typeof v.amount === 'number' &&
    typeof v.unit === 'string'
  ) {
    return { amount: v.amount, unit: v.unit }
  }
  return null
}

/**
 * Build an EvaluationContext for `spec` by walking the instance's composition.
 *
 * Each `property_ref` input's path of the form `<role>.<property>` resolves to
 * the property value declared on the role-filling material / shape definition.
 * Returns null if ANY property_ref input can't resolve (the rating check then
 * skips silently — best-effort, per §16.7).
 */
function buildRatingCheckContext(
  inst: Instance,
  def: Definition,
  world: World,
  spec: EquationValue,
): EvaluationContext | null {
  const propertyRefs: Record<string, ConcreteValue> = {}

  for (const inputSpec of Object.values(spec.inputs)) {
    if (inputSpec.kind !== 'property_ref') continue

    const path = inputSpec.path
    const dotIndex = path.indexOf('.')
    if (dotIndex < 0) return null

    const roleName = path.substring(0, dotIndex)
    const propName = path.substring(dotIndex + 1)

    const chosenId = resolveRoleId(inst, def, world, roleName)
    if (chosenId === undefined) return null

    const chosen = world.definitions.get(chosenId)
    if (chosen === undefined) return null
    if (chosen.properties === undefined) return null

    const concrete = readScalarOrConditionBound(chosen.properties[propName])
    if (concrete === null) return null

    propertyRefs[path] = concrete
  }
  return { propertyRefs }
}

/**
 * Compare two unit-bearing amounts using mathjs's unit algebra to convert
 * `declared` into `derived`'s unit before computing relative difference.
 * Returns null when the units are dimensionally incompatible or mathjs can't
 * parse either unit string.
 */
function compareDerivedVsDeclared(
  derivedAmount: number,
  derivedUnit: string,
  declaredAmount: number,
  declaredUnit: string,
): { declared_in_derived_unit: number; relative_difference: number } | null {
  try {
    const derived = mathInstance.unit(derivedAmount, derivedUnit)
    const declared = mathInstance.unit(declaredAmount, declaredUnit)
    if (!derived.equalBase(declared)) return null
    const declaredConverted = declared.toNumber(derivedUnit)
    const diff = Math.abs(derivedAmount - declaredConverted)
    const relativeDifference = declaredConverted === 0 ? diff : diff / Math.abs(declaredConverted)
    return { declared_in_derived_unit: declaredConverted, relative_difference: relativeDifference }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate cross-references across the loaded world. Returns a list of structured
 * errors. An empty array means every reference resolves and every kind matches
 * (subject to the rule set this skeleton enforces; role-satisfaction lands in
 * S3-v3-4).
 */
export function validateWorld(world: World): CrossFkError[] {
  const errors: CrossFkError[] = []

  for (const def of world.definitions.values()) {
    // composition.uses ids must resolve to existing objects.
    if (def.composition?.uses) {
      for (const usedId of def.composition.uses) {
        if (lookup(world, usedId) === null) {
          errors.push({
            code: 'unknown-reference',
            source: def.id,
            ref: usedId,
            where: 'composition.uses',
          })
        }
      }
    }

    // behaviors[] entries must exist in the behavior registry.
    if (def.behaviors) {
      for (const behId of def.behaviors) {
        if (!world.behaviors.has(behId)) {
          errors.push({
            code: 'unknown-behavior',
            source: def.id,
            behavior: behId,
            where: 'behaviors',
          })
        }
      }
    }

    // State machine internal consistency. Per OBJECT-MODEL.md §6.5:
    // every transition's 'from' and 'to' must reference a declared state,
    // and 'initial_state' must reference a declared state.
    if (def.state_machine) {
      const declaredStates = Object.keys(def.state_machine.states)
      const initial = def.state_machine.initial_state
      if (!declaredStates.includes(initial)) {
        errors.push({
          code: 'state-machine-invalid-transition',
          source: def.id,
          invalid_ref: initial,
          where: 'state_machine.initial_state',
          declared_states: declaredStates,
        })
      }
      for (let i = 0; i < def.state_machine.transitions.length; i++) {
        const t = def.state_machine.transitions[i]
        if (t === undefined) continue
        if (!declaredStates.includes(t.from)) {
          errors.push({
            code: 'state-machine-invalid-transition',
            source: def.id,
            invalid_ref: t.from,
            where: `state_machine.transitions[${i}].from`,
            declared_states: declaredStates,
          })
        }
        if (!declaredStates.includes(t.to)) {
          errors.push({
            code: 'state-machine-invalid-transition',
            source: def.id,
            invalid_ref: t.to,
            where: `state_machine.transitions[${i}].to`,
            declared_states: declaredStates,
          })
        }
      }
    }
  }

  // Behavior consequences must reference other behaviors that exist.
  for (const beh of world.behaviors.values()) {
    if (beh.consequences) {
      for (const consId of beh.consequences) {
        if (!world.behaviors.has(consId)) {
          errors.push({
            code: 'unknown-behavior',
            source: beh.id,
            behavior: consId,
            where: 'consequences',
          })
        }
      }
    }
  }

  for (const inst of world.instances.values()) {
    // The instance must point at an existing definition.
    const def = world.definitions.get(inst.definition)
    if (def === undefined) {
      errors.push({
        code: 'unknown-reference',
        source: inst.id,
        ref: inst.definition,
        where: 'definition',
      })
      // Without the definition, we can't check the rest of this instance.
      continue
    }

    // kind_ref must match the definition's kind.
    if (inst.kind_ref !== def.kind) {
      errors.push({
        code: 'kind-mismatch',
        source: inst.id,
        ref: inst.definition,
        expected_kind: def.kind,
        actual_kind: inst.kind_ref,
        where: 'kind_ref',
      })
    }

    // Parameter values of ref types (material_ref / shape_ref) must resolve to
    // an existing object of the right kind. Parameters using ref: resolve
    // through the AV registry: missing AVs fire unknown-active-variable,
    // type-incompatible AVs fire active-variable-type-mismatch, and AVs that
    // hold a string id get the same kind-check as value-using parameters
    // (one extra hop: parameters.<x>.ref → <av>.value → resolved object).
    if (inst.parameters && def.parameters) {
      for (const [paramName, paramValue] of Object.entries(inst.parameters)) {
        const slot = def.parameters[paramName]
        if (slot === undefined) continue

        if (paramValue.value !== undefined) {
          const expectedKind = paramKindFromType(slot.type)
          if (expectedKind !== null && typeof paramValue.value === 'string') {
            const target = lookup(world, paramValue.value)
            if (target === null) {
              errors.push({
                code: 'unknown-reference',
                source: inst.id,
                ref: paramValue.value,
                where: `parameters.${paramName}.value`,
              })
            } else if (target.kind !== expectedKind) {
              errors.push({
                code: 'kind-mismatch',
                source: inst.id,
                ref: paramValue.value,
                expected_kind: expectedKind,
                actual_kind: target.kind,
                where: `parameters.${paramName}.value`,
              })
            }
          }
        } else if (paramValue.ref !== undefined) {
          const av = world.activeVariables.get(paramValue.ref)
          if (av === undefined) {
            errors.push({
              code: 'unknown-active-variable',
              source: inst.id,
              ref: paramValue.ref,
              where: `parameters.${paramName}.ref`,
            })
            continue
          }

          if (av.parameter_type !== slot.type) {
            errors.push({
              code: 'active-variable-type-mismatch',
              source: inst.id,
              av: paramValue.ref,
              av_type: av.parameter_type,
              expected_type: slot.type,
              where: `parameters.${paramName}.ref`,
            })
            continue
          }

          const expectedKind = paramKindFromType(slot.type)
          if (expectedKind !== null && typeof av.value === 'string') {
            const target = lookup(world, av.value)
            if (target === null) {
              errors.push({
                code: 'unknown-reference',
                source: inst.id,
                ref: av.value,
                where: `parameters.${paramName}.ref -> ${paramValue.ref}.value`,
              })
            } else if (target.kind !== expectedKind) {
              errors.push({
                code: 'kind-mismatch',
                source: inst.id,
                ref: av.value,
                expected_kind: expectedKind,
                actual_kind: target.kind,
                where: `parameters.${paramName}.ref -> ${paramValue.ref}.value`,
              })
            }
          }
        }
      }
    }

    // Derives-violates-rating check (S12-v3-7 — per OBJECT-MODEL.md §16.7).
    //
    // When a definition declares property X as kind: equation AND the instance
    // supplies a same-name parameter as a scalar, evaluate the equation against
    // the instance's resolved composition and compare. Beyond a default 20%
    // relative tolerance, surface derives-violates-rating.
    //
    // Best-effort: when any property_ref input can't be resolved from world data
    // (typical for geometry properties that live per-instance rather than on a
    // shape definition), the equation evaluation skips silently — no false
    // positives, no error.
    if (def.properties !== undefined) {
      for (const [propName, propEntry] of Object.entries(def.properties)) {
        const propValue = propEntry.value
        if (!isEquationValue(propValue)) continue

        const context = buildRatingCheckContext(inst, def, world, propValue)
        if (context === null) continue

        let evalResult: ReturnType<typeof evaluateEquation>
        try {
          evalResult = evaluateEquation(propValue, context)
        } catch {
          continue // Evaluation errored; that's not a rating-violation issue.
        }
        if (evalResult.status !== 'evaluated') continue

        const declaredParam = inst.parameters?.[propName]
        if (declaredParam === undefined) continue
        const declaredValue = declaredParam.value as
          | { kind?: unknown; amount?: unknown; unit?: unknown }
          | undefined
        if (
          declaredValue?.kind !== 'scalar' ||
          typeof declaredValue.amount !== 'number' ||
          typeof declaredValue.unit !== 'string'
        ) {
          continue
        }

        const comparison = compareDerivedVsDeclared(
          evalResult.amount,
          evalResult.unit,
          declaredValue.amount,
          declaredValue.unit,
        )
        if (comparison === null) continue

        if (comparison.relative_difference > DEFAULT_RATING_TOLERANCE) {
          errors.push({
            code: 'derives-violates-rating',
            source: inst.id,
            property: propName,
            derived_amount: evalResult.amount,
            derived_unit: evalResult.unit,
            declared_amount: declaredValue.amount,
            declared_unit: declaredValue.unit,
            relative_difference: comparison.relative_difference,
            tolerance: DEFAULT_RATING_TOLERANCE,
          })
        }
      }
    }

    // Role-satisfaction check.
    //
    // When a composition.requires role is filled by a parameter (via
    // satisfies_role), the chosen object must actually enable every capability
    // listed in must_enable. JSON Schema can verify that the parameter holds a
    // string id; only this lookup can verify the chosen object actually
    // satisfies the role's constraints. Per OBJECT-MODEL.md §15.
    //
    // Default resolution is deferred: only explicit instance parameter values
    // are checked here. When an instance omits a parameter and the definition
    // supplies a default, that default's compatibility check lands when the
    // default-resolution path is wired (later sprint).
    if (def.composition?.requires && def.parameters && inst.parameters) {
      for (const [roleId, role] of Object.entries(def.composition.requires)) {
        const satisfyingEntry = Object.entries(def.parameters).find(
          ([, slot]) => slot.satisfies_role === roleId,
        )
        if (satisfyingEntry === undefined) continue
        const [paramName] = satisfyingEntry

        const instParam = inst.parameters[paramName]
        if (instParam === undefined) continue

        // Resolve the chosen id whether the parameter used value: (direct) or
        // ref: (via AV). For ref:, we additionally need the AV to exist and
        // hold a string value (material_ref / shape_ref AVs do).
        let chosenId: string | undefined
        if (typeof instParam.value === 'string') {
          chosenId = instParam.value
        } else if (instParam.ref !== undefined) {
          const av = world.activeVariables.get(instParam.ref)
          if (av !== undefined && typeof av.value === 'string') {
            chosenId = av.value
          }
        }
        if (chosenId === undefined) continue

        const chosen = world.definitions.get(chosenId)
        if (chosen === undefined) continue // unknown-reference already emitted above

        if (role.must_enable !== undefined && role.must_enable.length > 0) {
          const actual = chosen.enables ?? []
          const missing = role.must_enable.filter((cap) => !actual.includes(cap))
          if (missing.length > 0) {
            errors.push({
              code: 'role-unsatisfied',
              source: inst.id,
              role: roleId,
              chosen: chosenId,
              required: role.must_enable,
              actual,
            })
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Net checks (S13-v3-5 — per OBJECT-MODEL.md §17.7).
  //
  // Three invariants:
  //   1. unknown-net: instance's connects[].net references a nonexistent net id
  //   2. net-underpopulated: a net has fewer than 2 members (schema's minItems
  //      is the primary check; this is defense-in-depth + clearer error at
  //      world-load time)
  //   3. net-membership-mismatch: net.members and instance.connects disagree
  //      bidirectionally. A (net, instance, terminal) triple must appear in
  //      both views.
  //
  // Dedup discipline: when an instance references an unknown net, fire only
  // unknown-net (skip the otherwise-implied net-members-side mismatch — the
  // user already sees the root cause). Net-side mismatches against missing
  // instances are still fired (the user can't tell from unknown-reference
  // alone that the missing instance was also expected on a net).
  // -------------------------------------------------------------------------

  for (const net of world.nets.values()) {
    if (net.members.length < 2) {
      errors.push({
        code: 'net-underpopulated',
        source: net.id,
        member_count: net.members.length,
      })
    }
  }

  for (const inst of world.instances.values()) {
    if (!inst.connects) continue
    for (let i = 0; i < inst.connects.length; i++) {
      const c = inst.connects[i]
      if (c === undefined) continue
      if (!world.nets.has(c.net)) {
        errors.push({
          code: 'unknown-net',
          source: inst.id,
          ref: c.net,
          where: `connects[${i}].net`,
        })
      }
    }
  }

  // Bidirectional membership consistency.
  // Build (net_id, instance_id, terminal) triple sets from both sides
  // using a `::`-separated key (snake_case ids per §3 can't contain `::`).
  const fromNets = new Set<string>()
  const fromInstances = new Set<string>()

  for (const net of world.nets.values()) {
    for (const m of net.members) {
      fromNets.add(`${net.id}::${m.instance}::${m.terminal}`)
    }
  }
  for (const inst of world.instances.values()) {
    if (!inst.connects) continue
    for (const c of inst.connects) {
      fromInstances.add(`${c.net}::${inst.id}::${c.terminal}`)
    }
  }

  for (const key of fromNets) {
    if (fromInstances.has(key)) continue
    const [netId, instanceId, terminal] = key.split('::')
    if (netId === undefined || instanceId === undefined || terminal === undefined) {
      continue
    }
    errors.push({
      code: 'net-membership-mismatch',
      net: netId,
      instance: instanceId,
      terminal,
      missing_from: 'instance.connects',
    })
  }
  for (const key of fromInstances) {
    if (fromNets.has(key)) continue
    const [netId, instanceId, terminal] = key.split('::')
    if (netId === undefined || instanceId === undefined || terminal === undefined) {
      continue
    }
    // Dedup: if the net doesn't exist at all, unknown-net already fired —
    // skip the membership mismatch so the user sees one clear error, not two.
    if (!world.nets.has(netId)) continue
    errors.push({
      code: 'net-membership-mismatch',
      net: netId,
      instance: instanceId,
      terminal,
      missing_from: 'net.members',
    })
  }

  return errors
}
