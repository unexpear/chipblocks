/**
 * THE FOOTPRINT EDITOR — drawing a physical package on a canvas.
 *
 * Until this existed a footprint could only be one of the shipped constants, so a part whose package
 * wasn't already in the library simply could not go on a board. Here you draw one: drag pads around,
 * stamp a whole row from the three numbers a datasheet prints, drag the assembly keep-out, and the
 * package becomes something a part can land on.
 *
 * The drawing happens ON the canvas — pads are dragged, the courtyard is dragged. The number fields are
 * for the values a datasheet states exactly (a 0.5 mm pitch is 0.5 mm, not "about where I dropped it");
 * dragging and typing edit the same geometry, so neither is the "real" way.
 *
 * Everything geometric lives in footprint-draft.ts, and every problem shown comes from
 * user-footprint-validate.ts — the same rules the file loader enforces, so a package that saves here is
 * one that survives a reload.
 */

import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type Courtyard,
  extentOfRect,
  type Footprint,
  mergeExtent,
  type Pad,
  type PadShape,
  type PadType,
  padsExtent,
} from './footprint.ts'
import {
  blankFootprintDraft,
  draftCourtyard,
  draftFromFootprint,
  draftToFootprint,
  type FootprintDraft,
  generatePadRow,
  nextPadNumber,
  type PadRowSpec,
  slugFootprintId,
  snapMm,
} from './footprint-draft.ts'
import { type Bounds, clientToView, fitView, panByPx, type View, zoomAt } from './pcb-viewport.ts'
import { THEME } from './theme.ts'
import { footprintProblems } from './user-footprint-validate.ts'
import { isBuiltinFootprintId, isUserFootprint, registerUserFootprint } from './user-footprints.ts'

/** Canvas scale: view coordinates are mm × this, so the viewport maths works in whole pixels. */
const PX_PER_MM = 40
const CANVAS_HEIGHT = 430
const MIN_VIEW_MM = 1
const MAX_VIEW_MM = 400

// Real-PCB colours, matching the read-only viewer — a footprint reads as itself in any app theme.
const BOARD = '#0c0c0e'
const COPPER = '#d9a441'
const COPPER_EDGE = '#b5852b'
const COPPER_SELECTED = '#ffd98a'
const SILK = '#e8eaed'
const FAB = '#8a7a5a'
const COURTYARD = '#a06ad8'
const GRID_LINE = '#1e1e24'
const GRID_LINE_MAJOR = '#2b2b34'
const ORIGIN = '#5b5b62'
const PAD_INK = '#241a06'

type Drag =
  | { kind: 'pan'; lastX: number; lastY: number }
  /** Cursor-to-centre offset, so a pad doesn't jump to the cursor when you grab its edge. */
  | { kind: 'pad'; index: number; offsetX: number; offsetY: number }
  | { kind: 'courtyard'; corner: 'tl' | 'br' }

