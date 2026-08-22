/**
 * AN `integer` IN TASK SCOPE IS SIGNED — at every task-scope site, and still only where it is declared.
 *
 * IEEE 1364-2005 §3.9 makes `integer` a SIGNED 32-bit variable, so widening one past its own 32 bits
 * replicates its top bit and comparing one against 0 is a signed comparison. That was true of a function
 * local, a function argument and a module-scope variable, and FALSE of everything in task scope.
 *
 * The mechanism: a task body is spliced into the CALLER's tree and elaborated under the caller's scope, so
 * that scope is the only oracle a later read of a task-scoped name has. The inliner published each such name
 * into the module's width table and nothing else, which left `signedOf` — and through it `declOf`, whose type
 * wall every store re-applies — answering UNSIGNED for every one of them. Measured against Icarus Verilog
 * 14.0 before the fix, with a clean build and no warning at all: `task widen; input integer k; output [63:0]
 * o; begin o = k; end` answered 64'h00000000ffffffff where Icarus answers 64'hffffffffffffffff, and
 * `(k < 0)` inside a task was never true.
 *
 * EVERY expected number below is Icarus Verilog 14.0 (oss-cad-suite, `-g2005`) on exactly the source in the
 * test, at the same six input vectors, read through a probe as wide as the port is declared. Nothing is read
 * off current behaviour. The last group is the other half of the same rule — `time` is UNSIGNED 64 and a
 * plain `reg [31:0]` is unsigned whatever it holds, and neither may start sign-extending.
 */

