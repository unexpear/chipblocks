/**
 * The reserved-id set must cover EVERY id the canvas can resolve to a built-in — otherwise a user part
 * whose name slugs to that id shows the user's own glyph in the palette but drops a real built-in (a
 * silent lie). There are TWO id namespaces: the placeable parts (PARTS) and the built-in composite
 * blocks (BUILTIN_BLOCKS) — and onDrop checks BUILTIN_BLOCKS first, so both must be reserved.
 *
 * Importing palette.tsx runs its module-load reserveBuiltinIds side effect (the same one the app runs).
 */
import { describe, expect, test } from 'vitest'
import { BUILTIN_BLOCKS } from '../src/renderer/builtin-blocks.ts'
import { PARTS } from '../src/renderer/palette.tsx'
import { isReservedBuiltinId } from '../src/renderer/user-parts.ts'

describe('reserved ids cover every built-in id the canvas can resolve', () => {
  test('a placeable PART id is reserved', () => {
    expect(isReservedBuiltinId('resistor')).toBe(true)
  })

  test('every BUILTIN_BLOCKS-only id (not in PARTS) is reserved — onDrop resolves these first', () => {
    const partIds = new Set(PARTS.map((p) => p.definition))
    const blockOnly = Object.keys(BUILTIN_BLOCKS).filter((id) => !partIds.has(id))
    expect(blockOnly.length).toBeGreaterThan(0) // the gap is real: blocks like row_scanner_8 aren't in PARTS
    for (const id of blockOnly) expect(isReservedBuiltinId(id)).toBe(true)
  })

  test('an unrelated id is not reserved (a genuine custom name is still allowed)', () => {
    expect(isReservedBuiltinId('my_totally_custom_part_xyz')).toBe(false)
  })
})
