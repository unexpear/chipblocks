import { type PointerEvent as ReactPointerEvent, useRef, useState } from 'react'
import type { Pad } from './footprint.ts'
import { type Airwire, type Board, footprintByPlacement, type Rotation } from './pcb-board.ts'
import type { CopperTrace } from './pcb-route.ts'

/**
 * The PCB view — draws a board and the footprints placed on it, the physical counterpart to the
 * schematic canvas. Real board colours: a green FR4 substrate with its edge cut, gold copper pads
 * (drilled holes for through-hole), white silkscreen, and the assembly courtyards faint. Each part is
 * labelled with its schematic id, so the board reads back to the circuit.
 *
 * Interactive when given callbacks (the PCB panel passes them): drag a footprint to move it, click to
 * select, R to rotate the selection a quarter turn — the airwires and the board outline follow live.
 * Geometry comes from pcb-board.ts in real mm scaled mm → px; the pointer maths inverts the same
 * scale, so a part lands exactly where it's dropped.
 */

const BOARD = '#0d3b26' // FR4 green
const BOARD_EDGE = '#4ec98a' // the board outline / edge cut
const COPPER = '#d9a441'
const COPPER_EDGE = '#b5852b'
const HOLE = '#06180f' // a drilled hole shows through to the dark substrate
const SILK = '#e8eaed'
const COURTYARD = '#7fe3b0'
const PART_INK = '#dfeee6'
const AIRWIRE = '#f5f0dc' // thin pale ratsnest lines, the EDA convention
const SELECT = '#9ecbff' // the selected part's halo

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

const nextRotation = (r: Rotation): Rotation => ((r + 90) % 360) as Rotation

