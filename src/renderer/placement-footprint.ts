import { applyChipFootprintEdit, resolveChipFootprint } from './chip-footprint.ts'
import {
  type Courtyard,
  type Extent,
  type Footprint,
  type FootprintProvenance,
  isEmptyExtent,
  linesExtent,
  mergeExtent,
  type Pad,
  padsExtent,
  parseProvisionalFootprintId,
  type SilkLine,
} from './footprint.ts'
import {
  applyUserOwnedFootprintEdit,
  footprintForPart,
  isRoleSensitivePart,
  type PadMapVia,
  resolvePadMap,
  terminalHandlesFor,
  userPartPadVia,
} from './footprint-assignment.ts'
import { DEFAULT_COURTYARD_MARGIN_MM, exactMm, slugFootprintId } from './footprint-draft.ts'
import {
  type BoardPart,
  deriveBoard,
  footprintByPlacement,
  type Placement,
  type PlacementOverride,
  padForBoardPart,
  placePoint,
  type Rotation,
} from './pcb-board.ts'
import { footprintProblems } from './user-footprint-validate.ts'
import {
  getUserFootprintsSnapshot,
  isBuiltinFootprintId,
  isUserFootprint,
  registerUserFootprint,
  resolveFootprint,
  setUserFootprints,
} from './user-footprints.ts'

/**
 * Place → footprint re-derive: the reverse of `deriveBoard`. The board is a rotate+translate of
 * footprint geometry; this inverts that transform for one hand placement, so the copper (and body /
 * silk, when the placement carries them) the board shows becomes a USER-OWNED footprint whose local
 * geometry re-places onto exactly the same board spot. The part's assignment is written back only
 * when the new package honestly fits — the same gates `applyUserOwnedFootprintEdit` /
 * `applyChipFootprintEdit` use — and the placement is pinned, so board and part stay in sync.
 *
 * Refuses (named, nothing registered) when the geometry is ambiguous (no pads, empty / duplicate pad
 * ids, overlapping copper, an invalid land), a built-in would be shadowed, a provisional land would
 * lose its label, another user footprint would be overwritten, or a role-sensitive pinout would have
 * to be invented by declaration order. A commit that would leave the part, or another part using
 * the same id, without a terminal's pad — or soldering a terminal to a different pad than the board
 * shows now — rolls the library back. No manufacturer package is invented: an
 * unchanged copy of a cited land keeps that citation, anything else is labeled derived from the board.
 */

/** A placement's copper / body / silk in BOARD millimetres — what the board view draws for it. */
export type PlacedLand = {
  pads: Pad[]
  fabrication: SilkLine[]
  silkscreen: SilkLine[]
}

export type PlacementDeriveRefusalReason =
  | 'bad-placement' // rotation is not a quarter turn, or the position is not finite
  | 'no-pads' // nothing to derive a land from
  | 'ambiguous-pads' // an empty or repeated pad id — a pin could not name one pad
  | 'overlapping-pads' // two pads share copper — which pad a pin solders to is a guess
  | 'invalid-geometry' // the land fails the authored-footprint structural rules
  | 'builtin-shadow' // the target id is a shipped, cited package
  | 'provisional' // the placement is a provisional land, or the target id is one
  | 'id-taken' // a DIFFERENT user footprint already owns the target id
  | 'role-sensitive' // the pin→pad map would be invented by declaration order
  | 'does-not-fit' // the part would not land on the derived package
  | 'terminal-unmapped' // a terminal that had a pad would lose it
  | 'pinout-changed' // a terminal would solder to a different pad than it does on the board now
  | 'breaks-other-parts' // another part on the same user footprint would lose its fit / a pad

export type PlacementDeriveRefusal = {
  ok: false
  reason: PlacementDeriveRefusalReason
  detail: string
  /** A fresh user id to try instead, when the refusal is about a built-in id. */
  suggestedId?: string
  /** Structural problems (`invalid-geometry`). */
  problems?: string[]
  /** Terminals that would lose or change their pad (`terminal-unmapped` / `pinout-changed`). */
  terminals?: string[]
  /** Other parts the edit would break (`breaks-other-parts`). */
  partIds?: string[]
}

