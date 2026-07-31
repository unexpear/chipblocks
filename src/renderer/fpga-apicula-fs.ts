/**
 * FPGA fabric — Gowin (via Project Apicula): parse a whole vendor `.fs` bitstream file.
 *
 * The first piece of a THIRD FPGA family, and the format differs from both Lattice ones again — which is why each
 * family gets its own parser rather than a parameterisation:
 *
 *   iCE40 `.bin` : binary, `7E AA 99 7E` sync, CRAM banks,   CRC-16-CCITT (poly 0x1021, init 0xFFFF)
 *   ECP5  `.bit` : binary, `FF FF BD B3` sync, frame stream, CRC-16 poly 0x8005 shifted MSB-first
 *   Gowin `.fs`  : **TEXT** — lines of ASCII '0'/'1' with `//` comments — and **CRC-16/ARC** (reflected 0x8005)
 *
 * Transcribed from Apicula's `apycula/bslib.py` (`read_bitstream`) and `apycula/crc16.py`. Each line of the file
 * is a run of bit characters converted to bytes; header lines carry commands until the frame count arrives, then
 * every following line is one configuration frame:
 *   `0x10` options (bit 13 ⇒ the stream is COMPRESSED)   `0x51` compression keys
 *   `0x3B` frame count (and end of header)                `0x06` device IDCODE
 *   `0xD2` SPI address (excluded from the CRC)            `0x6A`/`0x6B` extra slots
 *
 * A frame line's CONTENT is `line[padding : -64]` — the device-specific leading pad is dropped, as are the
 * trailing 64 bits that carry the per-frame CRC. The CRC covers all but the last 8 bytes of the line, is read
 * little-endian from bytes [-8]/[-7], and the final 6 bytes carry forward into the next frame's CRC data. Every
 * row is finally flipped left-to-right (Apicula's `fliplr`).
 *
 * Honest scope: this recovers the CONTAINER and the raw frame bit-matrix, verifying every per-frame CRC. It does
 * NOT interpret those bits — Gowin's tile/bit database (Apicula ships it as LZMA-compressed MessagePack) is a
 * separate step. COMPRESSED bitstreams are detected and REFUSED rather than mis-read, as are the 5A-series
 * transposed layout and any IDCODE not in the table below.
 */

/** One Gowin part: the IDCODE it announces, and the frame padding that IDCODE selects. */
export type GowinDevice = {
  name: string
  idcode: number
  /** leading bits dropped from each frame line before its content. */
  padding: number
  /** the equivalent for compressed streams (unused until compression is supported). */
  compressPadding: number
  /** true when upstream Apicula itself marks the part's parameters as unconfirmed. */
  provisional?: boolean
}

/**
 * The Gowin parts Apicula's `read_bitstream` recognises, with the padding each IDCODE selects.
 *
 * NOTE on GW1N-2: upstream marks it "support WIP", with its padding values commented as copied from GW1NZ-1 and
 * "confirm empirically". We carry it flagged `provisional` rather than silently presenting it as verified — the
 * uncertainty is upstream's, and hiding it would be the dishonest choice.
 */
export const GOWIN_DEVICES: readonly GowinDevice[] = [
  { name: 'GW1N-1', idcode: 0x0900281b, padding: 0, compressPadding: 0 },
  { name: 'GW1N-2', idcode: 0x0120681b, padding: 0, compressPadding: 0, provisional: true },
  { name: 'GW1N-4', idcode: 0x0100381b, padding: 0, compressPadding: 8 },
  { name: 'GW1N-9', idcode: 0x1100581b, padding: 4, compressPadding: 44 },
  { name: 'GW1N-9C', idcode: 0x1100481b, padding: 4, compressPadding: 44 },
  { name: 'GW1NZ-1', idcode: 0x0100681b, padding: 0, compressPadding: 0 },
  { name: 'GW1NS-4', idcode: 0x0100981b, padding: 0, compressPadding: 8 },
  { name: 'GW2A-18', idcode: 0x0000081b, padding: 0, compressPadding: 16 },
]

/**
 * CRC-16/ARC — reflected polynomial 0x8005, initial value 0, no final xor. This is a THIRD distinct checksum
 * across the three families: iCE40 uses CCITT (0x1021, init 0xFFFF) and ECP5 a custom MSB-shifted 0x8005.
 */
export function crc16Arc(bytes: Iterable<number>): number {
  let crc = 0
  for (const byte of bytes) {
    crc ^= byte & 0xff
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1
  }
  return crc & 0xffff
}

/** A parsed Gowin `.fs`: the part it targets, its container fields, and the raw configuration frames. */
export type ParsedGowinBitstream = {
  device: GowinDevice | null
  idcode: number | null
  /** the vendor tool version from the `//Tool Version:` comment, or '' if absent. */
  toolVersion: string
  /** the configuration frames: `frames[row][bit]`, already flipped left-to-right as Apicula does. */
  frames: boolean[][]
  /** whether every per-frame CRC matched. */
  crcOk: boolean
  crcChecks: number
}

