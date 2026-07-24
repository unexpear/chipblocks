/**
 * FPGA fabric — Stage 2 (real iCE40), increment 1: ingest a genuine Project IceStorm "icebox" chipdb.
 * The full staging is FPGA-FABRIC-RESEARCH.md §5. Stage 1 built the abstract mini-VPR with two hooks left
 * open in the routing-resource graph — `Pip.configBits` (the CRAM bit coordinates that turn a pip on) and
 * `WireNode.span` (a wire that crosses several tiles). Stage 2 fills them with REAL device data: this module
 * parses the actual icebox chipdb `.txt` and pulls out, per verified primary-source grammar, the wire table
 * (with spans) and the switch table (`.buffer`/`.routing` pips with their exact CRAM bits).
 *
 * The grammar is the real one (confirmed against icebox/icebox_chipdb.py and nextpnr's ice40/chipdb.py,
 * FPGA-FABRIC-RESEARCH.md §4a), not a ChipBlocks invention:
 *
 *   .device NAME WIDTH HEIGHT NUM_NETS         — one device
 *   .net INDEX                                 — a wire; each following "X Y WIRENAME" line is one tile the
 *     X Y WIRENAME                               SAME electrical wire occupies. The count of those lines is
 *     ...                                        the wire's SPAN (a span-4 track lists 5 tile positions).
 *   .buffer X Y DST  B<r>[<c>] B<r>[<c>] ...    — a mux at tile (X,Y) driving wire index DST; the header names
 *     PATTERN SRC                                the CRAM bits it uses. Each body line is one source option:
 *     ...                                        PATTERN is a binary string, one digit per header bit in
 *   .routing X Y DST  B<r>[<c>] ...              order ('1' = that bit set, '0' = clear), and SRC is the
 *     PATTERN SRC                                source wire index. `.buffer` and `.routing` share this shape;
 *     ...                                        both become a directional src→dst pip (nextpnr treats them
 *                                                identically) whose PATTERN is the config that turns it on.
 *
 * A pip's config is therefore a set of (tile-local) CRAM bits each required to hold a specific value — turn
 * every one of those bits to its value and the pip conducts. Collecting the required bit values over a chosen
 * routing yields the CRAM programming for that routing (`cramBitsForRoute`) — the concrete first step toward
 * emitting/parsing a real bitstream (Stage 3). CRAM bits are per-tile: row 0–15 (B0–B15 — every iCE40 tile
 * type is 16 rows tall) and a column within the tile type's width.
 *
 * Scope (honest): this ingests the wire + switch topology and its config bits — enough to know which bits a
 * routing programs. It does NOT yet convert to the Stage-1 `Rrg` for place-and-route on real silicon (the
 * next increment), decode LUT-init / special-cell bits, or model timing (the chipdb carries topology, not
 * delays — those live in a separate icetime database and are reported "not modeled" until ingested).
 */

/** A configuration-RAM bit coordinate within a tile: row B0..B15, and a column within the tile's CRAM width. */
export type CramBit = { row: number; col: number }

/** A pip's activation condition: it conducts exactly when every listed bit holds its given value. */
export type PipCondition = { bit: CramBit; value: 0 | 1 }[]

/** One tile position a wire occupies (the same electrical net seen from tile (x,y) under a local name). */
export type WireSegment = { x: number; y: number; name: string }

export type IceboxWire = {
  index: number
  /** the wire's name at its first listed segment. */
  name: string
  segments: WireSegment[]
  /** how many tile positions the wire spans (= segments.length) — the real segmentation. */
  span: number
}

/** A programmable interconnect point: a directional src→dst switch gated by its CRAM `condition`. */
export type IceboxPip = {
  x: number
  y: number
  /** source wire index. */
  src: number
  /** destination wire index. */
  dst: number
  kind: 'buffer' | 'routing'
  condition: PipCondition
}

export type IceboxDevice = {
  name: string
  width: number
  height: number
  numNets: number
  wires: Map<number, IceboxWire>
  pips: IceboxPip[]
}

/** A single CRAM bit driven to a value at a specific tile — the unit of a bitstream. */
export type ProgrammedBit = { x: number; y: number; row: number; col: number; value: 0 | 1 }

const CONFIG_BIT = /^B(\d+)\[(\d+)\]$/

/** Parse a `B<row>[<col>]` token into a CramBit, or null if it is not one. */
function parseCramBit(token: string): CramBit | null {
  const m = CONFIG_BIT.exec(token)
  return m ? { row: Number(m[1]), col: Number(m[2]) } : null
}

