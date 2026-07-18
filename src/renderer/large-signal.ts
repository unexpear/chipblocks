/**
 * LARGE-SIGNAL RF (analog-RF chapter) — the nonlinear metrics the small-signal AC engine can't give:
 * harmonic distortion (THD) and gain compression (the 1-dB compression point, P1dB). It reaches them the
 * honest way, WITHOUT a harmonic-balance solver: drive the circuit HARD with a real sinusoid through the
 * existing nonlinear TRANSIENT solver (full per-step Newton on the diode / BJT / MOSFET models, so the stage
 * genuinely saturates and generates harmonics — not a linearized approximation), let it reach steady state,
 * and FFT the output. The fundamental and harmonic bins fall straight out of the spectrum.
 *
 * SCOPE (honest): this is the time-domain (transient + FFT) route to single-tone large-signal figures —
 * exact for a bin-aligned tone, limited by the transient step size and the FFT's dynamic range for very weak
 * products, and best on settling (non-high-Q) stages. Two-tone IP3 (a second series source) and oscillator
 * phase noise (which needs a nonlinear steady state + noise) are separate follow-ups; this ships the
 * single-tone spectrum + compression, the core large-signal read-outs.
 */
import type { World } from '../cross-fk-validator.ts'
import { solveTransient, transientRan } from '../transient-solver.ts'
import { fftMagnitudes } from './scope-fft.ts'

export type LargeSignalOptions = {
  /** The driving source (a power_source id) — its ac_amplitude + frequency are set for the sweep. */
  inputSource: string
  /** The net whose spectrum is analysed (the amplifier output). */
  outputNet: string
  /** The drive (fundamental) frequency, Hz. */
  fundamentalHz: number
  /** Samples per fundamental cycle — coerced to a power of two ≥ 16 so every harmonic is bin-aligned and below
   *  Nyquist. Default 64. */
  samplesPerCycle?: number
  /** Cycles to run before capturing, so the startup transient has settled. Default 16. */
  settleCycles?: number
  /** Cycles captured for the FFT (which analyses the largest power-of-two-sample tail of them); ≥ 1. Default 64. */
  captureCycles?: number
  temperaturesC?: Map<string, number>
}

export type LargeSignalSpectrum = {
  /** Output fundamental amplitude at the drive frequency (peak volts). */
  fundamentalVolts: number
  /** Harmonic amplitudes [2f, 3f, 4f, 5f] (peak volts). */
  harmonics: number[]
  /** Total harmonic distortion = √(Σ harmonic²) / fundamental, a fraction (0 = a pure tone). */
  thd: number
}

const HARMONIC_COUNT = 5 // analyse up to the 5th harmonic for THD
const scalarParam = (amount: number, unit: string) => ({
  value: { kind: 'scalar' as const, amount, unit },
})

/** A copy of `world` with the drive source set to a sinusoid of the given amplitude + frequency (its DC bias
 *  and everything else preserved). */
function withDrive(
  world: World,
  sourceId: string,
  amplitudeVolts: number,
  frequencyHz: number,
): World {
  const src = world.instances.get(sourceId)
  if (src === undefined) return world
  const instances = new Map(world.instances)
  instances.set(sourceId, {
    ...src,
    parameters: {
      ...src.parameters,
      ac_amplitude: scalarParam(amplitudeVolts, 'volt'),
      frequency: scalarParam(frequencyHz, 'hertz'),
    },
  })
  return { ...world, instances }
}

/**
 * Drive the circuit with a single large tone, run the nonlinear transient to steady state, and FFT the
 * output — returning the fundamental + harmonic amplitudes + THD. Null if the transient can't run.
 */
