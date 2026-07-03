import { BUILTIN_FOOTPRINTS, type Footprint, footprintBounds } from './footprint.ts'
import { footprintForPart, padForTerminal } from './footprint-assignment.ts'

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
}

/** The board outline (its physical edge), in mm — a rectangle for now. */
export type BoardOutline = { x: number; y: number; w: number; h: number }

export type Board = { outline: BoardOutline; placements: Placement[] }

/** The minimal part shape deriveBoard reads (a schematic node). */
export type BoardPart = { id: string; definition: string }

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
  margin = 2.5,
): Board {
  const placements: Placement[] = []
  let cursorX = 0
  for (const part of parts) {
    const fp = footprintForPart(part.definition)
    if (fp === undefined) continue
    const b = footprintBounds(fp)
    const override = overrides?.get(part.id)
    // Auto spot: the footprint's LEFT edge lands at cursorX, centred on y = 0. The auto row
    // advances even for hand-placed parts, so the others' seeds never reflow under them.
    placements.push({
      partId: part.id,
      footprintId: fp.id,
      x: override?.x ?? cursorX - b.minX,
      y: override?.y ?? -(b.minY + b.maxY) / 2,
      rotation: override?.rotation ?? 0,
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
  }
  return {
    outline: {
      x: minX - margin,
      y: minY - margin,
      w: maxX - minX + 2 * margin,
      h: maxY - minY + 2 * margin,
    },
    placements,
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
 *  and the clearance checks must respect. */
export type PadBox = { net: string; x: number; y: number; w: number; h: number }

export type Ratsnest = { airwires: Airwire[]; padBoxes: PadBox[] }

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
      const padId = padForTerminal(definition, member.terminal)
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
    const padId = padForTerminal(definition, handleId)
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
