/**
 * BJT (Ebers-Moll transport) model tests (S19-v3-36) — the pure physics, before
 * any solver coupling. Confirms the defining transistor behavior (I_C ≈ β_F·I_B
 * in the active region), cutoff, and that the Newton-Raphson Jacobian carries the
 * gain. Mirrors how diode-model was unit-tested first.
 */

import { describe, expect, test } from 'vitest'
import { bjtCompanion, bjtCurrents } from '../src/bjt-model.ts'
import { thermalVoltage } from '../src/diode-model.ts'

const vt = thermalVoltage()
const npn = { saturationCurrent: 1e-14, betaForward: 100, betaReverse: 2 }

describe('bjtCurrents (Ebers-Moll transport)', () => {
  test('forward-active: I_C ≈ β_F · I_B (the transistor gain)', () => {
    // V_BE = 0.65 V on, collector 5 V above base (V_BC = −5) → forward active.
    const { iC, iB, iE } = bjtCurrents(0.65, -5, npn, vt)
    expect(iC).toBeGreaterThan(0)
    expect(iB).toBeGreaterThan(0)
    expect(iE).toBeLessThan(0)
    expect(iC / iB).toBeCloseTo(100, 1) // β_F
    expect(iC + iB + iE).toBeCloseTo(0, 9) // KCL: currents into the device sum to 0
  })

  test('a smaller β gives proportionally more base current', () => {
    const low = bjtCurrents(0.65, -5, { ...npn, betaForward: 50 }, vt)
    expect(low.iC / low.iB).toBeCloseTo(50, 1)
  })

  test('cutoff: V_BE = 0 → essentially no current (transistor off)', () => {
    const { iC, iB } = bjtCurrents(0, -5, npn, vt)
    expect(Math.abs(iC)).toBeLessThan(1e-12)
    expect(Math.abs(iB)).toBeLessThan(1e-12)
  })
})

describe('bjtCompanion (Newton-Raphson linearization)', () => {
  test('the Jacobian carries the gain: ∂I_B/∂V_BE = (∂I_C/∂V_BE) / β_F', () => {
    const c = bjtCompanion(0.65, -5, npn, vt)
    expect(c.dIC_dVBE).toBeGreaterThan(0)
    expect(c.dIB_dVBE).toBeCloseTo(c.dIC_dVBE / 100, 12)
    expect(c.iC).toBeGreaterThan(0)
  })

  test('operating-point currents match bjtCurrents', () => {
    const c = bjtCompanion(0.6, -3, npn, vt)
    const direct = bjtCurrents(0.6, -3, npn, vt)
    expect(c.iC).toBeCloseTo(direct.iC, 12)
    expect(c.iB).toBeCloseTo(direct.iB, 12)
  })
})

describe('the Early effect (S20-v3-7): forward Early voltage V_AF', () => {
  const early = { ...npn, earlyVoltageForward: 74 }

  test('the collector current scales by exactly (1 − V_BC/V_A); the base current does not', () => {
    // Base-width modulation collects MORE, it does not recombine more — so
    // I_C gains the factor while I_B is bit-identical with or without V_A.
    const flat = bjtCurrents(0.65, -5, npn, vt)
    const tilted = bjtCurrents(0.65, -5, early, vt)
    expect(tilted.iB).toBe(flat.iB)
    expect(tilted.iC / flat.iC).toBeCloseTo(1 - -5 / 74, 9)
    expect(tilted.iC + tilted.iB + tilted.iE).toBeCloseTo(0, 12)
  })

  test('β grows with collector voltage: I_C/I_B = β_F·(1 − V_BC/V_A) in forward-active', () => {
    const lowVce = bjtCurrents(0.65, -2, early, vt)
    const highVce = bjtCurrents(0.65, -8, early, vt)
    expect(lowVce.iC / lowVce.iB).toBeCloseTo(100 * (1 + 2 / 74), 6)
    expect(highVce.iC / highVce.iB).toBeCloseTo(100 * (1 + 8 / 74), 6)
    expect(highVce.iC).toBeGreaterThan(lowVce.iC)
  })

  test('the Jacobian gains the output conductance: finite differences confirm both ∂I_C terms', () => {
    const h = 1e-7
    const c = bjtCompanion(0.65, -5, early, vt)
    const fdVbe =
      (bjtCurrents(0.65 + h, -5, early, vt).iC - bjtCurrents(0.65 - h, -5, early, vt).iC) / (2 * h)
    const fdVbc =
      (bjtCurrents(0.65, -5 + h, early, vt).iC - bjtCurrents(0.65, -5 - h, early, vt).iC) / (2 * h)
    expect(c.dIC_dVBE).toBeCloseTo(fdVbe, 6)
    expect(c.dIC_dVBC).toBeCloseTo(fdVbc, 6)
    // In forward-active the V_BC junction is dark — the derivative IS the
    // output conductance g_o = −∂I_C/∂V_BC ≈ I_C/(V_A − V_BC), the tilt slope.
    expect(-c.dIC_dVBC).toBeCloseTo(c.iC / (74 + 5), 9)
  })

  test('companion currents still match bjtCurrents with V_A set', () => {
    const c = bjtCompanion(0.6, -3, early, vt)
    const direct = bjtCurrents(0.6, -3, early, vt)
    expect(c.iC).toBeCloseTo(direct.iC, 12)
    expect(c.iB).toBeCloseTo(direct.iB, 12)
  })
})

