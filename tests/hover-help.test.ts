/**
 * Hover help: when a tip appears, how it is wired for the keyboard and for
 * assistive tech, and that a rebind shows up in the tip.
 *
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { resetHoverHelpStore, setHoverHelpMode } from '../src/renderer/hover-help-pref.ts'
import {
  createHoverSession,
  HOVER_SHOW_DELAY_MS,
  HOVER_WARM_MS,
} from '../src/renderer/hover-session.ts'
import { commitKeybinds, resetKeybindStore } from '../src/renderer/keybind-store.ts'
import { DEFAULT_KEYBINDS } from '../src/renderer/keybinds.ts'
import { HelpTip, HoverHelpProvider, placeTooltip, TOOLTIP_ID } from '../src/renderer/tooltip.tsx'

const reactGlobals = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
const previousActFlag = reactGlobals.IS_REACT_ACT_ENVIRONMENT
reactGlobals.IS_REACT_ACT_ENVIRONMENT = true
afterAll(() => {
  if (previousActFlag === undefined) delete reactGlobals.IS_REACT_ACT_ENVIRONMENT
  else reactGlobals.IS_REACT_ACT_ENVIRONMENT = previousActFlag
})

function tipName(): string {
  return document.querySelector('[data-testid="tooltip-name"]')?.textContent ?? ''
}

function mount(node: ReactNode): { root: Root; host: HTMLDivElement } {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(node)
  })
  return { root, host }
}

function pointerOver(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  })
}

function pointerOut(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
  })
}

describe('placeTooltip', () => {
  test('prefers below, flips above when the bottom edge is too close, and clamps into the screen', () => {
    const tip = { width: 100, height: 40 }
    const view = { width: 200, height: 200 }
    const below = placeTooltip({ left: 50, top: 20, width: 40, height: 20 }, tip, view)
    expect(below.top).toBeGreaterThan(40)
    const flipped = placeTooltip({ left: 50, top: 170, width: 40, height: 20 }, tip, view)
    expect(flipped.top).toBeLessThan(170)
    const clamped = placeTooltip(
      { left: -40, top: -40, width: 10, height: 10 },
      { width: 80, height: 30 },
      view,
    )
    expect(clamped.left).toBeGreaterThanOrEqual(8)
    expect(clamped.top).toBeGreaterThanOrEqual(8)
    expect(clamped.left + 80).toBeLessThanOrEqual(view.width - 8)
    expect(clamped.top + 30).toBeLessThanOrEqual(view.height - 8)
  })
})

describe('hover session', () => {
  test('the first hover waits, and the next neighbour opens at once', () => {
    let now = 1000
    const pending: { at: number; fn: () => void; dead: boolean }[] = []
    let shown: string | null = null
    const session = createHoverSession({
      now: () => now,
      schedule: (ms, fn) => {
        const timer = { at: now + ms, fn, dead: false }
        pending.push(timer)
        return () => {
          timer.dead = true
        }
      },
      onChange: () => {
        shown = session.shown?.helpId ?? null
      },
    })
    const anchor = document.createElement('button')
    session.enter({ key: 'a', helpId: 'tool.wire', anchor })
    expect(shown).toBeNull()
    expect(session.pendingKey).toBe('a')
    now += HOVER_SHOW_DELAY_MS - 1
    for (const timer of pending) {
      if (!timer.dead && timer.at <= now) {
        timer.dead = true
        timer.fn()
      }
    }
    expect(shown).toBeNull()
    now += 1
    for (const timer of pending) {
      if (!timer.dead && timer.at <= now) {
        timer.dead = true
        timer.fn()
      }
    }
    expect(shown).toBe('tool.wire')
    session.leave('a')
    expect(session.shown).toBeNull()
    now += 10
    expect(now).toBeLessThan(1000 + HOVER_SHOW_DELAY_MS + HOVER_WARM_MS)
    session.enter({ key: 'b', helpId: 'tool.meter', anchor })
    expect(session.shown?.helpId).toBe('tool.meter')
    expect(session.pendingKey).toBeNull()
  })

  test('Escape closes the tip and the next hover waits again', () => {
    const now = 0
    const session = createHoverSession({
      now: () => now,
      schedule: () => () => {},
      onChange: () => {},
    })
    const anchor = document.createElement('button')
    session.focus({ key: 'a', helpId: 'tool.wire', anchor })
    expect(session.shown?.helpId).toBe('tool.wire')
    session.escape()
    expect(session.shown).toBeNull()
    session.enter({ key: 'b', helpId: 'tool.meter', anchor })
    expect(session.shown).toBeNull()
    expect(session.pendingKey).toBe('b')
  })
})

describe('hover help on a control', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    resetHoverHelpStore()
    resetKeybindStore()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  test('focus shows the tip immediately, Escape hides it, and the tip is described', () => {
    const { root } = mount(
      createElement(
        HoverHelpProvider,
        null,
        createElement(
          HelpTip,
          { helpId: 'tool.wire' },
          createElement('button', { type: 'button' }, 'Wire'),
        ),
      ),
    )
    const button = document.querySelector('button')
    if (button === null) throw new Error('button missing')
    act(() => {
      button.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    })
    const tip = document.querySelector('[data-testid="tooltip"]')
    expect(tip?.getAttribute('role')).toBe('tooltip')
    expect(tip?.id).toBe(TOOLTIP_ID)
    expect(button.getAttribute('aria-describedby')).toContain(TOOLTIP_ID)
    expect(tipName()).toBe('Wire')
    expect(
      document.querySelector('[data-testid="tooltip-summary"]')?.textContent?.length,
    ).toBeGreaterThan(0)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.querySelector('[data-testid="tooltip"]')).toBeNull()
    expect(button.getAttribute('aria-describedby')).toBeNull()
    act(() => {
      root.unmount()
    })
  })

  test('a disabled button still explains why, through the wrapper', () => {
    const { root } = mount(
      createElement(
        HoverHelpProvider,
        null,
        createElement(
          HelpTip,
          {
            helpId: 'pcb.exportZip',
            detail: "The board isn't manufacturable yet: no parts on the board",
          },
          createElement('button', { type: 'button', disabled: true }, 'Export ZIP'),
        ),
      ),
    )
    const wrap = document.querySelector('[data-help-id="pcb.exportZip"]')
    const button = document.querySelector('button')
    if (wrap === null || button === null) throw new Error('disabled wrapper missing')
    expect(button.disabled).toBe(true)
    pointerOver(wrap)
    expect(document.querySelector('[data-testid="tooltip"]')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(HOVER_SHOW_DELAY_MS)
    })
    expect(tipName()).toBe('Export ZIP')
    expect(document.querySelector('[data-testid="tooltip-detail"]')?.textContent).toContain(
      "isn't manufacturable yet",
    )
    pointerOut(wrap)
    expect(document.querySelector('[data-testid="tooltip"]')).toBeNull()
    act(() => {
      root.unmount()
    })
  })

  test('the shortcut in the tip follows a rebind', () => {
    const { root } = mount(
      createElement(
        HoverHelpProvider,
        null,
        createElement(
          HelpTip,
          { helpId: 'tool.wire' },
          createElement('button', { type: 'button' }, 'Wire'),
        ),
      ),
    )
    const button = document.querySelector('button')
    if (button === null) throw new Error('button missing')
    act(() => {
      button.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    })
    expect(document.querySelector('[data-testid="tooltip-shortcut"]')?.textContent).toBe('Escape')
    act(() => {
      commitKeybinds({ ...DEFAULT_KEYBINDS, cancelWire: 'F9' })
    })
    expect(document.querySelector('[data-testid="tooltip-shortcut"]')?.textContent).toBe('F9')
    act(() => {
      root.unmount()
    })
  })

  test('brief keeps the name and drops the sentence; off shows nothing', () => {
    const { root } = mount(
      createElement(
        HoverHelpProvider,
        null,
        createElement(
          HelpTip,
          { helpId: 'tool.wire' },
          createElement('button', { type: 'button' }, 'Wire'),
        ),
      ),
    )
    const button = document.querySelector('button')
    if (button === null) throw new Error('button missing')
    act(() => {
      setHoverHelpMode('brief')
    })
    act(() => {
      button.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    })
    expect(tipName()).toBe('Wire')
    expect(document.querySelector('[data-testid="tooltip-summary"]')).toBeNull()
    act(() => {
      setHoverHelpMode('off')
    })
    expect(document.querySelector('[data-testid="tooltip"]')).toBeNull()
    act(() => {
      root.unmount()
    })
  })

  test('moving from one control to the next skips the wait once a tip has been shown', () => {
    const { root } = mount(
      createElement(
        HoverHelpProvider,
        null,
        createElement(
          HelpTip,
          { helpId: 'tool.wire' },
          createElement('button', { type: 'button', id: 'wire' }, 'Wire'),
        ),
        createElement(
          HelpTip,
          { helpId: 'tool.meter' },
          createElement('button', { type: 'button', id: 'meter' }, 'Meter'),
        ),
      ),
    )
    const wire = document.getElementById('wire')
    const meter = document.getElementById('meter')
    if (wire === null || meter === null) throw new Error('buttons missing')
    pointerOver(wire)
    expect(tipName()).toBe('')
    act(() => {
      vi.advanceTimersByTime(HOVER_SHOW_DELAY_MS)
    })
    expect(tipName()).toBe('Wire')
    pointerOut(wire)
    pointerOver(meter)
    expect(tipName()).toBe('Meter')
    act(() => {
      root.unmount()
    })
  })
})
