/**
 * The PCB board model + auto-placement + ratsnest. Jobs: only footprinted parts land on the board (a
 * BJT with no footprint is skipped, not dropped somewhere wrong), placements don't overlap, the
 * outline fits around everything, and the ratsnest owes exactly the solver's connectivity (nets that
 * merge through a ground rail owe an airwire; off-board pins are counted, never hidden) — the
 * invariants a physical layout must hold before routing can trust it.
 */
import { describe, expect, test } from 'vitest'
import { canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import {
  type BoardPart,
  computeRatsnest,
  deriveBoard,
  footprintByPlacement,
  offBoardPins,
  placementBounds,
  placePoint,
} from '../src/renderer/pcb-board.ts'

const parts = (defs: [string, string][]): BoardPart[] =>
  defs.map(([id, definition]) => ({ id, definition }))

/** A canvas-shaped world: nodes as {id, definition} + wires as [source, handle, target, handle]. */
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

describe('deriveBoard', () => {
  test('places only the footprinted parts; skips ones with no package', () => {
    // R1, C1 have footprints (0603); Q1 (BJT) and D1 (LED) do not yet.
    const board = deriveBoard(
      parts([
        ['R1', 'resistor'],
        ['Q1', 'transistor_bjt_npn'],
        ['C1', 'capacitor'],
        ['D1', 'led'],
      ]),
    )
    expect(board.placements.map((p) => p.partId)).toEqual(['R1', 'C1'])
    expect(board.placements.every((p) => p.footprintId === 'R_0603_1608Metric')).toBe(true)
  })

  test('lays parts out left-to-right without overlapping courtyards', () => {
    const board = deriveBoard(
      parts([
        ['R1', 'resistor'],
        ['R2', 'resistor'],
        ['R3', 'resistor'],
      ]),
    )
    expect(board.placements).toHaveLength(3)
    const boxes = board.placements.map((p) => {
      const fp = footprintByPlacement(p)
      if (fp === undefined) throw new Error('missing footprint')
      return placementBounds(p, fp)
    })
    // each part sits strictly to the right of the previous (no overlap in x)
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i]?.minX ?? 0).toBeGreaterThanOrEqual((boxes[i - 1]?.maxX ?? 0) - 1e-9)
    }
  })

  test('the outline contains every placed footprint', () => {
    const board = deriveBoard(
      parts([
        ['R1', 'resistor'],
        ['C1', 'capacitor'],
      ]),
    )
    const o = board.outline
    for (const p of board.placements) {
      const fp = footprintByPlacement(p)
      if (fp === undefined) continue
      const bb = placementBounds(p, fp)
      expect(bb.minX).toBeGreaterThanOrEqual(o.x - 1e-9)
      expect(bb.minY).toBeGreaterThanOrEqual(o.y - 1e-9)
      expect(bb.maxX).toBeLessThanOrEqual(o.x + o.w + 1e-9)
      expect(bb.maxY).toBeLessThanOrEqual(o.y + o.h + 1e-9)
    }
  })

  test('an empty (or footprint-free) schematic yields an empty board, not a crash', () => {
    expect(deriveBoard([]).placements).toEqual([])
    expect(deriveBoard(parts([['Q1', 'transistor_bjt_npn']])).placements).toEqual([])
    expect(deriveBoard([]).outline.w).toBeGreaterThan(0)
  })
})

