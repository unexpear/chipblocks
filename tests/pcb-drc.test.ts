/**
 * Board DRC. Jobs: a legal board passes clean; parts dragged into collision are caught by the
 * courtyard rule; different nets' pad copper too close is a clearance violation with a real
 * position; copper hugging the board edge is caught with the cited 0.3 mm fab limit; and every rule
 * carries provenance (the anti-placeholder rule applies to manufacturing limits too).
 */
import { describe, expect, test } from 'vitest'
import { canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { type BoardPart, computeRatsnest, deriveBoard } from '../src/renderer/pcb-board.ts'
import { DRC_RULES, runDrc } from '../src/renderer/pcb-drc.ts'
import { routeBoard } from '../src/renderer/pcb-route.ts'

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

test('every DRC rule carries a cited limit', () => {
  for (const rule of Object.values(DRC_RULES)) {
    expect(rule.limitMm).toBeGreaterThanOrEqual(0)
    expect(rule.provenance.citation.length).toBeGreaterThan(10)
    expect(rule.provenance.confidence).toBe('high')
  }
})

describe('runDrc', () => {
  test('a legal routed board passes clean', () => {
    const defs: [string, string][] = [
      ['R1', 'resistor'],
      ['R2', 'resistor'],
    ]
    const board = deriveBoard(parts(defs))
    const rn = computeRatsnest(world(defs, [['R1', 'terminal_b', 'R2', 'terminal_a']]), board)
    const routing = routeBoard(rn)
    expect(runDrc(board, rn, routing)).toEqual([])
  })

  test('parts dragged into collision: the courtyards overlap and the spot is marked', () => {
    const defs: [string, string][] = [
      ['R1', 'resistor'],
      ['R2', 'resistor'],
    ]
    // 1 mm apart — courtyards are 2.96 mm wide, so they overlap around the midpoint
    const overrides = new Map([
      ['R1', { x: 0, y: 0, rotation: 0 as const }],
      ['R2', { x: 1, y: 0, rotation: 0 as const }],
    ])
    const board = deriveBoard(parts(defs), overrides)
    const rn = computeRatsnest(world(defs, []), board)
    const violations = runDrc(board, rn, routeBoard(rn))
    const courtyard = violations.filter((v) => v.code === 'courtyard-overlap')
    expect(courtyard).toHaveLength(1)
    const v = courtyard[0]
    if (v === undefined) throw new Error('missing violation')
    expect(v.message).toContain('R1')
    expect(v.message).toContain('R2')
    expect(v.at.x).toBeGreaterThan(-1.5)
    expect(v.at.x).toBeLessThan(2.5)
  })

  test('two nets’ pad copper too close is a clearance violation', () => {
    // R2 rotated and pushed so its pad copper lands within the 0.2 mm clearance of R1's.
    const defs: [string, string][] = [
      ['R1', 'resistor'],
      ['R2', 'resistor'],
      ['R3', 'resistor'],
      ['R4', 'resistor'],
    ]
    const overrides = new Map([
      ['R1', { x: 0, y: 0, rotation: 0 as const }],
      ['R3', { x: 20, y: 0, rotation: 0 as const }],
      ['R2', { x: 0.9, y: 1, rotation: 0 as const }], // pad 1 copper ~0.1 mm from R1's pad 2
      ['R4', { x: 20, y: 6, rotation: 0 as const }],
    ])
    const board = deriveBoard(parts(defs), overrides)
    const rn = computeRatsnest(
      world(defs, [
        ['R1', 'terminal_b', 'R3', 'terminal_a'],
        ['R2', 'terminal_a', 'R4', 'terminal_a'],
      ]),
      board,
    )
    const violations = runDrc(board, rn, routeBoard(rn))
    expect(violations.some((v) => v.code === 'copper-clearance')).toBe(true)
  })

  test('copper within 0.3 mm of the board edge is caught (the mill would tear it)', () => {
    // A hand-built tight outline — the app's auto outline keeps a 2.5 mm margin, but outlines
    // become user-editable later and the rule must already be honest.
    const defs: [string, string][] = [['R1', 'resistor']]
    const auto = deriveBoard(parts(defs))
    const rn = computeRatsnest(world(defs, []), auto)
    const tight = {
      outline: { x: -0.5, y: -0.6, w: 4, h: 1.2 },
      placements: auto.placements,
    }
    const violations = runDrc(tight, rn, routeBoard(rn))
    expect(violations.some((v) => v.code === 'edge-clearance')).toBe(true)
  })

  test('a trace below the minimum manufacturable width is flagged', () => {
    const defs: [string, string][] = [['R1', 'resistor']]
    const board = deriveBoard(parts(defs))
    const rn = computeRatsnest(world(defs, []), board)
    const routing = {
      traces: [
        {
          net: 'net_1',
          widthMm: 0.1,
          points: [
            { x: 1, y: 0 },
            { x: 2, y: 0 },
          ],
          layer: 'top' as const,
        },
      ],
      vias: [],
      unrouted: [],
    }
    const violations = runDrc(board, rn, routing)
    expect(violations.some((v) => v.code === 'track-width')).toBe(true)
  })

  test('an undersized via and two crowding holes are flagged with their cited limits', () => {
    const defs: [string, string][] = [['R1', 'resistor']]
    const board = deriveBoard(parts(defs))
    const rn = computeRatsnest(world(defs, []), board)
    const routing = {
      traces: [],
      // drill 0.2 < the 0.3 mm floor; ring (0.3−0.2)/2 = 0.05 is exactly legal (no annular flag);
      // the second via's hole sits 0.5 mm away → edge gap 0.5 − 0.3 = 0.2 < 0.25 → hole-to-hole.
      vias: [
        { net: 'a', at: { x: 20, y: 20 }, diameterMm: 0.3, drillMm: 0.2 },
        { net: 'a', at: { x: 20.5, y: 20 }, diameterMm: 0.6, drillMm: 0.4 },
      ],
      unrouted: [],
    }
    const violations = runDrc(board, rn, routing)
    expect(violations.some((v) => v.code === 'via-size' && v.message.includes('0.2'))).toBe(true)
    expect(violations.some((v) => v.code === 'hole-to-hole')).toBe(true)
  })
})
