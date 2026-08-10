/**
 * The Gowin half of the chip-file door (src/renderer/fpga-open.ts + fpga-load.ts).
 *
 * The project has decoded Gowin bitstreams for longer and more thoroughly than either Lattice family — the
 * container, the lookup tables, the flip-flops including the falling-edge ones, the routing, the package pinout
 * — and none of it was reachable from the app. The door decided a file's family by scanning for a BINARY sync
 * pattern, and a Gowin `.fs` is a text file with no such pattern anywhere in it, so every one of them fell
 * through to a refusal whose own words listed "Gowin .fs" among the formats that cannot be read here. That
 * refusal is what the project lead hit.
 *
 * So everything below runs on the REAL `.fs` bitstreams and the REAL converted Apicula chip description in
 * `fixtures/` — twelve files built by yosys + nextpnr-himbaechel + gowin_pack — and asks the door for a circuit,
 * not merely for a different refusal. The counts are the counts those files actually produce.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { deserializeCircuit } from '../src/renderer/circuit-file.ts'
import { parseGowinAttributeDatabase } from '../src/renderer/fpga-apicula-attributes.ts'
import { parseGowinChipdb } from '../src/renderer/fpga-apicula-chipdb.ts'
import { readGowinFsHeader } from '../src/renderer/fpga-apicula-fs.ts'
import { gowinFixedAliases, parseGowinWireAliases } from '../src/renderer/fpga-apicula-netlist.ts'
import { parseGowinPipDatabase } from '../src/renderer/fpga-apicula-routing.ts'
import { detectBitstreamFamily, loadBitstream } from '../src/renderer/fpga-load.ts'
import {
  type ChipDescriptionFile,
  identifyBitstream,
  openFpgaDesign,
} from '../src/renderer/fpga-open.ts'

const at = (name: string): URL => new URL(`../fixtures/${name}`, import.meta.url)
const bytes = (name: string): Uint8Array => new Uint8Array(readFileSync(at(name)))
const description = (name: string): ChipDescriptionFile => ({
  name,
  text: readFileSync(at(name), 'utf8'),
})

/** The four files that describe a GW1N-1, as a user would pick them all at once. */
const GW1N1 = [
  'gowin-gw1n1-chipdb.json',
  'gowin-gw1n1-pips.json',
  'gowin-gw1n1-attributes.json',
  'gowin-gw1n1-nodes.json',
].map(description)

/** Every Gowin bitstream committed to this repository. */
const DESIGNS = [
  'adder16',
  'adder4',
  'bram1k',
  'bramlogic',
  'dense',
  'ffvariants',
  'mixedreg',
  'pairmix',
  'splitkeep',
  'splitmix',
  'splitout',
  'splitpad',
  'xnor-dff',
  // The WIDE MULTIPLEXER designs. Every list above them was built with `-nowidelut`, so until these arrived
  // no bitstream carrying a wide multiplexer had ever walked through this door — which is where the user
  // actually reads what was found, and where a part that lives at no position on the silicon gets named.
  'widemux',
  'widemux-narrow',
  'mux8',
  'muxreg',
  'muxsel',
  'muxconst',
  'muxzero',
  'muxvcc',
  'muxlatch',
  // The four the list claimed to include and did not, added so the claim above is true. `blkselhide` is the
  // one that matters most here: a real block memory whose main tile decodes to nothing, which walked through
  // this door reporting nothing missing at all.
  'blkselhide',
  'longwire',
  'longwiremux',
  'passlut',
] as const

const openGowin = (name: string, files: readonly ChipDescriptionFile[] = GW1N1) =>
  openFpgaDesign(bytes(`gowin-gw1n1-${name}.fs`), files)

const readGowin = (name: string) => {
  const result = openGowin(name)
  if (!result.ok) throw new Error(`${name}: ${result.reason}`)
  return result
}

/**
 * A Gowin `.fs` header, built by hand: three preamble lines, the chip-number record, the frame count.
 *
 * Hand-built because no real file can be made to carry a chip number this project does not know, or to leave out
 * one of the two records — and those are the cases where a detector guesses instead of refusing.
 */
const header = (idcode: number): Uint8Array => {
  const bitsOf = (record: readonly number[]): string =>
    record.map((byte) => byte.toString(2).padStart(8, '0')).join('')
  return new TextEncoder().encode(
    [
      bitsOf([0xff, 0xff]),
      bitsOf([0xff, 0xff]),
      bitsOf([0xa5, 0xc3]),
      bitsOf([
        0x06,
        0,
        0,
        0,
        (idcode >>> 24) & 0xff,
        (idcode >>> 16) & 0xff,
        (idcode >>> 8) & 0xff,
        idcode & 0xff,
      ]),
      bitsOf([0x3b, 0x80, 0x01, 0x14]),
    ].join('\n'),
  )
}

