/**
 * The 5×7 glyph ROM (the dot-matrix character generator): a 3-bit code in, the glyph's 35 pixels out,
 * built straight from the font table in real gates. Driving each code must light exactly that letter's
 * pixels — the pattern a DOT_MATRIX_5X7 then shows on its real LEDs.
 */

import { describe, expect, test } from 'vitest'
import type { CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { GLYPH_ROM_5X7 } from '../src/renderer/builtin-blocks.ts'
import { simulateLogic } from '../src/renderer/logic-sim.ts'

const supply = (v: number) => ({
  nominal_voltage: { value: { kind: 'scalar', amount: v, unit: 'volt' } },
})
const src = (id: string, v: number): CanvasNodeLike => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition: 'power_source', parameters: supply(v) },
})
const w = (id: string, s: string, sh: string, t: string, th: string): CanvasEdgeLike => ({
  id,
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
})

const grid = (code: number): string[] => {
  const nodes: CanvasNodeLike[] = [
    { id: 'rom', position: { x: 0, y: 0 }, data: { definition: 'block', block: GLYPH_ROM_5X7 } },
    src('vp', 5),
    { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
    src('c0', (code & 1) === 1 ? 5 : 0),
    src('c1', (code & 2) === 2 ? 5 : 0),
    src('c2', (code & 4) === 4 ? 5 : 0),
  ]
  const edges: CanvasEdgeLike[] = [
    w('ev', 'vp', 'terminal_positive', 'rom', 'v_dd'),
    w('evn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    w('eg', 'rom', 'gnd', 'g', 'reference_terminal'),
    ...[0, 1, 2].flatMap((i) => [
      w(`ec${i}`, `c${i}`, 'terminal_positive', 'rom', `code${i}`),
      w(`ecn${i}`, `c${i}`, 'terminal_negative', 'g', 'reference_terminal'),
    ]),
  ]
  const r = simulateLogic(nodes, edges)
  const out: string[] = []
  for (let row = 0; row < 7; row++) {
    let s = ''
    for (let col = 0; col < 5; col++) s += r.value('rom', `px_${row}_${col}`) === true ? '#' : '.'
    out.push(s)
  }
  return out
}

describe('glyph ROM — the dot-matrix character generator', () => {
  test("code 1 lights the 'H'", () => {
    expect(grid(1)).toEqual(['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'])
  })
  test("code 2 lights the 'E'", () => {
    expect(grid(2)).toEqual(['#####', '#....', '#....', '####.', '#....', '#....', '#####'])
  })
  test("code 4 lights the 'O'", () => {
    expect(grid(4)).toEqual(['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'])
  })
  test('code 0 is blank', () => {
    expect(grid(0)).toEqual(['.....', '.....', '.....', '.....', '.....', '.....', '.....'])
  })
})
