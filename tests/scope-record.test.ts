/**
 * Scope record regression (S19-v3-75) — the exact live data path the Scope
 * uses: canvas nodes with the AC-preset parameter shape (waveform enum +
 * terminal_count present) → canvasToWorld → solveTransient over a 3-window
 * record. The source net must SWING — a flat record here is the live bug
 * where the scope showed a dead line for a 5 V / 1 kHz sine.
 */

import { describe, expect, test } from 'vitest'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { scopeWindow } from '../src/renderer/scope.tsx'
import { solveTransient } from '../src/transient-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

describe('the scope record carries the sine', () => {
  test('AC-preset source (0 V DC + 5 V·sin 1 kHz, 50 Ω) swings on its net', () => {
    const nodes: CanvasNode[] = [
      {
        id: 'src',
        definition: 'power_source',
        parameters: {
          nominal_voltage: scalar(0, 'volt'),
          internal_resistance: scalar(50, 'ohm'),
          ac_amplitude: scalar(5, 'volt'),
          frequency: scalar(1000, 'hertz'),
          terminal_count: scalar(2, 'count'),
          waveform: { value: 'sine' },
        },
      },
      { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(470, 'ohm') } },
      { id: 'gnd', definition: 'ground' },
    ]
    const edges = [
      {
        id: 'e1',
        source: 'src',
        sourceHandle: 'terminal_positive',
        target: 'r1',
        targetHandle: 'terminal_a',
      },
      {
        id: 'e2',
        source: 'r1',
        sourceHandle: 'terminal_b',
        target: 'src',
        targetHandle: 'terminal_negative',
      },
      {
        id: 'e3',
        source: 'gnd',
        sourceHandle: 'reference_terminal',
        target: 'src',
        targetHandle: 'terminal_negative',
      },
    ]
    const world = canvasToWorld(nodes, edges)
    const window = scopeWindow(world)
    expect(window.duration).toBeCloseTo(0.003, 9) // it SAW the 1 kHz source

    const result = solveTransient(world, {
      timeStep: window.timeStep,
      duration: window.duration * 3,
    })
    expect(result.status).toBe('solved')

    // The source's + net: amplitude into the 470/(470+50) divider ≈ ±4.52 V.
    const srcNet = [...world.instances.values()]
      .find((i) => i.id === 'src')
      ?.connects?.find((c) => c.terminal === 'terminal_positive')?.net
    if (srcNet === undefined) throw new Error('source net missing')
    let lo = Number.POSITIVE_INFINITY
    let hi = Number.NEGATIVE_INFINITY
    for (const pt of result.series) {
      const v = pt.nodes.get(srcNet) ?? 0
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    expect(hi).toBeGreaterThan(4)
    expect(lo).toBeLessThan(-4)
  })
})
