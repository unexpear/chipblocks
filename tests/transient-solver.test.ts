/**
 * Transient solver tests (S19-v3-42; AC S19-v3-43; diodes S19-v3-44) — the
 * backward-Euler time-domain solver with a Newton-Raphson inner loop per step.
 * Canonical checks: a capacitor charges on the real exponential V_C(t) =
 * V_s·(1 − e^(−t/RC)); a time-varying source drives a real sine; an R-C low-pass
 * filter attenuates high-frequency AC; and a diode half-wave rectifier turns AC
 * into DC (the nonlinear device working inside the time loop).
 */

import { describe, expect, test } from 'vitest'
import type { World } from '../src/cross-fk-validator.ts'
import { solveDC } from '../src/dc-solver.ts'
import { solveTransient } from '../src/transient-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

/**
 * V_s — R — (cap node) — C — ground. The capacitor starts uncharged. Pass `ac` to
 * make the source V(t) = Vs + amplitude·sin(2π·frequency·t).
 */
function rcCharging(
  R: number,
  C: number,
  Vs: number,
  ac?: { amplitude: number; frequency: number },
): World {
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
      nominal_voltage: scalar(Vs, 'volt'),
      ...(ac
        ? { ac_amplitude: scalar(ac.amplitude, 'volt'), frequency: scalar(ac.frequency, 'hertz') }
        : {}),
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

const R = 1000 // 1 kΩ
const C = 1e-6 // 1 µF  →  RC = 1 ms
const Vs = 5
const RC = R * C

/** Voltage of a net at the series point nearest time t. */
function vNodeAt(
  series: { time: number; nodes: Map<string, number> }[],
  net: string,
  t: number,
): number {
  const pt = series.reduce((best, p) => (Math.abs(p.time - t) < Math.abs(best.time - t) ? p : best))
  return pt.nodes.get(net) ?? Number.NaN
}

describe('solveTransient — R-C charging (backward-Euler)', () => {
  test('charges on the RC exponential: 0 → ~63% at t=RC → ~Vs by 5 RC', () => {
    const dt = RC / 200
    const res = solveTransient(rcCharging(R, C, Vs), { timeStep: dt, duration: 5 * RC })
    expect(res.status).toBe('solved')

    expect(vNodeAt(res.series, 'cap', 0)).toBeCloseTo(0, 6) // starts uncharged
    expect(vNodeAt(res.series, 'cap', RC)).toBeCloseTo(0.6321 * Vs, 1) // 1 − 1/e ≈ 63.2%
    expect(vNodeAt(res.series, 'cap', 5 * RC)).toBeGreaterThan(0.99 * Vs) // ~99.3% after 5 τ
    expect(vNodeAt(res.series, 'cap', 5 * RC)).toBeLessThan(Vs) // never overshoots the source
  })

  test('monotonic and bounded — backward-Euler is stable (no overshoot/ringing)', () => {
    const res = solveTransient(rcCharging(R, C, Vs), { timeStep: RC / 100, duration: 3 * RC })
    let prev = -1
    for (const pt of res.series) {
      const v = pt.nodes.get('cap') ?? Number.NaN
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9) // non-decreasing
      expect(v).toBeLessThanOrEqual(Vs + 1e-9) // bounded by the source
      prev = v
    }
  })

  test('first backward-Euler step matches the closed form Vs·dt/(RC+dt)', () => {
    const dt = RC / 50
    const res = solveTransient(rcCharging(R, C, Vs), { timeStep: dt, duration: dt })
    const v1 = res.series[1]?.nodes.get('cap') ?? Number.NaN
    expect(v1).toBeCloseTo((Vs * dt) / (RC + dt), 9)
  })

  test('a bigger capacitor charges slower (longer time constant)', () => {
    const small = solveTransient(rcCharging(R, C, Vs), { timeStep: RC / 100, duration: RC })
    const big = solveTransient(rcCharging(R, 4 * C, Vs), { timeStep: RC / 100, duration: RC })
    // After the same wall-clock time, the 4× capacitor (4× τ) is far less charged.
    expect(vNodeAt(big.series, 'cap', RC)).toBeLessThan(vNodeAt(small.series, 'cap', RC))
  })

  test('bad options and missing ground are reported, not solved', () => {
    expect(solveTransient(rcCharging(R, C, Vs), { timeStep: 0, duration: 1 }).status).toBe(
      'bad-options',
    )
    expect(solveTransient(rcCharging(R, C, Vs), { timeStep: 1, duration: 0.5 }).status).toBe(
      'bad-options',
    )
    const noGround: World = {
      definitions: new Map(),
      instances: new Map(),
      behaviors: new Map(),
      activeVariables: new Map(),
      nets: new Map([['a', { id: 'a', kind: 'net', members: [] }]]),
    }
    expect(solveTransient(noGround, { timeStep: 1e-4, duration: 1e-3 }).status).toBe('no-ground')
  })
})

