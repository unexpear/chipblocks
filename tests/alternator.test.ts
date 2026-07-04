/**
 * The alternator — the rotating-magnet machine behind every outlet, single- and three-phase.
 * The video-classic claims, proven in the real transient solver: the output frequency is
 * f = poles·RPM/120 (a 4-pole machine at 1800 RPM makes America's 60 Hz exactly); spinning
 * faster raises BOTH the frequency and the voltage (the real machine's signature — an ideal AC
 * source can't do that); the three phases sit exactly 120° apart (read back with the scope's own
 * phase measurement); a balanced wye load returns ZERO neutral current while every phase carries
 * real amps; an unbalanced load's difference flows on the neutral; and reversing the shaft flips
 * the PHASE SEQUENCE — b and c swap order in time — while a lone coil's sine looks unchanged.
 */
import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import {
  measureSeries,
  phaseBetweenDeg,
  type WaveSample,
} from '../src/renderer/waveform-measure.ts'
import { solveTransient } from '../src/transient-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

const g = (s: string, sh: string, t: string, th: string) => ({
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
})

// The shipped 4-pole bench machine: k 0.05 V·s/rad, 2 pole pairs, 1 Ω per winding.
const altParams = (rpm: number) => ({
  flux_linkage: scalar(0.05, 'V*s/rad'),
  winding_resistance: scalar(1, 'ohm'),
  pole_pairs: scalar(2, 'dimensionless'),
  drive_speed: scalar(rpm, 'rpm'),
  viscous_friction: scalar(1e-5, 'N*m*s/rad'),
})

describe('single-phase alternator', () => {
  const run = (rpm: number) => {
    const nodes: CanvasNode[] = [
      { id: 'alt1', definition: 'alternator', parameters: altParams(rpm) },
      { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(100, 'ohm') } },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      g('alt1', 'terminal_positive', 'r1', 'terminal_a'),
      g('r1', 'terminal_b', 'alt1', 'terminal_negative'),
      g('alt1', 'terminal_negative', 'gnd', 'reference_terminal'),
    ]
    const world = canvasToWorld(nodes, edges)
    const f = (2 * Math.abs(rpm)) / 60 // pole_pairs · rpm / 60
    const period = 1 / f
    const result = solveTransient(world, { timeStep: period / 500, duration: 4 * period })
    expect(result.status).toBe('solved')
    const vTop =
      world.instances.get('r1')?.connects?.find((c) => c.terminal === 'terminal_a')?.net ?? ''
    const samples: WaveSample[] = result.series.map((p) => ({
      t: p.time,
      v: p.nodes.get(vTop) ?? 0,
    }))
    return measureSeries(samples)
  }

  test('f = poles·RPM/120 — the 4-pole machine at 1800 RPM makes exactly 60 Hz', () => {
    const m = run(1800)
    expect(m.hz).not.toBeNull()
    expect(m.hz ?? 0).toBeCloseTo(60, 0)
    // EMF peak = k·ω_e = 0.05 · (2·1800·2π/60) = 18.85 V; the 100 Ω load sees 100/101 of it
    expect(m.vmax).toBeCloseTo(18.85 * (100 / 101), 1)
  })

  test('spin it twice as fast: BOTH the frequency and the voltage double', () => {
    const slow = run(1800)
    const fast = run(3600)
    expect(fast.hz ?? 0).toBeCloseTo(2 * (slow.hz ?? 0), 0)
    expect(fast.vmax / slow.vmax).toBeCloseTo(2, 1)
  })

  test('at DC the EMF averages away — the winding is just its resistance', () => {
    const nodes: CanvasNode[] = [
      { id: 'alt1', definition: 'alternator', parameters: altParams(1800) },
      { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(100, 'ohm') } },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      g('alt1', 'terminal_positive', 'r1', 'terminal_a'),
      g('r1', 'terminal_b', 'alt1', 'terminal_negative'),
      g('alt1', 'terminal_negative', 'gnd', 'reference_terminal'),
    ]
    const world = canvasToWorld(nodes, edges)
    const sol = solveDC(world)
    expect(sol.status).toBe('solved')
    const vTop =
      world.instances.get('r1')?.connects?.find((c) => c.terminal === 'terminal_a')?.net ?? ''
    expect(Math.abs(sol.nodes.get(vTop) ?? 1)).toBeLessThan(1e-9)
  })
})

