/**
 * The door a person walks through to read a programmed FPGA chip (src/renderer/fpga-open.ts).
 *
 * Everything here runs on REAL vendor-format bitstreams and the REAL open-source chip descriptions committed in
 * `fixtures/` — no hand-built netlists, no stub databases. That matters most for the honesty half: the counts
 * asserted below are the counts the decoders actually produce for those files, so a change that starts dropping
 * a caveat on the way to the user fails here rather than showing someone a design that quietly lost a third of
 * itself.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { deserializeCircuit } from '../src/renderer/circuit-file.ts'
import { parseGowinAttributeDatabase } from '../src/renderer/fpga-apicula-attributes.ts'
import { parseGowinChipdb } from '../src/renderer/fpga-apicula-chipdb.ts'
import { parseGowinBitstream } from '../src/renderer/fpga-apicula-fs.ts'
import {
  gowinFixedAliases,
  parseGowinWireAliases,
  reconstructGowinNetlist,
} from '../src/renderer/fpga-apicula-netlist.ts'
import { parseGowinPipDatabase } from '../src/renderer/fpga-apicula-routing.ts'
import { lowerNetlistToCanvas } from '../src/renderer/fpga-icebox-canvas.ts'
import { loadBitstream } from '../src/renderer/fpga-load.ts'
import {
  buildReferences,
  type ChipDescriptionFile,
  chipDescriptionRequest,
  chipName,
  fpgaReportFor,
  identifyBitstream,
  loweredToCircuitFile,
  openFpgaDesign,
  plainEnglish,
} from '../src/renderer/fpga-open.ts'

const bytes = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)))
const description = (name: string): ChipDescriptionFile => ({
  name,
  text: readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'),
})

const ICE40_384 = ['icebox-ice40-384-chipdb.txt']
const ECP5_25F = [
  'trellis-ecp5-LFE5U-25F-tilegrid.json',
  'trellis-ecp5-PLC2-bits.db',
  'trellis-ecp5-CIB-bits.db',
  'trellis-ecp5-CIB_EBR-bits.db',
]
const descriptions = (names: readonly string[]): ChipDescriptionFile[] => names.map(description)

/** Every word a user is shown for one opened file, so a jargon check can look at all of it at once. */
function everyUserString(result: ReturnType<typeof openFpgaDesign>): string {
  if (!result.ok) return result.reason
  const { report } = result
  return [
    ...report.missing.flatMap((line) => [line.part, line.reason]),
    ...report.untrusted.flatMap((line) => [line.part, line.reason]),
    ...report.incomplete.flatMap((line) => [line.part, line.reason]),
    ...report.notes,
  ].join(' ')
}

describe('identifyBitstream — names the chip before any reference data exists', () => {
  test('reads the device out of real vendor bitstreams of both families', () => {
    expect(identifyBitstream(bytes('icebox-ice40-384-vendor-xor5.bin'))).toEqual({
      ok: true,
      family: 'ice40',
      device: '384',
      form: 'binary',
    })
    expect(identifyBitstream(bytes('icebox-ice40-1k-vendor-xor5.bin'))).toEqual({
      ok: true,
      family: 'ice40',
      device: '1k',
      form: 'binary',
    })
    expect(identifyBitstream(bytes('trellis-ecp5-ccu2-add4.bit'))).toEqual({
      ok: true,
      family: 'ecp5',
      device: 'LFE5U-25F',
      form: 'binary',
    })
  })

  test('a file of a kind this door cannot read is refused, and the refusal SAYS what it can read', () => {
    // Saying nothing, or saying only "unsupported", would leave the user with no idea what to try. This used to
    // be asserted against a real Gowin `.fs`, which the door refused while the project decoded that format
    // elsewhere; the refusal listed Gowin among the formats that cannot be read here, which was not true of the
    // project and is no longer true of this door either. A chip DESCRIPTION file is the honest stand-in: it is
    // a real file a user is likely to hand over by mistake, and it is not a chip file of any family.
    const notABitstream = identifyBitstream(bytes('icebox-ice40-384-chipdb.txt'))
    expect(notABitstream.ok).toBe(false)
    if (notABitstream.ok) throw new Error('unreachable')
    expect(notABitstream.reason).toContain('iCE40')
    expect(notABitstream.reason).toContain('ECP5')
    expect(notABitstream.reason).toContain('Gowin')
    expect(notABitstream.reason).toContain('.bin')
    expect(notABitstream.reason).toContain('.bit')
    expect(notABitstream.reason).toContain('.fs')
    const junk = identifyBitstream(Uint8Array.from({ length: 64 }, (_, i) => (i * 7 + 1) & 0x7d))
    expect(junk.ok).toBe(false)
  })
})

