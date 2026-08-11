/**
 * RTL SYNTHESIS (increment 2 — combinational) — turn a continuous assignment `assign y = expr;` into REAL
 * gates. Where the structural importer reads a netlist of pre-drawn gates, this SYNTHESIZES the gates from a
 * higher-level expression and feeds them to the SAME lowering (so they wire + place + power like any drawn
 * gate; the gates stay the real, simulatable source of truth).
 *
 * 2a shipped SCALAR boolean synthesis. 2b added BUSES + ARITHMETIC: multi-bit nets `[N:0]`, bit-select
 * a[i], part-select a[h:l], concatenation {a,b}, replication {n{a}}, reduction operators, and unsigned
 * ripple-carry `+`/`-` (a − b = a + ~b + 1). 3 added SEQUENTIAL logic (`always @(posedge clk)` → flip-flops).
 * 6 adds the remaining unsigned ARITHMETIC/RELATIONAL operators: logical shifts `<<`/`>>` (constant reindex or
 * a barrel shifter — the left operand is context-sized, the amount self-determined), magnitude comparisons
 * `< <= > >=` (a subtract's carry-out: a≥b ⟺ no borrow), and unsigned multiply `*` (a partial-product AND
 * array summed at the context width). Signed values, `<<<`/`>>>`, and `/ % **` are still REPORTED, not faked.
 * 4 (memory) adds MEMORY ARRAYS + COMPUTED ADDRESSING: a `reg [D-1:0] m [0:W-1]` becomes W real D-bit
 * word-registers; a read `m[addr]` synthesizes a one-hot address decoder + read mux (the gate Data RAM's read
 * path) and a clocked write `m[addr] <= x` synthesizes per-word write-enable logic — the address may be a
 * computed expression, not just a constant. Everything is BIT-BLASTED to scalar bit-nets (a bus `a` of width N
 * → bit-nets a[0]…a[N-1], LSB = a[0]; memory word k → the register m[k]; brackets can't appear in a simple
 * identifier, so neither collides with a scalar net) and synthesized bit-by-bit with two-pass, context-
 * determined width sizing. Precedence + widths + operator constructions were adversarially verified vs IEEE
 * 1364-2005. Anything still out of scope — `* / % << >> ** < <= > >=`, signed, x/z, non-constant or nonzero-
 * based selects, a bit-select on a memory read, an unclocked assign to a memory — is REPORTED, never faked.
 */

import { constInt, MAX_REPL, splitOnColon } from './verilog-const.ts'
import type {
  AlwaysBlock,
  Assign,
  FlopInst,
  FuncDef,
  GateInst,
  MemInfo,
  PowerOnValue,
  RawGate,
  RefusedDriver,
  TaskArg,
  TaskDef,
  Tok,
  UnbuiltReport,
} from './verilog-import.ts'
import { assignmentTargets } from './verilog-import.ts'

/** Declared memories, by name (`reg [D-1:0] m [0:W-1]`). Threaded through the parser so `m[addr]` becomes a
 *  memory read/write rather than a (rejected) non-constant bit-select. */
type MemTable = Map<string, MemInfo>

// ── expression AST ────────────────────────────────────────────────────────────
/** One bit of a literal: known, or Verilog's don't-care `x` (see the Bit type for what that means here). */
type ConstBit = 0 | 1 | 'x'
type Expr =
  | { t: 'net'; name: string }
  | { t: 'const'; bits: ConstBit[]; signed?: boolean } // LSB-first, length = width; signed = an `'sd`/plain-int literal
  | { t: 'bitsel'; name: string; index: number }
  | { t: 'partsel'; name: string; hi: number; lo: number }
  | { t: 'concat'; parts: Expr[] } // MSB-first (leftmost is the high bits)
  | { t: 'repl'; count: number; of: Expr }
  | { t: 'un'; op: string; a: Expr }
  | { t: 'bin'; op: string; a: Expr; b: Expr }
  | { t: 'tern'; c: Expr; a: Expr; b: Expr }
  | { t: 'memread'; name: string; idx: Expr; width: number; depth: number } // m[addr] — a decode/read-mux
  // a function call `f(a,b)`: inlined at its DECLARED return width (retWidth/fn are filled by bindCalls once
  // the function table is known — at parse time only name+args exist).
  | { t: 'call'; name: string; args: Expr[]; retWidth?: number; fn?: FuncDef }
  // a self-determined WIDTH WALL: evaluate `of` at exactly `width` bits (truncate/zero-extend), regardless of
  // the surrounding context — how a function's inputs/locals/return honor their declared widths exactly.
  | { t: 'sized'; width: number; of: Expr }
  // a `$signed(x)` / `$unsigned(x)` cast: re-interpret `of` as signed / unsigned (changes only how it extends).
  | { t: 'cast'; signed: boolean; of: Expr }
  | { t: 'bad'; why: string }

/** The synthetic net name of memory word k (bracket form — can't collide with a user simple identifier). */
const memWord = (name: string, k: number): string => `${name}[${k}]`
/** Address-bus width for a W-word memory (⌈log2 W⌉, at least 1). */
const clog2 = (words: number): number => Math.max(1, Math.ceil(Math.log2(Math.max(2, words))))
/** The value of an expression that folds to a constant (all bits known), else undefined. Synthesizes into a
 *  throwaway context so it reuses synthAt's EXACT-width folding — `3+2` folds to 5, but a sized `4'd15+4'd1`
 *  wraps to 0 exactly as the hardware would, so no false out-of-range report. Any net reference ⇒ undefined. */
function foldConst(e: Expr, widthOf: (n: string) => number): number | undefined {
  // A function call is never a compile-time constant (it synthesizes gates) and can't inline in the throwaway
  // fold ctx (no funcs/tie) — so treat any tree containing one as non-constant rather than fold it wrong.
  if (hasCall(e)) return undefined
  let z = 0
  const bits = synthAt(e, selfWidth(e, widthOf), false, {
    gates: [],
    fresh: () => `#fold${z++}`,
    widthOf,
    bitNet: (n, i) => `${n}[${i}]`,
  })
  let v = 0
  for (let i = 0; i < bits.length; i++) {
    const b = bits[i]
    if (b === undefined || !isC(b)) return undefined
    if (b.c) v += 2 ** i
  }
  return v
}

/** Binary-operator binding power (higher binds tighter), the IEEE 1364-2005 Table 5-4 ladder. `?:` (loosest)
 *  is handled specially. Unsupported operators still get real slots so supported neighbours group correctly. */
const INFIX_BP: Record<string, number> = {
  '||': 2,
  '&&': 3,
  '|': 4,
  '^': 5,
  '~^': 5,
  '^~': 5,
  '&': 6,
  '==': 7,
  '!=': 7,
  '===': 7,
  '!==': 7,
  '==?': 7,
  '!=?': 7,
  '<': 8,
  '<=': 8,
  '>': 8,
  '>=': 8,
  '<<': 9,
  '>>': 9,
  '<<<': 9,
  '>>>': 9,
  '+': 10,
  '-': 10,
  '*': 11,
  '/': 11,
  '%': 11,
  '**': 12,
}
// Magnitude comparisons — 1-bit results, computed by a subtract's carry-out (signed when both operands are).
const RELATIONAL = new Set(['<', '<=', '>', '>='])
const SUPPORTED_BIN = new Set([
  '||',
  '&&',
  '|',
  '^',
  '~^',
  '^~',
  '&',
  '==',
  '!=',
  '+',
  '-',
  '*',
  '/',
  '%',
  '<<',
  '>>',
  '<<<', // arithmetic left shift = logical left shift
  '>>>', // arithmetic right shift (sign-fill for a signed left operand)
  '<',
  '<=',
  '>',
  '>=',
])
const UNARY = new Set(['~', '!', '&', '|', '^', '~&', '~|', '~^', '^~', '+', '-'])
const SUPPORTED_UN = new Set(['~', '!', '&', '|', '^', '~&', '~|', '~^', '^~', '+', '-'])

class TokStream {
  i = 0
  constructor(readonly ts: Tok[]) {}
  peek(o = 0): Tok | undefined {
    return this.ts[this.i + o]
  }
  next(): Tok | undefined {
    return this.ts[this.i++]
  }
}

function parseRhs(tokens: Tok[], mems: MemTable): Expr {
  const ts = new TokStream(tokens)
  if (ts.peek() === undefined) return { t: 'bad', why: 'empty right-hand side' }
  const e = parseExpr(ts, 0, mems)
  if (e.t === 'bad') return e
  if (ts.peek() !== undefined)
    return { t: 'bad', why: `trailing "${ts.peek()?.v}" after the expression` }
  return e
}

function parseExpr(ts: TokStream, minBP: number, mems: MemTable): Expr {
  let left = parseUnary(ts, mems)
  for (;;) {
    const t = ts.peek()
    if (t === undefined) break
    if (t.v === '?') {
      if (1 < minBP) break
      ts.next()
      const then = parseExpr(ts, 0, mems)
      if (ts.peek()?.v !== ':') return { t: 'bad', why: 'conditional ?: is missing its ":"' }
      ts.next()
      const els = parseExpr(ts, 1, mems)
      left = { t: 'tern', c: left, a: then, b: els }
      continue
    }
    if (t.k !== 'op') break
    const bp = INFIX_BP[t.v]
    if (bp === undefined || bp < minBP) break
    if (!SUPPORTED_BIN.has(t.v))
      return { t: 'bad', why: `operator "${t.v}" is not supported (a later increment)` }
    ts.next()
    const right = parseExpr(ts, bp + 1, mems)
    left = { t: 'bin', op: t.v, a: left, b: right }
  }
  return left
}

function parseUnary(ts: TokStream, mems: MemTable): Expr {
  const t = ts.peek()
  if (t?.k === 'op' && UNARY.has(t.v)) {
    if (!SUPPORTED_UN.has(t.v))
      return { t: 'bad', why: `unary "${t.v}" is not supported (a later increment)` }
    ts.next()
    return { t: 'un', op: t.v, a: parseUnary(ts, mems) }
  }
  return parsePrimary(ts, mems)
}

/** Read the tokens inside a `[ … ]` at the cursor (positioned just past `[`), balancing nested brackets, and
 *  leave the cursor just past the matching `]`. */
function readBracket(ts: TokStream): Tok[] {
  const inner: Tok[] = []
  let depth = 1
  while (ts.peek() !== undefined && depth > 0) {
    const tk = ts.next() as Tok
    if (tk.v === '[') depth++
    else if (tk.v === ']') {
      depth--
      if (depth === 0) break
    }
    inner.push(tk)
  }
  return inner
}

function parsePrimary(ts: TokStream, mems: MemTable): Expr {
  const t = ts.next()
  if (t === undefined) return { t: 'bad', why: 'unexpected end of expression' }
  if (t.v === '(') {
    const e = parseExpr(ts, 0, mems)
    if (ts.peek()?.v !== ')') return { t: 'bad', why: 'missing ")"' }
    ts.next()
    return e
  }
  if (t.k === 'sys' && (t.v === '$signed' || t.v === '$unsigned')) {
    if (ts.peek()?.v !== '(') return { t: 'bad', why: `${t.v} must be called as ${t.v}(expr)` }
    const argToks = readCallArgs(ts)
    if (argToks.length !== 1) return { t: 'bad', why: `${t.v} takes exactly one argument` }
    const of = parseRhs(argToks[0] as Tok[], mems)
    if (of.t === 'bad') return of
    return { t: 'cast', signed: t.v === '$signed', of }
  }
  if (t.v === '{') return parseBraces(ts, mems)
  if (t.k === 'num') return constExpr(t.v)
  if (t.k === 'id') {
    const mem = mems.get(t.v)
    if (mem !== undefined) {
      // A memory read m[addr]: parse the index as a FULL expression (it may be computed, unlike a bit-select).
      if (ts.peek()?.v !== '[')
        return { t: 'bad', why: `memory "${t.v}" used as a plain value — index it as ${t.v}[addr]` }
      ts.next() // '['
      const idx = parseRhs(readBracket(ts), mems)
      if (idx.t === 'bad') return { t: 'bad', why: `memory index — ${idx.why}` }
      if (ts.peek()?.v === '[')
        return {
          t: 'bad',
          why: `a bit-select on a memory read (${t.v}[addr][b]) is a later increment`,
        }
      return { t: 'memread', name: t.v, idx, width: mem.width, depth: mem.depth }
    }
    // A function call `f(arg, arg, …)`: an id followed by `(` is always a call in the expression subset (the
    // only other id-then-paren is a module instance, never inside an expression). Resolved by bindCalls later.
    if (ts.peek()?.v === '(') {
      const argToks = readCallArgs(ts)
      const args = argToks.map((a) => parseRhs(a, mems))
      const bad = args.find((a) => a.t === 'bad')
      if (bad !== undefined)
        return { t: 'bad', why: `argument to "${t.v}" — ${(bad as { why: string }).why}` }
      return { t: 'call', name: t.v, args }
    }
    if (ts.peek()?.v === '[') return parseSelect(ts, t.v)
    return { t: 'net', name: t.v }
  }
  return { t: 'bad', why: `unexpected "${t.v}"` }
}

/** After an id, a `[ … ]`: bit-select `[i]` or part-select `[h:l]`. Bounds fold as constant expressions
 *  (a parameter has already been substituted to a literal), so `[W-1:0]` / `[W-1]` size correctly. */
function parseSelect(ts: TokStream, name: string): Expr {
  ts.next() // '['
  const inner: Tok[] = []
  let depth = 0
  while (ts.peek() !== undefined && !(depth === 0 && ts.peek()?.v === ']')) {
    const tk = ts.next() as Tok
    if (tk.v === '[' || tk.v === '(' || tk.v === '{') depth += 1
    else if (tk.v === ']' || tk.v === ')' || tk.v === '}') depth -= 1
    inner.push(tk)
  }
  if (ts.peek()?.v !== ']') return { t: 'bad', why: 'missing "]"' }
  ts.next()
  const parts = splitOnColon(inner)
  if (parts !== undefined) {
    // an indexed part-select a[b+:W] / a[b-:W] (a trailing '+'/'-' before the ':') is a later increment
    const last = parts[0][parts[0].length - 1]
    if (last?.v === '+' || last?.v === '-')
      return { t: 'bad', why: 'an indexed part-select a[b+:W] needs a later increment' }
    const hi = constInt(parts[0])
    const lo = constInt(parts[1])
    if (hi === undefined || lo === undefined)
      return { t: 'bad', why: 'a non-constant part-select needs a later increment' }
    if (hi < lo) return { t: 'bad', why: 'ascending part-select is unsupported' }
    return { t: 'partsel', name, hi, lo }
  }
  const index = constInt(inner)
  if (index === undefined)
    return { t: 'bad', why: 'a non-constant bit-select needs a later increment' }
  return { t: 'bitsel', name, index }
}

/** `{ e0, e1, … }` concatenation or `{ n { e } }` replication. */
function parseBraces(ts: TokStream, mems: MemTable): Expr {
  // replication if the first inner token is a constant immediately followed by '{' (a parameter count `{W{…}}`
  // has already been substituted to a single sized-literal token, so it still matches this `num {` shape).
  const first = ts.peek()
  if (first?.k === 'num' && ts.peek(1)?.v === '{') {
    const count = constInt([first])
    ts.next() // count
    ts.next() // inner '{'
    const of = parseConcatBody(ts, mems)
    if (of.t === 'bad') return of
    if (ts.peek()?.v !== '}') return { t: 'bad', why: 'missing "}" after replication' }
    ts.next()
    if (count === undefined || count < 0)
      return { t: 'bad', why: 'a non-constant replication count needs a later increment' }
    // Guard an underflowed/huge count (a parameter `{W-1{…}}` with W=0 wraps to ~4.3 billion) before the
    // replication loop expands it into billions of bits and hangs.
    if (count > MAX_REPL)
      return { t: 'bad', why: `replication count ${count} is unreasonably large — reported` }
    return { t: 'repl', count, of }
  }
  return parseConcatBody(ts, mems)
}

/** The comma-separated body of a `{ … }`, up to (not consuming) the matching '}'. */
function parseConcatBody(ts: TokStream, mems: MemTable): Expr {
  const parts: Expr[] = []
  for (;;) {
    const e = parseExpr(ts, 0, mems)
    if (e.t === 'bad') return e
    parts.push(e)
    if (ts.peek()?.v === ',') {
      ts.next()
      continue
    }
    break
  }
  if (ts.peek()?.v !== '}') return { t: 'bad', why: 'missing "}" in concatenation' }
  ts.next()
  return parts.length === 1 ? (parts[0] as Expr) : { t: 'concat', parts }
}

/** A Verilog integer literal → its LSB-first constant bits, or `bad` for x/z / unparseable. A plain unsized
 *  decimal (`42`) and an `'s`-marked based literal (`4'sd3`) are SIGNED (IEEE §3.11.1); a sized unsigned based
 *  literal (`4'd3`) is unsigned. */
