/**
 * Logic-level simulator — the fast path that makes chip-scale digital practical. The SAME decoder
 * that takes ~60 s on the transistor solver (logic-gates.test.ts, test.skip) evaluates here as plain
 * boolean gates, so we can check all 16 values + the calculator in a few milliseconds. The answers
 * must match the transistor truth exactly — it's the same gates, just evaluated as 0s and 1s.
 */

import { describe, expect, test } from 'vitest'
import type { BlockData, CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { CALCULATOR_4BIT, HEX_DECODER_7SEG } from '../src/renderer/builtin-blocks.ts'
import { simulateLogic } from '../src/renderer/logic-sim.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const supply = (volts: number) => ({
  nominal_voltage: scalar(volts, 'volt'),
  internal_resistance: scalar(0, 'ohm'),
})

/** Drive a block's named input ports to volts (≥2.5 = HIGH), evaluate as logic, read any output. */
function simBlock(block: BlockData, inputs: Record<string, number>): (port: string) => boolean {
  const nodes: CanvasNodeLike[] = [
    { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'block', block } },
    ...Object.entries(inputs).map(([port, volts]) => ({
      id: `in_${port}`,
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(volts) },
    })),
  ]
  const edges: CanvasEdgeLike[] = Object.keys(inputs).map((port) => ({
    id: `w_${port}`,
    source: `in_${port}`,
    sourceHandle: 'terminal_positive',
    target: 'g',
    targetHandle: port,
  }))
  const result = simulateLogic(nodes, edges)
  return (port) => result.value('g', port) === true
}

// Active-high segment patterns a..g for hex 0–F (the transistor truth the decoder is built from).
const HEX_7SEG = [
  '1111110',
  '0110000',
  '1101101',
  '1111001',
  '0110011',
  '1011011',
  '1011111',
  '1110000',
  '1111111',
  '1111011',
  '1110111',
  '0011111',
  '1001110',
  '0111101',
  '1001111',
  '1000111',
]

describe('logic-level simulator — digital blocks evaluated as 0/1, no transistors', () => {
  test('the hex 7-segment decoder gives the right segments for ALL 16 values — instantly', () => {
    for (let v = 0; v < 16; v++) {
      const read = simBlock(HEX_DECODER_7SEG, {
        d0: v & 1 ? 5 : 0,
        d1: v & 2 ? 5 : 0,
        d2: v & 4 ? 5 : 0,
        d3: v & 8 ? 5 : 0,
      })
      const segs = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
        .map((s) => (read(`seg_${s}`) ? '1' : '0'))
        .join('')
      expect(segs).toBe(HEX_7SEG[v])
    }
  })

  test('the 4-bit calculator adds and subtracts (matching the transistor solve)', () => {
    const calc = (a: number, b: number, sub: boolean): { s: number; cout: number } => {
      const read = simBlock(CALCULATOR_4BIT, {
        a0: a & 1 ? 5 : 0,
        a1: a & 2 ? 5 : 0,
        a2: a & 4 ? 5 : 0,
        a3: a & 8 ? 5 : 0,
        b0: b & 1 ? 5 : 0,
        b1: b & 2 ? 5 : 0,
        b2: b & 4 ? 5 : 0,
        b3: b & 8 ? 5 : 0,
        sub: sub ? 5 : 0,
      })
      const s =
        (read('s3') ? 8 : 0) + (read('s2') ? 4 : 0) + (read('s1') ? 2 : 0) + (read('s0') ? 1 : 0)
      return { s, cout: read('cout') ? 1 : 0 }
    }
    expect(calc(3, 1, false)).toEqual({ s: 4, cout: 0 }) // 3 + 1 = 4
    expect(calc(9, 7, false)).toEqual({ s: 0, cout: 1 }) // 9 + 7 = 16
    expect(calc(5, 3, true)).toEqual({ s: 2, cout: 1 }) // 5 − 3 = 2
    expect(calc(3, 5, true)).toEqual({ s: 14, cout: 0 }) // 3 − 5 → 14, borrow
  })

  test('an exhaustive add of every 4-bit A + B is correct (256 cases, still instant)', () => {
    let worst = 0
    const t0 = performance.now()
    for (let a = 0; a < 16; a++) {
      for (let b = 0; b < 16; b++) {
        const read = simBlock(CALCULATOR_4BIT, {
          a0: a & 1 ? 5 : 0,
          a1: a & 2 ? 5 : 0,
          a2: a & 4 ? 5 : 0,
          a3: a & 8 ? 5 : 0,
          b0: b & 1 ? 5 : 0,
          b1: b & 2 ? 5 : 0,
          b2: b & 4 ? 5 : 0,
          b3: b & 8 ? 5 : 0,
          sub: 0,
        })
        const got =
          (read('cout') ? 16 : 0) +
          (read('s3') ? 8 : 0) +
          (read('s2') ? 4 : 0) +
          (read('s1') ? 2 : 0) +
          (read('s0') ? 1 : 0)
        expect(got).toBe(a + b)
      }
    }
    worst = performance.now() - t0
    // 256 full-calculator evaluations in a flash — the transistor solver could not do even one of
    // these in the time this whole sweep takes. (Generous bound so it never flakes on a slow box.)
    expect(worst).toBeLessThan(5000)
  })
})
