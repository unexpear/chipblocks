/**
 * FPGA fabric — Lattice Nexus: the recovered netlist, checked against designs whose behaviour is known.
 *
 * Every fixture here was built through the REAL toolchain — `yosys -> nextpnr-nexus -> prjoxide pack` — from
 * Verilog that is committed beside it, and each is present twice: once as the router wrote it, and once as
 * `prjoxide unpack` reads it back out of the packed bitstream. The two disagree about what to leave out (the
 * unpacker omits everything a blank device already holds), so a decoder that gets the defaults wrong passes on
 * one and fails on the other. Both are checked, and required to produce the same netlist.
 *
 * The checks are on VALUES, not shapes: the recovered design is run through the shared `simulateClocked` /
 * `simulateCombinational` and required to compute what the Verilog says it computes. A netlist that counts
 * 0,1,2,3… is a netlist whose lookup tables, carry chain, registers and routing are all right at once.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  type CellRef,
  type RecoveredCell,
  simulateClocked,
  simulateCombinational,
} from '../src/renderer/fpga-icebox-run.ts'
import { parseNexusFasm } from '../src/renderer/fpga-oxide-fasm.ts'
import {
  type NexusNetlist,
  nexusClockHalf,
  nexusClockScope,
  reconstructNexusNetlist,
} from '../src/renderer/fpga-oxide-netlist.ts'
import {
  LIFCL40_BRANCH_SEGMENTS,
  LIFCL40_CLOCK_HALVES,
  NEXUS_PLC_ALWAYS_ON_PIPS,
  NEXUS_PLC_CONNS,
} from '../src/renderer/fpga-oxide-plc.ts'

const read = (name: string): string =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')
const recover = (name: string): NexusNetlist => reconstructNexusNetlist(parseNexusFasm(read(name)))

const key = (ref: CellRef): string => `${ref.x}_${ref.y}_${ref.cell}`

/** Every external signal the recovered design reads, as net indices in a stable order. */
const primaryNets = (netlist: NexusNetlist): number[] => {
  const nets = new Set<number>()
  for (const cell of netlist.cells) {
    for (const source of cell.inputs) if (source.kind === 'primary') nets.add(source.net)
    for (const source of [cell.setReset, cell.clockEnable])
      if (source?.kind === 'primary') nets.add(source.net)
  }
  return [...nets].sort((a, b) => a - b)
}

/** The design's registers in carry-chain order: west to east, then by cell index within a tile. */
const registers = (netlist: NexusNetlist): RecoveredCell[] =>
  netlist.cells
    .filter((cell) => cell.config.dffEnable)
    .sort((a, b) => a.ref.x - b.ref.x || a.ref.cell - b.ref.cell)

/** Every ordering of `items` — used to try every possible labelling of a design's external inputs. */
function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items]
  const out: T[][] = []
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)]
    for (const tail of permutations(rest)) out.push([items[i] as T, ...tail])
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------
describe('the logic tile’s own wiring, transcribed from the device database', () => {
  const vendored = JSON.parse(read('oxide-nexus-plc-fabric.json')) as {
    alwaysOnPips: string[]
    conns: string[]
  }

  test('the table in source is exactly the CC0 extract, entry for entry', () => {
    expect(NEXUS_PLC_ALWAYS_ON_PIPS.map(([d, s]) => `${d}<-${s}`).sort()).toEqual(
      vendored.alwaysOnPips,
    )
    expect(NEXUS_PLC_CONNS.map(([d, s]) => `${d}<-${s}`).sort()).toEqual(vendored.conns)
  })

  test('the carry chain runs A→B→C→D and enters from the tile one column WEST', () => {
    const conns = new Map(NEXUS_PLC_CONNS.map(([d, s]) => [d, s]))
    expect(conns.get('JFCI_SLICEA')).toBe('JFCIN')
    expect(conns.get('JFCIN')).toBe('HFIE0000')
    expect(conns.get('HFIE0000')).toBe('W1:JFCOUT')
    expect(conns.get('JFCI_SLICEB')).toBe('JFCO_SLICEA')
    expect(conns.get('JFCI_SLICEC')).toBe('JFCO_SLICEB')
    expect(conns.get('JFCI_SLICED')).toBe('JFCO_SLICEC')
    expect(conns.get('JFCOUT')).toBe('JFCO_SLICED')
  })

  test('an unrouted clock-enable and set/reset arrive HIGH, which is why a design without a reset inverts it', () => {
    const always = new Map(NEXUS_PLC_ALWAYS_ON_PIPS.map(([d, s]) => [d, s]))
    expect(always.get('JCE0')).toBe('G:VCC')
    expect(always.get('JLSR0')).toBe('G:VCC')
    // ...and a plain lookup table reaches the outside world over a link no bitstream ever writes.
    expect(always.get('JF2')).toBe('JF0_SLICEB')
  })
})