describe('chip descriptions — the user’s files, sorted by what they contain', () => {
  test('the right iCE40 chip description is used and named', () => {
    const built = buildReferences('ice40', '384', descriptions(ICE40_384))
    expect(built.used).toEqual(ICE40_384)
    expect(built.unused).toEqual([])
    expect(built.references.ice40?.['384']).toBeDefined()
  })

  test('a description of the WRONG chip is refused, naming both chips', () => {
    // The failure this protects against is silent: an iCE40 1k database against a 384 bitstream parses fine and
    // produces a netlist of nonsense.
    const built = buildReferences('ice40', '384', [description('icebox-ice40-1k-chipdb.txt')])
    expect(built.used).toEqual([])
    expect(built.references.ice40?.['384']).toBeUndefined()
    expect(built.unused).toHaveLength(1)
    expect(built.unused[0]?.reason).toContain('1k')
    expect(built.unused[0]?.reason).toContain('384')
  })

  test('ECP5 tile descriptions are matched to the tile kinds this chip really has, longest name first', () => {
    const built = buildReferences('ecp5', 'LFE5U-25F', descriptions(ECP5_25F))
    // CIB_EBR must not be swallowed by the shorter CIB, which shares its prefix.
    expect(built.describedTileKinds).toEqual(['CIB', 'CIB_EBR', 'PLC2'])
    expect(built.unused).toEqual([])
  })

  test('an ECP5 file naming no tile kind of this chip is reported, not quietly ignored', () => {
    const built = buildReferences('ecp5', 'LFE5U-25F', [
      description('trellis-ecp5-LFE5U-25F-tilegrid.json'),
      { name: 'notes-about-my-board.db', text: '# nothing useful' },
    ])
    expect(built.describedTileKinds).toEqual([])
    expect(built.unused.map((u) => u.name)).toEqual(['notes-about-my-board.db'])
  })

  test('without the chip’s tile map nothing can be used, and every file says so', () => {
    const built = buildReferences('ecp5', 'LFE5U-25F', [description('trellis-ecp5-PLC2-bits.db')])
    expect(built.used).toEqual([])
    expect(built.unused).toHaveLength(1)
    expect(built.unused[0]?.reason).toContain('tilegrid.json')
  })
})

