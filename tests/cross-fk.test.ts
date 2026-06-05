/**
 * Cross-FK validator tests.
 *
 * The schema test (tests/schema.test.ts) validates each fixture's SHAPE in
 * isolation. This test exercises cross-references — that ids resolve, that
 * referenced objects have the right kind, that role constraints are satisfied
 * by the chosen object's enables list.
 *
 * Sprint 3 ships with one valid-world test here. S3-v3-6 lands the invalid-world
 * fixtures + must-fail tests (one per CrossFkError code).
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { parse as parseYAML } from 'yaml'
import {
  type ActiveVariableEntry,
  type BehaviorEntry,
  type Definition,
  type Instance,
  validateWorld,
  type World,
} from '../src/cross-fk-validator.ts'

const FIXTURE_DIR = 'fixtures'

/**
 * Load every *.yaml in `dir` and sort each into the appropriate World map by kind.
 * Assumes upstream schema validation has already approved the shapes.
 */
function loadWorld(dir: string): World {
  const definitions = new Map<string, Definition>()
  const instances = new Map<string, Instance>()
  const behaviors = new Map<string, BehaviorEntry>()
  const activeVariables = new Map<string, ActiveVariableEntry>()

  const files = readdirSync(dir).filter((f) => f.endsWith('.yaml'))
  for (const file of files) {
    const raw = readFileSync(join(dir, file), 'utf-8')
    const data = parseYAML(raw) as Record<string, unknown>
    const id = typeof data.id === 'string' ? data.id : undefined
    if (id === undefined) {
      throw new Error(`${file}: missing or non-string 'id' field`)
    }

    if (data.kind === 'behavior') {
      behaviors.set(id, data as unknown as BehaviorEntry)
    } else if (data.kind === 'active_variable') {
      activeVariables.set(id, data as unknown as ActiveVariableEntry)
    } else if ('kind' in data) {
      definitions.set(id, data as unknown as Definition)
    } else if ('kind_ref' in data) {
      instances.set(id, data as unknown as Instance)
    } else {
      throw new Error(`${file}: fixture has neither 'kind' nor 'kind_ref'`)
    }
  }

  return { definitions, instances, behaviors, activeVariables }
}

/** Get a known entity from a Map or throw a descriptive error. */
function getOrThrow<V>(m: Map<string, V>, k: string, what: string): V {
  const v = m.get(k)
  if (v === undefined) {
    throw new Error(`${what}: expected '${k}' in the base world but it was missing`)
  }
  return v
}

describe('cross-FK validator', () => {
  test('valid world reports zero cross-FK errors', () => {
    const world = loadWorld(join(FIXTURE_DIR, 'valid'))
    const errors = validateWorld(world)
    if (errors.length > 0) {
      const summary = errors.map((e) => JSON.stringify(e)).join('\n')
      throw new Error(
        `Cross-FK validator reported ${errors.length} unexpected error(s) on the valid world:\n${summary}`,
      )
    }
    expect(errors).toEqual([])
  })
})

