import type { CanvasEdgeLike, CanvasNodeLike } from './blocks.ts'
import { BCD_ALU_10 } from './builtin-blocks.ts'
import { simulateLogic } from './logic-sim.ts'

/**
 * Multiply and divide the REAL calculator way — sequential control that reuses the one BCD add/subtract
 * ALU instead of being giant separate circuits. Every single + / − here is done by the actual
 * BCD_ALU_10 gate circuit (solved through simulateLogic); only the SEQUENCING (which operand, how many
 * times, what shift) lives in code — the calculator's microcode/control, to become a real clocked FSM
 * later. Multiply = shift-add (for each digit of B, add A shifted, that many times). Divide = shift-
 * subtract = long division (for each place, subtract the shifted divisor until it no longer fits; that
 * count is the quotient digit). Operands assumed to keep intermediate results within the 10 BCD digits.
 */

const TEN10 = 10 ** 10
const supply = (v: number) => ({
  nominal_voltage: { value: { kind: 'scalar', amount: v, unit: 'volt' } },
})
const digitBits = (n: number, d: number) => {
  const dig = Math.floor(n / 10 ** d) % 10
  return [0, 1, 2, 3].map((i) => ((dig >> i) & 1) === 1)
}

/** One pass through the real ALU: result = A + B (sub=false) or A − B (sub=true), with the carry-out
 *  (Cout=1 ⇒ A≥B, a valid subtraction). This is the only arithmetic — the gate circuit does it. */
function aluOp(a: number, b: number, sub: boolean): { result: number; cout: number } {
  const w = (id: string, s: string, sh: string, t: string, th: string): CanvasEdgeLike => ({
    id,
    source: s,
    sourceHandle: sh,
    target: t,
    targetHandle: th,
  })
  const nodes: CanvasNodeLike[] = [
    { id: 'U', position: { x: 0, y: 0 }, data: { definition: 'block', block: BCD_ALU_10 } },
    { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
    {
      id: 'vp',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(5) },
    },
    {
      id: 'vs',
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(sub ? 5 : 0) },
    },
  ]
  const edges: CanvasEdgeLike[] = [
    w('wp', 'vp', 'terminal_positive', 'U', 'v_dd'),
    w('wpn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    w('wg', 'U', 'gnd', 'g', 'reference_terminal'),
    w('ws', 'vs', 'terminal_positive', 'U', 'sub'),
    w('wsn', 'vs', 'terminal_negative', 'g', 'reference_terminal'),
  ]
  for (let d = 0; d < 10; d++) {
    const ab = digitBits(a, d)
    const bb = digitBits(b, d)
    for (let i = 0; i < 4; i++) {
      const bit = d * 4 + i
      nodes.push({
        id: `va${bit}`,
        position: { x: 0, y: 0 },
        data: { definition: 'power_source', parameters: supply(ab[i] ? 5 : 0) },
      })
      nodes.push({
        id: `vb${bit}`,
        position: { x: 0, y: 0 },
        data: { definition: 'power_source', parameters: supply(bb[i] ? 5 : 0) },
      })
      edges.push(w(`wa${bit}`, `va${bit}`, 'terminal_positive', 'U', `a${bit}`))
      edges.push(w(`wan${bit}`, `va${bit}`, 'terminal_negative', 'g', 'reference_terminal'))
      edges.push(w(`wb${bit}`, `vb${bit}`, 'terminal_positive', 'U', `b${bit}`))
      edges.push(w(`wbn${bit}`, `vb${bit}`, 'terminal_negative', 'g', 'reference_terminal'))
    }
  }
  const r = simulateLogic(nodes, edges)
  const bit = (h: string) => (r.value('U', h) === true ? 1 : 0)
  let result = 0
  for (let d = 0; d < 10; d++) {
    result +=
      (bit(`s${d * 4}`) +
        2 * bit(`s${d * 4 + 1}`) +
        4 * bit(`s${d * 4 + 2}`) +
        8 * bit(`s${d * 4 + 3}`)) *
      10 ** d
  }
  return { result, cout: bit('cout') }
}

/** A × B by shift-add: for each decimal digit of B, add (A shifted into that place) that many times —
 *  every addition done by the real BCD ALU. At most ~Σ digits-of-B additions, not 10^10. */
export function bcdMultiply(a: number, b: number): number {
  let result = 0
  for (let d = 0; d < 10; d++) {
    const bd = Math.floor(b / 10 ** d) % 10
    if (bd === 0) continue
    const shifted = (a * 10 ** d) % TEN10
    for (let k = 0; k < bd; k++) result = aluOp(result, shifted, false).result
  }
  return result
}

/** A ÷ B as long division by shift-subtract: for each place (high→low), subtract the shifted divisor by
 *  the real ALU until it no longer fits (Cout=0); the number of successful subtractions is that quotient
 *  digit. Returns the whole quotient and the remainder. Divide-by-zero returns quotient 0, remainder A. */
export function bcdDivide(a: number, b: number): { quotient: number; remainder: number } {
  if (b <= 0) return { quotient: 0, remainder: a }
  let rem = a
  let quotient = 0
  for (let d = 9; d >= 0; d--) {
    if (b > rem / 10 ** d) continue // shifted divisor already exceeds the remainder — that digit is 0
    const shifted = b * 10 ** d
    let count = 0
    for (let k = 0; k < 10; k++) {
      const { result, cout } = aluOp(rem, shifted, true)
      if (cout === 0) break // rem < shifted → can't subtract again
      rem = result
      count++
    }
    quotient += count * 10 ** d
  }
  return { quotient, remainder: rem }
}
