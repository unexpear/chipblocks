/**
 * Calculator brick ③a — the controlled BCD nine's-complementer (one digit). SUB=0 must pass the digit
 * through unchanged; SUB=1 must output 9 − digit. That is the switch that lets one adder do both add and
 * subtract (A − B = A + ninescomp(B) + 1). Driven through the real gate circuit for all ten digits.
 */

import { describe, expect, test } from 'vitest'
import type { CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { BCD_COMPLEMENTER_DIGIT } from '../src/renderer/builtin-blocks.ts'
import { simulateLogic } from '../src/renderer/logic-sim.ts'

const supply = (v: number) => ({
  nominal_voltage: { value: { kind: 'scalar', amount: v, unit: 'volt' } },
})
const bits4 = (n: number) => [0, 1, 2, 3].map((i) => ((n >> i) & 1) === 1)

function complement(d: number, sub: boolean): number {
  const db = bits4(d)
  const nodes: CanvasNodeLike[] = [
    {
      id: 'C',
      position: { x: 0, y: 0 },
      data: { definition: 'block', block: BCD_COMPLEMENTER_DIGIT },
    },
    { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
    {
      id: 'vp',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(5) },
    },
    {
      id: 'vs',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(sub ? 5 : 0) },
    },
    ...[0, 1, 2, 3].map((i) => ({
      id: `vd${i}`,
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(db[i] ? 5 : 0) },
    })),
  ]
  const w = (id: string, s: string, sh: string, t: string, th: string): CanvasEdgeLike => ({
    id,
    source: s,
    sourceHandle: sh,
    target: t,
    targetHandle: th,
  })
  const edges: CanvasEdgeLike[] = [
    w('wp', 'vp', 'terminal_positive', 'C', 'v_dd'),
    w('wpn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    w('wg', 'C', 'gnd', 'g', 'reference_terminal'),
    w('ws', 'vs', 'terminal_positive', 'C', 'sub'),
    w('wsn', 'vs', 'terminal_negative', 'g', 'reference_terminal'),
    ...[0, 1, 2, 3].flatMap((i) => [
      w(`wd${i}`, `vd${i}`, 'terminal_positive', 'C', `d${i}`),
      w(`wdn${i}`, `vd${i}`, 'terminal_negative', 'g', 'reference_terminal'),
    ]),
  ]
  const r = simulateLogic(nodes, edges)
  const bit = (h: string) => (r.value('C', h) === true ? 1 : 0)
  return bit('o0') + 2 * bit('o1') + 4 * bit('o2') + 8 * bit('o3')
}

describe("BCD nine's-complementer — pass-through when adding, 9 - d when subtracting", () => {
  test.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])('digit %d', (d) => {
    expect(complement(d, false)).toBe(d) // SUB=0 → pass through
    expect(complement(d, true)).toBe(9 - d) // SUB=1 → nine's complement
  })
})
