/**
 * Equation evaluator tests.
 *
 * Covers:
 *   1. The mathjs unit-algebra SMOKE TEST — verifies mathjs's unit algebra
 *      works as the §16 spec assumes (ohm·m × m / m² simplifies to ohm).
 *      If this fails, the whole evaluation strategy needs a pivot.
 *   2. End-to-end evaluation of the three first concrete cases (R = ρL/A,
 *      λ = hc/E_g, C = ε₀ε_r·A/d) via the evaluator wrapper.
 *   3. Error paths — unit mismatch, unresolved input, unknown constant,
 *      expression syntax error, unknown unit.
 *   4. The input_variable deferred-evaluation path (Sprint 12 returns
 *      a deferred-evaluation status rather than evaluating parametric forms).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { parse as parseYAML } from 'yaml'
import {
  EquationEvalError,
  type EquationValue,
  evaluateEquation,
  mathInstance as math,
} from '../src/equation-evaluator.ts'

// ===========================================================================
// 1. mathjs unit-algebra smoke test
// ===========================================================================

describe('mathjs unit-algebra smoke', () => {
  test('resistor dimensional propagation: ohm·m × m / m² simplifies to ohm', () => {
    // The §16 spec's load-bearing assumption: mathjs propagates units through
    // multiplication and division and simplifies the result. If this is broken,
    // the whole equation-kind evaluation strategy needs a pivot.
    const rho = math.unit(2, 'ohm m')
    const length = math.unit(3, 'm')
    const area = math.unit(6, 'm^2')
    const result = math.evaluate('rho * L / A', { rho, L: length, A: area })

    expect(math.typeOf(result)).toBe('Unit')
    expect(result.equalBase(math.unit(1, 'ohm'))).toBe(true)
    expect(result.toNumber('ohm')).toBeCloseTo(1, 6) // (2 × 3) / 6 = 1
  })

  test('capacitor dimensional propagation: (F/m) × m² / m simplifies to F', () => {
    const eps = math.unit(1, 'F/m')
    const area = math.unit(2, 'm^2')
    const d = math.unit(4, 'm')
    const result = math.evaluate('eps * A / d', { eps, A: area, d })

    expect(math.typeOf(result)).toBe('Unit')
    expect(result.equalBase(math.unit(1, 'F'))).toBe(true)
    expect(result.toNumber('F')).toBeCloseTo(0.5, 6)
  })

  test('photon wavelength dimensional propagation: J·s × m/s / J simplifies to m', () => {
    // λ = h × c / E — checks that mathjs reduces (J·s)(m/s)/J = m correctly.
    const h = math.unit(6.62607015e-34, 'J s')
    const c = math.unit(2.99792458e8, 'm/s')
    const energy = math.unit(2e-19, 'J') // ~1.25 eV → expect ~993 nm IR
    const result = math.evaluate('h * c / E', { h, c, E: energy })

    expect(math.typeOf(result)).toBe('Unit')
    expect(result.equalBase(math.unit(1, 'm'))).toBe(true)
    // λ = (6.62607015e-34 × 2.99792458e8) / 2e-19 ≈ 9.93e-7 m
    expect(result.toNumber('m')).toBeCloseTo(9.93e-7, 9)
  })
})

// ===========================================================================
// 2. End-to-end evaluator tests — the three §16 first concrete cases
// ===========================================================================

describe('evaluateEquation — first concrete cases', () => {
  test('R = ρ × L / A — resistor formula evaluates to ohms', () => {
    // 10 cm of copper wire with 1 mm² cross-section.
    // Copper resistivity at 20°C from NIST: 1.68e-8 ohm·m.
    // Expected R = 1.68e-8 × 0.1 / 1e-6 = 1.68 mΩ.
    const spec: EquationValue = {
      kind: 'equation',
      expression: 'rho * L / A',
      inputs: {
        rho: { kind: 'property_ref', path: 'material.resistivity' },
        L: { kind: 'property_ref', path: 'geometry.length' },
        A: { kind: 'property_ref', path: 'geometry.cross_section_area' },
      },
      output_unit: 'ohm',
    }
    const result = evaluateEquation(spec, {
      propertyRefs: {
        'material.resistivity': { amount: 1.68e-8, unit: 'ohm m' },
        'geometry.length': { amount: 0.1, unit: 'm' },
        'geometry.cross_section_area': { amount: 1e-6, unit: 'm^2' },
      },
    })

    expect(result.status).toBe('evaluated')
    if (result.status === 'evaluated') {
      expect(result.unit).toBe('ohm')
      expect(result.amount).toBeCloseTo(1.68e-3, 7)
    }
  })

  test('λ = h × c / E_g — LED wavelength from bandgap energy', () => {
    // GaN-like bandgap of ~3.4 eV. 1 eV = 1.602176634e-19 J (mathjs handles eV).
    // Expected λ ≈ hc / (3.4 × 1.602e-19) ≈ 365 nm.
    const spec: EquationValue = {
      kind: 'equation',
      expression: 'h * c / E_g',
      inputs: {
        E_g: { kind: 'property_ref', path: 'composition.active.bandgap_energy' },
      },
      constants_used: ['h', 'c'],
      output_unit: 'm',
    }
    const result = evaluateEquation(spec, {
      propertyRefs: {
        'composition.active.bandgap_energy': { amount: 3.4, unit: 'eV' },
      },
    })

    expect(result.status).toBe('evaluated')
    if (result.status === 'evaluated') {
      expect(result.unit).toBe('m')
      // λ = (6.62607015e-34 × 2.99792458e8) / (3.4 × 1.602176634e-19) ≈ 3.648e-7 m
      expect(result.amount).toBeCloseTo(3.65e-7, 9)
    }
  })

  test('C = ε₀ × ε_r × A / d — capacitor formula evaluates to farads', () => {
    // Air-dielectric parallel-plate capacitor:
    // ε_r ≈ 1.000 (air), A = 1e-4 m² (1 cm²), d = 1e-3 m (1 mm).
    // Expected C = 8.854e-12 × 1 × 1e-4 / 1e-3 ≈ 0.885 pF.
    const spec: EquationValue = {
      kind: 'equation',
      expression: 'epsilon_0 * eps_r * A / d',
      inputs: {
        eps_r: { kind: 'property_ref', path: 'composition.dielectric.relative_permittivity' },
        A: { kind: 'property_ref', path: 'geometry.plate_area' },
        d: { kind: 'property_ref', path: 'geometry.plate_separation' },
      },
      constants_used: ['epsilon_0'],
      output_unit: 'F',
    }
    const result = evaluateEquation(spec, {
      propertyRefs: {
        'composition.dielectric.relative_permittivity': { amount: 1.0, unit: '' },
        'geometry.plate_area': { amount: 1e-4, unit: 'm^2' },
        'geometry.plate_separation': { amount: 1e-3, unit: 'm' },
      },
    })

    expect(result.status).toBe('evaluated')
    if (result.status === 'evaluated') {
      expect(result.unit).toBe('F')
      expect(result.amount).toBeCloseTo(8.854e-13, 16)
    }
  })
})

// ===========================================================================
// 3. Error paths
// ===========================================================================

describe('evaluateEquation — error paths', () => {
  test('wrong formula trips derives-unit-mismatch', () => {
    // Multiplication instead of division — produces ohm·m⁴ instead of ohm.
    const spec: EquationValue = {
      kind: 'equation',
      expression: 'rho * L * A', // wrong: should be rho * L / A
      inputs: {
        rho: { kind: 'property_ref', path: 'material.resistivity' },
        L: { kind: 'property_ref', path: 'geometry.length' },
        A: { kind: 'property_ref', path: 'geometry.cross_section_area' },
      },
      output_unit: 'ohm',
    }
    expect(() =>
      evaluateEquation(spec, {
        propertyRefs: {
          'material.resistivity': { amount: 1.68e-8, unit: 'ohm m' },
          'geometry.length': { amount: 0.1, unit: 'm' },
          'geometry.cross_section_area': { amount: 1e-6, unit: 'm^2' },
        },
      }),
    ).toThrow(EquationEvalError)
  })

  test('property_ref path missing from context throws unresolved-input', () => {
    const spec: EquationValue = {
      kind: 'equation',
      expression: 'rho * L / A',
      inputs: {
        rho: { kind: 'property_ref', path: 'material.resistivity' },
        L: { kind: 'property_ref', path: 'geometry.length' },
        A: { kind: 'property_ref', path: 'geometry.cross_section_area' },
      },
      output_unit: 'ohm',
    }
    try {
      evaluateEquation(spec, {
        propertyRefs: {
          'material.resistivity': { amount: 1.68e-8, unit: 'ohm m' },
          // L and A intentionally missing
        },
      })
      throw new Error('Expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(EquationEvalError)
      expect((err as EquationEvalError).code).toBe('unresolved-input')
    }
  })

  test('unknown constant in constants_used throws unknown-constant', () => {
    const spec: EquationValue = {
      kind: 'equation',
      expression: 'planck_made_up * 2',
      inputs: {},
      constants_used: ['planck_made_up'],
      output_unit: 'J s',
    }
    try {
      evaluateEquation(spec, { propertyRefs: {} })
      throw new Error('Expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(EquationEvalError)
      expect((err as EquationEvalError).code).toBe('unknown-constant')
    }
  })

  test('unknown unit in input throws unknown-unit', () => {
    const spec: EquationValue = {
      kind: 'equation',
      expression: 'x * 2',
      inputs: {
        x: { kind: 'constant', amount: 1, unit: 'flibbertigibbets' },
      },
      output_unit: 'flibbertigibbets',
    }
    try {
      evaluateEquation(spec, { propertyRefs: {} })
      throw new Error('Expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(EquationEvalError)
      expect((err as EquationEvalError).code).toBe('unknown-unit')
    }
  })

  test('expression syntax error throws expression-syntax', () => {
    const spec: EquationValue = {
      kind: 'equation',
      expression: 'rho *** L', // *** is not valid mathjs syntax
      inputs: {
        rho: { kind: 'constant', amount: 1, unit: 'ohm m' },
        L: { kind: 'constant', amount: 1, unit: 'm' },
      },
      output_unit: 'ohm m^2',
    }
    try {
      evaluateEquation(spec, { propertyRefs: {} })
      throw new Error('Expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(EquationEvalError)
      expect((err as EquationEvalError).code).toBe('expression-syntax')
    }
  })
})

// ===========================================================================
// 4. End-to-end: device-resistor.yaml's catalog-shipped equation evaluates
// ===========================================================================

describe('end-to-end: device-resistor.yaml equation', () => {
  test('loaded equation has the expected shape', () => {
    const yamlText = readFileSync(join('fixtures', 'valid', 'device-resistor.yaml'), 'utf-8')
    // biome-ignore lint/suspicious/noExplicitAny: YAML parse result is polymorphic; the schema validates the full shape elsewhere
    const device = parseYAML(yamlText) as any

    expect(device.properties).toBeDefined()
    expect(device.properties.resistance).toBeDefined()
    expect(device.properties.resistance.value.kind).toBe('equation')
    expect(device.properties.resistance.value.expression).toBe('rho * L / A')
    expect(device.properties.resistance.value.output_unit).toBe('ohm')
    expect(device.properties.resistance.provenance.source_type).toBe('reference')
  })

  test('evaluates to 1.68 mΩ for the canonical 10 cm × 1 mm² copper case', () => {
    const yamlText = readFileSync(join('fixtures', 'valid', 'device-resistor.yaml'), 'utf-8')
    // biome-ignore lint/suspicious/noExplicitAny: YAML parse result is polymorphic
    const device = parseYAML(yamlText) as any
    const spec = device.properties.resistance.value as EquationValue

    // Build the evaluation context as if an instance had filled the roles
    // with copper + a 10 cm × 1 mm² path. Resistivity from NIST CODATA via
    // material-copper.yaml; geometry chosen to land at a familiar magnitude.
    const result = evaluateEquation(spec, {
      propertyRefs: {
        'resistive_material.resistivity': { amount: 1.68e-8, unit: 'ohm m' },
        'geometry.length': { amount: 0.1, unit: 'm' },
        'geometry.cross_section_area': { amount: 1e-6, unit: 'm^2' },
      },
    })

    expect(result.status).toBe('evaluated')
    if (result.status === 'evaluated') {
      expect(result.unit).toBe('ohm')
      expect(result.amount).toBeCloseTo(1.68e-3, 7)
    }
  })

  test('reusing the same equation with different geometry recomputes per-instance', () => {
    const yamlText = readFileSync(join('fixtures', 'valid', 'device-resistor.yaml'), 'utf-8')
    // biome-ignore lint/suspicious/noExplicitAny: YAML parse result is polymorphic
    const device = parseYAML(yamlText) as any
    const spec = device.properties.resistance.value as EquationValue

    // 1 m of the same copper at the same area → 10× the previous resistance.
    const result = evaluateEquation(spec, {
      propertyRefs: {
        'resistive_material.resistivity': { amount: 1.68e-8, unit: 'ohm m' },
        'geometry.length': { amount: 1.0, unit: 'm' },
        'geometry.cross_section_area': { amount: 1e-6, unit: 'm^2' },
      },
    })

    expect(result.status).toBe('evaluated')
    if (result.status === 'evaluated') {
      expect(result.amount).toBeCloseTo(1.68e-2, 7) // 16.8 mΩ
    }
  })
})

// ===========================================================================
// 4b. End-to-end: device-capacitor.yaml's catalog-shipped equation evaluates
// ===========================================================================

describe('end-to-end: device-capacitor.yaml equation', () => {
  test('loaded equation has the expected shape', () => {
    const yamlText = readFileSync(join('fixtures', 'valid', 'device-capacitor.yaml'), 'utf-8')
    // biome-ignore lint/suspicious/noExplicitAny: YAML parse result is polymorphic
    const device = parseYAML(yamlText) as any

    expect(device.properties.capacitance.value.kind).toBe('equation')
    expect(device.properties.capacitance.value.expression).toBe('epsilon_0 * eps_r * A / d')
    expect(device.properties.capacitance.value.output_unit).toBe('farad')
    expect(device.properties.capacitance.value.constants_used).toEqual(['epsilon_0'])
  })

  test('evaluates to ~0.885 pF for the 1 cm² × 1 mm air-dielectric case', () => {
    const yamlText = readFileSync(join('fixtures', 'valid', 'device-capacitor.yaml'), 'utf-8')
    // biome-ignore lint/suspicious/noExplicitAny: YAML parse result is polymorphic
    const device = parseYAML(yamlText) as any
    const spec = device.properties.capacitance.value as EquationValue

    // Air dielectric (ε_r ≈ 1, dimensionless), 1 cm² plate area, 1 mm separation.
    // C = 8.854e-12 × 1 × 1e-4 / 1e-3 ≈ 0.885 pF.
    const result = evaluateEquation(spec, {
      propertyRefs: {
        'dielectric.relative_permittivity': { amount: 1.0, unit: '1' },
        'plates.area': { amount: 1e-4, unit: 'm^2' },
        'dielectric.thickness': { amount: 1e-3, unit: 'm' },
      },
    })

    expect(result.status).toBe('evaluated')
    if (result.status === 'evaluated') {
      expect(result.unit).toBe('farad')
      expect(result.amount).toBeCloseTo(8.854e-13, 16)
    }
  })
})

// ===========================================================================
// 4c. End-to-end: device-led.yaml's catalog-shipped equation evaluates
// ===========================================================================

describe('end-to-end: device-led.yaml equation', () => {
  test('loaded equation has the expected shape', () => {
    const yamlText = readFileSync(join('fixtures', 'valid', 'device-led.yaml'), 'utf-8')
    // biome-ignore lint/suspicious/noExplicitAny: YAML parse result is polymorphic
    const device = parseYAML(yamlText) as any

    expect(device.properties.peak_wavelength.value.kind).toBe('equation')
    expect(device.properties.peak_wavelength.value.expression).toBe('h * c / E_g')
    expect(device.properties.peak_wavelength.value.output_unit).toBe('nm')
    expect(device.properties.peak_wavelength.value.constants_used).toEqual(['h', 'c'])
  })

  test('evaluates to ~653 nm (red) for AlGaInP bandgap of 1.9 eV', () => {
    const yamlText = readFileSync(join('fixtures', 'valid', 'device-led.yaml'), 'utf-8')
    // biome-ignore lint/suspicious/noExplicitAny: YAML parse result is polymorphic
    const device = parseYAML(yamlText) as any
    const spec = device.properties.peak_wavelength.value as EquationValue

    // AlGaInP red LED — n_side bandgap ~1.9 eV.
    // λ = hc / E_g = (6.62607015e-34 × 2.99792458e8) / (1.9 × 1.602176634e-19)
    //   = 1.98644586e-25 / 3.0441456e-19 ≈ 6.525484e-7 m ≈ 652.5484 nm
    //   (red — matches AlGaInP red ~625-650 nm range from the
    //   parameters.peak_wavelength description). Asserting the
    //   actual computed value to 4 decimal places (precision 3 →
    //   ±0.0005 nm tolerance) — well clear of any mathjs precision
    //   noise.
    const result = evaluateEquation(spec, {
      propertyRefs: {
        'n_side.bandgap_energy': { amount: 1.9, unit: 'eV' },
      },
    })

    expect(result.status).toBe('evaluated')
    if (result.status === 'evaluated') {
      expect(result.unit).toBe('nm')
      expect(result.amount).toBeCloseTo(652.5484, 3) // ~653 nm red
    }
  })

  test('evaluates to ~365 nm (UV) for AlGaN bandgap of 3.4 eV', () => {
    const yamlText = readFileSync(join('fixtures', 'valid', 'device-led.yaml'), 'utf-8')
    // biome-ignore lint/suspicious/noExplicitAny: YAML parse result is polymorphic
    const device = parseYAML(yamlText) as any
    const spec = device.properties.peak_wavelength.value as EquationValue

    // Same equation, AlGaN-like bandgap of 3.4 eV → ~365 nm UV.
    // λ = hc / (3.4 × 1.602176634e-19) ≈ 364.6594 nm.
    const result = evaluateEquation(spec, {
      propertyRefs: {
        'n_side.bandgap_energy': { amount: 3.4, unit: 'eV' },
      },
    })

    expect(result.status).toBe('evaluated')
    if (result.status === 'evaluated') {
      expect(result.amount).toBeCloseTo(364.6594, 3) // ~365 nm UV-A
    }
  })
})

// ===========================================================================
// 5. input_variable defers evaluation (Sprint 12 scope)
// ===========================================================================

describe('evaluateEquation — input_variable defers evaluation', () => {
  test('equation with input_variable returns deferred-evaluation', () => {
    // §7's resistivity-vs-temperature example: ρ(T) = ρ_0 × (1 + α(T - T_0)).
    // Sprint 12 does not evaluate parametric forms; defer status only.
    const spec: EquationValue = {
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
    const result = evaluateEquation(spec, { propertyRefs: {} })

    expect(result.status).toBe('deferred-evaluation')
    if (result.status === 'deferred-evaluation') {
      expect(result.reason).toContain('input_variable')
      expect(result.reason).toContain('§16.5')
    }
  })
})
