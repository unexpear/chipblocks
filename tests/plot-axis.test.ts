/**
 * SHARED PLOT-AXIS HELPERS — the auto-ranging the reflection / distortion / S-parameter view modules all use.
 * Extracted from three byte-identical copies, so it's tested here where it lives.
 */
import { describe, expect, test } from 'vitest'
import { axisRange, niceCeil, niceFloor } from '../src/renderer/plot-axis.ts'

describe('axisRange', () => {
  test('snaps to the step and enforces the minimum span, centered', () => {
    expect(axisRange(2, 8, 10, 40)).toEqual([-20, 30]) // span 10 → padded ±20 about the midpoint 5, snapped
    expect(axisRange(-33, 12, 10, 40)).toEqual([-40, 20]) // already wider than 40 → just snapped out
  })

  test('already-wide data is only snapped to the step, not padded', () => {
    expect(axisRange(-7, 63, 10, 20)).toEqual([-10, 70]) // span 70 ≥ 20 → just round outward
  })
})

describe('niceFloor / niceCeil', () => {
  test('round outward to the nearest step', () => {
    expect(niceFloor(23, 10)).toBe(20)
    expect(niceCeil(23, 10)).toBe(30)
    expect(niceFloor(-23, 10)).toBe(-30)
    expect(niceCeil(-23, 10)).toBe(-20)
    expect(niceFloor(20, 10)).toBe(20) // exact multiples are unchanged
    expect(niceCeil(20, 10)).toBe(20)
  })
})