function constExpr(v: string): Expr {
  const based = v.match(/^(\d*)'([sS]?)([bBoOdDhH])([0-9a-fA-FxXzZ?_]+)$/)
  if (based === null) {
    if (/^[0-9][0-9_]*$/.test(v)) return bitsOf(BigInt(v.replace(/_/g, '')), 32, true)
    return { t: 'bad', why: `constant "${v}"` }
  }
  const width = based[1] === '' ? 32 : Number.parseInt(based[1] as string, 10)
  const signed = based[2] !== ''
  const digits = (based[4] as string).replace(/_/g, '')
  // z (and its `?` spelling) is high impedance — a real third WIRE state, which a ChipBlocks net does not
  // have, so it stays refused. x is a don't-care VALUE, which folding can carry and a mask can remove.
  if (/[zZ?]/.test(digits))
    return { t: 'bad', why: 'z (high-impedance) constant is not representable' }
  if (/[xX]/.test(digits)) return unknownBitsOf(digits, based[3] as string, width, signed)
  const base = { b: 2, o: 8, d: 10, h: 16 }[(based[3] as string).toLowerCase()] as number
  const val =
    base === 16
      ? BigInt(`0x${digits}`)
      : base === 8
        ? BigInt(`0o${digits}`)
        : base === 2
          ? BigInt(`0b${digits}`)
          : BigInt(digits)
  return bitsOf(val, width, signed)
}
function bitsOf(val: bigint, width: number, signed = false): Expr {
  const bits: ConstBit[] = []
  for (let i = 0; i < width; i++) bits.push(Number((val >> BigInt(i)) & 1n) as 0 | 1)
  return signed ? { t: 'const', bits, signed: true } : { t: 'const', bits }
}

/** A literal with x digits, expanded LSB-first. Each digit contributes log2(base) bits; an x digit makes ALL
 *  of them unknown, which is what IEEE 1364-2005 §3.2 specifies for a based literal. A decimal literal cannot
 *  mix x with digits (`4'dx` is wholly unknown), so it is treated as unknown throughout. */
function unknownBitsOf(digits: string, baseChar: string, width: number, signed: boolean): Expr {
  const perDigit = { b: 1, o: 3, d: 0, h: 4 }[baseChar.toLowerCase()] as number
  const bits: ConstBit[] = []
  if (perDigit === 0) for (let i = 0; i < width; i++) bits.push('x')
  else
    for (let i = digits.length - 1; i >= 0; i--) {
      const d = digits[i] as string
      const value = /[xX]/.test(d) ? undefined : Number.parseInt(d, 16)
      for (let b = 0; b < perDigit; b++)
        bits.push(value === undefined ? 'x' : (((value >> b) & 1) as 0 | 1))
    }
  // Verilog left-extends a based literal with x when its most significant bit is x (§3.2), else with 0.
  const top = bits[bits.length - 1] ?? 'x'
  while (bits.length < width) bits.push(top === 'x' ? 'x' : 0)
  const sized = bits.slice(0, width)
  return signed ? { t: 'const', bits: sized, signed: true } : { t: 'const', bits: sized }
}

/** The first unsupported construct in the tree, or undefined if fully supported. */
function firstBad(e: Expr): string | undefined {
  switch (e.t) {
    case 'bad':
      return e.why
    case 'un':
      return firstBad(e.a)
    case 'bin':
      return firstBad(e.a) ?? firstBad(e.b)
    case 'tern':
      return firstBad(e.c) ?? firstBad(e.a) ?? firstBad(e.b)
    case 'concat':
      for (const p of e.parts) {
        const b = firstBad(p)
        if (b !== undefined) return b
      }
      return undefined
    case 'repl':
      return firstBad(e.of)
    case 'memread':
      return firstBad(e.idx)
    case 'call': {
      for (const a of e.args) {
        const b = firstBad(a)
        if (b !== undefined) return b
      }
      return undefined
    }
    case 'sized':
    case 'cast':
      return firstBad(e.of)
    default:
      return undefined
  }
}

/** The comma-separated argument spans of a call `f(a, b, …)`; cursor must be AT `(`, left just past `)`. */
function readCallArgs(ts: TokStream): Tok[][] {
  ts.next() // '('
  const slices: Tok[][] = []
  let cur: Tok[] = []
  let depth = 1
  let any = false
  while (ts.peek() !== undefined && depth > 0) {
    const tk = ts.next() as Tok
    if (tk.v === '(' || tk.v === '[' || tk.v === '{') depth += 1
    else if (tk.v === ')' || tk.v === ']' || tk.v === '}') {
      depth -= 1
      if (depth === 0) break
    }
    if (depth === 1 && tk.v === ',') {
      slices.push(cur)
      cur = []
    } else {
      cur.push(tk)
      any = true
    }
  }
  if (any || slices.length > 0) slices.push(cur)
  return slices
}

/** Resolve every `call` node against the function table: fill its return width + definition, or turn it into a
 *  `bad` (unknown function / wrong argument count). Runs on an ast BEFORE firstBad/selfWidth/synthAt so a
 *  call's declared return width is known everywhere it matters. */
function bindCalls(e: Expr, funcs: Map<string, FuncDef>): Expr {
  switch (e.t) {
    case 'call': {
      const args = e.args.map((a) => bindCalls(a, funcs))
      const fn = funcs.get(e.name)
      if (fn === undefined) return { t: 'bad', why: `call to unknown function "${e.name}"` }
      if (args.length !== fn.inputs.length)
        return {
          t: 'bad',
          why: `function "${e.name}" takes ${fn.inputs.length} argument(s), got ${args.length}`,
        }
      return { t: 'call', name: e.name, args, retWidth: fn.retWidth, fn }
    }
    case 'un':
      return { ...e, a: bindCalls(e.a, funcs) }
    case 'bin':
      return { ...e, a: bindCalls(e.a, funcs), b: bindCalls(e.b, funcs) }
    case 'tern':
      return { ...e, c: bindCalls(e.c, funcs), a: bindCalls(e.a, funcs), b: bindCalls(e.b, funcs) }
    case 'concat':
      return { ...e, parts: e.parts.map((p) => bindCalls(p, funcs)) }
    case 'repl':
      return { ...e, of: bindCalls(e.of, funcs) }
    case 'memread':
      return { ...e, idx: bindCalls(e.idx, funcs) }
    case 'sized':
    case 'cast':
      return { ...e, of: bindCalls(e.of, funcs) }
    default:
      return e
  }
}

/** Does the tree contain a function call? A call synthesizes to gates (never a compile-time constant), so a
 *  constant context (foldConst) that meets one must fall back to non-constant rather than fold it to 0. */
function hasCall(e: Expr): boolean {
  switch (e.t) {
    case 'call':
      return true
    case 'un':
      return hasCall(e.a)
    case 'sized':
    case 'cast':
      return hasCall(e.of)
    case 'bin':
      return hasCall(e.a) || hasCall(e.b)
    case 'tern':
      return hasCall(e.c) || hasCall(e.a) || hasCall(e.b)
    case 'concat':
      return e.parts.some(hasCall)
    case 'repl':
      return hasCall(e.of)
    case 'memread':
      return hasCall(e.idx)
    default:
      return false
  }
}

// ── bit-level synthesis ─────────────────────────────────────────────────────────
/** A synthesized bit: a known constant, a net, or UNKNOWN. `x` is Verilog's don't-care/uninitialised value.
 *  It is not a third wire level — a ChipBlocks net is only ever 0 or 1 — it is what we KNOW about a bit while
 *  folding. Real designs mask their x's away (`~(i ^ 8'b00xxx000) | 8'b00111000` is the 8080's own instruction
 *  decoder), and an x that survives to something that must drive a net is REPORTED, never quietly made 0. */
type Bit = { c: 0 | 1 } | { x: true } | { n: string }
const isC = (b: Bit): b is { c: 0 | 1 } => 'c' in b
const isX = (b: Bit): b is { x: true } => 'x' in b
const UNKNOWN: Bit = { x: true }
type Ctx = {
  gates: GateInst[]
  fresh: () => string
  widthOf: (name: string) => number
  bitNet: (name: string, i: number) => string
  /** Whether a declared net is `signed` (drives sign- vs zero-extension); absent ⇒ everything unsigned. */
  signedOf?: (name: string) => boolean
  /** The module's functions (for inlining a `call`) and a per-call counter for unique inlined-net names. */
  funcs?: Map<string, FuncDef>
  callSeq?: { n: number }
  /** Per-inline map of an inlined input bit-net → a folded constant argument bit. Read by the `net`/`bitsel`/
   *  `partsel` cases so a constant function argument flows through as a real constant (no tie needed), and a
   *  constant that reaches an output is tied/reported by the assign driver like any other constant. */
  constNets?: Map<string, 0 | 1 | 'x'>
}

function not1(a: Bit, x: Ctx): Bit {
  if (isX(a)) return UNKNOWN
  if (isC(a)) return { c: a.c ? 0 : 1 }
  const o = x.fresh()
  x.gates.push({ prim: 'not', terminals: [o, a.n] })
  return { n: o }
}
/** A 2-input gate (and/or/xor/xnor) with constant folding. An UNKNOWN input only survives when the other
 *  input cannot force the answer: `0 & x` is 0 and `1 | x` is 1 (IEEE 1364-2005 §5.1.9 truth tables), which is
 *  exactly how a masked don't-care disappears; every other combination with an x is x. */
function g2(prim: string, a: Bit, b: Bit, x: Ctx): Bit {
  if (isX(a) || isX(b)) {
    const known = isC(a) ? a.c : isC(b) ? b.c : undefined
    if (known === 0 && prim === 'and') return { c: 0 }
    if (known === 1 && prim === 'or') return { c: 1 }
    return UNKNOWN
  }
  if (isC(a) && isC(b)) {
    const r =
      prim === 'and'
        ? a.c & b.c
        : prim === 'or'
          ? a.c | b.c
          : prim === 'xor'
            ? a.c ^ b.c
            : a.c ^ b.c ^ 1
    return { c: (r & 1) as 0 | 1 }
  }
  const kv: [0 | 1, Bit] | undefined = isC(a) ? [a.c, b] : isC(b) ? [b.c, a] : undefined
  if (kv !== undefined) {
    const [k, v] = kv
    if (prim === 'and') return k === 0 ? { c: 0 } : v
    if (prim === 'or') return k === 1 ? { c: 1 } : v
    if (prim === 'xor') return k === 0 ? v : not1(v, x)
    return k === 1 ? v : not1(v, x) // xnor
  }
  const o = x.fresh()
  x.gates.push({ prim, terminals: [o, (a as { n: string }).n, (b as { n: string }).n] })
  return { n: o }
}
const and1 = (a: Bit, b: Bit, x: Ctx) => g2('and', a, b, x)
const or1 = (a: Bit, b: Bit, x: Ctx) => g2('or', a, b, x)
const xor1 = (a: Bit, b: Bit, x: Ctx) => g2('xor', a, b, x)
const xnor1 = (a: Bit, b: Bit, x: Ctx) => g2('xnor', a, b, x)

/** Reduce a bit-vector with a 2-input gate (a left-linear tree). Empty ⇒ the operator's identity. */
function reduce(bits: Bit[], prim: string, x: Ctx): Bit {
  if (bits.length === 0) return { c: prim === 'and' ? 1 : 0 }
  let acc = bits[0] as Bit
  for (let i = 1; i < bits.length; i++) acc = g2(prim, acc, bits[i] as Bit, x)
  return acc
}
function fullAdd(a: Bit, b: Bit, cin: Bit, x: Ctx): { sum: Bit; cout: Bit } {
  const p = xor1(a, b, x)
  return { sum: xor1(p, cin, x), cout: or1(and1(a, b, x), and1(cin, p, x), x) }
}
/** Zero-extend / truncate a bit-vector to width w. */
function resize(bits: Bit[], w: number): Bit[] {
  const out = bits.slice(0, w)
  while (out.length < w) out.push({ c: 0 })
  return out
}
function mux1(sel: Bit, t: Bit, f: Bit, x: Ctx): Bit {
  return or1(and1(t, sel, x), and1(f, not1(sel, x), x), x)
}

/**
 * Unsigned restoring division at width w → { q: quotient, rem: remainder }, both length w. Each of the w
 * steps shifts the partial remainder in one dividend bit then does a (w+1)-bit trial subtract of the divisor;
 * if the remainder is still ≥ the divisor it keeps the difference and sets the quotient bit, else it restores.
 * ~w² gates. Divide-by-zero yields an all-ones quotient and the dividend as the remainder — real Verilog is
 * x there, but x isn't modelled, so this is the defined stand-in (documented, not faked).
 */
function divmod(a: Bit[], b: Bit[], w: number, x: Ctx): { q: Bit[]; rem: Bit[] } {
  const bExt: Bit[] = [...b, { c: 0 }] // divisor zero-extended to w+1 bits
  let rem: Bit[] = resize([], w + 1) // partial remainder, starts 0
  const q: Bit[] = new Array<Bit>(w)
  for (let i = w - 1; i >= 0; i--) {
    // rem = (rem << 1) | a[i]: bit 0 becomes a[i], the rest shift up (the restored top bit is 0, so it drops)
    rem = [a[i] as Bit, ...rem.slice(0, w)]
    // trial subtract: rem + ~bExt + 1; the carry-out is 1 exactly when rem ≥ divisor
    let carry: Bit = { c: 1 }
    const diff: Bit[] = []
    for (let k = 0; k <= w; k++) {
      const fa = fullAdd(rem[k] as Bit, not1(bExt[k] as Bit, x), carry, x)
      diff.push(fa.sum)
      carry = fa.cout
    }
    const ge = carry
    q[i] = ge
    rem = rem.map((r, k) => mux1(ge, diff[k] as Bit, r, x))
  }
  return { q, rem: rem.slice(0, w) }
}

/** The self-determined width of an expression (bottom-up pass). */
function selfWidth(e: Expr, w: (name: string) => number): number {
  switch (e.t) {
    case 'net':
      return w(e.name)
    case 'const':
      return e.bits.length
    case 'bitsel':
      return 1
    case 'partsel':
      return e.hi - e.lo + 1
    case 'concat':
      return e.parts.reduce((s, p) => s + selfWidth(p, w), 0)
    case 'repl':
      return e.count * selfWidth(e.of, w)
    case 'un':
      // ~ - + preserve the operand width; ! and the reductions are 1 bit
      return e.op === '~' || e.op === '-' || e.op === '+' ? selfWidth(e.a, w) : 1
    case 'bin':
      // == != && || and the magnitude comparisons are 1-bit; a shift's width is its LEFT operand's (the amount
      // never widens it); everything else (& | ^ ~^ + - *) is max(operands).
      if (RELATIONAL.has(e.op) || e.op === '==' || e.op === '!=' || e.op === '&&' || e.op === '||')
        return 1
      if (e.op === '<<' || e.op === '>>' || e.op === '<<<' || e.op === '>>>')
        return selfWidth(e.a, w)
      return Math.max(selfWidth(e.a, w), selfWidth(e.b, w))
    case 'tern':
      return Math.max(selfWidth(e.a, w), selfWidth(e.b, w))
    case 'memread':
      return e.width
    case 'call':
      // A function call's width is its DECLARED return width — a self-determined wall, never the body's width.
      return e.retWidth ?? 1
    case 'sized':
      return e.width
    case 'cast':
      return selfWidth(e.of, w) // $signed/$unsigned change only signedness, not width
    default:
      return 1
  }
}

/** Bit i of a named signal — a folded constant if this is an inlined function-input bit set to a constant
 *  argument (constNets), else the real bit-net. */
function netBit(x: Ctx, name: string, i: number): Bit {
  const bn = x.bitNet(name, i)
  const c = x.constNets?.get(bn)
  if (c === 'x') return UNKNOWN
  return c !== undefined ? { c } : { n: bn }
}

/** Whether an expression is SIGNED per IEEE 1364-2005 §5.5.1: a signed net / signed-literal const; `~ - +` of a
 *  signed operand; a shift with a signed left operand; `+ - * / % & | ^ ~^` and `?:` signed iff ALL operands
 *  are signed; a `$signed` cast. Bit/part-selects, concat, replication, comparisons, reductions, and (for now)
 *  function calls are UNSIGNED — any of them as an operand makes the whole expression unsigned. */
function isSigned(e: Expr, sgnOf: (n: string) => boolean): boolean {
  switch (e.t) {
    case 'net':
      return sgnOf(e.name)
    case 'const':
      return e.signed === true
    case 'un':
      return e.op === '~' || e.op === '-' || e.op === '+' ? isSigned(e.a, sgnOf) : false
    case 'bin':
      if (e.op === '<<' || e.op === '>>' || e.op === '<<<' || e.op === '>>>')
        return isSigned(e.a, sgnOf)
      if (RELATIONAL.has(e.op) || e.op === '==' || e.op === '!=' || e.op === '&&' || e.op === '||')
        return false
      return isSigned(e.a, sgnOf) && isSigned(e.b, sgnOf)
    case 'tern':
      return isSigned(e.a, sgnOf) && isSigned(e.b, sgnOf)
    case 'cast':
      return e.signed
    case 'memread':
      return sgnOf(e.name) // a `reg signed […] m […]` reads signed words
    case 'sized':
      return isSigned(e.of, sgnOf)
    default:
      return false // bitsel, partsel, concat, repl, memread, call
  }
}

/** Extend/truncate to width w, replicating the SIGN bit (top bit) when `signed`, else zero-filling. */
function resizeSigned(bits: Bit[], w: number, signed: boolean): Bit[] {
  if (bits.length >= w) return bits.slice(0, w)
  const fill: Bit = signed && bits.length > 0 ? (bits[bits.length - 1] as Bit) : { c: 0 }
  const out = bits.slice()
  while (out.length < w) out.push(fill)
  return out
}

/** Two's-complement negate a bit-vector (~bits + 1) at its own width. */
function negate(bits: Bit[], x: Ctx): Bit[] {
  let carry: Bit = { c: 1 }
  const out: Bit[] = []
  for (const b of bits) {
    const fa = fullAdd(not1(b, x), { c: 0 }, carry, x)
    out.push(fa.sum)
    carry = fa.cout
  }
  return out
}

/** `doNeg ? -bits : bits`, per-bit muxed (for the sign-magnitude divide path). */
function condNegate(bits: Bit[], doNeg: Bit, x: Ctx): Bit[] {
  if (isC(doNeg)) return doNeg.c === 1 ? negate(bits, x) : bits
  const neg = negate(bits, x)
  return bits.map((b, i) => mux1(doNeg, neg[i] as Bit, b, x))
}

/** Synthesize an expression at context width `w`, returning a length-w bit-vector (LSB-first). Both the context
 *  WIDTH `w` and the context SIGNEDNESS `sgn` are pushed down into the width-preserving operators (~ - + & | ^
 *  ~^ + - * and both ?: arms) — `sgn` decides SIGN- vs ZERO-extension when a narrower value is widened — and
 *  STOP at the self-determined walls (concat/replication elements, comparison operands, reductions, logical,
 *  the ternary condition, a shift's amount), which re-establish their own width + signedness. `sgn` matches the
 *  containing expression's signedness (IEEE 1364-2005 §5.5.1: signed iff ALL operands are signed). */
function synthAt(e: Expr, w: number, sgn: boolean, x: Ctx): Bit[] {
  const S = x.signedOf ?? noSign
  switch (e.t) {
    case 'const':
      return resizeSigned(
        e.bits.map((b): Bit => (b === 'x' ? UNKNOWN : { c: b })),
        w,
        sgn,
      )
    case 'net': {
      const nw = x.widthOf(e.name)
      return resizeSigned(
        Array.from({ length: nw }, (_, i) => netBit(x, e.name, i)),
        w,
        sgn,
      )
    }
    case 'bitsel': {
      const inRange = e.index >= 0 && e.index < x.widthOf(e.name)
      return resize([inRange ? netBit(x, e.name, e.index) : { c: 0 }], w)
    }
    case 'partsel': {
      const nw = x.widthOf(e.name)
      const bits: Bit[] = []
      for (let k = e.lo; k <= e.hi; k++) bits.push(k < nw ? netBit(x, e.name, k) : { c: 0 })
      return resize(bits, w)
    }
    case 'concat': {
      // MSB-first parts → an LSB-first bit-vector. Each part is SELF-DETERMINED (IEEE 1364-2005 §5.4.1): it
      // takes its own width AND ITS OWN SIGNEDNESS, which is not the same thing as being unsigned. Only the
      // concatenation's RESULT is unsigned (§5.5.1), which is what the `resize` below honours. Forcing the
      // parts unsigned turned `{a >>> 1, …}` on a signed `a` into a LOGICAL shift — a silent wrong answer.
      const bits: Bit[] = []
      for (let i = e.parts.length - 1; i >= 0; i--) {
        const p = e.parts[i] as Expr
        bits.push(...synthAt(p, selfWidth(p, x.widthOf), isSigned(p, S), x))
      }
      return resize(bits, w)
    }
    case 'repl': {
      const elem = synthAt(e.of, selfWidth(e.of, x.widthOf), isSigned(e.of, S), x)
      const bits: Bit[] = []
      for (let i = 0; i < e.count; i++) bits.push(...elem)
      return resize(bits, w)
    }
    case 'un': {
      if (e.op === '~') return synthAt(e.a, w, sgn, x).map((b) => not1(b, x))
      if (e.op === '+') return synthAt(e.a, w, sgn, x)
      if (e.op === '-') return negate(synthAt(e.a, w, sgn, x), x)
      const operand = synthAt(e.a, selfWidth(e.a, x.widthOf), false, x) // reductions: self-width, unsigned
      const r =
        e.op === '!'
          ? not1(reduce(operand, 'or', x), x)
          : e.op === '&'
            ? reduce(operand, 'and', x)
            : e.op === '|'
              ? reduce(operand, 'or', x)
              : e.op === '^'
                ? reduce(operand, 'xor', x)
                : e.op === '~&'
                  ? not1(reduce(operand, 'and', x), x)
                  : e.op === '~|'
                    ? not1(reduce(operand, 'or', x), x)
                    : not1(reduce(operand, 'xor', x), x) // ~^ ^~
      return resize([r], w)
    }
    case 'bin': {
      // The width-preserving (context-determined) operators — & | ^ ~^ + - * / % and both ?: arms — extend
      // their operands with the CONTEXT signedness `sgn` (the maximal region's sign, IEEE §5.5.1), NOT a
      // locally-recomputed one: a signed sub-expression nested inside an unsigned region is treated unsigned.
      // Only the self-determined walls (== != < <= > >=, reductions, concat/repl, the shift amount) re-root.
      if (e.op === '&' || e.op === '|' || e.op === '^' || e.op === '~^' || e.op === '^~') {
        const la = synthAt(e.a, w, sgn, x)
        const lb = synthAt(e.b, w, sgn, x)
        const prim = e.op === '&' ? 'and' : e.op === '|' ? 'or' : e.op === '^' ? 'xor' : 'xnor'
        return la.map((_, i) => g2(prim, la[i] as Bit, lb[i] as Bit, x))
      }
      if (e.op === '+' || e.op === '-') {
        const la = synthAt(e.a, w, sgn, x)
        const lbRaw = synthAt(e.b, w, sgn, x)
        const lb = e.op === '-' ? lbRaw.map((b) => not1(b, x)) : lbRaw
        let carry: Bit = { c: e.op === '-' ? 1 : 0 } // subtract = a + ~b + 1
        const sum: Bit[] = []
        for (let i = 0; i < w; i++) {
          const fa = fullAdd(la[i] as Bit, lb[i] as Bit, carry, x)
          sum.push(fa.sum)
          carry = fa.cout
        }
        return sum // carry-out of the top bit is dropped (result mod 2^w)
      }
      if (e.op === '==' || e.op === '!=') {
        const cw = Math.max(selfWidth(e.a, x.widthOf), selfWidth(e.b, x.widthOf))
        const eqSgn = isSigned(e.a, S) && isSigned(e.b, S)
        const la = synthAt(e.a, cw, eqSgn, x)
        const lb = synthAt(e.b, cw, eqSgn, x)
        const eq = reduce(
          la.map((_, i) => xnor1(la[i] as Bit, lb[i] as Bit, x)),
          'and',
          x,
        )
        return resize([e.op === '==' ? eq : not1(eq, x)], w)
      }
      if (e.op === '<<' || e.op === '>>' || e.op === '<<<' || e.op === '>>>') {
        // Shift: the LEFT operand is context-sized to w (signedness = its own); the amount is self-determined
        // and never widens. `<<`/`<<<` fill 0 at the bottom; `>>` fills 0 at the top; `>>>` (arithmetic) fills
        // the SIGN bit at the top iff the left operand is signed. A constant amount reindexes; a variable amount
        // is a barrel shifter. Anything shifted past the width falls off to the fill bit.
        const left = e.op === '<<' || e.op === '<<<'
        const la = synthAt(e.a, w, sgn, x)
        // >>> arithmetic-fills the sign bit only when the CONTEXT is signed (an unsigned context makes it a
        // logical shift), so `u + (a >>> 1)` zero-fills even for a signed `a`.
        const topFill: Bit = e.op === '>>>' && sgn && w > 0 ? (la[w - 1] as Bit) : { c: 0 }
        const shiftBy = (srcBits: Bit[], amt: number): Bit[] =>
          Array.from({ length: w }, (_, i) => {
            const from = left ? i - amt : i + amt
            if (from >= 0 && from < w) return srcBits[from] as Bit
            return left ? ({ c: 0 } as Bit) : topFill // bottom-fill 0 on <<, top-fill on >> / >>>
          })
        const k = foldConst(e.b, x.widthOf)
        if (k !== undefined) return shiftBy(la, k)
        const bw = selfWidth(e.b, x.widthOf)
        const amtBits = synthAt(e.b, bw, false, x)
        let cur = la
        for (let j = 0; j < bw; j++) {
          const shifted = shiftBy(cur, 2 ** j)
          const sel = amtBits[j] as Bit
          cur = cur.map((c, i) => mux1(sel, shifted[i] as Bit, c, x))
        }
        return cur
      }
      if (RELATIONAL.has(e.op)) {
        // Magnitude comparison → 1 bit. a >= b ⟺ the carry-OUT of a + ~b + 1 (no borrow). When BOTH operands
        // are signed, a signed comparison = the unsigned comparison with both sign bits FLIPPED (bias by
        // 2^(cw−1), which maps the signed order onto the unsigned order). Operands are extended at the compare
        // width with that signedness.
        const cw = Math.max(selfWidth(e.a, x.widthOf), selfWidth(e.b, x.widthOf))
        const cmpSgn = isSigned(e.a, S) && isSigned(e.b, S)
        const flip = (bits: Bit[]): Bit[] =>
          cmpSgn ? bits.map((b, i) => (i === cw - 1 ? not1(b, x) : b)) : bits
        const la = flip(synthAt(e.a, cw, cmpSgn, x))
        const lb = flip(synthAt(e.b, cw, cmpSgn, x))
        const geq = (p: Bit[], q: Bit[]): Bit => {
          let carry: Bit = { c: 1 }
          for (let i = 0; i < cw; i++)
            carry = fullAdd(p[i] as Bit, not1(q[i] as Bit, x), carry, x).cout
          return carry
        }
        const r =
          e.op === '>='
            ? geq(la, lb)
            : e.op === '<'
              ? not1(geq(la, lb), x)
              : e.op === '<='
                ? geq(lb, la)
                : not1(geq(lb, la), x) // '>'  (a > b ⟺ ~(b >= a))
        return resize([r], w)
      }
      if (e.op === '*') {
        // Multiply: partial products summed at the context width w. BOTH operands are context-determined (IEEE
        // §5.4.1), extended to w with the product's signedness (sign-extended if both operands are signed), so
        // the low w bits are correct for signed as well as unsigned. Bits past w drop (mod 2^w).
        const la = synthAt(e.a, w, sgn, x)
        const lb = synthAt(e.b, w, sgn, x)
        let acc: Bit[] = resize([], w)
        for (let j = 0; j < w; j++) {
          const bj = lb[j] as Bit
          let carry: Bit = { c: 0 }
          const sum: Bit[] = []
          for (let i = 0; i < w; i++) {
            const ai = i - j
            const pp: Bit = ai >= 0 && ai < w ? and1(la[ai] as Bit, bj, x) : { c: 0 }
            const fa = fullAdd(acc[i] as Bit, pp, carry, x)
            sum.push(fa.sum)
            carry = fa.cout
          }
          acc = sum
        }
        return acc
      }
      if (e.op === '/' || e.op === '%') {
        // Division depends on the operands' HIGH bits, so it is evaluated at the FULL width L = max(context,
        // both self-widths) then truncated to w (mirroring ==/<). SIGNED division (both operands signed) is
        // sign-magnitude: divide the magnitudes, then set the quotient sign to a^b and the remainder sign to a.
        const evalW = Math.max(w, selfWidth(e.a, x.widthOf), selfWidth(e.b, x.widthOf))
        const la = synthAt(e.a, evalW, sgn, x)
        const lb = synthAt(e.b, evalW, sgn, x)
        if (sgn) {
          const aNeg = la[evalW - 1] as Bit
          const bNeg = lb[evalW - 1] as Bit
          const { q, rem } = divmod(condNegate(la, aNeg, x), condNegate(lb, bNeg, x), evalW, x)
          const res =
            e.op === '/' ? condNegate(q, xor1(aNeg, bNeg, x), x) : condNegate(rem, aNeg, x)
          return resize(res, w)
        }
        const { q, rem } = divmod(la, lb, evalW, x)
        return resize(e.op === '/' ? q : rem, w)
      }
      if (e.op === '&&' || e.op === '||') {
        const ca = reduce(synthAt(e.a, selfWidth(e.a, x.widthOf), false, x), 'or', x)
        const cb = reduce(synthAt(e.b, selfWidth(e.b, x.widthOf), false, x), 'or', x)
        return resize([e.op === '&&' ? and1(ca, cb, x) : or1(ca, cb, x)], w)
      }
      // Every supported binary op has a branch above; a bare fallthrough would silently miscompile a newly
      // added op (as a 1-bit &&/||), so fail loudly instead — this only fires on a coding error.
      throw new Error(`synthAt: no branch for binary operator "${e.op}"`)
    }
    case 'tern': {
      const sel = reduce(synthAt(e.c, selfWidth(e.c, x.widthOf), false, x), 'or', x) // nonzero test, 1 bit
      if (isC(sel)) return synthAt(sel.c === 1 ? e.a : e.b, w, sgn, x)
      const la = synthAt(e.a, w, sgn, x)
      const lb = synthAt(e.b, w, sgn, x)
      return la.map((_, i) => mux1(sel, la[i] as Bit, lb[i] as Bit, x))
    }
    case 'memread': {
      // The gate Data RAM's read path: decode the address to one-hot lines, then OR each word gated by its
      // line. Synthesize the address ONCE (shared bits), so a plain-net address builds just a decoder — not W
      // copies of the address datapath. A constant address folds the decode to a single live word. Decode on
      // the FULL address width (never fewer than clog2(depth)) so a too-wide address's high bits force a
      // no-match (reads 0) instead of aliasing onto a low word — the write path compares at this width too.
      const addrW = Math.max(clog2(e.depth), selfWidth(e.idx, x.widthOf))
      const addr = synthAt(e.idx, addrW, false, x)
      const oneHot: Bit[] = []
      for (let k = 0; k < e.depth; k++) {
        let match: Bit = { c: 1 }
        for (let j = 0; j < addrW; j++) {
          const wantOne = ((k >> j) & 1) === 1
          match = and1(match, wantOne ? (addr[j] as Bit) : not1(addr[j] as Bit, x), x)
        }
        oneHot.push(match)
      }
      const out: Bit[] = []
      for (let b = 0; b < e.width; b++) {
        let acc: Bit = { c: 0 }
        for (let k = 0; k < e.depth; k++) {
          const wordBit: Bit = { n: x.bitNet(memWord(e.name, k), b) }
          acc = or1(acc, and1(oneHot[k] as Bit, wordBit, x), x)
        }
        out.push(acc)
      }
      return resizeSigned(out, w, sgn)
    }
    case 'sized':
      // A width wall: evaluate `of` at exactly `width` (with its own signedness), then re-fit to the context.
      return resizeSigned(synthAt(e.of, e.width, isSigned(e.of, S), x), w, sgn)
    case 'call':
      // Inline the function body as real gates at its declared return width (a self-determined wall), then fit.
      return resize(e.fn === undefined ? [] : inlineCall(e.fn, e.args, x), w)
    case 'cast':
      // $signed/$unsigned only change `of`'s SELF-signedness (via isSigned, which the parent reads to set the
      // context sgn); the extension here uses the inherited `sgn`, so `$signed(a) | b` (an unsigned `|`) zero-
      // extends. Evaluate `of` at its own self-width, then extend to the context.
      return resizeSigned(synthAt(e.of, selfWidth(e.of, x.widthOf), false, x), w, sgn)
    default:
      return resize([], w) // 'bad' — gated out by firstBad()
  }
}

const noSign = (): boolean => false

/**
 * Inline a function call into REAL gates at the function's declared return width — the gate-materialization
 * approach that makes every width EXACT (the reason the earlier symbolic-inlining attempt was reverted).
 * Each argument is materialized at its formal's declared width (a self-determined wall) onto per-call-unique
 * input nets; the body is elaborated with the SAME combinational machinery an `always @(*)` uses, with every
 * function-scoped signal renamed per call (so repeated calls never alias) and each local/return read wrapped
 * in a `sized` node at its declared width; the return value is then synthesized at retWidth. Nested calls are
 * bound + inlined recursively (a cycle was already rejected in synthesizeBehavioral).
 */
function inlineCall(fn: FuncDef, args: Expr[], x: Ctx): Bit[] {
  if (x.funcs === undefined || x.callSeq === undefined) return resize([], fn.retWidth)
  const id = x.callSeq.n++
  const prefix = `__fn${id}_${fn.name}_`
  const fnWidth = new Map<string, number>()
  for (const inp of fn.inputs) fnWidth.set(inp.name, inp.width)
  for (const [nm, wd] of fn.localWidths) fnWidth.set(nm, wd)
  fnWidth.set(fn.name, fn.retWidth) // the return variable is the function name
  // Apply the function's widths ONLY to its own (prefixed) scoped names; anything else is a module net, whose
  // width must come from the enclosing context — else an outer function's formal named like a module net the
  // INNER function reads would steal its width.
  const bodyWidthOf = (n: string): number =>
    n.startsWith(prefix) ? (fnWidth.get(n.slice(prefix.length)) ?? 1) : x.widthOf(n)
  const bodyBitNet = (n: string, i: number): string => (bodyWidthOf(n) === 1 ? n : `${n}[${i}]`)
  const constNets = new Map<string, 0 | 1 | 'x'>()
  const bodyCtx: Ctx = { ...x, widthOf: bodyWidthOf, bitNet: bodyBitNet, constNets }

  // Materialize each argument at its formal's declared width, onto the renamed input net: a live bit is
  // buffered; a constant bit is recorded in constNets (so it flows as a real constant with no tie needed).
  for (let k = 0; k < fn.inputs.length; k++) {
    const inp = fn.inputs[k] as { name: string; width: number }
    const bits = synthAt(args[k] as Expr, inp.width, false, x)
    for (let i = 0; i < inp.width; i++) {
      const dest = bodyBitNet(prefix + inp.name, i)
      const b = bits[i] as Bit
      if (isX(b)) constNets.set(dest, 'x')
      else if (isC(b)) constNets.set(dest, b.c)
      else x.gates.push({ prim: 'buf', terminals: [dest, b.n] })
    }
  }
  // Rename every function-scoped identifier per call, then elaborate the body combinationally.
  const bodyToks = fn.body.map((t) =>
    t.k === 'id' && fnWidth.has(t.v) ? { ...t, v: prefix + t.v } : t,
  )
  const seq = parseProcedural(bodyToks, new Map(), true, bodyWidthOf)
  // These three fall-throughs are defensive — validateFunctions has already dropped any function with a bad
  // body / no return assignment / a bad nested call (a call to it then reports as "unknown function").
  if (seq.t === 'bad') return resize([{ c: 0 }], fn.retWidth)
  const written = new Set<string>()
  const sizeOf = (name: string): number | undefined =>
    name.startsWith(prefix) ? fnWidth.get(name.slice(prefix.length)) : undefined
  const env = elaborate(seq, new Map(), written, sizeOf)
  const retExpr = env.get(prefix + fn.name)
  if (retExpr === undefined) return resize([{ c: 0 }], fn.retWidth)
  const bound = bindCalls(retExpr, x.funcs)
  if (firstBad(bound) !== undefined) return resize([{ c: 0 }], fn.retWidth)
  return synthAt(bound, fn.retWidth, false, bodyCtx)
}

// ── the assign driver ───────────────────────────────────────────────────────────
type SynthModule = {
  portOrder: string[]
  dir: Map<string, 'input' | 'output' | 'inout'>
  gates: GateInst[]
  rawGates: RawGate[]
  assigns: Assign[]
  alwaysBlocks: AlwaysBlock[]
  refusedDrivers: RefusedDriver[]
  powerOnValues: PowerOnValue[]
  flops: FlopInst[]
  widths: Map<string, number>
  mems: MemTable
  functions: Map<string, FuncDef>
  tasks: Map<string, TaskDef>
  signed: Set<string>
  resolution: Map<string, 'or' | 'and'>
  unbuilt: UnbuiltReport
}

/** The target bit-nets of an lhs (`y`, `y[i]`, `y[h:l]`, or a concat of those), LSB-first. */
function lhsBits(
  toks: Tok[],
  widthOf: (n: string) => number,
  bitNet: (n: string, i: number) => string,
): { bits: string[]; note?: string } | { bad: string } {
  if (toks[0]?.v === '{') {
    if (toks[toks.length - 1]?.v !== '}') return { bad: 'malformed concatenation target' }
    const parts = splitTopComma(toks.slice(1, -1))
    const out: string[] = []
    const notes: string[] = []
    for (let i = parts.length - 1; i >= 0; i--) {
      const pb = lhsBits(parts[i] as Tok[], widthOf, bitNet)
      if ('bad' in pb) return pb
      out.push(...pb.bits)
      if (pb.note !== undefined) notes.push(pb.note)
    }
    return notes.length > 0 ? { bits: out, note: notes.join('; ') } : { bits: out }
  }
  if (toks[0]?.k !== 'id') return { bad: 'assign target must be a net' }
  const name = toks[0].v
  if (toks.length === 1)
    return { bits: Array.from({ length: widthOf(name) }, (_, i) => bitNet(name, i)) }
  if (toks[1]?.v === '[') {
    const inner = toks.slice(2).filter((t) => t.v !== ']')
    // An out-of-range LHS select would mint a phantom bit-net (e.g. y[9] on a 4-bit y) that no read ever sees,
    // silently leaving the real net undriven — in Verilog it writes x. Report it, exactly as the read side does.
    const width = widthOf(name)
    const parts = splitOnColon(inner)
    if (parts !== undefined) {
      const hi = constInt(parts[0])
      const lo = constInt(parts[1])
      if (hi === undefined || lo === undefined) return { bad: 'non-constant part-select target' }
      if (hi < lo) return { bad: 'ascending part-select target is unsupported' }
      // A write to a bit that does not exist goes nowhere in Verilog, and the bits that DO exist are still
      // written (IEEE 1364-2005 §5.2.1). Refusing the whole assignment erased the in-range half of it, so the
      // range is clamped and the drop is reported instead.
      const top = Math.min(hi, width - 1)
      const bits: string[] = []
      for (let k = lo; k <= top; k++) bits.push(bitNet(name, k))
      if (hi < width) return { bits }
      const note =
        bits.length === 0
          ? `part-select target [${hi}:${lo}] is out of range on the ${width}-bit net "${name}" — it drives nothing, exactly as in Verilog`
          : `part-select target [${hi}:${lo}] is out of range on the ${width}-bit net "${name}" — the bits above [${top}] drive nothing, exactly as in Verilog, and the rest are still written`
      return { bits, note }
    }
    const index = constInt(inner)
    if (index === undefined) return { bad: 'non-constant bit-select target' }
    if (index >= width)
      return {
        bits: [],
        note: `bit-select target "${name}[${index}]" is out of range on the ${width}-bit net "${name}" — it drives nothing, exactly as in Verilog`,
      }
    return { bits: [bitNet(name, index)] }
  }
  return { bad: 'unrecognized assign target' }
}

/** Split a token span at depth-0 commas (for concat/lhs lists). */
function splitTopComma(toks: Tok[]): Tok[][] {
  const out: Tok[][] = []
  let cur: Tok[] = []
  let depth = 0
  for (const t of toks) {
    if (t.k === 'p' && (t.v === '(' || t.v === '[' || t.v === '{')) depth++
    else if (t.k === 'p' && (t.v === ')' || t.v === ']' || t.v === '}')) depth--
    if (depth === 0 && t.v === ',') {
      out.push(cur)
      cur = []
    } else cur.push(t)
  }
  if (cur.length > 0) out.push(cur)
  return out
}

/** Drop any function that (directly or indirectly) calls itself — a recursive function has no finite gate
 *  inlining, so it's reported and removed (calls to it then report as "unknown function"). */
function pruneRecursiveFunctions(functions: Map<string, FuncDef>, warnings: string[]): void {
  if (functions.size === 0) return
  const calls = new Map<string, Set<string>>()
  for (const [name, fn] of functions) {
    const s = new Set<string>()
    for (let i = 0; i < fn.body.length; i++) {
      const t = fn.body[i] as Tok
      if (t.k === 'id' && functions.has(t.v) && (fn.body[i + 1] as Tok | undefined)?.v === '(')
        s.add(t.v)
    }
    calls.set(name, s)
  }
  const state = new Map<string, 0 | 1 | 2>()
  const onCycle = new Set<string>()
  const stack: string[] = []
  const visit = (n: string): void => {
    state.set(n, 1)
    stack.push(n)
    for (const dep of calls.get(n) ?? []) {
      const st = state.get(dep) ?? 0
      if (st === 1) {
        const from = stack.lastIndexOf(dep)
        for (let i = from; i < stack.length; i++) onCycle.add(stack[i] as string)
      } else if (st === 0) visit(dep)
    }
    stack.pop()
    state.set(n, 2)
  }
  for (const n of functions.keys()) if ((state.get(n) ?? 0) === 0) visit(n)
  for (const n of onCycle) {
    warnings.push(`function "${n}" is recursive — not synthesizable, reported`)
    functions.delete(n)
  }
}

/** Whether a procedural tree contains a task-call statement (illegal inside a function body). */
function containsTaskCall(stmt: ProcStmt): boolean {
  switch (stmt.t) {
    case 'taskcall':
      return true
    case 'seq':
      return stmt.body.some(containsTaskCall)
    case 'if':
      return containsTaskCall(stmt.conseq) || (stmt.els !== undefined && containsTaskCall(stmt.els))
    default:
      return false
  }
}

/** Why a function's body can't be synthesized, or undefined if it's fine. Parses + elaborates the body exactly
 *  as inlineCall will (minus arg materialization + gates) and checks: it parses, it assigns its return, and the
 *  returned expression (with nested calls bound) has no unsupported construct. */
function functionBodyError(fn: FuncDef, functions: Map<string, FuncDef>): string | undefined {
  const fnWidth = new Map<string, number>()
  for (const inp of fn.inputs) fnWidth.set(inp.name, inp.width)
  for (const [nm, wd] of fn.localWidths) fnWidth.set(nm, wd)
  fnWidth.set(fn.name, fn.retWidth)
  const widthOf = (n: string): number => fnWidth.get(n) ?? 1
  const seq = parseProcedural(fn.body, new Map(), true, widthOf)
  if (seq.t === 'bad') return seq.why
  if (containsTaskCall(seq)) return 'a function cannot call a task'
  const written = new Set<string>()
  const ret = elaborate(seq, new Map(), written).get(fn.name)
  if (ret === undefined) return `it never assigns its return value "${fn.name}"`
  return firstBad(bindCalls(ret, functions))
}

/** Drop + report every function whose body can't be synthesized, iterating to a fixpoint so a function that
 *  calls a dropped one is dropped too. Then inlineCall only ever meets a valid function (its zero-return
 *  fall-throughs are pure defense), and a call to a dropped function reports as "unknown function". This is the
 *  gate that stops a broken body from silently inlining to all-zeros — the reverted feature's failure mode. */
function validateFunctions(functions: Map<string, FuncDef>, warnings: string[]): void {
  let changed = true
  while (changed) {
    changed = false
    for (const [name, fn] of [...functions]) {
      const why = functionBodyError(fn, functions)
      if (why !== undefined) {
        warnings.push(`function "${name}" body is not synthesizable — ${why} — reported, not built`)
        functions.delete(name)
        changed = true
      }
    }
  }
}

type TaskCtx = {
  tasks: Map<string, TaskDef>
  funcs: Map<string, FuncDef>
  mems: MemTable
  comb: boolean
  callSeq: { n: number }
  widthOf: (n: string) => number
  registerWidth: (name: string, w: number) => void
  /** Tasks currently being inlined (to reject direct/indirect task recursion). */
  stack: Set<string>
}

/** Wrap every blocking store to a task-scoped signal in a `sized` width wall so an intermediate local truncates
 *  to its declared width EXACTLY — the same guarantee the function inliner gets from elaborate's sizeOf, applied
 *  here at the statement level because the task body is spliced into the caller's (sizeOf-less) elaboration. */
function wrapStores(stmt: ProcStmt, sizeOf: (n: string) => number | undefined): ProcStmt {
  switch (stmt.t) {
    case 'nb': {
      const wd = sizeOf(stmt.lhs)
      return wd === undefined ? stmt : { ...stmt, rhs: { t: 'sized', width: wd, of: stmt.rhs } }
    }
    case 'nbsel':
      // The width wall belongs on the SELECTED width, which elaborate already applies — a wall at the
      // signal's full width here would zero-extend the slice value over bits it must not touch.
      return stmt
    case 'seq':
      return { t: 'seq', body: stmt.body.map((s) => wrapStores(s, sizeOf)) }
    case 'if': {
      const conseq = wrapStores(stmt.conseq, sizeOf)
      return stmt.els === undefined
        ? { t: 'if', cond: stmt.cond, conseq }
        : { t: 'if', cond: stmt.cond, conseq, els: wrapStores(stmt.els, sizeOf) }
    }
    default:
      return stmt
  }
}

/** Every signal a procedural tree assigns (nb lhs / memwrite name). */
function collectAssigned(stmt: ProcStmt, out: Set<string>): void {
  switch (stmt.t) {
    case 'nb':
    case 'nbsel':
      out.add(stmt.lhs)
      break
    case 'memwrite':
      out.add(stmt.name)
      break
    case 'seq':
      for (const s of stmt.body) collectAssigned(s, out)
      break
    case 'if':
      collectAssigned(stmt.conseq, out)
      if (stmt.els !== undefined) collectAssigned(stmt.els, out)
      break
  }
}

/** Inline one task-call statement into a `seq`: input/inout args bound (sized to the arg's declared width)
 *  before the per-call-renamed body; output/inout args written back (sized) after it; every intermediate local
 *  wrapped in its own width wall (wrapStores); nested task calls inlined recursively (recursion rejected). Only
 *  a combinational, non-conditional call is inlined — a clocked call, a call inside an if/case, an unknown/
 *  recursive task, a wrong arg count, an unsynthesizable body, a never-assigned output, or a non-net output
 *  target is reported (a `bad` node), never faked. */
function expandTaskCall(name: string, argSpans: Tok[][], x: TaskCtx): ProcStmt {
  if (!x.comb)
    return { t: 'bad', why: 'a task call in a clocked always block is a later increment' }
  if (x.stack.has(name)) return { t: 'bad', why: `task "${name}" is recursive — not synthesizable` }
  const task = x.tasks.get(name)
  if (task === undefined) return { t: 'bad', why: `call to unknown task "${name}"` }
  if (argSpans.length !== task.args.length)
    return {
      t: 'bad',
      why: `task "${name}" takes ${task.args.length} argument(s), got ${argSpans.length}`,
    }
  const id = x.callSeq.n++
  const prefix = `__tsk${id}_${name}_`
  const scopeWidth = new Map<string, number>()
  for (const a of task.args) scopeWidth.set(a.name, a.width)
  for (const [nm, wd] of task.localWidths) scopeWidth.set(nm, wd)
  for (const [nm, wd] of scopeWidth) x.registerWidth(prefix + nm, wd)
  const bodyToks = task.body.map((t) =>
    t.k === 'id' && scopeWidth.has(t.v) ? { ...t, v: prefix + t.v } : t,
  )
  const parsedBody = parseProcedural(bodyToks, x.mems, true, x.widthOf)
  if (parsedBody.t === 'bad') return { t: 'bad', why: `task "${name}" body — ${parsedBody.why}` }
  // Inline any nested task call in the body (recursion-guarded); its top level is not conditional.
  const nested = expandTaskCalls(parsedBody, { ...x, stack: new Set([...x.stack, name]) }, false)
  if (nested.t === 'bad') return nested
  // Width walls on every intermediate local/arg store, exactly like the function inliner.
  const sizeOf = (n: string): number | undefined =>
    n.startsWith(prefix) ? scopeWidth.get(n.slice(prefix.length)) : undefined
  const walledBody = wrapStores(nested, sizeOf)
  const assigned = new Set<string>()
  collectAssigned(walledBody, assigned)
  const pre: ProcStmt[] = []
  const post: ProcStmt[] = []
  for (let k = 0; k < task.args.length; k++) {
    const a = task.args[k] as TaskArg
    if (a.dir === 'input' || a.dir === 'inout') {
      const argExpr = bindCalls(parseRhs(argSpans[k] as Tok[], x.mems), x.funcs)
      const eb = firstBad(argExpr)
      if (eb !== undefined) return { t: 'bad', why: `task "${name}" argument "${a.name}" — ${eb}` }
      pre.push({
        t: 'nb',
        lhs: prefix + a.name,
        rhs: { t: 'sized', width: a.width, of: argExpr },
        blocking: true,
      })
    }
    if (a.dir === 'output' || a.dir === 'inout') {
      if (!assigned.has(prefix + a.name))
        return { t: 'bad', why: `task "${name}" output "${a.name}" is never assigned` }
      const lhs = argSpans[k] as Tok[]
      if (lhs.length !== 1 || lhs[0]?.k !== 'id')
        return {
          t: 'bad',
          why: `task "${name}" output "${a.name}" must be written to a simple net`,
        }
      post.push({
        t: 'nb',
        lhs: (lhs[0] as Tok).v,
        rhs: { t: 'sized', width: a.width, of: { t: 'net', name: prefix + a.name } },
        blocking: true,
      })
    }
  }
  return { t: 'seq', body: [...pre, walledBody, ...post] }
}

/** Replace every task-call in a procedural tree with its inlined seq. A task call inside an if/case branch is
 *  reported (its per-call temporaries would self-hold in the untaken branch → spurious combinational loops) —
 *  a later increment; a failed inline propagates as `bad`. */
function expandTaskCalls(stmt: ProcStmt, x: TaskCtx, conditional: boolean): ProcStmt {
  switch (stmt.t) {
    case 'taskcall':
      return conditional
        ? { t: 'bad', why: 'a task call inside an if/case branch is a later increment' }
        : expandTaskCall(stmt.name, stmt.argSpans, x)
    case 'seq': {
      const body: ProcStmt[] = []
      for (const s of stmt.body) {
        const e = expandTaskCalls(s, x, conditional)
        if (e.t === 'bad') return e
        body.push(e)
      }
      return { t: 'seq', body }
    }
    case 'if': {
      const conseq = expandTaskCalls(stmt.conseq, x, true)
      if (conseq.t === 'bad') return conseq
      if (stmt.els === undefined) return { t: 'if', cond: stmt.cond, conseq }
      const els = expandTaskCalls(stmt.els, x, true)
      if (els.t === 'bad') return els
      return { t: 'if', cond: stmt.cond, conseq, els }
    }
    default:
      return stmt
  }
}

/**
 * Synthesize behavioral RTL into real gates + flip-flops. Continuous assignments (`assign y = expr;`) become
 * gates and clocked `always @(posedge clk)` blocks become one D flip-flop per registered bit plus the
 * next-state gates that feed each D input — all appended to `mod` and expanded to scalar bit-nets so the
 * importer's lower() (purely scalar) wires + places + powers everything unchanged. Bus PORTS are expanded to
 * scalar bit-ports here too. Anything outside the supported subset is reported in `warnings` and NOT built.
 */
export function synthesizeBehavioral(mod: SynthModule, warnings: string[]): void {
  // A recursive function can't be inlined to a finite gate netlist — drop the cycle before any call is bound
  // (a call to a dropped function then reports as unknown), so inlineCall can never loop.
  pruneRecursiveFunctions(mod.functions, warnings)
  // Drop + report any function whose body is unsynthesizable, so a broken body can't silently inline to zeros.
  validateFunctions(mod.functions, warnings)
  const widthOf = (name: string): number => mod.widths.get(name) ?? 1
  // A bus bit-net uses the Verilog bracket form a[i] — since `[`/`]` can't appear in a simple identifier, it
  // can never collide with a scalar net literally spelled `a0` (a real, silent-miscompile hazard otherwise).
  const bitNet = (name: string, i: number): string => (widthOf(name) === 1 ? name : `${name}[${i}]`)
  const signedOf = (name: string): boolean => mod.signed.has(name)

  // Expand declared bus ports into scalar bit-ports (a[3:0] → a[0]..a[3]), preserving direction + order.
  const newOrder: string[] = []
  const newDir = new Map<string, 'input' | 'output' | 'inout'>()
  for (const p of mod.portOrder) {
    const bw = widthOf(p)
    const d = mod.dir.get(p)
    for (let i = 0; i < bw; i++) {
      const b = bitNet(p, i)
      newOrder.push(b)
      if (d !== undefined) newDir.set(b, d)
    }
  }
  mod.portOrder = newOrder
  mod.dir = newDir

  // A purely structural module used to return here, which is exactly why two structural gates on one net were
  // never compared: the only code that compares drivers lives below. It now returns only when the module has
  // no driver of any kind to register.
  if (
    mod.assigns.length === 0 &&
    mod.alwaysBlocks.length === 0 &&
    mod.gates.length === 0 &&
    mod.rawGates.length === 0 &&
    mod.refusedDrivers.length === 0
  )
    return

  // Fresh internal-net names dodge EVERY name that can already denote a net: bit-ports, structural gate
  // terminals, declared bus bases, any identifier used in an assign, AND any identifier inside an always
  // block (a register or read-net named `syn0` lives only there). Without this a user net named "syn0" is
  // silently merged with a synthesized net — a double-drive or a self-referential combinational loop.
  const used = new Set<string>(mod.dir.keys())
  for (const g of mod.gates) for (const t of g.terminals) used.add(t)
  for (const base of mod.widths.keys()) used.add(base)
  for (const a of mod.assigns) for (const t of [...a.lhs, ...a.rhs]) if (t.k === 'id') used.add(t.v)
  for (const blk of mod.alwaysBlocks) for (const t of blk.body) if (t.k === 'id') used.add(t.v)
  for (const g of mod.rawGates)
    for (const sl of g.slices) for (const t of sl) if (t.k === 'id') used.add(t.v)

  // Each memory word becomes a real D-bit register named with the bracket form mem[k]. Register its width so
  // bitNet/widthOf treat the word like any bus, and reserve the name. A user net that already spells mem[k]
  // (only possible via an escaped identifier) would silently merge with the word — reported, not merged.
  for (const [name, info] of mod.mems) {
    for (let k = 0; k < info.depth; k++) {
      const wsig = memWord(name, k)
      if (used.has(wsig))
        warnings.push(`memory word "${wsig}" collides with a net of the same name — reported`)
      used.add(wsig)
      if (info.width > 1) mod.widths.set(wsig, info.width)
    }
  }
  let n = 0
  const fresh = (): string => {
    let name = `syn${n++}`
    while (used.has(name)) name = `syn${n++}`
    used.add(name)
    return name
  }

  // Constant OUTPUT bits are tied to 0/1 via XOR/XNOR of a live input with itself. The tie gates live in
  // their OWN list, appended unconditionally, so a tie shared by several assigns never dangles when the assign
  // that first requested it is dropped as a loop.
  const inputs = new Set([...mod.dir].filter(([, d]) => d === 'input').map(([name]) => name))
  const refInput = [...inputs][0]
  const tieGates: GateInst[] = []
  let tie0: string | undefined
  let tie1: string | undefined
  const tie = (bit: 0 | 1): string | undefined => {
    if (refInput === undefined) return undefined
    if (bit === 0) {
      if (tie0 === undefined) {
        tie0 = fresh()
        tieGates.push({ prim: 'xor', terminals: [tie0, refInput, refInput] })
      }
      return tie0
    }
    if (tie1 === undefined) {
      tie1 = fresh()
      tieGates.push({ prim: 'xnor', terminals: [tie1, refInput, refInput] })
    }
    return tie1
  }

  // A shared per-module counter gives each inlined function call unique net names; funcs lets synthAt inline
  // a `call`.
  const callSeq = { n: 0 }
  const synCtx = (gs: GateInst[]): Ctx => ({
    gates: gs,
    fresh,
    widthOf,
    bitNet,
    funcs: mod.functions,
    callSeq,
    signedOf,
  })
  const taskCtx = (comb: boolean): TaskCtx => ({
    tasks: mod.tasks,
    funcs: mod.functions,
    mems: mod.mems,
    comb,
    callSeq,
    widthOf,
    registerWidth: (name, wd) => {
      if (wd > 1) mod.widths.set(name, wd)
    },
    stack: new Set(),
  })

  // ── THE TRANSITIVE-UNBUILT RULE ────────────────────────────────────────────────────────────────────
  // A construct this importer skipped still drove something. Every bit it might have driven has NO honest
  // value here, and (after spreadUnbuilt below) neither has anything that reads one. The front end used to
  // warn about the construct and publish the design anyway, so those bits read 0 and the logic downstream
  // computed on that 0 — a normal-looking design decoding to wrong logic with no warning about the ANSWER.
  const unbuiltNets = new Set<string>()
  const unbuiltConstructs: string[] = []
  let wholeModuleUnbuilt = false
  const noteReason = (reason: string): void => {
    if (!unbuiltConstructs.includes(reason)) unbuiltConstructs.push(reason)
  }
  const noteConstruct = (what: string, where: string): void => {
    noteReason(`${what}, ${where}`)
  }
  const markUnbuilt = (what: string, where: string, bits: string[]): void => {
    if (bits.length === 0) return
    noteConstruct(what, where)
    for (const b of bits) unbuiltNets.add(b)
  }
  const markUnbuiltReason = (reason: string, bits: string[]): void => {
    if (bits.length === 0) return
    noteReason(reason)
    for (const b of bits) unbuiltNets.add(b)
  }
  /** Every bit of every net a token span NAMES, minus this module's own inputs. The fallback for a target
   *  that cannot be read as an lvalue (a switch primitive's terminal, a dynamic bit-select, a whole always
   *  block body): naming too many nets erases real hardware, naming too few publishes a value nothing
   *  produced, and only the second of those can be silent. */
  const bitsNamedIn = (span: Tok[]): string[] => {
    const out: string[] = []
    for (const t of span) {
      if (t.k !== 'id') continue
      const mem = mod.mems.get(t.v)
      if (mem !== undefined) {
        for (let k = 0; k < mem.depth; k++)
          for (let i = 0; i < mem.width; i++) out.push(bitNet(memWord(t.v, k), i))
        continue
      }
      for (let i = 0; i < widthOf(t.v); i++) {
        const b = bitNet(t.v, i)
        if (!inputs.has(b)) out.push(b)
      }
    }
    return out
  }
  /** The bits a refused driver's target span claims: read as an lvalue where that works, else every net the
   *  span names. */
  const targetBits = (span: Tok[]): string[] => {
    const lb = lhsBits(span, widthOf, bitNet)
    return 'bits' in lb ? lb.bits : bitsNamedIn(span)
  }
  /** A block whose body could not be elaborated still wrote every register it assigns. */
  const bodyTargetBits = (what: string, where: string, body: Tok[]): void => {
    const spans = assignmentTargets(body)
    if (spans === null) {
      wholeModuleUnbuilt = true
      noteConstruct(what, where)
      return
    }
    markUnbuilt(what, where, spans.flatMap(targetBits))
  }

  const ledger = makeDriverLedger(inputs, (bit) => mod.resolution.has(baseNetOf(bit)))
  const contendedBits = ledger.contendedBits
  const refusals: Refusal[] = []
  const reportRefusedBits = (
    where: string,
    targets: string[],
    refused: Map<string, string>,
  ): void => {
    refusals.push({ where, targets, refused: new Map(refused) })
  }

  // ── gate primitives whose terminals are not plain nets ────────────────────────────────────────────────
  // `and g(t[0], a[0], b[0])` is ordinary Verilog, and the whole instance used to be refused because the
  // parser cannot resolve `t[0]` without knowing t's width. Widths are known HERE, so each terminal is read
  // with the same machinery an assign uses: an output terminal as an lvalue (exactly one bit), an input
  // terminal as a one-bit expression, whose own gates are emitted alongside.
  for (const raw of mod.rawGates) {
    const where = `line ${raw.line}`
    const what = `a "${raw.prim}" gate terminal this importer cannot resolve`
    const outSlices = N_OUTPUT_PRIMS.has(raw.prim)
      ? raw.slices.slice(0, -1)
      : raw.slices.slice(0, 1)
    const inSlices = N_OUTPUT_PRIMS.has(raw.prim) ? raw.slices.slice(-1) : raw.slices.slice(1)
    const outNets: string[] = []
    let bad: string | undefined
    for (const sl of outSlices) {
      const lb = lhsBits(sl, widthOf, bitNet)
      if ('bad' in lb) bad = lb.bad
      else if (lb.bits.length !== 1) bad = 'a gate output must be exactly one bit'
      else outNets.push(lb.bits[0] as string)
    }
    const inGates: GateInst[] = []
    const inNets: string[] = []
    for (const sl of inSlices) {
      const ast = bindCalls(parseRhs(sl, mod.mems), mod.functions)
      const why = firstBad(ast) ?? outOfRange(ast, widthOf)
      if (why !== undefined) {
        bad = why
        continue
      }
      const bit = synthAt(ast, 1, false, synCtx(inGates))[0] as Bit
      if (isX(bit)) {
        bad = 'a gate input reads x in Verilog'
        continue
      }
      const net = isC(bit) ? tie(bit.c) : bit.n
      if (net === undefined) {
        bad = 'a constant gate input has no live net to tie it to'
        continue
      }
      inNets.push(net)
    }
    if (bad !== undefined || outNets.length === 0 || inNets.length === 0) {
      warnings.push(
        `line ${raw.line}: a "${raw.prim}" terminal is not a plain net — ${bad ?? 'the instance has no usable terminals'} — reported, not built`,
      )
      markUnbuilt(what, where, outSlices.flatMap(targetBits))
      const refusedRaw = ledger.claim(where, outSlices.flatMap(targetBits))
      if (refusedRaw.size > 0) reportRefusedBits(where, outSlices.flatMap(targetBits), refusedRaw)
      continue
    }
    mod.gates.push(...inGates)
    mod.gates.push({ prim: raw.prim, terminals: [...outNets, ...inNets], line: raw.line })
  }

  // EVERY producer of a driver goes through ledger.claim, in source-visible order: structural primitives
  // first, then the drivers we refuse to build (they own their bits exactly like a built one), then the
  // continuous assigns, the combinational always blocks and the clocked always blocks below. A structural
  // gate used to be seeded into a plain Set, so two gates on one net collapsed into one entry and nothing
  // ever compared them — the only driver pairing that was never checked at all.
  for (const g of mod.gates) {
    const outs = gateOutputs(g)
    const where = `${lineOf(g)}: "${g.prim}" gate`
    const refused = ledger.claim(where, outs)
    if (refused.size > 0) reportRefusedBits(where, outs, refused)
  }
  for (const r of mod.refusedDrivers) {
    if (r.wholeModule === true) {
      wholeModuleUnbuilt = true
      noteConstruct(r.what, r.where)
      continue
    }
    const bits = [...new Set(r.terms.flatMap(targetBits))]
    if (bits.length === 0) {
      // The construct was skipped and not one net it touches can be named — there is no smaller honest
      // answer than "this design is not built".
      wholeModuleUnbuilt = true
      noteConstruct(r.what, r.where)
      continue
    }
    markUnbuilt(r.what, r.where, bits)
    const refused = ledger.claim(r.where, bits)
    if (refused.size > 0) reportRefusedBits(r.where, bits, refused)
  }

  const built: { targets: string[]; gates: GateInst[] }[] = []
  for (const a of mod.assigns) {
    // A memory can only be written by a clocked always block (its words are flip-flops); an unclocked
    // continuous assign to mem[addr] would need a latch + decode we don't model — reported.
    if (a.lhs[0]?.k === 'id' && mod.mems.has(a.lhs[0].v)) {
      warnings.push(
        `line ${a.line}: continuous assign to memory "${a.lhs[0].v}" (unclocked array write) is not supported — write it in an always @(posedge clk) block — reported, not built`,
      )
      markUnbuilt(
        `a continuous assign to the memory "${a.lhs[0].v}"`,
        `line ${a.line}`,
        bitsNamedIn([a.lhs[0]]),
      )
      continue
    }
    const lb = lhsBits(a.lhs, widthOf, bitNet)
    if ('bad' in lb) {
      warnings.push(`line ${a.line}: assign target — ${lb.bad} — reported, not built`)
      markUnbuilt(
        'a continuous assign this importer cannot build',
        `line ${a.line}`,
        bitsNamedIn(a.lhs),
      )
      continue
    }
    if (lb.note !== undefined) warnings.push(`line ${a.line}: ${lb.note}`)
    const targets = lb.bits
    if (targets.length === 0) continue
    const where = `line ${a.line}: assign to "${a.lhs.map((t) => t.v).join('')}"`
    const refused = ledger.claim(where, targets, CONTENDED_ASSIGN)
    if (refused.size === targets.length) {
      reportRefusedBits(where, targets, refused)
      continue
    }
    const ast = bindCalls(parseRhs(a.rhs, mod.mems), mod.functions)
    const bad = firstBad(ast)
    if (bad !== undefined) {
      warnings.push(`line ${a.line}: assign not synthesized — ${bad}`)
      markUnbuilt('a continuous assign this importer cannot build', `line ${a.line}`, targets)
      continue
    }
    // An out-of-range constant select reads x in Verilog — not representable in a 0/1 netlist, so report it
    // rather than silently substitute 0.
    const oor = outOfRange(ast, widthOf)
    if (oor !== undefined) {
      warnings.push(`line ${a.line}: ${oor} reads x in Verilog — reported, not built`)
      markUnbuilt('a continuous assign that reads out of range', `line ${a.line}`, targets)
      continue
    }
    const gates: GateInst[] = []
    const rhs = synthAt(ast, targets.length, isSigned(ast, signedOf), synCtx(gates))
    const wired: string[] = []
    for (let i = 0; i < targets.length; i++) {
      const tb = targets[i] as string
      if (refused.has(tb)) continue
      const src = rhs[i] as Bit
      if (isX(src)) {
        refused.set(tb, STAYS_X)
        continue
      }
      const from = isC(src) ? tie(src.c) : src.n
      if (from === undefined) {
        refused.set(tb, NEEDS_TIE) // a constant bit with no live net to tie it to
        continue
      }
      gates.push({ prim: 'buf', terminals: [tb, from] })
      wired.push(tb)
    }
    if (refused.size > 0) reportRefusedBits(where, targets, refused)
    if (wired.length > 0) built.push({ targets: wired, gates })
  }

  // ── combinational always-blocks (@(*) / @* / @(a or b)) → the assigned registers become COMBINATIONAL
  // functions, driven exactly like continuous assigns. Elaborate the body with the same nonblocking machinery
  // the clocked path uses (for pure combinational logic every net settles the same regardless of =/<= — only
  // the simulation scheduling differs, not the synthesized steady state), then buffer each written register's
  // bits onto its net. Joining `built` means the combinational-loop guard below AUTOMATICALLY catches an
  // inferred latch: an incomplete assignment (an if/case with no else/default) holds the register, i.e. feeds
  // it back on itself, which is a real combinational cycle — reported, not built. ──────────────────────────
  for (const blk of mod.alwaysBlocks) {
    if (blk.clk !== null) continue // clocked → flip-flops, handled after the loop guard
    const parsed = parseProcedural(blk.body, mod.mems, true, widthOf) // comb: blocking `=` + full-case coverage
    // Inline any task call (inputs bound, outputs written back) before elaboration.
    const seq = parsed.t === 'bad' ? parsed : expandTaskCalls(parsed, taskCtx(true), false)
    if (seq.t === 'bad') {
      warnings.push(`line ${blk.line}: always block — ${seq.why} — reported, not built`)
      bodyTargetBits(
        'a combinational always block this importer cannot build',
        `line ${blk.line}`,
        blk.body,
      )
      continue
    }
    if (collectMemWrites(seq).length > 0) {
      warnings.push(
        `line ${blk.line}: a combinational always block can't write a memory (an array write needs a clock) — reported, not built`,
      )
      bodyTargetBits(
        'a combinational always block that writes a memory',
        `line ${blk.line}`,
        blk.body,
      )
      continue
    }
    const written = new Set<string>()
    const env = elaborate(seq, new Map(), written)
    for (const r of written) {
      const raw = env.get(r)
      if (raw === undefined) continue
      const ast = bindCalls(raw, mod.functions)
      const bad = firstBad(ast)
      const oor = outOfRange(ast, widthOf)
      const w = widthOf(r)
      const targets = Array.from({ length: w }, (_, i) => bitNet(r, i))
      const where = `line ${blk.line}: combinational always block driving register "${r}"`
      // The claim comes BEFORE the reasons we might not build this block: a block whose body we cannot
      // synthesize still wrote a driver, and a second block writing the same register is a contention, not a
      // lone driver. Claiming only where we build would leave the unsynthesizable ones owning nothing.
      const refused = ledger.claim(where, targets, CONTENDED_REGISTER)
      const unsynth =
        bad !== undefined
          ? `register "${r}" not synthesized — ${bad}`
          : oor !== undefined
            ? `${oor} reads x in Verilog — reported, not built`
            : undefined
      if (unsynth !== undefined) {
        warnings.push(`line ${blk.line}: ${unsynth}`)
        markUnbuilt(
          'a combinational always block this importer cannot build',
          `line ${blk.line}`,
          targets,
        )
        if (refused.size > 0) reportRefusedBits(where, targets, refused)
        continue
      }
      if (refused.size === targets.length) {
        reportRefusedBits(where, targets, refused)
        continue
      }
      const gates: GateInst[] = []
      const rhs = synthAt(ast, w, isSigned(ast, signedOf), synCtx(gates))
      const wired: string[] = []
      for (let i = 0; i < w; i++) {
        const tb = targets[i] as string
        if (refused.has(tb)) continue
        const src = rhs[i] as Bit
        if (isX(src)) {
          refused.set(tb, STAYS_X)
          continue
        }
        const from = isC(src) ? tie(src.c) : src.n
        if (from === undefined) {
          refused.set(tb, NEEDS_TIE)
          continue
        }
        gates.push({ prim: 'buf', terminals: [tb, from] })
        wired.push(tb)
      }
      if (refused.size > 0) reportRefusedBits(where, targets, refused)
      if (wired.length > 0) built.push({ targets: wired, gates })
    }
  }

  // Combinational-loop guard over the full PER-GATE driver graph — every structural gate, every synthesized
  // gate, and the tie gates. Each gate's output net depends on its input nets; a genuine feedback cycle
  // (assign feeding its own target, directly or through a structural gate) is reported and NOT built, while
  // a multi-bit assign whose bits merely shuffle each other (p = {q[0], a}; q = {p[0], b}) stays acyclic.
  const driverInputs = new Map<string, string[]>()
  const addGraph = (gs: GateInst[]) => {
    for (const g of gs) {
      const ins = gateInputs(g)
      for (const o of gateOutputs(g)) driverInputs.set(o, ins)
    }
  }
  addGraph(mod.gates)
  for (const b of built) addGraph(b.gates)
  addGraph(tieGates)
  const onCycle = cycleNets(driverInputs)

  // A loop is cut PER GATE, not per assignment: `assign o = {a[3:1], o[0]};` loops on o[0] alone, so o[0]
  // loses its driver and o[3:1] keep theirs. Filtering by gate output (rather than by target bit) also cuts a
  // cycle that closes through an INTERMEDIATE net, which dropping the output buffers alone would leave spinning.
  for (const b of built) {
    const looped = b.targets.filter((tb) => onCycle.has(tb))
    if (looped.length === 0) {
      mod.gates.push(...b.gates)
      continue
    }
    reportRefusedBits(
      'combinational loop',
      b.targets,
      new Map(looped.map((tb) => [tb, 'feeds back on itself — reported, not built'])),
    )
    // NOT marked unbuilt. A combinational loop's value is x in Verilog, exactly like a contention, and the
    // x/contention rule (see WHY THE x GUARD AND THE CONTENTION GUARD SAY THE SAME THING) is deliberately
    // unchanged here: the looped bit loses its driver and reads undriven, while the bits around it keep
    // theirs. Poisoning it would erase a whole design over one bit Verilog itself calls unknown.
    mod.gates.push(...retractOutputs(b.gates, onCycle))
  }

  // ── clocked always-blocks → one D flip-flop per registered bit + its next-state gates ──────────────
  // Nonblocking `<=` semantics: every read binds to the pre-edge value, statement order is irrelevant, and
  // last-write-wins — so each register's next state is one combinational function of the CURRENT state and
  // inputs. We elaborate the body to that per-register function, synthesize it with the SAME gate machinery
  // as the assigns, and feed each bit into a real positive-edge D flip-flop. The flop is a combinational cut:
  // its D-net is always distinct from its Q-net, so the state→next-state→state feedback closes only through
  // net naming and resolves across clock edges (never a combinational loop).
  const registered = new Set<string>()
  const badMem = new Set<string>() // memories with a faulty store (address/value) — reported once, not built
  const reportedMem = new Set<string>() // memory bases already reported for a multi-block-drive conflict
  const memBaseOf = (r: string): string | undefined => {
    const m = /^(.*)\[\d+\]$/.exec(r)
    return m !== null && mod.mems.has(m[1] as string) ? (m[1] as string) : undefined
  }
  for (const blk of mod.alwaysBlocks) {
    if (blk.clk === null) continue // combinational — handled above as continuous drives, not flip-flops
    const parsed = parseProcedural(blk.body, mod.mems, false, widthOf)
    // A task call in a clocked block is reported (expandTaskCalls with comb=false); a block without one passes.
    const expanded = parsed.t === 'bad' ? parsed : expandTaskCalls(parsed, taskCtx(false), false)
    // `@(posedge clk or posedge reset)` — split the reset branch off the body, so what is synthesized below is
    // the ordinary next-state logic and the reset becomes the flip-flop's real asynchronous CLEAR pin.
    const async = blk.reset === null ? null : splitAsyncReset(blk, expanded, widthOf)
    if (async !== null && 'bad' in async) {
      warnings.push(`line ${blk.line}: always block — ${async.bad} — reported, not built`)
      bodyTargetBits(
        'a clocked always block this importer cannot build',
        `line ${blk.line}`,
        blk.body,
      )
      continue
    }
    const clkNet = async === null ? blk.clk : async.clk
    const resetNet = async === null ? undefined : async.reset
    const seq = async === null ? expanded : async.body
    if (seq.t === 'bad') {
      warnings.push(`line ${blk.line}: always block — ${seq.why} — reported, not built`)
      bodyTargetBits(
        'a clocked always block this importer cannot build',
        `line ${blk.line}`,
        blk.body,
      )
      continue
    }
    // Validate each store address ONCE (a memwrite fans out to `depth` word-registers, so a per-word check
    // would report the same fault `depth` times). A faulty store marks the whole memory not-built.
    for (const mw of collectMemWrites(seq)) {
      const bad = firstBad(mw.idx) ?? firstBad(mw.rhs)
      const oor = outOfRange(mw.idx, widthOf) ?? outOfRange(mw.rhs, widthOf)
      const v = foldConst(mw.idx, widthOf)
      const oob = v !== undefined && v >= mw.depth
      if (bad === undefined && oor === undefined && !oob) continue
      const why = bad ?? (oob ? `store address ${v} is out of range` : `${oor} reads x in Verilog`)
      warnings.push(`line ${blk.line}: store to "${mw.name}" — ${why} — reported, not built`)
      markUnbuilt(
        `a store to the memory "${mw.name}" this importer cannot build`,
        `line ${blk.line}`,
        bitsNamedIn([{ k: 'id', v: mw.name, line: blk.line }]),
      )
      badMem.add(mw.name)
    }
    const written = new Set<string>()
    const env = elaborate(seq, new Map(), written)
    for (const r of written) {
      const base = memBaseOf(r)
      if (base !== undefined && badMem.has(base)) continue // faulty store, already reported above
      if (registered.has(r)) {
        // Two always blocks writing one register is the same contention as two assigns on one net: the
        // flip-flops the FIRST block built are retracted below, so the register really is not built. The
        // claim runs through the ledger like every other one — it is what marks the bits contended.
        ledger.claim(
          `line ${blk.line}: clocked always block driving register "${r}"`,
          Array.from({ length: widthOf(r) }, (_, i) => bitNet(r, i)),
          CONTENDED_REGISTER,
        )
        if (base !== undefined) {
          if (!reportedMem.has(base)) {
            warnings.push(
              `memory "${base}" is written by more than one always block — no word it drives is built`,
            )
            reportedMem.add(base)
          }
          continue
        }
        warnings.push(
          `register "${r}" is written by more than one always block — neither block's flip-flops are built, so it reads undriven`,
        )
        continue
      }
      const raw = env.get(r)
      if (raw === undefined) continue
      const ast = bindCalls(raw, mod.functions)
      const bad = firstBad(ast)
      const oor = outOfRange(ast, widthOf)
      const w = widthOf(r)
      const qBits = Array.from({ length: w }, (_, i) => bitNet(r, i))
      // Driving an input port (scalar OR any bus bit) is illegal; a bit already sourced by a gate/assign is a
      // multiple-driver conflict. Both are checked at the BIT level by the ledger, and a faulted bit costs
      // only ITSELF its flip-flop — the rest of the register still clocks.
      const where = `line ${blk.line}: clocked always block driving register "${r}"`
      const refused = ledger.claim(where, qBits, CONTENDED_REGISTER)
      const unsynth =
        bad !== undefined
          ? `register "${r}" not synthesized — ${bad}`
          : oor !== undefined
            ? `${oor} reads x in Verilog — reported, not built`
            : undefined
      if (unsynth !== undefined) {
        warnings.push(`line ${blk.line}: ${unsynth}`)
        markUnbuilt('a clocked always block this importer cannot build', `line ${blk.line}`, qBits)
        if (refused.size > 0) reportRefusedBits(where, qBits, refused)
        continue
      }
      if (refused.size === qBits.length) {
        reportRefusedBits(where, qBits, refused)
        continue
      }
      // Synthesize the next-state logic, then one flop per bit. Buffer a pure hold (D-net === Q-net) so the
      // flop's D and Q pins never land on the same net (which would short them).
      const dGates: GateInst[] = []
      const D = synthAt(ast, w, isSigned(ast, signedOf), synCtx(dGates))
      const newFlops: FlopInst[] = []
      for (let i = 0; i < w; i++) {
        const qNet = qBits[i] as string
        if (refused.has(qNet)) continue
        const dbit = D[i] as Bit
        let dNet: string
        if (isX(dbit)) {
          refused.set(qNet, CLOCKS_IN_X)
          continue
        }
        if (isC(dbit)) {
          const t = tie(dbit.c)
          if (t === undefined) {
            refused.set(qNet, NEEDS_TIE)
            continue
          }
          dNet = t
        } else if (dbit.n === qNet) {
          dNet = fresh()
          dGates.push({ prim: 'buf', terminals: [dNet, qNet] })
        } else dNet = dbit.n
        newFlops.push({
          d: dNet,
          clk: clkNet,
          q: qNet,
          ...(resetNet === undefined ? {} : { reset: resetNet }),
        })
      }
      if (refused.size > 0) reportRefusedBits(where, qBits, refused)
      if (newFlops.length === 0) continue
      mod.gates.push(...dGates)
      mod.flops.push(...newFlops)
      registered.add(r)
    }
  }

  // A memory that is read but never written has undriven word registers (its read-mux inputs float). Real
  // memory powers up undefined, so this is a write-before-read hazard worth surfacing rather than a hard error.
  for (const [name, info] of mod.mems) {
    const anyWritten = Array.from({ length: info.depth }, (_, k) => memWord(name, k)).some((w) =>
      registered.has(w),
    )
    if (anyWritten) continue
    const isRead =
      mod.assigns.some((a) => a.rhs.some((t) => t.v === name)) ||
      mod.alwaysBlocks.some((b) => b.body.some((t) => t.v === name))
    if (isRead)
      warnings.push(
        `memory "${name}" is read but never written — its words are undriven (write a location before reading it)`,
      )
  }

  // `initial <reg> = <constant>` — the register's contents at power-on. Every flip-flop this importer builds
  // powers up holding 0 (measured on the real cell, not assumed), so a zero is honoured exactly and anything
  // else is refused by name rather than quietly ignored. Read as a DRIVER instead, this used to contend with
  // the always block clocking the same register and cost both of them their drivers.
  for (const v of mod.powerOnValues) {
    const bits = Array.from({ length: widthOf(v.name) }, (_, i) => bitNet(v.name, i))
    if (v.value.value === 0n && registered.has(v.name)) continue
    const why =
      v.value.value === 0n
        ? `nothing clocks it, so there is no flip-flop to hold that value`
        : `the flip-flops this importer builds power up holding 0, and this asks for ${v.value.value}`
    warnings.push(`line ${v.line}: initial value on "${v.name}" — ${why} — reported, not built`)
    markUnbuiltReason(
      `the power-on value of "${v.name}" (line ${v.line}) — ${why}`,
      bits.length === 0 ? [bitNet(v.name, 0)] : bits,
    )
  }

  mod.gates.push(...tieGates) // tie drivers read only inputs → never on a cycle → always safe to keep

  // Retract every driver of a contended bit (see contendedBits). This runs last so it catches all three
  // kinds at once: a structural gate, a synthesized assign/combinational buffer, and a flip-flop. Only the
  // contended OUTPUTS go — a multi-output `buf`/`not` keeps the bits nothing else drives.
  if (contendedBits.size > 0) {
    mod.gates = retractOutputs(mod.gates, contendedBits)
    mod.flops = mod.flops.filter((f) => !contendedBits.has(f.q))
  }

  // A driver on an INPUT port is illegal Verilog. It was reported and then LEFT IN the netlist, where it
  // beat the value actually applied to the pin — the design read the internal gate, not its own input.
  if (ledger.inputDrivenBits.size > 0) {
    mod.gates = retractOutputs(mod.gates, ledger.inputDrivenBits)
    mod.flops = mod.flops.filter((f) => !ledger.inputDrivenBits.has(f.q))
  }

  // `wor`/`wand` (and `trior`/`triand`) COMBINE their drivers. Treating a second driver on one as a
  // contention states the opposite of what the net type means, and erased hardware Verilog resolves.
  combineResolvedDrivers(mod, fresh)

  // A net reaches the same "no honest value" state WITHOUT any construct being skipped: nothing ever drove
  // it, or every driver of it was retracted just above (two drivers contending, a driver on an input port, a
  // combinational loop). Verilog reads all three as x. This netlist reads them as 0, so a reader of one
  // computes on an invented 0 — the very defect the transitive rule exists to stop, arriving by a door the
  // skipped-construct ledger cannot see. The finished netlist is the only place the question can be answered
  // instead of predicted, so it is asked here, after the last retraction.
  const drivenBits = new Set<string>()
  for (const g of mod.gates) for (const o of gateOutputs(g)) drivenBits.add(o)
  for (const f of mod.flops) drivenBits.add(f.q)
  const undrivenRead = new Set<string>()
  const readsBit = (bit: string): void => {
    if (drivenBits.has(bit) || inputs.has(bit)) return
    undrivenRead.add(bit)
  }
  for (const g of mod.gates) for (const i of gateInputs(g)) readsBit(i)
  for (const f of mod.flops) {
    readsBit(f.d)
    readsBit(f.clk)
    if (f.reset !== undefined) readsBit(f.reset)
  }
  // An undriven OUTPUT PORT is deliberately NOT seeded. lower() leaves such a port out of the block's
  // interface entirely, so there is no pin for anyone to read an invented 0 from — the design that IS
  // published is complete, and refusing it would erase the bits around it that are real hardware.
  const undrivenGroups = new Map<string, string[]>()
  for (const bit of undrivenRead) {
    // An input port is deliberately absent from this walk: a driver on one is retracted, but the PIN still
    // drives the net, so the bit is not undriven at all.
    const why = ledger.contendedBits.has(bit)
      ? 'more than one driver, so Verilog reads it as x'
      : onCycle.has(bit)
        ? 'a combinational loop, so Verilog reads it as x'
        : 'no driver at all'
    const list = undrivenGroups.get(why)
    if (list === undefined) undrivenGroups.set(why, [bit])
    else list.push(bit)
  }
  for (const [why, bits] of undrivenGroups)
    markUnbuiltReason(
      `${bits.length === 1 ? 'net' : 'nets'} ${bitList(bits)} — ${why} — and something reads ${bits.length === 1 ? 'it' : 'them'}`,
      bits,
    )

  spreadUnbuilt(mod.gates, mod.flops, unbuiltNets)
  mod.unbuilt = {
    nets: unbuiltNets,
    constructs: unbuiltConstructs,
    wholeModule: wholeModuleUnbuilt,
  }

  // Every per-bit refusal is reported HERE, once the netlist can no longer change, so each message's claim
  // about which bits kept their driver is read off the finished netlist rather than predicted.
  const finallyDriven = new Set<string>()
  for (const g of mod.gates) for (const o of gateOutputs(g)) finallyDriven.add(o)
  for (const f of mod.flops) finallyDriven.add(f.q)
  for (const r of refusals) emitRefusal(warnings, r, finallyDriven)
}

/** The first out-of-range constant bit/part-select in the tree (Verilog x), or undefined. */
function outOfRange(e: Expr, w: (n: string) => number): string | undefined {
  switch (e.t) {
    case 'bitsel':
      return e.index < 0 || e.index >= w(e.name)
        ? `bit-select ${e.name}[${e.index}] is out of range on the ${w(e.name)}-bit net "${e.name}" —`
        : undefined
    case 'partsel':
      return e.hi >= w(e.name) || e.lo < 0
        ? `part-select ${e.name}[${e.hi}:${e.lo}] is out of range on the ${w(e.name)}-bit net "${e.name}" —`
        : undefined
    case 'un':
      return outOfRange(e.a, w)
    case 'bin':
      return outOfRange(e.a, w) ?? outOfRange(e.b, w)
    case 'tern':
      return outOfRange(e.c, w) ?? outOfRange(e.a, w) ?? outOfRange(e.b, w)
    case 'concat':
      for (const p of e.parts) {
        const r = outOfRange(p, w)
        if (r !== undefined) return r
      }
      return undefined
    case 'repl':
      return outOfRange(e.of, w)
    case 'memread': {
      const inner = outOfRange(e.idx, w)
      if (inner !== undefined) return inner
      const v = foldConst(e.idx, w)
      return v !== undefined && v >= e.depth
        ? `memory read ${e.name}[${v}] is out of range on the ${e.depth}-word memory "${e.name}" —`
        : undefined
    }
    case 'call': {
      for (const a of e.args) {
        const r = outOfRange(a, w)
        if (r !== undefined) return r
      }
      return undefined
    }
    case 'sized':
    case 'cast':
      return outOfRange(e.of, w)
    default:
      return undefined
  }
}

const N_OUTPUT_PRIMS = new Set(['buf', 'not'])
const gateOutputs = (g: GateInst): string[] =>
  N_OUTPUT_PRIMS.has(g.prim) ? g.terminals.slice(0, -1) : [g.terminals[0] as string]
const gateInputs = (g: GateInst): string[] =>
  N_OUTPUT_PRIMS.has(g.prim)
    ? [g.terminals[g.terminals.length - 1] as string]
    : g.terminals.slice(1)

/**
 * Take `nets` off the OUTPUT side of every gate. A single-output primitive that drives one of them goes away;
 * a multi-output `buf`/`not` (`buf b(o1, o2, in);` is legal Verilog) keeps the outputs that were NOT named,
 * because dropping the whole gate would take a live driver off a net that has no second driver at all — the
 * bug this pass exists to avoid, one level down from the assignment that produced the gate.
 */
function retractOutputs(gates: GateInst[], nets: Set<string>): GateInst[] {
  const kept: GateInst[] = []
  for (const g of gates) {
    const outs = gateOutputs(g)
    const live = outs.filter((o) => !nets.has(o))
    if (live.length === outs.length) {
      kept.push(g)
      continue
    }
    if (live.length === 0) continue
    kept.push({ prim: g.prim, terminals: [...live, ...gateInputs(g)] })
  }
  return kept
}

/** At most eight bit names, so a wide bus reports readably instead of printing 64 net names. */
function bitList(bits: string[]): string {
  const shown = bits.slice(0, 8).map((b) => `"${b}"`)
  return bits.length <= 8 ? shown.join(', ') : `${shown.join(', ')} and ${bits.length - 8} more`
}

/** A singular-agreeing noun phrase for the refused bits, so one sentence template fits one bit, some bits and
 *  all of them ("bit "o[0]" is …", "each of bits "o[0]", "o[2]" is …", "every bit (…) is …"). */
function subjectOf(bits: string[], targets: string[]): string {
  if (bits.length === 1) return `bit ${bitList(bits)}`
  if (bits.length === targets.length) return `every bit (${bitList(bits)})`
  return `each of bits ${bitList(bits)}`
}

/** One vector driver's refused bits, held until the netlist is final (see emitRefusal). */
type Refusal = { where: string; targets: string[]; refused: Map<string, string> }

/** Where a structural gate was written, for a message that has to name it. A gate the synthesizer minted has
 *  no source line of its own. */
const lineOf = (g: GateInst): string => (g.line === undefined ? 'synthesized' : `line ${g.line}`)

/**
 * THE ONE PLACE A DRIVER IS REGISTERED.
 *
 * Every producer of a driver — a continuous assign, a combinational or clocked always block, a structural
 * primitive, a sub-module output port (which the flattener turns into a continuous assign), and the REFUSED
 * form of each — claims its target bits here and nowhere else. A second claim on a bit is therefore detected
 * whichever producers made the two claims, which is the property that kept failing one pairing at a time:
 * structural gates used to be seeded into a plain Set (so two gates on one net collapsed silently into one
 * entry), and a driver the importer refused used to claim nothing at all (so the next driver became the bit's
 * only owner and published a value the hardware does not have).
 *
 * A claim is bookkeeping only. What the caller does with the returned refusals is its own business, and the
 * RETRACTION of the drivers already built for a contended bit happens once, at the end of synthesis, from
 * `contendedBits` — so it catches a structural gate, a synthesized buffer and a flip-flop alike.
 *
 * Two things make a bit unclaimable, and they are different: driving an INPUT port is illegal in the source,
 * and nobody owns the bit afterwards; a CONTENTION means someone already owns it, and neither owner may keep
 * it, because a two-valued netlist has no x to publish. `contendedReason` lets a caller word the second case
 * in its own terms (an assign says "assigned more than once", a register says "already driven").
 */
type DriverLedger = {
  claim: (where: string, bits: string[], contendedReason?: string) => Map<string, string>
  /** Bits more than one driver claimed — every driver of one is retracted at the end of synthesis. */
  contendedBits: Set<string>
  /** Bits a driver claimed that are module INPUTS. Illegal in the source, and the driver is retracted at the
   *  end of synthesis: left in, it beat the value applied to the pin and the design read itself. */
  inputDrivenBits: Set<string>
  /** Bit → the `where` of the driver that claimed it first. Reported by the caller, not used for control. */
  firstClaim: Map<string, string>
}

/** `resolvesDrivers` marks a bit whose net type COMBINES its drivers (`wor`, `wand`, `trior`, `triand`).
 *  A second claim there is not a contention; it is what the net is for. */
function makeDriverLedger(
  inputs: Set<string>,
  resolvesDrivers: (bit: string) => boolean,
): DriverLedger {
  const firstClaim = new Map<string, string>()
  const contendedBits = new Set<string>()
  const inputDrivenBits = new Set<string>()
  const claim = (
    where: string,
    bits: string[],
    contendedReason = CONTENDED_ASSIGN,
  ): Map<string, string> => {
    const refused = new Map<string, string>()
    for (const bit of bits) {
      if (inputs.has(bit)) {
        refused.set(bit, DRIVES_INPUT)
        inputDrivenBits.add(bit)
        continue
      }
      if (!firstClaim.has(bit)) {
        firstClaim.set(bit, where)
        continue
      }
      if (resolvesDrivers(bit)) continue
      refused.set(bit, contendedReason)
      contendedBits.add(bit)
    }
    return refused
  }
  return { claim, contendedBits, inputDrivenBits, firstClaim }
}

/** The declared net a bit-net belongs to: `t[3]` → `t`, `t` → `t`. */
function baseNetOf(bit: string): string {
  const m = /^(.*)\[\d+\]$/.exec(bit)
  return m === null ? bit : (m[1] as string)
}

/**
 * EVERYTHING DOWNSTREAM OF AN UNBUILT NET IS UNBUILT TOO.
 *
 * A gate whose input has no honest value has no honest output, and a flip-flop fed by one holds an invented
 * value a clock later just as surely — so a register is carried through rather than treated as a boundary.
 * This is the same transitive walk the Gowin bitstream reader makes from a block memory it had to refuse.
 *
 * Stopping at the direct readers would not be a warning about the design: the case this exists for is an
 * ordinary `assign o = t | b;` where `t` came from a construct that was skipped, and the wrongness shows up
 * at `o`, one hop away.
 */
/**
 * Split `always @(posedge clk or posedge reset) if (reset) <clear> else <body>` into the clock, the reset, and
 * the ordinary body. Which of the two edge nets is the RESET is not in the sensitivity list at all — both are
 * written `posedge` — so it is read off the leading `if`, and the other net is the clock.
 *
 * Only the clear-to-zero form is accepted. A reset that loads a 1 needs a PRESET the cell here does not have,
 * and a register cleared on reset but never assigned otherwise has a next state this does not know; both are
 * refused by name rather than approximated, because either guess would be a value the source never wrote.
 */
function splitAsyncReset(
  blk: AlwaysBlock,
  seq: ProcStmt,
  widthOf: (name: string) => number,
): { clk: string; reset: string; body: ProcStmt } | { bad: string } | null {
  if (seq.t === 'bad') return null // already a refusal; the caller reports it with its own reason
  const only = seq.t === 'seq' && seq.body.length === 1 ? (seq.body[0] as ProcStmt) : seq
  if (only.t !== 'if' || only.els === undefined)
    return {
      bad: 'two posedge signals need the form "if (reset) … else …", which this block does not have',
    }
  if (only.cond.t !== 'net')
    return { bad: 'the reset test must be the reset net on its own (no expression)' }
  const tested = only.cond.name
  const pair = [blk.clk, blk.reset]
  if (tested !== pair[0] && tested !== pair[1])
    return {
      bad: `"${tested}" is tested as the reset but is not one of the two posedge signals`,
    }
  const clk = tested === blk.clk ? (blk.reset as string) : (blk.clk as string)
  const cleared = new Map<string, boolean>() // register → every assignment to it is a constant zero
  const walk = (s: ProcStmt): string | null => {
    if (s.t === 'seq') {
      for (const inner of s.body) {
        const bad = walk(inner)
        if (bad !== null) return bad
      }
      return null
    }
    if (s.t === 'nb') {
      const zero = s.rhs.t === 'const' && s.rhs.bits.every((b) => b === 0)
      cleared.set(s.lhs, (cleared.get(s.lhs) ?? true) && zero)
      return zero ? null : `the reset branch loads "${s.lhs}" with something other than 0`
    }
    return 'the reset branch does more than assign constants to registers'
  }
  const bad = walk(only.conseq)
  if (bad !== null) return { bad }
  const assigned = new Set<string>()
  collectAssigned(only.els, assigned)
  const orphan = [...cleared.keys()].filter((r) => !assigned.has(r))
  if (orphan.length > 0)
    return {
      bad: `${orphan.map((r) => `"${r}"`).join(', ')} ${orphan.length === 1 ? 'is' : 'are'} cleared on reset but never assigned otherwise, so ${orphan.length === 1 ? 'its' : 'their'} held value is not known here`,
    }
  for (const r of cleared.keys()) if (widthOf(r) < 1) return { bad: `register "${r}" has no width` }
  return { clk, reset: tested, body: only.els }
}

function spreadUnbuilt(gates: GateInst[], flops: FlopInst[], unbuilt: Set<string>): void {
  const consumers = new Map<string, string[][]>()
  const add = (ins: string[], outs: string[]): void => {
    for (const net of ins) {
      const list = consumers.get(net)
      if (list === undefined) consumers.set(net, [outs])
      else list.push(outs)
    }
  }
  for (const g of gates) add(gateInputs(g), gateOutputs(g))
  for (const f of flops) add([f.d, f.clk, ...(f.reset === undefined ? [] : [f.reset])], [f.q])
  const queue = [...unbuilt]
  while (queue.length > 0) {
    const net = queue.pop() as string
    for (const outs of consumers.get(net) ?? [])
      for (const o of outs)
        if (!unbuilt.has(o)) {
          unbuilt.add(o)
          queue.push(o)
        }
  }
}

/**
 * Combine the drivers of a `wor`/`wand` net into the OR/AND the net type means, instead of calling the
 * second driver a conflict. Each driver keeps its gate but writes a private net; a tree of real 2-input
 * primitives joins those onto the declared net, so the result is ordinary gates like everything else.
 *
 * Runs after every driver exists, which is the only moment the full set of them is known.
 */
function combineResolvedDrivers(mod: SynthModule, fresh: () => string): void {
  if (mod.resolution.size === 0) return
  const driverIndexes = new Map<string, number[]>()
  mod.gates.forEach((g, i) => {
    for (const out of gateOutputs(g)) {
      if (!mod.resolution.has(baseNetOf(out))) continue
      const list = driverIndexes.get(out)
      if (list === undefined) driverIndexes.set(out, [i])
      else list.push(i)
    }
  })
  const joins: GateInst[] = []
  for (const [net, indexes] of driverIndexes) {
    if (indexes.length < 2) continue
    const prim = mod.resolution.get(baseNetOf(net)) === 'and' ? 'and' : 'or'
    const privates: string[] = []
    for (const i of indexes) {
      const g = mod.gates[i] as GateInst
      const priv = fresh()
      privates.push(priv)
      mod.gates[i] = {
        ...g,
        terminals: [...gateOutputs(g).map((o) => (o === net ? priv : o)), ...gateInputs(g)],
      }
    }
    let acc = privates[0] as string
    for (let k = 1; k < privates.length; k++) {
      const out = k === privates.length - 1 ? net : fresh()
      joins.push({ prim, terminals: [out, acc, privates[k] as string] })
      acc = out
    }
  }
  mod.gates.push(...joins)
}

/**
 * Report exactly which bits of one vector driver lost their driver, and say plainly whether the rest of the
 * vector kept its own. `refused` maps a bit-net to the predicate that follows the subject, so bits refused for
 * DIFFERENT reasons get one sentence each rather than being lumped together.
 *
 * Naming one bit while several die reads as a small local problem when it is not, which is why the kept-bits
 * clause is part of the message rather than left to the reader to infer. `driven` is the FINISHED netlist's
 * driver set, not the set at the moment the fault was found: a bit that survived this fault and was retracted
 * by a later one must not be listed as kept, or the message describes something that did not happen.
 */
function emitRefusal(warnings: string[], r: Refusal, driven: Set<string>): void {
  const kept = r.targets.filter((t) => !r.refused.has(t) && driven.has(t))
  const tail =
    kept.length > 0
      ? ` — the other ${kept.length === 1 ? 'bit' : `${kept.length} bits`} (${bitList(kept)}) ${kept.length === 1 ? 'keeps' : 'keep'} this driver`
      : r.targets.length > 1
        ? ' — no bit of it is built'
        : ''
  for (const why of new Set(r.refused.values())) {
    const bits = r.targets.filter((t) => r.refused.get(t) === why)
    warnings.push(`${r.where}: ${subjectOf(bits, r.targets)} ${why}${tail}`)
  }
}

/**
 * WHY THE x GUARD AND THE CONTENTION GUARD SAY THE SAME THING.
 *
 * They are two routes to one situation: a bit whose value Verilog calls unknown. An x reaches a bit through
 * the EXPRESSION (`a & 1'bx`); a contention reaches it through the NET (two drivers). Both end the same way
 * here — that one bit gets no driver, the warning names it, and an undriven net is left out of the module's
 * interface rather than published as 0. Neither guard ever invents a value for a bit whose value is unknown,
 * and neither takes a driver off a bit that HAS one; that is the whole of the agreement.
 *
 * What they cannot do is carry an unknown INTO the netlist, because a two-valued netlist has no x to carry.
 * So logic INSIDE the module that reads an undriven net does read something, and the value it reads is the
 * logic engine's rule for a gate with a floating input (logic-sim.ts stepLogic: a gate whose input net has no
 * value is skipped, and an output nothing ever drove is finally set to 0) — not a decision either guard makes.
 * MEASURED over all 256 (a, b) vectors: the x form `assign t = {a[3:1], 1'bx}; assign o = t | b;` and the
 * contention form `assign t = a; assign t[0] = b[0]; assign o = t | b;` give BIT-IDENTICAL output here — o[0]
 * reads 0 on all 256 vectors in both. A test pins that identity, so the two guards cannot drift apart
 * without a failure.
 *
 * KNOWN AND NOT FIXED HERE: those same 256 vectors show Icarus Verilog 14.0 reading o[0] as 1 on 128 of them
 * (x | 1 is 1), where this engine reads 0. That gap belongs to the floating-input rule above, not to either
 * guard — the x form and the contention form suffer it equally — and closing it means changing how every
 * gate in the logic engine treats a floating input, which is a separate measured change.
 */
const CONTENDED_ASSIGN =
  'is assigned more than once (or already driven by a gate) — two drivers on one net read x in Verilog, so NO driver is built for it and it reads undriven'
const CONTENDED_REGISTER =
  'is already driven by a gate or assign — two drivers on one net read x in Verilog, so NO driver is built for it and it reads undriven'
const STAYS_X =
  'stays x — an x that nothing masks away has no value a two-valued net can carry, so it is reported and left undriven'
const CLOCKS_IN_X =
  'clocks in an x — an x that nothing masks away has no value a two-valued flip-flop can hold, so it is reported and left undriven'
const NEEDS_TIE =
  'needs a constant driver but the module has no input to tie one to — reported, left undriven'
/**
 * An internal driver on an INPUT port is refused and reported, whichever producer wrote it — an assign, an
 * always block or (since the ledger) a structural primitive. The bit itself is NOT retracted, because its
 * driver is the parent outside the module, not anything in here.
 *
 * KNOWN AND NOT FIXED HERE, MEASURED over all 256 (a, b) vectors of
 * `buf g0(a0, b0); buf g1(o0, a0);` and of the same design written `assign a0 = b0;`: Icarus Verilog 14.0
 * resolves the port to x on the 128 vectors where the two disagree, where this engine publishes the parent's
 * value on all 256 — the same 128 bits in BOTH forms, which is the agreement the ledger buys. Closing it
 * means dropping an input port from the interface over an illegal internal driver, which changes the module's
 * shape rather than one bit of it.
 */
const DRIVES_INPUT = 'drives an input port — illegal, reported and left unbuilt'

/** Nets on a combinational cycle in a `net → driver-input-nets` graph (path-based; a feed-forward net that
 *  merely READS a looped net is not flagged). The depth-first walk carries its own stack: a chain of 12,000
 *  buffers is an ordinary structural design and native recursion overflows well before that. */
function cycleNets(edges: Map<string, string[]>): Set<string> {
  const onCycle = new Set<string>()
  const state = new Map<string, 0 | 1 | 2>()
  const path: string[] = []
  for (const root of edges.keys()) {
    if ((state.get(root) ?? 0) !== 0) continue
    const stack: { node: string; next: number }[] = [{ node: root, next: 0 }]
    state.set(root, 1)
    path.push(root)
    while (stack.length > 0) {
      const top = stack[stack.length - 1] as { node: string; next: number }
      const deps = edges.get(top.node) ?? []
      if (top.next >= deps.length) {
        state.set(top.node, 2)
        path.pop()
        stack.pop()
        continue
      }
      const dep = deps[top.next] as string
      top.next += 1
      const s = state.get(dep) ?? 0
      if (s === 1) {
        const from = path.lastIndexOf(dep)
        for (let k = from; k < path.length; k++) onCycle.add(path[k] as string)
        continue
      }
      if (s !== 0) continue
      state.set(dep, 1)
      path.push(dep)
      stack.push({ node: dep, next: 0 })
    }
  }
  return onCycle
}

// ── procedural (always-block) parsing + elaboration ─────────────────────────────
/** A statement inside a clocked always block. `bad` carries the first unsupported construct's reason. */
type ProcStmt =
  // whole-signal assignment. `blocking` (a combinational-block `=`) means later reads in the same block see
  // THIS value (elaborate forward-substitutes it); nonblocking `<=` reads the pre-block value.
  | { t: 'nb'; lhs: string; rhs: Expr; blocking?: boolean }
  // a write to PART of a signal — `pc[7:0] <= d`, `r[1] <= b`. Kept as its own node (rather than rewritten to
  // a whole-signal write at parse time) because two part-writes to DISJOINT slices of one register in the same
  // block must BOTH take effect; only elaborate knows the running next-state value to build the second on.
  | {
      t: 'nbsel'
      lhs: string
      hi: number
      lo: number
      width: number
      rhs: Expr
      blocking?: boolean
    }
  | { t: 'memwrite'; name: string; idx: Expr; rhs: Expr; depth: number } // m[addr] <= expr
  | { t: 'seq'; body: ProcStmt[] } // begin … end
  | { t: 'if'; cond: Expr; conseq: ProcStmt; els?: ProcStmt }
  // a task-call STATEMENT `t(a, b);` — expanded (inputs bound, outputs written back) by expandTaskCalls before
  // elaboration; the raw argument token spans are resolved against the task's arg directions there.
  | { t: 'taskcall'; name: string; argSpans: Tok[][]; line: number }
  | { t: 'bad'; why: string }

/** Parse a clocked always body (its inner statements, no wrapping begin/end) into one procedural statement. */
// `comb` = a combinational always block (@*); it permits blocking `=` (the conventional comb form). A clocked
// block leaves it false, so blocking `=` there stays reported (it would build the wrong hardware).
// `widthOf` (present only when synthesizing, where the width table exists) lets a COMBINATIONAL case with no
// default but full selector coverage build instead of inferring a latch.
function parseProcedural(
  body: Tok[],
  mems: MemTable,
  comb = false,
  widthOf?: (n: string) => number,
): ProcStmt {
  const ts = new TokStream(body)
  const stmts: ProcStmt[] = []
  while (ts.peek() !== undefined) {
    const s = parseStmt(ts, mems, comb, widthOf)
    if (s.t === 'bad') return s
    stmts.push(s)
  }
  if (stmts.length === 0) return { t: 'bad', why: 'the always block is empty' }
  return stmts.length === 1 ? (stmts[0] as ProcStmt) : { t: 'seq', body: stmts }
}

function parseStmt(
  ts: TokStream,
  mems: MemTable,
  comb: boolean,
  widthOf?: (n: string) => number,
): ProcStmt {
  const t = ts.peek()
  if (t === undefined) return { t: 'bad', why: 'unexpected end of the always block' }
  if (t.v === 'begin') {
    ts.next()
    const body: ProcStmt[] = []
    while (ts.peek() !== undefined && ts.peek()?.v !== 'end') {
      const s = parseStmt(ts, mems, comb, widthOf)
      if (s.t === 'bad') return s
      body.push(s)
    }
    if (ts.peek()?.v !== 'end') return { t: 'bad', why: 'a begin block is missing its "end"' }
    ts.next()
    return { t: 'seq', body }
  }
  if (t.v === 'if') {
    ts.next()
    if (ts.peek()?.v !== '(') return { t: 'bad', why: 'if is missing its "("' }
    const cond = parseRhs(readParenToks(ts), mems)
    if (cond.t === 'bad') return { t: 'bad', why: `if condition — ${cond.why}` }
    const conseq = parseStmt(ts, mems, comb, widthOf)
    if (conseq.t === 'bad') return conseq
    if (ts.peek()?.v !== 'else') return { t: 'if', cond, conseq }
    ts.next()
    const els = parseStmt(ts, mems, comb, widthOf)
    if (els.t === 'bad') return els
    return { t: 'if', cond, conseq, els }
  }
  if (t.v === 'case') return parseCase(ts, mems, comb, widthOf)
  if (t.v === 'casex' || t.v === 'casez')
    return {
      t: 'bad',
      why: `${t.v} (x/z don't-care matching) is not representable in a 0/1 netlist`,
    }
  if (t.v === 'for' || t.v === 'while' || t.v === 'repeat' || t.v === 'forever')
    return { t: 'bad', why: `procedural loops (${t.v}) are a later increment` }
  // A statement `name ( … ) ;` is a task call (the only id-then-paren statement form); expandTaskCalls inlines
  // it. An assignment starts `name =`/`name[i] =`/`{…} =` instead, so this never shadows one.
  if (t.k === 'id' && ts.peek(1)?.v === '(') {
    ts.next() // task name
    const argSpans = readCallArgs(ts)
    if (ts.peek()?.v === ';') ts.next()
    return { t: 'taskcall', name: t.v, argSpans, line: t.line }
  }
  return parseAssignStmt(ts, mems, comb, widthOf)
}

/** Read a parenthesized group's inner tokens; cursor must be AT '('; leaves it just past the matching ')'. */
function readParenToks(ts: TokStream): Tok[] {
  ts.next() // '('
  const inner: Tok[] = []
  let depth = 1
  while (ts.peek() !== undefined && depth > 0) {
    const tk = ts.next() as Tok
    if (tk.v === '(') depth++
    else if (tk.v === ')') {
      depth--
      if (depth === 0) break
    }
    inner.push(tk)
  }
  return inner
}

/** Parse `lhs <= rhs ;` (nonblocking). Whole-signal (`reg <= …`) and memory (`mem[addr] <= …`) targets build;
 *  blocking `=`, bit/part-select and concat targets are reported. */
function parseAssignStmt(
  ts: TokStream,
  mems: MemTable,
  comb: boolean,
  widthOf?: (n: string) => number,
): ProcStmt {
  const toks: Tok[] = []
  while (ts.peek() !== undefined && ts.peek()?.v !== ';') toks.push(ts.next() as Tok)
  if (ts.peek()?.v === ';') ts.next()
  let depth = 0
  let opIdx = -1
  for (let i = 0; i < toks.length; i++) {
    const v = (toks[i] as Tok).v
    if (v === '(' || v === '[' || v === '{') depth++
    else if (v === ')' || v === ']' || v === '}') depth--
    else if (depth === 0 && (v === '<=' || v === '=')) {
      opIdx = i
      break
    }
  }
  if (opIdx === -1)
    return { t: 'bad', why: 'a statement is neither a recognized construct nor an assignment' }
  // Blocking `=` is the conventional form in a combinational block (allowed); in a CLOCKED block it builds the
  // wrong hardware (reads should see the pre-clock value), so there it stays reported. Both map to the same
  // 'nb' node — for the pure combinational logic we synthesize, the settled result is identical either way.
  if (!comb && (toks[opIdx] as Tok).v === '=')
    return {
      t: 'bad',
      why: "blocking assignment '=' in a clocked block — use nonblocking '<=' so all reads see the pre-clock value",
    }
  const lhs = toks.slice(0, opIdx)
  const rhs = parseRhs(toks.slice(opIdx + 1), mems)
  if (rhs.t === 'bad') return { t: 'bad', why: rhs.why }
  // Memory write `mem[addr] <= rhs`: the address may be computed, so parse it as a full expression.
  const mem = lhs[0]?.k === 'id' ? mems.get(lhs[0].v) : undefined
  if (mem !== undefined && lhs[0] !== undefined) {
    if (lhs[1]?.v !== '[' || lhs[lhs.length - 1]?.v !== ']' || lhs.length < 4)
      return { t: 'bad', why: `memory "${lhs[0].v}" must be written as ${lhs[0].v}[addr] <= …` }
    const idx = parseRhs(lhs.slice(2, -1), mems)
    if (idx.t === 'bad') return { t: 'bad', why: `memory index — ${idx.why}` }
    // The store address is validated once, width-correctly, in synthesizeBehavioral (it needs the width table);
    // doing it here would fire per-word and miss constant-folded addresses.
    return { t: 'memwrite', name: lhs[0].v, idx, rhs, depth: mem.depth }
  }
  if (lhs.length > 1 && lhs[0]?.k === 'id' && lhs[1]?.v === '[' && widthOf !== undefined)
    return selectTarget(lhs, rhs, (toks[opIdx] as Tok).v === '=', widthOf)
  if (lhs.length !== 1 || lhs[0]?.k !== 'id')
    return {
      t: 'bad',
      why: 'only a whole-signal target (reg <= …) or a constant bit/part-select of one is supported — a concatenation target is a later increment',
    }
  return { t: 'nb', lhs: (lhs[0] as Tok).v, rhs, blocking: (toks[opIdx] as Tok).v === '=' }
}

/**
 * A write to PART of a register — `pc[7:0] <= d`, `r[1] <= bit` — rewritten as the equivalent whole-signal
 * write `pc <= {pc[15:8], d}`. The untouched bits explicitly re-read themselves, which is what the hardware
 * does (the flip-flops outside the select hold), so every existing rule still applies unchanged: the
 * conditional-hold muxing, the blocking-read substitution, and the combinational-latch loop guard all see an
 * ordinary whole-signal assignment. The right-hand side is width-walled to the selected width so it truncates
 * or zero-extends exactly as Verilog specifies.
 */
function selectTarget(
  lhs: Tok[],
  rhs: Expr,
  blocking: boolean,
  widthOf: (n: string) => number,
): ProcStmt {
  const name = (lhs[0] as Tok).v
  if (lhs[lhs.length - 1]?.v !== ']')
    return { t: 'bad', why: `malformed bit/part-select target on "${name}"` }
  const sel = parseSelect(new TokStream(lhs.slice(1)), name)
  if (sel.t === 'bad') return { t: 'bad', why: `target ${name}[…] — ${sel.why}` }
  if (sel.t !== 'bitsel' && sel.t !== 'partsel')
    return { t: 'bad', why: `target ${name}[…] is not a constant bit/part-select` }
  const hi = sel.t === 'bitsel' ? sel.index : sel.hi
  const lo = sel.t === 'bitsel' ? sel.index : sel.lo
  const width = widthOf(name)
  if (lo < 0 || hi >= width)
    return {
      t: 'bad',
      why: `target ${name}[${hi}:${lo}] is outside the ${width}-bit signal "${name}"`,
    }
  return { t: 'nbsel', lhs: name, hi, lo, width, rhs, blocking }
}

/** Forward-substitute a blocking read: replace each read of a signal already assigned in this block with the
 *  value it was assigned (so `t = a&b; y = t` gives y = a&b, and a reassignment `t = c&d` later doesn't
 *  corrupt the earlier read). A whole-signal read substitutes directly; a bit/part-select can only retarget a
 *  simple net-alias, so selecting a bit of a signal assigned a non-trivial expression is reported, not faked. */
function substBlocking(e: Expr, env: Map<string, Expr>): Expr {
  switch (e.t) {
    case 'net':
      return env.get(e.name) ?? e
    case 'bitsel':
    case 'partsel': {
      const v = env.get(e.name)
      if (v === undefined) return e
      if (v.t === 'net') return { ...e, name: v.name } // aliased net → retarget the select
      return {
        t: 'bad',
        why: `a bit/part-select of "${e.name}" after it was assigned an expression earlier in the same combinational block is a later increment`,
      }
    }
    case 'un':
      return { ...e, a: substBlocking(e.a, env) }
    case 'bin':
      return { ...e, a: substBlocking(e.a, env), b: substBlocking(e.b, env) }
    case 'tern':
      return {
        ...e,
        c: substBlocking(e.c, env),
        a: substBlocking(e.a, env),
        b: substBlocking(e.b, env),
      }
    case 'concat':
      return { ...e, parts: e.parts.map((p) => substBlocking(p, env)) }
    case 'repl':
      return { ...e, of: substBlocking(e.of, env) }
    case 'memread':
      return { ...e, idx: substBlocking(e.idx, env) }
    default:
      return e // const, bad
  }
}

/** Parse a `case (sel) … endcase` and desugar it to a nested if/else chain (label match via `sel == label`,
 *  multiple labels OR'd). casex/casez are rejected upstream. */
function parseCase(
  ts: TokStream,
  mems: MemTable,
  comb: boolean,
  widthOf?: (n: string) => number,
): ProcStmt {
  ts.next() // 'case'
  if (ts.peek()?.v !== '(') return { t: 'bad', why: 'case is missing its "("' }
  const sel = parseRhs(readParenToks(ts), mems)
  if (sel.t === 'bad') return { t: 'bad', why: `case selector — ${sel.why}` }
  const items: { labels: Expr[]; stmt: ProcStmt }[] = []
  let dflt: ProcStmt | undefined
  while (ts.peek() !== undefined && ts.peek()?.v !== 'endcase') {
    if (ts.peek()?.v === 'default') {
      ts.next()
      if (ts.peek()?.v === ':') ts.next()
      const s = parseStmt(ts, mems, comb, widthOf)
      if (s.t === 'bad') return s
      dflt = s
      continue
    }
    const labelToks: Tok[][] = []
    let cur: Tok[] = []
    let depth = 0
    while (ts.peek() !== undefined) {
      const v = ts.peek()?.v
      if (depth === 0 && v === ':') {
        ts.next()
        break
      }
      const tk = ts.next() as Tok
      if (tk.v === '(' || tk.v === '[' || tk.v === '{') depth++
      else if (tk.v === ')' || tk.v === ']' || tk.v === '}') depth--
      if (depth === 0 && tk.v === ',') {
        labelToks.push(cur)
        cur = []
      } else cur.push(tk)
    }
    labelToks.push(cur)
    const labels: Expr[] = []
    for (const lt of labelToks) {
      const le = parseRhs(lt, mems)
      if (le.t === 'bad') return { t: 'bad', why: `case label — ${le.why}` }
      labels.push(le)
    }
    const s = parseStmt(ts, mems, comb, widthOf)
    if (s.t === 'bad') return s
    items.push({ labels, stmt: s })
  }
  if (ts.peek()?.v !== 'endcase') return { t: 'bad', why: 'case is missing its "endcase"' }
  ts.next()

  // A COMBINATIONAL case with NO default that fully covers the selector's value space has no latch — the
  // "missing default" is unreachable. Detect that (constant labels exhausting 2^width) and drop the last
  // item's condition so it becomes the unconditional terminal branch, rather than a self-holding latch that
  // the loop guard would (correctly, for an INCOMPLETE case) reject. A clocked case keeps its hold — there a
  // register that isn't reassigned simply holds through its flip-flop.
  let full = false
  if (comb && dflt === undefined && widthOf !== undefined && items.length > 0) {
    const w = selfWidth(sel, widthOf)
    if (w <= 12) {
      const covered = new Set<number>()
      let allConst = true
      for (const it of items)
        for (const lab of it.labels) {
          const v = foldConst(lab, widthOf)
          if (v === undefined) allConst = false
          else covered.add(v % 2 ** w)
        }
      full = allConst && covered.size === 2 ** w
    }
  }
  const lastItem = full
    ? (items[items.length - 1] as { labels: Expr[]; stmt: ProcStmt })
    : undefined
  let chain: ProcStmt = lastItem ? lastItem.stmt : (dflt ?? { t: 'seq', body: [] }) // no default ⇒ hold
  for (let i = items.length - (full ? 2 : 1); i >= 0; i--) {
    const it = items[i] as { labels: Expr[]; stmt: ProcStmt }
    let cond: Expr | undefined
    for (const lab of it.labels) {
      const eq: Expr = { t: 'bin', op: '==', a: sel, b: lab }
      cond = cond === undefined ? eq : { t: 'bin', op: '||', a: cond, b: eq }
    }
    if (cond === undefined) return { t: 'bad', why: 'a case item has no label' }
    chain = { t: 'if', cond, conseq: it.stmt, els: chain }
  }
  return chain
}

/** Every memory write in a procedural statement. A memwrite elaborates to `depth` word-registers, so its
 *  store address is validated against this list ONCE — a per-register check would report an address fault
 *  `depth` times over. */
function collectMemWrites(stmt: ProcStmt): { name: string; idx: Expr; rhs: Expr; depth: number }[] {
  switch (stmt.t) {
    case 'memwrite':
      return [{ name: stmt.name, idx: stmt.idx, rhs: stmt.rhs, depth: stmt.depth }]
    case 'seq':
      return stmt.body.flatMap(collectMemWrites)
    case 'if':
      return [...collectMemWrites(stmt.conseq), ...(stmt.els ? collectMemWrites(stmt.els) : [])]
    default:
      return []
  }
}

/** Elaborate a procedural statement to each written signal's next-state expression. A NONBLOCKING read binds
 *  to the signal's PRE-block value (`net(sig)`) — so nonblocking order-independence, swaps, and last-write-wins
 *  fall out (clocked blocks). A BLOCKING read (a combinational-block `=`) is forward-substituted with the
 *  in-progress value, so `t=a&b; y=t; t=c&d; z=t` correctly gives y=a&b, z=c&d. `written` accumulates every
 *  assigned signal. */
function elaborate(
  stmt: ProcStmt,
  env: Map<string, Expr>,
  written: Set<string>,
  // Optional per-signal declared width — when a function body is inlined, each assignment to a width-declared
  // local/return is wrapped in a `sized` wall so its truncation is EXACT (not lost to symbolic substitution).
  // The always-block callers pass nothing, so their behavior is unchanged.
  sizeOf?: (name: string) => number | undefined,
): Map<string, Expr> {
  const store = (sig: string, expr: Expr): Expr => {
    const wd = sizeOf?.(sig)
    return wd !== undefined ? { t: 'sized', width: wd, of: expr } : expr
  }
  switch (stmt.t) {
    case 'nb': {
      const e = new Map(env)
      e.set(stmt.lhs, store(stmt.lhs, stmt.blocking ? substBlocking(stmt.rhs, env) : stmt.rhs))
      written.add(stmt.lhs)
      return e
    }
    case 'nbsel': {
      // next = (running value with the selected bits cleared) | (the new value shifted into place). Both the
      // mask and the shift distance are constants, so the mask/shift themselves fold to nothing (`bit & 0` is
      // 0, `bit | 0` is the bit). MEASURED: one part-write costs exactly what the hand-written whole-signal
      // form `p <= {p[15:8], d}` costs (96 inner cells either way). A SECOND part-write to the same register
      // in the same block re-synthesizes the running value it builds on and the mask then discards half of
      // it, so two disjoint 8-bit writes to one 16-bit register cost 224 cells where a hand-written single
      // write costs 96. Correct, and dearer — pruning those dead cells is not done.
      const e = new Map(env)
      const prior: Expr = env.get(stmt.lhs) ?? { t: 'net', name: stmt.lhs }
      const keep: ConstBit[] = []
      for (let i = 0; i < stmt.width; i++) keep.push(i >= stmt.lo && i <= stmt.hi ? 0 : 1)
      const placed: Expr = {
        t: 'bin',
        op: '<<',
        a: {
          t: 'sized',
          width: stmt.hi - stmt.lo + 1,
          of: stmt.blocking === true ? substBlocking(stmt.rhs, env) : stmt.rhs,
        },
        b: bitsOf(BigInt(stmt.lo), 32),
      }
      const next: Expr = {
        t: 'bin',
        op: '|',
        a: { t: 'bin', op: '&', a: prior, b: { t: 'const', bits: keep } },
        b: placed,
      }
      e.set(stmt.lhs, store(stmt.lhs, { t: 'sized', width: stmt.width, of: next }))
      written.add(stmt.lhs)
      return e
    }
    case 'memwrite': {
      // A write to one COMPUTED word desugars to a conditional next-state for EVERY word: word k takes the new
      // value when the address equals k, else it holds. The enclosing if-conditions (write-enable, etc.) wrap
      // each of these via the normal tern merge, giving exactly the gate Data RAM's per-word load logic.
      const e = new Map(env)
      const addrBits = clog2(stmt.depth)
      for (let k = 0; k < stmt.depth; k++) {
        const wsig = memWord(stmt.name, k)
        const prior: Expr = env.get(wsig) ?? { t: 'net', name: wsig }
        const hit: Expr = { t: 'bin', op: '==', a: stmt.idx, b: bitsOf(BigInt(k), addrBits) }
        e.set(wsig, { t: 'tern', c: hit, a: stmt.rhs, b: prior })
        written.add(wsig)
      }
      return e
    }
    case 'seq': {
      let e = env
      for (const s of stmt.body) e = elaborate(s, e, written, sizeOf)
      return e
    }
    case 'if': {
      const wThen = new Set<string>()
      const wElse = new Set<string>()
      const eThen = elaborate(stmt.conseq, env, wThen, sizeOf)
      const eElse = stmt.els !== undefined ? elaborate(stmt.els, env, wElse, sizeOf) : env
      const merged = new Map(env)
      for (const sig of new Set([...wThen, ...wElse])) {
        const hold: Expr = env.get(sig) ?? { t: 'net', name: sig }
        const a = eThen.get(sig) ?? hold
        const b = eElse.get(sig) ?? hold
        merged.set(sig, store(sig, { t: 'tern', c: stmt.cond, a, b }))
        written.add(sig)
      }
      return merged
    }
    default:
      return env // 'bad' is intercepted before elaboration
  }
}
