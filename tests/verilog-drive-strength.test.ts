/**
 * DRIVE STRENGTHS — `assign (strong1, strong0) y = a; assign (weak1, weak0) y = b;`
 *
 * Two drivers on one net are not always a contention. Verilog resolves them by the strength ladder
 * (supply > strong > pull > weak, with high-Z meaning the driver is ABSENT), and this importer used to refuse
 * every such design — and, worse, to publish a value for a LONE driver that could go to high-Z, where Verilog
 * reads z.
 *
 * EVERY expected value below was read off Icarus Verilog 14.0 (oss-cad-suite), never off this implementation.
 * The test bench swept each design over all 2^n input vectors with `{…, b, a} = i` and printed `%b`, so `x`
 * and `z` print as themselves rather than as 0 — a harness that folded them to 0 would score the three wrong
 * answers this work removes (a lone `(highz1, strong0)` driver) as passes.
 *
 * THE FACT THE WHOLE CONSTRUCT TURNS ON: a driver's strength is per SIDE — its 1-side applies while it drives
 * 1, its 0-side while it drives 0 — so which of two drivers wins depends on what each is currently driving.
 * `(strong1, weak0)` against `(weak1, strong0)` is 0, x, x, 1 over the four vectors: there is no winner to
 * rank. Several tests below exist only to pin that, because ranking the drivers once is the single most
 * likely way to turn a refusal into a wrong answer here.
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
const wire = (id: string, s: string, sh: string, t: string, th: string): CanvasEdgeLike => ({
  id,
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
})

function solve(
  block: BlockData,
  inputs: Record<string, boolean>,
  state: Map<string, boolean>,
): ReturnType<typeof simulateLogic> {
  const nodes: CanvasNodeLike[] = [
    { id: 'M', position: { x: 0, y: 0 }, data: { definition: 'block', block } },
    { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
    src('vp', 5),
  ]
  const edges: CanvasEdgeLike[] = [
    wire('ep', 'vp', 'terminal_positive', 'M', 'v_dd'),
    wire('eg', 'M', 'gnd', 'g', 'reference_terminal'),
    wire('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
  ]
  let k = 0
  for (const [port, value] of Object.entries(inputs)) {
    const id = `v${k++}`
    nodes.push(src(id, value ? 5 : 0))
    edges.push(wire(`e${id}`, id, 'terminal_positive', 'M', port))
    edges.push(wire(`e${id}n`, id, 'terminal_negative', 'g', 'reference_terminal'))
  }
  return simulateLogic(nodes, edges, state)
}

const said = (warnings: string[]): string => warnings.join(' | ')

/** A one-bit module over one-bit inputs, ports declared in the order given. */
const mod = (ins: string[], outs: string[], body: string): string =>
  `module top(${[...ins, ...outs].join(', ')}); ${ins.map((i) => `input ${i};`).join(' ')} ${outs
    .map((o) => `output ${o};`)
    .join(' ')} ${body} endmodule`

/**
 * Import `source` and read one output over all 2^n input vectors, vector `i` driving `ins[k]` from bit k —
 * the same order the Icarus bench used, so the expected strings below transcribe directly. Returns the
 * published bits as a string, or 'REFUSED' when no design was published at all.
 */
function answers(source: string, ins: string[], out: string): string {
  const { block, warnings } = importVerilog(source)
  if (block === null) return 'REFUSED'
  const ids = new Set(block.ports.map((p) => p.id))
  if (!ids.has(out)) return 'REFUSED'
  let bits = ''
  for (let vector = 0; vector < 1 << ins.length; vector++) {
    const inputs: Record<string, boolean> = {}
    ins.forEach((name, k) => {
      if (ids.has(name)) inputs[name] = ((vector >> k) & 1) === 1
    })
    const value = solve(block, inputs, new Map()).value('M', out)
    bits += value === undefined ? '?' : value ? '1' : '0'
    expect(value, `${out} has no value on vector ${vector} — ${said(warnings)}`).not.toBeUndefined()
  }
  return bits
}

/** The common shape: `module top(a, b, y)` with one body. */
const ab = (body: string): string => answers(mod(['a', 'b'], ['y'], body), ['a', 'b'], 'y')

