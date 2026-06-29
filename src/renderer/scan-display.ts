/**
 * Scanned multiplexed display — the co-simulation that turns the row scanner + the multiplexed LED matrix
 * into a whole picture. A real LED panel shows one row at a time, fast; your eye integrates the rows into
 * a steady image (persistence of vision). We simulate exactly that, both halves real:
 *
 *   - the row SCANNER is a real clocked digital circuit (compileLogic + stepLogic) — its counter advances
 *     and its decoder drives one row line HIGH per clock;
 *   - the MATRIX is real analog hardware (solveDCRobust over genuine LEDs + resistors), solved fresh for
 *     each scanned row with that row driven high and the lit columns pulled low.
 *
 * The scanner picks the row (read from its real outputs, not assumed); the matrix lights that row's
 * pixels; we accumulate every lit pixel across one full scan — the persistence-of-vision image. Nothing
 * is faked: the picture is exactly what the wired scanner + matrix would paint on the eye.
 */

import { solveDCRobust } from '../dc-robust.ts'
import {
  type BlockData,
  type CanvasEdgeLike,
  type CanvasNodeLike,
  flattenBlocks,
} from './blocks.ts'
import { canvasToWorld } from './canvas-to-world.ts'
import { compileLogic, stepLogic } from './logic-sim.ts'

/** 0.1 mA — at/above this an LED is conducting (glowing), matching health.ts's LIT_FLOOR_AMPS. */
const LIT = 1e-4
const supply = (v: number) => ({
  nominal_voltage: { value: { kind: 'scalar', amount: v, unit: 'volt' } },
  internal_resistance: { value: { kind: 'scalar', amount: 0, unit: 'ohm' } },
})

/** Solve the analog matrix with ONE row driven high and the given columns pulled low; return the
 *  indices of the columns whose pixel actually lights in that row. */
function solveMatrixRow(
  matrix: BlockData,
  activeRow: number,
  rowPattern: readonly boolean[],
  cols: number,
): number[] {
  const nodes: CanvasNodeLike[] = [
    { id: 'd', position: { x: 0, y: 0 }, data: { definition: 'block', block: matrix } },
    { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
    {
      id: 'vp',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(5) },
    },
  ]
  const edges: CanvasEdgeLike[] = [
    {
      id: 'e_rp',
      source: 'vp',
      sourceHandle: 'terminal_positive',
      target: 'd',
      targetHandle: `row_${activeRow}`,
    },
    {
      id: 'e_rn',
      source: 'vp',
      sourceHandle: 'terminal_negative',
      target: 'g',
      targetHandle: 'reference_terminal',
    },
  ]
  for (let c = 0; c < cols; c++)
    if (rowPattern[c])
      edges.push({
        id: `e_col_${c}`,
        source: 'd',
        sourceHandle: `col_${c}`,
        target: 'g',
        targetHandle: 'reference_terminal',
      })
  const flat = flattenBlocks(nodes, edges)
  const world = canvasToWorld(
    flat.nodes.map((n) => ({
      id: n.id,
      definition: n.data.definition,
      parameters: n.data.parameters,
    })),
    flat.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
    })),
  )
  const sol = solveDCRobust(world)
  const lit: number[] = []
  for (let c = 0; c < cols; c++) {
    const led = flat.nodes.find(
      (n) => n.data.definition === 'led' && n.id.endsWith(`led_${activeRow}_${c}`),
    )
    if (led && Math.abs(sol.branches.get(led.id) ?? 0) > LIT) lit.push(c)
  }
  return lit
}

/**
 * Run one full scan of `image` (rows × cols of on/off pixels) through the real scanner + matrix and return
 * the persistence-of-vision image: pov[r][c] is lit iff the scanner reaching row r drove the matrix to
 * light pixel (r,c). A faithful display reproduces `image` exactly.
 */
