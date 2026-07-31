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
  type GowinChipdb,
  gowinFabricInventory,
  gowinTileAt,
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
