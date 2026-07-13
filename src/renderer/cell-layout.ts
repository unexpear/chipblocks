/**
 * STANDARD-CELL GEOMETRY — the first "silicon layer" for the Chip level. Every CMOS logic gate gets a
 * real physical STANDARD CELL: a fixed-height, variable-width rectangle (so cells tile into rows and
 * abut on shared power rails), sized from the gate's OWN real MOSFET netlist and the classic λ-based
 * SCALABLE CMOS design rules (Mead & Conway; Weste & Harris, "CMOS VLSI Design"; the MOSIS SCMOS rule
 * set). All lengths are in λ, the process's fundamental layout unit (a LENGTH — not the MOSFET SPICE
 * channel-length-modulation λ, which is 1/V). Every constant is CITED (project rule #1: real values, no
 * placeholders). The width formula is validated against the primary source: a NAND cell is 24 λ wide,
 * and columns·polyPitch + 2·edgeMargin = 2·8 + 2·4 = 24 λ reproduces it exactly.
 *
 * This is a FIRST-ORDER AREA ESTIMATE from the scalable rules — NOT exact GDS geometry. Real layout
 * packs series transistors that share diffusion and orders them along an Euler path; floorplan, routing,
 * and true polygons are the later silicon layers. The estimate is essentially exact for the catalog's
 * unit-drive complementary gates and least reliable for transmission-gate cells (some XOR/mux designs).
 */

import {
  type BlockData,
  type CanvasEdgeLike,
  type CanvasNodeLike,
  flattenBlocks,
} from './blocks.ts'
import {
  AND_BLOCK,
  BUFFER_BLOCK,
  INVERTER_BLOCK,
  NAND2_BLOCK,
  NOR2_BLOCK,
  OR_BLOCK,
  XNOR_BLOCK,
  XOR_BLOCK,
} from './builtin-blocks.ts'
import { isLogicGate } from './logic-sim.ts'

/** A cited length in λ — so ChipBlocks can answer "where did this number come from" for every value. */
type CitedLambda = { readonly lambda: number; readonly source: string }

/**
 * The teaching process: AMI / ON-Semi C5N, a 0.6 µm CMOS process on MOSIS, λ = 0.30 µm. The standard-
 * cell geometry (row height, poly pitch, edge margin, rails) is the base-SCMOS scalable rule set from
 * the Weste-Harris co-author's own teaching library, cross-validated against the MOSIS SCMOS rules.
 */
export const PROCESS = {
  node: 'AMI / ON-Semi C5N — 0.6 µm CMOS (MOSIS, λ-scalable SCMOS)',
  /** λ in µm — the layout unit. Min transistor gate length is 2λ = 0.6 µm. */
  lambdaUm: 0.3,
  lambdaSource:
    'D. M. Harris, Harvey Mudd E158 "CMOS VLSI Design" Lab 1 §IV: "0.6 µm process with λ = 0.3 µm" (AMI C5N)',
  /** Row height: VSS-rail-center to VDD-rail-center = the row tiling pitch. All cells share it. */
  rowHeight: {
    lambda: 90,
    source: 'Harris E158 Lab 1 §XII/XIV: gates are 90 λ tall, gnd-rail-center to VDD-rail-center',
  } satisfies CitedLambda,
  /** Contacted poly (gate) pitch — the width of ONE transistor column (one input). */
  polyPitch: {
    lambda: 8,
    source:
      'Harris E158 Lab 1 §XIV: "8 λ wide for each input"; MOSIS SCMOS: gate 2λ + space 2λ + contact 2λ + space 2λ = 8λ',
  } satisfies CitedLambda,
  /** n-well / diffusion overhang beyond the cell edge, each side. Validates NAND = 2·8 + 2·4 = 24 λ. */
  edgeMargin: {
    lambda: 4,
    source: 'Harris E158 Lab 1 §XII: n-well extends 4 λ beyond the cell edge in each direction',
  } satisfies CitedLambda,
  /** VDD/VSS power rail width (metal1), wider than the 3λ minimum to carry supply current. */
  railWidth: {
    lambda: 8,
    source: 'Harris E158 Lab 1 §XII: 8 λ-wide power/ground rails run in metal1 at top and bottom',
  } satisfies CitedLambda,
} as const

/**
 * The λ min-rules (MOSIS SCMOS Rev 8.0), carried now for the later design-rule check (a future silicon
 * layer). Base-SCMOS spacings — the submicron (SUBM) variant widens some to 3λ; kept internally
 * consistent with the 8λ contacted-poly-pitch derivation above.
 */
