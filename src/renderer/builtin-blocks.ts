import type { BlockData } from './blocks.ts'
import { defaultParameters, type Parameters } from './part-defaults.ts'

/**
 * Built-in circuit blocks that ship with the app — the same BlockData a user gets
 * by grouping a drawn circuit, just authored in advance. They flatten, descend, and
 * solve through the existing block machinery (flattenBlocks): the solver only ever
 * sees the real transistors inside, so an op-amp dropped here is genuinely the
 * five-transistor amplifier verified in op-amp.test.ts, not a behavioral stand-in.
 *
 * THE OP-AMP (two-stage, transistor-level): an NPN differential pair (Q1/Q2) with a
 * PNP current-mirror load (Q3/Q4) feeding a PNP common-emitter gain stage (Q5). Five
 * external pins become ports: the two inputs, the output, and the two supply rails.
 * Cited 2N3904 / 2N3906 device parameters via defaultParameters; the two resistors
 * set the tail current and the output load.
 */

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

const NPN: Parameters = defaultParameters('transistor_bjt_npn')
const PNP: Parameters = defaultParameters('transistor_bjt_pnp')
const RTAIL: Parameters = { ...defaultParameters('resistor'), resistance: scalar(8200, 'ohm') }
const ROUT: Parameters = { ...defaultParameters('resistor'), resistance: scalar(18000, 'ohm') }

export const OPAMP_BLOCK: BlockData = {
  name: 'Op-Amp',
  origin: { x: 0, y: 0 },
  nodes: [
    // PNP current-mirror load across the +rail
    { id: 'q3', definition: 'transistor_bjt_pnp', x: 40, y: 20, parameters: PNP },
    { id: 'q4', definition: 'transistor_bjt_pnp', x: 220, y: 20, parameters: PNP },
    // NPN differential pair
    { id: 'q1', definition: 'transistor_bjt_npn', x: 40, y: 170, parameters: NPN },
    { id: 'q2', definition: 'transistor_bjt_npn', x: 220, y: 170, parameters: NPN },
    // tail resistor down to the −rail
    { id: 'rtail', definition: 'resistor', x: 130, y: 310, parameters: RTAIL },
    // PNP common-emitter gain stage + its output load
    { id: 'q5', definition: 'transistor_bjt_pnp', x: 420, y: 60, parameters: PNP },
    { id: 'rout', definition: 'resistor', x: 420, y: 210, parameters: ROUT },
  ],
  edges: [
    // tail net: Q1.emitter — Q2.emitter — Rtail.a
    { id: 't1', source: 'q1', sourceHandle: 'emitter', target: 'q2', targetHandle: 'emitter' },
    {
      id: 't2',
      source: 'q2',
      sourceHandle: 'emitter',
      target: 'rtail',
      targetHandle: 'terminal_a',
    },
    // mirror net: Q1.collector — Q3 (diode-connected: collector = base) — Q4.base
    { id: 'm1', source: 'q1', sourceHandle: 'collector', target: 'q3', targetHandle: 'collector' },
    { id: 'm2', source: 'q3', sourceHandle: 'collector', target: 'q3', targetHandle: 'base' },
    { id: 'm3', source: 'q3', sourceHandle: 'base', target: 'q4', targetHandle: 'base' },
    // interstage net: Q2.collector — Q4.collector — Q5.base
    { id: 's1', source: 'q2', sourceHandle: 'collector', target: 'q4', targetHandle: 'collector' },
    { id: 's2', source: 'q4', sourceHandle: 'collector', target: 'q5', targetHandle: 'base' },
    // +rail net: Q3.emitter — Q4.emitter — Q5.emitter  (the V+ port routes here)
    { id: 'p1', source: 'q3', sourceHandle: 'emitter', target: 'q4', targetHandle: 'emitter' },
    { id: 'p2', source: 'q4', sourceHandle: 'emitter', target: 'q5', targetHandle: 'emitter' },
    // output net: Q5.collector — Rout.a  (the out port routes here)
    {
      id: 'o1',
      source: 'q5',
      sourceHandle: 'collector',
      target: 'rout',
      targetHandle: 'terminal_a',
    },
    // −rail net: Rtail.b — Rout.b  (the V− port routes here)
    {
      id: 'n1',
      source: 'rtail',
      sourceHandle: 'terminal_b',
      target: 'rout',
      targetHandle: 'terminal_b',
    },
  ],
  ports: [
    {
      id: 'in_minus',
      label: 'in −',
      side: 'left',
      offset: 14,
      inner: { nodeId: 'q1', handleId: 'base' },
    },
    {
      id: 'in_plus',
      label: 'in +',
      side: 'left',
      offset: 36,
      inner: { nodeId: 'q2', handleId: 'base' },
    },
    {
      id: 'v_minus',
      label: 'V−',
      side: 'left',
      offset: 58,
      inner: { nodeId: 'rtail', handleId: 'terminal_b' },
    },
    {
      id: 'out',
      label: 'out',
      side: 'right',
      offset: 14,
      inner: { nodeId: 'q5', handleId: 'collector' },
    },
    {
      id: 'v_plus',
      label: 'V+',
      side: 'right',
      offset: 36,
      inner: { nodeId: 'q3', handleId: 'emitter' },
    },
  ],
}

