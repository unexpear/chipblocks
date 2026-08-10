/**
 * FPGA fabric — Gowin: a flip-flop belongs to a CELL, not to a PAIR.
 *
 * Cells 2k and 2k+1 of a Gowin slice share one clock, one clock-enable and one set/reset line — Apicula's
 * packer writes `REGMODE`/`CLKMUX`/`LSRONMUX`/`SRMODE` per PAIR (`gowin_pack.place_dff`:
 * `slice_attrvals.setdefault((row, col, int(num) // 2), {})`). The decoder used to read "a clock reaches this
 * cell's pair" as "this cell holds a register". A place-and-route tool fills the other half of a clocked pair
 * with unrelated combinational logic whenever a tile holds an odd number of registers, and that half then came
 * back with a flip-flop the silicon does not have.
 *
 * THE ORACLE. These fixtures are not hand-made. Each was synthesised and placed by the vendor toolchain and
 * comes with the PLACER'S OWN record of where it put every cell, so the assertions below compare a decoded
 * verdict against an independent answer rather than against a shape:
 *
 *   yosys 0.67+122            synth_gowin -nowidelut
 *   nextpnr-himbaechel 0.10-108-g68c1acd8   --device GW1N-LV1QN48C6/I5 --vopt family=GW1N-1 --seed 1
 *   gowin_pack (apycula)      -d GW1N-1
 *
 * The `*-placement.json` beside each bitstream is `NEXTPNR_BEL` read off every placed cell of nextpnr's own
 * `--write` output: `X<x>Y<y>/LUT<n>` for a lookup table and `X<x>Y<y>/DFF<n>` for a flip-flop. A cell that
 * appears in `dffBels` really does hold a register; one that appears only in `lutBels` really does not.
 *
 * MEASURED BEFORE THE FIX, on these bitstreams plus seven more built the same way: 154 of 2242 placed
 * lookup tables were emitted with `dffEnable: true` and a flip-flop variant, and `simulateCombinational`
 * declined to give any of them a value. No cell was ever wrong the other way — the error only ever ADDED
 * registers.
 *
 * AND MEASURED AFTER THE FIRST ATTEMPT AT IT, which is why `splitpad` is here. Deciding the register per cell
 * left two cases the first attempt REFUSED rather than answered, and refusing deletes the cell. `splitpad` is
 * the plainest possible form of "register a signal and also read it directly": six cells, both wires going to
 * package pins. All six were refused and the recovered netlist came back EMPTY. A refusal that erases real
 * hardware is worse than the wrong answer it avoids, so a cell is now refused only where the choice actually
 * costs the recovered design something — both of its wires read by logic this path recovered.
 *
 * AND MEASURED AGAIN AFTER THAT, which is why `splitmix`, `splitkeep` and the `-outputs.json` files are here.
 * Deciding "does the recovered design read this cell's stored result" from FUSED arcs alone answered the
 * question for a minority of registers: `Q<n>` leaves most cells on an arc no fuse selects, and those were
 * invisible to the walk, so the refusal could not fire for them. MEASURED across the six designs below, using
 * each one's placement record: of 174 placed flip-flops only 51 put `Q<n>` on an arc the fuse decode can see —
 * the other 123 travel a default one. `splitmix` is a design built for exactly that shape, and two independent
 * readings of it say so.
 *
 * THE SECOND ORACLE. `gowin-gw1n1-<name>-outputs.json` beside each bitstream answers, per lookup table,
 * whether OTHER lookup tables read its plain result and its stored result. It is distilled from
 * `gowin_unpack -d GW1N-1` — Project Apicula's own reader, a separate implementation — which writes the
 * bitstream back out as Verilog in which every routing arc that is in force, fused or default, appears as one
 * `assign`. That is why it can see what a fuse-only decode cannot. A lookup table's pin counts only where its
 * INIT really depends on it, and a cell reading its own output is not another reader.
 *
 * AND MEASURED ONCE MORE, which is why the refusal is now a SPLIT and why this file also simulates. A cell
 * whose two outputs are both read really is a lookup table AND a flip-flop beside it fed by that same lookup
 * table, and `RecoveredCell` having one output was a limit of the description, not of the silicon. Refusing
 * such a cell erased it from the canvas and handed every part that read it an invented chip input: on
 * `splitmix`, 2 of 12 lookup tables vanished and 2 more became untrustworthy. They are now emitted as the two
 * recovered cells they behave as — see `gowinOutputPlan` — and `splitmix` recovers with nothing refused,
 * nothing distrusted and nothing left out.
 *
 * THE THIRD ORACLE, which is what makes that a claim about VALUES rather than about counts.
 * `gowin-gw1n1-splitmix-vectors.json` is what the SOURCE computes, produced by Icarus Verilog simulating
 * `gowin-gw1n1-splitmix.v` with the testbench beside it — a different tool reading a different file. The
 * recovered netlist is clocked through `simulateClocked` on the same stimulus and must produce the same two
 * output sequences. `splitmix` reads one split cell's plain result and the other's stored result in separate
 * output cones, so both halves of the split have to be right for it to pass.
 *
 * The `.v` beside each bitstream is the source it was built from, and the `.cst` beside it is the pin
 * assignment its build needed, so the fixtures can be regenerated.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { parseGowinAttributeDatabase } from '../src/renderer/fpga-apicula-attributes.ts'
import {
  type GowinChipdb,
  gowinTileAt,
  gowinTileWindow,
  parseGowinChipdb,
} from '../src/renderer/fpga-apicula-chipdb.ts'
import { parseGowinBitstream } from '../src/renderer/fpga-apicula-fs.ts'
import {
  GOWIN_STORED_HALF_OFFSET,
  type GowinDesign,
  gowinCellOutputUse,
  gowinDefaultRegisterArcs,
  gowinFixedAliases,
  gowinGlobalWire,
  gowinOutputPlan,
  gowinStoredHalfRef,
  parseGowinWireAliases,
  reconstructGowinNetlist,
} from '../src/renderer/fpga-apicula-netlist.ts'
import {
  type GowinTileRouting,
  parseGowinPipDatabase,
} from '../src/renderer/fpga-apicula-routing.ts'
import { simulateClocked, simulateCombinational } from '../src/renderer/fpga-icebox-run.ts'

const at = (name: string): URL => new URL(`../fixtures/${name}`, import.meta.url)
const db: GowinChipdb = parseGowinChipdb(readFileSync(at('gowin-gw1n1-chipdb.json'), 'utf8'))
const pipdb = parseGowinPipDatabase(readFileSync(at('gowin-gw1n1-pips.json'), 'utf8'))
const attributes = parseGowinAttributeDatabase(
  readFileSync(at('gowin-gw1n1-attributes.json'), 'utf8'),
)
const aliases = new Map([
  ...parseGowinWireAliases(readFileSync(at('gowin-gw1n1-nodes.json'), 'utf8')),
  ...gowinFixedAliases(db.rows, db.cols),
])

type Placement = { note: string; lutBels: string[]; dffBels: string[] }

/** One lookup table as Apicula's own reader sees it: who reads its plain result, who reads its stored one. */
type OutputUse = {
  x: number
  y: number
  cell: number
  combinationalInside: boolean
  registeredInside: boolean
}

/** Every fixture that carries a placement record, with the counts the record must still have. */
const ORACLE = [
  { name: 'pairmix', lut: 161, dff: 36 },
  { name: 'splitout', lut: 69, dff: 32 },
  { name: 'splitpad', lut: 6, dff: 6 },
  { name: 'dense', lut: 729, dff: 90 },
  { name: 'splitmix', lut: 12, dff: 8 },
  { name: 'splitkeep', lut: 3, dff: 2 },
] as const

const decoded = ORACLE.map((entry) => {
  const frames = parseGowinBitstream(
    readFileSync(at(`gowin-gw1n1-${entry.name}.fs`), 'utf8'),
  ).frames
  const placement = JSON.parse(
    readFileSync(at(`gowin-gw1n1-${entry.name}-placement.json`), 'utf8'),
  ) as Placement
  return {
    ...entry,
    design: reconstructGowinNetlist(frames, db, pipdb, attributes, aliases),
    lutBels: new Set(placement.lutBels),
    dffBels: new Set(placement.dffBels),
    outputUse: JSON.parse(
      readFileSync(at(`gowin-gw1n1-${entry.name}-outputs.json`), 'utf8'),
    ) as OutputUse[],
  }
})

const keyOf = (cell: { col: number; row: number; ref: { cell: number } }): string =>
  `${cell.col},${cell.row},${cell.ref.cell}`

