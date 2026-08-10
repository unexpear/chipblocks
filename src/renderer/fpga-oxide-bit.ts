/**
 * FPGA fabric — Lattice Nexus (via Project Oxide): read a real vendor `.bit` bitstream container.
 *
 * Nexus is the fourth chip family here, and its bitstream opens with the SAME `FF FF BD B3` marker an ECP5 one
 * does. The two are told apart by the chip's own identifying number, which every file announces in its VERIFY_ID
 * command — see `identifyLatticeBitstream`. Getting that wrong names the wrong chip family to the user, so both
 * families' numbers are pinned by tests against real files of each.
 *
 * What this reads: the container (metadata comments, preamble), the command stream (device id, control word,
 * frame-address commands, the configuration frames with their CRC-16 and 14-bit frame ECC, the IP/EBR bus writes,
 * the power-control byte, the usercode, program-done), and the whole configuration memory as a frame × bit array.
 * It also writes the same container back out, which is how the reader is checked against `prjoxide`: parse a real
 * file, write it again, and the bytes must come back identical.
 *
 * What it REFUSES rather than guesses:
 *   - READBACK containers (the `00 FE` comment terminator). These come off a running chip, no tool here can make
 *     one, and Project Oxide's own reader carries an open question about the bit order inside their frames.
 *   - COMPRESSED frame payloads (`LSC_PROG_INCR_CMP`). `prjoxide pack` never emits one, so a decompressor written
 *     here could not be checked against the oracle on a real file.
 *   - SIGNED bitstreams (`LSC_AUTH_CTRL`), for the same reason: the block's length could not be checked, and
 *     stepping over the wrong number of bytes turns the rest of the design into nonsense that still parses.
 *   - Any device whose identifying number is not in the table below, and any command not in the table below.
 *
 * The WRITER refuses three more things the reader handles fine, because they are shapes no design available here
 * produces and so no oracle could confirm where the bytes go: a bus configuration with a gap in it, one longer
 * than the vendor's 40960-byte transfer, and the PLL and large-RAM address regions.
 *
 * The format is transcribed from Project Oxide's own `prjoxide` (ISC) — `src/bitstream.rs` (the magic sequences,
 * the command opcodes, `update_crc16`/`finalise_crc16`, `update_ecc`/`finalise_ecc`, `parse_container`,
 * `parse_bitstream` and `serialise_chip`) and `src/chip.rs` (`frame_addr_to_idx`, `get_bus_frame_size`,
 * `tap_frame_count`). The device table is transcribed from `prjoxide-db`'s `devices.json` (CC0-1.0).
 */

import { crc16Trellis } from './fpga-trellis-bit.ts'

/**
 * One Nexus part: what it announces as its identifying number, and its configuration-frame geometry.
 *
 * A part can have more than one entry. LIFCL-40 ships as an engineering sample and as a production part, and the
 * two announce DIFFERENT numbers — a reader that knows only the one that appears in open-source write-ups reads
 * every sample chip and no production chip.
 */
export type NexusDevice = {
  name: string
  /** the silicon revision, as Project Oxide names it: `''` is the production part, `'ES'` the engineering sample. */
  variant: string
  idcode: number
  /** total configuration frames. */
  frames: number
  /** payload bits in each frame, before the ECC and padding bits. */
  bitsPerFrame: number
  padBitsAfterFrame: number
  padBitsBeforeFrame: number
  /** width of the per-frame ECC field that sits below bit 0 of the payload. */
  frameEccBits: number
  maxRow: number
  maxCol: number
  /** how many of the frames are TAP frames (the row-segment clock taps), addressed from 0x8020. */
  tapFrameCount: number
}

/**
 * The Nexus family, transcribed from `prjoxide-db`'s `devices.json` (CC0-1.0), read 2026-08-03.
 *
 * `tapFrameCount` is not in that file — it is a per-device constant in `prjoxide`'s `chip.rs` (`Chip::new`): 42 for
 * LFCPNX-100 and 24 for everything else.
 */