// ---------------------------------------------------------------------------------------------------------
describe('an 8-bit counter, recovered and run', () => {
  /**
   * `fixtures/oxide-nexus-lifcl40-counter.v`:
   *
   *     reg [7:0] acc;
   *     always @(posedge clk) acc <= acc + {7'b0, a};
   *     assign q = acc[7] ^ b;
   *
   * Everything about this design is arithmetic: ten lookup tables in `CCU2` mode, a carry chain crossing a tile
   * boundary, and eight registers fed from it. If the carry equation, the chain's direction, the blank-device
   * lookup-table value or the register's data path were wrong, it would not count.
   */
  for (const [written, file] of [
    ['the router', 'oxide-nexus-lifcl40-counter.fasm'],
    ['the unpacker, out of the real bitstream', 'oxide-nexus-lifcl40-counter-unpacked.fasm'],
  ] as const) {
    describe(`as ${written} wrote it`, () => {
      const netlist = recover(file)

      test('eight registers, and exactly two external signals', () => {
        expect(registers(netlist).length).toBe(8)
        expect(primaryNets(netlist).length).toBe(2)
      })

      test('it counts: driving the increment high steps the registers 0,1,2,3,…', () => {
        const nets = primaryNets(netlist)
        const bits = registers(netlist)
        const value = (frame: Map<string, boolean>): number =>
          bits.reduce((acc, cell, bit) => acc + ((frame.get(key(cell.ref)) ? 1 : 0) << bit), 0)
        // Which of the two external signals is the increment is not assumed: BOTH are tried, and exactly one
        // has to make the design count while the other leaves it still.
        const counting = nets.filter((net) => {
          const run = simulateClocked(netlist, new Map([[net, true]]), 9)
          return run.trace.map(value).join(',') === '0,1,2,3,4,5,6,7,8'
        })
        expect(counting.length).toBe(1)
        const idle = nets.filter((net) => net !== counting[0])
        for (const net of idle) {
          const run = simulateClocked(netlist, new Map([[net, true]]), 9)
          expect(run.trace.map(value)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0])
        }
      })

      test('it is the SOURCE’s counter, over a random stimulus, output and all', () => {
        const [increment, other] = primaryNets(netlist) as [number, number]
        // settle which net is which by the counting test's answer, then check the whole design
        const run0 = simulateClocked(netlist, new Map([[increment, true]]), 3)
        const bits = registers(netlist)
        const stepped = run0.trace[2]?.get(key((bits[0] as RecoveredCell).ref)) === false
        const incrementNet = stepped ? increment : other
        const outputNet = stepped ? other : increment

        let seed = 12345
        const random = (): boolean => {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff
          return (seed >> 16) % 2 === 1
        }
        const cycles = 200
        const stimulus: Map<number, boolean>[] = []
        const expectedAcc: number[] = []
        const expectedQ: boolean[] = []
        let acc = 0
        for (let cycle = 0; cycle < cycles; cycle++) {
          const a = random()
          const b = random()
          stimulus.push(
            new Map([
              [incrementNet, a],
              [outputNet, b],
            ]),
          )
          // the trace records values BEFORE this cycle's edge, so the expected state is the running one
          expectedAcc.push(acc)
          expectedQ.push((((acc >> 7) & 1) === 1) !== b)
          acc = (acc + (a ? 1 : 0)) & 0xff
        }
        const run = simulateClocked(netlist, stimulus, cycles)
        const seen = run.trace.map((frame) =>
          bits.reduce((sum, cell, bit) => sum + ((frame.get(key(cell.ref)) ? 1 : 0) << bit), 0),
        )
        expect(seen).toEqual(expectedAcc)

        // The output `q = acc[7] ^ b` has to be computed by one of the recovered cells, and exactly one.
        const matches = netlist.cells.filter((cell) =>
          run.trace.every((frame, cycle) => frame.get(key(cell.ref)) === expectedQ[cycle]),
        )
        expect(matches.length).toBe(1)
      })

      test('nothing about it was left unrecovered', () => {
        expect(netlist.incomplete).toEqual([])
        expect(netlist.undecoded).toEqual([])
        expect(netlist.unfaithful).toEqual([])
      })

      test('a single clock, named by the horizontal row it is distributed from', () => {
        expect(netlist.clocks.length).toBe(1)
        expect(netlist.clocks[0]?.wire).toBe('HROW_L_HPRX0400')
        expect(netlist.clocks[0]?.refs.length).toBe(8)
        for (const cell of registers(netlist)) expect(cell.negClk).toBe(false)
      })
    })
  }

  test('the router’s file and the unpacker’s file describe the SAME design', () => {
    // They name the same wire differently and omit different things, so compare the structure: each cell's
    // function and where each input comes from, with external signals reduced to "the n-th distinct one".
    const shape = (netlist: NexusNetlist): string[] => {
      const order = new Map<number, number>()
      const label = (net: number): number => {
        const seen = order.get(net)
        if (seen !== undefined) return seen
        order.set(net, order.size)
        return order.size - 1
      }
      return netlist.cells
        .sort((a, b) => a.ref.y - b.ref.y || a.ref.x - b.ref.x || a.ref.cell - b.ref.cell)
        .map(
          (cell) =>
            `${key(cell.ref)} ${cell.config.truth.map((b) => (b ? 1 : 0)).join('')} dff=${cell.config.dffEnable} ` +
            cell.inputs
              .map((source) =>
                source.kind === 'cell'
                  ? `cell:${key(source.driver)}`
                  : source.kind === 'primary'
                    ? `primary:${label(source.net)}`
                    : source.kind === 'const'
                      ? `const:${source.value}`
                      : source.kind,
              )
              .join(' '),
        )
    }
    expect(shape(recover('oxide-nexus-lifcl40-counter.fasm'))).toEqual(
      shape(recover('oxide-nexus-lifcl40-counter-unpacked.fasm')),
    )
  })

  test('every piece of the carry unit computes exactly what the vendor’s own cell model says', () => {
    // The behavioural tests above cannot see all of this: on this design the generate term happens to agree
    // with the plain lookup table wherever it matters, and the chain's first carry-in happens to be low
    // whether it is a constant or an undriven pin. So the four pieces are checked directly, as values.
    const netlist = recover('oxide-nexus-lifcl40-counter-unpacked.fasm')
    const partOf = (ref: CellRef): string => netlist.origin.get(key(ref))?.part ?? ''
    const bits = (truth: readonly boolean[]): string => truth.map((b) => (b ? 1 : 0)).join('')

    // `F = Z ^ carry-in` — a two-input XOR of the lookup table and the carry, and nothing else.
    const arithmetic = new Set(
      netlist.cells
        .filter((cell) => partOf(cell.ref) === 'carry-lut')
        .map((cell) => key({ ...cell.ref, cell: cell.ref.cell - 8 })),
    )
    const sums = netlist.cells.filter(
      (cell) => partOf(cell.ref) === 'output' && arithmetic.has(key(cell.ref)),
    )
    expect(sums.length).toBe(10)
    for (const cell of sums) {
      expect(bits(cell.config.truth)).toBe('0110011001100110')
      expect(cell.inputs[2]).toEqual({ kind: 'unused' })
      expect(cell.inputs[3]).toEqual({ kind: 'unused' })
    }

    // `FCO = Z ? carry-in : Z3` — a multiplexer, with the lookup table choosing.
    const carries = netlist.cells.filter((cell) => partOf(cell.ref) === 'carry-out')
    expect(carries.length).toBe(10)
    for (const cell of carries) expect(bits(cell.config.truth)).toBe('0001101100011011')

    // `Z3` is the lookup table with input D held LOW: its low eight entries are the table's own, repeated,
    // and it must not read D at all.
    for (const generate of netlist.cells.filter((c) => partOf(c.ref) === 'carry-generate')) {
      const origin = netlist.origin.get(key(generate.ref)) as { lut: number; slice: string }
      const table = netlist.cells.find(
        (cell) =>
          partOf(cell.ref) === 'carry-lut' &&
          netlist.origin.get(key(cell.ref))?.slice === origin.slice &&
          netlist.origin.get(key(cell.ref))?.lut === origin.lut &&
          cell.ref.x === generate.ref.x &&
          cell.ref.y === generate.ref.y,
      ) as RecoveredCell
      for (let index = 0; index < 8; index++) {
        expect(generate.config.truth[index]).toBe(table.config.truth[index])
        expect(generate.config.truth[index | 8]).toBe(table.config.truth[index])
      }
      expect(generate.inputs[3]).toEqual({ kind: 'unused' })
    }

    // The chain starts at a CONSTANT, not at something a stimulus could drive: the tile to the west has no
    // carry unit switched on, so its carry output drives nothing.
    const first = carries.sort(
      (a, b) => a.ref.x - b.ref.x || a.ref.cell - b.ref.cell,
    )[0] as RecoveredCell
    expect(first.inputs[1]).toEqual({ kind: 'const', value: false })
  })

  test('the carry-generating table nobody wrote down is all-ONES, not empty', () => {
    // `SLICEA.K0.INIT` is absent from the unpacked file because a blank device already holds 0xFFFF — every
    // INIT bit is stored inverted. Reading it as 0x0000 stops the chain dead, and the router's own file, which
    // does write it down, says 0xFFFF.
    const written = parseNexusFasm(read('oxide-nexus-lifcl40-counter.fasm'))
    const explicit = written.tiles
      .get('R9C5__PLC')
      ?.assignments.find((a) => a.path === 'SLICEA.K0.INIT')
    expect(explicit?.value).toBe(0xffff)
    const unpacked = parseNexusFasm(read('oxide-nexus-lifcl40-counter-unpacked.fasm'))
    expect(
      unpacked.tiles.get('R9C5__PLC')?.assignments.find((a) => a.path === 'SLICEA.K0.INIT'),
    ).toBeUndefined()
    const recovered = recover('oxide-nexus-lifcl40-counter-unpacked.fasm')
    const carryLut = recovered.cells.find((c) => c.ref.x === 5 && c.ref.y === 9 && c.ref.cell === 8)
    expect(carryLut?.config.truth.every((bit) => bit)).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------------------
describe('a 16-bit counter, whose carry chain crosses three tiles', () => {
  for (const file of ['nexus-lifcl40-counter16.fasm', 'nexus-lifcl40-counter16-unpacked.fasm']) {
    test(`${file} counts to 300`, () => {
      const netlist = recover(file)
      const bits = registers(netlist)
      expect(bits.length).toBe(16)
      // three tiles, so the chain really does leave one and enter the next
      expect(new Set(bits.map((cell) => cell.ref.x)).size).toBe(3)
      const nets = primaryNets(netlist)
      const counting = nets.filter((net) => {
        const run = simulateClocked(netlist, new Map([[net, true]]), 301)
        return run.trace
          .map((frame) =>
            bits.reduce((sum, cell, bit) => sum + ((frame.get(key(cell.ref)) ? 1 : 0) << bit), 0),
          )
          .every((value, cycle) => value === cycle)
      })
      expect(counting.length).toBe(1)
    })
  }
})

// ---------------------------------------------------------------------------------------------------------
describe('a shift register with a synchronous reset and a clock enable', () => {
  /**
   * `fixtures/nexus-lifcl40-shiftreg-ce.v`:
   *
   *     always @(posedge clk) if (rst) s <= 4'b0; else if (ce) s <= {s[2:0], a};
   *
   * The packer allocated NO lookup tables at all for this: every register takes its data from the slice's `M`
   * bypass (`REG?.SEL DF`). A decoder that reads the register's data as "the lookup table beside it" recovers
   * four registers latching a constant — the table nobody programmed reads back all-ones.
   */
  for (const file of [
    'nexus-lifcl40-shiftreg-ce.fasm',
    'nexus-lifcl40-shiftreg-ce-unpacked.fasm',
  ]) {
    test(`${file} shifts, resets and holds`, () => {
      const netlist = recover(file)
      const stages = registers(netlist)
      expect(stages.length).toBe(4)
      // Not one lookup table in the design: every register is a buffer of its bypass input. The only other
      // cells are the two OR gates that give the synchronous reset priority over the clock-enable, one per
      // slice — `SRMODE LSR_OVER_CE`, which the shared simulator's own flip-flop gets the other way round.
      expect(netlist.cells.length).toBe(6)
      expect(
        netlist.cells.filter(
          (cell) => netlist.origin.get(key(cell.ref))?.part === 'enable-override',
        ).length,
      ).toBe(2)
      const nets = primaryNets(netlist)
      expect(nets.length).toBe(3)

      // Which external signal is the reset, which the enable and which the data is not assumed: every labelling
      // is tried and exactly one has to reproduce the Verilog.
      let seed = 987
      const random = (): boolean => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        return (seed >> 16) % 3 !== 0
      }
      const cycles = 120
      const draws = Array.from({ length: cycles }, () => [random(), random(), random()] as const)
      const working = permutations(nets).filter(([reset, enable, data]) => {
        const stimulus = draws.map(
          ([r, e, d]) =>
            new Map([
              [reset as number, r],
              [enable as number, e],
              [data as number, d],
            ]),
        )
        let state = [false, false, false, false]
        const expected: boolean[][] = []
        for (const [r, e, d] of draws) {
          expected.push([...state])
          if (r) state = [false, false, false, false]
          else if (e) state = [d, state[0] as boolean, state[1] as boolean, state[2] as boolean]
        }
        const run = simulateClocked(netlist, stimulus, cycles)
        // the four stages, ordered by following each register's data source back to the one fed from outside
        const order: RecoveredCell[] = []
        let current = stages.find((cell) => cell.inputs[0]?.kind === 'primary')
        while (current !== undefined) {
          order.push(current)
          const next: RecoveredCell | undefined = stages.find(
            (cell) =>
              cell.inputs[0]?.kind === 'cell' &&
              key(cell.inputs[0].driver) === key(current?.ref as CellRef),
          )
          current = next
        }
        if (order.length !== 4) return false
        return run.trace.every((frame, cycle) =>
          order.every((cell, stage) => frame.get(key(cell.ref)) === expected[cycle]?.[stage]),
        )
      })
      expect(working.length).toBe(1)
    })
  }
})

// ---------------------------------------------------------------------------------------------------------
describe('an asynchronous reset', () => {
  /**
   * `fixtures/nexus-lifcl40-asyncreset.v`:
   *
   *     always @(posedge clk or posedge rst) if (rst) s <= 2'b0; else s <= {s[0], a & b};
   *
   * The slice sets `SRMODE ASYNC`, and the two registers take their data differently — one from its own lookup
   * table (`SEL DL`), one from the `M` bypass (`SEL DF`) — so both data paths are exercised at once.
   */
  for (const file of ['nexus-lifcl40-asyncreset.fasm', 'nexus-lifcl40-asyncreset-unpacked.fasm']) {
    test(`${file} clears the moment the reset is asserted`, () => {
      const netlist = recover(file)
      const stages = registers(netlist)
      expect(stages.length).toBe(2)
      for (const cell of stages) expect(cell.config.asyncSetReset).toBe(true)
      const nets = primaryNets(netlist)
      expect(nets.length).toBe(3)

      let seed = 4242
      const random = (): boolean => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        return (seed >> 16) % 4 !== 0
      }
      const cycles = 120
      const draws = Array.from({ length: cycles }, () => [random(), random(), random()] as const)
      const working = permutations(nets).filter(([reset, a, b]) => {
        const stimulus = draws.map(
          ([r, x, y]) =>
            new Map([
              [reset as number, r],
              [a as number, x],
              [b as number, y],
            ]),
        )
        let state: [boolean, boolean] = [false, false]
        const expected: [boolean, boolean][] = []
        for (const [r, x, y] of draws) {
          // an asynchronous reset shows at the OUTPUT the instant it is asserted, not at the next edge
          expected.push(r ? [false, false] : [...state])
          state = r ? [false, false] : [x && y, state[0]]
        }
        const run = simulateClocked(netlist, stimulus, cycles)
        const first = stages.find((cell) => cell.inputs.some((s) => s.kind === 'primary'))
        const second = stages.find((cell) => cell !== first)
        if (first === undefined || second === undefined) return false
        return run.trace.every(
          (frame, cycle) =>
            frame.get(key(first.ref)) === expected[cycle]?.[0] &&
            frame.get(key(second.ref)) === expected[cycle]?.[1],
        )
      })
      // Two of the six labellings work, and only two: the data is `a & b`, which does not care which of the
      // two is which. The reset is pinned exactly — put it on either data input and nothing matches.
      expect(working.length).toBe(2)
      expect(new Set(working.map(([reset]) => reset)).size).toBe(1)
    })
  }
})

// ---------------------------------------------------------------------------------------------------------
describe('a four-way multiplexer, which the packer builds with the slice’s WIDE multiplexer', () => {
  /** `fixtures/nexus-lifcl40-mux4.v`: `q = s1 ? (s0 ? d3 : d2) : (s0 ? d1 : d0)` — six inputs, one output. */
  for (const file of ['nexus-lifcl40-mux4.fasm', 'nexus-lifcl40-mux4-unpacked.fasm']) {
    test(`${file} selects the right input for all 64 input combinations`, () => {
      const netlist = recover(file)
      const wide = netlist.cells.filter(
        (cell) => netlist.origin.get(key(cell.ref))?.part === 'wide-mux',
      )
      expect(wide.length).toBe(1)
      const output = wide[0] as RecoveredCell
      const nets = primaryNets(netlist)
      expect(nets.length).toBe(6)

      const working = permutations(nets).filter((labels) => {
        const [d0, d1, d2, d3, s0, s1] = labels as [number, number, number, number, number, number]
        for (let pattern = 0; pattern < 64; pattern++) {
          const bit = (index: number): boolean => ((pattern >> index) & 1) === 1
          const values = new Map([
            [d0, bit(0)],
            [d1, bit(1)],
            [d2, bit(2)],
            [d3, bit(3)],
            [s0, bit(4)],
            [s1, bit(5)],
          ])
          const expected = bit(4) ? (bit(5) ? bit(3) : bit(1)) : bit(5) ? bit(2) : bit(0)
          if (simulateCombinational(netlist, values).outputs.get(key(output.ref)) !== expected)
            return false
        }
        return true
      })
      // Two of the 720 labellings work, and only two: a four-way multiplexer is unchanged by swapping its two
      // select lines as long as the two middle data inputs swap with them. Nothing else fits.
      expect(working.length).toBe(2)
      const [first, second] = working as [number[], number[]]
      expect(first[0]).toBe(second[0]) // d0 and d3 are pinned outright
      expect(first[3]).toBe(second[3])
    })
  }
})

// ---------------------------------------------------------------------------------------------------------
describe('a wide multiplexer whose two halves are NOT interchangeable', () => {
  /**
   * `fixtures/nexus-lifcl40-widemux-asym.v`: `q = sel ? (a & b & c & d) : (a | b | c | d)`.
   *
   * The four-way multiplexer next door cannot pin the multiplexer's SELECT POLARITY: swapping which lookup
   * table the high select picks is undone by relabelling the inputs, so both readings survive. This design
   * cannot be relabelled out of. Its two halves compute different functions of the SAME four signals, so
   * choosing the wrong one on a high select produces a function no permutation of five inputs can fix — and
   * the count of working labellings drops from 24 to nothing.
   */
  for (const file of [
    'nexus-lifcl40-widemux-asym.fasm',
    'nexus-lifcl40-widemux-asym-unpacked.fasm',
  ]) {
    test(`${file} picks the second lookup table when the select is HIGH`, () => {
      const netlist = recover(file)
      const wide = netlist.cells.filter(
        (cell) => netlist.origin.get(key(cell.ref))?.part === 'wide-mux',
      )
      expect(wide.length).toBe(1)
      const output = wide[0] as RecoveredCell
      const nets = primaryNets(netlist)
      expect(nets.length).toBe(5)

      const working = permutations(nets).filter((labels) => {
        const [select, ...data] = labels as [number, number, number, number, number]
        for (let pattern = 0; pattern < 32; pattern++) {
          const bit = (index: number): boolean => ((pattern >> index) & 1) === 1
          const values = new Map(data.map((net, index) => [net, bit(index)]))
          values.set(select, bit(4))
          const expected = bit(4)
            ? data.every((_, index) => bit(index))
            : data.some((_, index) => bit(index))
          if (simulateCombinational(netlist, values).outputs.get(key(output.ref)) !== expected)
            return false
        }
        return true
      })
      // the select is pinned exactly; the four data inputs are interchangeable, so 4! labellings work
      expect(working.length).toBe(24)
      expect(new Set(working.map(([select]) => select)).size).toBe(1)
    })
  }
})

// ---------------------------------------------------------------------------------------------------------
describe('one XNOR gate behind a register', () => {
  for (const file of ['nexus-lifcl40-xnor-dff.fasm', 'nexus-lifcl40-xnor-dff-unpacked.fasm']) {
    test(`${file} stores the XNOR of its two inputs`, () => {
      const netlist = recover(file)
      expect(netlist.cells.length).toBe(1)
      const cell = netlist.cells[0] as RecoveredCell
      expect(cell.config.dffEnable).toBe(true)
      const [a, b] = primaryNets(netlist) as [number, number]
      for (const x of [false, true])
        for (const y of [false, true]) {
          const run = simulateClocked(
            netlist,
            new Map([
              [a, x],
              [b, y],
            ]),
            2,
          )
          expect(run.trace[1]?.get(key(cell.ref))).toBe(x === y)
        }
    })
  }
})

// ---------------------------------------------------------------------------------------------------------
describe('a register on the FALLING edge of the clock', () => {
  /**
   * `fixtures/nexus-lifcl40-negclk.v`:
   *
   *     always @(negedge clk) r0 <= a & b;
   *     always @(posedge clk) r1 <= r0;
   *
   * The slice sets `CLKMUX INV`. A falling-edge register between two rising-edge ones moves data through in the
   * SAME clock period, so reading the inversion as "rising" reports the design a whole period slower than the
   * silicon — and both edges here run off ONE clock, which is why this must not be reported as two.
   */
  for (const file of ['nexus-lifcl40-negclk.fasm', 'nexus-lifcl40-negclk-unpacked.fasm']) {
    test(`${file} is one clock with two edges, and the data lands a period early`, () => {
      const netlist = recover(file)
      const stages = registers(netlist)
      expect(stages.length).toBe(2)
      expect(stages.filter((cell) => cell.negClk === true).length).toBe(1)
      // one clock — the two edges are two edges, not two clocks, and nothing is declared unreproducible
      expect(netlist.clocks.length).toBe(1)
      expect(netlist.incomplete).toEqual([])

      const falling = stages.find((cell) => cell.negClk === true) as RecoveredCell
      const rising = stages.find((cell) => cell.negClk !== true) as RecoveredCell
      const [a, b] = primaryNets(netlist) as [number, number]
      let seed = 77
      const random = (): boolean => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        return (seed >> 16) % 2 === 1
      }
      const cycles = 60
      const draws = Array.from({ length: cycles }, () => [random(), random()] as const)
      const run = simulateClocked(
        netlist,
        draws.map(
          ([x, y]) =>
            new Map([
              [a, x],
              [b, y],
            ]),
        ),
        cycles,
      )
      for (let cycle = 2; cycle < cycles; cycle++) {
        const previous = draws[cycle - 1] as readonly [boolean, boolean]
        const before = draws[cycle - 2] as readonly [boolean, boolean]
        expect(run.trace[cycle]?.get(key(falling.ref))).toBe(previous[0] && previous[1])
        expect(run.trace[cycle]?.get(key(rising.ref))).toBe(before[0] && before[1])
      }
    })
  }
})

