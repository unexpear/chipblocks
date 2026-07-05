/**
 * The shared board-view pieces used by BOTH the dock panel and the full-size main-area workspace.
 * BoardView is the single place that branches the view mode — this proves the branch: flat/layers →
 * the top-down PcbView ("PCB layout"), 3D → the exploded lamination ("PCB exploded lamination view").
 * PcbViewControls offers all three mode buttons. Keeping this branch in one tested spot is why the two
 * board surfaces can never drift.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { deriveBoard } from '../src/renderer/pcb-board.ts'
import { boardLayers } from '../src/renderer/pcb-layers.ts'
import { defaultStackup } from '../src/renderer/pcb-stackup.ts'
import { BoardView, PcbViewControls } from '../src/renderer/pcb-workspace.tsx'

const board = deriveBoard([
  { id: 'R1', definition: 'resistor' },
  { id: 'R2', definition: 'resistor' },
])
const routing = { traces: [], vias: [], unrouted: [] }
const stackup = defaultStackup()

describe('BoardView — the one view-mode branch', () => {
  test('flat mode renders the top-down PCB layout', () => {
    const html = renderToStaticMarkup(
      createElement(BoardView, { board, stackup, routing, mode: 'flat', activeLayer: 'f_cu' }),
    )
    expect(html).toContain('aria-label="PCB layout"')
    expect(html).not.toContain('exploded')
  })

  test('layers mode still renders the top-down PCB layout (one sheet at a time)', () => {
    const html = renderToStaticMarkup(
      createElement(BoardView, { board, stackup, routing, mode: 'layers', activeLayer: 'b_cu' }),
    )
    expect(html).toContain('aria-label="PCB layout"')
  })

  test('3D mode renders the exploded lamination', () => {
    const html = renderToStaticMarkup(
      createElement(BoardView, { board, stackup, routing, mode: 'exploded', activeLayer: 'f_cu' }),
    )
    expect(html).toContain('aria-label="PCB exploded lamination view"')
  })
})

describe('PcbViewControls', () => {
  test('offers all three view modes', () => {
    const html = renderToStaticMarkup(
      createElement(PcbViewControls, {
        mode: 'flat',
        onMode: () => {},
        layers: boardLayers(stackup),
        activeLayerIndex: 1,
        onStep: () => {},
      }),
    )
    expect(html).toContain('>Flat<')
    expect(html).toContain('>Layers<')
    expect(html).toContain('>3D<')
  })

  test('the layer pager appears only in Layers mode, with the sheet label', () => {
    const layers = boardLayers(stackup)
    const flat = renderToStaticMarkup(
      createElement(PcbViewControls, {
        mode: 'flat',
        onMode: () => {},
        layers,
        activeLayerIndex: 1,
        onStep: () => {},
      }),
    )
    expect(flat).not.toContain('▲')
    const inLayers = renderToStaticMarkup(
      createElement(PcbViewControls, {
        mode: 'layers',
        onMode: () => {},
        layers,
        activeLayerIndex: 1,
        onStep: () => {},
      }),
    )
    expect(inLayers).toContain('▲')
    expect(inLayers).toContain('F.Cu (1 oz, 35 µm)') // index 1 = top copper
  })
})
