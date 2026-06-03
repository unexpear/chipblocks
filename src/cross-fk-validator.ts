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
 * Per the "real all the way down" principle: this validator does not fake a green
 * light by absence. Every check either confirms a constraint holds with a real lookup,
 * or emits a structured error explaining why. There is no implicit pass.
 */

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

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export type World = {
  definitions: Map<string, Definition>
  instances: Map<string, Instance>
  behaviors: Map<string, BehaviorEntry>
  activeVariables: Map<string, ActiveVariableEntry>
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

  return errors
}
