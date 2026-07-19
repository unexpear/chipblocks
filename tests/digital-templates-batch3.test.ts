/**
 * Digital starter templates, batch 3 — the ripple counter, wider decoder/encoders, and the 6T SRAM cell,
 * driven as the templates wire them (SPDT switches → real blocks, solved through the dispatch). The ripple
 * counter threads a persistent logic-state map (its chained flip-flops); the SRAM cell is transistor-level
 * and relies on the electro-thermal robust-solver fallback to converge its cross-coupled write.
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
const hi = (v: number) => v > 3

describe('4-bit ripple counter counts on each clock edge', () => {
  test('a chain of toggle flip-flops counts 0,1,2,3,… as the clock is flipped', () => {
    const state = new Map<string, boolean>()
    let clk: 0 | 1 = 0
    const step = (): number => {
      const { nodes, edges } = rails()
      nodes.push({
        id: 'swK',
        type: 'device',
        position: { x: 0, y: 0 },
        data: { definition: 'switch_spdt', parameters: spdt(clk) },
      })
      edges.push(
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
        {
          id: 'kc',
          type: 'net',
          source: 'swK',
          sourceHandle: 'common',
          target: 'FF0',
          targetHandle: 'clk',
        },
      )
      for (let i = 0; i < 4; i++) {
        nodes.push(blk(`FF${i}`, 'logic_d_flipflop'))
        edges.push({
          id: `t${i}`,
          type: 'net',
          source: `FF${i}`,
          sourceHandle: 'qbar',
          target: `FF${i}`,
          targetHandle: 'd',
        })
        powered(`FF${i}`, edges)
      }
      for (let i = 1; i < 4; i++)
        edges.push({
          id: `ck${i}`,
          type: 'net',
          source: `FF${i - 1}`,
          sourceHandle: 'qbar',
          target: `FF${i}`,
          targetHandle: 'clk',
        })
      const solved = solveCanvasDispatch(nodes, edges, undefined, undefined, state)
      const bit = (i: number) => (hi(solved.terminalVolts.get(`FF${i}/q`) ?? 0) ? 1 : 0)
      return bit(0) + 2 * bit(1) + 4 * bit(2) + 8 * bit(3)
    }
    const seen: number[] = []
    for (let i = 0; i < 8; i++) {
      clk = (i % 2) as 0 | 1
      seen.push(step())
    }
    expect(seen).toEqual([0, 1, 1, 2, 2, 3, 3, 4])
  })
})

describe('3-to-8 decoder lights one of eight outputs per address', () => {
  const oneHot = (a0: 0 | 1, a1: 0 | 1, a2: 0 | 1): number[] => {
    const { nodes, edges } = rails()
    nodes.push(blk('DC', 'logic_decoder_3_8'))
    addInput('sa0', 'DC', 'a0', a0, nodes, edges)
    addInput('sa1', 'DC', 'a1', a1, nodes, edges)
    addInput('sa2', 'DC', 'a2', a2, nodes, edges)
    powered('DC', edges)
    const solved = solveCanvasDispatch(nodes, edges)
    return [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => hi(solved.terminalVolts.get(`DC/y${i}`) ?? 0))
  }
  test('a0 is the LSB: exactly Y(address) is high', () => {
    expect(oneHot(0, 0, 0)).toEqual([0])
    expect(oneHot(1, 0, 1)).toEqual([5]) // 101 = 5
    expect(oneHot(1, 1, 1)).toEqual([7])
  })
})

describe('priority encoders output the index of the highest active input', () => {
  const encode4 = (active: number[]): { val: number; gs: boolean } => {
    const { nodes, edges } = rails()
    nodes.push(blk('EN', 'logic_encoder_4_2'))
    for (let i = 0; i < 4; i++)
      addInput(`i${i}`, 'EN', `i${i}`, active.includes(i) ? 1 : 0, nodes, edges)
    powered('EN', edges)
    const s = solveCanvasDispatch(nodes, edges)
    const b = (p: string) => (hi(s.terminalVolts.get(`EN/${p}`) ?? 0) ? 1 : 0)
    return { val: b('a0') + 2 * b('a1'), gs: hi(s.terminalVolts.get('EN/gs') ?? 0) }
  }
  test('4-to-2: single input encodes; multiple → highest wins; GS = any active', () => {
    expect(encode4([2])).toEqual({ val: 2, gs: true })
    expect(encode4([1, 3])).toEqual({ val: 3, gs: true }) // highest wins
    expect(encode4([])).toEqual({ val: 0, gs: false }) // nothing active
  })

  test('8-to-3: I5 encodes to 101, and a higher input overrides', () => {
    const encode8 = (active: number[]): { val: number; gs: boolean } => {
      const { nodes, edges } = rails()
      nodes.push(blk('EN', 'logic_encoder_8_3'))
      for (let i = 0; i < 8; i++)
        addInput(`i${i}`, 'EN', `i${i}`, active.includes(i) ? 1 : 0, nodes, edges)
      powered('EN', edges)
      const s = solveCanvasDispatch(nodes, edges)
      const b = (p: string) => (hi(s.terminalVolts.get(`EN/${p}`) ?? 0) ? 1 : 0)
      return { val: b('a0') + 2 * b('a1') + 4 * b('a2'), gs: hi(s.terminalVolts.get('EN/gs') ?? 0) }
    }
    expect(encode8([5])).toEqual({ val: 5, gs: true })
    expect(encode8([2, 5, 7])).toEqual({ val: 7, gs: true }) // highest wins
  })
})

describe('6T SRAM cell writes a bit through the transistor solve (robust-solver fallback)', () => {
  // WL high, the two complementary bit lines driven opposite (BL = data, BL̄ = its inverse); the
  // cross-coupled cell latches Q to the data. Pure analog (no logic gate) → electro-thermal + robust solve.
  const writeQ = (data: 0 | 1): { q: number; qbar: number } => {
    const { nodes, edges } = rails()
    nodes.push(blk('SR', 'memory_sram_cell'))
    addInput('swWL', 'SR', 'wl', 1, nodes, edges)
    addInput('swBL', 'SR', 'bl', data, nodes, edges)
    addInput('swBLB', 'SR', 'blb', data ? 0 : 1, nodes, edges)
    powered('SR', edges)
    const s = solveCanvasDispatch(nodes, edges)
    return {
      q: s.terminalVolts.get('SR/q') ?? Number.NaN,
      qbar: s.terminalVolts.get('SR/qbar') ?? Number.NaN,
    }
  }
  test('write 1 → Q high, Q̄ low', () => {
    const { q, qbar } = writeQ(1)
    expect(q).toBeGreaterThan(3)
    expect(qbar).toBeLessThan(1)
  })
  test('write 0 → Q low, Q̄ high', () => {
    const { q, qbar } = writeQ(0)
    expect(q).toBeLessThan(1)
    expect(qbar).toBeGreaterThan(3)
  })
})
