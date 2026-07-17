/**
 * VERILOG BRIDGE (import half) — real Verilog read back into placed ChipBlocks gates. This is the "vice
 * versa" of verilog.ts: draw gates → get Verilog (export), OR write Verilog → get placed gates (this file).
 * Verilog stays a REPRESENTATION on the interchange hub (like SPICE/KiCad); the gates it lowers to are the
 * real, simulatable source of truth. Nothing is faked: any construct outside the structural gate-level
 * subset is REPORTED in `warnings`, never silently turned into a gate.
 *
 * It reads STRUCTURAL Verilog (IEEE 1364-2005): a module of the language's built-in gate PRIMITIVES wired
 * by nets. The eight that map 1:1 to ChipBlocks gates are and/or/nand/nor/xor/xnor (n_input, OUTPUT-FIRST)
 * and buf/not (n_output, INPUT-LAST). An N-input primitive is lowered to a tree of ChipBlocks' 2-input
 * gates: and/or/xor become an associative 2-input tree; nand/nor/xnor become that same AND/OR/XOR tree
 * followed by EXACTLY ONE inverter (never a chain of the inverting gate — that computes the wrong function
 * for odd N). The powerless Verilog gates get their VDD/GND rails RE-SYNTHESIZED on the way in.
 *
 * Built from scratch (own-engine identity, not licensing): a stateful lexer that survives any input +
 * comments/strings/directives/attributes, a structural parser for both module-header forms, and a lowering
 * pass to a composite BlockData. The design was researched + adversarially verified against IEEE 1364-2005
 * before this code (0 rules refuted); attribution + reference tools are in CREDITS.md.
 */

import type { BlockData, BlockInnerEdge, BlockInnerNode, BlockPort } from './blocks.ts'
import {
  AND_BLOCK,
  BUFFER_BLOCK,
  D_FLIPFLOP_BLOCK,
  INVERTER_BLOCK,
  NAND2_BLOCK,
  NOR2_BLOCK,
  OR_BLOCK,
  XNOR_BLOCK,
  XOR_BLOCK,
} from './builtin-blocks.ts'
import { POWER_PORT_IDS } from './logic-sim.ts'
import { synthesizeBehavioral } from './verilog-synth.ts'

export type ImportResult = {
  block: BlockData | null
  warnings: string[]
  moduleName: string | null
}

// ── Verilog keyword tables ───────────────────────────────────────────────────
/** The 6 n_input primitives → the 2-input ChipBlocks base gate, its native 2-input form, and whether the
 *  result is inverted (nand/nor/xnor = base tree + ONE final inverter). */
const N_INPUT: Record<string, { base: BlockData; native: BlockData; invert: boolean }> = {
  and: { base: AND_BLOCK, native: AND_BLOCK, invert: false },
  or: { base: OR_BLOCK, native: OR_BLOCK, invert: false },
  xor: { base: XOR_BLOCK, native: XOR_BLOCK, invert: false },
  nand: { base: AND_BLOCK, native: NAND2_BLOCK, invert: true },
  nor: { base: OR_BLOCK, native: NOR2_BLOCK, invert: true },
  xnor: { base: XOR_BLOCK, native: XNOR_BLOCK, invert: true },
}
/** The 2 n_output primitives (LAST terminal is the shared input, earlier terminals are outputs). */
const N_OUTPUT: Record<string, BlockData> = { not: INVERTER_BLOCK, buf: BUFFER_BLOCK }
/** The built-in gate-cell names. `isLogicGate` keys on `block.name`, so a composite whose name equals one of
 *  these but whose gates compute something else would be simulated BY NAME — its real cells ignored. lower()
 *  guards against that (a genuine single native cell keeps its name; a mismatch is renamed + warned). */
const PRIMITIVE_NAMES = new Set([
  INVERTER_BLOCK.name,
  BUFFER_BLOCK.name,
  AND_BLOCK.name,
  OR_BLOCK.name,
  NAND2_BLOCK.name,
  NOR2_BLOCK.name,
  XOR_BLOCK.name,
  XNOR_BLOCK.name,
])
/** The other 18 gate/switch primitives — real Verilog, but no faithful ChipBlocks image → reported. */
const OTHER_GATE_SWITCH = new Set([
  'bufif0',
  'bufif1',
  'notif0',
  'notif1',
  'nmos',
  'pmos',
  'cmos',
  'rnmos',
  'rpmos',
  'rcmos',
  'tran',
  'tranif0',
  'tranif1',
  'rtran',
  'rtranif0',
  'rtranif1',
  'pullup',
  'pulldown',
])
const RESOLVED_NETS = ['tri', 'tri0', 'tri1', 'wand', 'wor', 'triand', 'trior', 'trireg', 'uwire']
const BEHAVIORAL = [
  'assign',
  'always',
  'initial',
  'reg',
  'parameter',
  'localparam',
  'defparam',
  'generate',
  'function',
  'task',
  'specify',
]
const STRENGTH0 = new Set(['supply0', 'strong0', 'pull0', 'weak0', 'highz0'])
const STRENGTH1 = new Set(['supply1', 'strong1', 'pull1', 'weak1', 'highz1'])
/** Every reserved word the lexer must classify as a keyword (not a net name). Case-sensitive, all lowercase. */
const KEYWORDS = new Set([
  'module',
  'endmodule',
  'input',
  'output',
  'inout',
  'wire',
  'begin',
  'end',
  'endgenerate',
  'endfunction',
  'endtask',
  'endspecify',
  'signed',
  'scalared',
  'vectored',
  ...RESOLVED_NETS,
  ...BEHAVIORAL,
  ...Object.keys(N_INPUT),
  ...Object.keys(N_OUTPUT),
  ...OTHER_GATE_SWITCH,
])

type Kind = 'id' | 'num' | 'kw' | 'p' | 'op' | 'dir' | 'sys' | 'str' | 'unk'
export type Tok = { k: Kind; v: string; line: number }

const isIdStart = (c: string): boolean => /[A-Za-z_]/.test(c)
const isIdPart = (c: string): boolean => /[A-Za-z0-9_$]/.test(c)
const isDigit = (c: string): boolean => c >= '0' && c <= '9'
const isSpace = (c: string): boolean =>
  c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r'

