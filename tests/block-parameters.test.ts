import type { Node } from '@xyflow/react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test } from 'vitest'
import { circuitFileToFlow } from '../src/renderer/App.tsx'
import {
  blockNodeAt,
  blockScalarParameters,
  overrideBlockParameter,
} from '../src/renderer/block-parameters.ts'
import { BlockParameters } from '../src/renderer/block-parameters.tsx'
import { type BlockData, flattenBlocks } from '../src/renderer/blocks.ts'
import { deserializeCircuit, serializeCircuit } from '../src/renderer/circuit-file.ts'
import { attachInternalCircuits } from '../src/renderer/pipeline/canvas-world.ts'
import { solveCanvasDispatch } from '../src/renderer/pipeline/solve-canvas.ts'
import { userPartFromBlock } from '../src/renderer/user-part-draft.ts'
import { registerUserPart, setUserParts } from '../src/renderer/user-parts.ts'

const block: BlockData = {
  name: 'Resistor',
  origin: { x: 0, y: 0 },
  nodes: [
    {
      id: 'resistor',
      definition: 'resistor',
      x: 0,
      y: 0,
      parameters: { resistance: { value: { kind: 'scalar', amount: 100, unit: 'ohm' } } },
    },
  ],
  edges: [],
  ports: [
    { id: 'a', label: 'A', side: 'left', inner: { nodeId: 'resistor', handleId: 'terminal_a' } },
    { id: 'b', label: 'B', side: 'right', inner: { nodeId: 'resistor', handleId: 'terminal_b' } },
  ],
}
const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
afterEach(() => setUserParts([]))

