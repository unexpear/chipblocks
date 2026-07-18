/**
 * GEOMETRIC DESIGN-RULE CHECK for standard-cell polygons — the chip-side twin of pcb-drc.ts. It reads a
 * cell's per-layer rectangles (cell-polygons.ts) and REPORTS every geometry that breaks the cited λ-scalable
 * SCMOS rule deck the cells are drawn to (cell-layout.ts DESIGN_RULES). Like the board DRC, it never
 * auto-fixes — it hands the user (or a later router) a list of what to fix.
 *
 * The four checks:
 *   - min_width    — no drawn shape is narrower than its layer's minimum (a too-thin wire won't print).
 *   - min_spacing  — two shapes of DIFFERENT nets on one layer are at least the layer's minimum apart
 *                    (touching / too-close conductors short or bridge when etched).
 *   - exact_size   — a contact/via cut (licon1, mcon) is exactly the one legal size (contactSize²).
 *   - containment  — a contact sits fully on a device layer below it (diffusion or poly); one hanging off
 *                    the edge doesn't connect. This is the check that surfaces the deliberate reduced-
 *                    enclosure relaxation the cell generator makes at a composite gate's stage boundary.
 *
 * This is HONEST about the teaching geometry: the cells use minimal 8λ pitch, so the DRC will report the
 * genuine tight spots (a different-net feature closer than min-spacing) and the stage-boundary contact
 * relaxations. Single-stage gates are geometrically simpler and report far fewer than composites. The
 * engine itself is exact — its tests prove it catches synthetic bad geometry and passes clean geometry.
 */

import type { BlockData } from './blocks.ts'
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
import { DESIGN_RULES } from './cell-layout.ts'
import { type CellLayerName, type CellRect, cellBlock, cellPolygons } from './cell-polygons.ts'

export type DrcRuleKind = 'min_width' | 'min_spacing' | 'exact_size' | 'containment'

export type DrcViolation = {
  kind: DrcRuleKind
  layer: CellLayerName
  requiredLambda: number
  measuredLambda: number
  /** A representative point of the offending geometry (λ), for the report / a future highlight. */
  x: number
  y: number
  detail: string
}

const ruleLambda = (name: string): number => {
  const r = DESIGN_RULES[name]
  if (r === undefined) throw new Error(`design rule "${name}" missing`)
  return r.lambda
}

// The λ deck, sourced from the cited SCMOS rules in cell-layout.ts. li1 is a SKY130 local-interconnect
// layer with no SCMOS analogue; it is contact-scale, so its minimum width/spacing tracks the contact size
// and the metal-1 spacing respectively. Contacts (licon1/mcon) have an EXACT size rather than a min width.
const MIN_WIDTH = new Map<CellLayerName, number>([
  ['poly', ruleLambda('minPolyWidth')],
  ['diff', ruleLambda('minActiveWidth')],
  ['met1', ruleLambda('minMetal1Width')],
  ['nwell', ruleLambda('minWellWidth')],
  ['li1', ruleLambda('contactSize')],
])
const MIN_SPACE = new Map<CellLayerName, number>([
  ['poly', ruleLambda('minPolySpace')],
  ['diff', ruleLambda('minActiveSpace')],
  ['met1', ruleLambda('minMetal1Space')],
  ['li1', ruleLambda('minMetal1Space')],
  ['licon1', ruleLambda('minMetal1Space')],
  ['mcon', ruleLambda('minMetal1Space')],
])
const CONTACT_LAYERS = new Set<CellLayerName>(['licon1', 'mcon'])
const CONTACT_SIZE = ruleLambda('contactSize')

/** Orthogonal edge-to-edge distance between two axis-aligned rectangles (0 if they touch or overlap). */
function edgeDistance(a: CellRect, b: CellRect): number {
  const dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0)
  const dy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0)
  if (dx > 0 && dy > 0) return Math.hypot(dx, dy) // diagonal — corner-to-corner
  return Math.max(dx, dy) // overlapping in one axis — the gap in the other (0 ⇒ touch/overlap)
}

/** Two rects are the SAME conductor only when both carry the same DEFINED net. An undefined net (a
 *  diffusion strip spans several nets) is treated as its own thing, so diffusion-to-diffusion spacing is
 *  still checked. */
const sameNet = (a: CellRect, b: CellRect): boolean =>
  a.net !== undefined && b.net !== undefined && a.net === b.net

const contains = (outer: CellRect, inner: CellRect): boolean =>
  outer.x <= inner.x &&
  inner.x + inner.w <= outer.x + outer.w &&
  outer.y <= inner.y &&
  inner.y + inner.h <= outer.y + outer.h

/**
 * Run the four checks over one cell's rectangles. Pure geometry; returns every violation, most-specific
 * first isn't guaranteed — callers group/sort as they like.
 */
