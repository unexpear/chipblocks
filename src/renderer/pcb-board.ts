import {
  BUILTIN_FOOTPRINTS,
  type Footprint,
  fabricationBounds,
  footprintBounds,
  type Pad,
} from './footprint.ts'
import { boardDesignator, footprintForPart, padForTerminal } from './footprint-assignment.ts'
import { SILK_TEXT, strokeTextWidthMm } from './stroke-font.ts'

/**
 * The PCB board — the physical layout the schematic becomes (TOOLCHAIN-ROADMAP.md Track 1, the PCB
 * canvas). A `Board` is a rectangular outline plus a `Placement` for every schematic part that has a
 * footprint: where its footprint sits on the copper and how it's turned. This is the FIRST time the
 * circuit becomes a physical thing with X/Y/rotation, not just a graph — the bridge the copper router
 * and the Gerber export build on next.
 *
 * `deriveBoard` seeds a layout from the schematic: it lays the footprinted parts out in a neat row (a
 * real auto-placer optimises for net length; this just gives every part a real spot to start from) and
 * fits the board outline around them. Parts with no footprint are honestly skipped — they aren't on the
 * board until their package exists.
 */

export type Rotation = 0 | 90 | 180 | 270

export type Placement = {
  /** The schematic part this places (the node id). */
  partId: string
  footprintId: string
  /** Board position of the footprint origin, in mm. */
  x: number
  y: number
  rotation: Rotation
  /** The short reference designator (R1, C2 — boardDesignator) the silk prints and the assembly
   *  files key on. deriveBoard fills it (deduped); absent (hand-built boards) ⇒ the partId. */
  designator?: string
}

/** The board outline's BOUNDING BOX, in mm. Always the axis-aligned extent of the board — for a plain
 *  rectangular board it IS the board; for a hand-drawn `profile` it is that polygon's bounding box. */
export type BoardOutline = { x: number; y: number; w: number; h: number }

/** One vertex of a hand-drawn board profile, in board mm. */
export type BoardPoint = { x: number; y: number }

/** A user-drawn board PROFILE — the real physical edge as a closed ring of vertices (mm), replacing the
 *  auto-fit rectangle. Absent ⇒ the board IS its bounding-box rectangle (`outline`). Increment 1: the outer
 *  contour only, straight edges, implicitly closed (last→first), ≥ 3 points. Later increments add inner
 *  cutout contours + curved (arc) edges. */
export type BoardProfile = { points: readonly BoardPoint[] }

/**
 * A controlled-depth RECESS — a rectangular pocket milled into the board to a partial depth (it does
 * NOT pass through). This one primitive covers the whole variable-thickness family: an interior recess
 * is a cavity / recessed board (sit a tall part flush, or expose a buried layer); a recess that runs
 * to the board edge reads as a stepped board (a thinner card edge). x/y/w/h are the pocket footprint in
 * board mm; depthMm is the milled depth (< the board thickness); side is which face it is cut into.
 * Real fab process = depth-controlled CNC routing, cited ~±0.2 mm Z-axis depth tolerance.
 */
export type Recess = {
  x: number
  y: number
  w: number
  h: number
  depthMm: number
  side: 'top' | 'bottom'
}

/** Which side of the rectangular outline — the four board edges. */
export type BoardSide = 'top' | 'bottom' | 'left' | 'right'

export type Board = {
  outline: BoardOutline
  placements: Placement[]
  /** The board edges that will be separated from a production panel by V-SCORING (a shallow groove cut
   *  top and bottom, then snapped) rather than by a routed mill slot. A V-scored edge needs MORE copper
   *  clearance than a routed one (the scoring blade + the snap can chip copper right at the groove), so
   *  the copper-to-edge DRC tightens on these sides. Absent / empty ⇒ every edge is routed (the default). */
  vScoredSides?: BoardSide[]
  /** A hand-drawn board edge (a closed polygon). Absent ⇒ the board is the rectangle `outline`. When
   *  present, `outline` MUST equal this profile's bounding box — the Gerber cut, the edge-clearance DRC and
   *  the 3-D body follow the profile, while the many bounding-box consumers keep reading `outline`. */
  profile?: BoardProfile
}

