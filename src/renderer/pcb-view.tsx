import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react'
import type { Pad } from './footprint.ts'
import {
  type Airwire,
  type Board,
  footprintByPlacement,
  outlineRing,
  type PadBox,
  placePoint,
  type Rotation,
  silkReferenceAnchor,
} from './pcb-board.ts'
import { type BoardLayerId, boardLayerIdForCopper, copperTraceColor } from './pcb-layers.ts'
import {
  formatMeasure,
  type Measurement,
  type MeasureUnit,
  measureDelta,
  measureDistanceMm,
} from './pcb-measure.ts'
import { hitCopper, hitPad } from './pcb-pick.ts'
import { ALL_COPPER_LAYERS, type CopperLayer, type CopperTrace, type Via } from './pcb-route.ts'
import { SILK_TEXT, strokeText } from './stroke-font.ts'

/**
 * The PCB view — draws a board and the footprints placed on it, the physical counterpart to the
 * schematic canvas. Real board colours: a green FR4 substrate with its edge cut, gold copper pads
 * (drilled holes for through-hole), white silkscreen, and the assembly courtyards faint.
 *
 * Three view MODES:
 *  - 'flat'   the full top-down layout, all layers at once — the editable board (drag a part, R to
 *             rotate, click to select; the airwires + outline follow live).
 *  - 'layers' the LAMINATION as a stack of paper: one layer at a time, page up/down through the
 *             stack (F.Silkscreen → F.Cu → FR4 core → B.Cu). View-only — you're inspecting a sheet.
 *
 * (The 3-D exploded mode is a further rung.) Geometry comes from pcb-board.ts in real mm scaled
 * mm → px; the pointer maths inverts the same scale, so a part lands exactly where it's dropped.
 */

const BOARD = '#0d3b26' // FR4 green
const BOARD_EDGE = '#4ec98a' // the board outline / edge cut
const COPPER = '#d9a441'
const COPPER_EDGE = '#b5852b'
const HOLE = '#06180f' // a drilled hole shows through to the dark substrate
const SILK = '#e8eaed'
const COURTYARD = '#7fe3b0'
const AIRWIRE = '#f5f0dc' // thin pale ratsnest lines, the EDA convention
const SELECT = '#9ecbff' // the selected part's halo
const VIOLATION = '#ff6b6b' // DRC markers
const AXIS = '#6b8fc0' // the coordinate-reference axes / grid (matches the schematic's axes)
const MEASURE = '#57d1c9' // the measure/ruler tool — teal, distinct from copper + the route colours