export function cellDrc(rects: CellRect[]): DrcViolation[] {
  const violations: DrcViolation[] = []
  const byLayer = new Map<CellLayerName, CellRect[]>()
  for (const r of rects) {
    const list = byLayer.get(r.layer) ?? []
    list.push(r)
    byLayer.set(r.layer, list)
  }

  // min_width + exact_size (per rect)
  for (const r of rects) {
    if (CONTACT_LAYERS.has(r.layer)) {
      if (r.w !== CONTACT_SIZE || r.h !== CONTACT_SIZE) {
        violations.push({
          kind: 'exact_size',
          layer: r.layer,
          requiredLambda: CONTACT_SIZE,
          measuredLambda: Math.min(r.w, r.h),
          x: r.x,
          y: r.y,
          detail: `${r.layer} cut is ${r.w}×${r.h} λ, must be ${CONTACT_SIZE}×${CONTACT_SIZE} λ`,
        })
      }
      continue
    }
    const minW = MIN_WIDTH.get(r.layer)
    if (minW === undefined) continue
    const narrow = Math.min(r.w, r.h)
    if (narrow < minW - 1e-9) {
      violations.push({
        kind: 'min_width',
        layer: r.layer,
        requiredLambda: minW,
        measuredLambda: narrow,
        x: r.x,
        y: r.y,
        detail: `${r.layer} shape is ${narrow} λ wide, minimum is ${minW} λ`,
      })
    }
  }

  // min_spacing (different-net pairs on the same layer)
  for (const [layer, list] of byLayer) {
    const minS = MIN_SPACE.get(layer)
    if (minS === undefined) continue
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i] as CellRect
        const b = list[j] as CellRect
        if (sameNet(a, b)) continue
        const dist = edgeDistance(a, b)
        if (dist < minS - 1e-9) {
          violations.push({
            kind: 'min_spacing',
            layer,
            requiredLambda: minS,
            measuredLambda: dist,
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
            detail: `two ${layer} shapes (nets ${a.net ?? '?'} / ${b.net ?? '?'}) are ${dist.toFixed(2)} λ apart, minimum is ${minS} λ`,
          })
        }
      }
    }
  }

  // containment: a licon1 must sit fully on a diffusion or poly shape; an mcon fully on a met1 shape.
  // Enclosure is tested against a SINGLE device rect (not their union) — exact for cell-polygons.ts, which
  // emits each abutted diffusion run as one merged rect and each gate contact on its own poly stripe, so no
  // real contact straddles two same-layer shapes. A future consumer feeding split geometry would want a
  // union test here.
  const diffOrPoly = [...(byLayer.get('diff') ?? []), ...(byLayer.get('poly') ?? [])]
  const met1 = byLayer.get('met1') ?? []
  for (const cut of byLayer.get('licon1') ?? []) {
    if (!diffOrPoly.some((r) => contains(r, cut))) {
      violations.push({
        kind: 'containment',
        layer: 'licon1',
        requiredLambda: 0,
        measuredLambda: 0,
        x: cut.x,
        y: cut.y,
        detail: `licon1 cut (net ${cut.net ?? '?'}) is not fully on a diffusion/poly shape (reduced enclosure)`,
      })
    }
  }
  for (const cut of byLayer.get('mcon') ?? []) {
    if (!met1.some((r) => contains(r, cut))) {
      violations.push({
        kind: 'containment',
        layer: 'mcon',
        requiredLambda: 0,
        measuredLambda: 0,
        x: cut.x,
        y: cut.y,
        detail: `mcon via (net ${cut.net ?? '?'}) is not fully on a metal-1 shape`,
      })
    }
  }

  return violations
}

export const STANDARD_CELL_BLOCKS: readonly BlockData[] = [
  INVERTER_BLOCK,
  BUFFER_BLOCK,
  NAND2_BLOCK,
  NOR2_BLOCK,
  AND_BLOCK,
  OR_BLOCK,
  XOR_BLOCK,
  XNOR_BLOCK,
]

export type CellDrcReport = { name: string; violations: DrcViolation[] }

/** DRC every primitive standard cell — a library-qualification sweep. */
export function standardCellDrc(): CellDrcReport[] {
  return STANDARD_CELL_BLOCKS.map((block) => ({
    name: block.name,
    violations: cellDrc(cellPolygons(block).rects),
  }))
}

/** DRC each UNIQUE mapped cell type in a set of placed-cell names (a per-design sweep for the export
 *  report). Names that aren't a primitive gate are skipped (they have no polygons to check). */
export function namedCellDrc(names: Iterable<string>): CellDrcReport[] {
  const seen = new Set<string>()
  const reports: CellDrcReport[] = []
  for (const name of names) {
    if (seen.has(name)) continue
    seen.add(name)
    const block = cellBlock(name)
    if (!block) continue
    reports.push({ name, violations: cellDrc(cellPolygons(block).rects) })
  }
  return reports
}

/** A one-line human summary of a DRC pass (used in the export report), e.g.
 *  "DRC: 3 cells clean; 12 violations in 5 cells (8 min_spacing, 4 containment)". */
export function summarizeDrc(reports: CellDrcReport[]): string {
  const total = reports.reduce((n, r) => n + r.violations.length, 0)
  const cleanCount = reports.filter((r) => r.violations.length === 0).length
  if (total === 0) return `DRC: all ${reports.length} cells clean`
  const byKind = new Map<DrcRuleKind, number>()
  for (const r of reports)
    for (const v of r.violations) byKind.set(v.kind, (byKind.get(v.kind) ?? 0) + 1)
  const breakdown = [...byKind.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${k}`)
    .join(', ')
  return `DRC: ${cleanCount}/${reports.length} cells clean; ${total} violations (${breakdown}) — teaching geometry at minimal λ pitch, not foundry-DRC-clean`
}
