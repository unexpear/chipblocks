/**
 * FPGA fabric — Gowin (via Project Apicula): assemble the decoded pieces into a NETLIST.
 *
 * The decoders next door each answer one question about a bitstream — what a lookup table computes, what kind of
 * flip-flop a cell is, which wire drives which. Individually they describe a pile of parts. This joins them into
 * a graph: which cell feeds which, and where a signal enters the chip from a pin.
 *
 * THE HARD PART IS WIRE NAMING. A tile calls its own wires by local names, and the SAME physical wire has a
 * different name in every tile it passes through — a wire called `N111` in one tile is the same copper as a
 * differently-named wire one tile north. Joining connections without reconciling those names produces a graph
 * that looks plausible and is wrong. Apicula reconciles them with `wire2global`, transcribed here as
 * `gowinGlobalWire`: an inter-tile wire is named after the tile it ORIGINATES in, so two tiles referring to one
 * piece of copper arrive at the same name.
 *
 * Output is the SAME `RecoveredNetlist` shape the iCE40 and ECP5 paths produce, so a Gowin design reaches the
 * shared simulator through the seam those families already proved.
 */

import {
  decodeGowinBlockMemory,
  decodeGowinCarryCells,
  type GowinAttributeDatabase,
} from './fpga-apicula-attributes.ts'
import {
  decodeGowinFlipFlops,
  decodeGowinLuts,
  extractGowinTileBits,
  type GowinChipdb,
  gowinSegmentAt,
  gowinTileAt,
} from './fpga-apicula-chipdb.ts'
import {
  decodeGowinRouting,
  type GowinPipDatabase,
  type GowinTileRouting,
} from './fpga-apicula-routing.ts'
import type { CellRef, InputSource, RecoveredCell, RecoveredNetlist } from './fpga-icebox-run.ts'

const DIRECTIONS: Record<string, readonly [number, number]> = {
  N: [1, 0],
  E: [0, -1],
  S: [-1, 0],
  W: [0, 1],
}
const UTURN: Record<string, string> = { N: 'S', S: 'N', E: 'W', W: 'E' }

/**
 * Reconcile a tile-local wire name into one shared across every tile the wire touches — Apicula's `wire2global`.
 *
 * An inter-tile wire is named `<direction><number><segment>`, where the segment says how many tiles away the
 * wire STARTS. Walking that far in that direction gives the origin tile, and the wire is named after it. Wires
 * that would run off the edge of the die turn back on themselves, which is why a reflection is applied rather
 * than clamping — clamping would merge two distinct wires into one name.
 *
 * `row`/`col` are ONE-based here, matching Apicula's floorplanner convention.
 */
export function gowinGlobalWire(
  row: number,
  col: number,
  wire: string,
  rows: number,
  cols: number,
): string {
  if (wire === 'VCC' || wire === 'VSS') return wire
  const match = /^([NESW])([128]\d)(\d)/.exec(wire)
  if (match === null) return `R${row}C${col}_${wire}` // a wire local to this tile
  let direction = match[1] as string
  const number = match[2] as string
  const segment = Number.parseInt(match[3] as string, 10)

  const delta = DIRECTIONS[direction] as readonly [number, number]
  let rootRow = row + delta[0] * segment
  let rootCol = col + delta[1] * segment
  if (rootRow < 1) {
    rootRow = 1 - rootRow
    direction = UTURN[direction] as string
  }
  if (rootCol < 1) {
    rootCol = 1 - rootCol
    direction = UTURN[direction] as string
  }
  if (rootRow > rows) {
    rootRow = 2 * rows + 1 - rootRow
    direction = UTURN[direction] as string
  }
  if (rootCol > cols) {
    rootCol = 2 * cols + 1 - rootCol
    direction = UTURN[direction] as string
  }
  return `R${rootRow}C${rootCol}_${direction}${number}`
}

/**
 * Wire equivalences: one physical wire is named differently in each tile that can reach it, and the device
 * database records those groups. `gowinGlobalWire` reconciles the DIRECTIONAL wires by arithmetic; this table
 * covers the rest — chiefly the global clock network, where a clock hop is named `PCLKL1` in one tile, `SPINE16`
 * in another and `GT00` in a third. Without it a routed clock reads as several disconnected fragments.
 *
 * Apicula picks the SHORTEST name in a group as the canonical one, and so do we, so both agree on which name a
 * group collapses to.
 *
 * HONEST LIMIT: this does NOT join a cell's output wire (`F<n>`/`Q<n>`) as seen from a neighbouring tile. Those
 * names are absent from the table — checked, not assumed — so a lookup table's output referenced from the tile
 * next door still does not connect. That is what stands between here and naming a design's package pins.
 */
export function parseGowinWireAliases(text: string): Map<string, string> {
  const raw = JSON.parse(text) as Record<string, [number, number, string][]>
  const aliases = new Map<string, string>()
  for (const group of Object.values(raw)) {
    const sorted = [...group].sort((a, b) => a[2].length - b[2].length)
    let root: string | null = null
    for (const [row, col, wire] of sorted) {
      const name = `R${row + 1}C${col + 1}_${wire}`
      if (root === null) {
        root = name
        continue
      }
      aliases.set(name, root)
    }
  }
  return aliases
}

/**
 * The fixed per-tile equivalences the database does not list — Apicula builds these in code.
 *
 * A short hop between neighbouring tiles has a name from each end: the tile above calls it `N1x1`, the tile below
 * calls the same copper `S1x1`, and both are the tile's shared `SN{x}0`. The east–west pair works the same way.
 * These are pure geometry, which is presumably why they are generated rather than stored.
 *
 * They matter more than they look: without them a signal leaving a cell and entering its neighbour is two
 * unrelated wires, so a trace stops at the tile boundary.
 */
export function gowinFixedAliases(rows: number, cols: number): Map<string, string> {
  const aliases = new Map<string, string>()
  const global = (row: number, col: number, wire: string): string =>
    gowinGlobalWire(row, col, wire, rows, cols)
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++)
      for (const index of [1, 2]) {
        const northSouth = `R${row + 1}C${col + 1}_SN${index}0`
        aliases.set(global(row + 0, col + 1, `N1${index}1`), northSouth)
        aliases.set(global(row + 2, col + 1, `S1${index}1`), northSouth)
        const eastWest = `R${row + 1}C${col + 1}_EW${index}0`
        aliases.set(global(row + 1, col + 0, `W1${index}1`), eastWest)
        aliases.set(global(row + 1, col + 2, `E1${index}1`), eastWest)
      }
  return aliases
}

/** A lookup table recovered from a bitstream, with where it sits and what it computes. */
export type GowinLutCell = {
  ref: CellRef
  /** the tile position, ZERO-based as the grid stores it. */
  row: number
  col: number
  /** which lookup table within the tile: `LUT0`..`LUT7`. */
  bel: string
  /** the 16-entry truth table. */
  init: number
  /**
   * Whether THIS cell's flip-flop is in the data path.
   *
   * Decided from evidence about this cell's OWN outputs — not from the clock, which the fabric routes to a
   * whole PAIR of cells at once. See `gowinCellOutputUse`.
   *
   * False for a cell shown as two (`stored`): the recovered cell sitting at THIS ref is the straight-through
   * half, and the flip-flop is the second recovered cell rather than a property of this one.
   */
  registered: boolean
  /** the flip-flop variant (`DFF`, `DFFN`, `DFFR`, ...) when registered, else null. */
  flipFlop: string | null
  /**
   * The second recovered cell carrying this silicon cell's STORED result, when one cell is shown as two.
   *
   * Null for the ordinary case, where one recovered cell says everything there is to say about the silicon.
   */
  stored: { ref: CellRef; flipFlop: string } | null
  /** whether the cell is switched into arithmetic (carry) mode rather than plain lookup-table mode. */
  carry: boolean
  /** why this cell will not be described, when it will not be — null when it is described normally. */
  refusal: { kind: string; reason: string } | null
}

/**
 * How far a cell's STORED half sits from the cell itself, in tile positions.
 *
 * One silicon cell that both stores its result and passes it straight through becomes two recovered cells,
 * and two recovered cells cannot share one `{x, y, cell}` — every simulator, the canvas lowering and the
 * caveat markings key off exactly that triple, so a shared ref would silently keep only one of them.
 *
 * A Gowin slice column holds `LUT0`..`LUT7`, so position 8 is the first one no lookup table can occupy, and
 * the stored half sits eight positions above the cell it belongs to. That the chip really does stop at 7 is
 * not assumed — the device database is walked and every lookup-table position checked against it in
 * `fpga-gowin-pair-register.test.ts`, and a collision with a placed cell refuses the split outright rather
 * than overwriting anything.
 *
 * This is the convention the Nexus path already uses for the same problem: `fpga-oxide-netlist.ts` gives one
 * slice's carry pieces positions `8 + k`, `16 + k` and `24 + k` for exactly this reason, because one piece of
 * silicon needing several recovered cells is not peculiar to Gowin.
 *
 * The two halves stay in the same tile deliberately: everything that sorts recovered parts sorts by column,
 * then row, then position, so the stored half lands beside the cell it belongs to rather than across the die.
 *
 * WHAT THIS COSTS, stated because nothing downstream can work it out: a count of recovered cells is no longer
 * a count of the chip's lookup tables, and a position of 8 or more names no place on the silicon. `GowinDesign`
 * carries `split` so a caller can subtract, and `fpga-open.ts` — which is what turns a ref into "the logic part
 * at column 1, row 3, position 0" for the user — does not yet use it.
 */
export const GOWIN_STORED_HALF_OFFSET = 8

/** Where the stored half of a cell shown as two sits. */
export function gowinStoredHalfRef(ref: CellRef): CellRef {
  return { x: ref.x, y: ref.y, cell: ref.cell + GOWIN_STORED_HALF_OFFSET }
}

/** One choice a wide multiplexer picks between. */
export type GowinMuxInput =
  /** the plain output `F<index>` of a lookup table in the same tile. */
  | { kind: 'lut'; index: number }
  /** the output `OF<output>` of a lower multiplexer in the same tile. */
  | { kind: 'mux'; output: number }
  /** the output `OF<output>` of a multiplexer in the tile one column EAST. */
  | { kind: 'eastMux'; output: number }

/** One of the eight multiplexers a Gowin slice holds above its lookup tables. */
export type GowinWideMux = {
  /** the tile wire this multiplexer drives, `OF<output>`; its select is `SEL<output>`. */
  output: number
  /** the choice the multiplexer passes when its select reads 0. */
  low: GowinMuxInput
  /** the choice it passes when its select reads 1. */
  high: GowinMuxInput
  /** what the synthesiser calls a multiplexer in this position. */
  kind: string
}

/**
 * The WIDE MULTIPLEXERS a Gowin slice holds, which is how it computes a function of more than four inputs.
 *
 * A slice is not only eight lookup tables. Eight two-input multiplexers sit above them in a FIXED tree — hard
 * wiring, present on every slice, configured by nothing. This module had no notion of them at all, and that is
 * not an exotic gap: `synth_gowin` uses them BY DEFAULT (`-nowidelut` is the flag that turns them off), so a
 * plain user bitstream contains them. Every Gowin fixture in this repository predating them was built with
 * `-nowidelut`, which is why three adversarial audits of this file found nothing.
 *
 * Because the tree is not configured, the bitstream says a multiplexer is IN USE in two ways, and both are
 * ordinary routing: something takes a signal FROM its output wire `OF<n>`, and its select `SEL<n>` is routed.
 * An unrouted select is not floating — `SEL<n>`'s power-up source in the pip database is `VCC`, so it reads 1.
 *
 * WHERE THIS COMES FROM. The tree is transcribed from Project Apicula's own reader
 * (`apycula/gowin_unpack.py`, `make_muxes`), and every edge of it is confirmed against nextpnr's placement
 * record for the two bitstreams beside it: a bel named `X<x>Y<y>/MUX<k>` drives `OF<k>`, and its `I0`/`I1`/`S0`
 * nets are the ones named here. `low`/`high` rather than `I0`/`I1` because the direction is what matters and it
 * is easy to get backwards: `O = S0 ? I1 : I0`, from the `MUX2` model in the Gowin cell library yosys ships
 * (`share/yosys/gowin/cells_sim.v`).
 *
 * ORDERED BOTTOM-UP on purpose: walking this list in order visits a multiplexer only after everything it reads,
 * so one forward pass can decide the whole tree.
 */
