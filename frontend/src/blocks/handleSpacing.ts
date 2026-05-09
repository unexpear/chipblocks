// Shared handle-positioning constants used by every block component.
// React Flow positions handles via inline `style={{ top: NN }}` — without
// a shared source of truth, every new block component cargo-cults the
// magic numbers `24, 56, 88, 120, 152` from a sibling. Extracted here
// so the math is named.
//
// Layout convention:
//   block top edge  →  HANDLE_FIRST_PX gap  →  first handle
//   handle N+1 placed HANDLE_SPACING_PX below handle N
//
// `App.css` uses these same values implicitly: `.block-vgatiming`'s
// min-height is computed as HANDLE_FIRST_PX + 5 * HANDLE_SPACING_PX
// (5 output handles on the source side) plus a small bottom margin.
// If these constants change, that selector needs updating too — the
// constants live in TypeScript because every Node component references
// them in JSX, but CSS can't import TS values without build wiring.

export const HANDLE_FIRST_PX = 24
export const HANDLE_SPACING_PX = 32

// Convenience helper for the common case: 0-indexed slot → top offset.
// Block components compute handle positions as `handleTop(0)`,
// `handleTop(1)`, etc., which is more readable than `24 + i * 32`.
export const handleTop = (slot: number): number =>
  HANDLE_FIRST_PX + slot * HANDLE_SPACING_PX
