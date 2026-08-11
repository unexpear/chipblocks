/**
 * compileLogic + stepLogic — the compile-once / step-many fast path that the calculator's ×/÷ busy
 * loop uses (App.tsx calcSolve). The CALCULATOR harness is flattened ONCE; each clock only re-seeds the
 * clock + the pressed key (via stepLogic's source overrides) and re-sweeps, instead of re-expanding
 * ~9000 gates every cycle. This proves that path computes the SAME results as the per-cycle simulateLogic
 * — including over the multi-cycle ×/÷ sequencer — so the speedup is behavior-preserving.
 */

import { describe, expect, test } from 'vitest'
import type { BlockData, CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { CALCULATOR } from '../src/renderer/builtin-blocks.ts'
import { compileLogic, simulateLogic, stepLogic } from '../src/renderer/logic-sim.ts'

const supply = (v: number) => ({
  nominal_voltage: { value: { kind: 'scalar', amount: v, unit: 'volt' } },
})
const src = (id: string, v: number): CanvasNodeLike => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition: 'power_source', parameters: supply(v) },
})
const w = (id: string, s: string, sh: string, t: string, th: string): CanvasEdgeLike => ({
  id,
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
})
const KEYS = [
  'k0',
  'k1',
  'k2',
  'k3',
  'k4',
  'k5',
  'k6',
  'k7',
  'k8',
  'k9',
  'kadd',
  'ksub',
  'kmul',
  'kdiv',
  'keq',
  'kclr',
  'kpm',
  'kdot',
]
const lineFor = (k: string | number): string => {
  if (typeof k === 'number') return `k${k}`
  return { '+': 'kadd', '-': 'ksub', '*': 'kmul', '/': 'kdiv', '=': 'keq', c: 'kclr' }[k] ?? 'kclr'
}
const decode = (r: ReturnType<typeof simulateLogic>): number => {
  let n = 0
  for (let d = 0; d < 10; d++) {
    let dig = 0
    for (let b = 0; b < 4; b++) if (r.value('calc', `display${d * 4 + b}`) === true) dig |= 1 << b
    n += dig * 10 ** d
  }
  return (r.value('calc', 'neg') === true ? -1 : 1) * n
}

