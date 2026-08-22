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
  D_FLIPFLOP_CLEAR_BLOCK,
  INVERTER_BLOCK,
  NAND2_BLOCK,
  NOR2_BLOCK,
  OR_BLOCK,
  XNOR_BLOCK,
  XOR_BLOCK,
} from './builtin-blocks.ts'
import { POWER_PORT_IDS } from './logic-sim.ts'
import { YOSYS_CELLS } from './verilog-cells.ts'
import {
  asInteger,
  type ConstVal,
  evalConst,
  extendTo,
  loopAdvance,
  loopContinues,
  loopCounter,
  MAX_WIDTH,
  splitOnColon,
  substituteCounter,
} from './verilog-const.ts'
import { elaborateGenerate, generateRegionInfo } from './verilog-generate.ts'
import { chooseTopModule, flattenHierarchy } from './verilog-hierarchy.ts'
import { synthesizeBehavioral } from './verilog-synth.ts'

export type ImportResult = {
  block: BlockData | null
  warnings: string[]
  moduleName: string | null
}

/** One file of a design that spans several. `name` is what a warning about this file calls it. */
export type VerilogSource = { name: string; text: string }

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
/** Every net-declaration keyword. All of them declare a NET (so a `= expr` initializer is a continuous
 *  drive, and a range sizes a bus); they differ only in how several drivers on one net resolve. */
export const NET_TYPES = new Set(['wire', ...RESOLVED_NETS, 'supply0', 'supply1'])
/** The net types that COMBINE their drivers instead of contending. Resolving several drivers is the whole
 *  point of these, so reporting them as a multiple-driver conflict states the opposite of what they mean. */
const NET_RESOLUTION: Record<string, 'or' | 'and'> = {
  wor: 'or',
  trior: 'or',
  wand: 'and',
  triand: 'and',
}
/** Net types whose extra behaviour is a VALUE this two-valued netlist has no way to produce: `tri0`/`tri1`
 *  pull to a level when nothing drives them, and `trireg` holds the last value driven onto it. */
const UNMODELED_NETS: Record<string, string> = {
  tri0: 'pulls to 0 when nothing drives it',
  tri1: 'pulls to 1 when nothing drives it',
  trireg: 'stores its last driven value on the net itself',
}
/** `supply0`/`supply1` written on a PORT. A net declaration turns these into a real constant drive, but the
 *  two port paths are parsed before the assignment list exists, so there is nowhere to put that drive. The
 *  port is claimed instead of quietly published as an ordinary undriven wire. */
const UNMODELED_PORT_NETS: Record<string, string> = {
  supply0: 'ties it permanently to 0 — a drive this importer builds only from a net declaration',
  supply1: 'ties it permanently to 1 — a drive this importer builds only from a net declaration',
}
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
/** Declarations that introduce something which is NOT a net: a generate loop index, a procedural variable,
 *  a named event, a timing constant. None of them can be a gate terminal, so skipping the declaration itself
 *  drives nothing — an `integer` written by an always block is still handled by that block. Without this they
 *  parsed as failed module instantiations, which now (rightly) makes a design unbuildable. */
export const NON_NET_DECLS = ['genvar', 'integer', 'real', 'realtime', 'time', 'event', 'specparam']
/**
 * What each variable TYPE keyword is worth — the ONE table every declaration site reads, so a function
 * argument, a function return, a local, a task argument, a module port and a module-scope variable cannot
 * disagree about what `integer` means.
 *
 * IEEE 1364-2005 §3.9 makes `integer` a SIGNED 32-bit variable and `time` an UNSIGNED 64-bit one — both
 * ordinary two-valued vectors, built exactly like a `reg` of that width and signedness. §3.10 makes `real`
 * and `realtime` IEEE-754 doubles, and a fraction has no bit pattern a two-valued net can carry, so those
 * two are refused BY NAME rather than quietly rounded.
 *
 * Both halves are measured against Icarus Verilog 14.0. Before this table existed, every site re-derived the
 * type from the leading keyword alone and missed it whenever a direction keyword came first: `input integer
 * k` built the argument ONE BIT wide with no warning at all, so `idf(7)` answered 1 where Icarus answers 7,
 * `addk(9,5)` answered 2 where Icarus answers 14, and `wf(-3)` answered 0x0001 where Icarus answers 0xfffd.
 * `real r; r = 7; r = r / 2; y = a + r;` built 3 where Icarus reads 3.5 and rounds the store to 4.
 */
export const VAR_TYPES = new Map<string, { width: number; signed: boolean } | 'floating-point'>([
  ['integer', { width: 32, signed: true }],
  ['time', { width: 64, signed: false }],
  ['real', 'floating-point'],
  ['realtime', 'floating-point'],
])
/** The 26 gate and switch primitives, as one set — the words that start a primitive INSTANTIATION rather
 *  than a declaration or an instantiation of a module. */
export const GATE_WORDS = new Set([
  ...Object.keys(N_INPUT),
  ...Object.keys(N_OUTPUT),
  ...OTHER_GATE_SWITCH,
])
const STRENGTH0 = new Set(['supply0', 'strong0', 'pull0', 'weak0', 'highz0'])
const STRENGTH1 = new Set(['supply1', 'strong1', 'pull1', 'weak1', 'highz1'])
/** The drive levels IEEE 1364-2005 §7.9 resolves two drivers of one net by, weakest first. `highz` is not the
 *  bottom of that ladder: a driver on its high-Z side is ABSENT from the resolution, not merely out-driven. */
export type StrengthLevel = 'highz' | 'weak' | 'pull' | 'strong' | 'supply'
/** A driver's strength is per SIDE — `one` is in force while it drives 1, `zero` while it drives 0 — so which
 *  of two drivers wins is not knowable from the strengths alone; it depends on what each is driving. */
export type DriveStrength = { one: StrengthLevel; zero: StrengthLevel }
const STRENGTH_LEVEL: Record<string, StrengthLevel> = {
  supply0: 'supply',
  supply1: 'supply',
  strong0: 'strong',
  strong1: 'strong',
  pull0: 'pull',
  pull1: 'pull',
  weak0: 'weak',
  weak1: 'weak',
  highz0: 'highz',
  highz1: 'highz',
}
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
  'supply0',
  'supply1',
  ...NON_NET_DECLS,
  ...RESOLVED_NETS,
  ...BEHAVIORAL,
  ...GATE_WORDS,
])

type Kind = 'id' | 'num' | 'kw' | 'p' | 'op' | 'dir' | 'sys' | 'str' | 'unk'
/** `escaped` marks an identifier written `\name ` — the lexer drops the backslash, so without this flag an
 *  escaped `\posedge ` would be indistinguishable from the syntax word `posedge`, which the parsers key on by
 *  value. Only the hierarchy flattener needs the distinction (it must rename the net and leave the word). */
export type Tok = { k: Kind; v: string; line: number; escaped?: true }

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
      tokens.push({ k: 'id', v: src.slice(i + 1, j), line, escaped: true })
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
/** `line` is the source line of a gate written in the source; a gate the SYNTHESIZER mints has none. It is
 *  carried so a contention between two structural gates can name where each was written. */
export type GateInst = {
  prim: string
  terminals: string[]
  line?: number | undefined
  strength?: DriveStrength | undefined
}
/** A gate primitive whose terminals are not all plain nets — `and g(t[0], a[0], b[0])`, `buf g(y, 1'b1)`,
 *  `xor g(y, {a[0]}, b)`. Ordinary Verilog, but the widths that turn `t[0]` into a bit-net live in the
 *  synthesizer, so the raw token spans travel there and are resolved with the machinery an `assign` uses. */
export type RawGate = {
  prim: string
  slices: Tok[][]
  line: number
  strength?: DriveStrength | undefined
}
/**
 * A driver the source WROTE that this importer will not build. It still owns the net bits it targets: a later
 * driver on those bits is a contention in the real hardware, not a lone driver, and publishing the later one
 * would invent a value. `terms` holds the target token spans (one per output terminal / connection), resolved
 * to bit-nets by the synthesizer, which is the only place that knows every net's width.
 *
 * `what` names the construct in plain English, because those bits are also UNBUILT: nothing downstream of
 * them may be published (see the transitive-unbuilt rule in verilog-synth.ts), and the refusal has to say
 * which construct caused it. `wholeModule` marks the case where the skipped construct could drive nets this
 * importer cannot even name — then the whole design is unbuilt, since there is no smaller honest answer.
 */
export type RefusedDriver = {
  where: string
  what: string
  terms: Tok[][]
  wholeModule?: true
}
/**
 * A continuous assignment `assign <lhs> = <rhs>;` captured as token spans; the synthesizer (verilog-synth)
 * parses the rhs into gates. `strength` is the source's drive strength (absent means the default strong/strong
 * — never "unknown" and never "weakest", or a plain assign would lose against every annotated one).
 *
 * `portJoin` marks an assignment the HIERARCHY FLATTENER minted to carry a sub-module port across the module
 * boundary, not one the source wrote. Real Verilog collapses a port onto the enclosing net, so the child's own
 * driver (with the child's own strength) contends directly with the parent's; this importer instead joins two
 * nets with a buffer that has no strength of its own. That buffer must never take part in a strength
 * resolution — it would carry the child's value at the WRONG strength — so a net it drives is left to the
 * ordinary contention rule.
 */
export type Assign = {
  lhs: Tok[]
  rhs: Tok[]
  line: number
  strength?: DriveStrength | undefined
  portJoin?: true
}
/** A register's POWER-ON contents, written `initial <reg> = <constant>;`. Not a driver: it says what the
 *  flip-flop holds before the first clock edge.
 *
 *  The expression travels UNFOLDED, because an assignment is a context and the context here is the register's
 *  DECLARED WIDTH — which only the synthesizer knows. Folding it here with no width applied the lossless
 *  `growWidth` that belongs to a parameter value, and that width contains the shift wall: `reg [7:0] r;
 *  initial r = 4'd8 << 1;` folded to 0 at four bits, matched the flip-flop's power-up 0, and BUILT — where
 *  Icarus Verilog 14.0 powers the register up holding 16. Truncating the folded value cannot repair it (0
 *  truncated to eight bits is still 0); the width has to reach the fold, so the tokens go instead.
 *
 *  `index` is the WORD an array power-on loads — `initial m[2] = 8'h33;`, which is how every real ROM is
 *  written. It is absent for the ordinary scalar form. The word number is resolved here (a loop over the
 *  array has to be unrolled to know which words it names at all) while the VALUE still travels unfolded, for
 *  the same reason: its context is the word's declared width, and only the synthesizer knows that. */
export type PowerOnValue = { name: string; expr: Tok[]; line: number; index?: number }
/** An always block captured as token spans; the synthesizer elaborates the body. `clk` is the clock net for a
 *  `@(posedge clk)` block (→ flip-flops) or null for a combinational `@(*)`/`@*`/`@(a or b)` block (→ gates). */
export type AlwaysBlock = {
  clk: string | null
  /** The second `posedge` net of `@(posedge clk or posedge reset)`. Which of the two is the RESET is decided
   *  by the body (the one the leading `if` tests), so both are carried here and the synthesizer picks. */
  reset: string | null
  body: Tok[]
  line: number
}
/** A synthesized flip-flop: its D-input net, clock net, and Q-output net (one per registered bit). `reset` is
 *  the asynchronous active-high CLEAR net when the block was written `@(posedge clk or posedge reset)`; the
 *  flop is then lowered as a real D_FLIPFLOP_CLEAR_BLOCK instead of a plain one. */
export type FlopInst = { d: string; clk: string; q: string; reset?: string }
/** A declared memory `reg [width-1:0] m [0:depth-1]` — `depth` words, each `width` bits. The synthesizer
 *  turns each word into real flip-flops and `m[addr]` into a decode/mux, exactly like the gate Data RAM. */
export type MemInfo = { width: number; depth: number }
/** A synthesizable Verilog `function`: its declared return width, its ordered inputs (each with a width), the
 *  widths of any local `reg`/`integer` variables, and the executable body tokens (the statements after the
 *  declarations). The synthesizer INLINES a call by materializing the args at each input's width, elaborating
 *  the body, and synthesizing the return value at `retWidth` — every width exact (see verilog-synth.ts). */
export type FuncDef = {
  name: string
  retWidth: number
  inputs: { name: string; width: number }[]
  localWidths: Map<string, number>
  /** Function-scoped names whose declared type is SIGNED — an `integer` local OR an `integer` argument, since
   *  IEEE 1364-2005 §3.9 makes both a SIGNED 32-bit variable where a `reg [31:0]` of the same width is
   *  unsigned. The loop unroller reads it (it must count at the exact declared type; `for (i = 3; i >= 0;
   *  i = i - 1)` terminates signed and never terminates unsigned) and so does every read of the name. */
  signedNames: Set<string>
  body: Tok[]
}
/** A synthesizable Verilog `task`: its ordered args (each with a direction + width), local widths, and body.
 *  The synthesizer INLINES a call inside a combinational always block — inputs bound at their width, outputs
 *  written back to the caller's signals (see verilog-synth.ts). */
export type TaskArg = { name: string; width: number; dir: 'input' | 'output' | 'inout' }
export type TaskDef = {
  name: string
  args: TaskArg[]
  localWidths: Map<string, number>
  /** Args and locals whose declared type is SIGNED — see FuncDef.signedNames. */
  signedNames: Set<string>
  body: Tok[]
}
/** One port connection on a module instance: `.port(expr)` (named) or just `expr` (positional, `port` null).
 *  An empty `expr` is a deliberately unconnected port — legal Verilog, reported by the flattener. */
export type PortConn = { port: string | null; expr: Tok[] }
/** One item of an instance's `#( … )` parameter override list: `.NAME(expr)` (named) or a bare `expr`
 *  (positional, `name` null). The expression is kept as raw tokens — it is folded by the flattener, in the
 *  ENCLOSING module's scope, because that is the scope the LRM evaluates it in. */
export type ParamOverride = { name: string | null; expr: Tok[]; line: number }
/** One `parameter`/`localparam` declaration, in source order. Both facts an override needs are here: a
 *  `localparam` can never be overridden (IEEE 1364-2005 §12.2), and when a module has a header `#( … )`
 *  parameter port list that list is the ONLY overridable one — a body `parameter` alongside it is not
 *  reachable by name or by position. Both rules were measured against Icarus Verilog 14.0, which rejects the
 *  first with "Cannot override localparam" and the second with "Parameter cannot be overridden in the scope
 *  it has been declared in". */
export type ParamDecl = { name: string; kind: 'parameter' | 'localparam'; inHeader: boolean }
/** Everything the flattener needs to decide whether an instance's `#( … )` list is legal for this module. */
export type ModuleParams = { decls: ParamDecl[]; hasHeader: boolean }
/** A `child u1(...)` sub-module instantiation, captured before any module table exists — whether `moduleName`
 *  names a module in this source is decided later, by the flattener. `unsupported` is a plain-English reason
 *  the instance cannot be built at all (an instance array, a `#( … )` list we cannot read); it is reported and
 *  the instance is skipped rather than built with the wrong parameters. `overrides` is null when no `#( … )`
 *  was written at all, which is not the same as an empty `#()` — the empty list is legal and changes nothing. */
export type ModuleInst = {
  moduleName: string
  instName: string
  conns: PortConn[]
  named: boolean
  line: number
  unsupported: string | null
  overrides: ParamOverride[] | null
}
/**
 * What this importer could not build, after the transitive walk in verilog-synth.ts. `nets` holds every
 * bit-net for which no honest value exists — the ones a skipped construct might have driven, plus everything
 * downstream of them; `constructs` names the skipped constructs in plain English; `wholeModule` marks a skip
 * whose targets could not be identified at all, which makes the entire design unbuilt.
 */
export type UnbuiltReport = { nets: Set<string>; constructs: string[]; wholeModule: boolean }

