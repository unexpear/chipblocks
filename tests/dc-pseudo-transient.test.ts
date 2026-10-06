/**
 * Pseudo-transient DC continuation + logic-seed warm-start (Track 4).
 *
 * Accuracy contract matches source/gmin stepping: the final answer IS a real-circuit solve
 * (no artificial C). A capacitively-held intermediate is never returned as "solved".
 * A caller .nodeset / logic seed is a starting guess only — never fake convergence.
 */
import { describe, expect, test } from 'vitest'
import type { Instance, World } from '../src/cross-fk-validator.ts'
import {
  adaptivePseudoCapacitance,
  estimateCircuitConductanceScale,
  solveDCByPseudoTransient,
  solveDCBySourceStepping,
  solveDCRobust,
} from '../src/dc-robust.ts'
import { type Solution, solveDC } from '../src/dc-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

const SOLVER_TOLERANCE_V = 1e-6

function maxNodeDiff(a: Solution, b: Solution): number {
  let worst = 0
  for (const [net, v] of a.nodes) {
    worst = Math.max(worst, Math.abs(v - (b.nodes.get(net) ?? Number.NaN)))
  }
  return worst
}

/** Vcc → Rb → base, Vcc → Rc → collector, emitter → gnd — NPN common-emitter. */
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
    parameters: {
      nominal_voltage: scalar(9, 'volt'),
      internal_resistance: scalar(0, 'ohm'),
    },
    connects: [
      { terminal: 'terminal_positive', net: 'vcc' },
      { terminal: 'terminal_negative', net: 'gnd' },
    ],
  } as unknown as Instance)
  world.instances.set('rb', {
    id: 'rb',
    kind_ref: 'primitive_device',
    definition: 'resistor',
    parameters: { resistance: scalar(100_000, 'ohm') },
    connects: [
      { terminal: 'terminal_a', net: 'vcc' },
      { terminal: 'terminal_b', net: 'base' },
    ],
  } as unknown as Instance)
  world.instances.set('rc', {
    id: 'rc',
    kind_ref: 'primitive_device',
    definition: 'resistor',
    parameters: { resistance: scalar(470, 'ohm') },
    connects: [
      { terminal: 'terminal_a', net: 'vcc' },
      { terminal: 'terminal_b', net: 'coll' },
    ],
  } as unknown as Instance)
  world.instances.set('q1', {
    id: 'q1',
    kind_ref: 'primitive_device',
    definition: 'transistor_bjt_npn',
    parameters: { forward_beta: scalar(beta, '1') },
    connects: [
      { terminal: 'base', net: 'base' },
      { terminal: 'collector', net: 'coll' },
      { terminal: 'emitter', net: 'gnd' },
    ],
  } as unknown as Instance)
  return world
}

describe('solveDCByPseudoTransient — real-circuit final answer', () => {
  test('lands on the same operating point as a direct solve (within tolerance)', () => {
    const truth = solveDC(commonEmitter(150))
    expect(truth.status).toBe('solved')
    const ptr = solveDCByPseudoTransient(commonEmitter(150))
    expect(ptr.status).toBe('solved')
    expect(maxNodeDiff(ptr, truth)).toBeLessThan(SOLVER_TOLERANCE_V)
  })

  test('a warm-started coast matches the direct solve and does not claim success without converging', () => {
    const truth = solveDC(commonEmitter(150))
    expect(truth.status).toBe('solved')
    const seeded = solveDCByPseudoTransient(commonEmitter(150), { initialNodes: truth.nodes })
    expect(seeded.status).toBe('solved')
    expect(maxNodeDiff(seeded, truth)).toBeLessThan(SOLVER_TOLERANCE_V)
  })

  test('does not return a capacitively-held intermediate as solved (final has no pseudo C)', () => {
    // Force a tiny budget so the coast cannot finish — must not report 'solved' with a fake OP.
    const t0 = performance.now()
    const sol = solveDCByPseudoTransient(commonEmitter(150), {
      deadline: t0 + 0.05, // 50 µs — essentially no time
      maxIterations: 1,
    })
    // Either over-budget / did-not-converge / or (if somehow fast enough) a real solved — never silent.
    if (sol.status === 'solved') {
      // If it did finish, it must match the true OP (real final solve).
      const truth = solveDC(commonEmitter(150))
      expect(maxNodeDiff(sol, truth)).toBeLessThan(SOLVER_TOLERANCE_V)
    } else {
      expect(['over-budget', 'did-not-converge', 'singular-matrix', 'numerical-error']).toContain(
        sol.status,
      )
    }
  })
})

