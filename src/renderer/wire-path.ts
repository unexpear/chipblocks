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

/** Default corner fillet radius for curve-style wires, in canvas px (1 px = 1 mm). */
export const CURVE_RADIUS_PX = 14

/**
 * The curve-size choices the wire tool offers (S19-v3-70) — how far before a
 * corner the wire starts bending. Each wire remembers its own size; a bigger
 * sweep cuts more of the corner, so the wire is REALLY shorter (less
 * resistance) — the length math below measures whatever is drawn. The fillet
 * still clamps to half of each adjoining segment, so a Wide setting on a
 * short hop bends as far as the geometry allows and no further.
 */
export const CURVE_SIZES: { label: string; radiusPx: number; hint: string }[] = [
  { label: 'Gentle', radiusPx: CURVE_RADIUS_PX, hint: 'a small ease around the corner' },
  { label: 'Round', radiusPx: 28, hint: 'a clear quarter-turn sweep' },
  { label: 'Wide', radiusPx: 56, hint: 'a long, gradual bend' },
]

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

/**
 * SVG path for a wire that HOPS over the wires it crosses without connecting — the classic schematic
 * crossover. At each `hop` point that lands on one of this wire's segments, the straight run is replaced
 * by a small semicircular bump (a cubic Bézier ≈ a semicircle) so the wire reads as passing OVER the one
 * underneath, not joining it. The bump always rises to a consistent side (up for a horizontal run, left
 * for a vertical one). With no hops it's just the straight polyline.
 */
export function hopPath(points: PathPoint[], hops: PathPoint[], radius = 5): string {
  const first = points[0]
  if (!first) return ''
  const plain = () => points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ')
  if (hops.length === 0) return plain()
  const K = (4 / 3) * radius // cubic control offset that approximates a semicircle
  let d = `M ${first.x},${first.y}`
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (!a || !b) continue
    const len = distance(a, b)
    if (len === 0) continue
    const ux = (b.x - a.x) / len
    const uy = (b.y - a.y) / len
    // unit perpendicular, forced to a consistent side (up; left for a vertical run)
    let px = uy
    let py = -ux
    if (py > 0 || (py === 0 && px > 0)) {
      px = -px
      py = -py
    }
    const onSeg = hops
      .map((h) => {
        const t = (h.x - a.x) * ux + (h.y - a.y) * uy // distance along a→b
        const perp = Math.abs((h.x - a.x) * uy - (h.y - a.y) * ux) // distance off the line
        return { t, perp }
      })
      .filter((o) => o.perp <= 1 && o.t > radius && o.t < len - radius)
      .sort((m, n) => m.t - n.t)
    for (const o of onSeg) {
      const p1 = { x: a.x + ux * (o.t - radius), y: a.y + uy * (o.t - radius) }
      const p2 = { x: a.x + ux * (o.t + radius), y: a.y + uy * (o.t + radius) }
      d += ` L ${p1.x},${p1.y} C ${p1.x + px * K},${p1.y + py * K} ${p2.x + px * K},${p2.y + py * K} ${p2.x},${p2.y}`
    }
    d += ` L ${b.x},${b.y}`
  }
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

/** Point on one quadratic Bézier at parameter t. */
function quadraticPoint(p0: PathPoint, control: PathPoint, p2: PathPoint, t: number): PathPoint {
  const u = 1 - t
  return {
    x: u * u * p0.x + 2 * u * t * control.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * control.y + t * t * p2.y,
  }
}

/**
 * Points along the TRUE drawn route, roughly every `stepPx` (S19-v3-70) — for
 * hit-testing a wire against a selection box or lasso. Same fillet geometry
 * as the renderer and the length math, so a curved wire is tested where it
 * actually runs (the cut corner, not the sharp tip it never touches).
 */
export function samplePathPoints(
  points: PathPoint[],
  options: { curved?: boolean; radius?: number; stepPx?: number } = {},
): PathPoint[] {
  const stepPx = options.stepPx ?? 10
  const first = points[0]
  if (!first) return []
  const samples: PathPoint[] = [first]
  const sampleSegment = (from: PathPoint, to: PathPoint) => {
    const length = distance(from, to)
    const steps = Math.max(1, Math.ceil(length / stepPx))
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      samples.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t })
    }
  }

  if (options.curved !== true || points.length < 3) {
    for (let i = 1; i < points.length; i++) {
      const next = points[i]
      if (next) sampleSegment(samples[samples.length - 1] ?? first, next)
    }
    return samples
  }

  const fillets = filletsOf(points, options.radius ?? CURVE_RADIUS_PX)
  let cursor: PathPoint = first
  for (const f of fillets) {
    sampleSegment(cursor, f.enter)
    const arcSteps = Math.max(2, Math.ceil(quadraticLength(f.enter, f.corner, f.exit) / stepPx))
    for (let i = 1; i <= arcSteps; i++) {
      samples.push(quadraticPoint(f.enter, f.corner, f.exit, i / arcSteps))
    }
    cursor = f.exit
  }
  const last = points[points.length - 1]
  if (last) sampleSegment(cursor, last)
  return samples
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
