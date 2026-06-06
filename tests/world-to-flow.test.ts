/**
 * world-to-flow mapping tests (S18-v3-3).
 *
 * The catalog→canvas transform is a pure function; these tests exercise it
 * with a constructed World (no DOM, no Vite). The browser loader
 * (catalog-loader.ts) is verified by the actual render in S18-v3-4.
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
  test('a node per circuit-participating instance; idle instances excluded', () => {
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
    world.instances.set('idle', {
      id: 'idle',
      kind_ref: 'primitive_device',
      definition: 'led',
      // no connects → not part of any circuit
    })
    const { nodes } = worldToFlow(world)
    expect(nodes.map((n) => n.id)).toEqual(['r1'])
    expect(nodes[0]?.data.definition).toBe('resistor')
  })

  test('a 2-member net becomes one edge; a 3-member net becomes two (star)', () => {
    const world = emptyWorld()
    for (const id of ['a', 'b', 'c']) {
      world.instances.set(id, {
        id,
        kind_ref: 'primitive_device',
        definition: 'wire',
        connects: [{ net: 'n', terminal: 'terminal_a', of: id }],
      })
    }
    world.nets.set('n2', {
      id: 'n2',
      kind: 'net',
      members: [
        { instance: 'a', terminal: 'terminal_a' },
        { instance: 'b', terminal: 'terminal_a' },
      ],
    })
    world.nets.set('n3', {
      id: 'n3',
      kind: 'net',
      members: [
        { instance: 'a', terminal: 'terminal_a' },
        { instance: 'b', terminal: 'terminal_a' },
        { instance: 'c', terminal: 'terminal_a' },
      ],
    })
    const { edges } = worldToFlow(world)
    const n2 = edges.filter((e) => e.label === 'n2')
    const n3 = edges.filter((e) => e.label === 'n3')
    expect(n2.length).toBe(1)
    expect(n3.length).toBe(2)
    // star: both n3 edges originate at the first member 'a'
    expect(n3.every((e) => e.source === 'a')).toBe(true)
  })

  test('a multi-spoke net shows its label on exactly one edge (no duplicate clutter)', () => {
    const world = emptyWorld()
    for (const id of ['a', 'b', 'c']) {
      world.instances.set(id, {
        id,
        kind_ref: 'primitive_device',
        definition: 'wire',
        connects: [{ net: 'n', terminal: 'terminal_a', of: id }],
      })
    }
    world.nets.set('n3', {
      id: 'n3',
      kind: 'net',
      members: [
        { instance: 'a', terminal: 'terminal_a' },
        { instance: 'b', terminal: 'terminal_a' },
        { instance: 'c', terminal: 'terminal_a' },
      ],
    })
    const { edges } = worldToFlow(world)
    const n3 = edges.filter((e) => e.label === 'n3')
    // every spoke still carries the net id (identity), but only one renders it
    expect(n3.length).toBe(2)
    expect(n3.filter((e) => e.showLabel).length).toBe(1)
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

  test('end-to-end on the real anchor-circuit fixtures', () => {
    // The 7 connected instances (battery, 2 wires, switch, resistor, led_001,
    // ground) become nodes; the idle catalog LEDs (led_002..005) do not.
    const world = loadWorld('fixtures/valid')
    const { nodes, edges } = worldToFlow(world)
    const nodeIds = new Set(nodes.map((n) => n.id))

    expect(nodeIds.has('battery_9v_001')).toBe(true)
    expect(nodeIds.has('resistor_001')).toBe(true)
    expect(nodeIds.has('led_001')).toBe(true)
    expect(nodeIds.has('ground_001')).toBe(true)
    expect(nodeIds.has('led_002')).toBe(false) // idle catalog example
    expect(nodeIds.has('led_005')).toBe(false)

    // Every edge connects two instances that are present as nodes.
    for (const e of edges) {
      expect(nodeIds.has(e.source)).toBe(true)
      expect(nodeIds.has(e.target)).toBe(true)
    }
    // The 6 anchor-circuit nets produce at least 6 edges (one 3-member net
    // — net_battery_neg with the ground port — yields 2).
    expect(edges.length).toBeGreaterThanOrEqual(6)
  })
})
