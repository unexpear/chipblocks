/**
 * Robust DC solving via source stepping (Sprint 22) — accuracy is the headline. A
 * convergence aid is only honest if it changes HOW the solver reaches the answer,
 * never WHICH answer it reaches. These tests pin that down:
 *
 *   1. Fast path is a pure pass-through — a circuit the direct solve handles comes
 *      back byte-identical (diff exactly 0), so every existing circuit is untouched.
 *   2. The ramp, run for real (0 → full supply), lands on the SAME operating point a
 *      direct solve produces — every node, within the solver's own convergence floor
 *      (1e-6 V) — across NPN, PNP, and MOSFET, covering every device seed path.
 *   3. The .nodeset seed lands the same answer in no more Newton passes.
 *
 * A genuinely hard circuit that the direct solve cannot bias (the op-amp) is the real
 * stress test of the ramp's convergence power, and lands with that build.
 */

import { describe, expect, test } from 'vitest'
import type { Instance, World } from '../src/cross-fk-validator.ts'
import { scaleSources, solveDCBySourceStepping, solveDCRobust } from '../src/dc-robust.ts'
import { type Solution, solveDC } from '../src/dc-solver.ts'
import { readScalarParam } from '../src/instance-params.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

/** The DC solver's own convergence floor — two honest solves of the same circuit
 *  agree to within this; it is the bar for "the same operating point". */
const SOLVER_TOLERANCE_V = 1e-6

/** The largest node-voltage disagreement between two solutions, over every net. */
function maxNodeDiff(a: Solution, b: Solution): number {
  let worst = 0
  for (const [net, v] of a.nodes) {
    worst = Math.max(worst, Math.abs(v - (b.nodes.get(net) ?? Number.NaN)))
  }
  return worst
}

/**
 * Vcc(9V) → Rb(100k) → base, Vcc → Rc(470Ω) → collector, emitter → ground —
 * the canonical NPN common-emitter bias.
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
 * PNP common-emitter — emitter at the +9 V rail, Rb pulls the base toward ground.
 * The rail-pinned emitter is exactly what defeats a zero-state coast: it exercises
 * the seed's polarity sign-flip and the ramp's gentle turn-on.
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

/**
 * NMOS low-side switch (2N7000-class): 5 V → 100 Ω load → drain, source → ground,
 * gate driven to `gateVolts` by its own source. At 5 V the device is in triode — a
 * real nonlinear operating point that exercises the seed's vGS/vDS path.
 */
function nmosSwitch(gateVolts: number): World {
  const nodes: CanvasNode[] = [
    {
      id: 'vdd',
      definition: 'power_source',
      parameters: { nominal_voltage: scalar(5, 'volt'), internal_resistance: scalar(0, 'ohm') },
    },
    {
      id: 'vgate',
      definition: 'power_source',
      parameters: {
        nominal_voltage: scalar(gateVolts, 'volt'),
        internal_resistance: scalar(0, 'ohm'),
      },
    },
    { id: 'rload', definition: 'resistor', parameters: { resistance: scalar(100, 'ohm') } },
    {
      id: 'm1',
      definition: 'transistor_mosfet_nmos',
      parameters: {
        threshold_voltage: scalar(2.1, 'volt'),
        transconductance_parameter: scalar(0.026, 'ampere_per_volt_squared'),
      },
    },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    {
      source: 'vdd',
      sourceHandle: 'terminal_positive',
      target: 'rload',
      targetHandle: 'terminal_a',
    },
    { source: 'rload', sourceHandle: 'terminal_b', target: 'm1', targetHandle: 'drain' },
    { source: 'm1', sourceHandle: 'source', target: 'vdd', targetHandle: 'terminal_negative' },
    { source: 'vgate', sourceHandle: 'terminal_positive', target: 'm1', targetHandle: 'gate' },
    {
      source: 'vgate',
      sourceHandle: 'terminal_negative',
      target: 'vdd',
      targetHandle: 'terminal_negative',
    },
    {
      source: 'gnd',
      sourceHandle: 'reference_terminal',
      target: 'vdd',
      targetHandle: 'terminal_negative',
    },
  ]
  return canvasToWorld(nodes, edges)
}

