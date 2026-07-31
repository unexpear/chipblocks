/**
 * FPGA fabric — ECP5 (Lattice, via Project Trellis): parse a whole vendor `.bit` bitstream file.
 *
 * This is the first piece of a SECOND FPGA family. It is the ECP5 analogue of `fpga-icebox-bin.ts`, and the two
 * formats share almost nothing: where an iCE40 `.bin` is a `7E AA 99 7E` preamble followed by CRAM banks with a
 * CRC-16-CCITT (poly 0x1021, init 0xFFFF), an ECP5 `.bit` is an `FF FF BD B3` preamble followed by a stream of
 * one-byte COMMANDS (verify-ID, control registers, usercode, frame data, program-done) carrying a CRC-16 with
 * poly 0x8005 and init 0x0000 — and its configuration memory is a list of FRAMES, not four banks. So this is a
 * separate parser, not a parameterisation of the iCE40 one.
 *
 * The format is transcribed from Project Trellis's `libtrellis/src/Bitstream.cpp` (ISC) — the authoritative
 * implementation — specifically `find_preamble`, the `BitstreamCommand` opcode table in `Bitstream.hpp`,
 * `update_crc16` / `finalise_crc16` / `check_crc16`, and the `LSC_PROG_INCR_RTI` frame-payload loop. The device
 * geometry table below is transcribed from Project Trellis's device database (`devices.json`, CC0).
 *
 * Honest scope: this recovers the CONTAINER and the raw configuration FRAMES (plus the device the bitstream
 * declares, its usercode and control words, with the CRC verified). It does NOT interpret those frames — mapping
 * frame bits to tiles and tile bits to logic (the ECP5 equivalent of our iCE40 cram-index + logic-cell decoder)
 * needs Trellis's per-device tile database, which is a separate, much larger effort and is not bundled. It also
 * does not handle COMPRESSED bitstreams (`LSC_PROG_INCR_CMP`, which needs the compression dictionary) or EBR
 * (block-RAM) initialisation data — both are detected and reported, never silently mis-parsed.
 */

/** One ECP5 part: the ID it announces in its bitstream, and its configuration-frame geometry. */
export type Ecp5Device = {
  name: string
  idcode: number
  /** number of configuration frames. */
  frames: number
  /** payload bits in each frame. */
  bitsPerFrame: number
  padBitsBeforeFrame: number
  padBitsAfterFrame: number
}

/**
 * The ECP5 family, transcribed from Project Trellis's `devices.json` (CC0). `idcode` is what the bitstream's
 * VERIFY_ID command announces, and is how a loaded file identifies its own part.
 */
export const ECP5_DEVICES: readonly Ecp5Device[] = [
  {
    name: 'LFE5U-12F',
    idcode: 0x21111043,
    frames: 7562,
    bitsPerFrame: 592,
    padBitsBeforeFrame: 0,
    padBitsAfterFrame: 0,
  },
  {
    name: 'LFE5U-25F',
    idcode: 0x41111043,
    frames: 7562,
    bitsPerFrame: 592,
    padBitsBeforeFrame: 0,
    padBitsAfterFrame: 0,
  },
  {
    name: 'LFE5U-45F',
    idcode: 0x41112043,
    frames: 9470,
    bitsPerFrame: 846,
    padBitsBeforeFrame: 2,
    padBitsAfterFrame: 0,
  },
  {
    name: 'LFE5U-85F',
    idcode: 0x41113043,
    frames: 13294,
    bitsPerFrame: 1136,
    padBitsBeforeFrame: 0,
    padBitsAfterFrame: 0,
  },
  {
    name: 'LFE5UM-25F',
    idcode: 0x01111043,
    frames: 7562,
    bitsPerFrame: 592,
    padBitsBeforeFrame: 0,
    padBitsAfterFrame: 0,
  },
  {
    name: 'LFE5UM-45F',
    idcode: 0x01112043,
    frames: 9470,
    bitsPerFrame: 846,
    padBitsBeforeFrame: 2,
    padBitsAfterFrame: 0,
  },
  {
    name: 'LFE5UM-85F',
    idcode: 0x01113043,
    frames: 13294,
    bitsPerFrame: 1136,
    padBitsBeforeFrame: 0,
    padBitsAfterFrame: 0,
  },
  {
    name: 'LFE5UM5G-25F',
    idcode: 0x81111043,
    frames: 7562,
    bitsPerFrame: 592,
    padBitsBeforeFrame: 0,
    padBitsAfterFrame: 0,
  },
  {
    name: 'LFE5UM5G-45F',
    idcode: 0x81112043,
    frames: 9470,
    bitsPerFrame: 846,
    padBitsBeforeFrame: 2,
    padBitsAfterFrame: 0,
  },
  {
    name: 'LFE5UM5G-85F',
    idcode: 0x81113043,
    frames: 13294,
    bitsPerFrame: 1136,
    padBitsBeforeFrame: 0,
    padBitsAfterFrame: 0,
  },
]

