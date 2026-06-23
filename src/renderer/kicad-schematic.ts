/**
 * KiCad schematic import (circuit-io, format #2) — rung 3. A `.kicad_sch` file (KiCad 6.0+) is an
 * S-expression document, but unlike SPICE it is GEOMETRIC: there are no net names. Connectivity is
 * inferred from where things physically coincide — a wire end exactly on a symbol pin, a junction dot
 * where wires meet, or two labels sharing a name (KiCad's 50-mil-grid convention keeps them aligned).
 *
 * This file is built in steps: (1) a generic S-expression parser + helpers [done], (2) extract the
 * schematic elements — placed symbols, wires, junctions, labels [done], (3) resolve each symbol's
 * absolute pin coordinates from the library definition + the instance's rotation/mirror [next],
 * (4) geometric net extraction, (5) map lib ids → catalog parts. Coordinates are millimetres.
 */

export type SExpr = string | number | SExpr[]

export function isList(e: SExpr | undefined): e is SExpr[] {
  return Array.isArray(e)
}

/** Direct child lists whose first token matches `name` — e.g. every `(wire …)` under a schematic. */
export function childrenNamed(list: SExpr[], name: string): SExpr[][] {
  return list.filter((c): c is SExpr[] => isList(c) && c[0] === name)
}

/** The first direct child list whose first token matches `name`. */
export function childNamed(list: SExpr[], name: string): SExpr[] | undefined {
  return childrenNamed(list, name)[0]
}

/**
 * Parse KiCad S-expression text into a tree. A list `(token arg …)` becomes an array `[token, …args]`;
 * bare numeric atoms become numbers, quoted strings stay strings (so a quoted "10" stays text, while a
 * bare 10 is a number — matching how KiCad stores values vs coordinates).
 */
export function parseSExpr(text: string): SExpr[] {
  let i = 0
  const peek = () => text.charAt(i)

  const skipWs = () => {
    while (i < text.length && /\s/.test(peek())) i += 1
  }

  const parseAtom = (): string | number => {
    if (peek() === '"') {
      i += 1 // opening quote
      let s = ''
      while (i < text.length && peek() !== '"') {
        if (peek() === '\\' && i + 1 < text.length) {
          i += 1
          s += peek()
        } else {
          s += peek()
        }
        i += 1
      }
      i += 1 // closing quote
      return s
    }
    let s = ''
    while (i < text.length && !/[\s()]/.test(peek())) {
      s += peek()
      i += 1
    }
    const n = Number(s)
    return s.length > 0 && !Number.isNaN(n) ? n : s
  }

  const parseList = (): SExpr[] => {
    const list: SExpr[] = []
    i += 1 // '('
    skipWs()
    while (i < text.length && peek() !== ')') {
      list.push(peek() === '(' ? parseList() : parseAtom())
      skipWs()
    }
    i += 1 // ')'
    return list
  }

  const top: SExpr[] = []
  skipWs()
  while (i < text.length) {
    if (peek() === '(') top.push(parseList())
    else i += 1 // stray character outside a list — skip
    skipWs()
  }
  return top
}

// --- element extraction --------------------------------------------------------------------------

export type Point = { x: number; y: number }
export type KicadSymbol = {
  libId: string
  reference: string
  value: string
  at: { x: number; y: number; angle: number }
  /** 'x' or 'y' if the symbol is mirrored, else absent. */
  mirror?: string
}
export type KicadWire = { a: Point; b: Point }
export type KicadLabel = { text: string } & Point
/** A library symbol's pin in its own local frame: (x, y) is the connection point, plus the pin number. */
export type LibPin = { number: string; x: number; y: number; angle: number }
export type KicadSchematic = {
  symbols: KicadSymbol[]
  wires: KicadWire[]
  junctions: Point[]
  labels: KicadLabel[]
  /** lib_id → its pins (local coords) — for resolving each placed symbol's absolute pin positions. */
  libPins: Map<string, LibPin[]>
}

