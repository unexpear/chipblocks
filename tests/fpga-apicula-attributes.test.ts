/**
 * FPGA fabric — Gowin carry, I/O and block memory, checked against Apicula's decode of REAL bitstreams.
 *
 * Two genuine `gowin_pack` outputs are used:
 *   `gowin-gw1n1-xnor-dff.fs` — one XNOR into a flip-flop
 *   `gowin-gw1n1-adder4.fs`   — a registered 4-bit adder, which forces the carry chain into use
 *
 * The adder matters: nothing before it exercised arithmetic mode, so carry could not have been verified against
 * anything real. Apicula reports ALU cells in it, and so must we.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  decodeAttributeTable,
  decodeGowinBlockMemory,
  decodeGowinCarryCells,
  decodeGowinIoBuffers,
  GOWIN_SLICE_FAMILY,
  type GowinAttributeDatabase,
  gowinValueName,
  parseGowinAttributeDatabase,
} from '../src/renderer/fpga-apicula-attributes.ts'
import {
  extractGowinTileBits,
  type GowinChipdb,
  gowinTileAt,
  parseGowinChipdb,
} from '../src/renderer/fpga-apicula-chipdb.ts'
import { parseGowinBitstream } from '../src/renderer/fpga-apicula-fs.ts'

const db: GowinChipdb = parseGowinChipdb(
  readFileSync(new URL('../fixtures/gowin-gw1n1-chipdb.json', import.meta.url), 'utf8'),
)
const attributes: GowinAttributeDatabase = parseGowinAttributeDatabase(
  readFileSync(new URL('../fixtures/gowin-gw1n1-attributes.json', import.meta.url), 'utf8'),
)

type ReferenceTile = {
  row: number
  col: number
  ttyp: number
  bels: Record<string, string[]>
}
const load = (
  bitstream: string,
  reference: string,
): { frames: boolean[][]; reference: ReferenceTile[] } => ({
  frames: parseGowinBitstream(
    readFileSync(new URL(`../fixtures/${bitstream}`, import.meta.url), 'utf8'),
  ).frames,
  reference: JSON.parse(readFileSync(new URL(`../fixtures/${reference}`, import.meta.url), 'utf8')),
})

const adder = load('gowin-gw1n1-adder4.fs', 'gowin-gw1n1-adder4-reference.json')
const xnor = load('gowin-gw1n1-xnor-dff.fs', 'gowin-gw1n1-decode-reference.json')

const tileBitsAt = (frames: boolean[][], row: number, col: number): boolean[][] =>
  extractGowinTileBits(frames, db, row, col) as boolean[][]

describe('parseGowinAttributeDatabase', () => {
  test('carries every attribute table, name dictionary and logic class', () => {
    expect(attributes.tables.size).toBe(28)
    expect(attributes.families.has('cls')).toBe(true)
    expect(attributes.families.has('iob')).toBe(true)
    expect(attributes.logicinfo.has('SLICE')).toBe(true)
    expect(attributes.logicinfo.has('IOB')).toBe(true)
    // I/O tables really do come from a different source than logic tables
    const ioTile = [...attributes.tables.values()].find((t) => t.has('IOBA'))
    expect(ioTile).toBeDefined()
  })

  test('the generalised engine reproduces the flip-flop table it replaced', () => {
    // Sanity that generalising did not change behaviour: an erased logic tile still reports LSRONMUX=7.
    const blank = Array.from({ length: 24 }, () => new Array<boolean>(60).fill(false))
    const decoded = decodeAttributeTable(blank, attributes, 12, 'CLS0', GOWIN_SLICE_FAMILY)
    expect(decoded.get('LSRONMUX')).toBe(7)
  })
})

describe('carry — the ALU cells in a REAL adder bitstream', () => {
  test('we find carry cells exactly where Apicula finds them', () => {
    const theirs = new Map<string, number[]>()
    for (const tile of adder.reference) {
      const alus = Object.keys(tile.bels)
        .filter((n) => /^ALU\d$/.test(n))
        .map((n) => Number(n.slice(3)))
        .sort()
      if (alus.length > 0) theirs.set(`R${tile.row}C${tile.col}`, alus)
    }
    expect(theirs.size).toBeGreaterThan(0) // the adder really does use arithmetic mode

    const mine = new Map<string, number[]>()
    for (let row = 0; row < db.rows; row++)
      for (let col = 0; col < db.cols; col++) {
        const tile = gowinTileAt(db, row, col)
        if (tile === null) continue
        const carry = decodeGowinCarryCells(
          tileBitsAt(adder.frames, row, col),
          attributes,
          tile.ttyp,
        )
        if (carry.length > 0) mine.set(`R${row}C${col}`, carry)
      }
    expect(mine).toEqual(theirs)
  })

  test('the XNOR design has NO carry cells at all', () => {
    // The negative case is what makes the positive one meaningful: a decoder that reported ALU everywhere would
    // pass the test above and fail this one.
    for (let row = 0; row < db.rows; row++)
      for (let col = 0; col < db.cols; col++) {
        const tile = gowinTileAt(db, row, col)
        if (tile === null) continue
        expect(
          decodeGowinCarryCells(tileBitsAt(xnor.frames, row, col), attributes, tile.ttyp),
          `R${row}C${col}`,
        ).toEqual([])
      }
  })
})

describe('I/O buffers in the REAL bitstreams', () => {
  test('every tile Apicula reports an I/O buffer in, we report one too', () => {
    for (const design of [xnor, adder]) {
      const theirs = new Set<string>()
      for (const tile of design.reference)
        for (const name of Object.keys(tile.bels))
          if (/^IOB[A-J]$/.test(name)) theirs.add(`R${tile.row}C${tile.col}:${name.slice(3)}`)
      expect(theirs.size).toBeGreaterThan(0)

      const mine = new Set<string>()
      for (const tile of design.reference) {
        const grid = gowinTileAt(db, tile.row, tile.col)
        if (grid === null) continue
        for (const buffer of decodeGowinIoBuffers(
          tileBitsAt(design.frames, tile.row, tile.col),
          attributes,
          grid.ttyp,
        ))
          mine.add(`R${tile.row}C${tile.col}:${buffer.name}`)
      }
      // Apicula's set must be contained in ours: it applies extra filtering (differential pairs, unsupported
      // standards) that we do not, so it may report FEWER buffers, never more.
      for (const key of theirs) expect(mine.has(key), key).toBe(true)
    }
  })

  test('an interior logic tile has no I/O buffers', () => {
    const logic = gowinTileAt(db, 9, 2) as { ttyp: number }
    expect(decodeGowinIoBuffers(tileBitsAt(adder.frames, 9, 2), attributes, logic.ttyp)).toEqual([])
  })

  test('I/O attributes decode to named values', () => {
    const io = adder.reference.find((t) => Object.keys(t.bels).some((n) => /^IOB[A-J]$/.test(n)))
    const grid = gowinTileAt(db, (io as ReferenceTile).row, (io as ReferenceTile).col) as {
      ttyp: number
    }
    const buffers = decodeGowinIoBuffers(
      tileBitsAt(adder.frames, (io as ReferenceTile).row, (io as ReferenceTile).col),
      attributes,
      grid.ttyp,
    )
    expect(buffers.length).toBeGreaterThan(0)
    const named = [...(buffers[0] as { attributes: Map<string, number> }).attributes.values()]
      .map((v) => gowinValueName(attributes, 'iob', v))
      .filter((n) => n !== null)
    expect(named.length).toBeGreaterThan(0)
  })
})

/**
 * A THIRD real bitstream, built to close the block-memory gap: a 1024x8 memory, which yosys infers into a real
 * block RAM (it emits an `SPX9` primitive and nextpnr reports "BSRAM: 1/4").
 */