describe('openFpgaDesign — a real iCE40 chip file becomes a real circuit', () => {
  const result = openFpgaDesign(bytes('icebox-ice40-384-vendor-xor5.bin'), descriptions(ICE40_384))

  test('it reads, and the counts are the decoder’s own', () => {
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    const loaded = loadBitstream(
      bytes('icebox-ice40-384-vendor-xor5.bin'),
      buildReferences('ice40', '384', descriptions(ICE40_384)).references,
    )
    if (!loaded.ok) throw new Error(loaded.reason)
    const lowered = lowerNetlistToCanvas(loaded.netlist)
    expect(result.report.partCount).toBe(loaded.netlist.cells.length)
    expect(result.report.pieceCount).toBe(lowered.nodes.length)
    expect(result.report.inputCount).toBe(lowered.inputNodes.size)
    expect(result.report.partCount).toBeGreaterThan(0)
    expect(result.report.pieceCount).toBeGreaterThan(result.report.partCount)
  })

  test('the circuit it hands back is a circuit this app can actually open', () => {
    if (!result.ok) throw new Error(result.reason)
    const reopened = deserializeCircuit(JSON.stringify(result.circuit))
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) throw new Error(reopened.reason)
    expect(reopened.file.nodes).toHaveLength(result.circuit.nodes.length)
    expect(reopened.file.wires).toHaveLength(result.circuit.wires.length)
  })

  test('every wire joins the two parts the decoder wired, at the pins it wired them by', () => {
    if (!result.ok) throw new Error(result.reason)
    const loaded = loadBitstream(
      bytes('icebox-ice40-384-vendor-xor5.bin'),
      buildReferences('ice40', '384', descriptions(ICE40_384)).references,
    )
    if (!loaded.ok) throw new Error(loaded.reason)
    const lowered = lowerNetlistToCanvas(loaded.netlist)
    const ids = new Set(result.circuit.nodes.map((node) => node.id))
    expect(result.circuit.wires.length).toBe(lowered.edges.length)
    expect(result.circuit.wires.length).toBeGreaterThan(0)
    result.circuit.wires.forEach((wire, index) => {
      const source = lowered.edges[index]
      // Direction is not decoration: a wire drawn the other way round feeds an output into an output.
      expect(wire.source).toBe(source?.source)
      expect(wire.target).toBe(source?.target)
      expect(wire.sourceHandle).toBe(source?.sourceHandle ?? null)
      expect(wire.targetHandle).toBe(source?.targetHandle ?? null)
      expect(ids.has(wire.source)).toBe(true)
      expect(ids.has(wire.target)).toBe(true)
    })
  })

  test('every wire lands on a pin the part it points at actually has', () => {
    // The lowering builds gates with no pins at all, which the fast logic engine does not need but a canvas
    // does — without the real gate swapped in, every one of these wires points at a handle that is not there
    // and the user is shown a screen of unconnected boxes.
    if (!result.ok) throw new Error(result.reason)
    const byId = new Map(result.circuit.nodes.map((node) => [node.id, node]))
    for (const wire of result.circuit.wires) {
      const target = byId.get(wire.target)
      if (target?.definition !== 'block') continue
      const pins = (target.block?.ports ?? []).map((port) => port.id)
      expect(pins).toContain(wire.targetHandle)
    }
    const sources = result.circuit.wires.filter(
      (wire) => byId.get(wire.source)?.definition === 'block',
    )
    expect(sources.length).toBeGreaterThan(0)
    for (const wire of sources) {
      const pins = (byId.get(wire.source)?.block?.ports ?? []).map((port) => port.id)
      expect(pins).toContain(wire.sourceHandle)
    }
  })

  test('no two gates are drawn overlapping — the app draws one 76 wide and 54 tall', () => {
    // The lowering spaces gates for a graph (12 px apart), not for a screen. At its own scale the recovered
    // design is a stack of gates on top of one another and nothing can be read off it.
    if (!result.ok) throw new Error(result.reason)
    const gates = result.circuit.nodes.filter((node) => node.definition === 'block')
    expect(gates.length).toBeGreaterThan(10)
    for (let i = 0; i < gates.length; i++)
      for (let j = i + 1; j < gates.length; j++) {
        const a = gates[i] as (typeof gates)[number]
        const b = gates[j] as (typeof gates)[number]
        const clear = Math.abs(a.x - b.x) >= 76 || Math.abs(a.y - b.y) >= 54
        if (!clear)
          throw new Error(`${a.id} and ${b.id} overlap at (${a.x}, ${a.y}) / (${b.x}, ${b.y})`)
      }
  })

  test('this design has nothing to declare, and the report claims nothing either', () => {
    if (!result.ok) throw new Error(result.reason)
    expect(result.report.missing).toEqual([])
    expect(result.report.untrusted).toEqual([])
    expect(result.report.incomplete).toEqual([])
    // The tile-kinds note is an ECP5 fact; an iCE40 chip description covers the whole device. What an iCE40
    // report DOES always carry is the count of the chip's own areas this reader does not read — here the four
    // pin areas this file programs — because an empty findings list is not the same as a whole chip read.
    expect(result.report.notes).toHaveLength(1)
    expect(result.report.notes[0]).toContain('4 pin areas')
    expect(result.report.scope).toContain('What was NOT checked')
  })
})

