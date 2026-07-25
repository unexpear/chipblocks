/**
 * FPGA fabric — Stage 2 (real iCE40), increment 3: the logic-cell (BLE) bit model.
 * The full staging is FPGA-FABRIC-RESEARCH.md §5. Increment 2 (fpga-icebox-rrg.ts) made the ROUTING real —
 * route a net and emit the CRAM bits the routing programs. This increment makes the LOGIC real: it encodes a
 * logic cell's function (a LUT4 truth table + its flip-flop config) into the exact CRAM bits an iCE40 logic
 * tile uses, and decodes those bits back. Together the two give a real design's bitstream: routing bits ⊕
 * logic bits.
 *
 * An iCE40 logic tile holds 8 identical logic cells (BLEs). Each cell is a 20-bit config vector `LC_n`
 * (its CRAM positions are listed in the chipdb's `.logic_tile_bits` section — `parseLogicTileBits`): 16 of
 * those bits are the 4-input LUT truth table and 4 are the sequential (flip-flop) config. The bit ordering is
 * NOT natural — it is the exact permutation Project IceStorm uses, taken from `icebox.py` and cross-checked by
 * running the real tool:
 *   - LUT truth-table bit j (j = 0..15) is stored at LC-vector position `LUT_BIT_FROM_LC[j]`
 *     (icebox.py:1420 `get_lutff_lut_bits`).
 *   - the four sequential bits live at LC positions 8/9/18/19 = carry-enable / DFF-enable / set-no-reset /
 *     async-set-reset (icebox.py:1424 `get_lutff_seq_bits`; names from icebox_hlc2asc.py:889-897).
 *   - a truth table is indexed `truth[8·in3 + 4·in2 + 2·in1 + in0]` (icebox_vlog.py `make_lut_expr`), which is
 *     the SAME little-endian order as this project's own `KLut.config`, so a mapped LUT drops straight onto a
 *     real cell.
 *
 * Honest scope: this models the LUT4 truth table + the four per-cell sequential config bits (and parses the
 * tile-shared NegClk / CarryInSet positions), at their real CRAM coordinates, exact per icebox. It does NOT
 * model carry-chain PROPAGATION (only the carry-enable bit), BRAM / DSP / PLL / IO cells, the LUT's input
 * ROUTING (that is the routing-resource graph, increment 2), or timing. What it leaves out, it leaves out
 * loudly — there is no fabricated "logic" here beyond the cited bit encoding.
 */

import type { CramBit, ProgrammedBit } from './fpga-icebox.ts'

/** LUT truth-table bit j → its position in the 20-bit LC config vector (icebox.py:1420 get_lutff_lut_bits). */
const LUT_BIT_FROM_LC: readonly number[] = [4, 14, 15, 5, 6, 16, 17, 7, 3, 13, 12, 2, 1, 11, 10, 0]

/** The four sequential-config bits and their LC-vector positions (icebox.py:1424 + icebox_hlc2asc.py:889-897). */
const SEQ_LC_BIT = { carryEnable: 8, dffEnable: 9, setNoReset: 18, asyncSetReset: 19 } as const

/** The config of one iCE40 logic cell: its LUT4 truth table + the flip-flop / carry bits. */
export type LcConfig = {
  /** 16-entry LUT truth table, indexed `truth[8·in3 + 4·in2 + 2·in1 + in0]` (in0 = least-significant input). */
  truth: boolean[]
  carryEnable: boolean
  dffEnable: boolean
  setNoReset: boolean
  asyncSetReset: boolean
}

/** The device-global logic-tile CRAM layout parsed from a chipdb's `.logic_tile_bits` section. */
export type LogicTileBits = {
  cols: number
  rows: number
  /** cells[n] = the 20 CRAM coordinates of cell n's `LC_n` vector, in LC-bit order (index 0..19). */
  cells: CramBit[][]
  /** tile-shared config bit positions (null if the section did not list them). */
  carryInSet: CramBit | null
  negClk: CramBit | null
}

const CONFIG_BIT = /^B(\d+)\[(\d+)\]$/

function parseBit(token: string | undefined): CramBit | null {
  const m = token === undefined ? null : CONFIG_BIT.exec(token)
  return m ? { row: Number(m[1]), col: Number(m[2]) } : null
}

/**
 * Parse a chipdb's `.logic_tile_bits COLS ROWS` section into the per-cell CRAM layout. Each `LC_<n>` line
 * lists that cell's 20 config-bit coordinates in LC-vector order; `CarryInSet` / `NegClk` are tile-shared.
 * (This is the same real IceStorm grammar increment 1's router parser skips — a logic tile carries no routing.)
 */
