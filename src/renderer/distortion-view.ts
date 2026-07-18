/**
 * DISTORTION PANEL LOGIC, pulled out of distortion-panel.tsx so the parts that can be WRONG are pure and
 * unit-tested rather than trusted on inspection inside a React component. Two views, both fed by the
 * large-signal engine (large-signal.ts):
 *   • the GAIN-COMPRESSION curve — output fundamental vs drive on log (dB) axes, the ideal small-signal line
 *     it would follow if it never compressed, and the marked 1-dB compression point (P1dB); and
 *   • the HARMONIC SPECTRUM at one drive — each harmonic in dBc (relative to the fundamental) as a bar, with
 *     the total-harmonic-distortion percentage.
 * The panel keeps only the SVG coordinate mapping + the controls; the axis maths, the ideal-line slope, the
 * P1dB placement, and the dBc bar heights are here, covered by tests.
 */
import type { CompressionResult, LargeSignalSpectrum } from './large-signal.ts'
import { axisRange } from './plot-axis.ts'

/** Bars weaker than this (relative to the fundamental) are drawn at the floor rather than off the bottom. */
export const SPECTRUM_FLOOR_DBC = -80

const dbv = (volts: number) => 20 * Math.log10(volts)

export type CompressionCurveView = {
  /** The measured sweep in dB space: x = input drive (dBV), y = output fundamental (dBV). */
  points: { inputDb: number; outputDb: number }[]
  /** The ideal (undistorted) small-signal response — a slope-1 line y = x + smallSignalGainDb — as two
   *  endpoints across the input axis; null when there is nothing to anchor it to. */
  idealLine: { x0: number; y0: number; x1: number; y1: number } | null
  /** The 1-dB compression point in dB space, or null if the sweep never compressed 1 dB. */
  p1db: { inputDb: number; outputDb: number } | null
  /** Input-drive axis [lo, hi] in dBV. */
  xAxis: [number, number]
  /** Output axis [lo, hi] in dBV. */
  yAxis: [number, number]
  /** The small-signal gain (dB) — the flat gain the ideal line has, echoed for the read-out. */
  smallSignalGainDb: number
}

/** Turn a gain-compression sweep into the panel's plot model — dB points, the ideal line, the P1dB marker. */
export function compressionCurveView(result: CompressionResult): CompressionCurveView {
  const points = result.sweep
    .filter((p) => p.inputVolts > 0 && p.outputVolts > 0)
    .map((p) => ({ inputDb: dbv(p.inputVolts), outputDb: dbv(p.outputVolts) }))
  const gain = result.smallSignalGainDb
  if (points.length === 0) {
    return {
      points,
      idealLine: null,
      p1db: null,
      xAxis: [-40, 0],
      yAxis: [-40, 0],
      smallSignalGainDb: gain,
    }
  }
  const xs = points.map((p) => p.inputDb)
  const xAxis = axisRange(Math.min(...xs), Math.max(...xs), 10, 20)
  // The ideal line is the small-signal gain extended straight (1 dB out per 1 dB in) across the whole input
  // axis — what the output WOULD be with no compression. The measured curve peeling below it IS the
  // compression, and the vertical gap reaching 1 dB is the P1dB. It needs a finite small-signal gain; if the
  // sweep is degenerate (e.g. its smallest drive read no output, leaving the gain undefined) we still plot the
  // measured points, just without the reference line — the axes always fit the real data, not a placeholder.
  const idealLine = Number.isFinite(gain)
    ? { x0: xAxis[0], y0: xAxis[0] + gain, x1: xAxis[1], y1: xAxis[1] + gain }
    : null
  const p1db =
    result.p1dbInputVolts !== null && result.p1dbOutputVolts !== null
      ? { inputDb: dbv(result.p1dbInputVolts), outputDb: dbv(result.p1dbOutputVolts) }
      : null
  const ys = points.map((p) => p.outputDb)
  const yLo = Math.min(...ys, ...(idealLine ? [idealLine.y0, idealLine.y1] : []))
  const yHi = Math.max(...ys, ...(idealLine ? [idealLine.y0, idealLine.y1] : []))
  const yAxis = axisRange(yLo, yHi, 10, 20)
  return { points, idealLine, p1db, xAxis, yAxis, smallSignalGainDb: gain }
}

export type SpectrumBar = {
  /** Harmonic order (1 = fundamental, 2 = second harmonic, …). */
  harmonic: number
  /** Amplitude relative to the fundamental, dBc (the fundamental is 0 dBc), floored at SPECTRUM_FLOOR_DBC —
   *  the honest value, which CAN exceed 0 (a harmonic louder than the fundamental, e.g. a frequency doubler). */
  dbc: number
  /** Bar height as a fraction, CLAMPED to 0..1 (a >0 dBc bar pins at full height) so it never overdraws its
   *  plot region; the true magnitude stays in `dbc`. */
  heightFrac: number
}
export type SpectrumView = {
  bars: SpectrumBar[]
  /** Total harmonic distortion as a percentage (0 = a pure tone). */
  thdPercent: number
  floorDbc: number
}

/** Turn one large-signal spectrum into dBc bars (fundamental + harmonics) + the THD percentage. */
export function spectrumView(
  spectrum: LargeSignalSpectrum,
  floorDbc: number = SPECTRUM_FLOOR_DBC,
): SpectrumView {
  const fund = spectrum.fundamentalVolts
  const toBar = (harmonic: number, volts: number): SpectrumBar => {
    const dbc = fund > 0 && volts > 0 ? Math.max(floorDbc, 20 * Math.log10(volts / fund)) : floorDbc
    return { harmonic, dbc, heightFrac: Math.min(1, (dbc - floorDbc) / (0 - floorDbc)) }
  }
  const bars: SpectrumBar[] = [toBar(1, fund)]
  for (let i = 0; i < spectrum.harmonics.length; i++) {
    bars.push(toBar(i + 2, spectrum.harmonics[i] ?? 0))
  }
  return { bars, thdPercent: spectrum.thd * 100, floorDbc }
}
