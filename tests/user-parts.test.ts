/**
 * User-made parts, slice 1 — data-driven symbols. A part authored from a pin spec (a labelled box with
 * pins on chosen sides) must draw itself AND wire up: the drawn pin tips and the wire handles have to
 * agree, so a wire always lands on a pin. These tests pin the geometry contract (tips on the node edge,
 * even spacing, box sized to pins + name) and the two live seams — terminalsOf + defaultParameters —
 * that make a registered user part behave like a built-in part on the canvas.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { defaultParameters } from '../src/renderer/part-defaults.ts'
import { terminalsOf } from '../src/renderer/symbols.tsx'
import {
  allUserParts,
  getUserPart,
  getUserPartsSnapshot,
  isReservedBuiltinId,
  isUserPart,
  registerUserPart,
  reserveBuiltinIds,
  setUserParts,
  subscribeUserParts,
  type UserPart,
  userPartGeometry,
  userPartTerminals,
} from '../src/renderer/user-parts.ts'

function must<T>(x: T | undefined, msg: string): T {
  if (x === undefined) throw new Error(msg)
  return x
}

const part = (over: Partial<UserPart> = {}): UserPart => ({
  id: 'my_ic',
  name: 'MY-IC',
  designatorPrefix: 'U',
  pins: [
    { id: 'in', name: 'IN', side: 'left', electrical: 'input' },
    { id: 'out', name: 'OUT', side: 'right', electrical: 'output' },
  ],
  ...over,
})

afterEach(() => setUserParts([])) // the registry is module-global — never leak a part into another test

describe('userPartGeometry — the box + pin coordinates', () => {
  test('every pin tip lands exactly on the node’s outer edge (where the handle sits)', () => {
    const g = userPartGeometry(
      part({
        pins: [
          { id: 'l', name: 'L', side: 'left', electrical: 'passive' },
          { id: 'r', name: 'R', side: 'right', electrical: 'passive' },
          { id: 't', name: 'T', side: 'top', electrical: 'passive' },
          { id: 'b', name: 'B', side: 'bottom', electrical: 'passive' },
        ],
      }),
    )
    const tip = (id: string) =>
      must(
        g.pins.find((p) => p.id === id),
        `pin ${id}`,
      )
    expect(tip('l').tipX).toBe(0)
    expect(tip('r').tipX).toBe(g.width)
    expect(tip('t').tipY).toBe(0)
    expect(tip('b').tipY).toBe(g.height)
    // the body is inset from every edge (the stubs live in that margin)
    expect(g.body.x).toBeGreaterThan(0)
    expect(g.body.y).toBeGreaterThan(0)
    expect(g.body.x + g.body.width).toBeLessThan(g.width)
    expect(g.body.y + g.body.height).toBeLessThan(g.height)
  })

  test('a stub is straight — its tip shares the root’s cross-axis coordinate', () => {
    const g = userPartGeometry(part())
    for (const p of g.pins) {
      if (p.side === 'left' || p.side === 'right') expect(p.tipY).toBe(p.rootY)
      else expect(p.tipX).toBe(p.rootX)
    }
  })

  test('a single pin on a side is centred on that side', () => {
    const g = userPartGeometry(part())
    const inPin = must(
      g.pins.find((p) => p.id === 'in'),
      'pin in',
    )
    expect(inPin.rootY).toBeCloseTo(g.height / 2, 6)
  })

  test('several pins on one side are evenly spaced and symmetric', () => {
    const g = userPartGeometry(
      part({
        pins: [
          { id: 'a', name: 'A', side: 'left', electrical: 'passive' },
          { id: 'b', name: 'B', side: 'left', electrical: 'passive' },
          { id: 'c', name: 'C', side: 'left', electrical: 'passive' },
        ],
      }),
    )
    const ys = g.pins.map((p) => p.rootY)
    expect(ys).toHaveLength(3)
    const [y0, y1, y2] = ys as [number, number, number]
    // equal gaps between adjacent pins
    expect(y1 - y0).toBeCloseTo(y2 - y1, 6)
    // symmetric about the body centre
    expect(y1).toBeCloseTo((y0 + y2) / 2, 6)
    expect(y1).toBeCloseTo(g.height / 2, 6)
  })

  test('the box grows to fit many pins on a side, and to fit a long name', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}`,
      name: `P${i}`,
      side: 'left' as const,
      electrical: 'passive' as const,
    }))
    expect(userPartGeometry(part({ pins: many })).height).toBeGreaterThan(
      userPartGeometry(part()).height,
    )
    const wide = userPartGeometry(part({ name: 'A-VERY-LONG-PART-NAME-INDEED' }))
    expect(wide.width).toBeGreaterThan(userPartGeometry(part({ name: 'X' })).width)
  })

  test('the body widens to fit named side-pins beside the centred name (no overlap)', () => {
    const named = (l: string, r: string) =>
      userPartGeometry(
        part({
          name: 'My Sensor',
          pins: [
            { id: 'i', name: l, side: 'left', electrical: 'input' },
            { id: 'o', name: r, side: 'right', electrical: 'output' },
          ],
        }),
      )
    // longer pin labels demand a wider body so the inside labels don't collide with the centre name
    expect(named('INPUT_SIGNAL', 'OUTPUT_SIGNAL').width).toBeGreaterThan(named('A', 'B').width)
  })
})

describe('userPartTerminals — the wire handles agree with the drawn pins', () => {
  test('one handle per pin, positioned on its side, offset = the drawn tip', () => {
    const p = part({
      pins: [
        { id: 'l', name: 'L', side: 'left', electrical: 'passive' },
        { id: 'r', name: 'R', side: 'right', electrical: 'passive' },
        { id: 't', name: 'T', side: 'top', electrical: 'passive' },
        { id: 'b', name: 'B', side: 'bottom', electrical: 'passive' },
      ],
    })
    const g = userPartGeometry(p)
    const terminals = userPartTerminals(p)
    expect(terminals.map((t) => t.id)).toEqual(['l', 'r', 't', 'b'])
    for (const t of terminals) {
      const pin = must(
        g.pins.find((x) => x.id === t.id),
        `pin ${t.id}`,
      )
      // left/right → offset is the vertical tip; top/bottom → offset is the horizontal tip
      const expected = pin.side === 'left' || pin.side === 'right' ? pin.tipY : pin.tipX
      expect(t.offset).toBe(expected)
    }
  })
})

describe('the registry + the live seams (a user part behaves like a built-in)', () => {
  test('register / get / has / all / setUserParts', () => {
    expect(isUserPart('my_ic')).toBe(false)
    registerUserPart(part())
    expect(isUserPart('my_ic')).toBe(true)
    expect(getUserPart('my_ic')?.name).toBe('MY-IC')
    expect(allUserParts().map((p) => p.id)).toContain('my_ic')
    setUserParts([part({ id: 'other', name: 'OTHER' })])
    expect(isUserPart('my_ic')).toBe(false) // setUserParts replaces the whole registry
    expect(isUserPart('other')).toBe(true)
  })

  test('terminalsOf returns the pin-spec terminals for a registered user part', () => {
    registerUserPart(part())
    expect(terminalsOf('my_ic', undefined)).toEqual(userPartTerminals(part()))
  })

  test('an unregistered definition is untouched by the user-part path (honest fallback)', () => {
    // A real built-in still resolves through its own map, not the registry.
    expect(terminalsOf('resistor', undefined).length).toBeGreaterThan(0)
  })

  test('defaultParameters returns a fresh copy of the user part’s own defaults', () => {
    const params = {
      supply_voltage: { value: { kind: 'scalar' as const, amount: 5, unit: 'V' } },
    }
    registerUserPart(part({ parameters: params }))
    const got = defaultParameters('my_ic')
    expect(got).toEqual(params)
    expect(got).not.toBe(params) // a fresh copy — editing the dropped part can't mutate the definition
  })

  test('a user part with no defaults yields an empty parameter set (a black box, honestly)', () => {
    registerUserPart(part())
    expect(defaultParameters('my_ic')).toEqual({})
  })
})

describe('a user id can never collide with a built-in (the registry stays disjoint)', () => {
  test('registerUserPart refuses a reserved built-in id (so the solver never mistakes it for one)', () => {
    reserveBuiltinIds(['fake_builtin'])
    expect(isReservedBuiltinId('fake_builtin')).toBe(true)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(registerUserPart(part({ id: 'fake_builtin' }))).toBe(false)
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
    expect(isUserPart('fake_builtin')).toBe(false)
    expect(getUserPart('fake_builtin')).toBeUndefined()
  })

  test('setUserParts drops any reserved id but keeps the rest', () => {
    reserveBuiltinIds(['fake_builtin'])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setUserParts([part({ id: 'fake_builtin' }), part({ id: 'ok_part', name: 'OK' })])
    warn.mockRestore()
    expect(isUserPart('fake_builtin')).toBe(false)
    expect(isUserPart('ok_part')).toBe(true)
  })

  test('a non-reserved id registers normally (returns true)', () => {
    expect(registerUserPart(part({ id: 'my_ic' }))).toBe(true)
    expect(isUserPart('my_ic')).toBe(true)
  })
})

describe('the external store (so React re-renders the palette on a change)', () => {
  test('subscribeUserParts fires on register + setUserParts, and stops after unsubscribe', () => {
    let calls = 0
    const unsub = subscribeUserParts(() => calls++)
    registerUserPart(part())
    expect(calls).toBe(1)
    setUserParts([part({ id: 'a' }), part({ id: 'b' })])
    expect(calls).toBe(2)
    unsub()
    registerUserPart(part({ id: 'c' }))
    expect(calls).toBe(2) // no more notifications after unsubscribe
  })

  test('getUserPartsSnapshot is a STABLE reference until a mutation (no render loop)', () => {
    const before = getUserPartsSnapshot()
    expect(getUserPartsSnapshot()).toBe(before) // same reference when nothing changed
    registerUserPart(part())
    const after = getUserPartsSnapshot()
    expect(after).not.toBe(before) // new reference after a change
    expect(after.map((p) => p.id)).toContain('my_ic')
  })
})
