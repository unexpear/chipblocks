/**
 * A REAL Intel 8080 — the north star, held down by a test.
 *
 * `fixtures/cpu8080-vm80a-core.v` is not a teaching model of an 8080 and not our reading of the
 * datasheet: it is 1801BM1's Verilog transcription of a decapped 580BM80A die (the Soviet replica of
 * the Intel 8080A), vendored byte-for-byte from that project's `org/rtl/vm80a.v`. It is CC-BY 3.0 —
 * see THIRD-PARTY-LICENSES.md; its header notice must stay intact. `fixtures/cpu8080-system.v` is ours:
 * the little computer around it — a two-phase clock, a 32-byte mask ROM holding the program, and a
 * 16-byte RAM — so the core has something to fetch and somewhere to store.
 *
 * That pair imports to 11,155 real parts and then RUNS. The program adds 5 + 7, stores 0Ch, reloads it,
 * rotates it to 18h, stores that, subtracts to set the zero flag, jumps on it, and stores AAh before
 * halting. So the three memory writes below are not three assignments — they are the accumulator, the
 * ALU, the flags, the conditional branch and the store/load machinery all having worked. Nothing here is
 * sequenced in JavaScript: this test supplies a clock and a reset line, exactly as a bench supply would,
 * and reads the pins.
 *
 * The expectations are Icarus Verilog 14.0 on the same three fixture files
 * (`-DRESET_CLKS=60 -DRUN_CLKS=401`, the command in cpu8080-icarus-testbench.v): the same writes, the
 * same halt. Icarus's clock numbers read one higher because its testbench counts the edge before it
 * prints; the addresses and the data are identical.
 *
 * Cost: the run is ~10 s of real gate sweeps (401 clocks over 14,231 gates). It is deliberately the whole
 * program rather than a shortened one — the AAh write only happens if the conditional jump was taken.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import type { BlockData, CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import {
  blockIsLogicCompatible,
  type CompiledLogic,
  compileLogic,
  type LogicResult,
  stepLogic,
} from '../src/renderer/logic-sim.ts'
import { importVerilog } from '../src/renderer/verilog-import.ts'

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')
const SYSTEM = { name: 'cpu8080-system.v', text: fixture('cpu8080-system.v') }
const CORE = { name: 'cpu8080-vm80a-core.v', text: fixture('cpu8080-vm80a-core.v') }

const said = (warnings: string[]): string => warnings.join(' | ')

/** The build, measured on 2026-08-16 and again by Icarus on the same files. A silent change to the
 *  importer that alters the design — not merely its warnings — moves one of these. */
const PARTS = 11155
const WIRES = 41147
const PORTS = 59
const GATES = 14231

const CLOCKS = 401
const RESET_CLOCKS = 60

const supply = (volts: number) => ({
  nominal_voltage: { value: { kind: 'scalar', amount: volts, unit: 'volt' } },
})
const src = (id: string, volts: number): CanvasNodeLike => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition: 'power_source', parameters: supply(volts) },
})
const w = (id: string, s: string, sh: string, t: string, th: string): CanvasEdgeLike => ({
  id,
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
})

/** The 8080's five input pins, each on its own supply so the clock and reset can be driven per step. */
const PINS = ['clk', 'reset', 'i_hold', 'i_int', 'i_ready']

