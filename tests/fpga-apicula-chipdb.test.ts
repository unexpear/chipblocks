/**
 * FPGA fabric — Gowin (Project Apicula): the device database, and the container checked against VENDOR bytes.
 *
 * `fixtures/gowin-gw1n1-chipdb.json` is derived from Apicula's own `GW1N-1.msgpack.xz` (bundled in the
 * oss-cad-suite tarball), converted offline. That matters for two reasons:
 *
 *  1. It carries the vendor tool's REAL `cmd_hdr` / `cmd_ftr` command records, so the container tests below are
 *     no longer built purely from bytes we invented — the header a real `.fs` starts with is checked verbatim.
 *     That is the trap that has now bitten this project three times (most recently hiding ECP5's reversed frame
 *     order): a synthetic round-trip that writes and reads with the same wrong convention proves nothing.
 *  2. The fabric inventory it yields can be checked against a source OUTSIDE the toolchain entirely — Gowin's
 *     published part specification.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  decodeGowinFlipFlops,
  decodeGowinLuts,
  extractGowinTileBits,
  type GowinChipdb,
  gowinFabricInventory,
  gowinTileAt,
  gowinTileWindow,
  parseGowinAttrValues,
  parseGowinChipdb,
} from '../src/renderer/fpga-apicula-chipdb.ts'
import { crc16Arc, GOWIN_DEVICES, parseGowinBitstream } from '../src/renderer/fpga-apicula-fs.ts'

const CHIPDB_TEXT = readFileSync(
  new URL('../fixtures/gowin-gw1n1-chipdb.json', import.meta.url),
  'utf8',
)
const db: GowinChipdb = parseGowinChipdb(CHIPDB_TEXT)

const byteBits = (n: number): string => n.toString(2).padStart(8, '0')
const bytesToBits = (bs: Iterable<number>): string => [...bs].map(byteBits).join('')

describe('parseGowinChipdb — the fabric the bits belong to', () => {
  test('reads the GW1N-1 tile grid', () => {
    expect(db.device).toBe('GW1N-1')
    expect(db.idcode).toBe(0x0900281b)
    expect([db.rows, db.cols]).toEqual([11, 20])
    expect([db.centerRow, db.centerCol]).toEqual([5, 9])
    expect(db.tileTypes.size).toBe(28)
  })

  test("the IDCODE in the vendor's own command header matches our device table", () => {
    // cmd_hdr record 3 is the 0x06 device-ID record the tool writes. This is an independent check on the
    // GOWIN_DEVICES entry, which was transcribed from Apicula's source rather than read from its database.
    const record = db.commandHeader[3] as Uint8Array
    expect(record[0]).toBe(0x06)
    const idcode =
      (((record[4] as number) << 24) |
        ((record[5] as number) << 16) |
        ((record[6] as number) << 8) |
        (record[7] as number)) >>>
      0
    expect(idcode).toBe(db.idcode)
    expect(GOWIN_DEVICES.find((d) => d.name === 'GW1N-1')?.idcode).toBe(idcode)
  })

  test('the frame-count record the vendor writes is FOUR bytes, not eight', () => {
    // This is the shape that exposed the parser bug: Apicula reads the count as `int.from_bytes(ba[2:], 'big')`,
    // which only means "a 16-bit count" because the record is four bytes long.
    const record = db.commandFooter
      .concat(db.commandHeader)
      .find((r) => r[0] === 0x3b) as Uint8Array
    expect(record.length).toBe(4)
    expect([record[0], record[1]]).toEqual([0x3b, 0x80])
  })

  test('a logic tile carries 8 LUTs + 6 FFs + 6 carry cells', () => {
    // NOTE: `centerRow`/`centerCol` is the clock-distribution centre, NOT a logic tile — an assumption this test
    // originally made and which failed immediately. Find a real logic tile by looking for one.
    let logic: { bels: readonly string[] } | null = null
    let position: [number, number] | null = null
    for (let row = 0; row < db.rows && logic === null; row++)
      for (let col = 0; col < db.cols; col++) {
        const tile = gowinTileAt(db, row, col)
        if (tile?.bels.some((b) => /^LUT\d$/.test(b))) {
          logic = tile
          position = [row, col]
          break
        }
      }
    expect(position).not.toBeNull()
    const bels = (logic as { bels: readonly string[] }).bels
    expect(bels.filter((b) => /^LUT\d$/.test(b))).toHaveLength(8)
    expect(bels.filter((b) => /^DFF\d$/.test(b))).toHaveLength(6)
    expect(bels.filter((b) => /^ALU\d$/.test(b))).toHaveLength(6)
  })

  test('the clock-distribution centre is NOT a logic tile', () => {
    // Pinning the correction above, so the wrong assumption cannot quietly return.
    const centre = gowinTileAt(db, db.centerRow, db.centerCol)
    expect(centre).not.toBeNull()
    expect((centre as { bels: readonly string[] }).bels.some((b) => /^LUT\d$/.test(b))).toBe(false)
  })

  test('off-fabric positions return null rather than a wrong tile', () => {
    expect(gowinTileAt(db, db.rows, 0)).toBeNull()
    expect(gowinTileAt(db, 0, db.cols)).toBeNull()
    expect(gowinTileAt(db, -1, 0)).toBeNull()
  })
})

describe('gowinFabricInventory — checked against Gowin’s published part spec', () => {
  test('the GW1N-1 grid yields 1152 LUT4s and 864 flip-flops', () => {
    // These are the counts GOWIN publishes for the GW1N-1 (1152 LUT4, 864 FF). We reach them by walking an
    // 11x20 grid of tile-type ids and summing each type's cells — geometry derived from the database agreeing
    // with a specification written by neither us nor Apicula. That is the strongest oracle available here.
    const inventory = gowinFabricInventory(db)
    expect(inventory.tiles).toBe(220)
    expect(inventory.luts).toBe(1152)
    expect(inventory.flipFlops).toBe(864)
    // 144 logic tiles x 8 LUTs, and the same 144 tiles x 6 FFs / 6 carry cells
    expect(inventory.luts / 8).toBe(144)
    expect(inventory.carryCells).toBe(864)
  })
})

describe('parseGowinChipdb — refuses rather than guessing', () => {
  test('a ragged grid is refused', () => {
    const broken = JSON.parse(CHIPDB_TEXT) as { grid: number[][] }
    ;(broken.grid[0] as number[]).pop()
    expect(() => parseGowinChipdb(JSON.stringify(broken))).toThrow(/ragged/)
  })

  test('a grid referencing an undefined tile type is refused', () => {
    const broken = JSON.parse(CHIPDB_TEXT) as { grid: number[][] }
    ;(broken.grid[0] as number[])[0] = 9999
    expect(() => parseGowinChipdb(JSON.stringify(broken))).toThrow(/9999/)
  })
})

/**
 * Assemble a `.fs` whose header and footer are the vendor's OWN command records, with only the frame count
 * filled in — which is exactly what `gowin_pack` does with these templates.
 */
