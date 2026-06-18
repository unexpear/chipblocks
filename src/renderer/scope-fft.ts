/**
 * FFT for the scope (S19-v3-81) — frequency content of a sampled trace.
 * Radix-2 Cooley-Tukey written from scratch (the algorithm is textbook
 * public knowledge; no library, no license question).
 *
 * Conventions, matching what a bench scope's FFT mode does by default:
 *  - The longest power-of-two TAIL of the record is analyzed (the tail is
 *    the most settled part).
 *  - The mean is removed first (AC-coupled — the DC level would otherwise
 *    dwarf every real peak; the strip's "dc" number already reports it).
 *  - A periodic (DFT-even) Hann window tapers the slice so a non-whole number of
 *    cycles doesn't smear false content across the spectrum; amplitudes are
 *    corrected for the window's gain (×2 single-sided, ÷0.5 Hann coherent gain —
 *    exact for the periodic window, where the symmetric n-1 form runs ~1/n high).
 *  - Off-bin tones still read up to ~15 % low (Hann scalloping) — true of
 *    real scopes too; the peak FREQUENCY stays within one bin.
 */

export type Spectrum = {
  /** Bin center frequencies, bin 1 .. N/2−1 (DC removed, Nyquist dropped). */
  freqHz: number[]
  /** Single-sided amplitude per bin, in the input's units (volts). */
  amplitude: number[]
  /** Frequency resolution — one bin's width: 1/(N·dt). */
  deltaFHz: number
  /** Samples actually analyzed (the power-of-two tail). */
  pointCount: number
}

function fftInPlace(re: number[], im: number[]): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; (j & bit) !== 0; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i] ?? 0
      re[i] = re[j] ?? 0
      re[j] = tr
      const ti = im[i] ?? 0
      im[i] = im[j] ?? 0
      im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len
    const stepRe = Math.cos(angle)
    const stepIm = Math.sin(angle)
    for (let start = 0; start < n; start += len) {
      let wRe = 1
      let wIm = 0
      const half = len >> 1
      for (let k = 0; k < half; k++) {
        const aRe = re[start + k] ?? 0
        const aIm = im[start + k] ?? 0
        const bRe = (re[start + k + half] ?? 0) * wRe - (im[start + k + half] ?? 0) * wIm
        const bIm = (re[start + k + half] ?? 0) * wIm + (im[start + k + half] ?? 0) * wRe
        re[start + k] = aRe + bRe
        im[start + k] = aIm + bIm
        re[start + k + half] = aRe - bRe
        im[start + k + half] = aIm - bIm
        const nextRe = wRe * stepRe - wIm * stepIm
        wIm = wRe * stepIm + wIm * stepRe
        wRe = nextRe
      }
    }
  }
}

export function fftMagnitudes(samples: number[], dtSeconds: number): Spectrum | null {
  if (samples.length < 16 || !(dtSeconds > 0)) return null
  const n = 2 ** Math.floor(Math.log2(samples.length))
  const tail = samples.slice(samples.length - n)
  let mean = 0
  for (const v of tail) mean += v
  mean /= n
  const re: number[] = new Array(n)
  const im: number[] = new Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    // PERIODIC (DFT-even) Hann — denominator n, not n-1. The symmetric (n-1) form is for
    // filter design; the periodic one is the correct window for FFT spectral analysis and
    // its coherent gain is EXACTLY 0.5, which makes the 4/n amplitude scale below exact (a
    // bin-aligned tone reads its true amplitude, not ~1/n high as the n-1 window gave).
    const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / n))
    re[i] = ((tail[i] ?? 0) - mean) * hann
  }
  fftInPlace(re, im)
  const freqHz: number[] = []
  const amplitude: number[] = []
  // ×2 for the single-sided fold, ÷(N·0.5) for length and Hann coherent gain.
  const scale = 4 / n
  for (let k = 1; k < n / 2; k++) {
    freqHz.push(k / (n * dtSeconds))
    amplitude.push(Math.hypot(re[k] ?? 0, im[k] ?? 0) * scale)
  }
  return { freqHz, amplitude, deltaFHz: 1 / (n * dtSeconds), pointCount: n }
}

/**
 * Display floor for the dB scale — bins at/below zero amplitude clamp here.
 * Real DSO FFTs floor similarly (their ADC noise floor sits far above this).
 */
export const DB_FLOOR = -120

/**
 * A bin amplitude (PEAK, the fftMagnitudes convention) in dB relative to
 * 1 unit RMS — the bench-scope FFT vertical (dBV for volt channels: Tek/Rigol
 * FFT modes display dBVrms by default). 20·log10(A_peak/√2), floored.
 */
export function amplitudeToDbRms(amplitudePeak: number): number {
  if (!(amplitudePeak > 0)) return DB_FLOOR
  const db = 20 * Math.log10(amplitudePeak / Math.SQRT2)
  return db < DB_FLOOR ? DB_FLOOR : db
}

/** The tallest bin — what the FFT panel's peak readout shows. */
export function spectrumPeak(spectrum: Spectrum): { freqHz: number; amplitude: number } | null {
  let best = -1
  let bestAmp = 0
  for (let i = 0; i < spectrum.amplitude.length; i++) {
    const a = spectrum.amplitude[i] ?? 0
    if (a > bestAmp) {
      bestAmp = a
      best = i
    }
  }
  if (best < 0) return null
  return { freqHz: spectrum.freqHz[best] ?? 0, amplitude: bestAmp }
}
