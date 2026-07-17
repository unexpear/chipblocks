/**
 * ChipBlocks app-icon generator — dependency-free (matches the project's no-extra-deps ethos: no ImageMagick,
 * no sharp, no png-to-ico). It draws the icon into RGBA pixel buffers, PNG-encodes them with Node's built-in
 * zlib, and packs a real multi-resolution Windows .ico plus a 512px .png fallback.
 *
 *   node resources/make-icon.mjs
 *
 * The mark: a bright "block" frame (the cube) surrounding a recessed microchip die — pins on four sides and a
 * glowing core. Literal to the name (a chip, held in a block) and legible down to 16px.
 *
 * Regenerate whenever the design changes; commit the resulting resources/icon.ico + resources/icon.png.
 */

import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))

// ---- tiny RGBA canvas with source-over compositing ----
function canvas(size) {
  return { size, data: new Float64Array(size * size * 4) } // straight RGBA, 0..1
}
function put(c, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= c.size || y >= c.size || a <= 0) return
  const i = (y * c.size + x) * 4
  const da = c.data[i + 3]
  const outA = a + da * (1 - a)
  if (outA <= 0) return
  for (let k = 0; k < 3; k++) {
    const s = [r, g, b][k]
    c.data[i + k] = (s * a + c.data[i + k] * da * (1 - a)) / outA
  }
  c.data[i + 3] = outA
}
const hex = (h) => [
  parseInt(h.slice(1, 3), 16) / 255,
  parseInt(h.slice(3, 5), 16) / 255,
  parseInt(h.slice(5, 7), 16) / 255,
]

// Signed helper: is (px,py) inside a rounded rect [x,y,w,h] with corner radius r? (all in pixels)
function inRoundRect(px, py, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2)
  const cx = Math.min(Math.max(px, x + rr), x + w - rr)
  const cy = Math.min(Math.max(py, y + rr), y + h - rr)
  const dx = px - cx
  const dy = py - cy
  if (px >= x + rr && px <= x + w - rr) return py >= y && py <= y + h
  if (py >= y + rr && py <= y + h - rr) return px >= x && px <= x + w
  return dx * dx + dy * dy <= rr * rr
}

// Fill a rounded rect; colour may be a function (px,py)->[r,g,b] for gradients.
function fillRR(c, nx, ny, nw, nh, nr, colour, alpha = 1) {
  const S = c.size
  const x = nx * S
  const y = ny * S
  const w = nw * S
  const h = nh * S
  const r = nr * S
  const x0 = Math.max(0, Math.floor(x))
  const y0 = Math.max(0, Math.floor(y))
  const x1 = Math.min(S, Math.ceil(x + w))
  const y1 = Math.min(S, Math.ceil(y + h))
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      if (!inRoundRect(px + 0.5, py + 0.5, x, y, w, h, r)) continue
      const col = typeof colour === 'function' ? colour((px + 0.5) / S, (py + 0.5) / S) : colour
      put(c, px, py, col[0], col[1], col[2], alpha)
    }
  }
}

// Vertical gradient between two hex colours over the icon's full height.
function vgrad(topHex, botHex) {
  const t = hex(topHex)
  const b = hex(botHex)
  return (_nx, ny) => [
    t[0] + (b[0] - t[0]) * ny,
    t[1] + (b[1] - t[1]) * ny,
    t[2] + (b[2] - t[2]) * ny,
  ]
}