export type PlacementDeriveOk = {
  ok: true
  footprint: Footprint
  /** created = a new user id; updated = the placement's own user footprint re-shaped. */
  mode: 'created' | 'updated'
  /** The footprint the placement was using when the land was read. */
  sourceId: string
  /** True when the local geometry equals the source footprint's — a copy, not a reshape. */
  sameGeometry: boolean
}

export type PlacementDeriveResult = PlacementDeriveOk | PlacementDeriveRefusal

export type PlacementCommitOk = PlacementDeriveOk & {
  /** The part with its assignment written back (unchanged when it already pointed here). */
  part: BoardPart
  /** Pin the hand spot to this, so the auto row cannot move the part when the bounds change. */
  pin: PlacementOverride
  /** True when nothing was registered — the land already equals the placement's user footprint. */
  unchanged: boolean
}

export type PlacementCommitResult = PlacementCommitOk | PlacementDeriveRefusal

const QUARTER_TURNS: readonly Rotation[] = [0, 90, 180, 270]
/** Copper overlap slack (mm²): float dust from the transform, not a real overlap. */
const OVERLAP_EPS = 1e-9
const FAB_LABEL_GAP_MM = 0.5

/** mm with float dust removed and −0 folded to 0, so a round trip compares equal. */
const mm = (value: number): number => exactMm(value) + 0

const quarterSwap = (rotation: Rotation): boolean => rotation === 90 || rotation === 270

/** Inverse of `placePoint`: a board point back into the placement's footprint-local frame. */
export function unplacePoint(
  p: Pick<Placement, 'x' | 'y' | 'rotation'>,
  board: { x: number; y: number },
): { x: number; y: number } {
  const dx = board.x - p.x
  const dy = board.y - p.y
  switch (p.rotation) {
    case 0:
      return { x: mm(dx), y: mm(dy) }
    case 90:
      return { x: mm(dy), y: mm(-dx) }
    case 180:
      return { x: mm(-dx), y: mm(-dy) }
    case 270:
      return { x: mm(-dy), y: mm(dx) }
  }
}

function placeLine(p: Placement, line: SilkLine): SilkLine {
  return { from: placePoint(p, line.from), to: placePoint(p, line.to), width: line.width }
}

function unplaceLine(p: Placement, line: SilkLine): SilkLine {
  return { from: unplacePoint(p, line.from), to: unplacePoint(p, line.to), width: line.width }
}

/**
 * What the board shows for a placement, in board mm: every pad turned and moved (a quarter turn swaps
 * the copper's w/h), plus its body and silk lines. undefined when the footprint id does not resolve.
 */
export function placedLandOf(placement: Placement, fp?: Footprint): PlacedLand | undefined {
  const footprint = fp ?? footprintByPlacement(placement)
  if (footprint === undefined) return undefined
  const swap = quarterSwap(placement.rotation)
  return {
    pads: footprint.pads.map((pad) => ({
      ...pad,
      center: placePoint(placement, pad.center),
      size: swap ? { w: pad.size.h, h: pad.size.w } : { ...pad.size },
    })),
    fabrication: footprint.fabrication.map((line) => placeLine(placement, line)),
    silkscreen: footprint.silkscreen.map((line) => placeLine(placement, line)),
  }
}

