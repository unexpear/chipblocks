import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { parseIceboxChipdb } from '../src/renderer/fpga-icebox.ts'
import { type Ice40ChipDb, loadIce40Bitstream } from '../src/renderer/fpga-icebox-load.ts'
import { parseLogicTileBits } from '../src/renderer/fpga-icebox-logic.ts'
import { simulateClocked, simulateCombinational } from '../src/renderer/fpga-icebox-run.ts'

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

describe('fpga-icebox-bin.ts header: "does not yet feed a real vendor file into reconstructNetlist"', () => {
  test('a REAL icepack .bin goes end to end into a simulatable netlist', () => {
    const bytes = new Uint8Array(
      readFileSync(new URL('../fixtures/icebox-ice40-384-routed.bin', import.meta.url)),
    )
    const result = loadIce40Bitstream(bytes, { '384': ICE40_384 })
    console.log('loadIce40Bitstream ok:', result.ok)
    if (!result.ok) throw new Error(result.reason)
    console.log('family/device/crcOk:', result.family, result.device, result.crcOk)
    console.log('netlist cells recovered from the real vendor file:', result.netlist.cells.length)
    const cell0 = result.netlist.cells.find((c) => c.ref.cell === 0)
    const nets = (cell0?.inputs ?? [])
      .filter((i) => i.kind === 'primary')
      .map((i) => (i as { net: number }).net)
    const sim = simulateCombinational(result.netlist, new Map(nets.map((n) => [n, true] as const)))
    console.log('simulated output 1_1_5 with both inputs high:', sim.outputs.get('1_1_5'))
    console.log('simulateClocked, same module as the "follow-up" note:', typeof simulateClocked)
    expect(result.netlist.cells.length).toBeGreaterThan(0)
    expect(typeof simulateClocked).toBe('function')
  }, 120000)
})
