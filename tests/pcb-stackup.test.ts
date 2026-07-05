/**
 * The PCB stack-up / materials model — the board's physical substance, every value cited. Jobs:
 * the copper weight → thickness conversion is the standard 1 oz = 35 µm; the default stack-up is
 * the KiCad 2-layer 1.6 mm FR4 board and its layers sum to that thickness; trace DC resistance is
 * ρ·L/A with the temperature drift; the IPC-2221 current capacity matches the hand-worked example
 * (a 0.25 mm 1 oz external trace ≈ 0.9 A at a 10 °C rise, consistent with the router's cited note);
 * and every material / finish / formula carries a high/medium-confidence provenance.
 */
import { describe, expect, test } from 'vitest'
import {
  BOARD_THICKNESS_PROVENANCE,
  buildStackup,
  COPPER,
  COPPER_WEIGHT_MM,
  COPPER_WEIGHT_PROVENANCE,
  defaultStackup,
  FR4_SUBSTRATE,
  IPC2221,
  STANDARD_BOARD_THICKNESSES_MM,
  SURFACE_FINISHES,
  traceAmpacity,
  traceResistanceOhm,
  traceThicknessMm,
} from '../src/renderer/pcb-stackup.ts'

describe('copper weight → thickness (the trade unit)', () => {
  test('1 oz/ft² is the standard 35 µm; the others scale linearly', () => {
    expect(COPPER_WEIGHT_MM.one_oz).toBeCloseTo(0.035, 6) // 35 µm — KiCad F.Cu / B.Cu default
    expect(COPPER_WEIGHT_MM.half_oz).toBeCloseTo(0.0175, 6)
    expect(COPPER_WEIGHT_MM.two_oz).toBeCloseTo(0.07, 6)
    expect(traceThicknessMm('one_oz')).toBe(COPPER_WEIGHT_MM.one_oz)
    expect(COPPER_WEIGHT_PROVENANCE.confidence).toBe('high')
    expect(COPPER_WEIGHT_PROVENANCE.citation).toContain('8.96') // copper density in the derivation
  })
})

describe('the default stack-up — 2-layer, 1.6 mm FR4, 1 oz, HASL', () => {
  const s = defaultStackup()

  test('it is the KiCad 2-layer default, and the layers sum to the finished thickness', () => {
    expect(s.copperLayers).toBe(2)
    expect(s.copperWeight).toBe('one_oz')
    expect(s.surfaceFinish).toBe('hasl')
    expect(s.thicknessMm).toBeCloseTo(1.6, 2) // 0.01·2 mask + 0.035·2 Cu + 1.51 core = 1.6 mm
    const summed = s.layers.reduce((t, l) => t + l.thicknessMm, 0)
    expect(summed).toBeCloseTo(s.thicknessMm, 6)
  })

  test('the cross-section is mask / copper / FR4 core / copper / mask, the core carrying Dk + Df', () => {
    expect(s.layers.map((l) => l.type)).toEqual([
      'solder_mask',
      'copper',
      'core',
      'copper',
      'solder_mask',
    ])
    const core = s.layers.find((l) => l.type === 'core')
    expect(core?.material).toBe('FR4')
    expect(core?.dielectricConstant).toBe(FR4_SUBSTRATE.dielectricConstant)
    expect(core?.lossTangent).toBe(FR4_SUBSTRATE.lossTangent)
    expect(s.provenance.confidence).toBe('high')
  })

  test('the default reproduces the installed KiCad 10.0 stack-up: 0.035 Cu / 1.51 FR4 core', () => {
    const cu = s.layers.filter((l) => l.type === 'copper')
    const core = s.layers.find((l) => l.type === 'core')
    expect(cu.every((l) => l.thicknessMm === 0.035)).toBe(true) // 1 oz
    expect(core?.thicknessMm).toBeCloseTo(1.51, 6) // 1.6 − 2·0.01 mask − 2·0.035 Cu
  })
})

describe('the stack-up EDITOR — buildStackup rebuilds the cross-section from the knobs', () => {
  test('the FR4 core recomputes so the finished board is exactly the chosen thickness, any combo', () => {
    for (const thicknessMm of STANDARD_BOARD_THICKNESSES_MM) {
      for (const copperWeight of ['half_oz', 'one_oz', 'two_oz'] as const) {
        const s = buildStackup({ thicknessMm, copperWeight, surfaceFinish: 'enig' })
        expect(s.thicknessMm).toBe(thicknessMm)
        const summed = s.layers.reduce((t, l) => t + l.thicknessMm, 0)
        expect(summed).toBeCloseTo(thicknessMm, 6) // layers always sum to the finished thickness
        const core = s.layers.find((l) => l.type === 'core')
        expect(core?.thicknessMm).toBeGreaterThan(0) // never a negative core for a standard combo
        // the copper layers carry the chosen weight
        expect(
          s.layers
            .filter((l) => l.type === 'copper')
            .every((l) => l.thicknessMm === COPPER_WEIGHT_MM[copperWeight]),
        ).toBe(true)
      }
    }
  })

  test('a thicker board with 2 oz copper: thicker core, thicker copper, chosen finish', () => {
    const s = buildStackup({ thicknessMm: 2.0, copperWeight: 'two_oz', surfaceFinish: 'osp' })
    expect(s.thicknessMm).toBe(2.0)
    expect(s.copperWeight).toBe('two_oz')
    expect(s.surfaceFinish).toBe('osp')
    expect(s.layers.find((l) => l.type === 'copper')?.thicknessMm).toBe(0.07) // 2 oz
    // core = 2.0 − 0.02 mask − 0.14 Cu = 1.84
    expect(s.layers.find((l) => l.type === 'core')?.thicknessMm).toBeCloseTo(1.84, 6)
    expect(s.provenance.title).toContain('2 mm')
    expect(s.provenance.title).toContain('OSP')
  })

  test('the standard thickness options are cited and include the 1.6 mm default', () => {
    expect(STANDARD_BOARD_THICKNESSES_MM).toContain(1.6)
    expect(STANDARD_BOARD_THICKNESSES_MM[0]).toBe(0.4)
    expect(BOARD_THICKNESS_PROVENANCE.confidence).toBe('high')
    expect(BOARD_THICKNESS_PROVENANCE.citation).toContain('PCBWay')
  })
})

