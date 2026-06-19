/**
 * Vacuum-tube physics tests — the Child-Langmuir space-charge law (I = P·V^1.5) and
 * the grid-tube operating point (I_p = P·(V_g + V_p/mu)^1.5), the shared core of the
 * diode / triode / tetrode / pentode family. Pure functions, cross-checked against
 * the closed-form law and against numerical derivatives.
 */

import { describe, expect, test } from 'vitest'
import {
  childLangmuirCurrent,
  childLangmuirSlope,
  gridTubeOperatingPoint,
  perveanceFromOperatingPoint,
  screenGridTubeOperatingPoint,
  vacuumDiodeCompanion,
} from '../src/vacuum-tube-model.ts'

describe('the Child-Langmuir law I = perveance·V^1.5', () => {
  const P = 2e-6

  test('plate current follows the 3/2 power of the accelerating voltage', () => {
    expect(childLangmuirCurrent(100, P)).toBeCloseTo(P * 100 ** 1.5, 12)
    // doubling the voltage raises the current by 2^1.5 ≈ 2.83×, not 2×
    expect(childLangmuirCurrent(200, P) / childLangmuirCurrent(100, P)).toBeCloseTo(2 ** 1.5, 9)
  })

  test('it blocks reverse — no current when the plate is negative (rectification)', () => {
    expect(childLangmuirCurrent(-100, P)).toBe(0)
    expect(childLangmuirCurrent(0, P)).toBe(0)
  })

  test('the slope is the analytic derivative 1.5·P·sqrt(V)', () => {
    const v = 150
    expect(childLangmuirSlope(v, P)).toBeCloseTo(1.5 * P * Math.sqrt(v), 12)
    // matches a numerical derivative of the current
    const h = 1e-3
    const numeric = (childLangmuirCurrent(v + h, P) - childLangmuirCurrent(v - h, P)) / (2 * h)
    expect(childLangmuirSlope(v, P)).toBeCloseTo(numeric, 6)
  })

  test('perveance round-trips through a datasheet operating point', () => {
    const derived = perveanceFromOperatingPoint(0.01, 250) // 10 mA at 250 V
    expect(childLangmuirCurrent(250, derived)).toBeCloseTo(0.01, 9)
  })
})

describe('the vacuum-diode Newton companion', () => {
  const P = 3e-4

  test('the companion reconstructs the true current at its linearization point', () => {
    const v = 12
    const { conductance, currentSource } = vacuumDiodeCompanion(v, P)
    // G_eq·V + I_eq must equal I(V)
    expect(conductance * v + currentSource).toBeCloseTo(childLangmuirCurrent(v, P), 12)
    expect(conductance).toBeCloseTo(childLangmuirSlope(v, P), 12)
  })

  test('below cut-off it is a near-open, never singular', () => {
    const off = vacuumDiodeCompanion(-50, P)
    expect(off.currentSource).toBe(0)
    expect(off.conductance).toBeGreaterThan(0) // a tiny floor keeps the node solvable
    expect(off.conductance).toBeLessThan(1e-9)
  })
})

describe('the grid tube I_p = P·(V_g + V_p/mu)^1.5', () => {
  const P = 5e-4
  const mu = 100

  test('plate current uses the effective voltage V_g + V_p/mu', () => {
    const vp = 250
    const vg = -2
    const op = gridTubeOperatingPoint(vp, vg, P, mu)
    const vEff = vg + vp / mu // -2 + 2.5 = 0.5
    expect(op.plateCurrent).toBeCloseTo(P * vEff ** 1.5, 12)
  })

  test('the grid is mu times more effective than the plate: g_m = mu·g_p', () => {
    const op = gridTubeOperatingPoint(250, -1, P, mu)
    expect(op.gm / op.gp).toBeCloseTo(mu, 6)
    // and mu = g_m · r_p, the textbook relation (r_p = 1/g_p)
    const rp = 1 / op.gp
    expect(op.gm * rp).toBeCloseTo(mu, 6)
  })

  test('g_m matches a numerical derivative of plate current vs grid voltage', () => {
    const vp = 250
    const vg = -1.5
    const h = 1e-4
    const numeric =
      (gridTubeOperatingPoint(vp, vg + h, P, mu).plateCurrent -
        gridTubeOperatingPoint(vp, vg - h, P, mu).plateCurrent) /
      (2 * h)
    expect(gridTubeOperatingPoint(vp, vg, P, mu).gm).toBeCloseTo(numeric, 6)
  })

  test('a sufficiently negative grid cuts the tube off (no plate current)', () => {
    // V_g = -5 with V_p/mu = +2.5 → V_eff = -2.5 < 0 → cut off.
    const op = gridTubeOperatingPoint(250, -5, P, mu)
    expect(op.plateCurrent).toBe(0)
  })
})

describe('the screen-grid tube I_p = P·(V_g1 + V_g2/μs + V_p/μp)^1.5 (tetrode/pentode)', () => {
  const P = 5e-4
  const screenMu = 20
  const plateMu = 2000 // large → the plate barely affects the current (flat characteristic)

  test('FLAT plate characteristic: the plate barely controls the current (g_p ≪ g_m)', () => {
    const op = screenGridTubeOperatingPoint(250, -2, 100, P, screenMu, plateMu)
    // the plate's grip is weaker than the control grid's by μ_plate (≈1000×)
    expect(op.gp / op.gm).toBeCloseTo(1 / plateMu, 9)
    expect(op.gp).toBeLessThan(op.gm / 100) // a very high plate resistance r_p = 1/g_p
  })

  test('the screen accelerates: it controls the current μ_screen× less than the grid', () => {
    const op = screenGridTubeOperatingPoint(250, -2, 100, P, screenMu, plateMu)
    expect(op.gm / op.gScreen).toBeCloseTo(screenMu, 6)
  })

  test('g_m matches a numerical derivative of plate current vs the control grid', () => {
    const vp = 250
    const vg2 = 100
    const vg1 = -2
    const h = 1e-4
    const numeric =
      (screenGridTubeOperatingPoint(vp, vg1 + h, vg2, P, screenMu, plateMu).plateCurrent -
        screenGridTubeOperatingPoint(vp, vg1 - h, vg2, P, screenMu, plateMu).plateCurrent) /
      (2 * h)
    expect(screenGridTubeOperatingPoint(vp, vg1, vg2, P, screenMu, plateMu).gm).toBeCloseTo(
      numeric,
      6,
    )
  })

  test('the screen, not the plate, sustains the current — dropping the plate barely changes I_p', () => {
    const hot = screenGridTubeOperatingPoint(250, -2, 100, P, screenMu, plateMu).plateCurrent
    const lowPlate = screenGridTubeOperatingPoint(120, -2, 100, P, screenMu, plateMu).plateCurrent
    // halving the plate voltage changes the plate current by well under 5% (flat curve)
    expect(Math.abs(lowPlate - hot) / hot).toBeLessThan(0.05)
  })
})
