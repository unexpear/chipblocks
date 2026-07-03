import {
  CIRCUIT_FILE_FORMAT,
  CIRCUIT_FILE_VERSION,
  type CircuitFile,
  type SavedNode,
  type SavedWire,
} from './circuit-file.ts'
import { buildNets, endpointKey } from './output-contention.ts'
import { defaultParameters } from './part-defaults.ts'

/**
 * SPICE netlist import (circuit-io, format #1). Parses a plain SPICE deck into a CircuitFile — the same
 * neutral structure Save/Load uses — so the existing loader places it on the canvas. Deterministic, no
 * AI. It maps ONLY parts the catalog actually has; anything else is REPORTED (unsupported / warnings),
 * never faked, per the anti-placeholder rule.
 *
 * What is exact: the wiring (nets → terminal-to-terminal connections), the part types, and R / C / L /
 * source values. What is NOT (yet): a transistor's / diode's `.model` fine-parameters — those parts take
 * ChipBlocks' cited defaults, which is flagged in `warnings`. Unsupported: current sources, subcircuits,
 * controlled sources (no catalog part for them yet).
 *
 * SPICE conventions honoured: the FIRST line of a deck is its title and is skipped (noted in warnings);
 * `*` lines are comments, `+` continues the previous line, `;` starts an inline comment; net `0` (and
 * `gnd`) is ground → a ground part. Engineering suffixes are parsed with the classic rule that `m` is
 * milli and `meg` is mega.
 */

export type SpiceImportResult = {
  circuit: CircuitFile
  /** Lines we could not map to a real catalog part — surfaced to the user, never silently dropped. */
  unsupported: string[]
  /** Mapped, but with a stated assumption (a defaulted transistor model, an ignored bulk node, …). */
  warnings: string[]
}

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

// Scale factors, longest first so 'meg' / 'mil' beat the single 'm'.
const SCALES: ReadonlyArray<readonly [string, number]> = [
  ['meg', 1e6],
  ['mil', 25.4e-6],
  ['t', 1e12],
  ['g', 1e9],
  ['k', 1e3],
  ['m', 1e-3],
  ['u', 1e-6],
  ['n', 1e-9],
  ['p', 1e-12],
  ['f', 1e-15],
]

/**
 * Parse a SPICE value token ("4.7k", "1Meg", "100n", "2.2uF") into a number; trailing unit letters after
 * the scale factor are ignored. Case-insensitive, and `m` = milli while `meg` = mega (the classic SPICE
 * trap). Returns undefined when there is no leading number.
 */
export function parseSpiceValue(token: string): number | undefined {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-zµ]*)$/i.exec(token.trim())
  if (!match || match[1] === undefined) return undefined
  const base = Number.parseFloat(match[1])
  if (!Number.isFinite(base)) return undefined
  const suffix = (match[2] ?? '').toLowerCase().replace(/µ/g, 'u')
  if (suffix === '') return base
  for (const [key, mult] of SCALES) {
    if (suffix.startsWith(key)) return base * mult
  }
  return base // an unrecognised suffix is a bare unit (e.g. "ohm") — scale ×1
}

type ParsedElement = { node: SavedNode; terminals: { handle: string; net: string }[] }

/** Continuation-join (`+`), strip `*` / `;` comments, drop blanks, and split off the title (line 1). */
function preprocess(text: string): { lines: string[]; title: string | undefined } {
  const joined: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, '').trimEnd()
    if (/^\s*\+/.test(line) && joined.length > 0) {
      joined[joined.length - 1] = `${joined[joined.length - 1]} ${line.replace(/^\s*\+\s*/, '')}`
    } else {
      joined.push(line)
    }
  }
  const title = joined.length > 0 ? joined[0]?.trim() || undefined : undefined
  const lines = joined
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('*'))
  return { lines, title }
}

