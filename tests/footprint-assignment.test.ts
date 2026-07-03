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
} from '../src/renderer/footprint-assignment.ts'

describe('footprintForPart', () => {
  test('a resistor defaults to the 0603 chip', () => {
    expect(footprintForPart('resistor')?.id).toBe('R_0603_1608Metric')
    expect(footprintForPart('capacitor')?.id).toBe('R_0603_1608Metric')
  })

  test('an unmapped part has no footprint yet (honest, not a wrong package)', () => {
    // A BJT is 3-terminal; it waits for a SOT-23/TO-92, never gets forced onto a 2-pad chip.
    expect(footprintForPart('transistor_bjt_npn')).toBeUndefined()
    expect(footprintForPart('led')).toBeUndefined()
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
    expect(footprintOptions('transistor_bjt_npn')).toEqual([])
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