export const NEXUS_DEVICES: readonly NexusDevice[] = [
  {
    name: 'LIFCL-40',
    variant: '',
    idcode: 0x110f1043,
    frames: 9172,
    bitsPerFrame: 662,
    padBitsAfterFrame: 0,
    padBitsBeforeFrame: 4,
    frameEccBits: 14,
    maxRow: 56,
    maxCol: 87,
    tapFrameCount: 24,
  },
  {
    name: 'LIFCL-40',
    variant: 'ES',
    idcode: 0x010f1043,
    frames: 9172,
    bitsPerFrame: 662,
    padBitsAfterFrame: 0,
    padBitsBeforeFrame: 4,
    frameEccBits: 14,
    maxRow: 56,
    maxCol: 87,
    tapFrameCount: 24,
  },
  {
    name: 'LFD2NX-40',
    variant: '',
    idcode: 0x310f1043,
    frames: 9172,
    bitsPerFrame: 662,
    padBitsAfterFrame: 0,
    padBitsBeforeFrame: 4,
    frameEccBits: 14,
    maxRow: 56,
    maxCol: 87,
    tapFrameCount: 24,
  },
  {
    name: 'LIFCL-17',
    variant: '',
    idcode: 0x010f0043,
    frames: 7900,
    bitsPerFrame: 338,
    padBitsAfterFrame: 0,
    padBitsBeforeFrame: 0,
    frameEccBits: 14,
    maxRow: 29,
    maxCol: 75,
    tapFrameCount: 24,
  },
  {
    name: 'LFCPNX-100',
    variant: '',
    idcode: 0x010f4043,
    frames: 16822,
    bitsPerFrame: 878,
    padBitsAfterFrame: 0,
    padBitsBeforeFrame: 4,
    frameEccBits: 14,
    maxRow: 74,
    maxCol: 159,
    tapFrameCount: 42,
  },
]

/** The Nexus part announcing this identifying number, or null if no Nexus part does. */
export function findNexusDevice(idcode: number): NexusDevice | null {
  return NEXUS_DEVICES.find((d) => d.idcode === idcode >>> 0) ?? null
}

/** The magic sequences that bracket the metadata comment and start the command stream. */
const COMMENT_START = [0xff, 0x00]
const COMMENT_END = [0x00, 0xff]
const COMMENT_END_READBACK = [0x00, 0xfe]
const PREAMBLE = [0xff, 0xff, 0xbd, 0xb3]

/**
 * The Nexus bitstream commands this reader knows (`prjoxide` `bitstream.rs`).
 *
 * Only commands with a case below are listed. Lattice define more of them — the SPI-mode and jump commands a boot
 * header uses, the soft-error-detect seed, the security-programming command — but `prjoxide` does not read those
 * either, so a file carrying one is named by its opcode and refused rather than stepped over by a guessed length.
 */
const COMMAND = {
  LSC_WRITE_COMP_DIC: 0x02,
  LSC_PROG_CNTRL0: 0x22,
  LSC_RESET_CRC: 0x3b,
  LSC_INIT_ADDRESS: 0x46,
  LSC_POWER_CTRL: 0x56,
  LSC_AUTH_CTRL: 0x58,
  ISC_PROGRAM_DONE: 0x5e,
  LSC_BUS_WRITE: 0x72,
  LSC_PROG_INCR_RTI: 0x82,
  LSC_WRITE_ADDRESS: 0xb4,
  LSC_PROG_INCR_CMP: 0xb8,
  ISC_PROGRAM_USERCODE: 0xc2,
  LSC_BUS_ADDRESS: 0xf6,
  DUMMY: 0xff,
} as const

/** `VERIFY_ID` — kept apart from the table because reading it is what decides the chip FAMILY, not just the part. */
const VERIFY_ID = 0xe2

/** The one frame-load-settings byte `prjoxide` accepts for an uncompressed frame block. */
const UNCOMPRESSED_FRAME_SETTINGS = 0x91

/** The 14-bit frame-ECC polynomial (`prjoxide` `ECC_POLY`). */
const ECC_POLY = 0x202d

/** The CRC-16 polynomial Lattice use in both the ECP5 and the Nexus container (`prjoxide` `CRC16_POLY`). */
const CRC16_POLY = 0x8005

/** Configuration memory: `frames` rows of `bitsPerFrame` bits, packed eight bits to a byte. */
export type NexusCram = {
  frames: number
  bitsPerFrame: number
  rowBytes: number
  bits: Uint8Array
}

export function makeNexusCram(frames: number, bitsPerFrame: number): NexusCram {
  const rowBytes = Math.ceil(bitsPerFrame / 8)
  return { frames, bitsPerFrame, rowBytes, bits: new Uint8Array(frames * rowBytes) }
}

export function getNexusCramBit(cram: NexusCram, frame: number, bit: number): boolean {
  if (frame < 0 || frame >= cram.frames || bit < 0 || bit >= cram.bitsPerFrame) return false
  const byte = cram.bits[frame * cram.rowBytes + (bit >> 3)] as number
  return ((byte >> (bit & 7)) & 1) === 1
}

