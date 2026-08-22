/**
 * DECLARED VARIABLE TYPES — `integer`, `time`, `real`, `realtime`, and the optional `reg` — at EVERY
 * declaration site a type keyword can stand at: a function argument (classic and ANSI), a function return, a
 * function local, a task argument (classic and ANSI, in and out), a task local, a module port (ANSI and
 * non-ANSI), and a module-scope variable.
 *
 * IEEE 1364-2005 §3.9 makes `integer` a SIGNED 32-bit variable and `time` an UNSIGNED 64-bit one; §3.10 makes
 * `real`/`realtime` IEEE-754 doubles, which have no bit pattern a two-valued netlist can carry and are
 * therefore refused BY NAME. §12.3.3 allows a variable port only in the OUTPUT direction.
 *
 * Every site used to re-derive the type from the leading keyword alone, which missed it whenever a direction
 * keyword came first. Measured against Icarus Verilog 14.0 before this suite existed, with every pin present
 * and NO warning at all: `input integer k; idf = k;` built the argument ONE BIT wide, so `idf(7)` answered 1
 * where Icarus answers 7 and `addk(9,5)` answered 2 where Icarus answers 14; `input reg [3:0] v` stood at one
 * bit too; `output integer y` published a single scalar `y` pin in place of 32; and `real r; r = 7; r = r/2;`
 * built integer division where Verilog divides as reals.
 *
 * EVERY expected number below is Icarus Verilog 14.0 (oss-cad-suite) run on the same source at the same four
 * input vectors, read through a probe as wide as the port is declared. Nothing is read off current behaviour.
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

/** The four input vectors every expectation below was measured at. */
const VECTORS = [0xb4, 0x5a, 0x01, 0x80]

/** Read `y` at its FULL declared width with the 8-bit input `a` held at `value`. Every `a` bit is driven and
 *  every `y` bit is read, so a pin built narrower than the source declares shows up as a wrong number rather
 *  than hiding behind a short probe. */
function yAt(block: BlockData, value: number, width: number): number {
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
  const have = new Set(block.ports.map((p) => p.id))
  for (let bit = 0; bit < 8; bit++) {
    const pin = `a[${bit}]`
    if (!have.has(pin)) continue
    const vid = `v${bit}`
    nodes.push(src(vid, ((value >> bit) & 1) === 1 ? 5 : 0))
    edges.push(w(`e${vid}`, vid, 'terminal_positive', 'M', pin))
    edges.push(w(`e${vid}n`, vid, 'terminal_negative', 'g', 'reference_terminal'))
  }
  const result = simulateLogic(nodes, edges, new Map())
  let out = 0n
  for (let bit = 0; bit < width; bit++)
    if (result.value('M', `y[${bit}]`) === true) out |= 1n << BigInt(bit)
  return Number(out)
}

/** Build `verilog`, assert every declared `y` pin is published, and read `y` at each vector. */
function sweep(verilog: string, width = 32): number[] {
  const { block, warnings } = importVerilog(verilog)
  expect(block, said(warnings)).not.toBeNull()
  const cpu = block as BlockData
  const pins = new Set(cpu.ports.map((p) => p.id))
  for (let bit = 0; bit < width; bit++)
    expect(pins.has(`y[${bit}]`), `y[${bit}] is published — ${said(warnings)}`).toBe(true)
  return VECTORS.map((v) => yAt(cpu, v, width))
}

/** Import `verilog` expecting NO published design, and assert the refusal names `needle`. */
function refusesSaying(verilog: string, needle: string): void {
  const { block, warnings } = importVerilog(verilog)
  expect(block, `expected a refusal, got a design — ${said(warnings)}`).toBeNull()
  expect(said(warnings)).toContain(needle)
}

const top = (body: string, width = 32): string =>
  `module top(input [7:0] a, output [${width - 1}:0] y);\n${body}\nendmodule\n`
