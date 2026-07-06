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
  TERMINAL_PADS_BY_FOOTPRINT,
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
    expect(footprintForPart('not_a_part')).toBeUndefined()
  })

  test('a diode lands on the SOD-123 SMD package (pad 1 = cathode)', () => {
    expect(footprintForPart('diode')?.id).toBe('D_SOD-123')
    // cathode → pad 1 (the band-marked end), anode → pad 2 — the diode-footprint convention
    expect(padForTerminal('diode', 'cathode')).toBe('1')
    expect(padForTerminal('diode', 'anode')).toBe('2')
    expect(terminalForPad('diode', '1')).toBe('cathode')
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

describe('per-footprint pinouts — a transistor pins out differently by package (SOT-23 vs TO-92)', () => {
  const transistors = [
    'transistor_bjt_npn',
    'transistor_bjt_pnp',
    'transistor_mosfet_nmos',
    'transistor_mosfet_pmos',
  ]

  test('transistors offer SOT-23 (SMD default) and TO-92 (through-hole)', () => {
    for (const def of transistors) {
      expect(footprintOptions(def).map((f) => f.id)).toEqual(
        expect.arrayContaining(['SOT-23', 'TO-92_Inline']),
      )
      expect(footprintForPart(def)?.id).toBe('SOT-23') // SMD default unchanged
      expect(footprintForPart(def, 'TO-92_Inline')?.id).toBe('TO-92_Inline') // TO-92 a valid choice
    }
  })

  test('SOT-23 keeps B/E/C = 1/2/3; TO-92 moves the control pin to the MIDDLE', () => {
    // default (no footprint) and SOT-23 agree: base on pin 1
    expect(padForTerminal('transistor_bjt_npn', 'base')).toBe('1')
    expect(padForTerminal('transistor_bjt_npn', 'base', 'SOT-23')).toBe('1')
    // TO-92 (2N3904 EBC): base is the middle pin (2), emitter pin 1, collector pin 3
    expect(padForTerminal('transistor_bjt_npn', 'base', 'TO-92_Inline')).toBe('2')
    expect(padForTerminal('transistor_bjt_npn', 'emitter', 'TO-92_Inline')).toBe('1')
    expect(padForTerminal('transistor_bjt_npn', 'collector', 'TO-92_Inline')).toBe('3')
    // MOSFET TO-92 (2N7000 SGD): gate is the middle pin
    expect(padForTerminal('transistor_mosfet_nmos', 'gate', 'TO-92_Inline')).toBe('2')
    expect(padForTerminal('transistor_mosfet_nmos', 'source', 'TO-92_Inline')).toBe('1')
    expect(padForTerminal('transistor_mosfet_nmos', 'drain', 'TO-92_Inline')).toBe('3')
  })

  test('terminalForPad honours the footprint too — pad 1 is emitter on TO-92, base on SOT-23', () => {
    expect(terminalForPad('transistor_bjt_npn', '1', 'SOT-23')).toBe('base')
    expect(terminalForPad('transistor_bjt_npn', '1', 'TO-92_Inline')).toBe('emitter')
    expect(terminalForPad('transistor_bjt_npn', '2', 'TO-92_Inline')).toBe('base')
    // round-trips on TO-92 for every transistor
    for (const def of transistors) {
      const pinout = TERMINAL_PADS_BY_FOOTPRINT[def]?.['TO-92_Inline'] ?? {}
      for (const terminal of Object.keys(pinout)) {
        const pad = padForTerminal(def, terminal, 'TO-92_Inline')
        expect(terminalForPad(def, pad as string, 'TO-92_Inline')).toBe(terminal)
      }
    }
  })

  test('a passive pins out the same in every size (0402 / 0603 / 0805 all use pads 1 / 2)', () => {
    for (const fp of ['R_0402_1005Metric', 'R_0603_1608Metric', 'R_0805_2012Metric']) {
      expect(padForTerminal('resistor', 'terminal_a', fp)).toBe('1')
      expect(padForTerminal('resistor', 'terminal_b', fp)).toBe('2')
    }
  })
})
