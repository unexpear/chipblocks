/**
 * VERILOG HIERARCHY — a design written as several modules is inlined into ONE module before synthesis.
 *
 * Our compiler was good at a single self-contained module; every real CPU published as Verilog is written the
 * other way (a top module wiring up sub-modules). This pass closes that gap WITHOUT touching the synthesizer:
 * each instance's sub-module is copied into its parent with every identifier prefixed by the instance name,
 * and its ports joined to the enclosing nets. What comes out is an ordinary ParsedModule, so gates, assigns,
 * always-blocks, memories, functions and tasks all keep the exact meaning they already had.
 *
 * Two ways a port is joined, and the difference is real:
 *   - the enclosing expression is a plain net of the SAME width AND THE SAME SIGNEDNESS → the port is RENAMED
 *     to that net. No gate is added, so a hierarchical design costs exactly what the same design written flat
 *     costs.
 *   - anything else (a bit-select, a concatenation, a constant, a different width, a different signedness) →
 *     the port keeps its own prefixed net and a continuous assignment joins the two, which the existing
 *     synthesizer lowers with the same width/resize rules any `assign` gets. That costs one buffer per bit,
 *     and it is the honest price of a connection that is not just a rename.
 *
 * Signedness is why the rename cannot be unconditional. `signed` is a property of the DECLARATION that reads a
 * net, not of the wire, and IEEE 1364-2005 §12.3.3 lets the two ends of a port disagree — `sub u(.a(n))` with
 * `input signed [3:0] a` inside and `wire [3:0] n` outside is legal, and each module's own arithmetic uses its
 * own declaration. A rename fuses them into ONE name with ONE signedness, so whichever side declared `signed`
 * would silently change the other side's `>>>`, comparisons, extension and divide. Splitting them into two
 * same-width nets joined by an assignment keeps each declaration's meaning; the copy is bit-for-bit because
 * the widths are equal, so no extension happens at the join itself.
 *
 * A `#( … )` parameter override is applied by ELABORATING THE CHILD AGAIN at the overridden values, which is
 * what the LRM describes and the only way to get it right: the child's own widths, localparams and nested
 * overrides all fold from the new values, top-down. Each distinct value set is one separate copy of the
 * module, so `sub #(.W(4)) u4` and `sub #(.W(2)) u2` in one parent are two different modules that both build.
 *
 * Nothing is invented. An instance of a module this source does not define, a parameter override we cannot
 * apply, an instance array, a recursive instantiation and an unconnected input are each REPORTED and left
 * unbuilt rather than guessed at.
 */

import type { ConstVal } from './verilog-const.ts'
import { evalConst } from './verilog-const.ts'
import type {
  Assign,
  FuncDef,
  ModuleInst,
  ModuleParams,
  ParamDecl,
  ParamOverride,
  ParsedModule,
  TaskDef,
  Tok,
} from './verilog-import.ts'

/**
 * The Verilog-2005 reserved words. Our lexer deliberately classifies only SOME of them as keywords — `if`,
 * `else`, `case`, `posedge` and friends arrive as `id` tokens and the downstream parsers key on their VALUE.
 * So prefixing every `id` token would rewrite `if` to `u1.if` and turn a real if-statement into a task call.
 * A reserved word can never be a plain identifier, so leaving these alone is always safe.
 *
 * Measured, not remembered: every word here was fed to Icarus Verilog 14.0 as `module m; wire <word>; endmodule`
 * and all 124 were rejected. The list is deliberately WIDER than the set our own parsers key on by token value
 * (`if`, `else`, `case`, `endcase`, `posedge`, `negedge`, `for`, `while`, `repeat`, `forever`, `default`,
 * `automatic`, `integer`, `real`, `realtime`, `time` and the words the lexer does mark as keywords): a word
 * this list MISSES is a silent mis-parse, while a word it holds spuriously costs nothing, because a reserved
 * word can never be a plain identifier in the first place. No count is quoted here — the earlier one was off
 * by more than one, and the invariant that matters is coverage, not a total.
 */
