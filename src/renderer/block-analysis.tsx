import type { Edge, Node } from '@xyflow/react'
import { useMemo, useSyncExternalStore } from 'react'
import {
  type BlockAnalysisContext,
  blockAnalysisInputKey,
  summarizeBlockAnalysis,
} from './block-analysis.ts'
import { BlockTiming } from './block-timing.tsx'
import type { BlockData } from './blocks.ts'
import type { Point } from './net-edge.tsx'
import { attachInternalCircuits } from './pipeline/canvas-world.ts'
import { getUserPartsSnapshot, subscribeUserParts } from './user-parts.ts'

export function BlockAnalysis({
  nodes,
  edges,
  instanceId,
  ambientC,
  routes,
  solvedInputKey,
  context,
}: {
  nodes: Node[]
  edges: Edge[]
  instanceId: string
  ambientC: number
  routes?: Map<string, Point[]> | undefined
  solvedInputKey: string | null
  context: Omit<BlockAnalysisContext, 'fresh'>
}) {
  const userParts = useSyncExternalStore(
    subscribeUserParts,
    getUserPartsSnapshot,
    getUserPartsSnapshot,
  )
  const inputKey = useMemo(
    () => blockAnalysisInputKey(nodes, edges, ambientC, routes, userParts),
    [nodes, edges, ambientC, routes, userParts],
  )
  const block = attachInternalCircuits(nodes.filter((node) => node.id === instanceId))[0]?.data
    .block as BlockData | undefined
  if (!block) return null
  const report = summarizeBlockAnalysis(block, instanceId, {
    ...context,
    fresh: inputKey !== null && inputKey === solvedInputKey,
  })
  return (
    <section aria-label="Block analysis">
      <h3>Block analysis</h3>
      <div>
        Instance: {instanceId} · {block.name}
      </div>
      {report.reason ? <p role="status">{report.reason}</p> : null}
      <p>
        Power reading coverage: {report.power.powerCount}/{report.power.deviceCount} internal parts.{' '}
        Magnitude sum:{' '}
        {report.power.powerMagnitude === null
          ? 'unavailable'
          : `${report.power.powerMagnitude.toPrecision(5)} W`}
        .
      </p>
      <p>
        Sum of available part power magnitudes, not net consumption or an energy balance. Missing
        readings are not zero. Fast logic does not measure transistor power.
      </p>
      <p>
        Contained timing paths: {report.validPathCount}/{report.internalPathCount} with finite
        delays. Longest logic-delay estimate:{' '}
        {report.delayMax === null ? 'unavailable' : `${report.delayMax.toPrecision(5)} s`}. Paths
        crossing this block boundary: {report.crossingPathCount} (not included).
      </p>
      <p>
        Existing static-timing model only; no complete internal timing coverage or maximum
        clock-rate certification. AC and transient support are not evaluated here; use Tests.
      </p>
      <BlockTiming key={instanceId} instanceId={instanceId} block={block} />
    </section>
  )
}