export const GOWIN_WIDE_MUX_TREE: readonly GowinWideMux[] = [
  { output: 0, low: { kind: 'lut', index: 0 }, high: { kind: 'lut', index: 1 }, kind: 'MUX2_LUT5' },
  { output: 2, low: { kind: 'lut', index: 2 }, high: { kind: 'lut', index: 3 }, kind: 'MUX2_LUT5' },
  { output: 4, low: { kind: 'lut', index: 4 }, high: { kind: 'lut', index: 5 }, kind: 'MUX2_LUT5' },
  { output: 6, low: { kind: 'lut', index: 6 }, high: { kind: 'lut', index: 7 }, kind: 'MUX2_LUT5' },
  {
    output: 1,
    low: { kind: 'mux', output: 2 },
    high: { kind: 'mux', output: 0 },
    kind: 'MUX2_LUT6',
  },
  {
    output: 5,
    low: { kind: 'mux', output: 6 },
    high: { kind: 'mux', output: 4 },
    kind: 'MUX2_LUT6',
  },
  {
    output: 3,
    low: { kind: 'mux', output: 5 },
    high: { kind: 'mux', output: 1 },
    kind: 'MUX2_LUT7',
  },
  {
    output: 7,
    low: { kind: 'eastMux', output: 3 },
    high: { kind: 'mux', output: 3 },
    kind: 'MUX2_LUT8',
  },
]

/**
 * Where a tile's wide multiplexers sit, as recovered cells.
 *
 * The same problem the stored half has: several recovered parts come from one piece of silicon and none of them
 * may share a `{x, y, cell}` triple, because every map in every consumer is keyed by exactly that. Lookup
 * tables occupy 0..7 and stored halves 8..15 (`GOWIN_STORED_HALF_OFFSET`), so multiplexers start at 16 — the
 * multiplexer driving `OF<n>` sits at position `16 + n`, which keeps the numbering readable rather than
 * arbitrary. `fpga-oxide-netlist.ts` gives a Nexus slice's extra pieces positions `8 + k`, `16 + k`, `24 + k`
 * and `32 + k` for the same reason; one piece of silicon needing several recovered cells is not new here.
 *
 * WHAT THIS COSTS, the same as the stored half: a count of recovered cells is not a count of the chip's lookup
 * tables, and a position of 16 or more names no place on the silicon. `GowinDesign.wideMuxes` lists them so a
 * caller reporting a part count can subtract.
 */
export const GOWIN_WIDE_MUX_OFFSET = 16

/**
 * Where a BLOCK MEMORY sits, as the one position this decode gives it.
 *
 * A block memory is not a lookup table and is never recovered as one — it is refused, and the refusal has to
 * name a place. It occupies whole tiles of its own, so the position within the tile is free: 24 continues the
 * series above (lookup tables 0..7, stored halves 8..15, wide multiplexers 16..23) and, like those, names no
 * place the silicon has. `gowinPartPlace` turns it back into a sentence.
 */
export const GOWIN_BLOCK_MEMORY_OFFSET = 24

/** Where the refusal for the block memory whose MAIN tile is at `(x, y)` sits. */
export function gowinBlockMemoryRef(x: number, y: number): CellRef {
  return { x, y, cell: GOWIN_BLOCK_MEMORY_OFFSET }
}

/** The cell a block memory's MAIN tile declares, and the one its auxiliary tiles declare. */
export const GOWIN_BLOCK_MEMORY_BEL = 'BSRAM'
export const GOWIN_BLOCK_MEMORY_AUXILIARY_BEL = 'BSRAM_AUX'

/**
 * The tiles ONE block memory occupies: its main tile and the auxiliaries beside it.
 *
 * A block memory is wider than a tile, so the fabric gives it three: a main tile carrying the `BSRAM` cell and
 * two auxiliaries to its right carrying `BSRAM_AUX`. Which matters here because its data outputs are spread
 * across all three rather than confined to the main one.
 *
 * MEASURED, not assumed. On `GW1N-1` the grid holds four memories, at row 6 columns 2, 5, 14 and 17, and each
 * is followed by exactly two `BSRAM_AUX` tiles. `fixtures/gowin-gw1n1-bram1k.fs`, built by the real toolchain
 * around an EIGHT-bit-wide memory, routes six of its eight data bits to the main tile's `F0`..`F5` and the
 * other two to the FIRST AUXILIARY's `F0`/`F1` — which is what says the auxiliaries carry outputs at all.
 * `gowin_unpack` reading that same file names the main tile's `F0`..`F5` `DO0`..`DO5` and its `Q0`..`Q5`
 * `DO18`..`DO23`, so the third tile's six are a prediction from that pattern and nothing on hand exercises
 * them; a memory wider than twelve bits would.
 *
 * The row of six unattached `BSRAM_AUX` tiles at columns 8..13 belongs to no main tile and is never claimed:
 * the walk stops after two, so the memory at column 5 takes columns 6 and 7 and no more.
 */
export function gowinBlockMemoryTiles(
  main: { row: number; col: number },
  auxiliaryAt: (row: number, col: number) => boolean,
): { row: number; col: number }[] {
  const tiles = [{ row: main.row, col: main.col }]
  for (let step = 1; step <= 2; step++) {
    if (!auxiliaryAt(main.row, main.col + step)) break
    tiles.push({ row: main.row, col: main.col + step })
  }
  return tiles
}

/** Every wire a block memory can present a data output on, in one of its tiles. */
export const GOWIN_BLOCK_MEMORY_OUTPUTS: readonly string[] = [
  ...Array.from({ length: 6 }, (_, index) => `F${index}`),
  ...Array.from({ length: 6 }, (_, index) => `Q${index}`),
]

/**
 * Why a block memory is refused rather than recovered, in the words a user reads.
 *
 * The reason is not that reading one is hard. It is that two of the three things needed to say what it puts on
 * its outputs are not in reach: the shared recovered cell is a four-input lookup table with one flip-flop and
 * has no way to hold a memory at all, and WHICH of the memory's two ports is wired for reading and which for
 * writing cannot be told from the bits — the four tables that would say (`BSRAM_SP`, `_DP`, `_SDP`, `_ROM`)
 * cover byte-identical bit coordinates on this fabric, so all four decode for a memory that is only ever one
 * of them. That is stated and tested at `decodeGowinBlockMemory`.
 */
export const GOWIN_BLOCK_MEMORY_REFUSAL =
  'a block memory — a bank of memory built into the chip, which a design uses to hold data rather than to compute with. This reader does not read what one holds, and cannot tell from the chip file which of the memory’s two ports is wired for reading and which for writing, so what it puts on its data outputs cannot be said. It is left off the canvas entirely rather than shown as something it is not'

/** Where the recovered cell for the multiplexer driving `OF<output>` of a tile sits. */
export function gowinWideMuxRef(x: number, y: number, output: number): CellRef {
  return { x, y, cell: GOWIN_WIDE_MUX_OFFSET + output }
}

/**
 * Where a recovered Gowin part sits, as a person would say it.
 *
 * Positions 0..7 are the tile's eight lookup tables and can be said plainly. The ranges above them are
 * this decode's own bookkeeping — a stored half at `8 + n`, a wide multiplexer at `16 + n`, a block memory at
 * 24 — and naming any of those "position 23" points a user at a place the chip does not have. That is not a
 * cosmetic matter: these positions appear in the very warnings that tell someone a part is not to be trusted,
 * so the one sentence they have to act on named nowhere they could look.
 */
export function gowinPartPlace(ref: CellRef): string {
  const at = `column ${ref.x}, row ${ref.y}`
  if (ref.cell >= GOWIN_BLOCK_MEMORY_OFFSET) return `the block memory at ${at}`
  if (ref.cell >= GOWIN_WIDE_MUX_OFFSET)
    return `the wide multiplexer above the logic parts at ${at}`
  if (ref.cell >= GOWIN_STORED_HALF_OFFSET)
    return `the stored value of the logic part at ${at}, position ${ref.cell - GOWIN_STORED_HALF_OFFSET}`
  return `the logic part at ${at}, position ${ref.cell}`
}

/**
 * A two-input multiplexer as a four-input truth table: input 0 is the low choice, input 1 the high choice,
 * input 2 the select, input 3 unused. Entry `e` is the output when the inputs spell out `e`.
 */
export const GOWIN_WIDE_MUX_TRUTH: readonly boolean[] = Array.from({ length: 16 }, (_, entry) =>
  (entry & 4) === 0 ? (entry & 1) !== 0 : (entry & 2) !== 0,
)

/** A tile position as a map key — the tree crosses tiles, so a tile has to be nameable. */
const tileKey = (row: number, col: number): string => `${row},${col}`

/** One recovered cell as a map key — the distrust walk has to ask whether it has already reached a cell. */
const cellKey = (ref: CellRef): string => `${ref.x},${ref.y},${ref.cell}`

/**
 * What a wide multiplexer finds when it looks for one of the two lookup tables it picks between.
 *
 * The three cases are NOT interchangeable, and collapsing them is what made an ordinary design vanish. A
 * lookup table that is not there and one that this reader gave up on are both "no recovered cell", but the
 * first has a known value and the second does not.
 */
export type GowinMuxChoice =
  /** a recovered part drives it. */
  | { kind: 'cell'; driver: CellRef }
  /** no lookup table is programmed in that position — see `gowinBlankTableIsConstantOne`. */
  | { kind: 'unprogrammed' }
  /** a lookup table IS programmed there and this reader would not describe it. */
  | { kind: 'dropped' }

/**
 * A lookup table whose sixteen configuration bits are all ones outputs a ONE, and that is a value like any
 * other rather than an absence.
 *
 * The decode drops a table reading `0xffff` as erased, which is right for a blank tile and wrong under a wide
 * multiplexer: the multiplexer's two choices are HARD WIRED to `F<n>` of two fixed positions, so if the
 * multiplexer is in use, whatever those positions hold is what it picks between — and all-ones holds a 1.
 *
 * WHERE THIS COMES FROM — the tools that write and read the file, not an inference from ours. Project
 * Apicula's packer blows a fuse only where a bit of the table is ZERO (`apycula/gowin_pack.py`, `place_lut`:
 * `for bitnum, lutbit in enumerate(init[::-1]): if lutbit == '0': ...`), and its unpacker inverts exactly
 * that (`gowin_unpack.py`: `val = 0xffff - sum(1<<f for f in flags)`). A position with no fuse blown
 * therefore IS the table `0xffff`, which outputs 1 for every input — an unprogrammed position is not an
 * absent value, it is a 1.
 *
 * MEASURED as well as read. Two bitstreams differing in one constant were built by the real toolchain
 * (`fixtures/gowin-gw1n1-muxconst.v` and `-muxzero.v`, a `MUX2_LUT5` whose low choice is tied to `1'b1` and
 * to `1'b0`). yosys reduced each to a constant driver in the multiplexer's own slice, and `gowin_pack` wrote
 * the zero as sixteen zero bits and the one as no bits at all. Treating that as an absence refused the whole
 * multiplexer, marked its reader untrustworthy, invented a chip input, and erased hardware that had been read
 * perfectly well.
 */
export const gowinBlankTableIsConstantOne: InputSource = { kind: 'const', value: true }

/**
 * What ONE wide multiplexer becomes: the two choices it picks between, or the reason it will not be described.
 *
 * Pulled out as its own function for the reason `gowinOutputPlan` was: every branch can then be reached by
 * handing it inputs directly, including the ones a bitstream reaches only rarely.
 *
 * Refusing is the honest answer rather than a weaker one where it fires: a multiplexer whose choice was
 * DROPPED does not compute an approximation of the right function, it computes a different function, and the
 * reader could not tell which half was invented. But it is only honest where the value really is unknown,
 * which is why an unprogrammed table is a constant here and not a refusal.
 */
