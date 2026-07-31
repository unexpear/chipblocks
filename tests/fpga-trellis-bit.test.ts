/**
 * FPGA fabric — ECP5 (Project Trellis): parse a whole vendor `.bit` bitstream (fpga-trellis-bit.ts).
 *
 * The load-bearing check is the CRC: `crc16Trellis` is verified against values produced by Project Trellis's OWN
 * C++ (`update_crc16` / `finalise_crc16` from libtrellis/src/Bitstream.cpp, compiled and run over a deterministic
 * byte stream). That pins the trickiest, most error-prone part of the format against the authoritative source
 * rather than against ourselves. The container framing (preamble, command stream, frame payload) is transcribed
 * from the same file and exercised here by bitstreams assembled byte-by-byte to that spec.
 *
 * The container is ALSO checked against a genuine vendor artefact: `fixtures/trellis-ecp5-asym-lut.bit` was
 * produced by the real Project Trellis `ecppack` (from the prebuilt oss-cad-suite), and this suite requires our
 * parser to read it end to end — the right device off its IDCODE, the CRC verifying over the real command stream,
 * and all 7562 configuration frames extracted.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { crc16Trellis, ECP5_DEVICES, parseEcp5Bitstream } from '../src/renderer/fpga-trellis-bit.ts'
import {
  decodeEcp5Luts,
  parseEcp5TileBits,
  parseEcp5TileGrid,
} from '../src/renderer/fpga-trellis-tiles.ts'

/** Trellis `finalise_crc16` — push the last 16 bits through. */
const finalise = (crc: number): number => {
  let c = crc & 0xffff
  for (let i = 0; i < 16; i++) {
    const bit = (c >> 15) & 1
    c = (c << 1) & 0xffff
    if (bit) c ^= 0x8005
  }
  return c
}

/** Build a spec-conformant ECP5 bitstream, computing its CRCs the way the hardware reader will. */
function buildBitstream(options: {
  comment?: string
  idcode?: number
  usercode?: number
  frames?: boolean[][]
  bitsPerFrame?: number
  corruptFrameByte?: boolean
}): Uint8Array {
  const out: number[] = []
  let crc = 0
  const w = (b: number): void => {
    out.push(b & 0xff)
    crc = crc16Trellis(crc, b & 0xff)
  }
  const wDummy = (): void => {
    out.push(0xff) // a DUMMY byte is not part of the CRC
  }
  const wCrc = (): void => {
    const v = finalise(crc)
    out.push((v >> 8) & 0xff, v & 0xff)
    crc = 0
  }
  if (options.comment) for (const ch of options.comment) out.push(ch.charCodeAt(0) & 0xff)
  out.push(0xff, 0xff, 0xbd, 0xb3) // preamble (before the CRC starts)

  if (options.idcode !== undefined) {
    w(0xe2) // VERIFY_ID
    w(0)
    w(0)
    w(0)
    w((options.idcode >>> 24) & 0xff)
    w((options.idcode >>> 16) & 0xff)
    w((options.idcode >>> 8) & 0xff)
    w(options.idcode & 0xff)
  }
  if (options.usercode !== undefined) {
    w(0xc2) // ISC_PROGRAM_USERCODE, with the check-CRC flag set
    w(0x80)
    w(0)
    w(0)
    w((options.usercode >>> 24) & 0xff)
    w((options.usercode >>> 16) & 0xff)
    w((options.usercode >>> 8) & 0xff)
    w(options.usercode & 0xff)
    wCrc()
  }
  const frames = options.frames
  if (frames) {
    const bitsPerFrame = options.bitsPerFrame as number
    const bytesPerFrame = bitsPerFrame / 8
    w(0x82) // LSC_PROG_INCR_RTI
    w(0x80) // check CRC, after the LAST frame only (bit 0x40 set = not every frame)... see below
    w((frames.length >> 8) & 0xff)
    w(frames.length & 0xff)
    // 0x80 with bit 0x40 CLEAR means "check after every frame" (the flag is inverted in Trellis)
    frames.forEach((row, fi) => {
      const bytes = new Uint8Array(bytesPerFrame)
      row.forEach((bit, j) => {
        if (!bit) return
        const idx = bytesPerFrame - 1 - Math.floor(j / 8)
        bytes[idx] = (bytes[idx] as number) | (1 << (j % 8))
      })
      for (const b of bytes) w(b)
      if (options.corruptFrameByte && fi === 0)
        out[out.length - 1] = (out[out.length - 1] as number) ^ 0xff
      wCrc() // this stream checks after every frame
    })
  }
  wDummy()
  w(0x5e) // ISC_PROGRAM_DONE with check-CRC
  w(0x80)
  w(0)
  w(0)
  wCrc()
  return Uint8Array.from(out)
}

