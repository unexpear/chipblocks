/**
 * Exhaustive logic-gate verification — every gate, then every 2-gate compound, each checked against
 * its boolean truth table by SOLVING the real transistor netlist (solveDCRobust), not a lookup.
 *
 * The progression the project lead asked for:
 *   1. each SINGLE gate, full truth table;
 *   2. each SAME-TYPE compound (a gate feeding the same gate);
 *   3. every ordered pair of DIFFERENT gates as a 2-gate compound.
 *
 * A compound wires gate1's output into gate2's first input; gate2's second input (if it has one) is a
 * free input. The expected output is computed from the gates' boolean functions and compared to the
 * solved output level (isHigh/isLow) for every input combination — so a wrong wiring or a wrong gate
 * shows up as a truth-table mismatch.
 */

import { describe, expect, test } from 'vitest'
import { solveDCRobust } from '../src/dc-robust.ts'
import {
  type BlockData,
  type CanvasEdgeLike,
  type CanvasNodeLike,
  flattenBlocks,
} from '../src/renderer/blocks.ts'
import {
  AND_BLOCK,
  BUFFER_BLOCK,
  INVERTER_BLOCK,
  NAND2_BLOCK,
  NOR2_BLOCK,
  OR_BLOCK,
  XNOR_BLOCK,
  XOR_BLOCK,
} from '../src/renderer/builtin-blocks.ts'
import { canvasToWorld } from '../src/renderer/canvas-to-world.ts'

const VDD = 5
const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const supply = (volts: number) => ({
  nominal_voltage: scalar(volts, 'volt'),
  internal_resistance: scalar(0, 'ohm'),
})
const wire = (
  id: string,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
): CanvasEdgeLike => ({ id, source, sourceHandle, target, targetHandle })
const isHigh = (v: number) => v > VDD * 0.7
const isLow = (v: number) => v < VDD * 0.3

type Gate = { block: BlockData; arity: 1 | 2; in: string[]; fn: (...a: boolean[]) => boolean }
const GATES: Record<string, Gate> = {
  not: { block: INVERTER_BLOCK, arity: 1, in: ['in'], fn: (a) => !a },
  buf: { block: BUFFER_BLOCK, arity: 1, in: ['in'], fn: (a) => a },
  nand: { block: NAND2_BLOCK, arity: 2, in: ['a', 'b'], fn: (a, b) => !(a && b) },
  nor: { block: NOR2_BLOCK, arity: 2, in: ['a', 'b'], fn: (a, b) => !(a || b) },
  and: { block: AND_BLOCK, arity: 2, in: ['a', 'b'], fn: (a, b) => a && b },
  or: { block: OR_BLOCK, arity: 2, in: ['a', 'b'], fn: (a, b) => a || b },
  xor: { block: XOR_BLOCK, arity: 2, in: ['a', 'b'], fn: (a, b) => a !== b },
  xnor: { block: XNOR_BLOCK, arity: 2, in: ['a', 'b'], fn: (a, b) => a === b },
}

function readOut(nodes: CanvasNodeLike[], edges: CanvasEdgeLike[], blockNodeId: string): number {
  const flat = flattenBlocks(nodes, edges)
  const world = canvasToWorld(
    flat.nodes.map((n) => ({
      id: n.id,
      definition: n.data.definition,
      parameters: n.data.parameters,
    })),
    flat.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
    })),
  )
  const solution = solveDCRobust(world)
  const t = flat.portTarget.get(`${blockNodeId}/out`)
  const net = t
    ? world.instances.get(t.nodeId)?.connects?.find((c) => c.terminal === t.handleId)?.net
    : undefined
  return solution.nodes.get(net ?? '') ?? Number.NaN
}

const rails = (): CanvasNodeLike[] => [
  {
    id: 'vdd',
    position: { x: 0, y: 0 },
    data: { definition: 'power_source', parameters: supply(VDD) },
  },
  { id: 'gnd', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
]
const inSrc = (id: string, bit: boolean): CanvasNodeLike => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition: 'power_source', parameters: supply(bit ? VDD : 0) },
})

function solveSingle(gate: Gate, bits: boolean[]): number {
  const nodes: CanvasNodeLike[] = [
    { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'block', block: gate.block } },
    ...rails(),
    ...gate.in.map((_, i) => inSrc(`in${i}`, Boolean(bits[i]))),
  ]
  const edges: CanvasEdgeLike[] = [
    wire('wvp', 'vdd', 'terminal_positive', 'g', 'v_dd'),
    wire('wvn', 'vdd', 'terminal_negative', 'gnd', 'reference_terminal'),
    wire('wg', 'g', 'gnd', 'gnd', 'reference_terminal'),
    ...gate.in.flatMap((port, i) => [
      wire(`wi${i}p`, `in${i}`, 'terminal_positive', 'g', port),
      wire(`wi${i}n`, `in${i}`, 'terminal_negative', 'gnd', 'reference_terminal'),
    ]),
  ]
  return readOut(nodes, edges, 'g')
}

