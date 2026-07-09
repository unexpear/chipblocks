/**
 * User-made parts, slice 4b Model B — a custom part built from a whole INTERNAL sub-circuit of real
 * parts. At solve time the part expands exactly like a circuit block (same flattening), so the physics
 * is the drawn circuit's, not a stand-in. A module of two 50 Ω resistors in series must carry the same
 * ~89.1 mA a single 100 Ω resistor would in the reference loop — proof the internals genuinely solve.
 * Also locks: instance independence (namespacing), a behaves-as part nested INSIDE a module, the cycle
 * guard (a part containing itself must not hang), and the save-block-as-part builder.
 */
import type { Edge, Node } from '@xyflow/react'
import { afterEach, describe, expect, test } from 'vitest'
import type { BlockData } from '../src/renderer/blocks.ts'
import { canvasWorld } from '../src/renderer/pipeline/canvas-world.ts'
import { solveCanvasDispatch } from '../src/renderer/pipeline/solve-canvas.ts'
import { userPartFromBlock } from '../src/renderer/user-part-draft.ts'
import { registerUserPart, setUserParts, type UserPart } from '../src/renderer/user-parts.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const node = (id: string, definition: string, parameters?: Record<string, unknown>): Node =>
  ({
    id,
    position: { x: 0, y: 0 },
    data: { definition, ...(parameters ? { parameters } : {}) },
  }) as unknown as Node

// The internal circuit: two 50 Ω resistors in series, ports a (r1 in), b (r2 out) — 100 Ω end to end.
const seriesPair: BlockData = {
  name: 'series pair',
  origin: { x: 0, y: 0 },
  nodes: [
    { id: 'r1', definition: 'resistor', x: 0, y: 0, parameters: { resistance: scalar(50, 'ohm') } },
    {
      id: 'r2',
      definition: 'resistor',
      x: 120,
      y: 0,
      parameters: { resistance: scalar(50, 'ohm') },
    },
  ],
  edges: [
    {
      id: 'w1',
      source: 'r1',
      sourceHandle: 'terminal_b',
      target: 'r2',
      targetHandle: 'terminal_a',
    },
  ],
  ports: [
    {
      id: 'a',
      label: 'r1 · terminal_a',
      side: 'left',
      inner: { nodeId: 'r1', handleId: 'terminal_a' },
    },
    {
      id: 'b',
      label: 'r2 · terminal_b',
      side: 'right',
      inner: { nodeId: 'r2', handleId: 'terminal_b' },
    },
  ],
}

const module100: UserPart = {
  id: 'my_module',
  name: 'My Module',
  designatorPrefix: 'U',
  pins: [
    { id: 'a', name: 'A', side: 'left', electrical: 'passive' },
    { id: 'b', name: 'B', side: 'right', electrical: 'passive' },
  ],
  internal: seriesPair,
}

// The reference loop: 9 V behind 1 Ω across the module (100 Ω total inside) → ~89.1 mA.
const loop = (moduleId: string): { nodes: Node[]; edges: Edge[] } => ({
  nodes: [
    node('bat', 'power_source', {
      nominal_voltage: scalar(9, 'volt'),
      internal_resistance: scalar(1, 'ohm'),
    }),
    node('mx', moduleId),
    node('gnd', 'ground'),
  ],
  edges: [
    { id: 'e1', source: 'bat', sourceHandle: 'terminal_positive', target: 'mx', targetHandle: 'a' },
    { id: 'e2', source: 'mx', sourceHandle: 'b', target: 'bat', targetHandle: 'terminal_negative' },
    {
      id: 'e3',
      source: 'gnd',
      sourceHandle: 'reference_terminal',
      target: 'bat',
      targetHandle: 'terminal_negative',
    },
  ] as unknown as Edge[],
})

afterEach(() => setUserParts([]))

