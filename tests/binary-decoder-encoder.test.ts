/**
 * Binary decoders and priority encoders (Digital chapter) — the address-select and index-report
 * building blocks, built from real gates (inverters + ANDs for the decoder minterms; a suffix-OR /
 * NOT / AND priority network + OR planes for the encoder). Each is verified against its full truth
 * table on the fast logic engine — the same 0/1 path the live app auto-routes a purely-digital
 * block to, proven elsewhere to give the identical answers the transistor solve does. The decoder
 * and the encoder are inverses, and both are exercised across every input combination that matters.
 */
import { describe, expect, test } from 'vitest'
import type { BlockData, CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import {
  BINARY_DECODER_2_4,
  BINARY_DECODER_3_8,
  PRIORITY_ENCODER_4_2,
  PRIORITY_ENCODER_8_3,
} from '../src/renderer/builtin-blocks.ts'
import { simulateLogic } from '../src/renderer/logic-sim.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const supply = (volts: number) => ({
  nominal_voltage: scalar(volts, 'volt'),
  internal_resistance: scalar(0, 'ohm'),
})
const VDD = 5
const wire = (
  id: string,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
): CanvasEdgeLike => ({ id, source, sourceHandle, target, targetHandle })

/** Drive a digital block's input ports (0/VDD) on a canvas and read any output port back as 0/1. */
function logicBlock(block: BlockData, inputs: Record<string, number>): (portId: string) => boolean {
  const nodes: CanvasNodeLike[] = [
    { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'block', block } },
    {
      id: 'vdd',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(VDD) },
    },
    { id: 'gnd', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
    ...Object.entries(inputs).map(([portId, volts]) => ({
      id: `in_${portId}`,
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(volts) },
    })),
  ]
  const edges: CanvasEdgeLike[] = [
    wire('w_vdd_p', 'vdd', 'terminal_positive', 'g', 'v_dd'),
    wire('w_vdd_n', 'vdd', 'terminal_negative', 'gnd', 'reference_terminal'),
    wire('w_gnd', 'g', 'gnd', 'gnd', 'reference_terminal'),
    ...Object.keys(inputs).flatMap((portId) => [
      wire(`w_${portId}_p`, `in_${portId}`, 'terminal_positive', 'g', portId),
      wire(`w_${portId}_n`, `in_${portId}`, 'terminal_negative', 'gnd', 'reference_terminal'),
    ]),
  ]
  const result = simulateLogic(nodes, edges)
  return (portId: string): boolean => result.value('g', portId) === true
}

/** Drive an n-bit input value onto ports a0..a(n-1) (LSB = a0). */
const busInputs = (prefix: string, bits: number, value: number): Record<string, number> =>
  Object.fromEntries(
    Array.from({ length: bits }, (_, i) => [`${prefix}${i}`, ((value >> i) & 1) === 1 ? VDD : 0]),
  )

describe('2-to-4 binary decoder — exactly one output high per input value', () => {
  for (let v = 0; v < 4; v++) {
    test(`A=${v.toString(2).padStart(2, '0')} → Y${v} high, the other three low`, () => {
      const out = logicBlock(BINARY_DECODER_2_4, busInputs('a', 2, v))
      for (let y = 0; y < 4; y++) {
        expect(out(`y${y}`), `Y${y} for input ${v}`).toBe(y === v)
      }
    })
  }
})

describe('3-to-8 binary decoder — the 74138-class one-hot decode, from real gates', () => {
  for (let v = 0; v < 8; v++) {
    test(`A=${v.toString(2).padStart(3, '0')} → Y${v} alone`, () => {
      const out = logicBlock(BINARY_DECODER_3_8, busInputs('a', 3, v))
      for (let y = 0; y < 8; y++) {
        expect(out(`y${y}`), `Y${y} for input ${v}`).toBe(y === v)
      }
    })
  }
})

/** Read the encoder's output value (A-bits) and its valid line. */
function encoderReads(
  block: BlockData,
  outBits: number,
  activeInputs: number[],
  totalInputs: number,
): { value: number; gs: boolean } {
  const inputs: Record<string, number> = Object.fromEntries(
    Array.from({ length: totalInputs }, (_, j) => [`i${j}`, activeInputs.includes(j) ? VDD : 0]),
  )
  const out = logicBlock(block, inputs)
  let value = 0
  for (let k = 0; k < outBits; k++) if (out(`a${k}`)) value |= 1 << k
  return { value, gs: out('gs') }
}

describe('4-to-2 priority encoder — reports the highest active input’s index + a valid line', () => {
  for (let j = 0; j < 4; j++) {
    test(`only I${j} active → A=${j}, GS=1`, () => {
      const r = encoderReads(PRIORITY_ENCODER_4_2, 2, [j], 4)
      expect(r.value).toBe(j)
      expect(r.gs).toBe(true)
    })
  }

  test('no input active → GS=0 (invalid — distinguishes "I0" from "nothing")', () => {
    const r = encoderReads(PRIORITY_ENCODER_4_2, 2, [], 4)
    expect(r.gs).toBe(false)
  })

  test('multiple active: the HIGHEST index wins (I1+I2 → 2; I0+I3 → 3)', () => {
    expect(encoderReads(PRIORITY_ENCODER_4_2, 2, [1, 2], 4).value).toBe(2)
    expect(encoderReads(PRIORITY_ENCODER_4_2, 2, [0, 3], 4).value).toBe(3)
    expect(encoderReads(PRIORITY_ENCODER_4_2, 2, [0, 1, 2, 3], 4).value).toBe(3)
  })
})

describe('8-to-3 priority encoder — the 74148-class part, from real gates', () => {
  for (let j = 0; j < 8; j++) {
    test(`only I${j} active → A=${j}, GS=1`, () => {
      const r = encoderReads(PRIORITY_ENCODER_8_3, 3, [j], 8)
      expect(r.value).toBe(j)
      expect(r.gs).toBe(true)
    })
  }

  test('priority holds against every lower input: I5 beats {I0..I4}', () => {
    const r = encoderReads(PRIORITY_ENCODER_8_3, 3, [0, 1, 2, 3, 4, 5], 8)
    expect(r.value).toBe(5)
    expect(r.gs).toBe(true)
  })

  test('all eight active → 7 (the top wins); none active → GS=0', () => {
    expect(encoderReads(PRIORITY_ENCODER_8_3, 3, [0, 1, 2, 3, 4, 5, 6, 7], 8).value).toBe(7)
    expect(encoderReads(PRIORITY_ENCODER_8_3, 3, [], 8).gs).toBe(false)
  })
})

describe('decoder ∘ encoder — the two are inverses', () => {
  test('decode value v, then priority-encode the one-hot, and get v back', () => {
    for (let v = 0; v < 8; v++) {
      const decoded = logicBlock(BINARY_DECODER_3_8, busInputs('a', 3, v))
      const oneHot = Array.from({ length: 8 }, (_, y) => decoded(`y${y}`))
      const active = oneHot.flatMap((hi, j) => (hi ? [j] : []))
      const r = encoderReads(PRIORITY_ENCODER_8_3, 3, active, 8)
      expect(r.value, `round-trip of ${v}`).toBe(v)
      expect(r.gs).toBe(true)
    }
  })
})
