/**
 * Equation value-kind schema tests.
 *
 * The schema tightening in S12-v3-4 changes `inputs` from
 * accept-anything to a discriminated union (constant / property_ref /
 * input_variable). This file directly exercises the JSON Schema's
 * `equation` $def to confirm valid shapes pass and malformed shapes
 * get rejected — independent of fixture validation in schema.test.ts,
 * which covers the fixtures-pass-the-full-schema layer.
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

// Preload all shared fragments — equation doesn't reference any of them,
// but consistency with the rest of the test suite avoids resolution surprises.
for (const name of ['identity', 'provenance', 'quantity', 'support-status']) {
  const path = join(SCHEMA_DIR, `${name}.schema.json`)
  ajv.addSchema(JSON.parse(readFileSync(path, 'utf-8')))
}

const validateEquation = ajv.compile({
  $ref: 'https://chipblocks.example/schemas/quantity.schema.json#/$defs/equation',
})

// ===========================================================================
// Valid shapes
// ===========================================================================

describe('equation schema — valid shapes', () => {
  test('minimal: kind + expression + inputs + output_unit (constants only)', () => {
    const valid = {
      kind: 'equation',
      expression: 'a + b',
      inputs: {
        a: { kind: 'constant', amount: 1, unit: 'V' },
        b: { kind: 'constant', amount: 2, unit: 'V' },
      },
      output_unit: 'V',
    }
    expect(validateEquation(valid)).toBe(true)
  })

  test('property_ref inputs (R = rho * L / A)', () => {
    const valid = {
      kind: 'equation',
      expression: 'rho * L / A',
      inputs: {
        rho: { kind: 'property_ref', path: 'material.resistivity' },
        L: { kind: 'property_ref', path: 'geometry.length' },
        A: { kind: 'property_ref', path: 'geometry.cross_section_area' },
      },
      output_unit: 'ohm',
    }
    expect(validateEquation(valid)).toBe(true)
  })

  test('input_variable input (parametric form ρ(T))', () => {
    const valid = {
      kind: 'equation',
      expression: 'rho_0 * (1 + alpha * (T - T_0))',
      inputs: {
        rho_0: { kind: 'constant', amount: 1.68e-8, unit: 'ohm m' },
        alpha: { kind: 'constant', amount: 0.00393, unit: '1/K' },
        T_0: { kind: 'constant', amount: 293.15, unit: 'K' },
        T: { kind: 'input_variable', unit: 'K' },
      },
      output_unit: 'ohm m',
    }
    expect(validateEquation(valid)).toBe(true)
  })

  test('input_variable with default', () => {
    const valid = {
      kind: 'equation',
      expression: 'h * f',
      inputs: {
        h: { kind: 'constant', amount: 6.62607015e-34, unit: 'J s' },
        f: { kind: 'input_variable', unit: 'Hz', default: 1e9 },
      },
      output_unit: 'J',
    }
    expect(validateEquation(valid)).toBe(true)
  })

  test('with constants_used (LED λ = h * c / E_g)', () => {
    const valid = {
      kind: 'equation',
      expression: 'h * c / E_g',
      inputs: {
        E_g: { kind: 'property_ref', path: 'composition.active.bandgap_energy' },
      },
      constants_used: ['h', 'c'],
      output_unit: 'm',
    }
    expect(validateEquation(valid)).toBe(true)
  })

  test('with conditions block', () => {
    const valid = {
      kind: 'equation',
      expression: 'rho_0',
      inputs: {
        rho_0: { kind: 'constant', amount: 1.68e-8, unit: 'ohm m' },
      },
      output_unit: 'ohm m',
      conditions: { temperature: { amount: 20, unit: 'degC' } },
    }
    expect(validateEquation(valid)).toBe(true)
  })

  test('with notes', () => {
    const valid = {
      kind: 'equation',
      expression: 'a',
      inputs: { a: { kind: 'constant', amount: 1, unit: 'V' } },
      output_unit: 'V',
      notes: 'Demonstration formula with a free-text note.',
    }
    expect(validateEquation(valid)).toBe(true)
  })

  test('mixed input kinds — constant + property_ref + input_variable', () => {
    const valid = {
      kind: 'equation',
      expression: 'k * rho * L / A * (1 + alpha * T)',
      inputs: {
        k: { kind: 'constant', amount: 1.0, unit: '1' },
        rho: { kind: 'property_ref', path: 'material.resistivity' },
        L: { kind: 'property_ref', path: 'geometry.length' },
        A: { kind: 'property_ref', path: 'geometry.cross_section_area' },
        alpha: { kind: 'constant', amount: 0.00393, unit: '1/K' },
        T: { kind: 'input_variable', unit: 'K' },
      },
      output_unit: 'ohm',
    }
    expect(validateEquation(valid)).toBe(true)
  })
})

// ===========================================================================
// Invalid shapes — required-field violations
// ===========================================================================

describe('equation schema — required field violations', () => {
  test('missing expression', () => {
    const invalid = {
      kind: 'equation',
      inputs: { a: { kind: 'constant', amount: 1, unit: 'V' } },
      output_unit: 'V',
    }
    expect(validateEquation(invalid)).toBe(false)
  })

  test('missing inputs', () => {
    const invalid = {
      kind: 'equation',
      expression: 'a',
      output_unit: 'V',
    }
    expect(validateEquation(invalid)).toBe(false)
  })

  test('missing output_unit', () => {
    const invalid = {
      kind: 'equation',
      expression: 'a',
      inputs: { a: { kind: 'constant', amount: 1, unit: 'V' } },
    }
    expect(validateEquation(invalid)).toBe(false)
  })

  test('empty inputs object (minProperties: 1 enforced)', () => {
    const invalid = {
      kind: 'equation',
      expression: '42',
      inputs: {},
      output_unit: 'V',
    }
    expect(validateEquation(invalid)).toBe(false)
  })

  test('empty expression string (minLength: 1 enforced)', () => {
    const invalid = {
      kind: 'equation',
      expression: '',
      inputs: { a: { kind: 'constant', amount: 1, unit: 'V' } },
      output_unit: 'V',
    }
    expect(validateEquation(invalid)).toBe(false)
  })

  test('empty output_unit string (dimensionless must be "1" or "dimensionless")', () => {
    const invalid = {
      kind: 'equation',
      expression: 'a',
      inputs: { a: { kind: 'constant', amount: 1, unit: 'V' } },
      output_unit: '',
    }
    expect(validateEquation(invalid)).toBe(false)
  })
})

// ===========================================================================
// Invalid shapes — input discriminator violations
// ===========================================================================

describe('equation schema — input discriminator violations', () => {
  test('input with unknown kind', () => {
    const invalid = {
      kind: 'equation',
      expression: 'a',
      inputs: { a: { kind: 'mystery', amount: 1, unit: 'V' } },
      output_unit: 'V',
    }
    expect(validateEquation(invalid)).toBe(false)
  })

  test('input with no kind field at all', () => {
    const invalid = {
      kind: 'equation',
      expression: 'a',
      inputs: { a: { amount: 1, unit: 'V' } },
      output_unit: 'V',
    }
    expect(validateEquation(invalid)).toBe(false)
  })

  test('property_ref input missing path', () => {
    const invalid = {
      kind: 'equation',
      expression: 'rho',
      inputs: { rho: { kind: 'property_ref' } },
      output_unit: 'ohm m',
    }
    expect(validateEquation(invalid)).toBe(false)
  })

  test('constant input missing amount', () => {
    const invalid = {
      kind: 'equation',
      expression: 'a',
      inputs: { a: { kind: 'constant', unit: 'V' } },
      output_unit: 'V',
    }
    expect(validateEquation(invalid)).toBe(false)
  })

  test('constant input missing unit', () => {
    const invalid = {
      kind: 'equation',
      expression: 'a',
      inputs: { a: { kind: 'constant', amount: 1 } },
      output_unit: 'V',
    }
    expect(validateEquation(invalid)).toBe(false)
  })

  test('input_variable missing unit', () => {
    const invalid = {
      kind: 'equation',
      expression: 'T',
      inputs: { T: { kind: 'input_variable' } },
      output_unit: 'K',
    }
    expect(validateEquation(invalid)).toBe(false)
  })

  test('property_ref input with extra forbidden property', () => {
    const invalid = {
      kind: 'equation',
      expression: 'rho',
      inputs: {
        rho: { kind: 'property_ref', path: 'material.resistivity', amount: 1 },
      },
      output_unit: 'ohm m',
    }
    expect(validateEquation(invalid)).toBe(false)
  })
})

// ===========================================================================
// Invalid shapes — top-level additionalProperties violation
// ===========================================================================

describe('equation schema — additionalProperties enforcement', () => {
  test('top-level rejects unknown property', () => {
    const invalid = {
      kind: 'equation',
      expression: 'a',
      inputs: { a: { kind: 'constant', amount: 1, unit: 'V' } },
      output_unit: 'V',
      bogus_field: 'should be rejected',
    }
    expect(validateEquation(invalid)).toBe(false)
  })

  test('rejects provenance INSIDE equation block — provenance lives at property level', () => {
    // §16.2 spec: provenance is the sibling of `value:` on the property,
    // NOT a field inside the equation. The schema's additionalProperties: false
    // catches this for any maintainer who tries to nest it.
    const invalid = {
      kind: 'equation',
      expression: 'a',
      inputs: { a: { kind: 'constant', amount: 1, unit: 'V' } },
      output_unit: 'V',
      provenance: {
        source_type: 'reference',
        title: 'Test',
        citation: 'Test',
        confidence: 'high',
      },
    }
    expect(validateEquation(invalid)).toBe(false)
  })
})
