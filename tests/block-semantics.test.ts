import { describe, expect, test } from 'vitest'
import { dcRan, dcRefused } from '../src/dc-solver.ts'
import { blockConnectionProblems, blockSemanticProblems } from '../src/renderer/block-semantics.ts'
import type { BlockData } from '../src/renderer/blocks.ts'
import { BUILTIN_BLOCKS, NAND2_BLOCK } from '../src/renderer/builtin-blocks.ts'
import {
  solveCanvasDispatch,
  solveTransientDispatch,
} from '../src/renderer/pipeline/solve-canvas.ts'
import { runDigitalTestCopy } from '../src/renderer/simulation-test-runner.ts'
import { simulationTestWorld } from '../src/renderer/simulation-test-world.ts'
import { refusalHeadline } from '../src/solver-budget.ts'
import { transientRan } from '../src/transient-solver.ts'

const resistor: BlockData = {
  name: 'Resistor',
  origin: { x: 0, y: 0 },
  nodes: [{ id: 'resistor', definition: 'resistor', x: 0, y: 0 }],
  edges: [],
  ports: [
    {
      id: 'in',
      label: 'Input',
      side: 'left',
      inner: { nodeId: 'resistor', handleId: 'terminal_a' },
    },
  ],
}

describe('block semantic validation', () => {
  test('refuses missing external block pins and flattened names that collide across roots', () => {
    const nodes = [
      { id: 'module', position: { x: 0, y: 0 }, data: { definition: 'block', block: resistor } },
      { id: 'module.resistor', position: { x: 10, y: 0 }, data: { definition: 'resistor' } },
    ]
    expect(solveCanvasDispatch(nodes, []).solution.warnings.join(' ')).toContain(
      'Ambiguous flattened identifier',
    )
    const withoutCollision = nodes.slice(0, 1)
    const edges = [
      {
        id: 'bad',
        source: 'module',
        sourceHandle: 'missing',
        target: 'module',
        targetHandle: 'in',
      },
    ]
    expect(solveCanvasDispatch(withoutCollision, edges).solution.warnings.join(' ')).toContain(
      'nonexistent block port',
    )
    expect(
      solveTransientDispatch(withoutCollision, edges, { timeStep: 1e-6, duration: 1e-3 }).result
        .status,
    ).toBe('invalid-circuit')
  })
  test('rejects unit mismatches against the actual device defaults', () => {
    const bad = structuredClone(resistor)
    const node = bad.nodes[0]
    if (!node) throw new Error('Missing fixture')
    node.parameters = { resistance: { value: { kind: 'scalar', amount: 100, unit: 'volt' } } }
    expect(blockSemanticProblems(bad, 'root').join(' ')).toContain(
      'resistance requires ohm, not volt',
    )
  })
  test.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects nonfinite persisted scalar %s before solving', (amount) => {
    const bad = structuredClone(resistor)
    const node = bad.nodes[0]
    if (!node) throw new Error('Missing fixture')
    node.parameters = { resistance: { value: { kind: 'scalar', amount, unit: 'ohm' } } }
    expect(blockSemanticProblems(bad, 'root').join(' ')).toContain('finite scalar')
  })
  test('checks declared contracts across an entire wired net, including junction hops', () => {
    const left = structuredClone(resistor)
    const right = structuredClone(resistor)
    const leftPort = left.ports[0]
    const rightPort = right.ports[0]
    if (!leftPort || !rightPort) throw new Error('Missing fixture')
    leftPort.unit = 'volt'
    rightPort.unit = 'ampere'
    const nodes = [
      { id: 'left', block: left },
      { id: 'right', block: right },
    ]
    const edges = [
      {
        id: 'first',
        source: 'left',
        sourceHandle: 'in',
        target: 'junction',
        targetHandle: 'junction',
      },
      {
        id: 'second',
        source: 'junction',
        sourceHandle: 'junction',
        target: 'right',
        targetHandle: 'in',
      },
    ]
    expect(blockConnectionProblems(nodes, edges).join(' ')).toContain(
      'unit volt cannot connect directly to ampere',
    )
    const canvas = nodes.map((node) => ({
      id: node.id,
      position: { x: 0, y: 0 },
      data: { definition: 'block', block: node.block },
    }))
    expect(solveCanvasDispatch(canvas, edges).solution.status).toBe('invalid-circuit')
    expect(() => simulationTestWorld(canvas, edges)).toThrow('unit volt')
    delete rightPort.unit
    expect(blockConnectionProblems(nodes, edges)).toEqual([])
    leftPort.domain = 'electrical'
    rightPort.domain = 'digital'
    expect(blockConnectionProblems(nodes, edges).join(' ')).toContain(
      'domain electrical cannot connect directly to digital',
    )
  })
  test('live DC and transient dispatch refuse invalid blocks without any simulated values', () => {
    const bad = structuredClone(resistor)
    const port = bad.ports[0]
    if (!port) throw new Error('Missing fixture')
    port.inner.handleId = 'not_a_terminal'
    const nodes = [
      {
        id: 'outer',
        position: { x: 0, y: 0 },
        data: { definition: 'block', block: bad, fidelity: 'logic' },
      },
    ]
    const edges = [
      {
        id: 'edge',
        source: 'outer',
        target: 'outer',
        sourceHandle: 'in',
        targetHandle: 'in',
        data: { amps: 4, vSource: 9, netName: 'keep', gaugeAwg: 22 },
        markerEnd: 'old-arrow',
      },
    ]
    const state = new Map([['saved', true]])
    const before = structuredClone({ nodes, edges, state })
    const dc = solveCanvasDispatch(nodes, edges, 25, undefined, state)
    expect(dc.solution.status).toBe('invalid-circuit')
    expect(dc.solution.analysis?.state).toBe('blocked')
    expect(dc.solution.iterations).toBe(0)
    expect(dc.solution.nodes.size).toBe(0)
    expect(dc.readings.size).toBe(0)
    expect(dc.terminalVolts.size).toBe(0)
    expect(dc.edges[0]?.data).toEqual({ netName: 'keep', gaugeAwg: 22 })
    expect(dc.edges[0]?.markerEnd).toBeUndefined()
    expect(dc.health.get('outer')?.note).toContain('not_a_terminal')
    expect(dcRan(dc.solution.status)).toBe(false)
    expect(dcRefused(dc.solution.status)).toBe(true)
    expect(refusalHeadline(dc.solution.status)).toContain('Not simulated')
    const transient = solveTransientDispatch(nodes, edges, { timeStep: 1e-6, duration: 1e-3 })
    expect(transient.result.status).toBe('invalid-circuit')
    expect(transient.result.analysis?.state).toBe('blocked')
    expect(transient.result.series).toEqual([])
    expect(transient.traces.size).toBe(0)
    expect(transientRan(transient.result.status)).toBe(false)
    expect({ nodes, edges, state }).toEqual(before)
  })
  test('refuses malformed structure before attempting to resolve or flatten it', () => {
    const nodes = [
      {
        id: 'broken',
        position: { x: 0, y: 0 },
        data: { definition: 'block', block: { name: 'Missing nodes' } },
      },
    ]
    expect(solveCanvasDispatch(nodes, []).solution.status).toBe('invalid-circuit')
    expect(
      solveTransientDispatch(nodes, [], { timeStep: 1e-6, duration: 1e-3 }).result.status,
    ).toBe('invalid-circuit')
  })
  test('validates every built-in circuit against real terminal definitions', () => {
    for (const [name, block] of Object.entries(BUILTIN_BLOCKS))
      expect(blockSemanticProblems(block, name), name).toEqual([])
  })
  test('rejects a nonexistent primitive terminal even though its node exists', () => {
    const bad = structuredClone(resistor)
    const port = bad.ports[0]
    if (!port) throw new Error('Missing fixture')
    port.inner.handleId = 'imaginary'
    expect(blockSemanticProblems(bad, 'outer')).toEqual([
      'outer/in: unknown terminal resistor/imaginary.',
    ])
    expect(() =>
      simulationTestWorld(
        [{ id: 'outer', position: { x: 0, y: 0 }, data: { definition: 'block', block: bad } }],
        [],
      ),
    ).toThrow('unknown terminal')
  })
  test('validates both wire ends and includes nested context', () => {
    const bad: BlockData = {
      ...resistor,
      edges: [
        {
          id: 'wire',
          source: 'resistor',
          sourceHandle: 'wrong',
          target: 'resistor',
          targetHandle: null,
        },
      ],
    }
    const nested: BlockData = {
      ...resistor,
      ports: [],
      nodes: [{ id: 'child', definition: 'block', x: 0, y: 0, block: bad }],
    }
    expect(blockSemanticProblems(nested, 'outer')).toEqual([
      'outer/child/wire: unknown terminal resistor/wrong.',
      'outer/child/wire: unknown terminal resistor/(missing).',
    ])
  })
  test('does not mistake fallback symbol terminals for a known device model', () => {
    const bad: BlockData = {
      ...resistor,
      nodes: [{ id: 'resistor', definition: 'not_registered', x: 0, y: 0 }],
    }
    expect(blockSemanticProblems(bad, 'outer').join(' ')).toContain(
      'fallback drawing pins do not validate a model',
    )
  })
  test('honors actual configurable source terminals', () => {
    const source: BlockData = {
      ...resistor,
      nodes: [
        {
          id: 'resistor',
          definition: 'power_source',
          x: 0,
          y: 0,
          parameters: {
            terminal_count: { value: { kind: 'scalar', amount: 3, unit: 'count' } },
          },
        },
      ],
      ports: [
        { id: 'tap', label: 'Tap', side: 'left', inner: { nodeId: 'resistor', handleId: 'tap_1' } },
      ],
    }
    expect(blockSemanticProblems(source, 'source')).toEqual([])
    const node = source.nodes[0]
    if (!node) throw new Error('Missing fixture')
    delete node.parameters
    expect(blockSemanticProblems(source, 'source').join(' ')).toContain(
      'unknown terminal resistor/tap_1',
    )
  })
  test('does not execute a digital test whose declared contract contradicts its driver', () => {
    const bad = structuredClone(NAND2_BLOCK)
    const port = bad.ports.find((candidate) => candidate.id === 'out')
    if (!port) throw new Error('Missing fixture')
    port.direction = 'input'
    port.drive = 'push_pull'
    const result = runDigitalTestCopy(bad, 'nand', 1, new Map(), [])
    expect(result.passed).toBe(false)
    expect(result.signals.size).toBe(0)
    expect(result.findings[0]?.code).toBe('invalid-block-contract')
  })
  test('reports unsupported physical-domain connections rather than converting them', () => {
    const bad = structuredClone(resistor)
    const port = bad.ports[0]
    if (!port) throw new Error('Missing fixture')
    port.domain = 'thermal'
    expect(blockSemanticProblems(bad, 'thermal').join(' ')).toContain(
      'thermal ports are not supported',
    )
  })
})
