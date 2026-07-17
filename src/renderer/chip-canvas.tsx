/**
 * THE INTERACTIVE CHIP CANVAS — the chip floorplan as a real working graph-space (like the Circuit
 * editor, adapted for silicon). Pan (drag the empty die), zoom (wheel, centred on the cursor), and click
 * a cell to select + inspect it. A colouring-lens toggle recolours the die by module / gate / density.
 *
 * It reads the placed floorplan (cell-place.ts `placeCells`) MERGED with the persisted hand-placement
 * overrides (chip-layout.ts) — the auto layout ⊕ your edits — so it renders the saved layer, not a live
 * re-derivation. A hand-rolled viewBox pan/zoom is used rather than a second React Flow instance: the
 * die is thousands of cells, far past React Flow's per-node budget, and drawing them as one SVG keeps it
 * fast (with a row-band fallback above a cap, like the read-only floorplan had).
 *
 * Units are λ throughout (the viewBox is in λ); µm is shown in the readout via PROCESS.lambdaUm.
 */

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { PROCESS } from './cell-layout.ts'
import type { Floorplan, PlacedCell } from './cell-place.ts'
import type { ChipCellOverride, ChipLensMode } from './chip-layout.ts'
import { buildCellColorer } from './chip-lens.ts'
import { THEME } from './theme.ts'

/** Above this many cells, draw one rect per ROW instead of per cell, bounding the element count. */
const CELL_RENDER_CAP = 12000

type View = { x: number; y: number; w: number; h: number }

/** Frame the die (λ bounds) into a viewBox matching the pane's aspect, with a little padding. */
function fitView(die: { w: number; h: number }, aspect: number): View {
  const pad = 0.06
  const w = die.w * (1 + pad * 2)
  const h = die.h * (1 + pad * 2)
  // widen whichever dimension is too tight so the die isn't distorted by the pane aspect
  const viewAspect = w / h
  const [vw, vh] = viewAspect > aspect ? [w, w / aspect] : [h * aspect, h]
  return { x: die.w / 2 - vw / 2, y: die.h / 2 - vh / 2, w: vw, h: vh }
}

/** base floorplan ⊕ persisted overrides (an override wins on id; size/name/row stay from the base). */
export function mergeOverrides(cells: PlacedCell[], overrides: ChipCellOverride[]): PlacedCell[] {
  if (overrides.length === 0) return cells
  const by = new Map(overrides.map((o) => [o.id, o]))
  return cells.map((c) => {
    const o = by.get(c.id)
    return o ? { ...c, x: o.x, y: o.y } : c
  })
}

const LENSES: { id: ChipLensMode; label: string }[] = [
  { id: 'module', label: 'Module' },
  { id: 'gate', label: 'Gate' },
  { id: 'density', label: 'Density' },
]