describe('solveTransient — AC (time-varying source)', () => {
  test('an AC source drives a real sine wave: 0 → +A → 0 → −A over one period', () => {
    const f = 1000
    const A = 5
    const T = 1 / f
    const res = solveTransient(rcCharging(R, C, 0, { amplitude: A, frequency: f }), {
      timeStep: T / 200,
      duration: T,
    })
    expect(res.status).toBe('solved')
    // The (ideal) source node 'vs' is exactly V(t) = A·sin(2π f t).
    expect(vNodeAt(res.series, 'vs', 0)).toBeCloseTo(0, 3)
    expect(vNodeAt(res.series, 'vs', T / 4)).toBeCloseTo(A, 1) // peak
    expect(vNodeAt(res.series, 'vs', T / 2)).toBeCloseTo(0, 1)
    expect(vNodeAt(res.series, 'vs', (3 * T) / 4)).toBeCloseTo(-A, 1) // trough
  })

  test('the R-C is a low-pass filter — high-frequency AC is attenuated, low passes', () => {
    const A = 5
    // Steady-state peak-to-peak swing of the capacitor (output) node at a given drive
    // frequency: settle the startup transient (5 τ), then measure one full period.
    const outputSwing = (freq: number): number => {
      const T = 1 / freq
      const dt = Math.min(T, RC) / 40
      const duration = 5 * RC + T
      const res = solveTransient(rcCharging(R, C, 0, { amplitude: A, frequency: freq }), {
        timeStep: dt,
        duration,
      })
      const tail = res.series.filter((p) => p.time >= duration - T)
      const v = tail.map((p) => p.nodes.get('cap') ?? 0)
      return Math.max(...v) - Math.min(...v)
    }

    const lowF = 0.3 / (2 * Math.PI * RC) // ωRC = 0.3 → |H| ≈ 0.96, passes
    const highF = 10 / (2 * Math.PI * RC) // ωRC = 10 → |H| ≈ 0.10, blocked
    const inputSwing = 2 * A

    const lowSwing = outputSwing(lowF)
    const highSwing = outputSwing(highF)

    expect(lowSwing).toBeGreaterThan(0.8 * inputSwing) // low frequency passes through
    expect(highSwing).toBeLessThan(0.3 * inputSwing) // high frequency is filtered out
    expect(highSwing).toBeLessThan(lowSwing) // higher frequency → more attenuation
  })
})

/**
 * Half-wave rectifier: AC source — diode — load resistor — ground, with an
 * optional smoothing capacitor across the load. THE canonical AC→DC circuit.
 * Diode: silicon rectifier calibrated 0.7 V @ 1 A (the device-diode-silicon-
 * rectifier fixture's class).
 */
function halfWaveRectifier(opts: {
  amplitude: number
  frequency: number
  loadOhms: number
  smoothingFarads?: number
}): World {
  const world: World = {
    definitions: new Map(),
    instances: new Map(),
    behaviors: new Map(),
    activeVariables: new Map(),
    nets: new Map(),
  }
  const outMembers = [
    { instance: 'd1', terminal: 'cathode' },
    { instance: 'rl', terminal: 'terminal_a' },
  ]
  const gndMembers = [
    { instance: 'bat', terminal: 'terminal_negative' },
    { instance: 'rl', terminal: 'terminal_b' },
  ]
  if (opts.smoothingFarads !== undefined) {
    outMembers.push({ instance: 'cs', terminal: 'terminal_a' })
    gndMembers.push({ instance: 'cs', terminal: 'terminal_b' })
  }
  world.nets.set('ac', {
    id: 'ac',
    kind: 'net',
    members: [
      { instance: 'bat', terminal: 'terminal_positive' },
      { instance: 'd1', terminal: 'anode' },
    ],
  })
  world.nets.set('out', { id: 'out', kind: 'net', members: outMembers })
  world.nets.set('gnd', { id: 'gnd', kind: 'net', type: 'ground', members: gndMembers })
  world.instances.set('bat', {
    id: 'bat',
    kind_ref: 'primitive_device',
    definition: 'power_source',
    parameters: {
      nominal_voltage: scalar(0, 'volt'),
      ac_amplitude: scalar(opts.amplitude, 'volt'),
      frequency: scalar(opts.frequency, 'hertz'),
    },
    connects: [
      { net: 'ac', terminal: 'terminal_positive', of: 'bat' },
      { net: 'gnd', terminal: 'terminal_negative', of: 'bat' },
    ],
  })
  world.instances.set('d1', {
    id: 'd1',
    kind_ref: 'primitive_device',
    definition: 'diode_silicon_rectifier',
    parameters: {
      forward_voltage: scalar(0.7, 'volt'),
      max_forward_current: scalar(1, 'ampere'),
    },
    connects: [
      { net: 'ac', terminal: 'anode', of: 'd1' },
      { net: 'out', terminal: 'cathode', of: 'd1' },
    ],
  })
  world.instances.set('rl', {
    id: 'rl',
    kind_ref: 'primitive_device',
    definition: 'resistor',
    parameters: { resistance: scalar(opts.loadOhms, 'ohm') },
    connects: [
      { net: 'out', terminal: 'terminal_a', of: 'rl' },
      { net: 'gnd', terminal: 'terminal_b', of: 'rl' },
    ],
  })
  if (opts.smoothingFarads !== undefined) {
    world.instances.set('cs', {
      id: 'cs',
      kind_ref: 'primitive_device',
      definition: 'capacitor',
      parameters: { capacitance: scalar(opts.smoothingFarads, 'farad') },
      connects: [
        { net: 'out', terminal: 'terminal_a', of: 'cs' },
        { net: 'gnd', terminal: 'terminal_b', of: 'cs' },
      ],
    })
  }
  return world
}

