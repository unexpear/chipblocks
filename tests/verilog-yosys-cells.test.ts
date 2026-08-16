/**
 * The gate cells a yosys-written netlist is built from.
 *
 * `write_verilog` emits instances of `$_NAND_`, `$_DFF_P_` and friends whose definitions live in yosys's own
 * simulation library, not in the file it wrote. The importer used to refuse every such netlist for a module
 * nobody defined — flat8080.v (a flattened Intel 8080) reported it 2,611 times. verilog-cells.ts supplies
 * the definitions; this file is the proof that each one means what yosys says it means.
 *
 * EVERY expected table below was printed by Icarus Verilog 14.0 (oss-cad-suite) compiling the SAME probe
 * module against yosys's own `share/yosys/simcells.v` — not what this implementation happens to return.
 * Inputs are swept in the declared order, the FIRST input being the most significant bit of the sweep index.
 *
 * The cells deliberately left undefined are here too: a design using one of them must keep refusing rather
 * than build on a cell this importer would get wrong.
 */

import { describe, expect, test } from 'vitest'
import type { BlockData, CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { simulateLogic } from '../src/renderer/logic-sim.ts'
import { YOSYS_CELLS } from '../src/renderer/verilog-cells.ts'
import { importVerilog } from '../src/renderer/verilog-import.ts'

const said = (warnings: string[]): string => warnings.join(' | ')
const supply = (volts: number) => ({
  nominal_voltage: { value: { kind: 'scalar', amount: volts, unit: 'volt' } },
})
const src = (id: string, volts: number): CanvasNodeLike => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition: 'power_source', parameters: supply(volts) },
})
const w = (id: string, s: string, sh: string, t: string, th: string): CanvasEdgeLike => ({
  id,
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
})