/** The board's bounding-box outline (mm) for a hand-drawn profile — the axis-aligned extent of its ring. */
export function profileBBox(profile: BoardProfile): BoardOutline {
  const xs = profile.points.map((p) => p.x)
  const ys = profile.points.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/** The board's physical edge as a closed ring of vertices — the profile's points if hand-drawn, else the
 *  four `outline` corners IN THE ORDER the Gerber writer has always used (so a rectangular board's edge cut
 *  stays byte-identical). The Gerber profile, the edge-clearance DRC and the 3-D body all walk this ring. */
export function outlineRing(board: Pick<Board, 'outline' | 'profile'>): BoardPoint[] {
  if (board.profile !== undefined) return board.profile.points.map((p) => ({ x: p.x, y: p.y }))
  const o = board.outline
  return [
    { x: o.x, y: o.y },
    { x: o.x + o.w, y: o.y },
    { x: o.x + o.w, y: o.y + o.h },
    { x: o.x, y: o.y + o.h },
  ]
}

/** The minimal part shape deriveBoard reads (a schematic node). */
export type BoardPart = { id: string; definition: string; footprintId?: string }

/** Resolve a placement's footprint (it stores the id, not the object). */
export function footprintByPlacement(p: Placement): Footprint | undefined {
  return BUILTIN_FOOTPRINTS[p.footprintId]
}

/** Turn a footprint-local point onto the board: rotate about the footprint ORIGIN (the same pivot the
 *  renderer's `translate(x y) rotate(θ)` uses — NOT the bounds centre, which differs for through-hole
 *  footprints whose origin is pin 1), then translate to the placement position. */
export function placePoint(
  p: Placement,
  local: { x: number; y: number },
): { x: number; y: number } {
  const { x, y } = local
  switch (p.rotation) {
    case 0:
      return { x: p.x + x, y: p.y + y }
    case 90:
      return { x: p.x - y, y: p.y + x }
    case 180:
      return { x: p.x - x, y: p.y - y }
    case 270:
      return { x: p.x + y, y: p.y - x }
  }
}

/** How a footprint-LOCAL edge maps to a BOARD edge under each placement rotation (placePoint's rotation
 *  convention: rot90 (x,y)→(−y,x)). Used to tell which board edge a castellated half-hole sits on. */
const ROTATED_SIDE: Record<Rotation, Record<BoardSide, BoardSide>> = {
  0: { top: 'top', right: 'right', bottom: 'bottom', left: 'left' },
  90: { top: 'right', right: 'bottom', bottom: 'left', left: 'top' },
  180: { top: 'bottom', right: 'left', bottom: 'top', left: 'right' },
  270: { top: 'left', right: 'top', bottom: 'right', left: 'bottom' },
}

/**
 * Which BOARD edge a castellated half-hole sits on. A castellated pad extends BEYOND the footprint's body
 * on exactly one side (that's the notched edge); we find that footprint-local side by the largest overhang
 * of the pad past the body (fabrication) outline, then rotate it into board space. Edge-mounted features
 * (the profile snap, the per-side conveyor-keepout exemption, the same-edge pitch check) all key off this,
 * so a castellated part is understood the same way everywhere. Falls back to the full footprint bounds if a
 * footprint has no body outline.
 */
export function castellatedBoardSide(fp: Footprint, pad: Pad, rotation: Rotation): BoardSide {
  const body = fabricationBounds(fp)
  const b =
    body !== undefined
      ? { minX: body.x, minY: body.y, maxX: body.x + body.w, maxY: body.y + body.h }
      : footprintBounds(fp)
  const overhang: Record<BoardSide, number> = {
    top: b.minY - (pad.center.y - pad.size.h / 2),
    bottom: pad.center.y + pad.size.h / 2 - b.maxY,
    left: b.minX - (pad.center.x - pad.size.w / 2),
    right: pad.center.x + pad.size.w / 2 - b.maxX,
  }
  let localSide: BoardSide = 'bottom'
  for (const side of ['top', 'bottom', 'left', 'right'] as const) {
    if (overhang[side] > overhang[localSide]) localSide = side
  }
  return ROTATED_SIDE[rotation][localSide]
}

/** A placement's board-space bounding box (its footprint's bounds turned about the origin, then
 *  translated onto the board — the same transform the renderer and placePoint apply). */
export function placementBounds(
  p: Placement,
  fp: Footprint,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const b = footprintBounds(fp)
  const corners = [
    placePoint(p, { x: b.minX, y: b.minY }),
    placePoint(p, { x: b.maxX, y: b.minY }),
    placePoint(p, { x: b.maxX, y: b.maxY }),
    placePoint(p, { x: b.minX, y: b.maxY }),
  ]
  return {
    minX: Math.min(...corners.map((c) => c.x)),
    minY: Math.min(...corners.map((c) => c.y)),
    maxX: Math.max(...corners.map((c) => c.x)),
    maxY: Math.max(...corners.map((c) => c.y)),
  }
}

/** A user's hand-placed spot for one part: where its footprint origin sits and how it's turned. */
export type PlacementOverride = { x: number; y: number; rotation: Rotation }

/**
 * Seed a board from the schematic parts: lay each footprinted part out in a left-to-right row (its
 * footprint's bounds packed with a gap, all vertically centred), then fit the outline around them with
 * a margin. Deterministic, so the same schematic always seeds the same starting board. A part the user
 * has dragged or rotated on the board keeps its hand-placed spot (`overrides`, keyed by part id) —
 * the auto row only decides where a part STARTS; stale overrides for deleted parts simply match
 * nothing. The outline always re-fits around wherever the parts actually are.
 */
export function deriveBoard(
  parts: readonly BoardPart[],
  overrides?: ReadonlyMap<string, PlacementOverride>,
  gap = 2,
  // 3 mm margin = the minimum SMT assembly edge keepout (a part-free rail for the conveyor to grip). The
  // outline fits to each part's full bounds (which enclose its body) + this margin, so every part body ends
  // up ≥ 3 mm from the board edge — the component-edge-keepout DRC then passes for an auto-derived board and
  // only fires if a part is dragged too close to the edge.
  margin = 3,
): Board {
  const placements: Placement[] = []
  // Short designators, deduped: two ids can collapse onto one designator ('r1' and 'resistor_1'
  // both read R1) — the second keeps its raw id, so no two parts ever print the same name.
  const takenDesignators = new Set<string>()
  let cursorX = 0
  for (const part of parts) {
    // The user's chosen package if valid for this part, else the part's default (footprintForPart guards).
    const fp = footprintForPart(part.definition, part.footprintId)
    if (fp === undefined) continue
    const b = footprintBounds(fp)
    const override = overrides?.get(part.id)
    const short = boardDesignator(part.id, part.definition)
    const designator = takenDesignators.has(short) ? part.id : short
    takenDesignators.add(designator)
    // Auto spot: the footprint's LEFT edge lands at cursorX, centred on y = 0. The auto row
    // advances even for hand-placed parts, so the others' seeds never reflow under them.
    placements.push({
      partId: part.id,
      footprintId: fp.id,
      x: override?.x ?? cursorX - b.minX,
      y: override?.y ?? -(b.minY + b.maxY) / 2,
      rotation: override?.rotation ?? 0,
      designator,
    })
    cursorX += b.maxX - b.minX + gap
  }
  if (placements.length === 0) return { outline: { x: 0, y: 0, w: 10, h: 10 }, placements }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const p of placements) {
    const fp = footprintByPlacement(p)
    if (fp === undefined) continue
    const bb = placementBounds(p, fp)
    minX = Math.min(minX, bb.minX)
    minY = Math.min(minY, bb.minY)
    maxX = Math.max(maxX, bb.maxX)
    maxY = Math.max(maxY, bb.maxY)
    // The silk lettering is real ink on the manufactured board — the outline must contain it
    // (review-caught: a designator centred on a small part hung 0.16 mm past the routed edge).
    const anchor = silkReferenceAnchor(p, fp)
    const halfText = strokeTextWidthMm(p.designator ?? p.partId) / 2
    minX = Math.min(minX, anchor.x - halfText)
    maxX = Math.max(maxX, anchor.x + halfText)
    minY = Math.min(minY, anchor.y - SILK_TEXT.heightMm / 2)
    maxY = Math.max(maxY, anchor.y + SILK_TEXT.heightMm / 2)
  }
  let left = minX - margin
  let right = maxX + margin
  let top = minY - margin
  let bottom = maxY + margin
  // A castellated half-hole is meant to be BISECTED by the board edge, so snap the profile through those
  // pad centres instead of clearing them by `margin`. Each pad snaps the board edge it PHYSICALLY sits on
  // (castellatedBoardSide, footprint-body-relative + rotation-aware) — not merely the nearest current edge,
  // which would pull a wide row's corner pads onto a side edge and collapse the outline. Targets are all
  // computed against the SAME pre-snap edges (no mid-loop mutation). Guarded twice: a board with no
  // castellated pads is untouched, AND the snap only applies to a LONE module (one placement). Moving an
  // edge inward through a castellated pad could push a SEPARATE part outside the outline on a mixed board;
  // there we keep the enclosing outline and let the on-edge DRC honestly flag the not-on-edge castellations
  // (a mixed castellated + normal board is a hand-placed / panelized layout, not an auto-seeded one).
  if (placements.length === 1) {
    const snap: Partial<Record<BoardSide, number>> = {}
    for (const p of placements) {
      const fp = footprintByPlacement(p)
      if (fp === undefined) continue
      for (const pad of fp.pads) {
        if (pad.castellated !== true) continue
        const side = castellatedBoardSide(fp, pad, p.rotation)
        const c = placePoint(p, pad.center)
        const coord = side === 'left' || side === 'right' ? c.x : c.y
        const prev = snap[side]
        // The board edge sits at the OUTERMOST castellated pad on that side (they share a line on a real
        // module): max for bottom/right, min for top/left.
        snap[side] =
          prev === undefined
            ? coord
            : side === 'bottom' || side === 'right'
              ? Math.max(prev, coord)
              : Math.min(prev, coord)
      }
    }
    if (snap.left !== undefined) left = snap.left
    if (snap.right !== undefined) right = snap.right
    if (snap.top !== undefined) top = snap.top
    if (snap.bottom !== undefined) bottom = snap.bottom
  }
  return {
    outline: { x: left, y: top, w: right - left, h: bottom - top },
    placements,
  }
}

