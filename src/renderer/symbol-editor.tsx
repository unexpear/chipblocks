/**
 * THE SYMBOL EDITOR — drawing a part's schematic symbol on a canvas: KiCad's Symbol Editor, for a part you
 * made. Until this existed a made part could only draw as a labelled box with pins down its sides, so an
 * op-amp couldn't be a triangle and a logic gate couldn't look like one.
 *
 * The drawing happens ON the canvas: shapes are drawn and dragged, pins are put down and dragged. The side
 * panel holds the exact numbers, and what a pin IS — its name, the pad number it solders to, its type. The
 * two edit the same drawing, so neither is the "real" way.
 *
 * Everything geometric lives in symbol-draft.ts, and every problem shown comes from user-symbol-validate.ts
 * — the rules the file loader applies — so a symbol that saves here survives a reload, and every pin on it
 * sits on an outer edge, where a wire can land and be routed.
 *
 * A picture only. The solver reads a placed part's id, values and connections, never its drawing, and the
 * pins keep their ids and their order.
 */

import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CanvasButton,
  fieldLabel,
  fieldRow,
  NumberField,
  primaryButton,
  Section,
  subtleButton,
  textInput,
} from './editor-form.tsx'
import type { Footprint } from './footprint.ts'
import { padMapFor } from './footprint-assignment.ts'
import { type Bounds, clientToView, fitView, panByPx, type View, zoomAt } from './pcb-viewport.ts'
import {
  addGraphic,
  addPin,
  blankSymbolDraft,
  type DraftPin,
  deleteTarget,
  draftBox,
  draftExtent,
  draftFromBox,
  draftFromSymbol,
  draftResult,
  dragGraphicHandle,
  exactPx,
  freshPinKey,
  graphicHandles,
  hasDrawing,
  moveTargetTo,
  newArc,
  newCircle,
  newPolyline,
  newRectangle,
  newText,
  nextPinToPlace,
  type PinPlacement,
  pinLengthToward,
  placePin,
  removeAddedPin,
  rotateTarget,
  type SymbolDraft,
  type SymbolEditorPin,
  type SymbolEditResult,
  type SymbolTarget,
  samePoint,
  sideFacing,
  snapPoint,
  symbolDraftProblems,
  targetAnchor,
  updateGraphic,
  updatePin,
} from './symbol-draft.ts'
import {
  arcPath,
  arcSweep,
  type DrawnSymbol,
  graphicInk,
  pinRoot,
  SCHEMATIC_GRID_PX,
  SCHEMATIC_MINOR_GRID_PX,
  SYMBOL_FIELD_KEYS,
  SYMBOL_FILLS,
  SYMBOL_PIN_STYLES,
  type SymbolFieldKey,
  type SymbolFill,
  type SymbolGraphic,
  type SymbolPinStyle,
  type SymbolPoint,
  type SymbolShape,
} from './symbol-geometry.ts'
import { THEME } from './theme.ts'
import {
  canRedo,
  canUndo,
  checkpoint,
  emptyHistory,
  redo,
  type UndoHistory,
  undo,
} from './undo-history.ts'
import {
  DrawnGraphic,
  DrawnPin,
  SYMBOL_FIELD_COLOR,
  SYMBOL_FIELD_FONT_SIZE,
  svgPoints,
} from './user-part-glyphs.tsx'
import { PIN_ELECTRICAL_TYPES, type PinElectrical, type PinSide } from './user-parts.ts'

type Tool = 'select' | 'line' | 'rectangle' | 'circle' | 'arc' | 'text' | 'pin'

const TOOLS: readonly { tool: Tool; label: string; hint: string }[] = [
  {
    tool: 'select',
    label: 'Select',
    hint: 'click a shape, pin or field to edit it · drag to move it · drag empty space to pan · wheel to zoom',
  },
  {
    tool: 'line',
    label: 'Line',
    hint: 'click each corner · click the last corner again (or double-click, or Enter) to finish · click the first corner to close the shape',
  },
  {
    tool: 'rectangle',
    label: 'Rectangle',
    hint: 'drag from one corner to the opposite corner, or click both',
  },
  { tool: 'circle', label: 'Circle', hint: 'drag from the centre out to the edge, or click both' },
  {
    tool: 'arc',
    label: 'Arc',
    hint: 'click where it starts, then where it ends, then a point it curves through',
  },
  { tool: 'text', label: 'Text', hint: 'click where the text goes, then type it in the panel' },
  {
    tool: 'pin',
    label: 'Pin',
    hint: 'click where a wire should land — the pin points out of whichever side of the body you click beyond',
  },
]

/** A shape half-drawn: the points clicked so far. */
type Sketch =
  | { tool: 'line'; points: SymbolPoint[] }
  | { tool: 'rectangle'; start: SymbolPoint }
  | { tool: 'circle'; center: SymbolPoint }
  | { tool: 'arc'; start: SymbolPoint; end: SymbolPoint | null }

type Drag =
  | { kind: 'pan'; lastX: number; lastY: number }
  /** `offset` runs from the pointer to the thing's anchor, so it doesn't jump to the pointer when grabbed. */
  | { kind: 'move'; target: SymbolTarget; offset: SymbolPoint; before: SymbolDraft }
  | { kind: 'handle'; index: number; handle: string; before: SymbolDraft }
  | { kind: 'pin-length'; key: string; before: SymbolDraft }
  | { kind: 'sketch' }

type EditorState = { draft: SymbolDraft; history: UndoHistory<SymbolDraft> }
type PlacedDraftPin = DraftPin & { placed: PinPlacement }

const SIDES: readonly PinSide[] = ['left', 'right', 'top', 'bottom']
const SIDE_WORD: Record<PinSide, string> = {
  left: 'left',
  right: 'right',
  top: 'up',
  bottom: 'down',
}
const STYLE_WORD: Record<SymbolPinStyle, string> = {
  line: 'line',
  inverted: 'inverted (bubble)',
  clock: 'clock',
  inverted_clock: 'inverted clock',
}
const FILL_WORD: Record<SymbolFill, string> = {
  none: 'none',
  outline: 'solid (line colour)',
  background: 'body colour',
}
const FIELD_WORD: Record<SymbolFieldKey, string> = {
  reference: 'Reference',
  value: 'Value',
  footprint: 'Footprint',
  datasheet: 'Datasheet',
}
const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

const MIN_VIEW_PX = 16
const MAX_VIEW_PX = 4000
/** What an empty canvas shows: the origin, with room around it. */
const EMPTY_FRAME: Bounds = { x: -100, y: -80, w: 200, h: 160 }
/** The least a drawing is framed at, so a lone pin isn't blown up to fill the canvas. */
const MIN_FRAME_PX = 120
/** With snap off a drag still rounds to a hundredth of a px — finer than any screen shows. */
const FREE_STEP = 0.01
const CANVAS_BACKGROUND = THEME.surfaceDeep
const GRID_MINOR = THEME.borderSubtle
const GRID_MAJOR = THEME.borderStrong
const BOX_OUTLINE = THEME.accentPurple

export type SymbolEditorProps = {
  /** The part's name — the title, and the text its Value field shows here. */
  partName: string
  designatorPrefix: string
  /** The package it lands on: it numbers the pins by their pads, and is the Footprint field's text. */
  footprint?: Footprint
  pins: readonly SymbolEditorPin[]
  /** The drawing to reopen; absent starts with nothing drawn. */
  symbol?: DrawnSymbol
  datasheet: string
  /**
   * The part is built from a circuit: its pins, and which way signals cross them, are that circuit's own
   * ports (the logic simulation reads a pin's type there), so here they can be drawn but not added to or
   * retyped.
   */
  pinsFromCircuit: boolean
  /** Saving redraws copies already placed — say so and ask once more before doing it. */
  confirmBeforeSaving: boolean
  saveLabel: string
  onClose: () => void
  /** Take the drawing. Returns why it was refused (the editor stays open to fix it), or null. */
  onSave: (edit: SymbolEditResult) => string | null
}

