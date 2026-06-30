/**
 * Digital blocks auto-route to the fast logic engine. `blockIsLogicCompatible` is the gate: a block that
 * flattens (down to logic gates) into nothing but gates + the passives the engine handles is simulated
 * EXACTLY by the logic engine, so it DEFAULTS to logic fidelity (the ~1000× win over the transistor solve)
 * — no manual toggle. A block with any analog part stays on the transistor solver (the engine would
 * silently drop that part). This guards the auto-detection wired into App's isLogicFidelity.
 */

import { describe, expect, test } from 'vitest'
import {
  ACTIVE_MATRIX_PIXEL,
  DOT_MATRIX_MUX_8X8,
  FULL_ADDER_BLOCK,
  RIPPLE_CARRY_4BIT,
} from '../src/renderer/builtin-blocks.ts'
import { blockIsLogicCompatible } from '../src/renderer/logic-sim.ts'

describe('auto logic-fidelity — purely-digital blocks take the fast path by default', () => {
  test('blocks made only of gates are logic-compatible (decoders/adders/chips go to the logic engine)', () => {
    expect(blockIsLogicCompatible(FULL_ADDER_BLOCK)).toBe(true)
    expect(blockIsLogicCompatible(RIPPLE_CARRY_4BIT)).toBe(true)
  })

  test('blocks with analog parts (an LED matrix, a 2T1C pixel) are NOT — they stay on the transistor solver', () => {
    expect(blockIsLogicCompatible(DOT_MATRIX_MUX_8X8)).toBe(false) // real LEDs + resistors
    expect(blockIsLogicCompatible(ACTIVE_MATRIX_PIXEL)).toBe(false) // MOSFETs + cap + LED
  })
})