/** Every word this door shows a user about one file, so one check can look at all of it. */
const everyUserString = (result: ReturnType<typeof openFpgaDesign>): string => {
  if (!result.ok) return result.reason
  const { report } = result
  return [
    report.scope,
    ...report.notes,
    ...report.missing.flatMap((line) => [line.part, line.reason]),
    ...report.untrusted.flatMap((line) => [line.part, line.reason]),
    ...report.incomplete.flatMap((line) => [line.part, line.reason]),
    ...report.markings.values(),
  ].join(' ')
}

describe('a Gowin .fs is recognised as one, from the file itself', () => {
  test('every committed Gowin bitstream names its chip, with no chip description held', () => {
    for (const name of DESIGNS)
      expect(identifyBitstream(bytes(`gowin-gw1n1-${name}.fs`)), name).toEqual({
        ok: true,
        family: 'gowin',
        device: 'GW1N-1',
        form: 'text',
      })
  })

  test('the programmatic door agrees with the one a person walks through', () => {
    for (const name of DESIGNS)
      expect(detectBitstreamFamily(bytes(`gowin-gw1n1-${name}.fs`)), name).toBe('gowin')
  })

  test('the other families are not mistaken for it', () => {
    expect(detectBitstreamFamily(bytes('icebox-ice40-384-vendor-xor5.bin'))).toBe('ice40')
    expect(detectBitstreamFamily(bytes('trellis-ecp5-lut-reg.bit'))).toBe('ecp5')
    // The iCE40 TEXT form is the dangerous one: it too is lines of ones and zeros with no marker in it.
    expect(identifyBitstream(bytes('icebox-ice40-384-dense.asc'))).toEqual({
      ok: true,
      family: 'ice40',
      device: '384',
      form: 'text',
    })
    expect(
      readGowinFsHeader(readFileSync(at('icebox-ice40-384-dense.asc'), 'utf8')),
      'an IceStorm text chip file is not a Gowin one',
    ).toBeNull()
  })

  test('the chip descriptions themselves are not mistaken for chip files', () => {
    // A user picking the wrong file at the wrong step is ordinary, and each of these is a file this same flow
    // asks them for elsewhere.
    for (const name of [
      'gowin-gw1n1-chipdb.json',
      'gowin-gw1n1-pips.json',
      'gowin-gw1n1-attributes.json',
      'gowin-gw1n1-nodes.json',
      'gowin-gw1n1-pinout.json',
      'icebox-ice40-384-chipdb.txt',
      'trellis-ecp5-PLC2-bits.db',
      'trellis-ecp5-LFE5U-25F-tilegrid.json',
    ] as const)
      expect(detectBitstreamFamily(bytes(name)), name).toBeNull()
  })

  test('a file whose lines are not whole bytes is not a Gowin chip file', () => {
    // The format is bytes: Apicula reads every line eight characters at a time. Measured across all twelve
    // bitstreams above, every line of every one of them divides by eight — so a line that does not is enough
    // to say a file is not one, and it is what keeps text of the wrong shape out.
    const real = readFileSync(at('gowin-gw1n1-splitmix.fs'), 'utf8')
    expect(readGowinFsHeader(real)?.device?.name).toBe('GW1N-1')
    const lines = real.split('\n')
    const first = lines[0] as string
    expect(readGowinFsHeader([first.slice(1), ...lines.slice(1)].join('\n'))).toBeNull()
  })

  test('a Gowin file naming a chip we do not know says so, and guesses at nothing', () => {
    // the same header shape carrying a real GW1N-1's number is recognised, so the check below is not vacuous
    expect(identifyBitstream(header(0x0900281b))).toEqual({
      ok: true,
      family: 'gowin',
      device: 'GW1N-1',
      form: 'text',
    })
    const unknown = identifyBitstream(header(0xdeadbeef))
    expect(unknown.ok).toBe(false)
    if (unknown.ok) throw new Error('unreachable')
    expect(unknown.reason).toContain('Gowin')
    expect(unknown.reason).toContain('DEADBEEF')
    expect(unknown.reason).not.toContain('0x')
  })

  test('both header records are needed — one of them alone is not a Gowin chip file', () => {
    // A Gowin file says which chip it is for AND how many frames follow, and the second record is what ends its
    // header. Demanding both is what makes this test specific enough to run on a file that carries no marker at
    // all: rows of ones and zeros on their own are not evidence of anything.
    const full = header(0x0900281b).slice()
    const lines = new TextDecoder().decode(full).split('\n')
    expect(readGowinFsHeader(lines.join('\n'))?.device?.name).toBe('GW1N-1')
    const encode = (text: string): Uint8Array => new TextEncoder().encode(text)
    // the chip-number record, with no frame count after it
    expect(readGowinFsHeader(lines.slice(0, -1).join('\n'))).toBeNull()
    expect(identifyBitstream(encode(lines.slice(0, -1).join('\n'))).ok).toBe(false)
    // the frame count, with no chip number before it
    const noIdcode = [...lines.slice(0, 3), lines[4] as string].join('\n')
    expect(readGowinFsHeader(noIdcode)).toBeNull()
    const identity = identifyBitstream(encode(noIdcode))
    expect(identity.ok).toBe(false)
    if (identity.ok) throw new Error('unreachable')
    expect(
      identity.reason,
      'and it must not claim to be a Gowin file of an unknown chip',
    ).not.toContain('Gowin chip file')
  })
})

