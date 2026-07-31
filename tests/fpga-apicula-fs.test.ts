/**
 * FPGA fabric — Gowin (Project Apicula): parse a whole vendor `.fs` bitstream (fpga-apicula-fs.ts).
 *
 * The load-bearing check is the CRC: `crc16Arc` is verified against values produced by Apicula's OWN
 * implementation (`apycula/crc16.py`, run over a deterministic byte stream). That pins the most error-prone part
 * of the format against the authoritative source rather than against ourselves — the same discipline the ECP5
 * work used, where a self-consistent round-trip hid a real bug for several commits.
 *
 * Honest limit: the container framing is transcribed from Apicula's `read_bitstream` and exercised here by `.fs`
 * files assembled byte-by-byte to that spec. It has NOT yet been run against a bitstream produced by the real
 * `gowin_pack` — getting one needs a full synthesis flow — so unlike the ECP5 suite (which now parses a genuine
 * ecppack artefact) this proves conformance to the transcribed format, not to a captured vendor file.
 */
import { describe, expect, test } from 'vitest'
import { crc16Arc, GOWIN_DEVICES, parseGowinBitstream } from '../src/renderer/fpga-apicula-fs.ts'

/** A run of bits as the `.fs` text format writes them. */
const bits = (values: boolean[]): string => values.map((b) => (b ? '1' : '0')).join('')
const byteBits = (n: number): string => n.toString(2).padStart(8, '0')
const bytesToBits = (bs: number[]): string => bs.map(byteBits).join('')

/** Build a spec-conformant `.fs`, computing per-frame CRCs the way the hardware reader will. */
function buildFs(options: {
  idcode?: number
  frames?: boolean[][]
  padding?: number
  corruptCrc?: boolean
  compressed?: boolean
}): string {
  const idcode = options.idcode ?? 0x0900281b // GW1N-1
  const padding = options.padding ?? 0
  const out: string[] = ['//Tool Version: chipblocks-test']
  // three preamble lines, which the reader skips before it starts accumulating CRC data
  for (let i = 0; i < 3; i++)
    out.push(bytesToBits([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]))
  // bit 13 of the whole 8-byte record read big-endian = bit 5 of the second-to-last byte
  if (options.compressed) out.push(bytesToBits([0x10, 0, 0, 0, 0, 0, 0x20, 0]))
  out.push(
    bytesToBits([
      0x06,
      0,
      0,
      0,
      (idcode >>> 24) & 0xff,
      (idcode >>> 16) & 0xff,
      (idcode >>> 8) & 0xff,
      idcode & 0xff,
    ]),
  )
  const frames = options.frames ?? []
  // The frame-count record is FOUR bytes, not eight — `3b 80 hi lo`, as the vendor chipdb's own `cmd_hdr` shows.
  // The earlier eight-byte version here was invented, and it hid a real bug: Apicula reads the count as
  // `int.from_bytes(ba[2:], 'big')` over EVERY remaining byte, so an eight-byte record would have made the vendor
  // tool read a wildly wrong count from a file this builder called valid.
  out.push(bytesToBits([0x3b, 0x80, (frames.length >> 8) & 0xff, frames.length & 0xff]))

  // the reader's CRC state: header lines after the preamble contribute, then each frame
  let crcData: number[] = []
  const headerAfterPreamble = out.slice(options.compressed ? 5 : 4) // the 0x06 and 0x3B records
  for (const line of headerAfterPreamble)
    for (let i = 0; i + 8 <= line.length; i += 8)
      crcData.push(Number.parseInt(line.slice(i, i + 8), 2))

  for (const frame of frames) {
    // a frame line is: padding bits, the content (stored reversed, since the reader flips it back), then 64
    // trailing bits holding the CRC at bytes [-8]/[-7].
    const content = [...frame].reverse()
    const body = '0'.repeat(padding) + bits(content)
    const bodyBytes: number[] = []
    for (let i = 0; i + 8 <= body.length; i += 8)
      bodyBytes.push(Number.parseInt(body.slice(i, i + 8), 2))
    const crc = crc16Arc([...crcData, ...bodyBytes])
    const stored = options.corruptCrc ? (crc ^ 0xffff) & 0xffff : crc
    const tail = [stored & 0xff, (stored >> 8) & 0xff, 0, 0, 0, 0, 0, 0] // 8 bytes = the trailing 64 bits
    out.push(body + bytesToBits(tail))
    crcData = tail.slice(-6)
  }
  return out.join('\n')
}

