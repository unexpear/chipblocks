/**
 * Stage 2 of the REAL control-unit build: the gate sub-blocks the calculator's datapath + FSM are made
 * of, each proven by its truth table through the fast logic engine (no code in the loop). Built only from
 * the existing AND/OR/NOT/NAND/D-flip-flop gates.
 */

import { describe, expect, test } from 'vitest'
import type { CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import {
  ACC_REGISTER_10,
  BUS_MUX_4,
  CALC_CONTROL_FSM,
  CALCULATOR,
  CALCULATOR_ADDSUB,
  COUNTER_UP_EN_4,
  DIVIDE_SEQUENCER,
  DIVIDER_10,
  DOWN_COUNTER_4,
  DOWN_COUNTER_EN_4,
  EDGE_DETECT_BLOCK,
  ENTRY_REGISTER_10,
  KEYPAD_ENCODER_BLOCK,
  MULDIV_CONTROLLER,
  MULTIPLIER_10,
  MULTIPLY_SEQUENCER,
  MUX2_1BIT,
  SIGN_FF_BLOCK,
} from '../src/renderer/builtin-blocks.ts'
import { compileLogic, simulateLogic, stepLogic } from '../src/renderer/logic-sim.ts'

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

describe('2:1 mux — OUT = SEL ? X : Y (real gates)', () => {
  const mux = (x: boolean, y: boolean, sel: boolean): boolean | undefined => {
    const nodes: CanvasNodeLike[] = [
      { id: 'M', position: { x: 0, y: 0 }, data: { definition: 'block', block: MUX2_1BIT } },
      src('vp', true),
      gnd('g'),
      src('vx', x),
      src('vy', y),
      src('vs', sel),
    ]
    const edges: CanvasEdgeLike[] = [
      w('ex', 'vx', 'terminal_positive', 'M', 'x'),
      w('ey', 'vy', 'terminal_positive', 'M', 'y'),
      w('es', 'vs', 'terminal_positive', 'M', 'sel'),
      w('ep', 'vp', 'terminal_positive', 'M', 'v_dd'),
      w('eg', 'M', 'gnd', 'g', 'reference_terminal'),
      w('exn', 'vx', 'terminal_negative', 'g', 'reference_terminal'),
      w('eyn', 'vy', 'terminal_negative', 'g', 'reference_terminal'),
      w('esn', 'vs', 'terminal_negative', 'g', 'reference_terminal'),
      w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    ]
    return simulateLogic(nodes, edges).value('M', 'out')
  }

  test('selects X when SEL=1, Y when SEL=0 (all four combinations)', () => {
    expect(mux(true, false, true)).toBe(true) // SEL=1 → X
    expect(mux(false, true, true)).toBe(false) // SEL=1 → X
    expect(mux(true, false, false)).toBe(false) // SEL=0 → Y
    expect(mux(false, true, false)).toBe(true) // SEL=0 → Y
  })

  test('full (x, y, sel) truth table — OUT is exactly the selected input', () => {
    for (const x of [false, true]) {
      for (const y of [false, true]) {
        for (const sel of [false, true]) {
          expect(mux(x, y, sel)).toBe(sel ? x : y)
        }
      }
    }
  })
})

describe('4-bit 2:1 bus mux — routes a whole nibble', () => {
  // X = 1010 (x3 x2 x1 x0), Y = 0101; SEL picks the bus. Read O0..O3.
  const busMux = (sel: boolean): number => {
    const nodes: CanvasNodeLike[] = [
      { id: 'M', position: { x: 0, y: 0 }, data: { definition: 'block', block: BUS_MUX_4 } },
      src('vp', true),
      gnd('g'),
      src('vs', sel),
    ]
    const xBits = [false, true, false, true] // 1010
    const yBits = [true, false, true, false] // 0101
    const edges: CanvasEdgeLike[] = [
      w('es', 'vs', 'terminal_positive', 'M', 'sel'),
      w('ep', 'vp', 'terminal_positive', 'M', 'v_dd'),
      w('eg', 'M', 'gnd', 'g', 'reference_terminal'),
      w('esn', 'vs', 'terminal_negative', 'g', 'reference_terminal'),
      w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    ]
    for (let i = 0; i < 4; i++) {
      nodes.push(src(`vx${i}`, xBits[i] === true))
      nodes.push(src(`vy${i}`, yBits[i] === true))
      edges.push(w(`ex${i}`, `vx${i}`, 'terminal_positive', 'M', `x${i}`))
      edges.push(w(`ey${i}`, `vy${i}`, 'terminal_positive', 'M', `y${i}`))
      edges.push(w(`exn${i}`, `vx${i}`, 'terminal_negative', 'g', 'reference_terminal'))
      edges.push(w(`eyn${i}`, `vy${i}`, 'terminal_negative', 'g', 'reference_terminal'))
    }
    const r = simulateLogic(nodes, edges)
    let out = 0
    for (let i = 0; i < 4; i++) if (r.value('M', `out${i}`) === true) out |= 1 << i
    return out
  }

  test('SEL=1 routes X (1010 = 10), SEL=0 routes Y (0101 = 5)', () => {
    expect(busMux(true)).toBe(0b1010)
    expect(busMux(false)).toBe(0b0101)
  })
})

describe('edge detect — exactly one pulse per rising edge of IN (held key fires once)', () => {
  // ONE persistent state map = the flip-flop's memory. A clock cycle is a CLK-low solve then a CLK-high
  // solve (master grabs IN, then slave updates the "last sample"); PULSE = IN AND NOT(last sample).
  const state = new Map<string, boolean>()
  const step = (inHi: boolean, clk: boolean): boolean | undefined => {
    const nodes: CanvasNodeLike[] = [
      {
        id: 'ED',
        position: { x: 0, y: 0 },
        data: { definition: 'block', block: EDGE_DETECT_BLOCK },
      },
      src('vp', true),
      gnd('g'),
      src('vi', inHi),
      src('vc', clk),
    ]
    const edges: CanvasEdgeLike[] = [
      w('ei', 'vi', 'terminal_positive', 'ED', 'in'),
      w('ec', 'vc', 'terminal_positive', 'ED', 'clk'),
      w('ep', 'vp', 'terminal_positive', 'ED', 'v_dd'),
      w('eg', 'ED', 'gnd', 'g', 'reference_terminal'),
      w('ein', 'vi', 'terminal_negative', 'g', 'reference_terminal'),
      w('ecn', 'vc', 'terminal_negative', 'g', 'reference_terminal'),
      w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    ]
    return simulateLogic(nodes, edges, state).value('ED', 'pulse')
  }

  test('rising IN gives one pulse; holding IN gives no further pulses', () => {
    // reset (IN low) → last sample = 0
    step(false, false)
    step(false, true)
    step(false, false)
    step(false, true)
    expect(step(true, false)).toBe(true) // IN rises → PULSE (IN=1, last=0)
    step(true, true) // clock samples IN → last=1
    expect(step(true, false)).toBe(false) // held → no second pulse (IN=1, last=1)
    step(true, true)
    expect(step(true, false)).toBe(false) // still held → still nothing
  })

  test('re-arms — a second, separate rising edge fires again', () => {
    // release IN and clock it through so the "last sample" returns to 0
    step(false, false)
    step(false, true)
    step(false, false)
    step(false, true)
    expect(step(true, false)).toBe(true) // fresh rising edge → pulse again
    step(true, true)
    expect(step(true, false)).toBe(false) // held → nothing
  })
})

describe('keypad encoder — one-hot 17 keys → BCD digit + op code + class lines', () => {
  const KEYS = [
    'k0',
    'k1',
    'k2',
    'k3',
    'k4',
    'k5',
    'k6',
    'k7',
    'k8',
    'k9',
    'kadd',
    'ksub',
    'kmul',
    'kdiv',
    'keq',
    'kclr',
    'kpm',
  ]
  // Drive all 17 key lines (the pressed one HIGH, the rest LOW) and read the encoded outputs.
  const readEncoder = (pressed: string) => {
    const nodes: CanvasNodeLike[] = [
      {
        id: 'E',
        position: { x: 0, y: 0 },
        data: { definition: 'block', block: KEYPAD_ENCODER_BLOCK },
      },
      src('vp', true),
      gnd('g'),
    ]
    const edges: CanvasEdgeLike[] = [
      w('ep', 'vp', 'terminal_positive', 'E', 'v_dd'),
      w('eg', 'E', 'gnd', 'g', 'reference_terminal'),
      w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    ]
    for (const k of KEYS) {
      nodes.push(src(`v_${k}`, k === pressed))
      edges.push(w(`e_${k}`, `v_${k}`, 'terminal_positive', 'E', k))
      edges.push(w(`en_${k}`, `v_${k}`, 'terminal_negative', 'g', 'reference_terminal'))
    }
    const r = simulateLogic(nodes, edges)
    const hi = (h: string) => r.value('E', h) === true
    let d = 0
    for (let i = 0; i < 4; i++) if (hi(`d${i}`)) d |= 1 << i
    let op = 0
    if (hi('op0')) op |= 1
    if (hi('op1')) op |= 2
    return {
      d,
      op,
      digit: hi('digit'),
      isOp: hi('is_op'),
      isEq: hi('is_eq'),
      isClr: hi('is_clr'),
      isPm: hi('is_pm'),
    }
  }

  test('each digit key encodes to its BCD value, with the DIGIT line and no op', () => {
    for (let i = 0; i <= 9; i++) {
      const r = readEncoder(`k${i}`)
      expect(r.d).toBe(i)
      expect(r.digit).toBe(true)
      expect(r.isOp).toBe(false)
      expect(r.isEq).toBe(false)
    }
  })

  test('operator keys encode to their 2-bit op code with IS_OP (and no DIGIT)', () => {
    expect(readEncoder('kadd')).toMatchObject({ op: 0, isOp: true, digit: false })
    expect(readEncoder('ksub')).toMatchObject({ op: 1, isOp: true, digit: false })
    expect(readEncoder('kmul')).toMatchObject({ op: 2, isOp: true, digit: false })
    expect(readEncoder('kdiv')).toMatchObject({ op: 3, isOp: true, digit: false })
  })

  test('equals / clear / ± each raise their own class line only', () => {
    expect(readEncoder('keq')).toMatchObject({ isEq: true, digit: false, isOp: false })
    expect(readEncoder('kclr')).toMatchObject({ isClr: true, isEq: false, digit: false })
    expect(readEncoder('kpm')).toMatchObject({ isPm: true, isEq: false, digit: false })
  })

  test('no key pressed → every output line is LOW', () => {
    expect(readEncoder('none')).toMatchObject({
      d: 0,
      op: 0,
      digit: false,
      isOp: false,
      isEq: false,
      isClr: false,
      isPm: false,
    })
  })
})

describe('loadable down-counter — load a value, count to zero, raise TC', () => {
  const state = new Map<string, boolean>()
  const step = (load: boolean, lval: number, clk: boolean): { count: number; tc: boolean } => {
    const nodes: CanvasNodeLike[] = [
      { id: 'C', position: { x: 0, y: 0 }, data: { definition: 'block', block: DOWN_COUNTER_4 } },
      src('vp', true),
      gnd('g'),
      src('vload', load),
      src('vclk', clk),
    ]
    const edges: CanvasEdgeLike[] = [
      w('eload', 'vload', 'terminal_positive', 'C', 'load'),
      w('eclk', 'vclk', 'terminal_positive', 'C', 'clk'),
      w('ep', 'vp', 'terminal_positive', 'C', 'v_dd'),
      w('eg', 'C', 'gnd', 'g', 'reference_terminal'),
      w('eloadn', 'vload', 'terminal_negative', 'g', 'reference_terminal'),
      w('eclkn', 'vclk', 'terminal_negative', 'g', 'reference_terminal'),
      w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    ]
    for (let i = 0; i < 4; i++) {
      nodes.push(src(`vl${i}`, ((lval >> i) & 1) === 1))
      edges.push(w(`el${i}`, `vl${i}`, 'terminal_positive', 'C', `l${i}`))
      edges.push(w(`eln${i}`, `vl${i}`, 'terminal_negative', 'g', 'reference_terminal'))
    }
    const r = simulateLogic(nodes, edges, state)
    let count = 0
    for (let i = 0; i < 4; i++) if (r.value('C', `q${i}`) === true) count |= 1 << i
    return { count, tc: r.value('C', 'tc') === true }
  }
  // one clock = a CLK-low solve (decrementer/mux settle, master grabs D) then a CLK-high solve (Q updates)
  const clock = (load: boolean, lval: number): { count: number; tc: boolean } => {
    step(load, lval, false)
    return step(load, lval, true)
  }

  test('loads 5, then counts 4,3,2,1,0 with TC asserting only at zero', () => {
    clock(true, 5) // LOAD 5
    expect(clock(false, 0)).toMatchObject({ count: 4, tc: false })
    expect(clock(false, 0)).toMatchObject({ count: 3, tc: false })
    expect(clock(false, 0)).toMatchObject({ count: 2, tc: false })
    expect(clock(false, 0)).toMatchObject({ count: 1, tc: false })
    expect(clock(false, 0)).toMatchObject({ count: 0, tc: true })
  })

  test('counts down through the full range from 15, wraps past zero, TC only at 0', () => {
    clock(true, 15) // LOAD 15
    for (let want = 14; want >= 0; want--) {
      expect(clock(false, 0)).toMatchObject({ count: want, tc: want === 0 })
    }
    expect(clock(false, 0).count).toBe(15) // 0 - 1 wraps to 15
  })

  test('LOAD overrides a count in progress', () => {
    clock(true, 9)
    clock(false, 0) // 8
    clock(false, 0) // 7
    expect(clock(true, 3).count).toBe(3) // reloaded mid-count
    expect(clock(false, 0).count).toBe(2)
  })

  test('latches every 4-bit load value exactly', () => {
    for (let v = 0; v <= 15; v++) expect(clock(true, v).count).toBe(v)
  })
})

describe('sign flip-flop — D = SIGN XOR TOGGLE (hold, flip, and ×/÷ sign resolution)', () => {
  const state = new Map<string, boolean>()
  const step = (toggle: boolean, clk: boolean): boolean | undefined => {
    const nodes: CanvasNodeLike[] = [
      { id: 'S', position: { x: 0, y: 0 }, data: { definition: 'block', block: SIGN_FF_BLOCK } },
      src('vp', true),
      gnd('g'),
      src('vt', toggle),
      src('vc', clk),
    ]
    const edges: CanvasEdgeLike[] = [
      w('et', 'vt', 'terminal_positive', 'S', 'toggle'),
      w('ec', 'vc', 'terminal_positive', 'S', 'clk'),
      w('ep', 'vp', 'terminal_positive', 'S', 'v_dd'),
      w('eg', 'S', 'gnd', 'g', 'reference_terminal'),
      w('etn', 'vt', 'terminal_negative', 'g', 'reference_terminal'),
      w('ecn', 'vc', 'terminal_negative', 'g', 'reference_terminal'),
      w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    ]
    return simulateLogic(nodes, edges, state).value('S', 'sign')
  }
  const clock = (toggle: boolean): boolean | undefined => {
    step(toggle, false)
    return step(toggle, true)
  }

  test('toggles the sign when TOGGLE is high, holds it when low', () => {
    clock(false) // settle to 0 (+)
    clock(false)
    expect(clock(true)).toBe(true) // ± → −
    expect(clock(false)).toBe(true) // hold → − (this is also ×/÷ by a positive: − XOR + = −)
    expect(clock(true)).toBe(false) // ± again → + (and ×/÷ by a negative: − XOR − = +)
    expect(clock(false)).toBe(false) // hold → +
  })

  test('SIGN is the running XOR of every toggle (the full sign rule)', () => {
    clock(false) // settle at + (0)
    clock(false)
    let model = false
    for (const t of [true, true, false, true, false, false, true, false, true, true, false, true]) {
      model = model !== t // XOR
      expect(clock(t)).toBe(model)
    }
  })
})

describe('calculator control FSM — the real clocked brain', () => {
  const state = new Map<string, boolean>()
  const LINES = ['digit', 'isop', 'iseq', 'isclr', 'op0', 'op1']
  const solveFsm = (inp: Record<string, boolean>, clk: boolean) => {
    const nodes: CanvasNodeLike[] = [
      { id: 'F', position: { x: 0, y: 0 }, data: { definition: 'block', block: CALC_CONTROL_FSM } },
      src('vp', true),
      gnd('g'),
      src('vclk', clk),
    ]
    const edges: CanvasEdgeLike[] = [
      w('eclk', 'vclk', 'terminal_positive', 'F', 'clk'),
      w('ep', 'vp', 'terminal_positive', 'F', 'v_dd'),
      w('eg', 'F', 'gnd', 'g', 'reference_terminal'),
      w('eclkn', 'vclk', 'terminal_negative', 'g', 'reference_terminal'),
      w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    ]
    for (const l of LINES) {
      nodes.push(src(`v_${l}`, inp[l] === true))
      edges.push(w(`e_${l}`, `v_${l}`, 'terminal_positive', 'F', l))
      edges.push(w(`en_${l}`, `v_${l}`, 'terminal_negative', 'g', 'reference_terminal'))
    }
    const r = simulateLogic(nodes, edges, state)
    const hi = (h: string) => r.value('F', h) === true
    return {
      entryNew: hi('entry_new'),
      entryAppend: hi('entry_append'),
      accFromEntry: hi('acc_from_entry'),
      compute: hi('compute'),
      opLatch: hi('op_latch'),
      clear: hi('clear'),
      add: hi('alu_add'),
      sub: hi('alu_sub'),
      mul: hi('alu_mul'),
      div: hi('alu_div'),
      fresh: hi('st_fresh'),
      opValid: hi('st_opvalid'),
      op: (hi('st_op0') ? 1 : 0) | (hi('st_op1') ? 2 : 0),
    }
  }
  // press a key: CLK-low solve captures the Mealy outputs (pre-edge), CLK-high commits the new state
  const press = (inp: Record<string, boolean>) => {
    const out = solveFsm(inp, false)
    const after = solveFsm(inp, true)
    return { ...out, fresh: after.fresh, opValid: after.opValid, op: after.op }
  }
  const digit = () => press({ digit: true })
  const pressOp = (code: number) =>
    press({ isop: true, op0: (code & 1) === 1, op1: (code & 2) === 2 })
  const eq = () => press({ iseq: true })
  const clr = () => press({ isclr: true })

  test('clear resets the state (fresh, no pending op)', () => {
    const r = clr()
    expect(r.clear).toBe(true)
    expect(r.fresh).toBe(true)
    expect(r.opValid).toBe(false)
    expect(r.op).toBe(0)
  })

  test('digit entry: the first digit is fresh, the next appends', () => {
    clr()
    const d1 = digit()
    expect(d1).toMatchObject({ entryNew: true, entryAppend: false, fresh: false })
    const d2 = digit()
    expect(d2).toMatchObject({ entryNew: false, entryAppend: true })
  })

  test('first operator copies ENTRY to ACC and latches the op (no compute)', () => {
    clr()
    digit()
    digit()
    const o = pressOp(1) // subtract
    expect(o.accFromEntry).toBe(true)
    expect(o.compute).toBe(false)
    expect(o.opLatch).toBe(true)
    expect(o.opValid).toBe(true) // after
    expect(o.op).toBe(1) // subtract latched
    expect(o.fresh).toBe(true)
  })

  test('equals computes ACC <op> ENTRY using the latched op', () => {
    clr()
    digit() // first operand
    pressOp(1) // subtract
    digit() // second operand (fresh)
    const e = eq()
    expect(e.compute).toBe(true)
    expect(e.sub).toBe(true)
    expect(e.add).toBe(false)
    expect(e.opValid).toBe(false) // op consumed
    expect(e.fresh).toBe(true)
  })

  test('chaining: a second operator computes the pending op, then latches the new one', () => {
    clr()
    digit()
    pressOp(0) // add
    digit()
    const o2 = pressOp(2) // multiply — should compute the pending ADD first
    expect(o2.compute).toBe(true)
    expect(o2.add).toBe(true) // executed op = the pending add
    expect(o2.opLatch).toBe(true)
    expect(o2.op).toBe(2) // multiply now latched
    expect(o2.opValid).toBe(true)
  })

  test('pressing an operator twice just changes the operator (no spurious compute)', () => {
    clr()
    digit()
    pressOp(0) // add
    const o2 = pressOp(1) // subtract, no new operand typed
    expect(o2.compute).toBe(false) // FRESH is set → no compute
    expect(o2.op).toBe(1) // operator changed to subtract
    expect(o2.opValid).toBe(true)
  })

  test('× and ÷ decode for the micro-sequencer', () => {
    clr()
    digit()
    pressOp(2) // ×
    digit()
    expect(eq()).toMatchObject({ compute: true, mul: true, div: false })
    clr()
    digit()
    pressOp(3) // ÷
    digit()
    expect(eq()).toMatchObject({ compute: true, div: true, mul: false })
  })
})

describe('calculator end-to-end — the REAL FSM driving a reference datapath (the contract)', () => {
  // The gate datapath (Stage 4) isn't built yet; this models it EXACTLY per the FSM's control contract.
  // THE CONTRACT: on COMPUTE the result is written to BOTH the accumulator AND the entry/display register,
  // so the displayed value is what continues — an operator pressed after '=' takes the result as its left
  // operand via ACC_FROM_ENTRY (entry already holds the result). This is the canonical 4-function design.
  const drive = (st: Map<string, boolean>, inp: Record<string, boolean>, clk: boolean) => {
    const nodes: CanvasNodeLike[] = [
      { id: 'F', position: { x: 0, y: 0 }, data: { definition: 'block', block: CALC_CONTROL_FSM } },
      src('vp', true),
      gnd('g'),
      src('vclk', clk),
    ]
    const edges: CanvasEdgeLike[] = [
      w('eclk', 'vclk', 'terminal_positive', 'F', 'clk'),
      w('ep', 'vp', 'terminal_positive', 'F', 'v_dd'),
      w('eg', 'F', 'gnd', 'g', 'reference_terminal'),
      w('eclkn', 'vclk', 'terminal_negative', 'g', 'reference_terminal'),
      w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    ]
    for (const l of ['digit', 'isop', 'iseq', 'isclr', 'op0', 'op1']) {
      nodes.push(src(`v_${l}`, inp[l] === true))
      edges.push(w(`e_${l}`, `v_${l}`, 'terminal_positive', 'F', l))
      edges.push(w(`en_${l}`, `v_${l}`, 'terminal_negative', 'g', 'reference_terminal'))
    }
    const r = simulateLogic(nodes, edges, st)
    const hi = (h: string) => r.value('F', h) === true
    return {
      entryNew: hi('entry_new'),
      entryAppend: hi('entry_append'),
      accFromEntry: hi('acc_from_entry'),
      compute: hi('compute'),
      clear: hi('clear'),
      add: hi('alu_add'),
      sub: hi('alu_sub'),
      mul: hi('alu_mul'),
      div: hi('alu_div'),
    }
  }
  const keyInputs = (k: string | number): { inp: Record<string, boolean>; d: number } => {
    if (typeof k === 'number') return { inp: { digit: true }, d: k }
    if (k === '+') return { inp: { isop: true }, d: 0 }
    if (k === '-') return { inp: { isop: true, op0: true }, d: 0 }
    if (k === '*') return { inp: { isop: true, op1: true }, d: 0 }
    if (k === '/') return { inp: { isop: true, op0: true, op1: true }, d: 0 }
    if (k === '=') return { inp: { iseq: true }, d: 0 }
    return { inp: { isclr: true }, d: 0 } // 'c'
  }
  // Run a key sequence through the real FSM + the reference datapath; return the displayed value (entry).
  const runSeq = (keys: Array<string | number>): number => {
    const st = new Map<string, boolean>()
    let entry = 0
    let acc = 0
    for (const k of keys) {
      const { inp, d } = keyInputs(k)
      const out = drive(st, inp, false) // CLK-low: read the Mealy control outputs (pre-edge)
      drive(st, inp, true) // CLK-high: commit the state transition
      if (out.clear) {
        entry = 0
        acc = 0
      } else if (out.compute) {
        const r = out.add
          ? acc + entry
          : out.sub
            ? acc - entry
            : out.mul
              ? acc * entry
              : Math.trunc(acc / entry)
        acc = r
        entry = r // THE CONTRACT: result → both acc and the displayed entry
      } else {
        if (out.accFromEntry) acc = entry
        if (out.entryNew) entry = d
        else if (out.entryAppend) entry = entry * 10 + d
      }
    }
    return entry
  }

  test('basic add and subtract', () => {
    expect(runSeq(['c', 5, '+', 3, '='])).toBe(8)
    expect(runSeq(['c', 5, '-', 3, '='])).toBe(2)
  })

  test('multi-digit operands: 12 + 34 = 46', () => {
    expect(runSeq(['c', 1, 2, '+', 3, 4, '='])).toBe(46)
  })

  test('continue from a result (the audit case): 5+3=+2= is 10, not 7', () => {
    expect(runSeq(['c', 5, '+', 3, '=', '+', 2, '='])).toBe(10)
    expect(runSeq(['c', 2, '*', 3, '=', '+', 4, '='])).toBe(10)
  })

  test('left-to-right chaining, no precedence: 5+3×2 = 16', () => {
    expect(runSeq(['c', 5, '+', 3, '*', 2, '='])).toBe(16)
  })

  test('pressing an operator twice just changes it: 5++3 = 8', () => {
    expect(runSeq(['c', 5, '+', '+', 3, '='])).toBe(8)
  })

  test('a fresh entry after a result starts a new calculation: 2×3= then 7+1= is 8', () => {
    expect(runSeq(['c', 2, '*', 3, '=', 7, '+', 1, '='])).toBe(8)
  })
})

describe('entry register — ×10 shift-insert, hold, clear, and result-load (real gates)', () => {
  const state = new Map<string, boolean>()
  const bcdBit = (val: number, i: number): boolean => {
    const digit = Math.floor(val / 10 ** Math.floor(i / 4)) % 10
    return ((digit >> (i % 4)) & 1) === 1
  }
  const solveReg = (ctrl: string, keypadDigit: number, resultVal: number, clk: boolean): number => {
    const nodes: CanvasNodeLike[] = [
      {
        id: 'R',
        position: { x: 0, y: 0 },
        data: { definition: 'block', block: ENTRY_REGISTER_10 },
      },
      src('vp', true),
      gnd('g'),
      src('vclk', clk),
    ]
    const edges: CanvasEdgeLike[] = [
      w('eclk', 'vclk', 'terminal_positive', 'R', 'clk'),
      w('ep', 'vp', 'terminal_positive', 'R', 'v_dd'),
      w('eg', 'R', 'gnd', 'g', 'reference_terminal'),
      w('eclkn', 'vclk', 'terminal_negative', 'g', 'reference_terminal'),
      w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    ]
    const addLine = (id: string, port: string, hi: boolean) => {
      nodes.push(src(id, hi))
      edges.push(w(`e_${id}`, id, 'terminal_positive', 'R', port))
      edges.push(w(`en_${id}`, id, 'terminal_negative', 'g', 'reference_terminal'))
    }
    addLine('cnew', 'entry_new', ctrl === 'new')
    addLine('capp', 'entry_append', ctrl === 'append')
    addLine('ccmp', 'compute', ctrl === 'compute')
    addLine('cclr', 'clear', ctrl === 'clear')
    for (let b = 0; b < 4; b++) addLine(`k${b}`, `keypad${b}`, ((keypadDigit >> b) & 1) === 1)
    for (let i = 0; i < 40; i++) addLine(`r${i}`, `result${i}`, bcdBit(resultVal, i))
    const r = simulateLogic(nodes, edges, state)
    let n = 0
    for (let d = 0; d < 10; d++) {
      let digit = 0
      for (let b = 0; b < 4; b++) if (r.value('R', `entry${d * 4 + b}`) === true) digit |= 1 << b
      n += digit * 10 ** d
    }
    return n
  }
  const step = (ctrl: string, keypadDigit = 0, resultVal = 0): number => {
    solveReg(ctrl, keypadDigit, resultVal, false)
    return solveReg(ctrl, keypadDigit, resultVal, true)
  }

  test('types 1234, holds, loads a result, appends onto it, clears', () => {
    expect(step('clear')).toBe(0)
    expect(step('new', 1)).toBe(1)
    expect(step('append', 2)).toBe(12)
    expect(step('hold')).toBe(12) // no control line → holds
    expect(step('append', 3)).toBe(123)
    expect(step('append', 4)).toBe(1234)
    expect(step('compute', 0, 456)).toBe(456) // COMPUTE loads the ALU result
    expect(step('append', 7)).toBe(4567) // 456 × 10 + 7
    expect(step('clear')).toBe(0)
    expect(step('new', 9)).toBe(9)
  })
})

describe('accumulator register — clear, load-from-entry, load-result, hold (real gates)', () => {
  const state = new Map<string, boolean>()
  const bcdBit = (val: number, i: number): boolean => {
    const digit = Math.floor(val / 10 ** Math.floor(i / 4)) % 10
    return ((digit >> (i % 4)) & 1) === 1
  }
  const solveAcc = (ctrl: string, entryVal: number, resultVal: number, clk: boolean): number => {
    const nodes: CanvasNodeLike[] = [
      { id: 'A', position: { x: 0, y: 0 }, data: { definition: 'block', block: ACC_REGISTER_10 } },
      src('vp', true),
      gnd('g'),
      src('vclk', clk),
    ]
    const edges: CanvasEdgeLike[] = [
      w('eclk', 'vclk', 'terminal_positive', 'A', 'clk'),
      w('ep', 'vp', 'terminal_positive', 'A', 'v_dd'),
      w('eg', 'A', 'gnd', 'g', 'reference_terminal'),
      w('eclkn', 'vclk', 'terminal_negative', 'g', 'reference_terminal'),
      w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    ]
    const addLine = (id: string, port: string, hi: boolean) => {
      nodes.push(src(id, hi))
      edges.push(w(`e_${id}`, id, 'terminal_positive', 'A', port))
      edges.push(w(`en_${id}`, id, 'terminal_negative', 'g', 'reference_terminal'))
    }
    addLine('cclr', 'clear', ctrl === 'clear')
    addLine('ccmp', 'compute', ctrl === 'compute')
    addLine('cafe', 'acc_from_entry', ctrl === 'afe')
    for (let i = 0; i < 40; i++) addLine(`y${i}`, `entry${i}`, bcdBit(entryVal, i))
    for (let i = 0; i < 40; i++) addLine(`r${i}`, `result${i}`, bcdBit(resultVal, i))
    const r = simulateLogic(nodes, edges, state)
    let n = 0
    for (let d = 0; d < 10; d++) {
      let digit = 0
      for (let b = 0; b < 4; b++) if (r.value('A', `acc${d * 4 + b}`) === true) digit |= 1 << b
      n += digit * 10 ** d
    }
    return n
  }
  const step = (ctrl: string, entryVal = 0, resultVal = 0): number => {
    solveAcc(ctrl, entryVal, resultVal, false)
    return solveAcc(ctrl, entryVal, resultVal, true)
  }

  test('clears, copies the entry, holds, loads a result', () => {
    expect(step('clear')).toBe(0)
    expect(step('afe', 12)).toBe(12) // ACC ← ENTRY (first operand)
    expect(step('hold', 99)).toBe(12) // no control line → holds (ignores entry)
    expect(step('compute', 0, 88)).toBe(88) // ACC ← ALU result
    expect(step('afe', 7)).toBe(7) // continue: ACC ← displayed value
    expect(step('clear')).toBe(0)
  })
})

describe('calculator (add/subtract) — the whole machine, end-to-end on real gates', () => {
  const ALLKEYS = [
    'k0',
    'k1',
    'k2',
    'k3',
    'k4',
    'k5',
    'k6',
    'k7',
    'k8',
    'k9',
    'kadd',
    'ksub',
    'kmul',
    'kdiv',
    'keq',
    'kclr',
    'kpm',
  ]
  const lineFor = (k: string | number): string => {
    if (typeof k === 'number') return `k${k}`
    switch (k) {
      case '+':
        return 'kadd'
      case '-':
        return 'ksub'
      case '*':
        return 'kmul'
      case '/':
        return 'kdiv'
      case '=':
        return 'keq'
      default:
        return 'kclr' // 'c'
    }
  }
  // Press a key sequence through the real assembled calculator; return the displayed value. Each press is
  // one clock edge (CLK-low solve then CLK-high solve) with the pressed key line HIGH and the rest LOW.
  const runCalc = (keys: Array<string | number>): number => {
    const state = new Map<string, boolean>()
    const solve = (active: string, clk: boolean): number => {
      const nodes: CanvasNodeLike[] = [
        {
          id: 'C',
          position: { x: 0, y: 0 },
          data: { definition: 'block', block: CALCULATOR_ADDSUB },
        },
        src('vp', true),
        gnd('g'),
        src('vclk', clk),
      ]
      const edges: CanvasEdgeLike[] = [
        w('eclk', 'vclk', 'terminal_positive', 'C', 'clk'),
        w('ep', 'vp', 'terminal_positive', 'C', 'v_dd'),
        w('eg', 'C', 'gnd', 'g', 'reference_terminal'),
        w('eclkn', 'vclk', 'terminal_negative', 'g', 'reference_terminal'),
        w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
      ]
      for (const key of ALLKEYS) {
        nodes.push(src(`s_${key}`, key === active))
        edges.push(w(`e_${key}`, `s_${key}`, 'terminal_positive', 'C', key))
        edges.push(w(`en_${key}`, `s_${key}`, 'terminal_negative', 'g', 'reference_terminal'))
      }
      const r = simulateLogic(nodes, edges, state)
      let n = 0
      for (let d = 0; d < 10; d++) {
        let dig = 0
        for (let b = 0; b < 4; b++) if (r.value('C', `entry${d * 4 + b}`) === true) dig |= 1 << b
        n += dig * 10 ** d
      }
      return n
    }
    let display = 0
    for (const k of keys) {
      const line = lineFor(k)
      solve(line, false) // CLK-low: control settles, masters grab
      display = solve(line, true) // CLK-high: FSM + registers commit
    }
    return display
  }

  test('12 + 34 = 46', () => {
    expect(runCalc(['c', 1, 2, '+', 3, 4, '='])).toBe(46)
  })
  test('5 − 3 = 2', () => {
    expect(runCalc(['c', 5, '-', 3, '='])).toBe(2)
  })
  test('carry across digits: 99 + 1 = 100', () => {
    expect(runCalc(['c', 9, 9, '+', 1, '='])).toBe(100)
  })
  test('continue from a result on real gates: 5 + 3 = + 2 = → 10', () => {
    expect(runCalc(['c', 5, '+', 3, '=', '+', 2, '='])).toBe(10)
  })
  test('a number then equals with no operator just shows the number', () => {
    expect(runCalc(['c', 7, '='])).toBe(7)
  })
})

describe('multiply sequencer — the ×/÷ control FSM steps through its states', () => {
  const state = new Map<string, boolean>()
  const solveSeq = (start: boolean, innerTc: boolean, outerTc: boolean, clk: boolean) => {
    const nodes: CanvasNodeLike[] = [
      {
        id: 'S',
        position: { x: 0, y: 0 },
        data: { definition: 'block', block: MULTIPLY_SEQUENCER },
      },
      src('vp', true),
      gnd('g'),
      src('vclk', clk),
      src('vstart', start),
      src('vitc', innerTc),
      src('votc', outerTc),
    ]
    const edges: CanvasEdgeLike[] = [
      w('eclk', 'vclk', 'terminal_positive', 'S', 'clk'),
      w('ep', 'vp', 'terminal_positive', 'S', 'v_dd'),
      w('eg', 'S', 'gnd', 'g', 'reference_terminal'),
      w('estart', 'vstart', 'terminal_positive', 'S', 'start'),
      w('eitc', 'vitc', 'terminal_positive', 'S', 'inner_tc'),
      w('eotc', 'votc', 'terminal_positive', 'S', 'outer_tc'),
      w('eclkn', 'vclk', 'terminal_negative', 'g', 'reference_terminal'),
      w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
      w('estartn', 'vstart', 'terminal_negative', 'g', 'reference_terminal'),
      w('eitcn', 'vitc', 'terminal_negative', 'g', 'reference_terminal'),
      w('eotcn', 'votc', 'terminal_negative', 'g', 'reference_terminal'),
    ]
    const r = simulateLogic(nodes, edges, state)
    const hi = (h: string) => r.value('S', h) === true
    return {
      pClear: hi('p_clear'),
      bLoad: hi('b_load'),
      outerLoad: hi('outer_load'),
      pShift: hi('p_shift'),
      innerLoad: hi('inner_load'),
      pAdd: hi('p_add'),
      innerDec: hi('inner_dec'),
      bShift: hi('b_shift'),
      outerDec: hi('outer_dec'),
      done: hi('done'),
    }
  }
  const press = (start: boolean, innerTc: boolean, outerTc: boolean) => {
    solveSeq(start, innerTc, outerTc, false)
    return solveSeq(start, innerTc, outerTc, true)
  }

  test('INIT → SHIFTP → ADD-loop → SHIFTB → CHECK → loop → DONE', () => {
    expect(press(true, false, false)).toMatchObject({ pClear: true, bLoad: true, outerLoad: true }) // → INIT
    expect(press(false, false, false)).toMatchObject({
      pShift: true,
      innerLoad: true,
      pClear: false,
    }) // → SHIFTP
    expect(press(false, false, false)).toMatchObject({ pAdd: true, innerDec: true }) // → ADD
    expect(press(false, false, false)).toMatchObject({ pAdd: true }) // ADD loops (inner ≠ 0)
    expect(press(false, true, false)).toMatchObject({ bShift: true, outerDec: true, pAdd: false }) // inner TC → SHIFTB
    expect(press(false, false, false)).toMatchObject({ pShift: false, pAdd: false, bShift: false }) // → CHECK (transient)
    expect(press(false, false, false)).toMatchObject({ pShift: true, innerLoad: true }) // outer ≠ 0 → back to SHIFTP
    // run one more digit's worth and let the outer counter finish
    press(false, false, false) // SHIFTP → ADD
    press(false, true, false) // inner TC → SHIFTB
    press(false, false, false) // → CHECK
    expect(press(false, false, true)).toMatchObject({ done: true }) // outer TC → DONE
    expect(press(false, false, false)).toMatchObject({ done: false }) // DONE → idle
  })
})

describe('down-counter with enable — counts only when EN is high', () => {
  const state = new Map<string, boolean>()
  const step = (
    load: boolean,
    lval: number,
    en: boolean,
    clk: boolean,
  ): { count: number; tc: boolean } => {
    const nodes: CanvasNodeLike[] = [
      {
        id: 'C',
        position: { x: 0, y: 0 },
        data: { definition: 'block', block: DOWN_COUNTER_EN_4 },
      },
      src('vp', true),
      gnd('g'),
      src('vload', load),
      src('ven', en),
      src('vclk', clk),
    ]
    const edges: CanvasEdgeLike[] = [
      w('eload', 'vload', 'terminal_positive', 'C', 'load'),
      w('een', 'ven', 'terminal_positive', 'C', 'en'),
      w('eclk', 'vclk', 'terminal_positive', 'C', 'clk'),
      w('ep', 'vp', 'terminal_positive', 'C', 'v_dd'),
      w('eg', 'C', 'gnd', 'g', 'reference_terminal'),
      w('eloadn', 'vload', 'terminal_negative', 'g', 'reference_terminal'),
      w('eenn', 'ven', 'terminal_negative', 'g', 'reference_terminal'),
      w('eclkn', 'vclk', 'terminal_negative', 'g', 'reference_terminal'),
      w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    ]
    for (let i = 0; i < 4; i++) {
      nodes.push(src(`vl${i}`, ((lval >> i) & 1) === 1))
      edges.push(w(`el${i}`, `vl${i}`, 'terminal_positive', 'C', `l${i}`))
      edges.push(w(`eln${i}`, `vl${i}`, 'terminal_negative', 'g', 'reference_terminal'))
    }
    const r = simulateLogic(nodes, edges, state)
    let count = 0
    for (let i = 0; i < 4; i++) if (r.value('C', `q${i}`) === true) count |= 1 << i
    return { count, tc: r.value('C', 'tc') === true }
  }
  const clock = (load: boolean, lval: number, en: boolean) => {
    step(load, lval, en, false)
    return step(load, lval, en, true)
  }

  test('loads 5, holds while EN low, counts down to 0 while EN high', () => {
    clock(true, 5, false) // LOAD 5
    expect(clock(false, 0, false)).toMatchObject({ count: 5 }) // EN low → hold
    expect(clock(false, 0, true)).toMatchObject({ count: 4 }) // EN high → count
    expect(clock(false, 0, false)).toMatchObject({ count: 4 }) // hold
    expect(clock(false, 0, true)).toMatchObject({ count: 3 })
    expect(clock(false, 0, true)).toMatchObject({ count: 2 })
    expect(clock(false, 0, true)).toMatchObject({ count: 1, tc: false })
    expect(clock(false, 0, true)).toMatchObject({ count: 0, tc: true })
  })
})

describe('up-counter with enable — increments only when EN high (divide quotient digit)', () => {
  const state = new Map<string, boolean>()
  const step = (load: boolean, lval: number, en: boolean, clk: boolean): number => {
    const nodes: CanvasNodeLike[] = [
      { id: 'C', position: { x: 0, y: 0 }, data: { definition: 'block', block: COUNTER_UP_EN_4 } },
      src('vp', true),
      gnd('g'),
      src('vload', load),
      src('ven', en),
      src('vclk', clk),
    ]
    const edges: CanvasEdgeLike[] = [
      w('eload', 'vload', 'terminal_positive', 'C', 'load'),
      w('een', 'ven', 'terminal_positive', 'C', 'en'),
      w('eclk', 'vclk', 'terminal_positive', 'C', 'clk'),
      w('ep', 'vp', 'terminal_positive', 'C', 'v_dd'),
      w('eg', 'C', 'gnd', 'g', 'reference_terminal'),
      w('eloadn', 'vload', 'terminal_negative', 'g', 'reference_terminal'),
      w('eenn', 'ven', 'terminal_negative', 'g', 'reference_terminal'),
      w('eclkn', 'vclk', 'terminal_negative', 'g', 'reference_terminal'),
      w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    ]
    for (let i = 0; i < 4; i++) {
      nodes.push(src(`vl${i}`, ((lval >> i) & 1) === 1))
      edges.push(w(`el${i}`, `vl${i}`, 'terminal_positive', 'C', `l${i}`))
      edges.push(w(`eln${i}`, `vl${i}`, 'terminal_negative', 'g', 'reference_terminal'))
    }
    const r = simulateLogic(nodes, edges, state)
    let count = 0
    for (let i = 0; i < 4; i++) if (r.value('C', `q${i}`) === true) count |= 1 << i
    return count
  }
  const clock = (load: boolean, lval: number, en: boolean) => {
    step(load, lval, en, false)
    return step(load, lval, en, true)
  }

  test('loads 0, counts up while EN high, holds while low, reloads', () => {
    clock(true, 0, false) // LOAD 0
    expect(clock(false, 0, true)).toBe(1)
    expect(clock(false, 0, true)).toBe(2)
    expect(clock(false, 0, false)).toBe(2) // hold
    expect(clock(false, 0, true)).toBe(3)
    clock(false, 0, true) // 4
    expect(clock(false, 0, true)).toBe(5)
    expect(clock(true, 9, false)).toBe(9) // reload to 9
  })
})

describe('multiplier — A × B on real gates (sequencer + reused datapath)', () => {
  const bcdBit = (val: number, i: number): boolean => {
    const digit = Math.floor(val / 10 ** Math.floor(i / 4)) % 10
    return ((digit >> (i % 4)) & 1) === 1
  }
  const runMul = (a: number, b: number): { product: number; done: boolean } => {
    const state = new Map<string, boolean>()
    const solve = (start: boolean, clk: boolean): { product: number; done: boolean } => {
      const nodes: CanvasNodeLike[] = [
        { id: 'M', position: { x: 0, y: 0 }, data: { definition: 'block', block: MULTIPLIER_10 } },
        src('vp', true),
        gnd('g'),
        src('vstart', start),
        src('vclk', clk),
      ]
      const edges: CanvasEdgeLike[] = [
        w('eclk', 'vclk', 'terminal_positive', 'M', 'clk'),
        w('estart', 'vstart', 'terminal_positive', 'M', 'start'),
        w('ep', 'vp', 'terminal_positive', 'M', 'v_dd'),
        w('eg', 'M', 'gnd', 'g', 'reference_terminal'),
        w('eclkn', 'vclk', 'terminal_negative', 'g', 'reference_terminal'),
        w('estartn', 'vstart', 'terminal_negative', 'g', 'reference_terminal'),
        w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
      ]
      for (let i = 0; i < 40; i++) {
        nodes.push(src(`a${i}`, bcdBit(a, i)))
        nodes.push(src(`b${i}`, bcdBit(b, i)))
        edges.push(w(`ea${i}`, `a${i}`, 'terminal_positive', 'M', `a${i}`))
        edges.push(w(`eb${i}`, `b${i}`, 'terminal_positive', 'M', `b${i}`))
        edges.push(w(`ean${i}`, `a${i}`, 'terminal_negative', 'g', 'reference_terminal'))
        edges.push(w(`ebn${i}`, `b${i}`, 'terminal_negative', 'g', 'reference_terminal'))
      }
      const r = simulateLogic(nodes, edges, state)
      let product = 0
      for (let d = 0; d < 10; d++) {
        let dig = 0
        for (let bb = 0; bb < 4; bb++)
          if (r.value('M', `product${d * 4 + bb}`) === true) dig |= 1 << bb
        product += dig * 10 ** d
      }
      return { product, done: r.value('M', 'done') === true }
    }
    solve(true, false) // START pulse: idle → INIT on this edge
    solve(true, true)
    let last = { product: 0, done: false }
    for (let i = 0; i < 120; i++) {
      solve(false, false)
      last = solve(false, true)
      if (last.done) break
    }
    return last
  }

  // A multi-cycle gate-level multiply runs ~40 clocked solves; allow plenty of time under full-suite load.
  test('12 × 12 = 144', () => {
    expect(runMul(12, 12)).toMatchObject({ product: 144, done: true })
  }, 30000)

  test('7 × 8 = 56', () => {
    expect(runMul(7, 8)).toMatchObject({ product: 56, done: true })
  }, 30000)
})

describe('divide sequencer — the ÷ control FSM steps through its states', () => {
  const state = new Map<string, boolean>()
  const solveSeq = (start: boolean, cout: boolean, outerTc: boolean, clk: boolean) => {
    const nodes: CanvasNodeLike[] = [
      { id: 'D', position: { x: 0, y: 0 }, data: { definition: 'block', block: DIVIDE_SEQUENCER } },
      src('vp', true),
      gnd('g'),
      src('vclk', clk),
      src('vstart', start),
      src('vcout', cout),
      src('votc', outerTc),
    ]
    const edges: CanvasEdgeLike[] = [
      w('eclk', 'vclk', 'terminal_positive', 'D', 'clk'),
      w('ep', 'vp', 'terminal_positive', 'D', 'v_dd'),
      w('eg', 'D', 'gnd', 'g', 'reference_terminal'),
      w('estart', 'vstart', 'terminal_positive', 'D', 'start'),
      w('ecout', 'vcout', 'terminal_positive', 'D', 'cout'),
      w('eotc', 'votc', 'terminal_positive', 'D', 'outer_tc'),
      w('eclkn', 'vclk', 'terminal_negative', 'g', 'reference_terminal'),
      w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
      w('estartn', 'vstart', 'terminal_negative', 'g', 'reference_terminal'),
      w('ecoutn', 'vcout', 'terminal_negative', 'g', 'reference_terminal'),
      w('eotcn', 'votc', 'terminal_negative', 'g', 'reference_terminal'),
    ]
    const r = simulateLogic(nodes, edges, state)
    const hi = (h: string) => r.value('D', h) === true
    return {
      rClear: hi('r_clear'),
      qClear: hi('q_clear'),
      aLoad: hi('a_load'),
      outerLoad: hi('outer_load'),
      rBringdown: hi('r_bringdown'),
      countLoad0: hi('count_load0'),
      rSub: hi('r_sub'),
      countInc: hi('count_inc'),
      qStore: hi('q_store'),
      aShift: hi('a_shift'),
      outerDec: hi('outer_dec'),
      done: hi('done'),
    }
  }
  const press = (start: boolean, cout: boolean, outerTc: boolean) => {
    solveSeq(start, cout, outerTc, false)
    return solveSeq(start, cout, outerTc, true)
  }

  test('INIT → BRINGDOWN → SUBTRACT-loop → STOREQ → SHIFTA → CHECK → loop → DONE', () => {
    expect(press(true, false, false)).toMatchObject({
      rClear: true,
      qClear: true,
      aLoad: true,
      outerLoad: true,
    })
    expect(press(false, false, false)).toMatchObject({
      rBringdown: true,
      countLoad0: true,
      rClear: false,
    }) // BRINGDOWN
    expect(press(false, true, false)).toMatchObject({ rSub: true, countInc: true }) // SUBTRACT (remainder ≥ divisor)
    expect(press(false, true, false)).toMatchObject({ rSub: true }) // subtract loops
    expect(press(false, false, false)).toMatchObject({ qStore: true, rSub: false }) // remainder < divisor → STOREQ
    expect(press(false, false, false)).toMatchObject({ aShift: true, outerDec: true }) // SHIFTA
    expect(press(false, false, false)).toMatchObject({ aShift: false }) // CHECK (transient)
    expect(press(false, false, false)).toMatchObject({ rBringdown: true }) // outer ≠ 0 → next digit
    // run one more digit (quotient 0 here) and finish
    press(false, false, false) // BRINGDOWN → SUBTRACT
    press(false, false, false) // cout=0 → STOREQ
    press(false, false, false) // → SHIFTA
    press(false, false, false) // → CHECK
    expect(press(false, false, true)).toMatchObject({ done: true }) // outer TC → DONE
  })
})

describe('divider — A ÷ B on real gates (sequencer + reused datapath)', () => {
  const bcdBit = (val: number, i: number): boolean => {
    const digit = Math.floor(val / 10 ** Math.floor(i / 4)) % 10
    return ((digit >> (i % 4)) & 1) === 1
  }
  const runDiv = (a: number, b: number): { quotient: number; remainder: number; done: boolean } => {
    const state = new Map<string, boolean>()
    const solve = (start: boolean, clk: boolean) => {
      const nodes: CanvasNodeLike[] = [
        { id: 'D', position: { x: 0, y: 0 }, data: { definition: 'block', block: DIVIDER_10 } },
        src('vp', true),
        gnd('g'),
        src('vstart', start),
        src('vclk', clk),
      ]
      const edges: CanvasEdgeLike[] = [
        w('eclk', 'vclk', 'terminal_positive', 'D', 'clk'),
        w('estart', 'vstart', 'terminal_positive', 'D', 'start'),
        w('ep', 'vp', 'terminal_positive', 'D', 'v_dd'),
        w('eg', 'D', 'gnd', 'g', 'reference_terminal'),
        w('eclkn', 'vclk', 'terminal_negative', 'g', 'reference_terminal'),
        w('estartn', 'vstart', 'terminal_negative', 'g', 'reference_terminal'),
        w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
      ]
      for (let i = 0; i < 40; i++) {
        nodes.push(src(`a${i}`, bcdBit(a, i)))
        nodes.push(src(`b${i}`, bcdBit(b, i)))
        edges.push(w(`ea${i}`, `a${i}`, 'terminal_positive', 'D', `a${i}`))
        edges.push(w(`eb${i}`, `b${i}`, 'terminal_positive', 'D', `b${i}`))
        edges.push(w(`ean${i}`, `a${i}`, 'terminal_negative', 'g', 'reference_terminal'))
        edges.push(w(`ebn${i}`, `b${i}`, 'terminal_negative', 'g', 'reference_terminal'))
      }
      const r = simulateLogic(nodes, edges, state)
      const read = (prefix: string) => {
        let n = 0
        for (let d = 0; d < 10; d++) {
          let dig = 0
          for (let bb = 0; bb < 4; bb++)
            if (r.value('D', `${prefix}${d * 4 + bb}`) === true) dig |= 1 << bb
          n += dig * 10 ** d
        }
        return n
      }
      return {
        quotient: read('quotient'),
        remainder: read('remainder'),
        done: r.value('D', 'done') === true,
        error: r.value('D', 'error') === true,
      }
    }
    solve(true, false) // START → INIT
    solve(true, true)
    let last = { quotient: 0, remainder: 0, done: false }
    for (let i = 0; i < 150; i++) {
      solve(false, false)
      last = solve(false, true)
      if (last.done) break
    }
    return last
  }

  test('100 ÷ 4 = 25', () => {
    expect(runDiv(100, 4)).toMatchObject({ quotient: 25, remainder: 0, done: true })
  }, 30000)

  test('56 ÷ 8 = 7', () => {
    expect(runDiv(56, 8)).toMatchObject({ quotient: 7, remainder: 0, done: true })
  }, 30000)

  test('17 ÷ 5 = 3 remainder 2', () => {
    expect(runDiv(17, 5)).toMatchObject({ quotient: 3, remainder: 2, done: true, error: false })
  }, 30000)

  test('divide by zero finishes immediately with the error flag set', () => {
    expect(runDiv(5, 0)).toMatchObject({ done: true, error: true })
  }, 30000)
})

describe('×/÷ busy handshake — start the sequencer, hold BUSY until done, then capture', () => {
  const state = new Map<string, boolean>()
  const step = (
    compute: boolean,
    isMul: boolean,
    isDiv: boolean,
    seqDone: boolean,
    clk: boolean,
  ) => {
    const nodes: CanvasNodeLike[] = [
      {
        id: 'C',
        position: { x: 0, y: 0 },
        data: { definition: 'block', block: MULDIV_CONTROLLER },
      },
      src('vp', true),
      gnd('g'),
      src('vclk', clk),
      src('vcomp', compute),
      src('vmul', isMul),
      src('vdiv', isDiv),
      src('vdone', seqDone),
    ]
    const edges: CanvasEdgeLike[] = [
      w('eclk', 'vclk', 'terminal_positive', 'C', 'clk'),
      w('ep', 'vp', 'terminal_positive', 'C', 'v_dd'),
      w('eg', 'C', 'gnd', 'g', 'reference_terminal'),
      w('ecomp', 'vcomp', 'terminal_positive', 'C', 'compute'),
      w('emul', 'vmul', 'terminal_positive', 'C', 'is_mul'),
      w('ediv', 'vdiv', 'terminal_positive', 'C', 'is_div'),
      w('edone', 'vdone', 'terminal_positive', 'C', 'seq_done'),
      w('eclkn', 'vclk', 'terminal_negative', 'g', 'reference_terminal'),
      w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
      w('ecompn', 'vcomp', 'terminal_negative', 'g', 'reference_terminal'),
      w('emuln', 'vmul', 'terminal_negative', 'g', 'reference_terminal'),
      w('edivn', 'vdiv', 'terminal_negative', 'g', 'reference_terminal'),
      w('edonen', 'vdone', 'terminal_negative', 'g', 'reference_terminal'),
    ]
    const r = simulateLogic(nodes, edges, state)
    const hi = (h: string) => r.value('C', h) === true
    return {
      startMul: hi('start_mul'),
      startDiv: hi('start_div'),
      capture: hi('capture'),
      busy: hi('busy'),
    }
  }
  // Mealy outputs (start/capture) read pre-edge; BUSY (the flag) read post-edge.
  const press = (compute: boolean, isMul: boolean, isDiv: boolean, seqDone: boolean) => {
    const lo = step(compute, isMul, isDiv, seqDone, false)
    const hi = step(compute, isMul, isDiv, seqDone, true)
    return { startMul: lo.startMul, startDiv: lo.startDiv, capture: lo.capture, busy: hi.busy }
  }

  test('multiply: COMPUTE+IS_MUL starts the multiplier, BUSY holds until DONE, then CAPTURE', () => {
    press(false, false, false, false) // settle, not busy
    expect(press(true, true, false, false)).toMatchObject({
      startMul: true,
      startDiv: false,
      busy: true,
    })
    expect(press(false, false, false, false)).toMatchObject({ startMul: false, busy: true }) // waiting
    expect(press(false, false, false, false)).toMatchObject({ busy: true }) // still waiting
    expect(press(false, false, false, true)).toMatchObject({ capture: true, busy: false }) // SEQ done
    expect(press(false, false, false, false)).toMatchObject({ capture: false, busy: false }) // idle again
  })

  test('divide: COMPUTE+IS_DIV starts the divider', () => {
    press(false, false, false, false) // settle
    expect(press(true, false, true, false)).toMatchObject({
      startDiv: true,
      startMul: false,
      busy: true,
    })
    expect(press(false, false, false, true)).toMatchObject({ capture: true, busy: false })
  })
})

describe('CALCULATOR — the whole 4-function machine, end-to-end on real gates', () => {
  const ALLKEYS = [
    'k0',
    'k1',
    'k2',
    'k3',
    'k4',
    'k5',
    'k6',
    'k7',
    'k8',
    'k9',
    'kadd',
    'ksub',
    'kmul',
    'kdiv',
    'keq',
    'kclr',
    'kpm',
    'kdot',
  ]
  const lineFor = (k: string | number): string => {
    if (typeof k === 'number') return `k${k}`
    switch (k) {
      case '+':
        return 'kadd'
      case '-':
        return 'ksub'
      case '*':
        return 'kmul'
      case '/':
        return 'kdiv'
      case '=':
        return 'keq'
      case 'n':
        return 'kpm'
      case '.':
        return 'kdot'
      default:
        return 'kclr'
    }
  }
  // Press a key sequence; for ×/÷ the press starts a sequencer and raises BUSY — keep clocking (no key)
  // until BUSY clears, then the result is captured. Returns the final display + error flag.
  const runCalc = (
    keys: Array<string | number>,
  ): {
    display: number
    value: number
    sig: number
    fent: number
    error: boolean
    neg: boolean
  } => {
    // Compile the harness ONCE (constant topology; default levels clk LOW, every key LOW, V+ HIGH),
    // then stepLogic overrides the clock + the pressed key each cycle — the App.tsx fast path, so the
    // multi-cycle ×/÷ runs in a fraction of the old re-flatten-every-cycle time.
    const harnessNodes: CanvasNodeLike[] = [
      { id: 'C', position: { x: 0, y: 0 }, data: { definition: 'block', block: CALCULATOR } },
      src('vp', true),
      gnd('g'),
      src('vclk', false),
      ...ALLKEYS.map((key) => src(`s_${key}`, false)),
    ]
    const harnessEdges: CanvasEdgeLike[] = [
      w('eclk', 'vclk', 'terminal_positive', 'C', 'clk'),
      w('ep', 'vp', 'terminal_positive', 'C', 'v_dd'),
      w('eg', 'C', 'gnd', 'g', 'reference_terminal'),
      w('eclkn', 'vclk', 'terminal_negative', 'g', 'reference_terminal'),
      w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
      ...ALLKEYS.flatMap((key) => [
        w(`e_${key}`, `s_${key}`, 'terminal_positive', 'C', key),
        w(`en_${key}`, `s_${key}`, 'terminal_negative', 'g', 'reference_terminal'),
      ]),
    ]
    const compiled = compileLogic(harnessNodes, harnessEdges)
    const state = new Map<string, boolean>()
    const solve = (active: string, clk: boolean) => {
      const overrides = new Map<string, boolean>([['vclk', clk]])
      if (active !== 'none') overrides.set(`s_${active}`, true)
      const r = stepLogic(compiled, overrides, state)
      let display = 0
      for (let d = 0; d < 10; d++) {
        let dig = 0
        for (let b = 0; b < 4; b++) if (r.value('C', `display${d * 4 + b}`) === true) dig |= 1 << b
        display += dig * 10 ** d
      }
      let fent = 0
      for (let b = 0; b < 4; b++) if (r.value('C', `f_ent${b}`) === true) fent |= 1 << b
      const neg = r.value('C', 'neg') === true
      const signed = neg ? -display : display
      return {
        display: signed,
        sig: display,
        fent,
        value: signed / 10 ** fent,
        error: r.value('C', 'error') === true,
        busy: r.value('C', 'busy') === true,
        neg,
      }
    }
    let last = { display: 0, sig: 0, fent: 0, value: 0, error: false, busy: false, neg: false }
    for (const k of keys) {
      const line = lineFor(k)
      solve(line, false)
      last = solve(line, true) // press = one clock
      let guard = 0
      while (last.busy && guard < 250) {
        solve('none', false)
        last = solve('none', true) // free-run the clock while the ×/÷ sequencer works
        guard++
      }
    }
    return {
      display: last.display,
      value: last.value,
      sig: last.sig,
      fent: last.fent,
      error: last.error,
      neg: last.neg,
    }
  }

  test('12 + 34 = 46', () => {
    expect(runCalc(['c', 1, 2, '+', 3, 4, '='])).toMatchObject({ display: 46, error: false })
  }, 60000)

  test('12 × 34 = 408', () => {
    expect(runCalc(['c', 1, 2, '*', 3, 4, '='])).toMatchObject({ display: 408, error: false })
  }, 120000)

  test('100 ÷ 4 = 25', () => {
    expect(runCalc(['c', 1, 0, 0, '/', 4, '='])).toMatchObject({ display: 25, error: false })
  }, 120000)

  test('5 ÷ 0 = Error', () => {
    expect(runCalc(['c', 5, '/', 0, '='])).toMatchObject({ error: true })
  }, 60000)

  test('the divide-by-zero error is not sticky — it clears on the next op/clear', () => {
    expect(runCalc(['c', 5, '/', 0, '=', 'c', 6, '+', 1, '='])).toMatchObject({
      display: 7,
      error: false,
    })
    expect(runCalc(['c', 5, '/', 0, '=', 6, '+', 1, '='])).toMatchObject({
      display: 7,
      error: false,
    })
  }, 120000)

  test('subtraction can go negative: 3 − 5 = −2', () => {
    expect(runCalc(['c', 3, '-', 5, '='])).toMatchObject({ display: -2, error: false })
  }, 60000)

  test('positive subtraction still works: 12 − 5 = 7', () => {
    expect(runCalc(['c', 1, 2, '-', 5, '='])).toMatchObject({ display: 7 })
  }, 60000)

  test('chaining off a negative: 3 − 5 = then + 5 = 3', () => {
    expect(runCalc(['c', 3, '-', 5, '=', '+', 5, '='])).toMatchObject({ display: 3 })
  }, 60000)

  test('the ± key negates the entry: 5 ± shows −5', () => {
    expect(runCalc(['c', 5, 'n'])).toMatchObject({ display: -5 })
  }, 60000)

  test('± then arithmetic: 5 ± + 3 = −2', () => {
    expect(runCalc(['c', 5, 'n', '+', 3, '='])).toMatchObject({ display: -2 })
  }, 60000)

  // Floating point — step 3: typing a "." switches to fractional entry, and a real point-position
  // counter (f_ent) records how many digits are fractional. The significand stays a plain integer;
  // value = significand / 10^f_ent. (Decimal +/− and ×/÷ — alignment + scaling — come next.)
  test('decimal entry: the point-position counter tracks the radix', () => {
    expect(runCalc(['c', 1, '.', 5])).toMatchObject({ sig: 15, fent: 1, value: 1.5 })
    expect(runCalc(['c', '.', 5])).toMatchObject({ sig: 5, fent: 1, value: 0.5 })
    expect(runCalc(['c', 1, 2, '.', 3, 4])).toMatchObject({ sig: 1234, fent: 2, value: 12.34 })
    expect(runCalc(['c', 1, 2])).toMatchObject({ sig: 12, fent: 0, value: 12 })
    expect(runCalc(['c', 0, '.', 2, 5])).toMatchObject({ sig: 25, fent: 2, value: 0.25 })
  }, 60000)

  // TRUE 10-DIGIT RANGE + OVERFLOW → E (real gates): the calc is SIGN-MAGNITUDE — an UNSIGNED 10-digit
  // magnitude (0..9,999,999,999) plus an explicit sign bit — so the whole 10-digit range is usable. A +/−
  // overflows only on a true >10-digit carry (same-sign sum); a difference never overflows; a × overflows
  // on an >10-digit product; ÷0 errors. A digit string is spread as numbers.
  const D = (s: string): number[] => s.split('').map(Number)

  test('the lead’s case — a big add no longer wraps to E: 4000000000 + 4000000000 = 8000000000', () => {
    expect(runCalc(['c', ...D('4000000000'), '+', ...D('4000000000'), '='])).toMatchObject({
      display: 8000000000,
      error: false,
    })
  }, 60000)

  test('full range, still in bounds: 5000000000 + 4000000000 = 9000000000', () => {
    expect(runCalc(['c', ...D('5000000000'), '+', ...D('4000000000'), '='])).toMatchObject({
      display: 9000000000,
      error: false,
    })
  }, 60000)

  test('one below the 10-digit ceiling is fine: 9999999998 + 1 = 9999999999', () => {
    expect(runCalc(['c', ...D('9999999998'), '+', 1, '='])).toMatchObject({
      display: 9999999999,
      error: false,
    })
  }, 60000)

  test('a true 10-digit carry overflows: 9999999999 + 1 → E', () => {
    expect(runCalc(['c', ...D('9999999999'), '+', 1, '='])).toMatchObject({ error: true })
  }, 60000)

  test('add that stays in range does NOT overflow: 2000000000 + 2000000000 = 4000000000', () => {
    expect(runCalc(['c', ...D('2000000000'), '+', ...D('2000000000'), '='])).toMatchObject({
      display: 4000000000,
      error: false,
    })
  }, 60000)

  test('subtraction in range never overflows: 1 − 9 = −8', () => {
    expect(runCalc(['c', 1, '-', 9, '='])).toMatchObject({ display: -8, error: false })
  }, 60000)

  test('a large negative sum is now representable: −4000000000 − 4000000000 = −8000000000', () => {
    expect(runCalc(['c', ...D('4000000000'), 'n', '-', ...D('4000000000'), '='])).toMatchObject({
      display: -8000000000,
      error: false,
    })
  }, 60000)

  test('a negative sum past 10 digits still overflows: −6000000000 − 5000000000 → E', () => {
    expect(runCalc(['c', ...D('6000000000'), 'n', '-', ...D('5000000000'), '='])).toMatchObject({
      error: true,
    })
  }, 60000)

  test('a difference never overflows: 9999999999 − 9999999999 = 0', () => {
    expect(runCalc(['c', ...D('9999999999'), '-', ...D('9999999999'), '='])).toMatchObject({
      display: 0,
      error: false,
      neg: false,
    })
  }, 60000)

  test('the ± key preserves the magnitude across the full range: 9999999999 ± = −9999999999', () => {
    expect(runCalc(['c', ...D('9999999999'), 'n'])).toMatchObject({
      display: -9999999999,
      error: false,
    })
  }, 60000)

  test('a full-range negative via subtraction: 0 − 9999999999 = −9999999999', () => {
    expect(runCalc(['c', 0, '-', ...D('9999999999'), '='])).toMatchObject({
      display: -9999999999,
      error: false,
    })
  }, 60000)

  test('multiply overflow past 10 digits raises the error: 4000000000 × 3 → E', () => {
    expect(runCalc(['c', ...D('4000000000'), '*', 3, '='])).toMatchObject({ error: true })
  }, 120000)

  test('an 11-digit product overflows: 5000000000 × 2 → E', () => {
    expect(runCalc(['c', ...D('5000000000'), '*', 2, '='])).toMatchObject({ error: true })
  }, 120000)

  test('a product that fills 10 digits does NOT overflow: 3333333333 × 3 = 9999999999', () => {
    expect(runCalc(['c', ...D('3333333333'), '*', 3, '='])).toMatchObject({
      display: 9999999999,
      error: false,
    })
  }, 120000)

  test('a product that stays in range does NOT overflow: 2000000000 × 2 = 4000000000', () => {
    expect(runCalc(['c', ...D('2000000000'), '*', 2, '='])).toMatchObject({
      display: 4000000000,
      error: false,
    })
  }, 120000)

  // −0 GUARD: a zero result is always +0 (the sign-suppress NOR taps the FINAL muxed magnitude, so ×/÷
  // by zero can't sneak a minus through either).
  test('subtracting equals gives +0, not −0: 5 − 5 = 0 (neg false)', () => {
    expect(runCalc(['c', 5, '-', 5, '='])).toMatchObject({ display: 0, error: false, neg: false })
  }, 60000)

  test('−0 guard through multiply: −5 × 0 = 0 (neg false)', () => {
    expect(runCalc(['c', 5, 'n', '*', 0, '='])).toMatchObject({
      display: 0,
      error: false,
      neg: false,
    })
  }, 120000)

  test('−0 guard through divide: −0 ÷ 5 = 0 (neg false)', () => {
    expect(runCalc(['c', 0, 'n', '/', 5, '='])).toMatchObject({
      display: 0,
      error: false,
      neg: false,
    })
  }, 120000)

  // repeat-equals + chaining must keep the sign right across the new range
  test('a replayed add can overflow: 5000000000 + 4000000000 = = → E', () => {
    expect(runCalc(['c', ...D('5000000000'), '+', ...D('4000000000'), '=', '='])).toMatchObject({
      error: true,
    })
  }, 60000)

  test('repeat-equals on a negative result: 5 − 7 = = → −2 then −9', () => {
    expect(runCalc(['c', 5, '-', 7, '='])).toMatchObject({ display: -2, error: false })
    expect(runCalc(['c', 5, '-', 7, '=', '='])).toMatchObject({ display: -9, error: false })
  }, 60000)

  test('overflow error is not sticky — a fresh calculation clears it', () => {
    expect(runCalc(['c', ...D('9999999999'), '+', 1, '=', 'c', 6, '+', 1, '='])).toMatchObject({
      display: 7,
      error: false,
    })
  }, 60000)

  // REPEAT-EQUALS (real gates): a bare '=' replays the last op + operand on the shown value.
  test('repeat equals replays the last add: 5 + 3 =, ==, === → 8, 11, 14', () => {
    expect(runCalc(['c', 5, '+', 3, '='])).toMatchObject({ display: 8 })
    expect(runCalc(['c', 5, '+', 3, '=', '='])).toMatchObject({ display: 11 })
    expect(runCalc(['c', 5, '+', 3, '=', '=', '='])).toMatchObject({ display: 14 })
  }, 60000)

  test('a new number then = applies the last op to it: 5 + 3 = 7 = → 10', () => {
    expect(runCalc(['c', 5, '+', 3, '=', 7, '='])).toMatchObject({ display: 10 })
  }, 60000)

  test('repeat equals replays a multiply: 2 × 3 = = → 18', () => {
    expect(runCalc(['c', 2, '*', 3, '=', '='])).toMatchObject({ display: 18 })
  }, 120000)

  test('a new number then = applies the last multiply: 2 × 3 = 7 = → 21', () => {
    expect(runCalc(['c', 2, '*', 3, '=', 7, '='])).toMatchObject({ display: 21 })
  }, 120000)

  test('repeat equals replays a divide: 100 ÷ 2 = = → 25', () => {
    expect(runCalc(['c', 1, 0, 0, '/', 2, '=', '='])).toMatchObject({ display: 25 })
  }, 120000)

  test('a new operator after = is NOT a replay (chains the result): 2 × 3 = + 4 = → 10', () => {
    expect(runCalc(['c', 2, '*', 3, '=', '+', 4, '='])).toMatchObject({ display: 10 })
  }, 120000)

  // DECIMAL +/− (floating point): each number carries a point position F; the smaller-F operand is
  // aligned (shifted up) to F=max before the ALU. Asserting fent (the result's F) too, because the
  // integer cases all have F=0 and would pass even with a broken aligner. (× and ÷ with decimals are
  // not aligned yet → they raise E for now, until those increments land.)
  test('aligned decimal add, both operand orders: 2.30+1.5 and 1.5+2.30 = 3.8', () => {
    expect(runCalc(['c', 2, '.', 3, 0, '+', 1, '.', 5, '='])).toMatchObject({ value: 3.8, fent: 2 })
    expect(runCalc(['c', 1, '.', 5, '+', 2, '.', 3, 0, '='])).toMatchObject({ value: 3.8, fent: 2 })
  }, 60000)

  test('aligned decimal subtract: 3.75 − 1.5 = 2.25', () => {
    expect(runCalc(['c', 3, '.', 7, 5, '-', 1, '.', 5, '='])).toMatchObject({
      value: 2.25,
      fent: 2,
    })
  }, 60000)

  test('aligned decimal subtract going negative: 1.5 − 3.75 = −2.25', () => {
    expect(runCalc(['c', 1, '.', 5, '-', 3, '.', 7, 5, '='])).toMatchObject({
      value: -2.25,
      fent: 2,
    })
  }, 60000)

  test('equal-F decimal subtract: 0.5 − 2.0 = −1.5', () => {
    expect(runCalc(['c', 0, '.', 5, '-', 2, '.', 0, '='])).toMatchObject({ value: -1.5, fent: 1 })
  }, 60000)

  test('negate then aligned add: 1.5 ± + 0.25 = −1.25', () => {
    expect(runCalc(['c', 1, '.', 5, 'n', '+', 0, '.', 2, 5, '='])).toMatchObject({
      value: -1.25,
      fent: 2,
    })
  }, 60000)

  test('repeat-equals keeps the point: 1.5 + 2.3 = = → 3.8 then 6.1', () => {
    expect(runCalc(['c', 1, '.', 5, '+', 2, '.', 3, '='])).toMatchObject({ value: 3.8, fent: 1 })
    expect(runCalc(['c', 1, '.', 5, '+', 2, '.', 3, '=', '='])).toMatchObject({
      value: 6.1,
      fent: 1,
    })
  }, 60000)

  test('alignment that loses a digit off the top raises E: 1234567890 + 0.5 → E', () => {
    expect(runCalc(['c', 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, '+', 0, '.', 5, '='])).toMatchObject({
      error: true,
    })
  }, 60000)

  test('integer add still has no point (F=0): 12 + 34 = 46, fent 0', () => {
    expect(runCalc(['c', 1, 2, '+', 3, 4, '='])).toMatchObject({ value: 46, fent: 0 })
  }, 60000)

  // ×/÷ with a decimal operand is not aligned yet — refuse with E rather than lie (added in later steps).
  test('decimal multiply lines up the point: 1.5 × 2.5 = 3.75', () => {
    expect(runCalc(['c', 1, '.', 5, '*', 2, '.', 5, '='])).toMatchObject({ value: 3.75, fent: 2 })
  }, 120000)

  test('decimal multiply keeps trailing zeros: 0.25 × 4 = 1.00', () => {
    expect(runCalc(['c', 0, '.', 2, 5, '*', 4, '='])).toMatchObject({ value: 1, fent: 2, sig: 100 })
  }, 120000)

  test('one decimal operand: 2.5 × 2 = 5.0', () => {
    expect(runCalc(['c', 2, '.', 5, '*', 2, '='])).toMatchObject({ value: 5, fent: 1 })
  }, 120000)

  test('integer multiply still has no point: 12 × 34 = 408 (F0)', () => {
    expect(runCalc(['c', 1, 2, '*', 3, 4, '='])).toMatchObject({ value: 408, fent: 0 })
  }, 120000)

  test('a product needing >10 fractional places overflows: 0.000001 × 0.00001 → E', () => {
    expect(runCalc(['c', 0, '.', 0, 0, 0, 0, 0, 1, '*', 0, '.', 0, 0, 0, 0, 1, '='])).toMatchObject(
      { error: true },
    )
  }, 120000)

  test('decimal divide is not supported yet → E: 1.5 ÷ 0.5', () => {
    expect(runCalc(['c', 1, '.', 5, '/', 0, '.', 5, '='])).toMatchObject({ error: true })
  }, 120000)
})
