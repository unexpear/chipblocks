/**
 * The TEXT iCE40 chip file (`.asc`) — the format the file picker offers and every refusal message named, and
 * which until now no reader in this repository could open.
 *
 * The whole point of these tests is CROSS-CHECKING against the real tools, not self-consistency. Every fixture
 * here is genuine output: `fixtures/icebox-ice40-384-dense.asc` and `icebox-ice40-384-vendor-xor5.asc` are
 * `icepack -u` renderings of the very `.bin` files committed beside them, and the 1k pair are nextpnr-ice40's
 * own `.asc` with `icepack`'s `.bin` of the SAME design. So the load-bearing assertion below is that reading a
 * design out of the text file and out of the binary file produce the same design, bit for bit and part for
 * part — which cannot pass by accident and cannot pass if either reader drifts.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  ascHasBlockMemoryContents,
  ascProgrammedBits,
  isIceboxAscText,
  parseIceboxAsc,
} from '../src/renderer/fpga-icebox-asc.ts'
import { parseBinFile } from '../src/renderer/fpga-icebox-bin.ts'
import { cramToProgrammedBits } from '../src/renderer/fpga-icebox-cram-index.ts'
import {
  type ChipDescriptionFile,
  identifyBitstream,
  openFpgaDesign,
} from '../src/renderer/fpga-open.ts'

const text = (name: string): string =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')
const bytes = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)))
const asBytes = (name: string): Uint8Array => new TextEncoder().encode(text(name))
const chipdb = (device: string): ChipDescriptionFile[] => [
  { name: `chipdb-${device}.txt`, text: text(`icebox-ice40-${device}-chipdb.txt`) },
]

/** Every set bit of a file, in one comparable form, whichever file it came from. */
const bitKeys = (bits: readonly { x: number; y: number; row: number; col: number }[]): string[] =>
  bits.map((bit) => `${bit.x},${bit.y},${bit.row},${bit.col}`).sort()

describe('reading a text chip file', () => {
  test('a real icepack rendering comes apart into its chip, its tiles and their settings', () => {
    const parsed = parseIceboxAsc(text('icebox-ice40-384-dense.asc'))
    expect(parsed.device).toBe('384')
    expect(parsed.tiles.length).toBeGreaterThan(0)
    for (const tile of parsed.tiles) expect(tile.rows).toHaveLength(16)
    expect(parsed.unrecognised).toEqual([])
  })

  test('nextpnr’s own extras — the signal names it writes — are read, not tripped over', () => {
    const parsed = parseIceboxAsc(text('icebox-ice40-1k-carry-add4.asc'))
    expect(parsed.device).toBe('1k')
    expect(parsed.comment).toContain('next-pnr')
    expect(parsed.symbols.size).toBeGreaterThan(0)
    expect(parsed.unrecognised).toEqual([])
  })

  test('a chip DESCRIPTION file is not mistaken for a chip file', () => {
    // It also opens with `.device 384` and also has `.logic_tile` sections — but its sections describe what a
    // logic tile is, with no place on the chip and no settings. Telling a user their chip file is damaged when
    // they simply picked the wrong file is the failure this guards.
    expect(isIceboxAscText(text('icebox-ice40-384-chipdb.txt'))).toBe(false)
    const identity = identifyBitstream(asBytes('icebox-ice40-384-chipdb.txt'))
    expect(identity.ok).toBe(false)
    if (identity.ok) throw new Error('unreachable')
    expect(identity.reason).toContain('not an FPGA chip file')
  })

  test('a file whose tiles do not fit the chip it names is refused, not read anyway', () => {
    // Column 0 of a 384 is a pin tile, not a logic tile. A file that says otherwise disagrees with the chip it
    // names, and reading its settings anyway would decode switches that were never programmed.
    const wrongKind = text('icebox-ice40-384-dense.asc').replace(
      '.logic_tile 1 1',
      '.logic_tile 0 1',
    )
    expect(() => ascProgrammedBits(parseIceboxAsc(wrongKind))).toThrow(/do not match/)
    const offChip = text('icebox-ice40-384-dense.asc').replace(
      '.logic_tile 1 1',
      '.logic_tile 99 1',
    )
    expect(() => ascProgrammedBits(parseIceboxAsc(offChip))).toThrow(/off the edge/)
  })

  test('a settings row of the wrong width is refused, not padded out or trimmed', () => {
    // A logic tile on any iCE40 is 54 switches wide. A row a switch short would shift every switch after it,
    // so reading it anyway would decode a different design and say nothing.
    const lines = text('icebox-ice40-384-dense.asc').split(String.fromCharCode(10))
    const at = lines.findIndex((line) => line.startsWith('.logic_tile'))
    lines[at + 1] = (lines[at + 1] as string).slice(0, -1)
    expect(() => ascProgrammedBits(parseIceboxAsc(lines.join(String.fromCharCode(10))))).toThrow(
      /wrong width/,
    )
  })

  test('a truncated tile is refused rather than half-read', () => {
    const lines = text('icebox-ice40-384-dense.asc').split(String.fromCharCode(10))
    const at = lines.findIndex((line) => line.startsWith('.logic_tile'))
    lines.splice(at + 3, 4) // four of that tile's sixteen rows of settings
    expect(() => parseIceboxAsc(lines.join(String.fromCharCode(10)))).toThrow(/ends a block early/)
  })

  test('the block-memory contents a file carries are seen, and their absence is not invented', () => {
    expect(ascHasBlockMemoryContents(parseIceboxAsc(text('icebox-ice40-1k-blockram.asc')))).toBe(
      true,
    )
    expect(ascHasBlockMemoryContents(parseIceboxAsc(text('icebox-ice40-1k-carry-add4.asc')))).toBe(
      false,
    )
  })
})