const RESERVED_WORDS = new Set(
  `always and assign automatic begin buf bufif0 bufif1 case casex casez cell cmos config deassign default
   defparam design disable edge else end endcase endconfig endfunction endgenerate endmodule endprimitive
   endspecify endtable endtask event for force forever fork function generate genvar highz0 highz1 if ifnone
   incdir include initial inout input instance integer join large liblist library localparam macromodule medium
   module nand negedge nmos nor noshowcancelled not notif0 notif1 or output parameter pmos posedge primitive
   pull0 pull1 pulldown pullup pulsestyle_ondetect pulsestyle_onevent rcmos real realtime reg release repeat
   rnmos rpmos rtran rtranif0 rtranif1 scalared showcancelled signed small specify specparam strong0 strong1
   supply0 supply1 table task time tran tranif0 tranif1 tri tri0 tri1 triand trior trireg unsigned use uwire
   vectored wait wand weak0 weak1 while wire wor xnor xor`
    .split(/\s+/)
    .filter((word) => word.length > 0),
)

/** Every identifier that appears anywhere in the design — used to pick a prefix separator that cannot
 *  collide with a user name. A plain Verilog identifier can never contain `.`, but an ESCAPED one
 *  (`\core.di `) can, so the separator is checked against the real source rather than assumed. */
function collectIdentifiers(modules: Map<string, ParsedModule>): Set<string> {
  const all = new Set<string>()
  const addToks = (toks: Tok[]): void => {
    for (const t of toks) if (t.k === 'id') all.add(t.v)
  }
  for (const mod of modules.values()) {
    all.add(mod.name)
    for (const p of mod.portOrder) all.add(p)
    for (const g of mod.gates) for (const t of g.terminals) all.add(t)
    for (const a of mod.assigns) {
      addToks(a.lhs)
      addToks(a.rhs)
    }
    for (const b of mod.alwaysBlocks) addToks(b.body)
    for (const k of mod.widths.keys()) all.add(k)
    for (const k of mod.mems.keys()) all.add(k)
    for (const inst of mod.instances) all.add(inst.instName)
    for (const rd of mod.refusedDrivers) for (const t of rd.terms) addToks(t)
    for (const fn of mod.functions.values()) addToks(fn.body)
    for (const tk of mod.tasks.values()) addToks(tk.body)
  }
  return all
}

export function pickSeparator(identifiers: Set<string>): string {
  let sep = '.'
  let k = 0
  while ([...identifiers].some((name) => name.includes(sep))) sep = `.h${k++}.`
  return sep
}

/** Everything reachable from `root` by instantiation, `root` itself included. A recursive design terminates
 *  on `seen` rather than spinning; flattenHierarchy is where the recursion is reported. */
function instantiationCone(modules: Map<string, ParsedModule>, root: string): Set<string> {
  const seen = new Set<string>()
  const pending = [root]
  while (pending.length > 0) {
    const name = pending.pop() as string
    if (seen.has(name)) continue
    seen.add(name)
    const mod = modules.get(name)
    if (mod === undefined) continue
    for (const inst of mod.instances)
      if (modules.has(inst.moduleName)) pending.push(inst.moduleName)
  }
  return seen
}

/** The module items that become hardware. Net and parameter declarations are deliberately not counted: they
 *  describe the design, they are not part of it, and a root with many wires is not thereby a bigger design. */
function hardwareItems(mod: ParsedModule): number {
  return (
    mod.gates.length +
    mod.assigns.length +
    mod.alwaysBlocks.length +
    mod.instances.length +
    mod.mems.size
  )
}

/** What is known about one candidate root, all of it read off the design graph rather than off the order the
 *  modules happened to be declared in. */
type RootRank = {
  name: string
  /** False when a port of this module is one the importer must refuse (an inout bus, an unfoldable range).
   *  Choosing such a root cannot end in a design — importVerilog refuses on it the moment it is named. */
  representable: boolean
  /** How much of the source this root accounts for: modules in its cone, then hardware items across them. */
  coneModules: number
  coneItems: number
}

function rankRoot(modules: Map<string, ParsedModule>, name: string): RootRank {
  const cone = instantiationCone(modules, name)
  let coneItems = 0
  for (const inCone of cone) {
    const mod = modules.get(inCone)
    if (mod !== undefined) coneItems += hardwareItems(mod)
  }
  return {
    name,
    representable: (modules.get(name)?.unrepresentablePorts.length ?? 0) === 0,
    coneModules: cone.size,
    coneItems,
  }
}

/** A total order over candidate roots, so sorting cannot depend on the order they arrived in. Best first. */
function betterRoot(a: RootRank, b: RootRank): number {
  if (a.representable !== b.representable) return a.representable ? -1 : 1
  if (a.coneModules !== b.coneModules) return b.coneModules - a.coneModules
  if (a.coneItems !== b.coneItems) return b.coneItems - a.coneItems
  if (a.name === b.name) return 0
  return a.name < b.name ? -1 : 1
}