/**
 * Stateful left-to-right lexer. Never throws: any byte it cannot classify becomes an `unk` token the parser
 * reports. Comments/strings/attributes are consumed here so their inner `;`/`,`/`//` can never mis-drive the
 * parser; backtick directives become a single `dir` token (the parser reports them by kind).
 */
function lex(src: string): { tokens: Tok[]; warnings: string[] } {
  const tokens: Tok[] = []
  const warnings: string[] = []
  let i = 0
  let line = 1
  const n = src.length
  const push = (k: Kind, v: string) => tokens.push({ k, v, line })

  while (i < n) {
    const c = src[i] as string
    if (c === '\n') {
      line += 1
      i += 1
      continue
    }
    if (isSpace(c)) {
      i += 1
      continue
    }

    if (c === '/' && src[i + 1] === '/') {
      i += 2
      while (i < n && src[i] !== '\n') i += 1
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2
      let closed = false
      while (i < n) {
        if (src[i] === '\n') line += 1
        if (src[i] === '*' && src[i + 1] === '/') {
          i += 2
          closed = true
          break
        }
        i += 1
      }
      if (!closed)
        warnings.push(`line ${line}: block comment /* … */ never closed before end of file`)
      continue
    }

    // attribute instance (* … *) — skip, but never the @(*) sensitivity wildcard
    if (c === '(' && src[i + 1] === '*' && tokens[tokens.length - 1]?.v !== '@') {
      let j = i + 2
      while (j < n && isSpace(src[j] as string)) j += 1
      if (src[j] !== ')') {
        i += 2
        let closed = false
        while (i < n) {
          if (src[i] === '\n') line += 1
          if (src[i] === '*' && src[i + 1] === ')') {
            i += 2
            closed = true
            break
          }
          i += 1
        }
        if (!closed) warnings.push(`line ${line}: attribute (* … *) never closed`)
        continue
      }
    }

    // string literal — single line; only \" and \\ move the terminator
    if (c === '"') {
      i += 1
      let closed = false
      while (i < n && src[i] !== '\n') {
        if (src[i] === '\\' && src[i + 1] !== undefined && src[i + 1] !== '\n') {
          i += 2
          continue
        }
        if (src[i] === '"') {
          i += 1
          closed = true
          break
        }
        i += 1
      }
      if (!closed) warnings.push(`line ${line}: string literal not terminated on its line`)
      push('str', '"…"')
      continue
    }

    // escaped identifier \… up to whitespace/EOF — always an identifier, even if it spells a keyword
    if (c === '\\') {
      let j = i + 1
      while (j < n && !isSpace(src[j] as string)) j += 1
      push('id', src.slice(i + 1, j))
      i = j
      continue
    }

    // compiler directive `name … (consume the rest of the line; reported by kind in the parser)
    if (c === '`') {
      let j = i + 1
      while (j < n && isIdPart(src[j] as string)) j += 1
      const name = src.slice(i + 1, j)
      while (j < n && src[j] !== '\n') j += 1
      push('dir', name)
      i = j
      continue
    }

    if (c === '$') {
      let j = i + 1
      while (j < n && isIdPart(src[j] as string)) j += 1
      push('sys', src.slice(i, j))
      i = j
      continue
    }

    // number: optional size, optional based value ' [s] base digits — keeps 1'b0 / 12'hE3 whole
    if (isDigit(c) || (c === "'" && /[sSbBoOdDhH]/.test(src[i + 1] ?? ''))) {
      let j = i
      while (j < n && (isDigit(src[j] as string) || src[j] === '_')) j += 1
      if (src[j] === "'") {
        j += 1
        if (src[j] === 's' || src[j] === 'S') j += 1
        if (/[bBoOdDhH]/.test(src[j] ?? '')) j += 1
        while (j < n && /[0-9a-fA-FxXzZ?_]/.test(src[j] as string)) j += 1
      }
      push('num', src.slice(i, j))
      i = j
      continue
    }

    if (isIdStart(c)) {
      let j = i + 1
      while (j < n && isIdPart(src[j] as string)) j += 1
      const word = src.slice(i, j)
      push(KEYWORDS.has(word) ? 'kw' : 'id', word)
      i = j
      continue
    }

    // bracket / structural punctuation (depth-tracked by readGroup); ':' also separates ?: and h:l
    if ('()[]{},;:.#@'.includes(c)) {
      push('p', c)
      i += 1
      continue
    }
    // expression operators — maximal munch (3-char, then 2-char, then 1-char) so `===`, `<<<`, `~&`,
    // `==` lex as ONE token each (never `==` → two `=`, never `~&` → `~` then `&`).
    const three = src.slice(i, i + 3)
    const two = src.slice(i, i + 2)
    if (OPS3.has(three)) {
      push('op', three)
      i += 3
      continue
    }
    if (OPS2.has(two)) {
      push('op', two)
      i += 2
      continue
    }
    if (OPS1.has(c)) {
      push('op', c)
      i += 1
      continue
    }
    push('unk', c)
    i += 1
  }
  return { tokens, warnings }
}

/** Verilog operators, grouped by length for the lexer's maximal-munch. `=` is the assignment token. */
const OPS3 = new Set(['===', '!==', '<<<', '>>>', '==?', '!=?'])
const OPS2 = new Set(['==', '!=', '<=', '>=', '<<', '>>', '&&', '||', '~&', '~|', '~^', '^~', '**'])
const OPS1 = new Set(['&', '|', '^', '~', '!', '?', '+', '-', '*', '/', '%', '<', '>', '='])

// ── structural parser ─────────────────────────────────────────────────────────
export type GateInst = { prim: string; terminals: string[] }
/** A continuous assignment `assign <lhs> = <rhs>;` captured as token spans; the synthesizer (verilog-synth)
 *  parses the rhs into gates. */
export type Assign = { lhs: Tok[]; rhs: Tok[]; line: number }
/** A clocked block `always @(posedge <clk>) <body>` captured as token spans; the synthesizer elaborates the
 *  body into per-register next-state logic + flip-flops. */
export type AlwaysBlock = { clk: string; body: Tok[]; line: number }
/** A synthesized flip-flop: its D-input net, clock net, and Q-output net (one per registered bit). */
export type FlopInst = { d: string; clk: string; q: string }
/** A declared memory `reg [width-1:0] m [0:depth-1]` — `depth` words, each `width` bits. The synthesizer
 *  turns each word into real flip-flops and `m[addr]` into a decode/mux, exactly like the gate Data RAM. */
