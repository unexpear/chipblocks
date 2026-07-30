/**
 * FPGA fabric — Stage 3a (real iCE40): parse a WHOLE vendor `.bin` bitstream file (its container format), and
 * serialize one back. The full staging is FPGA-FABRIC-RESEARCH.md §5. Our other Stage-2/3 modules work on the
 * CRAM-bit REPRESENTATION (per-tile row/col `ProgrammedBit`s); this reads/writes the actual FILE a real toolchain
 * (icepack / nextpnr) produces: a comment header, the `7E AA 99 7E` preamble, a command stream that streams the
 * four CRAM banks (and any BRAM banks) with width/height/offset/bank framing, a CRC-16 the reader verifies, and
 * device/config metadata (freqrange, warmboot, nosleep).
 *
 * The format here is transcribed directly from Project IceStorm's `icepack.cc` (`read_bits` / `write_bits` /
 * `update_crc16`, ISC-licensed) — the authoritative implementation — and CROSS-CHECKED against the real tool: the
 * committed fixture `fixtures/icebox-ice40-384-onebit.bin` is a genuine icepack-produced file, and a bitstream
 * `serializeBinFile` emits is accepted by real `icepack -u` ("CRC Check OK"). See the test file for both.
 *
 * Honest scope: this recovers the raw CRAM/BRAM BANK bit-images (`cram[bank][x][y]`) plus every container field,
 * and verifies the CRC. It does NOT map a bank coordinate (bank, x, y) back to a specific tile (x, y) or logic
 * cell — that inverse needs the per-device tile grid geometry (icepack's `CramIndexConverter`: column widths,
 * left/right/top halves, IO permutations), a separate follow-up — so it does not yet feed a real vendor file into
 * `reconstructNetlist`. IO / PLL / warmboot configuration and BRAM contents are recovered as raw bank bits, not
 * decoded into their higher-level meaning. What it delivers is the complete, CRC-verified configuration image a
 * bank→tile mapper would consume next.
 */

/** CRAM/BRAM banks: `banks[bank 0..3][x][y]` = one configuration bit. */
export type BinBanks = boolean[][][]

/** The container fields + recovered bank images of a parsed `.bin`. */
export type ParsedBin = {
  /** the ASCII comment header (icepack's initblop), decoded; '' if none. */
  comment: string
  freqrange: 'low' | 'medium' | 'high' | null
  warmboot: 'enabled' | 'disabled' | null
  nosleep: 'enabled' | 'disabled' | null
  cramWidth: number
  cramHeight: number
  /** the four CRAM banks (bank→x→y). */
  cram: BinBanks
  bramWidth: number
  bramHeight: number
  /** the four BRAM banks (empty if the file carries no BRAM data). */
  bram: BinBanks
  /** the chip detected from the CRAM dimensions (icepack's table), or null if unrecognised. */
  device: string | null
  /** whether every CRC check command in the file passed (vacuously true if the file has none). */
  crcOk: boolean
  /** how many CRC check commands the file contained. */
  crcChecks: number
}

/** Config for `serializeBinFile` (CRAM + optional BRAM + metadata). */
export type BinConfig = {
  /** a single-line ASCII comment header (no newlines); omitted ⇒ no comment. */
  comment?: string
  freqrange?: 'low' | 'medium' | 'high'
  warmboot?: 'enabled' | 'disabled'
  nosleep?: 'enabled' | 'disabled'
  cramWidth: number
  cramHeight: number
  /** the four CRAM banks (bank→x→y); each bank sized cramWidth × cramHeight. */
  cram: BinBanks
  /** the four BRAM banks (bank→x→y); omitted or 0-sized ⇒ no BRAM section is written. */
  bram?: BinBanks
  bramWidth?: number
  bramHeight?: number
}

/** CRC-16-CCITT (poly 0x1021), MSB-first per byte, 16-bit — icepack's `update_crc16` exactly. */
export function crc16Update(crc: number, byte: number): number {
  let c = crc & 0xffff
  for (let i = 7; i >= 0; i--) {
    const xor = ((c >> 15) & 1) ^ ((byte >> i) & 1) ? 0x1021 : 0
    c = ((c << 1) ^ xor) & 0xffff
  }
  return c
}

/** The chip whose CRAM is `width` × `height` (icepack's detection table), or null. */
function detectDevice(width: number, height: number): string | null {
  if (width === 182 && height === 80) return '384'
  if (width === 332 && height === 144) return '1k'
  if (width === 872 && height === 272) return '8k'
  if (width === 692 && height === 336) return '5k'
  if (width === 692 && height === 176) return 'u4k'
  if (width === 656 && height === 176) return 'lm4k'
  return null
}

/** Grow `banks` to 4 banks, and `banks[bank]` to width × height, preserving any bits already stored. */
function ensureBank(banks: BinBanks, bank: number, width: number, height: number): void {
  while (banks.length < 4) banks.push([])
  const b = banks[bank] as boolean[][]
  while (b.length < width) b.push([])
  for (const col of b) while (col.length < height) col.push(false)
}