export function gowinWideMuxPlan(
  mux: GowinWideMux,
  lookupTable: (index: number) => GowinMuxChoice,
  lowerMux: (output: number, eastward: boolean) => CellRef | null,
): { inputs: [InputSource, InputSource]; refusal: null } | { inputs: null; refusal: string } {
  const resolve = (source: GowinMuxInput): InputSource | null => {
    if (source.kind !== 'lut') {
      const driver = lowerMux(source.output, source.kind === 'eastMux')
      return driver === null ? null : { kind: 'cell', driver, net: 0 }
    }
    const choice = lookupTable(source.index)
    if (choice.kind === 'dropped') return null
    if (choice.kind === 'unprogrammed') return gowinBlankTableIsConstantOne
    return { kind: 'cell', driver: choice.driver, net: 0 }
  }
  const low = resolve(mux.low)
  const high = resolve(mux.high)
  if (low === null || high === null)
    return {
      inputs: null,
      refusal:
        'a wide multiplexer, which is how this chip computes a function of more than four inputs: it chooses between two results, and one of those two is not recovered, so which value it passes cannot be said',
    }
  return { inputs: [low, high], refusal: null }
}

/**
 * Every multiplexer a design needs, from the ones whose output something reads.
 *
 * A multiplexer's output being read is the only direct evidence in the bitstream, and it is evidence about the
 * TOP of a chain: a design reading `OF3` is reading a seven-input function built from `OF1`, `OF5` and, below
 * those, four lookup tables. Nothing routes between them — the tree is hard wiring — so those lower
 * multiplexers leave no trace of their own and have to be closed over.
 *
 * `read` maps a tile (`"row,col"`, zero-based) to the outputs something takes a signal from in that tile.
 *
 * `onDevice` says whether a tile position exists at all. It is needed because the eight-input multiplexer
 * reaches EASTWARD, so a tile in the last column asks for one that is off the edge of the chip — and a caller
 * handed that position would describe parts at a place the silicon does not have, or refuse parts that were
 * never there. Apicula's own reader draws the same line (`gowin_unpack.py`, `make_muxes`: the eight-input
 * multiplexer is emitted only `if col < db.cols`).
 *
 * MEASURED, not assumed: on `gowin-gw1n1-widemux.fs` this closure produces exactly the eight multiplexers
 * nextpnr's placement record lists, and on `gowin-gw1n1-mux8.fs` exactly the fifteen — and in both cases
 * exactly the set whose selects Project Apicula's own reader shows routed.
 */
export function gowinWideMuxClosure(
  read: ReadonlyMap<string, readonly number[]>,
  onDevice: (row: number, col: number) => boolean,
): Map<string, Set<number>> {
  const needed = new Map<string, Set<number>>()
  const pending: { row: number; col: number; output: number }[] = []
  for (const [key, outputs] of read) {
    const parts = key.split(',')
    const row = Number.parseInt(parts[0] as string, 10)
    const col = Number.parseInt(parts[1] as string, 10)
    for (const output of outputs) pending.push({ row, col, output })
  }
  while (pending.length > 0) {
    const { row, col, output } = pending.pop() as { row: number; col: number; output: number }
    if (!onDevice(row, col)) continue
    const key = tileKey(row, col)
    let outputs = needed.get(key)
    if (outputs === undefined) {
      outputs = new Set<number>()
      needed.set(key, outputs)
    }
    if (outputs.has(output)) continue
    outputs.add(output)
    const mux = GOWIN_WIDE_MUX_TREE.find((entry) => entry.output === output)
    if (mux === undefined) continue
    for (const source of [mux.low, mux.high]) {
      if (source.kind === 'mux') pending.push({ row, col, output: source.output })
      if (source.kind === 'eastMux') pending.push({ row, col: col + 1, output: source.output })
    }
  }
  return needed
}

/**
 * Which destinations a tile type's routing takes from a cell's REGISTERED output by DEFAULT.
 *
 * A Gowin routing multiplexer has one source that no fuse selects: the state the fabric powers up in. Apicula
 * records it as a source with an empty bit list, and `decodeGowinRouting` deliberately drops those — reporting
 * every default arc would fill a blank device with connections it does not have.
 *
 * That suppression is what hides a register from the evidence below. On GW1N-1 `Q<n>` is the DEFAULT source of
 * several neighbouring multiplexers, so a design whose register drives one of them programs NO fuse for that
 * hop and the connection is invisible to a fuse-only decode. MEASURED against the place-and-route tool's own
 * placement record over ten designs built for this: of the 499 flip-flops it placed, only 203 put `Q<n>` on an
 * arc the fuse decode can see — the other 296 travelled on a default one and were invisible without this.
 *
 * A default arc is evidence only when it is still IN FORCE (its multiplexer was not programmed to some other
 * source) and something downstream actually reads the wire it feeds.
 */
export function gowinDefaultRegisterArcs(
  database: GowinPipDatabase,
): ReadonlyMap<number, ReadonlyMap<number, readonly string[]>> {
  return defaultArcsBySource(database, /^Q(\d+)$/)
}

/** Every unfused arc whose source name matches, grouped by tile type and then by the cell the source names. */
function defaultArcsBySource(
  database: GowinPipDatabase,
  source: RegExp,
): ReadonlyMap<number, ReadonlyMap<number, readonly string[]>> {
  const byTileType = new Map<number, Map<number, string[]>>()
  for (const [ttyp, tables] of database) {
    const byCell = new Map<number, string[]>()
    for (const table of [tables.pips, tables.clockPips])
      for (const [destination, sources] of table)
        for (const [name, bits] of sources) {
          if (bits.length !== 0) continue
          const match = source.exec(name)
          if (match === null) continue
          const cell = Number.parseInt(match[1] as string, 10)
          const list = byCell.get(cell)
          if (list === undefined) byCell.set(cell, [destination])
          else list.push(destination)
        }
    byTileType.set(ttyp, byCell)
  }
  return byTileType
}

/**
 * EVERY unfused arc out of a cell output — both `Q<n>` and `F<n>` — as a flat destination-to-source list.
 *
 * `gowinDefaultRegisterArcs` above covers only `Q<n>`, and only ever fed the question "is this cell's register
 * in use". The connections themselves need the other output as well, and need them in tiles that hold no
 * lookup table at all. Both omissions lost real wiring:
 *
 *  - `F<n>`. Of the 3,282 empty-bit arcs in the GW1N-1 database, 900 have an `F<n>` source; 896 of those land
 *    on the lookup-table input pins `A0..A7`, `B0..B7`, `C0..C7`, `D0..D7` OF THE SAME TILE, and 4 on the
 *    delay/clock wires `DLLDLY_IN` and `PCLK_DUMMY`. A lookup table feeding another in its own tile over the
 *    power-up arc leaves no fuse, so the trace stopped at the pin and offered a chip input in its place. On a
 *    seven-line design built for it (`gowin-gw1n1-passlut.v`), two such arcs were lost and the recovered
 *    netlist disagreed with Icarus Verilog on 56 of its 256 input vectors while reporting nothing wrong.
 *  - EVERY TILE, not only ones holding a lookup table. On the edge of the die `Q<n>` and `F<n>` are an I/O
 *    buffer's outputs rather than a logic cell's, and the placer routes through their power-up arcs just the
 *    same: in `gowin-gw1n1-longwire.fs` the wire `W260` of the bottom-edge tile at column 5 carries the input
 *    `a[2]` over exactly such an arc, and restricting the arcs to placed lookup tables reported that one
 *    package pin as two separate chip inputs.
 *
 * WHERE THIS COMES FROM. Apicula's reader emits these arcs — `apycula/gowin_unpack.py`, `parse_tile_` keeps a
 * source whose bit set is empty when nothing of that destination is programmed, and both call sites in
 * `gowin_unpack` leave that behaviour on. This is the same rule, read for both outputs.
 *
 * NOT INCLUDED, deliberately: the 512 empty-bit arcs whose source is `VCC` (`CLK0-2`, `LSR0-2`, `CE0-2`,
 * `SEL0-7` and some inter-tile wires). Reading those as connections would hold every unrouted set/reset high,
 * which is the opposite of what this decode says today, and nothing here establishes which is right.
 */
export function gowinDefaultCellOutputArcs(
  database: GowinPipDatabase,
): ReadonlyMap<number, readonly { destination: string; source: string }[]> {
  const registerArcs = defaultArcsBySource(database, /^Q(\d+)$/)
  const lutArcs = defaultArcsBySource(database, /^F(\d+)$/)
  const byTileType = new Map<number, { destination: string; source: string }[]>()
  for (const ttyp of database.keys()) {
    const arcs: { destination: string; source: string }[] = []
    for (const [output, table] of [
      ['Q', registerArcs],
      ['F', lutArcs],
    ] as const)
      for (const [cell, destinations] of table.get(ttyp) ?? [])
        for (const destination of destinations)
          arcs.push({ destination, source: `${output}${cell}` })
    byTileType.set(ttyp, arcs)
  }
  return byTileType
}

/**
 * Which end of a LONG WIRE drives it — or why that cannot be said.
 *
 * `LB01`..`LB71` are read all over the fabric and are a pip destination nowhere, so a fuse-only decode walks
 * into one and finds nothing behind it. What is behind it is a multiplexer at ONE END of the wire's column,
 * and `GowinSegment` says which two tiles those are. An end drives the wire when its own multiplexer is
 * programmed, and that is the whole rule: the fuses decide, nothing is inferred from what would be convenient.
 *
 * Pulled out as its own function for the reason `gowinOutputPlan` and `gowinWideMuxPlan` were: the two answers
 * that no bitstream in this repository produces — no end switched on, and both switched on — can then be
 * reached by handing it inputs directly, rather than being carried by an argument that they cannot happen.
 *
 * REFUSING is the honest answer where it fires. A long wire with no driver this reader can name is not a chip
 * input, and offering one puts a switch on the canvas the silicon does not have; the caller records the wire
 * so that everything reading it is marked untrustworthy instead of left looking ordinary.
 */
export function gowinLongWirePlan(
  segment: {
    column: number
    topRow: number
    bottomRow: number
    topWire: string
    bottomWire: string
  } | null,
  driven: (row: number, col: number, wire: string) => boolean,
):
  | { end: { row: number; col: number; wire: string }; refusal: null }
  | { end: null; refusal: string } {
  if (segment === null)
    return { end: null, refusal: 'no long wire of this chip reaches that part of the fabric' }
  const ends = [
    { row: segment.topRow, col: segment.column, wire: segment.topWire },
    { row: segment.bottomRow, col: segment.column, wire: segment.bottomWire },
  ].filter((end) => driven(end.row, end.col, end.wire))
  if (ends.length === 1)
    return { end: ends[0] as { row: number; col: number; wire: string }, refusal: null }
  return {
    end: null,
    refusal:
      ends.length === 0
        ? 'neither end of that long wire is switched on, so nothing this reader can see drives it'
        : 'both ends of that long wire are switched on, so which of them drives it cannot be said',
  }
}

/** What a cell's two outputs are being used for, which is what says whether its flip-flop is in the design. */
export type GowinOutputUse = {
  /** the lookup table's own output `F<n>` drives something. */
  combinational: boolean
  /** the flip-flop's output `Q<n>` drives something. */
  registered: boolean
}

/**
 * The default arcs out of one cell's `Q<n>` that are still IN FORCE — nothing programmed their
 * multiplexer to some other source, so the register's value really is on those wires.
 *
 * Pulled out because two separate questions need the same list and had drifted apart: "is this cell's
 * register output used at all" (below) and "can the recovered logic reach it" (the backward walk in
 * `reconstructGowinNetlist`). The second was answered from fused arcs alone, so a register whose only
 * route out is a default arc looked unused there while looking used here — and that disagreement is
 * what let a cell whose two outputs are BOTH read reach the netlist as if there were nothing to weigh.
 */