function passive(
  tokens: string[],
  definition: string,
  key: string,
  unit: string,
): ParsedElement | null {
  const [name, n1, n2, value] = tokens
  if (!name || !n1 || !n2 || value === undefined) return null
  const amount = parseSpiceValue(value)
  if (amount === undefined) return null
  const parameters = defaultParameters(definition)
  parameters[key] = scalar(amount, unit)
  return {
    node: { id: name, definition, x: 0, y: 0, parameters },
    terminals: [
      { handle: 'terminal_a', net: n1 },
      { handle: 'terminal_b', net: n2 },
    ],
  }
}

/** Best-effort diode kind from the model + element name; defaults to a silicon rectifier. */
function diodeDefinition(hint: string): string {
  const h = hint.toLowerCase()
  if (/zener|\bzen|bzx|bzv/.test(h)) return 'diode_zener_silicon'
  if (/schottky|schot|\bbat\d|1n58/.test(h)) return 'diode_schottky_al_si'
  if (/\bled\b|light.?emit/.test(h)) return 'led'
  if (/tunnel|esaki/.test(h)) return 'diode_tunnel'
  return 'diode_silicon_rectifier'
}

function diode(tokens: string[]): ParsedElement | null {
  const [name, anode, cathode, model] = tokens
  if (!name || !anode || !cathode) return null
  const definition = diodeDefinition(`${model ?? ''} ${name}`)
  return {
    node: { id: name, definition, x: 0, y: 0, parameters: defaultParameters(definition) },
    terminals: [
      { handle: 'anode', net: anode },
      { handle: 'cathode', net: cathode },
    ],
  }
}

function bjt(
  tokens: string[],
  models: Map<string, string>,
  warnings: string[],
): ParsedElement | null {
  const [name, nc, nb, ne, model] = tokens
  if (!name || !nc || !nb || !ne) return null
  const type = model ? models.get(model.toLowerCase()) : undefined
  let definition = 'transistor_bjt_npn'
  if (type === 'PNP') definition = 'transistor_bjt_pnp'
  else if (type !== 'NPN') warnings.push(`BJT ${name}: no NPN/PNP .model found — assumed NPN.`)
  return {
    node: { id: name, definition, x: 0, y: 0, parameters: defaultParameters(definition) },
    terminals: [
      { handle: 'collector', net: nc },
      { handle: 'base', net: nb },
      { handle: 'emitter', net: ne },
    ],
  }
}

function mosfet(
  tokens: string[],
  models: Map<string, string>,
  warnings: string[],
): ParsedElement | null {
  const [name, nd, ng, ns, fifth, sixth] = tokens
  if (!name || !nd || !ng || !ns) return null
  // `M nd ng ns nb model` (6 tokens) or `M nd ng ns model` (5, bulk omitted).
  const modelName = sixth ?? fifth
  const bulk = sixth !== undefined ? fifth : undefined
  const type = modelName ? models.get(modelName.toLowerCase()) : undefined
  let definition = 'transistor_mosfet_nmos'
  if (type === 'PMOS') definition = 'transistor_mosfet_pmos'
  else if (type !== 'NMOS')
    warnings.push(`MOSFET ${name}: no NMOS/PMOS .model found — assumed NMOS.`)
  if (bulk !== undefined && bulk.toLowerCase() !== ns.toLowerCase()) {
    warnings.push(`MOSFET ${name}: bulk node "${bulk}" ignored (ChipBlocks ties bulk to source).`)
  }
  return {
    node: { id: name, definition, x: 0, y: 0, parameters: defaultParameters(definition) },
    terminals: [
      { handle: 'drain', net: nd },
      { handle: 'gate', net: ng },
      { handle: 'source', net: ns },
    ],
  }
}

