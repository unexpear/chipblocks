/**
 * GENERATE ELABORATION (IEEE 1364-2005 §12.1.3) — the pass that turns `generate` into ordinary module items
 * before anything else reads them.
 *
 * A generate block is not hardware. It is code that says HOW MUCH hardware to create, and it is finished
 * before simulation begins: `for (i = 0; i < 8; i = i + 1) begin : g … end` is eight copies of the body
 * written once, and the eight copies are what a hand-written design would have said. This pass runs on the
 * token stream AFTER parameters have been folded into literals (so `i < WIDTH` arrives as `i < 8`) and BEFORE
 * `parseModule` reads it, so the parser, the hierarchy flattener, the synthesizer and the lowerer are all
 * untouched: they see a module that never had a generate region in it.
 *
 * THE SCOPE RULE IS THE WHOLE FEATURE. Each unrolled iteration is its own scope, so a `wire t` declared in a
 * block labelled `g` is eight DIFFERENT nets — `g[0].t` … `g[7].t` — and not one net with eight drivers.
 * Getting that wrong does not refuse; it builds a circuit that computes something else. So every name an
 * iteration declares is renamed to `<label><sep><n><sep><name>`, where `<sep>` is proven absent from every
 * identifier in the real source (an ESCAPED identifier may contain `.`, and a net literally named `\g[0].t `
 * is legal Verilog — measured — so a hard-coded `.` would fuse two different objects into one wire).
 *
 * THE RENAME ERRS TOWARDS RENAMING, deliberately. A name is left alone only when it is proven to belong to
 * the enclosing scope: a module name, a `.port` in a named connection, or an identifier that appears in the
 * module OUTSIDE every generate region. Everything else — including an IMPLICIT, undeclared net, which Icarus
 * Verilog 14.0 makes per-iteration (measured) — is scoped. Renaming an outer reference by mistake produces a
 * net with no driver, which the existing unbuilt-net rules refuse; failing to rename an inner declaration
 * produces sharing, which builds wrong. Only one of those two mistakes is acceptable, and it is the first.
 *
 * ANYTHING THIS PASS CANNOT ELABORATE IS LEFT EXACTLY AS IT WAS, so the existing refusal in verilog-import.ts
 * fires on it unchanged and the nets it would have driven are poisoned out to the module pins as before.
 * There is no new refusal path here — a region either becomes real module items or stays the construct this
 * importer already declines to build.
 */

import {
  asInteger,
  type ConstVal,
  evalConst,
  type LoopCounter,
  loopAdvance,
  loopContinues,
  loopCounter,
  splitForHeader,
  substituteCounter,
} from './verilog-const.ts'
import { namesAnObject, pickSeparator } from './verilog-hierarchy.ts'
import {
  CASE_WORDS,
  GATE_WORDS,
  NET_TYPES,
  NON_NET_DECLS,
  statementSpanEnd,
  type Tok,
} from './verilog-import.ts'

/** Total unrolled generate iterations allowed in ONE module — the sum across every region and every nesting
 *  depth, so a triple nest cannot expand to billions of items and freeze the app. This is a different budget
 *  from the procedural unroller's (that one is per always block); they are separate constructs with separate
 *  costs. Past it the loop is REFUSED, never truncated: unrolling the first N iterations of a longer loop
 *  builds a design with fewer stages than the source and says nothing about it. */
const MAX_GENERATE_ITERATIONS = 4096

/** A genvar is a signed 32-bit elaboration integer (IEEE 1364-2005 §12.1.3.2) — the same type an `integer`
 *  has, which is why `for (i = 7; i >= 0; i = i - 1)` runs eight times instead of never ending. */
const GENVAR_WIDTH = 32

/** The keywords that DECLARE something inside a module rather than instantiate or drive it. Asked as a
 *  function rather than built into a set here, because verilog-import.ts imports this module and so its own
 *  word lists are still being evaluated when this one loads — reading them at call time is the whole fix. */
const declaresSomething = (word: string): boolean =>
  word === 'reg' || NET_TYPES.has(word) || NON_NET_DECLS.includes(word)

/** Module items a generate body may legally hold and this pass knows how to copy out of it. Anything else —
 *  a parameter, a function, a nested `generate … endgenerate` (which IEEE 1364-2005 does not allow and Icarus
 *  Verilog 14.0 rejects outright) — leaves the region unelaborated. */
const ELABORATABLE = new Set([
  'empty',
  'decl',
  'assign',
  'always',
  'gate',
  'instance',
  'for',
  'if',
  'case',
])

/** The module items that ARE a generate region: the wrapper, and the three constructs IEEE 1364-2005 §12.1.3
 *  also allows to stand at module-item position with no wrapper around them. */
const REGION_KINDS = new Set(['generate', 'for', 'if', 'case'])

