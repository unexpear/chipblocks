/**
 * RTL SYNTHESIS (increment 2a — combinational, scalar) — turn a continuous assignment `assign y = expr;`
 * into REAL gates. This is the "write higher-level logic, get the gate netlist" half of the HDL bridge:
 * where the structural importer reads a netlist of pre-drawn gates, this SYNTHESIZES the gates from a
 * boolean expression, then feeds them to the SAME lowering the importer uses (so they wire + place + power
 * exactly like any drawn gate, and the gates stay the real, simulatable source of truth).
 *
 * SCOPE (2a): scalar (1-bit) nets and the boolean/select operators `~ ! & | ^ ~^ ^~ && || == != ?:` plus
 * the 0/1 constants, parsed with a real Verilog precedence-climbing parser (so `a | b & c` groups as
 * `a | (b & c)`, `a & b == c` as `a & (b == c)`, `?:` right-associative, and reductions vs binary `&`/`|`/`^`
 * disambiguated by position). Everything else — multi-bit buses, bit/part-selects, concatenation, arithmetic
 * (+ − * / …), shifts, magnitude comparison — is REPORTED, never faked (buses + arithmetic are increment 2b).
 * The design was adversarially verified against IEEE 1364-2005 (65 rules, 0 refuted) before this code.
 */

import type { Assign, GateInst, Tok } from './verilog-import.ts'

// ── expression AST ────────────────────────────────────────────────────────────
type Expr =
  | { t: 'net'; name: string }
  | { t: 'const'; bit: 0 | 1 }
  | { t: 'un'; op: string; a: Expr }
  | { t: 'bin'; op: string; a: Expr; b: Expr }
  | { t: 'tern'; c: Expr; a: Expr; b: Expr }
  | { t: 'bad'; why: string }

/** Binary-operator binding power (higher binds tighter), the IEEE 1364-2005 Table 5-4 ladder. `?:` (loosest)
 *  is handled specially. Unsupported operators still get real slots so supported neighbours group correctly
 *  and the report anchors to the exact offending operator. */
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
/** Binary operators the scalar synthesizer can build; the rest are reported. */
const SUPPORTED_BIN = new Set(['||', '&&', '|', '^', '~^', '^~', '&', '==', '!='])
/** Prefix operators (highest precedence). `& | ^ ~& ~| ~^ ^~` here are REDUCTIONS (position = prefix). */
const UNARY = new Set(['~', '!', '&', '|', '^', '~&', '~|', '~^', '^~', '+', '-'])
const SUPPORTED_UN = new Set(['~', '!', '&', '|', '^', '~&', '~|', '~^', '^~'])

class TokStream {
  i = 0
  constructor(readonly ts: Tok[]) {}
  peek(): Tok | undefined {
    return this.ts[this.i]
  }
  next(): Tok | undefined {
    return this.ts[this.i++]
  }
}

/** Parse an rhs token span into an expression AST (unsupported constructs become `bad` nodes). */
function parseRhs(tokens: Tok[]): Expr {
  const ts = new TokStream(tokens)
  if (ts.peek() === undefined) return { t: 'bad', why: 'empty right-hand side' }
  const e = parseExpr(ts, 0)
  if (e.t === 'bad') return e // keep the specific reason (an unsupported op stops the climb mid-stream)
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
      if (1 < minBP) break // ternary binds loosest
      ts.next()
      const then = parseExpr(ts, 0) // middle arm is a full (reset-precedence) expression up to ':'
      if (ts.peek()?.v !== ':') return { t: 'bad', why: 'conditional ?: is missing its ":"' }
      ts.next()
      const els = parseExpr(ts, 1) // right-associative: else arm at the ternary's own binding power
      left = { t: 'tern', c: left, a: then, b: els }
      continue
    }
    if (t.k !== 'op') break
    const bp = INFIX_BP[t.v]
    if (bp === undefined || bp < minBP) break
    if (!SUPPORTED_BIN.has(t.v))
      return { t: 'bad', why: `operator "${t.v}" is not supported (a later increment)` }
    ts.next()
    const right = parseExpr(ts, bp + 1) // all supported binary ops are left-associative
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
  if (t.k === 'num') return scalarConst(t.v)
  if (t.k === 'id') {
    if (ts.peek()?.v === '[')
      return { t: 'bad', why: 'bit/part-select needs bus support (a later increment)' }
    return { t: 'net', name: t.v }
  }
  if (t.v === '{') return { t: 'bad', why: 'concatenation needs bus support (a later increment)' }
  return { t: 'bad', why: `unexpected "${t.v}"` }
}

