/**
 * Place → footprint re-derive: a hand placement's board copper (and body) inverts into a user-owned
 * footprint that re-places onto the same spot; the assignment is written back only when it fits.
 * Built-ins are never shadowed, provisional lands stay labeled, role-sensitive pinouts are not
 * invented, and a refused commit leaves the library exactly as it was.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { BUILTIN_FOOTPRINTS, type Footprint, type Pad } from '../src/renderer/footprint.ts'
import {
  type BoardPart,
  deriveBoard,
  type Placement,
  type PlacementOverride,
  placePoint,
  type Rotation,
} from '../src/renderer/pcb-board.ts'
import {
  commitPlacementFootprint,
  deriveFootprintFromPlacement,
  type PlacedLand,
  placedLandOf,
  suggestPlacementFootprintId,
  unplacePoint,
} from '../src/renderer/placement-footprint.ts'
import {
  getUserFootprintsSnapshot,
  isUserFootprint,
  registerUserFootprint,
  resolveFootprint,
  setUserFootprints,
} from '../src/renderer/user-footprints.ts'
import { registerUserPart, setUserParts, type UserPart } from '../src/renderer/user-parts.ts'

afterEach(() => {
  setUserFootprints([])
  setUserParts([])
})

const ROTATIONS: Rotation[] = [0, 90, 180, 270]

function land(id: string, pads: { id: string; x: number; y: number }[]): Footprint {
  return {
    id,
    name: id,
    description: 'user land',
    pads: pads.map((p) => ({
      id: p.id,
      center: { x: p.x, y: p.y },
      size: { w: 0.8, h: 0.95 },
      shape: 'roundrect' as const,
      type: 'smd' as const,
    })),
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

const TWO = [
  { id: '1', x: -0.8, y: 0 },
  { id: '2', x: 0.8, y: 0 },
]

function userPart(id: string, pins: { name: string; pad?: string }[], extra = {}): UserPart {
  return {
    id,
    name: id,
    designatorPrefix: 'U',
    pins: pins.map((p, i) => ({
      id: `pin_${String(i)}`,
      name: p.name,
      side: 'left' as const,
      electrical: 'passive' as const,
      ...(p.pad !== undefined ? { pad: p.pad } : {}),
    })),
    ...extra,
  }
}

/** Place one part, optionally at a hand spot, and read back its placement + board land. */
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

const round = (pads: readonly Pad[]) =>
  pads.map((p) => ({
    id: p.id,
    x: Number(p.center.x.toFixed(6)) + 0,
    y: Number(p.center.y.toFixed(6)) + 0,
    w: Number(p.size.w.toFixed(6)),
    h: Number(p.size.h.toFixed(6)),
  }))

describe('the placement transform inverts', () => {
  test('unplacePoint undoes placePoint at every quarter turn', () => {
    for (const rotation of ROTATIONS) {
      const p = { partId: 'X', footprintId: 'F', x: 7.25, y: -3.5, rotation }
      for (const local of [
        { x: 0, y: 0 },
        { x: 1.27, y: -0.4 },
        { x: -2.5, y: 3.1 },
      ]) {
        expect(unplacePoint(p, placePoint(p, local))).toEqual(local)
      }
    }
  })
})

