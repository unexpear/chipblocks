import { buildZip, type ZipEntry } from '../zip-store.ts'
import { type Board, footprintByPlacement, placePoint, type Ratsnest } from './pcb-board.ts'
import type { DrcViolation } from './pcb-drc.ts'
import { DRC_RULES } from './pcb-drc.ts'
import {
  excellonDrill,
  GERBER_CONVENTIONS,
  gerberBottomCopper,
  gerberEdgeCuts,
  gerberMask,
  gerberSilkscreen,
  gerberTopCopper,
  isoWithOffset,
} from './pcb-gerber.ts'
import { type BoardRouting, DEFAULT_ROUTE_CLASS } from './pcb-route.ts'

/**
 * The manufacturing ZIP — deliverable #2 (CLAUDE.md core principle 1): the archive a user hands a
 * board fab. Assembled entirely by the deterministic engine — the Gerber/drill writers, the DRC
 * results, and the solver's own connectivity — never by AI at runtime; wrong Gerbers cost real
 * money. The ZIP only leaves the app when the board is COMPLETE (everything routed, DRC clean,
 * every wired pin on the board); the validation report inside restates exactly what was checked,
 * against which cited limits, so "why should I trust these files" always has an answer.
 *
 * Contents (flat, the shape fab upload forms expect): the six Gerber layers + the drill file
 * (KiCad-style names, Protel extensions), bom.csv + placement.csv (the assembly pair, JLCPCB
 * column conventions), the SPICE netlist, the validation report, and a README naming every file.
 */

export type BomRow = {
  /** The schematic part id — the board's reference designator. */
  reference: string
  definition: string
  /** The part's value as text ('470 Ω', '100 µF') — formatted by the caller, which owns units. */
  value: string
  footprintId: string
}

const csvField = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

// NUL as the BOM grouping separator — the one character that can never appear in a definition,
// value or footprint id, so grouped keys cannot collide. Built with fromCharCode, not a
// backslash-u escape: a raw control byte in source turns the file binary to content search.
const GROUP_SEPARATOR = String.fromCharCode(0)

/** BOM rows grouped the way an assembler reads them: one line per (part, value, footprint) group.
 *  The Part column carries the definition — a 10 kΩ NTC thermistor and a 10 kΩ resistor share a
 *  Comment and a footprint, and only the part type tells the assembler they are different stock. */
export function buildBomCsv(rows: readonly BomRow[]): string {
  const groups = new Map<
    string,
    { value: string; footprintId: string; definition: string; refs: string[] }
  >()
  for (const row of rows) {
    const key = [row.definition, row.value, row.footprintId].join(GROUP_SEPARATOR)
    const group = groups.get(key)
    if (group) group.refs.push(row.reference)
    else {
      groups.set(key, {
        value: row.value,
        footprintId: row.footprintId,
        definition: row.definition,
        refs: [row.reference],
      })
    }
  }
  const lines = ['Comment,Designator,Footprint,Quantity,Part']
  for (const g of groups.values()) {
    lines.push(
      `${csvField(g.value)},${csvField(g.refs.join(','))},${csvField(g.footprintId)},${g.refs.length},${csvField(g.definition)}`,
    )
  }
  return `${lines.join('\n')}\n`
}

const num = (mm: number): string => String(Math.round(mm * 1000) / 1000)

/**
 * The pick-and-place file (JLCPCB CPL columns): each part's BODY CENTRE in the Gerber frame
 * (millimetres, Y up — the same negation the Gerber writer applies, so assembly and copper share
 * one frame), and its rotation in degrees counter-clockwise. The body centre comes from the
 * footprint's fabrication outline — the actual part body — not the footprint origin, which for
 * through-hole parts is pin 1.
 */
export function buildPlacementCsv(board: Board): string {
  const lines = ['Designator,Mid X,Mid Y,Layer,Rotation']
  for (const placement of board.placements) {
    const fp = footprintByPlacement(placement)
    if (fp === undefined) continue
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (const s of fp.fabrication) {
      for (const p of [s.from, s.to]) {
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x)
        maxY = Math.max(maxY, p.y)
      }
    }
    const localCentre =
      fp.fabrication.length > 0
        ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
        : { x: fp.courtyard.x + fp.courtyard.w / 2, y: fp.courtyard.y + fp.courtyard.h / 2 }
    const centre = placePoint(placement, localCentre)
    // The board's quarter-turn rotations live in the y-DOWN canvas frame (placePoint's 90° maps
    // (x,y) → (−y, x) there — screen-clockwise). Negating Y for the Gerber frame mirrors the
    // sense: the copper a fab sees is rotated (360 − r)° counter-clockwise. Emitting r raw would
    // tell the pick-and-place machine to turn a SOIC 180° from where its pads actually are
    // (review-caught by tracing pin 1's flash against the CSV on a 90°-rotated part).
    const rotationCcw = (360 - placement.rotation) % 360
    lines.push(
      `${csvField(placement.partId)},${num(centre.x)},${num(-centre.y)},Top,${rotationCcw}`,
    )
  }
  return `${lines.join('\n')}\n`
}