/** Why the winner beat the runner-up, in the words of whichever rule actually separated them. */
function whyChosen(best: RootRank, next: RootRank): string {
  if (best.representable !== next.representable)
    return `, because "${next.name}" has a port this importer cannot represent and so could only ever be refused`
  if (best.coneModules !== next.coneModules || best.coneItems !== next.coneItems)
    return `, the root that accounts for most of this source (${best.coneModules} of the modules, ${best.coneItems} hardware items, against ${next.coneModules} and ${next.coneItems} for "${next.name}")`
  return `, chosen by name because nothing in the source itself separates it from "${next.name}"`
}

/** The module nothing else instantiates. With exactly one such root that is unambiguously the top; with none
 *  (a cycle) or several (independent designs in one file) one is chosen and WHICH one is said out loud rather
 *  than left to chance.
 *
 *  Chosen, never taken. The choice used to be "the first surviving name in declaration order", which made the
 *  order the user picked files in decide a CPU import: `sys8080.v + vm80a_sync.v` built the 8080 system, and
 *  the same two files the other way round refused, because the thin board wrapper `vm80a` — a genuine root
 *  too, but one whose inout data bus this importer cannot represent — came first. Same inputs, opposite
 *  result. So every rule below reads the design graph instead: a root that could only be refused loses to one
 *  that can be built, then the root accounting for most of the source wins, and a genuine tie is broken by
 *  name and said so. None of them can see what order the modules were declared in.
 *
 *  A span this importer swallowed without parsing — a `generate` body, or a bare `for` generate loop that read
 *  as an unparseable instantiation — is the one place a module instantiation can hide. Nobody read those
 *  lines, so a module instantiated only in there still looks top-level, and choosing it publishes a DIFFERENT
 *  module than the source describes: same port names, wrong logic, and not one word about the answer being
 *  wrong. A module named inside such a span is therefore not a CERTAIN root. When that leaves exactly one
 *  certain root, that root is the top — and the design then refuses on its own unbuilt nets, which is the
 *  honest outcome the caller was owed in the first place. */
export function chooseTopModule(
  modules: Map<string, ParsedModule>,
  order: string[],
  warnings: string[],
): string {
  const instantiated = new Set<string>()
  for (const mod of modules.values())
    for (const inst of mod.instances)
      if (modules.has(inst.moduleName)) instantiated.add(inst.moduleName)
  // `modules.has` only keeps the set small — every name it drops is one no root could match anyway.
  const maybeInstantiated = new Set<string>()
  for (const mod of modules.values())
    for (const name of mod.namesInsideUnparsedSpans)
      if (modules.has(name) && name !== mod.name) maybeInstantiated.add(name)
  const roots = order.filter((name) => !instantiated.has(name))
  if (roots.length === 1) return roots[0] as string
  // With no root at all every module is instantiated by another one, so none of them is the design and the
  // recursion is what the caller will hear about. One is still named, and named the same way whatever order
  // the files arrived in, so that refusal is reproducible too.
  const pool = roots.length > 0 ? roots : order
  const certain = pool.filter((name) => !maybeInstantiated.has(name))
  const contenders = (certain.length > 0 ? certain : pool).map((name) => rankRoot(modules, name))
  contenders.sort(betterRoot)
  const best = contenders[0] as RootRank
  const chosen = best.name
  if (order.length <= 1) return chosen
  const hiddenRoots = roots.filter((name) => maybeInstantiated.has(name)).sort()
  const hiddenNote =
    hiddenRoots.length === 0
      ? ''
      : ` (${hiddenRoots.map((h) => `"${h}"`).join(', ')} ${hiddenRoots.length === 1 ? 'is' : 'are'} named inside a construct this importer did not build, so an instantiation of ${hiddenRoots.length === 1 ? 'it' : 'them'} would not have been seen)`
  const next = contenders[1]
  const reason = next === undefined ? '' : whyChosen(best, next)
  warnings.push(
    roots.length === 0
      ? `every module in this source is instantiated by another (a recursive design) — importing "${chosen}"${reason}`
      : `${order.length} modules found and ${roots.length} of them look top-level (${[...roots].sort().join(', ')})${hiddenNote} — importing "${chosen}"${reason}`,
  )
  return chosen
}

function cloneToks(toks: Tok[]): Tok[] {
  return toks.map((t) => ({ ...t }))
}

