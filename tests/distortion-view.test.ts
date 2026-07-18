/**
 * DISTORTION PANEL LOGIC (analog-RF) — unit tests for the pure plot maths the panel is drawn from, so the
 * parts that can be WRONG (the dB conversions, the ideal small-signal line, the P1dB placement, the dBc bar
 * heights, the THD percentage) are checked by value rather than trusted inside a React component.
 */
import { describe, expect, test } from 'vitest'
import {
  compressionCurveView,
  SPECTRUM_FLOOR_DBC,
  spectrumView,
} from '../src/renderer/distortion-view.ts'
import type { CompressionResult, LargeSignalSpectrum } from '../src/renderer/large-signal.ts'

describe('compressionCurveView — the gain-compression plot model', () => {
  test('maps volts to dBV and lays the ideal line at slope 1 through the small-signal gain', () => {
    // A clean ×10 amplifier that never compresses: output = 10 × input at every drive.
    const result: CompressionResult = {
      sweep: [0.01, 0.1, 1].map((inputVolts) => ({
        inputVolts,
        outputVolts: inputVolts * 10,
        gainDb: 20,
      })),
      smallSignalGainDb: 20,
      p1dbInputVolts: null,
      p1dbOutputVolts: null,
    }
    const view = compressionCurveView(result)
    // 0.01 V → −40 dBV in, ×10 → 0.1 V → −20 dBV out.
    expect(view.points[0]?.inputDb).toBeCloseTo(-40, 6)
    expect(view.points[0]?.outputDb).toBeCloseTo(-20, 6)
    expect(view.smallSignalGainDb).toBe(20)
    // The ideal line is y = x + gain (1 dB out per 1 dB in): its endpoints differ from x by exactly the gain.
    expect(view.idealLine).not.toBeNull()
    const line = view.idealLine as NonNullable<typeof view.idealLine>
    expect(line.y0 - line.x0).toBeCloseTo(20, 6)
    expect(line.y1 - line.x1).toBeCloseTo(20, 6)
    expect(view.p1db).toBeNull() // it never compressed → no marker
  })

  test('places the P1dB marker at the engine crossing, in dB space', () => {
    const result: CompressionResult = {
      sweep: [{ inputVolts: 0.5, outputVolts: 3, gainDb: 15.6 }],
      smallSignalGainDb: 20,
      p1dbInputVolts: 0.5,
      p1dbOutputVolts: 5,
    }
    const view = compressionCurveView(result)
    expect(view.p1db?.inputDb).toBeCloseTo(20 * Math.log10(0.5), 6)
    expect(view.p1db?.outputDb).toBeCloseTo(20 * Math.log10(5), 6)
  })

  test('an empty sweep yields safe defaults, no ideal line, no marker', () => {
    const view = compressionCurveView({
      sweep: [],
      smallSignalGainDb: Number.NaN,
      p1dbInputVolts: null,
      p1dbOutputVolts: null,
    })
    expect(view.points).toEqual([])
    expect(view.idealLine).toBeNull()
    expect(view.p1db).toBeNull()
    expect(view.xAxis[0]).toBeLessThan(view.xAxis[1]) // still a valid, orderable axis
  })

  test('drops non-positive points that have no finite dB value', () => {
    const result: CompressionResult = {
      sweep: [
        { inputVolts: 0.1, outputVolts: 1, gainDb: 20 },
        { inputVolts: 0.2, outputVolts: 0, gainDb: Number.NEGATIVE_INFINITY }, // a dead point
      ],
      smallSignalGainDb: 20,
      p1dbInputVolts: null,
      p1dbOutputVolts: null,
    }
    const view = compressionCurveView(result)
    expect(view.points).toHaveLength(1) // the 0 V output point is excluded, not plotted at −∞
  })

  test('a degenerate sweep (undefined gain) still fits axes to the real points, no ideal line', () => {
    // The smallest drive read no output (gain undefined), a larger one did — points survive but the gain is
    // non-finite. The axes must follow the surviving point, not fall back to a placeholder that maps it away.
    const result: CompressionResult = {
      sweep: [
        { inputVolts: 0.01, outputVolts: 0, gainDb: Number.NEGATIVE_INFINITY },
        { inputVolts: 1, outputVolts: 0.5, gainDb: -6 },
      ],
      smallSignalGainDb: Number.NEGATIVE_INFINITY,
      p1dbInputVolts: null,
      p1dbOutputVolts: null,
    }
    const view = compressionCurveView(result)
    expect(view.points).toHaveLength(1) // the 0-output point dropped
    expect(view.idealLine).toBeNull() // no finite gain → no reference line
    const inDb = 20 * Math.log10(1) // the surviving point's input, 0 dBV
    expect(view.xAxis[0]).toBeLessThanOrEqual(inDb) // the axis brackets the real point…
    expect(view.xAxis[1]).toBeGreaterThanOrEqual(inDb)
    expect(view.xAxis).not.toEqual([-40, 0]) // …not the placeholder that would map it off-plot
  })
})

