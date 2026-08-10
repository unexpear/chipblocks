/**
 * Re-measuring parts on the canvas without paying for it once per part.
 *
 * THE DEFECT. React Flow writes to its store on every `updateNodeInternals` call and every component
 * subscribed to that store re-runs its selector on every write, so re-measuring N parts one at a time
 * costs N × N. Two places did exactly that — each part on mount, and the block-pin effect, which
 * re-measured EVERY block whenever any block's pin layout changed and therefore once per batch of a
 * staged draw. Measured with the V8 sampling profiler on the built app, drawing a 2,000-block project
 * through the launcher: 18,224 ms of the 30,846 ms draw inside `updateNodeInternals`
 * (…/repair/t2/prof-blk2000.json). Fixing it took a 12,157 ms worst window silence to 1,049 ms
 * (…/repair/t2/before-blk2000.json → mid-blk2000.json).
 */

import { describe, expect, test } from 'vitest'
import {
  createNodeRemeasureQueue,
  nodeElementsById,
  nodesNeedingRemeasure,
  sharedRemeasureQueue,
} from '../src/renderer/node-internals.ts'

/** A queue whose flush is fired by hand, so the coalescing window is exactly what a test says it is. */
function queueWithManualFlush() {
  const calls: string[][] = []
  const flushes: (() => void)[] = []
  const remeasure = createNodeRemeasureQueue(
    (nodeIds) => calls.push(nodeIds),
    (run) => flushes.push(run),
  )
  return {
    remeasure,
    calls,
    flush: () => {
      const pending = flushes.splice(0, flushes.length)
      for (const run of pending) run()
    },
    scheduled: () => flushes.length,
  }
}

describe('one store write for many parts, not one each', () => {
  test('five hundred parts asking to be re-measured produce ONE call, holding all five hundred', () => {
    const q = queueWithManualFlush()
    for (let i = 0; i < 500; i++) q.remeasure(`n${i}`)
    // One flush was scheduled, not five hundred: that is the whole saving, since each flush is a
    // store write and each store write costs every subscriber on the canvas.
    expect(q.scheduled()).toBe(1)
    q.flush()
    expect(q.calls.length).toBe(1)
    expect(q.calls[0]?.length).toBe(500)
    expect(q.calls[0]?.[0]).toBe('n0')
    expect(q.calls[0]?.[499]).toBe('n499')
  })

  test('the same part asked for twice is re-measured once', () => {
    const q = queueWithManualFlush()
    q.remeasure('a')
    q.remeasure('a')
    q.remeasure('b')
    q.flush()
    expect(q.calls).toEqual([['a', 'b']])
  })

  test('a part asked for AFTER a flush is not dropped — it goes in the next one', () => {
    // The failure this guards against is the obvious way to write the coalescing: latch a flag and
    // never clear it. Everything after the first frame would then be silently never re-measured, and
    // a rotated part's wires would point at where its terminals used to be, for ever.
    const q = queueWithManualFlush()
    q.remeasure('a')
    q.flush()
    q.remeasure('b')
    expect(q.scheduled()).toBe(1)
    q.flush()
    expect(q.calls).toEqual([['a'], ['b']])
  })

  test('a flush with nothing waiting writes nothing at all', () => {
    const q = queueWithManualFlush()
    q.remeasure('a')
    q.flush()
    q.flush()
    expect(q.calls).toEqual([['a']])
  })
})

/**
 * The two halves of the fix that the tests above do NOT exercise, and that a mutation run found nothing
 * catching: the queue's own default schedule, and the sharing of one queue between every part on a
 * canvas. Both were mutated one at a time and the whole suite stayed green, which is why these exist.
 *
 * They run against the SHIPPED defaults — no injected schedule — so the thing under test is the code
 * the app actually runs rather than a version of it configured by the test.
 */
