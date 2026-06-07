/**
 * Diode-model physics tests — every expected value computed by hand and
 * cross-checked against the §20 spec / canonical sources.
 *
 * The pnjlim overflow-prevention test is the load-bearing one: it proves the
 * limiter actually keeps exp() finite for a voltage jump that would otherwise
 * overflow to Infinity.
 */

import { describe, expect, test } from 'vitest'
import {
  companionModel,
  criticalVoltage,
  deriveSaturationCurrent,
  diodeConductance,
  diodeCurrent,
  pnjlim,
  thermalVoltage,
} from '../src/diode-model.ts'

// led_001's calibration point, reused across tests.
const N = 2 // ideality factor
const VT = thermalVoltage(300) // ≈0.025852 V
const IS = deriveSaturationCurrent(2.0, 0.02, N, VT) // ≈3.175e-19 A
const NVT = N * VT

// ===========================================================================
// thermalVoltage
// ===========================================================================

describe('thermalVoltage', () => {
  test('= 25.852 mV at 300 K (§20.2, NIST CODATA k + q)', () => {
    expect(thermalVoltage(300)).toBeCloseTo(0.025852, 6)
  })

  test('scales linearly with temperature', () => {
    // V_T(600) = 2 × V_T(300)
    expect(thermalVoltage(600)).toBeCloseTo(2 * thermalVoltage(300), 9)
  })

  test('defaults to 300 K', () => {
    expect(thermalVoltage()).toBe(thermalVoltage(300))
  })
})

// ===========================================================================
// deriveSaturationCurrent
// ===========================================================================

describe('deriveSaturationCurrent', () => {
  test('led_001 (V_F=2.0, I_F=20mA, n=2) → I_s ≈ 3.175e-19 A (§20.3)', () => {
    expect(IS).toBeGreaterThan(3.1e-19)
    expect(IS).toBeLessThan(3.25e-19)
  })

  test('round-trips: diodeCurrent at the calibration voltage recovers I_F', () => {
    // I(V_F) must equal the I_F we calibrated from.
    expect(diodeCurrent(2.0, IS, N, VT)).toBeCloseTo(0.02, 9)
  })
})

// ===========================================================================
// diodeCurrent + diodeConductance
// ===========================================================================

describe('diodeCurrent', () => {
  test('is ~0 at 0 V (exp(0) − 1 = 0)', () => {
    expect(diodeCurrent(0, IS, N, VT)).toBeCloseTo(0, 12)
  })

  test('rises exponentially — higher V gives much more current', () => {
    const i1 = diodeCurrent(2.0, IS, N, VT)
    const i2 = diodeCurrent(2.064, IS, N, VT)
    // ~64 mV above the 2.0 V / 20 mA calibration point lands near 69 mA on the
    // Shockley curve — an LED driven hard (e.g. an undersized limiting resistor).
    expect(i2).toBeGreaterThan(i1)
    expect(i2).toBeCloseTo(0.0694, 3)
  })
})

describe('diodeConductance', () => {
  test('g = dI/dV matches a finite-difference derivative of the Shockley curve', () => {
    const V = 2.0
    const h = 1e-7
    const numeric = (diodeCurrent(V + h, IS, N, VT) - diodeCurrent(V - h, IS, N, VT)) / (2 * h)
    const analytic = diodeConductance(V, IS, N, VT)
    expect(analytic).toBeCloseTo(numeric, 2)
  })

  test('led_001 conductance at 2.0 V ≈ 0.387 S', () => {
    expect(diodeConductance(2.0, IS, N, VT)).toBeCloseTo(0.3868, 3)
  })
})

// ===========================================================================
// companionModel
// ===========================================================================

describe('companionModel', () => {
  test('reproduces the diode current at the linearization point: G·V + I_eq = I(V)', () => {
    const V = 2.0
    const cm = companionModel(V, IS, N, VT)
    expect(cm.conductance * V + cm.currentSource).toBeCloseTo(diodeCurrent(V, IS, N, VT), 9)
  })

  test('led_001 at 2.0 V: G_eq ≈ 0.387 S, I_eq ≈ −0.754 A', () => {
    const cm = companionModel(2.0, IS, N, VT)
    expect(cm.conductance).toBeCloseTo(0.3868, 3)
    expect(cm.currentSource).toBeCloseTo(-0.7536, 3)
  })
})

// ===========================================================================
// criticalVoltage
// ===========================================================================

describe('criticalVoltage', () => {
  test('led_001 V_crit ≈ 2.03 V (§20.5, ngspice diotemp.c formula)', () => {
    expect(criticalVoltage(IS, N, VT)).toBeCloseTo(2.0312, 3)
  })
})

// ===========================================================================
// pnjlim — the load-bearing convergence aid
// ===========================================================================

describe('pnjlim', () => {
  const VCRIT = criticalVoltage(IS, N, VT)

  test('PREVENTS OVERFLOW: a 50 V jump that overflows exp() unlimited is limited to a sane voltage', () => {
    // Unlimited: exp(50 / nVT) = Infinity → would wreck the solve.
    expect(Number.isFinite(Math.exp(50 / NVT))).toBe(false)

    const { voltage, limited } = pnjlim(50, 2.0, NVT, VCRIT)
    expect(limited).toBe(true)
    // The limited voltage keeps exp() finite.
    expect(Number.isFinite(Math.exp(voltage / NVT))).toBe(true)
    // And lands just above the previous voltage, not at 50 V.
    expect(voltage).toBeGreaterThan(2.0)
    expect(voltage).toBeLessThan(3.0)
    expect(voltage).toBeCloseTo(2.4566, 3)
  })

  test('does not limit a small step (below the 2·vt threshold)', () => {
    const { voltage, limited } = pnjlim(2.05, 2.0, NVT, VCRIT)
    expect(limited).toBe(false)
    expect(voltage).toBe(2.05)
  })

  test('does not limit when below V_crit even for a large swing', () => {
    // vnew = 1.0 < vcrit ≈ 2.03 → the forward-overflow branch can't fire.
    const { voltage, limited } = pnjlim(1.0, 0.0, NVT, VCRIT)
    expect(limited).toBe(false)
    expect(voltage).toBe(1.0)
  })

  test('limited voltage still advances toward the target (monotonic, not a reset)', () => {
    // A 2.0 → 2.5 request (just above 2·vt) advances past 2.0 but not all the
    // way — the log compression in the steep region.
    const { voltage } = pnjlim(2.5, 2.0, NVT, VCRIT)
    expect(voltage).toBeGreaterThan(2.0)
    expect(voltage).toBeLessThan(2.5)
  })
})