export type MemInfo = { width: number; depth: number }
type ParsedModule = {
  name: string
  portOrder: string[]
  dir: Map<string, 'input' | 'output' | 'inout'>
  gates: GateInst[]
  assigns: Assign[]
  alwaysBlocks: AlwaysBlock[]
  /** Filled by the synthesizer: one flip-flop per registered bit; lower() places each as a D_FLIPFLOP_BLOCK. */
  flops: FlopInst[]
  /** Net → bit width for declared buses (`[N:0] a` → 4). Absent ⇒ a 1-bit scalar. */
  widths: Map<string, number>
  /** Memory name → {word width, depth} for declared arrays (`reg [D-1:0] m [0:W-1]`). */
  mems: Map<string, MemInfo>
}

/** A plain non-negative decimal integer (for a range bound), or undefined for anything else (a based literal
 *  or a parameter expression — those buses are reported). */
function intLiteral(v: string): number | undefined {
  return /^[0-9][0-9_]*$/.test(v) ? Number.parseInt(v.replace(/_/g, ''), 10) : undefined
}

/** A `[ msb : lsb ]` range's bit width. Only descending, zero-based `[N:0]` is representable (right endpoint =
 *  LSB); anything else (ascending, nonzero-based, non-constant) is reported. `inner` is the tokens between the
 *  brackets. */
function rangeWidth(inner: Tok[]): { width: number } | { bad: string } {
  // Only bare integer bounds — reject anything with an identifier/operator (e.g. a parameter `[WIDTH-1:0]`),
  // which would otherwise slip through the two-num check with a silently wrong width.
  if (inner.some((t) => t.k !== 'num' && t.v !== ':'))
    return { bad: 'non-constant range (parameterized bounds are unsupported)' }
  const nums = inner.filter((t) => t.k === 'num')
  if (!inner.some((t) => t.v === ':') || nums.length !== 2)
    return { bad: 'non-constant or malformed range' }
  const msb = intLiteral((nums[0] as Tok).v)
  const lsb = intLiteral((nums[1] as Tok).v)
  if (msb === undefined || lsb === undefined) return { bad: 'non-integer range bound' }
  if (lsb !== 0 || msb < 0)
    return {
      bad: `range [${msb}:${lsb}] must be [N:0] (ascending/nonzero-based buses are unsupported)`,
    }
  return { width: msb + 1 }
}

/** Read a declaration range at the cursor (positioned at `[`); leaves the cursor just past `]`. */
function readRange(c: Cursor): { width: number } | { bad: string } {
  c.next() // '['
  const inner: Tok[] = []
  while (!c.atEnd() && !c.is(']') && !c.is(';')) inner.push(c.next() as Tok)
  if (c.is(']')) c.next()
  return rangeWidth(inner)
}

/** A memory depth range `[0 : W-1]` (ascending, zero-based) → its word count W. Descending / nonzero-based /
 *  non-constant array ranges are reported: the synthesizer maps word k ↔ address k, so it needs `[0:W-1]`. */
function depthRange(inner: Tok[]): { depth: number } | { bad: string } {
  // Only bare integer bounds — a parameterized `[0:DEPTH-1]` has two num tokens (0 and 1) and would otherwise
  // slip through as a silently-wrong 2-word memory.
  if (inner.some((t) => t.k !== 'num' && t.v !== ':'))
    return { bad: 'non-constant array range (parameterized depth is unsupported)' }
  const nums = inner.filter((t) => t.k === 'num')
  if (!inner.some((t) => t.v === ':') || nums.length !== 2)
    return { bad: 'non-constant or malformed array range' }
  const lo = intLiteral((nums[0] as Tok).v)
  const hi = intLiteral((nums[1] as Tok).v)
  if (lo === undefined || hi === undefined) return { bad: 'non-integer array bound' }
  if (lo !== 0 || hi < lo)
    return { bad: `array range [${lo}:${hi}] must be [0:N-1] (ascending, zero-based)` }
  return { depth: hi + 1 }
}

/** Read a memory depth range at the cursor (positioned at the second `[`); leaves it just past `]`. */
function readDepthRange(c: Cursor): { depth: number } | { bad: string } {
  c.next() // '['
  const inner: Tok[] = []
  while (!c.atEnd() && !c.is(']') && !c.is(';')) inner.push(c.next() as Tok)
  if (c.is(']')) c.next()
  return depthRange(inner)
}

/** A tiny cursor over the token stream. */
class Cursor {
  i = 0
  constructor(readonly toks: Tok[]) {}
  peek(o = 0): Tok | undefined {
    return this.toks[this.i + o]
  }
  next(): Tok | undefined {
    return this.toks[this.i++]
  }
  atEnd(): boolean {
    return this.i >= this.toks.length
  }
  is(v: string): boolean {
    return this.peek()?.v === v
  }
}

/** Skip a construct we don't model: advance past its terminating `;`, honoring begin/end + paren/bracket
 *  nesting, and stopping (without consuming) at `endmodule`. Keeps behavioral blocks from corrupting the parse. */
function skipStatement(c: Cursor): void {
  let paren = 0
  let begin = 0
  while (!c.atEnd()) {
    const t = c.peek() as Tok
    if (t.v === 'endmodule' && begin === 0) return
    c.next()
    if (t.k === 'p' && (t.v === '(' || t.v === '[')) paren += 1
    else if (t.k === 'p' && (t.v === ')' || t.v === ']')) paren = Math.max(0, paren - 1)
    else if (t.k === 'kw' && t.v === 'begin') begin += 1
    else if (t.k === 'kw' && t.v === 'end') {
      begin -= 1
      if (begin <= 0) return
    } else if (t.k === 'p' && t.v === ';' && paren === 0 && begin === 0) {
      // An unbraced `if (…) …; else …;` is ONE statement: the else-branch after this ';' belongs to it, so
      // keep skipping rather than leaving it to be misread as a separate (bogus) construct.
      if (c.peek()?.v === 'else') continue
      return
    }
  }
}

/** Read a `(`-delimited group, returning depth-0 comma-separated slices (each a token list). Cursor must be
 *  AT the opening `(`; leaves it just past the matching `)`. An empty `()` returns []. */
