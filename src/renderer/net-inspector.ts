import {
  asBlockId,
  asDiagnosticId,
  asNetId,
  asSubgraphId,
  asTerminalId,
  endpointId,
  type RuntimeDiagnostic,
  type RuntimeEndpoint,
  type RuntimeNet,
  type RuntimeWhySystem,
  runtimePortOf,
} from '../runtime-contracts.ts'
import { type RuntimeWhyNode, whyExplanation, whySystemFor } from '../runtime-why.ts'
import type { BlockPort, DriveKind } from './blocks.ts'
import {
  buildNets,
  type ContentionFinding,
  detectOutputContention,
  endpointKey,
  handleOfEndpoint,
  type LiveLevels,
  nodeOfEndpoint,
} from './output-contention.ts'
import type { Parameters } from './part-defaults.ts'
import { terminalsOf } from './symbols.tsx'
export type NetInspectorNode = {
  id: string
  data?: {
    definition?: string
    label?: string
    parameters?: Parameters
    block?: { ports?: BlockPort[] }
  }
}

export type NetInspectorEdge = {
  id?: string
  source: string
  sourceHandle?: string | null
  target: string
  targetHandle?: string | null
  data?: {
    amps?: unknown
    drop?: unknown
    lengthM?: unknown
    ohms?: unknown
  }
}

export type NetEndpointRole = 'driver' | 'load' | 'passive' | 'unknown'

export type NetEndpoint = {
  nodeId: string
  nodeLabel: string
  definition: string
  portId: string
  portLabel: string
  role: NetEndpointRole
  drive?: DriveKind
  runtime: RuntimeEndpoint
}

type NetEndpointInfo = Omit<NetEndpoint, 'runtime'>

export type NetStatus = 'contended' | 'attention' | 'driven' | 'undriven' | 'passive'

export type NetInspection = {
  root: string
  endpoints: NetEndpoint[]
  wires: {
    id: string
    amps: number | null
    drop: number | null
    lengthM: number | null
    ohms: number | null
  }[]
  drivers: NetEndpoint[]
  loads: NetEndpoint[]
  passives: NetEndpoint[]
  findings: ContentionFinding[]
  status: NetStatus
  currentA: number | null
  voltageDropV: number | null
  lengthM: number | null
  resistanceOhm: number | null
  nextStep: string
  net: RuntimeNet
  diagnostics: RuntimeDiagnostic[]
  why: RuntimeWhySystem
}

const endpointOf = (nodeId: string, handle: string | null | undefined): string | null =>
  handle ? endpointKey(nodeId, handle) : null

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const endpointInfo = (node: NetInspectorNode | undefined, portId: string): NetEndpointInfo => {
  const definition = node?.data?.definition ?? 'unknown'
  const nodeLabel = node?.data?.label ?? node?.id ?? 'unknown'
  const blockPort = node?.data?.block?.ports?.find((port) => port.id === portId)
  if (blockPort !== undefined) {
    const role: NetEndpointRole =
      blockPort.drive === undefined ? 'unknown' : blockPort.drive === 'input' ? 'load' : 'driver'
    return {
      nodeId: node?.id ?? '',
      nodeLabel,
      definition,
      portId,
      portLabel: blockPort.name ?? blockPort.label,
      role,
      ...(blockPort.drive === undefined ? {} : { drive: blockPort.drive }),
    }
  }

  const terminal = node?.data?.definition
    ? terminalsOf(node.data.definition, node.data.parameters).find((item) => item.id === portId)
    : undefined
  const role: NetEndpointRole =
    definition === 'power_source' ? 'driver' : definition === 'ground' ? 'load' : 'passive'
  return {
    nodeId: node?.id ?? '',
    nodeLabel,
    definition,
    portId,
    portLabel: terminal === undefined ? portId : terminal.id.replaceAll('_', ' '),
    role,
  }
}