/**
 * Parse a real icebox chipdb `.txt` into its device / wire-table / switch-table. Recognizes `.device`,
 * `.net`, `.buffer`, `.routing`; every other directive (`.pins`, `.logic_tile`, `.ieren`, …) and its body is
 * skipped, so a full chipdb parses its routing-relevant subset. Blank and `#` comment lines are ignored.
 */
export function parseIceboxChipdb(text: string): IceboxDevice {
  const device: IceboxDevice = {
    name: '',
    width: 0,
    height: 0,
    numNets: 0,
    wires: new Map(),
    pips: [],
  }

  // Parser state: which kind of block we are inside, and the context needed to attach its body lines.
  let mode: 'none' | 'net' | 'switch' | 'skip' = 'none'
  let currentWire: IceboxWire | null = null
  let switchTile = { x: 0, y: 0 }
  let switchDst = 0
  let switchKind: 'buffer' | 'routing' = 'buffer'
  let switchBits: CramBit[] = []

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const tok = line.split(/\s+/)
    const head = tok[0] ?? ''

    if (head.startsWith('.')) {
      currentWire = null
      if (head === '.device') {
        device.name = tok[1] ?? ''
        device.width = Number(tok[2] ?? 0)
        device.height = Number(tok[3] ?? 0)
        device.numNets = Number(tok[4] ?? 0)
        mode = 'none'
      } else if (head === '.net') {
        const index = Number(tok[1] ?? 0)
        currentWire = { index, name: '', segments: [], span: 0 }
        device.wires.set(index, currentWire)
        mode = 'net'
      } else if (head === '.buffer' || head === '.routing') {
        switchKind = head === '.buffer' ? 'buffer' : 'routing'
        switchTile = { x: Number(tok[1] ?? 0), y: Number(tok[2] ?? 0) }
        switchDst = Number(tok[3] ?? 0)
        switchBits = tok
          .slice(4)
          .map(parseCramBit)
          .filter((b): b is CramBit => b !== null)
        mode = 'switch'
      } else {
        mode = 'skip' // a directive we don't model — swallow its body so it isn't misattributed
      }
      continue
    }

    // A body line — attach it to the current block.
    if (mode === 'net' && currentWire) {
      const seg: WireSegment = { x: Number(tok[0]), y: Number(tok[1]), name: tok[2] ?? '' }
      currentWire.segments.push(seg)
      if (currentWire.segments.length === 1) currentWire.name = seg.name
      currentWire.span = currentWire.segments.length
    } else if (mode === 'switch') {
      const pattern = tok[0] ?? ''
      const src = Number(tok[1] ?? 0)
      // Zip the header bits with the pattern digits: bit i is required to be pattern[i].
      if (pattern.length === switchBits.length) {
        const condition: PipCondition = switchBits.map((bit, i) => ({
          bit,
          value: pattern[i] === '1' ? 1 : 0,
        }))
        device.pips.push({
          x: switchTile.x,
          y: switchTile.y,
          src,
          dst: switchDst,
          kind: switchKind,
          condition,
        })
      }
    }
  }

  return device
}

/** The key identifying one physical CRAM bit (tile + row/col) — for detecting when two pips need it both ways. */
const bitKey = (x: number, y: number, bit: CramBit): string => `${x}_${y}_B${bit.row}[${bit.col}]`

/**
 * The CRAM programming a chosen routing (a set of pips selected to be ON) requires: every config bit those
 * pips constrain, with the value it must hold. Bits not returned default to 0 in the bitstream. A `conflict`
 * is a bit two selected pips need to hold at DIFFERENT values — an illegal routing (e.g. two source options
 * of the same mux at once); a legal routing produces none. This is the routing's contribution to a bitstream.
 */
export function cramBitsForRoute(pips: readonly IceboxPip[]): {
  bits: ProgrammedBit[]
  conflicts: string[]
} {
  const value = new Map<string, ProgrammedBit>()
  const conflicts = new Set<string>()
  for (const pip of pips) {
    for (const { bit, value: v } of pip.condition) {
      const key = bitKey(pip.x, pip.y, bit)
      const existing = value.get(key)
      if (existing === undefined) {
        value.set(key, { x: pip.x, y: pip.y, row: bit.row, col: bit.col, value: v })
      } else if (existing.value !== v) {
        conflicts.add(key)
      }
    }
  }
  return { bits: [...value.values()], conflicts: [...conflicts] }
}