// Logic-process MOSFETs: lower thresholds than the discrete 2N7000 / BS250 power parts
// (the cited defaults supply the ratings + thermal), tuned to the values proven to switch
// cleanly in the CMOS inverter test — the transistors of a 5 V logic gate.
const LOGIC_NMOS: Parameters = {
  ...defaultParameters('transistor_mosfet_nmos'),
  threshold_voltage: scalar(2.1, 'volt'),
  transconductance_parameter: scalar(0.026, 'ampere_per_volt_squared'),
}
const LOGIC_PMOS: Parameters = {
  ...defaultParameters('transistor_mosfet_pmos'),
  threshold_voltage: scalar(-2.5, 'volt'),
  transconductance_parameter: scalar(0.0062, 'ampere_per_volt_squared'),
}

/**
 * THE CMOS INVERTER (NOT) — the first logic gate, two transistors. A PMOS pull-up and an
 * NMOS pull-down share their gate (the input) and their drain (the output): drive the input
 * HIGH and the NMOS pulls the output to GND; drive it LOW and the PMOS pulls it to V+. It
 * flattens to the real MOSFETs, so the NOT truth table falls out of actual silicon switching,
 * not a lookup. Five pins become ports: in, out, and the V+/GND rails.
 */
export const INVERTER_BLOCK: BlockData = {
  name: 'NOT',
  origin: { x: 0, y: 0 },
  nodes: [
    { id: 'pmos', definition: 'transistor_mosfet_pmos', x: 120, y: 30, parameters: LOGIC_PMOS },
    { id: 'nmos', definition: 'transistor_mosfet_nmos', x: 120, y: 180, parameters: LOGIC_NMOS },
  ],
  edges: [
    // output net: PMOS drain — NMOS drain
    { id: 'n_out', source: 'pmos', sourceHandle: 'drain', target: 'nmos', targetHandle: 'drain' },
    // input net: PMOS gate — NMOS gate
    { id: 'n_in', source: 'pmos', sourceHandle: 'gate', target: 'nmos', targetHandle: 'gate' },
  ],
  ports: [
    {
      id: 'in',
      label: 'in',
      side: 'left',
      offset: 18,
      inner: { nodeId: 'nmos', handleId: 'gate' },
    },
    {
      id: 'gnd',
      label: 'GND',
      side: 'left',
      offset: 42,
      inner: { nodeId: 'nmos', handleId: 'source' },
    },
    {
      id: 'out',
      label: 'out',
      side: 'right',
      offset: 18,
      inner: { nodeId: 'pmos', handleId: 'drain' },
    },
    {
      id: 'v_dd',
      label: 'V+',
      side: 'right',
      offset: 42,
      inner: { nodeId: 'pmos', handleId: 'source' },
    },
  ],
}

/**
 * 2-INPUT NAND — OUT = NOT(A AND B), a universal gate (every other gate can be built from
 * NANDs). CMOS form: the pull-up is two PMOS in PARALLEL (either input LOW switches one on
 * and pulls OUT up), the pull-down is two NMOS in SERIES (only A AND B both HIGH lets the
 * stack conduct and pull OUT down). Four MOSFETs; it flattens to them, so the truth table is
 * real switching. Inputs A/B, output, and the V+/GND rails become ports.
 */
