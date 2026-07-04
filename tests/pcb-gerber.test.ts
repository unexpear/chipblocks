/**
 * The Gerber + drill writers. Every expectation is hand-computed from the cited footprint geometry
 * (0603 pads at ±0.825 mm, DIP-8 holes on 2.54 mm pitch) in the 4.6 coordinate format KiCad uses —
 * the conventions were ground-truthed against files plotted by the installed kicad-cli 10.0.4, so
 * these tests pin OUR output to the same shape a KiCad board manufactures as: negated Y, the
 * RoundRect aperture macro, ComponentPad/Conductor attributes, negative-polarity mask, decimal-mm
 * Excellon with ascending tools.
 */
import { describe, expect, test } from 'vitest'
import { canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import {
  type Board,
  type BoardPart,
  computeRatsnest,
  deriveBoard,
  type Ratsnest,
} from '../src/renderer/pcb-board.ts'
import {
  excellonDrill,
  GERBER_CONVENTIONS,
  gerberBottomCopper,
  gerberEdgeCuts,
  gerberMask,
  gerberSilkscreen,
  gerberTopCopper,
} from '../src/renderer/pcb-gerber.ts'
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

/** The routed two-resistor board every copper test reads: R1 at (10,10), R2 at (20,10), one wire. */
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
  const routing = routeBoard(ratsnest)
  return { board, ratsnest, routing }
}

/** A hand-built through-hole board (no schematic parts map to DIP-8 yet): DIP-8 + 1×4 header. */
const TH_BOARD: Board = {
  outline: { x: 0, y: 0, w: 40, h: 20 },
  placements: [
    { partId: 'U1', footprintId: 'DIP-8_W7.62mm', x: 5, y: 5, rotation: 0 },
    { partId: 'J1', footprintId: 'PinHeader_1x04_P2.54mm_Vertical', x: 30, y: 5, rotation: 0 },
  ],
}
const EMPTY_RATSNEST: Ratsnest = { airwires: [], padBoxes: [] }

describe('top copper', () => {
  const { board, ratsnest, routing } = routedPair()
  const gerber = gerberTopCopper(board, ratsnest, routing, WHEN)

  test('carries the X2 header KiCad readers expect: 4.6 mm format, top-copper function', () => {
    expect(gerber).toContain('%FSLAX46Y46*%')
    expect(gerber).toContain('%MOMM*%')
    expect(gerber).toContain('%TF.FileFunction,Copper,L1,Top*%')
    expect(gerber).toContain('%TF.FilePolarity,Positive*%')
    expect(gerber.trimEnd().endsWith('M02*')).toBe(true)
  })

  test('the 0603 pad is KiCad’s RoundRect macro with the cited radius rule (25%, capped 0.25 mm)', () => {
    // 0.8×0.95 mm pad → r = 0.25·0.8 = 0.2; inset corners at ±(0.4−0.2), ±(0.475−0.2)
    expect(gerber).toContain('%AMRoundRect*')
    expect(gerber).toContain(
      'RoundRect,0.200000X-0.200000X-0.275000X0.200000X-0.275000X0.200000X0.275000X-0.200000X0.275000X0*%',
    )
  })

  test('flashes land at the exact pad centres with Y NEGATED (board y-down → Gerber y-up)', () => {
    // R1 pad 1: (10 − 0.825, 10) mm → ×10⁶, y flipped
    expect(gerber).toContain('X9175000Y-10000000D03*')
    // R2 pad 2: (20 + 0.825, 10)
    expect(gerber).toContain('X20825000Y-10000000D03*')
  })

  test('every flash is tagged with its part, pad and real net (the solver’s own connectivity)', () => {
    expect(gerber).toContain('%TO.P,R1,1*%')
    expect(gerber).toContain('%TO.P,R2,2*%')
    // the unwired pads carry their honest sentinel net, never a blank
    expect(gerber).toContain('%TO.N,unconnected:R1/1*%')
  })

  test('the routed trace draws pad-centre to pad-centre at the cited class width', () => {
    expect(gerber).toContain('C,0.250000') // KiCad Default net class track width
    expect(gerber).toContain('X10825000Y-10000000D02*')
    expect(gerber).toContain('X19175000Y-10000000D01*')
  })

  test('a rotated placement swaps the pad aperture’s width and height (quarter turns stay axis-aligned)', () => {
    const defs: [string, string][] = [['R1', 'resistor']]
    const rotBoard = deriveBoard(
      parts(defs),
      new Map([['R1', { x: 10, y: 10, rotation: 90 as const }]]),
    )
    const rotated = gerberTopCopper(
      rotBoard,
      computeRatsnest(world(defs, []), rotBoard),
      { traces: [], unrouted: [] },
      WHEN,
    )
    // 0.95×0.8 now: r = 0.2, inset corners ±0.275, ±0.2 — swapped vs the unrotated pad
    expect(rotated).toContain(
      'RoundRect,0.200000X-0.275000X-0.200000X0.275000X-0.200000X0.275000X0.200000X-0.275000X0.200000X0*%',
    )
    // pad 1 (local −0.825, 0) under the 90° map (x,y)→(px−y, py+x) lands at (10, 9.175)
    expect(rotated).toContain('X10000000Y-9175000D03*')
  })
})

