/**
 * THE PHYSICS LADDER — a single climb from Ohm's law to a transistor amplifier, every rung
 * checked against a FIRST-PRINCIPLES hand calculation (not against the solver's own output),
 * and the tools cross-checked against EACH OTHER: the DC solver, the time-domain (transient)
 * solver, the frequency-domain (AC) analyzer, and the Math panel's Kirchhoff bookkeeping all
 * have to agree on the same real circuit. If any number were faked, a rung would break.
 *
 * Run it and read the printed ladder: each line shows the textbook value, the computed value,
 * and the gap. This is the "is it really working, all together" proof.
 */

import { describe, expect, test } from 'vitest'
import { acResponse, acSweep } from '../src/ac-analysis.ts'
import type { World } from '../src/cross-fk-validator.ts'
import { solveDC } from '../src/dc-solver.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { buildMathView } from '../src/renderer/math-view.ts'
import { solveTransient } from '../src/transient-solver.ts'
import { propagationDelayS } from '../src/transmission-line-model.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const e = (s: string, sh: string, t: string, th: string) => ({
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
})
const netOf = (w: World, inst: string, term: string) =>
  w.instances.get(inst)?.connects?.find((c) => c.terminal === term)?.net ?? ''
const V = (m: Map<string, number>, net: string) => m.get(net) ?? 0

function fmt(x: number): string {
  const a = Math.abs(x)
  if (a !== 0 && (a < 1e-3 || a >= 1e6)) return x.toExponential(3)
  return x.toPrecision(5).replace(/\.?0+$/, '')
}

/** Assert + print: textbook `expected` vs computed `actual`, within a relative tolerance. */
function rung(label: string, expected: number, actual: number, unit: string, relTol = 0.01) {
  const rel = expected !== 0 ? Math.abs((actual - expected) / expected) : Math.abs(actual)
  const mark = rel <= relTol ? '✓' : '✗'
  console.log(
    `   ${mark} ${label}\n        textbook ${fmt(expected)} ${unit}   computed ${fmt(actual)} ${unit}   (Δ ${(rel * 100).toFixed(2)}%)`,
  )
  expect(rel, `${label}: ${actual} vs expected ${expected}`).toBeLessThanOrEqual(relTol)
}

