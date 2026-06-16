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
  LED_VARSHNI_ALPHA_EV_PER_K,
  LED_VARSHNI_BETA_K,
  pnjlim,
  ROOM_TEMPERATURE_KELVIN,
  scaleSaturationCurrent,
  thermalVoltage,
  varshniEnergyGap,
  ZENER_BREAKDOWN_IDEALITY,
  zenerCompanionModel,
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

  test('defaults to the single 298.15 K (25 °C) reference, not the old 300 K approximation', () => {
    // The audit fix: one calibration/operating reference for every device law, so a
    // resting part sits exactly at its datasheet 25 °C point (no spurious 1.85 K shift).
    expect(ROOM_TEMPERATURE_KELVIN).toBe(298.15)
    expect(thermalVoltage()).toBeCloseTo(0.025693, 6) // 25.693 mV, vs 25.852 mV at 300 K
  })

  test('defaults to 298.15 K (25 °C, the datasheet calibration condition)', () => {
    expect(thermalVoltage()).toBe(thermalVoltage(298.15))
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

// ===========================================================================
// LED forward-voltage drift — the Varshni bandgap effect
// ===========================================================================

describe('LED forward-voltage drift (Varshni bandgap)', () => {
  const N_LED = 2
  const EG_RED = 1239.84 / 640 // a red LED's bandgap from its 640 nm peak (eV)
  const IS_25 = deriveSaturationCurrent(2.0, 0.02, N_LED, thermalVoltage(298.15)) // 2.0 V @ 20 mA

  // The LED's forward voltage at the same 20 mA at a junction temperature, with
  // or without the bandgap narrowing: V_F = n·V_T·ln(I/I_S(T) + 1).
  const vfAt = (tempC: number, varshni: boolean) => {
    const tK = tempC + 273.15
    const egT = varshni
      ? varshniEnergyGap(EG_RED, LED_VARSHNI_ALPHA_EV_PER_K, LED_VARSHNI_BETA_K, tK)
      : EG_RED
    const isT = scaleSaturationCurrent(IS_25, tK, 298.15, N_LED, EG_RED, egT)
    return N_LED * thermalVoltage(tK) * Math.log(0.02 / isT + 1)
  }

  test('the bandgap narrows with heat, and is exact at the 25 °C reference', () => {
    const hot = varshniEnergyGap(EG_RED, LED_VARSHNI_ALPHA_EV_PER_K, LED_VARSHNI_BETA_K, 373.15)
    const ref = varshniEnergyGap(EG_RED, LED_VARSHNI_ALPHA_EV_PER_K, LED_VARSHNI_BETA_K, 298.15)
    expect(hot).toBeLessThan(EG_RED)
    expect(ref).toBeCloseTo(EG_RED, 9)
  })

  test('forward voltage droops with temperature — the real direction, a few mV/K', () => {
    const drift = (vfAt(75, true) - vfAt(25, true)) / 50 // volts per °C
    expect(drift).toBeLessThan(0) // V_F falls as the LED warms
    expect(drift).toBeGreaterThan(-0.003) // a few mV/K — the real ballpark
    expect(drift).toBeLessThan(-0.0002) // clearly nonzero (vs ≈0 with a constant bandgap)
  })

  test('the constant-bandgap law nearly cancels — Varshni is what makes it droop', () => {
    const driftConstant = (vfAt(75, false) - vfAt(25, false)) / 50
    const driftVarshni = (vfAt(75, true) - vfAt(25, true)) / 50
    expect(driftVarshni).toBeLessThan(driftConstant) // narrowing bandgap droops more
  })
})

// ===========================================================================
// Zener reverse breakdown — the two-branch companion model
// ===========================================================================

describe('zenerCompanionModel — forward, blocking, and reverse breakdown', () => {
  const VT = thermalVoltage(298.15)
  const N = 2
  const VZ = 5.1 // a 5.1 V zener
  const IS = deriveSaturationCurrent(0.7, 0.01, N, VT) // forward 0.7 V @ 10 mA
  const IBV = 0.005 // 5 mA breakdown reference current
  const NZ = ZENER_BREAKDOWN_IDEALITY

  // Recover the true device current at V from the companion: I(V) = G·V + I_eq.
  const currentAt = (v: number) => {
    const { conductance, currentSource } = zenerCompanionModel(v, IS, N, VT, VZ, IBV, NZ)
    return conductance * v + currentSource
  }

  test('forward biased: conducts like an ordinary diode', () => {
    expect(currentAt(0.7)).toBeGreaterThan(0.005) // ~10 mA at its forward knee
  })

  test('blocking region: essentially no current between 0 and -V_Z', () => {
    expect(Math.abs(currentAt(-2))).toBeLessThan(1e-3) // -2 V, well short of -5.1 V
  })

  test('reverse breakdown: clamps near -V_Z and conducts hard just past it', () => {
    const atKnee = currentAt(-VZ) // exactly -5.1 V
    const past = currentAt(-(VZ + 0.3)) // 0.3 V deeper into breakdown
    expect(atKnee).toBeLessThan(0) // reverse current (negative)
    expect(past).toBeLessThan(atKnee) // more reverse current past the knee
    expect(Math.abs(past)).toBeGreaterThan(0.02) // hard conduction — the clamp
  })

  test('the conductance is always ≥ 0 — the stamp never goes singular', () => {
    for (const v of [-10, -VZ, -2, 0, 0.5, 0.7]) {
      expect(zenerCompanionModel(v, IS, N, VT, VZ, IBV, NZ).conductance).toBeGreaterThanOrEqual(0)
    }
  })
})

// ===========================================================================
// Forward-exponential overflow guard (EXP_ARG_CAP) — a wild voltage can't make the matrix singular
// ===========================================================================

describe('the forward diode exponential is overflow-safe', () => {
  const VT = thermalVoltage(298.15)
  const IS = deriveSaturationCurrent(0.7, 0.01, 2, VT) // forward 0.7 V @ 10 mA

  test('a wild forward voltage (30 V) stays FINITE — not Infinity/NaN', () => {
    // Uncapped, exp(30 / (2·0.0259)) ≈ exp(580) overflows to Infinity and the MNA matrix goes
    // singular — exactly the latch-seed bug. The cap keeps current, conductance, and the companion
    // large-but-finite, so pnjlim can walk the voltage back.
    expect(Number.isFinite(diodeCurrent(30, IS, 2, VT))).toBe(true)
    expect(Number.isFinite(diodeConductance(30, IS, 2, VT))).toBe(true)
    const { conductance, currentSource } = companionModel(30, IS, 2, VT)
    expect(Number.isFinite(conductance)).toBe(true)
    expect(Number.isFinite(currentSource)).toBe(true)
  })

  test('the cap does NOT touch real operating points (0.7 V still gives the calibrated 10 mA)', () => {
    expect(diodeCurrent(0.7, IS, 2, VT)).toBeCloseTo(0.01, 6)
  })
})
