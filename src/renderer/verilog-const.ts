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
 * THE SHAPE OF THE EVALUATION (IEEE 1364-2005 §5.4.1 + §5.5.2, and the same shape `synthAt` in verilog-synth
 * already uses for gates). The tokens are parsed into a tree FIRST, then folded top-down at a context width:
 *
 *   1. `selfWidth` / `expressionSigned` walk the tree bottom-up for each node's own size and type.
 *   2. `foldAt(node, width, signed)` pushes that width and type DOWN through the width-preserving operators
 *      (`~ - +`, `& | ^ ~^`, `+ - *`, `/ %`, a shift's left operand, both `?:` arms), and STOPS at the
 *      self-determined walls (comparison operands, `&& ||` operands, a `?:` condition, a shift's amount),
 *      which re-establish their own width and type.
 *   3. Every operator TRUNCATES its result back to the width it was folded at.
 *
 * Truncation is not optional and it is where a whole class of everyday RTL lives: `(A + B) < A` with 8-bit
 * A = 200 and B = 100 is the compile-time overflow check, and it is TRUE — the add wraps to 44 at eight bits
 * first, and only then is the comparison evaluated. An evaluator that carries 300 into the comparison answers
 * the opposite. Measured against Icarus Verilog 14.0.
 *
 * THE ONE PLACE THE WIDTH IS NOT THE §5.4.1 WIDTH is the outermost context, when nothing outside imposes one.
 * A `parameter`/`localparam` with no declared range is sized to hold its own arithmetic losslessly, so `+ −`
 * carry a bit and `*` carries the sum of the widths: measured, `localparam Q = 4'd15 + 4'd1` is 16 at FIVE
 * bits (`$bits(Q)` is 5), `8'd200 + 8'd100` is 300 at NINE, and `3'sd3 * 3'sd3` is 9 at SIX. That is
 * `growWidth`, and it is only ever the OUTERMOST width — inside a comparison or a concatenation the plain
 * §5.4.1 `selfWidth` applies, which is why `(4'd15 + 4'd1) == 4'd0` is TRUE in Icarus. A caller that has a
 * width of its own (a declared range on the parameter) passes it instead, and then it is that width that
 * propagates down: `localparam [7:0] Q = ~4'd0` is 255, not 15.
 *
 * THE OTHER PLACE THE WIDTH IS NOT THE CONTEXT WIDTH is a SELF-DETERMINED position — a bit-select index, a
 * part-select bound, a declaration/port/return range, an array depth bound. Nothing is assigned there, so
 * there is no context to push and no reason to grow: the bound arithmetic wraps at its own §5.4.1 width.
 * Measured against Icarus Verilog 14.0, `wire [(4'd10 + 4'd10):0] w` is a FIVE-bit bus (the add wraps to 4 at
 * four bits) and `w[4'd8 + 4'd8]` reads bit ZERO. Callers ask for that with `'self'`; the lossless `growWidth`
 * belongs only to a parameter VALUE, and using it for a bound sizes hardware nobody wrote.
 *
 * THAT GROWTH STOPS AT A SHIFT. `<< >> **` take their width from the LEFT operand (§5.4.1 Table 5-22), and
 * that operand is a self-determined wall: the lossless growth does not cross into it, so the sub-expression
 * truncates BEFORE the shift runs. Measured, `localparam Q = (8'd200 + 8'd100) >> 0` is 44 at EIGHT bits, not
 * 300 at nine — a shift by ZERO changes the answer, because the add wraps to 44 inside the shift's left
 * operand first. A pushed-in width still crosses, and must: `localparam [15:0] Q = (4'd15 + 4'd1) >> 0` is 16.
 * Those are two different things — the wall is in `growWidth`, never in `foldAt`.
 *
 * Anything whose width this evaluator cannot prove — an unsized constant grown by `<<` or `**` into a
 * negative — is not a constant here, and every caller reports it by name.
 *
 * THE OTHER ELABORATION-TIME ARITHMETIC VERILOG DOES is COUNTING A LOOP, and it lives here for the same
 * reason: a `for` header is folded before any gates exist, by two callers that share nothing else. A
 * PROCEDURAL `for` inside an always block (verilog-synth.ts) and a GENERATE `for` over a genvar
 * (verilog-generate.ts) are the same counter with two different expression evaluators behind them, so the
 * counting — the declared width, the signedness, the never-terminates guard — is written once at the bottom
 * of this file and the evaluator is passed in.
 */

import type { Tok } from './verilog-import.ts'

/** A folded constant: its two's-complement bit pattern (always stored as a non-negative bigint), the bit width
 *  it was computed at, and whether the expression that produced it is SIGNED per IEEE 1364-2005 §5.5.1. The
 *  signedness is not decoration: `parameter N = -1` is a SIGNED 32-bit −1, so `k >= N` against a signed counter
 *  is a signed comparison, while `parameter N = 32'hFFFFFFFF` is unsigned and the same comparison goes
 *  unsigned. Both were measured against Icarus Verilog 14.0, and they give different iteration counts. */
export type ConstVal = {
  value: bigint
  width: number
  signed: boolean
  /** True when this value came from a constant written WITHOUT a width (`42`, `'d1`, and anything `~ - +` of
   *  one). IEEE 1364-2005 §3.11.1 sizes those at "at least 32 bits", so `width` is a FLOOR rather than the
   *  size — and Icarus Verilog 14.0 takes the standard at its word, letting such a constant grow instead of
   *  wrap: `1 << 40` is 72 bits there and `~0 << 8` is 40, while the written-out `32'sd1 << 20` stays 32 and
   *  `4'shf << 1` wraps at four. Nothing here computes the grown width; the flag exists so a fold that would
   *  DEPEND on it is refused instead of guessed. */
  unsized: boolean
}

const twoW = (w: number): bigint => 1n << BigInt(Math.max(0, w))
/** Wrap a value into an unsigned `w`-bit field (two's-complement for negatives), exactly like the hardware. */
const wrap = (v: bigint, w: number): bigint => {
  const m = twoW(w)
  return ((v % m) + m) % m
}
const maskOf = (w: number): bigint => twoW(w) - 1n

/** Does this constant's two's-complement bit pattern read as a NEGATIVE number? Only meaningful when signed. */
export const isNegativeConst = (c: ConstVal): boolean =>
  c.signed && ((c.value >> BigInt(Math.max(0, c.width - 1))) & 1n) === 1n

/** Read a `w`-bit two's-complement PATTERN as a mathematical integer, signed or unsigned. */
const readAs = (pattern: bigint, w: number, signed: boolean): bigint =>
  signed && w > 0 && ((pattern >> BigInt(w - 1)) & 1n) === 1n ? pattern - twoW(w) : pattern

/**
 * THE ONE WIDENING RULE (IEEE 1364-2005 §5.5.2 step 2). Re-read a folded constant's pattern at `width`,
 * SIGN-extending it iff the surrounding EXPRESSION is signed and zero-extending it otherwise, then truncating
 * to `width` exactly as `wrap` does in the other direction. Every site that puts a constant into a context
 * calls this, so `3 + 4'shf` can only ever be 2 — the file used to have `wrap` (truncate) and no widen at all,
 * which is why a narrower signed operand was silently zero-extended everywhere.
 */
export function extendTo(c: ConstVal, width: number, signed: boolean): bigint {
  return wrap(readAs(c.value, c.width, signed), width)
}

/** The exact mathematical integer this constant denotes under its OWN signedness — what a bus bound, an array
 *  bound, a replication count, a loop start and a `/` `%` `< <= > >=` fold each need (a negative must READ as
 *  negative, not as 4 294 967 294). */
export const asInteger = (c: ConstVal): bigint => readAs(c.value, c.width, c.signed)

/** The operators whose result width is the LEFT operand's, per IEEE 1364-2005 §5.4.1 Table 5-22 (the shift
 *  amount and the exponent never widen the result). Measured: `4'd2 ** 4'd3` and `4'shf ** 4'd2` are both
 *  4 bits, and `4'shf << 1` is 4 bits. */
const WIDTH_FROM_LEFT = new Set(['<<', '>>', '**'])
/** A shift takes its SIGNEDNESS from the left operand alone (§5.5.1); `**` does not — it is signed only when
 *  both operands are, like the ordinary arithmetic operators. */
const SIGN_FROM_LEFT = new Set(['<<', '>>'])
/** Operators whose result is one UNSIGNED bit, and whose operands are sized against each other rather than
 *  against the surrounding context (§5.4.1 Table 5-22). This is the wall the overflow idiom depends on. */
const COMPARISON = new Set(['==', '!=', '<', '<=', '>', '>='])
/** `&& ||` ask only whether each operand is nonzero, so each operand is fully self-determined. */
const LOGICAL = new Set(['&&', '||'])

/** `<<` and `**` are the two operators that let an UNSIZED left operand grow instead of wrapping (measured:
 *  `1 << 40` is 72 bits, `~0 << 8` is 40, `2 ** 40` is 42 — while the written-out `32'sd1 << 20` stays 32 and
 *  `4'shf << 1` wraps at four). Nothing here reproduces the grown width, so a fold that would depend on it is
 *  refused. It depends on it exactly when the result is NEGATIVE, because then the extra bits are ones and the
 *  pattern IS the width; a non-negative result gains only leading zeros and reads the same at any size. */
const GROWS_WHEN_UNSIZED = new Set(['<<', '**'])

/** An UNSIZED DECIMAL literal (`42`). IEEE 1364-2005 §3.11.1 makes it signed and "at least 32 bits" — the
 *  exact size is implementation-defined, so a magnitude that needs bit 31 has no size this importer can prove:
 *  at 32 bits `4294967295` IS −1 and `-1 == 4294967295` folds to 1, while Icarus Verilog 14.0 sizes it at 33
 *  bits, keeps it positive and folds the same comparison to 0. Rather than pick a width and disagree with a
 *  conforming tool, the literal is not a constant here and every caller reports it by name. */
export function plainDecimal(n: bigint): ConstVal | undefined {
  if (n >= 1n << 31n) return undefined
  return { value: n, width: 32, signed: true, unsized: true }
}

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

/** A Verilog integer literal → its {value, width, signed}: a based literal `n'bdoh…` (width n, or 32 if
 *  unsized), or a plain decimal (width 32). A plain decimal and an `'s`-marked based literal are SIGNED
 *  (IEEE 1364-2005 §3.11.1); a based literal without the `s` is unsigned. x/z digits or an unparseable literal
 *  ⇒ undefined (not a constant). */
export function numLiteral(v: string): ConstVal | undefined {
  const based = v.match(/^(\d*)'([sS]?)([bBoOdDhH])([0-9a-fA-F_]+)$/)
  if (based === null) {
    if (/^[0-9][0-9_]*$/.test(v)) return plainDecimal(BigInt(v.replace(/_/g, '')))
    return undefined
  }
  const width = based[1] === '' ? 32 : Number.parseInt(based[1] as string, 10)
  // Reject an absurd literal width (`10000000000'h1`) before it builds a multi-gigabit bigint and hangs.
  if (!(width > 0) || width > MAX_WIDTH) return undefined
  const signed = based[2] !== ''
  const digits = (based[4] as string).replace(/_/g, '')
  const base = { b: 2, o: 8, d: 10, h: 16 }[(based[3] as string).toLowerCase()] as number
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
  return { value: wrap(val, width), width, signed, unsized: based[1] === '' }
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
 *  undefined if it isn't a constant that fits a safe integer. The span is SELF-DETERMINED — an index is not
 *  assigned to anything, so it wraps at its own width. The fold is read through `asInteger`, so a NEGATIVE
 *  bound is seen as negative and refused by the caller — Icarus Verilog 14.0 rejects that source outright
 *  ("Concatenation repeat may not be negative (-2)") — instead of reading as 4 294 967 294. */
export function constInt(toks: Tok[], params?: Map<string, ConstVal>): number | undefined {
  const v = evalConst(toks, params, 'self')
  if (v === undefined) return undefined
  const i = asInteger(v)
  if (i < 0n) return undefined
  const n = Number(i)
  return Number.isSafeInteger(n) ? n : undefined
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

/** The parsed expression. Sizing and folding are two separate walks over this, exactly as IEEE 1364-2005
 *  §5.5.2 describes them: the old evaluator folded DURING the parse, which is why an operand's width was
 *  settled before the operator above it could impose one. */
type Node =
  | { kind: 'value'; value: ConstVal }
  | { kind: 'unary'; op: string; operand: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'choice'; condition: Node; whenTrue: Node; whenFalse: Node }

/**
 * Evaluate a token span as a constant expression, resolving parameter identifiers via `params`. Returns the
 * folded {value, width, signed}, or undefined if any operand is non-constant (a net, an unsupported op,
 * malformed). `contextWidth` is the width the RESULT is assigned into — a declared range on the parameter
 * being folded. Per IEEE 1364-2005 §5.4.1 the expression is evaluated at max(that, its own self-determined
 * width) and the caller truncates; with no context the outermost width is `growWidth`, and `'self'` asks for
 * the §5.4.1 width itself (a bound/index, which nothing assigns and so nothing grows).
 */
export function evalConst(
  tokens: Tok[],
  params?: Map<string, ConstVal>,
  contextWidth?: number | 'self',
): ConstVal | undefined {
  const ts = new TS(tokens)
  if (ts.peek() === undefined) return undefined
  const node = parse(ts, 0, 0, params)
  if (node === undefined || ts.peek() !== undefined) return undefined
  // Every walk below (selfWidth, growWidth, expressionSigned, foldAt) is plain recursion over this tree, so a
  // tree past the cap is one none of them can finish. `a + 1 + 1 + …` parses in a loop and nests only on the
  // left, so the PARSE depth above says nothing about it — the built tree is measured here, iteratively.
  if (nodeDepth(node) > MAX_CONST_NESTING) return undefined
  const width =
    contextWidth === undefined
      ? growWidth(node)
      : contextWidth === 'self'
        ? selfDeterminedWidth(node)
        : Math.max(contextWidth, selfWidth(node))
  if (width === undefined || width > MAX_WIDTH) return undefined
  const signed = expressionSigned(node)
  const value = foldAt(node, width, signed)
  if (value === undefined) return undefined
  return { value, width, signed, unsized: expressionUnsized(node) }
}

/** The deepest constant expression this evaluator will walk. Every walk over the parsed tree is plain
 *  recursion, and so is the parser that builds it. MEASURED in a fresh process on `localparam P = ((((…7…))))`
 *  nested N deep: the parser THREW `RangeError: Maximum call stack size exceeded` at N = 3000 and survived
 *  N = 1000. Real constant expressions nest a handful of levels; a thousand is the same depth the synthesizer
 *  will walk an ordinary expression to, so the two agree. Past it the span is simply NOT a constant, which
 *  every caller already reports by name. */
const MAX_CONST_NESTING = 1000

/** How deeply a parsed constant tree nests. Deliberately iterative, over an explicit stack: a walk that
 *  recursed would hit the depth it is measuring. */
function nodeDepth(root: Node): number {
  const kidsOf = (n: Node): readonly Node[] => {
    if (n.kind === 'unary') return [n.operand]
    if (n.kind === 'binary') return [n.left, n.right]
    if (n.kind === 'choice') return [n.condition, n.whenTrue, n.whenFalse]
    return []
  }
  const depth = new Map<Node, number>()
  const opened = new Set<Node>()
  const stack: Node[] = [root]
  while (stack.length > 0) {
    const n = stack[stack.length - 1] as Node
    if (depth.has(n)) {
      stack.pop()
      continue
    }
    if (!opened.has(n)) {
      opened.add(n)
      for (const kid of kidsOf(n)) if (!depth.has(kid)) stack.push(kid)
      continue
    }
    stack.pop()
    let d = 1
    for (const kid of kidsOf(n)) d = Math.max(d, 1 + (depth.get(kid) ?? 1))
    depth.set(n, d)
  }
  return depth.get(root) ?? 1
}

function parse(
  ts: TS,
  minBP: number,
  depth: number,
  params?: Map<string, ConstVal>,
): Node | undefined {
  if (depth > MAX_CONST_NESTING) return undefined
  let left = parseUnary(ts, depth, params)
  if (left === undefined) return undefined
  for (;;) {
    const t = ts.peek()
    if (t === undefined) break
    if (t.v === '?') {
      if (1 < minBP) break
      ts.next()
      const whenTrue = parse(ts, 0, depth + 1, params)
      if (whenTrue === undefined || ts.peek()?.v !== ':') return undefined
      ts.next()
      const whenFalse = parse(ts, 1, depth + 1, params)
      if (whenFalse === undefined) return undefined
      left = { kind: 'choice', condition: left, whenTrue, whenFalse }
      continue
    }
    if (t.k !== 'op') break
    const bp = BP[t.v]
    if (bp === undefined || bp < minBP) break
    ts.next()
    const right = parse(ts, bp + 1, depth + 1, params)
    if (right === undefined) return undefined
    left = { kind: 'binary', op: t.v, left, right }
  }
  return left
}

function parseUnary(ts: TS, depth: number, params?: Map<string, ConstVal>): Node | undefined {
  const t = ts.peek()
  if (t?.k === 'op' && (t.v === '-' || t.v === '+' || t.v === '~' || t.v === '!')) {
    ts.next()
    const operand = parseUnary(ts, depth + 1, params)
    if (operand === undefined) return undefined
    return { kind: 'unary', op: t.v, operand }
  }
  return parsePrimary(ts, depth, params)
}

function parsePrimary(ts: TS, depth: number, params?: Map<string, ConstVal>): Node | undefined {
  const t = ts.next()
  if (t === undefined) return undefined
  if (t.v === '(') {
    const e = parse(ts, 0, depth + 1, params)
    if (e === undefined || ts.peek()?.v !== ')') return undefined
    ts.next()
    return e
  }
  if (t.k === 'num') {
    const lit = numLiteral(t.v)
    return lit === undefined ? undefined : { kind: 'value', value: lit }
  }
  if (t.k === 'id') {
    const p = params?.get(t.v)
    return p === undefined ? undefined : { kind: 'value', value: p }
  }
  return undefined
}

/** The SELF-DETERMINED width of an expression, IEEE 1364-2005 §5.4.1 Table 5-22 — the width it contributes
 *  when it sits at a wall (a comparison operand, a concatenation element) rather than in a context. */
function selfWidth(node: Node): number {
  if (node.kind === 'value') return node.value.width
  if (node.kind === 'unary') return node.op === '!' ? 1 : selfWidth(node.operand)
  if (node.kind === 'choice') return Math.max(selfWidth(node.whenTrue), selfWidth(node.whenFalse))
  if (COMPARISON.has(node.op) || LOGICAL.has(node.op)) return 1
  if (WIDTH_FROM_LEFT.has(node.op)) return selfWidth(node.left)
  return Math.max(selfWidth(node.left), selfWidth(node.right))
}

/**
 * The width an ELABORATION constant is carried at when nothing outside imposes one — the size a parameter
 * with no declared range takes. It is `selfWidth` except that `+ −` carry a bit and `*` carries the sum of
 * the widths, because such a parameter holds its own arithmetic losslessly rather than wrapping. Measured
 * against Icarus Verilog 14.0 with `$bits`: `4'd15 + 4'd1` is 16 at 5 bits, `8'd200 + 8'd100` is 300 at 9,
 * `3'sd3 * 3'sd3` is 9 at 6, `4'shf + 4'sd1 + 4'sd1` is 1 at 6, and `8'd0 + (-4'd1)` is 511 at 9.
 *
 * The width is load-bearing and not cosmetic: it is the ONLY thing that decides what a NEGATIVE folded
 * constant reads as in an unsigned context. `localparam Q = 4'shf + 4'shf; assign y = Q + a;` is 30 + a in
 * Icarus (five bits, 11110 zero-extended) and would be 14 + a at four bits — the same expression, two answers,
 * no warning. This is the OUTERMOST width only; inside the expression the plain §5.4.1 widths apply, which is
 * what makes `(4'd15 + 4'd1) == 4'd0` fold to 1 there and here.
 *
 * The growth also STOPS at a `<< >> **`, whose left operand is self-determined — `shiftGrowWidth` — and it
 * gives up (undefined) rather than guess where a width cannot be proved.
 */
function growWidth(node: Node): number | undefined {
  if (node.kind === 'value') return node.value.width
  if (node.kind === 'unary') return node.op === '!' ? 1 : growWidth(node.operand)
  if (node.kind === 'choice') return widest(growWidth(node.whenTrue), growWidth(node.whenFalse))
  if (COMPARISON.has(node.op) || LOGICAL.has(node.op)) return 1
  if (WIDTH_FROM_LEFT.has(node.op)) return shiftGrowWidth(node.op, node.left)
  const left = growWidth(node.left)
  const right = growWidth(node.right)
  if (left === undefined || right === undefined) return undefined
  if (node.op === '+' || node.op === '-') return Math.max(left, right) + 1
  if (node.op === '*') return left + right
  return Math.max(left, right)
}

/**
 * THE WIDTH OF A SELF-DETERMINED POSITION — a bit-select index, a part-select bound, a declaration/port/return
 * range, an array depth bound. Those sit in no context at all: nothing is assigned, so the §5.4.1 width IS the
 * width and the bound arithmetic wraps there. Measured against Icarus Verilog 14.0: `wire [(4'd10 + 4'd10):0]`
 * is a five-bit bus, `w[4'd8 + 4'd8]` is bit 0, `w[4'd2 - 4'd5]` is bit 13, and `reg [7:0] m [0:(4'd10 +
 * 4'd10)]` is five words. Folding those at `growWidth` instead built a 21-bit bus and a 21-word memory — real
 * hardware nobody wrote, with nothing said.
 *
 * It still refuses everything `growWidth` refuses. The only width `growWidth` cannot prove is a `**` over a
 * compound base (see `shiftGrowWidth`), and the narrower reading here would ANSWER where the file used to
 * report — turning a refusal into a guess is the one direction that is never allowed.
 */
function selfDeterminedWidth(node: Node): number | undefined {
  return growWidth(node) === undefined ? undefined : selfWidth(node)
}

/** The wider of two grow widths, or undefined when either side had no provable width. */
const widest = (a: number | undefined, b: number | undefined): number | undefined =>
  a === undefined || b === undefined ? undefined : Math.max(a, b)

/**
 * THE SHIFT WALL — the elaboration width of `<< >> **` when nothing outside imposes one. All three take their
 * width from the LEFT operand (§5.4.1 Table 5-22), and that operand is SELF-DETERMINED: the lossless growth an
 * unranged parameter gets does not cross into it, so the sub-expression wraps at its own width BEFORE the shift
 * runs. Measured against Icarus Verilog 14.0 with `$bits`: `(8'd200 + 8'd100) >> 0` is 44 at EIGHT bits (a
 * shift by zero still changes the answer), `(4'd3 + 4'd1) << 2` is 0 at four, `(4'd9 * 4'd2) >> 1` is 1 at
 * four, and `8'd200 << 1` is 144 at eight.
 *
 * `**` IS REFUSED WHEN ITS BASE IS A COMPOUND EXPRESSION, because there the width is not one rule but two.
 * Measured: with a plain literal or parameter base the result keeps the base's own width — `4'd5 ** 2` is 9 at
 * four bits and `4'd3 ** 4'd3` is 11 at four, both wrapped — while with a compound base Icarus instead grows it
 * to selfWidth(base) × exponent: `(4'd3 + 4'd1) ** 2` is 16 at EIGHT and `(4'd15 + 4'd2) ** 3` is 817 at
 * TWELVE. Nothing in §5.4.1 makes the shape of the base decide a width, and Icarus asserts and aborts outright
 * on `(4'd15 + 4'd1) ** 0` (a zero-bit result), so there is no rule here to prove and no oracle for the edge.
 * A pushed-in width settles it and is honored — `localparam [15:0] Q = (4'd15 + 4'd1) ** 2` is 256 — so only
 * the no-context case is refused, and the caller reports the parameter by name.
 *
 * The value-base case returns a width here but does NOT necessarily fold: `exactPower` separately refuses any
 * power whose exact result overflows that width, so `4'd5 ** 2` reports rather than answering the 9 Icarus
 * gives. That is an over-refusal, not a wrong answer, and it is older than this wall.
 */
function shiftGrowWidth(op: string, left: Node): number | undefined {
  if (op === '**' && left.kind !== 'value') return undefined
  return selfWidth(left)
}

/** Whether an expression is SIGNED per IEEE 1364-2005 §5.5.1: signed only when every operand is, except that
 *  a shift takes the left operand's type alone and comparisons / logicals are always unsigned. */
function expressionSigned(node: Node): boolean {
  if (node.kind === 'value') return node.value.signed
  if (node.kind === 'unary') return node.op === '!' ? false : expressionSigned(node.operand)
  if (node.kind === 'choice')
    return expressionSigned(node.whenTrue) && expressionSigned(node.whenFalse)
  if (COMPARISON.has(node.op) || LOGICAL.has(node.op)) return false
  if (SIGN_FROM_LEFT.has(node.op)) return expressionSigned(node.left)
  return expressionSigned(node.left) && expressionSigned(node.right)
}

/** Whether any operand was written without a width, which is what keeps `<<` and `**` growable. */
function expressionUnsized(node: Node): boolean {
  if (node.kind === 'value') return node.value.unsized
  if (node.kind === 'unary') return node.op === '!' ? false : expressionUnsized(node.operand)
  if (node.kind === 'choice')
    return expressionUnsized(node.whenTrue) || expressionUnsized(node.whenFalse)
  if (COMPARISON.has(node.op) || LOGICAL.has(node.op)) return false
  return expressionUnsized(node.left) || expressionUnsized(node.right)
}

/** Fold an operand at its OWN width and type — the self-determined wall. */
function foldSelf(node: Node): ConstVal | undefined {
  const width = selfWidth(node)
  const signed = expressionSigned(node)
  const value = foldAt(node, width, signed)
  if (value === undefined) return undefined
  return { value, width, signed, unsized: expressionUnsized(node) }
}

/**
 * THE ONE FOLD. Every operator in this file computes its result here and nowhere else: the context `width`
 * and `signed` are pushed down into the width-preserving operands, the operation is performed on the extended
 * patterns, and the result is TRUNCATED back to `width` (IEEE 1364-2005 §5.5.2 steps 2 and 3). Extension
 * without truncation is what made `(A + B) < A` — the compile-time overflow check — answer backwards.
 */
function foldAt(node: Node, width: number, signed: boolean): bigint | undefined {
  if (width > MAX_WIDTH) return undefined
  if (node.kind === 'value') return extendTo(node.value, width, signed)
  if (node.kind === 'choice') {
    const condition = foldSelf(node.condition)
    const whenTrue = foldAt(node.whenTrue, width, signed)
    const whenFalse = foldAt(node.whenFalse, width, signed)
    if (condition === undefined || whenTrue === undefined || whenFalse === undefined)
      return undefined
    return condition.value !== 0n ? whenTrue : whenFalse
  }
  if (node.kind === 'unary') return foldUnary(node.op, node.operand, width, signed)
  return foldBinary(node, width, signed)
}

function foldUnary(op: string, operand: Node, width: number, signed: boolean): bigint | undefined {
  if (op === '!') {
    const self = foldSelf(operand)
    return self === undefined ? undefined : wrap(self.value === 0n ? 1n : 0n, width)
  }
  const value = foldAt(operand, width, signed)
  if (value === undefined) return undefined
  if (op === '+') return value
  if (op === '-') return wrap(-value, width)
  return maskOf(width) ^ value // `~`, at the CONTEXT width: `localparam [7:0] Q = ~4'd0` is 255, not 15
}

function foldBinary(
  node: { op: string; left: Node; right: Node },
  width: number,
  signed: boolean,
): bigint | undefined {
  const { op, left, right } = node
  if (LOGICAL.has(op)) {
    const a = foldSelf(left)
    const b = foldSelf(right)
    if (a === undefined || b === undefined) return undefined
    const truth = op === '&&' ? a.value !== 0n && b.value !== 0n : a.value !== 0n || b.value !== 0n
    return wrap(truth ? 1n : 0n, width)
  }
  if (COMPARISON.has(op)) return foldComparison(op, left, right, width)
  const va = foldAt(left, width, signed)
  if (va === undefined) return undefined
  if (WIDTH_FROM_LEFT.has(op)) return foldShiftOrPower(op, va, left, right, width, signed)
  const vb = foldAt(right, width, signed)
  if (vb === undefined) return undefined
  if (op === '&') return va & vb
  if (op === '|') return va | vb
  if (op === '^') return va ^ vb
  if (op === '~^' || op === '^~') return wrap(~(va ^ vb), width)
  // `+ − *` give the same pattern read either way, so the signed reading costs nothing there; `/` and `%` are
  // properties of the mathematical integers (truncate toward zero, remainder takes the dividend's sign,
  // §5.1.5) and need it.
  const ia = readAs(va, width, signed)
  const ib = readAs(vb, width, signed)
  if (op === '+') return wrap(ia + ib, width)
  if (op === '-') return wrap(ia - ib, width)
  if (op === '*') return wrap(ia * ib, width)
  if (op === '/') return ib === 0n ? undefined : wrap(ia / ib, width)
  if (op === '%') return ib === 0n ? undefined : wrap(ia % ib, width)
  return undefined
}

/**
 * A comparison is a WALL: its two operands are sized against each other at their own §5.4.1 widths and typed
 * by their own §5.5.1 signedness, and the result is one unsigned bit that the surrounding context can only
 * zero-extend. This is what makes the overflow idiom work — in `(A + B) < A` the add is folded at eight bits
 * and wraps to 44 BEFORE the comparison sees it, so the answer is 1. Measured: `(4'd15 + 4'd1) == 4'd0` is
 * also 1 in Icarus Verilog 14.0, because the same wall sizes that add at four bits.
 */
function foldComparison(op: string, left: Node, right: Node, width: number): bigint | undefined {
  const operandWidth = Math.max(selfWidth(left), selfWidth(right))
  const operandSigned = expressionSigned(left) && expressionSigned(right)
  const va = foldAt(left, operandWidth, operandSigned)
  const vb = foldAt(right, operandWidth, operandSigned)
  if (va === undefined || vb === undefined) return undefined
  if (op === '==') return wrap(va === vb ? 1n : 0n, width)
  if (op === '!=') return wrap(va !== vb ? 1n : 0n, width)
  const ia = readAs(va, operandWidth, operandSigned)
  const ib = readAs(vb, operandWidth, operandSigned)
  const truth = op === '<' ? ia < ib : op === '<=' ? ia <= ib : op === '>' ? ia > ib : ia >= ib
  return wrap(truth ? 1n : 0n, width)
}

/** `<< >> **` take their width from the left operand, so only the left one is in the context; the amount /
 *  exponent on the right is self-determined (§5.1.12) and read as its own number. */
function foldShiftOrPower(
  op: string,
  va: bigint,
  left: Node,
  right: Node,
  width: number,
  signed: boolean,
): bigint | undefined {
  const amount = foldSelf(right)
  if (amount === undefined) return undefined
  const ia = readAs(va, width, signed)
  if (op === '>>') return amount.value >= BigInt(width) ? 0n : va >> amount.value
  const exact = op === '<<' ? exactShift(ia, amount.value, width) : exactPower(ia, amount, width)
  if (exact === undefined) return undefined
  // Only the LEFT operand's growability matters here, because `<<` and `**` take their width from it — a
  // written-out left operand wraps at its own width whatever the shift amount was written as.
  if (GROWS_WHEN_UNSIZED.has(op) && expressionUnsized(left) && exact < 0n) return undefined
  return wrap(exact, width)
}

function exactShift(ia: bigint, amount: bigint, width: number): bigint | undefined {
  if (ia === 0n) return 0n
  return amount >= BigInt(width) ? undefined : ia << amount
}

/** Table 5-6 gives a negative exponent its own per-case grid (0 / ±1 / other, with x results) that this
 *  2-state evaluator cannot reproduce, so the whole expression refuses rather than fold a large power. */
function exactPower(ia: bigint, amount: ConstVal, width: number): bigint | undefined {
  const e = asInteger(amount)
  if (e < 0n || e > 4096n) return undefined
  if (ia === 0n || ia === 1n || ia === -1n) return ia ** e
  // Refuse before building the bigint when the power cannot possibly fit — `2 ** 40` at 32 bits is exactly
  // the case where Icarus widens to 42 bits and this evaluator would wrap to 0.
  const magnitudeBits = BigInt((ia < 0n ? -ia : ia).toString(2).length)
  if (e * magnitudeBits > BigInt(width)) return undefined
  return ia ** e
}

/** A loop counter wider than this is not counted: each iteration folds the condition at the counter's declared
 *  width, so an unbounded width is unbounded work per step. */
export const MAX_COUNTER_WIDTH = 64

/** A `for` loop's counter, modelled at its DECLARED width and signedness rather than as a JavaScript number.
 *  `visited` is what makes a loop that cannot terminate say so: `reg [3:0] i; i <= 15` is always true because
 *  i + 1 wraps 15 → 0, and a counter that returns to a value it already held will do that forever. */
export type LoopCounter = {
  name: string
  width: number
  value: bigint
  cond: Tok[]
  step: Tok[]
  visited: Set<bigint>
  /** the current value as a sized literal carrying the counter's DECLARED signedness */
  literal: () => string
}

/** Fold a token span to its exact constant value AND its type — the evaluator a loop is counted with. The
 *  procedural unroller passes the synthesizer's width-table fold; the generate elaborator passes `evalConst`. */
export type FoldSpan = (toks: Tok[]) => ConstVal | undefined

/** Split a for header's inner tokens at its two top-level ';' into init / condition / step. */
export function splitForHeader(inner: Tok[]): [Tok[], Tok[], Tok[]] | undefined {
  const cuts: number[] = []
  let depth = 0
  for (let i = 0; i < inner.length; i++) {
    const v = (inner[i] as Tok).v
    if (v === '(' || v === '[' || v === '{') depth += 1
    else if (v === ')' || v === ']' || v === '}') depth -= 1
    else if (v === ';' && depth === 0) cuts.push(i)
  }
  if (cuts.length !== 2) return undefined
  const [a, b] = cuts as [number, number]
  return [inner.slice(0, a), inner.slice(a + 1, b), inner.slice(b + 1)]
}

/** A header assignment `i = <expr>` → its target name and right-hand tokens. A bit-select target, a
 *  nonblocking `<=`, or anything that is not a bare identifier gives undefined (and is then reported). */
export function splitCounterAssign(toks: Tok[]): { name: string; rhs: Tok[] } | undefined {
  const name = toks[0]
  if (name === undefined || name.k !== 'id' || toks[1]?.v !== '=') return undefined
  return { name: name.v, rhs: toks.slice(2) }
}

/** The index of the `]` closing the `[` at `open`, or -1 if it is never closed. */
export function closingBracket(toks: Tok[], open: number): number {
  let depth = 0
  for (let i = open; i < toks.length; i++) {
    const v = (toks[i] as Tok).v
    if (v === '[' || v === '(' || v === '{') depth += 1
    else if (v === ']' || v === ')' || v === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/** The literal for `i[hi:lo]` / `i[k]` on a counter holding a known value. */
function counterSelect(inner: Tok[], counter: LoopCounter): { literal: string } | { bad: string } {
  const parts = splitOnColon(inner)
  const hi = parts === undefined ? constInt(inner) : constInt(parts[0])
  const lo = parts === undefined ? hi : constInt(parts[1])
  if (hi === undefined || lo === undefined)
    return {
      bad: `a select of the loop variable "${counter.name}" that is not a constant bit/part-select is a later increment`,
    }
  if (lo > hi || hi >= counter.width)
    return {
      bad: `${counter.name}[${hi}:${lo}] is outside the ${counter.width}-bit loop variable "${counter.name}", which reads x in Verilog`,
    }
  const width = hi - lo + 1
  const value = (counter.value >> BigInt(lo)) & ((1n << BigInt(width)) - 1n)
  return { literal: `${width}'h${value.toString(16)}` }
}

/**
 * Replace every read of the loop counter with a sized literal token. The span is then RE-PARSED, so `a[i]`
 * becomes an ordinary constant bit-select and meets the existing constant-select and out-of-range rules
 * unchanged — the unroller never resolves an index into a net itself.
 *
 * A select OF THE COUNTER (`i[1:0]`, the ordinary way to narrow a loop variable down to a bus) is the one
 * thing that cannot be left to the re-parse: a select of a bare literal is not Verilog. Those bits are folded
 * here, unsigned (IEEE 1364-2005 §5.5.1 makes every part-select unsigned), and a select reaching past the
 * counter's declared width reads x in Verilog, so it is refused rather than zero-filled.
 *
 * An identifier written straight after a `.` is a PORT name being connected by name (`.i(x)`), never a read
 * of the counter — a module really can declare a port called `i`, and rewriting that one to `.32'sd0(x)`
 * would destroy the connection. `substituteParams` in verilog-import.ts carries the same guard.
 */
export function substituteCounter(toks: Tok[], counter: LoopCounter): Tok[] | { bad: string } {
  const out: Tok[] = []
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i] as Tok
    if (t.k !== 'id' || t.v !== counter.name || (toks[i - 1] as Tok | undefined)?.v === '.') {
      out.push(t)
      continue
    }
    if ((toks[i + 1] as Tok | undefined)?.v !== '[') {
      out.push({ k: 'num', v: counter.literal(), line: t.line })
      continue
    }
    const close = closingBracket(toks, i + 1)
    if (close === -1)
      return { bad: `a select of the loop variable "${counter.name}" is missing "]"` }
    const sel = counterSelect(toks.slice(i + 2, close), counter)
    if ('bad' in sel) return sel
    out.push({ k: 'num', v: sel.literal, line: t.line })
    i = close
  }
  return out
}

/**
 * The loop counter a `for` header describes, modelled at its declared width and signedness, or the reason it
 * cannot be modelled. Counting in JavaScript numbers instead gets the ordinary cases right and the wrapping
 * ones silently wrong: `for (i = 3; i >= 0; i = i - 1)` runs four times signed and never terminates unsigned,
 * and Icarus Verilog 14.0 on `reg [3:0] i; for (i = 0; i <= 15; i = i + 1)` was still looping after 101
 * iterations at simulation time 0.
 */
export function loopCounter(
  header: Tok[],
  fold: FoldSpan,
  widthOf: (n: string) => number,
  signedOf: (n: string) => boolean,
): LoopCounter | { bad: string } {
  const parts = splitForHeader(header)
  if (parts === undefined) return { bad: 'a for header must read (init; condition; step)' }
  const [initToks, cond, stepToks] = parts
  const init = splitCounterAssign(initToks)
  if (init === undefined)
    return { bad: 'a for loop must start by assigning a loop variable — for (i = 0; …' }
  const step = splitCounterAssign(stepToks)
  if (step === undefined || step.name !== init.name)
    return { bad: `a for loop's step must assign its own loop variable "${init.name}"` }
  const width = widthOf(init.name)
  // An UNDECLARED loop variable reads as one bit here, and Icarus Verilog 14.0 rejects that source outright
  // ("register ``i'' unknown in m"). A genuinely 1-bit counter can only ever hold 0 and 1, so nothing that
  // counts is lost by naming this case instead of unrolling one or two iterations of it.
  if (width < 2)
    return {
      bad: `the loop variable "${init.name}" reads as a single bit — an undeclared loop variable, or one declared as a 1-bit reg, cannot count a loop`,
    }
  if (width > MAX_COUNTER_WIDTH)
    return { bad: `loop variable "${init.name}" is ${width} bits, wider than this importer counts` }
  const start = fold(init.rhs)
  if (start === undefined)
    return { bad: `the start value of the for loop over "${init.name}" is not a constant` }
  const signed = signedOf(init.name)
  const counter: LoopCounter = {
    name: init.name,
    width,
    // Assigning the start into the counter is an assignment (§5.6): a SIGNED start sign-extends into the
    // counter's declared width, so `for (i = 4'she; …)` starts an `integer` at −2 and not at +14.
    value: extendTo(start, width, start.signed),
    cond,
    step: step.rhs,
    visited: new Set<bigint>(),
    literal: () => `${width}'${signed ? 's' : ''}h${counter.value.toString(16)}`,
  }
  return counter
}

/** Fold the loop's condition at the counter's current value and say whether another iteration runs. A counter
 *  that returns to a value it already held can never terminate at its declared width, and is refused by name
 *  rather than unrolled at whatever count a JavaScript loop would have reached. */
export function loopContinues(
  counter: LoopCounter,
  fold: FoldSpan,
): { go: boolean } | { bad: string } {
  const cond = substituteCounter(counter.cond, counter)
  if ('bad' in cond) return cond
  const keepGoing = fold(cond)
  if (keepGoing === undefined)
    return {
      bad: `the condition of the for loop over "${counter.name}" is not an elaboration-time constant`,
    }
  if (keepGoing.value === 0n) return { go: false }
  if (counter.visited.has(counter.value))
    return {
      bad: `the for loop over "${counter.name}" returns to a counter value it already had, so at its declared ${counter.width}-bit width it never ends`,
    }
  counter.visited.add(counter.value)
  return { go: true }
}

/** Run the loop's step expression and store the next counter value, or say why it could not be folded. */
export function loopAdvance(counter: LoopCounter, fold: FoldSpan): { bad: string } | undefined {
  const step = substituteCounter(counter.step, counter)
  if ('bad' in step) return step
  const stepped = fold(step)
  if (stepped === undefined)
    return {
      bad: `the step of the for loop over "${counter.name}" is not an elaboration-time constant`,
    }
  counter.value = extendTo(stepped, counter.width, stepped.signed)
  return undefined
}
