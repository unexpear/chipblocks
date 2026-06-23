import { describe, expect, test } from 'vitest'
import {
  childNamed,
  childrenNamed,
  extractSchematic,
  parseSExpr,
  type SExpr,
} from '../src/renderer/kicad-schematic.ts'

describe('parseSExpr — KiCad S-expressions', () => {
  test('parses nested lists, quoted strings, and numeric coordinates', () => {
    const top = parseSExpr(
      '(symbol (lib_id "Device:R") (at 1.27 -2.54 90) (property "Reference" "R1"))',
    )
    expect(top).toHaveLength(1)
    const sym = top[0] as SExpr[]
    expect(sym[0]).toBe('symbol')
    expect(childNamed(sym, 'lib_id')).toEqual(['lib_id', 'Device:R'])
    expect(childNamed(sym, 'at')).toEqual(['at', 1.27, -2.54, 90]) // bare numbers → numbers
    expect(childNamed(sym, 'property')).toEqual(['property', 'Reference', 'R1']) // quoted → strings
  })

  test('a quoted number stays a string; bare numbers parse as numbers', () => {
    const top = parseSExpr('(value "10" 10 -3.5)')
    expect(top[0]).toEqual(['value', '10', 10, -3.5])
  })

  test('handles escaped quotes inside strings', () => {
    const top = parseSExpr('(property "Note" "a \\"quoted\\" word")')
    expect((top[0] as SExpr[])[2]).toBe('a "quoted" word')
  })
})

describe('childrenNamed / childNamed', () => {
  test('find direct child lists by token name', () => {
    const top = parseSExpr('(kicad_sch (wire a) (wire b) (junction c))')
    const sch = top[0] as SExpr[]
    expect(childrenNamed(sch, 'wire')).toHaveLength(2)
    expect(childNamed(sch, 'junction')).toEqual(['junction', 'c'])
    expect(childNamed(sch, 'nonexistent')).toBeUndefined()
  })
})

describe('extractSchematic — the structural layer', () => {
  const text = `(kicad_sch
    (symbol (lib_id "Device:R") (at 100 50 90) (mirror y)
      (property "Reference" "R1") (property "Value" "10k"))
    (symbol (lib_id "power:GND") (at 100 70 0) (property "Reference" "#PWR01") (property "Value" "GND"))
    (wire (pts (xy 100 50) (xy 120 50)))
    (junction (at 120 50))
    (label "VCC" (at 100 30 0))
    (global_label "OUT" (shape output) (at 130 50 0)))`
  const sch = extractSchematic(text)

  test('pulls placed symbols with lib id, reference, value, position, mirror', () => {
    expect(sch.symbols).toHaveLength(2)
    expect(sch.symbols[0]).toEqual({
      libId: 'Device:R',
      reference: 'R1',
      value: '10k',
      at: { x: 100, y: 50, angle: 90 },
      mirror: 'y',
    })
    expect(sch.symbols[1]?.libId).toBe('power:GND')
    expect(sch.symbols[1]?.mirror).toBeUndefined()
  })

  test('pulls wires, junctions, and labels (plain + global)', () => {
    expect(sch.wires).toEqual([{ a: { x: 100, y: 50 }, b: { x: 120, y: 50 } }])
    expect(sch.junctions).toEqual([{ x: 120, y: 50 }])
    expect(sch.labels).toEqual([
      { text: 'VCC', x: 100, y: 30 },
      { text: 'OUT', x: 130, y: 50 },
    ])
  })

  test('a non-schematic document yields empty lists, not a throw', () => {
    expect(extractSchematic('(kicad_pcb (version 20211014))')).toEqual({
      symbols: [],
      wires: [],
      junctions: [],
      labels: [],
      libPins: new Map(),
    })
  })

  test('extractLibSymbols pulls each library symbol pin in local coords', () => {
    const text = `(kicad_sch
      (lib_symbols
        (symbol "Device:R"
          (symbol "R_0_1" (rectangle (start -1 -2.5) (end 1 2.5)))
          (symbol "R_1_1"
            (pin passive line (at 0 3.81 270) (length 1.27) (name "~") (number "1"))
            (pin passive line (at 0 -3.81 90) (length 1.27) (name "~") (number "2")))))
      (symbol (lib_id "Device:R") (at 100 50 0)))`
    const sch = extractSchematic(text)
    expect(sch.libPins.get('Device:R')).toEqual([
      { number: '1', name: '~', x: 0, y: 3.81, angle: 270 },
      { number: '2', name: '~', x: 0, y: -3.81, angle: 90 },
    ])
    // the placed instance is extracted separately from the library definition
    expect(sch.symbols).toHaveLength(1)
    expect(sch.symbols[0]?.libId).toBe('Device:R')
  })
})