describe('solveTransient — diode in the time loop (half-wave rectifier)', () => {
  const A = 5
  const f = 1000
  const T = 1 / f

  test('positive half-cycle passes (minus the diode drop); negative half-cycle is blocked', () => {
    const res = solveTransient(halfWaveRectifier({ amplitude: A, frequency: f, loadOhms: 1000 }), {
      timeStep: T / 200,
      duration: T,
    })
    expect(res.status).toBe('solved')

    // At the positive peak the output follows the input minus a sub-volt diode drop.
    const vOutPeak = vNodeAt(res.series, 'out', T / 4)
    const drop = vNodeAt(res.series, 'ac', T / 4) - vOutPeak
    expect(vOutPeak).toBeGreaterThan(A - 1)
    expect(vOutPeak).toBeLessThan(A)
    expect(drop).toBeGreaterThan(0.2)
    expect(drop).toBeLessThan(1)

    // At the negative trough the source is at −5 V but the diode blocks: out ≈ 0.
    expect(vNodeAt(res.series, 'ac', (3 * T) / 4)).toBeCloseTo(-A, 1)
    expect(Math.abs(vNodeAt(res.series, 'out', (3 * T) / 4))).toBeLessThan(0.1)
  })

  test('rectification produces a DC component: the mean output over a period is positive', () => {
    const res = solveTransient(halfWaveRectifier({ amplitude: A, frequency: f, loadOhms: 1000 }), {
      timeStep: T / 200,
      duration: T,
    })
    const vals = res.series.map((p) => p.nodes.get('out') ?? 0)
    const mean = vals.reduce((a, v) => a + v, 0) / vals.length
    // Ideal half-wave mean is V_peak/π ≈ 1.4 V here; the diode drop trims it a bit.
    expect(mean).toBeGreaterThan(1)
    // ...whereas the AC input itself averages to zero.
    const inVals = res.series.map((p) => p.nodes.get('ac') ?? 0)
    const inMean = inVals.reduce((a, v) => a + v, 0) / inVals.length
    expect(Math.abs(inMean)).toBeLessThan(0.1)
  })

  test('a smoothing capacitor turns the pulses into steady DC with small ripple', () => {
    // R·C = 1 kΩ · 100 µF = 0.1 s ≫ T = 1 ms → the cap rides the peaks.
    const smoothed = solveTransient(
      halfWaveRectifier({ amplitude: A, frequency: f, loadOhms: 1000, smoothingFarads: 100e-6 }),
      { timeStep: T / 100, duration: 5 * T },
    )
    expect(smoothed.status).toBe('solved')
    const lastPeriod = smoothed.series.filter((p) => p.time >= 4 * T)
    const v = lastPeriod.map((p) => p.nodes.get('out') ?? 0)
    const vMin = Math.min(...v)
    const vMax = Math.max(...v)
    expect(vMin).toBeGreaterThan(3) // holds well above zero between peaks
    expect(vMax - vMin).toBeLessThan(0.5) // small ripple…

    // …whereas without the cap the output collapses to ~0 every negative half-cycle.
    const raw = solveTransient(halfWaveRectifier({ amplitude: A, frequency: f, loadOhms: 1000 }), {
      timeStep: T / 100,
      duration: 5 * T,
    })
    const rawLast = raw.series.filter((p) => p.time >= 4 * T).map((p) => p.nodes.get('out') ?? 0)
    expect(Math.min(...rawLast)).toBeLessThan(0.1)
  })

  test('an unreachable iteration cap reports did-not-converge, not a wrong answer', () => {
    const res = solveTransient(halfWaveRectifier({ amplitude: A, frequency: f, loadOhms: 1000 }), {
      timeStep: T / 50,
      duration: T / 5,
      maxIterations: 1,
    })
    expect(res.status).toBe('did-not-converge')
    expect(res.warnings.some((w) => w.includes('did not converge'))).toBe(true)
  })
})

/**
 * Common-emitter NPN stage for the time loop. Vcc(9 V) → Rc(470) → collector;
 * emitter → ground. The base is fed through Rb either straight from Vcc (the
 * bjt-solver.test DC topology, for cross-validation) or from a separate
 * DC+AC drive source (for amplifier / switch tests).
 */
