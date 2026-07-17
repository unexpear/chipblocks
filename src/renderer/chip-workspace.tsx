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
import type { Floorplan } from './cell-place.ts'
import { ChipCanvas } from './chip-canvas.tsx'
import type { ChipCellOverride, ChipLensMode } from './chip-layout.ts'
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

/** The static-timing result the app already computes (max clock speed, critical path, slack) — the
 *  Chip level's sign-off. `hasRegisters` is whether the design has a clocked element to sign off. */
export type ChipTiming = { report: TimingReport; hasRegisters: boolean; clockDetected: boolean }

/** The Chip level's editing surface — an absolute overlay over the still-mounted schematic, exactly
 *  like the Board overlay. Mounted only when the level is 'chip', so its projection only computes then. */
export function ChipView({
  nodes,
  edges,
  timing,
  floorplan,
  overrides,
  lens,
  onLens,
  drift,
  onReplace,
  light,
}: {
  nodes: CanvasNodeLike[]
  edges: CanvasEdgeLike[]
  timing: ChipTiming
  /** The placed floorplan, generated by App on chip entry + persisted so re-entry doesn't re-derive it
   *  (null until first generated). The user's overrides layer on top. */
  floorplan: Floorplan | null
  /** The persisted chip-layout layer's cell overrides + colouring lens (from App's chipLayout). */
  overrides: ChipCellOverride[]
  lens: ChipLensMode
  onLens: (mode: ChipLensMode) => void
  /** True when the schematic changed since the floorplan was generated — the layout is stale until re-placed. */
  drift: boolean
  onReplace: () => void
  light: boolean
}) {
  const chip = useMemo(() => deriveChip(nodes, edges), [nodes, edges])
  const cells = useMemo(() => standardCells(), [])
  const area = useMemo(() => designCellArea(nodes, edges), [nodes, edges])
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
            {floorplan && floorplan.cells.length > 0 && (
              <div style={{ marginBottom: 26 }}>
                <SectionLabel>Floorplan (placed cells)</SectionLabel>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    marginBottom: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <button
                    type="button"
                    onClick={onReplace}
                    title="Regenerate the placement from the current schematic (clears manual cell moves)"
                    style={{
                      border: `1px solid ${THEME.borderStrong}`,
                      borderRadius: 4,
                      background: drift ? THEME.statusWarn : THEME.surfaceInput,
                      color: drift ? '#0b1220' : THEME.textSoft,
                      fontSize: 11,
                      padding: '3px 10px',
                      cursor: 'pointer',
                    }}
                  >
                    ↻ Re-place from schematic
                  </button>
                  {drift && (
                    <span style={{ fontSize: 12, color: THEME.statusWarn }}>
                      The schematic changed since this was laid out — re-place to sync.
                    </span>
                  )}
                </div>
                <ChipCanvas
                  plan={floorplan}
                  overrides={overrides}
                  lens={lens}
                  onLens={onLens}
                  light={light}
                />
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