// ---------------------------------------------------------------------------------------------------------
describe('an ACTIVE-LOW clock enable', () => {
  /**
   * `fixtures/nexus-lifcl40-active-low-enable.v`: `always @(posedge clk) if (!ce_n) r <= a;`
   *
   * The packer put the inversion in the slice (`CEMUX INV`) rather than in a lookup table, and the shared cell
   * has no inverted enable — so one is built out of an ordinary one-input lookup table.
   */
  for (const file of [
    'nexus-lifcl40-active-low-enable.fasm',
    'nexus-lifcl40-active-low-enable-unpacked.fasm',
  ]) {
    test(`${file} latches when the enable is LOW`, () => {
      const netlist = recover(file)
      const stages = registers(netlist)
      expect(stages.length).toBe(1)
      const inverters = netlist.cells.filter(
        (cell) => netlist.origin.get(key(cell.ref))?.part === 'enable-inverter',
      )
      expect(inverters.length).toBe(1)
      const register = stages[0] as RecoveredCell
      expect(register.clockEnable).toEqual({
        kind: 'cell',
        driver: (inverters[0] as RecoveredCell).ref,
        net: expect.any(Number),
      })

      const nets = primaryNets(netlist)
      expect(nets.length).toBe(2)
      let seed = 314
      const random = (): boolean => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        return (seed >> 16) % 2 === 1
      }
      const cycles = 80
      const draws = Array.from({ length: cycles }, () => [random(), random()] as const)
      const working = permutations(nets).filter(([enableLow, data]) => {
        const run = simulateClocked(
          netlist,
          draws.map(
            ([e, d]) =>
              new Map([
                [enableLow as number, e],
                [data as number, d],
              ]),
          ),
          cycles,
        )
        let held = false
        return draws.every(([e, d], cycle) => {
          const seen = run.trace[cycle]?.get(key(register.ref)) === held
          if (!e) held = d
          return seen
        })
      })
      expect(working.length).toBe(1)
    })
  }
})