describe('drive strengths: the stronger driver wins, and the design is built', () => {
  test('strong out-drives weak — the design this construct exists for', () => {
    // Icarus: 0,1,0,1 — y = a on all four vectors. This whole design used to be refused.
    expect(ab('assign (strong1, strong0) y = a; assign (weak1, weak0) y = b;')).toBe('0101')
  })

  test('the order the two drivers are written in does not change the winner', () => {
    // Icarus: 0,1,0,1 — still y = a. Picking "the one written first" would answer y = b here.
    expect(ab('assign (weak1, weak0) y = b; assign (strong1, strong0) y = a;')).toBe('0101')
  })

  test('the whole ladder: supply out-drives strong, pull out-drives weak', () => {
    // Icarus gives 0,1,0,1 for both — y = a.
    expect(ab('assign (supply1, supply0) y = a; assign (strong1, strong0) y = b;')).toBe('0101')
    expect(ab('assign (pull1, pull0) y = a; assign (weak1, weak0) y = b;')).toBe('0101')
  })

  test('the 0-side and 1-side keywords may be written in either order', () => {
    // Icarus on `(weak0, weak1)` vs `(strong0, strong1)`: 0,0,1,1 — y = b, the strong one.
    expect(ab('assign (weak0, weak1) y = a; assign (strong0, strong1) y = b;')).toBe('0011')
  })

  test('an UNANNOTATED assign is strong, not unknown and not weakest', () => {
    // Icarus: `assign y = a;` against `(weak1,weak0) y = b` gives 0,1,0,1 (y = a), and the mirror gives
    // 0,0,1,1 (y = b). Treating a plain assign as anything but strong/strong inverts both.
    expect(ab('assign y = a; assign (weak1, weak0) y = b;')).toBe('0101')
    expect(ab('assign (weak1, weak0) y = a; assign y = b;')).toBe('0011')
  })

  test('gate primitives carry a strength too', () => {
    // Icarus: 0,1,0,1 — y = a, the strong buffer.
    expect(ab('buf (strong1, strong0) g0(y, a); buf (weak1, weak0) g1(y, b);')).toBe('0101')
    // Icarus: 0,0,0,1 — y = a & b, the strong AND beating the weak buffer.
    expect(ab('and (strong1, strong0) g0(y, a, b); buf (weak1, weak0) g1(y, a);')).toBe('0001')
  })

  test('a NET DECLARATION carries a strength, and its keywords are not net names', () => {
    // `wire (weak1, weak0) t = a;` used to read `weak1` and `weak0` as two ordinary net names, with no
    // warning of any kind — the quietest way a strength was lost. Icarus on the first: 0,1,0,1 (t = a wins
    // strong over weak). On the second: 0,1,1,1 — t = a weakly, and y = t | b.
    expect(ab('wire (strong1, strong0) t = a; assign (weak1, weak0) t = b; assign y = t;')).toBe(
      '0101',
    )
    expect(ab('wire (weak1, weak0) t = a; assign y = t | b;')).toBe('0111')
  })

  test('a bus resolves bit by bit', () => {
    const source =
      'module top(a, b, y); input [3:0] a; input [3:0] b; output [3:0] y; assign (strong1, strong0) y = a; assign (weak1, weak0) y = b; endmodule'
    const { block, warnings } = importVerilog(source)
    expect(block, said(warnings)).not.toBeNull()
    // Icarus: y = a for every one of the 256 (a, b) vectors.
    for (let vector = 0; vector < 256; vector++) {
      const inputs: Record<string, boolean> = {}
      for (let i = 0; i < 4; i++) {
        inputs[`a[${i}]`] = ((vector >> i) & 1) === 1
        inputs[`b[${i}]`] = ((vector >> (i + 4)) & 1) === 1
      }
      const r = solve(block as BlockData, inputs, new Map())
      for (let i = 0; i < 4; i++)
        expect(r.value('M', `y[${i}]`), `y[${i}] on vector ${vector}`).toBe(
          ((vector >> i) & 1) === 1,
        )
    }
  })
})

describe('drive strengths: the winner depends on what each driver is DRIVING', () => {
  test('two drivers with no ranking at all read x on half the vectors, so the design refuses', () => {
    // MEASURED, Icarus: `(strong1, weak0)` against `(weak1, strong0)` gives 0, x, x, 1. Ranking the drivers
    // once — by the stronger side, the weaker side, or which came first — publishes y = a and is wrong on
    // the two middle vectors. This is the single most dangerous way to build this construct.
    expect(ab('assign (strong1, weak0) y = a; assign (weak1, strong0) y = b;')).toBe('REFUSED')
  })

  test('two drivers that TIE on the side that matters still read x', () => {
    // Icarus: 0,x,x,1 for both. `>=` where `>` was meant, or a de-duplication of two identical pairs,
    // publishes a value on half the vectors. Note the strong/strong pair raises no strength warning at all.
    expect(ab('assign (strong1, strong0) y = a; assign (strong1, strong0) y = b;')).toBe('REFUSED')
    expect(ab('assign (pull1, pull0) y = a; assign (pull1, pull0) y = b;')).toBe('REFUSED')
  })

  test('two IDENTICAL pairs can still resolve — on the side where one of them is stronger', () => {
    // Icarus: `(weak1, strong0)` twice gives 0,0,0,1 — a wired AND, because whichever driver is putting out
    // a 0 is strong and wins. `(strong1, weak0)` twice gives 0,1,1,1 — a wired OR, the mirror image. A rule
    // that compared the pairs and called them equal would refuse both, and one that ranked them would
    // publish y = a.
    expect(ab('assign (weak1, strong0) y = a; assign (weak1, strong0) y = b;')).toBe('0001')
    expect(ab('assign (strong1, weak0) y = a; assign (strong1, weak0) y = b;')).toBe('0111')
  })
})

