/**
 * Keybind tests (S19-v3-62) — the pure logic behind the Shortcuts panel:
 * normalizing key presses into combo strings, matching live events against
 * stored combos, merging saved files honestly, and the two safety rules
 * (menu accelerators need a modifier; no two actions share a combo).
 */

import { describe, expect, test } from 'vitest'
import {
  bindingFromEvent,
  bindingProblem,
  DEFAULT_KEYBINDS,
  eventMatchesBinding,
  FIXED_CONTROLS,
  KEYBIND_LABELS,
  mergeKeybinds,
} from '../src/renderer/keybinds.ts'

describe('bindingFromEvent', () => {
  test('letters normalize to uppercase', () => {
    expect(bindingFromEvent({ key: 'r' })).toBe('R')
  })
  test('modifiers prefix in Ctrl+Alt+Shift order', () => {
    expect(bindingFromEvent({ key: 's', ctrlKey: true, shiftKey: true })).toBe('Ctrl+Shift+S')
    expect(bindingFromEvent({ key: 'k', ctrlKey: true, altKey: true })).toBe('Ctrl+Alt+K')
  })
  test('named keys pass through; space gets a name', () => {
    expect(bindingFromEvent({ key: 'Delete' })).toBe('Delete')
    expect(bindingFromEvent({ key: ' ' })).toBe('Space')
  })
  test('a pure modifier press is not a binding', () => {
    expect(bindingFromEvent({ key: 'Control', ctrlKey: true })).toBeNull()
    expect(bindingFromEvent({ key: 'Shift', shiftKey: true })).toBeNull()
  })
})

describe('eventMatchesBinding', () => {
  test('matches the default rotate key case-insensitively', () => {
    expect(eventMatchesBinding({ key: 'r' }, DEFAULT_KEYBINDS.rotate)).toBe(true)
    expect(eventMatchesBinding({ key: 'R', shiftKey: true }, DEFAULT_KEYBINDS.rotate)).toBe(false)
  })
  test('modifier combos must match exactly', () => {
    expect(eventMatchesBinding({ key: 's', ctrlKey: true }, 'Ctrl+S')).toBe(true)
    expect(eventMatchesBinding({ key: 's', ctrlKey: true, shiftKey: true }, 'Ctrl+S')).toBe(false)
    expect(eventMatchesBinding({ key: 's' }, 'Ctrl+S')).toBe(false)
  })
})

describe('mergeKeybinds', () => {
  test('a broken file degrades to the defaults instead of breaking input', () => {
    expect(mergeKeybinds(null)).toEqual(DEFAULT_KEYBINDS)
    expect(mergeKeybinds('garbage')).toEqual(DEFAULT_KEYBINDS)
    expect(mergeKeybinds({ rotate: 42 })).toEqual(DEFAULT_KEYBINDS)
  })
  test('valid saved entries override; missing ones stay default', () => {
    const merged = mergeKeybinds({ rotate: 'T', unknown_action: 'X' })
    expect(merged.rotate).toBe('T')
    expect(merged.delete).toBe(DEFAULT_KEYBINDS.delete)
    expect('unknown_action' in merged).toBe(false)
  })
})

describe('bindingProblem', () => {
  test('menu shortcuts must carry Ctrl or Alt', () => {
    expect(bindingProblem(DEFAULT_KEYBINDS, 'saveCircuit', 'S')).toContain('Ctrl or Alt')
    expect(bindingProblem(DEFAULT_KEYBINDS, 'saveCircuit', 'Ctrl+Alt+S')).toBeNull()
  })
  test('canvas keys may be bare', () => {
    expect(bindingProblem(DEFAULT_KEYBINDS, 'rotate', 'T')).toBeNull()
  })
  test('two actions cannot share a combo', () => {
    const problem = bindingProblem(DEFAULT_KEYBINDS, 'rotate', 'Delete')
    expect(problem).toContain(KEYBIND_LABELS.delete)
  })
})

describe('the Shortcuts panel inventory', () => {
  test('every rebindable action has a plain-English label', () => {
    for (const action of Object.keys(DEFAULT_KEYBINDS)) {
      expect(KEYBIND_LABELS[action as keyof typeof KEYBIND_LABELS].length).toBeGreaterThan(4)
    }
  })
  test('the fixed-controls list covers every tool surface', () => {
    const groups = new Set(FIXED_CONTROLS.map((c) => c.group))
    for (const group of ['Canvas', 'Wire tool', 'Wires', 'Meter tool', 'Toolbar', 'Menus']) {
      expect(groups.has(group)).toBe(true)
    }
  })
})
