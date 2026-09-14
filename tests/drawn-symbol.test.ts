/**
 * DRAWN SYMBOLS — the picture a user draws for their own part. What these tests hold down:
 *  - the geometry: where each pin meets the body, which way an arc turns, how far a drawing reaches, and
 *    the node box derived from it (pin sides end AT the tips; pin-less sides square out to the grid);
 *  - the wire rule: every tip lands on the outer edge its pin points out of, checked in all four
 *    directions, because a tip anywhere else leaves its wire unroutable and drawn through the body;
 *  - one placement: the canvas handles, the node box and the drawn tip dots all come from the SAME
 *    placement, so a handle can only ever sit on its drawn tip;
 *  - the fallback: a part with no drawing — or a drawing that breaks a rule — is exactly the old box.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test } from 'vitest'
import { CATALOG_PARTS } from '../src/renderer/catalog-parts.ts'
import {
  arcPath,
  arcSweep,
  type DrawnSymbol,
  drawnSymbolBox,
  graphicInk,
  pinRoot,
  placeDrawnSymbol,
  type SymbolPin,
  shapeReach,
} from '../src/renderer/symbol-geometry.ts'
import { terminalsOf } from '../src/renderer/symbols.tsx'
import { UserPartSymbol } from '../src/renderer/user-part-glyphs.tsx'
import {
  registerUserPart,
  setUserParts,
  type UserPart,
  userPartDisplay,
  userPartGeometry,
} from '../src/renderer/user-parts.ts'
import { symbolProblems, validateDrawnSymbol } from '../src/renderer/user-symbol-validate.ts'
import { OPAMP_SYMBOL, opampPart, plainOpampPart } from './drawn-symbol-fixture.ts'

afterEach(() => setUserParts([]))

const sidesOf = (part: UserPart) => new Map(part.pins.map((p) => [p.id, p.side]))

/** A copy of the op-amp drawing with one drawn pin changed. */
function withPin(pinId: string, change: Partial<SymbolPin>): DrawnSymbol {
  return {
    ...OPAMP_SYMBOL,
    pins: OPAMP_SYMBOL.pins.map((p) => (p.pin === pinId ? { ...p, ...change } : p)),
  }
}

describe('pin geometry', () => {
  test('a pin runs from its tip straight in toward the body, in all four directions', () => {
    const tip = { x: 100, y: 100 }
    expect(pinRoot({ at: tip, length: 20 }, 'left')).toEqual({ x: 120, y: 100 })
    expect(pinRoot({ at: tip, length: 20 }, 'right')).toEqual({ x: 80, y: 100 })
    expect(pinRoot({ at: tip, length: 20 }, 'top')).toEqual({ x: 100, y: 120 })
    expect(pinRoot({ at: tip, length: 20 }, 'bottom')).toEqual({ x: 100, y: 80 })
  })

  test("the op-amp's supply pins end exactly on the triangle's slanted sides", () => {
    const part = opampPart()
    const sides = sidesOf(part)
    const root = (id: string) => {
      const pin = OPAMP_SYMBOL.pins.find((p) => p.pin === id) as SymbolPin
      return pinRoot(pin, sides.get(id) ?? 'left')
    }
    expect(root('v_pos')).toEqual({ x: 0, y: -30 })
    expect(root('v_neg')).toEqual({ x: 0, y: 30 })
    expect(root('out')).toEqual({ x: 60, y: 0 })
  })
})

