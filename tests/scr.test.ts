/**
 * SCR (silicon controlled rectifier) tests — the gated thyristor. Its anode-cathode path is the
 * Shockley latch; the gate ADDS a trigger: a gate current at or above I_GT fires it on, far below
 * the self-breakover voltage. The gate cannot turn it off — only the anode current falling below the
 * holding current does. These cover the pure trigger logic and the end-to-end latch through the
 * discrete-state fixed point (solveWithRelays), gate drive included.
 */

import { describe, expect, test } from 'vitest'
import type { World } from '../src/cross-fk-validator.ts'
import { solveWithRelays } from '../src/relay.ts'
import { type PartReading, partReadings } from '../src/renderer/part-readings.ts'
import { scrTarget } from '../src/shockley-diode.ts'
import { solveTransient } from '../src/transient-solver.ts'

describe('scrTarget (the gated-latch transition)', () => {
  const V_BO = 100
  const I_H = 0.005
  const I_GT = 0.0005
  test('a gate current at/above I_GT fires it ON, far below breakover', () => {
    expect(scrTarget('blocking', 30, 0, 0.001, V_BO, I_H, I_GT)).toBe('conducting') // 1 mA ≥ I_GT
    expect(scrTarget('blocking', 30, 0, 0.0001, V_BO, I_H, I_GT)).toBe('blocking') // 0.1 mA < I_GT
  })
  test('it still self-fires at the breakover voltage with no gate', () => {
    expect(scrTarget('blocking', 120, 0, 0, V_BO, I_H, I_GT)).toBe('conducting')
    expect(scrTarget('blocking', 30, 0, 0, V_BO, I_H, I_GT)).toBe('blocking')
  })
  test('the gate CANNOT turn it off — only the holding current does', () => {
    // conducting, gate removed (0), anode current well above holding → stays ON:
    expect(scrTarget('conducting', 2, 0.02, 0, V_BO, I_H, I_GT)).toBe('conducting')
    // conducting, anode current below holding → turns OFF:
    expect(scrTarget('conducting', 2, 0.001, 0, V_BO, I_H, I_GT)).toBe('blocking')
  })
})

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

/**
 * V+(anodeSupply) → R(loadOhms) → SCR.anode; SCR.cathode → GND; V_gate drives SCR.gate. Returns the
 * settled latch state + the anode current. I_GT 0.5 mA, R_GK 1 kΩ → a gate above ~0.5 V fires it.
 */
