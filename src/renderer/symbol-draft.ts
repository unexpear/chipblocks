/**
 * The model behind the SYMBOL EDITOR — everything the editor does to a drawing, as plain functions with no
 * React in sight, so what decides where a pin (and so a wire) lands is testable on its own. The footprint
 * editor's pattern: footprint-draft.ts is to footprint-editor.tsx what this file is to symbol-editor.tsx.
 *
 * A draft keeps the drawing and the part's pins together, one row per pin, because the editor edits both:
 * the shapes and where each pin sits, and also what a pin IS — its name, the pad number it solders to, its
 * type, and which way it points. It never touches a pin's id or its place in the list: those are the
 * contract the wires, the behaviour mapping, the internal circuit and the board's pads all key off.
 *
 * Coordinates are px in the drawing's own space, as in symbol-geometry.ts. Drags snap to a grid; numbers
 * typed into the side panel are kept exactly as typed (the footprint editor's rule — a snapped typed value
 * is a different value).
 */

import {
  EMPTY_EXTENT,
  type Extent,
  extentOfPoints,
  isEmptyExtent,
  mergeExtent,
} from './footprint.ts'
import {
  BODY_STROKE_WIDTH,
  type DrawnSymbol,
  drawnSymbolBox,
  graphicInk,
  mapGraphicPoints,
  pinInward,
  pinRoot,
  SCHEMATIC_GRID_PX,
  SCHEMATIC_MINOR_GRID_PX,
  type SymbolFieldKey,
  type SymbolFields,
  type SymbolGraphic,
  type SymbolPin,
  type SymbolPinStyle,
  type SymbolPoint,
  shapeReach,
} from './symbol-geometry.ts'
import { mintPinIds } from './user-part-draft.ts'
import { validateUserPart } from './user-part-validate.ts'
import {
  type PinElectrical,
  type PinSide,
  type UserPart,
  type UserPin,
  userPartGeometry,
} from './user-parts.ts'
import { symbolProblems } from './user-symbol-validate.ts'

/** A new pin's length: one grid step — KiCad's 100 mil default, on this schematic's scale. */
export const DEFAULT_PIN_LENGTH = SCHEMATIC_GRID_PX
/** A new piece of text: half a grid step tall — KiCad's 50 mil default, on the same scale. */
export const DEFAULT_TEXT_SIZE = SCHEMATIC_GRID_PX / 2
/** How far the reference and value fields sit off the drawing when the editor places them. */
const FIELD_GAP = 12
/** What a blank drawing frames its fields around, before anything is drawn. */
const BLANK_FRAME: Extent = { minX: -40, minY: -40, maxX: 40, maxY: 40 }

/**
 * A pin as the editor is handed it: a saved part's own pin (its key IS its id), or a row of the New Part
 * form (its key is the row's), which only gets an id when that part is saved.
 */
export type SymbolEditorPin = {
  key: string
  name: string
  side: PinSide
  electrical: PinElectrical
  /** The footprint pad it solders to, as the package labels it; '' = worked out by name, then order. */
  pad: string
}

/** Where a pin is drawn. */
export type PinPlacement = {
  at: SymbolPoint
  length: number
  style: SymbolPinStyle
  hideName: boolean
  hideNumber: boolean
}

export type DraftPin = SymbolEditorPin & {
  /** Added in this editor, so it may be taken away again. The part's own pins can't be. */
  added: boolean
  /** null until it is put on the drawing. */
  placed: PinPlacement | null
}

export type SymbolDraft = {
  graphics: SymbolGraphic[]
  pins: DraftPin[]
  fields: SymbolFields
  /** The part's datasheet — the text of the Datasheet field. */
  datasheet: string
}

/** What the editor hands back: every pin in order (any it added come last), the drawing keyed by pin key. */
export type SymbolEditResult = { pins: SymbolEditorPin[]; symbol: DrawnSymbol; datasheet: string }

