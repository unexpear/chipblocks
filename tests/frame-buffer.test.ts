/**
 * The FRAME BUFFER is REAL memory — one register (real D flip-flops) per row holding that row's pixels.
 * A clock latches the whole picture into the flip-flops; the scanner's one-hot ROW ADDRESS then reads the
 * addressed row's bits back out on the column lines through a one-hot read mux. So the picture lives in
 * real hardware and the scanner reads it out row by row — verified through the fast logic engine.
 */

import { describe, expect, test } from 'vitest'
import type { CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { buildFrameBuffer } from '../src/renderer/builtin-blocks.ts'
import { compileLogic, stepLogic } from '../src/renderer/logic-sim.ts'

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

const IMG = [
  [true, false, true, false],
  [false, true, true, false],
  [true, true, false, true],
  [false, false, true, true],
]

function harness(image: boolean[][]) {
  const rows = image.length
  const cols = image[0]?.length ?? 0
  const fb = buildFrameBuffer(image)
  const nodes: CanvasNodeLike[] = [
    { id: 'fb', position: { x: 0, y: 0 }, data: { definition: 'block', block: fb } },
    src('vp', 5),
    src('clk', 0),
    { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
    ...Array.from({ length: rows }, (_, r) => src(`asrc_${r}`, 0)),
  ]
  const edges: CanvasEdgeLike[] = [
    w('e_clk', 'clk', 'terminal_positive', 'fb', 'clk'),
    w('e_clkn', 'clk', 'terminal_negative', 'g', 'reference_terminal'),
    w('e_vp', 'vp', 'terminal_positive', 'fb', 'v_dd'),
    w('e_vpn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    w('e_g', 'fb', 'gnd', 'g', 'reference_terminal'),
    ...Array.from({ length: rows }, (_, r) => [
      w(`e_a${r}`, `asrc_${r}`, 'terminal_positive', 'fb', `addr_${r}`),
      w(`e_an${r}`, `asrc_${r}`, 'terminal_negative', 'g', 'reference_terminal'),
    ]).flat(),
  ]
  const compiled = compileLogic(nodes, edges)
  const state = new Map<string, boolean>()
  const step = (clk: boolean, activeRow: number) => {
    const ov = new Map<string, boolean>([['clk', clk]])
    for (let r = 0; r < rows; r++) ov.set(`asrc_${r}`, r === activeRow)
    return stepLogic(compiled, ov, state)
  }
  const readCols = (res: ReturnType<typeof stepLogic>) =>
    Array.from({ length: cols }, (_, c) => res.value('fb', `col_${c}`) === true)
  return { rows, step, readCols }
}

describe('frame buffer — real flip-flop memory holding the picture, read out by one-hot row address', () => {
  test('clock loads the picture; addressing each row reads that row of the image back on the columns', () => {
    const { rows, step, readCols } = harness(IMG)
    for (let r = 0; r < rows; r++) {
      step(false, r)
      expect(readCols(step(true, r))).toEqual(IMG[r]) // col bits == the stored row
    }
  })

  test('it is real STORAGE — after one load the registers hold the picture without re-clocking', () => {
    const { rows, step, readCols } = harness(IMG)
    step(false, 0)
    step(true, 0) // one clock latches the whole picture into the flip-flops
    for (let r = 0; r < rows; r++) {
      // clock stays LOW now — only the read address changes; the held flip-flops still serve every row
      expect(readCols(step(false, r))).toEqual(IMG[r])
    }
  })
})
