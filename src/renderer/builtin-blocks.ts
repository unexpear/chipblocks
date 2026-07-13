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

// The gates' (and the SRAM's) transistors are REAL, specific discrete parts — the 2N7000 (NMOS) and
// BS250 (PMOS), the classic TO-92 pair you build 5 V logic from. These pin each part's datasheet-derived
// values (V_th 2.1 / −2.5 V, k 26 / 6.2 mA/V² — the SAME numbers part-defaults.ts derives from each
// datasheet's I_D(on) point), so a gate's truth table falls out of those exact parts actually switching,
// not a tuned fit. (A fabricated IC would use on-chip FETs in place of the TO-92 discretes — a later
// fidelity step; the part number then becomes the cell, not the 2N7000.)
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
  symbol: 'not',
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
  symbol: 'nand',
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
  symbol: 'nor',
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

/**
 * AND = NAND followed by an inverter (NOT(NOT(A AND B)) = A AND B). Built by COMPOSITION:
 * its two inner nodes are the NAND and NOT gate blocks themselves, wired NAND-output to
 * inverter-input with shared rails. Descend into it and you see a NAND and an inverter;
 * descend again and you reach the transistors. The flatten is recursive, so the solver still
 * sees only the six real MOSFETs.
 */
export const AND_BLOCK: BlockData = {
  name: 'AND',
  symbol: 'and',
  origin: { x: 0, y: 0 },
  nodes: [
    { id: 'nand', definition: 'block', x: 40, y: 60, block: NAND2_BLOCK },
    { id: 'inv', definition: 'block', x: 360, y: 60, block: INVERTER_BLOCK },
  ],
  edges: [
    { id: 'chain', source: 'nand', sourceHandle: 'out', target: 'inv', targetHandle: 'in' },
    { id: 'vdd', source: 'nand', sourceHandle: 'v_dd', target: 'inv', targetHandle: 'v_dd' },
    { id: 'gnd', source: 'nand', sourceHandle: 'gnd', target: 'inv', targetHandle: 'gnd' },
  ],
  ports: [
    { id: 'a', label: 'A', side: 'left', offset: 14, inner: { nodeId: 'nand', handleId: 'a' } },
    { id: 'b', label: 'B', side: 'left', offset: 36, inner: { nodeId: 'nand', handleId: 'b' } },
    {
      id: 'gnd',
      label: 'GND',
      side: 'left',
      offset: 58,
      inner: { nodeId: 'nand', handleId: 'gnd' },
    },
    {
      id: 'out',
      label: 'out',
      side: 'right',
      offset: 14,
      inner: { nodeId: 'inv', handleId: 'out' },
    },
    {
      id: 'v_dd',
      label: 'V+',
      side: 'right',
      offset: 36,
      inner: { nodeId: 'nand', handleId: 'v_dd' },
    },
  ],
}

/** OR = NOR followed by an inverter (NOT(NOT(A OR B)) = A OR B). Same composition as AND, with
 *  a NOR in front instead of a NAND. */
export const OR_BLOCK: BlockData = {
  name: 'OR',
  symbol: 'or',
  origin: { x: 0, y: 0 },
  nodes: [
    { id: 'nor', definition: 'block', x: 40, y: 60, block: NOR2_BLOCK },
    { id: 'inv', definition: 'block', x: 360, y: 60, block: INVERTER_BLOCK },
  ],
  edges: [
    { id: 'chain', source: 'nor', sourceHandle: 'out', target: 'inv', targetHandle: 'in' },
    { id: 'vdd', source: 'nor', sourceHandle: 'v_dd', target: 'inv', targetHandle: 'v_dd' },
    { id: 'gnd', source: 'nor', sourceHandle: 'gnd', target: 'inv', targetHandle: 'gnd' },
  ],
  ports: [
    { id: 'a', label: 'A', side: 'left', offset: 14, inner: { nodeId: 'nor', handleId: 'a' } },
    { id: 'b', label: 'B', side: 'left', offset: 36, inner: { nodeId: 'nor', handleId: 'b' } },
    {
      id: 'gnd',
      label: 'GND',
      side: 'left',
      offset: 58,
      inner: { nodeId: 'nor', handleId: 'gnd' },
    },
    {
      id: 'out',
      label: 'out',
      side: 'right',
      offset: 14,
      inner: { nodeId: 'inv', handleId: 'out' },
    },
    {
      id: 'v_dd',
      label: 'V+',
      side: 'right',
      offset: 36,
      inner: { nodeId: 'nor', handleId: 'v_dd' },
    },
  ],
}

/**
 * XOR = the classic four-NAND network. nab = NAND(A,B); then OUT = NAND(NAND(A,nab),
 * NAND(B,nab)). The output is HIGH exactly when the inputs differ. Four NAND blocks wired
 * together — descend to see the four gates, descend again for the sixteen transistors.
 */
export const XOR_BLOCK: BlockData = {
  name: 'XOR',
  symbol: 'xor',
  origin: { x: 0, y: 0 },
  nodes: [
    { id: 'g1', definition: 'block', x: 40, y: 30, block: NAND2_BLOCK },
    { id: 'g2', definition: 'block', x: 280, y: 30, block: NAND2_BLOCK },
    { id: 'g3', definition: 'block', x: 280, y: 220, block: NAND2_BLOCK },
    { id: 'g4', definition: 'block', x: 520, y: 120, block: NAND2_BLOCK },
  ],
  edges: [
    // A reaches g1.a and g2.a; B reaches g1.b and g3.a
    { id: 'a_net', source: 'g1', sourceHandle: 'a', target: 'g2', targetHandle: 'a' },
    { id: 'b_net', source: 'g1', sourceHandle: 'b', target: 'g3', targetHandle: 'a' },
    // nab = g1.out fans out to g2.b and g3.b
    { id: 'nab1', source: 'g1', sourceHandle: 'out', target: 'g2', targetHandle: 'b' },
    { id: 'nab2', source: 'g1', sourceHandle: 'out', target: 'g3', targetHandle: 'b' },
    // g2.out and g3.out into the final NAND
    { id: 'x_net', source: 'g2', sourceHandle: 'out', target: 'g4', targetHandle: 'a' },
    { id: 'y_net', source: 'g3', sourceHandle: 'out', target: 'g4', targetHandle: 'b' },
    // shared V+ across all four gates
    { id: 'vdd1', source: 'g1', sourceHandle: 'v_dd', target: 'g2', targetHandle: 'v_dd' },
    { id: 'vdd2', source: 'g2', sourceHandle: 'v_dd', target: 'g3', targetHandle: 'v_dd' },
    { id: 'vdd3', source: 'g3', sourceHandle: 'v_dd', target: 'g4', targetHandle: 'v_dd' },
    // shared GND across all four gates
    { id: 'gnd1', source: 'g1', sourceHandle: 'gnd', target: 'g2', targetHandle: 'gnd' },
    { id: 'gnd2', source: 'g2', sourceHandle: 'gnd', target: 'g3', targetHandle: 'gnd' },
    { id: 'gnd3', source: 'g3', sourceHandle: 'gnd', target: 'g4', targetHandle: 'gnd' },
  ],
  ports: [
    { id: 'a', label: 'A', side: 'left', offset: 14, inner: { nodeId: 'g1', handleId: 'a' } },
    { id: 'b', label: 'B', side: 'left', offset: 36, inner: { nodeId: 'g1', handleId: 'b' } },
    {
      id: 'gnd',
      label: 'GND',
      side: 'left',
      offset: 58,
      inner: { nodeId: 'g1', handleId: 'gnd' },
    },
    {
      id: 'out',
      label: 'out',
      side: 'right',
      offset: 14,
      inner: { nodeId: 'g4', handleId: 'out' },
    },
    {
      id: 'v_dd',
      label: 'V+',
      side: 'right',
      offset: 36,
      inner: { nodeId: 'g1', handleId: 'v_dd' },
    },
  ],
}

/**
 * XNOR = XOR followed by an inverter (NOT(A XOR B)) — HIGH exactly when the inputs MATCH.
 * Composition of an XOR block and a NOT block: XOR-output to inverter-input, shared rails.
 * Flattens recursively to the XOR's sixteen MOSFETs plus the inverter's two.
 */
export const XNOR_BLOCK: BlockData = {
  name: 'XNOR',
  symbol: 'xnor',
  origin: { x: 0, y: 0 },
  nodes: [
    { id: 'xor', definition: 'block', x: 40, y: 60, block: XOR_BLOCK },
    { id: 'inv', definition: 'block', x: 660, y: 60, block: INVERTER_BLOCK },
  ],
  edges: [
    { id: 'chain', source: 'xor', sourceHandle: 'out', target: 'inv', targetHandle: 'in' },
    { id: 'vdd', source: 'xor', sourceHandle: 'v_dd', target: 'inv', targetHandle: 'v_dd' },
    { id: 'gnd', source: 'xor', sourceHandle: 'gnd', target: 'inv', targetHandle: 'gnd' },
  ],
  ports: [
    { id: 'a', label: 'A', side: 'left', offset: 14, inner: { nodeId: 'xor', handleId: 'a' } },
    { id: 'b', label: 'B', side: 'left', offset: 36, inner: { nodeId: 'xor', handleId: 'b' } },
    {
      id: 'gnd',
      label: 'GND',
      side: 'left',
      offset: 58,
      inner: { nodeId: 'xor', handleId: 'gnd' },
    },
    {
      id: 'out',
      label: 'out',
      side: 'right',
      offset: 14,
      inner: { nodeId: 'inv', handleId: 'out' },
    },
    {
      id: 'v_dd',
      label: 'V+',
      side: 'right',
      offset: 36,
      inner: { nodeId: 'xor', handleId: 'v_dd' },
    },
  ],
}

/**
 * BUFFER = two inverters in series (NOT(NOT(A)) = A) — a non-inverting gate that restores a
 * clean full-swing logic level and drives a load. Composition of two NOT blocks; flattens to
 * the four MOSFETs.
 */
export const BUFFER_BLOCK: BlockData = {
  name: 'Buffer',
  symbol: 'buffer',
  origin: { x: 0, y: 0 },
  nodes: [
    { id: 'inv1', definition: 'block', x: 40, y: 60, block: INVERTER_BLOCK },
    { id: 'inv2', definition: 'block', x: 320, y: 60, block: INVERTER_BLOCK },
  ],
  edges: [
    { id: 'chain', source: 'inv1', sourceHandle: 'out', target: 'inv2', targetHandle: 'in' },
    { id: 'vdd', source: 'inv1', sourceHandle: 'v_dd', target: 'inv2', targetHandle: 'v_dd' },
    { id: 'gnd', source: 'inv1', sourceHandle: 'gnd', target: 'inv2', targetHandle: 'gnd' },
  ],
  ports: [
    { id: 'in', label: 'in', side: 'left', offset: 18, inner: { nodeId: 'inv1', handleId: 'in' } },
    {
      id: 'gnd',
      label: 'GND',
      side: 'left',
      offset: 42,
      inner: { nodeId: 'inv1', handleId: 'gnd' },
    },
    {
      id: 'out',
      label: 'out',
      side: 'right',
      offset: 18,
      inner: { nodeId: 'inv2', handleId: 'out' },
    },
    {
      id: 'v_dd',
      label: 'V+',
      side: 'right',
      offset: 42,
      inner: { nodeId: 'inv1', handleId: 'v_dd' },
    },
  ],
}

/**
 * HALF ADDER — adds two bits. SUM = A XOR B, CARRY = A AND B. Literally an XOR gate and an
 * AND gate sharing the two inputs: descend to see exactly those two gates. This is the first
 * block with TWO outputs. (1 + 1 = 10 in binary: sum 0, carry 1 — the carry is the AND.)
 */
export const HALF_ADDER_BLOCK: BlockData = {
  name: 'Half Adder',
  origin: { x: 0, y: 0 },
  nodes: [
    { id: 'xor', definition: 'block', x: 40, y: 30, block: XOR_BLOCK },
    { id: 'and', definition: 'block', x: 40, y: 300, block: AND_BLOCK },
  ],
  edges: [
    // A and B each reach both gates
    { id: 'a_net', source: 'xor', sourceHandle: 'a', target: 'and', targetHandle: 'a' },
    { id: 'b_net', source: 'xor', sourceHandle: 'b', target: 'and', targetHandle: 'b' },
    { id: 'vdd', source: 'xor', sourceHandle: 'v_dd', target: 'and', targetHandle: 'v_dd' },
    { id: 'gnd', source: 'xor', sourceHandle: 'gnd', target: 'and', targetHandle: 'gnd' },
  ],
  ports: [
    { id: 'a', label: 'A', side: 'left', offset: 14, inner: { nodeId: 'xor', handleId: 'a' } },
    { id: 'b', label: 'B', side: 'left', offset: 36, inner: { nodeId: 'xor', handleId: 'b' } },
    {
      id: 'gnd',
      label: 'GND',
      side: 'left',
      offset: 58,
      inner: { nodeId: 'xor', handleId: 'gnd' },
    },
    { id: 'sum', label: 'S', side: 'right', offset: 14, inner: { nodeId: 'xor', handleId: 'out' } },
    {
      id: 'carry',
      label: 'C',
      side: 'right',
      offset: 36,
      inner: { nodeId: 'and', handleId: 'out' },
    },
    {
      id: 'v_dd',
      label: 'V+',
      side: 'right',
      offset: 58,
      inner: { nodeId: 'xor', handleId: 'v_dd' },
    },
  ],
}

/**
 * FULL ADDER — adds three bits (A, B, and a carry-in), the cell a multi-bit adder is built
 * from. Two half-adders in series compute the sum (A XOR B XOR Cin); their two carries OR
 * together for the carry-out. Descend to see two half-adders and an OR gate.
 */
export const FULL_ADDER_BLOCK: BlockData = {
  name: 'Full Adder',
  origin: { x: 0, y: 0 },
  nodes: [
    { id: 'ha1', definition: 'block', x: 40, y: 30, block: HALF_ADDER_BLOCK },
    { id: 'ha2', definition: 'block', x: 380, y: 30, block: HALF_ADDER_BLOCK },
    { id: 'or', definition: 'block', x: 720, y: 140, block: OR_BLOCK },
  ],
  edges: [
    // first sum feeds the second half-adder; Cin arrives at ha2.b
    { id: 's1', source: 'ha1', sourceHandle: 'sum', target: 'ha2', targetHandle: 'a' },
    // the two carries OR together
    { id: 'c1', source: 'ha1', sourceHandle: 'carry', target: 'or', targetHandle: 'a' },
    { id: 'c2', source: 'ha2', sourceHandle: 'carry', target: 'or', targetHandle: 'b' },
    // shared rails
    { id: 'vdd1', source: 'ha1', sourceHandle: 'v_dd', target: 'ha2', targetHandle: 'v_dd' },
    { id: 'vdd2', source: 'ha2', sourceHandle: 'v_dd', target: 'or', targetHandle: 'v_dd' },
    { id: 'gnd1', source: 'ha1', sourceHandle: 'gnd', target: 'ha2', targetHandle: 'gnd' },
    { id: 'gnd2', source: 'ha2', sourceHandle: 'gnd', target: 'or', targetHandle: 'gnd' },
  ],
  ports: [
    { id: 'a', label: 'A', side: 'left', offset: 14, inner: { nodeId: 'ha1', handleId: 'a' } },
    { id: 'b', label: 'B', side: 'left', offset: 32, inner: { nodeId: 'ha1', handleId: 'b' } },
    { id: 'cin', label: 'Cin', side: 'left', offset: 50, inner: { nodeId: 'ha2', handleId: 'b' } },
    {
      id: 'gnd',
      label: 'GND',
      side: 'left',
      offset: 68,
      inner: { nodeId: 'ha1', handleId: 'gnd' },
    },
    { id: 'sum', label: 'S', side: 'right', offset: 14, inner: { nodeId: 'ha2', handleId: 'sum' } },
    {
      id: 'cout',
      label: 'Cout',
      side: 'right',
      offset: 32,
      inner: { nodeId: 'or', handleId: 'out' },
    },
    {
      id: 'v_dd',
      label: 'V+',
      side: 'right',
      offset: 50,
      inner: { nodeId: 'ha1', handleId: 'v_dd' },
    },
  ],
}

/**
 * RIPPLE-CARRY ADDER (N-bit) — N full-adders chained, the carry-out of each cell feeding the
 * carry-in of the next, so the carry literally ripples from the lowest bit to the highest. This
 * is how real binary addition is built. Inputs A0..A(N-1) and B0..B(N-1) (bit 0 = least
 * significant), a carry-in, and a shared V+/GND; outputs the sum bits S0..S(N-1) and the final
 * carry-out. Descend to see the full-adder cells, descend again for their gates, again for the
 * transistors. An N-bit adder is ~50·N MOSFETs.
 */
