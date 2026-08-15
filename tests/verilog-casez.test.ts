/**
 * casez / casex — the DON'T-CARE case, the shape every real instruction decoder is written in.
 *
 * The importer used to refuse both outright. They build now, but only where the mask can be lowered to real
 * 0/1 gates faithfully: each item becomes an AND-reduce of xnor over its CARE positions only, and the items
 * stay in source order inside the same nested if/else chain a plain `case` builds, because first-match-wins
 * on deliberately overlapping items is the whole point of a wildcard decoder.
 *
 * EVERY expected vector below is the output of Icarus Verilog 14.0 (oss-cad-suite) on the same source, swept
 * over all sixteen values of a 4-bit `op` — not what this implementation happens to return. The sweeps are
 * written out in full so a disagreement names the input that broke.
 *
 * Three sub-forms are deliberately left REFUSING, because Icarus gives a definite answer that this netlist
 * cannot honestly reproduce, and a refusal beats a wrong answer:
 *   - an x digit in a CASEZ item (a literal x; the item is dead), refused by name
 *   - an x folded into the SELECTOR (matches everything under casex, nothing under casez), refused by name
 *   - a defaultless wildcard case that covers its whole selector space (the coverage count is left
 *     conservative, so it infers a latch and the combinational-loop guard rejects it)
 */

