import type { FootprintProvenance, Pad } from './footprint.ts'
import {
  type Board,
  type BoardOutline,
  footprintByPlacement,
  placePoint,
  type Ratsnest,
} from './pcb-board.ts'
import type { BoardRouting } from './pcb-route.ts'

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
 * The board is a TWO-copper-layer board (the standard minimum fab order) with all routing on the
 * top layer: the bottom copper carries only the through-hole pads' annular rings. That is honest
 * manufacturable truth, stated again in the validation report.
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

/** Top copper: every pad flashed + every routed trace drawn at its class width. */
export function gerberTopCopper(
  board: Board,
  ratsnest: Ratsnest,
  routing: BoardRouting,
  when: Date,
): string {
  const apertures = new Apertures()
  const flashes = planFlashes(board, apertures, ALL_PADS, 'ComponentPad')
  const traceCodes = new Map(
    routing.traces.map((t) => [t.widthMm, apertures.code(`C,${apNum(t.widthMm)}`, 'Conductor')]),
  )
  const body = flashBody(flashes, padNets(ratsnest))
  let currentCode = -1
  for (const t of routing.traces) {
    const code = traceCodes.get(t.widthMm)
    if (code === undefined || t.points.length < 2) continue
    if (code !== currentCode) {
      body.push(`D${code}*`)
      currentCode = code
    }
    body.push(`%TO.N,${safeField(t.net)}*%`)
    body.push(`${xy(t.points[0] as { x: number; y: number })}D02*`)
    for (const p of t.points.slice(1)) body.push(`${xy(p)}D01*`)
    body.push('%TD*%')
  }
  return [
    ...gerberHeader('Copper,L1,Top', 'Positive', when),
    ...apertures.block(),
    ...body,
    'M02*',
    '',
  ].join('\n')
}

/** Bottom copper: the through-hole pads' annular rings only — no routing lives down here (yet). */
export function gerberBottomCopper(board: Board, ratsnest: Ratsnest, when: Date): string {
  const apertures = new Apertures()
  const flashes = planFlashes(board, apertures, THROUGH_HOLE_ONLY, 'ComponentPad')
  return [
    ...gerberHeader('Copper,L2,Bot', 'Positive', when),
    ...apertures.block(),
    ...flashBody(flashes, padNets(ratsnest)),
    'M02*',
    '',
  ].join('\n')
}

/** Solder mask: NEGATIVE polarity — the image marks where mask is REMOVED, so it flashes the pads
 *  with the pads' own apertures (mask clearance 0, cited above; the fab applies its expansion). */
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

/** Top silkscreen: every footprint's silk outline, drawn per part. Reference lettering is not
 *  emitted yet (the designators live in the BOM + placement files) — stated in the report. */
export function gerberSilkscreen(board: Board, when: Date): string {
  const apertures = new Apertures()
  const body: string[] = []
  let currentCode = -1
  for (const placement of board.placements) {
    const fp = footprintByPlacement(placement)
    if (fp === undefined || fp.silkscreen.length === 0) continue
    body.push(`%TO.C,${safeField(placement.partId)}*%`)
    for (const s of fp.silkscreen) {
      const code = apertures.code(`C,${apNum(s.width)}`, null)
      if (code !== currentCode) {
        body.push(`D${code}*`)
        currentCode = code
      }
      body.push(`${xy(placePoint(placement, s.from))}D02*`)
      body.push(`${xy(placePoint(placement, s.to))}D01*`)
    }
    body.push('%TD*%')
  }
  return [
    ...gerberHeader('Legend,Top', 'Positive', when),
    ...apertures.block(),
    ...body,
    'M02*',
    '',
  ].join('\n')
}

/** The board profile (Edge.Cuts): the outline rectangle as four draws — the fab cuts the centreline. */
export function gerberEdgeCuts(outline: BoardOutline, when: Date): string {
  const apertures = new Apertures()
  const code = apertures.code(`C,${apNum(GERBER_CONVENTIONS.edge_line_width.valueMm)}`, 'Profile')
  const x0 = outline.x
  const y0 = outline.y
  const x1 = outline.x + outline.w
  const y1 = outline.y + outline.h
  const corners: [{ x: number; y: number }, { x: number; y: number }][] = [
    [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
    ],
    [
      { x: x1, y: y0 },
      { x: x1, y: y1 },
    ],
    [
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
    [
      { x: x0, y: y1 },
      { x: x0, y: y0 },
    ],
  ]
  const body = [`D${code}*`]
  for (const [from, to] of corners) {
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

/** Excellon coordinates: decimal millimetres, trailing zeros trimmed ('X137.16Y-120.095'), the
 *  format the drill header declares and KiCad emits. The decimal POINT is always kept — a bare
 *  integer ('X5') is legal Excellon that older CAM readers parse by the FMAT digit rules instead
 *  (off by 1000×); with the point present there is exactly one reading. */
const drillNum = (mm: number): string => {
  const s = String(Math.round(mm * 1000) / 1000)
  return s.includes('.') ? s : `${s}.0`
}

/**
 * The drill file — Excellon per Ucamco's XNC format, shaped exactly like KiCad 10's output: M48
 * header with #@! file attributes, FMAT,2 + METRIC, one T tool per hole diameter (ascending), then
 * each tool's holes (sorted for determinism), M30. All our holes are plated component holes
 * (through-hole pads), hence FileFunction Plated,1,2,PTH.
 */
export function excellonDrill(board: Board, when: Date): string {
  const holes = new Map<number, { x: number; y: number }[]>()
  for (const placement of board.placements) {
    const fp = footprintByPlacement(placement)
    if (fp === undefined) continue
    for (const pad of fp.pads) {
      if (pad.type !== 'through_hole' || pad.holeDiameter === undefined) continue
      const list = holes.get(pad.holeDiameter) ?? []
      list.push(placePoint(placement, pad.center))
      holes.set(pad.holeDiameter, list)
    }
  }
  const diameters = [...holes.keys()].sort((a, b) => a - b)
  const lines = [
    'M48',
    `; DRILL file ChipBlocks BoardExport date ${isoWithOffset(when)}`,
    '; FORMAT={-:-/ absolute / metric / decimal}',
    `; #@! TF.CreationDate,${isoWithOffset(when)}`,
    '; #@! TF.GenerationSoftware,ChipBlocks,BoardExport,1',
    '; #@! TF.FileFunction,Plated,1,2,PTH',
    'FMAT,2',
    'METRIC',
  ]
  diameters.forEach((d, i) => {
    lines.push('; #@! TA.AperFunction,Plated,PTH,ComponentDrill')
    lines.push(`T${i + 1}C${d.toFixed(3)}`)
  })
  lines.push('%', 'G90', 'G05')
  diameters.forEach((d, i) => {
    lines.push(`T${i + 1}`)
    const sorted = [...(holes.get(d) ?? [])].sort((p, q) => p.x - q.x || p.y - q.y)
    for (const h of sorted) lines.push(`X${drillNum(h.x)}Y${drillNum(-h.y)}`)
  })
  lines.push('M30', '')
  return lines.join('\n')
}