function commonEmitterTransient(opts: {
  rbOhms: number
  drive?: { dc: number; amplitude: number; frequency: number }
}): World {
  const world: World = {
    definitions: new Map(),
    instances: new Map(),
    behaviors: new Map(),
    activeVariables: new Map(),
    nets: new Map(),
  }
  const rbFeedNet = opts.drive ? 'drive' : 'vcc'
  world.nets.set('vcc', {
    id: 'vcc',
    kind: 'net',
    members: [
      { instance: 'bat', terminal: 'terminal_positive' },
      { instance: 'rc', terminal: 'terminal_a' },
      ...(opts.drive ? [] : [{ instance: 'rb', terminal: 'terminal_a' }]),
    ],
  })
  if (opts.drive) {
    world.nets.set('drive', {
      id: 'drive',
      kind: 'net',
      members: [
        { instance: 'vb', terminal: 'terminal_positive' },
        { instance: 'rb', terminal: 'terminal_a' },
      ],
    })
  }
  world.nets.set('base', {
    id: 'base',
    kind: 'net',
    members: [
      { instance: 'rb', terminal: 'terminal_b' },
      { instance: 'q1', terminal: 'base' },
    ],
  })
  world.nets.set('coll', {
    id: 'coll',
    kind: 'net',
    members: [
      { instance: 'rc', terminal: 'terminal_b' },
      { instance: 'q1', terminal: 'collector' },
    ],
  })
  world.nets.set('gnd', {
    id: 'gnd',
    kind: 'net',
    type: 'ground',
    members: [
      { instance: 'bat', terminal: 'terminal_negative' },
      { instance: 'q1', terminal: 'emitter' },
      ...(opts.drive ? [{ instance: 'vb', terminal: 'terminal_negative' }] : []),
    ],
  })
  world.instances.set('bat', {
    id: 'bat',
    kind_ref: 'primitive_device',
    definition: 'power_source',
    parameters: { nominal_voltage: scalar(9, 'volt') },
    connects: [
      { net: 'vcc', terminal: 'terminal_positive', of: 'bat' },
      { net: 'gnd', terminal: 'terminal_negative', of: 'bat' },
    ],
  })
  if (opts.drive) {
    world.instances.set('vb', {
      id: 'vb',
      kind_ref: 'primitive_device',
      definition: 'power_source',
      parameters: {
        nominal_voltage: scalar(opts.drive.dc, 'volt'),
        ac_amplitude: scalar(opts.drive.amplitude, 'volt'),
        frequency: scalar(opts.drive.frequency, 'hertz'),
      },
      connects: [
        { net: 'drive', terminal: 'terminal_positive', of: 'vb' },
        { net: 'gnd', terminal: 'terminal_negative', of: 'vb' },
      ],
    })
  }
  world.instances.set('rb', {
    id: 'rb',
    kind_ref: 'primitive_device',
    definition: 'resistor',
    parameters: { resistance: scalar(opts.rbOhms, 'ohm') },
    connects: [
      { net: rbFeedNet, terminal: 'terminal_a', of: 'rb' },
      { net: 'base', terminal: 'terminal_b', of: 'rb' },
    ],
  })
  world.instances.set('rc', {
    id: 'rc',
    kind_ref: 'primitive_device',
    definition: 'resistor',
    parameters: { resistance: scalar(470, 'ohm') },
    connects: [
      { net: 'vcc', terminal: 'terminal_a', of: 'rc' },
      { net: 'coll', terminal: 'terminal_b', of: 'rc' },
    ],
  })
  world.instances.set('q1', {
    id: 'q1',
    kind_ref: 'primitive_device',
    definition: 'transistor_bjt_npn',
    parameters: {
      saturation_current: scalar(1e-14, 'ampere'),
      forward_current_gain: scalar(100, 'dimensionless'),
      reverse_current_gain: scalar(2, 'dimensionless'),
    },
    connects: [
      { net: 'coll', terminal: 'collector', of: 'q1' },
      { net: 'base', terminal: 'base', of: 'q1' },
      { net: 'gnd', terminal: 'emitter', of: 'q1' },
    ],
  })
  return world
}

describe('solveTransient — R-L (inductor, backward-Euler)', () => {
  /** V_s — R — (mid node) — L — ground. The inductor starts with zero current. */
  function rlCircuit(R: number, L: number, Vs: number, windingOhms = 0): World {
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
    world.nets.set('mid', {
      id: 'mid',
      kind: 'net',
      members: [
        { instance: 'r1', terminal: 'terminal_b' },
        { instance: 'l1', terminal: 'terminal_a' },
      ],
    })
    world.nets.set('gnd', {
      id: 'gnd',
      kind: 'net',
      type: 'ground',
      members: [
        { instance: 'bat', terminal: 'terminal_negative' },
        { instance: 'l1', terminal: 'terminal_b' },
      ],
    })
    world.instances.set('bat', {
      id: 'bat',
      kind_ref: 'primitive_device',
      definition: 'power_source',
      parameters: { nominal_voltage: scalar(Vs, 'volt') },
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
        { net: 'mid', terminal: 'terminal_b', of: 'r1' },
      ],
    })
    world.instances.set('l1', {
      id: 'l1',
      kind_ref: 'primitive_device',
      definition: 'inductor',
      parameters: {
        inductance: scalar(L, 'henry'),
        ...(windingOhms > 0 ? { winding_resistance: scalar(windingOhms, 'ohm') } : {}),
      },
      connects: [
        { net: 'mid', terminal: 'terminal_a', of: 'l1' },
        { net: 'gnd', terminal: 'terminal_b', of: 'l1' },
      ],
    })
    return world
  }

  const Rrl = 100 // 1 kΩ would make τ tiny; 100 Ω + 10 mH → τ = 100 µs
  const L = 0.01
  const tauRL = L / Rrl

  test('current ramps on the L/R exponential: V_L decays Vs → ~37% at τ → ~0 by 5τ', () => {
    const res = solveTransient(rlCircuit(Rrl, L, 5), { timeStep: tauRL / 200, duration: 5 * tauRL })
    expect(res.status).toBe('solved')
    // At t = 0 the inductor current is 0 (it cannot jump) → no drop across R →
    // the FULL source voltage sits across the inductor.
    expect(vNodeAt(res.series, 'mid', 0)).toBeCloseTo(5, 6)
    // V_L(t) = Vs·e^(−t/τ): ~36.8% at one time constant, ~0 after five.
    expect(vNodeAt(res.series, 'mid', tauRL)).toBeCloseTo(5 * Math.exp(-1), 1)
    expect(vNodeAt(res.series, 'mid', 5 * tauRL)).toBeLessThan(0.06)
  })

  test('with real winding resistance the inductor conducts DC and the divider holds', () => {
    // R 100 Ω + winding DCR 100 Ω → steady state mid = Vs·R_w/(R+R_w) = 2.5 V.
    const res = solveTransient(rlCircuit(Rrl, L, 5, 100), {
      timeStep: tauRL / 100,
      duration: 10 * tauRL,
    })
    expect(res.status).toBe('solved')
    expect(vNodeAt(res.series, 'mid', 10 * tauRL)).toBeCloseTo(2.5, 2)
  })

  test('the transient steady state matches the DC solver (inductor = winding-R short at DC)', () => {
    const world = rlCircuit(Rrl, L, 5, 100)
    const dc = solveDC(world)
    expect(dc.status).toBe('solved')
    expect(dc.nodes.get('mid')).toBeCloseTo(2.5, 6)
    expect(dc.branches.get('l1')).toBeCloseTo(0.025, 6) // 5 V / 200 Ω

    const tr = solveTransient(world, { timeStep: tauRL / 100, duration: 10 * tauRL })
    const last = tr.series[tr.series.length - 1]
    expect(last?.nodes.get('mid')).toBeCloseTo(dc.nodes.get('mid') ?? Number.NaN, 3)
  })
})

