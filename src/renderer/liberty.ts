/**
 * LIBERTY (.lib) TIMING LIBRARY — the last piece of the OpenROAD signoff round-trip (chip-physical chapter,
 * signoff follow-up C2). LEF gives the physical abstract, DEF the placed + connected design (top-netlist.ts);
 * Liberty gives each standard cell its TIMING (cell delay + output transition) and pin CAPACITANCE, so a
 * static-timing tool can compute path delays and check setup/hold against the DEF.
 *
 * Every number is REAL, reusing the app's OWN timing engine: characterizeGate (timing-graph.ts) recovers a
 * gate's output drive resistance R and per-input capacitance C from its transistors, and the delay is the
 * single-stage RC model t = ln2·R·C (static-timing.ts) — the SAME physics the on-canvas timing panel uses.
 * Because that delay is LINEAR in the output load, a 2-point NLDM table over total_output_net_capacitance is
 * EXACT, not a curve fit. The output transition (10–90%) is ln9·R·C. The boolean function comes from the
 * gate's definition and the timing sense is DERIVED from its truth table (logic-sim.ts LOGIC_PRIMITIVES).
 *
 * HONEST SCOPE:
 *  - The device constants are the DISCRETE 2N7000 / BS250 datasheet values (k, C_iss 60 pF) the whole app is
 *    built on — cited, traceable, internally consistent — NOT on-chip C5N per-area silicon (which the repo
 *    does not have). So these are real single-stage RC physics but in the ns range of discrete 5 V logic.
 *  - Rise and fall share the worst-case output resistance (characterizeGate returns the slower edge).
 *  - Input-slew dependence is not modelled (a load-only 1-D table).
 *  - A COMPOSITE cell (AND/OR/XOR/XNOR/Buffer = NAND+INV inside) is characterized at its OUTPUT stage: the
 *    arc captures the load-dependent output-driver delay + the real first-stage input capacitance; the fixed
 *    internal stage delay is not added (a teaching simplification). The true primitives NAND/NOR/NOT are one
 *    stage, so their timing is exact.
 */

import type {
  BlockData,
  BlockInnerEdge,
  BlockInnerNode,
  BlockPort,
  CanvasNodeLike,
} from './blocks.ts'
import { flattenBlocks } from './blocks.ts'
import { STANDARD_CELL_BLOCKS } from './cell-drc.ts'
import { PROCESS } from './cell-layout.ts'
import type { Floorplan } from './cell-place.ts'
import { cellBlock, cellPolygons } from './cell-polygons.ts'
import { gdsName } from './gds.ts'
import { LOGIC_PRIMITIVES } from './logic-sim.ts'
import { characterizeGate } from './timing-graph.ts'

const LN2 = Math.log(2) // 50%-crossing factor of a single-stage RC step (t = ln2·R·C), as static-timing.ts
const LN9 = Math.log(9) // 10–90% output transition factor (t_r = ln9·R·C)
export const LIB_NAME = 'chipblocks_c5n'
export const NOM_VOLTAGE = 5 // the default 5 V supply (= 2×|V_th| of the LOGIC_ 2N7000/BS250 pair)
const NOM_TEMPERATURE = 25
/** The output-load grid (total_output_net_capacitance, pF). Delay is LINEAR in load, so two points are
 *  exact; they bracket a light load (≈ wire only) to a heavy fan-out at the discrete 60 pF C_iss scale. */
const LOAD_INDEX_PF = [1, 250] as const

/** Format a non-negative time (ns) at 4 dp; guards NaN/∞ (an uncharacterizable gate) to 0. */
const ns = (value: number): string => (Number.isFinite(value) && value > 0 ? value : 0).toFixed(4)
/** ln2·R·C as ns, folding Ω·pF → ns (C[pF]×1e-12 F, ×1e9 s→ns ⇒ ×1e-3). */
const cellDelayNs = (rOhm: number, cPf: number): number => LN2 * rOhm * cPf * 1e-3
const transitionNs = (rOhm: number, cPf: number): number => LN9 * rOhm * cPf * 1e-3