describe('spectrumView — the harmonic bar model (dBc)', () => {
  const spectrum: LargeSignalSpectrum = {
    fundamentalVolts: 1,
    harmonics: [0.1, 0.01, 0, 0], // −20 dBc, −40 dBc, then nothing
    thd: Math.sqrt(0.1 ** 2 + 0.01 ** 2) / 1,
  }

  test('the fundamental is 0 dBc at full height; harmonics fall in 20 dB steps', () => {
    const view = spectrumView(spectrum)
    expect(view.bars[0]?.harmonic).toBe(1)
    expect(view.bars[0]?.dbc).toBeCloseTo(0, 6)
    expect(view.bars[0]?.heightFrac).toBeCloseTo(1, 6) // fundamental fills the plot
    expect(view.bars[1]?.dbc).toBeCloseTo(-20, 6) // 0.1 / 1
    expect(view.bars[2]?.dbc).toBeCloseTo(-40, 6) // 0.01 / 1
  })

  test('absent harmonics sink to the floor (never below), with height 0', () => {
    const view = spectrumView(spectrum)
    const dead = view.bars[3] // amplitude 0
    expect(dead?.dbc).toBe(SPECTRUM_FLOOR_DBC)
    expect(dead?.heightFrac).toBeCloseTo(0, 6)
  })

  test('THD is reported as a percentage', () => {
    const view = spectrumView(spectrum)
    expect(view.thdPercent).toBeCloseTo(spectrum.thd * 100, 6)
    expect(view.thdPercent).toBeGreaterThan(9) // ≈10.05 %
  })

  test('a pure tone (no harmonics) reports 0 % and only a full fundamental', () => {
    const view = spectrumView({ fundamentalVolts: 2, harmonics: [0, 0, 0, 0], thd: 0 })
    expect(view.thdPercent).toBe(0)
    expect(view.bars[0]?.heightFrac).toBeCloseTo(1, 6)
    expect(view.bars.slice(1).every((b) => b.heightFrac === 0)).toBe(true)
  })

  test('a harmonic louder than the fundamental keeps an honest >0 dBc but a bar capped at full height', () => {
    // A frequency-doubler-like output: the 2f harmonic (0.3 V) is bigger than the fundamental (0.1 V).
    const view = spectrumView({ fundamentalVolts: 0.1, harmonics: [0.3, 0, 0, 0], thd: 3 })
    const h2 = view.bars[1]
    expect(h2?.dbc).toBeCloseTo(20 * Math.log10(3), 6) // ≈ +9.54 dBc — the true value, not clamped
    expect(h2?.dbc).toBeGreaterThan(0)
    expect(h2?.heightFrac).toBe(1) // …but the drawn bar is capped so it can't overshoot its pane
  })
})
