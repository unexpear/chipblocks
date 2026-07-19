import type { FootprintProvenance, Pad } from './footprint.ts'
import {
  type Board,
  type BoardPoint,
  footprintByPlacement,
  placePoint,
  type Ratsnest,
  silkReferenceAnchor,
} from './pcb-board.ts'
import type { BoardRouting, CopperLayer } from './pcb-route.ts'
import { SILK_TEXT, strokeText } from './stroke-font.ts'

/**
 * The Gerber + drill writers — the board becomes the exact files a fab manufactures
 * (TOOLCHAIN-ROADMAP.md Track 1, the last format step before the manufacturing ZIP). Gerber X2 per
 * the Ucamco specification ("The Gerber Layer Format Specification", Ucamco — the format's owner);
 * drills as Excellon per Ucamco's XNC format. Every convention here was ground-truthed 2026-07-04
 * against files plotted by the installed KiCad 10.0.4 (`kicad-cli pcb export gerbers` / `export
 * drill` on the shipped demo boards): the 4.6 mm coordinate format, the aperture blocks and X2
 * attributes, KiCad's own RoundRect aperture macro, the negated Y axis, and the decimal-mm drill
 * coordinates all match what KiCad emits, so a ChipBlocks board and a KiCad board read the same way.
 *
 * Coordinates: the board model is millimetres with Y pointing DOWN (screen convention); Gerber's Y
 * points UP. Every emitted Y is therefore negated — exactly what KiCad does when plotting (its
 * internal frame is y-down too; the demo files show every board Y appearing negated).
 *
 * The board is a TWO-copper-layer board (the standard minimum fab order), both layers routed:
 * connections take the top layer first and drop to the bottom through plated vias when the top is
 * blocked, so the bottom copper carries the through-hole pads' annular rings, the bottom-layer
 * traces, and the via barrels. Vias are tented (mask-covered) — no mask openings for them.
 */

/** Values a fab manufactures directly, cited (the anti-placeholder rule applies to file formats). */
export const GERBER_CONVENTIONS: Record<
  'edge_line_width' | 'mask_clearance' | 'roundrect_radius',
  { valueMm: number; provenance: FootprintProvenance }
> = {
  edge_line_width: {
    valueMm: 0.05,
    provenance: {
      source_type: 'reference',
      title: 'KiCad 10 board default — Edge.Cuts line width 0.05 mm',
      citation:
        'KiCad 10 project templates (board.design_settings.defaults.board_outline_line_width = 0.05) on the installed KiCad 10.0; the profile line width is cosmetic — the fab cuts on the centreline',
      confidence: 'high',
      url: 'https://gitlab.com/kicad/code/kicad',
      date_accessed: '2026-07-04',
    },
  },
  mask_clearance: {
    valueMm: 0,
    provenance: {
      source_type: 'reference',
      title: 'KiCad 10 default solder-mask clearance 0 mm — mask opening = pad, fab expands',
      citation:
        'Ground-truthed against kicad-cli 10.0.4 mask Gerbers (demo boards): every mask aperture is byte-identical to its pad aperture. KiCad defers mask expansion to the fab, the modern convention',
      confidence: 'high',
      url: 'https://gitlab.com/kicad/code/kicad',
      date_accessed: '2026-07-04',
    },
  },
  roundrect_radius: {
    valueMm: 0.25,
    provenance: {
      source_type: 'reference',
      title: 'KiCad library convention — roundrect corner radius 25% of pad, capped at 0.25 mm',
      citation:
        'KiCad Library Convention F4.3 (rounded rectangle pads: radius ratio 0.25, maximum 0.25 mm), confirmed in the installed footprints: R_0603 stores rratio 0.25; DIP-8 pin 1 (1.6 mm pad) stores 0.15625 = 0.25 mm / 1.6 mm exactly',
      confidence: 'high',
      url: 'https://klc.kicad.org',
      date_accessed: '2026-07-04',
    },
  },
}

