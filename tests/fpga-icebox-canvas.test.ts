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
import {
  type RecoveredCell,
  simulateClocked,
  simulateCombinational,
} from '../src/renderer/fpga-icebox-run.ts'
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

describe('lowerNetlistToCanvas — computes the SAME function as the FPGA simulator', () => {
  const cref = (cell: number) => ({ x: 0, y: 0, cell })
  const NONE = { kind: 'unused' } as const
  const lc = (truth: boolean[]) => ({
    truth,
    carryEnable: false,
    dffEnable: false,
    setNoReset: false,
    asyncSetReset: false,
  })
  const BUF16 = Array.from({ length: 16 }, (_, i) => (i & 1) === 1)
  /** Run a lowered canvas with the given primary-net values and read one cell's output. */
  const runCanvas = (
    lowered: ReturnType<typeof lowerNetlistToCanvas>,
    values: Map<number, boolean>,
    key: string,
  ): boolean | undefined => {
    const nodes = lowered.nodes.map((n) => {
      for (const [net, id] of lowered.inputNodes)
        if (id === n.id) return drive(n, values.get(net) ? 5 : 0)
      return n
    })
    return simulateLogic(nodes, lowered.edges).value(lowered.cellOutputs.get(key) as string, 'out')
  }

  test('a driver listed AFTER its consumer is still wired (two-pass lowering)', () => {
    // Cell 0 reads cell 1, but cell 1 comes later in the array. A single forward pass silently dropped this
    // input — the canvas computed a different function while reporting nothing.
    const consumer = {
      ref: cref(0),
      config: lc(BUF16),
      inputs: [{ kind: 'cell' as const, driver: cref(1), net: 1 }, NONE, NONE, NONE],
    }
    const driver = {
      ref: cref(1),
      config: lc(BUF16),
      inputs: [{ kind: 'primary' as const, net: 7 }, NONE, NONE, NONE],
    }
    const netlist = { cells: [consumer, driver] }
    const lowered = lowerNetlistToCanvas(netlist)
    expect(lowered.unfaithful).toEqual([]) // nothing was dropped, so nothing is unfaithful
    for (const v of [false, true]) {
      const want = simulateCombinational(netlist, new Map([[7, v]])).outputs.get('0_0_0')
      expect(runCanvas(lowered, new Map([[7, v]]), '0_0_0')).toBe(want)
      expect(want).toBe(v) // the buffer chain passes the input through
    }
  })

  test('100 random LUTs agree with the FPGA simulator on every input, including pins with no source', () => {
    // A pin with no source reads as 0 in the FPGA simulator, so a minterm needing it HIGH is unsatisfiable and
    // must be dropped ENTIRELY — dropping only its literal made the product true when the pin was 0.
    let seed = 4242
    const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    for (let trial = 0; trial < 100; trial++) {
      const truth = Array.from({ length: 16 }, () => rnd() < 0.5) // depends on pins 2/3, which have NO source
      const cell = {
        ref: cref(0),
        config: lc(truth),
        inputs: [
          { kind: 'primary' as const, net: 1 },
          { kind: 'primary' as const, net: 2 },
          NONE,
          NONE,
        ],
      }
      const netlist = { cells: [cell] }
      const lowered = lowerNetlistToCanvas(netlist)
      for (const a of [false, true])
        for (const b of [false, true]) {
          const values = new Map([
            [1, a],
            [2, b],
          ])
          expect(runCanvas(lowered, values, '0_0_0')).toBe(
            simulateCombinational(netlist, values).outputs.get('0_0_0'),
          )
        }
    }
  })
})

describe('lowerNetlistToCanvas — registers are real boundaries (Q is the output, D is the LUT)', () => {
  const cref = (cell: number) => ({ x: 0, y: 0, cell })
  const NONE = { kind: 'unused' } as const
  const lc = (truth: boolean[], dffEnable = false) => ({
    truth,
    carryEnable: false,
    dffEnable,
    setNoReset: false,
    asyncSetReset: false,
  })
  const BUF16 = Array.from({ length: 16 }, (_, i) => (i & 1) === 1)
  const NOT_IN1 = Array.from({ length: 16 }, (_, i) => ((i >> 1) & 1) === 0)

  test("a registered cell's output is its stored Q; consumers follow Q, not the LUT's D", () => {
    const ff = {
      ref: cref(0),
      config: lc(NOT_IN1, true), // D = NOT(in_1)
      inputs: [NONE, { kind: 'primary' as const, net: 9 }, NONE, NONE],
    }
    const consumer = {
      ref: cref(1),
      config: lc(BUF16),
      inputs: [{ kind: 'cell' as const, driver: cref(0), net: 0 }, NONE, NONE, NONE],
    }
    const lowered = lowerNetlistToCanvas({ cells: [ff, consumer] })
    const qNode = lowered.stateNodes.get('0_0_0') as string
    const dNode = lowered.cellD.get('0_0_0') as string
    expect(qNode).toBeDefined()
    expect(dNode).toBeDefined()
    expect(lowered.cellOutputs.get('0_0_0')).toBe(qNode) // the cell's OUTPUT is its stored value
    expect(lowered.unfaithful).toEqual([]) // consumers read Q correctly, so nothing is unfaithful

    // hold the flip-flop's LUT input at 0 (so D = 1) and sweep the stored Q: the consumer must follow Q.
    for (const q of [false, true]) {
      const nodes = lowered.nodes.map((n) =>
        n.id === qNode ? drive(n, q ? 5 : 0) : n.id === lowered.inputNodes.get(9) ? drive(n, 0) : n,
      )
      const result = simulateLogic(nodes, lowered.edges)
      expect(result.value(lowered.cellOutputs.get('0_0_1') as string, 'out')).toBe(q) // follows Q
      expect(result.value(dNode, 'out')).toBe(true) // D = NOT(0) = 1, independent of Q
    }
  })

  test('driving the state nodes from simulateClocked steps the canvas through real cycles', () => {
    // A toggle flip-flop: D = NOT(Q). Feeding each cycle's Q from the clocked simulator into the canvas must
    // reproduce the same next-state D the simulator latches — the canvas IS the combinational cloud.
    const toggle = {
      ref: cref(0),
      config: lc(NOT_IN1, true),
      inputs: [NONE, { kind: 'cell' as const, driver: cref(0), net: 0 }, NONE, NONE], // reads its own Q
    }
    const netlist = { cells: [toggle] }
    const lowered = lowerNetlistToCanvas(netlist)
    const qNode = lowered.stateNodes.get('0_0_0') as string
    const run = simulateClocked(netlist, new Map(), 4)
    expect(run.trace.map((cy) => cy.get('0_0_0'))).toEqual([false, true, false, true]) // it toggles
    for (const cycle of run.trace) {
      const q = cycle.get('0_0_0') as boolean
      const nodes = lowered.nodes.map((n) => (n.id === qNode ? drive(n, q ? 5 : 0) : n))
      const result = simulateLogic(nodes, lowered.edges)
      // the canvas computes the same next state the simulator will latch: D = NOT(Q)
      expect(result.value(lowered.cellD.get('0_0_0') as string, 'out')).toBe(!q)
    }
  })
})
