/**
 * A from-scratch ZIP writer for the manufacturing ZIP — deterministic, dependency-free, STORE-only.
 *
 * The manufacturing ZIP is the engine-owned deliverable (CLAUDE.md core principle 1): the exact bytes
 * matter, so this writer is deliberately minimal and reproducible — the same entries and the same
 * timestamp always produce the identical archive, byte for byte. Files are STORED (method 0, no
 * compression): Gerber and drill files are a few kilobytes of text, and storing removes an entire
 * class of compression bugs from the one artifact that goes to a fab.
 *
 * Format per the .ZIP File Format Specification (PKWARE APPNOTE.TXT, section 4.3): one local file
 * header + data per entry, then a central directory record per entry, then the end-of-central-
 * directory record. CRC-32 is the IEEE 802.3 polynomial (0xEDB88320 reflected), APPNOTE §4.4.7.
 * Timestamps are MS-DOS format (2-second resolution, local time), APPNOTE §4.4.6.
 */

export type ZipEntry = {
  /** Archive path, forward slashes. ASCII expected (fab-file names are ASCII by construction). */
  name: string
  data: Uint8Array
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = (CRC_TABLE[(crc ^ (data[i] as number)) & 0xff] as number) ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** MS-DOS date + time words (APPNOTE §4.4.6): local time, 2-second resolution, epoch 1980. */
function dosDateTime(when: Date): { date: number; time: number } {
  const year = Math.max(when.getFullYear(), 1980)
  return {
    date: ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1),
  }
}

class ByteWriter {
  private chunks: Uint8Array[] = []
  private scratch = new DataView(new ArrayBuffer(4))
  length = 0

  u16(v: number): void {
    this.scratch.setUint16(0, v, true)
    this.bytes(new Uint8Array(this.scratch.buffer.slice(0, 2)))
  }
  u32(v: number): void {
    this.scratch.setUint32(0, v >>> 0, true)
    this.bytes(new Uint8Array(this.scratch.buffer.slice(0, 4)))
  }
  bytes(b: Uint8Array): void {
    this.chunks.push(b)
    this.length += b.length
  }
  out(): Uint8Array {
    const all = new Uint8Array(this.length)
    let at = 0
    for (const c of this.chunks) {
      all.set(c, at)
      at += c.length
    }
    return all
  }
}

/**
 * Build a STORE-method ZIP of the given entries, stamped with one fixed timestamp (the caller's
 * export moment — passing it in keeps the builder pure and the tests byte-reproducible).
 */
export function buildZip(entries: readonly ZipEntry[], when: Date): Uint8Array {
  // The classic (non-Zip64) format ends at 16-bit entry counts and 32-bit sizes. Nothing this
  // writer serves approaches either, but overflowing silently would corrupt the EOCD — refuse.
  if (entries.length > 0xffff) {
    throw new Error(`ZIP entry count ${entries.length} exceeds the format's 65535 limit`)
  }
  for (const entry of entries) {
    if (entry.data.length > 0xffffffff) {
      throw new Error(`ZIP entry '${entry.name}' exceeds the format's 4 GiB size limit`)
    }
  }
  const encoder = new TextEncoder()
  const { date, time } = dosDateTime(when)
  const w = new ByteWriter()
  const central: { name: Uint8Array; crc: number; size: number; offset: number }[] = []

  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const crc = crc32(entry.data)
    central.push({ name, crc, size: entry.data.length, offset: w.length })
    w.u32(0x04034b50) // local file header signature
    w.u16(20) // version needed: 2.0 (plain file, STORE)
    w.u16(0) // flags
    w.u16(0) // method 0 = STORE
    w.u16(time)
    w.u16(date)
    w.u32(crc)
    w.u32(entry.data.length) // compressed size (= size for STORE)
    w.u32(entry.data.length)
    w.u16(name.length)
    w.u16(0) // extra field length
    w.bytes(name)
    w.bytes(entry.data)
  }

  const centralStart = w.length
  for (const c of central) {
    w.u32(0x02014b50) // central directory header signature
    w.u16(20) // version made by
    w.u16(20) // version needed
    w.u16(0)
    w.u16(0)
    w.u16(time)
    w.u16(date)
    w.u32(c.crc)
    w.u32(c.size)
    w.u32(c.size)
    w.u16(c.name.length)
    w.u16(0) // extra
    w.u16(0) // comment
    w.u16(0) // disk number
    w.u16(0) // internal attributes
    w.u32(0) // external attributes
    w.u32(c.offset)
    w.bytes(c.name)
  }
  const centralSize = w.length - centralStart

  w.u32(0x06054b50) // end of central directory signature
  w.u16(0) // this disk
  w.u16(0) // central-directory disk
  w.u16(central.length)
  w.u16(central.length)
  w.u32(centralSize)
  w.u32(centralStart)
  w.u16(0) // comment length
  return w.out()
}