describe("crc16Trellis — matches Project Trellis's own implementation", () => {
  test("reproduces values from Trellis's compiled C++ over a deterministic byte stream", () => {
    // Reference values produced by compiling update_crc16/finalise_crc16 straight out of
    // libtrellis/src/Bitstream.cpp and running them over this exact stream.
    const expected: Record<number, number> = {
      0: 0x82cb,
      1: 0x4817,
      7: 0xa548,
      63: 0x7416,
      511: 0x7689,
      1999: 0xf929,
    }
    let seed = 12345 >>> 0
    let crc = 0
    for (let n = 0; n < 2000; n++) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
      crc = crc16Trellis(crc, (seed >>> 16) & 0xff)
      const want = expected[n]
      if (want !== undefined) expect(finalise(crc)).toBe(want)
    }
  })

  test('is a DIFFERENT checksum from the iCE40 one (poly 0x8005 / init 0x0000)', () => {
    // the CCITT check value for "123456789" is 0x29B1; this polynomial must not produce it
    let crc = 0
    for (const ch of '123456789') crc = crc16Trellis(crc, ch.charCodeAt(0))
    expect(finalise(crc)).not.toBe(0x29b1)
  })
})

describe('ECP5_DEVICES — the device table', () => {
  test('covers the ten ECP5 parts with distinct IDCODEs and whole-byte frames', () => {
    expect(ECP5_DEVICES).toHaveLength(10)
    expect(new Set(ECP5_DEVICES.map((d) => d.idcode)).size).toBe(10)
    for (const d of ECP5_DEVICES) {
      const bits = d.bitsPerFrame + d.padBitsBeforeFrame + d.padBitsAfterFrame
      expect(bits % 8).toBe(0) // a frame must be a whole number of bytes
      expect(d.frames).toBeGreaterThan(0)
    }
    // spot-check against Trellis's devices.json
    const u25 = ECP5_DEVICES.find((d) => d.name === 'LFE5U-25F')
    expect([u25?.idcode, u25?.frames, u25?.bitsPerFrame]).toEqual([0x41111043, 7562, 592])
  })
})

describe('parseEcp5Bitstream — reads the container', () => {
  const FRAMES = [
    Array.from({ length: 592 }, (_, i) => i % 7 === 0),
    Array.from({ length: 592 }, (_, i) => i % 3 === 1),
    Array.from({ length: 592 }, () => false),
  ]

  test('recovers the device, usercode, comment and frames, with the CRC verified', () => {
    const bits = buildBitstream({
      comment: 'chipblocks ecp5 test',
      idcode: 0x41111043, // LFE5U-25F
      usercode: 0xdeadbeef,
      frames: FRAMES,
      bitsPerFrame: 592,
    })
    const parsed = parseEcp5Bitstream(bits)
    expect(parsed.device?.name).toBe('LFE5U-25F')
    expect(parsed.idcode).toBe(0x41111043)
    expect(parsed.usercode).toBe(0xdeadbeef)
    expect(parsed.comment).toBe('chipblocks ecp5 test')
    expect(parsed.programDone).toBe(true)
    expect(parsed.crcOk).toBe(true)
    expect(parsed.crcChecks).toBeGreaterThanOrEqual(FRAMES.length)
    // The parser returns the DEVICE's full frame set (unwritten frames read as zero), and ECP5 streams frames in
    // reverse — so the first frame on the wire is the last frame of the device.
    expect(parsed.frames).toHaveLength(7562)
    FRAMES.forEach((frame, i) => {
      expect(parsed.frames[7562 - 1 - i]).toEqual(frame)
    })
  })

  test('a corrupted frame byte is reported as crcOk=false, not thrown', () => {
    const bits = buildBitstream({
      idcode: 0x41111043,
      frames: FRAMES,
      bitsPerFrame: 592,
      corruptFrameByte: true,
    })
    const parsed = parseEcp5Bitstream(bits)
    expect(parsed.crcOk).toBe(false) // structural parse still succeeds; the CRC catches it
    expect(parsed.frames).toHaveLength(7562)
  })
})

describe('parseEcp5Bitstream — refuses honestly, never mis-parses', () => {
  test('a file with no ECP5 preamble throws', () => {
    // an iCE40 bitstream starts 7E AA 99 7E and carries no FF FF BD B3 sync
    const ice40ish = Uint8Array.from([0x7e, 0xaa, 0x99, 0x7e, 0x51, 0x00, 0x01, 0x06])
    expect(() => parseEcp5Bitstream(ice40ish)).toThrow(/preamble/i)
  })

  test('frame data before the device is identified throws rather than guessing geometry', () => {
    const bits = Uint8Array.from([0xff, 0xff, 0xbd, 0xb3, 0x82, 0x80, 0x00, 0x01])
    expect(() => parseEcp5Bitstream(bits)).toThrow(/before the bitstream identified its device/)
  })

  test('an unknown IDCODE is reported, and its frame data refused (geometry unknown)', () => {
    const noFrames = parseEcp5Bitstream(buildBitstream({ idcode: 0x12345678 }))
    expect(noFrames.idcode).toBe(0x12345678)
    expect(noFrames.device).toBeNull() // recognised the field, did not invent a part
    const withFrames = Uint8Array.from([
      0xff, 0xff, 0xbd, 0xb3, 0xe2, 0, 0, 0, 0x12, 0x34, 0x56, 0x78, 0x82, 0x80, 0x00, 0x01,
    ])
    expect(() => parseEcp5Bitstream(withFrames)).toThrow(/unknown device/)
  })

  test('a COMPRESSED bitstream is refused, not silently mis-read', () => {
    const bits = Uint8Array.from([
      0xff, 0xff, 0xbd, 0xb3, 0xe2, 0, 0, 0, 0x41, 0x11, 0x10, 0x43, 0xb8,
    ])
    expect(() => parseEcp5Bitstream(bits)).toThrow(/COMPRESSED/)
  })

  test('EBR (block-RAM) data is refused', () => {
    const bits = Uint8Array.from([
      0xff, 0xff, 0xbd, 0xb3, 0xe2, 0, 0, 0, 0x41, 0x11, 0x10, 0x43, 0xf6,
    ])
    expect(() => parseEcp5Bitstream(bits)).toThrow(/EBR/)
  })

  test('an unknown command byte throws', () => {
    const bits = Uint8Array.from([0xff, 0xff, 0xbd, 0xb3, 0x11])
    expect(() => parseEcp5Bitstream(bits)).toThrow(/Unknown ECP5 bitstream command/)
  })
})