export const NAND2_BLOCK: BlockData = {
  name: 'NAND',
  origin: { x: 0, y: 0 },
  nodes: [
    { id: 'p_a', definition: 'transistor_mosfet_pmos', x: 60, y: 30, parameters: LOGIC_PMOS },
    { id: 'p_b', definition: 'transistor_mosfet_pmos', x: 200, y: 30, parameters: LOGIC_PMOS },
    { id: 'n_b', definition: 'transistor_mosfet_nmos', x: 130, y: 170, parameters: LOGIC_NMOS },
    { id: 'n_a', definition: 'transistor_mosfet_nmos', x: 130, y: 300, parameters: LOGIC_NMOS },
  ],
  edges: [
    // V+ rail: the two PMOS sources
    {
      id: 'rail_vdd',
      source: 'p_a',
      sourceHandle: 'source',
      target: 'p_b',
      targetHandle: 'source',
    },
    // output net: both PMOS drains + the top NMOS drain
    { id: 'out_pp', source: 'p_a', sourceHandle: 'drain', target: 'p_b', targetHandle: 'drain' },
    { id: 'out_pn', source: 'p_b', sourceHandle: 'drain', target: 'n_b', targetHandle: 'drain' },
    // series middle: bottom NMOS drain — top NMOS source
    { id: 'series', source: 'n_a', sourceHandle: 'drain', target: 'n_b', targetHandle: 'source' },
    // input A: p_a.gate — n_a.gate ; input B: p_b.gate — n_b.gate
    { id: 'gate_a', source: 'p_a', sourceHandle: 'gate', target: 'n_a', targetHandle: 'gate' },
    { id: 'gate_b', source: 'p_b', sourceHandle: 'gate', target: 'n_b', targetHandle: 'gate' },
  ],
  ports: [
    { id: 'a', label: 'A', side: 'left', offset: 14, inner: { nodeId: 'n_a', handleId: 'gate' } },
    { id: 'b', label: 'B', side: 'left', offset: 36, inner: { nodeId: 'n_b', handleId: 'gate' } },
    {
      id: 'gnd',
      label: 'GND',
      side: 'left',
      offset: 58,
      inner: { nodeId: 'n_a', handleId: 'source' },
    },
    {
      id: 'out',
      label: 'out',
      side: 'right',
      offset: 14,
      inner: { nodeId: 'p_a', handleId: 'drain' },
    },
    {
      id: 'v_dd',
      label: 'V+',
      side: 'right',
      offset: 36,
      inner: { nodeId: 'p_a', handleId: 'source' },
    },
  ],
}

/**
 * 2-INPUT NOR — OUT = NOT(A OR B), the other universal gate. CMOS form is the NAND's mirror:
 * the pull-up is two PMOS in SERIES (only A AND B both LOW lets the stack pull OUT up), the
 * pull-down is two NMOS in PARALLEL (either input HIGH pulls OUT down). Four MOSFETs; real
 * switching, flattened to the solver.
 */
export const NOR2_BLOCK: BlockData = {
  name: 'NOR',
  origin: { x: 0, y: 0 },
  nodes: [
    { id: 'p_a', definition: 'transistor_mosfet_pmos', x: 130, y: 30, parameters: LOGIC_PMOS },
    { id: 'p_b', definition: 'transistor_mosfet_pmos', x: 130, y: 160, parameters: LOGIC_PMOS },
    { id: 'n_a', definition: 'transistor_mosfet_nmos', x: 60, y: 300, parameters: LOGIC_NMOS },
    { id: 'n_b', definition: 'transistor_mosfet_nmos', x: 200, y: 300, parameters: LOGIC_NMOS },
  ],
  edges: [
    // series middle: top PMOS drain — bottom PMOS source
    { id: 'series', source: 'p_a', sourceHandle: 'drain', target: 'p_b', targetHandle: 'source' },
    // output net: bottom PMOS drain + both NMOS drains
    { id: 'out_pn', source: 'p_b', sourceHandle: 'drain', target: 'n_a', targetHandle: 'drain' },
    { id: 'out_nn', source: 'n_a', sourceHandle: 'drain', target: 'n_b', targetHandle: 'drain' },
    // GND rail: the two NMOS sources
    {
      id: 'rail_gnd',
      source: 'n_a',
      sourceHandle: 'source',
      target: 'n_b',
      targetHandle: 'source',
    },
    // input A: p_a.gate — n_a.gate ; input B: p_b.gate — n_b.gate
    { id: 'gate_a', source: 'p_a', sourceHandle: 'gate', target: 'n_a', targetHandle: 'gate' },
    { id: 'gate_b', source: 'p_b', sourceHandle: 'gate', target: 'n_b', targetHandle: 'gate' },
  ],
  ports: [
    { id: 'a', label: 'A', side: 'left', offset: 14, inner: { nodeId: 'n_a', handleId: 'gate' } },
    { id: 'b', label: 'B', side: 'left', offset: 36, inner: { nodeId: 'n_b', handleId: 'gate' } },
    {
      id: 'gnd',
      label: 'GND',
      side: 'left',
      offset: 58,
      inner: { nodeId: 'n_a', handleId: 'source' },
    },
    {
      id: 'out',
      label: 'out',
      side: 'right',
      offset: 14,
      inner: { nodeId: 'p_b', handleId: 'drain' },
    },
    {
      id: 'v_dd',
      label: 'V+',
      side: 'right',
      offset: 36,
      inner: { nodeId: 'p_a', handleId: 'source' },
    },
  ],
}

/** Built-in blocks droppable from the palette, keyed by their palette definition id.
 *  The palette lists these like parts; App's drop handler turns one into a block node
 *  (a fresh deep copy) that descends + flattens like any user-grouped block. */
export const BUILTIN_BLOCKS: Record<string, BlockData> = {
  op_amp: OPAMP_BLOCK,
  logic_not: INVERTER_BLOCK,
  logic_nand: NAND2_BLOCK,
  logic_nor: NOR2_BLOCK,
}