describe('the shipped default: one write per task, not one per caller', () => {
  test('two parts asking in the same task have not written anything YET', async () => {
    // The mutation this fails for is one character of intent: schedule = (run) => run(). Every caller
    // then flushes on the spot, one store write each, and the N × N the profile measured is back with
    // the queue still in place and every other test in this file green.
    const writes: string[][] = []
    const remeasure = createNodeRemeasureQueue((nodeIds) => writes.push(nodeIds))
    remeasure('a')
    remeasure('b')
    expect(writes).toEqual([])
    // A microtask later — before the frame React Flow measures in, which is the point of a microtask
    // rather than a timeout or a frame — the two are one write.
    await Promise.resolve()
    expect(writes).toEqual([['a', 'b']])
  })

  test('a thousand parts mounting in one task cost ONE write', async () => {
    const writes: string[][] = []
    const remeasure = createNodeRemeasureQueue((nodeIds) => writes.push(nodeIds))
    for (let i = 0; i < 1000; i++) remeasure(`n${i}`)
    await Promise.resolve()
    expect(writes.length).toBe(1)
    expect(writes[0]?.length).toBe(1000)
  })
})

describe('one queue per canvas, shared by every part on it', () => {
  test('parts that ask through separate calls still share one write', async () => {
    // Each part calls the hook for ITSELF, so nothing about a caller can be relied on to hold the
    // queue: two calls, one canvas, one write. Making the queue per-call (or per-caller) leaves every
    // other test in this file green and costs the whole saving — measured at 18,224 ms of a 30,846 ms
    // draw (…/repair/t2/prof-blk2000.json).
    const writes: string[][] = []
    const canvas = {}
    sharedRemeasureQueue(canvas, (nodeIds) => writes.push(nodeIds))('a')
    sharedRemeasureQueue(canvas, (nodeIds) => writes.push(nodeIds))('b')
    await Promise.resolve()
    expect(writes).toEqual([['a', 'b']])
  })

  test('a second canvas gets its own queue, and never the first one’s store', async () => {
    // Two project tabs are two React Flow stores. One shared queue for both would hand tab A's ids to
    // whichever store wrote last, and a part would be re-measured against a canvas it is not on.
    const first: string[][] = []
    const second: string[][] = []
    const canvasA = {}
    const canvasB = {}
    sharedRemeasureQueue(canvasA, (nodeIds) => first.push(nodeIds))('a')
    sharedRemeasureQueue(canvasB, (nodeIds) => second.push(nodeIds))('b')
    await Promise.resolve()
    expect(first).toEqual([['a']])
    expect(second).toEqual([['b']])
  })
})

describe('which parts actually have to be re-measured', () => {
  test('only the block whose pins moved — not every block on the canvas', () => {
    const before = new Map([
      ['b1', 'in.left,out.right'],
      ['b2', 'in.left,out.right'],
      ['b3', 'in.left,out.right'],
    ])
    const after = new Map([
      ['b1', 'in.left,out.right'],
      ['b2', 'in.top,out.right'],
      ['b3', 'in.left,out.right'],
    ])
    expect(nodesNeedingRemeasure(before, after)).toEqual(['b2'])
  })

  test('a block that has just arrived is re-measured', () => {
    // This is the case a staged draw is made of: each batch appends parts, and the parts it appends
    // have never been measured. What it must NOT do is re-measure the ones already drawn.
    const before = new Map([['b1', 'in.left']])
    const after = new Map([
      ['b1', 'in.left'],
      ['b2', 'in.left'],
      ['b3', 'in.left'],
    ])
    expect(nodesNeedingRemeasure(before, after)).toEqual(['b2', 'b3'])
  })

  test('a block that has been deleted asks for nothing', () => {
    const before = new Map([
      ['b1', 'in.left'],
      ['b2', 'in.left'],
    ])
    const after = new Map([['b1', 'in.left']])
    expect(nodesNeedingRemeasure(before, after)).toEqual([])
  })

  test('nothing changed, nothing re-measured', () => {
    const signatures = new Map([
      ['b1', 'in.left'],
      ['b2', 'out.right'],
    ])
    expect(nodesNeedingRemeasure(signatures, new Map(signatures))).toEqual([])
  })
})

