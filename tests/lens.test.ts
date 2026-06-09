/**
 * Lens tests (S19-v3-50) — the Stage 6 overlay math: the voltage color ramp,
 * the power heat scale, and the flow-animation speed mapping.
 */

import { describe, expect, test } from 'vitest'
import { flowDuration, powerColor, voltageColor } from '../src/renderer/lens.ts'

describe('voltageColor', () => {
  test('lowest potential is the blue end, highest the red end', () => {
    expect(voltageColor(0, 0, 9)).toBe('rgb(58, 96, 212)')
    expect(voltageColor(9, 0, 9)).toBe('rgb(214, 70, 52)')
  })
  test('the midpoint lands on the green stop', () => {
    expect(voltageColor(4.5, 0, 9)).toBe('rgb(72, 196, 84)')
  })
  test('out-of-range values clamp to the ends', () => {
    expect(voltageColor(-5, 0, 9)).toBe(voltageColor(0, 0, 9))
    expect(voltageColor(99, 0, 9)).toBe(voltageColor(9, 0, 9))
  })
  test('a degenerate range (all nets equal) reads as the middle green', () => {
    expect(voltageColor(5, 5, 5)).toBe('rgb(72, 196, 84)')
  })
})

describe('powerColor', () => {
  test('no dissipation → no halo', () => {
    expect(powerColor(0, 1)).toBeNull()
    expect(powerColor(0.5, 0)).toBeNull()
  })
  test('the hottest part is full red at the strongest alpha', () => {
    expect(powerColor(1, 1)).toBe('rgba(224, 70, 50, 0.70)')
  })
  test('a cooler part is yellower and fainter', () => {
    expect(powerColor(0.1, 1)).toBe('rgba(224, 183, 63, 0.29)')
  })
})

describe('flowDuration', () => {
  test('no current → no animation', () => {
    expect(flowDuration(0)).toBeNull()
  })
  test('bigger current marches faster (shorter period), sign ignored', () => {
    const tiny = flowDuration(1e-6) ?? 0
    const small = flowDuration(1e-3) ?? 0
    const big = flowDuration(0.1) ?? 0
    expect(tiny).toBeGreaterThan(small)
    expect(small).toBeGreaterThan(big)
    expect(flowDuration(-0.1)).toBe(big)
  })
  test('clamped to the 0.3–2 s band', () => {
    expect(flowDuration(1e-12)).toBe(2)
    expect(flowDuration(100)).toBe(0.3)
  })
})