function rippleCarryAdder(bits: number): BlockData {
  const nodes: BlockData['nodes'] = []
  const edges: BlockData['edges'] = []
  const ports: BlockData['ports'] = []
  for (let i = 0; i < bits; i++) {
    nodes.push({
      id: `fa${i}`,
      definition: 'block',
      x: 40,
      y: 30 + i * 360,
      block: FULL_ADDER_BLOCK,
    })
    if (i > 0) {
      const prev = `fa${i - 1}`
      const here = `fa${i}`
      // the carry ripples up one bit; V+/GND chain across the cells
      edges.push({
        id: `carry${i}`,
        source: prev,
        sourceHandle: 'cout',
        target: here,
        targetHandle: 'cin',
      })
      edges.push({
        id: `vdd${i}`,
        source: prev,
        sourceHandle: 'v_dd',
        target: here,
        targetHandle: 'v_dd',
      })
      edges.push({
        id: `gnd${i}`,
        source: prev,
        sourceHandle: 'gnd',
        target: here,
        targetHandle: 'gnd',
      })
    }
  }
  // Left side: each bit's A and B inputs, then the carry-in and ground.
  let left = 14
  for (let i = 0; i < bits; i++) {
    ports.push({
      id: `a${i}`,
      label: `A${i}`,
      side: 'left',
      offset: left,
      inner: { nodeId: `fa${i}`, handleId: 'a' },
    })
    left += 18
    ports.push({
      id: `b${i}`,
      label: `B${i}`,
      side: 'left',
      offset: left,
      inner: { nodeId: `fa${i}`, handleId: 'b' },
    })
    left += 18
  }
  ports.push({
    id: 'cin',
    label: 'Cin',
    side: 'left',
    offset: left,
    inner: { nodeId: 'fa0', handleId: 'cin' },
  })
  left += 18
  ports.push({
    id: 'gnd',
    label: 'GND',
    side: 'left',
    offset: left,
    inner: { nodeId: 'fa0', handleId: 'gnd' },
  })
  // Right side: each bit's sum output, then the carry-out and V+.
  let right = 14
  for (let i = 0; i < bits; i++) {
    ports.push({
      id: `s${i}`,
      label: `S${i}`,
      side: 'right',
      offset: right,
      inner: { nodeId: `fa${i}`, handleId: 'sum' },
    })
    right += 18
  }
  ports.push({
    id: 'cout',
    label: 'Cout',
    side: 'right',
    offset: right,
    inner: { nodeId: `fa${bits - 1}`, handleId: 'cout' },
  })
  right += 18
  ports.push({
    id: 'v_dd',
    label: 'V+',
    side: 'right',
    offset: right,
    inner: { nodeId: 'fa0', handleId: 'v_dd' },
  })
  return { name: `${bits}-bit Adder`, origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** The smallest real multi-bit adder (~100 MOSFETs) and a 4-bit nibble adder (~200) — the same
 *  ripple-carry builder, more cells in the chain. */
export const RIPPLE_CARRY_2BIT: BlockData = rippleCarryAdder(2)
export const RIPPLE_CARRY_4BIT: BlockData = rippleCarryAdder(4)

/**
 * BCD single-digit adder — brick ① of the decimal calculator. Adds two BCD digits A, B (each 0–9) plus a
 * carry-in the REAL way: a 4-bit binary add, then the decimal "+6 correction" when the binary sum exceeds
 * 9 — so 7 + 5 reads 12 (digit 2, carry 1), not the binary 0xC. Built from two 4-bit adders + three
 * correction gates; descend to the gates, descend again to the transistors.
 *   correction = Cout₁ OR (S3 AND (S2 OR S1));  digit = binary-sum + (correction ? 6 : 0);  carry = correction.
 */
function bcdDigitAdder(): BlockData {
  const nodes: BlockData['nodes'] = [
    { id: 'add1', definition: 'block', x: 40, y: 30, block: RIPPLE_CARRY_4BIT },
    { id: 'or1', definition: 'block', x: 460, y: 30, block: OR_BLOCK },
    { id: 'and1', definition: 'block', x: 680, y: 30, block: AND_BLOCK },
    { id: 'or2', definition: 'block', x: 900, y: 30, block: OR_BLOCK },
    { id: 'add2', definition: 'block', x: 40, y: 440, block: RIPPLE_CARRY_4BIT },
  ]
  const edges: BlockData['edges'] = [
    // correction = Cout₁ OR (S3 AND (S2 OR S1))
    { id: 'c1', source: 'add1', sourceHandle: 's2', target: 'or1', targetHandle: 'a' },
    { id: 'c2', source: 'add1', sourceHandle: 's1', target: 'or1', targetHandle: 'b' },
    { id: 'c3', source: 'add1', sourceHandle: 's3', target: 'and1', targetHandle: 'a' },
    { id: 'c4', source: 'or1', sourceHandle: 'out', target: 'and1', targetHandle: 'b' },
    { id: 'c5', source: 'add1', sourceHandle: 'cout', target: 'or2', targetHandle: 'a' },
    { id: 'c6', source: 'and1', sourceHandle: 'out', target: 'or2', targetHandle: 'b' },
    // add2 = binary sum (add1.s0..s3) + (correction ? 0110 : 0000)
    { id: 'd0', source: 'add1', sourceHandle: 's0', target: 'add2', targetHandle: 'a0' },
    { id: 'd1', source: 'add1', sourceHandle: 's1', target: 'add2', targetHandle: 'a1' },
    { id: 'd2', source: 'add1', sourceHandle: 's2', target: 'add2', targetHandle: 'a2' },
    { id: 'd3', source: 'add1', sourceHandle: 's3', target: 'add2', targetHandle: 'a3' },
    { id: 'e1', source: 'or2', sourceHandle: 'out', target: 'add2', targetHandle: 'b1' },
    { id: 'e2', source: 'or2', sourceHandle: 'out', target: 'add2', targetHandle: 'b2' },
    // the +6 word's zero bits + add2's carry-in tie to ground (logic 0)
    { id: 'z0', source: 'add2', sourceHandle: 'b0', target: 'add1', targetHandle: 'gnd' },
    { id: 'z3', source: 'add2', sourceHandle: 'b3', target: 'add1', targetHandle: 'gnd' },
    { id: 'zc', source: 'add2', sourceHandle: 'cin', target: 'add1', targetHandle: 'gnd' },
    // shared V+ / GND across every sub-block
    { id: 'p2', source: 'add1', sourceHandle: 'v_dd', target: 'add2', targetHandle: 'v_dd' },
    { id: 'p3', source: 'add1', sourceHandle: 'v_dd', target: 'or1', targetHandle: 'v_dd' },
    { id: 'p4', source: 'add1', sourceHandle: 'v_dd', target: 'and1', targetHandle: 'v_dd' },
    { id: 'p5', source: 'add1', sourceHandle: 'v_dd', target: 'or2', targetHandle: 'v_dd' },
    { id: 'q2', source: 'add1', sourceHandle: 'gnd', target: 'add2', targetHandle: 'gnd' },
    { id: 'q3', source: 'add1', sourceHandle: 'gnd', target: 'or1', targetHandle: 'gnd' },
    { id: 'q4', source: 'add1', sourceHandle: 'gnd', target: 'and1', targetHandle: 'gnd' },
    { id: 'q5', source: 'add1', sourceHandle: 'gnd', target: 'or2', targetHandle: 'gnd' },
  ]
  const ports: BlockData['ports'] = []
  let left = 14
  for (let i = 0; i < 4; i++) {
    ports.push({
      id: `a${i}`,
      label: `A${i}`,
      side: 'left',
      offset: left,
      inner: { nodeId: 'add1', handleId: `a${i}` },
    })
    left += 18
    ports.push({
      id: `b${i}`,
      label: `B${i}`,
      side: 'left',
      offset: left,
      inner: { nodeId: 'add1', handleId: `b${i}` },
    })
    left += 18
  }
  ports.push({
    id: 'cin',
    label: 'Cin',
    side: 'left',
    offset: left,
    inner: { nodeId: 'add1', handleId: 'cin' },
  })
  left += 18
  ports.push({
    id: 'gnd',
    label: 'GND',
    side: 'left',
    offset: left,
    inner: { nodeId: 'add1', handleId: 'gnd' },
  })
  let right = 14
  for (let i = 0; i < 4; i++) {
    ports.push({
      id: `s${i}`,
      label: `S${i}`,
      side: 'right',
      offset: right,
      inner: { nodeId: 'add2', handleId: `s${i}` },
    })
    right += 18
  }
  ports.push({
    id: 'cout',
    label: 'Cout',
    side: 'right',
    offset: right,
    inner: { nodeId: 'or2', handleId: 'out' },
  })
  right += 18
  ports.push({
    id: 'v_dd',
    label: 'V+',
    side: 'right',
    offset: right,
    inner: { nodeId: 'add1', handleId: 'v_dd' },
  })
  return { name: 'BCD Adder', origin: { x: 0, y: 0 }, nodes, edges, ports }
}

export const BCD_ADDER_BLOCK: BlockData = bcdDigitAdder()

/**
 * Brick ② — an N-digit BCD adder: N single-digit BCD adders in a chain, the decimal carry rippling from
 * the least-significant digit up to the most, exactly like the binary ripple-carry adder chains full
 * cells. Ports are flat: digit d occupies bits a/b/s [4d .. 4d+3], d=0 is the rightmost (ones) digit;
 * Cin feeds digit 0 (0 for add, 1 for subtract's ten's-complement) and Cout is the overflow past N digits.
 */
function bcdAdderChain(digits: number): BlockData {
  const nodes: BlockData['nodes'] = []
  const edges: BlockData['edges'] = []
  const ports: BlockData['ports'] = []
  for (let d = 0; d < digits; d++) {
    nodes.push({
      id: `bcd${d}`,
      definition: 'block',
      x: 40,
      y: 30 + d * 700,
      block: BCD_ADDER_BLOCK,
    })
    if (d > 0) {
      edges.push({
        id: `carry${d}`,
        source: `bcd${d - 1}`,
        sourceHandle: 'cout',
        target: `bcd${d}`,
        targetHandle: 'cin',
      })
      edges.push({
        id: `vdd${d}`,
        source: `bcd${d - 1}`,
        sourceHandle: 'v_dd',
        target: `bcd${d}`,
        targetHandle: 'v_dd',
      })
      edges.push({
        id: `gnd${d}`,
        source: `bcd${d - 1}`,
        sourceHandle: 'gnd',
        target: `bcd${d}`,
        targetHandle: 'gnd',
      })
    }
  }
  let left = 14
  for (let d = 0; d < digits; d++) {
    for (let i = 0; i < 4; i++) {
      ports.push({
        id: `a${d * 4 + i}`,
        label: `A${d}.${i}`,
        side: 'left',
        offset: left,
        inner: { nodeId: `bcd${d}`, handleId: `a${i}` },
      })
      left += 18
      ports.push({
        id: `b${d * 4 + i}`,
        label: `B${d}.${i}`,
        side: 'left',
        offset: left,
        inner: { nodeId: `bcd${d}`, handleId: `b${i}` },
      })
      left += 18
    }
  }
  ports.push({
    id: 'cin',
    label: 'Cin',
    side: 'left',
    offset: left,
    inner: { nodeId: 'bcd0', handleId: 'cin' },
  })
  left += 18
  ports.push({
    id: 'gnd',
    label: 'GND',
    side: 'left',
    offset: left,
    inner: { nodeId: 'bcd0', handleId: 'gnd' },
  })
  let right = 14
  for (let d = 0; d < digits; d++) {
    for (let i = 0; i < 4; i++) {
      ports.push({
        id: `s${d * 4 + i}`,
        label: `S${d}.${i}`,
        side: 'right',
        offset: right,
        inner: { nodeId: `bcd${d}`, handleId: `s${i}` },
      })
      right += 18
    }
  }
  ports.push({
    id: 'cout',
    label: 'Cout',
    side: 'right',
    offset: right,
    inner: { nodeId: `bcd${digits - 1}`, handleId: 'cout' },
  })
  right += 18
  ports.push({
    id: 'v_dd',
    label: 'V+',
    side: 'right',
    offset: right,
    inner: { nodeId: 'bcd0', handleId: 'v_dd' },
  })
  return { name: `${digits}-digit BCD Adder`, origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** The calculator's full-width adder: 10 decimal digits (0 … 9 999 999 999), Cout marks overflow. */
export const BCD_ADDER_10: BlockData = bcdAdderChain(10)

/**
 * Brick ③a — a controlled BCD nine's-complementer for one digit. SUB=0 passes the digit straight
 * through; SUB=1 outputs 9 − digit. Subtraction A − B is then A + ninescomp(B) + 1 (ten's complement),
 * so the very same adder does both add and subtract. Pure gates:
 *   o0 = d0 XOR sub;  o1 = d1;  o2 = d2 XOR (sub AND d1);  o3 = sub ? NOR(d3,d2,d1) : d3.
 */
function bcdComplementerDigit(): BlockData {
  const node = (
    id: string,
    block: BlockData,
    x: number,
    y: number,
  ): BlockData['nodes'][number] => ({
    id,
    definition: 'block',
    x,
    y,
    block,
  })
  const edge = (
    id: string,
    s: string,
    sh: string,
    t: string,
    th: string,
  ): BlockData['edges'][number] => ({
    id,
    source: s,
    sourceHandle: sh,
    target: t,
    targetHandle: th,
  })
  const nodes: BlockData['nodes'] = [
    node('x0', XOR_BLOCK, 40, 30),
    node('notsub', INVERTER_BLOCK, 40, 180),
    node('buf1', BUFFER_BLOCK, 40, 330),
    node('and2', AND_BLOCK, 40, 480),
    node('x2', XOR_BLOCK, 320, 480),
    node('ordd', OR_BLOCK, 40, 630),
    node('nor3', NOR2_BLOCK, 320, 630),
    node('a3a', AND_BLOCK, 40, 780),
    node('a3b', AND_BLOCK, 320, 780),
    node('or3', OR_BLOCK, 600, 780),
  ]
  const powered = ['notsub', 'buf1', 'and2', 'x2', 'ordd', 'nor3', 'a3a', 'a3b', 'or3']
  const edges: BlockData['edges'] = [
    // sub fans out (anchored at x0.b): NOT sub, the AND for o2, the AND for o3's complement branch
    edge('sub1', 'x0', 'b', 'notsub', 'in'),
    edge('sub2', 'x0', 'b', 'and2', 'a'),
    edge('sub3', 'x0', 'b', 'a3b', 'a'),
    // d1 fans out (anchored at buf1.in): the o2 AND, the o3 NOR
    edge('d1a', 'buf1', 'in', 'and2', 'b'),
    edge('d1b', 'buf1', 'in', 'nor3', 'b'),
    // d2 fans out (anchored at x2.a): the o3 OR-term
    edge('d2a', 'x2', 'a', 'ordd', 'b'),
    // d3 fans out (anchored at ordd.a): the o3 pass-through AND
    edge('d3a', 'ordd', 'a', 'a3a', 'b'),
    // internal logic
    edge('i1', 'notsub', 'out', 'a3a', 'a'), // o3 pass branch = notsub AND d3
    edge('i2', 'and2', 'out', 'x2', 'b'), // o2 = d2 XOR (sub AND d1)
    edge('i3', 'ordd', 'out', 'nor3', 'a'), // NOR(d3|d2, d1) = comp3
    edge('i4', 'nor3', 'out', 'a3b', 'b'), // o3 comp branch = sub AND comp3
    edge('i5', 'a3a', 'out', 'or3', 'a'),
    edge('i6', 'a3b', 'out', 'or3', 'b'),
    // shared V+ / GND from x0 to every other gate
    ...powered.map((n, k) => edge(`vdd${k}`, 'x0', 'v_dd', n, 'v_dd')),
    ...powered.map((n, k) => edge(`gnd${k}`, 'x0', 'gnd', n, 'gnd')),
  ]
  const ports: BlockData['ports'] = [
    { id: 'd0', label: 'D0', side: 'left', offset: 14, inner: { nodeId: 'x0', handleId: 'a' } },
    { id: 'd1', label: 'D1', side: 'left', offset: 32, inner: { nodeId: 'buf1', handleId: 'in' } },
    { id: 'd2', label: 'D2', side: 'left', offset: 50, inner: { nodeId: 'x2', handleId: 'a' } },
    { id: 'd3', label: 'D3', side: 'left', offset: 68, inner: { nodeId: 'ordd', handleId: 'a' } },
    { id: 'sub', label: 'SUB', side: 'left', offset: 86, inner: { nodeId: 'x0', handleId: 'b' } },
    {
      id: 'gnd',
      label: 'GND',
      side: 'left',
      offset: 104,
      inner: { nodeId: 'x0', handleId: 'gnd' },
    },
    { id: 'o0', label: 'O0', side: 'right', offset: 14, inner: { nodeId: 'x0', handleId: 'out' } },
    {
      id: 'o1',
      label: 'O1',
      side: 'right',
      offset: 32,
      inner: { nodeId: 'buf1', handleId: 'out' },
    },
    { id: 'o2', label: 'O2', side: 'right', offset: 50, inner: { nodeId: 'x2', handleId: 'out' } },
    { id: 'o3', label: 'O3', side: 'right', offset: 68, inner: { nodeId: 'or3', handleId: 'out' } },
    {
      id: 'v_dd',
      label: 'V+',
      side: 'right',
      offset: 86,
      inner: { nodeId: 'x0', handleId: 'v_dd' },
    },
  ]
  return { name: 'BCD 9s-Comp', origin: { x: 0, y: 0 }, nodes, edges, ports }
}

export const BCD_COMPLEMENTER_DIGIT: BlockData = bcdComplementerDigit()

/**
 * Brick ③b — the calculator's add/subtract ALU. Ten controlled nine's-complementers sit in front of the
 * 10-digit adder, all driven by one SUB line that also feeds the adder's carry-in. SUB=0 → result = A + B.
 * SUB=1 → result = A + ninescomp(B) + 1 = A − B (ten's complement): Cout=1 means A ≥ B (the result is the
 * true difference); Cout=0 means A < B (the result is the ten's complement of the magnitude — a negative,
 * for the control unit to flag). One adder, both operations.
 */
function bcdAddSubtract(digits: number): BlockData {
  const node = (
    id: string,
    block: BlockData,
    x: number,
    y: number,
  ): BlockData['nodes'][number] => ({
    id,
    definition: 'block',
    x,
    y,
    block,
  })
  const edge = (
    id: string,
    s: string,
    sh: string,
    t: string,
    th: string,
  ): BlockData['edges'][number] => ({
    id,
    source: s,
    sourceHandle: sh,
    target: t,
    targetHandle: th,
  })
  const nodes: BlockData['nodes'] = [
    node('add', BCD_ADDER_10, 1400, 30),
    ...Array.from({ length: digits }, (_, d) =>
      node(`comp${d}`, BCD_COMPLEMENTER_DIGIT, 40, 30 + d * 1100),
    ),
  ]
  const edges: BlockData['edges'] = []
  for (let d = 0; d < digits; d++) {
    for (let i = 0; i < 4; i++) {
      edges.push(edge(`cb${d}_${i}`, `comp${d}`, `o${i}`, 'add', `b${d * 4 + i}`))
    }
  }
  // one SUB line drives every complementer + the adder's carry-in (anchored at comp0.sub)
  for (let d = 1; d < digits; d++) edges.push(edge(`sub${d}`, 'comp0', 'sub', `comp${d}`, 'sub'))
  edges.push(edge('subcin', 'comp0', 'sub', 'add', 'cin'))
  for (let d = 0; d < digits; d++) {
    edges.push(edge(`vdd${d}`, 'add', 'v_dd', `comp${d}`, 'v_dd'))
    edges.push(edge(`gnd${d}`, 'add', 'gnd', `comp${d}`, 'gnd'))
  }
  const ports: BlockData['ports'] = []
  let left = 14
  for (let d = 0; d < digits; d++) {
    for (let i = 0; i < 4; i++) {
      ports.push({
        id: `a${d * 4 + i}`,
        label: `A${d}.${i}`,
        side: 'left',
        offset: left,
        inner: { nodeId: 'add', handleId: `a${d * 4 + i}` },
      })
      left += 18
      ports.push({
        id: `b${d * 4 + i}`,
        label: `B${d}.${i}`,
        side: 'left',
        offset: left,
        inner: { nodeId: `comp${d}`, handleId: `d${i}` },
      })
      left += 18
    }
  }
  ports.push({
    id: 'sub',
    label: 'SUB',
    side: 'left',
    offset: left,
    inner: { nodeId: 'comp0', handleId: 'sub' },
  })
  left += 18
  ports.push({
    id: 'gnd',
    label: 'GND',
    side: 'left',
    offset: left,
    inner: { nodeId: 'add', handleId: 'gnd' },
  })
  let right = 14
  for (let d = 0; d < digits; d++) {
    for (let i = 0; i < 4; i++) {
      ports.push({
        id: `s${d * 4 + i}`,
        label: `S${d}.${i}`,
        side: 'right',
        offset: right,
        inner: { nodeId: 'add', handleId: `s${d * 4 + i}` },
      })
      right += 18
    }
  }
  ports.push({
    id: 'cout',
    label: 'Cout',
    side: 'right',
    offset: right,
    inner: { nodeId: 'add', handleId: 'cout' },
  })
  right += 18
  ports.push({
    id: 'v_dd',
    label: 'V+',
    side: 'right',
    offset: right,
    inner: { nodeId: 'add', handleId: 'v_dd' },
  })
  return { name: `${digits}-digit BCD ALU`, origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** The calculator's adder/subtractor: A ± B over 10 decimal digits, selected by the SUB line. */
export const BCD_ALU_10: BlockData = bcdAddSubtract(10)

/**
 * The calculator's single-digit ALU CELL: one controlled nine's-complementer feeding one BCD digit-adder
 * — A ± B for ONE decimal digit, with a carry in/out, so a row of these TILES into the full adder/
 * subtractor (see tileRow) instead of being one 120-pin mega-block. Pins are placed for clean tiling:
 * carry CIN on the left, COUT on the right (the ripple runs straight along the row); A/B/SUB on top (the
 * input bus), the sum digit + rails on the bottom (toward the displays). Same circuit as one slice of
 * BCD_ALU_10, but as a real placeable cell. Pins carry no offsets, so they auto-spread on their edges.
 */
function bcdAluCell(): BlockData {
  const node = (
    id: string,
    block: BlockData,
    x: number,
    y: number,
  ): BlockData['nodes'][number] => ({ id, definition: 'block', x, y, block })
  const edge = (
    id: string,
    s: string,
    sh: string,
    t: string,
    th: string,
  ): BlockData['edges'][number] => ({
    id,
    source: s,
    sourceHandle: sh,
    target: t,
    targetHandle: th,
  })
  const nodes: BlockData['nodes'] = [
    node('comp', BCD_COMPLEMENTER_DIGIT, 40, 30),
    node('add', BCD_ADDER_BLOCK, 360, 30),
  ]
  const edges: BlockData['edges'] = [
    edge('cb0', 'comp', 'o0', 'add', 'b0'),
    edge('cb1', 'comp', 'o1', 'add', 'b1'),
    edge('cb2', 'comp', 'o2', 'add', 'b2'),
    edge('cb3', 'comp', 'o3', 'add', 'b3'),
    edge('vdd', 'add', 'v_dd', 'comp', 'v_dd'),
    edge('gnd', 'add', 'gnd', 'comp', 'gnd'),
  ]
  const ports: BlockData['ports'] = [
    { id: 'cin', label: 'Cin', side: 'left', inner: { nodeId: 'add', handleId: 'cin' } },
    { id: 'cout', label: 'Cout', side: 'right', inner: { nodeId: 'add', handleId: 'cout' } },
    { id: 'a0', label: 'A0', side: 'top', inner: { nodeId: 'add', handleId: 'a0' } },
    { id: 'a1', label: 'A1', side: 'top', inner: { nodeId: 'add', handleId: 'a1' } },
    { id: 'a2', label: 'A2', side: 'top', inner: { nodeId: 'add', handleId: 'a2' } },
    { id: 'a3', label: 'A3', side: 'top', inner: { nodeId: 'add', handleId: 'a3' } },
    { id: 'b0', label: 'B0', side: 'top', inner: { nodeId: 'comp', handleId: 'd0' } },
    { id: 'b1', label: 'B1', side: 'top', inner: { nodeId: 'comp', handleId: 'd1' } },
    { id: 'b2', label: 'B2', side: 'top', inner: { nodeId: 'comp', handleId: 'd2' } },
    { id: 'b3', label: 'B3', side: 'top', inner: { nodeId: 'comp', handleId: 'd3' } },
    { id: 'sub', label: 'SUB', side: 'top', inner: { nodeId: 'comp', handleId: 'sub' } },
    { id: 's0', label: 'S0', side: 'bottom', inner: { nodeId: 'add', handleId: 's0' } },
    { id: 's1', label: 'S1', side: 'bottom', inner: { nodeId: 'add', handleId: 's1' } },
    { id: 's2', label: 'S2', side: 'bottom', inner: { nodeId: 'add', handleId: 's2' } },
    { id: 's3', label: 'S3', side: 'bottom', inner: { nodeId: 'add', handleId: 's3' } },
    { id: 'v_dd', label: 'V+', side: 'bottom', inner: { nodeId: 'add', handleId: 'v_dd' } },
    { id: 'gnd', label: 'GND', side: 'bottom', inner: { nodeId: 'add', handleId: 'gnd' } },
  ]
  return { name: 'BCD ALU Cell', origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** One placeable digit-slice of the calculator's ALU — tile ten in a row to get BCD_ALU_10, cleanly. */
export const BCD_ALU_CELL: BlockData = bcdAluCell()

/**
 * ADDER / SUBTRACTOR (N-bit) — the heart of a calculator: a ripple-carry adder that can also
 * SUBTRACT. Each B bit first passes through an XOR with a shared SUB control line, and SUB also
 * drives the lowest carry-in. SUB=0 leaves B alone with Cin=0 (A + B); SUB=1 inverts every B bit and
 * adds 1, which is two's-complement negation (A + ~B + 1 = A − B). Inputs A0..A(N-1), B0..B(N-1), the
 * SUB mode bit, and a shared V+/GND; outputs S0..S(N-1) and the carry/borrow-out (on subtract,
 * Cout=1 means no borrow, A ≥ B). Descend to see the full-adders and the SUB XOR gates, again for
 * their gates, again for the transistors.
 */
function addSubtractor(bits: number): BlockData {
  const nodes: BlockData['nodes'] = []
  const edges: BlockData['edges'] = []
  const ports: BlockData['ports'] = []
  for (let i = 0; i < bits; i++) {
    nodes.push({
      id: `fa${i}`,
      definition: 'block',
      x: 40,
      y: 30 + i * 360,
      block: FULL_ADDER_BLOCK,
    })
    nodes.push({ id: `x${i}`, definition: 'block', x: -380, y: 70 + i * 360, block: XOR_BLOCK })
    // each B bit is XOR'd with SUB, then drives this cell's full-adder B input
    edges.push({
      id: `xb${i}`,
      source: `x${i}`,
      sourceHandle: 'out',
      target: `fa${i}`,
      targetHandle: 'b',
    })
    // every XOR shares its full-adder's rails
    edges.push({
      id: `xv${i}`,
      source: `x${i}`,
      sourceHandle: 'v_dd',
      target: `fa${i}`,
      targetHandle: 'v_dd',
    })
    edges.push({
      id: `xg${i}`,
      source: `x${i}`,
      sourceHandle: 'gnd',
      target: `fa${i}`,
      targetHandle: 'gnd',
    })
    if (i > 0) {
      const prev = i - 1
      // carry ripples up one bit; V+/GND chain across the cells; SUB chains across the XORs
      edges.push({
        id: `carry${i}`,
        source: `fa${prev}`,
        sourceHandle: 'cout',
        target: `fa${i}`,
        targetHandle: 'cin',
      })
      edges.push({
        id: `vdd${i}`,
        source: `fa${prev}`,
        sourceHandle: 'v_dd',
        target: `fa${i}`,
        targetHandle: 'v_dd',
      })
      edges.push({
        id: `gnd${i}`,
        source: `fa${prev}`,
        sourceHandle: 'gnd',
        target: `fa${i}`,
        targetHandle: 'gnd',
      })
      edges.push({
        id: `sub${i}`,
        source: `x${prev}`,
        sourceHandle: 'b',
        target: `x${i}`,
        targetHandle: 'b',
      })
    }
  }
  // SUB also drives the lowest carry-in (the +1 of two's-complement): fa0.cin joins the SUB net.
  edges.push({ id: 'cinsub', source: 'fa0', sourceHandle: 'cin', target: 'x0', targetHandle: 'b' })

  // Left ports: each bit's A and B, then the SUB mode bit and ground.
  let left = 14
  for (let i = 0; i < bits; i++) {
    ports.push({
      id: `a${i}`,
      label: `A${i}`,
      side: 'left',
      offset: left,
      inner: { nodeId: `fa${i}`, handleId: 'a' },
    })
    left += 18
    ports.push({
      id: `b${i}`,
      label: `B${i}`,
      side: 'left',
      offset: left,
      inner: { nodeId: `x${i}`, handleId: 'a' },
    })
    left += 18
  }
  ports.push({
    id: 'sub',
    label: 'SUB',
    side: 'left',
    offset: left,
    inner: { nodeId: 'x0', handleId: 'b' },
  })
  left += 18
  ports.push({
    id: 'gnd',
    label: 'GND',
    side: 'left',
    offset: left,
    inner: { nodeId: 'fa0', handleId: 'gnd' },
  })
  // Right ports: each bit's sum output, then the carry/borrow-out and V+.
  let right = 14
  for (let i = 0; i < bits; i++) {
    ports.push({
      id: `s${i}`,
      label: `S${i}`,
      side: 'right',
      offset: right,
      inner: { nodeId: `fa${i}`, handleId: 'sum' },
    })
    right += 18
  }
  ports.push({
    id: 'cout',
    label: 'Cout',
    side: 'right',
    offset: right,
    inner: { nodeId: `fa${bits - 1}`, handleId: 'cout' },
  })
  right += 18
  ports.push({
    id: 'v_dd',
    label: 'V+',
    side: 'right',
    offset: right,
    inner: { nodeId: 'fa0', handleId: 'v_dd' },
  })
  return { name: `${bits}-bit Calculator`, origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** A 4-bit calculator — a ripple-carry adder/subtractor; the SUB pin picks add (0) or subtract (1). */
export const CALCULATOR_4BIT: BlockData = addSubtractor(4)

/**
 * SEVEN-SEGMENT DISPLAY — a single alarm-clock-style digit. Seven LED segments (a–g) in the classic
 * figure-8, each behind a current-limiting resistor, all sharing a COMMON cathode. Drive a segment's
 * pin HIGH (with COMMON tied to ground) and that segment lights; the right combination spells a digit.
 * On the canvas it renders as the lit figure-8 (display: 'seven_segment'), but underneath it is
 * genuinely fourteen real parts — descend to see the seven LEDs and their resistors.
 */
const SEG_RESISTOR: Parameters = {
  ...defaultParameters('resistor'),
  resistance: scalar(330, 'ohm'),
}
const SEGMENT_IDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const

function sevenSegmentDisplay(): BlockData {
  // The shipped module IS a real bare seven-segment display (the `core` sub-block) plus one
  // current-limiting resistor per segment — descend to see exactly that. Each segment pin → its
  // resistor → the bare display's matching segment pin.
  const nodes: BlockData['nodes'] = [
    { id: 'core', definition: 'block', x: 280, y: 0, block: bareSevenSegment() },
  ]
  const edges: BlockData['edges'] = []
  const ports: BlockData['ports'] = []
  const leftSlot = { offset: 14 }
  const rightSlot = { offset: 14 }
  SEGMENT_IDS.forEach((seg, i) => {
    nodes.push({
      id: `r_${seg}`,
      definition: 'resistor',
      x: 0,
      y: i * 70,
      parameters: SEG_RESISTOR,
    })
    edges.push({
      id: `rl_${seg}`,
      source: `r_${seg}`,
      sourceHandle: 'terminal_b',
      target: 'core',
      targetHandle: `seg_${seg}`,
    })
    const onLeft = i < 4
    const slot = onLeft ? leftSlot : rightSlot
    ports.push({
      id: `seg_${seg}`,
      label: seg.toUpperCase(),
      side: onLeft ? 'left' : 'right',
      offset: slot.offset,
      inner: { nodeId: `r_${seg}`, handleId: 'terminal_a' },
    })
    slot.offset += 18
  })
  ports.push({
    id: 'common',
    label: 'GND',
    side: 'right',
    offset: rightSlot.offset,
    inner: { nodeId: 'core', handleId: 'common' },
  })
  return {
    name: '7-Seg',
    display: 'seven_segment',
    ledPath: 'core',
    origin: { x: 0, y: 0 },
    nodes,
    edges,
    ports,
  }
}

/** A single seven-segment digit — a real bare display behind seven current-limiting resistors. */
export const SEVEN_SEGMENT_DISPLAY: BlockData = sevenSegmentDisplay()

/** A tiny standalone display separator — a decimal-point LED + a thousands-comma LED on one common
 *  cathode, each behind a current-limiting resistor. It sits in its OWN small block between calculator
 *  digits (not crammed onto a digit); drive seg_dp / seg_comma high to light the point / comma. */
function displaySeparator(): BlockData {
  const nodes: BlockData['nodes'] = []
  const edges: BlockData['edges'] = []
  const ports: BlockData['ports'] = []
  const segs = ['dp', 'comma'] as const
  segs.forEach((seg, i) => {
    nodes.push({
      id: `led_${seg}`,
      definition: 'led',
      x: 40,
      y: i * 70,
      parameters: defaultParameters('led'),
    })
    nodes.push({
      id: `r_${seg}`,
      definition: 'resistor',
      x: 0,
      y: i * 70,
      parameters: SEG_RESISTOR,
    })
    edges.push({
      id: `rl_${seg}`,
      source: `r_${seg}`,
      sourceHandle: 'terminal_b',
      target: `led_${seg}`,
      targetHandle: 'anode',
    })
    if (i > 0)
      edges.push({
        id: `cc_${seg}`,
        source: 'led_dp',
        sourceHandle: 'cathode',
        target: `led_${seg}`,
        targetHandle: 'cathode',
      })
    ports.push({
      id: `seg_${seg}`,
      label: seg.toUpperCase(),
      side: 'left',
      offset: 14 + i * 18,
      inner: { nodeId: `r_${seg}`, handleId: 'terminal_a' },
    })
  })
  ports.push({
    id: 'common',
    label: 'GND',
    side: 'right',
    offset: 14,
    inner: { nodeId: 'led_dp', handleId: 'cathode' },
  })
  return {
    name: 'Separator',
    display: 'separator',
    size: { width: 36, height: 120 },
    origin: { x: 0, y: 0 },
    nodes,
    edges,
    ports,
  }
}

/** A tiny decimal-point + comma separator module, placed between calculator digits. */
export const DISPLAY_SEPARATOR: BlockData = displaySeparator()

/**
 * BARE SEVEN-SEGMENT DISPLAY — the REAL raw component, exactly like a seven-segment display you buy:
 * seven LED segments (a–g) in the figure-8 on a shared common cathode, with its diffuser look but NO
 * built-in resistors. You MUST add an external current-limiting resistor per segment — drive a segment
 * straight off 5 V and the LED over-currents and dies, just like the real part. The shipped
 * `display_seven_segment` is THIS plus the resistors (a safe drop-and-go module); this is the part that
 * sits underneath it. Each segment pin connects straight to its LED's anode.
 */
function bareSevenSegment(): BlockData {
  const nodes: BlockData['nodes'] = []
  const edges: BlockData['edges'] = []
  const ports: BlockData['ports'] = []
  const leftSlot = { offset: 14 }
  const rightSlot = { offset: 14 }
  SEGMENT_IDS.forEach((seg, i) => {
    nodes.push({
      id: `led_${seg}`,
      definition: 'led',
      x: 40,
      y: i * 70,
      parameters: defaultParameters('led'),
    })
    const prev = SEGMENT_IDS[i - 1]
    if (prev) {
      edges.push({
        id: `cc_${seg}`,
        source: `led_${prev}`,
        sourceHandle: 'cathode',
        target: `led_${seg}`,
        targetHandle: 'cathode',
      })
    }
    const onLeft = i < 4
    const slot = onLeft ? leftSlot : rightSlot
    ports.push({
      id: `seg_${seg}`,
      label: seg.toUpperCase(),
      side: onLeft ? 'left' : 'right',
      offset: slot.offset,
      inner: { nodeId: `led_${seg}`, handleId: 'anode' },
    })
    slot.offset += 18
  })
  ports.push({
    id: 'common',
    label: 'GND',
    side: 'right',
    offset: rightSlot.offset,
    inner: { nodeId: 'led_a', handleId: 'cathode' },
  })
  return {
    name: '7-Seg Bare',
    display: 'seven_segment',
    origin: { x: 0, y: 0 },
    nodes,
    edges,
    ports,
  }
}

/** The bare seven-segment display — seven real LEDs, common cathode, NO resistors (add them externally). */
export const SEVEN_SEGMENT_BARE: BlockData = bareSevenSegment()

/**
 * MULTI-DIGIT SEVEN-SEGMENT DISPLAY (parameterized) — `digitCount` figure-8 digits side by side, with a
 * decimal point AND a comma between each adjacent pair, so it reads a number like 1.5 or 1,5 (US point
 * / EU comma). It is REAL hardware exactly like a real seven-segment display: every segment, point, and
 * comma is a genuine LED behind its own current-limiting resistor (330 Ω, ~9 mA off 5 V), all sharing
 * ONE common cathode — the on-canvas face only READS each LED's solved lit-state, it does not fake it.
 * Drive a segment's pin HIGH (with COMMON to ground) to light it. Flattens to 7·N + 2·(N−1) real
 * LED+resistor legs; descend to see every one. Any digit count works — see DIGIT_DISPLAY_SIZES.
 */
export function multiDigitDisplay(digitCount: number, withResistors = true): BlockData {
  const nodes: BlockData['nodes'] = []
  const edges: BlockData['edges'] = []
  const ports: BlockData['ports'] = []

  // Each digit IS a real bare seven-segment display (its own seven LEDs + common cathode); the commons
  // chain onto one shared return. With resistors (the shipped module) a current-limiting resistor sits
  // between each segment pin and the bare digit; bare, the pin connects straight to it.
  for (let d = 0; d < digitCount; d++) {
    nodes.push({
      id: `digit${d}`,
      definition: 'block',
      x: d * 900,
      y: 0,
      block: bareSevenSegment(),
    })
    if (d > 0) {
      edges.push({
        id: `cc_d${d}`,
        source: `digit${d - 1}`,
        sourceHandle: 'common',
        target: `digit${d}`,
        targetHandle: 'common',
      })
    }
    SEGMENT_IDS.forEach((seg, i) => {
      const side = d % 2 === 0 ? 'top' : 'bottom'
      if (withResistors) {
        const rid = `r_d${d}_${seg}`
        nodes.push({
          id: rid,
          definition: 'resistor',
          x: d * 900 - 260,
          y: i * 70,
          parameters: SEG_RESISTOR,
        })
        edges.push({
          id: `rl_d${d}_${seg}`,
          source: rid,
          sourceHandle: 'terminal_b',
          target: `digit${d}`,
          targetHandle: `seg_${seg}`,
        })
        ports.push({
          id: `seg_d${d}_${seg}`,
          label: `${d}${seg.toUpperCase()}`,
          side,
          inner: { nodeId: rid, handleId: 'terminal_a' },
        })
      } else {
        ports.push({
          id: `seg_d${d}_${seg}`,
          label: `${d}${seg.toUpperCase()}`,
          side,
          inner: { nodeId: `digit${d}`, handleId: `seg_${seg}` },
        })
      }
    })
  }

  // A decimal point (left edge) + a comma (right edge) between each adjacent pair — each its own LED
  // (+ a resistor when shipped), cathode tied onto the shared common.
  const addSeparator = (
    ledId: string,
    portId: string,
    label: string,
    side: 'left' | 'right',
    x: number,
    y: number,
  ) => {
    nodes.push({ id: ledId, definition: 'led', x, y, parameters: defaultParameters('led') })
    edges.push({
      id: `cc_${ledId}`,
      source: ledId,
      sourceHandle: 'cathode',
      target: 'digit0',
      targetHandle: 'common',
    })
    if (withResistors) {
      const rid = `r_${ledId}`
      nodes.push({ id: rid, definition: 'resistor', x: x - 240, y, parameters: SEG_RESISTOR })
      edges.push({
        id: `rl_${ledId}`,
        source: rid,
        sourceHandle: 'terminal_b',
        target: ledId,
        targetHandle: 'anode',
      })
      ports.push({ id: portId, label, side, inner: { nodeId: rid, handleId: 'terminal_a' } })
    } else {
      ports.push({ id: portId, label, side, inner: { nodeId: ledId, handleId: 'anode' } })
    }
  }
  for (let s = 0; s < digitCount - 1; s++) {
    addSeparator(`led_dp_${s}`, `dp_${s}`, `.${s}`, 'left', 2400 + s * 200, 0)
    addSeparator(`led_comma_${s}`, `comma_${s}`, `,${s}`, 'right', 2400 + s * 200, 70)
  }

  ports.push({
    id: 'common',
    label: 'GND',
    side: 'right',
    inner: { nodeId: 'digit0', handleId: 'common' },
  })

  return {
    name: withResistors ? `${digitCount}-Digit` : `${digitCount}-Digit Bare`,
    display: 'seven_segment_multi',
    digits: digitCount,
    size: { width: digitCount * 110, height: 140 },
    origin: { x: 0, y: 0 },
    nodes,
    edges,
    ports,
  }
}

/**
 * Numeric display sizes shipped to the palette. EDIT THIS LIST to offer another size — any digit count
 * works, and the builder, the on-canvas face, AND the real LED+resistor hardware inside all scale with
 * it (a 6-digit version is genuinely 6×7 + 10 real LEDs, descend to verify).
 */
export const DIGIT_DISPLAY_SIZES = [3, 4, 6] as const

/** The three-digit readout (the calculator's default) — real LED+resistor legs behind three figure-8s. */
export const THREE_DIGIT_DISPLAY: BlockData = multiDigitDisplay(3)

/**
 * BINARY → SEVEN-SEGMENT DECODER (hex) — turns a 4-bit number (D0..D3) into the seven segment lines
 * (a..g) that spell that value 0–F: the chip inside a digital readout. Built as a 4-to-16 one-hot
 * decoder feeding an OR plane (a ROM/PLA in gates) — every input combination drives its own minterm
 * line, and each segment ORs the lines where it is lit. Correct by construction from the table below.
 * Real + complete (it flattens to gates, then transistors), but it IS ~100 gates, so a wired
 * calculator → decoder → display chain is a "press Solve" circuit, not a snappy live one.
 */
// Active-high segment patterns a,b,c,d,e,f,g for hex 0–F on a common-cathode display.
const HEX_7SEG = [
  '1111110',
  '0110000',
  '1101101',
  '1111001',
  '0110011',
  '1011011',
  '1011111',
  '1110000',
  '1111111',
  '1111011',
  '1110111',
  '0011111',
  '1001110',
  '0111101',
  '1001111',
  '1000111',
]

function binaryToSevenSegment(): BlockData {
  const nodes: BlockData['nodes'] = []
  const edges: BlockData['edges'] = []
  const netTerminals = new Map<string, { node: string; h: string }[]>()
  let gateN = 0
  let netN = 0
  let edgeN = 0
  const join = (net: string, node: string, h: string) => {
    const arr = netTerminals.get(net) ?? []
    arr.push({ node, h })
    netTerminals.set(net, arr)
  }
  const freshNet = () => `n${netN++}`
  // Place a 2-input gate, wire its rails to the shared V+/GND nets, return its (fresh) output net.
  const gate2 = (block: BlockData, netA: string, netB: string, x: number, y: number): string => {
    const id = `g${gateN++}`
    nodes.push({ id, definition: 'block', x, y, block })
    join(netA, id, 'a')
    join(netB, id, 'b')
    join('VDD', id, 'v_dd')
    join('GND', id, 'gnd')
    const out = freshNet()
    join(out, id, 'out')
    return out
  }
  const notGate = (netIn: string, x: number, y: number): string => {
    const id = `g${gateN++}`
    nodes.push({ id, definition: 'block', x, y, block: INVERTER_BLOCK })
    join(netIn, id, 'in')
    join('VDD', id, 'v_dd')
    join('GND', id, 'gnd')
    const out = freshNet()
    join(out, id, 'out')
    return out
  }
  const andAll = (ins: string[], x: number): string =>
    ins.reduce((acc, n, i) => gate2(AND_BLOCK, acc, n, x, i * 90))
  const orAll = (ins: string[], y: number): string =>
    ins.reduce((acc, n, i) => gate2(OR_BLOCK, acc, n, 1500 + i * 70, y))

  // Input nets D0..D3 and their inverters (so each minterm can AND the bit or its complement).
  const d = ['nD0', 'nD1', 'nD2', 'nD3']
  const dInv = d.map((n, i) => notGate(n, -240, i * 90))
  // 16 minterm lines: AND4 of the four inputs in the polarity that selects exactly that value.
  const minterm: string[] = []
  for (let v = 0; v < 16; v++) {
    const ins: string[] = []
    for (let i = 0; i < 4; i++) {
      const lit = d[i] ?? 'nD0'
      const inv = dInv[i] ?? lit
      ins.push(((v >> i) & 1) === 1 ? lit : inv)
    }
    minterm.push(andAll(ins, 120 + v * 80))
  }
  // 7 segment OR planes: each segment ORs the minterm lines where it is lit.
  const segNet: string[] = []
  for (let s = 0; s < 7; s++) {
    const on = minterm.filter((_, v) => (HEX_7SEG[v] ?? '').charAt(s) === '1')
    segNet.push(on.length > 0 ? orAll(on, s * 220) : freshNet())
  }

  // Emit one star of edges per net (terminal 0 → each other terminal makes them one node).
  for (const terms of netTerminals.values()) {
    const first = terms[0]
    if (!first) continue
    for (let i = 1; i < terms.length; i++) {
      const t = terms[i]
      if (t) {
        edges.push({
          id: `e${edgeN++}`,
          source: first.node,
          sourceHandle: first.h,
          target: t.node,
          targetHandle: t.h,
        })
      }
    }
  }

  const ports: BlockData['ports'] = []
  const innerOf = (net: string) => {
    const first = netTerminals.get(net)?.[0]
    return first ? { nodeId: first.node, handleId: first.h } : undefined
  }
  let lOff = 14
  for (let i = 0; i < 4; i++) {
    const inner = innerOf(`nD${i}`)
    if (inner) {
      ports.push({ id: `d${i}`, label: `D${i}`, side: 'left', offset: lOff, inner })
      lOff += 18
    }
  }
  const gndInner = innerOf('GND')
  if (gndInner) ports.push({ id: 'gnd', label: 'GND', side: 'left', offset: lOff, inner: gndInner })
  const segLabels = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
  let rOff = 14
  for (let s = 0; s < 7; s++) {
    const inner = innerOf(segNet[s] ?? '')
    if (inner) {
      ports.push({
        id: `seg_${segLabels[s]}`,
        label: (segLabels[s] ?? '').toUpperCase(),
        side: 'right',
        offset: rOff,
        drive: 'push_pull', // a CMOS segment driver — an OUTPUT that pushes the LED's anode to V+/0
        inner,
      })
      rOff += 18
    }
  }
  const vddInner = innerOf('VDD')
  if (vddInner)
    ports.push({ id: 'v_dd', label: 'V+', side: 'right', offset: rOff, inner: vddInner })

  return { name: 'Hex→7seg', origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** A binary→hex-seven-segment decoder — 4 bits in (D0..D3), 7 segment lines out (a..g). */
export const HEX_DECODER_7SEG: BlockData = binaryToSevenSegment()

/**
 * Brick ⑧ — the calculator's decoder bank: one hex→7-seg decoder per digit (0-9 read the same as hex
 * 0-9). Takes the 40-bit BCD result and turns it into 70 segment lines — seg_<a..g>_<0..9> — ready to
 * drive ten seven-segment displays. Digit d's four bits (d=0 is the ones place) feed decoder d; that
 * decoder's a..g lines become this bank's seg_*_d outputs. Pure logic; the logic→display hand-off lights
 * the real LEDs downstream.
 */
function bcdDecoderBank(digits: number): BlockData {
  const node = (
    id: string,
    block: BlockData,
    x: number,
    y: number,
  ): BlockData['nodes'][number] => ({
    id,
    definition: 'block',
    x,
    y,
    block,
  })
  const edge = (
    id: string,
    s: string,
    sh: string,
    t: string,
    th: string,
  ): BlockData['edges'][number] => ({
    id,
    source: s,
    sourceHandle: sh,
    target: t,
    targetHandle: th,
  })
  const nodes: BlockData['nodes'] = Array.from({ length: digits }, (_, d) =>
    node(`dec${d}`, HEX_DECODER_7SEG, d * 420, 30),
  )
  const edges: BlockData['edges'] = []
  for (let d = 1; d < digits; d++) {
    edges.push(edge(`vdd${d}`, 'dec0', 'v_dd', `dec${d}`, 'v_dd'))
    edges.push(edge(`gnd${d}`, 'dec0', 'gnd', `dec${d}`, 'gnd'))
  }
  const ports: BlockData['ports'] = []
  let left = 14
  for (let d = 0; d < digits; d++) {
    for (let i = 0; i < 4; i++) {
      ports.push({
        id: `d${d * 4 + i}`,
        label: `D${d}.${i}`,
        side: 'left',
        offset: left,
        inner: { nodeId: `dec${d}`, handleId: `d${i}` },
      })
      left += 18
    }
  }
  ports.push({
    id: 'gnd',
    label: 'GND',
    side: 'left',
    offset: left,
    inner: { nodeId: 'dec0', handleId: 'gnd' },
  })
  const segs = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
  let right = 14
  for (let d = 0; d < digits; d++) {
    for (const s of segs) {
      ports.push({
        id: `seg_${s}_${d}`,
        label: `${s.toUpperCase()}${d}`,
        side: 'right',
        offset: right,
        drive: 'push_pull', // CMOS segment-driver OUTPUT → drives the real LED display downstream
        inner: { nodeId: `dec${d}`, handleId: `seg_${s}` },
      })
      right += 18
    }
  }
  ports.push({
    id: 'v_dd',
    label: 'V+',
    side: 'right',
    offset: right,
    inner: { nodeId: 'dec0', handleId: 'v_dd' },
  })
  return { name: `${digits}-digit Decoder`, origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** The calculator's 10-digit display decoder: 40 BCD bits in, 70 segment lines out (seg_<a..g>_<0..9>). */
export const BCD_DECODER_10: BlockData = bcdDecoderBank(10)

/**
 * SR LATCH — the first SEQUENTIAL element, two cross-coupled NOR gates. Each gate's output
 * feeds the other's input, and that feedback is where a circuit stops being a pure function of
 * its inputs and starts REMEMBERING. S=1 sets Q high; R=1 resets it low; S=R=0 holds whatever
 * was last written -- one bit of memory. (S=R=1 is the disallowed state, both outputs low.)
 * Q = NOR(R, Qbar) and Qbar = NOR(S, Q); descend to see the two NORs. The hold/memory behaviour
 * only shows up over time, so it lives in the transient solver, not a single DC operating point.
 */
export const SR_LATCH_BLOCK: BlockData = {
  name: 'SR Latch',
  origin: { x: 0, y: 0 },
  nodes: [
    { id: 'nor_q', definition: 'block', x: 40, y: 30, block: NOR2_BLOCK },
    { id: 'nor_qbar', definition: 'block', x: 40, y: 280, block: NOR2_BLOCK },
  ],
  edges: [
    // cross-couple: Q feeds the other gate's input, Qbar feeds this one's
    { id: 'q_fb', source: 'nor_q', sourceHandle: 'out', target: 'nor_qbar', targetHandle: 'b' },
    { id: 'qbar_fb', source: 'nor_qbar', sourceHandle: 'out', target: 'nor_q', targetHandle: 'b' },
    // shared rails
    { id: 'vdd', source: 'nor_q', sourceHandle: 'v_dd', target: 'nor_qbar', targetHandle: 'v_dd' },
    { id: 'gnd', source: 'nor_q', sourceHandle: 'gnd', target: 'nor_qbar', targetHandle: 'gnd' },
  ],
  ports: [
    { id: 'r', label: 'R', side: 'left', offset: 14, inner: { nodeId: 'nor_q', handleId: 'a' } },
    { id: 's', label: 'S', side: 'left', offset: 36, inner: { nodeId: 'nor_qbar', handleId: 'a' } },
    {
      id: 'gnd',
      label: 'GND',
      side: 'left',
      offset: 58,
      inner: { nodeId: 'nor_q', handleId: 'gnd' },
    },
    { id: 'q', label: 'Q', side: 'right', offset: 14, inner: { nodeId: 'nor_q', handleId: 'out' } },
    {
      id: 'qbar',
      label: 'Qbar',
      side: 'right',
      offset: 36,
      inner: { nodeId: 'nor_qbar', handleId: 'out' },
    },
    {
      id: 'v_dd',
      label: 'V+',
      side: 'right',
      offset: 58,
      inner: { nodeId: 'nor_q', handleId: 'v_dd' },
    },
  ],
}

/**
 * GATED D LATCH — a controllable one-bit memory with NO forbidden state. Four NANDs: an SR latch
 * (the two cross-coupled NANDs nq/nqbar) fed by two input NANDs (n1/n2) gated by an ENABLE. D and
 * its complement become the latch's set/reset, so the inputs can never both assert -- the SR
 * latch's illegal case is gone. When ENABLE is HIGH the latch is transparent (Q follows D); when
 * ENABLE is LOW it HOLDS the last D. Level-sensitive: this is the building block the edge-
 * triggered D flip-flop is made of (two of these in a master-slave pair). Descend for the NANDs.
 */
export const D_LATCH_BLOCK: BlockData = {
  name: 'D Latch',
  origin: { x: 0, y: 0 },
  nodes: [
    { id: 'n1', definition: 'block', x: 40, y: 30, block: NAND2_BLOCK },
    { id: 'n2', definition: 'block', x: 40, y: 300, block: NAND2_BLOCK },
    { id: 'nq', definition: 'block', x: 360, y: 30, block: NAND2_BLOCK },
    { id: 'nqbar', definition: 'block', x: 360, y: 300, block: NAND2_BLOCK },
  ],
  edges: [
    // ENABLE reaches both input NANDs (n1 = NAND(D,E), n2 = NAND(n1,E))
    { id: 'e_share', source: 'n1', sourceHandle: 'b', target: 'n2', targetHandle: 'b' },
    { id: 'n1_n2', source: 'n1', sourceHandle: 'out', target: 'n2', targetHandle: 'a' },
    // n1 and n2 feed the cross-coupled SR-latch NANDs
    { id: 'n1_nq', source: 'n1', sourceHandle: 'out', target: 'nq', targetHandle: 'a' },
    { id: 'n2_nqbar', source: 'n2', sourceHandle: 'out', target: 'nqbar', targetHandle: 'a' },
    // the cross-couple: Q and Qbar feed back into the other NAND
    { id: 'q_fb', source: 'nq', sourceHandle: 'out', target: 'nqbar', targetHandle: 'b' },
    { id: 'qbar_fb', source: 'nqbar', sourceHandle: 'out', target: 'nq', targetHandle: 'b' },
    // shared rails
    { id: 'vdd1', source: 'n1', sourceHandle: 'v_dd', target: 'n2', targetHandle: 'v_dd' },
    { id: 'vdd2', source: 'n2', sourceHandle: 'v_dd', target: 'nq', targetHandle: 'v_dd' },
    { id: 'vdd3', source: 'nq', sourceHandle: 'v_dd', target: 'nqbar', targetHandle: 'v_dd' },
    { id: 'gnd1', source: 'n1', sourceHandle: 'gnd', target: 'n2', targetHandle: 'gnd' },
    { id: 'gnd2', source: 'n2', sourceHandle: 'gnd', target: 'nq', targetHandle: 'gnd' },
    { id: 'gnd3', source: 'nq', sourceHandle: 'gnd', target: 'nqbar', targetHandle: 'gnd' },
  ],
  ports: [
    { id: 'd', label: 'D', side: 'left', offset: 14, inner: { nodeId: 'n1', handleId: 'a' } },
    { id: 'e', label: 'E', side: 'left', offset: 36, inner: { nodeId: 'n1', handleId: 'b' } },
    {
      id: 'gnd',
      label: 'GND',
      side: 'left',
      offset: 58,
      inner: { nodeId: 'n1', handleId: 'gnd' },
    },
    { id: 'q', label: 'Q', side: 'right', offset: 14, inner: { nodeId: 'nq', handleId: 'out' } },
    {
      id: 'qbar',
      label: 'Qbar',
      side: 'right',
      offset: 36,
      inner: { nodeId: 'nqbar', handleId: 'out' },
    },
    {
      id: 'v_dd',
      label: 'V+',
      side: 'right',
      offset: 58,
      inner: { nodeId: 'n1', handleId: 'v_dd' },
    },
  ],
}

/**
 * D FLIP-FLOP (positive-edge-triggered) — captures D on the RISING clock edge and holds it until
 * the next edge: the workhorse storage element of every register and CPU. Master-slave: two D
 * latches with opposite enables (an inverter gives the master NOT-clock). While the clock is LOW
 * the master tracks D and the slave holds; on the rising edge the master freezes the D it saw and
 * the slave opens, copying that captured bit to Q. So Q changes ONLY at the edge -- it ignores D
 * the rest of the time, unlike the level-sensitive latch it is built from. Descend to see the two
 * latches and the inverter.
 */
export const D_FLIPFLOP_BLOCK: BlockData = {
  name: 'D Flip-Flop',
  origin: { x: 0, y: 0 },
  nodes: [
    { id: 'inv', definition: 'block', x: 40, y: 30, block: INVERTER_BLOCK },
    { id: 'master', definition: 'block', x: 320, y: 30, block: D_LATCH_BLOCK },
    { id: 'slave', definition: 'block', x: 760, y: 30, block: D_LATCH_BLOCK },
  ],
  edges: [
    // the clock drives the inverter and the slave's enable; NOT-clock enables the master
    { id: 'clk_slave', source: 'inv', sourceHandle: 'in', target: 'slave', targetHandle: 'e' },
    { id: 'notclk', source: 'inv', sourceHandle: 'out', target: 'master', targetHandle: 'e' },
    // the master's output is the slave's data input
    { id: 'm_to_s', source: 'master', sourceHandle: 'q', target: 'slave', targetHandle: 'd' },
    // shared rails
    { id: 'vdd1', source: 'inv', sourceHandle: 'v_dd', target: 'master', targetHandle: 'v_dd' },
    { id: 'vdd2', source: 'master', sourceHandle: 'v_dd', target: 'slave', targetHandle: 'v_dd' },
    { id: 'gnd1', source: 'inv', sourceHandle: 'gnd', target: 'master', targetHandle: 'gnd' },
    { id: 'gnd2', source: 'master', sourceHandle: 'gnd', target: 'slave', targetHandle: 'gnd' },
  ],
  ports: [
    { id: 'd', label: 'D', side: 'left', offset: 14, inner: { nodeId: 'master', handleId: 'd' } },
    { id: 'clk', label: 'CLK', side: 'left', offset: 36, inner: { nodeId: 'inv', handleId: 'in' } },
    {
      id: 'gnd',
      label: 'GND',
      side: 'left',
      offset: 58,
      inner: { nodeId: 'inv', handleId: 'gnd' },
    },
    { id: 'q', label: 'Q', side: 'right', offset: 14, inner: { nodeId: 'slave', handleId: 'q' } },
    {
      id: 'qbar',
      label: 'Qbar',
      side: 'right',
      offset: 36,
      inner: { nodeId: 'slave', handleId: 'qbar' },
    },
    {
      id: 'v_dd',
      label: 'V+',
      side: 'right',
      offset: 58,
      inner: { nodeId: 'inv', handleId: 'v_dd' },
    },
  ],
}

/**
 * N-BIT REGISTER — N D flip-flops sharing ONE clock. On the rising clock edge every bit latches
 * its D input at once, so the register stores a whole word in a single tick and holds it until the
 * next edge. This is the storage a CPU's datapath is built from. Inputs D0..D(N-1), one CLK, a
 * shared V+/GND; outputs Q0..Q(N-1). Descend to see the flip-flops; an N-bit register is about
 * 34·N MOSFETs. Like any bistable circuit it needs an initial-condition power-up to simulate over
 * time (the transient solver's .ic) -- its latches have no defined DC state otherwise.
 */
function dRegister(bits: number): BlockData {
  const nodes: BlockData['nodes'] = []
  const edges: BlockData['edges'] = []
  const ports: BlockData['ports'] = []
  for (let i = 0; i < bits; i++) {
    nodes.push({
      id: `ff${i}`,
      definition: 'block',
      x: 40,
      y: 30 + i * 220,
      block: D_FLIPFLOP_BLOCK,
    })
    if (i > 0) {
      const prev = `ff${i - 1}`
      const here = `ff${i}`
      // one clock and one V+/GND fan out across every flip-flop
      edges.push({
        id: `clk${i}`,
        source: prev,
        sourceHandle: 'clk',
        target: here,
        targetHandle: 'clk',
      })
      edges.push({
        id: `vdd${i}`,
        source: prev,
        sourceHandle: 'v_dd',
        target: here,
        targetHandle: 'v_dd',
      })
      edges.push({
        id: `gnd${i}`,
        source: prev,
        sourceHandle: 'gnd',
        target: here,
        targetHandle: 'gnd',
      })
    }
  }
  let left = 14
  for (let i = 0; i < bits; i++) {
    ports.push({
      id: `d${i}`,
      label: `D${i}`,
      side: 'left',
      offset: left,
      inner: { nodeId: `ff${i}`, handleId: 'd' },
    })
    left += 18
  }
  ports.push({
    id: 'clk',
    label: 'CLK',
    side: 'left',
    offset: left,
    inner: { nodeId: 'ff0', handleId: 'clk' },
  })
  left += 18
  ports.push({
    id: 'gnd',
    label: 'GND',
    side: 'left',
    offset: left,
    inner: { nodeId: 'ff0', handleId: 'gnd' },
  })
  let right = 14
  for (let i = 0; i < bits; i++) {
    ports.push({
      id: `q${i}`,
      label: `Q${i}`,
      side: 'right',
      offset: right,
      inner: { nodeId: `ff${i}`, handleId: 'q' },
    })
    right += 18
  }
  ports.push({
    id: 'v_dd',
    label: 'V+',
    side: 'right',
    offset: right,
    inner: { nodeId: 'ff0', handleId: 'v_dd' },
  })
  return { name: `${bits}-bit Register`, origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** A 4-bit register — four flip-flops latching a nibble on one clock edge. */
export const REGISTER_4BIT: BlockData = dRegister(4)

/** A 10-digit BCD register — 40 D flip-flops (4 bits × 10 decimal digits): the calculator's accumulator /
 *  entry store, latching a whole 10-digit number on one clock edge. ~1360 MOSFETs; descend for the
 *  flip-flops. The control unit (CALC_CONTROL_FSM) sequences loads into this; bit b carries digit
 *  floor(b/4)'s weight 2^(b%4), matching the flat BCD port order the ALU and decoders use. */
export const BCD_REGISTER_10: BlockData = { ...dRegister(40), name: 'BCD Register (10-digit)' }

// --- Stage 2 control-unit sub-blocks — the real gate building blocks the calculator's datapath + FSM
// need, each composed from the existing AND/OR/NOT/NAND/D-flip-flop gates and verified by its own test. ---

/** Chain V+ and GND across a list of sub-block ids so they share one supply — the standard gate-network
 *  rail wiring. Returns the rail edges (v_dd↔v_dd, gnd↔gnd between neighbours). */
function chainRails(ids: string[], prefix: string): BlockData['edges'] {
  const edges: BlockData['edges'] = []
  for (let i = 1; i < ids.length; i++) {
    const prev = ids[i - 1]
    const here = ids[i]
    if (prev === undefined || here === undefined) continue
    edges.push({
      id: `${prefix}_vdd${i}`,
      source: prev,
      sourceHandle: 'v_dd',
      target: here,
      targetHandle: 'v_dd',
    })
    edges.push({
      id: `${prefix}_gnd${i}`,
      source: prev,
      sourceHandle: 'gnd',
      target: here,
      targetHandle: 'gnd',
    })
  }
  return edges
}

/**
 * 2:1 MUX (one bit) — OUT = SEL ? X : Y, the select element a datapath uses to choose which value flows
 * on. Real gates: OUT = (X AND SEL) OR (Y AND NOT SEL). Descend for the AND/OR/NOT.
 */
export const MUX2_1BIT: BlockData = {
  name: '2:1 Mux',
  origin: { x: 0, y: 0 },
  nodes: [
    { id: 'inv', definition: 'block', x: 40, y: 30, block: INVERTER_BLOCK },
    { id: 'ax', definition: 'block', x: 280, y: 30, block: AND_BLOCK },
    { id: 'ay', definition: 'block', x: 280, y: 260, block: AND_BLOCK },
    { id: 'oo', definition: 'block', x: 540, y: 150, block: OR_BLOCK },
  ],
  edges: [
    { id: 'sel_ax', source: 'inv', sourceHandle: 'in', target: 'ax', targetHandle: 'b' }, // SEL also gates X
    { id: 'nsel_ay', source: 'inv', sourceHandle: 'out', target: 'ay', targetHandle: 'b' }, // NOT SEL gates Y
    { id: 'ax_or', source: 'ax', sourceHandle: 'out', target: 'oo', targetHandle: 'a' },
    { id: 'ay_or', source: 'ay', sourceHandle: 'out', target: 'oo', targetHandle: 'b' },
    ...chainRails(['inv', 'ax', 'ay', 'oo'], 'mux'),
  ],
  ports: [
    { id: 'x', label: 'X', side: 'left', offset: 14, inner: { nodeId: 'ax', handleId: 'a' } },
    { id: 'y', label: 'Y', side: 'left', offset: 36, inner: { nodeId: 'ay', handleId: 'a' } },
    { id: 'sel', label: 'SEL', side: 'left', offset: 58, inner: { nodeId: 'inv', handleId: 'in' } },
    {
      id: 'gnd',
      label: 'GND',
      side: 'left',
      offset: 80,
      inner: { nodeId: 'inv', handleId: 'gnd' },
    },
    {
      id: 'out',
      label: 'OUT',
      side: 'right',
      offset: 14,
      inner: { nodeId: 'oo', handleId: 'out' },
    },
    {
      id: 'v_dd',
      label: 'V+',
      side: 'right',
      offset: 36,
      inner: { nodeId: 'inv', handleId: 'v_dd' },
    },
  ],
}

/** N-bit 2:1 bus mux — picks bus X or bus Y onto OUT under one shared SEL: the datapath's value-router
 *  (e.g. load the ENTRY register from the keypad shift OR clear it; show ACC vs ENTRY on the display). */
function busMux(bits: number): BlockData {
  const nodes: BlockData['nodes'] = []
  const edges: BlockData['edges'] = []
  const ports: BlockData['ports'] = []
  for (let i = 0; i < bits; i++) {
    nodes.push({ id: `m${i}`, definition: 'block', x: 40, y: 30 + i * 220, block: MUX2_1BIT })
  }
  for (let i = 1; i < bits; i++) {
    edges.push({
      id: `sel${i}`,
      source: 'm0',
      sourceHandle: 'sel',
      target: `m${i}`,
      targetHandle: 'sel',
    })
    edges.push({
      id: `vdd${i}`,
      source: 'm0',
      sourceHandle: 'v_dd',
      target: `m${i}`,
      targetHandle: 'v_dd',
    })
    edges.push({
      id: `gnd${i}`,
      source: 'm0',
      sourceHandle: 'gnd',
      target: `m${i}`,
      targetHandle: 'gnd',
    })
  }
  let left = 14
  for (let i = 0; i < bits; i++) {
    ports.push({
      id: `x${i}`,
      label: `X${i}`,
      side: 'left',
      offset: left,
      inner: { nodeId: `m${i}`, handleId: 'x' },
    })
    left += 16
  }
  for (let i = 0; i < bits; i++) {
    ports.push({
      id: `y${i}`,
      label: `Y${i}`,
      side: 'left',
      offset: left,
      inner: { nodeId: `m${i}`, handleId: 'y' },
    })
    left += 16
  }
  ports.push({
    id: 'sel',
    label: 'SEL',
    side: 'left',
    offset: left,
    inner: { nodeId: 'm0', handleId: 'sel' },
  })
  left += 16
  ports.push({
    id: 'gnd',
    label: 'GND',
    side: 'left',
    offset: left,
    inner: { nodeId: 'm0', handleId: 'gnd' },
  })
  let right = 14
  for (let i = 0; i < bits; i++) {
    ports.push({
      id: `out${i}`,
      label: `O${i}`,
      side: 'right',
      offset: right,
      inner: { nodeId: `m${i}`, handleId: 'out' },
    })
    right += 16
  }
  ports.push({
    id: 'v_dd',
    label: 'V+',
    side: 'right',
    offset: right,
    inner: { nodeId: 'm0', handleId: 'v_dd' },
  })
  return { name: `${bits}-bit 2:1 Mux`, origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** A 4-bit 2:1 bus mux (one BCD digit wide) — the reusable datapath router. */
export const BUS_MUX_4: BlockData = busMux(4)

/**
 * EDGE DETECT (rising-edge one-shot) — PULSE = IN AND NOT(IN one clock ago). A D flip-flop samples IN on
 * each clock; ANDing "IN now" with "NOT IN last clock" stays HIGH for exactly one clock after IN rises,
 * so a HELD key fires the control unit ONCE, not continuously. Descend for the flip-flop / NOT / AND.
 */
export const EDGE_DETECT_BLOCK: BlockData = {
  name: 'Edge Detect',
  origin: { x: 0, y: 0 },
  nodes: [
    { id: 'ff', definition: 'block', x: 40, y: 30, block: D_FLIPFLOP_BLOCK },
    { id: 'inv', definition: 'block', x: 420, y: 30, block: INVERTER_BLOCK },
    { id: 'and', definition: 'block', x: 640, y: 30, block: AND_BLOCK },
  ],
  edges: [
    { id: 'in_and', source: 'ff', sourceHandle: 'd', target: 'and', targetHandle: 'a' }, // IN also feeds the AND
    { id: 'q_inv', source: 'ff', sourceHandle: 'q', target: 'inv', targetHandle: 'in' }, // last sample → NOT
    { id: 'ninv_and', source: 'inv', sourceHandle: 'out', target: 'and', targetHandle: 'b' }, // NOT(last) → AND
    ...chainRails(['ff', 'inv', 'and'], 'ed'),
  ],
  ports: [
    { id: 'in', label: 'IN', side: 'left', offset: 14, inner: { nodeId: 'ff', handleId: 'd' } },
    { id: 'clk', label: 'CLK', side: 'left', offset: 36, inner: { nodeId: 'ff', handleId: 'clk' } },
    { id: 'gnd', label: 'GND', side: 'left', offset: 58, inner: { nodeId: 'ff', handleId: 'gnd' } },
    {
      id: 'pulse',
      label: 'PULSE',
      side: 'right',
      offset: 14,
      inner: { nodeId: 'and', handleId: 'out' },
    },
    {
      id: 'v_dd',
      label: 'V+',
      side: 'right',
      offset: 36,
      inner: { nodeId: 'ff', handleId: 'v_dd' },
    },
  ],
}

/** OR-reduce a list of input refs into one output via a chain of 2-input OR gates. Returns the gate
 *  nodes, the wiring edges, the gate ids (for rail-chaining), and the final output ref. Needs ≥1 input. */
function orReduce(
  ins: { node: string; handle: string }[],
  prefix: string,
  x: number,
): {
  nodes: BlockData['nodes']
  edges: BlockData['edges']
  ids: string[]
  out: { node: string; handle: string }
} {
  const nodes: BlockData['nodes'] = []
  const edges: BlockData['edges'] = []
  const ids: string[] = []
  let acc = ins[0]
  if (acc === undefined) throw new Error('orReduce needs at least one input')
  for (let i = 1; i < ins.length; i++) {
    const inp = ins[i]
    if (inp === undefined) continue
    const id = `${prefix}_or${i}`
    nodes.push({ id, definition: 'block', x, y: 30 + i * 160, block: OR_BLOCK })
    ids.push(id)
    edges.push({
      id: `${prefix}_a${i}`,
      source: acc.node,
      sourceHandle: acc.handle,
      target: id,
      targetHandle: 'a',
    })
    edges.push({
      id: `${prefix}_b${i}`,
      source: inp.node,
      sourceHandle: inp.handle,
      target: id,
      targetHandle: 'b',
    })
    acc = { node: id, handle: 'out' }
  }
  return { nodes, edges, ids, out: acc }
}

/** AND-reduce a list of input refs into one output via a chain of 2-input AND gates. The dual of
 *  orReduce: returns the gate nodes, wiring edges, gate ids (for rail-chaining), and the final
 *  output ref. With a single input it returns that input unchanged (no gate). */
function andReduce(
  ins: { node: string; handle: string }[],
  prefix: string,
  x: number,
): {
  nodes: BlockData['nodes']
  edges: BlockData['edges']
  ids: string[]
  out: { node: string; handle: string }
} {
  const nodes: BlockData['nodes'] = []
  const edges: BlockData['edges'] = []
  const ids: string[] = []
  let acc = ins[0]
  if (acc === undefined) throw new Error('andReduce needs at least one input')
  for (let i = 1; i < ins.length; i++) {
    const inp = ins[i]
    if (inp === undefined) continue
    const id = `${prefix}_and${i}`
    nodes.push({ id, definition: 'block', x, y: 30 + i * 160, block: AND_BLOCK })
    ids.push(id)
    edges.push({
      id: `${prefix}_a${i}`,
      source: acc.node,
      sourceHandle: acc.handle,
      target: id,
      targetHandle: 'a',
    })
    edges.push({
      id: `${prefix}_b${i}`,
      source: inp.node,
      sourceHandle: inp.handle,
      target: id,
      targetHandle: 'b',
    })
    acc = { node: id, handle: 'out' }
  }
  return { nodes, edges, ids, out: acc }
}

/**
 * BINARY DECODER (n → 2ⁿ, one-hot) — the address decoder every memory and every mux front-end runs
 * on: n binary inputs select exactly ONE of 2ⁿ outputs high, the rest low. Built the textbook way,
 * from real gates: each input feeds an inverter so both the bit and its complement are available,
 * then output Yv is the AND of the n literals (A_i where bit i of v is 1, ¬A_i where it is 0) — the
 * minterm that is true for exactly the input value v. Descend for the ANDs and inverters, descend
 * again for the transistors. Purely combinational, so the fast logic engine evaluates it as 0/1.
 */
function binaryDecoder(bits: number): BlockData {
  const nodes: BlockData['nodes'] = []
  const edges: BlockData['edges'] = []
  const ports: BlockData['ports'] = []
  const railIds: string[] = []
  // One inverter per input: inv_i.in carries A_i (the true literal net + the input port), inv_i.out
  // carries ¬A_i. Both are referenced as minterm literals below.
  for (let i = 0; i < bits; i++) {
    nodes.push({
      id: `inv${i}`,
      definition: 'block',
      x: 40,
      y: 30 + i * 150,
      block: INVERTER_BLOCK,
    })
    railIds.push(`inv${i}`)
  }
  const literal = (i: number, high: boolean) => ({
    node: `inv${i}`,
    handle: high ? 'in' : 'out',
  })
  const outputs = 1 << bits
  const outRefs: { node: string; handle: string }[] = []
  for (let v = 0; v < outputs; v++) {
    const lits = Array.from({ length: bits }, (_, i) => literal(i, ((v >> i) & 1) === 1))
    const tree = andReduce(lits, `d${v}`, 300 + v * 220)
    nodes.push(...tree.nodes)
    edges.push(...tree.edges)
    railIds.push(...tree.ids)
    outRefs.push(tree.out)
  }
  edges.push(...chainRails(railIds, 'dec'))
  let left = 14
  for (let i = 0; i < bits; i++) {
    ports.push({
      id: `a${i}`,
      label: `A${i}`,
      side: 'left',
      offset: left,
      inner: { nodeId: `inv${i}`, handleId: 'in' },
    })
    left += 18
  }
  ports.push({
    id: 'gnd',
    label: 'GND',
    side: 'left',
    offset: left,
    inner: { nodeId: 'inv0', handleId: 'gnd' },
  })
  let right = 14
  for (let v = 0; v < outputs; v++) {
    const ref = outRefs[v]
    if (ref === undefined) continue
    ports.push({
      id: `y${v}`,
      label: `Y${v}`,
      side: 'right',
      offset: right,
      inner: { nodeId: ref.node, handleId: ref.handle },
    })
    right += 16
  }
  ports.push({
    id: 'v_dd',
    label: 'V+',
    side: 'right',
    offset: right,
    inner: { nodeId: 'inv0', handleId: 'v_dd' },
  })
  return { name: `${bits}-to-${outputs} Decoder`, origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** A 2-to-4 one-hot binary decoder — the smallest, and the one whose whole truth table fits in view. */
export const BINARY_DECODER_2_4: BlockData = binaryDecoder(2)
/** A 3-to-8 one-hot binary decoder — the 74138-class address decoder, built from real gates. */
export const BINARY_DECODER_3_8: BlockData = binaryDecoder(3)

/**
 * PRIORITY ENCODER (2ⁿ → n) — the inverse of the decoder, and the one every interrupt controller
 * uses: it reports the binary INDEX of the highest-numbered active input, and a valid line (GS)
 * that says any input is active at all (so index 0 active is told apart from nothing active). A
 * plain encoder would garble when two inputs are high; this resolves them by PRIORITY. Real gate
 * logic: a suffix-OR chain computes "is any HIGHER input active" for each position; input j WINS
 * only if it is high AND no higher input is (I_j AND ¬higher_j); each output bit A_k ORs the wins
 * of the inputs whose index has bit k set. Descend for the OR/AND/NOT gates. Combinational → fast
 * logic engine. (With a strictly one-hot input it reduces to a plain binary encoder.)
 */
function priorityEncoder(inputs: number): BlockData {
  const outBits = Math.round(Math.log2(inputs))
  const nodes: BlockData['nodes'] = []
  const edges: BlockData['edges'] = []
  const ports: BlockData['ports'] = []
  const railIds: string[] = []
  // The input net refs: input j is anchored at its suffix-OR gate's 'a' input (for j < top), and
  // the top input at the top suffix-OR gate's 'b' input — every input reaches exactly one gate
  // pin, then fans out by edges from that pin.
  const top = inputs - 1
  const inRef: { node: string; handle: string }[] = []
  for (let j = 0; j < top; j++) inRef.push({ node: `so${j}`, handle: 'a' })
  inRef.push({ node: `so${top - 1}`, handle: 'b' }) // the top input rides the top OR gate's b input

  // Suffix-OR chain: soRef[j] = OR(I_j .. I_top). soRef[top] IS the top input's net; for j < top a
  // real OR gate so${j} = OR(I_j, soRef[j+1]).
  const soRef: { node: string; handle: string }[] = new Array(inputs)
  soRef[top] = inRef[top] as { node: string; handle: string }
  for (let j = top - 1; j >= 0; j--) {
    nodes.push({ id: `so${j}`, definition: 'block', x: 300, y: 30 + j * 150, block: OR_BLOCK })
    railIds.push(`so${j}`)
    // input a = I_j (its port anchor); input b = soRef[j+1]
    const b = soRef[j + 1] as { node: string; handle: string }
    edges.push({
      id: `so${j}_b`,
      source: b.node,
      sourceHandle: b.handle,
      target: `so${j}`,
      targetHandle: 'b',
    })
    soRef[j] = { node: `so${j}`, handle: 'out' }
  }

  // wins_j = I_j AND ¬higher_j, where higher_j = soRef[j+1]. The top input wins outright.
  const winRef: { node: string; handle: string }[] = new Array(inputs)
  winRef[top] = inRef[top] as { node: string; handle: string }
  for (let j = 0; j < top; j++) {
    nodes.push({
      id: `ninv${j}`,
      definition: 'block',
      x: 560,
      y: 30 + j * 150,
      block: INVERTER_BLOCK,
    })
    nodes.push({ id: `w${j}`, definition: 'block', x: 780, y: 30 + j * 150, block: AND_BLOCK })
    railIds.push(`ninv${j}`, `w${j}`)
    const higher = soRef[j + 1] as { node: string; handle: string }
    edges.push({
      id: `higher${j}`,
      source: higher.node,
      sourceHandle: higher.handle,
      target: `ninv${j}`,
      targetHandle: 'in',
    })
    // AND input a = I_j (fanned from its suffix-OR 'a' pin), input b = ¬higher_j
    const ij = inRef[j] as { node: string; handle: string }
    edges.push({
      id: `w${j}_a`,
      source: ij.node,
      sourceHandle: ij.handle,
      target: `w${j}`,
      targetHandle: 'a',
    })
    edges.push({
      id: `w${j}_b`,
      source: `ninv${j}`,
      sourceHandle: 'out',
      target: `w${j}`,
      targetHandle: 'b',
    })
    winRef[j] = { node: `w${j}`, handle: 'out' }
  }

  // A_k = OR of the wins whose input index has bit k set.
  const outRefs: { node: string; handle: string }[] = []
  for (let k = 0; k < outBits; k++) {
    const terms: { node: string; handle: string }[] = []
    for (let j = 0; j < inputs; j++)
      if (((j >> k) & 1) === 1) terms.push(winRef[j] as { node: string; handle: string })
    const red = orReduce(terms, `a${k}`, 1040 + k * 240)
    nodes.push(...red.nodes)
    edges.push(...red.edges)
    railIds.push(...red.ids)
    outRefs.push(red.out)
  }
  edges.push(...chainRails(railIds, 'enc'))

  let left = 14
  for (let j = 0; j < inputs; j++) {
    const ref = inRef[j] as { node: string; handle: string }
    ports.push({
      id: `i${j}`,
      label: `I${j}`,
      side: 'left',
      offset: left,
      inner: { nodeId: ref.node, handleId: ref.handle },
    })
    left += 16
  }
  ports.push({
    id: 'gnd',
    label: 'GND',
    side: 'left',
    offset: left,
    inner: { nodeId: `so${top - 1}`, handleId: 'gnd' },
  })
  let right = 14
  for (let k = 0; k < outBits; k++) {
    const ref = outRefs[k] as { node: string; handle: string }
    ports.push({
      id: `a${k}`,
      label: `A${k}`,
      side: 'right',
      offset: right,
      inner: { nodeId: ref.node, handleId: ref.handle },
    })
    right += 18
  }
  // GS (valid / group-select): any input active = the whole suffix-OR, soRef[0].
  const gs = soRef[0] as { node: string; handle: string }
  ports.push({
    id: 'gs',
    label: 'GS',
    side: 'right',
    offset: right,
    inner: { nodeId: gs.node, handleId: gs.handle },
  })
  right += 18
  ports.push({
    id: 'v_dd',
    label: 'V+',
    side: 'right',
    offset: right,
    inner: { nodeId: `so${top - 1}`, handleId: 'v_dd' },
  })
  return {
    name: `${inputs}-to-${outBits} Priority Encoder`,
    origin: { x: 0, y: 0 },
    nodes,
    edges,
    ports,
  }
}

/** A 4-to-2 priority encoder — the inverse of the 2-to-4 decoder, with a valid (GS) line. */
export const PRIORITY_ENCODER_4_2: BlockData = priorityEncoder(4)
/** An 8-to-3 priority encoder — the 74148-class part, built from real gates. */
export const PRIORITY_ENCODER_8_3: BlockData = priorityEncoder(8)

/**
 * KEYPAD ENCODER — turns the one-hot keypad (17 key lines) into the compact binary the control unit reads:
 * the pressed DIGIT as 4-bit BCD (D0..D3) via an OR-plane, a DIGIT line ("some digit was pressed"), the
 * pressed operator as a 2-bit code (OP0/OP1: +=00, −=01, ×=10, ÷=11) with an IS_OP line, and the EQUALS /
 * CLEAR / ± class lines. Each input is buffered, then ORed into its output bits. Descend for the gates.
 */
function buildKeypadEncoder(): BlockData {
  const nodes: BlockData['nodes'] = []
  const edges: BlockData['edges'] = []
  const ports: BlockData['ports'] = []
  const railIds: string[] = []
  const keys = [
    'k0',
    'k1',
    'k2',
    'k3',
    'k4',
    'k5',
    'k6',
    'k7',
    'k8',
    'k9',
    'kadd',
    'ksub',
    'kmul',
    'kdiv',
    'keq',
    'kclr',
    'kpm',
    'kdot',
  ]
  keys.forEach((k, i) => {
    nodes.push({ id: `b_${k}`, definition: 'block', x: 0, y: 30 + i * 160, block: BUFFER_BLOCK })
    railIds.push(`b_${k}`)
  })
  const bufOut = (k: string) => ({ node: `b_${k}`, handle: 'out' })
  const planes: { name: string; ins: string[] }[] = [
    { name: 'd0', ins: ['k1', 'k3', 'k5', 'k7', 'k9'] }, // bit 0 set on odd digits
    { name: 'd1', ins: ['k2', 'k3', 'k6', 'k7'] },
    { name: 'd2', ins: ['k4', 'k5', 'k6', 'k7'] },
    { name: 'd3', ins: ['k8', 'k9'] },
    { name: 'digit', ins: ['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8', 'k9'] },
    { name: 'op0', ins: ['ksub', 'kdiv'] }, // op-code bit 0
    { name: 'op1', ins: ['kmul', 'kdiv'] }, // op-code bit 1
    { name: 'is_op', ins: ['kadd', 'ksub', 'kmul', 'kdiv'] },
  ]
  const outRef: Record<string, { node: string; handle: string }> = {}
  let col = 400
  for (const p of planes) {
    const t = orReduce(p.ins.map(bufOut), `t_${p.name}`, col)
    nodes.push(...t.nodes)
    edges.push(...t.edges)
    railIds.push(...t.ids)
    outRef[p.name] = t.out
    col += 280
  }
  // EQUALS / CLEAR / ± pass straight through their buffers (no OR needed)
  outRef.is_eq = bufOut('keq')
  outRef.is_clr = bufOut('kclr')
  outRef.is_pm = bufOut('kpm')
  // The decimal point is its own class line — it touches NO digit/op plane, so it never enters a
  // number or starts arithmetic; it only tells the entry register to switch to fractional placement.
  outRef.is_dot = bufOut('kdot')
  edges.push(...chainRails(railIds, 'enc'))
  let left = 14
  for (const k of keys) {
    ports.push({
      id: k,
      label: k.toUpperCase(),
      side: 'left',
      offset: left,
      inner: { nodeId: `b_${k}`, handleId: 'in' },
    })
    left += 12
  }
  ports.push({
    id: 'gnd',
    label: 'GND',
    side: 'left',
    offset: left,
    inner: { nodeId: 'b_k0', handleId: 'gnd' },
  })
  const outs = [
    'd0',
    'd1',
    'd2',
    'd3',
    'digit',
    'op0',
    'op1',
    'is_op',
    'is_eq',
    'is_clr',
    'is_pm',
    'is_dot',
  ]
  let right = 14
  for (const o of outs) {
    const ref = outRef[o]
    if (ref === undefined) continue
    ports.push({
      id: o,
      label: o.toUpperCase(),
      side: 'right',
      offset: right,
      inner: { nodeId: ref.node, handleId: ref.handle },
    })
    right += 12
  }
  ports.push({
    id: 'v_dd',
    label: 'V+',
    side: 'right',
    offset: right,
    inner: { nodeId: 'b_k0', handleId: 'v_dd' },
  })
  return { name: 'Keypad Encoder', origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** The keypad encoder (one-hot 17 keys → BCD digit + op code + class lines). */
export const KEYPAD_ENCODER_BLOCK: BlockData = buildKeypadEncoder()

/**
 * LOADABLE DOWN-COUNTER — the ×/÷ micro-sequencer's loop counter. On a clock with LOAD high it latches
 * the value on L0..L; with LOAD low it counts DOWN by one (a real ripple decrementer: bit 0 always flips,
 * higher bits flip when every lower bit was already 0). TC ("terminal count") goes high at zero, so the
 * control unit knows the loop is done. Built from flip-flops + a decrementer (NOT/XOR/AND) + load-muxes +
 * a NOR zero-detector. Descend for the gates.
 */
function buildDownCounter(bits: number, withEnable = false, countUp = false): BlockData {
  const nodes: BlockData['nodes'] = []
  const edges: BlockData['edges'] = []
  const ports: BlockData['ports'] = []
  const rail: string[] = []
  for (let i = 0; i < bits; i++) {
    nodes.push({
      id: `ff${i}`,
      definition: 'block',
      x: 1200,
      y: 30 + i * 400,
      block: D_FLIPFLOP_BLOCK,
    })
    rail.push(`ff${i}`)
  }
  // ±1 unit: new0 = NOT q0 (toggle bit 0) for both. The carry/borrow into bit 1+ is q_i for an UP-counter
  // (count+1) or NOT q_i for a DOWN-counter (count−1); new_i = q_i XOR carry; carry_i = (q_i or NOT q_i) AND carry.
  nodes.push({ id: 'd_inv0', definition: 'block', x: 200, y: 30, block: INVERTER_BLOCK })
  rail.push('d_inv0')
  edges.push({
    id: 'q0_inv0',
    source: 'ff0',
    sourceHandle: 'q',
    target: 'd_inv0',
    targetHandle: 'in',
  })
  const newRef: { node: string; handle: string }[] = [{ node: 'd_inv0', handle: 'out' }]
  let borrow = countUp ? { node: 'ff0', handle: 'q' } : { node: 'd_inv0', handle: 'out' }
  for (let i = 1; i < bits; i++) {
    nodes.push({ id: `d_x${i}`, definition: 'block', x: 200, y: 30 + i * 400, block: XOR_BLOCK })
    rail.push(`d_x${i}`)
    edges.push({
      id: `q${i}_x`,
      source: `ff${i}`,
      sourceHandle: 'q',
      target: `d_x${i}`,
      targetHandle: 'a',
    })
    edges.push({
      id: `bor${i}_x`,
      source: borrow.node,
      sourceHandle: borrow.handle,
      target: `d_x${i}`,
      targetHandle: 'b',
    })
    newRef.push({ node: `d_x${i}`, handle: 'out' })
    if (i < bits - 1) {
      // next carry/borrow = (UP: q_i, DOWN: NOT q_i) AND current carry/borrow
      let chainIn: { node: string; handle: string }
      if (countUp) {
        chainIn = { node: `ff${i}`, handle: 'q' }
      } else {
        nodes.push({
          id: `d_inv${i}`,
          definition: 'block',
          x: 400,
          y: 30 + i * 400,
          block: INVERTER_BLOCK,
        })
        rail.push(`d_inv${i}`)
        edges.push({
          id: `q${i}_inv`,
          source: `ff${i}`,
          sourceHandle: 'q',
          target: `d_inv${i}`,
          targetHandle: 'in',
        })
        chainIn = { node: `d_inv${i}`, handle: 'out' }
      }
      nodes.push({
        id: `d_and${i}`,
        definition: 'block',
        x: 600,
        y: 30 + i * 400,
        block: AND_BLOCK,
      })
      rail.push(`d_and${i}`)
      edges.push({
        id: `inv${i}_and`,
        source: chainIn.node,
        sourceHandle: chainIn.handle,
        target: `d_and${i}`,
        targetHandle: 'a',
      })
      edges.push({
        id: `bor${i}_and`,
        source: borrow.node,
        sourceHandle: borrow.handle,
        target: `d_and${i}`,
        targetHandle: 'b',
      })
      borrow = { node: `d_and${i}`, handle: 'out' }
    }
  }
  // load/enable muxes: D_i = LOAD ? L_i : (withEnable ? (EN ? new_i : q_i) : new_i)
  for (let i = 0; i < bits; i++) {
    nodes.push({ id: `mx${i}`, definition: 'block', x: 800, y: 30 + i * 400, block: MUX2_1BIT })
    rail.push(`mx${i}`)
    const nr = newRef[i]
    let yRef = nr
    if (withEnable && nr !== undefined) {
      // enable-mux: EN ? decremented : hold (the flip-flop's own q)
      nodes.push({ id: `em${i}`, definition: 'block', x: 640, y: 30 + i * 400, block: MUX2_1BIT })
      rail.push(`em${i}`)
      edges.push({
        id: `new${i}_em`,
        source: nr.node,
        sourceHandle: nr.handle,
        target: `em${i}`,
        targetHandle: 'x',
      })
      edges.push({
        id: `q${i}_em`,
        source: `ff${i}`,
        sourceHandle: 'q',
        target: `em${i}`,
        targetHandle: 'y',
      })
      yRef = { node: `em${i}`, handle: 'out' }
    }
    if (yRef !== undefined) {
      edges.push({
        id: `new${i}_mx`,
        source: yRef.node,
        sourceHandle: yRef.handle,
        target: `mx${i}`,
        targetHandle: 'y',
      })
    }
    edges.push({
      id: `mx${i}_ff`,
      source: `mx${i}`,
      sourceHandle: 'out',
      target: `ff${i}`,
      targetHandle: 'd',
    })
  }
  for (let i = 1; i < bits; i++) {
    edges.push({
      id: `selsh${i}`,
      source: 'mx0',
      sourceHandle: 'sel',
      target: `mx${i}`,
      targetHandle: 'sel',
    })
    edges.push({
      id: `clksh${i}`,
      source: 'ff0',
      sourceHandle: 'clk',
      target: `ff${i}`,
      targetHandle: 'clk',
    })
    if (withEnable) {
      edges.push({
        id: `ensh${i}`,
        source: 'em0',
        sourceHandle: 'sel',
        target: `em${i}`,
        targetHandle: 'sel',
      })
    }
  }
  // TC = NOT(OR all q) — high exactly when the count is zero
  const tc = orReduce(
    Array.from({ length: bits }, (_, i) => ({ node: `ff${i}`, handle: 'q' })),
    'tc',
    1000,
  )
  nodes.push(...tc.nodes)
  edges.push(...tc.edges)
  rail.push(...tc.ids)
  nodes.push({ id: 'tc_inv', definition: 'block', x: 1100, y: 0, block: INVERTER_BLOCK })
  rail.push('tc_inv')
  edges.push({
    id: 'tc_or_inv',
    source: tc.out.node,
    sourceHandle: tc.out.handle,
    target: 'tc_inv',
    targetHandle: 'in',
  })
  edges.push(...chainRails(rail, 'cnt'))
  let left = 14
  for (let i = 0; i < bits; i++) {
    ports.push({
      id: `l${i}`,
      label: `L${i}`,
      side: 'left',
      offset: left,
      inner: { nodeId: `mx${i}`, handleId: 'x' },
    })
    left += 14
  }
  ports.push({
    id: 'load',
    label: 'LOAD',
    side: 'left',
    offset: left,
    inner: { nodeId: 'mx0', handleId: 'sel' },
  })
  left += 14
  if (withEnable) {
    ports.push({
      id: 'en',
      label: 'EN',
      side: 'left',
      offset: left,
      inner: { nodeId: 'em0', handleId: 'sel' },
    })
    left += 14
  }
  ports.push({
    id: 'clk',
    label: 'CLK',
    side: 'left',
    offset: left,
    inner: { nodeId: 'ff0', handleId: 'clk' },
  })
  left += 14
  ports.push({
    id: 'gnd',
    label: 'GND',
    side: 'left',
    offset: left,
    inner: { nodeId: 'ff0', handleId: 'gnd' },
  })
  let right = 14
  for (let i = 0; i < bits; i++) {
    ports.push({
      id: `q${i}`,
      label: `Q${i}`,
      side: 'right',
      offset: right,
      inner: { nodeId: `ff${i}`, handleId: 'q' },
    })
    right += 14
  }
  ports.push({
    id: 'tc',
    label: 'TC',
    side: 'right',
    offset: right,
    inner: { nodeId: 'tc_inv', handleId: 'out' },
  })
  right += 14
  ports.push({
    id: 'v_dd',
    label: 'V+',
    side: 'right',
    offset: right,
    inner: { nodeId: 'ff0', handleId: 'v_dd' },
  })
  return { name: `${bits}-bit Down Counter`, origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** A 4-bit loadable down-counter — enough to count a BCD digit's worth of ×/÷ iterations. */
export const DOWN_COUNTER_4: BlockData = buildDownCounter(4)

/** A 4-bit loadable down-counter with a count-enable (holds when EN is low) — the ×/÷ loop counters. */
export const DOWN_COUNTER_EN_4: BlockData = buildDownCounter(4, true)

/** A 4-bit loadable UP-counter with a count-enable — divide's quotient-digit counter (how many times
 *  the divisor fits). Same circuit as the down-counter but with a carry chain instead of a borrow chain. */
export const COUNTER_UP_EN_4: BlockData = buildDownCounter(4, true, true)

/** A 3-bit loadable UP-counter with a count-enable — the char-gen's dot (0..7) and line (0..7) counters. */
export const COUNTER_UP_EN_3: BlockData = buildDownCounter(3, true, true)

/**
 * SIGN FLIP-FLOP (toggle / T flip-flop) — holds the running result sign (0 = +, 1 = −). On a clock it
 * keeps the sign when TOGGLE is low and FLIPS it when TOGGLE is high, because D = SIGN XOR TOGGLE. That one
 * XOR is the whole sign rule: press ± → toggle once; for × or ÷ → toggle by the second number's sign, so
 * SIGN becomes (first sign) XOR (second sign) — negative×negative = positive, etc. Descend for the gates.
 */
export const SIGN_FF_BLOCK: BlockData = {
  name: 'Sign FF',
  origin: { x: 0, y: 0 },
  nodes: [
    { id: 'ff', definition: 'block', x: 360, y: 30, block: D_FLIPFLOP_BLOCK },
    { id: 'xt', definition: 'block', x: 40, y: 30, block: XOR_BLOCK },
  ],
  edges: [
    { id: 'q_xor', source: 'ff', sourceHandle: 'q', target: 'xt', targetHandle: 'a' }, // current sign → XOR
    { id: 'xor_d', source: 'xt', sourceHandle: 'out', target: 'ff', targetHandle: 'd' }, // D = sign XOR toggle
    ...chainRails(['xt', 'ff'], 'sgn'),
  ],
  ports: [
    {
      id: 'toggle',
      label: 'TOGGLE',
      side: 'left',
      offset: 14,
      inner: { nodeId: 'xt', handleId: 'b' },
    },
    { id: 'clk', label: 'CLK', side: 'left', offset: 36, inner: { nodeId: 'ff', handleId: 'clk' } },
    { id: 'gnd', label: 'GND', side: 'left', offset: 58, inner: { nodeId: 'xt', handleId: 'gnd' } },
    {
      id: 'sign',
      label: 'SIGN',
      side: 'right',
      offset: 14,
      inner: { nodeId: 'ff', handleId: 'q' },
    },
    {
      id: 'v_dd',
      label: 'V+',
      side: 'right',
      offset: 36,
      inner: { nodeId: 'xt', handleId: 'v_dd' },
    },
  ],
}

type LogicRef = { node: string; handle: string }
type LogicExpr =
  | LogicRef
  | ['not', LogicExpr]
  | ['and', LogicExpr, LogicExpr]
  | ['or', LogicExpr, LogicExpr]
  | ['xor', LogicExpr, LogicExpr]

interface ExprCtx {
  nodes: BlockData['nodes']
  edges: BlockData['edges']
  ids: string[]
  n: number
}

const BIN_GATE: Record<'and' | 'or' | 'xor', BlockData> = {
  and: AND_BLOCK,
  or: OR_BLOCK,
  xor: XOR_BLOCK,
}

/** Compile a boolean expression tree into REAL gates (AND/OR/NOT/XOR blocks), appending the gate nodes +
 *  wiring edges to ctx and returning the output net. Leaves are nets ({node,handle}) already in the circuit
 *  (an input buffer's out, a flip-flop's q). Lets the control FSM be written as readable equations. */
function buildExpr(expr: LogicExpr, ctx: ExprCtx): LogicRef {
  if (!Array.isArray(expr)) return expr
  const k = ctx.n++
  const id = `g${k}`
  if (expr[0] === 'not') {
    const a = buildExpr(expr[1], ctx)
    ctx.nodes.push({
      id,
      definition: 'block',
      x: (k % 12) * 160,
      y: Math.floor(k / 12) * 200,
      block: INVERTER_BLOCK,
    })
    ctx.ids.push(id)
    ctx.edges.push({
      id: `g${k}a`,
      source: a.node,
      sourceHandle: a.handle,
      target: id,
      targetHandle: 'in',
    })
    return { node: id, handle: 'out' }
  }
  const a = buildExpr(expr[1], ctx)
  const b = buildExpr(expr[2], ctx)
  ctx.nodes.push({
    id,
    definition: 'block',
    x: (k % 12) * 160,
    y: Math.floor(k / 12) * 200,
    block: BIN_GATE[expr[0]],
  })
  ctx.ids.push(id)
  ctx.edges.push({
    id: `g${k}a`,
    source: a.node,
    sourceHandle: a.handle,
    target: id,
    targetHandle: 'a',
  })
  ctx.edges.push({
    id: `g${k}b`,
    source: b.node,
    sourceHandle: b.handle,
    target: id,
    targetHandle: 'b',
  })
  return { node: id, handle: 'out' }
}

/**
 * CALCULATOR CONTROL FSM — the brain. A real clocked state machine: four state flip-flops hold FRESH (the
 * next digit starts a new entry), OPVALID (an operator is pending), and the 2-bit latched OP. Combinational
 * gate logic (built from the equations below) reads those + the keypad encoder's lines (DIGIT / ISOP / ISEQ
 * / ISCLR / op code) and drives the datapath each cycle:
 *   ENTRY_NEW    = DIGIT and FRESH                 (start a new number)
 *   ENTRY_APPEND = DIGIT and not FRESH             (shift ×10, insert digit)
 *   ACC_FROM_ENTRY = ISOP and not OPVALID          (first operator: copy entry to the accumulator)
 *   COMPUTE      = (ISOP or ISEQ) and OPVALID and not FRESH   (do ACC <op> ENTRY)
 *   ALU_ADD/SUB/MUL/DIV = decode of the LATCHED op (the one being executed)
 * Next state: FRESH set by clear/op/equals and cleared by a digit; OPVALID set by an operator, cleared by
 * equals/clear; OP latches the new op on an operator press. Mealy outputs (valid the cycle the key is
 * pressed, before the edge) — the datapath registers latch on the same edge.
 *
 * DATAPATH CONTRACT (load-bearing): on COMPUTE the ALU result is written to BOTH the accumulator AND the
 * entry/display register. The displayed value is therefore the running result, so an operator pressed after
 * '=' continues from it correctly — ACC_FROM_ENTRY (which fires because OPVALID is 0 after '=') copies that
 * displayed result back into the accumulator. A datapath that instead left the entry holding the stale
 * second operand would give the wrong answer (e.g. 2×3=+4= → 7 instead of 10). Proven end-to-end in
 * calc-control-blocks.test.ts ("calculator end-to-end"). Descend for the gates.
 */
function buildCalcControlFsm(): BlockData {
  const nodes: BlockData['nodes'] = []
  const edges: BlockData['edges'] = []
  const ports: BlockData['ports'] = []
  const rail: string[] = []
  const ctx: ExprCtx = { nodes, edges, ids: [], n: 0 }
  let li = 0
  const link = (from: LogicRef, to: LogicRef) => {
    edges.push({
      id: `lnk${li++}`,
      source: from.node,
      sourceHandle: from.handle,
      target: to.node,
      targetHandle: to.handle,
    })
  }

  const inputs = ['digit', 'isop', 'iseq', 'isclr', 'op0', 'op1', 'isdp']
  inputs.forEach((s, i) => {
    nodes.push({
      id: `buf_${s}`,
      definition: 'block',
      x: -300,
      y: 30 + i * 200,
      block: BUFFER_BLOCK,
    })
    rail.push(`buf_${s}`)
  })
  const IN = (s: string): LogicRef => ({ node: `buf_${s}`, handle: 'out' })

  const stateFFs = ['f', 'v', 'op0r', 'op1r', 'dp']
  stateFFs.forEach((s, i) => {
    nodes.push({
      id: `ff_${s}`,
      definition: 'block',
      x: 2600,
      y: 30 + i * 400,
      block: D_FLIPFLOP_BLOCK,
    })
    rail.push(`ff_${s}`)
  })
  const Q = (s: string): LogicRef => ({ node: `ff_${s}`, handle: 'q' })

  const DIGIT = IN('digit')
  const ISOP = IN('isop')
  const ISEQ = IN('iseq')
  const ISCLR = IN('isclr')
  const OP0 = IN('op0')
  const OP1 = IN('op1')
  const F = Q('f')
  const V = Q('v')
  const OP0R = Q('op0r')
  const OP1R = Q('op1r')
  const ISDP = IN('isdp') // a "." was pressed this cycle
  const DP = Q('dp') // a "." has been seen in the current number (fractional-entry mode)

  // control outputs (Mealy). A leading "." also starts a fresh number (entry_new), so ".5" clears
  // any stale entry first; it carries no digit (keypad=0), it just zeroes the register and arms
  // fractional mode for the digits that follow.
  const entryNew = buildExpr(['and', ['or', DIGIT, ISDP], F], ctx)
  const entryAppend = buildExpr(['and', DIGIT, ['not', F]], ctx)
  const accFromEntry = buildExpr(['and', ISOP, ['not', V]], ctx)
  const opOrEq = buildExpr(['or', ISOP, ISEQ], ctx)
  const compute = buildExpr(['and', ['and', opOrEq, V], ['not', F]], ctx)
  const aluAdd = buildExpr(['and', ['not', OP0R], ['not', OP1R]], ctx)
  const aluSub = buildExpr(['and', OP0R, ['not', OP1R]], ctx)
  const aluMul = buildExpr(['and', ['not', OP0R], OP1R], ctx)
  const aluDiv = buildExpr(['and', OP0R, OP1R], ctx)

  // next-state logic
  const setf1 = buildExpr(['or', ['or', ISCLR, ISOP], ISEQ], ctx)
  // FRESH clears on the first digit OR the first "." of a number (so a leading "." begins entry).
  const fNext = buildExpr(['or', setf1, ['and', F, ['and', ['not', DIGIT], ['not', ISDP]]]], ctx)
  const vNext = buildExpr(['or', ISOP, ['and', V, ['and', ['not', ISEQ], ['not', ISCLR]]]], ctx)
  const holdOp: LogicExpr = ['and', ['not', ISOP], ['not', ISCLR]]
  const op0Next = buildExpr(['or', ['and', ISOP, OP0], ['and', OP0R, holdOp]], ctx)
  const op1Next = buildExpr(['or', ['and', ISOP, OP1], ['and', OP1R, holdOp]], ctx)

  // dp_seen: born on "." (is_dp), lives until the entry session ends (setf1 = clr|op|eq clears it),
  // so the next number starts in integer mode.
  const dpNext = buildExpr(['or', ISDP, ['and', DP, ['not', setf1]]], ctx)
  link(fNext, { node: 'ff_f', handle: 'd' })
  link(vNext, { node: 'ff_v', handle: 'd' })
  link(op0Next, { node: 'ff_op0r', handle: 'd' })
  link(op1Next, { node: 'ff_op1r', handle: 'd' })
  link(dpNext, { node: 'ff_dp', handle: 'd' })
  for (let i = 1; i < stateFFs.length; i++) {
    const target = stateFFs[i]
    if (target === undefined) continue
    link({ node: 'ff_f', handle: 'clk' }, { node: `ff_${target}`, handle: 'clk' })
  }

  rail.push(...ctx.ids)
  edges.push(...chainRails(rail, 'fsm'))

  let left = 14
  for (const s of inputs) {
    ports.push({
      id: s,
      label: s.toUpperCase(),
      side: 'left',
      offset: left,
      inner: { nodeId: `buf_${s}`, handleId: 'in' },
    })
    left += 14
  }
  ports.push({
    id: 'clk',
    label: 'CLK',
    side: 'left',
    offset: left,
    inner: { nodeId: 'ff_f', handleId: 'clk' },
  })
  left += 14
  ports.push({
    id: 'gnd',
    label: 'GND',
    side: 'left',
    offset: left,
    inner: { nodeId: 'ff_f', handleId: 'gnd' },
  })

  const outPorts: Array<[string, LogicRef]> = [
    ['entry_new', entryNew],
    ['entry_append', entryAppend],
    ['acc_from_entry', accFromEntry],
    ['compute', compute],
    ['op_latch', ISOP],
    ['clear', ISCLR],
    ['alu_add', aluAdd],
    ['alu_sub', aluSub],
    ['alu_mul', aluMul],
    ['alu_div', aluDiv],
    ['st_fresh', F],
    ['st_opvalid', V],
    ['st_op0', OP0R],
    ['st_op1', OP1R],
    ['dp', DP],
  ]
  let right = 14
  for (const [id, ref] of outPorts) {
    ports.push({
      id,
      label: id.toUpperCase(),
      side: 'right',
      offset: right,
      inner: { nodeId: ref.node, handleId: ref.handle },
    })
    right += 12
  }
  ports.push({
    id: 'v_dd',
    label: 'V+',
    side: 'right',
    offset: right,
    inner: { nodeId: 'ff_f', handleId: 'v_dd' },
  })

  return { name: 'Calculator Control FSM', origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** The calculator's control unit, as a real clocked gate FSM (replaces the old code reducer). */
export const CALC_CONTROL_FSM: BlockData = buildCalcControlFsm()

/**
 * ENTRY REGISTER (10-digit BCD, the displayed "X" register) — the number you're typing, and after '=' the
 * displayed result. Real flip-flops with a per-bit priority mux on the D input, clocked once per keypress:
 *   CLEAR     → 0
 *   COMPUTE   → the ALU result (load result0..39)        [the DATAPATH CONTRACT: result also lands here]
 *   a digit   → ENTRY_NEW: digit goes in the ones place, rest 0; ENTRY_APPEND: shift every digit up one
 *               place (digit p ← digit p−1) and drop the new BCD digit (keypad0..3) into the ones place
 *   otherwise → hold
 * All inputs are buffered for clean fan-out; "0" comes from the gnd rail. Descend for the gates.
 */
function buildEntryRegister(digits: number): BlockData {
  const nodes: BlockData['nodes'] = []
  const edges: BlockData['edges'] = []
  const ports: BlockData['ports'] = []
  const rail: string[] = []
  let mi = 0
  let ei = 0
  const ffId = (p: number, b: number) => `e_${p}_${b}`
  const link = (from: LogicRef, to: LogicRef) => {
    edges.push({
      id: `el${ei++}`,
      source: from.node,
      sourceHandle: from.handle,
      target: to.node,
      targetHandle: to.handle,
    })
  }
  const mux = (sel: LogicRef, x: LogicRef, y: LogicRef): LogicRef => {
    const id = `mx${mi}`
    nodes.push({
      id,
      definition: 'block',
      x: 1200 + (mi % 8) * 500,
      y: Math.floor(mi / 8) * 250,
      block: MUX2_1BIT,
    })
    mi++
    rail.push(id)
    link(sel, { node: id, handle: 'sel' })
    link(x, { node: id, handle: 'x' })
    link(y, { node: id, handle: 'y' })
    return { node: id, handle: 'out' }
  }

  for (let p = 0; p < digits; p++) {
    for (let b = 0; b < 4; b++) {
      nodes.push({
        id: ffId(p, b),
        definition: 'block',
        x: 6000,
        y: (p * 4 + b) * 220,
        block: D_FLIPFLOP_BLOCK,
      })
      rail.push(ffId(p, b))
    }
  }
  const LOW: LogicRef = { node: ffId(0, 0), handle: 'gnd' }
  const Q = (p: number, b: number): LogicRef => ({ node: ffId(p, b), handle: 'q' })

  // buffered inputs
  const ctrl = ['entry_new', 'entry_append', 'compute', 'clear']
  ctrl.forEach((c, i) => {
    nodes.push({ id: `cb_${c}`, definition: 'block', x: -500, y: i * 200, block: BUFFER_BLOCK })
    rail.push(`cb_${c}`)
  })
  const C = (c: string): LogicRef => ({ node: `cb_${c}`, handle: 'out' })
  for (let b = 0; b < 4; b++) {
    nodes.push({
      id: `kp_${b}`,
      definition: 'block',
      x: -500,
      y: 900 + b * 200,
      block: BUFFER_BLOCK,
    })
    rail.push(`kp_${b}`)
  }
  for (let i = 0; i < digits * 4; i++) {
    nodes.push({ id: `rb_${i}`, definition: 'block', x: -1000, y: i * 200, block: BUFFER_BLOCK })
    rail.push(`rb_${i}`)
  }
  const KP = (b: number): LogicRef => ({ node: `kp_${b}`, handle: 'out' })
  const RB = (i: number): LogicRef => ({ node: `rb_${i}`, handle: 'out' })

  // digitpress = entry_new OR entry_append
  nodes.push({ id: 'dp_or', definition: 'block', x: -200, y: 1800, block: OR_BLOCK })
  rail.push('dp_or')
  link(C('entry_new'), { node: 'dp_or', handle: 'a' })
  link(C('entry_append'), { node: 'dp_or', handle: 'b' })
  const DIGITPRESS: LogicRef = { node: 'dp_or', handle: 'out' }

  for (let p = 0; p < digits; p++) {
    for (let b = 0; b < 4; b++) {
      const i = p * 4 + b
      const digitVal = p === 0 ? KP(b) : mux(C('entry_append'), Q(p - 1, b), LOW)
      const m1 = mux(DIGITPRESS, digitVal, Q(p, b)) // digit press (shift/insert) vs hold
      const m2 = mux(C('compute'), RB(i), m1) // compute result vs the above
      const m3 = mux(C('clear'), LOW, m2) // clear vs the above
      link(m3, { node: ffId(p, b), handle: 'd' })
    }
  }

  // shared clock
  for (let p = 0; p < digits; p++) {
    for (let b = 0; b < 4; b++) {
      if (p === 0 && b === 0) continue
      link({ node: ffId(0, 0), handle: 'clk' }, { node: ffId(p, b), handle: 'clk' })
    }
  }
  edges.push(...chainRails(rail, 'ereg'))

  let left = 14
  for (const c of ctrl) {
    ports.push({
      id: c,
      label: c.toUpperCase(),
      side: 'left',
      offset: left,
      inner: { nodeId: `cb_${c}`, handleId: 'in' },
    })
    left += 12
  }
  for (let b = 0; b < 4; b++) {
    ports.push({
      id: `keypad${b}`,
      label: `K${b}`,
      side: 'left',
      offset: left,
      inner: { nodeId: `kp_${b}`, handleId: 'in' },
    })
    left += 12
  }
  ports.push({
    id: 'clk',
    label: 'CLK',
    side: 'left',
    offset: left,
    inner: { nodeId: ffId(0, 0), handleId: 'clk' },
  })
  left += 12
  ports.push({
    id: 'gnd',
    label: 'GND',
    side: 'left',
    offset: left,
    inner: { nodeId: ffId(0, 0), handleId: 'gnd' },
  })
  for (let i = 0; i < digits * 4; i++) {
    ports.push({
      id: `result${i}`,
      label: `R${i}`,
      side: 'left',
      offset: left + 12 + i * 4,
      inner: { nodeId: `rb_${i}`, handleId: 'in' },
    })
  }
  let right = 14
  for (let i = 0; i < digits * 4; i++) {
    const p = Math.floor(i / 4)
    const b = i % 4
    ports.push({
      id: `entry${i}`,
      label: `E${i}`,
      side: 'right',
      offset: right,
      inner: { nodeId: ffId(p, b), handleId: 'q' },
    })
    right += 8
  }
  ports.push({
    id: 'v_dd',
    label: 'V+',
    side: 'right',
    offset: right,
    inner: { nodeId: ffId(0, 0), handleId: 'v_dd' },
  })
  return { name: `${digits}-digit Entry Register`, origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** The calculator's 10-digit entry/display register. */
export const ENTRY_REGISTER_10: BlockData = buildEntryRegister(10)

/**
 * ACCUMULATOR (10-digit BCD, the "Y" register) — holds the running left operand. Per-bit priority mux,
 * clocked once per keypress:
 *   CLEAR          → 0
 *   COMPUTE        → the ALU result (result0..39)
 *   ACC_FROM_ENTRY → copy the entry register (entry0..39) — the first operand, or (after '=') the
 *                    displayed result, so a chained calculation continues correctly
 *   otherwise      → hold
 * Entry/result data ports map straight onto the mux inputs (no buffers needed — one fan-out each); the
 * broadly-fanned control lines are buffered. Descend for the gates.
 */
function buildAccRegister(digits: number): BlockData {
  const nodes: BlockData['nodes'] = []
  const edges: BlockData['edges'] = []
  const ports: BlockData['ports'] = []
  const rail: string[] = []
  let mi = 0
  let ei = 0
  const ffId = (p: number, b: number) => `a_${p}_${b}`
  const link = (from: LogicRef, to: LogicRef) => {
    edges.push({
      id: `al${ei++}`,
      source: from.node,
      sourceHandle: from.handle,
      target: to.node,
      targetHandle: to.handle,
    })
  }
  for (let p = 0; p < digits; p++) {
    for (let b = 0; b < 4; b++) {
      nodes.push({
        id: ffId(p, b),
        definition: 'block',
        x: 6000,
        y: (p * 4 + b) * 220,
        block: D_FLIPFLOP_BLOCK,
      })
      rail.push(ffId(p, b))
    }
  }
  const LOW: LogicRef = { node: ffId(0, 0), handle: 'gnd' }
  const Q = (p: number, b: number): LogicRef => ({ node: ffId(p, b), handle: 'q' })
  const ctrl = ['clear', 'compute', 'acc_from_entry']
  ctrl.forEach((c, i) => {
    nodes.push({ id: `cb_${c}`, definition: 'block', x: -500, y: i * 200, block: BUFFER_BLOCK })
    rail.push(`cb_${c}`)
  })
  const C = (c: string): LogicRef => ({ node: `cb_${c}`, handle: 'out' })
  const newMux = (): string => {
    const id = `mx${mi}`
    nodes.push({
      id,
      definition: 'block',
      x: 1200 + (mi % 8) * 500,
      y: Math.floor(mi / 8) * 250,
      block: MUX2_1BIT,
    })
    mi++
    rail.push(id)
    return id
  }

  let left = 14
  let right = 14
  for (let p = 0; p < digits; p++) {
    for (let b = 0; b < 4; b++) {
      const i = p * 4 + b
      const m1 = newMux() // ACC_FROM_ENTRY ? entry_i : hold ; entry_i maps onto m1.x
      link(C('acc_from_entry'), { node: m1, handle: 'sel' })
      link(Q(p, b), { node: m1, handle: 'y' })
      const m2 = newMux() // COMPUTE ? result_i : m1 ; result_i maps onto m2.x
      link(C('compute'), { node: m2, handle: 'sel' })
      link({ node: m1, handle: 'out' }, { node: m2, handle: 'y' })
      const m3 = newMux() // CLEAR ? 0 : m2
      link(C('clear'), { node: m3, handle: 'sel' })
      link(LOW, { node: m3, handle: 'x' })
      link({ node: m2, handle: 'out' }, { node: m3, handle: 'y' })
      link({ node: m3, handle: 'out' }, { node: ffId(p, b), handle: 'd' })
      ports.push({
        id: `entry${i}`,
        label: `Y${i}`,
        side: 'left',
        offset: 200 + i * 8,
        inner: { nodeId: m1, handleId: 'x' },
      })
      ports.push({
        id: `result${i}`,
        label: `R${i}`,
        side: 'left',
        offset: 600 + i * 8,
        inner: { nodeId: m2, handleId: 'x' },
      })
      ports.push({
        id: `acc${i}`,
        label: `A${i}`,
        side: 'right',
        offset: right,
        inner: { nodeId: ffId(p, b), handleId: 'q' },
      })
      right += 8
    }
  }
  for (let p = 0; p < digits; p++) {
    for (let b = 0; b < 4; b++) {
      if (p === 0 && b === 0) continue
      link({ node: ffId(0, 0), handle: 'clk' }, { node: ffId(p, b), handle: 'clk' })
    }
  }
  edges.push(...chainRails(rail, 'areg'))
  for (const c of ctrl) {
    ports.push({
      id: c,
      label: c.toUpperCase(),
      side: 'left',
      offset: left,
      inner: { nodeId: `cb_${c}`, handleId: 'in' },
    })
    left += 12
  }
  ports.push({
    id: 'clk',
    label: 'CLK',
    side: 'left',
    offset: left,
    inner: { nodeId: ffId(0, 0), handleId: 'clk' },
  })
  left += 12
  ports.push({
    id: 'gnd',
    label: 'GND',
    side: 'left',
    offset: left,
    inner: { nodeId: ffId(0, 0), handleId: 'gnd' },
  })
  ports.push({
    id: 'v_dd',
    label: 'V+',
    side: 'right',
    offset: right,
    inner: { nodeId: ffId(0, 0), handleId: 'v_dd' },
  })
  return { name: `${digits}-digit Accumulator`, origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** The calculator's 10-digit accumulator register. */
export const ACC_REGISTER_10: BlockData = buildAccRegister(10)

/**
 * CALCULATOR (add/subtract core) — the whole +/− machine wired from real blocks: the keypad encoder feeds
 * the control FSM (class lines) and the entry register (the pressed digit); the FSM drives both registers;
 * the accumulator and entry feed the BCD ALU (ACC = A, ENTRY = B, SUB from the FSM), and the ALU result
 * goes back into BOTH registers (the contract). One shared clock: each keypress = one clock edge advances
 * the FSM and the datapath together. ENTRY0..39 is the displayed value. ×/÷ need the micro-sequencer (next
 * stage); this proves digit entry + + / − end-to-end on real gates. Descend for the whole datapath.
 */
function buildCalculatorAddSub(): BlockData {
  const nodes: BlockData['nodes'] = [
    { id: 'enc', definition: 'block', x: 0, y: 0, block: KEYPAD_ENCODER_BLOCK },
    { id: 'fsm', definition: 'block', x: 2400, y: 0, block: CALC_CONTROL_FSM },
    { id: 'ent', definition: 'block', x: 5000, y: 0, block: ENTRY_REGISTER_10 },
    { id: 'acc', definition: 'block', x: 5000, y: 12000, block: ACC_REGISTER_10 },
    { id: 'alu', definition: 'block', x: 9000, y: 0, block: BCD_ALU_10 },
  ]
  const edges: BlockData['edges'] = []
  let ei = 0
  const e = (s: string, sh: string, t: string, th: string) => {
    edges.push({ id: `w${ei++}`, source: s, sourceHandle: sh, target: t, targetHandle: th })
  }
  // encoder class lines → FSM
  e('enc', 'digit', 'fsm', 'digit')
  e('enc', 'is_op', 'fsm', 'isop')
  e('enc', 'is_eq', 'fsm', 'iseq')
  e('enc', 'is_clr', 'fsm', 'isclr')
  e('enc', 'op0', 'fsm', 'op0')
  e('enc', 'op1', 'fsm', 'op1')
  e('enc', 'is_dot', 'fsm', 'isdp') // drive the FSM's new decimal-point input (unused here → 0)
  // encoder digit value → entry register's keypad
  for (let b = 0; b < 4; b++) e('enc', `d${b}`, 'ent', `keypad${b}`)
  // FSM → entry register control
  e('fsm', 'entry_new', 'ent', 'entry_new')
  e('fsm', 'entry_append', 'ent', 'entry_append')
  e('fsm', 'compute', 'ent', 'compute')
  e('fsm', 'clear', 'ent', 'clear')
  // FSM → accumulator control
  e('fsm', 'acc_from_entry', 'acc', 'acc_from_entry')
  e('fsm', 'compute', 'acc', 'compute')
  e('fsm', 'clear', 'acc', 'clear')
  // datapath buses
  for (let i = 0; i < 40; i++) {
    e('ent', `entry${i}`, 'alu', `b${i}`) // ENTRY → ALU B
    e('ent', `entry${i}`, 'acc', `entry${i}`) // ENTRY → ACC (ACC_FROM_ENTRY copy source)
    e('acc', `acc${i}`, 'alu', `a${i}`) // ACC → ALU A
    e('alu', `s${i}`, 'ent', `result${i}`) // result → ENTRY
    e('alu', `s${i}`, 'acc', `result${i}`) // result → ACC
  }
  e('fsm', 'alu_sub', 'alu', 'sub')
  // shared clock: FSM clk fans to both registers
  e('fsm', 'clk', 'ent', 'clk')
  e('fsm', 'clk', 'acc', 'clk')
  edges.push(...chainRails(['enc', 'fsm', 'ent', 'acc', 'alu'], 'calc'))

  const ports: BlockData['ports'] = []
  const keys = [
    'k0',
    'k1',
    'k2',
    'k3',
    'k4',
    'k5',
    'k6',
    'k7',
    'k8',
    'k9',
    'kadd',
    'ksub',
    'kmul',
    'kdiv',
    'keq',
    'kclr',
    'kpm',
    'kdot',
  ]
  let left = 14
  for (const k of keys) {
    ports.push({
      id: k,
      label: k.toUpperCase(),
      side: 'left',
      offset: left,
      inner: { nodeId: 'enc', handleId: k },
    })
    left += 12
  }
  ports.push({
    id: 'clk',
    label: 'CLK',
    side: 'left',
    offset: left,
    inner: { nodeId: 'fsm', handleId: 'clk' },
  })
  left += 12
  ports.push({
    id: 'gnd',
    label: 'GND',
    side: 'left',
    offset: left,
    inner: { nodeId: 'enc', handleId: 'gnd' },
  })
  let right = 14
  for (let i = 0; i < 40; i++) {
    ports.push({
      id: `entry${i}`,
      label: `E${i}`,
      side: 'right',
      offset: right,
      inner: { nodeId: 'ent', handleId: `entry${i}` },
    })
    right += 8
  }
  ports.push({
    id: 'v_dd',
    label: 'V+',
    side: 'right',
    offset: right,
    inner: { nodeId: 'enc', handleId: 'v_dd' },
  })
  return { name: 'Calculator (add/subtract)', origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** The add/subtract calculator wired from real blocks (encoder + FSM + registers + ALU). */
export const CALCULATOR_ADDSUB: BlockData = buildCalculatorAddSub()

/**
 * MULTIPLY SEQUENCER (the ×/÷ micro-controller's control FSM) — runs digit-serial shift-add multiply as a
 * real clocked state machine. Six one-hot state flip-flops (idle = none set, so power-up is clean):
 *   INIT   → clear the product, load the multiplier into the shift register, load the outer counter (10)
 *   SHIFTP → product ×10 (shift up, insert 0), load the inner counter with the multiplier's top digit
 *   ADD    → while inner counter ≠ 0: product += A, inner−−   (one add per clock)
 *   SHIFTB → multiplier ×10 (bring the next digit to the top), outer−−
 *   CHECK  → outer ≠ 0 ? back to SHIFTP : DONE
 *   DONE   → product holds the answer; pulse DONE, then back to idle
 * Drives the reused registers/counters/ALU (built elsewhere) via its control outputs. Inputs: START and the
 * two counters' terminal-count lines. Logic compiled from equations by buildExpr. Descend for the gates.
 */
function buildMultiplySequencer(): BlockData {
  const nodes: BlockData['nodes'] = []
  const edges: BlockData['edges'] = []
  const ports: BlockData['ports'] = []
  const rail: string[] = []
  const ctx: ExprCtx = { nodes, edges, ids: [], n: 0 }
  let li = 0
  const link = (from: LogicRef, to: LogicRef) => {
    edges.push({
      id: `ms${li++}`,
      source: from.node,
      sourceHandle: from.handle,
      target: to.node,
      targetHandle: to.handle,
    })
  }
  const inputs = ['start', 'inner_tc', 'outer_tc']
  inputs.forEach((s, i) => {
    nodes.push({ id: `ib_${s}`, definition: 'block', x: -300, y: i * 200, block: BUFFER_BLOCK })
    rail.push(`ib_${s}`)
  })
  const IN = (s: string): LogicRef => ({ node: `ib_${s}`, handle: 'out' })
  const states = ['init', 'shiftp', 'add', 'shiftb', 'check', 'done']
  states.forEach((s, i) => {
    nodes.push({ id: `s_${s}`, definition: 'block', x: 2200, y: i * 400, block: D_FLIPFLOP_BLOCK })
    rail.push(`s_${s}`)
  })
  const Q = (s: string): LogicRef => ({ node: `s_${s}`, handle: 'q' })
  const START = IN('start')
  const ITC = IN('inner_tc')
  const OTC = IN('outer_tc')
  const INIT = Q('init')
  const SHIFTP = Q('shiftp')
  const ADD = Q('add')
  const SHIFTB = Q('shiftb')
  const CHECK = Q('check')
  const DONE = Q('done')

  const anyState = buildExpr(
    ['or', ['or', ['or', INIT, SHIFTP], ['or', ADD, SHIFTB]], ['or', CHECK, DONE]],
    ctx,
  )
  const IDLE = buildExpr(['not', anyState], ctx)
  const addActive = buildExpr(['and', ADD, ['not', ITC]], ctx) // ADD and still counting → do an add

  // next-state (one-hot)
  link(buildExpr(['and', IDLE, START], ctx), { node: 's_init', handle: 'd' })
  link(buildExpr(['or', INIT, ['and', CHECK, ['not', OTC]]], ctx), {
    node: 's_shiftp',
    handle: 'd',
  })
  link(buildExpr(['or', SHIFTP, addActive], ctx), { node: 's_add', handle: 'd' })
  link(buildExpr(['and', ADD, ITC], ctx), { node: 's_shiftb', handle: 'd' })
  link(SHIFTB, { node: 's_check', handle: 'd' })
  link(buildExpr(['and', CHECK, OTC], ctx), { node: 's_done', handle: 'd' })
  for (let i = 1; i < states.length; i++) {
    const s = states[i]
    if (s === undefined) continue
    link({ node: 's_init', handle: 'clk' }, { node: `s_${s}`, handle: 'clk' })
  }
  rail.push(...ctx.ids)
  edges.push(...chainRails(rail, 'mseq'))

  let left = 14
  for (const s of inputs) {
    ports.push({
      id: s,
      label: s.toUpperCase(),
      side: 'left',
      offset: left,
      inner: { nodeId: `ib_${s}`, handleId: 'in' },
    })
    left += 14
  }
  ports.push({
    id: 'clk',
    label: 'CLK',
    side: 'left',
    offset: left,
    inner: { nodeId: 's_init', handleId: 'clk' },
  })
  left += 14
  ports.push({
    id: 'gnd',
    label: 'GND',
    side: 'left',
    offset: left,
    inner: { nodeId: 's_init', handleId: 'gnd' },
  })
  // control outputs (several share a state line)
  const out: Array<[string, LogicRef]> = [
    ['p_clear', INIT],
    ['b_load', INIT],
    ['outer_load', INIT],
    ['p_shift', SHIFTP],
    ['inner_load', SHIFTP],
    ['p_add', addActive],
    ['inner_dec', addActive],
    ['b_shift', SHIFTB],
    ['outer_dec', SHIFTB],
    ['done', DONE],
  ]
  let right = 14
  for (const [id, ref] of out) {
    ports.push({
      id,
      label: id.toUpperCase(),
      side: 'right',
      offset: right,
      inner: { nodeId: ref.node, handleId: ref.handle },
    })
    right += 12
  }
  ports.push({
    id: 'v_dd',
    label: 'V+',
    side: 'right',
    offset: right,
    inner: { nodeId: 's_init', handleId: 'v_dd' },
  })
  return { name: 'Multiply Sequencer', origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** The control FSM that sequences digit-serial multiply (and, reused, divide). */
export const MULTIPLY_SEQUENCER: BlockData = buildMultiplySequencer()

/**
 * MULTIPLIER (A × B, 10-digit BCD) — the sequencer driving a real datapath that REUSES existing blocks:
 *   • product register P  = an entry register with keypad pinned to 0 (clear / ×10-shift / load ALU result)
 *   • multiplier register = an entry register with keypad pinned to 0 (load B, then ×10-shift each digit)
 *   • two enable-down-counters (inner = current digit's count, outer = the 10 digit positions)
 *   • the BCD ALU computing P + A
 * The sequencer's control lines drive them; the counters' terminal-count lines feed back to the sequencer;
 * the multiplier register's top digit (bits 36–39) loads the inner counter. Pulse START, clock until DONE,
 * read PRODUCT. ~digit-serial shift-add. Descend for the whole datapath.
 */
function buildMultiplier(): BlockData {
  const nodes: BlockData['nodes'] = [
    { id: 'seq', definition: 'block', x: 0, y: 0, block: MULTIPLY_SEQUENCER },
    { id: 'preg', definition: 'block', x: 3000, y: 0, block: ENTRY_REGISTER_10 },
    { id: 'breg', definition: 'block', x: 3000, y: 14000, block: ENTRY_REGISTER_10 },
    { id: 'inner', definition: 'block', x: 7000, y: 0, block: DOWN_COUNTER_EN_4 },
    { id: 'outer', definition: 'block', x: 7000, y: 6000, block: DOWN_COUNTER_EN_4 },
    { id: 'alu', definition: 'block', x: 10000, y: 0, block: BCD_ALU_10 },
  ]
  const edges: BlockData['edges'] = []
  let ei = 0
  const e = (s: string, sh: string, t: string, th: string) => {
    edges.push({ id: `m${ei++}`, source: s, sourceHandle: sh, target: t, targetHandle: th })
  }
  const LOW = { node: 'preg', handle: 'gnd' }
  const HIGH = { node: 'preg', handle: 'v_dd' }
  const tie = (node: string, port: string, ref: { node: string; handle: string }) => {
    e(ref.node, ref.handle, node, port)
  }
  const ctx: ExprCtx = { nodes, edges, ids: [], n: 0 }
  // sequencer → product register (clear / shift / add-result)
  e('seq', 'p_clear', 'preg', 'clear')
  e('seq', 'p_shift', 'preg', 'entry_append')
  e('seq', 'p_add', 'preg', 'compute')
  tie('preg', 'entry_new', LOW) // unused
  for (let b = 0; b < 4; b++) tie('preg', `keypad${b}`, LOW)
  // sequencer → multiplier register (load B via compute / shift)
  e('seq', 'b_load', 'breg', 'compute')
  e('seq', 'b_shift', 'breg', 'entry_append')
  tie('breg', 'clear', LOW)
  tie('breg', 'entry_new', LOW)
  for (let b = 0; b < 4; b++) tie('breg', `keypad${b}`, LOW)
  // ALU: a = P (preg.entry), b = A (input), sub = 0 (add); result → preg.result
  tie('alu', 'sub', LOW)
  for (let i = 0; i < 40; i++) {
    e('preg', `entry${i}`, 'alu', `a${i}`)
    e('alu', `s${i}`, 'preg', `result${i}`)
  }
  // multiplier register's MSD (digit 9 = bits 36–39) → inner counter load value
  for (let b = 0; b < 4; b++) e('breg', `entry${36 + b}`, 'inner', `l${b}`)
  // inner counter
  e('seq', 'inner_load', 'inner', 'load')
  e('seq', 'inner_dec', 'inner', 'en')
  e('inner', 'tc', 'seq', 'inner_tc')
  // outer counter: load the constant 10 (1010)
  tie('outer', 'l0', LOW)
  tie('outer', 'l1', HIGH)
  tie('outer', 'l2', LOW)
  tie('outer', 'l3', HIGH)
  e('seq', 'outer_load', 'outer', 'load')
  e('seq', 'outer_dec', 'outer', 'en')
  e('outer', 'tc', 'seq', 'outer_tc')
  // shared clock
  e('seq', 'clk', 'preg', 'clk')
  e('seq', 'clk', 'breg', 'clk')
  e('seq', 'clk', 'inner', 'clk')
  e('seq', 'clk', 'outer', 'clk')
  // OVERFLOW latch: the true product needs more than 10 digits when, during an accumulate, P+A carries
  // out of the top digit (alu.cout on a p_add) OR a nonzero MSD is about to be ×10-shifted off the top
  // (p_shift with preg's top digit set). Sticky across the run; reset at each multiply's INIT (p_clear).
  // Real gates — descend to see them.
  nodes.push({ id: 'ovf', definition: 'block', x: 10000, y: 12000, block: D_FLIPFLOP_BLOCK })
  const pTop = buildExpr(
    [
      'or',
      ['or', { node: 'preg', handle: 'entry36' }, { node: 'preg', handle: 'entry37' }],
      ['or', { node: 'preg', handle: 'entry38' }, { node: 'preg', handle: 'entry39' }],
    ],
    ctx,
  )
  const ovfNow = buildExpr(
    [
      'or',
      ['and', { node: 'alu', handle: 'cout' }, { node: 'seq', handle: 'p_add' }],
      ['and', { node: 'seq', handle: 'p_shift' }, pTop],
    ],
    ctx,
  )
  const ovfD = buildExpr(
    [
      'or',
      ovfNow,
      ['and', { node: 'ovf', handle: 'q' }, ['not', { node: 'seq', handle: 'p_clear' }]],
    ],
    ctx,
  )
  e(ovfD.node, ovfD.handle, 'ovf', 'd')
  e('seq', 'clk', 'ovf', 'clk')
  edges.push(
    ...chainRails(['seq', 'preg', 'breg', 'inner', 'outer', 'alu', 'ovf', ...ctx.ids], 'mul'),
  )

  const ports: BlockData['ports'] = []
  let left = 14
  for (let i = 0; i < 40; i++) {
    ports.push({
      id: `a${i}`,
      label: `A${i}`,
      side: 'left',
      offset: left,
      inner: { nodeId: 'alu', handleId: `b${i}` },
    })
    left += 6
  }
  for (let i = 0; i < 40; i++) {
    ports.push({
      id: `b${i}`,
      label: `B${i}`,
      side: 'left',
      offset: left,
      inner: { nodeId: 'breg', handleId: `result${i}` },
    })
    left += 6
  }
  ports.push({
    id: 'start',
    label: 'START',
    side: 'left',
    offset: left,
    inner: { nodeId: 'seq', handleId: 'start' },
  })
  left += 12
  ports.push({
    id: 'clk',
    label: 'CLK',
    side: 'left',
    offset: left,
    inner: { nodeId: 'seq', handleId: 'clk' },
  })
  left += 12
  ports.push({
    id: 'gnd',
    label: 'GND',
    side: 'left',
    offset: left,
    inner: { nodeId: 'preg', handleId: 'gnd' },
  })
  let right = 14
  for (let i = 0; i < 40; i++) {
    ports.push({
      id: `product${i}`,
      label: `P${i}`,
      side: 'right',
      offset: right,
      inner: { nodeId: 'preg', handleId: `entry${i}` },
    })
    right += 6
  }
  ports.push({
    id: 'done',
    label: 'DONE',
    side: 'right',
    offset: right,
    inner: { nodeId: 'seq', handleId: 'done' },
  })
  right += 12
  ports.push({
    id: 'overflow',
    label: 'OVF',
    side: 'right',
    offset: right,
    inner: { nodeId: 'ovf', handleId: 'q' },
  })
  right += 12
  ports.push({
    id: 'v_dd',
    label: 'V+',
    side: 'right',
    offset: right,
    inner: { nodeId: 'preg', handleId: 'v_dd' },
  })
  return { name: 'Multiplier (A × B)', origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** A × B over 10 BCD digits, as a real clocked datapath (sequencer + reused registers/counters/ALU). */
export const MULTIPLIER_10: BlockData = buildMultiplier()

/**
 * DIVIDE SEQUENCER (the ÷ control FSM) — long division, digit-serial, as a real clocked machine. Seven
 * one-hot states (idle = none set):
 *   INIT     → clear quotient + remainder, load the dividend, set the outer counter (10)
 *   BRINGDOWN→ remainder = remainder×10 + the dividend's top digit; reset the quotient-digit counter to 0
 *   SUBTRACT → while remainder ≥ divisor (the ALU's carry-out on R−B): remainder −= divisor, quotient digit ++
 *   STOREQ   → quotient = quotient×10 + this digit's count
 *   SHIFTA   → dividend ×10 (next digit to the top), outer −−
 *   CHECK    → more digits ? BRINGDOWN : DONE
 *   DONE     → quotient holds the answer (remainder holds the remainder)
 * Inputs: START, COUT (remainder ≥ divisor), OUTER_TC. Logic compiled by buildExpr. Descend for the gates.
 */
function buildDivideSequencer(): BlockData {
  const nodes: BlockData['nodes'] = []
  const edges: BlockData['edges'] = []
  const ports: BlockData['ports'] = []
  const rail: string[] = []
  const ctx: ExprCtx = { nodes, edges, ids: [], n: 0 }
  let li = 0
  const link = (from: LogicRef, to: LogicRef) => {
    edges.push({
      id: `ds${li++}`,
      source: from.node,
      sourceHandle: from.handle,
      target: to.node,
      targetHandle: to.handle,
    })
  }
  const inputs = ['start', 'cout', 'outer_tc', 'divzero', 'clear']
  inputs.forEach((s, i) => {
    nodes.push({ id: `ib_${s}`, definition: 'block', x: -300, y: i * 200, block: BUFFER_BLOCK })
    rail.push(`ib_${s}`)
  })
  const IN = (s: string): LogicRef => ({ node: `ib_${s}`, handle: 'out' })
  const states = ['init', 'bringdown', 'subtract', 'storeq', 'shifta', 'check', 'done']
  states.forEach((s, i) => {
    nodes.push({ id: `s_${s}`, definition: 'block', x: 2200, y: i * 400, block: D_FLIPFLOP_BLOCK })
    rail.push(`s_${s}`)
  })
  // a latched error flag (divide by zero), not a one-hot state
  nodes.push({
    id: 's_error',
    definition: 'block',
    x: 2200,
    y: states.length * 400,
    block: D_FLIPFLOP_BLOCK,
  })
  rail.push('s_error')
  const Q = (s: string): LogicRef => ({ node: `s_${s}`, handle: 'q' })
  const START = IN('start')
  const COUT = IN('cout')
  const OTC = IN('outer_tc')
  const DIVZERO = IN('divzero')
  const CLEAR = IN('clear')
  const ERROR: LogicRef = { node: 's_error', handle: 'q' }
  const INIT = Q('init')
  const BRINGDOWN = Q('bringdown')
  const SUBTRACT = Q('subtract')
  const STOREQ = Q('storeq')
  const SHIFTA = Q('shifta')
  const CHECK = Q('check')
  const DONE = Q('done')

  const anyState = buildExpr(
    [
      'or',
      ['or', ['or', INIT, BRINGDOWN], ['or', SUBTRACT, STOREQ]],
      ['or', ['or', SHIFTA, CHECK], DONE],
    ],
    ctx,
  )
  const IDLE = buildExpr(['not', anyState], ctx)
  const subActive = buildExpr(['and', SUBTRACT, COUT], ctx) // remainder ≥ divisor → subtract + count up

  link(buildExpr(['and', IDLE, START], ctx), { node: 's_init', handle: 'd' })
  // from INIT: a zero divisor skips the loop and finishes immediately (error); else start the first digit
  link(buildExpr(['or', ['and', INIT, ['not', DIVZERO]], ['and', CHECK, ['not', OTC]]], ctx), {
    node: 's_bringdown',
    handle: 'd',
  })
  link(buildExpr(['or', BRINGDOWN, subActive], ctx), { node: 's_subtract', handle: 'd' })
  link(buildExpr(['and', SUBTRACT, ['not', COUT]], ctx), { node: 's_storeq', handle: 'd' })
  link(STOREQ, { node: 's_shifta', handle: 'd' })
  link(SHIFTA, { node: 's_check', handle: 'd' })
  link(buildExpr(['or', ['and', CHECK, OTC], ['and', INIT, DIVZERO]], ctx), {
    node: 's_done',
    handle: 'd',
  })
  // error flag: latch the zero-divisor verdict at INIT, hold otherwise — but CLEAR forces it back to 0
  link(
    buildExpr(
      ['or', ['and', INIT, DIVZERO], ['and', ['and', ERROR, ['not', INIT]], ['not', CLEAR]]],
      ctx,
    ),
    { node: 's_error', handle: 'd' },
  )
  for (let i = 1; i < states.length; i++) {
    const s = states[i]
    if (s === undefined) continue
    link({ node: 's_init', handle: 'clk' }, { node: `s_${s}`, handle: 'clk' })
  }
  link({ node: 's_init', handle: 'clk' }, { node: 's_error', handle: 'clk' })
  rail.push(...ctx.ids)
  edges.push(...chainRails(rail, 'dseq'))

  let left = 14
  for (const s of inputs) {
    ports.push({
      id: s,
      label: s.toUpperCase(),
      side: 'left',
      offset: left,
      inner: { nodeId: `ib_${s}`, handleId: 'in' },
    })
    left += 14
  }
  ports.push({
    id: 'clk',
    label: 'CLK',
    side: 'left',
    offset: left,
    inner: { nodeId: 's_init', handleId: 'clk' },
  })
  left += 14
  ports.push({
    id: 'gnd',
    label: 'GND',
    side: 'left',
    offset: left,
    inner: { nodeId: 's_init', handleId: 'gnd' },
  })
  const out: Array<[string, LogicRef]> = [
    ['r_clear', INIT],
    ['q_clear', INIT],
    ['a_load', INIT],
    ['outer_load', INIT],
    ['r_bringdown', BRINGDOWN],
    ['count_load0', BRINGDOWN],
    ['r_sub', subActive],
    ['count_inc', subActive],
    ['q_store', STOREQ],
    ['a_shift', SHIFTA],
    ['outer_dec', SHIFTA],
    ['done', DONE],
    ['error', ERROR],
  ]
  let right = 14
  for (const [id, ref] of out) {
    ports.push({
      id,
      label: id.toUpperCase(),
      side: 'right',
      offset: right,
      inner: { nodeId: ref.node, handleId: ref.handle },
    })
    right += 12
  }
  ports.push({
    id: 'v_dd',
    label: 'V+',
    side: 'right',
    offset: right,
    inner: { nodeId: 's_init', handleId: 'v_dd' },
  })
  return { name: 'Divide Sequencer', origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** The control FSM that sequences digit-serial long division. */
export const DIVIDE_SEQUENCER: BlockData = buildDivideSequencer()

/**
 * DIVIDER (A ÷ B, 10-digit BCD) — the divide sequencer driving a reused datapath:
 *   • dividend register A = an entry register (keypad 0) — load A, then ×10-shift each digit, read its top
 *     digit (bits 36–39) as the digit being brought down
 *   • remainder register R = an entry register whose keypad is A's top digit, so entry_append does
 *     R = R×10 + digit (bring-down); compute loads the ALU's R−B (subtract)
 *   • quotient register Q = an entry register whose keypad is the up-counter, so entry_append does
 *     Q = Q×10 + count
 *   • the up-counter (quotient digit) + the outer down-counter (10 digit positions)
 *   • the BCD ALU computing R − B; its carry-out is "R ≥ B" feeding the sequencer's COUT
 * Pulse START, clock until DONE, read QUOTIENT (REMAINDER also exposed). Descend for the whole datapath.
 */
function buildDivider(extraFractional = 0): BlockData {
  const nodes: BlockData['nodes'] = [
    { id: 'seq', definition: 'block', x: 0, y: 0, block: DIVIDE_SEQUENCER },
    { id: 'areg', definition: 'block', x: 3000, y: 0, block: ENTRY_REGISTER_10 },
    { id: 'rreg', definition: 'block', x: 3000, y: 14000, block: ENTRY_REGISTER_10 },
    { id: 'qreg', definition: 'block', x: 3000, y: 28000, block: ENTRY_REGISTER_10 },
    { id: 'count', definition: 'block', x: 7000, y: 0, block: COUNTER_UP_EN_4 },
    { id: 'outer', definition: 'block', x: 7000, y: 6000, block: DOWN_COUNTER_EN_4 },
    { id: 'alu', definition: 'block', x: 10000, y: 0, block: BCD_ALU_10 },
  ]
  const edges: BlockData['edges'] = []
  let ei = 0
  const e = (s: string, sh: string, t: string, th: string) => {
    edges.push({ id: `d${ei++}`, source: s, sourceHandle: sh, target: t, targetHandle: th })
  }
  const LOW = { node: 'areg', handle: 'gnd' }
  const HIGH = { node: 'areg', handle: 'v_dd' }
  const tie = (node: string, port: string, ref: { node: string; handle: string }) => {
    e(ref.node, ref.handle, node, port)
  }
  const ctx: ExprCtx = { nodes, edges, ids: [], n: 0 }
  // sequencer → registers/counters
  e('seq', 'r_clear', 'rreg', 'clear')
  e('seq', 'r_bringdown', 'rreg', 'entry_append')
  e('seq', 'r_sub', 'rreg', 'compute')
  e('seq', 'q_clear', 'qreg', 'clear')
  e('seq', 'q_store', 'qreg', 'entry_append')
  e('seq', 'a_load', 'areg', 'compute')
  e('seq', 'a_shift', 'areg', 'entry_append')
  e('seq', 'outer_load', 'outer', 'load')
  e('seq', 'outer_dec', 'outer', 'en')
  e('seq', 'count_load0', 'count', 'load')
  e('seq', 'count_inc', 'count', 'en')
  // data paths
  for (let b = 0; b < 4; b++) {
    e('areg', `entry${36 + b}`, 'rreg', `keypad${b}`) // dividend's top digit → R bring-down
    e('count', `q${b}`, 'qreg', `keypad${b}`) // quotient-digit count → Q store
  }
  for (let i = 0; i < 40; i++) {
    e('rreg', `entry${i}`, 'alu', `a${i}`) // R → ALU a
    e('alu', `s${i}`, 'rreg', `result${i}`) // ALU (R−B) → R compute-load
  }
  e('alu', 'cout', 'seq', 'cout') // R ≥ B
  e('outer', 'tc', 'seq', 'outer_tc') // 10 digits done → finish
  // constants / unused controls
  tie('alu', 'sub', HIGH) // subtract
  tie('areg', 'entry_new', LOW)
  tie('areg', 'clear', LOW)
  for (let b = 0; b < 4; b++) tie('areg', `keypad${b}`, LOW) // dividend shifts inserting 0
  tie('rreg', 'entry_new', LOW)
  tie('qreg', 'entry_new', LOW)
  for (let b = 0; b < 4; b++) tie('count', `l${b}`, LOW) // up-counter loads 0
  // outer loads 10 dividend digits + K extra fractional bring-downs (K=0 → integer, K=4 → 4 dp for the calc)
  const outerLoad = 10 + extraFractional
  for (let b = 0; b < 4; b++) tie('outer', `l${b}`, ((outerLoad >> b) & 1) === 1 ? HIGH : LOW)
  // zero-divisor detector: NOR of all B bits → divzero (so the sequencer can finish with an error)
  const bz = orReduce(
    Array.from({ length: 40 }, (_, i) => ({ node: 'alu', handle: `b${i}` })),
    'bz',
    13000,
  )
  nodes.push(...bz.nodes)
  edges.push(...bz.edges)
  nodes.push({ id: 'bzero_inv', definition: 'block', x: 13600, y: 0, block: INVERTER_BLOCK })
  e(bz.out.node, bz.out.handle, 'bzero_inv', 'in')
  e('bzero_inv', 'out', 'seq', 'divzero')
  // QUOTIENT-OVERFLOW latch: with K extra fractional bring-downs an integer quotient of 7+ digits would
  // shift its top digits off the 10-digit Q register. Catch a nonzero top digit AT the STOREQ shift and
  // latch it (sticky, cleared with the quotient) so the calculator shows E, not a silently truncated answer.
  nodes.push({ id: 'qovf', definition: 'block', x: 7000, y: 32000, block: D_FLIPFLOP_BLOCK })
  const qTop = buildExpr(
    [
      'or',
      ['or', { node: 'qreg', handle: 'entry36' }, { node: 'qreg', handle: 'entry37' }],
      ['or', { node: 'qreg', handle: 'entry38' }, { node: 'qreg', handle: 'entry39' }],
    ],
    ctx,
  )
  const qovfNow = buildExpr(['and', { node: 'seq', handle: 'q_store' }, qTop], ctx)
  const qovfD = buildExpr(
    [
      'or',
      qovfNow,
      ['and', { node: 'qovf', handle: 'q' }, ['not', { node: 'seq', handle: 'q_clear' }]],
    ],
    ctx,
  )
  e(qovfD.node, qovfD.handle, 'qovf', 'd')
  // shared clock
  for (const blk of ['areg', 'rreg', 'qreg', 'count', 'outer', 'qovf']) e('seq', 'clk', blk, 'clk')
  edges.push(
    ...chainRails(
      [
        'seq',
        'areg',
        'rreg',
        'qreg',
        'count',
        'outer',
        'alu',
        'qovf',
        ...bz.ids,
        'bzero_inv',
        ...ctx.ids,
      ],
      'div',
    ),
  )

  const ports: BlockData['ports'] = []
  let left = 14
  for (let i = 0; i < 40; i++) {
    ports.push({
      id: `a${i}`,
      label: `A${i}`,
      side: 'left',
      offset: left,
      inner: { nodeId: 'areg', handleId: `result${i}` },
    })
    left += 6
  }
  for (let i = 0; i < 40; i++) {
    ports.push({
      id: `b${i}`,
      label: `B${i}`,
      side: 'left',
      offset: left,
      inner: { nodeId: 'alu', handleId: `b${i}` },
    })
    left += 6
  }
  ports.push({
    id: 'start',
    label: 'START',
    side: 'left',
    offset: left,
    inner: { nodeId: 'seq', handleId: 'start' },
  })
  left += 12
  ports.push({
    id: 'clear',
    label: 'CLR',
    side: 'left',
    offset: left,
    inner: { nodeId: 'seq', handleId: 'clear' },
  })
  left += 12
  ports.push({
    id: 'clk',
    label: 'CLK',
    side: 'left',
    offset: left,
    inner: { nodeId: 'seq', handleId: 'clk' },
  })
  left += 12
  ports.push({
    id: 'gnd',
    label: 'GND',
    side: 'left',
    offset: left,
    inner: { nodeId: 'areg', handleId: 'gnd' },
  })
  let right = 14
  for (let i = 0; i < 40; i++) {
    ports.push({
      id: `quotient${i}`,
      label: `Q${i}`,
      side: 'right',
      offset: right,
      inner: { nodeId: 'qreg', handleId: `entry${i}` },
    })
    right += 6
  }
  for (let i = 0; i < 40; i++) {
    ports.push({
      id: `remainder${i}`,
      label: `R${i}`,
      side: 'right',
      offset: right,
      inner: { nodeId: 'rreg', handleId: `entry${i}` },
    })
    right += 6
  }
  ports.push({
    id: 'done',
    label: 'DONE',
    side: 'right',
    offset: right,
    inner: { nodeId: 'seq', handleId: 'done' },
  })
  right += 12
  ports.push({
    id: 'error',
    label: 'ERR',
    side: 'right',
    offset: right,
    inner: { nodeId: 'seq', handleId: 'error' },
  })
  right += 12
  ports.push({
    id: 'overflow',
    label: 'OVF',
    side: 'right',
    offset: right,
    inner: { nodeId: 'qovf', handleId: 'q' },
  })
  right += 12
  ports.push({
    id: 'v_dd',
    label: 'V+',
    side: 'right',
    offset: right,
    inner: { nodeId: 'areg', handleId: 'v_dd' },
  })
  return { name: 'Divider (A ÷ B)', origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** A ÷ B over 10 BCD digits, as a real clocked datapath (sequencer + reused registers/counters/ALU). */
export const DIVIDER_10: BlockData = buildDivider()

/** The same divider with K=4 extra fractional bring-down steps — the calculator's decimal divider (the
 *  quotient carries 4 extra low digits; the calculator normalizes trailing zeros + tracks the point). */
export const DIVIDER_10_FP: BlockData = buildDivider(4)

/**
 * ×/÷ BUSY HANDSHAKE — the bridge between the single-cycle main FSM and the multi-cycle multiply/divide
 * sequencers. When the main FSM raises COMPUTE with a ×/÷ op, this pulses the matching sequencer's START
 * and latches BUSY; BUSY holds (so the main FSM parks and ignores keys) until the sequencer raises DONE,
 * at which point CAPTURE pulses (to write the product/quotient into the registers) and BUSY clears.
 *   START_MUL = COMPUTE and IS_MUL and not BUSY ; START_DIV = COMPUTE and IS_DIV and not BUSY
 *   BUSY'     = START_MUL or START_DIV or (BUSY and not SEQ_DONE)
 *   CAPTURE   = BUSY and SEQ_DONE
 * Descend for the flip-flop + gates.
 */
function buildMuldivController(): BlockData {
  const nodes: BlockData['nodes'] = []
  const edges: BlockData['edges'] = []
  const ports: BlockData['ports'] = []
  const rail: string[] = []
  const ctx: ExprCtx = { nodes, edges, ids: [], n: 0 }
  let li = 0
  const link = (from: LogicRef, to: LogicRef) => {
    edges.push({
      id: `mc${li++}`,
      source: from.node,
      sourceHandle: from.handle,
      target: to.node,
      targetHandle: to.handle,
    })
  }
  const inputs = ['compute', 'is_mul', 'is_div', 'seq_done']
  inputs.forEach((s, i) => {
    nodes.push({ id: `ib_${s}`, definition: 'block', x: -300, y: i * 200, block: BUFFER_BLOCK })
    rail.push(`ib_${s}`)
  })
  const IN = (s: string): LogicRef => ({ node: `ib_${s}`, handle: 'out' })
  nodes.push({ id: 'ff_busy', definition: 'block', x: 2200, y: 0, block: D_FLIPFLOP_BLOCK })
  rail.push('ff_busy')
  const BUSY: LogicRef = { node: 'ff_busy', handle: 'q' }
  const COMPUTE = IN('compute')
  const ISMUL = IN('is_mul')
  const ISDIV = IN('is_div')
  const SEQDONE = IN('seq_done')

  const startMul = buildExpr(['and', ['and', COMPUTE, ISMUL], ['not', BUSY]], ctx)
  const startDiv = buildExpr(['and', ['and', COMPUTE, ISDIV], ['not', BUSY]], ctx)
  const capture = buildExpr(['and', BUSY, SEQDONE], ctx)
  link(buildExpr(['or', ['or', startMul, startDiv], ['and', BUSY, ['not', SEQDONE]]], ctx), {
    node: 'ff_busy',
    handle: 'd',
  })
  rail.push(...ctx.ids)
  edges.push(...chainRails(rail, 'mdc'))

  let left = 14
  for (const s of inputs) {
    ports.push({
      id: s,
      label: s.toUpperCase(),
      side: 'left',
      offset: left,
      inner: { nodeId: `ib_${s}`, handleId: 'in' },
    })
    left += 14
  }
  ports.push({
    id: 'clk',
    label: 'CLK',
    side: 'left',
    offset: left,
    inner: { nodeId: 'ff_busy', handleId: 'clk' },
  })
  left += 14
  ports.push({
    id: 'gnd',
    label: 'GND',
    side: 'left',
    offset: left,
    inner: { nodeId: 'ff_busy', handleId: 'gnd' },
  })
  const out: Array<[string, LogicRef]> = [
    ['start_mul', startMul],
    ['start_div', startDiv],
    ['capture', capture],
    ['busy', BUSY],
  ]
  let right = 14
  for (const [id, ref] of out) {
    ports.push({
      id,
      label: id.toUpperCase(),
      side: 'right',
      offset: right,
      inner: { nodeId: ref.node, handleId: ref.handle },
    })
    right += 12
  }
  ports.push({
    id: 'v_dd',
    label: 'V+',
    side: 'right',
    offset: right,
    inner: { nodeId: 'ff_busy', handleId: 'v_dd' },
  })
  return { name: 'Mul/Div Controller', origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** The ×/÷ busy-handshake controller (start the sequencer, hold BUSY until done, then capture). */
export const MULDIV_CONTROLLER: BlockData = buildMuldivController()

/**
 * CALCULATOR (the whole 4-function machine, real gates all the way down) — encoder + control FSM +
 * ×/÷ busy-controller + ENTRY/ACC registers + the +/− ALU + the multiplier + the divider, wired together.
 *   • +/− run as one combinational ALU pass on COMPUTE.
 *   • × and ÷ run as clocked loops: the FSM's COMPUTE with a ×/÷ op makes the controller START the matching
 *     sequencer and hold BUSY; the calc keeps clocking until the sequencer's DONE, then CAPTURE writes the
 *     result back. (Drive it: press a key = one clock, then keep clocking while BUSY.)
 *   • A 3-way result mux feeds the registers: ALU sum (+/−) / product (×) / quotient (÷), chosen by the
 *     latched op; the register load fires on (COMPUTE·(+|−)) OR CAPTURE.
 * Outputs: ENTRY0..39 (the displayed value), ERROR (divide by zero), BUSY. ~9000 gates. Descend for it all.
 */
function buildCalculator(): BlockData {
  const nodes: BlockData['nodes'] = [
    { id: 'enc', definition: 'block', x: 0, y: 0, block: KEYPAD_ENCODER_BLOCK },
    { id: 'fsm', definition: 'block', x: 2400, y: 0, block: CALC_CONTROL_FSM },
    { id: 'ctrl', definition: 'block', x: 5000, y: 0, block: MULDIV_CONTROLLER },
    { id: 'ent', definition: 'block', x: 7200, y: 0, block: ENTRY_REGISTER_10 },
    { id: 'acc', definition: 'block', x: 7200, y: 16000, block: ACC_REGISTER_10 },
    { id: 'alu', definition: 'block', x: 11000, y: 0, block: BCD_ALU_10 },
    { id: 'mul', definition: 'block', x: 11000, y: 32000, block: MULTIPLIER_10 },
    { id: 'div', definition: 'block', x: 11000, y: 64000, block: DIVIDER_10_FP },
    { id: 'rnalu', definition: 'block', x: 16000, y: 0, block: BCD_ALU_10 }, // negate the ALU result: 0 − aluS = B−A (the |A|<|B| difference case)
  ]
  const edges: BlockData['edges'] = []
  let ei = 0
  const e = (s: string, sh: string, t: string, th: string) => {
    edges.push({ id: `c${ei++}`, source: s, sourceHandle: sh, target: t, targetHandle: th })
  }
  const ctx: ExprCtx = { nodes, edges, ids: [], n: 0 }
  const rail: string[] = ['enc', 'fsm', 'ctrl', 'ent', 'acc', 'alu', 'mul', 'div', 'rnalu']
  const link = (from: LogicRef, to: LogicRef) => e(from.node, from.handle, to.node, to.handle)
  const LOW: LogicRef = { node: 'enc', handle: 'gnd' }
  const HIGH: LogicRef = { node: 'enc', handle: 'v_dd' }
  const tie = (node: string, port: string, ref: LogicRef) => link(ref, { node, handle: port })
  let mi = 0
  const newMux = (sel: LogicRef, x: LogicRef, y: LogicRef): LogicRef => {
    const id = `rm${mi}`
    nodes.push({
      id,
      definition: 'block',
      x: 14000 + (mi % 8) * 400,
      y: Math.floor(mi / 8) * 200,
      block: MUX2_1BIT,
    })
    mi++
    rail.push(id)
    link(sel, { node: id, handle: 'sel' })
    link(x, { node: id, handle: 'x' })
    link(y, { node: id, handle: 'y' })
    return { node: id, handle: 'out' }
  }
  const orAll = (refs: LogicRef[]): LogicRef =>
    refs.reduce((acc, r) => buildExpr(['or', acc, r], ctx))
  // 4-bit binary subtract a − b → { diff[4], borrow } ; borrow-out = (a < b).
  const sub4 = (a: LogicRef[], b: LogicRef[]): { diff: LogicRef[]; borrow: LogicRef } => {
    const diff: LogicRef[] = []
    let bin: LogicRef = LOW
    for (let i = 0; i < 4; i++) {
      const ai = a[i] ?? LOW
      const bi = b[i] ?? LOW
      diff.push(buildExpr(['xor', ['xor', ai, bi], bin], ctx))
      bin = buildExpr(
        ['or', ['or', ['and', ['not', ai], bi], ['and', ['not', ai], bin]], ['and', bi, bin]],
        ctx,
      )
    }
    return { diff, borrow: bin }
  }
  // 4-bit binary add a + b → { sum[4], carry } (the 5th bit). Used for the multiply point position Fa+Fb.
  const add4 = (a: LogicRef[], b: LogicRef[]): { sum: LogicRef[]; carry: LogicRef } => {
    const sum: LogicRef[] = []
    let cin: LogicRef = LOW
    for (let i = 0; i < 4; i++) {
      const ai = a[i] ?? LOW
      const bi = b[i] ?? LOW
      sum.push(buildExpr(['xor', ['xor', ai, bi], cin], ctx))
      cin = buildExpr(['or', ['or', ['and', ai, bi], ['and', ai, cin]], ['and', bi, cin]], ctx)
    }
    return { sum, carry: cin }
  }
  // BARREL-SHIFT a 10-digit BCD magnitude UP by dF digit positions (×10^dF): 4 log-stages (shift 1,2,4,8
  // digits = 4,8,16,32 bits), each gated by a dF bit; bits pushed past the top digit become overflow.
  const shiftUp = (
    inRefs: LogicRef[],
    dfBits: LogicRef[],
  ): { out: LogicRef[]; overflow: LogicRef } => {
    let cur = inRefs
    let ovf: LogicRef = LOW
    for (let s = 0; s < 4; s++) {
      const shiftBits = 4 * (1 << s)
      const sel = dfBits[s] ?? LOW
      ovf = buildExpr(
        ['or', ovf, buildExpr(['and', sel, orAll(cur.slice(40 - shiftBits))], ctx)],
        ctx,
      )
      const next: LogicRef[] = []
      for (let i = 0; i < 40; i++) {
        const from = i - shiftBits
        const lower = from >= 0 ? (cur[from] ?? LOW) : LOW
        next.push(newMux(sel, lower, cur[i] ?? LOW))
      }
      cur = next
    }
    return { out: cur, overflow: ovf }
  }

  // encoder → FSM + entry-digit
  e('enc', 'digit', 'fsm', 'digit')
  e('enc', 'is_op', 'fsm', 'isop')
  e('enc', 'is_eq', 'fsm', 'iseq')
  e('enc', 'is_clr', 'fsm', 'isclr')
  e('enc', 'op0', 'fsm', 'op0')
  e('enc', 'op1', 'fsm', 'op1')
  e('enc', 'is_dot', 'fsm', 'isdp')
  for (let b = 0; b < 4; b++) e('enc', `d${b}`, 'ent', `keypad${b}`)
  // ── REPEAT-EQUALS (real gates): a bare '=' replays the last operation. Capture the op + the 2nd
  // operand on the FIRST '=' (op pending), and on a later bare '=' (no op pending) re-run
  // result <lastOp> lastOperand. Real registers + a held replay-mode flip-flop, NO code.
  const CAP_EQ = buildExpr(
    ['and', { node: 'enc', handle: 'is_eq' }, { node: 'fsm', handle: 'st_opvalid' }],
    ctx,
  )
  const REPLAY = buildExpr(
    ['and', { node: 'enc', handle: 'is_eq' }, ['not', { node: 'fsm', handle: 'st_opvalid' }]],
    ctx,
  )
  // REPLAY is a one-cycle Mealy pulse; a ×/÷ runs MANY cycles, so HOLD a replay-active flip-flop across
  // the busy window (else the operand muxes revert mid-sequence and the result corrupts). The unified
  // REPLAY_SEL (pulse OR held) drives every replay mux for the whole sequence.
  nodes.push({
    id: 'replayActive',
    definition: 'block',
    x: 20000,
    y: 8000,
    block: D_FLIPFLOP_BLOCK,
  })
  link(
    buildExpr(
      [
        'or',
        REPLAY,
        ['and', { node: 'replayActive', handle: 'q' }, { node: 'ctrl', handle: 'busy' }],
      ],
      ctx,
    ),
    { node: 'replayActive', handle: 'd' },
  )
  const REPLAY_SEL = buildExpr(['or', REPLAY, { node: 'replayActive', handle: 'q' }], ctx)
  // LAST-OP: two recirculating D-FFs, loaded with the latched op on CAP_EQ.
  nodes.push({ id: 'lop0', definition: 'block', x: 20000, y: 9000, block: D_FLIPFLOP_BLOCK })
  nodes.push({ id: 'lop1', definition: 'block', x: 20000, y: 10000, block: D_FLIPFLOP_BLOCK })
  link(newMux(CAP_EQ, { node: 'fsm', handle: 'st_op0' }, { node: 'lop0', handle: 'q' }), {
    node: 'lop0',
    handle: 'd',
  })
  link(newMux(CAP_EQ, { node: 'fsm', handle: 'st_op1' }, { node: 'lop1', handle: 'q' }), {
    node: 'lop1',
    handle: 'd',
  })
  // LAST-OPERAND: latch ENTRY (the 2nd operand) on CAP_EQ — an ENTRY_REGISTER_10 used as a plain latch.
  nodes.push({ id: 'lopd', definition: 'block', x: 20000, y: 11000, block: ENTRY_REGISTER_10 })
  tie('lopd', 'entry_new', LOW)
  tie('lopd', 'entry_append', LOW)
  tie('lopd', 'clear', LOW)
  for (let b = 0; b < 4; b++) tie('lopd', `keypad${b}`, LOW)
  link(CAP_EQ, { node: 'lopd', handle: 'compute' })
  for (let i = 0; i < 40; i++) e('ent', `entry${i}`, 'lopd', `result${i}`)
  // Effective op = the latched-op decode while replaying, else the FSM's op (same 2-bit code as the FSM:
  // +=00, −=01, ×=10, ÷=11).
  const rAdd = buildExpr(
    ['and', ['not', { node: 'lop0', handle: 'q' }], ['not', { node: 'lop1', handle: 'q' }]],
    ctx,
  )
  const rSub = buildExpr(
    ['and', { node: 'lop0', handle: 'q' }, ['not', { node: 'lop1', handle: 'q' }]],
    ctx,
  )
  const rMul = buildExpr(
    ['and', ['not', { node: 'lop0', handle: 'q' }], { node: 'lop1', handle: 'q' }],
    ctx,
  )
  const rDiv = buildExpr(['and', { node: 'lop0', handle: 'q' }, { node: 'lop1', handle: 'q' }], ctx)
  const effAdd = newMux(REPLAY_SEL, rAdd, { node: 'fsm', handle: 'alu_add' })
  const effSub = newMux(REPLAY_SEL, rSub, { node: 'fsm', handle: 'alu_sub' })
  const effMul = newMux(REPLAY_SEL, rMul, { node: 'fsm', handle: 'alu_mul' })
  const effDiv = newMux(REPLAY_SEL, rDiv, { node: 'fsm', handle: 'alu_div' })

  // FSM (or a replay) → controller; controller → sequencers
  link(buildExpr(['or', { node: 'fsm', handle: 'compute' }, REPLAY], ctx), {
    node: 'ctrl',
    handle: 'compute',
  })
  link(effMul, { node: 'ctrl', handle: 'is_mul' })
  link(effDiv, { node: 'ctrl', handle: 'is_div' })
  e('ctrl', 'start_mul', 'mul', 'start')
  e('ctrl', 'start_div', 'div', 'start')
  // operands: normally A = ACC, B = ENTRY; on a REPLAY A = ENTRY (the shown result) and B = the saved
  // last operand. The raw magnitude muxes feed the multiplier + divider directly; the ALU instead gets
  // the DECIMAL-ALIGNED operands (built below). ENTRY → ACC stays the acc_from_entry copy source.
  const aSel: LogicRef[] = []
  const bSel: LogicRef[] = []
  for (let i = 0; i < 40; i++) {
    const a = newMux(
      REPLAY_SEL,
      { node: 'ent', handle: `entry${i}` },
      { node: 'acc', handle: `acc${i}` },
    )
    const b = newMux(
      REPLAY_SEL,
      { node: 'lopd', handle: `entry${i}` },
      { node: 'ent', handle: `entry${i}` },
    )
    aSel.push(a)
    bSel.push(b)
    for (const blk of ['mul', 'div']) {
      link(a, { node: blk, handle: `a${i}` })
      link(b, { node: blk, handle: `b${i}` })
    }
    e('ent', `entry${i}`, 'acc', `entry${i}`)
  }
  // ── FLOATING-POINT ALIGNMENT for +/−: each number carries a 4-bit point position F (Fe = the fent
  // counter; Fa = ACC's, NEW; Flopd = the saved last operand's, NEW). Before the ALU, shift the
  // smaller-F operand's magnitude UP so both share F = max(Fa,Fb); the multiplier/divider keep the raw
  // magnitudes. The point lands at the larger F. A digit pushed past the top → precision lost → E.
  for (let b = 0; b < 4; b++) {
    nodes.push({ id: `Fa${b}`, definition: 'block', x: 26000, y: b * 800, block: D_FLIPFLOP_BLOCK })
    nodes.push({
      id: `Flopd${b}`,
      definition: 'block',
      x: 27000,
      y: b * 800,
      block: D_FLIPFLOP_BLOCK,
    })
  }
  const Fe: LogicRef[] = [0, 1, 2, 3].map((b) => ({ node: 'fent', handle: `q${b}` }))
  const Faeff = [0, 1, 2, 3].map((b) =>
    newMux(REPLAY_SEL, Fe[b] ?? LOW, { node: `Fa${b}`, handle: 'q' }),
  )
  const Fbeff = [0, 1, 2, 3].map((b) =>
    newMux(REPLAY_SEL, { node: `Flopd${b}`, handle: 'q' }, Fe[b] ?? LOW),
  )
  const { diff: diffAB, borrow: lessAB } = sub4(Faeff, Fbeff) // lessAB = (Fa < Fb)
  const { diff: diffBA } = sub4(Fbeff, Faeff)
  const dF = [0, 1, 2, 3].map((b) => newMux(lessAB, diffBA[b] ?? LOW, diffAB[b] ?? LOW)) // |Fa−Fb|
  const shifterIn = aSel.map((a, i) => newMux(lessAB, a, bSel[i] ?? LOW)) // the smaller-F magnitude
  const { out: shifted, overflow: shiftOverflow } = shiftUp(shifterIn, dF)
  for (let i = 0; i < 40; i++) {
    link(newMux(lessAB, shifted[i] ?? LOW, aSel[i] ?? LOW), { node: 'alu', handle: `a${i}` })
    link(newMux(lessAB, bSel[i] ?? LOW, shifted[i] ?? LOW), { node: 'alu', handle: `b${i}` })
  }
  const resultF_addsub = [0, 1, 2, 3].map((b) => newMux(lessAB, Fbeff[b] ?? LOW, Faeff[b] ?? LOW)) // max
  // multiply point position = Fa + Fb (5-bit, carry kept); >10 fractional places can't be shown → E.
  const { sum: Fsum, carry: Fcarry } = add4(Faeff, Fbeff)
  const fSumGt10 = buildExpr(
    [
      'or',
      Fcarry,
      ['and', Fsum[3] ?? LOW, ['or', Fsum[2] ?? LOW, ['and', Fsum[1] ?? LOW, Fsum[0] ?? LOW]]],
    ],
    ctx,
  )
  // ── DECIMAL ÷: the divider runs K=4 extra fractional bring-downs, so its quotient carries up to 4 extra
  // low digits and the result point F = Fa − Fb + K. Normalize away trailing zeros (100/4 → 25, not
  // 25.0000) and refuse (E) if the result would need <0 or >10 fractional places.
  const fourVec: LogicRef[] = [LOW, LOW, HIGH, LOW] // binary 4
  const oneVec: LogicRef[] = [HIGH, LOW, LOW, LOW] // binary 1
  const { sum: FaPlus4 } = add4(Faeff, fourVec)
  const { diff: rawDivF, borrow: divFNeg } = sub4(FaPlus4, Fbeff) // (Fa+4) − Fb ; borrow ⟹ result F < 0
  const normalizeDown = (q: LogicRef[], f: LogicRef[]): { q: LogicRef[]; f: LogicRef[] } => {
    let cq = q
    let cf = f
    for (let s = 0; s < 4; s++) {
      const d0zero = buildExpr(['not', orAll(cq.slice(0, 4))], ctx) // low BCD digit is 0
      const doShift = buildExpr(['and', d0zero, orAll(cf)], ctx) // … and F>0 → drop it (÷10), F−−
      const nq: LogicRef[] = []
      for (let i = 0; i < 40; i++)
        nq.push(newMux(doShift, i + 4 < 40 ? (cq[i + 4] ?? LOW) : LOW, cq[i] ?? LOW))
      const { diff: fdec } = sub4(cf, oneVec)
      cf = [0, 1, 2, 3].map((b) => newMux(doShift, fdec[b] ?? LOW, cf[b] ?? LOW))
      cq = nq
    }
    return { q: cq, f: cf }
  }
  const divQ: LogicRef[] = []
  for (let i = 0; i < 40; i++) divQ.push({ node: 'div', handle: `quotient${i}` })
  const { q: normQ, f: normF } = normalizeDown(divQ, rawDivF)
  const divFGt10 = buildExpr(
    ['and', normF[3] ?? LOW, ['or', normF[2] ?? LOW, ['and', normF[1] ?? LOW, normF[0] ?? LOW]]],
    ctx,
  )
  // ── SIGN-MAGNITUDE sign tracking. Each number is an UNSIGNED 10-digit magnitude + an explicit sign
  // bit (Se = ENTRY, Sa = ACC), so the full ±9,999,999,999 range is usable (the ten's-complement
  // half-range is gone). Slopd = the saved last-operand sign for repeat-equals (parallels lopd).
  nodes.push({ id: 'Se', definition: 'block', x: 24000, y: 0, block: D_FLIPFLOP_BLOCK })
  nodes.push({ id: 'Sa', definition: 'block', x: 24000, y: 1000, block: D_FLIPFLOP_BLOCK })
  nodes.push({ id: 'Slopd', definition: 'block', x: 24000, y: 2000, block: D_FLIPFLOP_BLOCK })
  // operand signs mirror the magnitude muxes (same REPLAY_SEL): normally A = ACC, B = ENTRY; on a
  // REPLAY A = ENTRY (the shown result), B = the saved last operand.
  const Asign = newMux(REPLAY_SEL, { node: 'Se', handle: 'q' }, { node: 'Sa', handle: 'q' })
  const Bsign = newMux(REPLAY_SEL, { node: 'Slopd', handle: 'q' }, { node: 'Se', handle: 'q' })
  // subtracting B = adding (−B); the ALU adds when the effective signs match, subtracts when they differ.
  const effBsign = buildExpr(['xor', Bsign, effSub], ctx)
  const sameSign = buildExpr(['not', ['xor', Asign, effBsign]], ctx)
  const diffSign = buildExpr(['xor', Asign, effBsign], ctx)
  link(diffSign, { node: 'alu', handle: 'sub' }) // same sign → A+B ; diff sign → A−B (cout = |A|≥|B|)
  // diff sign AND |A|<|B| → the ALU gave the ten's-complement of (B−A); negate it (rnalu) for the magnitude.
  const needNegate = buildExpr(['and', diffSign, ['not', { node: 'alu', handle: 'cout' }]], ctx)
  // FSM → register control
  e('fsm', 'entry_new', 'ent', 'entry_new')
  e('fsm', 'entry_append', 'ent', 'entry_append')
  e('fsm', 'clear', 'ent', 'clear')
  e('fsm', 'acc_from_entry', 'acc', 'acc_from_entry')
  e('fsm', 'clear', 'acc', 'clear')
  // seq_done = mul.done OR div.done → controller
  link(buildExpr(['or', { node: 'mul', handle: 'done' }, { node: 'div', handle: 'done' }], ctx), {
    node: 'ctrl',
    handle: 'seq_done',
  })
  // register result-load = (COMPUTE and a +/− op) OR CAPTURE
  const computeAddSub = buildExpr(
    [
      'and',
      { node: 'fsm', handle: 'compute' },
      ['or', { node: 'fsm', handle: 'alu_add' }, { node: 'fsm', handle: 'alu_sub' }],
    ],
    ctx,
  )
  // load result → ENTRY+ACC on a normal +/− compute, a ×/÷ capture, OR a replayed +/−.
  const loadReplayAddSub = buildExpr(['and', REPLAY, ['or', effAdd, effSub]], ctx)
  const load = buildExpr(
    ['or', ['or', computeAddSub, { node: 'ctrl', handle: 'capture' }], loadReplayAddSub],
    ctx,
  )
  // result point position: +/− → max(Fa,Fb) for now (×/÷ point math lands in later steps). Loaded into
  // Fe (the fent counter, below) and Fa on a result. Fa ← Fe on acc_from_entry; Flopd ← Fe on CAP_EQ.
  const resultF = [0, 1, 2, 3].map((b) =>
    newMux(effDiv, normF[b] ?? LOW, newMux(effMul, Fsum[b] ?? LOW, resultF_addsub[b] ?? LOW)),
  ) // ÷ → (Fa−Fb+K) normalized ; × → Fa+Fb ; +/− → max(Fa,Fb)
  for (let b = 0; b < 4; b++) {
    const faCopy = newMux({ node: 'fsm', handle: 'acc_from_entry' }, Fe[b] ?? LOW, {
      node: `Fa${b}`,
      handle: 'q',
    })
    const faLoad = newMux(load, resultF[b] ?? LOW, faCopy)
    link(newMux({ node: 'fsm', handle: 'clear' }, LOW, faLoad), { node: `Fa${b}`, handle: 'd' })
    link(newMux(CAP_EQ, Fe[b] ?? LOW, { node: `Flopd${b}`, handle: 'q' }), {
      node: `Flopd${b}`,
      handle: 'd',
    })
  }
  // result-negate ALU: 0 − aluS = (B−A) magnitude, for the diff-sign |A|<|B| case (needNegate).
  tie('rnalu', 'sub', HIGH)
  for (let i = 0; i < 40; i++) {
    tie('rnalu', `a${i}`, LOW)
    e('alu', `s${i}`, 'rnalu', `b${i}`)
  }
  // magnitude registers load on result-load ONLY; the ± key now touches just the sign bit (Se), never
  // the magnitude. The SAME result bus feeds BOTH ENTRY and ACC.
  link(load, { node: 'ent', handle: 'compute' })
  link(load, { node: 'acc', handle: 'compute' })
  // result-magnitude mux per bit: eff_mul ? product : (eff_div ? quotient : (needNegate ? B−A : A±B)).
  const resultMag: LogicRef[] = []
  for (let i = 0; i < 40; i++) {
    const addsub = newMux(
      needNegate,
      { node: 'rnalu', handle: `s${i}` },
      { node: 'alu', handle: `s${i}` },
    )
    const m1 = newMux(effDiv, normQ[i] ?? LOW, addsub) // ÷ → the trailing-zero-normalized quotient
    const m2 = newMux(effMul, { node: 'mul', handle: `product${i}` }, m1)
    resultMag.push(m2)
    link(m2, { node: 'ent', handle: `result${i}` })
    link(m2, { node: 'acc', handle: `result${i}` })
  }
  // resultIsZero = NOR over the FINAL muxed magnitude (NOT the ALU output — for ×/÷ the ALU still computes
  // a nonzero subtract that would falsely clear this and emit −0). Forbids −0 for every op.
  const resultIsZero = buildExpr(['not', orAll(resultMag)], ctx)
  // result SIGN: ×/÷ = XOR of operand signs ; +/− = A's sign (or B's when |A|<|B| on a difference).
  const rawAddSubSign = newMux(needNegate, effBsign, Asign)
  const xorSign = buildExpr(['xor', Asign, Bsign], ctx)
  const addsubSign = buildExpr(['and', rawAddSubSign, ['not', resultIsZero]], ctx)
  const muldivSign = buildExpr(['and', xorSign, ['not', resultIsZero]], ctx)
  const resultSign = newMux(effMul, muldivSign, newMux(effDiv, muldivSign, addsubSign))
  // SIGN REGISTERS (priority clear > load > {is_pm | acc_from_entry} > entry_new > hold):
  //   Se: ± toggles it, a fresh number zeroes it, a result loads the result sign.
  //   Sa: ← ENTRY's sign when an operator copies ENTRY→ACC; a result loads the result sign.
  //   Slopd: ← ENTRY's sign on the first '=' (CAP_EQ), held otherwise (so chained replays keep it).
  const seHold = newMux({ node: 'fsm', handle: 'entry_new' }, LOW, { node: 'Se', handle: 'q' })
  const sePm = newMux(
    { node: 'enc', handle: 'is_pm' },
    buildExpr(['not', { node: 'Se', handle: 'q' }], ctx),
    seHold,
  )
  const seLoad = newMux(load, resultSign, sePm)
  link(newMux({ node: 'fsm', handle: 'clear' }, LOW, seLoad), { node: 'Se', handle: 'd' })
  const saCopy = newMux(
    { node: 'fsm', handle: 'acc_from_entry' },
    { node: 'Se', handle: 'q' },
    { node: 'Sa', handle: 'q' },
  )
  const saLoad = newMux(load, resultSign, saCopy)
  link(newMux({ node: 'fsm', handle: 'clear' }, LOW, saLoad), { node: 'Sa', handle: 'd' })
  link(newMux(CAP_EQ, { node: 'Se', handle: 'q' }, { node: 'Slopd', handle: 'q' }), {
    node: 'Slopd',
    handle: 'd',
  })
  // Any new key activity (clear / operator / digit) clears the sticky error — both the divider's own
  // div-by-zero latch and the top-level error latch (below), so the two never desync.
  const anyNewKey = buildExpr(
    [
      'or',
      ['or', { node: 'fsm', handle: 'clear' }, { node: 'fsm', handle: 'op_latch' }],
      { node: 'enc', handle: 'digit' },
    ],
    ctx,
  )
  link(anyNewKey, { node: 'div', handle: 'clear' })
  // TOP-LEVEL STICKY ERROR (the "E"): a result that can't be shown. Magnitudes are now UNSIGNED, so an
  // add/subtract overflows only when two same-sign operands carry out of the top digit (a TRUE >10-digit
  // sum); a difference never overflows. A × overflows when the product needs >10 digits. ÷0 is the
  // divider's error. CLEAR DOMINATES the latch's D so any new key truly clears it.
  nodes.push({ id: 'ff_err', definition: 'block', x: 22000, y: 0, block: D_FLIPFLOP_BLOCK })
  rail.push('ff_err')
  const addSubSample = buildExpr(['or', computeAddSub, loadReplayAddSub], ctx)
  const addSubOvf = buildExpr(
    ['and', addSubSample, ['and', sameSign, { node: 'alu', handle: 'cout' }]],
    ctx,
  )
  const mulOvf = buildExpr(
    [
      'and',
      ['and', { node: 'ctrl', handle: 'capture' }, effMul],
      { node: 'mul', handle: 'overflow' },
    ],
    ctx,
  )
  // FP errors: precision lost during +/− alignment (a digit shifted off the top); a × whose point would
  // need >10 fractional places (Fa+Fb>10); and a not-yet-built decimal ÷ (refuse with E until that step).
  const shiftOvfErr = buildExpr(['and', addSubSample, shiftOverflow], ctx)
  const mulFovf = buildExpr(
    ['and', ['and', { node: 'ctrl', handle: 'capture' }, effMul], fSumGt10],
    ctx,
  )
  // ÷ errors: a result needing <0 or >10 fractional places (divFNeg / divFGt10), plus the divider's own
  // quotient-overflow (a >10-digit integer quotient) and ÷0 (div.error).
  const divResultErr = buildExpr(
    ['and', ['and', { node: 'ctrl', handle: 'capture' }, effDiv], ['or', divFNeg, divFGt10]],
    ctx,
  )
  const newErr = buildExpr(
    [
      'or',
      ['or', ['or', addSubOvf, shiftOvfErr], ['or', mulOvf, ['or', mulFovf, divResultErr]]],
      ['or', { node: 'div', handle: 'error' }, { node: 'div', handle: 'overflow' }],
    ],
    ctx,
  )
  link(
    buildExpr(['and', ['not', anyNewKey], ['or', newErr, { node: 'ff_err', handle: 'q' }]], ctx),
    { node: 'ff_err', handle: 'd' },
  )
  // sign-magnitude display: the shown digits ARE the ENTRY magnitude directly; NEG is the explicit sign
  // (Se), suppressed when the magnitude is zero so a bare 0 never shows a minus.
  const entryBits: LogicRef[] = []
  for (let i = 0; i < 40; i++) entryBits.push({ node: 'ent', handle: `entry${i}` })
  const meIsZero = buildExpr(['not', orAll(entryBits)], ctx)
  const negOut = buildExpr(['and', { node: 'Se', handle: 'q' }, ['not', meIsZero]], ctx)
  const display: LogicRef[] = []
  for (let i = 0; i < 40; i++) display.push({ node: 'ent', handle: `entry${i}` })
  // F_ent — the ENTRY register's decimal-point position (floating point): a 4-bit up-counter holding
  // how many of the 10 significand digits are fractional. The point sits between digit F−1 and digit
  // F; value = significand × 10^−F. It resets to 0 at the start of a number (entry_new or clear) and
  // counts up once per digit typed AFTER the "." (an entry_append while dp_seen). The significand
  // register itself is unchanged — floating point is the integer significand we already have PLUS this
  // position counter, so 1,5 means 15 (F=0), 1.5 (F=1) or 0.15 (F=2) depending only on F.
  nodes.push({ id: 'fent', definition: 'block', x: 18000, y: 0, block: COUNTER_UP_EN_4 })
  rail.push('fent')
  // fent loads 0 at the start of a number (entry_new|clear) and loads the result's F on a compute (load).
  for (let b = 0; b < 4; b++)
    link(newMux(load, resultF[b] ?? LOW, LOW), { node: 'fent', handle: `l${b}` })
  link(
    buildExpr(
      ['or', ['or', { node: 'fsm', handle: 'entry_new' }, { node: 'fsm', handle: 'clear' }], load],
      ctx,
    ),
    { node: 'fent', handle: 'load' },
  )
  link(
    buildExpr(['and', { node: 'fsm', handle: 'entry_append' }, { node: 'fsm', handle: 'dp' }], ctx),
    { node: 'fent', handle: 'en' },
  )
  // shared clock
  for (const blk of [
    'ent',
    'acc',
    'ctrl',
    'mul',
    'div',
    'fent',
    'ff_err',
    'lopd',
    'lop0',
    'lop1',
    'replayActive',
    'Se',
    'Sa',
    'Slopd',
    'Fa0',
    'Fa1',
    'Fa2',
    'Fa3',
    'Flopd0',
    'Flopd1',
    'Flopd2',
    'Flopd3',
  ])
    e('fsm', 'clk', blk, 'clk')
  rail.push('lopd', 'lop0', 'lop1', 'replayActive', 'Se', 'Sa', 'Slopd')
  rail.push('Fa0', 'Fa1', 'Fa2', 'Fa3', 'Flopd0', 'Flopd1', 'Flopd2', 'Flopd3')
  rail.push(...ctx.ids)
  edges.push(...chainRails(rail, 'calc'))

  const ports: BlockData['ports'] = []
  const keys = [
    'k0',
    'k1',
    'k2',
    'k3',
    'k4',
    'k5',
    'k6',
    'k7',
    'k8',
    'k9',
    'kadd',
    'ksub',
    'kmul',
    'kdiv',
    'keq',
    'kclr',
    'kpm',
    'kdot',
  ]
  let left = 14
  for (const k of keys) {
    ports.push({
      id: k,
      label: k.toUpperCase(),
      side: 'left',
      offset: left,
      inner: { nodeId: 'enc', handleId: k },
    })
    left += 12
  }
  ports.push({
    id: 'clk',
    label: 'CLK',
    side: 'left',
    offset: left,
    inner: { nodeId: 'fsm', handleId: 'clk' },
  })
  left += 12
  ports.push({
    id: 'gnd',
    label: 'GND',
    side: 'left',
    offset: left,
    inner: { nodeId: 'enc', handleId: 'gnd' },
  })
  let right = 14
  for (let i = 0; i < 40; i++) {
    // the entry magnitude (internal / for chaining; same bits the display shows)
    ports.push({
      id: `entry${i}`,
      label: `E${i}`,
      side: 'right',
      offset: right,
      inner: { nodeId: 'ent', handleId: `entry${i}` },
    })
    right += 4
    // the DISPLAY magnitude (what the 7-seg shows) — sign is the separate NEG port
    const d = display[i]
    if (d !== undefined) {
      ports.push({
        id: `display${i}`,
        label: `D${i}`,
        side: 'right',
        offset: right,
        inner: { nodeId: d.node, handleId: d.handle },
      })
      right += 4
    }
  }
  ports.push({
    id: 'neg',
    label: 'NEG',
    side: 'right',
    offset: right,
    inner: { nodeId: negOut.node, handleId: negOut.handle },
  })
  right += 12
  ports.push({
    id: 'error',
    label: 'ERR',
    side: 'right',
    offset: right,
    inner: { nodeId: 'ff_err', handleId: 'q' },
  })
  right += 12
  ports.push({
    id: 'busy',
    label: 'BUSY',
    side: 'right',
    offset: right,
    inner: { nodeId: 'ctrl', handleId: 'busy' },
  })
  right += 12
  // F_ent — the entry's decimal-point position (how many of the displayed digits are fractional).
  for (let b = 0; b < 4; b++) {
    ports.push({
      id: `f_ent${b}`,
      label: `FE${b}`,
      side: 'right',
      offset: right,
      inner: { nodeId: 'fent', handleId: `q${b}` },
    })
    right += 8
  }
  ports.push({
    id: 'v_dd',
    label: 'V+',
    side: 'right',
    offset: right,
    inner: { nodeId: 'enc', handleId: 'v_dd' },
  })
  return { name: 'Calculator', origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** The complete 4-function calculator, every gate real (encoder + FSM + registers + ALU + multiplier + divider). */
export const CALCULATOR: BlockData = buildCalculator()

/**
 * SRAM BIT CELL (6T) — the static memory bit, the cell a CPU's CACHE is built from. Two CMOS
 * inverters wired nose-to-tail (each drives the other's input) latch one bit on the complementary
 * nodes Q / Q̄, and hold it with no clock for as long as the rails stay powered. Two NMOS ACCESS
 * transistors, both gated by the WORD LINE (WL), connect Q / Q̄ to the two BIT LINES (BL, BL̄): raise
 * WL and force the bit lines to WRITE; raise WL with the bit lines free to READ. Real all the way
 * down — it flattens to six MOSFETs (two inverters + two access).
 */
export const SRAM_CELL_BLOCK: BlockData = {
  name: 'SRAM',
  origin: { x: 0, y: 0 },
  nodes: [
    { id: 'inv1', definition: 'block', x: 120, y: 60, block: INVERTER_BLOCK },
    { id: 'inv2', definition: 'block', x: 400, y: 60, block: INVERTER_BLOCK },
    { id: 'a1', definition: 'transistor_mosfet_nmos', x: 0, y: 220, parameters: LOGIC_NMOS },
    { id: 'a2', definition: 'transistor_mosfet_nmos', x: 520, y: 220, parameters: LOGIC_NMOS },
  ],
  edges: [
    // cross-couple: each inverter drives the other's input (Q = inv1.out, Q̄ = inv2.out)
    { id: 'q_to_inv2', source: 'inv1', sourceHandle: 'out', target: 'inv2', targetHandle: 'in' },
    { id: 'qb_to_inv1', source: 'inv2', sourceHandle: 'out', target: 'inv1', targetHandle: 'in' },
    // shared rails between the two inverters
    { id: 'vdd', source: 'inv1', sourceHandle: 'v_dd', target: 'inv2', targetHandle: 'v_dd' },
    { id: 'gnd', source: 'inv1', sourceHandle: 'gnd', target: 'inv2', targetHandle: 'gnd' },
    // access transistors: source on the storage node, gate on the shared word line
    { id: 'a1_q', source: 'a1', sourceHandle: 'source', target: 'inv1', targetHandle: 'out' },
    { id: 'a2_qb', source: 'a2', sourceHandle: 'source', target: 'inv2', targetHandle: 'out' },
    { id: 'wl', source: 'a1', sourceHandle: 'gate', target: 'a2', targetHandle: 'gate' },
  ],
  ports: [
    { id: 'wl', label: 'WL', side: 'left', offset: 14, inner: { nodeId: 'a1', handleId: 'gate' } },
    { id: 'bl', label: 'BL', side: 'left', offset: 36, inner: { nodeId: 'a1', handleId: 'drain' } },
    {
      id: 'blb',
      label: 'BLB',
      side: 'left',
      offset: 58,
      inner: { nodeId: 'a2', handleId: 'drain' },
    },
    {
      id: 'v_dd',
      label: 'V+',
      side: 'right',
      offset: 18,
      inner: { nodeId: 'inv1', handleId: 'v_dd' },
    },
    {
      id: 'gnd',
      label: 'GND',
      side: 'right',
      offset: 40,
      inner: { nodeId: 'inv1', handleId: 'gnd' },
    },
  ],
}

/**
 * SRAM WORD — a row of `bits` SRAM cells sharing one WORD LINE and the supply rails, with each cell's
 * BIT LINES (BL/BL̄) brought out per bit. Raise WL and drive the bit-line pairs to store a whole word
 * at once; this is the row a memory's address decoder selects. Flattens to `bits`×6 real MOSFETs, so
 * keep it small — a real cache is millions of these (the [[transistor-sim-scaling-wall]]).
 */
function sramWord(bits: number): BlockData {
  const nodes: BlockData['nodes'] = []
  const edges: BlockData['edges'] = []
  const ports: BlockData['ports'] = []
  for (let i = 0; i < bits; i++) {
    nodes.push({ id: `bit${i}`, definition: 'block', x: i * 280, y: 0, block: SRAM_CELL_BLOCK })
    ports.push({
      id: `bl${i}`,
      label: `BL${i}`,
      side: 'top',
      inner: { nodeId: `bit${i}`, handleId: 'bl' },
    })
    ports.push({
      id: `blb${i}`,
      label: `BLB${i}`,
      side: 'bottom',
      inner: { nodeId: `bit${i}`, handleId: 'blb' },
    })
    if (i > 0) {
      edges.push({
        id: `wl_${i}`,
        source: `bit${i - 1}`,
        sourceHandle: 'wl',
        target: `bit${i}`,
        targetHandle: 'wl',
      })
      edges.push({
        id: `vdd_${i}`,
        source: `bit${i - 1}`,
        sourceHandle: 'v_dd',
        target: `bit${i}`,
        targetHandle: 'v_dd',
      })
      edges.push({
        id: `gnd_${i}`,
        source: `bit${i - 1}`,
        sourceHandle: 'gnd',
        target: `bit${i}`,
        targetHandle: 'gnd',
      })
    }
  }
  ports.push({ id: 'wl', label: 'WL', side: 'left', inner: { nodeId: 'bit0', handleId: 'wl' } })
  ports.push({
    id: 'v_dd',
    label: 'V+',
    side: 'right',
    inner: { nodeId: 'bit0', handleId: 'v_dd' },
  })
  ports.push({ id: 'gnd', label: 'GND', side: 'right', inner: { nodeId: 'bit0', handleId: 'gnd' } })
  return { name: `SRAM ${bits}b`, origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** A four-bit SRAM word — four 6T cells on a shared word line; stores one nibble. */
export const SRAM_WORD_4BIT: BlockData = sramWord(4)

/**
 * DARLINGTON pair — two NPN BJTs cascaded: the first's emitter drives the second's base, the
 * collectors tied. The composite acts as one transistor with β ≈ β1·β2 (a few thousand) and a
 * DOUBLED base-emitter drop (~1.3 V, two junctions). Flattens to the two real BJTs. Ports: the
 * base (Q1), the common collector, and the emitter (Q2).
 */
export const DARLINGTON_BLOCK: BlockData = {
  name: 'Darlington',
  origin: { x: 0, y: 0 },
  nodes: [
    {
      id: 'q1',
      definition: 'transistor_bjt_npn',
      x: 60,
      y: 30,
      parameters: defaultParameters('transistor_bjt_npn'),
    },
    {
      id: 'q2',
      definition: 'transistor_bjt_npn',
      x: 220,
      y: 140,
      parameters: defaultParameters('transistor_bjt_npn'),
    },
  ],
  edges: [
    // Q1 emitter drives Q2 base (the cascade); the two collectors tie together.
    { id: 'cascade', source: 'q1', sourceHandle: 'emitter', target: 'q2', targetHandle: 'base' },
    {
      id: 'collectors',
      source: 'q1',
      sourceHandle: 'collector',
      target: 'q2',
      targetHandle: 'collector',
    },
  ],
  ports: [
    { id: 'base', label: 'B', side: 'left', offset: 22, inner: { nodeId: 'q1', handleId: 'base' } },
    {
      id: 'collector',
      label: 'C',
      side: 'right',
      offset: 14,
      inner: { nodeId: 'q1', handleId: 'collector' },
    },
    {
      id: 'emitter',
      label: 'E',
      side: 'right',
      offset: 36,
      inner: { nodeId: 'q2', handleId: 'emitter' },
    },
  ],
}

/**
 * PHOTO-DARLINGTON — a phototransistor input stage driving a second NPN BJT. Light is the
 * input (the phototransistor has no base lead): its photocurrent feeds Q2's base, and Q2
 * amplifies it by β2, so a faint light drives a large collector current — a very sensitive
 * detector. Flattens to the phototransistor + the real BJT. Ports: the common collector and
 * the emitter; light level is set on the phototransistor (its illuminance).
 */
export const PHOTO_DARLINGTON_BLOCK: BlockData = {
  name: 'Photo-Darlington',
  origin: { x: 0, y: 0 },
  nodes: [
    {
      id: 'q1',
      definition: 'phototransistor',
      x: 60,
      y: 30,
      parameters: defaultParameters('phototransistor'),
    },
    {
      id: 'q2',
      definition: 'transistor_bjt_npn',
      x: 220,
      y: 140,
      parameters: defaultParameters('transistor_bjt_npn'),
    },
  ],
  edges: [
    // The phototransistor's photocurrent (out its emitter) drives Q2's base; collectors tie.
    { id: 'cascade', source: 'q1', sourceHandle: 'emitter', target: 'q2', targetHandle: 'base' },
    {
      id: 'collectors',
      source: 'q1',
      sourceHandle: 'collector',
      target: 'q2',
      targetHandle: 'collector',
    },
  ],
  ports: [
    {
      id: 'collector',
      label: 'C',
      side: 'left',
      offset: 18,
      inner: { nodeId: 'q1', handleId: 'collector' },
    },
    {
      id: 'emitter',
      label: 'E',
      side: 'right',
      offset: 18,
      inner: { nodeId: 'q2', handleId: 'emitter' },
    },
  ],
}

/**
 * CHARACTER-GENERATOR SCAN COUNTERS — three real synchronous up-counters, all clocked by the master
 * pixel clock, that track where the raster beam is: DOT (0..7, the pixel column within a character
 * cell), CHAR (0..15, which of the 16 character slots along the scanline), and LINE (0..7, the raster
 * row within the character). The cascade is SYNCHRONOUS, not ripple: CHAR counts only when DOT is at
 * its maximum (a combinational AND of DOT's bits used as the count-enable), and LINE only when DOT and
 * CHAR are both at maximum (the end of a scanline). So one pixel clock advances DOT every tick, CHAR
 * every 8 ticks, LINE every 128 ticks — exactly the order a TV beam paints (left to right across all
 * chars, then the next scanline down). CLR (a synchronous clear = load 0) gives a deterministic
 * power-up. Descend for the counters, and into them for the flip-flops + carry gates.
 */
function buildCharGenScan(): BlockData {
  const nodes: BlockData['nodes'] = [
    { id: 'dot', definition: 'block', x: 0, y: 0, block: COUNTER_UP_EN_3 },
    { id: 'char', definition: 'block', x: 2400, y: 0, block: COUNTER_UP_EN_4 },
    { id: 'line', definition: 'block', x: 4800, y: 0, block: COUNTER_UP_EN_3 },
  ]
  const edges: BlockData['edges'] = []
  let ei = 0
  const e = (s: string, sh: string, t: string, th: string) =>
    edges.push({ id: `cs${ei++}`, source: s, sourceHandle: sh, target: t, targetHandle: th })
  const LOW = { node: 'dot', handle: 'gnd' }
  const HIGH = { node: 'dot', handle: 'v_dd' }

  // Free-running counters: the load value is 0, so CLR (= LOAD high) loads zero — a clean reset.
  for (const [c, bits] of [
    ['dot', 3],
    ['char', 4],
    ['line', 3],
  ] as const)
    for (let i = 0; i < bits; i++) e(LOW.node, LOW.handle, c, `l${i}`)

  // DOT always counts; CHAR/LINE enables are the synchronous carries (combinational ANDs of the bits).
  e(HIGH.node, HIGH.handle, 'dot', 'en')
  const ctx: ExprCtx = { nodes: [], edges: [], ids: [], n: 0 }
  const dq = (i: number): LogicRef => ({ node: 'dot', handle: `q${i}` })
  const cq = (i: number): LogicRef => ({ node: 'char', handle: `q${i}` })
  const dotMax = buildExpr(['and', ['and', dq(0), dq(1)], dq(2)], ctx)
  const charMax = buildExpr(['and', ['and', ['and', cq(0), cq(1)], cq(2)], cq(3)], ctx)
  const lineEn = buildExpr(['and', dotMax, charMax], ctx)
  nodes.push(...ctx.nodes)
  edges.push(...ctx.edges)
  e(dotMax.node, dotMax.handle, 'char', 'en')
  e(lineEn.node, lineEn.handle, 'line', 'en')

  // Shared pixel clock + shared synchronous clear across all three counters.
  e('dot', 'clk', 'char', 'clk')
  e('dot', 'clk', 'line', 'clk')
  e('dot', 'load', 'char', 'load')
  e('dot', 'load', 'line', 'load')
  edges.push(...chainRails(['dot', 'char', 'line', ...ctx.ids], 'cs'))

  const ports: BlockData['ports'] = [
    {
      id: 'clk',
      label: 'CLK',
      side: 'left',
      offset: 14,
      inner: { nodeId: 'dot', handleId: 'clk' },
    },
    {
      id: 'clr',
      label: 'CLR',
      side: 'left',
      offset: 28,
      inner: { nodeId: 'dot', handleId: 'load' },
    },
    {
      id: 'gnd',
      label: 'GND',
      side: 'left',
      offset: 42,
      inner: { nodeId: 'dot', handleId: 'gnd' },
    },
  ]
  let right = 14
  const out = (id: string, label: string, nodeId: string, handleId: string) => {
    ports.push({ id, label, side: 'right', offset: right, inner: { nodeId, handleId } })
    right += 14
  }
  for (let i = 0; i < 3; i++) out(`dot${i}`, `DOT${i}`, 'dot', `q${i}`)
  for (let i = 0; i < 4; i++) out(`char${i}`, `CHAR${i}`, 'char', `q${i}`)
  for (let i = 0; i < 3; i++) out(`line${i}`, `LINE${i}`, 'line', `q${i}`)
  out('v_dd', 'V+', 'dot', 'v_dd')
  return { name: 'Char-Gen Scan', origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** The character generator's scan counters: dot 0..7, char 0..15, line 0..7 (synchronous cascade). */
export const CHARGEN_SCAN: BlockData = buildCharGenScan()

/**
 * One-hot decode of SOME addresses of a bus: for each requested index it builds the minterm (an AND of
 * the address bits, inverted where the index bit is 0). Returns index → its minterm net. Only the
 * indices asked for are built (a ROM needs minterms only for addresses that carry data).
 */
function oneHotSel(
  bits: LogicRef[],
  indices: number[],
  ctx: ExprCtx,
  _prefix: string,
): Map<number, LogicRef> {
  const out = new Map<number, LogicRef>()
  for (const idx of indices) {
    const b0 = bits[0]
    if (b0 === undefined) continue
    let expr: LogicExpr = (idx & 1) === 1 ? b0 : ['not', b0]
    for (let i = 1; i < bits.length; i++) {
      const bi = bits[i]
      if (bi === undefined) continue
      expr = ['and', expr, (idx >> i) & 1 ? bi : ['not', bi]]
    }
    out.set(idx, buildExpr(expr, ctx))
  }
  return out
}

/** OR a set of minterms into one net (an OR-plane row); 0 terms → constant LOW, 1 term → itself. */
function orOf(terms: LogicRef[], low: LogicRef, ctx: ExprCtx, prefix: string): LogicRef {
  if (terms.length === 0) return low
  const first = terms[0]
  if (terms.length === 1 && first !== undefined) return first
  const r = orReduce(terms, prefix, 0)
  ctx.nodes.push(...r.nodes)
  ctx.edges.push(...r.edges)
  ctx.ids.push(...r.ids)
  return r.out
}

const mustGet = (m: Map<number, LogicRef>, k: number): LogicRef => {
  const v = m.get(k)
  if (v === undefined) throw new Error(`one-hot line ${k} not built`)
  return v
}

// 5×7 glyphs for the eight characters HELLO WORLD needs. Each row is 5 columns, left to right; '#'
// is a lit dot. Bit d of a row = column d from the LEFT (dot 0 = leftmost), matching the beam's
// left-to-right sweep. Standard 5×7 dot-matrix forms.
const GLYPH_ART: Record<number, string[]> = {
  1: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'], // H
  2: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'], // E
  3: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'], // L
  4: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'], // O
  5: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'], // W
  6: ['####.', '#...#', '#...#', '####.', '##...', '#.#..', '#..##'], // R
  7: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'], // D
}
const rowVal = (s: string): number => {
  let v = 0
  for (let i = 0; i < s.length; i++) if (s[i] === '#') v |= 1 << i
  return v
}
// code → 8 rows (line 0..6 = the glyph, line 7 = blank inter-row gap). code 0 = space (all dark).
const GLYPH: Record<number, number[]> = { 0: [0, 0, 0, 0, 0, 0, 0, 0] }
for (const c of [1, 2, 3, 4, 5, 6, 7]) {
  const art = GLYPH_ART[c]
  if (art !== undefined) GLYPH[c] = [...art.map(rowVal), 0]
}

// The 16 character slots → glyph codes: H E L L O _ W O R L D, then 5 blanks. (1=H 2=E 3=L 4=O 5=W
// 6=R 7=D, 0=space.) The MESSAGE ROM realizes this map in gates.
const MESSAGE_CODES = [1, 2, 3, 3, 4, 0, 5, 4, 6, 3, 7, 0, 0, 0, 0, 0]

/**
 * DOT-MATRIX LED DISPLAY — a real rows×cols grid of LEDs, the coarse ancestor of a pixel screen. Each
 * pixel is a genuine LED behind a current-limiting resistor, all sharing one common cathode; drive a
 * pixel's `px_<r>_<c>` pin high (with COMMON to ground) to light it. The on-canvas face only READS each
 * LED's solved lit-state — no faking. Scale it up (more rows/cols, RGB per pixel) toward a real display.
 */
function dotMatrix(rows: number, cols: number): BlockData {
  const nodes: BlockData['nodes'] = []
  const edges: BlockData['edges'] = []
  const ports: BlockData['ports'] = []
  const off = { left: 14, right: 14 }
  let prev: string | null = null
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const led = `led_${r}_${c}`
      const res = `r_${r}_${c}`
      nodes.push({
        id: res,
        definition: 'resistor',
        x: c * 220,
        y: r * 160,
        parameters: SEG_RESISTOR,
      })
      nodes.push({
        id: led,
        definition: 'led',
        x: c * 220 + 120,
        y: r * 160,
        parameters: defaultParameters('led'),
      })
      edges.push({
        id: `rl_${r}_${c}`,
        source: res,
        sourceHandle: 'terminal_b',
        target: led,
        targetHandle: 'anode',
      })
      if (prev !== null)
        edges.push({
          id: `cc_${r}_${c}`,
          source: prev,
          sourceHandle: 'cathode',
          target: led,
          targetHandle: 'cathode',
        })
      prev = led
      const side: 'left' | 'right' = c * 2 < cols ? 'left' : 'right'
      ports.push({
        id: `px_${r}_${c}`,
        label: `${r}${c}`,
        side,
        offset: off[side],
        inner: { nodeId: res, handleId: 'terminal_a' },
      })
      off[side] += 7
    }
  }
  ports.push({
    id: 'common',
    label: 'GND',
    side: 'bottom',
    offset: 24,
    inner: { nodeId: 'led_0_0', handleId: 'cathode' },
  })
  return {
    name: `${rows}×${cols} Dot Matrix`,
    display: 'dot_matrix',
    rows,
    cols,
    size: { width: cols * 26 + 36, height: rows * 24 + 28 },
    origin: { x: 0, y: 0 },
    nodes,
    edges,
    ports,
  }
}

/** A 7-row × 5-column dot-matrix LED display — one character cell, the classic 5×7 form. */
export const DOT_MATRIX_5X7: BlockData = dotMatrix(7, 5)

/**
 * A real MULTIPLEXED LED matrix — the way an ACTUAL LED dot-matrix panel is wired. Instead of one pin
 * per pixel (R×C pins — an unroutable wire explosion at any real size), the pixels share ROW lines and
 * COLUMN lines: R row pins + C column pins. LED(r,c)'s anode sits on row r's shared line, its cathode on
 * column c's shared line (through that column's single current-limiting resistor). Light pixel (r,c) by
 * driving row r HIGH and column c LOW. Only ONE row is driven at a time (a scan controller cycles them
 * fast); persistence-of-vision merges the rows into a whole picture, and that single-row-active rule is
 * exactly what keeps a passive matrix free of sneak-path ghosting. 16×16 = 32 pins instead of 256.
 */
function dotMatrixMultiplexed(rows: number, cols: number): BlockData {
  const nodes: BlockData['nodes'] = []
  const edges: BlockData['edges'] = []
  const ports: BlockData['ports'] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      nodes.push({
        id: `led_${r}_${c}`,
        definition: 'led',
        x: c * 180 + 60,
        y: r * 120,
        parameters: defaultParameters('led'),
      })
  for (let c = 0; c < cols; c++)
    nodes.push({
      id: `colres_${c}`,
      definition: 'resistor',
      x: c * 180 + 60,
      y: rows * 120,
      parameters: SEG_RESISTOR,
    })
  // Row lines: chain each row's LED anodes into one shared net; the row pin taps the first LED.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols - 1; c++)
      edges.push({
        id: `rowlink_${r}_${c}`,
        source: `led_${r}_${c}`,
        sourceHandle: 'anode',
        target: `led_${r}_${c + 1}`,
        targetHandle: 'anode',
      })
    ports.push({
      id: `row_${r}`,
      label: `R${r}`,
      side: 'left',
      offset: 18 + r * 24,
      inner: { nodeId: `led_${r}_0`, handleId: 'anode' },
    })
  }
  // Column lines: chain each column's LED cathodes together into that column's resistor; the column pin
  // taps the resistor's free end (so the one resistor limits every pixel that column lights).
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows - 1; r++)
      edges.push({
        id: `collink_${r}_${c}`,
        source: `led_${r}_${c}`,
        sourceHandle: 'cathode',
        target: `led_${r + 1}_${c}`,
        targetHandle: 'cathode',
      })
    edges.push({
      id: `colres_link_${c}`,
      source: `led_${rows - 1}_${c}`,
      sourceHandle: 'cathode',
      target: `colres_${c}`,
      targetHandle: 'terminal_b',
    })
    ports.push({
      id: `col_${c}`,
      label: `C${c}`,
      side: 'bottom',
      offset: 18 + c * 28,
      inner: { nodeId: `colres_${c}`, handleId: 'terminal_a' },
    })
  }
  return {
    name: `${rows}×${cols} LED Matrix (muxed)`,
    display: 'dot_matrix',
    rows,
    cols,
    size: { width: cols * 28 + 48, height: rows * 24 + 40 },
    origin: { x: 0, y: 0 },
    nodes,
    edges,
    ports,
  }
}

/** An 8×8 multiplexed LED matrix — 16 pins (8 row + 8 column) drive 64 pixels. */
export const DOT_MATRIX_MUX_8X8: BlockData = dotMatrixMultiplexed(8, 8)

/** A 16×16 multiplexed LED matrix — 32 pins drive 256 pixels (vs 256 per-pixel pins un-muxed). */
export const DOT_MATRIX_MUX_16X16: BlockData = dotMatrixMultiplexed(16, 16)

/**
 * ACTIVE-MATRIX PIXEL (2T1C) — the AMOLED/TFT cell that makes HIGH-RESOLUTION screens physically
 * possible, and the #1 piece a passive matrix is missing. Unlike passive multiplexing (one row lit at a
 * time, dimmed by the duty cycle so it caps at a few hundred rows), each pixel here holds its OWN
 * brightness: a SELECT transistor (NMOS) passes the column DATA onto a storage CAPACITOR when its row is
 * addressed; the cap holds that voltage on the gate of a DRIVE transistor (PMOS), which keeps sourcing
 * the LED's current — at a brightness SET BY the stored voltage (real analog grey) — even after the row
 * is deselected and the scanner moves on. So every pixel stays lit all frame and the row count is no
 * longer limited by the scan duty cycle. Two real MOSFETs + a real capacitor + a real LED. Descend to see.
 */
function buildActiveMatrixPixel(): BlockData {
  const nodes: BlockData['nodes'] = [
    {
      id: 'msel',
      definition: 'transistor_mosfet_nmos',
      x: 0,
      y: 0,
      parameters: defaultParameters('transistor_mosfet_nmos'),
    },
    {
      id: 'mdrv',
      definition: 'transistor_mosfet_pmos',
      x: 300,
      y: 0,
      parameters: defaultParameters('transistor_mosfet_pmos'),
    },
    {
      id: 'cs',
      definition: 'capacitor',
      x: 150,
      y: 160,
      parameters: defaultParameters('capacitor'),
    },
    { id: 'led', definition: 'led', x: 300, y: 220, parameters: defaultParameters('led') },
  ]
  const edges: BlockData['edges'] = [
    // storage node: select transistor's source → drive transistor's gate → capacitor top plate
    { id: 'p_a1', source: 'msel', sourceHandle: 'source', target: 'mdrv', targetHandle: 'gate' },
    {
      id: 'p_a2',
      source: 'msel',
      sourceHandle: 'source',
      target: 'cs',
      targetHandle: 'terminal_a',
    },
    // the drive transistor sources the LED's current; cap bottom plate + LED cathode share ground
    { id: 'p_drv', source: 'mdrv', sourceHandle: 'drain', target: 'led', targetHandle: 'anode' },
    {
      id: 'p_gnd',
      source: 'cs',
      sourceHandle: 'terminal_b',
      target: 'led',
      targetHandle: 'cathode',
    },
  ]
  const ports: BlockData['ports'] = [
    {
      id: 'scan',
      label: 'SCAN',
      side: 'left',
      offset: 14,
      inner: { nodeId: 'msel', handleId: 'gate' },
    },
    {
      id: 'data',
      label: 'DATA',
      side: 'left',
      offset: 36,
      inner: { nodeId: 'msel', handleId: 'drain' },
    },
    {
      id: 'vdd',
      label: 'V+',
      side: 'top',
      offset: 18,
      inner: { nodeId: 'mdrv', handleId: 'source' },
    },
    {
      id: 'gnd',
      label: 'GND',
      side: 'bottom',
      offset: 18,
      inner: { nodeId: 'led', handleId: 'cathode' },
    },
  ]
  return { name: 'Active-Matrix Pixel (2T1C)', origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** One AMOLED/TFT active-matrix pixel — select + drive MOSFETs, a storage cap, and the LED. */
export const ACTIVE_MATRIX_PIXEL: BlockData = buildActiveMatrixPixel()

/**
 * ROW SCANNER — the controller that makes a multiplexed matrix show a whole picture. A real synchronous
 * up-counter (always counting) tracks the current row; a binary→one-hot decoder then drives EXACTLY that
 * one row line HIGH (every other low). One clock tick advances to the next row; run it fast and the rows
 * blur together by persistence-of-vision into a steady image — and only-one-row-high is precisely what a
 * passive matrix needs to stay ghost-free. CLR (a synchronous load of 0) powers up cleanly at row 0. Its
 * row outputs are push-pull so they drive the analog matrix's row lines directly. Descend for the
 * counter + the decode gates, and into the counter for the flip-flops.
 */
function buildRowScanner(rows: number): BlockData {
  const bits = Math.max(1, Math.ceil(Math.log2(rows)))
  // Reuse the cached 3/4-bit up-counters for the common 8/16-row panels; build a wider one for taller
  // panels (a 5-bit counter scans 32 rows, 6-bit 64, …) so the scanner is not capped at 16.
  const counterBlock =
    bits <= 3 ? COUNTER_UP_EN_3 : bits === 4 ? COUNTER_UP_EN_4 : buildDownCounter(bits, true, true)
  const nodes: BlockData['nodes'] = [
    { id: 'cnt', definition: 'block', x: 0, y: 0, block: counterBlock },
  ]
  const edges: BlockData['edges'] = []
  let ei = 0
  const e = (s: string, sh: string, t: string, th: string) =>
    edges.push({ id: `rs${ei++}`, source: s, sourceHandle: sh, target: t, targetHandle: th })
  // Free-running: always count; load value 0 (so a CLR pulse loads row 0).
  e('cnt', 'v_dd', 'cnt', 'en')
  for (let i = 0; i < bits; i++) e('cnt', 'gnd', 'cnt', `l${i}`)
  // Binary→one-hot decode: row r is HIGH exactly when the counter holds the value r.
  const ctx: ExprCtx = { nodes: [], edges: [], ids: [], n: 0 }
  const cq = (i: number): LogicRef => ({ node: 'cnt', handle: `q${i}` })
  const rowRefs: LogicRef[] = []
  for (let r = 0; r < rows; r++) {
    let expr: LogicExpr = (r >> 0) & 1 ? cq(0) : ['not', cq(0)]
    for (let i = 1; i < bits; i++) expr = ['and', expr, (r >> i) & 1 ? cq(i) : ['not', cq(i)]]
    rowRefs.push(buildExpr(expr, ctx))
  }
  nodes.push(...ctx.nodes)
  edges.push(...ctx.edges)
  edges.push(...chainRails(['cnt', ...ctx.ids], 'rs'))
  const ports: BlockData['ports'] = [
    {
      id: 'clk',
      label: 'CLK',
      side: 'left',
      offset: 14,
      inner: { nodeId: 'cnt', handleId: 'clk' },
    },
    {
      id: 'clr',
      label: 'CLR',
      side: 'left',
      offset: 28,
      inner: { nodeId: 'cnt', handleId: 'load' },
    },
    {
      id: 'gnd',
      label: 'GND',
      side: 'left',
      offset: 42,
      inner: { nodeId: 'cnt', handleId: 'gnd' },
    },
    {
      id: 'v_dd',
      label: 'V+',
      side: 'left',
      offset: 56,
      inner: { nodeId: 'cnt', handleId: 'v_dd' },
    },
  ]
  let yoff = 14
  for (let r = 0; r < rows; r++) {
    const ref = rowRefs[r]
    if (ref === undefined) continue
    ports.push({
      id: `row_${r}`,
      label: `R${r}`,
      side: 'right',
      offset: yoff,
      drive: 'push_pull',
      inner: { nodeId: ref.node, handleId: ref.handle },
    })
    yoff += 14
  }
  return { name: `${rows}-row Scanner`, origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** An 8-row scanner — clock it and it lights matrix rows 0,1,…,7,0,… one at a time. */
export const ROW_SCANNER_8: BlockData = buildRowScanner(8)
/** A 16-row scanner for the 16×16 multiplexed matrix. */
export const ROW_SCANNER_16: BlockData = buildRowScanner(16)
/** A 32-row scanner (5-bit counter) — the same circuit scaled up, for taller multiplexed panels. */
export const ROW_SCANNER_32: BlockData = buildRowScanner(32)

/**
 * FRAME BUFFER — real memory holding the picture. One register per row (real D flip-flops via dRegister)
 * stores that row's column bits; the picture is loaded on the clock — each register's data inputs are
 * tied to its row of the image, so a clock latches the whole picture into the flip-flops. The scanner's
 * one-hot ROW ADDRESS reads the addressed row's bits back out onto the column lines through a one-hot
 * read mux (col c = OR over rows of address_r AND register_r.bit_c). So the scanner reads the picture out
 * of real flip-flops, row by row — the image lives in hardware, not a bitmap. Descend for the registers +
 * the read mux, and into a register for the flip-flops.
 */
export function buildFrameBuffer(image: readonly (readonly boolean[])[]): BlockData {
  const rows = image.length
  const cols = image[0]?.length ?? 0
  const nodes: BlockData['nodes'] = []
  const edges: BlockData['edges'] = []
  let ei = 0
  const e = (s: string, sh: string, t: string, th: string) =>
    edges.push({ id: `fb${ei++}`, source: s, sourceHandle: sh, target: t, targetHandle: th })
  for (let r = 0; r < rows; r++) {
    nodes.push({ id: `reg_${r}`, definition: 'block', x: 600, y: r * 240, block: dRegister(cols) })
    nodes.push({ id: `addr_${r}`, definition: 'block', x: 0, y: r * 240, block: BUFFER_BLOCK })
  }
  const HIGH = { node: 'reg_0', handle: 'v_dd' }
  const LOW = { node: 'reg_0', handle: 'gnd' }
  // Load the picture: tie each register's data inputs to its image row; share the clock across rows.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lvl = image[r]?.[c] ? HIGH : LOW
      e(lvl.node, lvl.handle, `reg_${r}`, `d${c}`)
    }
    if (r > 0) e('reg_0', 'clk', `reg_${r}`, 'clk')
  }
  // One-hot read mux: col c = OR over rows of (address_r AND register_r.q_c).
  const ctx: ExprCtx = { nodes: [], edges: [], ids: [], n: 0 }
  const colRefs: LogicRef[] = []
  for (let c = 0; c < cols; c++) {
    let colOut: LogicRef | null = null
    for (let r = 0; r < rows; r++) {
      const addr: LogicRef = { node: `addr_${r}`, handle: 'out' }
      const q: LogicRef = { node: `reg_${r}`, handle: `q${c}` }
      const term = buildExpr(['and', addr, q], ctx)
      colOut = colOut === null ? term : buildExpr(['or', colOut, term], ctx)
    }
    if (colOut !== null) colRefs.push(colOut)
  }
  nodes.push(...ctx.nodes)
  edges.push(...ctx.edges)
  const regIds = Array.from({ length: rows }, (_, r) => `reg_${r}`)
  const addrIds = Array.from({ length: rows }, (_, r) => `addr_${r}`)
  edges.push(...chainRails([...regIds, ...addrIds, ...ctx.ids], 'fb'))
  const ports: BlockData['ports'] = [
    {
      id: 'clk',
      label: 'CLK',
      side: 'left',
      offset: 14,
      inner: { nodeId: 'reg_0', handleId: 'clk' },
    },
    {
      id: 'gnd',
      label: 'GND',
      side: 'left',
      offset: 28,
      inner: { nodeId: 'reg_0', handleId: 'gnd' },
    },
    {
      id: 'v_dd',
      label: 'V+',
      side: 'left',
      offset: 42,
      inner: { nodeId: 'reg_0', handleId: 'v_dd' },
    },
  ]
  let loff = 60
  for (let r = 0; r < rows; r++) {
    ports.push({
      id: `addr_${r}`,
      label: `A${r}`,
      side: 'left',
      offset: loff,
      inner: { nodeId: `addr_${r}`, handleId: 'in' },
    })
    loff += 14
  }
  let roff = 14
  for (let c = 0; c < cols; c++) {
    const ref = colRefs[c]
    if (ref === undefined) continue
    ports.push({
      id: `col_${c}`,
      label: `C${c}`,
      side: 'right',
      offset: roff,
      drive: 'push_pull',
      inner: { nodeId: ref.node, handleId: ref.handle },
    })
    roff += 14
  }
  return { name: `${rows}×${cols} Frame Buffer`, origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/**
 * GREY (multi-bit) FRAME BUFFER — colour depth on an on/off LED matrix the real way: BIT-PLANES. A grey
 * image (0–1 per pixel) is quantised to `bits` bits and split into `bits` separate 1-bit frame buffers,
 * plane k holding bit k of every pixel. Shown by Binary-Code-Modulation PWM — plane k is displayed 2^k as
 * long as plane 0 — so the eye integrates the planes into one grey level (see scanGreyImage). Each plane
 * is a real buildFrameBuffer (real flip-flops); no pixel ever stores an "analog" value. Returned LSB-first.
 */
export function buildGreyFrameBuffers(
  image: readonly (readonly number[])[],
  bits: number,
): BlockData[] {
  const cols = image[0]?.length ?? 0
  const maxLevel = (1 << bits) - 1
  return Array.from({ length: bits }, (_, k) =>
    buildFrameBuffer(
      image.map((row) =>
        Array.from({ length: cols }, (_, c) => {
          const level = Math.max(0, Math.min(maxLevel, Math.round((row[c] ?? 0) * maxLevel)))
          return ((level >> k) & 1) === 1
        }),
      ),
    ),
  )
}

/**
 * WRITABLE FRAME BUFFER — like buildFrameBuffer, but the picture is WRITTEN in at runtime, not hardwired.
 * One loadable register per row — a real counter with its count disabled (EN tied low), so it only LOADS
 * on demand, a clean parallel-load register. A write port (one-hot write address + a column-data bus +
 * write-enable) latches the addressed row's register on the clock; every other row holds. The scanner's
 * one-hot READ address reads any row back out through the one-hot read mux. So you can paint a new picture
 * into real flip-flop memory and the scanner displays it — a real RAM frame buffer.
 */
export function buildWritableFrameBuffer(rows: number, cols: number): BlockData {
  const nodes: BlockData['nodes'] = []
  const edges: BlockData['edges'] = []
  let ei = 0
  const e = (s: string, sh: string, t: string, th: string) =>
    edges.push({ id: `wfb${ei++}`, source: s, sourceHandle: sh, target: t, targetHandle: th })
  for (let r = 0; r < rows; r++) {
    nodes.push({
      id: `reg_${r}`,
      definition: 'block',
      x: 1000,
      y: r * 260,
      block: buildDownCounter(cols, true),
    })
    nodes.push({ id: `raddr_${r}`, definition: 'block', x: 0, y: r * 260, block: BUFFER_BLOCK })
    nodes.push({ id: `waddr_${r}`, definition: 'block', x: 240, y: r * 260, block: BUFFER_BLOCK })
  }
  for (let c = 0; c < cols; c++)
    nodes.push({
      id: `wdata_${c}`,
      definition: 'block',
      x: 500,
      y: c * 120 - 400,
      block: BUFFER_BLOCK,
    })
  nodes.push({ id: 'webuf', definition: 'block', x: 500, y: 600, block: BUFFER_BLOCK })
  const LOW = { node: 'reg_0', handle: 'gnd' }
  const ctx: ExprCtx = { nodes: [], edges: [], ids: [], n: 0 }
  const we: LogicRef = { node: 'webuf', handle: 'out' }
  for (let r = 0; r < rows; r++) {
    e(LOW.node, LOW.handle, `reg_${r}`, 'en') // count disabled → a load-only register
    for (let c = 0; c < cols; c++) e(`wdata_${c}`, 'out', `reg_${r}`, `l${c}`) // write-data bus → load inputs
    const waddr: LogicRef = { node: `waddr_${r}`, handle: 'out' }
    const loadEn = buildExpr(['and', we, waddr], ctx) // load this row only when WE and its write address
    e(loadEn.node, loadEn.handle, `reg_${r}`, 'load')
    if (r > 0) e('reg_0', 'clk', `reg_${r}`, 'clk')
  }
  const colRefs: LogicRef[] = []
  for (let c = 0; c < cols; c++) {
    let colOut: LogicRef | null = null
    for (let r = 0; r < rows; r++) {
      const rd: LogicRef = { node: `raddr_${r}`, handle: 'out' }
      const q: LogicRef = { node: `reg_${r}`, handle: `q${c}` }
      const term = buildExpr(['and', rd, q], ctx)
      colOut = colOut === null ? term : buildExpr(['or', colOut, term], ctx)
    }
    if (colOut !== null) colRefs.push(colOut)
  }
  nodes.push(...ctx.nodes)
  edges.push(...ctx.edges)
  const railIds = [
    ...Array.from({ length: rows }, (_, r) => `reg_${r}`),
    ...Array.from({ length: rows }, (_, r) => `raddr_${r}`),
    ...Array.from({ length: rows }, (_, r) => `waddr_${r}`),
    ...Array.from({ length: cols }, (_, c) => `wdata_${c}`),
    'webuf',
    ...ctx.ids,
  ]
  edges.push(...chainRails(railIds, 'wfb'))
  const ports: BlockData['ports'] = [
    {
      id: 'clk',
      label: 'CLK',
      side: 'left',
      offset: 14,
      inner: { nodeId: 'reg_0', handleId: 'clk' },
    },
    {
      id: 'gnd',
      label: 'GND',
      side: 'left',
      offset: 28,
      inner: { nodeId: 'reg_0', handleId: 'gnd' },
    },
    {
      id: 'v_dd',
      label: 'V+',
      side: 'left',
      offset: 42,
      inner: { nodeId: 'reg_0', handleId: 'v_dd' },
    },
    { id: 'we', label: 'WE', side: 'left', offset: 56, inner: { nodeId: 'webuf', handleId: 'in' } },
  ]
  let loff = 76
  for (let r = 0; r < rows; r++) {
    ports.push({
      id: `rd_addr_${r}`,
      label: `RA${r}`,
      side: 'left',
      offset: loff,
      inner: { nodeId: `raddr_${r}`, handleId: 'in' },
    })
    loff += 14
  }
  for (let r = 0; r < rows; r++) {
    ports.push({
      id: `wr_addr_${r}`,
      label: `WA${r}`,
      side: 'left',
      offset: loff,
      inner: { nodeId: `waddr_${r}`, handleId: 'in' },
    })
    loff += 14
  }
  let toff = 14
  for (let c = 0; c < cols; c++) {
    ports.push({
      id: `wr_data_${c}`,
      label: `WD${c}`,
      side: 'top',
      offset: toff,
      inner: { nodeId: `wdata_${c}`, handleId: 'in' },
    })
    toff += 14
  }
  let roff = 14
  for (let c = 0; c < cols; c++) {
    const ref = colRefs[c]
    if (ref === undefined) continue
    ports.push({
      id: `col_${c}`,
      label: `C${c}`,
      side: 'right',
      offset: roff,
      drive: 'push_pull',
      inner: { nodeId: ref.node, handleId: ref.handle },
    })
    roff += 14
  }
  return {
    name: `${rows}×${cols} Writable Frame Buffer`,
    origin: { x: 0, y: 0 },
    nodes,
    edges,
    ports,
  }
}

/**
 * GLYPH ROM — a real combinational character generator: a 3-bit character code in (0 = blank, 1=H 2=E
 * 3=L 4=O 5=W 6=R 7=D) lights the matching 5×7 glyph on its `px_<r>_<c>` outputs. Built straight from the
 * font table in gates (a one-hot code decode + a per-pixel OR of the codes that light it) — wire its
 * pixel outputs to a DOT_MATRIX to make a character display, exactly as a real text display drives its panel.
 */
function buildGlyphRom(rows: number, cols: number): BlockData {
  const nodes: BlockData['nodes'] = []
  const edges: BlockData['edges'] = []
  const ctx: ExprCtx = { nodes, edges, ids: [], n: 0 }
  for (let i = 0; i < 3; i++)
    nodes.push({ id: `cinv${i}`, definition: 'block', x: -400, y: i * 300, block: INVERTER_BLOCK })
  const LOW: LogicRef = { node: 'cinv0', handle: 'gnd' }
  // a code bit's true value is the inverter's input net (= the code port); its complement is the output.
  const bit = (i: number, set: boolean): LogicRef =>
    set ? { node: `cinv${i}`, handle: 'in' } : { node: `cinv${i}`, handle: 'out' }
  const codeOH: LogicRef[] = []
  for (let k = 0; k < 8; k++)
    codeOH.push(
      buildExpr(
        ['and', ['and', bit(0, (k & 1) === 1), bit(1, (k & 2) === 2)], bit(2, (k & 4) === 4)],
        ctx,
      ),
    )
  const ports: BlockData['ports'] = []
  let rOff = 14
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lit: LogicRef[] = []
      for (let k = 0; k < 8; k++)
        if ((((GLYPH[k] ?? [])[r] ?? 0) >> c) & 1) {
          const oh = codeOH[k]
          if (oh !== undefined) lit.push(oh)
        }
      const pixel = lit.length > 0 ? lit.reduce((a, b) => buildExpr(['or', a, b], ctx)) : LOW
      ports.push({
        id: `px_${r}_${c}`,
        label: `${r}${c}`,
        side: 'right',
        offset: rOff,
        drive: 'push_pull', // a CMOS pixel driver — the logic→analog bridge needs an OUTPUT-driven pin
        inner: { nodeId: pixel.node, handleId: pixel.handle },
      })
      rOff += 7
    }
  }
  edges.push(...chainRails(['cinv0', 'cinv1', 'cinv2', ...ctx.ids], 'gr'))
  let lOff = 14
  for (let i = 0; i < 3; i++) {
    ports.push({
      id: `code${i}`,
      label: `C${i}`,
      side: 'left',
      offset: lOff,
      inner: { nodeId: `cinv${i}`, handleId: 'in' },
    })
    lOff += 18
  }
  ports.push({
    id: 'v_dd',
    label: 'V+',
    side: 'left',
    offset: lOff,
    inner: { nodeId: 'cinv0', handleId: 'v_dd' },
  })
  lOff += 18
  ports.push({
    id: 'gnd',
    label: 'GND',
    side: 'left',
    offset: lOff,
    inner: { nodeId: 'cinv0', handleId: 'gnd' },
  })
  return { name: 'Glyph ROM (5×7)', origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** A 5×7 character generator ROM — a 3-bit code in, the glyph's 35 pixels out. Drive a DOT_MATRIX_5X7. */
export const GLYPH_ROM_5X7: BlockData = buildGlyphRom(7, 5)

/**
 * FULL-COLOUR dot-matrix LED display — like the mono one, but every pixel is THREE real LEDs (a red
 * ~640 nm, a green ~525 nm, a blue ~465 nm) sharing one common cathode, each with its own `px_<r>_<c>_<rgb>`
 * pin. Light any combination and the colours add (R+G = yellow, R+G+B = white) — exactly an RGB subpixel,
 * the same idea as an LED video wall or an OLED panel, just coarse. The face mixes each pixel's lit LEDs.
 */
function dotMatrixRGB(rows: number, cols: number): BlockData {
  const nodes: BlockData['nodes'] = []
  const edges: BlockData['edges'] = []
  const ports: BlockData['ports'] = []
  const CH: [string, number][] = [
    ['r', 640],
    ['g', 525],
    ['b', 465],
  ]
  const ledNm = (nm: number): Parameters => ({
    ...defaultParameters('led'),
    peak_wavelength: { value: { kind: 'scalar', amount: nm, unit: 'nanometer' } },
  })
  const off = { left: 14, right: 14 }
  let prev: string | null = null
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      for (const [ch, nm] of CH) {
        const led = `led_${r}_${c}_${ch}`
        const res = `rr_${r}_${c}_${ch}`
        nodes.push({
          id: res,
          definition: 'resistor',
          x: c * 280 + 'rgb'.indexOf(ch) * 60,
          y: r * 160,
          parameters: SEG_RESISTOR,
        })
        nodes.push({
          id: led,
          definition: 'led',
          x: c * 280 + 'rgb'.indexOf(ch) * 60 + 120,
          y: r * 160,
          parameters: ledNm(nm),
        })
        edges.push({
          id: `rl_${r}_${c}_${ch}`,
          source: res,
          sourceHandle: 'terminal_b',
          target: led,
          targetHandle: 'anode',
        })
        if (prev !== null)
          edges.push({
            id: `cc_${r}_${c}_${ch}`,
            source: prev,
            sourceHandle: 'cathode',
            target: led,
            targetHandle: 'cathode',
          })
        prev = led
        const side: 'left' | 'right' = c * 2 < cols ? 'left' : 'right'
        ports.push({
          id: `px_${r}_${c}_${ch}`,
          label: `${r}${c}${ch}`,
          side,
          offset: off[side],
          inner: { nodeId: res, handleId: 'terminal_a' },
        })
        off[side] += 4
      }
    }
  }
  ports.push({
    id: 'common',
    label: 'GND',
    side: 'bottom',
    offset: 24,
    inner: { nodeId: 'led_0_0_r', handleId: 'cathode' },
  })
  return {
    name: `${rows}×${cols} RGB Matrix`,
    display: 'dot_matrix_rgb',
    rows,
    cols,
    size: { width: cols * 28 + 36, height: rows * 24 + 28 },
    origin: { x: 0, y: 0 },
    nodes,
    edges,
    ports,
  }
}

/** A 7-row × 7-column full-COLOUR dot-matrix LED display — RGB subpixels, the path to a colour panel. */
export const DOT_MATRIX_RGB_7X7: BlockData = dotMatrixRGB(7, 7)

/**
 * The golden-model video bit the character generator should emit at a given scan position — the spec
 * its real gate ROMs are tested against. The beam paints the glyph pixel for the character in that
 * slot, and stays dark in the inter-character spacing (dot ≥ 5) and the inter-line gap (line ≥ 7).
 */
export function charGenExpectedVideo(dot: number, char: number, line: number): 0 | 1 {
  if (dot > 4 || line > 6) return 0
  const code = MESSAGE_CODES[char] ?? 0
  return ((((GLYPH[code] ?? [])[line] ?? 0) >> dot) & 1) === 1 ? 1 : 0
}

/**
 * CHARACTER GENERATOR — a real clocked digital circuit (all gates, descend to MOSFETs) that turns the
 * raster scan into a one-bit VIDEO stream spelling HELLO WORLD, the way an MC6845-era CRT controller +
 * font ROM does. Built on CHARGEN_SCAN (the dot/char/line counters); on top sit three combinational
 * ROMs/decoders, all real AND-OR gate planes:
 *   • MESSAGE ROM  — char slot (0..15) → a 3-bit character CODE (H E L L O _ W O R L D, then blanks).
 *   • FONT ROM     — {code, line} → the 8-bit glyph ROW bitmap (5 lit columns + 3 blank spacing).
 *   • COLUMN MUX   — the dot counter selects ONE bit of that row → the serial VIDEO output.
 * Because the dot/char/line counters are phase-locked to the same pixel clock the analog X/Y sweeps
 * use, the glyph bit emitted at pixel p lands exactly where the beam is at pixel p. The 'video' port is
 * the digital→analog bridge into the CRT grid (the co-sim drives it). Descend for the ROM gate planes.
 */
function buildCharGen(): BlockData {
  const nodes: BlockData['nodes'] = [
    { id: 'scan', definition: 'block', x: 0, y: 0, block: CHARGEN_SCAN },
  ]
  const edges: BlockData['edges'] = []
  const ctx: ExprCtx = { nodes: [], edges: [], ids: [], n: 0 }
  const LOW: LogicRef = { node: 'scan', handle: 'gnd' }
  const charB = (i: number): LogicRef => ({ node: 'scan', handle: `char${i}` })
  const lineB = (i: number): LogicRef => ({ node: 'scan', handle: `line${i}` })
  const dotB = (i: number): LogicRef => ({ node: 'scan', handle: `dot${i}` })

  // MESSAGE ROM: the 16 character slots → 3-bit glyph codes (MESSAGE_CODES).
  const charsNeeded = MESSAGE_CODES.map((_, c) => c).filter((c) => MESSAGE_CODES[c] !== 0)
  const charOH = oneHotSel([charB(0), charB(1), charB(2), charB(3)], charsNeeded, ctx, 'ch')
  const code = [0, 1, 2].map((j) =>
    orOf(
      charsNeeded.filter((c) => ((MESSAGE_CODES[c] ?? 0) >> j) & 1).map((c) => mustGet(charOH, c)),
      LOW,
      ctx,
      `code${j}`,
    ),
  )

  // FONT ROM: (code 0..7, line 0..7) → 8-bit row. Shared one-hot decode of code + line; each lit
  // (code,line) cell is one AND, then each row bit is an OR-plane over the cells where it is lit.
  const codesNeeded = [1, 2, 3, 4, 5, 6, 7]
  const linesNeeded = [0, 1, 2, 3, 4, 5, 6]
  const codeOH = oneHotSel(code, codesNeeded, ctx, 'co')
  const lineOH = oneHotSel([lineB(0), lineB(1), lineB(2)], linesNeeded, ctx, 'lo')
  const cell = new Map<string, LogicRef>()
  for (const c of codesNeeded)
    for (const l of linesNeeded)
      if (((GLYPH[c] ?? [])[l] ?? 0) !== 0)
        cell.set(`${c}_${l}`, buildExpr(['and', mustGet(codeOH, c), mustGet(lineOH, l)], ctx))
  const row = [0, 1, 2, 3, 4, 5, 6, 7].map((d) => {
    const terms: LogicRef[] = []
    for (const c of codesNeeded)
      for (const l of linesNeeded) {
        const cl = cell.get(`${c}_${l}`)
        if (cl !== undefined && (((GLYPH[c] ?? [])[l] ?? 0) >> d) & 1) terms.push(cl)
      }
    return orOf(terms, LOW, ctx, `row${d}`)
  })

  // COLUMN MUX: the dot counter selects one of the 8 row bits → the serial VIDEO bit.
  const dotOH = oneHotSel([dotB(0), dotB(1), dotB(2)], [0, 1, 2, 3, 4, 5, 6, 7], ctx, 'do')
  const sel = [0, 1, 2, 3, 4, 5, 6, 7].map((d) =>
    buildExpr(['and', row[d] ?? LOW, mustGet(dotOH, d)], ctx),
  )
  const video = orOf(sel, LOW, ctx, 'vid')

  nodes.push(...ctx.nodes)
  edges.push(...ctx.edges)
  edges.push(...chainRails(['scan', ...ctx.ids], 'cg'))

  const ports: BlockData['ports'] = [
    {
      id: 'clk',
      label: 'CLK',
      side: 'left',
      offset: 14,
      inner: { nodeId: 'scan', handleId: 'clk' },
    },
    {
      id: 'clr',
      label: 'CLR',
      side: 'left',
      offset: 28,
      inner: { nodeId: 'scan', handleId: 'clr' },
    },
    {
      id: 'gnd',
      label: 'GND',
      side: 'left',
      offset: 42,
      inner: { nodeId: 'scan', handleId: 'gnd' },
    },
    {
      id: 'video',
      label: 'VIDEO',
      side: 'right',
      offset: 14,
      drive: 'push_pull',
      inner: { nodeId: video.node, handleId: video.handle },
    },
    {
      id: 'v_dd',
      label: 'V+',
      side: 'right',
      offset: 28,
      inner: { nodeId: 'scan', handleId: 'v_dd' },
    },
  ]
  return { name: 'Character Generator', origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** The HELLO WORLD character generator: scan counters + message/font ROMs + column mux → video bit. */
export const CHAR_GEN: BlockData = buildCharGen()

// ==============================================================================================
// MICROPROCESSOR ON-RAMP — a minimal stored-program CPU from real gates, the era-6 destination.
// A SAP-1-DERIVED teaching computer (A. Malvino & J. Brown, "Digital Computer Electronics", 3rd
// ed.; ADD/SUB/OUT/HLT are SAP-1, LDI/JMP/JZ are SAP-2-level), 4-bit to match the existing
// nibble-wide blocks. Every part is a real gate composition that flattens to the FAST LOGIC engine
// (so it simulates at gate speed, not the transistor scaling wall), and NOTHING sequences it in
// code — a real clocked gate control does, exactly like the calculator's control unit. Increment
// 1 here is the FETCH ENGINE: the machine reads a stored program out of memory, one instruction at
// a time. Decode + execute, control flow, and data memory land in later increments.
// ==============================================================================================

/**
 * An N-bit register WITH a LOAD ENABLE — N D flip-flops, each fronted by a per-bit 2:1 mux so the
 * bit LOADS its D input when LOAD is high and HOLDS its own Q when LOAD is low (D = LOAD ? D_in :
 * Q). A CPU's instruction register needs this: a plain register latches on every clock edge, but a
 * CPU register must hold its word across all the edges when the control unit isn't loading it.
 */
function buildRegisterLoad(bits: number): BlockData {
  const nodes: BlockData['nodes'] = []
  const edges: BlockData['edges'] = []
  const ports: BlockData['ports'] = []
  const rail: string[] = []
  for (let i = 0; i < bits; i++) {
    nodes.push({ id: `mx${i}`, definition: 'block', x: 120, y: 30 + i * 260, block: MUX2_1BIT })
    nodes.push({
      id: `ff${i}`,
      definition: 'block',
      x: 420,
      y: 30 + i * 260,
      block: D_FLIPFLOP_BLOCK,
    })
    rail.push(`mx${i}`, `ff${i}`)
    edges.push({
      id: `hold${i}`,
      source: `ff${i}`,
      sourceHandle: 'q',
      target: `mx${i}`,
      targetHandle: 'y',
    })
    edges.push({
      id: `d${i}`,
      source: `mx${i}`,
      sourceHandle: 'out',
      target: `ff${i}`,
      targetHandle: 'd',
    })
    if (i > 0) {
      edges.push({
        id: `ld${i}`,
        source: 'mx0',
        sourceHandle: 'sel',
        target: `mx${i}`,
        targetHandle: 'sel',
      })
      edges.push({
        id: `clk${i}`,
        source: 'ff0',
        sourceHandle: 'clk',
        target: `ff${i}`,
        targetHandle: 'clk',
      })
    }
  }
  edges.push(...chainRails(rail, 'rl'))
  let left = 14
  for (let i = 0; i < bits; i++) {
    ports.push({
      id: `d${i}`,
      label: `D${i}`,
      side: 'left',
      offset: left,
      inner: { nodeId: `mx${i}`, handleId: 'x' },
    })
    left += 14
  }
  ports.push({
    id: 'load',
    label: 'LOAD',
    side: 'left',
    offset: left,
    inner: { nodeId: 'mx0', handleId: 'sel' },
  })
  left += 14
  ports.push({
    id: 'clk',
    label: 'CLK',
    side: 'left',
    offset: left,
    inner: { nodeId: 'ff0', handleId: 'clk' },
  })
  left += 14
  ports.push({
    id: 'gnd',
    label: 'GND',
    side: 'left',
    offset: left,
    inner: { nodeId: 'ff0', handleId: 'gnd' },
  })
  let right = 14
  for (let i = 0; i < bits; i++) {
    ports.push({
      id: `q${i}`,
      label: `Q${i}`,
      side: 'right',
      offset: right,
      inner: { nodeId: `ff${i}`, handleId: 'q' },
    })
    right += 14
  }
  ports.push({
    id: 'v_dd',
    label: 'V+',
    side: 'right',
    offset: right,
    inner: { nodeId: 'ff0', handleId: 'v_dd' },
  })
  return { name: `${bits}-bit Register (load-enable)`, origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/**
 * INSTRUCTION ROM (16 words × 8 bits) — the stored program, held in REAL GATES. A 4-bit address
 * (from the program counter) drives a 4-to-16 one-hot decoder (one minterm line per address); each
 * of the 8 data-out bits is the OR of the address lines where that bit is a 1 in the program — the
 * decoder + OR-plane ROM/PLA the same way binaryToSevenSegment bakes the hex font into gates. The
 * PROGRAM is the OR-plane WIRING, chosen at build time. The simulation only ever evaluates gates:
 * nothing reads the program table at run time (that would be code-in-the-loop, not a real ROM). A
 * bit that is 0 in every word ties low (no minterm). Addresses past the program read 0 (a HLT).
 */
function buildInstructionRom(program: number[]): BlockData {
  const nodes: BlockData['nodes'] = [
    { id: 'dec', definition: 'block', x: 0, y: 0, block: binaryDecoder(4) },
  ]
  const edges: BlockData['edges'] = []
  const ports: BlockData['ports'] = []
  const rail: string[] = ['dec']
  const LOW: LogicRef = { node: 'dec', handle: 'gnd' }
  const dataRefs: LogicRef[] = []
  for (let b = 0; b < 8; b++) {
    const terms: LogicRef[] = []
    for (let addr = 0; addr < 16; addr++) {
      if ((((program[addr] ?? 0) >> b) & 1) === 1) terms.push({ node: 'dec', handle: `y${addr}` })
    }
    if (terms.length === 0) {
      dataRefs.push(LOW) // this bit is 0 in every word — tie the output low
    } else {
      const tree = orReduce(terms, `rd${b}`, 1200 + b * 200)
      nodes.push(...tree.nodes)
      edges.push(...tree.edges)
      rail.push(...tree.ids)
      dataRefs.push(tree.out)
    }
  }
  edges.push(...chainRails(rail, 'rom'))
  let left = 14
  for (let i = 0; i < 4; i++) {
    ports.push({
      id: `a${i}`,
      label: `A${i}`,
      side: 'left',
      offset: left,
      inner: { nodeId: 'dec', handleId: `a${i}` },
    })
    left += 16
  }
  ports.push({
    id: 'gnd',
    label: 'GND',
    side: 'left',
    offset: left,
    inner: { nodeId: 'dec', handleId: 'gnd' },
  })
  let right = 14
  for (let b = 0; b < 8; b++) {
    const ref = dataRefs[b]
    if (ref === undefined) continue
    ports.push({
      id: `d${b}`,
      label: `D${b}`,
      side: 'right',
      offset: right,
      inner: { nodeId: ref.node, handleId: ref.handle },
    })
    right += 16
  }
  ports.push({
    id: 'v_dd',
    label: 'V+',
    side: 'right',
    offset: right,
    inner: { nodeId: 'dec', handleId: 'v_dd' },
  })
  return { name: 'Instruction ROM (16×8)', origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** The CPU on-ramp's instruction set — SAP-1-derived (Malvino & Brown). Each 8-bit word is an
 *  OPCODE (high nibble → D4..D7) plus a 4-bit OPERAND (low nibble → D0..D3). */
export const CPU_OPCODES = {
  HLT: 0x0,
  LDI: 0x1,
  ADD: 0x2,
  SUB: 0x3,
  OUT: 0x4,
  JMP: 0x5,
  JZ: 0x6,
} as const
export const cpuInstr = (op: number, operand = 0): number => ((op & 0xf) << 4) | (operand & 0xf)

/** The shipped demo program — 3 + 4 = 7, show it, halt. Execute lands in increment 2; increment 1
 *  proves the machine FETCHES these words out of the ROM in program order. */
export const CPU_DEMO_PROGRAM: number[] = [
  cpuInstr(CPU_OPCODES.LDI, 3), // 0: ACC ← 3
  cpuInstr(CPU_OPCODES.ADD, 4), // 1: ACC ← ACC + 4  (= 7)
  cpuInstr(CPU_OPCODES.OUT), //    2: show ACC
  cpuInstr(CPU_OPCODES.HLT), //    3: stop
]

/**
 * FETCH ENGINE (CPU on-ramp, increment 1) — the stored-program heart, all real clocked gates on
 * the fast logic engine: a PROGRAM COUNTER (loadable up-counter) walking an INSTRUCTION ROM
 * through an INSTRUCTION REGISTER, sequenced by a real gate control (a binary T-state counter +
 * one-hot decoder — never a code loop). Each instruction is fetched in two clocked microsteps:
 *   T0  IR ← ROM[PC]        (load the instruction at the program counter)
 *   T1  PC ← PC + 1         (advance to the next instruction) and reset the T-counter to T0
 * so the IR presents the program's words one per instruction cycle. RESET synchronously homes
 * PC = 0 and T = 0 (a real reset pin; all-zero power-up already lands on T0, but RESET makes it
 * explicit and lets a program restart). The PC-load inputs (LOADPC + PL0..PL3) redirect the fetch
 * — a JMP — proving non-sequential flow; the control unit will drive them internally once JMP
 * lands (increment 3). No JS sequences any of this: the T-state counter + gate decode do it,
 * exactly the buildCalcControlFsm discipline. Descend to see the counters, ROM, register, decoder.
 */
export function buildFetchEngine(program: number[] = CPU_DEMO_PROGRAM): BlockData {
  const nodes: BlockData['nodes'] = [
    { id: 'pc', definition: 'block', x: 0, y: 0, block: COUNTER_UP_EN_4 },
    { id: 'rom', definition: 'block', x: 1400, y: 0, block: buildInstructionRom(program) },
    { id: 'ir', definition: 'block', x: 2800, y: 0, block: buildRegisterLoad(8) },
    { id: 'tcnt', definition: 'block', x: 0, y: 4000, block: COUNTER_UP_EN_3 },
    { id: 'tdec', definition: 'block', x: 1000, y: 4000, block: BINARY_DECODER_3_8 },
  ]
  const edges: BlockData['edges'] = []
  let ei = 0
  const e = (s: string, sh: string, t: string, th: string) => {
    edges.push({ id: `f${ei++}`, source: s, sourceHandle: sh, target: t, targetHandle: th })
  }
  // datapath: PC → ROM address; ROM data → IR; T-counter → T-state decoder
  for (let i = 0; i < 4; i++) e('pc', `q${i}`, 'rom', `a${i}`)
  for (let b = 0; b < 8; b++) e('rom', `d${b}`, 'ir', `d${b}`)
  for (let i = 0; i < 3; i++) e('tcnt', `q${i}`, 'tdec', `a${i}`)
  // one shared clock fanned to every sequential sub-block
  e('pc', 'clk', 'ir', 'clk')
  e('pc', 'clk', 'tcnt', 'clk')

  // buffered external control inputs (a real chip's pins) — the FSM-input pattern.
  const ctrlIns = ['reset', 'loadpc', 'pl0', 'pl1', 'pl2', 'pl3']
  ctrlIns.forEach((s, i) => {
    nodes.push({
      id: `buf_${s}`,
      definition: 'block',
      x: -600,
      y: 30 + i * 260,
      block: BUFFER_BLOCK,
    })
  })
  const IN = (s: string): LogicRef => ({ node: `buf_${s}`, handle: 'out' })
  const HIGH: LogicRef = { node: 'pc', handle: 'v_dd' }
  const LOW: LogicRef = { node: 'pc', handle: 'gnd' }
  const RESET = IN('reset')

  // combinational control (real gates via buildExpr):
  //   IR loads at T0; PC increments at T1; the T-counter resets to 0 at T1 (2-state fetch cycle).
  //   PC loads on RESET (value 0) or an external JMP (LOADPC, value PL). T-counter enable is always
  //   on, its load = RESET or T1 with load value 0.
  const ctx: ExprCtx = { nodes: [], edges: [], ids: [], n: 0 }
  const pcLoad = buildExpr(['or', RESET, IN('loadpc')], ctx) // RESET or JMP
  const notReset = buildExpr(['not', RESET], ctx)
  const pcLval = [0, 1, 2, 3].map((i) => buildExpr(['and', IN(`pl${i}`), notReset], ctx)) // 0 on RESET, else PL
  const tLoad = buildExpr(['or', RESET, { node: 'tdec', handle: 'y1' }], ctx) // reset the T-counter at T1
  nodes.push(...ctx.nodes)
  edges.push(...ctx.edges)

  const link = (ref: LogicRef, node: string, port: string) => {
    edges.push({
      id: `f${ei++}`,
      source: ref.node,
      sourceHandle: ref.handle,
      target: node,
      targetHandle: port,
    })
  }
  // IR load = T0; PC enable (increment) = T1 — direct one-hot lines off the T decoder
  e('tdec', 'y0', 'ir', 'load')
  e('tdec', 'y1', 'pc', 'en')
  // PC load + load value
  link(pcLoad, 'pc', 'load')
  pcLval.forEach((ref, i) => {
    link(ref, 'pc', `l${i}`)
  })
  // T-counter: always enabled, reset (load 0) at T1 / RESET
  link(HIGH, 'tcnt', 'en')
  link(tLoad, 'tcnt', 'load')
  link(LOW, 'tcnt', 'l0')
  link(LOW, 'tcnt', 'l1')
  link(LOW, 'tcnt', 'l2')

  edges.push(
    ...chainRails(
      ['pc', 'rom', 'ir', 'tcnt', 'tdec', ...ctrlIns.map((s) => `buf_${s}`), ...ctx.ids],
      'fe',
    ),
  )

  const ports: BlockData['ports'] = []
  let left = 14
  ports.push({
    id: 'clk',
    label: 'CLK',
    side: 'left',
    offset: left,
    inner: { nodeId: 'pc', handleId: 'clk' },
  })
  left += 14
  ports.push({
    id: 'reset',
    label: 'RST',
    side: 'left',
    offset: left,
    inner: { nodeId: 'buf_reset', handleId: 'in' },
  })
  left += 14
  ports.push({
    id: 'loadpc',
    label: 'LDPC',
    side: 'left',
    offset: left,
    inner: { nodeId: 'buf_loadpc', handleId: 'in' },
  })
  left += 14
  for (let i = 0; i < 4; i++) {
    ports.push({
      id: `pl${i}`,
      label: `PL${i}`,
      side: 'left',
      offset: left,
      inner: { nodeId: `buf_pl${i}`, handleId: 'in' },
    })
    left += 14
  }
  ports.push({
    id: 'gnd',
    label: 'GND',
    side: 'left',
    offset: left,
    inner: { nodeId: 'pc', handleId: 'gnd' },
  })
  let right = 14
  for (let b = 0; b < 8; b++) {
    ports.push({
      id: `ir${b}`,
      label: `IR${b}`,
      side: 'right',
      offset: right,
      inner: { nodeId: 'ir', handleId: `q${b}` },
    })
    right += 14
  }
  for (let i = 0; i < 4; i++) {
    ports.push({
      id: `pc${i}`,
      label: `PC${i}`,
      side: 'right',
      offset: right,
      inner: { nodeId: 'pc', handleId: `q${i}` },
    })
    right += 14
  }
  ports.push({
    id: 'v_dd',
    label: 'V+',
    side: 'right',
    offset: right,
    inner: { nodeId: 'pc', handleId: 'v_dd' },
  })
  return { name: 'CPU Fetch Engine', origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** The CPU on-ramp's fetch engine — PC + instruction ROM + IR + a real gate T-state sequencer. */
export const CPU_FETCH_ENGINE: BlockData = buildFetchEngine()

/**
 * THE CPU (fetch + decode + execute + control flow) — CPU on-ramp increments 2–3. The fetch engine's
 * PC + instruction ROM + IR + T-state sequencer, with a real DATAPATH: an ACCUMULATOR, the 4-bit
 * adder/subtractor as the ALU, an OPCODE DECODER, and an OUTPUT REGISTER — every one a gate block, so
 * the whole processor still flattens to the fast logic engine (no transistor wall). It runs a tiny
 * instruction set on real clocked gates, THREE microsteps per instruction, with nothing sequenced in
 * code — the T-state counter + gate decode drive it, exactly the buildCalcControlFsm discipline:
 *   T0  IR ← ROM[PC]     load the instruction
 *   T1  PC ← PC + 1      advance the program counter
 *   T2  execute          and reset the T-counter for the next instruction
 * The instructions:
 *   LDI n   ACC ← n            (the ALU's A side is gated to 0, so the one adder computes 0 + operand)
 *   ADD n   ACC ← ACC + n
 *   SUB n   ACC ← ACC − n      (two's complement; a 4-bit machine, so results wrap mod 16)
 *   OUT     OUTREG ← ACC       (the output register's Q is the machine's result; its data comes
 *                               straight off the accumulator, NOT through the ALU, so the operand
 *                               field of an OUT can never leak into the shown value)
 *   JMP a   PC ← a             (unconditional jump — the operand is the target address 0..15)
 *   JZ a    PC ← a if ACC == 0 (conditional jump — the ZERO flag is a NOR of the accumulator bits)
 *   HLT     stop               (a self-holding HALT flip-flop freezes the machine in gates: NOT-HALT
 *                               holds the PC, IR, and T-counter, so no clock edge changes state; the
 *                               HALT output lets the JS harness stop clocking. RESET clears it.)
 * Every arithmetic op flows through the ONE adder/subtractor. The accumulator is a master-slave
 * register, so at T2 it feeds its OLD value into the ALU while the same clock edge latches the new one
 * — no feedback race (the proven calculator ACC↔ALU pattern). PC-load is INTERNAL: RESET homes it to 0,
 * a taken jump loads the operand (the T1 increment is overwritten because load wins over count). The
 * program is baked into the ROM's gate OR-plane at build time. The accumulator and output register
 * power up undefined — a program must LDI before it reads the accumulator, and OUT is meaningful only
 * after it executes. With JMP + JZ the machine can loop and branch. Descend to see the datapath.
 */
export function buildCpu(program: number[] = CPU_DEMO_PROGRAM): BlockData {
  const nodes: BlockData['nodes'] = [
    { id: 'pc', definition: 'block', x: 0, y: 0, block: COUNTER_UP_EN_4 },
    { id: 'rom', definition: 'block', x: 1400, y: 0, block: buildInstructionRom(program) },
    { id: 'ir', definition: 'block', x: 2800, y: 0, block: buildRegisterLoad(8) },
    { id: 'tcnt', definition: 'block', x: 0, y: 4000, block: COUNTER_UP_EN_3 },
    { id: 'tdec', definition: 'block', x: 1000, y: 4000, block: BINARY_DECODER_3_8 },
    { id: 'opdec', definition: 'block', x: 2800, y: 4000, block: binaryDecoder(4) },
    { id: 'acc', definition: 'block', x: 4200, y: 0, block: buildRegisterLoad(4) },
    { id: 'alu', definition: 'block', x: 4200, y: 2200, block: CALCULATOR_4BIT },
    { id: 'outreg', definition: 'block', x: 5600, y: 0, block: buildRegisterLoad(4) },
    { id: 'halt', definition: 'block', x: 5600, y: 2200, block: D_FLIPFLOP_BLOCK },
  ]
  const edges: BlockData['edges'] = []
  let ei = 0
  const e = (s: string, sh: string, t: string, th: string) => {
    edges.push({ id: `c${ei++}`, source: s, sourceHandle: sh, target: t, targetHandle: th })
  }
  // datapath
  for (let i = 0; i < 4; i++) e('pc', `q${i}`, 'rom', `a${i}`) // PC → ROM address
  for (let b = 0; b < 8; b++) e('rom', `d${b}`, 'ir', `d${b}`) // ROM word → IR
  for (let i = 0; i < 3; i++) e('tcnt', `q${i}`, 'tdec', `a${i}`) // T-counter → T-state decoder
  for (let i = 0; i < 4; i++) e('ir', `q${4 + i}`, 'opdec', `a${i}`) // IR opcode nibble → opcode decoder
  for (let i = 0; i < 4; i++) e('ir', `q${i}`, 'alu', `b${i}`) // IR operand nibble → ALU B
  for (let i = 0; i < 4; i++) e('alu', `s${i}`, 'acc', `d${i}`) // ALU result → ACC data
  for (let i = 0; i < 4; i++) e('acc', `q${i}`, 'outreg', `d${i}`) // ACC → OUT register data (direct)
  // one shared clock, fanned to every sequential sub-block
  e('pc', 'clk', 'ir', 'clk')
  e('pc', 'clk', 'tcnt', 'clk')
  e('pc', 'clk', 'acc', 'clk')
  e('pc', 'clk', 'outreg', 'clk')
  e('pc', 'clk', 'halt', 'clk') // the HALT latch shares the one clock

  // buffered external control input. RESET is the ONLY external control now — JMP/JZ drive the program
  // counter INTERNALLY (the fetch engine's external loadpc/pl scaffold is retired here).
  const ctrlIns = ['reset']
  ctrlIns.forEach((s, i) => {
    nodes.push({
      id: `buf_${s}`,
      definition: 'block',
      x: -600,
      y: 30 + i * 260,
      block: BUFFER_BLOCK,
    })
  })
  const IN = (s: string): LogicRef => ({ node: `buf_${s}`, handle: 'out' })
  const LOW: LogicRef = { node: 'pc', handle: 'gnd' }
  const RESET = IN('reset')

  // opcode one-hot lines off the opcode decoder — each is one instruction; the decoder lights exactly one
  const isLdi: LogicRef = { node: 'opdec', handle: 'y1' }
  const isAdd: LogicRef = { node: 'opdec', handle: 'y2' }
  const isSub: LogicRef = { node: 'opdec', handle: 'y3' }
  const isOut: LogicRef = { node: 'opdec', handle: 'y4' }
  const isJmp: LogicRef = { node: 'opdec', handle: 'y5' }
  const isJz: LogicRef = { node: 'opdec', handle: 'y6' }
  const isHlt: LogicRef = { node: 'opdec', handle: 'y0' }
  const t2: LogicRef = { node: 'tdec', handle: 'y2' } // the execute microstep

  // combinational control (real gates via buildExpr) plus the HALT latch.
  const ctx: ExprCtx = { nodes: [], edges: [], ids: [], n: 0 }
  const notReset = buildExpr(['not', RESET], ctx)
  const notLdi = buildExpr(['not', isLdi], ctx)

  // HALT — a self-holding flip-flop. It SETS when a HLT reaches execute and then holds itself set, so
  // the machine freezes; RESET clears it. NOT-HALT gates every advance below, so once halted no clock
  // edge changes any state (the JS harness also reads HALT and stops clocking — the calcSolve pattern).
  const haltQ: LogicRef = { node: 'halt', handle: 'q' }
  const notHalt = buildExpr(['not', haltQ], ctx)
  const haltSet = buildExpr(['and', isHlt, t2], ctx)
  const haltD = buildExpr(['and', notReset, ['or', haltQ, haltSet]], ctx) // hold once set; RESET clears

  // ZERO flag — NOR of the accumulator bits, high exactly when ACC == 0. Read combinationally off the
  // accumulator; equivalent to a latched zero flag here, since only LDI/ADD/SUB change ACC and it holds.
  const accIsZero = buildExpr(
    [
      'not',
      [
        'or',
        ['or', { node: 'acc', handle: 'q0' }, { node: 'acc', handle: 'q1' }],
        ['or', { node: 'acc', handle: 'q2' }, { node: 'acc', handle: 'q3' }],
      ],
    ],
    ctx,
  )

  // control flow — a jump is taken by JMP always, or by JZ when the accumulator is zero. On a taken jump
  // the PC loads the operand (the target address 0..15); RESET homes it to 0. The T1 increment still
  // happens, but a T2 load overwrites it (load wins over count), so the jump target wins.
  const jumpTaken = buildExpr(['or', isJmp, ['and', isJz, accIsZero]], ctx)
  const pcJump = buildExpr(['and', t2, jumpTaken], ctx)
  const pcLoad = buildExpr(['or', RESET, pcJump], ctx)
  const pcLval = [0, 1, 2, 3].map((i) =>
    buildExpr(['and', { node: 'ir', handle: `q${i}` }, notReset], ctx),
  ) // jump target = the operand nibble, 0 on RESET

  // fetch + sequencer control, held by NOT-HALT so a halted machine cannot advance
  const irLoad = buildExpr(['and', { node: 'tdec', handle: 'y0' }, notHalt], ctx) // IR load = T0
  const pcInc = buildExpr(['and', { node: 'tdec', handle: 'y1' }, notHalt], ctx) // PC increment = T1
  const tLoad = buildExpr(['or', RESET, ['and', t2, notHalt]], ctx) // reset the T-counter at T2 (RESET wins)
  const accLoad = buildExpr(['and', t2, ['or', isLdi, ['or', isAdd, isSub]]], ctx) // ACC latches on execute
  const outLoad = buildExpr(['and', t2, isOut], ctx) // OUT captures ACC on execute
  // ALU A = ACC, forced to 0 during LDI so the one adder computes 0 + operand
  const aGate = [0, 1, 2, 3].map((i) =>
    buildExpr(['and', { node: 'acc', handle: `q${i}` }, notLdi], ctx),
  )
  nodes.push(...ctx.nodes)
  edges.push(...ctx.edges)

  const link = (ref: LogicRef, node: string, port: string) => {
    edges.push({
      id: `c${ei++}`,
      source: ref.node,
      sourceHandle: ref.handle,
      target: node,
      targetHandle: port,
    })
  }
  // fetch + freeze control (gated decoder lines — held when the machine is halted)
  link(irLoad, 'ir', 'load') // IR load = T0
  link(pcInc, 'pc', 'en') // PC increment = T1
  link(pcLoad, 'pc', 'load')
  pcLval.forEach((ref, i) => {
    link(ref, 'pc', `l${i}`)
  })
  link(notHalt, 'tcnt', 'en') // the T-counter runs unless the machine is halted
  link(tLoad, 'tcnt', 'load')
  link(LOW, 'tcnt', 'l0')
  link(LOW, 'tcnt', 'l1')
  link(LOW, 'tcnt', 'l2')
  link(haltD, 'halt', 'd') // drive the self-holding HALT latch
  // execute control
  link(isSub, 'alu', 'sub') // ALU mode = the SUB opcode
  aGate.forEach((ref, i) => {
    link(ref, 'alu', `a${i}`)
  })
  link(accLoad, 'acc', 'load')
  link(outLoad, 'outreg', 'load')

  edges.push(
    ...chainRails(
      [
        'pc',
        'rom',
        'ir',
        'tcnt',
        'tdec',
        'opdec',
        'alu',
        'acc',
        'outreg',
        'halt',
        ...ctrlIns.map((s) => `buf_${s}`),
        ...ctx.ids,
      ],
      'cpu',
    ),
  )

  const ports: BlockData['ports'] = []
  let left = 14
  ports.push({
    id: 'clk',
    label: 'CLK',
    side: 'left',
    offset: left,
    inner: { nodeId: 'pc', handleId: 'clk' },
  })
  left += 14
  ports.push({
    id: 'reset',
    label: 'RST',
    side: 'left',
    offset: left,
    inner: { nodeId: 'buf_reset', handleId: 'in' },
  })
  left += 14
  ports.push({
    id: 'gnd',
    label: 'GND',
    side: 'left',
    offset: left,
    inner: { nodeId: 'pc', handleId: 'gnd' },
  })
  let right = 14
  for (let i = 0; i < 4; i++) {
    ports.push({
      id: `acc${i}`,
      label: `ACC${i}`,
      side: 'right',
      offset: right,
      inner: { nodeId: 'acc', handleId: `q${i}` },
    })
    right += 14
  }
  for (let i = 0; i < 4; i++) {
    ports.push({
      id: `out${i}`,
      label: `OUT${i}`,
      side: 'right',
      offset: right,
      inner: { nodeId: 'outreg', handleId: `q${i}` },
    })
    right += 14
  }
  for (let i = 0; i < 4; i++) {
    ports.push({
      id: `pc${i}`,
      label: `PC${i}`,
      side: 'right',
      offset: right,
      inner: { nodeId: 'pc', handleId: `q${i}` },
    })
    right += 14
  }
  ports.push({
    id: 'halt',
    label: 'HALT',
    side: 'right',
    offset: right,
    inner: { nodeId: 'halt', handleId: 'q' },
  })
  right += 14
  ports.push({
    id: 'v_dd',
    label: 'V+',
    side: 'right',
    offset: right,
    inner: { nodeId: 'pc', handleId: 'v_dd' },
  })
  return { name: 'CPU (4-bit)', origin: { x: 0, y: 0 }, nodes, edges, ports }
}

/** The 4-bit teaching CPU — fetch + decode + execute + control flow (LDI/ADD/SUB/OUT/JMP/JZ/HLT),
 *  all real clocked gates on the fast logic engine. */
export const CPU_4BIT: BlockData = buildCpu()

/** Built-in blocks droppable from the palette, keyed by their palette definition id.
 *  The palette lists these like parts; App's drop handler turns one into a block node
 *  (a fresh deep copy) that descends + flattens like any user-grouped block. */
export const BUILTIN_BLOCKS: Record<string, BlockData> = {
  op_amp: OPAMP_BLOCK,
  logic_not: INVERTER_BLOCK,
  logic_nand: NAND2_BLOCK,
  logic_nor: NOR2_BLOCK,
  logic_and: AND_BLOCK,
  logic_or: OR_BLOCK,
  logic_xor: XOR_BLOCK,
  logic_xnor: XNOR_BLOCK,
  logic_buffer: BUFFER_BLOCK,
  logic_half_adder: HALF_ADDER_BLOCK,
  logic_full_adder: FULL_ADDER_BLOCK,
  logic_adder_2bit: RIPPLE_CARRY_2BIT,
  logic_adder_4bit: RIPPLE_CARRY_4BIT,
  logic_calculator_4bit: CALCULATOR_4BIT,
  logic_bcd_adder: BCD_ADDER_BLOCK,
  logic_bcd_adder_10: BCD_ADDER_10,
  logic_bcd_complementer: BCD_COMPLEMENTER_DIGIT,
  logic_bcd_alu_10: BCD_ALU_10,
  logic_bcd_alu_cell: BCD_ALU_CELL,
  logic_decoder_2_4: BINARY_DECODER_2_4,
  logic_decoder_3_8: BINARY_DECODER_3_8,
  logic_encoder_4_2: PRIORITY_ENCODER_4_2,
  logic_encoder_8_3: PRIORITY_ENCODER_8_3,
  logic_decoder_7seg: HEX_DECODER_7SEG,
  logic_bcd_decoder_10: BCD_DECODER_10,
  logic_sr_latch: SR_LATCH_BLOCK,
  logic_d_latch: D_LATCH_BLOCK,
  logic_d_flipflop: D_FLIPFLOP_BLOCK,
  logic_register_4bit: REGISTER_4BIT,
  logic_register_bcd: BCD_REGISTER_10,
  cpu_fetch_engine: CPU_FETCH_ENGINE,
  cpu_4bit: CPU_4BIT,
  memory_sram_cell: SRAM_CELL_BLOCK,
  memory_sram_word_4bit: SRAM_WORD_4BIT,
  display_seven_segment: SEVEN_SEGMENT_DISPLAY,
  display_separator: DISPLAY_SEPARATOR,
  dot_matrix_5x7: DOT_MATRIX_5X7,
  glyph_rom_5x7: GLYPH_ROM_5X7,
  dot_matrix_rgb_7x7: DOT_MATRIX_RGB_7X7,
  dot_matrix_mux_8x8: DOT_MATRIX_MUX_8X8,
  dot_matrix_mux_16x16: DOT_MATRIX_MUX_16X16,
  active_matrix_pixel: ACTIVE_MATRIX_PIXEL,
  row_scanner_8: ROW_SCANNER_8,
  row_scanner_16: ROW_SCANNER_16,
  row_scanner_32: ROW_SCANNER_32,
  display_seven_segment_bare: SEVEN_SEGMENT_BARE,
  // Every multi-digit size in DIGIT_DISPLAY_SIZES — the shipped module (with resistors) and the bare
  // raw version (LEDs only), both from the one parameterized generator.
  ...Object.fromEntries(
    DIGIT_DISPLAY_SIZES.map((n) => [`display_seven_segment_${n}`, multiDigitDisplay(n)]),
  ),
  ...Object.fromEntries(
    DIGIT_DISPLAY_SIZES.map((n) => [
      `display_seven_segment_bare_${n}`,
      multiDigitDisplay(n, false),
    ]),
  ),
  darlington_npn: DARLINGTON_BLOCK,
  photo_darlington: PHOTO_DARLINGTON_BLOCK,
}
