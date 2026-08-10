/**
 * FPGA fabric — ECP5 (Project Trellis): assemble the decoded tiles into a SIMULATABLE netlist.
 *
 * This is the ECP5 counterpart of iCE40's `reconstructNetlist`, and its whole point is that it produces the SAME
 * `RecoveredNetlist` the iCE40 path already produces — so an ECP5 bitstream flows into `simulateCombinational`,
 * `simulateClocked` and `lowerNetlistToCanvas` with no new simulator, no new canvas lowering, nothing duplicated.
 *
 * The mapping onto that shared model, read off the PLC2 database's own names:
 *   - a PLC2 tile holds EIGHT LUT4s, indexed k = 0..7 — SLICE A holds k 0,1; B holds 2,3; C holds 4,5; D holds 6,7
 *     (i.e. `SLICE<A+floor(k/2)>.K<k mod 2>`), which is exactly the tile's `F0..F7` / `Q0..Q7` numbering.
 *   - LUT k's four inputs are the tile's routed pins `A<k>`, `B<k>`, `C<k>`, `D<k>` (the `.mux` sinks); its LUT
 *     output is `F<k>` and its flip-flop output is `Q<k>`.
 *   - a tile named `R<row>C<col>` becomes `CellRef { x: col, y: row, cell: k }`, so cells keep the coordinates the
 *     device itself uses.
 *
 * An input pin resolves by asking the tile's mux what drives it. A source of `F<j>` or `Q<j>` is another LUT in the
 * same tile, so it becomes a `cell` source — and because our simulator already returns a registered cell's stored Q
 * as its output, `Q<j>` needs no special case. Anything else is a wire arriving from outside the tile and is
 * reported as a `primary` (never guessed at), with wire names interned to the numeric nets the shared model uses.
 *
 * Honest scope: connectivity is resolved WITHIN a tile. ECP5 routing between tiles travels on wires whose names
 * encode direction and span (`E1_H01E0001` and friends); following those across the fabric needs the global wire
 * model, which is not built yet — so a signal entering a tile from elsewhere is an honest primary input rather than
 * a wrong connection. A LUT's flip-flop is marked in use when something in the tile actually reads its `Q` output,
 * which is how an ECP5 design shows that the register (rather than the bare LUT) is the driver.
 *
 * A SLICE is NOT always the pair of plain lookup tables the paragraphs above describe, and three of its other
 * shapes are handled here — the first one modelled, the other two declared untrustworthy rather than guessed at:
 *
 *   - The REGISTER'S DATA SOURCE is a mux (`SLICE?.REG?.SD`): `DI<k>`, a fixed connection from the lookup-table
 *     output wire `F<k>`, or `M<k>`, a routed tile input that bypasses the lookup table entirely. Every register
 *     whose D comes from routing rather than from logic — a shift register, a pipeline stage, any `q <= other_q`
 *     — takes the `M<k>` path, so ignoring it loses the design's whole data flow. It is resolved below by tracing
 *     `M<k>` exactly as an ordinary pin is traced; the cell then carries a BUFFER of that source as its
 *     next-state function.
 *   - The WIDE-FUNCTION MULTIPLEXERS `OFX0` / `OFX1` compute functions of more than four inputs and leave the
 *     SLICE on the SAME wires `F<k>` the bare lookup tables use — the tile's `.mux F<k>` chooses between
 *     `F<k>_SLICE` (the lookup table) and `F5?_SLICE` / `FX?_SLICE` (the wide multiplexers). Not recovered; see
 *     `unfaithful`.
 *   - DISTRIBUTED RAM (`SLICE?.MODE` = `DPRAM` / `RAMW`) turns the lookup-table storage into a memory written at
 *     run time. Also not recovered; see `unfaithful`.
 */

import type { CellRef, InputSource, RecoveredCell, RecoveredNetlist } from './fpga-icebox-run.ts'
import {
  decodeEcp5Routing,
  decodeEcp5Slices,
  type Ecp5Slice,
  type Ecp5Tile,
  type Ecp5TileDb,
  globaliseEcp5Wire,
} from './fpga-trellis-tiles.ts'

/**
 * `R10C23` → `{ row: 10, col: 23 }`, or null for a tile whose name is not a grid position.
 *
 * The prefix is OPTIONAL and that matters: `CIB_R1C10`, `MIB_R2C3` and `TAP_R5C7` name the same grid position
 * as a bare `R1C10`. Matching only the bare form dropped every arc outside a logic tile — all 3,320 of the
 * connection-block arcs, which is 100% of that routing. Two lookup-table pins fed by one wire then resolved to
 * DIFFERENT nets, so the netlist described states the device cannot produce.
 */
