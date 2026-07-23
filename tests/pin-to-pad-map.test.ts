/**
 * WHICH PAD EACH PIN SOLDERS TO, for a part you authored.
 *
 * This is the join that decides where a signal physically lands, so getting it wrong doesn't produce a
 * warning — it produces a board that shorts VCC to an output. Until now a custom part's pins mapped to
 * pads purely by declaration order, which is fine for a two-pin part and useless for a 48-pin chip
 * whose datasheet names pins (IO_12) and numbers pads (31). A pin can now name its pad, the way a real
 * schematic symbol does.
 */

import { afterEach, describe, expect, test } from 'vitest'
import type { Footprint } from '../src/renderer/footprint.ts'
import { padForTerminal, terminalForPad } from '../src/renderer/footprint-assignment.ts'
import { registerUserFootprint, setUserFootprints } from '../src/renderer/user-footprints.ts'
import { buildUserPartDraft } from '../src/renderer/user-part-draft.ts'
import { validateUserPart } from '../src/renderer/user-part-validate.ts'
import { registerUserPart, setUserParts, type UserPart } from '../src/renderer/user-parts.ts'

const pad = (id: string, x: number, y: number) => ({
  id,
  center: { x, y },
  size: { w: 0.6, h: 0.3 },
  shape: 'rect' as const,
  type: 'smd' as const,
})

const footprint = (id: string, padIds: string[]): Footprint => ({
  id,
  name: id,
  description: '',
  pads: padIds.map((p, i) => pad(p, i - padIds.length / 2, 0)),
  silkscreen: [],
  fabrication: [],
  labels: { reference: { x: 0, y: -3 }, value: { x: 0, y: 3 }, fabReference: { x: 0, y: 0 } },
  courtyard: { x: -20, y: -2, w: 40, h: 4 },
  provenance: {
    source_type: 'datasheet',
    title: 'Test datasheet',
    citation: 'package drawing',
    confidence: 'high',
  },
})

const part = (id: string, pins: { name: string; pad?: string }[]): UserPart => ({
  id,
  name: id,
  designatorPrefix: 'U',
  pins: pins.map((p, i) => ({
    id: `pin_${i}`,
    name: p.name,
    side: 'left' as const,
    electrical: 'passive' as const,
    ...(p.pad !== undefined ? { pad: p.pad } : {}),
  })),
  footprintId: 'TEST_PKG',
})

afterEach(() => {
  setUserParts([])
  setUserFootprints([])
})

describe('a pin that names its pad', () => {
  test('lands on that pad, however far apart the two orders are', () => {
    // The real case: a chip numbers pads 1…6 but names its pins nothing like them.
    registerUserFootprint(footprint('TEST_PKG', ['1', '2', '3', '4', '5', '6']))
    registerUserPart(
      part('TEST_FPGA', [
        { name: 'IO_12', pad: '5' },
        { name: 'VCC', pad: '1' },
        { name: 'GND', pad: '6' },
      ]),
    )
    expect(padForTerminal('TEST_FPGA', 'pin_0')).toBe('5')
    expect(padForTerminal('TEST_FPGA', 'pin_1')).toBe('1')
    expect(padForTerminal('TEST_FPGA', 'pin_2')).toBe('6')
  })

  test('and the board can read it back the other way', () => {
    registerUserFootprint(footprint('TEST_PKG', ['1', '2', '3', '4', '5', '6']))
    registerUserPart(
      part('TEST_FPGA', [
        { name: 'IO_12', pad: '5' },
        { name: 'VCC', pad: '1' },
      ]),
    )
    expect(terminalForPad('TEST_FPGA', '5')).toBe('pin_0')
    expect(terminalForPad('TEST_FPGA', '1')).toBe('pin_1')
    // a pad no pin claimed has no terminal — honest, rather than guessed
    expect(terminalForPad('TEST_FPGA', '3')).toBeUndefined()
  })

  test('a pad name that is not on the footprint is ignored, not invented', () => {
    registerUserFootprint(footprint('TEST_PKG', ['1', '2']))
    registerUserPart(part('TEST_X', [{ name: 'A', pad: 'NOPE' }, { name: 'B' }]))
    // falls back through the remaining rules rather than pointing at a pad that doesn't exist
    expect(padForTerminal('TEST_X', 'pin_0')).toBe('1')
    expect(padForTerminal('TEST_X', 'pin_1')).toBe('2')
  })
})

