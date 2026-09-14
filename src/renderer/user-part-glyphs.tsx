import { Fragment } from 'react'
import { padForTerminal } from './footprint-assignment.ts'
import {
  arcPath,
  BODY_STROKE_WIDTH,
  PIN_BUBBLE_RADIUS,
  PIN_CLOCK_SIZE,
  type PlacedDrawnSymbol,
  type PlacedSymbolPin,
  pinBubble,
  pinClockWedge,
  pinInward,
  pinLineEnd,
  pinRoot,
  SYMBOL_FIELD_KEYS,
  type SymbolFieldKey,
  type SymbolFill,
  type SymbolGraphic,
  type SymbolPoint,
} from './symbol-geometry.ts'
import { THEME } from './theme.ts'
import {
  DRIVING_PINS,
  type UserPart,
  type UserPin,
  userPartDisplay,
  userPartGeometry,
} from './user-parts.ts'

/**
 * How a user-made part looks on the canvas: the plain labelled box its pin list implies, or the symbol
 * its author drew. Both are drawn in the node-box coordinate space `userPartDisplay` works out, the same
 * space the wire handles are placed in — which is what puts every handle exactly on its drawn pin tip.
 */

const STROKE = THEME.textPrimary
const PIN_LINE_WIDTH = 1.4
const PIN_NAME_TEXT = {
  dominantBaseline: 'central',
  fontSize: 9,
  fontFamily: 'system-ui, sans-serif',
  fill: THEME.textFaint,
} as const
/** A drawn pin's name sits this far inside the body; its pad number this far off the pin line. */
const PIN_NAME_GAP = 4
const PIN_NUMBER_GAP = 3

/** The dot on a pin's tip — where its wire lands. Filled on a pin that drives, hollow otherwise. */
function PinTipDot({ at, driving }: { at: SymbolPoint; driving: boolean }) {
  return (
    <circle
      cx={at.x}
      cy={at.y}
      r={2.4}
      fill={driving ? STROKE : THEME.surfaceRaised}
      stroke={STROKE}
      strokeWidth={1.2}
    />
  )
}

/**
 * A user-authored part's symbol — a labelled box with a pin stub + name at each pin, drawn straight
 * from its pin spec (userPartGeometry). No hand-coded picture: a part that isn't in the code still
 * renders here, and because the glyph and the wire handles (userPartTerminals) read the SAME geometry
 * in the SAME node-box coordinate space, every handle lands exactly on its drawn pin tip.
 */
export function UserPartGlyph({ part }: { part: UserPart }) {
  const { width, height, body, pins } = userPartGeometry(part)
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <rect
        x={body.x}
        y={body.y}
        width={body.width}
        height={body.height}
        rx={3}
        fill={THEME.surfaceRaised}
        stroke={STROKE}
        strokeWidth={BODY_STROKE_WIDTH}
      />
      <text
        x={body.x + body.width / 2}
        y={body.y + body.height / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={12}
        fontFamily="system-ui, sans-serif"
        fontWeight={600}
        fill={STROKE}
        // Squeeze an over-long name to fit the body (never stretch a short one) so it can't spill past
        // the box — the box-width heuristic can under-guess a wide all-caps name.
        {...(part.name.length * 8 > body.width - 12
          ? { textLength: body.width - 12, lengthAdjust: 'spacingAndGlyphs' as const }
          : {})}
      >
        {part.name}
      </text>
      {pins.map((p) => {
        // The name label tucks just INSIDE the body next to the pin root.
        const label =
          p.side === 'left'
            ? { x: p.rootX + 4, y: p.rootY, anchor: 'start' as const }
            : p.side === 'right'
              ? { x: p.rootX - 4, y: p.rootY, anchor: 'end' as const }
              : p.side === 'top'
                ? { x: p.rootX, y: p.rootY + 9, anchor: 'middle' as const }
                : { x: p.rootX, y: p.rootY - 9, anchor: 'middle' as const }
        return (
          <Fragment key={p.id}>
            <line
              x1={p.rootX}
              y1={p.rootY}
              x2={p.tipX}
              y2={p.tipY}
              stroke={STROKE}
              strokeWidth={PIN_LINE_WIDTH}
            />
            <PinTipDot at={{ x: p.tipX, y: p.tipY }} driving={DRIVING_PINS.has(p.electrical)} />
            {p.name && (
              <text x={label.x} y={label.y} textAnchor={label.anchor} {...PIN_NAME_TEXT}>
                {p.name}
              </text>
            )}
          </Fragment>
        )
      })}
    </svg>
  )
}

