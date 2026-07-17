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
  IPC2141,
  IPC2221,
  microstripImpedanceOhms,
  STANDARD_BOARD_THICKNESSES_MM,
  SURFACE_FINISHES,
  sanitizeStackup,
  striplineImpedanceOhms,
  traceAmpacity,
  traceImpedance,
  traceResistanceOhm,
  traceThicknessMm,
  VIA_PLATING_MM,
  VIA_PLATING_PROVENANCE,
  viaAmpacity,
  widthForImpedance,
} from '../src/renderer/pcb-stackup.ts'

describe('sanitizeStackup — an untrusted stack-up loaded from a file', () => {
  const DEF = { thicknessMm: 1.6, copperWeight: 'one_oz', surfaceFinish: 'hasl', copperLayers: 2 }
  test('valid options round-trip untouched', () => {
    const good = {
      thicknessMm: 2.0,
      copperWeight: 'two_oz',
      surfaceFinish: 'enig',
      copperLayers: 4,
    }
    expect(sanitizeStackup(good)).toEqual(good)
  })
  test('each invalid field falls back to the shipped default', () => {
    expect(
      sanitizeStackup({
        thicknessMm: -1,
        copperWeight: 'gold',
        surfaceFinish: 'chrome',
        copperLayers: 7,
      }),
    ).toEqual(DEF)
  })
  test('a non-object is dropped (undefined), not coerced', () => {
    expect(sanitizeStackup('nonsense')).toBeUndefined()
    expect(sanitizeStackup(null)).toBeUndefined()
    expect(sanitizeStackup(42)).toBeUndefined()
  })
  test('an Object.prototype member name is NOT accepted as a surface finish (the `in` trap)', () => {
    // 'constructor' / '__proto__' / 'toString' are INHERITED members: a naive `in SURFACE_FINISHES`
    // check passes them, then SURFACE_FINISHES['constructor'] is the Object constructor (not a finish)
    // and the fab-spec export crashes reading finish.provenance. They must fall back to the default.
    for (const bad of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      const s = sanitizeStackup({ ...DEF, surfaceFinish: bad })
      expect(s?.surfaceFinish).toBe('hasl')
      // and the fallback is a REAL finish the export can read
      expect(SURFACE_FINISHES[s?.surfaceFinish ?? 'hasl'].provenance.title.length).toBeGreaterThan(
        0,
      )
    }
  })
})

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