import { describe, expect, test } from 'vitest'
import type { BlockData, CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { characterizeBlock, simulateLogic } from '../src/renderer/logic-sim.ts'
import { importVerilog } from '../src/renderer/verilog-import.ts'

const said = (warnings: string[]): string => warnings.join(' | ')

/** A 4-bit-in / 2-bit-out decoder around one procedural body. */
const dec = (body: string): string =>
  `module dec(input [3:0] op, output reg [1:0] y); always @* begin\n${body}\nend endmodule`

/**
 * Drive every value of `op` through the block's REAL gates and read `y` as an unsigned number. Selector bits
 * a mask never examines drive no gate and are dropped from the interface, so each row is matched on the input
 * bits that ARE present; every output bit must be built, or the sweep is not comparable.
 */
function sweep(verilog: string, selWidth = 4, outWidth = 2): number[] {
  const { block, warnings } = importVerilog(verilog)
  expect(block, said(warnings)).not.toBeNull()
  const table = characterizeBlock(block as BlockData)
  expect(table, said(warnings)).not.toBeNull()
  if (table === null) return []
  expect(table.outputs.length, `every y bit must be built — ${said(warnings)}`).toBe(outWidth)
  const bitOf = (name: string): number => Number(name.match(/\[(\d+)\]$/)?.[1] ?? -1)
  const inBit = table.inputs.map(bitOf)
  const outBit = table.outputs.map(bitOf)
  return Array.from({ length: 1 << selWidth }, (_, op) => {
    const row = table.rows.find((r) =>
      r.in.every((b, i) => b === (((op >> (inBit[i] as number)) & 1) === 1)),
    )
    expect(row, `no row for op=${op}`).toBeDefined()
    let value = 0
    row?.out.forEach((b, i) => {
      if (b) value += 1 << (outBit[i] as number)
    })
    return value
  })
}

/** Assert the design is refused whole (nothing published) and that the reason names `phrase`. */
function refuses(verilog: string, phrase: string): string {
  const { block, warnings } = importVerilog(verilog)
  expect(block, `expected no design; got one. ${said(warnings)}`).toBeNull()
  expect(said(warnings)).toContain(phrase)
  return said(warnings)
}

describe('casez / casex build the mask the source wrote', () => {
  test('a plain casez mask matches exactly the values it covers', () => {
    // Icarus: casez (op) 4'b10??: y=0; default: y=3;  →  0 only for op 8..11.
    expect(sweep(dec("casez (op) 4'b10??: y = 0; default: y = 3; endcase"))).toEqual([
      3, 3, 3, 3, 3, 3, 3, 3, 0, 0, 0, 0, 3, 3, 3, 3,
    ])
  })

  test('a NARROWER item is widened with care-and-zero bits, never with don’t-cares', () => {
    // The trap: padding a short pattern the way a literal pads itself (x-extending when the top digit is
    // unknown) turns 2'b?1 into 4'bxx?1 and matches every odd value. Icarus matches only {1,3} — op[3:2]
    // must be 00. 2'b1? passes either way (its top digit is 1), which is exactly why it hides the bug.
    expect(sweep(dec("casez (op) 2'b1?: y = 0; default: y = 3; endcase"))).toEqual([
      3, 3, 0, 0, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
    ])
    expect(sweep(dec("casez (op) 2'b?1: y = 0; default: y = 3; endcase"))).toEqual([
      3, 0, 3, 0, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
    ])
  })

  test('a literal DOES z-extend to its own declared width (IEEE 1364-2005 §3.2)', () => {
    // The other half of the same rule, and the reason the two extensions cannot share one code path:
    // 4'b?1 is 4'bzzz1 and matches every odd value, while 2'b??  stops after two bits and matches 0..3.
    expect(sweep(dec("casez (op) 4'b?1: y = 0; default: y = 3; endcase"))).toEqual([
      3, 0, 3, 0, 3, 0, 3, 0, 3, 0, 3, 0, 3, 0, 3, 0,
    ])
    expect(sweep(dec("casez (op) 2'b??: y = 1; default: y = 0; endcase"))).toEqual([
      1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ])
  })

  test('item ORDER is load-bearing: overlapping items take the first match', () => {
    // Icarus: op=15 matches BOTH items and takes y=1 (the first), not y=2. Any reordering, or a one-hot
    // "parallel mux" lowering that assumes the items are disjoint, flips 3, 7, 11 and 15.
    expect(
      sweep(dec("casez (op) 4'b??11: y = 1; 4'b11??: y = 2; default: y = 0; endcase")),
    ).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 2, 2, 2, 1])
  })

  test('several labels on one item are OR’d, wildcard and plain alike', () => {
    expect(sweep(dec("casez (op) 4'b00??, 4'b11??: y = 1; default: y = 0; endcase"))).toEqual([
      1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
    ])
    expect(sweep(dec("casez (op) 4'b00??, 4'd15: y = 1; default: y = 0; endcase"))).toEqual([
      1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ])
  })

  test('a wildcard digit clears log2(base) mask bits: hex and octal', () => {
    expect(sweep(dec("casez (op) 4'h?: y = 1; default: y = 0; endcase"))).toEqual(
      Array.from({ length: 16 }, () => 1),
    )
    // 4'o1? — the '?' clears three bits, the '1' supplies the fourth, so only op[3] is examined.
    expect(sweep(dec("casez (op) 4'o1?: y = 1; default: y = 0; endcase"))).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
    ])
  })

  test('z spelled z, and Z/underscores, read the same as ?', () => {
    expect(sweep(dec("casez (op) 4'b0z11: y = 1; default: y = 0; endcase"))).toEqual([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0,
    ])
    expect(sweep(dec("casex (op) 4'b1?Z?: y = 1; default: y = 0; endcase"))).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
    ])
    expect(sweep(dec("casez (op) 4'b1_0_?_?: y = 1; default: y = 0; endcase"))).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0,
    ])
  })

  test('an unsized wildcard label keeps its 32-bit sizing rules', () => {
    // 'b?1 z-extends to 32 bits (every odd value); 'b1? zero-extends, so op[3:2] must be 00 → {2,3}.
    expect(sweep(dec("casez (op) 'b?1: y = 1; default: y = 0; endcase"))).toEqual([
      0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1,
    ])
    expect(sweep(dec("casez (op) 'b1?: y = 1; default: y = 0; endcase"))).toEqual([
      0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ])
  })

  test('a label WIDER than the selector zero-extends it, even when it is declared signed', () => {
    expect(sweep(dec("casez (op) 8'b0000_10??: y = 1; default: y = 0; endcase"))).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0,
    ])
    // Icarus never matches 8'b1111_10?? against a signed 4-bit −8..−5: the unsigned literal items make the
    // whole comparison unsigned, so the selector zero-extends.
    expect(
      sweep(
        `module dec(input [3:0] op, output reg [1:0] y); reg signed [3:0] s;
         always @* begin s = op;
           casez (s) 8'b1111_10??: y = 1; 8'b0000_10??: y = 2; default: y = 0; endcase
         end endmodule`,
      ),
    ).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 0, 0, 0, 0])
  })

  test('the selector may be any expression, and the case may nest', () => {
    expect(sweep(dec("casez (op ^ 4'b0011) 4'b10??: y = 1; default: y = 0; endcase"))).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0,
    ])
    expect(
      sweep(dec("casez ({op[3:2], op[1:0]}) 4'b?10?: y = 1; default: y = 0; endcase")),
    ).toEqual([0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0])
    expect(
      sweep(
        dec(
          "casez (op) 4'b1???: begin casez (op) 4'b??1?: y = 1; default: y = 2; endcase end\n" +
            'default: y = 0; endcase',
        ),
      ),
    ).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 1, 1, 2, 2, 1, 1])
    expect(
      sweep(
        dec("if (op[3]) begin casez (op) 4'b1?0?: y = 1; default: y = 2; endcase end else y = 0;"),
      ),
    ).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 1, 1, 2, 2])
  })

  test('a four-item overlapping decoder — the shape a real instruction decoder has', () => {
    expect(
      sweep(
        dec("casez (op) 4'b??11: y = 1; 4'b1?0?: y = 2; 4'b0???: y = 3; default: y = 0; endcase"),
      ),
    ).toEqual([3, 3, 3, 1, 3, 3, 3, 1, 2, 2, 0, 1, 2, 2, 0, 1])
  })

  test('a `default` written first is still the fallback, not a first match', () => {
    expect(sweep(dec("casez (op) default: y = 0; 4'b10??: y = 1; endcase"))).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0,
    ])
  })

  test('no default: an earlier blocking assignment supplies the unmatched value', () => {
    expect(sweep(dec("y = 3;\ncasez (op) 4'b?1??: y = 1; endcase"))).toEqual([
      3, 3, 3, 3, 1, 1, 1, 1, 3, 3, 3, 3, 1, 1, 1, 1,
    ])
  })

  test('a last item that is ALL don’t-cares needs no default — its guard folds away', () => {
    expect(sweep(dec("casez (op) 4'b1???: y = 1; 4'b????: y = 2; endcase"))).toEqual([
      2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1,
    ])
  })
})

