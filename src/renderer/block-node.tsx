import { Handle, type NodeProps, Position } from '@xyflow/react'
import { type CSSProperties, Fragment, useContext } from 'react'
import { type BlockData, type BlockPort, blockLayout } from './blocks.ts'
import { HealthContext } from './health.ts'
import { THEME } from './theme.ts'

/**
 * A circuit block on the canvas (S19-v3-67) — ONE node showing its name + its pins, like a chip
 * package: pins sit on the FOUR edges (blockLayout centers them per edge, so they always stay on the
 * perimeter), and power pins are marked +/− in red/blue exactly as a real chip marks its supply pins.
 * The real parts live inside (double-click to descend); the solver always works on those, never the box.
 */

const POS: Record<BlockPort['side'], Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
}

/** A power pin's colour + marker; a signal pin is a neutral dot with no marker (no false polarity). */
function pinLook(kind: BlockPort['kind']): { color: string; glyph: string } {
  if (kind === 'power_positive') return { color: THEME.statusDanger, glyph: '+' }
  if (kind === 'power_negative') return { color: THEME.accentBlueDeep, glyph: '−' }
  return { color: THEME.textMuted, glyph: '' }
}

/** The pin's label position just INSIDE the box, next to its handle on whichever edge it's on. */
function labelStyle(side: BlockPort['side'], coord: number): CSSProperties {
  if (side === 'left') return { left: 5, top: coord, transform: 'translateY(-50%)' }
  if (side === 'right')
    return { right: 5, top: coord, transform: 'translateY(-50%)', textAlign: 'right' }
  if (side === 'top') return { top: 4, left: coord, transform: 'translateX(-50%)' }
  return { bottom: 4, left: coord, transform: 'translateX(-50%)' }
}

const SEGMENT_ORDER = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const
type SegGeom = { l: number; r: number; t: number; m: number; b: number; p: number }
/** Each segment's two endpoints in the digit box (l/r/t/m/b edges, p = corner inset). */
const SEG_LINE: Record<
  (typeof SEGMENT_ORDER)[number],
  (g: SegGeom) => [number, number, number, number]
> = {
  a: ({ l, r, t, p }) => [l + p, t, r - p, t],
  b: ({ r, t, m, p }) => [r, t + p, r, m - p],
  c: ({ r, m, b, p }) => [r, m + p, r, b - p],
  d: ({ l, r, b, p }) => [l + p, b, r - p, b],
  e: ({ l, m, b, p }) => [l, m + p, l, b - p],
  f: ({ l, t, m, p }) => [l, t + p, l, m - p],
  g: ({ l, r, m, p }) => [l + p, m, r - p, m],
}

/** The figure-8 face of a seven-segment display: each segment lit in its LED's real colour, or dim. */
function SevenSegmentFace({
  width,
  height,
  segments,
}: {
  width: number
  height: number
  segments: Record<string, { on: boolean; color: string }>
}) {
  const dw = width * 0.42
  const dh = height * 0.74
  const l = (width - dw) / 2
  const t = (height - dh) / 2
  const geom: SegGeom = { l, r: l + dw, t, m: t + dh / 2, b: t + dh, p: Math.min(dw, dh) * 0.07 }
  const stroke = Math.max(3, dw * 0.13)
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative digit face, hidden from the accessibility tree
    <svg
      aria-hidden
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      {SEGMENT_ORDER.map((seg) => {
        const [x1, y1, x2, y2] = SEG_LINE[seg](geom)
        const on = segments[seg]?.on === true
        const color = segments[seg]?.color ?? THEME.statusDanger
        return (
          <line
            key={seg}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={on ? color : THEME.borderStrong}
            strokeWidth={stroke}
            strokeLinecap="round"
            opacity={on ? 1 : 0.5}
            style={on ? { filter: `drop-shadow(0 0 3px ${color})` } : undefined}
          />
        )
      })}
    </svg>
  )
}

export function BlockNode({ id, data }: NodeProps) {
  const block = (data as { block?: BlockData }).block
  const healthMap = useContext(HealthContext)
  const health = healthMap.get(id)
  if (!block) return null
  const { width, height, placed } = blockLayout(block.ports)
  // A seven-segment display reads its seven inner LEDs' solved lit-state (namespaced after flatten).
  const segments: Record<string, { on: boolean; color: string }> | null =
    block.display === 'seven_segment'
      ? Object.fromEntries(
          SEGMENT_ORDER.map((seg) => {
            const segHealth = healthMap.get(`${id}.led_${seg}`)
            return [
              seg,
              { on: segHealth?.lit === true, color: segHealth?.glow ?? THEME.statusDanger },
            ]
          }),
        )
      : null
  return (
    <div
      className={health?.failed ? 'cb-shake' : undefined}
      title={`${block.name} — a circuit block (${block.nodes.length} parts inside, ${block.ports.length} pins). Double-click to see the real circuit it is made of.`}
      style={{ position: 'relative', width, height, fontFamily: 'system-ui, sans-serif' }}
    >
      {health?.failed ? <div className="cb-danger" /> : null}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          border: health?.failed
            ? `1.5px solid ${THEME.statusDanger}`
            : health?.warned
              ? `1.5px solid ${THEME.statusWarn}`
              : `1.5px solid ${THEME.textMuted}`,
          borderRadius: 6,
          background: THEME.surfacePanel,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {segments ? (
          <SevenSegmentFace width={width} height={height} segments={segments} />
        ) : (
          <span style={{ color: THEME.textBright, fontSize: 11, fontWeight: 700 }}>
            {block.name}
          </span>
        )}
      </div>
      {placed.map(({ port, side, coord }) => {
        const look = pinLook(port.kind)
        const onSide = side === 'left' || side === 'right'
        const polarity =
          port.kind === 'power_positive'
            ? ' (+ power)'
            : port.kind === 'power_negative'
              ? ' (− power)'
              : ''
        const text = `${look.glyph}${look.glyph && port.name ? ' ' : ''}${port.name ?? ''}`
        return (
          <Fragment key={port.id}>
            <Handle
              id={port.id}
              type="source"
              position={POS[side]}
              title={`${port.name ?? port.label}${polarity} — this pin IS the internal terminal ${port.label}`}
              style={{
                ...(onSide ? { top: coord } : { left: coord }),
                background: look.color,
                width: 9,
                height: 9,
              }}
            />
            {text ? (
              <div
                style={{
                  position: 'absolute',
                  ...labelStyle(side, coord),
                  fontSize: 8,
                  fontWeight: 600,
                  color: look.color,
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                }}
              >
                {text}
              </div>
            ) : null}
          </Fragment>
        )
      })}
      <div
        style={{
          position: 'absolute',
          top: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          color: THEME.textMuted,
          fontSize: 9,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}
      >
        {String((data as { label?: string }).label ?? id)}
        {health?.failed ? (
          <span title={health.note} style={{ marginLeft: 5 }}>
            💥
          </span>
        ) : health?.warned ? (
          <span title={health.note} style={{ marginLeft: 5 }}>
            ⚠️
          </span>
        ) : null}
      </div>
    </div>
  )
}
