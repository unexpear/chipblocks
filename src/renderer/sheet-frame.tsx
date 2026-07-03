import { useViewport } from '@xyflow/react'
import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { THEME } from './theme.ts'

/**
 * The drawing sheet — the bordered page + ISO zone grid + title block a formal schematic sits on,
 * the way KiCad (and any engineering drawing) frames a sheet. It follows the real standards: ISO 216
 * paper sizes (A4 = 297×210 mm…), an ISO 5457 frame (a 20 mm filing margin on the binding/left edge,
 * 10 mm elsewhere) divided into 50 mm fields labelled A,B,C… down and 1,2,3… across, and an ISO 7200
 * title block in the bottom-right corner (title, company, size, date, revision, sheet number, file).
 *
 * Drawn behind the parts like CoordinateAxes: a screen-space SVG that tracks the viewport, so the page
 * stays pinned under the circuit as you pan/zoom. The sheet itself is click-through; the title-block
 * FIELDS are fillable in place — click Title / Company / Rev / Date and a text box opens right in the
 * cell (Size opens the paper-size picker), Enter or clicking away commits, Esc cancels. The same
 * values remain editable in the Page Settings dialog; App owns the state + persistence.
 */

export type SheetSize = 'A4' | 'A3' | 'A2' | 'Letter'
export type SheetOrientation = 'landscape' | 'portrait'
export type SheetSettings = {
  size: SheetSize
  orientation: SheetOrientation
  title: string
  company: string
  rev: string
  date: string
  comment: string
}

export const DEFAULT_SHEET: SheetSettings = {
  size: 'A4',
  orientation: 'landscape',
  title: '',
  company: '',
  rev: '',
  date: '',
  comment: '',
}

/** Paper sizes in millimetres as [long edge, short edge] (ISO 216 + US Letter). */
const SHEET_MM: Record<SheetSize, [number, number]> = {
  A4: [297, 210],
  A3: [420, 297],
  A2: [594, 420],
  Letter: [279.4, 215.9],
}

const SIZES: SheetSize[] = ['A4', 'A3', 'A2', 'Letter']

/** Flow units per millimetre — the page's scale on the canvas (an A4 lands ~1188×840 units). */
const PER_MM = 4

export function sheetFlowSize(settings: SheetSettings): { width: number; height: number } {
  const [longMm, shortMm] = SHEET_MM[settings.size]
  const wMm = settings.orientation === 'landscape' ? longMm : shortMm
  const hMm = settings.orientation === 'landscape' ? shortMm : longMm
  return { width: wMm * PER_MM, height: hMm * PER_MM }
}

/** The fillable title-block fields (Size is an enum → a picker, the rest are free text). */
type EditableField = 'title' | 'company' | 'rev' | 'date' | 'size'