/** KiCad's RoundRect aperture macro, verbatim from kicad-cli 10.0.4 output (a corner-radius $1 and
 *  the four inset-rectangle corners $2..$9: a 4-corner polygon body, four corner circles, four edge
 *  rectangles). Emitted once, before the aperture list entries that instantiate it. */
const ROUNDRECT_MACRO = [
  '%AMRoundRect*',
  '0 Rectangle with rounded corners*',
  '0 $1 Rounding radius*',
  '0 $2 $3 $4 $5 $6 $7 $8 $9 X,Y pos of 4 corners*',
  '0 Add a 4 corners polygon primitive as box body*',
  '4,1,4,$2,$3,$4,$5,$6,$7,$8,$9,$2,$3,0*',
  '0 Add four circle primitives for the rounded corners*',
  '1,1,$1+$1,$2,$3*',
  '1,1,$1+$1,$4,$5*',
  '1,1,$1+$1,$6,$7*',
  '1,1,$1+$1,$8,$9*',
  '0 Add four rect primitives between the rounded corners*',
  '20,1,$1+$1,$2,$3,$4,$5,0*',
  '20,1,$1+$1,$4,$5,$6,$7,0*',
  '20,1,$1+$1,$6,$7,$8,$9,0*',
  '20,1,$1+$1,$8,$9,$2,$3,0*%',
]

/** Aperture-definition numbers: fixed 6 decimals, KiCad style ('0.250000'). */
const apNum = (v: number): string => v.toFixed(6)

/** A coordinate in the 4.6 format: mm × 10⁶ as an integer (leading zeros omitted per %FSLAX46Y46%). */
const coord = (mm: number): number => Math.round(mm * 1e6)

/** Board-frame point → Gerber X..Y.. text (Y negated: board y-down → Gerber y-up). */
const xy = (p: { x: number; y: number }): string => `X${coord(p.x)}Y${coord(-p.y)}`

/** Gerber X2 attribute values are comma-separated fields ended by '*'; keep ids from breaking out. */
const safeField = (s: string): string => s.replace(/[,*%\r\n]/g, '_')

/** ISO-8601 with the local UTC offset, the form KiCad stamps ('2026-07-04T10:55:24-04:00'). */
export function isoWithOffset(when: Date): string {
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0')
  const offsetMin = -when.getTimezoneOffset()
  const sign = offsetMin < 0 ? '-' : '+'
  return (
    `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}` +
    `T${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}` +
    `${sign}${pad(Math.trunc(offsetMin / 60))}:${pad(offsetMin % 60)}`
  )
}

/** A pad's aperture body (the text after the D-code in %ADDnn...%), rotation already resolved:
 *  quarter-turn placements only ever swap a pad's width and height, so every aperture stays
 *  axis-aligned and no rotated macros are needed. */
function padApertureBody(pad: Pad, rotation: 0 | 90 | 180 | 270): string {
  const swap = rotation === 90 || rotation === 270
  const w = swap ? pad.size.h : pad.size.w
  const h = swap ? pad.size.w : pad.size.h
  switch (pad.shape) {
    case 'circle':
      return `C,${apNum(Math.min(w, h))}`
    case 'rect':
      return `R,${apNum(w)}X${apNum(h)}`
    case 'oval':
      return `O,${apNum(w)}X${apNum(h)}`
    case 'roundrect': {
      const r = Math.min(0.25 * Math.min(w, h), GERBER_CONVENTIONS.roundrect_radius.valueMm)
      const a = w / 2 - r
      const b = h / 2 - r
      const corners = [
        [-a, -b],
        [a, -b],
        [a, b],
        [-a, b],
      ]
        .map(([cx, cy]) => `X${apNum(cx as number)}X${apNum(cy as number)}`)
        .join('')
      return `RoundRect,${apNum(r)}${corners}X0`
    }
  }
}

/** Ordered aperture registry: each distinct (function, body) pair gets the next D-code from 10
 *  (the Gerber minimum). Deduped by BOTH — a pad and a trace that happen to share a circle body
 *  (a 1.6 mm hole pad beside a 1.6 mm trace) must not share a D-code, or one of them would carry
 *  the other's AperFunction attribute in the CAM tool. */