export function FootprintEditor({
  initial,
  onClose,
  onSaved,
}: {
  /** An existing footprint to edit; omitted for a new one. */
  initial?: Footprint
  onClose: () => void
  onSaved?: (footprint: Footprint) => void
}) {
  const [draft, setDraft] = useState<FootprintDraft>(() =>
    initial ? draftFromFootprint(initial) : blankFootprintDraft(),
  )
  /** Whether the id is following the name — stops once the user types an id of their own. */
  const [idLinked, setIdLinked] = useState(initial === undefined)
  // Pads are selected by POSITION, not by name. Two pads can briefly share a name while you retype
  // one (the validator flags it), and addressing them by name would edit both at once — typing '2'
  // over pad 1 would silently destroy pad 2.
  const [selectedPadIndex, setSelectedPadIndex] = useState<number | null>(null)
  const [tool, setTool] = useState<'select' | 'add'>('select')
  const [view, setView] = useState<View>({ x: -200, y: -200, w: 400, h: 400 })
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const userView = useRef(false)

  const [rowSpec, setRowSpec] = useState<Omit<PadRowSpec, 'shape' | 'type'>>({
    side: 'top',
    count: 12,
    pitchMm: 0.5,
    widthMm: 0.28,
    lengthMm: 0.8,
    offsetMm: 3.4,
    startNumber: 1,
    reverse: false,
  })
  const [rowShape, setRowShape] = useState<PadShape>('roundrect')
  const [rowType, setRowType] = useState<PadType>('smd')
  const [rowDrillMm, setRowDrillMm] = useState(0.9)
  /** What the last 'Add row' actually did, when it wasn't simply all of it. */
  const [rowNote, setRowNote] = useState<string | null>(null)
  /** Armed once the user has been told Save would overwrite an existing package. */
  const [confirmReplace, setConfirmReplace] = useState(false)

  const courtyard = draftCourtyard(draft)
  const footprint = useMemo(() => draftToFootprint(draft), [draft])
  const problems = useMemo(() => footprintProblems(footprint), [footprint])
  const selectedPad = selectedPadIndex === null ? null : (draft.pads[selectedPadIndex] ?? null)

  const contentBounds = useCallback((): Bounds => {
    const seen = mergeExtent(extentOfRect(draftCourtyard(draft)), padsExtent(draft.pads))
    return {
      x: seen.minX * PX_PER_MM,
      y: seen.minY * PX_PER_MM,
      w: Math.max(seen.maxX - seen.minX, 0.5) * PX_PER_MM,
      h: Math.max(seen.maxY - seen.minY, 0.5) * PX_PER_MM,
    }
  }, [draft])

  // Read the bounds through a ref, for two reasons. The observer below can then subscribe ONCE:
  // depending on contentBounds directly would tear down and re-create it on every draft change, and
  // each fresh observe() fires immediately, so the view would re-fit on every step of a pad drag and
  // the pad would crawl away from the cursor. And `fitToDraft` stays stable, so the refit queued after
  // "Add row" measures the draft WITH the new row in it rather than the one captured before it.
  const contentBoundsRef = useRef(contentBounds)
  contentBoundsRef.current = contentBounds

  const fitToDraft = useCallback(() => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.height === 0) return
    userView.current = false
    setView(fitView(contentBoundsRef.current(), rect.width / rect.height, 0.14))
  }, [])

  // Fit once the canvas has a size, and keep the aspect honest if the dialog is resized.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const observer = new ResizeObserver(() => {
      const rect = svg.getBoundingClientRect()
      if (rect.height === 0) return
      const aspect = rect.width / rect.height
      if (!userView.current) {
        setView(fitView(contentBoundsRef.current(), aspect, 0.14))
        return
      }
      // Panned/zoomed already — keep the centre, just re-match the new shape of the box.
      setView((v) => {
        const w = v.h * aspect
        return { x: v.x + (v.w - w) / 2, y: v.y, w, h: v.h }
      })
    })
    observer.observe(svg)
    return () => observer.disconnect()
  }, [])

  // Escape closes from anywhere in the dialog. A handler on the dialog element only fires for events
  // bubbling out of a focused descendant, so it would work while typing in a field but not while the
  // canvas — the thing you actually use — has focus.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const eventToMm = (event: { clientX: number; clientY: number }) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    const point = clientToView(view, rect, event.clientX, event.clientY)
    return { x: point.x / PX_PER_MM, y: point.y / PX_PER_MM }
  }

  const updatePad = (index: number, change: (pad: Pad) => Pad) => {
    setDraft((d) => ({ ...d, pads: d.pads.map((p, i) => (i === index ? change(p) : p)) }))
  }

  const addPadAt = (x: number, y: number) => {
    setDraft((d) => {
      const id = nextPadNumber(d.pads)
      const template = d.pads[d.pads.length - 1]
      const pad: Pad = {
        id,
        center: { x: snapMm(x), y: snapMm(y) },
        size: template ? { ...template.size } : { w: 1, h: 1 },
        shape: template?.shape ?? 'roundrect',
        type: template?.type ?? 'smd',
      }
      if (pad.type === 'through_hole') {
        pad.holeDiameter = template?.holeDiameter ?? 0.9
      }
      setSelectedPadIndex(d.pads.length)
      return { ...d, pads: [...d.pads, pad] }
    })
  }

  const onCanvasPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    const mm = eventToMm(event)
    if (tool === 'add') {
      addPadAt(mm.x, mm.y)
      setTool('select')
      return
    }
    setSelectedPadIndex(null)
    dragRef.current = { kind: 'pan', lastX: event.clientX, lastY: event.clientY }
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  const grabPad = (event: React.PointerEvent, pad: Pad, index: number) => {
    if (event.button !== 0 || tool === 'add') return
    event.stopPropagation()
    const mm = eventToMm(event)
    setSelectedPadIndex(index)
    dragRef.current = {
      kind: 'pad',
      index,
      offsetX: pad.center.x - mm.x,
      offsetY: pad.center.y - mm.y,
    }
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  const grabCourtyard = (event: React.PointerEvent, corner: 'tl' | 'br') => {
    if (event.button !== 0) return
    event.stopPropagation()
    dragRef.current = { kind: 'courtyard', corner }
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag) return
    if (drag.kind === 'pan') {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect) return
      userView.current = true
      setView((v) => panByPx(v, rect, event.clientX - drag.lastX, event.clientY - drag.lastY))
      dragRef.current = { kind: 'pan', lastX: event.clientX, lastY: event.clientY }
      return
    }
    const mm = eventToMm(event)
    if (drag.kind === 'pad') {
      updatePad(drag.index, (pad) => ({
        ...pad,
        center: { x: snapMm(mm.x + drag.offsetX), y: snapMm(mm.y + drag.offsetY) },
      }))
      return
    }
    setDraft((d) => {
      // Snap every edge, not just the dragged corner: the fitted courtyard it starts from is derived
      // arithmetic, so an unsnapped subtraction would put floating-point dust into a manufacturing file.
      const current = draftCourtyard(d)
      const cursorX = snapMm(mm.x)
      const cursorY = snapMm(mm.y)
      const left = snapMm(current.x)
      const top = snapMm(current.y)
      const right = snapMm(current.x + current.w)
      const bottom = snapMm(current.y + current.h)
      const next: Courtyard =
        drag.corner === 'tl'
          ? { x: cursorX, y: cursorY, w: snapMm(right - cursorX), h: snapMm(bottom - cursorY) }
          : { x: left, y: top, w: snapMm(cursorX - left), h: snapMm(cursorY - top) }
      if (next.w < 0.1 || next.h < 0.1) return d
      return { ...d, manualCourtyard: next }
    })
  }

  const endDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    if (dragRef.current === null) return
    dragRef.current = null
    svgRef.current?.releasePointerCapture(event.pointerId)
  }

  const onWheelZoom = (event: React.WheelEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    userView.current = true
    const anchor = clientToView(view, rect, event.clientX, event.clientY)
    setView((v) =>
      zoomAt(
        v,
        event.deltaY > 0 ? 1.15 : 1 / 1.15,
        anchor,
        MIN_VIEW_MM * PX_PER_MM,
        MAX_VIEW_MM * PX_PER_MM,
      ),
    )
  }

  const addRow = () => {
    const pads = generatePadRow({
      ...rowSpec,
      shape: rowShape,
      type: rowType,
      ...(rowType === 'through_hole' ? { holeDiameterMm: rowDrillMm } : {}),
    })
    // Never let a row overwrite a pad name that's already used — the datasheet numbers a package once.
    const taken = new Set(draft.pads.map((p) => p.id))
    const clashing = pads.filter((p) => taken.has(p.id)).map((p) => p.id)
    const fresh = pads.filter((p) => !taken.has(p.id))
    // Say so rather than appearing to do nothing: the row silently shrinking is indistinguishable
    // from a dead button, and the numbers that vanished are the ones the datasheet gave.
    setRowNote(
      clashing.length === 0
        ? null
        : `Skipped pad ${clashing.join(', ')} — ${clashing.length === 1 ? 'that number is' : 'those numbers are'} already used. Change "First no." to add ${clashing.length === pads.length ? 'this row' : 'the rest'}.`,
    )
    if (fresh.length === 0) return
    setDraft((d) => ({ ...d, pads: [...d.pads, ...fresh] }))
    setRowSpec((s) => ({ ...s, startNumber: s.startNumber + Math.max(0, Math.floor(s.count)) }))
    userView.current = false
    requestAnimationFrame(fitToDraft)
  }

  const setName = (name: string) => {
    setDraft((d) => ({ ...d, name, id: idLinked ? slugFootprintId(name) : d.id }))
  }

  /** Saving over a package that already exists reshapes it everywhere it is placed — say so first. */
  const replacesExisting =
    draft.id.trim() !== '' && draft.id.trim() !== initial?.id && isUserFootprint(draft.id.trim())

  const save = () => {
    if (problems.length > 0) return
    if (replacesExisting && !confirmReplace) {
      setConfirmReplace(true)
      return
    }
    if (!registerUserFootprint(footprint)) return
    onSaved?.(footprint)
    onClose()
  }

  // View-space helpers for drawing (mm → the viewBox's content pixels).
  const vx = (mm: number) => mm * PX_PER_MM
  const gridLines = useMemo(() => {
    const stepMm = view.w / PX_PER_MM > 40 ? 5 : view.w / PX_PER_MM > 12 ? 1 : 0.5
    const x0 = Math.floor(view.x / PX_PER_MM / stepMm) * stepMm
    const y0 = Math.floor(view.y / PX_PER_MM / stepMm) * stepMm
    const xs: number[] = []
    const ys: number[] = []
    for (let x = x0; x <= (view.x + view.w) / PX_PER_MM; x += stepMm) xs.push(x)
    for (let y = y0; y <= (view.y + view.h) / PX_PER_MM; y += stepMm) ys.push(y)
    return { xs, ys, stepMm }
  }, [view])

  const padFill = (index: number) => (index === selectedPadIndex ? COPPER_SELECTED : COPPER)

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a modal backdrop click-to-close, standard
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-close; Escape handled on the dialog
    <div
      onClick={onClose}
      data-modal="footprint-editor"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the dialog stops backdrop clicks reaching close */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: this onClick only stops propagation — it triggers nothing; Escape is handled window-wide above */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 1020,
          maxWidth: '96vw',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          background: THEME.surfacePanel,
          border: `1px solid ${THEME.borderStrong}`,
          borderRadius: 10,
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '11px 14px',
            borderBottom: `1px solid ${THEME.borderSubtle}`,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: THEME.textBright }}>
            {initial ? 'Edit footprint' : 'New footprint'}
          </span>
          <span style={{ fontSize: 11, color: THEME.textFaint }}>
            the physical package a part solders to — drag pads, or stamp a row from a datasheet
          </span>
        </div>

        <div style={{ display: 'flex', minHeight: 0, flex: 1 }}>
          {/* ── the canvas ── */}
          <div style={{ flex: 1, minWidth: 0, background: BOARD, position: 'relative' }}>
            <svg
              ref={svgRef}
              width="100%"
              height={CANVAS_HEIGHT}
              viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
              preserveAspectRatio="none"
              style={{
                display: 'block',
                touchAction: 'none',
                cursor: tool === 'add' ? 'crosshair' : 'grab',
              }}
              role="img"
              aria-label="Footprint editor canvas"
              onPointerDown={onCanvasPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onWheel={onWheelZoom}
              onDoubleClick={fitToDraft}
            >
              <title>Footprint editor canvas</title>
              {gridLines.xs.map((x) => (
                <line
                  key={`gx-${x}`}
                  x1={vx(x)}
                  y1={view.y}
                  x2={vx(x)}
                  y2={view.y + view.h}
                  stroke={Math.abs(x % 1) < 1e-9 ? GRID_LINE_MAJOR : GRID_LINE}
                  strokeWidth={view.w / 900}
                />
              ))}
              {gridLines.ys.map((y) => (
                <line
                  key={`gy-${y}`}
                  x1={view.x}
                  y1={vx(y)}
                  x2={view.x + view.w}
                  y2={vx(y)}
                  stroke={Math.abs(y % 1) < 1e-9 ? GRID_LINE_MAJOR : GRID_LINE}
                  strokeWidth={view.w / 900}
                />
              ))}

              {/* the component body, under the copper */}
              {footprint.fabrication.map((line) => (
                <line
                  key={`fab-${line.from.x},${line.from.y}-${line.to.x},${line.to.y}`}
                  x1={vx(line.from.x)}
                  y1={vx(line.from.y)}
                  x2={vx(line.to.x)}
                  y2={vx(line.to.y)}
                  stroke={FAB}
                  strokeWidth={Math.max(vx(line.width), view.w / 700)}
                  strokeLinecap="round"
                />
              ))}
              {footprint.silkscreen.map((line) => (
                <line
                  key={`silk-${line.from.x},${line.from.y}-${line.to.x},${line.to.y}`}
                  x1={vx(line.from.x)}
                  y1={vx(line.from.y)}
                  x2={vx(line.to.x)}
                  y2={vx(line.to.y)}
                  stroke={SILK}
                  strokeWidth={Math.max(vx(line.width), view.w / 700)}
                  strokeLinecap="round"
                />
              ))}

              {/* the keep-out, with a handle on each opposing corner */}
              <rect
                x={vx(courtyard.x)}
                y={vx(courtyard.y)}
                width={vx(courtyard.w)}
                height={vx(courtyard.h)}
                fill="none"
                stroke={COURTYARD}
                strokeWidth={view.w / 500}
                strokeDasharray={`${view.w / 120} ${view.w / 170}`}
                opacity={0.8}
              />
              {(
                [
                  ['tl', courtyard.x, courtyard.y],
                  ['br', courtyard.x + courtyard.w, courtyard.y + courtyard.h],
                ] as const
              ).map(([corner, hx, hy]) => (
                <rect
                  key={`court-${corner}`}
                  x={vx(hx) - view.w / 90}
                  y={vx(hy) - view.w / 90}
                  width={view.w / 45}
                  height={view.w / 45}
                  fill={COURTYARD}
                  opacity={0.9}
                  style={{ cursor: corner === 'tl' ? 'nwse-resize' : 'nwse-resize' }}
                  onPointerDown={(e) => grabCourtyard(e, corner)}
                />
              ))}

              {draft.pads.map((pad, index) => {
                const w = vx(pad.size.w)
                const h = vx(pad.size.h)
                const cx = vx(pad.center.x)
                const cy = vx(pad.center.y)
                const rx =
                  pad.shape === 'roundrect'
                    ? Math.min(w, h) * 0.25
                    : pad.shape === 'oval'
                      ? Math.min(w, h) / 2
                      : 0
                return (
                  // Keyed by name AND place: two pads can share a name for a keystroke while one is
                  // being retyped, and they are still different pads.
                  <g
                    key={`pad-${pad.id}@${pad.center.x},${pad.center.y}`}
                    style={{ cursor: 'move' }}
                  >
                    {pad.shape === 'circle' ? (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={Math.min(w, h) / 2}
                        fill={padFill(index)}
                        stroke={COPPER_EDGE}
                        strokeWidth={view.w / 600}
                        onPointerDown={(e) => grabPad(e, pad, index)}
                      />
                    ) : (
                      <rect
                        x={cx - w / 2}
                        y={cy - h / 2}
                        width={w}
                        height={h}
                        rx={rx}
                        ry={rx}
                        fill={padFill(index)}
                        stroke={COPPER_EDGE}
                        strokeWidth={view.w / 600}
                        onPointerDown={(e) => grabPad(e, pad, index)}
                      />
                    )}
                    {pad.type === 'through_hole' && pad.holeDiameter !== undefined ? (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={vx(pad.holeDiameter) / 2}
                        fill={BOARD}
                        pointerEvents="none"
                      />
                    ) : null}
                    <text
                      x={cx}
                      y={cy}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={Math.min(h * 0.55, w * 0.8, view.w / 22)}
                      fontWeight={700}
                      fill={PAD_INK}
                      pointerEvents="none"
                    >
                      {pad.id}
                    </text>
                  </g>
                )
              })}

              <g stroke={ORIGIN} strokeWidth={view.w / 500} opacity={0.8} pointerEvents="none">
                <line x1={-view.w / 40} y1={0} x2={view.w / 40} y2={0} />
                <line x1={0} y1={-view.w / 40} x2={0} y2={view.w / 40} />
              </g>
            </svg>

            <div
              style={{
                position: 'absolute',
                left: 8,
                bottom: 8,
                display: 'flex',
                gap: 6,
                alignItems: 'center',
              }}
            >
              <CanvasButton active={tool === 'add'} onClick={() => setTool('add')}>
                + Pad
              </CanvasButton>
              <CanvasButton active={false} onClick={fitToDraft}>
                Fit
              </CanvasButton>
              <span style={{ fontSize: 10.5, color: THEME.textFaint }}>
                {gridLines.stepMm} mm grid · drag to pan · wheel to zoom · double-click to fit
              </span>
            </div>
          </div>

          {/* ── the numbers ── */}
          <div
            style={{
              width: 340,
              flexShrink: 0,
              borderLeft: `1px solid ${THEME.borderSubtle}`,
              overflowY: 'auto',
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <Section title="Package">
              <label style={fieldLabel}>
                Name
                <input
                  style={textInput}
                  value={draft.name}
                  placeholder="QFN-48 7×7 mm"
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label style={fieldLabel}>
                Id
                <input
                  style={{
                    ...textInput,
                    borderColor: isBuiltinFootprintId(draft.id)
                      ? THEME.statusDanger
                      : THEME.borderStrong,
                  }}
                  value={draft.id}
                  placeholder="QFN-48_7x7mm"
                  onChange={(e) => {
                    setIdLinked(false)
                    setConfirmReplace(false)
                    setDraft((d) => ({ ...d, id: e.target.value }))
                  }}
                />
              </label>
              <label style={fieldLabel}>
                Description
                <input
                  style={textInput}
                  value={draft.description}
                  placeholder="48-lead QFN, 0.5 mm pitch"
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                />
              </label>
            </Section>

            <Section title="Add a row of pads" hint="the numbers a datasheet's land pattern gives">
              <div style={fieldRow}>
                <label style={fieldLabel}>
                  Side
                  <select
                    style={textInput}
                    value={rowSpec.side}
                    onChange={(e) =>
                      setRowSpec((s) => ({ ...s, side: e.target.value as PadRowSpec['side'] }))
                    }
                  >
                    <option value="top">top</option>
                    <option value="bottom">bottom</option>
                    <option value="left">left</option>
                    <option value="right">right</option>
                  </select>
                </label>
                <NumberField
                  label="Pads"
                  value={rowSpec.count}
                  step={1}
                  onChange={(v) => setRowSpec((s) => ({ ...s, count: v }))}
                />
                <NumberField
                  label="Pitch mm"
                  value={rowSpec.pitchMm}
                  step={0.05}
                  onChange={(v) => setRowSpec((s) => ({ ...s, pitchMm: v }))}
                />
              </div>
              <div style={fieldRow}>
                <NumberField
                  label="Width mm"
                  value={rowSpec.widthMm}
                  step={0.05}
                  onChange={(v) => setRowSpec((s) => ({ ...s, widthMm: v }))}
                />
                <NumberField
                  label="Length mm"
                  value={rowSpec.lengthMm}
                  step={0.05}
                  onChange={(v) => setRowSpec((s) => ({ ...s, lengthMm: v }))}
                />
                <NumberField
                  label="Offset mm"
                  value={rowSpec.offsetMm}
                  step={0.05}
                  onChange={(v) => setRowSpec((s) => ({ ...s, offsetMm: v }))}
                />
              </div>
              <div style={fieldRow}>
                <NumberField
                  label="First no."
                  value={rowSpec.startNumber}
                  step={1}
                  onChange={(v) => setRowSpec((s) => ({ ...s, startNumber: v }))}
                />
                <label style={fieldLabel}>
                  Shape
                  <select
                    style={textInput}
                    value={rowShape}
                    onChange={(e) => setRowShape(e.target.value as PadShape)}
                  >
                    <option value="roundrect">roundrect</option>
                    <option value="rect">rect</option>
                    <option value="oval">oval</option>
                    <option value="circle">circle</option>
                  </select>
                </label>
                <label style={fieldLabel}>
                  Type
                  <select
                    style={textInput}
                    value={rowType}
                    onChange={(e) => setRowType(e.target.value as PadType)}
                  >
                    <option value="smd">smd</option>
                    <option value="through_hole">through-hole</option>
                  </select>
                </label>
              </div>
              <div style={fieldRow}>
                {rowType === 'through_hole' ? (
                  <NumberField
                    label="Drill mm"
                    value={rowDrillMm}
                    step={0.05}
                    onChange={setRowDrillMm}
                  />
                ) : null}
                <label
                  style={{
                    ...fieldLabel,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    textTransform: 'none',
                    fontSize: 11,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={rowSpec.reverse === true}
                    onChange={(e) => setRowSpec((s) => ({ ...s, reverse: e.target.checked }))}
                  />
                  count backwards
                </label>
              </div>
              <button type="button" style={primaryButton} onClick={addRow}>
                Add row of {Math.max(0, Math.floor(rowSpec.count))}
              </button>
              {rowNote !== null ? (
                <span style={{ fontSize: 10.5, lineHeight: 1.45, color: THEME.statusWarn }}>
                  {rowNote}
                </span>
              ) : null}
            </Section>

            {selectedPad !== null && selectedPadIndex !== null ? (
              <Section title={`Pad ${selectedPad.id}`} hint="or drag it on the canvas">
                <div style={fieldRow}>
                  <label style={fieldLabel}>
                    Name
                    <input
                      style={textInput}
                      value={selectedPad.id}
                      onChange={(e) =>
                        updatePad(selectedPadIndex, (p) => ({ ...p, id: e.target.value }))
                      }
                    />
                  </label>
                  <NumberField
                    label="X mm"
                    value={selectedPad.center.x}
                    step={0.05}
                    onChange={(v) =>
                      updatePad(selectedPadIndex, (p) => ({ ...p, center: { ...p.center, x: v } }))
                    }
                  />
                  <NumberField
                    label="Y mm"
                    value={selectedPad.center.y}
                    step={0.05}
                    onChange={(v) =>
                      updatePad(selectedPadIndex, (p) => ({ ...p, center: { ...p.center, y: v } }))
                    }
                  />
                </div>
                <div style={fieldRow}>
                  <NumberField
                    label="W mm"
                    value={selectedPad.size.w}
                    step={0.05}
                    onChange={(v) =>
                      updatePad(selectedPadIndex, (p) => ({ ...p, size: { ...p.size, w: v } }))
                    }
                  />
                  <NumberField
                    label="H mm"
                    value={selectedPad.size.h}
                    step={0.05}
                    onChange={(v) =>
                      updatePad(selectedPadIndex, (p) => ({ ...p, size: { ...p.size, h: v } }))
                    }
                  />
                  {selectedPad.type === 'through_hole' ? (
                    <NumberField
                      label="Drill mm"
                      value={selectedPad.holeDiameter ?? 0}
                      step={0.05}
                      onChange={(v) =>
                        updatePad(selectedPadIndex, (p) => ({ ...p, holeDiameter: v }))
                      }
                    />
                  ) : null}
                </div>
                <div style={fieldRow}>
                  <label style={fieldLabel}>
                    Shape
                    <select
                      style={textInput}
                      value={selectedPad.shape}
                      onChange={(e) =>
                        updatePad(selectedPadIndex, (p) => ({
                          ...p,
                          shape: e.target.value as PadShape,
                        }))
                      }
                    >
                      <option value="roundrect">roundrect</option>
                      <option value="rect">rect</option>
                      <option value="oval">oval</option>
                      <option value="circle">circle</option>
                    </select>
                  </label>
                  <label style={fieldLabel}>
                    Type
                    <select
                      style={textInput}
                      value={selectedPad.type}
                      onChange={(e) => {
                        const type = e.target.value as PadType
                        // Switching to a flat land drops the drill; the validator refuses an SMD pad
                        // that still carries one, and a hole with no barrel is not a thing.
                        updatePad(selectedPadIndex, (p) => {
                          if (type === 'smd') {
                            const { holeDiameter: _dropped, ...flat } = p
                            return { ...flat, type }
                          }
                          return { ...p, type, holeDiameter: p.holeDiameter ?? 0.9 }
                        })
                      }}
                    >
                      <option value="smd">smd</option>
                      <option value="through_hole">through-hole</option>
                    </select>
                  </label>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  <PadFlag
                    label="thermal"
                    title="The big pad under a power part, there to carry heat into a plane. A same-net via array inside it is by design, so the board's via-in-pad rule leaves it alone."
                    checked={selectedPad.thermal === true}
                    onChange={(on) =>
                      updatePad(selectedPadIndex, (p) => withFlag(p, 'thermal', on))
                    }
                  />
                  {selectedPad.type === 'through_hole' ? (
                    <>
                      <PadFlag
                        label="castellated"
                        title="A plated half-hole on the board EDGE — the notched pads of a solder-down module. It is MEANT to touch the outline, so the edge-clearance rules exempt it and the larger half-hole minimums apply instead."
                        checked={selectedPad.castellated === true}
                        onChange={(on) =>
                          updatePad(selectedPadIndex, (p) => withFlag(p, 'castellated', on))
                        }
                      />
                      <PadFlag
                        label="plated"
                        title="Whether the hole is copper-plated. Unplated is a mounting or tooling hole: no plating, no ring of copper needed, and the fab drills it in a separate file."
                        checked={selectedPad.plated !== false}
                        onChange={(on) =>
                          updatePad(selectedPadIndex, (p) =>
                            on ? withFlag(p, 'plated', false, true) : { ...p, plated: false },
                          )
                        }
                      />
                    </>
                  ) : null}
                </div>
                <button
                  type="button"
                  style={subtleButton}
                  onClick={() => {
                    setDraft((d) => ({
                      ...d,
                      pads: d.pads.filter((_, i) => i !== selectedPadIndex),
                    }))
                    setSelectedPadIndex(null)
                  }}
                >
                  Delete pad
                </button>
              </Section>
            ) : null}

            <Section title="Body & keep-out">
              <div style={fieldRow}>
                {/* Clearing ONE side must not throw the other away — you'd be retyping a number you
                    already entered. The body only disappears when both sides are gone. */}
                <NumberField
                  label="Body W mm"
                  value={draft.bodyMm?.w ?? 0}
                  step={0.1}
                  onChange={(v) => setDraft((d) => ({ ...d, bodyMm: withBodySide(d, 'w', v) }))}
                />
                <NumberField
                  label="Body H mm"
                  value={draft.bodyMm?.h ?? 0}
                  step={0.1}
                  onChange={(v) => setDraft((d) => ({ ...d, bodyMm: withBodySide(d, 'h', v) }))}
                />
                <NumberField
                  label="Clearance"
                  value={draft.courtyardMarginMm}
                  step={0.05}
                  onChange={(v) => setDraft((d) => ({ ...d, courtyardMarginMm: v }))}
                />
              </div>
              <button
                type="button"
                style={subtleButton}
                onClick={() => setDraft((d) => ({ ...d, manualCourtyard: null }))}
              >
                {draft.manualCourtyard
                  ? 'Re-fit keep-out to the pads'
                  : 'Keep-out follows the pads'}
              </button>
            </Section>

            <Section title="Where the numbers came from" hint="required — every value is traceable">
              <div style={fieldRow}>
                <label style={fieldLabel}>
                  Source
                  <select
                    style={textInput}
                    value={draft.provenance.source_type}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        provenance: {
                          ...d.provenance,
                          source_type: e.target.value as FootprintSourceType,
                        },
                      }))
                    }
                  >
                    <option value="datasheet">datasheet</option>
                    <option value="standard">standard</option>
                    <option value="reference">reference</option>
                    <option value="measurement">measurement</option>
                    <option value="derived">derived</option>
                  </select>
                </label>
                <label style={fieldLabel}>
                  Confidence
                  <select
                    style={textInput}
                    value={draft.provenance.confidence}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        provenance: {
                          ...d.provenance,
                          confidence: e.target.value as FootprintConfidence,
                        },
                      }))
                    }
                  >
                    <option value="high">high</option>
                    <option value="medium">medium</option>
                    <option value="low">low</option>
                    <option value="unknown">unknown</option>
                  </select>
                </label>
              </div>
              <label style={fieldLabel}>
                Title
                <input
                  style={textInput}
                  value={draft.provenance.title}
                  placeholder="Lattice iCE40 LP/HX Family Data Sheet"
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      provenance: { ...d.provenance, title: e.target.value },
                    }))
                  }
                />
              </label>
              <label style={fieldLabel}>
                Citation
                <input
                  style={textInput}
                  value={draft.provenance.citation}
                  placeholder="QFN-48 package drawing, p. 112"
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      provenance: { ...d.provenance, citation: e.target.value },
                    }))
                  }
                />
              </label>
            </Section>
          </div>
        </div>

        <div
          style={{
            borderTop: `1px solid ${THEME.borderSubtle}`,
            padding: '9px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 0, fontSize: 11, lineHeight: 1.5 }}>
            {problems.length > 0 ? (
              <span style={{ color: THEME.statusWarn }}>
                {problems[0]}
                {problems.length > 1 ? ` (+${problems.length - 1} more)` : ''}
              </span>
            ) : confirmReplace ? (
              <span style={{ color: THEME.statusWarn }}>
                “{draft.id.trim()}” already exists. Saving reshapes it on every board that uses it —
                press Save again to replace it, or change the Id to keep both.
              </span>
            ) : (
              <span style={{ color: THEME.statusOk }}>
                ✓ {draft.pads.length} pad{draft.pads.length === 1 ? '' : 's'} — ready to place on a
                board
                {replacesExisting ? ' (this id is already in use)' : ''}
              </span>
            )}
          </div>
          <button type="button" style={subtleButton} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            style={{ ...primaryButton, opacity: problems.length === 0 ? 1 : 0.45 }}
            disabled={problems.length > 0}
            onClick={save}
          >
            {confirmReplace ? 'Replace it' : 'Save footprint'}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Set (or clear) one of a pad's optional flags. Clearing REMOVES the key rather than writing `false`,
 * so a plain pad stays a plain pad in the saved file instead of accumulating a row of negatives.
 * `clearedValue` covers `plated`, whose "off" state is the meaningful one.
 */
function withFlag(
  pad: Pad,
  flag: 'thermal' | 'castellated' | 'plated',
  on: boolean,
  removeWhenOn = false,
): Pad {
  if (on === removeWhenOn) {
    const { [flag]: _dropped, ...rest } = pad
    return rest
  }
  return { ...pad, [flag]: on }
}

/** A small labelled tick for a pad's optional flags. */
function PadFlag({
  label,
  title,
  checked,
  onChange,
}: {
  label: string
  title: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 11,
        color: THEME.textMuted,
        cursor: 'help',
      }}
    >
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

/** One side of the component body, keeping whatever the other side already holds. */
function withBodySide(
  draft: FootprintDraft,
  side: 'w' | 'h',
  value: number,
): { w: number; h: number } {
  const next = { w: draft.bodyMm?.w ?? 0, h: draft.bodyMm?.h ?? 0, [side]: value } as {
    w: number
    h: number
  }
  return next
}

type FootprintSourceType = Footprint['provenance']['source_type']
type FootprintConfidence = Footprint['provenance']['confidence']

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: THEME.textPrimary }}>{title}</span>
        {hint ? <span style={{ fontSize: 10, color: THEME.textFaint }}>{hint}</span> : null}
      </div>
      {children}
    </div>
  )
}