export function gowinInForceDefaultArcs(
  index: number,
  routing: GowinTileRouting,
  defaultArcs: ReadonlyMap<number, readonly string[]>,
): string[] {
  const inForce: string[] = []
  for (const destination of defaultArcs.get(index) ?? []) {
    if (routing.pips.has(destination) || routing.clockPips.has(destination)) continue
    inForce.push(destination)
  }
  return inForce
}

/**
 * Which of ONE cell's outputs the bitstream actually uses.
 *
 * This is the per-cell evidence that replaces the old pair-level clock test. Cells 2k and 2k+1 share a clock,
 * a clock-enable and a set/reset line, so "a clock reaches this cell's pair" says nothing about which HALF of
 * the pair holds the register — and a placer routinely fills the other half with unrelated combinational logic.
 * Reading the clock as per-cell evidence gave that half a flip-flop it does not have.
 *
 * A cell's two outputs are separate wires, and the routing says which one is driving something:
 *   - `Q<n>` drives something -> the flip-flop is in the data path;
 *   - `F<n>` drives something -> the lookup table's own output is in the data path.
 * A default (unfused) arc out of `Q<n>` counts, but only where it is still in force and its wire is read —
 * see `gowinDefaultRegisterArcs`.
 *
 * `routedSources` is every wire the tile's decoded pips take a signal FROM; `readWires` is every wire read
 * anywhere on the device, in global names.
 */
export function gowinCellOutputUse(
  index: number,
  routedSources: ReadonlySet<string>,
  routing: GowinTileRouting,
  defaultArcs: ReadonlyMap<number, readonly string[]>,
  readWires: ReadonlySet<string>,
  globalWire: (wire: string) => string,
): GowinOutputUse {
  let registered = routedSources.has(`Q${index}`)
  if (!registered)
    for (const destination of gowinInForceDefaultArcs(index, routing, defaultArcs))
      if (readWires.has(globalWire(destination))) registered = true
  return { combinational: routedSources.has(`F${index}`), registered }
}

/**
 * How each Gowin flip-flop variant maps onto the shared cell's set/reset flags.
 *
 * `N` means a falling-edge clock. That is NOT a set/reset property, so it does not live here — it is carried by
 * `GOWIN_FALLING_EDGE` and lands on the recovered cell's `negClk`, which the shared simulator clocks in its
 * second half-cycle.
 */
const FLIP_FLOP_FLAGS: ReadonlyMap<string, { setNoReset: boolean; asyncSetReset: boolean }> =
  new Map([
    ['DFF', { setNoReset: false, asyncSetReset: false }],
    ['DFFN', { setNoReset: false, asyncSetReset: false }],
    ['DFFR', { setNoReset: false, asyncSetReset: false }],
    ['DFFNR', { setNoReset: false, asyncSetReset: false }],
    ['DFFS', { setNoReset: true, asyncSetReset: false }],
    ['DFFNS', { setNoReset: true, asyncSetReset: false }],
    ['DFFC', { setNoReset: false, asyncSetReset: true }],
    ['DFFNC', { setNoReset: false, asyncSetReset: true }],
    ['DFFP', { setNoReset: true, asyncSetReset: true }],
    ['DFFNP', { setNoReset: true, asyncSetReset: true }],
  ])

/**
 * The LEVEL-SENSITIVE latch variants.
 *
 * A latch is transparent while its enable is high; the shared cell can only describe an edge-triggered
 * flip-flop. Rather than emit one that looks identical to a plain register — which is what this did before —
 * a cell configured as a latch is REFUSED, the same way a falling-edge one would be.
 */
export const GOWIN_LATCH_KINDS: ReadonlySet<string> = new Set([
  'DL',
  'DLN',
  'DLC',
  'DLNC',
  'DLP',
  'DLNP',
])

/**
 * The variants that clock on the FALLING edge.
 *
 * This set used to be declared and read by NOTHING: the netlist emitted a falling-edge register as an ordinary
 * rising-edge one, which reports a design a full half-period out of step with the silicon. It is now what sets
 * `negClk` on the recovered cell, and `simulateClocked` runs a second phase per cycle for exactly those cells.
 *
 * Kept as a set of NAMES rather than a flag on `FLIP_FLOP_FLAGS` because the name is what the fuse decode
 * produces; the test that walks both tables together is what stops the two drifting apart.
 */
export const GOWIN_FALLING_EDGE: ReadonlySet<string> = new Set([
  'DFFN',
  'DFFNR',
  'DFFNS',
  'DFFNC',
  'DFFNP',
])

/** What a cell that drives BOTH of its outputs into recovered logic becomes. */
export type GowinOutputPlan = {
  /** show this one silicon cell as TWO recovered cells: the straight-through half and the stored half. */
  split: boolean
  /** why the cell will not be described at all — null whenever it will be. */
  refusal: { kind: string; reason: string } | null
}

/** Nothing to weigh: one recovered cell says everything there is to say about this silicon cell. */
const PLAIN_CELL: GowinOutputPlan = { split: false, refusal: null }

/**
 * How to describe a cell that presents its lookup table on `F<n>` and its stored value on `Q<n>` at once.
 *
 * A `RecoveredCell` has exactly one output, so for a long time a cell whose two outputs were BOTH read by
 * logic this path recovered was refused: emitting it as a register hands the straight-through reader a value a
 * cycle late, emitting it combinationally hands the stored-value reader the wrong value entirely. Refusing was
 * the honest answer to that pair of wrong ones, and it was still an answer that ERASED REAL HARDWARE — the
 * cell vanished from the canvas and every part that read it was handed an invented input in its place. On the
 * ten-part design that prompted this, four of ten parts were compromised by it.
 *
 * There is a third answer, and it is not an approximation: the silicon really is a lookup table AND a
 * flip-flop beside it fed by that same lookup table (Apicula's own reader writes it out that way — the
 * flip-flop's `D` is wired straight to the lookup table's `F`). So one cell becomes two recovered cells taking
 * the SAME four inputs: one combinational, carrying the lookup table's result, and one registered, whose
 * stored value is that result. Readers of `F<n>` point at the first, readers of `Q<n>` at the second, and
 * every reader gets the value the chip gives it.
 *
 * When only ONE of the two outputs reaches recovered logic there is nothing to weigh at all: the other wire
 * leaves the chip through a pin, a pin is not part of the netlist, and one recovered cell serves everything —
 * so no split is made and the cell is emitted exactly as it was before.
 *
 * REFUSAL SURVIVES for the cases a split cannot describe. A level-sensitive latch is see-through while its
 * enable is high rather than edge-triggered, so the stored half would be a flip-flop the chip does not have; a
 * position with no flip-flop of its own has no stored half to show; and a stored half whose place is already
 * occupied by another lookup table of the same tile cannot be given an identity of its own without
 * overwriting a real part.
 *
 * NOTHING HERE IS DECIDED ELSEWHERE. Every condition that can stop a split is a parameter, so the whole rule
 * can be taken apart one condition at a time on inputs built by hand — which is the only way to check the two
 * that no bitstream in this repository reaches (a latch, and an occupied stored-half place on a device whose
 * lookup-table positions stop at 7).
 */
export function gowinOutputPlan(
  pairClocked: boolean,
  combinationalInside: boolean,
  registeredInside: boolean,
  flipFlop: string | null,
  /** the cell is switched into arithmetic mode, and so is refused downstream for its own reason. */
  arithmetic: boolean,
  storedHalfFree: boolean,
): GowinOutputPlan {
  if (!pairClocked) return PLAIN_CELL
  if (!combinationalInside || !registeredInside) return PLAIN_CELL
  // An arithmetic cell never reaches the netlist — its output is the lookup table XOR the carry coming in,
  // which the shared cell cannot express, and it is refused with that more specific reason further on. Splitting
  // it would record a second part for a cell the canvas does not show at all.
  if (arithmetic) return PLAIN_CELL
  if (flipFlop !== null && GOWIN_LATCH_KINDS.has(flipFlop))
    return {
      split: false,
      refusal: {
        kind: flipFlop,
        reason: 'level-sensitive latch: transparent while enabled, not edge-triggered',
      },
    }
  if (flipFlop === null || !FLIP_FLOP_FLAGS.has(flipFlop))
    return {
      split: false,
      refusal: {
        kind: 'split-output',
        reason:
          'this cell both stores its result and passes it straight through, and other parts of this design read each one — showing the stored one as its own part needs a flip-flop, and this position holds none the reader can name',
      },
    }
  if (!storedHalfFree)
    return {
      split: false,
      refusal: {
        kind: 'split-output',
        reason:
          'this cell both stores its result and passes it straight through, and other parts of this design read each one — the stored one would have to be shown as its own part, and the place for it is already taken by another part of this chip',
      },
    }
  return { split: true, refusal: null }
}

/** What a Gowin bitstream was found to contain. */
export type GowinDesign = {
  netlist: RecoveredNetlist
  cells: GowinLutCell[]
  /** global wire -> the global wire driving it, across the whole device. */
  drivers: Map<string, string>
  /**
   * The external wire each primary-input net stands for. A trace that ends at a wire with no driver has reached
   * something outside the recovered logic — an I/O buffer, or a cell kind this path does not model — so the wire
   * becomes a primary input. Naming it here is what keeps that honest: the design is not claimed to start from
   * nowhere, and a caller can see exactly which piece of copper each input is.
   */
  primaryWires: Map<number, string>
  /**
   * Cells the bitstream configures that this path will NOT describe, with the reason.
   *
   * Emitting an approximation would be worse than omitting the cell: an arithmetic cell rendered as a plain
   * lookup table computes a different function, and a latch rendered as a flip-flop samples on an edge that the
   * hardware does not have. Both look entirely reasonable in a netlist.
   */
  unsupported: { ref: CellRef; kind: string; reason: string }[]
  /**
   * Cells that ARE described, but whose description leaves out something the silicon holds.
   *
   * A cell can drive its plain result and its stored result at once. When the recovered design reads only the
   * plain one, that is the one the single recovered output has to carry — the flip-flop is real but nothing in
   * the recovered design would read it. Dropping the cell instead was measured to erase whole designs, and
   * dropping the flip-flop WITHOUT saying so would leave the reader believing the recovery was complete. So the
   * cell is kept, correct for every reader it has, and the omission is stated here.
   */
  partial: { ref: CellRef; kind: string; reason: string }[]
  /**
   * Cells that ARE described and whose value must NOT be trusted, because one of their inputs is invented.
   *
   * A cell this path refuses leaves the wire it drove with nothing driving it, and the trace that walks into
   * that wire mints a chip input — a switch on the canvas the silicon does not have, feeding a part that
   * therefore computes something the chip does not. Refusing the one cell and saying nothing about the parts
   * that read it flags the cell that is right and leaves the ones that are wrong looking ordinary.
   */
  distrusted: { ref: CellRef; kind: string; reason: string }[]
  /**
   * The silicon cells shown as TWO recovered cells — one carrying the lookup table's result, one carrying the
   * value the flip-flop beside it holds. See `gowinOutputPlan`.
   *
   * Listed because a count of recovered cells is no longer a count of the chip's lookup tables: a design with
   * three of these puts three more parts on the canvas than the chip has cells. Nothing on the netlist itself
   * can say so — `RecoveredNetlist` has no field for it — so any caller reporting a part count needs this list
   * to subtract, and the seam is stated here rather than left for the count to be quietly wrong.
   */
  split: { ref: CellRef; storedRef: CellRef }[]
  /**
   * The WIDE MULTIPLEXERS this design uses, each shown as its own recovered cell — see `GOWIN_WIDE_MUX_TREE`.
   *
   * Listed for the same reason `split` is: these are recovered cells that are not lookup tables, so a caller
   * counting parts and calling the total "lookup tables the chip uses" would be wrong by exactly this many.
   */
  wideMuxes: { ref: CellRef; output: number; kind: string }[]
}

