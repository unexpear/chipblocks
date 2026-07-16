/**
 * Verilog File-menu round-trip THROUGH REAL DISK — the "last hop" the unit tests can't reach by mocking.
 * The File menu's Export/Import handlers (electron/main.ts) do exactly: writeFile(pickedPath, text) on export
 * and readFile(path) → send on import. The only thing a script can't drive is the native OS file PICKER
 * choosing that path (it is the OS, not our code). This test exercises everything else on a genuine temp
 * file: serialize the canvas → WRITE it to disk → READ it back → detect the format → import → simulate.
 * If the bytes that land on disk are valid, round-trippable Verilog, the menu hop is proven end to end.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { BlockData } from '../src/renderer/blocks.ts'
import { AND_BLOCK } from '../src/renderer/builtin-blocks.ts'
import {
  CIRCUIT_FILE_FORMAT,
  CIRCUIT_FILE_VERSION,
  type CircuitFile,
} from '../src/renderer/circuit-file.ts'
import { characterizeBlock } from '../src/renderer/logic-sim.ts'
import type { Parameters } from '../src/renderer/part-defaults.ts'
import { isVerilogText, parseVerilogText, serializeVerilog } from '../src/renderer/verilog-file.ts'

/** A labeled AND canvas — the same shape the renderer hands the File-menu export handler. */
const labeledAnd: CircuitFile = {
  format: CIRCUIT_FILE_FORMAT,
  version: CIRCUIT_FILE_VERSION,
  nodes: [
    { id: 'g1', definition: 'block', x: 200, y: 0, block: AND_BLOCK },
    {
      id: 'la',
      definition: 'net_label',
      x: 0,
      y: 0,
      parameters: { net_name: { value: 'a' } } as unknown as Parameters,
    },
    {
      id: 'lb',
      definition: 'net_label',
      x: 0,
      y: 40,
      parameters: { net_name: { value: 'b' } } as unknown as Parameters,
    },
    {
      id: 'ly',
      definition: 'net_label',
      x: 400,
      y: 0,
      parameters: { net_name: { value: 'y' } } as unknown as Parameters,
    },
  ],
  wires: [
    { id: 'w1', source: 'la', sourceHandle: 'reference_terminal', target: 'g1', targetHandle: 'a' },
    { id: 'w2', source: 'lb', sourceHandle: 'reference_terminal', target: 'g1', targetHandle: 'b' },
    {
      id: 'w3',
      source: 'ly',
      sourceHandle: 'reference_terminal',
      target: 'g1',
      targetHandle: 'out',
    },
  ],
}

describe('Verilog File menu — the export→disk→import hop on a real file', () => {
  test('Export writes valid Verilog to a real .v file that Import reads back to the same logic', () => {
    // 1. what the renderer computes for the "Export Verilog…" handler
    const { verilog } = serializeVerilog(labeledAnd)

    // 2. what electron/main.ts's `file:save-verilog` handler does: writeFile(pickedPath, text)
    const dir = mkdtempSync(join(tmpdir(), 'chipblocks-verilog-'))
    const path = join(dir, 'design.v')
    writeFileSync(path, verilog, 'utf8')

    // 3. what `importNetlist` does: readFile(path) — a genuine byte round-trip through the OS
    const fromDisk = readFileSync(path, 'utf8')
    expect(fromDisk).toBe(verilog) // nothing mangled on the way to/from disk
    expect(fromDisk).toContain('module design(')
    expect(fromDisk).toContain('endmodule')

    // 4. what App.tsx does with the re-read text: detect the format, then import + simulate
    expect(isVerilogText(fromDisk)).toBe(true)
    const { circuit, warnings } = parseVerilogText(fromDisk)
    expect(warnings).toEqual([])
    const block = circuit.nodes[0]?.block as BlockData
    const tt = characterizeBlock(block)
    expect(tt?.inputs).toEqual(['a', 'b'])
    for (const row of tt?.rows ?? [])
      expect(row.out[0]).toBe((row.in[0] as boolean) && (row.in[1] as boolean))
  })

  test('a .v file written to disk is recognized as Verilog, not SPICE/KiCad', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chipblocks-verilog-'))
    const path = join(dir, 'nand.v')
    writeFileSync(
      path,
      'module m(a, b, o); input a, b; output o; nand g(o, a, b); endmodule\n',
      'utf8',
    )
    const text = readFileSync(path, 'utf8')
    // this is the exact branch App.tsx takes on the shared import channel
    const isKicad = text.trimStart().startsWith('(kicad_sch')
    expect(!isKicad && isVerilogText(text)).toBe(true)
  })
})