describe('openFpgaDesign — what could not be read reaches the user, per part', () => {
  const ecp5 = (name: string) => openFpgaDesign(bytes(name), descriptions(ECP5_25F))

  test('every untrusted part the decoder found is in the report — none lost on the way', () => {
    for (const name of [
      'trellis-ecp5-ccu2-add4.bit',
      'trellis-ecp5-dpram.bit',
      'trellis-ecp5-widemux.bit',
      'trellis-ecp5-lut-reg.bit',
    ]) {
      const opened = ecp5(name)
      expect(opened.ok).toBe(true)
      if (!opened.ok) throw new Error(opened.reason)
      const built = buildReferences('ecp5', 'LFE5U-25F', descriptions(ECP5_25F))
      const loaded = loadBitstream(bytes(name), built.references)
      if (!loaded.ok) throw new Error(loaded.reason)
      const lowered = lowerNetlistToCanvas(loaded.netlist)
      expect(opened.report.untrusted).toHaveLength(lowered.unfaithful.length)
      expect(opened.report.missing).toHaveLength(lowered.undecoded.length)
      expect(opened.report.incomplete).toHaveLength(lowered.incomplete.length)
      // and the parts named are the same parts, not merely the same count
      expect(opened.report.untrusted.map((line) => line.part).sort()).toEqual(
        lowered.unfaithful
          .map((c) => `the logic part at column ${c.ref.x}, row ${c.ref.y}, position ${c.ref.cell}`)
          .sort(),
      )
    }
  })

  test('the three real kinds of untrusted part each arrive, counted', () => {
    // These counts are the ECP5 decoder's own findings for these committed bitstreams.
    const add4 = ecp5('trellis-ecp5-ccu2-add4.bit')
    const dpram = ecp5('trellis-ecp5-dpram.bit')
    const widemux = ecp5('trellis-ecp5-widemux.bit')
    if (!add4.ok || !dpram.ok || !widemux.ok) throw new Error('a fixture failed to open')
    expect(add4.report.untrusted).toHaveLength(10)
    expect(dpram.report.untrusted).toHaveLength(6)
    expect(widemux.report.untrusted).toHaveLength(10)
    expect(add4.report.untrusted[0]?.reason).toContain('arithmetic')
    expect(dpram.report.untrusted[0]?.reason).toContain('memory')
    expect(widemux.report.untrusted[0]?.reason).toContain('chooser')
  })

  test('a part is named by where it sits, not by an internal key', () => {
    const add4 = ecp5('trellis-ecp5-ccu2-add4.bit')
    if (!add4.ok) throw new Error(add4.reason)
    for (const line of add4.report.untrusted)
      expect(line.part).toMatch(/^the logic part at column \d+, row \d+, position \d+$/)
  })

  test('no unexplained hardware jargon reaches any string the user is shown', () => {
    // The decoders write for someone who knows the silicon; this door is the last place that can be fixed.
    for (const name of [
      'trellis-ecp5-ccu2-add4.bit',
      'trellis-ecp5-dpram.bit',
      'trellis-ecp5-widemux.bit',
    ]) {
      const shown = everyUserString(ecp5(name))
      for (const jargon of ['CCU2', 'DPRAM', 'RAMW', '_SLICE', 'MODE ', 'lookup table XOR'])
        expect(shown).not.toContain(jargon)
    }
  })

  test('a clean design says so, rather than leaving the user to infer it', () => {
    const clean = ecp5('trellis-ecp5-lut-reg.bit')
    if (!clean.ok) throw new Error(clean.reason)
    expect(clean.report.untrusted).toEqual([])
    expect(clean.report.missing).toEqual([])
    expect(clean.report.incomplete).toEqual([])
  })

  test('what the reading was bounded by is stated, naming the tile kinds described', () => {
    const opened = ecp5('trellis-ecp5-lut-reg.bit')
    if (!opened.ok) throw new Error(opened.reason)
    expect(opened.report.notes).toHaveLength(1)
    // A list a person would say out loud — "a, b and c", not "a, b, c" — and the count agreeing with it.
    expect(opened.report.notes[0]).toContain('3 kinds of place')
    expect(opened.report.notes[0]).toContain('CIB, CIB_EBR and PLC2')
  })
})