describe('casex treats x as a don’t-care; casez does not', () => {
  test('an x digit in a CASEX item matches anything', () => {
    expect(sweep(dec("casex (op) 4'b1xxx: y = 0; default: y = 3; endcase"))).toEqual([
      3, 3, 3, 3, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0,
    ])
    // and it x-extends to the declared width first, so 4'bx1 is 4'bxxx1 → every odd value.
    expect(sweep(dec("casex (op) 4'bx1: y = 1; default: y = 0; endcase"))).toEqual([
      0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1,
    ])
    expect(sweep(dec("casex (op) 4'b1?z?: y = 1; default: y = 0; endcase"))).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1,
    ])
    expect(sweep(dec("casex (op) 4'b1?0?: y = 1; default: y = 0; endcase"))).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0,
    ])
  })

  test('an x digit in a CASEZ item is a literal x — refused by name, not built as a don’t-care', () => {
    // Icarus takes the DEFAULT for all sixteen inputs of `casez (op) 4'b1xxx: y=0; default: y=3;` — an x in
    // a casez item can never equal a 0/1 net, so the item is dead. Stripping x alongside z and ? would give
    // y=0 for op 8..15: eight of sixteen inputs silently wrong, in the commonest decoder construct there is.
    const w = refuses(dec("casez (op) 4'b1xxx: y = 0; default: y = 3; endcase"), 'casez label')
    expect(w).toContain("4'b1xxx")
    expect(w).toContain('literal x')
    expect(w).toContain('is NOT built')
    refuses(dec("casez (op) 4'bx1: y = 1; default: y = 0; endcase"), 'casez label')
  })

  test('an x folded into the SELECTOR is refused by name under both forms', () => {
    // Icarus answers 0 for every input under casez (a literal x matches nothing) and 1 for every input under
    // casex (it matches anything) — opposite answers from the same masked-item source, so neither is guessed.
    for (const kind of ['casez', 'casex']) {
      const w = refuses(
        dec(`${kind} ({op[3:2], 2'bxx}) 4'b??00: y = 1; default: y = 0; endcase`),
        `${kind} selector`,
      )
      expect(w).toContain('is NOT built')
    }
  })
})

