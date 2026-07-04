/**
 * The function-generator waveforms (sine / square / triangle / sawtooth / staircase) through the
 * REAL transient solver. Jobs: the triangle's ramps hit the exact sine-phased corner values (0 at
 * t = 0 rising, +A at T/4, −A at 3T/4, linear in between); every periodic shape averages back to
 * its DC offset; and the physics differentiator — a square's FFT falls as 1/n (3rd harmonic at 1/3)
 * while a triangle's falls as 1/n² (3rd at 1/9), which is WHY a square sounds buzzy and a triangle
 * mellow. The spectrum comes from the scope's own FFT, so the shapes and the instrument agree.
 */
import { describe, expect, test } from 'vitest'
import type { World } from '../src/cross-fk-validator.ts'
import { fftMagnitudes } from '../src/renderer/scope-fft.ts'
import { phaseBetweenDeg, type WaveSample } from '../src/renderer/waveform-measure.ts'
import { solveTransient } from '../src/transient-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

/** Source (0 Ω internal) driving a plain 1 kΩ load — the 'vs' net IS the waveform, exactly. */
function generator(waveform: string, amplitude: number, frequency: number, offset = 0): World {
  const world: World = {
    definitions: new Map(),
    instances: new Map(),
    behaviors: new Map(),
    activeVariables: new Map(),
    nets: new Map(),
  }
  world.nets.set('vs', {
    id: 'vs',
    kind: 'net',
    members: [
      { instance: 'gen', terminal: 'terminal_positive' },
      { instance: 'r1', terminal: 'terminal_a' },
    ],
  })
  world.nets.set('gnd', {
    id: 'gnd',
    kind: 'net',
    type: 'ground',
    members: [
      { instance: 'gen', terminal: 'terminal_negative' },
      { instance: 'r1', terminal: 'terminal_b' },
    ],
  })
  world.instances.set('gen', {
    id: 'gen',
    kind_ref: 'primitive_device',
    definition: 'power_source',
    parameters: {
      nominal_voltage: scalar(offset, 'volt'),
      ac_amplitude: scalar(amplitude, 'volt'),
      frequency: scalar(frequency, 'hertz'),
      internal_resistance: scalar(0, 'ohm'),
      waveform: { value: waveform },
    },
    connects: [
      { net: 'vs', terminal: 'terminal_positive', of: 'gen' },
      { net: 'gnd', terminal: 'terminal_negative', of: 'gen' },
    ],
  })
  world.instances.set('r1', {
    id: 'r1',
    kind_ref: 'primitive_device',
    definition: 'resistor',
    parameters: { resistance: scalar(1000, 'ohm') },
    connects: [
      { net: 'vs', terminal: 'terminal_a', of: 'r1' },
      { net: 'gnd', terminal: 'terminal_b', of: 'r1' },
    ],
  })
  return world
}

const f = 1000
const T = 1 / f

/** The 'vs' voltage nearest time t. */
function vAt(series: { time: number; nodes: Map<string, number> }[], t: number): number {
  const pt = series.reduce((best, p) => (Math.abs(p.time - t) < Math.abs(best.time - t) ? p : best))
  return pt.nodes.get('vs') ?? Number.NaN
}

describe('the triangle wave through the real solver', () => {
  test('sine-phased corners: 0 at t=0 rising, +A at T/4, 0 at T/2, −A at 3T/4 — and dead linear', () => {
    const res = solveTransient(generator('triangle', 2, f), { timeStep: T / 400, duration: 2 * T })
    expect(res.status).toBe('solved')
    expect(vAt(res.series, 0)).toBeCloseTo(0, 9)
    expect(vAt(res.series, T / 8)).toBeCloseTo(1, 6) // halfway up the ramp — LINEAR, not sinusoidal
    expect(vAt(res.series, T / 4)).toBeCloseTo(2, 6)
    expect(vAt(res.series, T / 2)).toBeCloseTo(0, 6)
    expect(vAt(res.series, (3 * T) / 4)).toBeCloseTo(-2, 6)
    expect(vAt(res.series, T)).toBeCloseTo(0, 6)
  })

  test('rides its DC offset like every other shape', () => {
    const res = solveTransient(generator('triangle', 1, f, 2.5), {
      timeStep: T / 200,
      duration: T,
    })
    const values = res.series.map((p) => p.nodes.get('vs') ?? 0)
    expect(Math.max(...values)).toBeCloseTo(3.5, 5)
    expect(Math.min(...values)).toBeCloseTo(1.5, 5)
  })
})