/**
 * Where a placement's silk designator centres, in board mm: above the part's courtyard at ANY
 * rotation, clear of the pads by construction (the courtyard contains them — the catalog's
 * invariant). For the 0603 at rotation 0 this lands exactly on KiCad's own reference anchor
 * (courtyard top −0.73, half the 1.0 mm lettering and a 0.2 mm gap above → −1.43). Upright text
 * at a rotation-following anchor was review-caught printing across the part's own pads.
 */
export function silkReferenceAnchor(p: Placement, fp: Footprint): { x: number; y: number } {
  const c = fp.courtyard
  const corners = [
    placePoint(p, { x: c.x, y: c.y }),
    placePoint(p, { x: c.x + c.w, y: c.y }),
    placePoint(p, { x: c.x + c.w, y: c.y + c.h }),
    placePoint(p, { x: c.x, y: c.y + c.h }),
  ]
  const xs = corners.map((q) => q.x)
  const ys = corners.map((q) => q.y)
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: Math.min(...ys) - SILK_TEXT.heightMm / 2 - 0.2,
  }
}

/** One unrouted connection the board still owes — a straight "airwire" between two pads on the same
 *  schematic net. The classic EDA ratsnest line; the copper router's to-do list. */
export type Airwire = {
  /** The united net this connection belongs to — the router may touch same-net copper freely, but
   *  must keep clearance from every other net's. */
  net: string
  from: { x: number; y: number }
  to: { x: number; y: number }
}