/** A ruler read-out: the length (big) + Δx / Δy (small) on a dark chip, centred on a screen point. */
function MeasureLabel({
  px,
  py,
  dist,
  d,
  unit,
}: {
  px: number
  py: number
  dist: number
  d: { dx: number; dy: number }
  unit: MeasureUnit
}) {
  const main = formatMeasure(dist, unit)
  const sub = `Δx ${formatMeasure(Math.abs(d.dx), unit)} · Δy ${formatMeasure(Math.abs(d.dy), unit)}`
  const w = Math.max(main.length, sub.length) * 5.5 + 12
  return (
    <g>
      <rect
        x={px - w / 2}
        y={py - 22}
        width={w}
        height={28}
        rx={4}
        fill="#0b1220"
        opacity={0.85}
        stroke={MEASURE}
        strokeWidth={0.6}
      />
      <text x={px} y={py - 10} textAnchor="middle" fontSize={11} fontWeight={600} fill="#e8eef6">
        {main}
      </text>
      <text x={px} y={py + 1} textAnchor="middle" fontSize={9} fill="#9fb0c3">
        {sub}
      </text>
    </g>
  )
}

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
  vias = [],
  markers = [],
  mode = 'flat',
  activeLayer = 'f_cu',
  pxPerMm = 12,
  paddingMm = 3,
  onMove,
  onMoveStart,
  onRotate,
  routeActive = false,
  padBoxes = [],
  pendingPoints,
  routeCursor,
  routeColor = '#ffcf6b',
  onRouteClick,
  onRouteMove,
  viaActive = false,
  onViaClick,
  measureActive = false,
  measureUnit = 'mm',
  measurements = [],
  pendingMeasureA,
  measureCursor,
  onMeasureClick,
  onMeasureMove,
  coordinateGrid = false,
  outlineActive = false,
  outlineDragIndex = null,
  onOutlineVertexDown,
  onOutlineMove,
  onOutlineVertexUp,
}: {
  board: Board
  /** Unrouted connections (the ratsnest) — drawn as thin straight lines pad-to-pad. */
  airwires?: Airwire[]
  /** Routed copper on both layers — bottom drawn in blue under everything, top in copper gold. */
  traces?: CopperTrace[]
  /** Plated vias — a copper ring with its drilled hole, joining the two layers. */
  vias?: Via[]
  /** DRC violation spots, in board mm — drawn as red rings on top of everything. */
  markers?: { x: number; y: number }[]
  /** 'flat' = the full editable layout; 'layers' = one lamination sheet at a time (view-only). */
  mode?: 'flat' | 'layers'
  /** The sheet shown in 'layers' mode. */
  activeLayer?: BoardLayerId
  pxPerMm?: number
  paddingMm?: number
  /** Move a part's footprint origin to (x, y) mm — supplied by the panel to make the board editable. */
  onMove?: (partId: string, x: number, y: number) => void
  /** A drag has begun to actually MOVE a part (fired once, on the first move — not on a plain click) so
   *  the panel can checkpoint the pre-drag board for undo. */
  onMoveStart?: (partId: string) => void
  /** Turn a part a quarter turn (the R key on the selected part). */
  onRotate?: (partId: string, rotation: Rotation) => void
  /** ROUTE TOOL: when on, clicks lay copper (start on a pad, corners in space, finish on a pad) instead
   *  of dragging parts. `padBoxes` are the clickable pad targets; `pendingPoints` + `routeCursor` draw
   *  the trace being laid; `routeColor` tints it (top = gold, bottom = blue). */
  routeActive?: boolean
  padBoxes?: PadBox[]
  pendingPoints?: { x: number; y: number }[]
  routeCursor?: { x: number; y: number } | null
  routeColor?: string
  /** A click while routing — `pad` is the pad under it (net inference), or null for open board. */
  onRouteClick?: (mm: { x: number; y: number }, pad: PadBox | null) => void
  /** Pointer move while routing — for the rubber-band segment to the cursor. */
  onRouteMove?: (mm: { x: number; y: number }) => void
  /** VIA TOOL: when on, a click on copper (a pad or an existing trace) drops a plated via there that
   *  bridges the two copper layers, carrying that copper's net. */
  viaActive?: boolean
  onViaClick?: (at: { x: number; y: number }, net: string) => void
  /** MEASURE TOOL (a dimensional ruler): click two board points to place a measurement; the live
   *  cursor rubber-bands from the first point, showing the length in `measureUnit` + Δx / Δy. */
  measureActive?: boolean
  measureUnit?: MeasureUnit
  measurements?: Measurement[]
  pendingMeasureA?: { x: number; y: number } | null
  measureCursor?: { x: number; y: number } | null
  onMeasureClick?: (mm: { x: number; y: number }) => void
  onMeasureMove?: (mm: { x: number; y: number }) => void
  /** Draw the coordinate reference behind the board: the x/y axes through the origin (0,0), the four
   *  quadrants (I–IV), and a faint mm grid — the same coordinate system the schematic canvas shows. */
  coordinateGrid?: boolean
  /** OUTLINE TOOL: when on, a draggable handle sits on every board-edge corner (outlineRing). Dragging
   *  one reports the new vertex position in mm (onOutlineMove) so the panel can rewrite the board
   *  profile; outlineDragIndex highlights the grabbed corner. The Gerber edge-cut + edge-clearance DRC
   *  follow the reshaped polygon. */
  outlineActive?: boolean
  outlineDragIndex?: number | null
  onOutlineVertexDown?: (index: number) => void
  onOutlineMove?: (mm: { x: number; y: number }) => void
  onOutlineVertexUp?: () => void
}) {
  // Editing (drag / rotate) belongs only to the full flat layout — the layer sheets are view-only, and
  // the route/via tools take over the pointer when on.
  const interactive =
    onMove !== undefined &&
    mode === 'flat' &&
    !routeActive &&
    !viaActive &&
    !measureActive &&
    !outlineActive
  const [selected, setSelected] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const drag = useRef<{
    partId: string
    originX: number
    originY: number
    startClientX: number
    startClientY: number
    /** Has this gesture actually moved the part yet? Gates the one-per-drag undo checkpoint so a plain
     *  click (select, no move) never floods the undo stack. */
    moved: boolean
  } | null>(null)
  const [frozenOutline, setFrozenOutline] = useState<Board['outline'] | null>(null)
  // The outline tool freezes the frame on its OWN state (not the part-drag frozenOutline) so dragging a
  // vertex doesn't reflow the viewBox out from under the cursor. An effect releases it whenever the tool
  // deactivates, so an Escape / tool-switch mid-drag — which App handles but can't reach into this
  // component to clean up — never leaves the board stuck frozen. A normal release clears it directly.
  const [outlineFrozen, setOutlineFrozen] = useState<Board['outline'] | null>(null)
  useEffect(() => {
    if (!outlineActive) setOutlineFrozen(null)
  }, [outlineActive])

  const o = board.outline
  const frame = frozenOutline ?? outlineFrozen ?? o
  const minX = frame.x - paddingMm
  const minY = frame.y - paddingMm
  const wPx = (frame.w + 2 * paddingMm) * pxPerMm
  const hPx = (frame.h + 2 * paddingMm) * pxPerMm
  const sx = (x: number) => (x - minX) * pxPerMm
  const sy = (y: number) => (y - minY) * pxPerMm

  // screen → board mm (the inverse of sx/sy), and the pad under a board point (net inference for routing)
  const eventToMm = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (rect === undefined) return { x: 0, y: 0 }
    return {
      x: (e.clientX - rect.left) / pxPerMm + minX,
      y: (e.clientY - rect.top) / pxPerMm + minY,
    }
  }

  const endDrag = (e: ReactPointerEvent) => {
    if (drag.current === null) return
    drag.current = null
    setFrozenOutline(null)
    if (svgRef.current?.hasPointerCapture(e.pointerId)) {
      svgRef.current.releasePointerCapture(e.pointerId)
    }
  }
  const grabPart = (partId: string, originX: number, originY: number) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    setSelected(partId)
    if (onMove === undefined) return
    drag.current = {
      partId,
      originX,
      originY,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
    }
    setFrozenOutline(board.outline)
    svgRef.current?.setPointerCapture(e.pointerId)
    e.preventDefault()
    svgRef.current?.focus({ preventScroll: true })
  }
  // OUTLINE tool: grab a board-edge corner. The gesture is captured on the svg (like a part drag) so
  // moves keep flowing even if the cursor leaves the small handle; the frame is frozen at the pre-drag
  // outline so reshaping the polygon (which changes the bbox) doesn't reflow the viewBox mid-drag.
  const grabVertex = (index: number) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation() // this handle owns the gesture — don't also fire the board's deselect
    setOutlineFrozen(board.outline)
    svgRef.current?.setPointerCapture(e.pointerId)
    onOutlineVertexDown?.(index)
    e.preventDefault()
  }
  const endOutlineDrag = (e: ReactPointerEvent) => {
    setOutlineFrozen(null)
    if (svgRef.current?.hasPointerCapture(e.pointerId)) {
      svgRef.current.releasePointerCapture(e.pointerId)
    }
    onOutlineVertexUp?.()
  }
  const movePart = (e: ReactPointerEvent) => {
    const d = drag.current
    if (d === null || onMove === undefined) return
    if (e.buttons === 0) {
      endDrag(e)
      return
    }
    if (!d.moved) {
      // first real motion of this gesture → checkpoint the pre-drag board ONCE (not on a plain click)
      d.moved = true
      onMoveStart?.(d.partId)
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

  // Which layer each feature lives on — so 'layers' mode can show one sheet. In 'flat' mode
  // everything shows at once.
  const show = (layer: BoardLayerId): boolean => mode === 'flat' || activeLayer === layer

  const traceEls = (whichLayer: CopperLayer) =>
    traces
      .filter((t) => t.layer === whichLayer)
      .map((t) => (
        <polyline
          key={`tr${t.net}-${whichLayer}-${t.points[0]?.x},${t.points[0]?.y}-${t.points[t.points.length - 1]?.x},${t.points[t.points.length - 1]?.y}`}
          points={t.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')}
          fill="none"
          stroke={copperTraceColor(whichLayer)}
          strokeWidth={t.widthMm * pxPerMm}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={whichLayer === 'top' ? 1 : 0.85}
          data-trace={t.net}
          data-layer={whichLayer}
          pointerEvents="none"
        />
      ))

  const viaEls = vias.map((v) => (
    <g key={`via${v.at.x},${v.at.y}`} pointerEvents="none" data-via={v.net}>
      <circle
        cx={sx(v.at.x)}
        cy={sy(v.at.y)}
        r={(v.diameterMm / 2) * pxPerMm}
        fill={COPPER}
        stroke={COPPER_EDGE}
        strokeWidth={0.5}
      />
      <circle cx={sx(v.at.x)} cy={sy(v.at.y)} r={(v.drillMm / 2) * pxPerMm} fill={HOLE} />
    </g>
  ))

  // Every drilled hole (through-hole pads + via drills) — what the FR4 core sheet shows.
  const drillEls = () => {
    const holes: { x: number; y: number; d: number; key: string }[] = []
    for (const pl of board.placements) {
      const fp = footprintByPlacement(pl)
      if (fp === undefined) continue
      for (const pad of fp.pads) {
        if (pad.holeDiameter === undefined) continue
        const c = placePoint(pl, pad.center)
        holes.push({ x: c.x, y: c.y, d: pad.holeDiameter, key: `${pl.partId}/${pad.id}` })
      }
    }
    for (const v of vias)
      holes.push({ x: v.at.x, y: v.at.y, d: v.drillMm, key: `via${v.at.x},${v.at.y}` })
    return holes.map((h) => (
      <circle
        key={`drill-${h.key}`}
        cx={sx(h.x)}
        cy={sy(h.y)}
        r={(h.d / 2) * pxPerMm}
        fill={HOLE}
        stroke={COPPER_EDGE}
        strokeWidth={0.4}
        pointerEvents="none"
      />
    ))
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
        cursor:
          routeActive || viaActive || measureActive || outlineActive ? 'crosshair' : undefined,
      }}
      role="img"
      aria-label="PCB layout"
      tabIndex={interactive ? 0 : undefined}
      onClick={
        routeActive
          ? (e) => {
              const mm = eventToMm(e)
              onRouteClick?.(mm, hitPad(padBoxes, mm))
            }
          : viaActive
            ? (e) => {
                const hit = hitCopper(traces, padBoxes, eventToMm(e))
                if (hit !== null) onViaClick?.(hit.at, hit.net)
              }
            : measureActive
              ? (e) => {
                  // snap to a pad centre when the click lands on one — pad-to-pad reads exact
                  const mm = eventToMm(e)
                  const pad = hitPad(padBoxes, mm)
                  onMeasureClick?.(
                    pad !== null ? { x: pad.x + pad.w / 2, y: pad.y + pad.h / 2 } : mm,
                  )
                }
              : undefined
      }
      onPointerMove={(e) => {
        if (interactive) movePart(e)
        if (routeActive) onRouteMove?.(eventToMm(e))
        if (measureActive) onMeasureMove?.(eventToMm(e))
        if (outlineActive) {
          // Recover a vertex drag whose pointerup was missed (button released off-window): end it on the
          // next move with no button held, exactly as movePart does for a part drag.
          if (e.buttons === 0) {
            if (outlineDragIndex !== null) endOutlineDrag(e)
          } else {
            onOutlineMove?.(eventToMm(e))
          }
        }
      }}
      onPointerUp={interactive ? endDrag : outlineActive ? endOutlineDrag : undefined}
      onPointerCancel={interactive ? endDrag : outlineActive ? endOutlineDrag : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key !== 'r' && e.key !== 'R') return
              e.stopPropagation()
              e.preventDefault()
              rotateSelected()
            }
          : undefined
      }
    >
      <title>PCB layout — {board.placements.length} parts placed</title>

      {/* coordinate reference behind the board: the mm grid, the x/y axes through the origin (0,0), and
          the four quadrants (I–IV) — our coordinate system, the same one the schematic canvas draws. */}
      {coordinateGrid &&
        (() => {
          const ox = sx(0)
          const oy = sy(0)
          const stepMm = 5
          const xLo = Math.ceil(minX / stepMm) * stepMm
          const xHi = minX + wPx / pxPerMm
          const yLo = Math.ceil(minY / stepMm) * stepMm
          const yHi = minY + hPx / pxPerMm
          const grid: number[][] = []
          for (let gx = xLo; gx <= xHi; gx += stepMm) grid.push([sx(gx), 0, sx(gx), hPx])
          for (let gy = yLo; gy <= yHi; gy += stepMm) grid.push([0, sy(gy), wPx, sy(gy)])
          return (
            <g pointerEvents="none" data-coord-grid="true">
              {grid.map(([x1, y1, x2, y2]) => (
                <line
                  key={`cg${x1},${y1},${x2},${y2}`}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={AXIS}
                  strokeWidth={0.5}
                  opacity={0.14}
                />
              ))}
              <line x1={0} y1={oy} x2={wPx} y2={oy} stroke={AXIS} strokeWidth={1} opacity={0.5} />
              <line x1={ox} y1={0} x2={ox} y2={hPx} stroke={AXIS} strokeWidth={1} opacity={0.5} />
              <circle
                cx={ox}
                cy={oy}
                r={3}
                fill="none"
                stroke={AXIS}
                strokeWidth={1}
                opacity={0.6}
              />
              <g
                fill={AXIS}
                fontFamily="Georgia, serif"
                fontStyle="italic"
                fontSize={13}
                opacity={0.5}
              >
                <text x={ox + 8} y={oy - 8}>
                  I
                </text>
                <text x={ox - 16} y={oy - 8}>
                  II
                </text>
                <text x={ox - 18} y={oy + 16}>
                  III
                </text>
                <text x={ox + 8} y={oy + 16}>
                  IV
                </text>
                <text x={ox + 6} y={oy - 26} fontSize={11}>
                  y
                </text>
                <text x={ox + 26} y={oy - 6} fontSize={11}>
                  x
                </text>
              </g>
            </g>
          )
        })()}

      {/* the FR4 board with its edge cut — the sheet everything sits on. On the core layer it is
          the solid FR4 slab; on the other sheets it is the faint board outline for context. A hand-drawn
          profile renders as its real polygon; a plain board stays the rounded rectangle. */}
      {board.profile !== undefined ? (
        <polygon
          points={outlineRing(board)
            .map((p) => `${sx(p.x)},${sy(p.y)}`)
            .join(' ')}
          fill={mode === 'flat' || activeLayer === 'core' ? BOARD : 'none'}
          stroke={BOARD_EDGE}
          strokeWidth={1.4}
          strokeLinejoin="round"
          opacity={mode === 'layers' && activeLayer !== 'core' ? 0.4 : 1}
          onPointerDown={interactive ? () => setSelected(null) : undefined}
        />
      ) : (
        <rect
          x={sx(o.x)}
          y={sy(o.y)}
          width={o.w * pxPerMm}
          height={o.h * pxPerMm}
          rx={4}
          fill={mode === 'flat' || activeLayer === 'core' ? BOARD : 'none'}
          stroke={BOARD_EDGE}
          strokeWidth={1.4}
          opacity={mode === 'layers' && activeLayer !== 'core' ? 0.4 : 1}
          onPointerDown={interactive ? () => setSelected(null) : undefined}
        />
      )}

      {/* FR4 core sheet: the drilled holes that pass through the substrate */}
      {show('core') && drillEls()}

      {/* copper traces, deepest layer first so the top gold sits on top: bottom, inner (deep→shallow),
          then top. Inner layers only exist on a 4-/6-layer board. */}
      {[...ALL_COPPER_LAYERS]
        .reverse()
        .map((cl) =>
          show(boardLayerIdForCopper(cl)) ? <g key={`traces-${cl}`}>{traceEls(cl)}</g> : null,
        )}

      {/* vias join the two copper sheets — shown whenever either copper sheet is up */}
      {(show('f_cu') || show('b_cu')) && viaEls}

      {/* pads: all pads on the top copper; only the through-hole pads' rings on the bottom copper */}
      {(show('f_cu') || show('b_cu')) &&
        board.placements.map((pl) => {
          const fp = footprintByPlacement(pl)
          if (fp === undefined) return null
          const isSelected = selected === pl.partId
          // on the bottom sheet only through-hole pads have copper
          const pads = show('f_cu') ? fp.pads : fp.pads.filter((p) => p.type === 'through_hole')
          if (pads.length === 0) return null
          return (
            <g
              key={`pads-${pl.partId}`}
              transform={`translate(${sx(pl.x)} ${sy(pl.y)}) rotate(${pl.rotation})`}
              data-part={pl.partId}
              data-rotation={pl.rotation}
              style={interactive ? { cursor: 'grab' } : undefined}
              onPointerDown={interactive ? grabPart(pl.partId, pl.x, pl.y) : undefined}
            >
              {mode === 'flat' && (
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
              )}
              {pads.map((p) => padShape(p, pxPerMm, `${pl.partId}-p${p.id}`))}
            </g>
          )
        })}

      {/* F.Silkscreen sheet: the part outlines + courtyards */}
      {show('f_silk') &&
        board.placements.map((pl) => {
          const fp = footprintByPlacement(pl)
          if (fp === undefined) return null
          return (
            <g key={`silk-${pl.partId}`} pointerEvents="none">
              {mode === 'layers' && (
                <g transform={`translate(${sx(pl.x)} ${sy(pl.y)}) rotate(${pl.rotation})`}>
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
                </g>
              )}
              {fp.silkscreen.map((s) => {
                const a = placePoint(pl, s.from)
                const b = placePoint(pl, s.to)
                return (
                  <line
                    key={`${pl.partId}-s${s.from.x},${s.from.y},${s.to.x},${s.to.y}`}
                    x1={sx(a.x)}
                    y1={sy(a.y)}
                    x2={sx(b.x)}
                    y2={sy(b.y)}
                    stroke={SILK}
                    strokeWidth={Math.max(0.8, s.width * pxPerMm)}
                    strokeLinecap="round"
                  />
                )
              })}
            </g>
          )
        })}

      {/* reference designators — the REAL silkscreen lettering, on the F.Silkscreen sheet */}
      {show('f_silk') &&
        board.placements.map((pl) => {
          const fp = footprintByPlacement(pl)
          if (fp === undefined) return null
          const text = strokeText(
            pl.designator ?? pl.partId,
            silkReferenceAnchor(pl, fp),
            SILK_TEXT.heightMm,
          )
          return (
            <g key={`ref-${pl.partId}`} pointerEvents="none" data-silk-ref={pl.partId}>
              {text.segments.map((s) => (
                <line
                  key={`${pl.partId}-t${s.from.x},${s.from.y}-${s.to.x},${s.to.y}`}
                  x1={sx(s.from.x)}
                  y1={sy(s.from.y)}
                  x2={sx(s.to.x)}
                  y2={sy(s.to.y)}
                  stroke={SILK}
                  strokeWidth={Math.max(0.8, SILK_TEXT.thicknessMm * pxPerMm)}
                  strokeLinecap="round"
                />
              ))}
            </g>
          )
        })}

      {/* the ratsnest (unrouted copper owed) — only on the full flat layout */}
      {mode === 'flat' &&
        airwires.map((a) => (
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

      {/* DRC violation markers — a red ring at each spot, on top of everything (both modes) */}
      {markers.map((m) => (
        <g key={`drc${m.x},${m.y}`} pointerEvents="none" data-drc-marker="true">
          <circle
            cx={sx(m.x)}
            cy={sy(m.y)}
            r={7}
            fill="none"
            stroke={VIOLATION}
            strokeWidth={1.6}
          />
          <circle cx={sx(m.x)} cy={sy(m.y)} r={1.8} fill={VIOLATION} />
        </g>
      ))}

      {/* ROUTE/VIA TOOL overlay: the clickable pads (dots) + the trace being laid (committed corners as a
          solid polyline, plus a dashed rubber-band from the last corner to the cursor). */}
      {(routeActive || viaActive) && (
        <g pointerEvents="none" data-route-overlay="true">
          {padBoxes.map((pb) => (
            <circle
              key={`routepad-${pb.pad}`}
              cx={sx(pb.x + pb.w / 2)}
              cy={sy(pb.y + pb.h / 2)}
              r={2.4}
              fill="none"
              stroke={SELECT}
              strokeWidth={1}
              opacity={0.75}
              data-route-pad={pb.pad}
              data-net={pb.net}
            />
          ))}
          {pendingPoints !== undefined && pendingPoints.length > 0 && (
            <>
              {pendingPoints.length > 1 && (
                <polyline
                  points={pendingPoints.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')}
                  fill="none"
                  stroke={routeColor}
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  data-pending-route="true"
                />
              )}
              {routeCursor !== undefined && routeCursor !== null && (
                <polyline
                  points={(() => {
                    const last = pendingPoints[pendingPoints.length - 1]
                    if (last === undefined) return ''
                    // preview the H-then-V orthogonal segment to the cursor
                    return `${sx(last.x)},${sy(last.y)} ${sx(routeCursor.x)},${sy(last.y)} ${sx(routeCursor.x)},${sy(routeCursor.y)}`
                  })()}
                  fill="none"
                  stroke={routeColor}
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  opacity={0.8}
                />
              )}
              {pendingPoints.map((p) => (
                <circle
                  key={`pendingpt-${p.x},${p.y}`}
                  cx={sx(p.x)}
                  cy={sy(p.y)}
                  r={2}
                  fill={routeColor}
                />
              ))}
            </>
          )}
        </g>
      )}

      {/* MEASURE / RULER overlay: placed measurements (a solid dimension line + endpoints + the length
          & Δx/Δy read-out) plus the pending rubber-band from the first point to the live cursor. */}
      {measureActive && (
        <g pointerEvents="none" data-measure-overlay="true">
          {measurements.map((m) => {
            const dist = measureDistanceMm(m.a, m.b)
            const d = measureDelta(m.a, m.b)
            return (
              <g key={`meas-${m.a.x},${m.a.y}-${m.b.x},${m.b.y}`}>
                <line
                  x1={sx(m.a.x)}
                  y1={sy(m.a.y)}
                  x2={sx(m.b.x)}
                  y2={sy(m.b.y)}
                  stroke={MEASURE}
                  strokeWidth={1.5}
                />
                <circle cx={sx(m.a.x)} cy={sy(m.a.y)} r={2.6} fill={MEASURE} />
                <circle cx={sx(m.b.x)} cy={sy(m.b.y)} r={2.6} fill={MEASURE} />
                <MeasureLabel
                  px={(sx(m.a.x) + sx(m.b.x)) / 2}
                  py={(sy(m.a.y) + sy(m.b.y)) / 2}
                  dist={dist}
                  d={d}
                  unit={measureUnit}
                />
              </g>
            )
          })}
          {pendingMeasureA !== undefined && pendingMeasureA !== null && (
            <>
              <circle
                cx={sx(pendingMeasureA.x)}
                cy={sy(pendingMeasureA.y)}
                r={2.6}
                fill={MEASURE}
              />
              {measureCursor !== undefined && measureCursor !== null && (
                <>
                  <line
                    x1={sx(pendingMeasureA.x)}
                    y1={sy(pendingMeasureA.y)}
                    x2={sx(measureCursor.x)}
                    y2={sy(measureCursor.y)}
                    stroke={MEASURE}
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    opacity={0.85}
                  />
                  <MeasureLabel
                    px={(sx(pendingMeasureA.x) + sx(measureCursor.x)) / 2}
                    py={(sy(pendingMeasureA.y) + sy(measureCursor.y)) / 2}
                    dist={measureDistanceMm(pendingMeasureA, measureCursor)}
                    d={measureDelta(pendingMeasureA, measureCursor)}
                    unit={measureUnit}
                  />
                </>
              )}
            </>
          )}
        </g>
      )}

      {/* OUTLINE tool: a draggable handle on every board-edge corner. Dragging one reshapes the board
          profile (the Gerber edge-cut + the edge-clearance / component-to-edge DRC follow it). Unlike the
          read-only overlays above these are interactive, so each captures its own pointerdown. */}
      {outlineActive && (
        <g data-outline-overlay="true">
          {outlineRing(board).map((p, i) => (
            <circle
              key={`outline-handle-${p.x}-${p.y}`}
              cx={sx(p.x)}
              cy={sy(p.y)}
              r={5}
              fill={i === outlineDragIndex ? SELECT : BOARD_EDGE}
              stroke="#0b1220"
              strokeWidth={1.5}
              style={{ cursor: 'grab' }}
              onPointerDown={grabVertex(i)}
            />
          ))}
        </g>
      )}
    </svg>
  )
}
