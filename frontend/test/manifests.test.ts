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

describe('provenance.schema.json shared fragment', () => {
  it('parses as valid JSON Schema draft-07', () => {
    const schema = loadSchema('provenance')
    const ajv = new Ajv({ allErrors: true, strict: false })
    // ajv compile validates the schema is well-formed
    expect(() => ajv.compile(schema)).not.toThrow()
  })

  it('accepts a minimal valid value-with-provenance object', () => {
    const ajv = new Ajv({ allErrors: true, strict: false })
    const validate = ajv.compile(loadSchema('provenance'))
    const minimal = { value: 9.0, units: 'V' }
    const ok = validate(minimal)
    if (!ok) console.error('minimal validation errors:', validate.errors)
    expect(ok).toBe(true)
  })

  it('accepts a fully-populated builtin-grade value', () => {
    const ajv = new Ajv({ allErrors: true, strict: false })
    const validate = ajv.compile(loadSchema('provenance'))
    const full = {
      value: 1.68e-8,
      units: 'ohm_meter',
      source: {
        type: 'standard',
        label: 'Copper resistivity at 20 C',
        citation: 'NIST CODATA 2018; IEC 60028 annealed copper standard',
      },
      conditions: {
        temperature: { value: 20, units: 'degC' },
      },
      confidence: 'high',
      tolerance: { min: 1.65e-8, max: 1.72e-8, distribution: 'normal' },
      notes: 'For high-temperature designs, derate per R(T) = R20 * (1 + alpha * (T - 20)).',
    }
    const ok = validate(full)
    if (!ok) console.error('full validation errors:', validate.errors)
    expect(ok).toBe(true)
  })

  it('rejects unknown source.type values', () => {
    const ajv = new Ajv({ allErrors: true, strict: false })
    const validate = ajv.compile(loadSchema('provenance'))
    const bad = {
      value: 1,
      units: 'V',
      source: { type: 'wikipedia', label: 'invalid source type' },
    }
    expect(validate(bad)).toBe(false)
  })

  it('rejects unknown confidence levels', () => {
    const ajv = new Ajv({ allErrors: true, strict: false })
    const validate = ajv.compile(loadSchema('provenance'))
    const bad = { value: 1, units: 'V', confidence: 'very-sure' }
    expect(validate(bad)).toBe(false)
  })

  it('accepts a string-valued condition (e.g., state_of_charge: full)', () => {
    const ajv = new Ajv({ allErrors: true, strict: false })
    const validate = ajv.compile(loadSchema('provenance'))
    const stringCondition = {
      value: 9.0,
      units: 'V',
      conditions: { state_of_charge: 'full' },
    }
    const ok = validate(stringCondition)
    if (!ok) console.error('string-condition validation errors:', validate.errors)
    expect(ok).toBe(true)
  })

  it('rejects extra top-level fields (additionalProperties: false)', () => {
    const ajv = new Ajv({ allErrors: true, strict: false })
    const validate = ajv.compile(loadSchema('provenance'))
    const withExtra = { value: 1, units: 'V', unknown_field: 'oops' }
    expect(validate(withExtra)).toBe(false)
  })
})

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
