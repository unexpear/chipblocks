/**
 * AUTHORED footprints — the "make a package the library doesn't have" half of the footprint model.
 * Until this existed a footprint could only be one of the 15 shipped constants, so any part whose package
 * wasn't already there (a QFN, a QFP, a connector) simply could not go on a board. These prove the
 * registry, the resolver every consumer goes through, the structural validation, and — the point of the
 * whole thing — that a footprint you author becomes a package a part can actually land on.
 */

import { afterEach, describe, expect, test } from 'vitest'
import { BUILTIN_FOOTPRINTS, type Footprint } from '../src/renderer/footprint.ts'
import { footprintsForPinCount } from '../src/renderer/footprint-assignment.ts'
import {
  footprintProblems,
  validateUserFootprint,
} from '../src/renderer/user-footprint-validate.ts'
import {
  allAvailableFootprints,
  allUserFootprints,
  getUserFootprint,
  isUserFootprint,
  mergeUserFootprints,
  registerUserFootprint,
  resolveFootprint,
  setUserFootprints,
} from '../src/renderer/user-footprints.ts'

/** A valid 4-pad package — the shape of thing the built-in library has no answer for. */
const qfn4 = (id = 'TEST_QFN4'): Footprint => ({
  id,
  name: 'Test QFN-4',
  description: 'a 4-pad test package',
  pads: [0, 1, 2, 3].map((i) => ({
    id: String(i + 1),
    center: { x: i % 2 === 0 ? -1 : 1, y: i < 2 ? -1 : 1 },
    size: { w: 0.6, h: 0.3 },
    shape: 'rect' as const,
    type: 'smd' as const,
  })),
  silkscreen: [],
  fabrication: [],
  labels: { reference: { x: 0, y: -2 }, value: { x: 0, y: 2 }, fabReference: { x: 0, y: 0 } },
  courtyard: { x: -2, y: -2, w: 4, h: 4 },
  provenance: {
    source_type: 'datasheet',
    title: 'Test part datasheet',
    citation: 'package drawing, p.1',
    confidence: 'high',
  },
})

afterEach(() => setUserFootprints([])) // the registry is module state — never leak between tests

describe('the authored-footprint registry', () => {
  test('a registered footprint is findable and resolves by id', () => {
    expect(registerUserFootprint(qfn4())).toBe(true)
    expect(isUserFootprint('TEST_QFN4')).toBe(true)
    expect(getUserFootprint('TEST_QFN4')?.name).toBe('Test QFN-4')
    expect(resolveFootprint('TEST_QFN4')?.pads).toHaveLength(4)
    expect(allUserFootprints()).toHaveLength(1)
  })

  test('it REFUSES to shadow a shipped footprint id — the cited library stays intact', () => {
    const builtinId = Object.keys(BUILTIN_FOOTPRINTS)[0] as string
    expect(registerUserFootprint({ ...qfn4(), id: builtinId })).toBe(false)
    // the built-in still resolves to the shipped geometry, not the impostor
    expect(resolveFootprint(builtinId)).toBe(BUILTIN_FOOTPRINTS[builtinId])
    expect(isUserFootprint(builtinId)).toBe(false)
  })

  test('a built-in id still resolves, and an unknown id resolves to nothing', () => {
    const builtinId = Object.keys(BUILTIN_FOOTPRINTS)[0] as string
    expect(resolveFootprint(builtinId)).toBeDefined()
    expect(resolveFootprint('NOT_A_FOOTPRINT')).toBeUndefined()
  })

  test('a prototype key resolves to nothing, not an inherited member', () => {
    // BUILTIN_FOOTPRINTS['constructor'] would otherwise hand back Object's ctor, whose .pads is
    // undefined → a crash on .length downstream. A persisted footprintId is untrusted input.
    expect(resolveFootprint('constructor')).toBeUndefined()
    expect(resolveFootprint('__proto__')).toBeUndefined()
  })

  test('merge keeps what is already registered (another tab’s package is never re-shaped)', () => {
    registerUserFootprint(qfn4())
    const added = mergeUserFootprints([
      { ...qfn4(), name: 'DIFFERENT' }, // same id → kept as-is
      { ...qfn4('TEST_OTHER'), name: 'Other' }, // new id → added
    ])
    expect(added).toBe(1)
    expect(getUserFootprint('TEST_QFN4')?.name).toBe('Test QFN-4')
    expect(getUserFootprint('TEST_OTHER')?.name).toBe('Other')
  })
})