describe('openFpgaDesign — refusals that tell the user what to do next', () => {
  test('with no chip description at all it names the exact file to find', () => {
    const opened = openFpgaDesign(bytes('icebox-ice40-384-vendor-xor5.bin'), [])
    expect(opened.ok).toBe(false)
    if (opened.ok) throw new Error('unreachable')
    expect(opened.reason).toContain('chipdb-384.txt')
    expect(opened.reason).toContain('Project IceStorm')
  })

  test('with the WRONG chip description it says which file was passed over, and why', () => {
    const opened = openFpgaDesign(bytes('icebox-ice40-384-vendor-xor5.bin'), [
      description('icebox-ice40-1k-chipdb.txt'),
    ])
    expect(opened.ok).toBe(false)
    if (opened.ok) throw new Error('unreachable')
    expect(opened.reason).toContain('icebox-ice40-1k-chipdb.txt')
    expect(opened.reason).toContain('Lattice iCE40 1k')
    expect(opened.reason).toContain('chipdb-384.txt')
  })

  test('an ECP5 chip file without the logic-tile description is refused, not crashed', () => {
    // reconstructEcp5Netlist dereferences dbFor('PLC2') with a non-null cast, so letting this through throws
    // "Cannot read properties of null" out of a menu click.
    const opened = openFpgaDesign(bytes('trellis-ecp5-ccu2-add4.bit'), [
      description('trellis-ecp5-LFE5U-25F-tilegrid.json'),
    ])
    expect(opened.ok).toBe(false)
    if (opened.ok) throw new Error('unreachable')
    expect(opened.reason).toContain('PLC2')
    expect(opened.reason).not.toContain('Cannot read properties')
  })

  test('a damaged file is read but the damage is SAID, not passed off as sound', () => {
    // One flipped byte in a genuine bitstream: it still parses and still names its chip, and its own checksum
    // no longer matches. Showing the recovered design without saying so is the quiet lie this catches.
    const damaged = bytes('icebox-ice40-384-vendor-xor5.bin')
    const spot = Math.floor(damaged.length / 2)
    damaged[spot] = (damaged[spot] as number) ^ 0x01
    const opened = openFpgaDesign(damaged, descriptions(ICE40_384))
    expect(opened.ok).toBe(true)
    if (!opened.ok) throw new Error(opened.reason)
    expect(opened.report.notes.some((note) => note.includes('checksum'))).toBe(true)
  })

  test('the ask names the chip the file itself declares', () => {
    expect(chipDescriptionRequest('ice40', '8k')).toContain('chipdb-8k.txt')
    expect(chipDescriptionRequest('ecp5', 'LFE5U-45F')).toContain('tilegrid.json')
    expect(chipName('ice40', '5k')).toBe('Lattice iCE40 5k')
    expect(chipName('ecp5', 'LFE5U-25F')).toBe('Lattice LFE5U-25F')
  })
})

describe('plainEnglish — restated where it can be, verbatim where it cannot', () => {
  test('a caveat this door has never seen is passed through WORD FOR WORD', () => {
    // The one behaviour that keeps a future decoder change from silently muting a warning.
    const invented = 'the frobnicator bit could not be read from this tile'
    expect(plainEnglish(invented)).toBe(invented)
  })

  test('several caveats about one part are each restated, none dropped', () => {
    const joined =
      'arithmetic (CCU2) slice: the hardware output is combined with the carry; also: the frobnicator bit could not be read'
    const said = plainEnglish(joined)
    expect(said).toContain('arithmetic')
    expect(said).not.toContain('CCU2')
    expect(said).toContain('frobnicator')
  })
})