function solveCompound(g1: Gate, g2: Gate, bits: boolean[]): number {
  let bi = 0
  const g1bits = g1.in.map(() => Boolean(bits[bi++]))
  const g2free = g2.arity === 2 ? Boolean(bits[bi++]) : false
  const nodes: CanvasNodeLike[] = [
    { id: 'g1', position: { x: 0, y: 0 }, data: { definition: 'block', block: g1.block } },
    { id: 'g2', position: { x: 0, y: 0 }, data: { definition: 'block', block: g2.block } },
    ...rails(),
    ...g1.in.map((_, i) => inSrc(`a${i}`, Boolean(g1bits[i]))),
    ...(g2.arity === 2 ? [inSrc('c', g2free)] : []),
  ]
  const edges: CanvasEdgeLike[] = [
    wire('wvp1', 'vdd', 'terminal_positive', 'g1', 'v_dd'),
    wire('wvp2', 'vdd', 'terminal_positive', 'g2', 'v_dd'),
    wire('wvn', 'vdd', 'terminal_negative', 'gnd', 'reference_terminal'),
    wire('wg1', 'g1', 'gnd', 'gnd', 'reference_terminal'),
    wire('wg2', 'g2', 'gnd', 'gnd', 'reference_terminal'),
    ...g1.in.flatMap((port, i) => [
      wire(`wa${i}p`, `a${i}`, 'terminal_positive', 'g1', port),
      wire(`wa${i}n`, `a${i}`, 'terminal_negative', 'gnd', 'reference_terminal'),
    ]),
    // gate1's output drives gate2's FIRST input — the compound
    wire('wchain', 'g1', 'out', 'g2', g2.in[0] as string),
    ...(g2.arity === 2
      ? [
          wire('wcp', 'c', 'terminal_positive', 'g2', g2.in[1] as string),
          wire('wcn', 'c', 'terminal_negative', 'gnd', 'reference_terminal'),
        ]
      : []),
  ]
  return readOut(nodes, edges, 'g2')
}

const expectedCompound = (g1: Gate, g2: Gate, bits: boolean[]): boolean => {
  let bi = 0
  const g1bits = g1.in.map(() => Boolean(bits[bi++]))
  const v1 = g1.fn(...g1bits)
  const g2free = g2.arity === 2 ? Boolean(bits[bi++]) : false
  return g2.arity === 2 ? g2.fn(v1, g2free) : g2.fn(v1)
}

const combos = (n: number): boolean[][] =>
  Array.from({ length: 1 << n }, (_, k) =>
    Array.from({ length: n }, (_, i) => Boolean((k >> i) & 1)),
  )
const fmt = (bits: boolean[]) => bits.map((b) => (b ? 1 : 0)).join('')
const ok = (out: number, exp: boolean) => (exp ? isHigh(out) : isLow(out))

describe('single gates — every gate, full truth table from real transistors', () => {
  for (const [name, gate] of Object.entries(GATES)) {
    test(`${name.toUpperCase()}`, () => {
      const fails: string[] = []
      for (const bits of combos(gate.in.length)) {
        const out = solveSingle(gate, bits)
        const exp = gate.fn(...bits)
        if (!ok(out, exp))
          fails.push(`${name}(${fmt(bits)})=${out.toFixed(2)}V want ${exp ? 'HI' : 'LO'}`)
      }
      expect(fails).toEqual([])
    }, 30000)
  }
})

describe('same-type 2-gate compounds — a gate feeding the same gate', () => {
  for (const [name, gate] of Object.entries(GATES)) {
    const nBits = gate.in.length + (gate.arity === 2 ? 1 : 0)
    test(`${name.toUpperCase()} → ${name.toUpperCase()}`, () => {
      const fails: string[] = []
      for (const bits of combos(nBits)) {
        const out = solveCompound(gate, gate, bits)
        const exp = expectedCompound(gate, gate, bits)
        if (!ok(out, exp))
          fails.push(`${name}→${name}(${fmt(bits)})=${out.toFixed(2)}V want ${exp ? 'HI' : 'LO'}`)
      }
      expect(fails).toEqual([])
    }, 90000)
  }
})

describe('different-type 2-gate compounds — every ordered pair of distinct gates', () => {
  const names = Object.keys(GATES)
  for (const n1 of names)
    for (const n2 of names) {
      if (n1 === n2) continue
      const g1 = GATES[n1] as Gate
      const g2 = GATES[n2] as Gate
      const nBits = g1.in.length + (g2.arity === 2 ? 1 : 0)
      test(`${n1.toUpperCase()} → ${n2.toUpperCase()}`, () => {
        const fails: string[] = []
        for (const bits of combos(nBits)) {
          const out = solveCompound(g1, g2, bits)
          const exp = expectedCompound(g1, g2, bits)
          if (!ok(out, exp))
            fails.push(`${n1}→${n2}(${fmt(bits)})=${out.toFixed(2)}V want ${exp ? 'HI' : 'LO'}`)
        }
        expect(fails).toEqual([])
      }, 90000)
    }
})
