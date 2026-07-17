/**
 * The Verilog step-debugger's engine — clock a synthesized module one cycle at a time and read every
 * signal's value back, mapped to the names in the source. It's the same real logic engine that solves the
 * gates on the canvas: the module is wrapped in a tiny harness (a driven source on each input, ground, a
 * clock source if it has one), compiled ONCE, then stepped. Nothing about the design is faked — the values
 * you watch are what the actual gates and flip-flops settle to.
 *
 * Pure (no React) so it can be unit-tested against known modules: a counter must count on each clock, an
 * adder's sum must equal a + b. The editor's Debug panel is just a view on top of this.
 */

import type { BlockData, CanvasEdgeLike, CanvasNodeLike } from './blocks.ts'
import {
  type CompiledLogic,
  compileLogic,
  isOutputPort,
  type LogicResult,
  POWER_PORT_IDS,
  stepLogic,
} from './logic-sim.ts'

/** A named signal grouped from its bit ports, LSB first: `count[0], count[1], …` → one "count". */
export type DebugSignal = { name: string; bits: string[] }

export type DebugSession = {
  /** Input signals the user drives (the clock is separate — it's pulsed by step()). */
  readonly inputs: DebugSignal[]
  /** Output signals read back after each step. */
  readonly outputs: DebugSignal[]
  /** The clock port id, if the module has one (auto-pulsed low→high by step()). */
  readonly clockPortId: string | null
  /** Set one input BIT's level (by its port id, e.g. `a[2]` or `rst`). */
  setInput(portId: string, high: boolean): void
  /** Set a whole input signal from a number (LSB→bit0). Ignores an unknown name. */
  setInputValue(name: string, value: number): void
  /** Advance one cycle: apply the inputs, and pulse the clock (low then high) if there is one. */
  step(): void
  /** Clear the flip-flop memory (a fresh power-up) and re-read at the current inputs. */
  reset(): void
  /** The current level of a port id (0/1), from the last settle — undefined if undriven or unsettled. */
  read(portId: string): boolean | undefined
  /** A whole signal's value as a number (LSB→bit0), or undefined if any bit is undriven. */
  readValue(name: string): number | undefined
  /** Did the last settle converge? (false = a combinational loop with no clock — an oscillator.) */
  readonly settled: boolean
}

const CLOCK_NAMES = new Set(['clk', 'clock', 'ck', 'clkin', 'clk_in'])

/** Split a port id into its signal name and bit index: `count[3]` → {name:"count", bit:3}; `q` → {name:"q", bit:0}. */
function splitBit(portId: string): { name: string; bit: number } {
  const m = /^(.*)\[(\d+)\]$/.exec(portId)
  return m ? { name: m[1] as string, bit: Number(m[2]) } : { name: portId, bit: 0 }
}

/** Group a list of bit ports into signals, each with its bits ordered LSB→MSB. */
function groupSignals(portIds: string[]): DebugSignal[] {
  const byName = new Map<string, { bit: number; id: string }[]>()
  for (const id of portIds) {
    const { name, bit } = splitBit(id)
    const arr = byName.get(name) ?? []
    arr.push({ bit, id })
    byName.set(name, arr)
  }
  return [...byName.entries()].map(([name, bits]) => ({
    name,
    bits: bits.sort((a, b) => a.bit - b.bit).map((b) => b.id),
  }))
}

const supply = (high: boolean) =>
  ({
    nominal_voltage: { value: { kind: 'scalar', amount: high ? 5 : 0, unit: 'volt' } },
    // biome-ignore lint/suspicious/noExplicitAny: the harness only needs the voltage the logic sim reads
  }) as any

/** The block-node id inside the test harness — reads go through `result.value(HARNESS_BLOCK_ID, portId)`. */
export const HARNESS_BLOCK_ID = 'dbg'

export type LogicHarness = {
  compiled: CompiledLogic
  /** Every input port id (the clock included), each wired to its own controllable source. */
  driven: string[]
  clockPortId: string | null
  /** input port id → the harness source node id (the key stepLogic overrides address). */
  srcId: Map<string, string>
  /** Input signals grouped by name, LSB→MSB, clock excluded (what the user drives). */
  inputSignals: DebugSignal[]
  /** Output signals grouped by name. */
  outputSignals: DebugSignal[]
}

/**
 * Wrap a synthesized module in a test harness — a controllable power source on every input port (clock
 * included), ground, and a Vdd source if it declares a supply pin — and compile it ONCE. Shared by the
 * step-debugger and the run-trace inspector. Returns null if the module has no drivable inputs/outputs.
 */
