import {
  type AnalysisState,
  asDiagnosticId,
  asEventId,
  type DiagnosticSeverity,
  type RepairHint,
  type RuntimeAnalysis,
  type RuntimeDiagnostic,
  type RuntimeObservation,
  type RuntimeTarget,
  type RuntimeWhy,
  type RuntimeWhyCause,
  type RuntimeWhyStep,
  type RuntimeWhySystem,
  runtimeAnalysisFor,
} from './runtime-contracts.ts'

export type RuntimeWhyNode = Omit<RuntimeWhyStep, 'state'> & { state?: AnalysisState }

export type RuntimeWhyInput = {
  id: string
  state: AnalysisState
  summary: string
  path: RuntimeWhyNode[]
  cause?: RuntimeWhyCause
  diagnostics?: readonly RuntimeDiagnostic[]
  transitions?: readonly RuntimeWhy['transitions'][number][]
  observations?: readonly RuntimeObservation[]
}

export type RuntimeWhyContext = {
  source?: RuntimeWhyNode
  terminal?: RuntimeWhyNode
  net?: RuntimeWhyNode
  deviceState?: RuntimeWhyNode
  output?: RuntimeWhyNode
  observations?: readonly RuntimeObservation[]
}

const stateRank: Record<AnalysisState, number> = {
  ready: 0,
  complete: 1,
  active: 2,
  waiting: 3,
  blocked: 4,
  failed: 5,
}

const mostSevereState = (states: readonly AnalysisState[]): AnalysisState => {
  let selected: AnalysisState = 'ready'
  for (const state of states) {
    if (stateRank[state] > stateRank[selected]) selected = state
  }
  return selected
}

const blockingStep = (path: readonly RuntimeWhyStep[]): RuntimeWhyStep | undefined =>
  path.find((step) => step.state === 'blocked' || step.state === 'failed')

export function whyExplanation(input: RuntimeWhyInput): RuntimeWhy {
  const path = input.path.map((step) => ({ ...step, state: step.state ?? input.state }))
  const firstBlockedHop = blockingStep(path)
  return {
    id: asEventId(input.id),
    state: input.state,
    summary: input.summary,
    path,
    ...(input.cause === undefined ? {} : { cause: input.cause }),
    diagnostics: [...(input.diagnostics ?? [])],
    transitions: [...(input.transitions ?? [])],
    observations: [...(input.observations ?? [])],
    ...(firstBlockedHop === undefined ? {} : { firstBlockedHop }),
  }
}

export function whySystemFor(
  explanations: readonly RuntimeWhy[],
  state?: AnalysisState,
): RuntimeWhySystem {
  const diagnostics = explanations.flatMap((explanation) => explanation.diagnostics)
  const observations = explanations.flatMap((explanation) => explanation.observations)
  const firstBlockedHop = explanations.find(
    (explanation) => explanation.firstBlockedHop,
  )?.firstBlockedHop
  return {
    state: state ?? mostSevereState(explanations.map((explanation) => explanation.state)),
    explanations: [...explanations],
    diagnostics,
    observations,
    ...(firstBlockedHop === undefined ? {} : { firstBlockedHop }),
  }
}

export function mergeWhySystems(
  systems: readonly (RuntimeWhySystem | undefined)[],
  state?: AnalysisState,
): RuntimeWhySystem | undefined {
  const present = systems.filter((system): system is RuntimeWhySystem => system !== undefined)
  if (present.length === 0) return undefined
  return whySystemFor(
    present.flatMap((system) => system.explanations),
    state ?? mostSevereState(present.map((system) => system.state)),
  )
}

export function causeKindForDiagnostic(code: string): RuntimeWhyCause['kind'] {
  if (code.includes('incompatible')) return 'incompatible-connection'
  if (code.includes('missing-driver')) return 'missing-driver'
  if (code.includes('missing-input') || code.includes('required-input')) return 'missing-input'
  if (code.includes('contention')) return 'contention'
  if (code.includes('unsupported')) return 'unsupported-device'
  if (code.includes('overload') || code.includes('overpower') || code.includes('overvoltage')) {
    return 'overload'
  }
  if (code.includes('thermal') || code.includes('temperature')) return 'thermal'
  if (code.includes('timing') || code.includes('setup') || code.includes('hold')) return 'timing'
  if (code.includes('meter') || code.includes('measurement')) return 'measurement'
  return 'solver'
}