export type ParsedModule = {
  name: string
  portOrder: string[]
  /** Every header port POSITION, in source order, with `null` where a port could not be represented. A
   *  positional instantiation counts from the left, so the gaps have to keep their places or every later
   *  connection lands on the wrong port. `portOrder` holds only the usable ones. */
  portPositions: (string | null)[]
  dir: Map<string, 'input' | 'output' | 'inout'>
  gates: GateInst[]
  /** Gate primitives whose terminals still need width information to resolve (see RawGate). */
  rawGates: RawGate[]
  assigns: Assign[]
  alwaysBlocks: AlwaysBlock[]
  /** Drivers written in the source that this importer refuses to build. They claim their bits like any other
   *  driver, so a second driver on the same bit is still seen as the contention it is. */
  refusedDrivers: RefusedDriver[]
  /** Filled by the synthesizer: one flip-flop per registered bit; lower() places each as a D_FLIPFLOP_BLOCK. */
  flops: FlopInst[]
  /** Net → bit width for declared buses (`[N:0] a` → 4). Absent ⇒ a 1-bit scalar. */
  widths: Map<string, number>
  /** Memory name → {word width, depth} for declared arrays (`reg [D-1:0] m [0:W-1]`). */
  mems: Map<string, MemInfo>
  /** Function name → its definition, inlined at each call site by the synthesizer. */
  functions: Map<string, FuncDef>
  /** Task name → its definition, inlined at each (combinational) call statement. */
  tasks: Map<string, TaskDef>
  /** Names of `signed` nets/ports (drive sign-extension + signed comparisons/shifts/divide). */
  signed: Set<string>
  /** Nets declared `wor`/`wand`/`trior`/`triand`: several drivers COMBINE with this function instead of
   *  contending. Reporting those as a multiple-driver conflict says the opposite of what the net means. */
  resolution: Map<string, 'or' | 'and'>
  /** `initial <reg> = <constant>` power-on values. The synthesizer checks each against what the flip-flop it
   *  builds actually powers up holding, and refuses the ones it cannot honour. */
  powerOnValues: PowerOnValue[]
  /** Sub-module instantiations, inlined into this module by the flattener before synthesis. */
  instances: ModuleInst[]
  /** Header ports this parser could not represent and left OUT of `portOrder` — an `inout`, a port whose
   *  range it could not read, a null port position, a port expression. Each one shifts every later port's
   *  POSITION, so a positional instantiation of such a module can no longer be aligned and the flattener
   *  refuses it. A named instantiation is unaffected: it binds by name, and a connection to a dropped port
   *  is reported on its own. */
  droppedPorts: string[]
  /** The subset of `droppedPorts` this importer cannot represent AT ALL — a declared RANGE that would not
   *  fold, or an `inout`, each carrying its own plain-English reason. On a sub-module that is all a drop
   *  needs to mean — a connection to one is refused, an unconnected one costs nothing. On the module being
   *  PUBLISHED it is fatal: the block would come out missing a pin its own source declares, so importVerilog
   *  refuses the design by name instead of handing back a smaller module. */
  unrepresentablePorts: UnrepresentablePort[]
  /** Every identifier inside a span this importer swallowed WITHOUT parsing its statements — a `generate`
   *  body, or a statement whose leading word could not be read as an instantiation (a bare `for` generate).
   *  Those are the only two places a module instantiation can hide, and a hidden instantiation makes the
   *  instantiated module look top-level, which hands back the wrong module as the design (chooseTopModule). */
  namesInsideUnparsedSpans: Set<string>
  /** Filled by the synthesizer. Empty until then. */
  unbuilt: UnbuiltReport
}

/** The port-side tables a declaration writes into. The ANSI header and the non-ANSI body form both fill
 *  them, and must agree about every one, or the two spellings of the same module would not build alike. */
type PortTables = {
  portOrder: string[]
  portPositions: (string | null)[]
  dir: Map<string, 'input' | 'output' | 'inout'>
  widths: Map<string, number>
  signed: Set<string>
  droppedPorts: string[]
  unrepresentablePorts: UnrepresentablePort[]
  /** The module's own `resolution` map. A port may declare a wired net type (`output wor [7:0] y`), and that
   *  is the ONLY place that resolution is written when the header is ANSI. */
  resolution: Map<string, 'or' | 'and'>
}

/** A `[ msb : lsb ]` range's bit width. Both bounds are folded as SELF-DETERMINED constant expressions — a
 *  range bound is assigned to nothing, so it wraps at its own §5.4.1 width (measured: `wire [(4'd10 +
 *  4'd10):0]` is five bits in Icarus Verilog 14.0, not twenty-one). A parameter has already been substituted
 *  to its sized literal by elaborateParams, so `[WIDTH-1:0]` arrives as `[8'd8-1:0]` and carries the width the
 *  declaration gave it. Only descending, zero-based `[N:0]` is representable (right endpoint = LSB);
 *  anything else is reported. */
