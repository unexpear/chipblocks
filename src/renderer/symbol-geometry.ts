import { EMPTY_EXTENT, type Extent, extentOfPoints, mergeExtent } from './footprint.ts'
import type { PinSide } from './user-parts.ts'

/**
 * A DRAWN schematic symbol — the picture a user draws for their own part (the KiCad Symbol Editor's
 * job): lines, rectangles, circles, arcs and text, plus a spot for every pin and the part's text fields.
 * This file is the data model and the pure geometry behind it. No React, no @xyflow VALUE import: the
 * load-time validator uses it, and that validator is reached from the Electron main process.
 *
 * PRESENTATION ONLY. A drawing never names a pin, numbers one, or says what it does electrically — that
 * all stays on the part's own pin list (UserPin), which is what the solver, the ratsnest and the board
 * read. A drawn pin only says WHERE its wire lands and how the pin looks, so nothing drawn here can reach
 * the physics. Even which way a pin points is the pin's own `side`, never a second copy kept here: the
 * drawing and the plain labelled box a part falls back to can therefore never disagree about it.
 *
 * WHERE A WIRE LANDS. Every pin points straight out of one side, and its tip — the connection point —
 * must sit ON that side's edge of the drawing's box: every left-pointing tip at the far left, and so on
 * (user-symbol-validate.ts refuses anything else). The box is worked out from the drawing, never stored.
 * The wire handle goes exactly on the tip, so the wire ends just outside the box, where the auto-router
 * can reach it — a tip left inside the box gets no route and would be drawn as a line through the part.
 *
 * Coordinates are px in the drawing's own space (y grows downward, like the canvas); the node box's
 * top-left is wherever the drawing's box starts. Names follow KiCad's symbol format (polyline,
 * rectangle, circle, arc with start/mid/end, fill none/outline/background, the four fields) so a later
 * import or export maps one to one.
 */

/** The schematic's grid: parts snap to it and the bold background lines are drawn on it. */
export const SCHEMATIC_GRID_PX = 20
/** The schematic's fine grid — its faint background lines. A shape being drawn snaps to it. */
export const SCHEMATIC_MINOR_GRID_PX = 4
/** The line a part's body is drawn with: the plain labelled box's outline, and a newly drawn shape's. */
export const BODY_STROKE_WIDTH = 1.6
/** An inverted pin's bubble — it sits between the pin line and the body. */
export const PIN_BUBBLE_RADIUS = 3
/** How far a clock pin's wedge reaches into the body, and half its width along the edge. */
export const PIN_CLOCK_SIZE = 4
/** Estimated width of one character, as a fraction of the text size (the canvas uses a system font). */
const CHAR_WIDTH_EM = 0.6
/** Floating-point slack when comparing coordinates — noise, not a tolerance anyone can see. */
export const SYMBOL_EPS = 1e-6

export type SymbolPoint = { x: number; y: number }

/** none = hollow; outline = filled with the line colour; background = filled with the body colour. */
export type SymbolFill = 'none' | 'outline' | 'background'
export const SYMBOL_FILLS: readonly SymbolFill[] = ['none', 'outline', 'background']

type Outlined = { strokeWidth: number; fill: SymbolFill }
export type SymbolPolyline = Outlined & { kind: 'polyline'; points: SymbolPoint[] }
export type SymbolRectangle = Outlined & { kind: 'rectangle'; start: SymbolPoint; end: SymbolPoint }
export type SymbolCircle = Outlined & { kind: 'circle'; center: SymbolPoint; radius: number }
/** An arc through three points, KiCad's way: it starts at `start`, passes `mid`, ends at `end`. */
export type SymbolArc = Outlined & {
  kind: 'arc'
  start: SymbolPoint
  mid: SymbolPoint
  end: SymbolPoint
}
/** Text centred on `at`. `angle: 90` reads bottom-to-top, KiCad's only other text angle. */
export type SymbolText = { kind: 'text'; at: SymbolPoint; text: string; size: number; angle?: 90 }
export type SymbolShape = SymbolPolyline | SymbolRectangle | SymbolCircle | SymbolArc
export type SymbolGraphic = SymbolShape | SymbolText
export const SYMBOL_SHAPE_KINDS: readonly SymbolShape['kind'][] = [
  'polyline',
  'rectangle',
  'circle',
  'arc',
]

/** How a pin is drawn: a plain line, a bubble (inverted), a clock wedge, or both. */
export type SymbolPinStyle = 'line' | 'inverted' | 'clock' | 'inverted_clock'
export const SYMBOL_PIN_STYLES: readonly SymbolPinStyle[] = [
  'line',
  'inverted',
  'clock',
  'inverted_clock',
]

