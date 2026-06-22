import type { CSSProperties } from 'react'
import type { BlockPort, PinKind, PinSide } from './blocks.ts'
import { THEME } from './theme.ts'

/**
 * Block pinout editor (Properties panel) — edit a circuit block's external pins like a chip's pinout:
 * NAME each pin, set whether it's a plain signal or a +/− POWER pin (power pins then show +/− in
 * red/blue on the box, the way a real chip marks its supply pins), pick which EDGE it sits on (pins
 * auto-distribute, always centered on that edge), reorder pins within an edge (▲▼), and ADD a pin by
 * exposing any internal terminal — even before it's wired. A pin still IS its internal terminal; this
 * only changes how the block presents to the outside, never the circuit the solver sees.
 */

const field: CSSProperties = {
  background: THEME.surfaceInput,
  border: `1px solid ${THEME.borderStrong}`,
  color: THEME.textPrimary,
  borderRadius: 3,
  padding: '2px 4px',
  fontSize: 11,
}
const arrow: CSSProperties = {
  background: THEME.surfaceInput,
  border: `1px solid ${THEME.borderStrong}`,
  color: THEME.textSoft,
  borderRadius: 3,
  fontSize: 9,
  lineHeight: 1,
  padding: '1px 4px',
  cursor: 'pointer',
}
const remove: CSSProperties = { ...arrow, color: THEME.statusDanger }
const SIDE_ORDER: Record<PinSide, number> = { left: 0, right: 1, top: 2, bottom: 3 }

export type BlockPortPatch = {
  name?: string
  kind?: PinKind
  side?: PinSide
}

/** An internal terminal that isn't a pin yet — offered in the "add pin" picker. */
export type AddableTerminal = { nodeId: string; handleId: string; label: string }

export function BlockInspector({
  ports,
  available,
  onEditPort,
  onAddPort,
  onReorderPort,
  onRemovePort,
}: {
  ports: BlockPort[]
  available: AddableTerminal[]
  onEditPort: (portId: string, patch: BlockPortPatch) => void
  onAddPort: (nodeId: string, handleId: string) => void
  onReorderPort: (portId: string, dir: -1 | 1) => void
  onRemovePort: (portId: string) => void
}) {
  // Group the list by edge so the ▲▼ reordering (which moves a pin among its same-side pins) reads
  // naturally; a stable sort keeps each edge's pins in their current order.
  const sorted = [...ports].sort((a, b) => SIDE_ORDER[a.side] - SIDE_ORDER[b.side])
  return (
    <div style={{ width: 188, fontSize: 11, color: THEME.textSoft }}>
      <div style={{ fontWeight: 700, color: THEME.textBright, marginBottom: 2 }}>
        Pins ({ports.length})
      </div>
      <div style={{ fontSize: 9, color: THEME.textFaint, marginBottom: 6 }}>
        Power pins show +/−; each sits on an edge (auto-spaced). ▲▼ reorders within an edge.
      </div>
      {ports.length === 0 ? (
        <div style={{ fontSize: 10, color: THEME.textMuted }}>
          No pins yet — wire to the block, or add one below.
        </div>
      ) : null}
      {sorted.map((port) => (
        <div
          key={port.id}
          style={{
            borderTop: `1px solid ${THEME.borderSubtle}`,
            paddingTop: 5,
            marginTop: 5,
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}>
            <span
              style={{
                fontSize: 9,
                color: THEME.textFaint,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={port.label}
            >
              {port.label}
            </span>
            <span style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
              <button
                type="button"
                style={arrow}
                title="Move up on this edge"
                onClick={() => onReorderPort(port.id, -1)}
              >
                ▲
              </button>
              <button
                type="button"
                style={arrow}
                title="Move down on this edge"
                onClick={() => onReorderPort(port.id, 1)}
              >
                ▼
              </button>
              <button
                type="button"
                style={remove}
                title="Remove this pin (deletes any wire attached to it)"
                onClick={() => onRemovePort(port.id)}
              >
                ×
              </button>
            </span>
          </div>
          <input
            value={port.name ?? ''}
            placeholder="pin name (e.g. VCC)"
            onChange={(e) => onEditPort(port.id, { name: e.target.value })}
            style={field}
          />
          <div style={{ display: 'flex', gap: 4 }}>
            <select
              value={port.kind ?? 'signal'}
              onChange={(e) => onEditPort(port.id, { kind: e.target.value as PinKind })}
              style={{ ...field, flex: 1 }}
              title="A power pin shows +/− (red/blue); a signal pin is plain"
            >
              <option value="signal">signal</option>
              <option value="power_positive">+ power</option>
              <option value="power_negative">− power</option>
            </select>
            <select
              value={port.side}
              onChange={(e) => onEditPort(port.id, { side: e.target.value as PinSide })}
              style={{ ...field, flex: 1 }}
              title="Which edge of the block this pin sits on"
            >
              <option value="left">left</option>
              <option value="right">right</option>
              <option value="top">top</option>
              <option value="bottom">bottom</option>
            </select>
          </div>
        </div>
      ))}
      {available.length > 0 ? (
        <select
          value=""
          onChange={(e) => {
            const sep = e.target.value.indexOf('::')
            if (sep < 0) return
            onAddPort(e.target.value.slice(0, sep), e.target.value.slice(sep + 2))
          }}
          style={{ ...field, marginTop: 8, width: '100%' }}
          title="Expose an internal terminal as a pin — even before you wire to it"
        >
          <option value="">+ Add pin (expose a terminal)…</option>
          {available.map((t) => (
            <option key={`${t.nodeId}::${t.handleId}`} value={`${t.nodeId}::${t.handleId}`}>
              {t.label}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  )
}