describe('placementBounds respects rotation', () => {
  test('a 90° turn swaps the footprint width and height', () => {
    const p0 = { partId: 'R1', footprintId: 'R_0603_1608Metric', x: 0, y: 0, rotation: 0 as const }
    const p90 = { ...p0, rotation: 90 as const }
    const fp = footprintByPlacement(p0)
    if (fp === undefined) throw new Error('missing')
    const b0 = placementBounds(p0, fp)
    const b90 = placementBounds(p90, fp)
    expect(b90.maxX - b90.minX).toBeCloseTo(b0.maxY - b0.minY, 6)
    expect(b90.maxY - b90.minY).toBeCloseTo(b0.maxX - b0.minX, 6)
  })

  test('placePoint turns about the footprint ORIGIN, matching the renderer transform', () => {
    // A DIP-8's origin is pin 1, not the part centre — pad 8 sits at (7.62, 0) local.
    // SVG rotate(90) maps (x, y) → (−y, x), so at placement (10, 5): (10 − 0, 5 + 7.62).
    const pl = { partId: 'U1', footprintId: 'DIP-8_W7.62mm', x: 10, y: 5, rotation: 90 as const }
    const placed = placePoint(pl, { x: 7.62, y: 0 })
    expect(placed.x).toBeCloseTo(10, 9)
    expect(placed.y).toBeCloseTo(12.62, 9)
    // And the rotated bounds contain that rotated pad.
    const fp = footprintByPlacement(pl)
    if (fp === undefined) throw new Error('missing')
    const bb = placementBounds(pl, fp)
    expect(bb.minX).toBeLessThanOrEqual(10)
    expect(bb.maxY).toBeGreaterThanOrEqual(12.62)
  })
})

describe('computeRatsnest', () => {
  test('a directly wired pair owes one airwire between the RIGHT pads', () => {
    const defs: [string, string][] = [
      ['R1', 'resistor'],
      ['R2', 'resistor'],
    ]
    const board = deriveBoard(parts(defs))
    const rn = computeRatsnest(world(defs, [['R1', 'terminal_b', 'R2', 'terminal_a']]), board)
    expect(rn.airwires).toHaveLength(1)
    const [pl1, pl2] = board.placements
    if (pl1 === undefined || pl2 === undefined) throw new Error('missing placements')
    const fp = footprintByPlacement(pl1)
    if (fp === undefined) throw new Error('missing footprint')
    const pad1 = fp.pads.find((p) => p.id === '1')
    const pad2 = fp.pads.find((p) => p.id === '2')
    if (pad1 === undefined || pad2 === undefined) throw new Error('missing pads')
    // terminal_b solders to pad 2, terminal_a to pad 1 (the TERMINAL_PADS convention).
    const ends = [rn.airwires[0]?.from, rn.airwires[0]?.to]
    expect(ends).toContainEqual(placePoint(pl1, pad2.center))
    expect(ends).toContainEqual(placePoint(pl2, pad1.center))
  })

  test('three pins tied by a junction → two airwires (a spanning tree, not a triangle)', () => {
    const defs: [string, string][] = [
      ['R1', 'resistor'],
      ['R2', 'resistor'],
      ['R3', 'resistor'],
      ['J1', 'junction'],
    ]
    const board = deriveBoard(parts(defs))
    const rn = computeRatsnest(
      world(defs, [
        ['R1', 'terminal_b', 'J1', 'junction'],
        ['R2', 'terminal_a', 'J1', 'junction'],
        ['R3', 'terminal_a', 'J1', 'junction'],
      ]),
      board,
    )
    expect(rn.airwires).toHaveLength(2)
  })

  test('two resistors joined only through ground symbols still owe an airwire', () => {
    // R1.b→GND1, R2.b→GND2: every ground is ONE net (the 0 V reference), so the board owes
    // R1.b—R2.b copper even though no wire is drawn between them — exactly what the solver sees.
    const defs: [string, string][] = [
      ['R1', 'resistor'],
      ['R2', 'resistor'],
      ['GND1', 'ground'],
      ['GND2', 'ground'],
    ]
    const board = deriveBoard(parts(defs))
    const rn = computeRatsnest(
      world(defs, [
        ['R1', 'terminal_b', 'GND1', 'reference_terminal'],
        ['R2', 'terminal_b', 'GND2', 'reference_terminal'],
      ]),
      board,
    )
    expect(rn.airwires).toHaveLength(1)
  })

  test('a named power rail (two +5V labels) merges its pins into one owed connection', () => {
    const nodes = [
      { id: 'R1', definition: 'resistor' },
      { id: 'R2', definition: 'resistor' },
      { id: 'L1', definition: 'net_label', parameters: { net_name: { value: '+5V' } } },
      { id: 'L2', definition: 'net_label', parameters: { net_name: { value: '+5V' } } },
    ]
    const w = canvasToWorld(nodes, [
      {
        id: 'w0',
        source: 'R1',
        sourceHandle: 'terminal_a',
        target: 'L1',
        targetHandle: 'reference_terminal',
      },
      {
        id: 'w1',
        source: 'R2',
        sourceHandle: 'terminal_a',
        target: 'L2',
        targetHandle: 'reference_terminal',
      },
    ])
    const board = deriveBoard(
      parts([
        ['R1', 'resistor'],
        ['R2', 'resistor'],
      ]),
    )
    const rn = computeRatsnest(w, board)
    expect(rn.airwires).toHaveLength(1)
  })

  test('one on-board pad wired to an unplaceable part yields no airwire (nothing to span)', () => {
    const defs: [string, string][] = [
      ['R1', 'resistor'],
      ['Q1', 'transistor_bjt_npn'],
    ]
    const board = deriveBoard(parts(defs)) // only R1 lands on the board
    const rn = computeRatsnest(world(defs, [['R1', 'terminal_b', 'Q1', 'base']]), board)
    expect(rn.airwires).toHaveLength(0)
  })
})

