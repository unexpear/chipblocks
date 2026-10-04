/**
 * The Gerber check reads OUR files back. The flash and the drill hit below are the same strings
 * pcb-gerber.test.ts / pcb-fab.test.ts already pin (X9175000Y-10000000D03*, X5.0Y-5.0). Y in the
 * file is Gerber-up; the parser must return board-down millimetres.
 */
import { describe, expect, test } from 'vitest'
import { canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import {
  type Board,
  type BoardPart,
  computeRatsnest,
  deriveBoard,
} from '../src/renderer/pcb-board.ts'
import { FAB_FILE_NAMES } from '../src/renderer/pcb-fab.ts'
import { excellonDrill, gerberPaste, gerberTopCopper } from '../src/renderer/pcb-gerber.ts'
import { isHiddenEmptyBottom, parseChipblocksPlot } from '../src/renderer/pcb-gerber-parse.ts'
import { routeBoard } from '../src/renderer/pcb-route.ts'

const WHEN = new Date(2026, 6, 4, 12, 0, 0)

const parts = (defs: [string, string][]): BoardPart[] =>
  defs.map(([id, definition]) => ({ id, definition }))

const world = (defs: [string, string][], wires: [string, string, string, string][]) =>
  canvasToWorld(
    defs.map(([id, definition]) => ({ id, definition })),
    wires.map(([source, sourceHandle, target, targetHandle], i) => ({
      id: `w${i}`,
      source,
      sourceHandle,
      target,
      targetHandle,
    })),
  )

function routedPair() {
  const defs: [string, string][] = [
    ['R1', 'resistor'],
    ['R2', 'resistor'],
  ]
  const board = deriveBoard(
    parts(defs),
    new Map([
      ['R1', { x: 10, y: 10, rotation: 0 as const }],
      ['R2', { x: 20, y: 10, rotation: 0 as const }],
    ]),
  )
  const ratsnest = computeRatsnest(world(defs, [['R1', 'terminal_b', 'R2', 'terminal_a']]), board)
  return { board, ratsnest, routing: routeBoard(ratsnest) }
}

const TH_BOARD: Board = {
  outline: { x: 0, y: 0, w: 40, h: 20 },
  placements: [
    { partId: 'U1', footprintId: 'DIP-8_W7.62mm', x: 5, y: 5, rotation: 0 },
    { partId: 'J1', footprintId: 'PinHeader_1x04_P2.54mm_Vertical', x: 30, y: 5, rotation: 0 },
  ],
}

describe('ChipBlocks Gerber dialect, Y flipped back to board-down', () => {
  test('the known 0603 flash X9175000Y-10000000D03* is pad (9.175, 10), not y = -10', () => {
    const { board, ratsnest, routing } = routedPair()
    const gerber = gerberTopCopper(board, ratsnest, routing, WHEN)
    expect(gerber).toContain('X9175000Y-10000000D03*')
    const plot = parseChipblocksPlot(gerber)
    expect(plot.kind).toBe('gerber')
    expect(plot.warnings).toEqual([])
    expect(plot.fileFunction).toBe('Copper,L1,Top')
    const flash = plot.draws.find(
      (d) => d.op === 'flash' && Math.abs(d.at.x - 9.175) < 1e-9 && Math.abs(d.at.y - 10) < 1e-9,
    )
    expect(flash).toMatchObject({
      op: 'flash',
      at: { x: 9.175, y: 10 },
      shape: { kind: 'roundrect', wMm: 0.8, hMm: 0.95, rMm: 0.2 },
    })
    const d03 = gerber.match(/D03\*/g)?.length ?? -1
    expect(plot.draws.filter((d) => d.op === 'flash')).toHaveLength(d03)
    const stroke = plot.draws.find((d) => d.op === 'draw')
    expect(stroke).toMatchObject({
      op: 'draw',
      from: { x: 10.825, y: 10 },
      to: { x: 19.175, y: 10 },
      widthMm: 0.25,
    })
    const d01 = gerber.match(/D01\*/g)?.length ?? -1
    expect(plot.draws.filter((d) => d.op === 'draw')).toHaveLength(d01)
  })

  test('circle, rect, and obround apertures flash and stroke in board-down millimetres', () => {
    const text = [
      '%FSLAX46Y46*%',
      '%MOMM*%',
      '%ADD10C,0.500000*%',
      '%ADD11R,1.000000X0.500000*%',
      '%ADD12O,1.600000X0.800000*%',
      'D10*',
      'X0Y-2000000D02*',
      'X0Y-4000000D01*',
      'D11*',
      'X5000000Y-1000000D03*',
      'D12*',
      'X0Y0D03*',
      'M02*',
      '',
    ].join('\n')
    const plot = parseChipblocksPlot(text)
    expect(plot.warnings).toEqual([])
    expect(plot.draws).toEqual([
      { op: 'draw', from: { x: 0, y: 2 }, to: { x: 0, y: 4 }, widthMm: 0.5 },
      { op: 'flash', at: { x: 5, y: 1 }, shape: { kind: 'rect', wMm: 1, hMm: 0.5 } },
      { op: 'flash', at: { x: 0, y: 0 }, shape: { kind: 'obround', wMm: 1.6, hMm: 0.8 } },
    ])
  })

  test('a coordinate with no %FSLAX46Y46*% / %MOMM*% is not plotted', () => {
    expect(parseChipblocksPlot('X9175000Y-10000000D03*\n').draws).toEqual([])
    const bare = '%ADD10C,1.000000*%\nD10*\nX9175000Y-10000000D03*\n'
    const plot = parseChipblocksPlot(bare)
    expect(plot.draws).toEqual([])
    expect(plot.warnings.length).toBeGreaterThan(0)
  })
})

describe('ChipBlocks Excellon, Y flipped back to board-down', () => {
  test('the known hit X5.0Y-5.0 is the DIP pin at (5, 5) with the 0.8 mm tool', () => {
    const drill = excellonDrill(TH_BOARD, { traces: [], vias: [], unrouted: [] }, WHEN)
    expect(drill).toContain('X5.0Y-5.0')
    const plot = parseChipblocksPlot(drill)
    expect(plot.kind).toBe('excellon')
    expect(plot.warnings).toEqual([])
    expect(plot.fileFunction).toBe('Plated,1,2,PTH')
    const hit = plot.draws.find((d) => d.op === 'drill' && d.at.x === 5 && d.at.y === 5)
    expect(hit).toEqual({ op: 'drill', at: { x: 5, y: 5 }, diameterMm: 0.8 })
    expect(plot.draws.filter((d) => d.op === 'drill')).toHaveLength(12)
  })
})

describe('empty bottom paste and silk', () => {
  test('an empty bottom paste file is the one the viewer hides', () => {
    const { board } = routedPair()
    const paste = gerberPaste(board, 'Bot', WHEN)
    expect(parseChipblocksPlot(paste).draws).toHaveLength(0)
    expect(FAB_FILE_NAMES.bottomPaste).toBe('board-B_Paste.gbp')
    expect(FAB_FILE_NAMES.bottomSilk).toBe('board-B_Silkscreen.gbo')
    expect(isHiddenEmptyBottom(FAB_FILE_NAMES.bottomPaste, 0)).toBe(true)
    expect(isHiddenEmptyBottom(FAB_FILE_NAMES.bottomSilk, 0)).toBe(true)
    expect(isHiddenEmptyBottom(FAB_FILE_NAMES.bottomPaste, 1)).toBe(false)
    expect(isHiddenEmptyBottom(FAB_FILE_NAMES.bottomCopper, 0)).toBe(false)
    expect(isHiddenEmptyBottom(FAB_FILE_NAMES.topPaste, 0)).toBe(false)
  })
})
