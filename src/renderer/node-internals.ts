import { useStoreApi } from '@xyflow/react'
import { useCallback } from 'react'

/**
 * Re-measuring many parts at once without paying for it once per part.
 *
 * THE DEFECT THIS EXISTS FOR, measured rather than reasoned. React Flow's `useUpdateNodeInternals`
 * writes to its own store on every call, and every component subscribed to that store re-runs its
 * selector on every write — on this canvas the subscribers ARE the parts. So re-measuring N parts one
 * at a time costs N × N selector runs. Two places in this app do exactly that: each part re-measures
 * itself when it mounts, and the block-pin effect re-measures every block whenever any block's pin
 * layout changes, which a staged draw makes it do once per batch.
 *
 * The V8 sampling profiler on the built app, drawing a 2,000-block project through the launcher:
 * 18,224 ms of the 30,846 ms draw was inside React Flow's `updateNodeInternals` — 59 % of the whole
 * thing — with 3,865 ms of self time in its store's `memoizedSelector` and 3,838 ms in the `shallow`
 * comparison that follows it (…/repair/t2/prof-blk2000.json, top-total and top-self tables). That is
 * what made a batch cost what the canvas costs instead of what the batch costs, and it is why the
 * batch sizer could not find a size that kept the window answering: there wasn't one.
 *
 * THE FIX IS THE LIBRARY'S OWN. `updateNodeInternals` already takes a LIST of ids and writes once for
 * the whole list. This collects the ids asked for during one task and hands them over as that list,
 * so N writes become one. Nothing about WHICH parts get re-measured changes.
 */

/**
 * Gathers node ids and hands them to `updateNodeInternals` in one call per scheduled flush.
 *
 * `schedule` is injected so the queue can be tested without a browser, and defaults to a microtask —
 * the earliest point at which every caller in the current task has had its say, and still before the
 * frame React Flow does its own measuring in, so the re-measure lands in the same frame it used to.
 */
export function createNodeRemeasureQueue(
  updateNodeInternals: (nodeIds: string[]) => void,
  schedule: (run: () => void) => void = queueMicrotask,
): (nodeId: string) => void {
  const waiting = new Set<string>()
  let flushScheduled = false
  return (nodeId: string) => {
    waiting.add(nodeId)
    if (flushScheduled) return
    flushScheduled = true
    schedule(() => {
      flushScheduled = false
      if (waiting.size === 0) return
      const nodeIds = [...waiting]
      waiting.clear()
      updateNodeInternals(nodeIds)
    })
  }
}

/**
 * Which parts actually have to be re-measured: the ones whose handle layout is new or different.
 *
 * The block-pin effect used to re-measure EVERY block whenever any one block's pins moved, on the
 * grounds that it could not tell which. It can: keep each block's own pin signature and compare. The
 * difference matters because a staged draw appends parts, so "any block changed" is true once per
 * batch, and the old rule then re-measured the whole canvas once per batch.
 */
export function nodesNeedingRemeasure(
  previousSignatures: ReadonlyMap<string, string>,
  currentSignatures: ReadonlyMap<string, string>,
): string[] {
  const changed: string[] = []
  for (const [nodeId, signature] of currentSignatures) {
    if (previousSignatures.get(nodeId) !== signature) changed.push(nodeId)
  }
  return changed
}

/** One queue per React Flow store, so every part on one canvas shares the same flush. */
const queueByStore = new WeakMap<object, (nodeId: string) => void>()

/**
 * The queue every part on ONE canvas re-measures through.
 *
 * Sharing it is the entire saving, and it is easy to lose by accident. Each part calls the hook below
 * for itself, so a queue held per caller — or made fresh per call — is one store write per part again,
 * which is the N × N the profile above measured. Keying it on the React Flow store is what makes two
 * thousand callers one write, and keeps two canvases in two tabs from writing into each other's store.
 */
