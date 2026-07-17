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

import type { AlwaysBlock, Assign, FlopInst, GateInst, MemInfo, Tok } from './verilog-import.ts'

/** Declared memories, by name (`reg [D-1:0] m [0:W-1]`). Threaded through the parser so `m[addr]` becomes a
 *  memory read/write rather than a (rejected) non-constant bit-select. */
type MemTable = Map<string, MemInfo>

// ── expression AST ────────────────────────────────────────────────────────────
type Expr =
  | { t: 'net'; name: string }
  | { t: 'const'; bits: (0 | 1)[] } // LSB-first, length = width
  | { t: 'bitsel'; name: string; index: number }
  | { t: 'partsel'; name: string; hi: number; lo: number }
  | { t: 'concat'; parts: Expr[] } // MSB-first (leftmost is the high bits)
  | { t: 'repl'; count: number; of: Expr }
  | { t: 'un'; op: string; a: Expr }
  | { t: 'bin'; op: string; a: Expr; b: Expr }
  | { t: 'tern'; c: Expr; a: Expr; b: Expr }
  | { t: 'memread'; name: string; idx: Expr; width: number; depth: number } // m[addr] — a decode/read-mux
  | { t: 'bad'; why: string }

/** The synthetic net name of memory word k (bracket form — can't collide with a user simple identifier). */
const memWord = (name: string, k: number): string => `${name}[${k}]`
/** Address-bus width for a W-word memory (⌈log2 W⌉, at least 1). */
const clog2 = (words: number): number => Math.max(1, Math.ceil(Math.log2(Math.max(2, words))))
/** The value of an expression that folds to a constant (all bits known), else undefined. Synthesizes into a
 *  throwaway context so it reuses synthAt's EXACT-width folding — `3+2` folds to 5, but a sized `4'd15+4'd1`
 *  wraps to 0 exactly as the hardware would, so no false out-of-range report. Any net reference ⇒ undefined. */
function foldConst(e: Expr, widthOf: (n: string) => number): number | undefined {
  let z = 0
  const bits = synthAt(e, selfWidth(e, widthOf), {
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
// Unsigned magnitude comparisons — 1-bit results, computed by a subtract's carry-out. `<<<`/`>>>` (arithmetic
// shifts) are deliberately EXCLUDED — they're signed, so they stay reported until signed support lands.
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
  '<<',
  '>>',
  '<',
  '<=',
  '>',
  '>=',
])
const UNARY = new Set(['~', '!', '&', '|', '^', '~&', '~|', '~^', '^~', '+', '-'])
const SUPPORTED_UN = new Set(['~', '!', '&', '|', '^', '~&', '~|', '~^', '^~'])

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
    if (ts.peek()?.v === '[') return parseSelect(ts, t.v)
    return { t: 'net', name: t.v }
  }
  return { t: 'bad', why: `unexpected "${t.v}"` }
}

/** After an id, a `[ … ]`: bit-select `[i]` or part-select `[h:l]` (constant bounds only). */
function parseSelect(ts: TokStream, name: string): Expr {
  ts.next() // '['
  const inner: Tok[] = []
  while (ts.peek() !== undefined && ts.peek()?.v !== ']') inner.push(ts.next() as Tok)
  if (ts.peek()?.v !== ']') return { t: 'bad', why: 'missing "]"' }
  ts.next()
  const nums = inner.filter((x) => x.k === 'num').map((x) => intOf(x.v))
  if (inner.some((x) => x.v === ':')) {
    if (nums.length !== 2 || nums[0] === undefined || nums[1] === undefined)
      return { t: 'bad', why: 'a non-constant part-select needs a later increment' }
    const hi = nums[0] as number
    const lo = nums[1] as number
    if (hi < lo) return { t: 'bad', why: 'ascending part-select is unsupported' }
    return { t: 'partsel', name, hi, lo }
  }
  if (inner.some((x) => x.v === '+' || x.v === '-'))
    return { t: 'bad', why: 'an indexed part-select a[b+:W] needs a later increment' }
  if (nums.length !== 1 || nums[0] === undefined)
    return { t: 'bad', why: 'a non-constant bit-select needs a later increment' }
  return { t: 'bitsel', name, index: nums[0] as number }
}