describe('the placement oracle itself', () => {
  test('each record still holds the number of bels it was distilled from', () => {
    // A truncated or regenerated fixture would silently weaken every assertion below, so the counts are pinned.
    for (const entry of decoded) {
      expect(entry.lutBels.size, entry.name).toBe(entry.lut)
      expect(entry.dffBels.size, entry.name).toBe(entry.dff)
      // a flip-flop always shares its slot with the lookup table that feeds it
      for (const bel of entry.dffBels)
        expect(entry.lutBels.has(bel), `${entry.name} ${bel}`).toBe(true)
    }
  })

  test('the decoder and the placer agree about WHERE the lookup tables are', () => {
    // Without this the comparisons below could pass by talking about different cells. Every non-blank lookup
    // table the decoder finds must be one the placer put there — that is what makes the coordinates comparable.
    for (const entry of decoded) {
      const found = entry.design.cells.map(keyOf)
      expect(found.length, entry.name).toBeGreaterThan(0)
      for (const key of found) expect(entry.lutBels.has(key), `${entry.name} ${key}`).toBe(true)
    }
  })
})

describe('no cell is given a flip-flop the placer did not put there', () => {
  test('every cell reported as registered really holds a flip-flop', () => {
    // THE DEFECT. Measured before the fix: 6 cells in pairmix, 63 in dense and 1 in splitout came back
    // registered with no DFF bel underneath them.
    const phantoms: string[] = []
    for (const entry of decoded)
      for (const cell of entry.design.cells)
        if (cell.registered && !entry.dffBels.has(keyOf(cell)))
          phantoms.push(`${entry.name} ${keyOf(cell)} flipFlop=${cell.flipFlop}`)
    expect(phantoms).toEqual([])
  })

  test('and no real flip-flop is quietly dropped to make that true', () => {
    // The other half. A decoder that called everything combinational would pass the test above. A cell the
    // placer gave a DFF bel must come back registered, or be SHOWN AS TWO with the flip-flop as the second, or
    // be REFUSED, or be SAID to be missing its flip-flop — all four are honest. What is banned is the fifth
    // outcome: coming back as a plain lookup table with nothing anywhere saying the register was left out.
    const lost: string[] = []
    for (const entry of decoded) {
      const stated = new Set(entry.design.partial.map((p) => `${p.ref.x},${p.ref.y},${p.ref.cell}`))
      for (const cell of entry.design.cells) {
        if (!entry.dffBels.has(keyOf(cell))) continue
        if (cell.registered || cell.stored !== null) continue
        if (cell.refusal !== null || stated.has(keyOf(cell))) continue
        lost.push(`${entry.name} ${keyOf(cell)}`)
      }
    }
    expect(lost).toEqual([])
  })

  test('the emitted netlist carries the same verdict as the decoded cell', () => {
    // `dffEnable` is what the simulators read. It used to be set from the same pair-level clock.
    //
    // A cell shown as two contributes two netlist cells: the one at the lookup table's own place is the
    // straight-through half and is NOT a register, and the stored half sits at its own place and is. Both are
    // checked against the placer, the stored half through the cell it belongs to.
    for (const entry of decoded) {
      const byKey = new Map(
        entry.design.cells.map((c) => [`${c.ref.x}_${c.ref.y}_${c.ref.cell}`, c]),
      )
      const siliconOf = new Map(
        entry.design.split.map((s) => [
          `${s.storedRef.x}_${s.storedRef.y}_${s.storedRef.cell}`,
          `${s.ref.x},${s.ref.y},${s.ref.cell}`,
        ]),
      )
      for (const cell of entry.design.netlist.cells) {
        const key = `${cell.ref.x}_${cell.ref.y}_${cell.ref.cell}`
        const silicon = siliconOf.get(key)
        if (silicon !== undefined) {
          expect(cell.config.dffEnable, `${entry.name} ${key}`).toBe(true)
          expect(entry.dffBels.has(silicon), `${entry.name} ${key}`).toBe(true)
          continue
        }
        expect(cell.config.dffEnable, `${entry.name} ${key}`).toBe(byKey.get(key)?.registered)
        if (cell.config.dffEnable)
          expect(entry.dffBels.has(`${cell.ref.x},${cell.ref.y},${cell.ref.cell}`), key).toBe(true)
      }
    }
  })

  test('the reported symptom is gone: the combinational simulator values every cell that is not a register', () => {
    // `simulateCombinational` lists a registered cell under `registered` and gives it no value. With phantom
    // registers it declined to value ordinary combinational logic — 63 cells of the dense design alone.
    for (const entry of decoded) {
      const result = simulateCombinational(entry.design.netlist, new Map())
      const siliconOf = new Map(
        entry.design.split.map((s) => [
          `${s.storedRef.x},${s.storedRef.y},${s.storedRef.cell}`,
          `${s.ref.x},${s.ref.y},${s.ref.cell}`,
        ]),
      )
      for (const ref of result.registered) {
        const key = `${ref.x},${ref.y},${ref.cell}`
        expect(entry.dffBels.has(siliconOf.get(key) ?? key), `${entry.name} ${key}`).toBe(true)
      }
    }
  })

  test('the fix is not a blanket refusal — nearly every placed cell still reaches the netlist', () => {
    // Refusing everything would satisfy every assertion above. Pinned as measured counts so a regression that
    // starts refusing wholesale is a failure, not a quiet loss.
    //
    // MEASURED BEFORE THE SPLIT, in the same order: emitted [161, 55, 6, 729, 10, 3], refused
    // [0, 14, 0, 0, 2, 0], distrusted [0, 35, 0, 0, 2, 0]. Fourteen of splitout's 69 placed lookup tables and
    // two of splitmix's twelve were erased from the canvas, and 35 and 2 more parts were handed invented chip
    // inputs in their place. Nothing is now refused on any of the six, and the extra emitted cells are the
    // stored halves — one per split, and no more.
    const emitted = decoded.map((e) => e.design.netlist.cells.length)
    expect(emitted).toEqual([161, 83, 6, 729, 14, 3])
    const refused = decoded.map((e) => e.design.unsupported.length)
    expect(refused).toEqual([0, 0, 0, 0, 0, 0])
    const stated = decoded.map((e) => e.design.partial.length)
    expect(stated).toEqual([0, 0, 0, 0, 0, 2])
    const distrusted = decoded.map((e) => e.design.distrusted.length)
    expect(distrusted).toEqual([0, 0, 0, 0, 0, 0])
    const split = decoded.map((e) => e.design.split.length)
    expect(split).toEqual([0, 14, 0, 0, 2, 0])
    // and a design's cell list still holds exactly one entry per lookup table the placer placed, so the split
    // lives in the netlist and does not double-count the silicon
    expect(decoded.map((e) => e.design.cells.length)).toEqual([161, 69, 6, 729, 12, 3])
    for (const entry of decoded)
      expect(entry.design.netlist.cells.length, entry.name).toBe(
        entry.design.cells.length - entry.design.unsupported.length + entry.design.split.length,
      )
  })
})

