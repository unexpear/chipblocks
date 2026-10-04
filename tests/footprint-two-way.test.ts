/**
 * Part ↔ board footprint sync. Changing the part's assignment refreshes the placement.
 * A user-owned footprint edit writes back onto that part and the next derive sees the new
 * pads. Role-sensitive kinds stay unassigned. A provisional land keeps its id and flag.
 */
import { afterEach, describe, expect, test } from 'vitest'
import {
  BUILTIN_FOOTPRINTS,
  type Footprint,
  PROVISIONAL_LAND_NOTE,
} from '../src/renderer/footprint.ts'
import {
  applyUserOwnedFootprintEdit,
  footprintForPart,
} from '../src/renderer/footprint-assignment.ts'
import { deriveBoard, footprintByPlacement, placePoint } from '../src/renderer/pcb-board.ts'
import { buildBomCsv } from '../src/renderer/pcb-fab.ts'
import { footprintProblems } from '../src/renderer/user-footprint-validate.ts'
import {
  registerUserFootprint,
  resolveFootprint,
  setUserFootprints,
} from '../src/renderer/user-footprints.ts'

afterEach(() => setUserFootprints([]))

function land(id: string, centers: { x: number; y: number }[], provisional?: boolean): Footprint {
  return {
    id,
    name: id,
    description: 'user land',
    pads: centers.map((center, i) => ({
      id: String(i + 1),
      center,
      size: { w: 0.8, h: 0.95 },
      shape: 'roundrect' as const,
      type: 'smd' as const,
    })),
    silkscreen: [],
    fabrication: [],
    labels: { reference: { x: 0, y: -2 }, value: { x: 0, y: 2 }, fabReference: { x: 0, y: 0 } },
    courtyard: { x: -3, y: -3, w: 6, h: 6 },
    ...(provisional === true ? { provisional: true } : {}),
    provenance: {
      source_type: 'datasheet',
      title: 'test land',
      citation: 'drawing',
      confidence: 'high',
    },
  }
}

const TWO = [
  { x: -0.8, y: 0 },
  { x: 0.8, y: 0 },
]
const FOUR = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
]

describe('assignment change refreshes the placement', () => {
  test('a new package replaces the pads and keeps a hand-placed spot', () => {
    const overrides = new Map([['R1', { x: 12, y: -4, rotation: 90 as const }]])
    const before = deriveBoard([{ id: 'R1', definition: 'resistor' }], overrides)
    const after = deriveBoard(
      [{ id: 'R1', definition: 'resistor', footprintId: 'R_0805_2012Metric' }],
      overrides,
    )
    const was = before.placements[0]
    const now = after.placements[0]
    if (was === undefined || now === undefined) throw new Error('resistor not placed')
    expect(was.footprintId).toBe('R_0603_1608Metric')
    expect(now.footprintId).toBe('R_0805_2012Metric')
    expect(now).toMatchObject({ x: 12, y: -4, rotation: 90 })
    const padBefore = footprintByPlacement(was)?.pads[0]
    const padAfter = footprintByPlacement(now)?.pads[0]
    if (padBefore === undefined || padAfter === undefined) throw new Error('missing pad')
    expect(padAfter.size.w * padAfter.size.h).toBeGreaterThan(padBefore.size.w * padBefore.size.h)
    const placed = placePoint(now, padAfter.center)
    const stale = placePoint(now, padBefore.center)
    expect(placed.y).not.toBeCloseTo(stale.y, 6)
  })
})

