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
 *  flip-flops. The control unit (calc-control.ts) sequences loads into this; bit b carries digit
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
  const outs = ['d0', 'd1', 'd2', 'd3', 'digit', 'op0', 'op1', 'is_op', 'is_eq', 'is_clr', 'is_pm']
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

  const inputs = ['digit', 'isop', 'iseq', 'isclr', 'op0', 'op1']
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

  const stateFFs = ['f', 'v', 'op0r', 'op1r']
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

  // control outputs (Mealy)
  const entryNew = buildExpr(['and', DIGIT, F], ctx)
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
  const fNext = buildExpr(['or', setf1, ['and', F, ['not', DIGIT]]], ctx)
  const vNext = buildExpr(['or', ISOP, ['and', V, ['and', ['not', ISEQ], ['not', ISCLR]]]], ctx)
  const holdOp: LogicExpr = ['and', ['not', ISOP], ['not', ISCLR]]
  const op0Next = buildExpr(['or', ['and', ISOP, OP0], ['and', OP0R, holdOp]], ctx)
  const op1Next = buildExpr(['or', ['and', ISOP, OP1], ['and', OP1R, holdOp]], ctx)

  link(fNext, { node: 'ff_f', handle: 'd' })
  link(vNext, { node: 'ff_v', handle: 'd' })
  link(op0Next, { node: 'ff_op0r', handle: 'd' })
  link(op1Next, { node: 'ff_op1r', handle: 'd' })
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
  edges.push(...chainRails(['seq', 'preg', 'breg', 'inner', 'outer', 'alu'], 'mul'))

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
function buildDivider(): BlockData {
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
  tie('outer', 'l0', LOW)
  tie('outer', 'l1', HIGH)
  tie('outer', 'l2', LOW)
  tie('outer', 'l3', HIGH) // outer loads 10
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
  // shared clock
  for (const blk of ['areg', 'rreg', 'qreg', 'count', 'outer']) e('seq', 'clk', blk, 'clk')
  edges.push(
    ...chainRails(
      ['seq', 'areg', 'rreg', 'qreg', 'count', 'outer', 'alu', ...bz.ids, 'bzero_inv'],
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
    { id: 'div', definition: 'block', x: 11000, y: 64000, block: DIVIDER_10 },
  ]
  const edges: BlockData['edges'] = []
  let ei = 0
  const e = (s: string, sh: string, t: string, th: string) => {
    edges.push({ id: `c${ei++}`, source: s, sourceHandle: sh, target: t, targetHandle: th })
  }
  const ctx: ExprCtx = { nodes, edges, ids: [], n: 0 }
  const rail: string[] = ['enc', 'fsm', 'ctrl', 'ent', 'acc', 'alu', 'mul', 'div']
  const link = (from: LogicRef, to: LogicRef) => e(from.node, from.handle, to.node, to.handle)
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

  // encoder → FSM + entry-digit
  e('enc', 'digit', 'fsm', 'digit')
  e('enc', 'is_op', 'fsm', 'isop')
  e('enc', 'is_eq', 'fsm', 'iseq')
  e('enc', 'is_clr', 'fsm', 'isclr')
  e('enc', 'op0', 'fsm', 'op0')
  e('enc', 'op1', 'fsm', 'op1')
  for (let b = 0; b < 4; b++) e('enc', `d${b}`, 'ent', `keypad${b}`)
  // FSM → controller; controller → sequencers
  e('fsm', 'compute', 'ctrl', 'compute')
  e('fsm', 'alu_mul', 'ctrl', 'is_mul')
  e('fsm', 'alu_div', 'ctrl', 'is_div')
  e('ctrl', 'start_mul', 'mul', 'start')
  e('ctrl', 'start_div', 'div', 'start')
  // operands: ACC → a, ENTRY → b, for the ALU and both sequencers; ENTRY → ACC (copy source)
  for (let i = 0; i < 40; i++) {
    e('acc', `acc${i}`, 'alu', `a${i}`)
    e('acc', `acc${i}`, 'mul', `a${i}`)
    e('acc', `acc${i}`, 'div', `a${i}`)
    e('ent', `entry${i}`, 'alu', `b${i}`)
    e('ent', `entry${i}`, 'mul', `b${i}`)
    e('ent', `entry${i}`, 'div', `b${i}`)
    e('ent', `entry${i}`, 'acc', `entry${i}`)
  }
  e('fsm', 'alu_sub', 'alu', 'sub')
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
  const load = buildExpr(['or', computeAddSub, { node: 'ctrl', handle: 'capture' }], ctx)
  link(load, { node: 'ent', handle: 'compute' })
  link(load, { node: 'acc', handle: 'compute' })
  // result mux per bit: alu_mul ? product : (alu_div ? quotient : ALU sum) → both registers' result input
  for (let i = 0; i < 40; i++) {
    const m1 = newMux(
      { node: 'fsm', handle: 'alu_div' },
      { node: 'div', handle: `quotient${i}` },
      { node: 'alu', handle: `s${i}` },
    )
    const m2 = newMux(
      { node: 'fsm', handle: 'alu_mul' },
      { node: 'mul', handle: `product${i}` },
      m1,
    )
    link(m2, { node: 'ent', handle: `result${i}` })
    link(m2, { node: 'acc', handle: `result${i}` })
  }
  // clear the divider's sticky div-by-zero error on any new key activity (clear / operator / digit)
  link(
    buildExpr(
      [
        'or',
        ['or', { node: 'fsm', handle: 'clear' }, { node: 'fsm', handle: 'op_latch' }],
        { node: 'enc', handle: 'digit' },
      ],
      ctx,
    ),
    { node: 'div', handle: 'clear' },
  )
  // shared clock
  for (const blk of ['ent', 'acc', 'ctrl', 'mul', 'div']) e('fsm', 'clk', blk, 'clk')
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
    right += 6
  }
  ports.push({
    id: 'error',
    label: 'ERR',
    side: 'right',
    offset: right,
    inner: { nodeId: 'div', handleId: 'error' },
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
  logic_decoder_7seg: HEX_DECODER_7SEG,
  logic_bcd_decoder_10: BCD_DECODER_10,
  logic_sr_latch: SR_LATCH_BLOCK,
  logic_d_latch: D_LATCH_BLOCK,
  logic_d_flipflop: D_FLIPFLOP_BLOCK,
  logic_register_4bit: REGISTER_4BIT,
  logic_register_bcd: BCD_REGISTER_10,
  memory_sram_cell: SRAM_CELL_BLOCK,
  memory_sram_word_4bit: SRAM_WORD_4BIT,
  display_seven_segment: SEVEN_SEGMENT_DISPLAY,
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