/**
 * Parse a whole iCE40 `.bin` file into its container fields + CRAM/BRAM bank images, verifying the CRC. Structural
 * problems (no preamble, truncated file, unknown command, bad end token) throw; a CRC mismatch is reported as
 * `crcOk: false` (the file parsed, but its data is suspect) rather than thrown.
 */
export function parseBinFile(bytes: Uint8Array): ParsedBin {
  let pos = 0
  let crc = 0
  const read = (): number => {
    if (pos >= bytes.length) throw new Error('Unexpected end of .bin file')
    const b = bytes[pos++] as number
    crc = crc16Update(crc, b)
    return b
  }

  // Skip the comment header until the 0x7EAA997E preamble; the bytes before it are the comment (initblop).
  let preamble = 0
  const initblop: number[] = []
  for (;;) {
    const b = read()
    preamble = ((preamble << 8) | b) >>> 0
    if (preamble === 0xffffffff) throw new Error('No preamble found in .bin file')
    if (preamble === 0x7eaa997e) break
    initblop.push(b)
  }
  initblop.splice(initblop.length - 3, 3) // the 7E AA 99 already pushed are part of the preamble, not the comment

  let currentBank = 0
  let currentWidth = 0
  let currentHeight = 0
  let currentOffset = 0
  let wakeup = false
  let cramWidth = 0
  let cramHeight = 0
  let bramWidth = 0
  let bramHeight = 0
  const cram: BinBanks = []
  const bram: BinBanks = []
  let freqrange: ParsedBin['freqrange'] = null
  let warmboot: ParsedBin['warmboot'] = null
  let nosleep: ParsedBin['nosleep'] = null
  let crcOk = true
  let crcChecks = 0

  const fillBankData = (banks: BinBanks): void => {
    const byteCount = Math.floor((currentHeight * currentWidth) / 8)
    for (let i = 0; i < byteCount; i++) {
      const byte = read()
      for (let j = 0; j < 8; j++) {
        const idx = i * 8 + j
        const x = idx % currentWidth
        const y = Math.floor(idx / currentWidth) + currentOffset
        const col = (banks[currentBank] as boolean[][])[x] as boolean[]
        col[y] = ((byte << j) & 0x80) !== 0
      }
    }
    const hi = read()
    const lo = read()
    if (((hi << 8) | lo) !== 0)
      throw new Error(
        `Expected 0x0000 after bank data, got 0x${(((hi << 8) | lo) & 0xffff).toString(16)}`,
      )
  }

  while (!wakeup) {
    const command = read()
    let payload = 0
    for (let i = 0; i < (command & 0x0f); i++) payload = ((payload << 8) | read()) >>> 0

    switch (command & 0xf0) {
      case 0x00:
        switch (payload) {
          case 0x01:
            cramWidth = Math.max(cramWidth, currentWidth)
            cramHeight = Math.max(cramHeight, currentOffset + currentHeight)
            ensureBank(cram, currentBank, cramWidth, cramHeight)
            fillBankData(cram)
            break
          case 0x03:
            bramWidth = Math.max(bramWidth, currentWidth)
            bramHeight = Math.max(bramHeight, currentOffset + currentHeight)
            ensureBank(bram, currentBank, bramWidth, bramHeight)
            fillBankData(bram)
            break
          case 0x05:
            crc = 0xffff // reset CRC
            break
          case 0x06:
            wakeup = true
            break
          default:
            throw new Error(`Unknown 0x00 command payload 0x${payload.toString(16)}`)
        }
        break
      case 0x10:
        currentBank = payload
        break
      case 0x20:
        crcChecks++
        if (crc !== 0) crcOk = false
        break
      case 0x50:
        if (payload === 0) freqrange = 'low'
        else if (payload === 1) freqrange = 'medium'
        else if (payload === 2) freqrange = 'high'
        else throw new Error(`Unknown freqrange payload 0x${payload.toString(16)}`)
        break
      case 0x60:
        currentWidth = payload + 1
        break
      case 0x70:
        currentHeight = payload
        break
      case 0x80:
        currentOffset = payload
        break
      case 0x90:
        if (payload === 0) {
          warmboot = 'disabled'
          nosleep = 'disabled'
        } else if (payload === 1) {
          warmboot = 'disabled'
          nosleep = 'enabled'
        } else if (payload === 32) {
          warmboot = 'enabled'
          nosleep = 'disabled'
        } else if (payload === 33) {
          warmboot = 'enabled'
          nosleep = 'enabled'
        } else {
          throw new Error(`Unknown warmboot/nosleep payload 0x${payload.toString(16)}`)
        }
        break
      default:
        throw new Error(`Unknown command 0x${command.toString(16)}`)
    }
  }

  return {
    comment: String.fromCharCode(...initblop.filter((b) => b >= 0x20 && b < 0x7f)),
    freqrange,
    warmboot,
    nosleep,
    cramWidth,
    cramHeight,
    cram,
    bramWidth,
    bramHeight,
    bram,
    device: detectDevice(cramWidth, cramHeight),
    crcOk,
    crcChecks,
  }
}