type ItemKind =
  | 'empty'
  | 'decl'
  | 'assign'
  | 'always'
  | 'gate'
  | 'instance'
  | 'for'
  | 'generate'
  | 'block'
  | 'if'
  | 'case'
  | 'other'

/** One module item: where it starts and ends, what it is, and what it DECLARES (a net, a memory, an instance
 *  name), plus the module name it instantiates — the one identifier in an item that names something outside
 *  this source and must therefore never be scoped. */
type Item = {
  kind: ItemKind
  start: number
  end: number
  declares: string[]
  moduleName?: string
}

/** What one module's generate elaboration shares across every region in it. */
type Scope = {
  /** a separator proven absent from every identifier in this source */
  sep: string
  /** iterations still allowed anywhere in this module */
  budget: { left: number }
  /** serial number for a generate block with no label of its own to scope to */
  anon: { next: number }
  /** every block label this region has elaborated, so a hierarchical reference to one can be found */
  labels: Set<string>
  /** the names declared as `genvar` anywhere in this module */
  genvars: Set<string>
}

const bad = (why: string): { bad: string } => ({ bad: why })

/** The index just past the first token with this value at or after `from`, or -1 when there is none. */
function pastWord(toks: Tok[], from: number, to: number, word: string): number {
  for (let i = from; i < to; i++) if ((toks[i] as Tok).v === word) return i + 1
  return -1
}

/** The index just past the `;` that ends a plain module item, honouring bracket nesting. */
function pastSemicolon(toks: Tok[], from: number, to: number): number {
  let depth = 0
  for (let i = from; i < to; i++) {
    const v = (toks[i] as Tok).v
    if (v === '(' || v === '[' || v === '{') depth += 1
    else if (v === ')' || v === ']' || v === '}') depth -= 1
    else if (v === ';' && depth === 0) return i + 1
  }
  return -1
}

/** The index just past the `)` closing the `(` at `open`. */
function pastGroup(toks: Tok[], open: number, to: number): number {
  let depth = 0
  for (let i = open; i < to; i++) {
    const v = (toks[i] as Tok).v
    if (v === '(') depth += 1
    else if (v === ')') {
      depth -= 1
      if (depth === 0) return i + 1
    }
  }
  return -1
}

/** The index just past the `endgenerate` / `end` that closes the opener at `start`, counting nested pairs. */
function pastMatching(
  toks: Tok[],
  start: number,
  to: number,
  opener: string,
  closer: string,
): number {
  let depth = 0
  for (let i = start; i < to; i++) {
    const t = toks[i] as Tok
    if (t.k !== 'kw') continue
    if (t.v === opener) depth += 1
    else if (t.v === closer) {
      depth -= 1
      if (depth === 0) return i + 1
    }
  }
  return -1
}

/**
 * The names a declaration introduces: `wire signed [3:0] t, u = a & b;` declares t and u, `reg [7:0] m [0:3];`
 * declares m. A name is only taken at bracket depth zero and only in a NAME position (first, or straight
 * after a top-level comma), so an initializer's operands and a range's bounds are never mistaken for one.
 */
function declaredNames(toks: Tok[], from: number, to: number): string[] {
  const out: string[] = []
  let depth = 0
  let atName = true
  for (let i = from; i < to; i++) {
    const t = toks[i] as Tok
    if (t.v === '(' || t.v === '[' || t.v === '{') depth += 1
    else if (t.v === ')' || t.v === ']' || t.v === '}') depth -= 1
    else if (depth !== 0) continue
    else if (t.v === ';') break
    else if (t.v === ',') atName = true
    else if (t.k === 'id' && atName) {
      out.push(t.v)
      atName = false
    }
  }
  return out
}

/** The instance name a gate primitive gives itself, if any — the first identifier inside the item that is
 *  immediately followed by `(`. A strength `(strong1, strong0)` and a delay `#(2)` open on a keyword and on
 *  `#`, so neither is mistaken for one, and `and (o, a, b);` names nothing. */
function gateInstanceName(toks: Tok[], from: number, to: number): string[] {
  for (let i = from; i < to; i++) {
    const t = toks[i] as Tok
    if (t.k === 'id' && (toks[i + 1] as Tok | undefined)?.v === '(') return [t.v]
  }
  return []
}

/**
 * Read ONE module item starting at `start`. The kind is reported rather than judged, because the same walk
 * serves two callers with different rules: at module level a `function` is ordinary and only `generate` and a
 * bare `for` are interesting, while inside a generate body a `function` has no per-iteration scope and is
 * refused. An item whose extent cannot be determined is reported, and the caller stops walking there rather
 * than resuming in the middle of something and reading an inner `for` as a generate loop.
 */