/** A Verilog integer literal → a scalar 0/1 constant, or `bad` if it is multi-bit / x-z / unparseable. */
function scalarConst(v: string): Expr {
  const based = v.match(/^(\d*)'[sS]?([bBoOdDhH])([0-9a-fA-FxXzZ?_]+)$/)
  if (based === null) {
    if (/^[0-9][0-9_]*$/.test(v)) {
      const n = Number.parseInt(v.replace(/_/g, ''), 10)
      return n === 0
        ? { t: 'const', bit: 0 }
        : n === 1
          ? { t: 'const', bit: 1 }
          : { t: 'bad', why: 'multi-bit constant needs bus support (a later increment)' }
    }
    return { t: 'bad', why: `constant "${v}"` }
  }
  const width = based[1] === '' ? 32 : Number.parseInt(based[1] as string, 10)
  const digits = (based[3] as string).replace(/_/g, '')
  if (/[xXzZ?]/.test(digits)) return { t: 'bad', why: 'x/z constant is not representable' }
  const base = { b: 2, o: 8, d: 10, h: 16 }[(based[2] as string).toLowerCase()] as number
  const val = Number.parseInt(digits, base)
  if (width > 1 && based[1] !== '')
    return { t: 'bad', why: 'multi-bit constant needs bus support (a later increment)' }
  const lsb = width === 1 ? val & 1 : val // a 1-bit sized literal (1'd3, 1'hF) truncates to its LSB
  if (lsb === 0) return { t: 'const', bit: 0 }
  if (lsb === 1) return { t: 'const', bit: 1 }
  return { t: 'bad', why: 'multi-bit constant needs bus support (a later increment)' }
}

/** The first unsupported construct in the tree (for the honest report), or undefined if fully supported. */
function firstBad(e: Expr): string | undefined {
  if (e.t === 'bad') return e.why
  if (e.t === 'un') return firstBad(e.a)
  if (e.t === 'bin') return firstBad(e.a) ?? firstBad(e.b)
  if (e.t === 'tern') return firstBad(e.c) ?? firstBad(e.a) ?? firstBad(e.b)
  return undefined
}

// ── scalar synthesis: AST → gates ───────────────────────────────────────────────
/** A synthesized 1-bit value: a constant, or a net that carries it. */
type Sig = { const: 0 | 1 } | { net: string }
const isConst = (s: Sig): s is { const: 0 | 1 } => 'const' in s

/** Synthesize an expression to a 1-bit signal, appending gates. Folds constants so `a & 1'b1` = a. */
function synth(e: Expr, gates: GateInst[], fresh: () => string): Sig {
  if (e.t === 'net') return { net: e.name }
  if (e.t === 'const') return { const: e.bit }
  if (e.t === 'bad') return { const: 0 } // unreachable: firstBad() gates this out first
  if (e.t === 'un') {
    const a = synth(e.a, gates, fresh)
    // reductions on a scalar are the bit itself (& | ^) or its inverse (~& ~| ~^); ! and ~ invert
    const invert =
      e.op === '~' ||
      e.op === '!' ||
      e.op === '~&' ||
      e.op === '~|' ||
      e.op === '~^' ||
      e.op === '^~'
    return invert ? not(a, gates, fresh) : a
  }
  if (e.t === 'tern') {
    const c = synth(e.c, gates, fresh)
    // Lazily: a constant select synthesizes ONLY the chosen arm — the dead arm emits no gates (so its
    // nets never appear and can't become phantom input ports).
    if (isConst(c)) return synth(c.const === 1 ? e.a : e.b, gates, fresh)
    const a = synth(e.a, gates, fresh)
    const b = synth(e.b, gates, fresh)
    const nc = not(c, gates, fresh) // y = (a AND c) OR (b AND NOT c)
    return bin2(
      'or',
      bin2('and', a, c, gates, fresh),
      bin2('and', b, nc, gates, fresh),
      gates,
      fresh,
    )
  }
  const a = synth(e.a, gates, fresh)
  const b = synth(e.b, gates, fresh)
  // on scalars: && ≡ &, || ≡ |, == ≡ XNOR, != ≡ XOR
  const op =
    e.op === '&&'
      ? 'and'
      : e.op === '||'
        ? 'or'
        : e.op === '=='
          ? 'xnor'
          : e.op === '!='
            ? 'xor'
            : e.op === '~^' || e.op === '^~'
              ? 'xnor'
              : e.op === '&'
                ? 'and'
                : e.op === '|'
                  ? 'or'
                  : 'xor' // '^'
  return bin2(op, a, b, gates, fresh)
}

/** NOT with constant folding. */
function not(a: Sig, gates: GateInst[], fresh: () => string): Sig {
  if (isConst(a)) return { const: a.const === 1 ? 0 : 1 }
  const out = fresh()
  gates.push({ prim: 'not', terminals: [out, a.net] })
  return { net: out }
}

/** A 2-input gate with constant folding (identities keep the netlist minimal + avoid tying constants). */
function bin2(prim: string, a: Sig, b: Sig, gates: GateInst[], fresh: () => string): Sig {
  if (isConst(a) && isConst(b)) {
    const va = a.const
    const vb = b.const
    const r =
      prim === 'and' ? va & vb : prim === 'or' ? va | vb : prim === 'xor' ? va ^ vb : va ^ vb ^ 1 // xnor
    return { const: (r & 1) as 0 | 1 }
  }
  const [k, v] = isConst(a)
    ? [a.const, b]
    : isConst(b)
      ? [b.const, a as Sig]
      : [undefined, undefined]
  if (k !== undefined && v !== undefined) {
    // fold a constant operand
    if (prim === 'and') return k === 0 ? { const: 0 } : v
    if (prim === 'or') return k === 1 ? { const: 1 } : v
    if (prim === 'xor') return k === 0 ? v : not(v, gates, fresh)
    return k === 1 ? v : not(v, gates, fresh) // xnor
  }
  const out = fresh()
  gates.push({ prim, terminals: [out, (a as { net: string }).net, (b as { net: string }).net] })
  return { net: out }
}

/** The synthesizer's view of a parsed module — the fields it reads/writes (a subset of ParsedModule). */
type SynthModule = {
  dir: Map<string, 'input' | 'output' | 'inout'>
  gates: GateInst[]
  assigns: Assign[]
}

/**
 * Synthesize every continuous assignment in the module into real gates, APPENDING them to `mod.gates`
 * (which the importer's lower() then wires + places). Anything outside the scalar-boolean subset is
 * reported in `warnings` and NOT built — never silently faked.
 */
/** A gate's OUTPUT nets and INPUT nets by the primitive's terminal convention: buf/not have the shared input
 *  LAST (earlier terminals are outputs); the 2-input gates are output-FIRST then inputs. */
const N_OUTPUT_PRIMS = new Set(['buf', 'not'])
const gateOutputs = (g: GateInst): string[] =>
  N_OUTPUT_PRIMS.has(g.prim) ? g.terminals.slice(0, -1) : [g.terminals[0] as string]
const gateInputs = (g: GateInst): string[] =>
  N_OUTPUT_PRIMS.has(g.prim)
    ? [g.terminals[g.terminals.length - 1] as string]
    : g.terminals.slice(1)

export function synthesizeAssigns(mod: SynthModule, warnings: string[]): void {
  if (mod.assigns.length === 0) return

  // Fresh internal-net names must dodge every name already in the module (declared ports + structural gate
  // terminals) so a user net literally called "syn0" can never be silently merged with a synthesized net.
  const used = new Set<string>(mod.dir.keys())
  for (const g of mod.gates) for (const t of g.terminals) used.add(t)
  let n = 0
  const fresh = (): string => {
    let name = `syn${n++}`
    while (used.has(name)) name = `syn${n++}`
    used.add(name)
    return name
  }

  const inputs = new Set([...mod.dir].filter(([, d]) => d === 'input').map(([name]) => name))
  // Every net already driven — by a structural gate OR (below) by an earlier assign — so a second driver is
  // caught. Seeding from mod.gates makes assign-vs-structural-gate contention as loud as assign-vs-assign.
  const driven = new Set<string>()
  for (const g of mod.gates) for (const o of gateOutputs(g)) driven.add(o)

  const built: { lhs: string; refs: string[]; gates: GateInst[] }[] = []
  for (const a of mod.assigns) {
    if (a.lhs.length !== 1 || a.lhs[0]?.k !== 'id') {
      warnings.push(
        `line ${a.line}: assign target is not a plain scalar net (bit-select/concat needs bus support — a later increment) — reported, not built`,
      )
      continue
    }
    const lhs = a.lhs[0].v
    if (inputs.has(lhs)) {
      warnings.push(`line ${a.line}: assign drives input port "${lhs}" — illegal, reported`)
      continue
    }
    if (driven.has(lhs)) {
      warnings.push(
        `line ${a.line}: net "${lhs}" is assigned more than once (or already driven by a gate) — reported, not built`,
      )
      continue
    }
    const ast = parseRhs(a.rhs)
    const bad = firstBad(ast)
    if (bad !== undefined) {
      warnings.push(`line ${a.line}: assign to "${lhs}" not synthesized — ${bad}`)
      continue
    }
    const gates: GateInst[] = []
    const out = synth(ast, gates, fresh)
    if (isConst(out)) {
      warnings.push(
        `line ${a.line}: assign "${lhs}" is a constant — a constant driver needs bus support (a later increment) — reported, not built`,
      )
      continue
    }
    gates.push({ prim: 'buf', terminals: [lhs, out.net] }) // drive the target from the expression output
    driven.add(lhs)
    // The refs are the module nets the EMITTED gates actually read — the gate INPUTS minus this cone's own
    // internal temporaries (fresh nets = gate outputs OTHER than the lhs). Keeping the lhs makes a real
    // self-loop (y = y & a, where y feeds an internal gate) visible; dropping the temporaries + any
    // folded-away dead branch keeps a spurious dependency out.
    const temps = new Set(gates.flatMap(gateOutputs))
    temps.delete(lhs)
    const refs = [...new Set(gates.flatMap(gateInputs))].filter((net) => !temps.has(net))
    built.push({ lhs, refs, gates })
  }

  // Combinational-loop guard over the FULL driver graph — assign buffers AND structural gates. Each driven
  // net depends on its driver's input nets; a cycle that runs through an assign is a latch/oscillator the
  // fast-logic engine would settle to a wrong value, so that assign is reported and NOT built. (A purely
  // structural cycle — e.g. a cross-coupled SR latch — carries no assign and is left to the structural path.)
  const driverInputs = new Map<string, string[]>()
  for (const g of mod.gates) {
    const ins = gateInputs(g)
    for (const o of gateOutputs(g)) driverInputs.set(o, ins)
  }
  for (const b of built) driverInputs.set(b.lhs, b.refs)
  const onCycle = cycleNets(driverInputs)

  for (const b of built) {
    if (onCycle.has(b.lhs)) {
      warnings.push(
        `combinational loop through "${b.lhs}" — the assign feeds back on itself; reported, not built`,
      )
      continue
    }
    mod.gates.push(...b.gates)
  }
}

/** Nets that sit ON a combinational cycle in a `net → driver-input-nets` graph. Path-based, so a feed-forward
 *  net that merely READS a looped net is NOT flagged (only the true cycle members are). */
function cycleNets(edges: Map<string, string[]>): Set<string> {
  const onCycle = new Set<string>()
  const state = new Map<string, 0 | 1 | 2>() // 0 unseen, 1 on-path, 2 done
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
