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

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { parse as parseYAML } from 'yaml'
import {
  type ActiveVariableEntry,
  type BehaviorEntry,
  type Definition,
  type Instance,
  type Net,
  validateWorld,
  type World,
} from '../src/cross-fk-validator.ts'
import {
  assignNodeIndices,
  computeResistorCurrent,
  identifyGround,
  mathInstance as math,
  solveDC,
  stampClosedSwitch,
  stampLED,
  stampResistor,
  stampVoltageSource,
  stampWireAsShort,
} from '../src/dc-solver.ts'

// Helper: load every *.yaml in `dir` into a World, sorting by kind.
// (Same shape as the loader in cross-fk.test.ts — inlined here so this
// suite stays self-contained.)
function loadWorld(dir: string): World {
  const definitions = new Map<string, Definition>()
  const instances = new Map<string, Instance>()
  const behaviors = new Map<string, BehaviorEntry>()
  const activeVariables = new Map<string, ActiveVariableEntry>()
  const nets = new Map<string, Net>()

  const files = readdirSync(dir).filter((f) => f.endsWith('.yaml'))
  for (const file of files) {
    const raw = readFileSync(join(dir, file), 'utf-8')
    const data = parseYAML(raw) as Record<string, unknown>
    const id = typeof data.id === 'string' ? data.id : undefined
    if (id === undefined) throw new Error(`${file}: missing or non-string 'id' field`)

    if (data.kind === 'behavior') {
      behaviors.set(id, data as unknown as BehaviorEntry)
    } else if (data.kind === 'active_variable') {
      activeVariables.set(id, data as unknown as ActiveVariableEntry)
    } else if (data.kind === 'net') {
      nets.set(id, data as unknown as Net)
    } else if ('kind' in data) {
      definitions.set(id, data as unknown as Definition)
    } else if ('kind_ref' in data) {
      instances.set(id, data as unknown as Instance)
    } else {
      throw new Error(`${file}: fixture has neither 'kind' nor 'kind_ref'`)
    }
  }

  return { definitions, instances, behaviors, activeVariables, nets }
}

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
  // Helper: a ground port instance attached to `net`.
  const groundPort = (id: string, net: string): Instance => ({
    id,
    kind_ref: 'primitive_device',
    definition: 'ground',
    connects: [{ net, terminal: 'reference_terminal', of: id }],
  })

  test('S16-v3-6: a ground port designates its net (no type: ground needed)', () => {
    const world = emptyWorld()
    world.nets.set('net_a', {
      id: 'net_a',
      kind: 'net',
      members: [
        { instance: 'gp', terminal: 'reference_terminal' },
        { instance: 'x', terminal: 't' },
      ],
    })
    world.instances.set('gp', groundPort('gp', 'net_a'))
    const warnings: string[] = []
    expect(identifyGround(world, undefined, warnings)).toBe('net_a')
    expect(warnings).toEqual([])
  })

  test('S16-v3-6: ground port takes PRECEDENCE over a type: ground net', () => {
    // net_typed has type: ground; net_port has a ground port. The port wins.
    const world = emptyWorld()
    world.nets.set('net_typed', {
      id: 'net_typed',
      kind: 'net',
      type: 'ground',
      members: [
        { instance: 'a', terminal: 't' },
        { instance: 'b', terminal: 't' },
      ],
    })
    world.nets.set('net_port', {
      id: 'net_port',
      kind: 'net',
      members: [
        { instance: 'gp', terminal: 'reference_terminal' },
        { instance: 'c', terminal: 't' },
      ],
    })
    world.instances.set('gp', groundPort('gp', 'net_port'))
    const warnings: string[] = []
    expect(identifyGround(world, undefined, warnings)).toBe('net_port')
  })

  test('S16-v3-6: SolveOptions.ground still overrides a ground port', () => {
    const world = emptyWorld()
    world.nets.set('net_a', {
      id: 'net_a',
      kind: 'net',
      members: [
        { instance: 'x', terminal: 't' },
        { instance: 'y', terminal: 't' },
      ],
    })
    world.nets.set('net_port', {
      id: 'net_port',
      kind: 'net',
      members: [
        { instance: 'gp', terminal: 'reference_terminal' },
        { instance: 'c', terminal: 't' },
      ],
    })
    world.instances.set('gp', groundPort('gp', 'net_port'))
    const warnings: string[] = []
    expect(identifyGround(world, { ground: 'net_a' }, warnings)).toBe('net_a')
  })

  test('S16-v3-6: multiple ground ports warn and pick the first', () => {
    const world = emptyWorld()
    for (const n of ['net_p1', 'net_p2']) {
      world.nets.set(n, {
        id: n,
        kind: 'net',
        members: [
          { instance: `gp_${n}`, terminal: 'reference_terminal' },
          { instance: 'x', terminal: 't' },
        ],
      })
      world.instances.set(`gp_${n}`, groundPort(`gp_${n}`, n))
    }
    const warnings: string[] = []
    const g = identifyGround(world, undefined, warnings)
    expect(g === 'net_p1' || g === 'net_p2').toBe(true)
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain('Multiple ground ports')
  })

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
// 4c. LED, switch, wire stamps (S14-v3-5) — all voltage-source-like
// ===========================================================================

