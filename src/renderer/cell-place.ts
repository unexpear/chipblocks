/**
 * STANDARD-CELL PLACEMENT — the floorplan layer for the Chip level. Takes the design, flattens it to the
 * same gate cells the silicon-area estimate uses, and PLACES each cell: packs the fixed-height cells into
 * rows that share power rails (real standard-cell style), left to right, wrapping to a new row past a
 * target width chosen so the die comes out roughly square. The result is every cell at a real (x, y) in λ
 * plus the die outline — the first thing you can actually SEE laid out, not just counted.
 *
 * This is placement only (increment 1): cells are laid in flatten order and abut with no routing channels,
 * so utilization reads high. Net-aware placement, wiring (routing), and a design-rule check are the next
 * layers — the reusable orthogonal router (orthogonal-route.ts) is what they'll build on.
 *
 * Units are λ (the process layout unit, PROCESS.lambdaUm = 0.30 µm), converted to µm for display — the
 * same basis as cell-layout.ts, so the die dimensions are real microns.
 */

import {
  type BlockData,
  type CanvasEdgeLike,
  type CanvasNodeLike,
  flattenBlocks,
} from './blocks.ts'
import { cellGeometry, PROCESS } from './cell-layout.ts'
import { isLogicGate } from './logic-sim.ts'

/** One placed standard cell: its gate type + real position and size, all in λ (top-left origin). */
export type PlacedCell = {
  id: string
  name: string
  x: number
  y: number
  w: number
  h: number
  row: number
  reliable: boolean
}

export type Floorplan = {
  cells: PlacedCell[]
  rows: number
  dieWidthLambda: number
  dieHeightLambda: number
  dieWidthUm: number
  dieHeightUm: number
  /** Sum of the placed cells' areas (λ²) — the silicon the logic actually occupies. */
  cellAreaLambda2: number
  /** The die bounding box area (λ²). */
  dieAreaLambda2: number
  /** cellArea / dieArea, 0..1 — how tightly the die is packed (no routing channels reserved yet). */
  utilization: number
  anyUnreliable: boolean
}

/** A row's placement orientation. `N` = as-drawn; `FS` = flipped about the x-axis (top/bottom mirrored). */
export type CellOrient = 'N' | 'FS'

/**
 * The orientation for row `row`: even rows N, odd rows FS. A cell is drawn with its VSS rail at the bottom
 * and VDD at the top; flipping every other row about the x-axis makes adjacent rows abut rail-to-rail on the
 * SAME net (VDD∥VDD, VSS∥VSS) instead of VDD-against-VSS — the standard-cell trick that yields a legal,
 * shareable power grid. Even/odd of the row index is all that matters; the Y-flip to a y-up layout format
 * preserves adjacency, so the same rule gives correct same-net abutment in every export.
 */
export const orientForRow = (row: number): CellOrient => (row % 2 === 0 ? 'N' : 'FS')

/**
 * The orientation of a placed cell, derived from its LIVE y — NOT the stale `row` field, which a
 * drag-to-move leaves behind (the cell's y updates, its `row` does not). Rows are `rowHeightLambda` tall
 * (default = the process row height), so the band index is round(y / rowHeight).
 */
export function cellOrient(
  cell: PlacedCell,
  rowHeightLambda: number = PROCESS.rowHeight.lambda,
): CellOrient {
  const band = rowHeightLambda > 0 ? Math.round(cell.y / rowHeightLambda) : 0
  return orientForRow(band)
}

const EMPTY: Floorplan = {
  cells: [],
  rows: 0,
  dieWidthLambda: 0,
  dieHeightLambda: 0,
  dieWidthUm: 0,
  dieHeightUm: 0,
  cellAreaLambda2: 0,
  dieAreaLambda2: 0,
  utilization: 0,
  anyUnreliable: false,
}

/**
 * Place the design's gate cells into a row-packed floorplan. The cell boundary is `isLogicGate` — the
 * same one the silicon-area estimate uses — so the floorplan's cell count matches the area section (a
 * flip-flop appears as its constituent gates; a sequential standard cell is a later library addition).
 */
export function placeCells(nodes: CanvasNodeLike[], edges: CanvasEdgeLike[]): Floorplan {
  const flat = flattenBlocks(nodes, edges, isLogicGate)
  const rowHeight = PROCESS.rowHeight.lambda

  const geos: { id: string; name: string; width: number; reliable: boolean }[] = []
  for (const node of flat.nodes) {
    const block: BlockData | undefined = node.data.block
    if (!block || !isLogicGate(block)) continue
    const g = cellGeometry(block)
    geos.push({ id: node.id, name: block.name, width: g.widthLambda, reliable: g.reliable })
  }
  if (geos.length === 0) return EMPTY

  const totalCellWidth = geos.reduce((sum, g) => sum + g.width, 0)
  const cellAreaLambda2 = totalCellWidth * rowHeight
  // Target row width for a roughly-square die: a die packed to ~unit height rows is square when its width
  // ≈ sqrt(total cell area). Never narrower than the widest single cell (a cell can't be split across rows).
  const widest = geos.reduce((m, g) => Math.max(m, g.width), 0)
  const targetRowWidth = Math.max(widest, Math.round(Math.sqrt(cellAreaLambda2)))

  const cells: PlacedCell[] = []
  let cursorX = 0
  let row = 0
  let dieWidthLambda = 0
  for (const g of geos) {
    // Wrap to a new row once this cell would overflow the target width (but never leave a row empty).
    if (cursorX > 0 && cursorX + g.width > targetRowWidth) {
      row += 1
      cursorX = 0
    }
    cells.push({
      id: g.id,
      name: g.name,
      x: cursorX,
      y: row * rowHeight,
      w: g.width,
      h: rowHeight,
      row,
      reliable: g.reliable,
    })
    cursorX += g.width
    if (cursorX > dieWidthLambda) dieWidthLambda = cursorX
  }

  const rows = row + 1
  const dieHeightLambda = rows * rowHeight
  const dieAreaLambda2 = dieWidthLambda * dieHeightLambda
  return {
    cells,
    rows,
    dieWidthLambda,
    dieHeightLambda,
    dieWidthUm: dieWidthLambda * PROCESS.lambdaUm,
    dieHeightUm: dieHeightLambda * PROCESS.lambdaUm,
    cellAreaLambda2,
    dieAreaLambda2,
    utilization: dieAreaLambda2 > 0 ? cellAreaLambda2 / dieAreaLambda2 : 0,
    anyUnreliable: geos.some((g) => !g.reliable),
  }
}

/**
 * A cheap structural fingerprint of the schematic — what the placement DEPENDS on: the parts (id +
 * definition + any block name) and the wiring (edge endpoints), NOT their canvas positions (moving a
 * part doesn't change the netlist). Over the TOP-LEVEL nodes/edges (a handful), not the flattened cells,
 * so it's fast to recompute every render. Drives the "layout drifts from schematic" check: when this
 * differs from the fingerprint the floorplan was generated at, the design changed underneath it.
 */
export function chipSignature(nodes: CanvasNodeLike[], edges: CanvasEdgeLike[]): string {
  let h = 2166136261
  const mix = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    h = Math.imul(h, 16777619) // separate fields so "ab"+"c" ≠ "a"+"bc"
  }
  for (const n of [...nodes].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    mix(`${n.id}${n.data.definition}${n.data.block?.name ?? ''}`)
  }
  for (const e of [...edges].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    mix(`${e.id}|${e.source}|${e.sourceHandle ?? ''}|${e.target}|${e.targetHandle ?? ''}`)
  }
  return `${(h >>> 0).toString(36)}:${nodes.length}:${edges.length}`
}