function source(tokens: string[], warnings: string[]): ParsedElement | null {
  const [name, np, nn] = tokens
  if (!name || !np || !nn) return null
  const spec = tokens.slice(3).join(' ')
  let dc = 0
  let ac = 0
  let freq = 0
  const sin = /\bsin\s*\(([^)]*)\)/i.exec(spec)
  if (sin?.[1] !== undefined) {
    const a = sin[1]
      .trim()
      .split(/[\s,]+/)
      .map((t) => parseSpiceValue(t) ?? 0)
    dc = a[0] ?? 0
    ac = a[1] ?? 0
    freq = a[2] ?? 0
  } else {
    const dcM = /\bdc\b\s+(\S+)/i.exec(spec)
    const acM = /\bac\b\s+(\S+)/i.exec(spec)
    if (dcM?.[1]) dc = parseSpiceValue(dcM[1]) ?? 0
    if (acM?.[1]) ac = parseSpiceValue(acM[1]) ?? 0
    if (!dcM && !acM) {
      const bare = tokens[3] !== undefined ? parseSpiceValue(tokens[3]) : undefined
      if (bare === undefined) {
        warnings.push(
          `Source ${name}: spec "${spec}" not modelled (e.g. PULSE/PWL) — imported as 0 V DC.`,
        )
      } else dc = bare
    } else if (acM && freq === 0 && !dcM) {
      warnings.push(
        `Source ${name}: AC magnitude imported as amplitude — set a frequency to make it oscillate.`,
      )
    }
  }
  const parameters = defaultParameters('power_source')
  parameters.nominal_voltage = scalar(dc, 'volt')
  parameters.ac_amplitude = scalar(ac, 'volt')
  parameters.frequency = scalar(freq, 'hertz')
  return {
    node: { id: name, definition: 'power_source', x: 0, y: 0, parameters },
    terminals: [
      { handle: 'terminal_positive', net: np },
      { handle: 'terminal_negative', net: nn },
    ],
  }
}

function parseElement(
  line: string,
  models: Map<string, string>,
  warnings: string[],
): ParsedElement | null {
  const tokens = line.split(/\s+/)
  const kind = tokens[0]?.[0]?.toUpperCase()
  switch (kind) {
    case 'R':
      return passive(tokens, 'resistor', 'resistance', 'ohm')
    case 'C':
      return passive(tokens, 'capacitor', 'capacitance', 'farad')
    case 'L':
      return passive(tokens, 'inductor', 'inductance', 'henry')
    case 'D':
      return diode(tokens)
    case 'Q':
      return bjt(tokens, models, warnings)
    case 'M':
      return mosfet(tokens, models, warnings)
    case 'V':
      return source(tokens, warnings)
    default:
      return null // I (current source), X (subckt), E/F/G/H (controlled) — no catalog part yet
  }
}

