/**
 * CATALOG PARTS — the specific, purchasable devices from the fixture catalog (fixtures/valid/assembly-*)
 * made PLACEABLE, so a real board can be built from them and not just described.
 *
 * These are registered through the SAME registry a user-authored part uses (user-parts.ts). CLAUDE.md's
 * rule holds: "there is no privileged tier — once a block is registered in any origin, it behaves like
 * any other." So a catalog part draws its own symbol from its pins, lands on its footprint through the
 * pin→pad map, and routes on a board exactly like an authored part — with none of that plumbing
 * duplicated. What makes it a CATALOG part rather than a user one is only that its id is reserved as a
 * built-in (so a user can't shadow it) and it is NOT written into a project's save file (it resolves
 * from the app, like a built-in footprint does — see circuit-file.ts).
 *
 * Each part is a black box to the solver (no `behavesAs`): what an FPGA or a regulator DOES is not
 * modelled — that is the fixture's `solver_status: defined_not_solved` carried through honestly. What IS
 * real is the part at its pins: the named signals, and the pad each solders to. Those come straight from
 * the cited fixture; the fixture stays the source of truth for the numbers, this file is only the
 * placeable shape.
 *
 * SCOPE: a part appears here once it has BOTH a complete public pinout AND a footprint. All four of the
 * FPGA-board parts now qualify — the regulator (SOT-25), oscillator (3.2×2.5), flash (208-mil SOIC-8),
 * and the iCE40UP5K (QFN-48). The iCE40's pinout is not in its datasheet (which gives only bank counts);
 * it is sourced pad-for-pad from the Lattice breakout-board schematic, cross-checked against KiCad.
 */

import {
  type PinElectrical,
  type PinSide,
  registerBuiltinParts,
  reserveBuiltinIds,
  type UserPart,
  type UserPin,
} from './user-parts.ts'

/**
 * Diodes AP2112K-3.3 — a fixed 3.3 V LDO in SOT-25. Pins + pad map from the datasheet Pin Configuration
 * (DS39724 Rev 2-2), matching fixtures/valid/assembly-regulator-ap2112k-33-sot25.yaml.
 */
const AP2112K_33: UserPart = {
  id: 'catalog_ap2112k_33',
  name: 'AP2112K-3.3 LDO',
  designatorPrefix: 'U',
  description:
    'Diodes AP2112K-3.3, 600 mA 3.3 V low-dropout regulator in SOT-25. Enable pin can sequence a second rail. Not simulated — a black box at its pins. See assembly-regulator-ap2112k-33-sot25.yaml.',
  pins: [
    { id: 'vin', name: 'VIN', side: 'left', electrical: 'power_in', pad: '1' },
    { id: 'en', name: 'EN', side: 'left', electrical: 'input', pad: '3' },
    { id: 'gnd', name: 'GND', side: 'bottom', electrical: 'passive', pad: '2' },
    { id: 'nc', name: 'NC', side: 'top', electrical: 'unspecified', pad: '4' },
    { id: 'vout', name: 'VOUT', side: 'right', electrical: 'power_out', pad: '5' },
  ],
  footprintId: 'SOT-25_SOT-23-5',
}

/**
 * Abracon ASE 12 MHz oscillator — a 4-pad 3.2×2.5 mm CMOS clock can. Pin map from the ASE datasheet
 * (REV 02-18-22), matching fixtures/valid/assembly-oscillator-ase-12mhz.yaml.
 */
const ASE_12MHZ: UserPart = {
  id: 'catalog_ase_12mhz',
  name: 'ASE 12 MHz oscillator',
  designatorPrefix: 'X',
  description:
    'Abracon ASE-series 12 MHz CMOS crystal oscillator, 3.2×2.5 mm. Standby pin (pad 1) high or open = running. Not simulated — a black box at its pins. See assembly-oscillator-ase-12mhz.yaml.',
  pins: [
    { id: 'stby', name: 'ST', side: 'left', electrical: 'input', pad: '1' },
    { id: 'gnd', name: 'GND', side: 'bottom', electrical: 'passive', pad: '2' },
    { id: 'out', name: 'OUT', side: 'right', electrical: 'output', pad: '3' },
    { id: 'vdd', name: 'VDD', side: 'top', electrical: 'power_in', pad: '4' },
  ],
  footprintId: 'Oscillator_SMD_3.2x2.5mm',
}