const nextStepFor = (
  status: NetStatus,
  drivers: readonly NetEndpoint[],
  loads: readonly NetEndpoint[],
  findings: readonly ContentionFinding[],
  compatibilityIssue?: RuntimeDiagnostic,
): string => {
  if (compatibilityIssue !== undefined) return compatibilityIssue.message
  if (status === 'contended') {
    return findings[0]?.message ?? 'Inspect the output drivers sharing this net.'
  }
  if (status === 'attention') {
    return findings[0]?.message ?? 'Inspect the warning and its affected endpoints.'
  }
  if (status === 'undriven') {
    return loads.length > 0
      ? 'Inspect the load endpoints for a missing source, pull-up, or enabled driver.'
      : 'Inspect this net for a missing source or enabled driver.'
  }
  if (status === 'passive') {
    return 'Inspect this passive-only net for a missing driver before relying on its value.'
  }
  if (drivers.length > 0 && loads.length === 0) {
    return 'Inspect whether this driven net is missing its intended load.'
  }
  return 'Inspect the listed loads and the wire current or voltage drop for the affected endpoint.'
}

const endpointTarget = (
  endpoint: NetEndpoint,
): {
  blockId: NetEndpoint['runtime']['blockId']
  terminalId: NetEndpoint['runtime']['terminalId']
} => ({
  blockId: endpoint.runtime.blockId,
  terminalId: endpoint.runtime.terminalId,
})

function incompatibleConnectionDiagnostic(
  root: string,
  endpoints: readonly NetEndpoint[],
): RuntimeDiagnostic | undefined {
  for (let leftIndex = 0; leftIndex < endpoints.length; leftIndex++) {
    const left = endpoints[leftIndex]
    if (left === undefined) continue
    for (const right of endpoints.slice(leftIndex + 1)) {
      const domainMismatch = left.runtime.domain !== right.runtime.domain
      const unitMismatch =
        left.runtime.unit !== 'unknown' &&
        right.runtime.unit !== 'unknown' &&
        left.runtime.unit !== right.runtime.unit
      if (!domainMismatch && !unitMismatch) continue
      const reason = domainMismatch
        ? `domain ${left.runtime.domain} cannot connect directly to ${right.runtime.domain}`
        : `unit ${left.runtime.unit} cannot connect directly to ${right.runtime.unit}`
      const target = {
        netId: asNetId(root),
        blockId: left.runtime.blockId,
        terminalId: left.runtime.terminalId,
      }
      return {
        id: asDiagnosticId(`incompatible-connection-${root}`),
        code: 'incompatible-connection',
        severity: 'error',
        state: 'failed',
        message: `Incompatible connection: ${left.nodeLabel} · ${left.portLabel} and ${right.nodeLabel} · ${right.portLabel} — ${reason}.`,
        target,
        repair: {
          action: 'select',
          message:
            'Select the affected terminals and correct their domain or unit before rerunning.',
          target,
        },
      }
    }
  }
  return undefined
}

function missingDriverDiagnostic(
  root: string,
  status: NetStatus,
  loads: readonly NetEndpoint[],
  passives: readonly NetEndpoint[],
): RuntimeDiagnostic | undefined {
  if (status !== 'undriven' && status !== 'passive') return undefined
  const endpoint = loads[0] ?? passives[0]
  const target = {
    netId: asNetId(root),
    ...(endpoint === undefined ? {} : endpointTarget(endpoint)),
  }
  const requiredInput = loads.length > 0
  return {
    id: asDiagnosticId(`${requiredInput ? 'missing-required-input' : 'missing-driver'}-${root}`),
    code: requiredInput ? 'missing-required-input' : 'missing-driver',
    severity: 'warning',
    state: 'blocked',
    message: requiredInput
      ? `Required input ${endpoint?.nodeLabel ?? 'endpoint'} · ${endpoint?.portLabel ?? ''} has no driver on this net — inspect for a missing source or enabled driver.`
      : 'This net has no source or driver; inspect for a missing source before relying on its value.',
    target,
    repair: {
      action: 'connect',
      message: 'Connect a valid source or enable the intended driver, then rerun the analysis.',
      target,
    },
  }
}

