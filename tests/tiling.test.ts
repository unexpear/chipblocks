/**
 * Scale-up tiling (auto-wirer overhaul, piece 2): tileRow stamps a cell N times and wires only the
 * repeating connections (the carry chain + the shared sub/V+/GND buses). Here we tile the single-digit
 * BCD ALU cell into a 3-digit adder and SOLVE it — proving the stamped row is a real working circuit, not
 * just a tidy picture: the carry ripples cell→cell exactly like the hand-built BCD_ALU_10.
 */

import { describe, expect, test } from 'vitest'
import type { CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { BCD_ALU_CELL } from '../src/renderer/builtin-blocks.ts'
import { simulateLogic } from '../src/renderer/logic-sim.ts'
import { tileRow } from '../src/renderer/tiling.ts'

const supply = (v: number) => ({
  nominal_voltage: { value: { kind: 'scalar', amount: v, unit: 'volt' } },
})
const digitBits = (n: number, d: number) => {
  const dig = Math.floor(n / 10 ** d) % 10
  return [0, 1, 2, 3].map((i) => ((dig >> i) & 1) === 1)
}
const w = (id: string, s: string, sh: string, t: string, th: string): CanvasEdgeLike => ({
  id,
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
})

function tiledAdd(a: number, b: number, digits: number): { result: number; cout: number } {
  const {
    nodes: cells,
    edges: tileEdges,
    idAt,
  } = tileRow({
    cell: BCD_ALU_CELL,
    count: digits,
    prefix: 'cell',
    x0: 0,
    y0: 0,
    pitch: 700,
    chain: [{ from: 'cout', to: 'cin' }],
    bus: ['sub', 'v_dd', 'gnd'],
  })
  const nodes: CanvasNodeLike[] = [
    ...cells,
    { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
    {
      id: 'vp',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(5) },
    },
  ]
  const edges: CanvasEdgeLike[] = [
    ...tileEdges,
    w('wvp', 'vp', 'terminal_positive', idAt(0), 'v_dd'),
    w('wvpn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    w('wgnd', idAt(0), 'gnd', 'g', 'reference_terminal'),
    w('wsub', idAt(0), 'sub', 'g', 'reference_terminal'), // SUB = 0 → add
    w('wcin', idAt(0), 'cin', 'g', 'reference_terminal'), // carry-in 0
  ]
  for (let d = 0; d < digits; d++) {
    const ab = digitBits(a, d)
    const bb = digitBits(b, d)
    for (let i = 0; i < 4; i++) {
      nodes.push({
        id: `va${d}_${i}`,
        position: { x: 0, y: 0 },
        data: { definition: 'power_source', parameters: supply(ab[i] ? 5 : 0) },
      })
      nodes.push({
        id: `vb${d}_${i}`,
        position: { x: 0, y: 0 },
        data: { definition: 'power_source', parameters: supply(bb[i] ? 5 : 0) },
      })
      edges.push(w(`wa${d}_${i}`, `va${d}_${i}`, 'terminal_positive', idAt(d), `a${i}`))
      edges.push(w(`wan${d}_${i}`, `va${d}_${i}`, 'terminal_negative', 'g', 'reference_terminal'))
      edges.push(w(`wb${d}_${i}`, `vb${d}_${i}`, 'terminal_positive', idAt(d), `b${i}`))
      edges.push(w(`wbn${d}_${i}`, `vb${d}_${i}`, 'terminal_negative', 'g', 'reference_terminal'))
    }
  }
  const r = simulateLogic(nodes, edges)
  let result = 0
  for (let d = 0; d < digits; d++) {
    const bit = (h: string) => (r.value(idAt(d), h) === true ? 1 : 0)
    result += (bit('s0') + 2 * bit('s1') + 4 * bit('s2') + 8 * bit('s3')) * 10 ** d
  }
  return { result, cout: r.value(idAt(digits - 1), 'cout') === true ? 1 : 0 }
}

describe('scale-up tiling — a row of ALU cells tiles into a working multi-digit adder', () => {
  test.each([
    [5, 7],
    [123, 456],
    [999, 1], // carry ripples through all three tiled cells
    [555, 555],
  ])('%d + %d', (a, b) => {
    const sum = a + b
    expect(tiledAdd(a, b, 3)).toEqual({ result: sum % 1000, cout: sum >= 1000 ? 1 : 0 })
  })
})
