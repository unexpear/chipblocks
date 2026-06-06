import { DeviceGlyph } from './symbols.tsx'

/**
 * Parts palette (Sprint 19 S19-v3-6; dockable in S19-v3-10). The placeable
 * component types. Each item is an HTML5 drag source that hands the canvas the
 * device definition id via dataTransfer; App's onDrop turns it into a new node
 * at the drop point. The panel chrome (title, docking) is the DockablePanel that
 * wraps these items.
 *
 * A wire is deliberately NOT here: a wire is a *connection* you draw between
 * parts (an edge with a current arrow), not a block you place — it lives on the
 * tools toolbar. Its length feeds the physics (wire resistance).
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

export function PaletteItems() {
  return (
    <>
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
            padding: '8px 6px',
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
    </>
  )
}
