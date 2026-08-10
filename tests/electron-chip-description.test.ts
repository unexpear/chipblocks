/**
 * "Choose the chip description…" must be able to change the answer.
 *
 * THE DEFECT. The handler answered from the remembered pick BEFORE it looked at whether it had been asked out
 * loud, and a pick is remembered whenever its files can be READ — never whether they describe the chip
 * usefully. Choosing badly is the ordinary first mistake, because the dialog asks for several files at once
 * and one of them alone (an ECP5 tile map with no logic-tile description) is perfectly readable and cannot
 * decode anything. From that moment the button was dead: it handed back the same files without ever opening a
 * dialog, the same refusal came back, and there is no way inside the app to clear
 * `~/.chipblocks/fpga-chip-descriptions.json`.
 *
 * The decision lives in `electron/chip-description.ts` for the same reason `isInternalNavigation` does — the
 * handler around it is dialogs and disk, and cannot be run here.
 */

import { describe, expect, test } from 'vitest'
import { planChipDescriptionRequest } from '../electron/chip-description.ts'

const KEPT = ['/home/u/trellis/tilegrid.json', '/home/u/trellis/PLC2.db']

describe('the silent try on open', () => {
  test('answers from what was remembered, so a chip file is only ever asked about once', () => {
    expect(planChipDescriptionRequest(false, KEPT)).toEqual({ ask: false, use: KEPT })
  })

  test('with nothing remembered it still does not ask — that is what makes it silent', () => {
    expect(planChipDescriptionRequest(false, [])).toEqual({ ask: false, use: [] })
  })
})

describe('the out-loud ask', () => {
  test('ALWAYS opens the dialog, however good the remembered pick looks', () => {
    // The whole defect in one line. Anything that answers `ask: false` here is the dead end.
    expect(planChipDescriptionRequest(true, KEPT).ask).toBe(true)
    expect(planChipDescriptionRequest(true, []).ask).toBe(true)
  })

  test('and starts in the folder they looked in last time', () => {
    const plan = planChipDescriptionRequest(true, KEPT)
    expect(plan).toEqual({ ask: true, startIn: '/home/u/trellis' })
  })

  test('with nothing remembered there is no folder to start in, and none is invented', () => {
    expect(planChipDescriptionRequest(true, [])).toEqual({ ask: true, startIn: null })
  })
})
