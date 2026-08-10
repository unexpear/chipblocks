import { tooBigFileToDrawReason } from '../src/renderer/canvas-capacity.ts'
import { deserializeCircuit } from '../src/renderer/circuit-file.ts'

/**
 * Whether a .chipblocks file's text may be opened, decided in the MAIN process before any of it reaches
 * a window. Two doors ask: the File ▸ Open Circuit menu item (which pushes the circuit onto the canvas
 * that is on screen) and the launcher's read handlers (which return it so a new tab can be built).
 *
 * It lives here, out of main.ts, so it can be tested: main.ts imports `electron` and cannot be loaded by
 * the test runner at all, and "the guard is at the door" is exactly the claim that has to be checkable.
 *
 * The two failure kinds are not the same thing and callers act differently on them:
 *   • `unreadable` — the file is gone, or is not a circuit file. Its entry in My Projects is stale.
 *   • `too-big`    — the file is fine, and is more than the canvas can draw without the window going
 *                    quiet for longer than it allows itself. The project is still there and still the
 *                    user's; nothing about it should be pruned, deleted, or overwritten.
 */
export type CircuitOpenDecision =
  | { ok: true; text: string }
  | { ok: false; kind: 'unreadable' | 'too-big'; reason: string }

export function decideCircuitOpen(text: string): CircuitOpenDecision {
  const result = deserializeCircuit(text)
  if (!result.ok) return { ok: false, kind: 'unreadable', reason: result.reason }
  const tooBig = tooBigFileToDrawReason(result.file)
  if (tooBig !== undefined) return { ok: false, kind: 'too-big', reason: tooBig }
  return { ok: true, text }
}
