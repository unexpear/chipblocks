/**
 * LEF EXPORT — the standard-cell library abstract for OpenROAD interop (chip-physical chapter, step 6a).
 * The chip-side twin of gds.ts, but emitting the TEXT interchange the open-source place-and-route flow reads
 * (`read_lef`) instead of a GDSII byte stream: a technology LEF (layers + a placement SITE) and a cell LEF
 * (one MACRO per gate — its SIZE, PINs with PORT geometry, and OBS obstructions). Paired with the DEF from
 * def.ts, a ChipBlocks floorplan loads into OpenROAD for placement inspection + re-placement.
 *
 * FORMAT: LEF/DEF 5.8 Language Reference (Cadence, released via Si2 — the grammar OpenROAD's LEF/DEF reader
 * parses). Coordinates in µm on a DATABASE MICRONS 1000 grid. Every number derives from cell-layout.ts
 * (PROCESS, DESIGN_RULES) and the cell-polygons.ts geometry — no invented values.
 *
 * HONEST SCOPE: this supports floorplan / global-placement inspection + re-placement, NOT signoff routing or
 * timing. The tech-LEF rules are the C5N λ-scaled TEACHING rules (met1 0.9, li1 0.6, pitch 1.5 µm — λ×0.3),
 * cited to Harris E158 / MOSIS SCMOS, NOT SKY130 silicon µm; a full OpenROAD flow additionally needs a
 * Liberty (.lib) timing library, DEF connectivity (NETS/PINS — emitted empty here), and LEF VIA / DEF TRACKS
 * for detailed routing. Cells are the same teaching geometry gds.ts exports (no well/substrate taps; relaxed
 * stage-boundary contacts). Every MACRO declares SYMMETRY X Y, so the DEF's odd rows can legally place the
 * cell flipped (FS) to abut power rails on the same net — a legal, shareable grid, not an all-N artifact.
 */

import type { BlockData } from './blocks.ts'
import { STANDARD_CELL_BLOCKS } from './cell-drc.ts'
import { DESIGN_RULES, PROCESS } from './cell-layout.ts'
import type { Floorplan } from './cell-place.ts'
import { type CellRect, cellBlock, cellPolygons, extractNetlist } from './cell-polygons.ts'
import { gdsName } from './gds.ts'

const ruleLambda = (name: string): number => {
  const r = DESIGN_RULES[name]
  if (r === undefined) throw new Error(`design rule "${name}" missing`)
  return r.lambda
}

export const LEF_SITE = 'cbcore'
export const LEF_VERSION = '5.8'

/** λ → µm string for LEF geometry, 3 dp (= DATABASE MICRONS 1000 resolution). Every cell coordinate is a
 *  multiple of 0.5 λ = 0.15 µm, exact at 3 dp, so no rounding drift. */
export const um = (lambda: number): string => (lambda * PROCESS.lambdaUm).toFixed(3)
/** λ → integer database units for DEF (1 dbu = 1 nm) — byte-identical to gds.ts's λ→nm, so a DEF placement
 *  and the GDS SREF land on the same grid. */
export const dbu = (lambda: number): number => Math.round(lambda * PROCESS.lambdaUm * 1000)

const ROW_H = PROCESS.rowHeight.lambda // 90 λ
const ROUTING_LAYERS = ['li1', 'met1'] as const

/** The technology LEF: units, the manufacturing grid, the layer stack, and the placement SITE. Layer widths
 *  are the C5N λ-rules × 0.3 µm (li1 0.6, met1 0.9, spacing 0.6, pitch 1.5), read from the cited rule set. */
export function techLef(): string {
  const li1W = um(ruleLambda('contactSize')) // 0.600 (2 λ)
  const met1W = um(ruleLambda('minMetal1Width')) // 0.900 (3 λ)
  const space = um(ruleLambda('minMetal1Space')) // 0.600 (2 λ)
  const pitch = um(ruleLambda('minMetal1Width') + ruleLambda('minMetal1Space')) // 1.500 (5 λ)
  const siteW = um(PROCESS.polyPitch.lambda) // 2.400 (8 λ)
  const siteH = um(ROW_H) // 27.000 (90 λ)
  return [
    `VERSION ${LEF_VERSION} ;`,
    'BUSBITCHARS "[]" ;',
    'DIVIDERCHAR "/" ;',
    'UNITS',
    '  DATABASE MICRONS 1000 ;',
    'END UNITS',
    'MANUFACTURINGGRID 0.005 ;',
    'LAYER nwell TYPE MASTERSLICE ; END nwell',
    'LAYER diff TYPE MASTERSLICE ; END diff',
    'LAYER poly TYPE MASTERSLICE ; END poly',
    `LAYER licon1 TYPE CUT ; SPACING ${space} ; END licon1`,
    `LAYER li1 TYPE ROUTING ; DIRECTION HORIZONTAL ; WIDTH ${li1W} ; SPACING ${space} ; PITCH ${pitch} ; END li1`,
    `LAYER mcon TYPE CUT ; SPACING ${space} ; END mcon`,
    `LAYER met1 TYPE ROUTING ; DIRECTION HORIZONTAL ; WIDTH ${met1W} ; SPACING ${space} ; PITCH ${pitch} ; END met1`,
    `LAYER via TYPE CUT ; SPACING ${space} ; END via`,
    `LAYER met2 TYPE ROUTING ; DIRECTION VERTICAL ; WIDTH ${met1W} ; SPACING ${space} ; PITCH ${pitch} ; END met2`,
    `SITE ${LEF_SITE}`,
    '  CLASS CORE ;',
    `  SIZE ${siteW} BY ${siteH} ;`,
    '  SYMMETRY Y ;',
    `END ${LEF_SITE}`,
  ].join('\n')
}

