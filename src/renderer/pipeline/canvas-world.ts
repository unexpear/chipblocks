/**
 * The canvas → World lowering pass. Turns the drawn React Flow nodes + edges into the plain `World` the
 * solvers consume, running the pipeline that used to be implicit inside App.tsx, in order:
 *
 *   FLATTEN  — every circuit block expands back into its REAL parts (the solver never sees a block)
 *   EXPAND   — a multi-lead source becomes its real two-lead sections
 *   LOWER    — the flat nodes/edges become a `World`, each wire measured along its ACTUAL drawn path so
 *              its real length → resistance drops real voltage (a longer route is more ohms, more heat)
 *
 * One source of truth for "what circuit is on the canvas", shared by the DC re-solve, the scope's
 * transient run, and the mixed-signal co-sim. Lifted verbatim out of App.tsx; UI-free (no React state).
 */

import type { Edge, Node } from '@xyflow/react'
import type { World } from '../../cross-fk-validator.ts'
import {
  type CanvasEdgeLike as BlockEdgeLike,
  type CanvasNodeLike as BlockNodeLike,
  flattenBlocks,
} from '../blocks.ts'
import { type CanvasEdge, type CanvasNode, canvasToWorld } from '../canvas-to-world.ts'
import { expandMultiLeadSources } from '../multi-tap-source.ts'
import type { Point } from '../net-edge.tsx'
import type { DeviceNodeData } from '../symbols.tsx'
import { getUserPart } from '../user-parts.ts'
import {
  gaugeAreaM2,
  lengthFromDrawn,
  materialResistivity,
  wireResistance,
} from '../wire-length.ts'
import { type PathPoint, polylineLength, roundedPathLength } from '../wire-path.ts'

type NodePosition = { x: number; y: number }

/** A React Flow node → the canvas node the World builder reads (id + part + values). */
function toCanvasNode(node: Node): CanvasNode {
  const data = node.data as DeviceNodeData
  return {
    id: node.id,
    definition: data.definition,
    ...(data.parameters ? { parameters: data.parameters } : {}),
  }
}

/**
 * A wire's real length + resistance from how it is drawn (pixels → metres →
 * R = ρL/A). A hand-routed wire is measured along its ACTUAL path — straight
 * segments through the corners, or the rounded route when drawn with the curve
 * subtool (same geometry the renderer draws, from wire-path.ts) — so routing
 * is physically real: a longer route is more ohms, more drop, more heat. An
 * un-routed wire keeps the straight-line seed it always had.
 */
function drawnWire(
  edge: {
    source: string
    target: string
    data?: {
      waypoints?: unknown
      curved?: unknown
      curveRadius?: unknown
      gaugeAwg?: unknown
      material?: unknown
    }
  },
  positions: Map<string, NodePosition>,
  routedPath?: Point[],
): { lengthM: number; ohms: number } {
  const from = positions.get(edge.source)
  const to = positions.get(edge.target)
  const waypoints = Array.isArray(edge.data?.waypoints) ? (edge.data.waypoints as PathPoint[]) : []
  let drawnPixels = 0
  if (waypoints.length === 0 && routedPath && routedPath.length >= 2) {
    // An auto-routed wire: measure the ACTUAL routed path it draws around the parts, so a wire that
    // bends the long way is a genuinely longer wire — the picture and the resistance agree.
    drawnPixels = polylineLength(routedPath)
  } else if (from && to) {
    if (waypoints.length > 0) {
      const points = [from, ...waypoints, to]
      const sweep = typeof edge.data?.curveRadius === 'number' ? edge.data.curveRadius : undefined
      drawnPixels =
        edge.data?.curved === true ? roundedPathLength(points, sweep) : polylineLength(points)
    } else {
      drawnPixels = Math.hypot(to.x - from.x, to.y - from.y)
    }
  }
  const lengthM = lengthFromDrawn(drawnPixels)
  return {
    lengthM,
    ohms: wireResistance(
      lengthM,
      materialResistivity(edge.data?.material),
      gaugeAreaM2(edge.data?.gaugeAwg),
    ),
  }
}

/**
 * Give any user part that declares a real behaviour (behavesAs) its device physics BEFORE lowering
 * (user-made parts, slice 4b): rewrite the node's definition to the built-in device, and remap each of
 * its wired pins to the device's matching terminal, so the solver stamps + solves the real device. A
 * part with no behaviour is untouched (stays a black box). Runs after flatten/expand, so a behaviour
 * part grouped inside a block is handled too (its definition survives flattening). Keeps
 * canvasToWorld pure — the registry is consulted only here.
 */
