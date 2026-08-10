/**
 * FPGA fabric — Lattice Nexus (Project Oxide): assemble a decoded design into a SIMULATABLE netlist.
 *
 * This is the Nexus counterpart of iCE40's `reconstructNetlist`, Gowin's `reconstructApiculaNetlist` and ECP5's
 * `reconstructEcp5Netlist`, and its point is the same: produce the SHARED `RecoveredNetlist`, so a Nexus design
 * flows into `simulateCombinational`, `simulateClocked` and `lowerNetlistToCanvas` with no new simulator and
 * nothing duplicated.
 *
 * WHAT A NEXUS LOGIC TILE HOLDS. A `PLC` tile has four slices `SLICEA`..`SLICED`; each slice has two lookup
 * tables `K0`/`K1` and two registers `REG0`/`REG1`. The tile's own wire names number them 0..7 — `JA0`..`JA7`,
 * `JF0`..`JF7`, `JQ0`..`JQ7` — and the device database's fixed connections say which is which: `JA0_SLICEB` IS
 * `JA2`, `JQ2` IS `JQ0_SLICEB`. So lookup table `lut` of slice `s` is cell `k = 2·s + lut`, and a tile
 * `R<row>C<col>` becomes `CellRef { x: col, y: row, cell: k }` — cells keep the coordinates the device uses.
 *
 * THE CARRY UNIT IS NOT THE iCE40 ONE, AND IT IS NOT REFUSED EITHER. In arithmetic mode (`MODE.CCU2`) a Nexus
 * lookup table computes, per yosys's own `OXIDE_COMB` simulation model (`techlibs/nexus/cells_sim.v`, ISC):
 *
 *     Z   = LUT4(INIT, A, B, C, D)          the plain lookup table
 *     Z3  = LUT4(INIT, A, B, C, 0)          the same table with D forced low — the carry GENERATE term
 *     F   = Z ^ (carry-in & ~inject)        what leaves the cell
 *     FCO = Z ? carry-in : (Z3 & ~inject)   what goes on to the next cell
 *
 * The shared cell's `carryEnable` is the iCE40 chain — `cout = majority(in1, in2, cin)` — a DIFFERENT function,
 * so switching it on here would simulate an adder that is subtly wrong. The two agree only when Z and Z3 happen
 * to be a textbook propagate/generate pair, which the packer is free not to produce. Rather than refuse
 * arithmetic outright (that would erase every counter and every adder — the reason anyone builds one of these),
 * each arithmetic lookup table is expanded into the four-input cells the shared model DOES have:
 *
 *     cell k        the output F        — `Z ^ carry-in`, or the register when one is switched on
 *     cell 8  + k   Z                   — the lookup table itself
 *     cell 16 + k   Z3                  — the same table with input D held low
 *     cell 24 + k   FCO                 — `Z ? carry-in : Z3`
 *
 * Every one of those is an ordinary four-input lookup table reading ordinary sources, so the shared simulator
 * runs them unchanged and the canvas lowering turns them into real gates. `carryEnable` stays OFF on all of
 * them: nothing here goes near the iCE40 carry model.
 *
 * THE CHAIN'S SHAPE IS READ, NOT GUESSED. `fpga-oxide-plc.ts` carries Project Oxide's own fixed connections:
 * `JFCI_SLICEB <- JFCO_SLICEA` and friends run the carry A→B→C→D within a tile, and `HFIE0000 <- W1:JFCOUT`
 * brings it in from the tile one column WEST. So a chain runs left to right along a row.
 *
 * WHAT A FASM FILE LEAVES OUT, AND WHY THAT MATTERS. Two omissions will silently wreck a design if they are not
 * handled, and both are settled by the database rather than by assumption:
 *
 *   - An ABSENT `K<n>.INIT` does NOT mean an empty lookup table. Every INIT bit is stored inverted
 *     (`PLC.ron`, `invert: true` on all sixteen), so a blank device reads back as `16'hFFFF`, and the unpacker
 *     omits any value equal to what a blank device holds. A real counter's carry-generating table is exactly
 *     `0xFFFF`; reading it as `0x0000` stops the chain dead.
 *   - An ABSENT routing choice may still be a live connection. A multiplexer choice with an empty bit list is
 *     the one a blank device already makes, so nothing is written for it — `JF2 <- JF0_SLICEB` is how a plain
 *     lookup table reaches the outside world, and `JCE0`/`JLSR0` are tied to `G:VCC`, which is why an unused
 *     clock-enable is permanently ENABLED and an unused set/reset line is permanently HIGH (and is switched off
 *     by INVERTING it, not by leaving it alone).
 *
 * HONEST SCOPE. This reconstructs the LOGIC fabric. A signal that leaves the logic tiles — into an IO buffer, a
 * block memory, a DSP — is followed as far as the routing goes and then reported as a `primary`, never guessed
 * at. Clocks are reported separately (`clocks`) rather than wired as inputs, because the shared simulator has
 * one clock and a Nexus design may have several; when it does, that is said out loud on every register rather
 * than the two quietly becoming one. Which registers COUNT as sharing a clock is decided by the device's own
 * clock-region map, down to the horizontal row and no further — see `nexusClockScope` for what that does and
 * does not settle. A distributed-RAM slice is left out and named, not simulated as logic —
 * and note that a bitstream cannot even distinguish `DPRAM` from `LOGIC` (the database gives both the same
 * empty bit list), so only a router-written file ever says so.
 */

import type {
  CellCaveat,
  CellRef,
  InputSource,
  RecoveredCell,
  RecoveredNetlist,
} from './fpga-icebox-run.ts'
import type { NexusFasm, NexusTile } from './fpga-oxide-fasm.ts'
import {
  LIFCL40_BRANCH_SEGMENTS,
  LIFCL40_CLOCK_HALVES,
  NEXUS_PLC_ALWAYS_ON_PIPS,
  NEXUS_PLC_CONNS,
} from './fpga-oxide-plc.ts'
import { decodeNexusSlices, type NexusSlice } from './fpga-oxide-slice.ts'

/** The pseudo-wire every constant-one tie resolves to. Not a name any tile uses, so it cannot collide. */
const CONSTANT_ONE = '#VCC'

const SLICE_LETTERS = 'ABCD'

