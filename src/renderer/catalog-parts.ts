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
 * SCOPE TODAY: a part appears here only when it has BOTH a complete public pinout AND a footprint. The
 * regulator (SOT-25) and oscillator (3.2×2.5) have both. The flash waits on its 208-mil SOIC-8 land
 * pattern; the iCE40 waits on its full 48-pin pinout (its datasheet publishes none).
 */

import { registerBuiltinParts, reserveBuiltinIds, type UserPart } from './user-parts.ts'

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

/** Every catalog part, in palette order. Grows as parts gain both a pinout and a footprint. */
export const CATALOG_PARTS: readonly UserPart[] = [AP2112K_33, ASE_12MHZ]

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
