/**
 * FPGA fabric — Stage 3a: a loaded bitstream ON THE CANVAS (fpga-icebox-canvas.ts).
 *
 * The payoff test loads the REAL routed 384 bitstream, lowers the recovered netlist into ordinary canvas gates
 * (AND/OR/NOT/Buffer, sum-of-products per LUT4), and runs it through the APP'S OWN fast logic engine
 * (`simulateLogic`) — getting the same answers as the FPGA simulator. So a real vendor bitstream becomes a
 * circuit every other tool in the app already understands.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import type { CanvasNodeLike } from '../src/renderer/blocks.ts'
import { parseIceboxChipdb } from '../src/renderer/fpga-icebox.ts'
import { lowerNetlistToCanvas } from '../src/renderer/fpga-icebox-canvas.ts'
import { type Ice40ChipDb, loadIce40Bitstream } from '../src/renderer/fpga-icebox-load.ts'
import { parseLogicTileBits } from '../src/renderer/fpga-icebox-logic.ts'
import type { RecoveredCell } from '../src/renderer/fpga-icebox-run.ts'
import { simulateLogic } from '../src/renderer/logic-sim.ts'

const CHIPDBS: Record<string, Ice40ChipDb> = {
  '384': {
    device: parseIceboxChipdb(
      readFileSync(new URL('../fixtures/icebox-ice40-384-chipdb.txt', import.meta.url), 'utf8'),
    ),
    layout: parseLogicTileBits(
      readFileSync(
        new URL('../fixtures/icebox-ice40-384-logic-tile-bits.chipdb', import.meta.url),
        'utf8',
      ),
    ),
  },
}
/** Re-drive one power-source node to a given level (5 V = HIGH, 0 V = LOW). */
const drive = (node: CanvasNodeLike, volts: number): CanvasNodeLike => ({
  ...node,
  data: {
    ...node.data,
    parameters: { nominal_voltage: { value: { kind: 'scalar', amount: volts, unit: 'volt' } } },
  },
})

describe('lowerNetlistToCanvas — a real bitstream becomes canvas gates our own engine runs', () => {
  const loaded = loadIce40Bitstream(
    new Uint8Array(
      readFileSync(new URL('../fixtures/icebox-ice40-384-routed.bin', import.meta.url)),
    ),
    CHIPDBS,
  )
  if (!loaded.ok) throw new Error(loaded.reason)
  const lowered = lowerNetlistToCanvas(loaded.netlist)

  test('lowers to real logic-primitive gates, with a node per cell output and per primary input', () => {
    // every emitted gate is one of the app's own logic primitives (nothing invented)
    const names = new Set(
      lowered.nodes
        .filter((n) => n.data.definition === 'block')
        .map((n) => n.data.block?.name as string),
    )
    for (const n of names) expect(['AND', 'OR', 'NOT', 'Buffer']).toContain(n)
    expect(lowered.cellOutputs.size).toBe(loaded.netlist.cells.length) // one output node per recovered cell
    expect(lowered.inputNodes.size).toBe(2) // the design's two primary inputs (i0, i1)
    expect(lowered.unlowered).toEqual([]) // nothing was silently dropped
    expect(lowered.registered).toEqual([]) // this design is purely combinational
  })

  test("the app's fast logic engine computes the same function: B = A = i0 & i1", () => {
    const outNode = lowered.cellOutputs.get('1_1_5') as string // cell 5 = B, the buffer of A
    const nets = [...lowered.inputNodes.entries()].sort((a, b) => a[0] - b[0])
    for (const i0 of [false, true])
      for (const i1 of [false, true]) {
        // drive the two primary-input power sources, then run the canvas through simulateLogic
        const nodes = lowered.nodes.map((n) =>
          n.id === nets[0]?.[1]
            ? drive(n, i0 ? 5 : 0)
            : n.id === nets[1]?.[1]
              ? drive(n, i1 ? 5 : 0)
              : n,
        )
        const result = simulateLogic(nodes, lowered.edges)
        expect(result.settled).toBe(true)
        expect(result.value(outNode, 'out')).toBe(i0 && i1) // same answer as the FPGA simulator
      }
  })
})