function rangeWidth(
  inner: Tok[],
  params?: Map<string, ConstVal>,
): { width: number } | { bad: string } {
  const parts = splitOnColon(inner)
  if (parts === undefined) return { bad: 'non-constant or malformed range' }
  const hi = evalConst(parts[0], params, 'self')
  const lo = evalConst(parts[1], params, 'self')
  if (hi === undefined || lo === undefined)
    return { bad: 'non-constant range (bounds must fold to a constant)' }
  // Read each bound through asInteger, so a NEGATIVE msb (`[LO+6:0]` with `parameter signed [3:0] LO = -2`)
  // reads as −4 and is reported, instead of reading as 4 294 967 290 and publishing a 21-bit port.
  const msb = Number(asInteger(hi))
  const lsb = Number(asInteger(lo))
  if (lsb !== 0 || msb < 0)
    return {
      bad: `range [${msb}:${lsb}] must be [N:0] (ascending/nonzero-based buses are unsupported)`,
    }
  // An unsigned underflow (a parameter `[W-1:0]` with W=0 wraps to ~4.3 billion) or a huge literal would size
  // a multi-gigabit bus and hang the synthesizer — report it rather than try to build it.
  if (msb + 1 > MAX_WIDTH)
    return { bad: `bus width ${msb + 1} is unreasonably large (a parameter underflow?) — reported` }
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

/** A memory depth range → its word count W. Bounds fold as SELF-DETERMINED constant expressions, the same
 *  reading `rangeWidth` uses: `reg [7:0] m [0:(4'd10 + 4'd10)]` is FIVE words in Icarus Verilog 14.0, and
 *  building twenty-one of them made an out-of-range address answer where the real memory has no word.
 *
 *  BOTH zero-based spellings are the same memory. Measured on Icarus Verilog 14.0: `reg [7:0] d [3:0]` and
 *  `reg [7:0] a [0:3]` filled by the same loop both read `01 12 23 34` at indices 0,1,2,3 — an unpacked array
 *  is indexed by the value, not by the declaration's direction, so the synthesizer's word k ↔ address k
 *  mapping holds either way. `[3:0]` is how a real 6502 spells its register file, and refusing it cost the
 *  whole CPU. A NONZERO-based range is a different memory and stays reported: Icarus reads x below its low
 *  bound (`reg [7:0] nz [2:5]` reads xx at nz[0] and nz[1]), which needs an address offset we do not build. */
function depthRange(
  inner: Tok[],
  params?: Map<string, ConstVal>,
): { depth: number } | { bad: string } {
  const parts = splitOnColon(inner)
  if (parts === undefined) return { bad: 'non-constant or malformed array range' }
  const left = evalConst(parts[0], params, 'self')
  const right = evalConst(parts[1], params, 'self')
  if (left === undefined || right === undefined)
    return { bad: 'non-constant array range (bounds must fold to a constant)' }
  // Same reading as rangeWidth: a negative word bound must READ as negative, not as a 4-billion-word memory.
  const leftN = Number(asInteger(left))
  const rightN = Number(asInteger(right))
  const lowest = Math.min(leftN, rightN)
  const highest = Math.max(leftN, rightN)
  if (lowest < 0) return { bad: `array range [${leftN}:${rightN}] has a negative word index` }
  if (lowest !== 0)
    return {
      bad: `array range [${leftN}:${rightN}] does not start at word 0 — this importer stores word k at address k, so a nonzero-based array would need an address offset it does not build`,
    }
  if (highest + 1 > MAX_WIDTH)
    return {
      bad: `memory depth ${highest + 1} is unreasonably large (a parameter underflow?) — reported`,
    }
  return { depth: highest + 1 }
}

/**
 * A PORT this importer cannot represent, and why — the two reasons below both build a DIFFERENT MODULE than
 * the source describes if they are quietly registered at width 1.
 *
 * `said` is what the warning tells the reader; `why` completes the sentence "the port …" wherever the name
 * is repeated later (the refused-driver reason, the whole-design refusal).
 */
type UnrepresentablePort = { name: string; said: string; why: string }

/** A port whose declared `[msb:lsb]` range does not fold to a constant. Measured against Icarus Verilog
 *  14.0: `output [$clog2(16)-1:0] z; assign z = 4'hF;` read 1 here where Icarus reads 15, and the module
 *  published with nothing said but a warning about the RANGE. */
const unsizedPort = (name: string, bad: string): Omit<UnrepresentablePort, 'name'> => ({
  said: `port "${name}" range — ${bad}`,
  why: 'has a declared range this importer cannot fold to a width',
})

/** A port declared `real`/`realtime`. IEEE 1364-2005 §12.3.3 does not allow a real port at all, and there is
 *  no bit pattern here for a fraction — registered at the default width it published a ONE-PIN port where the
 *  source declares a 64-bit floating-point value. */
const floatingPointPort = (name: string, kind: string): Omit<UnrepresentablePort, 'name'> => ({
  said: `port "${name}" is declared "${kind}", which is IEEE-754 floating point`,
  why: 'is declared floating point, which has no bit pattern this two-valued netlist can carry',
})

/** An `input` port declared with a VARIABLE type. IEEE 1364-2005 §12.3.3 allows a variable port only in the
 *  output direction, and Icarus Verilog 14.0 rejects `input integer a;` outright — so there is no oracle to
 *  measure a build against, and this importer does not ship behaviour it cannot measure. */
const variableInputPort = (name: string, kind: string): Omit<UnrepresentablePort, 'name'> => ({
  said: `input port "${name}" is declared "${kind}", which IEEE 1364-2005 §12.3.3 allows only on an output`,
  why: 'is an input declared with a variable type, which is not legal Verilog',
})

/** Why a port cannot be represented, deferred until its NAME is read — the two header parsers meet the
 *  declaration before the identifier it belongs to, and a refusal that cannot say which port it was is not
 *  worth much to the reader. */
type PortRefusal = (name: string) => Omit<UnrepresentablePort, 'name'>
const unfoldableRangePort: PortRefusal = (name) =>
  unsizedPort(name, 'non-constant range (bounds must fold to a constant)')

/**
 * Refuse a module-scope `real`/`realtime` variable, and with it the whole module.
 *
 * A floating-point variable's VALUE is what cannot be represented, not its declaration, so there is no net to
 * name and no smaller honest answer. Measured against Icarus Verilog 14.0: `real r; always @* begin r = 7;
 * r = r / 2; y = a + r; end` built a+3 here — integer division — where Verilog divides as reals and the store
 * to y rounds 3.5 to 4, silently and with every pin present.
 */
function refuseFloatingPoint(t: Tok, refusedDrivers: RefusedDriver[], warnings: string[]): void {
  warnings.push(
    `line ${t.line}: a "${t.v}" variable is IEEE-754 floating point — this importer has no bit pattern for a fraction — reported, not built`,
  )
  refusedDrivers.push({
    where: `line ${t.line}`,
    what: `a "${t.v}" (floating-point) variable declaration`,
    terms: [],
    wholeModule: true,
  })
}

/** A bidirectional port. There is no direction to build it in and no third value to give it, so it has never
 *  been built — but dropping it silently published the module anyway, with the net inside it registered ONE
 *  BIT wide. Measured against Icarus Verilog 14.0: `inout [7:0] b; assign b = 8'hFF; assign y = b;` read 1
 *  here where Icarus reads 255, and the same design in non-ANSI spelling read 0 while leaving a one-bit `b`
 *  standing in the published interface. */
const inoutPort = (name: string): Omit<UnrepresentablePort, 'name'> => ({
  said: `inout port "${name}" (bidirectional) is not representable`,
  why: 'is bidirectional (inout) and has no direction this two-valued netlist can drive it in',
})

/**
 * Drop a port this importer cannot represent.
 *
 * A port's width is not one net's size — it is the module's INTERFACE: how many pins it has, and which bit
 * of a connection lands on which one.
 *
 * So the port is DROPPED, exactly as a port expression already is: a connection to it is refused by
 * resolveConnections, and its null `portPositions` slot keeps every later positional connection aligned. The
 * name is claimed as a refused driver too, so nothing INSIDE the module reads it at a width we invented —
 * across the port's WHOLE declared width when that width is known, so a bit-select read is claimed as well.
 * `unrepresentablePorts` then carries the one case dropping cannot answer for — see importVerilog, where a
 * design published missing a pin its own source declares is refused by name.
 *
 * The caller removes the port from `portOrder`/`portPositions`, because the ANSI header and the non-ANSI
 * body reach this point at different stages of building those two lists.
 */
function dropUnrepresentablePort(
  ports: PortTables,
  refusedDrivers: RefusedDriver[],
  warnings: string[],
  name: string,
  line: number,
  reason: Omit<UnrepresentablePort, 'name'>,
): void {
  warnings.push(`line ${line}: ${reason.said} — reported, not built`)
  ports.unrepresentablePorts.push({ name, ...reason })
  refusedDrivers.push({
    where: `line ${line}`,
    what: `the port "${name}", which ${reason.why}`,
    terms: [[{ k: 'id', v: name, line }]],
  })
}

/**
 * Give a port the meaning of the net type written on it.
 *
 * A net type on a port declaration is not decoration — it is the same declaration a net declaration makes.
 * IEEE 1364-2005 §4.6: `trior` is a SYNONYM for `wor` and `triand` for `wand`, identical semantics under a
 * different spelling. Both header styles route through here so the two sites cannot drift apart: measured
 * against Icarus Verilog 14.0, `output wor [31:0] y` with two drivers read 252 there while this importer
 * published a block with the `y` pin ENTIRELY ABSENT, and `output tri1 [31:0] y; assign y[3:0] = a;` read
 * 4294967280 there against 0 here — both silent, in every one of the four wired spellings.
 */
function applyPortNetType(
  ports: PortTables,
  refusedDrivers: RefusedDriver[],
  warnings: string[],
  kind: string,
  t: Tok,
): void {
  const resolve = NET_RESOLUTION[kind]
  if (resolve !== undefined) {
    ports.resolution.set(t.v, resolve)
    return
  }
  const unmodeled = UNMODELED_NETS[kind] ?? UNMODELED_PORT_NETS[kind]
  if (unmodeled === undefined) return // wire / tri / uwire — a plain net, which is what the port already is
  warnings.push(
    `line ${t.line}: port "${t.v}" is declared "${kind}", which ${unmodeled} — this importer has no value for that — reported, not built`,
  )
  refusedDrivers.push({
    where: `line ${t.line}`,
    what: `a "${kind}" port declaration`,
    terms: [[t]],
  })
}

/** Read a memory depth range at the cursor (positioned at the second `[`); leaves it just past `]`. */
function readDepthRange(c: Cursor): { depth: number } | { bad: string } {
  c.next() // '['
  const inner: Tok[] = []
  while (!c.atEnd() && !c.is(']') && !c.is(';')) inner.push(c.next() as Tok)
  if (c.is(']')) c.next()
  return depthRange(inner)
}

// ── parameter elaboration ────────────────────────────────────────────────────────
// A `parameter`/`localparam` is a compile-time constant. We elaborate it away BEFORE the module is parsed:
// scan the first module for every parameter declaration (header `#(…)` and body), fold each default to an
// {value, width}, then SUBSTITUTE every use of the parameter name with its sized literal (`W` → `8'd8`). The
// structural parser + the expression synthesizer then see only literals — no parameter plumbing threads
// through the width-fragile select/range/replication code, and a bus `[W-1:0]` becomes a real `[8-1:0]` that
// rangeWidth folds. A parameter without a constant default (or a name used before it is declared) is REPORTED
// and left as-is (its uses stay identifiers), never silently defaulted.

/** What one `readParamList` pass records, and what an instantiation forces on it. `overrides` is applied AT
 *  THE DECLARATION POINT rather than merged in afterwards: the list folds in source order and a later item may
 *  read an earlier one, so a `localparam N = 2*W` has to fold against the OVERRIDDEN W. Folding first and
 *  overwriting after would size the ports from the new W and the internal nets from the old one — a module
 *  that still builds and computes a different answer, with nothing said. */
type ParamCollector = {
  overrides: Map<string, ConstVal> | undefined
  /** Every declaration seen, in source order. */
  decls: ParamDecl[] | undefined
  /** Names an override was actually applied to, so a caller can tell a silently-dropped override from an
   *  applied one. */
  applied: Set<string> | undefined
  /** True for the header `#( … )` parameter port list. */
  inHeader: boolean
}

/** Consume one comma-separated parameter list starting just past the `parameter`/`localparam` keyword. Folds
 *  each item into `params` (in source order, so a later item may reference an earlier one). Returns the index
 *  just past the list (at its `;`, or at the `)` that closes a `#(…)` header). */
export function readParamList(
  toks: Tok[],
  start: number,
  params: Map<string, ConstVal>,
  warnings: string[],
  collector?: ParamCollector,
): number {
  let i = start
  let kind: 'parameter' | 'localparam' =
    (toks[start - 1] as Tok | undefined)?.v === 'localparam' ? 'localparam' : 'parameter'
  // The type/range prefix (`[7:0]`, `signed`, `integer`) applies to EVERY name in one declaration —
  // `parameter [7:0] A = 5, B = 2;` makes BOTH 8-bit — so the range is sticky across the comma list. A
  // repeated `parameter`/`localparam` keyword (ANSI headers) starts a fresh item, resetting the range.
  let range: Tok[] | undefined
  // IEEE 1364-2005 §12.2: a `signed` keyword or an `integer` type makes the parameter SIGNED; a RANGE with no
  // `signed` makes it unsigned whatever its default expression was; with neither, it takes the default
  // expression's own signedness. Measured against Icarus Verilog 14.0 on `for (k = 3; k >= N; k = k - 1)`:
  // `parameter N = -1` and `parameter integer N = -1` run five times, `parameter [3:0] N = -1` runs zero.
  let declaredSigned = false
  for (;;) {
    for (;;) {
      // `integer`/`real`/`time` lex as plain identifiers (not keywords), so match by VALUE not kind — else a
      // `parameter integer W = …` would read `integer` as the name and drop W (a silent wrong-value hazard).
      const v = (toks[i] as Tok | undefined)?.v
      if (v === 'parameter' || v === 'localparam') {
        range = undefined
        declaredSigned = false
        kind = v
        i += 1
        continue
      }
      if (v !== undefined && ['signed', 'integer', 'real', 'time', 'realtime'].includes(v)) {
        if (v === 'signed' || v === 'integer') declaredSigned = true
        i += 1
        continue
      }
      break
    }
    if ((toks[i] as Tok | undefined)?.v === '[') {
      i += 1
      range = []
      while (i < toks.length && (toks[i] as Tok).v !== ']') range.push(toks[i++] as Tok)
      if ((toks[i] as Tok | undefined)?.v === ']') i += 1
    }
    const nameTok = toks[i] as Tok | undefined
    if (nameTok === undefined || nameTok.k !== 'id') return i
    i += 1
    collector?.decls?.push({ name: nameTok.v, kind, inHeader: collector.inHeader })
    // A `localparam` is never overridable, so an override that reached here for one would be a bug upstream;
    // reading the override map only for a `parameter` keeps that impossible rather than merely unlikely.
    const forced = kind === 'parameter' ? collector?.overrides?.get(nameTok.v) : undefined
    // A declared range narrows the value that lands on the parameter — Icarus gives `#(.K(7))` against
    // `parameter [1:0] K = 2'd1` the value 3 — and it narrows an override exactly as it narrows a default.
    // It is also the CONTEXT the default expression is evaluated in, which is not the same thing: measured,
    // `localparam [7:0] Q = ~4'd0` is 255 in Icarus Verilog 14.0 (the `~` runs at eight bits) where folding
    // `~4'd0` on its own and then widening gives 15, and `localparam signed [7:0] Q = 4'sh8 / 4'shf` is +8
    // where the same divide alone is −8 at four bits.
    const declaredRange = range === undefined ? undefined : rangeWidth(range, params)
    const store = (val: ConstVal): void => {
      // `applied` is recorded only where the value REALLY lands, so "an override name that is not applied"
      // stays an exact test the caller can refuse on — a declaration whose own range does not fold sets
      // nothing, and that has to count as unapplied rather than as done.
      if (declaredRange === undefined) {
        params.set(nameTok.v, { ...val, signed: declaredSigned || val.signed })
        if (forced !== undefined) collector?.applied?.add(nameTok.v)
        return
      }
      if ('bad' in declaredRange) {
        warnings.push(`${kind} "${nameTok.v}" range — ${declaredRange.bad} — reported`)
        return
      }
      // A declared range resizes the value in BOTH directions through the one widening rule: a too-wide value
      // truncates, and a too-narrow SIGNED one sign-extends (`parameter signed [7:0] N = -4'sd1` is −1, not
      // +15). The parameter then carries its DECLARATION's signedness, not the default expression's.
      params.set(nameTok.v, {
        value: extendTo(val, declaredRange.width, val.signed),
        width: declaredRange.width,
        signed: declaredSigned,
        unsized: false, // a DECLARED range is the size; nothing about it is left to grow
      })
      if (forced !== undefined) collector?.applied?.add(nameTok.v)
    }
    if ((toks[i] as Tok | undefined)?.v !== '=') {
      if (forced !== undefined) store(forced)
      else warnings.push(`${kind} "${nameTok.v}" has no default value — reported, not elaborated`)
      // skip to the next separator so the scan resyncs
      while (i < toks.length && ![',', ';', ')'].includes((toks[i] as Tok).v)) i += 1
    } else {
      i += 1 // '='
      const rhs: Tok[] = []
      let depth = 0
      while (i < toks.length) {
        const tk = toks[i] as Tok
        if (tk.v === '(' || tk.v === '[' || tk.v === '{') depth += 1
        else if (tk.v === ')' || tk.v === ']' || tk.v === '}') {
          if (depth === 0) break // the `)` that closes a `#(…)` header
          depth -= 1
        } else if (depth === 0 && (tk.v === ',' || tk.v === ';')) break
        rhs.push(tk)
        i += 1
      }
      if (forced !== undefined) store(forced)
      else {
        const val = evalConst(
          rhs,
          params,
          declaredRange !== undefined && !('bad' in declaredRange)
            ? declaredRange.width
            : undefined,
        )
        if (val === undefined)
          warnings.push(
            `${kind} "${nameTok.v}" default is not a constant expression — reported, not elaborated`,
          )
        else store(val)
      }
    }
    if ((toks[i] as Tok | undefined)?.v === ',') {
      i += 1
      continue
    }
    if ((toks[i] as Tok | undefined)?.v === ';') i += 1
    return i
  }
}

/** The index of the `)` closing a module's header `#( … )` parameter port list, or -1 when it has none.
 *  `span[0]` is the `module` keyword and `span[1]` its name, so the list can only start at `span[2]`. */
function headerParamListEnd(span: Tok[]): number {
  if ((span[2] as Tok | undefined)?.v !== '#') return -1
  if ((span[3] as Tok | undefined)?.v !== '(') return -1
  return matchBracket(span, 3)
}

/** Fold every parameter/localparam default in the module's token span into a value table. A constant declared
 *  inside a GENERATE region is skipped: it belongs to a generate block's own scope, is per-iteration
 *  (`localparam LSB = i*8` is a different number in every copy), and two blocks may each declare one of the
 *  same name with different values. `elaborateGenerate` folds those per copy; folding one of them here would
 *  write a single value over every block. */
function collectParams(
  span: Tok[],
  warnings: string[],
  regions: Array<{ from: number; to: number }>,
  overrides?: Map<string, ConstVal>,
  decls?: ParamDecl[],
  applied?: Set<string>,
): Map<string, ConstVal> {
  const params = new Map<string, ConstVal>()
  const headerEnd = headerParamListEnd(span)
  let i = 0
  while (i < span.length) {
    const region = regions.find((r) => i >= r.from && i < r.to)
    if (region !== undefined) {
      i = region.to
      continue
    }
    const t = span[i] as Tok
    if (t.k === 'kw' && (t.v === 'parameter' || t.v === 'localparam')) {
      i = readParamList(span, i + 1, params, warnings, {
        overrides,
        decls,
        applied,
        inHeader: headerEnd !== -1 && i < headerEnd,
      })
      continue
    }
    i += 1
  }
  return params
}

/** The token indices where a generate region's own constant shadows a module parameter of the same name. The
 *  module's value stops at the region's edge there, so `localparam K` inside a block means the block's K —
 *  IEEE 1364-2005 §12.1.3 makes each generate block a scope, and Icarus Verilog 14.0 reads it that way. */
function generateScopedIndices(
  span: Tok[],
  regions: Array<{ from: number; to: number }>,
  constants: Set<string>,
): Set<number> {
  const out = new Set<number>()
  if (constants.size === 0) return out
  for (const region of regions)
    for (let i = region.from; i < region.to; i++) {
      const t = span[i] as Tok
      if (t.k === 'id' && constants.has(t.v)) out.add(i)
    }
  return out
}

/** The sized literal a parameter substitutes to. A SIGNED parameter keeps the `'s` marker, or the literal it
 *  becomes carries a different type than the parameter did and every comparison against it silently flips to
 *  unsigned (IEEE 1364-2005 §5.5.1: one unsigned operand makes the whole comparison unsigned). Both directions
 *  were measured against Icarus Verilog 14.0 on `for (k = …; k … N; …)`: `parameter N = -1` written as
 *  `32'd4294967295` made `k >= N` false on the FIRST test where Icarus runs the loop five times, and
 *  `parameter N = 2` written as `32'd2` made `k < N` false at k = −2 where Icarus runs it four times. */
function paramLiteral(p: ConstVal): string {
  if (!p.signed) return `${p.width}'d${p.value.toString()}`
  return `${p.width}'sh${p.value.toString(16)}`
}

/** Replace every identifier token that names a parameter with its sized literal (`W` → `8'd8`). An identifier
 *  written straight after a `.` is a PORT or PARAMETER name being connected by name (`.W(4)`), never a
 *  reference to this module's own parameter — rewriting that one to a literal would destroy the connection.
 *  `scoped` names the indices where an inner scope has taken the name back and this value does not reach. */
export function substituteParams(
  span: Tok[],
  params: Map<string, ConstVal>,
  scoped?: Set<number>,
): Tok[] {
  return span.map((t, i) => {
    if (t.k !== 'id') return t
    if ((span[i - 1] as Tok | undefined)?.v === '.') return t
    if (scoped?.has(i) === true) return t
    const p = params.get(t.v)
    return p === undefined ? t : { k: 'num', v: paramLiteral(p), line: t.line }
  })
}

/** Parameter names that ALSO appear as a declared net/port/instance identifier — an illegal redeclaration.
 *  Substituting such a name (`W` → `8'd8`) would corrupt structure: a gate `and G(...)` becomes `and 8'd2(…)`
 *  and is silently dropped, a port `\W` vanishes. We detect the collision so those uses are REPORTED and the
 *  name is left un-substituted (the gate/port survives), rather than a gate disappearing with no warning. A
 *  structural position is: an id right before `(` (a gate/module INSTANCE name), or an id declared after an
 *  input/output/inout/wire/reg keyword (a net/port NAME — a `[range]` is skipped, so a `[W-1:0]` USE isn't
 *  mistaken for a declaration). A name written after a `.` is NOT a structural position: `.W(4)` is a named
 *  parameter override and `.W(x)` a named port connection, and reading either as an instance name deleted the
 *  ENCLOSING module's parameter `W` — measured at HEAD, that silently dropped every `[W-1:0]` port from the
 *  published interface. */
function collidingParamNames(span: Tok[], params: Map<string, ConstVal>): Set<string> {
  const collide = new Set<string>()
  const flag = (name: string): void => {
    if (params.has(name)) collide.add(name)
  }
  for (let i = 0; i < span.length; i++) {
    const t = span[i] as Tok
    if (
      t.k === 'id' &&
      (span[i + 1] as Tok | undefined)?.v === '(' &&
      (span[i - 1] as Tok | undefined)?.v !== '.'
    )
      flag(t.v) // instance name
    if (t.k === 'kw' && ['input', 'output', 'inout', 'wire', 'reg'].includes(t.v)) {
      let depth = 0
      for (let j = i + 1; j < span.length; j++) {
        const u = span[j] as Tok
        if (u.v === '[') depth += 1
        else if (u.v === ']') depth -= 1
        else if (depth === 0 && u.v === ';') break
        else if (depth === 0 && u.k === 'id') flag(u.v)
      }
    }
  }
  return collide
}

/** What one module elaboration produced: the substituted token stream, the parameter declarations it saw (so
 *  the flattener can decide whether an instantiation's `#( … )` list is legal), and any override name that did
 *  NOT reach a declaration. An unapplied override is the dangerous case — the module would elaborate at its
 *  DEFAULT value and build silently wrong — so the caller refuses on it. */
type Elaboration = {
  toks: Tok[]
  params: ModuleParams
  unapplied: string[]
}

/** Elaborate the parameters of the module in `toks` (callers pass ONE module span; params are module-scoped,
 *  so a same-named parameter in another module never rewrites this one's nets), returning the token stream
 *  with every use substituted. `overrides` carries the values an instantiation forces on this module. */
function elaborateModule(
  toks: Tok[],
  warnings: string[],
  overrides?: Map<string, ConstVal>,
): Elaboration {
  const decls: ParamDecl[] = []
  const applied = new Set<string>()
  const unappliedNames = (): string[] =>
    [...(overrides?.keys() ?? [])].filter((name) => !applied.has(name))
  const start = toks.findIndex((t) => t.k === 'kw' && t.v === 'module')
  if (start === -1)
    return { toks, params: { decls, hasHeader: false }, unapplied: unappliedNames() }
  let end = toks.length
  for (let i = start + 1; i < toks.length; i++) {
    if ((toks[i] as Tok).k === 'kw' && (toks[i] as Tok).v === 'endmodule') {
      end = i + 1
      break
    }
  }
  const span = toks.slice(start, end)
  const generate = generateRegionInfo(span)
  const params = collectParams(span, warnings, generate.spans, overrides, decls, applied)
  const moduleParams: ModuleParams = { decls, hasHeader: headerParamListEnd(span) !== -1 }
  // A parameter whose name collides with a declared net/port/instance is an illegal redeclaration — report it
  // and DON'T substitute (so the gate/port keeps its real name and survives, instead of being silently mangled).
  for (const name of collidingParamNames(span, params)) {
    warnings.push(
      `parameter "${name}" collides with a net/port/instance of the same name — reported, not substituted`,
    )
    params.delete(name)
    applied.delete(name)
  }
  if (params.size === 0) return { toks, params: moduleParams, unapplied: unappliedNames() }
  const scoped = generateScopedIndices(span, generate.spans, generate.constants)
  return {
    toks: [...toks.slice(0, start), ...substituteParams(span, params, scoped), ...toks.slice(end)],
    params: moduleParams,
    unapplied: unappliedNames(),
  }
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

/**
 * Register each name in a module-scope `integer a, b = 0;` (or `time t;`) declaration at the width and
 * signedness VAR_TYPES gives that keyword, WITHOUT moving the cursor (the declaration is still skipped as a
 * whole). A name followed by `[` is an ARRAY of that type, which nothing here models, so it is left
 * unregistered — the first use then reports rather than reading a silently-wrong width.
 */
function registerTypedVariables(
  c: Cursor,
  type: { width: number; signed: boolean },
  widths: Map<string, number>,
  signed: Set<string>,
): void {
  let depth = 0
  let atName = true
  for (let i = c.i; i < c.toks.length; i++) {
    const t = c.toks[i] as Tok
    if (t.v === ';' && depth === 0) return
    if (t.v === '(' || t.v === '[' || t.v === '{') depth += 1
    else if (t.v === ')' || t.v === ']' || t.v === '}') depth -= 1
    else if (t.v === ',' && depth === 0) atName = true
    if (depth !== 0 || !atName || t.k !== 'id') continue
    atName = false
    if ((c.toks[i + 1] as Tok | undefined)?.v === '[') continue
    widths.set(t.v, type.width)
    if (type.signed) signed.add(t.v)
  }
}

/** The words that may legally precede a `(` inside a statement without being an instantiation or a call.
 *  Our lexer leaves them as plain identifiers, so `for (` would otherwise read as an instance of a module
 *  named `for` and make an ordinary loop look like something that could drive anything. */
const CONTROL_WORDS = new Set([
  'for',
  'if',
  'while',
  'repeat',
  'forever',
  'case',
  'casex',
  'casez',
  'wait',
  'disable',
])

/** Collect a construct we don't model, returning its whole token span (skipStatement decides where it ends). */
function collectStatement(c: Cursor): Tok[] {
  const start = c.i
  skipStatement(c)
  return c.toks.slice(start, c.i)
}

/**
 * Read an `initial` block that does nothing but load registers with constants — `initial phase = 1'b0;`, or a
 * begin…end of several such loads. Returns null for every other `initial` (a delay, a `force`, a $task, a
 * non-constant value), which then takes the ordinary not-built path.
 *
 * This is the ONE reading of `initial` that describes hardware rather than simulation: the power-on contents
 * of a register. Anything else an `initial` block does happens at time zero in a simulator and has no image
 * in a netlist at all.
 */
function initialPowerOnValues(
  span: Tok[],
  widths: Map<string, number>,
  signed: Set<string>,
): PowerOnValue[] | null {
  const out: PowerOnValue[] = []
  const budget = { left: MAX_INITIAL_ITERATIONS }
  const body = span.slice(1) // past `initial`
  if (readPowerOnStatement(body, 0, { widths, signed, budget, out }, 0) !== body.length) return null
  return out.length === 0 ? null : out
}

/** How many array words ONE `initial` block may load through unrolled loops. A ROM fill is the whole reason
 *  the loop is unrolled at all, so the bound is a real memory's worth of words rather than a token count. */
const MAX_INITIAL_ITERATIONS = 65536

/** How deeply `begin … end` blocks may nest inside one `initial`. A real ROM fill is one block, or one loop
 *  inside one block; sixty-four is far past anything written by hand. */
const MAX_POWER_ON_NESTING = 64

type PowerOnScan = {
  widths: Map<string, number>
  signed: Set<string>
  budget: { left: number }
  out: PowerOnValue[]
}

/** The index just past the statement starting at `from`: past its `;`, or past the `end` closing a `begin`.
 *  Returns -1 for a `begin` that is never closed. A statement that simply runs out of tokens (the last one in
 *  a block written without a trailing `;`) ends at the end of the span. */
function powerOnStatementEnd(toks: Tok[], from: number): number {
  if (toks[from]?.k === 'kw' && toks[from]?.v === 'begin') {
    let level = 0
    for (let i = from; i < toks.length; i++) {
      const t = toks[i] as Tok
      if (t.k !== 'kw') continue
      if (t.v === 'begin') level += 1
      else if (t.v === 'end') {
        level -= 1
        if (level === 0) return i + 1
      }
    }
    return -1
  }
  let depth = 0
  for (let i = from; i < toks.length; i++) {
    const t = toks[i] as Tok
    if (t.v === '(' || t.v === '[' || t.v === '{') depth += 1
    else if (t.v === ')' || t.v === ']' || t.v === '}') depth -= 1
    else if (depth === 0 && t.v === ';') return i + 1
    else if (depth === 0 && t.k === 'kw' && t.v === 'end') return i
  }
  return toks.length
}

/**
 * One power-on statement — a constant load (`phase = 1'b0;`, `m[2] = 8'h33;`), a `begin … end` of them, or a
 * `for` loop that writes them. Returns the index just past it, or -1 for anything else, which puts the whole
 * `initial` back on the ordinary not-built path.
 */
function readPowerOnStatement(
  toks: Tok[],
  from: number,
  scan: PowerOnScan,
  nesting: number,
): number {
  const t = toks[from]
  if (t === undefined) return -1
  // A `begin` inside a `begin` is read by recursing, so the nesting is a stack depth. MEASURED in a fresh
  // process: 20,000 nested blocks THREW `RangeError: Maximum call stack size exceeded` here. Past the cap
  // the statement is simply not read as a power-on load, which puts the whole `initial` on the ordinary
  // not-built path — a refusal by name, which is what every other unreadable `initial` already gets.
  if (nesting > MAX_POWER_ON_NESTING) return -1
  if (t.k === 'kw' && t.v === 'begin') {
    // `begin : name` — a named block's label is scope, not a statement.
    let i = toks[from + 1]?.v === ':' ? from + 3 : from + 1
    while (!(toks[i]?.k === 'kw' && toks[i]?.v === 'end')) {
      const next = readPowerOnStatement(toks, i, scan, nesting + 1)
      if (next === -1 || next <= i) return -1
      i = next
    }
    return i + 1
  }
  if (t.k === 'id' && t.v === 'for') return readPowerOnFor(toks, from, scan, nesting)
  if (t.k !== 'id') return -1
  const past = powerOnStatementEnd(toks, from)
  if (past === -1) return -1
  const stop = toks[past - 1]?.v === ';' ? past - 1 : past
  let at = from + 1
  let indexToks: Tok[] | undefined
  if (toks[at]?.v === '[') {
    const close = matchBracket(toks, at)
    if (close === -1 || close >= stop) return -1
    indexToks = toks.slice(at + 1, close)
    at = close + 1
  }
  if (toks[at]?.v !== '=') return -1
  const expr = toks.slice(at + 1, stop)
  // Fold once here only to prove the expression IS a constant — an `initial` whose value is not constant is
  // not a power-on value at all, and the whole block goes back to being an unbuildable construct. The value
  // itself is deliberately discarded: it is the synthesizer that folds it, at the register's own width.
  if (evalConst(expr) === undefined) return -1
  if (indexToks === undefined) {
    scan.out.push({ name: t.v, expr, line: t.line })
    return past
  }
  // The WORD number, unlike the value, has to be known here: a loop over the array names different words on
  // each iteration, and an index that does not fold names none this importer can point at.
  const folded = evalConst(indexToks, undefined, 'self')
  if (folded === undefined) return -1
  const index = Number(asInteger(folded))
  if (!Number.isSafeInteger(index) || index < 0 || index > MAX_WIDTH) return -1
  scan.out.push({ name: t.v, expr, line: t.line, index })
  return past
}

/** Name a `$readmemh`/`$readmemb` for what it is. Both load a memory FROM A FILE at simulation time, so there
 *  is no constant here to build a ROM out of — and a reader who is told only "a construct this importer does
 *  not build" has no way to know that the array's whole contents are what went missing. The refusal itself is
 *  the ordinary one: a system-task call names no net, so the module is not built. */
function reportFileLoad(span: Tok[], warnings: string[]): void {
  for (let i = 0; i < span.length; i++) {
    const t = span[i] as Tok
    if (t.k !== 'sys' || (t.v !== '$readmemh' && t.v !== '$readmemb')) continue
    // $readmemh(file, memory [, start [, end]]) — the memory is the argument after the first comma.
    const open = span[i + 1]?.v === '(' ? i + 1 : -1
    const comma = open === -1 ? -1 : span.findIndex((s, k) => k > open && s.v === ',')
    const array = comma === -1 ? undefined : span[comma + 1]
    warnings.push(
      `line ${t.line}: "${t.v}" loads ${array === undefined || array.k !== 'id' ? 'a memory' : `the memory "${array.v}"`} from a file when a simulator runs — this importer builds hardware and reads no files, so those contents cannot be built — reported, not built`,
    )
  }
}

/** A `for` loop inside an `initial` — the ordinary way a ROM fill is written. Unrolled with the same counter
 *  the generate elaborator and the procedural unroller count with, so a loop that cannot be proved to
 *  terminate at its declared width is refused rather than unrolled at whatever a JavaScript loop reaches. */
function readPowerOnFor(toks: Tok[], from: number, scan: PowerOnScan, nesting: number): number {
  if (toks[from + 1]?.v !== '(') return -1
  const close = matchBracket(toks, from + 1)
  if (close === -1) return -1
  const fold = (s: Tok[]): ConstVal | undefined => evalConst(s, undefined, 'self')
  const counter = loopCounter(
    toks.slice(from + 2, close),
    fold,
    (n) => scan.widths.get(n) ?? 1,
    (n) => scan.signed.has(n),
  )
  if ('bad' in counter) return -1
  const bodyEnd = powerOnStatementEnd(toks, close + 1)
  if (bodyEnd === -1) return -1
  const body = toks.slice(close + 1, bodyEnd)
  for (;;) {
    const another = loopContinues(counter, fold)
    if ('bad' in another) return -1
    if (!another.go) return bodyEnd
    if (scan.budget.left <= 0) return -1
    scan.budget.left -= 1
    const iteration = substituteCounter(body, counter)
    if ('bad' in iteration) return -1
    if (readPowerOnStatement(iteration, 0, scan, nesting + 1) !== iteration.length) return -1
    if (loopAdvance(counter, fold) !== undefined) return -1
  }
}

/** Collect a `generate … endgenerate` region, which holds SEVERAL statements and so cannot end at the first
 *  `;` or `end` the way one statement does. The `endgenerate` is consumed; a region missing it stops at
 *  `endmodule`. */
function collectGenerate(c: Cursor): Tok[] {
  const start = c.i
  while (!c.atEnd() && !c.is('endgenerate') && !c.is('endmodule')) c.next()
  const span = c.toks.slice(start, c.i)
  if (c.is('endgenerate')) c.next()
  return span
}

/**
 * The nets a SKIPPED construct could have driven, read straight off its tokens: every assignment target in
 * the span (`t`, `t[i]`, `t[3:0]`, `{x,y}`, on either `=` or `<=`), which covers a generate body, an
 * `initial`, a `force` and a procedural block alike.
 *
 * Returns null when the span holds something whose targets cannot be identified this way — a module or
 * primitive instantiation, or a call — because a driver reached through a port connection leaves no `=`
 * behind. The caller then declares the WHOLE module unbuilt, which is the only honest answer available when
 * we cannot say what a construct we did not build was driving.
 */
/** Append every element of `src` to `dst`.
 *
 *  `dst.push(...src)` passes each element as a separate ARGUMENT, and a list big enough to pass the engine's
 *  argument limit throws `RangeError: Maximum call stack size exceeded` there instead of building — a crash,
 *  where the user should have got either a design or a reason. A loop has no such limit. MEASURED in a fresh
 *  process: a generate region of 20,000 nested blocks threw exactly there, spreading its own token span.
 *  Every append of a list whose length the SOURCE decides goes through here. */
export function appendAll<T>(dst: T[], src: readonly T[]): void {
  for (const item of src) dst.push(item)
}

export function assignmentTargets(span: Tok[]): Tok[][] | null {
  const terms: Tok[][] = []
  for (let i = 0; i < span.length; i++) {
    const t = span[i] as Tok
    if (t.k === 'id' && span[i + 1]?.v === '(' && !CONTROL_WORDS.has(t.v)) return null
    if (
      t.k === 'kw' &&
      (N_INPUT[t.v] !== undefined || N_OUTPUT[t.v] !== undefined || OTHER_GATE_SWITCH.has(t.v))
    )
      return null
    if (t.v === '{') {
      const close = matchBracket(span, i)
      if (close === -1) return null
      if (isAssignOp(span[close + 1])) terms.push(span.slice(i, close + 1))
      i = close
      continue
    }
    if (t.k !== 'id') continue
    let j = i + 1
    while (span[j]?.v === '[') {
      const close = matchBracket(span, j)
      if (close === -1) return null
      j = close + 1
    }
    if (isAssignOp(span[j])) terms.push(span.slice(i, j))
  }
  return terms
}

const isAssignOp = (t: Tok | undefined): boolean => t?.v === '=' || t?.v === '<='

/** The index of the `)`/`]`/`}` closing the bracket at `open`, or -1 if it is never closed. */
function matchBracket(span: Tok[], open: number): number {
  let depth = 0
  for (let i = open; i < span.length; i++) {
    const v = (span[i] as Tok).v
    if (v === '(' || v === '[' || v === '{') depth += 1
    else if (v === ')' || v === ']' || v === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
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
  const portPositions: (string | null)[] = []
  const widths = new Map<string, number>()
  const mems = new Map<string, MemInfo>()
  const signed = new Set<string>()
  const resolution = new Map<string, 'or' | 'and'>()
  const droppedPorts: string[] = []
  const unrepresentablePorts: UnrepresentablePort[] = []
  const ports: PortTables = {
    portOrder,
    portPositions,
    dir,
    widths,
    signed,
    droppedPorts,
    unrepresentablePorts,
    resolution,
  }
  const refusedDrivers: RefusedDriver[] = []
  // A `#( … )` parameter-port list: its defaults were already folded + substituted by elaborateParams, so
  // just consume the group here. Without this the cursor would sit on `#`, the port `(` would never be read,
  // and a parameterized module would silently lose its ENTIRE port list.
  if (c.is('#')) {
    c.next()
    if (c.is('(')) readGroup(c)
  }
  if (c.is('(')) parseHeader(readGroup(c), ports, refusedDrivers, warnings)
  if (c.is(';')) c.next()

  const gates: GateInst[] = []
  const rawGates: RawGate[] = []
  const powerOnValues: PowerOnValue[] = []
  const assigns: Assign[] = []
  const alwaysBlocks: AlwaysBlock[] = []
  const functions = new Map<string, FuncDef>()
  const tasks = new Map<string, TaskDef>()
  const instances: ModuleInst[] = []
  const namesInsideUnparsedSpans = new Set<string>()
  while (!c.atEnd() && !c.is('endmodule')) {
    const t = c.peek() as Tok
    if (t.k === 'dir') {
      reportDirective(c.next() as Tok, warnings)
      continue
    }
    if (t.k === 'kw' && (t.v === 'input' || t.v === 'output' || t.v === 'inout')) {
      parsePortDecl(c, ports, refusedDrivers, warnings)
      continue
    }
    if (t.k === 'kw' && (t.v === 'reg' || NET_TYPES.has(t.v))) {
      // `reg [n:0] x;` captures a width like `wire`; `reg [d:0] m [0:w-1];` captures a memory
      parseNetDecl(
        c,
        widths,
        mems,
        signed,
        assigns,
        resolution,
        refusedDrivers,
        warnings,
        powerOnValues,
      )
      continue
    }
    if (t.k === 'kw' && t.v === 'assign') {
      appendAll(assigns, parseAssigns(c, warnings))
      continue
    }
    if (t.k === 'kw' && t.v === 'always') {
      // A posedge-clocked always is CAPTURED for sequential synthesis; anything else (async reset, negedge,
      // combinational @*, multiple edges) falls through to the behavioral report below.
      const block = parseAlways(c, refusedDrivers, warnings)
      if (block !== null) alwaysBlocks.push(block)
      continue
    }
    if (t.k === 'kw' && (N_INPUT[t.v] !== undefined || N_OUTPUT[t.v] !== undefined)) {
      parseGateStatement(c, gates, rawGates, refusedDrivers, warnings)
      continue
    }
    if (t.k === 'kw' && (t.v === 'parameter' || t.v === 'localparam')) {
      // Already folded away by elaborateParams (its uses are now literals) — skip the declaration silently.
      c.next()
      skipStatement(c)
      continue
    }
    if (t.k === 'kw' && t.v === 'function') {
      parseFunction(c, functions, warnings)
      continue
    }
    if (t.k === 'kw' && t.v === 'task') {
      parseTask(c, tasks, warnings)
      continue
    }
    if (t.k === 'kw' && OTHER_GATE_SWITCH.has(t.v)) {
      warnings.push(
        `line ${t.line}: primitive "${t.v}" has no ChipBlocks gate — reported, not built`,
      )
      parseSwitchStatement(c, refusedDrivers)
      continue
    }
    if (t.k === 'kw' && NON_NET_DECLS.includes(t.v)) {
      c.next()
      // The declaration itself is still skipped — an `integer` is a procedural variable, never a gate terminal.
      // Its WIDTH and SIGNEDNESS are registered because IEEE 1364-2005 §3.9 makes it a signed 32-bit variable,
      // and a procedural loop has to count at its counter's exact declared type: unregistered, a 32-bit
      // `integer` would be modelled as a 1-bit register that wraps to 0 after one step.
      const declType = VAR_TYPES.get(t.v)
      if (declType === 'floating-point') refuseFloatingPoint(t, refusedDrivers, warnings)
      else if (declType !== undefined) registerTypedVariables(c, declType, widths, signed)
      skipStatement(c)
      continue
    }
    if (t.k === 'kw' && t.v === 'specify') {
      // Timing specification only — it declares delays, never a driver, so skipping it changes no value.
      c.next()
      skipToEnd(c, 'endspecify')
      continue
    }
    if (t.k === 'kw' && BEHAVIORAL.includes(t.v)) {
      let span: Tok[]
      if (t.v === 'generate') {
        c.next()
        span = collectGenerate(c)
        for (const tok of span) if (tok.k === 'id') namesInsideUnparsedSpans.add(tok.v)
      } else span = collectStatement(c)
      // `initial r = <constant>;` is not a driver competing with the rest of the design — it is the value the
      // register holds at power-on. Read as a driver it CONTENDS with the always block that clocks the same
      // register, and both lose theirs; read for what it is, it is either satisfied by the flip-flop this
      // importer builds or refused by name. The synthesizer decides which, because only it knows which
      // registers are clocked.
      const powerOn = t.v === 'initial' ? initialPowerOnValues(span, widths, signed) : null
      if (powerOn !== null) {
        appendAll(powerOnValues, powerOn)
        continue
      }
      reportFileLoad(span, warnings)
      const targets = t.v === 'defparam' ? null : assignmentTargets(span)
      // `defparam` overrides a parameter somewhere else in the design. It drives nothing itself, but every
      // width and constant computed from that parameter is wrong without it, and there is no net to name.
      warnings.push(
        `line ${t.line}: "${t.v}" is a construct this importer does not build — reported, not built`,
      )
      refusedDrivers.push({
        where: `line ${t.line}`,
        what: `a "${t.v}" construct`,
        terms: targets ?? [],
        ...(targets === null ? { wholeModule: true as const } : {}),
      })
      continue
    }
    if (t.k === 'id') {
      parseInstance(c, instances, refusedDrivers, namesInsideUnparsedSpans, warnings)
      continue
    }
    c.next() // stray token — advance so the loop can never spin
  }
  return {
    name: nameTok.v,
    portOrder,
    portPositions,
    dir,
    gates,
    rawGates,
    assigns,
    alwaysBlocks,
    refusedDrivers,
    powerOnValues,
    flops: [],
    widths,
    mems,
    functions,
    tasks,
    signed,
    resolution,
    instances,
    droppedPorts,
    unrepresentablePorts,
    namesInsideUnparsedSpans,
    unbuilt: { nets: new Set<string>(), constructs: [], wholeModule: false },
  }
}

/**
 * Parse a sub-module instantiation `child #(…) u1 (…), u2 (…);` into one ModuleInst per instance name.
 * Whether `child` names a module in this source is NOT decided here — the flattener owns that, so a UDP or a
 * synthesis-tool cell (yosys' `$_NAND_`) still reports the honest "no such module" rather than a parse error.
 * A `#(…)` list is CAPTURED, not folded: its expressions belong to the enclosing module's scope and the
 * flattener elaborates the child against them. An instance-array range is recorded as `unsupported`: building
 * it anyway would build one copy where the source asked for several, with nothing said.
 */
function parseInstance(
  c: Cursor,
  instances: ModuleInst[],
  refusedDrivers: RefusedDriver[],
  namesInsideUnparsedSpans: Set<string>,
  warnings: string[],
): void {
  const start = c.i
  const modTok = c.next() as Tok
  const line = modTok.line
  let unsupported: string | null = null
  let overrides: ParamOverride[] | null = null
  if (c.is('#')) {
    c.next()
    if (!c.is('(')) {
      // A module instantiation takes a parameter LIST after `#`; a bare `#5` is a delay, which a module
      // instance may not carry. Consume the one token so the instance names still parse, and refuse.
      c.next()
      unsupported = 'a `#` that is not a parameter list (a delay on a module instance)'
    } else {
      overrides = parseOverrideList(readGroup(c))
      if (overrides === null)
        unsupported =
          'a parameter override list that mixes named and positional items, or has an item this importer cannot read'
    }
  }
  let parsedAny = false
  while (!c.atEnd()) {
    const nameTok = c.peek()
    if (nameTok === undefined || nameTok.k !== 'id') break
    c.next()
    let arrayed = false
    while (c.is('[')) {
      readBracketGroup(c)
      arrayed = true
    }
    if (!c.is('(')) break
    const slices = readGroup(c)
    const parsed = parseConnections(slices, modTok.v, nameTok.v, warnings)
    instances.push({
      moduleName: modTok.v,
      instName: nameTok.v,
      conns: parsed.conns,
      named: parsed.named,
      line,
      unsupported: arrayed
        ? 'an instance array (one name covering several copies) is not built'
        : unsupported,
      overrides,
    })
    parsedAny = true
    if (!c.is(',')) break
    c.next()
  }
  if (!parsedAny) {
    warnings.push(
      `line ${line}: instance "${modTok.v}" is not a gate primitive and its instantiation could not be parsed — reported, not built`,
    )
    // Not one connection was read, so there is no net to name as unbuilt — and an instantiation drives
    // through its ports. The only honest answer is that the whole design is unbuilt.
    refusedDrivers.push({
      where: `line ${line}`,
      what: `an unreadable instantiation of "${modTok.v}"`,
      terms: [],
      wholeModule: true,
    })
  }
  if (c.is(';')) c.next()
  else skipStatement(c)
  // A bare `for (…) begin … end` generate loop arrives here as an "instance" of a module called `for`, and
  // skipStatement then swallows the whole body — instantiations and all — without parsing one statement of
  // it. What it held is unknown, so every name in it counts as possibly-instantiated.
  if (!parsedAny)
    for (const t of c.toks.slice(start, c.i)) if (t.k === 'id') namesInsideUnparsedSpans.add(t.v)
}

/** Consume a balanced `[ … ]` group; the cursor must be AT the `[` and is left just past its `]`. */
function readBracketGroup(c: Cursor): void {
  let depth = 0
  while (!c.atEnd()) {
    const t = c.next() as Tok
    if (t.v === '[') depth += 1
    else if (t.v === ']') {
      depth -= 1
      if (depth === 0) return
    }
  }
}

/** Split an instance's `#( … )` list into one item per override. Every item is either named (`.W(4)`) or
 *  positional (`4`) and Verilog does not let the two mix — Icarus rejects `#(4, .B(1))` as a syntax error —
 *  so a mixed list, or an item that is not readable as either form, returns null and the instance is refused
 *  by name rather than built with some of its parameters at their defaults. */
function parseOverrideList(slices: Tok[][]): ParamOverride[] | null {
  const named = slices.some((s) => s[0]?.v === '.')
  const items: ParamOverride[] = []
  for (const s of slices) {
    const first = s[0]
    if (first === undefined) return null
    if (!named) {
      items.push({ name: null, expr: s, line: first.line })
      continue
    }
    const nameTok = s[1]
    if (first.v !== '.' || nameTok === undefined || nameTok.k !== 'id') return null
    const open = s.findIndex((t) => t.v === '(')
    if (open === -1 || (s[s.length - 1] as Tok).v !== ')') return null
    items.push({ name: nameTok.v, expr: s.slice(open + 1, s.length - 1), line: first.line })
  }
  return items
}

/** Split an instance's connection list into named (`.port(expr)`) or positional (`expr`) connections. A
 *  connection with no expression is a deliberately unconnected port — kept, so the flattener can say which
 *  port floats rather than silently shifting the positional order. */
function parseConnections(
  slices: Tok[][],
  moduleName: string,
  instName: string,
  warnings: string[],
): { conns: PortConn[]; named: boolean } {
  const named = slices.some((s) => s[0]?.v === '.')
  const conns: PortConn[] = []
  for (const s of slices) {
    if (!named) {
      conns.push({ port: null, expr: s })
      continue
    }
    const portTok = s[1]
    if (s[0]?.v !== '.' || portTok === undefined || portTok.k !== 'id') {
      warnings.push(
        `line ${s[0]?.line ?? 0}: instance "${instName}" of "${moduleName}" mixes named and positional port connections — the positional one is reported, not connected`,
      )
      continue
    }
    const open = s.findIndex((t) => t.v === '(')
    const expr = open === -1 ? [] : s.slice(open + 1, s.length - 1)
    conns.push({ port: portTok.v, expr })
  }
  return { conns, named }
}

/** Parse a synthesizable `function … endfunction` into a FuncDef. Both header forms are handled: ANSI
 *  `function [7:0] f(input [7:0] a, b);` and classic `function [7:0] f; input [7:0] a; …`. Input/reg/integer
 *  declarations are pulled out (with widths); the remaining tokens are the executable body the synthesizer
 *  elaborates + inlines. Parameters were already substituted to literals by elaborateParams. */
function parseFunction(c: Cursor, functions: Map<string, FuncDef>, warnings: string[]): void {
  const line = c.peek()?.line ?? 0
  c.next() // 'function'
  // A `signed` function return is REFUSED, not warned about and then built. IEEE 1364-2005 §10.3.1 makes the
  // call a signed operand, and a `call` node carries no signedness — so building it zero-extended is a
  // measured wrong answer (Icarus Verilog 14.0 gives 11111111 where this gave 00001111 at a = 15). A refusal
  // costs one function; the warn-and-build cost four silently-flipped output bits.
  let signedReturn: string | null = null
  while (c.peek()?.k === 'kw' && ['automatic', 'signed'].includes(c.peek()?.v as string)) {
    if (c.peek()?.v === 'signed') signedReturn = 'signed'
    c.next()
  }
  // `bad` marks an unsupported declaration (an ascending/nonzero-based/unfoldable range → what would be a
  // silently-wrong width-1 signal). Rather than build the function at the wrong width, drop it + report; a call
  // to it then reports as "unknown function". Never a silent miscompile.
  const bad = { v: false }
  let retWidth = 1
  // A TYPE keyword stands where the return range would: `function integer f;`. Read here, it settles the same
  // width the range would have — and `integer` being signed lands in the refusal above, not in a build.
  const retTypeTok = c.peek()
  const retType = retTypeTok?.k === 'kw' ? VAR_TYPES.get(retTypeTok.v) : undefined
  if (retTypeTok !== undefined && retType !== undefined) {
    c.next()
    if (retType === 'floating-point') {
      warnings.push(
        `line ${line}: a "${retTypeTok.v}" function return is IEEE-754 floating point — this importer has no bit pattern for a fraction — reported, not built`,
      )
      bad.v = true
    } else {
      retWidth = retType.width
      if (retType.signed) signedReturn = retTypeTok.v
    }
  }
  if (c.is('[')) {
    const r = readRange(c)
    // The return range is the function's own WIDTH. Warning about it and keeping the default 1 built every
    // call one bit wide — `function [$clog2(16)-1:0] f;` answered 1 where Icarus Verilog 14.0 answers 15 — so
    // it now drops the function like every other unsupported declaration inside one.
    if ('bad' in r) {
      warnings.push(`line ${line}: function return range — ${r.bad} — reported, not built`)
      bad.v = true
    } else retWidth = r.width
  }
  const nameTok = c.next()
  if (nameTok === undefined || nameTok.k !== 'id') {
    warnings.push(`line ${line}: malformed function declaration — reported`)
    skipToEndfunction(c)
    return
  }
  const name = nameTok.v
  const inputs: { name: string; width: number }[] = []
  const localWidths = new Map<string, number>()
  const signedNames = new Set<string>()
  if (signedReturn !== null) {
    const why =
      signedReturn === 'signed'
        ? ''
        : ` — "${signedReturn}" is a SIGNED ${retWidth}-bit type (IEEE 1364-2005 §3.9)`
    warnings.push(`line ${line}: a signed function return is not built${why} — reported`)
    bad.v = true
  }
  if (c.is('(')) parseFunctionPorts(readGroup(c), inputs, signedNames, warnings, bad)
  if (c.is(';')) c.next()
  const body: Tok[] = []
  while (!c.atEnd() && !c.is('endfunction')) {
    if (c.is('input')) {
      collectDecl(
        c,
        (nm, w, isSigned) => {
          inputs.push({ name: nm, width: w })
          if (isSigned) signedNames.add(nm)
        },
        warnings,
        bad,
      )
      continue
    }
    if (isLocalDecl(c)) {
      collectDecl(
        c,
        (nm, w, isSigned) => {
          localWidths.set(nm, w)
          if (isSigned) signedNames.add(nm)
        },
        warnings,
        bad,
      )
      continue
    }
    body.push(c.next() as Tok)
  }
  if (c.is('endfunction')) c.next()
  if (bad.v) {
    warnings.push(
      `line ${line}: function "${name}" has an unsupported declaration — reported, not built`,
    )
    return
  }
  if (functions.has(name)) warnings.push(`line ${line}: function "${name}" redefined — reported`)
  functions.set(name, { name, retWidth, inputs, localWidths, signedNames, body })
}

/** Is the cursor on a LOCAL variable declaration inside a function/task body? Every typed spelling counts,
 *  not just `reg`/`integer` — a `real r;` left to fall through into the body tokens reported as an
 *  unrecognized statement instead of naming the type it could not build. */
function isLocalDecl(c: Cursor): boolean {
  const t = c.peek()
  if (t === undefined || t.k !== 'kw') return false
  return t.v === 'reg' || t.v === 'wire' || VAR_TYPES.has(t.v)
}

/**
 * Read one `<kw> [reg]? [type]? [signed]? [range]? name {, name} ;` declaration inside a function or task,
 * calling `emit(name, width, signed)` per name (everything before the names is shared across the comma list).
 * Cursor starts AT the leading keyword; leaves it just past `;`.
 *
 * The direction keyword of an ARGUMENT may be followed by the optional `reg` and then a type keyword
 * (IEEE 1364-2005 §10.3.2 / §10.4.2), and reading only the leading keyword missed both: `input integer k`
 * and `input reg [3:0] v` each stood at the default ONE BIT, with every pin present and no warning. The
 * width and signedness now come from VAR_TYPES, the same table the module scope reads. An unsupported range
 * or type sets `bad` (the function/task is then dropped, never built at a silently-wrong width).
 */
function collectDecl(
  c: Cursor,
  emit: (name: string, width: number, isSigned: boolean) => void,
  warnings: string[],
  bad: { v: boolean },
): void {
  const kw = c.next() // 'reg' | 'wire' | 'integer' | 'time' | 'real' | 'input' | 'output' | 'inout'
  let width = 1
  let signed = false
  let typed = false
  const applyType = (t: Tok): void => {
    const type = VAR_TYPES.get(t.v)
    if (type === undefined) return
    if (type === 'floating-point') {
      warnings.push(
        `a "${t.v}" declaration inside a function/task is IEEE-754 floating point — this importer has no bit pattern for a fraction — reported`,
      )
      bad.v = true
      return
    }
    width = type.width
    signed = type.signed
    typed = true
  }
  if (kw !== undefined) applyType(kw)
  if (kw !== undefined && ['input', 'output', 'inout'].includes(kw.v)) {
    if (c.peek()?.k === 'kw' && c.peek()?.v === 'reg') c.next()
    const t = c.peek()
    if (t !== undefined && t.k === 'kw' && VAR_TYPES.has(t.v)) {
      c.next()
      applyType(t)
    }
  }
  // A `signed` local inside a function or task is REFUSED, not silently unsigned: its declared type is what
  // every later read of it takes (§5.5.1), and the type wall it would need is not something a dropped flag can
  // stand in for. The function/task is dropped and a call to it reports as unknown.
  while (c.peek()?.k === 'kw' && c.peek()?.v === 'signed') {
    warnings.push('a `signed` declaration inside a function/task is not built — reported')
    bad.v = true
    c.next()
  }
  if (c.is('[')) {
    const r = readRange(c)
    if ('bad' in r) {
      warnings.push(`function declaration range — ${r.bad} — reported`)
      bad.v = true
    } else if (typed) {
      // `input integer [3:0] k` — a type keyword already fixed the width, so a range on top of it is not
      // legal Verilog and there is no honest width to pick between the two.
      warnings.push(`a range written on a "${kw?.v}" declaration is not legal Verilog — reported`)
      bad.v = true
    } else width = r.width
  }
  while (!c.atEnd() && !c.is(';')) {
    const t = c.next() as Tok
    if (t.k !== 'id') continue
    // A range AFTER the name is an ARRAY dimension — `reg [7:0] t [0:1];` declares two eight-bit words, not
    // one. The dimension used to be skipped in silence along with every other non-identifier token, which
    // registered `t` as a plain 8-bit reg; `t[0]` and `t[1]` then read as BIT-selects of it. MEASURED against
    // Icarus Verilog 14.0 on a function doing `t[0] = v; t[1] = ~v; f = {16'b0, t[0], t[1]};`:
    // 0x00000001 0x00000001 0x00000002 0x00000001 where Icarus reads 0x0000b44b 0x00005aa5 0x000001fe
    // 0x0000807f. An array local is refused by name instead, and the function/task is dropped.
    if (c.is('[')) {
      warnings.push(
        `an array declaration ("${t.v}") inside a function/task is not built — reported`,
      )
      bad.v = true
      continue
    }
    emit(t.v, width, signed)
  }
  if (c.is(';')) c.next()
}

/** The keywords that may stand before the NAME in one ANSI function/task port slice: the direction, the
 *  optional `reg`, `signed`, and any variable type keyword. A word missing from this set is read as the
 *  argument's name — which is how `function f(input integer k)` used to lose `k` entirely and then report
 *  the call as passing one argument too many. */
const PORT_DECL_PREFIX = new Set(['input', 'output', 'inout', 'reg', 'signed', ...VAR_TYPES.keys()])

/** ANSI function port-list slices → inputs (a function has only inputs; the declaration prefix is read off,
 *  the width/signedness are sticky across a bare-name continuation, and a new `input` resets them). An
 *  unsupported range or type sets `bad` so the function is dropped rather than built with a wrong width. */
function parseFunctionPorts(
  slices: Tok[][],
  inputs: { name: string; width: number }[],
  signedNames: Set<string>,
  warnings: string[],
  bad: { v: boolean },
): void {
  let width = 1
  let signed = false
  let typed = false
  // IEEE 1364-2005 §10.3.2: the FIRST port must carry its direction; a later bare name inherits it across the
  // comma list. Without this a direction-less `function f([3:0] v)` — which Icarus Verilog 14.0 rejects with
  // "Missing task/function port direction" — was quietly read as an input.
  let sawDir = false
  for (const s of slices) {
    let j = 0
    while (j < s.length && (s[j] as Tok).k === 'kw' && PORT_DECL_PREFIX.has((s[j] as Tok).v)) {
      const t = s[j] as Tok
      if (t.v === 'input') {
        sawDir = true
        width = 1
        signed = false
        typed = false
      } else if (t.v === 'output' || t.v === 'inout') {
        // IEEE 1364-2005 §10.3.2: a function's arguments are inputs only, and Icarus Verilog 14.0 rejects
        // this outright ("Function arguments must be input ports") — so there is no oracle for a build.
        warnings.push(
          `a function argument declared "${t.v}" is not legal Verilog — §10.3.2 makes every function argument an input — reported`,
        )
        bad.v = true
      } else if (t.v === 'signed') {
        warnings.push('a signed function argument is not built — reported')
        bad.v = true
      } else if (VAR_TYPES.has(t.v)) {
        const type = VAR_TYPES.get(t.v)
        if (type === 'floating-point') {
          warnings.push(
            `a "${t.v}" function argument is IEEE-754 floating point — this importer has no bit pattern for a fraction — reported`,
          )
          bad.v = true
        } else if (type !== undefined) {
          width = type.width
          signed = type.signed
          typed = true
        }
      }
      j += 1
    }
    if ((s[j] as Tok | undefined)?.v === '[') {
      const inner: Tok[] = []
      j += 1
      while (j < s.length && (s[j] as Tok).v !== ']') inner.push(s[j++] as Tok)
      if ((s[j] as Tok | undefined)?.v === ']') j += 1
      const r = rangeWidth(inner)
      if ('bad' in r) {
        warnings.push(`function port range — ${r.bad} — reported`)
        bad.v = true
      } else if (typed) {
        warnings.push(
          'a range written on a typed function argument is not legal Verilog — reported',
        )
        bad.v = true
      } else width = r.width
    }
    const nameTok = s[j] as Tok | undefined
    if (nameTok?.k === 'id') {
      if (!sawDir) {
        warnings.push(
          `function argument "${nameTok.v}" has no direction keyword — §10.3.2 requires one on the first port — reported`,
        )
        bad.v = true
      }
      inputs.push({ name: nameTok.v, width })
      if (signed) signedNames.add(nameTok.v)
    }
  }
}

/** Skip a `function`/`task` body to its `end*` keyword — but ONLY if that keyword exists before `endmodule`;
 *  otherwise rewind (consume nothing) so a malformed function without `endfunction` doesn't swallow the real
 *  module items that follow it. */
function skipToEnd(c: Cursor, endKw: string): void {
  const start = c.i
  while (!c.atEnd() && !c.is('endmodule')) {
    if (c.is(endKw)) {
      c.next()
      return
    }
    c.next()
  }
  c.i = start
}
function skipToEndfunction(c: Cursor): void {
  skipToEnd(c, 'endfunction')
}

/** Parse a `task … endtask` into a TaskDef. Args carry a DIRECTION (input/output/inout); the synthesizer
 *  inlines a call inside a combinational always block, binding inputs and writing outputs back. Both header
 *  forms are handled. An unsupported declaration drops the task (a call to it then reports as unknown). */
function parseTask(c: Cursor, tasks: Map<string, TaskDef>, warnings: string[]): void {
  const line = c.peek()?.line ?? 0
  c.next() // 'task'
  while (c.peek()?.k === 'kw' && ['automatic', 'signed'].includes(c.peek()?.v as string)) {
    if (c.peek()?.v === 'signed')
      warnings.push(`line ${line}: a signed task declaration is treated as UNSIGNED — reported`)
    c.next()
  }
  const nameTok = c.next()
  if (nameTok === undefined || nameTok.k !== 'id') {
    warnings.push(`line ${line}: malformed task declaration — reported`)
    skipToEnd(c, 'endtask')
    return
  }
  const name = nameTok.v
  const args: TaskArg[] = []
  const localWidths = new Map<string, number>()
  const signedNames = new Set<string>()
  const bad = { v: false }
  if (c.is('(')) parseTaskPorts(readGroup(c), args, signedNames, warnings, bad)
  if (c.is(';')) c.next()
  // A task missing its `endtask` must NOT swallow the real module items that follow it — if there is no
  // `endtask` before `endmodule`, rewind to just after the header and report, so those gates still parse.
  const bodyStart = c.i
  const body: Tok[] = []
  while (!c.atEnd() && !c.is('endtask') && !c.is('endmodule')) {
    const kw = c.peek()?.v
    if (kw === 'input' || kw === 'output' || kw === 'inout') {
      const dir = kw
      collectDecl(
        c,
        (nm, w, isSigned) => {
          args.push({ name: nm, width: w, dir })
          if (isSigned) signedNames.add(nm)
        },
        warnings,
        bad,
      )
      continue
    }
    if (isLocalDecl(c)) {
      collectDecl(
        c,
        (nm, w, isSigned) => {
          localWidths.set(nm, w)
          if (isSigned) signedNames.add(nm)
        },
        warnings,
        bad,
      )
      continue
    }
    body.push(c.next() as Tok)
  }
  if (!c.is('endtask')) {
    warnings.push(`line ${line}: task "${name}" is missing its "endtask" — reported, not built`)
    c.i = bodyStart
    return
  }
  c.next() // 'endtask'
  // A local that shadows an argument name is an illegal redeclaration (and would silently overwrite the arg's
  // width) — report + drop rather than build the wrong widths.
  if (args.some((a) => localWidths.has(a.name))) {
    warnings.push(
      `line ${line}: task "${name}" redeclares an argument as a local — reported, not built`,
    )
    return
  }
  if (bad.v) {
    warnings.push(
      `line ${line}: task "${name}" has an unsupported declaration — reported, not built`,
    )
    return
  }
  if (tasks.has(name)) warnings.push(`line ${line}: task "${name}" redefined — reported`)
  tasks.set(name, { name, args, localWidths, signedNames, body })
}

/** ANSI task port-list slices → args with directions (input/output/inout; the declaration prefix is read off
 *  and the width/signedness are sticky across a bare-name continuation). An unsupported range or type sets
 *  `bad` so the task is dropped rather than mis-sized. */
function parseTaskPorts(
  slices: Tok[][],
  args: TaskArg[],
  signedNames: Set<string>,
  warnings: string[],
  bad: { v: boolean },
): void {
  let width = 1
  let signed = false
  let typed = false
  let sawDir = false
  let dir: 'input' | 'output' | 'inout' = 'input'
  for (const s of slices) {
    let j = 0
    while (j < s.length && (s[j] as Tok).k === 'kw' && PORT_DECL_PREFIX.has((s[j] as Tok).v)) {
      const v = (s[j] as Tok).v
      if (v === 'input' || v === 'output' || v === 'inout') {
        dir = v
        sawDir = true
        width = 1
        signed = false
        typed = false
      } else if (v === 'signed') {
        warnings.push('a signed task argument is not built — reported')
        bad.v = true
      } else if (VAR_TYPES.has(v)) {
        const type = VAR_TYPES.get(v)
        if (type === 'floating-point') {
          warnings.push(
            `a "${v}" task argument is IEEE-754 floating point — this importer has no bit pattern for a fraction — reported`,
          )
          bad.v = true
        } else if (type !== undefined) {
          width = type.width
          signed = type.signed
          typed = true
        }
      }
      j += 1
    }
    if ((s[j] as Tok | undefined)?.v === '[') {
      const inner: Tok[] = []
      j += 1
      while (j < s.length && (s[j] as Tok).v !== ']') inner.push(s[j++] as Tok)
      if ((s[j] as Tok | undefined)?.v === ']') j += 1
      const r = rangeWidth(inner)
      if ('bad' in r) {
        warnings.push(`task port range — ${r.bad} — reported`)
        bad.v = true
      } else if (typed) {
        warnings.push('a range written on a typed task argument is not legal Verilog — reported')
        bad.v = true
      } else width = r.width
    }
    const nameTok = s[j] as Tok | undefined
    if (nameTok?.k === 'id') {
      // §10.4.2, as for a function: the first port carries the direction, later bare names inherit it. A
      // direction-less first port is what Icarus rejects as "Missing task/function port direction".
      if (!sawDir) {
        warnings.push(
          `task argument "${nameTok.v}" has no direction keyword — §10.4.2 requires one on the first port — reported`,
        )
        bad.v = true
      }
      args.push({ name: nameTok.v, width, dir })
      if (signed) signedNames.add(nameTok.v)
    }
  }
}

/** Parse an always block. `@(posedge clk)` → a clocked block (clk set); `@*` / `@(*)` / `@(a or b …)` with no
 *  edge → a combinational block (clk null). Returns null (with a warning) for the forms neither path builds:
 *  negedge, or a mixed edge/level sensitivity. */
function parseAlways(
  c: Cursor,
  refusedDrivers: RefusedDriver[],
  warnings: string[],
): AlwaysBlock | null {
  const line = c.peek()?.line ?? 0
  c.next() // 'always'
  const report = (why: string): null => {
    warnings.push(`line ${line}: always block — ${why} — reported, not built`)
    // The block still WROTE every register it assigns. Claiming those targets is what stops the rest of the
    // design from reading them as 0 as though the block had never existed.
    const targets = assignmentTargets(collectStatement(c))
    refusedDrivers.push({
      where: `line ${line}`,
      what: 'an always block this importer cannot build',
      terms: targets ?? [],
      ...(targets === null ? { wholeModule: true as const } : {}),
    })
    return null
  }
  const capture = (clk: string | null, reset: string | null = null): AlwaysBlock => {
    // The body is ONE complete procedural statement (begin…end / if-else / case…endcase aware), so stopping
    // at the first ';' can't truncate a multi-statement block.
    const body: Tok[] = []
    readStatementSpan(c, body)
    return { clk, reset, body, line }
  }
  if (!c.is('@')) return report('only @(…) / @* sensitivity-list always blocks are synthesized')
  c.next() // '@'
  if (c.is('*')) {
    c.next() // bare @* → combinational
    return capture(null)
  }
  if (!c.is('(')) return report('sensitivity list must be @(…) or @*')
  const sens = readGroup(c) // depth-0 comma-separated slices inside @( … )
  const flat = sens.flat()
  if (flat.some((t) => t.v === 'negedge'))
    return report('negedge clocks are not supported (the flip-flop is positive-edge)')
  const posedgeIdx = flat.findIndex((t) => t.v === 'posedge')
  if (posedgeIdx === -1) return capture(null) // no edge → combinational (@(*) or @(a or b …))
  // Split the list on `or` AND on the comma the parser already used to slice it: `posedge clk or posedge rst`
  // and `posedge clk, posedge rst` are the same list written two ways.
  const terms: Tok[][] = []
  for (const slice of sens) {
    let run: Tok[] = []
    for (const t of slice) {
      if (t.k === 'kw' && t.v === 'or') {
        terms.push(run)
        run = []
        continue
      }
      run.push(t)
    }
    terms.push(run)
  }
  const edgeNets: string[] = []
  for (const term of terms) {
    // Every term must be `posedge <net>`: one level-sensitive signal among the edges means the block is not a
    // flip-flop at all, and building it as one would invent an edge the source never asked for.
    if (term.length !== 2 || term[0]?.v !== 'posedge' || term[1]?.k !== 'id')
      return report(
        'an edge mixed with other sensitivity signals (e.g. a level-sensitive signal) is not supported',
      )
    edgeNets.push((term[1] as Tok).v)
  }
  if (edgeNets.length === 1) return capture(edgeNets[0] as string)
  if (edgeNets.length === 2) return capture(edgeNets[0] as string, edgeNets[1] as string)
  return report('more than two posedge signals in one always block is not supported')
}

/** Append one complete procedural statement's tokens to `out`: a begin…end block, an if/else (both branches),
 *  a case…endcase, or a plain statement up to its ';'. Nesting-aware so the synthesizer sees the whole body. */
function readStatementSpan(c: Cursor, out: Tok[]): void {
  const end = statementSpanEnd(c.toks, c.i)
  while (c.i < end) out.push(c.next() as Tok)
}

export const CASE_WORDS = new Set(['case', 'casex', 'casez'])

/** The index just past the closing word that matches the opener at `start`, counting nested openers. */
function nestedSpanEnd(
  toks: Tok[],
  start: number,
  isOpener: (t: Tok) => boolean,
  isCloser: (t: Tok) => boolean,
): number {
  let i = start + 1
  let depth = 1
  while (i < toks.length && depth > 0) {
    const x = toks[i++] as Tok
    if (isOpener(x)) depth += 1
    else if (isCloser(x)) depth -= 1
  }
  return i
}

/** The index just past a `( … )` group whose '(' is at `open`. */
function groupSpanEnd(toks: Tok[], open: number): number {
  let i = open + 1
  let depth = 1
  while (i < toks.length && depth > 0) {
    const v = (toks[i++] as Tok).v
    if (v === '(') depth += 1
    else if (v === ')') depth -= 1
  }
  return i
}

/**
 * The index just past ONE complete procedural statement starting at `start`: a begin…end block, an if/else
 * (both branches), a case…endcase, a loop (its `( … )` header plus its body statement), or a plain statement
 * up to its ';'. Nesting-aware, so an inner ';' never ends the outer statement.
 *
 * The loop unroller in verilog-synth.ts re-parses a loop BODY once per iteration and needs exactly this span,
 * so the two must agree about where a statement ends — hence one implementation, used from both sides.
 *
 * A leading `always`/`initial` is a MODULE ITEM rather than a procedural statement, and only the generate
 * elaborator (verilog-generate.ts) ever asks for one — an always block cannot nest inside another, so the
 * procedural callers never reach this case. It skips the `@( … )` / `@*` header and then takes the body's
 * own span; without it a `always @(posedge clk) begin … end` would stop at the first ';' inside the block.
 */
export function statementSpanEnd(toks: Tok[], start: number): number {
  // Deliberately iterative. Every header this reads — `always @(…)`, `if (…)`, a loop header — is FOLLOWED by
  // the statement it heads, so the whole shape is a scan forward plus a count of how many `if`s are still
  // waiting to see whether an `else` follows their body. Recursing per header made a source's nesting a stack
  // depth instead: MEASURED in fresh processes, `else if (…)` chained 20,000 arms deep and
  // `if (…) if (…) …` nested 20,000 deep BOTH threw `RangeError: Maximum call stack size exceeded` here,
  // before anything downstream had a chance to refuse them by name.
  //
  // The pending count also gives Verilog's dangling-else rule for free: an `else` closes the INNERMOST `if`
  // still waiting, which is the one decremented first.
  let at = start
  let pendingIfs = 0
  for (;;) {
    const t = toks[at]
    if (t === undefined) return at
    if (t.v === 'always' || t.v === 'initial') {
      let i = at + 1
      if ((toks[i] as Tok | undefined)?.v === '@') {
        i += 1
        i = (toks[i] as Tok | undefined)?.v === '(' ? groupSpanEnd(toks, i) : i + 1
      }
      at = i
      continue
    }
    // if/else and the procedural loops: an optional `( … )` header, then a body that is itself one statement.
    // `forever` has no header; only `if` takes an else-branch.
    if (t.v === 'if' || t.v === 'for' || t.v === 'while' || t.v === 'repeat' || t.v === 'forever') {
      let i = at + 1
      if (t.v !== 'forever' && (toks[i] as Tok | undefined)?.v === '(') i = groupSpanEnd(toks, i)
      if (t.v === 'if') pendingIfs += 1
      at = i
      continue
    }
    let end: number
    if (t.v === 'begin')
      end = nestedSpanEnd(
        toks,
        at,
        (x) => x.k === 'kw' && x.v === 'begin',
        (x) => x.k === 'kw' && x.v === 'end',
      )
    else if (CASE_WORDS.has(t.v))
      end = nestedSpanEnd(
        toks,
        at,
        (x) => CASE_WORDS.has(x.v),
        (x) => x.v === 'endcase',
      )
    else {
      let i = at
      while (i < toks.length && (toks[i] as Tok).v !== ';') i += 1
      end = i < toks.length ? i + 1 : i
    }
    let elseBranch = -1
    while (pendingIfs > 0) {
      pendingIfs -= 1
      if ((toks[end] as Tok | undefined)?.v === 'else') {
        elseBranch = end + 1
        break
      }
    }
    if (elseBranch === -1) return end
    at = elseBranch
  }
}

/** Parse `assign <lhs> = <rhs> {, <lhs> = <rhs>} ;` into one Assign per comma-separated assignment. lhs and
 *  rhs are captured as raw token spans; the synthesizer (verilog-synth.ts) parses + sizes + lowers them. */
function parseAssigns(c: Cursor, warnings: string[]): Assign[] {
  c.next() // 'assign'
  // A drive strength and/or a delay may sit between `assign` and the target. Both were being swept into the
  // lhs, so `assign #1 t = a;` reported "assign target must be a net" — naming the wrong thing entirely, since
  // the target IS a net and the delay is what this importer does not model. A delay changes WHEN a net
  // settles, never what it settles to, and this netlist has no timing at all (a gate delay is already
  // reported and the gate still built), so the assignment is built and the delay reported.
  let strength: DriveStrength | undefined
  if (c.is('(') && looksLikeStrength(c)) {
    strength = readStrength(c)
    if (!isDefaultStrength(strength))
      warnings.push(
        'drive strength on a continuous assignment is read only to resolve two drivers on one net — a lone driver puts out the same value whatever its strength — reported',
      )
  }
  if (c.is('#')) {
    const line = c.peek()?.line ?? 0
    c.next()
    if (c.is('(')) readGroup(c)
    else c.next()
    warnings.push(
      `line ${line}: the delay on this continuous assignment is unmodeled — the assignment itself is built, and it settles to the same value`,
    )
  }
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
    out.push({ lhs, rhs, line, strength })
    const sep = c.peek()?.v
    c.next() // consume ',' (more assignments) or ';' (done)
    if (sep !== ',') break
  }
  return out
}

/** Header ports: ANSI (directions inline) or non-ANSI (bare id list, directions come from body decls). */
function parseHeader(
  slices: Tok[][],
  ports: PortTables,
  refusedDrivers: RefusedDriver[],
  warnings: string[],
): void {
  const { portOrder, portPositions, dir, widths, signed, droppedPorts } = ports
  // A header declaration this importer cannot represent — a range that would not fold, or a floating-point
  // type — held until the NAME it belongs to is read so the refusal can say which port it was. It survives a
  // `]` with no identifier after it (malformed, but not a licence to publish), so `pending` is checked once
  // more after the whole list.
  let pending: { reason: PortRefusal; line: number } | undefined
  const keep = (name: string): void => {
    portOrder.push(name)
    portPositions.push(name)
  }
  const drop = (label: string): void => {
    droppedPorts.push(label)
    portPositions.push(null)
  }
  const ansi = slices.some(
    (s) => s[0] !== undefined && ['input', 'output', 'inout'].includes(s[0].v),
  )
  // In an ANSI header a direction keyword governs every following bare identifier until the NEXT direction
  // keyword — `input a, b, output o` declares a AND b as inputs. So `d` persists across the comma-separated
  // slices; the range + signedness reset when a new direction keyword appears.
  let d: 'input' | 'output' | 'inout' | undefined
  let width: number | 'bad' | undefined
  let sgn = false
  let netType: string | undefined
  for (const s of slices) {
    if (s.length === 0) {
      warnings.push('null port position (empty port) is not representable — skipped')
      drop('<null port position>')
      continue
    }
    if (!ansi) {
      const id = s.find((t) => t.k === 'id')
      if (id !== undefined) keep(id.v)
      else {
        warnings.push(
          'port expression (concat/bit-select) in the header is not representable — skipped',
        )
        drop('<port expression>')
      }
      continue
    }
    for (let i = 0; i < s.length; i++) {
      const t = s[i] as Tok
      if (t.k === 'kw' && (t.v === 'input' || t.v === 'output' || t.v === 'inout')) {
        d = t.v
        width = undefined
        sgn = false
        netType = undefined
      } else if (t.k === 'kw' && t.v === 'signed') {
        sgn = true
      } else if (t.k === 'kw' && NET_TYPES.has(t.v)) {
        netType = t.v
      } else if (t.k === 'kw' && VAR_TYPES.has(t.v)) {
        // `output integer y` — a variable port, whose type settles the width the range would otherwise give.
        // Read as an unknown keyword it left the port at the default width 1, and the module published a
        // ONE-PIN `y` where the source declares 32 bits.
        const type = VAR_TYPES.get(t.v)
        if (type === 'floating-point') {
          width = 'bad'
          pending = { reason: (n) => floatingPointPort(n, t.v), line: t.line }
        } else if (d === 'input') {
          width = 'bad'
          pending = { reason: (n) => variableInputPort(n, t.v), line: t.line }
        } else if (type !== undefined) {
          width = type.width
          sgn = type.signed
        }
      } else if (t.k === 'p' && t.v === '[') {
        const inner: Tok[] = []
        i += 1
        while (i < s.length && s[i]?.v !== ']') inner.push(s[i++] as Tok)
        const r = rangeWidth(inner)
        width = 'bad' in r ? 'bad' : r.width
        if ('bad' in r) {
          const { bad } = r
          pending = { reason: (n) => unsizedPort(n, bad), line: t.line }
        }
      } else if (t.k === 'id') {
        if (width === 'bad') {
          dropUnrepresentablePort(
            ports,
            refusedDrivers,
            warnings,
            t.v,
            pending?.line ?? t.line,
            (pending?.reason ?? unfoldableRangePort)(t.v),
          )
          pending = undefined
          drop(t.v)
          continue
        }
        if (d === undefined) {
          warnings.push(
            `port "${t.v}" appears in the header before any direction keyword — skipped`,
          )
          drop(t.v)
          continue
        }
        // The width is registered even though the port is dropped: the net still stands INSIDE the module,
        // and claiming it at its real width is what makes a `b[3]` read unbuilt too. It is not a pin — the
        // drop below takes it out of the interface — so nothing publishes it.
        if (typeof width === 'number' && width > 1) widths.set(t.v, width)
        if (d === 'inout') {
          dropUnrepresentablePort(ports, refusedDrivers, warnings, t.v, t.line, inoutPort(t.v))
          drop(t.v)
          continue
        }
        keep(t.v)
        dir.set(t.v, d)
        if (sgn) signed.add(t.v)
        if (netType !== undefined) applyPortNetType(ports, refusedDrivers, warnings, netType, t)
      }
    }
  }
  if (pending !== undefined) {
    dropUnrepresentablePort(
      ports,
      refusedDrivers,
      warnings,
      '<unnamed header port>',
      pending.line,
      pending.reason('<unnamed header port>'),
    )
    drop('<unnamed header port>')
  }
}

function parsePortDecl(
  c: Cursor,
  ports: PortTables,
  refusedDrivers: RefusedDriver[],
  warnings: string[],
): void {
  const { portOrder, portPositions, dir, widths, signed, droppedPorts } = ports
  // The non-ANSI header already listed this name as a port POSITION. A range that will not fold makes it
  // unrepresentable after the fact, so it has to leave portOrder the same way an inout does — while its
  // position keeps a null place, or every later positional connection would shift onto the wrong pin.
  const dropFromHeader = (name: string): void => {
    const at = portOrder.indexOf(name)
    if (at !== -1) portOrder.splice(at, 1)
    const pos = portPositions.indexOf(name)
    if (pos !== -1) portPositions[pos] = null
    droppedPorts.push(name)
  }
  const d = (c.next() as Tok).v as 'input' | 'output' | 'inout'
  let width: number | 'bad' | undefined // the pending `[N:0]` range for the following ids
  let sgn = false
  let netType: string | undefined
  let lastId: Tok | undefined
  // Held until the NAME arrives, exactly as in parseHeader, so the refusal can say which port it was — and
  // re-checked after the `;` so a range with no identifier behind it cannot publish either.
  let pending: { reason: PortRefusal; line: number } | undefined
  while (!c.atEnd() && !c.is(';')) {
    const t = c.peek() as Tok
    if (t.v === '=') {
      // A net-declaration assignment written on the PORT declaration. Not built — Icarus Verilog 14.0
      // rejects the form outright ("'o2' is not a valid l-value for a procedural assignment"), so there is
      // no oracle to pin a build against, and this project does not ship behaviour it cannot measure. The
      // port is claimed instead, so nothing downstream reads it as 0.
      warnings.push(
        `line ${t.line}: port-declaration continuous assignment (${d} … = …) is behavioral/non-structural — reported, not built`,
      )
      c.next()
      readDeclInitializer(c)
      if (lastId !== undefined)
        refusedDrivers.push({
          where: `line ${t.line}`,
          what: 'a continuous assignment written on a port declaration',
          terms: [[lastId]],
        })
      if (c.is(',')) {
        c.next()
        continue
      }
      break
    }
    if (t.k === 'kw' && t.v === 'signed') {
      sgn = true
      c.next()
      continue
    }
    if (t.k === 'kw' && NET_TYPES.has(t.v)) {
      netType = t.v
      c.next()
      continue
    }
    if (t.k === 'kw' && VAR_TYPES.has(t.v)) {
      // `output integer y;` in the non-ANSI body — the same variable port as in an ANSI header, and the same
      // one-pin publish if its type is left unread.
      const type = VAR_TYPES.get(t.v)
      if (type === 'floating-point') {
        width = 'bad'
        pending = { reason: (n) => floatingPointPort(n, t.v), line: t.line }
      } else if (d === 'input') {
        width = 'bad'
        pending = { reason: (n) => variableInputPort(n, t.v), line: t.line }
      } else if (type !== undefined) {
        width = type.width
        sgn = type.signed
      }
      c.next()
      continue
    }
    if (t.k === 'p' && t.v === '[') {
      const r = readRange(c)
      width = 'bad' in r ? 'bad' : r.width
      if ('bad' in r) {
        const { bad } = r
        pending = { reason: (n) => unsizedPort(n, bad), line: t.line }
      }
      continue
    }
    c.next()
    if (t.k !== 'id') continue
    lastId = t
    if (width === 'bad') {
      dropUnrepresentablePort(
        ports,
        refusedDrivers,
        warnings,
        t.v,
        pending?.line ?? t.line,
        (pending?.reason ?? unfoldableRangePort)(t.v),
      )
      dropFromHeader(t.v)
      pending = undefined
      continue
    }
    // See parseHeader: the width belongs to the net inside the module even when the port is dropped.
    if (typeof width === 'number' && width > 1) widths.set(t.v, width)
    if (d === 'inout') {
      dropUnrepresentablePort(ports, refusedDrivers, warnings, t.v, t.line, inoutPort(t.v))
      dropFromHeader(t.v)
      continue
    }
    dir.set(t.v, d)
    if (sgn) signed.add(t.v)
    if (netType !== undefined) applyPortNetType(ports, refusedDrivers, warnings, netType, t)
  }
  if (c.is(';')) c.next()
  if (pending !== undefined)
    dropUnrepresentablePort(
      ports,
      refusedDrivers,
      warnings,
      '<unnamed port>',
      pending.line,
      pending.reason('<unnamed port>'),
    )
}

function parseNetDecl(
  c: Cursor,
  widths: Map<string, number>,
  mems: Map<string, MemInfo>,
  signed: Set<string>,
  assigns: Assign[],
  resolution: Map<string, 'or' | 'and'>,
  refusedDrivers: RefusedDriver[],
  warnings: string[],
  powerOnValues: PowerOnValue[],
): void {
  const kind = (c.peek() as Tok).v
  const isNet = kind !== 'reg'
  const resolve = NET_RESOLUTION[kind]
  const unmodeled = UNMODELED_NETS[kind]
  const supply = kind === 'supply0' ? 0 : kind === 'supply1' ? 1 : undefined
  c.next() // the net-type or `reg` keyword
  // A drive strength may sit between the net type and the names (`wire (weak1, weak0) t = a;`), where it
  // belongs to the declaration's own assignment. Only `supply0`/`supply1` are reserved words in this lexer, so
  // without this branch `weak1` and `weak0` were read as two ordinary NET NAMES and the strength vanished with
  // no warning at all — the quietest way this importer could lose a driver's strength.
  let declStrength: DriveStrength | undefined
  if (c.is('(') && looksLikeStrength(c)) {
    declStrength = readStrength(c)
    if (!isDefaultStrength(declStrength))
      warnings.push(
        `drive strength on a "${kind}" declaration is read only to resolve two drivers on one net — a lone driver puts out the same value whatever its strength — reported`,
      )
  }
  let width: number | 'bad' | undefined
  let sgn = false
  let lastId: Tok | undefined
  /** A declared name this importer has no WIDTH for. Its size is not one bit — it is unknown — so registering
   *  it as a one-bit net publishes a design whose every read of it is a value the source never wrote (measured:
   *  `wire [$clog2(256)-1:0] z; assign z = 8'hFF;` read 1 where Icarus Verilog 14.0 reads 255, with nothing said
   *  but a warning about the RANGE). Refuse the name instead, exactly as a memory whose range will not fold
   *  already does, and let the transitive-unbuilt rule carry it out to the module pins. */
  const unbuiltDecl = (t: Tok, what: string, why: string): void => {
    warnings.push(`line ${t.line}: ${what} "${t.v}" ${why} — reported, not built`)
    refusedDrivers.push({
      where: `line ${t.line}`,
      what: `the ${what} "${t.v}"`,
      terms: [[t]],
    })
  }
  /** A declared name gets its net type's extra meaning here: a resolution function, a constant supply drive,
   *  or an honest "this importer has no value for it". */
  const applyNetType = (t: Tok, w: number): void => {
    if (resolve !== undefined) resolution.set(t.v, resolve)
    if (supply !== undefined) {
      const all = supply === 0 ? 0n : (1n << BigInt(w)) - 1n
      assigns.push({ lhs: [t], rhs: [{ k: 'num', v: `${w}'d${all}`, line: t.line }], line: t.line })
    }
    if (unmodeled === undefined) return
    warnings.push(
      `line ${t.line}: net "${t.v}" is declared "${kind}", which ${unmodeled} — this importer has no value for that — reported, not built`,
    )
    refusedDrivers.push({
      where: `line ${t.line}`,
      what: `a "${kind}" net declaration`,
      terms: [[t]],
    })
  }
  while (!c.atEnd() && !c.is(';')) {
    const t = c.peek() as Tok
    if (t.v === '=') {
      c.next()
      const rhs = readDeclInitializer(c)
      // On a NET this is exactly `assign name = expr;` (IEEE 1364 §6.1.2) — build it. On a `reg` the same
      // syntax is a variable declaration assignment: IEEE 1364-2005 §6.2.1 makes it EQUIVALENT to an `initial`
      // block assigning the same value, so it is routed to the same power-on path and gets the same answer.
      // Measured on Icarus Verilog 14.0: `reg q = 0;` and `reg r; initial r = 0;` clocked by one always block
      // read identically at power-on and on every edge after it. Building it as a continuous drive instead
      // would wrongly hold the register for ever, which is why it used to be refused outright.
      if (isNet && lastId !== undefined)
        assigns.push({ lhs: [lastId], rhs, line: t.line, strength: declStrength })
      else if (lastId !== undefined && !mems.has(lastId.v))
        powerOnValues.push({ name: lastId.v, expr: rhs, line: t.line })
      else if (lastId !== undefined) {
        // An initializer on an ARRAY is not a power-on value for one register — there is no single width to
        // fold it at and no one word it belongs to, so it stays refused by name.
        warnings.push(
          `line ${t.line}: an initial value on the memory "${lastId.v}" is not modeled — reported, not built`,
        )
        refusedDrivers.push({
          where: `line ${t.line}`,
          what: `an initial value on the memory "${lastId.v}"`,
          terms: [[lastId]],
        })
      }
      if (c.is(',')) {
        c.next()
        continue
      }
      break
    }
    if (t.k === 'kw' && t.v === 'signed') {
      sgn = true
      c.next()
      continue
    }
    if (t.k === 'p' && t.v === '[') {
      const r = readRange(c)
      width = 'bad' in r ? 'bad' : r.width
      if ('bad' in r) warnings.push(`line ${t.line}: bus wire range — ${r.bad} — reported`)
      continue
    }
    c.next()
    if (t.k !== 'id') continue
    lastId = t
    // A SECOND range after the id makes this a MEMORY (`reg [D-1:0] m [0:W-1]`): the first range gives the
    // word width, this one the depth. Register it as an array (not a plain bus) so mem[addr] can read/write it.
    if (c.is('[')) {
      const dr = readDepthRange(c)
      if ('bad' in dr) {
        unbuiltDecl(t, 'memory', `array range — ${dr.bad}`)
        continue
      }
      if (width === 'bad') {
        unbuiltDecl(t, 'memory', 'has an unsupported word range')
        continue
      }
      mems.set(t.v, { width: typeof width === 'number' ? width : 1, depth: dr.depth })
      if (sgn) signed.add(t.v) // a `reg signed […] m […]` — its words read sign-extended
      continue
    }
    if (width === 'bad') {
      unbuiltDecl(t, isNet ? 'net' : 'register', 'has a range this importer cannot size')
      continue
    }
    if (typeof width === 'number' && width > 1) widths.set(t.v, width)
    if (sgn) signed.add(t.v)
    applyNetType(t, typeof width === 'number' ? width : 1)
  }
  if (c.is(';')) c.next()
}

/** Read the right-hand side of a declaration initializer: everything up to the `,` that starts the NEXT
 *  declared name, or the closing `;`. Nesting-aware, so a comma inside `{…}` / `(…)` / `[…]` stays in the
 *  expression. The cursor is left ON that `,` or `;`. */
function readDeclInitializer(c: Cursor): Tok[] {
  const rhs: Tok[] = []
  let depth = 0
  while (!c.atEnd()) {
    const t = c.peek() as Tok
    if (depth === 0 && (t.v === ';' || t.v === ',')) break
    c.next()
    if (t.k === 'p' && (t.v === '(' || t.v === '[' || t.v === '{')) depth += 1
    else if (t.k === 'p' && (t.v === ')' || t.v === ']' || t.v === '}')) depth -= 1
    rhs.push(t)
  }
  return rhs
}

/** The terminal positions a primitive DRIVES: `buf`/`not` drive every terminal but the last (IEEE 1364-2005
 *  §7.3), every other n-input primitive drives only the first. */
const drivenSlices = (prim: string, slices: Tok[][]): Tok[][] =>
  N_OUTPUT[prim] !== undefined ? slices.slice(0, -1) : slices.slice(0, 1)

/** Parse one gate statement: `gatetype [strength] [delay] inst {, inst} ;` — possibly several instances. */
function parseGateStatement(
  c: Cursor,
  gates: GateInst[],
  rawGates: RawGate[],
  refusedDrivers: RefusedDriver[],
  warnings: string[],
): void {
  const prim = (c.next() as Tok).v
  let strength: DriveStrength | undefined
  if (c.is('(') && looksLikeStrength(c)) {
    strength = readStrength(c)
    if (!isDefaultStrength(strength))
      warnings.push(
        `drive strength on "${prim}" is read only to resolve two drivers on one net — a lone driver puts out the same value whatever its strength — reported`,
      )
  }
  if (c.is('#')) {
    warnings.push(`gate delay on "${prim}" is unmodeled — reported`)
    c.next()
    if (c.is('(')) readGroup(c)
    else c.next()
  }
  for (;;) {
    let arrayed = false
    if (c.peek()?.k === 'id' && c.peek(1)?.v === '(')
      c.next() // optional instance name
    else if (c.peek()?.k === 'id' && c.peek(1)?.v === '[') {
      c.next()
      while (c.is('[')) readBracketGroup(c)
      arrayed = true
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
    if (arrayed) {
      // One name covering several copies, each wired to a different slice of the connected buses. Nothing is
      // built — but every terminal it drives is claimed, so the rest of the design cannot read those bits as
      // if the array had never been written.
      warnings.push(
        `line ${line}: an instance array on "${prim}" (one name covering several copies) is not built — reported`,
      )
      if (slices.length >= 2)
        refusedDrivers.push({
          where: `line ${line}`,
          what: `an instance array of the "${prim}" primitive`,
          terms: drivenSlices(prim, slices),
        })
    } else if (clean && terminals.length >= 2) {
      gates.push({ prim, terminals, line, strength })
    } else if (slices.length >= 2) {
      // A terminal that is a bit-select, a constant or an expression (`and g(t[0], a[0], b[0])`) is ordinary
      // Verilog. It is carried to the synthesizer, which is the only place that knows every net's width, and
      // resolved there with the same machinery an `assign` uses — see resolveRawGates.
      rawGates.push({ prim, slices, line, strength })
    } else {
      warnings.push(
        `line ${line}: a "${prim}" instance has fewer than two terminals — reported, not built`,
      )
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

/**
 * Read a switch/tristate primitive statement (`bufif1 g(y, a, en);`, `nmos`, `tran`, `pullup`, …) purely to
 * learn which nets it touches. None of the eighteen has a faithful ChipBlocks image, so nothing is built —
 * but EVERY terminal is claimed as unbuilt, not just the first. `tran`/`tranif` conduct both ways and
 * `pullup`/`pulldown` drive their only terminal, so there is no side of these that is safely a pure input.
 */
function parseSwitchStatement(c: Cursor, refusedDrivers: RefusedDriver[]): void {
  const prim = (c.next() as Tok).v
  if (c.is('(') && looksLikeStrength(c)) readGroup(c)
  if (c.is('#')) {
    c.next()
    if (c.is('(')) readGroup(c)
    else c.next()
  }
  for (;;) {
    if (c.peek()?.k === 'id') c.next() // optional instance name
    while (c.is('[')) readBracketGroup(c) // an instance array — same terminals, more copies
    if (!c.is('(')) break
    const line = c.peek()?.line ?? 0
    const slices = readGroup(c)
    if (slices.length > 0)
      refusedDrivers.push({
        where: `line ${line}`,
        what: `a "${prim}" switch/tristate primitive`,
        terms: slices,
      })
    if (!c.is(',')) break
    c.next()
  }
  if (c.is(';')) c.next()
  else skipStatement(c)
}

/** Is the group at the cursor a drive-strength pair? (one 0-side + one 1-side reserved strength keyword.) */
function looksLikeStrength(c: Cursor): boolean {
  const a = c.peek(1)
  const b = c.peek(3)
  if (a === undefined || b === undefined) return false
  return (STRENGTH0.has(a.v) && STRENGTH1.has(b.v)) || (STRENGTH1.has(a.v) && STRENGTH0.has(b.v))
}
/**
 * Read the `(<0-side>, <1-side>)` group at the cursor (either order) into the pair the synthesizer resolves
 * by. Returns undefined when the group is not exactly one 0-side and one 1-side keyword — the caller then has
 * nothing it may believe, and a strength it cannot read must never become a strength it guessed.
 */
function readStrength(c: Cursor): DriveStrength | undefined {
  const flat = readGroup(c).flat()
  if (flat.length !== 2) return undefined
  const [first, second] = [flat[0] as Tok, flat[1] as Tok]
  const zero = STRENGTH0.has(first.v) ? first.v : STRENGTH0.has(second.v) ? second.v : undefined
  const one = STRENGTH1.has(first.v) ? first.v : STRENGTH1.has(second.v) ? second.v : undefined
  if (zero === undefined || one === undefined) return undefined
  return { one: STRENGTH_LEVEL[one] as StrengthLevel, zero: STRENGTH_LEVEL[zero] as StrengthLevel }
}
/** The strength every unannotated driver already has, so annotating it changes nothing worth reporting. */
function isDefaultStrength(s: DriveStrength | undefined): boolean {
  return s === undefined || (s.one === 'strong' && s.zero === 'strong')
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
  for (const f of mod.flops)
    for (const t of [f.d, f.clk, f.q, ...(f.reset === undefined ? [] : [f.reset])]) usedNets.add(t)
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
    if (f.reset === undefined) {
      add(D_FLIPFLOP_BLOCK, [
        { pin: 'd', net: f.d, isOut: false },
        { pin: 'clk', net: f.clk, isOut: false },
        { pin: 'q', net: f.q, isOut: true },
      ])
      continue
    }
    add(D_FLIPFLOP_CLEAR_BLOCK, [
      { pin: 'd', net: f.d, isOut: false },
      { pin: 'clk', net: f.clk, isOut: false },
      { pin: 'clr', net: f.reset, isOut: false },
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
 *
 * A real design is several files — a CPU core in one, the system that instantiates it in another — so this
 * takes either one source or the list. The files are read as one stream, exactly as a compiler reads them
 * together, and every warning is then relabelled with the file and the line WITHIN that file: a reader given
 * "line 980" for what is line 24 of the second file cannot find what the warning is about.
 */
export function importVerilog(source: string | VerilogSource[]): ImportResult {
  if (typeof source === 'string') return importOneStream(source)
  if (source.length === 0)
    return { block: null, warnings: ['no Verilog source was given'], moduleName: null }
  const only = source[0] as VerilogSource
  if (source.length === 1) return importOneStream(only.text)
  const result = importOneStream(source.map((file) => file.text).join('\n'))
  return { ...result, warnings: nameSourceLines(result.warnings, source) }
}

/** Rewrite every `line N` in a warning to `<file> line <n>`, N being the line of the joined stream. */
function nameSourceLines(warnings: string[], sources: VerilogSource[]): string[] {
  const startsAt: number[] = []
  let next = 1
  for (const file of sources) {
    startsAt.push(next)
    next += file.text.split('\n').length
  }
  const locate = (streamLine: number): string => {
    let k = 0
    while (k + 1 < startsAt.length && (startsAt[k + 1] as number) <= streamLine) k += 1
    return `${(sources[k] as VerilogSource).name} line ${streamLine - (startsAt[k] as number) + 1}`
  }
  return warnings.map((warning) =>
    warning.replace(/\bline (\d+)\b/g, (_whole, digits: string) => locate(Number(digits))),
  )
}

function importOneStream(text: string): ImportResult {
  const { tokens, warnings } = lex(text)
  const modules = new Map<string, ParsedModule>()
  const spans = new Map<string, Tok[]>()
  const declaredParams = new Map<string, ModuleParams>()
  // What each module reported when it was elaborated at its DEFAULT parameter values. An instantiation that
  // overrides a parameter re-elaborates the module, and anything NEW that the module reports at those values
  // — a bus whose range no longer folds, a memory depth that underflowed — means the override produced a
  // module this importer cannot represent. Refusing the instance by name is the only honest answer there:
  // `#(.W(0))` makes `[W-1:0]` two bits wide in Icarus, which our zero-based-only ranges cannot build.
  const defaultReports = new Map<string, Set<string>>()
  const order: string[] = []
  for (const span of splitModuleSpans(tokens)) {
    // Fold + substitute parameters/localparams into literals before parsing, so buses like `[W-1:0]` size
    // correctly and no parameter plumbing threads through the structural + expression parsers. Parameters are
    // module-scoped, so this runs per module span — a `W` in one module never rewrites another's nets.
    const reports: string[] = []
    const elaborated = elaborateModule(span, reports)
    // Generate regions are elaborated AFTER the parameters are folded (so `if (W > 8)` and `i < N` arrive as
    // literals) and BEFORE the module is parsed, so every stage below sees a module that never had one.
    const mod = parseModule(elaborateGenerate(elaborated.toks, reports), reports)
    appendAll(warnings, reports)
    if (mod === null) continue
    if (modules.has(mod.name)) {
      // Keeping the first definition and reporting the second is how this silently built the WRONG design:
      // two files each defining `leaf`, one `assign y = a` and one `assign y = ~a`, published a block that
      // computes the opposite of the second definition with nothing but a warning to say so. Reading several
      // files at once makes that ordinary — a shared cell file listed twice, two revisions of a core in one
      // folder — so two definitions of one module is a refusal, not a note.
      warnings.push(
        `module "${mod.name}" is declared more than once — two definitions of one module cannot both be built, and building the first would mean publishing a design its own source contradicts, so no design is published`,
      )
      return { block: null, warnings, moduleName: mod.name }
    }
    modules.set(mod.name, mod)
    spans.set(mod.name, span)
    declaredParams.set(mod.name, elaborated.params)
    defaultReports.set(mod.name, new Set(reports))
    order.push(mod.name)
  }
  if (order.length === 0) {
    warnings.push('no module declaration found')
    return { block: null, warnings, moduleName: null }
  }
  // Supplied AFTER the source's own modules and never added to `order`: a definition the source itself gives
  // always wins, and a cell nothing instantiates can never become the module chosen as the design.
  const supplied = supplyYosysCells(modules, spans, declaredParams, defaultReports)
  if (supplied.length > 0)
    warnings.push(
      `${supplied.length} gate ${supplied.length === 1 ? 'cell' : 'cells'} this netlist instantiates but does not define (${supplied.join(', ')}) came from the built-in yosys cell library`,
    )
  const topName = chooseTopModule(modules, order, warnings)
  // A port of the module being PUBLISHED that this importer cannot represent has nowhere honest to go. On a
  // sub-module it is merely dropped (a connection to it is refused, an unconnected one costs nothing), but
  // here the drop IS the design: the block would be handed back missing a pin its own source declares, and
  // every later use of it — a wiring, an instantiation, a saved circuit — would be built against an interface
  // the source never described. Measured against Icarus Verilog 14.0: `output [$clog2(16)-1:0] z` published
  // with no z pin at all (ANSI) or a one-bit z reading 1 where Icarus reads 15 (non-ANSI); `inout [7:0] b`
  // published with no b pin at all (ANSI) or a one-bit b (non-ANSI), and the net inside read 1 or 0 where
  // Icarus reads 255 and 170.
  const lostPorts = modules.get(topName)?.unrepresentablePorts ?? []
  if (lostPorts.length > 0) {
    const detail = lostPorts.map((p) => `port "${p.name}" ${p.why}`).join('; ')
    warnings.push(
      `module "${topName}" is NOT built: ${detail}. Publishing would mean inventing an interface this design never described — a block missing a pin its own source declares, or carrying one at a width the source never gave it — so no design is published`,
    )
    return { block: null, warnings, moduleName: topName }
  }
  // Inline every sub-module instance so the synthesizer below sees one flat module, exactly as if the design
  // had been written that way by hand. Nothing overrides the TOP module's parameters, so it keeps the default
  // parse; a sub-module an instantiation parameterises is elaborated again, once per distinct value set.
  const mod = flattenHierarchy(modules, topName, warnings, {
    declared: (name) => declaredParams.get(name),
    elaborate: (name, values) => {
      const span = spans.get(name)
      if (span === undefined) return { failed: `no module "${name}" is defined in this source` }
      const reports: string[] = []
      const elaborated = elaborateModule(span, reports, values)
      if (elaborated.unapplied.length > 0)
        return {
          failed: `a parameter override this importer could not apply to ${elaborated.unapplied.map((n) => `"${n}"`).join(', ')}`,
        }
      const out = parseModule(elaborateGenerate(elaborated.toks, reports), reports)
      if (out === null)
        return { failed: 'a module that could not be read again with these parameters' }
      const known = defaultReports.get(name) as Set<string>
      const added = reports.filter((report) => !known.has(report))
      if (added.length > 0)
        return { failed: `a parameter override that makes "${name}" report ${added[0] as string}` }
      return out
    },
  })
  // Synthesize behavioral RTL — continuous assignments into gates and clocked always-blocks into flip-flops
  // + next-state gates (both appended to mod) — then lower everything.
  synthesizeBehavioral(mod, warnings)
  const refusal = unbuiltRefusal(mod)
  if (refusal !== null) {
    warnings.push(refusal)
    return { block: null, warnings, moduleName: mod.name }
  }
  const block = lower(mod, warnings)
  if (block === null) warnings.push(`module "${mod.name}" has no gate primitives to build`)
  return { block, warnings, moduleName: mod.name }
}

/**
 * Give the collected modules a definition for every yosys gate cell the design instantiates and no file
 * defines (verilog-cells.ts). A cell that does not read back exactly as the library wrote it is NOT supplied:
 * the instance keeps refusing as a module this source does not define, which is the honest answer, rather
 * than a whole CPU being built on a cell this importer got wrong. Returns the names actually supplied.
 */
function supplyYosysCells(
  modules: Map<string, ParsedModule>,
  spans: Map<string, Tok[]>,
  declaredParams: Map<string, ModuleParams>,
  defaultReports: Map<string, Set<string>>,
): string[] {
  const wanted = new Set<string>()
  // hasOwn, not a plain lookup: a module named `constructor` or `toString` would otherwise find one
  // of Object's own properties and be treated as a cell.
  for (const mod of modules.values())
    for (const inst of mod.instances)
      if (!modules.has(inst.moduleName) && Object.hasOwn(YOSYS_CELLS, inst.moduleName))
        wanted.add(inst.moduleName)
  const supplied: string[] = []
  for (const name of [...wanted].sort()) {
    const reports: string[] = []
    const span = splitModuleSpans(lex(YOSYS_CELLS[name] as string).tokens)[0]
    if (span === undefined) continue
    const elaborated = elaborateModule(span, reports)
    const cell = parseModule(elaborateGenerate(elaborated.toks, reports), reports)
    if (cell === null || cell.name !== name || reports.length > 0) continue
    modules.set(name, cell)
    spans.set(name, span)
    declaredParams.set(name, elaborated.params)
    defaultReports.set(name, new Set())
    supplied.push(name)
  }
  return supplied
}

/**
 * The publish decision. A design may be published only when what remains is genuinely complete: every net a
 * skipped construct might have driven is unbuilt, so is everything that reads one (verilog-synth.ts →
 * spreadUnbuilt), and if that reaches an output port there is no honest design to hand over. Refusing and
 * saying which construct caused it is always acceptable; publishing a design whose output reads 0 because a
 * construct was skipped is the worst answer available, and it is what this replaces.
 */
function unbuiltRefusal(mod: ParsedModule): string | null {
  const named = mod.unbuilt.constructs.slice(0, 3).join('; ')
  const more =
    mod.unbuilt.constructs.length > 3 ? ` (and ${mod.unbuilt.constructs.length - 3} more)` : ''
  if (mod.unbuilt.wholeModule)
    return `module "${mod.name}" is NOT built: ${named}${more} — this importer cannot build it and cannot tell which nets it drove, so nothing about this design can be published without inventing values`
  const lost = mod.portOrder.filter((p) => mod.dir.get(p) === 'output' && mod.unbuilt.nets.has(p))
  if (lost.length === 0) return null
  return `module "${mod.name}" is NOT built: ${named}${more} — this importer cannot build ${mod.unbuilt.constructs.length === 1 ? 'it' : 'them'}, and output ${lost.length === 1 ? `"${lost[0]}" is` : `${lost.length} bits (${lost.slice(0, 8).join(', ')}) are`} worked out from what ${mod.unbuilt.constructs.length === 1 ? 'it' : 'they'} would have driven. Publishing would mean inventing those values, so no design is published`
}

/** Split the token stream into one span per `module … endmodule`. Whatever precedes a module (compiler
 *  directives) is kept at the head of its span, so it is still reported exactly where it was. */
function splitModuleSpans(tokens: Tok[]): Tok[][] {
  const spans: Tok[][] = []
  let start = 0
  let inModule = false
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as Tok
    if (t.k !== 'kw') continue
    if (t.v === 'module') inModule = true
    else if (t.v === 'endmodule' && inModule) {
      spans.push(tokens.slice(start, i + 1))
      start = i + 1
      inModule = false
    }
  }
  if (inModule) spans.push(tokens.slice(start))
  return spans
}
