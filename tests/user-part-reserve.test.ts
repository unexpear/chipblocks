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
  test('every placeable PART id is reserved', () => {
    // Importing palette.tsx above runs its module-load reserveBuiltinIds side effect (as the app does).
    expect(PARTS.length).toBeGreaterThan(0)
    for (const p of PARTS) expect(isReservedBuiltinId(p.definition), p.definition).toBe(true)
  })

  test('every BUILTIN_BLOCKS id is reserved — onDrop resolves these, so none can be shadowed', () => {
    // The canvas resolves a composite block by its id (onDrop / placePart look it up in BUILTIN_BLOCKS),
    // so EVERY block id must be reserved whether or not it also appears in PARTS — otherwise a user part
    // slugging to that id would show its own glyph but drop the built-in. (These days every block is also
    // a placeable PART, but reservation must not depend on that staying true.)
    const blockIds = Object.keys(BUILTIN_BLOCKS)
    expect(blockIds.length).toBeGreaterThan(0)
    for (const id of blockIds) expect(isReservedBuiltinId(id), id).toBe(true)
  })

  test('an unrelated id is not reserved (a genuine custom name is still allowed)', () => {
    expect(isReservedBuiltinId('my_totally_custom_part_xyz')).toBe(false)
  })
})
