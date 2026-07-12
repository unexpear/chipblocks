/**
 * The CPU on-ramp, increment 1 — the FETCH ENGINE, all real clocked gates on the fast logic
 * engine (no code in the loop). What must be true: a program counter walks the instruction ROM
 * through the instruction register, so the machine READS A STORED PROGRAM out of memory in order,
 * one instruction per two-clock fetch cycle (T0 loads the IR, T1 advances the PC); a PC-load (a
 * JMP) redirects the fetch to a DIFFERENT address than the sequential successor; RESET homes the
 * PC to 0 even against a held load value; and the all-zero power-up boots cleanly to the first
 * instruction. Built by composing the existing loadable up-counter (PC), a decoder+OR-plane ROM,
 * a load-enable register (IR), and a binary T-state counter + decoder — a SAP-1-derived teaching
 * CPU (Malvino & Brown, "Digital Computer Electronics").
 */

import { describe, expect, test } from 'vitest'
import type { BlockData, CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { buildFetchEngine, CPU_DEMO_PROGRAM } from '../src/renderer/builtin-blocks.ts'
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

type Control = { reset?: boolean; loadpc?: boolean; pl?: number }

/** A fresh, isolated driver over one fetch-engine block (its own state Map — no cross-test
 *  coupling): clock() runs a CLK-low then a CLK-high solve, returning the IR word + PC. */
function driver(engine: BlockData) {
  const state = new Map<string, boolean>()
  const step = (ctrl: Control, clk: boolean): { ir: number; pc: number } => {
    const nodes: CanvasNodeLike[] = [
      { id: 'F', position: { x: 0, y: 0 }, data: { definition: 'block', block: engine } },
      src('vp', true),
      gnd('g'),
      src('vclk', clk),
      src('vrst', ctrl.reset ?? false),
      src('vldpc', ctrl.loadpc ?? false),
    ]
    const edges: CanvasEdgeLike[] = [
      w('ep', 'vp', 'terminal_positive', 'F', 'v_dd'),
      w('eg', 'F', 'gnd', 'g', 'reference_terminal'),
      w('eclk', 'vclk', 'terminal_positive', 'F', 'clk'),
      w('erst', 'vrst', 'terminal_positive', 'F', 'reset'),
      w('eldpc', 'vldpc', 'terminal_positive', 'F', 'loadpc'),
      w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
      w('eclkn', 'vclk', 'terminal_negative', 'g', 'reference_terminal'),
      w('erstn', 'vrst', 'terminal_negative', 'g', 'reference_terminal'),
      w('eldpcn', 'vldpc', 'terminal_negative', 'g', 'reference_terminal'),
    ]
    for (let i = 0; i < 4; i++) {
      nodes.push(src(`vpl${i}`, (((ctrl.pl ?? 0) >> i) & 1) === 1))
      edges.push(w(`epl${i}`, `vpl${i}`, 'terminal_positive', 'F', `pl${i}`))
      edges.push(w(`epln${i}`, `vpl${i}`, 'terminal_negative', 'g', 'reference_terminal'))
    }
    const r = simulateLogic(nodes, edges, state)
    let ir = 0
    for (let b = 0; b < 8; b++) if (r.value('F', `ir${b}`) === true) ir |= 1 << b
    let pc = 0
    for (let i = 0; i < 4; i++) if (r.value('F', `pc${i}`) === true) pc |= 1 << i
    return { ir, pc }
  }
  return {
    step,
    clock: (ctrl: Control = {}) => {
      step(ctrl, false)
      return step(ctrl, true)
    },
  }
}

describe('CPU fetch engine — a program counter walking an instruction ROM', () => {
  test('reads the stored program out of the ROM in order, T0 loads the IR then T1 advances the PC', () => {
    const d = driver(buildFetchEngine())
    d.clock({ reset: true }) // home PC = 0, T-counter = 0
    for (let k = 0; k < CPU_DEMO_PROGRAM.length; k++) {
      const t0 = d.clock() // T0: IR ← ROM[PC], PC not yet advanced
      expect(t0.ir).toBe(CPU_DEMO_PROGRAM[k]) // the instruction register presents program word k
      expect(t0.pc).toBe(k) // …and the PC has NOT incremented yet (distinguishes pc_en=T1 from T0)
      const t1 = d.clock() // T1: PC ← PC + 1, IR unchanged
      expect(t1.ir).toBe(CPU_DEMO_PROGRAM[k]) // IR still holds word k across the advance
      expect(t1.pc).toBe(k + 1) // the program counter has advanced past it
    }
  })

  test('the ROM holds the program in real gates: every one of the 16 addresses reads its word (0 past the program)', () => {
    // A distinct-per-address program so a shifted/stuck ROM bit or wrong address order is caught;
    // addresses past the program read 0 (a HLT). Walk the PC through all 16 addresses.
    const prog = [0x13, 0x24, 0x40, 0x51, 0x6a, 0x95, 0xc3, 0x3c]
    const d = driver(buildFetchEngine(prog))
    d.clock({ reset: true })
    for (let addr = 0; addr < 16; addr++) {
      const t0 = d.clock() // T0 latches ROM[addr]
      expect(t0.ir).toBe(prog[addr] ?? 0) // the ROM's OR-plane emits the right word (0 = unused)
      d.clock() // T1 advances the PC
    }
    // …and after address 15 the 4-bit PC wraps back to 0 (16 → 0), re-reading the first word.
    expect(d.clock().ir).toBe(prog[0])
  })

  test('a JMP (PC-load) redirects the fetch to a DIFFERENT address than the sequential next', () => {
    // Distinct words at every address so the jump target is unambiguous; jump BACKWARD to 0 (≠ the
    // sequential successor 2) with a multi-bit no-op control first, then a real multi-bit target.
    const prog = [0x13, 0x24, 0x40, 0x51, 0x6a, 0x95, 0xc3, 0x3c]
    const d = driver(buildFetchEngine(prog))
    d.clock({ reset: true })
    d.clock() // fetch 0 · T0 → IR = program[0]
    expect(d.clock().pc).toBe(1) // fetch 0 · T1 → PC = 1
    // A T1 with loadpc LOW must stay sequential (PC 1 → 2) — the load-vs-count control.
    d.clock() // fetch 1 · T0 → IR = program[1]
    const seq = d.clock({ loadpc: false, pl: 5 }) // T1: loadpc low, so PL is ignored → PC increments
    expect(seq.pc).toBe(2) // sequential: 1 + 1, NOT the PL value 5

    // Now genuinely jump: from PC=2, load a distinct address 5 (multi-bit PL = 0b0101).
    d.clock() // fetch 2 · T0 → IR = program[2]
    const jumped = d.clock({ loadpc: true, pl: 5 }) // T1 → PC ← 5 (jump), NOT 3
    expect(jumped.pc).toBe(5) // redirected to the jump target, not the sequential successor 3
    const t0 = d.clock() // T0 of the redirected fetch → IR ← ROM[5]
    expect(t0.ir).toBe(prog[5]) // fetched the jump target's word (0x95), proving redirection
    expect(prog[5]).not.toBe(prog[3]) // and it differs from the sequential word we skipped
  })

  test('RESET homes the PC to 0 even against a held load value', () => {
    // The reset gate (PC load value = PL AND NOT RESET) must win over a nonzero PL — so a RESET
    // arriving while the (future) control unit holds a JMP address still restarts at 0, not garbage.
    const d = driver(buildFetchEngine())
    d.clock() // advance the PC off zero
    d.clock()
    d.clock()
    expect(d.clock({ reset: true, loadpc: true, pl: 5 }).pc).toBe(0) // reset zeroes PL, homes PC
  })

  test('powers up cleanly on the all-zero state — the first instruction is fetched with no reset', () => {
    // A fresh engine (empty state Map = every flip-flop 0) is already at PC = 0, T-state 0, so it
    // fetches program[0] without any reset pulse — the binary-counter+decoder boots to T0, the
    // reason it is used instead of a one-hot ring (which would have an all-zero dead state).
    const d = driver(buildFetchEngine())
    expect(d.clock().ir).toBe(CPU_DEMO_PROGRAM[0]) // one clock from cold latches ROM[0]
  })
})
