/**
 * FPGA fabric — Stage 3a: "watch it run" (fpga-icebox-run.ts).
 * The closure of the round-trip: a design is synthesized to a bitstream, PARSED back, its netlist REBUILT from
 * the recovered cells + routed pips, and SIMULATED — and it computes the same function it started with. The
 * headline demo runs a real 2-LUT design (an AND feeding a buffer) entirely from its bitstream and gets the AND
 * truth table; reconstruction is also validated on the vendored real cell-to-cell slice.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import type { KLut } from '../src/renderer/fpga-fabric.ts'
import { parseIceboxChipdb } from '../src/renderer/fpga-icebox.ts'
import { parseLogicTileBits } from '../src/renderer/fpga-icebox-logic.ts'
import { parseBitstream } from '../src/renderer/fpga-icebox-parse.ts'
import { reconstructNetlist, simulateCombinational } from '../src/renderer/fpga-icebox-run.ts'
import { type Placement, synthesizeBitstream } from '../src/renderer/fpga-icebox-synth.ts'

const LAYOUT = parseLogicTileBits(
  readFileSync(
    new URL('../fixtures/icebox-ice40-384-logic-tile-bits.chipdb', import.meta.url),
    'utf8',
  ),
)

// A small hand-written device (the real chipdb grammar) that FULLY wires two cells on tile (1,1): cell 0's
// inputs + output, cell 1's input + output, and a routed switch from cell 0's output to cell 1's input 0. This
// lets a simulation exercise both cells' real logic — the vendored real slices only carry the A→B wire, not
// A's own inputs (validated separately below).
const WIRED_DEVICE = parseIceboxChipdb(
  [
    '.device T 8 8 5',
    '.net 0',
    '1 1 lutff_0/in_0',
    '.net 1',
    '1 1 lutff_0/in_1',
    '.net 2',
    '1 1 lutff_0/out',
    '.net 3',
    '1 1 lutff_1/in_0',
    '.net 4',
    '1 1 lutff_1/out',
    '.buffer 1 1 3 B0[14]', // route lutff_0/out (net 2) → lutff_1/in_0 (net 3)
    '1 2',
  ].join('\n'),
)

// A = i0 & i1 into net nA; B = a buffer of its pin 0, reading nA. So B's output should equal i0 & i1.
const A: KLut = {
  id: 'A',
  k: 2,
  config: [false, false, false, true],
  inputs: ['i0', 'i1'],
  output: 'nA',
}
const B: KLut = { id: 'B', k: 1, config: [false, true], inputs: ['nA'], output: 'nB' }
const wiredPlacement: Placement = new Map([
  ['A', { x: 1, y: 1, cell: 0 }],
  ['B', { x: 1, y: 1, cell: 1 }],
])

describe('reconstructNetlist + simulateCombinational — load a bitstream and watch it compute', () => {
  const design = synthesizeBitstream(WIRED_DEVICE, LAYOUT, [A, B], wiredPlacement)
  const parsed = parseBitstream(design.bitstream.bits, WIRED_DEVICE, LAYOUT)
  const netlist = reconstructNetlist(parsed, WIRED_DEVICE)

  test('the netlist is rebuilt from the bitstream: cell 1 reads cell 0, cell 0 reads primaries', () => {
    expect(design.routed).toBe(true)
    const a = netlist.cells.find((c) => c.ref.cell === 0)
    const b = netlist.cells.find((c) => c.ref.cell === 1)
    // cell 1's input pin 0 is driven by cell 0 (traced back through the routed pip), the rest unused
    expect(b?.inputs[0]).toEqual({ kind: 'cell', driver: { x: 1, y: 1, cell: 0 }, net: 3 })
    expect(b?.inputs[1]).toEqual({ kind: 'unused' })
    // cell 0's two inputs are primary (external), pins 2/3 unused
    expect(a?.inputs[0]).toEqual({ kind: 'primary', net: 0 })
    expect(a?.inputs[1]).toEqual({ kind: 'primary', net: 1 })
    expect(a?.inputs[2]).toEqual({ kind: 'unused' })
  })

  test('simulating the rebuilt netlist reproduces the design function: out = i0 & i1, straight from the bits', () => {
    for (const i0 of [false, true]) {
      for (const i1 of [false, true]) {
        // primaries are named by net: cell 0's in_0 = net 0, in_1 = net 1
        const sim = simulateCombinational(
          netlist,
          new Map([
            [0, i0],
            [1, i1],
          ]),
        )
        expect(sim.registered).toEqual([]) // purely combinational
        expect(sim.outputs.get('1_1_1')).toBe(i0 && i1) // cell 1's (B's) output = the AND
        expect(sim.outputs.get('1_1_0')).toBe(i0 && i1) // cell 0's (A's) output = i0 & i1
      }
    }
  })
})

describe('reconstructNetlist — recovers connectivity from the REAL vendored slice', () => {
  const DEVICE = parseIceboxChipdb(
    readFileSync(
      new URL('../fixtures/icebox-ice40-384-cell-to-cell.chipdb', import.meta.url),
      'utf8',
    ),
  )
  const P: KLut = {
    id: 'A',
    k: 2,
    config: [false, false, false, true],
    inputs: ['i0', 'i1'],
    output: 'nA',
  }
  const Q: KLut = {
    id: 'B',
    k: 2,
    config: [false, false, true, true],
    inputs: ['i2', 'nA'],
    output: 'nB',
  }
  const placement: Placement = new Map([
    ['A', { x: 1, y: 1, cell: 0 }],
    ['B', { x: 1, y: 1, cell: 5 }],
  ])

  test('on real iCE40 data, cell 5 input pin 1 is traced back to cell 0 through the real routed pips', () => {
    const design = synthesizeBitstream(DEVICE, LAYOUT, [P, Q], placement)
    const netlist = reconstructNetlist(
      parseBitstream(design.bitstream.bits, DEVICE, LAYOUT),
      DEVICE,
    )
    const q = netlist.cells.find((c) => c.ref.cell === 5)
    // net 1121 = lutff_5/in_1 ← (through 1057) ← net 39 = lutff_0/out = cell 0
    expect(q?.inputs[1]).toEqual({ kind: 'cell', driver: { x: 1, y: 1, cell: 0 }, net: 1121 })
  })
})