/** Where a recovered cell came from, and which part of the slice it stands for. */
export type NexusCellOrigin = {
  /** the tile as the FASM names it, e.g. `R9C5__PLC`. */
  tile: string
  /** the slice letter. */
  slice: string
  /** which of the slice's two lookup tables. */
  lut: number
  /**
   * What this cell IS. `output` is what leaves the lookup table (or its register); the other four exist only
   * because a Nexus carry unit and wide multiplexer need more than one four-input node to say exactly.
   */
  part:
    | 'output'
    | 'carry-lut'
    | 'carry-generate'
    | 'carry-out'
    | 'wide-mux'
    | 'enable-inverter'
    | 'enable-override'
}

/**
 * One clock the design uses, and the registers it drives.
 *
 * Grouped by WIRE, not by wire-and-edge. A design that clocks some registers on the rising edge and some on
 * the falling edge of ONE clock has one clock, and the shared simulator reproduces it exactly — it settles the
 * logic twice per cycle when a falling-edge register is present. Counting the two edges as two clocks would
 * put a "this cannot be reproduced" warning on a design that is reproduced perfectly. Which edge each register
 * takes is on the register itself (`negClk`).
 */
export type NexusClockDomain = {
  /** the clock wire, scoped to its clock region — see `nexusClockScope`. */
  wire: string
  refs: CellRef[]
}

/** A reconstructed Nexus design: the shared netlist, plus where each cell came from. */
export type NexusNetlist = RecoveredNetlist & {
  /** cell key (`x_y_cell`) → the tile, slice and lookup table it came from. */
  origin: Map<string, NexusCellOrigin>
  /** net index → the wire name it stands for. */
  netNames: Map<number, string>
  /** every distinct clock the design's registers use. */
  clocks: NexusClockDomain[]
}

const cellKey = (ref: CellRef): string => `${ref.x}_${ref.y}_${ref.cell}`

/** Cell indices for the pieces a Nexus slice needs beyond the eight lookup-table outputs. */
const CARRY_LUT_CELL = (k: number): number => 8 + k
const CARRY_GENERATE_CELL = (k: number): number => 16 + k
const CARRY_OUT_CELL = (k: number): number => 24 + k
const WIDE_MUX_CELL = (sliceIndex: number): number => 32 + sliceIndex
const ENABLE_INVERTER_CELL = (sliceIndex: number): number => 36 + sliceIndex
const ENABLE_OVERRIDE_CELL = (sliceIndex: number): number => 40 + sliceIndex

/** `[HV]<span><direction><index>` — a routing wire that hops a fixed number of tiles. */
const DIRECTIONAL_WIRE = /^[HV]\d{2}[NSEW]\d+$/
/** A port naming a compass direction and a SIGNED TILE OFFSET, e.g. `S3`, `E1`. */
const RELATIVE_PORT = /^([NSEW])(\d+)$/

/** Build a 16-entry truth table from a function of the four inputs, indexed `a + 2b + 4c + 8d`. */
function truthTable(fn: (a: boolean, b: boolean, c: boolean, d: boolean) => boolean): boolean[] {
  return Array.from({ length: 16 }, (_, index) =>
    fn((index & 1) !== 0, (index & 2) !== 0, (index & 4) !== 0, (index & 8) !== 0),
  )
}

/** A lookup table's sixteen bits, least-significant entry first. */
function initBits(init: number): boolean[] {
  return Array.from({ length: 16 }, (_, index) => ((init >> index) & 1) === 1)
}

/**
 * The same lookup table with input D held LOW — the carry unit's generate term (`Z3` in `OXIDE_COMB`).
 *
 * Entry `i` is entry `i & 7` of the original, i.e. the table's low half repeated. Written out over all four
 * inputs so it drops onto a shared cell unchanged; input D is then a don't-care.
 */
function generateTermBits(init: number): boolean[] {
  return Array.from({ length: 16 }, (_, index) => ((init >> (index & 7)) & 1) === 1)
}

const BUFFER_TRUTH = truthTable((a) => a)
const INVERTER_TRUTH = truthTable((a) => !a)
const OR_TRUTH = truthTable((a, b) => a || b)
const CARRY_SUM_TRUTH = truthTable((z, carryIn) => z !== carryIn)
const CARRY_SUM_INJECTED_TRUTH = truthTable((z) => z)
const CARRY_OUT_TRUTH = truthTable((z, carryIn, generate) => (z ? carryIn : generate))
const CARRY_OUT_INJECTED_TRUTH = truthTable((z, carryIn) => z && carryIn)
const WIDE_MUX_TRUTH = truthTable((lut0, lut1, select) => (select ? lut1 : lut0))
const PLAIN_LOGIC = {
  carryEnable: false,
  dffEnable: false,
  setNoReset: false,
  asyncSetReset: false,
} as const

const UNUSED: InputSource = { kind: 'unused' }

/** Whether a truth table's output actually changes with input `pin` — a pin it ignores is a don't-care. */
function dependsOnPin(truth: readonly boolean[], pin: number): boolean {
  const bit = 1 << pin
  for (let index = 0; index < 16; index++)
    if ((index & bit) === 0 && truth[index] !== truth[index | bit]) return true
  return false
}

/**
 * The half of the die a column's clock spine belongs to, or null when no spine stands near that column.
 *
 * A spine is named by its COLUMN — `d0_spines` is one entry covering rows 1 to 55, so one spine runs the whole
 * height of the die — and the two halves each own two spine columns. But a spine is NAMED in two different
 * kinds of tile and the two do not sit at the same column: the tap tile that reads it stands one column to its
 * east (taps at 14, 38, 62, 74), and the database's own spine columns are 13, 37, 61, 73, while the tile grid
 * puts the spine tiles themselves at 13, 37, 62, 74. Every one of those is within ONE column of a listed spine,
 * and no other column is, so the nearest listed spine identifies the half and anything further away is refused
 * rather than guessed at.
 */
export function nexusClockHalf(col: number): 'L' | 'R' | null {
  for (const half of LIFCL40_CLOCK_HALVES)
    for (const spineCol of half.spineCols) if (Math.abs(col - spineCol) <= 1) return half.side
  return null
}