const num = (e: SExpr | undefined): number => (typeof e === 'number' ? e : 0)
const str = (e: SExpr | undefined): string => (typeof e === 'string' ? e : '')

const atOf = (list: SExpr[]): { x: number; y: number; angle: number } => {
  const at = childNamed(list, 'at')
  return at ? { x: num(at[1]), y: num(at[2]), angle: num(at[3]) } : { x: 0, y: 0, angle: 0 }
}

const propertyOf = (list: SExpr[], name: string): string => {
  for (const p of childrenNamed(list, 'property')) {
    if (p[1] === name) return str(p[2])
  }
  return ''
}

/**
 * Collect each library symbol's pins (local coordinates) from the lib_symbols section. Pins live in the
 * unit sub-symbols (e.g. "R_1_1"); a pin's (at x y) is its connection point and (number "N") its id.
 */
export function extractLibSymbols(sch: SExpr[]): Map<string, LibPin[]> {
  const result = new Map<string, LibPin[]>()
  const libSymbols = childNamed(sch, 'lib_symbols')
  if (libSymbols === undefined) return result
  for (const libSym of childrenNamed(libSymbols, 'symbol')) {
    const pins: LibPin[] = []
    const collect = (container: SExpr[]) => {
      for (const pin of childrenNamed(container, 'pin')) {
        const at = childNamed(pin, 'at')
        if (at === undefined) continue
        pins.push({
          number: str(childNamed(pin, 'number')?.[1]),
          x: num(at[1]),
          y: num(at[2]),
          angle: num(at[3]),
        })
      }
    }
    collect(libSym) // pins defined directly on the symbol
    for (const unit of childrenNamed(libSym, 'symbol')) collect(unit) // pins in unit sub-symbols
    result.set(str(libSym[1]), pins)
  }
  return result
}

/**
 * Pull the placed symbols, wires, junctions, and labels out of a `.kicad_sch` document. (Pin positions
 * and net extraction come in the next steps — this is the structural layer.)
 */
export function extractSchematic(text: string): KicadSchematic {
  const sch = parseSExpr(text).find((e): e is SExpr[] => isList(e) && e[0] === 'kicad_sch')
  if (sch === undefined) {
    return { symbols: [], wires: [], junctions: [], labels: [], libPins: new Map() }
  }

  const symbols: KicadSymbol[] = childrenNamed(sch, 'symbol').map((sym) => {
    // A placed instance carries (lib_id "Device:R"); a library definition names it positionally.
    const libIdChild = childNamed(sym, 'lib_id')
    const libId = libIdChild ? str(libIdChild[1]) : str(sym[1])
    const mirror = childNamed(sym, 'mirror')
    return {
      libId,
      reference: propertyOf(sym, 'Reference'),
      value: propertyOf(sym, 'Value'),
      at: atOf(sym),
      ...(mirror ? { mirror: str(mirror[1]) } : {}),
    }
  })

  const wires: KicadWire[] = childrenNamed(sch, 'wire').map((w) => {
    const pts = childNamed(w, 'pts')
    const xys = pts ? childrenNamed(pts, 'xy') : []
    const a = xys[0]
    const b = xys[1]
    return { a: { x: num(a?.[1]), y: num(a?.[2]) }, b: { x: num(b?.[1]), y: num(b?.[2]) } }
  })

  const junctions: Point[] = childrenNamed(sch, 'junction').map((j) => {
    const at = atOf(j)
    return { x: at.x, y: at.y }
  })

  const labels: KicadLabel[] = [
    ...childrenNamed(sch, 'label'),
    ...childrenNamed(sch, 'global_label'),
    ...childrenNamed(sch, 'hierarchical_label'),
  ].map((l) => {
    const at = atOf(l)
    return { text: str(l[1]), x: at.x, y: at.y }
  })

  return { symbols, wires, junctions, labels, libPins: extractLibSymbols(sch) }
}