describe('drive strengths: high-Z means the driver is ABSENT, not weakest', () => {
  test('a driver that goes high-Z on the side it drives leaves the net to the other one', () => {
    // Icarus: 0,1,1,1 — `y = a | b`. When a is 0 the (strong1, highz0) driver is not there at all, so the
    // weak driver has the net; when a is 1 it drives 1 and wins. That IS `a ? 1 : b`.
    expect(ab('assign (strong1, highz0) y = a; assign (weak1, weak0) y = b;')).toBe('0111')
    // Icarus: 0,1,1,1 again, with pull on the high-Z-sided driver.
    expect(ab('assign (pull1, highz0) y = a; assign (weak1, weak0) y = b;')).toBe('0111')
  })

  test('THE LIVE WRONG ANSWER THIS REMOVES: a lone high-Z-sided driver is refused, not published', () => {
    // MEASURED at the previous commit: all three of these published 0,1,0,1 — the value of `a` — where
    // Icarus Verilog 14.0 gives 0,z,0,z. Two bits of each were simply invented. A netlist with no z to
    // publish must refuse the net instead.
    expect(ab('assign (highz1, strong0) y = a;')).toBe('REFUSED')
    expect(ab('buf (highz1, strong0) g0(y, a);')).toBe('REFUSED')
    expect(ab('wire (highz1, strong0) y2 = a; assign y = y2;')).toBe('REFUSED')
  })

  test('the all-high-Z hole is found: two open-drain drivers are defined on 3 of 4 vectors', () => {
    // Icarus: 0,0,0,z. Two real open-drain drivers pull down or let go; when BOTH let go the net floats.
    // A pass that says "these drivers have a strict order, therefore this resolves" publishes on that
    // fourth vector — the hole is only visible by asking every combination of driver values.
    expect(ab('assign (highz1, strong0) y = a; assign (highz1, strong0) y = b;')).toBe('REFUSED')
    // The same hole with different 0-side strengths: Icarus 0,0,0,z.
    expect(ab('assign (highz1, weak0) y = a; assign (highz1, pull0) y = b;')).toBe('REFUSED')
  })
})

describe('drive strengths: three drivers', () => {
  test('a strong driver beats two weak ones', () => {
    // Icarus over {c,b,a}: 0,1,0,1,0,1,0,1 — y = a.
    const three = mod(
      ['a', 'b', 'c'],
      ['y'],
      'assign (strong1, strong0) y = a; assign (weak1, weak0) y = b; assign (weak1, weak0) y = c;',
    )
    expect(answers(three, ['a', 'b', 'c'], 'y')).toBe('01010101')
  })

  test('a CONSTANT driver wires straight through the resolution', () => {
    // Icarus: 0,0,0,0. The strong driver always puts out 0 and always wins, so the resolved function is
    // "whatever the strong driver has" — which is the constant. No constant folding is needed for that.
    expect(
      ab(
        "assign (weak1, weak0) y = a; assign (weak1, weak0) y = b; assign (strong1, strong0) y = 1'b0;",
      ),
    ).toBe('0000')
  })

  test('two open-drain drivers and a weak pull-up is an ordinary wired-OR bus', () => {
    // Icarus over {c,b,a}: 0,1,1,1,1,1,1,1 — y = a | b | c. Both strong drivers let go only when both are
    // driving 0, and then the weak one has the net.
    const bus = mod(
      ['a', 'b', 'c'],
      ['y'],
      'assign (strong1, highz0) y = a; assign (strong1, highz0) y = b; assign (weak1, weak0) y = c;',
    )
    expect(answers(bus, ['a', 'b', 'c'], 'y')).toBe('01111111')
  })

  test('more drivers than the enumeration covers refuses rather than guessing', () => {
    // Icarus gives y = a (the strong driver wins). Five drivers is past what this resolves, so it refuses —
    // a refusal is always allowed, a guess never is.
    const five = mod(
      ['a', 'b', 'c', 'd', 'e'],
      ['y'],
      'assign (strong1, strong0) y = a; assign (weak1, weak0) y = b; assign (weak1, weak0) y = c; assign (weak1, weak0) y = d; assign (weak1, weak0) y = e;',
    )
    expect(answers(five, ['a', 'b', 'c', 'd', 'e'], 'y')).toBe('REFUSED')
  })
})

