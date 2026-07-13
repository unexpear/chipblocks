/**
 * THE CHIP WORKSPACE — the fourth level of the app (Circuit ▸ Board ▸ Chip ▸ System). Like the Board
 * level, it is not a separate document: it's a live PROJECTION of the same schematic you drew, one
 * layer further down. Where Board projects the design onto footprints on FR4, Chip projects it onto
 * silicon. This minimal first version shows what the design BECOMES on a chip — its top-level parts
 * and the real primitive devices they flatten to (the silicon inventory) — using the same
 * flattenBlocks the solver uses. Floorplan, cell placement, routing, and a GDS layout are the next
 * steps; this level is honest about being the inventory, not yet the layout.
 */

import { useMemo } from 'react'
import { type CanvasEdgeLike, type CanvasNodeLike, flattenBlocks } from './blocks.ts'
import { ANNOTATION_DEFINITIONS } from './part-defaults.ts'
import { THEME } from './theme.ts'

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

/** The Chip level's editing surface — an absolute overlay over the still-mounted schematic, exactly
 *  like the Board overlay. Mounted only when the level is 'chip', so its projection only computes then. */
export function ChipView({ nodes, edges }: { nodes: CanvasNodeLike[]; edges: CanvasEdgeLike[] }) {
  const chip = useMemo(() => deriveChip(nodes, edges), [nodes, edges])
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
            : `${plural(chip.partTotal, 'part')} · flattens to ${plural(chip.deviceTotal, 'device')}`}
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
            <div style={{ fontSize: 14, color: THEME.textSoft, marginBottom: 18, lineHeight: 1.6 }}>
              This is your circuit projected into silicon — the parts you placed, flattened all the
              way down to the real devices they're made of. It's the design's inventory; the
              floorplan, cell placement, and layout come next.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              <Column title="Your design" rows={chip.topParts} />
              <Column
                title="In silicon"
                rows={chip.devices}
                note="every primitive device the design flattens to"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