describe("crc16Arc — matches Apicula's own implementation", () => {
  test("reproduces values from Apicula's crc16.py over a deterministic byte stream", () => {
    // Reference values produced by running apycula.crc16.make_crc16_arc() over this exact stream.
    const expected: Record<number, number> = {
      0: 0x9901,
      1: 0x0359,
      7: 0x7a46,
      63: 0xc386,
      511: 0x8b00,
      1999: 0x1dd5,
    }
    let seed = 12345 >>> 0
    const data: number[] = []
    for (let n = 0; n < 2000; n++) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
      data.push((seed >>> 16) & 0xff)
      const want = expected[n]
      if (want !== undefined) expect(crc16Arc(data)).toBe(want)
    }
  })

  test('is a THIRD distinct checksum — not the iCE40 or ECP5 one', () => {
    // CRC-16/ARC's check value for "123456789" is 0xBB3D; CCITT-FALSE would give 0x29B1.
    const message = [...'123456789'].map((c) => c.charCodeAt(0))
    expect(crc16Arc(message)).toBe(0xbb3d)
    expect(crc16Arc(message)).not.toBe(0x29b1)
  })
})

describe('GOWIN_DEVICES — the part table', () => {
  test('carries the parts Apicula recognises, with distinct IDCODEs', () => {
    expect(GOWIN_DEVICES.length).toBeGreaterThanOrEqual(8)
    expect(new Set(GOWIN_DEVICES.map((d) => d.idcode)).size).toBe(GOWIN_DEVICES.length)
    const gw1n9 = GOWIN_DEVICES.find((d) => d.name === 'GW1N-9')
    expect([gw1n9?.idcode, gw1n9?.padding, gw1n9?.compressPadding]).toEqual([0x1100581b, 4, 44])
  })

  test('GW1N-2 is flagged provisional, because UPSTREAM marks it unconfirmed', () => {
    // Apicula's own bslib.py says "GW1N-2 support WIP" with padding "copied from GW1NZ-1 ... confirm
    // empirically". Carrying that flag is the honest choice: the uncertainty is upstream's, and presenting the
    // part as verified would hide it.
    expect(GOWIN_DEVICES.find((d) => d.name === 'GW1N-2')?.provisional).toBe(true)
    // every other part we list is not provisional
    for (const device of GOWIN_DEVICES)
      if (device.name !== 'GW1N-2') expect(device.provisional, device.name).toBeUndefined()
  })
})

describe('parseGowinBitstream — reads the container', () => {
  const FRAMES = [
    Array.from({ length: 64 }, (_, i) => i % 5 === 0),
    Array.from({ length: 64 }, (_, i) => i % 3 === 1),
  ]

  test('recovers the device, tool version and frames, with every per-frame CRC verified', () => {
    const parsed = parseGowinBitstream(buildFs({ frames: FRAMES }))
    expect(parsed.device?.name).toBe('GW1N-1')
    expect(parsed.idcode).toBe(0x0900281b)
    expect(parsed.toolVersion).toBe('chipblocks-test')
    expect(parsed.crcChecks).toBe(FRAMES.length)
    expect(parsed.crcOk).toBe(true)
    expect(parsed.frames).toEqual(FRAMES) // every content bit round-trips, including the row flip
  })

  test('honours the device padding when slicing a frame line', () => {
    // GW1N-9 drops 4 leading bits from every frame; getting that wrong shifts the whole row.
    const parsed = parseGowinBitstream(buildFs({ frames: FRAMES, idcode: 0x1100581b, padding: 4 }))
    expect(parsed.device?.name).toBe('GW1N-9')
    expect(parsed.frames).toEqual(FRAMES)
  })

  test('a corrupted frame CRC is reported, not thrown', () => {
    const parsed = parseGowinBitstream(buildFs({ frames: FRAMES, corruptCrc: true }))
    expect(parsed.crcOk).toBe(false) // structural parse still succeeds; the CRC catches it
    expect(parsed.frames).toHaveLength(FRAMES.length)
  })
})

describe('parseGowinBitstream — refuses honestly, never mis-parses', () => {
  test('a COMPRESSED stream is refused rather than mis-read', () => {
    expect(() => parseGowinBitstream(buildFs({ frames: [], compressed: true }))).toThrow(
      /COMPRESSED/,
    )
  })

  test('an unknown IDCODE is refused, because its frame padding is unknown', () => {
    expect(() => parseGowinBitstream(buildFs({ idcode: 0x12345678 }))).toThrow(/not a part we know/)
  })

  test('a file that is not a .fs at all is refused', () => {
    expect(() => parseGowinBitstream('just some text\nnot a bitstream\n')).toThrow(/not a Gowin/i)
  })

  test('a .fs with no frame-count record is refused', () => {
    const noCount = ['//Tool Version: x', bytesToBits([0xff, 0, 0, 0, 0, 0, 0, 0])].join('\n')
    expect(() => parseGowinBitstream(noCount)).toThrow(/frame-count/)
  })
})
