/**
 * Board-side per-pad editing: one placed pad's board centre / size (or a quarter turn) is written into
 * the placement's user-owned footprint through the place → footprint re-derive, and the board then
 * shows exactly that copper. Built-in, provisional, and role-sensitive lands refuse with a named
 * reason and register nothing. A board drag delta becomes a PlacedPadEdit via padEditFromDrag
 * (move / edge / corner) and commits through the same path.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { BUILTIN_FOOTPRINTS, type Footprint } from '../src/renderer/footprint.ts'
import {
  type BoardPart,
  deriveBoard,
  type Placement,
  type PlacementOverride,
} from '../src/renderer/pcb-board.ts'
import { hitPlacedPad } from '../src/renderer/pcb-pick.ts'
import { type PlacedLand, placedLandOf } from '../src/renderer/placement-footprint.ts'
import {
  commitPlacementPadEdit,
  editPlacedLand,
  padEditFromDrag,
  placementPadEditGate,
} from '../src/renderer/placement-pad-edit.ts'
import {
  getUserFootprintsSnapshot,
  registerUserFootprint,
  resolveFootprint,
  setUserFootprints,
} from '../src/renderer/user-footprints.ts'
import { registerUserPart, setUserParts, type UserPart } from '../src/renderer/user-parts.ts'

afterEach(() => {
  setUserFootprints([])
  setUserParts([])
})

function land(id: string, shape: 'roundrect' | 'circle' = 'roundrect'): Footprint {
  const size = shape === 'circle' ? { w: 0.9, h: 0.9 } : { w: 0.8, h: 0.95 }
  return {
    id,
    name: id,
    description: 'user land',
    pads: [
      { id: '1', center: { x: -0.8, y: 0 }, size, shape, type: 'smd' },
      { id: '2', center: { x: 0.8, y: 0 }, size, shape, type: 'smd' },
    ],
    silkscreen: [],
    fabrication: [],
    labels: { reference: { x: 0, y: -2 }, value: { x: 0, y: 2 }, fabReference: { x: 0, y: 0 } },
    courtyard: { x: -4, y: -3, w: 8, h: 6 },
    provenance: {
      source_type: 'datasheet',
      title: 'test',
      citation: 'drawing',
      confidence: 'high',
    },
  }
}

function placed(
  part: BoardPart,
  spot?: PlacementOverride,
): { placement: Placement; land: PlacedLand } {
  const board = deriveBoard([part], spot ? new Map([[part.id, spot]]) : undefined)
  const placement = board.placements[0]
  if (placement === undefined) throw new Error(`${part.id} not placed`)
  const l = placedLandOf(placement)
  if (l === undefined) throw new Error('land did not resolve')
  return { placement, land: l }
}

const padOf = (l: PlacedLand, id: string) => {
  const pad = l.pads.find((p) => p.id === id)
  if (pad === undefined) throw new Error(id)
  return {
    x: Number(pad.center.x.toFixed(6)) + 0,
    y: Number(pad.center.y.toFixed(6)) + 0,
    w: Number(pad.size.w.toFixed(6)),
    h: Number(pad.size.h.toFixed(6)),
  }
}

describe('edit a pad on the board', () => {
  test('size + position in board mm land in the user footprint at every quarter turn', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      setUserFootprints([])
      registerUserFootprint(land('USER_LAND'))
      const part: BoardPart = { id: 'R1', definition: 'resistor', footprintId: 'USER_LAND' }
      const { placement, land: before } = placed(part, { x: 10, y: 5, rotation })
      const two = padOf(before, '2')
      const edit = { padId: '2', x: two.x + 0.3, y: two.y - 0.2, w: 1.1, h: 0.6 }
      const result = commitPlacementPadEdit({ part, placement, edit, otherParts: [part] })
      expect(result.ok, String(rotation)).toBe(true)
      if (!result.ok) continue
      expect(result).toMatchObject({
        mode: 'updated',
        unchanged: false,
        padId: '2',
        sharedWith: [],
      })
      expect(result.footprint.id).toBe('USER_LAND')
      expect(result.footprint.provenance).toMatchObject({
        source_type: 'derived',
        confidence: 'low',
      })
      const after = placed(result.part, result.pin)
      expect(padOf(after.land, '2')).toEqual({
        x: Number(edit.x.toFixed(6)),
        y: Number(edit.y.toFixed(6)),
        w: 1.1,
        h: 0.6,
      })
      // the untouched pad stays exactly where it was
      expect(padOf(after.land, '1')).toEqual(padOf(before, '1'))
      expect(resolveFootprint('USER_LAND')?.pads.map((p) => p.id)).toEqual(['1', '2'])
    }
  })

  test('a quarter turn swaps the pad’s copper w/h and keeps its centre', () => {
    registerUserFootprint(land('USER_LAND'))
    const part: BoardPart = { id: 'R1', definition: 'resistor', footprintId: 'USER_LAND' }
    const { placement, land: before } = placed(part, { x: 3, y: 3, rotation: 90 })
    const result = commitPlacementPadEdit({
      part,
      placement,
      edit: { padId: '1', quarterTurn: true },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const was = padOf(before, '1')
    expect(padOf(placed(result.part, result.pin).land, '1')).toEqual({ ...was, w: was.h, h: was.w })
    // local frame too: the footprint's pad 1 is now 0.95 × 0.8
    expect(result.footprint.pads[0]?.size).toEqual({ w: 0.95, h: 0.8 })
  })

  test('a no-op edit registers nothing', () => {
    registerUserFootprint(land('USER_LAND'))
    const part: BoardPart = { id: 'R1', definition: 'resistor', footprintId: 'USER_LAND' }
    const { placement, land: l } = placed(part)
    const snapshot = getUserFootprintsSnapshot()
    const result = commitPlacementPadEdit({
      part,
      placement,
      edit: { padId: '1', ...padOf(l, '1') },
    })
    expect(result).toMatchObject({ ok: true, unchanged: true })
    expect(getUserFootprintsSnapshot()).toBe(snapshot)
  })

  test('a shared user footprint names the other parts the edit re-shapes', () => {
    registerUserFootprint(land('USER_LAND'))
    const a: BoardPart = { id: 'R1', definition: 'resistor', footprintId: 'USER_LAND' }
    const b: BoardPart = { id: 'R2', definition: 'resistor', footprintId: 'USER_LAND' }
    const { placement } = placed(a)
    const result = commitPlacementPadEdit({
      part: a,
      placement,
      edit: { padId: '1', w: 1 },
      otherParts: [a, b],
    })
    expect(result).toMatchObject({ ok: true, sharedWith: ['R2'] })
  })

  test('the board pick finds the pad under a click on a turned part', () => {
    registerUserFootprint(land('USER_LAND'))
    const { placement, land: l } = placed(
      { id: 'R1', definition: 'resistor', footprintId: 'USER_LAND' },
      { x: 10, y: 10, rotation: 90 },
    )
    const fp = resolveFootprint('USER_LAND') as Footprint
    const two = padOf(l, '2')
    expect(hitPlacedPad(placement, fp, { x: two.x, y: two.y + two.h / 2 - 0.01 })).toBe('2')
    expect(hitPlacedPad(placement, fp, padOf(l, '1'))).toBe('1')
    expect(hitPlacedPad(placement, fp, { x: 10, y: 10 })).toBeNull()
  })
})

describe('pad drag delta → edit → commit', () => {
  test('a move drag shifts the pad centre by the board-mm delta', () => {
    registerUserFootprint(land('USER_LAND'))
    const part: BoardPart = { id: 'R1', definition: 'resistor', footprintId: 'USER_LAND' }
    const { placement, land: before } = placed(part, { x: 4, y: 2, rotation: 0 })
    const start = { id: '2', ...padOf(before, '2') }
    const edit = padEditFromDrag(start, 'move', 0.4, -0.25)
    expect(edit).toEqual({ padId: '2', x: start.x + 0.4, y: start.y - 0.25 })
    const result = commitPlacementPadEdit({ part, placement, edit })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(padOf(placed(result.part, result.pin).land, '2')).toEqual({
      x: Number((start.x + 0.4).toFixed(6)),
      y: Number((start.y - 0.25).toFixed(6)),
      w: start.w,
      h: start.h,
    })
    expect(padOf(placed(result.part, result.pin).land, '1')).toEqual(padOf(before, '1'))
  })

  test('an east-edge resize grows width and shifts the centre; west keeps the right edge', () => {
    registerUserFootprint(land('USER_LAND'))
    const part: BoardPart = { id: 'R1', definition: 'resistor', footprintId: 'USER_LAND' }
    const { placement, land: before } = placed(part)
    const start = { id: '1', ...padOf(before, '1') }
    const east = padEditFromDrag(start, 'e', 0.3, 0)
    expect(east.padId).toBe('1')
    expect(east.x).toBeCloseTo(start.x + 0.15, 6)
    expect(east.y).toBe(start.y)
    expect(east.w).toBeCloseTo(start.w + 0.3, 6)
    expect(east.h).toBe(start.h)
    const eastOk = commitPlacementPadEdit({ part, placement, edit: east })
    expect(eastOk.ok).toBe(true)
    if (!eastOk.ok) return
    expect(padOf(placed(eastOk.part, eastOk.pin).land, '1')).toEqual({
      x: Number((start.x + 0.15).toFixed(6)),
      y: start.y,
      w: Number((start.w + 0.3).toFixed(6)),
      h: start.h,
    })
    // Fresh land — west pull moves the left edge, right edge stays.
    setUserFootprints([])
    registerUserFootprint(land('USER_LAND'))
    const again = placed(part)
    const s2 = { id: '1', ...padOf(again.land, '1') }
    const right = s2.x + s2.w / 2
    const west = padEditFromDrag(s2, 'w', 0.2, 0)
    const westOk = commitPlacementPadEdit({
      part,
      placement: again.placement,
      edit: west,
    })
    expect(westOk.ok).toBe(true)
    if (!westOk.ok) return
    const after = padOf(placed(westOk.part, westOk.pin).land, '1')
    expect(after.w).toBe(Number((s2.w - 0.2).toFixed(6)))
    expect(Number((after.x + after.w / 2).toFixed(6))).toBe(Number(right.toFixed(6)))
  })

  test('a corner resize changes both extents; a circle drag keeps one diameter', () => {
    registerUserFootprint(land('USER_LAND'))
    const part: BoardPart = { id: 'R1', definition: 'resistor', footprintId: 'USER_LAND' }
    const { placement, land: before } = placed(part)
    const start = { id: '2', ...padOf(before, '2') }
    const corner = padEditFromDrag(start, 'se', 0.2, 0.1)
    expect(corner.w).toBeCloseTo(start.w + 0.2, 6)
    expect(corner.h).toBeCloseTo(start.h + 0.1, 6)
    expect(corner.x).toBeCloseTo(start.x + 0.1, 6)
    expect(corner.y).toBeCloseTo(start.y + 0.05, 6)
    expect(commitPlacementPadEdit({ part, placement, edit: corner }).ok).toBe(true)

    registerUserFootprint(land('DISCS', 'circle'))
    const disc: BoardPart = { id: 'R2', definition: 'resistor', footprintId: 'DISCS' }
    const dp = placed(disc)
    const c0 = { id: '1', ...padOf(dp.land, '1') }
    const circleEdit = padEditFromDrag(c0, 'e', 0.4, 0.7, { circle: true })
    expect(circleEdit.w).toBe(circleEdit.h)
    expect(circleEdit.w).toBeCloseTo(c0.w + 0.4, 6)
    expect(
      commitPlacementPadEdit({ part: disc, placement: dp.placement, edit: circleEdit }),
    ).toMatchObject({ ok: true })
  })

  test('a drag-built edit still refuses built-in / provisional / bad size', () => {
    const builtin: BoardPart = { id: 'resistor_1', definition: 'resistor' }
    const bp = placed(builtin)
    const bPad = { id: '1', ...padOf(bp.land, '1') }
    expect(
      commitPlacementPadEdit({
        part: builtin,
        placement: bp.placement,
        edit: padEditFromDrag(bPad, 'move', 0.1, 0),
      }),
    ).toMatchObject({ ok: false, reason: 'builtin-shadow' })

    const fuse: BoardPart = { id: 'F1', definition: 'fuse' }
    const fp = placed(fuse)
    const fPad = { id: '1', ...padOf(fp.land, '1') }
    expect(
      commitPlacementPadEdit({
        part: fuse,
        placement: fp.placement,
        edit: padEditFromDrag(fPad, 'e', 0.5, 0),
      }),
    ).toMatchObject({ ok: false, reason: 'provisional' })

    registerUserFootprint(land('USER_LAND'))
    const part: BoardPart = { id: 'R1', definition: 'resistor', footprintId: 'USER_LAND' }
    const { placement, land: l } = placed(part)
    const start = { id: '1', ...padOf(l, '1') }
    // Collapse the pad past zero — editPlacedLand refuses bad-pad-edit.
    expect(
      commitPlacementPadEdit({
        part,
        placement,
        edit: padEditFromDrag(start, 'e', -(start.w + 0.1), 0),
      }),
    ).toMatchObject({ ok: false, reason: 'bad-pad-edit' })
    expect(resolveFootprint('USER_LAND')?.pads).toEqual(land('USER_LAND').pads)
  })
})

describe('refusals', () => {
  test('a built-in package is not edited in place — refused with a fork id, nothing registered', () => {
    const part: BoardPart = { id: 'resistor_1', definition: 'resistor' }
    const { placement } = placed(part)
    expect(placement.footprintId).toBe('R_0603_1608Metric')
    const result = commitPlacementPadEdit({ part, placement, edit: { padId: '1', w: 2 } })
    expect(result).toMatchObject({
      ok: false,
      reason: 'builtin-shadow',
      suggestedId: 'R_0603_1608Metric_R1',
    })
    expect(getUserFootprintsSnapshot()).toHaveLength(0)
    expect(resolveFootprint('R_0603_1608Metric')).toBe(BUILTIN_FOOTPRINTS.R_0603_1608Metric)
  })

  test('a provisional land stays provisional', () => {
    const fuse: BoardPart = { id: 'F1', definition: 'fuse' }
    const { placement } = placed(fuse)
    expect(placement.footprintId).toBe('provisional_2pad')
    expect(placementPadEditGate(fuse, placement)).toMatchObject({ reason: 'provisional' })
    expect(
      commitPlacementPadEdit({ part: fuse, placement, edit: { padId: '1', w: 2 } }),
    ).toMatchObject({ ok: false, reason: 'provisional' })
    expect(resolveFootprint('provisional_2pad')?.provisional).toBe(true)
    expect(getUserFootprintsSnapshot()).toHaveLength(0)
  })

  test('role-sensitive pinouts refuse before any pad moves', () => {
    registerUserFootprint(land('USER_LAND'))
    const opAmp: Placement = { partId: 'X1', footprintId: 'USER_LAND', x: 0, y: 0, rotation: 0 }
    expect(
      commitPlacementPadEdit({
        part: { id: 'X1', definition: 'op_amp' },
        placement: opAmp,
        edit: { padId: '1', w: 1 },
      }),
    ).toMatchObject({ ok: false, reason: 'role-sensitive' })
    const xfmr: UserPart = {
      id: 'TEST_XFMR',
      name: 'TEST_XFMR',
      designatorPrefix: 'T',
      pins: [
        { id: 'pin_0', name: 'P', side: 'left', electrical: 'passive' },
        { id: 'pin_1', name: 'S', side: 'left', electrical: 'passive' },
      ],
      behavesAs: { definition: 'transformer', terminals: {} },
    }
    registerUserPart(xfmr)
    const part: BoardPart = { id: 'T1', definition: 'TEST_XFMR', footprintId: 'USER_LAND' }
    expect(placementPadEditGate(part, { ...opAmp, partId: 'T1' })).toMatchObject({
      reason: 'role-sensitive',
    })
    expect(resolveFootprint('USER_LAND')?.pads[0]?.size).toEqual({ w: 0.8, h: 0.95 })
  })

  test('bad values, a missing pad, a two-diameter circle, and overlapping copper refuse', () => {
    registerUserFootprint(land('USER_LAND'))
    registerUserFootprint(land('DISCS', 'circle'))
    const part: BoardPart = { id: 'R1', definition: 'resistor', footprintId: 'USER_LAND' }
    const { placement, land: l } = placed(part)
    const go = (edit: Parameters<typeof commitPlacementPadEdit>[0]['edit']) =>
      commitPlacementPadEdit({ part, placement, edit })
    expect(go({ padId: '9', w: 1 })).toMatchObject({ reason: 'pad-not-found' })
    expect(go({ padId: '1', w: 0 })).toMatchObject({ reason: 'bad-pad-edit' })
    expect(go({ padId: '1', x: Number.NaN })).toMatchObject({ reason: 'bad-pad-edit' })
    expect(go({ padId: '1', x: padOf(l, '2').x - 0.2 })).toMatchObject({
      reason: 'overlapping-pads',
    })
    const disc: BoardPart = { id: 'R2', definition: 'resistor', footprintId: 'DISCS' }
    const dp = placed(disc)
    expect(editPlacedLand(dp.land, { padId: '1', w: 1.2 })).toMatchObject({
      reason: 'bad-pad-edit',
    })
    expect(
      commitPlacementPadEdit({
        part: disc,
        placement: dp.placement,
        edit: { padId: '1', w: 1.0, h: 1.0 },
      }),
    ).toMatchObject({ ok: true })
    // every refusal above left USER_LAND untouched
    expect(resolveFootprint('USER_LAND')?.pads).toEqual(land('USER_LAND').pads)
  })
})
