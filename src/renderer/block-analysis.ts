import type { Edge, Node } from '@xyflow/react'
import type { SolutionStatus } from '../dc-solver.ts'
import type { TimingPath } from '../static-timing.ts'
import { blockSemanticProblems } from './block-semantics.ts'
import { blockStructureError } from './block-validation.ts'
import type { BlockData } from './blocks.ts'
import type { Point } from './net-edge.tsx'
import { networkDeviceSummary } from './network-overview.ts'
import type { PartReading } from './part-readings.ts'
import { simulationTestInputKey } from './simulation-test-world.ts'
import { getUserPartsSnapshot, type UserPart } from './user-parts.ts'

export function blockAnalysisInputKey(
  nodes: Node[],
  edges: Edge[],
  ambientC: number,
  routes?: Map<string, Point[]>,
  userParts: readonly UserPart[] = getUserPartsSnapshot(),
): string | null {
  try {
    if (!Number.isFinite(ambientC)) return null
    return JSON.stringify([ambientC, simulationTestInputKey(nodes, edges, routes, userParts)])
  } catch {
    return null
  }
}

export type BlockAnalysisContext = {
  fresh: boolean
  status: SolutionStatus
  converged: boolean
  thermalConverged: boolean
  relaysSettled: boolean
  readings: ReadonlyMap<string, PartReading>
  paths: readonly TimingPath[]
}

export function summarizeBlockAnalysis(
  block: BlockData,
  instanceId: string,
  context: BlockAnalysisContext,
) {
  const problems = blockSemanticProblems(block, instanceId)
  const structuralError = blockStructureError(block, instanceId)
  const leaves: string[] = []
  const members = new Set<string>([instanceId])
  const visit = (current: BlockData, parent: string) => {
    for (const node of current.nodes) {
      const id = `${parent}.${node.id}`
      if (members.has(id)) problems.push(`Ambiguous flattened identifier: ${id}`)
      members.add(id)
      if (node.block) visit(node.block, id)
      else leaves.push(id)
    }
  }
  if (!structuralError) visit(block, instanceId)
  const reason = problems.length
    ? problems.join(' ')
    : !context.fresh
      ? 'Stale or missing solve. Solve the current circuit to update this report.'
      : context.status !== 'solved'
        ? `Electrical analysis unavailable: ${context.status}.`
        : !context.converged || !context.thermalConverged || !context.relaysSettled
          ? 'The electrical, thermal, or relay solution has not settled.'
          : null
  const power = networkDeviceSummary(leaves, reason ? new Map() : context.readings)
  const internalPaths = reason
    ? []
    : context.paths.filter((path) =>
        [path.from, ...path.gates, path.to].every((id) => members.has(id)),
      )
  const crossingPaths = reason
    ? []
    : context.paths.filter((path) => {
        const ids = [path.from, ...path.gates, path.to]
        return ids.some((id) => members.has(id)) && !ids.every((id) => members.has(id))
      })
  const validPaths = internalPaths.filter(
    (path) =>
      Number.isFinite(path.logicDelayMax) &&
      Number.isFinite(path.logicDelayMin) &&
      path.logicDelayMin >= 0 &&
      path.logicDelayMax >= path.logicDelayMin,
  )
  return {
    instanceId,
    reason,
    power,
    internalPathCount: internalPaths.length,
    validPathCount: validPaths.length,
    crossingPathCount: crossingPaths.length,
    delayMax:
      validPaths.length > 0 && validPaths.length === internalPaths.length
        ? validPaths.reduce((maximum, path) => Math.max(maximum, path.logicDelayMax), 0)
        : null,
  }
}
