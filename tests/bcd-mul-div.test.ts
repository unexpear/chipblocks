/**
 * Calculator bricks ④⑤ — multiply + divide the real calculator way: sequential control that REUSES the
 * one BCD add/subtract ALU. Multiply is shift-add, divide is shift-subtract (long division); every + / −
 * is solved by the real BCD_ALU_10 gate circuit. These tests drive the actual controllers and check the
 * results against plain a*b and a/b — so the decimal product and quotient come out of real gates.
 */

import { describe, expect, test } from 'vitest'
import { bcdDivide, bcdMultiply } from '../src/renderer/bcd-sequential.ts'

describe('multiply — shift-add on the real ALU', () => {
  test.each([
    [12, 34],
    [123, 456],
    [99, 99],
    [7, 8],
    [0, 5],
    [5, 0],
    [1000, 1000],
  ])('%d × %d', (a, b) => {
    expect(bcdMultiply(a, b)).toBe(a * b)
  })
})

describe('divide — shift-subtract (long division) on the real ALU', () => {
  test.each([
    [408, 34], // 12 r 0
    [1000, 7], // 142 r 6
    [56088, 456], // 123 r 0
    [5, 5], // 1 r 0
    [3, 5], // 0 r 3 (divisor bigger)
    [100, 1], // 100 r 0
    [9999, 3], // 3333 r 0
  ])('%d ÷ %d', (a, b) => {
    expect(bcdDivide(a, b)).toEqual({ quotient: Math.floor(a / b), remainder: a % b })
  })

  test('divide by zero is guarded', () => {
    expect(bcdDivide(42, 0)).toEqual({ quotient: 0, remainder: 42 })
  })
})
