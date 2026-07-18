/**
 * OASIS WRITER — the compact-binary twin of gds.ts (chip-physical chapter, step 6b). OASIS (SEMI P39 /
 * P44, "Open Artwork System Interchange Standard") is the modern successor to GDSII: the same job — an
 * integer layer/datatype polygon stream that opens in KLayout (and OpenROAD; Magic reads GDSII, not
 * OASIS) — but self-delimiting records,
 * base-128 varints, and MODAL VARIABLES (a record omits any field equal to the last one written) make the
 * same floorplan serialize far smaller. This emits the SAME geometry floorplanToGds does, byte-position
 * identical (same λ→nm rounding + Y-flip), just in the OASIS encoding.
 *
 * SCOPE (honest): HIERARCHICAL like the GDS — one CELL per unique gate + a PLACEMENT (id 17) per instance,
 * the die + per-cell prBoundary outlines on the top cell — with validation-scheme 0 (no checksum). The
 * geometry is the C5N λ-scaled TEACHING cells on SKY130
 * layer numbers (same as the .gds) — for inspection in KLayout, not a foundry sign-off artifact.
 * Unlike writeGds(lib, when), writeOasis takes no timestamp (OASIS timestamps are optional) so it is
 * deterministic by construction.
 */

import { PROCESS } from './cell-layout.ts'
import { cellOrient, type Floorplan } from './cell-place.ts'
import { cellBlock, cellPolygons } from './cell-polygons.ts'
import { gdsName } from './gds.ts'
import { type GdsPair, gdsOf, PR_BOUNDARY } from './pdk.ts'

// ---- primitive encoders (build a number[] and Uint8Array.from at the end, like gds.ts) ----

/** base-128 little-endian varint (SEMI P39). Uses Math.floor(/128), never >>>7 — a big-die nm value can
 *  approach 2^31 where a 32-bit shift would corrupt it. Guards, never throws. */
function pushUInt(out: number[], value: number): void {
  let v = Math.max(0, Math.round(value))
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80)
    v = Math.floor(v / 128)
  }
  out.push(v & 0x7f)
}

/** signed integer = magnitude with the sign in the LOW bit (×2 not <<1, for 32-bit safety). */
function pushSInt(out: number[], value: number): void {
  const v = Math.round(value)
  pushUInt(out, Math.abs(v) * 2 + (v < 0 ? 1 : 0))
}

/** length-prefixed byte string. The caller sanitizes the charset (oasisName / a literal); no masking here. */
function pushString(out: number[], s: string): void {
  pushUInt(out, s.length)
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0x7f)
}

/** OASIS real, type 0 (non-negative whole number) — the only real kind we emit (the unit). */
function pushReal0(out: number[], n: number): void {
  pushUInt(out, 0)
  pushUInt(out, Math.max(0, Math.round(n)))
}

/** Sanitize to an OASIS n-string (printable 0x21..0x7E, no space): whitespace → '_', out-of-set dropped,
 *  never empty. Must clean the charset itself — pushString's &0x7f would turn a high byte into a stray
 *  printable rather than removing it. */
export function oasisName(raw: string): string {
  let s = ''
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i)
    if (c === 32 || c === 9 || c === 10 || c === 13) s += '_'
    else if (c >= 0x21 && c <= 0x7e) s += raw[i]
  }
  s = s.slice(0, 256)
  return s.length > 0 ? s : 'CELL'
}

/** The 13-byte OASIS magic prefix `%SEMI-OASIS\r\n` (a literal prefix, not a record). */
const MAGIC = [0x25, 0x53, 0x45, 0x4d, 0x49, 0x2d, 0x4f, 0x41, 0x53, 0x49, 0x53, 0x0d, 0x0a]

/** A rectangle in database units (nm), lower-left origin, +y up. */
export type OasisRect = {
  layer: number
  datatype: number
  x: number
  y: number
  w: number
  h: number
}
/** A reference placing a previously-defined cell at (x, y) in database units; `flip` = the N/FS mirror. */
export type OasisPlacement = { cell: string; x: number; y: number; flip?: boolean }
export type OasisCell = { name: string; rects: OasisRect[]; placements?: OasisPlacement[] }
/** unitPerMicron = database units per micron (1000 ⇒ a 1 nm grid). */
export type OasisLayout = { cells: OasisCell[]; unitPerMicron: number }

/** The padding length that makes the END record total exactly 256 bytes: solved (not hardcoded) so it stays
 *  correct if a validation scheme is ever added. `nonPaddingBytes` = the END bytes outside the padding
 *  b-string (id + validation-scheme = 2 for the minimal END). */
function padLenFor(nonPaddingBytes: number): number {
  for (let p = 256; p >= 0; p--) {
    const prefix: number[] = []
    pushUInt(prefix, p)
    if (prefix.length + p === 256 - nonPaddingBytes) return p
  }
  return 0
}