describe('the wildcard lowering does not leak into the constructs next to it', () => {
  test('a plain `case` against an x-bearing label still refuses', () => {
    // Icarus gives 3 for all sixteen. An "x matches anything" xnor would answer 0 for op 8..15 here.
    refuses(dec("case (op) 4'b1xxx: y = 0; default: y = 3; endcase"), 'stays x')
  })

  test('a plain `==` against an x-bearing literal still refuses', () => {
    refuses(dec("if (op == 4'b1xxx) y = 0; else y = 3;"), 'stays x')
  })

  test('the `==?` wildcard-equality operator still refuses', () => {
    // Same semantics as casez, a different spelling, and NOT wired to the ordinary `==` path — doing that
    // would make every design using the operator answer as if the x/z bits were definite.
    refuses(dec("if (op ==? 4'b10??) y = 1; else y = 0;"), '"==?" is not supported')
  })

  test('a plain `case` with full constant coverage and no default still builds', () => {
    expect(
      sweep(
        `module dec(input [3:0] op, output reg [1:0] y); always @* begin
           case (op[1:0]) 2'd0: y = 0; 2'd1: y = 1; 2'd2: y = 2; 2'd3: y = 3; endcase
         end endmodule`,
      ),
    ).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3])
  })

  test('a defaultless wildcard case that covers everything is REFUSED, not guessed', () => {
    // Icarus answers 2 for op 0..7 and 1 for op 8..15. Counting the values a mask covers is a second,
    // separate calculation, and an over-count would delete the last item's guard and invent values for
    // inputs that should latch — so the coverage check is left to constant labels and this over-refuses.
    const { block, warnings } = importVerilog(
      dec("casez (op) 4'b1???: y = 1; 4'b0???: y = 2; endcase"),
    )
    const table = block === null ? null : characterizeBlock(block as BlockData)
    expect(table, 'must not publish a y worked out from a latch').toBeNull()
    expect(said(warnings)).toContain('combinational loop')
  })
})

