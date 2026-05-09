/**
 * IPC contract regression tests.
 *
 * These tests are renderer-side: they mock `window.chipblocks` and
 * `window.ai` (the contextBridge surface defined in
 * frontend/electron/preload/index.ts) and verify that App.tsx and
 * Chat.tsx call the IPC methods with the expected shape, and react
 * correctly to fake responses.
 *
 * What this catches: silently breaking the renderer<->main IPC wire
 * contract — e.g. the renderer renaming a method, dropping a field,
 * or mishandling the success/error envelopes.
 *
 * What this does NOT cover: the actual main-process implementations
 * (those spawn WSL/Anthropic and need an integration harness, out of
 * scope for v1 of this test suite).
 */

import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import App from '../src/App'
import { Chat, type CanvasActions } from '../src/Chat'

// ---------------------------------------------------------------------------
// Helpers

interface RenderResult {
  container: HTMLElement
  root: Root
  unmount: () => void
}

/**
 * Render a React element into a detached container. Returns the
 * container so tests can run queries against it. We avoid
 * @testing-library/react's `render()` here because it pulls in
 * additional act() coordination that conflicts with how Chat.tsx
 * resolves its agentic-loop Promises across event listeners — direct
 * createRoot + act gives us tighter control.
 */
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

/** Find the first <button> whose visible text matches the substring. */
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

/** Wait for a microtask (lets pending Promises resolve). */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

// Anything visible in the toast aria-role=alert region.
function getErrorToastText(container: HTMLElement): string | null {
  const toast = container.querySelector('[role="alert"]')
  return toast ? toast.textContent : null
}

// ---------------------------------------------------------------------------
// Synth IPC

