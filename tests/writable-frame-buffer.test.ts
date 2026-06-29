/**
 * The WRITABLE frame buffer is a real RAM: one load-only register per row (a counter with its count
 * disabled). A write port (one-hot write address + a column-data bus + write-enable) latches the
 * addressed row's register on the clock and every other row holds; the one-hot read address reads any
 * row back out. So a picture can be PAINTED into real flip-flop memory at runtime and read back — and
 * overwriting it with a different picture really changes the stored bits.
 */

import { describe, expect, test } from 'vitest'
import type { CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { buildWritableFrameBuffer } from '../src/renderer/builtin-blocks.ts'
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

const ROWS = 4
const COLS = 4
const IMG_A = [
  [true, false, true, false],
  [false, true, true, false],
  [true, true, false, true],
  [false, false, true, true],
]
const IMG_B = [
  [true, true, true, true],
  [false, false, false, false],
  [true, false, false, true],
  [false, true, true, false],
]

function harness() {
  const fb = buildWritableFrameBuffer(ROWS, COLS)
  const nodes: CanvasNodeLike[] = [
    { id: 'fb', position: { x: 0, y: 0 }, data: { definition: 'block', block: fb } },
    src('vp', 5),
    src('clk', 0),
    src('we', 0),
    { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
    ...Array.from({ length: ROWS }, (_, r) => src(`wa_${r}`, 0)),
    ...Array.from({ length: ROWS }, (_, r) => src(`ra_${r}`, 0)),
    ...Array.from({ length: COLS }, (_, c) => src(`wd_${c}`, 0)),
  ]
  const edges: CanvasEdgeLike[] = [
    w('e_clk', 'clk', 'terminal_positive', 'fb', 'clk'),
    w('e_clkn', 'clk', 'terminal_negative', 'g', 'reference_terminal'),
    w('e_vp', 'vp', 'terminal_positive', 'fb', 'v_dd'),
    w('e_vpn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    w('e_g', 'fb', 'gnd', 'g', 'reference_terminal'),
    w('e_we', 'we', 'terminal_positive', 'fb', 'we'),
    w('e_wen', 'we', 'terminal_negative', 'g', 'reference_terminal'),
    ...Array.from({ length: ROWS }, (_, r) => [
      w(`e_wa${r}`, `wa_${r}`, 'terminal_positive', 'fb', `wr_addr_${r}`),
      w(`e_wan${r}`, `wa_${r}`, 'terminal_negative', 'g', 'reference_terminal'),
      w(`e_ra${r}`, `ra_${r}`, 'terminal_positive', 'fb', `rd_addr_${r}`),
      w(`e_ran${r}`, `ra_${r}`, 'terminal_negative', 'g', 'reference_terminal'),
    ]).flat(),
    ...Array.from({ length: COLS }, (_, c) => [
      w(`e_wd${c}`, `wd_${c}`, 'terminal_positive', 'fb', `wr_data_${c}`),
      w(`e_wdn${c}`, `wd_${c}`, 'terminal_negative', 'g', 'reference_terminal'),
    ]).flat(),
  ]
  const compiled = compileLogic(nodes, edges)
  const state = new Map<string, boolean>()
  const ov = (clk: boolean, we: boolean, wa: number, wd: boolean[], ra: number) => {
    const m = new Map<string, boolean>([
      ['clk', clk],
      ['we', we],
    ])
    for (let r = 0; r < ROWS; r++) m.set(`wa_${r}`, r === wa)
    for (let r = 0; r < ROWS; r++) m.set(`ra_${r}`, r === ra)
    for (let c = 0; c < COLS; c++) m.set(`wd_${c}`, wd[c] === true)
    return m
  }
  const step = (clk: boolean, we: boolean, wa: number, wd: boolean[], ra: number) =>
    stepLogic(compiled, ov(clk, we, wa, wd, ra), state)
  const writeImage = (image: boolean[][]) => {
    for (let r = 0; r < ROWS; r++) {
      step(false, true, r, image[r] ?? [], -1)
      step(true, true, r, image[r] ?? [], -1) // rising edge → latch row r
    }
  }
  const readImage = (): boolean[][] =>
    Array.from({ length: ROWS }, (_, r) => {
      const res = step(false, false, -1, [], r) // WE low: pure read of row r
      return Array.from({ length: COLS }, (_, c) => res.value('fb', `col_${c}`) === true)
    })
  return { writeImage, readImage }
}

describe('writable frame buffer — real RAM: paint a picture into flip-flop memory, read it back, overwrite it', () => {
  test('writing each row then addressing it reads that row back', () => {
    const { writeImage, readImage } = harness()
    writeImage(IMG_A)
    expect(readImage()).toEqual(IMG_A)
  })

  test('overwriting with a different picture really changes the stored bits (runtime writability)', () => {
    const { writeImage, readImage } = harness()
    writeImage(IMG_A)
    expect(readImage()).toEqual(IMG_A)
    writeImage(IMG_B)
    expect(readImage()).toEqual(IMG_B)
  })
})