class Apertures {
  private entries = new Map<string, { code: number; body: string; fn: string | null }>()

  code(body: string, aperFunction: string | null): number {
    const key = `${aperFunction ?? ''}${body}`
    const existing = this.entries.get(key)
    if (existing !== undefined) return existing.code
    const next = 10 + this.entries.size
    this.entries.set(key, { code: next, body, fn: aperFunction })
    return next
  }

  /** The aperture list block, KiCad-shaped: macro first if used, then each %ADD% wrapped in its
   *  %TA.AperFunction%/%TD% pair (mask layers pass null and get bare definitions, per the samples). */
  block(): string[] {
    const lines: string[] = ['G04 APERTURE LIST*']
    if ([...this.entries.values()].some((e) => e.body.startsWith('RoundRect,'))) {
      lines.push(...ROUNDRECT_MACRO)
    }
    for (const e of this.entries.values()) {
      if (e.fn != null) lines.push(`%TA.AperFunction,${e.fn}*%`)
      lines.push(`%ADD${e.code}${e.body}*%`)
      if (e.fn != null) lines.push('%TD*%')
    }
    lines.push('G04 APERTURE END LIST*')
    return lines
  }
}

function gerberHeader(
  fileFunction: string,
  polarity: 'Positive' | 'Negative' | null,
  when: Date,
): string[] {
  const lines = [
    '%TF.GenerationSoftware,ChipBlocks,BoardExport,1*%',
    `%TF.CreationDate,${isoWithOffset(when)}*%`,
    // Part,Single — this fabrication data is a single PCB (not a panel/array or a coupon), the X2
    // file attribute a CAM tool reads to know what it is loading (Ucamco Gerber X2 spec §5.6.3).
    '%TF.Part,Single*%',
    `%TF.FileFunction,${fileFunction}*%`,
  ]
  if (polarity !== null) lines.push(`%TF.FilePolarity,${polarity}*%`)
  lines.push(
    '%FSLAX46Y46*%',
    'G04 Gerber Fmt 4.6, Leading zero omitted, Abs format (unit mm)*',
    'G04 Created by ChipBlocks — deterministic engine output, ground-truthed against KiCad 10.0.4*',
    '%MOMM*%',
    '%LPD*%',
    'G01*',
  )
  return lines
}

/** partId/padId → net name, from the ratsnest's pad inventory (the solver's own connectivity). */
export function padNets(ratsnest: Ratsnest): Map<string, string> {
  return new Map(ratsnest.padBoxes.map((b) => [b.pad, b.net]))
}

type PadFilter = (pad: Pad) => boolean
const ALL_PADS: PadFilter = () => true
const THROUGH_HOLE_ONLY: PadFilter = (pad) => pad.type === 'through_hole'

/** Every placement's pads through one filter, as (placement, pad, aperture-code) flash plans —
 *  shared by the copper and mask layers so their flashes can never disagree. */
function planFlashes(
  board: Board,
  apertures: Apertures,
  filter: PadFilter,
  aperFunction: string | null,
): { partId: string; padId: string; at: { x: number; y: number }; code: number }[] {
  const flashes: { partId: string; padId: string; at: { x: number; y: number }; code: number }[] =
    []
  for (const placement of board.placements) {
    const fp = footprintByPlacement(placement)
    if (fp === undefined) continue
    for (const pad of fp.pads) {
      if (!filter(pad)) continue
      flashes.push({
        partId: placement.partId,
        padId: pad.id,
        at: placePoint(placement, pad.center),
        code: apertures.code(padApertureBody(pad, placement.rotation), aperFunction),
      })
    }
  }
  return flashes
}

/** Emit one layer's flashes grouped per part, with the X2 object attributes the samples carry:
 *  copper layers tag every flash %TO.P,ref,pad% + %TO.N,net%; mask layers tag the part %TO.C,ref%. */
