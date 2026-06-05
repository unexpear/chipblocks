/**
 * DC solver tests — S14-v3-3 scaffold layer.
 *
 * Covers:
 *   1. mathjs lusolve SMOKE TEST — load-bearing pivot check. If mathjs's
 *      linear algebra doesn't produce expected results on a small hand-built
 *      system, the whole solver strategy needs reconsidering before depending
 *      on it for circuit analysis.
 *   2. Ground identification — auto-detect via type: ground, override via
 *      SolveOptions.ground, no-ground-net case, multiple-ground case.
 *   3. Node-index assignment — excludes ground, numbers others.
 *   4. Resistor stamp — applies ±1/R into the right matrix cells, skipping
 *      rows/cols for ground.
 *   5. solveDC end-to-end (S14-v3-3 partial) — returns 'no-ground' when no
 *      ground net exists; returns 'solved' with all-zero voltages on a
 *      resistor-only circuit (no driving force).
 *
 * Voltage source / LED / wire / switch stamps + branch-current extraction
 * land in S14-v3-4 through S14-v3-6; corresponding tests come with each.
 */

import { describe, expect, test } from 'vitest'
import type {
  ActiveVariableEntry,
  BehaviorEntry,
  Definition,
  Instance,
  Net,
  World,
} from '../src/cross-fk-validator.ts'
import {
  assignNodeIndices,
  identifyGround,
  mathInstance as math,
  solveDC,
  stampResistor,
} from '../src/dc-solver.ts'

// Helper: build a minimal World with just the maps the solver reads.
function emptyWorld(): World {
  return {
    definitions: new Map<string, Definition>(),
    instances: new Map<string, Instance>(),
    behaviors: new Map<string, BehaviorEntry>(),
    activeVariables: new Map<string, ActiveVariableEntry>(),
    nets: new Map<string, Net>(),
  }
}

// ===========================================================================
// 1. mathjs lusolve smoke test — the load-bearing pivot check
// ===========================================================================

describe('mathjs lusolve smoke', () => {
  test('hand-built 2x2 system solves to the expected result', () => {
    // M = [[3, -1], [-1, 3]]; b = [2, 2] → x = [1, 1].
    // By hand: 3·1 + (-1)·1 = 2 ✓; (-1)·1 + 3·1 = 2 ✓.
    const M = math.matrix([
      [3, -1],
      [-1, 3],
    ])
    const b = math.matrix([[2], [2]])

    // biome-ignore lint/suspicious/noExplicitAny: mathjs return is polymorphic
    const x = math.lusolve(M, b) as any
    const xArr = x.toArray() as number[][]

    expect(xArr[0]?.[0]).toBeCloseTo(1, 9)
    expect(xArr[1]?.[0]).toBeCloseTo(1, 9)
  })

  test('hand-built 3x3 system solves to the expected result', () => {
    // A simple symmetric positive-definite system; expected x = [1, 2, 3].
    // M = [[1, 0, 0], [0, 1, 0], [0, 0, 1]] (identity); b = [1, 2, 3].
    const M = math.matrix([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ])
    const b = math.matrix([[1], [2], [3]])

    // biome-ignore lint/suspicious/noExplicitAny: mathjs return is polymorphic
    const x = math.lusolve(M, b) as any
    const xArr = x.toArray() as number[][]

    expect(xArr[0]?.[0]).toBeCloseTo(1, 9)
    expect(xArr[1]?.[0]).toBeCloseTo(2, 9)
    expect(xArr[2]?.[0]).toBeCloseTo(3, 9)
  })
})

// ===========================================================================
// 2. Ground identification
// ===========================================================================