export function setNexusCramBit(cram: NexusCram, frame: number, bit: number, value: boolean): void {
  if (frame < 0 || frame >= cram.frames || bit < 0 || bit >= cram.bitsPerFrame)
    throw new Error(`Nexus CRAM position out of range (frame ${frame}, bit ${bit})`)
  const index = frame * cram.rowBytes + (bit >> 3)
  const mask = 1 << (bit & 7)
  const byte = cram.bits[index] as number
  cram.bits[index] = value ? byte | mask : byte & ~mask
}

/** Every position where two configuration memories differ, in `(frame, bit)` order. */
export function diffNexusCram(a: NexusCram, b: NexusCram): { frame: number; bit: number }[] {
  if (a.frames !== b.frames || a.bitsPerFrame !== b.bitsPerFrame)
    throw new Error('Cannot compare Nexus configuration memories of different devices')
  const changed: { frame: number; bit: number }[] = []
  for (let frame = 0; frame < a.frames; frame++) {
    for (let byte = 0; byte < a.rowBytes; byte++) {
      const index = frame * a.rowBytes + byte
      const delta = (a.bits[index] as number) ^ (b.bits[index] as number)
      if (delta === 0) continue
      for (let k = 0; k < 8; k++) {
        if (((delta >> k) & 1) !== 1) continue
        const bit = byte * 8 + k
        if (bit < a.bitsPerFrame) changed.push({ frame, bit })
      }
    }
  }
  return changed
}

/**
 * The flat frame index a frame ADDRESS refers to, or -1 when the address names no frame on this device.
 *
 * Transcribed from `prjoxide` `chip.rs` `frame_addr_to_idx`. The address space is in four pieces and none of them
 * runs the same way as the flat index: the main frames count DOWN from the top, and the three 0x8000 blocks — the
 * right-side IO frames, the left-side IO frames, and the TAP (row-segment clock) frames — each land somewhere else
 * entirely. Reading a frame at the wire's own address puts every tile's bits in the wrong place.
 */
export function nexusFrameAddressToIndex(device: NexusDevice, address: number): number {
  const inRange = (index: number): number => (index >= 0 && index < device.frames ? index : -1)
  if (address <= 0x7fff) return inRange(device.frames - 1 - address)
  if (address <= 0x800f) return inRange(15 - (address - 0x8000) + 16 + device.tapFrameCount)
  if (address <= 0x801f) return inRange(15 - (address - 0x8010))
  // The TAP block's addresses run to 0x81FF but a device has only `tapFrameCount` of them. Past that the formula
  // keeps producing valid-looking indices that ALIAS the left-side IO frames, so a file writing one frame too many
  // would silently overwrite a frame it never named. Project Oxide gets the same outcome by accident — its index
  // arithmetic is unsigned, so it wraps to something enormous and its own range check drops it.
  if (address <= 0x81ff)
    return address - 0x8020 < device.tapFrameCount
      ? inRange(device.tapFrameCount - 1 - (address - 0x8020) + 16)
      : -1
  return -1
}

/**
 * How many bytes one bus-write frame holds at this address (`prjoxide` `chip.rs` `get_bus_frame_size`). The top
 * nibble of the address selects the region: ordinary IP cores, block/large RAM, or the PCIe core.
 */
function nexusBusFrameSize(address: number): number {
  const region = (address & 0xf0000000) >>> 28
  if (region === 0) return 1
  if (region === 2) return 5
  if (region === 3) return 4
  throw new Error(
    `Nexus bitstream writes to bus address 0x${address.toString(16).padStart(8, '0')}, whose region is not one this reader knows the frame size of`,
  )
}

/** One `LSC_PROG_INCR_RTI` block: how many frames were written, starting at which frame address. */
export type NexusFrameWrite = {
  address: number
  count: number
}

/** A parsed Nexus `.bit`: the part it is for, the container fields, and the whole configuration memory. */
export type ParsedNexusBitstream = {
  device: NexusDevice
  idcode: number
  /** the comment strings between the `FF 00` and `00 FF` markers, in file order. */
  metadata: string[]
  /** the words written by `LSC_PROG_CNTRL0`, in order. */
  controlWords: number[]
  usercode: number | null
  powerControl: number | null
  cram: NexusCram
  /** IP-core and block-RAM configuration bytes, keyed by bus address. */
  ipConfig: Map<number, number>
  frameWrites: NexusFrameWrite[]
  crcOk: boolean
  crcChecks: number
  /**
   * How many of those checks failed. Counted separately from `crcOk` because ONE damaged byte should show up as
   * one bad frame: the running checksum is reset after every checkpoint, and without that reset a single flipped
   * bit would condemn every frame after it.
   */
  crcFailures: number
  /**
   * How many frames' stored ECC field disagreed with the ECC recomputed from the frame's own bits. Project Oxide
   * notes this can legitimately disagree, because LUT-RAM initialisation is masked out of the vendor's own ECC —
   * so it is counted and reported, never used to reject a file.
   */
  eccMismatchFrames: number
  /** how many frames the file wrote to an address this device has no frame for; their bits were discarded. */
  framesOutsideDevice: number
  programDone: boolean
}