describe('every periodic shape averages back to its offset over whole periods', () => {
  for (const shape of ['sine', 'square', 'triangle', 'sawtooth'] as const) {
    test(shape, () => {
      const res = solveTransient(generator(shape, 3, f, 1), { timeStep: T / 500, duration: 4 * T })
      expect(res.status).toBe('solved')
      // drop the duplicated end sample so exactly 4 whole periods are averaged; the tolerance is
      // the sampling bias of a discretized ramp (~A/samples-per-period), not solver error
      const values = res.series.slice(0, -1).map((p) => p.nodes.get('vs') ?? 0)
      const mean = values.reduce((s, v) => s + v, 0) / values.length
      expect(mean).toBeCloseTo(1, 1)
    })
  }
})

describe('the harmonic fingerprint — the scope FFT tells the shapes apart', () => {
  /** Amplitude of the strongest bin within ±3 bins of the target frequency. */
  const peakNear = (spec: NonNullable<ReturnType<typeof fftMagnitudes>>, target: number) => {
    let best = 0
    for (let i = 0; i < spec.freqHz.length; i++) {
      const fr = spec.freqHz[i] ?? 0
      if (Math.abs(fr - target) <= 3 * spec.deltaFHz) best = Math.max(best, spec.amplitude[i] ?? 0)
    }
    return best
  }

  test('square: odd harmonics falling as 1/n (3rd ≈ 1/3, even harmonics absent)', () => {
    const dt = T / 128
    const res = solveTransient(generator('square', 1, f), { timeStep: dt, duration: 32 * T })
    const spec = fftMagnitudes(
      res.series.map((p) => p.nodes.get('vs') ?? 0),
      dt,
    )
    expect(spec).not.toBeNull()
    if (spec === null) throw new Error('no spectrum')
    const fundamental = peakNear(spec, f)
    expect(peakNear(spec, 3 * f) / fundamental).toBeCloseTo(1 / 3, 1)
    expect(peakNear(spec, 2 * f) / fundamental).toBeLessThan(0.05)
  })

  test('triangle: odd harmonics falling as 1/n² (3rd ≈ 1/9 — why it sounds mellow, not buzzy)', () => {
    const dt = T / 128
    const res = solveTransient(generator('triangle', 1, f), { timeStep: dt, duration: 32 * T })
    const spec = fftMagnitudes(
      res.series.map((p) => p.nodes.get('vs') ?? 0),
      dt,
    )
    expect(spec).not.toBeNull()
    if (spec === null) throw new Error('no spectrum')
    const fundamental = peakNear(spec, f)
    expect(peakNear(spec, 3 * f) / fundamental).toBeCloseTo(1 / 9, 1)
    expect(peakNear(spec, 2 * f) / fundamental).toBeLessThan(0.05)
  })
})

describe('the phase measurement reads non-sine shapes too', () => {
  test('two squares a quarter period apart read −90°', () => {
    const mk = (shift: number): WaveSample[] => {
      const out: WaveSample[] = []
      for (let i = 0; i <= 1200; i++) {
        const t = (i / 200) * T
        out.push({ t, v: Math.sin(2 * Math.PI * f * (t - shift)) >= 0 ? 1 : -1 })
      }
      return out
    }
    // a square's instant edge lands within one sample (200/cycle → 1.8° of quantization)
    const phi = phaseBetweenDeg(mk(0), mk(T / 4))
    expect(phi).not.toBeNull()
    expect(Math.abs((phi ?? 0) + 90)).toBeLessThan(2)
  })
})