describe('arcs through three points', () => {
  test('a quarter arc through its middle turns the way the middle says', () => {
    // Centre (0,0), radius 10: from (10,0) through (7.07,7.07) to (0,10) — y grows DOWN, so that is clockwise.
    const s = Math.SQRT1_2 * 10
    const clockwise = arcSweep({
      start: { x: 10, y: 0 },
      mid: { x: s, y: s },
      end: { x: 0, y: 10 },
    })
    expect(clockwise?.center.x).toBeCloseTo(0, 9)
    expect(clockwise?.center.y).toBeCloseTo(0, 9)
    expect(clockwise?.radius).toBeCloseTo(10, 9)
    expect(clockwise?.sweep).toBeCloseTo(Math.PI / 2, 9)
    // The same ends, the long way round through (−10, 0)… the three-quarter arc, the other direction.
    const longWay = arcSweep({
      start: { x: 10, y: 0 },
      mid: { x: -10, y: 0 },
      end: { x: 0, y: 10 },
    })
    expect(longWay?.sweep).toBeCloseTo((-3 * Math.PI) / 2, 9)
    expect(arcPath({ start: { x: 10, y: 0 }, mid: { x: -10, y: 0 }, end: { x: 0, y: 10 } })).toBe(
      'M 10 0 A 10 10 0 1 0 0 10',
    )
  })

  test('three points on one line are not an arc', () => {
    expect(
      arcSweep({ start: { x: 0, y: 0 }, mid: { x: 5, y: 5 }, end: { x: 10, y: 10 } }),
    ).toBeNull()
    expect(arcSweep({ start: { x: 3, y: 3 }, mid: { x: 9, y: 1 }, end: { x: 3, y: 3 } })).toBeNull()
  })

  test("an arc's reach includes the circle's extreme points it actually passes, and no others", () => {
    // A semicircle over the top of centre (0,0), radius 10: from (−10,0) through (0,−10) to (10,0).
    const top = shapeReach({
      kind: 'arc',
      start: { x: -10, y: 0 },
      mid: { x: 0, y: -10 },
      end: { x: 10, y: 0 },
      strokeWidth: 1,
      fill: 'none',
    })
    expect(top.minY).toBeCloseTo(-10, 9)
    expect(top.maxY).toBeCloseTo(0, 9) // it never goes below the centre line
    expect(top.minX).toBeCloseTo(-10, 9)
    expect(top.maxX).toBeCloseTo(10, 9)
  })

  test('ink is the geometry grown by half the line width', () => {
    const ink = graphicInk({
      kind: 'circle',
      center: { x: 0, y: 0 },
      radius: 10,
      strokeWidth: 2,
      fill: 'none',
    })
    expect(ink).toEqual({ minX: -11, minY: -11, maxX: 11, maxY: 11 })
  })
})

describe('the node box', () => {
  test('a side with pins ends exactly at their tips', () => {
    const box = drawnSymbolBox(OPAMP_SYMBOL, sidesOf(opampPart()))
    expect(box).toEqual({ minX: -40, minY: -60, maxX: 80, maxY: 60 })
  })

  test('a side with no pins squares out to the next grid line past all the ink, text included', () => {
    const symbol: DrawnSymbol = {
      graphics: [
        {
          kind: 'rectangle',
          start: { x: -3, y: -5 },
          end: { x: 23, y: 17 },
          strokeWidth: 2,
          fill: 'none',
        },
        { kind: 'text', at: { x: 10, y: 30 }, text: 'LABEL', size: 10 },
      ],
      pins: [{ pin: 'a', at: { x: -23, y: 0 }, length: 20, style: 'line' }],
      fields: OPAMP_SYMBOL.fields,
    }
    const box = drawnSymbolBox(symbol, new Map([['a', 'left' as const]]))
    expect(box.minX).toBe(-23) // the pin side: the tip, not the grid
    expect(box.minY).toBe(-20) // −5 − 1 (half the line) → −6 → the grid line at −20
    expect(box.maxX).toBe(40) // the text's estimated right end, 25 → 40
    expect(box.maxY).toBe(40) // the text's bottom, 35 → 40
  })

  test('placing the drawing moves it into the node box: every tip lands on its outer edge', () => {
    const placed = placeDrawnSymbol(OPAMP_SYMBOL, opampPart().pins)
    expect([placed.width, placed.height]).toEqual([120, 120])
    const tip = (id: string) => placed.pins.find((p) => p.pin === id)?.at
    expect(tip('in_minus')).toEqual({ x: 0, y: 40 })
    expect(tip('in_plus')).toEqual({ x: 0, y: 80 })
    expect(tip('out')).toEqual({ x: 120, y: 60 })
    expect(tip('v_pos')).toEqual({ x: 40, y: 0 })
    expect(tip('v_neg')).toEqual({ x: 40, y: 120 })
    // the fields move with it
    expect(placed.fields.reference.at).toEqual({ x: 70, y: 15 })
  })

  test('the placed pins follow the PART’s pin order, not the drawing’s', () => {
    const placed = placeDrawnSymbol(OPAMP_SYMBOL, opampPart().pins)
    expect(placed.pins.map((p) => p.pin)).toEqual(opampPart().pins.map((p) => p.id))
  })
})

