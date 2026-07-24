/**
 * The part-picker category map. The load-bearing check is COMPLETENESS: every built-in placeable part
 * must land in exactly one category, or the picker would silently drop it or list it twice. Also that
 * every `members` id is a real part (no typos), and that the level ordering floats the right sections.
 */

import { describe, expect, test } from 'vitest'
import { PARTS } from '../src/renderer/palette.tsx'
import { categoryOf, orderedCategories, PART_CATEGORIES } from '../src/renderer/part-categories.ts'

const CATEGORY_IDS = new Set(PART_CATEGORIES.map((c) => c.id))
const PART_IDS = new Set(PARTS.map((p) => p.definition))

describe('every built-in part is categorised, exactly once', () => {
  test('categoryOf returns a real category for every part in the palette', () => {
    for (const part of PARTS) {
      const cat = categoryOf(part.definition)
      expect(CATEGORY_IDS.has(cat), `${part.definition} → "${cat}"`).toBe(true)
    }
  })

  test('no part is claimed by two categories via the explicit members lists', () => {
    const seen = new Map<string, string>()
    for (const category of PART_CATEGORIES) {
      for (const member of category.members) {
        expect(seen.has(member), `${member} is in ${seen.get(member)} AND ${category.id}`).toBe(
          false,
        )
        seen.set(member, category.id)
      }
    }
  })

  test('every members id is a real palette part (no typos, no stale ids)', () => {
    for (const category of PART_CATEGORIES) {
      for (const member of category.members) {
        expect(PART_IDS.has(member), `${category.id}: "${member}" is not a real part`).toBe(true)
      }
    }
  })

  test('the generated 7-segment sizes and the catalog parts land by prefix', () => {
    expect(categoryOf('display_seven_segment_8')).toBe('displays')
    expect(categoryOf('display_seven_segment_bare_12')).toBe('displays')
    expect(categoryOf('catalog_ice40up5k_sg48')).toBe('ics')
    expect(categoryOf('catalog_w25q32jv')).toBe('ics')
    // an unknown user-authored part falls into "My parts", not lost
    expect(categoryOf('some_user_thing')).toBe('my_parts')
  })
})

describe('sections reorder by the current level', () => {
  test('on Board, ICs & modules come first; on Circuit, sources do', () => {
    expect(orderedCategories('board')[0]?.id).toBe('ics')
    expect(orderedCategories('schematic')[0]?.id).toBe('sources')
  })

  test('on Chip, transistors and logic float above the analog-only sections', () => {
    const chip = orderedCategories('chip').map((c) => c.id)
    expect(chip.indexOf('transistors')).toBeLessThan(chip.indexOf('tubes'))
    expect(chip.indexOf('logic_gates')).toBeLessThan(chip.indexOf('sources'))
  })

  test('ordering is a permutation — every category appears exactly once, whatever the level', () => {
    for (const level of ['schematic', 'board', 'chip'] as const) {
      const ids = orderedCategories(level).map((c) => c.id)
      expect(new Set(ids).size).toBe(PART_CATEGORIES.length)
      expect(ids.length).toBe(PART_CATEGORIES.length)
    }
  })
})
