/**
 * KiCad schematic import (circuit-io, format #2) — rung 3. A `.kicad_sch` file (KiCad 6.0+) is an
 * S-expression document, but unlike SPICE it is GEOMETRIC: there are no net names. Connectivity is
 * inferred from where things physically coincide — a wire end exactly on a symbol pin, a junction dot
 * where wires meet, or two labels sharing a name (KiCad's 50-mil-grid convention keeps them aligned).
 *
 * This file is built in steps: (1) a generic S-expression parser + helpers [done], (2) extract the
 * schematic elements — placed symbols, wires, junctions, labels [done], (3) resolve each symbol's
 * absolute pin coordinates from the library definition + the instance's rotation/mirror [done], (4)
 * geometric net extraction by coordinate coincidence [done], (5) map lib ids → catalog parts and
 * emit a CircuitFile so the sheet opens on the canvas [done]. Coordinates are millimetres.
 */

import {
  CIRCUIT_FILE_FORMAT,
  CIRCUIT_FILE_VERSION,
  type CircuitFile,
  type SavedNode,
  type SavedWire,
} from './circuit-file.ts'
import { defaultParameters, type Parameters } from './part-defaults.ts'
import { parseSpiceValue } from './spice-netlist.ts'

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
/** A library symbol's pin in its own local frame: (x, y) is the connection point, plus the pin number + name. */
export type LibPin = { number: string; name: string; x: number; y: number; angle: number }
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
          name: str(childNamed(pin, 'name')?.[1]),
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

// --- geometric net extraction (the net-builder) --------------------------------------------------

/** A device pin resolved to its absolute sheet position. */
export type ResolvedPin = {
  reference: string
  value: string
  libId: string
  pinNumber: string
  pinName: string
  x: number
  y: number
}

/** One extracted net: the device pins on it, plus a name if a label / power port sits on it. */
export type KicadNet = {
  pins: { reference: string; pinNumber: string; pinName: string }[]
  name: string | undefined
}

/**
 * Place a library pin's LOCAL coordinates onto the sheet for a placed symbol. KiCad draws library
 * symbols Y-up but the sheet is Y-down, so the base orientation already flips Y; each rotation is
 * that flip composed with a rotation (calibrated against real files — a placed resistor's pins must
 * land exactly on the wires it joins). A mirror flips one axis in the symbol's own frame first.
 */
function transformPin(sym: KicadSymbol, px: number, py: number): { x: number; y: number } {
  // Per-angle offset, calibrated against real files (a consistent 90° rotation family on KiCad's
  // Y-down sheet): 0 → (px,−py), 90 → (−py,−px), 180 → (−px,py), 270 → (py,px).
  const angle = ((Math.round(sym.at.angle) % 360) + 360) % 360
  let ox: number
  let oy: number
  if (angle === 90) {
    ox = -py
    oy = -px
  } else if (angle === 180) {
    ox = -px
    oy = py
  } else if (angle === 270) {
    ox = py
    oy = px
  } else {
    ox = px
    oy = -py
  }
  // Mirror is applied AFTER the rotation (also calibrated): mirror x flips the Y output, mirror y
  // flips the X output.
  if (sym.mirror === 'x') oy = -oy
  else if (sym.mirror === 'y') ox = -ox
  return { x: sym.at.x + ox, y: sym.at.y + oy }
}

/** A power port (power:+5V, power:GND, …) names a net; it is not a device. */
const isPowerPort = (libId: string) => libId.startsWith('power:')

/**
 * Resolve every DEVICE pin to its absolute sheet position. Power ports are skipped here — they name
 * nets rather than carry current, and are folded in by buildNets.
 */
export function resolvePinPositions(sch: KicadSchematic): ResolvedPin[] {
  const out: ResolvedPin[] = []
  for (const sym of sch.symbols) {
    if (isPowerPort(sym.libId)) continue
    const pins = sch.libPins.get(sym.libId)
    if (pins === undefined) continue
    for (const pin of pins) {
      const at = transformPin(sym, pin.x, pin.y)
      out.push({
        reference: sym.reference,
        value: sym.value,
        libId: sym.libId,
        pinNumber: pin.number,
        pinName: pin.name,
        x: at.x,
        y: at.y,
      })
    }
  }
  return out
}

/**
 * Build the electrical nets from the page geometry — KiCad has no net names, so connectivity is
 * pure coincidence: a pin exactly on a wire end, wires meeting at a junction, and (the teleport)
 * any two labels / power ports that share a name. A union-find over quantized points (0.01 mm grid)
 * merges them; each connected group that holds ≥ 1 device pin is a net.
 */
