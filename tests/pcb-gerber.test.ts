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
  gerberInnerCopper,
  gerberMask,
  gerberPaste,
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
      { traces: [], vias: [], unrouted: [] },
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

const NO_ROUTING = { traces: [], vias: [], unrouted: [] }

describe('bottom copper — through-hole rings, bottom traces, via barrels', () => {
  test('an SMD-only unrouted board has an empty bottom copper image', () => {
    const { board, ratsnest } = routedPair()
    const gerber = gerberBottomCopper(board, ratsnest, NO_ROUTING, WHEN)
    expect(gerber).toContain('%TF.FileFunction,Copper,L2,Bot*%')
    expect(gerber).not.toContain('D03*')
  })

  test('a through-hole board flashes every pin on the bottom too', () => {
    const gerber = gerberBottomCopper(TH_BOARD, EMPTY_RATSNEST, NO_ROUTING, WHEN)
    expect(gerber.match(/D03\*/g)).toHaveLength(12) // 8 DIP pins + 4 header pins
    // DIP-8 pin 5 at origin(5,5) + local (7.62, 7.62) = (12.62, 12.62)
    expect(gerber).toContain('X12620000Y-12620000D03*')
  })

  test('a via’s barrel appears on BOTH copper layers; a bottom trace only on the bottom', () => {
    const routing = {
      traces: [
        {
          net: 'n1',
          widthMm: 0.25,
          points: [
            { x: 20, y: 5 },
            { x: 25, y: 5 },
          ],
          layer: 'bottom' as const,
        },
      ],
      vias: [{ net: 'n1', at: { x: 20, y: 5 }, diameterMm: 0.6, drillMm: 0.4 }],
      unrouted: [],
    }
    const top = gerberTopCopper(TH_BOARD, EMPTY_RATSNEST, routing, WHEN)
    const bottom = gerberBottomCopper(TH_BOARD, EMPTY_RATSNEST, routing, WHEN)
    for (const layer of [top, bottom]) {
      expect(layer).toContain('%TA.AperFunction,ViaPad*%')
      expect(layer).toContain('C,0.600000')
      expect(layer).toContain('X20000000Y-5000000D03*') // the barrel flash
    }
    expect(bottom).toContain('X25000000Y-5000000D01*') // the bottom trace draw…
    expect(top).not.toContain('D01*') // …never on top
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

describe('solder paste — the stencil, reflow pads only', () => {
  test('SMD pads get apertures identical to their copper; through-hole pads get NONE', () => {
    // Mixed board: DIP-8 + header are through-hole (no paste — their legs are wave/hand
    // soldered), so the top paste of the TH_BOARD is empty…
    const thPaste = gerberPaste(TH_BOARD, 'Top', WHEN)
    expect(thPaste).toContain('%TF.FileFunction,Paste,Top*%')
    expect(thPaste).toContain('%TF.FilePolarity,Positive*%')
    expect(thPaste).not.toContain('D03*')
    // …while an SMD board's paste flashes exactly where its copper does, same apertures
    const { board, ratsnest, routing } = routedPair()
    const paste = gerberPaste(board, 'Top', WHEN)
    const copper = gerberTopCopper(board, ratsnest, routing, WHEN)
    const flashes = paste.match(/X-?\d+Y-?\d+D03\*/g) ?? []
    expect(flashes).toHaveLength(4)
    for (const flash of flashes) expect(copper).toContain(flash)
    expect(paste).toContain(
      'RoundRect,0.200000X-0.200000X-0.275000X0.200000X-0.275000X0.200000X0.275000X-0.200000X0.275000X0*%',
    )
  })

  test('the bottom stencil is honestly empty — no footprint mounts parts on the bottom', () => {
    const { board } = routedPair()
    const paste = gerberPaste(board, 'Bot', WHEN)
    expect(paste).toContain('%TF.FileFunction,Paste,Bot*%')
    expect(paste).not.toContain('D03*')
  })
})

describe('silkscreen and profile', () => {
  test('silk draws each footprint’s (own corner-tick) outline where the part sits, at its real line width', () => {
    const { board } = routedPair()
    const silk = gerberSilkscreen(board, WHEN)
    expect(silk).toContain('%TF.FileFunction,Legend,Top*%')
    expect(silk).toContain('C,0.120000') // the 0603’s silk width (ChipBlocks’ own cornerTicksSilk)
    // the corner ticks are stroked: a pen-up move (D02) then a pen-down draw (D01) per segment
    expect(silk).toMatch(/D02\*/)
    expect(silk).toMatch(/D01\*/)
    expect(silk).toContain('%TO.C,R1*%') // the strokes carry R1's net/part attribute
  })

  test('the reference designator is STROKED on the silk at the cited 1.0 mm / 0.15 mm lettering', () => {
    // A part named 'i' (uppercased to I): the glyph's centre stem is a single vertical bar that
    // lands EXACTLY on the label anchor's x — hand-computed: the 0603 anchor is (0, −1.43) local,
    // so at (10, 10) the text centres on (10, 8.57); cap top 8.07, baseline 9.07.
    const silk = gerberSilkscreen(
      {
        outline: { x: 0, y: 0, w: 20, h: 20 },
        placements: [{ partId: 'i', footprintId: 'R_0603_1608Metric', x: 10, y: 10, rotation: 0 }],
      },
      WHEN,
    )
    expect(silk).toContain('C,0.150000') // SILK_TEXT.thicknessMm, cited from the KiCad defaults
    expect(silk).toContain('X10000000Y-8070000D02*')
    expect(silk).toContain('X10000000Y-9070000D01*')
  })

  test('a character the font cannot print is named in a comment — never dropped in silence', () => {
    const silk = gerberSilkscreen(
      {
        outline: { x: 0, y: 0, w: 20, h: 20 },
        placements: [
          { partId: 'r#1', footprintId: 'R_0603_1608Metric', x: 10, y: 10, rotation: 0 },
        ],
      },
      WHEN,
    )
    expect(silk).toContain("G04 'r#1': no glyph for #")
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
  const drill = excellonDrill(TH_BOARD, NO_ROUTING, WHEN)

  test('declares itself the way KiCad’s files do', () => {
    expect(drill.startsWith('M48')).toBe(true)
    expect(drill).toContain('FMAT,2')
    expect(drill).toContain('METRIC')
    expect(drill).toContain('; #@! TF.FileFunction,Plated,1,2,PTH')
    expect(drill).toContain('; #@! TA.AperFunction,Plated,PTH,ComponentDrill')
    expect(drill.trimEnd().endsWith('M30')).toBe(true)
  })

  test('the plated span follows the board’s copper-layer count (1→N, not hardcoded 1,2)', () => {
    // integration-audit-caught: on a 4-/6-layer board the drill's declared span must match the .gbrjob
    // + inner-Gerber layer count, else the export set describes the board with two different counts.
    expect(excellonDrill(TH_BOARD, NO_ROUTING, WHEN, 4)).toContain(
      '; #@! TF.FileFunction,Plated,1,4,PTH',
    )
    expect(excellonDrill(TH_BOARD, NO_ROUTING, WHEN, 6)).toContain(
      '; #@! TF.FileFunction,Plated,1,6,PTH',
    )
    // the default (2-layer) still declares 1,2
    expect(excellonDrill(TH_BOARD, NO_ROUTING, WHEN)).toContain(
      '; #@! TF.FileFunction,Plated,1,2,PTH',
    )
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
    const smd = excellonDrill(board, NO_ROUTING, WHEN)
    expect(smd).not.toContain('T1C')
    expect(smd).not.toMatch(/\nX-?[\d.]+Y/)
  })

  test('via holes get their own tool with the ViaDrill attribute, beside the component drills', () => {
    const withVia = excellonDrill(
      TH_BOARD,
      {
        traces: [],
        vias: [{ net: 'n1', at: { x: 20, y: 6 }, diameterMm: 0.6, drillMm: 0.4 }],
        unrouted: [],
      },
      WHEN,
    )
    expect(withVia).toContain('; #@! TA.AperFunction,Plated,PTH,ViaDrill')
    expect(withVia).toContain('T1C0.400') // 0.4 sorts before the 0.8 DIP and 1.0 header drills
    expect(withVia).toContain('T2C0.800')
    expect(withVia).toContain('X20.0Y-6.0')
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
          layer: 'top' as const,
        },
      ],
      vias: [],
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

describe('inner copper (multilevel boards)', () => {
  const { board, ratsnest } = routedPair()
  // an inner-layer trace joined by a plated through-via (which appears on the inner layer too)
  const routing = {
    traces: [
      {
        net: 'net_1',
        widthMm: 0.25,
        layer: 'inner1' as const,
        points: [
          { x: 11, y: 10 },
          { x: 19, y: 10 },
        ],
      },
    ],
    vias: [{ net: 'net_1', at: { x: 15, y: 10 }, diameterMm: 0.6, drillMm: 0.4 }],
    unrouted: [],
  }
  const gerber = gerberInnerCopper(board, ratsnest, routing, 'inner1', 2, WHEN)

  test('carries the inner-copper file function (Copper,L2,Inr) and draws the inner trace + via', () => {
    expect(gerber).toContain('%TF.FileFunction,Copper,L2,Inr*%')
    expect(gerber).toContain('D01*') // the inner trace is drawn
    expect(gerber).toContain('D03*') // the through-via flashes on the inner layer
    expect(gerber.trim().endsWith('M02*')).toBe(true)
  })

  test('an inner layer draws NO trace when the copper is only on the outer layers', () => {
    const outerOnly = gerberInnerCopper(
      board,
      ratsnest,
      routeBoard(ratsnest), // routeBoard defaults to a 2-layer board — top/bottom copper only
      'inner1',
      2,
      WHEN,
    )
    expect(outerOnly).not.toContain('D01*') // nothing routed on inner1
  })
})
