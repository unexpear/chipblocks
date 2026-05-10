/**
 * LD-accessibility App-level tests (2026-05-10).
 *
 * Covers the renderer-side fixes from
 * `ACCESSIBILITY-AUDIT-LD-2026-05-10.md`:
 *   - Audio volume slider round-trips through localStorage.
 *   - Last-build status persists across an unrelated action (modal
 *     open + close).
 *
 * Per-block label regression tests (ADSR / FM / PixelRange) live in
 * `blocks.test.tsx` next to the existing block-render assertions.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import App from '../src/App'

const AUDIO_VOLUME_KEY = 'chipblocks:audio-volume'
const LAST_BUILD_KEY = 'chipblocks:last-build-result'

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

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  // Ensure each test starts from a clean localStorage so a previous
  // run's stored volume / last-build doesn't leak into a default-state
  // assertion.
  try {
    window.localStorage.clear()
  } catch {
    // jsdom should always provide localStorage; if not, tests will surface.
  }
})

describe('Audio volume slider', () => {
  it('defaults to 50 and persists user-chosen values to localStorage', async () => {
    const { container, unmount } = render(React.createElement(App))
    try {
      const slider = container.querySelector<HTMLInputElement>('input[type="range"][aria-label="Audio output volume"]')
      expect(slider).not.toBeNull()
      expect(slider!.value).toBe('50')

      // Drive the change event the way React listens — set the value
      // through the native setter so React picks up the change.
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!
      await act(async () => {
        nativeSetter.call(slider, '25')
        slider!.dispatchEvent(new Event('input', { bubbles: true }))
        slider!.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await flush()

      // Stored in localStorage as the literal number string.
      expect(window.localStorage.getItem(AUDIO_VOLUME_KEY)).toBe('25')
    } finally {
      unmount()
    }
  })

  it('reads a previously stored volume on mount', async () => {
    window.localStorage.setItem(AUDIO_VOLUME_KEY, '75')
    const { container, unmount } = render(React.createElement(App))
    try {
      const slider = container.querySelector<HTMLInputElement>('input[type="range"][aria-label="Audio output volume"]')
      expect(slider).not.toBeNull()
      expect(slider!.value).toBe('75')
    } finally {
      unmount()
    }
  })
})

describe('Last-build status persistence', () => {
  it('survives an unrelated action (open + close About modal)', async () => {
    // Seed a prior build's outcome so we can verify it stays visible
    // across actions without needing to wire a fake build.
    window.localStorage.setItem(LAST_BUILD_KEY, 'Last build: Bitstream ready (104.1 KB)')

    const { container, unmount } = render(React.createElement(App))
    try {
      // The persisted line shows up in the toolbar on mount.
      const line = container.querySelector('.toolbar-last-build')
      expect(line).not.toBeNull()
      expect(line?.textContent).toMatch(/Bitstream ready/)

      // Open the About modal (unrelated action) — find by aria-label.
      const aboutBtn = container.querySelector<HTMLButtonElement>('button[aria-label="About ChipBlocks"]')
      expect(aboutBtn).not.toBeNull()
      await act(async () => {
        aboutBtn!.click()
      })
      await flush()

      // Close it again. The AboutModal has its own close button — we
      // can dispatch Escape on document to close it cleanly without
      // depending on the modal's internal button text.
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      await flush()

      // The persistent line is still there.
      const after = container.querySelector('.toolbar-last-build')
      expect(after).not.toBeNull()
      expect(after?.textContent).toMatch(/Bitstream ready/)
      // localStorage entry is intact.
      expect(window.localStorage.getItem(LAST_BUILD_KEY)).toBe(
        'Last build: Bitstream ready (104.1 KB)',
      )
    } finally {
      unmount()
    }
  })
})
