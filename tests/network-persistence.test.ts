import { mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Edge, Node } from '@xyflow/react'
import { expect, test } from 'vitest'
import { circuitFileToFlow } from '../src/renderer/App.tsx'
import { INVERTER_BLOCK } from '../src/renderer/builtin-blocks.ts'
import { deserializeCircuit, serializeCircuit } from '../src/renderer/circuit-file.ts'
import { networkOverview } from '../src/renderer/network-overview.ts'
import { defaultParameters } from '../src/renderer/part-defaults.ts'
import { classifyCanvas } from '../src/renderer/pipeline/partition.ts'
import { solveCanvasDispatch } from '../src/renderer/pipeline/solve-canvas.ts'

test.each([
  'analog',
  'logic',
  'mixed',
] as const)('%s re-solves preserve names without changing the answer', (mode) => {
  const nodes: Node[] = ['power_source', 'ground'].map((definition) => ({
    id: definition,
    position: { x: 0, y: 0 },
    data: { definition, parameters: defaultParameters(definition) },
  }))
  if (mode !== 'logic')
    nodes.push({
      id: 'resistor',
      position: { x: 100, y: 0 },
      data: { definition: 'resistor', parameters: defaultParameters('resistor') },
    })
  if (mode !== 'analog')
    nodes.push({
      id: 'inverter',
      position: { x: 50, y: 0 },
      data: { definition: 'block', block: INVERTER_BLOCK },
    })
  const connections = [['power_source', 'terminal_negative', 'ground', 'reference_terminal']]
  if (mode !== 'analog')
    connections.push(
      ['power_source', 'terminal_positive', 'inverter', 'v_dd'],
      ['power_source', 'terminal_positive', 'inverter', 'in'],
      ['inverter', 'gnd', 'ground', 'reference_terminal'],
    )
  if (mode !== 'logic')
    connections.push(
      [
        mode === 'analog' ? 'power_source' : 'inverter',
        mode === 'analog' ? 'terminal_positive' : 'out',
        'resistor',
        'terminal_a',
      ],
      ['resistor', 'terminal_b', 'ground', 'reference_terminal'],
    )
  const edges: Edge[] = connections.map((connection, index) => ({
    id: `wire${index}`,
    source: connection[0] ?? '',
    sourceHandle: connection[1] ?? '',
    target: connection[2] ?? '',
    targetHandle: connection[3] ?? '',
    data: { netName: `Net ${index}` },
  }))
  expect(classifyCanvas(nodes)).toBe(mode)
  const named = solveCanvasDispatch(nodes, edges)
  const unnamed = solveCanvasDispatch(
    nodes,
    edges.map((edge) => ({ ...edge, data: {} })),
  )
  expect(named.edges.map((edge) => edge.data?.netName)).toEqual(
    edges.map((edge) => edge.data?.netName),
  )
  expect(named.solution.status).toBe(unnamed.solution.status)
  expect(named.solution.status).toBe('solved')
  expect(named.terminalVolts).toEqual(unnamed.terminalVolts)
})

test('network annotations survive disk reopen, real canvas hydration, and a second save', async () => {
  const nodes = [
    {
      id: 'V1',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', networkGroup: 'Power section' },
    },
    {
      id: 'R1',
      position: { x: 100, y: 0 },
      data: { definition: 'resistor', networkGroup: 'Power section' },
    },
  ]
  const edges = [
    {
      id: 'wire1',
      source: 'V1',
      sourceHandle: 'terminal_positive',
      target: 'R1',
      targetHandle: 'terminal_a',
      data: { netName: 'Supply rail' },
    },
  ]
  const directory = await mkdtemp(join(tmpdir(), 'chipblocks-phase3-'))
  const path = join(directory, 'named.chipblocks')
  try {
    const original = serializeCircuit(nodes, edges)
    await writeFile(path, JSON.stringify(original), 'utf8')
    const reopened = deserializeCircuit(await readFile(path, 'utf8'))
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    const hydrated = circuitFileToFlow(reopened.file)
    expect(hydrated.ok).toBe(true)
    if (!hydrated.ok) return
    expect(hydrated.nodes.map((node) => node.data.networkGroup)).toEqual([
      'Power section',
      'Power section',
    ])
    expect(networkOverview(hydrated.nodes, hydrated.edges, new Map())[0]?.aliases).toEqual([
      'Supply rail',
    ])
    expect(serializeCircuit(hydrated.nodes as typeof nodes, hydrated.edges)).toEqual(original)
  } finally {
    await rm(path, { force: true })
    await rmdir(directory)
  }
})
