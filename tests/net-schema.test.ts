/**
 * Net schema tests.
 *
 * Direct schema validation for the net object kind introduced in
 * OBJECT-MODEL.md §17 — Sprint 13. Covers valid shapes (minimum,
 * full, type variants) and invalid shapes (required-field
 * violations, members.minItems violations, additionalProperties
 * violations, type-enum violations, terminal-empty-string).
 *
 * World-level fixture validation lives in tests/schema.test.ts;
 * this file exercises the net schema in isolation.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import AjvModule from 'ajv/dist/2020.js'
import addFormatsModule from 'ajv-formats'
import { describe, expect, test } from 'vitest'

// biome-ignore lint/suspicious/noExplicitAny: CJS interop for Ajv default export
const Ajv = (AjvModule as any).default ?? AjvModule
// biome-ignore lint/suspicious/noExplicitAny: CJS interop for ajv-formats default export
const addFormats = (addFormatsModule as any).default ?? addFormatsModule

const SCHEMA_DIR = 'schemas'

const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)

// Preload shared fragments so $refs resolve when compiling the net schema.
for (const name of ['identity', 'provenance', 'quantity', 'support-status', 'net']) {
  const path = join(SCHEMA_DIR, `${name}.schema.json`)
  ajv.addSchema(JSON.parse(readFileSync(path, 'utf-8')))
}

const validateNet = ajv.getSchema('https://chipblocks.example/schemas/net.schema.json')
if (!validateNet) {
  throw new Error('net.schema.json failed to load')
}

// ===========================================================================
// Valid shapes
// ===========================================================================

describe('net schema — valid shapes', () => {
  test('minimal: id + kind + origin + 2 members', () => {
    const valid = {
      id: 'net_minimal',
      kind: 'net',
      origin: 'project',
      members: [
        { instance: 'inst_a', terminal: 'out' },
        { instance: 'inst_b', terminal: 'in' },
      ],
    }
    expect(validateNet(valid)).toBe(true)
  })

  test('full: minimum required + all optional fields', () => {
    const valid = {
      id: 'net_full',
      kind: 'net',
      origin: 'project',
      type: 'signal',
      description: 'A net with all optional fields populated for the test.',
      members: [
        { instance: 'inst_a', terminal: 'out' },
        { instance: 'inst_b', terminal: 'in' },
      ],
      extensions: {
        overridable: true,
        user_extensible: true,
        allowed_origins: ['builtin', 'community', 'user_local', 'project'],
      },
    }
    expect(validateNet(valid)).toBe(true)
  })

  test('three members (more than the minimum)', () => {
    const valid = {
      id: 'net_three',
      kind: 'net',
      origin: 'project',
      members: [
        { instance: 'inst_a', terminal: 'out' },
        { instance: 'inst_b', terminal: 'in' },
        { instance: 'inst_c', terminal: 'sense' },
      ],
    }
    expect(validateNet(valid)).toBe(true)
  })

  test('each type-enum value accepted', () => {
    for (const type of ['signal', 'power', 'ground', 'analog', 'digital']) {
      const valid = {
        id: `net_${type}`,
        kind: 'net',
        origin: 'project',
        type,
        members: [
          { instance: 'inst_a', terminal: 'out' },
          { instance: 'inst_b', terminal: 'in' },
        ],
      }
      expect(validateNet(valid)).toBe(true)
    }
  })
})

// ===========================================================================
// Invalid shapes — required-field violations
// ===========================================================================

describe('net schema — required field violations', () => {
  test('missing id', () => {
    const invalid = {
      kind: 'net',
      origin: 'project',
      members: [
        { instance: 'inst_a', terminal: 'out' },
        { instance: 'inst_b', terminal: 'in' },
      ],
    }
    expect(validateNet(invalid)).toBe(false)
  })

  test('missing kind', () => {
    const invalid = {
      id: 'net_x',
      origin: 'project',
      members: [
        { instance: 'inst_a', terminal: 'out' },
        { instance: 'inst_b', terminal: 'in' },
      ],
    }
    expect(validateNet(invalid)).toBe(false)
  })

  test('missing origin', () => {
    const invalid = {
      id: 'net_x',
      kind: 'net',
      members: [
        { instance: 'inst_a', terminal: 'out' },
        { instance: 'inst_b', terminal: 'in' },
      ],
    }
    expect(validateNet(invalid)).toBe(false)
  })

  test('missing members', () => {
    const invalid = {
      id: 'net_x',
      kind: 'net',
      origin: 'project',
    }
    expect(validateNet(invalid)).toBe(false)
  })

  test('kind: const "net" enforced — reject other kinds', () => {
    const invalid = {
      id: 'net_x',
      kind: 'definition', // wrong kind
      origin: 'project',
      members: [
        { instance: 'inst_a', terminal: 'out' },
        { instance: 'inst_b', terminal: 'in' },
      ],
    }
    expect(validateNet(invalid)).toBe(false)
  })
})

// ===========================================================================
// Invalid shapes — members violations
// ===========================================================================

describe('net schema — members violations', () => {
  test('empty members array (minItems: 2 enforced)', () => {
    const invalid = {
      id: 'net_x',
      kind: 'net',
      origin: 'project',
      members: [],
    }
    expect(validateNet(invalid)).toBe(false)
  })

  test('one-member net (minItems: 2 enforced)', () => {
    const invalid = {
      id: 'net_x',
      kind: 'net',
      origin: 'project',
      members: [{ instance: 'inst_a', terminal: 'out' }],
    }
    expect(validateNet(invalid)).toBe(false)
  })

  test('member missing instance', () => {
    const invalid = {
      id: 'net_x',
      kind: 'net',
      origin: 'project',
      members: [{ terminal: 'out' }, { instance: 'inst_b', terminal: 'in' }],
    }
    expect(validateNet(invalid)).toBe(false)
  })

  test('member missing terminal', () => {
    const invalid = {
      id: 'net_x',
      kind: 'net',
      origin: 'project',
      members: [{ instance: 'inst_a' }, { instance: 'inst_b', terminal: 'in' }],
    }
    expect(validateNet(invalid)).toBe(false)
  })

  test('member with empty-string terminal (minLength: 1 enforced)', () => {
    const invalid = {
      id: 'net_x',
      kind: 'net',
      origin: 'project',
      members: [
        { instance: 'inst_a', terminal: '' },
        { instance: 'inst_b', terminal: 'in' },
      ],
    }
    expect(validateNet(invalid)).toBe(false)
  })

  test('member with extra forbidden property', () => {
    const invalid = {
      id: 'net_x',
      kind: 'net',
      origin: 'project',
      members: [
        { instance: 'inst_a', terminal: 'out', polarity: 'positive' },
        { instance: 'inst_b', terminal: 'in' },
      ],
    }
    expect(validateNet(invalid)).toBe(false)
  })
})

// ===========================================================================
// Invalid shapes — type and additionalProperties
// ===========================================================================

describe('net schema — type + additionalProperties enforcement', () => {
  test('type enum violation — unknown classification', () => {
    const invalid = {
      id: 'net_x',
      kind: 'net',
      origin: 'project',
      type: 'mixed_signal', // not in the Sprint 13 enum
      members: [
        { instance: 'inst_a', terminal: 'out' },
        { instance: 'inst_b', terminal: 'in' },
      ],
    }
    expect(validateNet(invalid)).toBe(false)
  })

  test('top-level rejects unknown property', () => {
    const invalid = {
      id: 'net_x',
      kind: 'net',
      origin: 'project',
      members: [
        { instance: 'inst_a', terminal: 'out' },
        { instance: 'inst_b', terminal: 'in' },
      ],
      bogus_field: 'should be rejected',
    }
    expect(validateNet(invalid)).toBe(false)
  })
})