// ---- the scene, drawn in normalized 0..1 coordinates so it renders at any resolution ----
function drawIcon(c) {
  const TILE = vgrad('#141d33', '#0a0e19')
  const BLOCK = vgrad('#5f9df2', '#3f77d8')
  const CAVITY = vgrad('#0e1524', '#0b1120')
  const DIE = vgrad('#263552', '#1a2740') // top slightly lighter
  const DIE_TOP = hex('#324463')
  const PIN = hex('#aebbd4')
  const CORE = hex('#8fd2ff')
  const CORE_PAD = hex('#16233c')

  // App tile
  fillRR(c, 0, 0, 1, 1, 0.235, TILE)

  // The surrounding block (a thick rounded ring): fill the block, then punch the cavity.
  fillRR(c, 0.105, 0.105, 0.79, 0.79, 0.2, BLOCK)
  // recessed cavity
  fillRR(c, 0.225, 0.225, 0.55, 0.55, 0.12, CAVITY)

  // Pins: 3 per side, reaching from the die toward the cavity wall.
  const pin = 0.05 // length
  const pw = 0.035 // width
  const along = [0.42, 0.5, 0.58] // centered on the die
  for (const a of along) {
    // top + bottom
    fillRR(c, a - pw / 2, 0.245, pw, pin, 0.01, PIN)
    fillRR(c, a - pw / 2, 1 - 0.245 - pin, pw, pin, 0.01, PIN)
    // left + right
    fillRR(c, 0.245, a - pw / 2, pin, pw, 0.01, PIN)
    fillRR(c, 1 - 0.245 - pin, a - pw / 2, pin, pw, 0.01, PIN)
  }

  // The die
  fillRR(c, 0.31, 0.31, 0.38, 0.38, 0.055, DIE_TOP)
  fillRR(c, 0.315, 0.322, 0.37, 0.362, 0.05, DIE)

  // Glowing core + inner pad
  fillRR(c, 0.4325, 0.4325, 0.135, 0.135, 0.03, CORE)
  fillRR(c, 0.462, 0.462, 0.076, 0.076, 0.02, CORE_PAD)
  // pin-1 marker dot
  fillRR(c, 0.35, 0.35, 0.028, 0.028, 0.014, CORE)
}

// ---- render at supersample, then box-downsample for anti-aliasing ----
function renderAt(target) {
  const ss = Math.max(1, Math.floor(1024 / target))
  const R = target * ss
  const big = canvas(R)
  drawIcon(big)
  const out = canvas(target)
  for (let y = 0; y < target; y++) {
    for (let x = 0; x < target; x++) {
      let ar = 0
      let ag = 0
      let ab = 0
      let aa = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const i = ((y * ss + sy) * R + (x * ss + sx)) * 4
          const a = big.data[i + 3]
          ar += big.data[i] * a
          ag += big.data[i + 1] * a
          ab += big.data[i + 2] * a
          aa += a
        }
      }
      const o = (y * target + x) * 4
      if (aa > 0) {
        out.data[o] = ar / aa
        out.data[o + 1] = ag / aa
        out.data[o + 2] = ab / aa
      }
      out.data[o + 3] = aa / (ss * ss)
    }
  }
  return out
}

// ---- PNG encode (RGBA, filter 0) ----
function crc32(buf) {
  let c = ~0
  for (let n = 0; n < buf.length; n++) {
    c ^= buf[n]
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return (~c) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}
function toPng(c) {
  const S = c.size
  const raw = Buffer.alloc(S * (S * 4 + 1))
  for (let y = 0; y < S; y++) {
    raw[y * (S * 4 + 1)] = 0 // filter: none
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4
      const o = y * (S * 4 + 1) + 1 + x * 4
      for (let k = 0; k < 4; k++) raw[o + k] = Math.round(Math.min(1, Math.max(0, c.data[i + k])) * 255)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(S, 0)
  ihdr.writeUInt32BE(S, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---- ICO pack (PNG-compressed entries; Windows Vista+) ----
function toIco(entries) {
  const count = entries.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)
  const dir = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count
  entries.forEach((e, idx) => {
    const d = dir.subarray(16 * idx)
    d[0] = e.size >= 256 ? 0 : e.size
    d[1] = e.size >= 256 ? 0 : e.size
    d[2] = 0 // palette
    d[3] = 0
    d.writeUInt16LE(1, 4) // planes
    d.writeUInt16LE(32, 6) // bpp
    d.writeUInt32LE(e.png.length, 8)
    d.writeUInt32LE(offset, 12)
    offset += e.png.length
  })
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)])
}

const sizes = [16, 32, 48, 64, 128, 256]
const entries = sizes.map((size) => ({ size, png: toPng(renderAt(size)) }))
writeFileSync(join(HERE, 'icon.ico'), toIco(entries))
writeFileSync(join(HERE, 'icon.png'), toPng(renderAt(512)))
console.log(`wrote resources/icon.ico (${sizes.join(',')}) + resources/icon.png (512)`)
