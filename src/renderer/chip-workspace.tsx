/**
 * THE CHIP WORKSPACE — the fourth level of the app (Circuit ▸ Board ▸ Chip ▸ System). Like the Board
 * level, it is not a separate document: it's a live PROJECTION of the same schematic you drew, one
 * layer further down. Where Board projects the design onto footprints on FR4, Chip projects it onto
 * silicon. It shows what the design BECOMES on a chip — its top-level parts and the real primitive
 * devices they flatten to (the silicon inventory), its timing sign-off + area estimate, and a
 * FLOORPLAN of its gate cells actually placed into rows (cell-place.ts), all from the same
 * flattenBlocks the solver uses. Wiring (routing), a design-rule check, and a GDS layout are the next
 * silicon layers.
 */

import { type ReactNode, useMemo } from 'react'
import type { TimingReport } from '../static-timing.ts'
import { type CanvasEdgeLike, type CanvasNodeLike, flattenBlocks } from './blocks.ts'
import { type CellGeometry, designCellArea, PROCESS, standardCells } from './cell-layout.ts'
import { type Floorplan, placeCells } from './cell-place.ts'
import { ANNOTATION_DEFINITIONS } from './part-defaults.ts'
import { THEME } from './theme.ts'
import { TimingPanel } from './timing-panel.tsx'

type Tally = { label: string; count: number }

function tally(items: CanvasNodeLike[], key: (n: CanvasNodeLike) => string): Tally[] {
  const counts = new Map<string, number>()
  for (const it of items) {
    const k = key(it)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/** A readable label for a top-level part — a block's name (e.g. "CPU (4-bit)"), else its definition. */
function partLabel(node: CanvasNodeLike): string {
  return node.data.block?.name ?? node.data.definition
}

export type ChipInventory = {
  isEmpty: boolean
  topParts: Tally[]
  devices: Tally[]
  partTotal: number
  deviceTotal: number
}

/** Project the schematic into what it becomes on a chip: the top-level parts, and the real primitive
 *  devices they flatten to. The twin of how the Board level derives a physical projection from the
 *  same nodes — one layer down. */
// Drawing annotations (text/boxes/lines) and wiring aids (net labels, junctions, ground) are not
// silicon devices — exclude them from the inventory, matching the board's own "not a real part" set.
const NOT_A_DEVICE = new Set<string>([...ANNOTATION_DEFINITIONS, 'junction', 'net_label', 'ground'])
const isDevice = (node: CanvasNodeLike) => !NOT_A_DEVICE.has(node.data.definition)

export function deriveChip(nodes: CanvasNodeLike[], edges: CanvasEdgeLike[]): ChipInventory {
  const parts = nodes.filter(isDevice)
  if (parts.length === 0) {
    return { isEmpty: true, topParts: [], devices: [], partTotal: 0, deviceTotal: 0 }
  }
  const devices = flattenBlocks(nodes, edges).nodes.filter(isDevice)
  return {
    isEmpty: false,
    topParts: tally(parts, partLabel),
    devices: tally(devices, (n) => n.data.definition),
    partTotal: parts.length,
    deviceTotal: devices.length,
  }
}

function Column({ title, rows, note }: { title: string; rows: Tally[]; note?: string }) {
  return (
    <div
      style={{
        flex: '1 1 260px',
        minWidth: 240,
        background: THEME.surfaceInput,
        border: `1px solid ${THEME.borderSubtle}`,
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '10px 14px',
          borderBottom: `1px solid ${THEME.borderSubtle}`,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '.06em',
          textTransform: 'uppercase',
          color: THEME.textSoft,
        }}
      >
        {title}
      </div>
      <div style={{ maxHeight: 340, overflow: 'auto' }}>
        {rows.map((r) => (
          <div
            key={r.label}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              padding: '7px 14px',
              fontSize: 13,
              borderBottom: `1px solid ${THEME.borderSubtle}`,
            }}
          >
            <span style={{ color: THEME.textBright, wordBreak: 'break-word' }}>{r.label}</span>
            <span
              style={{ color: THEME.textSoft, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}
            >
              {r.count.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
      {note && (
        <div style={{ padding: '8px 14px', fontSize: 11, color: THEME.textFaint }}>{note}</div>
      )}
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '.06em',
        textTransform: 'uppercase',
        color: THEME.textSoft,
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  )
}

const fmtArea = (um2: number): string =>
  um2 >= 1e6 ? `${(um2 / 1e6).toFixed(2)} mm²` : `${Math.round(um2).toLocaleString()} µm²`

/** A small glyph of a standard cell — a fixed-height box with VDD/VSS power rails top and bottom and
 *  one vertical poly stripe per transistor column, drawn to the cell's real λ proportions. */
function CellShape({ cell }: { cell: CellGeometry }) {
  const H = 46
  const s = H / cell.heightLambda // px per λ
  const w = cell.widthLambda * s
  const rail = PROCESS.railWidth.lambda * s
  const margin = PROCESS.edgeMargin.lambda * s
  const pitch = PROCESS.polyPitch.lambda * s
  const polyW = Math.max(2, pitch * 0.28)
  return (
    <svg
      width={w}
      height={H}
      viewBox={`0 0 ${w} ${H}`}
      style={{ display: 'block' }}
      aria-hidden="true"
    >
      <title>{`${cell.name} cell — ${cell.columns} column${cell.columns === 1 ? '' : 's'}`}</title>
      <rect
        x={0.5}
        y={0.5}
        width={w - 1}
        height={H - 1}
        rx={2}
        fill={THEME.surfaceBase}
        stroke={THEME.borderStrong}
      />
      <rect x={0} y={0} width={w} height={rail} fill={THEME.accentBlue} opacity={0.5} />
      <rect x={0} y={H - rail} width={w} height={rail} fill={THEME.accentBlue} opacity={0.5} />
      {Array.from({ length: cell.columns }, (_, i) => {
        const x = margin + i * pitch + (pitch - polyW) / 2
        return (
          <rect
            key={x}
            x={x}
            y={rail + 2}
            width={polyW}
            height={H - 2 * rail - 4}
            fill={THEME.statusWarn}
            opacity={0.85}
          />
        )
      })}
    </svg>
  )
}

/** One cell in the library — its shape + name + real dimensions + estimated area. */
function CellCard({ cell }: { cell: CellGeometry }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        background: THEME.surfaceInput,
        border: `1px solid ${THEME.borderSubtle}`,
        borderRadius: 8,
        minWidth: 190,
      }}
    >
      <CellShape cell={cell} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 640, color: THEME.textBright }}>{cell.name}</div>
        <div style={{ fontSize: 11.5, color: THEME.textSoft, fontVariantNumeric: 'tabular-nums' }}>
          {cell.columns} col · {cell.widthUm.toFixed(1)} × {cell.heightUm.toFixed(0)} µm
        </div>
        <div style={{ fontSize: 11, color: THEME.textFaint }}>
          {Math.round(cell.areaUm2)} µm²{cell.reliable ? '' : ' · approx.'}
        </div>
      </div>
    </div>
  )
}