describe('bottom copper — through-hole annular rings only', () => {
  test('an SMD-only board has an empty bottom copper image', () => {
    const { board, ratsnest } = routedPair()
    const gerber = gerberBottomCopper(board, ratsnest, WHEN)
    expect(gerber).toContain('%TF.FileFunction,Copper,L2,Bot*%')
    expect(gerber).not.toContain('D03*')
  })

  test('a through-hole board flashes every pin on the bottom too', () => {
    const gerber = gerberBottomCopper(TH_BOARD, EMPTY_RATSNEST, WHEN)
    expect(gerber.match(/D03\*/g)).toHaveLength(12) // 8 DIP pins + 4 header pins
    // DIP-8 pin 5 at origin(5,5) + local (7.62, 7.62) = (12.62, 12.62)
    expect(gerber).toContain('X12620000Y-12620000D03*')
  })
})

describe('solder mask — negative polarity, opening = pad (cited: fab applies expansion)', () => {
  test('top mask opens every pad with the pad’s own aperture', () => {
    const { board, ratsnest, routing } = routedPair()
    const mask = gerberMask(board, 'Top', WHEN)
    expect(mask).toContain('%TF.FileFunction,Soldermask,Top*%')
    expect(mask).toContain('%TF.FilePolarity,Negative*%')
    expect(mask.match(/D03\*/g)).toHaveLength(4)
    // the same flash coordinates as the copper — openings sit exactly on the pads
    const copper = gerberTopCopper(board, ratsnest, routing, WHEN)
    for (const flash of mask.match(/X-?\d+Y-?\d+D03\*/g) ?? []) {
      expect(copper).toContain(flash)
    }
    expect(GERBER_CONVENTIONS.mask_clearance.valueMm).toBe(0)
    expect(GERBER_CONVENTIONS.mask_clearance.provenance.confidence).toBe('high')
  })

  test('bottom mask opens only the through-hole pads (an SMD board’s is empty)', () => {
    const { board } = routedPair()
    expect(gerberMask(board, 'Bot', WHEN)).not.toContain('D03*')
    expect(gerberMask(TH_BOARD, 'Bot', WHEN).match(/D03\*/g)).toHaveLength(12)
  })
})

describe('silkscreen and profile', () => {
  test('silk draws each footprint outline where the part sits, at the footprint’s real line width', () => {
    const { board } = routedPair()
    const silk = gerberSilkscreen(board, WHEN)
    expect(silk).toContain('%TF.FileFunction,Legend,Top*%')
    expect(silk).toContain('C,0.120000') // the 0603’s silk width, from the KiCad footprint
    // R1’s top silk line: (10−0.237258, 10−0.5225) → (10+0.237258, same)
    expect(silk).toContain('X9762742Y-9477500D02*')
    expect(silk).toContain('X10237258Y-9477500D01*')
    expect(silk).toContain('%TO.C,R1*%')
  })

  test('the profile is the outline rectangle, drawn as a closed centreline at the cited width', () => {
    const edge = gerberEdgeCuts({ x: 0, y: 0, w: 30, h: 20 }, WHEN)
    expect(edge).toContain('%TF.FileFunction,Profile,NP*%')
    expect(edge).not.toContain('FilePolarity') // a profile is not an image layer
    expect(edge).toContain(`C,${GERBER_CONVENTIONS.edge_line_width.valueMm.toFixed(6)}`)
    expect(edge).toContain('X0Y0D02*')
    expect(edge).toContain('X30000000Y0D01*')
    expect(edge).toContain('X30000000Y-20000000D01*')
    expect(edge.match(/D02\*/g)).toHaveLength(4)
    expect(edge.match(/D01\*/g)).toHaveLength(4)
  })
})