/** The four data inputs of a Gowin lookup table, in truth-table bit order. */
const LUT_PINS = ['A', 'B', 'C', 'D'] as const

/**
 * Whether a truth table's output actually changes with one of its inputs.
 *
 * A four-input cell used as a two-input gate leaves two pins doing nothing, and the fabric still routes SOMETHING
 * to them. Reporting those as chip inputs would invent signals the design does not have — the XNOR test design
 * has two real inputs and would otherwise claim four.
 */
function dependsOnInput(truth: readonly boolean[], pin: number): boolean {
  for (let entry = 0; entry < 16; entry++) {
    if (((entry >> pin) & 1) !== 0) continue
    if (truth[entry] !== truth[entry | (1 << pin)]) return true
  }
  return false
}

/**
 * Rebuild the logical netlist from a Gowin bitstream.
 *
 * Walks every tile, keeps the lookup tables that are not blank, and resolves each of their four inputs by
 * following the routing backwards through global wire names until it reaches another cell's output (`F<n>` for
 * a lookup table, `Q<n>` for a flip-flop) or runs out of routing.
 *
 * An input whose trace runs out becomes a primary input NAMED after the wire it stopped at, recorded in
 * `primaryWires`. Naming it is the point: an anonymous primary would let a decoding failure and a genuine chip
 * input look identical. One wire feeding several pins becomes ONE net, so fan-out survives the trace.
 */