/** Parse a SPICE deck into a CircuitFile, reporting everything it could not faithfully convert. */
export function parseSpiceNetlist(text: string): SpiceImportResult {
  const unsupported: string[] = []
  const warnings: string[] = []
  const { lines, title } = preprocess(text)
  if (title && !title.startsWith('*')) {
    warnings.push(`First line read as the title and skipped (SPICE convention): "${title}".`)
  }

  // Pass 1 — .model definitions: name → device TYPE (D | NPN | PNP | NMOS | PMOS).
  const models = new Map<string, string>()
  for (const line of lines) {
    const m = /^\.model\s+(\S+)\s+([a-z]+)/i.exec(line)
    if (m?.[1] && m[2]) models.set(m[1].toLowerCase(), m[2].toUpperCase())
  }

  // Pass 2 — elements + nets.
  const nodes: SavedNode[] = []
  const usedIds = new Set<string>()
  const uniqueId = (preferred: string): string => {
    let id = preferred
    let n = 2
    while (usedIds.has(id)) id = `${preferred}_${n++}`
    usedIds.add(id)
    return id
  }
  const GROUND_KEY = ' gnd'
  const netKey = (net: string): string => {
    const low = net.toLowerCase()
    return low === '0' || low === 'gnd' || low === 'gnd!' ? GROUND_KEY : low
  }
  const nets = new Map<string, { nodeId: string; handle: string }[]>()
  const addTerminal = (net: string, nodeId: string, handle: string) => {
    const key = netKey(net)
    const list = nets.get(key)
    if (list) list.push({ nodeId, handle })
    else nets.set(key, [{ nodeId, handle }])
  }

  let subcircuitSkipped = false
  let inSubcircuit = false
  for (const line of lines) {
    if (/^\.subckt\b/i.test(line)) {
      inSubcircuit = true
      subcircuitSkipped = true
      continue
    }
    if (/^\.ends\b/i.test(line)) {
      inSubcircuit = false
      continue
    }
    if (inSubcircuit || line.startsWith('.')) continue // directives handled / ignored
    const parsed = parseElement(line, models, warnings)
    if (parsed === null) {
      unsupported.push(line)
      continue
    }
    const id = uniqueId(parsed.node.id)
    parsed.node.id = id
    nodes.push(parsed.node)
    for (const t of parsed.terminals) addTerminal(t.net, id, t.handle)
  }

  // Ground: net 0 / gnd becomes a ground part, and anchors its net (every ground lead wires to it).
  if (nets.has(GROUND_KEY)) {
    const groundId = uniqueId('GND')
    nodes.push({ id: groundId, definition: 'ground', x: 0, y: 0 })
    nets.get(GROUND_KEY)?.unshift({ nodeId: groundId, handle: 'reference_terminal' })
  }

  // Wires: a 2-terminal net is a direct wire; a 3+-terminal net stars off its first terminal (multiple
  // wires can share a terminal — they are one net). Junction parts are a later-rung tidiness pass.
  const wires: SavedWire[] = []
  let wireN = 0
  for (const [key, terminals] of nets) {
    if (terminals.length < 2) {
      if (terminals.length === 1 && key !== GROUND_KEY) {
        warnings.push(`Net "${key}" reaches only one terminal — left unconnected (an open node).`)
      }
      continue
    }
    const anchor = terminals[0]
    if (!anchor) continue
    for (let i = 1; i < terminals.length; i++) {
      const t = terminals[i]
      if (!t) continue
      wires.push({
        id: `w${wireN++}`,
        source: anchor.nodeId,
        sourceHandle: anchor.handle,
        target: t.nodeId,
        targetHandle: t.handle,
      })
    }
  }

  // Auto-layout: a netlist carries no geometry, so place parts in a simple grid for the user to arrange.
  nodes.forEach((node, i) => {
    node.x = 80 + (i % 6) * 170
    node.y = 80 + Math.floor(i / 6) * 130
  })

  if (subcircuitSkipped) {
    warnings.push(
      'Subcircuit definitions (.subckt…) were skipped — rebuild them as ChipBlocks blocks. Any X… instances are listed as unsupported.',
    )
  }
  if (nodes.some((n) => /^transistor_|^diode_|^led$/.test(n.definition))) {
    warnings.push(
      "Transistor / diode .model fine-parameters were not imported — those parts use ChipBlocks' cited defaults. Connectivity, R / C / L and source values are exact.",
    )
  }
  if (nodes.length > 0) {
    warnings.push(
      'Parts were auto-placed in a grid (a netlist has no geometry) — drag them to lay out the schematic.',
    )
  }

  return {
    circuit: { format: CIRCUIT_FILE_FORMAT, version: CIRCUIT_FILE_VERSION, nodes, wires },
    unsupported,
    warnings,
  }
}

// --- SPICE export (rung 2): the canvas → a netlist, the reverse of parseSpiceNetlist ----------------

export type SpiceExportResult = {
  netlist: string
  /** Parts with no SPICE equivalent — listed and marked with a comment, never silently dropped. */
  unsupported: string[]
  warnings: string[]
}

const amountOf = (node: SavedNode, key: string): number | undefined => {
  const params = node.parameters as Record<string, { value?: { amount?: number } }> | undefined
  return params?.[key]?.value?.amount
}