describe('a Gowin design comes back with parts on it', () => {
  test('every committed bitstream produces a circuit, not a refusal', () => {
    for (const name of DESIGNS) {
      const result = readGowin(name)
      expect(result.report.partCount, name).toBeGreaterThan(0)
      expect(result.circuit.nodes.length, name).toBeGreaterThan(0)
      expect(result.report.family, name).toBe('gowin')
      expect(result.report.device, name).toBe('GW1N-1')
    }
  })

  test('the counts three real designs produce', () => {
    // Pinned so a change that starts losing parts fails here. `dense` is the biggest bitstream on hand.
    //
    // The part counts have never moved. The NODE counts fell — `dense` by 231, `pairmix` by 12 — when the
    // long-wire and power-up-arc connections started being followed: every chip input this reader invents is
    // an extra switch node on the canvas, and `dense` was showing 236 of them for a source that declares six
    // ports. Each fall is exactly the fall in that design's chip inputs — 236 to 5, and 17 to 5 — so no part
    // and no wire was lost with them; `dense` draws the same 32,070 wires it always did.
    const dense = readGowin('dense')
    expect(dense.report.partCount).toBe(729)
    expect(dense.circuit.nodes).toHaveLength(17688)
    expect(dense.circuit.wires).toHaveLength(32070)
    const pairmix = readGowin('pairmix')
    expect(pairmix.report.partCount).toBe(161)
    expect(pairmix.circuit.nodes).toHaveLength(3796)
    const xnor = readGowin('xnor-dff')
    expect(xnor.report.partCount).toBe(1)
    expect(xnor.report.inputCount).toBe(2)
  })

  test('the circuit is a real one: every wire joins two parts that exist', () => {
    const { circuit } = readGowin('splitkeep')
    const ids = new Set(circuit.nodes.map((node) => node.id))
    for (const wire of circuit.wires) {
      expect(ids.has(wire.source), wire.id).toBe(true)
      expect(ids.has(wire.target), wire.id).toBe(true)
    }
    for (const node of circuit.nodes) expect(node.definition.length).toBeGreaterThan(0)
  })

  test('the circuit survives being saved and opened again', () => {
    const { circuit } = readGowin('splitmix')
    const reopened = deserializeCircuit(JSON.stringify(circuit))
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) throw new Error(reopened.reason)
    expect(reopened.file.nodes).toHaveLength(circuit.nodes.length)
    expect(reopened.file.wires).toHaveLength(circuit.wires.length)
  })

  test('the programmatic door returns a netlist too, with the file’s own checksum verified', () => {
    const fabric = parseGowinChipdb(readFileSync(at('gowin-gw1n1-chipdb.json'), 'utf8'))
    const loaded = loadBitstream(bytes('gowin-gw1n1-pairmix.fs'), {
      gowin: {
        'GW1N-1': {
          fabric,
          pips: parseGowinPipDatabase(readFileSync(at('gowin-gw1n1-pips.json'), 'utf8')),
          attributes: parseGowinAttributeDatabase(
            readFileSync(at('gowin-gw1n1-attributes.json'), 'utf8'),
          ),
          aliases: new Map([
            ...parseGowinWireAliases(readFileSync(at('gowin-gw1n1-nodes.json'), 'utf8')),
            ...gowinFixedAliases(fabric.rows, fabric.cols),
          ]),
        },
      },
    })
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) throw new Error(loaded.reason)
    expect(loaded.family).toBe('gowin')
    expect(loaded.device).toBe('GW1N-1')
    expect(loaded.crcOk).toBe(true)
    expect(loaded.netlist.cells).toHaveLength(161)
  })

  test('with no chip database at all it refuses rather than reading half a chip', () => {
    const loaded = loadBitstream(bytes('gowin-gw1n1-pairmix.fs'))
    expect(loaded.ok).toBe(false)
    if (loaded.ok) throw new Error('unreachable')
    expect(loaded.reason).toContain('GW1N-1')
  })
})

