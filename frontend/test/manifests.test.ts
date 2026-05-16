/**
 * Manifest-integrity tests.
 *
 * Sprint 2 onward. Validates each repo-root manifest (signals,
 * materials, shapes, interfaces, behaviors, parameters) against its
 * sibling JSON Schema using ajv. Confirms cross-manifest foreign-key
 * references resolve. Confirms required fields are present.
 *
 * Each new manifest authored in Sprint 2 sub-commits (S2-2 through
 * S2-6) adds its own describe() block here. New manifests in later
 * sprints follow the same pattern.
 *
 * Tests run in Node environment (no DOM). Manifest YAML + schema
 * JSON live at repo root; this file resolves paths relative to the
 * repo root via `../` from `frontend/test/`.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import yaml from 'js-yaml'
import Ajv from 'ajv'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')

function loadManifest(name: string): unknown {
  const path = resolve(REPO_ROOT, `${name}.yaml`)
  const raw = readFileSync(path, 'utf-8')
  const parsed = yaml.load(raw)
  return parsed
}

function loadSchema(name: string): object {
  const path = resolve(REPO_ROOT, `${name}.schema.json`)
  const raw = readFileSync(path, 'utf-8')
  return JSON.parse(raw)
}

function validate(name: string): { ok: boolean; errors: unknown } {
  const ajv = new Ajv({ allErrors: true, strict: false })
  const schema = loadSchema(name)
  const manifest = loadManifest(name)
  const validator = ajv.compile(schema)
  const ok = validator(manifest)
  return { ok, errors: validator.errors }
}

describe('signals.yaml manifest integrity', () => {
  it('validates against signals.schema.json', () => {
    const { ok, errors } = validate('signals')
    if (!ok) {
      console.error('signals.yaml validation errors:', errors)
    }
    expect(ok).toBe(true)
  })

  it('has at least 8 signal types (the v2 MVP set)', () => {
    const manifest = loadManifest('signals') as unknown[]
    expect(Array.isArray(manifest)).toBe(true)
    expect(manifest.length).toBeGreaterThanOrEqual(8)
  })

  it('includes the canonical 8 signal types from ADR-006', () => {
    const manifest = loadManifest('signals') as Array<{ id: string }>
    const ids = manifest.map((row) => row.id)
    const required = [
      'dc-voltage',
      'dc-current',
      'analog-voltage',
      'digital',
      'optical',
      'thermal',
      'mechanical-force',
      'ground',
    ]
    for (const id of required) {
      expect(ids).toContain(id)
    }
  })

  it('all `compatible_with` references resolve to existing signal ids', () => {
    const manifest = loadManifest('signals') as Array<{
      id: string
      compatible_with?: string[]
    }>
    const validIds = new Set(manifest.map((row) => row.id))
    for (const row of manifest) {
      for (const compatId of row.compatible_with ?? []) {
        expect(validIds, `signal "${row.id}" references unknown signal "${compatId}"`).toContain(compatId)
      }
    }
  })

  it('all ids are unique', () => {
    const manifest = loadManifest('signals') as Array<{ id: string }>
    const ids = manifest.map((row) => row.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