function solve(block: BlockData, inputs: Record<string, boolean>, state: Map<string, boolean>) {
  const nodes: CanvasNodeLike[] = [
    { id: 'M', position: { x: 0, y: 0 }, data: { definition: 'block', block } },
    { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
    src('vp', 5),
  ]
  const edges: CanvasEdgeLike[] = [
    w('ep', 'vp', 'terminal_positive', 'M', 'v_dd'),
    w('eg', 'M', 'gnd', 'g', 'reference_terminal'),
    w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
  ]
  let k = 0
  for (const [port, on] of Object.entries(inputs)) {
    const vid = `v${k++}`
    nodes.push(src(vid, on ? 5 : 0))
    edges.push(w(`e${vid}`, vid, 'terminal_positive', 'M', port))
    edges.push(w(`e${vid}n`, vid, 'terminal_negative', 'g', 'reference_terminal'))
  }
  return simulateLogic(nodes, edges, state)
}

/** A module instantiating one cell by its escaped yosys name, exactly as a written-out netlist does. */
const probe = (cell: string, ins: string[], out: string): string =>
  `module probe(${ins.map((p) => `input ${p}`).join(', ')}, output ${out});\n` +
  `  \\${cell}  u (${[...ins.map((p) => `.${p}(${p})`), `.${out}(${out})`].join(', ')});\nendmodule`

/** Sweep every input combination and read the output as a string of 0/1, first input = most significant. */
function sweep(cell: string, ins: string[]): string {
  const { block, warnings } = importVerilog(probe(cell, ins, 'Y'))
  expect(block, said(warnings)).not.toBeNull()
  const have = (block as BlockData).ports.map((p) => p.id)
  // A pin absent reads nothing at all, which a bit-string of zeros would hide: check the interface first.
  expect(
    [...ins, 'Y'].filter((p) => !have.includes(p)),
    said(warnings),
  ).toEqual([])
  let bits = ''
  for (let i = 0; i < 1 << ins.length; i++) {
    const drive: Record<string, boolean> = {}
    ins.forEach((p, k) => {
      drive[p] = ((i >> (ins.length - 1 - k)) & 1) === 1
    })
    const value = solve(block as BlockData, drive, new Map()).value('M', 'Y')
    expect(value, `${cell} left Y undriven at sweep ${i}`).not.toBeUndefined()
    bits += value === true ? '1' : '0'
  }
  return bits
}

describe('yosys gate cells mean exactly what yosys says they mean', () => {
  // Icarus + simcells.v, in order: A / A,B / A,B,S / A,B,C / A,B,C,D.
  const TABLES: [string, string[], string][] = [
    ['$_BUF_', ['A'], '01'],
    ['$_NOT_', ['A'], '10'],
    ['$_AND_', ['A', 'B'], '0001'],
    ['$_NAND_', ['A', 'B'], '1110'],
    ['$_OR_', ['A', 'B'], '0111'],
    ['$_NOR_', ['A', 'B'], '1000'],
    ['$_XOR_', ['A', 'B'], '0110'],
    ['$_XNOR_', ['A', 'B'], '1001'],
    ['$_ANDNOT_', ['A', 'B'], '0010'],
    ['$_ORNOT_', ['A', 'B'], '1011'],
    ['$_MUX_', ['A', 'B', 'S'], '00011011'],
    ['$_NMUX_', ['A', 'B', 'S'], '11100100'],
    ['$_AOI3_', ['A', 'B', 'C'], '10101000'],
    ['$_OAI3_', ['A', 'B', 'C'], '11101010'],
    ['$_AOI4_', ['A', 'B', 'C', 'D'], '1110111011100000'],
    ['$_OAI4_', ['A', 'B', 'C', 'D'], '1111100010001000'],
  ]

  for (const [cell, ins, icarus] of TABLES)
    test(`${cell} matches Icarus over all ${1 << ins.length} inputs`, () => {
      expect(sweep(cell, ins)).toBe(icarus)
    })

  test('$_DFF_P_ holds and captures on the rising edge, matching Icarus', () => {
    // (D, C) pairs; Icarus prints x for the first (nothing has clocked yet — this app powers flip-flops on
    // at 0), then 111000110001 for the rest.
    const steps: [number, number][] = [
      [1, 0],
      [1, 1],
      [1, 0],
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
      [1, 1],
      [0, 0],
      [0, 1],
      [0, 0],
      [1, 0],
      [1, 1],
    ]
    const { block, warnings } = importVerilog(probe('$_DFF_P_', ['D', 'C'], 'Q'))
    expect(block, said(warnings)).not.toBeNull()
    expect((block as BlockData).ports.map((p) => p.id)).toEqual(
      expect.arrayContaining(['D', 'C', 'Q']),
    )
    const state = new Map<string, boolean>()
    let seen = ''
    for (const [d, c] of steps) {
      const q = solve(block as BlockData, { D: d === 1, C: c === 1 }, state).value('M', 'Q')
      seen += q === true ? '1' : q === false ? '0' : '?'
    }
    expect(seen.slice(1)).toBe('111000110001')
  })

  test('the cells are supplied only where the netlist itself has no definition', () => {
    // A source that defines its own `$_AND_` keeps it — the built-in must never shadow the file.
    const { block, warnings } = importVerilog(
      `module \\$_AND_ (A, B, Y); input A, B; output Y; assign Y = ~(A & B); endmodule\n${probe('$_AND_', ['A', 'B'], 'Y')}`,
    )
    expect(block, said(warnings)).not.toBeNull()
    expect(said(warnings)).not.toContain('built-in yosys cell library')
    const table = [false, true].flatMap((a) =>
      [false, true].map(
        (b) => solve(block as BlockData, { A: a, B: b }, new Map()).value('M', 'Y') === true,
      ),
    )
    expect(table).toEqual([true, true, true, false])
  })

  test('a netlist using the cells says so, naming each one', () => {
    const { warnings } = importVerilog(
      `module top(input a, input b, output y, output z);\n` +
        `  \\$_NAND_  g0 (.A(a), .B(b), .Y(y));\n` +
        `  \\$_XOR_  g1 (.A(a), .B(b), .Y(z));\nendmodule`,
    )
    expect(said(warnings)).toContain('$_NAND_, $_XOR_')
    expect(said(warnings)).toContain('built-in yosys cell library')
  })

  test('a cell this importer would get wrong is NOT supplied — the design keeps refusing', () => {
    // $_TBUF_ drives Z, $_DFF_N_ clocks on the falling edge, $_DLATCH_P_ is level-sensitive, $_DFF_PP0_ has
    // an asynchronous reset. Each is refused by name elsewhere in this importer, so none may arrive here.
    for (const cell of ['$_TBUF_', '$_DFF_N_', '$_DLATCH_P_', '$_DFF_PP0_', '$_SR_PP_'])
      expect(YOSYS_CELLS[cell]).toBeUndefined()
    const { block, warnings } = importVerilog(probe('$_DFF_N_', ['D', 'C'], 'Q'))
    expect(block).toBeNull()
    expect(said(warnings)).toContain('no module "$_DFF_N_" is defined in this source')
  })
})