describe('all three lists of what could not be stood behind now fill', () => {
  // The blocking finding this work exists for: two of the card's three lists were fed ONLY from the Gowin
  // decoder, and the door refused every Gowin file, so they could never appear. Each is now a real file.
  //
  // The designs chosen here are the ones whose findings come from what the SILICON is doing — a cell switched
  // into arithmetic mode, a cell holding a see-through latch, a cell whose flip-flop nothing in the recovered
  // design reads. Those verdicts belong to the hardware and do not move.
  test('parts that are not on the canvas at all', () => {
    expect(readGowin('adder4').report.missing).toHaveLength(6)
    expect(readGowin('adder16').report.missing).toHaveLength(18)
    expect(readGowin('mixedreg').report.missing).toHaveLength(2)
  })

  test('parts on the canvas whose value must not be trusted', () => {
    expect(readGowin('adder4').report.untrusted).toHaveLength(4)
    expect(readGowin('adder16').report.untrusted).toHaveLength(16)
  })

  test('parts on the canvas with something left out', () => {
    expect(readGowin('splitkeep').report.incomplete).toHaveLength(2)
  })

  test('a design with nothing to declare declares nothing', () => {
    // `bram1k` USED TO BE ON THIS LIST. It is a design built around a block memory, and the door said nothing
    // at all about it while offering the memory's eight data outputs as switches the chip does not have — so
    // this test was pinning the defect as correct behaviour. It is now covered by the two tests below.
    for (const name of ['pairmix', 'dense', 'splitpad', 'xnor-dff', 'ffvariants'] as const) {
      const { report } = readGowin(name)
      expect([report.missing, report.untrusted, report.incomplete].flat(), name).toEqual([])
    }
  })

  // Three of the four block-memory sites of a GW1N-1, chosen by the placer rather than by us. `bram1k` is one
  // eight-bit-wide memory; `bramlogic` is TWO four-bit-wide ones, so it also says what happens when a file
  // programs more than one.
  //
  // The reader count follows the width: each data bit is captured by a register and then chosen between by a
  // lookup table, so eight bits give sixteen readers and two four-bit memories give twelve — the four extra
  // readers a third memory would need are the two lookup tables computing `y` and `z`, which read no memory
  // and are correctly left unmarked.
  for (const [name, places, readers] of [
    ['bram1k', ['the block memory at column 1, row 5'], 16],
    [
      'bramlogic',
      ['the block memory at column 4, row 5', 'the block memory at column 13, row 5'],
      12,
    ],
  ] as const)
    test(`${name}: every block memory is named as absent, and every part reading one is marked`, () => {
      const { report } = readGowin(name)
      expect(report.missing.map((line) => line.part)).toEqual([...places])
      for (const line of report.missing)
        expect(line.reason).toContain('a bank of memory built into the chip')
      expect(report.untrusted).toHaveLength(readers)
      for (const line of report.untrusted)
        expect(line.reason).toContain('a value read out of a block memory')
      // and each of them carries that warning ON the part, not only in the list
      expect(report.markings.size).toBe(readers)
    })

  test('blkselhide: the memory the door could not see is named, and nothing is invented for it', () => {
    // What the user is shown for the design this whole change is for. Before it, this file walked through the
    // door with an empty card — nothing missing, nothing untrusted, nothing incomplete — and eight switches on
    // the canvas that the chip does not have. nextpnr placed the memory at `X4Y5/BSRAM`, which is column 4,
    // row 5.
    const { report } = readGowin('blkselhide')
    expect(report.missing.map((line) => line.part)).toEqual(['the block memory at column 4, row 5'])
    expect(report.untrusted).toHaveLength(20)
    // sixteen read it directly and say so; four are further away and say THAT
    const direct = report.untrusted.filter((line) =>
      line.reason.includes('a value read out of a block memory'),
    )
    const downstream = report.untrusted.filter((line) =>
      line.reason.includes('worked out from another part that is not to be trusted'),
    )
    expect([direct.length, downstream.length]).toEqual([16, 4])
    expect(report.markings.size).toBe(20)
    // and the card's own words are true of this file: no switch was offered for the memory's outputs
    expect(report.scope).toContain('those wires are not offered as switches')
  })

  test('every listed part carries its warning on the canvas, as the card says it does', () => {
    // The card counts the untrusted and incomplete parts and tells the user they are marked with a ⚠. Before
    // this, the decoder's own "something is left out" findings were listed and marked nowhere, so opening
    // `splitkeep` made the card say two parts were marked when none was.
    for (const name of DESIGNS) {
      const result = readGowin(name)
      const listed = result.report.untrusted.length + result.report.incomplete.length
      if (listed === 0) continue
      expect(result.report.markings.size, name).toBe(listed)
      const marked = result.circuit.nodes.filter((node) => node.caveat)
      expect(marked.length, name).toBeGreaterThan(0)
      for (const node of marked) expect(node.caveat).toContain('read from a chip file')
    }
  })

  test('every one of the three lists is filled by some real file, none of them unreachable', () => {
    // Stated as a whole, and over the WHOLE corpus, because that is the finding: two of these three could not
    // appear at all while the door refused every Gowin file, whichever design it was.
    const filled = { missing: 0, untrusted: 0, incomplete: 0 }
    for (const name of DESIGNS) {
      const { report } = readGowin(name)
      filled.missing += report.missing.length
      filled.untrusted += report.untrusted.length
      filled.incomplete += report.incomplete.length
    }
    expect(filled.missing).toBeGreaterThan(0)
    expect(filled.untrusted).toBeGreaterThan(0)
    expect(filled.incomplete).toBeGreaterThan(0)
  })

  test('a refused part is named by where it sits, in words, and its reason is plain', () => {
    const { report } = readGowin('adder4')
    for (const line of [...report.missing, ...report.untrusted])
      expect(line.part).toMatch(/^the logic part at column \d+, row \d+, position \d+$/)
    expect(report.missing.map((line) => line.reason).join(' ')).toContain('doing arithmetic')
    expect(
      readGowin('mixedreg')
        .report.missing.map((line) => line.reason)
        .join(' '),
    ).toContain('while its control is on it simply passes its input through')
  })

  test('a wide multiplexer is named as a place on the chip, not as a position that has none', () => {
    // A Gowin slice holds eight lookup tables, so its positions stop at 7. This decode gives a wide
    // multiplexer a position of 16 or more so its recovered part cannot collide with a real one — and the
    // card used to print that number straight out, telling a user to look at "position 16" on a chip that
    // has no such place. The sentence is the only thing they have to act on, so it has to name somewhere.
    const { report } = readGowin('muxlatch')
    const named = [...report.missing, ...report.untrusted].map((line) => line.part)
    expect(named).toContain('the wide multiplexer above the logic parts at column 8, row 7')
    expect(named).toContain('the logic part at column 8, row 7, position 0')
    for (const line of [...report.missing, ...report.untrusted, ...report.incomplete])
      expect(line.part, line.part).not.toMatch(/position (?:8|9|1\d|2\d)$/)

    // and the reason the reader is given says what it lost, in the same words
    const untrusted = report.untrusted.map((line) => line.reason).join(' ')
    expect(untrusted).toContain('wide multiplexer that could not be read')
    expect(untrusted).toContain('the wide multiplexer above the logic parts at column 8, row 7')
  })

  test('a wide-multiplexer design that reads correctly gets a report with nothing in it', () => {
    // The other direction, and the one the over-refusal broke twice: `muxconst` — an ordinary multiplexer
    // with one choice tied to a constant — was refused outright, its reader marked untrustworthy, and a chip
    // input invented in its place. A correct read has to come back clean, or the warnings mean nothing.
    for (const name of ['widemux', 'mux8', 'muxconst', 'muxzero', 'muxvcc'] as const) {
      const { report } = readGowin(name)
      expect([report.missing, report.untrusted].flat(), name).toEqual([])
    }
  })

  test('no unexplained hardware jargon, and no raw numbers, reach the user', () => {
    for (const name of DESIGNS) {
      const shown = everyUserString(openGowin(name))
      for (const jargon of [
        'lookup table XOR',
        'level-sensitive',
        'edge-triggered',
        'LUT',
        'DFF',
        'pip',
        '0x',
      ])
        expect(shown, `${name}: ${jargon}`).not.toContain(jargon)
    }
  })

  test('what was NOT read is stated on every report, findings or none', () => {
    for (const name of DESIGNS) {
      const { report } = readGowin(name)
      expect(report.scope, name).toContain('What was NOT checked')
      expect(report.scope, name).toContain('block memories')
      // and it must not overclaim: nobody has audited this reader against what it leaves out
      expect(report.scope, name).toContain('has this reader been examined')
    }
  })
})