export function whyForDiagnostic(
  diagnostic: RuntimeDiagnostic,
  context: RuntimeWhyContext = {},
): RuntimeWhy {
  const path = [
    context.source,
    context.terminal,
    context.net,
    context.deviceState,
    context.output,
  ].filter((step): step is RuntimeWhyNode => step !== undefined)
  path.push({
    kind: 'diagnostic',
    label: diagnostic.code,
    state: diagnostic.state,
    detail: diagnostic.message,
    ...(diagnostic.target === undefined ? {} : { target: diagnostic.target }),
  })
  const transitions = [
    {
      from: 'ready' as const,
      to: diagnostic.state,
      detail: diagnostic.message,
      diagnosticId: diagnostic.id,
    },
  ]
  const cause: RuntimeWhyCause = {
    kind: causeKindForDiagnostic(diagnostic.code),
    message: diagnostic.message,
    ...(diagnostic.target === undefined ? {} : { target: diagnostic.target }),
    ...(diagnostic.repair === undefined ? {} : { repair: diagnostic.repair }),
  }
  return whyExplanation({
    id: `${diagnostic.id}-why`,
    state: diagnostic.state,
    summary: diagnostic.message,
    path,
    cause,
    diagnostics: [diagnostic],
    transitions,
    ...(context.observations === undefined ? {} : { observations: context.observations }),
  })
}

export function whySystemForAnalysis(analysis: RuntimeAnalysis): RuntimeWhySystem {
  if (analysis.diagnostics.length > 0) {
    return whySystemFor(
      analysis.diagnostics.map((diagnostic) => whyForDiagnostic(diagnostic)),
      analysis.state,
    )
  }
  const explanation = whyExplanation({
    id: `analysis-${analysis.engine}-${analysis.status}`,
    state: analysis.state,
    summary: `${analysis.engine} analysis is ${analysis.status}`,
    path: [
      {
        kind: 'output',
        label: `${analysis.engine} result`,
        state: analysis.state,
        detail: analysis.status,
      },
    ],
    transitions: [
      {
        from: 'ready',
        to: analysis.state,
        detail: `${analysis.engine} analysis is ${analysis.status}`,
      },
    ],
  })
  return whySystemFor([explanation], analysis.state)
}

export function runtimeAnalysisWithWhy(
  engine: string,
  status: string,
  warnings: readonly string[] = [],
): RuntimeAnalysis {
  const analysis = runtimeAnalysisFor(engine, status, warnings)
  return { ...analysis, why: whySystemForAnalysis(analysis) }
}

export function measurementWhy(
  source: 'scope' | 'meter',
  id: string,
  status: string,
  summary: string,
  target?: RuntimeTarget,
  observations: readonly RuntimeObservation[] = [],
): RuntimeWhySystem {
  const complete = status === 'measured' || status === 'complete' || status === 'solved'
  const state: AnalysisState = complete
    ? 'complete'
    : status === 'failed' || status === 'blew'
      ? 'failed'
      : 'blocked'
  const severity: DiagnosticSeverity = state === 'failed' ? 'error' : 'warning'
  const diagnostic: RuntimeDiagnostic | undefined = complete
    ? undefined
    : {
        id: asDiagnosticId(`${id}-${status}`),
        code: `${source}-${status}`,
        severity,
        state,
        message: summary,
        ...(target === undefined ? {} : { target }),
        repair: {
          action: 'inspect',
          message: 'Inspect the probe locations and the affected circuit, then measure again.',
          ...(target === undefined ? {} : { target }),
        } satisfies RepairHint,
      }
  const explanation = whyExplanation({
    id: `${id}-why`,
    state,
    summary,
    path: [
      {
        kind: 'output',
        label: `${source} reading`,
        state,
        detail: summary,
        ...(target === undefined ? {} : { target }),
      },
      ...(diagnostic === undefined
        ? []
        : [
            {
              kind: 'diagnostic' as const,
              label: diagnostic.code,
              state,
              ...(target === undefined ? {} : { target }),
            },
          ]),
    ],
    ...(diagnostic === undefined
      ? {}
      : {
          cause: {
            kind: 'measurement' as const,
            message: diagnostic.message,
            ...(target === undefined ? {} : { target }),
            ...(diagnostic.repair === undefined ? {} : { repair: diagnostic.repair }),
          },
        }),
    ...(diagnostic === undefined ? {} : { diagnostics: [diagnostic] }),
    observations,
    transitions: [{ from: 'ready', to: state, detail: summary }],
  })
  return whySystemFor([explanation], state)
}