/** One pad's copper as a board-space bounding box, tagged with its net — the fixed copper the router
 *  and the clearance checks must respect. `pad` names which physical pad this is (`partId/padId`),
 *  so downstream consumers (the Gerber writer's net attributes) can look a pad's net back up.
 *  `throughHole` says the copper exists on BOTH layers (an SMD pad lives on top only) — what the
 *  bottom-layer router and the layer-aware clearance audit key on. */
export type PadBox = {
  net: string
  pad: string
  throughHole: boolean
  /** The plated hole's drill diameter (mm), for through-hole pads — the router's via placement
   *  must keep the hole-to-hole gap from EVERY drill, same net or not (the drill breaks out). */
  holeMm?: number
  /** A CASTELLATED half-hole on the board edge (mirrors the footprint pad's `castellated`) — the edge
   *  checks exempt it (it BELONGS on the edge) and the castellated-hole DRC holds it to half-hole minimums. */
  castellated?: boolean
  x: number
  y: number
  w: number
  h: number
}

export type Ratsnest = { airwires: Airwire[]; padBoxes: PadBox[] }

/**
 * The current each net's copper carries, for the over-current DRC — keyed net → amps: the largest
 * current landing on the net across the pads sitting on it.
 *
 * `currentOfPad(partId, padId)` returns the current through that specific PAD. For a two-terminal
 * part that is its through-current (the same on both pads); for a three-terminal part it is that
 * terminal's own current — a BJT's base pad carries the tiny base current, its emitter pad carries
 * iE = iC + iB, its collector pad iC; a MOSFET's gate pad carries ~0. Using the pad's OWN current
 * (not one scalar per part) is what keeps a transistor's collector current off its base/gate net —
 * which would otherwise falsely over-current a correctly-sized control trace and BLOCK the ZIP —
 * and puts the real (higher) emitter/source current on that net so a genuine overload is caught.
 */
