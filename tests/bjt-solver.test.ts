/**
 * BJT solver-integration tests (S19-v3-36) — the Ebers-Moll model wired into the
 * DC Newton-Raphson loop, end to end. The canonical check: a common-emitter bias
 * circuit must solve to I_C ≈ β·I_B with the transistor in the active region.
 */

import { describe, expect, test } from 'vitest'
import type { World } from '../src/cross-fk-validator.ts'
import { solveDC } from '../src/dc-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

/**
 * Vcc(9V) → Rb(100k) → base, Vcc → Rc(470Ω) → collector, emitter → ground.
 * Rb sets the base current; the collector current should come out β× larger.
 */
function commonEmitter(beta: number): World {
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
      { instance: 'rb', terminal: 'terminal_a' },
      { instance: 'rc', terminal: 'terminal_a' },
    ],
  })
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
  world.instances.set('rb', {
    id: 'rb',
    kind_ref: 'primitive_device',
    definition: 'resistor',
    parameters: { resistance: scalar(100000, 'ohm') },
    connects: [
      { net: 'vcc', terminal: 'terminal_a', of: 'rb' },
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
      forward_current_gain: scalar(beta, 'dimensionless'),
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

/**
 * PNP common-emitter — everything reversed vs the NPN: the emitter sits at the
 * +9 V rail, Rb pulls the base DOWN toward ground (current flows out of the
 * base), and Rc takes the collector current down to ground.
 */
function pnpCommonEmitter(beta: number): World {
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
      { instance: 'q1', terminal: 'emitter' },
    ],
  })
  world.nets.set('base', {
    id: 'base',
    kind: 'net',
    members: [
      { instance: 'rb', terminal: 'terminal_a' },
      { instance: 'q1', terminal: 'base' },
    ],
  })
  world.nets.set('coll', {
    id: 'coll',
    kind: 'net',
    members: [
      { instance: 'rc', terminal: 'terminal_a' },
      { instance: 'q1', terminal: 'collector' },
    ],
  })
  world.nets.set('gnd', {
    id: 'gnd',
    kind: 'net',
    type: 'ground',
    members: [
      { instance: 'bat', terminal: 'terminal_negative' },
      { instance: 'rb', terminal: 'terminal_b' },
      { instance: 'rc', terminal: 'terminal_b' },
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
  world.instances.set('rb', {
    id: 'rb',
    kind_ref: 'primitive_device',
    definition: 'resistor',
    parameters: { resistance: scalar(100000, 'ohm') },
    connects: [
      { net: 'base', terminal: 'terminal_a', of: 'rb' },
      { net: 'gnd', terminal: 'terminal_b', of: 'rb' },
    ],
  })
  world.instances.set('rc', {
    id: 'rc',
    kind_ref: 'primitive_device',
    definition: 'resistor',
    parameters: { resistance: scalar(470, 'ohm') },
    connects: [
      { net: 'coll', terminal: 'terminal_a', of: 'rc' },
      { net: 'gnd', terminal: 'terminal_b', of: 'rc' },
    ],
  })
  world.instances.set('q1', {
    id: 'q1',
    kind_ref: 'primitive_device',
    definition: 'transistor_bjt_pnp',
    parameters: {
      saturation_current: scalar(1e-14, 'ampere'),
      forward_current_gain: scalar(beta, 'dimensionless'),
      reverse_current_gain: scalar(2, 'dimensionless'),
    },
    connects: [
      { net: 'coll', terminal: 'collector', of: 'q1' },
      { net: 'base', terminal: 'base', of: 'q1' },
      { net: 'vcc', terminal: 'emitter', of: 'q1' },
    ],
  })
  return world
}

describe('solveDC — PNP BJT (Ebers-Moll mirrored) common-emitter', () => {
  test('I_C ≈ β·I_B with the emitter at the rail (β = 100), active region', () => {
    const sol = solveDC(pnpCommonEmitter(100))
    expect(sol.status).toBe('solved')
    expect(sol.converged).toBe(true)

    // The base sits one junction drop BELOW the 9 V emitter rail.
    const vBase = sol.nodes.get('base') ?? 0
    expect(vBase).toBeGreaterThan(8)
    expect(vBase).toBeLessThan(9)

    const iB = Math.abs(sol.branches.get('rb') ?? 0)
    const iC = Math.abs(sol.branches.get('rc') ?? 0)
    expect(iC / iB).toBeCloseTo(100, 0)

    // Collector rises above ground by I_C·Rc, staying below the base (active).
    const vColl = sol.nodes.get('coll') ?? 0
    expect(vColl).toBeGreaterThan(1)
    expect(vColl).toBeLessThan(vBase)

    // The PNP's reported collector current is physical: it flows OUT of the
    // collector (negative in the into-the-device convention).
    expect(sol.branches.get('q1') ?? 0).toBeLessThan(0)
    expect(Math.abs(sol.branches.get('q1') ?? 0)).toBeCloseTo(iC, 4)
  })
})

describe('solveDC — NPN BJT (Ebers-Moll) common-emitter', () => {
  test('I_C ≈ β·I_B (β = 100), transistor in the active region', () => {
    const sol = solveDC(commonEmitter(100))
    expect(sol.status).toBe('solved')
    expect(sol.converged).toBe(true)

    const iB = Math.abs(sol.branches.get('rb') ?? 0) // base current (through Rb)
    const iC = Math.abs(sol.branches.get('rc') ?? 0) // collector current (through Rc)
    expect(iC / iB).toBeCloseTo(100, 0) // current gain β
    expect(iC).toBeGreaterThan(0.005) // ~8 mA — well into conduction
    expect(iC).toBeLessThan(0.012)

    const vC = sol.nodes.get('coll') ?? 0
    expect(vC).toBeGreaterThan(1) // active, not saturated to ~0
    expect(vC).toBeLessThan(9) // conducting → dropped below Vcc

    // The transistor's reported branch current is its collector current.
    expect(Math.abs(sol.branches.get('q1') ?? 0)).toBeCloseTo(iC, 4)
  })

  test('a smaller β gives proportionally less collector current', () => {
    const sol = solveDC(commonEmitter(50))
    expect(sol.status).toBe('solved')
    const iB = Math.abs(sol.branches.get('rb') ?? 0)
    const iC = Math.abs(sol.branches.get('rc') ?? 0)
    expect(iC / iB).toBeCloseTo(50, 0)
  })
})