describe('a user-owned footprint edit round-trips', () => {
  test('same-id geometry reflows, a new id retargets the part, a built-in does not', () => {
    const original = land('USER_LAND', TWO)
    expect(registerUserFootprint(original)).toBe(true)
    const part = { id: 'R1', definition: 'resistor', footprintId: 'USER_LAND' }
    const overrides = new Map([['R1', { x: 3, y: 4, rotation: 0 as const }]])
    const first = deriveBoard([part], overrides)
    const placed = first.placements[0]
    if (placed === undefined) throw new Error('not placed')
    expect(placed.footprintId).toBe('USER_LAND')
    expect(footprintByPlacement(placed)?.pads[0]?.center).toEqual(TWO[0])

    const moved = land('USER_LAND', [{ x: -1.5, y: 0.4 }, TWO[1] as { x: number; y: number }])
    expect(registerUserFootprint(moved)).toBe(true)
    const sameId = applyUserOwnedFootprintEdit(part, moved)
    expect(sameId.footprintId).toBe('USER_LAND')
    const second = deriveBoard([sameId], overrides)
    const again = second.placements[0]
    if (again === undefined) throw new Error('not placed')
    expect(footprintByPlacement(again)?.pads[0]?.center).toEqual({ x: -1.5, y: 0.4 })
    expect(again).toMatchObject({ x: 3, y: 4, rotation: 0 })

    const renamed = land('USER_LAND_B', [{ x: -1.5, y: 0.4 }, TWO[1] as { x: number; y: number }])
    expect(registerUserFootprint(renamed)).toBe(true)
    const retargeted = applyUserOwnedFootprintEdit(part, renamed)
    expect(retargeted.footprintId).toBe('USER_LAND_B')
    const third = deriveBoard([retargeted], overrides)
    expect(third.placements[0]?.footprintId).toBe('USER_LAND_B')
    expect(
      footprintByPlacement(third.placements[0] as NonNullable<typeof placed>)?.pads[0]?.center.x,
    ).toBe(-1.5)

    const builtin = BUILTIN_FOOTPRINTS.R_0805_2012Metric
    if (builtin === undefined) throw new Error('missing builtin')
    expect(applyUserOwnedFootprintEdit(part, builtin).footprintId).toBe('USER_LAND')

    const tooWide = land('USER_LAND_4', FOUR)
    expect(registerUserFootprint(tooWide)).toBe(true)
    expect(applyUserOwnedFootprintEdit(part, tooWide).footprintId).toBe('USER_LAND')
    expect(deriveBoard([{ ...part, footprintId: 'USER_LAND_4' }]).placements[0]?.footprintId).toBe(
      'R_0603_1608Metric',
    )
  })
})

describe('role-sensitive parts stay blocked', () => {
  test('a user footprint is not assigned to a transformer, SPDT, op-amp, relay, or block', () => {
    const edited = land('USER_LAND', FOUR)
    expect(registerUserFootprint(edited)).toBe(true)
    for (const definition of [
      'transformer',
      'transformer_center_tapped',
      'switch_spdt',
      'op_amp',
      'relay',
      'block',
    ]) {
      expect(footprintForPart(definition), definition).toBeUndefined()
      const next = applyUserOwnedFootprintEdit({ definition }, edited)
      expect(next.footprintId, definition).toBeUndefined()
      expect(footprintForPart(next.definition, next.footprintId), definition).toBeUndefined()
      expect(
        deriveBoard([{ id: 'X', definition, footprintId: edited.id }]).placements,
        definition,
      ).toEqual([])
    }
  })
})

describe('a provisional land stays labeled', () => {
  test('a fuse keeps provisional_2pad, and that id cannot be overwritten', () => {
    const fuse = footprintForPart('fuse')
    expect(fuse?.id).toBe('provisional_2pad')
    expect(fuse?.provisional).toBe(true)
    expect(fuse?.description).toContain(PROVISIONAL_LAND_NOTE)

    const edited = land('USER_LAND', TWO)
    expect(registerUserFootprint(edited)).toBe(true)
    const part = applyUserOwnedFootprintEdit({ definition: 'fuse' }, edited)
    expect(part.footprintId).toBeUndefined()
    const board = deriveBoard([{ id: 'F1', definition: 'fuse' }])
    expect(board.placements[0]?.footprintId).toBe('provisional_2pad')
    expect(
      footprintByPlacement(board.placements[0] as NonNullable<(typeof board.placements)[0]>)
        ?.provisional,
    ).toBe(true)

    const impostor = land('provisional_2pad', TWO)
    expect(footprintProblems(impostor).join(' ')).toMatch(/provisional/)
    expect(registerUserFootprint({ ...impostor, provisional: false })).toBe(false)
    expect(resolveFootprint('provisional_2pad')?.provisional).toBe(true)
    expect(resolveFootprint('provisional_2pad')?.id).toBe('provisional_2pad')

    const flagged = land('USER_FLAGGED', TWO, true)
    expect(registerUserFootprint(flagged)).toBe(true)
    expect(
      applyUserOwnedFootprintEdit({ definition: 'resistor', footprintId: 'USER_LAND' }, flagged)
        .footprintId,
    ).toBe('USER_LAND')

    const bom = buildBomCsv([
      { reference: 'F1', definition: 'fuse', value: '', footprintId: 'provisional_2pad' },
    ])
    expect(bom).toContain('provisional_2pad')
    expect(bom).toContain(PROVISIONAL_LAND_NOTE)
  })
})