describe('stampLED', () => {
  test('stamps as voltage source with V = forward_voltage between anode and cathode', () => {
    const nodeIndex = new Map<string, number>([
      ['net_anode', 0],
      ['net_cathode', 1],
    ])
    const M = math.zeros(3, 3)
    const b = math.zeros(3, 1)
    const auxIdx = 2

    const inst: Instance = {
      id: 'led_001',
      kind_ref: 'primitive_device',
      definition: 'led',
      parameters: {
        forward_voltage: { value: { kind: 'scalar', amount: 2.0, unit: 'volt' } },
      },
      connects: [
        { net: 'net_anode', terminal: 'anode', of: 'led_001' },
        { net: 'net_cathode', terminal: 'cathode', of: 'led_001' },
      ],
    }

    const ok = stampLED(inst, nodeIndex, auxIdx, M, b)
    expect(ok).toBe(true)

    // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
    const m: any = M
    // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
    const bv: any = b
    expect(m.get([0, 2])).toBe(1)
    expect(m.get([1, 2])).toBe(-1)
    expect(m.get([2, 0])).toBe(1)
    expect(m.get([2, 1])).toBe(-1)
    expect(bv.get([2, 0])).toBe(2.0)
  })

  test('returns false when forward_voltage is missing', () => {
    const nodeIndex = new Map<string, number>([
      ['net_anode', 0],
      ['net_cathode', 1],
    ])
    const inst: Instance = {
      id: 'led_001',
      kind_ref: 'primitive_device',
      definition: 'led',
      connects: [
        { net: 'net_anode', terminal: 'anode', of: 'led_001' },
        { net: 'net_cathode', terminal: 'cathode', of: 'led_001' },
      ],
    }
    const ok = stampLED(inst, new Map(), 2, math.zeros(3, 3), math.zeros(3, 1))
    expect(ok).toBe(false)
    // nodeIndex unused in the no-V_F early-return path
    expect(nodeIndex.size).toBe(2)
  })
})

describe('stampClosedSwitch', () => {
  test('stamps as 0 V ideal source between terminal_in and terminal_out', () => {
    const nodeIndex = new Map<string, number>([
      ['net_in', 0],
      ['net_out', 1],
    ])
    const M = math.zeros(3, 3)
    const b = math.zeros(3, 1)
    const auxIdx = 2

    const inst: Instance = {
      id: 'sw1',
      kind_ref: 'primitive_device',
      definition: 'switch_spst_toggle',
      connects: [
        { net: 'net_in', terminal: 'terminal_in', of: 'sw1' },
        { net: 'net_out', terminal: 'terminal_out', of: 'sw1' },
      ],
    }

    const ok = stampClosedSwitch(inst, nodeIndex, auxIdx, M, b)
    expect(ok).toBe(true)

    // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
    const m: any = M
    // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
    const bv: any = b
    expect(m.get([0, 2])).toBe(1)
    expect(m.get([1, 2])).toBe(-1)
    expect(m.get([2, 0])).toBe(1)
    expect(m.get([2, 1])).toBe(-1)
    // V_src = 0 for an ideal closed switch — constraint V_in = V_out
    expect(bv.get([2, 0])).toBe(0)
  })
})

