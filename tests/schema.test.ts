import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import AjvModule from 'ajv/dist/2020.js'
import addFormatsModule from 'ajv-formats'
import { describe, expect, test } from 'vitest'
import { parse as parseYAML } from 'yaml'

// Ajv 8.x ships as CJS; the ESM default import gives us the module object.
// Unwrap .default to get the constructor / function.
// biome-ignore lint/suspicious/noExplicitAny: CJS interop for Ajv default export
const Ajv = (AjvModule as any).default ?? AjvModule
// biome-ignore lint/suspicious/noExplicitAny: CJS interop for ajv-formats default export
const addFormats = (addFormatsModule as any).default ?? addFormatsModule

const SCHEMA_DIR = 'schemas'
const FIXTURE_DIR = 'fixtures'

const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)

// Preload shared fragments so cross-schema $refs resolve.
for (const name of ['identity', 'provenance', 'quantity', 'support-status']) {
  const path = join(SCHEMA_DIR, `${name}.schema.json`)
  ajv.addSchema(JSON.parse(readFileSync(path, 'utf-8')))
}

const validateDefinition = ajv.compile(
  JSON.parse(readFileSync(join(SCHEMA_DIR, 'definition.schema.json'), 'utf-8')),
)
const validateInstance = ajv.compile(
  JSON.parse(readFileSync(join(SCHEMA_DIR, 'instance.schema.json'), 'utf-8')),
)
const validateBehavior = ajv.compile(
  JSON.parse(readFileSync(join(SCHEMA_DIR, 'behavior.schema.json'), 'utf-8')),
)
const validateActiveVariable = ajv.compile(
  JSON.parse(readFileSync(join(SCHEMA_DIR, 'active-variable.schema.json'), 'utf-8')),
)
const validateNet = ajv.compile(
  JSON.parse(readFileSync(join(SCHEMA_DIR, 'net.schema.json'), 'utf-8')),
)

function pickValidator(data: unknown) {
  if (data !== null && typeof data === 'object') {
    if ('kind' in data) {
      const kindValue = (data as Record<string, unknown>).kind
      // Behaviors, active variables, and nets each validate against their
      // own schemas; other kinds (material / shape / primitive_device / etc.)
      // use the definition schema.
      if (kindValue === 'behavior') {
        return { kind: 'behavior' as const, validator: validateBehavior }
      }
      if (kindValue === 'active_variable') {
        return { kind: 'active_variable' as const, validator: validateActiveVariable }
      }
      if (kindValue === 'net') {
        return { kind: 'net' as const, validator: validateNet }
      }
      return { kind: 'definition' as const, validator: validateDefinition }
    }
    if ('kind_ref' in data) return { kind: 'instance' as const, validator: validateInstance }
  }
  return null
}

describe('valid fixtures', () => {
  const validDir = join(FIXTURE_DIR, 'valid')
  const files = readdirSync(validDir).filter((f) => f.endsWith('.yaml'))

  for (const file of files) {
    test(`${file} validates against the right schema`, () => {
      const raw = readFileSync(join(validDir, file), 'utf-8')
      const data = parseYAML(raw) as unknown
      const picked = pickValidator(data)

      if (!picked) {
        throw new Error(
          `${file}: fixture has neither 'kind' (definition) nor 'kind_ref' (instance)`,
        )
      }

      const ok = picked.validator(data)
      if (!ok) {
        const errors = JSON.stringify(picked.validator.errors, null, 2)
        throw new Error(`${file} did NOT validate against ${picked.kind} schema:\n${errors}`)
      }
      expect(ok).toBe(true)
    })
  }
})

describe('invalid fixtures (anti-placeholder + §13 rule violations MUST fail)', () => {
  const invalidDir = join(FIXTURE_DIR, 'invalid')
  const files = readdirSync(invalidDir).filter((f) => f.endsWith('.yaml'))

  for (const file of files) {
    test(`${file} MUST fail validation`, () => {
      const raw = readFileSync(join(invalidDir, file), 'utf-8')
      const data = parseYAML(raw) as unknown
      const picked = pickValidator(data)

      if (!picked) {
        throw new Error(
          `${file}: fixture has neither 'kind' (definition) nor 'kind_ref' (instance)`,
        )
      }

      const ok = picked.validator(data)
      // If a fixture marked INVALID passes validation, the schema is too
      // permissive — the rule the fixture violates is not actually enforced.
      // The test fails loudly so the gap is obvious.
      if (ok) {
        throw new Error(
          `${file} unexpectedly PASSED ${picked.kind} validation. The rule it claims to violate is not enforced by the schema. Add the rule or move the fixture to fixtures/valid/.`,
        )
      }
      expect(ok).toBe(false)
    })
  }
})