export function PcbView({
  board,
  airwires = [],
  traces = [],
  pxPerMm = 12,
  paddingMm = 3,
  onMove,
  onRotate,
}: {
  board: Board
  /** Unrouted connections (the ratsnest) — drawn as thin straight lines pad-to-pad. */
  airwires?: Airwire[]
  /** Routed copper — drawn at real width on the board, under the parts like the top copper layer. */
  traces?: CopperTrace[]
  pxPerMm?: number
  paddingMm?: number
  /** Move a part's footprint origin to (x, y) mm — supplied by the panel to make the board editable. */
  onMove?: (partId: string, x: number, y: number) => void
  /** Turn a part a quarter turn (the R key on the selected part). */
  onRotate?: (partId: string, rotation: Rotation) => void
}) {
  const interactive = onMove !== undefined
  const [selected, setSelected] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  // The live drag: the held part, its origin at grab time, and where the pointer started — all
  // FROZEN at pointerdown. Each move applies only the pointer's client-px delta (scaled to mm) to
  // the grabbed origin. Deliberately frame-free: the outline re-fits while the part moves, and in a
  // bottom-docked panel that shifts the svg's own screen position — re-reading the frame per event
  // would feed that shift back into the position (a runaway). A ref — every needed re-render comes
  // from the placement itself changing upstream.
  const drag = useRef<{
    partId: string
    originX: number
    originY: number
    startClientX: number
    startClientY: number
  } | null>(null)
  // The outline is ALSO frozen for the duration of a drag: the moving part re-fits the outline, and
  // if the render frame followed it live, a part pushing the board's own edge would pin at the
  // margin on screen while the pointer walked away (its motion cancels out of the mm→px map). With
  // the frame held, the part tracks the pointer exactly; the outline snaps to fit once on drop.
  // State, not a ref — clearing it on drop must re-render so the snap actually appears.
  const [frozenOutline, setFrozenOutline] = useState<Board['outline'] | null>(null)

  const o = board.outline
  const frame = frozenOutline ?? o
  const minX = frame.x - paddingMm
  const minY = frame.y - paddingMm
  const wPx = (frame.w + 2 * paddingMm) * pxPerMm
  const hPx = (frame.h + 2 * paddingMm) * pxPerMm
  const sx = (x: number) => (x - minX) * pxPerMm
  const sy = (y: number) => (y - minY) * pxPerMm

  const endDrag = (e: ReactPointerEvent) => {
    if (drag.current === null) return
    drag.current = null
    setFrozenOutline(null)
    if (svgRef.current?.hasPointerCapture(e.pointerId)) {
      svgRef.current.releasePointerCapture(e.pointerId)
    }
  }
  const grabPart = (partId: string, originX: number, originY: number) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return // right/middle press is never a grab (right-drag pans elsewhere)
    setSelected(partId)
    if (onMove === undefined) return
    drag.current = {
      partId,
      originX,
      originY,
      startClientX: e.clientX,
      startClientY: e.clientY,
    }
    setFrozenOutline(board.outline)
    svgRef.current?.setPointerCapture(e.pointerId)
    e.preventDefault()
    // preventDefault also suppressed the click's focus default — focus explicitly, or the R key
    // never reaches this svg and falls through to the schematic's global rotate shortcut.
    svgRef.current?.focus({ preventScroll: true })
  }
  const movePart = (e: ReactPointerEvent) => {
    const d = drag.current
    if (d === null || onMove === undefined) return
    if (e.buttons === 0) {
      // the button is no longer down (a missed pointerup/cancel) — end the drag, don't chase
      endDrag(e)
      return
    }
    onMove(
      d.partId,
      Math.round((d.originX + (e.clientX - d.startClientX) / pxPerMm) * 100) / 100,
      Math.round((d.originY + (e.clientY - d.startClientY) / pxPerMm) * 100) / 100,
    )
  }
  const rotateSelected = () => {
    if (onRotate === undefined || selected === null) return
    const pl = board.placements.find((p) => p.partId === selected)
    if (pl !== undefined) onRotate(selected, nextRotation(pl.rotation))
  }

  return (
    <svg
      ref={svgRef}
      width={wPx}
      height={hPx}
      viewBox={`0 0 ${wPx} ${hPx}`}
      style={{
        display: 'block',
        fontFamily: 'system-ui, sans-serif',
        outline: 'none',
        touchAction: 'none',
      }}
      role="img"
      aria-label="PCB layout"
      tabIndex={interactive ? 0 : undefined}
      onPointerMove={interactive ? movePart : undefined}
      onPointerUp={interactive ? endDrag : undefined}
      onPointerCancel={interactive ? endDrag : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key !== 'r' && e.key !== 'R') return
              // ours alone — without this the same press also fires the schematic's global
              // rotate shortcut and silently turns whatever part is selected on the canvas
              e.stopPropagation()
              e.preventDefault()
              rotateSelected()
            }
          : undefined
      }
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
        onPointerDown={interactive ? () => setSelected(null) : undefined}
      />

      {/* the routed copper — real trace widths, under the parts like the board's top layer */}
      {traces.map((t) => (
        <polyline
          key={`tr${t.net}-${t.points[0]?.x},${t.points[0]?.y}-${t.points[t.points.length - 1]?.x},${t.points[t.points.length - 1]?.y}`}
          points={t.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')}
          fill="none"
          stroke={COPPER}
          strokeWidth={t.widthMm * pxPerMm}
          strokeLinecap="round"
          strokeLinejoin="round"
          data-trace={t.net}
          pointerEvents="none"
        />
      ))}

      {board.placements.map((pl) => {
        const fp = footprintByPlacement(pl)
        if (fp === undefined) return null
        const isSelected = selected === pl.partId
        return (
          <g
            key={pl.partId}
            transform={`translate(${sx(pl.x)} ${sy(pl.y)}) rotate(${pl.rotation})`}
            data-part={pl.partId}
            data-rotation={pl.rotation}
            style={interactive ? { cursor: 'grab' } : undefined}
            onPointerDown={interactive ? grabPart(pl.partId, pl.x, pl.y) : undefined}
          >
            {/* courtyard keep-out (faint) — doubles as the selection halo */}
            <rect
              x={fp.courtyard.x * pxPerMm}
              y={fp.courtyard.y * pxPerMm}
              width={fp.courtyard.w * pxPerMm}
              height={fp.courtyard.h * pxPerMm}
              fill={isSelected ? `${SELECT}22` : 'none'}
              stroke={isSelected ? SELECT : COURTYARD}
              strokeWidth={isSelected ? 1.2 : 0.6}
              strokeDasharray={isSelected ? undefined : '3 2'}
              opacity={isSelected ? 0.9 : 0.35}
            />
            {fp.pads.map((p) => padShape(p, pxPerMm, `${pl.partId}-p${p.id}`))}
            {fp.silkscreen.map((s) => (
              <line
                key={`${pl.partId}-s${s.from.x},${s.from.y},${s.to.x},${s.to.y}`}
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

      {/* the ratsnest: every copper connection the board still owes, straight pad-to-pad */}
      {airwires.map((a) => (
        <line
          key={`aw${a.from.x},${a.from.y}-${a.to.x},${a.to.y}`}
          x1={sx(a.from.x)}
          y1={sy(a.from.y)}
          x2={sx(a.to.x)}
          y2={sy(a.to.y)}
          stroke={AIRWIRE}
          strokeWidth={1}
          opacity={0.75}
          data-airwire="true"
          pointerEvents="none"
        />
      ))}
    </svg>
  )
}
