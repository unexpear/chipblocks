/**
 * The binary→BCD (decimal) converter — the display tool the 8-bit CPU demo needed (the app only had a 4-bit
 * hex decoder). It is a REAL gate circuit synthesized from a double-dabble Verilog description, proven here by
 * truth table against plain decimal arithmetic for every one of the 256 byte values.
 */

import { expect, test } from 'vitest'
import { bin2bcdVerilog } from '../src/renderer/bin2bcd.ts'
import type { BlockData } from '../src/renderer/blocks.ts'
import { characterizeBlock } from '../src/renderer/logic-sim.ts'
import { importVerilog } from '../src/renderer/verilog-import.ts'

test('binary→BCD converts every byte 0..255 to the correct decimal digits', () => {
  const { block, warnings } = importVerilog(bin2bcdVerilog())
  expect(warnings, `warnings: ${warnings.join(' | ')}`).toEqual([])
  const tt = characterizeBlock(block as BlockData)
  expect(tt, 'should characterize as combinational').not.toBeNull()
  if (tt === null) return
  const inIdx = Array.from({ length: 8 }, (_, i) => tt.inputs.indexOf(`b[${i}]`))
  const digitIdx = (name: string) =>
    Array.from({ length: 4 }, (_, i) => tt.outputs.indexOf(`${name}[${i}]`))
  const oIdx = digitIdx('ones')
  const tIdx = digitIdx('tens')
  const hIdx = digitIdx('hundreds')
  const read = (bits: boolean[], idx: number[]) =>
    idx.reduce((s, ix, i) => s + (bits[ix] ? 1 << i : 0), 0)
  expect(tt.rows.length).toBe(256)
  for (const row of tt.rows) {
    const b = read(row.in, inIdx)
    expect(read(row.out, oIdx), `b=${b} ones`).toBe(b % 10)
    expect(read(row.out, tIdx), `b=${b} tens`).toBe(Math.floor(b / 10) % 10)
    expect(read(row.out, hIdx), `b=${b} hundreds`).toBe(Math.floor(b / 100))
  }
})
