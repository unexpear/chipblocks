/**
 * The stress-bench engine — ramp one knob (ambient temperature, supply voltage, or a component's value)
 * across a range, re-solve the whole circuit at each point, and report where each part is safe and where it
 * fails. The physics is the app's real electro-thermal solver + failure checks; the bench just sweeps and
 * collects. It answers "how hot / how high a supply can this take, and which part gives out first?".
 *
 * Pure (no React, no global state): each sweep point derives a throwaway copy of the nodes and calls the
 * same solveCanvasDispatch the live canvas uses, so the sweep is deterministic and side-effect-free.
 */

import type { Edge, Node } from '@xyflow/react'
import { detectFailures } from '../failure-detector.ts'
import { solveCanvasDispatch } from './pipeline/solve-canvas.ts'

/** What to ramp. 'ambient' sweeps the board temperature; 'param' sets a scalar parameter on one or more
 *  nodes to the swept value (supply voltage = the power sources' nominal_voltage; a load = a resistor's
 *  resistance; any scalar param works the same way). */
export type StressAxis =
  | { kind: 'ambient' }
  | { kind: 'param'; targets: { nodeId: string; param: string }[] }

export type PartFailure = { partId: string; code: string; note: string; ratio: number }

export type SweepPoint = {
  value: number
  /** Did the electro-thermal loop reach a steady state at this point? (false = thermal runaway.) */
  converged: boolean
  failures: PartFailure[]
}

export type PartOutcome = {
  partId: string
  label: string
  /** The widest contiguous stretch of the swept axis where this part did NOT fail. */
  safeFrom: number | null
  safeTo: number | null
  /** The first swept value at which it failed, and the worst (highest-over-limit) failure seen. */
  firstFailValue: number
  worstCode: string
  worstNote: string
  worstRatio: number
}

export type StressResult = {
  axisLabel: string
  unit: string
  values: number[]
  points: SweepPoint[]
  /** Parts that failed somewhere in the range, with their safe window + first-failure boundary. */
  failingParts: PartOutcome[]
  /** How many distinct parts were solved. */
  totalParts: number
  /** How many parts flagged NO failure across the range. Note: a part with no relevant rating is never
   *  checked (detectFailures skips it), so this counts "no rated limit exceeded", not "proven safe". */
  noFailure: number
  /** The contiguous stretch of the axis where every point converged and NO part failed (the safe window). */
  safeWindow: { from: number; to: number } | null
  /** Set when the sweep couldn't actually vary anything (a param axis targeting a missing parameter). */
  warning?: string
}

export const MAX_STRESS_STEPS = 80

const partLabelOf = (node: Node | undefined): string => {
  const data = node?.data as { label?: string; definition?: string } | undefined
  return data?.label ?? data?.definition ?? node?.id ?? '?'
}

/** Return a node array with `param`'s scalar amount set to `value` on each target (throwaway copy). */
function withParam(
  nodes: Node[],
  targets: { nodeId: string; param: string }[],
  value: number,
): Node[] {
  const byId = new Map(targets.map((t) => [t.nodeId, t.param]))
  return nodes.map((n) => {
    const param = byId.get(n.id)
    if (param === undefined) return n
    const params = (n.data as { parameters?: Record<string, unknown> }).parameters
    const existing = params?.[param] as { value?: { amount?: number } } | undefined
    if (!existing?.value || typeof existing.value.amount !== 'number') return n
    return {
      ...n,
      data: {
        ...n.data,
        parameters: {
          ...params,
          [param]: { ...existing, value: { ...existing.value, amount: value } },
        },
      },
    }
  })
}

/** Evenly spaced sweep values from `from` to `to` (inclusive), `steps` of them (min 2). */
function linspace(from: number, to: number, steps: number): number[] {
  const n = Math.max(2, Math.min(steps, MAX_STRESS_STEPS))
  return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1))
}

/** The longest contiguous run of indices where safeAt(i) holds, as the [firstValue, lastValue] window. */
function longestSafeWindow(
  values: number[],
  safeAt: (i: number) => boolean,
): { from: number; to: number } | null {
  let best: { from: number; to: number } | null = null
  let bestLen = 0
  let start = -1
  for (let i = 0; i <= values.length; i++) {
    const ok = i < values.length && safeAt(i)
    if (ok && start < 0) start = i
    if (!ok && start >= 0) {
      const len = i - start
      if (len > bestLen) {
        bestLen = len
        best = { from: values[start] as number, to: values[i - 1] as number }
      }
      start = -1
    }
  }
  return best
}