describe('the rules a drawing must keep', () => {
  const pins = opampPart().pins

  test('the op-amp breaks none', () => {
    expect(symbolProblems(OPAMP_SYMBOL, pins)).toEqual([])
  })

  test.each([
    ['in_minus', { at: { x: -20, y: -20 } }, 'pin IN- points left', 'left edge'],
    ['out', { at: { x: 60, y: 0 } }, 'pin OUT points right', 'right edge'],
    ['v_pos', { at: { x: 0, y: -40 }, length: 10 }, 'pin V+ points up', 'top edge'],
    ['v_neg', { at: { x: 0, y: 40 }, length: 10 }, 'pin V- points down', 'bottom edge'],
  ])('a %s tip pulled in off its edge is refused', (pinId, change, who, edge) => {
    // A second pin on the same side keeps the edge where it was, so this tip is now INSIDE the box.
    const symbol = withPin(pinId, change)
    const extra: SymbolPin[] =
      pinId === 'out'
        ? [{ pin: 'x', at: { x: 80, y: 20 }, length: 20, style: 'line' }]
        : pinId === 'v_pos'
          ? [{ pin: 'x', at: { x: 20, y: -60 }, length: 40, style: 'line' }]
          : pinId === 'v_neg'
            ? [{ pin: 'x', at: { x: 20, y: 60 }, length: 40, style: 'line' }]
            : []
    const side = pins.find((p) => p.id === pinId)?.side ?? 'left'
    const withExtra = { ...symbol, pins: [...symbol.pins, ...extra] }
    const partPins = extra.length > 0 ? [...pins, { id: 'x', name: 'X', side }] : pins
    const problems = symbolProblems(withExtra, partPins)
    expect(problems.some((p) => p.includes(who) && p.includes(edge))).toBe(true)
  })

  test('a drawing that reaches past the pins on their side is refused', () => {
    const symbol: DrawnSymbol = {
      ...OPAMP_SYMBOL,
      graphics: [
        ...OPAMP_SYMBOL.graphics,
        { kind: 'circle', center: { x: -44, y: 0 }, radius: 2, strokeWidth: 1, fill: 'none' },
      ],
    }
    const problems = symbolProblems(symbol, pins)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('reaches past the pins on its left edge')
  })

  test('text may overflow a pin edge — its size is only an estimate, so it never decides where a wire lands', () => {
    const symbol: DrawnSymbol = {
      ...OPAMP_SYMBOL,
      graphics: [
        ...OPAMP_SYMBOL.graphics,
        { kind: 'text', at: { x: -40, y: 0 }, text: 'A VERY LONG LABEL', size: 10 },
      ],
    }
    expect(symbolProblems(symbol, pins)).toEqual([])
  })

  test('every pin is drawn exactly once, and nothing else is', () => {
    const missing = { ...OPAMP_SYMBOL, pins: OPAMP_SYMBOL.pins.filter((p) => p.pin !== 'v_neg') }
    expect(symbolProblems(missing, pins)).toEqual([
      "pin V- isn't drawn — every pin needs a spot for its wire to land",
    ])
    const twice = {
      ...OPAMP_SYMBOL,
      pins: [...OPAMP_SYMBOL.pins, OPAMP_SYMBOL.pins[0] as SymbolPin],
    }
    expect(symbolProblems(twice, pins)).toEqual(['pin IN- is drawn twice'])
    const stranger = {
      ...OPAMP_SYMBOL,
      pins: [...OPAMP_SYMBOL.pins, { pin: 'ghost', at: { x: 0, y: 0 }, length: 1, style: 'line' }],
    }
    expect(symbolProblems(stranger, pins)).toEqual([
      "drawn pin 6 doesn't belong to any of this part's pins",
    ])
  })

  test('shapes that cannot be drawn are refused, in plain words', () => {
    const shape = (graphic: unknown) =>
      symbolProblems({ ...OPAMP_SYMBOL, graphics: [...OPAMP_SYMBOL.graphics, graphic] }, pins)
    expect(shape({ kind: 'bezier' })[0]).toContain('unknown kind "bezier"')
    expect(
      shape({
        kind: 'arc',
        start: { x: 0, y: 0 },
        mid: { x: 5, y: 5 },
        end: { x: 10, y: 10 },
        strokeWidth: 1,
        fill: 'none',
      }),
    ).toEqual(["shape 4: an arc's start, middle and end can't sit on one straight line"])
    expect(
      shape({
        kind: 'rectangle',
        start: { x: 0, y: 0 },
        end: { x: 0, y: 10 },
        strokeWidth: 1,
        fill: 'none',
      }),
    ).toEqual(['shape 4: a rectangle needs both a width and a height'])
    expect(shape({ kind: 'text', at: { x: 0, y: 0 }, text: '   ', size: 10 })).toEqual([
      'shape 4: the text is empty',
    ])
    expect(
      shape({ kind: 'circle', center: { x: 0, y: 0 }, radius: 3, strokeWidth: 0, fill: 'none' }),
    ).toEqual(['shape 4: line width must be a number above 0'])
    expect(
      shape({ kind: 'polyline', points: [{ x: 0, y: 0 }], strokeWidth: 1, fill: 'solid' }),
    ).toEqual([
      'shape 4: fill must be none, outline or background',
      'shape 4: a line needs at least two points',
    ])
  })

  test('a drawing needs a body — text alone is not a symbol', () => {
    const textOnly = { ...OPAMP_SYMBOL, graphics: [OPAMP_SYMBOL.graphics[1]] }
    expect(symbolProblems(textOnly, pins)).toContain(
      "draw the part's body — at least one line, rectangle, circle or arc",
    )
  })

  test('an inverted pin must be long enough for its bubble', () => {
    const tooShort = withPin('out', { style: 'inverted', length: 4, at: { x: 64, y: 0 } })
    expect(symbolProblems(tooShort, pins)).toContain(
      'pin OUT: an inverted pin must be at least 6 px long to fit its bubble',
    )
  })

  test('all four fields must be there', () => {
    const { datasheet: _dropped, ...three } = OPAMP_SYMBOL.fields
    expect(symbolProblems({ ...OPAMP_SYMBOL, fields: three }, pins)).toEqual([
      'the datasheet field needs a position (x, y)',
    ])
  })

  test('the loader keeps only known fields, and a false flag is simply absent', () => {
    const noisy = {
      ...OPAMP_SYMBOL,
      futureThing: 1,
      pins: OPAMP_SYMBOL.pins.map((p) => ({ ...p, hideNumber: false, glow: 'blue' })),
    }
    const clean = validateDrawnSymbol(noisy, pins)
    expect(clean).toEqual(OPAMP_SYMBOL)
    // the output tip pulled back inside the triangle's point: refused, so nothing is loaded
    expect(validateDrawnSymbol(withPin('out', { at: { x: 40, y: 0 } }), pins)).toBeNull()
  })
})

