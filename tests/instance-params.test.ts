/**
 * instance-params tests — the shared readScalarParam / readEnumParam readers every resolver leans
 * on. The foundation contract: a scalar yields its amount only when it is a real FINITE number, so a
 * non-finite amount (NaN / ±Infinity) reads as MISSING and can never reach the solver matrix; an
 * enum yields a plain string `value` (the shape the latch state and material refs are stored in).
 */

import { describe, expect, test } from 'vitest'
import type { Instance } from '../src/cross-fk-validator.ts'
import { readEnumParam, readScalarParam } from '../src/instance-params.ts'

/** An instance carrying one parameter `name` whose `.value` is `value`. */
const withParam = (name: string, value: unknown): Instance =>
  ({ id: 'x', definition: 'resistor', parameters: { [name]: { value } } }) as unknown as Instance

const scalarVal = (amount: unknown) => ({ kind: 'scalar', amount, unit: 'ohm' })

describe('readScalarParam', () => {
  test('reads a finite scalar amount', () => {
    expect(readScalarParam(withParam('r', scalarVal(100)), 'r')).toBe(100)
    expect(readScalarParam(withParam('r', scalarVal(-2.5)), 'r')).toBe(-2.5)
    expect(readScalarParam(withParam('r', scalarVal(0)), 'r')).toBe(0)
  })

  test('rejects a non-finite amount (NaN / ±Infinity) — it reads as missing', () => {
    expect(readScalarParam(withParam('r', scalarVal(Number.NaN)), 'r')).toBeUndefined()
    expect(
      readScalarParam(withParam('r', scalarVal(Number.POSITIVE_INFINITY)), 'r'),
    ).toBeUndefined()
    expect(
      readScalarParam(withParam('r', scalarVal(Number.NEGATIVE_INFINITY)), 'r'),
    ).toBeUndefined()
  })

  test('rejects missing, non-object, non-scalar kind, and non-numeric amount', () => {
    expect(readScalarParam(withParam('r', scalarVal(1)), 'absent')).toBeUndefined()
    expect(readScalarParam(withParam('r', 'a bare string'), 'r')).toBeUndefined()
    expect(readScalarParam(withParam('r', { kind: 'enum', amount: 1 }), 'r')).toBeUndefined()
    expect(readScalarParam(withParam('r', scalarVal('100')), 'r')).toBeUndefined()
  })
})

describe('readEnumParam', () => {
  test('reads a plain string value (the latch / ref shape); rejects a non-string', () => {
    expect(readEnumParam(withParam('device_state', 'conducting'), 'device_state')).toBe(
      'conducting',
    )
    expect(readEnumParam(withParam('s', scalarVal(1)), 's')).toBeUndefined()
    expect(readEnumParam(withParam('s', 'x'), 'absent')).toBeUndefined()
  })
})