/** Something on the drawing that can be selected, moved, turned or deleted. */
export type SymbolTarget =
  | { kind: 'graphic'; index: number }
  | { kind: 'pin'; key: string }
  | { kind: 'field'; key: SymbolFieldKey }

type PinSource = SymbolEditorPin & { added?: boolean }

/** A value from the user's typing, with only floating-point dust removed — never snapped. */
export function exactPx(value: number): number {
  const clean = Number(value.toFixed(6))
  return clean === 0 ? 0 : clean
}

/** A mouse position rounded to a grid. For drags only: a typed value stays exactly what was typed. */
export function snapPx(value: number, grid: number): number {
  return exactPx(Math.round(value / grid) * grid)
}

export function snapPoint(point: SymbolPoint, grid: number): SymbolPoint {
  return { x: snapPx(point.x, grid), y: snapPx(point.y, grid) }
}

export const samePoint = (a: SymbolPoint, b: SymbolPoint) => a.x === b.x && a.y === b.y

const draftPin = (pin: PinSource, placed: PinPlacement | null): DraftPin => ({
  key: pin.key,
  name: pin.name,
  side: pin.side,
  electrical: pin.electrical,
  pad: pin.pad,
  added: pin.added === true,
  placed,
})

/** The reference above the drawing and the value below it; footprint and datasheet hidden under that. */
function fieldsAround(frame: Extent): SymbolFields {
  const x = (frame.minX + frame.maxX) / 2
  return {
    reference: { at: { x, y: frame.minY - FIELD_GAP }, visible: true },
    value: { at: { x, y: frame.maxY + FIELD_GAP }, visible: true },
    footprint: { at: { x, y: frame.maxY + 2 * FIELD_GAP }, visible: false },
    datasheet: { at: { x, y: frame.maxY + 3 * FIELD_GAP }, visible: false },
  }
}

/** Nothing drawn yet: every pin waits to be put down. */
export function blankSymbolDraft(pins: readonly PinSource[], datasheet: string): SymbolDraft {
  return {
    graphics: [],
    pins: pins.map((pin) => draftPin(pin, null)),
    fields: fieldsAround(BLANK_FRAME),
    datasheet,
  }
}

function placementOf(pin: SymbolPin | undefined): PinPlacement | null {
  if (pin === undefined) return null
  return {
    at: pin.at,
    length: pin.length,
    style: pin.style,
    hideName: pin.hideName === true,
    hideNumber: pin.hideNumber === true,
  }
}

/** A drawing reopened for editing. A pin the drawing doesn't show yet (added since) waits to be put down. */
export function draftFromSymbol(
  pins: readonly PinSource[],
  symbol: DrawnSymbol,
  datasheet: string,
): SymbolDraft {
  const drawn = new Map(symbol.pins.map((p) => [p.pin, p]))
  return {
    graphics: [...symbol.graphics],
    pins: pins.map((pin) => draftPin(pin, placementOf(drawn.get(pin.key)))),
    fields: symbol.fields,
    datasheet,
  }
}

/**
 * The plain labelled box the part draws as today, turned into a drawing to reshape: the same body, and
 * every pin tip on exactly the spot its wire lands now, so nothing already wired moves. The name the box
 * prints in its middle becomes the Value field there — it shows the part's name, and follows a rename.
 */
