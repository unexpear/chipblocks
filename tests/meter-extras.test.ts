/**
 * Meter upgrades S20-v3-12..16 — the loading lesson (10 MΩ input impedance),
 * MIN/MAX/AVG off the settled record, duty riding the Hz counter, and the
 * 6000-count display quantization. (REL/zero and lead resistance live in
 * meter.test.ts with the other Ω physics.)
 */

import { describe, expect, test } from 'vitest'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import {
  acVoltsRms,
  dcExtremes,
  displayCounts,
  groundNetOf,
  terminalNets,
  voltmeterSolve,
} from '../src/renderer/meter.tsx'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

/** A divider: 10 V (ideal) over two equal resistors, mid point probed. */
function divider(ohmsEach: number) {
  const nodes: CanvasNode[] = [
    {
      id: 'src',
      definition: 'power_source',
      parameters: { nominal_voltage: scalar(10, 'volt'), internal_resistance: scalar(0, 'ohm') },
    },
    { id: 'rtop', definition: 'resistor', parameters: { resistance: scalar(ohmsEach, 'ohm') } },
    { id: 'rbot', definition: 'resistor', parameters: { resistance: scalar(ohmsEach, 'ohm') } },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    {
      source: 'src',
      sourceHandle: 'terminal_positive',
      target: 'rtop',
      targetHandle: 'terminal_a',
    },
    { source: 'rtop', sourceHandle: 'terminal_b', target: 'rbot', targetHandle: 'terminal_a' },
    {
      source: 'rbot',
      sourceHandle: 'terminal_b',
      target: 'src',
      targetHandle: 'terminal_negative',
    },
    {
      source: 'gnd',
      sourceHandle: 'reference_terminal',
      target: 'src',
      targetHandle: 'terminal_negative',
    },
  ]
  const world = canvasToWorld(nodes, edges)
  const nets = terminalNets(world)
  const mid = nets.get('rtop/terminal_b')
  const bottom = nets.get('rbot/terminal_b')
  if (mid === undefined || bottom === undefined) throw new Error('missing nets')
  return { world, mid, bottom }
}

describe('the loading lesson (S20-v3-12): the voltmeter is part of the circuit', () => {
  test('a stiff 1 kΩ divider barely notices the 10 MΩ input', () => {
    const { world, mid, bottom } = divider(1000)
    const solution = voltmeterSolve(world, mid, bottom)
    if (solution === null) throw new Error('no solution')
    const reading = (solution.nodes.get(mid) ?? 0) - (solution.nodes.get(bottom) ?? 0)
    expect(reading).toBeCloseTo(5, 3)
    expect(Math.abs(reading - 5)).toBeLessThan(1e-3)
  })

  test('a 10 MΩ divider sags to the textbook 3.33 V — the meter bends what it measures', () => {
    // Bottom leg ∥ meter input = 5 MΩ; the divider reads 10 · 5/15 = 10/3 V
    // where the unprobed point sits at 5 V.
    const { world, mid, bottom } = divider(10e6)
    const solution = voltmeterSolve(world, mid, bottom)
    if (solution === null) throw new Error('no solution')
    const reading = (solution.nodes.get(mid) ?? 0) - (solution.nodes.get(bottom) ?? 0)
    expect(reading).toBeCloseTo(10 / 3, 6)
  })

  test('groundNetOf finds the reference a lone red probe measures against', () => {
    // Drawn wires are REAL instances, so the ground part's net sits one wire
    // away from the resistor terminal — the reference is the ground part's
    // own net (the net the solver types 'ground' and holds at 0 V).
    const { world } = divider(1000)
    const groundNet = groundNetOf(world)
    expect(groundNet).toBe(terminalNets(world).get('gnd/reference_terminal'))
    const solution = voltmeterSolve(
      world,
      terminalNets(world).get('rtop/terminal_b') ?? '',
      groundNet ?? '',
    )
    expect(solution?.nodes.get(groundNet ?? '')).toBe(0)
  })

  test('V~ measures through the same input: a high-impedance AC point sags by the same 2/3', () => {
    const nodes: CanvasNode[] = [
      {
        id: 'src',
        definition: 'power_source',
        parameters: {
          nominal_voltage: scalar(0, 'volt'),
          ac_amplitude: scalar(6, 'volt'),
          frequency: scalar(1000, 'hertz'),
          internal_resistance: scalar(0, 'ohm'),
        },
      },
      { id: 'rtop', definition: 'resistor', parameters: { resistance: scalar(10e6, 'ohm') } },
      { id: 'rbot', definition: 'resistor', parameters: { resistance: scalar(10e6, 'ohm') } },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      {
        source: 'src',
        sourceHandle: 'terminal_positive',
        target: 'rtop',
        targetHandle: 'terminal_a',
      },
      { source: 'rtop', sourceHandle: 'terminal_b', target: 'rbot', targetHandle: 'terminal_a' },
      {
        source: 'rbot',
        sourceHandle: 'terminal_b',
        target: 'src',
        targetHandle: 'terminal_negative',
      },
      {
        source: 'gnd',
        sourceHandle: 'reference_terminal',
        target: 'src',
        targetHandle: 'terminal_negative',
      },
    ]
    const world = canvasToWorld(nodes, edges)
    const nets = terminalNets(world)
    const mid = nets.get('rtop/terminal_b')
    const bottom = nets.get('rbot/terminal_b')
    if (mid === undefined || bottom === undefined) throw new Error('missing nets')
    const result = acVoltsRms(world, mid, bottom)
    if (result === 'span-too-wide' || result === null) throw new Error('no AC reading')
    // Unloaded the midpoint would read (6/2)/√2 = 2.121 V rms; loaded it is
    // 2/3 of that: 1.414 V rms.
    expect(result.rms).toBeCloseTo((6 / 3) * (1 / Math.SQRT2), 2)
  })
})