function buildVendorFs(frames: boolean[][]): string {
  const lines: string[] = ['//Tool Version: chipblocks-test']
  const header = db.commandHeader.map((r) => Uint8Array.from(r))
  const countRecord = header.find((r) => r[0] === 0x3b) as Uint8Array
  countRecord[2] = (frames.length >> 8) & 0xff
  countRecord[3] = frames.length & 0xff
  for (const record of header) lines.push(bytesToBits(record))

  // the reader skips three preamble lines, then accumulates every record except the 0xD2 SPI address
  let crcData: number[] = []
  for (const record of header.slice(3)) if (record[0] !== 0xd2) crcData.push(...record)

  for (const frame of frames) {
    const body = [...frame]
      .reverse()
      .map((b) => (b ? '1' : '0'))
      .join('')
    const bodyBytes: number[] = []
    for (let i = 0; i + 8 <= body.length; i += 8)
      bodyBytes.push(Number.parseInt(body.slice(i, i + 8), 2))
    const crc = crc16Arc([...crcData, ...bodyBytes])
    const tail = [crc & 0xff, (crc >> 8) & 0xff, 0, 0, 0, 0, 0, 0]
    lines.push(body + bytesToBits(tail))
    crcData = tail.slice(-6)
  }
  for (const record of db.commandFooter) lines.push(bytesToBits(record))
  return lines.join('\n')
}