function readGroup(c: Cursor): Tok[][] {
  const slices: Tok[][] = []
  let cur: Tok[] = []
  c.next() // consume '('
  let depth = 1
  while (!c.atEnd() && depth > 0) {
    const t = c.next() as Tok
    if (t.k === 'p' && (t.v === '(' || t.v === '[' || t.v === '{')) depth += 1
    else if (t.k === 'p' && (t.v === ')' || t.v === ']' || t.v === '}')) {
      depth -= 1
      if (depth === 0) break
    }
    if (depth === 1 && t.k === 'p' && t.v === ',') {
      slices.push(cur)
      cur = []
    } else cur.push(t)
  }
  slices.push(cur)
  if (slices.length === 1 && (slices[0] as Tok[]).length === 0) return []
  return slices
}

function reportDirective(t: Tok, warnings: string[]): void {
  const benign = new Set([
    'timescale',
    'resetall',
    'celldefine',
    'endcelldefine',
    'default_nettype',
  ])
  if (benign.has(t.v)) return // metadata-only; safe to ignore
  warnings.push(
    `compiler directive \`${t.v} is not applied — its effect on the source is unmodeled`,
  )
}

/** Parse the first module in the source, collecting parse-time warnings. */
function parseModule(toks: Tok[], warnings: string[]): ParsedModule | null {
  const c = new Cursor(toks)
  while (!c.atEnd() && !c.is('module')) {
    const t = c.next() as Tok
    if (t.k === 'dir') reportDirective(t, warnings)
  }
  if (c.atEnd()) return null
  c.next() // 'module'
  const nameTok = c.next()
  if (nameTok === undefined || (nameTok.k !== 'id' && nameTok.k !== 'kw')) return null

  const dir = new Map<string, 'input' | 'output' | 'inout'>()
  const portOrder: string[] = []
  const widths = new Map<string, number>()
  const mems = new Map<string, MemInfo>()
  if (c.is('(')) parseHeader(readGroup(c), portOrder, dir, widths, warnings)
  if (c.is(';')) c.next()

  const gates: GateInst[] = []
  const assigns: Assign[] = []
  const alwaysBlocks: AlwaysBlock[] = []
  while (!c.atEnd() && !c.is('endmodule')) {
    const t = c.peek() as Tok
    if (t.k === 'dir') {
      reportDirective(c.next() as Tok, warnings)
      continue
    }
    if (t.k === 'kw' && (t.v === 'input' || t.v === 'output' || t.v === 'inout')) {
      parsePortDecl(c, dir, widths, warnings)
      continue
    }
    if (t.k === 'kw' && (t.v === 'wire' || t.v === 'reg')) {
      // `reg [n:0] x;` captures a width like `wire`; `reg [d:0] m [0:w-1];` captures a memory
      parseNetDecl(c, widths, mems, warnings)
      continue
    }
    if (t.k === 'kw' && t.v === 'assign') {
      assigns.push(...parseAssigns(c))
      continue
    }
    if (t.k === 'kw' && t.v === 'always') {
      // A posedge-clocked always is CAPTURED for sequential synthesis; anything else (async reset, negedge,
      // combinational @*, multiple edges) falls through to the behavioral report below.
      const block = parseAlways(c, warnings)
      if (block !== null) alwaysBlocks.push(block)
      continue
    }
    if (t.k === 'kw' && (N_INPUT[t.v] !== undefined || N_OUTPUT[t.v] !== undefined)) {
      parseGateStatement(c, gates, warnings)
      continue
    }
    if (t.k === 'kw' && OTHER_GATE_SWITCH.has(t.v)) {
      warnings.push(
        `line ${t.line}: primitive "${t.v}" has no ChipBlocks gate — reported, not built`,
      )
      c.next()
      skipStatement(c)
      continue
    }
    if (t.k === 'kw' && RESOLVED_NETS.includes(t.v)) {
      warnings.push(
        `line ${t.line}: net type "${t.v}" carries resolution a ChipBlocks wire can't model — reported`,
      )
      c.next()
      skipStatement(c)
      continue
    }
    if (t.k === 'kw' && BEHAVIORAL.includes(t.v)) {
      warnings.push(
        `line ${t.line}: "${t.v}" is a behavioral/non-structural construct — reported, not built`,
      )
      c.next()
      skipStatement(c)
      continue
    }
    if (t.k === 'id') {
      warnings.push(
        `line ${t.line}: instance "${t.v}" is a module/UDP, not a gate primitive — reported, not built`,
      )
      c.next()
      skipStatement(c)
      continue
    }
    c.next() // stray token — advance so the loop can never spin
  }
  // The synthesizer is unsigned-only; a `signed` net would compute the wrong result for */comparisons/shifts,
  // so flag it rather than silently treat it as unsigned.
  if (toks.some((t) => t.k === 'kw' && t.v === 'signed'))
    warnings.push(
      'signed values are treated as UNSIGNED — reported (signed arithmetic is a later increment)',
    )
  return { name: nameTok.v, portOrder, dir, gates, assigns, alwaysBlocks, flops: [], widths, mems }
}

/** Parse `always @(posedge <clk>) <body>`. Returns the captured block, or null (reporting a warning) for any
 *  always the sequential synthesizer can't build: async reset, negedge, combinational @*, multiple edges. */
function parseAlways(c: Cursor, warnings: string[]): AlwaysBlock | null {
  const line = c.peek()?.line ?? 0
  c.next() // 'always'
  const report = (why: string): null => {
    warnings.push(`line ${line}: always block — ${why} — reported, not built`)
    skipStatement(c)
    return null
  }
  if (!c.is('@')) return report('only edge-triggered @(posedge clk) blocks are synthesized')
  c.next() // '@'
  if (c.is('*'))
    return report('combinational always @* is not supported (only clocked @(posedge clk))')
  if (!c.is('(')) return report('sensitivity list must be @(posedge clk)')
  const sens = readGroup(c) // depth-0 comma-separated slices inside @( … )
  const flat = sens.flat()
  // exactly `posedge <id>` — no `or`/comma (multiple/async — readGroup splits commas into separate slices),
  // no `negedge`, no `*`
  if (flat.some((t) => t.v === 'negedge'))
    return report('negedge clocks are not supported (the flip-flop is positive-edge)')
  if (sens.length > 1 || flat.some((t) => t.v === 'or'))
    return report('multiple sensitivity signals (e.g. an async reset) are not supported')
  if (flat.some((t) => t.v === '*'))
    return report('combinational always @(*) is not supported (only clocked @(posedge clk))')
  const posedgeIdx = flat.findIndex((t) => t.v === 'posedge')
  if (posedgeIdx === -1) return report('only @(posedge clk) is supported')
  const clkTok = flat[posedgeIdx + 1]
  if (clkTok === undefined || clkTok.k !== 'id')
    return report('the clock must be a simple net after posedge')
  // Capture the body as ONE complete procedural statement (begin…end, if/else, and case…endcase aware) — the
  // always body is a single statement, so stopping at the first ';' would truncate a multi-statement block.
  const body: Tok[] = []
  readStatementSpan(c, body)
  return { clk: clkTok.v, body, line }
}

