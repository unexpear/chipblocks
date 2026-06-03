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
    } else if ('kind' in data) {
      definitions.set(id, data as unknown as Definition)
    } else if ('kind_ref' in data) {
      instances.set(id, data as unknown as Instance)
    } else {
      throw new Error(`${file}: fixture has neither 'kind' nor 'kind_ref'`)
    }
  }

  return { definitions, instances, behaviors }
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