/** The ECP5 bitstream command opcodes (Trellis `BitstreamCommand`). */
const CMD = {
  SPI_MODE: 0x79,
  JUMP: 0x7e,
  LSC_RESET_CRC: 0x3b,
  VERIFY_ID: 0xe2,
  LSC_WRITE_COMP_DIC: 0x02,
  LSC_PROG_CNTRL0: 0x22,
  LSC_PROG_CNTRL1: 0x23,
  LSC_INIT_ADDRESS: 0x46,
  LSC_WRITE_ADDRESS: 0xb4,
  LSC_PROG_INCR_CMP: 0xb8,
  LSC_PROG_INCR_RTI: 0x82,
  LSC_PROG_SED_CRC: 0xa2,
  ISC_PROGRAM_SECURITY: 0xce,
  ISC_PROGRAM_USERCODE: 0xc2,
  LSC_EBR_ADDRESS: 0xf6,
  LSC_EBR_WRITE: 0xb2,
  ISC_PROGRAM_DONE: 0x5e,
  LSC_PROG_CNTRL0_2: 0xc4,
  ISC_PROGRAM_USERCODE_2: 0xc3,
  ISC_PROGRAM_DONE_2: 0x7a,
  WRITE_INC_FRAME: 0x41,
  DUMMY: 0xff,
} as const

/** The `FF FF BD B3` sync pattern that starts the command stream. */
const PREAMBLE = [0xff, 0xff, 0xbd, 0xb3]

/**
 * CRC-16 with polynomial 0x8005, initial value 0x0000, shifting each byte in MSB-first — Trellis's
 * `update_crc16`. Note this is a DIFFERENT algorithm from the iCE40 one (which is CRC-16-CCITT, poly 0x1021,
 * init 0xFFFF): the two families do not share a checksum.
 */
export function crc16Trellis(crc: number, byte: number): number {
  let c = crc & 0xffff
  for (let i = 7; i >= 0; i--) {
    const bitFlag = (c >> 15) & 1
    c = ((c << 1) & 0xffff) | ((byte >> i) & 1)
    if (bitFlag) c ^= 0x8005
  }
  return c
}

/** Trellis's `finalise_crc16`: push the last 16 bits through before comparing. */
function finaliseCrc16(crc: number): number {
  let c = crc & 0xffff
  for (let i = 0; i < 16; i++) {
    const bitFlag = (c >> 15) & 1
    c = (c << 1) & 0xffff
    if (bitFlag) c ^= 0x8005
  }
  return c
}

