import { describe, expect, it } from 'vitest'
import {
  clampIndex,
  type FrameEdge,
  frameEdgeValues,
  frameLensRange,
  type WireNets,
} from '../src/renderer/timeline.ts'

describe('frameEdgeValues — a wire painted at one transient instant', () => {
  const wireNets: WireNets = new Map([['e1', { netA: 'n1', netB: 'n2' }]])
  const edges = [{ id: 'e1', data: { ohms: 5 } }]

  it('reads the branch current, direction, end voltages and I·R drop from the frame', () => {
    const frame = {
      nodes: new Map([
        ['n1', 5],
        ['n2', 4.9],
      ]),
      currents: new Map([['wire_e1/terminal_a', 0.02]]),
    }
    const fe = frameEdgeValues(frame, edges, wireNets).get('e1') as FrameEdge
    expect(fe.amps).toBeCloseTo(0.02, 9)
    expect(fe.sourceToTarget).toBe(true) // positive branch flows a → b
    expect(fe.carries).toBe(true)
    expect(fe.vSource).toBe(5)
    expect(fe.vTarget).toBe(4.9)
    expect(fe.drop).toBeCloseTo(0.02 * 5, 9) // |I|·R, a magnitude
  })

  it('a negative branch flips the flow direction (still a positive magnitude)', () => {
    const frame = {
      nodes: new Map([
        ['n1', 1],
        ['n2', 2],
      ]),
      currents: new Map([['wire_e1/terminal_a', -0.03]]),
    }
    const fe = frameEdgeValues(frame, edges, wireNets).get('e1') as FrameEdge
    expect(fe.amps).toBeCloseTo(0.03, 9)
    expect(fe.sourceToTarget).toBe(false)
    expect(fe.carries).toBe(true)
  })

  it('a wire with no recorded current reads as idle — no flow, no drop', () => {
    const frame = { nodes: new Map([['n1', 3]]), currents: new Map<string, number>() }
    const fe = frameEdgeValues(frame, edges, wireNets).get('e1') as FrameEdge
    expect(fe.amps).toBe(0)
    expect(fe.carries).toBe(false)
    expect(fe.drop).toBe(null)
    expect(fe.vSource).toBe(3)
    expect(fe.vTarget).toBe(null) // n2 absent at this frame
  })
})

describe('frameLensRange — the lens inputs across a frame', () => {
  it('spans the wire end voltages and the biggest live current', () => {
    const fe: Map<string, FrameEdge> = new Map([
      ['a', { amps: 0.01, sourceToTarget: true, carries: true, vSource: 0, vTarget: 9, drop: 0.1 }],
      [
        'b',
        { amps: 0.05, sourceToTarget: false, carries: true, vSource: 3, vTarget: 6, drop: 0.2 },
      ],
    ])
    const range = frameLensRange(fe)
    expect(range.vMin).toBe(0)
    expect(range.vMax).toBe(9)
    expect(range.maxAbsAmps).toBeCloseTo(0.05, 9)
  })

  it('an idle wire contributes no current; a no-voltage frame collapses to 0..0', () => {
    const fe: Map<string, FrameEdge> = new Map([
      [
        'a',
        {
          amps: 0.2,
          sourceToTarget: true,
          carries: false,
          vSource: null,
          vTarget: null,
          drop: null,
        },
      ],
    ])
    const range = frameLensRange(fe)
    expect(range.maxAbsAmps).toBe(0) // carries=false ⇒ ignored
    expect(range.vMin).toBe(0)
    expect(range.vMax).toBe(0)
  })
})

describe('clampIndex', () => {
  it('rounds and clamps a fractional playhead into the series', () => {
    expect(clampIndex(3.4, 10)).toBe(3)
    expect(clampIndex(3.6, 10)).toBe(4)
    expect(clampIndex(-2, 10)).toBe(0)
    expect(clampIndex(99, 10)).toBe(9)
    expect(clampIndex(5, 0)).toBe(0)
  })
})
