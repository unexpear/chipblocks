/**
 * Board pipeline integration — the session's board features working TOGETHER, not just in isolation:
 * the footprint PICKER's choice flows through deriveBoard to the placement, the correct per-package
 * PINOUT, and the real pads; a hand PLACEMENT and the footprint choice both round-trip through
 * save/load side by side; and a bigger picked package genuinely changes the pads downstream. These are
 * the cross-feature seams the per-feature tests can't see.
 */
import { describe, expect, test } from 'vitest'
import { deserializeCircuit, serializeCircuit } from '../src/renderer/circuit-file.ts'
import { padForTerminal, terminalForPad } from '../src/renderer/footprint-assignment.ts'
import { deriveBoard, footprintByPlacement } from '../src/renderer/pcb-board.ts'

const picked = [
  { id: 'R1', definition: 'resistor', footprintId: 'R_0805_2012Metric' }, // picker → the larger passive
  { id: 'Q1', definition: 'transistor_bjt_npn', footprintId: 'TO-92_Inline' }, // picker → through-hole
  { id: 'R2', definition: 'resistor' }, // no choice → its default 0603
]
const overrides = new Map([
  ['R1', { x: 5, y: 5, rotation: 0 as const }],
  ['Q1', { x: 14, y: 6, rotation: 90 as const }], // a hand placement + rotation
])

describe('the picked footprint flows all the way to the board', () => {
  const board = deriveBoard(picked, overrides)
  const placementOf = (id: string) => board.placements.find((p) => p.partId === id)

  test('deriveBoard uses each part’s CHOSEN package (and the default when none)', () => {
    expect(placementOf('R1')?.footprintId).toBe('R_0805_2012Metric')
    expect(placementOf('Q1')?.footprintId).toBe('TO-92_Inline')
    expect(placementOf('R2')?.footprintId).toBe('R_0603_1608Metric') // default
    // the hand placement + rotation flowed too
    expect(placementOf('Q1')).toMatchObject({ x: 14, y: 6, rotation: 90 })
  })

  test('no split-brain: the pinout resolves against the SAME footprint whose pads the board uses', () => {
    const q1 = placementOf('Q1')
    if (q1 === undefined) throw new Error('Q1 not placed')
    // the TO-92 pinout (base on the MIDDLE pin) is used because the placement carries TO-92…
    const basePad = padForTerminal('transistor_bjt_npn', 'base', q1.footprintId)
    expect(basePad).toBe('2')
    // …and that pad id genuinely EXISTS on the footprint the placement points at (no dropped pad)
    const fp = footprintByPlacement(q1)
    expect(fp?.id).toBe('TO-92_Inline')
    expect(fp?.pads.some((p) => p.id === basePad)).toBe(true)
    // the inverse mapping agrees (pad 2 → base on TO-92, not the SOT-23 default of emitter)
    expect(terminalForPad('transistor_bjt_npn', '2', q1.footprintId)).toBe('base')
  })

  test('a bigger picked package genuinely changes the pads (0805 pads are larger than the default 0603)', () => {
    const r1 = placementOf('R1')
    const r2 = placementOf('R2')
    if (r1 === undefined || r2 === undefined) throw new Error('resistor not placed')
    const firstPadArea = (id: typeof r1) => {
      const pad = footprintByPlacement(id)?.pads[0]
      return (pad?.size.w ?? 0) * (pad?.size.h ?? 0)
    }
    // the 0805's land is bigger everywhere the board reads pads (ratsnest, DRC, gerber all read these)
    expect(firstPadArea(r1)).toBeGreaterThan(firstPadArea(r2))
  })
})

describe('save/load carries the footprint choice AND the hand placement side by side', () => {
  test('both survive a round-trip, per part', () => {
    const nodes = picked.map((n) => ({
      id: n.id,
      position: { x: 0, y: 0 },
      data: n.footprintId
        ? { definition: n.definition, footprintId: n.footprintId }
        : { definition: n.definition },
    }))
    const placements = [...overrides].map(([id, o]) => ({ id, ...o }))
    const loaded = deserializeCircuit(
      JSON.stringify(serializeCircuit(nodes, [], undefined, undefined, placements)),
    )
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    // the footprint choices come back on the nodes…
    expect(loaded.file.nodes.find((n) => n.id === 'R1')?.footprintId).toBe('R_0805_2012Metric')
    expect(loaded.file.nodes.find((n) => n.id === 'Q1')?.footprintId).toBe('TO-92_Inline')
    expect(loaded.file.nodes.find((n) => n.id === 'R2')?.footprintId).toBeUndefined() // default, unwritten
    // …and the hand placement comes back too, on the same part, in one file
    expect(loaded.file.placements?.find((p) => p.id === 'Q1')).toEqual({
      id: 'Q1',
      x: 14,
      y: 6,
      rotation: 90,
    })
    // re-deriving the board from the loaded data reproduces the SAME placement (choice + spot together)
    const reloaded = deriveBoard(
      loaded.file.nodes.map((n) => ({
        id: n.id,
        definition: n.definition,
        ...(n.footprintId ? { footprintId: n.footprintId } : {}),
      })),
      new Map(
        (loaded.file.placements ?? []).map((p) => [
          p.id,
          { x: p.x, y: p.y, rotation: p.rotation as 0 | 90 | 180 | 270 },
        ]),
      ),
    )
    const q1 = reloaded.placements.find((p) => p.partId === 'Q1')
    expect(q1?.footprintId).toBe('TO-92_Inline')
    expect(q1).toMatchObject({ x: 14, y: 6, rotation: 90 })
  })
})
