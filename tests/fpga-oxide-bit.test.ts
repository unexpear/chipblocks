/**
 * FPGA fabric — Lattice Nexus: the `.bit` container reader (`fpga-oxide-bit.ts`).
 *
 * Every number here comes from one of three places, never from a guess:
 *
 *  1. `prjoxide unpack`'s own account of the same file. Run 2026-08-03 on `fixtures/nexus-lifcl40-xnor-dff.bit`:
 *
 *       bitstream start at 12 / reset CRC / reset CRC / check IDCODE is 0x010F1043 / set CTRL0 to 0x00000000
 *       set frame address to 0x00008000 / write 32 frames at 0x00008000 / reset frame address
 *       write 9116 frames at 0x00000000 / set frame address to 0x00008020 / write 24 frames at 0x00008020
 *       power control: 1 / set usercode to 0x00000000 / done
 *
 *  2. `prjoxide-db`'s `devices.json` and `LIFCL-40/tilegrid.json` (CC0-1.0) — the geometry and the tile floor plan.
 *
 *  3. The strongest of the three, and the one the whole-file claim rests on: RE-SERIALISATION. `prjoxide pack`
 *     builds a `.bit` from its own configuration memory by a fixed recipe. Applying that same recipe to what WE
 *     read out of a real packed file has to reproduce it byte for byte — so every frame bit, every bus byte and
 *     every container field we recovered is exactly the one `prjoxide` put there. A value oracle over the whole
 *     file, not a shape.
 *
 * Re-serialisation alone cannot catch a mistake made symmetrically in the read and the write — a frame read from
 * the wrong index and written back to the same wrong index still round-trips. The `-holes` fixture is what closes
 * that: it is the same design with five named tiles' features deleted, one in each of the four regions the frame
 * ADDRESS space is divided into, and every configuration bit that changes has to land inside the window
 * `tilegrid.json` gives that tile. That is an independent check on the frame index AND the bit index.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  diffNexusCram,
  findNexusDevice,
  getNexusCramBit,
  identifyLatticeBitstream,
  NEXUS_DEVICES,
  nexusFrameAddressToIndex,
  parseNexusBitstream,
  serialiseNexusBitstream,
} from '../src/renderer/fpga-oxide-bit.ts'
import {
  ECP5_DEVICES,
  NEXUS_DEVICES as TRELLIS_NEXUS_IDS,
} from '../src/renderer/fpga-trellis-bit.ts'

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)))

/** Every Nexus `.bit` we own, all built by `prjoxide pack` from a real placed-and-routed design. */
const NEXUS_FIXTURES = [
  'nexus-lifcl40-xnor-dff.bit',
  'nexus-lifcl40-xnor-dff-prod.bit',
  'nexus-lifcl40-xnor-dff-holes.bit',
  'nexus-lifcl40-bram1k.bit',
  'nexus-lifcl17-blank.bit',
  'nexus-lifcl17-metadata.bit',
  'oxide-nexus-lifcl40-counter.bit',
]

/** Every ECP5 `.bit` we own — the other family that opens with the same FF FF BD B3 marker. */
const ECP5_FIXTURES = [
  'trellis-ecp5-asym-lut.bit',
  'trellis-ecp5-ccu2-add4.bit',
  'trellis-ecp5-dpram.bit',
  'trellis-ecp5-lut-reg.bit',
  'trellis-ecp5-shift8.bit',
  'trellis-ecp5-widemux.bit',
]

const countSetBits = (bits: Uint8Array): number => {
  let total = 0
  for (const byte of bits) {
    let b = byte
    while (b !== 0) {
      total += b & 1
      b >>= 1
    }
  }
  return total
}

