import { describe, expect, it } from 'vitest'
import { createDebugSession } from '../src/renderer/verilog-debug.ts'
import { importVerilog } from '../src/renderer/verilog-import.ts'

function session(src: string) {
  const { block } = importVerilog(src)
  if (!block) throw new Error('module did not synthesize')
  const s = createDebugSession(block)
  if (!s) throw new Error('no debug session (no drivable inputs/outputs)')
  return s
}

describe('verilog step-debugger engine', () => {
  it('drives a combinational adder: sum equals a + b', () => {
    const s = session(
      'module add(input [3:0] a, input [3:0] b, output [4:0] s); assign s = a + b; endmodule',
    )
    expect(s.clockPortId).toBe(null) // no clock
    expect(s.inputs.map((x) => x.name).sort()).toEqual(['a', 'b'])
    expect(s.outputs.map((x) => x.name)).toEqual(['s'])

    s.setInputValue('a', 5)
    s.setInputValue('b', 3)
    s.step()
    expect(s.readValue('s')).toBe(8)

    s.setInputValue('a', 9)
    s.setInputValue('b', 6)
    s.step()
    expect(s.readValue('s')).toBe(15)
  })

  it('clocks a counter: it counts up one per rising edge, with a working sync reset', () => {
    const s = session(
      'module counter(input clk, input rst, output reg [3:0] count);' +
        " always @(posedge clk) if (rst) count <= 4'd0; else count <= count + 4'd1; endmodule",
    )
    expect(s.clockPortId).toBe('clk')
    expect(s.inputs.map((x) => x.name)).toEqual(['rst']) // clk is auto-pulsed, not a toggle
    expect(s.outputs[0]?.bits.length).toBe(4)

    s.reset()
    // Hold reset high for one edge → count forced to 0.
    s.setInput('rst', true)
    s.step()
    expect(s.readValue('count')).toBe(0)

    // Release reset and clock four times → 1, 2, 3, 4.
    s.setInput('rst', false)
    for (const expected of [1, 2, 3, 4]) {
      s.step()
      expect(s.readValue('count')).toBe(expected)
    }

    // Reset mid-count zeroes it again.
    s.setInput('rst', true)
    s.step()
    expect(s.readValue('count')).toBe(0)
  })

  it('reads individual bits and reports settled', () => {
    const s = session('module inv(input a, output y); assign y = ~a; endmodule')
    s.setInput('a', false)
    s.step()
    expect(s.read('y')).toBe(true)
    expect(s.settled).toBe(true)
    s.setInput('a', true)
    s.step()
    expect(s.read('y')).toBe(false)
  })

  it('returns null when there is nothing to drive', () => {
    const { block } = importVerilog('module empty(); endmodule')
    expect(block === null || createDebugSession(block) === null).toBe(true)
  })
})