export function draftFromBox(
  pins: readonly PinSource[],
  partName: string,
  datasheet: string,
): SymbolDraft {
  const box = userPartGeometry({
    id: '',
    name: partName,
    designatorPrefix: '',
    pins: pins.map((p) => ({ id: p.key, name: p.name, side: p.side, electrical: p.electrical })),
  })
  const { body } = box
  const boxPin = new Map(box.pins.map((p) => [p.id, p]))
  const middleX = body.x + body.width / 2
  return {
    graphics: [
      {
        kind: 'rectangle',
        start: { x: body.x, y: body.y },
        end: { x: body.x + body.width, y: body.y + body.height },
        strokeWidth: BODY_STROKE_WIDTH,
        fill: 'background',
      },
    ],
    pins: pins.map((pin) => {
      const placed = boxPin.get(pin.key)
      if (placed === undefined) return draftPin(pin, null)
      return draftPin(pin, {
        at: { x: placed.tipX, y: placed.tipY },
        length: Math.hypot(placed.rootX - placed.tipX, placed.rootY - placed.tipY),
        style: 'line',
        hideName: false,
        hideNumber: false,
      })
    }),
    fields: {
      reference: { at: { x: middleX, y: -FIELD_GAP }, visible: true },
      value: { at: { x: middleX, y: body.y + body.height / 2 }, visible: true },
      footprint: { at: { x: middleX, y: box.height + FIELD_GAP }, visible: false },
      datasheet: { at: { x: middleX, y: box.height + 2 * FIELD_GAP }, visible: false },
    },
    datasheet,
  }
}

/** The part's pins as the editor is handed them. */
export function editorPinsOf(part: UserPart): SymbolEditorPin[] {
  return part.pins.map((p) => ({
    key: p.id,
    name: p.name,
    side: p.side,
    electrical: p.electrical,
    pad: p.pad ?? '',
  }))
}

/** The pins as the validator reads them — the key standing in for the id until the part is saved. */
export function draftPartPins(draft: SymbolDraft): Pick<UserPin, 'id' | 'name' | 'side'>[] {
  return draft.pins.map((p) => ({ id: p.key, name: p.name, side: p.side }))
}

/** The drawing the draft holds, its pins keyed by pin key, in the part's pin order. */
export function draftSymbol(draft: SymbolDraft): DrawnSymbol {
  const pins: SymbolPin[] = []
  for (const pin of draft.pins) {
    if (pin.placed === null) continue
    pins.push({
      pin: pin.key,
      at: pin.placed.at,
      length: pin.placed.length,
      style: pin.placed.style,
      ...(pin.placed.hideName ? { hideName: true } : {}),
      ...(pin.placed.hideNumber ? { hideNumber: true } : {}),
    })
  }
  return { graphics: draft.graphics, pins, fields: draft.fields }
}

/** Every problem with the draft — the file loader's own list, so what saves is what reloads. */
export function symbolDraftProblems(draft: SymbolDraft): string[] {
  return symbolProblems(draftSymbol(draft), draftPartPins(draft))
}

export function draftResult(draft: SymbolDraft): SymbolEditResult {
  return {
    pins: draft.pins.map(({ key, name, side, electrical, pad }) => ({
      key,
      name,
      side,
      electrical,
      pad,
    })),
    symbol: draftSymbol(draft),
    datasheet: draft.datasheet,
  }
}

export const hasDrawing = (draft: SymbolDraft) =>
  draft.graphics.length > 0 || draft.pins.some((p) => p.placed !== null)

/** The node box the drawing will be placed in — where its wires land. null while nothing is drawn. */
export function draftBox(draft: SymbolDraft): Extent | null {
  if (!hasDrawing(draft)) return null
  return drawnSymbolBox(draftSymbol(draft), new Map(draft.pins.map((p) => [p.key, p.side])))
}

/** Everything the editor should keep in view: the drawing, its pins and its fields. null when empty. */
export function draftExtent(draft: SymbolDraft): Extent | null {
  if (!hasDrawing(draft)) return null
  let extent = EMPTY_EXTENT
  for (const graphic of draft.graphics) extent = mergeExtent(extent, graphicInk(graphic))
  for (const pin of draft.pins) {
    if (pin.placed === null) continue
    extent = mergeExtent(extent, extentOfPoints([pin.placed.at, pinRoot(pin.placed, pin.side)]))
  }
  extent = mergeExtent(extent, extentOfPoints(Object.values(draft.fields).map((f) => f.at)))
  return isEmptyExtent(extent) ? null : extent
}

// ── shapes ────────────────────────────────────────────────────────────────────────────────────────────

