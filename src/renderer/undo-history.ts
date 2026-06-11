/**
 * Canvas undo / redo (S19-v3-73) — snapshot history, the desktop contract:
 * every edit checkpoints the canvas BEFORE it changes; Ctrl+Z walks back,
 * Ctrl+Y walks forward, and a fresh edit after an undo discards the redo
 * branch (the timeline forked). Pure data + pure functions — the App owns
 * WHEN to checkpoint (each mutating action) and what a snapshot is.
 *
 * Coalescing: typing "470" into a value field arrives as three edits in a
 * second; undoing should return to the value BEFORE the typing, not replay
 * it backwards a digit at a time. Edits whose tag marks them coalescible
 * (`param:*`, `rotate`) merge into the previous checkpoint when they repeat
 * the same tag inside the window.
 */

export type UndoHistory<T> = {
  past: { state: T; tag: string; at: number }[]
  future: T[]
}

export const MAX_UNDO_STEPS = 100
export const COALESCE_WINDOW_MS = 1200

export function emptyHistory<T>(): UndoHistory<T> {
  return { past: [], future: [] }
}

const coalescible = (tag: string) => tag.startsWith('param:') || tag === 'rotate'

/**
 * Record the canvas as it is RIGHT BEFORE a change applies. A new edit after
 * an undo clears the redo branch. Returns the new history (input untouched).
 */
export function checkpoint<T>(
  history: UndoHistory<T>,
  state: T,
  tag: string,
  now: number,
): UndoHistory<T> {
  const last = history.past[history.past.length - 1]
  if (
    last !== undefined &&
    coalescible(tag) &&
    last.tag === tag &&
    now - last.at < COALESCE_WINDOW_MS
  ) {
    // Same burst of edits — keep the ORIGINAL pre-edit snapshot, refresh the
    // clock so a long steady burst keeps merging, and fork off the redos.
    return {
      past: [...history.past.slice(0, -1), { ...last, at: now }],
      future: [],
    }
  }
  return {
    past: [...history.past, { state, tag, at: now }].slice(-MAX_UNDO_STEPS),
    future: [],
  }
}

export const canUndo = <T>(history: UndoHistory<T>): boolean => history.past.length > 0
export const canRedo = <T>(history: UndoHistory<T>): boolean => history.future.length > 0

/**
 * Step back: the current canvas moves to the redo branch, the newest
 * checkpoint comes off the past. Null when there is nothing to undo.
 */
export function undo<T>(
  history: UndoHistory<T>,
  current: T,
): { history: UndoHistory<T>; restored: T } | null {
  const last = history.past[history.past.length - 1]
  if (last === undefined) return null
  return {
    history: { past: history.past.slice(0, -1), future: [...history.future, current] },
    restored: last.state,
  }
}

/**
 * Step forward again: the current canvas goes back onto the past (as its own
 * checkpoint), the newest redo state is restored. Null when nothing to redo.
 */
export function redo<T>(
  history: UndoHistory<T>,
  current: T,
  now: number,
): { history: UndoHistory<T>; restored: T } | null {
  const next = history.future[history.future.length - 1]
  if (next === undefined) return null
  return {
    history: {
      past: [...history.past, { state: current, tag: 'redo', at: now }].slice(-MAX_UNDO_STEPS),
      future: history.future.slice(0, -1),
    },
    restored: next,
  }
}
