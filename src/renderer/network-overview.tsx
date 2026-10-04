import { type ReactNode, useMemo, useState } from 'react'
import type { TimingPath, TimingReport } from '../static-timing.ts'
import type { NetInspectorEdge, NetInspectorNode } from './net-inspector.ts'
import { networkNames } from './network-names.ts'
import {
  networkDeviceSummary,
  networkGroupSummaries,
  networkIslands,
  networkOverview,
  networkWirePath,
} from './network-overview.ts'
import { nodeOfEndpoint } from './output-contention.ts'
import type { PartReading } from './part-readings.ts'
import { THEME } from './theme.ts'
import { formatEng } from './units.ts'

export function NetworkOverview({
  nodes,
  edges,
  voltages,
  readings,
  timing,
  timingPaths = [],
  onSelect,
  onRename,
}: {
  nodes: NetInspectorNode[]
  edges: NetInspectorEdge[]
  voltages: ReadonlyMap<string, number>
  readings: ReadonlyMap<string, PartReading>
  timing: TimingReport
  timingPaths?: TimingPath[]
  onSelect: (nodeIds: string[], wireIds: string[]) => void
  onRename?: (kind: 'net' | 'group', ids: string[], name: string) => void
}) {
  const [query, setQuery] = useState('')
  const rows = useMemo(() => networkOverview(nodes, edges, voltages), [nodes, edges, voltages])
  const islands = useMemo(() => networkIslands(nodes, edges), [nodes, edges])
  const groupSummaries = useMemo(
    () => networkGroupSummaries(islands, rows, timingPaths),
    [islands, rows, timingPaths],
  )
  const labels = useMemo(
    () => new Map(nodes.map((node) => [node.id, node.data?.label || node.id])),
    [nodes],
  )
  const groupNames = useMemo(
    () => new Map(nodes.map((node) => [node.id, node.data?.networkGroup])),
    [nodes],
  )
  const matches = rows.filter((row) =>
    `${row.name} ${row.aliases.join(' ')}`.toLowerCase().includes(query.toLowerCase()),
  )
  return (
    <section
      data-testid="network-overview"
      style={{ width: 210, color: THEME.textPrimary, fontSize: 11 }}
    >
      <h3>Network overview</h3>
      <p>
        Timing across the design:{' '}
        {timing.critical && Number.isFinite(timing.maxFrequency)
          ? `${formatEng(timing.maxFrequency, 'Hz')} maximum clock · ${timing.state}`
          : 'no register-to-register result'}
      </p>
      <details>
        <summary>{islands.length} device connection groups</summary>
        <p>
          Groups follow wires between device bodies, including isolated objects. They do not imply
          conduction through a device.
        </p>
        <NetworkPage
          key={query}
          label="groups"
          items={islands.filter((island) =>
            island.some((id) =>
              `${labels.get(id) ?? id} ${groupNames.get(id) ?? ''}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            ),
          )}
          renderItem={(island) => (
            <div key={island[0]}>
              <strong>
                {networkNames(island.map((id) => groupNames.get(id))).join(' / ') ||
                  'Unnamed group'}
              </strong>
              <DeviceSummary ids={island} readings={readings} />
              <GroupElectricalSummary summary={groupSummaries.get(island[0] ?? '')} />
              <button type="button" onClick={() => onSelect(island, [])}>
                Select {island.length} devices
              </button>
              {onRename ? (
                <NetworkNameEditor
                  key={networkNames(island.map((id) => groupNames.get(id))).join(' / ')}
                  label={`Group name for ${island[0]}`}
                  initial={networkNames(island.map((id) => groupNames.get(id))).join(' / ')}
                  onSave={(name) => onRename('group', island, name)}
                />
              ) : null}
            </div>
          )}
        />
      </details>
      <p>
        {rows.length} wired nets · {nodes.length} canvas objects
      </p>
      <input
        aria-label="Find net or device"
        placeholder="Find net or device"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        style={{ width: '100%', boxSizing: 'border-box' }}
      />
      <p>
        Wire connectivity only. A connected wire path does not prove a powered or conducting
        circuit.
      </p>
      <p>
        Values come from the recorded canvas solve, not an AC sweep or scope trace. They may predate
        edits until Solve runs. Timing is the separate static model. Unknown readings are not zero.
        No scheduling priority is assigned to electrical nets.
      </p>
      <NetworkPage
        key={query}
        label="nets"
        items={matches}
        renderItem={(row) => (
          <details key={row.id} style={{ marginBottom: 8, overflowWrap: 'anywhere' }}>
            <summary>
              {(row.aliases.join(' / ') || row.name).slice(0, 160)}
              {(row.aliases.join(' / ') || row.name).length > 160 ? '…' : ''}
            </summary>
            {row.aliases.length > 1 ? (
              <p>Merged net carries multiple names. Rename to reconcile them.</p>
            ) : null}
            {onRename ? (
              <NetworkNameEditor
                key={row.aliases.join(' / ')}
                label={`Net name for ${row.id}`}
                initial={row.aliases.join(' / ')}
                onSave={(name) => onRename('net', row.wireIds, name)}
              />
            ) : null}
            <p>
              {row.drivers.length} source/output pins · {row.loads.length} input pins ·{' '}
              {row.passiveCount} passive · {row.unknownCount} unknown
            </p>
            <p>
              {row.endpoints.length} connected endpoints · {row.wireIds.length} wires
            </p>
            <p>Structural topology: {row.topology}. This is not an electrical safety verdict.</p>
            {row.findings.map((finding) => (
              <p key={finding.code}>{finding.message}</p>
            ))}
            <p>
              Recorded endpoint voltage:{' '}
              {row.voltageMin === null || row.voltageMax === null
                ? 'unavailable'
                : `${formatEng(row.voltageMin, 'V')} to ${formatEng(row.voltageMax, 'V')}`}{' '}
              ({row.measuredEndpoints}/{row.endpoints.length} endpoints)
            </p>
            <p>
              Maximum recorded wire current:{' '}
              {row.maxCurrent === null ? 'unavailable' : formatEng(row.maxCurrent, 'A')} (
              {row.measuredWires}/{row.wireIds.length} wires; maximum magnitude, not a sum)
            </p>
            <p>Device readings (each device once on this net):</p>
            <p>
              Recorded wire-route length:{' '}
              {row.recordedLengthM === null || !Number.isFinite(row.recordedLengthM)
                ? 'unavailable'
                : formatEng(row.recordedLengthM, 'm')}{' '}
              ({row.measuredLengths}/{row.wireIds.length} wires). Sum of measured segments, not
              source-to-load distance. Select wires for gauge, material, resistance, and individual
              length.
            </p>
            <NetworkPage
              label="devices"
              items={[...new Set(row.endpoints.map(nodeOfEndpoint))]}
              renderItem={(nodeId) => {
                const reading = readings.get(nodeId)
                return (
                  <p key={nodeId}>
                    {nodeId}: power{' '}
                    {reading?.power !== undefined && Number.isFinite(reading.power)
                      ? formatEng(reading.power, 'W')
                      : 'unavailable'}{' '}
                    · temperature{' '}
                    {reading?.temperatureC !== undefined && Number.isFinite(reading.temperatureC)
                      ? `${reading.temperatureC.toFixed(1)} °C`
                      : 'unavailable'}
                  </p>
                )
              }}
            />
            <button type="button" onClick={() => onSelect([], row.wireIds)}>
              Select net wires
            </button>
            <NetworkPage
              label="terminals"
              items={row.endpoints}
              renderItem={(endpoint) => (
                <div key={endpoint}>
                  <button type="button" onClick={() => onSelect([nodeOfEndpoint(endpoint)], [])}>
                    {endpoint}
                  </button>
                  {row.drivers[0] !== undefined ? (
                    <button
                      type="button"
                      onClick={() => {
                        const path = networkWirePath(edges, row.drivers[0] ?? '', endpoint)
                        if (path !== null) onSelect([], path)
                      }}
                    >
                      Select wire path from {row.drivers[0]}
                    </button>
                  ) : null}
                </div>
              )}
            />
          </details>
        )}
      />
      {matches.length === 0 ? <p>No matching wired nets.</p> : null}
    </section>
  )
}

function NetworkPage<Item>({
  label,
  items,
  renderItem,
}: {
  label: string
  items: Item[]
  renderItem: (item: Item) => ReactNode
}) {
  const [requestedPage, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(items.length / 50))
  const page = Math.min(requestedPage, pageCount - 1)
  const start = page * 50
  return (
    <div>
      {items.slice(start, start + 50).map(renderItem)}
      {pageCount > 1 ? (
        <div>
          <p>
            {label}: {start + 1}–{Math.min(start + 50, items.length)} of {items.length}
          </p>
          <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous {label}
          </button>
          <button type="button" disabled={page + 1 === pageCount} onClick={() => setPage(page + 1)}>
            Next {label}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function GroupElectricalSummary({
  summary,
}: {
  summary: ReturnType<typeof networkGroupSummaries> extends Map<string, infer Summary>
    ? Summary | undefined
    : never
}) {
  if (!summary) return null
  return (
    <p>
      {summary.netCount} wired nets · endpoint voltage range{' '}
      {summary.voltageMin === null || summary.voltageMax === null
        ? 'unavailable'
        : `${formatEng(summary.voltageMin, 'V')} to ${formatEng(summary.voltageMax, 'V')}`}{' '}
      ({summary.measuredEndpoints}/{summary.endpointCount} endpoints). Maximum wire current
      magnitude {summary.currentMax === null ? 'unavailable' : formatEng(summary.currentMax, 'A')} (
      {summary.measuredWires}/{summary.wireCount} wires). Static combinational delay maximum{' '}
      {summary.delayMax === null ? 'unavailable' : formatEng(summary.delayMax, 's')} (
      {summary.measuredTimingPaths}/{summary.timingPaths} valid traced register paths fully inside
      this group; not a transient measurement).
    </p>
  )
}

function DeviceSummary({
  ids,
  readings,
}: {
  ids: string[]
  readings: ReadonlyMap<string, PartReading>
}) {
  const summary = networkDeviceSummary(ids, readings)
  return (
    <p>
      {summary.deviceCount} devices · recorded power magnitudes{' '}
      {summary.powerMagnitude === null ? 'unavailable' : formatEng(summary.powerMagnitude, 'W')} (
      {summary.powerCount}/{summary.deviceCount}). Source delivery and device absorption are both
      included; this is not net consumption or an energy balance. Maximum recorded temperature{' '}
      {summary.temperatureMax === null ? 'unavailable' : `${summary.temperatureMax.toFixed(1)} °C`}{' '}
      ({summary.temperatureCount}/{summary.deviceCount}); minimum thermal headroom{' '}
      {summary.minimumHeadroom === null
        ? 'unavailable'
        : `${summary.minimumHeadroom.toFixed(1)} °C`}{' '}
      ({summary.headroomCount}/{summary.deviceCount}).
    </p>
  )
}

function NetworkNameEditor({
  label,
  initial,
  onSave,
}: {
  label: string
  initial: string
  onSave: (name: string) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSave(value)
      }}
    >
      <label>
        {label}
        <input maxLength={120} value={value} onChange={(event) => setValue(event.target.value)} />
      </label>
      <button type="submit">Save name</button>
    </form>
  )
}