/**
 * Serialize CRAM banks (+ optional BRAM) + metadata into a `.bin` file, mirroring icepack's `write_bits`
 * byte-for-byte (comment → preamble → freqrange → CRC reset → warmboot/nosleep → CRAM banks → BRAM banks → CRC →
 * wakeup → pad). The CRC is computed exactly as icepack does, so real `icepack -u` accepts the output and
 * `parseBinFile` round-trips it. Companion to the parser and the on-ramp to the future "loadable .bin" goal.
 *
 * Handles the iCE40UP **5k** special case (icepack `write_bits`): 5k skips the global CRAM height command and
 * emits a per-bank height, writing odd banks (1/3) at cramHeight/2+8 rows (176) and even banks at the full height
 * (336); its BRAM likewise skips the global width and emits a per-chunk width, halving it on odd banks. All other
 * devices (384 / 1k / 8k / u4k / lm4k) use the height-/width-symmetric path. BRAM is streamed in 128-row chunks.
 * The device is inferred from the CRAM dimensions (`detectDevice`).
 */
export function serializeBinFile(config: BinConfig): Uint8Array {
  const { cramWidth, cramHeight, cram } = config
  if ((cramWidth * cramHeight) % 8 !== 0)
    throw new Error(`CRAM width × height (${cramWidth}×${cramHeight}) must be a multiple of 8`)
  const is5k = detectDevice(cramWidth, cramHeight) === '5k'

  const out: number[] = []
  let crc = 0
  const w = (b: number): void => {
    out.push(b & 0xff)
    crc = crc16Update(crc, b & 0xff)
  }
  const w2 = (v: number): void => {
    w(v >> 8)
    w(v & 0xff)
  }
  // Pack a bit list MSB-first into whole bytes.
  const writeBits = (bits: boolean[]): void => {
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0
      for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i + j] ? 1 : 0)
      w(byte)
    }
  }

  // Comment header (initblop) — written raw, NOT part of the CRC, exactly like icepack.
  if (config.comment) {
    out.push(0xff, 0x00)
    for (const ch of config.comment) out.push(ch.charCodeAt(0) & 0xff)
    out.push(0x00, 0x00, 0xff)
  }

  w(0x7e)
  w(0xaa)
  w(0x99)
  w(0x7e) // preamble

  const freqrange = config.freqrange ?? 'low'
  w(0x51)
  w(freqrange === 'low' ? 0 : freqrange === 'medium' ? 1 : 2)

  w(0x01)
  w(0x05)
  crc = 0xffff // reset CRC

  const warmbootByte = config.warmboot === 'disabled' ? 0x00 : 0x20
  const nosleepByte = config.nosleep === 'enabled' ? 0x01 : 0x00
  w(0x92)
  w(0x00)
  w(warmbootByte | nosleepByte)

  // CRAM: global width; global height (skipped for 5k); offset 0; then each bank.
  w(0x62)
  w2(cramWidth - 1)
  if (!is5k) {
    w(0x72)
    w2(cramHeight)
  }
  w(0x82)
  w2(0)
  for (let bank = 0; bank < 4; bank++) {
    const height = is5k && bank % 2 === 1 ? cramHeight / 2 + 8 : cramHeight // 5k odd banks are half-height
    const bankBits = cram[bank] as boolean[][]
    const bits: boolean[] = []
    for (let y = 0; y < height; y++)
      for (let x = 0; x < cramWidth; x++) bits.push(bankBits[x]?.[y] ?? false)
    if (is5k) {
      w(0x72)
      w2(height)
    }
    w(0x11)
    w(bank)
    w(0x01)
    w(0x01)
    writeBits(bits)
    w(0x00)
    w(0x00)
  }

  // BRAM: streamed in 128-row chunks. Global width (skipped for 5k); height command = the chunk size (128).
  const bramWidth = config.bramWidth ?? 0
  const bramHeight = config.bramHeight ?? 0
  const bram = config.bram ?? []
  if (bramWidth && bramHeight) {
    const chunk = 128
    if (!is5k) {
      w(0x62)
      w2(bramWidth - 1)
    }
    w(0x72)
    w2(chunk)
    for (let bank = 0; bank < 4; bank++) {
      w(0x11)
      w(bank)
      const width = is5k && bank % 2 === 1 ? bramWidth / 2 : bramWidth // 5k odd banks are half-width
      const bankBits = bram[bank] as boolean[][]
      for (let offset = 0; offset < bramHeight; offset += chunk) {
        const bits: boolean[] = []
        for (let y = 0; y < chunk; y++)
          for (let x = 0; x < width; x++) bits.push(bankBits?.[x]?.[y + offset] ?? false)
        w(0x82)
        w2(offset)
        if (is5k) {
          w(0x62)
          w2(width - 1)
        }
        w(0x01)
        w(0x03)
        writeBits(bits)
        w(0x00)
        w(0x00)
      }
    }
  }

  w(0x22)
  const crcHi = crc >> 8 // capture BOTH CRC bytes before writing either — w() mutates crc as it goes
  const crcLo = crc & 0xff
  w(crcHi)
  w(crcLo)
  w(0x01)
  w(0x06) // wakeup
  w(0x00) // padding

  return Uint8Array.from(out)
}
