/**
 * MOSFET model tests (S19-v3-66) — the three-region Level-1 (Shichman–Hodges)
 * math against hand-computed values, with every derivative checked against a
 * finite difference (the Newton-Raphson loop trusts those slopes, so they are
 * verified numerically, not assumed).
 *
 * The running example is the 2N7000-class NMOS the palette will ship:
 * V_th = 2.1 V, k = 26 mA/V² (derived from the datasheet point
 * I_D(on) ≥ 75 mA at V_GS = 4.5 V), λ = 0.02 /V where stated.
 */

import { describe, expect, test } from 'vitest'
import {
  limitMosfetStep,
  MOSFET_STEP_LIMIT_V,
  type MosfetParams,
  mosfetOperatingPoint,
} from '../src/mosfet-model.ts'

const NMOS: MosfetParams = {
  channel: 'nmos',
  thresholdVoltage: 2.1,
  transconductance: 0.026,
  channelLengthModulation: 0,
}
const PMOS: MosfetParams = {
  channel: 'pmos',
  thresholdVoltage: -2.1,
  transconductance: 0.026,
  channelLengthModulation: 0,
}

/** Centered finite difference of iD against the analytic slope. */
function checkDerivatives(vGS: number, vDS: number, params: MosfetParams) {
  const h = 1e-6
  const point = mosfetOperatingPoint(vGS, vDS, params)
  const dGS =
    (mosfetOperatingPoint(vGS + h, vDS, params).iD -
      mosfetOperatingPoint(vGS - h, vDS, params).iD) /
    (2 * h)
  const dDS =
    (mosfetOperatingPoint(vGS, vDS + h, params).iD -
      mosfetOperatingPoint(vGS, vDS - h, params).iD) /
    (2 * h)
  expect(Math.abs(point.gm - dGS)).toBeLessThan(1e-6)
  expect(Math.abs(point.gds - dDS)).toBeLessThan(1e-6)
}

describe('three regions (NMOS frame)', () => {
  test('cutoff: below threshold only the GMIN shunt remains', () => {
    const point = mosfetOperatingPoint(1.0, 5, NMOS)
    expect(point.region).toBe('cutoff')
    expect(point.iD).toBeCloseTo(1e-12 * 5, 18)
    expect(point.gm).toBe(0)
  })

  test('saturation lands exactly on the 2N7000 calibration point', () => {
    // I_D = (k/2)·(V_GS − V_th)² = 0.013 × 2.4² = 74.88 mA at V_GS 4.5, V_DS 10.
    const point = mosfetOperatingPoint(4.5, 10, NMOS)
    expect(point.region).toBe('saturation')
    expect(point.iD).toBeCloseTo(0.07488, 9)
  })

  test('triode at full gate drive reproduces the 2N7000 R_DS(on) spec class', () => {
    // V_GS = 10 V, V_DS = 0.1 V → I_D = k·(7.9·0.1 − 0.005) = 20.41 mA →
    // R = V/I ≈ 4.9 Ω. The 2N7000 datasheet line R_DS(on) ≤ 5 Ω at V_GS = 10 V
    // is an INDEPENDENT spec — the k derived from the I_D(on) point lands
    // inside it, a real consistency check between two datasheet rows.
    const point = mosfetOperatingPoint(10, 0.1, NMOS)
    expect(point.region).toBe('triode')
    expect(point.iD).toBeCloseTo(0.02041, 6)
    expect(0.1 / point.iD).toBeGreaterThan(4.5)
    expect(0.1 / point.iD).toBeLessThan(5.0)
  })

  test('the triode/saturation boundary is seamless — current and both slopes agree', () => {
    const withLambda: MosfetParams = { ...NMOS, channelLengthModulation: 0.02 }
    const vOV = 4.5 - 2.1
    const below = mosfetOperatingPoint(4.5, vOV - 1e-9, withLambda)
    const above = mosfetOperatingPoint(4.5, vOV + 1e-9, withLambda)
    expect(Math.abs(below.iD - above.iD)).toBeLessThan(1e-9)
    expect(Math.abs(below.gm - above.gm)).toBeLessThan(1e-6)
    expect(Math.abs(below.gds - above.gds)).toBeLessThan(1e-6)
  })

  test('λ gives the real slight current rise in saturation (finite output resistance)', () => {
    const withLambda: MosfetParams = { ...NMOS, channelLengthModulation: 0.02 }
    const at5 = mosfetOperatingPoint(4.5, 5, withLambda)
    const at10 = mosfetOperatingPoint(4.5, 10, withLambda)
    expect(at10.iD).toBeGreaterThan(at5.iD)
    expect(at10.gds).toBeCloseTo((0.026 / 2) * 2.4 * 2.4 * 0.02, 12)
  })
})

describe('derivatives match finite differences in every region and frame', () => {
  test('saturation / triode / cutoff (NMOS)', () => {
    const withLambda: MosfetParams = { ...NMOS, channelLengthModulation: 0.02 }
    checkDerivatives(4.5, 10, withLambda) // saturation
    checkDerivatives(10, 0.1, withLambda) // triode
    checkDerivatives(1.0, 5, withLambda) // cutoff
  })
  test('swapped frame (V_DS < 0) and PMOS', () => {
    const withLambda: MosfetParams = { ...NMOS, channelLengthModulation: 0.02 }
    checkDerivatives(4.5, -1, withLambda) // role swap
    const pmosLambda: MosfetParams = { ...PMOS, channelLengthModulation: 0.02 }
    checkDerivatives(-4.5, -10, pmosLambda) // PMOS saturation
    checkDerivatives(-10, -0.1, pmosLambda) // PMOS triode
    checkDerivatives(-1, -5, pmosLambda) // PMOS cutoff
  })
})

describe('symmetry and the PMOS mirror', () => {
  test('V_DS < 0 swaps drain and source roles — real channel symmetry', () => {
    // Labeled iD must equal minus the swapped-frame computation.
    const labeled = mosfetOperatingPoint(4.5, -1, NMOS)
    const swappedFrame = mosfetOperatingPoint(4.5 - -1, 1, NMOS)
    expect(labeled.iD).toBeCloseTo(-swappedFrame.iD, 12)
  })

  test('a PMOS is the exact mirror of an NMOS', () => {
    const n = mosfetOperatingPoint(4.5, 10, NMOS)
    const p = mosfetOperatingPoint(-4.5, -10, PMOS)
    expect(p.iD).toBeCloseTo(-n.iD, 12) // current flows source → drain
    expect(p.region).toBe('saturation')
  })

  test('a PMOS with its gate at the source potential is off', () => {
    const point = mosfetOperatingPoint(0, -5, PMOS)
    expect(point.region).toBe('cutoff')
    expect(Math.abs(point.iD)).toBeLessThan(1e-11)
  })
})

describe('NR step limiting (the fetlim-style damper)', () => {
  test('steps clamp to the limit in both directions, small steps pass through', () => {
    expect(limitMosfetStep(5, 0)).toBe(MOSFET_STEP_LIMIT_V)
    expect(limitMosfetStep(-5, 0)).toBe(-MOSFET_STEP_LIMIT_V)
    expect(limitMosfetStep(0.4, 0)).toBe(0.4)
  })
})
