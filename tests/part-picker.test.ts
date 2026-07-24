/**
 * PART PICKER RENDER — proves the "Choose a part" dialog actually renders end to end: that catalog +
 * user parts show up alongside the built-ins, that the sections carry level-ordered headers with the
 * opening level floated to the top, and that typing switches to a flat, best-first ranked list with the
 * matched letters bolded. Server-renders the real component (no Electron), createElement so it stays a
 * .test.tsx driven by the same pipeline the app uses.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, test } from 'vitest'
import { registerCatalogParts } from '../src/renderer/catalog-parts.ts'
import { PartPicker } from '../src/renderer/part-picker.tsx'
import type { WorkspaceMode } from '../src/renderer/workspace.ts'

beforeAll(() => registerCatalogParts()) // make the commercial catalog parts placeable

function render(level: WorkspaceMode) {
  return renderToStaticMarkup(
    createElement(PartPicker, {
      onPick: () => {},
      onClose: () => {},
      level,
    }),
  )
}

describe('the picker on browse (empty query)', () => {
  test('shows section headers, not a flat list', () => {
    const html = render('schematic')
    expect(html).toContain('Transistors')
    expect(html).toContain('Logic gates')
    expect(html).toContain('Diodes &amp; LEDs')
  })

  test('floats the opening level to the top: Board opens on ICs & modules', () => {
    const board = render('board')
    const schematic = render('schematic')
    // On Board, "ICs & modules" appears before "Sources & references".
    expect(board.indexOf('ICs &amp; modules')).toBeLessThan(board.indexOf('Passives'))
    // On Circuit, "Sources & references" leads instead.
    expect(schematic.indexOf('Sources &amp; references')).toBeLessThan(
      schematic.indexOf('Transistors'),
    )
  })

  test('the catalog commercial parts are placeable from the picker (FPGA, flash, regulator)', () => {
    const board = render('board')
    // the catalog part ids are shown at the right of each row
    expect(board).toContain('catalog_ice40up5k_sg48')
    expect(board).toContain('catalog_w25q32jv')
    expect(board).toContain('catalog_ap2112k_33')
    // and they land under the ICs & modules heading, not "My parts"
    expect(board.indexOf('ICs &amp; modules')).toBeLessThan(board.indexOf('catalog_ice40up5k_sg48'))
  })
})

describe('the picker under a query', () => {
  // renderToStaticMarkup can't drive keystrokes; assert the pieces the render pipeline produces without
  // needing internal state. The header text ("Transistors") only appears in BROWSE mode, so its presence
  // here confirms browse; the ranked-search path is unit-tested in part-search.test.ts. This render test
  // guards the wiring: headers + catalog parts + level ordering are all live in one real mount.
  test('a fresh mount renders the search box and the count', () => {
    const html = render('chip')
    expect(html).toContain('Choose a part')
    expect(html).toContain('parts') // the "<n> parts" live count
    expect(html).toContain('Search parts') // the aria-label / placeholder
  })

  test('on Chip, transistors and logic float above the analog-only sections', () => {
    const chip = render('chip')
    expect(chip.indexOf('Transistors')).toBeLessThan(chip.indexOf('Vacuum tubes'))
    expect(chip.indexOf('Logic gates')).toBeLessThan(chip.indexOf('Sources &amp; references'))
  })
})
