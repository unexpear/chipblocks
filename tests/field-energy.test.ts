/**
 * Field / energy-transfer physics — the "energy is in the fields, the electrons crawl"
 * picture (Poynting; Veritasium). The charge carriers drift a fraction of a millimetre
 * per second while the energy front travels at nearly the speed of light.
 */

import { describe, expect, test } from 'vitest'
import {
  COPPER_CARRIER_DENSITY_PER_M3,
  ELEMENTARY_CHARGE_C,
  electronDriftVelocityMS,
  lightTravelTimeS,
  SPEED_OF_LIGHT_M_S,
} from '../src/field-energy.ts'
import { awgAreaM2 } from '../src/wire-gauge.ts'

describe('field energy — carriers crawl, energy flies', () => {
  test('electron drift velocity v_d = I/(n·q·A) is under a millimetre per second', () => {
    const area = awgAreaM2(22)
    const v = electronDriftVelocityMS(1, area)
    expect(v).toBeCloseTo(1 / (COPPER_CARRIER_DENSITY_PER_M3 * ELEMENTARY_CHARGE_C * area), 12)
    expect(v).toBeLessThan(1e-3) // a fraction of a mm/s even at a whole amp
    expect(v).toBeGreaterThan(0)
  })

  test('drift scales linearly with current and inversely with area', () => {
    const area = awgAreaM2(22)
    expect(electronDriftVelocityMS(2, area)).toBeCloseTo(2 * electronDriftVelocityMS(1, area), 15)
    expect(electronDriftVelocityMS(1, 2 * area)).toBeCloseTo(
      electronDriftVelocityMS(1, area) / 2,
      15,
    )
    expect(electronDriftVelocityMS(1, 0)).toBe(0) // degenerate guarded
  })

  test('the energy front travels at the speed of light (d/c)', () => {
    expect(lightTravelTimeS(1)).toBeCloseTo(1 / SPEED_OF_LIGHT_M_S, 18) // ~3.3 ns per metre
    expect(lightTravelTimeS(SPEED_OF_LIGHT_M_S)).toBeCloseTo(1, 6) // 1 light-second
    expect(lightTravelTimeS(-5)).toBe(0)
  })

  test('the headline contrast: the energy outruns the electrons by ~12 orders of magnitude', () => {
    const v = electronDriftVelocityMS(1, awgAreaM2(22))
    expect(SPEED_OF_LIGHT_M_S / v).toBeGreaterThan(1e9) // the energy is billions of times faster
  })
})