import { describe, expect, test } from 'vitest'
import type { BlockData, CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { simulateLogic } from '../src/renderer/logic-sim.ts'
import { importVerilog } from '../src/renderer/verilog-import.ts'

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

const said = (warnings: string[]): string => warnings.join(' | ')

/** The six input vectors every expectation below was measured at. 0x00 is the one that must stay zero and
 *  0xff the one whose sign extension fills the whole word, so a probe stuck at either end shows up. */
const VECTORS = [0x00, 0x01, 0x02, 0x10, 0x20, 0xff]

/** Read `y` at its FULL declared width, as a BigInt, with the 8-bit input `a` held at `value`. A 64-bit port
 *  does not fit a JS number, so the whole harness counts in BigInt. Every `y` bit must be DRIVEN: an
 *  undriven pin would otherwise read as a 0 bit and quietly turn a missing driver into a plausible answer. */
function yAt(block: BlockData, value: number, width: number): bigint {
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
  for (let bit = 0; bit < 8; bit++) {
    const vid = `v${bit}`
    nodes.push(src(vid, ((value >> bit) & 1) === 1 ? 5 : 0))
    edges.push(w(`e${vid}`, vid, 'terminal_positive', 'M', `a[${bit}]`))
    edges.push(w(`e${vid}n`, vid, 'terminal_negative', 'g', 'reference_terminal'))
  }
  const result = simulateLogic(nodes, edges, new Map())
  let out = 0n
  for (let bit = 0; bit < width; bit++) {
    const level = result.value('M', `y[${bit}]`)
    expect(level, `y[${bit}] is driven`).not.toBeUndefined()
    if (level === true) out |= 1n << BigInt(bit)
  }
  return out
}

/** Build `verilog`, assert every declared `a` and `y` pin is published, and read `y` at each vector as a
 *  zero-padded hex string of the port's own width. */
function sweep(verilog: string, width: number): string[] {
  const { block, warnings } = importVerilog(verilog)
  expect(block, said(warnings)).not.toBeNull()
  const design = block as BlockData
  const pins = new Set(design.ports.map((p) => p.id))
  for (let bit = 0; bit < 8; bit++)
    expect(pins.has(`a[${bit}]`), `a[${bit}] is published — ${said(warnings)}`).toBe(true)
  for (let bit = 0; bit < width; bit++)
    expect(pins.has(`y[${bit}]`), `y[${bit}] is published — ${said(warnings)}`).toBe(true)
  const digits = Math.ceil(width / 4)
  return VECTORS.map((v) => yAt(design, v, width).toString(16).padStart(digits, '0'))
}

/** `o = k` inside a task, where `k` is whatever `decl` declares it. */
const widenTask = (decl: string, width: number, actual: string): string =>
  `module top(input [7:0] a, output [${width - 1}:0] y);
  reg [${width - 1}:0] r;
  task widen;
    input ${decl} k;
    output [${width - 1}:0] o;
    begin
      o = k;
    end
  endtask
  always @* widen(${actual}, r);
  assign y = r;
endmodule
`

/** −0, −1, −2, −16, −32, −255 at 64 bits: the six answers a signed 32-bit variable widens to. */
const NEG64 = [
  '0000000000000000',
  'ffffffffffffffff',
  'fffffffffffffffe',
  'fffffffffffffff0',
  'ffffffffffffffe0',
  'ffffffffffffff01',
]
/** The same six, zero-extended instead — what an UNSIGNED 32-bit value must still answer. */
const ZERO64 = [
  '0000000000000000',
  '00000000ffffffff',
  '00000000fffffffe',
  '00000000fffffff0',
  '00000000ffffffe0',
  '00000000ffffff01',
]
/** 0x55 where the value is >= 0, 0xaa where it is < 0 — a signed comparison inside a task. */
const CMP_SIGNED = ['55', 'aa', 'aa', 'aa', 'aa', 'aa']
/** The same comparison read UNSIGNED: nothing is ever less than zero. */
const CMP_UNSIGNED = ['55', '55', '55', '55', '55', '55']

describe('an `integer` TASK ARGUMENT is the signed 32-bit variable §3.9 declares', () => {
  test('classic `input integer k` widened to 64 bits sign-extends', () => {
    expect(sweep(widenTask('integer', 64, "0 - {24'b0, a}"), 64)).toEqual(NEG64)
  })

  test('widened to 40 bits — past 32, short of 64', () => {
    expect(sweep(widenTask('integer', 40, "0 - {24'b0, a}"), 40)).toEqual([
      '0000000000',
      'ffffffffff',
      'fffffffffe',
      'fffffffff0',
      'ffffffffe0',
      'ffffffff01',
    ])
  })

  test('the ANSI header form `task widen(input integer k, output [63:0] o);`', () => {
    expect(
      sweep(
        `module top(input [7:0] a, output [63:0] y);
  reg [63:0] r;
  task widen(input integer k, output [63:0] o);
    begin
      o = k;
    end
  endtask
  always @* widen(0 - {24'b0, a}, r);
  assign y = r;
endmodule
`,
        64,
      ),
    ).toEqual(NEG64)
  })

  test('a NEGATIVE LITERAL actual keeps its sign through the binding', () => {
    // The literal alone would leave `always @*` with an empty sensitivity list, which Icarus never runs at
    // all — so a second, input-driven argument rides along and the block really executes.
    expect(
      sweep(
        `module top(input [7:0] a, output [63:0] y);
  reg [63:0] r;
  reg [7:0] t;
  task widen;
    input integer k;
    input [7:0] d;
    output [63:0] o;
    output [7:0] q;
    begin
      o = k;
      q = d;
    end
  endtask
  always @* widen(-1, a, r, t);
  assign y = r ^ {56'b0, t};
endmodule
`,
        64,
      ),
    ).toEqual([
      'ffffffffffffffff',
      'fffffffffffffffe',
      'fffffffffffffffd',
      'ffffffffffffffef',
      'ffffffffffffffdf',
      'ffffffffffffff00',
    ])
  })

  test('a NEGATIVE COMPUTED actual keeps its sign through the binding', () => {
    expect(sweep(widenTask('integer', 64, "-3 - {24'b0, a}"), 64)).toEqual([
      'fffffffffffffffd',
      'fffffffffffffffc',
      'fffffffffffffffb',
      'ffffffffffffffed',
      'ffffffffffffffdd',
      'fffffffffffffefe',
    ])
  })

  test('a signed 8-bit NET sign-extends into the argument and out of it again', () => {
    expect(
      sweep(
        `module top(input [7:0] a, output [63:0] y);
  wire signed [7:0] sa = a;
  reg [63:0] r;
  task widen;
    input integer k;
    output [63:0] o;
    begin
      o = k;
    end
  endtask
  always @* widen(sa, r);
  assign y = r;
endmodule
`,
        64,
      ),
    ).toEqual([
      '0000000000000000',
      '0000000000000001',
      '0000000000000002',
      '0000000000000010',
      '0000000000000020',
      'ffffffffffffffff',
    ])
  })

  test('`k < 0` inside the task is a SIGNED comparison', () => {
    expect(
      sweep(
        `module top(input [7:0] a, output [7:0] y);
  reg [7:0] r;
  task chk;
    input integer k;
    output [7:0] o;
    begin
      o = (k < 0) ? 8'haa : 8'h55;
    end
  endtask
  always @* chk(0 - {24'b0, a}, r);
  assign y = r;
endmodule
`,
        8,
      ),
    ).toEqual(CMP_SIGNED)
  })

  test('`k >>> 4` inside the task is an ARITHMETIC shift', () => {
    expect(
      sweep(
        `module top(input [7:0] a, output [31:0] y);
  reg [31:0] r;
  task sh;
    input integer k;
    output [31:0] o;
    begin
      o = k >>> 4;
    end
  endtask
  always @* sh(0 - {24'b0, a}, r);
  assign y = r;
endmodule
`,
        32,
      ),
    ).toEqual(['00000000', 'ffffffff', 'ffffffff', 'ffffffff', 'fffffffe', 'fffffff0'])
  })
})

describe('an `integer` TASK LOCAL is signed at every read of it', () => {
  const localTask = (body: string, width: number): string =>
    `module top(input [7:0] a, output [${width - 1}:0] y);
  reg [${width - 1}:0] r;
  task t;
    input [7:0] v;
    output [${width - 1}:0] o;
    integer k;
    begin
${body}
    end
  endtask
  always @* t(a, r);
  assign y = r;
endmodule
`

  test('a local `integer` widened to 64 bits sign-extends', () => {
    expect(sweep(localTask("      k = 0 - {24'b0, v};\n      o = k;", 64), 64)).toEqual(NEG64)
  })

  test('`k < 0` on a local `integer` is a SIGNED comparison', () => {
    expect(
      sweep(localTask("      k = 0 - {24'b0, v};\n      o = (k < 0) ? 8'haa : 8'h55;", 8), 8),
    ).toEqual(CMP_SIGNED)
  })

  test('a PART-WRITE leaves the local still signed', () => {
    expect(
      sweep(localTask("      k = 32'hffffff00;\n      k[7:0] = v;\n      o = k;", 64), 64),
    ).toEqual([
      'ffffffffffffff00',
      'ffffffffffffff01',
      'ffffffffffffff02',
      'ffffffffffffff10',
      'ffffffffffffff20',
      'ffffffffffffffff',
    ])
  })

  test('a local `integer` counted down by a `for` loop and then widened', () => {
    expect(
      sweep(
        `module top(input [7:0] a, output [63:0] y);
  reg [63:0] r;
  task cnt;
    input [7:0] v;
    output [63:0] o;
    integer i;
    integer acc;
    begin
      acc = 0;
      for (i = 3; i >= 0; i = i - 1) acc = acc - {31'b0, v[i]};
      o = acc;
    end
  endtask
  always @* cnt(a, r);
  assign y = r;
endmodule
`,
        64,
      ),
    ).toEqual([
      '0000000000000000',
      'ffffffffffffffff',
      'ffffffffffffffff',
      '0000000000000000',
      '0000000000000000',
      'fffffffffffffffc',
    ])
  })
})

describe('an `integer` TASK OUTPUT sign-extends into whatever the caller wrote', () => {
  test('`output integer` written back into a 64-bit reg', () => {
    expect(
      sweep(
        `module top(input [7:0] a, output [63:0] y);
  reg [63:0] r;
  task negt;
    input [7:0] v;
    output integer k;
    begin
      k = 0 - {24'b0, v};
    end
  endtask
  always @* negt(a, r);
  assign y = r;
endmodule
`,
        64,
      ),
    ).toEqual(NEG64)
  })

  test('`output integer` written back into a module-scope `integer`, then widened', () => {
    expect(
      sweep(
        `module top(input [7:0] a, output [63:0] y);
  integer m;
  reg [63:0] r;
  task negt;
    input [7:0] v;
    output integer k;
    begin
      k = 0 - {24'b0, v};
    end
  endtask
  always @* begin
    negt(a, m);
    r = m;
  end
  assign y = r;
endmodule
`,
        64,
      ),
    ).toEqual(NEG64)
  })

  test('`inout integer` round-tripped through a 64-bit reg', () => {
    expect(
      sweep(
        `module top(input [7:0] a, output [63:0] y);
  reg [63:0] r;
  task bump;
    inout integer k;
    begin
      k = k - 1;
    end
  endtask
  always @* begin
    r = {56'b0, a};
    bump(r);
  end
  assign y = r;
endmodule
`,
        64,
      ),
    ).toEqual([
      'ffffffffffffffff',
      '0000000000000000',
      '0000000000000001',
      '000000000000000f',
      '000000000000001f',
      '00000000000000fe',
    ])
  })
})

describe('the signedness survives every way a task can be reached', () => {
  test('a task calling a NESTED task, the integer handed on', () => {
    expect(
      sweep(
        `module top(input [7:0] a, output [63:0] y);
  reg [63:0] r;
  task inner;
    input integer k;
    output [63:0] o;
    begin
      o = k;
    end
  endtask
  task outer;
    input integer k;
    output [63:0] o;
    begin
      inner(k, o);
    end
  endtask
  always @* outer(0 - {24'b0, a}, r);
  assign y = r;
endmodule
`,
        64,
      ),
    ).toEqual(NEG64)
  })

  test('the task lives in a SUB-MODULE, so its scope crosses hierarchy flattening', () => {
    expect(
      sweep(
        `module widener(input [7:0] a, output [63:0] y);
  reg [63:0] r;
  task widen;
    input integer k;
    output [63:0] o;
    begin
      o = k;
    end
  endtask
  always @* widen(0 - {24'b0, a}, r);
  assign y = r;
endmodule
module top(input [7:0] a, output [63:0] y);
  widener u(.a(a), .y(y));
endmodule
`,
        64,
      ),
    ).toEqual(NEG64)
  })

  test('the SAME task called twice in one block — each call keeps its own scope', () => {
    expect(
      sweep(
        `module top(input [7:0] a, output [63:0] y);
  reg [63:0] r1;
  reg [63:0] r2;
  task widen;
    input integer k;
    output [63:0] o;
    begin
      o = k;
    end
  endtask
  always @* begin
    widen(0 - {24'b0, a}, r1);
    widen({24'b0, a}, r2);
  end
  assign y = r1 ^ r2;
endmodule
`,
        64,
      ),
    ).toEqual([
      '0000000000000000',
      'fffffffffffffffe',
      'fffffffffffffffc',
      'ffffffffffffffe0',
      'ffffffffffffffc0',
      'fffffffffffffffe',
    ])
  })
})

describe('nothing else in task scope becomes signed', () => {
  test('`input time` is UNSIGNED 64 — nothing bound to one is ever < 0', () => {
    // The all-ones here is NOT sign extension: a 64-bit formal makes the binding a 64-bit context, so
    // `0 - {24'b0, a}` is the subtraction itself carried out at 64 bits (§5.4.1).
    expect(sweep(widenTask('time', 64, "0 - {24'b0, a}"), 64)).toEqual(NEG64)
    expect(
      sweep(
        `module top(input [7:0] a, output [7:0] y);
  reg [7:0] r;
  task chk;
    input time k;
    output [7:0] o;
    begin
      o = (k < 0) ? 8'haa : 8'h55;
    end
  endtask
  always @* chk(0 - {24'b0, a}, r);
  assign y = r;
endmodule
`,
        8,
      ),
    ).toEqual(CMP_UNSIGNED)
  })

  test('a plain `input [31:0]` still ZERO-extends into a 64-bit output', () => {
    expect(sweep(widenTask('[31:0]', 64, "0 - {24'b0, a}"), 64)).toEqual(ZERO64)
  })

  test('a plain `output [31:0]` still ZERO-extends into a 64-bit caller reg', () => {
    expect(
      sweep(
        `module top(input [7:0] a, output [63:0] y);
  reg [63:0] r;
  task negt;
    input [7:0] v;
    output [31:0] k;
    begin
      k = 0 - {24'b0, v};
    end
  endtask
  always @* negt(a, r);
  assign y = r;
endmodule
`,
        64,
      ),
    ).toEqual(ZERO64)
  })

  test('a plain `input [31:0]` needs an explicit $signed to compare below zero', () => {
    expect(
      sweep(
        `module top(input [7:0] a, output [7:0] y);
  reg [7:0] r;
  task chk;
    input [31:0] k;
    output [7:0] o;
    begin
      o = ($signed(k) < 0) ? 8'haa : 8'h55;
    end
  endtask
  always @* chk(0 - {24'b0, a}, r);
  assign y = r;
endmodule
`,
        8,
      ),
    ).toEqual(CMP_SIGNED)
  })
})

describe('the function-scope and module-scope equivalents, which already worked', () => {
  test('a function `input integer` argument widened to 64 bits', () => {
    expect(
      sweep(
        `module top(input [7:0] a, output [63:0] y);
  function [63:0] widen;
    input integer k;
    begin
      widen = k;
    end
  endfunction
  assign y = widen(0 - {24'b0, a});
endmodule
`,
        64,
      ),
    ).toEqual(NEG64)
  })

  test('a function local `integer` widened to 64 bits', () => {
    expect(
      sweep(
        `module top(input [7:0] a, output [63:0] y);
  function [63:0] widen;
    input [31:0] v;
    integer k;
    begin
      k = 0 - v;
      widen = k;
    end
  endfunction
  assign y = widen({24'b0, a});
endmodule
`,
        64,
      ),
    ).toEqual(NEG64)
  })

  test('`k < 0` on a function `input integer` argument', () => {
    expect(
      sweep(
        `module top(input [7:0] a, output [7:0] y);
  function [7:0] chk;
    input integer k;
    begin
      chk = (k < 0) ? 8'haa : 8'h55;
    end
  endfunction
  assign y = chk(0 - {24'b0, a});
endmodule
`,
        8,
      ),
    ).toEqual(CMP_SIGNED)
  })

  test('a module-scope `integer` widened to 64 bits', () => {
    expect(
      sweep(
        `module top(input [7:0] a, output [63:0] y);
  integer k;
  reg [63:0] r;
  always @* begin
    k = 0 - {24'b0, a};
    r = k;
  end
  assign y = r;
endmodule
`,
        64,
      ),
    ).toEqual(NEG64)
  })

  test('a module-scope `reg signed [31:0]` widened to 64 bits', () => {
    expect(
      sweep(
        `module top(input [7:0] a, output [63:0] y);
  reg signed [31:0] s;
  reg [63:0] r;
  always @* begin
    s = 0 - {24'b0, a};
    r = s;
  end
  assign y = r;
endmodule
`,
        64,
      ),
    ).toEqual(NEG64)
  })
})