function solveScr(
  anodeSupply: number,
  loadOhms: number,
  gateVolts: number,
  startState: 'blocking' | 'conducting',
  gateResistance = 1000,
): { latch: string | undefined; anodeCurrent: number; reading: PartReading | undefined } {
  const world: World = {
    definitions: new Map(),
    instances: new Map(),
    behaviors: new Map(),
    activeVariables: new Map(),
    nets: new Map(),
  }
  world.nets.set('va', {
    id: 'va',
    kind: 'net',
    members: [
      { instance: 'bata', terminal: 'terminal_positive' },
      { instance: 'rload', terminal: 'terminal_a' },
    ],
  })
  world.nets.set('anode', {
    id: 'anode',
    kind: 'net',
    members: [
      { instance: 'rload', terminal: 'terminal_b' },
      { instance: 'scr', terminal: 'anode' },
    ],
  })
  world.nets.set('gate', {
    id: 'gate',
    kind: 'net',
    members: [
      { instance: 'batg', terminal: 'terminal_positive' },
      { instance: 'scr', terminal: 'gate' },
    ],
  })
  world.nets.set('gnd', {
    id: 'gnd',
    kind: 'net',
    type: 'ground',
    members: [
      { instance: 'bata', terminal: 'terminal_negative' },
      { instance: 'batg', terminal: 'terminal_negative' },
      { instance: 'scr', terminal: 'cathode' },
    ],
  })
  world.instances.set('bata', {
    id: 'bata',
    kind_ref: 'primitive_device',
    definition: 'power_source',
    parameters: { nominal_voltage: scalar(anodeSupply, 'volt') },
    connects: [
      { net: 'va', terminal: 'terminal_positive', of: 'bata' },
      { net: 'gnd', terminal: 'terminal_negative', of: 'bata' },
    ],
  })
  world.instances.set('batg', {
    id: 'batg',
    kind_ref: 'primitive_device',
    definition: 'power_source',
    parameters: { nominal_voltage: scalar(gateVolts, 'volt') },
    connects: [
      { net: 'gate', terminal: 'terminal_positive', of: 'batg' },
      { net: 'gnd', terminal: 'terminal_negative', of: 'batg' },
    ],
  })
  world.instances.set('rload', {
    id: 'rload',
    kind_ref: 'primitive_device',
    definition: 'resistor',
    parameters: { resistance: scalar(loadOhms, 'ohm') },
    connects: [
      { net: 'va', terminal: 'terminal_a', of: 'rload' },
      { net: 'anode', terminal: 'terminal_b', of: 'rload' },
    ],
  })
  world.instances.set('scr', {
    id: 'scr',
    kind_ref: 'primitive_device',
    definition: 'scr',
    parameters: {
      breakover_voltage: scalar(100, 'volt'),
      holding_current: scalar(0.005, 'ampere'),
      forward_voltage: scalar(1.7, 'volt'),
      max_forward_current: scalar(0.8, 'ampere'),
      gate_trigger_current: scalar(0.0005, 'ampere'),
      gate_cathode_resistance: scalar(gateResistance, 'ohm'),
      device_state: { value: startState },
    },
    connects: [
      { net: 'anode', terminal: 'anode', of: 'scr' },
      { net: 'gnd', terminal: 'cathode', of: 'scr' },
      { net: 'gate', terminal: 'gate', of: 'scr' },
    ],
  })
  const result = solveWithRelays(world)
  return {
    latch: result.shockleyStates.get('scr'),
    anodeCurrent: Math.abs(result.solution.branches.get('scr') ?? 0),
    reading: partReadings(world, result.solution).get('scr'),
  }
}

describe('solveWithRelays — SCR latch (gate-triggered)', () => {
  test('a gate pulse fires it on below breakover, and the anode conducts', () => {
    const r = solveScr(30, 1000, 2, 'blocking') // gate 2 V → 2 mA ≥ 0.5 mA I_GT
    expect(r.latch).toBe('conducting')
    expect(r.anodeCurrent).toBeGreaterThan(0.01) // ~(30 − 1.7) / 1000 ≈ 28 mA
  })
  test('with no gate drive and below breakover, it stays blocking', () => {
    const r = solveScr(30, 1000, 0, 'blocking')
    expect(r.latch).toBe('blocking')
    expect(r.anodeCurrent).toBeLessThan(1e-6)
  })
  test('once latched it STAYS on after the gate is removed (the gate cannot turn it off)', () => {
    const r = solveScr(30, 1000, 0, 'conducting') // gate 0, but already latched + above holding
    expect(r.latch).toBe('conducting')
    expect(r.anodeCurrent).toBeGreaterThan(0.01)
  })
  test('it turns off when the anode current falls below the holding current', () => {
    const r = solveScr(30, 100000, 0, 'conducting') // ~0.28 mA ≪ 5 mA holding
    expect(r.latch).toBe('blocking')
  })
  test('a conducting SCR reports voltage and power, not just current (the anode–cathode across)', () => {
    const r = solveScr(30, 1000, 2, 'blocking') // fires on; ~28 mA through its ~1.7 V forward drop
    expect(r.reading?.current).toBeGreaterThan(0.01)
    expect(r.reading?.voltage).toBeGreaterThan(0) // |V_anode − V_cathode| — was undefined before
    expect(r.reading?.power).toBeGreaterThan(0)
  })
})