describe('offBoardPins (the header count)', () => {
  const wires = (
    defs: [string, string, string, string][],
  ): { source: string; sourceHandle: string; target: string; targetHandle: string }[] =>
    defs.map(([source, sourceHandle, target, targetHandle]) => ({
      source,
      sourceHandle,
      target,
      targetHandle,
    }))

  test('fully-placed wiring counts zero; grounds and junctions are never pins', () => {
    const defs: [string, string][] = [
      ['R1', 'resistor'],
      ['R2', 'resistor'],
      ['GND1', 'ground'],
      ['J1', 'junction'],
    ]
    const board = deriveBoard(parts(defs))
    const n = offBoardPins(
      parts(defs),
      wires([
        ['R1', 'terminal_b', 'J1', 'junction'],
        ['R2', 'terminal_a', 'J1', 'junction'],
        ['R1', 'terminal_a', 'GND1', 'reference_terminal'],
      ]),
      board,
    )
    expect(n).toBe(0)
  })

  test('a wired pin whose part has no footprint is COUNTED, never hidden — once per pin', () => {
    const defs: [string, string][] = [
      ['R1', 'resistor'],
      ['R2', 'resistor'],
      ['Q1', 'transistor_bjt_npn'],
    ]
    const board = deriveBoard(parts(defs))
    // Q1's base carries TWO wires — still ONE pin the board can't show.
    const n = offBoardPins(
      parts(defs),
      wires([
        ['R1', 'terminal_b', 'Q1', 'base'],
        ['R2', 'terminal_a', 'Q1', 'base'],
        ['R2', 'terminal_b', 'Q1', 'collector'],
      ]),
      board,
    )
    expect(n).toBe(2) // base (once) + collector
  })

  test('counts the pins the user DREW, not flattening internals', () => {
    // The canvas has one multi-lead source node; the solver world would expand it into sections
    // with seam terminals — but the header must count only the schematic's own wired pins.
    const defs: [string, string][] = [
      ['V1', 'power_source'],
      ['R1', 'resistor'],
    ]
    const board = deriveBoard(parts(defs))
    const n = offBoardPins(
      parts(defs),
      wires([
        ['V1', 'terminal_positive', 'R1', 'terminal_a'],
        ['R1', 'terminal_b', 'V1', 'terminal_negative'],
      ]),
      board,
    )
    expect(n).toBe(2) // exactly the source's two drawn pins — never its expansion seams
  })
})
