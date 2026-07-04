/**
 * The scope's two-channel phase measurement (φ = −360°·Δt/T from hysteresis-gated rising mid-level
 * crossings). Jobs: known synthetic phase shifts read back exactly; the sign convention matches the
 * physics (lagging = negative, like the Bode plot); no fixed phase exists between two different
 * frequencies (null, the honest dash); and — the physics tie — an RC low-pass driven at its corner
 * frequency by the REAL transient solver measures −45°, agreeing with both the analytic
 * −atan(2πfRC) and the frequency-domain AC analysis at the same frequency. Three independent
 * roads, one number.
 */
import { describe, expect, test } from 'vitest'
import { acSweep } from '../src/ac-analysis.ts'
import type { World } from '../src/cross-fk-validator.ts'
import { phaseBetweenDeg, type WaveSample } from '../src/renderer/waveform-measure.ts'
import { solveTransient } from '../src/transient-solver.ts'

const sine = (
  freqHz: number,
  phaseDeg: number,
  cycles = 6,
  perCycle = 200,
  amplitude = 1,
  offset = 0,
): WaveSample[] => {
  const n = cycles * perCycle
  const out: WaveSample[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / (perCycle * freqHz)
    out.push({
      t,
      v: offset + amplitude * Math.sin(2 * Math.PI * freqHz * t + (phaseDeg * Math.PI) / 180),
    })
  }
  return out
}