function tilePosition(name: string): { row: number; col: number } | null {
  const match = /^(?:[A-Z0-9_]*_)?R(\d+)C(\d+)$/.exec(name)
  return match === null ? null : { row: Number(match[1]), col: Number(match[2]) }
}

/** What a reconstructed ECP5 design carries beyond the shared netlist. */
export type Ecp5Netlist = RecoveredNetlist & {
  /** cellKey → the tile + SLICE + LUT it came from, so a cell can be traced back to the device. */
  origin: Map<string, { tile: string; slice: string; lut: number }>
  /** net index → the wire name it stands for (an external wire arriving at a tile). */
  netNames: Map<number, string>
  /**
   * Cells whose recovered function is NOT to be trusted, with the reason. At most ONE entry per cell — a cell
   * that is untrustworthy for two reasons carries both in one string, so the list length is the number of
   * untrustworthy cells.
   *
   * Three things put a cell here, all of them configurations the decoder can SEE but cannot yet REPRODUCE:
   *
   *   1. ARITHMETIC (`MODE` = `CCU2`). Such a slice does not compute its lookup table: the hardware output is
   *      that table combined with the carry coming in, and the carry chain runs between cells. None of that is
   *      recovered — the mode is noted and nothing else — so the cell simulates as a plain lookup table and gets
   *      the wrong answer. On a real 4-bit adder that is 256 of 512 input combinations on the first sum bit
   *      alone. The alternative on offer was to model the chain by reusing the iCE40 carry formula, which is a
   *      DIFFERENT function — measured to disagree on 128 of 512 combinations — so it would have replaced a
   *      visible wrong answer with a plausible one.
   *   2. DISTRIBUTED RAM (`MODE` = `DPRAM` or `RAMW`). The lookup-table storage is a memory addressed by the
   *      routed inputs and written at run time through the `RAMW` slice. The INIT word we read IS the memory's
   *      power-up image, so the cell simulates as a frozen read-only memory: right until the first write, wrong
   *      forever after, and the write port does not appear in the netlist at all.
   *   3. A WIDE-FUNCTION MULTIPLEXER on this cell's output wire. The tile's `.mux F<k>` selected `F5?_SLICE`
   *      (`OFX0`) or `FX?_SLICE` (`OFX1`) instead of `F<k>_SLICE`, so the wire leaving on `F<k>` carries the
   *      SLICE's wide multiplexer, not lookup table k. Project Trellis's own timing database gives that
   *      multiplexer's shape — `OFX0` depends on `M0` and on all eight lookup-table inputs, `OFX1` on `FXA`,
   *      `FXB` and `M1` (`database/ECP5/timing/speed_8/cells.json`, cell `SLOGICB`) — i.e. a five-input function
   *      of two lookup tables under `M0`, and a mux of two of THOSE under `M1`. Neither the select polarity nor
   *      a place to put a nine-input node exists in the shared four-input cell model, so it is not modelled; the
   *      wire is additionally UNBOUND from this cell (see `cellByOutput`) so that no consumer is told the wide
   *      function is this lookup table.
   */
  unfaithful: { ref: CellRef; reason: string }[]
}

/**
 * Reconstruct a simulatable netlist from a parsed ECP5 bitstream's frames. `dbFor` supplies each tile type's bit
 * database (return null for types you have not loaded — those tiles are skipped, never guessed at).
 */
