/**
 * FPGA fabric — Stage 2, increment 4: the bitstream assembler (fpga-icebox-bitstream.ts).
 * Proves a real placed + routed design becomes ONE combined CRAM bitstream — logic-cell bits ⊕ routing bits —
 * at genuine iCE40 coordinates, with conflict detection. The demonstration is COHERENT, not two unrelated bit
 * lists: the routing slice's source net 2246 is `lutff_2/out` at tile (3,1), so cell 2 of tile (3,1) is the
 * driver of the routed net. Placing a LUT there and routing its output is a single real mini-design, and one
 * tile (3,1) ends up carrying BOTH its logic config and a routing pip.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { type IceboxPip, parseIceboxChipdb } from '../src/renderer/fpga-icebox.ts'
import {
  assembleBitstream,
  bitstreamByTile,
  type PlacedCell,
} from '../src/renderer/fpga-icebox-bitstream.ts'
import {
  decodeLc,
  expandTruth,
  type LcConfig,
  parseLogicTileBits,
} from '../src/renderer/fpga-icebox-logic.ts'
import { rrgFromIcebox } from '../src/renderer/fpga-icebox-rrg.ts'
import { routeDesign } from '../src/renderer/fpga-router.ts'

const SLICE = parseIceboxChipdb(
  readFileSync(
    new URL('../fixtures/icebox-ice40-384-routing-slice.chipdb', import.meta.url),
    'utf8',
  ),
)
const LAYOUT = parseLogicTileBits(
  readFileSync(
    new URL('../fixtures/icebox-ice40-384-logic-tile-bits.chipdb', import.meta.url),
    'utf8',
  ),
)
const AND2 = expandTruth([false, false, false, true]) // out = in0 & in1, a real KLut.config
const combinational = (truth: boolean[]): LcConfig => ({
  truth,
  carryEnable: false,
  dffEnable: false,
  setNoReset: false,
  asyncSetReset: false,
})

/** Route net 2246 → 122 on the real slice (increment 2) and return the ON pips behind it. */
function routeTheSlice(): { routingPips: IceboxPip[] } {
  const { rrg, pipToIcebox } = rrgFromIcebox(SLICE)
  const result = routeDesign(rrg, [{ id: 'n', source: 'w2246', sinks: ['w122'] }])
  expect(result.routed).toBe(true)
  const routingPips = [...result.onPips].map((id) => {
    const pip = pipToIcebox.get(id)
    if (pip === undefined) throw new Error(`no icebox pip for ${id}`)
    return pip
  })
  return { routingPips }
}

describe('assembleBitstream — a real placed + routed mini-design becomes one combined bitstream', () => {
  const { routingPips } = routeTheSlice()
  // cell 2 of tile (3,1) IS the driver of net 2246 (lutff_2/out); compute AND2 there and route its output.
  const cell: PlacedCell = { x: 3, y: 1, cell: 2, config: combinational(AND2) }
  const bitstream = assembleBitstream(LAYOUT, { cells: [cell], routingPips })

  test('the design is self-consistent (no conflicting bits) and carries both routing and logic bits', () => {
    expect(bitstream.conflicts).toEqual([])
    // the two real routing pips' CRAM bits (2246→76 at (3,1) B4[47]; 76→122 at (1,1) B0[2]) are present:
    expect(bitstream.bits).toContainEqual({ x: 3, y: 1, row: 4, col: 47, value: 1 })
    expect(bitstream.bits).toContainEqual({ x: 1, y: 1, row: 0, col: 2, value: 1 })
    // cell 2's LUT bits live on rows 4/5 of tile (3,1) — a logic bit is present there too:
    expect(bitstream.bits.some((b) => b.x === 3 && b.y === 1 && (b.row === 4 || b.row === 5))).toBe(
      true,
    )
    expect(bitstream.setBits).toBeGreaterThan(0)
  })

  test('the logic survives assembly: decoding tile (3,1) cell 2 out of the combined bits recovers AND2', () => {
    const recovered = decodeLc(LAYOUT, 2, 3, 1, bitstream.bits)
    expect(recovered).toEqual(combinational(AND2)) // the routing pip at B4[47] did not disturb the cell config
  })

  test('the per-tile image shows tile (3,1) carrying BOTH its logic and a routing pip', () => {
    const byTile = bitstreamByTile(bitstream.bits)
    const tile31 = byTile.get('3_1') ?? []
    expect(tile31.some((b) => b.col === 47)).toBe(true) // the 2246→76 routing pip bit
    expect(tile31.some((b) => b.col >= 36 && b.col <= 45)).toBe(true) // a cell-2 logic bit (cols 36..45)
    expect(byTile.get('1_1')?.some((b) => b.row === 0 && b.col === 2)).toBe(true) // the 76→122 pip on tile (1,1)
  })
})