const EPS = 0.02

/** Whether point (px,py) lies on the wire segment a→b (KiCad wires are axis-aligned, with the rare
 *  diagonal handled too) — so a pin landing partway along a wire connects, as KiCad treats it. */
function onSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  if (Math.abs(ay - by) < EPS) {
    return Math.abs(py - ay) < EPS && px >= Math.min(ax, bx) - EPS && px <= Math.max(ax, bx) + EPS
  }
  if (Math.abs(ax - bx) < EPS) {
    return Math.abs(px - ax) < EPS && py >= Math.min(ay, by) - EPS && py <= Math.max(ay, by) + EPS
  }
  const cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax)
  if (Math.abs(cross) > EPS) return false
  const dot = (px - ax) * (bx - ax) + (py - ay) * (by - ay)
  const len2 = (bx - ax) ** 2 + (by - ay) ** 2
  return dot >= -EPS && dot <= len2 + EPS
}

export function buildNets(sch: KicadSchematic): KicadNet[] {
  const key = (x: number, y: number) => `${Math.round(x * 100)},${Math.round(y * 100)}`

  const parent = new Map<string, string>()
  const ensure = (k: string) => {
    if (!parent.has(k)) parent.set(k, k)
  }
  const find = (k: string): string => {
    ensure(k)
    let root = k
    while (parent.get(root) !== root) root = parent.get(root) as string
    let cur = k
    while (parent.get(cur) !== root) {
      const next = parent.get(cur) as string
      parent.set(cur, root)
      cur = next
    }
    return root
  }
  const union = (a: string, b: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  // Every connection point on the page: wire ends, junctions, device pins, power ports, labels.
  const pins = resolvePinPositions(sch)
  const points: { x: number; y: number; key: string }[] = []
  const seen = new Set<string>()
  const addPoint = (x: number, y: number) => {
    const k = key(x, y)
    ensure(k)
    if (!seen.has(k)) {
      seen.add(k)
      points.push({ x, y, key: k })
    }
  }
  for (const w of sch.wires) {
    addPoint(w.a.x, w.a.y)
    addPoint(w.b.x, w.b.y)
  }
  for (const j of sch.junctions) addPoint(j.x, j.y)
  for (const p of pins) addPoint(p.x, p.y)
  for (const sym of sch.symbols) if (isPowerPort(sym.libId)) addPoint(sym.at.x, sym.at.y)
  for (const l of sch.labels) addPoint(l.x, l.y)

  // A wire ties its two ends into one net AND swallows any point lying along it (a pin landing
  // partway down a wire, or a wire ending on another's middle — both connect in KiCad).
  for (const w of sch.wires) {
    union(key(w.a.x, w.a.y), key(w.b.x, w.b.y))
    for (const pt of points) {
      if (onSegment(pt.x, pt.y, w.a.x, w.a.y, w.b.x, w.b.y)) union(pt.key, key(w.a.x, w.a.y))
    }
  }

  // Device pins, grouped by the point they land on.
  const pinsAt = new Map<string, { reference: string; pinNumber: string; pinName: string }[]>()
  for (const p of pins) {
    const k = key(p.x, p.y)
    const entry = { reference: p.reference, pinNumber: p.pinNumber, pinName: p.pinName }
    const list = pinsAt.get(k)
    if (list) list.push(entry)
    else pinsAt.set(k, [entry])
  }

  // Named connections: same-named labels merge, and every same-valued power port merges (the rail).
  // The name also rides along to label the net for the user.
  const named = new Map<string, string[]>()
  const addNamed = (name: string, k: string) => {
    ensure(k)
    const list = named.get(name)
    if (list) list.push(k)
    else named.set(name, [k])
  }
  for (const l of sch.labels) addNamed(l.text, key(l.x, l.y))
  for (const sym of sch.symbols) {
    if (isPowerPort(sym.libId)) addNamed(sym.value, key(sym.at.x, sym.at.y))
  }
  const nameOfKey = new Map<string, string>()
  for (const [name, keys] of named) {
    for (const k of keys) {
      nameOfKey.set(k, name)
      union(keys[0] as string, k)
    }
  }

  // Collect components that hold device pins → nets, naming each from any label/port in it.
  const byRoot = new Map<string, KicadNet>()
  for (const [k, list] of pinsAt) {
    const root = find(k)
    const net = byRoot.get(root) ?? { pins: [], name: undefined }
    net.pins.push(...list)
    byRoot.set(root, net)
  }
  for (const [k, name] of nameOfKey) {
    const net = byRoot.get(find(k))
    if (net && net.name === undefined) net.name = name
  }
  return [...byRoot.values()]
}

// --- CircuitFile mapping (step 5 — open a KiCad sheet on the canvas) ------------------------------

/** mm → px when placing a KiCad sheet onto our canvas. */
const KICAD_SCALE = 4

/** Net names meaning ground → our Ground part (the 0 V reference), not a plain net label. */
const GROUND_NAMES = new Set([
  'gnd',
  'gnda',
  'gndd',
  'agnd',
  'dgnd',
  'pgnd',
  'ground',
  'earth',
  'vss',
  '0',
])

/** KiCad's lib_id alone doesn't say NPN vs PNP / N vs P — guess from a few common part numbers. */
const PNP_PARTS = ['bc557', 'bc556', 'bc558', 'bc327', '2n3906', '2n2907', 'a1015', '2sa', 'tip42']
const isPnp = (text: string) => text.includes('pnp') || PNP_PARTS.some((p) => text.includes(p))
const isPmos = (text: string) => /p.?mos|p_?ch/.test(text)

/** Map a KiCad lib_id → our catalog definition (+ which scalar its value sets). undefined = a part we
 *  do not model (IC, connector, regulator, …): reported to the user, never silently faked. */
function mapDefinition(
  libId: string,
  value: string,
): { def: string; valueParam?: 'resistance' | 'capacitance' | 'inductance' } | undefined {
  const name = (libId.split(':').pop() ?? libId).toLowerCase()
  const lid = libId.toLowerCase()
  const blurb = `${name} ${value}`.toLowerCase()
  if (/^r(_small|_us)?$/.test(name) || name === 'resistor')
    return { def: 'resistor', valueParam: 'resistance' }
  if (name.includes('potentiometer') || name.includes('pot')) return { def: 'potentiometer' }
  if (/^c(_small|_polarized.*)?$/.test(name) || name.startsWith('cap') || name === 'capacitor')
    return { def: 'capacitor', valueParam: 'capacitance' }
  if (/^l(_small)?$/.test(name) || name === 'inductor')
    return { def: 'inductor', valueParam: 'inductance' }
  if (name.includes('led')) return { def: 'led' }
  if (
    lid.startsWith('diode:') ||
    /^d(_.*)?$/.test(name) ||
    name.includes('diode') ||
    name.includes('zener')
  )
    return { def: name.includes('zener') ? 'diode_zener_silicon' : 'diode_silicon_rectifier' }
  if (lid.startsWith('transistor_bjt'))
    return { def: isPnp(blurb) ? 'transistor_bjt_pnp' : 'transistor_bjt_npn' }
  if (lid.startsWith('transistor_fet') || /mosfet|nmos|pmos/.test(name))
    return { def: isPmos(blurb) ? 'transistor_mosfet_pmos' : 'transistor_mosfet_nmos' }
  if (lid.startsWith('switch:') || /^sw_/.test(name))
    return { def: name.includes('push') ? 'switch_spst_momentary' : 'switch_spst_toggle' }
  return undefined
}

/** Map a KiCad pin (number + name) → our terminal id for a device, by name where it matters (a
 *  diode's anode/cathode, a transistor's B/C/E) and by pin order otherwise. */
function mapTerminal(def: string, pinNumber: string, pinName: string): string {
  const n = pinName.trim().toLowerCase()
  if (def === 'led' || def.startsWith('diode')) {
    if (n.startsWith('a') || n === '+') return 'anode'
    if (n.startsWith('k') || n.startsWith('c') || n === '-') return 'cathode'
    return pinNumber === '2' ? 'anode' : 'cathode' // KiCad diode: pin 1 = K, pin 2 = A
  }
  if (def.startsWith('transistor_bjt')) {
    if (n.startsWith('b')) return 'base'
    if (n.startsWith('c')) return 'collector'
    if (n.startsWith('e')) return 'emitter'
    return pinNumber === '1' ? 'base' : pinNumber === '2' ? 'collector' : 'emitter'
  }
  if (def.startsWith('transistor_mosfet') || def.startsWith('transistor_jfet')) {
    if (n.startsWith('g')) return 'gate'
    if (n.startsWith('d')) return 'drain'
    if (n.startsWith('s')) return 'source'
    return pinNumber === '1' ? 'drain' : pinNumber === '2' ? 'gate' : 'source'
  }
  if (def === 'potentiometer')
    return pinNumber === '1' ? 'terminal_a' : pinNumber === '3' ? 'terminal_b' : 'wiper'
  if (def.startsWith('switch')) return pinNumber === '1' ? 'terminal_in' : 'terminal_out'
  return pinNumber === '1' ? 'terminal_a' : 'terminal_b' // 2-terminal symmetric (R / C / L / …)
}

export type KicadImportResult = {
  circuit: CircuitFile
  /** Parts we do not model (ICs, connectors, …) — reported, never faked. */
  unsupported: string[]
  /** Mapped, but with a stated assumption (a guessed transistor polarity, …). */
  warnings: string[]
}

/**
 * Build a CircuitFile from a KiCad schematic — step 5, what actually opens the sheet on our canvas.
 * Each placeable part maps to a catalog device (unmodeled parts are reported, not faked); the
 * geometric nets become connections — a ground net via Ground parts, a named rail via net labels
 * (the teleport), a plain local net via direct wires.
 */
export function parseKicadSchematic(text: string): KicadImportResult {
  const sch = extractSchematic(text)
  const nets = buildNets(sch)
  const unsupported: string[] = []
  const warnings: string[] = []

  const symByRef = new Map<string, KicadSymbol>()
  const defByRef = new Map<string, string>()
  const nodes: SavedNode[] = []
  for (const sym of sch.symbols) {
    if (isPowerPort(sym.libId)) continue
    symByRef.set(sym.reference, sym)
    const mapping = mapDefinition(sym.libId, sym.value)
    if (mapping === undefined) {
      unsupported.push(`${sym.reference || sym.libId} (${sym.libId})`)
      continue
    }
    defByRef.set(sym.reference, mapping.def)
    if (mapping.def.includes('transistor')) {
      warnings.push(`${sym.reference}: ${mapping.def} — polarity inferred from the part name`)
    }
    const params = { ...defaultParameters(mapping.def) } as Parameters
    if (mapping.valueParam !== undefined) {
      const v = parseSpiceValue(sym.value)
      if (v !== undefined && Number.isFinite(v) && v > 0) {
        const unit =
          mapping.valueParam === 'resistance'
            ? 'ohm'
            : mapping.valueParam === 'capacitance'
              ? 'farad'
              : 'henry'
        params[mapping.valueParam] = { value: { kind: 'scalar', amount: v, unit } }
      }
    }
    nodes.push({
      id: sym.reference || `${mapping.def}_${nodes.length + 1}`,
      definition: mapping.def,
      x: Math.round(sym.at.x * KICAD_SCALE),
      y: Math.round(sym.at.y * KICAD_SCALE),
      parameters: params,
    })
  }

  const wires: SavedWire[] = []
  let wireN = 0
  let anchorN = 0
  const addWire = (source: string, sourceHandle: string, target: string, targetHandle: string) => {
    wireN += 1
    wires.push({ id: `w_${wireN}`, source, sourceHandle, target, targetHandle })
  }
  for (const net of nets) {
    const conns = net.pins
      .filter((p) => defByRef.has(p.reference))
      .map((p) => ({
        id: p.reference,
        terminal: mapTerminal(defByRef.get(p.reference) as string, p.pinNumber, p.pinName),
      }))
    if (conns.length === 0) continue
    const isGround = net.name !== undefined && GROUND_NAMES.has(net.name.toLowerCase())
    const named = net.name !== undefined && !isGround

    if (!isGround && !named) {
      // A plain local net: connect the pins directly (a star from the first).
      const hub = conns[0] as { id: string; terminal: string }
      for (let i = 1; i < conns.length; i += 1) {
        const c = conns[i] as { id: string; terminal: string }
        addWire(hub.id, hub.terminal, c.id, c.terminal)
      }
      continue
    }
    // Ground or a named rail → an anchor per pin (Ground part / net label), teleport-merged.
    const labelName = net.name as string
    for (const c of conns) {
      anchorN += 1
      const sym = symByRef.get(c.id) as KicadSymbol
      const anchorId = isGround ? `gnd_${anchorN}` : `netlabel_${anchorN}`
      nodes.push({
        id: anchorId,
        definition: isGround ? 'ground' : 'net_label',
        x: Math.round(sym.at.x * KICAD_SCALE) + 48,
        y: Math.round(sym.at.y * KICAD_SCALE) + 48,
        ...(isGround ? {} : { parameters: { net_name: { value: labelName } } as Parameters }),
      })
      addWire(c.id, c.terminal, anchorId, 'reference_terminal')
    }
  }

  return {
    circuit: { format: CIRCUIT_FILE_FORMAT, version: CIRCUIT_FILE_VERSION, nodes, wires },
    unsupported: [...new Set(unsupported)], // a multi-unit IC places once per unit — report it once
    warnings,
  }
}