export function reconstructEcp5Netlist(
  frames: readonly boolean[][],
  grid: Map<string, Ecp5Tile>,
  dbFor: (tileType: string) => Ecp5TileDb | null,
): Ecp5Netlist {
  const plc2 = dbFor('PLC2') as Ecp5TileDb
  const slices = decodeEcp5Slices(frames, grid, plc2)
  const arcs = decodeEcp5Routing(frames, grid, dbFor)

  // What drives each routed sink, resolved to GLOBAL wires so a connection can cross tile boundaries: the same
  // physical wire is named differently in each tile it touches, and `globaliseEcp5Wire` reconciles those names.
  const wireKey = (w: { x: number; y: number; name: string }): string => `${w.x}/${w.y}/${w.name}`
  const globalDriverOf = new Map<string, string>()
  for (const arc of arcs) {
    const position = tilePosition(arc.tile)
    if (position === null) continue
    const sink = globaliseEcp5Wire(position.row, position.col, arc.sink)
    const source = globaliseEcp5Wire(position.row, position.col, arc.source)
    if (sink === null || source === null) continue
    globalDriverOf.set(wireKey(sink), wireKey(source))
  }
  // Which tile wires something READS (they appear as a mux SOURCE), and which `F<k>` output wires a mux has
  // pointed at the SLICE's wide-function multiplexer instead of at the lookup table.
  const readSomewhere = new Set<string>()
  const wideDriverOf = new Map<string, string>()
  for (const arc of arcs) {
    readSomewhere.add(`${arc.tile}/${arc.source}`)
    const sink = /^F([0-7])$/.exec(arc.sink)
    if (sink !== null) wideDriverOf.set(`${arc.tile}/${sink[1]}`, arc.source)
  }
  /**
   * The wide-function multiplexer driving this SLICE's `F<k>` wire, or null when the lookup table drives it.
   *
   * Gated on the MODE, and that gate is not cosmetic: the bit that selects `F5A_SLICE` on `.mux F0` is the SAME
   * physical bit (`F8B10`) as `SLICEA.CCU2.INJECT1_0`'s `NO`, and likewise for the other three SLICEs. So EVERY
   * arithmetic slice reads back as if its output wire were a wide multiplexer. Measured on a real 4-bit adder:
   * nine phantom `F<k>` arcs, while nextpnr's own pre-pack configuration for that tile says `arc: F2 F2_SLICE`
   * and friends — the lookup table — plus `CCU2.INJECT1_0 NO`. Trusting the arc in arithmetic mode would unbind
   * nine correct connections.
   *
   * The gate is drawn at "plain logic", not merely "not arithmetic", because whether the same bit means the mux
   * or the inject in a DISTRIBUTED-RAM slice is not something any bitstream here shows — no RAM design built for
   * this ever set it. That is a deliberate under-report and it costs nothing visible: a RAM slice is already
   * listed in `unfaithful` on its mode alone.
   */
  const wideMuxOn = (slice: Ecp5Slice, k: number): string | null => {
    if (slice.mode !== null && slice.mode !== 'LOGIC') return null
    return wideDriverOf.get(`${slice.tile}/${k}`) ?? null
  }
  // Every LUT / flip-flop OUTPUT wire, as a global wire → the cell that drives it.
  const cellByOutput = new Map<string, { ref: CellRef; registered: boolean }>()
  for (const slice of slices) {
    const position = tilePosition(slice.tile)
    if (position === null) continue
    const sliceIndex = 'ABCD'.indexOf(slice.slice)
    if (sliceIndex < 0) continue
    for (let lut = 0; lut < 2; lut++) {
      const k = sliceIndex * 2 + lut
      const ref: CellRef = { x: position.col, y: position.row, cell: k }
      for (const [prefix, registered] of [
        ['F', false],
        ['Q', true],
      ] as const) {
        // When the tile's `F<k>` mux points at the wide-function multiplexer, that wire carries a function of
        // two lookup tables and a select — NOT lookup table k. Binding it to this cell anyway is what made a
        // six-input function report as a bare four-input one; leave the wire unbound so a consumer of it traces
        // on to the `F5?_SLICE` / `FX?_SLICE` wire and is reported as an honest primary instead.
        if (prefix === 'F' && wideMuxOn(slice, k) !== null) continue
        const wire = globaliseEcp5Wire(position.row, position.col, `${prefix}${k}`)
        if (wire !== null) cellByOutput.set(wireKey(wire), { ref, registered })
      }
    }
  }
  /** Follow a sink back through the routing until it reaches a cell output, or runs out of drivers. */
  const traceBack = (start: string): string => {
    let current = start
    const seen = new Set<string>([current])
    while (!cellByOutput.has(current)) {
      const next = globalDriverOf.get(current)
      if (next === undefined || seen.has(next)) break
      current = next
      seen.add(current)
    }
    return current
  }
  // Which LUT outputs are read through their FLIP-FLOP (`Q<k>`) rather than the bare LUT (`F<k>`).
  const registered = new Set<string>()
  for (const arc of arcs) {
    const match = /^Q(\d)$/.exec(arc.source)
    if (match !== null) registered.add(`${arc.tile}/${match[1]}`)
  }

  // External wires become numeric nets, interned by name so one wire is one net everywhere it appears.
  const netOf = new Map<string, number>()
  const netNames = new Map<number, string>()
  const internNet = (wire: string): number => {
    const existing = netOf.get(wire)
    if (existing !== undefined) return existing
    const net = netOf.size
    netOf.set(wire, net)
    netNames.set(net, wire)
    return net
  }

  /** What drives a routed tile pin: another cell, an honest primary, or nothing routed at all. */
  const resolvePin = (row: number, col: number, pin: string): InputSource => {
    const start = globaliseEcp5Wire(row, col, pin)
    if (start === null) return { kind: 'unused' }
    const startKey = wireKey(start)
    if (!globalDriverOf.has(startKey) && !cellByOutput.has(startKey)) return { kind: 'unused' }
    // follow the routing back across as many tiles as it takes
    const reached = traceBack(startKey)
    const cell = cellByOutput.get(reached)
    if (cell !== undefined) return { kind: 'cell', driver: cell.ref, net: internNet(reached) }
    // it left the fabric we can see (an IO / EBR / DSP tile, or a wire off the edge): an honest primary
    return { kind: 'primary', net: internNet(reached) }
  }
  /** A lookup table that passes input 0 straight through — the next-state function of an M-fed flip-flop. */
  const BUFFER_LUT = Array.from({ length: 16 }, (_, i) => (i & 1) === 1)

  const cells: RecoveredCell[] = []
  const unfaithful: { ref: CellRef; reason: string }[] = []
  const origin = new Map<string, { tile: string; slice: string; lut: number }>()
  for (const slice of slices) {
    const position = tilePosition(slice.tile)
    if (position === null) continue // not a grid tile — skip rather than invent coordinates
    const sliceIndex = 'ABCD'.indexOf(slice.slice)
    if (sliceIndex < 0) continue
    for (let lut = 0; lut < 2; lut++) {
      const lutTruth = slice.luts[lut] as boolean[]
      if (lutTruth.length !== 16) continue
      const k = sliceIndex * 2 + lut
      const ref: CellRef = { x: position.col, y: position.row, cell: k }
      const reasons: string[] = []
      const lutInputs: InputSource[] = ['A', 'B', 'C', 'D'].map((pin) =>
        resolvePin(position.row, position.col, `${pin}${k}`),
      )
      const isRegistered = registered.has(`${slice.tile}/${k}`)

      // The flip-flop's data mux. `readTileEnum` reports a value equal to the database's declared default as
      // UNSET, and `1` is the declared default for `SD` — so an unset `SD` means `1`, and testing `sd === '1'`
      // would never fire (the same trap the `REGSET` line below documents). Which label is which was pinned
      // against three independent oracles on a real 8-bit shift register and a real lookup-table-fed register,
      // not read off the names: `0` is the routed `M<k>` path, `1` (the default) is `DI<k>` from the lookup
      // table. In the shift register nextpnr allocated ZERO lookup tables, every flip-flop carried `SD 0` with
      // an `M<k>` arc, and its own post-place netlist wired every `TRELLIS_FF` through its `M` port; in the
      // lookup-table-fed design there is no `SD` line at all, no `M` arc, and the `TRELLIS_FF` uses `DI`.
      const sd =
        slice.regs[lut]?.sd ??
        plc2.enums.get(`SLICE${slice.slice}.REG${lut}.SD`)?.defaultValue ??
        null
      const dataFromRouting = isRegistered && sd === '0'
      const routedData = dataFromRouting
        ? resolvePin(position.row, position.col, `M${k}`)
        : { kind: 'unused' as const }
      // A register fed from routing is a BUFFER of that routed source, not the lookup table sitting beside it —
      // which for a shift register is untouched, all-ones, and would latch a constant 1 forever.
      const useRoutedData = dataFromRouting && routedData.kind !== 'unused'
      const truth = useRoutedData ? BUFFER_LUT : lutTruth
      const inputs: InputSource[] = useRoutedData
        ? [routedData, { kind: 'unused' }, { kind: 'unused' }, { kind: 'unused' }]
        : lutInputs
      // Nothing routed to `M<k>` does not have to mean the bitstream is malformed: `SLICE?.M<n>MUX` can tie the
      // input to a constant 1 instead of taking the routing mux, and that setting is not decoded. Either way the
      // register's data is not recovered, so say so and leave the lookup table alone rather than latch a zero.
      if (dataFromRouting && !useRoutedData)
        reasons.push(
          `the flip-flop takes its data from the routed input M${k} (REG${lut}.SD = 0), but nothing is routed to M${k}, so its data source is not recovered`,
        )
      // One cell cannot be both a combinational lookup table on `F<k>` and a separately-fed register on `Q<k>`:
      // the shared model gives a cell one function and one output. Say so rather than let the reader assume the
      // lookup table survived.
      if (useRoutedData && readSomewhere.has(`${slice.tile}/F${k}`))
        reasons.push(
          `this cell's flip-flop is fed from the routed input M${k} while its lookup table's own output F${k} is read separately; the shared cell model carries ONE function per cell, so only the flip-flop's data path is represented here`,
        )

      // An all-ones lookup table is the database DEFAULT, so a slice can survive the tile-level filter on the
      // strength of its OTHER settings and still carry a companion table nobody programmed. Emitting it puts a
      // constant-1 cell in the netlist that exists nowhere in the design.
      //
      // EVERY conjunct below is load-bearing, and the suite will not tell you otherwise — it reports 46/46 with
      // a real cell deleted. Skipping on the table alone removes an all-ones LUT4 in an arithmetic slice, which
      // is exactly the configuration that passes the carry through. So a table is only untouched if it is also
      // unread, unregistered, and in a slice doing nothing arithmetic.
      const allOnes = truth.every((b) => b)
      const unread = inputs.every((i) => i.kind === 'unused')
      const plainMode = slice.mode === null || slice.mode === 'LOGIC'
      if (allOnes && unread && !isRegistered && plainMode) continue

      cells.push({
        ref,
        config: {
          truth,
          // The ECP5 database has no single "this LUT is registered" bit: a design shows it by reading the
          // flip-flop's Q output instead of the LUT's F output, which is what we detect above.
          // NOTE this flag is all we recover of arithmetic mode — see `unfaithful` below, which is where such a
          // cell is declared untrustworthy rather than quietly simulated as a plain lookup table.
          // Arithmetic ONLY. Widening this to "any non-LOGIC mode" alongside the `unfaithful` widening below
          // would tell the simulator to run a distributed RAM through the carry chain.
          carryEnable: slice.mode === 'CCU2',
          dffEnable: isRegistered,
          // `readTileEnum` reports a value EQUAL to the database's declared default as unset, and `SET` IS the
          // declared default for `REGSET`. So `=== 'SET'` could never be true and a preset flip-flop always
          // decoded as a reset one. Resolve an unset value to the database's own default instead of assuming
          // "not SET". (Inverting this line to `=== 'RESET'` left the whole suite green — nothing tested it.)
          setNoReset:
            (slice.regs[lut]?.regset ??
              plc2.enums.get(`SLICE${slice.slice}.REG${lut}.REGSET`)?.defaultValue ??
              null) === 'SET',
          asyncSetReset: false, // ECP5 set/reset timing comes from LSRMODE + the tile's clocking, not modelled yet
        },
        inputs,
      })
      if (slice.mode === 'CCU2')
        reasons.push(
          'arithmetic (CCU2) slice: the hardware output is the lookup table combined with the incoming carry, and neither the carry chain nor that combination is recovered',
        )
      if (slice.mode === 'DPRAM' || slice.mode === 'RAMW')
        reasons.push(
          `distributed-RAM slice (MODE ${slice.mode}): the lookup-table storage is a memory written at run time through the RAMW slice, not a function of the routed inputs. The table read here is the memory's power-up image; neither the write port nor the write clock is recovered, so any design that writes to this memory simulates wrong from the first write onward`,
        )
      const wideSource = wideMuxOn(slice, k)
      if (wideSource !== null)
        reasons.push(
          `tile wire F${k} is driven by the SLICE's wide-function multiplexer (the F${k} multiplexer selects ${wideSource}, not F${k}_SLICE), so what leaves the tile on F${k} is a function of TWO lookup tables under a select, not this lookup table's output; that multiplexer is not recovered and the wire has been left unbound rather than attributed to this cell`,
        )
      if (reasons.length > 0) unfaithful.push({ ref, reason: reasons.join('; also: ') })
      origin.set(`${position.col}_${position.row}_${k}`, {
        tile: slice.tile,
        slice: slice.slice,
        lut,
      })
    }
  }
  return { cells, origin, netNames, unfaithful }
}