/** A number → a tidy SPICE value with an engineering suffix (470 → "470", 1e-7 → "100n"). */
export function formatSpiceValue(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0'
  const scales: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'G'],
    [1e6, 'Meg'],
    [1e3, 'k'],
    [1, ''],
    [1e-3, 'm'],
    [1e-6, 'u'],
    [1e-9, 'n'],
    [1e-12, 'p'],
    [1e-15, 'f'],
  ]
  const abs = Math.abs(n)
  for (const [factor, suffix] of scales) {
    if (abs >= factor) return `${Number((n / factor).toPrecision(6))}${suffix}`
  }
  return n.toExponential()
}

type ExportCard = { prefix: string; terminals: string[] } & (
  | { kind: 'passive'; valueKey: string }
  | { kind: 'source' }
  | { kind: 'model'; model: string; modelType: string }
)

// The catalog parts that round-trip to SPICE (the same set import handles). Model names are chosen so
// re-importing recovers the same part — the diode heuristic reads ZENER / SCHOTTKY / LED / TUNNEL.
const EXPORT_CARDS: Record<string, ExportCard> = {
  resistor: {
    prefix: 'R',
    terminals: ['terminal_a', 'terminal_b'],
    kind: 'passive',
    valueKey: 'resistance',
  },
  capacitor: {
    prefix: 'C',
    terminals: ['terminal_a', 'terminal_b'],
    kind: 'passive',
    valueKey: 'capacitance',
  },
  inductor: {
    prefix: 'L',
    terminals: ['terminal_a', 'terminal_b'],
    kind: 'passive',
    valueKey: 'inductance',
  },
  power_source: {
    prefix: 'V',
    terminals: ['terminal_positive', 'terminal_negative'],
    kind: 'source',
  },
  diode_silicon_rectifier: {
    prefix: 'D',
    terminals: ['anode', 'cathode'],
    kind: 'model',
    model: 'DSILICON',
    modelType: 'D',
  },
  diode_schottky_al_si: {
    prefix: 'D',
    terminals: ['anode', 'cathode'],
    kind: 'model',
    model: 'SCHOTTKY',
    modelType: 'D',
  },
  diode_zener_silicon: {
    prefix: 'D',
    terminals: ['anode', 'cathode'],
    kind: 'model',
    model: 'ZENER',
    modelType: 'D',
  },
  diode_tunnel: {
    prefix: 'D',
    terminals: ['anode', 'cathode'],
    kind: 'model',
    model: 'TUNNEL',
    modelType: 'D',
  },
  led: {
    prefix: 'D',
    terminals: ['anode', 'cathode'],
    kind: 'model',
    model: 'LED',
    modelType: 'D',
  },
  transistor_bjt_npn: {
    prefix: 'Q',
    terminals: ['collector', 'base', 'emitter'],
    kind: 'model',
    model: 'QNPN',
    modelType: 'NPN',
  },
  transistor_bjt_pnp: {
    prefix: 'Q',
    terminals: ['collector', 'base', 'emitter'],
    kind: 'model',
    model: 'QPNP',
    modelType: 'PNP',
  },
  transistor_mosfet_nmos: {
    prefix: 'M',
    terminals: ['drain', 'gate', 'source'],
    kind: 'model',
    model: 'MNMOS',
    modelType: 'NMOS',
  },
  transistor_mosfet_pmos: {
    prefix: 'M',
    terminals: ['drain', 'gate', 'source'],
    kind: 'model',
    model: 'MPMOS',
    modelType: 'PMOS',
  },
}

/**
 * Serialize a CircuitFile to a SPICE netlist — the reverse of parseSpiceNetlist. Parts SPICE cannot
 * express (motors, tubes, transformers, switches, …) are listed in `unsupported` and marked with a
 * comment in the deck, never silently dropped. Nets are numbered; a net touching a ground part is 0.
 */