/** Where one of the part's pins is drawn. `pin` is that UserPin's id; which way it points is its side. */
export type SymbolPin = {
  pin: string
  /** The tip — the connection point, where the wire lands. */
  at: SymbolPoint
  /** From the tip to where the pin meets the body. */
  length: number
  style: SymbolPinStyle
  hideName?: boolean
  hideNumber?: boolean
}

export type SymbolFieldKey = 'reference' | 'value' | 'footprint' | 'datasheet'
export const SYMBOL_FIELD_KEYS: readonly SymbolFieldKey[] = [
  'reference',
  'value',
  'footprint',
  'datasheet',
]
/** Where a field's text is centred, and whether it shows. The text itself comes from the part. */
export type SymbolField = { at: SymbolPoint; visible: boolean }
export type SymbolFields = Record<SymbolFieldKey, SymbolField>

export type DrawnSymbol = { graphics: SymbolGraphic[]; pins: SymbolPin[]; fields: SymbolFields }

const INWARD: Record<PinSide, SymbolPoint> = {
  left: { x: 1, y: 0 },
  right: { x: -1, y: 0 },
  top: { x: 0, y: 1 },
  bottom: { x: 0, y: -1 },
}

/** One px step from a pin's tip toward the body: a pin on the left points out left, so it runs right. */
export function pinInward(side: PinSide): SymbolPoint {
  return INWARD[side]
}

const along = (from: SymbolPoint, step: SymbolPoint, distance: number): SymbolPoint => ({
  x: from.x + step.x * distance,
  y: from.y + step.y * distance,
})

/** Where the pin meets the body. */
export function pinRoot(pin: Pick<SymbolPin, 'at' | 'length'>, side: PinSide): SymbolPoint {
  return along(pin.at, pinInward(side), pin.length)
}

/** The bubble an inverted pin wears: tangent to the body, on the pin's own line. */
export function pinBubble(pin: SymbolPin, side: PinSide): SymbolPoint | null {
  if (pin.style !== 'inverted' && pin.style !== 'inverted_clock') return null
  return along(pinRoot(pin, side), pinInward(side), -PIN_BUBBLE_RADIUS)
}

/** Where the drawn pin line stops: at the body, or short of the bubble on an inverted pin. */
export function pinLineEnd(pin: SymbolPin, side: PinSide): SymbolPoint {
  const bubble = pinBubble(pin, side)
  return bubble === null ? pinRoot(pin, side) : along(bubble, pinInward(side), -PIN_BUBBLE_RADIUS)
}

/** A clock pin's wedge, inside the body: two corners on the body edge, the point aimed inward. */
export function pinClockWedge(pin: SymbolPin, side: PinSide): SymbolPoint[] | null {
  if (pin.style !== 'clock' && pin.style !== 'inverted_clock') return null
  const root = pinRoot(pin, side)
  const inward = pinInward(side)
  const across = { x: -inward.y, y: inward.x }
  return [
    along(root, across, PIN_CLOCK_SIZE),
    along(root, inward, PIN_CLOCK_SIZE),
    along(root, across, -PIN_CLOCK_SIZE),
  ]
}

/** Everything a drawn pin puts on the page: its line, and any bubble or wedge. */
function pinReach(pin: SymbolPin, side: PinSide): Extent {
  const points = [pin.at, pinRoot(pin, side), ...(pinClockWedge(pin, side) ?? [])]
  const bubble = pinBubble(pin, side)
  if (bubble !== null) {
    points.push(
      { x: bubble.x - PIN_BUBBLE_RADIUS, y: bubble.y - PIN_BUBBLE_RADIUS },
      { x: bubble.x + PIN_BUBBLE_RADIUS, y: bubble.y + PIN_BUBBLE_RADIUS },
    )
  }
  return extentOfPoints(points)
}

const TAU = 2 * Math.PI
/** The angle travelled from `from` to `to` going the increasing way round (0 ≤ result < 2π). */
const increasingTurn = (from: number, to: number) => (((to - from) % TAU) + TAU) % TAU

/**
 * The circle an arc lies on, and how far it turns: `sweep` is signed radians from the start angle, positive
 * the way screen angles grow (clockwise, since y points down). null when the three points sit on one
 * straight line — no circle passes through them, so there is no arc to draw.
 */
