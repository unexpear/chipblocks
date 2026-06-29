/**
 * compileLogic + stepLogic — the compile-once / step-many fast path that the calculator's ×/÷ busy
 * loop uses (App.tsx calcSolve). The CALCULATOR harness is flattened ONCE; each clock only re-seeds the
 * clock + the pressed key (via stepLogic's source overrides) and re-sweeps, instead of re-expanding
 * ~9000 gates every cycle. This proves that path computes the SAME results as the per-cycle simulateLogic
 * — including over the multi-cycle ×/÷ sequencer — so the speedup is behavior-preserving.
 */

import { describe, expect, test } from 'vitest'
import type { CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { CALCULATOR } from '../src/renderer/builtin-blocks.ts'
import { compileLogic, simulateLogic, stepLogic } from '../src/renderer/logic-sim.ts'

const supply = (v: number) => ({
  nominal_voltage: { value: { kind: 'scalar', amount: v, unit: 'volt' } },
})
const src = (id: string, v: number): CanvasNodeLike => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition: 'power_source', parameters: supply(v) },
})
const w = (id: string, s: string, sh: string, t: string, th: string): CanvasEdgeLike => ({
  id,
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
})
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
  'kdot',
]
const lineFor = (k: string | number): string => {
  if (typeof k === 'number') return `k${k}`
  return { '+': 'kadd', '-': 'ksub', '*': 'kmul', '/': 'kdiv', '=': 'keq', c: 'kclr' }[k] ?? 'kclr'
}
const decode = (r: ReturnType<typeof simulateLogic>): number => {
  let n = 0
  for (let d = 0; d < 10; d++) {
    let dig = 0
    for (let b = 0; b < 4; b++) if (r.value('calc', `display${d * 4 + b}`) === true) dig |= 1 << b
    n += dig * 10 ** d
  }
  return (r.value('calc', 'neg') === true ? -1 : 1) * n
}

// the harness App.tsx compiles once (default levels: clk LOW, every key LOW, V+ HIGH)
const harnessNodes: CanvasNodeLike[] = [
  { id: 'calc', position: { x: 0, y: 0 }, data: { definition: 'block', block: CALCULATOR } },
  src('h_vp', 5),
  { id: 'h_g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
  src('h_clk', 0),
  ...KEYS.map((k) => src(`h_${k}`, 0)),
]
const harnessEdges: CanvasEdgeLike[] = [
  w('h_eclk', 'h_clk', 'terminal_positive', 'calc', 'clk'),
  w('h_eclkn', 'h_clk', 'terminal_negative', 'h_g', 'reference_terminal'),
  w('h_ep', 'h_vp', 'terminal_positive', 'calc', 'v_dd'),
  w('h_epn', 'h_vp', 'terminal_negative', 'h_g', 'reference_terminal'),
  w('h_eg', 'calc', 'gnd', 'h_g', 'reference_terminal'),
  ...KEYS.flatMap((k) => [
    w(`h_e_${k}`, `h_${k}`, 'terminal_positive', 'calc', k),
    w(`h_en_${k}`, `h_${k}`, 'terminal_negative', 'h_g', 'reference_terminal'),
  ]),
]

// the App.tsx fast path: compile ONCE, step with clock + key overrides
function runFast(keys: Array<string | number>): number {
  const compiled = compileLogic(harnessNodes, harnessEdges)
  const state = new Map<string, boolean>()
  const solve = (active: string, clk: boolean) => {
    const ov = new Map<string, boolean>([['h_clk', clk]])
    if (active !== 'none') ov.set(`h_${active}`, true)
    return stepLogic(compiled, ov, state)
  }
  let r = solve('none', false)
  for (const k of keys) {
    const line = lineFor(k)
    solve(line, false)
    r = solve(line, true)
    let guard = 0
    while (r.value('calc', 'busy') === true && guard++ < 300) {
      solve('none', false)
      r = solve('none', true)
    }
    r = solve('none', false)
  }
  return decode(r)
}

// the reference: a fresh simulateLogic over a harness rebuilt with the live source values each cycle
function runRef(keys: Array<string | number>): number {
  const state = new Map<string, boolean>()
  const solve = (active: string, clk: boolean) => {
    const nodes: CanvasNodeLike[] = [
      { id: 'calc', position: { x: 0, y: 0 }, data: { definition: 'block', block: CALCULATOR } },
      src('h_vp', 5),
      { id: 'h_g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
      src('h_clk', clk ? 5 : 0),
      ...KEYS.map((k) => src(`h_${k}`, k === active ? 5 : 0)),
    ]
    return simulateLogic(nodes, harnessEdges, state)
  }
  let r = solve('none', false)
  for (const k of keys) {
    const line = lineFor(k)
    solve(line, false)
    r = solve(line, true)
    let guard = 0
    while (r.value('calc', 'busy') === true && guard++ < 300) {
      solve('none', false)
      r = solve('none', true)
    }
    r = solve('none', false)
  }
  return decode(r)
}

describe('compileLogic + stepLogic (the calculator fast path)', () => {
  test('add via the compile-once/step path: 1234 + 5678 = 6912', () => {
    expect(runFast(['c', 1, 2, 3, 4, '+', 5, 6, 7, 8, '='])).toBe(6912)
  })

  test('the multi-cycle ×/÷ busy loop on the fast path matches the per-cycle simulateLogic', () => {
    for (const seq of [
      ['c', 1, 2, '*', 3, 4, '='],
      ['c', 1, 0, 0, '/', 4, '='],
      ['c', 5, '-', 9, '='],
    ] as Array<Array<string | number>>) {
      expect(runFast(seq)).toBe(runRef(seq))
    }
  }, 600000)
})