/** Which Lattice family a `FF FF BD B3` bitstream belongs to, decided by the chip's own identifying number. */
export type LatticeBitstreamIdentity = {
  family: 'nexus' | 'ecp5'
  idcode: number
  deviceName: string
}

/**
 * Read a `.bit` far enough to say which Lattice family it is for and which part, or null if it is neither.
 *
 * ECP5 and Nexus files carry the same `FF FF BD B3` marker, so the marker alone cannot tell them apart — only the
 * identifying number can, and the two families' numbers do not overlap. This walks the fixed-size commands every
 * file of either family opens with (padding, checksum resets, then VERIFY_ID) and stops at the first thing it does
 * not recognise rather than guessing.
 */
export function identifyLatticeBitstream(bytes: Uint8Array): LatticeBitstreamIdentity | null {
  const idcode = readLatticePreambleIdcode(bytes)
  if (idcode === null) return null
  const nexus = findNexusDevice(idcode)
  if (nexus !== null) return { family: 'nexus', idcode, deviceName: nexus.name }
  const ecp5 = ECP5_IDCODES.get(idcode >>> 0)
  if (ecp5 !== undefined) return { family: 'ecp5', idcode, deviceName: ecp5 }
  return null
}

/**
 * The ECP5 identifying numbers, kept here as the OTHER side of the family question.
 *
 * `fpga-trellis-bit.ts` owns the ECP5 geometry table; this is only the id → name map needed to answer "is this file
 * an ECP5 rather than a Nexus". A test pins the two lists against each other so they cannot drift apart.
 */
const ECP5_IDCODES = new Map<number, string>([
  [0x21111043, 'LFE5U-12F'],
  [0x41111043, 'LFE5U-25F'],
  [0x41112043, 'LFE5U-45F'],
  [0x41113043, 'LFE5U-85F'],
  [0x01111043, 'LFE5UM-25F'],
  [0x01112043, 'LFE5UM-45F'],
  [0x01113043, 'LFE5UM-85F'],
  [0x81111043, 'LFE5UM5G-25F'],
  [0x81112043, 'LFE5UM5G-45F'],
  [0x81113043, 'LFE5UM5G-85F'],
])

/** The 32-bit number a `FF FF BD B3` bitstream's VERIFY_ID announces, or null if the walk cannot reach one. */
function readLatticePreambleIdcode(bytes: Uint8Array): number | null {
  let pos = -1
  for (let i = 0; i + PREAMBLE.length <= bytes.length; i++) {
    if (PREAMBLE.every((b, k) => bytes[i + k] === b)) {
      pos = i + PREAMBLE.length
      break
    }
  }
  if (pos < 0) return null
  while (pos < bytes.length) {
    const command = bytes[pos] as number
    if (command === COMMAND.DUMMY) {
      pos++
      continue
    }
    if (command === COMMAND.LSC_RESET_CRC) {
      pos += 4
      continue
    }
    if (command !== VERIFY_ID) return null
    if (pos + 8 > bytes.length) return null
    return (
      (((bytes[pos + 4] as number) << 24) |
        ((bytes[pos + 5] as number) << 16) |
        ((bytes[pos + 6] as number) << 8) |
        (bytes[pos + 7] as number)) >>>
      0
    )
  }
  return null
}

/** `prjoxide` `finalise_crc16`: push the last sixteen bits through before comparing. */
function finaliseCrc16(crc: number): number {
  let c = crc & 0xffff
  for (let i = 0; i < 16; i++) {
    const bitFlag = (c >> 15) & 1
    c = (c << 1) & 0xffff
    if (bitFlag) c ^= CRC16_POLY
  }
  return c
}

/** `prjoxide` `update_ecc`: fold one payload BIT into the running 14-bit frame ECC. */
function updateEcc(ecc: number, value: boolean): number {
  const bitFlag = (ecc >> 13) & 1
  let next = ((ecc << 1) | (value ? 1 : 0)) & 0x3fff
  if (bitFlag) next ^= ECC_POLY
  return next
}