export function serializeSpiceNetlist(circuit: CircuitFile): SpiceExportResult {
  const unsupported: string[] = []
  const warnings: string[] = []
  const { rootOf } = buildNets(circuit.wires)

  const groundRoots = new Set<string>()
  for (const node of circuit.nodes) {
    if (node.definition !== 'ground') continue
    const root = rootOf(endpointKey(node.id, 'reference_terminal'))
    if (root !== undefined) groundRoots.add(root)
  }

  const netNameByRoot = new Map<string, string>()
  let netCounter = 0
  const netOf = (nodeId: string, handle: string): string => {
    const root = rootOf(endpointKey(nodeId, handle))
    if (root === undefined) {
      netCounter += 1
      return `n${netCounter}` // an unwired terminal — its own floating net
    }
    if (groundRoots.has(root)) return '0'
    const existing = netNameByRoot.get(root)
    if (existing !== undefined) return existing
    netCounter += 1
    const name = String(netCounter)
    netNameByRoot.set(root, name)
    return name
  }

  const counts = new Map<string, number>()
  const nextName = (prefix: string): string => {
    const n = (counts.get(prefix) ?? 0) + 1
    counts.set(prefix, n)
    return `${prefix}${n}`
  }

  const cards: string[] = []
  const comments: string[] = []
  const models = new Map<string, string>()
  let mosfetExported = false
  let modelDeviceExported = false

  for (const node of circuit.nodes) {
    if (node.definition === 'ground' || node.definition === 'junction') continue
    // A text note's faithful SPICE form IS a comment — not an unsupported element.
    if (node.definition === 'text_note') {
      const text = node.parameters?.note_text?.value
      if (typeof text === 'string' && text.trim() !== '') {
        for (const line of text.split('\n')) comments.push(`* note: ${line}`)
      }
      continue
    }
    const card = EXPORT_CARDS[node.definition]
    if (card === undefined) {
      unsupported.push(`${node.id} (${node.definition})`)
      comments.push(`* ${node.id} (${node.definition}): no SPICE equivalent — omitted`)
      continue
    }
    const name = nextName(card.prefix)
    const nets = card.terminals.map((t) => netOf(node.id, t))
    if (card.kind === 'passive') {
      const value = amountOf(node, card.valueKey)
      if (value === undefined) {
        warnings.push(`${node.id}: no ${card.valueKey} value — omitted.`)
        continue
      }
      cards.push(`${name} ${nets.join(' ')} ${formatSpiceValue(value)}`)
    } else if (card.kind === 'source') {
      const dc = amountOf(node, 'nominal_voltage') ?? 0
      const ac = amountOf(node, 'ac_amplitude') ?? 0
      const freq = amountOf(node, 'frequency') ?? 0
      const drive =
        ac > 0
          ? `SIN(${formatSpiceValue(dc)} ${formatSpiceValue(ac)} ${formatSpiceValue(freq)})`
          : `DC ${formatSpiceValue(dc)}`
      cards.push(`${name} ${nets.join(' ')} ${drive}`)
    } else {
      modelDeviceExported = true
      if (card.prefix === 'M') {
        mosfetExported = true
        cards.push(`${name} ${nets.join(' ')} ${nets[2] ?? '0'} ${card.model}`) // bulk tied to source
      } else {
        cards.push(`${name} ${nets.join(' ')} ${card.model}`)
      }
      models.set(card.model, `.model ${card.model} ${card.modelType}`)
    }
  }

  if (modelDeviceExported) {
    warnings.push(
      'Transistor / diode .model lines carry the device TYPE only — the cited fine-parameters are not written into the netlist.',
    )
  }
  if (mosfetExported) {
    warnings.push(
      'MOSFET bulk nodes were tied to source on export (ChipBlocks has no separate bulk terminal).',
    )
  }

  const lines = ['* ChipBlocks netlist export', ...cards, ...models.values(), ...comments, '.end']
  return { netlist: lines.join('\n'), unsupported, warnings }
}