describe('re-derive a footprint from a built-in placement', () => {
  test('a rotated 0603 becomes a user copy, the part is re-pointed, and the board does not move', () => {
    for (const rotation of ROTATIONS) {
      setUserFootprints([])
      const part: BoardPart = { id: 'resistor_1', definition: 'resistor' }
      const { placement, land: before } = placed(part, { x: 12, y: -4, rotation })
      expect(placement.footprintId).toBe('R_0603_1608Metric')
      const targetId = suggestPlacementFootprintId(placement)
      expect(targetId).toBe('R_0603_1608Metric_R1')

      const result = commitPlacementFootprint({ part, placement, land: before, targetId })
      expect(result.ok, String(rotation)).toBe(true)
      if (!result.ok) continue
      expect(result.mode).toBe('created')
      expect(result.sameGeometry).toBe(true)
      expect(result.part.footprintId).toBe(targetId)
      expect(isUserFootprint(targetId)).toBe(true)
      // Unchanged copy of a cited land keeps the citation; it is not a new manufacturer package.
      expect(result.footprint.provenance.citation).toBe(
        BUILTIN_FOOTPRINTS.R_0603_1608Metric?.provenance.citation,
      )
      expect(result.footprint.provenance.notes).toMatch(/Re-derived from the board placement of R1/)
      expect(result.footprint.pads).toEqual(BUILTIN_FOOTPRINTS.R_0603_1608Metric?.pads)

      const after = placed(result.part, result.pin)
      expect(after.placement.footprintId).toBe(targetId)
      expect(round(after.land.pads)).toEqual(round(before.pads))
    }
  })

  test('without a new id a built-in placement refuses and suggests one; a built-in target refuses', () => {
    const part: BoardPart = { id: 'resistor_1', definition: 'resistor' }
    const { placement, land: l } = placed(part)
    const noId = deriveFootprintFromPlacement({ part, placement, land: l })
    expect(noId).toMatchObject({
      ok: false,
      reason: 'builtin-shadow',
      suggestedId: 'R_0603_1608Metric_R1',
    })
    const shadow = commitPlacementFootprint({
      part,
      placement,
      land: l,
      targetId: 'R_0805_2012Metric',
    })
    expect(shadow).toMatchObject({ ok: false, reason: 'builtin-shadow' })
    expect(getUserFootprintsSnapshot()).toHaveLength(0)
    expect(resolveFootprint('R_0805_2012Metric')).toBe(BUILTIN_FOOTPRINTS.R_0805_2012Metric)
  })

  test('every built-in land inverts cleanly (no false ambiguity) at 90°', () => {
    for (const fp of Object.values(BUILTIN_FOOTPRINTS)) {
      const placement: Placement = { partId: 'P', footprintId: fp.id, x: 3, y: 5, rotation: 90 }
      const l = placedLandOf(placement, fp)
      if (l === undefined) throw new Error(fp.id)
      const result = deriveFootprintFromPlacement({
        part: { id: 'P', definition: 'resistor' },
        placement,
        land: l,
        targetId: `${fp.id}_copy`,
      })
      expect(result.ok, fp.id).toBe(true)
      if (result.ok) expect(result.sameGeometry, fp.id).toBe(true)
    }
  })

  test('a package-specific pinout is not carried to a new id — refused, not silently re-pinned', () => {
    const part: BoardPart = {
      id: 'transistor_bjt_npn_1',
      definition: 'transistor_bjt_npn',
      footprintId: 'TO-92_Inline',
    }
    const { placement, land: l } = placed(part)
    const result = commitPlacementFootprint({
      part,
      placement,
      land: l,
      targetId: suggestPlacementFootprintId(placement),
    })
    expect(result).toMatchObject({ ok: false, reason: 'pinout-changed' })
    if (!result.ok) expect(result.terminals).toEqual(expect.arrayContaining(['base', 'emitter']))
    expect(getUserFootprintsSnapshot()).toHaveLength(0)
  })
})

