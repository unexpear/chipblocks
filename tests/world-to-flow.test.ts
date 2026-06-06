/**
 * world-to-flow mapping tests (S18-v3-3; wire-as-edge in S19-v3-9).
 *
 * The catalog→canvas transform is a pure function; these tests exercise it with
 * a constructed World (no DOM, no Vite). A `wire` instance is NOT a node — it
 * collapses into a wire-EDGE between the components on its nets.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { parse as parseYAML } from 'yaml'
import type {
  ActiveVariableEntry,
  BehaviorEntry,
  Definition,
  Instance,
  Net,
  World,
} from '../src/cross-fk-validator.ts'
import { worldToFlow } from '../src/renderer/world-to-flow.ts'

function loadWorld(dir: string): World {
  const definitions = new Map<string, Definition>()
  const instances = new Map<string, Instance>()
  const behaviors = new Map<string, BehaviorEntry>()
  const activeVariables = new Map<string, ActiveVariableEntry>()
  const nets = new Map<string, Net>()
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.yaml'))) {
    const data = parseYAML(readFileSync(join(dir, file), 'utf-8')) as Record<string, unknown>
    const id = typeof data.id === 'string' ? data.id : undefined
    if (id === undefined) continue
    if (data.kind === 'behavior') behaviors.set(id, data as unknown as BehaviorEntry)
    else if (data.kind === 'active_variable')
      activeVariables.set(id, data as unknown as ActiveVariableEntry)
    else if (data.kind === 'net') nets.set(id, data as unknown as Net)
    else if ('kind' in data) definitions.set(id, data as unknown as Definition)
    else if ('kind_ref' in data) instances.set(id, data as unknown as Instance)
  }
  return { definitions, instances, behaviors, activeVariables, nets }
}

const emptyWorld = (): World => ({
  definitions: new Map(),
  instances: new Map(),
  behaviors: new Map(),
  activeVariables: new Map(),
  nets: new Map(),
})

describe('worldToFlow', () => {
  test('a node per circuit component; wires and idle instances are not nodes', () => {
    const world = emptyWorld()
    world.instances.set('r1', {
      id: 'r1',
      kind_ref: 'primitive_device',
      definition: 'resistor',
      connects: [
        { net: 'n1', terminal: 'terminal_a', of: 'r1' },
        { net: 'n2', terminal: 'terminal_b', of: 'r1' },
      ],
    })
    world.instances.set('w1', {
      id: 'w1',
      kind_ref: 'primitive_device',
      definition: 'wire', // a wire is a connection, not a node
      connects: [
        { net: 'n2', terminal: 'terminal_a', of: 'w1' },
        { net: 'n3', terminal: 'terminal_b', of: 'w1' },
      ],
    })
    world.instances.set('idle', {
      id: 'idle',
      kind_ref: 'primitive_device',
      definition: 'led', // no connects → not part of any circuit
    })
    const { nodes } = worldToFlow(world)
    expect(nodes.map((n) => n.id)).toEqual(['r1'])
  })

  test('a wire instance collapses into a wire-edge between its components', () => {
    const world = emptyWorld()
    world.instances.set('bat', {
      id: 'bat',
      kind_ref: 'primitive_device',
      definition: 'power_source',
      connects: [
        { net: 'np', terminal: 'terminal_positive', of: 'bat' },
        { net: 'nn', terminal: 'terminal_negative', of: 'bat' },
      ],
    })
    world.instances.set('sw', {
      id: 'sw',
      kind_ref: 'primitive_device',
      definition: 'switch_spst_toggle',
      connects: [
        { net: 'nw', terminal: 'terminal_in', of: 'sw' },
        { net: 'nn', terminal: 'terminal_out', of: 'sw' },
      ],
    })
    world.instances.set('w', {
      id: 'w',
      kind_ref: 'primitive_device',
      definition: 'wire',
      connects: [
        { net: 'np', terminal: 'terminal_a', of: 'w' },
        { net: 'nw', terminal: 'terminal_b', of: 'w' },
      ],
    })
    world.nets.set('np', {
      id: 'np',
      kind: 'net',
      members: [
        { instance: 'bat', terminal: 'terminal_positive' },
        { instance: 'w', terminal: 'terminal_a' },
      ],
    })
    world.nets.set('nw', {
      id: 'nw',
      kind: 'net',
      members: [
        { instance: 'w', terminal: 'terminal_b' },
        { instance: 'sw', terminal: 'terminal_in' },
      ],
    })
    world.nets.set('nn', {
      id: 'nn',
      kind: 'net',
      members: [
        { instance: 'bat', terminal: 'terminal_negative' },
        { instance: 'sw', terminal: 'terminal_out' },
      ],
    })
    const { nodes, edges } = worldToFlow(world)
    expect(nodes.map((n) => n.id).sort()).toEqual(['bat', 'sw']) // no wire node

    const wireEdge = edges.find((e) => e.kind === 'wire' && e.ref === 'w')
    expect(wireEdge).toBeDefined()
    expect([wireEdge?.source, wireEdge?.target].sort()).toEqual(['bat', 'sw'])
    expect(wireEdge?.source).toBe('bat') // the terminal_a (positive) side
    expect(wireEdge?.sourceOnPositiveSide).toBe(true)

    // the direct net 'nn' (battery− ↔ switch out) is a net-edge
    const netEdge = edges.find((e) => e.kind === 'net' && e.ref === 'nn')
    expect(netEdge).toBeDefined()
  })

  test('a multi-component net labels exactly one of its star edges', () => {
    const world = emptyWorld()
    for (const id of ['a', 'b', 'c']) {
      world.instances.set(id, {
        id,
        kind_ref: 'primitive_device',
        definition: 'resistor',
        connects: [{ net: 'j', terminal: 'terminal_a', of: id }],
      })
    }
    world.nets.set('j', {
      id: 'j',
      kind: 'net',
      members: [
        { instance: 'a', terminal: 'terminal_a' },
        { instance: 'b', terminal: 'terminal_a' },
        { instance: 'c', terminal: 'terminal_a' },
      ],
    })
    const { edges } = worldToFlow(world)
    const j = edges.filter((e) => e.ref === 'j')
    expect(j.length).toBe(2) // star a-b, a-c
    expect(j.filter((e) => e.showLabel).length).toBe(1)
  })

  test('node positions are deterministic (stable across runs)', () => {
    const world = emptyWorld()
    world.instances.set('x', {
      id: 'x',
      kind_ref: 'primitive_device',
      definition: 'resistor',
      connects: [{ net: 'n', terminal: 'terminal_a', of: 'x' }],
    })
    const a = worldToFlow(world)
    const b = worldToFlow(world)
    expect(a.nodes[0]?.position).toEqual(b.nodes[0]?.position)
  })

  test('end-to-end on the real anchor-circuit fixtures: 5 components, wires are edges', () => {
    const world = loadWorld('fixtures/valid')
    const { nodes, edges } = worldToFlow(world)
    const nodeIds = new Set(nodes.map((n) => n.id))

    // the five real components are nodes
    for (const id of ['battery_9v_001', 'switch_001', 'resistor_001', 'led_001', 'ground_001']) {
      expect(nodeIds.has(id)).toBe(true)
    }
    expect(nodes.length).toBe(5)
    // wires are connections, not nodes
    expect(nodeIds.has('wire_001')).toBe(false)
    expect(nodeIds.has('wire_002')).toBe(false)
    // idle catalog LEDs excluded
    expect(nodeIds.has('led_002')).toBe(false)
    expect(nodeIds.has('led_005')).toBe(false)

    // the two wire instances collapse into wire-edges
    const wireRefs = edges
      .filter((e) => e.kind === 'wire')
      .map((e) => e.ref)
      .sort()
    expect(wireRefs).toEqual(['wire_001', 'wire_002'])

    // every edge connects two instances present as nodes
    for (const e of edges) {
      expect(nodeIds.has(e.source)).toBe(true)
      expect(nodeIds.has(e.target)).toBe(true)
    }
  })
})
