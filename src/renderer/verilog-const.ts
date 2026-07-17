/**
 * CONSTANT-EXPRESSION EVALUATION — the compile-time integer arithmetic Verilog elaboration does before any
 * gates exist: a `parameter`/`localparam` value, a bus range `[W-1:0]`, a memory depth `[0:D-1]`, a constant
 * bit/part-select `x[W-1:0]`, a replication count `{W{…}}`. All of these must fold to an exact integer (and a
 * bit width) at elaboration time — they size the hardware, so a wrong fold is a silent miscompile.
 *
 * This lives in its own module (not verilog-synth) because verilog-import.ts needs it too (to size declared
 * buses before any expression is synthesized), and import must not depend on the synth engine. It is a pure
 * integer+width evaluator — NOT gate synthesis — so it can't reference nets; a non-constant operand (any net
 * reference) makes the whole expression fold to `undefined`, which every caller reports rather than fakes.
 *
 * Widths follow IEEE 1364-2005 self-determined sizing (max of the operands for + − * / % & | ^, the left
 * operand for shifts, 1 for comparisons/logical), and every result is wrapped to its width EXACTLY as the
 * hardware would — so a sized `4'd15 + 4'd1` folds to 0, matching verilog-synth's foldConst.
 */

import type { Tok } from './verilog-import.ts'

/** A folded constant: its unsigned value and the bit width it was computed at. */
export type ConstVal = { value: bigint; width: number }

/** Sanity ceilings on an elaborated size. A fold beyond these is a typo or an unsigned underflow (a `[W-1:0]`
 *  with W=0 wraps to ~4.3 billion), NOT real hardware — the callers report it rather than try to build a
 *  multi-gigabit bus / word count and hang. Generous enough that no realistic design ever trips them. */
export const MAX_WIDTH = 65536
export const MAX_REPL = 65536

/** Binary-operator binding power (the IEEE 1364-2005 Table 5-4 ladder); `?:` is handled specially. */
const BP: Record<string, number> = {
  '||': 2,
  '&&': 3,
  '|': 4,
  '^': 5,
  '~^': 5,
  '^~': 5,
  '&': 6,
  '==': 7,
  '!=': 7,
  '<': 8,
  '<=': 8,
  '>': 8,
  '>=': 8,
  '<<': 9,
  '>>': 9,
  '+': 10,
  '-': 10,
  '*': 11,
  '/': 11,
  '%': 11,
  '**': 12,
}

const twoW = (w: number): bigint => 1n << BigInt(Math.max(0, w))
/** Wrap a value into an unsigned `w`-bit field (two's-complement for negatives), exactly like the hardware. */
const wrap = (v: bigint, w: number): bigint => {
  const m = twoW(w)
  return ((v % m) + m) % m
}
const maskOf = (w: number): bigint => twoW(w) - 1n

/** A Verilog integer literal → its {value, width}: a based literal `n'bdoh…` (width n, or 32 if unsized), or a
 *  plain decimal (width 32). x/z digits or an unparseable literal ⇒ undefined (not a constant). */
