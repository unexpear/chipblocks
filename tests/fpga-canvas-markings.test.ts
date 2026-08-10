/**
 * FPGA fabric — a decoder's caveats have to survive the trip onto the canvas.
 *
 * Lowering is the last hop: after it, a bitstream is an ordinary circuit of AND / OR / NOT gates and nothing
 * about it remembers which vendor cell it came from. So it is the last place anything can say "this cell was
 * read but its value must not be trusted" or "this cell could not be read at all". It said neither. Measured in
 * the running app before the fix: a netlist carrying ONE marking went in and `lowerNetlistToCanvas` handed back
 * two ordinary gates and no marking at all.
 *
 * Every count below is measured from a REAL vendor bitstream already vendored in `fixtures/`, decoded by the
 * same decoders the app uses:
 *
 *   ECP5 (Project Trellis)  dpram      6 distributed-memory cells
 *                           ccu2-add4 10 arithmetic cells
 *                           widemux   10 wide-multiplexer cells
 *                           lut-reg    0 — the negative control
 *   Gowin (Apicula)         adder4     6 arithmetic cells refused + the 4 parts that READ them, whose inputs
 *                                      are now invented
 *                           splitkeep  2 with a flip-flop left out
 *                           mixedreg   2 level-sensitive latches refused
 *                           pairmix    0, dense 0, splitout 0, splitmix 0 — the negative controls
 *
 * `splitout` and `splitmix` used to supply 16 refusals and 37 untrusted parts between them, and supply none
 * now: a cell that both stores its result and passes it straight through is shown as the two recovered cells
 * it behaves as instead of being refused, so nothing vanishes and nothing downstream is handed an invented
 * input. They are kept here as negative controls. `adder4` carries the same two kinds — an arithmetic cell
 * really cannot be described by the shared cell — so the plumbing stays measured on a real bitstream.
 *
 * WHAT "NEGATIVE CONTROL" MEANS HERE, narrowly: these four designs put nothing on the three warning lists.
 * It has never meant the decode of them was RIGHT, and for a while it was not — `dense` came back with 236
 * chip inputs for a source declaring six ports, and reported nothing wrong, because a signal crossing the die
 * on a long wire dead-ended and a chip input was invented wherever it was read. Empty warning lists are worth
 * pinning and are not evidence of a correct read; `fpga-gowin-long-wire.test.ts` is what checks that.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { parseGowinAttributeDatabase } from '../src/renderer/fpga-apicula-attributes.ts'
import { type GowinChipdb, parseGowinChipdb } from '../src/renderer/fpga-apicula-chipdb.ts'
import { parseGowinBitstream } from '../src/renderer/fpga-apicula-fs.ts'
import {
  gowinFixedAliases,
  parseGowinWireAliases,
  reconstructGowinNetlist,
} from '../src/renderer/fpga-apicula-netlist.ts'
import { parseGowinPipDatabase } from '../src/renderer/fpga-apicula-routing.ts'
import { lowerNetlistToCanvas } from '../src/renderer/fpga-icebox-canvas.ts'
import type { RecoveredCell, RecoveredNetlist } from '../src/renderer/fpga-icebox-run.ts'
import { parseEcp5Bitstream } from '../src/renderer/fpga-trellis-bit.ts'
import { reconstructEcp5Netlist } from '../src/renderer/fpga-trellis-netlist.ts'
import {
  type Ecp5TileDb,
  parseEcp5TileBits,
  parseEcp5TileGrid,
} from '../src/renderer/fpga-trellis-tiles.ts'

const at = (name: string): URL => new URL(`../fixtures/${name}`, import.meta.url)
const cellKey = (ref: { x: number; y: number; cell: number }): string =>
  `${ref.x}_${ref.y}_${ref.cell}`

const GRID = parseEcp5TileGrid(readFileSync(at('trellis-ecp5-LFE5U-25F-tilegrid.json'), 'utf8'))
const ECP5_TILE_TYPES = [
  'PLC2',
  'CIB',
  'CIB_LR',
  'CIB_EBR',
  'CIB_DSP',
  'TAP_DRIVE',
  'PIOT0',
  'PIOT1',
  'PICT0',
  'PICT1',
]
const ECP5_DBS = new Map<string, Ecp5TileDb>(
  ECP5_TILE_TYPES.map((type) => [
    type,
    parseEcp5TileBits(readFileSync(at(`trellis-ecp5-${type}-bits.db`), 'utf8')),
  ]),
)
const ecp5NetlistOf = (name: string) =>
  reconstructEcp5Netlist(
    parseEcp5Bitstream(new Uint8Array(readFileSync(at(`trellis-ecp5-${name}.bit`)))).frames,
    GRID,
    (type) => ECP5_DBS.get(type) ?? null,
  )

const gowinDb: GowinChipdb = parseGowinChipdb(readFileSync(at('gowin-gw1n1-chipdb.json'), 'utf8'))
const gowinPips = parseGowinPipDatabase(readFileSync(at('gowin-gw1n1-pips.json'), 'utf8'))
const gowinAttributes = parseGowinAttributeDatabase(
  readFileSync(at('gowin-gw1n1-attributes.json'), 'utf8'),
)
const gowinAliases = new Map([
  ...parseGowinWireAliases(readFileSync(at('gowin-gw1n1-nodes.json'), 'utf8')),
  ...gowinFixedAliases(gowinDb.rows, gowinDb.cols),
])
const gowinDesignOf = (name: string) =>
  reconstructGowinNetlist(
    parseGowinBitstream(readFileSync(at(`gowin-gw1n1-${name}.fs`), 'utf8')).frames,
    gowinDb,
    gowinPips,
    gowinAttributes,
    gowinAliases,
  )

describe('the decoder’s "read but do not trust" list reaches the canvas', () => {
  // Each of these is a cell the ECP5 decoder recovered and then declared untrustworthy. Before this, lowering
  // built its gates and dropped the declaration, so the canvas showed a plausible wrong answer with nothing
  // anywhere to say it was one.
  const CASES = [
    { name: 'dpram', count: 6, reason: /distributed-RAM/ },
    { name: 'ccu2-add4', count: 10, reason: /arithmetic \(CCU2\)/ },
    { name: 'widemux', count: 10, reason: /wide-function multiplexer/ },
  ] as const

  for (const { name, count, reason } of CASES)
    test(`${name}: all ${count} untrustworthy cells arrive, with their reasons`, () => {
      const netlist = ecp5NetlistOf(name)
      expect(netlist.unfaithful).toHaveLength(count) // the decoder still finds them
      const lowered = lowerNetlistToCanvas(netlist)
      expect(lowered.unfaithful).toHaveLength(count)
      for (const listed of lowered.unfaithful) expect(listed.reason).toMatch(reason)
      // the same cells, not merely the same number
      expect(lowered.unfaithful.map((u) => cellKey(u.ref)).sort()).toEqual(
        netlist.unfaithful.map((u) => cellKey(u.ref)).sort(),
      )
    })

  test('an untrustworthy cell is still ON the canvas — flagged, not deleted', () => {
    // Deleting it would be the other failure: a design missing cells simulates as a different design. The rule
    // is that the cell is present and the warning travels with it.
    const netlist = ecp5NetlistOf('ccu2-add4')
    const lowered = lowerNetlistToCanvas(netlist)
    expect(lowered.unfaithful.length).toBeGreaterThan(0)
    for (const listed of lowered.unfaithful)
      expect(lowered.cellOutputs.has(cellKey(listed.ref)), cellKey(listed.ref)).toBe(true)
  })

  test('a design with nothing to declare declares nothing', () => {
    const lowered = lowerNetlistToCanvas(ecp5NetlistOf('lut-reg'))
    expect(lowered.unfaithful).toEqual([])
    expect(lowered.undecoded).toEqual([])
    expect(lowered.incomplete).toEqual([])
  })
})

describe('the decoder’s "could not be read at all" list reaches the canvas', () => {
  const CASES = [
    { name: 'splitout', undecoded: 0, incomplete: 0, untrusted: 0 },
    { name: 'splitmix', undecoded: 0, incomplete: 0, untrusted: 0 },
    { name: 'splitkeep', undecoded: 0, incomplete: 2, untrusted: 0 },
    { name: 'adder4', undecoded: 6, incomplete: 0, untrusted: 4 },
    { name: 'mixedreg', undecoded: 2, incomplete: 0, untrusted: 0 },
    { name: 'pairmix', undecoded: 0, incomplete: 0, untrusted: 0 },
    { name: 'dense', undecoded: 0, incomplete: 0, untrusted: 0 },
  ] as const

  for (const { name, undecoded, incomplete, untrusted } of CASES)
    test(`${name}: ${undecoded} refused, ${incomplete} incomplete and ${untrusted} untrusted cells come through`, () => {
      const design = gowinDesignOf(name)
      expect(design.unsupported).toHaveLength(undecoded) // the decoder still refuses them
      expect(design.partial).toHaveLength(incomplete)
      expect(design.distrusted).toHaveLength(untrusted)
      const lowered = lowerNetlistToCanvas(design.netlist)
      expect(lowered.undecoded.map((u) => cellKey(u.ref))).toEqual(
        design.unsupported.map((u) => cellKey(u.ref)),
      )
      expect(lowered.incomplete.map((u) => cellKey(u.ref))).toEqual(
        design.partial.map((u) => cellKey(u.ref)),
      )
      // A part whose input was replaced by an invented one is as untrustworthy as the part that vanished, and
      // this is the hop where saying so stops being possible.
      for (const listed of design.distrusted)
        expect(
          lowered.unfaithful.map((u) => cellKey(u.ref)),
          name,
        ).toContain(cellKey(listed.ref))
      for (const listed of [...lowered.undecoded, ...lowered.incomplete, ...lowered.unfaithful])
        expect(listed.reason.length).toBeGreaterThan(0)
    })

  test('the parts that READ a refused cell are on the canvas, and marked there', () => {
    // The half that was missing: refusing a cell put a warning on the cell that is RIGHT and left the
    // parts computing the wrong answer looking ordinary. These are present, so the marking is the only thing
    // that can tell the user their values are not the chip's.
    const design = gowinDesignOf('adder4')
    const lowered = lowerNetlistToCanvas(design.netlist)
    expect(design.distrusted.length).toBeGreaterThan(0)
    for (const listed of lowered.unfaithful)
      expect(lowered.cellOutputs.has(cellKey(listed.ref)), cellKey(listed.ref)).toBe(true)
    // and none of them is one of the refused cells, which are not on the canvas at all
    const refused = new Set(design.unsupported.map((u) => cellKey(u.ref)))
    for (const listed of lowered.unfaithful) expect(refused.has(cellKey(listed.ref))).toBe(false)
  })

  test('a refused cell is on NO canvas node, which is exactly why the list has to travel', () => {
    // This is the difference between the two lists. An untrustworthy cell is present and wrong; a refused cell
    // is absent, and the list is the only trace that anything was there at all.
    const design = gowinDesignOf('adder4')
    const lowered = lowerNetlistToCanvas(design.netlist)
    expect(lowered.undecoded.length).toBeGreaterThan(0)
    for (const listed of lowered.undecoded)
      expect(lowered.cellOutputs.has(cellKey(listed.ref)), cellKey(listed.ref)).toBe(false)
  })

  test('an incomplete cell IS on the canvas — it is right for what reads it', () => {
    const design = gowinDesignOf('splitkeep')
    const lowered = lowerNetlistToCanvas(design.netlist)
    expect(lowered.incomplete.length).toBeGreaterThan(0)
    for (const listed of lowered.incomplete)
      expect(lowered.cellOutputs.has(cellKey(listed.ref)), cellKey(listed.ref)).toBe(true)
  })

  test('the canvas gets its own copy, so a caller cannot rewrite the decoder’s list', () => {
    const refusing = gowinDesignOf('adder4')
    const refusingLowered = lowerNetlistToCanvas(refusing.netlist)
    refusingLowered.undecoded.length = 0
    refusingLowered.unfaithful.length = 0
    expect(refusing.unsupported).toHaveLength(6)
    expect(refusing.distrusted).toHaveLength(4)
    const keeping = gowinDesignOf('splitkeep')
    const keepingLowered = lowerNetlistToCanvas(keeping.netlist)
    keepingLowered.incomplete.length = 0
    expect(keeping.partial).toHaveLength(2)
  })
})

describe('the lowering’s OWN findings are not lost to the decoder’s', () => {
  const ref = (cell: number) => ({ x: 0, y: 0, cell })
  const dependsOnPin1 = Array.from({ length: 16 }, (_, i) => ((i >> 1) & 1) === 1)
  const carryFed = (cellIndex: number): RecoveredCell => ({
    ref: ref(cellIndex),
    config: {
      truth: dependsOnPin1,
      carryEnable: false,
      dffEnable: false,
      setNoReset: false,
      asyncSetReset: false,
    },
    inputs: [
      { kind: 'unused' },
      { kind: 'carry', driver: ref(9), net: 7 },
      { kind: 'unused' },
      { kind: 'unused' },
    ],
  })

  test('a carry-fed cell the decoder said nothing about is still flagged here', () => {
    const lowered = lowerNetlistToCanvas({ cells: [carryFed(0)] })
    expect(lowered.unfaithful).toHaveLength(1)
    expect(lowered.unfaithful[0]?.reason).toMatch(/carry unit/)
    expect(cellKey(lowered.unfaithful[0]?.ref as { x: number; y: number; cell: number })).toBe(
      '0_0_0',
    )
  })

  test('a cell BOTH distrust is one entry carrying both reasons, not two entries', () => {
    // A caller counting this list is counting cells the user cannot trust. Two entries for one cell would
    // overstate the damage, and keeping only one reason would hide half of why.
    const netlist: RecoveredNetlist = {
      cells: [carryFed(0)],
      unfaithful: [{ ref: ref(0), reason: 'the decoder could not model this slice' }],
    }
    const lowered = lowerNetlistToCanvas(netlist)
    expect(lowered.unfaithful).toHaveLength(1)
    expect(lowered.unfaithful[0]?.reason).toMatch(/could not model this slice/)
    expect(lowered.unfaithful[0]?.reason).toMatch(/carry unit/)
  })

  test('two different cells stay two entries', () => {
    const netlist: RecoveredNetlist = {
      cells: [carryFed(0), carryFed(1)],
      unfaithful: [{ ref: ref(2), reason: 'the decoder could not model this slice' }],
    }
    const lowered = lowerNetlistToCanvas(netlist)
    expect(lowered.unfaithful.map((u) => cellKey(u.ref))).toEqual(['0_0_2', '0_0_0', '0_0_1'])
  })

  test('a carry pin is warned about ONCE, not twice in two wordings', () => {
    // Two sites in the lowering notice an input it cannot use, and a carry pin trips both. The user reads these
    // strings, so the carry pin gets the sentence that actually explains it and not also the generic one. This
    // table is pin1 XOR pin2 so that a minterm wants the carry pin LOW, which is the only way to reach the
    // second site at all.
    const carryXor: RecoveredCell = {
      ref: ref(0),
      config: {
        truth: Array.from({ length: 16 }, (_, i) => (((i >> 1) & 1) ^ ((i >> 2) & 1)) === 1),
        carryEnable: false,
        dffEnable: false,
        setNoReset: false,
        asyncSetReset: false,
      },
      inputs: [
        { kind: 'unused' },
        { kind: 'carry', driver: ref(9), net: 7 },
        { kind: 'primary', net: 11 },
        { kind: 'unused' },
      ],
    }
    const lowered = lowerNetlistToCanvas({ cells: [carryXor] })
    expect(lowered.unfaithful).toHaveLength(1)
    expect(lowered.unfaithful[0]?.reason).toMatch(/carry unit/)
    expect(lowered.unfaithful[0]?.reason).not.toMatch(/has no driver that could be followed/)
  })

  test('a pin whose driver could not be followed is flagged, naming the pin', () => {
    // Not the carry case: pin 1 names a cell that is not in the netlist at all, so the lowering has nothing to
    // wire it to. The table is pin1 XOR pin2 because the flag lives on the branch where a minterm wants the
    // unresolved pin LOW — a table that only ever wants it HIGH is unsatisfiable and drops out earlier.
    const orphan: RecoveredCell = {
      ref: ref(0),
      config: {
        truth: Array.from({ length: 16 }, (_, i) => (((i >> 1) & 1) ^ ((i >> 2) & 1)) === 1),
        carryEnable: false,
        dffEnable: false,
        setNoReset: false,
        asyncSetReset: false,
      },
      inputs: [
        { kind: 'unused' },
        { kind: 'cell', driver: ref(5), net: 3 },
        { kind: 'primary', net: 11 },
        { kind: 'unused' },
      ],
    }
    const lowered = lowerNetlistToCanvas({ cells: [orphan] })
    expect(lowered.unfaithful).toHaveLength(1)
    expect(lowered.unfaithful[0]?.reason).toMatch(/input 1 of this cell has no driver/)
  })
})