function readItem(toks: Tok[], start: number, to: number): Item | { bad: string } {
  const t = toks[start] as Tok | undefined
  if (t === undefined) return bad('the module ends in the middle of an item')
  const item = (kind: ItemKind, end: number, extra: Partial<Item> = {}): Item | { bad: string } =>
    end <= start || end > to
      ? bad(`line ${t.line}: "${t.v}" does not end where this importer can see`)
      : { kind, start, end, declares: [], ...extra }

  if (t.v === ';') return item('empty', start + 1)
  if (t.k === 'dir') return item('other', start + 1)
  if (t.k === 'kw') {
    if (t.v === 'end' || t.v === 'endgenerate' || t.v === 'endmodule')
      return bad(`line ${t.line}: an unexpected "${t.v}"`)
    if (t.v === 'generate')
      return item('generate', pastMatching(toks, start, to, 'generate', 'endgenerate'))
    if (t.v === 'begin') return item('block', pastMatching(toks, start, to, 'begin', 'end'))
    if (t.v === 'function') return item('other', pastWord(toks, start, to, 'endfunction'))
    if (t.v === 'task') return item('other', pastWord(toks, start, to, 'endtask'))
    if (t.v === 'specify') return item('other', pastWord(toks, start, to, 'endspecify'))
    if (t.v === 'always' || t.v === 'initial') {
      // A delayed `always #5 begin … end` is the one shape whose body statementSpanEnd would stop short of,
      // and it is not buildable hardware in any case, so it is named here rather than mis-spanned.
      if ((toks[start + 1] as Tok | undefined)?.v === '#')
        return bad(`line ${t.line}: a delayed "${t.v}" block`)
      return item('always', statementSpanEnd(toks, start))
    }
    if (t.v === 'assign') return item('assign', pastSemicolon(toks, start, to))
    if (declaresSomething(t.v)) {
      const end = pastSemicolon(toks, start, to)
      return item('decl', end, {
        declares: declaredNames(toks, start + 1, Math.max(end - 1, start)),
      })
    }
    if (GATE_WORDS.has(t.v)) {
      const end = pastSemicolon(toks, start, to)
      return item('gate', end, {
        declares: gateInstanceName(toks, start + 1, Math.max(end - 1, start)),
      })
    }
    // `parameter`, `localparam`, `defparam`, `input`, `output`, `inout` — legal module items this pass copies
    // at module level and refuses inside a generate body, because none of them is scoped per iteration.
    return item('other', pastSemicolon(toks, start, to))
  }
  if (t.k !== 'id') return bad(`line ${t.line}: "${t.v}" does not start a module item`)
  if (t.v === 'for') return item('for', statementSpanEnd(toks, start))
  if (t.v === 'if') return item('if', statementSpanEnd(toks, start))
  if (CASE_WORDS.has(t.v)) return item('case', statementSpanEnd(toks, start))
  return readInstance(toks, start, to, item)
}

/** `<module> [#( … )] <name> ( … ) ;` — the only id-led module item. An instance ARRAY (`inv u [3:0] (…)`)
 *  is a separate feature the importer already declines, and it stays declined here. */
function readInstance(
  toks: Tok[],
  start: number,
  to: number,
  item: (kind: ItemKind, end: number, extra?: Partial<Item>) => Item | { bad: string },
): Item | { bad: string } {
  const t = toks[start] as Tok
  let j = start + 1
  if ((toks[j] as Tok | undefined)?.v === '#') {
    if ((toks[j + 1] as Tok | undefined)?.v !== '(') return bad(`line ${t.line}: a malformed "#("`)
    j = pastGroup(toks, j + 1, to)
    if (j === -1) return bad(`line ${t.line}: a "#(" that is never closed`)
  }
  const name = toks[j] as Tok | undefined
  if (name === undefined || name.k !== 'id')
    return bad(`line ${t.line}: "${t.v}" is not an instantiation this importer can read`)
  if ((toks[j + 1] as Tok | undefined)?.v === '[')
    return bad(`line ${t.line}: an array of instances`)
  if ((toks[j + 1] as Tok | undefined)?.v !== '(')
    return bad(`line ${t.line}: "${t.v}" is not an instantiation this importer can read`)
  return item('instance', pastSemicolon(toks, start, to), {
    declares: [name.v],
    moduleName: t.v,
  })
}

/** Walk a span as a list of module items, stopping at the first one whose extent cannot be read. */
function readItems(toks: Tok[], from: number, to: number): Item[] | { bad: string } {
  const out: Item[] = []
  let i = from
  while (i < to) {
    const item = readItem(toks, i, to)
    if ('bad' in item) return item
    out.push(item)
    i = item.end
  }
  return out
}

/** The index just past the module header's `;`, or -1 when the header cannot be read. */
function moduleBodyStart(toks: Tok[], moduleStart: number, to: number): number {
  return pastSemicolon(toks, moduleStart, to)
}

/** Every name declared as a `genvar` anywhere in this module. A `for` whose loop variable is not one of them
 *  is not a generate loop at all, and Icarus Verilog 14.0 rejects that source outright. */