describe('an internal-circuit part expands to its REAL parts and solves', () => {
  test('canvasWorld flattens the module into its real internal resistors (namespaced)', () => {
    registerUserPart(module100)
    const { nodes, edges } = loop('my_module')
    const { world } = canvasWorld(nodes, edges)
    expect(world.instances.get('mx')).toBeUndefined() // the module itself is structure, not an element
    expect(world.instances.get('mx.r1')?.definition).toBe('resistor')
    expect(world.instances.get('mx.r2')?.definition).toBe('resistor')
  })

  test('it carries real current — two 50 Ω in series behave as the 100 Ω they are (~89.1 mA)', () => {
    registerUserPart(module100)
    const { nodes, edges } = loop('my_module')
    const result = solveCanvasDispatch(nodes, edges)
    expect(result.solution.status).toBe('solved')
    expect(Math.abs(result.solution.branches.get('mx.r1') ?? -1)).toBeCloseTo(0.0891, 4)
    expect(Math.abs(result.solution.branches.get('mx.r2') ?? -1)).toBeCloseTo(0.0891, 4)
  })

  test('two instances of the same module stay independent (namespaced internals, no collision)', () => {
    registerUserPart(module100)
    const nodes: Node[] = [
      node('bat', 'power_source', {
        nominal_voltage: scalar(9, 'volt'),
        internal_resistance: scalar(1, 'ohm'),
      }),
      node('m1', 'my_module'),
      node('m2', 'my_module'),
      node('gnd', 'ground'),
    ]
    const edges = [
      {
        id: 'e1',
        source: 'bat',
        sourceHandle: 'terminal_positive',
        target: 'm1',
        targetHandle: 'a',
      },
      { id: 'e2', source: 'm1', sourceHandle: 'b', target: 'm2', targetHandle: 'a' },
      {
        id: 'e3',
        source: 'm2',
        sourceHandle: 'b',
        target: 'bat',
        targetHandle: 'terminal_negative',
      },
      {
        id: 'e4',
        source: 'gnd',
        sourceHandle: 'reference_terminal',
        target: 'bat',
        targetHandle: 'terminal_negative',
      },
    ] as unknown as Edge[]
    const result = solveCanvasDispatch(nodes, edges)
    expect(result.solution.status).toBe('solved')
    // 9 V across 201 Ω (two 100 Ω modules + 1 Ω internal) → ~44.8 mA through every series element.
    expect(Math.abs(result.solution.branches.get('m1.r1') ?? -1)).toBeCloseTo(9 / 201, 4)
    expect(Math.abs(result.solution.branches.get('m2.r2') ?? -1)).toBeCloseTo(9 / 201, 4)
  })

  test('a behaves-as part NESTED inside a module still gets its device physics', () => {
    // The module's internals use another custom part (a behaves-as-resistor shunt) — the flatten keeps
    // its definition, and the behaviour pass (keyed by definition) still lowers it to the real device.
    registerUserPart({
      id: 'my_shunt',
      name: 'My Shunt',
      designatorPrefix: 'R',
      pins: [
        { id: 'in', name: 'IN', side: 'left', electrical: 'passive' },
        { id: 'out', name: 'OUT', side: 'right', electrical: 'passive' },
      ],
      behavesAs: { definition: 'resistor', terminals: { terminal_a: 'in', terminal_b: 'out' } },
    })
    registerUserPart({
      ...module100,
      id: 'shunt_module',
      internal: {
        name: 'shunt core',
        origin: { x: 0, y: 0 },
        nodes: [
          {
            id: 'sh',
            definition: 'my_shunt',
            x: 0,
            y: 0,
            parameters: { resistance: scalar(100, 'ohm') },
          },
        ],
        edges: [],
        ports: [
          { id: 'a', label: 'sh · in', side: 'left', inner: { nodeId: 'sh', handleId: 'in' } },
          { id: 'b', label: 'sh · out', side: 'right', inner: { nodeId: 'sh', handleId: 'out' } },
        ],
      },
    })
    const { nodes, edges } = loop('shunt_module')
    const result = solveCanvasDispatch(nodes, edges)
    expect(result.solution.status).toBe('solved')
    expect(Math.abs(result.solution.branches.get('mx.sh') ?? -1)).toBeCloseTo(0.0891, 4)
  })

  test('a part that contains ITSELF does not hang — the inner copy stays an honest black box', () => {
    const selfRef: UserPart = {
      ...module100,
      id: 'ouroboros',
      internal: {
        name: 'self',
        origin: { x: 0, y: 0 },
        nodes: [{ id: 'me', definition: 'ouroboros', x: 0, y: 0 }],
        edges: [],
        ports: [
          { id: 'a', label: 'me · a', side: 'left', inner: { nodeId: 'me', handleId: 'a' } },
          { id: 'b', label: 'me · b', side: 'right', inner: { nodeId: 'me', handleId: 'b' } },
        ],
      },
    }
    registerUserPart(selfRef)
    const { nodes, edges } = loop('ouroboros')
    const result = solveCanvasDispatch(nodes, edges) // must return, not recurse forever
    expect(result.solution.status).not.toBe('solved') // the inner black box can't be solved — honest
  })
})