export function numLiteral(v: string): ConstVal | undefined {
  const based = v.match(/^(\d*)'[sS]?([bBoOdDhH])([0-9a-fA-F_]+)$/)
  if (based === null) {
    if (/^[0-9][0-9_]*$/.test(v)) return { value: BigInt(v.replace(/_/g, '')), width: 32 }
    return undefined
  }
  const width = based[1] === '' ? 32 : Number.parseInt(based[1] as string, 10)
  // Reject an absurd literal width (`10000000000'h1`) before it builds a multi-gigabit bigint and hangs.
  if (!(width > 0) || width > MAX_WIDTH) return undefined
  const digits = (based[3] as string).replace(/_/g, '')
  const base = { b: 2, o: 8, d: 10, h: 16 }[(based[2] as string).toLowerCase()] as number
  let val: bigint
  try {
    val =
      base === 16
        ? BigInt(`0x${digits}`)
        : base === 8
          ? BigInt(`0o${digits}`)
          : base === 2
            ? BigInt(`0b${digits}`)
            : BigInt(digits)
  } catch {
    return undefined
  }
  return { value: wrap(val, width), width }
}

/** Split range/select inner tokens at the single top-level `:` into [hi, lo] spans, or undefined if there
 *  isn't exactly one (a bare index, or a `:` nested inside a `?:` / select). */
export function splitOnColon(inner: Tok[]): [Tok[], Tok[]] | undefined {
  let depth = 0
  let idx = -1
  for (let i = 0; i < inner.length; i++) {
    const v = (inner[i] as Tok).v
    if (v === '(' || v === '[' || v === '{') depth += 1
    else if (v === ')' || v === ']' || v === '}') depth -= 1
    else if (depth === 0 && v === ':') {
      if (idx !== -1) return undefined
      idx = i
    }
  }
  if (idx === -1) return undefined
  return [inner.slice(0, idx), inner.slice(idx + 1)]
}

/** Fold a token span to a non-negative integer (a bit index, part-select bound, replication count), or
 *  undefined if it isn't a constant that fits a safe integer. */
export function constInt(toks: Tok[], params?: Map<string, ConstVal>): number | undefined {
  const v = evalConst(toks, params)
  if (v === undefined) return undefined
  const n = Number(v.value)
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined
}

class TS {
  i = 0
  constructor(readonly ts: Tok[]) {}
  peek(o = 0): Tok | undefined {
    return this.ts[this.i + o]
  }
  next(): Tok | undefined {
    return this.ts[this.i++]
  }
}

/** Evaluate a token span as a constant expression, resolving parameter identifiers via `params`. Returns the
 *  folded {value, width}, or undefined if any operand is non-constant (a net, an unsupported op, malformed). */
export function evalConst(tokens: Tok[], params?: Map<string, ConstVal>): ConstVal | undefined {
  const ts = new TS(tokens)
  if (ts.peek() === undefined) return undefined
  const e = parse(ts, 0, params)
  if (e === undefined || ts.peek() !== undefined) return undefined
  return e
}

function parse(ts: TS, minBP: number, params?: Map<string, ConstVal>): ConstVal | undefined {
  let left = parseUnary(ts, params)
  if (left === undefined) return undefined
  for (;;) {
    const t = ts.peek()
    if (t === undefined) break
    if (t.v === '?') {
      if (1 < minBP) break
      ts.next()
      const a = parse(ts, 0, params)
      if (a === undefined || ts.peek()?.v !== ':') return undefined
      ts.next()
      const b = parse(ts, 1, params)
      if (b === undefined) return undefined
      const w = Math.max(a.width, b.width)
      const chosen: ConstVal = left.value !== 0n ? a : b
      left = { value: wrap(chosen.value, w), width: w }
      continue
    }
    if (t.k !== 'op') break
    const bp = BP[t.v]
    if (bp === undefined || bp < minBP) break
    ts.next()
    const right = parse(ts, bp + 1, params)
    if (right === undefined) return undefined
    const r = applyBin(t.v, left, right)
    if (r === undefined) return undefined
    left = r
  }
  return left
}

function parseUnary(ts: TS, params?: Map<string, ConstVal>): ConstVal | undefined {
  const t = ts.peek()
  if (t?.k === 'op' && (t.v === '-' || t.v === '+' || t.v === '~' || t.v === '!')) {
    ts.next()
    const a = parseUnary(ts, params)
    if (a === undefined) return undefined
    if (t.v === '+') return a
    if (t.v === '-') return { value: wrap(-a.value, a.width), width: a.width }
    if (t.v === '~') return { value: maskOf(a.width) ^ (a.value & maskOf(a.width)), width: a.width }
    return { value: a.value === 0n ? 1n : 0n, width: 1 } // !
  }
  return parsePrimary(ts, params)
}

function parsePrimary(ts: TS, params?: Map<string, ConstVal>): ConstVal | undefined {
  const t = ts.next()
  if (t === undefined) return undefined
  if (t.v === '(') {
    const e = parse(ts, 0, params)
    if (e === undefined || ts.peek()?.v !== ')') return undefined
    ts.next()
    return e
  }
  if (t.k === 'num') return numLiteral(t.v)
  if (t.k === 'id') return params?.get(t.v)
  return undefined
}

function applyBin(op: string, a: ConstVal, b: ConstVal): ConstVal | undefined {
  const va = a.value
  const vb = b.value
  switch (op) {
    case '==':
      return { value: va === vb ? 1n : 0n, width: 1 }
    case '!=':
      return { value: va !== vb ? 1n : 0n, width: 1 }
    case '<':
      return { value: va < vb ? 1n : 0n, width: 1 }
    case '<=':
      return { value: va <= vb ? 1n : 0n, width: 1 }
    case '>':
      return { value: va > vb ? 1n : 0n, width: 1 }
    case '>=':
      return { value: va >= vb ? 1n : 0n, width: 1 }
    case '&&':
      return { value: va !== 0n && vb !== 0n ? 1n : 0n, width: 1 }
    case '||':
      return { value: va !== 0n || vb !== 0n ? 1n : 0n, width: 1 }
  }
  const w = op === '<<' || op === '>>' || op === '**' ? a.width : Math.max(a.width, b.width)
  let v: bigint
  switch (op) {
    case '+':
      v = va + vb
      break
    case '-':
      v = va - vb
      break
    case '*':
      v = va * vb
      break
    case '/':
      if (vb === 0n) return undefined
      v = va / vb
      break
    case '%':
      if (vb === 0n) return undefined
      v = va % vb
      break
    case '<<':
      v = vb >= BigInt(w) ? 0n : va << vb
      break
    case '>>':
      v = va >> vb
      break
    case '**':
      if (vb < 0n || vb > 4096n) return undefined
      v = va ** vb
      break
    case '&':
      v = va & vb
      break
    case '|':
      v = va | vb
      break
    case '^':
      v = va ^ vb
      break
    case '~^':
    case '^~':
      v = ~(va ^ vb)
      break
    default:
      return undefined
  }
  return { value: wrap(v, w), width: w }
}