function flashBody(
  flashes: readonly { partId: string; padId: string; at: { x: number; y: number }; code: number }[],
  nets: Map<string, string> | null,
): string[] {
  const lines: string[] = []
  let currentCode = -1
  let currentPart: string | null = null
  for (const f of flashes) {
    if (f.partId !== currentPart) {
      if (currentPart !== null) lines.push('%TD*%')
      currentPart = f.partId
      if (nets === null) {
        // mask layers: one component attribute per part (the KiCad mask-file shape)
        if (f.code !== currentCode) {
          lines.push(`D${f.code}*`)
          currentCode = f.code
        }
        lines.push(`%TO.C,${safeField(f.partId)}*%`)
      }
    }
    if (nets !== null) {
      if (f.code !== currentCode) {
        lines.push(`D${f.code}*`)
        currentCode = f.code
      }
      lines.push(`%TO.P,${safeField(f.partId)},${safeField(f.padId)}*%`)
      const net = nets.get(`${f.partId}/${f.padId}`)
      if (net !== undefined) lines.push(`%TO.N,${safeField(net)}*%`)
    } else if (f.code !== currentCode) {
      lines.push(`D${f.code}*`)
      currentCode = f.code
    }
    lines.push(`${xy(f.at)}D03*`)
  }
  if (currentPart !== null) lines.push('%TD*%')
  return lines
}

/** Draw one layer's traces: a Conductor aperture per width, each polyline D02 then D01s, its net
 *  attribute attached. Shared by the two copper layers so they can never draw differently. */
function traceBody(
  traces: readonly BoardRouting['traces'][number][],
  layer: CopperLayer,
  apertures: Apertures,
  body: string[],
): void {
  let currentCode = -1
  for (const t of traces) {
    if (t.layer !== layer || t.points.length < 2) continue
    const code = apertures.code(`C,${apNum(t.widthMm)}`, 'Conductor')
    if (code !== currentCode) {
      body.push(`D${code}*`)
      currentCode = code
    }
    body.push(`%TO.N,${safeField(t.net)}*%`)
    body.push(`${xy(t.points[0] as { x: number; y: number })}D02*`)
    for (const p of t.points.slice(1)) body.push(`${xy(p)}D01*`)
    body.push('%TD*%')
  }
}

/** Flash the via barrels — the same copper appears on BOTH layers, tagged ViaPad + its net. */
function viaBody(routing: BoardRouting, apertures: Apertures, body: string[]): void {
  let currentCode = -1
  for (const v of routing.vias) {
    const code = apertures.code(`C,${apNum(v.diameterMm)}`, 'ViaPad')
    if (code !== currentCode) {
      body.push(`D${code}*`)
      currentCode = code
    }
    body.push(`%TO.N,${safeField(v.net)}*%`)
    body.push(`${xy(v.at)}D03*`)
    body.push('%TD*%')
  }
}

/** Top copper: every pad flashed, the top-layer traces, and the via barrels. */
export function gerberTopCopper(
  board: Board,
  ratsnest: Ratsnest,
  routing: BoardRouting,
  when: Date,
): string {
  const apertures = new Apertures()
  const flashes = planFlashes(board, apertures, ALL_PADS, 'ComponentPad')
  const body = flashBody(flashes, padNets(ratsnest))
  traceBody(routing.traces, 'top', apertures, body)
  viaBody(routing, apertures, body)
  return [
    ...gerberHeader('Copper,L1,Top', 'Positive', when),
    ...apertures.block(),
    ...body,
    'M02*',
    '',
  ].join('\n')
}

/** Bottom copper: the through-hole pads' annular rings, the bottom-layer traces, and the via
 *  barrels (a via's copper exists on every layer). `layerNumber` is the bottom's physical layer
 *  number — L2 on a 2-layer board, L4 on a 4-layer, L6 on a 6-layer. */