describe('solveTransient — transformer (coupled windings)', () => {
  /**
   * source — [seriesOhms] — primary; secondary → load resistor → ground.
   * Small-EI-class transformer: L1 0.1 H, L2 10 H (≈1:10), k 0.98, real DCRs.
   */
  function transformerCircuit(opts: {
    dc: number
    ac?: { amplitude: number; frequency: number }
    seriesOhms?: number
    loadOhms: number
    coreLossOhms?: number
    satFluxVs?: number
  }): World {
    const world: World = {
      definitions: new Map(),
      instances: new Map(),
      behaviors: new Map(),
      activeVariables: new Map(),
      nets: new Map(),
    }
    const series = opts.seriesOhms ?? 0
    const pFeed = series > 0 ? 'p_in' : 'in'
    world.nets.set('in', { id: 'in', kind: 'net', members: [] })
    if (series > 0) world.nets.set('p_in', { id: 'p_in', kind: 'net', members: [] })
    world.nets.set('out', { id: 'out', kind: 'net', members: [] })
    world.nets.set('gnd', { id: 'gnd', kind: 'net', type: 'ground', members: [] })
    world.instances.set('src', {
      id: 'src',
      kind_ref: 'primitive_device',
      definition: 'power_source',
      parameters: {
        nominal_voltage: scalar(opts.dc, 'volt'),
        ...(opts.ac
          ? {
              ac_amplitude: scalar(opts.ac.amplitude, 'volt'),
              frequency: scalar(opts.ac.frequency, 'hertz'),
            }
          : {}),
      },
      connects: [
        { net: 'in', terminal: 'terminal_positive', of: 'src' },
        { net: 'gnd', terminal: 'terminal_negative', of: 'src' },
      ],
    })
    if (series > 0) {
      world.instances.set('rs', {
        id: 'rs',
        kind_ref: 'primitive_device',
        definition: 'resistor',
        parameters: { resistance: scalar(series, 'ohm') },
        connects: [
          { net: 'in', terminal: 'terminal_a', of: 'rs' },
          { net: 'p_in', terminal: 'terminal_b', of: 'rs' },
        ],
      })
    }
    world.instances.set('t1', {
      id: 't1',
      kind_ref: 'primitive_device',
      definition: 'transformer',
      parameters: {
        primary_inductance: scalar(0.1, 'henry'),
        secondary_inductance: scalar(10, 'henry'),
        coupling_coefficient: scalar(0.98, 'dimensionless'),
        primary_resistance: scalar(0.5, 'ohm'),
        secondary_resistance: scalar(50, 'ohm'),
        ...(opts.coreLossOhms !== undefined
          ? { core_loss_resistance: scalar(opts.coreLossOhms, 'ohm') }
          : {}),
        ...(opts.satFluxVs !== undefined
          ? { saturation_flux_linkage: scalar(opts.satFluxVs, 'weber') }
          : {}),
      },
      connects: [
        { net: pFeed, terminal: 'primary_a', of: 't1' },
        { net: 'gnd', terminal: 'primary_b', of: 't1' },
        { net: 'out', terminal: 'secondary_a', of: 't1' },
        { net: 'gnd', terminal: 'secondary_b', of: 't1' },
      ],
    })
    world.instances.set('rl', {
      id: 'rl',
      kind_ref: 'primitive_device',
      definition: 'resistor',
      parameters: { resistance: scalar(opts.loadOhms, 'ohm') },
      connects: [
        { net: 'out', terminal: 'terminal_a', of: 'rl' },
        { net: 'gnd', terminal: 'terminal_b', of: 'rl' },
      ],
    })
    return world
  }

  test('AC steps up by ≈ the turns ratio k·√(L2/L1) ≈ 9.8', () => {
    const f = 60
    const T = 1 / f
    const res = solveTransient(
      transformerCircuit({ dc: 0, ac: { amplitude: 1, frequency: f }, loadOhms: 10000 }),
      { timeStep: T / 200, duration: 3 * T },
    )
    expect(res.status).toBe('solved')
    const lastPeriod = res.series.filter((p) => p.time >= 2 * T)
    const swing = (net: string) => {
      const v = lastPeriod.map((p) => p.nodes.get(net) ?? 0)
      return Math.max(...v) - Math.min(...v)
    }
    const ratio = swing('out') / swing('in')
    expect(ratio).toBeGreaterThan(8.5)
    expect(ratio).toBeLessThan(10)
  })

  test('steady DC does not pass — only the switch-on kick couples, then it decays', () => {
    // τ = L1/(r1 + series) = 0.1/5 = 20 ms; simulate 15τ.
    const res = solveTransient(transformerCircuit({ dc: 5, seriesOhms: 4.5, loadOhms: 10000 }), {
      timeStep: 0.002,
      duration: 0.3,
    })
    expect(res.status).toBe('solved')
    const vOutEarly = vNodeAt(res.series, 'out', 0.002) // the dΦ/dt inrush kick
    const vOutEnd = vNodeAt(res.series, 'out', 0.3) // steady DC: di/dt → 0
    expect(Math.abs(vOutEarly)).toBeGreaterThan(3) // transformer coupled the change
    expect(Math.abs(vOutEnd)).toBeLessThan(0.1) // …but blocks steady DC
  })

  test('the DC solver agrees: windings conduct through their DCR, nothing couples', () => {
    const dc = solveDC(transformerCircuit({ dc: 5, seriesOhms: 4.5, loadOhms: 10000 }))
    expect(dc.status).toBe('solved')
    // Primary loop: 5 V across 4.5 Ω + 0.5 Ω winding → 1 A; node after Rs at 0.5 V.
    expect(dc.nodes.get('p_in')).toBeCloseTo(0.5, 6)
    expect(dc.branches.get('t1')).toBeCloseTo(1, 6) // primary winding current
    expect(dc.nodes.get('out')).toBeCloseTo(0, 9) // no DC transformation
  })

  test('core (iron) loss draws real power — the primary sags behind a source impedance', () => {
    const f = 60
    const T = 1 / f
    const swingAtPrimary = (coreLossOhms?: number) => {
      const res = solveTransient(
        transformerCircuit({
          dc: 0,
          ac: { amplitude: 12, frequency: f },
          seriesOhms: 50,
          loadOhms: 100000,
          ...(coreLossOhms !== undefined ? { coreLossOhms } : {}),
        }),
        { timeStep: T / 200, duration: 3 * T },
      )
      expect(res.status).toBe('solved')
      const lastPeriod = res.series.filter((p) => p.time >= 2 * T)
      const v = lastPeriod.map((p) => p.nodes.get('p_in') ?? 0)
      return Math.max(...v) - Math.min(...v)
    }
    const lossless = swingAtPrimary()
    const withIronLoss = swingAtPrimary(200)
    // The 200 Ω core-loss branch pulls real in-phase current through the 50 Ω
    // source impedance, sagging the primary measurably below the lossless case.
    expect(withIronLoss).toBeLessThan(lossless - 0.5)
  })

  test('core saturation is detected from real volt-seconds: too-low frequency warns', () => {
    // 75 mV·s core: at 60 Hz a 12 V drive peaks at 2V/ω ≈ 64 mV·s (inrush
    // doubling included) — inside the rating, silent. At 5 Hz the same drive
    // integrates to ≈ 0.76 V·s — a genuinely saturated core, warned.
    const run = (frequency: number) =>
      solveTransient(
        transformerCircuit({
          dc: 0,
          ac: { amplitude: 12, frequency },
          loadOhms: 100000,
          satFluxVs: 0.075,
        }),
        { timeStep: 1 / frequency / 200, duration: 2 / frequency },
      )
    const nominal = run(60)
    expect(nominal.status).toBe('solved')
    expect(nominal.warnings.some((w) => w.includes('saturated'))).toBe(false)

    const tooSlow = run(5)
    expect(tooSlow.status).toBe('solved')
    expect(tooSlow.warnings.some((w) => w.includes('saturated'))).toBe(true)
  })
})

