import { useState } from 'react'
import { FlowViewportPortal } from './flow-portals.tsx'
import type { Point } from './net-edge.tsx'
import { THEME } from './theme.ts'
import { HelpTip } from './tooltip.tsx'

/**
 * Wire-to-wire crossings (Sprint 22). Two wires that cross on the canvas are NOT connected — the over
 * wire HOPS over the under one (the schematic crossover, drawn by net-edge), so the picture itself shows
 * "passing over." This module finds those crossings (and which wire hops); the overlay below puts an
 * invisible hover target at each, so you can click to JOIN them into one node (which canvas-to-world
 * turns into one shared net, rendered as a real FILLED junction dot). The classic schematic rule —
 * a crossover/hop = crossing, a filled dot = connected.
 *
 * The geometry comes from each wire reporting its own drawn path (net-edge's WireGeomContext);
 * here we just intersect the segments. Wires that share an endpoint node meet at a terminal —
 * that's a connection, not a crossing — so those pairs are skipped.
 */

export type WireMeta = {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}
/** A point where two wires meet on the canvas. `connected` = the two wires are the SAME net — a real
 *  junction, drawn as a FILLED dot. Otherwise they belong to different nets and merely cross — NOT
 *  connected, drawn as an OPEN (hollow) dot. The classic schematic rule. */
export type WireCrossing = {
  x: number
  y: number
  edgeA: string
  edgeB: string
  connected: boolean
  key: string
}

/** Where do segments p1p2 and p3p4 cross? ENDPOINTS INCLUDED, so a T-junction or a corner landing on the
 *  other wire's run counts as a real intersection (the old "strictly between the ends" rule missed those).
 *  null if they don't meet. Collinear/parallel returns null — that's an overlap, handled by lane spacing. */
function segmentIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
  const denom = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x)
  if (denom === 0) return null // parallel / collinear
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / denom
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / denom
  const eps = 1e-6
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null
  return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) }
}

/** Dull, desaturated shades for the OPTIONAL per-WIRE colour-coding — one colour per wire (cycled by
 *  wire index) so you can pick a wire and follow it end to end through a tangle. Muted so they don't
 *  fight the schematic. Purely visual: never changes the solve. */
export const NET_COLORS = [
  '#8b9cb3',
  '#8faf93',
  '#b3a487',
  '#b38f9c',
  '#8fb0aa',
  '#a596b3',
  '#b39685',
  '#a3b38f',
  '#8aa6b8',
  '#b0a0b8',
]
export const netColor = (netIndex: number): string =>
  NET_COLORS[((netIndex % NET_COLORS.length) + NET_COLORS.length) % NET_COLORS.length] as string

/**
 * Every point where two drawn wires meet, one mark per point.
 *
 * `limit` stops the scan once that many marks have been made, and exists because the count is not bounded
 * by anything the user did: it grows with the SQUARE of the wiring, and a design read back off a real chip
 * is dense wiring. Measured in the running app on the design recovered from `fixtures/gowin-gw1n1-splitout.fs`
 * (1,582 parts, 2,761 wires): 290,091 crossings — 290,091 of the document's 346,154 elements were crossing
 * markers. Left unbounded it is the largest single cost of putting such a design on screen. Callers that
 * cannot draw more than a certain number pass that number and hand the user an honest note instead; the
 * default is unbounded, so an ordinary canvas is scanned exactly as before.
 */
