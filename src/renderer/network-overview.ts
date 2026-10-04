import { runtimePortOf } from '../runtime-contracts.ts'
import type { TimingPath } from '../static-timing.ts'
import type { NetInspectorEdge, NetInspectorNode } from './net-inspector.ts'
import { networkNames } from './network-names.ts'
import {
  buildNets,
  type ContentionFinding,
  detectOutputContention,
  endpointKey,
  handleOfEndpoint,
  nodeOfEndpoint,
} from './output-contention.ts'
import type { PartReading } from './part-readings.ts'
import { resolveUserPart } from './user-parts.ts'

const passiveDefinitions = new Set([
  'resistor',
  'capacitor',
  'inductor',
  'diode',
  'led',
  'transformer',
  'switch',
  'fuse',
  'junction',
  'ground',
])

export type NetworkRow = {
  id: string
  name: string
  aliases: string[]
  endpoints: string[]
  wireIds: string[]
  drivers: string[]
  loads: string[]
  passiveCount: number
  unknownCount: number
  voltageMin: number | null
  voltageMax: number | null
  measuredEndpoints: number
  maxCurrent: number | null
  measuredWires: number
  recordedLengthM: number | null
  measuredLengths: number
  findings: ContentionFinding[]
  topology: 'attention' | 'source-connected' | 'no-declared-source' | 'unknown'
}

export function networkGroupSummaries(
  islands: string[][],
  rows: NetworkRow[],
  paths: TimingPath[],
) {
  const groupOf = new Map<string, string>()
  const summaries = new Map<
    string,
    {
      netCount: number
      endpointCount: number
      measuredEndpoints: number
      wireCount: number
      measuredWires: number
      voltageMin: number | null
      voltageMax: number | null
      currentMax: number | null
      timingPaths: number
      measuredTimingPaths: number
      delayMax: number | null
    }
  >()
  for (const island of islands) {
    const key = island[0]
    if (key === undefined) continue
    for (const id of island) groupOf.set(id, key)
    summaries.set(key, {
      netCount: 0,
      endpointCount: 0,
      measuredEndpoints: 0,
      wireCount: 0,
      measuredWires: 0,
      voltageMin: null,
      voltageMax: null,
      currentMax: null,
      timingPaths: 0,
      measuredTimingPaths: 0,
      delayMax: null,
    })
  }
  for (const row of rows) {
    const group = groupOf.get(nodeOfEndpoint(row.id))
    const summary = group === undefined ? undefined : summaries.get(group)
    if (!summary) continue
    summary.netCount++
    summary.endpointCount += row.endpoints.length
    summary.measuredEndpoints += row.measuredEndpoints
    summary.wireCount += row.wireIds.length
    summary.measuredWires += row.measuredWires
    if (row.voltageMin !== null)
      summary.voltageMin = Math.min(summary.voltageMin ?? row.voltageMin, row.voltageMin)
    if (row.voltageMax !== null)
      summary.voltageMax = Math.max(summary.voltageMax ?? row.voltageMax, row.voltageMax)
    if (row.maxCurrent !== null)
      summary.currentMax = Math.max(summary.currentMax ?? row.maxCurrent, row.maxCurrent)
  }
  for (const path of paths) {
    const group = groupOf.get(path.from)
    if (
      group === undefined ||
      groupOf.get(path.to) !== group ||
      path.gates.some((id) => groupOf.get(id) !== group)
    )
      continue
    const summary = summaries.get(group)
    if (!summary) continue
    summary.timingPaths++
    if (Number.isFinite(path.logicDelayMax) && path.logicDelayMax >= 0) {
      summary.measuredTimingPaths++
      summary.delayMax = Math.max(summary.delayMax ?? path.logicDelayMax, path.logicDelayMax)
    }
  }
  for (const summary of summaries.values()) {
    if (summary.measuredTimingPaths !== summary.timingPaths) summary.delayMax = null
  }
  return summaries
}