export const newPolyline = (points: SymbolPoint[]): SymbolGraphic => ({
  kind: 'polyline',
  points,
  strokeWidth: BODY_STROKE_WIDTH,
  fill: 'none',
})
/** A rectangle is usually a chip's body, so it starts filled with the body colour, as the plain box is. */
export const newRectangle = (start: SymbolPoint, end: SymbolPoint): SymbolGraphic => ({
  kind: 'rectangle',
  start,
  end,
  strokeWidth: BODY_STROKE_WIDTH,
  fill: 'background',
})
export const newCircle = (center: SymbolPoint, radius: number): SymbolGraphic => ({
  kind: 'circle',
  center,
  radius,
  strokeWidth: BODY_STROKE_WIDTH,
  fill: 'none',
})
export const newArc = (start: SymbolPoint, mid: SymbolPoint, end: SymbolPoint): SymbolGraphic => ({
  kind: 'arc',
  start,
  mid,
  end,
  strokeWidth: BODY_STROKE_WIDTH,
  fill: 'none',
})
export const newText = (at: SymbolPoint): SymbolGraphic => ({
  kind: 'text',
  at,
  text: 'Text',
  size: DEFAULT_TEXT_SIZE,
})

export function addGraphic(draft: SymbolDraft, graphic: SymbolGraphic): SymbolDraft {
  return { ...draft, graphics: [...draft.graphics, graphic] }
}

export function updateGraphic(
  draft: SymbolDraft,
  index: number,
  change: (graphic: SymbolGraphic) => SymbolGraphic,
): SymbolDraft {
  const current = draft.graphics[index]
  if (current === undefined) return draft
  const next = change(current)
  if (next === current) return draft
  return { ...draft, graphics: draft.graphics.map((g, i) => (i === index ? next : g)) }
}

/** A point on a selected shape that can be dragged to reshape it. */
export type GraphicHandle = { id: string; at: SymbolPoint }

export function graphicHandles(graphic: SymbolGraphic): GraphicHandle[] {
  switch (graphic.kind) {
    case 'polyline':
      return graphic.points.map((at, i) => ({ id: `point:${i}`, at }))
    case 'rectangle':
      return [
        { id: 'start', at: graphic.start },
        { id: 'end', at: graphic.end },
      ]
    case 'circle':
      return [{ id: 'radius', at: { x: graphic.center.x + graphic.radius, y: graphic.center.y } }]
    case 'arc':
      return [
        { id: 'start', at: graphic.start },
        { id: 'mid', at: graphic.mid },
        { id: 'end', at: graphic.end },
      ]
    case 'text':
      return []
  }
}

/** The shape with one of its handles dragged to `to`. A circle's radius never drags below the fine grid. */
export function dragGraphicHandle(
  graphic: SymbolGraphic,
  handle: string,
  to: SymbolPoint,
): SymbolGraphic {
  if (graphic.kind === 'polyline' && handle.startsWith('point:')) {
    const index = Number(handle.slice('point:'.length))
    return { ...graphic, points: graphic.points.map((p, i) => (i === index ? to : p)) }
  }
  if (graphic.kind === 'circle' && handle === 'radius') {
    const reach = Math.hypot(to.x - graphic.center.x, to.y - graphic.center.y)
    return { ...graphic, radius: exactPx(Math.max(reach, SCHEMATIC_MINOR_GRID_PX)) }
  }
  if (
    (graphic.kind === 'rectangle' || graphic.kind === 'arc') &&
    (handle === 'start' || handle === 'end')
  ) {
    return { ...graphic, [handle]: to }
  }
  if (graphic.kind === 'arc' && handle === 'mid') return { ...graphic, mid: to }
  return graphic
}

// ── moving, turning, deleting ─────────────────────────────────────────────────────────────────────────

/** The point a shape is dragged by — its first point, which a drag snaps to the grid. */
export function graphicAnchor(graphic: SymbolGraphic): SymbolPoint {
  switch (graphic.kind) {
    case 'polyline':
      return graphic.points[0] ?? { x: 0, y: 0 }
    case 'rectangle':
    case 'arc':
      return graphic.start
    case 'circle':
      return graphic.center
    case 'text':
      return graphic.at
  }
}