describe('one placement for the box, the handles and the picture', () => {
  test('the handles sit exactly on the drawn tips, pointing out of their sides', () => {
    const part = opampPart()
    registerUserPart(part)
    const placed = placeDrawnSymbol(OPAMP_SYMBOL, part.pins)
    const terminals = terminalsOf(part.id, undefined)
    expect(terminals).toEqual(
      placed.pins.map((p) => ({
        id: p.pin,
        position: { left: 'left', right: 'right', top: 'top', bottom: 'bottom' }[p.side],
        at: p.at,
      })),
    )
  })

  test('the drawn tip dots are where the handles are', () => {
    const part = opampPart()
    registerUserPart(part)
    const html = renderToStaticMarkup(createElement(UserPartSymbol, { part }))
    const display = userPartDisplay(part)
    expect(display.kind).toBe('drawn')
    expect(html).toContain(`width="${display.width}" height="${display.height}"`)
    for (const t of display.terminals) {
      expect(html).toContain(`<circle cx="${t.at?.x}" cy="${t.at?.y}" r="2.4"`)
    }
  })

  test('the part without a drawing is exactly the old labelled box', () => {
    const withoutKey = plainOpampPart()
    const display = userPartDisplay(withoutKey)
    const box = userPartGeometry(withoutKey)
    expect(display.kind).toBe('box')
    expect([display.width, display.height]).toEqual([box.width, box.height])
    expect(display.terminals).toEqual(
      box.pins.map((p) => ({
        id: p.id,
        position: p.side,
        offset: p.side === 'left' || p.side === 'right' ? p.tipY : p.tipX,
      })),
    )
  })

  test('the catalog parts still draw at exactly the size and handle spots they always have', () => {
    // Pinned numbers: the box every shipped catalog part draws as, and each handle's side + offset. A
    // part with no drawing must never move — a shifted handle would put a saved wire on the wrong spot.
    const summary = CATALOG_PARTS.map((part) => {
      const d = userPartDisplay(part)
      return `${d.kind} ${d.width}×${d.height} ${d.terminals.map((t) => `${t.id}:${t.position}:${t.offset}`).join(' ')}`
    })
    expect(summary.slice(0, 3)).toEqual([
      'box 208×68 vin:left:24 en:left:44 vout:right:34 nc:top:104 gnd:bottom:104',
      'box 244×60 stby:left:30 out:right:30 vdd:top:122 gnd:bottom:122',
      'box 292×108 cs:left:24 wp:left:44 di:left:64 clk:left:84 do:right:24 hold:right:84 vcc:top:146 gnd:bottom:146',
    ])
    const left = Array.from({ length: 12 }, (_, i) => `p${i + 1}:left:${24 + 20 * i}`)
    const right = Array.from({ length: 12 }, (_, i) => `p${i + 25}:right:${24 + 20 * i}`)
    const top = Array.from({ length: 12 }, (_, i) => `p${i + 37}:top:${24 + 24 * i}`)
    const bottom = Array.from(
      { length: 13 },
      (_, i) => `p${i === 12 ? 49 : i + 13}:bottom:${24 + 22 * i}`,
    )
    expect(summary[3]).toBe(`box 312×268 ${[...left, ...right, ...top, ...bottom].join(' ')}`)
  })

  test('a drawing that breaks a rule is never shown — the part falls back to its box', () => {
    const broken = opampPart({ symbol: withPin('out', { at: { x: 40, y: 0 } }) })
    expect(userPartDisplay(broken).kind).toBe('box')
  })

  test('names, numbers and styles draw from the part and the drawing', () => {
    const part: UserPart = {
      id: 'my_flop',
      name: 'My Flop',
      designatorPrefix: 'U',
      pins: [
        { id: 'd', name: 'D', side: 'left', electrical: 'input', pad: '2' },
        { id: 'clk', name: 'CLK', side: 'left', electrical: 'input', pad: '3' },
        { id: 'q_bar', name: 'Q', side: 'right', electrical: 'output', pad: '6' },
      ],
      symbol: {
        graphics: [
          {
            kind: 'rectangle',
            start: { x: 0, y: 0 },
            end: { x: 60, y: 60 },
            strokeWidth: 1.6,
            fill: 'background',
          },
        ],
        pins: [
          { pin: 'd', at: { x: -20, y: 20 }, length: 20, style: 'line' },
          { pin: 'clk', at: { x: -20, y: 40 }, length: 20, style: 'clock', hideNumber: true },
          { pin: 'q_bar', at: { x: 80, y: 20 }, length: 20, style: 'inverted' },
        ],
        fields: OPAMP_SYMBOL.fields,
      },
    }
    registerUserPart(part)
    const html = renderToStaticMarkup(createElement(UserPartSymbol, { part }))
    expect(html).toContain('>D</text>')
    expect(html).toContain('>CLK</text>')
    expect(html).toContain('>2</text>') // D's pad, as its number
    expect(html).not.toContain('>3</text>') // CLK hides its number
    expect(html).toContain('>6</text>')
    // The box starts at (−20, −20), so everything shifts by +20. Q's root is on the body at (80, 40):
    // its bubble sits against the body, centred 3 px out, and its line stops short of the bubble.
    expect(html).toContain('<circle cx="83" cy="40" r="3"')
    expect(html).toContain('<line x1="100" y1="40" x2="86" y2="40"')
    // CLK's wedge: two corners on the body edge either side of its root (20, 60), the point 4 px in
    expect(html).toContain('points="20,64 24,60 20,56"')
  })
})