/** `prjoxide` `finalise_ecc`: fourteen zero bits pushed through. */
function finaliseEcc(ecc: number): number {
  let e = ecc
  for (let i = 0; i < 14; i++) e = updateEcc(e, false)
  return e
}

type ContainerKind = 'normal' | 'readback'

type ContainerResult = {
  kind: ContainerKind
  metadata: string[]
  start: number
}

/** Walk the metadata comment up to and including the preamble (`prjoxide` `parse_container`). */
function parseNexusContainer(bytes: Uint8Array): ContainerResult {
  const matches = (at: number, pattern: number[]): boolean =>
    at + pattern.length <= bytes.length && pattern.every((b, k) => bytes[at + k] === b)
  const metadata: string[] = []
  let current = ''
  let inMetadata = false
  let pos = 0
  while (pos < bytes.length) {
    if (matches(pos, PREAMBLE)) return { kind: 'normal', metadata, start: pos + PREAMBLE.length }
    if (!inMetadata && matches(pos, COMMENT_START)) {
      inMetadata = true
      pos += COMMENT_START.length
      continue
    }
    if (inMetadata && matches(pos, COMMENT_END)) {
      if (current.length > 0) metadata.push(current)
      current = ''
      inMetadata = false
      pos += COMMENT_END.length
      continue
    }
    if (inMetadata && matches(pos, COMMENT_END_READBACK)) {
      if (current.length > 0) metadata.push(current)
      return { kind: 'readback', metadata, start: pos + COMMENT_END_READBACK.length }
    }
    if (!inMetadata) {
      pos++
      continue
    }
    const ch = bytes[pos++] as number
    if (ch === 0x00) {
      metadata.push(current)
      current = ''
      continue
    }
    current += String.fromCharCode(ch)
  }
  throw new Error('No Lattice preamble (FF FF BD B3) found in bitstream')
}

/**
 * Parse a whole Nexus `.bit`: the metadata comment, the command stream, and the configuration memory, with the
 * CRC-16 verified at every checkpoint and the per-frame ECC recomputed.
 *
 * A structural problem — no preamble, a truncated file, an unknown command, a frame block whose load-settings byte
 * is not the one uncompressed value — throws, as does a file this reader cannot read faithfully (a readback
 * container, a compressed payload, an unknown part). A CRC mismatch is reported as `crcOk: false` rather than
 * thrown, so a damaged file can still be looked at.
 */