describe('what is shown as two, what is refused, and why', () => {
  test('a cell BOTH of whose outputs the recovered design reads is shown as two, not refused', () => {
    // splitout registers every net it also reads combinationally, so one cell drives `F<n>` and `Q<n>` at once.
    // `RecoveredCell` has ONE output, so emitting it registered hands the combinational reader a value a cycle
    // late and emitting it combinationally hands the register's reader the wrong value. Refusing avoided both
    // wrong answers by deleting the cell; the cell is instead the two things it behaves as.
    const split = decoded.find((e) => e.name === 'splitout') as (typeof decoded)[number]
    expect(split.design.unsupported).toEqual([])
    expect(split.design.split).toHaveLength(14)
    const emitted = new Set(
      split.design.netlist.cells.map((c) => `${c.ref.x},${c.ref.y},${c.ref.cell}`),
    )
    for (const { ref, storedRef } of split.design.split) {
      // every one really is a placed flip-flop, so this is a split of something real
      expect(split.dffBels.has(`${ref.x},${ref.y},${ref.cell}`)).toBe(true)
      // both halves are on the canvas, in the same tile, at two places that are not the same place
      expect(emitted.has(`${ref.x},${ref.y},${ref.cell}`)).toBe(true)
      expect(emitted.has(`${storedRef.x},${storedRef.y},${storedRef.cell}`)).toBe(true)
      expect(storedRef).toEqual(gowinStoredHalfRef(ref))
      expect(storedRef.cell).not.toBe(ref.cell)
    }
    // the straight-through half is combinational and the stored half is a register — never both, never neither
    const byRef = new Map(
      split.design.netlist.cells.map((c) => [`${c.ref.x},${c.ref.y},${c.ref.cell}`, c]),
    )
    for (const { ref, storedRef } of split.design.split) {
      expect(byRef.get(`${ref.x},${ref.y},${ref.cell}`)?.config.dffEnable).toBe(false)
      expect(byRef.get(`${storedRef.x},${storedRef.y},${storedRef.cell}`)?.config.dffEnable).toBe(
        true,
      )
    }
  })

  test('both halves compute the same lookup table from the same four inputs', () => {
    // The silicon's flip-flop takes its D straight from the lookup table beside it — Apicula's own unpacker
    // writes `DFFE .D(R4C2_F0)` for the very cell this fixture splits. So the stored half is not an
    // approximation of anything: same truth table, same four sources, one clocked and one not.
    for (const entry of decoded) {
      const byRef = new Map(
        entry.design.netlist.cells.map((c) => [`${c.ref.x},${c.ref.y},${c.ref.cell}`, c]),
      )
      for (const { ref, storedRef } of entry.design.split) {
        const plain = byRef.get(`${ref.x},${ref.y},${ref.cell}`)
        const stored = byRef.get(`${storedRef.x},${storedRef.y},${storedRef.cell}`)
        expect(stored?.config.truth).toEqual(plain?.config.truth)
        expect(stored?.inputs).toEqual(plain?.inputs)
        // and they are separate arrays, so a consumer editing one cannot silently edit the other
        expect(stored?.inputs).not.toBe(plain?.inputs)
      }
    }
  })

  test('the clock, the set/reset and the clock-enable belong to the stored half alone', () => {
    // The straight-through half has no clock to read them with. Giving it a set/reset would let the shared
    // simulator hold a combinational cell at a fixed level.
    for (const entry of decoded) {
      const byRef = new Map(
        entry.design.netlist.cells.map((c) => [`${c.ref.x},${c.ref.y},${c.ref.cell}`, c]),
      )
      for (const { ref } of entry.design.split) {
        const plain = byRef.get(`${ref.x},${ref.y},${ref.cell}`)
        expect(plain?.negClk).toBe(false)
        expect(plain?.setReset ?? null).toBeNull()
        expect(plain?.clockEnable ?? null).toBeNull()
      }
    }
  })

  test('the stored half is never mistaken for a lookup table the chip has', () => {
    // The one thing that could go wrong quietly: a stored half landing on a place another cell of the same
    // tile occupies would replace a real part in every map keyed by where a cell sits.
    for (const entry of decoded) {
      const placed = new Set(entry.design.cells.map((c) => `${c.ref.x},${c.ref.y},${c.ref.cell}`))
      for (const { storedRef } of entry.design.split)
        expect(
          placed.has(`${storedRef.x},${storedRef.y},${storedRef.cell}`),
          `${entry.name} ${storedRef.x},${storedRef.y},${storedRef.cell}`,
        ).toBe(false)
      // and no two recovered cells share a place at all
      const keys = entry.design.netlist.cells.map((c) => `${c.ref.x},${c.ref.y},${c.ref.cell}`)
      expect(new Set(keys).size, entry.name).toBe(keys.length)
    }
  })

  test('the place a stored half goes is one this chip’s lookup tables cannot occupy', () => {
    // `GOWIN_STORED_HALF_OFFSET` is 8 because a Gowin slice column holds `LUT0`..`LUT7`. That is read out of
    // the device database rather than believed: every lookup table of every tile type this part has is
    // checked, so a device with a ninth would fail here instead of silently colliding.
    let highest = -1
    for (const perCell of db.lutFlagBits.values())
      for (const bel of perCell.keys()) {
        const match = /^LUT(\d+)$/.exec(bel)
        expect(match, bel).not.toBeNull()
        highest = Math.max(highest, Number.parseInt((match as RegExpExecArray)[1] as string, 10))
      }
    expect(highest).toBe(7)
    expect(GOWIN_STORED_HALF_OFFSET).toBeGreaterThan(highest)
  })

  test('a cell only ONE of whose outputs the design reads is not refused at all', () => {
    // THE OVER-REFUSAL. `splitpad` is the same trap with both readers off-chip: six cells, each registered and
    // also read straight through, with both wires going to package pins. Refusing them emptied the netlist
    // completely — six placed cells, nothing recovered, a blank canvas. A package pin is not part of the
    // netlist, so there is no conflict to refuse.
    const pad = decoded.find((e) => e.name === 'splitpad') as (typeof decoded)[number]
    expect(pad.design.unsupported).toEqual([])
    expect(pad.design.netlist.cells).toHaveLength(6)
    expect(pad.design.cells.filter((c) => c.registered)).toHaveLength(6)
    for (const cell of pad.design.cells) expect(pad.dffBels.has(keyOf(cell))).toBe(true)
  })

  test('and a flip-flop left out because the design reads past it is SAID to be left out', () => {
    // The third outcome, between emitting and refusing. `splitkeep` is built for it: two cells whose plain
    // result is read by another lookup table on the chip and whose stored result leaves through a package pin.
    // A pin is not part of the netlist, so there is nothing to weigh — the plain result is what the single
    // recovered output has to carry — but the flip-flop is real, so it is left out LOUDLY rather than lost.
    //
    // This used to be measured on `splitout`, whose four such cells turned out to be the DEFECT: their stored
    // result really was read by logic in the netlist, on an arc no fuse selects, so all four are now shown as
    // two. A design where the flip-flop is genuinely unread had to be built to keep this outcome covered at
    // all — and it must NOT be split, because there is no second reader to serve.
    const keep = decoded.find((e) => e.name === 'splitkeep') as (typeof decoded)[number]
    expect(keep.design.partial.map((p) => `${p.ref.x},${p.ref.y},${p.ref.cell}`).sort()).toEqual([
      '1,6,0',
      '1,6,1',
    ])
    expect(keep.design.unsupported).toEqual([])
    expect(keep.design.split).toEqual([])
    for (const stated of keep.design.partial) {
      expect(stated.kind).toBe('register-not-shown')
      // every one is a real placed flip-flop, and the cell itself is still in the netlist
      expect(keep.dffBels.has(`${stated.ref.x},${stated.ref.y},${stated.ref.cell}`)).toBe(true)
      expect(
        keep.design.netlist.cells.some(
          (c) =>
            c.ref.x === stated.ref.x && c.ref.y === stated.ref.y && c.ref.cell === stated.ref.cell,
        ),
      ).toBe(true)
    }
  })

  test('a refused cell is never ALSO reported as registered', () => {
    // `unsupported` and `registered` are read by different callers. A cell that is refused because we cannot
    // say whether it holds a register must not simultaneously claim it does — that would let one reader act on
    // a verdict the other was told does not exist.
    for (const entry of decoded)
      for (const cell of entry.design.cells)
        if (cell.refusal !== null) {
          expect(cell.registered, `${entry.name} ${keyOf(cell)}`).toBe(false)
          expect(cell.flipFlop, `${entry.name} ${keyOf(cell)}`).toBeNull()
          expect(cell.stored, `${entry.name} ${keyOf(cell)}`).toBeNull()
        }
  })

  test('a refused cell never stays indexed as a driver', () => {
    // The trap a previous refusal fell into: consumers kept pointing at a cell that never reached the netlist,
    // and the simulator resolves a missing driver to false — the recovered adder became a constant-zero design.
    for (const entry of decoded) {
      const present = new Set(
        entry.design.netlist.cells.map((c) => `${c.ref.x}_${c.ref.y}_${c.ref.cell}`),
      )
      const refused = new Set(
        entry.design.unsupported.map((u) => `${u.ref.x}_${u.ref.y}_${u.ref.cell}`),
      )
      for (const key of refused) expect(present.has(key), `${entry.name} ${key}`).toBe(false)
      for (const cell of entry.design.netlist.cells)
        for (const input of cell.inputs)
          if (input.kind === 'cell')
            expect(
              refused.has(`${input.driver.x}_${input.driver.y}_${input.driver.cell}`),
              entry.name,
            ).toBe(false)
    }
  })

  test('a cell with a clocked pair and no register evidence is combinational, not deleted', () => {
    // pairmix has exactly one cell whose lookup-table output is routed by a multiplexer this path's exact-match
    // fuse rule cannot recover, so neither of its wires can be seen to drive anything. It was briefly refused
    // for that, which deleted it. "No evidence its register is used" is not a gap in the reading — it is the
    // per-cell evidence saying no — and the placer agrees: this cell has no flip-flop under it.
    const mix = decoded.find((e) => e.name === 'pairmix') as (typeof decoded)[number]
    expect(mix.design.unsupported).toEqual([])
    const combinational = mix.design.cells.filter(
      (c) => !c.registered && !mix.dffBels.has(keyOf(c)),
    )
    expect(combinational).toHaveLength(125)
    expect(mix.design.netlist.cells).toHaveLength(mix.design.cells.length)
  })

  test('the shipped designs that CAN be decided are not refused at all', () => {
    // The negative half of the refusal: a rule that refused whenever it was unsure would show up here.
    for (const file of [
      'gowin-gw1n1-xnor-dff.fs',
      'gowin-gw1n1-ffvariants.fs',
      'gowin-gw1n1-mixedreg.fs',
    ]) {
      const design = reconstructGowinNetlist(
        parseGowinBitstream(readFileSync(at(file), 'utf8')).frames,
        db,
        pipdb,
        attributes,
        aliases,
      )
      const kinds = design.unsupported.map((u) => u.kind)
      expect(
        kinds.filter((k) => k === 'split-output'),
        file,
      ).toEqual([])
      expect(design.cells.filter((c) => c.registered).length, file).toBeGreaterThan(0)
    }
  })
})

