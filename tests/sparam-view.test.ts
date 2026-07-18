/**
 * S-PARAMETER PANEL LOGIC (analog-RF) — unit tests for the pure plot maths the panel is drawn from: the dB
 * clamps (a deep null floored, active gain lightly capped), the two auto-ranged axes, and the peak-transmission
 * / best-match picks — so the parts that can be WRONG are checked by value, not trusted inside a component.
 */
import { describe, expect, test } from 'vitest'
import type { SParamPoint } from '../src/ac-analysis.ts'
import { S_CEIL_DB, S_FLOOR_DB, sparamView } from '../src/renderer/sparam-view.ts'

const C = { re: 0, im: 0 }
/** A sweep point with the four dB magnitudes set (the complex values are unused by the view). */
const pt = (
  frequencyHz: number,
  s11Db: number,
  s21Db: number,
  s12Db = s21Db,
  s22Db = s11Db,
): SParamPoint => ({
  frequencyHz,
  s11: C,
  s21: C,
  s12: C,
  s22: C,
  s11Db,
  s21Db,
  s12Db,
  s22Db,
  s11Deg: 0,
  s21Deg: 0,
  s12Deg: 0,
  s22Deg: 0,
})

describe('sparamView — the S-parameter plot model', () => {
  test('picks the peak |S21| and the deepest (best) |S11| across the band', () => {
    const sweep = [pt(1e6, -5, -3), pt(1e7, -20, -0.5), pt(1e8, -8, -10)]
    const view = sparamView(sweep)
    expect(view.peakS21?.db).toBe(-0.5) // the biggest transmission
    expect(view.peakS21?.frequencyHz).toBe(1e7)
    expect(view.bestMatch?.db).toBe(-20) // the deepest input reflection = best match
    expect(view.bestMatch?.frequencyHz).toBe(1e7)
  })

  test('floors a deep null and a non-finite dB at the plot floor', () => {
    const view = sparamView([pt(1e6, Number.NEGATIVE_INFINITY, -200)])
    expect(view.s11Db[0]).toBe(S_FLOOR_DB) // −∞ dB (a perfect null) is floored, not left as −∞
    expect(view.s21Db[0]).toBe(S_FLOOR_DB) // −200 dB is below the floor → clamped up to it
  })

  test('caps an active |S21| (gain above the ceiling) so it cannot blow the axis', () => {
    const view = sparamView([pt(1e6, -3, 40)]) // 40 dB gain (an active part)
    expect(view.s21Db[0]).toBe(S_CEIL_DB) // clamped to the ceiling for drawing
  })

  test('axes bracket the data and stay within the plot dB limits', () => {
    const view = sparamView([pt(1e6, -5, -1), pt(1e7, -30, -2)])
    const [tLo, tHi] = view.transAxis
    const [mLo, mHi] = view.matchAxis
    expect(tLo).toBeGreaterThanOrEqual(S_FLOOR_DB)
    expect(tHi).toBeLessThanOrEqual(S_CEIL_DB)
    expect(tHi).toBeGreaterThan(tLo)
    expect(mLo).toBeLessThanOrEqual(-30) // the −30 dB point is inside the match axis
    expect(mHi).toBeGreaterThan(mLo)
  })

  test('an empty sweep yields safe default axes and no extremes', () => {
    const view = sparamView([])
    expect(view.peakS21).toBeNull()
    expect(view.bestMatch).toBeNull()
    expect(view.transAxis[0]).toBeLessThan(view.transAxis[1])
    expect(view.s21Db).toEqual([])
  })
})