describe('logic-seed / .nodeset warm-start through solveDCRobust', () => {
  test('a correct .nodeset on a converging circuit stays a pass-through (same OP)', () => {
    const truth = solveDC(commonEmitter(150))
    const robust = solveDCRobust(commonEmitter(150), { initialNodes: truth.nodes })
    expect(robust.status).toBe('solved')
    expect(maxNodeDiff(robust, truth)).toBeLessThan(SOLVER_TOLERANCE_V)
  })

  test('a wrong .nodeset does not fake convergence — solver still has to land on the real OP', () => {
    const truth = solveDC(commonEmitter(150))
    expect(truth.status).toBe('solved')
    // Seed every net at 0 (cold-ish) — still must reach the real answer, not report the seed.
    const zeros = new Map<string, number>()
    for (const net of truth.nodes.keys()) zeros.set(net, 0)
    const robust = solveDCRobust(commonEmitter(150), { initialNodes: zeros })
    expect(robust.status).toBe('solved')
    expect(maxNodeDiff(robust, truth)).toBeLessThan(SOLVER_TOLERANCE_V)
  })
})

describe('source stepping still preferred for easy BJT (regression)', () => {
  test('source stepping matches direct on the common-emitter', () => {
    const truth = solveDC(commonEmitter(150))
    const ramped = solveDCBySourceStepping(commonEmitter(150))
    expect(ramped.status).toBe('solved')
    expect(maxNodeDiff(ramped, truth)).toBeLessThan(SOLVER_TOLERANCE_V)
  })
})

describe('adaptive pseudo-capacitance from circuit scale', () => {
  test('sizes C from resistor conductance scale (not fixed 1 nF)', () => {
    const world = commonEmitter(150)
    const G = estimateCircuitConductanceScale(world)
    const C = adaptivePseudoCapacitance(world)
    // Geometric mean of 1/100k and 1/470 ≈ 1.46e-4 S; C = G * 1e-9
    expect(G).toBeGreaterThan(1e-5)
    expect(G).toBeLessThan(1e-2)
    expect(C).toBeCloseTo(G * 1e-9, 20)
    expect(C).not.toBeCloseTo(1e-9, 12) // must not be the old fixed 1 nF
    expect(C).toBeGreaterThanOrEqual(1e-15)
    expect(C).toBeLessThanOrEqual(1e-6)
  })

  test('a kilo-ohm scale circuit gets a larger companion C than a mega-ohm one', () => {
    const setR = (world: World, id: string, ohms: number) => {
      const inst = world.instances.get(id)
      expect(inst).toBeDefined()
      if (inst === undefined) return
      world.instances.set(id, {
        ...inst,
        parameters: { ...inst.parameters, resistance: scalar(ohms, 'ohm') },
      } as Instance)
    }
    const lowZ = commonEmitter(150)
    setR(lowZ, 'rc', 1000)
    setR(lowZ, 'rb', 10000)
    const highZ = commonEmitter(150)
    setR(highZ, 'rc', 1e6)
    setR(highZ, 'rb', 10e6)
    expect(adaptivePseudoCapacitance(lowZ)).toBeGreaterThan(adaptivePseudoCapacitance(highZ))
  })

  test('adaptive coast still ungapped-converges to the direct OP', () => {
    const truth = solveDC(commonEmitter(150))
    expect(truth.status).toBe('solved')
    const ptr = solveDCByPseudoTransient(commonEmitter(150))
    expect(ptr.status).toBe('solved')
    expect(maxNodeDiff(ptr, truth)).toBeLessThan(SOLVER_TOLERANCE_V)
  })
})