describe('solveTransient — center-tapped transformer (three coupled windings)', () => {
  /**
   * Inverter-class CT transformer: L1 (end-to-end) 0.1 H → each half 0.025 H,
   * L2 10 H, k 0.98. 'half' drive = source on primary_a with the tap grounded
   * (push-pull style, primary_b floats); 'full' drive = source across the whole
   * primary (tap floats). Secondary feeds a load to ground.
   */
  function ctCircuit(opts: {
    drive: 'half' | 'full'
    dc: number
    ac?: { amplitude: number; frequency: number }
    seriesOhms?: number
    loadOhms: number
  }): World {
    const world: World = {
      definitions: new Map(),
      instances: new Map(),
      behaviors: new Map(),
      activeVariables: new Map(),
      nets: new Map(),
    }
    const series = opts.seriesOhms ?? 0
    const feed = series > 0 ? 'p_in' : 'in'
    for (const id of ['in', 'p_in', 'float', 'out']) {
      world.nets.set(id, { id, kind: 'net', members: [] })
    }
    world.nets.set('gnd', { id: 'gnd', kind: 'net', type: 'ground', members: [] })
    world.instances.set('src', {
      id: 'src',
      kind_ref: 'primitive_device',
      definition: 'power_source',
      parameters: {
        nominal_voltage: scalar(opts.dc, 'volt'),
        ...(opts.ac
          ? {
              ac_amplitude: scalar(opts.ac.amplitude, 'volt'),
              frequency: scalar(opts.ac.frequency, 'hertz'),
            }
          : {}),
      },
      connects: [
        { net: 'in', terminal: 'terminal_positive', of: 'src' },
        { net: 'gnd', terminal: 'terminal_negative', of: 'src' },
      ],
    })
    if (series > 0) {
      world.instances.set('rs', {
        id: 'rs',
        kind_ref: 'primitive_device',
        definition: 'resistor',
        parameters: { resistance: scalar(series, 'ohm') },
        connects: [
          { net: 'in', terminal: 'terminal_a', of: 'rs' },
          { net: 'p_in', terminal: 'terminal_b', of: 'rs' },
        ],
      })
    }
    // half: feed → primary_a, tap → gnd, primary_b floats.
    // full: feed → primary_a, primary_b → gnd, tap floats.
    const ctNet = opts.drive === 'half' ? 'gnd' : 'float'
    const pbNet = opts.drive === 'half' ? 'float' : 'gnd'
    world.instances.set('t1', {
      id: 't1',
      kind_ref: 'primitive_device',
      definition: 'transformer_center_tapped',
      parameters: {
        primary_inductance: scalar(0.1, 'henry'),
        secondary_inductance: scalar(10, 'henry'),
        coupling_coefficient: scalar(0.98, 'dimensionless'),
        primary_resistance: scalar(1, 'ohm'),
        secondary_resistance: scalar(50, 'ohm'),
      },
      connects: [
        { net: feed, terminal: 'primary_a', of: 't1' },
        { net: ctNet, terminal: 'primary_ct', of: 't1' },
        { net: pbNet, terminal: 'primary_b', of: 't1' },
        { net: 'out', terminal: 'secondary_a', of: 't1' },
        { net: 'gnd', terminal: 'secondary_b', of: 't1' },
      ],
    })
    world.instances.set('rl', {
      id: 'rl',
      kind_ref: 'primitive_device',
      definition: 'resistor',
      parameters: { resistance: scalar(opts.loadOhms, 'ohm') },
      connects: [
        { net: 'out', terminal: 'terminal_a', of: 'rl' },
        { net: 'gnd', terminal: 'terminal_b', of: 'rl' },
      ],
    })
    return world
  }

  test('half drive (push-pull style): one 12 V half steps up to mains-class AC', () => {
    const f = 60
    const T = 1 / f
    const res = solveTransient(
      ctCircuit({ drive: 'half', dc: 0, ac: { amplitude: 12, frequency: f }, loadOhms: 100000 }),
      { timeStep: T / 200, duration: 3 * T },
    )
    expect(res.status).toBe('solved')
    const lastPeriod = res.series.filter((p) => p.time >= 2 * T)
    const swing = (net: string) => {
      const v = lastPeriod.map((p) => p.nodes.get(net) ?? 0)
      return Math.max(...v) - Math.min(...v)
    }
    // Each half is L1/4 → per-half ratio ≈ k·√(L2/(L1/4)) = 0.98·20 = 19.6:
    // 12 V peak in → ~230 V peak out, the 12 V → mains inverter transformation.
    const ratio = swing('out') / swing('in')
    expect(ratio).toBeGreaterThan(17)
    expect(ratio).toBeLessThan(20)
    expect(swing('out')).toBeGreaterThan(2 * 200) // ≳ 200 V peak — mains class
  })

  test('full-winding drive matches the plain transformer ratio (validates L/4 halving)', () => {
    const f = 60
    const T = 1 / f
    const res = solveTransient(
      ctCircuit({ drive: 'full', dc: 0, ac: { amplitude: 1, frequency: f }, loadOhms: 100000 }),
      { timeStep: T / 200, duration: 3 * T },
    )
    expect(res.status).toBe('solved')
    const lastPeriod = res.series.filter((p) => p.time >= 2 * T)
    const swing = (net: string) => {
      const v = lastPeriod.map((p) => p.nodes.get(net) ?? 0)
      return Math.max(...v) - Math.min(...v)
    }
    // End-to-end the two halves total 2·Lh·(1+k) ≈ L1, so the full-primary ratio
    // lands at ≈ k·√(L2/L1) ≈ 9.8 — the same as the two-winding transformer.
    const ratio = swing('out') / swing('in')
    expect(ratio).toBeGreaterThan(8.5)
    expect(ratio).toBeLessThan(10.5)
  })

  test('the DC solver sees three winding-resistance shorts; nothing couples', () => {
    const dc = solveDC(ctCircuit({ drive: 'half', dc: 5, seriesOhms: 4.5, loadOhms: 100000 }))
    expect(dc.status).toBe('solved')
    // Half-a's DCR is primary_resistance/2 = 0.5 Ω → 5 V across 4.5 + 0.5 → 1 A.
    expect(dc.nodes.get('p_in')).toBeCloseTo(0.5, 6)
    expect(dc.branches.get('t1')).toBeCloseTo(1, 6)
    expect(dc.nodes.get('out')).toBeCloseTo(0, 9)
  })
})

