export type StableIdKind =
  | 'block'
  | 'net'
  | 'terminal'
  | 'endpoint'
  | 'subgraph'
  | 'diagnostic'
  | 'event'

export type StableId<Kind extends StableIdKind> = string & { readonly __stableId: Kind }
export type BlockId = StableId<'block'>
export type NetId = StableId<'net'>
export type TerminalId = StableId<'terminal'>
export type EndpointId = StableId<'endpoint'>
export type SubgraphId = StableId<'subgraph'>
export type DiagnosticId = StableId<'diagnostic'>
export type EventId = StableId<'event'>

export function asStableId<Kind extends StableIdKind>(value: string, kind: Kind): StableId<Kind> {
  if (value.trim().length === 0) throw new Error(`${kind} id must not be empty`)
  return value as StableId<Kind>
}

export const asBlockId = (value: string): BlockId => asStableId(value, 'block')
export const asNetId = (value: string): NetId => asStableId(value, 'net')
export const asTerminalId = (value: string): TerminalId => asStableId(value, 'terminal')
export const asSubgraphId = (value: string): SubgraphId => asStableId(value, 'subgraph')
export const asDiagnosticId = (value: string): DiagnosticId => asStableId(value, 'diagnostic')
export const asEventId = (value: string): EventId => asStableId(value, 'event')

export function endpointId(blockId: BlockId, terminalId: TerminalId): EndpointId {
  return asStableId(`${blockId}/${terminalId}`, 'endpoint')
}

export type CircuitDomain =
  | 'electrical'
  | 'thermal'
  | 'magnetic'
  | 'mechanical'
  | 'control'
  | 'digital'
export type Unit =
  | 'unknown'
  | 'boolean'
  | 'dimensionless'
  | 'volt'
  | 'ampere'
  | 'ohm'
  | 'watt'
  | 'farad'
  | 'henry'
  | 'second'
  | 'hertz'
  | 'degree_celsius'
export type PortDirection = 'input' | 'output' | 'bidirectional' | 'unknown'
export type DriveKind = 'input' | 'push_pull' | 'open_collector' | 'tristate'
export type TerminalRole = 'source' | 'load' | 'passive' | 'unknown'
export type AnalysisState = 'ready' | 'active' | 'waiting' | 'blocked' | 'failed' | 'complete'
export type DiagnosticSeverity = 'info' | 'warning' | 'error'

export type RuntimePortLike = {
  id: string
  label?: string
  name?: string
  domain?: CircuitDomain
  role?: TerminalRole
  direction?: PortDirection
  unit?: Unit
  kind?: 'signal' | 'power_positive' | 'power_negative'
  drive?: DriveKind
}

export type RuntimePort = {
  id: TerminalId
  label: string
  name: string
  domain: CircuitDomain
  role: TerminalRole
  direction: PortDirection
  unit: Unit
  drive?: DriveKind
}

const roleForDrive = (drive: DriveKind | undefined): TerminalRole => {
  if (drive === undefined) return 'unknown'
  return drive === 'input' ? 'load' : 'source'
}

const directionForDrive = (drive: DriveKind | undefined): PortDirection => {
  if (drive === undefined) return 'unknown'
  return drive === 'input' ? 'input' : 'output'
}

export function runtimePortOf(port: RuntimePortLike): RuntimePort {
  const label = port.label ?? port.name ?? port.id
  return {
    id: asTerminalId(port.id),
    label,
    name: port.name ?? label,
    domain: port.domain ?? 'electrical',
    role: port.role ?? roleForDrive(port.drive),
    direction: port.direction ?? directionForDrive(port.drive),
    unit: port.unit ?? 'unknown',
    ...(port.drive === undefined ? {} : { drive: port.drive }),
  }
}

export type RuntimeTarget = {
  blockId?: BlockId
  terminalId?: TerminalId
  netId?: NetId
  subgraphId?: SubgraphId
}

export type RepairHint = {
  action: 'inspect' | 'select' | 'connect' | 'set_parameter' | 'rerun'
  message: string
  target?: RuntimeTarget
}

export type RuntimeDiagnostic = {
  id: DiagnosticId
  code: string
  severity: DiagnosticSeverity
  state: AnalysisState
  message: string
  target?: RuntimeTarget
  repair?: RepairHint
}

export type RuntimeWhyStepKind =
  | 'source'
  | 'terminal'
  | 'net'
  | 'device-state'
  | 'output'
  | 'diagnostic'

export type RuntimeWhyStep = {
  kind: RuntimeWhyStepKind
  label: string
  state: AnalysisState
  target?: RuntimeTarget
  detail?: string
  value?: RuntimeQuantity
}

export type RuntimeWhyCauseKind =
  | 'blocked-hop'
  | 'incompatible-connection'
  | 'missing-driver'
  | 'missing-input'
  | 'contention'
  | 'unsupported-device'
  | 'overload'
  | 'thermal'
  | 'timing'
  | 'solver'
  | 'measurement'

export type RuntimeWhyCause = {
  kind: RuntimeWhyCauseKind
  message: string
  target?: RuntimeTarget
  repair?: RepairHint
  sources?: RuntimeTarget[]
}