function collectGenvars(toks: Tok[], from: number, to: number): Set<string> {
  const out = new Set<string>()
  for (let i = from; i < to; i++) {
    const t = toks[i] as Tok
    if (t.k !== 'kw' || t.v !== 'genvar') continue
    const end = pastSemicolon(toks, i, to)
    if (end === -1) break
    for (const name of declaredNames(toks, i + 1, end - 1)) out.add(name)
    i = end - 1
  }
  return out
}

/** The `begin [: label] … end` a generate block's body is wrapped in, or the bare single item that is its
 *  body. IEEE 1364-2005 makes either one a generate block with its own scope; only the labelled form has a
 *  name, and an unlabelled one is given a serial number that no source identifier can spell. */
function blockWrapper(
  toks: Tok[],
  from: number,
  to: number,
): { label?: string; from: number; to: number } | { bad: string } {
  const first = toks[from] as Tok | undefined
  if (first === undefined) return bad('a generate block with no body')
  if (!(first.k === 'kw' && first.v === 'begin')) return { from, to }
  const end = pastMatching(toks, from, to, 'begin', 'end')
  if (end === -1 || end > to) return bad(`line ${first.line}: a "begin" with no matching "end"`)
  const inner = from + 1
  if ((toks[inner] as Tok | undefined)?.v !== ':') return { from: inner, to: end - 1 }
  const label = toks[inner + 1] as Tok | undefined
  if (label === undefined || label.k !== 'id')
    return bad(`line ${first.line}: a block label this importer cannot read`)
  return { label: label.v, from: inner + 2, to: end - 1 }
}

/**
 * Rename every identifier this iteration owns. A name is left alone only when it is PROVEN to belong to the
 * enclosing design: a name declared outside every generate region, the module a sub-instance names, or a
 * `.port` in a named connection (`substituteParams` in verilog-import.ts carries the same guard, because a
 * module really can declare a port called `i`). A name this block declares is scoped even when the enclosing
 * module declares one of the same name — that is Verilog shadowing, and it is the whole point of the scope.
 */
function renameScope(
  toks: Tok[],
  prefix: string,
  declares: Set<string>,
  moduleNames: Set<string>,
  outer: Set<string>,
): Tok[] {
  return toks.map((t, i) => {
    if (!namesAnObject(t)) return t
    if ((toks[i - 1] as Tok | undefined)?.v === '.') return t
    if (!declares.has(t.v) && (moduleNames.has(t.v) || outer.has(t.v))) return t
    return { ...t, v: prefix + t.v, line: t.line }
  })
}

/** The names one level of items declares, and the modules they instantiate. */
function levelNames(items: Item[]): { declares: Set<string>; moduleNames: Set<string> } {
  const declares = new Set<string>()
  const moduleNames = new Set<string>()
  for (const item of items) {
    for (const name of item.declares) declares.add(name)
    if (item.moduleName !== undefined) moduleNames.add(item.moduleName)
  }
  return { declares, moduleNames }
}

/** One branch of a conditional generate — the `begin … end` or single item a chosen arm generates. */
type Branch = { from: number; to: number }

/** `if ( <constant> ) <genitem> [ else <genitem> ]` split into its condition and its two branch spans. The
 *  branch extents come from `readItem`, the same walk that spans every other module item, so an `else if`
 *  chain arrives here as a whole `if` item and is elaborated by this function again. */
function splitIf(
  toks: Tok[],
  item: Item,
): { cond: Tok[]; whenTrue: Branch; whenFalse?: Branch } | { bad: string } {
  const line = (toks[item.start] as Tok).line
  if ((toks[item.start + 1] as Tok | undefined)?.v !== '(')
    return bad(`line ${line}: a generate if with no "( … )" condition`)
  const condEnd = pastGroup(toks, item.start + 1, item.end)
  if (condEnd === -1) return bad(`line ${line}: a generate if condition that is never closed`)
  const cond = toks.slice(item.start + 2, condEnd - 1)
  const thenItem = readItem(toks, condEnd, item.end)
  if ('bad' in thenItem) return thenItem
  const whenTrue = { from: condEnd, to: thenItem.end }
  if ((toks[thenItem.end] as Tok | undefined)?.v !== 'else') return { cond, whenTrue }
  const elseItem = readItem(toks, thenItem.end + 1, item.end)
  if ('bad' in elseItem) return elseItem
  return { cond, whenTrue, whenFalse: { from: thenItem.end + 1, to: elseItem.end } }
}

/** One arm of a generate case: its label expressions — empty for `default` — and the item it generates. */
type CaseArm = { labels: Tok[][]; body: Branch }

/** The `:` that ends a case arm's labels, or -1. A `?:` in a label would make the first `:` the wrong one and
 *  split the arm in the middle of an expression, so it is reported rather than mis-read. */