describe('phaseBetweenDeg on synthesized waveforms', () => {
  test('a 60° lag reads −60°; a 45° lead reads +45° (lagging = negative, the Bode convention)', () => {
    const a = sine(1000, 0)
    expect(phaseBetweenDeg(a, sine(1000, -60))).toBeCloseTo(-60, 1)
    expect(phaseBetweenDeg(a, sine(1000, 45))).toBeCloseTo(45, 1)
  })

  test('in-phase reads ~0° regardless of amplitude or DC offset', () => {
    const a = sine(1000, 0)
    expect(phaseBetweenDeg(a, sine(1000, 0, 6, 200, 10, 3))).toBeCloseTo(0, 1)
  })

  test('opposite polarity reads ±180°', () => {
    const phi = phaseBetweenDeg(sine(1000, 0), sine(1000, 180))
    expect(phi).not.toBeNull()
    expect(Math.abs(phi ?? 0)).toBeCloseTo(180, 1)
  })

  test('two different frequencies have NO phase — null, never a made-up number', () => {
    expect(phaseBetweenDeg(sine(1000, 0), sine(1500, 0))).toBeNull()
  })

  test('one visible B-crossing is not enough — review-caught: a slow signal in a fast window', () => {
    // 5 ms window: five 1 kHz cycles vs 0.15 cycle of a 30 Hz sine (a single rising crossing) —
    // B's period can't be established, so no phase exists to report. The same goes for an
    // aperiodic RC charging curve crossing its mean once.
    const a = sine(1000, 0, 5, 200)
    const slow: WaveSample[] = a.map((s) => ({ t: s.t, v: Math.sin(2 * Math.PI * 30 * s.t) }))
    expect(phaseBetweenDeg(a, slow)).toBeNull()
    const charge: WaveSample[] = a.map((s) => ({ t: s.t, v: 5 * (1 - Math.exp(-s.t / 1e-3)) }))
    expect(phaseBetweenDeg(a, charge)).toBeNull()
  })

  test('a microampere current channel has a real phase — the gate is scale-free, not volt-blind', () => {
    // A 0.5 mA sine lagging 90° — far below the meter's 1 mV floor, but a perfectly clean cycle.
    const v = sine(1000, 0)
    const smallCurrent = sine(1000, -90, 6, 200, 0.0005)
    expect(phaseBetweenDeg(v, smallCurrent)).toBeCloseTo(-90, 1)
  })

  test('a flat line has no phase', () => {
    const flat: WaveSample[] = sine(1000, 0).map((s) => ({ t: s.t, v: 2.5 }))
    expect(phaseBetweenDeg(sine(1000, 0), flat)).toBeNull()
    expect(phaseBetweenDeg(flat, sine(1000, 0))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The physics: an RC low-pass at its corner frequency lags by exactly 45°.
// ---------------------------------------------------------------------------

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

/** V_s(t) = amplitude·sin(2πft) — R — (cap net) — C — ground: the canonical RC low-pass. */
function rcLowPass(R: number, C: number, amplitude: number, frequency: number): World {
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
      { instance: 'bat', terminal: 'terminal_positive' },
      { instance: 'r1', terminal: 'terminal_a' },
    ],
  })
  world.nets.set('cap', {
    id: 'cap',
    kind: 'net',
    members: [
      { instance: 'r1', terminal: 'terminal_b' },
      { instance: 'c1', terminal: 'terminal_a' },
    ],
  })
  world.nets.set('gnd', {
    id: 'gnd',
    kind: 'net',
    type: 'ground',
    members: [
      { instance: 'bat', terminal: 'terminal_negative' },
      { instance: 'c1', terminal: 'terminal_b' },
    ],
  })
  world.instances.set('bat', {
    id: 'bat',
    kind_ref: 'primitive_device',
    definition: 'power_source',
    parameters: {
      nominal_voltage: scalar(0, 'volt'),
      ac_amplitude: scalar(amplitude, 'volt'),
      frequency: scalar(frequency, 'hertz'),
    },
    connects: [
      { net: 'vs', terminal: 'terminal_positive', of: 'bat' },
      { net: 'gnd', terminal: 'terminal_negative', of: 'bat' },
    ],
  })
  world.instances.set('r1', {
    id: 'r1',
    kind_ref: 'primitive_device',
    definition: 'resistor',
    parameters: { resistance: scalar(R, 'ohm') },
    connects: [
      { net: 'vs', terminal: 'terminal_a', of: 'r1' },
      { net: 'cap', terminal: 'terminal_b', of: 'r1' },
    ],
  })
  world.instances.set('c1', {
    id: 'c1',
    kind_ref: 'primitive_device',
    definition: 'capacitor',
    parameters: { capacitance: scalar(C, 'farad') },
    connects: [
      { net: 'cap', terminal: 'terminal_a', of: 'c1' },
      { net: 'gnd', terminal: 'terminal_b', of: 'c1' },
    ],
  })
  return world
}

describe('RC low-pass phase — three independent roads to one number', () => {
  const R = 1000
  const C = 1e-6
  const fCorner = 1 / (2 * Math.PI * R * C) // ≈ 159.15 Hz, where φ = −45° exactly
  const period = 1 / fCorner

  test('the scope-measured phase of a REAL transient run ≈ −45° ≈ the analytic −atan(2πfRC)', () => {
    // Fine steps keep the backward-Euler phase error small; the analysis window skips the
    // start-up transient (≈8 time constants) so only the settled sine is measured.
    const dt = period / 2000
    const result = solveTransient(rcLowPass(R, C, 1, fCorner), {
      timeStep: dt,
      duration: 10 * period,
    })
    expect(result.status).toBe('solved')
    const settled = result.series.filter((p) => p.time >= 2 * period)
    const input: WaveSample[] = settled.map((p) => ({ t: p.time, v: p.nodes.get('vs') ?? 0 }))
    const output: WaveSample[] = settled.map((p) => ({ t: p.time, v: p.nodes.get('cap') ?? 0 }))
    const measured = phaseBetweenDeg(input, output)
    expect(measured).not.toBeNull()
    const analytic = (-Math.atan(2 * Math.PI * fCorner * R * C) * 180) / Math.PI // −45°
    expect(measured).toBeCloseTo(analytic, 0)
    expect(measured ?? 0).toBeLessThan(0) // the output LAGS — negative by our (and Bode's) convention

    // The frequency-domain road: the AC small-signal analysis at the same frequency
    // must land on the same phase — the scope and the Bode plot can never disagree.
    const sweep = acSweep(rcLowPass(R, C, 1, fCorner), {
      inputSource: 'bat',
      outputNet: 'cap',
      fStartHz: fCorner,
      fStopHz: fCorner * 1.0001,
      pointsPerDecade: 1,
    })
    const acPhase = sweep[0]?.phaseDeg
    expect(acPhase).toBeDefined()
    expect(measured).toBeCloseTo(acPhase ?? 0, 0)
  })
})