// ---------------------------------------------------------------------------------------------------------
describe('a distributed memory is named, not simulated as logic', () => {
  /**
   * `fixtures/nexus-lifcl40-lutram.v` — sixteen bits of memory written on the clock and read back
   * combinationally, which the packer builds out of a `PLC` tile's own lookup-table storage.
   *
   * The trap: the database gives slice A and slice B's `DPRAM` an EMPTY bit list, so a memory slice and a plain
   * logic slice are stored IDENTICALLY and no bitstream can tell them apart. What can be told apart is slice
   * C's `RAMW`, which does have bits — and slice C is the write port that drives exactly those two slices. So a
   * memory is recognised by its write port, and the four lookup tables holding it are left out and named rather
   * than simulated as a constant (which is all their power-up image is).
   */
  for (const file of ['nexus-lifcl40-lutram.fasm', 'nexus-lifcl40-lutram-unpacked.fasm']) {
    test(`${file} reports six refused cells and simulates none of them`, () => {
      const netlist = recover(file)
      const memoryTile = { x: 2, y: 2 }
      const refused = (netlist.undecoded ?? []).filter(
        (caveat) => caveat.ref.x === memoryTile.x && caveat.ref.y === memoryTile.y,
      )
      // slices A and B hold the memory; slice C is its write port — six cells in all
      expect(refused.map((caveat) => caveat.ref.cell).sort((a, b) => a - b)).toEqual([
        0, 1, 2, 3, 4, 5,
      ])
      expect(refused.filter((c) => c.reason.includes('WRITE PORT')).length).toBe(2)
      // and not one of them is in the netlist pretending to be logic
      for (const caveat of refused)
        expect(netlist.cells.some((cell) => key(cell.ref) === key(caveat.ref))).toBe(false)
    })
  }

  test('the write-port slice is the only thing a bitstream can say about a distributed memory', () => {
    // If this ever changes — if `DPRAM` gains bits of its own — the check above can be tightened. Today it
    // cannot: the router's own file does not say `DPRAM` either, only `RAMW` on slice C.
    const written = parseNexusFasm(read('nexus-lifcl40-lutram.fasm'))
    const modes = [...written.tiles.values()]
      .filter((tile) => tile.type === 'PLC')
      .flatMap((tile) =>
        tile.features
          .filter((f) => /^SLICE[A-D]\.MODE$/.test(f.path))
          .map((f) => `${f.path}.${f.value}`),
      )
    expect(modes).toEqual(['SLICEC.MODE.RAMW'])
  })
})