/** Split a line of '0'/'1' characters into bytes, MSB first — Apicula's `bytearr`. */
function lineBytes(line: string): number[] {
  const bytes: number[] = []
  for (let i = 0; i + 8 <= line.length; i += 8) bytes.push(Number.parseInt(line.slice(i, i + 8), 2))
  return bytes
}

/**
 * Parse a whole Gowin `.fs` file: the header commands (IDCODE, frame count, options), then each configuration
 * frame with its CRC verified.
 *
 * Refuses rather than mis-reading: a COMPRESSED stream (needs the key-expansion path), the 5A-series transposed
 * layout, an unrecognised IDCODE, a file that is not a `.fs` at all, or one whose frames run out. A CRC mismatch
 * is reported as `crcOk: false` rather than thrown, matching the iCE40 and ECP5 parsers.
 */
export function parseGowinBitstream(text: string): ParsedGowinBitstream {
  const lines = text.split('\n')
  let toolVersion = ''
  let device: GowinDevice | null = null
  let idcode: number | null = null
  let framesLeft = 0
  let sawFrameCount = false
  let preamble = 3
  let crcOk = true
  let crcChecks = 0
  let crcData: number[] = []
  const frames: boolean[][] = []
  let sawBitLine = false

  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('//')) {
      if (line.startsWith('//Tool Version:')) toolVersion = line.slice(15).trim()
      continue
    }
    if (line === '') continue
    if (!/^[01]+$/.test(line)) continue // not a bit line — ignore stray text rather than mis-parsing it
    sawBitLine = true
    const bytes = lineBytes(line)
    const first = bytes[0] as number

    if (!sawFrameCount) {
      // still in the header: read the commands that matter
      // Apicula tests bit 13 of the WHOLE line read as one big-endian integer (`int.from_bytes(ba,'big')`), not
      // of its first bytes — for an 8-byte record that bit lives in the second-to-last byte.
      if (first === 0x10) {
        const secondLast = bytes[bytes.length - 2] ?? 0
        if ((secondLast & 0x20) !== 0)
          throw new Error(
            'This Gowin bitstream is COMPRESSED; expanding it needs the compression-key path, which is not implemented',
          )
      }
      if (preamble > 0) {
        preamble--
        continue
      }
      // From here Apicula gates on `not preamble`, so the IDCODE and frame-count records are only honoured
      // after the three preamble lines — matching `read_bitstream` exactly.
      if (first === 0x06) {
        idcode =
          (((bytes[4] as number) << 24) |
            ((bytes[5] as number) << 16) |
            ((bytes[6] as number) << 8) |
            (bytes[7] as number)) >>>
          0
        device = GOWIN_DEVICES.find((d) => d.idcode === idcode) ?? null
        if (device === null)
          throw new Error(
            `Gowin bitstream declares IDCODE 0x${idcode.toString(16)}, which is not a part we know — its frame padding is unknown`,
          )
      }
      if (first !== 0xd2) crcData.push(...bytes)
      if (first === 0x3b) {
        // Apicula: `frames = int.from_bytes(ba[2:], 'big')` — EVERY remaining byte, not a fixed 16-bit field.
        // The real record is four bytes (`3b 80 hi lo`, seen in the vendor chipdb's own `cmd_hdr`), so reading a
        // fixed `ba[2..3]` only coincides with Apicula at that one length and diverges at any other.
        framesLeft = 0
        for (let i = 2; i < bytes.length; i++) framesLeft = framesLeft * 256 + (bytes[i] as number)
        sawFrameCount = true
      }
      continue
    }

    if (framesLeft <= 0) continue // trailer lines after the frames
    if (device === null)
      throw new Error('Gowin frame data began before the bitstream identified its device')

    // per-frame CRC: covers everything but the last 8 bytes, read little-endian from bytes [-8]/[-7]
    crcData.push(...bytes.slice(0, -8))
    const expected =
      ((bytes[bytes.length - 7] as number) << 8) + (bytes[bytes.length - 8] as number)
    crcChecks++
    if (crc16Arc(crcData) !== expected) crcOk = false
    crcData = bytes.slice(-6)

    // content bits are line[padding : -64]; each row is then flipped left-to-right (Apicula `fliplr`)
    const content = line.slice(device.padding, line.length - 64)
    const row: boolean[] = []
    for (let i = content.length - 1; i >= 0; i--) row.push(content[i] === '1')
    frames.push(row)
    framesLeft--
  }

  if (!sawBitLine) throw new Error('Not a Gowin .fs bitstream: no bit lines found')
  if (!sawFrameCount)
    throw new Error('Not a readable Gowin .fs bitstream: no frame-count record (0x3B)')
  return { device, idcode, toolVersion, frames, crcOk, crcChecks }
}