const topReg = (body: string, width = 32): string =>
  `module top(input [7:0] a, output reg [${width - 1}:0] y);\n${body}\nendmodule\n`

describe('an `integer` FUNCTION ARGUMENT is the signed 32-bit variable §3.9 declares', () => {
  test('classic `input integer k` — idf(7) ^ a (Icarus: 179 93 6 135)', () => {
    expect(
      sweep(
        top(`  function [7:0] idf; input integer k; begin idf = k; end endfunction
  assign y = idf(7) ^ a;`),
      ),
    ).toEqual([179, 93, 6, 135])
  })

  test('two integer arguments add as 32-bit values — addk(9,5) + a (Icarus: 194 104 15 142)', () => {
    expect(
      sweep(
        top(`  function [7:0] addk; input integer p; input integer q; begin addk = p + q; end endfunction
  assign y = addk(9, 5) + a;`),
      ),
    ).toEqual([194, 104, 15, 142])
  })

  test('one declaration, two names: `input integer p, q;` (Icarus: 194 104 15 142)', () => {
    expect(
      sweep(
        top(`  function [7:0] addk; input integer p, q; begin addk = p + q; end endfunction
  assign y = addk(9, 5) + a;`),
      ),
    ).toEqual([194, 104, 15, 142])
  })

  test('a NEGATIVE constant survives the binding — wf(-3) (Icarus: 65353 65447 65532 65405)', () => {
    // 16'hfffd ^ a: the whole answer is the sign extension. A one-bit argument built 1 and answered 1 ^ a.
    expect(
      sweep(
        top(`  function [15:0] wf; input integer k; begin wf = k; end endfunction
  assign y = wf(-3) ^ a;`),
      ),
    ).toEqual([65353, 65447, 65532, 65405])
  })

  test('a signed SIGNAL sign-extends into the argument (Icarus: 4 65530 1 0)', () => {
    expect(
      sweep(
        top(`  function [15:0] wf; input integer k; begin wf = k; end endfunction
  assign y = wf($signed(a[3:0]));`),
      ),
    ).toEqual([4, 65530, 1, 0])
  })

  test('an integer argument used as a shift amount (Icarus: 160 208 8 0)', () => {
    expect(
      sweep(
        top(`  function [7:0] shf; input [7:0] v; input integer k; begin shf = v << k; end endfunction
  assign y = shf(a, 3);`),
      ),
    ).toEqual([160, 208, 8, 0])
  })

  test('it WRAPS at 32 bits: f(32.hffffffff) + 1 is zero (Icarus: 180 90 1 128)', () => {
    expect(
      sweep(
        top(`  function [7:0] f; input integer k; input [7:0] v; begin f = (k + 1) == 0 ? v : 8'h00; end endfunction
  assign y = f(32'hffff_ffff, a);`),
      ),
    ).toEqual([180, 90, 1, 128])
  })

  test('it COMPARES as signed: f(-1) satisfies k < 0 (Icarus: 180 90 1 128)', () => {
    expect(
      sweep(
        top(`  function [7:0] f; input integer k; input [7:0] v; begin f = (k < 0) ? v : 8'h00; end endfunction
  assign y = f(-1, a);`),
      ),
    ).toEqual([180, 90, 1, 128])
  })

  test('>>> keeps the sign bits: f(-256) >>> 4 (Icarus: 65348 65450 65521 65392)', () => {
    expect(
      sweep(
        top(`  function [15:0] f; input integer k; begin f = k >>> 4; end endfunction
  assign y = f(-256) ^ a;`),
      ),
    ).toEqual([65348, 65450, 65521, 65392])
  })

  test('ANSI `function [7:0] idf(input integer k)` (Icarus: 179 93 6 135)', () => {
    // The ANSI path used to DROP the name entirely and report the call as passing one argument too many.
    expect(
      sweep(
        top(`  function [7:0] idf(input integer k); begin idf = k; end endfunction
  assign y = idf(7) ^ a;`),
      ),
    ).toEqual([179, 93, 6, 135])
  })

  test('ANSI mixed `(input [7:0] v, input integer k)` (Icarus: 160 208 8 0)', () => {
    expect(
      sweep(
        top(`  function [7:0] shf(input [7:0] v, input integer k); begin shf = v << k; end endfunction
  assign y = shf(a, 3);`),
      ),
    ).toEqual([160, 208, 8, 0])
  })

  test('it survives being flattened up from a SUBMODULE (Icarus: 189 99 10 137)', () => {
    expect(
      sweep(`module child(input [7:0] v, output [31:0] q);
  function [7:0] addk; input integer k; input [7:0] x; begin addk = x + k; end endfunction
  assign q = addk(9, v);
endmodule
module top(input [7:0] a, output [31:0] y);
  child u(.v(a), .q(y));
endmodule
`),
    ).toEqual([189, 99, 10, 137])
  })
})