describe('multilevel stack-ups — 4 and 6 copper layers (the exploded-view demo)', () => {
  test('a 4-layer board: outer / prepreg / inner / core / inner / prepreg / outer, summing to the thickness', () => {
    const s = buildStackup({
      thicknessMm: 1.6,
      copperWeight: 'one_oz',
      surfaceFinish: 'hasl',
      copperLayers: 4,
    })
    expect(s.copperLayers).toBe(4)
    expect(s.layers.map((l) => l.type)).toEqual([
      'solder_mask',
      'copper',
      'prepreg',
      'copper',
      'core',
      'copper',
      'prepreg',
      'copper',
      'solder_mask',
    ])
    expect(s.layers.filter((l) => l.type === 'copper')).toHaveLength(4)
    expect(s.layers.filter((l) => l.type === 'prepreg')).toHaveLength(2)
    expect(s.layers.filter((l) => l.type === 'core')).toHaveLength(1)
    const summed = s.layers.reduce((t, l) => t + l.thicknessMm, 0)
    expect(summed).toBeCloseTo(1.6, 6) // the core still fills to the exact finished thickness
  })

  test('inner copper is lighter than outer — 0.5 oz inner planes vs the chosen outer weight', () => {
    const s = buildStackup({
      thicknessMm: 1.6,
      copperWeight: 'one_oz',
      surfaceFinish: 'hasl',
      copperLayers: 4,
    })
    const outer = s.layers.filter((l) => l.name === 'F.Cu' || l.name === 'B.Cu')
    const inner = s.layers.filter((l) => l.name.startsWith('In'))
    expect(outer.every((l) => l.thicknessMm === COPPER_WEIGHT_MM.one_oz)).toBe(true)
    expect(inner).toHaveLength(2) // In1.Cu, In2.Cu
    expect(inner.every((l) => l.thicknessMm === COPPER_WEIGHT_MM.half_oz)).toBe(true)
  })

  test('a 6-layer board: 6 copper, 3 prepregs, 2 cores, In1..In4 inner, still summing to the thickness', () => {
    const s = buildStackup({
      thicknessMm: 1.6,
      copperWeight: 'one_oz',
      surfaceFinish: 'hasl',
      copperLayers: 6,
    })
    expect(s.copperLayers).toBe(6)
    expect(s.layers.filter((l) => l.type === 'copper')).toHaveLength(6)
    expect(s.layers.filter((l) => l.type === 'prepreg')).toHaveLength(3)
    expect(s.layers.filter((l) => l.type === 'core')).toHaveLength(2)
    expect(s.layers.filter((l) => l.name.startsWith('In')).map((l) => l.name)).toEqual([
      'In1.Cu',
      'In2.Cu',
      'In3.Cu',
      'In4.Cu',
    ])
    const summed = s.layers.reduce((t, l) => t + l.thicknessMm, 0)
    expect(summed).toBeCloseTo(1.6, 6)
  })

  test('every feasible multilevel combo (4 + 6 layer, ALL copper weights) finishes at EXACTLY the ordered thickness', () => {
    // guards the half-oz 6-layer rounding trap: two cores that each round half-up would overshoot by
    // ~1 µm — the fill must be distributed so the layers sum to the ordered thickness for every weight.
    for (const thicknessMm of [1.0, 1.2, 1.6, 2.0, 2.4]) {
      for (const copperWeight of ['half_oz', 'one_oz', 'two_oz'] as const) {
        for (const copperLayers of [4, 6] as const) {
          const s = buildStackup({ thicknessMm, copperWeight, surfaceFinish: 'hasl', copperLayers })
          const summed = s.layers.reduce((t, l) => t + l.thicknessMm, 0)
          expect(summed).toBeCloseTo(thicknessMm, 6) // layers sum to the ordered thickness
          expect(s.thicknessMm).toBeCloseTo(thicknessMm, 6) // and thicknessMm reports it
        }
      }
    }
  })

  test('an infeasible thin multilevel board reports its HONEST finished thickness (layers always sum to it)', () => {
    // a 6-layer board can't be 0.4 mm — the copper + prepreg alone exceed it — so the cores clamp and
    // the real board is thicker; thicknessMm must equal Σ layers, never the impossible requested value.
    const s = buildStackup({
      thicknessMm: 0.4,
      copperWeight: 'one_oz',
      surfaceFinish: 'hasl',
      copperLayers: 6,
    })
    const summed = s.layers.reduce((t, l) => t + l.thicknessMm, 0)
    expect(s.thicknessMm).toBeCloseTo(summed, 6) // the invariant: thicknessMm === Σ layers
    expect(s.thicknessMm).toBeGreaterThan(0.4)
  })

  test('multilevel carries its own cited provenance (JLCPCB / PCBWay), 2-layer keeps the KiCad one', () => {
    const four = buildStackup({
      thicknessMm: 1.6,
      copperWeight: 'one_oz',
      surfaceFinish: 'hasl',
      copperLayers: 4,
    })
    expect(four.provenance.title).toContain('4-layer')
    expect(four.provenance.citation).toContain('prepreg')
    expect(four.provenance.citation.toLowerCase()).toContain('pcbway')
    // omitting copperLayers still builds the KiCad 2-layer default
    expect(
      buildStackup({ thicknessMm: 1.6, copperWeight: 'one_oz', surfaceFinish: 'hasl' })
        .copperLayers,
    ).toBe(2)
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

  test('a plated via barrel carries far less than a wide trace — the current bottleneck', () => {
    // 0.4 mm drill-bit, 20 µm plating lining the wall INWARD: A = π·0.02·(0.4−0.02) mm² ≈ 37.0 mil²;
    // I = 0.024·10^0.44·37.0^0.725 ≈ 0.91 A. (Using (drill+plating) would overstate the copper.)
    const i = viaAmpacity(0.4, VIA_PLATING_MM, 10)
    expect(i).toBeCloseTo(0.91, 1)
    // a smaller drill = less barrel copper = lower ampacity
    expect(viaAmpacity(0.3, VIA_PLATING_MM, 10)).toBeLessThan(viaAmpacity(0.6, VIA_PLATING_MM, 10))
    expect(VIA_PLATING_PROVENANCE.confidence).toBe('high')
    expect(VIA_PLATING_PROVENANCE.citation).toContain('IPC-6012')
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
    // the added premium / press-fit finishes, cited to their IPC-455x standards, both lead-free
    expect(SURFACE_FINISHES.enepig.provenance.citation).toContain('IPC-4556')
    expect(SURFACE_FINISHES.enepig.leadFree).toBe(true)
    expect(SURFACE_FINISHES.immersion_tin.provenance.citation).toContain('IPC-4554')
    expect(SURFACE_FINISHES.immersion_tin.leadFree).toBe(true)
    // every finish maps to a distinct name (the picker + the fab spec read these)
    const names = Object.values(SURFACE_FINISHES).map((f) => f.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('controlled impedance — IPC-2141A microstrip / stripline', () => {
  test('microstrip matches the hand-worked IPC-2141A formula', () => {
    // εr 4.2, h 0.254 mm (10 mil), w 0.508 mm (20 mil), t 0.0356 mm (1 oz):
    // Z0 = 87/√5.61 · ln(5.98·0.254 / (0.8·0.508 + 0.0356)) = 36.73 · ln(3.436) = 45.3 Ω.
    expect(microstripImpedanceOhms(0.508, 0.254, 0.0356, 4.2)).toBeCloseTo(45.3, 1)
  })

  test('symmetric stripline matches the hand-worked IPC-2141A formula', () => {
    // εr 4.2, b 0.5 mm, w 0.2 mm, t 0.0356 mm:
    // Z0 = 60/√4.2 · ln(1.9·0.5 / (0.8·0.2 + 0.0356)) = 29.28 · ln(4.857) = 46.3 Ω.
    expect(striplineImpedanceOhms(0.2, 0.5, 0.0356, 4.2)).toBeCloseTo(46.3, 1)
  })

  test('impedance falls as the trace widens (a wider trace is lower-Z)', () => {
    expect(microstripImpedanceOhms(0.2, 0.254, 0.0356, 4.2)).toBeGreaterThan(
      microstripImpedanceOhms(0.6, 0.254, 0.0356, 4.2),
    )
  })

  test('a non-physical geometry (trace as wide as the plane is far) returns 0, not a negative Z', () => {
    // ln argument ≤ 1 → the formula breaks down; report 0 rather than a bogus negative impedance.
    expect(microstripImpedanceOhms(20, 0.254, 0.0356, 4.2)).toBe(0)
    expect(microstripImpedanceOhms(0, 0.254, 0.0356, 4.2)).toBe(0)
  })

  test('a default 2-layer trace runs high-Z — the full core sits between it and the far plane', () => {
    // A 0.25 mm trace over a ~1.5 mm core is far from its reference → ~130 Ω, well above 50 Ω. This
    // is the honest reason controlled impedance wants a thin dielectric (an inner plane / thin core).
    const z = traceImpedance(defaultStackup(), 0.25)
    if (z === undefined) throw new Error('a 2-layer board has a reference plane')
    expect(z.model).toBe('microstrip')
    expect(z.ohms).toBeGreaterThan(100)
    expect(z.dielectricHeightMm).toBeGreaterThan(1) // the whole FR4 core
    expect(z.dielectricConstant).toBeCloseTo(FR4_SUBSTRATE.dielectricConstant, 1)
  })

  test('a thinner board lowers the impedance for the same trace width', () => {
    const wide =
      traceImpedance(
        buildStackup({ ...{}, thicknessMm: 1.6, copperWeight: 'one_oz', surfaceFinish: 'hasl' }),
        0.25,
      )?.ohms ?? 0
    const thin =
      traceImpedance(
        buildStackup({ thicknessMm: 0.4, copperWeight: 'one_oz', surfaceFinish: 'hasl' }),
        0.25,
      )?.ohms ?? 0
    expect(thin).toBeGreaterThan(0)
    expect(thin).toBeLessThan(wide) // closer plane → lower Z
  })

  test('widthForImpedance solves back to the target, on a thin board and a thick one', () => {
    // A thin (0.4 mm) board reaches 50 Ω with a narrow trace; a full 1.6 mm board reaches it too, but
    // only with a very WIDE trace (its plane is far). Both must round-trip back to ~50 Ω.
    const thin = buildStackup({ thicknessMm: 0.4, copperWeight: 'one_oz', surfaceFinish: 'hasl' })
    const wThin = widthForImpedance(thin, 50)
    if (wThin === undefined) throw new Error('0.4 mm board should reach 50 Ω')
    expect(traceImpedance(thin, wThin)?.ohms ?? 0).toBeCloseTo(50, 0)

    const wThick = widthForImpedance(defaultStackup(), 50)
    if (wThick === undefined) throw new Error('1.6 mm board reaches 50 Ω with a wide trace')
    expect(traceImpedance(defaultStackup(), wThick)?.ohms ?? 0).toBeCloseTo(50, 0)
    // …and the thin board needs a far narrower trace than the thick one (the honest design lesson).
    expect(wThin).toBeLessThan(wThick)
  })

  test('a target no trace can reach on the stack-up returns undefined (not a bogus width)', () => {
    // 2 Ω is below even a 10 mm-wide trace on a 1.6 mm board → honestly unreachable (too low).
    expect(widthForImpedance(defaultStackup(), 2)).toBeUndefined()
    // …and 500 Ω is above even the thinnest trace's impedance → unreachable (too high).
    expect(widthForImpedance(defaultStackup(), 500)).toBeUndefined()
  })

  test('the formula is cited with its validity range', () => {
    expect(IPC2141.provenance.confidence).toBe('high')
    expect(IPC2141.provenance.citation).toContain('IPC-2141A')
    expect(IPC2141.provenance.citation).toContain('w/h')
  })
})