export function largeSignalSpectrum(
  world: World,
  opts: LargeSignalOptions,
  inputAmplitudeVolts: number,
): LargeSignalSpectrum | null {
  const f = opts.fundamentalHz
  if (!(f > 0) || !(inputAmplitudeVolts > 0)) return null
  // samplesPerCycle is COERCED to a power of two ≥ 16: a power of two makes the fundamental + harmonics land
  // EXACTLY on FFT bins (the FFT keeps a power-of-two tail N, and the fundamental bin N/samplesPerCycle is
  // integer only when samplesPerCycle is itself a power of two — else a fractional bin reads ~15 % low from
  // Hann scalloping); ≥ 16 keeps the analysed harmonics (up to the 5th) below the f·samplesPerCycle/2 Nyquist
  // so they don't alias. captureCycles ≥ 1 so the fundamental is never mis-identified.
  const samplesPerCycle =
    2 ** Math.max(4, Math.round(Math.log2(Math.max(1, opts.samplesPerCycle ?? 64))))
  const settleCycles = Math.max(0, Math.round(opts.settleCycles ?? 16))
  const captureCycles = Math.max(1, Math.round(opts.captureCycles ?? 64))

  const dt = 1 / (f * samplesPerCycle)
  const duration = (settleCycles + captureCycles) / f
  const driven = withDrive(world, opts.inputSource, inputAmplitudeVolts, f)
  const res = solveTransient(driven, {
    timeStep: dt,
    duration,
    ...(opts.temperaturesC ? { temperaturesC: opts.temperaturesC } : {}),
  })
  if (!transientRan(res.status)) return null

  const settleTime = settleCycles / f
  const tail = res.series
    .filter((p) => p.time >= settleTime)
    .map((p) => p.nodes.get(opts.outputNet) ?? 0)
  const spectrum = fftMagnitudes(tail, dt)
  if (spectrum === null) return null

  // Fundamental at bin N/samplesPerCycle (integer, both powers of two); harmonic h at h× that. Bin k lives at
  // amplitude[k−1]. A bin at/above Nyquist (N/2) reads 0 — a harmonic there would have aliased in the time
  // samples, so it is excluded rather than trusted (with samplesPerCycle ≥ 16 all of 2f..5f are safely below).
  const nyquistBin = spectrum.pointCount / 2
  const amp = (bin: number): number =>
    bin >= 1 && bin < nyquistBin && bin - 1 < spectrum.amplitude.length
      ? (spectrum.amplitude[bin - 1] ?? 0)
      : 0
  const binOf = (harmonic: number) => Math.round(harmonic * f * spectrum.pointCount * dt)
  const fundamentalVolts = amp(binOf(1))
  const harmonics: number[] = []
  for (let h = 2; h <= HARMONIC_COUNT; h++) harmonics.push(amp(binOf(h)))
  const harmonicPower = harmonics.reduce((sum, a) => sum + a * a, 0)
  const thd = fundamentalVolts > 0 ? Math.sqrt(harmonicPower) / fundamentalVolts : 0
  return { fundamentalVolts, harmonics, thd }
}

export type CompressionPoint = {
  /** Drive (input) amplitude, peak volts. */
  inputVolts: number
  /** Output fundamental amplitude, peak volts. */
  outputVolts: number
  /** Gain 20·log10(output / input), dB. */
  gainDb: number
}
export type CompressionResult = {
  sweep: CompressionPoint[]
  /** The small-signal (undistorted) gain — the gain at the smallest drive, dB. */
  smallSignalGainDb: number
  /** Drive amplitude (V) at 1-dB compression, interpolated; null if the gain never falls 1 dB in the sweep. */
  p1dbInputVolts: number | null
  /** Output fundamental (V) at 1-dB compression. */
  p1dbOutputVolts: number | null
}

/**
 * Sweep the drive amplitude and track the output fundamental to find the 1-dB compression point (P1dB) — the
 * input at which the gain has fallen 1 dB below its small-signal value. `inputAmplitudes` must be ascending
 * and start small enough to be in the linear region (so the first point IS the small-signal gain). Points
 * whose transient can't run are skipped.
 */
export function gainCompression(
  world: World,
  opts: LargeSignalOptions,
  inputAmplitudes: number[],
): CompressionResult {
  const sweep: CompressionPoint[] = []
  for (const inputVolts of inputAmplitudes) {
    const spectrum = largeSignalSpectrum(world, opts, inputVolts)
    if (spectrum === null) continue
    const outputVolts = spectrum.fundamentalVolts
    sweep.push({ inputVolts, outputVolts, gainDb: 20 * Math.log10(outputVolts / inputVolts) })
  }
  const smallSignalGainDb = sweep[0]?.gainDb ?? Number.NaN
  const target = smallSignalGainDb - 1

  let p1dbInputVolts: number | null = null
  let p1dbOutputVolts: number | null = null
  for (let i = 1; i < sweep.length; i++) {
    const prev = sweep[i - 1] as CompressionPoint
    const cur = sweep[i] as CompressionPoint
    // The gain crosses (small-signal − 1 dB) between prev and cur → linearly interpolate the crossing.
    if (prev.gainDb > target && cur.gainDb <= target) {
      const frac = (prev.gainDb - target) / (prev.gainDb - cur.gainDb)
      p1dbInputVolts = prev.inputVolts + frac * (cur.inputVolts - prev.inputVolts)
      p1dbOutputVolts = prev.outputVolts + frac * (cur.outputVolts - prev.outputVolts)
      break
    }
  }
  return { sweep, smallSignalGainDb, p1dbInputVolts, p1dbOutputVolts }
}