export function parseLogicTileBits(chipdbText: string): LogicTileBits {
  const cellsByIndex = new Map<number, CramBit[]>()
  let cols = 0
  let rows = 0
  let carryInSet: CramBit | null = null
  let negClk: CramBit | null = null
  let inSection = false

  for (const raw of chipdbText.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const tok = line.split(/\s+/)
    const head = tok[0] ?? ''
    if (head === '.logic_tile_bits') {
      cols = Number(tok[1] ?? 0)
      rows = Number(tok[2] ?? 0)
      inSection = true
      continue
    }
    if (head.startsWith('.')) {
      if (inSection) break // a new directive ends the section
      continue
    }
    if (!inSection) continue
    const lcMatch = /^LC_(\d+)$/.exec(head)
    if (lcMatch) {
      const bits = tok.slice(1).map(parseBit)
      if (bits.every((b): b is CramBit => b !== null)) {
        cellsByIndex.set(Number(lcMatch[1]), bits)
      }
    } else if (head === 'CarryInSet') {
      carryInSet = parseBit(tok[1])
    } else if (head === 'NegClk') {
      negClk = parseBit(tok[1])
    }
  }

  const cells: CramBit[][] = []
  for (let i = 0; i < cellsByIndex.size; i++) {
    const bits = cellsByIndex.get(i)
    if (bits !== undefined) cells.push(bits)
  }
  return { cols, rows, cells, carryInSet, negClk }
}

/**
 * The exact iCE40 LUT4 evaluation (icebox_vlog.py make_lut_expr): the output for inputs (in0..in3) is the
 * truth-table entry at index `8·in3 + 4·in2 + 2·in1 + in0`. `truth` must have 16 entries (see `expandTruth`).
 */
export function evalLut4(
  truth: readonly boolean[],
  in0: boolean,
  in1: boolean,
  in2: boolean,
  in3: boolean,
): boolean {
  const idx = (in0 ? 1 : 0) + (in1 ? 2 : 0) + (in2 ? 4 : 0) + (in3 ? 8 : 0)
  return truth[idx] === true
}

/**
 * Expand a k-input LUT truth table (length 2^k for k = 0..4, e.g. this project's `KLut.config`) to the full
 * 16-entry iCE40 table: the unused high inputs simply don't change the output, so entry `idx` repeats the
 * k-input entry `idx & (2^k − 1)`. Matches the shared little-endian input order, so no permutation is needed.
 */
export function expandTruth(truth: readonly boolean[]): boolean[] {
  const len = truth.length
  if (len === 0 || len > 16 || (len & (len - 1)) !== 0) {
    throw new Error(`expandTruth: truth table length must be a power of two ≤ 16, got ${len}`)
  }
  return Array.from({ length: 16 }, (_, idx) => truth[idx & (len - 1)] === true)
}

/**
 * The CRAM bits that program cell `cell` on logic tile (x, y) with `config` — all 20 LC bits (16 LUT + 4
 * sequential) at their real coordinates, each with its 0/1 value. (Bits that are 0 are still returned so the
 * result decodes exactly; a caller wanting a minimal bitstream can keep only value === 1.)
 */
export function lcCramBits(
  layout: LogicTileBits,
  cell: number,
  x: number,
  y: number,
  config: LcConfig,
): ProgrammedBit[] {
  const lc = layout.cells[cell]
  if (lc === undefined)
    throw new Error(`lcCramBits: tile has no cell ${cell} (has ${layout.cells.length})`)
  if (config.truth.length !== 16) {
    throw new Error(
      `lcCramBits: truth table must be 16 entries (use expandTruth); got ${config.truth.length}`,
    )
  }
  const at = (lcBit: number, value: boolean): ProgrammedBit => {
    const bit = lc[lcBit] as CramBit
    return { x, y, row: bit.row, col: bit.col, value: value ? 1 : 0 }
  }
  const bits: ProgrammedBit[] = []
  for (let j = 0; j < 16; j++) bits.push(at(LUT_BIT_FROM_LC[j] as number, config.truth[j] === true))
  bits.push(at(SEQ_LC_BIT.carryEnable, config.carryEnable))
  bits.push(at(SEQ_LC_BIT.dffEnable, config.dffEnable))
  bits.push(at(SEQ_LC_BIT.setNoReset, config.setNoReset))
  bits.push(at(SEQ_LC_BIT.asyncSetReset, config.asyncSetReset))
  return bits
}

/**
 * Decode cell `cell` on tile (x, y) back into its `LcConfig`, reading the CRAM values in `bits` (any
 * ProgrammedBit not present at a needed coordinate for this tile defaults to 0). The inverse of `lcCramBits`.
 */
export function decodeLc(
  layout: LogicTileBits,
  cell: number,
  x: number,
  y: number,
  bits: Iterable<ProgrammedBit>,
): LcConfig {
  const lc = layout.cells[cell]
  if (lc === undefined)
    throw new Error(`decodeLc: tile has no cell ${cell} (has ${layout.cells.length})`)
  const value = new Map<string, 0 | 1>()
  for (const b of bits) if (b.x === x && b.y === y) value.set(`${b.row}_${b.col}`, b.value)
  const read = (lcBit: number): boolean => {
    const bit = lc[lcBit] as CramBit
    return value.get(`${bit.row}_${bit.col}`) === 1
  }
  return {
    truth: Array.from({ length: 16 }, (_, j) => read(LUT_BIT_FROM_LC[j] as number)),
    carryEnable: read(SEQ_LC_BIT.carryEnable),
    dffEnable: read(SEQ_LC_BIT.dffEnable),
    setNoReset: read(SEQ_LC_BIT.setNoReset),
    asyncSetReset: read(SEQ_LC_BIT.asyncSetReset),
  }
}