describe('assembleBitstream — conflict detection across sources', () => {
  test('two cells on the SAME tile/cell with different functions are reported as a conflict, not silently merged', () => {
    const a: PlacedCell = { x: 3, y: 1, cell: 2, config: combinational(AND2) }
    const b: PlacedCell = {
      x: 3,
      y: 1,
      cell: 2,
      config: combinational(expandTruth([false, true, true, false])),
    } // XOR2
    const bitstream = assembleBitstream(LAYOUT, { cells: [a, b] })
    expect(bitstream.conflicts.length).toBeGreaterThan(0) // AND2 and XOR2 disagree on some LUT bit at cell 2
  })

  test('cell-vs-routing: a routing pip that drives a logic-cell bit to the opposite value is reported', () => {
    // cell 0 on tile (5,5) with truth[0]=true sets LUT bit 0 = 1 at B0[40] (LC-bit 4, row 0 col 40).
    const onehot0 = Array.from({ length: 16 }, (_, i) => i === 0)
    // a routing pip at the SAME tile whose CRAM condition drives B0[40] to 0 — it collides with the cell's 1.
    const clash: IceboxPip = {
      x: 5,
      y: 5,
      src: 0,
      dst: 1,
      kind: 'buffer',
      condition: [{ bit: { row: 0, col: 40 }, value: 0 }],
    }
    const bitstream = assembleBitstream(LAYOUT, {
      cells: [{ x: 5, y: 5, cell: 0, config: combinational(onehot0) }],
      routingPips: [clash],
    })
    // reported with the exact cross-source key, not silently letting the routing pip clobber the LUT config
    expect(bitstream.conflicts).toContain('5_5_B0[40]')
  })

  test('routing-vs-routing: two mux source-options needing one bit both ways carry their conflict through', () => {
    // the fragment's real .routing mux (net 143 ← 97/127/80) shares bits B0[11]/B0[12]; selecting 97 (B0[12]=1)
    // AND 127 (B0[12]=0) demands B0[12] be both — an illegal routing cramBitsForRoute flags, which the
    // assembler must surface, not swallow.
    const fragment = parseIceboxChipdb(
      readFileSync(
        new URL('../fixtures/icebox-ice40-384-fragment.chipdb', import.meta.url),
        'utf8',
      ),
    )
    const both = fragment.pips.filter((p) => p.dst === 143 && (p.src === 97 || p.src === 127))
    expect(both).toHaveLength(2)
    const bitstream = assembleBitstream(LAYOUT, { routingPips: both })
    expect(bitstream.conflicts).toContain('0_1_B0[12]')
  })

  test('a logic-only or routing-only design assembles cleanly (each source is optional)', () => {
    const logicOnly = assembleBitstream(LAYOUT, {
      cells: [{ x: 0, y: 0, cell: 0, config: combinational(AND2) }],
    })
    expect(logicOnly.conflicts).toEqual([])
    expect(logicOnly.bits.length).toBe(20) // one cell = 20 LC bits
    const routingOnly = assembleBitstream(LAYOUT, { routingPips: routeTheSlice().routingPips })
    expect(routingOnly.conflicts).toEqual([])
    expect(routingOnly.setBits).toBe(2) // the two routing pips each program one bit
  })
})