describe('Synth IPC contract', () => {
  it('synth() is called with the current graph when ▶ Play is clicked', async () => {
    // Default starter graph: an oscillator wired to an output. Verify
    // the renderer ships those nodes and edges in the IPC payload.
    const synthSpy = vi.fn(async () => ({ ok: true as const, wavData: new ArrayBuffer(0) }))
    vi.stubGlobal('chipblocks', {
      synth: synthSpy,
      cancel: vi.fn(),
      build: vi.fn(),
      cancelBuild: vi.fn(),
    })

    const { container, unmount } = render(React.createElement(App))
    try {
      const playBtn = findButton(container, '▶ Play')
      await act(async () => {
        playBtn.click()
      })
      await flush()

      expect(synthSpy).toHaveBeenCalledTimes(1)
      const arg = synthSpy.mock.calls[0][0] as { nodes: unknown[]; edges: unknown[] }
      expect(arg).toBeDefined()
      expect(Array.isArray(arg.nodes)).toBe(true)
      expect(Array.isArray(arg.edges)).toBe(true)
      // The starter graph has 2 nodes (osc + out) and 1 edge.
      expect(arg.nodes.length).toBe(2)
      expect(arg.edges.length).toBe(1)
      // Spot-check the shape of an outgoing node.
      const node0 = arg.nodes[0] as { id: string; type: string }
      expect(typeof node0.id).toBe('string')
      expect(typeof node0.type).toBe('string')
    } finally {
      unmount()
    }
  })

  it('synth() failure path surfaces the error in a toast', async () => {
    // The renderer is supposed to suppress the special "Cancelled by user"
    // string but show every other error. Pick an arbitrary string so we
    // can assert it appeared.
    const synthSpy = vi.fn(async () => ({
      ok: false as const,
      error: 'WSL timed out after 60s',
    }))
    vi.stubGlobal('chipblocks', {
      synth: synthSpy,
      cancel: vi.fn(),
      build: vi.fn(),
      cancelBuild: vi.fn(),
    })

    const { container, unmount } = render(React.createElement(App))
    try {
      const playBtn = findButton(container, '▶ Play')
      await act(async () => {
        playBtn.click()
      })
      await flush()
      await flush()

      expect(synthSpy).toHaveBeenCalledTimes(1)
      const toastText = getErrorToastText(container)
      expect(toastText).toBeTruthy()
      expect(toastText).toContain('WSL timed out after 60s')
    } finally {
      unmount()
    }
  })

  it('synth() backend_deps_missing renders an actionable setup toast with code block', async () => {
    // When the main process reports the classified failure mode the
    // renderer should:
    //   - swap the toast label from "Error:" to "Setup needed:"
    //   - render the embedded command in a <code> element so it`s
    //     selectable / triple-clickable for copy
    //   - apply the .error-toast-actionable class so the longer
    //     dwell-time / wider-layout styles kick in.
    const synthSpy = vi.fn(async () => ({
      ok: false as const,
      error:
        "ChipBlocks's Python backend isn't installed yet. Open WSL2 Ubuntu and run: `cd backend && bash setup.sh` (one-time setup; takes ~30 seconds).",
      errorType: 'backend_deps_missing' as const,
    }))
    vi.stubGlobal('chipblocks', {
      synth: synthSpy,
      cancel: vi.fn(),
      build: vi.fn(),
      cancelBuild: vi.fn(),
    })

    const { container, unmount } = render(React.createElement(App))
    try {
      const playBtn = findButton(container, '▶ Play')
      await act(async () => {
        playBtn.click()
      })
      await flush()
      await flush()

      const toast = container.querySelector('[role="alert"]') as HTMLElement
      expect(toast).toBeTruthy()
      expect(toast.className).toContain('error-toast-actionable')
      expect(toast.textContent).toContain('Setup needed:')
      expect(toast.textContent).not.toContain('ModuleNotFoundError')

      const code = toast.querySelector('code')
      expect(code).toBeTruthy()
      expect(code?.textContent).toBe('cd backend && bash setup.sh')
    } finally {
      unmount()
    }
  })

  it('synth() wsl_missing renders an actionable toast with the install command in a code block', async () => {
    const synthSpy = vi.fn(async () => ({
      ok: false as const,
      error:
        "WSL2 (Windows Subsystem for Linux) isn't installed. ChipBlocks's backend runs in WSL2 Ubuntu. Install via: `wsl --install` from PowerShell (admin), reboot, then run `bash backend/setup.sh` in WSL2.",
      errorType: 'wsl_missing' as const,
    }))
    vi.stubGlobal('chipblocks', {
      synth: synthSpy,
      cancel: vi.fn(),
      build: vi.fn(),
      cancelBuild: vi.fn(),
    })

    const { container, unmount } = render(React.createElement(App))
    try {
      const playBtn = findButton(container, '▶ Play')
      await act(async () => {
        playBtn.click()
      })
      await flush()
      await flush()

      const toast = container.querySelector('[role="alert"]') as HTMLElement
      expect(toast).toBeTruthy()
      expect(toast.className).toContain('error-toast-actionable')
      // wsl_missing messages have multiple backtick spans; ensure the
      // splitter rendered each as its own <code>.
      const codes = Array.from(toast.querySelectorAll('code')).map((c) => c.textContent)
      expect(codes).toContain('wsl --install')
      expect(codes).toContain('bash backend/setup.sh')
    } finally {
      unmount()
    }
  })

  it('build() oss_cad_suite_missing renders an actionable toast', async () => {
    const buildSpy = vi.fn(async () => ({
      ok: false as const,
      error:
        "The OSS CAD Suite (Yosys + nextpnr + icepack) isn't installed in WSL2. Required for FPGA builds. Download from https://github.com/YosysHQ/oss-cad-suite-build/releases and extract to ~/oss-cad-suite/ in WSL2.",
      errorType: 'oss_cad_suite_missing' as const,
    }))
    vi.stubGlobal('chipblocks', {
      synth: vi.fn(),
      cancel: vi.fn(),
      build: buildSpy,
      cancelBuild: vi.fn(),
    })

    const { container, unmount } = render(React.createElement(App))
    try {
      const buildBtn = findButton(container, '🔧 Build ▾')
      await act(async () => {
        buildBtn.click()
      })
      await flush()
      const icestickItem = findButton(container, 'Lattice iCEstick')
      await act(async () => {
        icestickItem.click()
      })
      await flush()
      await flush()

      const toast = container.querySelector('[role="alert"]') as HTMLElement
      expect(toast).toBeTruthy()
      expect(toast.className).toContain('error-toast-actionable')
      // The OSS CAD message has no backticks (path + URL only) — the
      // body still renders, just without a <code> child.
      expect(toast.textContent).toContain('OSS CAD Suite')
      expect(toast.textContent).toContain('oss-cad-suite-build/releases')
    } finally {
      unmount()
    }
  })
})

// ---------------------------------------------------------------------------
// Build IPC