export type FabInputs = {
  board: Board
  ratsnest: Ratsnest
  routing: BoardRouting
  drc: readonly DrcViolation[]
  /** Wired pins with no footprint on the board — a nonzero count means the board is incomplete. */
  offBoardPins: number
  bomRows: readonly BomRow[]
  /** The circuit as a SPICE netlist (the engine's own serializer, with its own SPICE element
   *  numbering) — an electrical reference alongside the fab files. */
  netlistText: string
  /** Parts the SPICE serializer could not express ('id (definition)' lines) — they exist on the
   *  board (bom.csv / placement.csv) but not in netlist.cir; the report states the omission. */
  netlistUnsupported?: readonly string[]
  when: Date
}

export type FabValidation = {
  status: 'pass' | 'fail'
  /** Why the board is not manufacturable — empty exactly when status is 'pass'. */
  problems: string[]
  reportText: string
}

/**
 * The validation report: what was checked, against which cited limit, and what the answer was.
 * FAIL means the fab would manufacture a broken board — the app refuses to export until it passes,
 * and the report says why in plain terms.
 */
export function buildValidationReport(inputs: FabInputs): FabValidation {
  const { board, ratsnest, routing, drc, offBoardPins, when } = inputs
  const problems: string[] = []
  if (board.placements.length === 0) problems.push('No parts are placed on the board.')
  if (offBoardPins > 0) {
    problems.push(
      `${offBoardPins} wired pin${offBoardPins === 1 ? ' has' : 's have'} no footprint — the board would be missing real connections.`,
    )
  }
  if (routing.unrouted.length > 0) {
    problems.push(
      `${routing.unrouted.length} connection${routing.unrouted.length === 1 ? '' : 's'} could not be routed — the board still owes copper.`,
    )
  }
  if (drc.length > 0) {
    problems.push(
      `${drc.length} design-rule violation${drc.length === 1 ? '' : 's'} — see the DRC section.`,
    )
  }
  // The archive must agree with itself: every placed part in the BOM, every BOM line on the
  // board. The app builds both from the same schematic, so a mismatch means a caller bug — the
  // engine refuses rather than shipping an assembly pair that contradicts the copper.
  const bomRefs = new Set(inputs.bomRows.map((r) => r.reference))
  const placedIds = new Set(board.placements.map((p) => p.partId))
  const missingFromBom = [...placedIds].filter((id) => !bomRefs.has(id))
  const missingFromBoard = [...bomRefs].filter((id) => !placedIds.has(id))
  if (missingFromBom.length > 0) {
    problems.push(`On the board but missing from the BOM: ${missingFromBom.join(', ')}.`)
  }
  if (missingFromBoard.length > 0) {
    problems.push(`In the BOM but not placed on the board: ${missingFromBoard.join(', ')}.`)
  }
  const status = problems.length === 0 ? 'pass' : 'fail'

  const lines = [
    'ChipBlocks board validation report',
    `Generated ${isoWithOffset(when)} — deterministic engine output (no AI writes these files).`,
    '',
    `STATUS: ${status.toUpperCase()}`,
    ...problems.map((p) => `  ✗ ${p}`),
    '',
    'BOARD',
    `  outline: ${num(board.outline.w)} × ${num(board.outline.h)} mm`,
    `  parts placed: ${board.placements.length}`,
    `  connections: ${ratsnest.airwires.length} owed, ${routing.traces.length} routed as copper, ${routing.unrouted.length} unrouted`,
    '',
    'RULES CHECKED (each limit cited — ask the file where a number came from and it answers)',
    `  trace width ${num(DEFAULT_ROUTE_CLASS.traceWidthMm)} mm / clearance ${num(DEFAULT_ROUTE_CLASS.clearanceMm)} mm — ${DEFAULT_ROUTE_CLASS.provenance.title}`,
    `  copper-to-edge ≥ ${num(DRC_RULES['edge-clearance'].limitMm)} mm — ${DRC_RULES['edge-clearance'].provenance.title}`,
    `  courtyard overlap — ${DRC_RULES['courtyard-overlap'].provenance.title}`,
    `  minimum track width ${num(DRC_RULES['track-width'].limitMm)} mm — ${DRC_RULES['track-width'].provenance.title}`,
    '',
    'DESIGN-RULE CHECK',
    ...(drc.length === 0
      ? ['  clean — no violations']
      : drc.map((v) => `  ✗ ${v.code}: ${v.message} at (${num(v.at.x)}, ${num(v.at.y)}) mm`)),
    '',
    'HONEST SCOPE',
    '  · Two copper layers (the standard minimum fab order); ALL routing is on the top layer —',
    '    the bottom copper carries only the through-hole pads’ annular rings.',
    `  · Solder-mask openings equal the pad copper (clearance ${num(GERBER_CONVENTIONS.mask_clearance.valueMm)} mm — ${GERBER_CONVENTIONS.mask_clearance.provenance.title}).`,
    '  · Silkscreen carries the part outlines; reference lettering is not drawn on silk yet —',
    '    designators live in bom.csv and placement.csv.',
    '  · Board frame: millimetres, Y up (the Gerber convention); placement rotations are degrees',
    '    counter-clockwise in that frame.',
    '  · netlist.cir uses its own SPICE element numbering — an electrical reference, not keyed to',
    '    the bom.csv/placement.csv designators.',
    ...((inputs.netlistUnsupported?.length ?? 0) > 0
      ? [
          `  · netlist.cir has no SPICE model yet for: ${(inputs.netlistUnsupported ?? []).join('; ')} —`,
          '    on the board (bom.csv / placement.csv) but only a comment line in the netlist.',
        ]
      : []),
    '',
  ]
  return { status, problems, reportText: lines.join('\n') }
}