export function arcSweep(
  arc: Pick<SymbolArc, 'start' | 'mid' | 'end'>,
): { center: SymbolPoint; radius: number; startAngle: number; sweep: number } | null {
  const { start: a, mid: b, end: c } = arc
  const twiceArea = 2 * ((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y))
  if (Math.abs(twiceArea) < SYMBOL_EPS) return null
  const a2 = a.x * a.x + a.y * a.y
  const b2 = b.x * b.x + b.y * b.y
  const c2 = c.x * c.x + c.y * c.y
  const center = {
    x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / twiceArea,
    y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / twiceArea,
  }
  const angleOf = (p: SymbolPoint) => Math.atan2(p.y - center.y, p.x - center.x)
  const startAngle = angleOf(a)
  const toEnd = increasingTurn(startAngle, angleOf(c))
  const throughMid = increasingTurn(startAngle, angleOf(b)) < toEnd
  return {
    center,
    radius: Math.hypot(a.x - center.x, a.y - center.y),
    startAngle,
    sweep: throughMid ? toEnd : toEnd - TAU,
  }
}

/** The SVG path of an arc. Three points on a line (never a valid drawing) come out as the straight line. */
export function arcPath(arc: Pick<SymbolArc, 'start' | 'mid' | 'end'>): string {
  const { start, mid, end } = arc
  const circle = arcSweep(arc)
  if (circle === null) return `M ${start.x} ${start.y} L ${mid.x} ${mid.y} L ${end.x} ${end.y}`
  const largeArc = Math.abs(circle.sweep) > Math.PI ? 1 : 0
  const clockwise = circle.sweep > 0 ? 1 : 0
  return `M ${start.x} ${start.y} A ${circle.radius} ${circle.radius} 0 ${largeArc} ${clockwise} ${end.x} ${end.y}`
}

/** How far an arc reaches: its ends, plus the circle's leftmost/topmost/… points it actually passes. */
function arcReach(arc: SymbolArc): Extent {
  const circle = arcSweep(arc)
  if (circle === null) return extentOfPoints([arc.start, arc.mid, arc.end])
  const points = [arc.start, arc.end]
  for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
    const travelled =
      circle.sweep >= 0
        ? increasingTurn(circle.startAngle, angle)
        : increasingTurn(angle, circle.startAngle)
    if (travelled <= Math.abs(circle.sweep)) {
      points.push({
        x: circle.center.x + circle.radius * Math.cos(angle),
        y: circle.center.y + circle.radius * Math.sin(angle),
      })
    }
  }
  return extentOfPoints(points)
}

/** How far a shape's GEOMETRY reaches — its points and curves, not the thickness of its line. */
export function shapeReach(shape: SymbolShape): Extent {
  switch (shape.kind) {
    case 'polyline':
      return extentOfPoints(shape.points)
    case 'rectangle':
      return extentOfPoints([shape.start, shape.end])
    case 'circle':
      return {
        minX: shape.center.x - shape.radius,
        minY: shape.center.y - shape.radius,
        maxX: shape.center.x + shape.radius,
        maxY: shape.center.y + shape.radius,
      }
    case 'arc':
      return arcReach(shape)
  }
}

const grow = (extent: Extent, by: number): Extent => ({
  minX: extent.minX - by,
  minY: extent.minY - by,
  maxX: extent.maxX + by,
  maxY: extent.maxY + by,
})

/** The box a piece of text covers — estimated, since the canvas draws it in whatever system font it has. */
function textExtent(text: SymbolText): Extent {
  const long = text.text.length * text.size * CHAR_WIDTH_EM
  const halfW = (text.angle === 90 ? text.size : long) / 2
  const halfH = (text.angle === 90 ? long : text.size) / 2
  return {
    minX: text.at.x - halfW,
    minY: text.at.y - halfH,
    maxX: text.at.x + halfW,
    maxY: text.at.y + halfH,
  }
}

/** Everything a graphic paints: a shape grown by half its line width (a line is centred on its path). */
export function graphicInk(graphic: SymbolGraphic): Extent {
  if (graphic.kind === 'text') return textExtent(graphic)
  return grow(shapeReach(graphic), graphic.strokeWidth / 2)
}

/** How far the drawing's geometry reaches — every shape and pin, but not text or line thickness. The
 *  pin-tip rule is judged against this: text is an estimate, so it must never decide where a wire lands. */
export function drawingReach(symbol: DrawnSymbol, sideOf: ReadonlyMap<string, PinSide>): Extent {
  let reach = EMPTY_EXTENT
  for (const graphic of symbol.graphics) {
    if (graphic.kind !== 'text') reach = mergeExtent(reach, shapeReach(graphic))
  }
  for (const pin of symbol.pins) {
    const side = sideOf.get(pin.pin)
    if (side !== undefined) reach = mergeExtent(reach, pinReach(pin, side))
  }
  return reach
}