function emptyLike(mod: ParsedModule): ParsedModule {
  return {
    name: mod.name,
    portOrder: [...mod.portOrder],
    dir: new Map(mod.dir),
    gates: mod.gates.map((g) => ({ ...g, terminals: [...g.terminals] })),
    rawGates: mod.rawGates.map((g) => ({ ...g, slices: g.slices.map(cloneToks) })),
    refusedDrivers: mod.refusedDrivers.map((r) => ({
      ...r,
      terms: r.terms.map(cloneToks),
    })),
    assigns: mod.assigns.map((a) => ({
      ...a,
      lhs: cloneToks(a.lhs),
      rhs: cloneToks(a.rhs),
    })),
    powerOnValues: mod.powerOnValues.map((v) => ({ ...v })),
    namesInsideUnparsedSpans: new Set(mod.namesInsideUnparsedSpans),
    alwaysBlocks: mod.alwaysBlocks.map((b) => ({
      clk: b.clk,
      reset: b.reset,
      body: cloneToks(b.body),
      line: b.line,
    })),
    flops: [],
    widths: new Map(mod.widths),
    mems: new Map(mod.mems),
    functions: new Map(mod.functions),
    tasks: new Map(mod.tasks),
    signed: new Set(mod.signed),
    resolution: new Map(mod.resolution),
    instances: [],
    droppedPorts: [...mod.droppedPorts],
    unrepresentablePorts: [...mod.unrepresentablePorts],
    portPositions: [...mod.portPositions],
    unbuilt: { nets: new Set<string>(), constructs: [], wholeModule: false },
  }
}

type Rename = (name: string) => string

/** A token names something the sub-module owns when it is an identifier that is not a syntax word — or IS a
 *  syntax word but was written escaped (`\posedge `), which makes it a real net despite spelling one. */
export const namesAnObject = (t: Tok): boolean =>
  t.k === 'id' && (t.escaped === true || !RESERVED_WORDS.has(t.v))

function renameToks(toks: Tok[], rename: Rename): Tok[] {
  return toks.map((t) => (namesAnObject(t) ? { ...t, v: rename(t.v), line: t.line } : t))
}

const renameNames = (names: Set<string>, rename: Rename): Set<string> =>
  new Set([...names].map(rename))

function renameFunction(fn: FuncDef, rename: Rename): FuncDef {
  const localWidths = new Map<string, number>()
  for (const [name, width] of fn.localWidths) localWidths.set(rename(name), width)
  return {
    name: rename(fn.name),
    retWidth: fn.retWidth,
    inputs: fn.inputs.map((i) => ({ name: rename(i.name), width: i.width })),
    localWidths,
    integerLocals: renameNames(fn.integerLocals, rename),
    body: renameToks(fn.body, rename),
  }
}

function renameTask(task: TaskDef, rename: Rename): TaskDef {
  const localWidths = new Map<string, number>()
  for (const [name, width] of task.localWidths) localWidths.set(rename(name), width)
  return {
    name: rename(task.name),
    args: task.args.map((a) => ({ name: rename(a.name), width: a.width, dir: a.dir })),
    localWidths,
    integerLocals: renameNames(task.integerLocals, rename),
    body: renameToks(task.body, rename),
  }
}

/** Map each of the child's declared ports to the enclosing expression it is wired to, `undefined` where the
 *  instance leaves it unconnected. Named and positional forms both land here. */
function resolveConnections(
  inst: ModuleInst,
  child: ParsedModule,
  warnings: string[],
  unrepresentable: Tok[][] = [],
): Map<string, Tok[]> {
  const bound = new Map<string, Tok[]>()
  const where = `line ${inst.line}: instance "${inst.instName}" of "${inst.moduleName}"`
  if (!inst.named) {
    // Positions are counted against portPositions, which keeps a place for every port the parser could not
    // represent. Counting against portOrder instead closed the gap, so every connection past a dropped port
    // landed on the port after it — and the whole instance had to be refused to avoid that. It no longer does.
    if (inst.conns.length > child.portPositions.length)
      warnings.push(
        `${where} passes ${inst.conns.length} positional connections but the module declares ${child.portPositions.length} ports — the extra ones are reported, not connected`,
      )
    inst.conns.forEach((conn, i) => {
      const port = child.portPositions[i]
      if (conn.expr.length === 0 || port === undefined) return
      if (port === null) {
        warnings.push(
          `${where} connects position ${i + 1} to a port this importer cannot represent (${child.droppedPorts.join(', ')}) — reported, not connected`,
        )
        unrepresentable.push(conn.expr)
        return
      }
      bound.set(port, conn.expr)
    })
    return bound
  }
  const declared = new Set(child.portOrder)
  for (const conn of inst.conns) {
    const port = conn.port as string
    if (!declared.has(port)) {
      warnings.push(
        `${where} connects ".${port}", which "${inst.moduleName}" does not declare as a usable port (an inout port is dropped earlier for the same reason) — reported, not connected`,
      )
      if (conn.expr.length > 0) unrepresentable.push(conn.expr)
      continue
    }
    if (bound.has(port)) {
      warnings.push(`${where} connects ".${port}" twice — the second is reported, not connected`)
      continue
    }
    if (conn.expr.length > 0) bound.set(port, conn.expr)
  }
  return bound
}

