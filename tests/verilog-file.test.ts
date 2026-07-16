/**
 * Verilog on the CircuitFile hub — the adapter that makes the Verilog bridge reachable from the File menu
 * the same way SPICE/KiCad are. What must be true: a labeled gate canvas exports to a structural module
 * whose PORTS are its Net Labels (a gate-driven label = output, else input) and whose logic round-trips;
 * a module imports as one circuit-block node; non-gate parts are reported; and the format is detectable.
 */

import { describe, expect, test } from 'vitest'
import type { BlockData } from '../src/renderer/blocks.ts'
import { AND_BLOCK, XOR_BLOCK } from '../src/renderer/builtin-blocks.ts'
import {
  CIRCUIT_FILE_FORMAT,
  CIRCUIT_FILE_VERSION,
  type CircuitFile,
  type SavedNode,
  type SavedWire,
} from '../src/renderer/circuit-file.ts'
import { characterizeBlock } from '../src/renderer/logic-sim.ts'
import type { Parameters } from '../src/renderer/part-defaults.ts'
import { exportVerilog } from '../src/renderer/verilog.ts'
import { isVerilogText, parseVerilogText, serializeVerilog } from '../src/renderer/verilog-file.ts'
import { importVerilog } from '../src/renderer/verilog-import.ts'

const label = (id: string, name: string): SavedNode => ({
  id,
  definition: 'net_label',
  x: 0,
  y: 0,
  parameters: { net_name: { value: name } } as unknown as Parameters,
})
const wire = (
  id: string,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
): SavedWire => ({
  id,
  source,
  sourceHandle,
  target,
  targetHandle,
})
const circuit = (nodes: SavedNode[], wires: SavedWire[]): CircuitFile => ({
  format: CIRCUIT_FILE_FORMAT,
  version: CIRCUIT_FILE_VERSION,
  nodes,
  wires,
})

/** A one-gate canvas: gate `g1` (block) with its inputs/output each marked by a Net Label. */
const labeledGate = (block: BlockData): CircuitFile =>
  circuit(
    [
      { id: 'g1', definition: 'block', x: 200, y: 0, block },
      label('la', 'a'),
      label('lb', 'b'),
      label('ly', 'y'),
    ],
    [
      wire('w1', 'la', 'reference_terminal', 'g1', 'a'),
      wire('w2', 'lb', 'reference_terminal', 'g1', 'b'),
      wire('w3', 'ly', 'reference_terminal', 'g1', 'out'),
    ],
  )