/**
 * WHICH CELLS ARE SHOWN AS TWO, CHECKED AGAINST A READER THAT IS NOT THIS ONE.
 *
 * Everything above compares the decoder with the PLACER's record, which says where the cells are and which of
 * them hold a flip-flop. It says nothing about who reads what, so the condition that decides a split — both of
 * a cell's outputs read by other logic — was never compared with anything: the counts were pinned as whatever
 * the decoder happened to produce.
 *
 * `gowin-gw1n1-<name>-outputs.json` is that missing comparison, taken from Project Apicula's own unpacker.
 */
describe('the split set matches Apicula’s own reading of the same file', () => {
  const key = (r: { x: number; y: number; cell: number }): string => `${r.x},${r.y},${r.cell}`

  test('every cell whose two outputs another lookup table reads is shown as two, and no other', () => {
    // THE DEFECT, in one assertion, and the same assertion still holds now that the outcome is a split rather
    // than a refusal. Before the fuse-and-default evidence was joined: splitout found 10 of these where this
    // says 14, and splitmix — built for the shape, with both readers on the chip — found NONE of the 2.
    for (const entry of decoded) {
      const want = entry.outputUse
        .filter((use) => use.combinationalInside && use.registeredInside)
        .map(key)
        .sort()
      const got = entry.design.split.map((shown) => key(shown.ref)).sort()
      expect(got, entry.name).toEqual(want)
      // and nothing is refused for that reason any more, on any of the six
      expect(
        entry.design.unsupported.filter((refused) => refused.kind === 'split-output'),
        entry.name,
      ).toEqual([])
    }
  })

  test('the two readings agree about which cells exist at all', () => {
    // Without this the comparison above could pass by talking past itself — two empty lists agree about
    // nothing. Apicula's reading and this one must find the same lookup tables in the same places.
    for (const entry of decoded) {
      expect(entry.outputUse.map(key).sort(), entry.name).toEqual(
        entry.design.cells.map((cell) => `${cell.col},${cell.row},${cell.ref.cell}`).sort(),
      )
    }
  })

  test('splitmix really is the case a fuse-only reading cannot see', () => {
    // The fixture earns its place only if its registers travel arcs no fuse selects. If they travelled fused
    // ones the old evidence would have found them too and this design would prove nothing. `drivers` holds the
    // FUSED connections and nothing else, so no entry of it may name either split cell's stored output.
    const mix = decoded.find((e) => e.name === 'splitmix') as (typeof decoded)[number]
    expect(mix.design.split).toHaveLength(2)
    const fused = new Set(mix.design.drivers.values())
    for (const shown of mix.design.split) {
      const stored = gowinGlobalWire(
        shown.ref.y + 1,
        shown.ref.x + 1,
        `Q${shown.ref.cell}`,
        db.rows,
        db.cols,
      )
      expect(fused.has(stored), `${key(shown.ref)} ${stored}`).toBe(false)
    }
  })
})

/**
 * WHAT READ THE CELL THAT VANISHED.
 *
 * Refusing a cell keeps one wrong answer off the canvas and creates others: the wire the refused cell drove now
 * has nothing driving it, so every trace that walks into it runs out of routing and mints a chip input. The
 * parts that read the refused cell therefore come back looking like ordinary parts with one more switch on
 * them. Measured on `splitmix` before this existed: the one cell that was RIGHT carried a warning, and the two
 * that were WRONG carried none — `unsupported` named the refused cell, `unfaithful` was empty, and the two
 * readers had `{kind:'primary'}` where the register's output belongs.
 *
 * `splitmix` no longer refuses anything, so it no longer distrusts anything either — that is the whole point of
 * the split, and the negative half of it is asserted below. The warning itself is still needed, because
 * ARITHMETIC cells are still refused and their readers are still handed invented inputs, so it is measured
 * here on `adder4`: four of its ten placed lookup tables read one of the six carry cells this path refuses.
 */
describe('a part handed an invented input is named', () => {
  const adder = reconstructGowinNetlist(
    parseGowinBitstream(readFileSync(at('gowin-gw1n1-adder4.fs'), 'utf8')).frames,
    db,
    pipdb,
    attributes,
    aliases,
  )
  const key = (r: { x: number; y: number; cell: number }): string => `${r.x},${r.y},${r.cell}`

  test('the readers of the refused cells are reported, not just the refused cells', () => {
    expect(adder.unsupported).toHaveLength(6)
    expect(new Set(adder.unsupported.map((u) => u.kind))).toEqual(new Set(['carry']))
    expect(adder.distrusted.map((d) => key(d.ref)).sort()).toEqual([
      '7,4,1',
      '8,4,0',
      '8,4,4',
      '8,4,5',
    ])
    for (const listed of adder.distrusted) expect(listed.kind).toBe('invented-input')
  })

  test('each one is a part that IS on the canvas, and really does hold an invented input', () => {
    // The warning is only worth anything if it lands on a part the user can see. A refused cell is gone; these
    // are not — they are emitted, they simulate, and what they compute is wrong.
    for (const listed of adder.distrusted) {
      const cell = adder.netlist.cells.find((c) => key(c.ref) === key(listed.ref))
      expect(cell, key(listed.ref)).toBeDefined()
      expect(cell?.inputs.some((input) => input.kind === 'primary')).toBe(true)
    }
    // and the refused cells themselves are NOT in this list: they are not on the canvas to be distrusted
    const refused = new Set(adder.unsupported.map((u) => key(u.ref)))
    for (const listed of adder.distrusted) expect(refused.has(key(listed.ref))).toBe(false)
  })

  test('the reason says what the switch really is, in words, with no jargon', () => {
    const reason = adder.distrusted[0]?.reason ?? ''
    expect(reason).toMatch(/switch you can set to 0 V or 5 V/)
    expect(reason).toMatch(/the real chip has no such switch/)
    expect(reason).toMatch(/column \d+, row \d+, position \d+/)
  })

  test('a design that dropped nothing distrusts nothing', () => {
    // The negative half. A rule that flagged every primary input would flag most of these designs, and a
    // warning that is always on says nothing at all.
    //
    // `splitmix` and `splitout` are here because of the split: they used to account for 2 and 35 of these
    // warnings between them, every one of which was a part reading a cell that should never have vanished.
    for (const name of ['splitpad', 'pairmix', 'dense', 'splitkeep', 'splitmix', 'splitout']) {
      const entry = decoded.find((e) => e.name === name) as (typeof decoded)[number]
      expect(entry.design.distrusted, name).toEqual([])
    }
  })

  test('the netlist carries the list, so lowering onto the canvas cannot lose it', () => {
    // `unsupported` and `partial` were once on the design object alone and were dropped at the lowering hop.
    for (const entry of decoded)
      expect(entry.design.netlist.unfaithful, entry.name).toBe(entry.design.distrusted)
    expect(adder.netlist.unfaithful).toBe(adder.distrusted)
  })
})

/**
 * What `splitpad` recovers, checked against the SOURCE rather than against the placer.
 *
 * The placement record says where the six cells are and that all six hold a flip-flop. It says nothing about
 * what they COMPUTE, so a decoder that recovered six cells full of the wrong truth tables would satisfy every
 * assertion above. `fixtures/gowin-gw1n1-splitpad.v` asks for six specific four-input functions; here they are
 * written out again and compared with what came back.
 *
 * Compared up to the ORDER of the four inputs, because that is all this can honestly claim: the trace ends at
 * six differently-named pieces of copper for what the source calls four inputs, so which recovered input is
 * `a[0]` is not established. The truth tables themselves are exact.
 */
