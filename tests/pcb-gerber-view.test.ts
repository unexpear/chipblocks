/**
 * The Gerber check must draw what the files contain, in one board frame, and must refuse a picture
 * when a command was skipped. These tests use the real exporter and the real SVG.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import type { Footprint } from '../src/renderer/footprint.ts'
import { type Board, outlineRing } from '../src/renderer/pcb-board.ts'
import {
  excellonDrill,
  gerberEdgeCuts,
  gerberMask,
  gerberTopCopper,
} from '../src/renderer/pcb-gerber.ts'
import { parseChipblocksPlot } from '../src/renderer/pcb-gerber-parse.ts'
import {
  chainLoop,
  emptyPlotMessage,
  gerberCheckModel,
  scaleBarAt,
  viewBoxFor,
} from '../src/renderer/pcb-gerber-plot.ts'
import { GerberCheck } from '../src/renderer/pcb-gerber-view.tsx'
import { setUserFootprints } from '../src/renderer/user-footprints.ts'

const WHEN = new Date(2026, 6, 4, 12, 0, 0)
const RATS = { airwires: [], padBoxes: [] }
const NO_ROUTE = { traces: [], vias: [], unrouted: [] }

const markup = (files: { name: string; text: string }[]) =>
  renderToStaticMarkup(createElement(GerberCheck, { files }))

describe('parsed ChipBlocks plots match the pads the exporter was given', () => {
  test('a 1.6 mm roundrect is capped at 0.25 mm, not 25% of the side', () => {
    const board: Board = {
      outline: { x: 0, y: 0, w: 40, h: 30 },
      placements: [{ partId: 'U1', footprintId: 'DIP-8_W7.62mm', x: 5, y: 5, rotation: 0 }],
    }
    const plot = parseChipblocksPlot(gerberTopCopper(board, RATS, NO_ROUTE, WHEN))
    expect(plot.complete).toBe(true)
    expect(plot.warnings).toEqual([])
    const pin1 = plot.draws.find((d) => d.op === 'flash' && d.at.x === 5 && d.at.y === 5)
    expect(pin1).toMatchObject({
      op: 'flash',
      shape: { kind: 'roundrect', wMm: 1.6, hMm: 1.6, rMm: 0.25 },
    })
  })

  test('a 90° oval swaps width and height; an L outline is six edges', () => {
    const oval: Footprint = {
      id: 'view_oval',
      name: 'oval',
      description: 'view test',
      pads: [
        {
          id: '1',
          center: { x: 0, y: 0 },
          size: { w: 1.2, h: 0.7 },
          shape: 'oval',
          type: 'smd',
        },
      ],
      silkscreen: [],
      fabrication: [],
      labels: {
        reference: { x: 0, y: -1 },
        value: { x: 0, y: 1 },
        fabReference: { x: 0, y: 0 },
      },
      courtyard: { x: -1, y: -1, w: 2, h: 2 },
      provenance: {
        source_type: 'derived',
        title: 'view test land',
        citation: 'test fixture',
        confidence: 'low',
      },
    }
    setUserFootprints([oval])
    try {
      const board: Board = {
        outline: { x: 0, y: 0, w: 20, h: 20 },
        placements: [{ partId: 'M1', footprintId: 'view_oval', x: 4, y: 6, rotation: 90 }],
      }
      const plot = parseChipblocksPlot(gerberTopCopper(board, RATS, NO_ROUTE, WHEN))
      expect(plot.complete).toBe(true)
      expect(plot.draws[0]).toMatchObject({
        op: 'flash',
        at: { x: 4, y: 6 },
        shape: { kind: 'obround', wMm: 0.7, hMm: 1.2 },
      })
    } finally {
      setUserFootprints([])
    }

    const ring = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 10 },
      { x: 15, y: 10 },
      { x: 15, y: 20 },
      { x: 0, y: 20 },
    ]
    const edge = parseChipblocksPlot(gerberEdgeCuts(ring, WHEN))
    expect(edge.complete).toBe(true)
    expect(edge.draws.filter((d) => d.op === 'draw')).toHaveLength(6)
    expect(chainLoop(edge.draws)).toHaveLength(6)
  })
})

describe('the check draws every layer in one frame', () => {
  const board: Board = {
    outline: { x: 0, y: 0, w: 40, h: 20 },
    placements: [
      { partId: 'U1', footprintId: 'DIP-8_W7.62mm', x: 5, y: 5, rotation: 0 },
      { partId: 'R1', footprintId: 'R_0603_1608Metric', x: 20, y: 10, rotation: 0 },
    ],
  }
  const routing = {
    traces: [
      {
        net: 'n1',
        widthMm: 0.25,
        layer: 'top' as const,
        points: [
          { x: 20, y: 10 },
          { x: 28, y: 10 },
        ],
      },
    ],
    vias: [{ net: 'n1', at: { x: 24, y: 10 }, diameterMm: 0.6, drillMm: 0.4 }],
    unrouted: [],
  }
  const files = [
    { name: 'board-F_Cu.gtl', text: gerberTopCopper(board, RATS, routing, WHEN) },
    { name: 'board-F_Mask.gts', text: gerberMask(board, 'Top', WHEN) },
    { name: 'board-Edge_Cuts.gm1', text: gerberEdgeCuts(outlineRing(board), WHEN) },
    { name: 'board.drl', text: excellonDrill(board, routing, WHEN) },
    { name: 'README.txt', text: 'not a gerber' },
  ]

  test('the frame is the board, not the cropped artwork of one layer', () => {
    const model = gerberCheckModel(files)
    expect(model.incomplete).toEqual([])
    expect(model.outline).toHaveLength(4)
    expect(model.frame).not.toBeNull()
    const frame = model.frame
    if (frame === null) return
    expect(frame.maxX - frame.minX).toBeGreaterThan(39)
    expect(frame.minX).toBeLessThan(1)
    const copper = model.layers.find((layer) => layer.role === 'copper-top')
    expect(copper?.plot.draws.some((d) => d.op === 'flash')).toBe(true)
  })

  test('the stack SVG uses that frame, the real apertures, and mask openings', () => {
    const html = markup(files)
    const model = gerberCheckModel(files)
    const frame = model.frame
    if (frame === null) throw new Error('expected a frame')
    const box = viewBoxFor(frame)
    expect(html).toContain(`viewBox="${box.minX} ${box.minY} ${box.w} ${box.h}"`)
    expect(box.w).toBeGreaterThan(30)
    expect(html).toContain('rx="0.25"')
    expect(html).toContain('rx="0.2"')
    expect(html).toContain('r="0.4"')
    expect(html).toContain('maskUnits="userSpaceOnUse"')
    expect(html).toContain('data-render="film-openings"')
    expect(html).toContain('Nothing is mirrored')
    expect(html).toContain('Copper is solid')
    expect(html).toContain('thinnest stroke')
    expect(html.indexOf('data-layer="copper-top"')).toBeLessThan(html.indexOf('data-layer="drill"'))
    expect(html.indexOf('data-layer="drill"')).toBeLessThan(html.indexOf('data-layer="mask-top"'))
    const span = Math.max(frame.maxX - frame.minX, frame.maxY - frame.minY)
    const bar = scaleBarAt(box, span)
    expect(bar.x2 - bar.x1).toBe(bar.mm)
    expect(html).toContain(`data-mm="${String(bar.mm)}"`)
    expect(html).toContain(`x2="${String(bar.x2)}"`)
    expect(html).toContain('Not plotted (not a Gerber or drill file): README.txt')
  })

  test('a negative file with no openings says the film is intact', () => {
    const smd: Board = {
      outline: { x: 0, y: 0, w: 20, h: 10 },
      placements: [{ partId: 'R1', footprintId: 'R_0603_1608Metric', x: 10, y: 5, rotation: 0 }],
    }
    const html = markup([{ name: 'board-B_Mask.gbs', text: gerberMask(smd, 'Bot', WHEN) }])
    expect(html).toContain(emptyPlotMessage(parseChipblocksPlot(gerberMask(smd, 'Bot', WHEN))))
    expect(html).toContain('No openings in this negative file')
    expect(html).not.toContain('data-testid="gerber-plot"')
  })

  test('Y in the file is flipped back, and an obround uses the short side as its radius', () => {
    const flashed = markup([
      {
        name: 'board-F_Cu.gtl',
        text: [
          '%FSLAX46Y46*%',
          '%MOMM*%',
          '%ADD10C,1.000000*%',
          'D10*',
          'X5000000Y-10000000D03*',
          'M02*',
          '',
        ].join('\n'),
      },
    ])
    expect(flashed).toContain('cy="10"')
    expect(flashed).not.toContain('cy="-10"')

    const obround = markup([
      {
        name: 'board-F_Cu.gtl',
        text: [
          '%FSLAX46Y46*%',
          '%MOMM*%',
          '%ADD10O,1.600000X0.800000*%',
          'D10*',
          'X0Y0D03*',
          'M02*',
          '',
        ].join('\n'),
      },
    ])
    expect(obround).toContain('width="1.6"')
    expect(obround).toContain('height="0.8"')
    expect(obround).toContain('rx="0.4"')
  })

  test('a file with a skipped arc is not drawn', () => {
    const html = markup([
      {
        name: 'board-F_Cu.gtl',
        text: [
          '%FSLAX46Y46*%',
          '%MOMM*%',
          '%ADD10C,1.000000*%',
          'D10*',
          'X0Y0D03*',
          'G03X10000000Y0I5000000J0D01*',
          'M02*',
          '',
        ].join('\n'),
      },
    ])
    expect(html).toContain('data-testid="gerber-unplotted"')
    expect(html).not.toContain('data-testid="gerber-plot"')
    expect(html).toContain('Not plotted')
    expect(html).toMatch(/arc/i)
    expect(html).not.toContain('cy="0"')
  })

  test('a skipped command in bottom paste is not passed off as the expected empty layer', () => {
    const html = markup([
      {
        name: 'board-B_Paste.gbp',
        text: [
          '%FSLAX46Y46*%',
          '%MOMM*%',
          '%ADD10C,1.000000*%',
          'D10*',
          'G03*',
          'X0Y0D01*',
          'M02*',
          '',
        ].join('\n'),
      },
    ])
    expect(html).toContain('data-testid="gerber-unplotted"')
    expect(html).toContain('board-B_Paste.gbp')
    expect(html).not.toContain('no bottom-mounted parts')
  })
})