export function gerberBottomCopper(
  board: Board,
  ratsnest: Ratsnest,
  routing: BoardRouting,
  when: Date,
  layerNumber = 2,
): string {
  const apertures = new Apertures()
  const flashes = planFlashes(board, apertures, THROUGH_HOLE_ONLY, 'ComponentPad')
  const body = flashBody(flashes, padNets(ratsnest))
  traceBody(routing.traces, 'bottom', apertures, body)
  viaBody(routing, apertures, body)
  return [
    ...gerberHeader(`Copper,L${layerNumber},Bot`, 'Positive', when),
    ...apertures.block(),
    ...body,
    'M02*',
    '',
  ].join('\n')
}

/** An INNER copper layer (In1.Cu, In2.Cu…) of a multilevel board: the through-hole pads' annular
 *  rings (SMD pads only exist on the outer layers), this layer's traces, and the via barrels (a
 *  plated through-via's copper runs through every layer). `layerNumber` is its physical layer number
 *  (In1 = L2, In2 = L3…). */
export function gerberInnerCopper(
  board: Board,
  ratsnest: Ratsnest,
  routing: BoardRouting,
  layer: CopperLayer,
  layerNumber: number,
  when: Date,
): string {
  const apertures = new Apertures()
  const flashes = planFlashes(board, apertures, THROUGH_HOLE_ONLY, 'ComponentPad')
  const body = flashBody(flashes, padNets(ratsnest))
  traceBody(routing.traces, layer, apertures, body)
  viaBody(routing, apertures, body)
  return [
    ...gerberHeader(`Copper,L${layerNumber},Inr`, 'Positive', when),
    ...apertures.block(),
    ...body,
    'M02*',
    '',
  ].join('\n')
}

/** Solder mask: NEGATIVE polarity — the image marks where mask is REMOVED, so it flashes the pads
 *  with the pads' own apertures (mask clearance 0, cited above; the fab applies its expansion).
 *  Vias get NO mask opening: they are TENTED — covered by mask — KiCad's default via treatment,
 *  which protects the barrel from solder bridging. */
export function gerberMask(board: Board, side: 'Top' | 'Bot', when: Date): string {
  const apertures = new Apertures()
  const filter = side === 'Top' ? ALL_PADS : THROUGH_HOLE_ONLY
  const flashes = planFlashes(board, apertures, filter, null)
  return [
    ...gerberHeader(`Soldermask,${side}`, 'Negative', when),
    ...apertures.block(),
    ...flashBody(flashes, null),
    'M02*',
    '',
  ].join('\n')
}

/** Solder paste — the stencil the assembler squeegees paste through, for REFLOW-soldered pads
 *  only: SMD pads get an aperture, through-hole pads get none (their legs are wave- or hand-
 *  soldered; paste over an open hole just falls through). Aperture = the pad itself — KiCad's
 *  zero paste clearance, ground-truthed against kicad-cli 10.0.4 output (the demo boards' paste
 *  apertures are byte-identical to their copper pad apertures); the stencil house applies its own
 *  reduction. Positive polarity: the image IS the paste. */
export function gerberPaste(board: Board, side: 'Top' | 'Bot', when: Date): string {
  const apertures = new Apertures()
  // No footprint mounts parts on the bottom yet, so the bottom stencil is honestly empty.
  const filter: PadFilter = side === 'Top' ? (pad) => pad.type === 'smd' : () => false
  const flashes = planFlashes(board, apertures, filter, null)
  return [
    ...gerberHeader(`Paste,${side}`, 'Positive', when),
    ...apertures.block(),
    ...flashBody(flashes, null),
    'M02*',
    '',
  ].join('\n')
}

/** Silkscreen for a side: every footprint's silk outline plus its reference DESIGNATOR (R1, C2 — the
 *  short board name, not the schematic id), stroked in the board lettering font at KiCad's cited
 *  text size (SILK_TEXT). The text centres above the part's courtyard at any rotation
 *  (silkReferenceAnchor) — clear of the pads by the courtyard invariant, upright so it always
 *  reads left-to-right. A character the font cannot print keeps its space and is named in a G04
 *  comment — never dropped in silence. No footprint mounts a part on the bottom yet, so the 'Bot'
 *  silk is honestly EMPTY — but its file still ships, so the layer set is the complete standard
 *  F.SilkS + B.SilkS pair (the empty B.Paste already ships the same way). */
