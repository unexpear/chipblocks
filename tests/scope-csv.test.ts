/**
 * CSV export tests (S19-v3-82/83) — the file is exactly the displayed sweep:
 * t = 0 at the trigger, one column per trace with its unit in the header
 * (volts, amps, watts), CSV-safe labels, locale-independent numbers.
 */

import { describe, expect, test } from 'vitest'
import { scopeCsv } from '../src/renderer/scope-csv.ts'

const times = [1.0e-3, 1.1e-3, 1.2e-3]

describe('scopeCsv', () => {
  test('one header plus one row per sample, t = 0 at the trigger', () => {
    const csv = scopeCsv(times, 1.1e-3, [
      { label: 'CH1 source · terminal positive', unit: 'V', values: [1.5, 2.5, 3.5] },
      { label: 'CH2 clamp', unit: 'A', values: [-0.25, 0.75, 1.75] },
    ])
    const lines = csv.split('\n')
    expect(lines.length).toBe(4)
    expect(lines[0]).toBe('time_s,CH1 source · terminal positive (V),CH2 clamp (A)')
    const middle = (lines[2] ?? '').split(',')
    expect(Number(middle[0])).toBeCloseTo(0, 12)
    expect(Number(middle[1])).toBe(2.5)
    expect(Number(middle[2])).toBe(0.75)
    const first = (lines[1] ?? '').split(',')
    expect(Number(first[0])).toBeCloseTo(-1e-4, 12)
  })

  test('a watts math column carries its unit in the header', () => {
    const csv = scopeCsv(times, 1.0e-3, [{ label: 'M A×B', unit: 'W', values: [10, 20, 30] }])
    const lines = csv.split('\n')
    expect(lines[0]).toBe('time_s,M A×B (W)')
    expect((lines[3] ?? '').split(',').pop()).toBe('30')
  })

  test('a label containing a comma or quote is CSV-quoted', () => {
    const csv = scopeCsv(times, 0, [{ label: 'weird, "name"', unit: 'V', values: [1, 2, 3] }])
    expect(csv.split('\n')[0]).toBe('time_s,"weird, ""name"" (V)"')
  })

  test('a short values array pads with 0 — the same value the trace draws', () => {
    const csv = scopeCsv(times, 0, [{ label: 'short', unit: 'V', values: [9] }])
    expect((csv.split('\n')[2] ?? '').split(',')[1]).toBe('0')
  })

  test('no columns still gives a valid time-only file', () => {
    const csv = scopeCsv(times, 0, [])
    expect(csv.split('\n')[0]).toBe('time_s')
    expect(csv.split('\n').length).toBe(4)
  })
})