describe('authored-footprint validation — structural, in plain language', () => {
  test('a well-formed footprint has no problems and validates', () => {
    expect(footprintProblems(qfn4())).toEqual([])
    expect(validateUserFootprint(qfn4())?.id).toBe('TEST_QFN4')
  })

  test('a drill as wide as its pad is rejected — no copper ring would be left', () => {
    const bad = qfn4()
    bad.pads[0] = {
      ...(bad.pads[0] as Footprint['pads'][number]),
      type: 'through_hole',
      holeDiameter: 0.9,
    }
    expect(footprintProblems(bad).join(' ')).toMatch(/no copper ring/)
    expect(validateUserFootprint(bad)).toBeNull()
  })

  test('an SMD pad with a drill, and a through-hole pad with none, are both caught', () => {
    const smdDrilled = qfn4()
    smdDrilled.pads[0] = { ...(smdDrilled.pads[0] as Footprint['pads'][number]), holeDiameter: 0.2 }
    expect(footprintProblems(smdDrilled).join(' ')).toMatch(/can't have a drill/)

    const thNoDrill = qfn4()
    thNoDrill.pads[0] = {
      ...(thNoDrill.pads[0] as Footprint['pads'][number]),
      type: 'through_hole',
    }
    expect(footprintProblems(thNoDrill).join(' ')).toMatch(/needs a drill/)
  })

  test('duplicate pad names are rejected — a pin has to map to exactly one pad', () => {
    const dupes = qfn4()
    dupes.pads[1] = { ...(dupes.pads[1] as Footprint['pads'][number]), id: '1' }
    expect(footprintProblems(dupes).join(' ')).toMatch(/unique/)
  })

  test('a courtyard that misses a pad is rejected — the keep-out would be a lie', () => {
    const tight = { ...qfn4(), courtyard: { x: -0.2, y: -0.2, w: 0.4, h: 0.4 } }
    expect(footprintProblems(tight).join(' ')).toMatch(/doesn't cover pad/)
  })

  test('a footprint with no pads, and one with no source, are rejected', () => {
    expect(footprintProblems({ ...qfn4(), pads: [] }).join(' ')).toMatch(/at least one pad/)
    const noProv = { ...qfn4() } as Record<string, unknown>
    noProv.provenance = undefined
    expect(footprintProblems(noProv).join(' ')).toMatch(/where the numbers came from/)
  })

  test('garbage in is refused rather than half-loaded', () => {
    expect(validateUserFootprint(null)).toBeNull()
    expect(validateUserFootprint('nope')).toBeNull()
    expect(validateUserFootprint({})).toBeNull()
  })
})

describe('the payoff — an authored package is one a part can actually land on', () => {
  test('a 4-pin part finds the authored QFN, which the shipped library could not offer', () => {
    const before = footprintsForPinCount(4).map((f) => f.id)
    expect(before).not.toContain('TEST_QFN4')
    registerUserFootprint(qfn4())
    const after = footprintsForPinCount(4).map((f) => f.id)
    expect(after).toContain('TEST_QFN4')
    // and it is offered alongside the shipped ones, not instead of them
    expect(after.length).toBe(before.length + 1)
  })

  test('the available library is the shipped set plus whatever has been authored', () => {
    const shipped = Object.keys(BUILTIN_FOOTPRINTS).length
    registerUserFootprint(qfn4())
    expect(allAvailableFootprints()).toHaveLength(shipped + 1)
  })
})
