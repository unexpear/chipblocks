/**
 * Near-term iCE40 compile (fpga-compile.ts): a tiny combinational canvas against the vendored
 * iCE40 384 chipdb, plus one budget-truncated run. Report only — no .bin is written.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import type { CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { INVERTER_BLOCK } from '../src/renderer/builtin-blocks.ts'
import {
  chipdbTextOf,
  compileToIce40,
  FPGA_COMPILE_HONESTY,
  ICE40_ONE_TILE_POOL,
} from '../src/renderer/fpga-compile.ts'
import { decodeLc, expandTruth, parseLogicTileBits } from '../src/renderer/fpga-icebox-logic.ts'

const CHIPDB = readFileSync(
  new URL('../fixtures/icebox-ice40-384-chipdb.txt', import.meta.url),
  'utf8',
)

const gate = (id: string, y: number): CanvasNodeLike => ({
  id,
  position: { x: 0, y },
  data: { definition: 'block', block: INVERTER_BLOCK },
})

/** One NOT — a single LUT, no internal net, so the first cell of the one-tile pool can hold it. */
const oneNot = (): CanvasNodeLike[] => [gate('n1', 0)]

/** Two NOTs in series. Both outputs are cover roots, so the chain is two LUTs and an internal net. */
const notChain = (): { nodes: CanvasNodeLike[]; edges: CanvasEdgeLike[] } => ({
  nodes: [gate('n1', 0), gate('n2', 80)],
  edges: [
    {
      id: 'e',
      source: 'n1',
      sourceHandle: 'out',
      target: 'n2',
      targetHandle: 'in',
    },
  ],
})

describe('compileToIce40 — report only, against the iCE40 384 chipdb', () => {
  test('a tiny combinational NOT covers to one LUT and places on the one-tile pool', () => {
    const result = compileToIce40(oneNot(), [], CHIPDB, ICE40_ONE_TILE_POOL)
    expect(result.luts).toHaveLength(1)
    expect(result.luts[0]?.k).toBeLessThanOrEqual(4)
    expect(result.autoPlace.placed).toBe(true)
    expect(result.autoPlace.exhaustive).toBe(true)
    expect(result.autoPlace.result.routed).toBe(true)
    expect(result.autoPlace.result.unbound).toEqual([])
    expect(result.autoPlace.reason).toBeNull()
    const lut = result.luts[0]
    const cell = result.autoPlace.placement.get(lut?.id ?? '')
    expect(cell).toEqual({ x: 1, y: 1, cell: 0 })
    expect(
      decodeLc(parseLogicTileBits(CHIPDB), 0, 1, 1, result.autoPlace.result.bitstream.bits),
    ).toMatchObject({
      truth: expandTruth(lut?.config ?? []),
      dffEnable: false,
    })
    expect(result.honesty).toEqual([...FPGA_COMPILE_HONESTY])
  })

  test('a budget of zero is truncated and unbound, and still carries every honesty line', () => {
    const chain = notChain()
    const result = compileToIce40(chain.nodes, chain.edges, CHIPDB, ICE40_ONE_TILE_POOL, {
      maxCandidates: 0,
    })
    expect(result.luts.length).toBeGreaterThanOrEqual(2)
    expect(result.autoPlace.placed).toBe(false)
    expect(result.autoPlace.exhaustive).toBe(false)
    expect(result.autoPlace.reason).toMatch(/truncated/)
    expect(result.autoPlace.result.unbound.length).toBeGreaterThan(0)
    expect(result.autoPlace.result.unbound.some((line) => line.startsWith('cell:'))).toBe(true)
    for (const line of FPGA_COMPILE_HONESTY) expect(result.honesty).toContain(line)
    expect(result.honesty).toEqual([...FPGA_COMPILE_HONESTY])
  })

  test('chipdbTextOf keeps the icebox device file and refuses a file that is not one', () => {
    expect(chipdbTextOf([{ text: 'hello' }, { text: CHIPDB }])).toBe(CHIPDB)
    expect(chipdbTextOf([{ text: 'not a chipdb' }])).toBeNull()
  })
})