export const DESIGN_RULES: Record<string, CitedLambda> = {
  minPolyWidth: {
    lambda: 2,
    source: 'MOSIS SCMOS Rev 8.0 rule 3.1 — = minimum transistor gate length',
  },
  minPolySpace: { lambda: 2, source: 'MOSIS SCMOS Rev 8.0 rule 3.2 (SCMOS)' },
  minActiveWidth: { lambda: 3, source: 'MOSIS SCMOS Rev 8.0 rule 2.1' },
  minActiveSpace: { lambda: 3, source: 'MOSIS SCMOS Rev 8.0 rule 2.2' },
  minMetal1Width: { lambda: 3, source: 'MOSIS SCMOS Rev 8.0 rule 7.1' },
  minMetal1Space: { lambda: 2, source: 'MOSIS SCMOS Rev 8.0 rule 7.2 (SCMOS)' },
  contactSize: { lambda: 2, source: 'MOSIS SCMOS Rev 8.0 rule 5.1/6.1 — exact 2×2 λ contact' },
  minWellWidth: { lambda: 10, source: 'MOSIS SCMOS Rev 8.0 rule 1.1 (SCMOS)' },
}

export type CellGeometry = {
  name: string
  transistors: number
  columns: number
  widthLambda: number
  heightLambda: number
  widthUm: number
  heightUm: number
  areaUm2: number
  /** false for structurally-unbalanced cells (transmission-gate / pass logic) — width estimate less exact. */
  reliable: boolean
}

const probeOf = (block: BlockData): CanvasNodeLike => ({
  id: '_cell',
  position: { x: 0, y: 0 },
  data: { definition: 'block', block },
})

/**
 * The physical standard-cell geometry of a gate, from its REAL MOSFET netlist + the cited λ-rules.
 * columns = MOSFETs / 2 (each input drives one NMOS + one PMOS sharing a vertical poly column);
 * width = columns · contacted-poly-pitch + 2 · edge-margin; height = the fixed row height.
 */
export function cellGeometry(block: BlockData): CellGeometry {
  const flat = flattenBlocks([probeOf(block)], [])
  let nmos = 0
  let pmos = 0
  for (const n of flat.nodes) {
    if (n.data.definition === 'transistor_mosfet_nmos') nmos += 1
    else if (n.data.definition === 'transistor_mosfet_pmos') pmos += 1
  }
  const transistors = nmos + pmos
  const columns = Math.max(1, Math.round(transistors / 2))
  const widthLambda = columns * PROCESS.polyPitch.lambda + 2 * PROCESS.edgeMargin.lambda
  const heightLambda = PROCESS.rowHeight.lambda
  const widthUm = widthLambda * PROCESS.lambdaUm
  const heightUm = heightLambda * PROCESS.lambdaUm
  return {
    name: block.name,
    transistors,
    columns,
    widthLambda,
    heightLambda,
    widthUm,
    heightUm,
    areaUm2: widthUm * heightUm,
    // a clean complementary gate has equal NMOS and PMOS; an unbalanced count signals transmission-gate
    // / pass logic, where columns = MOSFETs/2 is a weaker estimate.
    reliable: transistors > 0 && nmos === pmos,
  }
}

/** The standard-cell library — the catalog's primitive CMOS gates, each with its cell geometry. */
export function standardCells(): CellGeometry[] {
  return [
    INVERTER_BLOCK,
    BUFFER_BLOCK,
    NAND2_BLOCK,
    NOR2_BLOCK,
    AND_BLOCK,
    OR_BLOCK,
    XOR_BLOCK,
    XNOR_BLOCK,
  ].map(cellGeometry)
}

export type DesignArea = { cellCount: number; areaUm2: number; anyUnreliable: boolean }

/**
 * The design's total standard-cell silicon area: flatten the design STOPPING at gate cells (the same
 * boundary the logic engine uses), then sum each gate cell's estimated area. Non-gate leaves (bare
 * transistors, analog parts) are not standard cells and aren't counted.
 */
export function designCellArea(nodes: CanvasNodeLike[], edges: CanvasEdgeLike[]): DesignArea {
  const flat = flattenBlocks(nodes, edges, isLogicGate)
  let cellCount = 0
  let areaUm2 = 0
  let anyUnreliable = false
  for (const n of flat.nodes) {
    const block = n.data.block
    if (block && isLogicGate(block)) {
      const g = cellGeometry(block)
      cellCount += 1
      areaUm2 += g.areaUm2
      if (!g.reliable) anyUnreliable = true
    }
  }
  return { cellCount, areaUm2, anyUnreliable }
}
