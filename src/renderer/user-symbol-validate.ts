import {
  arcSweep,
  type DrawnSymbol,
  drawingReach,
  drawnSymbolBox,
  PIN_BUBBLE_RADIUS,
  SYMBOL_EPS,
  SYMBOL_FIELD_KEYS,
  SYMBOL_FILLS,
  SYMBOL_PIN_STYLES,
  SYMBOL_SHAPE_KINDS,
  type SymbolFields,
  type SymbolFill,
  type SymbolGraphic,
  type SymbolPin,
  type SymbolPinStyle,
  type SymbolPoint,
  tipCoordinate,
} from './symbol-geometry.ts'
import type { PinSide, UserPin } from './user-parts.ts'

/**
 * Validation for a DRAWN symbol — one rule set, two callers, the footprint editor's pattern: the symbol
 * editor shows `symbolProblems` live while you draw, and the file loader (validateUserPart) keeps a drawing
 * only when that list is empty. So a symbol that saves is exactly a symbol that survives a reload.
 *
 * Import-pure like user-part-validate.ts (circuit-file.ts pulls it in, and the Electron main process
 * imports circuit-file): symbol-geometry.ts has no React or @xyflow value in it, and the user-parts import
 * below is type-only.
 *
 * The rules that matter most are the ones about wires. Every one of the part's pins must be drawn exactly
 * once, and every tip must sit on the outer edge its pin points out of — a tip anywhere else would put the
 * wire's end inside the part, where the router can't reach it and a wire gets drawn straight through the
 * body instead.
 */

type PartPin = Pick<UserPin, 'id' | 'name' | 'side'>

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isPoint = (v: unknown): v is SymbolPoint =>
  isRecord(v) && isFiniteNumber(v.x) && isFiniteNumber(v.y)
const isPositive = (v: unknown): v is number => isFiniteNumber(v) && v > 0
const hasVisibleText = (v: unknown): v is string => typeof v === 'string' && /\S/.test(v)
const isShapeKind = (v: unknown): boolean =>
  typeof v === 'string' && (SYMBOL_SHAPE_KINDS as readonly string[]).includes(v)
const round = (v: number) => Number(v.toFixed(2))

const POINT_FIELDS: Record<SymbolGraphic['kind'], string[]> = {
  polyline: [],
  rectangle: ['start', 'end'],
  circle: ['center'],
  arc: ['start', 'mid', 'end'],
  text: ['at'],
}

function shapeProblems(raw: Record<string, unknown>, where: string): string[] {
  const out: string[] = []
  if (!isPositive(raw.strokeWidth)) out.push(`${where}: line width must be a number above 0`)
  if (typeof raw.fill !== 'string' || !SYMBOL_FILLS.includes(raw.fill as SymbolFill)) {
    out.push(`${where}: fill must be none, outline or background`)
  }
  return out
}

function graphicProblems(raw: unknown, index: number): string[] {
  const where = `shape ${index + 1}`
  if (!isRecord(raw)) return [`${where}: not a shape`]
  if (raw.kind !== 'text' && !isShapeKind(raw.kind)) {
    return [
      `${where}: unknown kind "${String(raw.kind)}" — a shape is a polyline, rectangle, circle, arc or text`,
    ]
  }
  const known = raw.kind as SymbolGraphic['kind']
  const out: string[] = []
  for (const field of POINT_FIELDS[known]) {
    if (!isPoint(raw[field])) out.push(`${where}: its ${field} needs a number x and y`)
  }
  if (known === 'text') {
    if (!hasVisibleText(raw.text)) out.push(`${where}: the text is empty`)
    if (!isPositive(raw.size)) out.push(`${where}: text size must be a number above 0`)
    if (raw.angle !== undefined && raw.angle !== 0 && raw.angle !== 90) {
      out.push(`${where}: text runs across (0) or up (90) — nothing else`)
    }
    return out
  }
  out.push(...shapeProblems(raw, where))
  if (known === 'polyline') {
    if (!Array.isArray(raw.points) || raw.points.length < 2) {
      out.push(`${where}: a line needs at least two points`)
    } else if (!raw.points.every(isPoint)) {
      out.push(`${where}: every point needs a number x and y`)
    }
  }
  if (known === 'rectangle' && isPoint(raw.start) && isPoint(raw.end)) {
    const flat = Math.abs(raw.start.x - raw.end.x) < SYMBOL_EPS
    const thin = Math.abs(raw.start.y - raw.end.y) < SYMBOL_EPS
    if (flat || thin) out.push(`${where}: a rectangle needs both a width and a height`)
  }
  if (known === 'circle' && !isPositive(raw.radius)) {
    out.push(`${where}: a circle needs a radius above 0`)
  }
  if (known === 'arc' && isPoint(raw.start) && isPoint(raw.mid) && isPoint(raw.end)) {
    if (arcSweep({ start: raw.start, mid: raw.mid, end: raw.end }) === null) {
      out.push(`${where}: an arc's start, middle and end can't sit on one straight line`)
    }
  }
  return out
}