const BASE = 'board'

/** The archive's file set — names follow kicad-cli's output (layer suffix + Protel extension). */
export const FAB_FILE_NAMES = {
  topCopper: `${BASE}-F_Cu.gtl`,
  bottomCopper: `${BASE}-B_Cu.gbl`,
  topMask: `${BASE}-F_Mask.gts`,
  bottomMask: `${BASE}-B_Mask.gbs`,
  topSilk: `${BASE}-F_Silkscreen.gto`,
  edgeCuts: `${BASE}-Edge_Cuts.gm1`,
  drill: `${BASE}.drl`,
  bom: 'bom.csv',
  placement: 'placement.csv',
  netlist: 'netlist.cir',
  report: 'validation-report.txt',
  readme: 'README.txt',
} as const

function buildReadme(inputs: FabInputs): string {
  return [
    'ChipBlocks manufacturing files',
    `Generated ${isoWithOffset(inputs.when)} by the ChipBlocks deterministic engine.`,
    '',
    'Fabrication (Gerber X2, units mm; drill in Excellon decimal mm — file shapes ground-truthed',
    'against KiCad 10.0.4 output):',
    `  ${FAB_FILE_NAMES.topCopper}      top copper — pads + all routed traces`,
    `  ${FAB_FILE_NAMES.bottomCopper}      bottom copper — through-hole annular rings`,
    `  ${FAB_FILE_NAMES.topMask}    top solder mask openings`,
    `  ${FAB_FILE_NAMES.bottomMask}    bottom solder mask openings`,
    `  ${FAB_FILE_NAMES.topSilk} top silkscreen (part outlines)`,
    `  ${FAB_FILE_NAMES.edgeCuts}  board outline (the fab cuts this centreline)`,
    `  ${FAB_FILE_NAMES.drill}           plated drill hits`,
    '',
    'Assembly:',
    `  ${FAB_FILE_NAMES.bom}               bill of materials (grouped by value + footprint)`,
    `  ${FAB_FILE_NAMES.placement}         pick-and-place: body centres, mm, Y up, rotation CCW`,
    '',
    'Reference:',
    `  ${FAB_FILE_NAMES.netlist}           the circuit as a SPICE netlist (its own element numbering)`,
    `  ${FAB_FILE_NAMES.report} what was validated, against which cited limits`,
    '',
  ].join('\n')
}

export type FabZip = {
  bytes: Uint8Array
  entries: string[]
  validation: FabValidation
}

/** Assemble the full manufacturing ZIP. Callers gate on validation.status — the app never offers
 *  a failing board's ZIP — but the builder always builds, so tests can inspect failing reports. */
export function buildManufacturingZip(inputs: FabInputs): FabZip {
  const { board, ratsnest, routing, when } = inputs
  const validation = buildValidationReport(inputs)
  const encoder = new TextEncoder()
  const text = (name: string, content: string): ZipEntry => ({
    name,
    data: encoder.encode(content),
  })
  const entries: ZipEntry[] = [
    text(FAB_FILE_NAMES.topCopper, gerberTopCopper(board, ratsnest, routing, when)),
    text(FAB_FILE_NAMES.bottomCopper, gerberBottomCopper(board, ratsnest, when)),
    text(FAB_FILE_NAMES.topMask, gerberMask(board, 'Top', when)),
    text(FAB_FILE_NAMES.bottomMask, gerberMask(board, 'Bot', when)),
    text(FAB_FILE_NAMES.topSilk, gerberSilkscreen(board, when)),
    text(FAB_FILE_NAMES.edgeCuts, gerberEdgeCuts(board.outline, when)),
    text(FAB_FILE_NAMES.drill, excellonDrill(board, when)),
    text(FAB_FILE_NAMES.bom, buildBomCsv(inputs.bomRows)),
    text(FAB_FILE_NAMES.placement, buildPlacementCsv(board)),
    text(FAB_FILE_NAMES.netlist, inputs.netlistText),
    text(FAB_FILE_NAMES.report, validation.reportText),
    text(FAB_FILE_NAMES.readme, buildReadme(inputs)),
  ]
  return { bytes: buildZip(entries, when), entries: entries.map((e) => e.name), validation }
}