describe('drive strengths: the doors a resolution must not be trusted through', () => {
  test('a driver the source wrote that was NOT built refuses the net', () => {
    // `assign (strong1, strong0) y = 1'bx;` builds no driver at all (an x has no value a two-valued net can
    // carry), leaving the weak driver alone on the net. Icarus reads y as x on all four vectors, because
    // the strong x still out-drives the weak b. Publishing y = b would be four invented bits.
    expect(ab("assign (strong1, strong0) y = 1'bx; assign (weak1, weak0) y = b;")).toBe('REFUSED')
  })

  test('a module that drives its own input port gets no strength resolution', () => {
    // Icarus: 0,x,x,1. Driving an input is illegal and reads x ON THE PORT, which this netlist cannot carry
    // — it keeps the value applied to the pin. Resolving strengths in such a module would work y out from
    // that kept value, so the resolution is withheld and the design refuses.
    expect(
      ab(
        'assign (strong1, strong0) y = a; assign (weak1, weak0) y = b; assign (strong1, strong0) a = b;',
      ),
    ).toBe('REFUSED')
  })

  test('a driver lost to a combinational loop refuses the net', () => {
    // Icarus: 0,1,1,1 — the weak self-driver loses and y = a | b. The loop guard drops that driver, which
    // leaves a driver set the strengths no longer describe, so the net is refused rather than resolved
    // among the survivors.
    expect(
      ab('wire t; assign (strong1, strong0) t = a; assign (weak1, weak0) t = t; assign y = t | b;'),
    ).toBe('REFUSED')
  })

  test('an always block that merely READS a resolved net is an ordinary consumer of it', () => {
    // The rule has to be precise in both directions. What an always block WRITES is left out of the
    // resolution (it carries no strength of its own, so the ladder would run over an incomplete set), but
    // what it READS is nothing of the kind — poisoning that would refuse every design downstream of a
    // resolved net. Icarus: 0,1,0,1 — y = a, the strong driver, with the block's register on the weak one.
    const source = mod(
      ['a', 'b'],
      ['y'],
      'reg r; always @(a or b) r = a & b; assign (weak1, weak0) y = r; assign (strong1, strong0) y = a;',
    )
    expect(answers(source, ['a', 'b'], 'y')).toBe('0101')
  })
})

describe('drive strengths: wired nets keep meaning what they mean', () => {
  test('`wor` and `wand` still COMBINE their drivers, whatever the strengths', () => {
    // Icarus: 0,1,1,1 for the wor (a | b) and 0,0,0,1 for the wand (a & b). A strength pass that ran first
    // and dropped the "weaker" driver would answer y = a for the wor — a brand-new wrong answer.
    expect(ab('wor y; assign (strong1, strong0) y = a; assign (weak1, weak0) y = b;')).toBe('0111')
    expect(ab('wand y; assign (strong1, strong0) y = a; assign (weak1, weak0) y = b;')).toBe('0001')
  })

  test('a wired net whose driver can go high-Z is refused, not combined', () => {
    // MEASURED at the previous commit: `wand t; assign (strong1, highz0) t = a; assign (weak1, weak0) t = b;
    // assign y = t;` published 0,0,0,1 (a & b) where Icarus gives 0,0,1,1 (t = b, because the high-Z driver
    // is absent whenever a is 0). The wired AND combines every driver unconditionally, which cannot be right
    // for a driver that has left the net — so the net is refused.
    expect(
      ab('wand t; assign (strong1, highz0) t = a; assign (weak1, weak0) t = b; assign y = t;'),
    ).toBe('REFUSED')
    expect(ab('wor y; assign (strong1, highz0) y = a; assign (weak1, weak0) y = b;')).toBe(
      'REFUSED',
    )
  })
})

