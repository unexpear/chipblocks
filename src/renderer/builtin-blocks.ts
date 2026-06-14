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

/** Built-in blocks droppable from the palette, keyed by their palette definition id.
 *  The palette lists these like parts; App's drop handler turns one into a block node
 *  (a fresh deep copy) that descends + flattens like any user-grouped block. */
export const BUILTIN_BLOCKS: Record<string, BlockData> = {
  op_amp: OPAMP_BLOCK,
}