const bram = load('gowin-gw1n1-bram1k.fs', 'gowin-gw1n1-bram1k-reference.json')

describe('block memory in a REAL bitstream', () => {
  test('a bitstream carrying memory contents has MORE frames than the tile grid', () => {
    // Found by this artefact, not predicted: the fabric grid accounts for 274 rows, but this file declares 530.
    // The extra rows are the memory's initial contents. An equality check on the bitmap height - which is what
    // `extractGowinTileBits` used to do - rejects this perfectly valid file as being for the wrong device.
    expect(bram.frames).toHaveLength(530)
    expect(db.bitmapRows).toBe(274)
    expect(bram.frames.length).toBeGreaterThan(db.bitmapRows)
    for (const frame of bram.frames) expect(frame).toHaveLength(db.bitmapCols)
  })

  test('a bitstream with too FEW frames is still refused', () => {
    // The relaxed check must not become no check at all.
    expect(() => extractGowinTileBits([[true]], db, 0, 0)).toThrow(/wrong device/)
  })

  test('we find block memory at exactly the tiles Apicula does', () => {
    const theirs = new Set(
      bram.reference
        .filter((t) => Object.keys(t.bels).some((n) => n.startsWith('BSRAM')))
        .map((t) => `R${t.row}C${t.col}`),
    )
    expect(theirs.size).toBe(3) // one block RAM occupies a main tile plus two auxiliaries

    const mine = new Set<string>()
    for (let row = 0; row < db.rows; row++)
      for (let col = 0; col < db.cols; col++) {
        const tile = gowinTileAt(db, row, col)
        if (tile === null) continue
        const memory = decodeGowinBlockMemory(
          tileBitsAt(bram.frames, row, col),
          attributes,
          tile.ttyp,
        )
        if (memory.size > 0) mine.add(`R${row}C${col}`)
      }
    expect(mine).toEqual(theirs)
  })

  test('the decoded width is the width the toolchain actually built', () => {
    // The source declares `reg [7:0]`, but yosys maps it to Gowin's NINE-bit mode (8 data + 1 parity) and emits
    // an SPX9 cell. The decoded attribute names to "9", agreeing with the primitive rather than with the source
    // - which is the stronger check, since it is the hardware that the bits describe.
    const memory = decodeGowinBlockMemory(tileBitsAt(bram.frames, 5, 3), attributes, 41)
    const single = memory.get('SP') as Map<string, number>
    const width = single.get('SPA_DATA_WIDTH') as number
    expect(gowinValueName(attributes, 'bsram', width)).toBe('9')
  })

  test('the two designs WITHOUT memory report none anywhere', () => {
    // The negative control: a decoder that reported block memory on every memory-capable tile would pass the
    // test above and fail this one.
    for (const design of [xnor, adder])
      for (let row = 0; row < db.rows; row++)
        for (let col = 0; col < db.cols; col++) {
          const tile = gowinTileAt(db, row, col)
          if (tile === null) continue
          expect(
            decodeGowinBlockMemory(tileBitsAt(design.frames, row, col), attributes, tile.ttyp).size,
            `R${row}C${col}`,
          ).toBe(0)
        }
  })

  test('a logic tile never reports block memory', () => {
    const logic = gowinTileAt(db, 9, 2) as { ttyp: number }
    expect(decodeGowinBlockMemory(tileBitsAt(bram.frames, 9, 2), attributes, logic.ttyp).size).toBe(
      0,
    )
  })
})