describe('an `integer` TASK ARGUMENT is the same signed 32-bit variable', () => {
  test('classic `input integer k` (Icarus: 187 97 8 135)', () => {
    expect(
      sweep(
        topReg(`  task setit; input integer k; input [7:0] v; output [31:0] o; begin o = v + k; end endtask
  always @* setit(7, a, y);`),
      ),
    ).toEqual([187, 97, 8, 135])
  })

  test('a NEGATIVE constant argument (Icarus: 177 87 4294967294 125)', () => {
    expect(
      sweep(
        topReg(`  task setit; input integer k; input [7:0] v; output [31:0] o; begin o = v + k; end endtask
  always @* setit(-3, a, y);`),
      ),
    ).toEqual([177, 87, 4294967294, 125])
  })

  test('ANSI `task setit(input integer k, …)` (Icarus: 187 97 8 135)', () => {
    expect(
      sweep(
        topReg(`  task setit(input integer k, input [7:0] v, output [31:0] o); begin o = v + k; end endtask
  always @* setit(7, a, y);`),
      ),
    ).toEqual([187, 97, 8, 135])
  })

  test('`output integer o` writes back all 32 bits (Icarus: 189 99 10 137)', () => {
    expect(
      sweep(
        topReg(`  task setit; input [7:0] v; output integer o; begin o = v + 9; end endtask
  always @* setit(a, y);`),
      ),
    ).toEqual([189, 99, 10, 137])
  })
})

describe('the optional `reg` keyword on an argument does not eat its range', () => {
  const cases: [string, string][] = [
    [
      'a classic function argument',
      top(`  function [7:0] f; input reg [3:0] v; begin f = v + 1; end endfunction
  assign y = f(a);`),
    ],
    [
      'an ANSI function argument',
      top(`  function [7:0] f(input reg [3:0] v); begin f = v + 1; end endfunction
  assign y = f(a);`),
    ],
    [
      'a classic task argument',
      topReg(`  task t; input reg [3:0] v; output [31:0] o; begin o = v + 1; end endtask
  always @* t(a, y);`),
    ],
    [
      'an ANSI task argument',
      topReg(`  task t(input reg [3:0] v, output [31:0] o); begin o = v + 1; end endtask
  always @* t(a, y);`),
    ],
  ]
  for (const [what, verilog] of cases)
    test(`${what} keeps its four bits (Icarus: 5 11 2 1)`, () => {
      expect(sweep(verilog)).toEqual([5, 11, 2, 1])
    })
})

describe('`time` is the unsigned 64-bit variable §3.9 declares', () => {
  test('a `time` function argument (Icarus: 179 93 6 135)', () => {
    expect(
      sweep(
        top(`  function [7:0] idf; input time k; begin idf = k; end endfunction
  assign y = idf(7) ^ a;`),
      ),
    ).toEqual([179, 93, 6, 135])
  })

  test('a `time` function RETURN publishes 64 pins (Icarus: 189 99 10 137)', () => {
    expect(
      sweep(
        top(
          `  function time tf; input [7:0] k; begin tf = k + 9; end endfunction
  assign y = tf(a);`,
          64,
        ),
        64,
      ),
    ).toEqual([189, 99, 10, 137])
  })

  test('a `time` function LOCAL (Icarus: 189 99 10 137)', () => {
    expect(
      sweep(
        top(`  function [7:0] f; input [7:0] v; time t; begin t = v + 9; f = t; end endfunction
  assign y = f(a);`),
      ),
    ).toEqual([189, 99, 10, 137])
  })
})

