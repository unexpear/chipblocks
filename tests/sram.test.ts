/**
 * SRAM — the static memory bit (6T cell) and a 4-bit word of them, built from REAL transistors (two
 * cross-coupled CMOS inverters + two NMOS access transistors per bit). Raising the WORD LINE and
 * forcing the BIT LINES must WRITE the cell: the complementary nodes Q / Q̄ latch to the driven value,
 * the cross-coupled inverters regenerating it to the full rails. These solve the actual silicon
 * (24 MOSFETs for the word), so they pin down that the cell is a genuine, writable storage element.
 */

import { describe, expect, test } from 'vitest'
import { solveDCRobust } from '../src/dc-robust.ts'
import { type CanvasEdgeLike, type CanvasNodeLike, flattenBlocks } from '../src/renderer/blocks.ts'
import { SRAM_CELL_BLOCK, SRAM_WORD_4BIT } from '../src/renderer/builtin-blocks.ts'
import { canvasToWorld } from '../src/renderer/canvas-to-world.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const supply = (volts: number) => ({
  nominal_voltage: scalar(volts, 'volt'),
  internal_resistance: scalar(0, 'ohm'),
})

function solve(nodes: CanvasNodeLike[], edges: CanvasEdgeLike[]) {
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
  const solution = solveDCRobust(world)
  const voltAt = (instId: string, terminal: string) => {
    const net = world.instances.get(instId)?.connects?.find((c) => c.terminal === terminal)?.net
    return net === undefined ? Number.NaN : (solution.nodes.get(net) ?? Number.NaN)
  }
  return { solution, voltAt }
}

/** Power + ground a target block's V+/GND, hold its word line HIGH, and drive a bit line: a source for
 *  HIGH, a tie to ground for LOW. Mutates the node/edge lists. */
function powerAndWl(
  nodes: CanvasNodeLike[],
  edges: CanvasEdgeLike[],
  target: string,
  vddPort = 'v_dd',
  gndPort = 'gnd',
  wlPort = 'wl',
) {
  nodes.push(
    { id: 'gnd', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
    {
      id: 'vdd',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(5) },
    },
    {
      id: 'wl',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(5) },
    },
  )
  edges.push(
    {
      id: 'vdd_p',
      source: 'vdd',
      sourceHandle: 'terminal_positive',
      target,
      targetHandle: vddPort,
    },
    {
      id: 'vdd_n',
      source: 'vdd',
      sourceHandle: 'terminal_negative',
      target: 'gnd',
      targetHandle: 'reference_terminal',
    },
    {
      id: 'blk_gnd',
      source: target,
      sourceHandle: gndPort,
      target: 'gnd',
      targetHandle: 'reference_terminal',
    },
    { id: 'wl_p', source: 'wl', sourceHandle: 'terminal_positive', target, targetHandle: wlPort },
    {
      id: 'wl_n',
      source: 'wl',
      sourceHandle: 'terminal_negative',
      target: 'gnd',
      targetHandle: 'reference_terminal',
    },
  )
}

function driveLine(
  nodes: CanvasNodeLike[],
  edges: CanvasEdgeLike[],
  target: string,
  port: string,
  high: boolean,
  tag: string,
) {
  if (high) {
    nodes.push({
      id: tag,
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(5) },
    })
    edges.push(
      {
        id: `${tag}_p`,
        source: tag,
        sourceHandle: 'terminal_positive',
        target,
        targetHandle: port,
      },
      {
        id: `${tag}_n`,
        source: tag,
        sourceHandle: 'terminal_negative',
        target: 'gnd',
        targetHandle: 'reference_terminal',
      },
    )
  } else {
    edges.push({
      id: `${tag}_lo`,
      source: target,
      sourceHandle: port,
      target: 'gnd',
      targetHandle: 'reference_terminal',
    })
  }
}

/** Write one bit into a single cell (BL = bit, BL̄ = its complement) and read back Q and Q̄. */
function writeCell(bit: boolean): { q: number; qbar: number } {
  const nodes: CanvasNodeLike[] = [
    { id: 'cell', position: { x: 0, y: 0 }, data: { definition: 'block', block: SRAM_CELL_BLOCK } },
  ]
  const edges: CanvasEdgeLike[] = []
  powerAndWl(nodes, edges, 'cell')
  driveLine(nodes, edges, 'cell', 'bl', bit, 'bl')
  driveLine(nodes, edges, 'cell', 'blb', !bit, 'blb')
  const { voltAt } = solve(nodes, edges)
  return { q: voltAt('cell.a1', 'source'), qbar: voltAt('cell.a2', 'source') }
}

describe('SRAM 6T cell — a written bit latches onto Q / Q̄', () => {
  test('write 1 (BL high, BL̄ low) → Q high, Q̄ low', () => {
    const { q, qbar } = writeCell(true)
    expect(q).toBeGreaterThan(3)
    expect(qbar).toBeLessThan(1)
  })
  test('write 0 (BL low, BL̄ high) → Q low, Q̄ high', () => {
    const { q, qbar } = writeCell(false)
    expect(q).toBeLessThan(1)
    expect(qbar).toBeGreaterThan(3)
  })
})

describe('SRAM 4-bit word — four cells on one word line store a nibble', () => {
  test('writes 1010 (bit3..bit0) and every cell latches its own bit', () => {
    const bits = [false, true, false, true] // bit0=0, bit1=1, bit2=0, bit3=1
    const nodes: CanvasNodeLike[] = [
      {
        id: 'word',
        position: { x: 0, y: 0 },
        data: { definition: 'block', block: SRAM_WORD_4BIT },
      },
    ]
    const edges: CanvasEdgeLike[] = []
    powerAndWl(nodes, edges, 'word')
    bits.forEach((b, i) => {
      driveLine(nodes, edges, 'word', `bl${i}`, b, `bl${i}`)
      driveLine(nodes, edges, 'word', `blb${i}`, !b, `blb${i}`)
    })
    const { voltAt } = solve(nodes, edges)
    const q = bits.map((_, i) => voltAt(`word.bit${i}.a1`, 'source'))
    expect(q[0]).toBeLessThan(1)
    expect(q[1]).toBeGreaterThan(3)
    expect(q[2]).toBeLessThan(1)
    expect(q[3]).toBeGreaterThan(3)
  })
})
