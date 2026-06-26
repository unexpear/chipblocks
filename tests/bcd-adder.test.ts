/**
 * Calculator brick ① — the BCD single-digit adder, built the real way (two 4-bit binary adders + the
 * decimal "+6 correction"). Drives two BCD digits + carry-in through the actual gate circuit and reads
 * the corrected decimal digit + carry — so 7 + 5 reads 12 (digit 2, carry 1), not the binary 0xC.
 */

import { describe, expect, test } from 'vitest'
import type { CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { BCD_ADDER_BLOCK } from '../src/renderer/builtin-blocks.ts'
import { simulateLogic } from '../src/renderer/logic-sim.ts'

const supply = (v: number) => ({
  nominal_voltage: { value: { kind: 'scalar', amount: v, unit: 'volt' } },
})
const bits4 = (n: number) => [0, 1, 2, 3].map((i) => ((n >> i) & 1) === 1)

function bcdAdd(a: number, b: number, cin: boolean): { digit: number; carry: number } {
  const ab = bits4(a)
  const bb = bits4(b)
  const nodes: CanvasNodeLike[] = [
    { id: 'D', position: { x: 0, y: 0 }, data: { definition: 'block', block: BCD_ADDER_BLOCK } },
    { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
    {
      id: 'vp',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(5) },
    },
    {
      id: 'vc',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(cin ? 5 : 0) },
    },
    ...[0, 1, 2, 3].flatMap((i) => [
      {
        id: `va${i}`,
        position: { x: 0, y: 0 },
        data: { definition: 'power_source', parameters: supply(ab[i] ? 5 : 0) },
      },
      {
        id: `vb${i}`,
        position: { x: 0, y: 0 },
        data: { definition: 'power_source', parameters: supply(bb[i] ? 5 : 0) },
      },
    ]),
  ]
  const w = (id: string, s: string, sh: string, t: string, th: string): CanvasEdgeLike => ({
    id,
    source: s,
    sourceHandle: sh,
    target: t,
    targetHandle: th,
  })
  const edges: CanvasEdgeLike[] = [
    w('wp', 'vp', 'terminal_positive', 'D', 'v_dd'),
    w('wpn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    w('wg', 'D', 'gnd', 'g', 'reference_terminal'),
    w('wcin', 'vc', 'terminal_positive', 'D', 'cin'),
    w('wcinn', 'vc', 'terminal_negative', 'g', 'reference_terminal'),
    ...[0, 1, 2, 3].flatMap((i) => [
      w(`wa${i}`, `va${i}`, 'terminal_positive', 'D', `a${i}`),
      w(`wan${i}`, `va${i}`, 'terminal_negative', 'g', 'reference_terminal'),
      w(`wb${i}`, `vb${i}`, 'terminal_positive', 'D', `b${i}`),
      w(`wbn${i}`, `vb${i}`, 'terminal_negative', 'g', 'reference_terminal'),
    ]),
  ]
  const r = simulateLogic(nodes, edges)
  const bit = (h: string) => (r.value('D', h) === true ? 1 : 0)
  const digit = bit('s0') + 2 * bit('s1') + 4 * bit('s2') + 8 * bit('s3')
  return { digit, carry: bit('cout') }
}

describe('BCD digit adder — decimal add with the +6 correction', () => {
  test.each([
    [0, 0, 0, 0, 0],
    [3, 4, 0, 7, 0],
    [7, 5, 0, 2, 1], // 12 → digit 2, carry 1
    [9, 9, 1, 9, 1], // 19 → digit 9, carry 1
    [5, 5, 0, 0, 1], // 10 → digit 0, carry 1
    [8, 1, 0, 9, 0],
    [9, 0, 1, 0, 1], // 10 → digit 0, carry 1
    [4, 4, 1, 9, 0],
  ])('%d + %d + cin %d = digit %d, carry %d', (a, b, cin, digit, carry) => {
    expect(bcdAdd(a, b, cin === 1)).toEqual({ digit, carry })
  })
})
