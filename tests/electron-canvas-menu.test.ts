/**
 * A menu item that does nothing is worse than one that is plainly unavailable.
 *
 * THE DEFECT, established by driving the real app: "Read an FPGA Chip File…" was enabled on the My Projects
 * launcher, where no circuit canvas exists. Picking it there opened the file chooser, read the file — and
 * showed nothing: no design, no card, no message. "Open Circuit…" and "Import Netlist…" have exactly the same
 * shape, so all three are held together in one list rather than gated one at a time and forgotten.
 */

import { describe, expect, test } from 'vitest'
import { CANVAS_LOADING_ITEMS, canvasLoadingItems } from '../electron/canvas-menu.ts'

describe('the File items that hand a file to the circuit canvas', () => {
  test('every one of them is unavailable when no canvas is on screen', () => {
    const items = canvasLoadingItems(false)
    expect(items).toHaveLength(CANVAS_LOADING_ITEMS.length)
    for (const item of items) expect(item.enabled).toBe(false)
  })

  test('every one of them is available once a project canvas is on screen', () => {
    for (const item of canvasLoadingItems(true)) expect(item.enabled).toBe(true)
  })

  test('the FPGA reader is one of them, and it is named the way the menu names it', () => {
    const fpga = canvasLoadingItems(true).find((item) => item.id === 'read-fpga-chip-file')
    expect(fpga?.label).toBe('Read an FPGA Chip File…')
  })

  test('each one carries an id, which is what lets the menu find it again to grey it out', () => {
    const ids = canvasLoadingItems(true).map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z-]+$/)
  })
})