describe('solveTransient — SCR on an AC line (gated phase control)', () => {
  test('conducts the gated positive half-cycles and blocks the negative ones', () => {
    // AC anode (10 V, 1 kHz) → R(100) → SCR; gate held on (2 V). Each positive half the gate fires
    // the SCR and it conducts; each negative half it blocks (reverse) and turns off at the
    // zero-crossing — a gated rectifier, the core of an SCR dimmer.
    const world: World = {
      definitions: new Map(),
      instances: new Map(),
      behaviors: new Map(),
      activeVariables: new Map(),
      nets: new Map(),
    }
    world.nets.set('vac', {
      id: 'vac',
      kind: 'net',
      members: [
        { instance: 'acsrc', terminal: 'terminal_positive' },
        { instance: 'r', terminal: 'terminal_a' },
      ],
    })
    world.nets.set('anode', {
      id: 'anode',
      kind: 'net',
      members: [
        { instance: 'r', terminal: 'terminal_b' },
        { instance: 'scr', terminal: 'anode' },
      ],
    })
    world.nets.set('gate', {
      id: 'gate',
      kind: 'net',
      members: [
        { instance: 'gatesrc', terminal: 'terminal_positive' },
        { instance: 'scr', terminal: 'gate' },
      ],
    })
    world.nets.set('gnd', {
      id: 'gnd',
      kind: 'net',
      type: 'ground',
      members: [
        { instance: 'acsrc', terminal: 'terminal_negative' },
        { instance: 'gatesrc', terminal: 'terminal_negative' },
        { instance: 'scr', terminal: 'cathode' },
      ],
    })
    world.instances.set('acsrc', {
      id: 'acsrc',
      kind_ref: 'primitive_device',
      definition: 'power_source',
      parameters: {
        nominal_voltage: scalar(0, 'volt'),
        ac_amplitude: scalar(10, 'volt'),
        frequency: scalar(1000, 'hertz'),
      },
      connects: [
        { net: 'vac', terminal: 'terminal_positive', of: 'acsrc' },
        { net: 'gnd', terminal: 'terminal_negative', of: 'acsrc' },
      ],
    })
    world.instances.set('gatesrc', {
      id: 'gatesrc',
      kind_ref: 'primitive_device',
      definition: 'power_source',
      parameters: { nominal_voltage: scalar(2, 'volt') },
      connects: [
        { net: 'gate', terminal: 'terminal_positive', of: 'gatesrc' },
        { net: 'gnd', terminal: 'terminal_negative', of: 'gatesrc' },
      ],
    })
    world.instances.set('r', {
      id: 'r',
      kind_ref: 'primitive_device',
      definition: 'resistor',
      parameters: { resistance: scalar(100, 'ohm') },
      connects: [
        { net: 'vac', terminal: 'terminal_a', of: 'r' },
        { net: 'anode', terminal: 'terminal_b', of: 'r' },
      ],
    })
    world.instances.set('scr', {
      id: 'scr',
      kind_ref: 'primitive_device',
      definition: 'scr',
      parameters: {
        breakover_voltage: scalar(100, 'volt'),
        holding_current: scalar(0.005, 'ampere'),
        forward_voltage: scalar(1.7, 'volt'),
        max_forward_current: scalar(0.8, 'ampere'),
        gate_trigger_current: scalar(0.0005, 'ampere'),
        gate_cathode_resistance: scalar(1000, 'ohm'),
        device_state: { value: 'blocking' },
      },
      connects: [
        { net: 'anode', terminal: 'anode', of: 'scr' },
        { net: 'gnd', terminal: 'cathode', of: 'scr' },
        { net: 'gate', terminal: 'gate', of: 'scr' },
      ],
    })
    const result = solveTransient(world, { timeStep: 1e-5, duration: 3e-3 })
    const load = result.series.map((s) => Math.abs(s.currents?.get('r/terminal_a') ?? 0))
    expect(Math.max(...load)).toBeGreaterThan(0.01) // conducts on the gated positive half-cycles
    expect(Math.min(...load)).toBeLessThan(1e-3) // blocks on the negative half-cycles
    const half = Math.floor(load.length / 2)
    expect(Math.max(...load.slice(half))).toBeGreaterThan(0.01) // re-fires every cycle, not just once
    // The SCR's anode current is recorded at scr/anode — the key the scope's part-current probe
    // (scopePartInfo) reads, so the curve tracer can actually probe it and the other new devices.
    expect(result.series.some((s) => (s.currents?.get('scr/anode') ?? 0) !== 0)).toBe(true)
  })
})

