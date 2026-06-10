/**
 * Wire path geometry (S19-v3-61) — ONE module computes both the drawn shape
 * and its physical length, so the picture and the physics can never disagree.
 *
 * Two routing styles:
 *  - line: straight segments through the routed points (sharp corners);
 *  - curve: the same route with each corner rounded into a quadratic Bézier
 *    (the fillet a CAD line tool draws).
 *
 * The length feeds R = ρ·L/A, so routing is REAL: a longer route means more
 * resistance, more drop, more heat. Honest physics note: at DC and low
 * frequency a sharp corner itself does not measurably change a round wire's
 * resistance — length is the first-order truth, and that is exactly what this
 * module computes. The real corner effects live elsewhere: reflections on
 * high-frequency lines (the simulation arc's future EM stage), field
 * concentration at sharp points under high voltage, and current crowding in
 * thin-film conductors. None of those are faked here.
 */

export type PathPoint = { x: number; y: number }

/** Corner fillet radius for curve-style wires, in canvas px (1 px = 1 mm). */
export const CURVE_RADIUS_PX = 14

const distance = (a: PathPoint, b: PathPoint) => Math.hypot(b.x - a.x, b.y - a.y)

/** Straight-segment length of the routed polyline. */
export function polylineLength(points: PathPoint[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (a && b) total += distance(a, b)
  }
  return total
}

/**
 * The rounded route through the points: at each interior corner the path
 * leaves the segments early and crosses the corner on a quadratic Bézier
 * whose control point is the sharp corner itself. The fillet distance is
 * clamped to half of each adjoining segment so short hops stay sane.
 */
type Fillet = { enter: PathPoint; corner: PathPoint; exit: PathPoint }

function filletsOf(points: PathPoint[], radius: number): Fillet[] {
  const fillets: Fillet[] = []
  for (let i = 1; i < points.length - 1; i++) {
    const previous = points[i - 1]
    const corner = points[i]
    const next = points[i + 1]
    if (!previous || !corner || !next) continue
    const inLength = distance(previous, corner)
    const outLength = distance(corner, next)
    if (inLength === 0 || outLength === 0) continue
    const d = Math.min(radius, inLength / 2, outLength / 2)
    fillets.push({
      enter: {
        x: corner.x + ((previous.x - corner.x) * d) / inLength,
        y: corner.y + ((previous.y - corner.y) * d) / inLength,
      },
      corner,
      exit: {
        x: corner.x + ((next.x - corner.x) * d) / outLength,
        y: corner.y + ((next.y - corner.y) * d) / outLength,
      },
    })
  }
  return fillets
}

/** SVG path for the curve-style route (quadratic fillet at every corner). */
export function roundedPathD(points: PathPoint[], radius = CURVE_RADIUS_PX): string {
  const first = points[0]
  if (!first) return ''
  if (points.length < 3) {
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ')
  }
  const fillets = filletsOf(points, radius)
  let d = `M ${first.x},${first.y}`
  for (const f of fillets) {
    d += ` L ${f.enter.x},${f.enter.y} Q ${f.corner.x},${f.corner.y} ${f.exit.x},${f.exit.y}`
  }
  const last = points[points.length - 1]
  if (last) d += ` L ${last.x},${last.y}`
  return d
}

/** Numeric arc length of one quadratic Bézier (sampled — 16 segments). */
function quadraticLength(p0: PathPoint, control: PathPoint, p2: PathPoint): number {
  const STEPS = 16
  let total = 0
  let prev = p0
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS
    const u = 1 - t
    const point = {
      x: u * u * p0.x + 2 * u * t * control.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * control.y + t * t * p2.y,
    }
    total += distance(prev, point)
    prev = point
  }
  return total
}

/**
 * Physical length of the curve-style route — the same fillet geometry the
 * renderer draws, measured. A rounded corner CUTS the corner, so this is
 * always ≤ the sharp polyline length.
 */
export function roundedPathLength(points: PathPoint[], radius = CURVE_RADIUS_PX): number {
  if (points.length < 3) return polylineLength(points)
  const fillets = filletsOf(points, radius)
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) return polylineLength(points)
  let total = 0
  let cursor: PathPoint = first
  for (const f of fillets) {
    total += distance(cursor, f.enter)
    total += quadraticLength(f.enter, f.corner, f.exit)
    cursor = f.exit
  }
  total += distance(cursor, last)
  return total
}