export function findWireCrossings(
  geoms: Map<string, Point[]>,
  edges: WireMeta[],
  limit = Number.POSITIVE_INFINITY,
): WireCrossing[] {
  const meta = new Map(edges.map((e) => [e.id, e]))
  const ids = [...geoms.keys()].filter((id) => meta.has(id))
  // Group wires into real NETS by shared PIN (same node + handle), transitively (union-find). Two wires
  // on DIFFERENT pins of the same part are DIFFERENT nets — so a crossing between them IS a real crossing
  // and must NOT be skipped just because they touch the same part. Only same-net pairs are connections.
  const parent = new Map<string, string>()
  for (const e of edges) parent.set(e.id, e.id)
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r) as string
    return r
  }
  const pinEdges = new Map<string, string[]>()
  for (const e of edges) {
    for (const pin of [
      `${e.source}\u0000${e.sourceHandle ?? ''}`,
      `${e.target}\u0000${e.targetHandle ?? ''}`,
    ]) {
      const arr = pinEdges.get(pin)
      if (arr) arr.push(e.id)
      else pinEdges.set(pin, [e.id])
    }
  }
  for (const group of pinEdges.values()) {
    for (let i = 1; i < group.length; i++) {
      parent.set(find(group[0] as string), find(group[i] as string))
    }
  }
  // One mark per rounded point (a corner hit found via two adjacent segments, or three wires meeting at
  // one spot, must not stack). A CONNECTED (same-net) mark wins over an unconnected one at the same point.
  const near = (p: Point | undefined, q: Point) =>
    p !== undefined && Math.abs(p.x - q.x) < 2 && Math.abs(p.y - q.y) < 2
  // Each wire's own bounding box, so a pair whose boxes do not overlap is thrown out in four comparisons
  // instead of every segment of one against every segment of the other. The pair loop is still the square
  // of the wire count; what this takes out is the work INSIDE it, which is where the time was. Profiled on
  // the built app while drawing 2,000 grouped blocks with 3,400 wires, this scan and the segment
  // intersection under it held the thread for 15,071 and 9,501 ms of a 46,674 ms draw
  // (…/cg/prof-b2000w3400.json). Most pairs on any real canvas are nowhere near each other.
  const boxes = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>()
  for (const id of ids) {
    const points = geoms.get(id)
    if (points === undefined || points.length === 0) continue
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (const point of points) {
      if (point.x < minX) minX = point.x
      if (point.x > maxX) maxX = point.x
      if (point.y < minY) minY = point.y
      if (point.y > maxY) maxY = point.y
    }
    boxes.set(id, { minX, minY, maxX, maxY })
  }
  const marks = new Map<string, WireCrossing>()
  for (let a = 0; a < ids.length; a++) {
    for (let b = a + 1; b < ids.length; b++) {
      const ia = ids[a]
      const ib = ids[b]
      if (ia === undefined || ib === undefined) continue
      const boxA = boxes.get(ia)
      const boxB = boxes.get(ib)
      if (boxA === undefined || boxB === undefined) continue
      // The epsilon the intersection test itself allows, so a pair that touches exactly on a box edge is
      // still compared: a T-junction landing on the far wire's end is a crossing this must not lose.
      // Mutation-tested both ways: widening the box (the `- 1` to `+ 1`) drops real crossings and the
      // suite fails; DELETING a line is invisible, and correctly so — an early-continue that is only ever
      // taken for pairs that cannot meet can be removed without changing a single answer, only the time.
      if (boxA.maxX < boxB.minX - 1 || boxB.maxX < boxA.minX - 1) continue
      if (boxA.maxY < boxB.minY - 1 || boxB.maxY < boxA.minY - 1) continue
      const ga = geoms.get(ia)
      const gb = geoms.get(ib)
      if (!ga || !gb) continue
      const sameNet = find(ia) === find(ib)
      const endA = [ga[0], ga[ga.length - 1]]
      const endB = [gb[0], gb[gb.length - 1]]
      // Record EVERY meeting of this pair, not just the first — two wires can cross more than once (a
      // wire that detours over the top crosses the same rail going up AND coming back down).
      for (let i = 0; i < ga.length - 1; i++) {
        for (let j = 0; j < gb.length - 1; j++) {
          const a1 = ga[i]
          const a2 = ga[i + 1]
          const b1 = gb[j]
          const b2 = gb[j + 1]
          if (!a1 || !a2 || !b1 || !b2) continue
          const hit = segmentIntersection(a1, a2, b1, b2)
          if (hit === null) continue
          // For a SAME-net pair, a FILLED junction dot belongs only at a real TAP — exactly ONE of the two
          // wires ENDS here, on the other's run (a T). If BOTH end here it's a shared pin/node (the
          // pin/handle/junction-node already shows that); if NEITHER ends here the two same-net wires
          // merely pass over each other (already one net elsewhere) — no new junction. Different nets
          // always mark (an OPEN dot), endpoint or not — a wire ending on a foreign run still just crosses.
          if (sameNet) {
            const aEnds = endA.some((e) => near(e, hit))
            const bEnds = endB.some((e) => near(e, hit))
            if (aEnds === bEnds) continue
          }
          const pk = `${Math.round(hit.x)},${Math.round(hit.y)}`
          const prev = marks.get(pk)
          if (prev) {
            if (sameNet && !prev.connected) prev.connected = true
            continue
          }
          marks.set(pk, {
            x: hit.x,
            y: hit.y,
            edgeA: ia,
            edgeB: ib,
            connected: sameNet,
            key: `${ia}|${ib}|${pk}`,
          })
          if (marks.size >= limit) return [...marks.values()]
        }
      }
    }
  }
  return [...marks.values()]
}