describe('splitpad computes what its source asked for', () => {
  const pad = decoded.find((e) => e.name === 'splitpad') as (typeof decoded)[number]

  /** every way the four inputs could be ordered */
  const ORDERS: number[][] = []
  for (const first of [0, 1, 2, 3])
    for (const second of [0, 1, 2, 3])
      for (const third of [0, 1, 2, 3])
        for (const fourth of [0, 1, 2, 3])
          if (new Set([first, second, third, fourth]).size === 4)
            ORDERS.push([first, second, third, fourth])

  /** the smallest truth word the table takes under any ordering of its inputs — equal iff the functions match */
  const canonical = (truth: readonly boolean[]): number => {
    let best = Number.POSITIVE_INFINITY
    for (const order of ORDERS) {
      let word = 0
      for (let entry = 0; entry < 16; entry++) {
        let source = 0
        for (let pin = 0; pin < 4; pin++)
          if (((entry >> pin) & 1) === 1) source |= 1 << (order[pin] as number)
        if (truth[source]) word |= 1 << entry
      }
      if (word < best) best = word
    }
    return best
  }

  type Inputs = [boolean, boolean, boolean, boolean]
  const SOURCE: ((a: Inputs) => boolean)[] = [
    ([a0, a1, a2, a3]) => (a0 && a1) !== (a2 || a3),
    ([a0, a1, a2, a3]) => (a0 || a1) && a2 !== a3,
    ([a0, a1, a2, a3]) => !(a0 !== a1 || (a2 && a3)),
    ([a0, a1, a2, a3]) => (a0 && a2) || a1 !== a3,
    ([a0, a1, a2, a3]) => (a1 && a3) !== (a0 || a2),
    ([a0, a1, a2, a3]) => !((a0 && a3) !== (a1 || a2)),
  ]

  test('the six recovered lookup tables are the six functions the Verilog asks for', () => {
    const wanted = SOURCE.map((fn) =>
      canonical(
        Array.from({ length: 16 }, (_, entry) =>
          fn([
            (entry & 1) === 1,
            ((entry >> 1) & 1) === 1,
            ((entry >> 2) & 1) === 1,
            ((entry >> 3) & 1) === 1,
          ]),
        ),
      ),
    ).sort((one, other) => one - other)
    const got = pad.design.netlist.cells
      .map((cell) => canonical(cell.config.truth))
      .sort((one, other) => one - other)
    expect(got).toEqual(wanted)
  })

  test('all six are registers, and all six have the clock-enable the source gives them', () => {
    // `always @(posedge clk) if (en) r <= f` — the enable is a real wire in the bitstream, and a recovered cell
    // without it would update every cycle whatever `en` did.
    for (const cell of pad.design.netlist.cells) {
      expect(cell.config.dffEnable).toBe(true)
      expect(cell.clockEnable, `${cell.ref.x},${cell.ref.y},${cell.ref.cell}`).toBeDefined()
      expect(cell.negClk).toBe(false)
    }
  })
})

/**
 * The one condition NO REAL BITSTREAM REACHES, pinned on frames built by hand.
 *
 * "A flip-flop with no clock holds nothing" is the safe half of the old rule and is now the only thing between
 * an unclocked cell and a register. A place-and-route tool never produces the case that tests it — it does not
 * route a register's output on a pair it left unclocked — so mutating the clock test away passed every other
 * test in this file. These frames set the real fuses for one cell of one tile, taken from the device database
 * rather than invented, and put it in exactly that state.
 */
