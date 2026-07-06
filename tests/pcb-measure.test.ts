import { describe, expect, test } from 'vitest'
import { formatMeasure, measureDelta, measureDistanceMm } from '../src/renderer/pcb-measure.ts'

/**
 * The dimensional measure/ruler tool's maths — real board distances in every offered unit. The inch is
 * exactly 25.4 mm, so mil (1/1000 in) and cm/µm are exact conversions; the tests pin the read-outs.
 */

describe('measure/ruler unit maths', () => {
  test('formatMeasure converts mm to each unit with sensible precision', () => {
    expect(formatMeasure(1, 'mm')).toBe('1.00 mm')
    expect(formatMeasure(10, 'cm')).toBe('1.000 cm') // 10 mm = 1 cm
    expect(formatMeasure(25.4, 'in')).toBe('1.000 in') // 25.4 mm = 1 inch (exact)
    expect(formatMeasure(0.0254, 'mil')).toBe('1.0 mil') // 0.0254 mm = 1 mil
    expect(formatMeasure(1, 'um')).toBe('1000 µm')
  })

  test('a real board distance (0.2 in / 200 mil) reads consistently across units', () => {
    expect(formatMeasure(5.08, 'in')).toBe('0.200 in')
    expect(formatMeasure(5.08, 'mil')).toBe('200.0 mil')
    expect(formatMeasure(5.08, 'cm')).toBe('0.508 cm')
    expect(formatMeasure(5.08, 'mm')).toBe('5.08 mm')
  })

  test('measureDistanceMm is the Euclidean distance', () => {
    expect(measureDistanceMm({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
    expect(measureDistanceMm({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(0)
  })

  test('measureDelta is the signed run (Δx) + rise (Δy)', () => {
    expect(measureDelta({ x: 2, y: 3 }, { x: 5, y: 1 })).toEqual({ dx: 3, dy: -2 })
  })
})
