/**
 * The edge-triggered digital starter templates (D flip-flop, 4-bit register) capture on a clock EDGE and
 * hold between edges — driven exactly as the templates wire them: SPDT switches selecting V+ (1) or GND (0)
 * feeding the block, solved through the real dispatch with a persistent logic-state map (the flip-flop
 * memory the live canvas threads across re-solves). Flipping the clock switch 0→1 is one solve after the
 * other on the SAME state map — the app's own clocking path.
 */
import { describe, expect, test } from 'vitest'
import { BUILTIN_BLOCKS } from '../src/renderer/builtin-blocks.ts'
import { defaultParameters } from '../src/renderer/part-defaults.ts'
import { solveCanvasDispatch } from '../src/renderer/pipeline/solve-canvas.ts'

const V = () => ({
  ...defaultParameters('power_source'),
  nominal_voltage: { value: { kind: 'scalar', amount: 5, unit: 'volt' } },
})
const spdt = (bit: 0 | 1) => ({
  ...defaultParameters('switch_spdt'),
  position: { value: bit ? 'throw_a' : 'throw_b' },
})
// biome-ignore lint/suspicious/noExplicitAny: minimal React Flow node/edge shapes for the solve
type Any = any

const rails = (): { nodes: Any[]; edges: Any[] } => ({
  nodes: [
    {
      id: 'vdd',
      type: 'device',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: V() },
    },
    {
      id: 'g',
      type: 'device',
      position: { x: 0, y: 0 },
      data: { definition: 'ground', parameters: defaultParameters('ground') },
    },
  ],
  edges: [
    {
      id: 'vpn',
      type: 'net',
      source: 'vdd',
      sourceHandle: 'terminal_negative',
      target: 'g',
      targetHandle: 'reference_terminal',
    },
  ],
})
// An SPDT input feeding block.port: common→port, throw_a→V+, throw_b→GND.
function addInput(
  id: string,
  blk: string,
  port: string,
  bit: 0 | 1,
  nodes: Any[],
  edges: Any[],
): void {
  nodes.push({
    id,
    type: 'device',
    position: { x: 0, y: 0 },
    data: { definition: 'switch_spdt', parameters: spdt(bit) },
  })
  edges.push(
    {
      id: `${id}_c`,
      type: 'net',
      source: id,
      sourceHandle: 'common',
      target: blk,
      targetHandle: port,
    },
    {
      id: `${id}_a`,
      type: 'net',
      source: id,
      sourceHandle: 'throw_a',
      target: 'vdd',
      targetHandle: 'terminal_positive',
    },
    {
      id: `${id}_b`,
      type: 'net',
      source: id,
      sourceHandle: 'throw_b',
      target: 'g',
      targetHandle: 'reference_terminal',
    },
  )
}
const blk = (id: string, def: string): Any => ({
  id,
  type: 'block',
  position: { x: 0, y: 0 },
  data: { definition: 'block', block: BUILTIN_BLOCKS[def] },
})

/** Build the D-flip-flop template circuit for given D and CLK switch positions. */
function dff(d: 0 | 1, clk: 0 | 1): { nodes: Any[]; edges: Any[] } {
  const { nodes, edges } = rails()
  nodes.push(blk('FF', 'logic_d_flipflop'))
  addInput('swD', 'FF', 'd', d, nodes, edges)
  addInput('swK', 'FF', 'clk', clk, nodes, edges)
  edges.push(
    {
      id: 'ffv',
      type: 'net',
      source: 'vdd',
      sourceHandle: 'terminal_positive',
      target: 'FF',
      targetHandle: 'v_dd',
    },
    {
      id: 'ffg',
      type: 'net',
      source: 'FF',
      sourceHandle: 'gnd',
      target: 'g',
      targetHandle: 'reference_terminal',
    },
  )
  return { nodes, edges }
}

describe('edge-triggered digital templates capture on the clock edge', () => {
  test('D flip-flop: Q copies D on the rising edge, then holds while D changes', () => {
    const state = new Map<string, boolean>()
    const Q = (d: 0 | 1, clk: 0 | 1): number => {
      const c = dff(d, clk)
      const solved = solveCanvasDispatch(c.nodes, c.edges, undefined, undefined, state)
      return solved.terminalVolts.get('FF/q') ?? Number.NaN
    }
    // D=1, clock low then a rising edge → Q captures 1.
    Q(1, 0)
    expect(Q(1, 1)).toBeGreaterThan(4) // captured HIGH on the edge
    // Drop D to 0 with the clock still high (no new edge) → Q HOLDS 1.
    expect(Q(0, 1)).toBeGreaterThan(4)
    // Bring the clock low, then a fresh rising edge with D=0 → Q captures 0.
    Q(0, 0)
    expect(Q(0, 1)).toBeLessThan(1)
    // One more edge with D=1 → back to 1 (memory is re-writable).
    Q(1, 0)
    expect(Q(1, 1)).toBeGreaterThan(4)
  })

  test('4-bit register: the whole nibble latches on one edge and holds', () => {
    const state = new Map<string, boolean>()
    const bits = (a: 0 | 1, b: 0 | 1, cc: 0 | 1, dd: 0 | 1, clk: 0 | 1): number => {
      const { nodes, edges } = rails()
      nodes.push(blk('RG', 'logic_register_4bit'))
      addInput('d0', 'RG', 'd0', a, nodes, edges)
      addInput('d1', 'RG', 'd1', b, nodes, edges)
      addInput('d2', 'RG', 'd2', cc, nodes, edges)
      addInput('d3', 'RG', 'd3', dd, nodes, edges)
      addInput('swK', 'RG', 'clk', clk, nodes, edges)
      edges.push(
        {
          id: 'rgv',
          type: 'net',
          source: 'vdd',
          sourceHandle: 'terminal_positive',
          target: 'RG',
          targetHandle: 'v_dd',
        },
        {
          id: 'rgg',
          type: 'net',
          source: 'RG',
          sourceHandle: 'gnd',
          target: 'g',
          targetHandle: 'reference_terminal',
        },
      )
      const solved = solveCanvasDispatch(nodes, edges, undefined, undefined, state)
      const bit = (p: string) => ((solved.terminalVolts.get(`RG/${p}`) ?? 0) > 4 ? 1 : 0)
      return bit('q0') + 2 * bit('q1') + 4 * bit('q2') + 8 * bit('q3')
    }
    // Load 0101 = 5 on a rising edge.
    bits(1, 0, 1, 0, 0)
    expect(bits(1, 0, 1, 0, 1)).toBe(5)
    // Scramble the inputs to 1111 with the clock still high → the stored 5 HOLDS (no new edge).
    expect(bits(1, 1, 1, 1, 1)).toBe(5)
    // A fresh edge captures the new value 1111 = 15.
    bits(1, 1, 1, 1, 0)
    expect(bits(1, 1, 1, 1, 1)).toBe(15)
  })
})
