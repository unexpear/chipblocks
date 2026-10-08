/**
 * Every hover-help id a screen asks for has a sentence, and every built-in part,
 * picker section, and Gerber layer role has one too.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { DIGIT_DISPLAY_SIZES } from '../src/renderer/builtin-blocks.ts'
import { CATALOG_PARTS } from '../src/renderer/catalog-parts.ts'
import {
  gerberRoleHelpId,
  HELP,
  hasSpecificPartHelp,
  partHelpId,
  pickerSectionHelpId,
  resolveHelp,
} from '../src/renderer/help-text.ts'
import {
  loadHoverHelpMode,
  resetHoverHelpStore,
  setHoverHelpMode,
} from '../src/renderer/hover-help-pref.ts'
import { PARTS } from '../src/renderer/palette.tsx'
import { PART_CATEGORIES } from '../src/renderer/part-categories.ts'
import { PLOT_ROLES } from '../src/renderer/pcb-gerber-plot.ts'

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      walk(path, out)
      continue
    }
    if (name.endsWith('.tsx')) out.push(path)
  }
}

function referencedHelpIds(): string[] {
  const files: string[] = []
  walk(join(process.cwd(), 'src/renderer'), files)
  const ids = new Set<string>()
  const idInText =
    /['"]((?:tool|toolbar|lens|wire|connect|status|crumb|dock|palette|picker|math|tests|pcb|board|gerber|content|shortcuts)(?:\.[A-Za-z0-9_-]+)+)['"]/g
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(idInText)) {
      const id = match[1]
      if (id !== undefined) ids.add(id)
    }
  }
  return [...ids]
}

describe('hover help registry', () => {
  test('every id a component names exists and has a name and a sentence', () => {
    const referenced = referencedHelpIds()
    expect(referenced.length).toBeGreaterThan(40)
    const missing = referenced.filter((id) => resolveHelp(id) === undefined)
    expect(missing).toEqual([])
    for (const entry of Object.values(HELP)) {
      expect(entry.name.trim().length).toBeGreaterThan(0)
      expect(entry.summary.trim().length).toBeGreaterThan(0)
    }
    for (const id of referenced) {
      const entry = resolveHelp(id)
      expect(entry?.name.trim().length).toBeGreaterThan(0)
      expect(entry?.summary.trim().length).toBeGreaterThan(0)
    }
  })

  test('every built-in part, catalog part, picker section, and Gerber role has its own sentence', () => {
    const definitions = [
      ...PARTS.map((part) => part.definition),
      ...CATALOG_PARTS.map((part) => part.id),
      ...DIGIT_DISPLAY_SIZES.flatMap((count) => [
        `display_seven_segment_${count}`,
        `display_seven_segment_bare_${count}`,
      ]),
    ]
    const missingParts = definitions.filter((id) => !hasSpecificPartHelp(id))
    expect(missingParts).toEqual([])
    for (const id of definitions) {
      const entry = resolveHelp(partHelpId(id))
      expect(entry?.summary.trim().length).toBeGreaterThan(0)
    }
    for (const category of PART_CATEGORIES) {
      const entry = resolveHelp(pickerSectionHelpId(category.id))
      expect(entry?.summary.trim().length).toBeGreaterThan(0)
    }
    const library = resolveHelp(pickerSectionHelpId('library:example'), 'Library: Example')
    expect(library?.summary.trim().length).toBeGreaterThan(0)
    for (const role of PLOT_ROLES) {
      const entry = resolveHelp(gerberRoleHelpId(role))
      expect(entry?.name.trim().length).toBeGreaterThan(0)
      expect(entry?.summary.trim().length).toBeGreaterThan(0)
    }
  })

  test('the hover-help choice is remembered', () => {
    resetHoverHelpStore()
    setHoverHelpMode('brief')
    expect(loadHoverHelpMode()).toBe('brief')
    setHoverHelpMode('off')
    expect(loadHoverHelpMode()).toBe('off')
    resetHoverHelpStore()
    expect(loadHoverHelpMode()).toBe('full')
  })
})