describe('high-level injection (forward knee current I_KF): β rolloff', () => {
  const hi = { ...npn, kneeCurrentForward: 1e-3 } // 1 mA knee

  test('below the knee β ≈ β_F; above it β rolls off hard', () => {
    const below = bjtCurrents(0.45, -5, hi, vt) // I_C ~ 0.4 µA, well under the knee
    const above = bjtCurrents(0.7, -5, hi, vt) // I_C ~ several mA, well over the knee
    expect(below.iC / below.iB).toBeGreaterThan(95) // ~β_F, no rolloff yet
    expect(above.iC / above.iB).toBeLessThan(50) // high-injection droop
    expect(above.iB).toBe(bjtCurrents(0.7, -5, npn, vt).iB) // I_B is NOT scaled — only I_C droops
  })

  test('I_KF ≫ I_C → no rolloff, bit-identical to the plain model', () => {
    const plain = bjtCurrents(0.7, -5, npn, vt)
    const huge = bjtCurrents(0.7, -5, { ...npn, kneeCurrentForward: 1e6 }, vt)
    expect(huge.iC).toBeCloseTo(plain.iC, 9)
  })

  test('the Jacobian stays exact with I_KF on (finite differences)', () => {
    const h = 1e-7
    const c = bjtCompanion(0.7, -5, hi, vt)
    const fdVbe =
      (bjtCurrents(0.7 + h, -5, hi, vt).iC - bjtCurrents(0.7 - h, -5, hi, vt).iC) / (2 * h)
    const fdVbc =
      (bjtCurrents(0.7, -5 + h, hi, vt).iC - bjtCurrents(0.7, -5 - h, hi, vt).iC) / (2 * h)
    expect(c.dIC_dVBE).toBeCloseTo(fdVbe, 5)
    expect(c.dIC_dVBC).toBeCloseTo(fdVbc, 6)
  })
})

describe('reverse Early voltage V_AR', () => {
  test('V_AR adds a V_BE/V_AR term to the base-charge factor', () => {
    const noVar = { ...npn, earlyVoltageForward: 74 }
    const withVar = { ...noVar, earlyVoltageReverse: 20 }
    // factor (1 − V_BC/V_AF) → (1 − V_BC/V_AF − V_BE/V_AR); the I_C ratio is the
    // factor ratio (the −I_EC/β_R term is ~5e-15, negligible vs the mA transport).
    const ratio = (1 + 5 / 74 - 0.6 / 20) / (1 + 5 / 74)
    const a = bjtCurrents(0.6, -5, noVar, vt)
    const b = bjtCurrents(0.6, -5, withVar, vt)
    expect(b.iC / a.iC).toBeCloseTo(ratio, 6)
  })

  test('the Jacobian gains the V_AR slope too (finite differences)', () => {
    const rev = { ...npn, earlyVoltageForward: 74, earlyVoltageReverse: 20 }
    const h = 1e-7
    const c = bjtCompanion(0.6, -5, rev, vt)
    const fdVbe =
      (bjtCurrents(0.6 + h, -5, rev, vt).iC - bjtCurrents(0.6 - h, -5, rev, vt).iC) / (2 * h)
    expect(c.dIC_dVBE).toBeCloseTo(fdVbe, 6)
  })
})

describe('overflow safety (the EXP_ARG_CAP guard)', () => {
  // pnjlim normally keeps a junction near 0.7 V, but a stale .nodeset seed or a curve-trace sweep can
  // hand the model an absurd V_BE. exp(5 / 0.026) ≈ exp(192) would be Infinity unclamped; the cap
  // keeps every current and conductance finite so the MNA matrix can't be poisoned with Inf/NaN.
  test('an absurd forward V_BE yields finite currents and a finite Jacobian, not Inf/NaN', () => {
    const i = bjtCurrents(5, 0, npn, vt)
    expect(Number.isFinite(i.iC)).toBe(true)
    expect(Number.isFinite(i.iB)).toBe(true)
    expect(Number.isFinite(i.iE)).toBe(true)
    const c = bjtCompanion(5, 0, npn, vt)
    expect(Number.isFinite(c.iC)).toBe(true)
    expect(Number.isFinite(c.dIC_dVBE)).toBe(true)
    expect(Number.isFinite(c.dIB_dVBE)).toBe(true)
  })
  test('the cap also protects the reverse junction and the high-injection knee', () => {
    const hi = { ...npn, kneeCurrentForward: 1e-3, earlyVoltageForward: 74 }
    const c = bjtCompanion(5, 3, hi, vt) // both junctions slammed far forward
    expect(Number.isFinite(c.iC)).toBe(true)
    expect(Number.isFinite(c.dIC_dVBC)).toBe(true)
  })
})