describe('Build IPC contract', () => {
  it('build() is called with the current graph + iCEstick target when picked from the menu', async () => {
    const buildSpy = vi.fn(async () => ({ ok: true as const, zipData: new ArrayBuffer(8) }))
    vi.stubGlobal('chipblocks', {
      synth: vi.fn(),
      cancel: vi.fn(),
      build: buildSpy,
      cancelBuild: vi.fn(),
    })

    // Stub anchor.click so our jsdom doesn't try to navigate when the
    // renderer triggers a download.
    const anchorClickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})

    const { container, unmount } = render(React.createElement(App))
    try {
      // Open the build-target popover, then click the iCEstick entry.
      const buildBtn = findButton(container, '🔧 Build ▾')
      await act(async () => {
        buildBtn.click()
      })
      await flush()
      const icestickItem = findButton(container, 'Lattice iCEstick')
      await act(async () => {
        icestickItem.click()
      })
      await flush()

      expect(buildSpy).toHaveBeenCalledTimes(1)
      const [graphArg, targetArg] = buildSpy.mock.calls[0] as [
        { nodes: unknown[]; edges: unknown[] },
        string,
      ]
      expect(Array.isArray(graphArg.nodes)).toBe(true)
      expect(Array.isArray(graphArg.edges)).toBe(true)
      expect(targetArg).toBe('icestick')
      // After a successful build, the renderer should have minted a Blob
      // URL and clicked the download anchor.
      expect(URL.createObjectURL).toHaveBeenCalled()
      expect(anchorClickSpy).toHaveBeenCalled()
    } finally {
      unmount()
    }
  })

  it('build() failure surfaces the error in a toast', async () => {
    const buildSpy = vi.fn(async () => ({
      ok: false as const,
      error: 'yosys: command not found',
    }))
    vi.stubGlobal('chipblocks', {
      synth: vi.fn(),
      cancel: vi.fn(),
      build: buildSpy,
      cancelBuild: vi.fn(),
    })

    const { container, unmount } = render(React.createElement(App))
    try {
      const buildBtn = findButton(container, '🔧 Build ▾')
      await act(async () => {
        buildBtn.click()
      })
      await flush()
      const icestickItem = findButton(container, 'Lattice iCEstick')
      await act(async () => {
        icestickItem.click()
      })
      await flush()
      await flush()

      expect(buildSpy).toHaveBeenCalledTimes(1)
      const toastText = getErrorToastText(container)
      expect(toastText).toBeTruthy()
      expect(toastText).toContain('yosys: command not found')
    } finally {
      unmount()
    }
  })
})

// ---------------------------------------------------------------------------
// AI IPC