/** The Liberty boolean function of the output pin Y, per gate name (standard gate definitions; Liberty ops:
 *  `*`/space = AND, `+` = OR, `'` = NOT, `^` = XOR). */
const FUNCTION_OF: Record<string, string> = {
  NOT: "A'",
  Buffer: 'A',
  AND: '(A * B)',
  OR: '(A + B)',
  NAND: "(A * B)'",
  NOR: "(A + B)'",
  XOR: '(A ^ B)',
  XNOR: "(A ^ B)'",
}

type Sense = 'positive_unate' | 'negative_unate' | 'non_unate'
/** Derive the timing sense of input `i` from the gate's truth table: whether raising that input (holding the
 *  others) ever raises the output (positive), ever lowers it (negative), or both (non-unate — e.g. XOR). */
function timingSense(spec: (typeof LOGIC_PRIMITIVES)[string], i: number): Sense {
  const n = spec.inputs.length
  let raises = false
  let lowers = false
  for (let mask = 0; mask < 1 << n; mask++) {
    if (mask & (1 << i)) continue // enumerate only the settings where input i = 0, then flip it to 1
    const lo = Array.from({ length: n }, (_, b) => (mask & (1 << b)) !== 0)
    const hi = lo.map((v, b) => (b === i ? true : v))
    const o0 = spec.fn(lo)[0] === true
    const o1 = spec.fn(hi)[0] === true
    if (o1 && !o0) raises = true
    if (!o1 && o0) lowers = true
  }
  if (raises && lowers) return 'non_unate'
  return lowers ? 'negative_unate' : 'positive_unate'
}

/**
 * Fully expand a gate to its transistors and reshape it into the BlockData characterizeGate reads (nodes =
 * transistors, edges between their terminals, the gate's ports re-pointed at the real transistor terminals).
 * For the true primitives (NAND/NOR/NOT) this is a no-op; for a composite it exposes the transistors so the
 * output-drive resistance + input capacitance are recovered instead of coming back empty.
 */
function transistorBlock(gate: BlockData): BlockData {
  const wrapped: CanvasNodeLike = {
    id: 'g',
    position: { x: 0, y: 0 },
    data: { definition: 'block', block: gate },
  }
  const flat = flattenBlocks([wrapped], [])
  const nodes: BlockInnerNode[] = flat.nodes.map((node) => ({
    id: node.id,
    definition: node.data.definition,
    x: 0,
    y: 0,
    ...(node.data.parameters ? { parameters: node.data.parameters } : {}),
  }))
  const edges: BlockInnerEdge[] = flat.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle ?? null,
    target: edge.target,
    targetHandle: edge.targetHandle ?? null,
  }))
  const ports: BlockPort[] = gate.ports.map((port) => {
    const target = flat.portTarget.get(`g/${port.id}`)
    return target ? { ...port, inner: { nodeId: target.nodeId, handleId: target.handleId } } : port
  })
  return { ...gate, nodes, edges, ports }
}

const areaUm2 = (block: BlockData): number =>
  cellPolygons(block).widthLambda * PROCESS.rowHeight.lambda * PROCESS.lambdaUm * PROCESS.lambdaUm

const idxList = LOAD_INDEX_PF.join(', ')
/** A 1-D lookup table (load only) named after `group`, its values computed by `at(load_pF)`. */
const table = (group: string, at: (cPf: number) => number): string[] => [
  `        ${group} (delay_load) {`,
  `          index_1 ("${idxList}");`,
  `          values ("${LOAD_INDEX_PF.map((c) => ns(at(c))).join(', ')}");`,
  '        }',
]

/**
 * The Liberty `cell (...)` block for one primitive gate: its area, input pins (with real capacitance), and
 * the output pin Y (its boolean function + a timing arc from each input, delay = ln2·R·C over the load).
 * Returns undefined for a name that is not one of the primitive gates.
 */
