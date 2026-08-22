/**
 * NOTHING THIS IMPORTER WALKS MAY RUN OUT OF STACK.
 *
 * An importer may refuse; it may never throw. A refusal names a construct and leaves the rest of the design
 * standing. `RangeError: Maximum call stack size exceeded` gives the reader no result and no reason, and it
 * moves: MEASURED in fresh processes on the working tree before this file existed, ONE shape — an if/else
 * ladder nested a thousand deep — threw from `elaborateBound`, from `collectMemWrites`, from `inFlight` and
 * from `expandTaskCalls` on different runs. The site is incidental; the class is that every walk over a
 * statement, an expression, a token span or a generate block was plain recursion with nothing measuring the
 * depth first.
 *
 * Each shape below was MEASURED throwing before its guard existed, at the depth its case names, in a fresh
 * process AND through the running app's own Synthesize path. Each is now answered — built, or refused by
 * name. None of these shapes is real RTL: the deepest statement tree the whole test suite builds is 30 (the
 * 8080's own core, measured), so every cap here sits far above anything a design writes. That is the point.
 * The importer is allowed to say no; it is not allowed to fall over.
 *
 * The SHALLOW half of each pair is what keeps the caps honest — a design under the cap still builds, and the
 * one whose answer can be checked cheaply is checked.
 */

import { describe, expect, test } from 'vitest'
import { importVerilog } from '../src/renderer/verilog-import.ts'

const nl = String.fromCharCode(10)
const said = (warnings: string[]): string => warnings.join(' | ')

/** Import without letting a throw escape, so a stack overflow reads as a failed expectation rather than a
 *  failed test file. */
const attempt = (source: string): { threw: string | undefined; parts: number; why: string } => {
  try {
    const r = importVerilog(source)
    return {
      threw: undefined,
      parts: r.block === null ? 0 : r.block.nodes.length,
      why: said(r.warnings),
    }
  } catch (e) {
    return { threw: String((e as Error)?.message ?? e), parts: 0, why: '' }
  }
}

const ifLadder = (n: number): string => {
  let body = "      y = 8'd255;"
  for (let k = n - 1; k >= 0; k--)
    body = `      if (a > 8'd${k & 255}) y = 8'd${(k * 3) & 255};${nl}      else begin${nl}${body}${nl}      end`
  return `module top(input [7:0] a, output reg [7:0] y);${nl}  always @* begin${nl}${body}${nl}  end${nl}endmodule`
}

const blockNest = (n: number): string => {
  let body = '    y = a;'
  for (let k = 0; k < n; k++) body = `    begin${nl}${body}${nl}    end`
  return `module top(input [7:0] a, output reg [7:0] y);${nl}  always @* begin${nl}${body}${nl}  end${nl}endmodule`
}

const caseItems = (n: number): string => {
  const items: string[] = []
  for (let k = 0; k < n; k++) items.push(`      12'd${k}: y = 8'd${(k * 7) & 255};`)
  return `module top(input [11:0] a, output reg [7:0] y);${nl}  always @* begin${nl}    case (a)${nl}${items.join(nl)}${nl}      default: y = 8'd0;${nl}    endcase${nl}  end${nl}endmodule`
}

const memoryLadder = (n: number): string => {
  let body = '      m[a[3:0]] <= a;'
  for (let k = n - 1; k >= 0; k--)
    body = `      if (a > 8'd${k & 255}) m[a[3:0]] <= 8'd${(k * 3) & 255};${nl}      else begin${nl}${body}${nl}      end`
  return `module top(input clk, input [7:0] a, output [7:0] y);${nl}  reg [7:0] m [0:15];${nl}  always @(posedge clk) begin${nl}${body}${nl}  end${nl}  assign y = m[0];${nl}endmodule`
}

const elseIfChain = (n: number): string => {
  const arms: string[] = []
  for (let k = 0; k < n; k++) arms.push(`if (a > 8'd${k & 255}) y = 8'd${(k * 3) & 255}; else`)
  return `module top(input [7:0] a, output reg [7:0] y);${nl}  always @* ${arms.join(' ')} y = 8'd255;${nl}endmodule`
}

const thenIfChain = (n: number): string => {
  const arms: string[] = []
  for (let k = 0; k < n; k++) arms.push(`if (a > 8'd${k & 255})`)
  return `module top(input [7:0] a, output reg [7:0] y);${nl}  always @* ${arms.join(' ')} y = 8'd255;${nl}endmodule`
}

