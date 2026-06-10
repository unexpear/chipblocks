/**
 * Thermal model tests (S19-v3-48) — the lumped junction-temperature relation
 * T = T_ambient + P·θ_JA, checked against hand-computed datasheet examples.
 */

import { describe, expect, test } from 'vitest'
import { junctionTemperature, STANDARD_AMBIENT_C } from '../src/thermal-model.ts'

describe('junctionTemperature', () => {
  test('no dissipation → sits at ambient', () => {
    expect(junctionTemperature(0, 200)).toBe(STANDARD_AMBIENT_C)
  })
  test('a TO-92 transistor at 100 mW: 25 + 0.1·200 = 45 °C', () => {
    expect(junctionTemperature(0.1, 200)).toBeCloseTo(45, 9)
  })
  test('the anchor resistor at ~104 mW with film-derating θ 340 → ~60.5 °C', () => {
    expect(junctionTemperature(0.1044, 340)).toBeCloseTo(60.5, 1)
  })
  test('a hotter room shifts the whole curve up', () => {
    expect(junctionTemperature(0.1, 200, 40)).toBeCloseTo(60, 9)
  })
})
