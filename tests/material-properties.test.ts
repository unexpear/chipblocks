/**
 * representativeAmount tests (S19-v3-34) — the shared reader behind the LED's
 * bandgap and the resistor's resistivity. One place, both derivations.
 */

import { describe, expect, test } from 'vitest'
import { representativeAmount } from '../src/renderer/material-properties.ts'

describe('representativeAmount', () => {
  test('reads a condition_bound / scalar amount when the unit matches', () => {
    expect(
      representativeAmount(
        { kind: 'condition_bound', amount: 1.9, unit: 'electronvolt' },
        'electronvolt',
      ),
    ).toBe(1.9)
    expect(
      representativeAmount({ kind: 'scalar', amount: 1.1e-6, unit: 'ohm_meter' }, 'ohm_meter'),
    ).toBe(1.1e-6)
  })
  test('reads a range typical, else the min/max midpoint', () => {
    expect(
      representativeAmount(
        { kind: 'range', min: 2.4, max: 2.7, typical: 2.55, unit: 'electronvolt' },
        'electronvolt',
      ),
    ).toBe(2.55)
    expect(
      representativeAmount(
        { kind: 'range', min: 1.0e-4, max: 1.0e-2, unit: 'ohm_meter' },
        'ohm_meter',
      ),
    ).toBeCloseTo(0.00505, 10)
  })
  test('rejects a mismatched unit or a non-object', () => {
    expect(
      representativeAmount({ kind: 'scalar', amount: 5, unit: 'volt' }, 'ohm_meter'),
    ).toBeNull()
    expect(representativeAmount(null, 'electronvolt')).toBeNull()
    expect(representativeAmount('1.9', 'electronvolt')).toBeNull()
  })
})