export function reconstructGowinNetlist(
  frames: readonly (readonly boolean[])[],
  db: GowinChipdb,
  pipdb: GowinPipDatabase,
  // REQUIRED, not defaulted. It used to default to null, and with null nothing is refused — the adder came
  // back as 34 ordinary cells instead of 16 plus 18 refusals, silently simulating arithmetic cells as plain
  // lookup tables. A safety measure that can be skipped by omitting an argument is not a safety measure.
  attributes: GowinAttributeDatabase,
  aliases: ReadonlyMap<string, string> | null = null,
): GowinDesign {
  // Reconcile a tile-local name into the one every tile agrees on: first the arithmetic for directional wires,
  // then the database's equivalence groups. The alias walk is bounded — a malformed table could otherwise cycle.
  const globalWire = (row: number, col: number, wire: string): string => {
    let name = gowinGlobalWire(row, col, wire, db.rows, db.cols)
    for (let hop = 0; hop < 8 && aliases !== null; hop++) {
      const next = aliases.get(name)
      if (next === undefined || next === name) break
      name = next
    }
    return name
  }

  // Reconciliation for READING EVIDENCE, which is deliberately not the caller's.
  //
  // `aliases` is optional because a caller may want to see how fragmented the wiring is without it — a shipped
  // test measures exactly that. But whether a cell holds a register is a fact about the silicon, not a
  // reporting preference, and the evidence for it is "does anything read this wire", which needs the names
  // reconciled. So the geometric identities are ALWAYS applied here (they are pure arithmetic on the die size,
  // not a database), with the caller's table layered on top when there is one. Without this the verdict changed
  // with an optional argument: one real register in my corpus came back combinational when the table was
  // omitted, which is the wrong answer in the other direction.
  const fixedAliases = gowinFixedAliases(db.rows, db.cols)
  const evidenceWire = (row: number, col: number, wire: string): string => {
    let name = gowinGlobalWire(row, col, wire, db.rows, db.cols)
    for (let hop = 0; hop < 8; hop++) {
      const next = aliases?.get(name) ?? fixedAliases.get(name)
      if (next === undefined || next === name) break
      name = next
    }
    return name
  }

  // 1. every routed connection, in global wire names
  const drivers = new Map<string, string>()
  // The same connections under the always-reconciled names the evidence is read through, so that walking them
  // answers "does the DESIGN read this wire" rather than "does it read it under the caller's naming".
  const evidenceDrivers = new Map<string, string>()
  // Every wire that something takes a signal FROM, anywhere on the device. A cell's output counts as USED when
  // it reaches this set, which is what tells one half of a clocked pair from the other.
  const readWires = new Set<string>()
  // Per tile, the wide-multiplexer outputs something takes a signal FROM. That is the whole of the direct
  // evidence for a wide multiplexer: the tree above the lookup tables is hard wiring, so a multiplexer leaves
  // no fuse of its own — see `GOWIN_WIDE_MUX_TREE`.
  const readMuxOutputs = new Map<string, number[]>()
  // Every tile's decoded switches, kept rather than decoded again. Two later passes need the same answer, and
  // the long-wire join below needs a tile's switches while standing in a DIFFERENT tile — which decoding tile
  // by tile cannot serve at all.
  const tileRouting = new Map<string, GowinTileRouting>()
  // The long branches something takes a signal from: tile -> the branch indices read there. `LB<n>1` is never a
  // pip destination anywhere in the database, so nothing in this pass can say what drives one.
  const readLongBranches = new Map<string, Set<number>>()
  // The arcs no fuse selects, gathered while each tile's switches are in hand: destination wire -> the wire
  // its multiplexer powers up reading. Only where that multiplexer was left alone — a programmed one overrides
  // its power-up source. Filtered against the fused connections once every tile has been walked, because two
  // tiles' local names can reconcile to one global wire.
  const defaultArcCandidates: { row: number; col: number; destination: string; source: string }[] =
    []
  // The tiles of a BLOCK MEMORY this file programs — main tiles and auxiliary tiles alike, kept apart and
  // joined below.
  //
  // A memory leaves its settings in the same attribute tables everything else does, so recognising one costs
  // nothing beyond reading them — and it is the only thing that stands between a block-memory design and a
  // report saying nothing is wrong with it. Gathered here rather than in the lookup-table pass below because
  // that pass skips a tile with no lookup tables in it, which is every tile a memory sits in.
  const blockMemoryCandidates: { row: number; col: number }[] = []
  const blockMemoryProgrammed = new Set<string>()
  const cellOutputArcs = gowinDefaultCellOutputArcs(pipdb)
  for (let row = 0; row < db.rows; row++)
    for (let col = 0; col < db.cols; col++) {
      const tile = gowinTileAt(db, row, col)
      if (tile === null) continue
      const bits = extractGowinTileBits(frames, db, row, col)
      if (bits === null) continue
      if (tile.bels.includes(GOWIN_BLOCK_MEMORY_BEL)) blockMemoryCandidates.push({ row, col })
      if (
        (tile.bels.includes(GOWIN_BLOCK_MEMORY_BEL) ||
          tile.bels.includes(GOWIN_BLOCK_MEMORY_AUXILIARY_BEL)) &&
        decodeGowinBlockMemory(bits, attributes, tile.ttyp).size > 0
      )
        blockMemoryProgrammed.add(tileKey(row, col))
      const routing = decodeGowinRouting(bits, pipdb, tile.ttyp)
      tileRouting.set(tileKey(row, col), routing)
      for (const arc of cellOutputArcs.get(tile.ttyp) ?? []) {
        if (routing.pips.has(arc.destination) || routing.clockPips.has(arc.destination)) continue
        defaultArcCandidates.push({ row, col, ...arc })
      }
      for (const [destination, source] of [...routing.pips, ...routing.clockPips]) {
        const branch = /^LB(\d)1$/.exec(source)
        if (branch !== null) {
          const indices = readLongBranches.get(tileKey(row, col))
          const index = Number.parseInt(branch[1] as string, 10)
          if (indices === undefined) readLongBranches.set(tileKey(row, col), new Set([index]))
          else indices.add(index)
        }
        drivers.set(globalWire(row + 1, col + 1, destination), globalWire(row + 1, col + 1, source))
        const from = evidenceWire(row + 1, col + 1, source)
        evidenceDrivers.set(evidenceWire(row + 1, col + 1, destination), from)
        readWires.add(from)
        const muxOutput = /^OF(\d)$/.exec(source)
        if (muxOutput === null) continue
        const outputs = readMuxOutputs.get(tileKey(row, col))
        const output = Number.parseInt(muxOutput[1] as string, 10)
        if (outputs === undefined) readMuxOutputs.set(tileKey(row, col), [output])
        else outputs.push(output)
      }
    }

  const muxAt = (key: string): { row: number; col: number } => {
    const parts = key.split(',')
    return {
      row: Number.parseInt(parts[0] as string, 10),
      col: Number.parseInt(parts[1] as string, 10),
    }
  }

  // The LONG-WIRE hop, which no fuse in any tile records.
  //
  // A signal crossing the die on a long branch was a dead end: the trace walked into `LB<n>1`, found no driver
  // anywhere, and minted a chip input — so ONE piece of copper read in ten tiles became TEN chip inputs the
  // silicon does not have. Measured on `gowin-gw1n1-dense.fs`, whose source declares six ports: 236 chip
  // inputs, 189 of them long branches.
  //
  // The driver is not missing, it is somewhere else: the branch is fed from a multiplexer at one end of its
  // column, and `GowinSegment` says which end tile and which wire. That wire IS an ordinary pip destination,
  // so this only has to join the two and the existing walk does the rest.
  //
  // WHICH END drives it is decided by the fuses and nothing else: an end drives the branch when its own
  // multiplexer is programmed. Where that leaves no end or both, the answer is not known and is not guessed —
  // the wire is recorded as unresolved, the trace still mints a named chip input, and every part that reads it
  // is marked untrustworthy rather than left looking ordinary.
  //
  // Both namings get the edge, for the reason the power-up arcs below do. SAID PLAINLY: deleting the
  // `evidenceDrivers` line changes nothing measurable — the 24 bitstreams on hand come back byte-identical,
  // because no long wire on any of them decides whether a cell's register is in the data path. It is here
  // because the two maps disagreeing is the bug this file has already been bitten by twice, not because a
  // test can tell the difference.
  const unresolvedLongWires = new Map<string, string>()
  for (const [key, indices] of readLongBranches) {
    const { row, col } = muxAt(key)
    for (const index of indices) {
      const wire = `LB${index}1`
      const global = globalWire(row + 1, col + 1, wire)
      const plan = gowinLongWirePlan(gowinSegmentAt(db.segments, index, row, col), (r, c, w) => {
        const routing = tileRouting.get(tileKey(r, c))
        return routing !== undefined && (routing.pips.has(w) || routing.clockPips.has(w))
      })
      if (plan.end === null) {
        unresolvedLongWires.set(global, plan.refusal)
        continue
      }
      const end = plan.end
      drivers.set(global, globalWire(end.row + 1, end.col + 1, end.wire))
      evidenceDrivers.set(
        evidenceWire(row + 1, col + 1, wire),
        evidenceWire(end.row + 1, end.col + 1, end.wire),
      )
    }
  }

  const neededMuxes = gowinWideMuxClosure(
    readMuxOutputs,
    (row, col) => gowinTileAt(db, row, col) !== null,
  )

  const defaultRegisterArcs = gowinDefaultRegisterArcs(pipdb)

  // 2. every lookup table that is doing something, plus which of its outputs the design uses and whether the
  //    cell is switched into arithmetic mode
  //
  // Split in two: which of a cell's outputs MATTERS depends on what the rest of the recovered design reads, and
  // that is not known until every tile has been walked.
  type PlacedLut = {
    ref: CellRef
    row: number
    col: number
    bel: string
    init: number
    index: number
    /** a clock reaches the PAIR this cell belongs to — necessary for a register, never sufficient. */
    pairClocked: boolean
    use: GowinOutputUse
    variant: string | null
    carry: boolean
  }
  const placed: PlacedLut[] = []
  // The pins the recovered logic READS, in reconciled names. An output that reaches none of them leaves the
  // chip through a package pin, which is not part of the netlist, so choosing the cell's other output costs
  // the netlist nothing.
  //
  // ONE rule fills this: a wire belongs here only if the netlist this run emits really reads it. Three things
  // follow from that and each is applied below — an arithmetic cell is refused outright so it reads nothing, a
  // pin the truth table ignores is emitted as `unused` so it reads nothing, and a cell with no clock never
  // reads its set/reset or clock-enable. None of the ten Gowin bitstreams on hand changes verdict when any of
  // the three is dropped, so they are held by the rule, not by a test.
  const readPins = new Set<string>()
  for (let row = 0; row < db.rows; row++)
    for (let col = 0; col < db.cols; col++) {
      const tile = gowinTileAt(db, row, col)
      if (tile === null) continue
      const bits = extractGowinTileBits(frames, db, row, col)
      if (bits === null) continue
      const luts = decodeGowinLuts(bits, db, tile.ttyp)
      if (luts.size === 0) continue
      const routing = tileRouting.get(tileKey(row, col)) as GowinTileRouting
      const flipFlops = decodeGowinFlipFlops(bits, db, tile.ttyp)
      const carry = decodeGowinCarryCells(bits, attributes, tile.ttyp)
      const routedSources = new Set<string>()
      for (const [, source] of [...routing.pips, ...routing.clockPips]) routedSources.add(source)
      const tileArcs = defaultRegisterArcs.get(tile.ttyp) ?? new Map<number, readonly string[]>()
      for (const [bel, init] of luts) {
        if (init === 0xffff) continue // an erased lookup table is not part of the design
        const index = Number.parseInt(bel.slice(3), 10)
        // A flip-flop's MODE decodes even on a blank tile (the fabric's default is a settable flip-flop), so the
        // mode alone is NOT evidence the register is used. Neither is the CLOCK, which is what this used to
        // read: `CLK<pair>` serves cells 2k AND 2k+1, so a placer that puts a register in one half and unrelated
        // combinational logic in the other made the combinational half inherit its partner's flip-flop. MEASURED
        // against the placer's own record on ten designs I built: 154 of 2242 placed lookup tables were handed a
        // register the hardware does not have.
        //
        // What decides it per cell is which of the cell's OWN outputs the design uses.
        const pairClocked = routing.pips.has(`CLK${Math.floor(index / 2)}`)
        const isCarry = carry.includes(index)
        placed.push({
          ref: { x: col, y: row, cell: index },
          row,
          col,
          bel,
          init,
          index,
          pairClocked,
          use: gowinCellOutputUse(index, routedSources, routing, tileArcs, readWires, (wire) =>
            evidenceWire(row + 1, col + 1, wire),
          ),
          variant: flipFlops.get(`DFF${index}`) ?? null,
          carry: isCarry,
        })
        if (isCarry) continue
        const truth = Array.from({ length: 16 }, (_, entry) => ((init >> entry) & 1) === 1)
        for (let pin = 0; pin < 4; pin++)
          if (dependsOnInput(truth, pin))
            readPins.add(evidenceWire(row + 1, col + 1, `${LUT_PINS[pin]}${index}`))
        // Set/reset and clock-enable can be driven by ordinary logic, so they are pins of the design like any
        // other — for a cell that has a clock to read them with.
        if (!pairClocked) continue
        const pair = Math.floor(index / 2)
        readPins.add(evidenceWire(row + 1, col + 1, `LSR${pair}`))
        readPins.add(evidenceWire(row + 1, col + 1, `CE${pair}`))
      }
    }

  // A wide multiplexer reads wires too, and until this existed nothing recorded that it did.
  //
  // Its select is an input of the design like any lookup-table pin. Its two choices are lookup-table outputs
  // read over HARD WIRING rather than a routed arc, so the walk below — which follows routing — could never
  // find them on its own: a cell whose only reader is the multiplexer above it looked unread, and a clocked one
  // was then reported as a register whose stored value is all anything sees. Saying so here means the existing
  // rules decide it, rather than a second copy of them.
  for (const [key, outputs] of neededMuxes) {
    const { row, col } = muxAt(key)
    for (const mux of GOWIN_WIDE_MUX_TREE) {
      if (!outputs.has(mux.output)) continue
      readPins.add(evidenceWire(row + 1, col + 1, `SEL${mux.output}`))
      for (const source of [mux.low, mux.high])
        if (source.kind === 'lut') readPins.add(evidenceWire(row + 1, col + 1, `F${source.index}`))
    }
  }

  // The arcs a fuse decode CANNOT see, added as edges of the same graph.
  //
  // `evidenceDrivers` holds fused pips only. A register whose `Q<n>` leaves the cell on a default arc programs
  // no fuse for that hop, so the backward walk below stopped one wire short of it and reported the register as
  // unreachable from the recovered logic — while `gowinCellOutputUse`, reading the very same arcs, reported it
  // in use. `gowinDefaultRegisterArcs` above records how common that is; it left the split-output refusal able
  // to fire only for the minority of registers whose `Q<n>` happens to travel a fused arc.
  //
  // Two namings because the two consumers are named differently: the evidence walk always reconciles wire
  // names, the caller's trace uses the caller's table. Same arcs, so a cell cannot be reachable in one and not
  // the other.
  // A multiplexer that WAS programmed overrides its power-up source, so a wire the fuse decode already has a
  // driver for never takes a default one. Enforced HERE, once, rather than at each lookup: the two maps then
  // share no wire, and which of them a walk consults first cannot change an answer.
  //
  // Which arcs those are is `gowinDefaultCellOutputArcs`, and it is read over EVERY tile: the two omissions
  // that hid real wiring — the cell's plain output, and tiles holding an I/O buffer rather than a lookup
  // table — are both stated there.
  //
  // SAID PLAINLY: the precedence is enforced twice over, here and again in the lookups (`drivers.get(wire) ??
  // defaultDrivers.get(wire)`), and no bitstream on hand can tell the two apart — dropping either of the two
  // conditions below, or dropping the in-force test where the candidates are gathered, leaves all 24 designs
  // byte-identical. They stay because a map named "arcs that are in force" holding arcs that are not is a
  // trap for the next reader of it, not because a test defends them.
  const defaultEvidenceDrivers = new Map<string, string>()
  const defaultDrivers = new Map<string, string>()
  for (const arc of defaultArcCandidates) {
    const evidenceName = evidenceWire(arc.row + 1, arc.col + 1, arc.destination)
    if (!evidenceDrivers.has(evidenceName) && !defaultEvidenceDrivers.has(evidenceName))
      defaultEvidenceDrivers.set(evidenceName, evidenceWire(arc.row + 1, arc.col + 1, arc.source))
    const callerName = globalWire(arc.row + 1, arc.col + 1, arc.destination)
    if (!drivers.has(callerName) && !defaultDrivers.has(callerName))
      defaultDrivers.set(callerName, globalWire(arc.row + 1, arc.col + 1, arc.source))
  }

  // Every wire from which one of those pins can be reached. Walking BACKWARDS from each pin is the same walk
  // `traceInput` makes, so a wire lands here exactly when the recovered netlist could arrive at it — and a wire
  // already in the set has had its whole upstream added, which is what keeps this linear and loop-safe.
  const feedsReadPin = new Set<string>()
  for (const pin of readPins) {
    let wire = pin
    while (!feedsReadPin.has(wire)) {
      feedsReadPin.add(wire)
      const next = evidenceDrivers.get(wire) ?? defaultEvidenceDrivers.get(wire)
      if (next === undefined) break
      wire = next
    }
  }

  const cells: GowinLutCell[] = []
  const partial: { ref: CellRef; kind: string; reason: string }[] = []
  const split: { ref: CellRef; storedRef: CellRef }[] = []
  const cellByOutput = new Map<string, CellRef>()
  // Every place in the fabric a lookup table of this design already sits, so a stored half can be given an
  // identity of its own without any chance of landing on top of one. Checked rather than reasoned about: a
  // stored half that collided would replace a real part in every map keyed by `{x, y, cell}`.
  const occupied = new Set(placed.map((lut) => `${lut.col},${lut.row},${lut.index}`))
  // Wires this chip really drives that the recovered netlist has no cell to point at. A trace that ends on one
  // of these does NOT reach a chip input, so minting a primary there invents a signal the silicon does not
  // have — and, until this existed, invented it in silence. Whatever read it is recorded below.
  //
  // `key` is what makes two entries the same loss when one part reads both of a dropped cell's wires; `place`
  // is the phrase the warning ends with. A long wire whose driving end could not be named belongs in this same
  // set and has no cell to name, which is why the entry carries a phrase rather than a `CellRef`.
  const droppedOutputs = new Map<string, { key: string; place: string; reason: string }>()
  for (const [wire, why] of unresolvedLongWires)
    droppedOutputs.set(wire, {
      key: `wire:${wire}`,
      place: `the long wire ${wire}`,
      reason: `a signal carried across the chip on a long wire, and ${why}`,
    })
  // The BLOCK MEMORIES this file programs, and the data outputs of each.
  //
  // A memory's tiles hold no lookup tables of any kind (`BSRAM` and `BSRAM_AUX` are the only cells their tile
  // types declare), so every one of those wires is a memory output and nothing else, and claiming them takes no
  // real part away.
  //
  // A memory is here when ANY of its three tiles carries a setting, not when its main tile does.
  //
  // Reading the main tile alone made a real memory INVISIBLE, and the evidence was in the file the whole time.
  // `gowin_pack` hands the same attribute set to all three tiles and each keeps the subset its own tile type
  // has bits for, so `MODE = ENABLE` — which `set_bsram_attrs` sets for every memory there is — lands in the
  // FIRST AUXILIARY on all three block-memory bitstreams here and on the main tile of none of them. And the
  // main tile's own share can come to nothing: `gowin_pack` writes a `CSA_i` only where bit `i` of the
  // `BLK_SEL` parameter is 0, so `BLK_SEL = 3'b111` writes none of the three.
  //
  // MEASURED on a bitstream built for exactly that — `fixtures/gowin-gw1n1-blkselhide.fs`, an `SP` primitive
  // with `BLK_SEL = 3'b111` which nextpnr places at `X4Y5/BSRAM`, its placement committed beside it. Main tile
  // `R6C5` decodes to NOTHING AT ALL; `R6C6` to `MODE`, `GSR` and four data widths; `R6C7` to four more data
  // widths. Before this the whole design read as `0 refused / 0 incomplete / 0 untrusted`, with eight of its
  // thirteen chip inputs standing on the memory's own tiles.
  const blockMemories = blockMemoryCandidates
    .map((main) => ({
      ref: gowinBlockMemoryRef(main.col, main.row),
      tiles: gowinBlockMemoryTiles(main, (row, col) =>
        (gowinTileAt(db, row, col)?.bels ?? []).includes(GOWIN_BLOCK_MEMORY_AUXILIARY_BEL),
      ),
    }))
    .filter((memory) =>
      memory.tiles.some((tile) => blockMemoryProgrammed.has(tileKey(tile.row, tile.col))),
    )
  // A block memory's data outputs are the one thing this reader refuses that must NOT become a chip input.
  //
  // Every other refusal leaves a wire whose driver is gone, and the trace mints a named primary there — honest,
  // because the user can at least drive it. For a memory that is a switch on a tile with no package pin
  // anywhere near it, one per data bit, and the design reads as an ordinary one with eight more inputs on it.
  // These wires are handed to `traceInput`, which stops on them and returns an `unreadable` source instead.
  const memoryOutputs = new Map<string, { key: string; place: string; reason: string }>()
  for (const memory of blockMemories) {
    const dropped = {
      key: `${memory.ref.x},${memory.ref.y},${memory.ref.cell}`,
      place: gowinPartPlace(memory.ref),
      reason: 'a value read out of a block memory, which is not on the canvas at all',
    }
    for (const tile of memory.tiles)
      for (const wire of GOWIN_BLOCK_MEMORY_OUTPUTS)
        memoryOutputs.set(globalWire(tile.row + 1, tile.col + 1, wire), dropped)
  }
  for (const lut of placed) {
    const { ref, row, col, index } = lut
    const combinationalInside = feedsReadPin.has(evidenceWire(row + 1, col + 1, `F${index}`))
    const registeredInside = feedsReadPin.has(evidenceWire(row + 1, col + 1, `Q${index}`))
    const storedRef = gowinStoredHalfRef(ref)
    const plan = gowinOutputPlan(
      lut.pairClocked,
      combinationalInside,
      registeredInside,
      lut.variant,
      lut.carry,
      !occupied.has(`${col},${row},${storedRef.cell}`),
    )
    const refusal = plan.refusal
    // One place decides. A cell holds a register when its pair is clocked (a flip-flop with no clock holds
    // nothing) and its OWN register output drives something — except where the recovered design reads the
    // straight-through output instead, in which case that is the output the single recovered cell must carry,
    // and the flip-flop is either shown as a second cell (`stored`) or said to be left out (`partial`).
    const registered =
      refusal === null && lut.pairClocked && lut.use.registered && !combinationalInside
    const flipFlop = registered ? lut.variant : null
    const stored = plan.split ? { ref: storedRef, flipFlop: lut.variant as string } : null
    if (stored !== null) split.push({ ref, storedRef })
    cells.push({
      ref,
      row,
      col,
      bel: lut.bel,
      init: lut.init,
      registered,
      flipFlop,
      stored,
      carry: lut.carry,
      refusal,
    })
    // The flip-flop is really there, the recovered design just reads past it. Said out loud rather than lost.
    //
    // Its stored output is deliberately NOT recorded as a dropped one below. Nothing in this netlist can be
    // reading it: a cell reaches this branch only when the walk found its `Q<n>` unreachable from every pin
    // the recovered logic reads, which is the same walk `traceInput` makes. Recording it would be a warning
    // that can never fire — mutation-checked, and it did not.
    //
    // A cell shown as TWO is excluded, and that exclusion is load-bearing: its flip-flop is not left out at
    // all, it is the second recovered cell, and saying otherwise would put a "something is missing" warning on
    // a part with nothing missing.
    if (
      !lut.carry &&
      refusal === null &&
      stored === null &&
      lut.pairClocked &&
      lut.use.registered &&
      !registered
    )
      partial.push({
        ref,
        kind: 'register-not-shown',
        reason:
          'this design reads this cell’s result directly, so that is what is shown — the cell also holds that result in a flip-flop, and nothing in the recovered design reads the held value, so the flip-flop is left out',
      })

    // A cell this path will REFUSE must not be registered as a driver. It used to be, and the consequence
    // was worse than the wrong answer refusing was meant to prevent: consumers kept `{kind:'cell'}` pointing
    // at a cell that never reached the netlist, the simulator resolves a missing driver to false, and the
    // recovered 4-bit adder became a constant-zero design with no inputs at all. Leaving the output wire
    // unclaimed makes `traceInput` dead-end there and mint a NAMED primary instead, which is both honest and
    // drivable.
    if (lut.carry || refusal !== null || (flipFlop !== null && GOWIN_LATCH_KINDS.has(flipFlop))) {
      // Both of its wires are now wires nothing in the netlist drives. That is exactly why the cell was
      // dropped, and it is also why every part that READ it is no better off than the part that vanished:
      // its input has been quietly replaced by an invented one.
      const dropped = {
        key: `${ref.x},${ref.y},${ref.cell}`,
        place: gowinPartPlace(ref),
        reason: 'the result of a part that could not be read, and so is not on the canvas at all',
      }
      droppedOutputs.set(globalWire(row + 1, col + 1, `F${index}`), dropped)
      droppedOutputs.set(globalWire(row + 1, col + 1, `Q${index}`), dropped)
      continue
    }

    cellByOutput.set(globalWire(row + 1, col + 1, `F${index}`), ref)
    // A registered cell also presents its stored value on `Q<n>`. Without this the trace dead-ends there
    // and the consumer becomes a phantom chip input reading zero — six of them in the block-memory design.
    // Only indexed when this tile really holds the cell: `Q<n>` on an edge tile is an I/O name, not a
    // register, and is pinned as such by the pin-mapping tests.
    //
    // For a cell shown as two, `Q<n>` belongs to the STORED half, and pointing readers of it there is the
    // whole point of splitting: the readers that used to be handed an invented chip input now read the value
    // the flip-flop actually holds. This is the consumer side of the change — without it the producer emits a
    // second cell nothing ever reads.
    if (stored !== null) cellByOutput.set(globalWire(row + 1, col + 1, `Q${index}`), stored.ref)
    else if (registered) cellByOutput.set(globalWire(row + 1, col + 1, `Q${index}`), ref)
  }

  // Refused FIRST, so that a design whose whole memory is refused says so however the passes below turn out.
  const unsupported: { ref: CellRef; kind: string; reason: string }[] = blockMemories.map(
    (memory) => ({
      ref: memory.ref,
      kind: GOWIN_BLOCK_MEMORY_BEL,
      reason: GOWIN_BLOCK_MEMORY_REFUSAL,
    }),
  )
  const primaryNets = new Map<string, number>()
  const primaryWires = new Map<number, string>()
  const recovered: RecoveredCell[] = []

  // 3. decide the wide multiplexers, so the trace below can reach one.
  //
  // Decided BEFORE any pin is resolved and built AFTER, in two halves, because the two orders conflict: a
  // lookup table's pin may be driven by a multiplexer, so `cellByOutput` must already name it; and a
  // multiplexer's select is an ordinary routed wire, so resolving it mints nets that belong after the lookup
  // tables' own. Splitting the pass is what lets both hold.
  //
  // A multiplexer whose choice is missing is REFUSED rather than approximated. Half a multiplexer is not a
  // weaker answer, it is a different function — and a refusal here propagates on its own: the tree is walked
  // bottom-up, so a refused multiplexer is simply absent when the one above it looks for it.
  const wideMuxes: { ref: CellRef; output: number; kind: string }[] = []
  const muxByOutput = new Map<string, CellRef>()
  const pendingMuxes: {
    ref: CellRef
    row: number
    col: number
    output: number
    inputs: [InputSource, InputSource]
  }[] = []
  // Which positions of which tile really hold a programmed lookup table. `placed` skips a table reading
  // `0xffff`, and a multiplexer above one has to tell that apart from a table this reader dropped — see
  // `gowinBlankTableIsConstantOne`.
  const programmedTables = new Set(placed.map((lut) => `${lut.col},${lut.row},${lut.index}`))
  for (const mux of GOWIN_WIDE_MUX_TREE)
    for (const [key, outputs] of neededMuxes) {
      if (!outputs.has(mux.output)) continue
      const { row, col } = muxAt(key)
      const ref = gowinWideMuxRef(col, row, mux.output)
      const plan = gowinWideMuxPlan(
        mux,
        (index) => {
          const driver = cellByOutput.get(globalWire(row + 1, col + 1, `F${index}`))
          if (driver !== undefined) return { kind: 'cell', driver }
          return programmedTables.has(`${col},${row},${index}`)
            ? { kind: 'dropped' }
            : { kind: 'unprogrammed' }
        },
        (output, eastward) =>
          muxByOutput.get(`${tileKey(row, eastward ? col + 1 : col)},${output}`) ?? null,
      )
      if (plan.inputs === null) {
        unsupported.push({ ref, kind: mux.kind, reason: plan.refusal as string })
        // The wire it drove is now a wire nothing in the netlist drives, so whatever READ it is about to be
        // handed a chip input the silicon does not have. Recorded here for the same reason a refused lookup
        // table's wires are: the cell that vanished is not the one the user is misled by.
        droppedOutputs.set(globalWire(row + 1, col + 1, `OF${mux.output}`), {
          key: `${ref.x},${ref.y},${ref.cell}`,
          place: gowinPartPlace(ref),
          reason: 'the result of a wide multiplexer that could not be read',
        })
        continue
      }
      wideMuxes.push({ ref, output: mux.output, kind: mux.kind })
      muxByOutput.set(`${tileKey(row, col)},${mux.output}`, ref)
      cellByOutput.set(globalWire(row + 1, col + 1, `OF${mux.output}`), ref)
      pendingMuxes.push({ ref, row, col, output: mux.output, inputs: plan.inputs })
    }

  // 4. resolve each input by following the routing backwards
  for (const cell of cells) {
    // Both fabrics index a 4-input truth table the same way — entry i is the output when the inputs spell out i
    // with input 0 as the least-significant bit — so the Gowin word maps straight onto the shared cell.
    const index = Number.parseInt(cell.bel.slice(3), 10)

    // An arithmetic cell's output is its lookup table XORed with the carry coming in, and the shared cell has no
    // way to say that — the carry inputs it does have are read only by the iCE40 path's own carry model. Copying
    // the lookup word alone yields a cell that computes the wrong function, so refuse it instead.
    if (cell.carry) {
      unsupported.push({
        ref: cell.ref,
        kind: 'carry',
        reason:
          'arithmetic mode: output is the lookup table XOR carry-in, which the shared cell cannot express',
      })
      continue
    }
    // A cell whose stored result AND plain result are both read by this design. Reported rather than guessed
    // either way, and reported AFTER the arithmetic check so an arithmetic cell keeps its own, more specific
    // reason.
    if (cell.refusal !== null) {
      unsupported.push({ ref: cell.ref, ...cell.refusal })
      continue
    }
    if (cell.flipFlop !== null && GOWIN_LATCH_KINDS.has(cell.flipFlop)) {
      unsupported.push({
        ref: cell.ref,
        kind: cell.flipFlop,
        reason: 'level-sensitive latch: transparent while enabled, not edge-triggered',
      })
      continue
    }

    const truth = Array.from({ length: 16 }, (_, entry) => ((cell.init >> entry) & 1) === 1)

    // Resolve every pin FIRST, unmasked. The carry unit reads its operands directly, independently of what the
    // lookup table does with them, so masking must not reach it — the same trap the iCE40 path hit, where a
    // carry-only cell computed the wrong sum because its operands were masked away as don't-cares.
    const resolved: InputSource[] = []
    for (let pin = 0; pin < 4; pin++) {
      const start = globalWire(cell.row + 1, cell.col + 1, `${LUT_PINS[pin]}${index}`)
      resolved.push(
        traceInput(
          start,
          drivers,
          defaultDrivers,
          cellByOutput,
          primaryNets,
          primaryWires,
          memoryOutputs,
        ),
      )
    }
    // A pin the truth table ignores is not an input to this design, whatever the fabric happens to route there.
    const inputs: InputSource[] = resolved.map((source, pin) =>
      dependsOnInput(truth, pin) ? source : { kind: 'unused' },
    )
    const flags = FLIP_FLOP_FLAGS.get(cell.flipFlop ?? '') ?? {
      setNoReset: false,
      asyncSetReset: false,
    }
    // The set/reset and clock-enable signals arrive on the tile's own wires, shared by each PAIR of cells the
    // same way the clock is. Without them the flags above can never fire: the shared simulator short-circuits a
    // cell whose `setReset` is absent, so a settable register would sit at zero however the design drove it.
    // Only report one when the bitstream actually ROUTES something to it. An unrouted set/reset means the
    // hardware default applies — no reset at all — and inventing a source would hold the register cleared. Same
    // for clock-enable, where an invented source would stop the register updating entirely.
    const pair = Math.floor(index / 2)
    const shared = (name: string): InputSource | null => {
      const wire = globalWire(cell.row + 1, cell.col + 1, name)
      if (!drivers.has(wire)) return null
      return traceInput(
        wire,
        drivers,
        defaultDrivers,
        cellByOutput,
        primaryNets,
        primaryWires,
        memoryOutputs,
      )
    }
    // For a cell shown as two these belong to the STORED half, which is the only one of the two that clocks.
    const holdsRegister = cell.registered || cell.stored !== null
    const setReset = holdsRegister ? shared(`LSR${pair}`) : null
    const clockEnable = holdsRegister ? shared(`CE${pair}`) : null
    const registerControls = {
      ...(setReset === null ? {} : { setReset }),
      ...(clockEnable === null ? {} : { clockEnable }),
    }
    // A carry chain runs upward through a tile, so a carry cell takes its carry-in from the cell below it. Cell 0
    // starts the tile's chain and has none — cross-tile cascade is not recovered, and is reported by its absence
    // rather than invented.
    const previous = cells.find(
      (other) =>
        other.carry &&
        other.row === cell.row &&
        other.col === cell.col &&
        other.ref.cell === cell.ref.cell - 1,
    )
    recovered.push({
      ref: cell.ref,
      config: {
        truth,
        carryEnable: cell.carry,
        dffEnable: cell.registered,
        setNoReset: flags.setNoReset,
        asyncSetReset: flags.asyncSetReset,
      },
      inputs,
      // A `DFFN*` samples half a period after a `DFF*` in the same design, so data crossing from one to the other
      // arrives in the SAME clock period. Emitting it as an ordinary flip-flop — which is what happened until the
      // fuse decode could tell a falling-edge register from a latch — reports the design a period slower than it
      // runs, and puts the wrong value on every wire in between.
      negClk: GOWIN_FALLING_EDGE.has(cell.flipFlop ?? ''),
      ...(cell.registered ? registerControls : {}),
      ...(cell.carry
        ? {
            carryIn: previous === undefined ? null : previous.ref,
            carryOperands: [resolved[0] as InputSource, resolved[1] as InputSource] as [
              InputSource,
              InputSource,
            ],
          }
        : {}),
    })

    // The STORED half of a cell shown as two: the flip-flop sitting beside that same lookup table.
    //
    // It takes the SAME four inputs rather than reading the half above, because that is what the silicon
    // does — Apicula's own reader writes the flip-flop's `D` wired straight to the lookup table's `F` — and
    // because a cell reading its own twin would add a dependency the evaluators do not need. As a register it
    // is a state boundary, so nothing here can close a combinational loop that the chip does not have: the
    // simulators return a flip-flop's stored value without evaluating its lookup table, and compute its next
    // value from the settled outputs of the cycle.
    //
    // The falling-edge clock, the set/reset and the clock-enable belong here and to nothing else — the
    // straight-through half above has no clock to read them with.
    const stored = cell.stored
    if (stored === null) continue
    const storedFlags = FLIP_FLOP_FLAGS.get(stored.flipFlop) ?? {
      setNoReset: false,
      asyncSetReset: false,
    }
    recovered.push({
      ref: stored.ref,
      config: {
        truth,
        carryEnable: false,
        dffEnable: true,
        setNoReset: storedFlags.setNoReset,
        asyncSetReset: storedFlags.asyncSetReset,
      },
      inputs: [...inputs],
      negClk: GOWIN_FALLING_EDGE.has(stored.flipFlop),
      ...registerControls,
    })
  }

  // 5. the wide multiplexers decided above, now that every lookup table has a resolved place in the netlist.
  //
  // The select is traced like any other pin. An unrouted select is NOT a missing signal: `SEL<n>`'s power-up
  // source in the pip database is `VCC`, so the multiplexer passes its high choice — and `traceInput` reads a
  // wire with no driver as a chip input, which would offer the user a switch the silicon does not have and
  // leave the value floating between the two choices. So an unrouted select is stated as the constant it is.
  for (const mux of pendingMuxes) {
    const select = globalWire(mux.row + 1, mux.col + 1, `SEL${mux.output}`)
    recovered.push({
      ref: mux.ref,
      config: {
        truth: [...GOWIN_WIDE_MUX_TRUTH],
        carryEnable: false,
        dffEnable: false,
        setNoReset: false,
        asyncSetReset: false,
      },
      inputs: [
        mux.inputs[0],
        mux.inputs[1],
        drivers.has(select)
          ? traceInput(
              select,
              drivers,
              defaultDrivers,
              cellByOutput,
              primaryNets,
              primaryWires,
              memoryOutputs,
            )
          : { kind: 'const', value: true },
        { kind: 'unused' },
      ],
      negClk: false,
    })
  }

  // Only report inputs the design actually reads. A pin resolved and then masked away as a don't-care left a
  // primary behind, which would overstate how many signals enter the chip.
  const referenced = new Set<number>()
  for (const cell of recovered) {
    for (const input of cell.inputs) if (input.kind === 'primary') referenced.add(input.net)
    for (const operand of cell.carryOperands ?? [])
      if (operand.kind === 'primary') referenced.add(operand.net)
    // Set/reset and clock-enable are inputs to the design too. Omitting them here deleted the very net a
    // register's set arrives on, so no caller could assert it and the pin report lost that package pin.
    for (const control of [cell.setReset, cell.clockEnable])
      if (control != null && control.kind === 'primary') referenced.add(control.net)
  }
  for (const net of [...primaryWires.keys()]) if (!referenced.has(net)) primaryWires.delete(net)

  // Every part that was handed an INVENTED input, named.
  //
  // Refusing a cell keeps a wrong answer off the canvas for that cell and does nothing at all for the parts
  // that read it: their trace runs into the wire the vanished cell drives, finds nothing driving it, and mints
  // a chip input. The result reads like an ordinary design with one more switch on it. Measured on a bitstream
  // built for this: the one cell that was RIGHT carried a warning and the two that were WRONG carried none.
  const distrusted: { ref: CellRef; kind: string; reason: string }[] = []
  const sourcesOf = (cell: RecoveredCell): (InputSource | null | undefined)[] => [
    ...cell.inputs,
    ...(cell.carryOperands ?? []),
    cell.setReset,
    cell.clockEnable,
  ]
  for (const cell of recovered) {
    const lost = new Map<string, { key: string; place: string; reason: string }>()
    const unreadable = new Map<string, { key: string; place: string; reason: string }>()
    for (const source of sourcesOf(cell)) {
      if (source == null) continue
      if (source.kind === 'primary') {
        const wire = primaryWires.get(source.net)
        const dropped = wire === undefined ? undefined : droppedOutputs.get(wire)
        if (dropped !== undefined) lost.set(dropped.key, dropped)
      }
      if (source.kind === 'unreadable') {
        const memory = memoryOutputs.get(source.wire)
        if (memory !== undefined) unreadable.set(memory.key, memory)
      }
    }
    if (lost.size > 0) {
      const places = [...lost.values()].map(({ place, reason }) => `${reason} (${place})`)
      distrusted.push({
        ref: cell.ref,
        kind: 'invented-input',
        reason: `${lost.size === 1 ? 'one of this part’s inputs is' : `${lost.size} of this part’s inputs are`} offered on the canvas as a switch you can set to 0 V or 5 V, and the real chip has no such switch: on the chip ${lost.size === 1 ? 'it carries' : 'they carry'} ${places.join(', and ')}`,
      })
    }
    if (unreadable.size === 0) continue
    // A pin fed by a refused block memory. Said separately from the invented-input warning above because the
    // two are different situations for the person reading them: this one has NO switch on the canvas, so there
    // is nothing they can do to explore it, and the pin simply reads 0 V whatever the memory really holds.
    const places = [...unreadable.values()].map(({ place, reason }) => `${reason} (${place})`)
    distrusted.push({
      ref: cell.ref,
      kind: 'unreadable-input',
      reason: `${unreadable.size === 1 ? 'one of this part’s inputs is' : `${unreadable.size} of this part’s inputs are`} ${places.join(', and ')}. There is no switch for ${unreadable.size === 1 ? 'it' : 'them'} on the canvas, because the real chip has none either: ${unreadable.size === 1 ? 'it reads' : 'they read'} 0 V here whatever the memory really holds, so what this part computes is not what the chip computes`,
    })
  }

  // And then EVERYTHING DOWNSTREAM of one of those parts.
  //
  // Distrust used to stop at the parts that read the missing thing directly, and a warning one level deep is
  // not a warning about the design. Measured before this walk existed, by flipping every fabricated switch of a
  // BLK_SEL=111 design and re-simulating: 41 parts changed value and carried NO warning, because they were
  // reading the direct readers rather than the memory. Their values were decided by a value that does not
  // exist, with nothing saying so. (`bram1k` recovers 18 cells in total, so it could never show a 32/16 split —
  // an earlier draft of this comment attributed another design's numbers to it.)
  //
  // A REGISTER is included rather than treated as a boundary. It stores what its inputs said, so a flip-flop
  // fed by a refused memory holds an invented value one cycle later just as surely as a gate carries it
  // immediately.
  const distrustedKeys = new Set(distrusted.map((entry) => cellKey(entry.ref)))
  const readers = new Map<string, RecoveredCell[]>()
  for (const cell of recovered)
    for (const source of sourcesOf(cell)) {
      if (source == null) continue
      if (source.kind !== 'cell' && source.kind !== 'carry') continue
      const key = cellKey(source.driver)
      const existing = readers.get(key)
      if (existing === undefined) readers.set(key, [cell])
      else existing.push(cell)
    }
  const queue = [...distrustedKeys]
  while (queue.length > 0) {
    const from = queue.pop() as string
    for (const cell of readers.get(from) ?? []) {
      const key = cellKey(cell.ref)
      if (distrustedKeys.has(key)) continue
      distrustedKeys.add(key)
      queue.push(key)
      distrusted.push({
        ref: cell.ref,
        kind: 'depends-on-untrusted',
        reason:
          'this part’s value is worked out from another part that is not to be trusted — follow its inputs back and one of them comes from something this reader could not read, such as a block memory. What this part shows follows correctly from a value the chip does not have',
      })
    }
  }

  // The SAME arrays, also on the netlist — not copies, so they cannot drift apart. `unsupported` and `partial`
  // sat only on this design object, and the netlist is the thing every consumer is handed, so a caller that
  // lowered the netlist onto the canvas lost both lists at that hop.
  return {
    netlist: {
      cells: recovered,
      undecoded: unsupported,
      incomplete: partial,
      unfaithful: distrusted,
    },
    cells,
    drivers,
    primaryWires,
    unsupported,
    partial,
    distrusted,
    split,
    wideMuxes,
  }
}