describe('AI IPC contract', () => {
  // Lets a test receive a reference to the (id, text) chunk emitter the
  // Chat component registered via window.ai.onDone() etc. When we mock
  // ai.chat, we use these references to fake a streaming response.
  interface Emitters {
    chunk?: (d: { id: string; text: string }) => void
    done?: (d: {
      id: string
      usage: { input: number; output: number }
      tool_calls?: { id: string; name: string; input: Record<string, unknown> }[]
    }) => void
    error?: (d: { id: string; message: string }) => void
  }

  function setupAi(emitters: Emitters, chatImpl?: (req: unknown) => Promise<boolean>) {
    const ai = {
      saveKey: vi.fn(async () => true),
      hasKey: vi.fn(async () => true),
      clearKey: vi.fn(async () => true),
      chat: chatImpl ? vi.fn(chatImpl) : vi.fn(async () => true),
      cancel: vi.fn(async () => true),
      onChunk: vi.fn((cb: (d: { id: string; text: string }) => void) => {
        emitters.chunk = cb
        return () => {
          emitters.chunk = undefined
        }
      }),
      onDone: vi.fn(
        (
          cb: (d: {
            id: string
            usage: { input: number; output: number }
            tool_calls?: { id: string; name: string; input: Record<string, unknown> }[]
          }) => void,
        ) => {
          emitters.done = cb
          return () => {
            emitters.done = undefined
          }
        },
      ),
      onError: vi.fn((cb: (d: { id: string; message: string }) => void) => {
        emitters.error = cb
        return () => {
          emitters.error = undefined
        }
      }),
    }
    vi.stubGlobal('ai', ai)
    return ai
  }

  function noopCanvasActions(): CanvasActions {
    return {
      addNode: vi.fn(() => 'node-1'),
      addEdge: vi.fn(() => 'edge-1'),
      updateNodeData: vi.fn(() => true),
      deleteNode: vi.fn(() => 0),
      deleteEdge: vi.fn(() => true),
    }
  }

  it('ai.chat() is called with system + messages + tools when Send is clicked', async () => {
    const emitters: Emitters = {}
    const ai = setupAi(emitters)

    const canvasActions = noopCanvasActions()
    const { container, unmount } = render(
      React.createElement(Chat, {
        nodes: [
          { id: 'osc', type: 'oscillator', position: { x: 0, y: 0 }, data: { freq: 440 } },
        ] as never,
        edges: [],
        hasApiKey: true,
        canvasActions,
        onClose: () => {},
        onOpenSettings: () => {},
      }),
    )
    try {
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement
      expect(textarea).toBeTruthy()
      // Set the textarea value via the React-controlled path.
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value',
        )?.set
        setter?.call(textarea, 'add a low-pass filter')
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
      })

      const sendBtn = findButton(container, 'Send')
      await act(async () => {
        sendBtn.click()
      })
      await flush()

      expect(ai.chat).toHaveBeenCalledTimes(1)
      const req = ai.chat.mock.calls[0][0] as {
        id: string
        model?: string
        messages: { role: string; content: unknown }[]
        system: { type: string; text: string }[]
        tools?: unknown[]
      }
      // Contract assertions: shape that the main-process handler relies on.
      expect(typeof req.id).toBe('string')
      expect(req.id.length).toBeGreaterThan(0)
      expect(Array.isArray(req.messages)).toBe(true)
      expect(req.messages.length).toBeGreaterThan(0)
      expect(req.messages[req.messages.length - 1]).toMatchObject({
        role: 'user',
        content: 'add a low-pass filter',
      })
      expect(Array.isArray(req.system)).toBe(true)
      expect(req.system.length).toBeGreaterThan(0)
      expect(req.system[0]).toMatchObject({ type: 'text' })
      expect(typeof req.system[0].text).toBe('string')
      expect(req.system[0].text.length).toBeGreaterThan(0)
      expect(Array.isArray(req.tools)).toBe(true)
      expect((req.tools as unknown[]).length).toBeGreaterThan(0)

      // Clean up the in-flight stream by emitting done so React doesn't
      // log "act() warning: state update after unmount".
      await act(async () => {
        emitters.done?.({ id: req.id, usage: { input: 1, output: 1 } })
      })
      await flush()
    } finally {
      unmount()
    }
  })

  it('ai.chat() done with tool_calls applies the tool to the canvas', async () => {
    // The agentic loop should: after receiving a tool_use block in the
    // done event, call the matching CanvasActions method. Verify by
    // sending a single add_node tool call and asserting addNode fires.
    const emitters: Emitters = {}
    const ai = setupAi(emitters)

    const canvasActions = noopCanvasActions()
    const { container, unmount } = render(
      React.createElement(Chat, {
        nodes: [],
        edges: [],
        hasApiKey: true,
        canvasActions,
        onClose: () => {},
        onOpenSettings: () => {},
      }),
    )
    try {
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value',
        )?.set
        setter?.call(textarea, 'add an oscillator please')
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
      })

      const sendBtn = findButton(container, 'Send')
      await act(async () => {
        sendBtn.click()
      })
      await flush()

      expect(ai.chat).toHaveBeenCalledTimes(1)
      const firstCall = ai.chat.mock.calls[0][0] as { id: string }
      const reqId1 = firstCall.id

      // Simulate the model finishing its first turn by emitting a single
      // add_node tool call. This drives the agentic loop to apply the
      // tool, then send a follow-up turn carrying the tool_result.
      await act(async () => {
        emitters.done?.({
          id: reqId1,
          usage: { input: 10, output: 5 },
          tool_calls: [
            {
              id: 'toolu_1',
              name: 'add_node',
              input: { type: 'oscillator' },
            },
          ],
        })
      })
      await flush()

      // After applying the tool, the renderer kicks off the second turn
      // (tool_result follow-up). End that one as a no-op so the loop
      // terminates naturally.
      if (ai.chat.mock.calls.length > 1) {
        const secondCall = ai.chat.mock.calls[1][0] as { id: string }
        await act(async () => {
          emitters.done?.({ id: secondCall.id, usage: { input: 0, output: 0 } })
        })
        await flush()
      }

      // The headline assertion: addNode was invoked with the type the
      // model asked for.
      expect(canvasActions.addNode).toHaveBeenCalledTimes(1)
      expect(canvasActions.addNode).toHaveBeenCalledWith(
        'oscillator',
        undefined,
      )
    } finally {
      unmount()
    }
  })
})