function frameOf(draft: SymbolDraft): Bounds {
  const extent = draftExtent(draft)
  if (extent === null) return EMPTY_FRAME
  const w = Math.max(extent.maxX - extent.minX, MIN_FRAME_PX)
  const h = Math.max(extent.maxY - extent.minY, MIN_FRAME_PX)
  return { x: (extent.minX + extent.maxX - w) / 2, y: (extent.minY + extent.maxY - h) / 2, w, h }
}

/** The selection, if what it names still exists — an undo can take a shape or an added pin away. */
function liveSelection(selection: SymbolTarget | null, draft: SymbolDraft): SymbolTarget | null {
  if (selection === null) return null
  if (selection.kind === 'graphic') return draft.graphics[selection.index] ? selection : null
  if (selection.kind === 'pin') {
    return draft.pins.some((p) => p.key === selection.key) ? selection : null
  }
  return selection
}

const isMajorLine = (value: number, majorStep: number) =>
  Math.abs(value / majorStep - Math.round(value / majorStep)) < 1e-9

type Paint = {
  stroke: string
  strokeWidth: number
  fill: string
  opacity?: number
  strokeDasharray?: string
  pointerEvents?: 'stroke' | 'all' | 'none'
  style?: React.CSSProperties
  onPointerDown?: (event: React.PointerEvent<SVGElement>) => void
}

/** A shape's own outline with the given paint — for the selection mark and the invisible grab areas. */
function shapeElement(shape: SymbolShape, paint: Paint, key: string) {
  switch (shape.kind) {
    case 'polyline':
      return (
        <polyline
          key={key}
          points={svgPoints(shape.points)}
          strokeLinejoin="round"
          strokeLinecap="round"
          {...paint}
        />
      )
    case 'rectangle':
      return (
        <rect
          key={key}
          x={Math.min(shape.start.x, shape.end.x)}
          y={Math.min(shape.start.y, shape.end.y)}
          width={Math.abs(shape.end.x - shape.start.x)}
          height={Math.abs(shape.end.y - shape.start.y)}
          {...paint}
        />
      )
    case 'circle':
      return (
        <circle key={key} cx={shape.center.x} cy={shape.center.y} r={shape.radius} {...paint} />
      )
    case 'arc':
      return <path key={key} d={arcPath(shape)} {...paint} />
  }
}