function NumberField({
  label,
  value,
  step,
  onChange,
}: {
  label: string
  value: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <label style={fieldLabel}>
      {label}
      <input
        style={textInput}
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => {
          const parsed = Number(e.target.value)
          if (Number.isFinite(parsed)) onChange(parsed)
        }}
      />
    </label>
  )
}

function CanvasButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '3px 9px',
        borderRadius: 6,
        border: `1px solid ${active ? THEME.accentBlue : THEME.borderStrong}`,
        background: active ? THEME.surfaceActive : THEME.surfaceRaised,
        color: THEME.textPrimary,
        fontSize: 11,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}

const fieldRow: React.CSSProperties = { display: 'flex', gap: 6 }

const fieldLabel: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  flex: 1,
  minWidth: 0,
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: THEME.textMuted,
}

const textInput: React.CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  padding: '5px 7px',
  borderRadius: 6,
  border: `1px solid ${THEME.borderStrong}`,
  background: THEME.surfaceInput,
  color: THEME.textPrimary,
  fontSize: 12,
  outline: 'none',
}

const primaryButton: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  border: `1px solid ${THEME.accentBlueDeep}`,
  background: THEME.surfaceActive,
  color: THEME.textBright,
  fontSize: 12,
  cursor: 'pointer',
}

const subtleButton: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  border: `1px solid ${THEME.borderStrong}`,
  background: THEME.surfaceRaised,
  color: THEME.textPrimary,
  fontSize: 12,
  cursor: 'pointer',
}
