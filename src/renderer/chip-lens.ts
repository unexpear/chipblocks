/**
 * CHIP FLOORPLAN COLOURING LENSES — how the placed die is coloured. Three lenses (the twin of the
 * schematic's lenses in lens.ts), each a pure cell→colour function so the canvas can recolour without
 * re-placing:
 *   • module   — colour by which sub-block a cell came from (its flattened-id hierarchy path, e.g.
 *                `cc_cpu.datapath.alu.and_0` → module `cc_cpu`), so functional regions read as colour
 *                blocks. THE useful default — the standard "amoeba/hierarchy" floorplan view.
 *   • gate     — colour by gate type (NAND/NOR/…). The die-shot the first floorplan increment shipped.
 *   • density  — colour by how packed each area is (a coarse grid over the die) — the placement-quality
 *                heatmap real P&R tools show.
 *
 * Colours are stable (a module/gate maps to the same hue regardless of theme) so the die reads
 * consistently. See MASK-AND-LAYOUT-EDA-ARC / the design discussion for why module ≫ gate for a floorplan.
 */

import type { Floorplan, PlacedCell } from './cell-place.ts'
import type { ChipLensMode } from './chip-layout.ts'

/** The module a cell belongs to = the first `depth` segments of its dot-namespaced flattened id (the
 *  hierarchy path). A gate placed at the very top (no dot) is module "top". */
export function moduleOf(cellId: string, depth = 1): string {
  const segs = cellId.split('.')
  if (segs.length <= 1) return 'top'
  return segs.slice(0, Math.min(depth, segs.length - 1)).join('.')
}

/** A stable hue [0,360) from a string (djb2-ish), so a given module/name is always the same colour. */
function hashHue(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % 360
}

/** Fixed hue per gate type (matches the first floorplan increment's palette). */
const GATE_COLOR: Record<string, string> = {
  NOT: '#5b8def',
  Buffer: '#6fb1fc',
  NAND: '#f2a541',
  NOR: '#e5714f',
  AND: '#3fb27f',
  OR: '#67c99a',
  XOR: '#b07fd6',
  XNOR: '#8f6fd0',
}

export function gateColor(name: string): string {
  return GATE_COLOR[name] ?? '#8a8f98'
}

export function moduleColor(cellId: string, depth = 1): string {
  return `hsl(${hashHue(moduleOf(cellId, depth))}, 60%, 56%)`
}

/** Lerp a 0..1 fraction along a cool→warm density ramp (blue → green → amber → red). */
function densityRamp(f: number): string {
  const t = Math.max(0, Math.min(1, f))
  // hue 210 (blue, sparse) → 0 (red, packed)
  const hue = 210 * (1 - t)
  return `hsl(${hue}, 68%, 52%)`
}

/**
 * Build the per-cell colour function for a lens. For module/gate it's stateless; for density it buckets
 * the cells into a coarse grid over the die and maps each bucket's fill fraction to the ramp — so a
 * region packed with cells reads hot. Returns a plain `(cell) => colour`.
 */
export function buildCellColorer(
  plan: Floorplan,
  lens: ChipLensMode,
  moduleDepth = 1,
): (cell: PlacedCell) => string {
  if (lens === 'gate') return (cell) => gateColor(cell.name)
  if (lens === 'module') return (cell) => moduleColor(cell.id, moduleDepth)

  // density: a ~24-column grid over the die; each bucket's fill = its cell area / bucket area.
  const cols = 24
  const bucketW = Math.max(1, plan.dieWidthLambda / cols)
  const rows = Math.max(1, Math.round(plan.dieHeightLambda / bucketW))
  const bucketH = Math.max(1, plan.dieHeightLambda / rows)
  const area = new Float64Array(cols * rows)
  const bucketOf = (cell: PlacedCell): number => {
    const cx = cell.x + cell.w / 2
    const cy = cell.y + cell.h / 2
    const bc = Math.min(cols - 1, Math.max(0, Math.floor(cx / bucketW)))
    const br = Math.min(rows - 1, Math.max(0, Math.floor(cy / bucketH)))
    return br * cols + bc
  }
  for (const cell of plan.cells) {
    const b = bucketOf(cell)
    area[b] = (area[b] ?? 0) + cell.w * cell.h
  }
  const full = bucketW * bucketH
  return (cell) => densityRamp(full > 0 ? (area[bucketOf(cell)] ?? 0) / full : 0)
}