/**
 * Winbond W25Q32JV — a 32 Mbit SPI NOR flash in the 208-mil SOIC-8. Pin map from the datasheet
 * (standard SOIC-8 numbering: 1–4 down the left, 5–8 up the right), matching
 * fixtures/valid/assembly-flash-w25q32jv-soic8.yaml. Names use the Quad-SPI dual roles the datasheet
 * gives each pin.
 */
const W25Q32JV: UserPart = {
  id: 'catalog_w25q32jv',
  name: 'W25Q32JV SPI flash',
  designatorPrefix: 'U',
  description:
    'Winbond W25Q32JV, 32 Mbit SPI NOR flash in a 208-mil SOIC-8 — the FPGA-configuration memory on an iCE40 board. Not simulated — a black box at its pins. See assembly-flash-w25q32jv-soic8.yaml.',
  pins: [
    { id: 'cs', name: '/CS', side: 'left', electrical: 'input', pad: '1' },
    { id: 'do', name: 'DO/IO1', side: 'right', electrical: 'bidirectional', pad: '2' },
    { id: 'wp', name: '/WP/IO2', side: 'left', electrical: 'bidirectional', pad: '3' },
    { id: 'gnd', name: 'GND', side: 'bottom', electrical: 'passive', pad: '4' },
    { id: 'di', name: 'DI/IO0', side: 'left', electrical: 'bidirectional', pad: '5' },
    { id: 'clk', name: 'CLK', side: 'left', electrical: 'input', pad: '6' },
    { id: 'hold', name: '/HOLD/IO3', side: 'right', electrical: 'bidirectional', pad: '7' },
    { id: 'vcc', name: 'VCC', side: 'top', electrical: 'power_in', pad: '8' },
  ],
  footprintId: 'SOIC-8_5.23x5.23mm_P1.27mm',
}

/**
 * The iCE40UP5K-SG48 full 48-pad pinout + the exposed paddle. Every pad is sourced from the Lattice
 * iCE40 UltraPlus Breakout Board User Guide (FPGA-UG-02001-1.2, Figure A.3 "DUT Connection"), which
 * names each numbered SG48 pin — the same authoritative Lattice mapping the fixture's 9 key pads came
 * from. Cross-checked pad-for-pad against the KiCad FPGA_Lattice symbol (they agree on all 48; the one
 * difference is cosmetic — KiCad labels pad 12 IOB_22B where Lattice labels it IOB_22A, same pad).
 * `p` = power_in, `g` = ground (the paddle), `i`/`o` = the two config pins, `x` = I/O (user I/O, the
 * SPI-config pins in their default I/O role, the clock-capable pins, the RGB-driver pins).
 */
const ICE40_PADS: { pad: string; name: string; kind: 'p' | 'g' | 'i' | 'o' | 'x' }[] = [
  { pad: '1', name: 'VCCIO_2', kind: 'p' },
  { pad: '2', name: 'IOB_6A', kind: 'x' },
  { pad: '3', name: 'IOB_9B', kind: 'x' },
  { pad: '4', name: 'IOB_8A', kind: 'x' },
  { pad: '5', name: 'VCC', kind: 'p' },
  { pad: '6', name: 'IOB_13B', kind: 'x' },
  { pad: '7', name: 'CDONE', kind: 'o' },
  { pad: '8', name: 'CRESET_B', kind: 'i' },
  { pad: '9', name: 'IOB_16A', kind: 'x' },
  { pad: '10', name: 'IOB_18A', kind: 'x' },
  { pad: '11', name: 'IOB_20A', kind: 'x' },
  { pad: '12', name: 'IOB_22A', kind: 'x' },
  { pad: '13', name: 'IOB_24A', kind: 'x' },
  { pad: '14', name: 'SPI_SO', kind: 'x' },
  { pad: '15', name: 'SPI_SCK', kind: 'x' },
  { pad: '16', name: 'SPI_SS', kind: 'x' },
  { pad: '17', name: 'SPI_SI', kind: 'x' },
  { pad: '18', name: 'IOB_31B', kind: 'x' },
  { pad: '19', name: 'IOB_29B', kind: 'x' },
  { pad: '20', name: 'IOB_25B_G3', kind: 'x' },
  { pad: '21', name: 'IOB_23B', kind: 'x' },
  { pad: '22', name: 'SPI_VCCIO1', kind: 'p' },
  { pad: '23', name: 'IOT_37A', kind: 'x' },
  { pad: '24', name: 'VPP_2V5', kind: 'p' },
  { pad: '25', name: 'IOT_36B', kind: 'x' },
  { pad: '26', name: 'IOT_39A', kind: 'x' },
  { pad: '27', name: 'IOT_38B', kind: 'x' },
  { pad: '28', name: 'IOT_41A', kind: 'x' },
  { pad: '29', name: 'VCCPLL', kind: 'p' },
  { pad: '30', name: 'VCC', kind: 'p' },
  { pad: '31', name: 'IOT_42B', kind: 'x' },
  { pad: '32', name: 'IOT_43A', kind: 'x' },
  { pad: '33', name: 'VCCIO_0', kind: 'p' },
  { pad: '34', name: 'IOT_44B', kind: 'x' },
  { pad: '35', name: 'IOT_46B_G0', kind: 'x' },
  { pad: '36', name: 'IOT_48B', kind: 'x' },
  { pad: '37', name: 'IOT_45A_G1', kind: 'x' },
  { pad: '38', name: 'IOT_50B', kind: 'x' },
  { pad: '39', name: 'RGB0', kind: 'x' },
  { pad: '40', name: 'RGB1', kind: 'x' },
  { pad: '41', name: 'RGB2', kind: 'x' },
  { pad: '42', name: 'IOT_51A', kind: 'x' },
  { pad: '43', name: 'IOT_49A', kind: 'x' },
  { pad: '44', name: 'IOB_3B_G6', kind: 'x' },
  { pad: '45', name: 'IOB_5B', kind: 'x' },
  { pad: '46', name: 'IOB_0A', kind: 'x' },
  { pad: '47', name: 'IOB_2A', kind: 'x' },
  { pad: '48', name: 'IOB_4A', kind: 'x' },
  // The exposed thermal paddle — pad 49 of the QFN-48-1EP footprint. MUST be tied to GND (datasheet).
  { pad: '49', name: 'GND', kind: 'g' },
]

