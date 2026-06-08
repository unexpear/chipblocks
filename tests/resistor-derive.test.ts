/**
 * resistor-derive tests (S19-v3-34) — a resistor's resistance from R = ρL/A, the
 * declared derived path (device-resistor.yaml). Numbers checked against nichrome
 * (1.10e-6 Ω·m) and a 0.1 mm / 3.356 m wire that gives ~470 Ω.
 */

import { describe, expect, test } from 'vitest'
import {
  deriveResistance,
  deriveResistorOhms,
  resistivityOhmM,
} from '../src/renderer/resistor-derive.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

describe('resistivityOhmM', () => {
  test('reads nichrome resistivity (1.10e-6 Ω·m)', () => {
    expect(resistivityOhmM({ kind: 'condition_bound', amount: 1.1e-6, unit: 'ohm_meter' })).toBe(
      1.1e-6,
    )
  })
  test('rejects a non-Ω·m value (e.g. a bandgap in eV)', () => {
    expect(resistivityOhmM({ kind: 'scalar', amount: 1.9, unit: 'electronvolt' })).toBeNull()
  })
})

describe('deriveResistance (R = ρL/A)', () => {
  test('nichrome 0.1 mm wire, 3.356 m → ~470 Ω', () => {
    expect(deriveResistance(1.1e-6, 3.356, 7.854e-9)).toBeCloseTo(470, 0)
  })
  test('copper (65× lower ρ) gives a far smaller R for the same wire', () => {
    expect(deriveResistance(1.68e-8, 3.356, 7.854e-9)).toBeCloseTo(7.18, 1)
  })
  test('rejects non-positive geometry', () => {
    expect(deriveResistance(1.1e-6, 3.356, 0)).toBeNull()
    expect(deriveResistance(1.1e-6, 0, 7.854e-9)).toBeNull()
  })
})

describe('deriveResistorOhms (from a resistor’s parameters)', () => {
  const resistivity = new Map([
    ['nichrome', 1.1e-6],
    ['copper', 1.68e-8],
  ])
  test('reads material + geometry + the resistivity map → R', () => {
    const params = {
      resistive_material: { value: 'nichrome' },
      length: scalar(3.356, 'metre'),
      cross_section_area: scalar(7.854e-9, 'square_metre'),
    }
    expect(deriveResistorOhms(params, resistivity)).toBeCloseTo(470, 0)
  })
  test('null when geometry or material is missing', () => {
    expect(
      deriveResistorOhms({ resistive_material: { value: 'nichrome' } }, resistivity),
    ).toBeNull()
    expect(deriveResistorOhms(undefined, resistivity)).toBeNull()
  })
  test('null when the material has no known resistivity', () => {
    const params = {
      resistive_material: { value: 'unobtainium' },
      length: scalar(1, 'metre'),
      cross_section_area: scalar(1e-6, 'square_metre'),
    }
    expect(deriveResistorOhms(params, resistivity)).toBeNull()
  })
})
