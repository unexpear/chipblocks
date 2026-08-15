/**
 * A DECLARATION WHOSE RANGE THIS IMPORTER CANNOT SIZE IS NOT A ONE-BIT NET.
 *
 * `wire [$clog2(DEPTH)-1:0] z;` used to warn about the RANGE and then register z as a single bit. Every read
 * of it after that was a value the source never wrote, and the design published with nothing said about the
 * ANSWER: measured in the running app against Icarus Verilog 14.0, `assign z = 8'hFF; assign y = z;` read 1
 * where Icarus reads 255, and `[0:7]` / `[8:1]` — ranges that fold perfectly well but are shapes this
 * importer does not represent — read 1 the same way.
 *
 * The width of such a net is not one. It is UNKNOWN, and the only honest answer is to refuse the name and let
 * the transitive-unbuilt rule carry the refusal out to the module pins — exactly what a memory whose range
 * will not fold, and a sub-module PORT whose range will not fold, already did.
 *
 * Every number below is the output of Icarus Verilog 14.0 on the same source, read through a 32-bit probe.
 */

import { describe, expect, test } from 'vitest'
import type { BlockData, CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { simulateLogic } from '../src/renderer/logic-sim.ts'
import { importVerilog } from '../src/renderer/verilog-import.ts'

const said = (warnings: string[]): string => warnings.join(' | ')

/** A module with a four-bit input and a THIRTY-TWO-bit output. The wide probe is deliberate: a narrow output
 *  can truncate a wrong value into a right-looking one and hide the very defect these tests exist for. */
const probe = (body: string): string =>
  `module m(a, o); input [3:0] a; output [31:0] o; ${body} endmodule`

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

/** Drive `a` with a four-bit number, solve, and read the 32-bit `o` back as one integer. */
function readO(block: BlockData, aVal: number): bigint {
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
  for (let b = 0; b < 4; b++) {
    const vid = `v${b}`
    nodes.push(src(vid, ((aVal >> b) & 1) === 1 ? 5 : 0))
    edges.push(w(`e${vid}`, vid, 'terminal_positive', 'M', `a[${b}]`))
    edges.push(w(`e${vid}n`, vid, 'terminal_negative', 'g', 'reference_terminal'))
  }
  const res = simulateLogic(nodes, edges, new Map())
  let out = 0n
  for (let b = 0; b < 32; b++) if (res.value('M', `o[${b}]`) === true) out |= 1n << BigInt(b)
  return out
}

describe('a net whose declared range will not size is refused by name, not built as one bit', () => {
  test('an unfoldable range on a wire refuses the design (Icarus: 255, this built 1)', () => {
    const { block, warnings } = importVerilog(
      probe("wire [$clog2(256)-1:0] z; assign z = 8'hFF; assign o = z;"),
    )
    expect(block, said(warnings)).toBeNull()
    expect(said(warnings)).toContain('net "z" has a range this importer cannot size')
    expect(said(warnings)).toContain('is NOT built')
  })

  test('an unfoldable range on a reg refuses the design (Icarus: 245, this built 1)', () => {
    const { block, warnings } = importVerilog(
      probe("reg [$clog2(256)-1:0] r; always @(*) r = {4'hF, a}; assign o = r;"),
    )
    expect(block, said(warnings)).toBeNull()
    expect(said(warnings)).toContain('register "r" has a range this importer cannot size')
  })

  test('an ASCENDING range folds but is not representable, and is refused (Icarus: 255)', () => {
    const { block, warnings } = importVerilog(
      probe("wire [0:7] z; assign z = 8'hFF; assign o = z;"),
    )
    expect(block, said(warnings)).toBeNull()
    expect(said(warnings)).toContain('net "z" has a range this importer cannot size')
    expect(said(warnings)).toContain('must be [N:0]')
  })

  test('a NONZERO-BASED range is refused the same way (Icarus: 255)', () => {
    const { block, warnings } = importVerilog(
      probe("wire [8:1] z; assign z = 8'hFF; assign o = z;"),
    )
    expect(block, said(warnings)).toBeNull()
    expect(said(warnings)).toContain('net "z" has a range this importer cannot size')
  })

  test('the refusal reaches the module pin through ordinary logic (Icarus: 21, this built 17)', () => {
    const { block, warnings } = importVerilog(
      probe("wire [$clog2(256)-1:0] z; assign z = {4'h0, a}; assign o = z + 8'd16;"),
    )
    expect(block, said(warnings)).toBeNull()
    expect(said(warnings)).toContain('is NOT built')
  })

  test('a wor whose range will not size is refused, not resolved at one bit (Icarus: 255)', () => {
    const { block, warnings } = importVerilog(
      probe("wor [$clog2(256)-1:0] z; assign z = 8'h0F; assign z = 8'hF0; assign o = z;"),
    )
    expect(block, said(warnings)).toBeNull()
    expect(said(warnings)).toContain('net "z" has a range this importer cannot size')
  })

  test('a $bits range this evaluator cannot fold refuses too (Icarus: 255, this built 1)', () => {
    const { block, warnings } = importVerilog(
      probe(
        "wire [7:0] x; assign x = 8'h00; wire [$bits(x)-1:0] z; assign z = 8'hFF; assign o = z + x;",
      ),
    )
    expect(block, said(warnings)).toBeNull()
    expect(said(warnings)).toContain('net "z" has a range this importer cannot size')
  })
})

describe('the rule is precise in both directions', () => {
  test('an unsized declaration NOTHING reads still publishes the rest of the design (Icarus: 6)', () => {
    const { block, warnings } = importVerilog(
      probe("wire [$clog2(256)-1:0] z; assign o = a + 8'd1;"),
    )
    expect(block, said(warnings)).not.toBeNull()
    expect(said(warnings)).toContain('net "z" has a range this importer cannot size')
    expect(readO(block as BlockData, 5)).toBe(6n)
  })

  test('a plain [7:0] wire is untouched and computes its real value (Icarus: 260)', () => {
    const { block, warnings } = importVerilog(
      probe("wire [7:0] z; assign z = 8'hFF; assign o = z + a;"),
    )
    expect(block, said(warnings)).not.toBeNull()
    expect(readO(block as BlockData, 5)).toBe(260n)
  })

  test('a [W-1:0] wire with an unsized parameter W is untouched (Icarus: 2753)', () => {
    const { block, warnings } = importVerilog(
      probe("parameter W = 12; wire [W-1:0] z; assign z = 12'hABC; assign o = z + a;"),
    )
    expect(block, said(warnings)).not.toBeNull()
    expect(readO(block as BlockData, 5)).toBe(2753n)
  })

  test('a sized-literal range wraps at its own width and still builds (Icarus: 31, five bits)', () => {
    // `(4'd10 + 4'd10)` wraps to 4 at four bits, so this is a FIVE-bit bus and 21'h1FFFFF truncates to 31.
    const { block, warnings } = importVerilog(
      probe("wire [(4'd10 + 4'd10):0] z; assign z = 21'h1FFFFF; assign o = z;"),
    )
    expect(block, said(warnings)).not.toBeNull()
    expect(readO(block as BlockData, 5)).toBe(31n)
  })

  test('several names sharing one good range all keep it (Icarus: 260)', () => {
    const { block, warnings } = importVerilog(
      probe(
        "wire [7:0] p, q, r; assign p = 8'h0F; assign q = 8'hF0; assign r = p | q; assign o = r + a;",
      ),
    )
    expect(block, said(warnings)).not.toBeNull()
    expect(readO(block as BlockData, 5)).toBe(260n)
  })

  test('a memory whose word range will not size keeps refusing, unchanged (Icarus: 255)', () => {
    const { block, warnings } = importVerilog(
      probe(
        "reg [$clog2(256)-1:0] m [0:3]; wire clk; assign clk = a[0]; always @(posedge clk) m[a[1:0]] <= 8'hFF; assign o = m[a[1:0]];",
      ),
    )
    expect(block, said(warnings)).toBeNull()
    expect(said(warnings)).toContain('memory "m" has an unsupported word range')
  })
})
