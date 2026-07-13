/**
 * The Chip workspace's projection — deriveChip turns the schematic you drew into what it becomes on a
 * chip: the top-level parts, and the real primitive devices they flatten to (the silicon inventory).
 * It's a pure projection over the same nodes the Board level uses, one layer further down — so it's
 * unit-testable without the app. (The overlay + the level breadcrumb are React and verified in-app.)
 */

import { describe, expect, test } from 'vitest'
import type { CanvasNodeLike } from '../src/renderer/blocks.ts'
import { INVERTER_BLOCK } from '../src/renderer/builtin-blocks.ts'
import { deriveChip } from '../src/renderer/chip-workspace.tsx'

const part = (id: string, definition: string): CanvasNodeLike => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition },
})
const blockNode = (id: string, block: typeof INVERTER_BLOCK): CanvasNodeLike => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition: 'block', block },
})

describe('deriveChip — the schematic projected into its silicon inventory', () => {
  test('an empty canvas has nothing to lay out', () => {
    const c = deriveChip([], [])
    expect(c.isEmpty).toBe(true)
    expect(c.partTotal).toBe(0)
    expect(c.deviceTotal).toBe(0)
  })

  test('primitive parts are counted as-is — they are already leaves', () => {
    const c = deriveChip(
      [part('r1', 'resistor'), part('r2', 'resistor'), part('c1', 'capacitor')],
      [],
    )
    expect(c.isEmpty).toBe(false)
    expect(c.partTotal).toBe(3)
    expect(c.deviceTotal).toBe(3) // no blocks to expand, so devices === parts
    expect(c.topParts).toEqual([
      { label: 'resistor', count: 2 },
      { label: 'capacitor', count: 1 },
    ])
  })

  test('a gate block flattens all the way to its real transistors', () => {
    // One inverter ("NOT") is real CMOS — a PMOS and an NMOS. The Chip view must show it as ONE part
    // in the design but TWO devices in silicon, labelled by the transistor definitions (not "block").
    const c = deriveChip([blockNode('g1', INVERTER_BLOCK)], [])
    expect(c.partTotal).toBe(1)
    expect(c.topParts).toEqual([{ label: 'NOT', count: 1 }]) // labelled by the block's name
    expect(c.deviceTotal).toBe(2) // flattened to its two MOSFETs
    expect(c.devices).toEqual([
      { label: 'transistor_mosfet_nmos', count: 1 },
      { label: 'transistor_mosfet_pmos', count: 1 },
    ])
    // three inverters ⇒ six transistors — the projection scales with the design
    const three = deriveChip(
      [
        blockNode('a', INVERTER_BLOCK),
        blockNode('b', INVERTER_BLOCK),
        blockNode('c', INVERTER_BLOCK),
      ],
      [],
    )
    expect(three.deviceTotal).toBe(6)
    expect(three.topParts).toEqual([{ label: 'NOT', count: 3 }])
  })

  test('tallies are sorted by count, descending', () => {
    const c = deriveChip(
      [part('a', 'diode'), part('b', 'resistor'), part('c', 'resistor'), part('d', 'resistor')],
      [],
    )
    expect(c.topParts[0]).toEqual({ label: 'resistor', count: 3 })
    expect(c.topParts[1]).toEqual({ label: 'diode', count: 1 })
  })

  test('drawing annotations, net labels, and ground are not counted as silicon', () => {
    // Honesty: the panel claims "every primitive device" — a text note or a ground symbol is not one.
    const c = deriveChip(
      [
        part('r1', 'resistor'),
        part('t1', 'text_note'),
        part('n1', 'net_label'),
        part('g1', 'ground'),
      ],
      [],
    )
    expect(c.partTotal).toBe(1) // only the resistor is a real device
    expect(c.topParts).toEqual([{ label: 'resistor', count: 1 }])
    expect(c.deviceTotal).toBe(1)
    expect(c.devices).toEqual([{ label: 'resistor', count: 1 }])
  })

  test('a canvas of only annotations has nothing to lay out', () => {
    const c = deriveChip([part('t1', 'text_note'), part('n1', 'net_label')], [])
    expect(c.isEmpty).toBe(true)
    expect(c.partTotal).toBe(0)
  })
})
