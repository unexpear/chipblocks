/**
 * Freeform (lasso) selection (S19-v3-69) — draw any shape around parts to
 * select them, the companion to the rectangular box-select. Pure geometry,
 * unit-tested; the App owns the pointer events and the overlay drawing.
 *
 * A part is selected when its CENTER falls inside the drawn polygon — the
 * same rule graphics editors use for lasso tools (an edge-clipped part whose
 * middle is outside was probably not meant).
 */

export type LassoPoint = { x: number; y: number }

/** Skip points closer than this to the previous one — keeps paths light. */
export const MIN_POINT_SPACING_PX = 4

/**
 * Ray-casting point-in-polygon: cast a ray to the right and count crossings —
 * odd = inside. The classic even-odd rule; handles concave shapes (the whole
 * point of a lasso) and self-touching paths the way every editor does.
 */
export function pointInPolygon(point: LassoPoint, polygon: LassoPoint[]): boolean {
  if (polygon.length < 3) return false
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i++) {
    const a = polygon[i]
    const b = polygon[j]
    if (a === undefined || b === undefined) continue
    const crosses = a.y > point.y !== b.y > point.y
    if (!crosses) continue
    const xAtY = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    if (point.x < xAtY) inside = !inside
  }
  return inside
}

type NodeLike = {
  id: string
  position: { x: number; y: number }
  measured?: { width?: number; height?: number }
}

/** Typical symbol footprint for nodes React Flow has not measured yet. */
const FALLBACK_SIZE = { width: 90, height: 40 }

/** A node's center in flow coordinates (measured size, or the fallback). */
export function nodeCenter(
  node: NodeLike,
  fallback: { width: number; height: number } = FALLBACK_SIZE,
): LassoPoint {
  return {
    x: node.position.x + (node.measured?.width ?? fallback.width) / 2,
    y: node.position.y + (node.measured?.height ?? fallback.height) / 2,
  }
}

/**
 * Which nodes the lasso catches: center-in-polygon, in flow coordinates.
 * Sizes come from React Flow's measurements when present; the fallback is the
 * typical symbol footprint so an unmeasured node still has a sensible center.
 */
export function nodeIdsInLasso(
  nodes: NodeLike[],
  polygon: LassoPoint[],
  fallback: { width: number; height: number } = FALLBACK_SIZE,
): string[] {
  if (polygon.length < 3) return []
  return nodes.filter((n) => pointInPolygon(nodeCenter(n, fallback), polygon)).map((n) => n.id)
}

/**
 * Which wires the selection TOUCHES (S19-v3-70): a wire is selected when any
 * portion of its drawn path falls inside the region — its end parts do NOT
 * have to be selected, so you can grab a wire without its components. The
 * caller supplies the region test (lasso polygon or box rectangle) and the
 * path sampler (wire-path.ts walks the true route, fillets included).
 */
export function edgeIdsTouchingRegion(
  edges: {
    id: string
    source: string
    target: string
    data?: { waypoints?: unknown; curved?: unknown; curveRadius?: unknown }
  }[],
  centerOf: (nodeId: string) => LassoPoint | undefined,
  isInside: (point: LassoPoint) => boolean,
  samplePath: (
    points: LassoPoint[],
    options: { curved?: boolean; radius?: number },
  ) => LassoPoint[],
): string[] {
  const touched: string[] = []
  for (const edge of edges) {
    const from = centerOf(edge.source)
    const to = centerOf(edge.target)
    if (from === undefined || to === undefined) continue
    const waypoints = Array.isArray(edge.data?.waypoints)
      ? (edge.data.waypoints as LassoPoint[])
      : []
    const samples = samplePath([from, ...waypoints, to], {
      ...(edge.data?.curved === true ? { curved: true } : {}),
      ...(typeof edge.data?.curveRadius === 'number' ? { radius: edge.data.curveRadius } : {}),
    })
    if (samples.some(isInside)) touched.push(edge.id)
  }
  return touched
}

/** The SVG path string for the overlay ("M x y L x y …", closed). */
export function lassoPathD(points: LassoPoint[]): string {
  if (points.length === 0) return ''
  const [first, ...rest] = points
  if (first === undefined) return ''
  const parts = [`M ${first.x} ${first.y}`, ...rest.map((p) => `L ${p.x} ${p.y}`)]
  return `${parts.join(' ')} Z`
}