describe('solveTransient — wires + switches (canvas circuits run through time)', () => {
  /** 5 V — switch — wire(1 Ω) — mid — resistor(4 Ω) — ground. */
  function wireSwitchCircuit(switchState: 'open' | 'closed'): World {
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
        { instance: 'sw', terminal: 'terminal_in' },
      ],
    })
    world.nets.set('sw_out', {
      id: 'sw_out',
      kind: 'net',
      members: [
        { instance: 'sw', terminal: 'terminal_out' },
        { instance: 'w1', terminal: 'terminal_a' },
      ],
    })
    world.nets.set('mid', {
      id: 'mid',
      kind: 'net',
      members: [
        { instance: 'w1', terminal: 'terminal_b' },
        { instance: 'r1', terminal: 'terminal_a' },
      ],
    })
    world.nets.set('gnd', {
      id: 'gnd',
      kind: 'net',
      type: 'ground',
      members: [
        { instance: 'bat', terminal: 'terminal_negative' },
        { instance: 'r1', terminal: 'terminal_b' },
      ],
    })
    world.instances.set('bat', {
      id: 'bat',
      kind_ref: 'primitive_device',
      definition: 'power_source',
      parameters: { nominal_voltage: scalar(5, 'volt') },
      connects: [
        { net: 'vs', terminal: 'terminal_positive', of: 'bat' },
        { net: 'gnd', terminal: 'terminal_negative', of: 'bat' },
      ],
    })
    world.instances.set('sw', {
      id: 'sw',
      kind_ref: 'primitive_device',
      definition: 'switch_spst_toggle',
      parameters: { state: { value: switchState } },
      connects: [
        { net: 'vs', terminal: 'terminal_in', of: 'sw' },
        { net: 'sw_out', terminal: 'terminal_out', of: 'sw' },
      ],
    })
    world.instances.set('w1', {
      id: 'w1',
      kind_ref: 'primitive_device',
      definition: 'wire',
      parameters: { resistance: scalar(1, 'ohm') },
      connects: [
        { net: 'sw_out', terminal: 'terminal_a', of: 'w1' },
        { net: 'mid', terminal: 'terminal_b', of: 'w1' },
      ],
    })
    world.instances.set('r1', {
      id: 'r1',
      kind_ref: 'primitive_device',
      definition: 'resistor',
      parameters: { resistance: scalar(4, 'ohm') },
      connects: [
        { net: 'mid', terminal: 'terminal_a', of: 'r1' },
        { net: 'gnd', terminal: 'terminal_b', of: 'r1' },
      ],
    })
    return world
  }

  test('a resistive wire divides voltage; a closed switch is a clean short', () => {
    const res = solveTransient(wireSwitchCircuit('closed'), { timeStep: 1e-5, duration: 1e-4 })
    expect(res.status).toBe('solved')
    // 5 V across (1 Ω wire + 4 Ω load) → 1 A → mid sits at 4 V; the closed
    // switch drops nothing (sw_out = vs = 5 V).
    expect(vNodeAt(res.series, 'mid', 1e-4)).toBeCloseTo(4, 6)
    expect(vNodeAt(res.series, 'sw_out', 1e-4)).toBeCloseTo(5, 6)
  })

  test('an open switch is a real open circuit — no current, load at 0 V', () => {
    const res = solveTransient(wireSwitchCircuit('open'), { timeStep: 1e-5, duration: 1e-4 })
    expect(res.status).toBe('solved')
    expect(Math.abs(vNodeAt(res.series, 'mid', 1e-4))).toBeLessThan(1e-9)
  })
})

