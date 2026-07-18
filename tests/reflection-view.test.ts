/**
 * REFLECTION PANEL LOGIC (analog-RF, increment 1 follow-up) — the panel's plot model, extracted so the
 * clamps, the axis bounds, the physical VSWR floor of 1, and the best-match pick are unit-tested instead of
 * being trusted on inspection of the React component. (The SVG drawing on top is what stays visual.)
 */
import { describe, expect, test } from 'vitest'
import type { ReflectionPoint } from '../src/ac-analysis.ts'
import {
  axisRange,
  RL_PLOT_MAX,
  reflectionView,
  VSWR_PLOT_MAX,
} from '../src/renderer/reflection-view.ts'

const pt = (
  frequencyHz: number,
  returnLossDb: number,
  vswr: number,
  zinRe = 50,
  zinIm = 0,
): ReflectionPoint => ({
  frequencyHz,
  zinRe,
  zinIm,
  gammaRe: 0,
  gammaIm: 0,
  gammaMag: vswr < 1 ? 0 : (vswr - 1) / (vswr + 1),
  returnLossDb,
  vswr,
})

describe('reflectionView — the panel plot model', () => {
  test('an empty sweep yields a null best-match and safe default axes', () => {
    const v = reflectionView([])
    expect(v.best).toBeNull()
    expect(v.rlClamped).toEqual([])
    expect(v.rlAxis).toEqual([0, 30])
    expect(v.vswrAxis).toEqual([1, 4])
  })

  test('the best match is the maximum-return-loss point', () => {
    const v = reflectionView([pt(1e6, 3, 6), pt(1e7, 25, 1.1, 55, -8), pt(1e8, 10, 2)])
    expect(v.best?.frequencyHz).toBe(1e7) // the deepest match (25 dB) wins, not the first or last
    expect(v.best?.vswr).toBeCloseTo(1.1, 6)
    expect(v.best?.zinRe).toBe(55)
    expect(v.best?.zinIm).toBe(-8)
  })

  test('a perfect match (∞ return loss, ∞ VSWR spike) is clamped for plotting, not dropped', () => {
    const v = reflectionView([
      pt(1e6, Number.POSITIVE_INFINITY, 1), // a perfectly matched point
      pt(1e7, 0, Number.POSITIVE_INFINITY), // a total reflection
    ])
    expect(v.rlClamped[0]).toBe(RL_PLOT_MAX) // ∞ return loss → clamped to the plot max
    expect(v.vswrClamped[1]).toBe(VSWR_PLOT_MAX) // ∞ VSWR → clamped
    expect(v.best?.frequencyHz).toBe(1e6) // ∞ return loss is still the best match
  })

  test('the VSWR axis never goes below 1 — even a fully-matched sweep', () => {
    // every point matched (VSWR ≈ 1): a symmetric auto-range would center below 1; the floor must hold.
    const v = reflectionView([pt(1e6, 40, 1.0), pt(1e7, 45, 1.0), pt(1e8, 42, 1.0)])
    expect(v.vswrAxis[0]).toBe(1)
    expect(v.vswrAxis[1]).toBeGreaterThanOrEqual(3)
  })

  test('the VSWR axis grows to enclose a big mismatch', () => {
    const v = reflectionView([pt(1e6, 1, 12)])
    expect(v.vswrAxis[0]).toBe(1)
    expect(v.vswrAxis[1]).toBeGreaterThanOrEqual(12)
  })

  test('the return-loss axis encloses the (clamped) data with a minimum span', () => {
    const v = reflectionView([pt(1e6, 5, 3.5), pt(1e7, 22, 1.2)])
    const [lo, hi] = v.rlAxis
    expect(lo).toBeLessThanOrEqual(5)
    expect(hi).toBeGreaterThanOrEqual(22)
    expect(hi - lo).toBeGreaterThanOrEqual(30) // the minimum span
  })
})

describe('axisRange', () => {
  test('snaps to the step and enforces the minimum span, centered', () => {
    expect(axisRange(2, 8, 10, 40)).toEqual([-20, 30]) // span 10 → padded ±20 about the midpoint 5, snapped
    expect(axisRange(-33, 12, 10, 40)).toEqual([-40, 20]) // already wider than 40 → just snapped out
  })
})