/**
 * An instance we refuse to build still WROTE a driver for every net its output ports connect to, so those
 * nets are claimed exactly as a built instance would claim them and a second driver on them is still a
 * contention. Nothing is claimed when the connections cannot be aligned to ports (a positional list against a
 * module with a port this importer could not represent) — a guess there would take a driver off the wrong net.
 * The connection warnings are swallowed: the instance has already been reported as not built.
 */
function claimRefusedInstance(
  parent: ParsedModule,
  inst: ModuleInst,
  declared: ParsedModule,
  what: string,
): void {
  const terms: Tok[][] = []
  const bound = resolveConnections(inst, declared, [], terms)
  const where = `line ${inst.line}: instance "${inst.instName}" of "${inst.moduleName}"`
  for (const [port, expr] of bound)
    if (declared.dir.get(port) !== 'input') terms.push(cloneToks(expr))
  if (terms.length > 0) parent.refusedDrivers.push({ where, what, terms })
}

/** An instance of a module this source does not define (a library cell, a UDP). Which of its ports are
 *  outputs is unknowable — the module is not here — so EVERY net it connects to is claimed unbuilt. A
 *  connection list we could not read at all leaves nothing to name, and the whole design goes unbuilt. */
function claimUnknownInstance(parent: ParsedModule, inst: ModuleInst, what: string): void {
  const where = `line ${inst.line}: instance "${inst.instName}" of "${inst.moduleName}"`
  const terms = inst.conns.filter((c) => c.expr.length > 0).map((c) => cloneToks(c.expr))
  parent.refusedDrivers.push(
    terms.length > 0 ? { where, what, terms } : { where, what, terms: [], wholeModule: true },
  )
}

/** Copy one instance's (already flattened) sub-module into `parent`, prefixing every identifier it owns and
 *  joining its ports to the enclosing nets. */
