import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { type BlockTimingOptions, blockTiming } from '../src/renderer/block-timing.ts'
import { BlockTiming } from '../src/renderer/block-timing.tsx'
import type { BlockData } from '../src/renderer/blocks.ts'
import { D_FLIPFLOP_BLOCK, INVERTER_BLOCK } from '../src/renderer/builtin-blocks.ts'
import { gateDelay, traceTimingPaths } from '../src/renderer/timing-graph.ts'

const options: BlockTimingOptions = {
  supplyVoltage: 5,
  wireCapacitance: 1e-12,
  defaultInputCapacitance: 10e-12,
  externalPortsUnloaded: true,
}
const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const inverter: BlockData = {
  ...INVERTER_BLOCK,
  nodes: INVERTER_BLOCK.nodes.map((node) => ({
    ...node,
    parameters: {
      ...node.parameters,
      threshold_voltage: scalar(node.definition === 'transistor_mosfet_pmos' ? -1 : 1, 'volt'),
      transconductance_parameter: scalar(0.01, 'ampere_per_volt_squared'),
      gate_capacitance: scalar(2e-12, 'farad'),
    },
  })),
}
const pair: BlockData = {
  name: 'Two inverters',
  origin: { x: 0, y: 0 },
  nodes: [
    { id: 'first', definition: 'block', x: 0, y: 0, block: inverter },
    { id: 'second', definition: 'block', x: 20, y: 0, block: inverter },
  ],
  edges: [
    { id: 'internal', source: 'first', sourceHandle: 'out', target: 'second', targetHandle: 'in' },
  ],
  ports: [
    { id: 'in', label: 'Input', side: 'left', inner: { nodeId: 'first', handleId: 'in' } },
    { id: 'out', label: 'Output', side: 'right', inner: { nodeId: 'second', handleId: 'out' } },
  ],
}
const pipeline: BlockData = {
  name: 'Pipeline',
  origin: { x: 0, y: 0 },
  ports: [],
  nodes: [
    { id: 'launch', definition: 'block', x: 0, y: 0, block: D_FLIPFLOP_BLOCK },
    { id: 'nested', definition: 'block', x: 20, y: 0, block: pair },
    { id: 'capture', definition: 'block', x: 40, y: 0, block: D_FLIPFLOP_BLOCK },
  ],
  edges: [
    { id: 'first', source: 'launch', sourceHandle: 'q', target: 'nested', targetHandle: 'in' },
    { id: 'second', source: 'nested', sourceHandle: 'out', target: 'capture', targetHandle: 'd' },
  ],
}

describe('hierarchical block timing estimates', () => {
  test('honors explicit direction when register port names are nonstandard', () => {
    const renamed = structuredClone(pipeline)
    const launch = renamed.nodes
      .find((node) => node.id === 'launch')
      ?.block?.ports.find((port) => port.id === 'q')
    const capture = renamed.nodes
      .find((node) => node.id === 'capture')
      ?.block?.ports.find((port) => port.id === 'd')
    const first = renamed.edges[0]
    const second = renamed.edges[1]
    if (!launch || !capture || !first || !second) throw new Error('Missing fixture')
    launch.id = 'send_value'
    launch.label = 'Send value'
    launch.direction = 'output'
    capture.id = 'receive_value'
    capture.label = 'Receive value'
    capture.direction = 'input'
    first.sourceHandle = launch.id
    second.targetHandle = capture.id
    expect(blockTiming(renamed, 'renamed', options).paths).toHaveLength(1)
  })
  test('missing capacitance on one transistor is not hidden by its parallel partner', () => {
    const missing = structuredClone(inverter)
    const part = missing.nodes[0]
    if (!part?.parameters) throw new Error('Missing fixture')
    delete part.parameters.gate_capacitance
    expect(blockTiming(missing, 'missing', options).gates[0]?.referenceLoadDelay).toBeNull()
  })
  test('derives a gate reference delay from explicit R and C assumptions', () => {
    const report = blockTiming(inverter, 'gate', options)
    expect(report.state).toBe('estimated')
    expect(report.gates[0]?.referenceLoadDelay).toBeCloseTo(Math.log(2) * 25 * 11e-12, 20)
    expect(report.longestLogicDelay).toBeNull()
  })
  test('expands nested combinational gates but retains register boundaries', () => {
    const before = structuredClone(pipeline)
    const report = blockTiming(pipeline, 'top', options)
    expect(report.reasons).toEqual([])
    expect(report.state).toBe('estimated')
    expect(report.registerIds).toEqual(['top.launch', 'top.capture'])
    expect(report.paths).toHaveLength(1)
    expect(report.paths[0]?.gates).toEqual(['top.nested.first', 'top.nested.second'])
    expect(report.longestLogicDelay).toBeCloseTo(
      Math.log(2) * 25 * (4e-12 + 1e-12 + 10e-12 + 1e-12),
      20,
    )
    expect(pipeline).toEqual(before)
  })
  test.each([
    { supplyVoltage: Number.NaN },
    { supplyVoltage: 0 },
    { wireCapacitance: -1 },
    { defaultInputCapacitance: 0 },
    { externalPortsUnloaded: false },
  ])('blocks undefined assumptions %j', (change) => {
    const report = blockTiming(pipeline, 'top', { ...options, ...change })
    expect(report.state).toBe('blocked')
    expect(report.paths).toEqual([])
    expect(report.longestLogicDelay).toBeNull()
  })
  test('does not turn missing gate data or insufficient overdrive into zero delay', () => {
    const missing: BlockData = {
      ...inverter,
      nodes: inverter.nodes.map((node) => ({ ...node, parameters: {} })),
    }
    expect(gateDelay(missing, 5, [1e-12], 0)).toBe(Number.POSITIVE_INFINITY)
    expect(blockTiming(missing, 'missing', options).state).toBe('unsupported')
    expect(
      blockTiming(inverter, 'cold', { ...options, supplyVoltage: 0.5 }).gates[0]
        ?.referenceLoadDelay,
    ).toBeNull()
  })
  test('refuses passive analog circuits rather than treating them as gates', () => {
    const passive: BlockData = {
      name: 'Analog',
      origin: { x: 0, y: 0 },
      nodes: [{ id: 'resistor', definition: 'resistor', x: 0, y: 0 }],
      edges: [],
      ports: [],
    }
    expect(blockTiming(passive, 'analog', options).state).toBe('unsupported')
  })
  test('traversal budget throws instead of returning a partially enumerated path set', () => {
    const nodes = pipeline.nodes.map((node) => ({
      id: node.id,
      data: { definition: node.definition, ...(node.block ? { block: node.block } : {}) },
    }))
    expect(() => traceTimingPaths(nodes, pipeline.edges, { ...options, maxVisits: 0 })).toThrow(
      'visit budget',
    )
  })
  test('mounts explicit assumptions without guessed values or an automatic estimate', () => {
    const html = renderToStaticMarkup(
      createElement(BlockTiming, { block: inverter, instanceId: 'gate' }),
    )
    expect(html).toContain('Timing supply (V)')
    expect(html).toContain('Estimate with external ports unloaded')
    expect(html).not.toContain('ESTIMATED')
    expect(html).toContain('No values are guessed')
  })
})
