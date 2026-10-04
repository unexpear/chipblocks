import { mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Edge, Node } from '@xyflow/react'
import { expect, test } from 'vitest'
import { circuitFileToFlow } from '../src/renderer/App.tsx'
import type { BlockData } from '../src/renderer/blocks.ts'
import { NAND2_BLOCK } from '../src/renderer/builtin-blocks.ts'
import { deserializeCircuit, serializeCircuit } from '../src/renderer/circuit-file.ts'
import { importBlockTest } from '../src/renderer/simulation-test-import.ts'
import {
  runDigitalTestCopy,
  runElectricalTestCopy,
} from '../src/renderer/simulation-test-runner.ts'
import type { SavedSimulationTest } from '../src/renderer/simulation-test-suite.ts'
import { simulationTestWorld } from '../src/renderer/simulation-test-world.ts'
import type { DeviceNodeData } from '../src/renderer/symbols.tsx'

async function reopen(nodes: Node[], edges: Edge[], tests: SavedSimulationTest[]) {
  const args: Parameters<typeof serializeCircuit> = [
    nodes.map((node) => ({ ...node, data: node.data as DeviceNodeData })),
    edges,
  ]
  args[13] = tests
  const file = serializeCircuit(...args)
  const directory = await mkdtemp(join(tmpdir(), 'chipblocks-test-roundtrip-'))
  const path = join(directory, 'suite.chipblocks')
  try {
    await writeFile(path, JSON.stringify(file), 'utf8')
    const loaded = deserializeCircuit(await readFile(path, 'utf8'))
    if (!loaded.ok) throw new Error('Saved file did not load')
    const flow = circuitFileToFlow(loaded.file)
    if (!flow.ok) throw new Error('Saved file did not hydrate')
    expect(loaded.file.simulationTests).toEqual(tests)
    const second: Parameters<typeof serializeCircuit> = [
      flow.nodes.map((node) => ({ ...node, data: node.data as DeviceNodeData })),
      flow.edges,
    ]
    second[13] = loaded.file.simulationTests
    expect(serializeCircuit(...second).simulationTests).toEqual(tests)
    return { flow, tests: loaded.file.simulationTests ?? [] }
  } finally {
    await rm(path, { force: true })
    await rmdir(directory)
  }
}

test.each([
  'dc',
  'ac',
  'ac-unsupported',
  'transient',
] as const)('%s saved endpoints survive disk reopen and real canvas hydration', async (mode) => {
  const kind = mode === 'ac-unsupported' ? 'ac' : mode
  const supported = mode !== 'ac-unsupported'
  const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
  const nodes: Node[] = [
    {
      id: 'source',
      position: { x: 0, y: 0 },
      data: {
        definition: 'power_source',
        parameters: {
          nominal_voltage: scalar(9, 'volt'),
          ...(mode === 'ac' ? {} : { internal_resistance: scalar(1, 'ohm') }),
        },
      },
    },
    {
      id: 'load',
      position: { x: 100, y: 0 },
      data: { definition: 'resistor', parameters: { resistance: scalar(1000, 'ohm') } },
    },
    { id: 'ground', position: { x: 0, y: 100 }, data: { definition: 'ground' } },
  ]
  const edges: Edge[] = [
    {
      id: 'positive',
      source: 'source',
      sourceHandle: 'terminal_positive',
      target: 'load',
      targetHandle: 'terminal_a',
    },
    {
      id: 'return',
      source: 'load',
      sourceHandle: 'terminal_b',
      target: 'ground',
      targetHandle: 'reference_terminal',
    },
    {
      id: 'reference',
      source: 'source',
      sourceHandle: 'terminal_negative',
      target: 'ground',
      targetHandle: 'reference_terminal',
    },
  ]
  const endpoint = { blockId: 'load', terminalId: 'terminal_a' }
  const suite: SavedSimulationTest = {
    version: 1,
    id: kind,
    name: 'Independent source/load ratio',
    run:
      kind === 'dc'
        ? { kind, projectAmbientC: 25 }
        : kind === 'ac'
          ? {
              kind,
              projectAmbientC: 25,
              inputSource: 'source',
              outputNet: 'stale-net',
              outputProbe: endpoint,
              frequenciesHz: [100],
            }
          : { kind, projectAmbientC: 25, duration: 0.001, timeStep: 0.0001 },
    assertions: [
      {
        id: 'load',
        label: 'Load voltage or gain',
        signal: `${kind === 'ac' ? 'gain' : 'voltage'}:stale-net`,
        probe: { kind: kind === 'ac' ? 'ac-output' : 'terminal-voltage', ...endpoint },
        unit: kind === 'ac' ? 'dimensionless' : 'volt',
        measurement: { kind: 'point', at: kind === 'ac' ? 100 : kind === 'dc' ? 0 : 0.0001 },
        expected: {
          kind: 'near',
          value: mode === 'ac' ? 1 : kind === 'ac' ? 1000 / 1001 : 9000 / 1001,
          absolute: 0.001,
          relative: 0,
        },
        provenance: {
          kind: 'analytic',
          description: `Divider Rload/(Rload+Rsource), Rload=1000 ohm, Rsource=${mode === 'ac' ? 0 : 1} ohm, source=9 V; 0.001 allowance for wire resistance and numerical shunt.`,
        },
      },
    ],
  }
  const before = runElectricalTestCopy(
    simulationTestWorld(nodes, edges),
    suite.run as Exclude<SavedSimulationTest['run'], { kind: 'digital' }>,
    suite.assertions,
  )
  expect(before.passed, JSON.stringify(before.warnings)).toBe(supported)
  const loaded = await reopen(nodes, edges, [suite])
  const reopened = loaded.tests[0]
  if (!reopened || reopened.run.kind === 'digital') throw new Error('Missing electrical test')
  const after = runElectricalTestCopy(
    simulationTestWorld(loaded.flow.nodes as Node[], loaded.flow.edges as Edge[]),
    reopened.run,
    reopened.assertions,
  )
  expect(after.passed).toBe(supported)
  if (!supported) {
    expect(after.reports[0]?.status).toBe('unavailable')
    expect(after.warnings.some((warning) => warning.includes('internal_resistance'))).toBe(true)
  }
  expect(after.reports.map((report) => report.actual)).toEqual(
    before.reports.map((report) => report.actual),
  )
})

test('legacy and unified digital waveforms both survive disk reopen and run independently', async () => {
  const block = structuredClone(NAND2_BLOCK)
  const legacy = {
    id: 'nand-high',
    name: 'Both high',
    cycles: 2,
    inputs: { a: 1, b: 1 },
    expected: { out: [0, 0] },
  }
  block.tests = [legacy]
  const imported = importBlockTest(block, 'nand', legacy)
  if (!imported.ok) throw new Error(imported.reason)
  const loaded = await reopen(
    [{ id: 'nand', position: { x: 0, y: 0 }, data: { definition: 'block', block } }],
    [],
    [imported.test],
  )
  const restoredBlock = loaded.flow.nodes[0]?.data.block as BlockData
  expect(restoredBlock.tests).toEqual([legacy])
  const restored = loaded.tests[0]
  if (restored?.run.kind !== 'digital') throw new Error('Missing digital test')
  const result = runDigitalTestCopy(
    restoredBlock,
    restored.run.blockId,
    restored.run.cycles,
    new Map(Object.entries(restored.run.inputs)),
    restored.assertions,
  )
  expect(result.passed).toBe(true)
  expect(result.reports).toHaveLength(2)
  expect(restoredBlock.tests).toEqual([legacy])
})