export function gerberSilkscreen(board: Board, side: 'Top' | 'Bot', when: Date): string {
  const apertures = new Apertures()
  const body: string[] = []
  let currentCode = -1
  const draw = (code: number, from: { x: number; y: number }, to: { x: number; y: number }) => {
    if (code !== currentCode) {
      body.push(`D${code}*`)
      currentCode = code
    }
    body.push(`${xy(from)}D02*`)
    body.push(`${xy(to)}D01*`)
  }
  const placements = side === 'Top' ? board.placements : []
  for (const placement of placements) {
    const fp = footprintByPlacement(placement)
    if (fp === undefined) continue
    body.push(`%TO.C,${safeField(placement.partId)}*%`)
    for (const s of fp.silkscreen) {
      draw(
        apertures.code(`C,${apNum(s.width)}`, null),
        placePoint(placement, s.from),
        placePoint(placement, s.to),
      )
    }
    const designator = placement.designator ?? placement.partId
    const text = strokeText(designator, silkReferenceAnchor(placement, fp), SILK_TEXT.heightMm)
    if (text.missing.length > 0) {
      body.push(
        `G04 '${safeField(designator)}': no glyph for ${safeField(text.missing.join(' '))} — space kept*`,
      )
    }
    const textCode = apertures.code(`C,${apNum(SILK_TEXT.thicknessMm)}`, null)
    for (const seg of text.segments) draw(textCode, seg.from, seg.to)
    body.push('%TD*%')
  }
  return [
    ...gerberHeader(`Legend,${side}`, 'Positive', when),
    ...apertures.block(),
    ...body,
    'M02*',
    '',
  ].join('\n')
}

/** The board profile (Edge.Cuts): the outline rectangle as four draws — the fab cuts the centreline. */
export function gerberEdgeCuts(ring: readonly BoardPoint[], when: Date): string {
  const apertures = new Apertures()
  const code = apertures.code(`C,${apNum(GERBER_CONVENTIONS.edge_line_width.valueMm)}`, 'Profile')
  // Walk the closed ring, emitting each edge as a pen-up move to its start then a stroke to its end. For a
  // rectangle's four corners this is byte-identical to the old hard-coded rectangle; a hand-drawn polygon
  // emits its real edges. The ring closes with the last→first segment.
  const body = [`D${code}*`]
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const from = ring[i] as BoardPoint
    const to = ring[(i + 1) % n] as BoardPoint
    body.push(`${xy(from)}D02*`)
    body.push(`${xy(to)}D01*`)
  }
  return [
    ...gerberHeader('Profile,NP', null, when),
    ...apertures.block(),
    ...body,
    'M02*',
    '',
  ].join('\n')
}

/** Excellon coordinates: decimal millimetres, trailing zeros trimmed ('X137.16Y-120.095'). Rounded to
 *  the SAME 1 nm grid the copper Gerber uses (its 4.6 format = mm × 10⁶), so a hole centre and the pad
 *  copper around it land on one grid and register exactly — not the coarser 1 µm the drill used before.
 *  The decimal POINT is always kept — a bare integer ('X5') is legal Excellon that older CAM readers
 *  parse by the FMAT digit rules instead (off by 1000×); with the point present there is one reading. */
const drillNum = (mm: number): string => {
  const s = String(Math.round(mm * 1e6) / 1e6)
  return s.includes('.') ? s : `${s}.0`
}

/**
 * The drill file — Excellon per Ucamco's XNC format, shaped exactly like KiCad 10's output: M48
 * header with #@! file attributes, FMAT,2 + METRIC, one T tool per hole KIND and diameter
 * (component holes and via holes carry different attributes, so a shared diameter still gets its
 * own tool — KiCad's convention), ascending, then each tool's holes (sorted for determinism),
 * M30. Every hole is plated (component legs and via barrels) and goes the whole way through, so the
 * FileFunction is Plated,1,N,PTH — layer 1 (top copper) to layer N (the bottom copper), where N is the
 * board's copper-layer count. Hardcoding 1,2 was correct only on a 2-layer board; on a 4-/6-layer board
 * the drill must agree with the .gbrjob / inner-Gerber layer count (integration-audit-caught).
 */
