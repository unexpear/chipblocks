/**
 * Palette / part-picker sections per enabled content library.
 * Disabled packs disappear from listCommunityPackSections (and thus from UI sections).
 */
import { afterEach, describe, expect, test } from 'vitest'
import { CATALOG_PARTS, registerCatalogParts } from '../src/renderer/catalog-parts.ts'
import { catalogPartsForPalette } from '../src/renderer/palette.tsx'
import {
  categoryLabelOf,
  categoryOf,
  communityLibraryCategoryId,
  orderedCategories,
} from '../src/renderer/part-categories.ts'
import type { UserPart } from '../src/renderer/user-parts.ts'
import {
  clearAllCommunityParts,
  clearCommunityPackParts,
  getAuthoredUserParts,
  getBuiltinParts,
  listCommunityPackSections,
  registerUserPart,
  setCommunityPackParts,
  setUserParts,
} from '../src/renderer/user-parts.ts'

const samplePart = (id: string, name?: string): UserPart => ({
  id,
  name: name ?? id,
  designatorPrefix: 'U',
  pins: [
    { id: 'a', name: 'A', side: 'left', electrical: 'input' },
    { id: 'y', name: 'Y', side: 'right', electrical: 'output' },
  ],
})

afterEach(() => {
  clearAllCommunityParts()
  setUserParts([])
})

describe('content-library palette / picker sections', () => {
  test('listCommunityPackSections groups enabled pack parts under the pack name', () => {
    expect(listCommunityPackSections()).toEqual([])
    setCommunityPackParts('alpha_lib', [samplePart('alpha_buf', 'Alpha Buf')], {
      name: 'Alpha Logic',
    })
    setCommunityPackParts('beta_lib', [samplePart('beta_and', 'Beta AND')], { name: 'Beta Gates' })
    const sections = listCommunityPackSections()
    expect(sections.map((s) => s.packId).sort()).toEqual(['alpha_lib', 'beta_lib'])
    const alpha = sections.find((s) => s.packId === 'alpha_lib')
    expect(alpha?.name).toBe('Alpha Logic')
    expect(alpha?.parts.map((p) => p.id)).toEqual(['alpha_buf'])
  })

  test('clearing / disabling a pack removes its section', () => {
    setCommunityPackParts('gone_lib', [samplePart('gone_part')], { name: 'Gone' })
    expect(listCommunityPackSections()).toHaveLength(1)
    clearCommunityPackParts('gone_lib')
    expect(listCommunityPackSections()).toEqual([])
  })

  test('categoryOf routes community parts to library:<packId>; authored stay my_parts', () => {
    setCommunityPackParts('cat_lib', [samplePart('cat_part')], { name: 'Catalog Lib' })
    registerUserPart(samplePart('my_custom'))
    expect(categoryOf('cat_part')).toBe(communityLibraryCategoryId('cat_lib'))
    expect(categoryLabelOf(categoryOf('cat_part'))).toBe('Library: Catalog Lib')
    expect(categoryOf('my_custom')).toBe('my_parts')
    expect(getAuthoredUserParts().map((p) => p.id)).toContain('my_custom')
    expect(getAuthoredUserParts().map((p) => p.id)).not.toContain('cat_part')
  })

  test('orderedCategories inserts library sections before My parts', () => {
    setCommunityPackParts('ord_lib', [samplePart('ord_part')], { name: 'Ordered Lib' })
    const cats = orderedCategories('schematic')
    const libIdx = cats.findIndex((c) => c.id === communityLibraryCategoryId('ord_lib'))
    const myIdx = cats.findIndex((c) => c.id === 'my_parts')
    expect(libIdx).toBeGreaterThanOrEqual(0)
    expect(myIdx).toBeGreaterThan(libIdx)
    expect(cats[libIdx]?.label).toBe('Library: Ordered Lib')
  })

  test('catalog built-ins stay on the drag palette and out of authored parts', () => {
    registerCatalogParts()
    const shown = catalogPartsForPalette().map((p) => p.id)
    for (const part of CATALOG_PARTS) {
      expect(shown).toContain(part.id)
      expect(getBuiltinParts().map((p) => p.id)).toContain(part.id)
      expect(getAuthoredUserParts().map((p) => p.id)).not.toContain(part.id)
    }
  })
})