describe('the same lowering reaches the clocked and function-body doors', () => {
  const supply = (volts: number) => ({
    nominal_voltage: { value: { kind: 'scalar', amount: volts, unit: 'volt' } },
  })
  const source = (id: string, volts: number): CanvasNodeLike => ({
    id,
    position: { x: 0, y: 0 },
    data: { definition: 'power_source', parameters: supply(volts) },
  })
  const wire = (id: string, s: string, sh: string, t: string, th: string): CanvasEdgeLike => ({
    id,
    source: s,
    sourceHandle: sh,
    target: t,
    targetHandle: th,
  })
  const solve = (
    block: BlockData,
    inputs: Record<string, boolean>,
    state: Map<string, boolean>,
  ): ReturnType<typeof simulateLogic> => {
    const nodes: CanvasNodeLike[] = [
      { id: 'M', position: { x: 0, y: 0 }, data: { definition: 'block', block } },
      { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
      source('vp', 5),
    ]
    const edges: CanvasEdgeLike[] = [
      wire('ep', 'vp', 'terminal_positive', 'M', 'v_dd'),
      wire('eg', 'M', 'gnd', 'g', 'reference_terminal'),
      wire('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    ]
    let k = 0
    for (const [port, value] of Object.entries(inputs)) {
      const vid = `v${k++}`
      nodes.push(source(vid, value ? 5 : 0))
      edges.push(wire(`e${vid}`, vid, 'terminal_positive', 'M', port))
      edges.push(wire(`e${vid}n`, vid, 'terminal_negative', 'g', 'reference_terminal'))
    }
    return simulateLogic(nodes, edges, state)
  }

  test('a casez inside `always @(posedge clk)` registers the decoded value', () => {
    const { block, warnings } = importVerilog(
      `module dec(input clk, input [3:0] op, output reg [1:0] y);
         always @(posedge clk) begin
           casez (op) 4'b10??: y <= 1; default: y <= 0; endcase
         end
       endmodule`,
    )
    expect(block, said(warnings)).not.toBeNull()
    const dff = block as BlockData
    // The mask never examines op[1:0], so those bits drive no gate and their PINS are dropped. That is the
    // standing behaviour of the pipeline for any expression that ignores a bit (the hand-written mask idiom
    // `~(op ^ 4'b10xx) | 4'b0011` has always done it) — the logic stays right, the interface gets narrower.
    expect(said(warnings)).toContain('port "op[0]" is not connected to any gate')
    const pinIds = new Set(dff.ports.map((p) => p.id))
    const state = new Map<string, boolean>()
    // Icarus, clocking op = 0..15 one rising edge each: y = 1 exactly for op 8..11.
    for (let op = 0; op < 16; op++) {
      const pins: Record<string, boolean> = {}
      for (let b = 0; b < 4; b++)
        if (pinIds.has(`op[${b}]`)) pins[`op[${b}]`] = ((op >> b) & 1) === 1
      solve(dff, { ...pins, clk: false }, state)
      const high = solve(dff, { ...pins, clk: true }, state)
      const y =
        (high.value('M', 'y[0]') === true ? 1 : 0) + (high.value('M', 'y[1]') === true ? 2 : 0)
      expect(y, `op=${op}`).toBe(op >= 8 && op <= 11 ? 1 : 0)
    }
  })

  test('a casez inside a function body inlines the same mask', () => {
    expect(
      sweep(
        `module dec(input [3:0] op, output [1:0] y);
           function [1:0] f;
             input [3:0] a;
             begin casez (a) 4'b10??: f = 1; default: f = 0; endcase end
           endfunction
           assign y = f(op);
         endmodule`,
      ),
    ).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0])
  })

  test('a masked decoder still wires up as a child module', () => {
    // Masking drops the pins the decoder never examines, so a parent that wires all four bits into it meets
    // a narrower interface than the child's Verilog declares. Icarus answers 1 for op 8..11 either way.
    const child = `module dec(input [3:0] op, output reg [1:0] y);
        always @* begin casez (op) 4'b10??: y = 1; default: y = 0; endcase end
      endmodule`
    expect(
      sweep(
        `${child}\nmodule top(input [3:0] op, output [1:0] y); dec u(.op(op), .y(y)); endmodule`,
      ),
    ).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0])
    expect(
      sweep(
        `${child}\nmodule top(input [3:0] op, output [1:0] y);
           dec u(.op({op[3], op[2], op[1], op[0]}), .y(y));
         endmodule`,
      ),
    ).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0])
  })

  test('a label that is not a constant degenerates to plain equality', () => {
    // `casez (op) k:` with k a signal is legal Verilog; Icarus matches op = 5 only. No mask can be derived
    // from a net, and none is needed — a net can never carry x or z.
    expect(
      sweep(
        `module dec(input [3:0] op, output reg [1:0] y); wire [3:0] k = 4'd5;
         always @* begin casez (op) k: y = 1; default: y = 0; endcase end endmodule`,
      ),
    ).toEqual([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    // and a plain literal label under casez is ordinary equality too
    expect(sweep(dec("casez (op) 4'b1010: y = 1; default: y = 0; endcase"))).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0,
    ])
  })
})
