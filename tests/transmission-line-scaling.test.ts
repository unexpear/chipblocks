/**
 * Time-scale invariance — the trick for beating the timebase limit, checked honestly.
 *
 * A lossless line's behaviour depends only on RATIOS (the delay τ vs the signal's
 * timescale, Z0 vs the load), not on the absolute speed. So a circuit too FAST to resolve
 * at a comfortable timebase can be SLOWED DOWN by a factor k — scale the line length so
 * τ → kτ (and any reactances by k; resistances stay put) — solved in comfort, then read
 * back by relabelling the time axis ÷k. It is an EXACT similarity transform, not an
 * approximation: backward-Euler's discrete equations are unchanged (G_eq = C/Δt is the
 * same when both scale by k; the line history lands on the same fractional indices), so
 * the fast and slow solves match SAMPLE-FOR-SAMPLE.
 *
 * No solver edits — this just proves the property is already there: a 1 ns line and a 1 µs
 * line (k = 1000), each solved with the same number of steps over a proportional window,
 * produce the SAME waveform. The 1 ns line is far too fast for the scope's microsecond
 * timebase; the 1 µs line is not — so this IS the workaround, validated.
 */

import { describe, expect, test } from 'vitest'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { solveTransient } from '../src/transient-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const g = (s: string, sh: string, t: string, th: string) => ({
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
})

// 10 V source (R_src = 30 Ω, so the far end reflects and rings) → 300 Ω line of the given
// length → 900 Ω load. Returns the world + the far-end nets so we can read the load voltage.
function lineCircuit(lengthM: number) {
  const nodes: CanvasNode[] = [
    {
      id: 'src',
      definition: 'power_source',
      parameters: { nominal_voltage: scalar(10, 'volt'), internal_resistance: scalar(30, 'ohm') },
    },
    {
      id: 'line',
      definition: 'transmission_line',
      parameters: {
        characteristic_impedance: scalar(300, 'ohm'),
        length: scalar(lengthM, 'meter'),
        velocity_factor: scalar(1, 'dimensionless'),
      },
    },
    { id: 'load', definition: 'resistor', parameters: { resistance: scalar(900, 'ohm') } },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    g('src', 'terminal_positive', 'line', 'near_a'),
    g('line', 'near_b', 'src', 'terminal_negative'),
    g('line', 'far_a', 'load', 'terminal_a'),
    g('load', 'terminal_b', 'line', 'far_b'),
    g('gnd', 'reference_terminal', 'src', 'terminal_negative'),
  ]
  const world = canvasToWorld(nodes, edges)
  const line = world.instances.get('line')
  const net = (terminal: string) => line?.connects?.find((c) => c.terminal === terminal)?.net ?? ''
  return { world, farA: net('far_a'), farB: net('far_b') }
}

const STEPS = 400

function farWaveform(lengthM: number, windowS: number): number[] {
  const { world, farA, farB } = lineCircuit(lengthM)
  const result = solveTransient(world, { timeStep: windowS / STEPS, duration: windowS })
  expect(result.status).toBe('solved')
  return result.series.map((p) => (p.nodes.get(farA) ?? 0) - (p.nodes.get(farB) ?? 0))
}

describe('transmission line — time-scale invariance (the timebase workaround)', () => {
  test('a 1 ns line and a 1 µs line give the SAME waveform, sample for sample', () => {
    // FAST: 0.3 m → τ ≈ 1 ns, watched over an 8 ns window (Δt = 20 ps). Far too fast for the
    //       scope's 1 µs/div minimum — you could never resolve this directly on the bench.
    const fast = farWaveform(0.3, 8e-9)
    // SLOW: 300 m → τ ≈ 1 µs (k = 1000), watched over an 8 µs window (Δt = 20 ns). Comfortable
    //       on the scope. Relabel its time axis ÷1000 and it IS the 1 ns answer.
    const slow = farWaveform(300, 8e-6)

    expect(fast.length).toBe(slow.length)
    // the waveform actually has structure (rings from ~0 up past several volts) — not a
    // vacuous match of two flat lines
    expect(Math.max(...fast)).toBeGreaterThan(5)
    expect(Math.min(...fast.slice(0, STEPS / 8))).toBeLessThan(0.5) // dark before the wave lands

    // and the two are the SAME curve to numerical precision (an exact similarity transform)
    let maxDiff = 0
    for (let i = 0; i < fast.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs((fast[i] ?? 0) - (slow[i] ?? 0)))
    }
    expect(maxDiff).toBeLessThan(1e-6) // millionths of a volt on a 10 V swing
  })

  test('it holds for a second, unrelated scale factor (k = 1e6)', () => {
    // 0.3 m (τ ≈ 1 ns) vs 300 km (τ ≈ 1 ms) — a million-fold stretch, same curve.
    const fast = farWaveform(0.3, 8e-9)
    const slow = farWaveform(300_000, 8e-3)
    let maxDiff = 0
    for (let i = 0; i < fast.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs((fast[i] ?? 0) - (slow[i] ?? 0)))
    }
    expect(maxDiff).toBeLessThan(1e-6)
  })
})