function pinLabel(pin: PartPin): string {
  return pin.name.trim() === '' ? pin.id : pin.name
}

function drawnPinProblems(
  raw: unknown,
  index: number,
  byId: ReadonlyMap<string, PartPin>,
): string[] {
  const where = `drawn pin ${index + 1}`
  if (!isRecord(raw)) return [`${where}: not a pin`]
  if (typeof raw.pin !== 'string' || !byId.has(raw.pin)) {
    return [`${where} doesn't belong to any of this part's pins`]
  }
  const who = `pin ${pinLabel(byId.get(raw.pin) as PartPin)}`
  const out: string[] = []
  if (!isPoint(raw.at)) out.push(`${who}: its tip needs a number x and y`)
  if (!isPositive(raw.length)) out.push(`${who}: its length must be a number above 0`)
  const style = raw.style
  if (typeof style !== 'string' || !SYMBOL_PIN_STYLES.includes(style as SymbolPinStyle)) {
    out.push(
      `${who}: unknown style "${String(style)}" — use line, inverted, clock or inverted_clock`,
    )
  } else if (
    (style === 'inverted' || style === 'inverted_clock') &&
    isFiniteNumber(raw.length) &&
    raw.length < 2 * PIN_BUBBLE_RADIUS
  ) {
    out.push(
      `${who}: an inverted pin must be at least ${2 * PIN_BUBBLE_RADIUS} px long to fit its bubble`,
    )
  }
  for (const flag of ['hideName', 'hideNumber'] as const) {
    if (raw[flag] !== undefined && typeof raw[flag] !== 'boolean') {
      out.push(`${who}: ${flag} must be true or false`)
    }
  }
  return out
}

function fieldProblems(raw: unknown): string[] {
  if (!isRecord(raw)) {
    return ['the drawing needs its reference, value, footprint and datasheet fields']
  }
  const out: string[] = []
  for (const key of SYMBOL_FIELD_KEYS) {
    const field = raw[key]
    if (!isRecord(field) || !isPoint(field.at)) out.push(`the ${key} field needs a position (x, y)`)
    else if (typeof field.visible !== 'boolean') {
      out.push(`the ${key} field must say whether it shows (visible: true or false)`)
    }
  }
  return out
}

const POINTS: Record<PinSide, string> = {
  left: 'points left',
  right: 'points right',
  top: 'points up',
  bottom: 'points down',
}
const AXIS: Record<PinSide, 'x' | 'y'> = { left: 'x', right: 'x', top: 'y', bottom: 'y' }
/** +1 when that side's outer edge is the LARGER coordinate (right, bottom), −1 when it is the smaller. */
const OUTWARD: Record<PinSide, 1 | -1> = { left: -1, right: 1, top: -1, bottom: 1 }

/** The wire rule: each side's tips share one line, and nothing drawn reaches past it. */
function edgeProblems(symbol: DrawnSymbol, pins: readonly PartPin[]): string[] {
  const byId = new Map(pins.map((p) => [p.id, p]))
  const sideOf = new Map(pins.map((p) => [p.id, p.side]))
  const reach = drawingReach(symbol, sideOf)
  const reachOn: Record<PinSide, number> = {
    left: reach.minX,
    right: reach.maxX,
    top: reach.minY,
    bottom: reach.maxY,
  }
  const out: string[] = []
  for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    const onSide = symbol.pins.filter((p) => sideOf.get(p.pin) === side)
    if (onSide.length === 0) continue
    const outward = OUTWARD[side]
    const edge = Math.max(...onSide.map((p) => outward * tipCoordinate(p, side))) * outward
    for (const pin of onSide) {
      const tip = tipCoordinate(pin, side)
      if (Math.abs(tip - edge) <= SYMBOL_EPS) continue
      const who = pinLabel(byId.get(pin.pin) as PartPin)
      out.push(
        `pin ${who} ${POINTS[side]}, so its tip belongs on the ${side} edge (${AXIS[side]} = ${round(edge)}), but it is at ${AXIS[side]} = ${round(tip)} — a wire can only land on an outer edge`,
      )
    }
    if (outward * (reachOn[side] - edge) > SYMBOL_EPS) {
      out.push(
        `the drawing reaches past the pins on its ${side} edge (to ${AXIS[side]} = ${round(reachOn[side])}) — pins that ${POINTS[side].replace('points', 'point')} must be the outermost thing drawn there, or their wires would cross the body`,
      )
    }
  }
  const box = drawnSymbolBox(symbol, sideOf)
  if (!(box.maxX - box.minX > SYMBOL_EPS)) out.push('the drawing has no width')
  if (!(box.maxY - box.minY > SYMBOL_EPS)) out.push('the drawing has no height')
  return out
}

