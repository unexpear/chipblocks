import type { PadBox } from './pcb-board.ts'
import type { CopperTrace } from './pcb-route.ts'

/**
 * Board-mm snapping shared by the flat (SVG) and 3-D board views. Once a click is turned into a point
 * in board millimetres — by the flat view's `eventToMm`, or the 3-D view's ray→copper-plane cast — the
 * routing/via snapping is IDENTICAL: it is pure geometry in the same mm space. Keeping it in one place
 * means the flat tool and the 3-D tool can never drift on what counts as "on a pad" or "on a trace".
 */

export type Pt2 = { x: number; y: number }

/** The default via-snap radius (mm): how close a click must land to an existing trace to snap onto it. */
export const SNAP_RADIUS_MM = 0.5

/** The closest point on segment a→b to point p (mm) — for snapping a via onto an existing trace. */
export function closestOnSegment(p: Pt2, a: Pt2, b: Pt2): Pt2 {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return { x: a.x + dx * t, y: a.y + dy * t }
}

/** The pad under a board point — the first pad whose copper box contains it (AABB test in mm), or null. */
export function hitPad(padBoxes: PadBox[], mm: Pt2): PadBox | null {
  return (
    padBoxes.find(
      (pb) => mm.x >= pb.x && mm.x <= pb.x + pb.w && mm.y >= pb.y && mm.y <= pb.y + pb.h,
    ) ?? null
  )
}

/**
 * The copper under a board point — a pad (returns its centre + net), else the nearest trace within
 * `tolMm` (returns the projected point + that trace's net), else null. Gives the via tool a snap point
 * and the net to carry. Layer-blind by design: a via is copper on BOTH layers, so it joins whatever
 * copper shares that (x,y) regardless of which layer the click aimed at.
 */
export function hitCopper(
  traces: CopperTrace[],
  padBoxes: PadBox[],
  mm: Pt2,
  tolMm = SNAP_RADIUS_MM,
): { at: Pt2; net: string } | null {
  const pad = hitPad(padBoxes, mm)
  if (pad !== null) return { at: { x: pad.x + pad.w / 2, y: pad.y + pad.h / 2 }, net: pad.net }
  let best: { at: Pt2; net: string; d: number } | null = null
  for (const t of traces) {
    for (let i = 0; i + 1 < t.points.length; i++) {
      const a = t.points[i]
      const b = t.points[i + 1]
      if (!a || !b) continue
      const cp = closestOnSegment(mm, a, b)
      const d = Math.hypot(mm.x - cp.x, mm.y - cp.y)
      if (d < tolMm && (best === null || d < best.d)) best = { at: cp, net: t.net, d }
    }
  }
  return best !== null ? { at: best.at, net: best.net } : null
}