function armColon(toks: Tok[], from: number, to: number): number {
  let depth = 0
  for (let i = from; i < to; i++) {
    const v = (toks[i] as Tok).v
    if (v === '(' || v === '[' || v === '{') depth += 1
    else if (v === ')' || v === ']' || v === '}') depth -= 1
    else if (depth !== 0) continue
    else if (v === '?') return -1
    else if (v === ':') return i
  }
  return -1
}

/** `0, 1, 2` → three label spans. An empty span (a stray comma) gives undefined and is reported. */
function splitLabels(toks: Tok[]): Tok[][] | undefined {
  const out: Tok[][] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < toks.length; i++) {
    const v = (toks[i] as Tok).v
    if (v === '(' || v === '[' || v === '{') depth += 1
    else if (v === ')' || v === ']' || v === '}') depth -= 1
    else if (v === ',' && depth === 0) {
      out.push(toks.slice(start, i))
      start = i + 1
    }
  }
  out.push(toks.slice(start))
  return out.some((span) => span.length === 0) ? undefined : out
}

/** `case ( <constant> ) <label> : <genitem> … endcase` split into its selector and its arms, in source order.
 *  `casex`/`casez` are not generate constructs — IEEE 1364-2005 §12.1.3.2 admits `case` alone, and Icarus
 *  Verilog 14.0 answers a generate `casex` with a syntax error — so they are named rather than treated as one. */
function splitCase(
  toks: Tok[],
  item: Item,
): { selector: Tok[]; arms: CaseArm[] } | { bad: string } {
  const head = toks[item.start] as Tok
  if (head.v !== 'case')
    return bad(`line ${head.line}: "${head.v}" is not a generate case — only "case" may be one`)
  if ((toks[item.start + 1] as Tok | undefined)?.v !== '(')
    return bad(`line ${head.line}: a generate case with no "( … )" selector`)
  const selEnd = pastGroup(toks, item.start + 1, item.end)
  if (selEnd === -1) return bad(`line ${head.line}: a generate case selector that is never closed`)
  const arms: CaseArm[] = []
  const endcase = item.end - 1
  let i = selEnd
  while (i < endcase) {
    const t = toks[i] as Tok
    const colon = t.v === 'default' ? i : armColon(toks, i, endcase)
    if (colon === -1) return bad(`line ${t.line}: a generate case arm with no ":"`)
    // `default` may be written with or without its colon; every other arm is one or more label expressions.
    const from = (toks[colon + 1] as Tok | undefined)?.v === ':' ? colon + 2 : colon + 1
    const labels = t.v === 'default' ? [] : splitLabels(toks.slice(i, colon))
    if (labels === undefined)
      return bad(`line ${t.line}: a generate case arm label this importer cannot read`)
    const body = readItem(toks, from, endcase)
    if ('bad' in body) return body
    arms.push({ labels, body: { from, to: body.end } })
    i = body.end
  }
  return { selector: toks.slice(item.start + 2, selEnd - 1), arms }
}

/**
 * Does this case label match the selector? Asked as the single expression `(selector) == (label)` and folded
 * by `evalConst`, so the comparison IS the language's own `==` — the IEEE 1364-2005 §5.5.1 width and
 * signedness rules, already measured against Icarus Verilog 14.0 where this pass would otherwise have grown a
 * second, unmeasured comparison of its own. Measured: Icarus decides a generate-case arm pairwise like this
 * (`case (2'sb11) -1: … 2'b00: …` takes the first arm, which an unsigned-because-some-item-is-unsigned reading
 * would not), and widening both sides of an equality alike can never change its answer.
 */
function labelMatches(selector: Tok[], label: Tok[]): boolean | undefined {
  const line = (selector[0] as Tok | undefined)?.line ?? 0
  const open: Tok = { k: 'p', v: '(', line }
  const close: Tok = { k: 'p', v: ')', line }
  const equals: Tok = { k: 'op', v: '==', line }
  const folded = evalConst(
    [open, ...selector, close, equals, open, ...label, close],
    undefined,
    'self',
  )
  return folded === undefined ? undefined : folded.value !== 0n
}

/**
 * The one branch a conditional generate keeps. Everything else is DISCARDED here and never reaches the output
 * span, so a branch not taken contributes no nets, no gates and no instances — which is what makes a generate
 * if a choice between two designs rather than a mux between them.
 *
 * Every label of every arm is folded even after a match is found. A label this evaluator cannot prove constant
 * therefore refuses the whole case rather than letting an earlier arm win by default: the standard sizes a
 * case comparison against ALL of its item expressions, and an arm whose width is unknown is an arm that cannot
 * be shown not to change the answer.
 */