export function inspectNet(
  nodes: NetInspectorNode[],
  edges: NetInspectorEdge[],
  selectedEndpoint: string,
  live?: LiveLevels,
): NetInspection | null {
  const { rootOf, groups } = buildNets(edges)
  const selectedRoot = rootOf(selectedEndpoint)
  if (selectedRoot === undefined) return null
  const group = groups.find((candidate) => candidate.includes(selectedEndpoint))
  if (group === undefined) return null
  const root = [...group].sort()[0] ?? selectedRoot
  const groupEndpoints = new Set(group)
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const endpoints = [...group]
    .map((endpoint) => {
      const nodeId = nodeOfEndpoint(endpoint)
      const portId = handleOfEndpoint(endpoint)
      const info = endpointInfo(nodeById.get(nodeId), portId)
      const port = nodeById
        .get(nodeId)
        ?.data?.block?.ports?.find((candidate) => candidate.id === portId)
      const runtimePort = runtimePortOf(
        port ?? {
          id: portId,
          label: info.portLabel,
          role:
            info.role === 'driver'
              ? 'source'
              : info.role === 'load'
                ? 'load'
                : info.role === 'passive'
                  ? 'passive'
                  : 'unknown',
        },
      )
      const runtime: RuntimeEndpoint = {
        id: endpointId(asBlockId(nodeId), asTerminalId(portId)),
        blockId: asBlockId(nodeId),
        terminalId: asTerminalId(portId),
        netId: asNetId(root),
        label: info.portLabel,
        domain: runtimePort.domain,
        role: runtimePort.role,
        direction: runtimePort.direction,
        unit: runtimePort.unit,
        ...(runtimePort.drive === undefined ? {} : { drive: runtimePort.drive }),
      }
      return { ...info, runtime }
    })
    .sort((a, b) => `${a.nodeId}/${a.portId}`.localeCompare(`${b.nodeId}/${b.portId}`))
  const netEdges = edges
    .filter((edge) => {
      const source = endpointOf(edge.source, edge.sourceHandle)
      const target = endpointOf(edge.target, edge.targetHandle)
      return (
        source !== null &&
        target !== null &&
        groupEndpoints.has(source) &&
        groupEndpoints.has(target)
      )
    })
    .map((edge, index) => ({
      id: edge.id ?? `wire-${index + 1}`,
      amps: finite(edge.data?.amps),
      drop: finite(edge.data?.drop),
      lengthM: finite(edge.data?.lengthM),
      ohms: finite(edge.data?.ohms),
    }))
  const findings = detectOutputContention(nodes, edges, live).filter((finding) =>
    finding.pins.some((pin) => groupEndpoints.has(endpointKey(pin.nodeId, pin.portId))),
  )
  const drivers = endpoints.filter((endpoint) => endpoint.role === 'driver')
  const loads = endpoints.filter((endpoint) => endpoint.role === 'load')
  const passives = endpoints.filter(
    (endpoint) => endpoint.role === 'passive' || endpoint.role === 'unknown',
  )
  const currentA = netEdges.reduce<number | null>((max, wire) => {
    if (wire.amps === null) return max
    return max === null ? Math.abs(wire.amps) : Math.max(max, Math.abs(wire.amps))
  }, null)
  const voltageDropV = netEdges.reduce<number | null>((max, wire) => {
    if (wire.drop === null) return max
    return max === null ? Math.abs(wire.drop) : Math.max(max, Math.abs(wire.drop))
  }, null)
  const lengthM = netEdges.reduce<number | null>((sum, wire) => {
    if (wire.lengthM === null) return sum
    return (sum ?? 0) + wire.lengthM
  }, null)
  const resistanceOhm = netEdges.reduce<number | null>((sum, wire) => {
    if (wire.ohms === null) return sum
    return (sum ?? 0) + wire.ohms
  }, null)
  const hasError = findings.some((finding) => finding.severity === 'error')
  const hasWarning = findings.some((finding) => finding.severity === 'warning')
  const incompatibility = incompatibleConnectionDiagnostic(root, endpoints)
  const status: NetStatus = hasError
    ? 'contended'
    : hasWarning || incompatibility !== undefined
      ? 'attention'
      : drivers.length > 0
        ? 'driven'
        : loads.length > 0
          ? 'undriven'
          : 'passive'
  const diagnostics: RuntimeDiagnostic[] = findings.map((finding, index) => {
    const pin = finding.pins[0]
    const target = {
      netId: asNetId(root),
      ...(pin === undefined
        ? {}
        : { blockId: asBlockId(pin.nodeId), terminalId: asTerminalId(pin.portId) }),
    }
    return {
      id: asDiagnosticId(`${finding.code}-${root}-${index + 1}`),
      code: finding.code,
      severity: finding.severity,
      state: finding.severity === 'error' ? 'failed' : 'waiting',
      message: finding.message,
      target,
      repair: {
        action: 'select',
        message: 'Select the affected output pins and inspect the net.',
        target,
      },
    }
  })
  if (incompatibility !== undefined) diagnostics.unshift(incompatibility)
  const missingDriver = missingDriverDiagnostic(root, status, loads, passives)
  if (missingDriver !== undefined) diagnostics.push(missingDriver)
  const nextStep = nextStepFor(status, drivers, loads, findings, incompatibility ?? missingDriver)
  const net: RuntimeNet = {
    id: asNetId(root),
    subgraphId: asSubgraphId(`net:${root}`),
    domain: 'electrical',
    endpoints: endpoints.map((endpoint) => endpoint.runtime),
    driverCount: drivers.length,
    loadCount: loads.length,
    passiveCount: passives.length,
    status,
    state:
      status === 'contended'
        ? 'failed'
        : status === 'attention'
          ? 'waiting'
          : status === 'driven'
            ? 'complete'
            : 'blocked',
    nextStep,
    readings: {
      current: { value: currentA, unit: 'ampere' },
      voltageDrop: { value: voltageDropV, unit: 'volt' },
      length: { value: lengthM, unit: 'unknown' },
      resistance: { value: resistanceOhm, unit: 'ohm' },
    },
    diagnostics,
  }
  const source = drivers[0]
  const terminal = source ?? loads[0] ?? passives[0]
  const device = loads[0] ?? passives[0]
  const path: RuntimeWhyNode[] = [
    ...(source === undefined
      ? []
      : [
          {
            kind: 'source' as const,
            label: source.nodeLabel,
            state: 'complete' as const,
            target: endpointTarget(source),
          },
        ]),
    ...(terminal === undefined
      ? []
      : [
          {
            kind: 'terminal' as const,
            label: terminal.portLabel,
            state: 'complete' as const,
            target: endpointTarget(terminal),
          },
        ]),
    {
      kind: 'net' as const,
      label: `net ${root}`,
      state: net.state,
      target: { netId: net.id, subgraphId: net.subgraphId },
      detail: `${drivers.length} driver(s), ${loads.length} load(s), ${passives.length} passive endpoint(s)`,
    },
    ...(device === undefined
      ? []
      : [
          {
            kind: 'device-state' as const,
            label: device.nodeLabel,
            state: net.state,
            target: endpointTarget(device),
          },
        ]),
    {
      kind: 'output' as const,
      label: status,
      state: net.state,
      target: { netId: net.id },
      detail: nextStep,
    },
  ]
  const causeDiagnostic = diagnostics[0]
  const cause =
    causeDiagnostic === undefined
      ? undefined
      : {
          kind:
            causeDiagnostic.code === 'incompatible-connection'
              ? ('incompatible-connection' as const)
              : causeDiagnostic.code.includes('missing')
                ? ('missing-driver' as const)
                : ('contention' as const),
          message: causeDiagnostic.message,
          ...(causeDiagnostic.target === undefined ? {} : { target: causeDiagnostic.target }),
          ...(causeDiagnostic.repair === undefined ? {} : { repair: causeDiagnostic.repair }),
          ...(drivers.length === 0
            ? {}
            : {
                sources: drivers.map((driver) => ({
                  blockId: driver.runtime.blockId,
                  terminalId: driver.runtime.terminalId,
                })),
              }),
        }
  const why = whySystemFor([
    whyExplanation({
      id: `net-${root}`,
      state: net.state,
      summary: nextStep,
      path,
      ...(cause === undefined ? {} : { cause }),
      diagnostics,
      transitions: [
        { from: 'ready', to: 'active', detail: `Inspecting net ${root}.` },
        { from: 'active', to: net.state, detail: nextStep },
      ],
      observations: [
        {
          source: 'net-inspector',
          label: 'wire current',
          detail: 'Maximum absolute current recorded on this net.',
          target: { netId: net.id },
          quantity: net.readings.current,
        },
        {
          source: 'net-inspector',
          label: 'wire voltage drop',
          detail: 'Maximum absolute drop recorded on this net.',
          target: { netId: net.id },
          quantity: net.readings.voltageDrop,
        },
      ],
    }),
  ])
  net.why = why
  return {
    root,
    endpoints,
    wires: netEdges,
    drivers,
    loads,
    passives,
    findings,
    status,
    currentA,
    voltageDropV,
    lengthM,
    resistanceOhm,
    nextStep,
    net,
    diagnostics,
    why,
  }
}
