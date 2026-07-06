/**
 * The manufacturing ZIP — deliverable #2. Jobs: the BOM groups parts the way an assembler reads
 * them; the placement file reports real body centres in the Gerber frame; the validation report
 * says PASS only when the board is genuinely complete (and names every reason it isn't); and the
 * ZIP itself is a structurally valid, byte-deterministic archive — proven by parsing it back with
 * an independent reader in this file and checking CRC-32 against the published check vector.
 */
import { describe, expect, test } from 'vitest'
import { canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { padForTerminal } from '../src/renderer/footprint-assignment.ts'
import {
  type BoardPart,
  computeRatsnest,
  deriveBoard,
  footprintByPlacement,
  silkReferenceAnchor,
} from '../src/renderer/pcb-board.ts'
import {
  buildBomCsv,
  buildManufacturingZip,
  buildPlacementCsv,
  buildValidationReport,
  FAB_FILE_NAMES,
  type FabInputs,
} from '../src/renderer/pcb-fab.ts'
import { gerberTopCopper } from '../src/renderer/pcb-gerber.ts'
import { routeBoard } from '../src/renderer/pcb-route.ts'
import { buildStackup } from '../src/renderer/pcb-stackup.ts'
import { SILK_TEXT, strokeTextWidthMm } from '../src/renderer/stroke-font.ts'
import { buildZip, crc32 } from '../src/zip-store.ts'

const WHEN = new Date(2026, 6, 4, 12, 0, 0)

const parts = (defs: [string, string][]): BoardPart[] =>
  defs.map(([id, definition]) => ({ id, definition }))

const world = (defs: [string, string][], wires: [string, string, string, string][]) =>
  canvasToWorld(
    defs.map(([id, definition]) => ({ id, definition })),
    wires.map(([source, sourceHandle, target, targetHandle], i) => ({
      id: `w${i}`,
      source,
      sourceHandle,
      target,
      targetHandle,
    })),
  )

/** A complete, clean board: two resistors, wired, routed, DRC-clean — the export-ready case. */
function cleanInputs(): FabInputs {
  const defs: [string, string][] = [
    ['R1', 'resistor'],
    ['R2', 'resistor'],
  ]
  const board = deriveBoard(
    parts(defs),
    new Map([
      ['R1', { x: 10, y: 10, rotation: 0 as const }],
      ['R2', { x: 20, y: 10, rotation: 0 as const }],
    ]),
  )
  const ratsnest = computeRatsnest(world(defs, [['R1', 'terminal_b', 'R2', 'terminal_a']]), board)
  const routing = routeBoard(ratsnest)
  return {
    board,
    ratsnest,
    routing,
    drc: [],
    offBoardPins: 0,
    bomRows: [
      { reference: 'R1', definition: 'resistor', value: '470 Ω', footprintId: 'R_0603_1608Metric' },
      { reference: 'R2', definition: 'resistor', value: '470 Ω', footprintId: 'R_0603_1608Metric' },
    ],
    netlistText: '* test netlist\n.end\n',
    when: WHEN,
  }
}

describe('assembly files', () => {
  test('the BOM groups same-value same-footprint parts onto one line with a quantity and part type', () => {
    const csv = buildBomCsv([
      { reference: 'R1', definition: 'resistor', value: '470 Ω', footprintId: 'R_0603_1608Metric' },
      { reference: 'R2', definition: 'resistor', value: '470 Ω', footprintId: 'R_0603_1608Metric' },
      {
        reference: 'C1',
        definition: 'capacitor',
        value: '100 µF',
        footprintId: 'R_0603_1608Metric',
      },
    ])
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('Comment,Designator,Footprint,Quantity,Part')
    expect(lines).toContain('470 Ω,"R1,R2",R_0603_1608Metric,2,resistor')
    expect(lines).toContain('100 µF,C1,R_0603_1608Metric,1,capacitor')
    expect(lines).toHaveLength(3)
  })

  test('a thermistor is never mistaken for a resistor of the same ohms — the Part column tells them apart', () => {
    // Both read '10 kΩ' on the same footprint; only the part type says one is an NTC.
    const csv = buildBomCsv([
      { reference: 'R1', definition: 'resistor', value: '10 kΩ', footprintId: 'R_0603_1608Metric' },
      {
        reference: 'TH1',
        definition: 'thermistor',
        value: '10 kΩ',
        footprintId: 'R_0603_1608Metric',
      },
    ])
    const lines = csv.trim().split('\n')
    expect(lines).toContain('10 kΩ,R1,R_0603_1608Metric,1,resistor')
    expect(lines).toContain('10 kΩ,TH1,R_0603_1608Metric,1,thermistor')
  })

  test('the placement file reports the part BODY centre in the Gerber frame (mm, Y up)', () => {
    const csv = buildPlacementCsv(cleanInputs().board)
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('Designator,Mid X,Mid Y,Layer,Rotation')
    // the 0603’s fab outline is centred on its origin, so R1’s body centre IS (10, 10) — Y negated
    expect(lines).toContain('R1,10,-10,Top,0')
    expect(lines).toContain('R2,20,-10,Top,0')
  })

  test('canvas-minted ids print as STANDARD designators — resistor_3 is R3 on silk, BOM and CPL', () => {
    // Review-caught: 'RESISTOR_1' is 8.3 mm of 1 mm lettering on a 1.6 mm part — off the board
    // edge and across its neighbour. The board names parts the way every schematic reader knows.
    const board = deriveBoard(
      parts([
        ['resistor_3', 'resistor'],
        ['capacitor_12', 'capacitor'],
        ['thermistor_1', 'thermistor'],
        ['ra', 'resistor'], // hand-named — kept as the user wrote it
      ]),
    )
    expect(board.placements.map((p) => p.designator)).toEqual(['R3', 'C12', 'RT1', 'ra'])
    const csv = buildPlacementCsv(board)
    expect(csv).toContain('R3,')
    expect(csv).toContain('C12,')
    expect(csv).not.toContain('resistor_3')
  })

  test('a transistor lands on the board: SOT-23 from the KiCad library, Q designator, real pinout', () => {
    const board = deriveBoard(parts([['transistor_bjt_npn_1', 'transistor_bjt_npn']]))
    const pl = board.placements[0]
    expect(pl?.footprintId).toBe('SOT-23')
    expect(pl?.designator).toBe('Q1')
    // the cited pad geometry (verbatim from the installed Package_TO_SOT_SMD library)
    const fp = pl === undefined ? undefined : footprintByPlacement(pl)
    expect(fp?.pads.map((p) => [p.center.x, p.center.y])).toEqual([
      [-0.9375, -0.95],
      [-0.9375, 0.95],
      [0.9375, 0],
    ])
    // the datasheet pinout: base→1, emitter→2, collector→3 (and gate/source/drain for FETs)
    expect(padForTerminal('transistor_bjt_npn', 'base')).toBe('1')
    expect(padForTerminal('transistor_bjt_npn', 'emitter')).toBe('2')
    expect(padForTerminal('transistor_bjt_npn', 'collector')).toBe('3')
    expect(padForTerminal('transistor_mosfet_nmos', 'gate')).toBe('1')
    expect(padForTerminal('transistor_mosfet_nmos', 'source')).toBe('2')
    expect(padForTerminal('transistor_mosfet_nmos', 'drain')).toBe('3')
  })

  test('colliding designators dedupe — the second part keeps its raw id, never two parts one name', () => {
    const board = deriveBoard(
      parts([
        ['R1', 'resistor'], // hand-named 'R1'
        ['resistor_1', 'resistor'], // would also shorten to R1
      ]),
    )
    expect(board.placements[0]?.designator).toBe('R1')
    expect(board.placements[1]?.designator).toBe('resistor_1')
  })

  test('the board outline contains the silk lettering — ink never hangs off the routed edge', () => {
    const board = deriveBoard(
      parts([
        ['resistor_1', 'resistor'],
        ['resistor_2', 'resistor'],
      ]),
    )
    for (const pl of board.placements) {
      const fp = footprintByPlacement(pl)
      if (fp === undefined) throw new Error('missing footprint')
      const anchor = silkReferenceAnchor(pl, fp)
      const half = strokeTextWidthMm(pl.designator ?? pl.partId) / 2
      expect(anchor.x - half).toBeGreaterThanOrEqual(board.outline.x)
      expect(anchor.x + half).toBeLessThanOrEqual(board.outline.x + board.outline.w)
      expect(anchor.y - SILK_TEXT.heightMm / 2).toBeGreaterThanOrEqual(board.outline.y)
    }
  })

  test('a through-hole part’s body centre is its BODY, not its pin-1 origin', () => {
    // DIP-8 fab outline spans (0.635, −1.27) → (6.985, 8.89): centre (3.81, 3.81) + origin (5, 5)
    const csv = buildPlacementCsv({
      outline: { x: 0, y: 0, w: 30, h: 30 },
      placements: [{ partId: 'U1', footprintId: 'DIP-8_W7.62mm', x: 5, y: 5, rotation: 0 }],
    })
    expect(csv).toContain('U1,8.81,-8.81,Top,0')
  })

  test('rotation is reported in the Gerber frame: a board 90° turn is 270° counter-clockwise there', () => {
    // Review-caught: the board's quarter turns live in the y-DOWN canvas frame; negating Y for
    // the fab flips the sense. Emitting the raw number told the pick-and-place machine to turn a
    // part 180° from where its pads actually are.
    const csv = buildPlacementCsv({
      outline: { x: 0, y: 0, w: 30, h: 30 },
      placements: [
        { partId: 'C1', footprintId: 'R_0603_1608Metric', x: 15, y: 16, rotation: 90 },
        { partId: 'C2', footprintId: 'R_0603_1608Metric', x: 5, y: 5, rotation: 270 },
        { partId: 'C3', footprintId: 'R_0603_1608Metric', x: 8, y: 5, rotation: 180 },
      ],
    })
    expect(csv).toContain('C1,15,-16,Top,270')
    expect(csv).toContain('C2,5,-5,Top,90')
    expect(csv).toContain('C3,8,-5,Top,180')
  })

  test('the CSV rotation and the copper AGREE: turning pin 1 by the CSV angle lands on its flash', () => {
    // The cross-file proof a pick-and-place machine relies on: take pin 1's unrotated offset from
    // the body centre, rotate it CCW (y-up frame) by the angle placement.csv reports, and the
    // result must be exactly where the copper layer flashed that pad.
    const board = {
      outline: { x: 0, y: 0, w: 30, h: 30 },
      placements: [
        { partId: 'C1', footprintId: 'R_0603_1608Metric', x: 15, y: 16, rotation: 90 as const },
      ],
    }
    const csv = buildPlacementCsv(board)
    const row = csv.trim().split('\n')[1]?.split(',') ?? []
    const midX = Number(row[1])
    const midY = Number(row[2])
    const theta = (Number(row[4]) * Math.PI) / 180
    // pin 1's unrotated offset from the body centre, in the y-up frame: (−0.825, 0)
    const local = { x: -0.825, y: 0 }
    const expectedX = midX + local.x * Math.cos(theta) - local.y * Math.sin(theta)
    const expectedY = midY + local.x * Math.sin(theta) + local.y * Math.cos(theta)
    const gerber = gerberTopCopper(
      board,
      { airwires: [], padBoxes: [] },
      { traces: [], vias: [], unrouted: [] },
      WHEN,
    )
    expect(gerber).toContain(`X${Math.round(expectedX * 1e6)}Y${Math.round(expectedY * 1e6)}D03*`)
  })
})

describe('the validation report', () => {
  test('a complete board PASSES, with the cited limits named', () => {
    const v = buildValidationReport(cleanInputs())
    expect(v.status).toBe('pass')
    expect(v.problems).toEqual([])
    expect(v.reportText).toContain('STATUS: PASS')
    expect(v.reportText).toContain('KiCad Default net class')
    expect(v.reportText).toContain('JLCPCB')
    expect(v.reportText).toContain('clean — no violations')
  })

  test('a multilevel (4-layer) board is REFUSED — we generate only the two outer copper Gerbers', () => {
    const v = buildValidationReport({
      ...cleanInputs(),
      stackup: buildStackup({
        thicknessMm: 1.6,
        copperWeight: 'one_oz',
        surfaceFinish: 'hasl',
        copperLayers: 4,
      }),
    })
    expect(v.status).toBe('fail')
    expect(v.problems.some((p) => p.includes('4 copper layers') && p.includes('inner'))).toBe(true)
    expect(v.reportText).toContain('Set the stack-up back to 2 layers')
  })

  test('a board with a controlled-depth recess (cavity / step) is REFUSED — we emit no depth-mill program', () => {
    const v = buildValidationReport({
      ...cleanInputs(),
      recesses: [{ x: 1, y: 1, w: 3, h: 2, depthMm: 0.8, side: 'top' }],
    })
    expect(v.status).toBe('fail')
    expect(v.problems.some((p) => p.includes('recess') && p.includes('depth-routing'))).toBe(true)
  })

  test('a BOM that disagrees with the placements FAILS — the archive must agree with itself', () => {
    const inputs = cleanInputs()
    const v = buildValidationReport({ ...inputs, bomRows: inputs.bomRows.slice(0, 1) })
    expect(v.status).toBe('fail')
    expect(v.problems.some((p) => p.includes('missing from the BOM') && p.includes('R2'))).toBe(
      true,
    )
  })

  test('parts the SPICE netlist cannot express are STATED, not silently omitted', () => {
    const v = buildValidationReport({
      ...cleanInputs(),
      netlistUnsupported: ['th1 (thermistor)'],
    })
    expect(v.status).toBe('pass') // an omission in the reference netlist is stated, not a refusal
    expect(v.reportText).toContain('th1 (thermistor)')
    expect(v.reportText).toContain('no SPICE model yet')
  })

  test('an incomplete board FAILS with every reason named — never a silent export', () => {
    const inputs = cleanInputs()
    const failing: FabInputs = {
      ...inputs,
      offBoardPins: 3,
      routing: { traces: [], vias: [], unrouted: inputs.ratsnest.airwires },
      drc: [{ code: 'copper-clearance', message: 'two nets too close', at: { x: 1, y: 2 } }],
    }
    const v = buildValidationReport(failing)
    expect(v.status).toBe('fail')
    expect(v.problems).toHaveLength(3)
    expect(v.reportText).toContain('STATUS: FAIL')
    expect(v.reportText).toContain('3 wired pins have no footprint')
    expect(v.reportText).toContain('could not be routed')
    expect(v.reportText).toContain('copper-clearance')
  })
})

/** CRC-32 recomputed bit-by-bit (an independent implementation, not the writer’s table). */
function crcBitwise(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** A minimal independent ZIP reader: walks the end-of-central-directory record back to every
 *  entry’s local header and data. Any structural lie (bad offset, bad size, bad CRC) throws. */
function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocdAt = bytes.length - 22 // our archives carry no comment
  if (view.getUint32(eocdAt, true) !== 0x06054b50) throw new Error('EOCD signature missing')
  const count = view.getUint16(eocdAt + 10, true)
  let at = view.getUint32(eocdAt + 16, true) // central directory start
  const out = new Map<string, Uint8Array>()
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('central header signature missing')
    const crc = view.getUint32(at + 16, true)
    const size = view.getUint32(at + 24, true)
    const nameLen = view.getUint16(at + 28, true)
    const localAt = view.getUint32(at + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen))
    if (view.getUint32(localAt, true) !== 0x04034b50) throw new Error('local header missing')
    const localNameLen = view.getUint16(localAt + 26, true)
    const extraLen = view.getUint16(localAt + 28, true)
    const dataAt = localAt + 30 + localNameLen + extraLen
    const data = bytes.subarray(dataAt, dataAt + size)
    if (crcBitwise(data) !== crc) throw new Error(`CRC mismatch for ${name}`)
    out.set(name, data)
    at += 46 + nameLen
  }
  return out
}

