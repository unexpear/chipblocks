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