export function sharedRemeasureQueue(
  store: object,
  updateNodeInternals: (nodeIds: string[]) => void,
): (nodeId: string) => void {
  const existing = queueByStore.get(store)
  if (existing !== undefined) return existing
  const queue = createNodeRemeasureQueue(updateNodeInternals)
  queueByStore.set(store, queue)
  return queue
}

/**
 * Where a batch of parts actually IS in the DOM, found with one pass over the canvas instead of one per id.
 *
 * THE SECOND DEFECT, in the library rather than in this app. React Flow's `useUpdateNodeInternals`
 * resolves each id on its own with `domNode.querySelector('.react-flow__node[data-id="…"]')`
 * (node_modules/@xyflow/react/dist/esm/index.js:3830). That is an unindexed attribute scan of the whole
 * canvas, so re-measuring N parts costs N scans of a document that is itself N parts long — the cost grows
 * as the square of the design. Coalescing the ids into one call, above, does not help: the loop is inside.
 *
 * Measured on the built app drawing 2,000 grouped blocks / 3,400 wires at grid pitch 10: 2,000 of these
 * selectors, one per part, each one distinct (…/qs/qs-count-b2000w3400p10.json), for 57 ms of
 * `querySelector` self time (…/qs/qs-before-b2000w3400p10.json, `querySelectorByCaller`). After this
 * change that caller is absent from the same profile of the same design (…/qs/qs-after-b2000w3400p10.json).
 *
 * WHAT IS NOT CLAIMED. 57 ms is all that was measured saved, and an attempt to show the square term
 * mattering at a larger size FAILED TO DECIDE ANYTHING: four reps of 9,000 grouped blocks with 2,000
 * wires on one build ran 64,235 / 92,876 / 177,493 / 230,095 ms (…/qs/after-b9000w2000.json,
 * after2-, after3-), a 3.6x spread that swamps any difference between builds — the same design on the
 * build without this change ran 78,957 ms (…/qs/portalsonly-b9000w2000.json), inside that spread. So this
 * is kept for the shape of the work it removes and for the 57 ms, and NOT on any evidence that it helps
 * a large design. Anything claiming otherwise needs a measurement that can tell two builds apart first.
 *
 * One `querySelectorAll` of the part class, read into a map by `data-id`, answers the whole batch. The
 * elements handed back are the same elements the per-id scan would have found: same class, same
 * attribute, same document.
 */
export function nodeElementsById(
  flowElement: {
    querySelectorAll: (selectors: string) => Iterable<Element>
  } | null,
  nodeIds: readonly string[],
): Map<string, Element> {
  const found = new Map<string, Element>()
  if (flowElement === null || nodeIds.length === 0) return found
  const wanted = new Set(nodeIds)
  for (const element of flowElement.querySelectorAll('.react-flow__node')) {
    const nodeId = element.getAttribute('data-id')
    if (nodeId === null || !wanted.has(nodeId)) continue
    found.set(nodeId, element)
  }
  return found
}

/**
 * `useUpdateNodeInternals`, with the calls made during one task collapsed into a single store write.
 * Drop-in for the one-id form: same ids re-measured, same frame, one write instead of one each.
 *
 * The store's own `updateNodeInternals` is called rather than the hook of the same name because the hook's
 * only extra work is the per-id scan replaced above; everything else here — the `force`, the
 * `triggerFitView: false`, the frame it lands in — is what the hook does, kept the same on purpose.
 */
export function useCoalescedUpdateNodeInternals(): (nodeId: string) => void {
  const store = useStoreApi()
  return useCallback(
    (nodeId: string) =>
      sharedRemeasureQueue(store, (nodeIds) => {
        const { domNode, updateNodeInternals } = store.getState()
        const elements = nodeElementsById(domNode, nodeIds)
        const updates = new Map<
          string,
          { id: string; nodeElement: HTMLDivElement; force: boolean }
        >()
        for (const [id, nodeElement] of elements) {
          updates.set(id, { id, nodeElement: nodeElement as HTMLDivElement, force: true })
        }
        requestAnimationFrame(() => updateNodeInternals(updates, { triggerFitView: false }))
      })(nodeId),
    [store],
  )
}
