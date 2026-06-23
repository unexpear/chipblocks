import { describe, expect, test } from 'vitest'
import type { BlockData } from '../src/renderer/blocks.ts'
import { D_FLIPFLOP_BLOCK, INVERTER_BLOCK, NAND2_BLOCK } from '../src/renderer/builtin-blocks.ts'
import {
  characterizeGate,
  gateDelay,
  isClockedBlock,
  isSequentialBlock,
  traceTimingPaths,
} from '../src/renderer/timing-graph.ts'
import { analyzeTiming, type RegisterTiming } from '../src/static-timing.ts'

describe('isSequentialBlock — registers are the timing endpoints', () => {
  test('flip-flops / latches / registers are sequential; gates are not', () => {
    expect(isSequentialBlock('logic_d_flipflop')).toBe(true)
    expect(isSequentialBlock('logic_register_4bit')).toBe(true)
    expect(isSequentialBlock('logic_sr_latch')).toBe(true)
    expect(isSequentialBlock('logic_nand')).toBe(false)
    expect(isSequentialBlock('logic_not')).toBe(false)
  })
})

describe('isClockedBlock — the canvas identifies registers by their clock pin', () => {
  test('the real D flip-flop has a clock pin → sequential; gates do not', () => {
    // dropped blocks carry data.definition "block", so identification is structural, not by id
    expect(isClockedBlock(D_FLIPFLOP_BLOCK)).toBe(true)
    expect(isClockedBlock(INVERTER_BLOCK)).toBe(false)
    expect(isClockedBlock(NAND2_BLOCK)).toBe(false)
  })
})

describe('characterizeGate — real R_on + input C from the gate transistors', () => {
  test('the inverter at 5 V: output R is the weaker PMOS pull-up; input C = both gates', () => {
    const c = characterizeGate(INVERTER_BLOCK, 5)
    // PMOS pull-up R_on = 1/(0.0062·(5−2.5)) ≈ 64.5 Ω — worse than the ~13 Ω NMOS pull-down
    expect(c.outputResistance).toBeCloseTo(64.5, 0)
    // the input drives both the PMOS and NMOS gate: 2 × 60 pF C_iss
    expect(c.inputCapacitance.get('in')).toBeCloseTo(120e-12, 13)
  })

  test('the NAND presents an input capacitance on each of its two input pins', () => {
    const c = characterizeGate(NAND2_BLOCK, 5)
    expect(c.inputCapacitance.get('a')).toBeCloseTo(120e-12, 13)
    expect(c.inputCapacitance.get('b')).toBeCloseTo(120e-12, 13)
  })
})

describe('gateDelay — a real gate delay on a real fan-out', () => {
  test('an inverter driving four gate-inputs (120 pF each) + 10 pF wire → ~22 ns', () => {
    const t = gateDelay(INVERTER_BLOCK, 5, [120e-12, 120e-12, 120e-12, 120e-12], 10e-12)
    // ln2 · 64.5 Ω · (480 + 10) pF ≈ 21.9 ns
    expect(t).toBeCloseTo(21.9e-9, 9)
  })
})

const mockRegister: BlockData = {
  name: 'FF',
  origin: { x: 0, y: 0 },
  nodes: [],
  edges: [],
  ports: [
    { id: 'd', label: 'D', side: 'left', inner: { nodeId: 'x', handleId: 'in' } },
    { id: 'clk', label: 'CLK', side: 'left', inner: { nodeId: 'x', handleId: 'clk' } },
    { id: 'q', label: 'Q', side: 'right', inner: { nodeId: 'x', handleId: 'out' } },
  ],
}
const node = (id: string, definition: string, block: BlockData) => ({
  id,
  data: { definition, block },
})
const TRACE = { supplyVoltage: 5, wireCapacitance: 0, defaultInputCapacitance: 120e-12 }

describe('traceTimingPaths — register → gates → register', () => {
  test('a flip-flop through two inverters to a flip-flop = one path, both gates, summed delay', () => {
    const nodes = [
      node('r1', 'logic_d_flipflop', mockRegister),
      node('g1', 'logic_not', INVERTER_BLOCK),
      node('g2', 'logic_not', INVERTER_BLOCK),
      node('r2', 'logic_d_flipflop', mockRegister),
    ]
    const edges = [
      { source: 'r1', sourceHandle: 'q', target: 'g1', targetHandle: 'in' },
      { source: 'g1', sourceHandle: 'out', target: 'g2', targetHandle: 'in' },
      { source: 'g2', sourceHandle: 'out', target: 'r2', targetHandle: 'd' },
    ]
    const paths = traceTimingPaths(nodes, edges, TRACE)
    expect(paths).toHaveLength(1)
    expect(paths[0]?.from).toBe('r1')
    expect(paths[0]?.to).toBe('r2')
    expect(paths[0]?.gates).toEqual(['g1', 'g2'])
    // each inverter ≈ ln2 · 64.5 Ω · 120 pF ≈ 5.37 ns → ~10.7 ns total
    expect(paths[0]?.logicDelayMax).toBeCloseTo(10.73e-9, 9)
  })

  test('a combinational loop is guarded (it stops, it does not hang)', () => {
    const nodes = [
      node('r1', 'logic_d_flipflop', mockRegister),
      node('g1', 'logic_not', INVERTER_BLOCK),
      node('g2', 'logic_not', INVERTER_BLOCK),
    ]
    const edges = [
      { source: 'r1', sourceHandle: 'q', target: 'g1', targetHandle: 'in' },
      { source: 'g1', sourceHandle: 'out', target: 'g2', targetHandle: 'in' },
      { source: 'g2', sourceHandle: 'out', target: 'g1', targetHandle: 'in' }, // loop back
    ]
    // no register downstream of the loop → no path, and crucially no infinite recursion
    expect(traceTimingPaths(nodes, edges, TRACE)).toHaveLength(0)
  })

  test('the traced path feeds analyzeTiming → a real max frequency', () => {
    const nodes = [
      node('r1', 'logic_d_flipflop', mockRegister),
      node('g1', 'logic_not', INVERTER_BLOCK),
      node('r2', 'logic_d_flipflop', mockRegister),
    ]
    const edges = [
      { source: 'r1', sourceHandle: 'q', target: 'g1', targetHandle: 'in' },
      { source: 'g1', sourceHandle: 'out', target: 'r2', targetHandle: 'd' },
    ]
    const paths = traceTimingPaths(nodes, edges, TRACE)
    const reg: RegisterTiming = { clockToQ: 5e-9, setup: 2e-9, hold: 1e-9 }
    const report = analyzeTiming(paths, reg, 50e-9)
    // T_min = 5 + ~5.4 + 2 ≈ 12.4 ns → f_max ≈ 80 MHz
    expect(report.maxFrequency).toBeGreaterThan(50e6)
    expect(report.maxFrequency).toBeLessThan(120e6)
    expect(report.setupViolated).toBe(false)
  })
})
