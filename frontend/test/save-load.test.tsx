/**
 * Save / load roundtrip tests (Sprint-12 T3).
 *
 * Save path: render <App>, click the Save button, capture the Blob the
 * renderer mints via `URL.createObjectURL`, parse its JSON, and assert
 * the v1 envelope shape + starter graph contents.
 *
 * Load path: render <App>, click Load to trigger file-picker creation,
 * intercept the synthetic <input type="file"> via a `document.createElement`
 * spy, then drive its `onchange` with a fake File whose contents are a
 * known-good (or known-malicious) v1 graph. We assert state via the
 * rendered React Flow nodes after the load completes.
 *
 * The createElement-spy approach was chosen over extracting
 * validateLoadedGraph: the prompt forbids touching `frontend/src/`, and
 * stubbing input.click() would still need a way to feed the synthetic
 * change event. Walking the real onchange handler exercises everything
 * from JSON.parse onward — including validateLoadedGraph from m5.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'

import App from '../src/App'

// jsdom 26's Blob/File don't ship `.text()` / `.arrayBuffer()`. The
// renderer uses Blob to wrap save payloads and File.text() to read
// loaded graphs, so we substitute Node's native implementations from
// `node:buffer` (which do support those methods) for the duration of
// these tests. Restore happens via vi.unstubAllGlobals in setup.ts's
// afterEach.
beforeEach(() => {
  vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal('File', NodeFile)
})

// ---------------------------------------------------------------------------
// Render helpers (mirrors ipc-contract.test.ts pattern)

interface RenderResult {
  container: HTMLElement
  root: Root
  unmount: () => void
}

function render(element: React.ReactElement): RenderResult {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(element)
  })
  return {
    container,
    root,
    unmount: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const buttons = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[]
  const match = buttons.find((b) => b.textContent?.includes(text))
  if (!match) {
    throw new Error(
      `No button matching "${text}". Available: ${buttons.map((b) => `"${b.textContent}"`).join(', ')}`,
    )
  }
  return match
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

// ---------------------------------------------------------------------------
// Save

describe('Save roundtrip', () => {
  it('Save button writes a v1 graph file with the starter Oscillator + Output', async () => {
    // The setup.ts default already mocks URL.createObjectURL to return
    // a sentinel; here we replace it with a per-test spy so we can
    // capture the Blob argument.
    const blobs: Blob[] = []
    const createObjectURLSpy = vi.fn((b: Blob) => {
      blobs.push(b)
      return 'blob:save-roundtrip'
    })
    vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectURLSpy)

    // anchor.click() would attempt navigation under jsdom — stub it.
    const anchorClickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})

    const { container, unmount } = render(React.createElement(App))
    try {
      const saveBtn = findButton(container, 'Save')
      await act(async () => {
        saveBtn.click()
      })
      await flush()

      expect(anchorClickSpy).toHaveBeenCalled()
      expect(blobs.length).toBe(1)
      const text = await blobs[0].text()
      const parsed = JSON.parse(text) as {
        version: number
        app: string
        savedAt: string
        viewport: { x: number; y: number; zoom: number }
        nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>
        edges: Array<{ id: string; source: string; target: string }>
      }
      // v1 envelope shape.
      expect(parsed.version).toBe(1)
      expect(parsed.app).toBe('ChipBlocks')
      expect(typeof parsed.savedAt).toBe('string')
      expect(parsed.viewport).toBeDefined()
      expect(typeof parsed.viewport.zoom).toBe('number')
      // Default starter graph: Oscillator + Output, one edge between them.
      expect(parsed.nodes.length).toBe(2)
      expect(parsed.edges.length).toBe(1)
      const types = parsed.nodes.map((n) => n.type).sort()
      expect(types).toEqual(['oscillator', 'output'])
      const osc = parsed.nodes.find((n) => n.type === 'oscillator')!
      expect(osc.data.freq).toBe(440)
      // Edge wires the osc's audio-out into the output's audio-in.
      const edge = parsed.edges[0]
      expect(edge.source).toBe('starter-osc')
      expect(edge.target).toBe('starter-out')
    } finally {
      unmount()
    }
  })
})

// ---------------------------------------------------------------------------
// Load

/**
 * Build a JSON-shape File-like object that mimics what jsdom's
 * <input type=file> selection produces. We override `text()` ourselves
 * because jsdom's File.text() works but we want the precise contents
 * we hand-crafted.
 */
