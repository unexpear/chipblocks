import { type Pad, parseProvisionalFootprintId } from './footprint.ts'
import { exactMm } from './footprint-draft.ts'
import { type BoardPart, deriveBoard, footprintByPlacement, type Placement } from './pcb-board.ts'
import {
  commitPlacementFootprint,
  deriveFootprintFromPlacement,
  type PlacedLand,
  type PlacementCommitOk,
  type PlacementDeriveRefusal,
  type PlacementDeriveRefusalReason,
  placedLandOf,
  suggestPlacementFootprintId,
} from './placement-footprint.ts'
import { isUserFootprint } from './user-footprints.ts'

/**
 * Board-side per-pad editing: change ONE pad's copper on a placed part — its centre and size as the
 * board shows them (board mm, board axes), or a quarter turn — and feed the edited land through the
 * place → footprint re-derive (`commitPlacementFootprint`). So the edit lands in the placement's own
 * USER-OWNED footprint, re-placed onto the same spot, behind every gate that path already has.
 *
 * Only user-owned lands are edited in place. Refused with a named reason, nothing registered:
 * a built-in package (`builtin-shadow` — fork it with "Footprint from placement" first; the refusal
 * carries the suggested id), a provisional land (`provisional` — it stays generated and labeled), a
 * role-sensitive pinout that would lean on declaration order (`role-sensitive`), and everything the
 * re-derive refuses (overlapping copper, an invalid land, a terminal losing or changing its pad, a
 * shared id that would stop fitting another part). Pad ids are never renamed here, so the pin → pad
 * map a part already has is carried, not re-invented. A pad has no free angle in this model: a turn is
 * a quarter turn (copper w/h swap), nothing else.
 */

/** One pad's new geometry in BOARD mm. Absent fields keep their current value. */
export type PlacedPadEdit = {
  padId: string
  /** New copper centre on the board (mm). */
  x?: number
  y?: number
  /** New copper extent along the board's x / y axes (mm). */
  w?: number
  h?: number
  /** Turn the pad a quarter turn about its own centre (its board w/h swap). */
  quarterTurn?: boolean
}

export type PadEditRefusalReason =
  | PlacementDeriveRefusalReason
  | 'not-placed' // the placement's footprint does not resolve — no board land to edit
  | 'pad-not-found' // no pad with that id on this placement
  | 'bad-pad-edit' // a non-finite / non-positive value, or a circle pad given two diameters

export type PadEditRefusal = Omit<PlacementDeriveRefusal, 'reason'> & {
  reason: PadEditRefusalReason
}

export type PadEditOk = PlacementCommitOk & {
  padId: string
  /** Other parts placed on the same user footprint — they pick the edited copper up too. */
  sharedWith: string[]
}

export type PadEditResult = PadEditOk | PadEditRefusal

const mm = (value: number): number => exactMm(value) + 0

function refuse(
  reason: PadEditRefusalReason,
  detail: string,
  extra: Omit<PadEditRefusal, 'ok' | 'reason' | 'detail'> = {},
): PadEditRefusal {
  return { ok: false, reason, detail, ...extra }
}

/**
 * Can this placement's pads be edited on the board at all? undefined = yes; otherwise the named
 * refusal the edit would hit before any geometry is read. Pure — registers nothing. Used by the
 * inspector to say WHY up front, and by `commitPlacementPadEdit` as its first gate.
 */
