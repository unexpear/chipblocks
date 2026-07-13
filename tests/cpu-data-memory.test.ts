/**
 * The CPU on-ramp, increment 4 (final) — DATA MEMORY, all real gates on the fast logic engine. The
 * machine gains read/write memory (a 16-word × 4-bit gate RAM) and two instructions, LDA (load the
 * accumulator from memory) and STA (store it to memory), so it can keep variables and run real
 * algorithms. Two parts: (1) the RAM block on its own — writes land at the addressed word, reads
 * return them, and different addresses don't alias; (2) the CPU using it — a load/store roundtrip
 * that survives an accumulator clobber, non-aliasing locations, the top address, and the climax: a
 * multiply-by-repeated-addition loop whose counter and running product live in data memory.
 */

import { describe, expect, test } from 'vitest'
import type { BlockData, CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { buildCpu, buildDataRam, CPU_OPCODES, cpuInstr } from '../src/renderer/builtin-blocks.ts'
import { simulateLogic } from '../src/renderer/logic-sim.ts'

const supply = (volts: number) => ({
  nominal_voltage: { value: { kind: 'scalar', amount: volts, unit: 'volt' } },
})
const src = (id: string, hi: boolean): CanvasNodeLike => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition: 'power_source', parameters: supply(hi ? 5 : 0) },
})
const gnd = (id: string): CanvasNodeLike => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition: 'ground' },
})
const w = (id: string, s: string, sh: string, t: string, th: string): CanvasEdgeLike => ({
  id,
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
})

// ── the data RAM on its own ─────────────────────────────────────────────────────────────────────
/** Drive a buildDataRam block directly: write(addr,val) pulses the clock with WE high; read(addr) is
 *  a combinational read (WE low); tick() clocks with WE low (a hold). Persistent state = the memory. */
function ramDriver(addrBits = 4, dataBits = 4) {
  const ram = buildDataRam(addrBits, dataBits)
  const state = new Map<string, boolean>()
  const solve = (addr: number, din: number, we: boolean, clk: boolean): number => {
    const nodes: CanvasNodeLike[] = [
      { id: 'R', position: { x: 0, y: 0 }, data: { definition: 'block', block: ram } },
      src('vp', true),
      gnd('g'),
      src('vclk', clk),
      src('vwe', we),
    ]
    const edges: CanvasEdgeLike[] = [
      w('ep', 'vp', 'terminal_positive', 'R', 'v_dd'),
      w('eg', 'R', 'gnd', 'g', 'reference_terminal'),
      w('eclk', 'vclk', 'terminal_positive', 'R', 'clk'),
      w('ewe', 'vwe', 'terminal_positive', 'R', 'we'),
      w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
      w('eclkn', 'vclk', 'terminal_negative', 'g', 'reference_terminal'),
      w('ewen', 'vwe', 'terminal_negative', 'g', 'reference_terminal'),
    ]
    for (let i = 0; i < addrBits; i++) {
      nodes.push(src(`va${i}`, ((addr >> i) & 1) === 1))
      edges.push(w(`ea${i}`, `va${i}`, 'terminal_positive', 'R', `a${i}`))
      edges.push(w(`ean${i}`, `va${i}`, 'terminal_negative', 'g', 'reference_terminal'))
    }
    for (let b = 0; b < dataBits; b++) {
      nodes.push(src(`vd${b}`, ((din >> b) & 1) === 1))
      edges.push(w(`ed${b}`, `vd${b}`, 'terminal_positive', 'R', `din${b}`))
      edges.push(w(`edn${b}`, `vd${b}`, 'terminal_negative', 'g', 'reference_terminal'))
    }
    const r = simulateLogic(nodes, edges, state)
    let v = 0
    for (let b = 0; b < dataBits; b++) if (r.value('R', `dout${b}`) === true) v |= 1 << b
    return v
  }
  return {
    write: (addr: number, val: number) => {
      solve(addr, val, true, false)
      solve(addr, val, true, true)
    },
    read: (addr: number) => solve(addr, 0, false, false),
    tick: () => {
      solve(0, 0, false, false)
      solve(0, 0, false, true)
    },
  }
}

// ── the CPU using the memory ────────────────────────────────────────────────────────────────────
type Control = { reset?: boolean }
type State = { acc: number; out: number; pc: number; halt: boolean }

function cpuDriver(cpu: BlockData) {
  const state = new Map<string, boolean>()
  const step = (ctrl: Control, clk: boolean): State => {
    const nodes: CanvasNodeLike[] = [
      { id: 'C', position: { x: 0, y: 0 }, data: { definition: 'block', block: cpu } },
      src('vp', true),
      gnd('g'),
      src('vclk', clk),
      src('vrst', ctrl.reset ?? false),
    ]
    const edges: CanvasEdgeLike[] = [
      w('ep', 'vp', 'terminal_positive', 'C', 'v_dd'),
      w('eg', 'C', 'gnd', 'g', 'reference_terminal'),
      w('eclk', 'vclk', 'terminal_positive', 'C', 'clk'),
      w('erst', 'vrst', 'terminal_positive', 'C', 'reset'),
      w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
      w('eclkn', 'vclk', 'terminal_negative', 'g', 'reference_terminal'),
      w('erstn', 'vrst', 'terminal_negative', 'g', 'reference_terminal'),
    ]
    const r = simulateLogic(nodes, edges, state)
    const read = (prefix: string, bits: number) => {
      let v = 0
      for (let i = 0; i < bits; i++) if (r.value('C', `${prefix}${i}`) === true) v |= 1 << i
      return v
    }
    return {
      acc: read('acc', 4),
      out: read('out', 4),
      pc: read('pc', 4),
      halt: r.value('C', 'halt') === true,
    }
  }
  const clock = (ctrl: Control = {}): State => {
    step(ctrl, false)
    return step(ctrl, true)
  }
  return {
    clock,
    runUntilHalt: (maxClocks: number): { halted: boolean; clocks: number; state: State } => {
      let last: State = { acc: 0, out: 0, pc: 0, halt: false }
      for (let n = 1; n <= maxClocks; n++) {
        last = clock()
        if (last.halt) return { halted: true, clocks: n, state: last }
      }
      return { halted: false, clocks: maxClocks, state: last }
    },
  }
}