function inlineInstance(
  parent: ParsedModule,
  inst: ModuleInst,
  child: ParsedModule,
  separator: string,
  warnings: string[],
): void {
  const prefix = `${inst.instName}${separator}`
  const alias = new Map<string, string>()
  // `rename` is only ever applied to a name the module OWNS (a net, port, memory, function or task), never to
  // a raw token span, so a reserved word arriving here can only have come from an escaped identifier and is
  // prefixed like any other name. Token spans go through renameToks, which leaves syntax words alone.
  const rename: Rename = (name) => alias.get(name) ?? `${prefix}${name}`
  const unrepresentable: Tok[][] = []
  const bound = resolveConnections(inst, child, warnings, unrepresentable)
  const joins: Assign[] = []
  const where = `line ${inst.line}: instance "${inst.instName}" of "${inst.moduleName}"`
  // A connection to a port the parser could not represent (an inout, a port with a range we cannot read) may
  // be driven from inside the child. The rest of the instance still builds; that one net does not.
  if (unrepresentable.length > 0)
    parent.refusedDrivers.push({
      where,
      what: `a connection to a port of "${inst.moduleName}" this importer cannot represent`,
      terms: unrepresentable.map(cloneToks),
    })

  for (const port of child.portOrder) {
    const portWidth = child.widths.get(port) ?? 1
    const isOutput = child.dir.get(port) === 'output'
    const expr = bound.get(port)
    if (expr === undefined) {
      if (!isOutput) {
        warnings.push(
          `${where} leaves input port "${port}" unconnected — an unconnected input is z in Verilog and this importer has no value for it — reported, not built`,
        )
        parent.refusedDrivers.push({
          where,
          what: `an unconnected input port "${port}" on this instance`,
          terms: [[{ k: 'id', v: `${prefix}${port}`, line: inst.line }]],
        })
      }
      continue
    }
    const only = expr.length === 1 ? (expr[0] as Tok) : undefined
    if (
      only !== undefined &&
      only.k === 'id' &&
      !parent.mems.has(only.v) &&
      (parent.widths.get(only.v) ?? 1) === portWidth &&
      parent.signed.has(only.v) === child.signed.has(port)
    ) {
      alias.set(port, only.v)
      continue
    }
    // The port's own net needs no width or signedness registered here: it is a name the child OWNS, so the
    // wholesale copies of child.widths and child.signed below already carry both under exactly this name
    // (rename leaves an unaliased port at `${prefix}${port}`). Setting them twice was dead code no test
    // could ever distinguish.
    const portNet: Tok = { k: 'id', v: `${prefix}${port}`, line: inst.line }
    // `portJoin` because this buffer is not a driver the source wrote: it carries the child's value at no
    // strength of its own, so a net it lands on must not be resolved by drive strength (see Assign).
    joins.push(
      isOutput
        ? { lhs: cloneToks(expr), rhs: [portNet], line: inst.line, portJoin: true }
        : { lhs: [portNet], rhs: cloneToks(expr), line: inst.line, portJoin: true },
    )
  }

  for (const g of child.gates) parent.gates.push({ ...g, terminals: g.terminals.map(rename) })
  for (const g of child.rawGates)
    parent.rawGates.push({ ...g, slices: g.slices.map((sl) => renameToks(sl, rename)) })
  // A driver the child refused still owns the child's bits; after the copy those bits are the parent's
  // prefixed nets, so the claim has to be renamed exactly like every other token span.
  for (const r of child.refusedDrivers)
    parent.refusedDrivers.push({
      ...r,
      where: `${inst.instName}: ${r.where}`,
      terms: r.terms.map((t) => renameToks(t, rename)),
    })
  for (const a of child.assigns)
    parent.assigns.push({
      ...a,
      lhs: renameToks(a.lhs, rename),
      rhs: renameToks(a.rhs, rename),
    })
  // Spread, never a field list. Listing the fields dropped `index` — the WORD an array power-on loads — the
  // day it was added, and a ROM in a submodule then landed on the SCALAR power-on path at a phantom 1-bit
  // net (`r.m`) instead of on its real word registers (`r.m[0]` … `r.m[3]`). The refusal that should have
  // stopped the design named a net nothing reads, cost nothing, and the module published with every ROM word
  // reading 0. Everything the child recorded about a power-on value except the two names travels unchanged.
  for (const v of child.powerOnValues)
    parent.powerOnValues.push({
      ...v,
      name: rename(v.name),
      expr: renameToks(v.expr, rename),
    })
  for (const b of child.alwaysBlocks)
    parent.alwaysBlocks.push({
      clk: b.clk === null ? null : rename(b.clk),
      reset: b.reset === null ? null : rename(b.reset),
      body: renameToks(b.body, rename),
      line: b.line,
    })
  for (const [name, width] of child.widths) parent.widths.set(rename(name), width)
  for (const [name, info] of child.mems) parent.mems.set(rename(name), info)
  // Carries the child's own signed nets (and any port left unconnected, which has no join above). A port that
  // WAS aliased renames to the enclosing net, and the alias only happened when the two agreed about `signed`,
  // so this can never flip a parent net's signedness out from under the parent's own arithmetic.
  for (const name of child.signed) parent.signed.add(rename(name))
  for (const [name, how] of child.resolution) parent.resolution.set(rename(name), how)
  for (const fn of child.functions.values())
    parent.functions.set(rename(fn.name), renameFunction(fn, rename))
  for (const task of child.tasks.values())
    parent.tasks.set(rename(task.name), renameTask(task, rename))
  parent.assigns.push(...joins)
}

/**
 * Work out the parameter values one instance's `#( … )` list forces on the module it instantiates, or the
 * plain-English reason this importer will not build the instance at all. Every rule below was measured
 * against Icarus Verilog 14.0 rather than remembered:
 *
 *   - a name the module does not declare      → Icarus: "parameter `NOPE` not found" — an ERROR, so we refuse
 *   - a name the module declares localparam   → Icarus: "Cannot override localparam" — an ERROR, so we refuse
 *   - a body parameter, when the module has a header `#( … )` list → Icarus: "Parameter cannot be overridden
 *     in the scope it has been declared in" — an ERROR, so we refuse
 *   - MORE positional items than the module has overridable parameters → Icarus WARNS and builds with the
 *     ones that fit, so we warn and build too; erroring there would diverge from the oracle the other way
 *   - a positional list against a module with NO overridable parameters → the same warn-and-build
 *
 * Positional items count against `parameter` declarations ONLY, in source order, and only against the header
 * list when the module has one. A `localparam` between two parameters does not take a position.
 */