describe('the drill file — Excellon, decimal mm, ascending tools', () => {
  const drill = excellonDrill(TH_BOARD, WHEN)

  test('declares itself the way KiCad’s files do', () => {
    expect(drill.startsWith('M48')).toBe(true)
    expect(drill).toContain('FMAT,2')
    expect(drill).toContain('METRIC')
    expect(drill).toContain('; #@! TF.FileFunction,Plated,1,2,PTH')
    expect(drill).toContain('; #@! TA.AperFunction,Plated,PTH,ComponentDrill')
    expect(drill.trimEnd().endsWith('M30')).toBe(true)
  })

  test('one tool per hole size, ascending: T1 = 0.8 mm (DIP), T2 = 1.0 mm (header)', () => {
    expect(drill).toContain('T1C0.800')
    expect(drill).toContain('T2C1.000')
    expect(drill.indexOf('T1C0.800')).toBeLessThan(drill.indexOf('T2C1.000'))
  })

  test('hits land at the exact hole centres, Y negated, the decimal POINT always kept', () => {
    // DIP-8 pin 1 at the footprint origin (5,5); pin 4 at (5, 5+7.62). A bare integer ('X5') is
    // Excellon a CAM reader may parse by the FMAT digit rules (1000× off) — the point removes
    // the ambiguity, so whole millimetres are written '5.0'.
    expect(drill).toContain('X5.0Y-5.0')
    expect(drill).toContain('X5.0Y-12.62')
    // header pin 2: (30, 5+2.54)
    expect(drill).toContain('X30.0Y-7.54')
    expect(drill).not.toMatch(/X-?\d+Y/) // no coordinate ever lacks its decimal point
    const t1Hits = drill.split('T1\n')[1]?.split('T2')[0] ?? ''
    expect(t1Hits.trim().split('\n')).toHaveLength(8)
  })

  test('an SMD-only board yields a drill file with neither tools nor hits — no invented holes', () => {
    const { board } = routedPair()
    const smd = excellonDrill(board, WHEN)
    expect(smd).not.toContain('T1C')
    expect(smd).not.toMatch(/\nX-?[\d.]+Y/)
  })
})

test('a pad and a trace sharing one circle body get SEPARATE apertures — attributes never cross', () => {
  // DIP-8 pads are 1.6 mm circles; route a synthetic 1.6 mm-wide trace on the same board. Deduping
  // by body alone would hand the trace the pad's D-code — and the pad's ComponentPad attribute.
  const gerber = gerberTopCopper(
    TH_BOARD,
    EMPTY_RATSNEST,
    {
      traces: [
        {
          net: 'n1',
          widthMm: 1.6,
          points: [
            { x: 20, y: 5 },
            { x: 25, y: 5 },
          ],
        },
      ],
      unrouted: [],
    },
    WHEN,
  )
  expect(gerber).toMatch(/%TA\.AperFunction,ComponentPad\*%\n%ADD\d+C,1\.600000\*%/)
  expect(gerber).toMatch(/%TA\.AperFunction,Conductor\*%\n%ADD\d+C,1\.600000\*%/)
  const circleApertures = gerber.match(/%ADD\d+C,1\.600000\*%/g) ?? []
  expect(circleApertures).toHaveLength(2) // one ComponentPad, one Conductor — never shared
})

test('the conventions carry provenance (a fab manufactures these exact numbers)', () => {
  for (const c of Object.values(GERBER_CONVENTIONS)) {
    expect(c.provenance.citation.length).toBeGreaterThan(10)
    expect(c.provenance.confidence).toBe('high')
  }
})
