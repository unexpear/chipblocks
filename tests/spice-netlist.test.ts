import { describe, expect, test } from 'vitest'
import { deserializeCircuit, type SavedNode } from '../src/renderer/circuit-file.ts'
import { parseSpiceNetlist, parseSpiceValue } from '../src/renderer/spice-netlist.ts'

const amountOf = (node: SavedNode | undefined, key: string): number | undefined => {
  const params = node?.parameters as Record<string, { value?: { amount?: number } }> | undefined
  return params?.[key]?.value?.amount
}
const byId = (nodes: SavedNode[], id: string) => nodes.find((n) => n.id === id)

describe('parseSpiceValue — SPICE engineering suffixes', () => {
  test('the standard scale factors', () => {
    expect(parseSpiceValue('1k')).toBeCloseTo(1000, 6)
    expect(parseSpiceValue('4.7k')).toBeCloseTo(4700, 6)
    expect(parseSpiceValue('1Meg')).toBeCloseTo(1e6, 0)
    expect(parseSpiceValue('1meg')).toBeCloseTo(1e6, 0) // case-insensitive
    expect(parseSpiceValue('100n')).toBeCloseTo(1e-7, 12)
    expect(parseSpiceValue('2.2uF')).toBeCloseTo(2.2e-6, 12) // trailing unit ignored
    expect(parseSpiceValue('.1u')).toBeCloseTo(1e-7, 12)
  })

  test('the classic trap: m is milli, meg is mega', () => {
    expect(parseSpiceValue('1m')).toBeCloseTo(1e-3, 9)
    expect(parseSpiceValue('1mil')).toBeCloseTo(25.4e-6, 9)
    expect(parseSpiceValue('1meg')).toBeCloseTo(1e6, 0)
  })

  test('plain numbers, units, scientific notation, and non-numbers', () => {
    expect(parseSpiceValue('5')).toBe(5)
    expect(parseSpiceValue('5V')).toBe(5) // bare unit, scale ×1
    expect(parseSpiceValue('100ohm')).toBe(100)
    expect(parseSpiceValue('1e3')).toBeCloseTo(1000, 6)
    expect(parseSpiceValue('abc')).toBeUndefined()
    expect(parseSpiceValue('')).toBeUndefined()
  })
})

describe('parseSpiceNetlist — a simple RC low-pass', () => {
  const deck = `* RC low-pass
V1 in 0 DC 5
R1 in out 1k
C1 out 0 100n
.end`
  const result = parseSpiceNetlist(deck)

  test('maps every element to a real catalog part with its value', () => {
    expect(result.unsupported).toEqual([])
    expect(result.circuit.nodes).toHaveLength(4) // V1, R1, C1, + a ground part for net 0
    expect(byId(result.circuit.nodes, 'R1')?.definition).toBe('resistor')
    expect(byId(result.circuit.nodes, 'C1')?.definition).toBe('capacitor')
    expect(byId(result.circuit.nodes, 'V1')?.definition).toBe('power_source')
    expect(result.circuit.nodes.some((n) => n.definition === 'ground')).toBe(true)
    expect(amountOf(byId(result.circuit.nodes, 'R1'), 'resistance')).toBeCloseTo(1000, 6)
    expect(amountOf(byId(result.circuit.nodes, 'C1'), 'capacitance')).toBeCloseTo(1e-7, 12)
    expect(amountOf(byId(result.circuit.nodes, 'V1'), 'nominal_voltage')).toBe(5)
  })

  test('wires the nets terminal-to-terminal (V1+ ↔ R1)', () => {
    const links = result.circuit.wires.map((w) => [w.source, w.target].sort().join('~'))
    expect(links).toContain(['V1', 'R1'].sort().join('~')) // the "in" net
    expect(links).toContain(['R1', 'C1'].sort().join('~')) // the "out" net
    // net 0 → ground anchors V1− and C1−
    expect(
      result.circuit.wires.some((w) => w.source === 'V1' && w.sourceHandle === 'terminal_positive'),
    ).toBe(true)
  })

  test('the output is a loadable CircuitFile', () => {
    const round = deserializeCircuit(JSON.stringify(result.circuit))
    expect(round.ok).toBe(true)
  })
})