export function netThroughCurrents(
  padBoxes: readonly { pad: string; net: string }[],
  currentOfPad: (partId: string, padId: string) => number | undefined,
): Map<string, number> {
  const byNet = new Map<string, number>()
  for (const pb of padBoxes) {
    const slash = pb.pad.indexOf('/')
    const partId = slash >= 0 ? pb.pad.slice(0, slash) : pb.pad
    const padId = slash >= 0 ? pb.pad.slice(slash + 1) : ''
    const current = currentOfPad(partId, padId)
    if (current === undefined) continue
    byNet.set(pb.net, Math.max(byNet.get(pb.net) ?? 0, Math.abs(current)))
  }
  return byNet
}

/** The World slice the ratsnest reads — structurally the cross-fk World, so the board's connectivity
 *  is EXACTLY what the solver solves (blocks flattened, junctions merged, same-named net labels and
 *  all grounds teleported into one net), never a parallel re-derivation that could drift. */
export type RatsnestWorld = {
  instances: ReadonlyMap<string, { definition: string }>
  nets: ReadonlyMap<string, { members: readonly { instance: string; terminal: string }[] }>
}

/** Net members that aren't solderable pins: drawn wires are the connections themselves, and a ground
 *  symbol is a net name on a board, not a component. Junction / net-label endpoints never become
 *  instances at all, so they're skipped by the instance lookup. */
const NOT_A_PIN = new Set(['wire', 'ground'])