describe('drive strengths across a module boundary', () => {
  const child = 'module sub(i, o); input i; output o; assign (%s1, %s0) o = i; endmodule'
  const top = (body: string): string =>
    `module top(a, b, y); input a; input b; output y; ${body} endmodule`
  const pair = (inner: string, outer: string): string =>
    `${child.replaceAll('%s', inner)}\n${top(`sub s0(.i(a), .o(y)); assign (${outer}1, ${outer}0) y = b;`)}`

  test("the child's driver contends at the parent's net, and its strength travels with it", () => {
    // Icarus: sub weak + top strong gives 0,0,1,1 (y = b); sub strong + top weak gives 0,1,0,1 (y = a).
    expect(answers(pair('weak', 'strong'), ['a', 'b'], 'y')).toBe('0011')
    expect(answers(pair('strong', 'weak'), ['a', 'b'], 'y')).toBe('0101')
  })

  test('two equal strengths across the boundary still read x', () => {
    // Icarus: 0,x,x,1. If the flattener dropped the child's strength the child would arrive as strong and
    // tie with the top's weak driver — and a sloppy tie-break would publish y = a.
    expect(answers(pair('weak', 'weak'), ['a', 'b'], 'y')).toBe('REFUSED')
  })
})

describe('drive strengths and the rest of the netlist', () => {
  test('a resolved net can feed a flip-flop', () => {
    // MEASURED, Icarus on a clocked bench: q clocks in the STRONG driver — 1 after an edge with a=1,b=0;
    // 0 after an edge with a=0,b=1; 1 after an edge with a=1,b=1.
    const { block, warnings } = importVerilog(
      'module top(clk, a, b, q); input clk; input a; input b; output q; wire t; assign (strong1, strong0) t = a; assign (weak1, weak0) t = b; reg r; always @(posedge clk) r <= t; assign q = r; endmodule',
    )
    expect(block, said(warnings)).not.toBeNull()
    const b = block as BlockData
    const state = new Map<string, boolean>()
    const edge = (a: boolean, bb: boolean): boolean | undefined => {
      solve(b, { clk: false, a, b: bb }, state)
      return solve(b, { clk: true, a, b: bb }, state).value('M', 'q')
    }
    expect(edge(true, false)).toBe(true)
    expect(edge(false, true)).toBe(false)
    expect(edge(true, true)).toBe(true)
  })

  test('a design with no drive strength anywhere is untouched, warnings and all', () => {
    const { block, warnings } = importVerilog(
      'module top(a, b, y); input [3:0] a; input [3:0] b; output [3:0] y; wire [3:0] t; assign t = a & b; assign y = t | a; endmodule',
    )
    expect(warnings).toEqual([])
    expect(block).not.toBeNull()
  })

  test('the default strength is still a no-op, and a real one is still reported', () => {
    const plain = importVerilog(mod(['a', 'b'], ['y'], 'and (strong1, strong0) g(y, a, b);'))
    expect(plain.warnings.some((w) => w.includes('drive strength'))).toBe(false)
    const weak = importVerilog(mod(['a', 'b'], ['y'], 'and (weak0, weak1) g(y, a, b);'))
    expect(weak.warnings.some((w) => w.includes('drive strength'))).toBe(true)
    // Icarus: a lone weak AND still puts out a & b — 0,0,0,1.
    expect(ab('and (weak0, weak1) g(y, a, b);')).toBe('0001')
  })

  test('a refused resolution names the net, the reason, and refuses the whole design', () => {
    const { block, warnings } = importVerilog(
      mod(['a', 'b'], ['y'], 'assign (highz1, strong0) y = a;'),
    )
    expect(block).toBeNull()
    expect(said(warnings)).toContain('the drive strengths of its drivers leave it x or high-Z')
    expect(said(warnings)).toContain('"y"')
    expect(said(warnings)).toContain('is NOT built')
  })

  test('each way a resolution can fail says which one it was', () => {
    const why = (body: string): string => said(importVerilog(mod(['a', 'b'], ['y'], body)).warnings)
    expect(why("assign (strong1, strong0) y = 1'bx; assign (weak1, weak0) y = b;")).toContain(
      'a driver the source wrote for it was not built',
    )
    expect(
      why(
        'assign (strong1, strong0) y = a; assign (weak1, weak0) y = b; assign (strong1, strong0) a = b;',
      ),
    ).toContain('drives an input port')
    expect(why('wor y; assign (strong1, highz0) y = a; assign (weak1, weak0) y = b;')).toContain(
      'a driver that can go to high-Z',
    )
    // Two drivers that simply have no winner never reach the resolution at all — they are an ordinary
    // contention, and the contention message already says exactly what is wrong with them.
    expect(why('assign (strong1, weak0) y = a; assign (weak1, strong0) y = b;')).toContain(
      'two drivers on one net read x in Verilog',
    )
  })
})