export function networkIslands(nodes: NetInspectorNode[], edges: NetInspectorEdge[]): string[][] {
  const adjacent = new Map(nodes.map((node) => [node.id, new Set<string>()]))
  for (const edge of edges) {
    if (!edge.sourceHandle || !edge.targetHandle) continue
    if (!adjacent.has(edge.source) || !adjacent.has(edge.target)) continue
    adjacent.get(edge.source)?.add(edge.target)
    adjacent.get(edge.target)?.add(edge.source)
  }
  const visited = new Set<string>()
  const islands: string[][] = []
  for (const start of [...adjacent.keys()].sort()) {
    if (visited.has(start)) continue
    const queue = [start]
    visited.add(start)
    for (let index = 0; index < queue.length; index++) {
      for (const next of adjacent.get(queue[index] ?? '') ?? []) {
        if (visited.has(next)) continue
        visited.add(next)
        queue.push(next)
      }
    }
    islands.push(queue.sort())
  }
  return islands
}

export function networkOverview(
  nodes: NetInspectorNode[],
  edges: NetInspectorEdge[],
  voltages: ReadonlyMap<string, number>,
): NetworkRow[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const { groups, rootOf } = buildNets(edges)
  const rows = new Map<string, NetworkRow>()
  for (const group of groups) {
    const endpoints = [...group].sort()
    const first = endpoints[0]
    if (first === undefined) continue
    const root = rootOf(first)
    if (root === undefined) continue
    const drivers: string[] = []
    const loads: string[] = []
    let passiveCount = 0
    let unknownCount = 0
    const values: number[] = []
    for (const endpoint of endpoints) {
      const node = nodeById.get(nodeOfEndpoint(endpoint))
      const handle = handleOfEndpoint(endpoint)
      const port = node?.data?.block?.ports?.find((candidate) => candidate.id === handle)
      const pin = resolveUserPart(node?.data?.definition ?? '')?.pins.find(
        (candidate) => candidate.id === handle,
      )
      const declaredRole =
        pin?.electrical === 'input' || pin?.electrical === 'power_in'
          ? 'load'
          : pin?.electrical === 'output' || pin?.electrical === 'power_out'
            ? 'source'
            : pin?.electrical === 'passive'
              ? 'passive'
              : undefined
      const role = port === undefined ? declaredRole : runtimePortOf(port).role
      if (role === 'load') loads.push(endpoint)
      else if (role === 'source') drivers.push(endpoint)
      else if (role === 'passive') passiveCount++
      else if (node?.data?.definition === 'power_source') drivers.push(endpoint)
      else if (
        node?.data?.definition &&
        !node.data.block &&
        pin === undefined &&
        passiveDefinitions.has(node.data.definition)
      )
        passiveCount++
      else unknownCount++
      const value = voltages.get(`${nodeOfEndpoint(endpoint)}/${handle}`)
      if (value !== undefined && Number.isFinite(value)) values.push(value)
    }
    const names = endpoints.map((endpoint) => {
      const node = nodeById.get(nodeOfEndpoint(endpoint))
      return `${node?.data?.label || nodeOfEndpoint(endpoint)}.${handleOfEndpoint(endpoint)}`
    })
    rows.set(root, {
      id: first,
      name: names.join(' ↔ '),
      aliases: [],
      endpoints,
      wireIds: [],
      drivers,
      loads,
      passiveCount,
      unknownCount,
      voltageMin: values.length ? values.reduce((low, value) => Math.min(low, value)) : null,
      voltageMax: values.length ? values.reduce((high, value) => Math.max(high, value)) : null,
      measuredEndpoints: values.length,
      maxCurrent: null,
      measuredWires: 0,
      recordedLengthM: null,
      measuredLengths: 0,
      findings: [],
      topology:
        unknownCount > 0
          ? 'unknown'
          : drivers.length > 0
            ? 'source-connected'
            : 'no-declared-source',
    })
  }
  for (const edge of edges) {
    if (!edge.sourceHandle || !edge.targetHandle) continue
    const root = rootOf(endpointKey(edge.source, edge.sourceHandle))
    const row = root === undefined ? undefined : rows.get(root)
    if (!row) continue
    row.aliases = networkNames([...row.aliases, edge.data?.netName])
    if (edge.id !== undefined) row.wireIds.push(edge.id)
    const length = edge.data?.lengthM
    if (typeof length === 'number' && Number.isFinite(length) && length >= 0) {
      row.recordedLengthM = (row.recordedLengthM ?? 0) + length
      row.measuredLengths++
    }
    const amps = edge.data?.amps
    if (typeof amps === 'number' && Number.isFinite(amps)) {
      row.measuredWires++
      row.maxCurrent = Math.max(row.maxCurrent ?? 0, Math.abs(amps))
    }
  }
  for (const finding of detectOutputContention(nodes, edges)) {
    const pin = finding.pins[0]
    if (!pin) continue
    const root = rootOf(endpointKey(pin.nodeId, pin.portId))
    const row = root === undefined ? undefined : rows.get(root)
    if (!row) continue
    row.findings.push(finding)
    row.topology = 'attention'
  }
  return [...rows.values()]
    .map((row) => ({ ...row, wireIds: row.wireIds.sort() }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

export function networkDeviceSummary(
  ids: readonly string[],
  readings: ReadonlyMap<string, PartReading>,
) {
  let powerMagnitude = 0
  let powerCount = 0
  let temperatureMax: number | null = null
  let temperatureCount = 0
  let minimumHeadroom: number | null = null
  let headroomCount = 0
  const uniqueIds = new Set(ids)
  for (const id of uniqueIds) {
    const reading = readings.get(id)
    if (reading?.power !== undefined && Number.isFinite(reading.power)) {
      powerMagnitude += Math.abs(reading.power)
      powerCount++
    }
    if (reading?.temperatureC === undefined || !Number.isFinite(reading.temperatureC)) continue
    temperatureMax = Math.max(temperatureMax ?? reading.temperatureC, reading.temperatureC)
    temperatureCount++
    if (reading.maxTemperatureC === undefined || !Number.isFinite(reading.maxTemperatureC)) continue
    const headroom = reading.maxTemperatureC - reading.temperatureC
    minimumHeadroom = Math.min(minimumHeadroom ?? headroom, headroom)
    headroomCount++
  }
  return {
    deviceCount: uniqueIds.size,
    powerMagnitude: powerCount > 0 && Number.isFinite(powerMagnitude) ? powerMagnitude : null,
    powerCount,
    temperatureMax,
    temperatureCount,
    minimumHeadroom,
    headroomCount,
  }
}

export function networkWirePath(
  edges: NetInspectorEdge[],
  start: string,
  destination: string,
): string[] | null {
  const adjacent = new Map<string, { endpoint: string; wire: string }[]>()
  for (const edge of [...edges].sort((left, right) =>
    (left.id ?? '').localeCompare(right.id ?? ''),
  )) {
    if (!edge.id || !edge.sourceHandle || !edge.targetHandle) continue
    const source = endpointKey(edge.source, edge.sourceHandle)
    const target = endpointKey(edge.target, edge.targetHandle)
    const sourceHops = adjacent.get(source) ?? []
    sourceHops.push({ endpoint: target, wire: edge.id })
    adjacent.set(source, sourceHops)
    const targetHops = adjacent.get(target) ?? []
    targetHops.push({ endpoint: source, wire: edge.id })
    adjacent.set(target, targetHops)
  }
  if (!adjacent.has(start) || !adjacent.has(destination)) return null
  const queue = [start]
  const previous = new Map<string, { endpoint: string; wire: string } | null>([[start, null]])
  for (let index = 0; index < queue.length; index++) {
    const endpoint = queue[index]
    if (endpoint === undefined) continue
    if (endpoint === destination) {
      const path: string[] = []
      let cursor = destination
      while (cursor !== start) {
        const hop = previous.get(cursor)
        if (!hop) return null
        path.push(hop.wire)
        cursor = hop.endpoint
      }
      return path.reverse()
    }
    for (const hop of adjacent.get(endpoint) ?? []) {
      if (previous.has(hop.endpoint)) continue
      previous.set(hop.endpoint, { endpoint, wire: hop.wire })
      queue.push(hop.endpoint)
    }
  }
  return null
}
