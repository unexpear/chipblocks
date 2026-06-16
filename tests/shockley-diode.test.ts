/**
 * Shockley 4-layer diode tests — the latching, bistable behavior. The pure transition (breakover /
 * holding-current dropout) plus the end-to-end latch through the discrete-state fixed point: it
 * snaps ON above breakover, STAYS on below breakover once latched (the memory), and drops out when
 * the current falls below the holding current.
 */

import { describe, expect, test } from 'vitest'
import type { World } from '../src/cross-fk-validator.ts'
import { solveWithRelays } from '../src/relay.ts'
import { shockleyDiodeTarget } from '../src/shockley-diode.ts'
import { solveTransient } from '../src/transient-solver.ts'

describe('shockleyDiodeTarget (the latch transition)', () => {
  const V_BO = 20
  const I_H = 0.005
  test('a blocking diode turns ON only at/above the breakover voltage', () => {
    expect(shockleyDiodeTarget('blocking', 25, 0, V_BO, I_H)).toBe('conducting')
    expect(shockleyDiodeTarget('blocking', 19.9, 0, V_BO, I_H)).toBe('blocking')
  })
  test('a conducting diode STAYS on while current ≥ holding, drops out below it', () => {
    expect(shockleyDiodeTarget('conducting', 1, 0.1, V_BO, I_H)).toBe('conducting')
    expect(shockleyDiodeTarget('conducting', 1, 0.001, V_BO, I_H)).toBe('blocking')
    // the latch: it stays on even when the voltage is far below breakover
    expect(shockleyDiodeTarget('conducting', 2, 0.05, V_BO, I_H)).toBe('conducting')
  })
})

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

/**
 * V+(supply) → R(ohms) → Shockley(anode); Shockley(cathode) → GND, the diode starting in `state`.
 * Returns the settled latch state and the diode's current.
 */
function solveShockley(
  supplyVolts: number,
  ohms: number,
  state: 'blocking' | 'conducting',
): { latch: string | undefined; current: number } {
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
      { instance: 'rs', terminal: 'terminal_a' },
    ],
  })
  world.nets.set('mid', {
    id: 'mid',
    kind: 'net',
    members: [
      { instance: 'rs', terminal: 'terminal_b' },
      { instance: 'sh', terminal: 'anode' },
    ],
  })
  world.nets.set('gnd', {
    id: 'gnd',
    kind: 'net',
    type: 'ground',
    members: [
      { instance: 'bat', terminal: 'terminal_negative' },
      { instance: 'sh', terminal: 'cathode' },
    ],
  })
  world.instances.set('bat', {
    id: 'bat',
    kind_ref: 'primitive_device',
    definition: 'power_source',
    parameters: { nominal_voltage: scalar(supplyVolts, 'volt') },
    connects: [
      { net: 'vcc', terminal: 'terminal_positive', of: 'bat' },
      { net: 'gnd', terminal: 'terminal_negative', of: 'bat' },
    ],
  })
  world.instances.set('rs', {
    id: 'rs',
    kind_ref: 'primitive_device',
    definition: 'resistor',
    parameters: { resistance: scalar(ohms, 'ohm') },
    connects: [
      { net: 'vcc', terminal: 'terminal_a', of: 'rs' },
      { net: 'mid', terminal: 'terminal_b', of: 'rs' },
    ],
  })
  world.instances.set('sh', {
    id: 'sh',
    kind_ref: 'primitive_device',
    definition: 'diode_shockley',
    parameters: {
      breakover_voltage: scalar(20, 'volt'),
      holding_current: scalar(0.005, 'ampere'),
      forward_voltage: scalar(1.1, 'volt'),
      max_forward_current: scalar(1, 'ampere'),
      device_state: { value: state },
    },
    connects: [
      { net: 'mid', terminal: 'anode', of: 'sh' },
      { net: 'gnd', terminal: 'cathode', of: 'sh' },
    ],
  })
  const result = solveWithRelays(world)
  return {
    latch: result.shockleyStates.get('sh'),
    current: Math.abs(result.solution.branches.get('sh') ?? 0),
  }
}