describe('internal parameter overrides', () => {
  test('uses real defaults and preserves the original block', () => {
    const node = block.nodes[0]
    if (!node) throw new Error('Missing fixture')
    expect(
      blockScalarParameters(node).find((parameter) => parameter.key === 'resistance')?.value,
    ).toMatchObject({ amount: 100, unit: 'ohm' })
    const changed = overrideBlockParameter(block, ['resistor'], 'resistance', 200, 'ohm')
    expect(changed.ok).toBe(true)
    if (!changed.ok) return
    expect(changed.block.nodes[0]?.parameters?.resistance).toEqual(scalar(200, 'ohm'))
    expect(node.parameters?.resistance).toEqual(scalar(100, 'ohm'))
    expect(
      blockScalarParameters({ id: 'default', definition: 'resistor', x: 0, y: 0 }).find(
        (parameter) => parameter.key === 'resistance',
      )?.value.amount,
    ).toBe(470)
    expect(changed.block.ports).toBe(block.ports)
    expect(changed.block.edges).toBe(block.edges)
  })

  test('edits the exact nested path and flattening sees the overridden value', () => {
    const parent: BlockData = {
      ...block,
      nodes: [{ id: 'child', definition: 'block', x: 0, y: 0, block }],
      ports: [],
    }
    const changed = overrideBlockParameter(parent, ['child', 'resistor'], 'resistance', 330, 'ohm')
    if (!changed.ok) throw new Error(changed.reason)
    expect(blockNodeAt(changed.block, ['child', 'resistor'])?.parameters?.resistance).toEqual(
      scalar(330, 'ohm'),
    )
    expect(blockNodeAt(parent, ['child', 'resistor'])?.parameters?.resistance).toEqual(
      scalar(100, 'ohm'),
    )
    const flat = flattenBlocks(
      [
        {
          id: 'module',
          position: { x: 0, y: 0 },
          data: { definition: 'block', block: changed.block },
        },
      ],
      [],
    )
    expect(flat.nodes[0]?.id).toBe('module.child.resistor')
    expect(flat.nodes[0]?.data.parameters?.resistance).toEqual(scalar(330, 'ohm'))
  })

  test.each([NaN, Infinity, -Infinity])('rejects nonfinite input %s', (amount) => {
    expect(overrideBlockParameter(block, ['resistor'], 'resistance', amount, 'ohm').ok).toBe(false)
  })

  test('rejects missing targets, invented keys, implicit unit conversion, and structural changes', () => {
    expect(overrideBlockParameter(block, [], 'resistance', 1, 'ohm').ok).toBe(false)
    expect(overrideBlockParameter(block, ['missing'], 'resistance', 1, 'ohm').ok).toBe(false)
    expect(overrideBlockParameter(block, ['resistor'], 'invented', 1, 'ohm').ok).toBe(false)
    expect(overrideBlockParameter(block, ['resistor'], 'resistance', 1, 'kohm').ok).toBe(false)
    expect(overrideBlockParameter(block, ['resistor'], 'resistance', -1, 'ohm').ok).toBe(false)
    const source: BlockData = {
      ...block,
      nodes: [{ id: 'source', definition: 'power_source', x: 0, y: 0 }],
      ports: [],
    }
    expect(
      overrideBlockParameter(source, ['source'], 'terminal_count', 3, 'dimensionless').ok,
    ).toBe(false)
    expect(overrideBlockParameter(source, ['source'], 'nominal_voltage', -5, 'volt').ok).toBe(true)
  })

  test('two reusable instances solve with independent values and retain them after reload', () => {
    const part = userPartFromBlock('Test Resistor Module', 'U', block)
    if (!part.ok) throw new Error(part.error)
    registerUserPart(part.part)
    const original: Node[] = ['first', 'second'].map((id) => ({
      id,
      position: { x: 0, y: 0 },
      data: { definition: part.part.id },
    }))
    const attached = attachInternalCircuits(original)
    const instance = attached[0]?.data.block as BlockData
    const changed = overrideBlockParameter(instance, ['resistor'], 'resistance', 200, 'ohm')
    if (!changed.ok) throw new Error(changed.reason)
    const nodes: Node[] = [
      ...original.map((node) =>
        node.id === 'first'
          ? { ...node, data: { ...node.data, block: changed.block, fidelity: 'transistor' } }
          : node,
      ),
      {
        id: 'supply',
        position: { x: 0, y: 0 },
        data: {
          definition: 'power_source',
          parameters: { nominal_voltage: scalar(9, 'volt'), internal_resistance: scalar(0, 'ohm') },
        },
      },
      { id: 'ground', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
    ]
    const edges = ['first', 'second'].flatMap((id) => [
      {
        id: `${id}_a`,
        source: 'supply',
        sourceHandle: 'terminal_positive',
        target: id,
        targetHandle: 'a',
      },
      {
        id: `${id}_b`,
        source: id,
        sourceHandle: 'b',
        target: 'supply',
        targetHandle: 'terminal_negative',
      },
    ])
    edges.push({
      id: 'reference',
      source: 'ground',
      sourceHandle: 'reference_terminal',
      target: 'supply',
      targetHandle: 'terminal_negative',
    })
    const solved = solveCanvasDispatch(nodes, edges)
    expect(solved.solution.status).toBe('solved')
    expect(Math.abs(solved.solution.branches.get('first.resistor') ?? NaN)).toBeCloseTo(0.045, 3)
    expect(Math.abs(solved.solution.branches.get('second.resistor') ?? NaN)).toBeCloseTo(0.09, 3)
    expect(part.part.internal?.nodes[0]?.parameters?.resistance).toEqual(scalar(100, 'ohm'))
    const saved = serializeCircuit(
      nodes as Parameters<typeof serializeCircuit>[0],
      edges,
      undefined,
      undefined,
      undefined,
      [part.part],
    )
    const loaded = deserializeCircuit(JSON.stringify(saved))
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    expect(
      loaded.file.nodes.find((node) => node.id === 'first')?.block?.nodes[0]?.parameters
        ?.resistance,
    ).toEqual(scalar(200, 'ohm'))
    expect(loaded.file.nodes.find((node) => node.id === 'second')?.block).toBeUndefined()
    setUserParts(loaded.file.userParts ?? [])
    const restored = circuitFileToFlow(loaded.file)
    if (!restored.ok) throw new Error(restored.reason)
    expect(restored.nodes.find((node) => node.id === 'first')?.data.fidelity).toBe('transistor')
    const rerun = solveCanvasDispatch(restored.nodes, restored.edges)
    expect(rerun.solution.status).toBe('solved')
    expect(Math.abs(rerun.solution.branches.get('first.resistor') ?? NaN)).toBeCloseTo(0.045, 3)
    expect(Math.abs(rerun.solution.branches.get('second.resistor') ?? NaN)).toBeCloseTo(0.09, 3)
  })

  test('renders the per-instance boundary and internal part selector', () => {
    const markup = renderToStaticMarkup(
      createElement(BlockParameters, { block, instanceId: 'module', onChange: () => {} }),
    )
    expect(markup).toContain('this instance only')
    expect(markup).toContain('full transistor-level simulation')
    expect(markup).toContain('aria-label="Internal part"')
  })
})
