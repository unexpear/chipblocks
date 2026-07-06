import { buildZip, type ZipEntry } from '../zip-store.ts'
import {
  type Board,
  footprintByPlacement,
  placePoint,
  type Ratsnest,
  type Recess,
} from './pcb-board.ts'
import type { DrcViolation } from './pcb-drc.ts'
import { DRC_RULES } from './pcb-drc.ts'
import {
  excellonDrill,
  GERBER_CONVENTIONS,
  gerberBottomCopper,
  gerberEdgeCuts,
  gerberInnerCopper,
  gerberMask,
  gerberPaste,
  gerberSilkscreen,
  gerberTopCopper,
  isoWithOffset,
} from './pcb-gerber.ts'
import {
  type BoardRouting,
  DEFAULT_ROUTE_CLASS,
  routableCopperLayers,
  VIA_RULES,
} from './pcb-route.ts'
import {
  COPPER_WEIGHT_MM,
  COPPER_WEIGHT_PROVENANCE,
  defaultStackup,
  FR4_SUBSTRATE,
  IPC2221,
  type Stackup,
  SURFACE_FINISHES,
  traceAmpacity,
  traceImpedance,
  traceResistanceOhm,
  VIA_PLATING_PROVENANCE,
} from './pcb-stackup.ts'
import { SILK_TEXT } from './stroke-font.ts'

/**
 * The manufacturing ZIP — deliverable #2 (CLAUDE.md core principle 1): the archive a user hands a
 * board fab. Assembled entirely by the deterministic engine — the Gerber/drill writers, the DRC
 * results, and the solver's own connectivity — never by AI at runtime; wrong Gerbers cost real
 * money. The ZIP only leaves the app when the board is COMPLETE (everything routed, DRC clean,
 * every wired pin on the board); the validation report inside restates exactly what was checked,
 * against which cited limits, so "why should I trust these files" always has an answer.
 *
 * Contents (flat, the shape fab upload forms expect): the eight Gerber layers (two copper, two
 * mask, two paste, silkscreen, edge cuts) + the drill file (KiCad-style names, Protel
 * extensions), bom.csv + placement.csv (the assembly pair, JLCPCB column conventions),
 * board-stackup.txt (the fab-ORDER spec — material / thickness / copper weight / finish, cited),
 * the SPICE netlist, the validation report, and a README naming every file.
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
    // The Designator is the SHORT board name (R1) — the same one the silkscreen prints, so the
    // assembler's file and the ink on the board can never disagree.
    lines.push(
      `${csvField(placement.designator ?? placement.partId)},${num(centre.x)},${num(-centre.y)},Top,${rotationCcw}`,
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
  /** The board's physical stack-up (substrate, copper weight, finish) — the fab-ORDER spec. Absent
   *  ⇒ the shipped default (2-layer, 1.6 mm FR4, 1 oz copper, HASL). */
  stackup?: Stackup
  /** Controlled-depth recesses (cavity / stepped boards) — a depth-milling spec we don't yet emit. */
  recesses?: readonly Recess[]
  /** Whether trace over-current could be checked: false for a board with no solved currents (a
   *  purely-digital / logic board), so the report discloses the check was NOT run rather than imply a
   *  pass. Absent ⇒ treated as evaluated (an analog board, the common case). */
  overCurrentEvaluated?: boolean
  when: Date
}

/** A copper weight as an ounce label (the trade unit) with its µm thickness in parentheses. */
const copperWeightLabel = (w: Stackup['copperWeight']): string => {
  const oz = w === 'half_oz' ? '0.5' : w === 'two_oz' ? '2' : '1'
  return `${oz} oz (${num(COPPER_WEIGHT_MM[w] * 1000)} µm)`
}

/** The fab-ORDER spec — the board-stackup.txt file + the report's BOARD SPEC lines. States the
 *  material, finished thickness, copper weight, layer count and surface finish a fab needs on the
 *  order; without it the fab silently defaults everything. Every line is cited. */
