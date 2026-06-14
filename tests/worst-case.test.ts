/**
 * Worst-case tolerance analysis tests (S21-v3-10). Sweep each toleranced part's
 * band and confirm the min/max envelope of every reading is the EXACT corner
 * value (computed by hand from the divider / Ohm's-law math), and that the worst
 * case is crossed against the part's rating.
 */

import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { toleranceParts, worstCaseAnalysis } from '../src/renderer/worst-case.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

/** 9 V (ideal) → R1 → R2 → ground, both resistors ±tol%. */
function divider(r1: number, r2: number, tol: number) {
  const nodes: CanvasNode[] = [
    {
      id: 'src',
      definition: 'power_source',
      parameters: { nominal_voltage: scalar(9, 'volt'), internal_resistance: scalar(0, 'ohm') },
    },
    {
      id: 'r1',
      definition: 'resistor',
      parameters: { resistance: scalar(r1, 'ohm'), tolerance_percent: scalar(tol, 'percent') },
    },
    {
      id: 'r2',
      definition: 'resistor',
      parameters: { resistance: scalar(r2, 'ohm'), tolerance_percent: scalar(tol, 'percent') },
    },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    { source: 'src', sourceHandle: 'terminal_positive', target: 'r1', targetHandle: 'terminal_a' },
    { source: 'r1', sourceHandle: 'terminal_b', target: 'r2', targetHandle: 'terminal_a' },
    { source: 'r2', sourceHandle: 'terminal_b', target: 'src', targetHandle: 'terminal_negative' },
    {
      source: 'gnd',
      sourceHandle: 'reference_terminal',
      target: 'src',
      targetHandle: 'terminal_negative',
    },
  ]
  return canvasToWorld(nodes, edges)
}

const entry = (result: ReturnType<typeof worstCaseAnalysis>, partId: string, q: string) =>
  result.entries.find((e) => e.partId === partId && e.quantity === q)

describe('toleranceParts', () => {
  test('finds resistors with a tolerance, with their nominal + band', () => {
    const parts = toleranceParts(divider(1000, 2000, 5))
    expect(parts.map((p) => p.id).sort()).toEqual(['r1', 'r2'])
    const r1 = parts.find((p) => p.id === 'r1')
    expect(r1?.param).toBe('resistance')
    expect(r1?.nominal).toBe(1000)
    expect(r1?.tolFraction).toBeCloseTo(0.05, 9)
  })

  test('a part with no tolerance is not swept', () => {
    const world = divider(1000, 2000, 5)
    // Strip r2's tolerance → only r1 is a tolerance part.
    const r2 = world.instances.get('r2')
    if (r2?.parameters) r2.parameters.tolerance_percent = undefined as never
    expect(toleranceParts(world).map((p) => p.id)).toEqual(['r1'])
  })
})

describe('worstCaseAnalysis — the divider envelope is the exact corner math', () => {
  const result = worstCaseAnalysis(divider(1000, 2000, 5), solveDC)

  test('the output voltage (across R2) spans its true min/max corners', () => {
    const v = entry(result, 'r2', 'voltage')
    expect(v?.nominal).toBeCloseTo(6.0, 6) // 9·2000/3000
    // max: R2 high (2100), R1 low (950) → 9·2100/3050
    expect(v?.max).toBeCloseTo((9 * 2100) / 3050, 6) // 6.1967 V
    // min: R2 low (1900), R1 high (1050) → 9·1900/2950
    expect(v?.min).toBeCloseTo((9 * 1900) / 2950, 6) // 5.7966 V
  })

  test('the loop current spans both-low (max) to both-high (min)', () => {
    const i = entry(result, 'r2', 'current')
    expect(i?.nominal).toBeCloseTo(0.003, 9) // 9/3000
    expect(i?.max).toBeCloseTo(9 / 2850, 9) // both at −5%: 3.158 mA
    expect(i?.min).toBeCloseTo(9 / 3150, 9) // both at +5%: 2.857 mA
  })

  test('a real sweep ran (swept = true, two parts)', () => {
    expect(result.swept).toBe(true)
    expect(result.toleranceParts.length).toBe(2)
  })
})

describe('worst-case crosses the rating — the question that matters', () => {
  /** 9 V (ideal) → one R (±5%) → ground, with a power rating. */
  function loaded(rOhms: number, tol: number, powerRating: number) {
    const nodes: CanvasNode[] = [
      {
        id: 'src',
        definition: 'power_source',
        parameters: { nominal_voltage: scalar(9, 'volt'), internal_resistance: scalar(0, 'ohm') },
      },
      {
        id: 'r',
        definition: 'resistor',
        parameters: {
          resistance: scalar(rOhms, 'ohm'),
          tolerance_percent: scalar(tol, 'percent'),
          power_rating: scalar(powerRating, 'watt'),
        },
      },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      { source: 'src', sourceHandle: 'terminal_positive', target: 'r', targetHandle: 'terminal_a' },
      { source: 'r', sourceHandle: 'terminal_b', target: 'src', targetHandle: 'terminal_negative' },
      {
        source: 'gnd',
        sourceHandle: 'reference_terminal',
        target: 'src',
        targetHandle: 'terminal_negative',
      },
    ]
    return canvasToWorld(nodes, edges)
  }

  test('nominal is under the rating but the worst (low-R) corner exceeds it', () => {
    // P = 81/R. Nominal R=100 → 0.81 W. Rating 0.83 W → nominal SAFE.
    const result = worstCaseAnalysis(loaded(100, 5, 0.83), solveDC)
    const p = entry(result, 'r', 'power')
    expect(p?.nominal).toBeCloseTo(0.81, 6)
    // worst: R at −5% = 95 Ω → 81/95 = 0.8526 W
    expect(p?.max).toBeCloseTo(81 / 95, 5)
    expect(p?.rating).toBe(0.83)
    expect(p?.worstFractionOfRating).toBeCloseTo(81 / 95 / 0.83, 4) // ~1.03
    expect(p?.exceedsRating).toBe(true) // nominal passed, a corner does not
  })

  test('a generous rating is never exceeded across the band', () => {
    const result = worstCaseAnalysis(loaded(100, 5, 2), solveDC)
    const p = entry(result, 'r', 'power')
    expect(p?.exceedsRating).toBe(false)
    expect(p?.worstFractionOfRating).toBeCloseTo(81 / 95 / 2, 4)
  })
})

describe('no toleranced parts → nothing to sweep', () => {
  test('swept is false and every envelope collapses to nominal', () => {
    const result = worstCaseAnalysis(divider(1000, 2000, 0), solveDC) // 0% tolerance
    expect(result.swept).toBe(false)
    const v = entry(result, 'r2', 'voltage')
    expect(v?.min).toBeCloseTo(v?.nominal ?? -1, 9)
    expect(v?.max).toBeCloseTo(v?.nominal ?? -1, 9)
  })
})
