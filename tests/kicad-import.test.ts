import { describe, expect, it } from 'vitest'
import { deserializeCircuit } from '../src/renderer/circuit-file.ts'
import { parseKicadSchematic } from '../src/renderer/kicad-schematic.ts'

// A small sheet covering the mapping layer: a resistor (value → resistance, pins → terminal_a/b),
// a diode (anode/cathode mapped by pin NAME), an op-amp we don't model (→ reported unsupported),
// and power ports that become a net label (+5V / +12V rails) and a Ground part (GND).
const SCH = `
(kicad_sch
  (version 20231120)
  (lib_symbols
    (symbol "Device:R"
      (symbol "R_1_1"
        (pin passive line (at 0 3.81 270) (length 1) (name "~") (number "1"))
        (pin passive line (at 0 -3.81 90) (length 1) (name "~") (number "2"))))
    (symbol "Device:D"
      (symbol "D_1_1"
        (pin passive line (at -3.81 0 0) (length 1) (name "K") (number "1"))
        (pin passive line (at 3.81 0 180) (length 1) (name "A") (number "2"))))
    (symbol "Amplifier_Operational:TL072"
      (symbol "TL072_1_1"
        (pin input line (at -7.62 2.54 0) (length 1) (name "+") (number "3"))))
    (symbol "power:+5V" (pin power_in line (at 0 0 90) (length 0) (name "+5V") (number "1")))
    (symbol "power:+12V" (pin power_in line (at 0 0 90) (length 0) (name "+12V") (number "1")))
    (symbol "power:GND" (pin power_in line (at 0 0 270) (length 0) (name "GND") (number "1")))
  )
  (symbol (lib_id "Device:R") (at 100 100 0) (property "Reference" "R1") (property "Value" "1k"))
  (symbol (lib_id "Device:D") (at 200 100 0) (property "Reference" "D1") (property "Value" "1N4148"))
  (symbol (lib_id "Amplifier_Operational:TL072") (at 300 100 0) (property "Reference" "U1") (property "Value" "TL072"))
  (symbol (lib_id "power:+5V") (at 100 96.19 0) (property "Reference" "#PWR01") (property "Value" "+5V"))
  (symbol (lib_id "power:GND") (at 100 103.81 0) (property "Reference" "#PWR02") (property "Value" "GND"))
  (symbol (lib_id "power:+12V") (at 203.81 100 0) (property "Reference" "#PWR03") (property "Value" "+12V"))
)
`

const result = parseKicadSchematic(SCH)
const nodeById = (id: string) => result.circuit.nodes.find((n) => n.id === id)
const wireFrom = (source: string, handle: string) =>
  result.circuit.wires.find((w) => w.source === source && w.sourceHandle === handle)

describe('kicad → CircuitFile mapping', () => {
  it('maps a resistor and reads its value', () => {
    const r1 = nodeById('R1')
    expect(r1?.definition).toBe('resistor')
    expect(r1?.parameters?.resistance).toEqual({
      value: { kind: 'scalar', amount: 1000, unit: 'ohm' },
    })
  })

  it('maps a diode and routes its pins by NAME (A→anode, K→cathode)', () => {
    expect(nodeById('D1')?.definition).toBe('diode_silicon_rectifier')
    // D1 pin 2 is named "A" → its wire leaves the anode terminal (to the +12V rail).
    expect(wireFrom('D1', 'anode')).toBeDefined()
  })

  it('reports a part it does not model instead of faking it', () => {
    expect(result.unsupported.some((u) => u.includes('U1'))).toBe(true)
    expect(nodeById('U1')).toBeUndefined()
  })

  it('turns a named rail into a net label and ground into a Ground part', () => {
    const labels = result.circuit.nodes.filter((n) => n.definition === 'net_label')
    const names = labels.map((n) => n.parameters?.net_name?.value)
    expect(names).toContain('+5V')
    expect(names).toContain('+12V')
    expect(result.circuit.nodes.some((n) => n.definition === 'ground')).toBe(true)
  })

  it('wires the resistor from its rail to ground', () => {
    expect(wireFrom('R1', 'terminal_a')).toBeDefined() // up to the +5V label
    expect(wireFrom('R1', 'terminal_b')).toBeDefined() // down to ground
  })

  it('produces a CircuitFile that loads like a saved one', () => {
    expect(deserializeCircuit(JSON.stringify(result.circuit)).ok).toBe(true)
    const ids = new Set(result.circuit.nodes.map((n) => n.id))
    for (const w of result.circuit.wires) {
      expect(ids.has(w.source)).toBe(true)
      expect(ids.has(w.target)).toBe(true)
    }
  })
})