function chooseBranch(toks: Tok[], item: Item): { taken: Branch | undefined } | { bad: string } {
  const line = (toks[item.start] as Tok).line
  if (item.kind === 'if') {
    const split = splitIf(toks, item)
    if ('bad' in split) return split
    const cond = evalConst(split.cond, undefined, 'self')
    if (cond === undefined)
      return bad(`line ${line}: a generate if condition that is not an elaboration-time constant`)
    return { taken: cond.value !== 0n ? split.whenTrue : split.whenFalse }
  }
  const split = splitCase(toks, item)
  if ('bad' in split) return split
  if (evalConst(split.selector, undefined, 'self') === undefined)
    return bad(`line ${line}: a generate case selector that is not an elaboration-time constant`)
  let fallback: Branch | undefined
  let taken: Branch | undefined
  for (const arm of split.arms) {
    if (arm.labels.length === 0) {
      if (fallback !== undefined)
        return bad(`line ${line}: a generate case with two "default" arms`)
      fallback = arm.body
      continue
    }
    for (const label of arm.labels) {
      const hit = labelMatches(split.selector, label)
      if (hit === undefined)
        return bad(`line ${line}: a generate case label that is not an elaboration-time constant`)
      if (hit && taken === undefined) taken = arm.body
    }
  }
  return { taken: taken ?? fallback }
}

/**
 * Elaborate a span of module items: every generate construct in it is resolved and everything else is copied
 * through unchanged. This is the recursion — a loop body and a chosen branch are each themselves a span of
 * module items, so a nested construct is elaborated by the same code with the outer counter already
 * substituted into its bounds and the outer condition already decided.
 */
function elaborateItems(
  toks: Tok[],
  from: number,
  to: number,
  scope: Scope,
  outer: Set<string>,
): Tok[] | { bad: string } {
  const items = readItems(toks, from, to)
  if ('bad' in items) return items
  // A name declared BESIDE a loop belongs to the scope the loop sits in, not to the loop: a `wire [7:0] wn`
  // written straight inside a generate region is an ordinary module net, and an enclosing block's wire is
  // visible to a nested loop by its plain name. Either way the loop must leave that name alone and let the
  // enclosing scope's own rename (if any) place it — scoping it twice lands it on a net nothing drives.
  const visible = new Set([...outer, ...levelNames(items).declares])
  const out: Tok[] = []
  // Sibling scope names, checked at THIS level only: two generate blocks in one scope may not share a label
  // (Icarus Verilog 14.0 rejects that source), because the two would elaborate to one set of net names and
  // silently share them. A nested block reached once per outer iteration is not a sibling of itself, which is
  // why the set cannot be one shared set for the whole module.
  const siblings = new Set<string>()
  for (const item of items) {
    if (!ELABORATABLE.has(item.kind))
      return bad(
        `line ${(toks[item.start] as Tok).line}: "${(toks[item.start] as Tok).v}" inside a generate block has no scope this importer can give it`,
      )
    if (item.kind === 'for') {
      const unrolled = unrollGenerateFor(toks, item, scope, visible, siblings)
      if ('bad' in unrolled) return unrolled
      out.push(...unrolled.toks)
      continue
    }
    if (item.kind !== 'if' && item.kind !== 'case') {
      out.push(...toks.slice(item.start, item.end))
      continue
    }
    const chosen = chooseBranch(toks, item)
    if ('bad' in chosen) return chosen
    // A false `if` with no `else`, and a `case` that matches no arm and has no `default`, generate nothing at
    // all. That is the construct doing its job, not a failure — the region simply contributes no hardware.
    if (chosen.taken === undefined) continue
    const built = elaborateBranch(toks, chosen.taken, scope, visible, siblings)
    if ('bad' in built) return built
    out.push(...built.toks)
  }
  return out
}

/** The branch a conditional generate kept, elaborated as the generate block it is: labelled if the source
 *  labelled it, and given a serial number no source identifier can spell if it did not. */
function elaborateBranch(
  toks: Tok[],
  branch: Branch,
  scope: Scope,
  outer: Set<string>,
  siblings: Set<string>,
): { toks: Tok[] } | { bad: string } {
  const wrapper = blockWrapper(toks, branch.from, branch.to)
  if ('bad' in wrapper) return wrapper
  const label = claimLabel(wrapper.label, (toks[branch.from] as Tok).line, scope, siblings)
  if (typeof label !== 'string') return label
  return elaborateBlock(toks.slice(wrapper.from, wrapper.to), label, scope, outer)
}

/** Take a generate block's name. Two blocks in ONE scope may not share a label — Icarus Verilog 14.0 rejects
 *  that source, and elaborating it would give the two one set of net names and silently share them. The two
 *  arms of one `if` are not two blocks in one scope: only the taken one is ever elaborated, and sharing a
 *  label across them is legal (measured), which is why the claim happens after the branch is chosen. */