/** Put the imported CPU on a canvas with power, ground, and a source per input pin, then compile once. */
function powerUp(cpu: BlockData): CompiledLogic {
  const nodes: CanvasNodeLike[] = [
    { id: 'M', position: { x: 0, y: 0 }, data: { definition: 'block', block: cpu } },
    { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
    src('vp', 5),
  ]
  const edges: CanvasEdgeLike[] = [
    w('ep', 'vp', 'terminal_positive', 'M', 'v_dd'),
    w('eg', 'M', 'gnd', 'g', 'reference_terminal'),
    w('epn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
  ]
  for (const pin of PINS) {
    nodes.push(src(`s_${pin}`, 5))
    edges.push(w(`e_${pin}`, `s_${pin}`, 'terminal_positive', 'M', pin))
    edges.push(w(`e_${pin}n`, `s_${pin}`, 'terminal_negative', 'g', 'reference_terminal'))
  }
  return compileLogic(nodes, edges)
}

/** Pin levels for one half-step. HOLD and INT stay low, READY stays high — a bench with no wait states. */
const levels = (clk: boolean, reset: boolean) =>
  new Map<string, boolean>([
    ['s_clk', clk],
    ['s_reset', reset],
    ['s_i_hold', false],
    ['s_i_int', false],
    ['s_i_ready', true],
  ])

const busValue = (r: LogicResult, name: string, width: number): number => {
  let v = 0
  for (let bit = 0; bit < width; bit++) if (r.value('M', `${name}[${bit}]`) === true) v |= 1 << bit
  return v
}

describe('the die-derived Intel 8080 imports as real parts', () => {
  test('the core and its little computer build one block of 11,155 parts and 59 pins', () => {
    const { block, warnings, moduleName } = importVerilog([SYSTEM, CORE])
    expect(block, said(warnings)).not.toBeNull()
    const cpu = block as BlockData
    expect(moduleName).toBe('sys8080')
    expect(cpu.nodes.length).toBe(PARTS)
    expect(cpu.edges.length).toBe(WIRES)
    expect(cpu.ports.length).toBe(PORTS)
  })

  test('the only two things it has to say are the unused bidirectional bus on the pin wrapper', () => {
    // The vm80a file holds TWO modules: the pin-compatible package wrapper (whose tri-state data bus this
    // importer cannot represent) and the core our system instantiates. Both warnings are about the wrapper
    // we never build. A third warning would mean something in the CPU itself stopped importing.
    const { warnings } = importVerilog([SYSTEM, CORE])
    expect(warnings.length, said(warnings)).toBe(2)
    expect(said(warnings)).toContain('inout port "pin_d"')
    expect(said(warnings)).toContain('importing "sys8080"')
  })

  test('every part of it is real logic, so the whole processor runs on the fast logic engine', () => {
    const { block } = importVerilog([SYSTEM, CORE])
    expect(blockIsLogicCompatible(block as BlockData)).toBe(true)
  })

  test('the two files in the other order build the identical design', () => {
    // Which file a user picks first must not change the processor they get.
    const forward = importVerilog([SYSTEM, CORE]).block as BlockData
    const reversed = importVerilog([CORE, SYSTEM])
    expect(reversed.block, said(reversed.warnings)).not.toBeNull()
    const other = reversed.block as BlockData
    expect(reversed.moduleName).toBe('sys8080')
    expect(other.nodes.length).toBe(forward.nodes.length)
    expect(other.edges.length).toBe(forward.edges.length)
    expect(other.ports.map((p) => p.id)).toEqual(forward.ports.map((p) => p.id))
  })
})

describe('the 8080 executes its program on real gates', () => {
  test('it computes 5 + 7, rotates, branches on the zero flag, writes 0c/18/aa and halts', () => {
    const { block, warnings } = importVerilog([SYSTEM, CORE])
    expect(block, said(warnings)).not.toBeNull()
    const compiled = powerUp(block as BlockData)
    expect(compiled.gates.length).toBe(GATES)

    const state = new Map<string, boolean>()
    const writes: { clock: number; address: number; data: number }[] = []
    let wasWriting = false
    let unsettled = 0
    let last = stepLogic(compiled, levels(false, true), state)

    for (let clock = 1; clock <= CLOCKS; clock++) {
      const inReset = clock < RESET_CLOCKS
      stepLogic(compiled, levels(false, inReset), state)
      const risen = stepLogic(compiled, levels(true, inReset), state)
      if (!risen.settled) unsettled++
      // WR# is active LOW: the store happens on the edge the pin first goes down.
      const writing = risen.value('M', 'o_wr_n') === false
      if (writing && !wasWriting)
        writes.push({
          clock,
          address: busValue(risen, 'o_addr', 16),
          data: busValue(risen, 'o_data', 8),
        })
      wasWriting = writing
      last = risen
    }

    expect(unsettled, 'every clock must reach a steady state').toBe(0)
    expect(writes).toEqual([
      { clock: 123, address: 0x0040, data: 0x0c }, // STA 0040h — 5 + 7 out of the ALU
      { clock: 183, address: 0x0041, data: 0x18 }, // STA 0041h — 0Ch rotated left
      { clock: 257, address: 0x0042, data: 0xaa }, // STA 0042h — only reached if JZ was taken
    ])
    // The RAM still holds what was written, read back off its own output pins.
    expect(busValue(last, 'o_ram0', 8)).toBe(0x0c)
    expect(busValue(last, 'o_ram1', 8)).toBe(0x18)
    expect(busValue(last, 'o_ram2', 8)).toBe(0xaa)
    // HLT: the processor parks with WAIT high, holding the address of the halt instruction itself.
    expect(last.value('M', 'o_wait')).toBe(true)
    expect(busValue(last, 'o_addr', 16)).toBe(0x001b)
  })
})
