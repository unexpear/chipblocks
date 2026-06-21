import { ViewportPortal } from '@xyflow/react'
import type { Point } from './net-edge.tsx'
import { THEME } from './theme.ts'

/**
 * Wire-to-wire crossings (Sprint 22). Two wires that cross on the canvas are NOT connected —
 * a hollow dot marks the crossing so it reads as "passing over," and clicking it JOINS them
 * (the join splits both wires at the point and ties them to a junction node, which
 * canvas-to-world turns into one shared net; the junction then renders as a FILLED dot).
 * The classic schematic rule — open dot = crossing, filled dot = connected.
 *
 * The geometry comes from each wire reporting its own drawn path (net-edge's WireGeomContext);
 * here we just intersect the segments. Wires that share an endpoint node meet at a terminal —
 * that's a connection, not a crossing — so those pairs are skipped.
 */

export type WireMeta = { id: string; source: string; target: string }
export type WireCrossing = { x: number; y: number; edgeA: string; edgeB: string; key: string }

/** Where do segments p1p2 and p3p4 cross (strictly between their ends)? null if they don't. */
function segmentIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
  const denom = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x)
  if (denom === 0) return null // parallel
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / denom
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / denom
  const edge = 0.02 // stay clear of the very ends — those are terminals/junctions, not crossings
  if (t <= edge || t >= 1 - edge || u <= edge || u >= 1 - edge) return null
  return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) }
}

export function findWireCrossings(geoms: Map<string, Point[]>, edges: WireMeta[]): WireCrossing[] {
  const meta = new Map(edges.map((e) => [e.id, e]))
  const ids = [...geoms.keys()].filter((id) => meta.has(id))
  const out: WireCrossing[] = []
  for (let a = 0; a < ids.length; a++) {
    for (let b = a + 1; b < ids.length; b++) {
      const ia = ids[a]
      const ib = ids[b]
      if (ia === undefined || ib === undefined) continue
      const ea = meta.get(ia)
      const eb = meta.get(ib)
      if (!ea || !eb) continue
      // share an endpoint node → they meet at a terminal/junction (a connection, not a crossing)
      if (
        ea.source === eb.source ||
        ea.source === eb.target ||
        ea.target === eb.source ||
        ea.target === eb.target
      )
        continue
      const ga = geoms.get(ia)
      const gb = geoms.get(ib)
      if (!ga || !gb) continue
      let hit: Point | null = null
      for (let i = 0; i < ga.length - 1 && hit === null; i++) {
        for (let j = 0; j < gb.length - 1 && hit === null; j++) {
          const a1 = ga[i]
          const a2 = ga[i + 1]
          const b1 = gb[j]
          const b2 = gb[j + 1]
          if (a1 && a2 && b1 && b2) hit = segmentIntersection(a1, a2, b1, b2)
        }
      }
      if (hit !== null) out.push({ x: hit.x, y: hit.y, edgeA: ia, edgeB: ib, key: `${ia}|${ib}` })
    }
  }
  return out
}

/** Hollow markers at each un-joined crossing; clicking one joins the two wires. */
export function WireCrossingsOverlay({
  crossings,
  onJoin,
  light,
}: {
  crossings: WireCrossing[]
  onJoin: (crossing: WireCrossing) => void
  light: boolean
}) {
  return (
    <ViewportPortal>
      {crossings.map((c) => (
        // biome-ignore lint/a11y/useKeyWithClickEvents: a crossing marker is click-to-join; keyboard joining is future work
        // biome-ignore lint/a11y/noStaticElementInteractions: a crossing marker is a click target to join two wires; keyboard joining is future work
        <div
          key={c.key}
          className="nodrag nopan"
          onClick={(event) => {
            event.stopPropagation()
            onJoin(c)
          }}
          title="These wires cross but are NOT connected (open dot). Click to JOIN them into one node."
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${c.x}px, ${c.y}px)`,
            width: 11,
            height: 11,
            borderRadius: '50%',
            background: light ? THEME.textBright : THEME.surfaceDeep,
            border: `2px solid ${light ? THEME.textMuted : THEME.textSoft}`,
            cursor: 'pointer',
            pointerEvents: 'all',
            zIndex: 6,
          }}
        />
      ))}
    </ViewportPortal>
  )
}