describe('a pin with no pad named', () => {
  test('matches a pad that carries its name — a package drawn GND/VCC/OUT lines itself up', () => {
    registerUserFootprint(footprint('TEST_PKG', ['GND', 'VCC', 'OUT']))
    registerUserPart(part('TEST_REG', [{ name: 'OUT' }, { name: 'GND' }, { name: 'VCC' }]))
    expect(padForTerminal('TEST_REG', 'pin_0')).toBe('OUT')
    expect(padForTerminal('TEST_REG', 'pin_1')).toBe('GND')
    expect(padForTerminal('TEST_REG', 'pin_2')).toBe('VCC')
  })

  test('otherwise falls back to declaration order, as it always did', () => {
    registerUserFootprint(footprint('TEST_PKG', ['1', '2']))
    registerUserPart(part('TEST_RES', [{ name: 'a' }, { name: 'b' }]))
    expect(padForTerminal('TEST_RES', 'pin_0')).toBe('1')
    expect(padForTerminal('TEST_RES', 'pin_1')).toBe('2')
    expect(terminalForPad('TEST_RES', '2')).toBe('pin_1')
  })
})

describe('the pad a pin names survives being saved and loaded', () => {
  test('a pin keeps its pad through validation; a blank one is dropped, not stored', () => {
    const authored = buildUserPartDraft({
      name: 'Test Mapped Part',
      designatorPrefix: 'U',
      pins: [
        { name: 'IO_12', side: 'left', electrical: 'passive', pad: '5' },
        { name: 'GND', side: 'right', electrical: 'passive', pad: '  ' },
      ],
      params: [],
    })
    expect(authored.ok).toBe(true)
    if (!authored.ok) return
    expect(authored.part.pins[0]?.pad).toBe('5')
    expect(authored.part.pins[1]?.pad).toBeUndefined() // blank means "work it out", not a pad named ''

    // and it round-trips through the load gate the project/library files use
    const reloaded = validateUserPart(JSON.parse(JSON.stringify(authored.part)))
    expect(reloaded?.pins[0]?.pad).toBe('5')
    expect(reloaded?.pins[1]?.pad).toBeUndefined()
  })
})

describe('no two pins ever share a pad', () => {
  test('a named pad is not stolen by a later pin falling back to order', () => {
    // pin_1 says pad 1; pin_0 has nothing to go on and must NOT also take pad 1.
    registerUserFootprint(footprint('TEST_PKG', ['1', '2', '3']))
    registerUserPart(part('TEST_MIX', [{ name: 'a' }, { name: 'b', pad: '1' }, { name: 'c' }]))
    const pads = ['pin_0', 'pin_1', 'pin_2'].map((p) => padForTerminal('TEST_MIX', p))
    expect(pads[1]).toBe('1')
    expect(new Set(pads).size).toBe(3) // three pins, three different pads
    expect(pads).not.toContain(undefined)
  })

  test('two pins asking for the same pad: the first keeps it, the second is placed elsewhere', () => {
    registerUserFootprint(footprint('TEST_PKG', ['1', '2']))
    registerUserPart(
      part('TEST_DUP', [
        { name: 'a', pad: '1' },
        { name: 'b', pad: '1' },
      ]),
    )
    const first = padForTerminal('TEST_DUP', 'pin_0')
    const second = padForTerminal('TEST_DUP', 'pin_1')
    expect(first).toBe('1')
    expect(second).not.toBe('1') // never two pins on one pad — that is a short
    expect(second).toBe('2')
  })
})