describe('a variable-typed MODULE PORT is published at the width its type gives it', () => {
  test('ANSI `output integer y` is 32 pins, not one (Icarus: 189 99 10 137)', () => {
    expect(
      sweep(`module top(input [7:0] a, output integer y);
  always @* y = a + 9;
endmodule
`),
    ).toEqual([189, 99, 10, 137])
  })

  test('non-ANSI `output integer y;` is 32 pins too (Icarus: 189 99 10 137)', () => {
    expect(
      sweep(`module top(a, y);
  input [7:0] a;
  output integer y;
  always @* y = a + 9;
endmodule
`),
    ).toEqual([189, 99, 10, 137])
  })

  test('`output time y` is 64 pins (Icarus: 189 99 10 137)', () => {
    expect(
      sweep(
        `module top(input [7:0] a, output time y);
  always @* y = a + 9;
endmodule
`,
        64,
      ),
    ).toEqual([189, 99, 10, 137])
  })

  test('an INPUT declared with a variable type is refused — §12.3.3 forbids it', () => {
    // Icarus Verilog 14.0 rejects this outright ("Net data type requires SystemVerilog"), so there is no
    // oracle a build could be measured against.
    refusesSaying(
      `module top(a, y);
  input integer a;
  output [31:0] y;
  assign y = a + 1;
endmodule
`,
      'which IEEE 1364-2005 §12.3.3 allows only on an output',
    )
  })
})

describe('`real`/`realtime` are refused BY NAME, at every site that can declare one', () => {
  const inFunctionOrTask = 'IEEE-754 floating point'
  test('a classic function argument', () => {
    refusesSaying(
      top(`  function [7:0] idf; input real k; begin idf = k; end endfunction
  assign y = idf(7) ^ a;`),
      `a "real" declaration inside a function/task is ${inFunctionOrTask}`,
    )
  })

  test('a `realtime` classic function argument', () => {
    refusesSaying(
      top(`  function [7:0] idf; input realtime k; begin idf = k; end endfunction
  assign y = idf(7) ^ a;`),
      `a "realtime" declaration inside a function/task is ${inFunctionOrTask}`,
    )
  })

  test('an ANSI function argument', () => {
    refusesSaying(
      top(`  function [7:0] idf(input real k); begin idf = k; end endfunction
  assign y = idf(7) ^ a;`),
      `a "real" function argument is ${inFunctionOrTask}`,
    )
  })

  test('a function LOCAL', () => {
    refusesSaying(
      top(`  function [7:0] f; input [7:0] v; real r; begin r = 3; f = v + r; end endfunction
  assign y = f(a);`),
      `a "real" declaration inside a function/task is ${inFunctionOrTask}`,
    )
  })

  test('a function RETURN', () => {
    refusesSaying(
      top(`  function real rf; input [7:0] k; begin rf = k; end endfunction
  assign y = rf(a) + 1;`),
      `a "real" function return is ${inFunctionOrTask}`,
    )
  })

  test('a classic task argument', () => {
    refusesSaying(
      topReg(`  task setit; input real k; input [7:0] v; output [31:0] o; begin o = v + k; end endtask
  always @* setit(7, a, y);`),
      `a "real" declaration inside a function/task is ${inFunctionOrTask}`,
    )
  })

  test('an ANSI task argument', () => {
    refusesSaying(
      topReg(`  task setit(input real k, input [7:0] v, output [31:0] o); begin o = v + k; end endtask
  always @* setit(7, a, y);`),
      `a "real" task argument is ${inFunctionOrTask}`,
    )
  })

  test('a task LOCAL', () => {
    refusesSaying(
      topReg(`  task t; input [7:0] v; output [31:0] o; real r; begin r = 3; o = v + r; end endtask
  always @* t(a, y);`),
      `a "real" declaration inside a function/task is ${inFunctionOrTask}`,
    )
  })

  test('a MODULE-SCOPE variable — where real division used to build integer division', () => {
    // Icarus Verilog 14.0 reads 7/2 as 3.5 and the store to y rounds it to 4, so this built a + 3 against
    // Icarus's a + 4 — silently, with every pin present.
    refusesSaying(
      topReg(`  real r;
  always @* begin r = 7; r = r / 2; y = a + r; end`),
      `a "real" variable is ${inFunctionOrTask}`,
    )
  })
})

