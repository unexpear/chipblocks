/**
 * Calculator brick ⑧ — the 10-digit decoder bank: one hex→7-seg decoder per digit, turning the 40-bit
 * BCD result into 70 segment lines for ten displays. Proven end-to-end: build the digit→segment-pattern
 * map from the real single decoder (no hardcoded table), push a number through the bank, then read all 70
 * lines back and reconstruct the number — so the segments genuinely spell the right decimal value.
 */

import { describe, expect, test } from 'vitest'
import type { CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { BCD_DECODER_10, HEX_DECODER_7SEG } from '../src/renderer/builtin-blocks.ts'
import { simulateLogic } from '../src/renderer/logic-sim.ts'

const supply = (v: number) => ({
  nominal_voltage: { value: { kind: 'scalar', amount: v, unit: 'volt' } },
})
const bits4 = (n: number) => [0, 1, 2, 3].map((i) => ((n >> i) & 1) === 1)
const SEGS = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
const w = (id: string, s: string, sh: string, t: string, th: string): CanvasEdgeLike => ({
  id,
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
})

function singlePattern(digit: number): string {
  const db = bits4(digit)
  const nodes: CanvasNodeLike[] = [
    { id: 'X', position: { x: 0, y: 0 }, data: { definition: 'block', block: HEX_DECODER_7SEG } },
    { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
    {
      id: 'vp',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(5) },
    },
    ...[0, 1, 2, 3].map((i) => ({
      id: `vd${i}`,
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(db[i] ? 5 : 0) },
    })),
  ]
  const edges: CanvasEdgeLike[] = [
    w('wp', 'vp', 'terminal_positive', 'X', 'v_dd'),
    w('wpn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    w('wg', 'X', 'gnd', 'g', 'reference_terminal'),
    ...[0, 1, 2, 3].flatMap((i) => [
      w(`wd${i}`, `vd${i}`, 'terminal_positive', 'X', `d${i}`),
      w(`wdn${i}`, `vd${i}`, 'terminal_negative', 'g', 'reference_terminal'),
    ]),
  ]
  const r = simulateLogic(nodes, edges)
  return SEGS.map((s) => (r.value('X', `seg_${s}`) === true ? '1' : '0')).join('')
}

describe('10-digit decoder bank — every digit decodes to its own segment pattern', () => {
  const patternToDigit = new Map<string, number>()
  for (let d = 0; d <= 9; d++) patternToDigit.set(singlePattern(d), d)

  const showOnBank = (n: number): number => {
    const nodes: CanvasNodeLike[] = [
      { id: 'B', position: { x: 0, y: 0 }, data: { definition: 'block', block: BCD_DECODER_10 } },
      { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
      {
        id: 'vp',
        position: { x: 0, y: 0 },
        data: { definition: 'power_source', parameters: supply(5) },
      },
    ]
    const edges: CanvasEdgeLike[] = [
      w('wp', 'vp', 'terminal_positive', 'B', 'v_dd'),
      w('wpn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
      w('wg', 'B', 'gnd', 'g', 'reference_terminal'),
    ]
    for (let d = 0; d < 10; d++) {
      const db = bits4(Math.floor(n / 10 ** d) % 10)
      for (let i = 0; i < 4; i++) {
        const bit = d * 4 + i
        nodes.push({
          id: `v${bit}`,
          position: { x: 0, y: 0 },
          data: { definition: 'power_source', parameters: supply(db[i] ? 5 : 0) },
        })
        edges.push(w(`w${bit}`, `v${bit}`, 'terminal_positive', 'B', `d${bit}`))
        edges.push(w(`wn${bit}`, `v${bit}`, 'terminal_negative', 'g', 'reference_terminal'))
      }
    }
    const r = simulateLogic(nodes, edges)
    let result = 0
    for (let d = 0; d < 10; d++) {
      const pat = SEGS.map((s) => (r.value('B', `seg_${s}_${d}`) === true ? '1' : '0')).join('')
      const digit = patternToDigit.get(pat)
      if (digit === undefined) throw new Error(`digit ${d}: unrecognized 7-seg pattern ${pat}`)
      result += digit * 10 ** d
    }
    return result
  }

  test('all ten digits have distinct patterns', () => {
    expect(patternToDigit.size).toBe(10)
  })

  test.each([0, 5, 1234567890, 9999999999, 1000000001])('the bank spells %d', (n) => {
    expect(showOnBank(n)).toBe(n)
  })
})
