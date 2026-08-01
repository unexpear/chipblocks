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

describe('block memory', () => {
  test('the device really does have block-memory tile types', () => {
    const withBsram = [...attributes.tables.values()].filter((t) =>
      [...t.keys()].some((n) => n.startsWith('BSRAM_')),
    )
    expect(withBsram.length).toBeGreaterThan(0)
  })

  test('a tile type with no block memory decodes to nothing', () => {
    const logic = gowinTileAt(db, 9, 2) as { ttyp: number }
    expect(
      decodeGowinBlockMemory(tileBitsAt(adder.frames, 9, 2), attributes, logic.ttyp).size,
    ).toBe(0)
  })

  test('NEITHER test design instantiates a block memory — so this path is unverified', () => {
    // Stated as a test so the gap cannot quietly be forgotten. If a future bitstream does use block RAM, this
    // will start failing and should be replaced by a real comparison against Apicula.
    for (const design of [xnor, adder])
      for (const tile of design.reference)
        expect(Object.keys(tile.bels).some((n) => n.startsWith('BSRAM'))).toBe(false)
  })
})