describe('SCR with a zero / invalid gate-cathode resistance (divide-by-zero guard)', () => {
  test('DC: R_GK = 0 disables the gate trigger without dividing by zero — stays blocking, finite', () => {
    const r = solveScr(30, 1000, 2, 'blocking', 0) // gate 2 V, but R_GK 0 → no gate current/trigger
    expect(Number.isFinite(r.anodeCurrent)).toBe(true)
    expect(r.latch).toBe('blocking') // below breakover with the gate disabled
  })
  test('transient: R_GK = 0 stamps no 1/0 — every recorded current stays finite', () => {
    const world: World = {
      definitions: new Map(),
      instances: new Map(),
      behaviors: new Map(),
      activeVariables: new Map(),
      nets: new Map(),
    }
    world.nets.set('vp', {
      id: 'vp',
      kind: 'net',
      members: [
        { instance: 'src', terminal: 'terminal_positive' },
        { instance: 'r', terminal: 'terminal_a' },
      ],
    })
    world.nets.set('anode', {
      id: 'anode',
      kind: 'net',
      members: [
        { instance: 'r', terminal: 'terminal_b' },
        { instance: 'scr', terminal: 'anode' },
      ],
    })
    world.nets.set('gnd', {
      id: 'gnd',
      kind: 'net',
      type: 'ground',
      members: [
        { instance: 'src', terminal: 'terminal_negative' },
        { instance: 'scr', terminal: 'cathode' },
        { instance: 'scr', terminal: 'gate' },
      ],
    })
    world.instances.set('src', {
      id: 'src',
      kind_ref: 'primitive_device',
      definition: 'power_source',
      parameters: { nominal_voltage: scalar(30, 'volt') },
      connects: [
        { net: 'vp', terminal: 'terminal_positive', of: 'src' },
        { net: 'gnd', terminal: 'terminal_negative', of: 'src' },
      ],
    })
    world.instances.set('r', {
      id: 'r',
      kind_ref: 'primitive_device',
      definition: 'resistor',
      parameters: { resistance: scalar(1000, 'ohm') },
      connects: [
        { net: 'vp', terminal: 'terminal_a', of: 'r' },
        { net: 'anode', terminal: 'terminal_b', of: 'r' },
      ],
    })
    world.instances.set('scr', {
      id: 'scr',
      kind_ref: 'primitive_device',
      definition: 'scr',
      parameters: {
        breakover_voltage: scalar(100, 'volt'),
        holding_current: scalar(0.005, 'ampere'),
        forward_voltage: scalar(1.7, 'volt'),
        gate_trigger_current: scalar(0.0005, 'ampere'),
        gate_cathode_resistance: scalar(0, 'ohm'), // invalid → gate disabled, must NOT stamp 1/0
        device_state: { value: 'blocking' },
      },
      connects: [
        { net: 'anode', terminal: 'anode', of: 'scr' },
        { net: 'gnd', terminal: 'cathode', of: 'scr' },
        { net: 'gnd', terminal: 'gate', of: 'scr' },
      ],
    })
    const result = solveTransient(world, { timeStep: 1e-4, duration: 5e-4 })
    expect(result.status).not.toBe('singular-matrix')
    const allFinite = result.series.every((s) =>
      [...(s.currents?.values() ?? [])].every((v) => Number.isFinite(v)),
    )
    expect(allFinite).toBe(true)
  })
})
