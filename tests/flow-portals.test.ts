/**
 * Portalling into React Flow's label layer without asking the DOM where it is, once per wire per check.
 *
 * THE DEFECT. React Flow's `EdgeLabelRenderer` subscribes to its store with the selector
 * `s.domNode?.querySelector('.react-flow__edgelabel-renderer')` (@xyflow/react/dist/esm/index.js:3694),
 * and React re-runs every subscription's selector on every store check. This app mounts one of those per
 * wire that has something to show, so the number of depth-first walks of the whole document is
 * (wires showing a label) x (store checks), each walk growing with the document.
 *
 * Measured on the built app drawing 2,000 grouped blocks / 3,400 wires at grid pitch 10, through the
 * launcher: 295,227 calls of that one selector in a single draw, against a document of 51,700 elements
 * with 3,356 label divs mounted (…/qs/qs-count-b2000w3400p10.json), costing 26,946 ms of the 27,064 ms of
 * native `querySelector` self time in a 45,205 ms draw (…/qs/qs-before-b2000w3400p10.json).
 *
 * The answer cannot change unless the container is replaced, so it is resolved once per canvas and kept.
 * These tests are about the keeping: every one of them fails for a different way of getting it wrong.
 */

import { describe, expect, test } from 'vitest'
import { resolveFlowContainer } from '../src/renderer/flow-portals.tsx'

const LABEL_LAYER = 'react-flow__edgelabel-renderer'
const VIEWPORT_LAYER = 'react-flow__viewport-portal'

type FakeContainer = { isConnected: boolean; name: string }

/** A stand-in for the outer `.react-flow` element that counts how often it is actually searched. */
function fakeFlowElement(containers: Record<string, FakeContainer>) {
  let searches = 0
  return {
    element: {
      querySelector: (selectors: string): FakeContainer | null => {
        searches += 1
        return containers[selectors.replace(/^\./, '')] ?? null
      },
    },
    searches: () => searches,
    replaceContainer: (className: string, next: FakeContainer) => {
      const previous = containers[className]
      if (previous) previous.isConnected = false
      containers[className] = next
    },
  }
}

const container = (name: string): FakeContainer => ({ isConnected: true, name })

describe('the container is found once per canvas, not once per ask', () => {
  test('a thousand wires asking for the label layer search the document ONCE', () => {
    // This is the whole fix. Without the cache this reads 1000, which is the shape that measured
    // 295,227 searches of a 51,700-element document in one draw.
    const flow = fakeFlowElement({ [LABEL_LAYER]: container('labels') })
    for (let i = 0; i < 1000; i++) {
      expect(resolveFlowContainer(flow.element, LABEL_LAYER)?.name).toBe('labels')
    }
    expect(flow.searches()).toBe(1)
  })

  test('two different layers on one canvas are remembered separately', () => {
    // Keying the cache on the canvas alone — forgetting the class name — would hand the viewport
    // portal whatever the label layer resolved to first, and every overlay would render into the
    // wrong layer.
    const flow = fakeFlowElement({
      [LABEL_LAYER]: container('labels'),
      [VIEWPORT_LAYER]: container('viewport'),
    })
    expect(resolveFlowContainer(flow.element, LABEL_LAYER)?.name).toBe('labels')
    expect(resolveFlowContainer(flow.element, VIEWPORT_LAYER)?.name).toBe('viewport')
    expect(resolveFlowContainer(flow.element, LABEL_LAYER)?.name).toBe('labels')
    expect(flow.searches()).toBe(2)
  })
})

describe('what the cache must NOT remember', () => {
  test('a layer that has not been committed yet is not remembered as absent', () => {
    // The first render of every wire happens before React Flow has set `domNode`, and a canvas can be
    // asked before its viewport is committed. Caching that miss would leave the label layer null for
    // the life of the canvas: no lens readouts, no hover chips, no collision markers, ever.
    const containers: Record<string, FakeContainer> = {}
    const flow = fakeFlowElement(containers)
    expect(resolveFlowContainer(flow.element, LABEL_LAYER)).toBe(null)
    containers[LABEL_LAYER] = container('labels')
    expect(resolveFlowContainer(flow.element, LABEL_LAYER)?.name).toBe('labels')
  })

  test('a container that has been replaced is re-found, not handed out stale', () => {
    // React Flow re-uses the outer `.react-flow` element across a remount of its inner viewport, which
    // builds a fresh container div under the same key. Trusting the cached element without checking it
    // is still connected would portal every label into a div that is no longer in the document — the
    // labels would simply stop appearing, with nothing on screen to say why.
    const flow = fakeFlowElement({ [LABEL_LAYER]: container('first') })
    expect(resolveFlowContainer(flow.element, LABEL_LAYER)?.name).toBe('first')
    flow.replaceContainer(LABEL_LAYER, container('second'))
    expect(resolveFlowContainer(flow.element, LABEL_LAYER)?.name).toBe('second')
  })

  test('no canvas at all is null, and is not remembered under some shared key', () => {
    expect(resolveFlowContainer(null, LABEL_LAYER)).toBe(null)
    expect(resolveFlowContainer(undefined, LABEL_LAYER)).toBe(null)
  })
})

describe('one cache per canvas', () => {
  test('a second canvas gets its OWN label layer, never the first one’s', () => {
    // Two project tabs are two React Flow instances. A single cache shared between them would portal
    // tab B's wire labels into tab A's document — they would appear on the wrong canvas.
    const tabA = fakeFlowElement({ [LABEL_LAYER]: container('tab-a-labels') })
    const tabB = fakeFlowElement({ [LABEL_LAYER]: container('tab-b-labels') })
    expect(resolveFlowContainer(tabA.element, LABEL_LAYER)?.name).toBe('tab-a-labels')
    expect(resolveFlowContainer(tabB.element, LABEL_LAYER)?.name).toBe('tab-b-labels')
    expect(resolveFlowContainer(tabA.element, LABEL_LAYER)?.name).toBe('tab-a-labels')
    expect(tabA.searches()).toBe(1)
    expect(tabB.searches()).toBe(1)
  })
})