/** A parsed ECP5 `.bit`: what part it is for, its container fields, and its configuration frames. */
export type ParsedEcp5Bitstream = {
  /** the device the bitstream's VERIFY_ID announces, or null if that id is not a known ECP5 part. */
  device: Ecp5Device | null
  /** the raw 32-bit IDCODE from VERIFY_ID (null if the file had none). */
  idcode: number | null
  /** the ASCII comment/metadata header before the preamble ('' if none). */
  comment: string
  /** the 32-bit usercode (ISC_PROGRAM_USERCODE), or null. */
  usercode: number | null
  /** control words written by LSC_PROG_CNTRL0 / _1 (in order). */
  controlWords: number[]
  /** the configuration frames: `frames[i][bit]` — `frames.length` rows of `bitsPerFrame` bits each. */
  frames: boolean[][]
  /** whether every CRC check in the file passed. */
  crcOk: boolean
  /** how many CRC checks the file performed. */
  crcChecks: number
  /** true once ISC_PROGRAM_DONE was seen — a complete, terminated bitstream. */
  programDone: boolean
}

/**
 * Parse a whole ECP5 `.bit` file: the comment header, the `FF FF BD B3` preamble, the command stream (device id,
 * control words, usercode, the configuration frames, program-done) with its CRC verified.
 *
 * Structural problems (no preamble, truncated file, an unknown command) throw, as does a feature we cannot read
 * faithfully — a COMPRESSED payload or EBR data — so a file is never silently mis-parsed. A CRC mismatch is
 * reported as `crcOk: false` (the file parsed; its data is suspect) rather than thrown, matching the iCE40 parser.
 */
