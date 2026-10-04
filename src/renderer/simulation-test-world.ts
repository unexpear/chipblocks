import type { Edge, Node } from '@xyflow/react'
import { worldWithCastLight } from '../light.ts'
import { blockConnectionProblems, blockSemanticProblems } from './block-semantics.ts'
import type { BlockData } from './blocks.ts'
import { serializeCircuit } from './circuit-file.ts'
import type { Point } from './net-edge.tsx'
import { attachInternalCircuits, canvasWorld } from './pipeline/canvas-world.ts'
import { lightCastInputs } from './pipeline/solve-canvas.ts'
import type { DeviceNodeData } from './symbols.tsx'
import { getUserPartsSnapshot, type UserPart } from './user-parts.ts'

export function simulationTestInputKey(
  nodes: Node[],
  edges: Edge[],
  routes?: Map<string, Point[]>,
  userParts: readonly UserPart[] = getUserPartsSnapshot(),
) {
  return JSON.stringify({
    circuit: serializeCircuit(
      nodes.map((node) => ({ ...node, data: node.data as DeviceNodeData })),
      edges,
      undefined,
      undefined,
      undefined,
      userParts,
    ),
    routes: routes ? [...routes] : null,
  })
}

export function simulationTestWorld(
  liveNodes: Node[],
  liveEdges: Edge[],
  liveRoutes?: Map<string, Point[]>,
) {
  const nodes = structuredClone(liveNodes)
  const edges = structuredClone(liveEdges)
  const routes = liveRoutes === undefined ? undefined : structuredClone(liveRoutes)
  const resolved = attachInternalCircuits(nodes)
  for (const node of resolved) {
    if (!node.data.block) continue
    const problems = blockSemanticProblems(node.data.block as BlockData, node.id)
    if (problems.length) throw new Error(problems.join(' '))
  }
  const connectionProblems = blockConnectionProblems(
    resolved.map((node) => ({ id: node.id, block: node.data.block as BlockData | undefined })),
    edges,
  )
  if (connectionProblems.length) throw new Error(connectionProblems.join(' '))
  const { world } = canvasWorld(nodes, edges, routes)
  const { sources, positions } = lightCastInputs(nodes)
  return worldWithCastLight(world, positions, sources)
}