export function buildStackupSpec(stackup: Stackup): string {
  const finish = SURFACE_FINISHES[stackup.surfaceFinish]
  // The trace physics the copper weight sets — computed for the default trace width, so the router's
  // "~1 A" note is backed by a real number, not just prose. DC resistance per 100 mm + the IPC-2221
  // current a trace of that width carries at a 10 °C rise.
  const traceW = DEFAULT_ROUTE_CLASS.traceWidthMm
  const rPer100 = traceResistanceOhm(traceW, 100, stackup.copperWeight, 20)
  const amps = traceAmpacity(traceW, stackup.copperWeight, 10, 'external')
  const z = traceImpedance(stackup, traceW, 'top')
  const zLine =
    z === undefined
      ? []
      : [
          `  Trace impedance: ${num(traceW)} mm over the ${z.referenceLayer} plane ≈ ${Math.round(z.ohms)} Ω single-ended (microstrip, IPC-2141A${z.withinValidity ? '' : ' — outside the formula range, treat as an estimate'})`,
        ]
  return [
    'ChipBlocks board stack-up — the fab-order spec (every value cited)',
    '',
    `  Layers:          ${stackup.copperLayers} copper`,
    `  Finished thickness: ${num(stackup.thicknessMm)} mm`,
    `  Substrate:       FR4 — Dk ${num(FR4_SUBSTRATE.dielectricConstant)}, Df ${num(FR4_SUBSTRATE.lossTangent)}, Tg ~${num(FR4_SUBSTRATE.glassTransitionC)} °C, ${num(FR4_SUBSTRATE.thermalConductivityWmK)} W/m·K`,
    `  Copper weight:   ${copperWeightLabel(stackup.copperWeight)} outer`,
    `  Surface finish:  ${finish.name}${finish.leadFree ? ' (lead-free)' : ''}`,
    `  Default trace:   ${num(traceW)} mm wide → ${num(rPer100 * 1000)} mΩ per 100 mm; carries ~${(Math.round(amps * 100) / 100).toFixed(2)} A at a 10 °C rise (IPC-2221 external)`,
    ...zLine,
    '',
    'Cross-section (top → bottom):',
    ...stackup.layers.map((l) => {
      const d =
        l.dielectricConstant !== undefined
          ? ` — Dk ${num(l.dielectricConstant)}, Df ${num(l.lossTangent ?? 0)}`
          : ''
      return `  ${num(l.thicknessMm)} mm  ${l.name} (${l.material ?? l.type}${d})`
    }),
    '',
    'Provenance:',
    `  stack-up:     ${stackup.provenance.title} — ${stackup.provenance.citation}`,
    `  substrate:    ${FR4_SUBSTRATE.provenance.title} — ${FR4_SUBSTRATE.provenance.citation}`,
    `  copper weight: ${COPPER_WEIGHT_PROVENANCE.title} — ${COPPER_WEIGHT_PROVENANCE.citation}`,
    `  finish:       ${finish.provenance.title} — ${finish.provenance.citation}`,
    '',
  ].join('\n')
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
  const stackup = inputs.stackup ?? defaultStackup()
  const problems: string[] = []
  if (board.placements.length === 0) problems.push('No parts are placed on the board.')
  // (4-/6-layer boards now export: the inner-copper Gerbers are generated below, so a fab has real
  // artwork for every copper layer the stack-up declares.)
  // Cavity / stepped guard: a controlled-depth recess needs a depth-routing (mechanical) program the
  // ZIP doesn't yet carry, and shipping a flat 2-D fab set for a 3-D-milled board would be wrong —
  // so we refuse rather than let the fab build a flat board that ignores the pockets.
  const recessCount = inputs.recesses?.length ?? 0
  if (recessCount > 0) {
    problems.push(
      `The board has ${recessCount} controlled-depth recess${recessCount === 1 ? '' : 'es'} (cavity / stepped board), but ChipBlocks does not yet generate the depth-routing (mechanical) program a fab needs to mill them (±0.2 mm Z-axis) — so the archive would describe a flat board. Remove the recess${recessCount === 1 ? '' : 'es'} to export. (Cavity / stepped boards are for design and the 3-D view for now.)`,
    )
  }
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
  const placedIds = new Set(board.placements.map((p) => p.designator ?? p.partId))
  const missingFromBom = [...placedIds].filter((id) => !bomRefs.has(id))
  const missingFromBoard = [...bomRefs].filter((id) => !placedIds.has(id))
  if (missingFromBom.length > 0) {
    problems.push(`On the board but missing from the BOM: ${missingFromBom.join(', ')}.`)
  }
  if (missingFromBoard.length > 0) {
    problems.push(`In the BOM but not placed on the board: ${missingFromBoard.join(', ')}.`)
  }
  const status = problems.length === 0 ? 'pass' : 'fail'
  const finish = SURFACE_FINISHES[stackup.surfaceFinish]

  const lines = [
    'ChipBlocks board validation report',
    `Generated ${isoWithOffset(when)} — deterministic engine output (no AI writes these files).`,
    '',
    `STATUS: ${status.toUpperCase()}`,
    ...problems.map((p) => `  ✗ ${p}`),
    '',
    'BOARD SPEC (the fab order — see board-stackup.txt for the full cross-section + citations)',
    `  ${stackup.copperLayers}-layer, ${num(stackup.thicknessMm)} mm FR4 (Dk ${num(FR4_SUBSTRATE.dielectricConstant)}), ${copperWeightLabel(stackup.copperWeight)} copper, ${finish.name} finish`,
    '',
    'BOARD',
    `  outline: ${num(board.outline.w)} × ${num(board.outline.h)} mm`,
    `  parts placed: ${board.placements.length}`,
    // routed CONNECTIONS, not trace count — one via'd connection is three copper traces
    `  connections: ${ratsnest.airwires.length} owed, ${ratsnest.airwires.length - routing.unrouted.length} routed, ${routing.unrouted.length} unrouted${routing.vias.length > 0 ? ` (${routing.vias.length} via${routing.vias.length === 1 ? '' : 's'})` : ''}`,
    '',
    'RULES CHECKED (each limit cited — ask the file where a number came from and it answers)',
    `  trace width ${num(DEFAULT_ROUTE_CLASS.traceWidthMm)} mm / clearance ${num(DEFAULT_ROUTE_CLASS.clearanceMm)} mm — ${DEFAULT_ROUTE_CLASS.provenance.title}`,
    `  copper-to-edge ≥ ${num(DRC_RULES['edge-clearance'].limitMm)} mm — ${DRC_RULES['edge-clearance'].provenance.title}`,
    `  courtyard overlap — ${DRC_RULES['courtyard-overlap'].provenance.title}`,
    `  minimum track width ${num(DRC_RULES['track-width'].limitMm)} mm — ${DRC_RULES['track-width'].provenance.title}`,
    `  via drill ≥ ${num(VIA_RULES.min_drill.limitMm)} mm — ${VIA_RULES.min_drill.provenance.title}`,
    `  via annular ring ≥ ${num(VIA_RULES.min_annular.limitMm)} mm — ${VIA_RULES.min_annular.provenance.title}`,
    `  hole-to-hole ≥ ${num(VIA_RULES.hole_to_hole.limitMm)} mm — ${VIA_RULES.hole_to_hole.provenance.title}`,
    `  via-in-pad — ${DRC_RULES['via-in-pad'].provenance.title}`,
    inputs.overCurrentEvaluated === false
      ? '  trace over-current — NOT CHECKED: this board has no solved currents (a digital / logic board), so trace widths were not verified against current. Check on a current-solving (analog) build.'
      : `  trace over-current (each trace vs its ampacity at the solved net current) — ${IPC2221.provenance.title}`,
    ...(inputs.overCurrentEvaluated === false
      ? []
      : [
          `  via over-current (each via's plated barrel vs its net current) — ${VIA_PLATING_PROVENANCE.title}`,
        ]),
    '  net continuity (every net whole — each net verified joined by its OWN copper, no opens)',
    '',
    'DESIGN-RULE CHECK',
    ...(drc.length === 0
      ? ['  clean — no violations']
      : drc.map((v) => `  ✗ ${v.code}: ${v.message} at (${num(v.at.x)}, ${num(v.at.y)}) mm`)),
    '',
    'HONEST SCOPE',
    '  · Two copper layers, both routed: connections take the top layer first and drop to the',
    `    bottom through plated ${num(DEFAULT_ROUTE_CLASS.viaDiameterMm)} / ${num(DEFAULT_ROUTE_CLASS.viaDrillMm)} mm vias when the top is blocked. Vias are`,
    '    tented (mask-covered), the KiCad default.',
    `  · Solder-mask openings equal the pad copper (clearance ${num(GERBER_CONVENTIONS.mask_clearance.valueMm)} mm — ${GERBER_CONVENTIONS.mask_clearance.provenance.title}).`,
    '  · Paste apertures equal the SMD pads (KiCad’s zero paste clearance; the stencil house',
    '    applies its own reduction). Through-hole pads get no paste.',
    `  · Silkscreen carries the part outlines and stroked reference designators (${num(SILK_TEXT.heightMm)} mm`,
    `    lettering at ${num(SILK_TEXT.thicknessMm)} mm stroke — ${SILK_TEXT.provenance.title}).`,
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
  topPaste: `${BASE}-F_Paste.gtp`,
  bottomPaste: `${BASE}-B_Paste.gbp`,
  topSilk: `${BASE}-F_Silkscreen.gto`,
  edgeCuts: `${BASE}-Edge_Cuts.gm1`,
  drill: `${BASE}.drl`,
  bom: 'bom.csv',
  placement: 'placement.csv',
  stackup: 'board-stackup.txt',
  netlist: 'netlist.cir',
  report: 'validation-report.txt',
  readme: 'README.txt',
} as const

/** The Gerber file name for inner copper layer `innerIndex` (In1 = 1, In2 = 2…), following KiCad's
 *  convention: In1.Cu → -In1_Cu.g2, In2.Cu → -In2_Cu.g3 (the extension is the physical layer number). */
export function innerCopperFileName(innerIndex: number): string {
  return `${BASE}-In${innerIndex}_Cu.g${innerIndex + 1}`
}

function buildReadme(inputs: FabInputs): string {
  const innerCount = Math.max(0, (inputs.stackup?.copperLayers ?? 2) - 2)
  const innerCopperLines = Array.from(
    { length: innerCount },
    (_, i) =>
      `  ${innerCopperFileName(i + 1)}      inner copper In${i + 1} — TH rings, its traces, via barrels`,
  )
  return [
    'ChipBlocks manufacturing files',
    `Generated ${isoWithOffset(inputs.when)} by the ChipBlocks deterministic engine.`,
    '',
    'Fabrication (Gerber X2, units mm; drill in Excellon decimal mm — file shapes ground-truthed',
    'against KiCad 10.0.4 output):',
    `  ${FAB_FILE_NAMES.topCopper}      top copper — pads, top traces, via barrels`,
    ...innerCopperLines,
    `  ${FAB_FILE_NAMES.bottomCopper}      bottom copper — TH rings, bottom traces, via barrels`,
    `  ${FAB_FILE_NAMES.topMask}    top solder mask openings`,
    `  ${FAB_FILE_NAMES.bottomMask}    bottom solder mask openings`,
    `  ${FAB_FILE_NAMES.topPaste}   top solder-paste stencil apertures (SMD pads)`,
    `  ${FAB_FILE_NAMES.bottomPaste}   bottom paste (empty — no bottom-mounted parts)`,
    `  ${FAB_FILE_NAMES.topSilk} top silkscreen (part outlines + designators)`,
    `  ${FAB_FILE_NAMES.edgeCuts}  board outline (the fab cuts this centreline)`,
    `  ${FAB_FILE_NAMES.drill}           plated drill hits (component holes + via holes)`,
    '',
    'Assembly:',
    `  ${FAB_FILE_NAMES.bom}               bill of materials (grouped by value + footprint)`,
    `  ${FAB_FILE_NAMES.placement}         pick-and-place: body centres, mm, Y up, rotation CCW`,
    '',
    'Order spec:',
    `  ${FAB_FILE_NAMES.stackup}     material / thickness / copper weight / finish (the fab order)`,
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
  const stackup = inputs.stackup ?? defaultStackup()
  const validation = buildValidationReport(inputs)
  const encoder = new TextEncoder()
  const text = (name: string, content: string): ZipEntry => ({
    name,
    data: encoder.encode(content),
  })
  // One Gerber per copper layer, in stack order: top (L1), then each inner layer (In1 = L2…), then the
  // bottom (L_last). A 2-layer board is exactly top + bottom as before; a 4-/6-layer board adds its
  // inner copper so a fab has real artwork for every layer the stack-up declares.
  const copper = routableCopperLayers(stackup.copperLayers)
  const copperEntries: ZipEntry[] = copper.map((cl, idx) => {
    const layerNumber = idx + 1
    if (cl === 'top') {
      return text(FAB_FILE_NAMES.topCopper, gerberTopCopper(board, ratsnest, routing, when))
    }
    if (cl === 'bottom') {
      return text(
        FAB_FILE_NAMES.bottomCopper,
        gerberBottomCopper(board, ratsnest, routing, when, layerNumber),
      )
    }
    return text(
      innerCopperFileName(idx),
      gerberInnerCopper(board, ratsnest, routing, cl, layerNumber, when),
    )
  })
  const entries: ZipEntry[] = [
    ...copperEntries,
    text(FAB_FILE_NAMES.topMask, gerberMask(board, 'Top', when)),
    text(FAB_FILE_NAMES.bottomMask, gerberMask(board, 'Bot', when)),
    text(FAB_FILE_NAMES.topPaste, gerberPaste(board, 'Top', when)),
    text(FAB_FILE_NAMES.bottomPaste, gerberPaste(board, 'Bot', when)),
    text(FAB_FILE_NAMES.topSilk, gerberSilkscreen(board, when)),
    text(FAB_FILE_NAMES.edgeCuts, gerberEdgeCuts(board.outline, when)),
    text(FAB_FILE_NAMES.drill, excellonDrill(board, routing, when)),
    text(FAB_FILE_NAMES.bom, buildBomCsv(inputs.bomRows)),
    text(FAB_FILE_NAMES.placement, buildPlacementCsv(board)),
    text(FAB_FILE_NAMES.stackup, buildStackupSpec(inputs.stackup ?? defaultStackup())),
    text(FAB_FILE_NAMES.netlist, inputs.netlistText),
    text(FAB_FILE_NAMES.report, validation.reportText),
    text(FAB_FILE_NAMES.readme, buildReadme(inputs)),
  ]
  return { bytes: buildZip(entries, when), entries: entries.map((e) => e.name), validation }
}
