import type { Pad } from './footprint.ts'
import { type Board, footprintByPlacement } from './pcb-board.ts'

/**
 * The PCB view — draws a board and the footprints placed on it, the physical counterpart to the
 * schematic canvas. Real board colours: a green FR4 substrate with its edge cut, gold copper pads
 * (drilled holes for through-hole), white silkscreen, and the assembly courtyards faint. Each part is
 * labelled with its schematic id, so the board reads back to the circuit. Pure geometry from
 * pcb-board.ts scaled mm → px; it reads nothing live.
 */

const BOARD = '#0d3b26' // FR4 green
const BOARD_EDGE = '#4ec98a' // the board outline / edge cut
const COPPER = '#d9a441'
const COPPER_EDGE = '#b5852b'
const HOLE = '#06180f' // a drilled hole shows through to the dark substrate
const SILK = '#e8eaed'
const COURTYARD = '#7fe3b0'
const PART_INK = '#dfeee6'

function padShape(p: Pad, scale: number, key: string) {
  const w = p.size.w * scale
  const h = p.size.h * scale
  const cx = p.center.x * scale
  const cy = p.center.y * scale
  const hole =
    p.type === 'through_hole' && p.holeDiameter !== undefined ? (
      <circle cx={cx} cy={cy} r={(p.holeDiameter * scale) / 2} fill={HOLE} />
    ) : null
  if (p.shape === 'circle') {
    return (
      <g key={key}>
        <circle
          cx={cx}
          cy={cy}
          r={Math.min(w, h) / 2}
          fill={COPPER}
          stroke={COPPER_EDGE}
          strokeWidth={0.5}
        />
        {hole}
      </g>
    )
  }
  const rx =
    p.shape === 'roundrect' ? Math.min(w, h) * 0.25 : p.shape === 'oval' ? Math.min(w, h) / 2 : 0
  return (
    <g key={key}>
      <rect
        x={cx - w / 2}
        y={cy - h / 2}
        width={w}
        height={h}
        rx={rx}
        ry={rx}
        fill={COPPER}
        stroke={COPPER_EDGE}
        strokeWidth={0.5}
      />
      {hole}
    </g>
  )
}

export function PcbView({
  board,
  pxPerMm = 12,
  paddingMm = 3,
}: {
  board: Board
  pxPerMm?: number
  paddingMm?: number
}) {
  const o = board.outline
  const minX = o.x - paddingMm
  const minY = o.y - paddingMm
  const wPx = (o.w + 2 * paddingMm) * pxPerMm
  const hPx = (o.h + 2 * paddingMm) * pxPerMm
  const sx = (x: number) => (x - minX) * pxPerMm
  const sy = (y: number) => (y - minY) * pxPerMm

  return (
    <svg
      width={wPx}
      height={hPx}
      viewBox={`0 0 ${wPx} ${hPx}`}
      style={{ display: 'block', fontFamily: 'system-ui, sans-serif' }}
      role="img"
      aria-label="PCB layout"
    >
      <title>PCB layout — {board.placements.length} parts placed</title>
      {/* the FR4 board with its edge cut */}
      <rect
        x={sx(o.x)}
        y={sy(o.y)}
        width={o.w * pxPerMm}
        height={o.h * pxPerMm}
        rx={4}
        fill={BOARD}
        stroke={BOARD_EDGE}
        strokeWidth={1.4}
      />

      {board.placements.map((pl) => {
        const fp = footprintByPlacement(pl)
        if (fp === undefined) return null
        return (
          <g
            key={pl.partId}
            transform={`translate(${sx(pl.x)} ${sy(pl.y)}) rotate(${pl.rotation})`}
          >
            {/* courtyard keep-out, faint */}
            <rect
              x={fp.courtyard.x * pxPerMm}
              y={fp.courtyard.y * pxPerMm}
              width={fp.courtyard.w * pxPerMm}
              height={fp.courtyard.h * pxPerMm}
              fill="none"
              stroke={COURTYARD}
              strokeWidth={0.6}
              strokeDasharray="3 2"
              opacity={0.35}
            />
            {fp.pads.map((p, i) => padShape(p, pxPerMm, `${pl.partId}-p${i}`))}
            {fp.silkscreen.map((s, i) => (
              <line
                key={`${pl.partId}-s${i}`}
                x1={s.from.x * pxPerMm}
                y1={s.from.y * pxPerMm}
                x2={s.to.x * pxPerMm}
                y2={s.to.y * pxPerMm}
                stroke={SILK}
                strokeWidth={Math.max(0.8, s.width * pxPerMm)}
                strokeLinecap="round"
              />
            ))}
            {/* the schematic id, so the board reads back to the circuit */}
            <text
              x={fp.labels.reference.x * pxPerMm}
              y={fp.labels.reference.y * pxPerMm}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={Math.min(1.1 * pxPerMm, 13)}
              fill={PART_INK}
            >
              {pl.partId}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
