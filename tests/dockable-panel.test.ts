/**
 * A docked panel centers its content, but a child taller than the panel (the Gerber check in a
 * short window) must start at the top and stay scrollable. Plain `align-items: center` with
 * `overflow: auto` paints the extra height above the scrollport, where scrollTop cannot reach it.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { DockablePanel, type DockEdge } from '../src/renderer/dockable-panel.tsx'

function scrollStyle(edge: DockEdge): string {
  // React 19's createElement types require `children` on the props object, and Biome wants it as
  // the third argument instead. The third argument is what actually renders; the cast only
  // satisfies the type.
  const props = {
    edge,
    tabs: [{ id: 'pcb', title: 'PCB' }],
    activeId: 'pcb',
    onActivate: () => {},
    onTabDrop: () => {},
  } as unknown as Parameters<typeof DockablePanel>[0]
  const html = renderToStaticMarkup(
    createElement(DockablePanel, props, createElement('div', null, 'Check Gerbers')),
  )
  const match = html.match(/data-panel-scroll="" style="([^"]*)"/)
  if (match?.[1] === undefined) throw new Error(`scroll container style missing from ${html}`)
  return match[1]
}

describe('docked panel scroll', () => {
  test('a bottom panel (the PCB dock) uses safe center so a tall child scrolls from the top', () => {
    const style = scrollStyle('bottom')
    expect(style).toContain('align-items:safe center')
    expect(style).toContain('overflow:auto')
    expect(style).not.toContain('align-items:center')
  })

  test('a side panel keeps the same alignment, so short content stays centered', () => {
    const style = scrollStyle('left')
    expect(style).toContain('align-items:safe center')
    expect(style).toContain('overflow:auto')
  })
})