export function placementPadEditGate(
  part: BoardPart,
  placement: Placement,
): PadEditRefusal | undefined {
  const fp = footprintByPlacement(placement)
  const land = fp !== undefined ? placedLandOf(placement, fp) : undefined
  if (fp === undefined || land === undefined) {
    return refuse(
      'not-placed',
      `${placement.footprintId} does not resolve — no board land to edit.`,
    )
  }
  if (fp.provisional === true || parseProvisionalFootprintId(fp.id) !== undefined) {
    return refuse(
      'provisional',
      `${fp.id} is a provisional land — it stays generated and labeled provisional, so its pads are not hand-edited. Author a real package instead.`,
    )
  }
  if (!isUserFootprint(fp.id)) {
    const suggestedId = suggestPlacementFootprintId(placement)
    return refuse(
      'builtin-shadow',
      `${fp.id} is a built-in, cited package — its pads are not edited in place. Use “Footprint from placement” to copy it under ${suggestedId} first, then edit the copy.`,
      { suggestedId },
    )
  }
  // The unedited land through the re-derive's pure gates: role-sensitive pinouts (and anything else
  // that already refuses) refuse here before a pad moves.
  const dry = deriveFootprintFromPlacement({ part, placement, land })
  return dry.ok ? undefined : dry
}

/**
 * Apply one pad edit to a board land. Pure. The pad keeps its id, shape, type, drill and flags; only
 * centre and size change. A circle pad must stay a circle (one diameter) — change its shape in the
 * footprint editor instead.
 */
export function editPlacedLand(
  land: PlacedLand,
  edit: PlacedPadEdit,
): { ok: true; land: PlacedLand; pad: Pad } | PadEditRefusal {
  const index = land.pads.findIndex((p) => p.id === edit.padId)
  const pad = land.pads[index]
  if (pad === undefined) {
    return refuse('pad-not-found', `No pad "${edit.padId}" on this placement.`)
  }
  for (const key of ['x', 'y', 'w', 'h'] as const) {
    const v = edit[key]
    if (v !== undefined && !Number.isFinite(v)) {
      return refuse('bad-pad-edit', `Pad ${pad.id}: ${key} must be a finite number of mm.`)
    }
  }
  let w = edit.w ?? pad.size.w
  let h = edit.h ?? pad.size.h
  if (w <= 0 || h <= 0) {
    return refuse('bad-pad-edit', `Pad ${pad.id}: copper width and height must be above 0 mm.`)
  }
  if (edit.quarterTurn === true) [w, h] = [h, w]
  if (pad.shape === 'circle' && mm(w) !== mm(h)) {
    return refuse(
      'bad-pad-edit',
      `Pad ${pad.id} is a circle — it has one diameter, so w and h must match. Change its shape in the footprint editor for an oval.`,
    )
  }
  const next: Pad = {
    ...pad,
    center: { x: mm(edit.x ?? pad.center.x), y: mm(edit.y ?? pad.center.y) },
    size: { w: mm(w), h: mm(h) },
  }
  const pads = land.pads.map((p, i) => (i === index ? next : p))
  return { ok: true, land: { ...land, pads }, pad: next }
}

/**
 * Edit one pad of a placement on the board and write it into the placement's user-owned footprint
 * via `commitPlacementFootprint` — or refuse, leaving the library exactly as it was. `otherParts` are
 * the rest of the design: a shared id must still fit every part using it, and the ok result names them.
 */
export function commitPlacementPadEdit(args: {
  part: BoardPart
  placement: Placement
  edit: PlacedPadEdit
  otherParts?: readonly BoardPart[]
}): PadEditResult {
  const { part, placement, edit } = args
  const gate = placementPadEditGate(part, placement)
  if (gate !== undefined) return gate
  const land = placedLandOf(placement)
  if (land === undefined) {
    return refuse(
      'not-placed',
      `${placement.footprintId} does not resolve — no board land to edit.`,
    )
  }
  const edited = editPlacedLand(land, edit)
  if (!edited.ok) return edited
  const result = commitPlacementFootprint({
    part,
    placement,
    land: edited.land,
    ...(args.otherParts !== undefined ? { otherParts: args.otherParts } : {}),
  })
  if (!result.ok) return result
  const id = result.footprint.id
  const sharedWith = (args.otherParts ?? [])
    .filter((o) => o.id !== part.id && deriveBoard([o]).placements[0]?.footprintId === id)
    .map((o) => o.id)
  return { ...result, padId: edited.pad.id, sharedWith }
}
