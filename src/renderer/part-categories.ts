/**
 * Grouping the placeable parts into named sections for the "Choose a part" picker, and deciding which
 * sections float to the top at each design level. The picker was a flat list of ~110 parts; this gives
 * it headings ("Transistors", "Logic gates", …) and orders them so the parts you reach for at the level
 * you're on come first — a resistor when you're drawing a Circuit, the FPGA when you're laying out a
 * Board.
 *
 * A category declares the levels where it is a PRIMARY home (`levels`). When the picker opens at level L,
 * categories whose `levels` include L are shown first (in the fixed order below), then the rest. So the
 * same catalogue reorders itself per level without hiding anything.
 *
 * `members` lists the built-in part ids (from palette.tsx PARTS). Catalog + user-authored parts are not
 * listed here — they are placed by `categoryOf` from their id prefix, since they come from the live
 * registry, not this static list.
 */

import type { WorkspaceMode } from './workspace.ts'

export type PartCategory = {
  id: string
  label: string
  /** Design levels where this category is a primary home — it sorts to the top there. */
  levels: WorkspaceMode[]
  /** Built-in part definition ids in this category (palette.tsx PARTS). */
  members: string[]
}

/** The categories, in their base (fallback) order — a rough learn-it-from-the-bottom-up order. */
export const PART_CATEGORIES: PartCategory[] = [
  {
    id: 'ics',
    label: 'ICs & modules',
    levels: ['board'],
    members: [], // the catalog commercial parts arrive from the registry (see categoryOf)
  },
  {
    id: 'sources',
    label: 'Sources & references',
    levels: ['schematic'],
    members: [
      'power_source',
      'generator',
      'alternator',
      'alternator_three_phase',
      'reference_port',
      'ground',
    ],
  },
  {
    id: 'passives',
    label: 'Passives',
    levels: ['schematic', 'board'],
    members: [
      'resistor',
      'potentiometer',
      'thermistor',
      'photoresistor',
      'capacitor',
      'inductor',
      'transmission_line',
      'transformer',
      'transformer_center_tapped',
    ],
  },
  {
    id: 'diodes',
    label: 'Diodes & LEDs',
    levels: ['schematic', 'board'],
    members: [
      'diode_silicon_rectifier',
      'diode_schottky_al_si',
      'diode_zener_silicon',
      'diode_constant_current',
      'diode_tunnel',
      'diode_shockley',
      'diode_varactor',
      'diode_laser',
      'led',
      'led_uv_algan',
      'scr',
      'photodiode',
      'neon_lamp',
      'arc_lamp',
      'incandescent_bulb',
      'light_source',
    ],
  },
  {
    id: 'transistors',
    label: 'Transistors',
    levels: ['schematic', 'chip'],
    members: [
      'transistor_bjt_npn',
      'transistor_bjt_pnp',
      'transistor_mosfet_nmos',
      'transistor_mosfet_pmos',
      'transistor_jfet_n_channel',
      'transistor_jfet_p_channel',
      'darlington_npn',
      'photo_darlington',
      'phototransistor',
    ],
  },
  {
    id: 'tubes',
    label: 'Vacuum tubes',
    levels: ['schematic'],
    members: ['vacuum_diode', 'triode', 'tetrode', 'pentode', 'crt'],
  },
  {
    id: 'analog',
    label: 'Op-amps & analog blocks',
    levels: ['schematic'],
    members: [
      'op_amp',
      'vccs',
      'cccs',
      'block_divider',
      'block_led_r',
      'block_rc_lowpass',
      'block_ce_amp',
      'block_bridge',
      'block_noninv_amp',
    ],
  },
  {
    id: 'logic_gates',
    label: 'Logic gates',
    levels: ['schematic', 'chip'],
    members: [
      'logic_not',
      'logic_nand',
      'logic_nor',
      'logic_and',
      'logic_or',
      'logic_xor',
      'logic_xnor',
      'logic_buffer',
    ],
  },
  {
    id: 'logic_blocks',
    label: 'Logic & memory blocks',
    levels: ['schematic', 'chip'],
    members: [
      'logic_half_adder',
      'logic_full_adder',
      'logic_adder_2bit',
      'logic_adder_4bit',
      'logic_calculator_4bit',
      'logic_decoder_2_4',
      'logic_decoder_3_8',
      'logic_encoder_4_2',
      'logic_encoder_8_3',
      'logic_decoder_7seg',
      'logic_bcd_adder',
      'logic_bcd_adder_10',
      'logic_bcd_complementer',
      'logic_bcd_alu_cell',
      'logic_bcd_alu_10',
      'logic_bcd_decoder_10',
      'logic_sr_latch',
      'logic_d_latch',
      'logic_d_flipflop',
      'logic_register_4bit',
      'logic_register_bcd',
      'calculator',
      'cpu_fetch_engine',
      'cpu_4bit',
      'verilog_cpu',
      'verilog_cpu8',
      'cpu_data_ram',
      'memory_sram_cell',
      'memory_sram_word_4bit',
    ],
  },
  {
    id: 'displays',
    label: 'Displays',
    levels: ['schematic', 'board'],
    // the base 7-segment ids (the generated size variants display_seven_segment_N fall in by prefix),
    // plus the dot-matrix / RGB / row-scanner / active-matrix display-chapter blocks.
    members: [
      'display_seven_segment',
      'display_seven_segment_bare',
      'display_separator',
      'dot_matrix_5x7',
      'dot_matrix_mux_8x8',
      'dot_matrix_mux_16x16',
      'dot_matrix_rgb_7x7',
      'glyph_rom_5x7',
      'active_matrix_pixel',
      'row_scanner_8',
      'row_scanner_16',
      'row_scanner_32',
    ],
  },
  {
    id: 'switches',
    label: 'Switches & protection',
    levels: ['schematic', 'board'],
    members: ['switch_spst_toggle', 'switch_spst_momentary', 'switch_spdt', 'relay', 'fuse'],
  },
  {
    id: 'machines',
    label: 'Motors & machines',
    levels: ['schematic'],
    members: [
      'dc_motor',
      'induction_motor',
      'induction_motor_three_phase',
      'induction_motor_single_phase',
      'induction_motor_shaded_pole',
      'electromagnet',
    ],
  },
  {
    id: 'my_parts',
    label: 'My parts',
    levels: ['schematic', 'board', 'chip'],
    members: [], // user-authored parts arrive from the registry (see categoryOf)
  },
  {
    id: 'annotations',
    label: 'Annotations',
    levels: ['schematic', 'board', 'chip'],
    members: [
      'net_label',
      'text_note',
      'text_box',
      'graphic_line',
      'graphic_rect',
      'graphic_circle',
    ],
  },
]