describe('an unclocked pair, built by hand', () => {
  // A plain logic tile in the middle of the fabric, and the fuses the device database gives for it.
  const ROW = 4
  const COL = 6
  const LUT_INIT = 0x00ff
  /** `D0 <- Q0`, the fused arc that makes cell 0's register output a routed source. */
  const Q_ARC_BITS: [number, number][] = [
    [17, 31],
    [19, 32],
    [16, 33],
    [16, 34],
  ]
  /** `CLK0 <- GB60`, a clock reaching the pair cells 0 and 1 share. */
  const CLOCK_BITS: [number, number][] = [
    [4, 45],
    [5, 46],
  ]
  /** `D1 <- F0`, which puts cell 0's PLAIN output into cell 1 — the second half of the split-output shape. */
  const F_ARC_BITS: [number, number][] = [
    [16, 35],
    [19, 31],
    [16, 32],
    [19, 35],
  ]

  /**
   * The bits of the one positively-keyed fuse row whose key names are exactly `wanted`.
   *
   * The decoder's own `fuseRowWithKey` is private, so this repeats its lookup over the public database. Looked
   * up BY NAME for the same reason the decoder does: the fuse carrying `CLKMUX_CLK=INV` sits at a different
   * coordinate in every table of every tile type, so a written-down coordinate would be right here and wrong
   * everywhere else.
   */
  const fuseRow = (table: string, wanted: readonly string[]): readonly string[] => {
    const ttyp = (gowinTileAt(db, ROW, COL) as { ttyp: number }).ttyp
    const target = [...wanted].sort().join(',')
    for (const entry of db.clsFuses.get(ttyp)?.get(table) ?? []) {
      if (entry.key.some((index) => index < 0)) continue
      const names = entry.key
        .filter((index) => index > 0)
        .map((index) => {
          const pair = db.logicinfoSlice.get(index) as readonly [number, number]
          return `${db.attributeNames.get(pair[0])}=${db.valueNames.get(pair[1])}`
        })
        .sort()
        .join(',')
      if (names === target) return entry.bits
    }
    throw new Error(`this device has no ${target} row in ${table}`)
  }

  /**
   * The first programmable arc into a destination wire, taken from the device's own routing table.
   *
   * Which source it is does not matter — what matters is that SOMETHING is routed there, because an unrouted
   * set/reset or clock-enable is deliberately reported as absent rather than invented.
   */
  const pipInto = (destination: string): readonly string[] => {
    const ttyp = (gowinTileAt(db, ROW, COL) as { ttyp: number }).ttyp
    for (const [, bits] of pipdb.get(ttyp)?.pips.get(destination) ?? [])
      if (bits.length > 0) return bits
    throw new Error(`this device has no programmable arc into ${destination}`)
  }

  const build = (
    clocked: boolean,
    alsoReadPlain = false,
    fallingEdge = false,
    withControls = false,
  ): boolean[][] => {
    const frames = Array.from({ length: db.bitmapRows }, () =>
      new Array<boolean>(db.bitmapCols).fill(false),
    )
    const window = gowinTileWindow(db, ROW, COL) as { top: number; left: number }
    const set = (row: number, col: number): void => {
      ;(frames[window.top + row] as boolean[])[window.left + col] = true
    }
    // the truth table: a programmed flag bit means that entry reads ZERO
    const flags = db.lutFlagBits
      .get((gowinTileAt(db, ROW, COL) as { ttyp: number }).ttyp)
      ?.get('LUT0') as readonly (readonly [number, number])[]
    for (let flag = 0; flag < 16; flag++)
      if (((LUT_INIT >> flag) & 1) === 0) set(...(flags[flag] as readonly [number, number]))
    for (const [row, col] of Q_ARC_BITS) set(row, col)
    if (clocked) for (const [row, col] of CLOCK_BITS) set(row, col)
    if (alsoReadPlain) {
      const flags1 = db.lutFlagBits
        .get((gowinTileAt(db, ROW, COL) as { ttyp: number }).ttyp)
        ?.get('LUT1') as readonly (readonly [number, number])[]
      for (let flag = 0; flag < 16; flag++)
        if (((LUT_INIT >> flag) & 1) === 0) set(...(flags1[flag] as readonly [number, number]))
      for (const [row, col] of F_ARC_BITS) set(row, col)
    }
    // The one fuse that turns cells 0 and 1 from `DFF` into `DFFN` — a flip-flop that samples on the FALLING
    // edge of the same clock.
    if (fallingEdge)
      for (const bit of fuseRow('CLS0', ['REGMODE=FF', 'CLKMUX_CLK=INV'])) {
        const [row, col] = bit.split(',')
        set(Number(row), Number(col))
      }
    // The set/reset and clock-enable the pair shares, routed to something.
    if (withControls)
      for (const destination of ['LSR0', 'CE0'])
        for (const bit of pipInto(destination)) {
          const [row, col] = bit.split(',')
          set(Number(row), Number(col))
        }
    return frames
  }

  const cellOf = (frames: boolean[][]) => {
    const design = reconstructGowinNetlist(frames, db, pipdb, attributes, aliases)
    return design.cells.find((c) => c.row === ROW && c.col === COL && c.ref.cell === 0)
  }

  test('the hand-built frames really do decode as intended', () => {
    // Without this the test below could pass because nothing decoded at all.
    const cell = cellOf(build(false))
    expect(cell, 'no cell decoded from the synthetic frames').toBeDefined()
    expect(cell?.init).toBe(LUT_INIT)
  })

  test('the CLOCKED version is a register, so the setup can produce one', () => {
    // The positive control. Same frames, plus the clock arc: the register output is routed AND the pair is
    // clocked, so this cell really does hold a flip-flop.
    const cell = cellOf(build(true))
    expect(cell?.registered).toBe(true)
    expect(cell?.flipFlop).not.toBeNull()
  })

  test('the UNCLOCKED version is not, however its register output is routed', () => {
    // The guard itself. `Q0` drives something, which is the evidence the fix relies on — but no clock reaches
    // the pair, so the flip-flop cannot be holding it and the cell is combinational.
    const cell = cellOf(build(false))
    expect(cell?.registered).toBe(false)
    expect(cell?.flipFlop).toBeNull()
    expect(cell?.refusal).toBeNull()
  })

  test('with BOTH outputs read and a clock, the cell IS shown as two — so the setup can split', () => {
    // The positive control for the test below, and the reason it is not vacuous. `D0 <- Q0` puts the stored
    // output into a pin the design reads and `D1 <- F0` puts the plain one into another, which is exactly the
    // condition the split exists for. All four arcs come from the device database, not from invention.
    const cell = cellOf(build(true, true))
    expect(cell?.refusal).toBeNull()
    expect(cell?.stored?.ref).toEqual({ x: COL, y: ROW, cell: GOWIN_STORED_HALF_OFFSET })
    expect(cell?.registered).toBe(false)
    const design = reconstructGowinNetlist(build(true, true), db, pipdb, attributes, aliases)
    expect(design.split).toHaveLength(1)
    const stored = design.netlist.cells.find(
      (c) => c.ref.x === COL && c.ref.y === ROW && c.ref.cell === GOWIN_STORED_HALF_OFFSET,
    )
    expect(stored?.config.dffEnable).toBe(true)
  })

  test('a FALLING-edge flip-flop lands on the stored half, and on nothing else', () => {
    // No shipped Gowin bitstream has a falling-edge register whose cell is also read straight through, so this
    // is the only thing that exercises the stored half's clock edge — and getting it wrong reports the design a
    // full half-period out of step. The `DFFN` fuse is read out of the device database by name, not written
    // down: `REGMODE=FF` with `CLKMUX_CLK=INV` is exactly what makes a Gowin flip-flop a falling-edge one.
    const cell = cellOf(build(true, true, true))
    // `DFFNS` rather than `DFFN`: an erased tile's set/reset multiplexer defaults to SET, so this hand-built
    // one is a settable falling-edge flip-flop. What matters is that the fuse moved the variant into the
    // falling-edge family — the plain build of the same frames is `DFFS`.
    expect(cell?.stored?.flipFlop, 'the fuse did not produce a falling-edge flip-flop').toBe(
      'DFFNS',
    )
    expect(cellOf(build(true, true))?.stored?.flipFlop).toBe('DFFS')
    const design = reconstructGowinNetlist(build(true, true, true), db, pipdb, attributes, aliases)
    const at = (position: number) =>
      design.netlist.cells.find(
        (c) => c.ref.x === COL && c.ref.y === ROW && c.ref.cell === position,
      )
    expect(at(GOWIN_STORED_HALF_OFFSET)?.negClk).toBe(true)
    // and the variant's own set/reset flags reach the stored half — `DFFNS` sets, it does not reset
    expect(at(GOWIN_STORED_HALF_OFFSET)?.config.setNoReset).toBe(true)
    expect(at(GOWIN_STORED_HALF_OFFSET)?.config.asyncSetReset).toBe(false)
    expect(at(0)?.config.setNoReset).toBe(false)
    // the straight-through half has no clock at all, so it must not claim an edge
    expect(at(0)?.negClk).toBe(false)
    // and the rising-edge build of the very same frames does not, so this is the fuse and not the shape
    const rising = reconstructGowinNetlist(build(true, true), db, pipdb, attributes, aliases)
    expect(
      rising.netlist.cells.find(
        (c) => c.ref.x === COL && c.ref.y === ROW && c.ref.cell === GOWIN_STORED_HALF_OFFSET,
      )?.negClk,
    ).toBe(false)
  })

  test('the set/reset and clock-enable land on the stored half, and on nothing else', () => {
    // The straight-through half has no clock, so a set/reset on it would let the shared simulator hold a
    // combinational cell at a fixed level — and the stored half WITHOUT them would ignore an enable the chip
    // obeys, updating every cycle instead of holding. No shipped bitstream routes either into a split cell, so
    // the arcs are taken from the device's own routing table and programmed here.
    const controlled = reconstructGowinNetlist(
      build(true, true, false, true),
      db,
      pipdb,
      attributes,
      aliases,
    )
    const at = (design: GowinDesign, position: number) =>
      design.netlist.cells.find(
        (c) => c.ref.x === COL && c.ref.y === ROW && c.ref.cell === position,
      )
    expect(
      controlled.split,
      'routing the controls must not stop the cell being split',
    ).toHaveLength(1)
    expect(at(controlled, GOWIN_STORED_HALF_OFFSET)?.setReset ?? null).not.toBeNull()
    expect(at(controlled, GOWIN_STORED_HALF_OFFSET)?.clockEnable ?? null).not.toBeNull()
    expect(at(controlled, 0)?.setReset ?? null).toBeNull()
    expect(at(controlled, 0)?.clockEnable ?? null).toBeNull()
    // and the same frames WITHOUT those arcs carry neither, so this is the routing and not the shape — an
    // unrouted set/reset means the hardware default applies, and inventing one would hold the register cleared
    const bare = reconstructGowinNetlist(build(true, true), db, pipdb, attributes, aliases)
    expect(at(bare, GOWIN_STORED_HALF_OFFSET)?.setReset ?? null).toBeNull()
    expect(at(bare, GOWIN_STORED_HALF_OFFSET)?.clockEnable ?? null).toBeNull()
  })

  test('and the cell that reads the STORED output points at the stored half, not at a chip input', () => {
    // THE CONSUMER SIDE. Splitting the producer and leaving the reader alone would emit a second cell nothing
    // ever reads while the reader kept the invented switch it had before — the exact half-fix this project has
    // been caught by. `D0 <- Q0` routes the stored output into cell 0's own D pin here, so cell 0's straight-
    // through half must read the stored half.
    const design = reconstructGowinNetlist(build(true, true), db, pipdb, attributes, aliases)
    const plain = design.netlist.cells.find(
      (c) => c.ref.x === COL && c.ref.y === ROW && c.ref.cell === 0,
    )
    const fromStored = plain?.inputs.filter(
      (input) => input.kind === 'cell' && input.driver.cell === GOWIN_STORED_HALF_OFFSET,
    )
    expect(fromStored).toHaveLength(1)
  })

  test('the SAME frames with no clock are NOT split — an unclocked cell holds nothing', () => {
    // THE GUARD. A cell whose pair has no clock holds nothing, so there are not two answers to choose between
    // and there is nothing to split. Splitting it would put a flip-flop on the canvas the chip does not have,
    // and refusing it would delete a lookup table the chip really computes with — the same over-refusal that
    // once emptied `splitpad`. Dropping the clock test from `gowinOutputPlan` used to pass every test in this
    // file; it fails here.
    const cell = cellOf(build(false, true))
    expect(cell?.refusal).toBeNull()
    expect(cell?.stored).toBeNull()
    const design = reconstructGowinNetlist(build(false, true), db, pipdb, attributes, aliases)
    expect(design.unsupported).toEqual([])
    expect(design.split).toEqual([])
    expect(
      design.netlist.cells.some((c) => c.ref.x === COL && c.ref.y === ROW && c.ref.cell === 0),
    ).toBe(true)
  })
})

/**
 * The plan on its own, one condition at a time.
 *
 * `gowinOutputPlan` decides between three outcomes, and several of its conditions are unreachable from any
 * bitstream this repository holds: no shipped Gowin design puts a level-sensitive latch, a position with no
 * flip-flop, an arithmetic cell or an occupied stored-half place into the both-outputs-read case. A rule
 * nothing exercises is a rule nobody has checked, so each condition is taken apart here on inputs built by
 * hand. Every one of them is a PARAMETER for exactly that reason.
 */
