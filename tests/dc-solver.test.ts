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
  stampVoltageSource,
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
// 4b. Voltage source stamps (S14-v3-4)
// ===========================================================================

describe('stampVoltageSource', () => {
  test('stamps the MNA pattern for a source between two non-ground nets', () => {
    // 2 nets (idx 0 and 1) + 1 voltage source = matrix size 3×3.
    const nodeIndex = new Map<string, number>([
      ['net_a', 0],
      ['net_b', 1],
    ])
    const M = math.zeros(3, 3)
    const b = math.zeros(3, 1)
    const auxIdx = 2

    const inst: Instance = {
      id: 'v1',
      kind_ref: 'primitive_device',
      definition: 'power_source',
      parameters: {
        nominal_voltage: { value: { kind: 'scalar', amount: 9, unit: 'volt' } },
      },
      connects: [
        { net: 'net_a', terminal: 'terminal_positive', of: 'v1' },
        { net: 'net_b', terminal: 'terminal_negative', of: 'v1' },
      ],
    }

    const ok = stampVoltageSource(inst, nodeIndex, auxIdx, M, b)
    expect(ok).toBe(true)

    // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix get is polymorphic
    const m: any = M
    // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix get is polymorphic
    const bv: any = b

    // Current contribution to KCL rows:
    // M[A][aux] = +1, M[B][aux] = -1
    expect(m.get([0, 2])).toBe(1)
    expect(m.get([1, 2])).toBe(-1)
    // Constraint row: M[aux][A] = +1, M[aux][B] = -1
    expect(m.get([2, 0])).toBe(1)
    expect(m.get([2, 1])).toBe(-1)
    // Source vector: b[aux] = V_src
    expect(bv.get([2, 0])).toBe(9)
  })

  test('omits ground-side rows/cols when the negative terminal is on ground', () => {
    // 1 non-ground net (net_a, idx 0) + 1 source = matrix size 2×2.
    const nodeIndex = new Map<string, number>([['net_a', 0]])
    const M = math.zeros(2, 2)
    const b = math.zeros(2, 1)
    const auxIdx = 1

    const inst: Instance = {
      id: 'v1',
      kind_ref: 'primitive_device',
      definition: 'power_source',
      parameters: {
        nominal_voltage: { value: { kind: 'scalar', amount: 9, unit: 'volt' } },
      },
      connects: [
        { net: 'net_a', terminal: 'terminal_positive', of: 'v1' },
        { net: 'net_gnd', terminal: 'terminal_negative', of: 'v1' }, // ground
      ],
    }

    const ok = stampVoltageSource(inst, nodeIndex, auxIdx, M, b)
    expect(ok).toBe(true)

    // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix get is polymorphic
    const m: any = M
    // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix get is polymorphic
    const bv: any = b

    // Only positive-terminal contributions land; ground rows/cols are
    // absent from the matrix entirely.
    expect(m.get([0, 1])).toBe(1) // M[net_a][aux]
    expect(m.get([1, 0])).toBe(1) // M[aux][net_a]
    expect(bv.get([1, 0])).toBe(9)
  })

  test('returns false when nominal_voltage is missing', () => {
    const nodeIndex = new Map<string, number>([
      ['net_a', 0],
      ['net_b', 1],
    ])
    const M = math.zeros(3, 3)
    const b = math.zeros(3, 1)
    const inst: Instance = {
      id: 'v1',
      kind_ref: 'primitive_device',
      definition: 'power_source',
      // no nominal_voltage
      connects: [
        { net: 'net_a', terminal: 'terminal_positive', of: 'v1' },
        { net: 'net_b', terminal: 'terminal_negative', of: 'v1' },
      ],
    }
    const ok = stampVoltageSource(inst, nodeIndex, 2, M, b)
    expect(ok).toBe(false)
  })

  test('returns false when terminal-polarity convention is not satisfied', () => {
    const nodeIndex = new Map<string, number>([
      ['net_a', 0],
      ['net_b', 1],
    ])
    const M = math.zeros(3, 3)
    const b = math.zeros(3, 1)
    const inst: Instance = {
      id: 'v1',
      kind_ref: 'primitive_device',
      definition: 'power_source',
      parameters: {
        nominal_voltage: { value: { kind: 'scalar', amount: 9, unit: 'volt' } },
      },
      // Terminals not named with the Sprint 14 polarity convention.
      connects: [
        { net: 'net_a', terminal: 'pin_1', of: 'v1' },
        { net: 'net_b', terminal: 'pin_2', of: 'v1' },
      ],
    }
    const ok = stampVoltageSource(inst, nodeIndex, 2, M, b)
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

  test('S14-v3-4: battery + resistor — 9 V supply across 100 Ω drives expected node voltage', () => {
    // The minimum useful Sprint-14 circuit: one battery, one resistor,
    // both between the supply node and ground. By-hand math: net_a sits
    // at +9 V (set by the battery); the resistor sees 9 V across 100 Ω
    // and conducts 90 mA from net_a to ground. Branch currents land in
    // S14-v3-6; this test asserts the node-voltage answer only.
    const world = emptyWorld()
    world.nets.set('net_a', {
      id: 'net_a',
      kind: 'net',
      type: 'power',
      members: [
        { instance: 'bat', terminal: 'terminal_positive' },
        { instance: 'r1', terminal: 'terminal_a' },
      ],
    })
    world.nets.set('net_gnd', {
      id: 'net_gnd',
      kind: 'net',
      type: 'ground',
      members: [
        { instance: 'bat', terminal: 'terminal_negative' },
        { instance: 'r1', terminal: 'terminal_b' },
      ],
    })
    world.instances.set('bat', {
      id: 'bat',
      kind_ref: 'primitive_device',
      definition: 'power_source',
      parameters: {
        nominal_voltage: { value: { kind: 'scalar', amount: 9, unit: 'volt' } },
      },
      connects: [
        { net: 'net_a', terminal: 'terminal_positive', of: 'bat' },
        { net: 'net_gnd', terminal: 'terminal_negative', of: 'bat' },
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

    const sol = solveDC(world)
    expect(sol.status).toBe('solved')
    expect(sol.ground).toBe('net_gnd')
    expect(sol.nodes.get('net_gnd')).toBe(0)
    expect(sol.nodes.get('net_a')).toBeCloseTo(9, 9)
    expect(sol.warnings).toEqual([])
  })

  test('S14-v3-4: voltage source between two non-grounded nets resolves both', () => {
    // net_a — [+]V[−] — net_b — [R]R[/] — net_gnd
    //   • net_a sits at 9 V above net_b (the source enforces V_a − V_b = 9)
    //   • net_b sits at 0 V above ground because the only path from net_b
    //     to ground is through the 100 Ω resistor, but with no other current
    //     loop, the current through the resistor is zero and V_b = 0
    //     (current returns through the source's auxiliary current variable
    //     and effectively closes back through net_a — but with no resistor
    //     between net_a and ground, the only steady-state solution is
    //     V_a = 9, V_b = 0, I_source = 0).
    // This exercises the two-non-grounded-net voltage-source stamp.
    const world = emptyWorld()
    world.nets.set('net_a', {
      id: 'net_a',
      kind: 'net',
      members: [
        { instance: 'bat', terminal: 'terminal_positive' },
        { instance: 'r1', terminal: 'terminal_b' },
      ],
    })
    world.nets.set('net_b', {
      id: 'net_b',
      kind: 'net',
      members: [
        { instance: 'bat', terminal: 'terminal_negative' },
        { instance: 'r1', terminal: 'terminal_a' },
      ],
    })
    world.nets.set('net_gnd', {
      id: 'net_gnd',
      kind: 'net',
      type: 'ground',
      members: [
        { instance: 'r2', terminal: 'terminal_a' },
        { instance: 'r2', terminal: 'terminal_b' }, // self-loop ground anchor (dummy)
      ],
    })
    // Anchor net_b to ground via a large resistor so the system is non-singular.
    // (Without this, lusolve sees a singular matrix — net_b would be floating.)
    world.nets.set('net_b_to_gnd', {
      id: 'net_b_to_gnd',
      kind: 'net',
      members: [
        { instance: 'r_anchor', terminal: 'terminal_a' },
        { instance: 'r_anchor', terminal: 'terminal_b' },
      ],
    })
    world.instances.set('bat', {
      id: 'bat',
      kind_ref: 'primitive_device',
      definition: 'power_source',
      parameters: {
        nominal_voltage: { value: { kind: 'scalar', amount: 9, unit: 'volt' } },
      },
      connects: [
        { net: 'net_a', terminal: 'terminal_positive', of: 'bat' },
        { net: 'net_b', terminal: 'terminal_negative', of: 'bat' },
      ],
    })
    world.instances.set('r1', {
      id: 'r1',
      kind_ref: 'primitive_device',
      definition: 'resistor',
      parameters: { resistance: { value: { kind: 'scalar', amount: 100, unit: 'ohm' } } },
      connects: [
        { net: 'net_a', terminal: 'terminal_b', of: 'r1' },
        { net: 'net_b', terminal: 'terminal_a', of: 'r1' },
      ],
    })
    world.instances.set('r_anchor', {
      id: 'r_anchor',
      kind_ref: 'primitive_device',
      definition: 'resistor',
      parameters: { resistance: { value: { kind: 'scalar', amount: 1, unit: 'ohm' } } },
      connects: [
        { net: 'net_b', terminal: 'terminal_a', of: 'r_anchor' },
        { net: 'net_gnd', terminal: 'terminal_b', of: 'r_anchor' },
      ],
    })

    const sol = solveDC(world)
    expect(sol.status).toBe('solved')
    expect(sol.nodes.get('net_gnd')).toBe(0)
    // net_b ≈ 0 V (only the source pushes current; via the 100 Ω in the
    // bat-r1 loop the current must equal the current through r_anchor;
    // in steady-state with zero current through the loop, V_b = 0).
    // net_a = V_b + 9 = 9 V.
    expect(sol.nodes.get('net_b')).toBeCloseTo(0, 6)
    expect(sol.nodes.get('net_a')).toBeCloseTo(9, 6)
  })
})
