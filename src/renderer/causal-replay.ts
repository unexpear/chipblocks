import {
  asBlockId,
  asDiagnosticId,
  asEventId,
  asNetId,
  asTerminalId,
  type RuntimeCausalEvent,
  type RuntimeDiagnostic,
  type RuntimeWhy,
} from '../runtime-contracts.ts'
import { type RuntimeWhyNode, whyExplanation } from '../runtime-why.ts'
import type { TransientResult } from '../transient-solver.ts'
import type { BlockData } from './blocks.ts'
import { blockPortAliases } from './blocks.ts'
import type { Anomaly, TraceResult } from './run-trace.ts'

export type CausalSource = {
  id: string
  label: string
  definition?: string
  terminals?: string[]
}

export type CausalDiagnostic = {
  code: string
  severity: 'info' | 'warning' | 'error'
  detail: string
}

export type CausalReplayEvent = {
  id: string
  domain: 'digital' | 'timeline'
  kind: 'transition' | 'current-transition' | 'diagnostic'
  cycle?: number
  frameIndex?: number
  time?: number
  signal?: string
  currentKey?: string
  nets: string[]
  from?: number
  to?: number
  registersChanged?: number
  sources: CausalSource[]
  diagnostics: CausalDiagnostic[]
  detail: string
  runtime: RuntimeCausalEvent
  why: RuntimeWhy
}

type CausalReplayEventDraft = Omit<CausalReplayEvent, 'runtime' | 'why'>

export type CausalReplay = {
  events: CausalReplayEvent[]
  transitionCount: number
  diagnosticCount: number
}

export type ReplayInstance = {
  id: string
  definition: string
  connects?: ReadonlyArray<{ net: string; terminal: string }>
}

type TraceSource = { id: string; label: string }

const emptyReplay = (): CausalReplay => ({
  events: [],
  transitionCount: 0,
  diagnosticCount: 0,
})

function replayFromEvents(events: CausalReplayEventDraft[]): CausalReplay {
  const withRuntime = events.map((event) => {
    const why = whyForEvent(event)
    return { ...event, runtime: runtimeEventFor(event, why), why }
  })
  return {
    events: withRuntime,
    transitionCount: withRuntime.filter((event) => event.kind !== 'diagnostic').length,
    diagnosticCount: withRuntime.reduce((count, event) => count + event.diagnostics.length, 0),
  }
}

function runtimeDiagnosticsFor(event: CausalReplayEventDraft): RuntimeDiagnostic[] {
  return event.diagnostics.map((diagnostic, index) => ({
    id: asDiagnosticId(`${event.id}-${diagnostic.code}-${index + 1}`),
    code: diagnostic.code,
    severity: diagnostic.severity,
    state: diagnostic.severity === 'error' ? 'failed' : 'waiting',
    message: diagnostic.detail,
  }))
}

function whyForEvent(event: CausalReplayEventDraft): RuntimeWhy {
  const source = event.sources[0]
  const terminal = source?.terminals?.[0]
  const state = event.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
    ? 'failed'
    : event.kind === 'diagnostic'
      ? 'waiting'
      : 'complete'
  const path: RuntimeWhyNode[] = [
    ...(source === undefined
      ? []
      : [
          {
            kind: 'source' as const,
            label: source.label,
            state: 'complete' as const,
            target: { blockId: asBlockId(source.id) },
          },
        ]),
    ...(terminal === undefined
      ? []
      : [
          {
            kind: 'terminal' as const,
            label: terminal,
            state: 'complete' as const,
            target: { terminalId: asTerminalId(terminal) },
          },
        ]),
    ...(event.nets[0] === undefined
      ? []
      : [
          {
            kind: 'net' as const,
            label: event.nets[0],
            state: 'complete' as const,
            target: { netId: asNetId(event.nets[0]) },
          },
        ]),
    {
      kind: 'device-state',
      label: event.kind,
      state,
      detail: event.detail,
    },
    {
      kind: 'output',
      label: event.signal ?? event.currentKey ?? event.kind,
      state,
      detail: event.detail,
    },
  ]
  const diagnostics = runtimeDiagnosticsFor(event)
  const firstDiagnostic = diagnostics[0]
  return whyExplanation({
    id: `${event.id}-why`,
    state,
    summary: event.detail,
    path,
    ...(firstDiagnostic === undefined
      ? {}
      : {
          cause: {
            kind: event.kind === 'diagnostic' ? 'solver' : 'blocked-hop',
            message: firstDiagnostic.message,
            ...(firstDiagnostic.repair === undefined ? {} : { repair: firstDiagnostic.repair }),
          },
        }),
    diagnostics,
    transitions: [{ from: 'ready', to: state, detail: event.detail }],
    observations: [
      ...(event.from === undefined || event.to === undefined
        ? []
        : [
            {
              source:
                event.domain === 'digital' ? ('causal-replay' as const) : ('timeline' as const),
              label: event.signal ?? event.currentKey ?? 'value',
              detail: `${event.from} → ${event.to}`,
              ...(event.currentKey === undefined
                ? { quantity: { value: event.to, unit: 'boolean' as const } }
                : { quantity: { value: event.to, unit: 'ampere' as const } }),
            },
          ]),
    ],
  })
}