/** False-colour per gate type, so the placed die reads as regions of like cells — a die-shot look.
 *  Fixed hues (not theme tokens) so the same gate is the same colour in light and dark. */
const CELL_COLOR: Record<string, string> = {
  NOT: '#5b8def',
  Buffer: '#6fb1fc',
  NAND: '#f2a541',
  NOR: '#e5714f',
  AND: '#3fb27f',
  OR: '#67c99a',
  XOR: '#b07fd6',
  XNOR: '#8f6fd0',
}
const cellColor = (name: string): string => CELL_COLOR[name] ?? '#8a8f98'

// Above this many cells we draw one rectangle per ROW instead of per cell, so the SVG element count
// stays bounded (~row count, a few hundred at most) no matter how large the design — at the fit scale a
// huge die's cells are sub-pixel anyway, so the row bands read the same. Verified fine per-cell at ~6.2k.
const CELL_RENDER_CAP = 12000

/** The placed floorplan drawn to scale — the design's gate cells packed into shared-rail rows, each a
 *  real λ-sized rectangle at a real position, fit into the pane. The first thing you can SEE laid out. */
function FloorplanView({ plan, light }: { plan: Floorplan; light: boolean }) {
  const maxW = 720
  const maxH = 440
  const scale = Math.min(maxW / plan.dieWidthLambda, maxH / plan.dieHeightLambda)
  const w = plan.dieWidthLambda * scale
  const h = plan.dieHeightLambda * scale
  const present = [...new Set(plan.cells.map((c) => c.name))].sort()
  // Per-cell tooltips are cheap in the dozens but bloat the DOM in the thousands — only for small designs.
  const showTitles = plan.cells.length <= 1500
  // Very large designs draw as row bands (one rect per row) to keep the element count bounded.
  const perCell = plan.cells.length <= CELL_RENDER_CAP
  const rowBands = useMemo(() => {
    if (perCell) return []
    const widthByRow = new Map<number, number>()
    for (const c of plan.cells) {
      const right = c.x + c.w
      if (right > (widthByRow.get(c.row) ?? 0)) widthByRow.set(c.row, right)
    }
    return [...widthByRow.entries()].map(([row, width]) => ({ row, width }))
  }, [plan, perCell])
  return (
    <div>
      <div
        style={{
          fontSize: 14,
          color: THEME.textBright,
          fontWeight: 620,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {plan.cells.length.toLocaleString()} cells placed in {plan.rows.toLocaleString()} rows · die
        ≈ {plan.dieWidthUm.toFixed(0)} × {plan.dieHeightUm.toFixed(0)} µm ·{' '}
        {(plan.utilization * 100).toFixed(0)}% cell utilization
      </div>
      <div style={{ fontSize: 12, color: THEME.textFaint, margin: '4px 0 12px', lineHeight: 1.6 }}>
        Placement only — the gate cells packed into shared-rail rows (in flatten order). Wiring
        (routing) and the design-rule check are the next silicon layers.
        {perCell ? '' : ' Too many cells to draw individually — showing the placed rows as bands.'}
      </div>
      <div
        style={{
          display: 'inline-block',
          border: `1px solid ${THEME.borderSubtle}`,
          borderRadius: 8,
          background: THEME.surfaceInput,
          padding: 10,
          maxWidth: '100%',
          overflow: 'auto',
        }}
      >
        <svg
          width={w}
          height={h}
          viewBox={`0 0 ${plan.dieWidthLambda} ${plan.dieHeightLambda}`}
          style={{ display: 'block' }}
          role="img"
          aria-label={`Chip floorplan: ${plan.cells.length} standard cells in ${plan.rows} rows`}
        >
          <rect
            x={0}
            y={0}
            width={plan.dieWidthLambda}
            height={plan.dieHeightLambda}
            fill={THEME.surfaceBase}
            stroke={light ? THEME.borderStrong : THEME.textSoft}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
          {perCell
            ? plan.cells.map((c) => (
                <rect
                  key={c.id}
                  x={c.x}
                  y={c.y}
                  width={c.w}
                  height={c.h}
                  fill={cellColor(c.name)}
                  opacity={0.9}
                >
                  {showTitles ? (
                    <title>{`${c.name} — ${(c.w * PROCESS.lambdaUm).toFixed(1)} × ${(c.h * PROCESS.lambdaUm).toFixed(0)} µm`}</title>
                  ) : null}
                </rect>
              ))
            : rowBands.map((b) => (
                <rect
                  key={b.row}
                  x={0}
                  y={b.row * PROCESS.rowHeight.lambda}
                  width={b.width}
                  height={PROCESS.rowHeight.lambda}
                  fill={cellColor('AND')}
                  opacity={0.85}
                />
              ))}
        </svg>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
        {(perCell ? present : []).map((name) => (
          <span
            key={name}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: THEME.textSoft,
            }}
          >
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                background: cellColor(name),
                display: 'inline-block',
              }}
            />
            {name}
          </span>
        ))}
      </div>
    </div>
  )
}

