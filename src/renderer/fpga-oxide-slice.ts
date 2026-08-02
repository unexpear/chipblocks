/**
 * FPGA fabric — Lattice Nexus (via Project Oxide): read a design's LOGIC CELLS out of FASM.
 *
 * The FASM reader next door gives structure — tiles, settings, wide values. This turns the part of that
 * structure describing logic into something with meaning: which lookup tables compute what, and which registers
 * are switched on and how they behave.
 *
 * A Nexus logic tile (`PLC`) holds several SLICES, each named `SLICE<letter>`. Within a slice:
 *
 *   `K0`, `K1`          the lookup tables, whose truth table arrives as `K0.INIT[15:0] = 16'b...`
 *   `REG0`, `REG1`      the registers, with `USED`, `REGSET` (whether it resets or sets), and `SEL`
 *   `CLKMUX`, `LSRMUX`  shared by the whole slice — the clock and the set/reset line
 *
 * WHY THE SHARED SETTINGS MATTER: a register's clock and reset are properties of the SLICE, not of the register,
 * so two registers in one slice cannot be clocked differently. Reading them per-register would invent
 * independence the hardware does not have.
 */
import type { NexusFasm, NexusTile } from './fpga-oxide-fasm.ts'

/** One lookup table within a slice. */
export type NexusLut = {
  /** `K0` or `K1`. */
  name: string
  /** the 16-entry truth table. */
  init: number
}

/** One register within a slice. */
export type NexusRegister = {
  /** `REG0` or `REG1`. */
  name: string
  /** whether the design actually uses it — an unused register is present on every slice of the chip. */
  used: boolean
  /** `RESET` or `SET`: which way the set/reset line drives it. Null when the design did not say. */
  regset: string | null
  /** what the register samples, e.g. `DL`. Null when unspecified. */
  select: string | null
}

/** One slice: its lookup tables, its registers, and the settings they share. */
export type NexusSlice = {
  tile: NexusTile
  /** the slice letter, e.g. `A`. */
  name: string
  luts: NexusLut[]
  registers: NexusRegister[]
  /** the slice-wide clock selection, e.g. `CLK`. Null when the slice is unclocked. */
  clock: string | null
  /** the slice-wide set/reset selection, e.g. `INV`. */
  setReset: string | null
  /** how set/reset and clock-enable interact, e.g. `LSR_OVER_CE`. */
  srMode: string | null
}

const SLICE_PART = /^SLICE([A-Z])\.(.+)$/

/**
 * Recover every slice a design configures.
 *
 * Only slices the design actually touches appear — a real chip has thousands, and reporting them all would bury
 * the handful in use. Slices are returned in a stable order so two runs agree.
 */
export function decodeNexusSlices(fasm: NexusFasm): NexusSlice[] {
  const slices = new Map<string, NexusSlice>()

  const sliceFor = (tile: NexusTile, letter: string): NexusSlice => {
    const key = `${tile.name}/SLICE${letter}`
    let slice = slices.get(key)
    if (slice === undefined) {
      slice = {
        tile,
        name: letter,
        luts: [],
        registers: [],
        clock: null,
        setReset: null,
        srMode: null,
      }
      slices.set(key, slice)
    }
    return slice
  }

  const registerFor = (slice: NexusSlice, name: string): NexusRegister => {
    let register = slice.registers.find((r) => r.name === name)
    if (register === undefined) {
      register = { name, used: false, regset: null, select: null }
      slice.registers.push(register)
    }
    return register
  }

  for (const tile of fasm.tiles.values()) {
    // Truth tables arrive as wide assignments; everything else as plain settings.
    for (const assignment of tile.assignments) {
      const part = SLICE_PART.exec(assignment.path)
      if (part === null) continue
      const inner = part[2] as string
      const lut = /^(K\d)\.INIT$/.exec(inner)
      if (lut === null) continue
      // A lookup table is 16 bits, so its value always fits a number; a wider assignment (a memory's contents)
      // would not, and is not a lookup table.
      if (assignment.value === null) continue
      sliceFor(tile, part[1] as string).luts.push({
        name: lut[1] as string,
        init: assignment.value,
      })
    }

    for (const feature of tile.features) {
      const part = SLICE_PART.exec(feature.path)
      if (part === null) continue
      const slice = sliceFor(tile, part[1] as string)
      const inner = part[2] as string

      const register = /^(REG\d)\.(\w+)$/.exec(inner)
      if (register !== null) {
        const target = registerFor(slice, register[1] as string)
        const setting = register[2] as string
        if (setting === 'USED') target.used = feature.value === 'YES'
        else if (setting === 'REGSET') target.regset = feature.value
        else if (setting === 'SEL') target.select = feature.value
        continue
      }
      if (inner === 'CLKMUX') slice.clock = feature.value
      else if (inner === 'LSRMUX') slice.setReset = feature.value
      else if (inner === 'SRMODE') slice.srMode = feature.value
    }
  }

  for (const slice of slices.values()) {
    slice.luts.sort((a, b) => a.name.localeCompare(b.name))
    slice.registers.sort((a, b) => a.name.localeCompare(b.name))
  }
  return [...slices.values()].sort(
    (a, b) => a.tile.row - b.tile.row || a.tile.col - b.tile.col || a.name.localeCompare(b.name),
  )
}

/** Whether a truth table's output changes with one of its four inputs. */
export function nexusLutUsesInput(init: number, pin: number): boolean {
  for (let entry = 0; entry < 16; entry++) {
    if (((entry >> pin) & 1) !== 0) continue
    if (((init >> entry) & 1) !== ((init >> (entry | (1 << pin))) & 1)) return true
  }
  return false
}

/** The inputs a truth table actually depends on — the rest are wired but ignored. */
export function nexusLutInputs(init: number): number[] {
  return [0, 1, 2, 3].filter((pin) => nexusLutUsesInput(init, pin))
}

/**
 * Whether a slice actually does anything, as opposed to merely having settings written to it.
 *
 * A packed bitstream sets slice-wide values — the clock, the set/reset line — on slices NEIGHBOURING the ones in
 * use, because those settings are shared across a region of the chip. Such a slice has a clock but no lookup
 * table and no enabled register: it is configured, not used. Counting it as logic would overstate a design's
 * size, so the two are told apart here rather than left to the caller to notice.
 */
export function nexusSliceInUse(slice: NexusSlice): boolean {
  return slice.luts.length > 0 || slice.registers.some((register) => register.used)
}
