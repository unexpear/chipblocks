/**
 * Varactor (varicap) tests — voltage-controlled junction capacitance C(V) = Cj0/(1 − V/Vj)^m. The
 * model law (C falls as reverse bias rises — how a varactor tunes) plus the transient engine
 * treating it as a real capacitor: it charges, and the charging current decays.
 */

import { describe, expect, test } from 'vitest'
import type { World } from '../src/cross-fk-validator.ts'
import { solveTransient } from '../src/transient-solver.ts'
import { junctionCapacitance } from '../src/varactor-model.ts'

describe('junctionCapacitance — C(V)', () => {
  const CJ0 = 100e-12
  const VJ = 0.7
  test('equals the zero-bias capacitance at V = 0', () => {
    expect(junctionCapacitance(0, CJ0, VJ, 0.5)).toBeCloseTo(CJ0, 15)
  })
  test('FALLS as reverse bias rises — the tuning behavior', () => {
    const c0 = junctionCapacitance(0, CJ0, VJ, 0.5)
    const c2 = junctionCapacitance(-2, CJ0, VJ, 0.5)
    const c8 = junctionCapacitance(-8, CJ0, VJ, 0.5)
    expect(c2).toBeLessThan(c0)
    expect(c8).toBeLessThan(c2) // more reverse → smaller C
  })
  test('a hyperabrupt junction (larger m) tunes more steeply', () => {
    const abrupt = junctionCapacitance(-4, CJ0, VJ, 0.5)
    const hyper = junctionCapacitance(-4, CJ0, VJ, 2)
    expect(hyper).toBeLessThan(abrupt) // larger m ⇒ stronger reverse-bias rolloff
  })
  test('the forward region is clamped — bounded, never divergent', () => {
    expect(Number.isFinite(junctionCapacitance(0.7, CJ0, VJ, 0.5))).toBe(true)
    expect(Number.isFinite(junctionCapacitance(5, CJ0, VJ, 0.5))).toBe(true)
  })
})

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

/** V+(5) → R(1k) → varactor.cathode; varactor.anode → GND (reverse-charged, the normal use). */
function varactorRcWorld(): World {
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
  world.nets.set('mid', {
    id: 'mid',
    kind: 'net',
    members: [
      { instance: 'r', terminal: 'terminal_b' },
      { instance: 'var', terminal: 'cathode' },
    ],
  })
  world.nets.set('gnd', {
    id: 'gnd',
    kind: 'net',
    type: 'ground',
    members: [
      { instance: 'bat', terminal: 'terminal_negative' },
      { instance: 'var', terminal: 'anode' },
    ],
  })
  world.instances.set('bat', {
    id: 'bat',
    kind_ref: 'primitive_device',
    definition: 'power_source',
    parameters: { nominal_voltage: scalar(5, 'volt') },
    connects: [
      { net: 'vcc', terminal: 'terminal_positive', of: 'bat' },
      { net: 'gnd', terminal: 'terminal_negative', of: 'bat' },
    ],
  })
  world.instances.set('r', {
    id: 'r',
    kind_ref: 'primitive_device',
    definition: 'resistor',
    parameters: { resistance: scalar(1000, 'ohm') },
    connects: [
      { net: 'vcc', terminal: 'terminal_a', of: 'r' },
      { net: 'mid', terminal: 'terminal_b', of: 'r' },
    ],
  })
  world.instances.set('var', {
    id: 'var',
    kind_ref: 'primitive_device',
    definition: 'diode_varactor',
    parameters: {
      junction_capacitance_zero_bias: scalar(1e-9, 'farad'),
      junction_potential: scalar(0.7, 'volt'),
      grading_coefficient: scalar(0.5, 'dimensionless'),
      forward_voltage: scalar(0.7, 'volt'),
      max_forward_current: scalar(0.1, 'ampere'),
      initial_voltage: scalar(0, 'volt'),
    },
    connects: [
      { net: 'mid', terminal: 'cathode', of: 'var' },
      { net: 'gnd', terminal: 'anode', of: 'var' },
    ],
  })
  return world
}

describe('solveTransient — the varactor charges like a capacitor', () => {
  test('the charging current starts high and decays toward zero (RC charge, not a short or open)', () => {
    const result = solveTransient(varactorRcWorld(), { timeStep: 1e-7, duration: 1e-5 })
    const first = result.series[1] // first stepped sample (series[0] is the t = 0 initial)
    const last = result.series[result.series.length - 1]
    const iFirst = Math.abs(first?.currents?.get('r/terminal_a') ?? 0)
    const iLast = Math.abs(last?.currents?.get('r/terminal_a') ?? 0)
    expect(iFirst).toBeGreaterThan(1e-3) // ~5 mA initially (the cap looks like a short)
    expect(iLast).toBeLessThan(iFirst / 5) // decays as the junction charges
  })
})