export function parseNexusBitstream(bytes: Uint8Array): ParsedNexusBitstream {
  const container = parseNexusContainer(bytes)
  if (container.kind === 'readback')
    throw new Error(
      'This is a Nexus READBACK capture (its comment ends 00 FE), not a programming bitstream. ChipBlocks does not read readback captures: no tool here can produce one to check a reader against, and Project Oxide records the bit order inside their frames as an open question.',
    )

  let pos = container.start
  let crc = 0
  const readByte = (): number => {
    if (pos >= bytes.length) throw new Error('Unexpected end of Nexus bitstream')
    const b = bytes[pos++] as number
    crc = crc16Trellis(crc, b)
    return b
  }
  const readOpcode = (): number => {
    if (pos >= bytes.length) throw new Error('Unexpected end of Nexus bitstream')
    const b = bytes[pos++] as number
    if (b !== COMMAND.DUMMY) crc = crc16Trellis(crc, b)
    return b
  }
  const skip = (n: number): void => {
    for (let i = 0; i < n; i++) readByte()
  }
  const readU16 = (): number => ((readByte() << 8) | readByte()) & 0xffff
  const readU32 = (): number =>
    ((readByte() << 24) | (readByte() << 16) | (readByte() << 8) | readByte()) >>> 0

  let crcOk = true
  let crcChecks = 0
  let crcFailures = 0
  const checkCrc = (): void => {
    const expected = finaliseCrc16(crc)
    const found = ((readByte() << 8) | readByte()) & 0xffff
    crcChecks++
    if (found !== expected) {
      crcOk = false
      crcFailures++
    }
    crc = 0
  }

  let device: NexusDevice | null = null
  let idcode: number | null = null
  let currentFrame = 0
  let busAddress = 0
  let usercode: number | null = null
  let powerControl: number | null = null
  let programDone = false
  let eccMismatchFrames = 0
  let framesOutsideDevice = 0
  const controlWords: number[] = []
  const frameWrites: NexusFrameWrite[] = []
  const ipConfig = new Map<number, number>()
  let cram: NexusCram | null = null

  const requireDevice = (): { dev: NexusDevice; target: NexusCram } => {
    if (device === null || cram === null)
      throw new Error('Nexus frame data began before the bitstream identified its device')
    return { dev: device, target: cram }
  }

  while (pos < bytes.length) {
    const command = readOpcode()
    if (command === COMMAND.DUMMY) continue
    switch (command) {
      case COMMAND.LSC_RESET_CRC:
        skip(3)
        crc = 0
        break
      case VERIFY_ID: {
        skip(3)
        idcode = readU32()
        const found = findNexusDevice(idcode)
        if (found === null) {
          const ecp5 = ECP5_IDCODES.get(idcode)
          throw new Error(
            ecp5 === undefined
              ? `This bitstream announces chip 0x${idcode.toString(16).padStart(8, '0')}, which is not a Lattice Nexus part ChipBlocks knows.`
              : `This is an ECP5 chip file (a ${ecp5}), not a Nexus one — the two share the same FF FF BD B3 marker.`,
          )
        }
        device = found
        cram = makeNexusCram(found.frames, found.bitsPerFrame)
        break
      }
      case COMMAND.LSC_PROG_CNTRL0:
        skip(3)
        controlWords.push(readU32())
        break
      case COMMAND.LSC_INIT_ADDRESS:
        skip(3)
        currentFrame = 0
        break
      case COMMAND.LSC_WRITE_ADDRESS:
        skip(3)
        currentFrame = readU32()
        break
      case COMMAND.LSC_AUTH_CTRL:
        // A signed bitstream carries a 64-byte authentication block here. No tool available to this project makes
        // one, so neither that length nor anything after it could be checked against a real file — and stepping
        // over the wrong number of bytes would turn the rest of the design into nonsense that still parses.
        throw new Error(
          'This Nexus chip file is SIGNED (it carries an LSC_AUTH_CTRL block). ChipBlocks does not read signed Nexus bitstreams: no tool here can produce one to check the reader against.',
        )
      case COMMAND.LSC_POWER_CTRL:
        skip(2)
        powerControl = readByte()
        break
      case COMMAND.ISC_PROGRAM_USERCODE: {
        const checkAfter = (readByte() & 0x80) !== 0
        skip(2)
        usercode = readU32()
        if (checkAfter) checkCrc()
        break
      }
      case COMMAND.LSC_BUS_ADDRESS:
        skip(3)
        busAddress = readU32()
        break
      case COMMAND.LSC_BUS_WRITE: {
        const checkAfter = (readByte() & 0x80) !== 0
        const frameCount = readU16()
        const total = frameCount * nexusBusFrameSize(busAddress)
        for (let i = 0; i < total; i++) ipConfig.set(busAddress++, readByte())
        if (checkAfter) checkCrc()
        break
      }
      case COMMAND.LSC_PROG_INCR_RTI: {
        const settings = readByte()
        const count = readU16()
        if (settings !== UNCOMPRESSED_FRAME_SETTINGS)
          throw new Error(
            `Nexus frame block declares load settings 0x${settings.toString(16)}; this reader only knows the uncompressed setting 0x91`,
          )
        const { dev, target } = requireDevice()
        frameWrites.push({ address: currentFrame, count })
        const padBits = dev.frameEccBits + dev.padBitsAfterFrame
        const frameByteCount = Math.ceil((dev.bitsPerFrame + dev.frameEccBits) / 8)
        const frameBytes = new Uint8Array(frameByteCount)
        for (let f = 0; f < count; f++) {
          for (let i = 0; i < frameByteCount; i++) frameBytes[i] = readByte()
          const index = nexusFrameAddressToIndex(dev, currentFrame)
          if (index < 0) framesOutsideDevice++
          let ecc = 0
          for (let j = dev.bitsPerFrame - 1; j >= 0; j--) {
            const ofs = j + padBits
            const byte = frameBytes[frameByteCount - 1 - (ofs >> 3)] as number
            const value = ((byte >> (ofs & 7)) & 1) === 1
            if (value && index >= 0) setNexusCramBit(target, index, j, true)
            ecc = updateEcc(ecc, value)
          }
          const stored =
            ((((frameBytes[frameByteCount - 2] as number) << 8) |
              (frameBytes[frameByteCount - 1] as number)) &
              0x3fff) >>>
            0
          if (stored !== finaliseEcc(ecc)) eccMismatchFrames++
          checkCrc()
          const trailer = readByte()
          if (trailer !== 0xff)
            throw new Error(
              `Nexus frame at address 0x${currentFrame.toString(16)} is not followed by the expected FF byte`,
            )
          currentFrame++
        }
        break
      }
      case COMMAND.LSC_WRITE_COMP_DIC:
      case COMMAND.LSC_PROG_INCR_CMP:
        throw new Error(
          'This Nexus chip file uses COMPRESSED frame data. ChipBlocks does not read compressed Nexus bitstreams: the open toolchain never writes one, so a decompressor here could not be checked against a real file.',
        )
      case COMMAND.ISC_PROGRAM_DONE:
        skip(3)
        programDone = true
        break
      default:
        throw new Error(
          `Unknown Nexus bitstream command 0x${command.toString(16).padStart(2, '0')} at byte ${pos - 1}`,
        )
    }
  }

  if (device === null || cram === null || idcode === null)
    throw new Error('Nexus bitstream never identified its device')

  return {
    device,
    idcode,
    metadata: container.metadata,
    controlWords,
    usercode,
    powerControl,
    cram,
    ipConfig,
    frameWrites,
    crcOk,
    crcChecks,
    crcFailures,
    eccMismatchFrames,
    framesOutsideDevice,
    programDone,
  }
}

