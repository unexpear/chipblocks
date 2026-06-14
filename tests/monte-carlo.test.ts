/**
 * Monte-Carlo tolerance analysis tests. A seeded RNG makes every run reproducible, so we
 * can assert the distribution centers on nominal, stays inside the worst-case envelope,
 * and that the failure rate (yield) responds to how tight the rating is.
 */

import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { monteCarloAnalysis } from '../src/renderer/monte-carlo.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

/** 9 V (ideal) -> R1 -> R2 -> ground, both resistors +/- tol%. */
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

/** 9 V (ideal) -> one R (+/- tol%) -> ground, with a power rating. */
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

/** A tiny seeded PRNG (mulberry32) so runs are reproducible in tests. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const stat = (r: ReturnType<typeof monteCarloAnalysis>, partId: string, q: string) =>
  r.stats.find((s) => s.partId === partId && s.quantity === q)

describe('monteCarloAnalysis', () => {
  test('the output distribution centers on nominal and stays inside the worst-case envelope', () => {
    const r = monteCarloAnalysis(divider(1000, 2000, 5), solveDC, {
      samples: 2000,
      random: mulberry32(42),
    })
    const v = stat(r, 'r2', 'voltage')
    expect(v?.mean).toBeCloseTo(6.0, 1) // nominal 9*2000/3000
    expect(v?.stdDev ?? 0).toBeGreaterThan(0)
    // worst-case corners are [9*1900/2950, 9*2100/3050] = [5.797, 6.197]
    expect(v?.min ?? 0).toBeGreaterThanOrEqual(5.79)
    expect(v?.max ?? 99).toBeLessThanOrEqual(6.2)
    expect(v?.p1 ?? 0).toBeLessThan(v?.p99 ?? 0)
    expect(r.swept).toBe(true)
  })

  test('reproducible: the same seed gives the same numbers', () => {
    const a = stat(
      monteCarloAnalysis(divider(1000, 2000, 5), solveDC, { samples: 200, random: mulberry32(7) }),
      'r2',
      'voltage',
    )
    const b = stat(
      monteCarloAnalysis(divider(1000, 2000, 5), solveDC, { samples: 200, random: mulberry32(7) }),
      'r2',
      'voltage',
    )
    expect(a?.mean).toBe(b?.mean)
    expect(a?.stdDev).toBe(b?.stdDev)
  })

  test('yield: a generous rating is never breached; a tight one fails part of the time', () => {
    const safe = stat(
      monteCarloAnalysis(loaded(100, 5, 2), solveDC, { samples: 2000, random: mulberry32(3) }),
      'r',
      'power',
    )
    expect(safe?.exceedFraction).toBe(0)
    // P = 81/R, rating 0.83 -> breached when R < 97.6, a slice of an N(100, 1.67) population
    const tight = stat(
      monteCarloAnalysis(loaded(100, 5, 0.83), solveDC, { samples: 2000, random: mulberry32(3) }),
      'r',
      'power',
    )
    expect(tight?.exceedFraction ?? 0).toBeGreaterThan(0)
    expect(tight?.exceedFraction ?? 1).toBeLessThan(0.3)
  })

  test('no toleranced parts -> swept false, every distribution a spike', () => {
    const r = monteCarloAnalysis(divider(1000, 2000, 0), solveDC, {
      samples: 100,
      random: mulberry32(1),
    })
    expect(r.swept).toBe(false)
    const v = stat(r, 'r2', 'voltage')
    expect(v?.stdDev).toBe(0)
    expect(v?.mean).toBeCloseTo(6.0, 6)
  })
})