describe('MIN/MAX/AVG (S20-v3-14): the record’s extremes', () => {
  test('an offset sine reads its floor, ceiling, and DC component', () => {
    const nodes: CanvasNode[] = [
      {
        id: 'src',
        definition: 'power_source',
        parameters: {
          nominal_voltage: scalar(4.5, 'volt'),
          ac_amplitude: scalar(4.5, 'volt'),
          frequency: scalar(1000, 'hertz'),
          internal_resistance: scalar(0, 'ohm'),
        },
      },
      { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(470, 'ohm') } },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      {
        source: 'src',
        sourceHandle: 'terminal_positive',
        target: 'r1',
        targetHandle: 'terminal_a',
      },
      {
        source: 'r1',
        sourceHandle: 'terminal_b',
        target: 'src',
        targetHandle: 'terminal_negative',
      },
      {
        source: 'gnd',
        sourceHandle: 'reference_terminal',
        target: 'src',
        targetHandle: 'terminal_negative',
      },
    ]
    const world = canvasToWorld(nodes, edges)
    const nets = terminalNets(world)
    const top = nets.get('r1/terminal_a')
    const bottom = nets.get('r1/terminal_b')
    if (top === undefined || bottom === undefined) throw new Error('missing nets')
    const extremes = dcExtremes(world, top, bottom)
    if (extremes === 'span-too-wide' || extremes === null) throw new Error('no extremes')
    expect(extremes.min).toBeCloseTo(0, 1)
    expect(extremes.max).toBeCloseTo(9, 1)
    expect(extremes.avg).toBeCloseTo(4.5, 1)
  })

  test('steady DC: MIN, MAX, and AVG all agree on the one value', () => {
    const { world, mid, bottom } = divider(1000)
    const extremes = dcExtremes(world, mid, bottom)
    if (extremes === 'span-too-wide' || extremes === null) throw new Error('no extremes')
    expect(extremes.min).toBeCloseTo(extremes.max, 6)
    expect(extremes.avg).toBeCloseTo(extremes.min, 6)
    expect(extremes.avg).toBeCloseTo(5, 3)
  })
})

describe('duty on the Hz display (S20-v3-16)', () => {
  test('a square clock reads ~50 % duty next to its counted frequency', () => {
    const nodes: CanvasNode[] = [
      {
        id: 'clk',
        definition: 'power_source',
        parameters: {
          nominal_voltage: scalar(2.5, 'volt'),
          ac_amplitude: scalar(2.5, 'volt'),
          frequency: scalar(1000, 'hertz'),
          internal_resistance: scalar(0, 'ohm'),
          waveform: { value: 'square' },
        },
      },
      { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(470, 'ohm') } },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      {
        source: 'clk',
        sourceHandle: 'terminal_positive',
        target: 'r1',
        targetHandle: 'terminal_a',
      },
      {
        source: 'r1',
        sourceHandle: 'terminal_b',
        target: 'clk',
        targetHandle: 'terminal_negative',
      },
      {
        source: 'gnd',
        sourceHandle: 'reference_terminal',
        target: 'clk',
        targetHandle: 'terminal_negative',
      },
    ]
    const world = canvasToWorld(nodes, edges)
    const nets = terminalNets(world)
    const top = nets.get('r1/terminal_a')
    const bottom = nets.get('r1/terminal_b')
    if (top === undefined || bottom === undefined) throw new Error('missing nets')
    const result = acVoltsRms(world, top, bottom)
    if (result === 'span-too-wide' || result === null) throw new Error('no AC reading')
    expect(result.hz).not.toBeNull()
    expect(Math.abs((result.hz ?? 0) - 1000)).toBeLessThan(15)
    expect(result.duty).not.toBeNull()
    expect(result.duty ?? 0).toBeGreaterThan(0.45)
    expect(result.duty ?? 0).toBeLessThan(0.55)
  })
})

describe('the 6000-count display (S20-v3-16)', () => {
  test('four digits, last one quantized to the range', () => {
    expect(displayCounts(1.2345678, 'V')).toBe('1.235 V')
    expect(displayCounts(470.16, 'Ω')).toBe('470.2 Ω')
    expect(displayCounts(0.0148526, 'A')).toBe('14.85 mA')
    expect(displayCounts(8.738, 'A')).toBe('8.74 A')
  })

  test('the eng prefix follows the range like the real display: 5999 Ω is 5.999 kΩ', () => {
    expect(displayCounts(5999, 'Ω')).toBe('5.999 kΩ')
    expect(displayCounts(46900, 'Ω')).toBe('46.90 kΩ')
  })

  test('zero, negatives, full scale, and float dust behave', () => {
    expect(displayCounts(0, 'V')).toBe('0.000 V')
    expect(displayCounts(-4.499, 'V')).toBe('-4.499 V')
    expect(displayCounts(6, 'V')).toBe('6.000 V')
    // Solver float dust shows a real display's zero, never e-notation.
    expect(displayCounts(-3.674e-15, 'V')).toBe('0.000 V')
  })
})