describe('the Nexus part table', () => {
  test('pins BOTH LIFCL-40 identifying numbers — the engineering sample AND the production part', () => {
    // Open-source write-ups quote 0x010F1043 for the LIFCL-40. That is the ENGINEERING SAMPLE. Every Nexus file
    // we own is an ES part, so a reader built on that one number passes on all of our fixtures and rejects every
    // production chip a real user owns. Both are required, and both are exercised by a real bitstream below.
    const engineeringSample = NEXUS_DEVICES.find((d) => d.idcode === 0x010f1043)
    const production = NEXUS_DEVICES.find((d) => d.idcode === 0x110f1043)
    expect(engineeringSample?.name).toBe('LIFCL-40')
    expect(engineeringSample?.variant).toBe('ES')
    expect(production?.name).toBe('LIFCL-40')
    expect(production?.variant).toBe('')
    expect(production?.frames).toBe(engineeringSample?.frames)
    expect(production?.bitsPerFrame).toBe(engineeringSample?.bitsPerFrame)
  })

  test('carries the whole family, with the geometry prjoxide-db gives each part', () => {
    expect(
      NEXUS_DEVICES.map((d) => [
        d.name,
        d.variant,
        `0x${d.idcode.toString(16).padStart(8, '0')}`,
        d.frames,
        d.bitsPerFrame,
        d.tapFrameCount,
      ]),
    ).toEqual([
      ['LIFCL-40', '', '0x110f1043', 9172, 662, 24],
      ['LIFCL-40', 'ES', '0x010f1043', 9172, 662, 24],
      ['LFD2NX-40', '', '0x310f1043', 9172, 662, 24],
      ['LIFCL-17', '', '0x010f0043', 7900, 338, 24],
      ['LFCPNX-100', '', '0x010f4043', 16822, 878, 42],
    ])
  })

  test('names the same five parts fpga-trellis-bit.ts refuses Nexus files by', () => {
    // Two files hold Nexus identifying numbers: this one, and the ECP5 reader's refusal table. They must not
    // drift apart, or a file one calls Nexus the other calls unknown.
    expect(new Set(NEXUS_DEVICES.map((d) => d.idcode))).toEqual(
      new Set(TRELLIS_NEXUS_IDS.map((d) => d.idcode)),
    )
  })

  test('does not collide with any ECP5 identifying number', () => {
    const nexus = new Set(NEXUS_DEVICES.map((d) => d.idcode >>> 0))
    for (const d of ECP5_DEVICES) expect(nexus.has(d.idcode >>> 0)).toBe(false)
  })
})