describe('identifyGround', () => {
  test('auto-detects the single type: ground net', () => {
    const world = emptyWorld()
    world.nets.set('net_a', {
      id: 'net_a',
      kind: 'net',
      members: [
        { instance: 'i1', terminal: 't1' },
        { instance: 'i2', terminal: 't2' },
      ],
    })
    world.nets.set('net_gnd', {
      id: 'net_gnd',
      kind: 'net',
      type: 'ground',
      members: [
        { instance: 'i3', terminal: 't3' },
        { instance: 'i4', terminal: 't4' },
      ],
    })
    const warnings: string[] = []
    const g = identifyGround(world, undefined, warnings)
    expect(g).toBe('net_gnd')
    expect(warnings).toEqual([])
  })

  test('returns undefined and no warning when no type: ground net exists', () => {
    const world = emptyWorld()
    world.nets.set('net_a', {
      id: 'net_a',
      kind: 'net',
      members: [
        { instance: 'i1', terminal: 't1' },
        { instance: 'i2', terminal: 't2' },
      ],
    })
    const warnings: string[] = []
    const g = identifyGround(world, undefined, warnings)
    expect(g).toBeUndefined()
    expect(warnings).toEqual([])
  })

  test('multiple ground nets: picks the first, emits a warning', () => {
    const world = emptyWorld()
    world.nets.set('net_gnd_a', {
      id: 'net_gnd_a',
      kind: 'net',
      type: 'ground',
      members: [
        { instance: 'i1', terminal: 't1' },
        { instance: 'i2', terminal: 't2' },
      ],
    })
    world.nets.set('net_gnd_b', {
      id: 'net_gnd_b',
      kind: 'net',
      type: 'ground',
      members: [
        { instance: 'i3', terminal: 't3' },
        { instance: 'i4', terminal: 't4' },
      ],
    })
    const warnings: string[] = []
    const g = identifyGround(world, undefined, warnings)
    expect(g).toBe('net_gnd_a')
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain('Multiple type: ground nets')
  })

  test('SolveOptions.ground override picks the named net', () => {
    const world = emptyWorld()
    world.nets.set('net_a', {
      id: 'net_a',
      kind: 'net',
      members: [
        { instance: 'i1', terminal: 't1' },
        { instance: 'i2', terminal: 't2' },
      ],
    })
    world.nets.set('net_gnd', {
      id: 'net_gnd',
      kind: 'net',
      type: 'ground',
      members: [
        { instance: 'i3', terminal: 't3' },
        { instance: 'i4', terminal: 't4' },
      ],
    })
    const warnings: string[] = []
    const g = identifyGround(world, { ground: 'net_a' }, warnings)
    expect(g).toBe('net_a')
    expect(warnings).toEqual([])
  })

  test('SolveOptions.ground referencing an unknown net warns and returns undefined', () => {
    const world = emptyWorld()
    world.nets.set('net_a', {
      id: 'net_a',
      kind: 'net',
      members: [
        { instance: 'i1', terminal: 't1' },
        { instance: 'i2', terminal: 't2' },
      ],
    })
    const warnings: string[] = []
    const g = identifyGround(world, { ground: 'net_nonexistent' }, warnings)
    expect(g).toBeUndefined()
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain("'net_nonexistent'")
  })
})

// ===========================================================================
// 3. Node-index assignment
// ===========================================================================

describe('assignNodeIndices', () => {
  test('excludes the ground net, numbers others 0..N-2', () => {
    const nets = new Map<string, Net>()
    nets.set('net_a', {
      id: 'net_a',
      kind: 'net',
      members: [
        { instance: 'i1', terminal: 't' },
        { instance: 'i2', terminal: 't' },
      ],
    })
    nets.set('net_b', {
      id: 'net_b',
      kind: 'net',
      members: [
        { instance: 'i3', terminal: 't' },
        { instance: 'i4', terminal: 't' },
      ],
    })
    nets.set('net_gnd', {
      id: 'net_gnd',
      kind: 'net',
      type: 'ground',
      members: [
        { instance: 'i5', terminal: 't' },
        { instance: 'i6', terminal: 't' },
      ],
    })

    const idx = assignNodeIndices(nets, 'net_gnd')
    expect(idx.size).toBe(2)
    expect(idx.get('net_gnd')).toBeUndefined()
    expect(idx.get('net_a')).toBe(0)
    expect(idx.get('net_b')).toBe(1)
  })
})

// ===========================================================================
// 4. Resistor stamps
// ===========================================================================

