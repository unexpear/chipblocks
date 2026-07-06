/**
 * The schematic → board join. Two jobs: the resolver picks the right footprint (or none), and the
 * mapping can't reference a footprint that doesn't exist (a dangling id would drop a part's package
 * silently) — the invariant that keeps the join honest.
 */
import { describe, expect, test } from 'vitest'
import { BUILTIN_FOOTPRINTS } from '../src/renderer/footprint.ts'
import {
  footprintForPart,
  footprintOptions,
  PART_FOOTPRINTS,
  padForTerminal,
  terminalForPad,
} from '../src/renderer/footprint-assignment.ts'

describe('footprintForPart', () => {
  test('a resistor defaults to the 0603 chip', () => {
    expect(footprintForPart('resistor')?.id).toBe('R_0603_1608Metric')
    expect(footprintForPart('capacitor')?.id).toBe('R_0603_1608Metric')
  })

  test('a transistor lands on the SOT-23 (the standard small-transistor package)', () => {
    expect(footprintForPart('transistor_bjt_npn')?.id).toBe('SOT-23')
    expect(footprintForPart('transistor_mosfet_nmos')?.id).toBe('SOT-23')
  })

  test('an unmapped part has no footprint yet (honest, not a wrong package)', () => {
    // An LED has no package in the catalog yet — it waits for one, never gets forced onto a chip.
    expect(footprintForPart('led')).toBeUndefined()
    expect(footprintForPart('diode')).toBeUndefined()
    expect(footprintForPart('not_a_part')).toBeUndefined()
  })

  test('a valid chosen footprint wins; an invalid one falls back to the default', () => {
    expect(footprintForPart('resistor', 'R_0603_1608Metric')?.id).toBe('R_0603_1608Metric')
    expect(footprintForPart('resistor', 'DIP-8_W7.62mm')?.id).toBe('R_0603_1608Metric') // not an option → default
    expect(footprintForPart('resistor', 'bogus')?.id).toBe('R_0603_1608Metric')
  })
})

describe('footprintOptions', () => {
  test('lists the part’s footprints; empty for an unmapped part', () => {
    expect(footprintOptions('resistor').map((f) => f.id)).toContain('R_0603_1608Metric')
    expect(footprintOptions('transistor_bjt_npn').map((f) => f.id)).toContain('SOT-23')
    expect(footprintOptions('led')).toEqual([])
  })

  test('a chip passive now offers all three common sizes (0402 / 0603 / 0805), 0603 default', () => {
    for (const part of ['resistor', 'capacitor', 'thermistor', 'inductor']) {
      const ids = footprintOptions(part).map((f) => f.id)
      expect(ids).toEqual(
        expect.arrayContaining(['R_0402_1005Metric', 'R_0603_1608Metric', 'R_0805_2012Metric']),
      )
      expect(footprintForPart(part)?.id).toBe('R_0603_1608Metric') // default stays the middle size
      // each smaller/larger size is a valid explicit choice
      expect(footprintForPart(part, 'R_0402_1005Metric')?.id).toBe('R_0402_1005Metric')
      expect(footprintForPart(part, 'R_0805_2012Metric')?.id).toBe('R_0805_2012Metric')
    }
  })
})

describe('the mapping references only real footprints (no dangling ids)', () => {
  for (const [part, entry] of Object.entries(PART_FOOTPRINTS)) {
    test(`${part}: default + every option exist in BUILTIN_FOOTPRINTS`, () => {
      expect(BUILTIN_FOOTPRINTS[entry.default]).toBeDefined()
      expect(entry.options).toContain(entry.default) // the default is always a listed option
      for (const id of entry.options) expect(BUILTIN_FOOTPRINTS[id]).toBeDefined()
    })
  }
})

describe('terminalForPad — pad → terminal (inverse of padForTerminal)', () => {
  test("a transistor's pads map back to their datasheet terminals", () => {
    // SOT-23 BJT: 1=base, 2=emitter, 3=collector.
    expect(terminalForPad('transistor_bjt_npn', '1')).toBe('base')
    expect(terminalForPad('transistor_bjt_npn', '2')).toBe('emitter')
    expect(terminalForPad('transistor_bjt_npn', '3')).toBe('collector')
    // SOT-23 MOSFET: 1=gate, 2=source, 3=drain.
    expect(terminalForPad('transistor_mosfet_nmos', '1')).toBe('gate')
    expect(terminalForPad('transistor_mosfet_nmos', '3')).toBe('drain')
  })

  test('it round-trips padForTerminal for every mapped part', () => {
    for (const def of ['resistor', 'transistor_bjt_npn', 'transistor_mosfet_pmos']) {
      for (const pad of ['1', '2', '3']) {
        const terminal = terminalForPad(def, pad)
        if (terminal === undefined) continue
        expect(padForTerminal(def, terminal)).toBe(pad)
      }
    }
  })

  test('an unmapped part or pad is undefined (honest, never a wrong terminal)', () => {
    expect(terminalForPad('led', '1')).toBeUndefined()
    expect(terminalForPad('transistor_bjt_npn', '9')).toBeUndefined()
  })
})
