import type { Edge, Node } from '@xyflow/react'
import { expect, test } from 'vitest'
import { readScalarParam } from '../src/instance-params.ts'
import { sensorIlluminance } from '../src/light.ts'
import type { Point } from '../src/renderer/net-edge.tsx'
import { defaultParameters } from '../src/renderer/part-defaults.ts'
import { solveCanvasDispatch } from '../src/renderer/pipeline/solve-canvas.ts'
import { runElectricalTestCopy } from '../src/renderer/simulation-test-runner.ts'
import {
  simulationTestInputKey,
  simulationTestWorld,
} from '../src/renderer/simulation-test-world.ts'

function fixture() {
  const nodes: Node[] = ['power_source', 'photoresistor', 'ground', 'light_source'].map(
    (definition, index) => ({
      id: definition,
      position: { x: index * 100, y: 0 },
      data: { definition, parameters: defaultParameters(definition) },
    }),
  )
  const connections = [
    ['power_source', 'terminal_positive', 'photoresistor', 'terminal_a'],
    ['photoresistor', 'terminal_b', 'ground', 'reference_terminal'],
    ['power_source', 'terminal_negative', 'ground', 'reference_terminal'],
  ]
  const edges: Edge[] = connections.map((connection, index) => ({
    id: `edge${index}`,
    source: connection[0] ?? '',
    sourceHandle: connection[1] ?? '',
    target: connection[2] ?? '',
    targetHandle: connection[3] ?? '',
  }))
  const routes = new Map<string, Point[]>([
    [
      'edge0',
      [
        { x: 0, y: 0 },
        { x: 0, y: 500 },
        { x: 100, y: 500 },
        { x: 100, y: 0 },
      ],
    ],
  ])
  return { nodes, edges, routes }
}

test('report freshness ignores selection and display measurements but tracks physical edits', () => {
  const { nodes, edges, routes } = fixture()
  const original = simulationTestInputKey(nodes, edges, routes)
  const selected = nodes.map((node) => ({ ...node, selected: true }))
  const rendered = edges.map((edge) => ({ ...edge, selected: true, data: { amps: 0.5 } }))
  expect(simulationTestInputKey(selected, rendered, routes)).toBe(original)
  const moved = selected.map((node) => ({
    ...node,
    position: { ...node.position, x: node.position.x + 1 },
  }))
  expect(simulationTestInputKey(moved, rendered, routes)).not.toBe(original)
  expect(simulationTestInputKey(selected, rendered)).not.toBe(original)
  const changed = structuredClone(nodes)
  const sensor = changed.find((node) => node.id === 'photoresistor')
  if (!sensor) throw new Error('Missing sensor')
  sensor.data.parameters = {}
  expect(simulationTestInputKey(changed, edges, routes)).not.toBe(original)
})

test('test preparation uses the live pipeline light and routed-wire inputs', () => {
  const { nodes, edges, routes } = fixture()
  const prepared = simulationTestWorld(nodes, edges, routes)
  const actual = solveCanvasDispatch(nodes, edges, 25, routes)
  expect(actual.solution.status).toBe('solved')
  expect(prepared.instances).toEqual(actual.world.instances)
  expect(prepared.nets).toEqual(actual.world.nets)
  const sensor = prepared.instances.get('photoresistor')
  expect(sensor).toBeDefined()
  if (!sensor) return
  expect(sensorIlluminance(sensor)).toBeCloseTo(350, 6)
  const straight = simulationTestWorld(nodes, edges)
  const routedWire = prepared.instances.get('wire_edge0')
  const straightWire = straight.instances.get('wire_edge0')
  expect(routedWire).toBeDefined()
  expect(straightWire).toBeDefined()
  if (!routedWire || !straightWire) return
  expect(readScalarParam(routedWire, 'resistance')).toBeCloseTo(
    (0.9144 / 0.1) * (readScalarParam(straightWire, 'resistance') ?? Number.NaN),
    8,
  )
})

test('preparation and preview preserve nested live canvas data and route geometry', () => {
  const { nodes, edges, routes } = fixture()
  const before = structuredClone({ nodes, edges, routes })
  const world = simulationTestWorld(nodes, edges, routes)
  const preview = runElectricalTestCopy(world, { kind: 'dc', projectAmbientC: 25 }, [])
  expect(preview.signals.size).toBeGreaterThan(0)
  expect({ nodes, edges, routes }).toEqual(before)
  const sensor = world.instances.get('photoresistor')
  if (!sensor) throw new Error('Missing sensor')
  sensor.parameters = { ambient_illuminance: { value: { kind: 'scalar', amount: 0, unit: 'lux' } } }
  world.nets.clear()
  expect({ nodes, edges, routes }).toEqual(before)
})