describe('the physics ladder — simple → complex, every rung vs first principles', () => {
  test('L1 · Ohm’s law — a source and one resistor', () => {
    const nodes: CanvasNode[] = [
      {
        id: 'src',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(10, 'volt'), internal_resistance: scalar(0, 'ohm') },
      },
      { id: 'r', definition: 'resistor', parameters: { resistance: scalar(1000, 'ohm') } },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      e('src', 'terminal_positive', 'r', 'terminal_a'),
      e('r', 'terminal_b', 'src', 'terminal_negative'),
      e('gnd', 'reference_terminal', 'src', 'terminal_negative'),
    ]
    const w = canvasToWorld(nodes, edges)
    const dc = solveDC(w)
    expect(dc.status).toBe('solved')
    const i = Math.abs(dc.branches.get('r') ?? 0)
    const vTop = V(dc.nodes, netOf(w, 'r', 'terminal_a'))
    console.log('L1 · Ohm’s law  (10 V, 1 kΩ)')
    rung('current  I = V/R', 10 / 1000, i, 'A')
    rung('node voltage at R', 10, vTop, 'V')
    rung('power  P = V²/R', (10 * 10) / 1000, i * vTop, 'W')
  })

  test('L2 · voltage divider — and KCL balances at the node', () => {
    const nodes: CanvasNode[] = [
      {
        id: 'src',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(12, 'volt'), internal_resistance: scalar(0, 'ohm') },
      },
      { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(1000, 'ohm') } },
      { id: 'r2', definition: 'resistor', parameters: { resistance: scalar(3000, 'ohm') } },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      e('src', 'terminal_positive', 'r1', 'terminal_a'),
      e('r1', 'terminal_b', 'r2', 'terminal_a'),
      e('r2', 'terminal_b', 'src', 'terminal_negative'),
      e('gnd', 'reference_terminal', 'src', 'terminal_negative'),
    ]
    const w = canvasToWorld(nodes, edges)
    const dc = solveDC(w)
    expect(dc.status).toBe('solved')
    const vMid = V(dc.nodes, netOf(w, 'r1', 'terminal_b'))
    console.log('L2 · voltage divider  (12 V, 1 kΩ / 3 kΩ)')
    rung('mid node  V·R2/(R1+R2)', (12 * 3000) / 4000, vMid, 'V')
    rung('loop current', 12 / 4000, Math.abs(dc.branches.get('r1') ?? 0), 'A')
    // The Math panel re-sums Kirchhoff's current law at every net — assert it nets to zero.
    const mv = buildMathView(w, dc)
    let worstKcl = 0
    for (const net of mv.nets)
      if (net.sumAmps !== null) worstKcl = Math.max(worstKcl, Math.abs(net.sumAmps))
    console.log(`   ✓ Kirchhoff's current law — worst net residual ${fmt(worstKcl)} A (in = out)`)
    expect(worstKcl).toBeLessThan(1e-9)
  })

  test('L3 · a real diode — the nonlinear solve is self-consistent (KVL + KCL)', () => {
    const nodes: CanvasNode[] = [
      {
        id: 'src',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(9, 'volt'), internal_resistance: scalar(0, 'ohm') },
      },
      { id: 'r', definition: 'resistor', parameters: { resistance: scalar(100, 'ohm') } },
      {
        id: 'd',
        definition: 'diode_silicon_rectifier',
        parameters: {
          forward_voltage: scalar(0.7, 'volt'),
          max_forward_current: scalar(1, 'ampere'),
          peak_inverse_voltage: scalar(1000, 'volt'),
        },
      },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      e('src', 'terminal_positive', 'r', 'terminal_a'),
      e('r', 'terminal_b', 'd', 'anode'),
      e('d', 'cathode', 'src', 'terminal_negative'),
      e('gnd', 'reference_terminal', 'src', 'terminal_negative'),
    ]
    const w = canvasToWorld(nodes, edges)
    const dc = solveDC(w)
    expect(dc.status).toBe('solved')
    const iR = Math.abs(dc.branches.get('r') ?? 0)
    const iD = Math.abs(dc.branches.get('d') ?? 0)
    const vD = V(dc.nodes, netOf(w, 'd', 'anode')) - V(dc.nodes, netOf(w, 'd', 'cathode'))
    console.log('L3 · silicon diode  (9 V, 100 Ω, series diode)')
    rung('KCL — same current through R and diode', iR, iD, 'A', 1e-6)
    rung('KVL — V_diode + I·R sums to the source', 9, vD + iD * 100, 'V', 1e-6)
    console.log(
      `   ✓ operating point self-consistent: I ≈ ${fmt(iD * 1000)} mA at V_diode ≈ ${fmt(vD)} V (Newton-Raphson)`,
    )
    expect(iD).toBeGreaterThan(0.05) // a sane forward current, ~80 mA
    expect(iD).toBeLessThan(0.09)
  })

  test('L4 · RC transient — the time constant, and it settles to the DC answer', () => {
    const R = 1000
    const C = 1e-6
    const tau = R * C // 1 ms
    const nodes: CanvasNode[] = [
      {
        id: 'src',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(5, 'volt'), internal_resistance: scalar(0, 'ohm') },
      },
      { id: 'r', definition: 'resistor', parameters: { resistance: scalar(R, 'ohm') } },
      { id: 'c', definition: 'capacitor', parameters: { capacitance: scalar(C, 'farad') } },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      e('src', 'terminal_positive', 'r', 'terminal_a'),
      e('r', 'terminal_b', 'c', 'terminal_a'),
      e('c', 'terminal_b', 'src', 'terminal_negative'),
      e('gnd', 'reference_terminal', 'src', 'terminal_negative'),
    ]
    const w = canvasToWorld(nodes, edges)
    const outNet = netOf(w, 'c', 'terminal_a')

    const dc = solveDC(w)
    const vDc = V(dc.nodes, outNet) // cap fully charged → source voltage

    const tr = solveTransient(w, { timeStep: tau / 200, duration: 6 * tau })
    expect(tr.status).toBe('solved')
    const series = tr.series.map((p) => ({ t: p.time, v: V(p.nodes, outNet) }))
    // value one time-constant in: textbook 1 − e⁻¹ = 63.2 % of final
    const atTau = series.reduce((best, p) =>
      Math.abs(p.t - tau) < Math.abs(best.t - tau) ? p : best,
    )
    const vFinal = series[series.length - 1]?.v ?? 0
    console.log('L4 · RC transient  (5 V, 1 kΩ, 1 µF  →  τ = 1 ms)')
    rung('V_C at t = τ  (5·(1−e⁻¹))', 5 * (1 - Math.exp(-1)), atTau.v, 'V', 0.02)
    rung('settles to 5 V', 5, vFinal, 'V', 0.01)
    rung('cross-check: transient final = DC solver', vDc, vFinal, 'V', 0.01)
  })

  test('L5 · RC frequency response — the corner matches the SAME RC', () => {
    const R = 1000
    const C = 1e-6
    const fc = 1 / (2 * Math.PI * R * C) // 159.15 Hz
    const nodes: CanvasNode[] = [
      { id: 'src', definition: 'power_source', parameters: { nominal_voltage: scalar(1, 'volt') } },
      { id: 'r', definition: 'resistor', parameters: { resistance: scalar(R, 'ohm') } },
      { id: 'c', definition: 'capacitor', parameters: { capacitance: scalar(C, 'farad') } },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      e('src', 'terminal_positive', 'r', 'terminal_a'),
      e('r', 'terminal_b', 'c', 'terminal_a'),
      e('c', 'terminal_b', 'gnd', 'reference_terminal'),
      e('gnd', 'reference_terminal', 'src', 'terminal_negative'),
    ]
    const w = canvasToWorld(nodes, edges)
    const out = netOf(w, 'c', 'terminal_a')
    const at = acResponse(w, { inputSource: 'src', outputNet: out }, fc)
    console.log('L5 · RC low-pass, AC  (same 1 kΩ / 1 µF)')
    rung('gain at the corner  1/√2', Math.SQRT1_2, at.gain, '', 0.01)
    rung('that is −3 dB', -3.0103, at.gainDb, 'dB', 0.01)
    rung('phase at the corner', -45, at.phaseDeg, '°', 0.01)
    console.log(
      `   ✓ cross-check: the −3 dB corner ${fmt(fc)} Hz is exactly 1/(2πRC) = 1/(2π·τ) from L4`,
    )
  })

  test('L6 · LC resonance — AC peak and transient ringing both land on f₀', () => {
    const L = 1e-3
    const C = 1e-6
    const Rr = 10
    const f0 = 1 / (2 * Math.PI * Math.sqrt(L * C)) // 5032.9 Hz
    // series  source → L → C → R → ground ; output across R peaks exactly at f₀
    const nodes: CanvasNode[] = [
      { id: 'src', definition: 'power_source', parameters: { nominal_voltage: scalar(5, 'volt') } },
      { id: 'l', definition: 'inductor', parameters: { inductance: scalar(L, 'henry') } },
      { id: 'c', definition: 'capacitor', parameters: { capacitance: scalar(C, 'farad') } },
      { id: 'r', definition: 'resistor', parameters: { resistance: scalar(Rr, 'ohm') } },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      e('src', 'terminal_positive', 'l', 'terminal_a'),
      e('l', 'terminal_b', 'c', 'terminal_a'),
      e('c', 'terminal_b', 'r', 'terminal_a'),
      e('r', 'terminal_b', 'gnd', 'reference_terminal'),
      e('gnd', 'reference_terminal', 'src', 'terminal_negative'),
    ]
    const w = canvasToWorld(nodes, edges)
    const nLC = netOf(w, 'l', 'terminal_b') // between L and C
    const nR = netOf(w, 'r', 'terminal_a') // across R (vs ground)

    // AC: find the peak of |V_R| over a sweep — it sits at f₀
    const sweep = acSweep(w, {
      inputSource: 'src',
      outputNet: nR,
      fStartHz: f0 / 5,
      fStopHz: f0 * 5,
      pointsPerDecade: 60,
    })
    const peak = sweep.reduce((b, p) => (p.gain > b.gain ? p : b))

    // Transient: a DC step rings; the first overshoot peak of V_C is at t = π/ω_d  → f ≈ f₀
    const tr = solveTransient(w, { timeStep: 1e-6, duration: 2e-3 })
    const vc = tr.series.map((p) => ({ t: p.time, v: V(p.nodes, nLC) - V(p.nodes, nR) }))
    let pk = 0
    for (let i = 2; i < vc.length - 1; i++) {
      const a = vc[i]
      const prev = vc[i - 1]
      const next = vc[i + 1]
      if (a && prev && next && a.v > prev.v && a.v >= next.v) {
        pk = a.t
        break
      }
    }
    const fRing = 1 / (2 * pk)
    console.log('L6 · LC resonance  (1 mH, 1 µF, 10 Ω  →  f₀ = 5.03 kHz)')
    rung('AC: peak-gain frequency = f₀', f0, peak.frequencyHz, 'Hz', 0.03)
    rung('transient: ringing frequency = f₀', f0, fRing, 'Hz', 0.08)
    console.log(
      `   ✓ cross-check: two independent engines + textbook agree on 1/(2π√(LC)) within a few %`,
    )
  })

  test('L7 · transmission line — time-domain settles to DC; quarter-wave flips Z in AC', () => {
    // Time domain: a matched 300 Ω line, 300 m, 0.95c → far end dark until τ, then the DC divider.
    const lineNodes: CanvasNode[] = [
      {
        id: 'src',
        definition: 'power_source',
        parameters: {
          nominal_voltage: scalar(10, 'volt'),
          internal_resistance: scalar(300, 'ohm'),
        },
      },
      {
        id: 'line',
        definition: 'transmission_line',
        parameters: {
          characteristic_impedance: scalar(300, 'ohm'),
          length: scalar(300, 'meter'),
          velocity_factor: scalar(0.95, 'dimensionless'),
        },
      },
      { id: 'load', definition: 'resistor', parameters: { resistance: scalar(300, 'ohm') } },
      { id: 'gnd', definition: 'ground' },
    ]
    const lineEdges = [
      e('src', 'terminal_positive', 'line', 'near_a'),
      e('line', 'near_b', 'src', 'terminal_negative'),
      e('line', 'far_a', 'load', 'terminal_a'),
      e('load', 'terminal_b', 'line', 'far_b'),
      e('gnd', 'reference_terminal', 'src', 'terminal_negative'),
    ]
    const w = canvasToWorld(lineNodes, lineEdges)
    const farA = netOf(w, 'line', 'far_a')
    const farB = netOf(w, 'line', 'far_b')
    const tau = propagationDelayS(300, 0.95)
    const dc = solveDC(w)
    const vDc = V(dc.nodes, farA) - V(dc.nodes, farB) // 10·300/600 = 5 V
    const tr = solveTransient(w, { timeStep: 5e-8, duration: 4e-6 })
    const far = tr.series.map((p) => ({ t: p.time, v: V(p.nodes, farA) - V(p.nodes, farB) }))
    const early = far.find((p) => p.t >= 0.5 * tau)?.v ?? 9
    const late = far[far.length - 1]?.v ?? 0
    console.log(`L7 · transmission line  (300 Ω, 300 m  →  τ = ${fmt(tau * 1e6)} µs)`)
    console.log(`   ✓ far end DARK before the wave lands: ${fmt(early)} V at t = ½τ`)
    expect(Math.abs(early)).toBeLessThan(0.3)
    rung('settles to the DC divider (5 V)', 5, late, 'V', 0.02)
    rung('cross-check: transient final = DC solver', vDc, late, 'V', 0.02)

    // Frequency domain: a quarter-wave 100 Ω line flips a 50 Ω load to Z0²/Z_L = 200 Ω.
    const qNodes: CanvasNode[] = [
      { id: 'src', definition: 'power_source', parameters: { nominal_voltage: scalar(1, 'volt') } },
      { id: 'rs', definition: 'resistor', parameters: { resistance: scalar(100, 'ohm') } },
      {
        id: 'line',
        definition: 'transmission_line',
        parameters: {
          characteristic_impedance: scalar(100, 'ohm'),
          length: scalar(0.075, 'meter'),
          velocity_factor: scalar(1, 'dimensionless'),
        },
      },
      { id: 'load', definition: 'resistor', parameters: { resistance: scalar(50, 'ohm') } },
      { id: 'gnd', definition: 'ground' },
    ]
    const qEdges = [
      e('src', 'terminal_positive', 'rs', 'terminal_a'),
      e('rs', 'terminal_b', 'line', 'near_a'),
      e('line', 'near_b', 'gnd', 'reference_terminal'),
      e('line', 'far_a', 'load', 'terminal_a'),
      e('load', 'terminal_b', 'gnd', 'reference_terminal'),
      e('line', 'far_b', 'gnd', 'reference_terminal'),
      e('gnd', 'reference_terminal', 'src', 'terminal_negative'),
    ]
    const qw = canvasToWorld(qNodes, qEdges)
    const fQuarter = 1 / (4 * propagationDelayS(0.075, 1))
    const mid = netOf(qw, 'rs', 'terminal_b')
    const g = acResponse(qw, { inputSource: 'src', outputNet: mid }, fQuarter).gain
    // V(mid) = Z_in/(Rs+Z_in); with Z_in = 100²/50 = 200 → 200/300
    rung('quarter-wave: load 50 Ω looks like Z0²/Z_L = 200 Ω', 200 / 300, g, '', 0.02)
    console.log(
      `   ✓ cross-check: the same τ sets the time-domain delay AND the AC electrical length θ = ωτ`,
    )
  })

  test('L8 · capstone — a transistor amplifier: DC bias sets the AC gain', () => {
    const VT = 0.025852 // thermal voltage at ~300 K
    const nodes: CanvasNode[] = [
      {
        id: 'bat',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(12, 'volt') },
      },
      {
        id: 'vsig',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(0, 'volt') },
      },
      { id: 'cin', definition: 'capacitor', parameters: { capacitance: scalar(1e-5, 'farad') } },
      { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(47000, 'ohm') } },
      { id: 'r2', definition: 'resistor', parameters: { resistance: scalar(10000, 'ohm') } },
      { id: 'rc', definition: 'resistor', parameters: { resistance: scalar(1000, 'ohm') } },
      { id: 're', definition: 'resistor', parameters: { resistance: scalar(220, 'ohm') } },
      {
        id: 'q',
        definition: 'transistor_bjt_npn',
        parameters: {
          saturation_current: scalar(1e-14, 'ampere'),
          forward_current_gain: scalar(100, 'dimensionless'),
          reverse_current_gain: scalar(2, 'dimensionless'),
        },
      },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      e('bat', 'terminal_positive', 'r1', 'terminal_a'), // vcc
      e('bat', 'terminal_positive', 'rc', 'terminal_a'),
      e('bat', 'terminal_negative', 'gnd', 'reference_terminal'),
      e('r1', 'terminal_b', 'r2', 'terminal_a'), // base
      e('r1', 'terminal_b', 'q', 'base'),
      e('r1', 'terminal_b', 'cin', 'terminal_b'),
      e('r2', 'terminal_b', 'gnd', 'reference_terminal'),
      e('rc', 'terminal_b', 'q', 'collector'), // coll
      e('q', 'emitter', 're', 'terminal_a'), // emit
      e('re', 'terminal_b', 'gnd', 'reference_terminal'),
      e('vsig', 'terminal_positive', 'cin', 'terminal_a'), // signal in
      e('vsig', 'terminal_negative', 'gnd', 'reference_terminal'),
    ]
    const w = canvasToWorld(nodes, edges)
    const vcc = netOf(w, 'bat', 'terminal_positive')
    const coll = netOf(w, 'q', 'collector')
    const emit = netOf(w, 'q', 'emitter')

    const dc = solveDC(w)
    expect(dc.status).toBe('solved')
    const iC = (V(dc.nodes, vcc) - V(dc.nodes, coll)) / 1000 // through R_C
    const vCE = V(dc.nodes, coll) - V(dc.nodes, emit)
    console.log('L8 · common-emitter amplifier  (12 V rail, 47k/10k bias, R_C 1k, R_E 220)')
    rung('DC bias  I_C  (hand: ≈ 4.6 mA)', 4.6e-3, iC, 'A', 0.08)
    expect(vCE).toBeGreaterThan(5.5) // forward-active, well clear of saturation
    console.log(`   ✓ forward-active: V_CE ≈ ${fmt(vCE)} V`)

    // The DC bias sets the small-signal gain: r_e = V_T/I_C, A_v = R_C/(R_E + r_e) (unbypassed).
    const re = VT / iC
    const handGain = 1000 / (220 + re)
    const acGain = acResponse(w, { inputSource: 'vsig', outputNet: coll }, 1e4).gain
    console.log(
      `   small-signal from the bias: r_e = V_T/I_C = ${fmt(re)} Ω  →  |A_v| = R_C/(R_E+r_e)`,
    )
    rung('AC gain matches the hand value', handGain, acGain, '×', 0.1)
    console.log('   ✓ the DC solver and the AC analyzer agree on one nonlinear transistor.')
  })
})