/** A free user id for a land derived from a built-in placement: `<source>_<designator>`, suffixed. */
export function suggestPlacementFootprintId(placement: Placement): string {
  const base = slugFootprintId(
    `${placement.footprintId}_${placement.designator ?? placement.partId}`,
  )
  const free = (id: string) =>
    id !== '' &&
    !isBuiltinFootprintId(id) &&
    !isUserFootprint(id) &&
    parseProvisionalFootprintId(id) === undefined
  if (free(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}_${String(n)}`
    if (free(candidate)) return candidate
  }
}

function refuse(
  reason: PlacementDeriveRefusalReason,
  detail: string,
  extra: Omit<PlacementDeriveRefusal, 'ok' | 'reason' | 'detail'> = {},
): PlacementDeriveRefusal {
  return { ok: false, reason, detail, ...extra }
}

/** A circular pad is a disc; every other shape is treated as its full rectangle (conservative). */
const isDisc = (pad: Pad): boolean => pad.shape === 'circle' && pad.size.w === pad.size.h

function rectsOverlap(a: Pad, b: Pad): boolean {
  const ox =
    Math.min(a.center.x + a.size.w / 2, b.center.x + b.size.w / 2) -
    Math.max(a.center.x - a.size.w / 2, b.center.x - b.size.w / 2)
  const oy =
    Math.min(a.center.y + a.size.h / 2, b.center.y + b.size.h / 2) -
    Math.max(a.center.y - a.size.h / 2, b.center.y - b.size.h / 2)
  return ox > 0 && oy > 0 && ox * oy > OVERLAP_EPS
}

function discRectOverlap(disc: Pad, rect: Pad): boolean {
  const r = disc.size.w / 2
  const nx = Math.max(
    rect.center.x - rect.size.w / 2,
    Math.min(disc.center.x, rect.center.x + rect.size.w / 2),
  )
  const ny = Math.max(
    rect.center.y - rect.size.h / 2,
    Math.min(disc.center.y, rect.center.y + rect.size.h / 2),
  )
  return Math.hypot(disc.center.x - nx, disc.center.y - ny) < r - 1e-6
}

/** Do two pads share copper? Discs are real circles (a staggered TO-92 row only touches by bbox). */
function padsOverlap(a: Pad, b: Pad): boolean {
  if (isDisc(a) && isDisc(b)) {
    const d = Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y)
    return d < a.size.w / 2 + b.size.w / 2 - 1e-6
  }
  if (isDisc(a)) return discRectOverlap(a, b)
  if (isDisc(b)) return discRectOverlap(b, a)
  return rectsOverlap(a, b)
}

function overlappingPads(pads: readonly Pad[]): [string, string] | undefined {
  for (let i = 0; i < pads.length; i++) {
    const a = pads[i] as Pad
    for (let j = i + 1; j < pads.length; j++) {
      const b = pads[j] as Pad
      if (padsOverlap(a, b)) return [a.id, b.id]
    }
  }
  return undefined
}

const normPad = (pad: Pad): Pad => ({
  ...pad,
  center: { x: mm(pad.center.x), y: mm(pad.center.y) },
  size: { w: mm(pad.size.w), h: mm(pad.size.h) },
})
const normLine = (line: SilkLine): SilkLine => ({
  from: { x: mm(line.from.x), y: mm(line.from.y) },
  to: { x: mm(line.to.x), y: mm(line.to.y) },
  width: line.width,
})
const sameLines = (a: readonly SilkLine[], b: readonly SilkLine[]): boolean =>
  JSON.stringify(a.map(normLine)) === JSON.stringify(b.map(normLine))
const samePads = (a: readonly Pad[], b: readonly Pad[]): boolean =>
  JSON.stringify(a.map(normPad)) === JSON.stringify(b.map(normPad))

function encloses(court: Courtyard, extent: Extent): boolean {
  const eps = 1e-6
  return (
    extent.minX >= court.x - eps &&
    extent.minY >= court.y - eps &&
    extent.maxX <= court.x + court.w + eps &&
    extent.maxY <= court.y + court.h + eps
  )
}

const fullyExplicitOrNamed = (via: ReadonlyMap<string, PadMapVia>, ids: readonly string[]) =>
  ids.every((id) => {
    const how = via.get(id)
    return how === 'pin.pad' || how === 'pad-name'
  })

/**
 * The pure half: invert one placement's land into a candidate user footprint, or a named refusal.
 * Registers nothing. `targetId` defaults to the placement's own footprint when that is user-owned;
 * a built-in placement must be given a fresh id (the refusal carries a suggestion).
 */
export function deriveFootprintFromPlacement(args: {
  part: BoardPart
  placement: Placement
  land: PlacedLand
  targetId?: string
  name?: string
}): PlacementDeriveResult {
  const { part, placement, land } = args
  if (
    !QUARTER_TURNS.includes(placement.rotation) ||
    !Number.isFinite(placement.x) ||
    !Number.isFinite(placement.y)
  ) {
    return refuse(
      'bad-placement',
      'Only a finite position and a 0/90/180/270° turn can be inverted into a footprint frame.',
    )
  }
  const sourceId = placement.footprintId
  const source = resolveFootprint(sourceId)
  if (source?.provisional === true || parseProvisionalFootprintId(sourceId) !== undefined) {
    return refuse(
      'provisional',
      `${sourceId} is a provisional land — it stays generated and labeled provisional, not a user package. Author a real package instead.`,
    )
  }
  const explicit = args.targetId?.trim()
  if (explicit !== undefined && parseProvisionalFootprintId(explicit) !== undefined) {
    return refuse(
      'provisional',
      `"${explicit}" is a provisional land id — those stay generated and labeled provisional.`,
    )
  }
  if (part.chipPins === undefined && part.chipRoleSensitive !== true) {
    // A built-in role-sensitive kind never takes a package without explicit pin→pad data.
    if (isRoleSensitivePart(part.definition) && terminalHandlesFor(part.definition) === undefined) {
      return refuse(
        'role-sensitive',
        `${part.definition} has a role-sensitive pinout and no explicit pin→pad data — a land from its placement would invent the manufacturer pinout.`,
      )
    }
  }

  const targetId =
    explicit !== undefined && explicit !== ''
      ? explicit
      : isUserFootprint(sourceId)
        ? sourceId
        : undefined
  if (targetId === undefined || isBuiltinFootprintId(targetId)) {
    return refuse(
      'builtin-shadow',
      `${targetId ?? sourceId} is a built-in package — re-deriving onto it would shadow a cited footprint other parts rely on. Save the placement under a new id.`,
      { suggestedId: suggestPlacementFootprintId(placement) },
    )
  }
  if (targetId !== sourceId && isUserFootprint(targetId)) {
    return refuse(
      'id-taken',
      `"${targetId}" is another user footprint — re-deriving would silently re-shape it. Choose a new id.`,
      { suggestedId: suggestPlacementFootprintId(placement) },
    )
  }
  const mode: PlacementDeriveOk['mode'] = isUserFootprint(targetId) ? 'updated' : 'created'

  if (land.pads.length === 0) {
    return refuse('no-pads', 'The placement has no copper — there is no land to derive.')
  }
  const ids = land.pads.map((pad) => (typeof pad.id === 'string' ? pad.id.trim() : ''))
  if (ids.some((id) => id === '')) {
    return refuse('ambiguous-pads', 'Every pad needs a name/number before a pin can map to it.')
  }
  const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))]
  if (dupes.length > 0) {
    return refuse(
      'ambiguous-pads',
      `Pad names repeat (${dupes.join(', ')}) — a pin could not name one pad.`,
    )
  }

  const swap = quarterSwap(placement.rotation)
  const pads: Pad[] = land.pads.map((pad) => ({
    ...pad,
    id: pad.id.trim(),
    center: unplacePoint(placement, pad.center),
    size: swap
      ? { w: mm(pad.size.h), h: mm(pad.size.w) }
      : { w: mm(pad.size.w), h: mm(pad.size.h) },
  }))
  const finitePads = pads.every(
    (pad) =>
      Number.isFinite(pad.center.x) &&
      Number.isFinite(pad.center.y) &&
      Number.isFinite(pad.size.w) &&
      Number.isFinite(pad.size.h),
  )
  const overlap = finitePads ? overlappingPads(pads) : undefined
  if (overlap !== undefined) {
    return refuse(
      'overlapping-pads',
      `Pads ${overlap[0]} and ${overlap[1]} share copper — which pad a pin solders to would be a guess.`,
    )
  }
  const fabrication = land.fabrication.map((line) => unplaceLine(placement, line))
  const silkscreen = land.silkscreen.map((line) => unplaceLine(placement, line))

  const sameGeometry =
    source !== undefined &&
    samePads(pads, source.pads) &&
    sameLines(fabrication, source.fabrication) &&
    sameLines(silkscreen, source.silkscreen)

  const copperAndBody =
    fabrication.length > 0
      ? mergeExtent(padsExtent(pads), linesExtent(fabrication))
      : padsExtent(pads)
  const keepSourceCourt =
    source !== undefined &&
    !isEmptyExtent(copperAndBody) &&
    encloses(source.courtyard, copperAndBody)
  const courtyard: Courtyard =
    keepSourceCourt && source !== undefined
      ? { ...source.courtyard }
      : isEmptyExtent(copperAndBody)
        ? { x: -1, y: -1, w: 2, h: 2 }
        : {
            x: mm(copperAndBody.minX - DEFAULT_COURTYARD_MARGIN_MM),
            y: mm(copperAndBody.minY - DEFAULT_COURTYARD_MARGIN_MM),
            w: mm(copperAndBody.maxX - copperAndBody.minX + 2 * DEFAULT_COURTYARD_MARGIN_MM),
            h: mm(copperAndBody.maxY - copperAndBody.minY + 2 * DEFAULT_COURTYARD_MARGIN_MM),
          }
  const copper = padsExtent(pads)
  const labels =
    keepSourceCourt && source !== undefined
      ? {
          reference: { ...source.labels.reference },
          value: { ...source.labels.value },
          fabReference: { ...source.labels.fabReference },
        }
      : {
          reference: { x: 0, y: mm(courtyard.y - FAB_LABEL_GAP_MM) },
          value: { x: 0, y: mm(courtyard.y + courtyard.h + FAB_LABEL_GAP_MM) },
          fabReference: isEmptyExtent(copper)
            ? { x: 0, y: 0 }
            : { x: mm((copper.minX + copper.maxX) / 2), y: mm((copper.minY + copper.maxY) / 2) },
        }

  const who = placement.designator ?? placement.partId
  const provenance: FootprintProvenance =
    sameGeometry && source !== undefined
      ? {
          ...source.provenance,
          notes: [
            source.provenance.notes,
            `Re-derived from the board placement of ${who}; copper and body identical to ${sourceId}.`,
          ]
            .filter((n): n is string => n !== undefined && n !== '')
            .join(' '),
        }
      : {
          source_type: 'derived',
          title: `Derived from the board placement of ${who}`,
          citation: `Inverse of the placement transform (x ${String(placement.x)} mm, y ${String(placement.y)} mm, ${String(placement.rotation)}°) applied to the board copper${fabrication.length > 0 ? ' and body outline' : ''} of ${sourceId}. Not a manufacturer drawing.`,
          confidence: 'low',
          notes: 'Board-derived land — not a manufacturer package.',
        }

  const defaultName =
    mode === 'updated' && source !== undefined
      ? source.name
      : sameGeometry && source !== undefined
        ? `${source.name} (from ${who})`
        : `Placed land (${who})`
  const description =
    mode === 'updated' && source !== undefined && sameGeometry
      ? source.description
      : sameGeometry && source !== undefined
        ? `User copy of ${sourceId}, re-derived from the board placement of ${who}.`
        : `Land re-derived from the board placement of ${who}. Not a manufacturer package.`

  const footprint: Footprint = {
    id: targetId,
    name: args.name?.trim() || defaultName,
    description,
    pads,
    silkscreen,
    fabrication,
    labels,
    courtyard,
    provenance,
    // The 3-D body is the physical part's — only an unchanged copy may keep it.
    ...(sameGeometry && source?.body3d !== undefined ? { body3d: source.body3d } : {}),
  }
  const problems = footprintProblems(footprint)
  if (problems.length > 0) {
    return refuse('invalid-geometry', `The derived land is not placeable: ${problems[0]}`, {
      problems,
    })
  }

  // Role-sensitive pins must land by explicit pin.pad or a unique pad-name match on the new land —
  // never by declaration order (that would invent the manufacturer pinout).
  if (part.chipPins !== undefined && part.chipRoleSensitive === true) {
    const mapped = resolvePadMap(part.chipPins, footprint)
    if (
      mapped.failures.length > 0 ||
      !fullyExplicitOrNamed(
        mapped.via,
        part.chipPins.map((p) => p.id),
      )
    ) {
      return refuse(
        'role-sensitive',
        'Role-sensitive chip pins need explicit pin.pad or unique pad-name matches on the derived land — declaration order would invent the pinout.',
      )
    }
  } else if (part.chipPins === undefined && isRoleSensitivePart(part.definition)) {
    const mapped = userPartPadVia(part.definition, footprint)
    const pinIds = terminalHandlesFor(part.definition) ?? []
    if (
      mapped === undefined ||
      mapped.failures.length > 0 ||
      !fullyExplicitOrNamed(mapped.via, pinIds)
    ) {
      return refuse(
        'role-sensitive',
        `${part.definition} is role-sensitive — its pins need explicit pin.pad or unique pad-name matches on the derived land, not declaration order.`,
      )
    }
  }

  return { ok: true, footprint, mode, sourceId, sameGeometry }
}

/** terminal → pad for `part` on footprint `id`, only where that pad really exists (registry as-is). */
function mappedTerminals(part: BoardPart, id: string | undefined): Map<string, string> {
  const out = new Map<string, string>()
  if (id === undefined) return out
  const fp = resolveFootprint(id)
  if (fp === undefined) return out
  const handles =
    part.chipPins !== undefined
      ? part.chipPins.map((p) => p.id)
      : (terminalHandlesFor(part.definition) ?? [])
  for (const handle of handles) {
    const pad = padForBoardPart(part, handle, id)
    if (pad !== undefined && fp.pads.some((p) => p.id === pad)) out.set(handle, pad)
  }
  return out
}

/** Terminals that lost their pad, and terminals now on a different pad. */
function pinoutDrift(
  was: ReadonlyMap<string, string>,
  now: ReadonlyMap<string, string>,
): { lost: string[]; changed: string[] } {
  const lost: string[] = []
  const changed: string[] = []
  for (const [handle, pad] of was) {
    const next = now.get(handle)
    if (next === undefined) lost.push(handle)
    else if (next !== pad) changed.push(handle)
  }
  return { lost, changed }
}

/** The footprint id this part actually lands on (chip author-or-derive or the catalog join). */
function landedId(part: BoardPart): string | undefined {
  return deriveBoard([part]).placements[0]?.footprintId
}

/**
 * Derive, register, and write back — or refuse and leave the library exactly as it was. A part is
 * only re-pointed when the land fits it by the same gate the board uses; every terminal that had a
 * pad keeps one; and when the placement's own user footprint is re-shaped, every OTHER part using
 * that id (`otherParts`) must still fit with no lost pad, since they pick the edit up too.
 */
export function commitPlacementFootprint(args: {
  part: BoardPart
  placement: Placement
  land: PlacedLand
  targetId?: string
  name?: string
  otherParts?: readonly BoardPart[]
}): PlacementCommitResult {
  const derived = deriveFootprintFromPlacement(args)
  if (!derived.ok) return derived
  const { part, placement } = args
  const { footprint } = derived
  const id = footprint.id
  const pin: PlacementOverride = { x: placement.x, y: placement.y, rotation: placement.rotation }

  const existing = derived.mode === 'updated' ? resolveFootprint(id) : undefined
  if (
    existing !== undefined &&
    derived.sameGeometry &&
    part.footprintId === id &&
    landedId(part) === id
  ) {
    return { ...derived, footprint: existing, part, pin, unchanged: true }
  }

  // Before-state: what the part and the other users of this id can solder today.
  const before = mappedTerminals(part, placement.footprintId)
  const others = (args.otherParts ?? []).filter(
    (o) => o.id !== part.id && derived.mode === 'updated' && landedId(o) === id,
  )
  const othersBefore = new Map(others.map((o) => [o.id, mappedTerminals(o, id)]))

  const snapshot = [...getUserFootprintsSnapshot()]
  const rollback = (refusal: PlacementDeriveRefusal): PlacementDeriveRefusal => {
    setUserFootprints(snapshot)
    return refusal
  }
  if (!registerUserFootprint(footprint)) {
    return rollback(
      refuse(
        'builtin-shadow',
        `"${id}" is reserved — it cannot be registered as a user footprint.`,
      ),
    )
  }

  let next: BoardPart
  if (part.chipPins !== undefined) {
    const resolved = resolveChipFootprint({
      pins: part.chipPins,
      authoredId: id,
      roleSensitive: part.chipRoleSensitive === true,
    })
    if (!resolved.ok || resolved.source !== 'authored' || resolved.footprint.id !== id) {
      const roleSensitive = !resolved.ok && resolved.reason === 'role-sensitive'
      return rollback(
        refuse(
          roleSensitive ? 'role-sensitive' : 'does-not-fit',
          resolved.ok
            ? `${part.id} would not land on ${id}.`
            : `${part.id} would not land on ${id}: ${resolved.detail}`,
        ),
      )
    }
    next = applyChipFootprintEdit(part, part.chipPins, footprint, {
      roleSensitive: part.chipRoleSensitive === true,
    })
  } else {
    const placed = footprintForPart(part.definition, id)
    if (placed === undefined || placed.id !== id || placed.provisional === true) {
      return rollback(
        refuse(
          'does-not-fit',
          `${part.id} (${part.definition}) would not land on ${id} — the pad count or pin map does not fit, so the assignment stays as it was.`,
        ),
      )
    }
    next = applyUserOwnedFootprintEdit(part, footprint)
  }
  if (landedId(next) !== id) {
    return rollback(
      refuse('does-not-fit', `The board would not place ${part.id} on ${id} after write-back.`),
    )
  }
  const drift = pinoutDrift(before, mappedTerminals(next, id))
  if (drift.lost.length > 0) {
    return rollback(
      refuse(
        'terminal-unmapped',
        `On ${id}, ${part.id} would lose the pad for ${drift.lost.join(', ')} — refusing rather than dropping a soldered pin.`,
        { terminals: drift.lost },
      ),
    )
  }
  if (drift.changed.length > 0) {
    return rollback(
      refuse(
        'pinout-changed',
        `On ${id}, ${part.id} would solder ${drift.changed.join(', ')} to a different pad than the board shows now — a package-specific pinout is not carried to a new id, so this is refused rather than silently re-pinned.`,
        { terminals: drift.changed },
      ),
    )
  }
  const broken = others
    .filter((o) => {
      if (landedId(o) !== id) return true
      const drift = pinoutDrift(othersBefore.get(o.id) ?? new Map(), mappedTerminals(o, id))
      return drift.lost.length > 0 || drift.changed.length > 0
    })
    .map((o) => o.id)
  if (broken.length > 0) {
    return rollback(
      refuse(
        'breaks-other-parts',
        `${id} is shared — re-shaping it would break ${broken.join(', ')}. Save the placement under a new id instead.`,
        { partIds: broken, suggestedId: suggestPlacementFootprintId(placement) },
      ),
    )
  }
  return { ...derived, part: next, pin, unchanged: false }
}