describe('trace DC resistance — R = ρ(T)·L/(w·t)', () => {
  test('a 0.25 mm, 1 oz, 100 mm trace at 20 °C is ~192 mΩ', () => {
    // ρ 1.68e-8 · 0.1 m / (0.00025·0.000035 m²) = 0.192 Ω — i.e. 1 oz sheet resistance
    // 0.48 mΩ/square × (100/0.25 = 400 squares).
    const r = traceResistanceOhm(0.25, 100, 'one_oz', 20)
    expect(r).toBeCloseTo(0.192, 3)
  })

  test('resistance rises with temperature by the copper tempco (~0.39 %/°C)', () => {
    const cold = traceResistanceOhm(0.25, 100, 'one_oz', 20)
    const hot = traceResistanceOhm(0.25, 100, 'one_oz', 70) // +50 °C
    expect(hot / cold).toBeCloseTo(1 + COPPER.tempCoeffPerC * 50, 4) // ×1.196
  })

  test('degenerate inputs are 0, not NaN/∞', () => {
    expect(traceResistanceOhm(0, 100, 'one_oz')).toBe(0)
    expect(traceResistanceOhm(0.25, 0, 'one_oz')).toBe(0)
  })
})

describe('IPC-2221 trace current capacity — I = k·ΔT^0.44·A^0.725', () => {
  test('the hand-worked example: 0.25 mm, 1 oz external at ΔT 10 °C ≈ 0.88 A', () => {
    // A = 0.25·0.035 mm² = 13.56 mil²; I = 0.048·10^0.44·13.56^0.725
    const i = traceAmpacity(0.25, 'one_oz', 10, 'external')
    expect(i).toBeCloseTo(0.876, 2)
    // consistent with the router's cited note (a 0.25 mm external trace carries ~1 A at a 10 °C rise)
    expect(i).toBeGreaterThan(0.8)
    expect(i).toBeLessThan(1.0)
  })

  test('an internal trace carries about half an external one (the halved constant)', () => {
    const ext = traceAmpacity(0.25, 'one_oz', 10, 'external')
    const int = traceAmpacity(0.25, 'one_oz', 10, 'internal')
    expect(int / ext).toBeCloseTo(IPC2221.kInternal / IPC2221.kExternal, 6) // 0.5
  })

  test('2 oz copper carries more than 1 oz, and a bigger rise carries more current', () => {
    expect(traceAmpacity(0.25, 'two_oz', 10)).toBeGreaterThan(traceAmpacity(0.25, 'one_oz', 10))
    expect(traceAmpacity(0.25, 'one_oz', 20)).toBeGreaterThan(traceAmpacity(0.25, 'one_oz', 10))
    expect(IPC2221.kExternal).toBe(0.048)
    expect(IPC2221.kInternal).toBe(0.024)
    expect(IPC2221.provenance.confidence).toBe('high')
  })
})

describe('materials and finishes are cited (the anti-placeholder rule)', () => {
  test('FR4 + copper carry high/medium-confidence provenance with real citations', () => {
    expect(FR4_SUBSTRATE.provenance.citation.length).toBeGreaterThan(20)
    expect(FR4_SUBSTRATE.dielectricConstant).toBeGreaterThan(4)
    expect(FR4_SUBSTRATE.dielectricConstant).toBeLessThan(5) // real FR4 ~4.2–4.7
    expect(COPPER.provenance.confidence).toBe('high')
    expect(COPPER.resistivityOhmM).toBeCloseTo(1.68e-8, 10)
    expect(COPPER.tempCoeffPerC).toBeCloseTo(0.00393, 6)
  })

  test('every surface finish carries a cited description + lead status', () => {
    for (const finish of Object.values(SURFACE_FINISHES)) {
      expect(finish.provenance.citation.length).toBeGreaterThan(15)
      expect(finish.name.length).toBeGreaterThan(0)
      expect(typeof finish.leadFree).toBe('boolean')
    }
    // the fab default is leaded HASL; ENIG is the flat lead-free fine-pitch finish
    expect(SURFACE_FINISHES.hasl.leadFree).toBe(false)
    expect(SURFACE_FINISHES.enig.leadFree).toBe(true)
    expect(SURFACE_FINISHES.enig.provenance.citation).toContain('IPC-4552')
  })
})