/** Append one complete procedural statement's tokens to `out`: a begin…end block, an if/else (both branches),
 *  a case…endcase, or a plain statement up to its ';'. Nesting-aware so the synthesizer sees the whole body. */
function readStatementSpan(c: Cursor, out: Tok[]): void {
  if (c.atEnd()) return
  const t = c.peek() as Tok
  if (t.v === 'begin') {
    out.push(c.next() as Tok)
    let depth = 1
    while (!c.atEnd() && depth > 0) {
      const x = c.next() as Tok
      if (x.k === 'kw' && x.v === 'begin') depth += 1
      else if (x.k === 'kw' && x.v === 'end') depth -= 1
      out.push(x)
    }
    return
  }
  if (t.v === 'case' || t.v === 'casex' || t.v === 'casez') {
    out.push(c.next() as Tok)
    let depth = 1
    while (!c.atEnd() && depth > 0) {
      const x = c.next() as Tok
      if (x.v === 'case' || x.v === 'casex' || x.v === 'casez') depth += 1
      else if (x.v === 'endcase') depth -= 1
      out.push(x)
    }
    return
  }
  if (t.v === 'if') {
    out.push(c.next() as Tok) // 'if'
    if (c.is('(')) {
      out.push(c.next() as Tok) // '('
      let d = 1
      while (!c.atEnd() && d > 0) {
        const x = c.next() as Tok
        if (x.v === '(') d += 1
        else if (x.v === ')') d -= 1
        out.push(x)
      }
    }
    readStatementSpan(c, out) // then-branch
    if (c.is('else')) {
      out.push(c.next() as Tok)
      readStatementSpan(c, out) // else-branch
    }
    return
  }
  // Procedural loops (for/while/repeat have a (…) header + a body; forever is just a body). The synthesizer
  // rejects these, but the WHOLE statement must be captured so its inner ';'s don't spill into the parse.
  if (t.v === 'for' || t.v === 'while' || t.v === 'repeat' || t.v === 'forever') {
    out.push(c.next() as Tok)
    if (t.v !== 'forever' && c.is('(')) {
      out.push(c.next() as Tok) // '('
      let d = 1
      while (!c.atEnd() && d > 0) {
        const x = c.next() as Tok
        if (x.v === '(') d += 1
        else if (x.v === ')') d -= 1
        out.push(x)
      }
    }
    readStatementSpan(c, out) // loop body
    return
  }
  while (!c.atEnd() && !c.is(';')) out.push(c.next() as Tok)
  if (c.is(';')) out.push(c.next() as Tok)
}

/** Parse `assign <lhs> = <rhs> {, <lhs> = <rhs>} ;` into one Assign per comma-separated assignment. lhs and
 *  rhs are captured as raw token spans; the synthesizer (verilog-synth.ts) parses + sizes + lowers them. */
function parseAssigns(c: Cursor): Assign[] {
  c.next() // 'assign'
  const out: Assign[] = []
  for (;;) {
    const line = c.peek()?.line ?? 0
    const lhs: Tok[] = []
    while (!c.atEnd() && c.peek()?.v !== '=' && c.peek()?.v !== ';') lhs.push(c.next() as Tok)
    if (c.peek()?.v !== '=') {
      skipStatement(c)
      break
    }
    c.next() // '='
    const rhs: Tok[] = []
    let depth = 0
    while (!c.atEnd()) {
      const t = c.peek() as Tok
      if (t.k === 'p' && (t.v === '(' || t.v === '[' || t.v === '{')) depth += 1
      else if (t.k === 'p' && (t.v === ')' || t.v === ']' || t.v === '}'))
        depth = Math.max(0, depth - 1)
      else if (depth === 0 && (t.v === ';' || t.v === ',')) break
      rhs.push(c.next() as Tok)
    }
    out.push({ lhs, rhs, line })
    const sep = c.peek()?.v
    c.next() // consume ',' (more assignments) or ';' (done)
    if (sep !== ',') break
  }
  return out
}

/** Header ports: ANSI (directions inline) or non-ANSI (bare id list, directions come from body decls). */
function parseHeader(
  slices: Tok[][],
  portOrder: string[],
  dir: Map<string, 'input' | 'output' | 'inout'>,
  widths: Map<string, number>,
  warnings: string[],
): void {
  const ansi = slices.some(
    (s) => s[0] !== undefined && ['input', 'output', 'inout'].includes(s[0].v),
  )
  // In an ANSI header a direction keyword governs every following bare identifier until the NEXT direction
  // keyword — `input a, b, output o` declares a AND b as inputs. So `d` persists across the comma-separated
  // slices; the range resets when a new direction keyword appears.
  let d: 'input' | 'output' | 'inout' | undefined
  let width: number | 'bad' | undefined
  for (const s of slices) {
    if (s.length === 0) {
      warnings.push('null port position (empty port) is not representable — skipped')
      continue
    }
    if (!ansi) {
      const id = s.find((t) => t.k === 'id')
      if (id !== undefined) portOrder.push(id.v)
      else
        warnings.push(
          'port expression (concat/bit-select) in the header is not representable — skipped',
        )
      continue
    }
    for (let i = 0; i < s.length; i++) {
      const t = s[i] as Tok
      if (t.k === 'kw' && (t.v === 'input' || t.v === 'output' || t.v === 'inout')) {
        d = t.v
        width = undefined
      } else if (t.k === 'p' && t.v === '[') {
        const inner: Tok[] = []
        i += 1
        while (i < s.length && s[i]?.v !== ']') inner.push(s[i++] as Tok)
        const r = rangeWidth(inner)
        width = 'bad' in r ? 'bad' : r.width
        if ('bad' in r) warnings.push(`vector/bus header port range — ${r.bad} — skipped`)
      } else if (t.k === 'id') {
        if (width === 'bad') {
          warnings.push(`vector/bus port "${t.v}" has an unsupported range — skipped`)
          continue
        }
        if (d === undefined) continue
        if (d === 'inout') {
          warnings.push(`inout port "${t.v}" (bidirectional) is not representable — skipped`)
          continue
        }
        portOrder.push(t.v)
        dir.set(t.v, d)
        if (typeof width === 'number' && width > 1) widths.set(t.v, width)
      }
    }
  }
}

