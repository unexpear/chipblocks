/**
 * The board's drawable layer stack — the lamination the PCB view pages through. Jobs: the stack is
 * ordered top → bottom (silk, top copper, FR4 core, bottom copper); each copper sheet carries the
 * real copper-weight thickness and the core its real thickness, pulled from the stack-up; and the
 * label reads the copper weight in ounces + the core in mm. The layers track the stack-up editor —
 * change the copper weight or thickness and the sheets' labels follow.
 */
import { describe, expect, test } from 'vitest'
import { boardLayers, layerLabel } from '../src/renderer/pcb-layers.ts'
import { buildStackup, defaultStackup } from '../src/renderer/pcb-stackup.ts'

describe('boardLayers — the lamination, top → bottom', () => {
  test('the default 2-layer board is F.Silkscreen / F.Cu / FR4 core / B.Cu', () => {
    const layers = boardLayers(defaultStackup())
    expect(layers.map((l) => l.id)).toEqual(['f_silk', 'f_cu', 'core', 'b_cu'])
    expect(layers.map((l) => l.kind)).toEqual(['silk', 'copper', 'dielectric', 'copper'])
  })

  test('the copper sheets carry the real copper weight; the core its real thickness', () => {
    const layers = boardLayers(defaultStackup()) // 1 oz, 1.6 mm
    const cu = layers.filter((l) => l.kind === 'copper')
    expect(cu.every((l) => l.thicknessMm === 0.035)).toBe(true) // 1 oz = 35 µm
    expect(layers.find((l) => l.id === 'core')?.thicknessMm).toBeCloseTo(1.51, 6)
  })

  test('the sheets follow the stack-up editor: 2 oz on a 2 mm board', () => {
    const layers = boardLayers(
      buildStackup({ thicknessMm: 2.0, copperWeight: 'two_oz', surfaceFinish: 'enig' }),
    )
    expect(layers.filter((l) => l.kind === 'copper').every((l) => l.thicknessMm === 0.07)).toBe(
      true,
    )
    expect(layers.find((l) => l.id === 'core')?.thicknessMm).toBeCloseTo(1.84, 6) // 2 − 0.02 − 0.14
  })
})

describe('layerLabel', () => {
  test('copper reads as its ounce weight + µm; the core as mm; silk as ink', () => {
    const layers = boardLayers(defaultStackup())
    const byId = (id: string) => layers.find((l) => l.id === id)
    expect(layerLabel(byId('f_cu') as never)).toBe('F.Cu (1 oz, 35 µm)')
    expect(layerLabel(byId('core') as never)).toBe('FR4 core (1.51 mm)')
    expect(layerLabel(byId('f_silk') as never)).toBe('F.Silkscreen (ink)')
  })

  test('2 oz copper reads as 2 oz', () => {
    const layers = boardLayers(
      buildStackup({ thicknessMm: 1.6, copperWeight: 'two_oz', surfaceFinish: 'hasl' }),
    )
    expect(layerLabel(layers.find((l) => l.id === 'f_cu') as never)).toBe('F.Cu (2 oz, 70 µm)')
  })
})
