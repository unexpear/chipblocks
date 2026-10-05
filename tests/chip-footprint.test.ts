/**
 * Chip-level author-OR-derive footprints: authored package when it fits and pad maps are honest;
 * labeled derived land from known pin/pad data otherwise; refuse when ambiguous or role-sensitive.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { INVERTER_BLOCK, NAND2_BLOCK } from '../src/renderer/builtin-blocks.ts'
import {
  applyChipFootprintEdit,
  chipPinsFromBlock,
  chipPinsFromCellName,
  chipPinsFromTopNetlist,
  footprintForBlock,
  footprintForCell,
  footprintForChipDesign,
  resolveChipFootprint,
} from '../src/renderer/chip-footprint.ts'
import { type Footprint, PROVISIONAL_LAND_NOTE } from '../src/renderer/footprint.ts'
import { deriveBoard, padForBoardPart } from '../src/renderer/pcb-board.ts'
import type { TopNetlist } from '../src/renderer/top-netlist.ts'
import { registerUserFootprint, setUserFootprints } from '../src/renderer/user-footprints.ts'

afterEach(() => setUserFootprints([]))

function land(id: string, padIds: string[]): Footprint {
  return {
    id,
    name: id,
    description: 'user land',
    pads: padIds.map((padId, i) => ({
      id: padId,
      center: { x: i * 2.54, y: 0 },
      size: { w: 1.7, h: 1.7 },
      shape: 'circle' as const,
      type: 'through_hole' as const,
      holeDiameter: 1,
    })),
    silkscreen: [],
    fabrication: [],
    labels: { reference: { x: 0, y: -2 }, value: { x: 0, y: 2 }, fabReference: { x: 0, y: 0 } },
    courtyard: { x: -2, y: -2, w: padIds.length * 2.54 + 2, h: 4 },
    provenance: {
      source_type: 'datasheet',
      title: 'test',
      citation: 'drawing',
      confidence: 'high',
    },
  }
}

describe('resolveChipFootprint author OR derive', () => {
  test('honest unique pins derive a labeled provisional land', () => {
    const pins = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'y', name: 'Y' },
    ]
    const r = resolveChipFootprint({ pins })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.source).toBe('derived')
    expect(r.footprint.id).toBe('provisional_3pad')
    expect(r.footprint.provisional).toBe(true)
    expect(r.footprint.description).toContain(PROVISIONAL_LAND_NOTE)
    expect([...r.padMap.entries()]).toEqual([
      ['a', '1'],
      ['b', '2'],
      ['y', '3'],
    ])
  })

  test('an authored package that fits wins over derive', () => {
    const pins = [
      { id: 'in', name: 'IN' },
      { id: 'out', name: 'OUT' },
    ]
    expect(registerUserFootprint(land('CHIP_LAND', ['1', '2']))).toBe(true)
    const r = resolveChipFootprint({ pins, authoredId: 'CHIP_LAND' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.source).toBe('authored')
    expect(r.footprint.id).toBe('CHIP_LAND')
    expect(r.footprint.provisional).toBeUndefined()
  })

  test('refuses duplicate pin ids and empty pins', () => {
    expect(resolveChipFootprint({ pins: [] }).ok).toBe(false)
    const dup = resolveChipFootprint({
      pins: [
        { id: 'a', name: 'A' },
        { id: 'a', name: 'A2' },
      ],
    })
    expect(dup.ok).toBe(false)
    if (dup.ok) return
    expect(dup.reason).toBe('duplicate-pin-ids')
  })

  test('role-sensitive kinds refuse derive and refuse declaration-order authored maps', () => {
    const pins = [
      { id: 'inp', name: 'IN+' },
      { id: 'inn', name: 'IN-' },
      { id: 'out', name: 'OUT' },
      { id: 'vcc', name: 'V+' },
      { id: 'vee', name: 'V-' },
    ]
    const derived = resolveChipFootprint({ pins, roleSensitive: true })
    expect(derived.ok).toBe(false)
    if (derived.ok) return
    expect(derived.reason).toBe('role-sensitive')

    expect(registerUserFootprint(land('OP_LAND', ['1', '2', '3', '4', '5']))).toBe(true)
    const byOrder = resolveChipFootprint({
      pins,
      authoredId: 'OP_LAND',
      roleSensitive: true,
    })
    expect(byOrder.ok).toBe(false)
    if (byOrder.ok) return
    expect(byOrder.reason).toBe('role-sensitive')

    const explicit = pins.map((p, i) => ({ ...p, pad: String(i + 1) }))
    const authored = resolveChipFootprint({
      pins: explicit,
      authoredId: 'OP_LAND',
      roleSensitive: true,
    })
    expect(authored.ok).toBe(true)
    if (!authored.ok) return
    expect(authored.source).toBe('authored')
  })

  test('ambiguous explicit pad claims refuse rather than silent remap', () => {
    expect(registerUserFootprint(land('TWO', ['1', '2']))).toBe(true)
    const r = resolveChipFootprint({
      pins: [
        { id: 'a', name: 'A', pad: '9' },
        { id: 'b', name: 'B' },
      ],
      authoredId: 'TWO',
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('ambiguous-pads')
  })
})

describe('cell / block / chip design pin sources', () => {
  test('a standard cell has a LEF-facing pin abstract that derives', () => {
    const pins = chipPinsFromCellName('NOT')
    expect(pins?.map((p) => p.name).sort()).toEqual(['A', 'VDD', 'VSS', 'Y'].sort())
    const r = footprintForCell('NOT')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.source).toBe('derived')
    expect(r.footprint.id).toBe(`provisional_${String(pins?.length)}pad`)
    expect(footprintForCell('not_a_real_cell').ok).toBe(false)
  })

  test('a circuit block with unique ports is not packageless', () => {
    const r = footprintForBlock(NAND2_BLOCK)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.source).toBe('derived')
    expect(chipPinsFromBlock(INVERTER_BLOCK).map((p) => p.id)).toEqual(['in', 'gnd', 'out', 'v_dd'])
  })

  test('top-level chip I/O from a netlist derives when pins exist', () => {
    const netlist: TopNetlist = {
      hasCells: true,
      tieConnections: [],
      signalNets: [
        { name: 'clk', connections: [], pin: { name: 'CLK', direction: 'INPUT' } },
        { name: 'q', connections: [], pin: { name: 'Q', direction: 'OUTPUT' } },
        { name: 'internal', connections: [] },
      ],
    }
    expect(chipPinsFromTopNetlist(netlist)).toEqual([
      { id: 'CLK', name: 'CLK' },
      { id: 'Q', name: 'Q' },
    ])
    const r = footprintForChipDesign(netlist)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.footprint.id).toBe('provisional_2pad')
    expect(footprintForChipDesign({ hasCells: false, tieConnections: [], signalNets: [] }).ok).toBe(
      false,
    )
  })
})

describe('keep-matching with board assignment', () => {
  test('deriveBoard places a block with chipPins on a derived land', () => {
    const pins = chipPinsFromBlock(INVERTER_BLOCK)
    const board = deriveBoard([{ id: 'U1', definition: 'block', chipPins: pins }])
    expect(board.placements).toHaveLength(1)
    expect(board.placements[0]?.footprintId).toBe(`provisional_${String(pins.length)}pad`)
    expect(padForBoardPart({ id: 'U1', definition: 'block', chipPins: pins }, 'in')).toBe('1')
    expect(padForBoardPart({ id: 'U1', definition: 'block', chipPins: pins }, 'out')).toBe('3')
  })

  test('an authored edit writes back only when the package honestly fits', () => {
    const pins = chipPinsFromBlock(INVERTER_BLOCK)
    expect(registerUserFootprint(land('INV_PKG', ['1', '2', '3', '4']))).toBe(true)
    const part: { footprintId?: string } = {}
    const next = applyChipFootprintEdit(part, pins, land('INV_PKG', ['1', '2', '3', '4']))
    expect(next.footprintId).toBe('INV_PKG')
    const board = deriveBoard([
      { id: 'U1', definition: 'block', footprintId: 'INV_PKG', chipPins: pins },
    ])
    expect(board.placements[0]?.footprintId).toBe('INV_PKG')

    // Too few pads — leave unchanged
    expect(registerUserFootprint(land('TINY', ['1', '2']))).toBe(true)
    expect(
      applyChipFootprintEdit({ footprintId: 'INV_PKG' }, pins, land('TINY', ['1', '2']))
        .footprintId,
    ).toBe('INV_PKG')
  })

  test('definition block without chipPins stays packageless (role-sensitive gate)', () => {
    expect(deriveBoard([{ id: 'U1', definition: 'block' }]).placements).toEqual([])
  })
})
