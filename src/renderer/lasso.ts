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

/**
 * Which nodes the lasso catches: center-in-polygon, in flow coordinates.
 * Sizes come from React Flow's measurements when present; the fallback is the
 * typical symbol footprint so an unmeasured node still has a sensible center.
 */
export function nodeIdsInLasso(
  nodes: {
    id: string
    position: { x: number; y: number }
    measured?: { width?: number; height?: number }
  }[],
  polygon: LassoPoint[],
  fallback: { width: number; height: number } = { width: 90, height: 40 },
): string[] {
  if (polygon.length < 3) return []
  return nodes
    .filter((n) =>
      pointInPolygon(
        {
          x: n.position.x + (n.measured?.width ?? fallback.width) / 2,
          y: n.position.y + (n.measured?.height ?? fallback.height) / 2,
        },
        polygon,
      ),
    )
    .map((n) => n.id)
}

/** The SVG path string for the overlay ("M x y L x y …", closed). */
export function lassoPathD(points: LassoPoint[]): string {
  if (points.length === 0) return ''
  const [first, ...rest] = points
  if (first === undefined) return ''
  const parts = [`M ${first.x} ${first.y}`, ...rest.map((p) => `L ${p.x} ${p.y}`)]
  return `${parts.join(' ')} Z`
}