describe('instrument probing — a module pin reads the REAL terminal it stands for', () => {
  test('terminalVolts carries the module’s pins (the meter/scope can probe them)', () => {
    registerUserPart(module100)
    const { nodes, edges } = loop('my_module')
    const result = solveCanvasDispatch(nodes, edges)
    // pin a = the 9 V side, pin b = the battery-negative side (0 V) — aliased through to the real
    // internal terminals, exactly like probing a block port or a multi-lead source lead.
    const pinA = result.terminalVolts.get('mx/a')
    const pinB = result.terminalVolts.get('mx/b')
    expect(pinA).toBeDefined()
    expect(pinB).toBeDefined()
    expect((pinA ?? 0) - (pinB ?? 0)).toBeCloseTo(8.91, 2) // the module drops 100 Ω of the 101 Ω loop
  })

  test('a behaves-as pin aliases to the device terminal too', () => {
    registerUserPart({
      id: 'my_shunt',
      name: 'My Shunt',
      designatorPrefix: 'R',
      pins: [
        { id: 'in', name: 'IN', side: 'left', electrical: 'passive' },
        { id: 'out', name: 'OUT', side: 'right', electrical: 'passive' },
      ],
      behavesAs: { definition: 'resistor', terminals: { terminal_a: 'in', terminal_b: 'out' } },
    })
    const nodes: Node[] = [
      node('bat', 'power_source', {
        nominal_voltage: scalar(9, 'volt'),
        internal_resistance: scalar(1, 'ohm'),
      }),
      node('rx', 'my_shunt', { resistance: scalar(100, 'ohm') }),
      node('gnd', 'ground'),
    ]
    const edges = [
      {
        id: 'e1',
        source: 'bat',
        sourceHandle: 'terminal_positive',
        target: 'rx',
        targetHandle: 'in',
      },
      {
        id: 'e2',
        source: 'rx',
        sourceHandle: 'out',
        target: 'bat',
        targetHandle: 'terminal_negative',
      },
      {
        id: 'e3',
        source: 'gnd',
        sourceHandle: 'reference_terminal',
        target: 'bat',
        targetHandle: 'terminal_negative',
      },
    ] as unknown as Edge[]
    const result = solveCanvasDispatch(nodes, edges)
    expect(result.terminalVolts.get('rx/in')).toBeDefined()
    expect(result.terminalVolts.get('rx/out')).toBeDefined()
  })
})