export function SymbolEditor({
  partName,
  designatorPrefix,
  footprint,
  pins,
  symbol,
  datasheet,
  pinsFromCircuit,
  confirmBeforeSaving,
  saveLabel,
  onClose,
  onSave,
}: SymbolEditorProps) {
  const [editor, setEditor] = useState<EditorState>(() => ({
    draft:
      symbol === undefined
        ? blankSymbolDraft(pins, datasheet)
        : draftFromSymbol(pins, symbol, datasheet),
    history: emptyHistory(),
  }))
  const { draft, history } = editor
  const [pickedSelection, setSelection] = useState<SymbolTarget | null>(null)
  const selection = liveSelection(pickedSelection, draft)
  const [tool, setToolState] = useState<Tool>('select')
  const [sketch, setSketch] = useState<Sketch | null>(null)
  const [cursor, setCursor] = useState<SymbolPoint | null>(null)
  const [snapOn, setSnapOn] = useState(true)
  /** The start card offers the part's box or a blank page — until one is picked or something is drawn. */
  const [startChosen, setStartChosen] = useState(symbol !== undefined)
  /** Armed once the user has been told Save redraws the copies already placed. */
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showAllProblems, setShowAllProblems] = useState(false)
  const [view, setView] = useState<View>(() => ({ ...EMPTY_FRAME }))
  const [canvasWidthPx, setCanvasWidthPx] = useState(640)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const textFieldRef = useRef<HTMLInputElement | null>(null)
  const focusTextField = useRef(false)
  const dragRef = useRef<Drag | null>(null)
  const userView = useRef(false)

  const problems = useMemo(() => symbolDraftProblems(draft), [draft])
  const box = useMemo(() => draftBox(draft), [draft])
  const padNumbers = useMemo(
    () =>
      footprint === undefined
        ? new Map<string, string>()
        : padMapFor(
            draft.pins.map((p) => ({ id: p.key, name: p.name.trim(), pad: p.pad.trim() })),
            footprint,
          ),
    [draft.pins, footprint],
  )
  /** Drawing px per screen px — keeps outlines and handles the same on-screen size at any zoom. */
  const unit = view.w / Math.max(canvasWidthPx, 1)

  /** Every change to the drawing goes through here, so a stale "press Save again" or refusal is dropped. */
  const changeEditor = (update: (state: EditorState) => EditorState) => {
    setEditor(update)
    setConfirmReplace(false)
    setSaveError(null)
  }
  /** One undoable step. Typing into a field is one step however many keys it takes (a `param:` tag). */
  const commit = (tag: string, change: (d: SymbolDraft) => SymbolDraft) =>
    changeEditor((s) => {
      const next = change(s.draft)
      if (next === s.draft) return s
      return { draft: next, history: checkpoint(s.history, s.draft, tag, Date.now()) }
    })
  /** A drag in flight: the drawing follows the pointer, and the whole drag is one step when it ends. */
  const follow = (change: (d: SymbolDraft) => SymbolDraft) =>
    changeEditor((s) => {
      const next = change(s.draft)
      return next === s.draft ? s : { ...s, draft: next }
    })
  const settle = (before: SymbolDraft) =>
    setEditor((s) =>
      s.draft === before ? s : { ...s, history: checkpoint(s.history, before, 'drag', Date.now()) },
    )
  const stepBack = () => {
    setSketch(null)
    changeEditor((s) => {
      const step = undo(s.history, s.draft)
      return step === null ? s : { draft: step.restored, history: step.history }
    })
  }
  const stepForward = () => {
    setSketch(null)
    changeEditor((s) => {
      const step = redo(s.history, s.draft, Date.now())
      return step === null ? s : { draft: step.restored, history: step.history }
    })
  }

  const setTool = (next: Tool) => {
    setToolState(next)
    setSketch(null)
  }

  // Read the frame through a ref so the resize observer can subscribe once — the footprint editor's
  // reasoning: re-subscribing on every change would re-fit the view on every step of a drag.
  const frameRef = useRef(() => frameOf(draft))
  frameRef.current = () => frameOf(draft)

  const fitToDrawing = useCallback(() => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.height === 0) return
    userView.current = false
    setView(fitView(frameRef.current(), rect.width / rect.height, 0.18))
  }, [])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const observer = new ResizeObserver(() => {
      const rect = svg.getBoundingClientRect()
      if (rect.height === 0) return
      setCanvasWidthPx(rect.width)
      const aspect = rect.width / rect.height
      if (!userView.current) {
        setView(fitView(frameRef.current(), aspect, 0.18))
        return
      }
      setView((v) => {
        const w = v.h * aspect
        return { x: v.x + (v.w - w) / 2, y: v.y, w, h: v.h }
      })
    })
    observer.observe(svg)
    return () => observer.disconnect()
  }, [])

  // Take the keyboard: this dialog can open from inside another (the New Part form), and a key still
  // aimed at the button that opened it would otherwise reach that dialog too.
  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!focusTextField.current) return
    focusTextField.current = false
    textFieldRef.current?.select()
  })

  const toDrawing = (event: { clientX: number; clientY: number }): SymbolPoint => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return clientToView(view, rect, event.clientX, event.clientY)
  }
  const gridded = (point: SymbolPoint, grid: number) => snapPoint(point, snapOn ? grid : FREE_STEP)

  const selectedPinKey = selection?.kind === 'pin' ? selection.key : null
  const selectedPin = draft.pins.find((p) => p.key === selectedPinKey)
  const selectedGraphic =
    selection?.kind === 'graphic' ? draft.graphics[selection.index] : undefined
  const selectedField = selection?.kind === 'field' ? selection.key : null
  const placedPins = draft.pins.filter((p): p is PlacedDraftPin => p.placed !== null)
  const pinsLeft = draft.pins.length - placedPins.length
  const canAddPins = !pinsFromCircuit
  const showStartCard = !startChosen && !hasDrawing(draft) && sketch === null

  const addAndSelect = (graphic: SymbolGraphic) => {
    setSelection({ kind: 'graphic', index: draft.graphics.length })
    commit('draw', (d) => addGraphic(d, graphic))
    setSketch(null)
  }

  const finishLine = () => {
    if (sketch?.tool !== 'line') return
    if (sketch.points.length >= 2) addAndSelect(newPolyline(sketch.points))
    else setSketch(null)
  }

  const extendLine = (point: SymbolPoint) => {
    if (sketch?.tool !== 'line') {
      setSketch({ tool: 'line', points: [point] })
      return
    }
    const { points } = sketch
    const first = points[0]
    const last = points[points.length - 1]
    if (last !== undefined && samePoint(last, point)) {
      finishLine()
      return
    }
    if (first !== undefined && points.length >= 3 && samePoint(first, point)) {
      addAndSelect(newPolyline([...points, point]))
      return
    }
    setSketch({ tool: 'line', points: [...points, point] })
  }

  const extendArc = (point: SymbolPoint) => {
    if (sketch?.tool !== 'arc') {
      setSketch({ tool: 'arc', start: point, end: null })
      return
    }
    if (sketch.end === null) {
      if (!samePoint(point, sketch.start)) setSketch({ ...sketch, end: point })
      return
    }
    // Three points on one line make no arc — wait for a point it can actually curve through.
    if (arcSweep({ start: sketch.start, mid: point, end: sketch.end }) === null) return
    addAndSelect(newArc(sketch.start, point, sketch.end))
  }

  /** The second corner of a rectangle, or the edge of a circle. A zero-size one isn't drawn — it waits. */
  const closeBox = (point: SymbolPoint) => {
    if (sketch?.tool === 'rectangle') {
      if (point.x === sketch.start.x || point.y === sketch.start.y) return
      addAndSelect(newRectangle(sketch.start, point))
      return
    }
    if (sketch?.tool === 'circle') {
      const radius = exactPx(Math.hypot(point.x - sketch.center.x, point.y - sketch.center.y))
      if (radius > 0) addAndSelect(newCircle(sketch.center, radius))
    }
  }

  const putPinDown = (tip: SymbolPoint) => {
    const key = nextPinToPlace(draft, selectedPinKey)
    if (key !== null) {
      commit('pin', (d) => placePin(d, key, tip, sideFacing(d, tip)))
      setSelection({ kind: 'pin', key })
      if (pinsLeft <= 1 && !canAddPins) setTool('select')
      return
    }
    if (!canAddPins) {
      setTool('select')
      return
    }
    const fresh = freshPinKey(draft.pins)
    commit('pin', (d) => {
      const withPin = addPin(d, fresh)
      return placePin(withPin, fresh, tip, sideFacing(withPin, tip))
    })
    setSelection({ kind: 'pin', key: fresh })
  }

  const onCanvasPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    if (tool === 'select') {
      setSelection(null)
      dragRef.current = { kind: 'pan', lastX: event.clientX, lastY: event.clientY }
      svgRef.current?.setPointerCapture(event.pointerId)
      return
    }
    const point = toDrawing(event)
    if (tool === 'pin') {
      putPinDown(gridded(point, SCHEMATIC_GRID_PX))
      return
    }
    const onMinor = gridded(point, SCHEMATIC_MINOR_GRID_PX)
    if (tool === 'text') {
      addAndSelect(newText(onMinor))
      focusTextField.current = true
      setTool('select')
      return
    }
    if (tool === 'line') {
      extendLine(onMinor)
      return
    }
    if (tool === 'arc') {
      extendArc(onMinor)
      return
    }
    if (sketch !== null) {
      closeBox(onMinor)
      return
    }
    setSketch(tool === 'rectangle' ? { tool, start: onMinor } : { tool: 'circle', center: onMinor })
    dragRef.current = { kind: 'sketch' }
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  const beginDrag = (event: React.PointerEvent, drag: Drag) => {
    event.stopPropagation()
    dragRef.current = drag
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  const grab = (event: React.PointerEvent, target: SymbolTarget) => {
    if (event.button !== 0 || tool !== 'select') return
    const anchor = targetAnchor(draft, target)
    if (anchor === null) return
    const point = toDrawing(event)
    setSelection(target)
    beginDrag(event, {
      kind: 'move',
      target,
      offset: { x: anchor.x - point.x, y: anchor.y - point.y },
      before: draft,
    })
  }

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const point = toDrawing(event)
    const at = gridded(point, tool === 'pin' ? SCHEMATIC_GRID_PX : SCHEMATIC_MINOR_GRID_PX)
    setCursor((c) => (c !== null && samePoint(c, at) ? c : at))
    const drag = dragRef.current
    if (drag === null) return
    if (drag.kind === 'pan') {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect) return
      userView.current = true
      setView((v) => panByPx(v, rect, event.clientX - drag.lastX, event.clientY - drag.lastY))
      dragRef.current = { kind: 'pan', lastX: event.clientX, lastY: event.clientY }
      return
    }
    if (drag.kind === 'move') {
      const grid = drag.target.kind === 'pin' ? SCHEMATIC_GRID_PX : SCHEMATIC_MINOR_GRID_PX
      const to = gridded({ x: point.x + drag.offset.x, y: point.y + drag.offset.y }, grid)
      follow((d) => moveTargetTo(d, drag.target, to))
      return
    }
    const onMinor = gridded(point, SCHEMATIC_MINOR_GRID_PX)
    if (drag.kind === 'handle') {
      follow((d) => updateGraphic(d, drag.index, (g) => dragGraphicHandle(g, drag.handle, onMinor)))
      return
    }
    if (drag.kind === 'pin-length') {
      follow((d) =>
        updatePin(d, drag.key, (pin) => {
          if (pin.placed === null) return pin
          const length = pinLengthToward(pin.placed, pin.side, onMinor)
          return length === pin.placed.length ? pin : { ...pin, placed: { ...pin.placed, length } }
        }),
      )
    }
  }

  const endDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (drag === null) return
    dragRef.current = null
    if (svgRef.current?.hasPointerCapture(event.pointerId)) {
      svgRef.current.releasePointerCapture(event.pointerId)
    }
    if (drag.kind === 'sketch') {
      closeBox(gridded(toDrawing(event), SCHEMATIC_MINOR_GRID_PX))
      return
    }
    if (drag.kind !== 'pan') settle(drag.before)
  }

  const onWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    userView.current = true
    const anchor = clientToView(view, rect, event.clientX, event.clientY)
    setView((v) => zoomAt(v, event.deltaY > 0 ? 1.15 : 1 / 1.15, anchor, MIN_VIEW_PX, MAX_VIEW_PX))
  }

  const onDoubleClick = () => {
    if (sketch?.tool === 'line') {
      finishLine()
      return
    }
    if (tool === 'select' && selection === null) fitToDrawing()
  }

  const rotateSelected = () => {
    if (selection !== null) commit('rotate', (d) => rotateTarget(d, selection))
  }
  const removeSelected = () => {
    if (selection === null) return
    commit('delete', (d) => deleteTarget(d, selection))
    if (selection.kind === 'graphic') setSelection(null)
  }

  const handleEscape = () => {
    if (sketch !== null) {
      setSketch(null)
      return
    }
    if (tool !== 'select') {
      setTool('select')
      return
    }
    if (selection !== null) {
      setSelection(null)
      return
    }
    onClose()
  }

  // The window, not the dialog, hears the keys — a handler on the dialog would miss the ones pressed
  // while the canvas has the pointer. Read through a ref so the listener subscribes once.
  const keyActions = useRef({
    handleEscape,
    stepBack,
    stepForward,
    removeSelected,
    rotateSelected,
    finishLine,
  })
  keyActions.current = {
    handleEscape,
    stepBack,
    stepForward,
    removeSelected,
    rotateSelected,
    finishLine,
  }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const act = keyActions.current
      if (event.key === 'Escape') {
        event.preventDefault()
        act.handleEscape()
        return
      }
      const target = event.target as HTMLElement | null
      if (target !== null && TYPING_TAGS.has(target.tagName)) return
      const withCtrl = event.ctrlKey || event.metaKey
      const letter = event.key.toLowerCase()
      if (withCtrl && letter === 'z' && !event.shiftKey) {
        event.preventDefault()
        act.stepBack()
        return
      }
      if (withCtrl && (letter === 'y' || (letter === 'z' && event.shiftKey))) {
        event.preventDefault()
        act.stepForward()
        return
      }
      if (withCtrl || event.altKey) return
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        act.removeSelected()
        return
      }
      if (letter === 'r') {
        event.preventDefault()
        act.rotateSelected()
        return
      }
      if (event.key === 'Enter') act.finishLine()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const restart = (make: (d: SymbolDraft) => SymbolDraft) => {
    commit('start', make)
    setStartChosen(true)
    setSelection(null)
    setSketch(null)
    userView.current = false
    requestAnimationFrame(fitToDrawing)
  }
  const startFromBox = () => restart((d) => draftFromBox(d.pins, partName, d.datasheet))
  const startBlank = () => restart((d) => blankSymbolDraft(d.pins, d.datasheet))

  const choosePin = (key: string) => {
    setSelection({ kind: 'pin', key })
    if (draft.pins.find((p) => p.key === key)?.placed === null) setTool('pin')
  }
  const addPinRow = () => {
    const key = freshPinKey(draft.pins)
    commit('pin', (d) => addPin(d, key))
    setSelection({ kind: 'pin', key })
    setTool('pin')
  }

  const save = () => {
    if (problems.length > 0) return
    if (confirmBeforeSaving && !confirmReplace) {
      setConfirmReplace(true)
      return
    }
    const refusal = onSave(draftResult(draft))
    if (refusal !== null) {
      setConfirmReplace(false)
      setSaveError(refusal)
      return
    }
    onClose()
  }

  const pinNumber = (pin: DraftPin): string | undefined =>
    padNumbers.get(pin.key) ?? (pin.pad.trim() === '' ? undefined : pin.pad.trim())

  const fieldText: Record<SymbolFieldKey, string> = {
    reference: `${designatorPrefix}?`,
    value: partName,
    footprint: footprint?.id ?? 'no footprint',
    datasheet: draft.datasheet.trim() === '' ? 'no datasheet' : draft.datasheet.trim(),
  }
  const fieldInk = (key: SymbolFieldKey) =>
    graphicInk({
      kind: 'text',
      at: draft.fields[key].at,
      text: fieldText[key],
      size: SYMBOL_FIELD_FONT_SIZE,
    })

  const grid = useMemo(() => {
    const onScreen = (step: number) => step / unit
    const majorStep = onScreen(SCHEMATIC_GRID_PX) >= 6 ? SCHEMATIC_GRID_PX : SCHEMATIC_GRID_PX * 5
    const step = onScreen(SCHEMATIC_MINOR_GRID_PX) >= 6 ? SCHEMATIC_MINOR_GRID_PX : majorStep
    const lines = (from: number, span: number) => {
      const out: number[] = []
      for (let v = Math.floor(from / step) * step; v <= from + span; v += step) out.push(exactPx(v))
      return out
    }
    return { xs: lines(view.x, view.w), ys: lines(view.y, view.h), majorStep }
  }, [view, unit])

  const hitWidth = 10 * unit
  const handleSize = 8 * unit
  const toolHint = TOOLS.find((t) => t.tool === tool)?.hint ?? ''

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a modal backdrop click-to-close, standard
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-close; Escape is handled window-wide above
    <div
      onClick={() => {
        // A stray click outside must never throw a drawing away — only an untouched one closes.
        if (!canUndo(history)) onClose()
      }}
      data-modal="symbol-editor"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2100,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the dialog stops backdrop clicks reaching close */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: this onClick only stops propagation — it triggers nothing; keys are handled window-wide above */}
      <div
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 1080,
          maxWidth: '96vw',
          height: 700,
          maxHeight: '94vh',
          display: 'flex',
          flexDirection: 'column',
          background: THEME.surfacePanel,
          border: `1px solid ${THEME.borderStrong}`,
          borderRadius: 10,
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
          overflow: 'hidden',
          outline: 'none',
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
            Symbol — {partName}
          </span>
          <span style={{ fontSize: 11, color: THEME.textFaint }}>
            the picture it draws as on a schematic — draw the body, then put each pin where its wire
            should land
          </span>
        </div>

        <div style={{ display: 'flex', minHeight: 0, flex: 1 }}>
          {/* ── the canvas ── */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 5,
                padding: '7px 8px',
                borderBottom: `1px solid ${THEME.borderSubtle}`,
              }}
            >
              {TOOLS.map(({ tool: option, label, hint }) => (
                <CanvasButton
                  key={option}
                  active={tool === option}
                  onClick={() => setTool(option)}
                  title={hint}
                  disabled={option === 'pin' && pinsLeft === 0 && !canAddPins}
                >
                  {label}
                </CanvasButton>
              ))}
              <span style={{ width: 1, height: 18, background: THEME.borderStrong }} />
              <CanvasButton
                active={false}
                onClick={stepBack}
                disabled={!canUndo(history)}
                title="Undo (Ctrl+Z)"
              >
                Undo
              </CanvasButton>
              <CanvasButton
                active={false}
                onClick={stepForward}
                disabled={!canRedo(history)}
                title="Redo (Ctrl+Y)"
              >
                Redo
              </CanvasButton>
              <CanvasButton
                active={false}
                onClick={rotateSelected}
                disabled={selection === null || selection.kind === 'field'}
                title="Turn the selection a quarter turn (R)"
              >
                Rotate
              </CanvasButton>
              <CanvasButton
                active={false}
                onClick={removeSelected}
                disabled={selection === null}
                title="Delete the selection (Del) — a pin comes off the drawing, a field is hidden"
              >
                Delete
              </CanvasButton>
              <CanvasButton active={false} onClick={fitToDrawing} title="Fit the drawing in view">
                Fit
              </CanvasButton>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 11,
                  color: THEME.textMuted,
                  marginLeft: 4,
                }}
                title={`Pin tips snap to the ${SCHEMATIC_GRID_PX} px schematic grid, shapes to its ${SCHEMATIC_MINOR_GRID_PX} px fine grid`}
              >
                <input
                  type="checkbox"
                  checked={snapOn}
                  onChange={(e) => setSnapOn(e.target.checked)}
                />
                snap to grid
              </label>
            </div>

            <div
              style={{ flex: 1, minHeight: 0, position: 'relative', background: CANVAS_BACKGROUND }}
            >
              <svg
                ref={svgRef}
                viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
                preserveAspectRatio="none"
                style={{
                  display: 'block',
                  width: '100%',
                  height: '100%',
                  touchAction: 'none',
                  cursor: tool === 'select' ? 'default' : 'crosshair',
                }}
                role="img"
                aria-label="Symbol editor canvas"
                onPointerDown={onCanvasPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onPointerLeave={() => setCursor(null)}
                onWheel={onWheel}
                onDoubleClick={onDoubleClick}
              >
                <title>Symbol editor canvas</title>
                {grid.xs.map((x) => (
                  <line
                    key={`gx${x}`}
                    x1={x}
                    y1={view.y}
                    x2={x}
                    y2={view.y + view.h}
                    stroke={isMajorLine(x, grid.majorStep) ? GRID_MAJOR : GRID_MINOR}
                    strokeWidth={unit}
                  />
                ))}
                {grid.ys.map((y) => (
                  <line
                    key={`gy${y}`}
                    x1={view.x}
                    y1={y}
                    x2={view.x + view.w}
                    y2={y}
                    stroke={isMajorLine(y, grid.majorStep) ? GRID_MAJOR : GRID_MINOR}
                    strokeWidth={unit}
                  />
                ))}
                <g stroke={THEME.textFaint} strokeWidth={unit} pointerEvents="none">
                  <line x1={-6 * unit} y1={0} x2={6 * unit} y2={0} />
                  <line x1={0} y1={-6 * unit} x2={0} y2={6 * unit} />
                </g>

                {/* The node box the drawing is placed in: every pin tip must sit on this outline. */}
                {box === null ? null : (
                  <rect
                    x={box.minX}
                    y={box.minY}
                    width={box.maxX - box.minX}
                    height={box.maxY - box.minY}
                    fill="none"
                    stroke={BOX_OUTLINE}
                    strokeWidth={unit}
                    strokeDasharray={`${5 * unit} ${4 * unit}`}
                    opacity={0.75}
                    pointerEvents="none"
                  />
                )}

                {draft.graphics.map((graphic, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a shape has no id of its own — its place in the drawing order is its identity
                  <DrawnGraphic key={index} graphic={graphic} />
                ))}
                {placedPins.map((pin) => (
                  <DrawnPin
                    key={pin.key}
                    pin={{ pin: pin.key, ...pin.placed, side: pin.side }}
                    userPin={{
                      id: pin.key,
                      name: pin.name,
                      side: pin.side,
                      electrical: pin.electrical,
                    }}
                    number={pinNumber(pin)}
                  />
                ))}
                {SYMBOL_FIELD_KEYS.map((key) => (
                  <text
                    key={`field-${key}`}
                    x={draft.fields[key].at.x}
                    y={draft.fields[key].at.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={SYMBOL_FIELD_FONT_SIZE}
                    fontFamily="system-ui, sans-serif"
                    fill={SYMBOL_FIELD_COLOR[key]}
                    opacity={draft.fields[key].visible ? 1 : 0.35}
                    fontStyle={draft.fields[key].visible ? 'normal' : 'italic'}
                    pointerEvents="none"
                  >
                    {fieldText[key]}
                  </text>
                ))}

                {/* Invisible grab areas, wider than the lines, so a thin line is easy to take hold of. */}
                {tool === 'select' ? (
                  <>
                    {draft.graphics.map((graphic, index) => {
                      const onPointerDown = (event: React.PointerEvent<SVGElement>) =>
                        grab(event, { kind: 'graphic', index })
                      if (graphic.kind === 'text') {
                        const ink = graphicInk(graphic)
                        return (
                          <rect
                            key={`hit-g${graphic.at.x}-${graphic.at.y}-${graphic.text}-${graphic.size}-${graphic.angle ?? 0}`}
                            x={ink.minX}
                            y={ink.minY}
                            width={ink.maxX - ink.minX}
                            height={ink.maxY - ink.minY}
                            fill="transparent"
                            pointerEvents="all"
                            style={{ cursor: 'move' }}
                            onPointerDown={onPointerDown}
                          />
                        )
                      }
                      return shapeElement(
                        graphic,
                        {
                          stroke: 'transparent',
                          strokeWidth: Math.max(graphic.strokeWidth, hitWidth),
                          fill: graphic.fill === 'none' ? 'none' : 'transparent',
                          pointerEvents: graphic.fill === 'none' ? 'stroke' : 'all',
                          style: { cursor: 'move' },
                          onPointerDown,
                        },
                        `hit-g${index}`,
                      )
                    })}
                    {SYMBOL_FIELD_KEYS.map((key) => {
                      const ink = fieldInk(key)
                      return (
                        <rect
                          key={`hit-f${key}`}
                          x={ink.minX}
                          y={ink.minY}
                          width={ink.maxX - ink.minX}
                          height={ink.maxY - ink.minY}
                          fill="transparent"
                          pointerEvents="all"
                          style={{ cursor: 'move' }}
                          onPointerDown={(event) => grab(event, { kind: 'field', key })}
                        />
                      )
                    })}
                    {placedPins.map((pin) => {
                      const root = pinRoot(pin.placed, pin.side)
                      return (
                        <g
                          key={`hit-p${pin.key}`}
                          style={{ cursor: 'move' }}
                          onPointerDown={(event) => grab(event, { kind: 'pin', key: pin.key })}
                        >
                          <line
                            x1={pin.placed.at.x}
                            y1={pin.placed.at.y}
                            x2={root.x}
                            y2={root.y}
                            stroke="transparent"
                            strokeWidth={hitWidth}
                            pointerEvents="stroke"
                          />
                          <circle
                            cx={pin.placed.at.x}
                            cy={pin.placed.at.y}
                            r={hitWidth / 2 + unit}
                            fill="transparent"
                            pointerEvents="all"
                          />
                        </g>
                      )
                    })}
                  </>
                ) : null}

                <SelectionMark
                  graphic={selectedGraphic}
                  pin={selectedPin?.placed ? (selectedPin as PlacedDraftPin) : undefined}
                  fieldInk={selectedField === null ? undefined : fieldInk(selectedField)}
                  unit={unit}
                />

                {tool === 'select' && selection?.kind === 'graphic' && selectedGraphic
                  ? graphicHandles(selectedGraphic).map((handle) => (
                      <Handle
                        key={`handle-${handle.id}`}
                        at={handle.at}
                        size={handleSize}
                        unit={unit}
                        onPointerDown={(event) => {
                          if (event.button !== 0) return
                          beginDrag(event, {
                            kind: 'handle',
                            index: selection.index,
                            handle: handle.id,
                            before: draft,
                          })
                        }}
                      />
                    ))
                  : null}
                {tool === 'select' && selectedPin?.placed ? (
                  <>
                    <Handle
                      at={selectedPin.placed.at}
                      size={handleSize}
                      unit={unit}
                      onPointerDown={(event) => grab(event, { kind: 'pin', key: selectedPin.key })}
                    />
                    <Handle
                      at={pinRoot(selectedPin.placed, selectedPin.side)}
                      size={handleSize}
                      unit={unit}
                      round
                      title="drag to change the pin's length"
                      onPointerDown={(event) => {
                        if (event.button !== 0) return
                        beginDrag(event, {
                          kind: 'pin-length',
                          key: selectedPin.key,
                          before: draft,
                        })
                      }}
                    />
                  </>
                ) : null}

                {sketch === null ? null : (
                  <SketchPreview sketch={sketch} cursor={cursor} unit={unit} />
                )}
                {tool !== 'select' && cursor !== null ? (
                  <g stroke={THEME.accentBlue} strokeWidth={unit} pointerEvents="none">
                    <line
                      x1={cursor.x - 5 * unit}
                      y1={cursor.y}
                      x2={cursor.x + 5 * unit}
                      y2={cursor.y}
                    />
                    <line
                      x1={cursor.x}
                      y1={cursor.y - 5 * unit}
                      x2={cursor.x}
                      y2={cursor.y + 5 * unit}
                    />
                  </g>
                ) : null}
              </svg>

              {showStartCard ? (
                <StartCard onFromBox={startFromBox} onBlank={() => setStartChosen(true)} />
              ) : null}

              <div
                style={{
                  position: 'absolute',
                  left: 8,
                  right: 8,
                  bottom: 6,
                  fontSize: 10.5,
                  color: THEME.textFaint,
                  pointerEvents: 'none',
                  display: 'flex',
                  gap: 10,
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>{toolHint}</span>
                {cursor === null ? null : (
                  <span style={{ whiteSpace: 'nowrap' }}>
                    x {cursor.x} · y {cursor.y}
                  </span>
                )}
                {box === null ? null : (
                  <span style={{ whiteSpace: 'nowrap', color: BOX_OUTLINE }}>
                    ┅ where wires land
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ── the numbers ── */}
          <div
            style={{
              width: 320,
              flexShrink: 0,
              borderLeft: `1px solid ${THEME.borderSubtle}`,
              overflowY: 'auto',
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <Section title="Part" hint="only its picture changes here">
              <label style={fieldLabel}>
                Datasheet
                <input
                  style={textInput}
                  value={draft.datasheet}
                  placeholder="a link, or the document's name"
                  onChange={(e) => {
                    const text = e.target.value
                    commit('param:datasheet', (d) => ({ ...d, datasheet: text }))
                  }}
                />
              </label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 10.5, color: THEME.textFaint }}>Start over:</span>
                <button type="button" style={smallButton} onClick={startFromBox}>
                  From its box
                </button>
                <button type="button" style={smallButton} onClick={startBlank}>
                  Blank
                </button>
              </div>
            </Section>

            <Section
              title="Pins"
              hint={`${placedPins.length} of ${draft.pins.length} on the drawing`}
            >
              <PinList
                pins={draft.pins}
                selectedKey={selectedPinKey}
                numberOf={pinNumber}
                onChoose={choosePin}
              />
              {canAddPins ? (
                <button type="button" style={subtleButton} onClick={addPinRow}>
                  + Pin
                </button>
              ) : (
                <span style={noteText}>
                  This part is built from a circuit, so its pins are that circuit's pins — they can
                  be drawn here, not added or retyped.
                </span>
              )}
            </Section>

            {selectedPin === undefined ? null : (
              <PinPanel
                pin={selectedPin}
                number={pinNumber(selectedPin)}
                typeFixed={pinsFromCircuit}
                onChange={(field, change) =>
                  commit(`param:pin:${selectedPin.key}:${field}`, (d) =>
                    updatePin(d, selectedPin.key, change),
                  )
                }
                onTakeOff={() =>
                  commit('delete', (d) => deleteTarget(d, { kind: 'pin', key: selectedPin.key }))
                }
                onRemove={
                  selectedPin.added
                    ? () => {
                        commit('delete', (d) => removeAddedPin(d, selectedPin.key))
                        setSelection(null)
                      }
                    : null
                }
              />
            )}

            {selection?.kind === 'graphic' && selectedGraphic !== undefined ? (
              <GraphicPanel
                graphic={selectedGraphic}
                textFieldRef={textFieldRef}
                onChange={(field, change) =>
                  commit(`param:graphic:${selection.index}:${field}`, (d) =>
                    updateGraphic(d, selection.index, change),
                  )
                }
                onDelete={removeSelected}
              />
            ) : null}

            <Section title="Fields" hint="text the schematic fills in for each copy">
              {SYMBOL_FIELD_KEYS.map((key) => (
                <FieldRow
                  key={key}
                  label={FIELD_WORD[key]}
                  text={fieldText[key]}
                  field={draft.fields[key]}
                  selected={selectedField === key}
                  onSelect={() => setSelection({ kind: 'field', key })}
                  onChange={(field, change) =>
                    commit(`param:field:${key}:${field}`, (d) => ({
                      ...d,
                      fields: { ...d.fields, [key]: change(d.fields[key]) },
                    }))
                  }
                />
              ))}
            </Section>
          </div>
        </div>

        {showAllProblems && problems.length > 1 ? (
          <ul
            style={{
              margin: 0,
              padding: '8px 14px 8px 30px',
              maxHeight: 110,
              overflowY: 'auto',
              borderTop: `1px solid ${THEME.borderSubtle}`,
              fontSize: 11,
              lineHeight: 1.5,
              color: THEME.statusWarn,
            }}
          >
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        ) : null}

        <div
          style={{
            borderTop: `1px solid ${THEME.borderSubtle}`,
            padding: '9px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div
            style={{ flex: 1, minWidth: 0, fontSize: 11, lineHeight: 1.5 }}
            data-testid="symbol-editor-status"
          >
            {saveError !== null ? (
              <span style={{ color: THEME.statusDanger }}>{saveError}</span>
            ) : problems.length > 0 ? (
              <span style={{ color: THEME.statusWarn }}>
                {problems[0]}
                {problems.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setShowAllProblems((open) => !open)}
                    style={linkButton}
                  >
                    {showAllProblems ? 'hide the rest' : `(+${problems.length - 1} more)`}
                  </button>
                ) : null}
              </span>
            ) : confirmReplace ? (
              <span style={{ color: THEME.statusWarn }}>
                Saving redraws every copy of “{partName}” already on a schematic — press Save again
                to redraw them.
              </span>
            ) : (
              <span style={{ color: THEME.statusOk }}>
                ✓ all {draft.pins.length} pin{draft.pins.length === 1 ? '' : 's'} drawn, each on an
                outer edge where its wire lands — ready to save
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
            {confirmReplace ? 'Redraw them' : saveLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/** A draggable square (or round) grip on the selection. */
function Handle({
  at,
  size,
  unit,
  round = false,
  title,
  onPointerDown,
}: {
  at: SymbolPoint
  size: number
  unit: number
  round?: boolean
  title?: string
  onPointerDown: (event: React.PointerEvent<SVGElement>) => void
}) {
  const paint = {
    fill: THEME.accentBlue,
    stroke: CANVAS_BACKGROUND,
    strokeWidth: unit,
    style: { cursor: 'move' },
    onPointerDown,
  }
  const tooltip = title === undefined ? null : <title>{title}</title>
  if (round) {
    return (
      <circle cx={at.x} cy={at.y} r={size / 2} {...paint}>
        {tooltip}
      </circle>
    )
  }
  return (
    <rect x={at.x - size / 2} y={at.y - size / 2} width={size} height={size} {...paint}>
      {tooltip}
    </rect>
  )
}

/** The selection, outlined in the accent colour over the drawing. */
function SelectionMark({
  graphic,
  pin,
  fieldInk,
  unit,
}: {
  graphic: SymbolGraphic | undefined
  pin: PlacedDraftPin | undefined
  fieldInk: { minX: number; minY: number; maxX: number; maxY: number } | undefined
  unit: number
}) {
  const dashed = (extent: { minX: number; minY: number; maxX: number; maxY: number }) => (
    <rect
      x={extent.minX - 2 * unit}
      y={extent.minY - 2 * unit}
      width={extent.maxX - extent.minX + 4 * unit}
      height={extent.maxY - extent.minY + 4 * unit}
      fill="none"
      stroke={THEME.accentBlue}
      strokeWidth={unit}
      strokeDasharray={`${3 * unit} ${2 * unit}`}
      pointerEvents="none"
    />
  )
  if (graphic !== undefined) {
    if (graphic.kind === 'text') return dashed(graphicInk(graphic))
    return shapeElement(
      graphic,
      {
        stroke: THEME.accentBlue,
        strokeWidth: graphic.strokeWidth + 2 * unit,
        fill: 'none',
        opacity: 0.6,
        pointerEvents: 'none',
      },
      'selection',
    )
  }
  if (pin !== undefined) {
    const root = pinRoot(pin.placed, pin.side)
    return (
      <line
        x1={pin.placed.at.x}
        y1={pin.placed.at.y}
        x2={root.x}
        y2={root.y}
        stroke={THEME.accentBlue}
        strokeWidth={3 * unit}
        opacity={0.6}
        pointerEvents="none"
      />
    )
  }
  return fieldInk === undefined ? null : dashed(fieldInk)
}

/** The shape being drawn, dashed, following the pointer. */
function SketchPreview({
  sketch,
  cursor,
  unit,
}: {
  sketch: Sketch
  cursor: SymbolPoint | null
  unit: number
}) {
  const paint = {
    stroke: THEME.accentBlue,
    strokeWidth: 1.2 * unit,
    fill: 'none',
    strokeDasharray: `${4 * unit} ${3 * unit}`,
    pointerEvents: 'none' as const,
  }
  if (sketch.tool === 'line') {
    return (
      <polyline
        points={svgPoints(cursor ? [...sketch.points, cursor] : sketch.points)}
        {...paint}
      />
    )
  }
  if (cursor === null) return null
  if (sketch.tool === 'rectangle') {
    return (
      <rect
        x={Math.min(sketch.start.x, cursor.x)}
        y={Math.min(sketch.start.y, cursor.y)}
        width={Math.abs(cursor.x - sketch.start.x)}
        height={Math.abs(cursor.y - sketch.start.y)}
        {...paint}
      />
    )
  }
  if (sketch.tool === 'circle') {
    const radius = Math.hypot(cursor.x - sketch.center.x, cursor.y - sketch.center.y)
    return <circle cx={sketch.center.x} cy={sketch.center.y} r={radius} {...paint} />
  }
  if (sketch.end === null) {
    return <line x1={sketch.start.x} y1={sketch.start.y} x2={cursor.x} y2={cursor.y} {...paint} />
  }
  return <path d={arcPath({ start: sketch.start, mid: cursor, end: sketch.end })} {...paint} />
}

function StartCard({ onFromBox, onBlank }: { onFromBox: () => void; onBlank: () => void }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          pointerEvents: 'auto',
          width: 320,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          background: THEME.surfacePanel,
          border: `1px solid ${THEME.borderStrong}`,
          borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: THEME.textBright }}>
          Start the drawing
        </span>
        <span style={{ fontSize: 11.5, lineHeight: 1.5, color: THEME.textMuted }}>
          Reshape the plain box this part draws as now — every pin stays exactly where its wire
          lands — or start from nothing and draw the body yourself.
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" style={{ ...primaryButton, flex: 1 }} onClick={onFromBox}>
            From its box
          </button>
          <button type="button" style={{ ...subtleButton, flex: 1 }} onClick={onBlank}>
            Blank
          </button>
        </div>
      </div>
    </div>
  )
}

function PinList({
  pins,
  selectedKey,
  numberOf,
  onChoose,
}: {
  pins: readonly DraftPin[]
  selectedKey: string | null
  numberOf: (pin: DraftPin) => string | undefined
  onChoose: (key: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {pins.map((pin) => {
        const selected = pin.key === selectedKey
        const number = numberOf(pin)
        return (
          <button
            key={pin.key}
            type="button"
            onClick={() => onChoose(pin.key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 7px',
              borderRadius: 5,
              border: `1px solid ${selected ? THEME.accentBlue : THEME.borderSubtle}`,
              background: selected ? THEME.surfaceActive : THEME.surfaceRaised,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            <span style={{ width: 22, textAlign: 'left', color: THEME.textFaint }}>
              {number ?? '·'}
            </span>
            <span style={{ flex: 1, minWidth: 0, textAlign: 'left', color: THEME.textPrimary }}>
              {pin.name.trim() === '' ? '(no name)' : pin.name}
            </span>
            <span style={{ color: pin.placed === null ? THEME.statusWarn : THEME.textFaint }}>
              {pin.placed === null ? 'not drawn' : `points ${SIDE_WORD[pin.side]}`}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function PinPanel({
  pin,
  number,
  typeFixed,
  onChange,
  onTakeOff,
  onRemove,
}: {
  pin: DraftPin
  number: string | undefined
  typeFixed: boolean
  onChange: (field: string, change: (pin: DraftPin) => DraftPin) => void
  onTakeOff: () => void
  onRemove: (() => void) | null
}) {
  const placed = pin.placed
  const setPlacement = (field: string, change: (placement: PinPlacement) => PinPlacement) =>
    onChange(field, (p) => (p.placed === null ? p : { ...p, placed: change(p.placed) }))
  return (
    <Section
      title={`Pin ${pin.name.trim() === '' ? '(no name)' : pin.name}`}
      hint={
        placed === null
          ? 'not drawn — click the canvas with the Pin tool'
          : 'or drag it on the canvas'
      }
    >
      <div style={fieldRow}>
        <label style={fieldLabel}>
          Name
          <input
            style={textInput}
            value={pin.name}
            onChange={(e) => {
              const name = e.target.value
              onChange('name', (p) => ({ ...p, name }))
            }}
          />
        </label>
        <label
          style={fieldLabel}
          title="The pad this pin solders to, as the package labels it (1, A5). Blank: matched by the pin's name, then by order — the number shown greyed is the one it gets."
        >
          Number
          <input
            style={textInput}
            value={pin.pad}
            placeholder={number ?? 'none'}
            onChange={(e) => {
              const pad = e.target.value
              onChange('pad', (p) => ({ ...p, pad }))
            }}
          />
        </label>
      </div>
      <div style={fieldRow}>
        <label
          style={fieldLabel}
          title={
            typeFixed
              ? 'Set by the circuit inside this part — the logic simulation reads it to know which pins drive'
              : 'What the pin does electrically'
          }
        >
          Type
          <select
            style={textInput}
            value={pin.electrical}
            disabled={typeFixed}
            onChange={(e) => {
              const electrical = e.target.value as PinElectrical
              onChange('electrical', (p) => ({ ...p, electrical }))
            }}
          >
            {PIN_ELECTRICAL_TYPES.map((type) => (
              <option key={type} value={type}>
                {type.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
        <label style={fieldLabel}>
          Points
          <select
            style={textInput}
            value={pin.side}
            onChange={(e) => {
              const side = e.target.value as PinSide
              onChange('side', (p) => ({ ...p, side }))
            }}
          >
            {SIDES.map((side) => (
              <option key={side} value={side}>
                {SIDE_WORD[side]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {placed === null ? null : (
        <>
          <div style={fieldRow}>
            <label style={fieldLabel}>
              Style
              <select
                style={textInput}
                value={placed.style}
                onChange={(e) => {
                  const style = e.target.value as SymbolPinStyle
                  setPlacement('style', (p) => ({ ...p, style }))
                }}
              >
                {SYMBOL_PIN_STYLES.map((style) => (
                  <option key={style} value={style}>
                    {STYLE_WORD[style]}
                  </option>
                ))}
              </select>
            </label>
            <NumberField
              label="Length"
              value={placed.length}
              step={SCHEMATIC_MINOR_GRID_PX}
              onChange={(length) => setPlacement('length', (p) => ({ ...p, length }))}
            />
          </div>
          <div style={fieldRow}>
            <NumberField
              label="Tip X"
              value={placed.at.x}
              step={SCHEMATIC_GRID_PX}
              onChange={(x) => setPlacement('x', (p) => ({ ...p, at: { ...p.at, x } }))}
            />
            <NumberField
              label="Tip Y"
              value={placed.at.y}
              step={SCHEMATIC_GRID_PX}
              onChange={(y) => setPlacement('y', (p) => ({ ...p, at: { ...p.at, y } }))}
            />
          </div>
          <div style={{ display: 'flex', gap: 14 }}>
            <Tick
              label="hide name"
              checked={placed.hideName}
              onChange={(hideName) => setPlacement('hide-name', (p) => ({ ...p, hideName }))}
            />
            <Tick
              label="hide number"
              checked={placed.hideNumber}
              onChange={(hideNumber) => setPlacement('hide-number', (p) => ({ ...p, hideNumber }))}
            />
          </div>
          <button type="button" style={subtleButton} onClick={onTakeOff}>
            Take it off the drawing
          </button>
        </>
      )}
      {onRemove === null ? null : (
        <button type="button" style={subtleButton} onClick={onRemove}>
          Remove this pin
        </button>
      )}
    </Section>
  )
}

const GRAPHIC_TITLE: Record<SymbolGraphic['kind'], string> = {
  polyline: 'Line',
  rectangle: 'Rectangle',
  circle: 'Circle',
  arc: 'Arc',
  text: 'Text',
}

function PointFields({
  label,
  point,
  onChange,
}: {
  label: string
  point: SymbolPoint
  onChange: (point: SymbolPoint) => void
}) {
  return (
    <div style={fieldRow}>
      <NumberField
        label={`${label} X`}
        value={point.x}
        step={SCHEMATIC_MINOR_GRID_PX}
        onChange={(x) => onChange({ ...point, x })}
      />
      <NumberField
        label={`${label} Y`}
        value={point.y}
        step={SCHEMATIC_MINOR_GRID_PX}
        onChange={(y) => onChange({ ...point, y })}
      />
    </div>
  )
}

function GraphicPanel({
  graphic,
  textFieldRef,
  onChange,
  onDelete,
}: {
  graphic: SymbolGraphic
  textFieldRef: React.RefObject<HTMLInputElement | null>
  onChange: (field: string, change: (graphic: SymbolGraphic) => SymbolGraphic) => void
  onDelete: () => void
}) {
  return (
    <Section title={GRAPHIC_TITLE[graphic.kind]} hint="or drag it, and its grips, on the canvas">
      <GraphicFields graphic={graphic} textFieldRef={textFieldRef} onChange={onChange} />
      {graphic.kind === 'text' ? null : (
        <div style={fieldRow}>
          <NumberField
            label="Line width"
            value={graphic.strokeWidth}
            step={0.2}
            onChange={(strokeWidth) => onChange('stroke', (g) => ({ ...g, strokeWidth }))}
          />
          <label style={fieldLabel}>
            Fill
            <select
              style={textInput}
              value={graphic.fill}
              onChange={(e) => {
                const fill = e.target.value as SymbolFill
                onChange('fill', (g) => (g.kind === 'text' ? g : { ...g, fill }))
              }}
            >
              {SYMBOL_FILLS.map((fill) => (
                <option key={fill} value={fill}>
                  {FILL_WORD[fill]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <button type="button" style={subtleButton} onClick={onDelete}>
        Delete {GRAPHIC_TITLE[graphic.kind].toLowerCase()}
      </button>
    </Section>
  )
}

/** The points and sizes a shape is made of, each as an exact number. */
function GraphicFields({
  graphic,
  textFieldRef,
  onChange,
}: {
  graphic: SymbolGraphic
  textFieldRef: React.RefObject<HTMLInputElement | null>
  onChange: (field: string, change: (graphic: SymbolGraphic) => SymbolGraphic) => void
}) {
  const setPoint = (field: 'start' | 'mid' | 'end' | 'center' | 'at') => (point: SymbolPoint) =>
    onChange(field, (g) => ({ ...g, [field]: point }))
  switch (graphic.kind) {
    case 'polyline':
      return (
        <>
          {graphic.points.map((point, index) => (
            <PointFields
              // biome-ignore lint/suspicious/noArrayIndexKey: a corner has no id of its own — its place along the line is its identity
              key={index}
              label={`Corner ${index + 1}`}
              point={point}
              onChange={(next) =>
                onChange(`point:${index}`, (g) =>
                  g.kind === 'polyline'
                    ? { ...g, points: g.points.map((p, i) => (i === index ? next : p)) }
                    : g,
                )
              }
            />
          ))}
        </>
      )
    case 'rectangle':
      return (
        <>
          <PointFields label="Corner" point={graphic.start} onChange={setPoint('start')} />
          <PointFields label="Opposite" point={graphic.end} onChange={setPoint('end')} />
        </>
      )
    case 'circle':
      return (
        <>
          <PointFields label="Centre" point={graphic.center} onChange={setPoint('center')} />
          <NumberField
            label="Radius"
            value={graphic.radius}
            step={SCHEMATIC_MINOR_GRID_PX}
            onChange={(radius) =>
              onChange('radius', (g) => (g.kind === 'circle' ? { ...g, radius } : g))
            }
          />
        </>
      )
    case 'arc':
      return (
        <>
          <PointFields label="Start" point={graphic.start} onChange={setPoint('start')} />
          <PointFields label="Through" point={graphic.mid} onChange={setPoint('mid')} />
          <PointFields label="End" point={graphic.end} onChange={setPoint('end')} />
        </>
      )
    case 'text':
      return (
        <>
          <label style={fieldLabel}>
            Text
            <input
              ref={textFieldRef}
              style={textInput}
              value={graphic.text}
              onChange={(e) => {
                const text = e.target.value
                onChange('text', (g) => (g.kind === 'text' ? { ...g, text } : g))
              }}
            />
          </label>
          <div style={fieldRow}>
            <NumberField
              label="Size"
              value={graphic.size}
              step={1}
              onChange={(size) => onChange('size', (g) => (g.kind === 'text' ? { ...g, size } : g))}
            />
            <label style={fieldLabel}>
              Reads
              <select
                style={textInput}
                value={graphic.angle === 90 ? 'up' : 'across'}
                onChange={(e) => {
                  const up = e.target.value === 'up'
                  onChange('angle', (g) => {
                    if (g.kind !== 'text') return g
                    const { angle: _was, ...across } = g
                    return up ? { ...across, angle: 90 } : across
                  })
                }}
              >
                <option value="across">across</option>
                <option value="up">up</option>
              </select>
            </label>
          </div>
          <PointFields label="Centre" point={graphic.at} onChange={setPoint('at')} />
        </>
      )
  }
}

function FieldRow({
  label,
  text,
  field,
  selected,
  onSelect,
  onChange,
}: {
  label: string
  text: string
  field: { at: SymbolPoint; visible: boolean }
  selected: boolean
  onSelect: () => void
  onChange: (
    field: string,
    change: (current: { at: SymbolPoint; visible: boolean }) => {
      at: SymbolPoint
      visible: boolean
    },
  ) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <input
          type="checkbox"
          checked={field.visible}
          title="Show it on the schematic"
          onChange={(e) => {
            const visible = e.target.checked
            onChange('visible', (f) => ({ ...f, visible }))
          }}
        />
        <button
          type="button"
          onClick={onSelect}
          style={{
            flex: 1,
            minWidth: 0,
            textAlign: 'left',
            padding: '2px 6px',
            borderRadius: 5,
            border: `1px solid ${selected ? THEME.accentBlue : 'transparent'}`,
            background: selected ? THEME.surfaceActive : 'transparent',
            color: THEME.textPrimary,
            fontSize: 11,
            cursor: 'pointer',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label} <span style={{ color: THEME.textFaint }}>· {text}</span>
        </button>
      </div>
      {selected ? (
        <PointFields
          label="At"
          point={field.at}
          onChange={(at) => onChange('at', (f) => ({ ...f, at }))}
        />
      ) : null}
    </div>
  )
}

function Tick({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 11,
        color: THEME.textMuted,
      }}
    >
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

const smallButton: React.CSSProperties = { ...subtleButton, padding: '3px 9px', fontSize: 11 }
const noteText: React.CSSProperties = { fontSize: 10.5, lineHeight: 1.45, color: THEME.textFaint }
const linkButton: React.CSSProperties = {
  marginLeft: 6,
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: THEME.accentBlue,
  fontSize: 11,
  cursor: 'pointer',
}