/**
 * Finding the parts in the DOM without scanning the canvas once per part.
 *
 * React Flow's `useUpdateNodeInternals` resolves each id on its own, with
 * `domNode.querySelector('.react-flow__node[data-id="…"]')` (@xyflow/react/dist/esm/index.js:3830) — an
 * unindexed attribute scan of the whole canvas, run once per id, over a document whose size IS the number
 * of parts. Coalescing the ids into one call does not touch it: that loop is inside the library. Measured
 * on the built app drawing 2,000 grouped blocks / 3,400 wires at grid pitch 10, that is 2,000 distinct
 * selectors in one draw (…/qs/qs-count-b2000w3400p10.json) for 57 ms of `querySelector` self time
 * (…/qs/qs-before-b2000w3400p10.json, `querySelectorByCaller`).
 */

/** A stand-in canvas that counts how many times it is searched, and what for. */
function fakeCanvas(nodeIds: string[]) {
  const elements = nodeIds.map((nodeId) => ({
    getAttribute: (name: string) => (name === 'data-id' ? nodeId : null),
    nodeId,
  }))
  const searchedFor: string[] = []
  return {
    element: {
      querySelectorAll: (selectors: string) => {
        searchedFor.push(selectors)
        return elements as unknown as Iterable<Element>
      },
    },
    searches: () => searchedFor,
  }
}

describe('one pass over the canvas, not one per part', () => {
  test('five hundred parts are found with ONE search of the canvas', () => {
    // Without this the library runs five hundred whole-document attribute scans, and the cost of
    // re-measuring a design grows as the square of its size — the shape that stops this scaling to
    // the processors the project is aimed at, long before the millisecond count does.
    const wanted = Array.from({ length: 500 }, (_, i) => `n${i}`)
    const canvas = fakeCanvas(wanted)
    const found = nodeElementsById(canvas.element, wanted)
    expect(found.size).toBe(500)
    expect(canvas.searches()).toEqual(['.react-flow__node'])
  })

  test('only the parts asked for come back, though the whole canvas was read', () => {
    // One pass reads every part on the canvas, so the filter is what keeps the batch a batch. Losing
    // it would re-measure — and re-render — every part on the canvas whenever any one part moved a pin,
    // which is the N x N this whole file exists to have removed.
    const canvas = fakeCanvas(['a', 'b', 'c', 'd'])
    const found = nodeElementsById(canvas.element, ['b', 'd'])
    expect([...found.keys()]).toEqual(['b', 'd'])
  })

  test('a part that is not on the canvas is simply absent, not a null entry', () => {
    // React Flow measures whatever it is handed. A missing part must drop out of the batch rather than
    // arrive as an entry with no element, exactly as the per-id scan dropped a selector that missed.
    const canvas = fakeCanvas(['a'])
    const found = nodeElementsById(canvas.element, ['a', 'gone'])
    expect([...found.keys()]).toEqual(['a'])
  })

  test('an empty batch does not touch the canvas at all', () => {
    const canvas = fakeCanvas(['a'])
    expect(nodeElementsById(canvas.element, []).size).toBe(0)
    expect(canvas.searches()).toEqual([])
  })

  test('an element with no part id is skipped, not filed under nothing', () => {
    // Reading the canvas in one pass means reading whatever is in it, and what comes back is keyed by
    // the attribute. An element without the attribute must drop out: keeping it files an entry under a
    // key that is not a part id, and React Flow is then handed a part to re-measure that does not exist.
    const canvas = {
      querySelectorAll: () =>
        [
          { getAttribute: () => null },
          { getAttribute: (name: string) => (name === 'data-id' ? 'a' : null) },
        ] as unknown as Iterable<Element>,
    }
    const found = nodeElementsById(canvas, ['a'])
    expect([...found.keys()]).toEqual(['a'])
  })

  test('no canvas yet means nothing found, and nothing thrown', () => {
    expect(nodeElementsById(null, ['a']).size).toBe(0)
  })
})