type PinDef = { pin: string; dir: string; use: string; netId: string; abut: boolean }

const rectLine = (r: CellRect, indent: string) =>
  `${indent}RECT ${um(r.x)} ${um(r.y)} ${um(r.x + r.w)} ${um(r.y + r.h)} ;`

/** Emit RECTs grouped by routing layer (li1 then met1), one `LAYER … ; RECT … ;` block per layer. */
const layerBlocks = (rects: CellRect[], indent: string): string[] => {
  const out: string[] = []
  for (const layer of ROUTING_LAYERS) {
    const lr = rects.filter((r) => r.layer === layer)
    if (lr.length === 0) continue
    out.push(`${indent}LAYER ${layer} ;`)
    for (const r of lr) out.push(rectLine(r, indent))
  }
  return out
}

/** A black-box MACRO for a placed cell that is not one of the primitive gates: sized to fit, wholly
 *  obstructed, no pins — so the DEF component count stays exact and every DEF master is a defined LEF MACRO. */
function blackBoxMacro(macroName: string, widthLambda: number): string {
  return [
    `MACRO ${macroName}`,
    '  CLASS CORE ;',
    `  SIZE ${um(widthLambda)} BY ${um(ROW_H)} ;`,
    '  SYMMETRY X Y ;', // permit the FS (x-axis flip) an odd row places it in — matching the gate MACROs
    `  SITE ${LEF_SITE} ;`,
    '  OBS',
    '    LAYER met1 ;',
    `    RECT 0.000 0.000 ${um(widthLambda)} ${um(ROW_H)} ;`,
    '  END',
    `END ${macroName}`,
  ].join('\n')
}

/**
 * The MACRO abstract for one primitive gate: SIZE from the cell width, a PIN per input/output/rail with its
 * PORT geometry pulled from the li1/met1 rects tagged with that pin's net, and OBS for the internal
 * (inter-stage) routing. Returns fallback:true (a black-box MACRO) if the name is not a primitive gate.
 */
export function cellMacro(name: string): { text: string; fallback: boolean } {
  const block: BlockData | undefined = cellBlock(name)
  const macroName = gdsName(`cell_${name}`)
  if (!block) return { text: blackBoxMacro(macroName, PROCESS.polyPitch.lambda), fallback: true }

  const layout = cellPolygons(block)
  const net = extractNetlist(block)
  const pins: PinDef[] = []
  net.inputs.forEach((n, i) => {
    pins.push({ pin: i === 0 ? 'A' : 'B', dir: 'INPUT', use: 'SIGNAL', netId: n, abut: false })
  })
  pins.push({ pin: 'Y', dir: 'OUTPUT', use: 'SIGNAL', netId: net.out, abut: false })
  pins.push({ pin: 'VDD', dir: 'INOUT', use: 'POWER', netId: net.vdd, abut: true })
  pins.push({ pin: 'VSS', dir: 'INOUT', use: 'GROUND', netId: net.vss, abut: true })
  const pinNetIds = new Set(pins.map((p) => p.netId))
  const routing = layout.rects.filter((r) => r.layer === 'li1' || r.layer === 'met1')

  const lines = [
    `MACRO ${macroName}`,
    '  CLASS CORE ;',
    `  FOREIGN ${macroName} 0 0 ;`,
    '  ORIGIN 0 0 ;',
    `  SIZE ${um(layout.widthLambda)} BY ${um(layout.heightLambda)} ;`,
    '  SYMMETRY X Y ;',
    `  SITE ${LEF_SITE} ;`,
  ]
  for (const pd of pins) {
    const rects = routing.filter((r) => r.net === pd.netId)
    if (rects.length === 0) continue // a malformed block could omit geometry; drop the pin (never emit an empty PORT)
    lines.push(`  PIN ${pd.pin}`, `    DIRECTION ${pd.dir} ;`, `    USE ${pd.use} ;`)
    if (pd.abut) lines.push('    SHAPE ABUTMENT ;')
    lines.push('    PORT')
    lines.push(...layerBlocks(rects, '      '))
    lines.push('    END', `  END ${pd.pin}`)
  }
  const obs = routing.filter((r) => r.net === undefined || !pinNetIds.has(r.net))
  if (obs.length > 0) {
    lines.push('  OBS')
    lines.push(...layerBlocks(obs, '    '))
    lines.push('  END')
  }
  lines.push(`END ${macroName}`)
  return { text: lines.join('\n'), fallback: false }
}

/** The whole primitive library: the tech LEF + a MACRO for all 8 gates. */
export function standardCellLef(): string {
  return [techLef(), ...STANDARD_CELL_BLOCKS.map((b) => cellMacro(b.name).text)].join('\n')
}

/**
 * A LEF for exactly the cell types a floorplan uses: the tech LEF + one MACRO per distinct cell name
 * (first-appearance order). Unknown names get a black-box MACRO sized from their placement. `macros` is the
 * distinct macro count; `fallbacks` lists the distinct unknown names.
 */
export function floorplanToLef(fp: Floorplan): {
  text: string
  macros: number
  fallbacks: string[]
} {
  const seen = new Set<string>()
  const macroTexts: string[] = []
  const fallbacks: string[] = []
  for (const cell of fp.cells) {
    if (seen.has(cell.name)) continue
    seen.add(cell.name)
    if (cellBlock(cell.name)) {
      macroTexts.push(cellMacro(cell.name).text)
    } else {
      macroTexts.push(blackBoxMacro(gdsName(`cell_${cell.name}`), cell.w))
      fallbacks.push(cell.name)
    }
  }
  return { text: [techLef(), ...macroTexts].join('\n'), macros: seen.size, fallbacks }
}
