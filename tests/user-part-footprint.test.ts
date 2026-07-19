/**
 * User-made parts, slice 4a — a custom part lands on the board. A custom part declares a footprint id;
 * its pins map to that footprint's pads in DECLARATION ORDER (pin 1 → pad 1, …). These lock the
 * schematic→board join for custom parts so the whole board road (ratsnest, placement, Gerber, BOM)
 * treats them like any built-in: the right footprint, the right pad per pin, and a real designator.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { BUILTIN_FOOTPRINTS } from '../src/renderer/footprint.ts'
import {
  boardDesignator,
  footprintForPart,
  footprintOptions,
  footprintsForPinCount,
  padForTerminal,
  terminalForPad,
} from '../src/renderer/footprint-assignment.ts'
import { deriveBoard, footprintByPlacement } from '../src/renderer/pcb-board.ts'
import { registerUserPart, setUserParts, type UserPart } from '../src/renderer/user-parts.ts'

const twoPin: UserPart = {
  id: 'my_sensor',
  name: 'My Sensor',
  designatorPrefix: 'U',
  footprintId: 'R_0603_1608Metric', // a 2-pad chip package
  pins: [
    { id: 'in', name: 'IN', side: 'left', electrical: 'input' },
    { id: 'out', name: 'OUT', side: 'right', electrical: 'output' },
  ],
}

// An 8-pad through-hole package for a many-pin part (exists in the footprint catalog).
const EIGHT_PAD = 'DIP-8_W7.62mm'
const eightPin: UserPart = {
  id: 'my_ic',
  name: 'My IC',
  designatorPrefix: 'U',
  footprintId: EIGHT_PAD,
  pins: Array.from({ length: 8 }, (_, i) => ({
    id: `p${i + 1}`,
    name: `P${i + 1}`,
    side: (i < 4 ? 'left' : 'right') as 'left' | 'right',
    electrical: 'passive' as const,
  })),
}

afterEach(() => setUserParts([]))

describe('footprintForPart for a custom part', () => {
  test('returns the declared footprint', () => {
    registerUserPart(twoPin)
    expect(footprintForPart('my_sensor')?.id).toBe('R_0603_1608Metric')
  })

  test('a prototype-member footprintId ("constructor" / "__proto__") is rejected, not crashed on', () => {
    // A corrupt/hostile user part whose footprintId is an inherited Object member: BUILTIN_FOOTPRINTS
    // ['constructor'] is the Object ctor (NOT undefined), so a naive `fp !== undefined && fp.pads.length`
    // would throw. Object.hasOwn rejects it → undefined (the part is honestly unfootprinted).
    registerUserPart({ ...twoPin, id: 'my_bad', footprintId: 'constructor' })
    expect(footprintForPart('my_bad')).toBeUndefined()
    // …and a prototype-member per-instance OVERRIDE falls back to the declared footprint, not a crash.
    registerUserPart(twoPin)
    expect(footprintForPart('my_sensor', '__proto__')?.id).toBe('R_0603_1608Metric')
  })

  test('a per-instance override that FITS wins; one too small falls back to the default', () => {
    registerUserPart(twoPin)
    expect(footprintForPart('my_sensor', 'R_0805_2012Metric')?.id).toBe('R_0805_2012Metric')
    // a bogus / non-existent override falls back to the part's own footprint
    expect(footprintForPart('my_sensor', 'not_a_footprint')?.id).toBe('R_0603_1608Metric')
  })

  test('a footprint with too few pads does NOT fit (honest — never a wrong package)', () => {
    registerUserPart({ ...eightPin, footprintId: 'R_0603_1608Metric' }) // 8 pins, 2-pad package
    expect(footprintForPart('my_ic')).toBeUndefined()
  })

  test('a custom part with no footprint stays off the board', () => {
    const { footprintId, ...noFp } = twoPin
    void footprintId
    registerUserPart(noFp)
    expect(footprintForPart('my_sensor')).toBeUndefined()
  })

  test('an unregistered / built-in id is unaffected by the custom path', () => {
    expect(footprintForPart('my_sensor')).toBeUndefined() // not registered
    expect(footprintForPart('resistor')?.id).toBe('R_0603_1608Metric') // built-in still works
    expect(footprintForPart('op_amp')).toBeUndefined() // built-in with no footprint, still honest
  })
})

describe('pin ↔ pad mapping (declaration order)', () => {
  test('each pin maps to the footprint pad at its index, and back', () => {
    registerUserPart(eightPin)
    const pads = BUILTIN_FOOTPRINTS[EIGHT_PAD]?.pads ?? []
    expect(pads.length).toBe(8)
    eightPin.pins.forEach((pin, i) => {
      const padId = pads[i]?.id
      expect(padForTerminal('my_ic', pin.id)).toBe(padId)
      expect(terminalForPad('my_ic', padId as string)).toBe(pin.id) // inverse round-trips
    })
  })

  test('an unknown pin / an extra pad beyond the pin count is unmapped (honest)', () => {
    registerUserPart(twoPin) // 2 pins on a 2-pad footprint
    expect(padForTerminal('my_sensor', 'nonexistent_pin')).toBeUndefined()
    // an 8-pad footprint on a 2-pin part: pads 3..8 have no pin
    registerUserPart({ ...twoPin, footprintId: EIGHT_PAD })
    const pads = BUILTIN_FOOTPRINTS[EIGHT_PAD]?.pads ?? []
    expect(terminalForPad('my_sensor', pads[0]?.id as string)).toBe('in')
    expect(terminalForPad('my_sensor', pads[7]?.id as string)).toBeUndefined()
  })
})

describe('footprint options are constrained by pin count', () => {
  test('footprintsForPinCount only lists footprints with enough pads, sorted small→large', () => {
    const two = footprintsForPinCount(2)
    expect(two.every((f) => f.pads.length >= 2)).toBe(true)
    expect(two.map((f) => f.id)).toContain('R_0603_1608Metric')
    const many = footprintsForPinCount(8)
    expect(many.every((f) => f.pads.length >= 8)).toBe(true)
    expect(many.map((f) => f.id)).not.toContain('R_0603_1608Metric') // 2-pad can't hold 8 pins
    // sorted ascending by pad count
    const counts = two.map((f) => f.pads.length)
    expect([...counts].sort((a, b) => a - b)).toEqual(counts)
  })

  test('footprintOptions(customId) matches footprintsForPinCount for the part', () => {
    registerUserPart(twoPin)
    expect(footprintOptions('my_sensor').map((f) => f.id)).toEqual(
      footprintsForPinCount(2).map((f) => f.id),
    )
  })
})

describe('a registered custom part flows through the board pipeline (deriveBoard, end to end)', () => {
  test('a custom part with a fitting footprint is PLACED, and its pins resolve to real pads on it', () => {
    registerUserPart(eightPin)
    const board = deriveBoard([{ id: 'my_ic_1', definition: 'my_ic' }], new Map())
    const placement = board.placements.find((p) => p.partId === 'my_ic_1')
    if (placement === undefined) throw new Error('custom part was not placed on the board')
    expect(placement.footprintId).toBe(EIGHT_PAD)
    const fp = footprintByPlacement(placement)
    if (fp === undefined) throw new Error('placement has no footprint')
    // no split-brain: every pin maps to a pad that ACTUALLY EXISTS on the placement's footprint
    for (const pin of eightPin.pins) {
      const pad = padForTerminal('my_ic', pin.id, placement.footprintId)
      expect(fp.pads.some((p) => p.id === pad)).toBe(true)
    }
    // the board picks up its real designator letter from the custom part
    expect(placement.designator).toBe('U1')
  })

  test('a custom part whose footprint does NOT fit is left off the board (honest)', () => {
    registerUserPart({ ...eightPin, footprintId: 'R_0603_1608Metric' }) // 8 pins on a 2-pad package
    const board = deriveBoard([{ id: 'my_ic_1', definition: 'my_ic' }], new Map())
    expect(board.placements.find((p) => p.partId === 'my_ic_1')).toBeUndefined()
  })
})

describe('boardDesignator for a custom part', () => {
  test('uses the custom part’s designator letter (U1, not the raw id)', () => {
    registerUserPart(twoPin)
    expect(boardDesignator('my_sensor_3', 'my_sensor')).toBe('U3')
  })

  test('a hand-named instance keeps its name', () => {
    registerUserPart(twoPin)
    expect(boardDesignator('mysensor', 'my_sensor')).toBe('mysensor')
  })
})
