import { describe, expect, it } from 'vitest'
import { buildTimelineCausalReplay, buildTraceCausalReplay } from '../src/renderer/causal-replay.ts'
import { runTrace } from '../src/renderer/run-trace.ts'
import { importVerilog } from '../src/renderer/verilog-import.ts'

function blockOf(source: string) {
  const { block } = importVerilog(source)
  if (!block) throw new Error('did not synthesize')
  return block
}

describe('causal replay index', () => {
  it('maps digital output transitions to the block interface and real inner terminals', () => {
    const block = blockOf(
      'module counter(input clk, input rst, output reg [3:0] count);' +
        ' always @(posedge clk) if (rst) count <= 0; else count <= count + 1; endmodule',
    )
    const trace = runTrace(block, 4, new Map([['rst', 0]]))
    if (!trace) throw new Error('trace was not created')
    const replay = buildTraceCausalReplay(trace, block, { id: 'u_counter', label: 'Counter' })
    const transition = replay.events.find(
      (event) => event.kind === 'transition' && event.signal === 'count' && event.cycle === 2,
    )
    expect(transition).toMatchObject({
      domain: 'digital',
      from: 1,
      to: 2,
      nets: [
        'u_counter/count[0]',
        'u_counter/count[1]',
        'u_counter/count[2]',
        'u_counter/count[3]',
      ],
    })
    expect(transition?.sources[0]?.label).toBe('Counter')
    expect(transition?.sources[0]?.terminals?.length).toBe(4)
    expect(transition?.runtime).toMatchObject({
      domain: 'digital',
      state: 'complete',
      chain: { net: 'u_counter/count[0]', diagnosticIds: [] },
    })
    expect(transition?.why.path.map((step) => step.kind)).toEqual([
      'source',
      'terminal',
      'net',
      'device-state',
      'output',
    ])
  })

  it('indexes transient net and current transitions with connected parts', () => {
    const replay = buildTimelineCausalReplay(
      {
        status: 'solved',
        ground: 'gnd',
        warnings: [],
        series: [
          {
            time: 0,
            nodes: new Map([
              ['n1', 0],
              ['n2', 0],
            ]),
            currents: new Map([['wire_e1/terminal_a', 0]]),
          },
          {
            time: 1e-6,
            nodes: new Map([
              ['n1', 5],
              ['n2', 1],
            ]),
            currents: new Map([['wire_e1/terminal_a', 0.02]]),
          },
        ],
      },
      [
        {
          id: 'u1.r1',
          definition: 'resistor',
          connects: [{ net: 'n1', terminal: 'terminal_a' }],
        },
        {
          id: 'wire_e1',
          definition: 'wire',
          connects: [
            { net: 'n1', terminal: 'terminal_a' },
            { net: 'n2', terminal: 'terminal_b' },
          ],
        },
      ],
      new Map([['u1', 'Load block']]),
    )
    const netEvent = replay.events.find(
      (event) => event.kind === 'transition' && event.nets[0] === 'n1',
    )
    const currentEvent = replay.events.find((event) => event.kind === 'current-transition')
    expect(netEvent?.sources.map((source) => source.label)).toEqual(['Load block'])
    expect(currentEvent).toMatchObject({ nets: ['n1', 'n2'], from: 0, to: 0.02 })
    expect(currentEvent?.sources[0]?.id).toBe('wire_e1')
    expect(currentEvent?.runtime.chain.net).toBe('n1')
    expect(currentEvent?.why.observations[0]).toMatchObject({
      source: 'timeline',
      quantity: { value: 0.02, unit: 'ampere' },
    })
  })

  it('keeps solver status and warnings visible as diagnostics', () => {
    const replay = buildTimelineCausalReplay(
      { status: 'unsupported-element', ground: 'gnd', warnings: ['skipped coil'], series: [] },
      [],
    )
    expect(replay.transitionCount).toBe(0)
    expect(replay.diagnosticCount).toBe(2)
    expect(replay.events.map((event) => event.diagnostics[0]?.code)).toEqual([
      'transient-unsupported-element',
      'solver-warning',
    ])
    expect(replay.events[0]?.runtime.state).toBe('waiting')
    expect(replay.events[1]?.runtime.chain.diagnosticIds).toHaveLength(1)
  })
})
