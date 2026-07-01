/**
 * The canvas partition predicates — the single source of truth for "is this node digital, analog, or an
 * inert passive?" These classify a drawn part so the pipeline can route it: a purely-digital block goes to
 * the fast 0/1 logic engine, an analog part to the transistor-level solve, and a mixed canvas is split at
 * the digital↔analog boundary and co-simulated.
 *
 * They were defined inline in App.tsx, where THREE call sites reached for them — the whole-canvas
 * dispatcher (`solveCanvasDispatch`), the DC co-sim (`solveCanvasMixed`), and the transient co-sim
 * (`solveTransientCoSim`). Pulling them here gives that seam one owner, independent of the UI, so the
 * dispatcher and both co-sim coordinators read the same classification. (This is a pure move — the
 * predicates are unchanged; only their home is.)
 */

import type { Node } from '@xyflow/react'
import type { BlockData } from '../blocks.ts'
import { blockIsLogicCompatible } from '../logic-sim.ts'
import type { DeviceNodeData } from '../symbols.tsx'

/** Does this node solve on the fast logic engine (0/1) rather than the transistor-level analog solve? */
export const isLogicFidelity = (n: Node): boolean => {
  const data = n.data as DeviceNodeData
  const f = data.fidelity
  if (f === 'logic' || f === 'behaviour') return true
  if (f === 'transistor') return false
  // Untagged: a purely-digital block (gates all the way down) DEFAULTS to the fast logic engine — the
  // ~1000× digital win. The transistor solve stays the explicit choice for analog and for descending into
  // a gate's silicon. Analog / mixed blocks aren't logic-compatible, so they keep the transistor solve.
  const block = (data as { block?: BlockData }).block
  return data.definition === 'block' && block !== undefined && blockIsLogicCompatible(block)
}

/** Definitions that carry no analog load of their own — a mixed canvas isn't "analog" just for having these. */
export const ANALOG_PASSIVE = new Set(['power_source', 'ground', 'junction'])

// A logic block's OUTPUT pins (it DRIVES these). Used to classify a logic↔analog boundary: an output
// pin means the logic drives the analog; any other (input) pin means the analog drives the logic.
export const LOGIC_OUTPUT_HANDLES = new Set([
  'out',
  'q',
  'qbar',
  'q_bar',
  'sum',
  'carry',
  'cout',
  'c_out',
  'carry_out',
  'borrow',
])
