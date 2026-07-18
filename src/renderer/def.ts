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
 * CONNECTIVITY (signoff follow-up C1): pass `options.netlist` (from top-netlist.ts) to populate the NETS,
 * PINS and SPECIALNETS sections — WHICH cell output drives which cell inputs, the design's top-level I/O,
 * and the power rails — so a tool can route + time the design, not only inspect the placement. Power is the
 * standard `* VDD` / `* VSS` wildcard (every primitive cell has those pins). Without a netlist the sections
 * stay empty (a placement-only interchange). A Liberty timing library (liberty.ts) completes the round-trip.
 * Rows alternate orientation N / FS (even / odd), matching the GDS + OASIS, so adjacent rows abut
 * rail-to-rail on the SAME net (VDD∥VDD, VSS∥VSS) — a legal, shareable power grid.
 */

import { PROCESS } from './cell-layout.ts'
import { cellOrient, type Floorplan, orientForRow } from './cell-place.ts'
import { gdsName } from './gds.ts'
import { dbu, LEF_SITE } from './lef.ts'
import type { TopNetlist } from './top-netlist.ts'

/** A DEF-legal identifier: keep [A-Za-z0-9_], never empty. */
export function defName(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, '_')
  return cleaned.length > 0 ? cleaned : 'inst'
}

/**
 * Turn a placed floorplan into a DEF placed-design text. `components` is the instance count (= placed cells);
 * `nets` / `pins` are the counts ACTUALLY emitted (after remapping to placed cells), so a caller can report
 * what the file really contains. Never throws; an empty floorplan yields a valid empty design.
 */
export function floorplanToDef(
  fp: Floorplan,
  options: { design?: string; netlist?: TopNetlist } = {},
): { text: string; components: number; nets: number; pins: number } {
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
    // DEF is y-up; row r (from the top, y-down) sits at bottom-y = dieHeight − (r+1)·rowHeight. Even rows
    // are N, odd rows FS — the flipped rows share power rails with their neighbours (legal PDN).
    const y = dbu(fp.dieHeightLambda - (r + 1) * rowH)
    lines.push(
      `ROW ROW_${r} ${LEF_SITE} 0 ${y} ${orientForRow(r)} DO ${nSites} BY 1 STEP ${siteStep} 0 ;`,
    )
  }

  lines.push(`COMPONENTS ${fp.cells.length} ;`)
  const usedIds = new Set<string>()
  const defIdOf = new Map<string, string>() // flat gate node id (= PlacedCell id) → its unique DEF instance id
  for (const c of fp.cells) {
    let id = defName(c.id)
    if (usedIds.has(id)) {
      let k = 1
      while (usedIds.has(`${id}_${k}`)) k += 1
      id = `${id}_${k}`
    }
    usedIds.add(id)
    defIdOf.set(c.id, id)
    const master = gdsName(`cell_${c.name}`)
    // DEF places the cell origin (its lower-left) at the point AFTER the orientation is applied. For N that
    // is the cell's bottom-left (dieHeight − (y+h)); for FS the x-axis flip sends the origin to the top edge
    // (dieHeight − y), so the flipped cell still lands in its row band. Orientation from the LIVE y, so a
    // dragged cell re-orients to whichever band it now sits in.
    const orient = cellOrient(c)
    const x = dbu(c.x)
    const y =
      orient === 'FS' ? dbu(fp.dieHeightLambda - c.y) : dbu(fp.dieHeightLambda - (c.y + c.h))
    lines.push(`   - ${id} ${master} + PLACED ( ${x} ${y} ) ${orient} ;`)
  }
  lines.push('END COMPONENTS')

  // PINS — the design's top-level I/O, inferred from named net-labels (top-netlist.ts). Empty without a netlist.
  const pinNets = options.netlist?.signalNets.filter((n) => n.pin !== undefined) ?? []
  lines.push(`PINS ${pinNets.length} ;`)
  for (const net of pinNets) {
    const pin = net.pin as NonNullable<(typeof net)['pin']>
    lines.push(`   - ${pin.name} + NET ${net.name} + DIRECTION ${pin.direction} + USE SIGNAL ;`)
  }
  lines.push('END PINS')

  // SPECIALNETS — the power grid. Every primitive cell's LEF MACRO has VDD/VSS pins, so the `* <pin>`
  // wildcard ties them all to the two global rails (a black-box cell without power pins is the exception).
  // A gate signal pin hard-tied to a power/ground SYMBOL (a constant) is appended to the matching rail.
  const railTerms = (rail: 'VDD' | 'VSS') =>
    (options.netlist?.tieConnections ?? [])
      .filter((t) => t.rail === rail)
      .map((t) => {
        const inst = defIdOf.get(t.instId)
        return inst === undefined ? '' : ` ( ${inst} ${t.pin} )`
      })
      .join('')
  if (fp.cells.length > 0) {
    lines.push('SPECIALNETS 2 ;')
    lines.push(`   - VDD ( * VDD )${railTerms('VDD')} + USE POWER ;`)
    lines.push(`   - VSS ( * VSS )${railTerms('VSS')} + USE GROUND ;`)
    lines.push('END SPECIALNETS')
  } else {
    lines.push('SPECIALNETS 0 ;', 'END SPECIALNETS')
  }

  // NETS — the signal connectivity: each gate output to the gate inputs it drives. Remap every connection's
  // flat gate id to its DEF instance id; a labelled (I/O) net also lists its ( PIN <name> ) terminal.
  const netLines: string[] = []
  for (const net of options.netlist?.signalNets ?? []) {
    const terms = net.connections
      .map((c) => {
        const inst = defIdOf.get(c.instId)
        return inst === undefined ? undefined : `( ${inst} ${c.pin} )`
      })
      .filter((t): t is string => t !== undefined)
    if (terms.length === 0) continue // no placed cell on this net
    const pinTerm = net.pin !== undefined ? ` ( PIN ${net.pin.name} )` : ''
    netLines.push(`   - ${net.name} ${terms.join(' ')}${pinTerm} + USE SIGNAL ;`)
  }
  lines.push(`NETS ${netLines.length} ;`, ...netLines, 'END NETS')

  lines.push('END DESIGN')
  return {
    text: lines.join('\n'),
    components: fp.cells.length,
    nets: netLines.length,
    pins: pinNets.length,
  }
}
