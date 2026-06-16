/**
 * JFET model tests — the depletion-mode square law (mapped onto the verified MOSFET core) and
 * its solver integration. The defining JFET behavior: it CONDUCTS at V_GS = 0 (I_DSS) and
 * pinches OFF as V_GS reaches V_P — the opposite of an enhancement MOSFET, which is off at 0.
 * Derivatives are checked against finite differences (the Newton-Raphson loop trusts them).
 */

import { describe, expect, test } from 'vitest'
import type { World } from '../src/cross-fk-validator.ts'
import { solveDC } from '../src/dc-solver.ts'
import { type JfetParams, jfetOperatingPoint } from '../src/jfet-model.ts'

// 2N5457-class N-JFET: V_P = −2 V, β = 1 mA/V² → I_DSS = β·V_P² = 4 mA.
const NJFET: JfetParams = {
  channel: 'n_channel',
  pinchOffVoltage: -2,
  transconductance: 1e-3,
  channelLengthModulation: 0,
}
// P-JFET mirror: V_P = +2 V, β = 0.5 mA/V² → |I_DSS| = 2 mA.
const PJFET: JfetParams = {
  channel: 'p_channel',
  pinchOffVoltage: 2,
  transconductance: 5e-4,
  channelLengthModulation: 0,
}

/** Centered finite difference of I_D against the analytic gm / gds. */
function checkDerivatives(vGS: number, vDS: number, params: JfetParams) {
  const h = 1e-6
  const point = jfetOperatingPoint(vGS, vDS, params)
  const dGS =
    (jfetOperatingPoint(vGS + h, vDS, params).iD - jfetOperatingPoint(vGS - h, vDS, params).iD) /
    (2 * h)
  const dDS =
    (jfetOperatingPoint(vGS, vDS + h, params).iD - jfetOperatingPoint(vGS, vDS - h, params).iD) /
    (2 * h)
  expect(Math.abs(point.gm - dGS)).toBeLessThan(1e-6)
  expect(Math.abs(point.gds - dDS)).toBeLessThan(1e-6)
}

describe('JFET square law (depletion mode)', () => {
  test('conducts I_DSS = β·V_P² at V_GS = 0 — the defining depletion behavior', () => {
    const point = jfetOperatingPoint(0, 5, NJFET) // V_GS = 0, well into saturation
    expect(point.region).toBe('saturation')
    expect(point.iD).toBeCloseTo(0.004, 9) // β·V_P² = 1e-3 · 2² = 4 mA
  })

  test('pinches off at V_GS = V_P (essentially no current)', () => {
    const point = jfetOperatingPoint(-2, 5, NJFET) // V_GS = V_P
    expect(point.region).toBe('cutoff')
    expect(Math.abs(point.iD)).toBeLessThan(1e-9)
  })

  test('the gate controls the channel between full-on and pinch-off', () => {
    // V_GS = −1 → V_OV = 1 → I_D = β·V_OV² = 1 mA (a quarter of I_DSS, four times less).
    const half = jfetOperatingPoint(-1, 5, NJFET)
    expect(half.iD).toBeCloseTo(0.001, 9)
    expect(half.iD).toBeLessThan(jfetOperatingPoint(0, 5, NJFET).iD) // less than at V_GS = 0
  })

  test('a P-channel JFET is the mirror — conducts at V_GS = 0, current source→drain (negative)', () => {
    const point = jfetOperatingPoint(0, -5, PJFET)
    expect(point.iD).toBeCloseTo(-0.002, 9) // −β·V_P² = −2 mA, flowing out the drain
    expect(jfetOperatingPoint(2, -5, PJFET).region).toBe('cutoff') // V_GS = V_P → off
  })

  test('derivatives match finite differences in every region and channel', () => {
    const n: JfetParams = { ...NJFET, channelLengthModulation: 0.02 }
    checkDerivatives(0, 5, n) // saturation (V_GS = 0)
    checkDerivatives(-0.5, 0.4, n) // triode
    checkDerivatives(-3, 5, n) // cutoff (below V_P)
    const p: JfetParams = { ...PJFET, channelLengthModulation: 0.02 }
    checkDerivatives(0, -5, p) // PJFET saturation
    checkDerivatives(-0.5, -0.4, p) // PJFET triode
  })
})

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