export function SheetFrame({
  settings,
  projectName,
  light,
  onEdit,
}: {
  settings: SheetSettings
  projectName: string
  light: boolean
  onEdit?: (patch: Partial<SheetSettings>) => void
}) {
  const { x, y, zoom } = useViewport()
  const { width: W, height: H } = sheetFlowSize(settings)
  const [editing, setEditing] = useState<EditableField | null>(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (editing !== null && editing !== 'size') inputRef.current?.select()
  }, [editing])

  // Flow → screen, and a mm-based font size that scales with the zoom (the page is a fixed size in
  // flow space, so everything on it grows/shrinks together).
  const sx = (fx: number) => x + fx * zoom
  const sy = (fy: number) => y + fy * zoom
  const mm = (n: number) => n * PER_MM * zoom

  const edge = light ? THEME.borderStrong : THEME.borderStrong
  const frame = light ? THEME.textMuted : THEME.textSoft
  const ink = light ? THEME.textMuted : THEME.textSoft
  const faint = light ? THEME.textFaint : THEME.textFaint

  // Margins (mm → flow): 20 on the left (filing), 10 elsewhere → the inner frame rectangle.
  const ml = 20 * PER_MM
  const mo = 10 * PER_MM
  const fx0 = ml
  const fy0 = mo
  const fx1 = W - mo
  const fy1 = H - mo
  const fw = fx1 - fx0
  const fh = fy1 - fy0

  // Zone grid: ~50 mm fields, letters A.. down both side margins, numbers 1.. across top + bottom.
  const cols = Math.max(1, Math.round(fw / (50 * PER_MM)))
  const rows = Math.max(1, Math.round(fh / (50 * PER_MM)))
  const colW = fw / cols
  const rowH = fh / rows

  // Title block (mm): bottom-right of the frame.
  const tbW = Math.min(190 * PER_MM, fw)
  const tbH = 38 * PER_MM
  const tx = fx1 - tbW
  const ty = fy1 - tbH
  const r1 = ty + 14 * PER_MM // below the title row
  const r2 = r1 + 8 * PER_MM
  const r3 = r2 + 8 * PER_MM
  const cMid = tx + tbW * 0.5 // company | size/rev divider
  const cRev = tx + tbW * 0.78 // size | rev divider

  // Each fillable field's cell rectangle (flow units) — the click target, and where the text box sits.
  const FIELD_RECTS: Record<EditableField, { x: number; y: number; w: number; h: number }> = {
    title: { x: tx, y: ty, w: tbW, h: r1 - ty },
    company: { x: tx, y: r1, w: cMid - tx, h: r2 - r1 },
    size: { x: cMid, y: r1, w: cRev - cMid, h: r2 - r1 },
    rev: { x: cRev, y: r1, w: fx1 - cRev, h: r2 - r1 },
    date: { x: cMid, y: r2, w: fx1 - cMid, h: r3 - r2 },
  }

  const beginEdit = (field: EditableField, event: React.MouseEvent) => {
    // The sheet lives under the canvas tools — a field click must not also drop a wire corner /
    // move a probe, so it never reaches the wrapper's click chain.
    event.stopPropagation()
    if (onEdit === undefined) return
    setDraft(field === 'size' ? settings.size : settings[field])
    setEditing(field)
  }
  const commit = () => {
    if (editing !== null && editing !== 'size') onEdit?.({ [editing]: draft })
    setEditing(null)
  }
  const cancel = () => setEditing(null)

  // The faint dashed underline that marks a cell as a form field — drawn with the sheet (behind
  // the parts); the CLICK TARGET lives in the top overlay layer, because the sheet svg sits under
  // the React Flow pane and would never receive the click.
  const fieldUnderline = (field: EditableField, underlineY: number): React.JSX.Element => {
    const r = FIELD_RECTS[field]
    return (
      <line
        key={`underline-${field}`}
        x1={sx(r.x + 1.4 * PER_MM)}
        y1={sy(underlineY)}
        x2={sx(r.x + r.w - 1.4 * PER_MM)}
        y2={sy(underlineY)}
        stroke={faint}
        strokeWidth={0.6}
        strokeDasharray="3 3"
        opacity={0.5}
      />
    )
  }
  // An invisible click target over a fillable cell (the whole cell, not just the text glyphs).
  const fieldTarget = (field: EditableField): React.JSX.Element => {
    const r = FIELD_RECTS[field]
    return (
      // biome-ignore lint/a11y/useKeyWithClickEvents: canvas-surface affordance; the same fields have full keyboard editing in the Page Settings dialog
      <rect
        key={`target-${field}`}
        x={sx(r.x)}
        y={sy(r.y)}
        width={r.w * zoom}
        height={r.h * zoom}
        fill="transparent"
        style={{ pointerEvents: 'all', cursor: 'text' }}
        onClick={(event) => beginEdit(field, event)}
      >
        <title>{`Click to fill in ${field === 'size' ? 'the paper size' : field}`}</title>
      </rect>
    )
  }

  const cell = (
    fx: number,
    fy: number,
    label: string,
    value: string,
    valueSize = 3.2,
  ): React.JSX.Element => (
    <g key={`${label}-${fx}-${fy}`}>
      <text x={sx(fx + 1.4 * PER_MM)} y={sy(fy + 3.3 * PER_MM)} fill={faint} fontSize={mm(2.1)}>
        {label}
      </text>
      <text
        x={sx(fx + 1.4 * PER_MM)}
        y={sy(fy + 6.6 * PER_MM)}
        fill={ink}
        fontSize={mm(valueSize)}
        fontWeight={600}
      >
        {value || '—'}
      </text>
    </g>
  )

  // The in-place editor: an input (or the size picker) sitting exactly over the cell, scaled with
  // the zoom so it reads as part of the sheet. Enter/blur commits, Esc cancels.
  const editorFor = (field: EditableField): React.JSX.Element => {
    const r = FIELD_RECTS[field]
    const isTitle = field === 'title'
    const boxStyle: CSSProperties = {
      position: 'absolute',
      left: sx(r.x + 1 * PER_MM),
      top: sy(r.y + (isTitle ? 4.6 : 3.9) * PER_MM),
      width: (r.w - 2 * PER_MM) * zoom,
      height: (r.h - (isTitle ? 5.4 : 4.6) * PER_MM) * zoom,
      background: THEME.surfaceInput,
      border: `1px solid ${THEME.accentBlue}`,
      borderRadius: 3,
      color: THEME.textBright,
      fontFamily: 'system-ui, sans-serif',
      fontSize: mm(isTitle ? 5.2 : 3.2),
      fontWeight: isTitle ? 700 : 600,
      padding: `0 ${Math.max(2, mm(0.4))}px`,
      zIndex: 31,
      boxSizing: 'border-box',
    }
    if (field === 'size') {
      return (
        <select
          // biome-ignore lint/a11y/noAutofocus: the picker IS the interaction the click asked for
          autoFocus
          value={settings.size}
          onChange={(event) => {
            onEdit?.({ size: event.target.value as SheetSize })
            setEditing(null)
          }}
          onBlur={cancel}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Escape') cancel()
          }}
          style={boxStyle}
        >
          {SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      )
    }
    return (
      <input
        ref={inputRef}
        // biome-ignore lint/a11y/noAutofocus: the text box IS the interaction the click asked for
        autoFocus
        value={draft}
        placeholder={field === 'date' ? 'YYYY-MM-DD' : ''}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          // Keep canvas shortcuts (Esc = cancel wire, Delete = remove part…) out of the text box.
          event.stopPropagation()
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') cancel()
        }}
        onClick={(event) => event.stopPropagation()}
        style={boxStyle}
      />
    )
  }

  return (
    <>
      <svg
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          overflow: 'hidden',
          zIndex: 0,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <title>drawing sheet</title>
        {/* page edge + inner frame */}
        <rect
          x={sx(0)}
          y={sy(0)}
          width={W * zoom}
          height={H * zoom}
          fill="none"
          stroke={edge}
          strokeWidth={1}
        />
        <rect
          x={sx(fx0)}
          y={sy(fy0)}
          width={fw * zoom}
          height={fh * zoom}
          fill="none"
          stroke={frame}
          strokeWidth={1.4}
        />

        {/* zone reference marks: letters down the side margins, numbers across top + bottom */}
        {Array.from({ length: rows }, (_, i) => {
          const yc = fy0 + (i + 0.5) * rowH
          const letter = String.fromCharCode(65 + i)
          const tickTop = fy0 + i * rowH
          return (
            <g key={`row-${letter}`} fill={faint} fontSize={mm(3)} textAnchor="middle">
              <text x={sx(ml * 0.5)} y={sy(yc + 1.4 * PER_MM)}>
                {letter}
              </text>
              <text x={sx(W - mo * 0.5)} y={sy(yc + 1.4 * PER_MM)}>
                {letter}
              </text>
              {i > 0 ? (
                <>
                  <line
                    x1={sx(0)}
                    y1={sy(tickTop)}
                    x2={sx(fx0)}
                    y2={sy(tickTop)}
                    stroke={faint}
                    strokeWidth={0.75}
                  />
                  <line
                    x1={sx(fx1)}
                    y1={sy(tickTop)}
                    x2={sx(W)}
                    y2={sy(tickTop)}
                    stroke={faint}
                    strokeWidth={0.75}
                  />
                </>
              ) : null}
            </g>
          )
        })}
        {Array.from({ length: cols }, (_, i) => {
          const xc = fx0 + (i + 0.5) * colW
          const num = String(i + 1)
          const tickLeft = fx0 + i * colW
          return (
            <g key={`col-${num}`} fill={faint} fontSize={mm(3)} textAnchor="middle">
              <text x={sx(xc)} y={sy(mo * 0.5 + 1.4 * PER_MM)}>
                {num}
              </text>
              <text x={sx(xc)} y={sy(H - mo * 0.5 + 1.4 * PER_MM)}>
                {num}
              </text>
              {i > 0 ? (
                <>
                  <line
                    x1={sx(tickLeft)}
                    y1={sy(0)}
                    x2={sx(tickLeft)}
                    y2={sy(fy0)}
                    stroke={faint}
                    strokeWidth={0.75}
                  />
                  <line
                    x1={sx(tickLeft)}
                    y1={sy(fy1)}
                    x2={sx(tickLeft)}
                    y2={sy(H)}
                    stroke={faint}
                    strokeWidth={0.75}
                  />
                </>
              ) : null}
            </g>
          )
        })}

        {/* title block (ISO 7200, bottom-right) */}
        <g>
          <rect
            x={sx(tx)}
            y={sy(ty)}
            width={tbW * zoom}
            height={tbH * zoom}
            fill="none"
            stroke={frame}
            strokeWidth={1.2}
          />
          <line x1={sx(tx)} y1={sy(r1)} x2={sx(fx1)} y2={sy(r1)} stroke={frame} strokeWidth={0.9} />
          <line x1={sx(tx)} y1={sy(r2)} x2={sx(fx1)} y2={sy(r2)} stroke={frame} strokeWidth={0.9} />
          <line x1={sx(tx)} y1={sy(r3)} x2={sx(fx1)} y2={sy(r3)} stroke={frame} strokeWidth={0.9} />
          <line
            x1={sx(cMid)}
            y1={sy(r1)}
            x2={sx(cMid)}
            y2={sy(r2)}
            stroke={frame}
            strokeWidth={0.9}
          />
          <line
            x1={sx(cRev)}
            y1={sy(r1)}
            x2={sx(cRev)}
            y2={sy(r2)}
            stroke={frame}
            strokeWidth={0.9}
          />
          <line
            x1={sx(cMid)}
            y1={sy(r2)}
            x2={sx(cMid)}
            y2={sy(r3)}
            stroke={frame}
            strokeWidth={0.9}
          />

          {/* title row */}
          <text x={sx(tx + 1.6 * PER_MM)} y={sy(ty + 4 * PER_MM)} fill={faint} fontSize={mm(2.1)}>
            Title
          </text>
          <text
            x={sx(tx + 1.6 * PER_MM)}
            y={sy(ty + 10.5 * PER_MM)}
            fill={ink}
            fontSize={mm(5.2)}
            fontWeight={700}
          >
            {settings.title || 'Untitled'}
          </text>

          {cell(tx, r1, 'Company', settings.company)}
          {cell(cMid, r1, 'Size', settings.size)}
          {cell(cRev, r1, 'Rev', settings.rev)}
          {cell(tx, r2, 'Sheet', '1/1')}
          {cell(cMid, r2, 'Date', settings.date)}

          <text x={sx(tx + 1.6 * PER_MM)} y={sy(r3 + 5.4 * PER_MM)} fill={ink} fontSize={mm(2.9)}>
            File: {projectName || 'untitled'}.chipblocks
          </text>
          <text
            x={sx(fx1 - 1.6 * PER_MM)}
            y={sy(r3 + 5.4 * PER_MM)}
            fill={faint}
            fontSize={mm(2.6)}
            textAnchor="end"
          >
            ChipBlocks
          </text>

          {/* the form-field underlines (the affordance draws with the sheet, behind the parts) */}
          {onEdit !== undefined ? (
            <>
              {fieldUnderline('title', ty + 11.6 * PER_MM)}
              {fieldUnderline('company', r1 + 7.3 * PER_MM)}
              {fieldUnderline('size', r1 + 7.3 * PER_MM)}
              {fieldUnderline('rev', r1 + 7.3 * PER_MM)}
              {fieldUnderline('date', r2 + 7.3 * PER_MM)}
            </>
          ) : null}
        </g>
      </svg>
      {/* the click targets ride ABOVE the canvas layers (the sheet svg is under the pane and would
          never see the click); only the small title-block cells intercept — the rest stays free. */}
      {onEdit !== undefined && editing === null ? (
        <svg
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            overflow: 'hidden',
            zIndex: 30,
          }}
        >
          <title>title-block fields</title>
          {fieldTarget('title')}
          {fieldTarget('company')}
          {fieldTarget('size')}
          {fieldTarget('rev')}
          {fieldTarget('date')}
        </svg>
      ) : null}
      {editing !== null ? editorFor(editing) : null}
    </>
  )
}
