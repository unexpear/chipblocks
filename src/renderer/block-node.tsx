import { Handle, type NodeProps, Position } from '@xyflow/react'
import { type CSSProperties, Fragment, useContext } from 'react'
import { type BlockData, type BlockPort, blockLayout } from './blocks.ts'
import { GateFace, gateLayout } from './gate-symbol.tsx'
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

type LitSeg = { on: boolean; color: string }

/**
 * Three figure-8 digits side by side, each segment lit from its real LED's solved state — plus a
 * decimal point + comma between every pair (the comma is the point with a tail), each its own LED.
 * Exactly the single-digit face, three across; the box has an intrinsic wide size so it isn't squeezed.
 */
function MultiDigitFace({
  width,
  height,
  digits,
  seps,
}: {
  width: number
  height: number
  digits: Record<string, LitSeg>[]
  seps: { dp: LitSeg; comma: LitSeg }[]
}) {
  const colW = width / digits.length
  const dw = colW * 0.42
  const dh = height * 0.62
  const t = (height - dh) / 2
  const baseY = t + dh
  const stroke = Math.max(2.5, dw * 0.14)
  const dotR = Math.max(2, stroke * 0.62)
  const off = THEME.borderStrong
  const glow = (color: string) => ({ filter: `drop-shadow(0 0 3px ${color})` })
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative digit face, hidden from the accessibility tree
    <svg
      aria-hidden
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      {digits.map((segs, d) => {
        const l = colW * d + colW / 2 - dw / 2
        const geom: SegGeom = {
          l,
          r: l + dw,
          t,
          m: t + dh / 2,
          b: baseY,
          p: Math.min(dw, dh) * 0.07,
        }
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: the three digit positions are fixed and ordered
          <Fragment key={`dig-${d}`}>
            {SEGMENT_ORDER.map((seg) => {
              const [x1, y1, x2, y2] = SEG_LINE[seg](geom)
              const on = segs[seg]?.on === true
              const color = segs[seg]?.color ?? THEME.statusDanger
              return (
                <line
                  key={seg}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={on ? color : off}
                  strokeWidth={stroke}
                  strokeLinecap="round"
                  opacity={on ? 1 : 0.4}
                  style={on ? glow(color) : undefined}
                />
              )
            })}
          </Fragment>
        )
      })}
      {seps.map((sep, s) => {
        const sepX = colW * s + colW / 2 + dw / 2 + dotR + 3
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: the two separator slots are fixed and ordered
          <Fragment key={`sep-${s}`}>
            <circle
              cx={sepX}
              cy={baseY}
              r={dotR}
              fill={sep.dp.on ? sep.dp.color : off}
              opacity={sep.dp.on ? 1 : 0.18}
              style={sep.dp.on ? glow(sep.dp.color) : undefined}
            />
            <circle
              cx={sepX}
              cy={baseY}
              r={dotR}
              fill={sep.comma.on ? sep.comma.color : off}
              opacity={sep.comma.on ? 1 : 0.18}
              style={sep.comma.on ? glow(sep.comma.color) : undefined}
            />
            <path
              d={`M ${sepX + dotR * 0.5} ${baseY + dotR * 0.4} Q ${sepX} ${baseY + dotR * 2.4} ${sepX - dotR * 1.1} ${baseY + dotR * 3}`}
              stroke={sep.comma.on ? sep.comma.color : off}
              strokeWidth={dotR * 0.9}
              strokeLinecap="round"
              fill="none"
              opacity={sep.comma.on ? 1 : 0.18}
              style={sep.comma.on ? glow(sep.comma.color) : undefined}
            />
          </Fragment>
        )
      })}
    </svg>
  )
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

/** A dot-matrix LED screen face — a grid of dots, each lit in its real LED's colour or dim. */
function DotMatrixFace({
  width,
  height,
  matrix,
}: {
  width: number
  height: number
  matrix: LitSeg[][]
}) {
  const rows = matrix.length
  const cols = matrix[0]?.length ?? 1
  const cw = width / cols
  const ch = height / rows
  const rad = Math.max(1.6, Math.min(cw, ch) * 0.36)
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative LED-grid face, hidden from the accessibility tree
    <svg
      aria-hidden
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      {matrix.flatMap((row, ri) =>
        row.map((px, ci) => (
          <circle
            key={`px-${ri}-${ci}`}
            cx={cw * (ci + 0.5)}
            cy={ch * (ri + 0.5)}
            r={rad}
            fill={px.on ? px.color : THEME.borderStrong}
            opacity={px.on ? 1 : 0.22}
            style={px.on ? { filter: `drop-shadow(0 0 3px ${px.color})` } : undefined}
          />
        )),
      )}
    </svg>
  )
}

/** A tiny standalone separator face — a decimal point and a comma LED, sitting in their own small block
 *  between calculator digits. Shows at most one (the calculator lights either the dp or the comma). */