const functionLadder = (n: number): string => {
  let body = "      f = 8'd255;"
  for (let k = n - 1; k >= 0; k--)
    body = `      if (v > 8'd${k & 255}) f = 8'd${(k * 3) & 255};${nl}      else begin${nl}${body}${nl}      end`
  return `module top(input [7:0] a, output [7:0] y);${nl}  function [7:0] f;${nl}    input [7:0] v;${nl}    begin${nl}${body}${nl}    end${nl}  endfunction${nl}  assign y = f(a);${nl}endmodule`
}

const taskLadder = (n: number): string => {
  let body = "      o = 8'd255;"
  for (let k = n - 1; k >= 0; k--)
    body = `      if (v > 8'd${k & 255}) o = 8'd${(k * 3) & 255};${nl}      else begin${nl}${body}${nl}      end`
  return `module top(input [7:0] a, output reg [7:0] y);${nl}  task t;${nl}    input [7:0] v;${nl}    output [7:0] o;${nl}    begin${nl}${body}${nl}    end${nl}  endtask${nl}  always @* begin${nl}    t(a, y);${nl}  end${nl}endmodule`
}

const parenNest = (n: number): string =>
  `module top(input [7:0] a, output [7:0] y);${nl}  assign y = ${'('.repeat(n)}a${')'.repeat(n)} + 8'd1;${nl}endmodule`

const braceNest = (n: number): string =>
  `module top(input [7:0] a, output [7:0] y);${nl}  assign y = ${'{'.repeat(n)}a${'}'.repeat(n)};${nl}endmodule`

const addChain = (n: number): string => {
  let e = 'a'
  for (let k = 0; k < n; k++) e = `${e} + 8'd1`
  return `module top(input [7:0] a, output [7:0] y);${nl}  assign y = ${e};${nl}endmodule`
}

const constParenNest = (n: number): string =>
  `module top(input [7:0] a, output [7:0] y);${nl}  localparam P = ${'('.repeat(n)}8'd7${')'.repeat(n)};${nl}  assign y = a + P;${nl}endmodule`

const generateNest = (n: number): string => {
  let body = '      assign y = a;'
  for (let k = n - 1; k >= 0; k--) body = `    if (1) begin : g${k}${nl}${body}${nl}    end`
  return `module top(input [7:0] a, output [7:0] y);${nl}  generate${nl}${body}${nl}  endgenerate${nl}endmodule`
}

const initialNest = (n: number): string => {
  let body = "      r = 8'd0;"
  for (let k = 0; k < n; k++) body = `    begin${nl}${body}${nl}    end`
  return `module top(input clk, input [7:0] a, output [7:0] y);${nl}  reg [7:0] r;${nl}  initial begin${nl}${body}${nl}  end${nl}  always @(posedge clk) r <= a;${nl}  assign y = r;${nl}endmodule`
}

const lhsBraceNest = (n: number): string =>
  `module top(input [7:0] a, output [7:0] y);${nl}  assign ${'{'.repeat(n)}y${'}'.repeat(n)} = a;${nl}endmodule`

const unrolledLoop = (n: number, op: string): string =>
  [
    `module top(input clk, input [7:0] a, output reg [7:0] y);`,
    '  integer i;',
    `  always @(${op === '<=' ? 'posedge clk' : '*'}) begin`,
    `    y ${op} a;`,
    `    for (i = 0; i < ${n}; i = i + 1) y ${op} y + 8'd1;`,
    '  end',
    'endmodule',
  ].join(nl)

const instanceChain = (n: number): string => {
  const mods: string[] = []
  for (let k = 0; k < n; k++)
    mods.push(
      `module m${k}(input [7:0] a, output [7:0] y);${nl}  m${k + 1} u(.a(a), .y(y));${nl}endmodule`,
    )
  mods.push(`module m${n}(input [7:0] a, output [7:0] y);${nl}  assign y = ~a;${nl}endmodule`)
  return `module top(input [7:0] a, output [7:0] y);${nl}  m0 u(.a(a), .y(y));${nl}endmodule${nl}${mods.join(nl)}`
}

const STATEMENT_CAP = 'statement nested more than 500 levels deep'
const EXPRESSION_CAP = 'expression nested more than 1000 levels deep'

describe('a statement tree past the cap is refused, never thrown', () => {
  const deep: [string, string][] = [
    ['an if/else ladder', ifLadder(600)],
    ['nested begin…end blocks', blockNest(600)],
    ['a case with more items than the cap', caseItems(600)],
    ['an if/else ladder writing a memory', memoryLadder(600)],
    ['an else-if chain', elseIfChain(600)],
    ['ifs nested in the then position', thenIfChain(600)],
    ['a function body', functionLadder(600)],
    ['a task body', taskLadder(600)],
  ]
  for (const [what, source] of deep) {
    test(`${what} names the depth`, () => {
      const r = attempt(source)
      expect(r.threw).toBe(undefined)
      expect(r.why).toContain(STATEMENT_CAP)
      expect(r.parts).toBe(0)
    })
  }

  test('the same shapes one level under the cap still build', () => {
    for (const source of [ifLadder(200), blockNest(400), caseItems(400), elseIfChain(400)]) {
      const r = attempt(source)
      expect(r.threw).toBe(undefined)
      expect(r.parts).toBeGreaterThan(0)
    }
  })
})