/**
 * Sweep `axis` from `from` to `to` in `steps` points, re-solving the circuit at each and collecting per-part
 * failures. `baseAmbientC` is the board ambient used for non-ambient sweeps (so a supply/load sweep still
 * solves at the room the circuit sits in).
 */
export function runStressSweep(
  nodes: Node[],
  edges: Edge[],
  axis: StressAxis,
  from: number,
  to: number,
  steps: number,
  baseAmbientC: number,
): StressResult {
  const values = linspace(from, to, steps)
  const points: SweepPoint[] = []
  const allParts = new Set<string>()
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const amountAt = (nodeId: string, param: string): number | undefined =>
    (
      nodeById.get(nodeId)?.data as
        | { parameters?: Record<string, { value?: { amount?: number } }> }
        | undefined
    )?.parameters?.[param]?.value?.amount

  // A param sweep that lands on no real parameter would solve the identical circuit at every point and
  // wrongly look safe across the whole range — detect that so we can say so instead of reporting a false pass.
  const paramApplies =
    axis.kind !== 'param' ||
    axis.targets.some((t) => typeof amountAt(t.nodeId, t.param) === 'number')

  for (const value of values) {
    const sweptNodes = axis.kind === 'param' ? withParam(nodes, axis.targets, value) : nodes
    const ambient = axis.kind === 'ambient' ? value : baseAmbientC
    const solved = solveCanvasDispatch(sweptNodes, edges, ambient)
    for (const id of solved.readings.keys()) allParts.add(id)
    const failures = detectFailures(
      solved.world,
      solved.solution,
      ambient,
      solved.temperaturesC,
    ).map((f) => ({
      partId: f.source,
      code: f.code,
      note: `${f.ratio.toFixed(2)}× over ${f.kind.replace(/_/g, ' ')}`,
      ratio: f.ratio,
    }))
    points.push({ value, converged: solved.thermalConverged, failures })
  }

  // A point is safe only if it CONVERGED and tripped no rating — a thermal-runaway point is never "safe",
  // even if the unreliable snapshot happened to violate no rating.
  const pointSafe = (i: number): boolean =>
    points[i]?.converged === true && (points[i]?.failures.length ?? 0) === 0
  const partSafeAt = (i: number, partId: string): boolean =>
    points[i]?.converged === true && !points[i]?.failures.some((f) => f.partId === partId)

  const failingIds = new Set<string>()
  for (const p of points) for (const f of p.failures) failingIds.add(f.partId)

  const failingParts: PartOutcome[] = [...failingIds].map((partId) => {
    let firstFailIndex = -1
    let worst: PartFailure | null = null
    points.forEach((p, i) => {
      let failsHere = false
      // Scan ALL of this part's failures at this point — a part can trip two limits at once (e.g. overpower
      // AND over-temperature); report the worst (highest-over-limit), not whichever detectFailures listed first.
      for (const f of p.failures) {
        if (f.partId !== partId) continue
        failsHere = true
        if (!worst || f.ratio > worst.ratio) worst = f
      }
      if (failsHere && firstFailIndex < 0) firstFailIndex = i // first in SWEEP ORDER (handles from > to)
    })
    const safe = longestSafeWindow(values, (i) => partSafeAt(i, partId))
    return {
      partId,
      label: partLabelOf(nodeById.get(partId)),
      safeFrom: safe?.from ?? null,
      safeTo: safe?.to ?? null,
      firstFailValue:
        firstFailIndex >= 0 ? (values[firstFailIndex] as number) : (values[0] as number),
      worstCode: worst ? (worst as PartFailure).code : 'unknown',
      worstNote: worst ? (worst as PartFailure).note : '',
      worstRatio: worst ? (worst as PartFailure).ratio : 0,
    }
  })
  failingParts.sort((a, b) => values.indexOf(a.firstFailValue) - values.indexOf(b.firstFailValue))

  const safeWindow = longestSafeWindow(values, pointSafe)

  return {
    axisLabel: axis.kind === 'ambient' ? 'Ambient temperature' : 'Value',
    unit: axis.kind === 'ambient' ? '°C' : '',
    values,
    points,
    failingParts,
    totalParts: allParts.size,
    noFailure: allParts.size - failingIds.size,
    safeWindow,
    ...(paramApplies
      ? {}
      : {
          warning:
            'The swept value isn’t a parameter on the target part, so the circuit didn’t change across the sweep — this result is not meaningful.',
        }),
  }
}