const prog = (...ops: [number, number?][]): number[] => ops.map(([op, n]) => cpuInstr(op, n))
const { HLT, LDI, ADD, SUB, OUT, JMP, JZ, LDA, STA } = CPU_OPCODES

describe('data RAM block — read/write memory in real gates', () => {
  test('writes land at the addressed word, reads return them, and addresses do not alias', () => {
    const m = ramDriver()
    m.write(3, 5)
    expect(m.read(3)).toBe(5)
    // distinct values at several addresses including 0 and the top address 15 — a decoder permutation
    // or a single wrong-word write would make at least one read wrong.
    const vals: [number, number][] = [
      [0, 9],
      [1, 2],
      [7, 14],
      [15, 6],
      [3, 5],
    ]
    for (const [a, v] of vals) m.write(a, v)
    for (const [a, v] of vals) expect(m.read(a)).toBe(v)
    // overwriting one word leaves a neighbour undisturbed
    m.write(7, 1)
    expect(m.read(7)).toBe(1)
    expect(m.read(15)).toBe(6)
    // a word holds its value across clocks while WE is low
    m.tick()
    m.tick()
    expect(m.read(0)).toBe(9)
  })
})

describe('CPU data memory — LDA and STA', () => {
  test('load/store roundtrip: a value survives in memory across an accumulator clobber', () => {
    // store 5 at MEM[3], clobber ACC with 9, load MEM[3] back → OUT 5 (it came from memory, not ACC).
    const d = cpuDriver(buildCpu(prog([LDI, 5], [STA, 3], [LDI, 9], [LDA, 3], [OUT], [HLT])))
    d.clock({ reset: true })
    const { halted, state } = d.runUntilHalt(60)
    expect(halted).toBe(true)
    expect(state.out).toBe(5)
  })

  test('two memory locations do not alias', () => {
    // 6 → MEM[2], 1 → MEM[7], then read MEM[2] → 6 (a decoder that aliased would show 1).
    const d = cpuDriver(
      buildCpu(prog([LDI, 6], [STA, 2], [LDI, 1], [STA, 7], [LDA, 2], [OUT], [HLT])),
    )
    d.clock({ reset: true })
    const { state } = d.runUntilHalt(60)
    expect(state.out).toBe(6)
  })

  test('store and load at the top memory address (15) exercises the full decoder', () => {
    const d = cpuDriver(buildCpu(prog([LDI, 4], [STA, 15], [LDI, 0], [LDA, 15], [OUT], [HLT])))
    d.clock({ reset: true })
    const { state } = d.runUntilHalt(60)
    expect(state.out).toBe(4)
  })

  test('STA leaves the accumulator intact', () => {
    // ACC = 7, STA 1 stores it; ACC must still be 7 (STA is not in the ACC-load set), so OUT = 7.
    const d = cpuDriver(buildCpu(prog([LDI, 7], [STA, 1], [OUT], [HLT])))
    d.clock({ reset: true })
    const { state } = d.runUntilHalt(60)
    expect(state.out).toBe(7)
  })

  test('LDA overwrites the accumulator with memory (an unwritten word reads 0)', () => {
    // ACC = 9, then LDA of a never-written word (MEM[5] = power-up 0) → ACC 0, OUT 0 (proves LDA
    // actually loaded memory rather than leaving ACC at 9).
    const d = cpuDriver(buildCpu(prog([LDI, 9], [LDA, 5], [OUT], [HLT])))
    d.clock({ reset: true })
    const { state } = d.runUntilHalt(60)
    expect(state.out).toBe(0)
  })

  test('the climax — multiply by repeated addition, counter and product held in data memory', () => {
    // 3 × 4 = 12. product = MEM[0], counter = MEM[1]. Each pass adds 3 to the product and decrements
    // the counter; JZ exits when the counter hits 0. A real loop whose state lives in memory (the
    // accumulator alone can't hold both the product and the counter).
    const p = prog(
      [LDI, 0],
      [STA, 0], // product = 0
      [LDI, 4],
      [STA, 1], // counter = 4
      [LDA, 0], // 4: (loop) load the product
      [ADD, 3],
      [STA, 0], //    product += 3
      [LDA, 1],
      [SUB, 1],
      [STA, 1], //    counter -= 1
      [JZ, 12], // 10: exit to 12 when the counter is 0
      [JMP, 4], // 11: else loop back to 4
      [LDA, 0], // 12: (done) load the product
      [OUT],
      [HLT],
    )
    const d = cpuDriver(buildCpu(p))
    d.clock({ reset: true })
    const { halted, clocks, state } = d.runUntilHalt(400)
    expect(halted).toBe(true) // the loop terminated
    expect(state.out).toBe(12) // 3 × 4
    expect(clocks).toBeLessThan(300) // 4 iterations, not a runaway
  })
})