/**
 * The clock region a clock-network wire belongs to, or null when the reference is not one.
 *
 * A clock wire wears the same name everywhere it goes — `HPBX0000` is the branch name in every tile on the die
 * — so the name alone is not an identity: a design with two clocks uses that one name for both. What tells them
 * apart is the clock REGION, and the region map is a first-class table in the device database
 * (`prjoxide bba-export`, labels `d0_branches` and `d0_hrows`) rather than something to be inferred. An earlier
 * guess that a branch was scoped by ROW ALONE was refuted by a two-clock design whose clocks sit on the same
 * row; a guess that it was chip-wide merged them outright.
 *
 * Three levels are scoped, each by what the database says identifies it:
 *
 *   `BRANCH__HPBX0000`  the branch, by (row, segment). One row wide — `BRANCH_L__` / `BRANCH_R__` appear at a
 *                       tap tile and name the segment on that side of it, a plain `BRANCH__` names the segment
 *                       its own column falls in. Both halves matter: a four-clock design reuses `HPBX0100` for
 *                       two DIFFERENT clocks on two rows of one segment, and a big one-clock design puts ONE
 *                       clock on eleven rows of one segment.
 *   `SPINE__VPSX0400`   the spine, by half. Vertical, spanning every row, which is what joins those eleven
 *                       branches back into one clock.
 *   `HROW__HPRX0400`    the horizontal row, by half. What joins two spines of one half into one clock.
 *
 * Anything else with a port — `G__` wires, the trunk, the clock multiplexer — keeps the vendor's own name-only
 * identity, and `nexusTraceClockNet` stops before reaching them.
 */
export function nexusClockScope(
  row: number,
  col: number,
  port: string,
  wire: string,
): string | null {
  if (port === 'SPINE' || port === 'HROW') {
    const half = nexusClockHalf(col)
    return half === null ? null : `${port}_${half}_${wire}`
  }
  if (port !== 'BRANCH' && port !== 'BRANCH_L' && port !== 'BRANCH_R') return null
  // `BRANCH_L` names the segment on the tap's LEFT, and the database's own `tap_side` says the same thing: the
  // first LIFCL-40 row is (branch 7, from 1, tap 14, side L, to 13), a segment spanning columns 1-13 — left of
  // its tap at 14. Mapping L to 'R' here asked for the segment on the other side of the tap, so a wire at a tap
  // tile was filed under the neighbouring clock region.
  const side = port === 'BRANCH_L' ? 'L' : port === 'BRANCH_R' ? 'R' : null
  const segment =
    side === null
      ? LIFCL40_BRANCH_SEGMENTS.findIndex((s) => col >= s.fromCol && col <= s.toCol)
      : LIFCL40_BRANCH_SEGMENTS.findIndex((s) => s.tapCol === col && s.tapSide === side)
  if (segment < 0) return null
  return `BRANCH${segment}_R${row}_${wire}`
}

/** Whether a resolved wire name is one `nexusClockScope` placed in a clock region. */
export function isNexusClockNetWire(name: string): boolean {
  return /^(?:BRANCH\d+_R\d+|SPINE_[LR]|HROW_[LR])_/.test(name)
}

/** Move `offset` tiles in the named compass direction. */
function step(
  row: number,
  col: number,
  side: string,
  offset: number,
): { row: number; col: number } {
  if (side === 'N') return { row: row - offset, col }
  if (side === 'S') return { row: row + offset, col }
  if (side === 'W') return { row, col: col - offset }
  return { row, col: col + offset }
}

/**
 * Resolve one wire reference seen in a tile to a name every tile touching that wire will agree on.
 *
 * Four shapes, told apart by the WIRE rather than by the port (judging by the port gave two different answers
 * for one piece of copper once already):
 *
 *   `S3__V06S0003`     a directional hop — the port index is a SIGNED TILE OFFSET, so the wire is named after
 *                      the tile it is anchored at, and a bare mention there agrees with it
 *   `G__VCC`           the constant-one supply, which is a VALUE, not a wire to be traced
 *   `BRANCH__HPBX0000` a clock branch — scoped to its clock region (see `nexusClockScope`)
 *   `JQ0`              a tile-local wire, named with its tile
 *
 * Anything else with a port (`SPINE__`, `HROW__`, other `G__` wires) keeps the vendor's own name-only identity.
 *
 * KNOWN LIMIT on that last case: a spine's own region is NOT pinned, so two spines in different halves of the
 * die that share a name become one name here. It costs nothing for a clock, which is identified by the branch
 * it arrives on and never traced further — but a set/reset or a clock-enable carried on the clock network
 * would be affected, and no design available here does that, so it is flagged rather than claimed either way.
 */
function resolveWire(row: number, col: number, reference: string): string {
  const mark = reference.indexOf('__')
  if (mark < 0) return `R${row}C${col}_${reference}`
  const port = reference.slice(0, mark)
  const wire = reference.slice(mark + 2)
  const relative = RELATIVE_PORT.exec(port)
  if (relative !== null && DIRECTIONAL_WIRE.test(wire)) {
    const anchor = step(row, col, relative[1] as string, Number.parseInt(relative[2] as string, 10))
    return `R${anchor.row}C${anchor.col}_${wire}`
  }
  if (port === 'G' && wire === 'VCC') return CONSTANT_ONE
  return nexusClockScope(row, col, port, wire) ?? wire
}

/**
 * Resolve a wire name written the way the DEVICE DATABASE writes it: `W1:JFCOUT`, `G:VCC`, or a bare local name.
 *
 * The database separates a relative prefix with a single colon where a FASM file uses a double underscore, and
 * its prefixes name whole neighbouring tiles rather than the anchor of a spanning wire — `W1:` is "the tile one
 * column west", full stop.
 */
function resolveDatabaseWire(row: number, col: number, name: string): string {
  const mark = name.indexOf(':')
  if (mark < 0) return `R${row}C${col}_${name}`
  const prefix = name.slice(0, mark)
  const wire = name.slice(mark + 1)
  if (prefix === 'G' && wire === 'VCC') return CONSTANT_ONE
  const relative = RELATIVE_PORT.exec(prefix)
  if (relative === null) return `R${row}C${col}_${name}`
  const anchor = step(row, col, relative[1] as string, Number.parseInt(relative[2] as string, 10))
  return `R${anchor.row}C${anchor.col}_${wire}`
}

