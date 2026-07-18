import { PROCESS } from './cell-layout.ts'
import type { Floorplan } from './cell-place.ts'
import { type GdsPair, PR_BOUNDARY } from './pdk.ts'

/**
 * The GDSII writer — the chip-side twin of pcb-gerber.ts: it turns the placed floorplan into a real
 * GDSII byte stream, the de-facto EDA layout interchange format (Calma, 1978). This is the "exportable"
 * deliverable of the chip-physical chapter: a .gds ChipBlocks emits opens in Magic / KLayout / OpenROAD,
 * so a design can leave ChipBlocks and be verified or continued in another tool — build our own writer
 * (like the Gerber writer), never bundle a layout tool.
 *
 * FORMAT (MASK-AND-LAYOUT-EDA-ARC.md §2 + the GDSII stream spec): a sequence of RECORDS, each
 * `[uint16 byte-length incl. this 4-byte header][uint8 record-type][uint8 data-type][data]`, all
 * BIG-ENDIAN. A library (HEADER / BGNLIB / LIBNAME / UNITS) holds STRUCTURES (cells), each holding
 * ELEMENTS — here BOUNDARY (a polygon: LAYER + DATATYPE + a closed XY point list) and SREF (a cell
 * reference, for hierarchy). Geometry is identified by an INTEGER layer + datatype (the PDK layer map),
 * never by name. Coordinates are in DATABASE UNITS (integers): we use a 1 µm user unit on a 1 nm grid
 * (UNITS = [1e-3, 1e-9]), so a value of 300 means 300 nm = 0.3 µm.
 *
 * The one non-obvious encoding is the 8-byte REAL (UNITS): GDSII uses its own base-16, excess-64 float,
 * NOT IEEE-754 — see gdsReal below.
 */

/** GDSII record type + data-type bytes (the high and low byte of the record's 2-byte tag). */
const REC = {
  HEADER: [0x00, 0x02],
  BGNLIB: [0x01, 0x02],
  LIBNAME: [0x02, 0x06],
  UNITS: [0x03, 0x05],
  ENDLIB: [0x04, 0x00],
  BGNSTR: [0x05, 0x02],
  STRNAME: [0x06, 0x06],
  ENDSTR: [0x07, 0x00],
  BOUNDARY: [0x08, 0x00],
  SREF: [0x0a, 0x00],
  SNAME: [0x12, 0x06],
  LAYER: [0x0d, 0x02],
  DATATYPE: [0x0e, 0x02],
  XY: [0x10, 0x03],
  ENDEL: [0x11, 0x00],
} as const

/** A point in DATABASE units (integer nm). */
export type GdsPoint = { x: number; y: number }
/** A filled polygon on one layer. `points` is the closed ring (first === last). */
export type GdsBoundary = { kind: 'boundary'; layer: number; datatype: number; points: GdsPoint[] }
/** A placed reference to another structure (hierarchy), at (x, y) in database units. */
export type GdsSref = { kind: 'sref'; structure: string; x: number; y: number }
export type GdsElement = GdsBoundary | GdsSref
export type GdsStructure = { name: string; elements: GdsElement[] }
export type GdsLibrary = {
  name: string
  /** The user unit in metres (1 µm = 1e-6). */
  userUnitMeters: number
  /** The database (grid) unit in metres (1 nm = 1e-9). */
  dbUnitMeters: number
  structures: GdsStructure[]
}

const pushU16 = (out: number[], v: number) => out.push((v >>> 8) & 0xff, v & 0xff)
const pushI32 = (out: number[], v: number) =>
  out.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff)

/** GDSII 8-byte REAL: sign bit, 7-bit base-16 exponent in excess-64, 56-bit fractional mantissa in
 *  [1/16, 1) — NOT IEEE-754. (1.0 → 41 10 00 00 00 00 00 00.) */
export function gdsReal(value: number): number[] {
  if (value === 0) return [0, 0, 0, 0, 0, 0, 0, 0]
  const sign = value < 0 ? 0x80 : 0
  let x = Math.abs(value)
  let exp = 64
  while (x >= 1) {
    x /= 16
    exp += 1
  }
  while (x < 1 / 16) {
    x *= 16
    exp -= 1
  }
  const bytes = [sign | (exp & 0x7f)]
  let mant = x
  for (let i = 0; i < 7; i++) {
    mant *= 256
    const b = Math.floor(mant)
    bytes.push(b)
    mant -= b
  }
  return bytes
}

/** ASCII record data — GDSII strings are null-padded to an even length. */
const asciiData = (s: string): number[] => {
  const bytes: number[] = []
  for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i) & 0x7f)
  if (bytes.length % 2 === 1) bytes.push(0)
  return bytes
}