function makeJsonFile(contents: string): File {
  // Use the standard File constructor with a Blob — jsdom 26 supports
  // both, including .text().
  return new File([contents], 'chipblocks-graph.json', { type: 'application/json' })
}

/**
 * Install a `document.createElement` spy that captures any
 * <input type="file"> the renderer creates. Returns a getter that
 * resolves once the input has been requested + .click()ed.
 */
function captureFileInput(): { getInput: () => Promise<HTMLInputElement> } {
  const originalCreateElement = document.createElement.bind(document)
  let resolveInput: ((el: HTMLInputElement) => void) | null = null
  const inputPromise = new Promise<HTMLInputElement>((resolve) => {
    resolveInput = resolve
  })
  const spy = vi.spyOn(document, 'createElement').mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tagName: string, opts?: any) => {
      const el = originalCreateElement(tagName, opts) as HTMLElement
      if (tagName.toLowerCase() === 'input') {
        const input = el as HTMLInputElement
        // The renderer assigns `input.type = 'file'` AFTER createElement
        // returns, so we hook the click() to detect that this is the
        // file picker rather than some other input.
        const originalClick = input.click.bind(input)
        input.click = () => {
          if (input.type === 'file') {
            // Defer one tick so the renderer has finished setting up
            // .accept and .onchange.
            queueMicrotask(() => resolveInput?.(input))
          } else {
            originalClick()
          }
        }
      }
      return el
    },
  )
  return {
    getInput: async () => {
      const input = await inputPromise
      spy.mockRestore()
      return input
    },
  }
}