describe('a missing chip description says which part of it is missing', () => {
  const without = (name: string) => GW1N1.filter((file) => file.name !== name)

  test('each of the four is named when it is the one that is absent', () => {
    for (const [file, said] of [
      ['gowin-gw1n1-chipdb.json', 'what the chip is made of'],
      ['gowin-gw1n1-pips.json', 'the switches the chip’s wiring is made of'],
      ['gowin-gw1n1-attributes.json', 'what the chip’s own settings mean'],
      ['gowin-gw1n1-nodes.json', 'which differently-named wires are the same piece of copper'],
    ] as const) {
      const result = openGowin('splitmix', without(file))
      expect(result.ok, file).toBe(false)
      if (result.ok) throw new Error('unreachable')
      expect(result.needsDescription, file).toBe(true)
      expect(result.reason, file).toContain(`What is still missing is the file that says ${said}`)
      expect(result.reason, file).toContain('Gowin GW1N-1')
    }
  })

  test('with none of them it asks for all four, and does not pretend one is missing', () => {
    const result = openGowin('splitmix', [])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.needsDescription).toBe(true)
    expect(result.reason).not.toContain('What is still missing is the file')
    expect(result.reason).toContain('four files')
    expect(result.reason).toContain('"fixtures" folder')
  })

  test('a file that is none of the four is reported, not silently ignored', () => {
    const result = openGowin('adder4', [
      ...GW1N1,
      description('gowin-gw1n1-pinout.json'),
      description('trellis-ecp5-LFE5U-25F-tilegrid.json'),
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect(result.report.notes.join(' ')).toContain('gowin-gw1n1-pinout.json')
    expect(result.report.notes.join(' ')).toContain('trellis-ecp5-LFE5U-25F-tilegrid.json')
    expect(result.report.notes.join(' ')).toContain('none of the four files')
    // and the design is still read — an extra file is not a reason to refuse one
    expect(result.report.partCount).toBe(4)
  })

  test('a JSON file that merely names a chip is not taken for the chip description', () => {
    // Naming a chip is not describing one, and plenty of files name one. The fabric file is recognised by
    // holding a tile grid as well; without that demand, any JSON with a "device" in it would be loaded as the
    // description of the chip and then fail somewhere further in.
    const result = openGowin('splitmix', [
      ...GW1N1.filter((file) => file.name !== 'gowin-gw1n1-chipdb.json'),
      { name: 'names-a-chip.json', text: '{"device":"GW1N-1","note":"not a description"}' },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toContain('none of the four files')
    expect(result.reason).toContain(
      'What is still missing is the file that says what the chip is made of',
    )
  })

  test('a description of a DIFFERENT Gowin chip is refused, and named', () => {
    // The real GW1N-1 description with the chip it describes changed. Loading it would decode this file's bits
    // against another part's geometry, which produces a design rather than an error — the worst kind of wrong.
    const wrongChip = {
      name: 'gowin-gw1n9-chipdb.json',
      text: (readFileSync(at('gowin-gw1n1-chipdb.json'), 'utf8') as string).replace(
        '"device":"GW1N-1"',
        '"device":"GW1N-9"',
      ),
    }
    expect(wrongChip.text, 'the substitution must have happened').toContain('GW1N-9')
    const result = openGowin('splitmix', [
      ...GW1N1.filter((file) => file.name !== 'gowin-gw1n1-chipdb.json'),
      wrongChip,
    ])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toContain('this describes a Gowin GW1N-9 chip')
    expect(result.reason).toContain('the file you opened is for a Gowin GW1N-1')
  })

  test('the same file chosen twice is reported once and does not displace the first', () => {
    const result = openGowin('adder4', [...GW1N1, description('gowin-gw1n1-pips.json')])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect(result.report.notes.join(' ')).toContain('already said')
    expect(result.report.partCount).toBe(4)
  })
})