export function parseEcp5Bitstream(bytes: Uint8Array): ParsedEcp5Bitstream {
  // Locate the preamble; everything before it is the ASCII comment/metadata header.
  let start = -1
  for (let i = 0; i + PREAMBLE.length <= bytes.length; i++) {
    if (PREAMBLE.every((b, k) => bytes[i + k] === b)) {
      start = i + PREAMBLE.length
      break
    }
  }
  if (start < 0) throw new Error('No ECP5 preamble (FF FF BD B3) found in bitstream')
  const comment = String.fromCharCode(
    ...Array.from(bytes.subarray(0, Math.max(0, start - PREAMBLE.length))).filter(
      (b) => b >= 0x20 && b < 0x7f,
    ),
  )

  let pos = start
  let crc = 0
  const read = (): number => {
    if (pos >= bytes.length) throw new Error('Unexpected end of ECP5 bitstream')
    const b = bytes[pos++] as number
    crc = crc16Trellis(crc, b)
    return b
  }
  const skip = (n: number): void => {
    for (let i = 0; i < n; i++) read()
  }
  const readU32 = (): number => ((read() << 24) | (read() << 16) | (read() << 8) | read()) >>> 0

  let crcOk = true
  let crcChecks = 0
  const checkCrc = (): void => {
    const expected = finaliseCrc16(crc)
    const hi = read()
    const lo = read()
    crcChecks++
    if (((hi << 8) | lo) !== expected) crcOk = false
    crc = 0 // reset_crc16
  }

  let idcode: number | null = null
  let device: Ecp5Device | null = null
  let usercode: number | null = null
  const controlWords: number[] = []
  const frames: boolean[][] = []
  let programDone = false

  while (pos < bytes.length && !programDone) {
    // A DUMMY byte does not take part in the CRC (Trellis `get_command_opcode`).
    const raw = bytes[pos++] as number
    if (raw === CMD.DUMMY) continue
    crc = crc16Trellis(crc, raw)

    switch (raw) {
      case CMD.LSC_RESET_CRC:
        skip(3)
        crc = 0
        break
      case CMD.VERIFY_ID: {
        skip(3)
        idcode = readU32()
        device = ECP5_DEVICES.find((d) => d.idcode === idcode) ?? null
        break
      }
      case CMD.LSC_PROG_CNTRL0:
      case CMD.LSC_PROG_CNTRL1:
      case CMD.LSC_PROG_CNTRL0_2:
        skip(3)
        controlWords.push(readU32())
        break
      case CMD.ISC_PROGRAM_USERCODE:
      case CMD.ISC_PROGRAM_USERCODE_2: {
        const checkAfter = (read() & 0x80) !== 0
        skip(2)
        usercode = readU32()
        if (checkAfter) checkCrc()
        crc = 0
        break
      }
      case CMD.ISC_PROGRAM_DONE:
      case CMD.ISC_PROGRAM_DONE_2: {
        const checkAfter = (read() & 0x80) !== 0
        skip(2)
        if (checkAfter) checkCrc()
        programDone = true
        break
      }
      case CMD.ISC_PROGRAM_SECURITY:
      case CMD.LSC_INIT_ADDRESS:
      case CMD.LSC_WRITE_ADDRESS:
      case CMD.LSC_PROG_SED_CRC:
        skip(3)
        break
      case CMD.SPI_MODE:
        skip(3)
        break
      case CMD.JUMP:
        skip(3)
        break
      case CMD.LSC_PROG_INCR_RTI: {
        if (device === null)
          throw new Error(
            idcode === null
              ? 'ECP5 frame data began before the bitstream identified its device'
              : `ECP5 bitstream is for an unknown device (IDCODE 0x${idcode.toString(16)}) — its frame geometry is unknown`,
          )
        const p0 = read()
        const frameCount = (read() << 8) | read()
        const checkCrcFlag = (p0 & 0x80) !== 0
        const crcAfterEachFrame = checkCrcFlag && (p0 & 0x40) === 0
        const dummyBytes = p0 & 0x0f
        const bytesPerFrame =
          (device.bitsPerFrame + device.padBitsAfterFrame + device.padBitsBeforeFrame) / 8
        if (!Number.isInteger(bytesPerFrame))
          throw new Error(`ECP5 frame width for ${device.name} is not a whole number of bytes`)
        const frameBytes = new Uint8Array(bytesPerFrame)
        // ECP5 streams its configuration frames in REVERSE order: the first frame on the wire is the LAST frame
        // of the device (Trellis `BitstreamOptions::reversed_frames`, applied in its LSC_PROG_INCR_RTI loop as
        // `idx = num_frames - 1 - i`). Storing them in wire order puts every tile's bits at the wrong frame —
        // which a synthetic round-trip cannot catch, because it writes and reads with the same wrong convention.
        const ordered: boolean[][] = new Array(device.frames)
        for (let f = 0; f < frameCount; f++) {
          for (let i = 0; i < bytesPerFrame; i++) frameBytes[i] = read()
          // Trellis reads each frame LSB-first from the END of the byte run, offset by the leading pad bits.
          const row: boolean[] = []
          for (let j = 0; j < device.bitsPerFrame; j++) {
            const ofs = j + device.padBitsAfterFrame
            const byte = frameBytes[bytesPerFrame - 1 - Math.floor(ofs / 8)] as number
            row.push(((byte >> (ofs % 8)) & 1) === 1)
          }
          ordered[device.frames - 1 - f] = row
          if (crcAfterEachFrame || (checkCrcFlag && f === frameCount - 1)) checkCrc()
          skip(dummyBytes)
        }
        for (const row of ordered)
          frames.push(row ?? Array.from({ length: device.bitsPerFrame }, () => false))
        break
      }
      case CMD.LSC_PROG_INCR_CMP:
        throw new Error(
          'ECP5 bitstream is COMPRESSED (LSC_PROG_INCR_CMP); reading it needs the compression dictionary, which is not implemented',
        )
      case CMD.LSC_EBR_ADDRESS:
      case CMD.LSC_EBR_WRITE:
        throw new Error(
          'ECP5 bitstream carries EBR (block-RAM) initialisation data, which is not implemented',
        )
      default:
        throw new Error(`Unknown ECP5 bitstream command 0x${raw.toString(16)}`)
    }
  }

  return {
    device,
    idcode,
    comment,
    usercode,
    controlWords,
    frames,
    crcOk,
    crcChecks,
    programDone,
  }
}
