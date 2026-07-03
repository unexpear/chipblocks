import { BUILTIN_FOOTPRINTS, type Footprint, footprintBounds } from './footprint.ts'
import { footprintForPart } from './footprint-assignment.ts'

/**
 * The PCB board — the physical layout the schematic becomes (TOOLCHAIN-ROADMAP.md Track 1, the PCB
 * canvas). A `Board` is a rectangular outline plus a `Placement` for every schematic part that has a
 * footprint: where its footprint sits on the copper and how it's turned. This is the FIRST time the
 * circuit becomes a physical thing with X/Y/rotation, not just a graph — the bridge the copper router
 * and the Gerber export build on next.
 *
 * `deriveBoard` seeds a layout from the schematic: it lays the footprinted parts out in a neat row (a
 * real auto-placer optimises for net length; this just gives every part a real spot to start from) and
 * fits the board outline around them. Parts with no footprint are honestly skipped — they aren't on the
 * board until their package exists.
 */

export type Rotation = 0 | 90 | 180 | 270

export type Placement = {
  /** The schematic part this places (the node id). */
  partId: string
  footprintId: string
  /** Board position of the footprint origin, in mm. */
  x: number
  y: number
  rotation: Rotation
}

/** The board outline (its physical edge), in mm — a rectangle for now. */
export type BoardOutline = { x: number; y: number; w: number; h: number }

export type Board = { outline: BoardOutline; placements: Placement[] }

/** The minimal part shape deriveBoard reads (a schematic node). */
export type BoardPart = { id: string; definition: string }

/** Resolve a placement's footprint (it stores the id, not the object). */
export function footprintByPlacement(p: Placement): Footprint | undefined {
  return BUILTIN_FOOTPRINTS[p.footprintId]
}

/** A placement's board-space bounding box (its footprint's bounds translated + turned onto the board). */
export function placementBounds(
  p: Placement,
  fp: Footprint,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const b = footprintBounds(fp)
  // rotation 0/180 keeps the axes; 90/270 swaps width and height.
  const swap = p.rotation === 90 || p.rotation === 270
  const halfW = (swap ? b.maxY - b.minY : b.maxX - b.minX) / 2
  const halfH = (swap ? b.maxX - b.minX : b.maxY - b.minY) / 2
  const cx = p.x + (b.minX + b.maxX) / 2
  const cy = p.y + (b.minY + b.maxY) / 2
  return { minX: cx - halfW, minY: cy - halfH, maxX: cx + halfW, maxY: cy + halfH }
}

/**
 * Seed a board from the schematic parts: lay each footprinted part out in a left-to-right row (its
 * footprint's bounds packed with a gap, all vertically centred), then fit the outline around them with
 * a margin. Deterministic, so the same schematic always seeds the same starting board.
 */
export function deriveBoard(parts: readonly BoardPart[], gap = 2, margin = 2.5): Board {
  const placements: Placement[] = []
  let cursorX = 0
  for (const part of parts) {
    const fp = footprintForPart(part.definition)
    if (fp === undefined) continue
    const b = footprintBounds(fp)
    // Place the origin so the footprint's LEFT edge lands at cursorX and it's centred on y = 0.
    placements.push({
      partId: part.id,
      footprintId: fp.id,
      x: cursorX - b.minX,
      y: -(b.minY + b.maxY) / 2,
      rotation: 0,
    })
    cursorX += b.maxX - b.minX + gap
  }
  if (placements.length === 0) return { outline: { x: 0, y: 0, w: 10, h: 10 }, placements }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const p of placements) {
    const fp = footprintByPlacement(p)
    if (fp === undefined) continue
    const bb = placementBounds(p, fp)
    minX = Math.min(minX, bb.minX)
    minY = Math.min(minY, bb.minY)
    maxX = Math.max(maxX, bb.maxX)
    maxY = Math.max(maxY, bb.maxY)
  }
  return {
    outline: {
      x: minX - margin,
      y: minY - margin,
      w: maxX - minX + 2 * margin,
      h: maxY - minY + 2 * margin,
    },
    placements,
  }
}
