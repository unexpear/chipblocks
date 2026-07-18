import { PROCESS } from './cell-layout.ts'
import { cellOrient, type Floorplan } from './cell-place.ts'
import { cellBlock, cellPolygons } from './cell-polygons.ts'
import { type GdsPair, gdsOf, PR_BOUNDARY } from './pdk.ts'

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
  STRANS: [0x1a, 0x01],
  LAYER: [0x0d, 0x02],
  DATATYPE: [0x0e, 0x02],
  XY: [0x10, 0x03],
  ENDEL: [0x11, 0x00],
} as const

/** STRANS bit 0 (the most-significant bit, GDSII numbers bits from the left) = reflect about the x-axis
 *  before rotation — the transform that turns an N placement into FS (top/bottom mirrored). */
const STRANS_REFLECT = 0x8000

/** A point in DATABASE units (integer nm). */
export type GdsPoint = { x: number; y: number }
/** A filled polygon on one layer. `points` is the closed ring (first === last). */
export type GdsBoundary = { kind: 'boundary'; layer: number; datatype: number; points: GdsPoint[] }
/** A placed reference to another structure (hierarchy), at (x, y) in database units. `reflect` mirrors the
 *  referenced cell about the x-axis before placing it (an STRANS record) — the FS row orientation. */
export type GdsSref = { kind: 'sref'; structure: string; x: number; y: number; reflect?: boolean }
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
        // STRANS goes between SNAME and XY (GDSII element order). Emit it only when reflected, so an
        // un-flipped SREF stays byte-identical to before this feature.
        if (el.reflect) record(out, REC.STRANS, i2(STRANS_REFLECT))
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

const CELL_NM = (lambda: number): number => Math.round(lambda * PROCESS.lambdaUm * 1000)

/**
 * A standard-cell gate as its own GDS STRUCTURE — the real per-layer polygons (cell-polygons.ts) on the
 * SKY130 layer numbers (pdk.ts). Cell-local, bottom-left origin, y-up. Returns undefined for a name that is
 * not one of the primitive gates (the caller then falls back to a prBoundary outline). Each cell type is
 * emitted ONCE and SREF-placed wherever it appears — the hierarchy a real layout uses.
 */
export function cellToStructure(name: string): GdsStructure | undefined {
  const block = cellBlock(name)
  if (!block) return undefined
  const layout = cellPolygons(block)
  const elements: GdsElement[] = layout.rects.map((r) => {
    // every CellLayerName is a real SKY130 layer name; fall back visibly to prBoundary if one ever isn't.
    const pair = gdsOf(r.layer) ?? PR_BOUNDARY
    return {
      kind: 'boundary',
      layer: pair.layer,
      datatype: pair.datatype,
      points: rectRing(CELL_NM(r.x), CELL_NM(r.y), CELL_NM(r.x + r.w), CELL_NM(r.y + r.h)),
    }
  })
  return { name: gdsName(`cell_${name}`), elements }
}

/**
 * Build a GDS library from the placed floorplan. Each unique gate type becomes one cell STRUCTURE of real
 * per-layer polygons (cell-polygons.ts), SREF-placed at every location it appears; the top structure holds
 * the die outline + a prBoundary outline per cell (kept for visualisation) + the SREFs. A cell whose name
 * is not a primitive gate keeps only its prBoundary outline — an honest fallback, never fabricated geometry.
 * λ → database nm via the process (PROCESS.lambdaUm µm/λ, 1 nm grid); Y is FLIPPED to GDSII's y-up (the
 * floorplan is y-down, top-left). Set `cellPolygons: false` for the outline-only legacy shape.
 */
export function floorplanToGds(
  floorplan: Floorplan,
  options: { topName?: string; boundaryLayer?: GdsPair; cellPolygons?: boolean } = {},
): GdsLibrary {
  const layer = options.boundaryLayer ?? PR_BOUNDARY
  const withPolygons = options.cellPolygons !== false
  const toNm = CELL_NM
  const dieH = floorplan.dieHeightLambda
  const flipY = (yLambda: number) => toNm(dieH - yLambda) // y-down floorplan → y-up GDS

  const topElements: GdsElement[] = []
  // The die outline first (bottom-left origin at 0,0).
  if (floorplan.dieWidthLambda > 0 && dieH > 0) {
    topElements.push({
      kind: 'boundary',
      layer: layer.layer,
      datatype: layer.datatype,
      points: rectRing(0, 0, toNm(floorplan.dieWidthLambda), toNm(dieH)),
    })
  }

  const cellStructures: GdsStructure[] = []
  const structureFor = new Map<string, string>() // cell name → structure name (emit each type once)
  for (const c of floorplan.cells) {
    // a prBoundary outline for every cell (mapped or not), so the floorplan is always visible.
    topElements.push({
      kind: 'boundary',
      layer: layer.layer,
      datatype: layer.datatype,
      points: rectRing(toNm(c.x), flipY(c.y + c.h), toNm(c.x + c.w), flipY(c.y)),
    })
    if (!withPolygons || !cellBlock(c.name)) continue
    let structName = structureFor.get(c.name)
    if (structName === undefined) {
      const struct = cellToStructure(c.name)
      if (!struct) continue
      structName = struct.name
      structureFor.set(c.name, structName)
      cellStructures.push(struct)
    }
    // SREF: an N cell lands its local (0,0) at the row's GDS bottom-left (flipY(c.y + c.h)). An FS cell is
    // reflected about the x-axis, which maps its local y∈[0,h] to [−h,0]; referencing the row TOP
    // (flipY(c.y)) shifts that back up so the flipped cell still fills the same row band, its VDD/VSS rails
    // now swapped top↔bottom to abut the neighbours on the same net.
    const flip = cellOrient(c) === 'FS'
    topElements.push({
      kind: 'sref',
      structure: structName,
      x: toNm(c.x),
      y: flip ? flipY(c.y) : flipY(c.y + c.h),
      ...(flip ? { reflect: true } : {}),
    })
  }

  const topName = gdsName(options.topName ?? 'chipblocks_top')
  return {
    name: topName,
    userUnitMeters: 1e-6, // 1 µm user unit
    dbUnitMeters: 1e-9, // 1 nm database grid
    structures: [...cellStructures, { name: topName, elements: topElements }],
  }
}