const cases = [
  ['NPN common-emitter', () => commonEmitter(150)],
  ['PNP common-emitter', () => pnpCommonEmitter(100)],
  ['NMOS triode switch', () => nmosSwitch(5)],
] as const

describe('solveDCRobust — fast path is an exact pass-through', () => {
  test('a circuit the direct solve handles comes back byte-identical (diff = 0)', () => {
    const direct = solveDC(commonEmitter(150))
    const robust = solveDCRobust(commonEmitter(150))
    expect(robust.status).toBe('solved')
    expect(maxNodeDiff(robust, direct)).toBe(0)
  })
})

describe('solveDCBySourceStepping — the ramp lands on the exact operating point', () => {
  for (const [name, build] of cases) {
    test(`${name}: ramping 0 → full supply matches the direct solve within tolerance`, () => {
      const truth = solveDC(build())
      expect(truth.status).toBe('solved')
      const ramped = solveDCBySourceStepping(build())
      expect(ramped.status).toBe('solved')
      expect(maxNodeDiff(ramped, truth)).toBeLessThan(SOLVER_TOLERANCE_V)
    })
  }
})

describe('solveDC — the .nodeset seed lands the same answer, faster', () => {
  for (const [name, build] of cases) {
    test(`${name}: seeded solve matches the direct solve in no more passes`, () => {
      const truth = solveDC(build())
      expect(truth.status).toBe('solved')
      const seeded = solveDC(build(), { initialNodes: truth.nodes })
      expect(seeded.status).toBe('solved')
      expect(maxNodeDiff(seeded, truth)).toBeLessThan(SOLVER_TOLERANCE_V)
      expect(seeded.iterations).toBeLessThanOrEqual(truth.iterations)
    })
  }
})

describe('scaleSources — ramping a supply scales its drive linearly', () => {
  test('at α = 0.5 the 9 V rail sits at 4.5 V', () => {
    const half = solveDC(scaleSources(commonEmitter(150), 0.5))
    expect(half.status).toBe('solved')
    expect(half.nodes.get('vcc') ?? Number.NaN).toBeCloseTo(4.5, 6)
  })

  test("a light sensor's illuminance ramps too, but a passive photoresistor's does not", () => {
    const world: World = {
      definitions: new Map(),
      instances: new Map(),
      behaviors: new Map(),
      activeVariables: new Map(),
      nets: new Map(),
    }
    world.instances.set('pd', {
      id: 'pd',
      kind_ref: 'primitive_device',
      definition: 'photodiode',
      parameters: {
        incident_illuminance: scalar(1000, 'lux'),
        ambient_illuminance: scalar(200, 'lux'),
        photocurrent_per_lux: scalar(1e-6, 'ampere'),
      },
    } as unknown as Instance)
    world.instances.set('ldr', {
      id: 'ldr',
      kind_ref: 'primitive_device',
      definition: 'photoresistor',
      parameters: { incident_illuminance: scalar(1000, 'lux') },
    } as unknown as Instance)
    const scaled = scaleSources(world, 0.5)
    const pd = scaled.instances.get('pd') as Instance
    // The photodiode's light-driven current is an independent excitation → its illuminance ramps.
    expect(readScalarParam(pd, 'incident_illuminance')).toBeCloseTo(500, 6)
    expect(readScalarParam(pd, 'ambient_illuminance')).toBeCloseTo(100, 6)
    // photocurrent_per_lux is a device property, not an excitation → untouched.
    expect(readScalarParam(pd, 'photocurrent_per_lux')).toBeCloseTo(1e-6, 12)
    // The photoresistor is passive (its light-set resistance isn't an excitation) → untouched.
    const ldr = scaled.instances.get('ldr') as Instance
    expect(readScalarParam(ldr, 'incident_illuminance')).toBeCloseTo(1000, 6)
  })
})