function parsePortDecl(
  c: Cursor,
  dir: Map<string, 'input' | 'output' | 'inout'>,
  widths: Map<string, number>,
  warnings: string[],
): void {
  const d = (c.next() as Tok).v as 'input' | 'output' | 'inout'
  let width: number | 'bad' | undefined // the pending `[N:0]` range for the following ids
  while (!c.atEnd() && !c.is(';')) {
    const t = c.peek() as Tok
    if (t.v === '=') {
      warnings.push(
        `line ${t.line}: port-declaration continuous assignment (${d} … = …) is behavioral/non-structural — reported, not built`,
      )
      while (!c.atEnd() && !c.is(';')) c.next()
      break
    }
    if (t.k === 'p' && t.v === '[') {
      const r = readRange(c)
      width = 'bad' in r ? 'bad' : r.width
      if ('bad' in r) warnings.push(`line ${t.line}: bus range on "${d}" — ${r.bad} — reported`)
      continue
    }
    c.next()
    if (t.k !== 'id') continue
    if (width === 'bad') {
      warnings.push(`vector/bus port "${t.v}" has an unsupported range — skipped`)
      continue
    }
    if (d === 'inout') {
      warnings.push(`inout port "${t.v}" (bidirectional) is not representable — skipped`)
      continue
    }
    dir.set(t.v, d)
    if (typeof width === 'number' && width > 1) widths.set(t.v, width)
  }
  if (c.is(';')) c.next()
}

function parseNetDecl(
  c: Cursor,
  widths: Map<string, number>,
  mems: Map<string, MemInfo>,
  warnings: string[],
): void {
  c.next() // 'wire' or 'reg'
  let width: number | 'bad' | undefined
  while (!c.atEnd() && !c.is(';')) {
    const t = c.peek() as Tok
    if (t.v === '=') {
      warnings.push(
        `line ${t.line}: net-declaration continuous assignment (wire … = …) is behavioral/non-structural — reported, not built`,
      )
      while (!c.atEnd() && !c.is(';')) c.next()
      break
    }
    if (t.k === 'p' && t.v === '[') {
      const r = readRange(c)
      width = 'bad' in r ? 'bad' : r.width
      if ('bad' in r) warnings.push(`line ${t.line}: bus wire range — ${r.bad} — reported`)
      continue
    }
    c.next()
    if (t.k !== 'id') continue
    // A SECOND range after the id makes this a MEMORY (`reg [D-1:0] m [0:W-1]`): the first range gives the
    // word width, this one the depth. Register it as an array (not a plain bus) so mem[addr] can read/write it.
    if (c.is('[')) {
      const dr = readDepthRange(c)
      if ('bad' in dr) {
        warnings.push(
          `line ${t.line}: memory "${t.v}" array range — ${dr.bad} — reported, not built`,
        )
        continue
      }
      if (width === 'bad') {
        warnings.push(`line ${t.line}: memory "${t.v}" has an unsupported word range — reported`)
        continue
      }
      mems.set(t.v, { width: typeof width === 'number' ? width : 1, depth: dr.depth })
      continue
    }
    if (typeof width === 'number' && width > 1) widths.set(t.v, width)
  }
  if (c.is(';')) c.next()
}

/** Parse one gate statement: `gatetype [strength] [delay] inst {, inst} ;` — possibly several instances. */
function parseGateStatement(c: Cursor, gates: GateInst[], warnings: string[]): void {
  const prim = (c.next() as Tok).v
  if (c.is('(') && looksLikeStrength(c)) {
    const g = readGroup(c)
    if (!isDefaultStrength(g))
      warnings.push(
        `drive strength on "${prim}" is unmodeled (ChipBlocks gates have fixed drive) — reported`,
      )
  }
  if (c.is('#')) {
    warnings.push(`gate delay on "${prim}" is unmodeled — reported`)
    c.next()
    if (c.is('(')) readGroup(c)
    else c.next()
  }
  for (;;) {
    if (c.peek()?.k === 'id' && c.peek(1)?.v === '(')
      c.next() // optional instance name
    else if (c.peek()?.k === 'id' && c.peek(1)?.v === '[') {
      warnings.push(`instance array on "${prim}" is unmodeled — reported`)
      c.next()
      skipStatement(c)
      return
    }
    if (!c.is('(')) {
      skipStatement(c)
      return
    }
    const line = c.peek()?.line ?? 0
    const slices = readGroup(c)
    const terminals: string[] = []
    let clean = true
    for (const s of slices) {
      if (s.length === 1 && s[0]?.k === 'id') terminals.push((s[0] as Tok).v)
      else clean = false
    }
    if (!clean || terminals.length < 2) {
      warnings.push(
        `line ${line}: a "${prim}" terminal is not a plain net (constant/expression/concat) — instance reported, not built`,
      )
    } else {
      gates.push({ prim, terminals })
    }
    if (c.is(',')) {
      c.next()
      continue
    }
    if (c.is(';')) {
      c.next()
      return
    }
    return
  }
}

/** Is the group at the cursor a drive-strength pair? (one 0-side + one 1-side reserved strength keyword.) */
function looksLikeStrength(c: Cursor): boolean {
  const a = c.peek(1)
  const b = c.peek(3)
  if (a === undefined || b === undefined) return false
  return (STRENGTH0.has(a.v) && STRENGTH1.has(b.v)) || (STRENGTH1.has(a.v) && STRENGTH0.has(b.v))
}
function isDefaultStrength(g: Tok[][]): boolean {
  const flat = g.flat().map((t) => t.v)
  return flat.length === 2 && flat.includes('strong0') && flat.includes('strong1')
}