/** Serialize an OASIS layout to its binary byte stream. */
export function writeOasis(layout: OasisLayout): Uint8Array {
  const out: number[] = [...MAGIC]
  // START (id 1): version, unit, offset-flag 0 (table offsets live here — all empty).
  pushUInt(out, 1)
  pushString(out, '1.0')
  pushReal0(out, layout.unitPerMicron)
  pushUInt(out, 0) // offset-flag
  for (let i = 0; i < 12; i++) pushUInt(out, 0) // 6 tables × { strict-flag, offset }, all 0

  for (const cell of layout.cells) {
    pushUInt(out, 14) // CELL by name
    pushString(out, cell.name)
    pushUInt(out, 15) // XYABSOLUTE (once per cell)
    // modal variables — reset per cell; the first rectangle forces every field (L|D|W|H|X|Y).
    let mLayer: number | undefined
    let mDatatype: number | undefined
    let mW: number | undefined
    let mH: number | undefined
    for (const r of cell.rects) {
      const hasL = r.layer !== mLayer
      const hasD = r.datatype !== mDatatype
      const hasW = r.w !== mW
      const hasH = r.h !== mH
      // info-byte SWHXYRDL: S=0 (not a square) R=0 (no repetition) X=Y=1 (absolute coords always written).
      const info =
        (hasW ? 0x40 : 0) | (hasH ? 0x20 : 0) | 0x10 | 0x08 | (hasD ? 0x02 : 0) | (hasL ? 0x01 : 0)
      pushUInt(out, 20) // RECTANGLE
      out.push(info)
      // field order after the info-byte: layer, datatype, width, height, x, y (unsigned; x/y signed).
      if (hasL) pushUInt(out, r.layer)
      if (hasD) pushUInt(out, r.datatype)
      if (hasW) pushUInt(out, r.w)
      if (hasH) pushUInt(out, r.h)
      pushSInt(out, r.x)
      pushSInt(out, r.y)
      mLayer = r.layer
      mDatatype = r.datatype
      mW = r.w
      mH = r.h
    }
    // PLACEMENT (id 17) references a previously-defined cell by name at (x,y). Info-byte CNXYRAAF (a
    // DIFFERENT bit layout from the RECTANGLE's SWHXYRDL): C=0x80 explicit cell-name, X=0x20, Y=0x10,
    // F=0x01 flip-about-x (the N/FS mirror). We always set C|X|Y (0xB0), and F for a flipped placement.
    for (const p of cell.placements ?? []) {
      pushUInt(out, 17)
      out.push(p.flip ? 0xb1 : 0xb0)
      pushString(out, p.cell)
      pushSInt(out, p.x)
      pushSInt(out, p.y)
    }
  }

  // END (id 2): a padding b-string + validation-scheme 0, the whole record padded to exactly 256 bytes.
  pushUInt(out, 2)
  const padLen = padLenFor(2)
  pushUInt(out, padLen)
  for (let i = 0; i < padLen; i++) out.push(0)
  pushUInt(out, 0) // validation-scheme = none
  return Uint8Array.from(out)
}

const CELL_NM = (lambda: number): number => Math.round(lambda * PROCESS.lambdaUm * 1000)

/**
 * Build a HIERARCHICAL OASIS layout from the placed floorplan — mirroring the GDS SREF hierarchy in gds.ts:
 * one CELL per unique gate type (its cell-local polygons) + a top cell that holds the die + per-cell
 * prBoundary outlines and one PLACEMENT per instance referencing its gate cell. λ → nm via the process; the
 * placement origin + cell-local geometry reproduce the same absolute coordinates the .gds emits (identical
 * two-step rounding + Y-flip). An unmapped cell keeps only its outline (no placement, no fabricated cell).
 */
export function floorplanToOasis(
  floorplan: Floorplan,
  options: { topName?: string; boundaryLayer?: GdsPair; cellPolygons?: boolean } = {},
): OasisLayout {
  const boundary = options.boundaryLayer ?? PR_BOUNDARY
  const withPolygons = options.cellPolygons !== false
  const dieH = floorplan.dieHeightLambda
  const flipY = (yLambda: number) => CELL_NM(dieH - yLambda)

  const topRects: OasisRect[] = []
  if (floorplan.dieWidthLambda > 0 && dieH > 0) {
    topRects.push({
      layer: boundary.layer,
      datatype: boundary.datatype,
      x: 0,
      y: 0,
      w: CELL_NM(floorplan.dieWidthLambda),
      h: CELL_NM(dieH),
    })
  }
  // prBoundary outline per placed cell (mapped or not) — visualisation, always on the top cell.
  for (const c of floorplan.cells) {
    const x0 = CELL_NM(c.x)
    const y0 = flipY(c.y + c.h)
    topRects.push({
      layer: boundary.layer,
      datatype: boundary.datatype,
      x: x0,
      y: y0,
      w: CELL_NM(c.x + c.w) - x0,
      h: flipY(c.y) - y0,
    })
  }

  // one CELL per unique mapped gate (cell-local, upright) + a PLACEMENT per instance.
  const gateCells: OasisCell[] = []
  const placements: OasisPlacement[] = []
  const seen = new Set<string>()
  if (withPolygons) {
    for (const c of floorplan.cells) {
      const block = cellBlock(c.name)
      if (!block) continue // unmapped: outline only, no placement, no cell
      const cellName = gdsName(`cell_${c.name}`)
      if (!seen.has(c.name)) {
        seen.add(c.name)
        const local = cellPolygons(block).rects.map((r) => {
          const pair = gdsOf(r.layer) ?? PR_BOUNDARY
          return {
            layer: pair.layer,
            datatype: pair.datatype,
            x: CELL_NM(r.x),
            y: CELL_NM(r.y),
            w: CELL_NM(r.w),
            h: CELL_NM(r.h),
          }
        })
        gateCells.push({ name: cellName, rects: local })
      }
      // Same rule as the GDS SREF: an N cell references its row bottom (flipY(c.y + c.h)); an FS cell is
      // flipped about the x-axis (info-byte F flag) and references the row TOP (flipY(c.y)) so the mirrored
      // cell still fills the band — the odd-row flip that abuts the power rails on the same net.
      const flip = cellOrient(c) === 'FS'
      placements.push({
        cell: cellName,
        x: CELL_NM(c.x),
        y: flip ? flipY(c.y) : flipY(c.y + c.h),
        flip,
      })
    }
  }

  const top: OasisCell = {
    name: oasisName(options.topName ?? 'chipblocks_top'),
    rects: topRects,
    placements,
  }
  return { unitPerMicron: 1000, cells: [...gateCells, top] }
}