export const svgPoints = (points: readonly SymbolPoint[]) =>
  points.map((p) => `${p.x},${p.y}`).join(' ')

const FILL_PAINT: Record<SymbolFill, string> = {
  none: 'none',
  outline: STROKE,
  background: THEME.surfaceRaised,
}

/** One drawn shape or piece of text — the canvas and the symbol editor both paint with this. */
export function DrawnGraphic({ graphic }: { graphic: SymbolGraphic }) {
  if (graphic.kind === 'text') {
    const { at } = graphic
    return (
      <text
        x={at.x}
        y={at.y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={graphic.size}
        fontFamily="system-ui, sans-serif"
        fill={STROKE}
        {...(graphic.angle === 90 ? { transform: `rotate(-90 ${at.x} ${at.y})` } : {})}
      >
        {graphic.text}
      </text>
    )
  }
  const paint = {
    fill: FILL_PAINT[graphic.fill],
    stroke: STROKE,
    strokeWidth: graphic.strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  switch (graphic.kind) {
    case 'polyline':
      return <polyline points={svgPoints(graphic.points)} {...paint} />
    case 'rectangle': {
      const { start, end } = graphic
      return (
        <rect
          x={Math.min(start.x, end.x)}
          y={Math.min(start.y, end.y)}
          width={Math.abs(end.x - start.x)}
          height={Math.abs(end.y - start.y)}
          {...paint}
        />
      )
    }
    case 'circle':
      return <circle cx={graphic.center.x} cy={graphic.center.y} r={graphic.radius} {...paint} />
    case 'arc':
      return <path d={arcPath(graphic)} {...paint} />
  }
}

/** Vertical pins read their labels bottom-to-top, the way a schematic prints them. */
const readUpward = (vertical: boolean, at: SymbolPoint) =>
  vertical ? { transform: `rotate(-90 ${at.x} ${at.y})` } : {}

/** One drawn pin: its line, any bubble or clock wedge, its tip dot, name and number. */
export function DrawnPin({
  pin,
  userPin,
  number,
}: {
  pin: PlacedSymbolPin
  userPin: UserPin
  number: string | undefined
}) {
  const inward = pinInward(pin.side)
  const root = pinRoot(pin, pin.side)
  const lineEnd = pinLineEnd(pin, pin.side)
  const bubble = pinBubble(pin, pin.side)
  const wedge = pinClockWedge(pin, pin.side)
  const vertical = pin.side === 'top' || pin.side === 'bottom'
  // The name starts just inside the body — past the clock wedge, if the pin has one.
  const nameGap = PIN_NAME_GAP + (wedge === null ? 0 : PIN_CLOCK_SIZE)
  const nameAt = { x: root.x + inward.x * nameGap, y: root.y + inward.y * nameGap }
  const nameAnchor = pin.side === 'left' || pin.side === 'bottom' ? 'start' : 'end'
  const middle = { x: (pin.at.x + root.x) / 2, y: (pin.at.y + root.y) / 2 }
  const numberAt = vertical
    ? { x: middle.x - PIN_NUMBER_GAP, y: middle.y }
    : { x: middle.x, y: middle.y - PIN_NUMBER_GAP }
  return (
    <g>
      <line
        x1={pin.at.x}
        y1={pin.at.y}
        x2={lineEnd.x}
        y2={lineEnd.y}
        stroke={STROKE}
        strokeWidth={PIN_LINE_WIDTH}
      />
      {bubble === null ? null : (
        <circle
          cx={bubble.x}
          cy={bubble.y}
          r={PIN_BUBBLE_RADIUS}
          fill={THEME.surfaceRaised}
          stroke={STROKE}
          strokeWidth={PIN_LINE_WIDTH}
        />
      )}
      {wedge === null ? null : (
        <polyline
          points={svgPoints(wedge)}
          fill="none"
          stroke={STROKE}
          strokeWidth={PIN_LINE_WIDTH}
          strokeLinejoin="round"
        />
      )}
      <PinTipDot at={pin.at} driving={DRIVING_PINS.has(userPin.electrical)} />
      {pin.hideName === true || userPin.name === '' ? null : (
        <text
          x={nameAt.x}
          y={nameAt.y}
          textAnchor={nameAnchor}
          {...PIN_NAME_TEXT}
          {...readUpward(vertical, nameAt)}
        >
          {userPin.name}
        </text>
      )}
      {pin.hideNumber === true || number === undefined ? null : (
        <text
          x={numberAt.x}
          y={numberAt.y}
          textAnchor="middle"
          fontSize={8}
          fontFamily="system-ui, sans-serif"
          fill={THEME.textMuted}
          {...readUpward(vertical, numberAt)}
        >
          {number}
        </text>
      )}
    </g>
  )
}

/**
 * The symbol its author drew. A pin's NUMBER is the pad it solders to — the one the board uses (its named
 * pad, else by name, else by order, on this instance's footprint) — or, with no footprint to land on, the
 * pad the author named; with neither there is no honest number to print, so none is.
 */
export function DrawnSymbolGlyph({
  part,
  drawn,
  footprintId,
}: {
  part: UserPart
  drawn: PlacedDrawnSymbol
  footprintId?: string
}) {
  const pinsById = new Map(part.pins.map((p) => [p.id, p]))
  return (
    <svg
      width={drawn.width}
      height={drawn.height}
      viewBox={`0 0 ${drawn.width} ${drawn.height}`}
      aria-hidden="true"
      style={{ display: 'block', overflow: 'visible' }}
    >
      {drawn.graphics.map((graphic, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a shape has no id of its own — its place in the drawing order is its identity
        <DrawnGraphic key={index} graphic={graphic} />
      ))}
      {drawn.pins.map((pin) => {
        const userPin = pinsById.get(pin.pin)
        if (userPin === undefined) return null
        return (
          <DrawnPin
            key={pin.pin}
            pin={pin}
            userPin={userPin}
            number={padForTerminal(part.id, pin.pin, footprintId) ?? userPin.pad}
          />
        )
      })}
    </svg>
  )
}

/** Either picture, chosen by userPartDisplay — what DeviceGlyph draws for any user-made part. */
export function UserPartSymbol({ part, footprintId }: { part: UserPart; footprintId?: string }) {
  const display = userPartDisplay(part)
  if (display.kind === 'box') return <UserPartGlyph part={part} />
  return (
    <DrawnSymbolGlyph
      part={part}
      drawn={display.drawn}
      {...(footprintId !== undefined ? { footprintId } : {})}
    />
  )
}

export const SYMBOL_FIELD_COLOR: Record<SymbolFieldKey, string> = {
  reference: THEME.textMuted,
  value: THEME.accentBlue,
  footprint: THEME.textFaint,
  datasheet: THEME.textFaint,
}
export const SYMBOL_FIELD_FONT_SIZE = 9

/**
 * A drawn symbol's text fields, where its author put them. They stay upright when the part turns (the
 * way a schematic keeps its lettering readable): each anchor turns with the part around the box centre,
 * the text itself does not. Click-through, like the caption under every other part.
 */
export function DrawnSymbolFields({
  drawn,
  rotation,
  texts,
}: {
  drawn: PlacedDrawnSymbol
  rotation: number
  texts: Record<SymbolFieldKey, string | undefined>
}) {
  const centerX = drawn.width / 2
  const centerY = drawn.height / 2
  const angle = (rotation * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return (
    <>
      {SYMBOL_FIELD_KEYS.map((key) => {
        const field = drawn.fields[key]
        const text = texts[key]
        if (!field.visible || text === undefined || text === '') return null
        const dx = field.at.x - centerX
        const dy = field.at.y - centerY
        return (
          <div
            key={key}
            style={{
              position: 'absolute',
              left: centerX + dx * cos - dy * sin,
              top: centerY + dx * sin + dy * cos,
              transform: 'translate(-50%, -50%)',
              color: SYMBOL_FIELD_COLOR[key],
              fontSize: SYMBOL_FIELD_FONT_SIZE,
              lineHeight: 1,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}
          >
            {text}
          </div>
        )
      })}
    </>
  )
}