// ── lowering: parsed gates → composite BlockData ──────────────────────────────
type Pin = { nodeId: string; pin: string; isOut: boolean }
/** A cell's pin bound to a net, before node ids exist — the adder turns these into `Pin` endpoints. */
type PinSpec = { pin: string; net: string; isOut: boolean }
type AddNode = (block: BlockData, pins: PinSpec[]) => void

/** Lower an n_input gate (and/or/nand/nor/xor/xnor) to real 2-input ChipBlocks cells. */
function lowerNInput(
  g: GateInst,
  ni: { base: BlockData; native: BlockData; invert: boolean },
  add: AddNode,
  newNet: () => string,
): void {
  const out = g.terminals[0] as string
  const ins = g.terminals.slice(1)
  if (ins.length === 1) {
    // degenerate 1-input: and/or/xor(o,a)=a → buffer; nand/nor/xnor(o,a)=~a → inverter
    add(ni.invert ? INVERTER_BLOCK : BUFFER_BLOCK, [
      { pin: 'in', net: ins[0] as string, isOut: false },
      { pin: 'out', net: out, isOut: true },
    ])
    return
  }
  if (ins.length === 2) {
    add(ni.native, [
      { pin: 'a', net: ins[0] as string, isOut: false },
      { pin: 'b', net: ins[1] as string, isOut: false },
      { pin: 'out', net: out, isOut: true },
    ])
    return
  }
  // N>2: reduce all inputs with the associative base gate, then invert exactly once if needed
  let acc = ins[0] as string
  for (let k = 1; k < ins.length; k++) {
    const last = k === ins.length - 1 && !ni.invert
    const o = last ? out : newNet()
    add(ni.base, [
      { pin: 'a', net: acc, isOut: false },
      { pin: 'b', net: ins[k] as string, isOut: false },
      { pin: 'out', net: o, isOut: true },
    ])
    acc = o
  }
  if (ni.invert)
    add(INVERTER_BLOCK, [
      { pin: 'in', net: acc, isOut: false },
      { pin: 'out', net: out, isOut: true },
    ])
}

/** Lower an n_output gate (not/buf): the LAST terminal is the shared input; each earlier terminal is a
 *  separate inverted/buffered output. */
function lowerNOutput(g: GateInst, cell: BlockData, add: AddNode): void {
  const input = g.terminals[g.terminals.length - 1] as string
  for (let k = 0; k < g.terminals.length - 1; k++) {
    add(cell, [
      { pin: 'in', net: input, isOut: false },
      { pin: 'out', net: g.terminals[k] as string, isOut: true },
    ])
  }
}

