/**
 * THE PERSISTED CHIP-LAYOUT LAYER — the chip floorplan as its own saved state, the twin of the board's
 * hand-placements (SavedPlacement in circuit-file.ts). The auto floorplan (cell-place.ts `placeCells`) is
 * GENERATED from the design; this layer records what the user changed on top of it — cell position
 * overrides, the colouring-lens choice, and a fingerprint of the schematic the base placement came from
 * (so a later "layout drifts from schematic" check can tell when they've diverged). It rides the save
 * file + undo exactly like the board placements, so "each layer exists" and survives a reload.
 *
 * Units are λ (the process layout unit), matching cell-place.ts.
 */

/** A cell's hand-placement OVERRIDE — its (x, y) in λ, keyed by the flattened cell id. Absent for a cell
 *  still on its auto-packed spot; re-placing re-seeds those. */
export type ChipCellOverride = { id: string; x: number; y: number }

/** How the floorplan colours its cells (the lens toggle — Phase D). */
export type ChipLensMode = 'module' | 'gate' | 'density'

/** The saved chip-layout layer: the user's edits over the auto floorplan + the lens choice + the
 *  schematic fingerprint the base placement was generated from. */
export type ChipLayout = {
  overrides: ChipCellOverride[]
  lens?: ChipLensMode
  /** Fingerprint of the schematic when the base placement was last (re-)generated — drives the drift
   *  banner (Phase E). Absent ⇒ no baseline recorded yet. */
  sourceSignature?: string
}

export const EMPTY_CHIP_LAYOUT: ChipLayout = { overrides: [] }

/** A layout that carries nothing worth saving — so we OMIT it from the file (like empty board placements),
 *  keeping older files byte-identical when the chip level was never touched. */
export function isEmptyChipLayout(layout: ChipLayout | undefined): boolean {
  return !layout || (layout.overrides.length === 0 && !layout.lens && !layout.sourceSignature)
}

/**
 * Validate a chip layout read from a file: keep only well-formed overrides (id + finite x/y), a known
 * lens, and a string signature. A malformed field is DROPPED — not a reason to reject the whole circuit
 * — mirroring the board-placements loader. Returns undefined when nothing survives (so the loader treats
 * it as absent). Accepts `unknown` so callers can hand it a raw parsed value.
 */
export function sanitizeChipLayout(raw: unknown): ChipLayout | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const r = raw as Record<string, unknown>
  const overrides = Array.isArray(r.overrides)
    ? (r.overrides as unknown[]).filter((o): o is ChipCellOverride => {
        const q = o as Record<string, unknown>
        return (
          typeof q?.id === 'string' &&
          typeof q?.x === 'number' &&
          Number.isFinite(q.x) &&
          typeof q?.y === 'number' &&
          Number.isFinite(q.y)
        )
      })
    : []
  const lens: ChipLensMode | undefined =
    r.lens === 'module' || r.lens === 'gate' || r.lens === 'density' ? r.lens : undefined
  const sourceSignature = typeof r.sourceSignature === 'string' ? r.sourceSignature : undefined
  const layout: ChipLayout = {
    overrides,
    ...(lens ? { lens } : {}),
    ...(sourceSignature ? { sourceSignature } : {}),
  }
  return isEmptyChipLayout(layout) ? undefined : layout
}
