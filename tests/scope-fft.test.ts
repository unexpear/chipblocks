/**
 * FFT tests (S19-v3-81) — the from-scratch radix-2 transform against
 * analytic spectra: a bin-aligned sine reads its exact amplitude at its
 * exact frequency; off-bin tones scallop no more than Hann's known ~15 %;
 * a square wave shows odd harmonics falling as 1/n; the mean never leaks
 * into the spectrum.
 */

import { describe, expect, test } from 'vitest'
import {
  amplitudeToDbRms,
  DB_FLOOR,
  fftMagnitudes,
  spectrumPeak,
} from '../src/renderer/scope-fft.ts'

const sine = (amplitude: number, hz: number, dt: number, n: number, offset = 0) =>
  Array.from({ length: n }, (_, i) => offset + amplitude * Math.sin(2 * Math.PI * hz * i * dt))

describe('amplitudeToDbRms (S20-v3-9): the dB vertical', () => {
  test('the textbook identities: 1 V peak = −3.01 dBV, √2 V peak = 1 V rms = 0 dBV', () => {
    expect(amplitudeToDbRms(1)).toBeCloseTo(-3.0103, 4)
    expect(amplitudeToDbRms(Math.SQRT2)).toBeCloseTo(0, 12)
    expect(amplitudeToDbRms(0.1)).toBeCloseTo(-23.0103, 4)
    // Every ×10 of amplitude is exactly +20 dB.
    expect(amplitudeToDbRms(10) - amplitudeToDbRms(1)).toBeCloseTo(20, 12)
  })

  test('zero and tiny amplitudes clamp to the floor — log of zero never reaches the screen', () => {
    expect(amplitudeToDbRms(0)).toBe(DB_FLOOR)
    expect(amplitudeToDbRms(-1)).toBe(DB_FLOOR)
    expect(amplitudeToDbRms(1e-9)).toBe(DB_FLOOR)
    expect(amplitudeToDbRms(1e-5)).toBeGreaterThan(DB_FLOOR)
  })

  test('a square wave in dB: each odd harmonic sits 20·log10(n) below the fundamental', () => {
    // The 1/n harmonic law reads as −9.54 dB at n=3 and −13.98 dB at n=5 —
    // the picture a log scale exists to show.
    const dt = 1e-6
    const f0 = 8 / (1024 * dt)
    const square = Array.from({ length: 1024 }, (_, i) =>
      Math.sin(2 * Math.PI * f0 * i * dt) >= 0 ? 1 : -1,
    )
    const spectrum = fftMagnitudes(square, dt)
    if (spectrum === null) throw new Error('no spectrum')
    const binAmp = (k: number) => spectrum.amplitude[k - 1] ?? 0
    const fundamentalDb = amplitudeToDbRms(binAmp(8))
    expect(amplitudeToDbRms(binAmp(24)) - fundamentalDb).toBeCloseTo(-20 * Math.log10(3), 1)
    expect(amplitudeToDbRms(binAmp(40)) - fundamentalDb).toBeCloseTo(-20 * Math.log10(5), 1)
  })
})

