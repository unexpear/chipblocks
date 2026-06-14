/**
 * Lens tests (S19-v3-50; field lens S19-v3-57) — the Stage 6 overlay math:
 * the voltage color ramp, the power heat scale, the flow-animation speed
 * mapping, and the magnetic-field contour math (Ampère's straight-wire law).
 */

import { describe, expect, test } from 'vitest'
import {
  FIELD_TARGET_PX,
  fieldHaloRadiusPx,
  fieldReferenceTesla,
  flowDuration,
  MU_0,
  powerColor,
  thermalWarmthTint,
  voltageColor,
} from '../src/renderer/lens.ts'

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

describe('field lens (Ampère straight-wire law)', () => {
  test('1 A at the 50 µT contour sits 4.0 mm out — the textbook number', () => {
    // r = μ₀·I/(2π·B) = (2×10⁻⁷ T·m/A)·1/5e-5 = 4.0 mm; 1 px = 1 mm → 4 px.
    expect(fieldHaloRadiusPx(1, 50e-6)).toBeCloseTo(4.0, 3)
  })
  test('B at 1 cm from a 1 A wire is the classic 2×10⁻⁵ T (0.2 gauss)', () => {
    const radiusPx = fieldHaloRadiusPx(1, 2e-5)
    expect(radiusPx).toBeCloseTo(10, 3) // 1 cm = 10 px on the canvas scale
  })
  test('field falls as 1/r: a 10× stronger contour sits 10× closer', () => {
    const outer = fieldHaloRadiusPx(0.0149, 1e-6)
    const inner = fieldHaloRadiusPx(0.0149, 1e-5)
    expect(outer / inner).toBeCloseTo(10, 9)
  })
  test('autorange round-trip: the biggest current lands exactly on the target radius', () => {
    const ref = fieldReferenceTesla(0.0149)
    expect(fieldHaloRadiusPx(0.0149, ref)).toBeCloseTo(FIELD_TARGET_PX, 9)
  })
  test('no current → no contour level and no band', () => {
    expect(fieldReferenceTesla(0)).toBe(0)
    expect(fieldHaloRadiusPx(0, 1e-6)).toBe(0)
    expect(fieldHaloRadiusPx(0.01, 0)).toBe(0)
  })
  test('μ₀/2π is the 2×10⁻⁷ constant every textbook quotes', () => {
    expect(MU_0 / (2 * Math.PI)).toBeCloseTo(2e-7, 13)
  })
})

describe('thermalWarmthTint (the temp lens heat-spread fill)', () => {
  const alphaOf = (color: string) => Number(color.match(/,\s*([\d.]+)\)$/)?.[1] ?? '0')

  test('null at or below the 25 °C ambient — nothing to show', () => {
    expect(thermalWarmthTint(25, 60)).toBeNull()
    expect(thermalWarmthTint(20, 60)).toBeNull()
  })

  test('null when nothing in the circuit runs warm', () => {
    expect(thermalWarmthTint(25, 25)).toBeNull()
  })

  test('a warm part is tinted even far below any rating — a healthy board is not blank', () => {
    // 35 °C against a 50 °C hottest part: well under any real maximum, yet still tinted.
    const tint = thermalWarmthTint(35, 50)
    expect(tint).not.toBeNull()
    expect(tint).toMatch(/^rgba\(224, /)
  })

  test('the hottest part is the strongest tint; a cooler part is fainter, and it stays faint', () => {
    const hottest = thermalWarmthTint(60, 60) ?? '' // rise share = 1
    const cooler = thermalWarmthTint(32.5, 60) ?? '' // rise share ≈ 0.21
    expect(alphaOf(hottest)).toBeGreaterThan(alphaOf(cooler))
    // a tint, never an alarm: caps below the power halo's 0.25 floor
    expect(alphaOf(hottest)).toBeLessThanOrEqual(0.24)
  })
})
