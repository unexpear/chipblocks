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
  logic_decoder_7seg: HEX_DECODER_7SEG,
  logic_sr_latch: SR_LATCH_BLOCK,
  logic_d_latch: D_LATCH_BLOCK,
  logic_d_flipflop: D_FLIPFLOP_BLOCK,
  logic_register_4bit: REGISTER_4BIT,
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
