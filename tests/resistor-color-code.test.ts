import { describe, expect, it } from 'vitest'
import { resistorBands } from '../src/renderer/symbols.tsx'

// The IEC 60062 palette as named colours, so the cases below read like a real resistor chart.
const HEX: Record<string, string> = {
  black: '#2b2b2b',
  brown: '#7a4a2a',
  red: '#d23b2a',
  orange: '#e0852a',
  yellow: '#e6c92e',
  green: '#3a9a4a',
  blue: '#3a6ad2',
  violet: '#9a4ad2',
  grey: '#9a9a9a',
  white: '#f0f0f0',
  gold: '#c9a24a',
  silver: '#c4c4c4',
}
const bands = (...names: string[]): string[] => names.map((n) => HEX[n] ?? '?')

describe('resistor colour code (IEC 60062)', () => {
  // value (Ω), tolerance %, expected four bands — each traced against a real resistor chart.
  const cases: Array<[number, number, string[]]> = [
    [10, 5, bands('brown', 'black', 'black', 'gold')], // 10 ×10^0
    [47, 5, bands('yellow', 'violet', 'black', 'gold')], // 47 ×10^0
    [100, 5, bands('brown', 'black', 'brown', 'gold')], // 10 ×10^1
    [220, 5, bands('red', 'red', 'brown', 'gold')],
    [330, 5, bands('orange', 'orange', 'brown', 'gold')],
    [470, 5, bands('yellow', 'violet', 'brown', 'gold')],
    [1000, 5, bands('brown', 'black', 'red', 'gold')], // 1 kΩ
    [2200, 5, bands('red', 'red', 'red', 'gold')], // 2.2 kΩ
    [4700, 5, bands('yellow', 'violet', 'red', 'gold')], // 4.7 kΩ
    [10000, 5, bands('brown', 'black', 'orange', 'gold')], // 10 kΩ
    [47000, 5, bands('yellow', 'violet', 'orange', 'gold')], // 47 kΩ
    [100000, 5, bands('brown', 'black', 'yellow', 'gold')], // 100 kΩ
    [1000000, 5, bands('brown', 'black', 'green', 'gold')], // 1 MΩ
    [2200000, 5, bands('red', 'red', 'green', 'gold')], // 2.2 MΩ
    [1, 5, bands('brown', 'black', 'gold', 'gold')], // 1 Ω → ×0.1 multiplier
    [4.7, 5, bands('yellow', 'violet', 'gold', 'gold')], // 4.7 Ω → ×0.1
    [0.47, 5, bands('yellow', 'violet', 'silver', 'gold')], // 0.47 Ω → ×0.01
  ]

  for (const [ohms, tol, expected] of cases) {
    it(`${ohms} Ω → its real 4-band code`, () => {
      expect(resistorBands(ohms, tol)).toEqual(expected)
    })
  }

  it('the tolerance band follows the spec (brown 1%, red 2%, gold 5%, silver 10%)', () => {
    expect(resistorBands(1000, 1)).toEqual(bands('brown', 'black', 'red', 'brown'))
    expect(resistorBands(1000, 2)).toEqual(bands('brown', 'black', 'red', 'red'))
    expect(resistorBands(1000, 5)).toEqual(bands('brown', 'black', 'red', 'gold'))
    expect(resistorBands(1000, 10)).toEqual(bands('brown', 'black', 'red', 'silver'))
  })

  it('a value that rounds up past 99 carries into the next decade (995 → 1 kΩ)', () => {
    expect(resistorBands(995, 5)).toEqual(resistorBands(1000, 5))
  })

  it('a non-physical value paints no bands (no crash, no garbage)', () => {
    expect(resistorBands(0, 5)).toEqual([])
    expect(resistorBands(-10, 5)).toEqual([])
    expect(resistorBands(Number.NaN, 5)).toEqual([])
    expect(resistorBands(Number.POSITIVE_INFINITY, 5)).toEqual([])
  })

  it('two or more different resistors each get their own valid, independent code', () => {
    const values = [10, 47, 220, 470, 1000, 4700, 10000, 100000, 1000000]
    const all = values.map((v) => resistorBands(v, 5))

    // Every resistor produces a clean 4-band array of real hex colours — never undefined or empty.
    for (const b of all) {
      expect(b).toHaveLength(4)
      for (const c of b) expect(c).toMatch(/^#[0-9a-f]{6}$/i)
    }

    // Purity: the same value gives the same code no matter how many other resistors were computed —
    // so two resistors on one canvas can't bleed into each other.
    expect(resistorBands(1000, 5)).toEqual(all[values.indexOf(1000)])

    // Distinct values give distinct codes — no shared-state collision.
    const codes = all.map((b) => b.join())
    expect(new Set(codes).size).toBe(values.length)
  })
})