/**
 * Follow one input wire backwards until it reaches a cell output or runs out of routing.
 *
 * The walk remembers where it has been: Gowin routing legitimately contains loops through bidirectional
 * segments, so an unbounded walk would hang on a perfectly valid bitstream rather than on a malformed one.
 *
 * Ending at a wire with no driver means the signal comes from outside the logic this path models, so it becomes
 * a primary input named after that wire.
 */
function traceInput(
  start: string,
  drivers: ReadonlyMap<string, string>,
  // The hops no fuse selects. Without them the walk stops one wire short of the register that really drives it
  // and mints a chip input in its place — an input the silicon does not have, offered on the canvas as a switch
  // the user can throw. `drivers` wins wherever both have the wire: a programmed multiplexer overrides its
  // power-up source.
  defaultDrivers: ReadonlyMap<string, string>,
  cellByOutput: ReadonlyMap<string, CellRef>,
  primaryNets: Map<string, number>,
  primaryWires: Map<number, string>,
  // Wires a REFUSED block memory drives. Ending on one is not the same as running out of routing: the chip has
  // no way at all to drive this wire from outside, so a primary here is a switch on the canvas that the silicon
  // does not have — eight of them on a one-memory design.
  memoryWires: ReadonlyMap<string, unknown>,
): InputSource {
  // A pin tied to a rail is a constant, not an input. Reported as a primary it would read zero, silently
  // changing what the cell computes: an adder cell whose C and D pins are tied high computes A^B, and A if
  // they read low.
  if (start === 'VCC') return { kind: 'const', value: true }
  if (start === 'VSS') return { kind: 'const', value: false }

  const seen = new Set<string>()
  let wire = start
  while (!seen.has(wire)) {
    seen.add(wire)
    const driver = cellByOutput.get(wire)
    if (driver !== undefined) return { kind: 'cell', driver, net: 0 }
    const next = drivers.get(wire) ?? defaultDrivers.get(wire)
    if (next === undefined) break
    if (next === 'VCC') return { kind: 'const', value: true }
    if (next === 'VSS') return { kind: 'const', value: false }
    wire = next
  }
  if (memoryWires.has(wire)) return { kind: 'unreadable', wire }
  let net = primaryNets.get(wire)
  if (net === undefined) {
    net = primaryNets.size + 1
    primaryNets.set(wire, net)
    primaryWires.set(net, wire)
  }
  return { kind: 'primary', net }
}
