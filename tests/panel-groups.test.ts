/**
 * panel-groups tests (Sprint 21) — the pure tab-stack reducer behind drag-a-panel-
 * onto-another-panel grouping: stacking adopts the target's group + edge, popping
 * out gives a fresh group, and grouping collapses the visible panels into stacks.
 */

import { describe, expect, test } from 'vitest'
import {
  moveToEdge,
  type PanelLayout,
  panelGroups,
  stackOnto,
} from '../src/renderer/panel-groups.ts'

const ORDER = ['parts', 'tools', 'properties', 'scope'] as const
const initial: PanelLayout = {
  parts: { edge: 'left', group: 0 },
  tools: { edge: 'top', group: 1 },
  properties: { edge: 'right', group: 2 },
  scope: { edge: 'bottom', group: 3 },
}
const all = () => true

describe('stackOnto', () => {
  test('the dragged panel adopts the target group and edge', () => {
    const next = stackOnto(initial, 'properties', 'scope')
    expect(next.properties).toEqual({ edge: 'bottom', group: 3 }) // joined scope
    expect(next.scope).toEqual({ edge: 'bottom', group: 3 }) // unchanged
  })
  test('is a no-op for self, an already-grouped pair, or a missing target', () => {
    expect(stackOnto(initial, 'scope', 'scope')).toBe(initial)
    const grouped = stackOnto(initial, 'properties', 'scope')
    expect(stackOnto(grouped, 'properties', 'scope')).toBe(grouped) // already together
    expect(stackOnto(initial, 'properties', 'ghost')).toBe(initial)
  })
})

describe('moveToEdge (pop-out / plain move)', () => {
  test('gives the panel a fresh group at the new edge', () => {
    const moved = moveToEdge(initial, 'properties', 'left')
    expect(moved.properties?.edge).toBe('left')
    expect(moved.properties?.group).toBe(4) // max(0,1,2,3)+1 — never collides
  })
  test('pops a tab out of a stack, leaving the rest grouped', () => {
    const stacked = stackOnto(initial, 'properties', 'scope') // properties + scope on bottom
    const popped = moveToEdge(stacked, 'properties', 'left')
    expect(popped.properties?.group).not.toBe(popped.scope?.group) // properties left the stack
    expect(popped.scope?.group).toBe(3) // scope stays put
  })
})

describe('panelGroups', () => {
  test('un-stacked panels are four groups of one, in canonical order', () => {
    const groups = panelGroups(initial, ORDER, all)
    expect(groups.map((g) => g.ids)).toEqual([['parts'], ['tools'], ['properties'], ['scope']])
  })
  test('a stack renders as one group holding both tabs at the shared edge', () => {
    const groups = panelGroups(stackOnto(initial, 'properties', 'scope'), ORDER, all)
    const bottom = groups.find((g) => g.edge === 'bottom')
    expect(bottom?.ids).toEqual(['properties', 'scope'])
    expect(groups).toHaveLength(3) // parts, tools, and the properties+scope stack
  })
  test('hidden panels drop out of their stack', () => {
    const stacked = stackOnto(initial, 'properties', 'scope')
    const groups = panelGroups(stacked, ORDER, (id) => id !== 'scope') // scope closed
    const bottom = groups.find((g) => g.edge === 'bottom')
    expect(bottom?.ids).toEqual(['properties']) // only the visible member remains
  })
  test('a freshly-added panel (in order + visible, not yet in the layout) auto-docks bottom, not dropped', () => {
    // The footgun: before, a panel with no placement was silently skipped, so a new registry
    // entry showed nothing until you ALSO added it to the layout. Now it auto-docks.
    const groups = panelGroups(initial, [...ORDER, 'newpanel'], all)
    const auto = groups.find((g) => g.ids.includes('newpanel'))
    expect(auto?.edge).toBe('bottom')
    expect(auto?.group).toBe(4) // a fresh group above the existing ones (max 3 + 1)
    expect(auto?.ids).toEqual(['newpanel'])
  })
  test('two unlisted panels each get their own fresh group (no collision)', () => {
    const groups = panelGroups(initial, [...ORDER, 'a', 'b'], all)
    const ga = groups.find((g) => g.ids.includes('a'))
    const gb = groups.find((g) => g.ids.includes('b'))
    expect(ga?.group).not.toBe(gb?.group)
  })
})