describe('stampResistor', () => {
  test('stamps ±1/R into the right cells for two non-ground nets', () => {
    const nodeIndex = new Map<string, number>([
      ['net_a', 0],
      ['net_b', 1],
    ])
    const M = math.zeros(2, 2)
    const inst: Instance = {
      id: 'r1',
      kind_ref: 'primitive_device',
      definition: 'resistor',
      parameters: { resistance: { value: { kind: 'scalar', amount: 100, unit: 'ohm' } } },
      connects: [
        { net: 'net_a', terminal: 'terminal_a', of: 'r1' },
        { net: 'net_b', terminal: 'terminal_b', of: 'r1' },
      ],
    }

    const ok = stampResistor(inst, nodeIndex, M)
    expect(ok).toBe(true)

    // 1/100 = 0.01 conductance
    // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix get is polymorphic
    const m: any = M
    expect(m.get([0, 0])).toBeCloseTo(0.01, 9)
    expect(m.get([1, 1])).toBeCloseTo(0.01, 9)
    expect(m.get([0, 1])).toBeCloseTo(-0.01, 9)
    expect(m.get([1, 0])).toBeCloseTo(-0.01, 9)
  })

  test('omits ground-side rows/cols when one terminal is on ground', () => {
    // net_a (idx 0) — ground is excluded from nodeIndex
    const nodeIndex = new Map<string, number>([['net_a', 0]])
    const M = math.zeros(1, 1)
    const inst: Instance = {
      id: 'r1',
      kind_ref: 'primitive_device',
      definition: 'resistor',
      parameters: { resistance: { value: { kind: 'scalar', amount: 1000, unit: 'ohm' } } },
      connects: [
        { net: 'net_a', terminal: 'terminal_a', of: 'r1' },
        { net: 'net_gnd', terminal: 'terminal_b', of: 'r1' }, // grounded
      ],
    }

    const ok = stampResistor(inst, nodeIndex, M)
    expect(ok).toBe(true)

    // Only [0][0] gets stamped; +1/1000 = 0.001
    // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix get is polymorphic
    const m: any = M
    expect(m.get([0, 0])).toBeCloseTo(0.001, 9)
  })

  test('returns false when resistance is missing', () => {
    const nodeIndex = new Map<string, number>([
      ['net_a', 0],
      ['net_b', 1],
    ])
    const M = math.zeros(2, 2)
    const inst: Instance = {
      id: 'r1',
      kind_ref: 'primitive_device',
      definition: 'resistor',
      // no parameters.resistance
      connects: [
        { net: 'net_a', terminal: 'terminal_a', of: 'r1' },
        { net: 'net_b', terminal: 'terminal_b', of: 'r1' },
      ],
    }
    const ok = stampResistor(inst, nodeIndex, M)
    expect(ok).toBe(false)
  })
})

// ===========================================================================
// 5. solveDC end-to-end (partial — S14-v3-3 has no voltage source yet)
// ===========================================================================

describe('solveDC (S14-v3-3 partial)', () => {
  test('returns no-ground status when world has no ground net', () => {
    const world = emptyWorld()
    world.nets.set('net_a', {
      id: 'net_a',
      kind: 'net',
      members: [
        { instance: 'i1', terminal: 't' },
        { instance: 'i2', terminal: 't' },
      ],
    })
    const sol = solveDC(world)
    expect(sol.status).toBe('no-ground')
    expect(sol.ground).toBeUndefined()
  })

  test('returns trivial solution (all V = 0) for a resistor-only world', () => {
    // Without a driving voltage source, every node sits at ground.
    // S14-v3-3 doesn't yet stamp voltage sources; this is the expected
    // "no driving force, no current, no voltage difference" outcome.
    const world = emptyWorld()
    world.nets.set('net_gnd', {
      id: 'net_gnd',
      kind: 'net',
      type: 'ground',
      members: [
        { instance: 'r1', terminal: 'terminal_b' },
        { instance: 'r2', terminal: 'terminal_b' },
      ],
    })
    world.nets.set('net_a', {
      id: 'net_a',
      kind: 'net',
      members: [
        { instance: 'r1', terminal: 'terminal_a' },
        { instance: 'r2', terminal: 'terminal_a' },
      ],
    })
    world.instances.set('r1', {
      id: 'r1',
      kind_ref: 'primitive_device',
      definition: 'resistor',
      parameters: { resistance: { value: { kind: 'scalar', amount: 100, unit: 'ohm' } } },
      connects: [
        { net: 'net_a', terminal: 'terminal_a', of: 'r1' },
        { net: 'net_gnd', terminal: 'terminal_b', of: 'r1' },
      ],
    })
    world.instances.set('r2', {
      id: 'r2',
      kind_ref: 'primitive_device',
      definition: 'resistor',
      parameters: { resistance: { value: { kind: 'scalar', amount: 200, unit: 'ohm' } } },
      connects: [
        { net: 'net_a', terminal: 'terminal_a', of: 'r2' },
        { net: 'net_gnd', terminal: 'terminal_b', of: 'r2' },
      ],
    })

    const sol = solveDC(world)
    expect(sol.status).toBe('solved')
    expect(sol.ground).toBe('net_gnd')
    expect(sol.nodes.get('net_gnd')).toBe(0)
    // net_a sits at 0 V too — no driving force in the system.
    expect(sol.nodes.get('net_a')).toBeCloseTo(0, 9)
  })
})
