/**
 * FPGA fabric — Stage 1, increment 1: the LUT atom + its evaluation (fpga-fabric.ts).
 * Proves the load-bearing foundation: a k-LUT is exactly its truth table (a config lookup, LSB-first),
 * and — crucially — it evaluates through the REAL logic engine (`stepLogic`) with NO change to that
 * engine, because it rides the same `fn: (boolean[]) => boolean[]` gate contract the 0/1 engine already
 * uses. Everything the mini-VPR builds later (mapper, packer, router, sim binding) stands on this.
 */
import { describe, expect, test } from 'vitest'
import { type KLut, lutConfigSize, lutFn, lutIndex } from '../src/renderer/fpga-fabric.ts'
import { type CompiledLogic, stepLogic } from '../src/renderer/logic-sim.ts'

/** The LSB-first input pattern for truth-table index i (input j = bit j of i) — the same convention lutIndex uses. */
const inputsFor = (i: number, k: number): boolean[] =>
  Array.from({ length: k }, (_, j) => (i & (1 << j)) !== 0)

describe('LUT index + config size', () => {
  test('a k-LUT holds 2^k config bits', () => {
    expect(lutConfigSize(1)).toBe(2)
    expect(lutConfigSize(4)).toBe(16)
    expect(lutConfigSize(6)).toBe(64)
  })

  test('inputs select the truth-table index LSB-first (input 0 = the LSB)', () => {
    expect(lutIndex([false, false, false, false])).toBe(0)
    expect(lutIndex([true, false, false, false])).toBe(1)
    expect(lutIndex([false, true, false, false])).toBe(2)
    expect(lutIndex([true, false, true, false])).toBe(5)
    expect(lutIndex([true, true, true, true])).toBe(15)
  })
})

describe('lutFn — a LUT is its truth table', () => {
  test('over ALL 2^4 inputs, a 4-LUT returns exactly its config (a wrong index mapping fails)', () => {
    // deliberately irregular so a bit-order or off-by-one bug can't pass by luck
    const config = [
      true,
      false,
      false,
      true,
      true,
      true,
      false,
      false,
      false,
      true,
      true,
      false,
      true,
      false,
      true,
      true,
    ]
    const fn = lutFn(config)
    for (let i = 0; i < 16; i++) expect(fn(inputsFor(i, 4))[0]).toBe(config[i])
  })

  test('a 4-LUT can realize a specific function — 4-input AND', () => {
    const and4 = Array.from({ length: 16 }, (_, i) => i === 15) // high only when all four inputs are high
    const fn = lutFn(and4)
    expect(fn([true, true, true, true])[0]).toBe(true)
    expect(fn([true, true, true, false])[0]).toBe(false)
    expect(fn([false, false, false, false])[0]).toBe(false)
  })

  test('an unset/short config entry reads false, never true', () => {
    expect(lutFn([])([false])[0]).toBe(false)
    expect(lutFn([false, false])([true])[0]).toBe(false)
  })

  test('a KLut config length matches 2^k', () => {
    const lut: KLut = {
      id: 'L0',
      k: 4,
      config: Array(16).fill(false),
      inputs: ['i0', 'i1', 'i2', 'i3'],
      output: 'y',
    }
    expect(lut.config.length).toBe(lutConfigSize(lut.k))
  })
})

describe('a LUT evaluates through the real logic engine (stepLogic) with no engine change', () => {
  test('a hand-built CompiledLogic of one LUT gate matches its truth table over all 16 inputs', () => {
    const config = [
      true,
      false,
      true,
      true,
      false,
      false,
      true,
      false,
      true,
      true,
      false,
      false,
      false,
      true,
      true,
      false,
    ]
    for (let i = 0; i < 16; i++) {
      const bits = inputsFor(i, 4)
      // One LUT gate (the exact `{ fn, ins, out }` shape stepLogic evaluates), inputs fixed by seeds.
      const compiled: CompiledLogic = {
        gates: [{ fn: lutFn(config), ins: ['i0', 'i1', 'i2', 'i3'], out: 'y' }],
        seeds: [
          { net: 'i0', high: bits[0] as boolean },
          { net: 'i1', high: bits[1] as boolean },
          { net: 'i2', high: bits[2] as boolean },
          { net: 'i3', high: bits[3] as boolean },
        ],
        portNet: (_nodeId, handle) => handle,
        cutNets: [],
      }
      const result = stepLogic(compiled)
      expect(result.settled).toBe(true)
      expect(result.value('lut', 'y')).toBe(config[i])
    }
  })
})
