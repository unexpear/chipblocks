import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import type { BlockPort } from '../src/renderer/blocks.ts'
import { inspectNet } from '../src/renderer/net-inspector.ts'
import { NetInspector } from '../src/renderer/net-inspector.tsx'

const port = (id: string, drive: BlockPort['drive']): BlockPort => ({
  id,
  label: id,
  side: 'right',
  inner: { nodeId: 'inner', handleId: id },
  ...(drive === undefined ? {} : { drive }),
})

describe('inspectNet', () => {
  test('collects every endpoint and solved wire metric in one net report', () => {
    const inspection = inspectNet(
      [
        {
          id: 'source',
          data: {
            definition: 'block',
            label: 'Source',
            block: { ports: [port('out', 'push_pull')] },
          },
        },
        {
          id: 'load',
          data: { definition: 'block', label: 'Load', block: { ports: [port('in', 'input')] } },
        },
        { id: 'tap', data: { definition: 'resistor', label: 'R1' } },
      ],
      [
        {
          id: 'w1',
          source: 'source',
          sourceHandle: 'out',
          target: 'load',
          targetHandle: 'in',
          data: { amps: 0.2, drop: 0.04, lengthM: 0.5, ohms: 0.2 },
        },
        {
          id: 'w2',
          source: 'load',
          sourceHandle: 'in',
          target: 'tap',
          targetHandle: 'terminal_a',
          data: { amps: -0.1, drop: -0.02, lengthM: 0.25, ohms: 0.1 },
        },
      ],
      'source out',
    )
    expect(inspection?.status).toBe('driven')
    expect(inspection?.drivers.map((endpoint) => endpoint.nodeId)).toEqual(['source'])
    expect(inspection?.loads.map((endpoint) => endpoint.nodeId)).toEqual(['load'])
    expect(inspection?.passives.map((endpoint) => endpoint.nodeId)).toEqual(['tap'])
    expect(inspection?.wires).toHaveLength(2)
    expect(inspection?.currentA).toBeCloseTo(0.2)
    expect(inspection?.voltageDropV).toBeCloseTo(0.04)
    expect(inspection?.lengthM).toBeCloseTo(0.75)
    expect(inspection?.resistanceOhm).toBeCloseTo(0.3)
    expect(inspection?.root).toBe('load in')
    expect(inspection?.nextStep).toContain('listed loads')
    expect(inspection?.net.id).toBe('load in')
    expect(inspection?.net.subgraphId).toBe('net:load in')
    expect(inspection?.net.endpoints[0]?.netId).toBe('load in')
    expect(inspection?.net.endpoints[0]?.domain).toBe('electrical')
    expect(inspection?.why.state).toBe('complete')
    expect(inspection?.why.explanations[0]?.path.map((step) => step.kind)).toEqual([
      'source',
      'terminal',
      'net',
      'device-state',
      'output',
    ])
  })

  test('surfaces the existing contention finding on the affected net', () => {
    const inspection = inspectNet(
      [
        { id: 'a', data: { definition: 'block', block: { ports: [port('out', 'push_pull')] } } },
        { id: 'b', data: { definition: 'block', block: { ports: [port('out', 'push_pull')] } } },
      ],
      [{ id: 'w', source: 'a', sourceHandle: 'out', target: 'b', targetHandle: 'out' }],
      'a out',
    )
    expect(inspection?.status).toBe('contended')
    expect(inspection?.findings[0]?.code).toBe('output-contention')
    expect(inspection?.nextStep).toContain('outputs are wired together')
    expect(inspection?.diagnostics[0]).toMatchObject({
      code: 'output-contention',
      severity: 'error',
      state: 'failed',
      repair: { action: 'select' },
    })
  })

  test('distinguishes an undriven input net from a passive-only net', () => {
    const inspection = inspectNet(
      [
        { id: 'input', data: { definition: 'block', block: { ports: [port('in', 'input')] } } },
        { id: 'resistor', data: { definition: 'resistor' } },
      ],
      [
        {
          id: 'w',
          source: 'input',
          sourceHandle: 'in',
          target: 'resistor',
          targetHandle: 'terminal_a',
        },
      ],
      'input in',
    )
    expect(inspection?.status).toBe('undriven')
    expect(inspection?.drivers).toHaveLength(0)
    expect(inspection?.nextStep).toContain('missing source')
    expect(inspection?.net.state).toBe('blocked')
    expect(inspection?.diagnostics[0]).toMatchObject({
      code: 'missing-required-input',
      state: 'blocked',
      repair: { action: 'connect' },
    })
    expect(inspection?.why.firstBlockedHop?.label).toBe('net input in')
  })

  test('finds the first incompatible connection before a solver is asked to use it', () => {
    const inspection = inspectNet(
      [
        {
          id: 'digital-source',
          data: {
            definition: 'block',
            block: { ports: [{ ...port('out', 'push_pull'), domain: 'digital', unit: 'boolean' }] },
          },
        },
        {
          id: 'analog-load',
          data: {
            definition: 'block',
            block: { ports: [{ ...port('in', 'input'), domain: 'electrical', unit: 'volt' }] },
          },
        },
      ],
      [
        {
          id: 'w',
          source: 'digital-source',
          sourceHandle: 'out',
          target: 'analog-load',
          targetHandle: 'in',
        },
      ],
      'digital-source out',
    )
    expect(inspection?.status).toBe('attention')
    expect(inspection?.diagnostics[0]).toMatchObject({
      code: 'incompatible-connection',
      state: 'failed',
      repair: { action: 'select' },
    })
    expect(inspection?.why.explanations[0]?.cause?.kind).toBe('incompatible-connection')
  })

  test('returns null for an endpoint that is not wired', () => {
    expect(
      inspectNet(
        [{ id: 'source', data: { definition: 'power_source' } }],
        [],
        'source terminal_positive',
      ),
    ).toBeNull()
  })

  test('renders the canonical net and next inspection step', () => {
    const inspection = inspectNet(
      [
        { id: 'input', data: { definition: 'block', block: { ports: [port('in', 'input')] } } },
        { id: 'resistor', data: { definition: 'resistor' } },
      ],
      [
        {
          id: 'w',
          source: 'input',
          sourceHandle: 'in',
          target: 'resistor',
          targetHandle: 'terminal_a',
        },
      ],
      'input in',
    )
    if (inspection === null) throw new Error('expected a wired net inspection')
    const html = renderToStaticMarkup(createElement(NetInspector, { inspection }))
    expect(html).toContain('Canonical net: input in')
    expect(html).toContain('Next inspection')
    expect(html).toContain('missing source')
  })
})