export type RuntimeStateTransition = {
  from: AnalysisState
  to: AnalysisState
  detail: string
  diagnosticId?: DiagnosticId
}

export type RuntimeObservationSource =
  | 'net-inspector'
  | 'causal-replay'
  | 'run-trace'
  | 'timeline'
  | 'scope'
  | 'meter'
  | 'timing'
  | 'solver'

export type RuntimeObservation = {
  source: RuntimeObservationSource
  label: string
  detail: string
  target?: RuntimeTarget
  quantity?: RuntimeQuantity
}

export type RuntimeWhy = {
  id: EventId
  state: AnalysisState
  summary: string
  path: RuntimeWhyStep[]
  cause?: RuntimeWhyCause
  diagnostics: RuntimeDiagnostic[]
  transitions: RuntimeStateTransition[]
  observations: RuntimeObservation[]
  firstBlockedHop?: RuntimeWhyStep
}

export type RuntimeWhySystem = {
  state: AnalysisState
  explanations: RuntimeWhy[]
  diagnostics: RuntimeDiagnostic[]
  observations: RuntimeObservation[]
  firstBlockedHop?: RuntimeWhyStep
}

export type RuntimeAnalysis = {
  engine: string
  status: string
  state: AnalysisState
  diagnostics: RuntimeDiagnostic[]
  why?: RuntimeWhySystem
}

export type RuntimeQuantity = {
  value: number | null
  unit: Unit
}

export type RuntimeEndpoint = {
  id: EndpointId
  blockId: BlockId
  terminalId: TerminalId
  netId: NetId
  label: string
  domain: CircuitDomain
  role: TerminalRole
  direction: PortDirection
  unit: Unit
  drive?: DriveKind
}

export type RuntimeNet = {
  id: NetId
  subgraphId: SubgraphId
  domain: CircuitDomain
  endpoints: RuntimeEndpoint[]
  driverCount: number
  loadCount: number
  passiveCount: number
  status: string
  state: AnalysisState
  nextStep: string
  readings: {
    current: RuntimeQuantity
    voltageDrop: RuntimeQuantity
    length: RuntimeQuantity
    resistance: RuntimeQuantity
  }
  diagnostics: RuntimeDiagnostic[]
  why?: RuntimeWhySystem
}

export type RuntimeCausalChain = {
  source?: RuntimeTarget
  terminal?: RuntimeTarget
  net?: NetId
  deviceState?: string
  diagnosticIds: DiagnosticId[]
}

export type RuntimeCausalEvent = {
  id: EventId
  domain: CircuitDomain
  state: AnalysisState
  chain: RuntimeCausalChain
  why?: RuntimeWhy
}

export function analysisStateForStatus(status: string): AnalysisState {
  if (status === 'solved' || status === 'unsupported-element') return 'complete'
  if (status === 'too-large' || status === 'over-budget') return 'blocked'
  if (
    status === 'bad-options' ||
    status === 'did-not-converge' ||
    status === 'numerical-error' ||
    status === 'singular-matrix'
  ) {
    return 'failed'
  }
  if (status === 'no-ground') return 'blocked'
  return 'waiting'
}

export function solverWarningDiagnostic(
  engine: string,
  warning: string,
  index: number,
): RuntimeDiagnostic {
  const quotedId = warning.match(/(?:instance|element|part|device)\s+['"]([^'"]+)['"]/i)?.[1]
  const skippedId = warning.match(/^Skipped [^'"]*['"]([^'"]+)['"]/i)?.[1]
  const target = quotedId ?? skippedId
  const unsupported = /unsupported|skipped/i.test(warning)
  const runtimeTarget = target === undefined ? undefined : { blockId: asBlockId(target) }
  return {
    id: asDiagnosticId(`${engine}-warning-${index + 1}`),
    code: unsupported ? `${engine}-unsupported-device` : `${engine}-warning`,
    severity: 'warning',
    state: 'waiting',
    message: warning,
    ...(runtimeTarget === undefined ? {} : { target: runtimeTarget }),
    repair: {
      action: runtimeTarget === undefined ? 'inspect' : 'select',
      message: 'Inspect the affected part or net, then rerun the analysis.',
      ...(runtimeTarget === undefined ? {} : { target: runtimeTarget }),
    },
  }
}

export function runtimeAnalysisFor(
  engine: string,
  status: string,
  warnings: readonly string[] = [],
): RuntimeAnalysis {
  const state = analysisStateForStatus(status)
  const diagnostics = warnings.map((warning, index) =>
    solverWarningDiagnostic(engine, warning, index),
  )
  if (state === 'failed' || state === 'blocked') {
    diagnostics.unshift({
      id: asDiagnosticId(`${engine}-${status}`),
      code: `${engine}-${status}`,
      severity: state === 'failed' ? 'error' : 'warning',
      state,
      message: `${engine} analysis status: ${status}`,
      repair: {
        action: 'inspect',
        message: 'Inspect the analysis inputs and rerun after correcting the reported issue.',
      },
    })
  }
  return {
    engine,
    status,
    state,
    diagnostics,
  }
}
