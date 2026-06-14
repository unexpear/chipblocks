/**
 * Op-amp from real transistors (Sprint 22), increment 1 — the differential pair,
 * the input stage every op-amp is built on. Two matched NPNs share a tail current
 * set by Rtail to the −9 V rail; each collector has its own load to +9 V. The whole
 * point of the pair is in three numbers the solver must produce from the device
 * physics alone:
 *
 *   • balanced bias — equal input → equal collector voltages, both in the active
 *     region (the operating point a real pair self-finds);
 *   • differential gain — a tiny difference between the inputs swings the collectors
 *     hard and oppositely (this is the amplification);
 *   • common-mode rejection — moving BOTH inputs together barely moves the collectors
 *     (this is what lets the next stages ignore noise common to both inputs).
 *
 * Solved through solveDCRobust — the same path the full op-amp will use.
 */

import { describe, expect, test } from 'vitest'
import type { World } from '../src/cross-fk-validator.ts'
import { solveDCRobust } from '../src/dc-robust.ts'
import { solveDC } from '../src/dc-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const NPN = (beta: number) => ({
  saturation_current: scalar(1e-14, 'ampere'),
  forward_current_gain: scalar(beta, 'dimensionless'),
  reverse_current_gain: scalar(2, 'dimensionless'),
})

/**
 * NPN long-tailed pair on ±9 V rails. Q1/Q2 emitters tie to `tail`; Rtail(8.2k) sets
 * ~1 mA total down to −9 V; Rc1/Rc2(9.1k) load each collector from +9 V. The bases are
 * driven by ideal sources at vin1/vin2 (0 V is the balanced bias point).
 */
