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
 *
 * CORRECTNESS OBLIGATION (the non-obvious property this partition encodes). Routing a digital block to
 * the logic engine is not merely an optimisation — it is a REDUCTION with a proof obligation: the 0/1
 * answer must equal what the full transistor solve WOULD have produced. That obligation cannot be
 * discharged at runtime (verifying the ~54 ms logic solve by running the ~60 s transistor solve pays
 * exactly the cost the logic engine exists to avoid). It is discharged at BUILD TIME, per PRIMITIVE:
 * `tests/logic-gates.test.ts` runs the equivalence bridge — `logicBlock` vs the transistor `solveBlock`
 * for every input of the primitive gates (e.g. the full adder) — so any composition of proven gates is
 * sound by construction. `isLogicFidelity` returning true is therefore a claim that this node reduces to
 * that proven-equivalent gate set (`blockIsLogicCompatible` — gates all the way down); when it does not,
 * the transistor solve is kept. Preserve this: a new logic primitive needs a matching equivalence test.
 */

import type { Node } from '@xyflow/react'
import { type BlockData, type DriveKind, isOutputDrive } from '../blocks.ts'
import { blockIsLogicCompatible } from '../logic-sim.ts'
import { ANNOTATION_DEFINITIONS } from '../part-defaults.ts'
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

/** Definitions that carry no analog load of their own — a mixed canvas isn't "analog" just for having
 *  these. Annotations (text, box, line, rect, circle) are pure drawings: no terminals, no load, no
 *  effect on the canvas's kind. */
export const ANALOG_PASSIVE = new Set([
  'power_source',
  'ground',
  'junction',
  ...ANNOTATION_DEFINITIONS,
])

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

/**
 * How a canvas must be solved — the first-class classification the dispatch is built on, so the DC and
 * transient dispatch decide the SAME way instead of each re-deriving it from ad-hoc `.some()` scans:
 *   - `analog` — no logic tags → the full transistor-level solve.
 *   - `logic`  — logic tags driving only digital → the fast 0/1 logic engine.
 *   - `mixed`  — logic tags AND a real analog load → CO-SIMULATE: partition at the digital↔analog bridges
 *                (findBridges) and coordinate the two engines. The mixed engines (solveCanvasMixed for DC,
 *                solveTransientCoSim for transient) ARE the coordinators — a fixed-point iterate for DC, a
 *                temporal lockstep over time for transient. A future engine registry keys off THIS.
 */
export type CanvasKind = 'analog' | 'logic' | 'mixed'

/** Classify a canvas by its fidelity tags (the partition decision, shared by both dispatchers). */
export function classifyCanvas(nodeList: readonly Node[]): CanvasKind {
  if (!nodeList.some(isLogicFidelity)) return 'analog'
  const hasAnalogLoad = nodeList.some(
    (n) => !isLogicFidelity(n) && !ANALOG_PASSIVE.has((n.data as DeviceNodeData).definition),
  )
  return hasAnalogLoad ? 'mixed' : 'logic'
}

/** One wire that crosses the digital↔analog boundary of a mixed canvas — a logic pin wired to a real
 *  analog load. `output` = the logic DRIVES the analog (inject its 0/Vdd); otherwise the analog drives
 *  the logic input (read it back as a 0/1). The shared shape both co-sim coordinators build on. */
export type CanvasBoundary = {
  edgeId: string
  logicId: string
  logicHandle: string
  analogId: string
  analogHandle: string
  output: boolean
}

/** The minimal edge shape findBridges reads — kept structural so partition.ts stays free of React Flow. */
type BridgeEdge = {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

/**
 * The digital↔analog boundaries of a mixed canvas: every wire between a logic-fidelity node (its ids in
 * `logicIds`) and a real analog load (`isRealLoad`). This is the partition primitive both co-sim
 * coordinators build on — the DC co-sim (solveCanvasMixed) splices a 0/Vdd source at each OUTPUT boundary
 * and reads each input boundary back; the transient co-sim (solveTransientCoSim) does the same, over time.
 * `driveOf` supplies the logic pin's declared drive (push-pull / open-collector / tri-state / input), so a
 * decoder's `seg_*` drivers count as outputs, not only the by-name out/q/sum handles. Pure + UI-free —
 * lifting the boundary-finding out of the two inline copies is the step that lets them share a coordinator.
 */
export function findBridges(
  edges: readonly BridgeEdge[],
  logicIds: ReadonlySet<string>,
  isRealLoad: (id: string) => boolean,
  driveOf: (logicId: string, logicHandle: string) => DriveKind | undefined,
): CanvasBoundary[] {
  const boundaries: CanvasBoundary[] = []
  for (const e of edges) {
    const sourceIsLogic = logicIds.has(e.source)
    const targetIsLogic = logicIds.has(e.target)
    if (sourceIsLogic === targetIsLogic) continue // both or neither logic → not a crossing
    const analogId = sourceIsLogic ? e.target : e.source
    if (!isRealLoad(analogId)) continue
    const logicId = sourceIsLogic ? e.source : e.target
    const logicHandle = (sourceIsLogic ? e.sourceHandle : e.targetHandle) ?? ''
    const analogHandle = (sourceIsLogic ? e.targetHandle : e.sourceHandle) ?? ''
    const output =
      isOutputDrive(driveOf(logicId, logicHandle)) ||
      LOGIC_OUTPUT_HANDLES.has(logicHandle.toLowerCase())
    boundaries.push({ edgeId: e.id, logicId, logicHandle, analogId, analogHandle, output })
  }
  return boundaries
}