describe('the text file and the binary file describe the same chip', () => {
  // The oracle. Each pair below is the SAME design in both forms, produced by the real tools.
  for (const [name, ascName, binName, device] of [
    ['a dense 384 pattern', 'icebox-ice40-384-dense.asc', 'icebox-ice40-384-dense.bin', '384'],
    [
      'a vendor xor5 on a 384',
      'icebox-ice40-384-vendor-xor5.asc',
      'icebox-ice40-384-vendor-xor5.bin',
      '384',
    ],
    [
      'a 4-bit adder on a 1k',
      'icebox-ice40-1k-carry-add4.asc',
      'icebox-ice40-1k-carry-add4.bin',
      '1k',
    ],
    [
      'a block memory on a 1k',
      'icebox-ice40-1k-blockram.asc',
      'icebox-ice40-1k-blockram.bin',
      '1k',
    ],
  ] as const) {
    test(`${name}: every set bit matches`, () => {
      const fromText = ascProgrammedBits(parseIceboxAsc(text(ascName)))
      const fromBinary = cramToProgrammedBits(device, parseBinFile(bytes(binName)).cram)
      expect(fromText.length).toBeGreaterThan(0)
      expect(bitKeys(fromText)).toEqual(bitKeys(fromBinary))
    })

    test(`${name}: opening either file gives the same design and the same account of it`, () => {
      const fromText = openFpgaDesign(asBytes(ascName), chipdb(device))
      const fromBinary = openFpgaDesign(bytes(binName), chipdb(device))
      if (!fromText.ok) throw new Error(fromText.reason)
      if (!fromBinary.ok) throw new Error(fromBinary.reason)
      expect(fromText.report.device).toBe(fromBinary.report.device)
      expect(fromText.report.partCount).toBe(fromBinary.report.partCount)
      expect(fromText.report.pieceCount).toBe(fromBinary.report.pieceCount)
      expect(fromText.report.inputCount).toBe(fromBinary.report.inputCount)
      expect(fromText.report.untrusted).toEqual(fromBinary.report.untrusted)
      expect(fromText.report.incomplete).toEqual(fromBinary.report.incomplete)
      expect(fromText.report.missing).toEqual(fromBinary.report.missing)
      expect(fromText.circuit.nodes).toEqual(fromBinary.circuit.nodes)
      expect(fromText.circuit.wires).toEqual(fromBinary.circuit.wires)
    })
  }
})

describe('what the app says about a text chip file', () => {
  test('it is named as an iCE40 chip file, in its text form', () => {
    expect(identifyBitstream(asBytes('icebox-ice40-1k-carry-add4.asc'))).toEqual({
      ok: true,
      family: 'ice40',
      device: '1k',
      form: 'text',
    })
  })

  test('the missing checksum is stated, rather than a check being implied that never happened', () => {
    const opened = openFpgaDesign(asBytes('icebox-ice40-1k-carry-add4.asc'), chipdb('1k'))
    if (!opened.ok) throw new Error(opened.reason)
    expect(opened.report.form).toBe('text')
    expect(opened.report.notes.join(' ')).toContain('carries no checksum')
    // …and the binary form, which does have one, must not carry that sentence.
    const binary = openFpgaDesign(bytes('icebox-ice40-1k-carry-add4.bin'), chipdb('1k'))
    if (!binary.ok) throw new Error(binary.reason)
    expect(binary.report.form).toBe('binary')
    expect(binary.report.notes.join(' ')).not.toContain('carries no checksum')
  })
})
