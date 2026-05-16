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

/**
 * Build an Ajv instance with all repo-root schemas pre-registered so
 * cross-schema $ref resolution works (e.g., materials.schema.json's
 * properties.{id}.value uses $ref: "provenance.schema.json#").
 */
function makeAjv(): Ajv {
  const ajv = new Ajv({ allErrors: true, strict: false })
  // Preload schemas that other schemas might $ref. Order matters only
  // for clarity; addSchema accepts any order.
  for (const name of ['provenance', 'signals', 'materials', 'shapes', 'interfaces', 'behaviors', 'parameters']) {
    const schemaPath = resolve(REPO_ROOT, `${name}.schema.json`)
    try {
      const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'))
      ajv.addSchema(schema, `${name}.schema.json`)
    } catch {
      // schema may not exist yet during early Sprint 2 sub-commits;
      // silent skip is fine
    }
  }
  return ajv
}

function validate(name: string): { ok: boolean; errors: unknown } {
  const ajv = makeAjv()
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

describe('materials.yaml manifest integrity', () => {
  it('validates against materials.schema.json (incl. $ref to provenance.schema.json)', () => {
    const { ok, errors } = validate('materials')
    if (!ok) {
      console.error('materials.yaml validation errors:', JSON.stringify(errors, null, 2))
    }
    expect(ok).toBe(true)
  })

  it('has at least 8 materials (the v2 MVP set)', () => {
    const manifest = loadManifest('materials') as unknown[]
    expect(Array.isArray(manifest)).toBe(true)
    expect(manifest.length).toBeGreaterThanOrEqual(8)
  })

  it('every material has at least one property', () => {
    const manifest = loadManifest('materials') as Array<{
      id: string
      properties: Record<string, unknown>
    }>
    for (const m of manifest) {
      expect(Object.keys(m.properties).length).toBeGreaterThan(0)
    }
  })

  it('every property carries source.type (per ADR-007 Sprint 2 rule for builtin)', () => {
    const manifest = loadManifest('materials') as Array<{
      id: string
      properties: Record<string, { source?: { type?: string } }>
    }>
    for (const m of manifest) {
      for (const [propName, prop] of Object.entries(m.properties)) {
        expect(prop.source, `material "${m.id}" property "${propName}" missing source`).toBeDefined()
        expect(prop.source!.type, `material "${m.id}" property "${propName}" missing source.type`).toBeDefined()
      }
    }
  })

  it('every property has a confidence rating (per ADR-007 Sprint 2 rule)', () => {
    const manifest = loadManifest('materials') as Array<{
      id: string
      properties: Record<string, { confidence?: string }>
    }>
    for (const m of manifest) {
      for (const [propName, prop] of Object.entries(m.properties)) {
        expect(prop.confidence, `material "${m.id}" property "${propName}" missing confidence`).toBeDefined()
      }
    }
  })

  it('every property has a citation (label + citation for non-user-supplied sources)', () => {
    const manifest = loadManifest('materials') as Array<{
      id: string
      properties: Record<
        string,
        { source?: { type?: string; label?: string; citation?: string } }
      >
    }>
    for (const m of manifest) {
      for (const [propName, prop] of Object.entries(m.properties)) {
        if (prop.source && prop.source.type !== 'user_supplied') {
          expect(prop.source.label, `material "${m.id}" prop "${propName}" missing source.label`).toBeDefined()
          // For shipped defaults, citation is required by the Sprint 2 rule
          expect(prop.source.citation, `material "${m.id}" prop "${propName}" missing source.citation`).toBeDefined()
        }
      }
    }
  })

  it('all ids are unique + use the allowed pattern', () => {
    const manifest = loadManifest('materials') as Array<{ id: string }>
    const ids = manifest.map((m) => m.id)
    expect(new Set(ids).size, 'duplicate material ids').toBe(ids.length)
    for (const id of ids) {
      expect(id, `material id "${id}" does not match pattern`).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/)
    }
  })

  it('includes the canonical MVP materials (copper, silicon, FR4)', () => {
    const manifest = loadManifest('materials') as Array<{ id: string }>
    const ids = new Set(manifest.map((m) => m.id))
    for (const required of ['copper', 'silicon_intrinsic', 'FR4']) {
      expect(ids, `missing canonical material: ${required}`).toContain(required)
    }
  })
})

