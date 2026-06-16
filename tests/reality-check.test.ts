/**
 * Reality-check capstone — a full textbook circuit solved end-to-end and compared
 * against an INDEPENDENT hand calculation, not against the solver's own output.
 *
 * Circuit: the classic 4-resistor voltage-divider-bias common-emitter amplifier
 * (Sedra & Smith; Razavi; every intro analog course), with a 2N3904-class NPN.
 *
 *   Vcc = 12 V
 *   R1 = 47 kΩ  (Vcc → base)      R2 = 10 kΩ (base → gnd)   ← bias divider
 *   RC = 1 kΩ   (Vcc → collector) RE = 220 Ω (emitter → gnd)
 *   Q1: I_S = 1e-14 A, β = 100
 *
 * Textbook divider-bias hand analysis (the independent ground truth):
 *   V_BB = Vcc·R2/(R1+R2) = 12·10/57           = 2.105 V
 *   R_BB = R1‖R2          = 47·10/57 kΩ         = 8.246 kΩ
 *   I_B  = (V_BB − V_BE) / (R_BB + (β+1)·RE)
 *        = (2.105 − 0.7) / (8246 + 101·220)     = 46.1 µA
 *   I_C  = β·I_B                                = 4.61 mA
 *   I_E  = (β+1)·I_B                            = 4.66 mA
 *   V_E  = I_E·RE   = 4.66m·220                 = 1.03 V
 *   V_C  = Vcc − I_C·RC = 12 − 4.61            = 7.39 V
 *   V_CE = V_C − V_E                            = 6.36 V   → forward-active
 *
 * The solver computes V_BE exactly from Shockley (≈ 0.69 V at this current, vs the
 * 0.7 V textbook rule of thumb), so its Q-point lands within ~2 % of the hand calc.
 * The bands below are centered on the hand values with margin for that difference;
 * if the full stack (catalog params → MNA + Newton-Raphson → node/branch results)
 * is right, every reading falls inside them.
 */

import { describe, expect, test } from 'vitest'
import type { World } from '../src/cross-fk-validator.ts'
import { solveDC } from '../src/dc-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

function dividerBiasAmplifier(): World {
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
      { instance: 'r1', terminal: 'terminal_a' },
      { instance: 'rc', terminal: 'terminal_a' },
    ],
  })
  world.nets.set('base', {
    id: 'base',
    kind: 'net',
    members: [
      { instance: 'r1', terminal: 'terminal_b' },
      { instance: 'r2', terminal: 'terminal_a' },
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
  world.nets.set('emit', {
    id: 'emit',
    kind: 'net',
    members: [
      { instance: 're', terminal: 'terminal_a' },
      { instance: 'q1', terminal: 'emitter' },
    ],
  })
  world.nets.set('gnd', {
    id: 'gnd',
    kind: 'net',
    type: 'ground',
    members: [
      { instance: 'bat', terminal: 'terminal_negative' },
      { instance: 'r2', terminal: 'terminal_b' },
      { instance: 're', terminal: 'terminal_b' },
    ],
  })
  world.instances.set('bat', {
    id: 'bat',
    kind_ref: 'primitive_device',
    definition: 'power_source',
    parameters: { nominal_voltage: scalar(12, 'volt') },
    connects: [
      { net: 'vcc', terminal: 'terminal_positive', of: 'bat' },
      { net: 'gnd', terminal: 'terminal_negative', of: 'bat' },
    ],
  })
  const resistor = (id: string, ohms: number, netA: string, netB: string) => {
    world.instances.set(id, {
      id,
      kind_ref: 'primitive_device',
      definition: 'resistor',
      parameters: { resistance: scalar(ohms, 'ohm') },
      connects: [
        { net: netA, terminal: 'terminal_a', of: id },
        { net: netB, terminal: 'terminal_b', of: id },
      ],
    })
  }
  resistor('r1', 47000, 'vcc', 'base')
  resistor('r2', 10000, 'base', 'gnd')
  resistor('rc', 1000, 'vcc', 'coll')
  resistor('re', 220, 'emit', 'gnd')
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
      { net: 'emit', terminal: 'emitter', of: 'q1' },
    ],
  })
  return world
}

describe('reality check: divider-bias common-emitter amplifier vs textbook hand analysis', () => {
  const sol = solveDC(dividerBiasAmplifier())

  test('the solve converges', () => {
    expect(sol.status).toBe('solved')
    expect(sol.converged).toBe(true)
  })

  test('the rail and node voltages match the hand-computed bias point', () => {
    const vVcc = sol.nodes.get('vcc') ?? 0
    const vBase = sol.nodes.get('base') ?? 0
    const vEmit = sol.nodes.get('emit') ?? 0
    const vColl = sol.nodes.get('coll') ?? 0

    expect(vVcc).toBeCloseTo(12, 2) // ideal source rail
    expect(vBase).toBeGreaterThan(1.5) // hand: 1.72 V
    expect(vBase).toBeLessThan(1.95)
    expect(vEmit).toBeGreaterThan(0.85) // hand: 1.03 V
    expect(vEmit).toBeLessThan(1.2)
    expect(vColl).toBeGreaterThan(6.9) // hand: 7.39 V
    expect(vColl).toBeLessThan(7.8)

    // One base-emitter junction drop, solved from Shockley (~0.69 V, not the 0.7 rule).
    expect(vBase - vEmit).toBeGreaterThan(0.6)
    expect(vBase - vEmit).toBeLessThan(0.75)
  })

  test('the Q-point currents match: I_C ≈ 4.6 mA, I_C/I_B ≈ β, forward-active', () => {
    const vVcc = sol.nodes.get('vcc') ?? 0
    const vBase = sol.nodes.get('base') ?? 0
    const vEmit = sol.nodes.get('emit') ?? 0
    const vColl = sol.nodes.get('coll') ?? 0

    const iC = (vVcc - vColl) / 1000 // through RC
    expect(iC).toBeGreaterThan(0.0043) // hand: 4.61 mA
    expect(iC).toBeLessThan(0.005)

    // Base current by KCL at the divider node: I(R1) − I(R2) = I_B.
    const iR1 = (vVcc - vBase) / 47000
    const iR2 = vBase / 10000
    const iB = iR1 - iR2
    expect(iC / iB).toBeGreaterThan(95) // β = 100
    expect(iC / iB).toBeLessThan(106)

    // V_CE well clear of saturation — a real amplifier biased in the active region.
    expect(vColl - vEmit).toBeGreaterThan(5.8) // hand: 6.36 V
    expect(vColl - vEmit).toBeLessThan(6.8)

    // The transistor's own reported branch current is its collector current.
    expect(Math.abs(sol.branches.get('q1') ?? 0)).toBeCloseTo(iC, 4)
  })
})
