/**
 * The 3-D exploded lamination view — the board's sheets pulled apart in space. This proves the render
 * (not a mock): a real board, real routed copper on BOTH planes, and a real plated via all reach the
 * SVG. The headline check is the VIA BARREL — the vertical connector that bridges the top copper plane
 * to the bottom copper plane, the "multilevel interaction" the exploded view exists to show. It also
 * proves each of the four sheets is drawn and labelled with its real stack-up thickness.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { deriveBoard } from '../src/renderer/pcb-board.ts'
import { PcbExplodedView } from '../src/renderer/pcb-exploded.tsx'
import type { CopperTrace, Via } from '../src/renderer/pcb-route.ts'
import { defaultStackup } from '../src/renderer/pcb-stackup.ts'

const board = deriveBoard([
  { id: 'R1', definition: 'resistor' },
  { id: 'R2', definition: 'resistor' },
])

// One trace on each copper plane and a via between them — the two-layer case the flat view flattens.
const traces: CopperTrace[] = [
  {
    net: 'N1',
    widthMm: 0.25,
    layer: 'top',
    points: [
      { x: 1, y: 1 },
      { x: 5, y: 1 },
    ],
  },
  {
    net: 'N1',
    widthMm: 0.25,
    layer: 'bottom',
    points: [
      { x: 5, y: 1 },
      { x: 5, y: 4 },
    ],
  },
]
const vias: Via[] = [{ net: 'N1', at: { x: 5, y: 1 }, diameterMm: 0.6, drillMm: 0.3 }]

const markup = renderToStaticMarkup(
  createElement(PcbExplodedView, { board, stackup: defaultStackup(), traces, vias }),
)

describe('PcbExplodedView — the exploded lamination', () => {
  test('all four sheets are labelled with their real stack-up thickness', () => {
    expect(markup).toContain('F.Silkscreen (ink)')
    expect(markup).toContain('F.Cu (1 oz, 35 µm)')
    expect(markup).toContain('FR4 core (1.51 mm)')
    expect(markup).toContain('B.Cu (1 oz, 35 µm)')
  })

  test('copper is drawn on BOTH planes — the top and bottom traces', () => {
    expect(markup).toContain('data-layer="top"')
    expect(markup).toContain('data-layer="bottom"')
  })

  test('the via is a barrel bridging the two copper planes', () => {
    // the via group carries data-via and contains a <line> (the vertical barrel) plus its two pucks
    expect(markup).toContain('data-via="N1"')
    const viaGroup = markup.slice(markup.indexOf('data-via="N1"'))
    expect(viaGroup).toContain('<line')
    // the barrel spans a real vertical gap — its two endpoints sit at different screen heights
    const line = viaGroup.match(/<line[^>]*y1="([\d.]+)"[^>]*y2="([\d.]+)"/)
    expect(line).not.toBeNull()
    if (line?.[1] !== undefined && line[2] !== undefined) {
      expect(Math.abs(Number(line[1]) - Number(line[2]))).toBeGreaterThan(20)
    }
  })

  test('the drawing has real pixel dimensions (it laid out and projected)', () => {
    const w = markup.match(/width="([\d.]+)"/)
    const h = markup.match(/height="([\d.]+)"/)
    expect(Number(w?.[1])).toBeGreaterThan(100)
    expect(Number(h?.[1])).toBeGreaterThan(100)
  })
})