describe('shapes.yaml manifest integrity', () => {
  it('validates against shapes.schema.json', () => {
    const { ok, errors } = validate('shapes')
    if (!ok) console.error('shapes errors:', JSON.stringify(errors, null, 2))
    expect(ok).toBe(true)
  })

  it('has at least 5 shape kinds (the v2 MVP set)', () => {
    const manifest = loadManifest('shapes') as unknown[]
    expect(manifest.length).toBeGreaterThanOrEqual(5)
  })

  it('every shape has at least one required parameter', () => {
    const manifest = loadManifest('shapes') as Array<{
      id: string
      parameters_required: unknown[]
    }>
    for (const s of manifest) {
      expect(s.parameters_required.length, `shape "${s.id}" has no required parameters`).toBeGreaterThan(0)
    }
  })

  it('all ids unique', () => {
    const manifest = loadManifest('shapes') as Array<{ id: string }>
    const ids = manifest.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('interfaces.yaml manifest integrity', () => {
  it('validates against interfaces.schema.json (incl. $ref to provenance)', () => {
    const { ok, errors } = validate('interfaces')
    if (!ok) console.error('interfaces errors:', JSON.stringify(errors, null, 2))
    expect(ok).toBe(true)
  })

  it('has at least 5 interface kinds (the v2 MVP set)', () => {
    const manifest = loadManifest('interfaces') as unknown[]
    expect(manifest.length).toBeGreaterThanOrEqual(5)
  })

  it('default_properties carry full provenance fragments where present', () => {
    const manifest = loadManifest('interfaces') as Array<{
      id: string
      default_properties?: Record<string, { source?: { type?: string } }>
    }>
    for (const i of manifest) {
      if (i.default_properties) {
        for (const [propName, prop] of Object.entries(i.default_properties)) {
          expect(prop.source, `interface "${i.id}" property "${propName}" missing source`).toBeDefined()
          expect(prop.source!.type, `interface "${i.id}" property "${propName}" missing source.type`).toBeDefined()
        }
      }
    }
  })

  it('all ids unique', () => {
    const manifest = loadManifest('interfaces') as Array<{ id: string }>
    const ids = manifest.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('includes canonical interface kinds (terminal, contact, solder_joint)', () => {
    const manifest = loadManifest('interfaces') as Array<{ id: string }>
    const ids = new Set(manifest.map((i) => i.id))
    for (const required of ['terminal', 'contact', 'solder_joint']) {
      expect(ids).toContain(required)
    }
  })
})

describe('behaviors.yaml manifest integrity', () => {
  it('validates against behaviors.schema.json', () => {
    const { ok, errors } = validate('behaviors')
    if (!ok) console.error('behaviors errors:', JSON.stringify(errors, null, 2))
    expect(ok).toBe(true)
  })

  it('has at least 7 behaviors (the v2 MVP set)', () => {
    const manifest = loadManifest('behaviors') as unknown[]
    expect(manifest.length).toBeGreaterThanOrEqual(7)
  })

  it('every behavior has an `evaluates` equation', () => {
    const manifest = loadManifest('behaviors') as Array<{
      id: string
      evaluates: string
    }>
    for (const b of manifest) {
      expect(b.evaluates, `behavior "${b.id}" missing evaluates`).toBeTruthy()
      expect(b.evaluates.length, `behavior "${b.id}" has empty evaluates`).toBeGreaterThan(0)
    }
  })

  it('consequences (when present) reference existing behavior ids', () => {
    const manifest = loadManifest('behaviors') as Array<{
      id: string
      consequences?: string[]
    }>
    const validIds = new Set(manifest.map((b) => b.id))
    for (const b of manifest) {
      for (const conseqId of b.consequences ?? []) {
        expect(validIds, `behavior "${b.id}" consequences reference unknown behavior "${conseqId}"`).toContain(conseqId)
      }
    }
  })

  it('all ids unique', () => {
    const manifest = loadManifest('behaviors') as Array<{ id: string }>
    const ids = manifest.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('includes the canonical MVP behaviors', () => {
    const manifest = loadManifest('behaviors') as Array<{ id: string }>
    const ids = new Set(manifest.map((b) => b.id))
    for (const required of ['conducts', 'resists', 'stores_charge', 'switches', 'heats', 'supplies_voltage', 'led_emits_light']) {
      expect(ids).toContain(required)
    }
  })
})

describe('parameters.yaml manifest integrity (default Active Variables)', () => {
  it('validates against parameters.schema.json', () => {
    const { ok, errors } = validate('parameters')
    if (!ok) console.error('parameters errors:', JSON.stringify(errors, null, 2))
    expect(ok).toBe(true)
  })

  it('has at least 20 default Active Variables (the canonical set)', () => {
    const manifest = loadManifest('parameters') as { variables: Record<string, unknown> }
    expect(Object.keys(manifest.variables).length).toBeGreaterThanOrEqual(20)
  })

  it('every variable has type + value + scope (the required fields)', () => {
    const manifest = loadManifest('parameters') as {
      variables: Record<string, { type: string; value: unknown; scope: string }>
    }
    for (const [name, v] of Object.entries(manifest.variables)) {
      expect(v.type, `variable "${name}" missing type`).toBeDefined()
      expect(v.value, `variable "${name}" missing value`).toBeDefined()
      expect(v.scope, `variable "${name}" missing scope`).toBeDefined()
    }
  })

  it('every type=quantity variable has units (the Sprint 2 rule)', () => {
    const manifest = loadManifest('parameters') as {
      variables: Record<string, { type: string; units?: string }>
    }
    for (const [name, v] of Object.entries(manifest.variables)) {
      if (v.type === 'quantity') {
        expect(v.units, `quantity variable "${name}" missing units`).toBeDefined()
      }
    }
  })

  it('every type=enum variable has allowed list with at least 1 value', () => {
    const manifest = loadManifest('parameters') as {
      variables: Record<string, { type: string; allowed?: string[]; value?: unknown }>
    }
    for (const [name, v] of Object.entries(manifest.variables)) {
      if (v.type === 'enum') {
        expect(v.allowed, `enum variable "${name}" missing allowed list`).toBeDefined()
        expect(v.allowed!.length, `enum variable "${name}" has empty allowed list`).toBeGreaterThan(0)
        expect(v.allowed, `enum variable "${name}" value not in allowed list`).toContain(v.value as string)
      }
    }
  })

  it('every shipped variable has a source (per ADR-007 Sprint 2 rule)', () => {
    const manifest = loadManifest('parameters') as {
      variables: Record<string, { source?: { type?: string; label?: string } }>
    }
    for (const [name, v] of Object.entries(manifest.variables)) {
      expect(v.source, `shipped variable "${name}" missing source`).toBeDefined()
      expect(v.source!.type, `shipped variable "${name}" missing source.type`).toBeDefined()
    }
  })

  it('every non-user-supplied source has a label + citation', () => {
    const manifest = loadManifest('parameters') as {
      variables: Record<
        string,
        { source?: { type?: string; label?: string; citation?: string } }
      >
    }
    for (const [name, v] of Object.entries(manifest.variables)) {
      if (v.source && v.source.type !== 'user_supplied') {
        expect(v.source.label, `variable "${name}" non-user source missing label`).toBeDefined()
        expect(v.source.citation, `variable "${name}" non-user source missing citation`).toBeDefined()
      }
    }
  })

  it('every variable has a confidence rating', () => {
    const manifest = loadManifest('parameters') as {
      variables: Record<string, { confidence?: string }>
    }
    for (const [name, v] of Object.entries(manifest.variables)) {
      expect(v.confidence, `variable "${name}" missing confidence`).toBeDefined()
    }
  })

  it('all variable names match snake_case pattern', () => {
    const manifest = loadManifest('parameters') as { variables: Record<string, unknown> }
    for (const name of Object.keys(manifest.variables)) {
      expect(name, `variable name "${name}" does not match snake_case`).toMatch(/^[a-z][a-z0-9_]*$/)
    }
  })

  it('includes the canonical defaults (ambient_temperature, default_supply_5v, target_max_led_current)', () => {
    const manifest = loadManifest('parameters') as { variables: Record<string, unknown> }
    const names = new Set(Object.keys(manifest.variables))
    for (const required of [
      'ambient_temperature',
      'default_supply_5v',
      'default_supply_3v3',
      'default_supply_9v',
      'target_max_led_current',
      'safety_derating_factor',
    ]) {
      expect(names, `missing canonical variable: ${required}`).toContain(required)
    }
  })

  it('scope values are within the 4-scope enum', () => {
    const manifest = loadManifest('parameters') as {
      variables: Record<string, { scope: string }>
    }
    const allowed = new Set(['project', 'block', 'release', 'simulation'])
    for (const [name, v] of Object.entries(manifest.variables)) {
      expect(allowed, `variable "${name}" has invalid scope "${v.scope}"`).toContain(v.scope)
    }
  })
})
