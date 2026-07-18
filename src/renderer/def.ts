/**
 * DEF EXPORT — the placed design for OpenROAD interop (chip-physical chapter, step 6a). The companion to
 * lef.ts: where LEF describes the cell library, DEF describes THIS floorplan — the die area, the placement
 * rows, and every cell instance at its placed (x, y). Together `read_lef(lef)` + `read_def(def)` load a
 * ChipBlocks floorplan into OpenROAD for placement inspection + re-placement.
 *
 * FORMAT: LEF/DEF 5.8 Language Reference. Coordinates in integer database units (1 dbu = 1 nm), the same
 * λ→nm grid gds.ts uses, so the DEF placement and the exported GDSII coincide. Y is FLIPPED to DEF's y-up,
 * bottom-left convention exactly as floorplanToGds flips it (the floorplan is y-down, top-left). DEF is
 * hierarchical by construction: every COMPONENT names its `cell_<NAME>` LEF macro (from lef.ts) rather than
 * inlining geometry — the same one-definition-per-gate-type, placed-by-reference shape the OASIS/GDS writers
 * emit — so the three exports describe one identical hierarchy in three formats.
 *
 * HONEST SCOPE (see lef.ts): PINS and NETS are emitted as empty stubs — this is a PLACED design, not a
 * connected one, so OpenROAD can inspect/re-place it but cannot route or time it without a Liberty library
 * and real connectivity. All rows/components are orientation N (matching the GDS), so adjacent rails abut
 * VDD-to-VSS — an interchange artifact, not a legalized power grid.
 */

import { PROCESS } from './cell-layout.ts'
import type { Floorplan } from './cell-place.ts'
import { gdsName } from './gds.ts'
import { dbu, LEF_SITE } from './lef.ts'

/** A DEF-legal identifier: keep [A-Za-z0-9_], never empty. */
export function defName(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, '_')
  return cleaned.length > 0 ? cleaned : 'inst'
}

/**
 * Turn a placed floorplan into a DEF placed-design text. `components` is the instance count (= placed
 * cells). Never throws; an empty floorplan yields a valid empty design.
 */
export function floorplanToDef(
  fp: Floorplan,
  options: { design?: string } = {},
): { text: string; components: number } {
  const design = gdsName(options.design ?? 'chipblocks_top')
  const rowH = PROCESS.rowHeight.lambda
  const siteStep = dbu(PROCESS.polyPitch.lambda) // site width in dbu (2400)
  const nSites = Math.max(1, Math.floor(fp.dieWidthLambda / PROCESS.polyPitch.lambda))

  const lines: string[] = [
    'VERSION 5.8 ;',
    'DIVIDERCHAR "/" ;',
    'BUSBITCHARS "[]" ;',
    `DESIGN ${design} ;`,
    'UNITS DISTANCE MICRONS 1000 ;',
    `DIEAREA ( 0 0 ) ( ${dbu(fp.dieWidthLambda)} ${dbu(fp.dieHeightLambda)} ) ;`,
  ]
  for (let r = 0; r < fp.rows; r++) {
    // DEF is y-up; row r (from the top, y-down) sits at bottom-y = dieHeight − (r+1)·rowHeight.
    const y = dbu(fp.dieHeightLambda - (r + 1) * rowH)
    lines.push(`ROW ROW_${r} ${LEF_SITE} 0 ${y} N DO ${nSites} BY 1 STEP ${siteStep} 0 ;`)
  }

  lines.push(`COMPONENTS ${fp.cells.length} ;`)
  const usedIds = new Set<string>()
  for (const c of fp.cells) {
    let id = defName(c.id)
    if (usedIds.has(id)) {
      let k = 1
      while (usedIds.has(`${id}_${k}`)) k += 1
      id = `${id}_${k}`
    }
    usedIds.add(id)
    const master = gdsName(`cell_${c.name}`)
    const x = dbu(c.x)
    const y = dbu(fp.dieHeightLambda - (c.y + c.h)) // flip to DEF y-up, bottom-left of the cell
    lines.push(`   - ${id} ${master} + PLACED ( ${x} ${y} ) N ;`)
  }
  lines.push('END COMPONENTS')
  lines.push('PINS 0 ;', 'END PINS')
  lines.push('NETS 0 ;', 'END NETS')
  lines.push('END DESIGN')
  return { text: lines.join('\n'), components: fp.cells.length }
}
