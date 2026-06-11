/**
 * Scope scale tests (S19-v3-78) — the timebase / volts-per-division knob
 * stops, the per-channel vertical transform, and the honest-sampling step
 * budget (>= 32 samples per fastest-source cycle, <= 20 000 steps).
 */

import { describe, expect, test } from 'vitest'
import {
  AUTO_FILL_DIVISIONS,
  scopeRecordSteps,
  slowestHonestTimebase,
  TIMEBASES,
  transformFor,
  V_DIVISIONS,
  VOLTS_PER_DIV,
} from '../src/renderer/scope-scales.ts'

function isOneTwoFive(value: number): boolean {
  const exponent = Math.floor(Math.log10(value) + 1e-9)
  const mantissa = value / 10 ** exponent
  return [1, 2, 5].some((m) => Math.abs(mantissa - m) < 1e-6)
}

describe('knob stops', () => {
  test('timebases run 1 µs/div to 1 s/div in the 1-2-5 sequence, ascending', () => {
    expect(TIMEBASES[0]).toBeCloseTo(1e-6, 12)
    expect(TIMEBASES[TIMEBASES.length - 1]).toBeCloseTo(1, 9)
    for (let i = 1; i < TIMEBASES.length; i++) {
      expect(TIMEBASES[i]).toBeGreaterThan(TIMEBASES[i - 1] ?? 0)
    }
    for (const value of TIMEBASES) expect(isOneTwoFive(value)).toBe(true)
  })

  test('volts/div stops run 1 mV/div to 20 V/div in the 1-2-5 sequence', () => {
    expect(VOLTS_PER_DIV[0]).toBeCloseTo(1e-3, 9)
    expect(VOLTS_PER_DIV[VOLTS_PER_DIV.length - 1]).toBeCloseTo(20, 9)
    for (const value of VOLTS_PER_DIV) expect(isOneTwoFive(value)).toBe(true)
  })
})

describe('transformFor', () => {
  test('auto fits the swing into the fill divisions, centered on the midpoint', () => {
    const tf = transformFor(-5, 5, 'auto')
    expect(tf.offsetVolts).toBe(0)
    expect(tf.voltsPerDiv).toBeCloseTo(10 / AUTO_FILL_DIVISIONS, 12)
  })

  test('an offset signal centers on its own midpoint (4.2–4.8 V sits at 4.5 V)', () => {
    const tf = transformFor(4.2, 4.8, 'auto')
    expect(tf.offsetVolts).toBeCloseTo(4.5, 12)
    expect(tf.voltsPerDiv).toBeCloseTo(0.6 / AUTO_FILL_DIVISIONS, 12)
  })

  test('a flat trace gets the 1 V full-screen window of the old view', () => {
    const tf = transformFor(9, 9, 'auto')
    expect(tf.offsetVolts).toBe(9)
    expect(tf.voltsPerDiv * V_DIVISIONS).toBeCloseTo(1, 12)
  })

  test('a manual setting is respected; the offset still auto-centers', () => {
    const tf = transformFor(-5, 5, 2)
    expect(tf.voltsPerDiv).toBe(2)
    expect(tf.offsetVolts).toBe(0)
  })
})

describe('scopeRecordSteps', () => {
  test('the display floor wins when sampling needs less (1 kHz over a 9 ms record)', () => {
    expect(scopeRecordSteps(9e-3, 1000)).toBe(1500)
  })

  test('sampling the fastest source sets the count past the floor', () => {
    // 600 ms record x 1 kHz x 32 samples/cycle = 19 200 steps.
    expect(scopeRecordSteps(0.6, 1000)).toBe(19200)
  })

  test('a record too long to sample honestly is refused, not aliased', () => {
    expect(scopeRecordSteps(3, 1000)).toBe('span-too-wide')
  })

  test('with no AC source any record length passes at the floor', () => {
    expect(scopeRecordSteps(30, 0)).toBe(1500)
  })
})

describe('slowestHonestTimebase', () => {
  test('names 20 ms/div as the limit for a 1 kHz source', () => {
    // 20 ms/div x 10 div x 3 windows = 600 ms -> 19 200 steps (fits);
    // the next stop, 50 ms/div, would need 48 000 (refused).
    expect(slowestHonestTimebase(1000)).toBeCloseTo(0.02, 12)
  })

  test('with no AC source the whole knob is honest, up to 1 s/div', () => {
    expect(slowestHonestTimebase(0)).toBeCloseTo(1, 9)
  })
})