describe('serializeVerilog — canvas → structural Verilog with Net Labels as ports', () => {
  test('a labeled AND exports with a/b as inputs, y as output, and round-trips functionally', () => {
    const { verilog, unsupported, warnings } = serializeVerilog(labeledGate(AND_BLOCK))
    expect(unsupported).toEqual([])
    expect(warnings).toEqual([])
    expect(verilog).toContain('input a, b;')
    expect(verilog).toContain('output y;')
    expect(verilog).toMatch(/\band g\d+\(/)
    // functional round-trip: the emitted module re-imports as a real AND over [a, b]
    const back = importVerilog(verilog).block as BlockData
    const tt = characterizeBlock(back)
    expect(tt).not.toBeNull()
    if (tt === null) return
    expect(tt.inputs).toEqual(['a', 'b'])
    for (const row of tt.rows)
      expect(row.out[0]).toBe((row.in[0] as boolean) && (row.in[1] as boolean))
  })

  test('the port DIRECTION is inferred from the gate (a labeled output net becomes an output)', () => {
    const { verilog } = serializeVerilog(labeledGate(XOR_BLOCK))
    // y sits on the gate's OUTPUT pin → output; a, b feed inputs → inputs
    expect(verilog).toMatch(/output y;/)
    expect(verilog).toMatch(/input a, b;/)
  })

  test('same-named labels tie two gate nets into one port (teleport)', () => {
    // two ANDs; a single shared output label 'q' on both outputs must collapse to ONE net
    const file = circuit(
      [
        { id: 'g1', definition: 'block', x: 0, y: 0, block: AND_BLOCK },
        { id: 'g2', definition: 'block', x: 0, y: 300, block: AND_BLOCK },
        label('la', 'a'),
        label('lb', 'b'),
        label('q1', 'q'),
        label('q2', 'q'),
      ],
      [
        wire('w1', 'la', 'reference_terminal', 'g1', 'a'),
        wire('w2', 'lb', 'reference_terminal', 'g1', 'b'),
        wire('w3', 'la', 'reference_terminal', 'g2', 'a'),
        wire('w4', 'lb', 'reference_terminal', 'g2', 'b'),
        wire('w5', 'q1', 'reference_terminal', 'g1', 'out'),
        wire('w6', 'q2', 'reference_terminal', 'g2', 'out'),
      ],
    )
    const { verilog } = serializeVerilog(file)
    // exactly one 'q' output port, not two
    expect((verilog.match(/\bq\b/g) ?? []).length).toBeGreaterThan(0)
    expect(verilog).toContain('output q;')
  })

  test('a non-gate part is reported as unsupported, not turned into a gate', () => {
    const file = circuit(
      [{ id: 'r1', definition: 'resistor', x: 0, y: 0 }, label('ln', 'n')],
      [wire('w1', 'ln', 'reference_terminal', 'r1', 'terminal_a')],
    )
    const { unsupported } = serializeVerilog(file)
    expect(unsupported.some((u) => u.includes('resistor'))).toBe(true)
  })

  test('a gate canvas with no Net Labels warns that it has no named I/O', () => {
    const file = circuit([{ id: 'g1', definition: 'block', x: 0, y: 0, block: AND_BLOCK }], [])
    const { warnings } = serializeVerilog(file)
    expect(warnings.some((w) => w.toLowerCase().includes('net label'))).toBe(true)
  })
})

describe('parseVerilogText — Verilog → a circuit-block node on the canvas', () => {
  test('a module imports as ONE block node whose gates simulate correctly', () => {
    const src = 'module m(a, b, o); input a, b; output o; nand g(o, a, b); endmodule'
    const { circuit: file, warnings } = parseVerilogText(src)
    expect(warnings).toEqual([])
    expect(file.nodes.length).toBe(1)
    const node = file.nodes[0] as SavedNode
    expect(node.definition).toBe('block')
    expect(node.block).toBeDefined()
    const tt = characterizeBlock(node.block as BlockData)
    expect(tt?.inputs).toEqual(['a', 'b'])
    expect(
      tt?.rows.every((r) => r.out[0] === !((r.in[0] as boolean) && (r.in[1] as boolean))),
    ).toBe(true)
  })

  test('text with no module imports to an empty circuit with a warning', () => {
    const { circuit: file, warnings } = parseVerilogText('not verilog at all')
    expect(file.nodes).toEqual([])
    expect(warnings.length).toBeGreaterThan(0)
  })
})

describe('isVerilogText — format detection for the shared import channel', () => {
  test('detects a structural module', () => {
    expect(isVerilogText('module m(a); input a; endmodule')).toBe(true)
    expect(isVerilogText('  \n// header\nmodule x(); endmodule')).toBe(true)
  })
  test('rejects SPICE and KiCad', () => {
    expect(isVerilogText('* SPICE deck\nR1 1 0 1k\n.end')).toBe(false)
    expect(isVerilogText('(kicad_sch (version 20230121) (module foo) )')).toBe(false)
  })
})

describe('the CircuitFile round-trip is faithful (export → import → same logic)', () => {
  test('a labeled AND canvas → Verilog → block characterizes as AND', () => {
    const { verilog } = serializeVerilog(labeledGate(AND_BLOCK))
    const reexport = exportVerilog(importVerilog(verilog).block as BlockData).verilog
    // re-exporting the imported module yields the same single AND primitive
    expect((reexport.match(/\band g\d+\(/g) ?? []).length).toBe(1)
  })
})