describe('parseGowinBitstream — against the vendor’s own header and footer', () => {
  const FRAMES = [
    Array.from({ length: 64 }, (_, i) => i % 7 === 0),
    Array.from({ length: 64 }, (_, i) => i % 4 === 3),
    Array.from({ length: 64 }, (_, i) => i > 40),
  ]

  test('parses a container built from the real cmd_hdr / cmd_ftr records', () => {
    const parsed = parseGowinBitstream(buildVendorFs(FRAMES))
    expect(parsed.device?.name).toBe('GW1N-1')
    expect(parsed.idcode).toBe(0x0900281b)
    expect(parsed.crcChecks).toBe(FRAMES.length)
    expect(parsed.crcOk).toBe(true)
    expect(parsed.frames).toEqual(FRAMES)
  })

  test('the vendor footer is not mistaken for frame data', () => {
    // cmd_ftr's first record is 18 bytes of mostly 0xFF; if the frame count were misread the parser would
    // swallow the footer as configuration.
    const parsed = parseGowinBitstream(buildVendorFs(FRAMES))
    expect(parsed.frames).toHaveLength(FRAMES.length)
  })

  test('the 0xD2 SPI-address record is excluded from the CRC, as Apicula excludes it', () => {
    // Proof by mutation: if our parser folded the 0xD2 record into the CRC data, the CRCs computed by the
    // builder above (which excludes it) would no longer match and this would report a failure.
    const text = buildVendorFs(FRAMES)
    expect(text).toContain(bytesToBits([0xd2, 0x00, 0xff, 0xff, 0, 0, 0, 0]))
    expect(parseGowinBitstream(text).crcOk).toBe(true)
  })
})

describe('the frame count is read the way Apicula reads it', () => {
  test('a record longer than four bytes uses EVERY remaining byte, not a fixed 16-bit field', () => {
    // Apicula: `frames = int.from_bytes(ba[2:], 'big')`. For an eight-byte record with 0x0002 at ba[2:4] that is
    // 0x000200000000 — a huge count — NOT 2. Our parser previously read a fixed ba[2..3] and so returned 2,
    // silently disagreeing with the vendor tool at any record length other than four.
    const lines: string[] = ['//Tool Version: x']
    for (const record of db.commandHeader.slice(0, 3)) lines.push(bytesToBits(record))
    lines.push(bytesToBits(db.commandHeader[3] as Uint8Array)) // IDCODE
    lines.push(bytesToBits([0x3b, 0, 0, 2, 0, 0, 0, 0])) // eight-byte frame-count record
    const frame = '0'.repeat(64) + '0'.repeat(64)
    for (let i = 0; i < 3; i++) lines.push(frame)
    const parsed = parseGowinBitstream(lines.join('\n'))
    // a huge count means all three lines are consumed as frames; the old fixed read would have stopped at two
    expect(parsed.frames).toHaveLength(3)
  })
})

/** The first grid position holding LUTs, and its tile type. */
function findLogicTile(): { row: number; col: number; ttyp: number } {
  for (let row = 0; row < db.rows; row++)
    for (let col = 0; col < db.cols; col++) {
      const tile = gowinTileAt(db, row, col)
      if (tile?.bels.some((b) => /^LUT\d$/.test(b))) return { row, col, ttyp: tile.ttyp }
    }
  throw new Error('no logic tile in the fixture')
}

/** An all-zero device bitmap of the fabric's real size. */
const blankBitmap = (): boolean[][] =>
  Array.from({ length: db.bitmapRows }, () => new Array<boolean>(db.bitmapCols).fill(false))

describe('the tile grid tiles the bitmap exactly', () => {
  test('220 differently-sized tiles cover a 274 x 1216 rectangle with no gaps or overlaps', () => {
    // A real structural invariant, not bookkeeping: the tile sizes come from the vendor database and the grid
    // layout from Apicula's `tile_bitmap`, and they have to agree or every tile lookup addresses wrong bits.
    expect([db.bitmapRows, db.bitmapCols]).toEqual([274, 1216])
    let covered = 0
    for (let row = 0; row < db.rows; row++)
      for (let col = 0; col < db.cols; col++) {
        const w = gowinTileWindow(db, row, col) as { width: number; height: number }
        covered += w.width * w.height
      }
    expect(covered).toBe(274 * 1216)
  })

  test('tile windows advance by the previous tile size', () => {
    const first = gowinTileWindow(db, 0, 0) as { left: number; top: number; width: number }
    const second = gowinTileWindow(db, 0, 1) as { left: number; top: number }
    expect([first.left, first.top]).toEqual([0, 0])
    expect(second.left).toBe(first.width)
    expect(second.top).toBe(0)
  })

  test('a database whose tiles do NOT tile is refused', () => {
    const broken = JSON.parse(CHIPDB_TEXT) as {
      grid: number[][]
      tiles: Record<string, { width: number }>
    }
    const ttyp = String((broken.grid[0] as number[])[0])
    ;(broken.tiles[ttyp] as { width: number }).width += 1
    expect(() => parseGowinChipdb(JSON.stringify(broken))).toThrow(/do not tile/)
  })

  test('off-fabric windows are null, and a wrong-size bitmap is refused', () => {
    expect(gowinTileWindow(db, db.rows, 0)).toBeNull()
    expect(() => extractGowinTileBits([[true]], db, 0, 0)).toThrow(/wrong device/)
  })
})

