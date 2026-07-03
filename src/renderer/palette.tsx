import { useState } from 'react'
import { DIGIT_DISPLAY_SIZES } from './builtin-blocks.ts'
import { DeviceGlyph } from './symbols.tsx'
import { THEME } from './theme.ts'

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
export function BlockPaletteItems({
  blocks,
  filter,
}: {
  blocks: { id: string; name: string }[]
  filter?: string
}) {
  const query = (filter ?? '').trim().toLowerCase()
  const shown = query ? blocks.filter((b) => b.name.toLowerCase().includes(query)) : blocks
  if (shown.length === 0) return null
  return (
    <>
      <div
        style={{
          color: THEME.textMuted,
          fontSize: 10,
          fontFamily: 'system-ui, sans-serif',
          margin: '8px 2px 2px',
        }}
      >
        Blocks — drag to copy
      </div>
      {shown.map((block) => (
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
            border: `1px solid ${THEME.borderSubtle}`,
            borderRadius: 6,
            background: THEME.surfaceRaised,
            cursor: 'grab',
            color: THEME.textPrimary,
            fontSize: 11,
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <span aria-hidden style={{ color: THEME.accentPurple }}>
            ⧉
          </span>
          {block.name}
        </div>
      ))}
    </>
  )
}

export const PARTS: { definition: string; label: string }[] = [
  { definition: 'power_source', label: 'Source' },
  { definition: 'resistor', label: 'Resistor' },
  { definition: 'potentiometer', label: 'Pot' },
  { definition: 'thermistor', label: 'Thermistor' },
  { definition: 'photoresistor', label: 'LDR' },
  { definition: 'photodiode', label: 'Photodiode' },
  { definition: 'phototransistor', label: 'Phototransistor' },
  { definition: 'light_source', label: 'Light' },
  { definition: 'capacitor', label: 'Capacitor' },
  { definition: 'inductor', label: 'Inductor' },
  { definition: 'electromagnet', label: 'Electromagnet' },
  { definition: 'dc_motor', label: 'DC Motor' },
  { definition: 'generator', label: 'Generator' },
  { definition: 'induction_motor', label: 'AC Motor' },
  { definition: 'transmission_line', label: 'T-Line' },
  { definition: 'transformer', label: 'Transformer' },
  { definition: 'transformer_center_tapped', label: 'CT Transformer' },
  { definition: 'diode_silicon_rectifier', label: 'Diode' },
  { definition: 'diode_zener_silicon', label: 'Zener' },
  { definition: 'diode_constant_current', label: 'CRD' },
  { definition: 'led', label: 'LED' },
  { definition: 'incandescent_bulb', label: 'Bulb' },
  { definition: 'arc_lamp', label: 'Arc Lamp' },
  { definition: 'neon_lamp', label: 'Neon' },
  { definition: 'diode_laser', label: 'Laser' },
  { definition: 'diode_tunnel', label: 'Tunnel' },
  { definition: 'diode_shockley', label: 'Shockley' },
  { definition: 'diode_varactor', label: 'Varactor' },
  { definition: 'scr', label: 'SCR' },
  { definition: 'vacuum_diode', label: 'Vac Diode' },
  { definition: 'triode', label: 'Triode' },
  { definition: 'tetrode', label: 'Tetrode' },
  { definition: 'pentode', label: 'Pentode' },
  { definition: 'crt', label: 'CRT' },
  { definition: 'transistor_bjt_npn', label: 'NPN' },
  { definition: 'transistor_bjt_pnp', label: 'PNP' },
  { definition: 'transistor_mosfet_nmos', label: 'NMOS' },
  { definition: 'transistor_mosfet_pmos', label: 'PMOS' },
  { definition: 'transistor_jfet_n_channel', label: 'N-JFET' },
  { definition: 'transistor_jfet_p_channel', label: 'P-JFET' },
  { definition: 'darlington_npn', label: 'Darlington' },
  { definition: 'photo_darlington', label: 'Photo-Darl.' },
  { definition: 'op_amp', label: 'Op-Amp' },
  { definition: 'vccs', label: 'VCCS' },
  { definition: 'cccs', label: 'CCCS' },
  { definition: 'logic_not', label: 'NOT' },
  { definition: 'logic_nand', label: 'NAND' },
  { definition: 'logic_nor', label: 'NOR' },
  { definition: 'logic_and', label: 'AND' },
  { definition: 'logic_or', label: 'OR' },
  { definition: 'logic_xor', label: 'XOR' },
  { definition: 'logic_xnor', label: 'XNOR' },
  { definition: 'logic_buffer', label: 'Buffer' },
  { definition: 'logic_half_adder', label: 'Half Add' },
  { definition: 'logic_full_adder', label: 'Full Add' },
  { definition: 'logic_adder_2bit', label: '2-bit Add' },
  { definition: 'logic_adder_4bit', label: '4-bit Add' },
  { definition: 'logic_calculator_4bit', label: 'Calc ±' },
  { definition: 'logic_decoder_7seg', label: '7seg Dec' },
  { definition: 'display_seven_segment', label: '7-Seg' },
  { definition: 'display_seven_segment_bare', label: '7-Seg Bare' },
  // One palette item per size in DIGIT_DISPLAY_SIZES — edit that list to add/remove a display version.
  // The shipped module (with resistors) and the bare raw version (LEDs only) of each.
  ...DIGIT_DISPLAY_SIZES.map((n) => ({
    definition: `display_seven_segment_${n}`,
    label: `${n}-Digit`,
  })),
  ...DIGIT_DISPLAY_SIZES.map((n) => ({
    definition: `display_seven_segment_bare_${n}`,
    label: `${n}-Digit Bare`,
  })),
  { definition: 'logic_sr_latch', label: 'SR Latch' },
  { definition: 'logic_d_latch', label: 'D Latch' },
  { definition: 'logic_d_flipflop', label: 'D Flip-Flop' },
  { definition: 'logic_register_4bit', label: '4-bit Reg' },
  { definition: 'logic_register_bcd', label: 'BCD Reg' },
  { definition: 'calculator', label: 'Calculator' },
  { definition: 'memory_sram_cell', label: 'SRAM Cell' },
  { definition: 'memory_sram_word_4bit', label: 'SRAM 4-bit' },
  { definition: 'switch_spst_toggle', label: 'Switch' },
  { definition: 'switch_spst_momentary', label: 'Button' },
  { definition: 'switch_spdt', label: 'SPDT' },
  { definition: 'fuse', label: 'Fuse' },
  { definition: 'relay', label: 'Relay' },
  { definition: 'ground', label: 'Ground' },
  { definition: 'net_label', label: 'Net Label' },
  { definition: 'text_note', label: 'Text note' },
  { definition: 'text_box', label: 'Text box' },
  { definition: 'graphic_line', label: 'Line' },
  { definition: 'graphic_rect', label: 'Rectangle' },
  { definition: 'graphic_circle', label: 'Circle' },
]

