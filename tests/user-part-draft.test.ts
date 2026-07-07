/**
 * The pure half of the New-Part authoring form: turning raw form fields into a validated UserPart.
 * These lock the rules a user relies on — a name becomes a stable id, pins get unique terminal ids,
 * default values are typed scalars, and a clash with a built-in (or an existing custom part) is refused
 * with a message rather than silently overwriting.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { buildUserPartDraft, slug, type UserPartInput } from '../src/renderer/user-part-draft.ts'
import {
  isUserPart,
  registerUserPart,
  reserveBuiltinIds,
  setUserParts,
} from '../src/renderer/user-parts.ts'

const input = (over: Partial<UserPartInput> = {}): UserPartInput => ({
  name: 'My Sensor',
  designatorPrefix: 'U',
  pins: [
    { name: 'IN', side: 'left', electrical: 'input' },
    { name: 'OUT', side: 'right', electrical: 'output' },
  ],
  params: [],
  ...over,
})

afterEach(() => setUserParts([]))

describe('slug', () => {
  test('lowercases and collapses non-alphanumerics to single underscores', () => {
    expect(slug('My Sensor')).toBe('my_sensor')
    expect(slug('  A/D  Converter!! ')).toBe('a_d_converter')
    expect(slug('74HC00')).toBe('74hc00')
    expect(slug('---')).toBe('')
  })
})

describe('buildUserPartDraft — happy path', () => {
  test('assembles a UserPart with a slugged id and the pins', () => {
    const r = buildUserPartDraft(input())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.part.id).toBe('my_sensor')
    expect(r.part.name).toBe('My Sensor')
    expect(r.part.designatorPrefix).toBe('U')
    expect(r.part.pins.map((p) => p.id)).toEqual(['in', 'out'])
    expect(r.part.pins[0]).toMatchObject({ name: 'IN', side: 'left', electrical: 'input' })
    expect(r.part.parameters).toBeUndefined() // no default values → no parameters key
  })

  test('duplicate / blank pin names still get unique terminal ids', () => {
    const r = buildUserPartDraft(
      input({
        pins: [
          { name: 'A', side: 'left', electrical: 'passive' },
          { name: 'A', side: 'left', electrical: 'passive' },
          { name: '', side: 'right', electrical: 'passive' },
        ],
      }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const ids = r.part.pins.map((p) => p.id)
    expect(new Set(ids).size).toBe(3) // all unique
    expect(ids).toEqual(['a', 'a_2', 'pin3'])
  })

  test('typed default values become scalar parameters; junk rows are dropped and dupes collapse', () => {
    const r = buildUserPartDraft(
      input({
        params: [
          { name: 'Supply Voltage', amount: '5', unit: 'V' },
          { name: 'bias', amount: '', unit: 'A' }, // no amount → skipped
          { name: '', amount: '3', unit: 'V' }, // no name → skipped
          { name: 'supply voltage', amount: '9', unit: 'V' }, // dup slug → first wins
        ],
      }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.part.parameters).toEqual({
      supply_voltage: { value: { kind: 'scalar', amount: 5, unit: 'V' } },
    })
  })

  test('a blank unit is allowed (a plain dimensionless number)', () => {
    const r = buildUserPartDraft(input({ params: [{ name: 'count', amount: '8', unit: '' }] }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.part.parameters?.count).toEqual({ value: { kind: 'scalar', amount: 8, unit: '' } })
  })

  test('an empty designator falls back to U (uppercased otherwise)', () => {
    const r1 = buildUserPartDraft(input({ designatorPrefix: '' }))
    const r2 = buildUserPartDraft(input({ name: 'Other', designatorPrefix: 'j' }))
    expect(r1.ok && r1.part.designatorPrefix).toBe('U')
    expect(r2.ok && r2.part.designatorPrefix).toBe('J')
  })
})

describe('buildUserPartDraft — behavesAs (real device behaviour)', () => {
  test('resolves each device terminal (by pin INDEX) to the real pin id', () => {
    // "IN" is pin 0 → slug 'in'; "OUT" is pin 1 → slug 'out'.
    const r = buildUserPartDraft(
      input({ behavesAs: { definition: 'resistor', terminals: { terminal_a: 0, terminal_b: 1 } } }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.part.behavesAs).toEqual({
      definition: 'resistor',
      terminals: { terminal_a: 'in', terminal_b: 'out' },
    })
  })

  test('an unsupported behaviour device is refused', () => {
    const r = buildUserPartDraft(
      input({ behavesAs: { definition: 'not_a_device', terminals: { terminal_a: 0 } } }),
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('supported')
  })

  test('a device terminal mapped to no valid pin is refused', () => {
    const r = buildUserPartDraft(
      input({ behavesAs: { definition: 'resistor', terminals: { terminal_a: 0, terminal_b: 9 } } }),
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('terminal_b'.replace(/_/g, ' '))
  })

  test('two device terminals mapped to the SAME pin is refused (would leave a terminal dead)', () => {
    const r = buildUserPartDraft(
      input({ behavesAs: { definition: 'resistor', terminals: { terminal_a: 0, terminal_b: 0 } } }),
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('DIFFERENT')
  })

  test('an empty behaviour definition means no behaviour (black box)', () => {
    const r = buildUserPartDraft(input({ behavesAs: { definition: '', terminals: {} } }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.part.behavesAs).toBeUndefined()
  })
})

describe('buildUserPartDraft — validation errors', () => {
  test('an empty name is rejected', () => {
    const r = buildUserPartDraft(input({ name: '   ' }))
    expect(r).toEqual({ ok: false, error: expect.stringContaining('name') })
  })

  test('a name with no letters/numbers is rejected', () => {
    const r = buildUserPartDraft(input({ name: '///' }))
    expect(r.ok).toBe(false)
  })

  test('zero pins is rejected', () => {
    const r = buildUserPartDraft(input({ pins: [] }))
    expect(r).toEqual({ ok: false, error: expect.stringContaining('pin') })
  })

  test('a name colliding with a built-in id is refused (never silently shadows a built-in)', () => {
    reserveBuiltinIds(['resistor'])
    const r = buildUserPartDraft(input({ name: 'Resistor' }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('built-in')
  })

  test('a name matching an already-made custom part is refused', () => {
    const first = buildUserPartDraft(input({ name: 'Widget' }))
    expect(first.ok).toBe(true)
    if (first.ok) registerUserPart(first.part)
    expect(isUserPart('widget')).toBe(true)
    const again = buildUserPartDraft(input({ name: 'widget' }))
    expect(again.ok).toBe(false)
    if (again.ok) return
    expect(again.error).toContain('already')
  })
})