describe('gowinOutputPlan — each condition alone', () => {
  test('a cell whose two outputs are both read inside is shown as two', () => {
    expect(gowinOutputPlan(true, true, true, 'DFF', false, true)).toEqual({
      split: true,
      refusal: null,
    })
  })

  test('every edge-triggered variant can be split, and every latch variant is refused', () => {
    // Walked rather than sampled: a variant missing from the flip-flop table would otherwise be refused
    // silently, and a latch newly added to the fabric would otherwise be split into a flip-flop it is not.
    for (const variant of [
      'DFF',
      'DFFN',
      'DFFR',
      'DFFNR',
      'DFFS',
      'DFFNS',
      'DFFC',
      'DFFNC',
      'DFFP',
      'DFFNP',
    ])
      expect(gowinOutputPlan(true, true, true, variant, false, true), variant).toEqual({
        split: true,
        refusal: null,
      })
    for (const variant of ['DL', 'DLN', 'DLC', 'DLNC', 'DLP', 'DLNP']) {
      const plan = gowinOutputPlan(true, true, true, variant, false, true)
      expect(plan.split, variant).toBe(false)
      expect(plan.refusal?.kind, variant).toBe(variant)
      expect(plan.refusal?.reason, variant).toMatch(/level-sensitive latch/)
    }
  })

  test('a position with no flip-flop of its own is refused, not split', () => {
    // A Gowin slice column holds eight lookup tables and six flip-flops, so positions 6 and 7 have no register
    // to show. Splitting there would invent one.
    const plan = gowinOutputPlan(true, true, true, null, false, true)
    expect(plan.split).toBe(false)
    expect(plan.refusal?.kind).toBe('split-output')
    expect(plan.refusal?.reason).toMatch(/this position holds none the reader can name/)
  })

  test('a flip-flop kind the reader does not know is refused, not split', () => {
    const plan = gowinOutputPlan(true, true, true, 'DFFX', false, true)
    expect(plan.split).toBe(false)
    expect(plan.refusal?.kind).toBe('split-output')
  })

  test('a stored half with nowhere to go is refused, not written over another part', () => {
    const plan = gowinOutputPlan(true, true, true, 'DFF', false, false)
    expect(plan.split).toBe(false)
    expect(plan.refusal?.kind).toBe('split-output')
    expect(plan.refusal?.reason).toMatch(/already taken by another part of this chip/)
  })

  test('an arithmetic cell is not split, because it is not on the canvas to split', () => {
    // It is refused with its own, more specific reason instead. Recording a split for it would claim a second
    // part for a cell the canvas never shows, and every count taken from that list would be one too high.
    expect(gowinOutputPlan(true, true, true, 'DFF', true, true)).toEqual({
      split: false,
      refusal: null,
    })
  })

  test('an unclocked pair is neither split nor refused, whatever else is true', () => {
    expect(gowinOutputPlan(false, true, true, 'DFF', false, true)).toEqual({
      split: false,
      refusal: null,
    })
    expect(gowinOutputPlan(false, true, true, 'DL', false, true)).toEqual({
      split: false,
      refusal: null,
    })
    expect(gowinOutputPlan(false, true, true, null, true, false)).toEqual({
      split: false,
      refusal: null,
    })
  })

  test('one output read inside is not the case this is for', () => {
    // The over-refusal that emptied `splitpad`, and the over-SPLIT that would replace it: with only one reader
    // inside the netlist there is nothing to serve with a second cell.
    expect(gowinOutputPlan(true, true, false, 'DFF', false, true)).toEqual({
      split: false,
      refusal: null,
    })
    expect(gowinOutputPlan(true, false, true, 'DFF', false, true)).toEqual({
      split: false,
      refusal: null,
    })
    expect(gowinOutputPlan(true, false, false, 'DFF', false, true)).toEqual({
      split: false,
      refusal: null,
    })
  })

  test('the stored half sits at a place of its own in the same tile', () => {
    expect(gowinStoredHalfRef({ x: 3, y: 9, cell: 0 })).toEqual({
      x: 3,
      y: 9,
      cell: GOWIN_STORED_HALF_OFFSET,
    })
    for (let cell = 0; cell < 8; cell++) {
      const stored = gowinStoredHalfRef({ x: 1, y: 2, cell })
      expect(stored.x).toBe(1)
      expect(stored.y).toBe(2)
      expect(stored.cell).toBeGreaterThan(7)
    }
  })
})

describe('the verdict does not depend on which optional tables the caller passes', () => {
  test('the same cells are registered with and without the wire-alias table', () => {
    // The evidence needs wire names reconciled, and `aliases` is optional. If the verdict were read through the
    // caller's table, omitting it would silently turn a real register combinational — measured: it did, on one
    // cell, before the evidence was given its own always-applied reconciliation.
    for (const entry of ORACLE) {
      const frames = parseGowinBitstream(
        readFileSync(at(`gowin-gw1n1-${entry.name}.fs`), 'utf8'),
      ).frames
      const summarise = (design: GowinDesign): string[] =>
        design.cells
          .filter((c) => c.registered)
          .map((c) => `${c.col},${c.row},${c.ref.cell}`)
          .sort()
      const withTable = reconstructGowinNetlist(frames, db, pipdb, attributes, aliases)
      const without = reconstructGowinNetlist(frames, db, pipdb, attributes)
      expect(summarise(without), entry.name).toEqual(summarise(withTable))
      expect(without.unsupported.length, entry.name).toBe(withTable.unsupported.length)
      // and which cells are shown as two is a fact about the silicon in the same way, so it must not move
      // with the caller's naming either
      expect(
        without.split.map((s) => `${s.ref.x},${s.ref.y},${s.ref.cell}`).sort(),
        entry.name,
      ).toEqual(withTable.split.map((s) => `${s.ref.x},${s.ref.y},${s.ref.cell}`).sort())
    }
  })
})

/**
 * The evidence rule on its own, one condition at a time.
 *
 * `gowinCellOutputUse` combines a fused-arc test with a default-arc test, and the default-arc test has two
 * conditions of its own. A bitstream exercises them together, so each is taken apart here on inputs built by
 * hand — the only way to show that a condition is load-bearing rather than merely present.
 */
describe('gowinCellOutputUse — each condition alone', () => {
  const noRouting: GowinTileRouting = { pips: new Map(), clockPips: new Map() }
  const same = (wire: string): string => wire

  test('a fused arc out of Q<n> is evidence on its own', () => {
    const use = gowinCellOutputUse(3, new Set(['Q3']), noRouting, new Map(), new Set(), same)
    expect(use).toEqual({ combinational: false, registered: true })
  })

  test('a fused arc out of F<n> says the lookup table output is in use', () => {
    const use = gowinCellOutputUse(3, new Set(['F3']), noRouting, new Map(), new Set(), same)
    expect(use).toEqual({ combinational: true, registered: false })
  })

  test('another cell’s wires are not mistaken for this one’s', () => {
    const use = gowinCellOutputUse(3, new Set(['Q2', 'F4']), noRouting, new Map(), new Set(), same)
    expect(use).toEqual({ combinational: false, registered: false })
  })

  test('a DEFAULT arc counts when its wire is read', () => {
    // The case a fuse-only decode cannot see: `Q<n>` is the power-up source of the multiplexer, so a design
    // using it programs no fuse at all. Measured against the placement record over the ten designs this fix
    // was built on: 296 of the 499 placed flip-flops travelled on such an arc, so only 203 of them put `Q<n>`
    // on an arc the fuse decode can see. Without this test they are invisible and every one is refused.
    const use = gowinCellOutputUse(
      3,
      new Set(),
      noRouting,
      new Map([[3, ['E100']]]),
      new Set(['E100']),
      same,
    )
    expect(use.registered).toBe(true)
  })

  test('a default arc whose wire NOTHING reads is not evidence', () => {
    // Every cell of every tile has these arcs, used or not. Counting them unconditionally would make every
    // clocked pair look like two registers again — which is the defect.
    const use = gowinCellOutputUse(
      3,
      new Set(),
      noRouting,
      new Map([[3, ['E100']]]),
      new Set(),
      same,
    )
    expect(use.registered).toBe(false)
  })

  test('a default arc whose multiplexer was programmed to something ELSE is not evidence', () => {
    // The arc only holds while nothing overrides it. Here the same destination is driven by another source, so
    // the wire carries that instead and reading it says nothing about this cell's register.
    const programmed: GowinTileRouting = {
      pips: new Map([['E100', 'F5']]),
      clockPips: new Map(),
    }
    const use = gowinCellOutputUse(
      3,
      new Set(),
      programmed,
      new Map([[3, ['E100']]]),
      new Set(['E100']),
      same,
    )
    expect(use.registered).toBe(false)
    // and the clock table is checked as well as the general one
    const onClock: GowinTileRouting = { pips: new Map(), clockPips: new Map([['E100', 'F5']]) }
    expect(
      gowinCellOutputUse(3, new Set(), onClock, new Map([[3, ['E100']]]), new Set(['E100']), same)
        .registered,
    ).toBe(false)
  })

  test('the wire is looked up under its GLOBAL name, not its tile-local one', () => {
    // A wire is called something different in every tile it passes through. Comparing local names would find
    // nothing, and the whole default-arc test would go dead without failing.
    const use = gowinCellOutputUse(
      3,
      new Set(),
      noRouting,
      new Map([[3, ['E100']]]),
      new Set(['R4C7_E10']),
      (wire) => `R4C7_${wire.slice(0, 3)}`,
    )
    expect(use.registered).toBe(true)
  })
})

