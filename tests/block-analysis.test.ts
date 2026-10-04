import type { Node } from '@xyflow/react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import {
  type BlockAnalysisContext,
  blockAnalysisInputKey,
  summarizeBlockAnalysis,
} from '../src/renderer/block-analysis.ts'
import { BlockAnalysis } from '../src/renderer/block-analysis.tsx'
import type { BlockData } from '../src/renderer/blocks.ts'

const block: BlockData = {
  name: 'Pair',
  origin: { x: 0, y: 0 },
  ports: [],
  edges: [],
  nodes: [
    { id: 'first', definition: 'resistor', x: 0, y: 0 },
    { id: 'second', definition: 'resistor', x: 20, y: 0 },
  ],
}
const context: BlockAnalysisContext = {
  fresh: true,
  status: 'solved',
  converged: true,
  thermalConverged: true,
  relaysSettled: true,
  readings: new Map([
    ['pair.first', { power: -2 }],
    ['pair.second', { power: 3 }],
    ['pair2.first', { power: 100 }],
  ]),
  paths: [],
}

describe('block analysis reporting', () => {
  test('counts exact members and uses magnitude, not signed consumption', () => {
    const report = summarizeBlockAnalysis(block, 'pair', context)
    expect(report.power).toMatchObject({ deviceCount: 2, powerCount: 2, powerMagnitude: 5 })
    expect(report.delayMax).toBeNull()
  })
  test('does not turn missing, nonfinite or logic-only power into zero', () => {
    for (const readings of [new Map(), new Map([['pair.first', { power: Number.NaN }]])]) {
      expect(
        summarizeBlockAnalysis(block, 'pair', { ...context, readings }).power.powerMagnitude,
      ).toBeNull()
    }
    const readings = new Map([['pair.first', { power: 0 }]])
    expect(summarizeBlockAnalysis(block, 'pair', { ...context, readings }).power).toMatchObject({
      powerCount: 1,
      powerMagnitude: 0,
    })
  })
  test.each([
    { fresh: false },
    { status: 'unsupported-element' as const },
    { status: 'over-budget' as const },
    { converged: false },
    { thermalConverged: false },
    { relaysSettled: false },
  ])('suppresses stale or unsuccessful readings: %j', (change) => {
    const report = summarizeBlockAnalysis(block, 'pair', { ...context, ...change })
    expect(report.reason).not.toBeNull()
    expect(report.power.powerMagnitude).toBeNull()
    expect(report.delayMax).toBeNull()
  })
  test('counts nested leaves once, not parent aggregate readings', () => {
    const nested = { ...block, nodes: [{ id: 'child', definition: 'block', x: 0, y: 0, block }] }
    const readings = new Map([
      ['pair.child', { power: 99 }],
      ['pair.child.first', { power: 4 }],
    ])
    expect(summarizeBlockAnalysis(nested, 'pair', { ...context, readings }).power).toMatchObject({
      deviceCount: 2,
      powerCount: 1,
      powerMagnitude: 4,
    })
  })
  test('refuses ambiguous flattened ids and conflicting port contracts', () => {
    const ambiguous = {
      ...block,
      nodes: [
        { id: 'child.first', definition: 'resistor', x: 0, y: 0 },
        { id: 'child', definition: 'block', x: 0, y: 0, block },
      ],
    }
    expect(summarizeBlockAnalysis(ambiguous, 'pair', context).reason).toContain('Ambiguous')
    const conflicting: BlockData = {
      ...block,
      ports: [
        {
          id: 'in',
          label: 'Input',
          side: 'left',
          direction: 'input',
          drive: 'push_pull',
          inner: { nodeId: 'first', handleId: 'terminal_a' },
        },
      ],
    }
    expect(summarizeBlockAnalysis(conflicting, 'pair', context).reason).toContain(
      'Direction conflicts',
    )
  })
  test('excludes crossing paths and refuses incomplete timing maxima', () => {
    const internal = {
      from: 'pair.first',
      to: 'pair.second',
      gates: [],
      logicDelayMin: 1e-9,
      logicDelayMax: 2e-9,
    }
    const crossing = { ...internal, to: 'other' }
    const report = summarizeBlockAnalysis(block, 'pair', {
      ...context,
      paths: [internal, crossing],
    })
    expect(report).toMatchObject({
      internalPathCount: 1,
      validPathCount: 1,
      crossingPathCount: 1,
      delayMax: 2e-9,
    })
    expect(
      summarizeBlockAnalysis(block, 'pair', {
        ...context,
        paths: [internal, { ...internal, logicDelayMax: Number.POSITIVE_INFINITY }],
      }).delayMax,
    ).toBeNull()
  })
  test('input signatures track temperature, topology, parameters and routing', () => {
    const nodes: Node[] = [
      { id: 'pair', position: { x: 0, y: 0 }, data: { definition: 'block', block } },
    ]
    const key = blockAnalysisInputKey(nodes, [], 25)
    const node = nodes[0]
    if (!node) throw new Error('Missing fixture')
    expect(key).not.toBeNull()
    expect(blockAnalysisInputKey(nodes, [], 26)).not.toBe(key)
    expect(blockAnalysisInputKey(nodes, [], Number.NaN)).toBeNull()
    expect(
      blockAnalysisInputKey(
        nodes,
        [],
        25,
        new Map([
          [
            'wire',
            [
              { x: 0, y: 0 },
              { x: 10, y: 10 },
            ],
          ],
        ]),
      ),
    ).not.toBe(key)
    expect(blockAnalysisInputKey([{ ...node, selected: true }], [], 25)).toBe(key)
    expect(
      blockAnalysisInputKey(
        [
          {
            ...node,
            data: { ...node.data, block: { ...block, nodes: block.nodes.slice(1) } },
          },
        ],
        [],
        25,
      ),
    ).not.toBe(key)
  })
  test('UI labels stale results and does not show their numeric total', () => {
    const html = renderToStaticMarkup(
      createElement(BlockAnalysis, {
        nodes: [{ id: 'pair', position: { x: 0, y: 0 }, data: { definition: 'block', block } }],
        edges: [],
        instanceId: 'pair',
        ambientC: 25,
        solvedInputKey: null,
        context,
      }),
    )
    expect(html).toContain('Stale or missing solve')
    expect(html).toContain('not net consumption')
    expect(html).toContain('Magnitude sum: unavailable')
    expect(html).not.toContain('5.0000 W')
  })
})
