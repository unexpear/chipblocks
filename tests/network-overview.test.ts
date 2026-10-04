import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test } from 'vitest'
import {
  networkDeviceSummary,
  networkGroupSummaries,
  networkIslands,
  networkOverview,
  networkWirePath,
} from '../src/renderer/network-overview.ts'
import { NetworkOverview } from '../src/renderer/network-overview.tsx'
import { PIN_ELECTRICAL_TYPES, registerUserPart, setUserParts } from '../src/renderer/user-parts.ts'
import { analyzeTiming } from '../src/static-timing.ts'

const nodes = [
  { id: 'supply', data: { definition: 'power_source', label: 'Supply' } },
  { id: 'resistor', data: { definition: 'resistor' } },
  { id: 'tap', data: { definition: 'junction' } },
]
const edges = [
  {
    id: 'a',
    source: 'supply',
    sourceHandle: 'positive',
    target: 'resistor',
    targetHandle: 'a',
    data: { amps: -0.2 },
  },
  { id: 'b', source: 'resistor', sourceHandle: 'a', target: 'tap', targetHandle: 'pin' },
  { id: 'c', source: 'resistor', sourceHandle: 'b', target: 'supply', targetHandle: 'negative' },
]

afterEach(() => setUserParts([]))

describe('network overview', () => {
  test('surfaces the existing contention result on its matching network', () => {
    const blocks = ['first', 'second', 'load'].map((id) => ({
      id,
      data: {
        definition: 'block',
        block: {
          ports: [
            {
              id: 'pin',
              label: id,
              side: 'left' as const,
              inner: { nodeId: 'inner', handleId: 'pin' },
              drive: id === 'load' ? ('input' as const) : ('push_pull' as const),
            },
          ],
        },
      },
    }))
    const wires = ['first', 'second'].map((source) => ({
      id: source,
      source,
      sourceHandle: 'pin',
      target: 'load',
      targetHandle: 'pin',
    }))
    const row = networkOverview(blocks, wires, new Map())[0]
    expect(row?.drivers).toHaveLength(2)
    expect(row?.loads).toHaveLength(1)
    expect(row?.topology).toBe('attention')
    expect(row?.findings[0]?.code).toBe('output-contention')
  })
  test('invalid timing paths cannot hide behind a finite group maximum', () => {
    const paths = [2e-9, Number.POSITIVE_INFINITY, Number.NaN, -1].map((delay) => ({
      from: 'supply',
      to: 'tap',
      gates: ['resistor'],
      logicDelayMax: delay,
      logicDelayMin: 0,
    }))
    const summary = networkGroupSummaries(networkIslands(nodes, edges), [], paths).get('resistor')
    expect(summary).toMatchObject({ timingPaths: 4, measuredTimingPaths: 1, delayMax: null })
  })

  test('counts authored input, output, power and passive roles without guessing bidirectional state', () => {
    expect(
      registerUserPart({
        id: 'phase3_roles',
        name: 'Role test',
        designatorPrefix: 'U',
        pins: PIN_ELECTRICAL_TYPES.map((electrical) => ({
          id: electrical,
          name: electrical,
          side: 'left' as const,
          electrical,
        })),
      }),
    ).toBe(true)
    const roleNodes = [
      { id: 'part', data: { definition: 'phase3_roles' } },
      { id: 'hub', data: { definition: 'junction' } },
    ]
    const roleEdges = PIN_ELECTRICAL_TYPES.map((electrical) => ({
      id: electrical,
      source: 'part',
      sourceHandle: electrical,
      target: 'hub',
      targetHandle: 'pin',
    }))
    const row = networkOverview(roleNodes, roleEdges, new Map())[0]
    expect(row?.drivers).toEqual(['part output', 'part power_out'])
    expect(row?.loads).toEqual(['part input', 'part power_in'])
    expect(row).toMatchObject({ passiveCount: 2, unknownCount: 2, topology: 'unknown' })
  })
  test('does not classify an undeclared active-device pin as passive', () => {
    const rows = networkOverview(
      [
        { id: 'custom', data: { definition: 'unknown-device' } },
        { id: 'resistor', data: { definition: 'resistor' } },
      ],
      [
        {
          id: 'wire',
          source: 'custom',
          sourceHandle: 'out',
          target: 'resistor',
          targetHandle: 'terminal_a',
        },
      ],
      new Map(),
    )
    expect(rows[0]).toMatchObject({ unknownCount: 1, passiveCount: 1, topology: 'unknown' })
  })
  test('group ranges preserve missing coverage and timing never leaks between groups', () => {
    const islands = networkIslands([...nodes, { id: 'isolated' }], edges)
    const rows = networkOverview(nodes, edges, new Map([['resistor/a', 5]]))
    const summaries = networkGroupSummaries(islands, rows, [
      { from: 'supply', to: 'tap', gates: ['resistor'], logicDelayMax: 2e-9, logicDelayMin: 1e-9 },
      { from: 'supply', to: 'isolated', gates: [], logicDelayMax: 9, logicDelayMin: 8 },
    ])
    expect(summaries.get('resistor')).toMatchObject({
      netCount: 2,
      voltageMin: 5,
      voltageMax: 5,
      measuredEndpoints: 1,
      currentMax: 0.2,
      measuredWires: 1,
      timingPaths: 1,
      delayMax: 2e-9,
    })
    expect(summaries.get('isolated')).toMatchObject({
      netCount: 0,
      voltageMin: null,
      currentMax: null,
      timingPaths: 0,
      delayMax: null,
    })
  })
  test('route length reports partial recorded coverage without inventing missing geometry', () => {
    const routes = edges.map((edge) => ({
      ...edge,
      data: { lengthM: edge.id === 'a' ? 0.25 : Number.NaN },
    }))
    const row = networkOverview(nodes, routes, new Map()).find((item) => item.wireIds.includes('a'))
    expect(row).toMatchObject({ recordedLengthM: 0.25, measuredLengths: 1 })
    expect(networkOverview(nodes, edges, new Map())[0]?.recordedLengthM).toBeNull()
  })

  test('large-net markup bounds detail rows and provides terminal paging', () => {
    const fanout = Array.from({ length: 1000 }, (_, index) => ({
      id: `wire${index}`,
      source: 'source',
      sourceHandle: 'positive',
      target: `load${index}`,
      targetHandle: 'pin',
    }))
    const html = renderToStaticMarkup(
      createElement(NetworkOverview, {
        nodes: [],
        edges: fanout,
        voltages: new Map(),
        readings: new Map(),
        timing: analyzeTiming([], { clockToQ: 1e-9, setup: 0.5e-9, hold: 0.2e-9 }, 1e-6),
        onSelect: () => {},
      }),
    )
    expect(html).toContain('Next terminals')
    expect(html).toContain('Next devices')
    expect(html.length).toBeLessThan(20000)
  })
  test('inspects long wire chains without exhausting the call stack', () => {
    const count = 20000
    const chainNodes = Array.from({ length: count + 1 }, (_, index) => ({
      id: `junction${index}`,
      data: { definition: 'junction' },
    }))
    const chainEdges = Array.from({ length: count }, (_, index) => ({
      id: `wire${index}`,
      source: `junction${index}`,
      sourceHandle: 'pin',
      target: `junction${index + 1}`,
      targetHandle: 'pin',
    }))
    const rows = networkOverview(chainNodes, chainEdges, new Map())
    expect(rows).toHaveLength(1)
    expect(rows[0]?.endpoints).toHaveLength(count + 1)
    expect(networkIslands(chainNodes, chainEdges)).toHaveLength(1)
    expect(networkWirePath(chainEdges, 'junction0 pin', `junction${count} pin`)).toHaveLength(count)
  })
  test('group summaries count each measured device once and preserve negative thermal headroom', () => {
    expect(
      networkDeviceSummary(
        ['source', 'load', 'load', 'missing'],
        new Map([
          ['source', { power: 2 }],
          ['load', { power: 2, temperatureC: 130, maxTemperatureC: 125 }],
          ['missing', { power: Number.NaN, temperatureC: Number.POSITIVE_INFINITY }],
        ]),
      ),
    ).toEqual({
      deviceCount: 3,
      powerMagnitude: 4,
      powerCount: 2,
      temperatureMax: 130,
      temperatureCount: 1,
      minimumHeadroom: -5,
      headroomCount: 1,
    })
    expect(networkDeviceSummary(['missing'], new Map())).toMatchObject({
      powerMagnitude: null,
      powerCount: 0,
      temperatureMax: null,
      minimumHeadroom: null,
    })
  })
  test('names remain annotations across merges and splits, never implicit connections', () => {
    const named = edges.map((edge) => ({
      ...edge,
      data: { netName: edge.id === 'a' ? 'VCC' : 'BUS' },
    }))
    const merged = networkOverview(nodes, named, new Map())
    expect(merged).toHaveLength(2)
    expect(merged.find((row) => row.wireIds.includes('a'))?.aliases).toEqual(['BUS', 'VCC'])
    const split = networkOverview(
      nodes,
      named.filter((edge) => edge.id !== 'a'),
      new Map(),
    )
    expect(split).toHaveLength(2)
    expect(split.map((row) => row.aliases)).toEqual([['BUS'], ['BUS']])
    expect(networkWirePath(named, 'tap pin', 'resistor b')).toBeNull()
    expect(networkOverview(nodes, [...named].reverse(), new Map())).toEqual(merged)
  })

  test('renders measured values and reports missing readings without a fabricated zero', () => {
    const html = renderToStaticMarkup(
      createElement(NetworkOverview, {
        nodes,
        edges,
        voltages: new Map(),
        readings: new Map(),
        timing: analyzeTiming([], { clockToQ: 1e-9, setup: 0.5e-9, hold: 0.2e-9 }, 1e-6),
        onSelect: () => {},
      }),
    )
    expect(html).toContain('Network overview')
    expect(html).toContain('unavailable')
    expect(html).toContain('Select net wires')
    expect(html).toContain('no register-to-register result')
    expect(html).not.toContain('0.0 °C')
  })
  test('groups devices structurally while retaining isolated objects', () => {
    expect(networkIslands([...nodes, { id: 'isolated' }], edges)).toEqual([
      ['isolated'],
      ['resistor', 'supply', 'tap'],
    ])
  })
  test('keeps separate terminals separate and reports partial measurements honestly', () => {
    const rows = networkOverview(
      nodes,
      edges,
      new Map([
        ['resistor/a', 4.9],
        ['supply/positive', 5],
        ['tap/pin', Number.NaN],
      ]),
    )
    expect(rows).toHaveLength(2)
    const positive = rows.find((row) => row.wireIds.includes('a'))
    expect(positive).toMatchObject({
      voltageMin: 4.9,
      voltageMax: 5,
      measuredEndpoints: 2,
      maxCurrent: 0.2,
    })
    expect(positive?.endpoints).toHaveLength(3)
    expect(rows.find((row) => row.wireIds.includes('c'))?.voltageMin).toBeNull()
  })

  test('ordering is stable when wires and nodes are reordered', () => {
    expect(networkOverview([...nodes].reverse(), [...edges].reverse(), new Map())).toEqual(
      networkOverview(nodes, edges, new Map()),
    )
  })

  test('paths follow wires without crossing through a resistor body', () => {
    expect(networkWirePath(edges, 'supply positive', 'tap pin')).toEqual(['a', 'b'])
    expect(networkWirePath(edges, 'supply positive', 'resistor b')).toBeNull()
    expect(networkWirePath(edges, 'absent pin', 'absent pin')).toBeNull()
    expect(networkWirePath(edges, 'tap pin', 'tap pin')).toEqual([])
  })

  test('cycles terminate and missing handles never join a net', () => {
    const loop = [
      ...edges,
      { id: 'd', source: 'tap', sourceHandle: 'pin', target: 'supply', targetHandle: 'positive' },
    ]
    expect(networkWirePath(loop, 'supply positive', 'tap pin')).toEqual(['d'])
    expect(
      networkOverview(nodes, [{ id: 'bad', source: 'supply', target: 'tap' }], new Map()),
    ).toEqual([])
  })
})