export function scanMatrixImage(
  scanner: BlockData,
  matrix: BlockData,
  image: readonly (readonly boolean[])[],
): boolean[][] {
  const rows = image.length
  const cols = image[0]?.length ?? 0
  const w = (id: string, s: string, sh: string, t: string, th: string): CanvasEdgeLike => ({
    id,
    source: s,
    sourceHandle: sh,
    target: t,
    targetHandle: th,
  })
  const sNodes: CanvasNodeLike[] = [
    { id: 'scan', position: { x: 0, y: 0 }, data: { definition: 'block', block: scanner } },
    {
      id: 'vp',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(5) },
    },
    {
      id: 'clk',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(0) },
    },
    {
      id: 'clr',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(0) },
    },
    { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
  ]
  const sEdges: CanvasEdgeLike[] = [
    w('e_clk', 'clk', 'terminal_positive', 'scan', 'clk'),
    w('e_clkn', 'clk', 'terminal_negative', 'g', 'reference_terminal'),
    w('e_clr', 'clr', 'terminal_positive', 'scan', 'clr'),
    w('e_clrn', 'clr', 'terminal_negative', 'g', 'reference_terminal'),
    w('e_vp', 'vp', 'terminal_positive', 'scan', 'v_dd'),
    w('e_vpn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    w('e_g', 'scan', 'gnd', 'g', 'reference_terminal'),
  ]
  const compiled = compileLogic(sNodes, sEdges)
  const state = new Map<string, boolean>()
  const step = (clk: boolean, clr: boolean) =>
    stepLogic(
      compiled,
      new Map<string, boolean>([
        ['clk', clk],
        ['clr', clr],
      ]),
      state,
    )
  const activeRow = (res: ReturnType<typeof stepLogic>): number => {
    for (let i = 0; i < rows; i++) if (res.value('scan', `row_${i}`) === true) return i
    return -1
  }
  // Synchronous clear → start at row 0.
  step(false, true)
  let sres = step(true, true)
  const pov: boolean[][] = image.map((row) => row.map(() => false))
  for (let s = 0; s < rows; s++) {
    const r = activeRow(sres)
    const povRow = pov[r]
    if (r >= 0 && r < rows && povRow)
      for (const c of solveMatrixRow(matrix, r, image[r] ?? [], cols)) povRow[c] = true
    step(false, false)
    sres = step(true, false) // rising edge → next row
  }
  return pov
}

/**
 * Like scanMatrixImage, but the picture comes from a real FRAME BUFFER (flip-flop memory) instead of a
 * bitmap — real all the way down. The scanner + frame buffer are wired into one clocked digital circuit
 * (the scanner's one-hot row select addresses the frame buffer); each step the frame buffer reads the
 * addressed row's column bits out of its flip-flops, and the matrix lights those columns. Accumulating
 * over a scan gives the persistence-of-vision image — read out of real hardware, not handed in as data.
 */
export function scanMatrixFromBuffer(
  scanner: BlockData,
  frameBuffer: BlockData,
  matrix: BlockData,
  rows: number,
  cols: number,
): boolean[][] {
  const w = (id: string, s: string, sh: string, t: string, th: string): CanvasEdgeLike => ({
    id,
    source: s,
    sourceHandle: sh,
    target: t,
    targetHandle: th,
  })
  const nodes: CanvasNodeLike[] = [
    { id: 'scan', position: { x: 0, y: 0 }, data: { definition: 'block', block: scanner } },
    { id: 'fb', position: { x: 0, y: 0 }, data: { definition: 'block', block: frameBuffer } },
    {
      id: 'vp',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(5) },
    },
    {
      id: 'clk',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(0) },
    },
    {
      id: 'clr',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(0) },
    },
    { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
  ]
  const edges: CanvasEdgeLike[] = [
    w('e_clk', 'clk', 'terminal_positive', 'scan', 'clk'),
    w('e_clkf', 'clk', 'terminal_positive', 'fb', 'clk'),
    w('e_clkn', 'clk', 'terminal_negative', 'g', 'reference_terminal'),
    w('e_clr', 'clr', 'terminal_positive', 'scan', 'clr'),
    w('e_clrn', 'clr', 'terminal_negative', 'g', 'reference_terminal'),
    w('e_vp', 'vp', 'terminal_positive', 'scan', 'v_dd'),
    w('e_vpf', 'vp', 'terminal_positive', 'fb', 'v_dd'),
    w('e_vpn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    w('e_gs', 'scan', 'gnd', 'g', 'reference_terminal'),
    w('e_gf', 'fb', 'gnd', 'g', 'reference_terminal'),
    // the scanner's one-hot row select IS the frame buffer's read address
    ...Array.from({ length: rows }, (_, r) =>
      w(`e_addr${r}`, 'scan', `row_${r}`, 'fb', `addr_${r}`),
    ),
  ]
  const compiled = compileLogic(nodes, edges)
  const state = new Map<string, boolean>()
  const step = (clk: boolean, clr: boolean) =>
    stepLogic(
      compiled,
      new Map<string, boolean>([
        ['clk', clk],
        ['clr', clr],
      ]),
      state,
    )
  const activeRow = (res: ReturnType<typeof stepLogic>): number => {
    for (let i = 0; i < rows; i++) if (res.value('scan', `row_${i}`) === true) return i
    return -1
  }
  const readCols = (res: ReturnType<typeof stepLogic>): boolean[] =>
    Array.from({ length: cols }, (_, c) => res.value('fb', `col_${c}`) === true)
  step(false, true)
  let sres = step(true, true)
  const pov: boolean[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => false),
  )
  for (let s = 0; s < rows; s++) {
    const r = activeRow(sres)
    const rowPat = readCols(sres) // the frame buffer's stored bits for the addressed row
    const povRow = pov[r]
    if (r >= 0 && r < rows && povRow)
      for (const c of solveMatrixRow(matrix, r, rowPat, cols)) povRow[c] = true
    step(false, false)
    sres = step(true, false)
  }
  return pov
}
