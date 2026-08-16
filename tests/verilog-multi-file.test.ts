/**
 * A design spread over several files.
 *
 * A real processor is not one file: the die-derived Intel 8080 core lives in vm80a.v and the system that
 * instantiates it in sys8080.v. The importer took ONE source string, so opening the system file alone made
 * the core look like a module nobody defined and the whole CPU was refused for a definition sitting in the
 * folder beside it. The files are now read together, as a compiler reads them.
 *
 * Reading them together brings its own way of building the wrong design, which is why the duplicate-module
 * case below is a refusal: two files defining one module — a shared cell file listed twice, two revisions of
 * a core in one folder — used to keep the FIRST definition and publish a design that computes the opposite of
 * the second, with nothing but a warning to say so.
 *
 * The 256-row adder expectation is Icarus Verilog 14.0 on the same two files: {cout,s} == a + b throughout.
 */

import { describe, expect, test } from 'vitest'
import type { BlockData, CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { simulateLogic } from '../src/renderer/logic-sim.ts'
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

function solve(block: BlockData, inputs: Record<string, boolean>) {
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
  return simulateLogic(nodes, edges, new Map())
}

const ADDER_FILE = `module adder4(input [3:0] a, input [3:0] b, input cin, output [3:0] s, output cout);
  assign {cout, s} = a + b + cin;
endmodule`
const SYSTEM_FILE = `module top(input [3:0] a, input [3:0] b, output [3:0] s, output cout);
  adder4 u (.a(a), .b(b), .cin(1'b0), .s(s), .cout(cout));
endmodule`

describe('a design spread over several files', () => {
  test('a module instantiated in one file and defined in another builds and computes', () => {
    const { block, warnings, moduleName } = importVerilog([
      { name: 'sys.v', text: SYSTEM_FILE },
      { name: 'core.v', text: ADDER_FILE },
    ])
    expect(block, said(warnings)).not.toBeNull()
    expect(moduleName).toBe('top')
    const have = (block as BlockData).ports.map((p) => p.id)
    const wanted = ['cout', ...[0, 1, 2, 3].flatMap((i) => [`a[${i}]`, `b[${i}]`, `s[${i}]`])]
    expect(
      wanted.filter((p) => !have.includes(p)),
      said(warnings),
    ).toEqual([])
    for (let a = 0; a < 16; a++)
      for (let b = 0; b < 16; b++) {
        const drive: Record<string, boolean> = {}
        for (let i = 0; i < 4; i++) {
          drive[`a[${i}]`] = ((a >> i) & 1) === 1
          drive[`b[${i}]`] = ((b >> i) & 1) === 1
        }
        const out = solve(block as BlockData, drive)
        let got = out.value('M', 'cout') === true ? 16 : 0
        for (let i = 0; i < 4; i++) if (out.value('M', `s[${i}]`) === true) got += 1 << i
        expect(got, `a=${a} b=${b}`).toBe(a + b)
      }
  })

  test('the same single file alone is still refused for the module it does not define', () => {
    const { block, warnings } = importVerilog(SYSTEM_FILE)
    expect(block).toBeNull()
    expect(said(warnings)).toContain('no module "adder4" is defined in this source')
  })

  test('a warning names the FILE and the line within it, not the line of the joined stream', () => {
    const leaf = `module leaf(input a, input b, output y);
  wire spare;
  missing m (.a(a), .y(spare));
  assign y = a & b;
endmodule`
    const top = `module top(input a, input b, output y);
  leaf u (.a(a), .b(b), .y(y));
endmodule`
    const { warnings } = importVerilog([
      { name: 'top.v', text: top },
      { name: 'leaf.v', text: leaf },
    ])
    // `missing` sits on line 3 of the second file — line 6 of the two files read as one.
    expect(said(warnings)).toContain('leaf.v line 3: instance "m" of "missing"')
    expect(said(warnings)).not.toContain('line 6:')
  })

  test('one source given as a list reads exactly as the same source given alone', () => {
    const one = importVerilog(ADDER_FILE)
    const listed = importVerilog([{ name: 'core.v', text: ADDER_FILE }])
    expect(listed.moduleName).toBe(one.moduleName)
    expect(listed.warnings).toEqual(one.warnings)
    expect(listed.block?.nodes.length).toBe(one.block?.nodes.length)
  })

  test('no files at all is refused, not built as an empty design', () => {
    const { block, warnings } = importVerilog([])
    expect(block).toBeNull()
    expect(said(warnings)).toContain('no Verilog source was given')
  })
})

describe('two definitions of one module are refused, never silently resolved', () => {
  const positive = 'module leaf(input a, output y); assign y = a; endmodule'
  const inverted = 'module leaf(input a, output y); assign y = ~a; endmodule'
  const user = 'module top(input a, output y); leaf u (.a(a), .y(y)); endmodule'

  test('across two files: neither definition wins, so nothing is published', () => {
    const { block, warnings } = importVerilog([
      { name: 'top.v', text: user },
      { name: 'leaf_a.v', text: positive },
      { name: 'leaf_b.v', text: inverted },
    ])
    expect(block, 'a design built from one of two contradicting definitions').toBeNull()
    expect(said(warnings)).toContain('declared more than once')
  })

  test('within one file too', () => {
    const { block, warnings } = importVerilog(`${positive}\n${inverted}\n${user}`)
    expect(block).toBeNull()
    expect(said(warnings)).toContain('declared more than once')
  })

  test('the same module listed twice — a shared file picked twice — is refused', () => {
    const { block } = importVerilog([
      { name: 'top.v', text: user },
      { name: 'leaf.v', text: positive },
      { name: 'leaf.v', text: positive },
    ])
    expect(block).toBeNull()
  })
})
