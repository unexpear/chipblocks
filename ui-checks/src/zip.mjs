// Minimal ZIP reader for checking the manufacturing ZIP: walks the central directory, inflates
// every entry and verifies its CRC-32, so "the ZIP opens" means every file in it really decodes.
import fs from 'node:fs'
import zlib from 'node:zlib'

let table = null
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0
  if (!table) {
    table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function readZip(file) {
  const buf = fs.readFileSync(file)
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('not a ZIP: no end-of-central-directory record')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const entries = []
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50)
      throw new Error(`central directory entry ${n} is corrupt`)
    const method = buf.readUInt16LE(p + 10)
    const crc = buf.readUInt32LE(p + 16)
    const csize = buf.readUInt32LE(p + 20)
    const usize = buf.readUInt32LE(p + 24)
    const nl = buf.readUInt16LE(p + 28)
    const xl = buf.readUInt16LE(p + 30)
    const cl = buf.readUInt16LE(p + 32)
    const lho = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nl)
    if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error(`${name}: local header is corrupt`)
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28)
    const raw = buf.subarray(start, start + csize)
    let data
    if (method === 0) data = raw
    else if (method === 8) data = zlib.inflateRawSync(raw)
    else throw new Error(`${name}: unsupported compression method ${method}`)
    if (data.length !== usize)
      throw new Error(`${name}: ${data.length} bytes, header says ${usize}`)
    if (crc32(data) !== crc) throw new Error(`${name}: CRC-32 mismatch`)
    entries.push({ name, size: usize, compressed: csize, method, data })
    p += 46 + nl + xl + cl
  }
  return { bytes: buf.length, entries }
}