export function PaletteItems({ filter }: { filter?: string }) {
  const query = (filter ?? '').trim().toLowerCase()
  const shown = query
    ? PARTS.filter(
        (part) =>
          part.label.toLowerCase().includes(query) || part.definition.toLowerCase().includes(query),
      )
    : PARTS
  return (
    <>
      {shown.map((part) => (
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
            border: `1px solid ${THEME.borderSubtle}`,
            borderRadius: 6,
            background: THEME.surfaceRaised,
            cursor: 'grab',
          }}
        >
          <DeviceGlyph definition={part.definition} />
          <span style={{ color: THEME.textPrimary, fontSize: 11 }}>{part.label}</span>
        </div>
      ))}
    </>
  )
}

/**
 * The Parts panel: a filter-as-you-type box over the placeable parts AND the
 * on-canvas blocks. The query matches a part's label or its definition id (so
 * "mos" finds the MOSFETs, "logic" finds the gates) and a block's name. Empty
 * query shows everything; the box keeps its own state so typing never re-solves.
 */
export function Palette({ blocks }: { blocks: { id: string; name: string }[] }) {
  const [query, setQuery] = useState('')
  return (
    <>
      <input
        type="text"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search parts…"
        aria-label="Search parts"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          margin: '0 0 6px',
          padding: '5px 8px',
          border: `1px solid ${THEME.borderSubtle}`,
          borderRadius: 6,
          background: THEME.surfaceBase,
          color: THEME.textPrimary,
          fontSize: 11,
          fontFamily: 'system-ui, sans-serif',
          outline: 'none',
        }}
      />
      <PaletteItems filter={query} />
      <BlockPaletteItems blocks={blocks} filter={query} />
    </>
  )
}