function SeparatorFace({
  width,
  height,
  dp,
  comma,
}: {
  width: number
  height: number
  dp: LitSeg
  comma: LitSeg
}) {
  const cx = width / 2
  const cy = height * 0.74
  const r = Math.max(2.5, Math.min(width, height) * 0.16)
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative separator face, hidden from the accessibility tree
    <svg
      aria-hidden
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      {dp.on && (
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill={dp.color}
          style={{ filter: `drop-shadow(0 0 3px ${dp.color})` }}
        />
      )}
      {comma.on && (
        <>
          <circle cx={cx} cy={cy} r={r} fill={comma.color} />
          <path
            d={`M ${cx} ${cy} L ${cx - r} ${cy + r * 2.4}`}
            stroke={comma.color}
            strokeWidth={r}
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 3px ${comma.color})` }}
          />
        </>
      )}
    </svg>
  )
}

export function BlockNode({ id, data }: NodeProps) {
  const block = (data as { block?: BlockData }).block
  const healthMap = useContext(HealthContext)
  const health = healthMap.get(id)
  if (!block) return null
  // A logic gate wears its standard symbol (canonical pin layout); every other block keeps the box layout.
  const { width, height, placed } = block.symbol
    ? gateLayout(block.ports)
    : blockLayout(block.ports, block.size)
  // A seven-segment display reads its inner LEDs' solved lit-state (namespaced after flatten).
  const readSeg = (key: string): LitSeg => {
    const h = healthMap.get(key)
    return { on: h?.lit === true, color: h?.glow ?? THEME.statusDanger }
  }
  const ledPrefix = block.ledPath ? `${block.ledPath}.` : ''
  const segments: Record<string, LitSeg> | null =
    block.display === 'seven_segment'
      ? Object.fromEntries(
          SEGMENT_ORDER.map((seg) => [seg, readSeg(`${id}.${ledPrefix}led_${seg}`)]),
        )
      : null
  // A standalone separator module (display='separator') — a decimal point + a comma LED, drawn between
  // calculator digits so the point/comma sit in their own small block, not crammed onto a digit.
  const sep: { dp: LitSeg; comma: LitSeg } | null =
    block.display === 'separator'
      ? { dp: readSeg(`${id}.led_dp`), comma: readSeg(`${id}.led_comma`) }
      : null
  // A dot-matrix LED screen (display='dot_matrix') — read each pixel's inner LED lit-state into a grid.
  const matrix: LitSeg[][] | null =
    block.display === 'dot_matrix'
      ? Array.from({ length: block.rows ?? 7 }, (_, r) =>
          Array.from({ length: block.cols ?? 5 }, (_, c) => readSeg(`${id}.led_${r}_${c}`)),
        )
      : null
  // The multi-digit display reads N×7 segments plus a point + comma between each adjacent pair — N from
  // the block's own `digits`, so any size renders from the one face.
  const digitCount = block.display === 'seven_segment_multi' ? (block.digits ?? 3) : 0
  const digitsMulti: Record<string, LitSeg>[] | null =
    digitCount > 0
      ? Array.from({ length: digitCount }, (_, d) =>
          // each digit is a bare display sub-block `digit<d>`, so its LEDs live one level down
          Object.fromEntries(
            SEGMENT_ORDER.map((seg) => [seg, readSeg(`${id}.digit${d}.led_${seg}`)]),
          ),
        )
      : null
  const sepsMulti: { dp: LitSeg; comma: LitSeg }[] | null =
    digitCount > 1
      ? Array.from({ length: digitCount - 1 }, (_, s) => ({
          dp: readSeg(`${id}.led_dp_${s}`),
          comma: readSeg(`${id}.led_comma_${s}`),
        }))
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
          border: block.symbol
            ? 'none'
            : health?.failed
              ? `1.5px solid ${THEME.statusDanger}`
              : health?.warned
                ? `1.5px solid ${THEME.statusWarn}`
                : `1.5px solid ${THEME.textMuted}`,
          borderRadius: 6,
          background: block.symbol ? 'transparent' : THEME.surfacePanel,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {block.symbol ? (
          <GateFace
            symbol={block.symbol}
            inputCoords={placed.filter((p) => p.side === 'left').map((p) => p.coord)}
            stroke={
              health?.failed
                ? THEME.statusDanger
                : health?.warned
                  ? THEME.statusWarn
                  : THEME.textPrimary
            }
          />
        ) : digitsMulti && sepsMulti ? (
          <MultiDigitFace width={width} height={height} digits={digitsMulti} seps={sepsMulti} />
        ) : segments ? (
          <SevenSegmentFace width={width} height={height} segments={segments} />
        ) : sep ? (
          <SeparatorFace width={width} height={height} dp={sep.dp} comma={sep.comma} />
        ) : matrix ? (
          <DotMatrixFace width={width} height={height} matrix={matrix} />
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
        // a gate wears only its power labels (V+/GND); the shape itself names the in/out pins
        const showLabel = !block.symbol || port.id === 'v_dd' || port.id === 'gnd'
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
            {text && showLabel ? (
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