/**
 * Write a parsed Nexus bitstream back out as a `.bit` file.
 *
 * This exists to check the reader. `prjoxide pack` builds a file from its own configuration memory by a fixed
 * recipe; if the same recipe applied to what WE read back out of that file reproduces it byte for byte, then every
 * frame's bits, every bus-write byte and every container field we recovered are exactly the ones it put in. A
 * round-trip through our own reader alone could not show that — a wrong frame index read and written the same
 * wrong way still round-trips.
 *
 * Transcribed from `prjoxide` `bitstream.rs` `serialise_chip`.
 */
export function serialiseNexusBitstream(parsed: ParsedNexusBitstream): Uint8Array {
  const out: number[] = []
  let crc = 0
  const writeByte = (b: number): void => {
    out.push(b & 0xff)
    crc = crc16Trellis(crc, b & 0xff)
  }
  const writePadding = (n: number): void => {
    for (let i = 0; i < n; i++) out.push(0xff)
  }
  const writeZeros = (n: number): void => {
    for (let i = 0; i < n; i++) writeByte(0x00)
  }
  const writeU16 = (v: number): void => {
    writeByte((v >> 8) & 0xff)
    writeByte(v & 0xff)
  }
  const writeU32 = (v: number): void => {
    writeByte((v >>> 24) & 0xff)
    writeByte((v >>> 16) & 0xff)
    writeByte((v >>> 8) & 0xff)
    writeByte(v & 0xff)
  }
  const insertCrc = (): void => {
    const value = finaliseCrc16(crc)
    writeU16(value)
    crc = 0
  }

  // Project Oxide writes two kinds of bus address differently from the ordinary case: the PLL region goes out one
  // byte at a time in DESCENDING address order, and large-RAM addresses are scaled down by 8/10 on the way out. No
  // design we can build here uses either, so neither could be checked against a real file — and writing a wrong
  // address is worse than saying so.
  for (const address of parsed.ipConfig.keys()) {
    const region = address & 0xff000000
    if (region !== 0x0e000000 && region !== 0x2e000000) continue
    throw new Error(
      `This Nexus design configures bus address 0x${(address >>> 0).toString(16).padStart(8, '0')} — the ${region === 0x0e000000 ? 'PLL' : 'large-RAM'} region. ChipBlocks reads those bytes but will not write them back out: the order and address scaling the vendor uses there are not checked against any real file here.`,
    )
  }

  const device = parsed.device
  for (const ch of 'LSCC') out.push(ch.charCodeAt(0))
  for (const b of COMMENT_START) writeByte(b)
  parsed.metadata.forEach((m, i) => {
    for (const ch of m) out.push(ch.charCodeAt(0))
    if (i < parsed.metadata.length - 1) writeByte(0x00)
  })
  for (const b of COMMENT_END) writeByte(b)
  for (const b of PREAMBLE) writeByte(b)
  writePadding(20)
  writeByte(COMMAND.LSC_RESET_CRC)
  writeZeros(3)
  crc = 0
  writePadding(4)
  writeByte(COMMAND.LSC_RESET_CRC)
  writeZeros(3)
  crc = 0
  writePadding(4)
  writeByte(VERIFY_ID)
  writeZeros(3)
  writeU32(parsed.idcode)
  writeByte(COMMAND.LSC_PROG_CNTRL0)
  writeZeros(3)
  writeU32(parsed.controlWords[0] ?? 0)

  const padBits = device.frameEccBits + device.padBitsAfterFrame
  const frameByteCount = Math.ceil((device.bitsPerFrame + device.frameEccBits) / 8)
  const writeFrames = (startAddress: number, count: number): void => {
    writeByte(COMMAND.LSC_PROG_INCR_RTI)
    writeByte(UNCOMPRESSED_FRAME_SETTINGS)
    writeU16(count)
    const frameBytes = new Uint8Array(frameByteCount)
    for (let f = 0; f < count; f++) {
      const index = nexusFrameAddressToIndex(device, startAddress + f)
      frameBytes.fill(0)
      let ecc = 0
      for (let j = device.bitsPerFrame - 1; j >= 0; j--) {
        const ofs = j + padBits
        const value = getNexusCramBit(parsed.cram, index, j)
        ecc = updateEcc(ecc, value)
        if (value)
          frameBytes[frameByteCount - 1 - (ofs >> 3)] =
            (frameBytes[frameByteCount - 1 - (ofs >> 3)] as number) | (1 << (ofs & 7))
      }
      const finalEcc = finaliseEcc(ecc)
      frameBytes[frameByteCount - 2] =
        (frameBytes[frameByteCount - 2] as number) | ((finalEcc >> 8) & 0x3f)
      frameBytes[frameByteCount - 1] =
        (frameBytes[frameByteCount - 1] as number) | (finalEcc & 0xff)
      for (const b of frameBytes) writeByte(b)
      insertCrc()
      writeByte(0xff)
    }
  }
  const writeFrameAddress = (address: number): void => {
    writeByte(COMMAND.LSC_WRITE_ADDRESS)
    writeZeros(3)
    writeU32(address)
  }

  writeFrameAddress(0x8000)
  writeFrames(0x8000, 32)
  writePadding(17)
  writeByte(COMMAND.LSC_INIT_ADDRESS)
  writeZeros(3)
  writeFrames(0x0000, device.frames - (32 + device.tapFrameCount))
  writePadding(17)
  writeFrameAddress(0x8020)
  writeFrames(0x8020, device.tapFrameCount)
  writePadding(17)
  writeByte(COMMAND.LSC_POWER_CTRL)
  writeZeros(2)
  writeByte(parsed.powerControl ?? 0x01)
  writePadding(512)

  const busRun = nexusIpConfigRun(parsed.ipConfig)
  if (busRun !== null) {
    writeByte(COMMAND.LSC_BUS_ADDRESS)
    writeZeros(3)
    writeU32(busRun.start >>> 0)
    writePadding(9)
    const frameSize = nexusBusFrameSize(busRun.start)
    const frameCount = Math.ceil(busRun.bytes.length / frameSize)
    writeByte(COMMAND.LSC_BUS_WRITE)
    writeByte(0xd0)
    writeU16(frameCount)
    for (let i = 0; i < frameSize * frameCount; i++) writeByte(busRun.bytes[i] ?? 0x00)
    insertCrc()
  }

  writeByte(COMMAND.ISC_PROGRAM_USERCODE)
  writeByte(0x80)
  writeZeros(2)
  writeU32(parsed.usercode ?? 0)
  insertCrc()
  writePadding(15)
  writeByte(COMMAND.ISC_PROGRAM_DONE)
  writeZeros(3)
  writePadding(4)
  return Uint8Array.from(out)
}