describe('fpgaReportFor — all three kinds of caveat cross into the report', () => {
  // The ECP5 and iCE40 files this door reads produce only the "untrusted" kind, so the other two fields would
  // otherwise be assignments no test ever looks at. The Gowin decoder produces all three on a real bitstream,
  // so its lowered design is what proves the report carries every kind. These build the lowered design by hand
  // to reach `fpgaReportFor` on its own; the same files going through the whole door are in
  // `tests/fpga-gowin-door.test.ts`.
  const gowinLowered = (name: string) => {
    const db = parseGowinChipdb(
      readFileSync(new URL('../fixtures/gowin-gw1n1-chipdb.json', import.meta.url), 'utf8'),
    )
    const design = reconstructGowinNetlist(
      parseGowinBitstream(
        readFileSync(new URL(`../fixtures/gowin-gw1n1-${name}.fs`, import.meta.url), 'utf8'),
      ).frames,
      db,
      parseGowinPipDatabase(
        readFileSync(new URL('../fixtures/gowin-gw1n1-pips.json', import.meta.url), 'utf8'),
      ),
      parseGowinAttributeDatabase(
        readFileSync(new URL('../fixtures/gowin-gw1n1-attributes.json', import.meta.url), 'utf8'),
      ),
      new Map([
        ...parseGowinWireAliases(
          readFileSync(new URL('../fixtures/gowin-gw1n1-nodes.json', import.meta.url), 'utf8'),
        ),
        ...gowinFixedAliases(db.rows, db.cols),
      ]),
    )
    return { design, lowered: lowerNetlistToCanvas(design.netlist) }
  }

  const reportOf = (name: string) => {
    const { design, lowered } = gowinLowered(name)
    return {
      design,
      report: fpgaReportFor(lowered, {
        family: 'ice40',
        device: '384',
        form: 'binary',
        partCount: design.netlist.cells.length,
        notes: [],
        scope: 'what was checked, and what was not',
      }),
    }
  }

  test('parts that could not be read at all arrive, and so do the parts that READ them', () => {
    // `adder4` produces both at once: its cells are switched into arithmetic mode, which this path will not
    // describe, and the parts that READ those cells are handed an invented input in their place. Flagging only
    // the refused cells is what left the wrong parts looking ordinary, so the report must carry the second
    // list as well as the first.
    const { design, report } = reportOf('adder4')
    expect(design.unsupported.length).toBeGreaterThan(0)
    expect(design.distrusted.length).toBeGreaterThan(0)
    expect(report.missing).toHaveLength(design.unsupported.length)
    expect(report.untrusted).toHaveLength(design.distrusted.length)
    // and every one of those parts carries a marking that travels onto the canvas with it
    for (const listed of design.distrusted)
      expect(report.markings.get(`${listed.ref.x}_${listed.ref.y}_${listed.ref.cell}`)).toBeTruthy()
  })

  test('parts with something left out arrive', () => {
    const { design, report } = reportOf('splitkeep')
    expect(design.partial.length).toBeGreaterThan(0)
    expect(report.incomplete).toHaveLength(design.partial.length)
  })

  test('every line names its part the same way, in words', () => {
    for (const name of ['adder4', 'splitkeep']) {
      const { report } = reportOf(name)
      for (const line of [...report.missing, ...report.incomplete, ...report.untrusted]) {
        expect(line.part).toMatch(/^the logic part at column \d+, row \d+, position \d+$/)
        expect(line.reason.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('loweredToCircuitFile — the lowered canvas, whole', () => {
  test('every node and every wire crosses over, keeping its parts', () => {
    const built = buildReferences('ecp5', 'LFE5U-25F', descriptions(ECP5_25F))
    const loaded = loadBitstream(bytes('trellis-ecp5-widemux.bit'), built.references)
    if (!loaded.ok) throw new Error(loaded.reason)
    const lowered = lowerNetlistToCanvas(loaded.netlist)
    const circuit = loweredToCircuitFile(lowered)
    expect(circuit.nodes).toHaveLength(lowered.nodes.length)
    expect(circuit.wires).toHaveLength(lowered.edges.length)
    // The gates must survive as gates: a block node stripped of its block is an empty box on the canvas.
    const blocks = circuit.nodes.filter((node) => node.definition === 'block')
    expect(blocks.length).toBeGreaterThan(0)
    for (const node of blocks) expect(node.block?.name).toBeTruthy()
    // …and the power sources must keep the voltage that makes them a 0 or a 1.
    const sources = circuit.nodes.filter((node) => node.definition === 'power_source')
    expect(sources.length).toBeGreaterThan(0)
    for (const node of sources) expect(node.parameters?.nominal_voltage).toBeDefined()
  })
})