describe('parseSpiceNetlist — conventions + honest reporting', () => {
  test('the first line is treated as a title and skipped (with a warning)', () => {
    const result = parseSpiceNetlist('My Filter\nR1 1 0 2.2k\n.end')
    expect(result.warnings.some((w) => w.includes('My Filter'))).toBe(true)
    expect(amountOf(byId(result.circuit.nodes, 'R1'), 'resistance')).toBeCloseTo(2200, 6)
  })

  test('a current source / unknown element is reported, never faked', () => {
    const result = parseSpiceNetlist('* t\nV1 1 0 5\nI1 1 0 1m\nR1 1 0 100\n.end')
    expect(result.unsupported.some((l) => l.startsWith('I1'))).toBe(true)
    expect(byId(result.circuit.nodes, 'R1')?.definition).toBe('resistor')
    expect(byId(result.circuit.nodes, 'I1')).toBeUndefined()
  })

  test('a one-terminal net is flagged as an open, not silently wired', () => {
    const result = parseSpiceNetlist('My Filter\nR1 1 0 2.2k\n.end')
    expect(result.warnings.some((w) => /only one terminal|open node/.test(w))).toBe(true)
  })
})

describe('parseSpiceNetlist — active devices from .model', () => {
  test('BJTs map to NPN / PNP from their .model type', () => {
    const deck = `* two-transistor
V1 vcc 0 9
R1 vcc out 1k
Q1 out in 0 QN
Q2 vcc in out QPMOD
.model QN NPN
.model QPMOD PNP
.end`
    const result = parseSpiceNetlist(deck)
    expect(byId(result.circuit.nodes, 'Q1')?.definition).toBe('transistor_bjt_npn')
    expect(byId(result.circuit.nodes, 'Q2')?.definition).toBe('transistor_bjt_pnp')
    // Q1 is wired into the circuit (collector on the shared "out" net)
    expect(result.circuit.wires.some((w) => w.source === 'Q1' || w.target === 'Q1')).toBe(true)
    expect(result.warnings.some((w) => /\.model fine-parameters were not imported/.test(w))).toBe(
      true,
    )
  })

  test('MOSFETs map to NMOS / PMOS and drop the bulk node with a note', () => {
    const deck = `* inv
M1 d g 0 0 NM
M2 d g vdd body PM
.model NM NMOS
.model PM PMOS
.end`
    const result = parseSpiceNetlist(deck)
    expect(byId(result.circuit.nodes, 'M1')?.definition).toBe('transistor_mosfet_nmos')
    expect(byId(result.circuit.nodes, 'M2')?.definition).toBe('transistor_mosfet_pmos')
    // M2's bulk ("body") differs from its source ("vdd") → a stated assumption
    expect(result.warnings.some((w) => /bulk node "body" ignored/.test(w))).toBe(true)
  })

  test('a BJT with no .model is assumed NPN, with a warning', () => {
    const result = parseSpiceNetlist('* t\nQ1 c b e MYMODEL\n.end')
    expect(byId(result.circuit.nodes, 'Q1')?.definition).toBe('transistor_bjt_npn')
    expect(result.warnings.some((w) => /assumed NPN/.test(w))).toBe(true)
  })
})

describe('parseSpiceNetlist — SIN source + continuation lines', () => {
  test('a SIN source maps offset / amplitude / frequency, and + continues a line', () => {
    const deck = `* sine
V1 1 0 SIN(0 5
+ 60)
R1 1 0 1k
.end`
    const result = parseSpiceNetlist(deck)
    const v1 = byId(result.circuit.nodes, 'V1')
    expect(amountOf(v1, 'nominal_voltage')).toBe(0)
    expect(amountOf(v1, 'ac_amplitude')).toBe(5)
    expect(amountOf(v1, 'frequency')).toBe(60)
  })
})
