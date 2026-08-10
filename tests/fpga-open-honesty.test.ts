/**
 * The FPGA chip-file door, held to the project's first rule: never tell the user something that is not so.
 *
 * Two independent reviews of this door found that it did — it offered a file type no reader existed for, called
 * a read that recovered nothing a success while replacing the user's work with an empty canvas, showed a
 * warning that vanished with the card it was printed on, and named the wrong chip family for a file it could
 * not read. Each test below is one of those, written against a real file rather than a mock, so the claim and
 * the thing it is a claim about are checked together.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { deserializeCircuit, serializeCircuit } from '../src/renderer/circuit-file.ts'
import {
  type ChipDescriptionFile,
  identifyBitstream,
  openFpgaDesign,
} from '../src/renderer/fpga-open.ts'

const bytes = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)))
const text = (name: string): string =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')
const chipdb = (device: string): ChipDescriptionFile[] => [
  { name: `chipdb-${device}.txt`, text: text(`icebox-ice40-${device}-chipdb.txt`) },
]

const opened = (name: string, device: string) => {
  const result = openFpgaDesign(bytes(name), chipdb(device))
  if (!result.ok) throw new Error(result.reason)
  return result
}

describe('a read that recovered nothing is not a success', () => {
  test('a chip file with no logic in it is refused, so nothing on the canvas is replaced', () => {
    // A real committed iCE40 file with a single configuration bit set: it parses, it names its chip, and it
    // holds no logic. It used to produce "0 logic parts recovered" in green over an emptied canvas.
    const result = openFpgaDesign(bytes('icebox-ice40-384-onebit.bin'), chipdb('384'))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result).not.toHaveProperty('circuit')
    expect(result.reason).toContain('no logic parts were found')
    expect(result.reason).toContain('left exactly as it was')
    // …and it must not offer the "choose a chip description" button: the description was fine.
    expect(result.needsDescription).toBeUndefined()
  })

  test('the button to go and find a chip description is offered only when that is the problem', () => {
    const noDescription = openFpgaDesign(bytes('icebox-ice40-384-vendor-xor5.bin'), [])
    expect(noDescription.ok).toBe(false)
    if (noDescription.ok) throw new Error('unreachable')
    expect(noDescription.needsDescription).toBe(true)
  })
})

describe('a warning that outlives the card it arrived on', () => {
  const blockram = opened('icebox-ice40-1k-blockram.bin', '1k')

  test('the parts the report warns about carry the warning themselves', () => {
    expect(blockram.report.markings.size).toBeGreaterThan(0)
    const marked = blockram.circuit.nodes.filter((node) => node.caveat)
    expect(marked.length).toBeGreaterThan(0)
    for (const node of marked) expect(node.caveat).toContain('read from a chip file')
  })

  test('a part with nothing wrong with it stays unmarked', () => {
    const unmarked = blockram.circuit.nodes.filter((node) => !node.caveat)
    expect(unmarked.length).toBeGreaterThan(0)
  })

  test('the warning survives being saved and opened again', () => {
    const marked = blockram.circuit.nodes.find((node) => node.caveat)
    if (marked === undefined) throw new Error('nothing was marked to begin with')
    const reopened = deserializeCircuit(JSON.stringify(blockram.circuit))
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) throw new Error(reopened.reason)
    expect(reopened.file.nodes.find((node) => node.id === marked.id)?.caveat).toBe(marked.caveat)
  })

  test('the warning survives being edited on the canvas and saved from there', () => {
    // The canvas holds a part's warning on the node itself, so saving a circuit that was never reloaded still
    // writes it out. Without this half, an FPGA design that is opened, moved and saved loses every mark.
    const saved = serializeCircuit(
      [
        {
          id: 'gate_1',
          position: { x: 0, y: 0 },
          data: { definition: 'block', caveat: 'Do not trust this part’s value.' },
        },
      ],
      [],
    )
    expect(saved.nodes[0]?.caveat).toBe('Do not trust this part’s value.')
  })
})

describe('a chip family is named only when it is known', () => {
  test('a real Lattice Nexus chip file is named as Nexus, not as a broken ECP5', () => {
    // A genuine nextpnr-nexus + prjoxide bitstream for a LIFCL-40. It opens with the very same marker an ECP5
    // file does, so it used to be handed to the ECP5 decoder, which failed part-way and reported the wrong
    // family — with the decoder's own words ("Unknown ECP5 bitstream command 0x0") shown to the user.
    const identity = identifyBitstream(bytes('oxide-nexus-lifcl40-counter.bit'))
    expect(identity.ok).toBe(false)
    if (identity.ok) throw new Error('unreachable')
    expect(identity.reason).toContain('Nexus')
    expect(identity.reason).toContain('LIFCL-40')
    expect(identity.reason).not.toContain('command')
    expect(identity.reason).not.toContain('0x')
    // The two statements the module makes about Nexus must agree: it is named here as a family that cannot be
    // read, and the list of what CAN be read must not contain it.
    expect(identity.reason).toContain('cannot read Nexus')
  })

  test('an ECP5 chip file is still recognised as one', () => {
    expect(identifyBitstream(bytes('trellis-ecp5-lut-reg.bit'))).toEqual({
      ok: true,
      family: 'ecp5',
      device: 'LFE5U-25F',
      form: 'binary',
    })
  })

  test('a file of that marker whose chip is in neither list says so, and guesses at nothing', () => {
    // The marker with an identifying number belonging to no chip either project knows.
    const unknown = Uint8Array.from([
      0xff, 0xff, 0xbd, 0xb3, 0xff, 0x3b, 0x00, 0x00, 0x00, 0xe2, 0x00, 0x00, 0x00, 0xde, 0xad,
      0xbe, 0xef,
    ])
    const identity = identifyBitstream(unknown)
    expect(identity.ok).toBe(false)
    if (identity.ok) throw new Error('unreachable')
    expect(identity.reason).toContain('one of those two families')
    expect(identity.reason).toContain('DEADBEEF')
    expect(identity.reason).not.toContain('0x')
  })
})

describe('the iCE40 reading, audited for what it does not read', () => {
  test('a design built around a block memory says the memory is not here', () => {
    // The proof this audit was needed: 46 logic parts come back looking complete, and the 256-byte memory the
    // whole design is about is not read at all. The old report said "nothing in it is untrusted".
    const result = opened('icebox-ice40-1k-blockram.bin', '1k')
    expect(result.report.missing.length).toBeGreaterThan(0)
    expect(result.report.missing.map((line) => line.reason).join(' ')).toContain('block memories')
    expect(result.report.incomplete.length).toBeGreaterThan(0)
  })

  test('an input that could not be followed to a pin is not passed off as a chip pin', () => {
    // Measured: of the 25 inputs this reading reports, 17 trace back to a pin of the chip and 8 do not. The
    // design (fixtures/icebox-ice40-1k-blockram.v) has 18 input ports and an 8-bit-wide memory, so the 8 that
    // do not reach a pin are the width of the memory this reader does not read. Only those 8 are reported.
    const result = opened('icebox-ice40-1k-blockram.bin', '1k')
    const unfollowed = new Set(
      result.report.incomplete
        .filter((line) => line.reason.includes('could not be followed back to a pin'))
        .map((line) => line.part),
    )
    expect(unfollowed.size).toBe(8)
  })

  test('a design with no memory in it is not told it has one', () => {
    const result = opened('icebox-ice40-1k-carry-add4.bin', '1k')
    expect(result.report.missing).toEqual([])
    expect(result.report.incomplete).toEqual([])
    // Its eight real inputs all trace back to pins of the chip, so none is reported as unfollowable.
    expect(result.report.inputCount).toBe(8)
  })

  test('an arithmetic chain IS reported as not to be trusted', () => {
    const result = opened('icebox-ice40-1k-carry-add4.bin', '1k')
    expect(result.report.untrusted.length).toBeGreaterThan(0)
    expect(result.report.untrusted.map((line) => line.reason).join(' ')).toContain('carry unit')
  })

  test('what was NOT read is stated on every report, findings or none', () => {
    for (const [name, device] of [
      ['icebox-ice40-384-vendor-xor5.bin', '384'],
      ['icebox-ice40-1k-blockram.bin', '1k'],
      ['icebox-ice40-1k-carry-add4.bin', '1k'],
    ] as const) {
      const result = opened(name, device)
      expect(result.report.scope).toContain('What was NOT checked')
      expect(result.report.scope).toContain('block memories')
      expect(result.report.notes.join(' ')).toContain('is not read')
    }
  })

  test('no report tells the user that every part of the chip was read', () => {
    const result = opened('icebox-ice40-384-vendor-xor5.bin', '384')
    const everything = [
      result.report.scope,
      ...result.report.notes,
      ...result.report.missing.flatMap((line) => [line.part, line.reason]),
      ...result.report.untrusted.flatMap((line) => [line.part, line.reason]),
      ...result.report.incomplete.flatMap((line) => [line.part, line.reason]),
    ].join(' ')
    expect(everything).not.toContain('Every part of this chip file was read')
    expect(everything).not.toContain('0x')
  })
})