describe('stampWireAsShort', () => {
  test('stamps as 0 V ideal source between terminal_a and terminal_b', () => {
    const nodeIndex = new Map<string, number>([
      ['net_a', 0],
      ['net_b', 1],
    ])
    const M = math.zeros(3, 3)
    const b = math.zeros(3, 1)
    const auxIdx = 2

    const inst: Instance = {
      id: 'w1',
      kind_ref: 'primitive_device',
      definition: 'wire',
      connects: [
        { net: 'net_a', terminal: 'terminal_a', of: 'w1' },
        { net: 'net_b', terminal: 'terminal_b', of: 'w1' },
      ],
    }

    const ok = stampWireAsShort(inst, nodeIndex, auxIdx, M, b)
    expect(ok).toBe(true)

    // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
    const m: any = M
    // biome-ignore lint/suspicious/noExplicitAny: mathjs Matrix is polymorphic
    const bv: any = b
    expect(m.get([0, 2])).toBe(1)
    expect(m.get([1, 2])).toBe(-1)
    expect(m.get([2, 0])).toBe(1)
    expect(m.get([2, 1])).toBe(-1)
    expect(bv.get([2, 0])).toBe(0)
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

    // S14-v3-6: branch currents reported
    // I_resistor = (V_a - V_b) / R = (9 - 0) / 100 = 90 mA, positive sign
    // (current flows from terminal_a on net_a toward terminal_b on net_gnd).
    expect(sol.branches.get('r1')).toBeCloseTo(0.09, 9)
    // I_battery: per §18.6 convention, positive = current entering positive
    // terminal. The battery is sourcing power — current exits + terminal
    // into the external circuit — so I_battery is negative: -90 mA.
    expect(sol.branches.get('bat')).toBeCloseTo(-0.09, 9)
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

  test('S14-v3-5: 9 V battery + 100 Ω resistor + LED (V_F = 2 V) — three-node loop', () => {
    // Single-loop circuit with all S14-v3-5 element types:
    //   net_a = battery+ — [bat 9V] — net_gnd (ground via battery-)
    //   net_a — [r1 100Ω] — net_b
    //   net_b — [led V_F=2V] — net_gnd
    // The LED's fixed-V_F constraint forces V_b - V_gnd = 2 V, so net_b = 2 V.
    // The battery forces V_a = 9 V (relative to ground).
    // The current (computed in S14-v3-6) would be (9 - 2) / 100 = 70 mA.
    const world = emptyWorld()
    world.nets.set('net_a', {
      id: 'net_a',
      kind: 'net',
      members: [
        { instance: 'bat', terminal: 'terminal_positive' },
        { instance: 'r1', terminal: 'terminal_a' },
      ],
    })
    world.nets.set('net_b', {
      id: 'net_b',
      kind: 'net',
      members: [
        { instance: 'r1', terminal: 'terminal_b' },
        { instance: 'led_1', terminal: 'anode' },
      ],
    })
    world.nets.set('net_gnd', {
      id: 'net_gnd',
      kind: 'net',
      type: 'ground',
      members: [
        { instance: 'bat', terminal: 'terminal_negative' },
        { instance: 'led_1', terminal: 'cathode' },
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
        { net: 'net_b', terminal: 'terminal_b', of: 'r1' },
      ],
    })
    world.instances.set('led_1', {
      id: 'led_1',
      kind_ref: 'primitive_device',
      definition: 'led',
      parameters: {
        forward_voltage: { value: { kind: 'scalar', amount: 2.0, unit: 'volt' } },
      },
      connects: [
        { net: 'net_b', terminal: 'anode', of: 'led_1' },
        { net: 'net_gnd', terminal: 'cathode', of: 'led_1' },
      ],
    })

    const sol = solveDC(world)
    expect(sol.status).toBe('solved')
    expect(sol.ground).toBe('net_gnd')
    expect(sol.nodes.get('net_gnd')).toBe(0)
    expect(sol.nodes.get('net_a')).toBeCloseTo(9, 9)
    expect(sol.nodes.get('net_b')).toBeCloseTo(2, 9)
    expect(sol.warnings).toEqual([])

    // S14-v3-6: the load-bearing 70 mA result.
    // I_resistor = (9 - 2) / 100 = 70 mA, positive (a → b flow).
    expect(sol.branches.get('r1')).toBeCloseTo(0.07, 9)
    // I_LED = +70 mA (current enters anode = forward bias, conducting).
    expect(sol.branches.get('led_1')).toBeCloseTo(0.07, 9)
    // I_battery = -70 mA (sourcing — current exits + terminal externally).
    expect(sol.branches.get('bat')).toBeCloseTo(-0.07, 9)
  })
})

// ===========================================================================
// 6. Branch current helpers (S14-v3-6)
// ===========================================================================

describe('computeResistorCurrent', () => {
  test('I = (V_a - V_b) / R from solved node voltages', () => {
    const nodes = new Map<string, number>([
      ['net_x', 5],
      ['net_y', 2],
    ])
    const inst: Instance = {
      id: 'r1',
      kind_ref: 'primitive_device',
      definition: 'resistor',
      parameters: { resistance: { value: { kind: 'scalar', amount: 100, unit: 'ohm' } } },
      connects: [
        { net: 'net_x', terminal: 'terminal_a', of: 'r1' },
        { net: 'net_y', terminal: 'terminal_b', of: 'r1' },
      ],
    }
    // (5 - 2) / 100 = 0.03 A = 30 mA
    expect(computeResistorCurrent(inst, nodes)).toBeCloseTo(0.03, 9)
  })

  test('negative when V_a < V_b (current flows b → a through the resistor)', () => {
    const nodes = new Map<string, number>([
      ['net_x', 2],
      ['net_y', 5],
    ])
    const inst: Instance = {
      id: 'r1',
      kind_ref: 'primitive_device',
      definition: 'resistor',
      parameters: { resistance: { value: { kind: 'scalar', amount: 100, unit: 'ohm' } } },
      connects: [
        { net: 'net_x', terminal: 'terminal_a', of: 'r1' },
        { net: 'net_y', terminal: 'terminal_b', of: 'r1' },
      ],
    }
    // (2 - 5) / 100 = -0.03 A
    expect(computeResistorCurrent(inst, nodes)).toBeCloseTo(-0.03, 9)
  })

  test('returns undefined when terminals are not the a/b convention', () => {
    const nodes = new Map<string, number>([
      ['net_x', 5],
      ['net_y', 2],
    ])
    const inst: Instance = {
      id: 'r1',
      kind_ref: 'primitive_device',
      definition: 'resistor',
      parameters: { resistance: { value: { kind: 'scalar', amount: 100, unit: 'ohm' } } },
      connects: [
        { net: 'net_x', terminal: 'pin_1', of: 'r1' },
        { net: 'net_y', terminal: 'pin_2', of: 'r1' },
      ],
    }
    expect(computeResistorCurrent(inst, nodes)).toBeUndefined()
  })
})

// ===========================================================================
// 7. End-to-end on the educational anchor circuit (S14-v3-7)
// ===========================================================================

describe('solveDC end-to-end: educational anchor circuit', () => {
  test('YAML on disk → cross-FK clean → solveDC produces the Shockley 69.36 mA result', () => {
    // The full pipeline: load all valid fixtures, verify cross-FK reports
    // zero errors (the Sprint 13 invariants hold), then run the DC solver
    // on the resulting world.
    //
    // The circuit: 9 V battery → wire_001 → switch_001 (closed) →
    // resistor_001 (100 Ω) → led_001 (V_F = 2 V) → wire_002 → ground.
    //
    // Expected node voltages (relative to net_battery_neg = 0 V). Sprint 16
    // switched led_001 to the Shockley model (it has forward_voltage +
    // max_forward_current, the calibration point), so the LED settles at
    // 2.064 V — not exactly 2.0 V — at the operating current of 69.36 mA:
    //   net_battery_pos      = 9.0    (battery sets)
    //   net_wire1_switch     = 9.0    (wire is ideal short)
    //   net_switch_resistor  = 9.0    (closed switch is ideal short)
    //   net_resistor_led     = 2.064  (Shockley LED voltage at 69.36 mA)
    //   net_led_wire2        = 0.0    (wire is ideal short to ground)
    //   net_battery_neg      = 0.0    (ground reference)
    //
    // Expected branch currents (all 69.36 mA = (9 - 2.064) / 100):
    //   battery_9v_001 = -0.06936  (sourcing — exits + terminal externally)
    //   the rest       = +0.06936  (series circuit)
    // This is the §20.10 accuracy upgrade: fixed-V_F gave 70.00 mA; Shockley
    // gives 69.36 mA. The difference is ~0.9% — validating §19.7.
    const world = loadWorld('fixtures/valid')

    // Pre-flight: cross-FK must be clean on the valid world (re-verified
    // here so a regression in another sprint surfaces clearly in this test
    // before it tries to solve a broken world).
    const fkErrors = validateWorld(world)
    if (fkErrors.length > 0) {
      throw new Error(
        `Cross-FK should report zero errors on the valid world; got ${fkErrors.length}:\n` +
          fkErrors.map((e) => JSON.stringify(e)).join('\n'),
      )
    }

    const sol = solveDC(world)
    expect(sol.status).toBe('solved')
    expect(sol.ground).toBe('net_battery_neg')
    expect(sol.warnings).toEqual([])
    // Nonlinear solve: converged in a handful of Newton-Raphson iterations.
    expect(sol.converged).toBe(true)
    expect(sol.iterations).toBeGreaterThan(1)
    expect(sol.iterations).toBeLessThan(100)

    // Node voltages
    expect(sol.nodes.get('net_battery_pos')).toBeCloseTo(9, 9)
    expect(sol.nodes.get('net_wire1_switch')).toBeCloseTo(9, 9)
    expect(sol.nodes.get('net_switch_resistor')).toBeCloseTo(9, 9)
    expect(sol.nodes.get('net_resistor_led')).toBeCloseTo(2.0643, 3)
    expect(sol.nodes.get('net_led_wire2')).toBeCloseTo(0, 9)
    expect(sol.nodes.get('net_battery_neg')).toBe(0)

    // Branch currents — the Shockley 69.36 mA result
    expect(sol.branches.get('battery_9v_001')).toBeCloseTo(-0.069357, 6)
    expect(sol.branches.get('wire_001')).toBeCloseTo(0.069357, 6)
    expect(sol.branches.get('switch_001')).toBeCloseTo(0.069357, 6)
    expect(sol.branches.get('resistor_001')).toBeCloseTo(0.069357, 6)
    expect(sol.branches.get('led_001')).toBeCloseTo(0.069357, 6)
    expect(sol.branches.get('wire_002')).toBeCloseTo(0.069357, 6)
  })

  test('the LED current is ~3.47× the max_forward_current rating (Shockley; sets up Sprint 15)', () => {
    // Sprint 14 faithfully reports the computed current; Sprint 15's
    // failure-mode check will fire led-overloaded on this same circuit.
    // This test documents the deliberate ratings overshoot in the
    // fixture so the cross-sprint chain has a real triggering case.
    const world = loadWorld('fixtures/valid')
    const sol = solveDC(world)

    const I_led = sol.branches.get('led_001')
    expect(I_led).toBeDefined()
    if (I_led === undefined) return

    // Pull the LED's declared max_forward_current from the instance directly.
    const led = world.instances.get('led_001')
    expect(led).toBeDefined()
    if (led === undefined) return

    // biome-ignore lint/suspicious/noExplicitAny: instance.parameters value is unknown by design
    const maxParam = (led.parameters?.max_forward_current?.value as any)?.amount
    expect(typeof maxParam).toBe('number')

    // The Shockley current (~69.36 mA) exceeds the rated max (20 mA) at ~3.47×.
    expect(Math.abs(I_led)).toBeGreaterThan(maxParam)
    expect(Math.abs(I_led) / maxParam).toBeCloseTo(3.468, 2)
  })
})

// ===========================================================================
// 8. Newton-Raphson nonlinear solve (S16-v3-4)
// ===========================================================================

describe('solveDC — Shockley / Newton-Raphson', () => {
  // A minimal 5 V battery + 100 Ω + Shockley LED (calibrated at V_F=2 V @
  // 20 mA, n=2) in isolation. By-hand: solving 5 = 100·I + V_LED(I) gives
  // I ≈ 29.79 mA with the LED at ≈2.021 V.
  function minimalDiodeCircuit(): World {
    const w: World = {
      definitions: new Map(),
      instances: new Map(),
      behaviors: new Map(),
      activeVariables: new Map(),
      nets: new Map(),
    }
    w.nets.set('na', {
      id: 'na',
      kind: 'net',
      members: [
        { instance: 'b', terminal: 'terminal_positive' },
        { instance: 'r', terminal: 'terminal_a' },
      ],
    })
    w.nets.set('nb', {
      id: 'nb',
      kind: 'net',
      members: [
        { instance: 'r', terminal: 'terminal_b' },
        { instance: 'd', terminal: 'anode' },
      ],
    })
    w.nets.set('gnd', {
      id: 'gnd',
      kind: 'net',
      type: 'ground',
      members: [
        { instance: 'b', terminal: 'terminal_negative' },
        { instance: 'd', terminal: 'cathode' },
      ],
    })
    w.instances.set('b', {
      id: 'b',
      kind_ref: 'primitive_device',
      definition: 'power_source',
      parameters: { nominal_voltage: { value: { kind: 'scalar', amount: 5, unit: 'volt' } } },
      connects: [
        { net: 'na', terminal: 'terminal_positive', of: 'b' },
        { net: 'gnd', terminal: 'terminal_negative', of: 'b' },
      ],
    })
    w.instances.set('r', {
      id: 'r',
      kind_ref: 'primitive_device',
      definition: 'resistor',
      parameters: { resistance: { value: { kind: 'scalar', amount: 100, unit: 'ohm' } } },
      connects: [
        { net: 'na', terminal: 'terminal_a', of: 'r' },
        { net: 'nb', terminal: 'terminal_b', of: 'r' },
      ],
    })
    w.instances.set('d', {
      id: 'd',
      kind_ref: 'primitive_device',
      definition: 'led',
      parameters: {
        forward_voltage: { value: { kind: 'scalar', amount: 2, unit: 'volt' } },
        max_forward_current: { value: { kind: 'scalar', amount: 0.02, unit: 'ampere' } },
      },
      connects: [
        { net: 'nb', terminal: 'anode', of: 'd' },
        { net: 'gnd', terminal: 'cathode', of: 'd' },
      ],
    })
    return w
  }

  test('converges to the hand-computed operating point (29.79 mA, 2.021 V)', () => {
    const sol = solveDC(minimalDiodeCircuit())
    expect(sol.status).toBe('solved')
    expect(sol.converged).toBe(true)
    expect(sol.iterations).toBeGreaterThan(1)
    expect(sol.branches.get('d')).toBeCloseTo(0.029794, 5)
    expect(sol.nodes.get('nb')).toBeCloseTo(2.0206, 3)
  })

  test('did-not-converge: capping maxIterations below what the circuit needs', () => {
    // The circuit needs ~4 iterations; cap at 2 → honest did-not-converge,
    // not a wrong answer.
    const sol = solveDC(minimalDiodeCircuit(), { maxIterations: 2 })
    expect(sol.status).toBe('did-not-converge')
    expect(sol.converged).toBe(false)
    expect(sol.iterations).toBe(2)
    expect(sol.branches.size).toBe(0) // no branch currents reported on failure
  })

  test('ideality_factor is read from the instance; default matches explicit n=2', () => {
    // The solver defaults to n=2 when the instance doesn't declare
    // ideality_factor. An explicit n=2 must match the default; a different
    // n (1.5) must produce a different operating current — proving the
    // parameter is actually read, not ignored.
    const setIdeality = (w: World, n: number) => {
      const led = w.instances.get('d')
      if (led?.parameters) {
        led.parameters.ideality_factor = {
          value: { kind: 'scalar', amount: n, unit: 'dimensionless' },
        }
      }
      return w
    }

    const iDefault = solveDC(minimalDiodeCircuit()).branches.get('d')
    const iExplicit2 = solveDC(setIdeality(minimalDiodeCircuit(), 2)).branches.get('d')
    const iN15 = solveDC(setIdeality(minimalDiodeCircuit(), 1.5)).branches.get('d')

    expect(iDefault).toBeDefined()
    expect(iExplicit2).toBeDefined()
    expect(iN15).toBeDefined()
    if (iDefault === undefined || iExplicit2 === undefined || iN15 === undefined) return

    // Explicit n=2 == the default.
    expect(iExplicit2).toBeCloseTo(iDefault, 9)
    // n=1.5 shifts the operating point measurably.
    expect(Math.abs(iN15 - iDefault)).toBeGreaterThan(1e-5)
  })

  test('an LED with forward_voltage but no max_forward_current uses the fixed-V_F fallback', () => {
    // No calibration current → can't derive I_s → the LED stays a fixed-V_F
    // voltage source (linear), so the solve is a single-shot linear solve.
    const w = minimalDiodeCircuit()
    const led = w.instances.get('d')
    if (led?.parameters) delete led.parameters.max_forward_current
    const sol = solveDC(w)
    expect(sol.status).toBe('solved')
    // Linear fast-path: exactly one "iteration", converged trivially.
    expect(sol.iterations).toBe(1)
    expect(sol.converged).toBe(true)
    // Fixed-V_F holds the LED at exactly 2.0 V → I = (5 − 2) / 100 = 30 mA.
    expect(sol.nodes.get('nb')).toBeCloseTo(2.0, 9)
    expect(sol.branches.get('d')).toBeCloseTo(0.03, 9)
  })
})