function runtimeEventFor(event: CausalReplayEventDraft, why: RuntimeWhy): RuntimeCausalEvent {
  const source = event.sources[0]
  const terminal = source?.terminals?.[0]
  return {
    id: asEventId(event.id),
    domain: event.domain === 'digital' ? 'digital' : 'electrical',
    state: why.state,
    chain: {
      ...(source === undefined ? {} : { source: { blockId: asBlockId(source.id) } }),
      ...(terminal === undefined ? {} : { terminal: { terminalId: asTerminalId(terminal) } }),
      ...(event.nets[0] === undefined ? {} : { net: asNetId(event.nets[0]) }),
      ...(event.detail.length === 0 ? {} : { deviceState: event.detail }),
      diagnosticIds: why.diagnostics.map((diagnostic) => diagnostic.id),
    },
    why,
  }
}

function valueText(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return value.toPrecision(6)
}

function changed(from: number | undefined, to: number | undefined): boolean {
  if (from === undefined || to === undefined) return false
  const scale = Math.max(1, Math.abs(from), Math.abs(to))
  return Math.abs(to - from) > scale * 1e-9
}

function diagnosticForAnomaly(anomaly: Anomaly): CausalDiagnostic {
  const severity =
    anomaly.kind === 'unsettled'
      ? 'error'
      : anomaly.kind === 'power-up-dependent' || anomaly.kind === 'slow-cycle'
        ? 'warning'
        : 'info'
  return { code: anomaly.kind, severity, detail: anomaly.detail }
}

function traceSource(
  block: BlockData,
  signal: string | undefined,
  source: TraceSource,
): { nets: string[]; sources: CausalSource[] } {
  const sourceBlock: CausalSource = {
    id: source.id,
    label: source.label || block.name,
    definition: 'block',
  }
  if (signal === undefined) return { nets: [], sources: [sourceBlock] }

  const signalPorts = block.ports.filter((port) => {
    const ids = [port.id, port.name].filter((value): value is string => value !== undefined)
    return ids.some((id) => id === signal || id.replace(/\[\d+\]$/, '') === signal)
  })
  const aliases = new Map(
    blockPortAliases([
      {
        id: source.id,
        position: { x: 0, y: 0 },
        data: { definition: 'block', block },
      },
    ]).map((alias) => [alias.outer, alias.inner]),
  )
  const terminals = signalPorts
    .map((port) => aliases.get(`${source.id}/${port.id}`))
    .filter((terminal): terminal is string => terminal !== undefined)
  if (terminals.length > 0) sourceBlock.terminals = terminals
  const nets =
    signalPorts.length > 0
      ? signalPorts.map((port) => `${source.id}/${port.id}`)
      : [`${source.id}/${signal}`]
  return { nets, sources: [sourceBlock] }
}

function eventOrder(a: CausalReplayEventDraft, b: CausalReplayEventDraft): number {
  const aPosition = a.cycle ?? a.frameIndex ?? Number.POSITIVE_INFINITY
  const bPosition = b.cycle ?? b.frameIndex ?? Number.POSITIVE_INFINITY
  if (aPosition !== bPosition) return aPosition - bPosition
  if (a.kind === b.kind) return a.id.localeCompare(b.id)
  return a.kind === 'diagnostic' ? 1 : -1
}