function claimLabel(
  label: string | undefined,
  line: number,
  scope: Scope,
  siblings: Set<string>,
): string | { bad: string } {
  if (label === undefined) return `${scope.sep}b${scope.anon.next++}`
  if (siblings.has(label))
    return bad(`line ${line}: two generate blocks in one scope are both labelled "${label}"`)
  siblings.add(label)
  scope.labels.add(label)
  return label
}

/**
 * ONE generate block, elaborated and then scoped. Whatever the block itself contains is elaborated FIRST, so
 * the rename that follows sees a nested construct's already-scoped names as declarations at this level and
 * puts this level's scope on top of them — which is what makes `g[0].h.t` and `g[1].h.t` two different nets.
 */
function elaborateBlock(
  bodyToks: Tok[],
  label: string,
  scope: Scope,
  outer: Set<string>,
): { toks: Tok[] } | { bad: string } {
  const elaborated = elaborateItems(bodyToks, 0, bodyToks.length, scope, outer)
  if ('bad' in elaborated) return elaborated
  const final = readItems(elaborated, 0, elaborated.length)
  if ('bad' in final) return final
  const { declares, moduleNames } = levelNames(final)
  return { toks: renameScope(elaborated, `${label}${scope.sep}`, declares, moduleNames, outer) }
}

/**
 * ONE GENERATE LOOP, unrolled. The counter is the shared elaboration-time loop counter (verilog-const.ts) —
 * the same one the procedural unroller counts with — fixed at a genvar's signed 32-bit type, and folded with
 * `evalConst`, which returns undefined for everything it cannot prove and so refuses rather than guesses.
 * Each iteration substitutes the counter as a sized literal and RE-READS the body, so `a[i]` becomes an
 * ordinary constant bit-select and meets every existing select rule unchanged.
 */
function unrollGenerateFor(
  toks: Tok[],
  item: Item,
  scope: Scope,
  outer: Set<string>,
  siblings: Set<string>,
): { toks: Tok[] } | { bad: string } {
  const line = (toks[item.start] as Tok).line
  if ((toks[item.start + 1] as Tok | undefined)?.v !== '(')
    return bad(`line ${line}: a generate for with no "( … )" header`)
  const headerEnd = pastGroup(toks, item.start + 1, item.end)
  if (headerEnd === -1) return bad(`line ${line}: a generate for header that is never closed`)
  const header = toks.slice(item.start + 2, headerEnd - 1)
  const fold = (span: Tok[]): ConstVal | undefined => evalConst(span, undefined, 'self')
  const named = splitForHeader(header)
  if (named === undefined)
    return bad(`line ${line}: a for header must read (init; condition; step)`)
  const loopVar = (named[0][0] as Tok | undefined)?.v
  if (loopVar === undefined || !scope.genvars.has(loopVar))
    return bad(
      `line ${line}: "${loopVar ?? '?'}" is not declared as a genvar, so this is not a generate loop`,
    )
  const counter = loopCounter(
    header,
    fold,
    () => GENVAR_WIDTH,
    () => true,
  )
  if ('bad' in counter) return bad(`line ${line}: ${counter.bad}`)

  const wrapper = blockWrapper(toks, headerEnd, item.end)
  if ('bad' in wrapper) return wrapper
  const label = claimLabel(wrapper.label, line, scope, siblings)
  if (typeof label !== 'string') return label
  const bodyToks = toks.slice(wrapper.from, wrapper.to)
  const out: Tok[] = []
  for (;;) {
    const another = loopContinues(counter, fold)
    if ('bad' in another) return bad(`line ${line}: ${another.bad}`)
    if (!another.go) break
    if (scope.budget.left <= 0)
      return bad(
        `line ${line}: unrolling the generate loops in this module needs more than ${MAX_GENERATE_ITERATIONS} iterations`,
      )
    scope.budget.left -= 1
    const one = elaborateIteration(bodyToks, counter, label, scope, outer)
    if ('bad' in one) return bad(`line ${line}: ${one.bad}`)
    out.push(...one.toks)
    const advanced = loopAdvance(counter, fold)
    if (advanced !== undefined) return bad(`line ${line}: ${advanced.bad}`)
  }
  return { toks: out }
}

/** One iteration of one generate loop: substitute the counter, then elaborate and scope the body as the
 *  generate block it is. The iteration's number is part of its name, which is the whole scope rule — `g[0].t`
 *  and `g[1].t` are two nets, and one shared `t` would be a different circuit that never says so. */
function elaborateIteration(
  bodyToks: Tok[],
  counter: LoopCounter,
  label: string,
  scope: Scope,
  outer: Set<string>,
): { toks: Tok[] } | { bad: string } {
  const substituted = substituteCounter(bodyToks, counter)
  if ('bad' in substituted) return substituted
  const index = asInteger({
    value: counter.value,
    width: counter.width,
    signed: true,
    unsized: false,
  })
  return elaborateBlock(substituted, `${label}${scope.sep}${index}`, scope, outer)
}