function diffPair(vin1: number, vin2: number): World {
  const world: World = {
    definitions: new Map(),
    instances: new Map(),
    behaviors: new Map(),
    activeVariables: new Map(),
    nets: new Map(),
  }
  const net = (id: string, members: { instance: string; terminal: string }[], ground = false) =>
    world.nets.set(id, { id, kind: 'net', ...(ground ? { type: 'ground' as const } : {}), members })

  net(
    'gnd',
    [
      { instance: 'vpos_src', terminal: 'terminal_negative' },
      { instance: 'vneg_src', terminal: 'terminal_positive' },
      { instance: 'vin1_src', terminal: 'terminal_negative' },
      { instance: 'vin2_src', terminal: 'terminal_negative' },
    ],
    true,
  )
  net('vpos', [
    { instance: 'vpos_src', terminal: 'terminal_positive' },
    { instance: 'rc1', terminal: 'terminal_a' },
    { instance: 'rc2', terminal: 'terminal_a' },
  ])
  net('vneg', [
    { instance: 'vneg_src', terminal: 'terminal_negative' },
    { instance: 'rtail', terminal: 'terminal_b' },
  ])
  net('base1', [
    { instance: 'vin1_src', terminal: 'terminal_positive' },
    { instance: 'q1', terminal: 'base' },
  ])
  net('base2', [
    { instance: 'vin2_src', terminal: 'terminal_positive' },
    { instance: 'q2', terminal: 'base' },
  ])
  net('tail', [
    { instance: 'rtail', terminal: 'terminal_a' },
    { instance: 'q1', terminal: 'emitter' },
    { instance: 'q2', terminal: 'emitter' },
  ])
  net('c1', [
    { instance: 'rc1', terminal: 'terminal_b' },
    { instance: 'q1', terminal: 'collector' },
  ])
  net('c2', [
    { instance: 'rc2', terminal: 'terminal_b' },
    { instance: 'q2', terminal: 'collector' },
  ])

  const part = (
    id: string,
    definition: string,
    parameters: Record<string, ReturnType<typeof scalar>>,
    connects: { net: string; terminal: string }[],
  ) =>
    world.instances.set(id, {
      id,
      kind_ref: 'primitive_device',
      definition,
      parameters,
      connects: connects.map((c) => ({ ...c, of: id })),
    })

  part('vpos_src', 'power_source', { nominal_voltage: scalar(9, 'volt') }, [
    { net: 'vpos', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  part('vneg_src', 'power_source', { nominal_voltage: scalar(9, 'volt') }, [
    { net: 'gnd', terminal: 'terminal_positive' },
    { net: 'vneg', terminal: 'terminal_negative' },
  ])
  part('vin1_src', 'power_source', { nominal_voltage: scalar(vin1, 'volt') }, [
    { net: 'base1', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  part('vin2_src', 'power_source', { nominal_voltage: scalar(vin2, 'volt') }, [
    { net: 'base2', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  part('rtail', 'resistor', { resistance: scalar(8200, 'ohm') }, [
    { net: 'tail', terminal: 'terminal_a' },
    { net: 'vneg', terminal: 'terminal_b' },
  ])
  part('rc1', 'resistor', { resistance: scalar(9100, 'ohm') }, [
    { net: 'vpos', terminal: 'terminal_a' },
    { net: 'c1', terminal: 'terminal_b' },
  ])
  part('rc2', 'resistor', { resistance: scalar(9100, 'ohm') }, [
    { net: 'vpos', terminal: 'terminal_a' },
    { net: 'c2', terminal: 'terminal_b' },
  ])
  part('q1', 'transistor_bjt_npn', NPN(150), [
    { net: 'c1', terminal: 'collector' },
    { net: 'base1', terminal: 'base' },
    { net: 'tail', terminal: 'emitter' },
  ])
  part('q2', 'transistor_bjt_npn', NPN(150), [
    { net: 'c2', terminal: 'collector' },
    { net: 'base2', terminal: 'base' },
    { net: 'tail', terminal: 'emitter' },
  ])
  return world
}

const vc1 = (vin1: number, vin2: number) =>
  solveDCRobust(diffPair(vin1, vin2)).nodes.get('c1') ?? Number.NaN
const vc2 = (vin1: number, vin2: number) =>
  solveDCRobust(diffPair(vin1, vin2)).nodes.get('c2') ?? Number.NaN

describe('op-amp input stage — the NPN differential pair', () => {
  test('balanced bias: equal inputs → equal collectors, both in the active region', () => {
    const sol = solveDCRobust(diffPair(0, 0))
    expect(sol.status).toBe('solved')
    const c1 = sol.nodes.get('c1') ?? Number.NaN
    const c2 = sol.nodes.get('c2') ?? Number.NaN
    const tail = sol.nodes.get('tail') ?? Number.NaN

    // Matched halves carry equal current → equal collector voltage.
    expect(c1).toBeCloseTo(c2, 6)
    // Active region, biased near mid-rail by design (~4.4 V on ±9 V): a gross bias
    // regression would move this far, while leaving room for device-model refinement.
    expect(c1).toBeGreaterThan(3.5)
    expect(c1).toBeLessThan(5.5)
    // The tail sits ~one Vbe below the 0 V bases.
    expect(tail).toBeGreaterThan(-0.8)
    expect(tail).toBeLessThan(-0.5)
  })

  test('differential gain: a 1 mV difference swings the collectors hard and oppositely', () => {
    const d = 1e-3
    // Drive the inputs apart by ±d and measure how far c1 moves.
    const c1Plus = vc1(+d, -d) // Q1 conducts more → c1 pulled down
    const c1Minus = vc1(-d, +d) // Q1 conducts less → c1 rises
    const gain = (c1Minus - c1Plus) / (2 * d)
    expect(gain).toBeGreaterThan(50) // real amplification, not a passive divider

    // The two collectors move in opposite directions — the differential signature.
    expect(vc1(+d, -d)).toBeLessThan(vc2(+d, -d))
    expect(vc1(-d, +d)).toBeGreaterThan(vc2(-d, +d))
  })

  test('common-mode rejection: moving both inputs together barely moves the collectors', () => {
    const d = 1e-3
    const balanced = vc1(0, 0)
    const commonMode = vc1(10e-3, 10e-3) // both inputs up 10 mV together
    const aCommon = Math.abs(commonMode - balanced) / 10e-3

    // The differential gain, measured the same way, for the ratio.
    const aDiff = Math.abs(vc1(-d, +d) - vc1(+d, -d)) / (2 * d)

    expect(aCommon).toBeLessThan(2) // common-mode is strongly attenuated
    expect(aDiff / aCommon).toBeGreaterThan(30) // CMRR — differential wins by ≥30×
  })
})

/** A BJT parameter set WITH a finite forward Early voltage — required for the mirror
 *  load, whose high-impedance output node is set by the finite device output
 *  resistance (V_AF = ∞ would leave it indeterminate). V_AF cited from the standard
 *  2N3904 (74 V) and 2N3906 (18.7 V) SPICE models. */
const bjt = (beta: number, vafVolts: number) => ({
  saturation_current: scalar(1e-14, 'ampere'),
  forward_current_gain: scalar(beta, 'dimensionless'),
  reverse_current_gain: scalar(2, 'dimensionless'),
  forward_early_voltage: scalar(vafVolts, 'volt'),
})

/**
 * The same NPN pair, now with a PNP current-mirror load instead of two resistors.
 * Q3 (diode-connected) and Q4 sit across +9 V; Q3 carries Q1's current and Q4 mirrors
 * it into the output node `out` (= Q2's collector). The output current is therefore
 * I_Q4 − I_Q2 = I_Q1 − I_Q2 — the two halves are differenced onto ONE high-impedance
 * wire. Its DC level is set by the Early-effect output resistance, not a resistor.
 */
function mirrorLoadedPair(vin1: number, vin2: number): World {
  const world: World = {
    definitions: new Map(),
    instances: new Map(),
    behaviors: new Map(),
    activeVariables: new Map(),
    nets: new Map(),
  }
  const net = (id: string, members: { instance: string; terminal: string }[], ground = false) =>
    world.nets.set(id, { id, kind: 'net', ...(ground ? { type: 'ground' as const } : {}), members })

  net(
    'gnd',
    [
      { instance: 'vpos_src', terminal: 'terminal_negative' },
      { instance: 'vneg_src', terminal: 'terminal_positive' },
      { instance: 'vin1_src', terminal: 'terminal_negative' },
      { instance: 'vin2_src', terminal: 'terminal_negative' },
    ],
    true,
  )
  net('vpos', [
    { instance: 'vpos_src', terminal: 'terminal_positive' },
    { instance: 'q3', terminal: 'emitter' },
    { instance: 'q4', terminal: 'emitter' },
  ])
  net('vneg', [
    { instance: 'vneg_src', terminal: 'terminal_negative' },
    { instance: 'rtail', terminal: 'terminal_b' },
  ])
  net('base1', [
    { instance: 'vin1_src', terminal: 'terminal_positive' },
    { instance: 'q1', terminal: 'base' },
  ])
  net('base2', [
    { instance: 'vin2_src', terminal: 'terminal_positive' },
    { instance: 'q2', terminal: 'base' },
  ])
  net('tail', [
    { instance: 'rtail', terminal: 'terminal_a' },
    { instance: 'q1', terminal: 'emitter' },
    { instance: 'q2', terminal: 'emitter' },
  ])
  // The mirror's diode node: Q1's collector meets Q3 (diode-connected: base = collector)
  // and feeds Q4's base.
  net('mirror', [
    { instance: 'q1', terminal: 'collector' },
    { instance: 'q3', terminal: 'collector' },
    { instance: 'q3', terminal: 'base' },
    { instance: 'q4', terminal: 'base' },
  ])
  // The single-ended high-impedance output: Q2's collector against Q4's mirrored current.
  net('out', [
    { instance: 'q2', terminal: 'collector' },
    { instance: 'q4', terminal: 'collector' },
  ])

  const part = (
    id: string,
    definition: string,
    parameters: Record<string, ReturnType<typeof scalar>>,
    connects: { net: string; terminal: string }[],
  ) =>
    world.instances.set(id, {
      id,
      kind_ref: 'primitive_device',
      definition,
      parameters,
      connects: connects.map((c) => ({ ...c, of: id })),
    })

  part('vpos_src', 'power_source', { nominal_voltage: scalar(9, 'volt') }, [
    { net: 'vpos', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  part('vneg_src', 'power_source', { nominal_voltage: scalar(9, 'volt') }, [
    { net: 'gnd', terminal: 'terminal_positive' },
    { net: 'vneg', terminal: 'terminal_negative' },
  ])
  part('vin1_src', 'power_source', { nominal_voltage: scalar(vin1, 'volt') }, [
    { net: 'base1', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  part('vin2_src', 'power_source', { nominal_voltage: scalar(vin2, 'volt') }, [
    { net: 'base2', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  part('rtail', 'resistor', { resistance: scalar(8200, 'ohm') }, [
    { net: 'tail', terminal: 'terminal_a' },
    { net: 'vneg', terminal: 'terminal_b' },
  ])
  part('q1', 'transistor_bjt_npn', bjt(150, 74), [
    { net: 'mirror', terminal: 'collector' },
    { net: 'base1', terminal: 'base' },
    { net: 'tail', terminal: 'emitter' },
  ])
  part('q2', 'transistor_bjt_npn', bjt(150, 74), [
    { net: 'out', terminal: 'collector' },
    { net: 'base2', terminal: 'base' },
    { net: 'tail', terminal: 'emitter' },
  ])
  part('q3', 'transistor_bjt_pnp', bjt(150, 18.7), [
    { net: 'mirror', terminal: 'collector' },
    { net: 'mirror', terminal: 'base' },
    { net: 'vpos', terminal: 'emitter' },
  ])
  part('q4', 'transistor_bjt_pnp', bjt(150, 18.7), [
    { net: 'out', terminal: 'collector' },
    { net: 'mirror', terminal: 'base' },
    { net: 'vpos', terminal: 'emitter' },
  ])
  return world
}

const vout = (vin1: number, vin2: number) =>
  solveDCRobust(mirrorLoadedPair(vin1, vin2)).nodes.get('out') ?? Number.NaN

describe('op-amp input stage — the current-mirror load', () => {
  test('biases: solves, the mirror copies the current, the output is high-Z and active', () => {
    const sol = solveDCRobust(mirrorLoadedPair(0, 0))
    expect(sol.status).toBe('solved')

    // The mirror copies Q1's current to the output side: |I_Q4| ≈ |I_Q1|.
    const iQ1 = Math.abs(sol.branches.get('q1') ?? Number.NaN)
    const iQ4 = Math.abs(sol.branches.get('q4') ?? Number.NaN)
    expect(iQ4 / iQ1).toBeGreaterThan(0.9)
    expect(iQ4 / iQ1).toBeLessThan(1.1)

    // The single-ended output sits between the rails (active), set by the Early-effect
    // output resistance — a high-impedance node, so it floats high here, not at mid-rail.
    const out = sol.nodes.get('out') ?? Number.NaN
    expect(out).toBeGreaterThan(1)
    expect(out).toBeLessThan(8.85)
  })

  test('gain: the mirror load delivers far higher single-ended gain than resistors', () => {
    // Measured the same way on both stages (single-ended output, differential drive).
    const dm = 1e-4 // small input — the mirror gain is high enough to rail on a few mV
    const mirrorGain = Math.abs((vout(-dm, +dm) - vout(+dm, -dm)) / (2 * dm))
    const dr = 1e-3
    const resistorGain = Math.abs((vc1(-dr, +dr) - vc1(+dr, -dr)) / (2 * dr))

    expect(mirrorGain).toBeGreaterThan(500) // ~1200 in practice
    expect(mirrorGain).toBeGreaterThan(3 * resistorGain) // the mirror's gain boost is real
  })

  test('robust always solves it, and agrees with the direct solve whenever that converges', () => {
    const robust = solveDCRobust(mirrorLoadedPair(0, 0))
    expect(robust.status).toBe('solved')

    // Whether or not the direct Newton can bias this high-impedance node from cold,
    // the robust path must land on the same operating point when it does. (Today the
    // direct solve handles this one in ~5 iterations, so robust just passes it through;
    // the ramp is insurance for the harder circuits still ahead.)
    const direct = solveDC(mirrorLoadedPair(0, 0))
    if (direct.status === 'solved') {
      expect(direct.nodes.get('out') ?? Number.NaN).toBeCloseTo(
        robust.nodes.get('out') ?? Number.NaN,
        4,
      )
    }
  })
})

// A compact World accumulator — addPart registers each pin into both the instance's
// connects and its net's members, so a builder just lists parts, no net bookkeeping.
function makeWorld(): World {
  return {
    definitions: new Map(),
    instances: new Map(),
    behaviors: new Map(),
    activeVariables: new Map(),
    nets: new Map(),
  }
}
function ensureNet(world: World, id: string, ground = false) {
  if (!world.nets.has(id)) {
    world.nets.set(id, {
      id,
      kind: 'net',
      ...(ground ? { type: 'ground' as const } : {}),
      members: [],
    })
  }
}
function addPart(
  world: World,
  id: string,
  definition: string,
  parameters: Record<string, ReturnType<typeof scalar>>,
  pins: { net: string; terminal: string }[],
) {
  world.instances.set(id, {
    id,
    kind_ref: 'primitive_device',
    definition,
    parameters,
    connects: pins.map((p) => ({ net: p.net, terminal: p.terminal, of: id })),
  })
  for (const p of pins) {
    ensureNet(world, p.net)
    world.nets.get(p.net)?.members.push({ instance: id, terminal: p.terminal })
  }
}

/**
 * Two-stage op-amp: the mirror-loaded NPN pair (stage 1) driving a PNP common-
 * emitter gain stage (stage 2). The first stage's high-impedance output sits near
 * the +rail — exactly the level to bias a PNP stage 2 whose emitter is on +9 V. Q5's
 * collector is the op-amp output, loaded by Rout to the −rail. No Miller cap yet
 * (it is open at DC anyway; it belongs to the AC/stability increment).
 *
 * Overall polarity: vin2 is the non-inverting input (+), vin1 the inverting (−).
 */
function twoStageOpAmp(vin1: number, vin2: number): World {
  const w = makeWorld()
  ensureNet(w, 'gnd', true)
  const v9 = { nominal_voltage: scalar(9, 'volt') }
  addPart(w, 'vpos_src', 'power_source', v9, [
    { net: 'vpos', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  addPart(w, 'vneg_src', 'power_source', v9, [
    { net: 'gnd', terminal: 'terminal_positive' },
    { net: 'vneg', terminal: 'terminal_negative' },
  ])
  addPart(w, 'vin1_src', 'power_source', { nominal_voltage: scalar(vin1, 'volt') }, [
    { net: 'base1', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  addPart(w, 'vin2_src', 'power_source', { nominal_voltage: scalar(vin2, 'volt') }, [
    { net: 'base2', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  // Stage 1 — NPN pair, tail, PNP mirror load. Interstage output on `stage1`.
  addPart(w, 'rtail', 'resistor', { resistance: scalar(8200, 'ohm') }, [
    { net: 'tail', terminal: 'terminal_a' },
    { net: 'vneg', terminal: 'terminal_b' },
  ])
  addPart(w, 'q1', 'transistor_bjt_npn', bjt(150, 74), [
    { net: 'mirror', terminal: 'collector' },
    { net: 'base1', terminal: 'base' },
    { net: 'tail', terminal: 'emitter' },
  ])
  addPart(w, 'q2', 'transistor_bjt_npn', bjt(150, 74), [
    { net: 'stage1', terminal: 'collector' },
    { net: 'base2', terminal: 'base' },
    { net: 'tail', terminal: 'emitter' },
  ])
  addPart(w, 'q3', 'transistor_bjt_pnp', bjt(150, 18.7), [
    { net: 'mirror', terminal: 'collector' },
    { net: 'mirror', terminal: 'base' },
    { net: 'vpos', terminal: 'emitter' },
  ])
  addPart(w, 'q4', 'transistor_bjt_pnp', bjt(150, 18.7), [
    { net: 'stage1', terminal: 'collector' },
    { net: 'mirror', terminal: 'base' },
    { net: 'vpos', terminal: 'emitter' },
  ])
  // Stage 2 — PNP common-emitter: base = stage-1 output, collector = op-amp output.
  addPart(w, 'q5', 'transistor_bjt_pnp', bjt(150, 18.7), [
    { net: 'vout', terminal: 'collector' },
    { net: 'stage1', terminal: 'base' },
    { net: 'vpos', terminal: 'emitter' },
  ])
  addPart(w, 'rout', 'resistor', { resistance: scalar(18000, 'ohm') }, [
    { net: 'vout', terminal: 'terminal_a' },
    { net: 'vneg', terminal: 'terminal_b' },
  ])
  return w
}

/** Op-amp output for a differential input vid, applied symmetrically (+vid/2 to the
 *  inverting input, −vid/2 to the non-inverting). */
const vout2 = (vid: number) =>
  solveDCRobust(twoStageOpAmp(vid / 2, -vid / 2)).nodes.get('vout') ?? Number.NaN

/** Binary-search the differential input that puts the output at mid-rail (0 V) — the
 *  op-amp's input offset voltage, and the linear point to measure open-loop gain at. */
function findInputOffset(): number {
  let lo = -1e-3 // vout(lo) railed high (> 0)
  let hi = 1e-3 // vout(hi) railed low (< 0)
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (vout2(mid) > 0) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

describe('op-amp — two stages, open loop', () => {
  test('biases into the active region and the second stage runs a sane current', () => {
    const sol = solveDCRobust(twoStageOpAmp(0, 0))
    expect(sol.status).toBe('solved')

    // Interstage node sits near the +rail, biasing the PNP second stage.
    const stage1 = sol.nodes.get('stage1') ?? Number.NaN
    expect(stage1).toBeGreaterThan(7.5)
    expect(stage1).toBeLessThan(8.85)

    // Stage 2 draws a real, sane current (~1 mA) — not slammed to amps, not cut off.
    const iQ5 = Math.abs(sol.branches.get('q5') ?? Number.NaN)
    expect(iQ5).toBeGreaterThan(1e-4)
    expect(iQ5).toBeLessThan(5e-3)
  })

  test('high gain: a tiny input swings the output rail to rail', () => {
    // A few mV either way is enough to drive the output hard into each rail.
    expect(vout2(-5e-3)).toBeGreaterThan(8)
    expect(vout2(+5e-3)).toBeLessThan(-8)
  })

  test('open-loop gain reaches the tens of thousands', () => {
    const offset = findInputOffset()
    expect(Math.abs(offset)).toBeLessThan(2e-3) // sub-2 mV input offset

    // Slope of the transfer curve at mid-rail — the open-loop gain A_OL.
    const d = 1e-6
    const gain = Math.abs((vout2(offset + d) - vout2(offset - d)) / (2 * d))
    expect(gain).toBeGreaterThan(10000) // ~25,000 here — the 2nd stage multiplied it up
  })

  test('robust solves the whole op-amp, agreeing with the direct solve when it converges', () => {
    const robust = solveDCRobust(twoStageOpAmp(0, 0))
    expect(robust.status).toBe('solved')

    // The predicted convergence wall has not appeared: even the full op-amp solves
    // directly in ~5 iterations, so robust passes it through. The ramp stays as
    // insurance for the harder circuits (closed-loop, CMOS, latches) still ahead.
    const direct = solveDC(twoStageOpAmp(0, 0))
    if (direct.status === 'solved') {
      expect(direct.nodes.get('stage1') ?? Number.NaN).toBeCloseTo(
        robust.nodes.get('stage1') ?? Number.NaN,
        3,
      )
    }
  })
})