describe('lowerNetlistToCanvas — honest about what it cannot lower', () => {
  const ref = (cell: number) => ({ x: 0, y: 0, cell })
  const cfg = (truth: boolean[], carryEnable = false) => ({
    truth,
    carryEnable,
    dffEnable: false,
    setNoReset: false,
    asyncSetReset: false,
  })

  test('a carry-driven input is reported in `unlowered`, not silently mis-wired', () => {
    const cell: RecoveredCell = {
      ref: ref(1),
      config: cfg(Array.from({ length: 16 }, (_, i) => ((i >> 1) & 1) === 1)), // depends on in1
      inputs: [
        { kind: 'unused' },
        { kind: 'carry', driver: ref(0), net: 7 },
        { kind: 'unused' },
        { kind: 'unused' },
      ],
    }
    const lowered = lowerNetlistToCanvas({ cells: [cell] })
    expect(lowered.unlowered).toHaveLength(1)
    expect(lowered.unlowered[0]?.pin).toBe(1)
    expect(lowered.unlowered[0]?.reason).toMatch(/carry/)
  })

  test('a LUT needing INVERTED minterms (XOR2) lowers correctly — the NOT gates are real', () => {
    // XOR2 over in1/in2: minterms 2 (in1 only) and 4 (in2 only), each of which inverts the OTHER pin. A lowering
    // that skipped the inversion would compute OR instead of XOR, so this pins the minterm-polarity logic.
    const xor2: RecoveredCell = {
      ref: ref(0),
      config: cfg(Array.from({ length: 16 }, (_, i) => (((i >> 1) & 1) ^ ((i >> 2) & 1)) === 1)),
      inputs: [
        { kind: 'unused' },
        { kind: 'primary', net: 10 },
        { kind: 'primary', net: 11 },
        { kind: 'unused' },
      ],
    }
    const lowered = lowerNetlistToCanvas({ cells: [xor2] })
    const out = lowered.cellOutputs.get('0_0_0') as string
    const a = lowered.inputNodes.get(10) as string
    const b = lowered.inputNodes.get(11) as string
    for (const i1 of [false, true])
      for (const i2 of [false, true]) {
        const nodes = lowered.nodes.map((n) =>
          n.id === a ? drive(n, i1 ? 5 : 0) : n.id === b ? drive(n, i2 ? 5 : 0) : n,
        )
        const result = simulateLogic(nodes, lowered.edges)
        expect(result.value(out, 'out')).toBe(i1 !== i2) // real XOR, not OR
      }
  })

  test('a constant-LUT cell lowers to a fixed level, and a registered cell is reported', () => {
    const constHigh: RecoveredCell = {
      ref: ref(0),
      config: cfg(Array.from({ length: 16 }, () => true)),
      inputs: [{ kind: 'unused' }, { kind: 'unused' }, { kind: 'unused' }, { kind: 'unused' }],
    }
    const registered: RecoveredCell = {
      ref: ref(1),
      config: { ...cfg(Array.from({ length: 16 }, () => false)), dffEnable: true },
      inputs: [{ kind: 'unused' }, { kind: 'unused' }, { kind: 'unused' }, { kind: 'unused' }],
    }
    const lowered = lowerNetlistToCanvas({ cells: [constHigh, registered] })
    expect(lowered.registered).toEqual([ref(1)]) // needs the clocked simulator, flagged for the caller
    const out = lowered.cellOutputs.get('0_0_0') as string
    const result = simulateLogic(lowered.nodes, lowered.edges)
    expect(result.value(out, 'out')).toBe(true) // the constant-1 LUT really reads high on the canvas
  })
})
