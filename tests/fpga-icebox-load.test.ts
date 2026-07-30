/**
 * FPGA fabric — Stage 3a: the load-your-own-bitstream front door (fpga-icebox-load.ts).
 *
 * Proves the "never confused" guarantee: a real 384 bitstream loads into a simulatable netlist that runs on our
 * engine, while a recognised-but-unavailable device, a foreign/not-a-bitstream file, and a corrupt file each fail
 * loudly and honestly (a plain reason, or a crcOk=false flag) rather than being silently mis-parsed.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { parseIceboxChipdb } from '../src/renderer/fpga-icebox.ts'
import { type Ice40ChipDb, loadIce40Bitstream } from '../src/renderer/fpga-icebox-load.ts'
import { parseLogicTileBits } from '../src/renderer/fpga-icebox-logic.ts'
import { simulateCombinational } from '../src/renderer/fpga-icebox-run.ts'

const ICE40_384: Ice40ChipDb = {
  device: parseIceboxChipdb(
    readFileSync(new URL('../fixtures/icebox-ice40-384-chipdb.txt', import.meta.url), 'utf8'),
  ),
  layout: parseLogicTileBits(
    readFileSync(
      new URL('../fixtures/icebox-ice40-384-logic-tile-bits.chipdb', import.meta.url),
      'utf8',
    ),
  ),
}
// what the app "has loaded" — only the 384 chip database, to exercise the unavailable-device path too
const CHIPDBS: Record<string, Ice40ChipDb> = { '384': ICE40_384 }

const read = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)))

describe('loadIce40Bitstream — load a real bitstream into our simulator', () => {
  test('loads a real 384 .bin and returns a netlist our engine simulates (B = A = i0 & i1)', () => {
    const result = loadIce40Bitstream(read('icebox-ice40-384-routed.bin'), CHIPDBS)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect([result.family, result.device, result.crcOk]).toEqual(['ice40', '384', true])

    const a = result.netlist.cells.find((c) => c.ref.cell === 0)
    const primNets = (a?.inputs ?? [])
      .filter((i) => i.kind === 'primary')
      .map((i) => (i as { net: number }).net)
    expect(primNets).toHaveLength(2)
    for (const i0 of [false, true])
      for (const i1 of [false, true]) {
        const sim = simulateCombinational(
          result.netlist,
          new Map([
            [primNets[0] as number, i0],
            [primNets[1] as number, i1],
          ]),
        )
        expect(sim.outputs.get('1_1_5')).toBe(i0 && i1)
      }
  })
})

describe('loadIce40Bitstream — refuses honestly, never mis-parses', () => {
  test('recognises a 5k bitstream but refuses when its chip database is not loaded', () => {
    const result = loadIce40Bitstream(read('icebox-ice40-5k-oddbanks.bin'), CHIPDBS)
    expect(result.ok).toBe(false)
    if (result.ok)
      throw new Error('a 5k bitstream should be refused when only the 384 chipdb is loaded')
    expect(result.reason).toMatch(/5k/)
    expect(result.reason).toMatch(/no chip database/i)
  })

  test('rejects a non-iCE40 / foreign / not-a-bitstream file (no preamble)', () => {
    // bytes that never form the 0x7EAA997E preamble — stands in for a Xilinx .bit, an encrypted blob, or junk
    const foreign = Uint8Array.from(Array.from({ length: 64 }, (_, i) => (i * 7 + 1) & 0x7d))
    const result = loadIce40Bitstream(foreign, CHIPDBS)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('a non-iCE40 file should be rejected')
    expect(result.reason).toMatch(/Not a readable iCE40 bitstream/)
  })

  test('a corrupt-but-parseable file surfaces crcOk=false (or an honest error) — no silent garbage', () => {
    const corrupt = Uint8Array.from(read('icebox-ice40-384-routed.bin'))
    corrupt[100] = (corrupt[100] as number) ^ 0xff // flip a byte in the CRAM data region
    const result = loadIce40Bitstream(corrupt, CHIPDBS)
    if (result.ok)
      expect(result.crcOk).toBe(false) // parsed structurally, but the CRC flags the corruption
    else expect(result.reason.length).toBeGreaterThan(0) // or a structural fault — either is honest, not silent
  })
})