export function buildTraceCausalReplay(
  result: TraceResult,
  block: BlockData,
  source: TraceSource = { id: 'block', label: block.name },
): CausalReplay {
  const events: CausalReplayEventDraft[] = []
  const handledAnomalies = new Set<Anomaly>()
  const transitionCycles = new Set<number>()

  for (let index = 1; index < result.cycles.length; index++) {
    const previous = result.cycles[index - 1]
    const current = result.cycles[index]
    if (!previous || !current) continue
    for (const signal of result.outputs) {
      const from = previous.values.get(signal.name)
      const to = current.values.get(signal.name)
      if (!changed(from, to) || from === undefined || to === undefined) continue
      const mapping = traceSource(block, signal.name, source)
      const diagnostics = result.anomalies
        .filter(
          (anomaly) =>
            anomaly.cycle === current.cycle &&
            (anomaly.signal === undefined || anomaly.signal === signal.name),
        )
        .map((anomaly) => {
          handledAnomalies.add(anomaly)
          return diagnosticForAnomaly(anomaly)
        })
      transitionCycles.add(current.cycle)
      events.push({
        id: `digital-transition-${current.cycle}-${signal.name}`,
        domain: 'digital',
        kind: 'transition',
        cycle: current.cycle,
        signal: signal.name,
        nets: mapping.nets,
        from,
        to,
        registersChanged: current.registersChanged,
        sources: mapping.sources,
        diagnostics,
        detail: `"${signal.name}" changed ${valueText(from)} → ${valueText(to)}`,
      })
    }
    if (current.registersChanged > 0 && !transitionCycles.has(current.cycle)) {
      events.push({
        id: `digital-registers-${current.cycle}`,
        domain: 'digital',
        kind: 'diagnostic',
        cycle: current.cycle,
        nets: [],
        registersChanged: current.registersChanged,
        sources: [{ id: source.id, label: source.label || block.name, definition: 'block' }],
        diagnostics: [
          {
            code: 'register-state-change',
            severity: 'info',
            detail: `cycle ${current.cycle} changed ${current.registersChanged} internal register${current.registersChanged === 1 ? '' : 's'} without an observed output transition`,
          },
        ],
        detail: `internal state changed on cycle ${current.cycle}`,
      })
    }
  }

  for (const anomaly of result.anomalies) {
    if (handledAnomalies.has(anomaly)) continue
    const mapping = traceSource(block, anomaly.signal, source)
    events.push({
      id: `digital-diagnostic-${anomaly.kind}-${anomaly.cycle}-${anomaly.signal ?? ''}`,
      domain: 'digital',
      kind: 'diagnostic',
      cycle: anomaly.cycle,
      ...(anomaly.signal !== undefined ? { signal: anomaly.signal } : {}),
      nets: mapping.nets,
      sources: mapping.sources,
      diagnostics: [diagnosticForAnomaly(anomaly)],
      detail: anomaly.detail,
    })
  }

  events.sort(eventOrder)
  return replayFromEvents(events)
}

function humanizeDefinition(definition: string): string {
  return definition.replace(/_/g, ' ')
}

function rootSourceId(instanceId: string): string {
  if (instanceId.startsWith('wire_')) return instanceId
  const dot = instanceId.indexOf('.')
  return dot > 0 ? instanceId.slice(0, dot) : instanceId
}

function addTerminal(
  sources: Map<string, CausalSource>,
  instance: ReplayInstance,
  labels: ReadonlyMap<string, string>,
  terminal: string,
): void {
  const id = rootSourceId(instance.id)
  const source = sources.get(id) ?? {
    id,
    label: labels.get(id) ?? labels.get(instance.id) ?? humanizeDefinition(instance.definition),
    definition: instance.definition,
    terminals: [],
  }
  if (!source.terminals?.includes(terminal))
    source.terminals = [...(source.terminals ?? []), terminal]
  sources.set(id, source)
}

function sourcesForNet(
  net: string,
  byNet: ReadonlyMap<string, ReadonlyMap<string, CausalSource>>,
): CausalSource[] {
  return [...(byNet.get(net)?.values() ?? [])].sort((a, b) => a.id.localeCompare(b.id))
}