/**
 * Every problem with a proposed drawing for a part with these pins, in plain language — empty means it can
 * be saved and drawn. Structure is checked first; the geometry rules only run on a drawing that is whole.
 */
export function symbolProblems(raw: unknown, pins: readonly PartPin[]): string[] {
  if (!isRecord(raw)) return ['the drawing must list its shapes, its pins and its fields']
  const out: string[] = []

  if (!Array.isArray(raw.graphics)) {
    out.push('the drawing needs a list of shapes')
  } else {
    for (const [i, graphic] of raw.graphics.entries()) out.push(...graphicProblems(graphic, i))
    const hasBody = raw.graphics.some((g) => isRecord(g) && isShapeKind(g.kind))
    if (!hasBody) out.push("draw the part's body — at least one line, rectangle, circle or arc")
  }

  const byId = new Map(pins.map((p) => [p.id, p]))
  if (!Array.isArray(raw.pins)) {
    out.push('the drawing needs a list of pins')
  } else {
    const drawn = new Set<string>()
    for (const [i, pin] of raw.pins.entries()) {
      out.push(...drawnPinProblems(pin, i, byId))
      if (!isRecord(pin) || typeof pin.pin !== 'string' || !byId.has(pin.pin)) continue
      if (drawn.has(pin.pin)) {
        out.push(`pin ${pinLabel(byId.get(pin.pin) as PartPin)} is drawn twice`)
      }
      drawn.add(pin.pin)
    }
    for (const pin of pins) {
      if (!drawn.has(pin.id)) {
        out.push(`pin ${pinLabel(pin)} isn't drawn — every pin needs a spot for its wire to land`)
      }
    }
  }

  out.push(...fieldProblems(raw.fields))
  if (out.length > 0) return out
  return edgeProblems(raw as DrawnSymbol, pins)
}

function cleanPoint(p: SymbolPoint): SymbolPoint {
  return { x: p.x, y: p.y }
}

function cleanGraphic(raw: SymbolGraphic): SymbolGraphic {
  if (raw.kind === 'text') {
    return {
      kind: 'text',
      at: cleanPoint(raw.at),
      text: raw.text,
      size: raw.size,
      ...(raw.angle === 90 ? { angle: 90 as const } : {}),
    }
  }
  const outline = { strokeWidth: raw.strokeWidth, fill: raw.fill }
  switch (raw.kind) {
    case 'polyline':
      return { kind: 'polyline', points: raw.points.map(cleanPoint), ...outline }
    case 'rectangle':
      return {
        kind: 'rectangle',
        start: cleanPoint(raw.start),
        end: cleanPoint(raw.end),
        ...outline,
      }
    case 'circle':
      return { kind: 'circle', center: cleanPoint(raw.center), radius: raw.radius, ...outline }
    case 'arc':
      return {
        kind: 'arc',
        start: cleanPoint(raw.start),
        mid: cleanPoint(raw.mid),
        end: cleanPoint(raw.end),
        ...outline,
      }
  }
}

function cleanPin(raw: SymbolPin): SymbolPin {
  return {
    pin: raw.pin,
    at: cleanPoint(raw.at),
    length: raw.length,
    style: raw.style,
    ...(raw.hideName === true ? { hideName: true } : {}),
    ...(raw.hideNumber === true ? { hideNumber: true } : {}),
  }
}

/**
 * Load-time gate: a clean copy of the drawing (known fields only, so a newer file's extras are left
 * behind) when it breaks no rule, else null — and the part then falls back to its plain labelled box.
 */
export function validateDrawnSymbol(raw: unknown, pins: readonly PartPin[]): DrawnSymbol | null {
  if (symbolProblems(raw, pins).length > 0) return null
  const symbol = raw as DrawnSymbol
  const fields = {} as SymbolFields
  for (const key of SYMBOL_FIELD_KEYS) {
    fields[key] = { at: cleanPoint(symbol.fields[key].at), visible: symbol.fields[key].visible }
  }
  return {
    graphics: symbol.graphics.map(cleanGraphic),
    pins: symbol.pins.map(cleanPin),
    fields,
  }
}