/**
 * The ratsnest: which pads must end up connected by copper, drawn as straight airwires. Connectivity
 * comes from the SAME canvas→world derivation the solver uses (junctions, ground symbols and named
 * power rails already merged), with one board-side step on top: a drawn wire is a solver INSTANCE
 * bridging two nets — but on the board a wire IS the copper to be routed, so the nets each wire
 * bridges are united here. The result: two resistors joined through a ground rail, a +5V port, or any
 * chain of drawn wires owe an airwire exactly like directly-touching pins. Each united net's pads are
 * joined by a minimum spanning tree — n pads need n−1 airwires, shortest total length first (the
 * KiCad/EDA convention), not a redundant every-pair web. Pins whose part isn't on the board simply
 * can't contribute a point — the user-facing count of those lives in offBoardPins, which reads the
 * UN-flattened schematic (this world contains expansion internals a user can't point at).
 */
export function computeRatsnest(world: RatsnestWorld, board: Board): Ratsnest {
  const placementOf = new Map(board.placements.map((p) => [p.partId, p]))

  // Union-find over net ids; every wire instance unites the nets it touches.
  const parent = new Map<string, string>()
  const find = (id: string): string => {
    const p = parent.get(id)
    if (p === undefined || p === id) return id
    const root = find(p)
    parent.set(id, root)
    return root
  }
  const netsOfWire = new Map<string, string[]>()
  for (const [netId, net] of world.nets) {
    for (const member of net.members) {
      if (world.instances.get(member.instance)?.definition !== 'wire') continue
      const list = netsOfWire.get(member.instance)
      if (list) list.push(netId)
      else netsOfWire.set(member.instance, [netId])
    }
  }
  for (const netIds of netsOfWire.values()) {
    const first = netIds[0]
    if (first === undefined) continue
    for (const other of netIds.slice(1)) parent.set(find(other), find(first))
  }
  const united = new Map<string, { instance: string; terminal: string }[]>()
  for (const [netId, net] of world.nets) {
    const root = find(netId)
    const members = united.get(root)
    if (members) members.push(...net.members)
    else united.set(root, [...net.members])
  }

  const airwires: Airwire[] = []
  // Which net each placed pad belongs to — filled in during the net walk, then used to tag the
  // FULL pad-copper inventory below.
  const netOfPad = new Map<string, string>()
  for (const [netKey, netMembers] of united) {
    // Every pin on this net → its pad's board position (pins with no placement/pad have no point).
    const points: { x: number; y: number }[] = []
    const seenPads = new Set<string>()
    for (const member of netMembers) {
      const definition = world.instances.get(member.instance)?.definition
      if (definition === undefined || NOT_A_PIN.has(definition)) continue
      const placement = placementOf.get(member.instance)
      const padId = padForTerminal(definition, member.terminal, placement?.footprintId)
      const fp = placement !== undefined ? footprintByPlacement(placement) : undefined
      const pad = padId !== undefined ? fp?.pads.find((p) => p.id === padId) : undefined
      if (placement === undefined || pad === undefined) continue
      const padKey = `${member.instance}/${pad.id}`
      if (seenPads.has(padKey)) continue
      seenPads.add(padKey)
      netOfPad.set(padKey, netKey)
      points.push(placePoint(placement, pad.center))
    }
    if (points.length < 2) continue

    // Prim's minimum spanning tree over the net's pads (nets are small; O(n²) is fine).
    const inTree = [points[0] as { x: number; y: number }]
    const rest = points.slice(1)
    while (rest.length > 0) {
      let bestFrom = inTree[0] as { x: number; y: number }
      let bestIndex = 0
      let bestDist = Number.POSITIVE_INFINITY
      for (const t of inTree) {
        for (let i = 0; i < rest.length; i++) {
          const r = rest[i] as { x: number; y: number }
          const d = (r.x - t.x) ** 2 + (r.y - t.y) ** 2
          if (d < bestDist) {
            bestDist = d
            bestFrom = t
            bestIndex = i
          }
        }
      }
      const next = rest.splice(bestIndex, 1)[0] as { x: number; y: number }
      // Coincident pads (stacked parts) are copper already touching copper — nothing is owed, so a
      // zero-length airwire is never emitted; the point still joins the tree so the net stays spanned.
      if (bestDist > 0) airwires.push({ net: netKey, from: bestFrom, to: next })
      inTree.push(next)
    }
  }

  // EVERY pad of EVERY placement is real copper on the board — including unwired pads, which the
  // router and the clearance audit must still keep away from (a trace crossing an unwired pad is a
  // soldered joint on the fabbed board, and a short as soon as that pin is wired). Wired pads carry
  // their net; unwired ones get a unique key so nothing is ever exempted against them.
  const padBoxes: PadBox[] = []
  for (const placement of board.placements) {
    const fp = footprintByPlacement(placement)
    if (fp === undefined) continue
    for (const pad of fp.pads) {
      const corners = [
        placePoint(placement, {
          x: pad.center.x - pad.size.w / 2,
          y: pad.center.y - pad.size.h / 2,
        }),
        placePoint(placement, {
          x: pad.center.x + pad.size.w / 2,
          y: pad.center.y - pad.size.h / 2,
        }),
        placePoint(placement, {
          x: pad.center.x + pad.size.w / 2,
          y: pad.center.y + pad.size.h / 2,
        }),
        placePoint(placement, {
          x: pad.center.x - pad.size.w / 2,
          y: pad.center.y + pad.size.h / 2,
        }),
      ]
      const xs = corners.map((c) => c.x)
      const ys = corners.map((c) => c.y)
      const x0 = Math.min(...xs)
      const y0 = Math.min(...ys)
      const padKey = `${placement.partId}/${pad.id}`
      padBoxes.push({
        net: netOfPad.get(padKey) ?? `unconnected:${padKey}`,
        pad: padKey,
        throughHole: pad.type === 'through_hole',
        ...(pad.holeDiameter !== undefined ? { holeMm: pad.holeDiameter } : {}),
        ...(pad.castellated ? { castellated: true } : {}),
        x: x0,
        y: y0,
        w: Math.max(...xs) - x0,
        h: Math.max(...ys) - y0,
      })
    }
  }
  return { airwires, padBoxes }
}