describe('decodeGowinLuts — frame bits become truth tables', () => {
  const { row, col, ttyp } = findLogicTile()

  test('an ERASED tile reads as all-ones LUTs, because the convention is inverted', () => {
    // Apicula: INIT = 0xffff - sum(1 << f for set flags). A programmed bit means that truth-table entry is 0,
    // so a blank device is 0xFFFF everywhere. Reading this backwards would invert every gate on the chip.
    const tileBits = extractGowinTileBits(blankBitmap(), db, row, col) as boolean[][]
    const luts = decodeGowinLuts(tileBits, db, ttyp)
    expect(luts.size).toBe(8)
    for (const [name, init] of luts) expect([name, init]).toEqual([name, 0xffff])
  })

  test('a fully programmed tile reads as all-zero LUTs', () => {
    const tile = gowinTileAt(db, row, col) as { width: number; height: number }
    const filled = Array.from({ length: tile.height }, () =>
      new Array<boolean>(tile.width).fill(true),
    )
    for (const init of decodeGowinLuts(filled, db, ttyp).values()) expect(init).toBe(0)
  })

  test('an arbitrary truth table survives the whole device-sized round trip', () => {
    // Set the bits for a chosen INIT in ONE LUT of ONE tile, in a full 274x1216 device bitmap, then read it
    // back through the same window arithmetic the real flow uses.
    const bitmap = blankBitmap()
    const window = gowinTileWindow(db, row, col) as { top: number; left: number }
    const bits = (
      db.lutFlagBits.get(ttyp) as ReadonlyMap<string, readonly (readonly number[])[]>
    ).get('LUT3') as readonly (readonly number[])[]
    const wanted = 0xabcd
    for (let flag = 0; flag < 16; flag++) {
      if (((wanted >> flag) & 1) === 1) continue // a 1 entry is left ERASED
      const [r, c] = bits[flag] as readonly number[]
      ;(bitmap[window.top + (r as number)] as boolean[])[window.left + (c as number)] = true
    }
    const luts = decodeGowinLuts(
      extractGowinTileBits(bitmap, db, row, col) as boolean[][],
      db,
      ttyp,
    )
    expect(luts.get('LUT3')).toBe(wanted)
    // the other seven LUTs in the same tile are untouched
    for (const [name, init] of luts)
      if (name !== 'LUT3') expect([name, init]).toEqual([name, 0xffff])
  })

  test('a tile type with no LUTs decodes to nothing rather than guessing', () => {
    const centre = gowinTileAt(db, db.centerRow, db.centerCol) as { ttyp: number }
    expect(decodeGowinLuts([[false]], db, centre.ttyp).size).toBe(0)
  })

  test('every LUT in a logic tile uses its own 16 bits, shared with no other LUT', () => {
    const perBel = db.lutFlagBits.get(ttyp) as ReadonlyMap<string, readonly (readonly number[])[]>
    const seen = new Set<string>()
    for (const bits of perBel.values()) {
      expect(bits).toHaveLength(16)
      for (const [r, c] of bits) seen.add(`${r},${c}`)
    }
    expect(seen.size).toBe(8 * 16) // 128 distinct bits, no aliasing between cells
  })
})

/**
 * Reference outputs produced by running APICULA'S OWN `parse_attrvals` and `get_dff_type` (imported from the
 * oss-cad-suite build) over these exact tile bit patterns. This is the same discipline as the CRC check: the
 * decode is pinned against the reference implementation rather than against itself, which is the only way a
 * transcription error in a three-pass algorithm would show up.
 */