/** The point a target is dragged by: a shape's anchor, a pin's tip, a field's centre. */
export function targetAnchor(draft: SymbolDraft, target: SymbolTarget): SymbolPoint | null {
  if (target.kind === 'graphic') {
    const graphic = draft.graphics[target.index]
    return graphic === undefined ? null : graphicAnchor(graphic)
  }
  if (target.kind === 'pin') {
    return draft.pins.find((p) => p.key === target.key)?.placed?.at ?? null
  }
  return draft.fields[target.key].at
}

/** Move a target so its anchor lands on `to`; everything else about it keeps its place relative to it. */
export function moveTargetTo(
  draft: SymbolDraft,
  target: SymbolTarget,
  to: SymbolPoint,
): SymbolDraft {
  const from = targetAnchor(draft, target)
  if (from === null || samePoint(from, to)) return draft
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (target.kind === 'graphic') {
    return updateGraphic(draft, target.index, (g) =>
      mapGraphicPoints(g, (p) => ({ x: exactPx(p.x + dx), y: exactPx(p.y + dy) })),
    )
  }
  if (target.kind === 'pin') {
    return updatePin(draft, target.key, (pin) =>
      pin.placed === null ? pin : { ...pin, placed: { ...pin.placed, at: to } },
    )
  }
  return {
    ...draft,
    fields: { ...draft.fields, [target.key]: { ...draft.fields[target.key], at: to } },
  }
}

/** Each side a quarter turn clockwise (on screen) from the one before it. */
const CLOCKWISE: readonly PinSide[] = ['left', 'top', 'right', 'bottom']

export function turnedSide(side: PinSide): PinSide {
  return CLOCKWISE[(CLOCKWISE.indexOf(side) + 1) % CLOCKWISE.length] as PinSide
}

const quarterTurn = (p: SymbolPoint, about: SymbolPoint): SymbolPoint => ({
  x: exactPx(about.x - (p.y - about.y)),
  y: exactPx(about.y + (p.x - about.x)),
})

/**
 * A quarter turn. A shape turns clockwise about its own middle; text swaps between reading across and
 * reading up (the only two ways KiCad sets symbol text); a pin swings about its tip, so the spot its wire
 * lands on stays put and only the way it points changes. A field stays upright, as on every schematic.
 */
export function rotateTarget(draft: SymbolDraft, target: SymbolTarget): SymbolDraft {
  if (target.kind === 'field') return draft
  if (target.kind === 'pin') {
    return updatePin(draft, target.key, (pin) => ({ ...pin, side: turnedSide(pin.side) }))
  }
  return updateGraphic(draft, target.index, (graphic) => {
    if (graphic.kind === 'text') {
      const { angle: _was, ...across } = graphic
      return graphic.angle === 90 ? across : { ...graphic, angle: 90 }
    }
    const reach = shapeReach(graphic)
    const middle = { x: (reach.minX + reach.maxX) / 2, y: (reach.minY + reach.maxY) / 2 }
    return mapGraphicPoints(graphic, (p) => quarterTurn(p, middle))
  })
}

/**
 * Delete what is selected. A shape goes. A pin only comes OFF the drawing and waits to be put back — it is
 * still one of the part's pins. A field can't be removed (every symbol has all four), so it is hidden.
 */
export function deleteTarget(draft: SymbolDraft, target: SymbolTarget): SymbolDraft {
  if (target.kind === 'graphic') {
    return { ...draft, graphics: draft.graphics.filter((_, i) => i !== target.index) }
  }
  if (target.kind === 'pin')
    return updatePin(draft, target.key, (pin) => ({ ...pin, placed: null }))
  return {
    ...draft,
    fields: { ...draft.fields, [target.key]: { ...draft.fields[target.key], visible: false } },
  }
}

// ── pins ──────────────────────────────────────────────────────────────────────────────────────────────

