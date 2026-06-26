/**
 * Calculator brick ③b — the 10-digit BCD ALU: one adder doing both add and subtract, selected by the SUB
 * line (ten controlled nine's-complementers in front of the adder). Add is A+B. Subtract is ten's
 * complement: Cout=1 means A≥B (true difference); Cout=0 means A<B (result is the ten's complement of the
 * magnitude — a negative the control unit will flag later). Driven through the real gate circuit.
 */

import { describe, expect, test } from 'vitest'
import type { CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { BCD_ALU_10 } from '../src/renderer/builtin-blocks.ts'
import { simulateLogic } from '../src/renderer/logic-sim.ts'

const TEN10 = 10 ** 10
const supply = (v: number) => ({
  nominal_voltage: { value: { kind: 'scalar', amount: v, unit: 'volt' } },
})
const digitBits = (n: number, d: number) => {
  const digit = Math.floor(n / 10 ** d) % 10
  return [0, 1, 2, 3].map((i) => ((digit >> i) & 1) === 1)
}

function alu(a: number, b: number, sub: boolean): { result: number; cout: number } {
  const nodes: CanvasNodeLike[] = [
    { id: 'U', position: { x: 0, y: 0 }, data: { definition: 'block', block: BCD_ALU_10 } },
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
  ]
  const w = (id: string, s: string, sh: string, t: string, th: string): CanvasEdgeLike => ({
    id,
    source: s,
    sourceHandle: sh,
    target: t,
    targetHandle: th,
  })
  const edges: CanvasEdgeLike[] = [
    w('wp', 'vp', 'terminal_positive', 'U', 'v_dd'),
    w('wpn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    w('wg', 'U', 'gnd', 'g', 'reference_terminal'),
    w('ws', 'vs', 'terminal_positive', 'U', 'sub'),
    w('wsn', 'vs', 'terminal_negative', 'g', 'reference_terminal'),
  ]
  for (let d = 0; d < 10; d++) {
    const ab = digitBits(a, d)
    const bb = digitBits(b, d)
    for (let i = 0; i < 4; i++) {
      const bit = d * 4 + i
      nodes.push({
        id: `va${bit}`,
        position: { x: 0, y: 0 },
        data: { definition: 'power_source', parameters: supply(ab[i] ? 5 : 0) },
      })
      nodes.push({
        id: `vb${bit}`,
        position: { x: 0, y: 0 },
        data: { definition: 'power_source', parameters: supply(bb[i] ? 5 : 0) },
      })
      edges.push(w(`wa${bit}`, `va${bit}`, 'terminal_positive', 'U', `a${bit}`))
      edges.push(w(`wan${bit}`, `va${bit}`, 'terminal_negative', 'g', 'reference_terminal'))
      edges.push(w(`wb${bit}`, `vb${bit}`, 'terminal_positive', 'U', `b${bit}`))
      edges.push(w(`wbn${bit}`, `vb${bit}`, 'terminal_negative', 'g', 'reference_terminal'))
    }
  }
  const r = simulateLogic(nodes, edges)
  const bit = (h: string) => (r.value('U', h) === true ? 1 : 0)
  let result = 0
  for (let d = 0; d < 10; d++) {
    const digit =
      bit(`s${d * 4}`) +
      2 * bit(`s${d * 4 + 1}`) +
      4 * bit(`s${d * 4 + 2}`) +
      8 * bit(`s${d * 4 + 3}`)
    result += digit * 10 ** d
  }
  return { result, cout: bit('cout') }
}

describe('10-digit BCD ALU — add and subtract from one adder', () => {
  test.each([
    [7, 5],
    [1234, 5678],
    [9999999999, 1], // add overflow
    [0, 0],
  ])('%d + %d', (a, b) => {
    expect(alu(a, b, false)).toEqual({ result: (a + b) % TEN10, cout: a + b >= TEN10 ? 1 : 0 })
  })

  test.each([
    [50, 8], // 42
    [100, 1], // 99 — borrow ripples
    [1000000000, 1], // 999999999
    [5, 8], // A<B → 9999999997 (ten's complement), Cout 0
    [0, 0], // A>=B → 0, Cout 1
    [9999999999, 9999999999], // 0, Cout 1
    [123, 999], // A<B → 9999999124, Cout 0
  ])('%d - %d', (a, b) => {
    const result = (((a - b) % TEN10) + TEN10) % TEN10
    expect(alu(a, b, true)).toEqual({ result, cout: a >= b ? 1 : 0 })
  })
})