describe('solveWithRelays — Shockley diode latch (discrete-state fixed point)', () => {
  test('above breakover it snaps ON and conducts', () => {
    const r = solveShockley(30, 100, 'blocking')
    expect(r.latch).toBe('conducting')
    expect(r.current).toBeGreaterThan(0.05) // (30 − ~1.1) / 100 ≈ 0.29 A
  })
  test('below breakover, starting OFF, it stays blocking (no current)', () => {
    const r = solveShockley(10, 100, 'blocking')
    expect(r.latch).toBe('blocking')
    expect(r.current).toBeLessThan(1e-6)
  })
  test('below breakover but already ON, it STAYS latched — the memory', () => {
    const r = solveShockley(10, 100, 'conducting')
    expect(r.latch).toBe('conducting') // V across (10) is below breakover (20), yet it holds
    expect(r.current).toBeGreaterThan(0.05)
  })
  test('when the current falls below the holding current it drops out', () => {
    const r = solveShockley(10, 100000, 'conducting') // ~0.09 mA ≪ 5 mA holding
    expect(r.latch).toBe('blocking')
  })
})

describe('solveTransient — Shockley relaxation oscillator (the latch flips mid-simulation)', () => {
  test('charges to breakover, fires, dumps the cap, re-blocks, and repeats', () => {
    // V+(30) → R(10k) → node; C(100nF) node→GND; Shockley node→GND (V_BO 20 V, I_H 5 mA). The cap
    // charges until breakover, the diode fires and dumps it, the steady feed (~2.9 mA through 10 kΩ)
    // is below the 5 mA holding current so it re-blocks, and the cycle repeats — a relaxation
    // oscillator built on the in-time-loop latch.
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
        { instance: 'r', terminal: 'terminal_a' },
      ],
    })
    world.nets.set('node', {
      id: 'node',
      kind: 'net',
      members: [
        { instance: 'r', terminal: 'terminal_b' },
        { instance: 'c', terminal: 'terminal_a' },
        { instance: 'sh', terminal: 'anode' },
      ],
    })
    world.nets.set('gnd', {
      id: 'gnd',
      kind: 'net',
      type: 'ground',
      members: [
        { instance: 'bat', terminal: 'terminal_negative' },
        { instance: 'c', terminal: 'terminal_b' },
        { instance: 'sh', terminal: 'cathode' },
      ],
    })
    world.instances.set('bat', {
      id: 'bat',
      kind_ref: 'primitive_device',
      definition: 'power_source',
      parameters: { nominal_voltage: scalar(30, 'volt') },
      connects: [
        { net: 'vcc', terminal: 'terminal_positive', of: 'bat' },
        { net: 'gnd', terminal: 'terminal_negative', of: 'bat' },
      ],
    })
    world.instances.set('r', {
      id: 'r',
      kind_ref: 'primitive_device',
      definition: 'resistor',
      parameters: { resistance: scalar(10000, 'ohm') },
      connects: [
        { net: 'vcc', terminal: 'terminal_a', of: 'r' },
        { net: 'node', terminal: 'terminal_b', of: 'r' },
      ],
    })
    world.instances.set('c', {
      id: 'c',
      kind_ref: 'primitive_device',
      definition: 'capacitor',
      parameters: { capacitance: scalar(100e-9, 'farad'), initial_voltage: scalar(0, 'volt') },
      connects: [
        { net: 'node', terminal: 'terminal_a', of: 'c' },
        { net: 'gnd', terminal: 'terminal_b', of: 'c' },
      ],
    })
    world.instances.set('sh', {
      id: 'sh',
      kind_ref: 'primitive_device',
      definition: 'diode_shockley',
      parameters: {
        breakover_voltage: scalar(20, 'volt'),
        holding_current: scalar(0.005, 'ampere'),
        forward_voltage: scalar(1.1, 'volt'),
        max_forward_current: scalar(1, 'ampere'),
        device_state: { value: 'blocking' },
      },
      connects: [
        { net: 'node', terminal: 'anode', of: 'sh' },
        { net: 'gnd', terminal: 'cathode', of: 'sh' },
      ],
    })
    const result = solveTransient(world, { timeStep: 5e-6, duration: 5e-3 })
    const series = result.series
    // it broke over and fired (the diode carried well above the holding current at some point):
    const fired = Math.max(...series.map((s) => Math.abs(s.currents?.get('sh/anode') ?? 0)))
    expect(fired).toBeGreaterThan(0.005)
    // and it is STILL oscillating in the late half (the feed current keeps sawtoothing, not settled):
    const half = Math.floor(series.length / 2)
    const lateFeed = series.slice(half).map((s) => Math.abs(s.currents?.get('r/terminal_a') ?? 0))
    expect(Math.max(...lateFeed) - Math.min(...lateFeed)).toBeGreaterThan(5e-4)
  })
})