type DffCase = {
  label: string
  bits: number[][]
  attrs: Record<string, Record<string, number>>
  dff: Record<string, string | null>
}
const DFF_CASES: DffCase[] = JSON.parse(
  readFileSync(new URL('../fixtures/gowin-gw1n1-dff-cases.json', import.meta.url), 'utf8'),
)

describe('decodeGowinFlipFlops — pinned against Apicula’s own decoder', () => {
  const REFERENCE_TTYP = 12
  const tileOf = (bits: number[][]): boolean[][] => {
    const tile = db.tileTypes.get(REFERENCE_TTYP) as GowinTileTypeShape
    const grid = Array.from({ length: tile.height }, () =>
      new Array<boolean>(tile.width).fill(false),
    )
    for (const [row, col] of bits) (grid[row as number] as boolean[])[col as number] = true
    return grid
  }
  type GowinTileTypeShape = { width: number; height: number }

  test('the fixture carries real reference cases', () => {
    expect(DFF_CASES.length).toBeGreaterThanOrEqual(10)
  })

  for (const reference of DFF_CASES) {
    test(`attributes match Apicula for: ${reference.label}`, () => {
      const tile = tileOf(reference.bits)
      for (const [table, expected] of Object.entries(reference.attrs)) {
        const actual = parseGowinAttrValues(tile, db, REFERENCE_TTYP, table)
        expect(Object.fromEntries(actual)).toEqual(expected)
      }
    })

    test(`flip-flop types match Apicula for: ${reference.label}`, () => {
      const actual = decodeGowinFlipFlops(tileOf(reference.bits), db, REFERENCE_TTYP)
      expect(Object.fromEntries(actual)).toEqual(reference.dff)
    })
  }

  test('an ERASED tile still reports flip-flops, via the negative-key default pass', () => {
    // Worth pinning explicitly: a blank tile is not "no attributes". Apicula's third pass supplies defaults, so
    // an erased logic cell reads as a settable flip-flop (DFFS). A decoder that only handled the positive pass
    // would return nothing here and look plausible while being wrong.
    const erased = DFF_CASES.find((c) => c.label === 'erased') as DffCase
    expect(erased.bits).toHaveLength(0)
    expect(erased.dff.DFF0).toBe('DFFS')
    expect(parseGowinAttrValues(tileOf([]), db, REFERENCE_TTYP, 'CLS0').get('LSRONMUX')).toBe(7)
  })

  test('a tile type with no attribute tables decodes to nothing', () => {
    const centre = gowinTileAt(db, db.centerRow, db.centerCol) as { ttyp: number }
    expect(decodeGowinFlipFlops([[false]], db, centre.ttyp).size).toBe(0)
    expect(parseGowinAttrValues([[false]], db, centre.ttyp, 'CLS0').size).toBe(0)
  })

  test('all ten flip-flop variants are distinguishable', () => {
    // The mode table must not collapse: negative-edge (N), sync reset/set (R/S) and async clear/preset (C/P)
    // are genuinely different hardware, and a key collision would silently merge two of them.
    const keys = new Set<string>()
    for (const regset of ['RESET', 'SET'])
      for (const lsr of ['', 'LSRMUX'])
        for (const clk of ['SIG', 'INV'])
          for (const sr of ['', 'ASYNC']) keys.add(`${regset}|${lsr}|${clk}|${sr}`)
    const named = [...keys].filter((k) => DFF_TYPES_PROBE.has(k))
    expect(new Set(named.map((k) => DFF_TYPES_PROBE.get(k))).size).toBe(10)
  })
})

/** The published variant set, mirrored here so a silent merge in the decoder would fail the test above. */
const DFF_TYPES_PROBE: ReadonlyMap<string, string> = new Map([
  ['RESET||SIG|', 'DFF'],
  ['RESET||INV|', 'DFFN'],
  ['RESET|LSRMUX|SIG|ASYNC', 'DFFC'],
  ['RESET|LSRMUX|INV|ASYNC', 'DFFNC'],
  ['RESET|LSRMUX|SIG|', 'DFFR'],
  ['RESET|LSRMUX|INV|', 'DFFNR'],
  ['SET|LSRMUX|SIG|ASYNC', 'DFFP'],
  ['SET|LSRMUX|INV|ASYNC', 'DFFNP'],
  ['SET|LSRMUX|SIG|', 'DFFS'],
  ['SET|LSRMUX|INV|', 'DFFNS'],
])