// ---------------------------------------------------------------------------------------------------------
describe('what it refuses, and what it says instead', () => {
  /**
   * Each fixture here was made by changing ONE setting in a real design and then running the result through
   * `prjoxide pack` and `prjoxide unpack` — so what is committed is a real bitstream readback, not hand-written
   * text. If the packer could not express the setting, or the unpacker did not read it back, the file would not
   * contain it and these tests would fail on the fixture rather than on the decoder.
   */
  const reasonsFor = (netlist: NexusNetlist, ref: CellRef): string =>
    (netlist.incomplete ?? [])
      .filter((caveat) => key(caveat.ref) === key(ref))
      .map((caveat) => caveat.reason)
      .join(' ')

  test('a register clocked on BOTH edges is named, not quietly given one', () => {
    // The double-edge bit was set on the counter's slice B, whose two registers are cells 2 and 3 — and on
    // slice A, which has none. Exactly those two registers have to be named, and no others.
    const netlist = recover('nexus-lifcl40-doubleedge.fasm')
    expect(registers(netlist).length).toBe(8)
    const named = (netlist.incomplete ?? [])
      .filter((caveat) => caveat.reason.includes('BOTH edges'))
      .map((caveat) => key(caveat.ref))
      .sort()
    expect(named).toEqual(['5_9_2', '5_9_3'])
    // the design it came from says nothing of the sort
    expect(recover('oxide-nexus-lifcl40-counter.fasm').incomplete).toEqual([])
  })

  test('a register switched on with its clock tied low is named', () => {
    const netlist = recover('nexus-lifcl40-clock-tied-low.fasm')
    const affected = (netlist.incomplete ?? []).filter((caveat) =>
      caveat.reason.includes('ties the clock low'),
    )
    expect(affected.length).toBeGreaterThan(0)
  })

  test('a set/reset whose VALUE comes from the M input is named', () => {
    const netlist = recover('nexus-lifcl40-preload.fasm')
    const affected = (netlist.incomplete ?? []).filter((caveat) =>
      caveat.reason.includes('LSRMODE PRLD'),
    )
    expect(affected.length).toBeGreaterThan(0)
  })

  test('a routed set/reset the slice inverts is LEFT OUT, because the bitstream cannot say which was meant', () => {
    // `INV` and `0` occupy the same bit. With the line at its tied-high default both readings agree; with a
    // real signal on it they do not, so the set/reset is dropped and said out loud rather than guessed.
    const netlist = recover('nexus-lifcl40-inverted-reset.fasm')
    const stages = registers(netlist)
    expect(stages.length).toBe(4)
    for (const cell of stages) {
      expect(cell.setReset).toBeNull()
      expect(reasonsFor(netlist, cell.ref)).toContain('cannot be told apart')
    }
    // and the design it was derived from, which does NOT invert, keeps its reset
    for (const cell of registers(recover('nexus-lifcl40-shiftreg-ce.fasm')))
      expect(cell.setReset?.kind).toBe('primary')
  })

  test('a lookup table that depends on a pin nothing was routed to is named', () => {
    const netlist = recover('nexus-lifcl40-unrouted-input.fasm')
    const cell = netlist.cells[0] as RecoveredCell
    expect(reasonsFor(netlist, cell.ref)).toContain('input C of this lookup table')
    expect(cell.inputs[2]).toEqual({ kind: 'unused' })
    // the design it came from routes that pin, and says nothing
    expect(recover('nexus-lifcl40-xnor-dff.fasm').incomplete).toEqual([])
  })

  test('a register clocked on both edges is named even when only REGDDR says so', () => {
    // The packed bitstream stores `REGDDR ENABLED` in the SAME bits as `CLKMUX DDR`, so the readback always
    // shows both and the clock half of the test alone would catch it. A router-written file does not: this
    // one says `CLKMUX CLK` and `REGDDR ENABLED` together, which only the REGDDR half can see.
    const written = parseNexusFasm(read('nexus-lifcl40-doubleedge-router.fasm'))
    const slice = written.tiles.get('R9C5__PLC')?.features ?? []
    expect(slice.some((f) => f.path === 'SLICEB.REGDDR' && f.value === 'ENABLED')).toBe(true)
    expect(slice.some((f) => f.path === 'SLICEB.CLKMUX' && f.value === 'DDR')).toBe(false)
    const netlist = reconstructNexusNetlist(written)
    const named = (netlist.incomplete ?? [])
      .filter((caveat) => caveat.reason.includes('BOTH edges'))
      .map((caveat) => key(caveat.ref))
      .sort()
    expect(named).toEqual(['5_9_2', '5_9_3'])
  })

  test('another lookup table reading a REGISTERED cell’s raw output is told it cannot have it', () => {
    // `nexus-lifcl40-raw-lut-read.fasm` is the one-gate design with a second lookup table wired to the FIRST
    // one's raw `JF0` output — the output its register has taken over. A shared cell holds one function, so
    // the reader must be told, not handed the register's stored value.
    const netlist = recover('nexus-lifcl40-raw-lut-read.fasm')
    const reader = netlist.cells.find((cell) => cell.ref.cell === 2) as RecoveredCell
    expect(reader.inputs[0]?.kind).toBe('primary')
    expect(reasonsFor(netlist, reader.ref)).toContain('raw lookup-table output')
    // and the register itself is still the design's real one, driving its own Q
    const register = netlist.cells.find((cell) => cell.ref.cell === 0) as RecoveredCell
    expect(register.config.dffEnable).toBe(true)
    // the design it came from has no such reader, and says nothing
    expect(recover('nexus-lifcl40-xnor-dff.fasm').incomplete).toEqual([])
  })

  test('an arithmetic slice with the carry injected cuts the chain, and stops counting', () => {
    // `CCU2.INJECT` reads back as YES on a blank device, so an ABSENT value is not `NO`. With injection on,
    // that slice's output is its lookup table alone and its carry-out is gated — the counter breaks, which is
    // exactly what makes this observable.
    const netlist = recover('nexus-lifcl40-carry-injected.fasm')
    const bits = registers(netlist)
    expect(bits.length).toBe(8)
    const counts = primaryNets(netlist).map((net) => {
      const run = simulateClocked(netlist, new Map([[net, true]]), 9)
      return run.trace
        .map((frame) =>
          bits.reduce((sum, cell, bit) => sum + ((frame.get(key(cell.ref)) ? 1 : 0) << bit), 0),
        )
        .join(',')
    })
    expect(counts).not.toContain('0,1,2,3,4,5,6,7,8')

    // ...and what an injected slice computes instead is checked as a value, not just as "different": with the
    // carry cut off, `F = Z` alone and `FCO = Z & carry-in`, and there is no generate term to build at all.
    const partOf = (ref: CellRef): string => netlist.origin.get(key(ref))?.part ?? ''
    const table = (truth: readonly boolean[]): string => truth.map((b) => (b ? 1 : 0)).join('')
    const injected = netlist.cells.filter(
      (cell) => cell.ref.x === 5 && cell.ref.y === 9 && [2, 3].includes(cell.ref.cell),
    )
    expect(injected.length).toBe(2)
    for (const cell of injected) {
      expect(table(cell.config.truth)).toBe('0101010101010101') // a buffer of the lookup table
      expect(cell.inputs[1]).toEqual({ kind: 'unused' }) // the carry does not reach the output at all
    }
    for (const carry of netlist.cells.filter(
      (cell) => cell.ref.x === 5 && cell.ref.y === 9 && [26, 27].includes(cell.ref.cell),
    )) {
      expect(partOf(carry.ref)).toBe('carry-out')
      expect(table(carry.config.truth)).toBe('0001000100010001') // lookup table AND carry-in
      expect(carry.inputs[2]).toEqual({ kind: 'unused' })
    }
    expect(
      netlist.cells.filter(
        (cell) => cell.ref.x === 5 && cell.ref.y === 9 && [18, 19].includes(cell.ref.cell),
      ).length,
    ).toBe(0)
    // the un-injected slice next to it keeps its XOR and its generate term
    const neighbour = netlist.cells.find(
      (cell) => cell.ref.x === 5 && cell.ref.y === 9 && cell.ref.cell === 4,
    ) as RecoveredCell
    expect(table(neighbour.config.truth)).toBe('0110011001100110')
  })

  test('a register with no REGSET written down SETS, because that is what a blank device holds', () => {
    const netlist = recover('nexus-lifcl40-preset.fasm')
    const stages = registers(netlist)
    expect(stages.length).toBe(4)
    for (const cell of stages) expect(cell.config.setNoReset).toBe(true)
    // the design it came from writes RESET down, and resets
    for (const cell of registers(recover('nexus-lifcl40-shiftreg-ce.fasm')))
      expect(cell.config.setNoReset).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------------------
describe('two clocks are two clocks', () => {
  /**
   * The two-clock design uses the SAME wire names — `HPBX0000` for both — and is told apart only by which clock
   * region each half runs in. A first guess that the branch was scoped by ROW was refuted by this very design:
   * both clocks are on row 9.
   */
  const netlist = recover('nexus-lifcl40-twoclock.fasm')

  test('the two clocks come out as two, not one', () => {
    expect(netlist.clocks.length).toBe(2)
    // Named as VALUES, not as a shape. Both clocks use `HPBX0000` for the branch, `VPSX0400` for the spine and
    // `HPRX0400` for the horizontal row — every wire name on the way down is shared, and the ONLY thing that
    // tells them apart is which half of the die each is distributed in.
    expect(netlist.clocks.map((c) => c.wire)).toEqual(['HROW_L_HPRX0400', 'HROW_R_HPRX0400'])
  })

  test('and every register affected is told that a single-clock run cannot reproduce it', () => {
    const clocked = netlist.cells.filter((cell) => cell.config.dffEnable)
    expect(clocked.length).toBeGreaterThan(0)
    for (const cell of clocked)
      expect(netlist.incomplete?.some((caveat) => key(caveat.ref) === key(cell.ref))).toBe(true)
  })

  test('a branch is scoped by its clock REGION — same row, different region, different net', () => {
    expect(nexusClockScope(9, 2, 'BRANCH', 'HPBX0000')).toBe('BRANCH0_R9_HPBX0000')
    expect(nexusClockScope(9, 40, 'BRANCH', 'HPBX0000')).toBe('BRANCH3_R9_HPBX0000')
    // a tap tile drives the segment on each side of it, and names them apart
    expect(nexusClockScope(9, 14, 'BRANCH_L', 'HPBX0000')).toBe('BRANCH0_R9_HPBX0000')
    expect(nexusClockScope(9, 14, 'BRANCH_R', 'HPBX0000')).toBe('BRANCH1_R9_HPBX0000')
    // nothing else is scoped: the spine's own region map is not pinned, so it is left alone
    expect(nexusClockScope(9, 2, 'SPINE', 'VPSX0400')).toBeNull()
  })

  test('a spine and a horizontal row are scoped by die half, and nothing else is scoped at all', () => {
    // the tap tiles, which stand one column east of the spine they read
    expect(nexusClockScope(9, 14, 'SPINE', 'VPSX0400')).toBe('SPINE_L_VPSX0400')
    expect(nexusClockScope(9, 38, 'SPINE', 'VPSX0400')).toBe('SPINE_L_VPSX0400')
    expect(nexusClockScope(9, 62, 'SPINE', 'VPSX0400')).toBe('SPINE_R_VPSX0400')
    expect(nexusClockScope(9, 74, 'SPINE', 'VPSX0400')).toBe('SPINE_R_VPSX0400')
    // the spine tiles themselves, where the horizontal row is named
    expect(nexusClockScope(29, 13, 'HROW', 'HPRX0400')).toBe('HROW_L_HPRX0400')
    expect(nexusClockScope(29, 37, 'HROW', 'HPRX0400')).toBe('HROW_L_HPRX0400')
    expect(nexusClockScope(29, 62, 'HROW', 'HPRX0400')).toBe('HROW_R_HPRX0400')
    expect(nexusClockScope(29, 74, 'HROW', 'HPRX0400')).toBe('HROW_R_HPRX0400')
    // a column no spine stands near is refused rather than guessed into a half
    expect(nexusClockHalf(2)).toBeNull()
    expect(nexusClockHalf(48)).toBeNull()
    expect(nexusClockScope(29, 48, 'SPINE', 'VPSX0400')).toBeNull()
    // and the trunk above the horizontal row is left alone entirely
    expect(nexusClockScope(29, 48, 'G', 'LHPRX4')).toBeNull()
  })

  test('the half map agrees with the L/R the vendor writes into its own spine tile names', () => {
    /**
     * An independent check on the half assignment, from data rather than from the table it was built out of:
     * `prjoxide` names the spine tile at column 13 `SPINE_L1` and the one at column 62 `SPINE_R0`, so the
     * toolchain states the side itself. Every spine tile in every fixture must agree with `nexusClockHalf`.
     */
    let checked = 0
    for (const file of [
      'nexus-lifcl40-twoclock.fasm',
      'nexus-lifcl40-oneclock-rows.fasm',
      'nexus-lifcl40-fourclock.fasm',
      'oxide-nexus-lifcl40-counter.fasm',
    ]) {
      for (const tile of parseNexusFasm(read(file)).tiles.values()) {
        const vendorSide = /^SPINE_([LR])\d/.exec(tile.type)?.[1]
        if (vendorSide === undefined) continue
        expect(nexusClockHalf(tile.col)).toBe(vendorSide)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  test('both tables in source are exactly what the device database exports, entry for entry', () => {
    /**
     * The same guard the logic-tile fabric has: every number in the clock-region tables is transcribed, so it
     * is compared against a verbatim extract of `prjoxide bba-export`'s own output rather than trusted. This is
     * what makes `hrowCol` a checked number instead of one nobody reads.
     */
    const vendored = JSON.parse(read('oxide-nexus-lifcl40-clock-regions.json')) as {
      branches: { fromCol: number; toCol: number; tapCol: number; tapSide: string }[]
      spines: { fromRow: number; toRow: number; spineRow: number }
      hrows: { hrowCol: number; spineCols: number[] }[]
    }
    expect(
      LIFCL40_BRANCH_SEGMENTS.map((s) => ({
        fromCol: s.fromCol,
        toCol: s.toCol,
        tapCol: s.tapCol,
        tapSide: s.tapSide,
      })),
    ).toEqual(
      vendored.branches.map((s) => ({
        fromCol: s.fromCol,
        toCol: s.toCol,
        tapCol: s.tapCol,
        tapSide: s.tapSide,
      })),
    )
    expect(
      LIFCL40_CLOCK_HALVES.map((h) => ({ hrowCol: h.hrowCol, spineCols: [...h.spineCols] })),
    ).toEqual(vendored.hrows)
    // one spine entry, covering every row — which is why a spine is named by its column and carries no row
    expect(vendored.spines.fromRow).toBe(1)
    expect(vendored.spines.toRow).toBe(55)
  })

  test('the segments cover the die without gaps or overlaps, and tap where the tap tiles are', () => {
    const sorted = [...LIFCL40_BRANCH_SEGMENTS].sort((a, b) => a.fromCol - b.fromCol)
    for (let i = 1; i < sorted.length; i++)
      expect((sorted[i] as { fromCol: number }).fromCol).toBe(
        (sorted[i - 1] as { toCol: number }).toCol + 1,
      )
    expect([...new Set(sorted.map((s) => s.tapCol))].sort((a, b) => a - b)).toEqual([
      14, 38, 62, 74,
    ])
  })
})

// ---------------------------------------------------------------------------------------------------------
describe('one clock spread over many rows is ONE clock', () => {
  /**
   * The failure that runs the other way from two clocks merging, and the one an ordinary design actually hits.
   *
   * `fixtures/nexus-lifcl40-oneclock-rows.v` is a 128-bit shift register on a single clock. A clock BRANCH is
   * one row wide, so the router lands this design's registers on eleven rows and drives each row's branch from
   * its own tap tile — all eleven called `HPBX0000`, all eleven fed by one spine. Scoping the clock to its
   * branch and stopping there reports eleven separate clocks and puts an "this design clocks its registers from
   * more than one clock net" caveat on all 128 registers of a design that has exactly one.
   */
  for (const file of [
    'nexus-lifcl40-oneclock-rows.fasm',
    'nexus-lifcl40-oneclock-rows-unpacked.fasm',
  ]) {
    test(`${file} recovers as one clock carrying every one of its 128 registers`, () => {
      const netlist = recover(file)
      expect(netlist.clocks.length).toBe(1)
      expect(netlist.clocks[0]?.wire).toBe('HROW_L_HPRX0400')
      expect(netlist.clocks[0]?.refs.length).toBe(128)
      expect(registers(netlist).length).toBe(128)
      // the design has one clock, so nothing may be said about clock domains at all
      for (const caveat of netlist.incomplete ?? [])
        expect(caveat.reason).not.toContain('clock net')
    })
  }

  test('the branches really are on eleven different rows, all under the one clock', () => {
    const fasm = parseNexusFasm(read('nexus-lifcl40-oneclock-rows.fasm'))
    const branchRows = new Set<number>()
    const tapCols = new Set<number>()
    for (const tile of fasm.tiles.values())
      for (const pip of tile.pips) {
        if (pip.source.startsWith('BRANCH__')) branchRows.add(tile.row)
        if (tile.type === 'TAP_PLC') tapCols.add(tile.col)
      }
    expect([...branchRows].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13])
    // every one of those rows is tapped from the SAME column, which is why they are one clock
    expect([...tapCols]).toEqual([14])
  })
})

// ---------------------------------------------------------------------------------------------------------
describe('a four-clock design, and the limit of how far a clock is told apart', () => {
  /**
   * `fixtures/nexus-lifcl40-fourclock.v` has four independent clocks driving four register banks. It is here
   * for two separate reasons.
   *
   * FIRST, it refutes scoping a branch by its segment alone: this design puts TWO DIFFERENT clocks on
   * `HPBX0100` in the same branch segment, on rows 2 and 3 — so the row half of the branch scope is doing real
   * work, shown by a design other than the two-clock one it was first read off.
   *
   * SECOND, it is where the honesty stops. Clock nets are told apart as far as the horizontal row and no
   * further: this design's four clocks reach SIX horizontal-row wires between them (two of the four are
   * distributed over two rows each), and the wire that would join those pairs is named `HPRX0200` at one end
   * and `LHPRX2` at the other with no routing arc in between to say they are the same. So six is reported. That
   * is an over-count, it is pinned here as the value it actually is, and it is why the caveat on a register
   * never states a NUMBER of clocks.
   */
  for (const file of ['nexus-lifcl40-fourclock.fasm', 'nexus-lifcl40-fourclock-unpacked.fasm']) {
    test(`${file}: six clock nets, for a design with four clocks`, () => {
      const netlist = recover(file)
      expect(netlist.clocks.map((c) => c.wire)).toEqual([
        'HROW_L_HPRX0000',
        'HROW_L_HPRX0200',
        'HROW_L_HPRX0400',
        'HROW_L_HPRX0500',
        'HROW_L_HPRX0700',
        'HROW_L_HPRX0800',
      ])
      // the design really has FOUR clocks: the toolchain switches on one clock-divider cell per global clock
      const fasm = parseNexusFasm(read(file))
      const dividers = new Set<string>()
      for (const tile of fasm.tiles.values())
        for (const feature of tile.features)
          if (feature.path.endsWith('.DCCEN')) dividers.add(`${tile.name}/${feature.path}`)
      expect(dividers.size).toBe(4)
    })
  }

  test('two different clocks share one branch wire name in one segment, told apart by row', () => {
    const fasm = parseNexusFasm(read('nexus-lifcl40-fourclock.fasm'))
    const rows = new Set<number>()
    for (const tile of fasm.tiles.values())
      for (const pip of tile.pips)
        if (pip.source === 'BRANCH__HPBX0100' && tile.type === 'PLC') rows.add(tile.row)
    expect([...rows].sort((a, b) => a - b)).toEqual([2, 3, 4, 5])
    // rows 2 and 5 are one clock; rows 3 and 4 are a different one — the same wire name in the same segment
    const netlist = recover('nexus-lifcl40-fourclock.fasm')
    const clockOfRow = new Map<number, string>()
    for (const domain of netlist.clocks)
      for (const ref of domain.refs) clockOfRow.set(ref.y, domain.wire)
    expect(clockOfRow.size).toBeGreaterThan(0)
    expect(netlist.clocks.length).toBeGreaterThan(1)
  })

  test('every register is told a single-clock run cannot reproduce it, without claiming a count', () => {
    const netlist = recover('nexus-lifcl40-fourclock.fasm')
    const clocked = netlist.cells.filter((cell) => cell.config.dffEnable)
    expect(clocked.length).toBeGreaterThan(0)
    /**
     * No caveat on ANY register may state a NUMBER of clocks. Deliberately not filtered to the caveats that
     * already mention a clock net: filtering that way let a mutation reinstating "this design uses 6 separate
     * clocks" walk straight through, because the reworded text no longer matched the filter.
     */
    for (const cell of clocked) {
      const caveat = netlist.incomplete?.find((entry) => key(entry.ref) === key(cell.ref))
      expect(caveat?.reason).toContain('more than one clock net')
      expect(caveat?.reason).not.toMatch(/\d+\s+(?:separate|clock)/)
    }
  })
})

// ---------------------------------------------------------------------------------------------------------
describe('two routing arcs that disagree about a clock wire are refused, not merged', () => {
  /**
   * The guard on the one thing die-half scoping could get wrong. Two spines of the SAME half both carrying
   * spine wire `VPSX0400` would land under one name here, and if they were fed by different horizontal-row
   * wires they would be two clocks quietly become one — the exact failure the whole region map exists to stop.
   *
   * `fixtures/nexus-lifcl40-spine-conflict.fasm` is the one-clock design with a second spine tile's arc added
   * by hand, driving that same spine from `HPRX0500` instead of `HPRX0400`. No toolchain wrote it; it exists to
   * fire this refusal. The reader must fall back to the last identity it can still trust — the branch — which
   * over-splits and says so, rather than merging.
   */
  const netlist = recover('nexus-lifcl40-spine-conflict.fasm')

  test('the trace stops below the disputed wire instead of crossing it', () => {
    expect(netlist.clocks.length).toBeGreaterThan(1)
    for (const clock of netlist.clocks) expect(clock.wire).toMatch(/^BRANCH\d+_R\d+_HPBX0000$/)
  })

  test('and every register affected says why', () => {
    const clocked = netlist.cells.filter((cell) => cell.config.dffEnable)
    expect(clocked.length).toBe(128)
    for (const cell of clocked) {
      const caveat = netlist.incomplete?.find((entry) => key(entry.ref) === key(cell.ref))
      expect(caveat?.reason).toContain('two routing arcs drive from different sources')
    }
  })

  test('the unedited design it was made from has no conflict and stays one clock', () => {
    expect(recover('nexus-lifcl40-oneclock-rows.fasm').clocks.length).toBe(1)
  })

  test('two arcs that AGREE are not a conflict — the same arc written twice changes nothing', () => {
    /**
     * The other half of the conflict test, and it needs its own fixture: no design the toolchain writes states
     * one clock arc twice, so without this the "…and the sources differ" half of the check was never exercised
     * and a version that called every repeated arc a conflict passed the whole suite.
     * `nexus-lifcl40-spine-duplicate.fasm` is the one-clock design with its spine arc repeated verbatim.
     */
    const netlist = recover('nexus-lifcl40-spine-duplicate.fasm')
    expect(netlist.clocks.map((c) => c.wire)).toEqual(['HROW_L_HPRX0400'])
    for (const caveat of netlist.incomplete ?? [])
      expect(caveat.reason).not.toContain('different sources')
  })

  test('a clock network that loops back on itself terminates instead of hanging', () => {
    /**
     * `nexus-lifcl40-spine-conflict.fasm`'s sibling: the one-clock design with an arc added that drives the
     * horizontal row FROM the spine it feeds, so the two point at each other. Nothing the toolchain writes
     * looks like this — it is here because the walk up the clock network follows a file's own arcs, and a file
     * is not obliged to be sane. Without the cycle guard this test does not fail, it hangs.
     */
    const netlist = recover('nexus-lifcl40-clock-loop.fasm')
    expect(netlist.clocks.map((c) => c.wire)).toEqual(['HROW_L_HPRX0400'])
    expect(netlist.clocks[0]?.refs.length).toBe(128)
  })
})
