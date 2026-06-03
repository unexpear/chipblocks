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
})