/** The coordinate a side's tips must share: x for left/right pins, y for top/bottom ones. */
export function tipCoordinate(pin: Pick<SymbolPin, 'at'>, side: PinSide): number {
  return side === 'left' || side === 'right' ? pin.at.x : pin.at.y
}

const floorToGrid = (v: number) =>
  Math.floor(v / SCHEMATIC_GRID_PX + SYMBOL_EPS) * SCHEMATIC_GRID_PX
const ceilToGrid = (v: number) => Math.ceil(v / SCHEMATIC_GRID_PX - SYMBOL_EPS) * SCHEMATIC_GRID_PX

/**
 * The node box, in drawing coordinates. A side with pins ends exactly at their tips, so the wire handles
 * sit on the box edge like every other part's. A side with no pins ends at the next grid line past all the
 * ink, text included: the box's top-left then lands on the grid, and so does every tip drawn on it when
 * the part is snapped into place.
 */
export function drawnSymbolBox(symbol: DrawnSymbol, sideOf: ReadonlyMap<string, PinSide>): Extent {
  let ink = EMPTY_EXTENT
  for (const graphic of symbol.graphics) ink = mergeExtent(ink, graphicInk(graphic))
  const tips: Record<PinSide, number[]> = { left: [], right: [], top: [], bottom: [] }
  for (const pin of symbol.pins) {
    const side = sideOf.get(pin.pin)
    if (side === undefined) continue
    ink = mergeExtent(ink, pinReach(pin, side))
    tips[side].push(tipCoordinate(pin, side))
  }
  return {
    minX: tips.left.length > 0 ? Math.min(...tips.left) : floorToGrid(ink.minX),
    minY: tips.top.length > 0 ? Math.min(...tips.top) : floorToGrid(ink.minY),
    maxX: tips.right.length > 0 ? Math.max(...tips.right) : ceilToGrid(ink.maxX),
    maxY: tips.bottom.length > 0 ? Math.max(...tips.bottom) : ceilToGrid(ink.maxY),
  }
}

const shift = (p: SymbolPoint, dx: number, dy: number): SymbolPoint => ({
  x: p.x + dx,
  y: p.y + dy,
})

/** The same graphic with every point that defines it passed through `move`. A circle keeps its radius,
 *  so `move` must be a shift or a turn — which is all a drawing is ever moved by. */
export function mapGraphicPoints(
  graphic: SymbolGraphic,
  move: (point: SymbolPoint) => SymbolPoint,
): SymbolGraphic {
  switch (graphic.kind) {
    case 'polyline':
      return { ...graphic, points: graphic.points.map(move) }
    case 'rectangle':
      return { ...graphic, start: move(graphic.start), end: move(graphic.end) }
    case 'circle':
      return { ...graphic, center: move(graphic.center) }
    case 'arc':
      return {
        ...graphic,
        start: move(graphic.start),
        mid: move(graphic.mid),
        end: move(graphic.end),
      }
    case 'text':
      return { ...graphic, at: move(graphic.at) }
  }
}

export type PlacedSymbolPin = SymbolPin & { side: PinSide }

/** A drawing moved into its node box: (0, 0) is the box's top-left, as the canvas node draws it. */
export type PlacedDrawnSymbol = {
  width: number
  height: number
  graphics: SymbolGraphic[]
  /** In the part's own pin order. */
  pins: PlacedSymbolPin[]
  fields: SymbolFields
}

/**
 * The drawing in node-box space, ready to draw and to hang wire handles on — the one placement both read,
 * so a handle can never sit anywhere but on its drawn tip. `partPins` gives each pin's side and the order.
 */
export function placeDrawnSymbol(
  symbol: DrawnSymbol,
  partPins: readonly { id: string; side: PinSide }[],
): PlacedDrawnSymbol {
  const sideOf = new Map(partPins.map((p) => [p.id, p.side]))
  const box = drawnSymbolBox(symbol, sideOf)
  const dx = -box.minX
  const dy = -box.minY
  const drawnById = new Map(symbol.pins.map((p) => [p.pin, p]))
  const pins: PlacedSymbolPin[] = []
  for (const partPin of partPins) {
    const drawn = drawnById.get(partPin.id)
    if (drawn === undefined) continue
    pins.push({ ...drawn, at: shift(drawn.at, dx, dy), side: partPin.side })
  }
  const fields = {} as SymbolFields
  for (const key of SYMBOL_FIELD_KEYS) {
    fields[key] = { ...symbol.fields[key], at: shift(symbol.fields[key].at, dx, dy) }
  }
  return {
    width: box.maxX - box.minX,
    height: box.maxY - box.minY,
    graphics: symbol.graphics.map((g) => mapGraphicPoints(g, (p) => shift(p, dx, dy))),
    pins,
    fields,
  }
}