/**
 * The IP configuration as ONE contiguous bus transfer, or null when there is none.
 *
 * Project Oxide splits its bus writes at every address gap and at 40960 bytes. Every design we can build here
 * produces a single unbroken run, so neither of those splits could be checked against a real file; rather than
 * write a transfer boundary in a place we have never seen one, anything but a single run is refused.
 */
function nexusIpConfigRun(
  ipConfig: Map<number, number>,
): { start: number; bytes: number[] } | null {
  const sorted = [...ipConfig.keys()].sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const start = sorted[0] as number
  for (let i = 1; i < sorted.length; i++)
    if ((sorted[i] as number) !== (sorted[i - 1] as number) + 1)
      throw new Error(
        `This Nexus design's bus configuration is not one unbroken run of addresses (there is a gap after 0x${(sorted[i - 1] as number).toString(16)}). ChipBlocks will not write it back out: where the vendor puts the transfer boundary is not checked against any real file here.`,
      )
  if (sorted.length > 40960)
    throw new Error(
      `This Nexus design writes ${sorted.length} bus configuration bytes, past the 40960 the vendor splits a transfer at. ChipBlocks will not write it back out: that split is not checked against any real file here.`,
    )
  return { start, bytes: sorted.map((a) => ipConfig.get(a) as number) }
}