describe('a token span longer than any stack is scanned, not recursed', () => {
  // The span reader runs BEFORE the statement cap can apply — it is what hands the parser the block to
  // measure. MEASURED: both of these threw inside `statementSpanEnd` at 20,000 arms.
  test('an else-if chain 20,000 arms long is answered', () => {
    const r = attempt(elseIfChain(20000))
    expect(r.threw).toBe(undefined)
    expect(r.why).toContain(STATEMENT_CAP)
  })
  test('ifs nested 20,000 deep in the then position are answered', () => {
    const r = attempt(thenIfChain(20000))
    expect(r.threw).toBe(undefined)
    expect(r.why).toContain(STATEMENT_CAP)
  })
})

describe('an expression past the cap is refused, never thrown', () => {
  test('parentheses nested past the cap name the depth', () => {
    const r = attempt(parenNest(1200))
    expect(r.threw).toBe(undefined)
    expect(r.why).toContain(EXPRESSION_CAP)
  })
  test('braces nested past the cap name the depth', () => {
    const r = attempt(braceNest(3000))
    expect(r.threw).toBe(undefined)
    expect(r.why).toContain(EXPRESSION_CAP)
  })
  // `a + 1 + 1 + …` parses in a LOOP and nests only on the left, so the parser's own depth says nothing about
  // it — the built tree is what is too deep. MEASURED: this threw inside `bindCallsSharing`, which used to
  // walk the tree BEFORE anything measured it.
  test('a left-nested add chain names the depth', () => {
    const r = attempt(addChain(3000))
    expect(r.threw).toBe(undefined)
    expect(r.why).toContain(EXPRESSION_CAP)
  })
  test('the same expressions under the cap still build', () => {
    for (const source of [parenNest(500), braceNest(500), addChain(300)]) {
      const r = attempt(source)
      expect(r.threw).toBe(undefined)
      expect(r.parts).toBeGreaterThan(0)
    }
  })
})

describe('the other walks over a design answer too', () => {
  test('a constant expression nested past the cap is simply not constant', () => {
    const r = attempt(constParenNest(1200))
    expect(r.threw).toBe(undefined)
    expect(r.why).toContain('not a constant expression')
  })
  test('generate blocks nested past the cap name the depth', () => {
    const r = attempt(generateNest(120))
    expect(r.threw).toBe(undefined)
    expect(r.why).toContain('generate blocks nested more than 64 deep')
  })
  test('an initial block nested past the cap is not read as a power-on load', () => {
    const r = attempt(initialNest(120))
    expect(r.threw).toBe(undefined)
    expect(r.why).toContain('"initial" is a construct this importer does not build')
  })
  test('a module hierarchy past the cap names the depth', () => {
    const r = attempt(instanceChain(120))
    expect(r.threw).toBe(undefined)
    expect(r.why).toContain('nested more than 64 modules deep')
  })
  // The lvalue side had its own walk. MEASURED: 4,000 nested braces on the LEFT of an assign threw inside
  // `lhsBits`, which nothing else in the importer had a chance to guard — the target is read before any
  // expression exists.
  test('a concatenation target 8,000 braces deep is flattened, not recursed', () => {
    const r = attempt(lhsBraceNest(8000))
    expect(r.threw).toBe(undefined)
    expect(r.parts).toBeGreaterThan(0)
  })

  // Forward substitution walks the value it has accumulated, so an unrolled loop's iteration count IS a walk
  // depth. It is bounded by the unroll budget (4096 iterations in one block), and both forms are answered at
  // exactly that bound.
  test('a loop unrolled to the budget limit is answered, both = and <=', () => {
    const blocking = attempt(unrolledLoop(4096, '='))
    expect(blocking.threw).toBe(undefined)
    expect(blocking.why).toContain(EXPRESSION_CAP)
    const nonblocking = attempt(unrolledLoop(4096, '<='))
    expect(nonblocking.threw).toBe(undefined)
    expect(nonblocking.parts).toBeGreaterThan(0)
  })

  test('a generate nest and an instance chain under the caps still build', () => {
    for (const source of [generateNest(20), instanceChain(20), constParenNest(500)]) {
      const r = attempt(source)
      expect(r.threw).toBe(undefined)
      expect(r.parts).toBeGreaterThan(0)
    }
  })
})