/** The static-timing result the app already computes (max clock speed, critical path, slack) — the
 *  Chip level's sign-off. `hasRegisters` is whether the design has a clocked element to sign off. */
export type ChipTiming = { report: TimingReport; hasRegisters: boolean; clockDetected: boolean }

/** The Chip level's editing surface — an absolute overlay over the still-mounted schematic, exactly
 *  like the Board overlay. Mounted only when the level is 'chip', so its projection only computes then. */
export function ChipView({
  nodes,
  edges,
  timing,
  light,
}: {
  nodes: CanvasNodeLike[]
  edges: CanvasEdgeLike[]
  timing: ChipTiming
  light: boolean
}) {
  const chip = useMemo(() => deriveChip(nodes, edges), [nodes, edges])
  const cells = useMemo(() => standardCells(), [])
  const area = useMemo(() => designCellArea(nodes, edges), [nodes, edges])
  const floorplan = useMemo(() => placeCells(nodes, edges), [nodes, edges])
  const plural = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? '' : 's'}`

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 40,
        background: THEME.surfaceBase,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 12px',
          borderBottom: `1px solid ${THEME.borderSubtle}`,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 12, color: THEME.textSoft, fontWeight: 600 }}>Chip</span>
        <span style={{ fontSize: 11, color: THEME.textFaint }}>
          {chip.isEmpty
            ? 'no design yet'
            : `${plural(chip.partTotal, 'part')} · flattens to ${plural(chip.deviceTotal, 'device')}${
                area.cellCount > 0 ? ` · ~${fmtArea(area.areaUm2)} standard-cell silicon` : ''
              }`}
        </span>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        {chip.isEmpty ? (
          <div style={{ maxWidth: 460, color: THEME.textSoft, fontSize: 14, lineHeight: 1.6 }}>
            <div style={{ fontWeight: 600, color: THEME.textBright, marginBottom: 6 }}>
              Nothing to lay out yet.
            </div>
            Build a circuit on the <strong>Circuit</strong> level — drop a chip you designed, like
            the CPU — then come back here to see it as silicon.
          </div>
        ) : (
          <div style={{ maxWidth: 760 }}>
            {/* TIMING SIGN-OFF — the static-timing analysis the app already computes, promoted here as
                the Chip level's headline: the top clock speed and the critical path that limits it. The
                delays are REAL (summed from the transistors). Shows for a clocked design (a CPU / register). */}
            <div style={{ marginBottom: 26 }}>
              <SectionLabel>Timing sign-off</SectionLabel>
              {timing.hasRegisters ? (
                <TimingPanel
                  report={timing.report}
                  clockDetected={timing.clockDetected}
                  light={light}
                />
              ) : (
                <div
                  style={{ fontSize: 13, color: THEME.textFaint, lineHeight: 1.6, maxWidth: 560 }}
                >
                  No clocked elements yet — a chip's timing sign-off (its top clock speed and the
                  critical path that limits it) appears once the design has a flip-flop or register,
                  like the CPU.
                </div>
              )}
            </div>
            {area.cellCount > 0 && (
              <div style={{ marginBottom: 26 }}>
                <SectionLabel>Silicon area (estimate)</SectionLabel>
                <div style={{ fontSize: 15, color: THEME.textBright, fontWeight: 620 }}>
                  {plural(area.cellCount, 'standard cell')} · ~{fmtArea(area.areaUm2)}
                </div>
                <div style={{ fontSize: 12, color: THEME.textFaint, marginTop: 4 }}>
                  first-order estimate from the λ-scalable cell sizes
                  {area.anyUnreliable ? ' (some transmission-gate cells are approximated)' : ''}
                </div>
              </div>
            )}
            {/* FLOORPLAN — the design's gate cells actually PLACED into shared-rail rows and drawn to
                scale: the first time the chip is something you can see laid out, not just counted. */}
            {floorplan.cells.length > 0 && (
              <div style={{ marginBottom: 26 }}>
                <SectionLabel>Floorplan (placed cells)</SectionLabel>
                <FloorplanView plan={floorplan} light={light} />
              </div>
            )}
            <div style={{ fontSize: 14, color: THEME.textSoft, marginBottom: 18, lineHeight: 1.6 }}>
              This is your circuit projected into silicon — the parts you placed, flattened all the
              way down to the real devices they're made of, then placed above as a floorplan. Below
              is the design's inventory; wiring (routing) and the design-rule check come next.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              <Column title="Your design" rows={chip.topParts} />
              <Column
                title="In silicon"
                rows={chip.devices}
                note="every primitive device the design flattens to"
              />
            </div>

            {/* STANDARD-CELL LIBRARY — each logic gate's real physical cell shape, sized from its own
                transistors + the cited λ-scalable rules. The foundation of the coming floorplan/routing. */}
            <div style={{ marginTop: 30 }}>
              <SectionLabel>Standard-cell library</SectionLabel>
              <div
                style={{
                  fontSize: 13,
                  color: THEME.textFaint,
                  marginBottom: 14,
                  lineHeight: 1.6,
                  maxWidth: 640,
                }}
              >
                Every logic gate becomes a real standard cell — a fixed-height row of transistor
                columns with power rails top and bottom. Sizes come from the λ-scalable CMOS rules
                (Weste-Harris / MOSIS SCMOS, {PROCESS.node.split('—')[0]?.trim()}, λ ={' '}
                {PROCESS.lambdaUm}
                µm). A first-order area estimate, not exact layout.
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {cells.map((c) => (
                  <CellCard key={c.name} cell={c} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