/** `{ e0, e1, … }` concatenation or `{ n { e } }` replication. */
function parseBraces(ts: TokStream, mems: MemTable): Expr {
  // replication if the first inner token is a plain constant immediately followed by '{'
  const first = ts.peek()
  if (first?.k === 'num' && ts.peek(1)?.v === '{') {
    const count = intOf(first.v)
    ts.next() // count
    ts.next() // inner '{'
    const of = parseConcatBody(ts, mems)
    if (of.t === 'bad') return of
    if (ts.peek()?.v !== '}') return { t: 'bad', why: 'missing "}" after replication' }
    ts.next()
    if (count === undefined || count < 0)
      return { t: 'bad', why: 'a non-constant replication count needs a later increment' }
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

const intOf = (v: string): number | undefined =>
  /^[0-9][0-9_]*$/.test(v) ? Number.parseInt(v.replace(/_/g, ''), 10) : undefined

/** A Verilog integer literal → its LSB-first constant bits, or `bad` for x/z / unparseable. */
function constExpr(v: string): Expr {
  const based = v.match(/^(\d*)'[sS]?([bBoOdDhH])([0-9a-fA-FxXzZ?_]+)$/)
  if (based === null) {
    if (/^[0-9][0-9_]*$/.test(v)) return bitsOf(BigInt(v.replace(/_/g, '')), 32)
    return { t: 'bad', why: `constant "${v}"` }
  }
  const width = based[1] === '' ? 32 : Number.parseInt(based[1] as string, 10)
  const digits = (based[3] as string).replace(/_/g, '')
  if (/[xXzZ?]/.test(digits)) return { t: 'bad', why: 'x/z constant is not representable' }
  const base = { b: 2, o: 8, d: 10, h: 16 }[(based[2] as string).toLowerCase()] as number
  const val =
    base === 16
      ? BigInt(`0x${digits}`)
      : base === 8
        ? BigInt(`0o${digits}`)
        : base === 2
          ? BigInt(`0b${digits}`)
          : BigInt(digits)
  return bitsOf(val, width)
}
function bitsOf(val: bigint, width: number): Expr {
  const bits: (0 | 1)[] = []
  for (let i = 0; i < width; i++) bits.push(Number((val >> BigInt(i)) & 1n) as 0 | 1)
  return { t: 'const', bits }
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
    default:
      return undefined
  }
}

// ── bit-level synthesis ─────────────────────────────────────────────────────────
type Bit = { c: 0 | 1 } | { n: string }
const isC = (b: Bit): b is { c: 0 | 1 } => 'c' in b
type Ctx = {
  gates: GateInst[]
  fresh: () => string
  widthOf: (name: string) => number
  bitNet: (name: string, i: number) => string
}

function not1(a: Bit, x: Ctx): Bit {
  if (isC(a)) return { c: a.c ? 0 : 1 }
  const o = x.fresh()
  x.gates.push({ prim: 'not', terminals: [o, a.n] })
  return { n: o }
}
/** A 2-input gate (and/or/xor/xnor) with constant folding. */
function g2(prim: string, a: Bit, b: Bit, x: Ctx): Bit {
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
      return e.op === '~' ? selfWidth(e.a, w) : 1 // ! and reductions are 1 bit
    case 'bin':
      // == != && || and the magnitude comparisons are 1-bit; a shift's width is its LEFT operand's (the amount
      // never widens it); everything else (& | ^ ~^ + - *) is max(operands).
      if (RELATIONAL.has(e.op) || e.op === '==' || e.op === '!=' || e.op === '&&' || e.op === '||')
        return 1
      if (e.op === '<<' || e.op === '>>') return selfWidth(e.a, w)
      return Math.max(selfWidth(e.a, w), selfWidth(e.b, w))
    case 'tern':
      return Math.max(selfWidth(e.a, w), selfWidth(e.b, w))
    case 'memread':
      return e.width
    default:
      return 1
  }
}

/** Synthesize an expression at context width `w`, returning a length-w bit-vector (LSB-first). Context is
 *  pushed down into the width-preserving operators (~ & | ^ ~^ + - and both ?: arms) and STOPS at the
 *  self-determined width walls (concat/replication elements, == != operands, reductions, logical, the ternary
 *  condition), which re-establish their own width and zero-extend their result. */
function synthAt(e: Expr, w: number, x: Ctx): Bit[] {
  switch (e.t) {
    case 'const':
      return resize(
        e.bits.map((b) => ({ c: b }) as Bit),
        w,
      )
    case 'net': {
      const nw = x.widthOf(e.name)
      return resize(
        Array.from({ length: nw }, (_, i) => ({ n: x.bitNet(e.name, i) }) as Bit),
        w,
      )
    }
    case 'bitsel': {
      const inRange = e.index >= 0 && e.index < x.widthOf(e.name)
      return resize([inRange ? { n: x.bitNet(e.name, e.index) } : { c: 0 }], w)
    }
    case 'partsel': {
      const nw = x.widthOf(e.name)
      const bits: Bit[] = []
      for (let k = e.lo; k <= e.hi; k++) bits.push(k < nw ? { n: x.bitNet(e.name, k) } : { c: 0 })
      return resize(bits, w)
    }
    case 'concat': {
      // MSB-first parts → an LSB-first bit-vector (walk parts in reverse, each at its own self-width)
      const bits: Bit[] = []
      for (let i = e.parts.length - 1; i >= 0; i--) {
        const p = e.parts[i] as Expr
        bits.push(...synthAt(p, selfWidth(p, x.widthOf), x))
      }
      return resize(bits, w)
    }
    case 'repl': {
      const elem = synthAt(e.of, selfWidth(e.of, x.widthOf), x)
      const bits: Bit[] = []
      for (let i = 0; i < e.count; i++) bits.push(...elem)
      return resize(bits, w)
    }
    case 'un': {
      if (e.op === '~') return synthAt(e.a, w, x).map((b) => not1(b, x))
      const operand = synthAt(e.a, selfWidth(e.a, x.widthOf), x)
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
      if (e.op === '&' || e.op === '|' || e.op === '^' || e.op === '~^' || e.op === '^~') {
        const la = synthAt(e.a, w, x)
        const lb = synthAt(e.b, w, x)
        const prim = e.op === '&' ? 'and' : e.op === '|' ? 'or' : e.op === '^' ? 'xor' : 'xnor'
        return la.map((_, i) => g2(prim, la[i] as Bit, lb[i] as Bit, x))
      }
      if (e.op === '+' || e.op === '-') {
        const la = synthAt(e.a, w, x)
        const lbRaw = synthAt(e.b, w, x)
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
        const la = synthAt(e.a, cw, x)
        const lb = synthAt(e.b, cw, x)
        const eq = reduce(
          la.map((_, i) => xnor1(la[i] as Bit, lb[i] as Bit, x)),
          'and',
          x,
        )
        return resize([e.op === '==' ? eq : not1(eq, x)], w)
      }
      if (e.op === '<<' || e.op === '>>') {
        // Logical shift: the LEFT operand is context-sized to w (a widening shift keeps the shifted-in bits);
        // the amount is self-determined and never widens the result. A constant amount reindexes; a variable
        // amount is a barrel shifter — one stage per bit of the amount, each shifting by 2^j when that bit is
        // set. Anything shifted past the width (including a huge amount) falls off the end to 0.
        const left = e.op === '<<'
        const la = synthAt(e.a, w, x)
        const shiftBy = (srcBits: Bit[], amt: number): Bit[] =>
          Array.from({ length: w }, (_, i) => {
            const from = left ? i - amt : i + amt
            return amt < w && from >= 0 && from < w ? (srcBits[from] as Bit) : ({ c: 0 } as Bit)
          })
        const k = foldConst(e.b, x.widthOf)
        if (k !== undefined) return shiftBy(la, k)
        const bw = selfWidth(e.b, x.widthOf)
        const amtBits = synthAt(e.b, bw, x)
        let cur = la
        for (let j = 0; j < bw; j++) {
          const shifted = shiftBy(cur, 2 ** j)
          const sel = amtBits[j] as Bit
          cur = cur.map((c, i) => mux1(sel, shifted[i] as Bit, c, x))
        }
        return cur
      }
      if (RELATIONAL.has(e.op)) {
        // Unsigned magnitude comparison → 1 bit. a >= b ⟺ the carry-OUT of a + ~b + 1 (no borrow); the other
        // three derive from it. The subtract keeps its carry-out (the +/- path above drops it, so this is its
        // own loop). Operands are synthesized at the compare width, zero-extended.
        const cw = Math.max(selfWidth(e.a, x.widthOf), selfWidth(e.b, x.widthOf))
        const la = synthAt(e.a, cw, x)
        const lb = synthAt(e.b, cw, x)
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
        // Unsigned multiply: partial products summed at the context width w. BOTH operands are context-
        // determined (IEEE §5.4.1), so each is synthesized at w — evaluating the right operand at its own
        // self-width would truncate a compound factor like (b+c) before the multiply (and break a*b == b*a).
        // For each bit j of b, add a shifted left by j (bit i takes a[i-j] AND b[j]); bits past w drop (mod
        // 2^w). Zero/one operands and the high zero-extended bits of a narrow operand fold to no gates.
        const la = synthAt(e.a, w, x)
        const lb = synthAt(e.b, w, x)
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
      if (e.op === '&&' || e.op === '||') {
        const ca = reduce(synthAt(e.a, selfWidth(e.a, x.widthOf), x), 'or', x)
        const cb = reduce(synthAt(e.b, selfWidth(e.b, x.widthOf), x), 'or', x)
        return resize([e.op === '&&' ? and1(ca, cb, x) : or1(ca, cb, x)], w)
      }
      // Every supported binary op has a branch above; a bare fallthrough would silently miscompile a newly
      // added op (as a 1-bit &&/||), so fail loudly instead — this only fires on a coding error.
      throw new Error(`synthAt: no branch for binary operator "${e.op}"`)
    }
    case 'tern': {
      const sel = reduce(synthAt(e.c, selfWidth(e.c, x.widthOf), x), 'or', x) // nonzero test, 1 bit
      if (isC(sel)) return synthAt(sel.c === 1 ? e.a : e.b, w, x)
      const la = synthAt(e.a, w, x)
      const lb = synthAt(e.b, w, x)
      return la.map((_, i) => mux1(sel, la[i] as Bit, lb[i] as Bit, x))
    }
    case 'memread': {
      // The gate Data RAM's read path: decode the address to one-hot lines, then OR each word gated by its
      // line. Synthesize the address ONCE (shared bits), so a plain-net address builds just a decoder — not W
      // copies of the address datapath. A constant address folds the decode to a single live word. Decode on
      // the FULL address width (never fewer than clog2(depth)) so a too-wide address's high bits force a
      // no-match (reads 0) instead of aliasing onto a low word — the write path compares at this width too.
      const addrW = Math.max(clog2(e.depth), selfWidth(e.idx, x.widthOf))
      const addr = synthAt(e.idx, addrW, x)
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
      return resize(out, w)
    }
    default:
      return resize([], w) // 'bad' — gated out by firstBad()
  }
}

// ── the assign driver ───────────────────────────────────────────────────────────
type SynthModule = {
  portOrder: string[]
  dir: Map<string, 'input' | 'output' | 'inout'>
  gates: GateInst[]
  assigns: Assign[]
  alwaysBlocks: AlwaysBlock[]
  flops: FlopInst[]
  widths: Map<string, number>
  mems: MemTable
}

/** The target bit-nets of an lhs (`y`, `y[i]`, `y[h:l]`, or a concat of those), LSB-first. */
function lhsBits(
  toks: Tok[],
  widthOf: (n: string) => number,
  bitNet: (n: string, i: number) => string,
): { bits: string[] } | { bad: string } {
  if (toks[0]?.v === '{') {
    if (toks[toks.length - 1]?.v !== '}') return { bad: 'malformed concatenation target' }
    const parts = splitTopComma(toks.slice(1, -1))
    const out: string[] = []
    for (let i = parts.length - 1; i >= 0; i--) {
      const pb = lhsBits(parts[i] as Tok[], widthOf, bitNet)
      if ('bad' in pb) return pb
      out.push(...pb.bits)
    }
    return { bits: out }
  }
  if (toks[0]?.k !== 'id') return { bad: 'assign target must be a net' }
  const name = toks[0].v
  if (toks.length === 1)
    return { bits: Array.from({ length: widthOf(name) }, (_, i) => bitNet(name, i)) }
  if (toks[1]?.v === '[') {
    const inner = toks.slice(2).filter((t) => t.v !== ']')
    const nums = inner.filter((t) => t.k === 'num').map((t) => intOf(t.v))
    if (inner.some((t) => t.v === ':')) {
      if (nums.length !== 2 || nums[0] === undefined || nums[1] === undefined)
        return { bad: 'non-constant part-select target' }
      const hi = nums[0] as number
      const lo = nums[1] as number
      if (hi < lo) return { bad: 'ascending part-select target is unsupported' }
      const bits: string[] = []
      for (let k = lo; k <= hi; k++) bits.push(bitNet(name, k))
      return { bits }
    }
    if (nums.length !== 1 || nums[0] === undefined) return { bad: 'non-constant bit-select target' }
    return { bits: [bitNet(name, nums[0] as number)] }
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

/**
 * Synthesize behavioral RTL into real gates + flip-flops. Continuous assignments (`assign y = expr;`) become
 * gates and clocked `always @(posedge clk)` blocks become one D flip-flop per registered bit plus the
 * next-state gates that feed each D input — all appended to `mod` and expanded to scalar bit-nets so the
 * importer's lower() (purely scalar) wires + places + powers everything unchanged. Bus PORTS are expanded to
 * scalar bit-ports here too. Anything outside the supported subset is reported in `warnings` and NOT built.
 */
export function synthesizeBehavioral(mod: SynthModule, warnings: string[]): void {
  const widthOf = (name: string): number => mod.widths.get(name) ?? 1
  // A bus bit-net uses the Verilog bracket form a[i] — since `[`/`]` can't appear in a simple identifier, it
  // can never collide with a scalar net literally spelled `a0` (a real, silent-miscompile hazard otherwise).
  const bitNet = (name: string, i: number): string => (widthOf(name) === 1 ? name : `${name}[${i}]`)

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

  if (mod.assigns.length === 0 && mod.alwaysBlocks.length === 0) return

  // Fresh internal-net names dodge EVERY name that can already denote a net: bit-ports, structural gate
  // terminals, declared bus bases, any identifier used in an assign, AND any identifier inside an always
  // block (a register or read-net named `syn0` lives only there). Without this a user net named "syn0" is
  // silently merged with a synthesized net — a double-drive or a self-referential combinational loop.
  const used = new Set<string>(mod.dir.keys())
  for (const g of mod.gates) for (const t of g.terminals) used.add(t)
  for (const base of mod.widths.keys()) used.add(base)
  for (const a of mod.assigns) for (const t of [...a.lhs, ...a.rhs]) if (t.k === 'id') used.add(t.v)
  for (const blk of mod.alwaysBlocks) for (const t of blk.body) if (t.k === 'id') used.add(t.v)

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

  const driven = new Set<string>()
  for (const g of mod.gates) for (const o of gateOutputs(g)) driven.add(o)

  const built: { targets: string[]; gates: GateInst[] }[] = []
  for (const a of mod.assigns) {
    // A memory can only be written by a clocked always block (its words are flip-flops); an unclocked
    // continuous assign to mem[addr] would need a latch + decode we don't model — reported.
    if (a.lhs[0]?.k === 'id' && mod.mems.has(a.lhs[0].v)) {
      warnings.push(
        `line ${a.line}: continuous assign to memory "${a.lhs[0].v}" (unclocked array write) is not supported — write it in an always @(posedge clk) block — reported, not built`,
      )
      continue
    }
    const lb = lhsBits(a.lhs, widthOf, bitNet)
    if ('bad' in lb) {
      warnings.push(`line ${a.line}: assign target — ${lb.bad} — reported, not built`)
      continue
    }
    const targets = lb.bits
    const inputTarget = targets.find((tb) => inputs.has(tb))
    if (inputTarget !== undefined) {
      warnings.push(`line ${a.line}: assign drives input port "${inputTarget}" — illegal, reported`)
      continue
    }
    const drivenTarget = targets.find((tb) => driven.has(tb))
    if (drivenTarget !== undefined) {
      warnings.push(
        `line ${a.line}: net "${drivenTarget}" is assigned more than once (or already driven by a gate) — reported, not built`,
      )
      continue
    }
    const ast = parseRhs(a.rhs, mod.mems)
    const bad = firstBad(ast)
    if (bad !== undefined) {
      warnings.push(`line ${a.line}: assign not synthesized — ${bad}`)
      continue
    }
    // An out-of-range constant select reads x in Verilog — not representable in a 0/1 netlist, so report it
    // rather than silently substitute 0.
    const oor = outOfRange(ast, widthOf)
    if (oor !== undefined) {
      warnings.push(`line ${a.line}: ${oor} reads x in Verilog — reported, not built`)
      continue
    }
    const gates: GateInst[] = []
    const rhs = synthAt(ast, targets.length, { gates, fresh, widthOf, bitNet })
    let ok = true
    for (let i = 0; i < targets.length; i++) {
      const src = rhs[i] as Bit
      const from = isC(src) ? tie(src.c) : src.n
      if (from === undefined) {
        ok = false
        break
      } // a constant bit with no live net to tie it to
      gates.push({ prim: 'buf', terminals: [targets[i] as string, from] })
    }
    if (!ok) {
      warnings.push(
        `line ${a.line}: assign "${a.lhs.map((t) => t.v).join('')}" needs a constant driver but the module has no input to tie to — reported, not built`,
      )
      continue
    }
    for (const tb of targets) driven.add(tb)
    built.push({ targets, gates })
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

  for (const b of built) {
    const looped = b.targets.find((tb) => onCycle.has(tb))
    if (looped !== undefined) {
      warnings.push(
        `combinational loop through "${looped}" — the assign feeds back on itself; reported, not built`,
      )
      continue
    }
    mod.gates.push(...b.gates)
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
    const seq = parseProcedural(blk.body, mod.mems)
    if (seq.t === 'bad') {
      warnings.push(`line ${blk.line}: always block — ${seq.why} — reported, not built`)
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
      badMem.add(mw.name)
    }
    const written = new Set<string>()
    const env = elaborate(seq, new Map(), written)
    for (const r of written) {
      const base = memBaseOf(r)
      if (base !== undefined && badMem.has(base)) continue // faulty store, already reported above
      if (registered.has(r)) {
        if (base !== undefined) {
          if (!reportedMem.has(base)) {
            warnings.push(
              `memory "${base}" is written by more than one always block — reported, not built`,
            )
            reportedMem.add(base)
          }
          continue
        }
        warnings.push(
          `register "${r}" is written by more than one always block — reported, not built`,
        )
        continue
      }
      const ast = env.get(r)
      if (ast === undefined) continue
      const bad = firstBad(ast)
      if (bad !== undefined) {
        warnings.push(`line ${blk.line}: register "${r}" not synthesized — ${bad}`)
        continue
      }
      const oor = outOfRange(ast, widthOf)
      if (oor !== undefined) {
        warnings.push(`line ${blk.line}: ${oor} reads x in Verilog — reported, not built`)
        continue
      }
      const w = widthOf(r)
      const qBits = Array.from({ length: w }, (_, i) => bitNet(r, i))
      // Driving an input port (scalar OR any bus bit) is illegal; a bit already sourced by a gate/assign is a
      // multiple-driver conflict. Both are checked at the BIT level so a bus register is handled correctly.
      const drivesInput = qBits.find((bn) => inputs.has(bn))
      if (drivesInput !== undefined) {
        warnings.push(
          `line ${blk.line}: always block drives input port "${drivesInput}" — illegal, reported`,
        )
        continue
      }
      const conflict = qBits.find((bn) => driven.has(bn))
      if (conflict !== undefined) {
        warnings.push(
          `register "${r}" bit "${conflict}" is already driven by a gate or assign — reported, not built`,
        )
        continue
      }
      // Synthesize the next-state logic, then one flop per bit. Buffer a pure hold (D-net === Q-net) so the
      // flop's D and Q pins never land on the same net (which would short them).
      const dGates: GateInst[] = []
      const D = synthAt(ast, w, { gates: dGates, fresh, widthOf, bitNet })
      const newFlops: FlopInst[] = []
      let ok = true
      for (let i = 0; i < w; i++) {
        const qNet = bitNet(r, i)
        const dbit = D[i] as Bit
        let dNet: string
        if (isC(dbit)) {
          const t = tie(dbit.c)
          if (t === undefined) {
            ok = false
            break
          }
          dNet = t
        } else if (dbit.n === qNet) {
          dNet = fresh()
          dGates.push({ prim: 'buf', terminals: [dNet, qNet] })
        } else dNet = dbit.n
        newFlops.push({ d: dNet, clk: blk.clk, q: qNet })
      }
      if (!ok) {
        warnings.push(
          `register "${r}" needs a constant value but the module has no input to tie it to — reported, not built`,
        )
        continue
      }
      mod.gates.push(...dGates)
      mod.flops.push(...newFlops)
      for (let i = 0; i < w; i++) driven.add(bitNet(r, i))
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

  mod.gates.push(...tieGates) // tie drivers read only inputs → never on a cycle → always safe to keep
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

/** Nets on a combinational cycle in a `net → driver-input-nets` graph (path-based; a feed-forward net that
 *  merely READS a looped net is not flagged). */
function cycleNets(edges: Map<string, string[]>): Set<string> {
  const onCycle = new Set<string>()
  const state = new Map<string, 0 | 1 | 2>()
  const path: string[] = []
  const visit = (node: string): void => {
    state.set(node, 1)
    path.push(node)
    for (const dep of edges.get(node) ?? []) {
      const s = state.get(dep) ?? 0
      if (s === 1) {
        const from = path.lastIndexOf(dep)
        for (let k = from; k < path.length; k++) onCycle.add(path[k] as string)
      } else if (s === 0) visit(dep)
    }
    state.set(node, 2)
    path.pop()
  }
  for (const node of edges.keys()) if ((state.get(node) ?? 0) === 0) visit(node)
  return onCycle
}

// ── procedural (always-block) parsing + elaboration ─────────────────────────────
/** A statement inside a clocked always block. `bad` carries the first unsupported construct's reason. */
type ProcStmt =
  | { t: 'nb'; lhs: string; rhs: Expr } // nonblocking whole-signal assignment  reg <= expr
  | { t: 'memwrite'; name: string; idx: Expr; rhs: Expr; depth: number } // m[addr] <= expr
  | { t: 'seq'; body: ProcStmt[] } // begin … end
  | { t: 'if'; cond: Expr; conseq: ProcStmt; els?: ProcStmt }
  | { t: 'bad'; why: string }

/** Parse a clocked always body (its inner statements, no wrapping begin/end) into one procedural statement. */
function parseProcedural(body: Tok[], mems: MemTable): ProcStmt {
  const ts = new TokStream(body)
  const stmts: ProcStmt[] = []
  while (ts.peek() !== undefined) {
    const s = parseStmt(ts, mems)
    if (s.t === 'bad') return s
    stmts.push(s)
  }
  if (stmts.length === 0) return { t: 'bad', why: 'the clocked block is empty' }
  return stmts.length === 1 ? (stmts[0] as ProcStmt) : { t: 'seq', body: stmts }
}

function parseStmt(ts: TokStream, mems: MemTable): ProcStmt {
  const t = ts.peek()
  if (t === undefined) return { t: 'bad', why: 'unexpected end of the clocked block' }
  if (t.v === 'begin') {
    ts.next()
    const body: ProcStmt[] = []
    while (ts.peek() !== undefined && ts.peek()?.v !== 'end') {
      const s = parseStmt(ts, mems)
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
    const conseq = parseStmt(ts, mems)
    if (conseq.t === 'bad') return conseq
    if (ts.peek()?.v !== 'else') return { t: 'if', cond, conseq }
    ts.next()
    const els = parseStmt(ts, mems)
    if (els.t === 'bad') return els
    return { t: 'if', cond, conseq, els }
  }
  if (t.v === 'case') return parseCase(ts, mems)
  if (t.v === 'casex' || t.v === 'casez')
    return {
      t: 'bad',
      why: `${t.v} (x/z don't-care matching) is not representable in a 0/1 netlist`,
    }
  if (t.v === 'for' || t.v === 'while' || t.v === 'repeat' || t.v === 'forever')
    return { t: 'bad', why: `procedural loops (${t.v}) are a later increment` }
  return parseAssignStmt(ts, mems)
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
function parseAssignStmt(ts: TokStream, mems: MemTable): ProcStmt {
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
  if ((toks[opIdx] as Tok).v === '=')
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
  if (lhs.length !== 1 || lhs[0]?.k !== 'id')
    return {
      t: 'bad',
      why: 'only a whole-signal nonblocking target (reg <= …) is supported — a bit/part-select or concat target is a later increment',
    }
  return { t: 'nb', lhs: (lhs[0] as Tok).v, rhs }
}

/** Parse a `case (sel) … endcase` and desugar it to a nested if/else chain (label match via `sel == label`,
 *  multiple labels OR'd). casex/casez are rejected upstream. */
function parseCase(ts: TokStream, mems: MemTable): ProcStmt {
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
      const s = parseStmt(ts, mems)
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
    const s = parseStmt(ts, mems)
    if (s.t === 'bad') return s
    items.push({ labels, stmt: s })
  }
  if (ts.peek()?.v !== 'endcase') return { t: 'bad', why: 'case is missing its "endcase"' }
  ts.next()
  let chain: ProcStmt = dflt ?? { t: 'seq', body: [] } // no default ⇒ hold
  for (let i = items.length - 1; i >= 0; i--) {
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

/** Elaborate a procedural statement to each written signal's next-state expression. Every read binds to the
 *  signal's PRE-clock value (`net(sig)`) — never an in-progress value — so nonblocking order-independence,
 *  swaps, and last-write-wins all fall out. `written` accumulates every assigned signal (the registers). */
function elaborate(
  stmt: ProcStmt,
  env: Map<string, Expr>,
  written: Set<string>,
): Map<string, Expr> {
  switch (stmt.t) {
    case 'nb': {
      const e = new Map(env)
      e.set(stmt.lhs, stmt.rhs)
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
      for (const s of stmt.body) e = elaborate(s, e, written)
      return e
    }
    case 'if': {
      const wThen = new Set<string>()
      const wElse = new Set<string>()
      const eThen = elaborate(stmt.conseq, env, wThen)
      const eElse = stmt.els !== undefined ? elaborate(stmt.els, env, wElse) : env
      const merged = new Map(env)
      for (const sig of new Set([...wThen, ...wElse])) {
        const hold: Expr = env.get(sig) ?? { t: 'net', name: sig }
        const a = eThen.get(sig) ?? hold
        const b = eElse.get(sig) ?? hold
        merged.set(sig, { t: 'tern', c: stmt.cond, a, b })
        written.add(sig)
      }
      return merged
    }
    default:
      return env // 'bad' is intercepted before elaboration
  }
}