export function cellLiberty(name: string): string | undefined {
  const block = cellBlock(name)
  if (!block) return undefined
  const spec = LOGIC_PRIMITIVES[block.name]
  if (!spec) return undefined
  const ch = characterizeGate(transistorBlock(block), NOM_VOLTAGE)
  const r = ch.outputResistance

  const inputs = spec.inputs.map((portId, i) => ({
    pin: i === 0 ? 'A' : 'B',
    capPf: (ch.inputCapacitance.get(portId) ?? 0) * 1e12,
    sense: timingSense(spec, i),
  }))

  const lines: string[] = [
    `  cell (${gdsName(`cell_${name}`)}) {`,
    `    area : ${areaUm2(block).toFixed(4)} ;`,
  ]
  for (const input of inputs) {
    lines.push(
      `    pin (${input.pin}) {`,
      '      direction : input ;',
      `      capacitance : ${input.capPf.toFixed(4)} ;`,
      '    }',
    )
  }
  lines.push(
    '    pin (Y) {',
    '      direction : output ;',
    `      function : "${FUNCTION_OF[block.name] ?? 'A'}" ;`,
    `      max_capacitance : ${LOAD_INDEX_PF[1].toFixed(4)} ;`,
  )
  for (const input of inputs) {
    lines.push(
      '      timing () {',
      `        related_pin : "${input.pin}" ;`,
      `        timing_sense : ${input.sense} ;`,
      ...table('cell_rise', (c) => cellDelayNs(r, c)),
      ...table('cell_fall', (c) => cellDelayNs(r, c)),
      ...table('rise_transition', (c) => transitionNs(r, c)),
      ...table('fall_transition', (c) => transitionNs(r, c)),
      '      }',
    )
  }
  lines.push('    }', '  }')
  return lines.join('\n')
}

/** The library header: units, operating point, and the single load-only delay template every cell shares. */
function libraryHeader(): string {
  return [
    `library (${LIB_NAME}) {`,
    '  comment : "ChipBlocks teaching timing — real single-stage RC from the discrete 2N7000/BS250 constants, NOT on-chip C5N per-area silicon." ;',
    '  delay_model : table_lookup ;',
    '  technology (cmos) ;',
    '  time_unit : "1ns" ;',
    '  voltage_unit : "1V" ;',
    '  current_unit : "1mA" ;',
    '  pulling_resistance_unit : "1kohm" ;',
    '  capacitive_load_unit (1, pf) ;',
    '  nom_process : 1 ;',
    `  nom_voltage : ${NOM_VOLTAGE.toFixed(1)} ;`,
    `  nom_temperature : ${NOM_TEMPERATURE.toFixed(1)} ;`,
    '  operating_conditions ("typical") {',
    '    process : 1 ;',
    `    voltage : ${NOM_VOLTAGE.toFixed(1)} ;`,
    `    temperature : ${NOM_TEMPERATURE.toFixed(1)} ;`,
    '    tree_type : balanced_tree ;',
    '  }',
    '  default_operating_conditions : "typical" ;',
    '  lu_table_template (delay_load) {',
    '    variable_1 : total_output_net_capacitance ;',
    `    index_1 ("${idxList}");`,
    '  }',
  ].join('\n')
}

/** The whole primitive library: header + a Liberty cell for all 8 gates, closed. Deterministic. */
export function standardCellLib(): string {
  const cells = STANDARD_CELL_BLOCKS.map((block) => cellLiberty(block.name)).filter(
    (c): c is string => c !== undefined,
  )
  return `${[libraryHeader(), ...cells].join('\n')}\n}\n`
}

/**
 * A Liberty library for exactly the cell types a floorplan uses (first-appearance order). Unknown names are
 * reported in `fallbacks` and omitted (an untimed cell would mislead the STA). `cells` is the distinct count.
 */
export function floorplanToLib(fp: Floorplan): {
  text: string
  cells: number
  fallbacks: string[]
} {
  const seen = new Set<string>()
  const cellTexts: string[] = []
  const fallbacks: string[] = []
  for (const cell of fp.cells) {
    if (seen.has(cell.name)) continue
    seen.add(cell.name)
    const text = cellLiberty(cell.name)
    if (text === undefined) fallbacks.push(cell.name)
    else cellTexts.push(text)
  }
  return {
    text: `${[libraryHeader(), ...cellTexts].join('\n')}\n}\n`,
    cells: cellTexts.length,
    fallbacks,
  }
}