describe('telling a Nexus file from an ECP5 one', () => {
  test('every real Nexus fixture is named Nexus, and the right part', () => {
    expect(NEXUS_FIXTURES.map((f) => identifyLatticeBitstream(fixture(f)))).toEqual([
      { family: 'nexus', idcode: 0x010f1043, deviceName: 'LIFCL-40' },
      { family: 'nexus', idcode: 0x110f1043, deviceName: 'LIFCL-40' },
      { family: 'nexus', idcode: 0x010f1043, deviceName: 'LIFCL-40' },
      { family: 'nexus', idcode: 0x010f1043, deviceName: 'LIFCL-40' },
      { family: 'nexus', idcode: 0x010f0043, deviceName: 'LIFCL-17' },
      { family: 'nexus', idcode: 0x010f0043, deviceName: 'LIFCL-17' },
      { family: 'nexus', idcode: 0x010f1043, deviceName: 'LIFCL-40' },
    ])
  })

  test('every real ECP5 fixture is named ECP5, not Nexus', () => {
    for (const name of ECP5_FIXTURES) {
      const identity = identifyLatticeBitstream(fixture(name))
      expect(identity?.family).toBe('ecp5')
      expect(identity?.deviceName).toBe('LFE5U-25F')
    }
  })

  test('a file with no Lattice preamble is neither family', () => {
    expect(identifyLatticeBitstream(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull()
  })

  test('findNexusDevice separates the two LIFCL-40 revisions', () => {
    expect(findNexusDevice(0x010f1043)?.variant).toBe('ES')
    expect(findNexusDevice(0x110f1043)?.variant).toBe('')
    expect(findNexusDevice(0x41111043)).toBeNull()
  })
})

describe('reading a real LIFCL-40 bitstream', () => {
  const parsed = parseNexusBitstream(fixture('nexus-lifcl40-xnor-dff.bit'))

  test('recovers exactly the container prjoxide unpack reports', () => {
    expect(parsed.device.name).toBe('LIFCL-40')
    expect(parsed.device.variant).toBe('ES')
    expect(parsed.idcode).toBe(0x010f1043)
    expect(parsed.controlWords).toEqual([0x00000000])
    expect(parsed.frameWrites).toEqual([
      { address: 0x8000, count: 32 },
      { address: 0x0000, count: 9116 },
      { address: 0x8020, count: 24 },
    ])
    expect(parsed.powerControl).toBe(1)
    expect(parsed.usercode).toBe(0)
    expect(parsed.programDone).toBe(true)
    expect(parsed.metadata).toEqual([])
  })

  test('every checksum in the file passes, and no frame is written off the device', () => {
    expect(parsed.crcOk).toBe(true)
    // One CRC per frame, plus one over the usercode.
    expect(parsed.crcChecks).toBe(9172 + 1)
    expect(parsed.framesOutsideDevice).toBe(0)
  })

  test('every frame ECC recomputes to the value stored in the frame', () => {
    expect(parsed.eccMismatchFrames).toBe(0)
  })

  test('the configuration memory is the size the device database gives, and is not empty', () => {
    expect(parsed.cram.frames).toBe(9172)
    expect(parsed.cram.bitsPerFrame).toBe(662)
    expect(countSetBits(parsed.cram.bits)).toBe(2093)
  })
})

describe('reading a second part with a different geometry', () => {
  const parsed = parseNexusBitstream(fixture('nexus-lifcl17-blank.bit'))

  test('a LIFCL-17 is read with the LIFCL-17 frame geometry, not the LIFCL-40 one', () => {
    expect(parsed.device.name).toBe('LIFCL-17')
    expect(parsed.cram.frames).toBe(7900)
    expect(parsed.cram.bitsPerFrame).toBe(338)
    // 7900 total = 32 IO + 7844 main + 24 TAP, which is what prjoxide unpack prints for this file.
    expect(parsed.frameWrites).toEqual([
      { address: 0x8000, count: 32 },
      { address: 0x0000, count: 7844 },
      { address: 0x8020, count: 24 },
    ])
    expect(parsed.crcOk).toBe(true)
    expect(parsed.eccMismatchFrames).toBe(0)
    expect(countSetBits(parsed.cram.bits)).toBe(583)
  })
})

describe('the metadata comment', () => {
  test('the strings the vendor tool wrote into the header come back, both of them', () => {
    // Built by `prjoxide pack` from a FASM carrying two `oxide.meta` attributes. Its unpack prints the first of
    // them ("Metadata: Part: LIFCL-17-7SG72C"); the second is only visible in the file itself.
    const parsed = parseNexusBitstream(fixture('nexus-lifcl17-metadata.bit'))
    expect(parsed.metadata).toEqual(['Part: LIFCL-17-7SG72C', 'Date: ChipBlocks test fixture'])
    expect(parsed.device.name).toBe('LIFCL-17')
    expect(parsed.crcOk).toBe(true)
  })
})

describe('reading the IP / block-RAM bus writes', () => {
  const parsed = parseNexusBitstream(fixture('nexus-lifcl40-bram1k.bit'))

  test('a design with block memory carries bus configuration bytes as well as frames', () => {
    expect(parsed.ipConfig.size).toBe(2560)
    const addresses = [...parsed.ipConfig.keys()].sort((a, b) => a - b)
    expect(addresses[0]).toBe(0x20040000)
    expect(addresses[addresses.length - 1]).toBe(0x200409ff)
    expect(addresses.every((a, i) => i === 0 || a === (addresses[i - 1] as number) + 1)).toBe(true)
    // A 1 kbit memory's contents are really in there — not a run of zeroes that would round-trip either way.
    expect([...parsed.ipConfig.values()].filter((v) => v !== 0).length).toBe(2499)
    // Block RAM sits in bus region 2, whose transfers are five bytes wide; 2560 bytes is 512 such frames, and the
    // file carries one extra CRC check for that transfer on top of the per-frame ones.
    expect(parsed.crcChecks).toBe(9172 + 1 + 1)
    expect(parsed.crcOk).toBe(true)
  })
})

describe('re-serialisation — the whole-file value oracle', () => {
  test.each(NEXUS_FIXTURES)('%s comes back byte for byte', (name) => {
    const bytes = fixture(name)
    expect(Array.from(serialiseNexusBitstream(parseNexusBitstream(bytes)))).toEqual(
      Array.from(bytes),
    )
  })
})

describe('the production part and the engineering sample', () => {
  test('the same design on both revisions differs ONLY in the identifying number', () => {
    const es = parseNexusBitstream(fixture('nexus-lifcl40-xnor-dff.bit'))
    const production = parseNexusBitstream(fixture('nexus-lifcl40-xnor-dff-prod.bit'))
    expect(production.idcode).not.toBe(es.idcode)
    expect(production.device.variant).toBe('')
    expect(diffNexusCram(es.cram, production.cram)).toEqual([])
  })
})

describe('where a frame lands — checked against the CC0 tile floor plan', () => {
  type GridTile = { start_frame: number; frames: number; start_bit: number; bits: number }
  const grid = JSON.parse(
    readFileSync(
      new URL('../fixtures/oxide-nexus-lifcl40-tilegrid-slice.json', import.meta.url),
      'utf8',
    ),
  ).tiles as Record<string, GridTile>

  const base = parseNexusBitstream(fixture('nexus-lifcl40-xnor-dff.bit'))
  const holes = parseNexusBitstream(fixture('nexus-lifcl40-xnor-dff-holes.bit'))
  const changed = diffNexusCram(base.cram, holes.cram)

  const inside = (tile: GridTile, frame: number, bit: number): boolean =>
    frame >= tile.start_frame &&
    frame < tile.start_frame + tile.frames &&
    bit >= tile.start_bit &&
    bit < tile.start_bit + tile.bits

  test('the die size in the part table matches where the tile floor plan puts tiles', () => {
    const device = findNexusDevice(0x010f1043)
    const columns = Object.values(grid).map((t) => (t as unknown as { x: number }).x)
    const rows = Object.values(grid).map((t) => (t as unknown as { y: number }).y)
    expect(Math.max(...columns)).toBe(device?.maxCol)
    expect(Math.max(...rows)).toBe(device?.maxRow)
  })

  test('deleting five named tiles changes bits, and changes nothing outside those five windows', () => {
    expect(changed.length).toBe(20)
    const stray = changed.filter(
      ({ frame, bit }) => !Object.values(grid).some((t) => inside(t, frame, bit)),
    )
    expect(stray).toEqual([])
  })

  test.each([
    // tile, which piece of the frame ADDRESS space its frames come from, how many bits it lost
    ['CIB_R15C0:SYSIO_B7_0_ODD', 'left-side IO frames (address 0x8010-0x801F)', 11],
    ['TAP_PLC_R5C14:TAP_PLC', 'TAP frames (address 0x8020+)', 4],
    ['CIB_R10C87:SYSIO_B1_0_C', 'right-side IO frames (address 0x8000-0x800F)', 2],
    ['CIB_R14C1:CIB_LR', 'the low end of the main frames', 2],
    ['CIB_R56C85:SYSIO_B3_1_V18', 'the high end of the main frames', 1],
  ])('%s — %s — loses exactly its own bits', (name, _region, expectedBits) => {
    const tile = grid[name] as GridTile
    const hits = changed.filter(({ frame, bit }) => inside(tile, frame, bit))
    expect(hits.length).toBe(expectedBits)
    // and those bits really were set before the tile's features were deleted
    for (const { frame, bit } of hits) expect(getNexusCramBit(base.cram, frame, bit)).toBe(true)
  })
})

describe('the frame address map', () => {
  const lifcl40 = findNexusDevice(0x010f1043)
  if (lifcl40 === null) throw new Error('LIFCL-40 missing from the device table')

  test('the four pieces of the address space land where prjoxide chip.rs puts them', () => {
    // main frames count DOWN from the top of the array
    expect(nexusFrameAddressToIndex(lifcl40, 0x0000)).toBe(9171)
    expect(nexusFrameAddressToIndex(lifcl40, 0x0001)).toBe(9170)
    expect(nexusFrameAddressToIndex(lifcl40, 9115)).toBe(56)
    // right-side IO: index 40..55
    expect(nexusFrameAddressToIndex(lifcl40, 0x8000)).toBe(55)
    expect(nexusFrameAddressToIndex(lifcl40, 0x800f)).toBe(40)
    // left-side IO: index 0..15
    expect(nexusFrameAddressToIndex(lifcl40, 0x8010)).toBe(15)
    expect(nexusFrameAddressToIndex(lifcl40, 0x801f)).toBe(0)
    // TAP frames: index 16..39
    expect(nexusFrameAddressToIndex(lifcl40, 0x8020)).toBe(39)
    expect(nexusFrameAddressToIndex(lifcl40, 0x8037)).toBe(16)
  })

  test('an address this device has no frame for is reported as none, not as frame zero', () => {
    expect(nexusFrameAddressToIndex(lifcl40, 0x8038)).toBe(-1)
    expect(nexusFrameAddressToIndex(lifcl40, 0x7fff)).toBe(-1)
    expect(nexusFrameAddressToIndex(lifcl40, 0x9000)).toBe(-1)
  })

  test('the map covers every index of the device exactly once', () => {
    const seen = new Set<number>()
    for (const address of [
      ...Array.from({ length: 9116 }, (_, i) => i),
      ...Array.from({ length: 32 }, (_, i) => 0x8000 + i),
      ...Array.from({ length: 24 }, (_, i) => 0x8020 + i),
    ]) {
      const index = nexusFrameAddressToIndex(lifcl40, address)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(seen.has(index)).toBe(false)
      seen.add(index)
    }
    expect(seen.size).toBe(9172)
  })
})

describe('what it refuses, and what it says', () => {
  /** The container is fixed-size up to the first frame block, so these offsets are the same in every file. */
  const VERIFY_ID_AT = 48
  const IDCODE_AT = 52
  const FRAME_BLOCK_AT = 72

  test('the offsets those refusal tests patch really are where the commands are', () => {
    const bytes = fixture('nexus-lifcl40-xnor-dff.bit')
    expect(bytes[VERIFY_ID_AT]).toBe(0xe2)
    expect(bytes[FRAME_BLOCK_AT]).toBe(0x82)
    expect(bytes[FRAME_BLOCK_AT + 1]).toBe(0x91)
  })

  const patched = (...edits: [number, number][]): Uint8Array => {
    const bytes = fixture('nexus-lifcl40-xnor-dff.bit').slice()
    for (const [at, value] of edits) bytes[at] = value
    return bytes
  }

  test('an ECP5 file is named as an ECP5, not read as a broken Nexus', () => {
    expect(() => parseNexusBitstream(fixture('trellis-ecp5-lut-reg.bit'))).toThrow(
      /ECP5 chip file \(a LFE5U-25F\)/,
    )
  })

  test('an unknown part is named by its number rather than read with guessed geometry', () => {
    expect(() =>
      parseNexusBitstream(
        patched(
          [IDCODE_AT, 0xde],
          [IDCODE_AT + 1, 0xad],
          [IDCODE_AT + 2, 0xbe],
          [IDCODE_AT + 3, 0xef],
        ),
      ),
    ).toThrow(/0xdeadbeef/)
  })

  test('a compressed frame payload is refused with its reason, not silently mis-read', () => {
    expect(() => parseNexusBitstream(patched([FRAME_BLOCK_AT, 0xb8]))).toThrow(/COMPRESSED/)
  })

  test('a compression dictionary is refused for the same reason', () => {
    expect(() => parseNexusBitstream(patched([FRAME_BLOCK_AT, 0x02]))).toThrow(/COMPRESSED/)
  })

  test('a frame block with unknown load settings is refused, not read as if it were plain', () => {
    expect(() => parseNexusBitstream(patched([FRAME_BLOCK_AT + 1, 0x92]))).toThrow(
      /load settings 0x92/,
    )
  })

  test('a readback capture is refused with its reason', () => {
    // The metadata comment ends 00 FF in a programming file and 00 FE in a readback one.
    expect(() => parseNexusBitstream(patched([7, 0xfe]))).toThrow(/READBACK/)
  })

  test('an unknown command is refused, naming the opcode and where it was', () => {
    expect(() => parseNexusBitstream(patched([VERIFY_ID_AT - 4, 0x11]))).toThrow(
      /Unknown Nexus bitstream command 0x11/,
    )
  })

  test('a frame not followed by its FF separator is refused', () => {
    // The first frame's 85 payload bytes and 2 CRC bytes start at FRAME_BLOCK_AT + 4.
    expect(() => parseNexusBitstream(patched([FRAME_BLOCK_AT + 4 + 85 + 2, 0x00]))).toThrow(
      /not followed by the expected FF/,
    )
  })

  test('frames written to an address the device has no frame for are counted, not folded onto another frame', () => {
    // The container is fixed-size all the way to the last frame-address command, so this offset is exact — and the
    // assertion below is what proves it. Moving the TAP block from 0x8020 to 0x8038 puts all 24 of its frames past
    // the end of this device's 24 TAP frames; the naive formula would alias them onto the left-side IO frames.
    const TAP_ADDRESS_AT = 805146
    const bytes = fixture('nexus-lifcl40-xnor-dff.bit').slice()
    expect(bytes[TAP_ADDRESS_AT - 4]).toBe(0xb4)
    expect([bytes[TAP_ADDRESS_AT + 2], bytes[TAP_ADDRESS_AT + 3]]).toEqual([0x80, 0x20])
    bytes[TAP_ADDRESS_AT + 3] = 0x38
    const parsed = parseNexusBitstream(bytes)
    expect(parsed.framesOutsideDevice).toBe(24)
    const untouched = parseNexusBitstream(fixture('nexus-lifcl40-xnor-dff.bit'))
    for (let frame = 0; frame < 16; frame++)
      for (let bit = 0; bit < 662; bit++)
        expect(getNexusCramBit(parsed.cram, frame, bit)).toBe(
          getNexusCramBit(untouched.cram, frame, bit),
        )
  })

  test('the power-control byte is read out of the file, not assumed', () => {
    const POWER_CONTROL_AT = 807286
    const bytes = fixture('nexus-lifcl40-xnor-dff.bit').slice()
    expect(bytes[POWER_CONTROL_AT - 3]).toBe(0x56)
    expect(bytes[POWER_CONTROL_AT]).toBe(0x01)
    bytes[POWER_CONTROL_AT] = 0x02
    const parsed = parseNexusBitstream(bytes)
    expect(parsed.powerControl).toBe(2)
    expect(serialiseNexusBitstream(parsed)[POWER_CONTROL_AT]).toBe(0x02)
  })

  test('the control word and the usercode are read out of the file, not assumed to be zero', () => {
    // Both are zero in every design we can build, so a reader that returned a constant zero would pass every other
    // test here — including the byte-for-byte one, which would write the same zero straight back.
    const CONTROL_WORD_AT = 60
    const USERCODE_AT = 807803
    const bytes = fixture('nexus-lifcl40-xnor-dff.bit').slice()
    expect(bytes[CONTROL_WORD_AT - 4]).toBe(0x22)
    expect(bytes[USERCODE_AT - 4]).toBe(0xc2)
    bytes[CONTROL_WORD_AT + 2] = 0x08
    bytes[USERCODE_AT] = 0xca
    bytes[USERCODE_AT + 3] = 0xfe
    const parsed = parseNexusBitstream(bytes)
    expect(parsed.controlWords).toEqual([0x00000800])
    expect(parsed.usercode).toBe(0xca0000fe)
    const written = serialiseNexusBitstream(parsed)
    expect(written[CONTROL_WORD_AT + 2]).toBe(0x08)
    expect(written[USERCODE_AT]).toBe(0xca)
    expect(written[USERCODE_AT + 3]).toBe(0xfe)
  })

  test('a signed bitstream is refused rather than stepped over by a length we cannot check', () => {
    const bytes = fixture('nexus-lifcl40-xnor-dff.bit').slice()
    // Turn one of the FF padding bytes after the power-control command into an LSC_AUTH_CTRL opcode.
    expect(bytes[807287]).toBe(0xff)
    bytes[807287] = 0x58
    expect(() => parseNexusBitstream(bytes)).toThrow(/SIGNED/)
  })

  test('writing back a bus configuration with a gap in it is refused', () => {
    const parsed = parseNexusBitstream(fixture('nexus-lifcl40-bram1k.bit'))
    parsed.ipConfig.delete(0x20040100)
    expect(() => serialiseNexusBitstream(parsed)).toThrow(/not one unbroken run/)
  })

  test('writing back more bus bytes than the vendor puts in one transfer is refused', () => {
    const parsed = parseNexusBitstream(fixture('nexus-lifcl17-blank.bit'))
    for (let i = 0; i <= 40960; i++) parsed.ipConfig.set(0x20000000 + i, i & 0xff)
    expect(() => serialiseNexusBitstream(parsed)).toThrow(/past the 40960/)
  })

  test('writing back a design that configures a PLL or large RAM is refused, not guessed at', () => {
    const parsed = parseNexusBitstream(fixture('nexus-lifcl17-blank.bit'))
    parsed.ipConfig.set(0x0e000004, 0x5a)
    expect(() => serialiseNexusBitstream(parsed)).toThrow(/PLL region/)
    parsed.ipConfig.clear()
    parsed.ipConfig.set(0x2e000004, 0x5a)
    expect(() => serialiseNexusBitstream(parsed)).toThrow(/large-RAM region/)
  })

  test('a file with no preamble at all is refused', () => {
    expect(() => parseNexusBitstream(new Uint8Array([1, 2, 3, 4, 5, 6]))).toThrow(
      /No Lattice preamble/,
    )
  })

  test('a truncated file is refused rather than returning half a design', () => {
    expect(() => parseNexusBitstream(fixture('nexus-lifcl40-xnor-dff.bit').slice(0, 200))).toThrow(
      /Unexpected end of Nexus bitstream/,
    )
  })
})

describe('damage is reported, not hidden', () => {
  test('a flipped bit inside a frame fails that frame’s checksum and NO other', () => {
    const bytes = fixture('nexus-lifcl40-xnor-dff.bit').slice()
    bytes[80] = (bytes[80] as number) ^ 0x01
    const parsed = parseNexusBitstream(bytes)
    expect(parsed.crcOk).toBe(false)
    // Exactly one. The running checksum is reset at every checkpoint; if it were not, this one flipped byte would
    // be reported as 9173 broken frames and the real damage would be impossible to find.
    expect(parsed.crcFailures).toBe(1)
    expect(parsed.crcChecks).toBe(9173)
    // The file still parses; a damaged bitstream can be looked at rather than being unopenable.
    expect(parsed.device.name).toBe('LIFCL-40')
  })

  test('a frame whose stored ECC no longer matches its bits is counted', () => {
    const bytes = fixture('nexus-lifcl40-xnor-dff.bit').slice()
    // The ECC sits in the last two bytes of the frame; flip a bit of it and fix the CRC is not needed — the ECC
    // count is independent of the CRC verdict.
    const eccByte = 72 + 4 + 84
    bytes[eccByte] = (bytes[eccByte] as number) ^ 0x01
    const parsed = parseNexusBitstream(bytes)
    expect(parsed.eccMismatchFrames).toBe(1)
  })
})
