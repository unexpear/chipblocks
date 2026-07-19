/**
 * Digital starter templates, batch 2 — the selection + counter set, driven exactly as the templates wire
 * them (SPDT switches → real gate blocks, solved through the dispatch). Combinational ones (decoder, mux)
 * check their full truth table; the gated D latch and the up-counter thread a persistent logic-state map
 * across solves — the app's clocking path — to prove level-sensitive transparency and edge counting.
 */
import { describe, expect, test } from 'vitest'
import { BUILTIN_BLOCKS } from '../src/renderer/builtin-blocks.ts'
import { defaultParameters } from '../src/renderer/part-defaults.ts'
import { solveCanvasDispatch } from '../src/renderer/pipeline/solve-canvas.ts'

const Vp = () => ({
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
      id: 'V1',
      type: 'device',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: Vp() },
    },
    {
      id: 'G',
      type: 'device',
      position: { x: 0, y: 0 },
      data: { definition: 'ground', parameters: defaultParameters('ground') },
    },
  ],
  edges: [
    {
      id: 'vpn',
      type: 'net',
      source: 'V1',
      sourceHandle: 'terminal_negative',
      target: 'G',
      targetHandle: 'reference_terminal',
    },
  ],
})
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
      target: 'V1',
      targetHandle: 'terminal_positive',
    },
    {
      id: `${id}_b`,
      type: 'net',
      source: id,
      sourceHandle: 'throw_b',
      target: 'G',
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
const powered = (id: string, edges: Any[]) =>
  edges.push(
    {
      id: `${id}_v`,
      type: 'net',
      source: 'V1',
      sourceHandle: 'terminal_positive',
      target: id,
      targetHandle: 'v_dd',
    },
    {
      id: `${id}_g`,
      type: 'net',
      source: id,
      sourceHandle: 'gnd',
      target: 'G',
      targetHandle: 'reference_terminal',
    },
  )
const hi = (v: number) => v > 4

describe('2-to-4 decoder lights exactly one output per address', () => {
  const oneHot = (a0: 0 | 1, a1: 0 | 1): string => {
    const { nodes, edges } = rails()
    nodes.push(blk('DC', 'logic_decoder_2_4'))
    addInput('sa0', 'DC', 'a0', a0, nodes, edges)
    addInput('sa1', 'DC', 'a1', a1, nodes, edges)
    powered('DC', edges)
    const solved = solveCanvasDispatch(nodes, edges)
    return [0, 1, 2, 3]
      .map((i) => (hi(solved.terminalVolts.get(`DC/y${i}`) ?? 0) ? '1' : '0'))
      .join('')
  }
  test('a0 is the LSB: 00→Y0, 01→Y1, 10→Y2, 11→Y3', () => {
    expect(oneHot(0, 0)).toBe('1000') // Y0
    expect(oneHot(1, 0)).toBe('0100') // Y1
    expect(oneHot(0, 1)).toBe('0010') // Y2
    expect(oneHot(1, 1)).toBe('0001') // Y3
  })
})

describe('2:1 multiplexer routes A or B by SEL', () => {
  // out = (A and not SEL) or (B and SEL): a NOT, two ANDs and an OR — the template's gate wiring.
  const muxOut = (a: 0 | 1, b: 0 | 1, sel: 0 | 1): boolean => {
    const { nodes, edges } = rails()
    nodes.push(
      blk('NOT', 'logic_not'),
      blk('AND1', 'logic_and'),
      blk('AND2', 'logic_and'),
      blk('OR', 'logic_or'),
    )
    addInput('swA', 'AND1', 'a', a, nodes, edges)
    addInput('swB', 'AND2', 'a', b, nodes, edges)
    addInput('swSel', 'NOT', 'in', sel, nodes, edges)
    edges.push(
      {
        id: 'sel2',
        type: 'net',
        source: 'swSel',
        sourceHandle: 'common',
        target: 'AND2',
        targetHandle: 'b',
      },
      {
        id: 'nsel',
        type: 'net',
        source: 'NOT',
        sourceHandle: 'out',
        target: 'AND1',
        targetHandle: 'b',
      },
      {
        id: 'o1',
        type: 'net',
        source: 'AND1',
        sourceHandle: 'out',
        target: 'OR',
        targetHandle: 'a',
      },
      {
        id: 'o2',
        type: 'net',
        source: 'AND2',
        sourceHandle: 'out',
        target: 'OR',
        targetHandle: 'b',
      },
    )
    for (const g of ['NOT', 'AND1', 'AND2', 'OR']) powered(g, edges)
    return hi(solveCanvasDispatch(nodes, edges).terminalVolts.get('OR/out') ?? 0)
  }
  test('SEL=0 passes A, SEL=1 passes B', () => {
    expect(muxOut(1, 0, 0)).toBe(true) // A=1 → out 1
    expect(muxOut(1, 0, 1)).toBe(false) // B=0 → out 0
    expect(muxOut(0, 1, 0)).toBe(false) // A=0 → out 0
    expect(muxOut(0, 1, 1)).toBe(true) // B=1 → out 1
  })
})

describe('gated D latch is transparent when enabled, frozen when not', () => {
  test('Q follows D while ENABLE is high, then holds when ENABLE drops', () => {
    const state = new Map<string, boolean>()
    const Q = (d: 0 | 1, e: 0 | 1): boolean => {
      const { nodes, edges } = rails()
      nodes.push(blk('DL', 'logic_d_latch'))
      addInput('swD', 'DL', 'd', d, nodes, edges)
      addInput('swE', 'DL', 'e', e, nodes, edges)
      powered('DL', edges)
      return hi(
        solveCanvasDispatch(nodes, edges, undefined, undefined, state).terminalVolts.get('DL/q') ??
          0,
      )
    }
    expect(Q(1, 1)).toBe(true) // enabled → Q tracks D=1
    expect(Q(0, 1)).toBe(false) // still enabled → Q tracks D=0
    Q(1, 1) // load 1 while enabled
    expect(Q(0, 0)).toBe(true) // ENABLE low → Q FROZEN at 1 though D dropped
    expect(Q(1, 0)).toBe(true) // still frozen (enable low) despite D=1
  })
})

describe('4-bit up-counter increments on each clock edge', () => {
  test('a register + a +1 adder loop counts 0,1,2,3,… as the clock is flipped', () => {
    const state = new Map<string, boolean>()
    let clk: 0 | 1 = 0
    const step = (): number => {
      const { nodes, edges } = rails()
      nodes.push(blk('RG', 'logic_register_4bit'), blk('AD', 'logic_adder_4bit'))
      nodes.push({
        id: 'swK',
        type: 'device',
        position: { x: 0, y: 0 },
        data: { definition: 'switch_spdt', parameters: spdt(clk) },
      })
      edges.push(
        {
          id: 'kc',
          type: 'net',
          source: 'swK',
          sourceHandle: 'common',
          target: 'RG',
          targetHandle: 'clk',
        },
        {
          id: 'ka',
          type: 'net',
          source: 'swK',
          sourceHandle: 'throw_a',
          target: 'V1',
          targetHandle: 'terminal_positive',
        },
        {
          id: 'kb',
          type: 'net',
          source: 'swK',
          sourceHandle: 'throw_b',
          target: 'G',
          targetHandle: 'reference_terminal',
        },
      )
      for (let i = 0; i < 4; i++) {
        edges.push(
          {
            id: `q${i}`,
            type: 'net',
            source: 'RG',
            sourceHandle: `q${i}`,
            target: 'AD',
            targetHandle: `a${i}`,
          },
          {
            id: `s${i}`,
            type: 'net',
            source: 'AD',
            sourceHandle: `s${i}`,
            target: 'RG',
            targetHandle: `d${i}`,
          },
        )
      }
      // adder B = 0001, carry-in low
      edges.push(
        {
          id: 'b0',
          type: 'net',
          source: 'V1',
          sourceHandle: 'terminal_positive',
          target: 'AD',
          targetHandle: 'b0',
        },
        {
          id: 'b1',
          type: 'net',
          source: 'AD',
          sourceHandle: 'b1',
          target: 'G',
          targetHandle: 'reference_terminal',
        },
        {
          id: 'b2',
          type: 'net',
          source: 'AD',
          sourceHandle: 'b2',
          target: 'G',
          targetHandle: 'reference_terminal',
        },
        {
          id: 'b3',
          type: 'net',
          source: 'AD',
          sourceHandle: 'b3',
          target: 'G',
          targetHandle: 'reference_terminal',
        },
        {
          id: 'cin',
          type: 'net',
          source: 'AD',
          sourceHandle: 'cin',
          target: 'G',
          targetHandle: 'reference_terminal',
        },
      )
      powered('RG', edges)
      powered('AD', edges)
      const solved = solveCanvasDispatch(nodes, edges, undefined, undefined, state)
      const bit = (p: string) => (hi(solved.terminalVolts.get(`RG/${p}`) ?? 0) ? 1 : 0)
      return bit('q0') + 2 * bit('q1') + 4 * bit('q2') + 8 * bit('q3')
    }
    const seen: number[] = []
    for (let i = 0; i < 8; i++) {
      clk = (i % 2) as 0 | 1 // 0,1,0,1,… — a rising edge every other step
      seen.push(step())
    }
    // Value holds while clock is low, increments on each 0→1 edge: 0,1,1,2,2,3,3,4
    expect(seen).toEqual([0, 1, 1, 2, 2, 3, 3, 4])
  })
})
