/**
 * The card a person actually reads after opening an FPGA chip file (FpgaReportCard in import-report.tsx).
 *
 * The point of these is not that the card renders — it is that the card cannot render a recovered design
 * WITHOUT its caveats. A card that quietly drops the "do not trust these" list would look perfectly fine on
 * screen and would be the exact failure this whole door exists to prevent, so each list is checked for the
 * part's name, its reason, and a heading that says in ordinary words what is wrong.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import type { FpgaOpenReport } from '../src/renderer/fpga-open.ts'
import {
  designFitPadding,
  type FpgaPanel,
  FpgaReportCard,
  NetlistReportCard,
  REPORT_MARGIN,
  REPORT_WIDTH,
} from '../src/renderer/import-report.tsx'

const render = (panel: FpgaPanel): string =>
  renderToStaticMarkup(
    createElement(FpgaReportCard, {
      panel,
      onDismiss: () => {},
      onChooseDescription: () => {},
    }),
  )

const REPORT: FpgaOpenReport = {
  family: 'ecp5',
  device: 'LFE5U-25F',
  form: 'binary',
  partCount: 11,
  pieceCount: 68,
  inputCount: 8,
  missing: [
    {
      part: 'the logic part at column 1, row 2, position 0',
      reason: 'it is a kind of part this reader cannot describe',
    },
  ],
  untrusted: [
    {
      part: 'the logic part at column 17, row 5, position 0',
      reason: 'this part is doing arithmetic',
    },
  ],
  incomplete: [
    {
      part: 'the logic part at column 3, row 4, position 1',
      reason: 'its stored value is left out',
    },
  ],
  notes: ['The file’s own checksum does not match'],
  scope:
    'What was checked: every lookup table in this chip file’s logic tiles was read. What was NOT checked: the chip’s pins and its block memories are not read at all.',
  markings: new Map(),
}

describe('the card shows what came back', () => {
  test('it names the chip and how much of it is on the canvas', () => {
    const html = render({ kind: 'read', fileName: 'design.bit', report: REPORT })
    expect(html).toContain('Lattice LFE5U-25F')
    expect(html).toContain('11 logic parts')
    expect(html).toContain('68 pieces')
    expect(html).toContain('8 chip inputs')
  })

  test('one of a thing is not called “1 things”', () => {
    const html = render({
      kind: 'read',
      fileName: 'design.bit',
      report: { ...REPORT, partCount: 1, pieceCount: 1, inputCount: 1 },
    })
    expect(html).toContain('1 logic part ')
    expect(html).not.toContain('1 logic parts')
    expect(html).not.toContain('1 chip inputs')
  })
})

describe('the card cannot show a design without showing what is wrong with it', () => {
  const html = render({ kind: 'read', fileName: 'design.bit', report: REPORT })

  test('every part that could not be read is named, with its reason', () => {
    expect(html).toContain('the logic part at column 1, row 2, position 0')
    expect(html).toContain('it is a kind of part this reader cannot describe')
    expect(html).toContain('missing from the canvas')
  })

  test('every part that must not be trusted is named, with its reason', () => {
    expect(html).toContain('the logic part at column 17, row 5, position 0')
    expect(html).toContain('this part is doing arithmetic')
    expect(html).toContain('do not trust these')
  })

  test('every part with something left out is named, with its reason', () => {
    expect(html).toContain('the logic part at column 3, row 4, position 1')
    expect(html).toContain('its stored value is left out')
    expect(html).toContain('something left out')
  })

  test('the notes are shown too', () => {
    expect(html).toContain('checksum does not match')
  })

  test('each list is counted, so nothing is hidden below the fold unannounced', () => {
    expect(html).toContain('(1)')
  })

  test('a design with nothing wrong says so, and says only as much as was checked', () => {
    const clean = render({
      kind: 'read',
      fileName: 'clean.bit',
      report: { ...REPORT, missing: [], untrusted: [], incomplete: [], notes: [] },
    })
    expect(clean).toContain('Nothing was found among the parts that were read')
    expect(clean).not.toContain('do not trust these')
    // A clean report must NOT read as a clean bill of health for the whole chip: the bound on what was looked
    // at is on the card whether or not anything was found.
    expect(clean).toContain('What was NOT checked')
    expect(clean).toContain(REPORT.scope)
  })

  test('the scope of the reading is shown even when there IS something wrong', () => {
    expect(html).toContain('What was NOT checked')
  })

  test('the card says the marks it promises will still be there tomorrow', () => {
    // The three findings above are all about parts that ARE on the canvas or missing from it; the two that are
    // on it are marked, and the card is where the user is told to look for the mark.
    expect(html).toContain('marked with a ⚠ on the canvas')
    expect(html).toContain('open it again')
  })
})

describe('the card when there is no design to show', () => {
  test('it gives the reason and offers the way forward', () => {
    const html = render({
      kind: 'refused',
      fileName: 'mystery.bin',
      reason: 'ChipBlocks does not have the description of what is inside that chip.',
      canChooseDescription: true,
    })
    expect(html).toContain('mystery.bin')
    expect(html).toContain('does not have the description')
    expect(html).toContain('Choose the chip description')
  })

  test('a file whose chip could not even be named offers no description to choose', () => {
    // Offering the button here would send the user hunting for a file that cannot help: we do not know which
    // chip it is for, so no description could be the right one.
    const html = render({
      kind: 'refused',
      fileName: 'holiday-photo.jpg',
      reason: 'This file is not an FPGA chip file ChipBlocks can read.',
      canChooseDescription: false,
    })
    expect(html).toContain('not an FPGA chip file')
    expect(html).not.toContain('Choose the chip description')
  })
})

describe('where the card sits — it must not be on top of the tools', () => {
  const html = render({ kind: 'read', fileName: 'chip.bin', report: REPORT })

  test('it is placed inside the canvas area, not pinned over the whole window', () => {
    // THE DEFECT: pinned to the window at `top: 56` it covered Connect, Lasso, Meter, Solve and Add Part, so
    // after reading a chip file the first thing you might want to do was the one thing you could not do.
    expect(html).toContain('position:absolute')
    expect(html).not.toContain('position:fixed')
    expect(html).not.toContain('top:56px')
  })

  test('it stands in the top-RIGHT corner, so the design is beside it and not under it', () => {
    expect(html).toContain(`right:${REPORT_MARGIN}px`)
    expect(html).toContain(`top:${REPORT_MARGIN}px`)
    expect(html).not.toContain('left:50%')
  })

  test('it can never be taller or wider than the canvas it sits in', () => {
    expect(html).toContain('box-sizing:border-box')
    expect(html).toContain(`max-height:calc(100% - ${REPORT_MARGIN * 2}px)`)
    expect(html).toContain(`max-width:calc(100% - ${REPORT_MARGIN * 2}px)`)
    expect(html).toContain('overflow-y:auto')
  })
})

describe('the room the canvas keeps clear for the card', () => {
  test('every side carries its unit — a bare number is a FRACTION of the pane, not pixels', () => {
    // Measured with bare numbers: `right: 374` was obeyed as 374 pane-widths, and the whole 286-part design
    // was drawn 36 pixels across.
    for (const side of Object.values(designFitPadding(true))) expect(side).toMatch(/^\d+px$/)
    for (const side of Object.values(designFitPadding(false))) expect(side).toMatch(/^\d+px$/)
  })

  test('with the card showing, the design is kept clear of at least the whole card', () => {
    const reserved = Number.parseInt(designFitPadding(true).right, 10)
    expect(reserved).toBeGreaterThanOrEqual(REPORT_WIDTH + REPORT_MARGIN * 2)
  })

  test('with the card dismissed, the design gets the canvas back', () => {
    const withCard = Number.parseInt(designFitPadding(true).right, 10)
    const without = Number.parseInt(designFitPadding(false).right, 10)
    expect(without).toBeLessThan(withCard)
    expect(without).toBe(Number.parseInt(designFitPadding(false).left, 10))
  })
})

/**
 * The refusal card — the headline that used to say the opposite of what happened.
 *
 * A netlist too big to draw was reported through the IMPORT wording with a count of zero, so the card
 * was headlined "Imported 0 parts from the netlist" and filed "Nothing was opened" underneath as a note.
 * The headline is the line people read. A refusal now has its own shape and its own title, and the
 * import wording cannot reach it.
 */
describe('a refusal is headlined as a refusal', () => {
  const refusal = (title: string, reason: string): string =>
    renderToStaticMarkup(
      createElement(NetlistReportCard, {
        report: { kind: 'refused' as const, title, reason },
        onDismiss: () => {},
      }),
    )

  test('the title is the door that refused, and the reason is underneath it', () => {
    const html = refusal(
      'Could not import that netlist',
      'This design is too big to put on the canvas.',
    )
    expect(html).toContain('Could not import that netlist')
    expect(html).toContain('This design is too big to put on the canvas.')
  })

  test('none of the import/export wording can appear on it', () => {
    const html = refusal('Could not open that circuit', 'Too big.')
    expect(html).not.toContain('Imported')
    expect(html).not.toContain('Exported')
    expect(html).not.toContain('0 part')
    expect(html).not.toContain('converted cleanly')
  })

  test('an actual import still says it imported', () => {
    const html = renderToStaticMarkup(
      createElement(NetlistReportCard, {
        report: { kind: 'import' as const, count: 3, unsupported: [], warnings: [] },
        onDismiss: () => {},
      }),
    )
    expect(html).toContain('Imported 3 parts from the netlist')
  })
})