export function updatePin(
  draft: SymbolDraft,
  key: string,
  change: (pin: DraftPin) => DraftPin,
): SymbolDraft {
  let changed = false
  const pins = draft.pins.map((pin) => {
    if (pin.key !== key) return pin
    const next = change(pin)
    changed = next !== pin
    return next
  })
  return changed ? { ...draft, pins } : draft
}

/** Put a pin down with its tip at `at`, pointing out of `side` (null keeps the way it points now). */
export function placePin(
  draft: SymbolDraft,
  key: string,
  at: SymbolPoint,
  side: PinSide | null,
): SymbolDraft {
  return updatePin(draft, key, (pin) => ({
    ...pin,
    side: side ?? pin.side,
    placed: {
      at,
      length: pin.placed?.length ?? DEFAULT_PIN_LENGTH,
      style: pin.placed?.style ?? 'line',
      hideName: pin.placed?.hideName ?? false,
      hideNumber: pin.placed?.hideNumber ?? false,
    },
  }))
}

/** The pin the Pin tool puts down next: the chosen one if it isn't drawn yet, else the first that isn't. */
export function nextPinToPlace(draft: SymbolDraft, preferred: string | null): string | null {
  const chosen = draft.pins.find((p) => p.key === preferred)
  if (chosen !== undefined && chosen.placed === null) return chosen.key
  return draft.pins.find((p) => p.placed === null)?.key ?? null
}

/**
 * Which way a pin put down at `point` should point: out of whichever side of the drawn body it is beyond —
 * click left of an op-amp's triangle and the pin points left. null when the point is inside the body's
 * extent or nothing is drawn yet (the pin then keeps the way it points).
 */
export function sideFacing(draft: SymbolDraft, point: SymbolPoint): PinSide | null {
  let body = EMPTY_EXTENT
  for (const graphic of draft.graphics) {
    if (graphic.kind !== 'text') body = mergeExtent(body, shapeReach(graphic))
  }
  if (isEmptyExtent(body)) return null
  const beyond: [PinSide, number][] = [
    ['left', body.minX - point.x],
    ['right', point.x - body.maxX],
    ['top', body.minY - point.y],
    ['bottom', point.y - body.maxY],
  ]
  let best: [PinSide, number] | null = null
  for (const entry of beyond) {
    if (entry[1] > 0 && (best === null || entry[1] > best[1])) best = entry
  }
  return best === null ? null : best[0]
}

/** The length that puts a pin's root (where it meets the body) level with `point` along the pin. */
export function pinLengthToward(placed: PinPlacement, side: PinSide, point: SymbolPoint): number {
  const inward = pinInward(side)
  const along = (point.x - placed.at.x) * inward.x + (point.y - placed.at.y) * inward.y
  return exactPx(Math.max(along, SCHEMATIC_MINOR_GRID_PX))
}

/**
 * A key for a pin added here. It starts with '+', which no pin id can (ids are lowercase letters, digits
 * and underscores), so it can never be mistaken for one of the part's own pins before Save mints its id.
 */
export function freshPinKey(pins: readonly DraftPin[]): string {
  const used = new Set(pins.map((p) => p.key))
  let n = 1
  while (used.has(`+${n}`)) n++
  return `+${n}`
}

export function addPin(draft: SymbolDraft, key: string): SymbolDraft {
  const pin: DraftPin = {
    key,
    name: '',
    side: 'left',
    electrical: 'passive',
    pad: '',
    added: true,
    placed: null,
  }
  return { ...draft, pins: [...draft.pins, pin] }
}

/** Take away a pin added in this editor. The part's own pins stay: removing one would orphan its wires. */
export function removeAddedPin(draft: SymbolDraft, key: string): SymbolDraft {
  const pin = draft.pins.find((p) => p.key === key)
  if (pin === undefined || !pin.added) return draft
  return { ...draft, pins: draft.pins.filter((p) => p.key !== key) }
}