/** A BGNLIB/BGNSTR timestamp block: two dates (last-modified + last-accessed), each 6 × int16. */
const dateData = (when: Date): number[] => {
  const one = [
    when.getFullYear(),
    when.getMonth() + 1,
    when.getDate(),
    when.getHours(),
    when.getMinutes(),
    when.getSeconds(),
  ]
  const out: number[] = []
  for (const v of [...one, ...one]) pushU16(out, v)
  return out
}

const record = (out: number[], tag: readonly [number, number], data: number[]) => {
  pushU16(out, 4 + data.length) // length includes the 4-byte header
  out.push(tag[0], tag[1])
  for (const b of data) out.push(b)
}

/** Serialize a GDS library to its binary byte stream. */
export function writeGds(lib: GdsLibrary, when: Date): Uint8Array {
  const out: number[] = []
  const i2 = (v: number) => [(v >> 8) & 0xff, v & 0xff]
  record(out, REC.HEADER, i2(600)) // GDSII release 6
  record(out, REC.BGNLIB, dateData(when))
  record(out, REC.LIBNAME, asciiData(lib.name))
  // UNITS = [database unit expressed in user units, database unit in metres].
  record(out, REC.UNITS, [
    ...gdsReal(lib.dbUnitMeters / lib.userUnitMeters),
    ...gdsReal(lib.dbUnitMeters),
  ])
  for (const s of lib.structures) {
    record(out, REC.BGNSTR, dateData(when))
    record(out, REC.STRNAME, asciiData(s.name))
    for (const el of s.elements) {
      if (el.kind === 'boundary') {
        record(out, REC.BOUNDARY, [])
        record(out, REC.LAYER, i2(el.layer))
        record(out, REC.DATATYPE, i2(el.datatype))
        const xy: number[] = []
        for (const p of el.points) {
          pushI32(xy, p.x)
          pushI32(xy, p.y)
        }
        record(out, REC.XY, xy)
        record(out, REC.ENDEL, [])
      } else {
        record(out, REC.SREF, [])
        record(out, REC.SNAME, asciiData(el.structure))
        const xy: number[] = []
        pushI32(xy, el.x)
        pushI32(xy, el.y)
        record(out, REC.XY, xy)
        record(out, REC.ENDEL, [])
      }
    }
    record(out, REC.ENDSTR, [])
  }
  record(out, REC.ENDLIB, [])
  return Uint8Array.from(out)
}

/** A closed rectangle ring (BOUNDARY point list), corners in database units. */
export function rectRing(x0: number, y0: number, x1: number, y1: number): GdsPoint[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
    { x: x0, y: y0 },
  ]
}

/** A legal GDSII structure name — [A-Za-z0-9_?$] only, ≤ 32 chars (the spec's cell-name character set). */
export function gdsName(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_?$]/g, '_').slice(0, 32)
  return cleaned.length > 0 ? cleaned : 'CELL'
}

/**
 * Build a GDS library from the placed floorplan: each placed cell becomes a BOUNDARY rectangle on the
 * PDK's cell-boundary (prBoundary) layer, plus the die outline. λ → database nm via the process
 * (PROCESS.lambdaUm µm/λ, on a 1 nm grid). Y is FLIPPED to GDSII's y-up convention (the floorplan is
 * y-down, top-left origin). The cells are placeholders — real per-layer polygons come at the cell-layout
 * step; this is the first mask-ready, tool-openable artifact.
 */
export function floorplanToGds(
  floorplan: Floorplan,
  options: { topName?: string; boundaryLayer?: GdsPair } = {},
): GdsLibrary {
  const layer = options.boundaryLayer ?? PR_BOUNDARY
  const nmPerLambda = PROCESS.lambdaUm * 1000 // λ → µm → nm (1 nm database grid)
  const toNm = (lambda: number) => Math.round(lambda * nmPerLambda)
  const dieH = floorplan.dieHeightLambda
  const flipY = (yLambda: number) => toNm(dieH - yLambda) // y-down floorplan → y-up GDS

  const elements: GdsElement[] = []
  // The die outline first (bottom-left origin at 0,0).
  if (floorplan.dieWidthLambda > 0 && dieH > 0) {
    elements.push({
      kind: 'boundary',
      layer: layer.layer,
      datatype: layer.datatype,
      points: rectRing(0, 0, toNm(floorplan.dieWidthLambda), toNm(dieH)),
    })
  }
  for (const c of floorplan.cells) {
    elements.push({
      kind: 'boundary',
      layer: layer.layer,
      datatype: layer.datatype,
      points: rectRing(toNm(c.x), flipY(c.y + c.h), toNm(c.x + c.w), flipY(c.y)),
    })
  }
  return {
    name: gdsName(options.topName ?? 'chipblocks_top'),
    userUnitMeters: 1e-6, // 1 µm user unit
    dbUnitMeters: 1e-9, // 1 nm database grid
    structures: [{ name: gdsName(options.topName ?? 'chipblocks_top'), elements }],
  }
}