export function buildTimelineCausalReplay(
  result: TransientResult | null,
  instances: readonly ReplayInstance[],
  labels: ReadonlyMap<string, string> = new Map(),
): CausalReplay {
  if (result === null) return emptyReplay()

  const events: CausalReplayEventDraft[] = []
  const instanceById = new Map(instances.map((instance) => [instance.id, instance]))
  const byNet = new Map<string, Map<string, CausalSource>>()
  for (const instance of instances) {
    if (instance.id.startsWith('wire_')) continue
    for (const connect of instance.connects ?? []) {
      const sourceMap = byNet.get(connect.net) ?? new Map<string, CausalSource>()
      addTerminal(sourceMap, instance, labels, `${instance.id}/${connect.terminal}`)
      byNet.set(connect.net, sourceMap)
    }
  }

  for (let index = 1; index < result.series.length; index++) {
    const previous = result.series[index - 1]
    const current = result.series[index]
    if (!previous || !current) continue
    const nets = new Set([...previous.nodes.keys(), ...current.nodes.keys()])
    for (const net of [...nets].sort()) {
      const from = previous.nodes.get(net)
      const to = current.nodes.get(net)
      if (!changed(from, to) || from === undefined || to === undefined) continue
      events.push({
        id: `timeline-net-${index}-${net}`,
        domain: 'timeline',
        kind: 'transition',
        frameIndex: index,
        time: current.time,
        nets: [net],
        from,
        to,
        sources: sourcesForNet(net, byNet),
        diagnostics: [],
        detail: `net "${net}" changed ${valueText(from)} V → ${valueText(to)} V`,
      })
    }

    const currentKeys = new Set([
      ...(previous.currents?.keys() ?? []),
      ...(current.currents?.keys() ?? []),
    ])
    for (const currentKey of [...currentKeys].sort()) {
      const from = previous.currents?.get(currentKey)
      const to = current.currents?.get(currentKey)
      if (!changed(from, to) || from === undefined || to === undefined) continue
      const slash = currentKey.indexOf('/')
      const instanceId = slash > 0 ? currentKey.slice(0, slash) : currentKey
      const instance = instanceById.get(instanceId)
      const sourceMap = new Map<string, CausalSource>()
      if (instance) {
        for (const connect of instance.connects ?? []) {
          addTerminal(sourceMap, instance, labels, `${instance.id}/${connect.terminal}`)
        }
      }
      events.push({
        id: `timeline-current-${index}-${currentKey}`,
        domain: 'timeline',
        kind: 'current-transition',
        frameIndex: index,
        time: current.time,
        currentKey,
        nets: instance?.connects?.map((connect) => connect.net) ?? [],
        from,
        to,
        sources: [...sourceMap.values()],
        diagnostics: [],
        detail: `current "${currentKey}" changed ${valueText(from)} A → ${valueText(to)} A`,
      })
    }
  }

  const firstFrame = result.series[0]
  const diagnosticLocation = firstFrame ? { frameIndex: 0, time: firstFrame.time } : {}
  if (result.status !== 'solved') {
    const severity = result.status === 'unsupported-element' ? 'warning' : 'error'
    const diagnostic: CausalDiagnostic = {
      code: `transient-${result.status}`,
      severity,
      detail: `transient run status: ${result.status}`,
    }
    events.push({
      id: `timeline-status-${result.status}`,
      domain: 'timeline',
      kind: 'diagnostic',
      ...diagnosticLocation,
      nets: [],
      sources: [],
      diagnostics: [diagnostic],
      detail: diagnostic.detail,
    })
  }
  result.warnings.forEach((warning, index) => {
    const diagnostic: CausalDiagnostic = {
      code: 'solver-warning',
      severity: 'warning',
      detail: warning,
    }
    events.push({
      id: `timeline-warning-${index}`,
      domain: 'timeline',
      kind: 'diagnostic',
      ...diagnosticLocation,
      nets: [],
      sources: [],
      diagnostics: [diagnostic],
      detail: warning,
    })
  })

  events.sort(eventOrder)
  return replayFromEvents(events)
}
