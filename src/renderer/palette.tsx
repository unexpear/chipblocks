import { DeviceGlyph } from './symbols.tsx'

/**
 * Parts palette (Sprint 19 S19-v3-6). A side panel of component types the user
 * drags onto the canvas to place a new part. Each row is an HTML5 drag source
 * that hands the canvas the device definition id via dataTransfer; App's onDrop
 * turns it into a new node at the drop point.
 *
 * A wire is deliberately NOT a palette part: a wire is a *connection* you draw
 * between two parts (an edge with a current arrow), not a block you place. Its
 * length feeds the physics (wire resistance) — the wire-as-connector model.
 *
 * Starter set = the placeable parts that already have standard symbols. More
 * appear here as their symbols land (capacitor, diodes, transistors…).
 */

/** dataTransfer MIME the palette → canvas drop uses. */
export const DEFINITION_MIME = 'application/chipblocks-definition'

const PARTS: { definition: string; label: string }[] = [
  { definition: 'power_source', label: 'Battery' },
  { definition: 'resistor', label: 'Resistor' },
  { definition: 'led', label: 'LED' },
  { definition: 'switch_spst_toggle', label: 'Switch' },
  { definition: 'ground', label: 'Ground' },
]

export function Palette() {
  return (
    <aside
      style={{
        width: 140,
        height: '100%',
        background: '#141417',
        borderRight: '1px solid #2a2a2f',
        padding: 10,
        boxSizing: 'border-box',
        fontFamily: 'system-ui, sans-serif',
        overflowY: 'auto',
      }}
    >
      <div style={{ color: '#aaa', fontSize: 12, fontWeight: 600, marginBottom: 10 }}>Parts</div>
      {PARTS.map((part) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: a palette part is a drag source; keyboard-accessible placement is future work
        <div
          key={part.definition}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData(DEFINITION_MIME, part.definition)
            event.dataTransfer.effectAllowed = 'move'
          }}
          title={`Drag ${part.label} onto the canvas`}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            padding: '8px 4px',
            marginBottom: 8,
            border: '1px solid #2a2a2f',
            borderRadius: 6,
            background: '#1b1b1f',
            cursor: 'grab',
          }}
        >
          <DeviceGlyph definition={part.definition} />
          <span style={{ color: '#cdd6e0', fontSize: 11 }}>{part.label}</span>
        </div>
      ))}
    </aside>
  )
}