export function ChipCanvas({
  plan,
  overrides,
  lens,
  onLens,
  onMoveCell,
  light,
}: {
  plan: Floorplan
  overrides: ChipCellOverride[]
  lens: ChipLensMode
  onLens: (mode: ChipLensMode) => void
  /** Commit a dragged cell's new position (λ). */
  onMoveCell?: (cellId: string, x: number, y: number) => void
  light: boolean
}) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const cells = useMemo(() => mergeOverrides(plan.cells, overrides), [plan.cells, overrides])
  const colorer = useMemo(() => buildCellColorer({ ...plan, cells }, lens), [plan, cells, lens])
  const perCell = cells.length <= CELL_RENDER_CAP
  const rowBands = useMemo(() => {
    if (perCell) return []
    const widthByRow = new Map<number, number>()
    for (const c of cells) {
      const right = c.x + c.w
      if (right > (widthByRow.get(c.row) ?? 0)) widthByRow.set(c.row, right)
    }
    return [...widthByRow.entries()].map(([row, width]) => ({ row, width }))
  }, [cells, perCell])

  const die = useMemo(
    () => ({ w: plan.dieWidthLambda, h: plan.dieHeightLambda }),
    [plan.dieWidthLambda, plan.dieHeightLambda],
  )
  const [view, setView] = useState<View>(() => fitView(die, 16 / 9))
  const [selected, setSelected] = useState<string | null>(null)
  const pan = useRef<{ px: number; py: number; view: View } | null>(null)
  const drag = useRef<{
    id: string
    startX: number
    startY: number
    cellX: number
    cellY: number
    moved: boolean
  } | null>(null)
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null)

  // Re-fit when a different design is placed (die identity changes) — but not on every pan/zoom.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-fit only when the die dimensions change
  useLayoutEffect(() => {
    const el = svgRef.current
    const aspect = el ? el.clientWidth / Math.max(1, el.clientHeight) : 16 / 9
    setView(fitView(die, aspect))
    setSelected(null)
  }, [die.w, die.h])

  const toLambda = (clientX: number, clientY: number): { x: number; y: number } => {
    const el = svgRef.current
    if (!el) return { x: 0, y: 0 }
    const r = el.getBoundingClientRect()
    return {
      x: view.x + ((clientX - r.left) / r.width) * view.w,
      y: view.y + ((clientY - r.top) / r.height) * view.h,
    }
  }

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12
    const p = toLambda(e.clientX, e.clientY)
    // keep the cursor point fixed while scaling the view around it
    setView((v) => {
      const w = Math.min(die.w * 8, Math.max(die.w * 0.02, v.w * factor))
      const h = w * (v.h / v.w)
      return { x: p.x - (p.x - v.x) * (w / v.w), y: p.y - (p.y - v.y) * (h / v.h), w, h }
    })
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const id = (e.target as Element).getAttribute?.('data-cell-id')
    if (id) {
      setSelected(id)
      // click-drag a cell → move it (if editing is enabled); a click without moving just selects.
      const cell = onMoveCell ? cells.find((c) => c.id === id) : undefined
      if (cell) {
        const p = toLambda(e.clientX, e.clientY)
        drag.current = { id, startX: p.x, startY: p.y, cellX: cell.x, cellY: cell.y, moved: false }
        try {
          ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
        } catch {}
      }
      return
    }
    // empty space → begin panning
    pan.current = { px: e.clientX, py: e.clientY, view }
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (drag.current) {
      const d = drag.current
      const p = toLambda(e.clientX, e.clientY)
      if (Math.abs(p.x - d.startX) > 1 || Math.abs(p.y - d.startY) > 1) d.moved = true
      const rowH = PROCESS.rowHeight.lambda
      // snap Y to the row grid so cells stay on shared-rail rows; X is free (rounded to a whole λ).
      setDragPos({
        id: d.id,
        x: Math.round(d.cellX + (p.x - d.startX)),
        y: Math.max(0, Math.round((d.cellY + (p.y - d.startY)) / rowH) * rowH),
      })
      return
    }
    const p = pan.current
    if (!p) return
    const el = svgRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const dx = ((e.clientX - p.px) / r.width) * p.view.w
    const dy = ((e.clientY - p.py) / r.height) * p.view.h
    setView({ ...p.view, x: p.view.x - dx, y: p.view.y - dy })
  }
  const endPan = () => {
    if (drag.current) {
      if (drag.current.moved && dragPos && onMoveCell) onMoveCell(dragPos.id, dragPos.x, dragPos.y)
      drag.current = null
      setDragPos(null)
    }
    pan.current = null
  }

  const selectedCell = selected ? cells.find((c) => c.id === selected) : undefined
  const stroke = light ? THEME.borderStrong : THEME.textSoft

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 10,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: 0 }}>
          {LENSES.map((l, i) => (
            <button
              key={l.id}
              type="button"
              onClick={() => onLens(l.id)}
              style={{
                border: `1px solid ${THEME.borderStrong}`,
                borderLeft: i === 0 ? undefined : 'none',
                borderRadius:
                  i === 0 ? '4px 0 0 4px' : i === LENSES.length - 1 ? '0 4px 4px 0' : '0',
                background: lens === l.id ? THEME.accentBlue : THEME.surfaceInput,
                color: lens === l.id ? '#0b1220' : THEME.textSoft,
                fontSize: 11,
                padding: '3px 10px',
                cursor: 'pointer',
              }}
            >
              {l.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            const el = svgRef.current
            const aspect = el ? el.clientWidth / Math.max(1, el.clientHeight) : 16 / 9
            setView(fitView(die, aspect))
          }}
          style={{
            border: `1px solid ${THEME.borderStrong}`,
            borderRadius: 4,
            background: THEME.surfaceInput,
            color: THEME.textSoft,
            fontSize: 11,
            padding: '3px 10px',
            cursor: 'pointer',
          }}
        >
          Fit
        </button>
        <span style={{ fontSize: 11, color: THEME.textFaint }}>
          drag empty space to pan · scroll to zoom · drag a cell to move it
        </span>
        {selectedCell && (
          <span
            style={{ fontSize: 12, color: THEME.textBright, fontVariantNumeric: 'tabular-nums' }}
          >
            {selectedCell.name} · {(selectedCell.w * PROCESS.lambdaUm).toFixed(1)} ×{' '}
            {(selectedCell.h * PROCESS.lambdaUm).toFixed(0)} µm · ({Math.round(selectedCell.x)},{' '}
            {Math.round(selectedCell.y)}) λ
          </span>
        )}
      </div>
      <div
        style={{
          border: `1px solid ${THEME.borderSubtle}`,
          borderRadius: 8,
          background: THEME.surfaceInput,
          overflow: 'hidden',
        }}
      >
        <svg
          ref={svgRef}
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          width="100%"
          height={460}
          preserveAspectRatio="xMidYMid meet"
          style={{
            display: 'block',
            cursor: pan.current || drag.current ? 'grabbing' : 'grab',
            touchAction: 'none',
          }}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPan}
          onPointerLeave={endPan}
          role="img"
          aria-label={`Chip floorplan canvas: ${cells.length} cells`}
        >
          <rect
            x={0}
            y={0}
            width={die.w}
            height={die.h}
            fill={THEME.surfaceBase}
            stroke={stroke}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
          {perCell
            ? cells.map((c) => {
                const dp = dragPos && dragPos.id === c.id ? dragPos : null
                return (
                  <rect
                    key={c.id}
                    data-cell-id={c.id}
                    x={dp ? dp.x : c.x}
                    y={dp ? dp.y : c.y}
                    width={c.w}
                    height={c.h}
                    fill={colorer(c)}
                    opacity={dp ? 1 : 0.9}
                  />
                )
              })
            : rowBands.map((b) => (
                <rect
                  key={b.row}
                  x={0}
                  y={b.row * PROCESS.rowHeight.lambda}
                  width={b.width}
                  height={PROCESS.rowHeight.lambda}
                  fill="#3fb27f"
                  opacity={0.85}
                />
              ))}
          {selectedCell && (
            <rect
              x={dragPos && dragPos.id === selectedCell.id ? dragPos.x : selectedCell.x}
              y={dragPos && dragPos.id === selectedCell.id ? dragPos.y : selectedCell.y}
              width={selectedCell.w}
              height={selectedCell.h}
              fill="none"
              stroke={THEME.textBright}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          )}
        </svg>
      </div>
    </div>
  )
}