describe('gowinDefaultRegisterArcs — only the arcs that really are defaults', () => {
  const arcs = gowinDefaultRegisterArcs(pipdb)

  test('it finds default register arcs on this device at all', () => {
    let total = 0
    for (const byCell of arcs.values()) for (const list of byCell.values()) total += list.length
    expect(total).toBeGreaterThan(0)
  })

  test('every arc it reports really has an EMPTY bit list in the database', () => {
    // A fused arc is already covered by the direct test; treating one as a default would report a connection
    // whenever the wire is read, whatever the fuses say.
    for (const [ttyp, byCell] of arcs) {
      const tables = pipdb.get(ttyp)
      expect(tables, `ttyp ${ttyp}`).toBeDefined()
      for (const [cell, destinations] of byCell)
        for (const destination of destinations) {
          const sources =
            tables?.pips.get(destination) ?? tables?.clockPips.get(destination) ?? new Map()
          expect(sources.get(`Q${cell}`), `ttyp ${ttyp} ${destination} <- Q${cell}`).toEqual([])
        }
    }
  })

  test('it keys arcs by the cell whose register drives them', () => {
    for (const [ttyp, byCell] of arcs) {
      const tables = pipdb.get(ttyp)
      for (const [cell, destinations] of byCell) {
        expect(destinations.length).toBeGreaterThan(0)
        for (const destination of destinations) {
          const sources = tables?.pips.get(destination) ?? tables?.clockPips.get(destination)
          expect(sources?.has(`Q${cell}`), `${destination} <- Q${cell}`).toBe(true)
        }
      }
    }
  })
})

/**
 * WHAT THE SPLIT DESIGN COMPUTES, checked against the source it was built from.
 *
 * Everything above counts things: how many cells, how many refusals, which cells the two readers agree about.
 * None of it says the recovered design produces the right VALUES, and the split is a claim about values —
 * that the straight-through half carries this cycle's lookup-table result and the stored half carries last
 * cycle's, each to the right readers.
 *
 * `gowin-gw1n1-splitmix.v` is the source the bitstream was built from, and
 * `gowin-gw1n1-splitmix-vectors.json` is what Icarus Verilog says that source computes, cycle by cycle, from
 * the testbench beside it. The recovered netlist is clocked through the SHARED simulator on the same stimulus
 * and must agree on every cycle of both outputs.
 *
 * `y[0]` is a chain reading the plain results of the two split cells and `y[1]` a chain reading their stored
 * results, so a split that gets either half wrong cannot pass — and before the split, both chains were fed
 * invented chip inputs where those cells had been, which no stimulus could have made right.
 *
 * WHAT IS NOT ESTABLISHED, and why the check searches. The trace ends at six differently-named pieces of
 * copper for the four inputs the source declares, so which recovered chip input is `a[0]` is not known; and
 * which recovered part drives which package pin is not known either. So every way of tying the recovered
 * inputs to the source's four is tried, against every pair of parts nothing else reads, and at least one must
 * reproduce BOTH output sequences exactly. The stimulus walks all sixteen values of `a`, so `y[0]` is pinned
 * for every input and `y[1]` for every predecessor — the design's whole behaviour, not a sample.
 */
describe('splitmix computes what its source computes, clock by clock', () => {
  type Vectors = { cycles: { a: number; y0: number; y1: number }[] }
  const vectors = JSON.parse(
    readFileSync(at('gowin-gw1n1-splitmix-vectors.json'), 'utf8'),
  ) as Vectors
  const mix = decoded.find((e) => e.name === 'splitmix') as (typeof decoded)[number]
  const cellKeyOf = (r: { x: number; y: number; cell: number }): string => `${r.x}_${r.y}_${r.cell}`

  /** the parts nothing else on the chip reads — what a package pin is driven by */
  const sinks = (() => {
    const read = new Set<string>()
    for (const cell of mix.design.netlist.cells)
      for (const source of [...cell.inputs, cell.setReset, cell.clockEnable])
        if (source != null && source.kind === 'cell') read.add(cellKeyOf(source.driver))
    return mix.design.netlist.cells
      .filter((cell) => !read.has(cellKeyOf(cell.ref)))
      .map((cell) => cellKeyOf(cell.ref))
  })()

  const nets = [...mix.design.primaryWires.keys()].sort((one, other) => one - other)

  test('the golden vectors really do exercise the whole design', () => {
    // Without this the comparison below could pass on a stimulus that never varies anything.
    expect(vectors.cycles.length).toBe(32)
    expect(new Set(vectors.cycles.map((cycle) => cycle.a)).size).toBe(16)
    expect(new Set(vectors.cycles.map((cycle) => cycle.y0)).size).toBe(2)
    expect(new Set(vectors.cycles.map((cycle) => cycle.y1)).size).toBe(2)
  })

  test('the design has two parts nothing else reads, and exactly the source’s four inputs', () => {
    // The search below is only meaningful if it has something to search. Two output cones and four inputs is
    // what this bitstream holds; before the split it held ten inputs, four of which were invented, and after
    // it six, of which two still were. `gowin-gw1n1-splitmix.v` declares `clk` and `a[3:0]`, and a clock is
    // not a net of the recovered netlist — so four is the whole of what enters this design.
    expect(sinks).toHaveLength(2)
    expect(nets).toHaveLength(4)
  })

  test('the recovered design reproduces both outputs, every cycle', () => {
    const found: string[] = []
    for (let assignment = 0; assignment < 4 ** nets.length; assignment++) {
      const bitOf = nets.map((_, index) => (assignment >> (2 * index)) & 3)
      const stimulus = vectors.cycles.map(
        (cycle) =>
          new Map(
            nets.map((net, index) => [net, ((cycle.a >> (bitOf[index] as number)) & 1) === 1]),
          ),
      )
      const run = simulateClocked(mix.design.netlist, stimulus, vectors.cycles.length)
      for (const zero of sinks)
        for (const one of sinks) {
          if (zero === one) continue
          const matches = vectors.cycles.every((cycle, index) => {
            const trace = run.trace[index] as Map<string, boolean>
            return (trace.get(zero) ? 1 : 0) === cycle.y0 && (trace.get(one) ? 1 : 0) === cycle.y1
          })
          if (matches) found.push(`${bitOf.join('')} y0=${zero} y1=${one}`)
        }
    }
    expect(found.length, 'no way of naming the inputs reproduces the source').toBeGreaterThan(0)
    // and every solution agrees about WHICH part drives which output, so the two cones are not interchangeable
    expect(new Set(found.map((solution) => solution.slice(solution.indexOf(' ') + 1))).size).toBe(1)
  })

  test('the two output cones really do read the two halves of the split cells', () => {
    // The reason the check above is a check of the SPLIT and not merely of the decoder. One cone's inputs
    // reach the straight-through halves and the other's reach the stored halves; if both read the same half,
    // agreeing with the source would say nothing about the split.
    const byKey = new Map(mix.design.netlist.cells.map((c) => [cellKeyOf(c.ref), c]))
    const reaches = (from: string, target: string): boolean => {
      const seen = new Set<string>()
      const stack = [from]
      while (stack.length > 0) {
        const key = stack.pop() as string
        if (key === target) return true
        if (seen.has(key)) continue
        seen.add(key)
        for (const source of byKey.get(key)?.inputs ?? [])
          if (source.kind === 'cell') stack.push(cellKeyOf(source.driver))
      }
      return false
    }
    const plainHalves = mix.design.split.map((shown) => cellKeyOf(shown.ref))
    const storedHalves = mix.design.split.map((shown) => cellKeyOf(shown.storedRef))
    const readsPlain = sinks.filter((sink) => plainHalves.some((half) => reaches(sink, half)))
    const readsStored = sinks.filter((sink) => storedHalves.some((half) => reaches(sink, half)))
    expect(readsPlain).toHaveLength(1)
    expect(readsStored).toHaveLength(1)
    expect(readsPlain[0]).not.toBe(readsStored[0])
  })
})