/** One lookup table the design really programmed, with everything needed to build its cells. */
type LookupTable = {
  tile: NexusTile
  slice: NexusSlice
  letter: string
  sliceIndex: number
  lut: number
  k: number
  ref: CellRef
  init: number
  arithmetic: boolean
  inject: boolean
  registered: boolean
}

/** What a slice's registers do beyond holding a value, once the slice-wide settings are read. */
type RegisterControls = {
  negEdge: boolean
  setReset: InputSource | null
  clockEnable: InputSource | null
  asyncSetReset: boolean
  clockWire: string | null
  /** anything about this register that could not be resolved, in plain words. */
  refusals: string[]
  /** small cells the slice's control logic needs — an inverted enable, an enable a reset overrides. */
  helpers: { cell: RecoveredCell; part: NexusCellOrigin['part'] }[]
}

/**
 * Reconstruct a simulatable netlist from a parsed Nexus FASM file.
 *
 * The file may come from either half of the toolchain — the router writes one, the unpacker writes one back out
 * of a real bitstream — and the two do not agree about what to leave out. Everything the unpacker omits because
 * a blank device already holds it is supplied from the device database, so both produce the same netlist.
 */
export function reconstructNexusNetlist(fasm: NexusFasm): NexusNetlist {
  const logicTiles = [...fasm.tiles.values()]
    .filter((tile) => tile.type === 'PLC')
    .sort((a, b) => a.row - b.row || a.col - b.col)
  const wireIn = (tile: NexusTile, name: string): string => `R${tile.row}C${tile.col}_${name}`

  // ---- the wire graph -------------------------------------------------------------------------------------
  // Each routed sink has ONE driver. The database's permanent links and always-on multiplexer choices go in
  // first; the FASM's own pips go in after them and OVERRIDE them, because a design that switched a
  // bit-carrying pip on has chosen that source over the blank device's default.
  const driverOf = new Map<string, string>()
  for (const tile of logicTiles)
    for (const [destination, source] of [...NEXUS_PLC_CONNS, ...NEXUS_PLC_ALWAYS_ON_PIPS])
      driverOf.set(
        resolveDatabaseWire(tile.row, tile.col, destination),
        resolveDatabaseWire(tile.row, tile.col, source),
      )
  /** Every wire something READS — used to tell a lookup table nobody wired up from one really in use. */
  const readSomewhere = new Set<string>()
  /**
   * Every wire the design's routing MENTIONS, on either end of a pip.
   *
   * This is what tells a signal arriving from outside the logic fabric — an IO buffer, a block memory — from a
   * cell pin the router simply never wired. Both dead-end a backward trace, and calling the second one an
   * external input would invent drivable signals the design does not have: a test could then set an adder's
   * carry-in or a lookup table's spare pin and watch the answer change. iCE40's reader learnt the same lesson.
   */
  const routedWires = new Set<string>()
  /**
   * Clock-network wires two pips disagree about the driver of.
   *
   * A scoped clock wire is meant to be one piece of copper, so two pips naming it with two different sources
   * means the scoping has put two clocks under one name. Silently keeping the last one would merge them, which
   * is the whole failure this scoping exists to prevent — so the conflict is recorded and the trace refuses to
   * cross it, leaving each register on the last identity that is still trustworthy.
   */
  const clockNetConflicts = new Set<string>()
  for (const tile of fasm.tiles.values())
    for (const pip of tile.pips) {
      const destination = resolveWire(tile.row, tile.col, pip.destination)
      const source = resolveWire(tile.row, tile.col, pip.source)
      const previous = driverOf.get(destination)
      // The `isNexusClockNetWire` test keeps this set to what its name says, and nothing more: a NON-clock
      // destination legitimately gets rewritten here every time a FASM arc overrides a database default, and
      // only clock wires are ever asked about. Dropping the test changes no answer — it just fills the set with
      // ordinary overrides — so it is a naming guard, not a behavioural one, and no test can catch its loss.
      if (previous !== undefined && previous !== source && isNexusClockNetWire(destination))
        clockNetConflicts.add(destination)
      driverOf.set(destination, source)
      readSomewhere.add(source)
      routedWires.add(destination)
      routedWires.add(source)
    }

  // ---- which lookup tables are really there ---------------------------------------------------------------
  const sliceByKey = new Map<string, NexusSlice>()
  for (const slice of decodeNexusSlices(fasm))
    sliceByKey.set(`${slice.tile.name}/${slice.name}`, slice)

  const tables: LookupTable[] = []
  const memorySlices: NexusSlice[] = []
  for (const tile of logicTiles) {
    /**
     * Whether this tile's lookup tables are a distributed MEMORY rather than logic.
     *
     * This has to be decided by slice C, and that is not a stylistic choice. The database gives `DPRAM` an
     * EMPTY bit list on slices A and B — a memory slice and a plain logic slice are stored identically, so no
     * bitstream can tell them apart and only a router-written file ever says `DPRAM` out loud. Slice C's
     * `RAMW` does have bits, and slice C is the write port: its own fixed connections
     * (`JWAD0_SLICEA <- JWADO0_SLICEC`, `JWCK_SLICEA <- JWCKO_SLICEC`, and the same for slice B) say exactly
     * which two slices it writes into. So `RAMW` on slice C is the one honest signal that A and B hold a
     * memory, and it is what stops a lookup-table read of a memory's power-up image being simulated as logic.
     */
    const writePort = sliceByKey.get(`${tile.name}/C`)?.mode === 'RAMW'
    for (let sliceIndex = 0; sliceIndex < 4; sliceIndex++) {
      const letter = SLICE_LETTERS[sliceIndex] as string
      const slice = sliceByKey.get(`${tile.name}/${letter}`)
      if (slice === undefined) continue
      if (slice.mode === 'DPRAM' || slice.mode === 'RAMW' || (writePort && sliceIndex < 2)) {
        memorySlices.push(slice)
        continue
      }
      const arithmetic = slice.mode === 'CCU2'
      // A blank device reads back as `INJECT YES`, so an absent value is NOT `NO`. With injection the incoming
      // carry is cut off (`~inject_p` is zero in `OXIDE_COMB`), which is how a chain is started.
      const inject = (slice.carryInject ?? 'YES') === 'YES'
      for (let lut = 0; lut < 2; lut++) {
        const k = sliceIndex * 2 + lut
        const programmed = slice.luts.find((entry) => entry.name === `K${lut}`)
        const registered = slice.registers.find((r) => r.name === `REG${lut}`)?.used === true
        // Every INIT bit is stored inverted, so a lookup table nobody programmed reads back as all-ones. Such a
        // table sits on every slice of the chip; emitting it would put a constant-1 cell in the netlist that
        // exists nowhere in the design. It is real only when the design programmed it, switched its register
        // on, put the slice into arithmetic mode (where BOTH tables carry the chain), or reads its output.
        const used =
          programmed !== undefined ||
          registered ||
          arithmetic ||
          readSomewhere.has(wireIn(tile, `JF${k}`)) ||
          readSomewhere.has(wireIn(tile, `JQ${k}`))
        if (!used) continue
        tables.push({
          tile,
          slice,
          letter,
          sliceIndex,
          lut,
          k,
          ref: { x: tile.col, y: tile.row, cell: k },
          init: programmed?.init ?? 0xffff,
          arithmetic,
          inject,
          registered,
        })
      }
    }
  }

  // ---- what each wire is driven BY ------------------------------------------------------------------------
  /** Wire → the cell whose output it carries. */
  const cellByOutput = new Map<string, CellRef>()
  /**
   * Wire → the lookup table whose COMBINATIONAL output it carries, even when a register hides that output.
   *
   * Kept apart from `cellByOutput` on purpose. A registered cell's shared-model output is its stored Q, so
   * binding its `JF` wire to the same cell would hand every reader of the raw lookup table the register's value
   * instead — a wrong answer wearing a right-looking shape. The register's own data path still has to
   * recognise "this is my own lookup table", which is what this map is for.
   */
  const lutOutputWire = new Map<string, number>()
  /** Slices whose wide multiplexer really multiplexes, i.e. whose select is driven. */
  const wideMuxActive = new Set<string>()

  for (const table of tables) {
    const { tile, letter, lut, k, sliceIndex } = table
    const lutOut = wireIn(tile, `JF${lut}_SLICE${letter}`)
    lutOutputWire.set(lutOut, k)
    if (table.registered) cellByOutput.set(wireIn(tile, `JQ${lut}_SLICE${letter}`), table.ref)
    else cellByOutput.set(lutOut, table.ref)
    if (table.arithmetic && lut === 1)
      cellByOutput.set(wireIn(tile, `JFCO_SLICE${letter}`), {
        x: tile.col,
        y: tile.row,
        cell: CARRY_OUT_CELL(k),
      })
    if (lut !== 0) continue
    // The wide multiplexer sits on the slice's `OFX0` output: `OFX = SEL ? F1 : F0`, its select coming from the
    // tile wire `JM<2·slice>`. When nothing drives that select the multiplexer passes the plain lookup table
    // straight through — which is what the router relies on every time it sends an arithmetic slice's output
    // through `OFX0` without wiring a select at all — so that case becomes a plain alias and costs no cell.
    // When the select IS driven AND something reads the multiplexer's output, it is real and gets a cell.
    //
    // That an undriven select reads LOW is not taken on trust: every register of the real 8-bit counter takes
    // its data through `OFX0` with no select wired, so if the multiplexer passed its OTHER lookup table instead
    // each bit would latch its neighbour's value and the design would not count. It counts.
    //
    // BOTH halves of that test are load-bearing. `JM<2·slice>` is not only the select: it is also the register's
    // bypass data (`JM0_DIMUX <- JM0`), so every shift register on the chip routes it — and testing the select
    // alone put a phantom multiplexer on each one, reading two registers nothing in the design multiplexes.
    const ofx = wireIn(tile, `JOFX0_SLICE${letter}`)
    if (driverOf.has(wireIn(tile, `JM${sliceIndex * 2}`)) && readSomewhere.has(ofx)) {
      wideMuxActive.add(`${tile.name}/${letter}`)
      cellByOutput.set(ofx, { x: tile.col, y: tile.row, cell: WIDE_MUX_CELL(sliceIndex) })
    } else if (!driverOf.has(ofx)) driverOf.set(ofx, lutOut)
  }

  // ---- resolving a pin ------------------------------------------------------------------------------------
  const netOf = new Map<string, number>()
  const netNames = new Map<number, string>()
  const internNet = (wire: string): number => {
    const existing = netOf.get(wire)
    if (existing !== undefined) return existing
    const net = netOf.size
    netOf.set(wire, net)
    netNames.set(net, wire)
    return net
  }

  /** Follow a wire back through the routing until it reaches something that drives it, or runs out. */
  const traceBack = (start: string): string => {
    let current = start
    const seen = new Set<string>([current])
    while (current !== CONSTANT_ONE && !cellByOutput.has(current) && !lutOutputWire.has(current)) {
      const next = driverOf.get(current)
      if (next === undefined || seen.has(next)) break
      current = next
      seen.add(current)
    }
    return current
  }

  // Caveats are collected per cell so a cell with several problems carries ONE entry naming all of them —
  // consumers count these entries as "how many cells are affected", and the canvas lowering pins each entry
  // onto the parts a cell became.
  const caveats = { unfaithful: new Map(), undecoded: new Map(), incomplete: new Map() } as Record<
    'unfaithful' | 'undecoded' | 'incomplete',
    Map<string, { ref: CellRef; reasons: string[] }>
  >
  const note = (
    list: 'unfaithful' | 'undecoded' | 'incomplete',
    ref: CellRef,
    reason: string,
  ): void => {
    const entry = caveats[list].get(cellKey(ref)) ?? { ref, reasons: [] }
    if (!entry.reasons.includes(reason)) entry.reasons.push(reason)
    caveats[list].set(cellKey(ref), entry)
  }
  const collect = (list: 'unfaithful' | 'undecoded' | 'incomplete'): CellCaveat[] =>
    [...caveats[list].values()].map((entry) => ({
      ref: entry.ref,
      reason: entry.reasons.join('; also: '),
    }))

  /**
   * What drives a wire: a cell, a constant tie, an honest primary, or nothing at all.
   *
   * `reader` is the cell asking, so a wire that dead-ends somewhere the shared model cannot represent names the
   * cell it affects rather than leaving a caveat with nobody on it.
   */
  const resolve = (wire: string, reader: CellRef): InputSource => {
    if (!driverOf.has(wire) && !cellByOutput.has(wire) && !lutOutputWire.has(wire)) return UNUSED
    const reached = traceBack(wire)
    if (reached === CONSTANT_ONE) return { kind: 'const', value: true }
    const driver = cellByOutput.get(reached)
    if (driver !== undefined) return { kind: 'cell', driver, net: internNet(reached) }
    if (lutOutputWire.has(reached)) {
      // The wire carries a lookup table whose own register has taken over that cell. One shared cell holds one
      // function, so this reader cannot be handed the pre-register value; say so instead of handing it Q.
      note(
        'incomplete',
        reader,
        `this reads ${reached}, the raw lookup-table output of a cell whose register has taken it over; the shared cell model carries ONE function per cell, so the connection is reported as an external input rather than wired to the register's stored value`,
      )
      return { kind: 'primary', net: internNet(reached) }
    }
    // A dead end the routing never mentions is a pin nothing was wired to, not a signal from elsewhere.
    if (!routedWires.has(reached)) return UNUSED
    // It left the logic fabric — an IO buffer, a block memory, a wire off the edge. An honest primary.
    return { kind: 'primary', net: internNet(reached) }
  }

  /**
   * The carry arriving at a slice's first lookup table.
   *
   * A carry that traces back to no arithmetic cell is a chain STARTING here: the tile to the west has no carry
   * unit switched on, so nothing drives its carry output and the chain begins at zero. That is a constant, not
   * an external input somebody could drive — calling it a primary would invent a drivable signal the design
   * does not have and let a test set a counter's carry-in to one.
   */
  const resolveCarryIn = (tile: NexusTile, letter: string, reader: CellRef): InputSource => {
    const source = resolve(wireIn(tile, `JFCI_SLICE${letter}`), reader)
    return source.kind === 'cell' ? source : { kind: 'const', value: false }
  }

  /**
   * Follow a register's clock pin up the clock network to the highest wire whose region is scoped.
   *
   * Which level that is decides which registers count as sharing a clock, and both directions are failures. Stop
   * at the branch and one clock on eleven rows becomes eleven clocks. Carry on past the horizontal row and the
   * names stop being scoped at all — a trunk wire is called `HPRX0400` on both sides of the die — so two clocks
   * become one, which is the bug this whole map exists to prevent. So the walk climbs while the next wire is a
   * scoped clock-region name and stops the moment it is not.
   */
  const traceClockNet = (clockPin: string): { wire: string; stoppedAtConflict: boolean } | null => {
    let wire = driverOf.get(clockPin) ?? clockPin
    const seen = new Set([wire])
    while (isNexusClockNetWire(wire)) {
      const next = driverOf.get(wire)
      if (next === undefined || !isNexusClockNetWire(next) || seen.has(next)) break
      if (clockNetConflicts.has(next)) return { wire, stoppedAtConflict: true }
      seen.add(next)
      wire = next
    }
    return { wire, stoppedAtConflict: false }
  }

  // ---- the slice-wide register controls -------------------------------------------------------------------
  const clockDomains = new Map<string, NexusClockDomain>()

  const readControls = (table: LookupTable): RegisterControls => {
    const { tile, letter, lut, sliceIndex, ref, slice } = table
    const refusals: string[] = []
    const at = (name: string): string => wireIn(tile, `${name}_SLICE${letter}`)
    const register = slice.registers.find((r) => r.name === `REG${lut}`)

    // The clock. A blank device selects `0` — the register never clocks — so an absent value is not "rising".
    const clockMux = slice.clock ?? '0'
    if (clockMux === 'DDR' || slice.regDdr === 'ENABLED')
      refusals.push(
        'this register clocks on BOTH edges of the clock (REGDDR / CLKMUX DDR), and the shared cell model has one edge per register, so what it stores between edges is not reproduced',
      )
    else if (clockMux !== 'CLK' && clockMux !== 'INV')
      refusals.push(
        `this register is switched on but its clock multiplexer selects ${clockMux}, which ties the clock low, so nothing here can say when it latches`,
      )
    const clockPin = driverOf.get(at('JCLK'))
    const traced = clockPin === undefined ? null : traceClockNet(clockPin)
    const clockWire = traced?.wire ?? null
    if (traced?.stoppedAtConflict === true)
      refusals.push(
        `this register's clock arrives on ${traced.wire}, which two routing arcs drive from different sources, so where the clock comes from above that point cannot be said — registers on the same clock may be reported as being on separate ones`,
      )

    // The set/reset line. `JLSR0` is tied to `G:VCC` by the fabric itself, so an unrouted set/reset arrives
    // HIGH and is switched off by INVERTING it — which is exactly what a design with no reset does.
    const lsrMux = slice.setReset ?? 'LSR'
    const lsrSource = resolve(at('JLSR'), ref)
    let setReset: InputSource | null = null
    if (lsrSource.kind === 'unused') setReset = null
    else if (lsrMux === 'LSR') setReset = lsrSource
    else if (lsrSource.kind === 'const')
      setReset = lsrSource.value ? null : { kind: 'const', value: true }
    // `INV` and `0` are stored in the SAME bit, so a bitstream cannot say which was meant. With the line at
    // its tied-high default both readings agree (no set/reset either way); with a real signal on it they do
    // not, and picking one would be a guess.
    else
      refusals.push(
        'a signal is routed to this register’s set/reset line and the slice inverts it, but the bitstream stores “inverted” and “tied off” in the same bit, so which was meant cannot be told apart — the set/reset is left out rather than guessed',
      )
    if ((register?.lsrMode ?? 'LSR') === 'PRLD')
      refusals.push(
        'this register takes its set/reset VALUE from the slice’s M input (LSRMODE PRLD) rather than a fixed level, which the shared cell model cannot express',
      )

    // The clock enable, likewise tied to `G:VCC` when nothing is routed to it.
    const ceMux = slice.clockEnable ?? 'CE'
    const ceSource = resolve(at('JCE'), ref)
    const helpers: RegisterControls['helpers'] = []
    let clockEnable: InputSource | null = null
    if (ceSource.kind === 'unused' || ceSource.kind === 'const') {
      const enabled =
        ceSource.kind === 'unused' ? true : ceMux === 'INV' ? !ceSource.value : ceSource.value
      clockEnable = enabled ? null : { kind: 'const', value: false }
    } else if (ceMux !== 'INV') clockEnable = ceSource
    else {
      // An inverted enable is exactly a NOT gate on the routed signal, which the shared model expresses as an
      // ordinary one-input lookup table — so it is built rather than refused.
      const inverterRef: CellRef = {
        x: tile.col,
        y: tile.row,
        cell: ENABLE_INVERTER_CELL(sliceIndex),
      }
      helpers.push({
        cell: {
          ref: inverterRef,
          config: { ...PLAIN_LOGIC, truth: INVERTER_TRUTH },
          inputs: [ceSource, UNUSED, UNUSED, UNUSED],
        },
        part: 'enable-inverter',
      })
      clockEnable = { kind: 'cell', driver: inverterRef, net: internNet(`${at('JCE')}#inverted`) }
    }

    const asyncSetReset = (slice.srMode ?? 'LSR_OVER_CE') === 'ASYNC'
    // `SRMODE LSR_OVER_CE` means what it says: a SYNCHRONOUS set/reset beats a de-asserted clock-enable. The
    // shared simulator gates a synchronous set/reset BY the enable (that is what an iCE40 flip-flop does), so
    // handing it these two signals unchanged would let a disabled register ignore its reset. Widening the
    // enable to "enabled, OR being reset" restores the hardware's order exactly, using a cell the model
    // already has — a two-input OR — rather than a special case in a simulator four families share.
    if (!asyncSetReset && setReset !== null && clockEnable !== null) {
      const overrideRef: CellRef = {
        x: tile.col,
        y: tile.row,
        cell: ENABLE_OVERRIDE_CELL(sliceIndex),
      }
      helpers.push({
        cell: {
          ref: overrideRef,
          config: { ...PLAIN_LOGIC, truth: OR_TRUTH },
          inputs: [clockEnable, setReset, UNUSED, UNUSED],
        },
        part: 'enable-override',
      })
      clockEnable = { kind: 'cell', driver: overrideRef, net: internNet(`${at('JCE')}#orReset`) }
    }

    return {
      negEdge: clockMux === 'INV',
      setReset,
      clockEnable,
      asyncSetReset,
      clockWire,
      refusals,
      helpers,
    }
  }

  // ---- build the cells ------------------------------------------------------------------------------------
  const cells: RecoveredCell[] = []
  const origin = new Map<string, NexusCellOrigin>()
  const emitted = new Set<string>()
  const emit = (cell: RecoveredCell, from: LookupTable, part: NexusCellOrigin['part']): void => {
    if (emitted.has(cellKey(cell.ref))) return
    emitted.add(cellKey(cell.ref))
    cells.push(cell)
    origin.set(cellKey(cell.ref), {
      tile: from.tile.name,
      slice: from.letter,
      lut: from.lut,
      part,
    })
  }

  for (const table of tables) {
    const { tile, letter, lut, k, sliceIndex, ref, slice } = table
    const at = (name: string): string => wireIn(tile, `${name}${lut}_SLICE${letter}`)
    const pins: InputSource[] = ['JA', 'JB', 'JC', 'JD'].map((pin) => resolve(at(pin), ref))
    const truth = initBits(table.init)
    for (let pin = 0; pin < 4; pin++)
      if (dependsOnPin(truth, pin) && (pins[pin] as InputSource).kind === 'unused')
        note(
          'incomplete',
          ref,
          `input ${'ABCD'[pin]} of this lookup table changes its output, but nothing is routed to that pin, so what the silicon puts on it is not recovered`,
        )

    const controls: RegisterControls = table.registered
      ? readControls(table)
      : {
          negEdge: false,
          setReset: null,
          clockEnable: null,
          asyncSetReset: false,
          clockWire: null,
          refusals: [],
          helpers: [],
        }
    for (const helper of controls.helpers) emit(helper.cell, table, helper.part)
    for (const refusal of controls.refusals) note('incomplete', ref, refusal)
    if (controls.clockWire !== null) {
      const domain = clockDomains.get(controls.clockWire) ?? { wire: controls.clockWire, refs: [] }
      domain.refs.push(ref)
      clockDomains.set(controls.clockWire, domain)
    }
    // A blank device reads back as SET, so an absent `REGSET` is not "reset".
    const register = slice.registers.find((r) => r.name === `REG${lut}`)
    const registerConfig = {
      dffEnable: table.registered,
      setNoReset: (register?.regset ?? 'SET') === 'SET',
      asyncSetReset: controls.asyncSetReset,
    }
    const registerWiring = table.registered
      ? { negClk: controls.negEdge, setReset: controls.setReset, clockEnable: controls.clockEnable }
      : {}

    // What the register samples. `DL` (the blank device's own choice) is the lookup table; `DF` bypasses it and
    // takes the slice's `M` input instead — which is the whole data path of every shift register and every
    // pipeline stage, so reading `DF` as "the lookup table" loses the design's data flow entirely.
    const select = register?.select ?? 'DL'
    const dataWire = select === 'DF' ? at('JM') : at('JDI')
    const dataIsOwnLut = table.registered && lutOutputWire.get(traceBack(dataWire)) === k

    if (table.arithmetic) {
      const carryLut: CellRef = { x: tile.col, y: tile.row, cell: CARRY_LUT_CELL(k) }
      const carryGenerate: CellRef = { x: tile.col, y: tile.row, cell: CARRY_GENERATE_CELL(k) }
      const carryOut: CellRef = { x: tile.col, y: tile.row, cell: CARRY_OUT_CELL(k) }
      // The carry arriving here: from the other lookup table of this slice, or — for the first of the two —
      // from the slice's own carry input, which the fabric wires to the previous slice or to the tile one
      // column west.
      const carryIn: InputSource =
        lut === 1
          ? {
              kind: 'cell',
              driver: { x: tile.col, y: tile.row, cell: CARRY_OUT_CELL(k - 1) },
              net: internNet(wireIn(tile, `#carry${k - 1}`)),
            }
          : resolveCarryIn(tile, letter, ref)
      const fromCarryLut: InputSource = {
        kind: 'cell',
        driver: carryLut,
        net: internNet(wireIn(tile, `#lut${k}`)),
      }
      emit({ ref: carryLut, config: { ...PLAIN_LOGIC, truth }, inputs: pins }, table, 'carry-lut')
      if (!table.inject)
        emit(
          {
            ref: carryGenerate,
            config: { ...PLAIN_LOGIC, truth: generateTermBits(table.init) },
            inputs: [
              pins[0] as InputSource,
              pins[1] as InputSource,
              pins[2] as InputSource,
              UNUSED,
            ],
          },
          table,
          'carry-generate',
        )
      emit(
        {
          ref: carryOut,
          config: {
            ...PLAIN_LOGIC,
            truth: table.inject ? CARRY_OUT_INJECTED_TRUTH : CARRY_OUT_TRUTH,
          },
          inputs: [
            fromCarryLut,
            carryIn,
            table.inject
              ? UNUSED
              : {
                  kind: 'cell',
                  driver: carryGenerate,
                  net: internNet(wireIn(tile, `#generate${k}`)),
                },
            UNUSED,
          ],
        },
        table,
        'carry-out',
      )
      if (table.registered && !dataIsOwnLut)
        note(
          'incomplete',
          ref,
          'this arithmetic cell’s register does not sample the carry unit’s own output, and the shared cell model gives a cell one function, so only the register is represented here',
        )
      emit(
        {
          ref,
          config: {
            truth: table.inject ? CARRY_SUM_INJECTED_TRUTH : CARRY_SUM_TRUTH,
            carryEnable: false,
            ...registerConfig,
          },
          inputs: [fromCarryLut, table.inject ? UNUSED : carryIn, UNUSED, UNUSED],
          ...registerWiring,
        },
        table,
        'output',
      )
      continue
    }

    if (table.registered && !dataIsOwnLut) {
      // The register is fed from somewhere other than its own lookup table — the `M` bypass, or another slice's
      // output through the wide multiplexer. It is a BUFFER of that source, and the lookup table beside it is
      // untouched (and, being untouched, reads back all-ones, which would latch a constant 1 forever).
      const data = resolve(dataWire, ref)
      if (data.kind === 'unused')
        note(
          'incomplete',
          ref,
          `this register takes its data from ${select === 'DF' ? 'the slice’s M bypass input' : 'the lookup-table path'}, but nothing is routed there, so its data source is not recovered`,
        )
      emit(
        {
          ref,
          config: { truth: BUFFER_TRUTH, carryEnable: false, ...registerConfig },
          inputs: [data, UNUSED, UNUSED, UNUSED],
          ...registerWiring,
        },
        table,
        'output',
      )
    } else
      emit(
        {
          ref,
          config: { truth, carryEnable: false, ...registerConfig },
          inputs: pins,
          ...registerWiring,
        },
        table,
        'output',
      )

    if (lut !== 0 || !wideMuxActive.has(`${tile.name}/${letter}`)) continue
    const partner = tables.find((other) => other.tile === tile && other.k === k + 1)
    const muxRef: CellRef = { x: tile.col, y: tile.row, cell: WIDE_MUX_CELL(sliceIndex) }
    if (partner === undefined)
      note(
        'incomplete',
        muxRef,
        'this slice’s wide multiplexer chooses between its two lookup tables, but the second one is not programmed, so one of its two choices is not recovered',
      )
    if (table.registered)
      note(
        'incomplete',
        muxRef,
        'this slice’s wide multiplexer reads the first lookup table, whose register has taken that cell over, so the value it chooses between is the register’s stored output rather than the table’s',
      )
    emit(
      {
        ref: muxRef,
        config: { ...PLAIN_LOGIC, truth: WIDE_MUX_TRUTH },
        inputs: [
          { kind: 'cell', driver: ref, net: internNet(wireIn(tile, `JF${k}_SLICE${letter}`)) },
          partner === undefined
            ? UNUSED
            : {
                kind: 'cell',
                driver: partner.ref,
                net: internNet(wireIn(tile, `JF1_SLICE${letter}`)),
              },
          resolve(wireIn(tile, `JSEL_SLICE${letter}`), muxRef),
          UNUSED,
        ],
      },
      table,
      'wide-mux',
    )
  }

  // A design with more than one clock cannot be run by a simulator that has one. Say so on every register it
  // affects rather than letting the two quietly become one clock.
  //
  // The COUNT is deliberately not stated. Clock nets are told apart as far as the horizontal row and no
  // further, so two nets that a trunk joins above that are counted twice — a four-clock design measured here
  // came back as six nets. Naming this register's own net is a value that was checked; a total is not.
  const clocks = [...clockDomains.values()].sort((a, b) => a.wire.localeCompare(b.wire))
  if (clocks.length > 1)
    for (const domain of clocks)
      for (const ref of domain.refs)
        note(
          'incomplete',
          ref,
          `this design clocks its registers from more than one clock net (this register runs on ${domain.wire}); a clocked run drives every register from one clock, so the relationship between the domains is not reproduced`,
        )

  for (const slice of memorySlices)
    for (let lut = 0; lut < 2; lut++)
      note(
        'undecoded',
        {
          x: slice.tile.col,
          y: slice.tile.row,
          cell: SLICE_LETTERS.indexOf(slice.name) * 2 + lut,
        },
        slice.mode === 'RAMW'
          ? 'this slice is the WRITE PORT of a distributed memory (MODE RAMW): it carries the memory’s write address, data, clock and enable to the two slices beside it rather than computing anything, so it is left out rather than read as logic'
          : 'distributed-RAM slice: the lookup-table storage is a memory written at run time, not a function of its inputs, and neither the write port nor the write clock is recovered — the value stored in it is only the memory’s power-up image, so it is left out rather than simulated as a lookup table',
      )

  return {
    cells,
    origin,
    netNames,
    clocks,
    unfaithful: collect('unfaithful'),
    undecoded: collect('undecoded'),
    incomplete: collect('incomplete'),
  }
}
