/**
 * The home screen and every project tab stay mounted, and they all hear the same window events.
 * Only the screen on display may open Shortcuts or the Content Manager, and a rebind has to
 * reach every screen at once — each screen used to keep the keys it read when it mounted.
 *
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  commitKeybinds,
  ensureKeybindsLoaded,
  getKeybinds,
  resetKeybindStore,
  subscribeKeybinds,
} from '../src/renderer/keybind-store.ts'
import { DEFAULT_KEYBINDS } from '../src/renderer/keybinds.ts'
import { useContentManager } from '../src/renderer/use-content-manager.tsx'
import { useShortcuts } from '../src/renderer/use-shortcuts.tsx'

const reactGlobals = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
const previousActFlag = reactGlobals.IS_REACT_ACT_ENVIRONMENT
reactGlobals.IS_REACT_ACT_ENVIRONMENT = true
afterAll(() => {
  if (previousActFlag === undefined) delete reactGlobals.IS_REACT_ACT_ENVIRONMENT
  else reactGlobals.IS_REACT_ACT_ENVIRONMENT = previousActFlag
})

function text(id: string): string {
  return document.querySelector(`[data-testid="${id}"]`)?.textContent ?? ''
}

function Screen({ active, name }: { active: boolean; name: string }): ReactNode {
  const shortcuts = useShortcuts(false, active)
  const content = useContentManager(false, active)
  return createElement(
    'section',
    { 'data-screen': name },
    createElement('span', { 'data-testid': `${name}-bind` }, shortcuts.keybinds.shortcutsPanel),
    createElement(
      'span',
      { 'data-testid': `${name}-shortcuts` },
      shortcuts.isOpen ? 'open' : 'closed',
    ),
    createElement('span', { 'data-testid': `${name}-content` }, content.isOpen ? 'open' : 'closed'),
    shortcuts.panel,
    content.panel,
  )
}

function Pair({ active }: { active: 'home' | 'project' }): ReactNode {
  return createElement(
    'div',
    null,
    createElement(Screen, { name: 'home', active: active === 'home' }),
    createElement(Screen, { name: 'project', active: active === 'project' }),
  )
}

describe('shared key bindings', () => {
  beforeEach(() => {
    resetKeybindStore()
    Reflect.deleteProperty(window, 'chipblocks')
  })

  test('a rebind updates every subscriber and is written through the bridge', () => {
    const seen: string[][] = [[], []]
    subscribeKeybinds((binds) => {
      seen[0]?.push(binds.shortcutsPanel)
    })
    subscribeKeybinds((binds) => {
      seen[1]?.push(binds.shortcutsPanel)
    })
    const written: string[] = []
    window.chipblocks = {
      setKeybinds: (binds: Record<string, string>) => {
        written.push(binds.shortcutsPanel ?? '')
        return Promise.resolve(binds)
      },
    } as unknown as NonNullable<Window['chipblocks']>

    commitKeybinds({ ...DEFAULT_KEYBINDS, shortcutsPanel: 'Ctrl+J' })

    expect(seen[0]).toEqual(['Ctrl+J'])
    expect(seen[1]).toEqual(['Ctrl+J'])
    expect(getKeybinds().shortcutsPanel).toBe('Ctrl+J')
    expect(written).toEqual(['Ctrl+J'])
  })

  test('a file read that finishes after a rebind does not put the old key back', async () => {
    let finishRead: (saved: Record<string, string>) => void = () => {}
    window.chipblocks = {
      getKeybinds: () =>
        new Promise((resolve) => {
          finishRead = resolve
        }),
      setKeybinds: (binds: Record<string, string>) => Promise.resolve(binds),
    } as unknown as NonNullable<Window['chipblocks']>

    ensureKeybindsLoaded()
    commitKeybinds({ ...DEFAULT_KEYBINDS, shortcutsPanel: 'Ctrl+J' })
    finishRead({ shortcutsPanel: 'Ctrl+K' })
    await Promise.resolve()

    expect(getKeybinds().shortcutsPanel).toBe('Ctrl+J')
  })
})

describe('only the screen on display opens a panel', () => {
  let root: Root
  let container: HTMLDivElement
  const written: string[] = []

  beforeEach(() => {
    resetKeybindStore()
    written.length = 0
    window.chipblocks = {
      getKeybinds: async () => ({ shortcutsPanel: 'Ctrl+M' }),
      setKeybinds: (binds: Record<string, string>) => {
        written.push(binds.shortcutsPanel ?? '')
        return Promise.resolve(binds)
      },
    } as unknown as NonNullable<Window['chipblocks']>
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    resetKeybindStore()
    Reflect.deleteProperty(window, 'chipblocks')
  })

  async function show(active: 'home' | 'project'): Promise<void> {
    await act(async () => {
      root.render(createElement(Pair, { active }))
    })
  }

  test('the shortcuts and content-manager events open on the active screen only', async () => {
    await show('project')
    await act(async () => {
      window.dispatchEvent(new Event('chipblocks:shortcuts'))
      window.dispatchEvent(new Event('chipblocks:content-manager'))
    })

    expect(text('project-shortcuts')).toBe('open')
    expect(text('home-shortcuts')).toBe('closed')
    expect(text('project-content')).toBe('open')
    expect(text('home-content')).toBe('closed')
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2)
  })

  test('closing the content manager does not leave it open on the home screen', async () => {
    await show('project')
    await act(async () => {
      window.dispatchEvent(new Event('chipblocks:content-manager'))
    })
    const close = document.querySelector('[aria-label="Plugin and Content Manager"] button')
    if (!(close instanceof HTMLButtonElement)) throw new Error('content manager close missing')
    await act(async () => {
      close.click()
    })
    await show('home')

    expect(text('project-content')).toBe('closed')
    expect(text('home-content')).toBe('closed')
    expect(document.querySelector('[data-testid="content-manager-status"]')).toBeNull()
  })

  test('rebinding the shortcuts key on one screen shows up on the other, and is saved', async () => {
    await show('project')
    await act(async () => {
      await Promise.resolve()
    })
    expect(text('project-bind')).toBe('Ctrl+M')
    expect(text('home-bind')).toBe('Ctrl+M')

    await act(async () => {
      window.dispatchEvent(new Event('chipblocks:shortcuts'))
    })
    const change = document.querySelector('[data-action="shortcutsPanel"] button')
    if (!(change instanceof HTMLButtonElement)) throw new Error('shortcuts change button missing')
    await act(async () => {
      change.click()
    })
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true, cancelable: true }),
      )
    })

    expect(text('project-bind')).toBe('Ctrl+J')
    expect(text('home-bind')).toBe('Ctrl+J')
    expect(written).toContain('Ctrl+J')

    await show('home')
    await act(async () => {
      window.dispatchEvent(new Event('chipblocks:shortcuts'))
    })
    const homeRow = document.querySelector('[data-screen="home"] [data-action="shortcutsPanel"]')
    expect(homeRow?.getAttribute('data-binding')).toBe('Ctrl+J')
    expect(text('project-shortcuts')).toBe('closed')
    expect(text('home-shortcuts')).toBe('open')
  })
})