/** Whether the board has any NON-plated (NPTH) component holes — a mounting/tooling hole (pad.plated ===
 *  false). When true, the fab needs a SEPARATE non-plated drill file alongside the plated one. */
export function boardHasNonPlatedHoles(board: Board): boolean {
  for (const placement of board.placements) {
    const fp = footprintByPlacement(placement)
    if (fp === undefined) continue
    for (const pad of fp.pads) {
      if (pad.type === 'through_hole' && pad.holeDiameter !== undefined && pad.plated === false) {
        return true
      }
    }
  }
  return false
}

/**
 * A drill file — Excellon per Ucamco's XNC format, shaped exactly like KiCad 10's output. `nonPlated`
 * selects which drills go in this file: the PLATED file (default) carries every plated hole (component legs
 * + via barrels, FileFunction Plated,1,N,PTH); the NON-plated file (`nonPlated: true`) carries only the
 * non-plated component holes (mounting/tooling holes, FileFunction NonPlated,1,N,NPTH). A fab needs BOTH
 * when a board mixes plated and non-plated holes — plating a mounting hole (or leaving a real NPTH hole in
 * the plated file) is wrong manufacturing data. Vias are always plated, so they never appear in the NPTH file.
 */
export function excellonDrill(
  board: Board,
  routing: BoardRouting,
  when: Date,
  copperLayers = 2,
  nonPlated = false,
): string {
  const holes = new Map<string, { drill: number; kind: string; at: { x: number; y: number }[] }>()
  const add = (
    drill: number,
    kind: 'ComponentDrill' | 'ViaDrill',
    at: { x: number; y: number },
  ) => {
    const key = `${kind}:${drill}`
    const entry = holes.get(key) ?? { drill, kind, at: [] }
    entry.at.push(at)
    holes.set(key, entry)
  }
  for (const placement of board.placements) {
    const fp = footprintByPlacement(placement)
    if (fp === undefined) continue
    for (const pad of fp.pads) {
      if (pad.type !== 'through_hole' || pad.holeDiameter === undefined) continue
      // Plated file: every plated hole (plated !== false). Non-plated file: only the NPTH holes.
      if ((pad.plated === false) !== nonPlated) continue
      add(pad.holeDiameter, 'ComponentDrill', placePoint(placement, pad.center))
    }
  }
  // Vias are plated barrels — only in the plated file.
  if (!nonPlated) for (const v of routing.vias) add(v.drillMm, 'ViaDrill', v.at)
  const plating = nonPlated ? 'NonPlated' : 'Plated'
  const through = nonPlated ? 'NPTH' : 'PTH'
  const tools = [...holes.values()].sort((a, b) => a.drill - b.drill || (a.kind < b.kind ? -1 : 1))
  const lines = [
    'M48',
    `; DRILL file ChipBlocks BoardExport date ${isoWithOffset(when)}`,
    '; FORMAT={-:-/ absolute / metric / decimal}',
    `; #@! TF.CreationDate,${isoWithOffset(when)}`,
    '; #@! TF.GenerationSoftware,ChipBlocks,BoardExport,1',
    `; #@! TF.FileFunction,${plating},1,${copperLayers},${through}`,
    'FMAT,2',
    'METRIC',
  ]
  tools.forEach((tool, i) => {
    lines.push(`; #@! TA.AperFunction,${plating},${through},${tool.kind}`)
    lines.push(`T${i + 1}C${tool.drill.toFixed(3)}`)
  })
  lines.push('%', 'G90', 'G05')
  tools.forEach((tool, i) => {
    lines.push(`T${i + 1}`)
    const sorted = [...tool.at].sort((p, q) => p.x - q.x || p.y - q.y)
    for (const h of sorted) lines.push(`X${drillNum(h.x)}Y${drillNum(-h.y)}`)
  })
  lines.push('M30', '')
  return lines.join('\n')
}