const KIND_TO_ELECTRICAL: Record<string, PinElectrical> = {
  p: 'power_in',
  g: 'passive',
  i: 'input',
  o: 'output',
  x: 'bidirectional',
}

/**
 * Build the iCE40's pins from the pad table. Pins are laid on the four sides by pad-number range to
 * mirror the QFN's counter-clockwise numbering (1-12 left, 13-24 bottom, 25-36 right, 37-48 top), with
 * the paddle on the bottom — so the symbol reads like the physical package. Each pin carries its pad.
 */
function ice40Pins(): UserPin[] {
  const sideFor = (pad: number): PinSide => {
    if (pad <= 12) return 'left'
    if (pad <= 24) return 'bottom'
    if (pad <= 36) return 'right'
    if (pad <= 48) return 'top'
    return 'bottom' // the paddle
  }
  return ICE40_PADS.map((entry) => ({
    id: `p${entry.pad}`,
    name: entry.name,
    side: sideFor(Number(entry.pad)),
    electrical: KIND_TO_ELECTRICAL[entry.kind] as PinElectrical,
    pad: entry.pad,
  }))
}

const ICE40UP5K_SG48: UserPart = {
  id: 'catalog_ice40up5k_sg48',
  name: 'iCE40UP5K-SG48 FPGA',
  designatorPrefix: 'U',
  description:
    'Lattice iCE40UP5K FPGA in the 48-pin QFN (SG48). 39 user I/O across three banks, plus config and power; the exposed paddle is ground. What it does is set by the bitstream, so it is a black box at its pins. See assembly-fpga-ice40up5k-sg48.yaml.',
  pins: ice40Pins(),
  footprintId: 'QFN-48-1EP_7x7mm_P0.5mm',
}

/** Every catalog part, in palette order. Grows as parts gain both a pinout and a footprint. */
export const CATALOG_PARTS: readonly UserPart[] = [AP2112K_33, ASE_12MHZ, W25Q32JV, ICE40UP5K_SG48]

/** The ids the catalog owns — reserved so a user part can't shadow one, and skipped on save. */
export const CATALOG_PART_IDS: ReadonlySet<string> = new Set(CATALOG_PARTS.map((p) => p.id))

export function isCatalogPartId(id: string): boolean {
  return CATALOG_PART_IDS.has(id)
}

/**
 * Make the catalog parts placeable: register them as built-in parts (so the palette lists them and
 * resolveUserPart finds them) and reserve their ids (so a user part can't shadow one). Idempotent —
 * safe to call once per tab alongside the user-library load. They live in the built-in map, NOT the
 * authored registry, so they never end up in a project save file.
 */
export function registerCatalogParts(): void {
  reserveBuiltinIds(CATALOG_PART_IDS)
  registerBuiltinParts(CATALOG_PARTS)
}