describe('the ZIP itself', () => {
  test('CRC-32 matches the published check vector (CRC-32/ISO-HDLC of "123456789" = 0xCBF43926)', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  test('the archive parses back with an independent reader — every entry, byte for byte', () => {
    const fab = buildManufacturingZip(cleanInputs())
    expect(fab.validation.status).toBe('pass')
    const files = readZip(fab.bytes)
    expect([...files.keys()].sort()).toEqual([...Object.values(FAB_FILE_NAMES)].sort())
    const decoder = new TextDecoder()
    const topCopper = decoder.decode(files.get(FAB_FILE_NAMES.topCopper))
    expect(topCopper).toContain('%TF.FileFunction,Copper,L1,Top*%')
    expect(topCopper).toContain('X9175000Y-10000000D03*')
    expect(decoder.decode(files.get(FAB_FILE_NAMES.report))).toContain('STATUS: PASS')
    expect(decoder.decode(files.get(FAB_FILE_NAMES.netlist))).toContain('.end')
    expect(decoder.decode(files.get(FAB_FILE_NAMES.readme))).toContain(FAB_FILE_NAMES.drill)
    // the fab-order spec: material / thickness / copper weight / finish, cited
    const stackup = decoder.decode(files.get(FAB_FILE_NAMES.stackup))
    expect(stackup).toContain('FR4')
    expect(stackup).toContain('1.6 mm')
    expect(stackup).toContain('1 oz (35 µm)')
    expect(stackup).toContain('HASL')
    expect(stackup).toContain('Provenance:')
    // the trace-physics line — the router's cited ~1 A note backed by a computed number
    expect(stackup).toContain('Default trace:')
    expect(stackup).toMatch(/carries ~0\.\d+ A at a 10 °C rise/)
  })

  test('the validation report states the BOARD SPEC (material/thickness/copper/finish) for the fab', () => {
    const report = buildValidationReport(cleanInputs()).reportText
    expect(report).toContain('BOARD SPEC')
    expect(report).toContain('2-layer, 1.6 mm FR4')
    expect(report).toContain('1 oz (35 µm) copper')
    expect(report).toContain('HASL')
  })

  test('byte-deterministic: the same board and the same moment produce the identical archive', () => {
    const a = buildManufacturingZip(cleanInputs()).bytes
    const b = buildManufacturingZip(cleanInputs()).bytes
    expect(a.length).toBe(b.length)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })

  test('a failing board still builds a report — but says FAIL (callers gate on it)', () => {
    const inputs = cleanInputs()
    const fab = buildManufacturingZip({ ...inputs, offBoardPins: 1 })
    expect(fab.validation.status).toBe('fail')
    expect(fab.validation.problems[0]).toContain('no footprint')
  })

  test('buildZip stores names, sizes and offsets a plain reader can trust (multi-entry)', () => {
    const entries = [
      { name: 'a.txt', data: new TextEncoder().encode('alpha') },
      { name: 'dir/b.txt', data: new TextEncoder().encode('beta beta') },
      { name: 'empty.txt', data: new Uint8Array(0) },
    ]
    const files = readZip(buildZip(entries, WHEN))
    expect(new TextDecoder().decode(files.get('a.txt'))).toBe('alpha')
    expect(new TextDecoder().decode(files.get('dir/b.txt'))).toBe('beta beta')
    expect(files.get('empty.txt')).toHaveLength(0)
  })

  test('the classic format’s 65535-entry ceiling is a refusal, never silent EOCD corruption', () => {
    const none = new Uint8Array(0)
    const tooMany = Array.from({ length: 65536 }, (_, i) => ({ name: `f${i}`, data: none }))
    expect(() => buildZip(tooMany, WHEN)).toThrow(/65535/)
  })
})
