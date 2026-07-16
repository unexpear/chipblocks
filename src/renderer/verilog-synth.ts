/**
 * RTL SYNTHESIS (increment 2 — combinational) — turn a continuous assignment `assign y = expr;` into REAL
 * gates. Where the structural importer reads a netlist of pre-drawn gates, this SYNTHESIZES the gates from a
 * higher-level expression and feeds them to the SAME lowering (so they wire + place + power like any drawn
 * gate; the gates stay the real, simulatable source of truth).
 *
 * 2a shipped SCALAR boolean synthesis. 2b (here) adds BUSES + ARITHMETIC: multi-bit nets `[N:0]`, bit-select
 * a[i], part-select a[h:l], concatenation {a,b}, replication {n{a}}, reduction operators, and unsigned
 * ripple-carry `+`/`-` (a − b = a + ~b + 1). Everything is BIT-BLASTED to scalar bit-nets (a bus `a` of
 * width N → bit-nets a[0]…a[N-1], LSB = a[0]; brackets can't appear in a simple identifier, so a bus bit
 * never collides with a scalar net) and synthesized bit-by-bit with two-pass, context-determined width
 * sizing (self-width bottom-up, then the assignment's context width pushed down into the arithmetic/bitwise
 * operands). Precedence + widths + operator constructions were adversarially verified vs IEEE 1364-2005 (65
 * rules, 0 refuted). Anything still out of scope — `* / % << >> ** < <= > >=`, signed, x/z, non-constant or
 * nonzero-based selects — is REPORTED, never faked.
 */

import type { Assign, GateInst, Tok } from './verilog-import.ts'

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
  | { t: 'bad'; why: string }

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
const SUPPORTED_BIN = new Set(['||', '&&', '|', '^', '~^', '^~', '&', '==', '!=', '+', '-'])
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

function parseRhs(tokens: Tok[]): Expr {
  const ts = new TokStream(tokens)
  if (ts.peek() === undefined) return { t: 'bad', why: 'empty right-hand side' }
  const e = parseExpr(ts, 0)
  if (e.t === 'bad') return e
  if (ts.peek() !== undefined)
    return { t: 'bad', why: `trailing "${ts.peek()?.v}" after the expression` }
  return e
}

function parseExpr(ts: TokStream, minBP: number): Expr {
  let left = parseUnary(ts)
  for (;;) {
    const t = ts.peek()
    if (t === undefined) break
    if (t.v === '?') {
      if (1 < minBP) break
      ts.next()
      const then = parseExpr(ts, 0)
      if (ts.peek()?.v !== ':') return { t: 'bad', why: 'conditional ?: is missing its ":"' }
      ts.next()
      const els = parseExpr(ts, 1)
      left = { t: 'tern', c: left, a: then, b: els }
      continue
    }
    if (t.k !== 'op') break
    const bp = INFIX_BP[t.v]
    if (bp === undefined || bp < minBP) break
    if (!SUPPORTED_BIN.has(t.v))
      return { t: 'bad', why: `operator "${t.v}" is not supported (a later increment)` }
    ts.next()
    const right = parseExpr(ts, bp + 1)
    left = { t: 'bin', op: t.v, a: left, b: right }
  }
  return left
}

function parseUnary(ts: TokStream): Expr {
  const t = ts.peek()
  if (t?.k === 'op' && UNARY.has(t.v)) {
    if (!SUPPORTED_UN.has(t.v))
      return { t: 'bad', why: `unary "${t.v}" is not supported (a later increment)` }
    ts.next()
    return { t: 'un', op: t.v, a: parseUnary(ts) }
  }
  return parsePrimary(ts)
}

function parsePrimary(ts: TokStream): Expr {
  const t = ts.next()
  if (t === undefined) return { t: 'bad', why: 'unexpected end of expression' }
  if (t.v === '(') {
    const e = parseExpr(ts, 0)
    if (ts.peek()?.v !== ')') return { t: 'bad', why: 'missing ")"' }
    ts.next()
    return e
  }
  if (t.v === '{') return parseBraces(ts)
  if (t.k === 'num') return constExpr(t.v)
  if (t.k === 'id') {
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
function parseBraces(ts: TokStream): Expr {
  // replication if the first inner token is a plain constant immediately followed by '{'
  const first = ts.peek()
  if (first?.k === 'num' && ts.peek(1)?.v === '{') {
    const count = intOf(first.v)
    ts.next() // count
    ts.next() // inner '{'
    const of = parseConcatBody(ts)
    if (of.t === 'bad') return of
    if (ts.peek()?.v !== '}') return { t: 'bad', why: 'missing "}" after replication' }
    ts.next()
    if (count === undefined || count < 0)
      return { t: 'bad', why: 'a non-constant replication count needs a later increment' }
    return { t: 'repl', count, of }
  }
  return parseConcatBody(ts)
}

/** The comma-separated body of a `{ … }`, up to (not consuming) the matching '}'. */
function parseConcatBody(ts: TokStream): Expr {
  const parts: Expr[] = []
  for (;;) {
    const e = parseExpr(ts, 0)
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
      return e.op === '==' || e.op === '!=' || e.op === '&&' || e.op === '||'
        ? 1
        : Math.max(selfWidth(e.a, w), selfWidth(e.b, w)) // & | ^ ~^ + -
    case 'tern':
      return Math.max(selfWidth(e.a, w), selfWidth(e.b, w))
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
      // && ||
      const ca = reduce(synthAt(e.a, selfWidth(e.a, x.widthOf), x), 'or', x)
      const cb = reduce(synthAt(e.b, selfWidth(e.b, x.widthOf), x), 'or', x)
      return resize([e.op === '&&' ? and1(ca, cb, x) : or1(ca, cb, x)], w)
    }
    case 'tern': {
      const sel = reduce(synthAt(e.c, selfWidth(e.c, x.widthOf), x), 'or', x) // nonzero test, 1 bit
      if (isC(sel)) return synthAt(sel.c === 1 ? e.a : e.b, w, x)
      const la = synthAt(e.a, w, x)
      const lb = synthAt(e.b, w, x)
      return la.map((_, i) => mux1(sel, la[i] as Bit, lb[i] as Bit, x))
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
  widths: Map<string, number>
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
 * Synthesize every continuous assignment into real gates (appended to `mod.gates`) and expand bus PORTS into
 * scalar bit-ports so the importer's lower() — which is purely scalar — wires + places everything unchanged.
 * Anything outside the supported subset is reported in `warnings` and NOT built.
 */
export function synthesizeAssigns(mod: SynthModule, warnings: string[]): void {
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

  if (mod.assigns.length === 0) return

  // Fresh internal-net names dodge EVERY name that can already denote a net: bit-ports, structural gate
  // terminals, declared bus bases, and any identifier used in an assign (an internal `wire syn0` shows up
  // only there). Without this a user net named "syn0" is silently merged with a synthesized net.
  const used = new Set<string>(mod.dir.keys())
  for (const g of mod.gates) for (const t of g.terminals) used.add(t)
  for (const base of mod.widths.keys()) used.add(base)
  for (const a of mod.assigns) for (const t of [...a.lhs, ...a.rhs]) if (t.k === 'id') used.add(t.v)
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
    const ast = parseRhs(a.rhs)
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