describe('re-derive updates the placement’s own user footprint', () => {
  test('nudged board copper and a body outline re-shape the same id; the board matches the hand land', () => {
    registerUserFootprint(land('USER_LAND', TWO))
    const part: BoardPart = { id: 'R7', definition: 'resistor', footprintId: 'USER_LAND' }
    const { placement, land: l } = placed(part, { x: 20, y: 10, rotation: 270 })
    // Hand edit on the board: pad 2 moves 0.5 mm along board +y, and a body outline is drawn.
    const moved: PlacedLand = {
      pads: l.pads.map((p) =>
        p.id === '2' ? { ...p, center: { x: p.center.x, y: p.center.y + 0.5 } } : p,
      ),
      fabrication: [
        { from: { x: 19, y: 8 }, to: { x: 21, y: 8 }, width: 0.1 },
        { from: { x: 21, y: 8 }, to: { x: 21, y: 12.5 }, width: 0.1 },
      ],
      silkscreen: [],
    }
    const before = getUserFootprintsSnapshot()
    const result = commitPlacementFootprint({ part, placement, land: moved })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.mode).toBe('updated')
    expect(result.sameGeometry).toBe(false)
    expect(result.unchanged).toBe(false)
    expect(getUserFootprintsSnapshot()).not.toBe(before)
    expect(result.part.footprintId).toBe('USER_LAND')
    expect(result.footprint.provenance).toMatchObject({ source_type: 'derived', confidence: 'low' })
    expect(result.footprint.fabrication).toHaveLength(2)
    // rotation 270 inverse: local x = −Δy, local y = Δx (Δ from the placement origin).
    expect(result.footprint.fabrication[0]).toEqual({
      from: { x: 2, y: -1 },
      to: { x: 2, y: 1 },
      width: 0.1,
    })
    const after = placed(result.part, result.pin)
    expect(round(after.land.pads)).toEqual(round(moved.pads))
    expect(after.land.fabrication.map((s) => [s.from, s.to])).toEqual(
      moved.fabrication.map((s) => [s.from, s.to]),
    )
  })

  test('an unchanged land is a no-op — nothing re-registered', () => {
    registerUserFootprint(land('USER_LAND', TWO))
    const part: BoardPart = { id: 'R7', definition: 'resistor', footprintId: 'USER_LAND' }
    const { placement, land: l } = placed(part, { x: 1, y: 2, rotation: 180 })
    const before = getUserFootprintsSnapshot()
    const result = commitPlacementFootprint({ part, placement, land: l })
    expect(result).toMatchObject({ ok: true, unchanged: true, mode: 'updated' })
    expect(getUserFootprintsSnapshot()).toBe(before)
  })

  test('a re-shape that would cost a pin its pad rolls back', () => {
    registerUserFootprint(land('USER_LAND', TWO))
    registerUserPart(
      userPart('TEST_U', [
        { name: 'A', pad: '1' },
        { name: 'B', pad: '2' },
      ]),
    )
    const part: BoardPart = { id: 'U1', definition: 'TEST_U', footprintId: 'USER_LAND' }
    const { placement, land: l } = placed(part)
    const renamed: PlacedLand = {
      ...l,
      pads: l.pads.map((p) => (p.id === '2' ? { ...p, id: 'B2' } : p)),
    }
    const result = commitPlacementFootprint({ part, placement, land: renamed })
    expect(result).toMatchObject({ ok: false, reason: 'terminal-unmapped', terminals: ['pin_1'] })
    expect(resolveFootprint('USER_LAND')?.pads.map((p) => p.id)).toEqual(['1', '2'])
  })

  test('a shared land that would stop fitting another part refuses and suggests a new id', () => {
    const THREE = [...TWO, { id: '3', x: 0, y: 1.5 }]
    registerUserFootprint(land('USER_LAND_3', THREE))
    registerUserPart(userPart('TEST_TWO', [{ name: 'A' }, { name: 'B' }]))
    registerUserPart(userPart('TEST_THREE', [{ name: 'A' }, { name: 'B' }, { name: 'C' }]))
    const a: BoardPart = { id: 'U1', definition: 'TEST_TWO', footprintId: 'USER_LAND_3' }
    const b: BoardPart = { id: 'U2', definition: 'TEST_THREE', footprintId: 'USER_LAND_3' }
    const { placement, land: l } = placed(a)
    const trimmed: PlacedLand = { ...l, pads: l.pads.filter((p) => p.id !== '3') }
    const result = commitPlacementFootprint({
      part: a,
      placement,
      land: trimmed,
      otherParts: [a, b],
    })
    expect(result).toMatchObject({ ok: false, reason: 'breaks-other-parts', partIds: ['U2'] })
    expect(resolveFootprint('USER_LAND_3')?.pads).toHaveLength(3)
    // Under a fresh id the same trimmed land is fine for U1 alone.
    const fresh = commitPlacementFootprint({
      part: a,
      placement,
      land: trimmed,
      targetId: 'U1_LAND',
      otherParts: [a, b],
    })
    expect(fresh).toMatchObject({ ok: true, mode: 'created' })
    if (fresh.ok) expect(fresh.part.footprintId).toBe('U1_LAND')
    expect(resolveFootprint('USER_LAND_3')?.pads).toHaveLength(3)
  })
})