// the harness App.tsx compiles once (default levels: clk LOW, every key LOW, V+ HIGH)
const harnessNodes: CanvasNodeLike[] = [
  { id: 'calc', position: { x: 0, y: 0 }, data: { definition: 'block', block: CALCULATOR } },
  src('h_vp', 5),
  { id: 'h_g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
  src('h_clk', 0),
  ...KEYS.map((k) => src(`h_${k}`, 0)),
]
const harnessEdges: CanvasEdgeLike[] = [
  w('h_eclk', 'h_clk', 'terminal_positive', 'calc', 'clk'),
  w('h_eclkn', 'h_clk', 'terminal_negative', 'h_g', 'reference_terminal'),
  w('h_ep', 'h_vp', 'terminal_positive', 'calc', 'v_dd'),
  w('h_epn', 'h_vp', 'terminal_negative', 'h_g', 'reference_terminal'),
  w('h_eg', 'calc', 'gnd', 'h_g', 'reference_terminal'),
  ...KEYS.flatMap((k) => [
    w(`h_e_${k}`, `h_${k}`, 'terminal_positive', 'calc', k),
    w(`h_en_${k}`, `h_${k}`, 'terminal_negative', 'h_g', 'reference_terminal'),
  ]),
]

// the App.tsx fast path: compile ONCE, step with clock + key overrides
function runFast(keys: Array<string | number>): number {
  const compiled = compileLogic(harnessNodes, harnessEdges)
  const state = new Map<string, boolean>()
  const solve = (active: string, clk: boolean) => {
    const ov = new Map<string, boolean>([['h_clk', clk]])
    if (active !== 'none') ov.set(`h_${active}`, true)
    return stepLogic(compiled, ov, state)
  }
  let r = solve('none', false)
  for (const k of keys) {
    const line = lineFor(k)
    solve(line, false)
    r = solve(line, true)
    let guard = 0
    while (r.value('calc', 'busy') === true && guard++ < 300) {
      solve('none', false)
      r = solve('none', true)
    }
    r = solve('none', false)
  }
  return decode(r)
}

// the reference: a fresh simulateLogic over a harness rebuilt with the live source values each cycle
function runRef(keys: Array<string | number>): number {
  const state = new Map<string, boolean>()
  const solve = (active: string, clk: boolean) => {
    const nodes: CanvasNodeLike[] = [
      { id: 'calc', position: { x: 0, y: 0 }, data: { definition: 'block', block: CALCULATOR } },
      src('h_vp', 5),
      { id: 'h_g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
      src('h_clk', clk ? 5 : 0),
      ...KEYS.map((k) => src(`h_${k}`, k === active ? 5 : 0)),
    ]
    return simulateLogic(nodes, harnessEdges, state)
  }
  let r = solve('none', false)
  for (const k of keys) {
    const line = lineFor(k)
    solve(line, false)
    r = solve(line, true)
    let guard = 0
    while (r.value('calc', 'busy') === true && guard++ < 300) {
      solve('none', false)
      r = solve('none', true)
    }
    r = solve('none', false)
  }
  return decode(r)
}

describe('compileLogic + stepLogic (the calculator fast path)', () => {
  test('add via the compile-once/step path: 1234 + 5678 = 6912', () => {
    expect(runFast(['c', 1, 2, 3, 4, '+', 5, 6, 7, 8, '='])).toBe(6912)
  })

  test('the multi-cycle ×/÷ busy loop on the fast path matches the per-cycle simulateLogic', () => {
    for (const seq of [
      ['c', 1, 2, '*', 3, 4, '='],
      ['c', 1, 0, 0, '/', 4, '='],
      ['c', 5, '-', 9, '='],
    ] as Array<Array<string | number>>) {
      expect(runFast(seq)).toBe(runRef(seq))
    }
  }, 600000)
})

/**
 * simulateLogic REUSES a compiled netlist when the design has not changed — the ordinary API used to
 * re-flatten and re-net the whole design on every call, which made clocking a big design 20x dearer than
 * holding your own compiled netlist. The correctness bar is exact: whatever a caller gets from simulateLogic
 * must equal what a FRESH compileLogic + stepLogic would give for the same canvas, including after the canvas
 * has been mutated IN PLACE — the case a key that merely watched object identity would miss.
 */
describe('simulateLogic — the reused netlist is never stale', () => {
  const port = (id: string, side: 'left' | 'right' = 'left') => ({
    id,
    label: id,
    side,
    inner: { nodeId: id, handleId: id },
  })
  const gateNode = (
    id: string,
    name: string,
    ports: ReturnType<typeof port>[],
  ): CanvasNodeLike => ({
    id,
    position: { x: 0, y: 0 },
    data: {
      definition: 'block',
      block: { name, origin: { x: 0, y: 0 }, nodes: [], edges: [], ports },
    },
  })
  const TWO_IN = [port('a'), port('b'), port('out', 'right')]
  const ONE_IN = [port('in'), port('out', 'right')]
  const params = (value: unknown) => value as NonNullable<CanvasNodeLike['data']['parameters']>

  /** Every probe read both ways: through the cache, and through a compile that has never seen one. */
  const agrees = (
    label: string,
    nodes: CanvasNodeLike[],
    edges: CanvasEdgeLike[],
    probes: [string, string][],
  ) => {
    const fresh = stepLogic(compileLogic(nodes, edges), undefined, undefined)
    const cached = simulateLogic(nodes, edges)
    const asText = (r: ReturnType<typeof stepLogic>) =>
      probes.map(([n, h]) => `${n}/${h}=${r.value(n, h)}`).join(' ')
    expect(asText(cached), label).toBe(asText(fresh))
    expect(cached.settled, `${label} (settled)`).toBe(fresh.settled)
  }

  test('alternating between two different designs never returns the other one’s answer', () => {
    for (const [a, b] of [
      [true, true],
      [true, false],
      [false, true],
      [false, false],
    ])
      for (const name of ['AND', 'OR', 'XOR', 'NAND', 'NOR', 'XNOR']) {
        const nodes = [gateNode('G', name, TWO_IN), src('sa', a ? 5 : 0), src('sb', b ? 5 : 0)]
        const edges = [
          w('ea', 'sa', 'terminal_positive', 'G', 'a'),
          w('eb', 'sb', 'terminal_positive', 'G', 'b'),
        ]
        agrees(`${name} a=${a} b=${b}`, nodes, edges, [
          ['G', 'a'],
          ['G', 'b'],
          ['G', 'out'],
        ])
      }
  })

  test('the SAME arrays mutated in place: a rename, a moved wire, a level, a removed wire', () => {
    const nodes = [gateNode('G', 'AND', TWO_IN), src('sa', 5), src('sb', 5)]
    const edges = [
      w('ea', 'sa', 'terminal_positive', 'G', 'a'),
      w('eb', 'sb', 'terminal_positive', 'G', 'b'),
    ]
    const probes: [string, string][] = [
      ['G', 'a'],
      ['G', 'b'],
      ['G', 'out'],
    ]
    agrees('baseline AND(1,1)', nodes, edges, probes)
    expect(simulateLogic(nodes, edges).value('G', 'out')).toBe(true)

    const gate = nodes[0]?.data.block as BlockData
    gate.name = 'NAND'
    agrees('block renamed in place', nodes, edges, probes)
    expect(simulateLogic(nodes, edges).value('G', 'out')).toBe(false)
    gate.name = 'AND'

    const wire = edges[1] as CanvasEdgeLike
    wire.targetHandle = 'a'
    agrees('wire moved in place', nodes, edges, probes)
    wire.targetHandle = 'b'

    const sourceNode = nodes[1] as CanvasNodeLike
    sourceNode.data.parameters = params(supply(0))
    agrees('source level changed in place', nodes, edges, probes)
    expect(simulateLogic(nodes, edges).value('G', 'out')).toBe(false)
    sourceNode.data.parameters = params(supply(5))
    expect(simulateLogic(nodes, edges).value('G', 'out')).toBe(true)

    const popped = edges.pop() as CanvasEdgeLike
    agrees('wire removed in place', nodes, edges, probes)
    edges.push(popped)
    agrees('wire restored in place', nodes, edges, probes)
  })

  test('a switch, a source and a whole gate mutated INSIDE a block are all seen', () => {
    const innerParams = (value: unknown) =>
      value as NonNullable<BlockData['nodes'][number]['parameters']>
    const inner: BlockData = {
      name: 'gated',
      origin: { x: 0, y: 0 },
      nodes: [
        {
          id: 'sw',
          definition: 'switch_spst_toggle',
          x: 0,
          y: 0,
          parameters: innerParams({ state: { value: 'closed' } }),
        },
        {
          id: 'g1',
          definition: 'block',
          x: 0,
          y: 0,
          block: { name: 'NOT', origin: { x: 0, y: 0 }, nodes: [], edges: [], ports: ONE_IN },
        },
        { id: 'vs', definition: 'power_source', x: 0, y: 0, parameters: innerParams(supply(5)) },
        {
          id: 'g2',
          definition: 'block',
          x: 0,
          y: 0,
          block: { name: 'Buffer', origin: { x: 0, y: 0 }, nodes: [], edges: [], ports: ONE_IN },
        },
      ],
      edges: [
        { id: 'i1', source: 'sw', sourceHandle: 'terminal_out', target: 'g1', targetHandle: 'in' },
        {
          id: 'i2',
          source: 'vs',
          sourceHandle: 'terminal_positive',
          target: 'g2',
          targetHandle: 'in',
        },
      ],
      ports: [
        { id: 'p_in', label: 'in', side: 'left', inner: { nodeId: 'sw', handleId: 'terminal_in' } },
        { id: 'p_out', label: 'out', side: 'right', inner: { nodeId: 'g1', handleId: 'out' } },
        { id: 'p_buf', label: 'buf', side: 'right', inner: { nodeId: 'g2', handleId: 'out' } },
      ],
    }
    const nodes: CanvasNodeLike[] = [
      { id: 'B', position: { x: 0, y: 0 }, data: { definition: 'block', block: inner } },
      src('s1', 5),
    ]
    const edges = [w('e1', 's1', 'terminal_positive', 'B', 'p_in')]
    const probes: [string, string][] = [
      ['B', 'p_in'],
      ['B', 'p_out'],
      ['B', 'p_buf'],
    ]
    agrees('block baseline', nodes, edges, probes)

    const switchNode = inner.nodes[0] as BlockData['nodes'][number]
    switchNode.parameters = innerParams({ state: { value: 'open' } })
    agrees('inner switch opened in place', nodes, edges, probes)
    switchNode.parameters = innerParams({ state: { value: 'closed' } })

    const innerSource = inner.nodes[2] as BlockData['nodes'][number]
    innerSource.parameters = innerParams(supply(0))
    agrees('inner source dropped to 0 V in place', nodes, edges, probes)
    expect(simulateLogic(nodes, edges).value('B', 'p_buf')).toBe(false)
    innerSource.parameters = innerParams(supply(5))
    expect(simulateLogic(nodes, edges).value('B', 'p_buf')).toBe(true)

    inner.nodes.push({
      id: 'g3',
      definition: 'block',
      x: 0,
      y: 0,
      block: { name: 'NOT', origin: { x: 0, y: 0 }, nodes: [], edges: [], ports: ONE_IN },
    })
    inner.edges.push({
      id: 'i3',
      source: 'vs',
      sourceHandle: 'terminal_positive',
      target: 'g3',
      targetHandle: 'in',
    })
    inner.ports.push({
      id: 'p_new',
      label: 'new',
      side: 'right',
      inner: { nodeId: 'g3', handleId: 'out' },
    })
    agrees('a whole inner gate added in place', nodes, edges, [...probes, ['B', 'p_new']])
    expect(simulateLogic(nodes, edges).value('B', 'p_new')).toBe(false)
  })

  /**
   * Three canvases whose ANSWER changes while almost nothing else does — a switch position, one inner wire,
   * one node's definition. Each is a field the snapshot has to carry: drop it and the netlist is reused for
   * a design that is no longer the same one.
   */
  test('a switch inside a block, an inner wire, and a node’s definition each invalidate the reuse', () => {
    const bufferBlock = (name: string): BlockData => ({
      name,
      origin: { x: 0, y: 0 },
      nodes: [],
      edges: [],
      ports: ONE_IN,
    })
    const inner: BlockData = {
      name: 'switched',
      origin: { x: 0, y: 0 },
      nodes: [
        {
          id: 'sw',
          definition: 'switch_spst_toggle',
          x: 0,
          y: 0,
          parameters: params({ state: { value: 'closed' } }),
        },
        { id: 'g', definition: 'block', x: 0, y: 0, block: bufferBlock('Buffer') },
      ],
      edges: [
        { id: 'i1', source: 'sw', sourceHandle: 'terminal_out', target: 'g', targetHandle: 'in' },
      ],
      ports: [
        { id: 'p_in', label: 'in', side: 'left', inner: { nodeId: 'sw', handleId: 'terminal_in' } },
        { id: 'p_out', label: 'out', side: 'right', inner: { nodeId: 'g', handleId: 'out' } },
      ],
    }
    const nodes: CanvasNodeLike[] = [
      { id: 'B', position: { x: 0, y: 0 }, data: { definition: 'block', block: inner } },
      src('s1', 5),
    ]
    const edges = [w('e1', 's1', 'terminal_positive', 'B', 'p_in')]
    const probes: [string, string][] = [['B', 'p_out']]
    const switchNode = inner.nodes[0] as BlockData['nodes'][number]

    // A closed switch passes the 5 V through to the buffer; an open one leaves its input floating.
    agrees('switch closed', nodes, edges, probes)
    expect(simulateLogic(nodes, edges).value('B', 'p_out')).toBe(true)
    switchNode.parameters = params({ state: { value: 'open' } })
    agrees('switch opened in place', nodes, edges, probes)
    expect(simulateLogic(nodes, edges).value('B', 'p_out')).toBe(false)
    switchNode.parameters = params({ state: { value: 'closed' } })
    expect(simulateLogic(nodes, edges).value('B', 'p_out')).toBe(true)

    // The inner wire alone — no node added, no port changed.
    const innerWire = inner.edges.pop() as BlockData['edges'][number]
    agrees('inner wire removed in place', nodes, edges, probes)
    expect(simulateLogic(nodes, edges).value('B', 'p_out')).toBe(false)
    inner.edges.push(innerWire)
    expect(simulateLogic(nodes, edges).value('B', 'p_out')).toBe(true)

    // The same node id, the same wire, a different DEFINITION: a source that stops being a source.
    const supplyNode = nodes[1] as CanvasNodeLike
    supplyNode.data.definition = 'junction'
    agrees('the source became a junction in place', nodes, edges, probes)
    expect(simulateLogic(nodes, edges).value('B', 'p_out')).toBe(false)
    supplyNode.data.definition = 'power_source'
    expect(simulateLogic(nodes, edges).value('B', 'p_out')).toBe(true)
  })

  // A node's ID is what its nets are named after, so two canvases that differ only by an id are two
  // different netlists. An EDGE-LESS node is the one rename that leaves every wire untouched, so the id
  // itself is the only thing that can tell them apart — the case where dropping the id from the key
  // silently answers for the wrong node.
  test('renaming an edge-less node is a different design, not a cache hit', () => {
    simulateLogic([src('lone', 5)], [])
    const renamed = [src('lone2', 5)]
    const reused = simulateLogic(renamed, []).value('lone2', 'terminal_positive')
    const fresh = stepLogic(compileLogic(renamed, [])).value('lone2', 'terminal_positive')
    expect(fresh).toBe(true)
    expect(reused).toBe(fresh)
  })
})