describe('userPartFromBlock — save a drawn block as a custom part', () => {
  const blockWithExtras = (): BlockData =>
    ({
      ...seriesPair,
      // presentation extras a canvas block can carry — deliberately NOT persisted on a part
      symbol: 'and',
      size: { width: 200, height: 100 },
      ports: [
        { ...seriesPair.ports[0], name: 'VIN', kind: 'power_positive', drive: 'input' },
        { ...seriesPair.ports[1], drive: 'push_pull' },
      ],
    }) as BlockData

  test('pins derive from the ports 1:1 (ids, sides, names, electrical from kind/drive)', () => {
    const r = userPartFromBlock('My Amp', 'U', blockWithExtras())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.part.id).toBe('my_amp')
    expect(r.part.pins).toEqual([
      { id: 'a', name: 'VIN', side: 'left', electrical: 'power_in' },
      { id: 'b', name: 'r2 · terminal_b', side: 'right', electrical: 'output' },
    ])
    expect(r.part.internal?.ports.map((p) => p.id)).toEqual(['a', 'b'])
  })

  test('the stored internals are the SOLVE CORE — presentation extras are stripped', () => {
    const r = userPartFromBlock('My Amp', 'U', blockWithExtras())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const internal = r.part.internal as BlockData & { symbol?: string; size?: unknown }
    expect(internal.symbol).toBeUndefined()
    expect(internal.size).toBeUndefined()
    expect((internal.ports[0] as { kind?: string }).kind).toBeUndefined()
  })

  test('the stored internals are a deep copy — editing the source block later can’t change the part', () => {
    const source = JSON.parse(JSON.stringify(seriesPair)) as BlockData
    const r = userPartFromBlock('Frozen', 'U', source)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const param = source.nodes[0]?.parameters?.resistance as { value: { amount: number } }
    param.value.amount = 999999
    const kept = r.part.internal?.nodes[0]?.parameters?.resistance as { value: { amount: number } }
    expect(kept.value.amount).toBe(50)
  })

  test('a block with no pins is refused (nothing to wire to)', () => {
    const r = userPartFromBlock('Sealed', 'U', { ...seriesPair, ports: [] })
    expect(r.ok).toBe(false)
  })

  test('the same name rules apply (a built-in or taken name is refused)', () => {
    registerUserPart(module100)
    expect(userPartFromBlock('My Module', 'U', seriesPair).ok).toBe(false) // taken by module100
  })

  test('an undefined edge handle is normalised to null (JSON drops undefined → the loader would reject)', () => {
    const withUndefinedHandles = {
      ...seriesPair,
      edges: [{ id: 'w1', source: 'r1', target: 'r2' } as unknown as BlockData['edges'][number]],
    }
    const r = userPartFromBlock('Loose Wire', 'U', withUndefinedHandles)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.part.internal?.edges[0]?.sourceHandle).toBeNull()
    expect(r.part.internal?.edges[0]?.targetHandle).toBeNull()
    // and the loader accepts the round-trip (this exact case used to silently drop the part)
    expect(JSON.parse(JSON.stringify(r.part)).internal.edges[0].sourceHandle).toBeNull()
  })
})

describe('withInternalParts — the library persists a module WITH its custom sub-parts', () => {
  test('a module using a custom sub-part persists both (transitively, deduped)', async () => {
    const { withInternalParts } = await import('../src/renderer/user-library.ts')
    const sub: UserPart = {
      id: 'my_sub',
      name: 'My Sub',
      designatorPrefix: 'U',
      pins: [
        { id: 'x', name: 'X', side: 'left', electrical: 'passive' },
        { id: 'y', name: 'Y', side: 'right', electrical: 'passive' },
      ],
      behavesAs: { definition: 'resistor', terminals: { terminal_a: 'x', terminal_b: 'y' } },
    }
    const outer: UserPart = {
      ...module100,
      id: 'outer_module',
      internal: {
        name: 'core',
        origin: { x: 0, y: 0 },
        nodes: [{ id: 's1', definition: 'my_sub', x: 0, y: 0 }],
        edges: [],
        ports: [
          { id: 'a', label: 's1 · x', side: 'left', inner: { nodeId: 's1', handleId: 'x' } },
          { id: 'b', label: 's1 · y', side: 'right', inner: { nodeId: 's1', handleId: 'y' } },
        ],
      },
    }
    const closure = withInternalParts(outer, [outer, sub, module100])
    expect(closure.map((p) => p.id).sort()).toEqual(['my_sub', 'outer_module']) // sub included, unrelated module100 not
  })

  test('a self-referencing part terminates with just itself', async () => {
    const { withInternalParts } = await import('../src/renderer/user-library.ts')
    const selfRef: UserPart = {
      ...module100,
      id: 'loop_part',
      internal: {
        name: 'self',
        origin: { x: 0, y: 0 },
        nodes: [{ id: 'me', definition: 'loop_part', x: 0, y: 0 }],
        edges: [],
        ports: [{ id: 'a', label: 'me · a', side: 'left', inner: { nodeId: 'me', handleId: 'a' } }],
      },
    }
    expect(withInternalParts(selfRef, [selfRef]).map((p) => p.id)).toEqual(['loop_part'])
  })
})
