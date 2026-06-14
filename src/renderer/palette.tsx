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
/** dataTransfer MIME for dropping a copy of an existing circuit block. */
export const BLOCK_MIME = 'application/chipblocks-block'

/**
 * The Blocks section: every block currently on the canvas, draggable to drop
 * an independent copy (cloned internals, fresh ids). The template IS the block
 * on canvas — delete the last copy and the template goes with it (the
 * catalog-grade project library is the documented next rung).
 */
export function BlockPaletteItems({ blocks }: { blocks: { id: string; name: string }[] }) {
  if (blocks.length === 0) return null
  return (
    <>
      <div
        style={{
          color: '#8a93a0',
          fontSize: 10,
          fontFamily: 'system-ui, sans-serif',
          margin: '8px 2px 2px',
        }}
      >
        Blocks — drag to copy
      </div>
      {blocks.map((block) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: a palette block is a drag source, same as the parts above
        <div
          key={block.id}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData(BLOCK_MIME, block.id)
            event.dataTransfer.effectAllowed = 'move'
          }}
          title={`Drag to place an independent copy of ${block.name}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 8px',
            border: '1px solid #2a2a2f',
            borderRadius: 6,
            background: '#1b1b1f',
            cursor: 'grab',
            color: '#cdd6e0',
            fontSize: 11,
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <span aria-hidden style={{ color: '#a06ad8' }}>
            ⧉
          </span>
          {block.name}
        </div>
      ))}
    </>
  )
}

const PARTS: { definition: string; label: string }[] = [
  { definition: 'power_source', label: 'Source' },
  { definition: 'resistor', label: 'Resistor' },
  { definition: 'potentiometer', label: 'Pot' },
  { definition: 'thermistor', label: 'Thermistor' },
  { definition: 'photoresistor', label: 'LDR' },
  { definition: 'photodiode', label: 'Photodiode' },
  { definition: 'phototransistor', label: 'Phototransistor' },
  { definition: 'light_source', label: 'Lamp' },
  { definition: 'capacitor', label: 'Capacitor' },
  { definition: 'inductor', label: 'Inductor' },
  { definition: 'transformer', label: 'Transformer' },
  { definition: 'transformer_center_tapped', label: 'CT Transformer' },
  { definition: 'diode_silicon_rectifier', label: 'Diode' },
  { definition: 'diode_zener_silicon', label: 'Zener' },
  { definition: 'led', label: 'LED' },
  { definition: 'transistor_bjt_npn', label: 'NPN' },
  { definition: 'transistor_bjt_pnp', label: 'PNP' },
  { definition: 'transistor_mosfet_nmos', label: 'NMOS' },
  { definition: 'transistor_mosfet_pmos', label: 'PMOS' },
  { definition: 'op_amp', label: 'Op-Amp' },
  { definition: 'logic_not', label: 'NOT' },
  { definition: 'switch_spst_toggle', label: 'Switch' },
  { definition: 'switch_spst_momentary', label: 'Button' },
  { definition: 'switch_spdt', label: 'SPDT' },
  { definition: 'fuse', label: 'Fuse' },
  { definition: 'relay', label: 'Relay' },
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
