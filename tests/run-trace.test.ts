import { describe, expect, it } from 'vitest'
import { MAX_TRACE_CYCLES, runTrace } from '../src/renderer/run-trace.ts'
import { importVerilog } from '../src/renderer/verilog-import.ts'

function blockOf(src: string) {
  const { block } = importVerilog(src)
  if (!block) throw new Error('did not synthesize')
  return block
}

const COUNTER =
  'module counter(input clk, input rst, output reg [3:0] count);' +
  ' always @(posedge clk) if (rst) count <= 0; else count <= count + 1; endmodule'
const ADDER =
  'module add(input [3:0] a, input [3:0] b, output [4:0] s); assign s = a + b; endmodule'

describe('run-trace engine', () => {
  it('traces a free-running counter: +1 each cycle, every cycle settled', () => {
    const t = runTrace(blockOf(COUNTER), 6, new Map([['rst', 0]]))
    expect(t).not.toBeNull()
    if (!t) return
    expect(t.clocked).toBe(true)
    expect(t.registerCount).toBeGreaterThan(0)
    const counts = t.cycles.map((c) => c.values.get('count'))
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBe(((counts[i - 1] as number) + 1) % 16)
    }
    expect(t.cycles.every((c) => c.settled)).toBe(true)
    // a clean count has no false pulse/slow-cycle flags
    expect(t.anomalies.some((a) => a.kind === 'pulse')).toBe(false)
    expect(t.anomalies.some((a) => a.kind === 'slow-cycle')).toBe(false)
  })

  it('catches register-RELATIVE power-up dependence (XOR of two toggle flops), not just the two corners', () => {
    // Both flops toggle in lockstep, so all-0 and all-1 power-ups both give y=0 forever — a two-corner test
    // would miss it. But a mixed power-up (one flop 0, one 1) makes y=1 forever: the output genuinely needs
    // a reset. The multi-pattern sampling must flag it.
    const t = runTrace(
      blockOf(
        'module xt(input clk, output y); reg a; reg b;' +
          ' always @(posedge clk) begin a <= ~a; b <= ~b; end assign y = a ^ b; endmodule',
      ),
      4,
    )
    expect(t?.anomalies.some((a) => a.kind === 'power-up-dependent' && a.signal === 'y')).toBe(true)
  })

  it('flags a free-running counter (reset deasserted) as power-up dependent', () => {
    const t = runTrace(blockOf(COUNTER), 6, new Map([['rst', 0]]))
    // with no reset, the counter's value depends on the flip-flops' power-up state → needs a reset
    expect(t?.anomalies.some((a) => a.kind === 'power-up-dependent' && a.signal === 'count')).toBe(
      true,
    )
  })

  it('a held reset makes it deterministic and clean: count stays 0, zero anomalies', () => {
    const t = runTrace(blockOf(COUNTER), 6, new Map([['rst', 1]]))
    expect(t?.cycles.every((c) => c.values.get('count') === 0)).toBe(true)
    // no power-up dependence, AND no false slow-cycle flag on the cold-start cycle (which always costs
    // extra sweeps to power the flip-flops up — expected, not an anomaly).
    expect(t?.anomalies).toEqual([])
  })

  it('traces a combinational adder: no clock, s = a + b every cycle, no anomalies', () => {
    const t = runTrace(
      blockOf(ADDER),
      4,
      new Map([
        ['a', 5],
        ['b', 3],
      ]),
    )
    expect(t?.clocked).toBe(false)
    expect(t?.registerCount).toBe(0)
    expect(t?.cycles.every((c) => c.values.get('s') === 8)).toBe(true)
    expect(t?.anomalies).toEqual([])
  })

  it('caps cycles and returns null for a block with no drivable I/O', () => {
    const t = runTrace(blockOf(COUNTER), 9999, new Map([['rst', 1]]))
    expect(t?.cycles.length).toBe(MAX_TRACE_CYCLES)
    const { block } = importVerilog('module empty(); endmodule')
    expect(block === null || runTrace(block, 4) === null).toBe(true)
  })
})