/** The minimal wire shape offBoardPins reads (a schematic edge, straight off the canvas). */
export type BoardEdge = {
  source: string
  sourceHandle?: string | null
  target: string
  targetHandle?: string | null
}

/** Canvas parts that aren't solderable components: tie points and net names, not packages. A pin on
 *  anything else (a BJT, a battery, a circuit block's port) is a real thing the user wired. */
const NOT_A_PART = new Set(['junction', 'net_label', 'ground'])

/**
 * How many wired pins the board CAN'T show yet — the honest number for the panel header. Counted from
 * the UN-flattened schematic (the parts and wires the user actually drew), NOT the solver world:
 * flattening expands circuit blocks and multi-lead sources into internals whose seam terminals sit in
 * wired nets but aren't pins anyone can point at, so counting world members over-reports. Each drawn
 * wire endpoint on a real part counts once (a pin with several wires is still one pin) when its part
 * has no placement or the terminal has no pad mapping.
 */
export function offBoardPins(
  parts: readonly BoardPart[],
  edges: readonly BoardEdge[],
  board: Board,
): number {
  const definitionOf = new Map(parts.map((p) => [p.id, p.definition]))
  const placementOf = new Map(board.placements.map((p) => [p.partId, p]))
  const counted = new Set<string>()
  const countEndpoint = (nodeId: string, handleId: string | null | undefined) => {
    if (handleId === null || handleId === undefined) return
    const definition = definitionOf.get(nodeId)
    if (definition === undefined || NOT_A_PART.has(definition)) return
    const placement = placementOf.get(nodeId)
    const padId = padForTerminal(definition, handleId, placement?.footprintId)
    const fp = placement !== undefined ? footprintByPlacement(placement) : undefined
    const onBoard = padId !== undefined && fp?.pads.some((p) => p.id === padId) === true
    if (onBoard) return
    counted.add(`${nodeId}/${handleId}`)
  }
  for (const edge of edges) {
    countEndpoint(edge.source, edge.sourceHandle)
    countEndpoint(edge.target, edge.targetHandle)
  }
  return counted.size
}