function resolveOverrides(
  inst: ModuleInst,
  declared: ModuleParams,
  warnings: string[],
): Map<string, ConstVal> | { refuse: string } {
  const values = new Map<string, ConstVal>()
  const items = inst.overrides as ParamOverride[]
  if (items.length === 0) return values
  const positional = items.filter((item) => item.name === null)
  if (positional.length > 0 && positional.length !== items.length)
    return { refuse: 'a parameter override list that mixes named and positional items' }
  const overridable = declared.decls.filter(
    (decl) => decl.kind === 'parameter' && (declared.hasHeader ? decl.inHeader : true),
  )
  if (positional.length > 0) {
    const where = `line ${inst.line}: instance "${inst.instName}" of "${inst.moduleName}"`
    if (positional.length > overridable.length)
      warnings.push(
        `${where} passes ${positional.length} parameter ${positional.length === 1 ? 'override' : 'overrides'} but "${inst.moduleName}" has ${overridable.length} overridable ${overridable.length === 1 ? 'parameter' : 'parameters'} — the extra ${positional.length - overridable.length === 1 ? 'one is' : 'ones are'} reported, not applied`,
      )
    for (let i = 0; i < Math.min(positional.length, overridable.length); i++) {
      const decl = overridable[i] as ParamDecl
      const value = evalConst((positional[i] as ParamOverride).expr)
      if (value === undefined)
        return {
          refuse: `a parameter override for "${decl.name}" that is not a constant expression`,
        }
      values.set(decl.name, value)
    }
    return values
  }
  const byName = new Map(declared.decls.map((decl) => [decl.name, decl]))
  for (const item of items) {
    const name = item.name as string
    const decl = byName.get(name)
    if (decl === undefined)
      return {
        refuse: `a parameter override for "${name}", which "${inst.moduleName}" does not declare`,
      }
    if (decl.kind === 'localparam')
      return {
        refuse: `a parameter override for "${name}", which "${inst.moduleName}" declares as a localparam — a localparam cannot be overridden`,
      }
    if (declared.hasHeader && !decl.inHeader)
      return {
        refuse: `a parameter override for "${name}", which "${inst.moduleName}" declares in its body rather than in its #( … ) parameter list — only the parameter list is overridable`,
      }
    if (values.has(name)) return { refuse: `a parameter override that sets "${name}" twice` }
    const value = evalConst(item.expr)
    if (value === undefined)
      return { refuse: `a parameter override for "${name}" that is not a constant expression` }
    values.set(name, value)
  }
  return values
}

/** How this importer re-reads a module at overridden parameter values. `elaborate` returns a FRESH
 *  ParsedModule — never a mutation of the shared default parse, which would leak the override into every
 *  un-overridden instance of the same module — or the plain-English reason it cannot. */
export type OverrideSupport = {
  declared: (moduleName: string) => ModuleParams | undefined
  elaborate: (
    moduleName: string,
    values: Map<string, ConstVal>,
  ) => ParsedModule | { failed: string }
}

/** Bounds on elaboration. A parameter that never converges (`m #(.N(N-1)) u`) has no recursive instantiation
 *  to catch — every copy is a DIFFERENT module — so the two limits below are what stops it. Both refuse by
 *  name; neither ever returns a design. Real hierarchies are nowhere near either: a CPU is ~10 deep. */
const MAX_HIERARCHY_DEPTH = 64
const MAX_PARAMETERISED_COPIES = 256

/**
 * Inline every sub-module instance below `topName` and return one flat ParsedModule. Each module is flattened
 * ONCE PER DISTINCT PARAMETER SET and the result reused per instance, so the same module used many times at
 * the same parameters costs one flatten and N copies. Keying the cache by module name alone was correct only
 * while no instance could change a module's parameters; with overrides it would build the second instance's
 * copy at the first instance's widths, and say nothing.
 */