describe('refusals', () => {
  test('a provisional land stays labeled provisional', () => {
    const fuse: BoardPart = { id: 'F1', definition: 'fuse' }
    const { placement, land: l } = placed(fuse)
    expect(placement.footprintId).toBe('provisional_2pad')
    expect(
      commitPlacementFootprint({ part: fuse, placement, land: l, targetId: 'FUSE_LAND' }),
    ).toMatchObject({ ok: false, reason: 'provisional' })
    registerUserFootprint(land('USER_LAND', TWO))
    const r: BoardPart = { id: 'R1', definition: 'resistor', footprintId: 'USER_LAND' }
    const rp = placed(r)
    expect(
      deriveFootprintFromPlacement({ part: r, ...rp, targetId: 'provisional_2pad' }),
    ).toMatchObject({ ok: false, reason: 'provisional' })
    expect(resolveFootprint('provisional_2pad')?.provisional).toBe(true)
    expect(getUserFootprintsSnapshot().map((f) => f.id)).toEqual(['USER_LAND'])
  })

  test('ambiguous geometry: no pads, empty / repeated ids, overlapping copper, bad turn', () => {
    registerUserFootprint(land('USER_LAND', TWO))
    const part: BoardPart = { id: 'R1', definition: 'resistor', footprintId: 'USER_LAND' }
    const { placement, land: l } = placed(part)
    const base = { part, placement }
    const pad1 = l.pads[0] as Pad
    expect(deriveFootprintFromPlacement({ ...base, land: { ...l, pads: [] } })).toMatchObject({
      reason: 'no-pads',
    })
    expect(
      deriveFootprintFromPlacement({ ...base, land: { ...l, pads: [pad1, { ...pad1, id: ' ' }] } }),
    ).toMatchObject({ reason: 'ambiguous-pads' })
    expect(
      deriveFootprintFromPlacement({
        ...base,
        land: { ...l, pads: l.pads.map((p) => ({ ...p, id: '1' })) },
      }),
    ).toMatchObject({ reason: 'ambiguous-pads' })
    expect(
      deriveFootprintFromPlacement({
        ...base,
        land: {
          ...l,
          pads: [pad1, { ...pad1, id: '2', center: { x: pad1.center.x + 0.3, y: pad1.center.y } }],
        },
      }),
    ).toMatchObject({ reason: 'overlapping-pads' })
    const disc = { ...pad1, shape: 'circle' as const, size: { w: 1, h: 1 } }
    expect(
      deriveFootprintFromPlacement({
        ...base,
        land: {
          ...l,
          pads: [disc, { ...disc, id: '2', center: { x: disc.center.x + 0.9, y: disc.center.y } }],
        },
      }),
    ).toMatchObject({ reason: 'overlapping-pads' })
    expect(
      deriveFootprintFromPlacement({
        ...base,
        placement: { ...placement, rotation: 45 as unknown as Rotation },
        land: l,
      }),
    ).toMatchObject({ reason: 'bad-placement' })
    expect(
      deriveFootprintFromPlacement({
        ...base,
        land: { ...l, pads: [{ ...pad1, size: { w: 0, h: 1 } }] },
      }),
    ).toMatchObject({ reason: 'invalid-geometry' })
    expect(resolveFootprint('USER_LAND')?.pads).toHaveLength(2)
  })

  test('another user footprint id is never overwritten', () => {
    registerUserFootprint(land('USER_LAND', TWO))
    registerUserFootprint(land('OTHER', TWO))
    const part: BoardPart = { id: 'R1', definition: 'resistor', footprintId: 'USER_LAND' }
    const { placement, land: l } = placed(part)
    expect(
      deriveFootprintFromPlacement({ part, placement, land: l, targetId: 'OTHER' }),
    ).toMatchObject({ ok: false, reason: 'id-taken' })
  })

  test('a land that does not fit the part rolls back and leaves the assignment alone', () => {
    const part: BoardPart = { id: 'R1', definition: 'resistor' }
    const { placement, land: l } = placed(part)
    const extra = { ...(l.pads[0] as Pad), id: '3', center: { x: l.pads[0]?.center.x ?? 0, y: 3 } }
    const result = commitPlacementFootprint({
      part,
      placement,
      land: { ...l, pads: [...l.pads, extra] },
      targetId: 'R1_LAND',
    })
    expect(result).toMatchObject({ ok: false, reason: 'does-not-fit' })
    expect(resolveFootprint('R1_LAND')).toBeUndefined()
  })

  test('role-sensitive kinds: no explicit pin data refuses; explicit pin.pad is honored', () => {
    registerUserFootprint(land('USER_LAND', TWO))
    const placement: Placement = { partId: 'X1', footprintId: 'USER_LAND', x: 0, y: 0, rotation: 0 }
    const l = placedLandOf(placement)
    if (l === undefined) throw new Error('land')
    expect(
      deriveFootprintFromPlacement({
        part: { id: 'X1', definition: 'op_amp' },
        placement,
        land: l,
      }),
    ).toMatchObject({ ok: false, reason: 'role-sensitive' })
    // A user part that behaves as a transformer: declaration order would invent the pinout.
    registerUserPart(
      userPart('TEST_XFMR', [{ name: 'P' }, { name: 'S' }], {
        behavesAs: { definition: 'transformer', terminals: {} },
      }),
    )
    expect(
      deriveFootprintFromPlacement({
        part: { id: 'X1', definition: 'TEST_XFMR', footprintId: 'USER_LAND' },
        placement,
        land: l,
      }),
    ).toMatchObject({ ok: false, reason: 'role-sensitive' })
    // Chip pins flagged role-sensitive with explicit pads re-derive fine.
    const chip: BoardPart = {
      id: 'X1',
      definition: 'block',
      footprintId: 'USER_LAND',
      chipRoleSensitive: true,
      chipPins: [
        { id: 'p', name: 'P', pad: '2' },
        { id: 's', name: 'S', pad: '1' },
      ],
    }
    const ok = commitPlacementFootprint({ part: chip, placement, land: l, targetId: 'X1_LAND' })
    expect(ok).toMatchObject({ ok: true, mode: 'created' })
    if (ok.ok) expect(ok.part.footprintId).toBe('X1_LAND')
    const implicit: BoardPart = {
      ...chip,
      chipPins: [
        { id: 'p', name: 'P' },
        { id: 's', name: 'S' },
      ],
    }
    expect(
      deriveFootprintFromPlacement({ part: implicit, placement, land: l, targetId: 'X1_LAND2' }),
    ).toMatchObject({ ok: false, reason: 'role-sensitive' })
  })

  test('a circuit block with ports writes the re-derived id back through the chip path', () => {
    registerUserFootprint(land('USER_LAND', TWO))
    const block: BoardPart = {
      id: 'B1',
      definition: 'block',
      footprintId: 'USER_LAND',
      chipPins: [
        { id: 'in', name: 'IN' },
        { id: 'out', name: 'OUT' },
      ],
    }
    const { placement, land: l } = placed(block, { x: 4, y: 4, rotation: 90 })
    const result = commitPlacementFootprint({
      part: block,
      placement,
      land: l,
      targetId: 'B1_LAND',
    })
    expect(result).toMatchObject({ ok: true, mode: 'created' })
    if (!result.ok) return
    expect(result.part.footprintId).toBe('B1_LAND')
    expect(placed(result.part, result.pin).placement.footprintId).toBe('B1_LAND')
  })
})