function applyUserPartBehaviours(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const behaviours = new Map<string, { definition: string; pinToTerminal: Map<string, string> }>()
  for (const node of nodes) {
    const behaviour = getUserPart(node.definition)?.behavesAs
    if (behaviour === undefined) continue
    const pinToTerminal = new Map<string, string>()
    for (const [terminal, pinId] of Object.entries(behaviour.terminals)) {
      pinToTerminal.set(pinId, terminal)
    }
    behaviours.set(node.id, { definition: behaviour.definition, pinToTerminal })
  }
  if (behaviours.size === 0) return { nodes, edges }

  const loweredNodes = nodes.map((node) => {
    const behaviour = behaviours.get(node.id)
    // Keep the node's parameters (they hold the device's values) — only the definition changes.
    return behaviour === undefined ? node : { ...node, definition: behaviour.definition }
  })
  const remap = (nodeId: string, handle: string | null | undefined): string | null => {
    const behaviour = behaviours.get(nodeId)
    if (behaviour === undefined || handle == null) return handle ?? null
    return behaviour.pinToTerminal.get(handle) ?? handle
  }
  // A wire that lands on an UNMAPPED pin of a behaviour part is dropped: that pin has no device terminal,
  // so its wire must NOT reach the real device — otherwise it would (a) add a phantom third connection
  // that makes a 2-terminal device (resistor/cap/inductor) fail its exact-2-connects stamp and silently
  // stop conducting, and (b) risk merging nets if the pin id happened to equal a device terminal name.
  const onUnmappedPin = (nodeId: string, handle: string | null | undefined): boolean => {
    const behaviour = behaviours.get(nodeId)
    return behaviour !== undefined && handle != null && !behaviour.pinToTerminal.has(handle)
  }
  const loweredEdges = edges
    .filter(
      (edge) =>
        !onUnmappedPin(edge.source, edge.sourceHandle) &&
        !onUnmappedPin(edge.target, edge.targetHandle),
    )
    .map((edge) => ({
      ...edge,
      sourceHandle: remap(edge.source, edge.sourceHandle),
      targetHandle: remap(edge.target, edge.targetHandle),
    }))
  return { nodes: loweredNodes, edges: loweredEdges }
}

/**
 * The World for the current canvas (nodes + drawn wires carrying their real
 * resistance), plus each wire's drawn length/resistance for the readouts. Shared
 * by the DC re-solve (solveCanvas) and the Scope's transient run — one source of
 * truth for "what circuit is on the canvas."
 */
export function canvasWorld(
  nodeList: Node[],
  edgeList: Edge[],
  routedGeoms?: Map<string, Point[]>,
): {
  world: World
  drawn: Map<string, { lengthM: number; ohms: number }>
  leadAliases: { outer: string; inner: string }[]
} {
  // Blocks are pure structure: expand every block back into its REAL parts
  // (namespaced ids, ports routed to the real internal terminals) before
  // anything physical is computed. The solver never sees a block. The same
  // rule expands a multi-lead source into its real two-lead sections.
  const flat = flattenBlocks(
    nodeList as unknown as BlockNodeLike[],
    edgeList as unknown as BlockEdgeLike[],
  )
  const expanded = expandMultiLeadSources(flat.nodes, flat.edges)
  const flatNodes = expanded.nodes as unknown as Node[]
  const flatEdges = expanded.edges as unknown as Edge[]
  const positions = new Map<string, NodePosition>(flatNodes.map((n) => [n.id, n.position]))
  // Each wire's real resistance feeds BOTH the solve (so it drops real voltage)
  // and the on-wire readout — computed once here from how the wire is drawn.
  // A multi-lead source's internal seams are INSIDE the pack: zero length,
  // zero resistance — they are not drawn wires.
  const drawn = new Map<string, { lengthM: number; ohms: number }>(
    flatEdges.map((e) => [
      e.id,
      e.data?.internalBond === true
        ? { lengthM: 0, ohms: 0 }
        : drawnWire(e, positions, routedGeoms?.get(e.id)),
    ]),
  )
  const canvasEdges: CanvasEdge[] = flatEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: e.targetHandle ?? null,
    resistanceOhms: drawn.get(e.id)?.ohms ?? 0,
  }))
  // Give behaviour-carrying user parts their real device physics before lowering.
  const lowered = applyUserPartBehaviours(flatNodes.map(toCanvasNode), canvasEdges)
  return {
    world: canvasToWorld(lowered.nodes, lowered.edges),
    drawn,
    leadAliases: expanded.aliases,
  }
}
