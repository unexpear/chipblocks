/** ADVERSARIAL SCRATCH #3 — does the one REAL ECP5 fixture contain CCU2 slices? */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { parseEcp5Bitstream } from '../src/renderer/fpga-trellis-bit.ts'
import {
  decodeEcp5Slices,
  parseEcp5TileBits,
  parseEcp5TileGrid,
} from '../src/renderer/fpga-trellis-tiles.ts'

describe('real ECP5 fixture', () => {
  test('CCU2 slices present?', () => {
    const GRID = parseEcp5TileGrid(
      readFileSync(
        new URL('../fixtures/trellis-ecp5-LFE5U-25F-tilegrid.json', import.meta.url),
        'utf8',
      ),
    )
    const PLC2 = parseEcp5TileBits(
      readFileSync(new URL('../fixtures/trellis-ecp5-PLC2-bits.db', import.meta.url), 'utf8'),
    )
    const bytes = readFileSync(new URL('../fixtures/trellis-ecp5-asym-lut.bit', import.meta.url))
    const parsed = parseEcp5Bitstream(new Uint8Array(bytes))
    const slices = decodeEcp5Slices(parsed.frames, GRID, PLC2)
    const modes = new Map<string, number>()
    for (const s of slices) modes.set(String(s.mode), (modes.get(String(s.mode)) ?? 0) + 1)
    console.log('device:', parsed.device?.name, ' slices decoded:', slices.length)
    console.log('modes:', JSON.stringify([...modes]))
    expect(true).toBe(true)
  })
})