/**
 * The crossings a canvas may mark, and whether there were more than that.
 *
 * WHY THE SCAN IS ASKED FOR ONE MORE THAN MAY BE DRAWN. `findWireCrossings` stops at its limit, so a
 * canvas with a million crossings and a canvas with exactly `limit` crossings both come back holding
 * `limit` of them and are indistinguishable. Scanning for one more is what tells them apart: coming back
 * with `limit + 1` can only mean the scan stopped early. Without it `unmarked` can never be true, and a
 * design like the 290,091-crossing one above would show 2,000 arbitrary dots as though they were all of
 * them — which is exactly what the overlay says it must not do.
 *
 * The cap and the comparison are two halves of one decision and are kept together for that reason: apart,
 * either one can be changed on its own and the other silently stops meaning anything.
 */
export function markableWireCrossings(
  geoms: Map<string, Point[]>,
  edges: WireMeta[],
  limit: number,
): { crossings: WireCrossing[]; unmarked: boolean } {
  const found = findWireCrossings(geoms, edges, limit + 1)
  if (found.length > limit) return { crossings: [], unmarked: true }
  return { crossings: found, unmarked: false }
}

/**
 * Click targets at each un-joined crossing. The WIRE itself already shows the crossing — the over wire
 * HOPS over the under one (the schematic crossover), so we don't draw a dot on top of it (that would
 * cover the hop). Instead the marker is invisible until you HOVER it, when a hollow ring appears as the
 * "click to JOIN these two wires" affordance. Joining replaces the hop with a real filled junction node.
 */
export function WireCrossingsOverlay({
  crossings,
  onJoin,
  light,
  readOnly = false,
  unmarked = false,
}: {
  crossings: WireCrossing[]
  onJoin: (crossing: WireCrossing) => void
  light: boolean
  readOnly?: boolean
  /** This canvas has more crossings than may be marked, so none are: say so rather than mark some of
   *  them, which would read as "these are the crossings" and be wrong. */
  unmarked?: boolean
}) {
  const [hovered, setHovered] = useState<string | null>(null)
  // The OPEN (not-connected) dot is a hollow ring whose centre is the canvas colour, so it visibly breaks
  // the crossing — the schematic "these pass over, they do NOT join". The FILLED dot is a solid wire-colour
  // disc — "one net here". Only the open ones are click-to-join (filled ones are already connected).
  const canvasFill = light ? THEME.white : THEME.surfaceDeep
  if (unmarked)
    return (
      <div
        style={{
          position: 'absolute',
          left: 60,
          bottom: 12,
          maxWidth: 360,
          zIndex: 6,
          padding: '3px 7px',
          borderRadius: 3,
          background: THEME.surfaceDeep,
          border: `1px solid ${THEME.borderStrong}`,
          color: THEME.textMuted,
          fontSize: 10,
          fontFamily: 'system-ui, sans-serif',
          pointerEvents: 'none',
        }}
      >
        Wire crossings are not marked on this canvas — there are too many of them to mark. The wires
        and the circuit are unchanged; only the click-a-crossing-to-join-it dots are absent.
      </div>
    )
  return (
    <FlowViewportPortal>
      {crossings.map((c) => {
        const interactive = !readOnly && !c.connected
        const hot = interactive && hovered === c.key
        return (
          <HelpTip
            key={c.key}
            helpId={c.connected ? 'crossing.joined' : readOnly ? 'crossing.open' : 'crossing.join'}
          >
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: a crossing marker is click-to-join; keyboard joining is future work */}
            {/* biome-ignore lint/a11y/noStaticElementInteractions: a crossing marker is a click target to join two wires; keyboard joining is future work */}
            <div
              className="nodrag nopan"
              onClick={
                interactive
                  ? (event) => {
                      event.stopPropagation()
                      onJoin(c)
                    }
                  : undefined
              }
              onMouseEnter={interactive ? () => setHovered(c.key) : undefined}
              onMouseLeave={
                interactive ? () => setHovered((h) => (h === c.key ? null : h)) : undefined
              }
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${c.x}px, ${c.y}px)`,
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: c.connected ? THEME.wire : canvasFill,
                border: c.connected ? 'none' : `1.5px solid ${THEME.wire}`,
                boxShadow: hot ? `0 0 0 2px ${THEME.accentBlue}` : undefined,
                cursor: interactive ? 'pointer' : 'default',
                pointerEvents: interactive ? 'all' : 'none',
                zIndex: 6,
              }}
            />
          </HelpTip>
        )
      })}
    </FlowViewportPortal>
  )
}
