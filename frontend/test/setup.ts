/**
 * Global test setup. Vitest loads this before each test file.
 *
 * Stubs the IPC surface (`window.chipblocks`, `window.ai`,
 * `window.ipcRenderer`) with no-op vi.fn() spies so the renderer can be
 * imported and rendered without a real preload script. Individual tests
 * override specific methods via `vi.mocked(...)` or by reassigning
 * properties to add per-test resolve/reject behavior.
 *
 * Also installs minimal jsdom polyfills the renderer reaches for that
 * are not provided out-of-the-box (URL.createObjectURL, ResizeObserver,
 * matchMedia).
 */

import { afterEach, beforeEach, vi } from 'vitest'

// Tell React 18+ that we're in a test environment so act() warnings
// stop firing. Must run before any test imports React's render path.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// React Flow uses ResizeObserver for measuring nodes. jsdom 26 doesn't
// ship one, so provide a stub.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// matchMedia is read by some component libraries; jsdom doesn't ship one.
function matchMediaStub() {
  return {
    matches: false,
    media: '',
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.stubGlobal('matchMedia', matchMediaStub)

  // URL.createObjectURL / revokeObjectURL — jsdom doesn't implement these
  // but App.tsx uses them when wrapping WAV/zip ArrayBuffers for download.
  if (typeof URL.createObjectURL !== 'function') {
    URL.createObjectURL = vi.fn(() => 'blob:mock-url')
  } else {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url')
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    URL.revokeObjectURL = vi.fn()
  } else {
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  }

  // jsdom doesn't implement HTMLMediaElement.play. App.tsx calls it on
  // synth success; without a stub, jsdom logs a noisy "Not implemented"
  // warning to stderr.
  if (typeof HTMLMediaElement !== 'undefined') {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
  }

  // crypto.randomUUID — jsdom 26 may not provide one; Chat.tsx uses it
  // to mint per-request ids.
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        ...(globalThis.crypto ?? {}),
        randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2),
      },
    })
  }

  // Default: every IPC method exists as a vi.fn that resolves to a sensible
  // empty value. Tests override individual methods as needed.
  vi.stubGlobal('chipblocks', {
    synth: vi.fn(async () => ({ ok: true })),
    cancel: vi.fn(async () => true),
    build: vi.fn(async () => ({ ok: true })),
    cancelBuild: vi.fn(async () => true),
  })

  vi.stubGlobal('ai', {
    saveKey: vi.fn(async () => true),
    hasKey: vi.fn(async () => true),
    clearKey: vi.fn(async () => true),
    chat: vi.fn(async () => true),
    cancel: vi.fn(async () => true),
    onChunk: vi.fn(() => () => {}),
    onDone: vi.fn(() => () => {}),
    onError: vi.fn(() => () => {}),
  })

  vi.stubGlobal('ipcRenderer', {
    on: vi.fn(),
    off: vi.fn(),
    send: vi.fn(),
    invoke: vi.fn(async () => undefined),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})