describe('an `integer` FUNCTION RETURN is signed, so it is refused like any signed return', () => {
  test('the refusal names the type rather than calling the declaration malformed', () => {
    // §10.3.1 makes the call a signed operand and a `call` node carries no signedness. The old parser read
    // `integer` as the function NAME and reported "malformed function declaration".
    refusesSaying(
      top(`  function integer idf; input [7:0] k; begin idf = k; end endfunction
  assign y = idf(a) + 1;`),
      'a signed function return is not built — "integer" is a SIGNED 32-bit type',
    )
  })
})

describe('a declaration prefix Icarus rejects is refused, not read as something else', () => {
  // Reading the optional `reg` and the type keywords means the parser now walks the whole prefix. Anything it
  // walks past has to be Verilog it can vouch for: source Icarus Verilog 14.0 rejects has no oracle at all.
  test('a function argument declared `output` — §10.3.2 makes every one an input', () => {
    refusesSaying(
      top(`  function [7:0] f(output [3:0] v); begin f = v + 1; end endfunction
  assign y = f(a[3:0]);`),
      'a function argument declared "output" is not legal Verilog',
    )
  })

  test('an ANSI function port with no direction keyword at all', () => {
    refusesSaying(
      top(`  function [7:0] f([3:0] v); begin f = v + 1; end endfunction
  assign y = f(a[3:0]);`),
      'has no direction keyword',
    )
  })

  test('an ANSI task port with no direction keyword at all', () => {
    refusesSaying(
      topReg(`  task t(reg [3:0] v, output [31:0] o); begin o = v + 1; end endtask
  always @* t(a[3:0], y);`),
      'has no direction keyword',
    )
  })

  test('a LATER bare name still inherits the first port direction (Icarus: 194 104 15 142)', () => {
    // The direction is required on the FIRST port only — `input [7:0] p, q` is ordinary legal Verilog.
    expect(
      sweep(
        top(`  function [7:0] addk(input integer p, q); begin addk = p + q; end endfunction
  assign y = addk(9, 5) + a;`),
      ),
    ).toEqual([194, 104, 15, 142])
  })
})

describe('the sites that already worked still do', () => {
  test('a module-scope `integer` used as a plain variable (Icarus: 189 99 10 137)', () => {
    expect(
      sweep(
        topReg(`  integer i;
  always @* begin i = a + 9; y = i; end`),
      ),
    ).toEqual([189, 99, 10, 137])
  })

  test('a function-local `integer` (Icarus: 189 99 10 137)', () => {
    expect(
      sweep(
        top(`  function [7:0] f; input [7:0] v; integer t; begin t = v + 9; f = t; end endfunction
  assign y = f(a);`),
      ),
    ).toEqual([189, 99, 10, 137])
  })

  test('a task-local `integer` (Icarus: 189 99 10 137)', () => {
    expect(
      sweep(
        topReg(`  task t; input [7:0] v; output [31:0] o; integer s; begin s = v + 9; o = s; end endtask
  always @* t(a, y);`),
      ),
    ).toEqual([189, 99, 10, 137])
  })
})