/**
 * Search synonyms per part — the words someone types that aren't in the label. "mosfet" for an NMOS,
 * "chip"/"ic" for the FPGA, "opamp" for the op-amp. Matched by the picker (below the label), so a part
 * is findable by what it IS, not only what it's called. Keep this small and high-value.
 */
export const PART_KEYWORDS: Record<string, string> = {
  power_source: 'battery supply vcc rail',
  ground: 'gnd 0v',
  resistor: 'r ohm',
  potentiometer: 'pot variable resistor',
  capacitor: 'cap',
  inductor: 'coil choke',
  op_amp: 'opamp op-amp amplifier',
  transistor_bjt_npn: 'bjt bipolar',
  transistor_bjt_pnp: 'bjt bipolar',
  transistor_mosfet_nmos: 'mosfet fet',
  transistor_mosfet_pmos: 'mosfet fet',
  transistor_jfet_n_channel: 'fet',
  transistor_jfet_p_channel: 'fet',
  led: 'light indicator',
  led_uv_algan: 'ultraviolet uv algan sterilize',
  diode_schottky_al_si: 'schottky rectifier fast barrier 1n5817',
  diode_silicon_rectifier: 'rectifier',
  diode_zener_silicon: 'reference',
  logic_d_flipflop: 'ff flip-flop register',
  logic_sr_latch: 'latch',
  logic_d_latch: 'latch',
  logic_decoder_7seg: 'bcd seven-segment',
  memory_sram_cell: 'ram memory',
  memory_sram_word_4bit: 'ram memory',
  cpu_4bit: 'processor',
  verilog_cpu: 'processor',
  catalog_ice40up5k_sg48: 'ic chip fpga lattice qfn',
  catalog_w25q32jv: 'ic chip flash memory spi winbond nor',
  catalog_ap2112k_33: 'ic regulator ldo power diodes sot',
  catalog_ase_12mhz: 'clock crystal oscillator abracon',
}

export function keywordsFor(definition: string): string {
  if (Object.hasOwn(PART_KEYWORDS, definition)) return PART_KEYWORDS[definition] as string
  return ''
}

/** definition id → category id, built once from the members lists above. */
const MEMBER_CATEGORY: Record<string, string> = {}
const CATEGORY_LABEL: Record<string, string> = {}
for (const category of PART_CATEGORIES) {
  CATEGORY_LABEL[category.id] = category.label
  for (const member of category.members) MEMBER_CATEGORY[member] = category.id
}

/** The human label of a category id ("logic_gates" → "Logic gates"), or the id if unknown. */
export function categoryLabelOf(categoryId: string): string {
  return CATEGORY_LABEL[categoryId] ?? categoryId
}

/**
 * Which category a part belongs to. Explicit membership first; then id-prefix rules for the parts that
 * aren't in a static list — the generated display sizes, the catalog commercial parts, and any other
 * user-authored part (which lands in "My parts").
 */
export function categoryOf(definition: string): string {
  if (Object.hasOwn(MEMBER_CATEGORY, definition)) return MEMBER_CATEGORY[definition] as string
  if (definition.startsWith('display_seven_segment')) return 'displays'
  if (definition.startsWith('catalog_')) return 'ics'
  return 'my_parts'
}

/**
 * The categories in the order the picker should show them at `level`: primary-home categories for this
 * level first (in the base order above), then the rest (also in base order). Empty categories are the
 * caller's to drop.
 */
export function orderedCategories(level: WorkspaceMode): PartCategory[] {
  const here = PART_CATEGORIES.filter((c) => c.levels.includes(level))
  const rest = PART_CATEGORIES.filter((c) => !c.levels.includes(level))
  return [...here, ...rest]
}