/** Lower the parsed module to a composite BlockData of real ChipBlocks gate cells, or null if it holds none. */
function lower(mod: ParsedModule, warnings: string[]): BlockData | null {
  const nodes: BlockInnerNode[] = []
  const endpoints = new Map<string, Pin[]>()
  let gid = 0
  let freshNet = 0
  const usedNets = new Set<string>()
  for (const g of mod.gates) for (const t of g.terminals) usedNets.add(t)
  for (const f of mod.flops) for (const t of [f.d, f.clk, f.q]) usedNets.add(t)
  for (const p of mod.portOrder) usedNets.add(p)
  const newNet = (): string => {
    let name = `w_${freshNet++}`
    while (usedNets.has(name)) name = `w_${freshNet++}`
    usedNets.add(name)
    return name
  }
  const add: AddNode = (block, pins) => {
    const id = `g${gid++}`
    nodes.push({ id, definition: 'block', x: 0, y: 0, block })
    for (const p of pins) {
      const list = endpoints.get(p.net) ?? []
      list.push({ nodeId: id, pin: p.pin, isOut: p.isOut })
      endpoints.set(p.net, list)
    }
  }

  for (const g of mod.gates) {
    const ni = N_INPUT[g.prim]
    if (ni !== undefined) {
      lowerNInput(g, ni, add, newNet)
      continue
    }
    const cell = N_OUTPUT[g.prim]
    if (cell !== undefined) lowerNOutput(g, cell, add)
  }
  // Sequential elements: one real positive-edge D flip-flop per registered bit. Its D-net is always a fresh
  // name distinct from its Q-net, so the flop is a COMBINATIONAL CUT — the register→D-logic→register feedback
  // closes only through net naming and resolves temporally across clocks (never a combinational loop). v_dd/gnd
  // are re-chained with the gates below; qbar is left unconnected (no design reads it).
  for (const f of mod.flops) {
    add(D_FLIPFLOP_BLOCK, [
      { pin: 'd', net: f.d, isOut: false },
      { pin: 'clk', net: f.clk, isOut: false },
      { pin: 'q', net: f.q, isOut: true },
    ])
  }
  if (nodes.length === 0) return null

  // edges: wire every net's endpoints to a representative (the driver, if the net has one)
  const edges: BlockInnerEdge[] = []
  let eid = 0
  for (const pins of endpoints.values()) {
    if (pins.length < 2) continue
    const rep = pins.find((p) => p.isOut) ?? (pins[0] as Pin)
    for (const p of pins) {
      if (p === rep) continue
      edges.push({
        id: `e${eid++}`,
        source: rep.nodeId,
        sourceHandle: rep.pin,
        target: p.nodeId,
        targetHandle: p.pin,
      })
    }
  }
  // re-synthesize the power rails the powerless Verilog gates dropped: chain V+/GND across every cell
  for (let k = 1; k < nodes.length; k++) {
    const prev = nodes[k - 1] as BlockInnerNode
    const here = nodes[k] as BlockInnerNode
    edges.push({
      id: `vdd${k}`,
      source: prev.id,
      sourceHandle: 'v_dd',
      target: here.id,
      targetHandle: 'v_dd',
    })
    edges.push({
      id: `gnd${k}`,
      source: prev.id,
      sourceHandle: 'gnd',
      target: here.id,
      targetHandle: 'gnd',
    })
  }

  const ports = buildPorts(mod, endpoints, nodes[0] as BlockInnerNode, warnings)
  place(nodes, endpoints)

  // Guard the module name: if it collides with a built-in gate-cell name, `isLogicGate` would treat this
  // composite as that leaf gate and simulate it BY NAME, discarding its real cells. A genuine single native
  // cell of that name is fine (a faithful gate round-trip); a mismatch is renamed so it simulates by its gates.
  let name = mod.name
  const singleCellName = nodes.length === 1 ? nodes[0]?.block?.name : undefined
  if (PRIMITIVE_NAMES.has(name) && singleCellName !== name) {
    const safe = `${name}_mod`
    warnings.push(
      `module "${name}" shares a name with a built-in gate primitive but its gates compute something else — renamed to "${safe}" so it simulates by its real cells, not by name`,
    )
    name = safe
  }
  return { name, origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** Module interface: each declared port → a BlockPort pointing at a gate pin on its net. Power rails are
 *  re-exposed as v_dd/gnd so the block is drivable (and characterizable) like any built-in gate. */
function buildPorts(
  mod: ParsedModule,
  endpoints: Map<string, Pin[]>,
  first: BlockInnerNode,
  warnings: string[],
): BlockPort[] {
  const ports: BlockPort[] = []
  const usedIds = new Set<string>(['v_dd', 'gnd'])
  let leftOff = 14
  let rightOff = 14
  for (const name of mod.portOrder) {
    const pins = endpoints.get(name)
    if (pins === undefined || pins.length === 0) {
      warnings.push(`port "${name}" is not connected to any gate — omitted from the interface`)
      continue
    }
    const d = mod.dir.get(name)
    if (d === undefined)
      warnings.push(`port "${name}" has no input/output declaration — treated as input`)
    const isOut = d === 'output'
    const rep = (isOut ? pins.find((p) => p.isOut) : pins.find((p) => !p.isOut)) ?? (pins[0] as Pin)
    // A signal port named like a power rail (gnd/vdd/vcc/…) would be swallowed by the re-synthesized
    // rails (and collide with the v_dd/gnd port ids), so give it a distinct id while keeping its label.
    let id = name
    if (POWER_PORT_IDS.has(name.toLowerCase()) || usedIds.has(id)) {
      let safe = `sig_${name}`
      let k = 1
      while (usedIds.has(safe)) safe = `sig_${name}_${k++}`
      warnings.push(
        `port "${name}" collides with a power rail — exposed as "${safe}" to keep it a real signal`,
      )
      id = safe
    }
    usedIds.add(id)
    const port: BlockPort = {
      id,
      label: name,
      name,
      // The declared direction is authoritative: mark inputs explicitly so a name in OUTPUT_PORT_IDS
      // (out/q/s/sum/carry/…) can't reclassify a genuine input as an output.
      drive: isOut ? 'push_pull' : 'input',
      side: isOut ? 'right' : 'left',
      offset: isOut ? rightOff : leftOff,
      inner: { nodeId: rep.nodeId, handleId: rep.pin },
    }
    if (isOut) rightOff += 22
    else leftOff += 22
    ports.push(port)
  }
  ports.push({
    id: 'v_dd',
    label: 'V+',
    name: 'V+',
    side: 'right',
    offset: rightOff,
    inner: { nodeId: first.id, handleId: 'v_dd' },
  })
  ports.push({
    id: 'gnd',
    label: 'GND',
    name: 'GND',
    side: 'left',
    offset: leftOff,
    inner: { nodeId: first.id, handleId: 'gnd' },
  })
  return ports
}

/** Deterministic left-to-right placement by logic depth (a gate sits one column right of its deepest driver). */
function place(nodes: BlockInnerNode[], endpoints: Map<string, Pin[]>): void {
  const driverOf = new Map<string, string>()
  const inputsOf = new Map<string, string[]>()
  for (const [net, pins] of endpoints) {
    for (const p of pins) {
      if (p.isOut) driverOf.set(net, p.nodeId)
      else inputsOf.set(p.nodeId, [...(inputsOf.get(p.nodeId) ?? []), net])
    }
  }
  // Iterative (explicit-stack) post-order depth so a deep chain (thousands of cells) can't overflow the
  // native call stack. memo caches settled depths; onStack breaks cross-coupled cycles (contribute 0).
  const memo = new Map<string, number>()
  const depth = (start: string): number => {
    const stack = [start]
    const onStack = new Set<string>()
    while (stack.length > 0) {
      const id = stack[stack.length - 1] as string
      if (memo.has(id)) {
        stack.pop()
        continue
      }
      onStack.add(id)
      let ready = true
      let d = 0
      for (const net of inputsOf.get(id) ?? []) {
        const drv = driverOf.get(net)
        if (drv === undefined || drv === id) continue
        const cached = memo.get(drv)
        if (cached !== undefined) d = Math.max(d, cached + 1)
        else if (!onStack.has(drv)) {
          ready = false
          stack.push(drv)
        }
      }
      if (ready) {
        memo.set(id, d)
        onStack.delete(id)
        stack.pop()
      }
    }
    return memo.get(start) ?? 0
  }
  const slot = new Map<number, number>()
  for (const nd of nodes) {
    const d = depth(nd.id)
    const s = slot.get(d) ?? 0
    slot.set(d, s + 1)
    nd.x = 40 + d * 240
    nd.y = 30 + s * 150
  }
}

/**
 * Import structural Verilog into a placed ChipBlocks gate design. Returns the composite block (null if the
 * text has no buildable gate primitives) plus every honest warning about what could not be represented.
 */
export function importVerilog(text: string): ImportResult {
  const { tokens, warnings } = lex(text)
  const moduleCount = tokens.filter((t) => t.k === 'kw' && t.v === 'module').length
  if (moduleCount > 1)
    warnings.push(
      `${moduleCount} modules found; only the first is imported (hierarchy is a later step)`,
    )
  const mod = parseModule(tokens, warnings)
  if (mod === null) {
    warnings.push('no module declaration found')
    return { block: null, warnings, moduleName: null }
  }
  // Synthesize behavioral RTL — continuous assignments into gates and clocked always-blocks into flip-flops
  // + next-state gates (both appended to mod) — then lower everything.
  synthesizeBehavioral(mod, warnings)
  const block = lower(mod, warnings)
  if (block === null) warnings.push(`module "${mod.name}" has no gate primitives to build`)
  return { block, warnings, moduleName: mod.name }
}