export function buildLogicHarness(block: BlockData): LogicHarness | null {
  const nonPower = block.ports.filter((p) => !POWER_PORT_IDS.has(p.id.toLowerCase()))
  const outPorts = nonPower.filter(isOutputPort).map((p) => p.id)
  const inPorts = nonPower.filter((p) => !isOutputPort(p)).map((p) => p.id)
  if (inPorts.length === 0 || outPorts.length === 0) return null

  const clockPortId = inPorts.find((id) => CLOCK_NAMES.has(splitBit(id).name.toLowerCase())) ?? null
  const driven = inPorts // every input (clock too) gets a source; the clock's level is overridden per step
  const vddPort = block.ports.find((p) => ['v_dd', 'vdd', 'vcc'].includes(p.id.toLowerCase()))
  const gndPort = block.ports.find((p) => ['gnd', 'vss', 'vee'].includes(p.id.toLowerCase()))

  // Stable source-node id per input port so overrides can address it by id.
  const srcId = new Map(driven.map((id, i) => [id, `dbg_s${i}`]))

  const nodes: CanvasNodeLike[] = [
    { id: HARNESS_BLOCK_ID, position: { x: 0, y: 0 }, data: { definition: 'block', block } },
    { id: 'dbg_g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
    ...driven.map((id) => ({
      id: srcId.get(id) as string,
      position: { x: 0, y: 0 },
      data: { definition: 'power_source', parameters: supply(false) },
    })),
    ...(vddPort
      ? [
          {
            id: 'dbg_vd',
            position: { x: 0, y: 0 },
            data: { definition: 'power_source', parameters: supply(true) },
          },
        ]
      : []),
  ]
  const edges: CanvasEdgeLike[] = [
    ...driven.flatMap((port) => [
      {
        id: `e_${port}_p`,
        source: srcId.get(port) as string,
        sourceHandle: 'terminal_positive',
        target: HARNESS_BLOCK_ID,
        targetHandle: port,
      },
      {
        id: `e_${port}_n`,
        source: srcId.get(port) as string,
        sourceHandle: 'terminal_negative',
        target: 'dbg_g',
        targetHandle: 'reference_terminal',
      },
    ]),
    ...(vddPort
      ? [
          {
            id: 'e_vd',
            source: 'dbg_vd',
            sourceHandle: 'terminal_positive',
            target: HARNESS_BLOCK_ID,
            targetHandle: vddPort.id,
          },
        ]
      : []),
    ...(gndPort
      ? [
          {
            id: 'e_gnd',
            source: HARNESS_BLOCK_ID,
            sourceHandle: gndPort.id,
            target: 'dbg_g',
            targetHandle: 'reference_terminal',
          },
        ]
      : []),
  ]

  return {
    compiled: compileLogic(nodes, edges),
    driven,
    clockPortId,
    srcId,
    inputSignals: groupSignals(inPorts.filter((id) => id !== clockPortId)),
    outputSignals: groupSignals(outPorts),
  }
}

/**
 * Build a step-debug session for a synthesized module, or null if it has no drivable inputs/outputs.
 * Thin stateful wrapper over buildLogicHarness: hold input levels + flip-flop state, step the clock, read.
 */
export function createDebugSession(block: BlockData): DebugSession | null {
  const harness = buildLogicHarness(block)
  if (!harness) return null
  const { compiled, driven, clockPortId, srcId } = harness
  const level = new Map<string, boolean>(driven.map((id) => [id, false]))
  let state = new Map<string, boolean>()
  let last: LogicResult | null = null

  // stepLogic overrides are keyed by SOURCE node id; build them from the current per-port levels, with the
  // clock forced to `clk` for this half-cycle.
  const overridesWith = (clk: boolean): Map<string, boolean> => {
    const o = new Map<string, boolean>()
    for (const [port, high] of level) {
      const nodeId = srcId.get(port)
      if (nodeId) o.set(nodeId, port === clockPortId ? clk : high)
    }
    return o
  }

  const settle = (clk: boolean) => {
    last = stepLogic(compiled, overridesWith(clk), state)
  }

  const session: DebugSession = {
    inputs: harness.inputSignals,
    outputs: harness.outputSignals,
    clockPortId,
    setInput(portId, high) {
      if (level.has(portId)) level.set(portId, high)
    },
    setInputValue(name, value) {
      const sig = session.inputs.find((s) => s.name === name)
      if (!sig) return
      sig.bits.forEach((id, i) => {
        level.set(id, ((value >> i) & 1) === 1)
      })
    },
    step() {
      // A rising clock edge is two settles: clk low (the master latch samples D), then clk high (the slave
      // commits) — the exact protocol the on-canvas clocked demos use. A module with no clock just settles.
      if (clockPortId) {
        settle(false)
        settle(true)
      } else {
        settle(false)
      }
    },
    reset() {
      state = new Map<string, boolean>()
      last = null
      // Settle once at the current inputs so the outputs reflect the fresh state (clock held low).
      settle(false)
    },
    read(portId) {
      return last?.value(HARNESS_BLOCK_ID, portId)
    },
    readValue(name) {
      const sig = [...session.inputs, ...session.outputs].find((s) => s.name === name)
      if (!sig) return undefined
      let value = 0
      for (let i = 0; i < sig.bits.length; i++) {
        const bit = last?.value(HARNESS_BLOCK_ID, sig.bits[i] as string)
        if (bit === undefined) return undefined
        if (bit) value |= 1 << i
      }
      return value
    },
    get settled() {
      return last?.settled ?? true
    },
  }
  return session
}