describe('Load roundtrip', () => {
  it('Loading a known-good v1 file replaces the canvas with its nodes + edges', async () => {
    const goodGraph = {
      version: 1,
      app: 'ChipBlocks',
      savedAt: '2026-05-08T00:00:00.000Z',
      viewport: { x: 0, y: 0, zoom: 1 },
      // Pick the same shape as examples/two-osc-mix.json so the test
      // reflects a real persisted graph.
      nodes: [
        { id: 'osc1',  type: 'oscillator', position: { x: 50,  y: 60  }, data: { freq: 440 } },
        { id: 'osc2',  type: 'sawtooth',   position: { x: 50,  y: 220 }, data: { freq: 660 } },
        { id: 'mixer', type: 'mixer',      position: { x: 400, y: 130 }, data: {} },
        { id: 'out',   type: 'output',     position: { x: 700, y: 130 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: 'osc1',  target: 'mixer', sourceHandle: 'audio-out', targetHandle: 'in-1' },
        { id: 'e2', source: 'osc2',  target: 'mixer', sourceHandle: 'audio-out', targetHandle: 'in-2' },
        { id: 'e3', source: 'mixer', target: 'out',   sourceHandle: 'mix-out',   targetHandle: 'audio-in' },
      ],
    }
    const { getInput } = captureFileInput()

    const { container, unmount } = render(React.createElement(App))
    try {
      const loadBtn = findButton(container, 'Load')
      await act(async () => {
        loadBtn.click()
      })
      const fileInput = await getInput()
      const file = makeJsonFile(JSON.stringify(goodGraph))
      // Stick a synthetic FileList on the input. The renderer reads
      // `(e.target as HTMLInputElement).files?.[0]`.
      Object.defineProperty(fileInput, 'files', {
        configurable: true,
        get() {
          // Mimic FileList: array-like with .item().
          return {
            0: file,
            length: 1,
            item: (i: number) => (i === 0 ? file : null),
            [Symbol.iterator]: function* () { yield file },
          } as unknown as FileList
        },
      })
      // Drive the renderer's onchange handler. We use
      // dispatchEvent('change') so React's synthetic event wrapping
      // (or the renderer's plain DOM handler in this case) fires.
      await act(async () => {
        fileInput.dispatchEvent(new Event('change', { bubbles: true }))
      })
      // The handler is async (file.text()), so flush twice.
      await flush()
      await flush()

      // Assert the canvas now reflects the loaded graph: React Flow
      // renders each node with class `react-flow__node` and a
      // `data-id` matching the node id.
      const renderedIds = Array.from(
        container.querySelectorAll('.react-flow__node'),
      )
        .map((el) => el.getAttribute('data-id'))
        .filter(Boolean) as string[]
      // Order may differ; sort for stable comparison.
      expect(renderedIds.sort()).toEqual(['mixer', 'osc1', 'osc2', 'out'])

      // No error toast was raised by the validator.
      expect(container.querySelector('[role="alert"]')).toBeNull()
    } finally {
      unmount()
    }
  })

  it('Loading a malicious file (unknown block type) is rejected with an error toast', async () => {
    const malicious = {
      version: 1,
      app: 'ChipBlocks',
      nodes: [
        // `evil` is not in PALETTE — validator should reject before
        // ever calling setNodes / leaking the data into the AI prompt.
        { id: 'x', type: 'evil', position: { x: 0, y: 0 }, data: { sneaky: 'PROMPT_INJECTION' } },
      ],
      edges: [],
    }
    const { getInput } = captureFileInput()

    const { container, unmount } = render(React.createElement(App))
    try {
      const loadBtn = findButton(container, 'Load')
      await act(async () => {
        loadBtn.click()
      })
      const fileInput = await getInput()
      const file = makeJsonFile(JSON.stringify(malicious))
      Object.defineProperty(fileInput, 'files', {
        configurable: true,
        get() {
          return {
            0: file,
            length: 1,
            item: (i: number) => (i === 0 ? file : null),
            [Symbol.iterator]: function* () { yield file },
          } as unknown as FileList
        },
      })
      await act(async () => {
        fileInput.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await flush()
      await flush()

      // The toast carries validateLoadedGraph's "Unknown block type"
      // message. The renderer's error toast lives at role=alert.
      const toast = container.querySelector('[role="alert"]')
      expect(toast).not.toBeNull()
      expect(toast?.textContent).toMatch(/Unknown block type "evil"/)

      // Canvas should still show the starter graph (load was rejected).
      const renderedIds = Array.from(
        container.querySelectorAll('.react-flow__node'),
      )
        .map((el) => el.getAttribute('data-id'))
        .filter(Boolean) as string[]
      expect(renderedIds.sort()).toEqual(['starter-osc', 'starter-out'])
    } finally {
      unmount()
    }
  })

  it('Loading a file with non-primitive data (function valued) is rejected', async () => {
    // JSON can't hold functions, so we send a structurally-valid object
    // with a *nested* data field containing an object — also rejected
    // by isPlainPrimitiveObject(). This catches the second m5 vector.
    const sneaky = {
      version: 1,
      app: 'ChipBlocks',
      nodes: [
        { id: 'osc', type: 'oscillator', position: { x: 0, y: 0 }, data: { freq: { __proto__: { polluted: 1 } } } },
      ],
      edges: [],
    }
    const { getInput } = captureFileInput()

    const { container, unmount } = render(React.createElement(App))
    try {
      const loadBtn = findButton(container, 'Load')
      await act(async () => {
        loadBtn.click()
      })
      const fileInput = await getInput()
      const file = makeJsonFile(JSON.stringify(sneaky))
      Object.defineProperty(fileInput, 'files', {
        configurable: true,
        get() {
          return {
            0: file,
            length: 1,
            item: (i: number) => (i === 0 ? file : null),
            [Symbol.iterator]: function* () { yield file },
          } as unknown as FileList
        },
      })
      await act(async () => {
        fileInput.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await flush()
      await flush()

      const toast = container.querySelector('[role="alert"]')
      expect(toast).not.toBeNull()
      expect(toast?.textContent).toMatch(/invalid data/i)
    } finally {
      unmount()
    }
  })
})