describe('cross-FK validator — invalid worlds (one per error code MUST fire)', () => {
  test('unknown-reference: instance picks a material id that does not exist', () => {
    const world = loadWorld(join(FIXTURE_DIR, 'valid'))
    const wire001 = getOrThrow(world.instances, 'wire_001', 'unknown-reference test')
    wire001.parameters = {
      ...wire001.parameters,
      conductor_material: { value: 'nonexistent_material' },
    }
    const errors = validateWorld(world)
    const hit = errors.find(
      (e) =>
        e.code === 'unknown-reference' &&
        e.source === 'wire_001' &&
        e.ref === 'nonexistent_material',
    )
    expect(hit).toBeDefined()
  })

  test('kind-mismatch: instance points at an object of the wrong kind', () => {
    const world = loadWorld(join(FIXTURE_DIR, 'valid'))
    const wire001 = getOrThrow(world.instances, 'wire_001', 'kind-mismatch test')
    // 'wire' exists as a primitive_device definition; expected here is a material.
    wire001.parameters = {
      ...wire001.parameters,
      conductor_material: { value: 'wire' },
    }
    const errors = validateWorld(world)
    const hit = errors.find(
      (e) =>
        e.code === 'kind-mismatch' &&
        e.source === 'wire_001' &&
        e.ref === 'wire' &&
        e.expected_kind === 'material' &&
        e.actual_kind === 'primitive_device',
    )
    expect(hit).toBeDefined()
  })

  test('unknown-behavior: device claims a behavior id not in the registry', () => {
    const world = loadWorld(join(FIXTURE_DIR, 'valid'))
    const wireDef = getOrThrow(world.definitions, 'wire', 'unknown-behavior test')
    wireDef.behaviors = ['nonexistent_behavior']
    const errors = validateWorld(world)
    const hit = errors.find(
      (e) =>
        e.code === 'unknown-behavior' &&
        e.source === 'wire' &&
        e.behavior === 'nonexistent_behavior',
    )
    expect(hit).toBeDefined()
  })

  test('role-unsatisfied: chosen material does not enable the required capability', () => {
    const world = loadWorld(join(FIXTURE_DIR, 'valid'))
    // Add an insulator: exists as a material, kind matches, but doesn't enable
    // electrical_conduction. role-satisfaction must catch this.
    world.definitions.set('rubber_insulator', {
      id: 'rubber_insulator',
      kind: 'material',
      layer: 'material',
      enables: ['electrical_insulation'],
    } satisfies Definition)
    const wire001 = getOrThrow(world.instances, 'wire_001', 'role-unsatisfied test')
    wire001.parameters = {
      ...wire001.parameters,
      conductor_material: { value: 'rubber_insulator' },
    }
    const errors = validateWorld(world)
    const hit = errors.find(
      (e) =>
        e.code === 'role-unsatisfied' &&
        e.source === 'wire_001' &&
        e.role === 'conductor_material' &&
        e.chosen === 'rubber_insulator' &&
        e.required.includes('electrical_conduction'),
    )
    expect(hit).toBeDefined()
  })

  test('unknown-active-variable: instance uses ref: pointing at a missing AV', () => {
    const world = loadWorld(join(FIXTURE_DIR, 'valid'))
    const joint001 = getOrThrow(world.instances, 'solder_joint_001', 'unknown-active-variable test')
    joint001.parameters = {
      ...joint001.parameters,
      solder_material: { ref: 'nonexistent_av' },
    }
    const errors = validateWorld(world)
    const hit = errors.find(
      (e) =>
        e.code === 'unknown-active-variable' &&
        e.source === 'solder_joint_001' &&
        e.ref === 'nonexistent_av',
    )
    expect(hit).toBeDefined()
  })

  test('active-variable-type-mismatch: AV.parameter_type does not match slot.type', () => {
    const world = loadWorld(join(FIXTURE_DIR, 'valid'))
    // default_resistor_tolerance is parameter_type: quantity.
    // solder_joint_001's solder_material slot is type: material_ref.
    // Pointing the joint's material role at the quantity AV must fire mismatch.
    const joint001 = getOrThrow(
      world.instances,
      'solder_joint_001',
      'active-variable-type-mismatch test',
    )
    joint001.parameters = {
      ...joint001.parameters,
      solder_material: { ref: 'default_resistor_tolerance' },
    }
    const errors = validateWorld(world)
    const hit = errors.find(
      (e) =>
        e.code === 'active-variable-type-mismatch' &&
        e.source === 'solder_joint_001' &&
        e.av === 'default_resistor_tolerance' &&
        e.av_type === 'quantity' &&
        e.expected_type === 'material_ref',
    )
    expect(hit).toBeDefined()
  })

  test('state-machine-invalid-transition: transition references undeclared state', () => {
    const world = loadWorld(join(FIXTURE_DIR, 'valid'))
    const switchDef = getOrThrow(
      world.definitions,
      'switch_spst_toggle',
      'state-machine-invalid-transition test',
    )
    // Mutate the first transition's 'from' to a state that doesn't exist
    // in the device's declared states (open, closed).
    if (switchDef.state_machine !== undefined) {
      const firstTransition = switchDef.state_machine.transitions[0]
      if (firstTransition !== undefined) {
        firstTransition.from = 'nonexistent_state'
      }
    }
    const errors = validateWorld(world)
    const hit = errors.find(
      (e) =>
        e.code === 'state-machine-invalid-transition' &&
        e.source === 'switch_spst_toggle' &&
        e.invalid_ref === 'nonexistent_state' &&
        e.where === 'state_machine.transitions[0].from' &&
        e.declared_states.includes('open') &&
        e.declared_states.includes('closed'),
    )
    expect(hit).toBeDefined()
  })

  test('role-unsatisfied (Sprint 9): LED picks copper for n_side — not a semiconductor', () => {
    // Sprint 9 refactored led to compose pn_junction with n_side / p_side
    // material roles. The roles require n_type_semiconductor / p_type_semiconductor.
    // Choosing copper (which only enables electrical_conduction + thermal_conduction)
    // for n_side must fire role-unsatisfied. This is the new check the
    // pn_junction promotion + role-based composition unlocks — the old
    // composition.uses pattern couldn't catch this.
    const world = loadWorld(join(FIXTURE_DIR, 'valid'))
    const led001 = getOrThrow(world.instances, 'led_001', 'Sprint 9 LED role test')
    led001.parameters = {
      ...led001.parameters,
      n_side: { value: 'copper' },
    }
    const errors = validateWorld(world)
    const hit = errors.find(
      (e) =>
        e.code === 'role-unsatisfied' &&
        e.source === 'led_001' &&
        e.role === 'n_side' &&
        e.chosen === 'copper' &&
        e.required.includes('n_type_semiconductor'),
    )
    expect(hit).toBeDefined()
  })
})