// ── saving ────────────────────────────────────────────────────────────────────────────────────────────

/** A drawing re-keyed: each pin reference passed through `idOf` (a row key or stand-in → the real id). */
export function rekeySymbolPins(
  symbol: DrawnSymbol,
  idOf: ReadonlyMap<string, string>,
): DrawnSymbol {
  return { ...symbol, pins: symbol.pins.map((p) => ({ ...p, pin: idOf.get(p.pin) ?? p.pin })) }
}

export type SymbolEditOutcome = { ok: true; part: UserPart } | { ok: false; error: string }

/**
 * The file loader's own check: refuse what a reload would drop or strip, so a part saved from the editor is
 * exactly the part the next launch loads. The part that comes back is the loader's clean copy.
 */
function checkedPart(candidate: UserPart): SymbolEditOutcome {
  const problems =
    candidate.symbol === undefined ? [] : symbolProblems(candidate.symbol, candidate.pins)
  if (problems.length > 0) {
    return { ok: false, error: `The drawing isn't finished: ${problems[0]}.` }
  }
  const loaded = validateUserPart(candidate)
  if (loaded === null) {
    return {
      ok: false,
      error: 'This part wouldn’t load back from a saved file, so it wasn’t saved.',
    }
  }
  return { ok: true, part: loaded }
}

const userPinFrom = (pin: SymbolEditorPin, id: string): UserPin => {
  const pad = pin.pad.trim()
  return {
    id,
    name: pin.name.trim(),
    side: pin.side,
    electrical: pin.electrical,
    ...(pad.length > 0 ? { pad } : {}),
  }
}

/**
 * A saved part with its symbol drawn (or redrawn). The pin contract comes through untouched: the part's own
 * pins keep their ids and their order — only their names, pads, types and the way they point can change —
 * and a pin added in the editor goes on the END, with an id minted by the one pin-naming rule.
 */
export function applySymbolEdit(part: UserPart, edit: SymbolEditResult): SymbolEditOutcome {
  const kept = edit.pins.slice(0, part.pins.length)
  if (kept.length !== part.pins.length || kept.some((pin, i) => pin.key !== part.pins[i]?.id)) {
    return { ok: false, error: 'The part’s pins can’t be reordered or removed here.' }
  }
  const added = edit.pins.slice(part.pins.length)
  if (added.length > 0 && part.internal !== undefined) {
    return {
      ok: false,
      error:
        'This part is built from a circuit, and its pins are that circuit’s pins — add one there.',
    }
  }
  const existingIds = part.pins.map((p) => p.id)
  const minted = mintPinIds(
    added.map((pin, i) => ({ name: pin.name, index: part.pins.length + i })),
    existingIds,
  )
  const ids = [...existingIds, ...minted]
  const idOf = new Map(edit.pins.map((pin, i) => [pin.key, ids[i] as string]))
  const { datasheet: _previous, symbol: _previousDrawing, ...rest } = part
  const datasheet = edit.datasheet.trim()
  return checkedPart({
    ...rest,
    pins: edit.pins.map((pin, i) => userPinFrom(pin, ids[i] as string)),
    symbol: rekeySymbolPins(edit.symbol, idOf),
    ...(datasheet.length > 0 ? { datasheet } : {}),
  })
}

/**
 * Put a drawing made from the New Part form onto the part that form just built. The form's rows became the
 * part's pins in the same order, so row i's key names pin i's freshly minted id.
 */
export function attachDrawnSymbol(
  part: UserPart,
  rowKeys: readonly string[],
  symbol: DrawnSymbol | null,
  datasheet: string,
): SymbolEditOutcome {
  const idOf = new Map(rowKeys.map((key, i) => [key, part.pins[i]?.id ?? key]))
  const trimmed = datasheet.trim()
  return checkedPart({
    ...part,
    ...(symbol === null ? {} : { symbol: rekeySymbolPins(symbol, idOf) }),
    ...(trimmed.length > 0 ? { datasheet: trimmed } : {}),
  })
}