describe('fftMagnitudes', () => {
  test('a bin-aligned sine peaks at its exact frequency and amplitude', () => {
    // N = 1024, dt = 1/1024 ms → Δf = 1000/1024... pick dt so f0 sits ON bin 8:
    // dt = 1e-6, N = 1024 → Δf = 976.5625 Hz; bin 8 = 7812.5 Hz.
    const dt = 1e-6
    const f0 = 8 / (1024 * dt)
    const spectrum = fftMagnitudes(sine(5, f0, dt, 1024), dt)
    expect(spectrum).not.toBeNull()
    if (spectrum === null) return
    const peak = spectrumPeak(spectrum)
    expect(peak?.freqHz).toBeCloseTo(f0, 6)
    expect(peak?.amplitude).toBeCloseTo(5, 2)
  })

  test('an off-bin sine still lands within one bin, amplitude within Hann scalloping', () => {
    const dt = 1e-6
    const f0 = 8.5 / (1024 * dt) // exactly between two bins — worst case
    const spectrum = fftMagnitudes(sine(5, f0, dt, 1024), dt)
    if (spectrum === null) throw new Error('no spectrum')
    const peak = spectrumPeak(spectrum)
    if (peak === null) throw new Error('no peak')
    expect(Math.abs(peak.freqHz - f0)).toBeLessThanOrEqual(spectrum.deltaFHz)
    expect(peak.amplitude).toBeGreaterThan(0.84 * 5)
    expect(peak.amplitude).toBeLessThanOrEqual(5.01)
  })

  test('a square wave shows odd harmonics falling as 1/n and no even ones', () => {
    const dt = 1e-6
    const f0 = 8 / (2048 * dt)
    const square = Array.from({ length: 2048 }, (_, i) =>
      Math.sin(2 * Math.PI * f0 * i * dt) >= 0 ? 2.5 : -2.5,
    )
    const spectrum = fftMagnitudes(square, dt)
    if (spectrum === null) throw new Error('no spectrum')
    const ampNear = (f: number) => {
      let best = 0
      for (let i = 0; i < spectrum.freqHz.length; i++) {
        if (Math.abs((spectrum.freqHz[i] ?? 0) - f) <= spectrum.deltaFHz) {
          best = Math.max(best, spectrum.amplitude[i] ?? 0)
        }
      }
      return best
    }
    const fundamental = ampNear(f0)
    // Square of amplitude A: fundamental 4A/π, 3rd = fund/3, 5th = fund/5.
    expect(fundamental).toBeCloseTo((4 * 2.5) / Math.PI, 1)
    expect(ampNear(3 * f0)).toBeCloseTo(fundamental / 3, 1)
    expect(ampNear(5 * f0)).toBeCloseTo(fundamental / 5, 1)
    expect(ampNear(2 * f0)).toBeLessThan(0.05 * fundamental)
  })

  test('two tones resolve at their own frequencies and amplitudes', () => {
    const dt = 1e-6
    const f1 = 16 / (1024 * dt)
    const f2 = 80 / (1024 * dt)
    const tone2 = sine(1, f2, dt, 1024)
    const both = sine(5, f1, dt, 1024).map((v, i) => v + (tone2[i] ?? 0))
    const spectrum = fftMagnitudes(both, dt)
    if (spectrum === null) throw new Error('no spectrum')
    const at = (f: number) =>
      spectrum.amplitude[spectrum.freqHz.findIndex((x) => Math.abs(x - f) < 1)] ?? 0
    expect(at(f1)).toBeCloseTo(5, 1)
    expect(at(f2)).toBeCloseTo(1, 1)
  })

  test('a DC offset never leaks into the spectrum (mean removed)', () => {
    const dt = 1e-6
    const f0 = 8 / (1024 * dt)
    const withOffset = fftMagnitudes(sine(5, f0, dt, 1024, 100), dt)
    const without = fftMagnitudes(sine(5, f0, dt, 1024, 0), dt)
    if (withOffset === null || without === null) throw new Error('no spectrum')
    for (let i = 0; i < withOffset.amplitude.length; i++) {
      expect(withOffset.amplitude[i]).toBeCloseTo(without.amplitude[i] ?? 0, 6)
    }
  })

  test('non-power-of-two input keeps the tail; resolution says so', () => {
    const dt = 1e-6
    const spectrum = fftMagnitudes(
      new Array(1500).fill(0).map((_, i) => Math.sin(i)),
      dt,
    )
    if (spectrum === null) throw new Error('no spectrum')
    expect(spectrum.pointCount).toBe(1024)
    expect(spectrum.deltaFHz).toBeCloseTo(1 / (1024 * dt), 9)
  })

  test('too few samples refuses instead of inventing a spectrum', () => {
    expect(fftMagnitudes([1, 2, 3], 1e-6)).toBeNull()
    expect(fftMagnitudes(new Array(100).fill(1), 0)).toBeNull()
  })
})
