/**
 * Calculator brick ② — the 10-digit BCD adder (ten single-digit BCD adders chained, decimal carry
 * rippling LSD→MSD). Drives two full-width decimal numbers through the real gate circuit and reads the
 * 10-digit result + overflow carry, checking against plain a+b — including all-nines carry propagation
 * and the wrap past 9 999 999 999.
 */

import { describe, expect, test } from 'vitest'
import type { CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { BCD_ADDER_10 } from '../src/renderer/builtin-blocks.ts'
import { simulateLogic } from '../src/renderer/logic-sim.ts'

const supply = (v: number) => ({
  nominal_voltage: { value: { kind: 'scalar', amount: v, unit: 'volt' } },
})
const digitBits = (n: number, d: number) => {
  const digit = Math.floor(n / 10 ** d) % 10
  return [0, 1, 2, 3].map((i) => ((digit >> i) & 1) === 1)
}

function add10(a: number, b: number): { result: number; cout: number } {
  const nodes: CanvasNodeLike[] = [
    { id: 'D', position: { x: 0, y: 0 }, data: { definition: 'block', block: BCD_ADDER_10 } },
    { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
    {
      id: 'vp',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(5) },
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
    w('wp', 'vp', 'terminal_positive', 'D', 'v_dd'),
    w('wpn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    w('wg', 'D', 'gnd', 'g', 'reference_terminal'),
    w('wcin', 'D', 'cin', 'g', 'reference_terminal'), // add: carry-in = 0
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
      edges.push(w(`wa${bit}`, `va${bit}`, 'terminal_positive', 'D', `a${bit}`))
      edges.push(w(`wan${bit}`, `va${bit}`, 'terminal_negative', 'g', 'reference_terminal'))
      edges.push(w(`wb${bit}`, `vb${bit}`, 'terminal_positive', 'D', `b${bit}`))
      edges.push(w(`wbn${bit}`, `vb${bit}`, 'terminal_negative', 'g', 'reference_terminal'))
    }
  }
  const r = simulateLogic(nodes, edges)
  const bit = (h: string) => (r.value('D', h) === true ? 1 : 0)
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

describe('10-digit BCD adder — full calculator-width decimal addition', () => {
  test.each([
    [5, 7],
    [999, 1], // carry ripples three digits
    [555, 555],
    [1234567890, 1111111111],
    [4242424242, 5757575757], // = 9 999 999 999, no carry
    [1234567890, 9876543210], // overflows to the 11th digit
    [9999999999, 1], // wraps to 0 with Cout
    [0, 0],
  ])('%d + %d', (a, b) => {
    const sum = a + b
    expect(add10(a, b)).toEqual({ result: sum % 10 ** 10, cout: sum >= 10 ** 10 ? 1 : 0 })
  })
})