describe('three-phase alternator — the power-station machine', () => {
  /** Wye: each phase into its own load resistor to ground; the neutral also to ground. */
  const runWye = (rpm: number, loads: [number, number, number]) => {
    const nodes: CanvasNode[] = [
      { id: 'alt3', definition: 'alternator_three_phase', parameters: altParams(rpm) },
      { id: 'ra', definition: 'resistor', parameters: { resistance: scalar(loads[0], 'ohm') } },
      { id: 'rb', definition: 'resistor', parameters: { resistance: scalar(loads[1], 'ohm') } },
      { id: 'rc', definition: 'resistor', parameters: { resistance: scalar(loads[2], 'ohm') } },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      g('alt3', 'phase_a', 'ra', 'terminal_a'),
      g('alt3', 'phase_b', 'rb', 'terminal_a'),
      g('alt3', 'phase_c', 'rc', 'terminal_a'),
      g('ra', 'terminal_b', 'gnd', 'reference_terminal'),
      g('rb', 'terminal_b', 'gnd', 'reference_terminal'),
      g('rc', 'terminal_b', 'gnd', 'reference_terminal'),
      g('alt3', 'neutral', 'gnd', 'reference_terminal'),
    ]
    const world = canvasToWorld(nodes, edges)
    const f = (2 * Math.abs(rpm)) / 60
    const period = 1 / f
    const result = solveTransient(world, { timeStep: period / 500, duration: 4 * period })
    expect(result.status).toBe('solved')
    const netOf = (part: string) =>
      world.instances.get(part)?.connects?.find((c) => c.terminal === 'terminal_a')?.net ?? ''
    const wave = (net: string): WaveSample[] =>
      result.series.map((p) => ({ t: p.time, v: p.nodes.get(net) ?? 0 }))
    return {
      result,
      a: wave(netOf('ra')),
      b: wave(netOf('rb')),
      c: wave(netOf('rc')),
    }
  }

  test('the three phases sit EXACTLY 120° apart — read with the scope’s own phase math', () => {
    const { a, b, c } = runWye(1800, [100, 100, 100])
    expect(phaseBetweenDeg(a, b)).toBeCloseTo(-120, 0) // B lags A by a third of a period
    expect(phaseBetweenDeg(a, c)).toBeCloseTo(120, 0) // C leads A by a third
    expect(Math.abs(phaseBetweenDeg(b, c) ?? 0)).toBeCloseTo(120, 0)
  })

  test('a balanced wye load returns ZERO on the neutral while every phase carries real amps', () => {
    const { result } = runWye(1800, [100, 100, 100])
    let worstNeutral = 0
    let peakPhase = 0
    for (const p of result.series) {
      worstNeutral = Math.max(worstNeutral, Math.abs(p.currents?.get('alt3/neutral') ?? 0))
      peakPhase = Math.max(peakPhase, Math.abs(p.currents?.get('alt3/phase_a') ?? 0))
    }
    expect(peakPhase).toBeGreaterThan(0.15) // ~18.85 V / 101 Ω ≈ 0.187 A peak per phase
    expect(worstNeutral).toBeLessThan(0.01 * peakPhase) // the balanced sum cancels
  })

  test('unbalance one phase and the neutral carries exactly the difference', () => {
    const { result } = runWye(1800, [50, 100, 100])
    let worstNeutral = 0
    let worstKcl = 0
    for (const p of result.series) {
      const iN = p.currents?.get('alt3/neutral') ?? 0
      const iA = p.currents?.get('alt3/phase_a') ?? 0
      const iB = p.currents?.get('alt3/phase_b') ?? 0
      const iC = p.currents?.get('alt3/phase_c') ?? 0
      worstNeutral = Math.max(worstNeutral, Math.abs(iN))
      worstKcl = Math.max(worstKcl, Math.abs(iA + iB + iC + iN)) // all four sum to zero inside
    }
    expect(worstNeutral).toBeGreaterThan(0.05) // a real imbalance current flows home
    expect(worstKcl).toBeLessThan(1e-9) // and the machine's own KCL closes exactly
  })

  test('one fully wired coil is a legitimate single-phase tap — it generates while the others idle', () => {
    // Review-caught: the transient used to drop the WHOLE machine when any lead dangled, while
    // the DC solve stamped the wired coils — the two engines disagreed. Now both solve per coil.
    const nodes: CanvasNode[] = [
      { id: 'alt3', definition: 'alternator_three_phase', parameters: altParams(1800) },
      { id: 'ra', definition: 'resistor', parameters: { resistance: scalar(1000, 'ohm') } },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      g('alt3', 'phase_a', 'ra', 'terminal_a'),
      g('ra', 'terminal_b', 'gnd', 'reference_terminal'),
      g('alt3', 'neutral', 'gnd', 'reference_terminal'),
    ]
    const world = canvasToWorld(nodes, edges)
    const result = solveTransient(world, { timeStep: 1e-4, duration: 0.05 })
    expect(result.status).toBe('solved')
    const net =
      world.instances.get('ra')?.connects?.find((c) => c.terminal === 'terminal_a')?.net ?? ''
    let peak = 0
    for (const p of result.series) peak = Math.max(peak, Math.abs(p.nodes.get(net) ?? 0))
    expect(peak).toBeCloseTo(18.85 * (1000 / 1001), 0) // coil A delivers its full sine
    // the dangling coils are named honestly, not silently dropped
    expect(result.warnings.some((w) => w.includes('phase_b') && w.includes('idle'))).toBe(true)
    expect(result.warnings.some((w) => w.includes('phase_c') && w.includes('idle'))).toBe(true)
  })

  test('an unwired neutral is refused with the REAL reason, not a parameter list', () => {
    const nodes: CanvasNode[] = [
      { id: 'alt3', definition: 'alternator_three_phase', parameters: altParams(1800) },
      { id: 'ra', definition: 'resistor', parameters: { resistance: scalar(1000, 'ohm') } },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      g('alt3', 'phase_a', 'ra', 'terminal_a'),
      g('ra', 'terminal_b', 'alt3', 'phase_b'),
      g('alt3', 'phase_b', 'gnd', 'reference_terminal'),
    ]
    const result = solveTransient(canvasToWorld(nodes, edges), { timeStep: 1e-4, duration: 0.01 })
    expect(result.warnings.some((w) => w.includes('neutral') && w.includes('star point'))).toBe(
      true,
    )
  })

  test('the DC solve records the winding current — the KCL books close at its nets', () => {
    // Review-caught: the alternator conducted DC through its winding but recorded no branch
    // current, so the Math panel's per-net KCL re-sum showed a false "NOT balanced".
    const nodes: CanvasNode[] = [
      {
        id: 'bat',
        definition: 'power_source',
        parameters: {
          nominal_voltage: scalar(12, 'volt'),
          internal_resistance: scalar(0.1, 'ohm'),
        },
      },
      { id: 'alt1', definition: 'alternator', parameters: altParams(1800) },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      g('bat', 'terminal_positive', 'alt1', 'terminal_positive'),
      g('alt1', 'terminal_negative', 'bat', 'terminal_negative'),
      g('bat', 'terminal_negative', 'gnd', 'reference_terminal'),
    ]
    const sol = solveDC(canvasToWorld(nodes, edges))
    expect(sol.status).toBe('solved')
    expect(sol.branches.get('alt1')).toBeCloseTo(12 / 1.1, 4) // Ohm's law through the winding
  })

  test('reverse the shaft and the SEQUENCE flips: B leads instead of lags (a lone sine cannot tell)', () => {
    const fwd = runWye(1800, [100, 100, 100])
    const rev = runWye(-1800, [100, 100, 100])
    expect(phaseBetweenDeg(fwd.a, fwd.b)).toBeCloseTo(-120, 0)
    expect(phaseBetweenDeg(rev.a, rev.b)).toBeCloseTo(120, 0) // b now LEADS — acb order
    // the lone waveform itself is indistinguishable: same frequency, same size
    const mFwd = measureSeries(fwd.a)
    const mRev = measureSeries(rev.a)
    expect(mRev.hz ?? 0).toBeCloseTo(mFwd.hz ?? 1, 0)
    expect(mRev.vpp).toBeCloseTo(mFwd.vpp, 3)
  })
})
