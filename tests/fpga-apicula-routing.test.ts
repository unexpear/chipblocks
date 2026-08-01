/**
 * FPGA fabric — Gowin routing, checked against Apicula's own decode of a REAL bitstream.
 *
 * `fixtures/gowin-gw1n1-decode-reference.json` was produced by running Apicula's `parse_tile_` over
 * `fixtures/gowin-gw1n1-xnor-dff.fs` — a genuine `gowin_pack` output. So this test has both halves of the thing
 * that has been missing all along: a real artefact, and an independent implementation to agree with. Every tile
 * of the device is decoded and compared, not just the interesting ones.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  decodeGowinFlipFlops,
  extractGowinTileBits,
  type GowinChipdb,
  gowinTileAt,
  parseGowinChipdb,
} from '../src/renderer/fpga-apicula-chipdb.ts'
import { parseGowinBitstream } from '../src/renderer/fpga-apicula-fs.ts'
import {
  decodeGowinRouting,
  type GowinPipDatabase,
  parseGowinPipDatabase,
} from '../src/renderer/fpga-apicula-routing.ts'

const db: GowinChipdb = parseGowinChipdb(
  readFileSync(new URL('../fixtures/gowin-gw1n1-chipdb.json', import.meta.url), 'utf8'),
)
const pipdb: GowinPipDatabase = parseGowinPipDatabase(
  readFileSync(new URL('../fixtures/gowin-gw1n1-pips.json', import.meta.url), 'utf8'),
)
const parsed = parseGowinBitstream(
  readFileSync(new URL('../fixtures/gowin-gw1n1-xnor-dff.fs', import.meta.url), 'utf8'),
)

type ReferenceTile = {
  row: number
  col: number
  ttyp: number
  pips: Record<string, string>
  clock_pips: Record<string, string>
  bels: Record<string, string[]>
}
const REFERENCE: ReferenceTile[] = JSON.parse(
  readFileSync(new URL('../fixtures/gowin-gw1n1-decode-reference.json', import.meta.url), 'utf8'),
)

describe('parseGowinPipDatabase', () => {
  test('carries routing tables for every tile type', () => {
    expect(pipdb.size).toBe(28)
    let destinations = 0
    let sources = 0
    for (const tables of pipdb.values())
      for (const bySource of tables.pips.values()) {
        destinations++
        sources += bySource.size
      }
    expect(destinations).toBe(3536)
    expect(sources).toBe(74038)
  })
})

describe('decodeGowinRouting — against Apicula’s decode of a real bitstream', () => {
  /** Every tile of the device, decoded from the real bitstream. */
  const decodeAll = (): Map<string, { pips: Map<string, string>; clock: Map<string, string> }> => {
    const all = new Map<string, { pips: Map<string, string>; clock: Map<string, string> }>()
    for (let row = 0; row < db.rows; row++)
      for (let col = 0; col < db.cols; col++) {
        const tile = gowinTileAt(db, row, col)
        if (tile === null) continue
        const bits = extractGowinTileBits(parsed.frames, db, row, col) as boolean[][]
        const routing = decodeGowinRouting(bits, pipdb, tile.ttyp)
        if (routing.pips.size === 0 && routing.clockPips.size === 0) continue
        all.set(`R${row}C${col}`, { pips: routing.pips, clock: routing.clockPips })
      }
    return all
  }

  test('finds exactly the tiles Apicula finds, and nothing more', () => {
    // The "nothing more" half matters most: a decoder that were too eager would invent connections in the 213
    // tiles that carry none, and a test that only checked the expected tiles would never notice.
    const mine = decodeAll()
    const theirs = new Set(
      REFERENCE.filter(
        (t) => Object.keys(t.pips).length > 0 || Object.keys(t.clock_pips).length > 0,
      ).map((t) => `R${t.row}C${t.col}`),
    )
    expect(new Set(mine.keys())).toEqual(theirs)
  })

  test('every pip matches Apicula exactly, destination by destination', () => {
    const mine = decodeAll()
    for (const reference of REFERENCE) {
      const key = `R${reference.row}C${reference.col}`
      const decoded = mine.get(key)
      if (Object.keys(reference.pips).length === 0) continue
      expect(decoded, key).toBeDefined()
      expect(Object.fromEntries((decoded as { pips: Map<string, string> }).pips), key).toEqual(
        reference.pips,
      )
    }
  })

  test('clock routing matches too, and stays separate from general interconnect', () => {
    const mine = decodeAll()
    for (const reference of REFERENCE) {
      if (Object.keys(reference.clock_pips).length === 0) continue
      const decoded = mine.get(`R${reference.row}C${reference.col}`)
      expect(Object.fromEntries((decoded as { clock: Map<string, string> }).clock)).toEqual(
        reference.clock_pips,
      )
    }
    // the clock network really is used by this design, so the assertion above is not vacuous
    const clocked = REFERENCE.filter((t) => Object.keys(t.clock_pips).length > 0)
    expect(clocked.length).toBeGreaterThan(0)
  })

  test('the recovered wiring is the design we wrote', () => {
    // R9C2 is the logic tile holding the XNOR: two data inputs arrive on general interconnect and the clock
    // arrives from a global buffer. That is precisely `always @(posedge clk) q <= a XNOR b`.
    const logic = REFERENCE.find((t) => t.row === 9 && t.col === 2) as ReferenceTile
    const bits = extractGowinTileBits(parsed.frames, db, 9, 2) as boolean[][]
    const routing = decodeGowinRouting(bits, pipdb, logic.ttyp)
    expect(routing.pips.get('A0')).toBe('N111')
    expect(routing.pips.get('B0')).toBe('N131')
    expect(routing.pips.get('CLK0')).toBe('GB00')
    // and the outputs leave through the neighbouring IO tile: F6 is a LUT output, Q6 a flip-flop output
    const io = extractGowinTileBits(parsed.frames, db, 10, 2) as boolean[][]
    const ioRouting = decodeGowinRouting(
      io,
      pipdb,
      (gowinTileAt(db, 10, 2) as { ttyp: number }).ttyp,
    )
    expect([...ioRouting.pips.values()]).toContain('Q6')
  })

  test('default (unprogrammed) sources are suppressed unless asked for', () => {
    // 3282 of the 74038 sources have empty bit sets - they are the "nothing selected" state. Reporting them as
    // real connections would bury the handful of actual ones.
    const bits = extractGowinTileBits(parsed.frames, db, 9, 2) as boolean[][]
    const ttyp = (gowinTileAt(db, 9, 2) as { ttyp: number }).ttyp
    const strict = decodeGowinRouting(bits, pipdb, ttyp)
    const loose = decodeGowinRouting(bits, pipdb, ttyp, { includeDefaults: true })
    expect(strict.pips.size).toBe(3)
    expect(loose.pips.size).toBeGreaterThan(strict.pips.size)
  })

  test('a tile type with no routing tables yields nothing rather than guessing', () => {
    expect(decodeGowinRouting([[false]], pipdb, 99999).pips.size).toBe(0)
  })
})

describe('flip-flops in the REAL bitstream match Apicula', () => {
  test('every tile Apicula reports flip-flops in, we agree on', () => {
    let compared = 0
    for (const reference of REFERENCE) {
      const dffs = Object.entries(reference.bels).filter(([name]) => /^DFF\d$/.test(name))
      if (dffs.length === 0) continue
      const tile = gowinTileAt(db, reference.row, reference.col)
      if (tile === null || !db.clsFuses.has(tile.ttyp)) continue
      const bits = extractGowinTileBits(
        parsed.frames,
        db,
        reference.row,
        reference.col,
      ) as boolean[][]
      const mine = decodeGowinFlipFlops(bits, db, tile.ttyp)
      for (const [name, kinds] of dffs) {
        expect(mine.get(name), `${reference.row},${reference.col} ${name}`).toBe(kinds[0])
        compared++
      }
    }
    expect(compared).toBeGreaterThan(0)
  })
})