export function flattenHierarchy(
  modules: Map<string, ParsedModule>,
  topName: string,
  warnings: string[],
  support?: OverrideSupport,
): ParsedModule {
  const separator = pickSeparator(collectIdentifiers(modules))
  const done = new Map<string, ParsedModule>()
  const elaborated = new Map<string, ParsedModule>()
  const onStack = new Set<string>()

  // JSON rather than a joined string: an ESCAPED Verilog identifier can hold nearly any character, so any
  // separator picked here could in principle appear inside a module or parameter name and make two different
  // parameter sets share one entry — exactly the silent-wrong-width collision this key exists to prevent.
  const cacheKey = (name: string, values: Map<string, ConstVal>): string =>
    JSON.stringify([
      name,
      [...values].map(([param, value]) => [param, `${value.value}:${value.width}`]).sort(),
    ])

  /** The child module at these parameter values: the shared default parse when nothing is overridden, else a
   *  fresh elaboration, reused across instances that force the same values. */
  const childModule = (
    name: string,
    values: Map<string, ConstVal>,
    key: string,
    fallback: ParsedModule,
  ): ParsedModule | { failed: string } => {
    if (values.size === 0) return fallback
    const cached = elaborated.get(key)
    if (cached !== undefined) return cached
    if (elaborated.size >= MAX_PARAMETERISED_COPIES)
      return {
        failed: `a design needing more than ${MAX_PARAMETERISED_COPIES} differently-parameterised copies of its modules`,
      }
    const fresh = (support as OverrideSupport).elaborate(name, values)
    if ('failed' in fresh) return fresh
    elaborated.set(key, fresh)
    return fresh
  }

  const flatten = (
    mod: ParsedModule,
    key: string,
    depth: number,
  ): ParsedModule | { failed: string } => {
    const cached = done.get(key)
    if (cached !== undefined) return cached
    if (depth > MAX_HIERARCHY_DEPTH)
      return { failed: `a hierarchy nested more than ${MAX_HIERARCHY_DEPTH} modules deep` }
    onStack.add(key)
    const out = emptyLike(mod)
    const usedNames = new Set<string>()
    for (const inst of mod.instances) {
      const where = `line ${inst.line}: instance "${inst.instName}" of "${inst.moduleName}"`
      const known = modules.get(inst.moduleName)
      const refuse = (reason: string): void => {
        warnings.push(`${where} — ${reason} — reported, not built`)
        const what = `an instance of "${inst.moduleName}" this importer cannot build`
        if (known === undefined) claimUnknownInstance(out, inst, what)
        else claimRefusedInstance(out, inst, known, what)
      }
      if (inst.unsupported !== null) {
        refuse(inst.unsupported)
        continue
      }
      if (known === undefined) {
        warnings.push(
          `${where} — no module "${inst.moduleName}" is defined in this source (a library cell or UDP) — reported, not built`,
        )
        claimUnknownInstance(
          out,
          inst,
          `an instance of "${inst.moduleName}", a module this source does not define`,
        )
        continue
      }
      let values = new Map<string, ConstVal>()
      if (inst.overrides !== null) {
        const declared = support?.declared(inst.moduleName)
        if (support === undefined || declared === undefined) {
          refuse('a parameter override (#(…)) this importer cannot apply here')
          continue
        }
        const resolved = resolveOverrides(inst, declared, warnings)
        if ('refuse' in resolved) {
          refuse(resolved.refuse)
          continue
        }
        values = resolved
      }
      const childKey = cacheKey(inst.moduleName, values)
      if (onStack.has(childKey)) {
        warnings.push(
          `${where} — a module cannot instantiate itself, directly or through another module — reported, not built`,
        )
        claimRefusedInstance(out, inst, known, `a recursive instance of "${inst.moduleName}"`)
        continue
      }
      if (usedNames.has(inst.instName)) {
        warnings.push(`${where} — a second instance shares this name — reported, not built`)
        claimRefusedInstance(out, inst, known, `a duplicate instance name "${inst.instName}"`)
        continue
      }
      usedNames.add(inst.instName)
      const child = childModule(inst.moduleName, values, childKey, known)
      if ('failed' in child) {
        refuse(child.failed)
        continue
      }
      const flat = flatten(child, childKey, depth + 1)
      if ('failed' in flat) {
        refuse(flat.failed)
        continue
      }
      inlineInstance(out, inst, flat, separator, warnings)
    }
    onStack.delete(key)
    done.set(key, out)
    return out
  }

  // Nothing overrides the top module, so it is keyed at the empty parameter set — the same key any
  // un-overridden instance of it would get, had one existed.
  const top = modules.get(topName) as ParsedModule
  const flat = flatten(top, cacheKey(topName, new Map()), 0)
  if (!('failed' in flat)) return flat
  // Unreachable while the depth limit is positive (the top module is at depth 0), but a total function is
  // cheaper than an assertion: whatever went wrong, the design is refused rather than half-built.
  warnings.push(`module "${topName}" — ${flat.failed} — reported, not built`)
  const out = emptyLike(top)
  out.refusedDrivers.push({
    where: `module "${topName}"`,
    what: flat.failed,
    terms: [],
    wholeModule: true,
  })
  return out
}