/**
 * A hierarchical reference INTO a generate scope (`g[3].w`) is real, legal Verilog — Icarus Verilog 14.0
 * compiles and evaluates it — but resolving it to the wrong iteration is a silent wrong answer, so a label
 * that is named anywhere other than at its own `begin :` leaves the region unelaborated. The same check
 * catches a label that collides with a declared net name, which Icarus rejects outright.
 */
function labelIsOnlyDeclared(toks: Tok[], from: number, to: number, label: string): boolean {
  for (let i = from; i < to; i++) {
    const t = toks[i] as Tok
    if (t.k !== 'id' || t.v !== label) continue
    const isDeclaration =
      (toks[i - 1] as Tok | undefined)?.v === ':' &&
      (toks[i - 2] as Tok | undefined)?.k === 'kw' &&
      (toks[i - 2] as Tok | undefined)?.v === 'begin'
    if (!isDeclaration) return false
  }
  return true
}

/** Add every identifier in `[from, to)` to the names a generate region must leave alone. Over-collecting here
 *  is safe: a name an iteration DECLARES is scoped whatever this set says. */
function addNames(toks: Tok[], from: number, to: number, out: Set<string>): void {
  for (let i = from; i < to; i++) if ((toks[i] as Tok).k === 'id') out.add((toks[i] as Tok).v)
}

/**
 * Replace every generate region in one module's token span with the ordinary module items it elaborates to.
 * A region this pass cannot elaborate is left exactly as it was — the importer's existing refusal then names
 * it and poisons the nets it would have driven, which is what happens to every generate region today.
 */
export function elaborateGenerate(toks: Tok[], warnings: string[]): Tok[] {
  const moduleStart = toks.findIndex((t) => t.k === 'kw' && t.v === 'module')
  if (moduleStart === -1) return toks
  const endIndex = toks.findIndex((t, i) => i > moduleStart && t.k === 'kw' && t.v === 'endmodule')
  const moduleEnd = endIndex === -1 ? toks.length : endIndex
  const bodyStart = moduleBodyStart(toks, moduleStart, moduleEnd)
  if (bodyStart === -1) return toks
  const items = readItems(toks, bodyStart, moduleEnd)
  // A module holding an item this walk cannot span is left whole: resuming in the middle of one would read an
  // inner `for` as a module-level generate loop, which is how a procedural loop becomes hardware nobody wrote.
  if ('bad' in items) return toks
  // A generate construct written WITHOUT the `generate … endgenerate` wrapper is legal and common (measured
  // against Icarus Verilog 14.0 for all three forms), and must be recognised here: left alone, a bare `for (`
  // at module-item position reaches the instance reader and is reported as an instantiation of a module
  // called "for".
  const regions = items.filter((item) => REGION_KINDS.has(item.kind))
  if (regions.length === 0) return toks

  const scope: Scope = {
    sep: pickSeparator(new Set(toks.filter((t) => t.k === 'id').map((t) => t.v))),
    budget: { left: MAX_GENERATE_ITERATIONS },
    anon: { next: 0 },
    labels: new Set<string>(),
    genvars: collectGenvars(toks, moduleStart, moduleEnd),
  }
  // The names a region may refer to are the ones written BEFORE it, starting at the `module` keyword so the
  // header's PORTS are in (a port left out is scoped away by every iteration that reads it) and ending where
  // the region does. Measured: Icarus Verilog 14.0 REFUSES to elaborate a generate block that names a net
  // declared later in the same module ("Unable to bind wire/reg/memory `later[i]' in `tb.u.g[0]'"), so a set
  // gathered from the whole module would build a circuit for source no conforming tool will compile.
  const outer = new Set<string>()
  let seen = moduleStart

  const out: Tok[] = toks.slice(0, regions[0]?.start ?? 0)
  regions.forEach((region, n) => {
    addNames(toks, seen, region.start, outer)
    seen = region.end
    const before = scope.labels.size
    const from = region.kind === 'generate' ? region.start + 1 : region.start
    const to = region.kind === 'generate' ? region.end - 1 : region.end
    const elaborated = elaborateItems(toks, from, to, scope, outer)
    const added = [...scope.labels].slice(before)
    const referenced = added.find(
      (label) => !labelIsOnlyDeclared(toks, moduleStart, moduleEnd, label),
    )
    if ('bad' in elaborated || referenced !== undefined) {
      warnings.push(
        `line ${(toks[region.start] as Tok).line}: this generate region is not unrolled — ${
          referenced === undefined
            ? (elaborated as { bad: string }).bad
            : `"${referenced}" is named outside its own generate block, and resolving a hierarchical name into a generated scope is a later increment`
        }`,
      )
      out.push(...toks.slice(region.start, region.end))
    } else out.push(...elaborated)
    out.push(...toks.slice(region.end, regions[n + 1]?.start ?? toks.length))
  })
  return out
}