describe('parseEcp5Bitstream — a GENUINE ecppack bitstream', () => {
  // Produced by the real Project Trellis ecppack (oss-cad-suite build) for an LFE5U-25F. Unlike the assembled
  // streams above, nothing about this file came from our own code: it is a vendor-tool artefact.
  const REAL = new Uint8Array(
    readFileSync(new URL('../fixtures/trellis-ecp5-asym-lut.bit', import.meta.url)),
  )

  test('reads a real vendor bitstream: right device, CRC verified, every frame recovered', () => {
    const parsed = parseEcp5Bitstream(REAL)
    expect(parsed.device?.name).toBe('LFE5U-25F') // identified from the file's own IDCODE
    expect(parsed.idcode).toBe(0x41111043)
    expect(parsed.crcOk).toBe(true) // our CRC-16 agrees with the real tool's over the whole command stream
    expect(parsed.crcChecks).toBeGreaterThan(0)
    expect(parsed.programDone).toBe(true)
    // the device's full frame set, each the declared width
    expect(parsed.frames).toHaveLength(7562)
    for (const frame of parsed.frames) expect(frame).toHaveLength(592)
  }, 60000)

  test('frames are stored in the REVERSED order ECP5 streams them in', () => {
    // ECP5 sends the LAST frame of the device first (Trellis `reversed_frames`). Reading them in wire order puts
    // every tile's bits ~1300 frames away from where the tile grid says they are — and a synthetic round-trip
    // cannot catch that, because it writes and reads with the same wrong convention. This real bitstream can:
    // its one programmed LUT sits in tile R20C30, whose window starts at frame 3110.
    const parsed = parseEcp5Bitstream(REAL)
    const setFrames: number[] = []
    parsed.frames.forEach((frame, index) => {
      if (frame[241]) setFrames.push(index) // bit 241 = the tile's bit 231 + the INIT word's bit 10
    })
    expect(setFrames.length).toBeGreaterThan(0)
    // every one of those bits must land inside the tile's own 106-frame window, not off in the reversed half
    for (const index of setFrames) {
      expect(index).toBeGreaterThanOrEqual(3110)
      expect(index).toBeLessThan(3110 + 106)
    }
  }, 60000)

  test('the config-word BIT ORDER, verified against the real tool rather than derived from its source', () => {
    // This is the check no vendored fixture could make: every `.config` default in the database is the symmetric
    // all-ones word, so only a bitstream carrying a deliberately ASYMMETRIC value can distinguish the order.
    // This artefact was packed by real ecppack from `word: SLICEA.K0.INIT 1000000000000011`, and ecpunpack
    // round-trips that same string back out of it, so the value in the file is not in doubt.
    const parsed = parseEcp5Bitstream(REAL)
    const grid = parseEcp5TileGrid(
      readFileSync(
        new URL('../fixtures/trellis-ecp5-LFE5U-25F-tilegrid.json', import.meta.url),
        'utf8',
      ),
    )
    const plc2 = parseEcp5TileBits(
      readFileSync(new URL('../fixtures/trellis-ecp5-PLC2-bits.db', import.meta.url), 'utf8'),
    )
    const luts = decodeEcp5Luts(parsed.frames, grid, plc2)
    expect(luts).toHaveLength(1) // exactly the one LUT the design programs
    const lut = luts[0]
    expect([lut?.tile, lut?.slice, lut?.lut]).toEqual(['R20C30', 'A', 0])
    // Trellis prints a word REVERSED (Util.hpp to_string), so entry 0 is the LAST character of the config string.
    // '1000000000000011' must therefore decode to '1100000000000001' — the reversal. Reading it the other way
    // round would give back the config string unchanged, so this assertion genuinely distinguishes the two.
    const decoded = (lut?.truth ?? []).map((b) => (b ? '1' : '0')).join('')
    expect(decoded).toBe('1100000000000001')
    expect(decoded).not.toBe('1000000000000011')
  }, 60000)
})
