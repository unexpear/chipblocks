import { dirname } from 'node:path'

/**
 * What to do about a request for a chip's description files — the one decision, on its own so it can be tested.
 *
 * ChipBlocks asks for a chip description twice over: SILENTLY when a chip file is opened (so a user who has
 * already pointed at the files is never asked again), and OUT LOUD when they press "Choose the chip
 * description…" because the first try was refused.
 *
 * Those two must not share an answer. Whether a pick is REMEMBERED says only that its files could be read, not
 * that they describe the chip usefully — and choosing badly is the ordinary first mistake, because the dialog
 * asks for several files at once and one of them alone is readable and useless. When the remembered pick
 * answered the out-loud ask as well, the button could never open a dialog: the same files came back, the same
 * refusal came back, and nothing inside the app could change it. So an out-loud ask always asks.
 */
export type ChipDescriptionPlan =
  /** answer from what was remembered, without a dialog — the silent try */
  | { ask: false; use: readonly string[] }
  /** open the dialog, starting where they looked last time */
  | { ask: true; startIn: string | null }

export function planChipDescriptionRequest(
  ask: boolean,
  remembered: readonly string[],
): ChipDescriptionPlan {
  if (!ask) return { ask: false, use: remembered }
  const first = remembered[0]
  return { ask: true, startIn: first === undefined ? null : dirname(first) }
}