/**
 * Common-source N-JFET: V+(9) → Rd(1k) → drain, source → GND, gate driven to `vGate`. Returns
 * the solved drain current (through Rd). Exercises the JFET through the real DC solver, proving
 * resolveJfet + the shared MOSFET companion path work end to end.
 */
function jfetDrainCurrent(vGate: number): number {
  const world: World = {
    definitions: new Map(),
    instances: new Map(),
    behaviors: new Map(),
    activeVariables: new Map(),
    nets: new Map(),
  }
  world.nets.set('vcc', {
    id: 'vcc',
    kind: 'net',
    members: [
      { instance: 'bat', terminal: 'terminal_positive' },
      { instance: 'rd', terminal: 'terminal_a' },
    ],
  })
  world.nets.set('drain', {
    id: 'drain',
    kind: 'net',
    members: [
      { instance: 'rd', terminal: 'terminal_b' },
      { instance: 'q1', terminal: 'drain' },
    ],
  })
  world.nets.set('gate', {
    id: 'gate',
    kind: 'net',
    members: [
      { instance: 'q1', terminal: 'gate' },
      { instance: 'vgg', terminal: 'terminal_positive' },
    ],
  })
  world.nets.set('gnd', {
    id: 'gnd',
    kind: 'net',
    type: 'ground',
    members: [
      { instance: 'bat', terminal: 'terminal_negative' },
      { instance: 'q1', terminal: 'source' },
      { instance: 'vgg', terminal: 'terminal_negative' },
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
  world.instances.set('vgg', {
    id: 'vgg',
    kind_ref: 'primitive_device',
    definition: 'power_source',
    parameters: { nominal_voltage: scalar(vGate, 'volt') },
    connects: [
      { net: 'gate', terminal: 'terminal_positive', of: 'vgg' },
      { net: 'gnd', terminal: 'terminal_negative', of: 'vgg' },
    ],
  })
  world.instances.set('rd', {
    id: 'rd',
    kind_ref: 'primitive_device',
    definition: 'resistor',
    parameters: { resistance: scalar(1000, 'ohm') },
    connects: [
      { net: 'vcc', terminal: 'terminal_a', of: 'rd' },
      { net: 'drain', terminal: 'terminal_b', of: 'rd' },
    ],
  })
  world.instances.set('q1', {
    id: 'q1',
    kind_ref: 'primitive_device',
    definition: 'transistor_jfet_n_channel',
    parameters: {
      pinch_off_voltage: scalar(-2, 'volt'),
      transconductance: scalar(1e-3, 'ampere_per_volt_squared'),
      channel_length_modulation: scalar(0, 'per_volt'),
    },
    connects: [
      { net: 'drain', terminal: 'drain', of: 'q1' },
      { net: 'gate', terminal: 'gate', of: 'q1' },
      { net: 'gnd', terminal: 'source', of: 'q1' },
    ],
  })
  const sol = solveDC(world)
  return Math.abs(sol.branches.get('rd') ?? Number.NaN)
}

describe('solveDC — N-JFET common source (resolveJfet through the MOSFET companion)', () => {
  test('V_GS = 0 conducts ~I_DSS (4 mA); V_GS past pinch-off is off', () => {
    expect(jfetDrainCurrent(0)).toBeCloseTo(0.004, 3) // ~I_DSS, in saturation (drain at ~5 V)
    expect(jfetDrainCurrent(-3)).toBeLessThan(1e-4) // V_GS = −3 < V_P = −2 → cut off
  })
})