describe('solveTransient — NPN BJT in the time loop', () => {
  test('a pure-DC transistor circuit settles to exactly the DC solver’s answer', () => {
    const world = commonEmitterTransient({ rbOhms: 100000 })
    const dc = solveDC(world)
    expect(dc.status).toBe('solved')

    const tr = solveTransient(world, { timeStep: 1e-5, duration: 1e-4 })
    expect(tr.status).toBe('solved')
    const last = tr.series[tr.series.length - 1]
    expect(last?.nodes.get('base')).toBeCloseTo(dc.nodes.get('base') ?? Number.NaN, 4)
    expect(last?.nodes.get('coll')).toBeCloseTo(dc.nodes.get('coll') ?? Number.NaN, 4)
  })

  test('common-emitter amplifier: the collector swings amplified and inverted', () => {
    const f = 1000
    const T = 1 / f
    // 2 V bias + 0.5 V sine into Rb 100k → active region throughout the cycle.
    const res = solveTransient(
      commonEmitterTransient({ rbOhms: 100000, drive: { dc: 2, amplitude: 0.5, frequency: f } }),
      { timeStep: T / 100, duration: 2 * T },
    )
    expect(res.status).toBe('solved')

    const lastPeriod = res.series.filter((p) => p.time >= T)
    const vBase = lastPeriod.map((p) => p.nodes.get('base') ?? 0)
    const vColl = lastPeriod.map((p) => p.nodes.get('coll') ?? 0)
    const swing = (v: number[]) => Math.max(...v) - Math.min(...v)

    // Real voltage gain: the collector moves far more than the base node does…
    expect(swing(vColl)).toBeGreaterThan(0.2)
    expect(swing(vColl)).toBeGreaterThan(5 * swing(vBase))

    // …and inverted: base up → collector down (negative correlation over the cycle).
    const mean = (v: number[]) => v.reduce((a, x) => a + x, 0) / v.length
    const mB = mean(vBase)
    const mC = mean(vColl)
    const covariance = vBase.reduce((a, x, i) => a + (x - mB) * ((vColl[i] ?? 0) - mC), 0)
    expect(covariance).toBeLessThan(0)
  })

  test('transistor as a switch: drive high → saturated near 0 V; drive low → cut off near Vcc', () => {
    const f = 1000
    const T = 1 / f
    // 0 → 5 V swing into Rb 10k: at the peak the base is overdriven (saturation);
    // at the trough the drive is 0 V (cutoff).
    const res = solveTransient(
      commonEmitterTransient({ rbOhms: 10000, drive: { dc: 2.5, amplitude: 2.5, frequency: f } }),
      { timeStep: T / 100, duration: T },
    )
    expect(res.status).toBe('solved')

    const vOn = vNodeAt(res.series, 'coll', T / 4) // drive at +5 V
    const vOff = vNodeAt(res.series, 'coll', (3 * T) / 4) // drive at 0 V
    expect(vOn).toBeLessThan(0.5) // saturated: collector pulled near ground
    expect(vOn).toBeGreaterThan(0) // …but a real V_CE(sat), not exactly 0
    expect(vOff).toBeGreaterThan(8.5) // cut off: collector floats up to ~Vcc
  })
})
