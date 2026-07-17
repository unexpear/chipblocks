/**
 * Circuit-file tests (S19-v3-52) — Save/Load round-trips exactly what the user
 * built (parts, values, wires, hand-routed corners), and rejects anything that
 * isn't a valid circuit file with a plain-language reason.
 */

import { describe, expect, test } from 'vitest'
import {
  CIRCUIT_FILE_VERSION,
  deserializeCircuit,
  maxIdSuffix,
  serializeCircuit,
} from '../src/renderer/circuit-file.ts'

const nodes = [
  {
    id: 'power_source_1',
    position: { x: 40, y: 80 },
    data: {
      definition: 'power_source',
      parameters: { nominal_voltage: { value: { kind: 'scalar', amount: 9, unit: 'volt' } } },
    },
  },
  {
    id: 'resistor_2',
    position: { x: 220, y: 80 },
    data: {
      definition: 'resistor',
      rotation: 90,
      parameters: { resistance: { value: { kind: 'scalar', amount: 470, unit: 'ohm' } } },
    },
  },
]
const edges = [
  {
    id: 'e1',
    source: 'power_source_1',
    sourceHandle: 'terminal_positive',
    target: 'resistor_2',
    targetHandle: 'terminal_a',
    data: { waypoints: [{ id: 'w1', x: 130, y: 40 }], amps: 0.0149 },
  },
]

describe('serialize → deserialize round-trip', () => {
  test('round-trips the board ambient; an older file without it reads undefined', () => {
    const withAmbient = deserializeCircuit(JSON.stringify(serializeCircuit(nodes, edges, 85)))
    expect(withAmbient.ok).toBe(true)
    if (withAmbient.ok) expect(withAmbient.file.projectAmbientC).toBe(85)
    // Omitted (the 25 °C default isn't written) → loads as undefined; the app applies 25.
    const without = deserializeCircuit(JSON.stringify(serializeCircuit(nodes, edges)))
    expect(without.ok).toBe(true)
    if (without.ok) expect(without.file.projectAmbientC).toBeUndefined()
  })

  test('round-trips a part’s CHOSEN footprint (the picker); omitted when it uses the default', () => {
    const withChoice = [
      {
        id: 'resistor_2',
        position: { x: 220, y: 80 },
        data: {
          definition: 'resistor',
          footprintId: 'R_0805_2012Metric', // the user picked the 0805 package
          parameters: { resistance: { value: { kind: 'scalar', amount: 470, unit: 'ohm' } } },
        },
      },
    ]
    const picked = deserializeCircuit(JSON.stringify(serializeCircuit(withChoice, [])))
    expect(picked.ok).toBe(true)
    if (picked.ok) {
      expect(picked.file.nodes.find((n) => n.id === 'resistor_2')?.footprintId).toBe(
        'R_0805_2012Metric',
      )
    }
    // a part with no chosen package doesn't write the field (older files + parts on their default)
    const noChoice = deserializeCircuit(JSON.stringify(serializeCircuit(nodes, [])))
    expect(noChoice.ok).toBe(true)
    if (noChoice.ok) {
      expect(noChoice.file.nodes.find((n) => n.id === 'resistor_2')?.footprintId).toBeUndefined()
    }
  })

  test('round-trips hand board placements (positions + rotations); omitted when there are none', () => {
    const placements = [
      { id: 'resistor_2', x: 12.5, y: -3, rotation: 90 },
      { id: 'power_source_1', x: 0, y: 0, rotation: 0 },
    ]
    const r = deserializeCircuit(
      JSON.stringify(serializeCircuit(nodes, edges, undefined, undefined, placements)),
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.file.placements).toEqual(placements)
    // no hand placements → the field is omitted (older files / a fully auto-laid board)
    const none = deserializeCircuit(JSON.stringify(serializeCircuit(nodes, edges)))
    expect(none.ok).toBe(true)
    if (none.ok) expect(none.file.placements).toBeUndefined()
  })

  test('drops malformed placement entries but keeps the good ones (a bad one falls to its auto spot)', () => {
    const file = {
      ...serializeCircuit(nodes, edges),
      placements: [
        { id: 'good', x: 1, y: 2, rotation: 0 },
        { id: 'nan', x: Number.NaN, y: 2, rotation: 0 }, // x serializes to null → not finite → dropped
        { x: 1, y: 2, rotation: 0 }, // missing id → dropped
        { id: 'norot', x: 1, y: 2 }, // missing rotation → dropped
      ],
    }
    const r = deserializeCircuit(JSON.stringify(file))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.file.placements).toEqual([{ id: 'good', x: 1, y: 2, rotation: 0 }])
  })

  test('a placements field that is not an array is dropped, not a reason to reject the circuit', () => {
    const file = { ...serializeCircuit(nodes, edges), placements: 'nonsense' }
    const r = deserializeCircuit(JSON.stringify(file))
    expect(r.ok).toBe(true) // still loads
    if (r.ok) expect(r.file.placements).toBeUndefined()
  })

  test('round-trips the chip floorplan layer (overrides + lens + signature); omitted when empty', () => {
    const chipLayout = {
      overrides: [
        { id: 'cpu.alu.g0', x: 100, y: 0 },
        { id: 'cpu.pc.g3', x: 24, y: 90 },
      ],
      lens: 'module' as const,
      sourceSignature: 'sig-6152',
    }
    const r = deserializeCircuit(
      JSON.stringify(
        serializeCircuit(nodes, edges, undefined, undefined, undefined, undefined, chipLayout),
      ),
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.file.chipLayout).toEqual(chipLayout)
    // an empty layout is not written → an older file / untouched chip level reads undefined
    const none = deserializeCircuit(JSON.stringify(serializeCircuit(nodes, edges)))
    expect(none.ok).toBe(true)
    if (none.ok) expect(none.file.chipLayout).toBeUndefined()
    const empty = deserializeCircuit(
      JSON.stringify(
        serializeCircuit(nodes, edges, undefined, undefined, undefined, undefined, {
          overrides: [],
        }),
      ),
    )
    expect(empty.ok).toBe(true)
    if (empty.ok) expect(empty.file.chipLayout).toBeUndefined()
  })

  test('drops malformed chip-layout overrides + a bad lens, keeps the good parts', () => {
    const file = {
      ...serializeCircuit(nodes, edges),
      chipLayout: {
        overrides: [
          { id: 'good', x: 1, y: 2 },
          { id: 'nan', x: Number.NaN, y: 2 }, // not finite → dropped
          { x: 1, y: 2 }, // missing id → dropped
        ],
        lens: 'rainbow', // not a known lens → dropped
        sourceSignature: 'sig',
      },
    }
    const r = deserializeCircuit(JSON.stringify(file))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.file.chipLayout?.overrides).toEqual([{ id: 'good', x: 1, y: 2 }])
      expect(r.file.chipLayout?.lens).toBeUndefined()
      expect(r.file.chipLayout?.sourceSignature).toBe('sig')
    }
  })

  test('a chipLayout that is not an object is dropped, not a reason to reject the circuit', () => {
    const file = { ...serializeCircuit(nodes, edges), chipLayout: 'nonsense' }
    const r = deserializeCircuit(JSON.stringify(file))
    expect(r.ok).toBe(true) // still loads
    if (r.ok) expect(r.file.chipLayout).toBeUndefined()
  })

  test('a malformed projectAmbientC is dropped, not passed through as a fake number', () => {
    // The loader and the type both expect a number; a string / null / wrong type must not
    // ride through typed as one. The circuit still loads — the ambient just falls to default.
    for (const value of ['hot', null, true, [25]]) {
      const file = { ...serializeCircuit(nodes, edges), projectAmbientC: value }
      const r = deserializeCircuit(JSON.stringify(file))
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.file.projectAmbientC).toBeUndefined()
    }
    // A valid finite number still rides through untouched.
    const good = deserializeCircuit(
      JSON.stringify({ ...serializeCircuit(nodes, edges), projectAmbientC: 40 }),
    )
    expect(good.ok).toBe(true)
    if (good.ok) expect(good.file.projectAmbientC).toBe(40)
  })

  test('round-trips the drawing sheet; an older file without one reads undefined', () => {
    const sheet = {
      size: 'A3' as const,
      orientation: 'portrait' as const,
      title: 'SpO2 Sensor',
      company: 'ChipBlocks',
      rev: 'B',
      date: '2026-06-24',
      comment: 'tutorial',
    }
    const withSheet = deserializeCircuit(
      JSON.stringify(serializeCircuit(nodes, edges, undefined, sheet)),
    )
    expect(withSheet.ok).toBe(true)
    if (withSheet.ok) expect(withSheet.file.sheet).toEqual(sheet)
    // No sheet written → loads as undefined; the app keeps the current/default sheet.
    const without = deserializeCircuit(JSON.stringify(serializeCircuit(nodes, edges)))
    expect(without.ok).toBe(true)
    if (without.ok) expect(without.file.sheet).toBeUndefined()
    // A malformed sheet (not an object) is dropped, not ridden through; the circuit still loads.
    for (const value of ['big', null, 42]) {
      const r = deserializeCircuit(
        JSON.stringify({ ...serializeCircuit(nodes, edges), sheet: value }),
      )
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.file.sheet).toBeUndefined()
    }
  })

  test('keeps everything the user built; drops solved data', () => {
    const file = serializeCircuit(nodes, edges)
    const text = JSON.stringify(file, null, 2)
    const back = deserializeCircuit(text)
    expect(back.ok).toBe(true)
    if (!back.ok) return

    expect(back.file.nodes).toHaveLength(2)
    expect(back.file.nodes[1]).toMatchObject({
      id: 'resistor_2',
      definition: 'resistor',
      x: 220,
      y: 80,
      rotation: 90,
    })
    expect(back.file.nodes[0]?.parameters?.nominal_voltage?.value).toEqual({
      kind: 'scalar',
      amount: 9,
      unit: 'volt',
    })
    expect(back.file.wires[0]).toMatchObject({
      source: 'power_source_1',
      sourceHandle: 'terminal_positive',
      target: 'resistor_2',
      targetHandle: 'terminal_a',
    })
    expect(back.file.wires[0]?.waypoints).toEqual([{ id: 'w1', x: 130, y: 40 }])
    // Solved data must never be persisted — it is recomputed on load.
    expect(text.includes('amps')).toBe(false)
  })

  test('drops the solver-derived incident_illuminance but keeps the user value', () => {
    const sensor = [
      {
        id: 'photoresistor_1',
        position: { x: 40, y: 80 },
        data: {
          definition: 'photoresistor',
          parameters: {
            ambient_illuminance: { value: { kind: 'scalar', amount: 200, unit: 'lux' } }, // user — kept
            incident_illuminance: { value: { kind: 'scalar', amount: 1450, unit: 'lux' } }, // derived — dropped
          },
        },
      },
    ]
    const file = serializeCircuit(sensor, [])
    expect(file.nodes[0]?.parameters?.ambient_illuminance).toBeDefined()
    expect(file.nodes[0]?.parameters?.incident_illuminance).toBeUndefined()
    expect(JSON.stringify(file).includes('incident_illuminance')).toBe(false)
  })

  test('a node whose only parameter is derived saves with no parameters field — nothing stale', () => {
    const sensor = [
      {
        id: 'photoresistor_1',
        position: { x: 0, y: 0 },
        data: {
          definition: 'photoresistor',
          parameters: {
            incident_illuminance: { value: { kind: 'scalar', amount: 1450, unit: 'lux' } },
          },
        },
      },
    ]
    const file = serializeCircuit(sensor, [])
    expect('parameters' in (file.nodes[0] ?? {})).toBe(false)
  })
})

describe('deserializeCircuit — honest rejections', () => {
  test('garbage text is not JSON', () => {
    const r = deserializeCircuit('this is not json')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('JSON')
  })
  test('JSON that is not a circuit file', () => {
    const r = deserializeCircuit('{"hello": "world"}')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('format')
  })
  test('a future version is rejected, not guessed at', () => {
    const file = { ...serializeCircuit([], []), version: CIRCUIT_FILE_VERSION + 1 }
    const r = deserializeCircuit(JSON.stringify(file))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('version')
  })
  test('a structurally broken part is rejected', () => {
    const file = serializeCircuit(nodes, edges) as unknown as { nodes: unknown[] }
    file.nodes[0] = { id: 'x' } // missing definition/position
    const r = deserializeCircuit(JSON.stringify(file))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('part')
  })
})

describe('circuit blocks (S19-v3-67)', () => {
  test('a block — internals, ports, and a nested block — survives the round trip exactly', () => {
    const block = {
      name: 'NOT gate',
      origin: { x: 100, y: 60 },
      nodes: [
        {
          id: 'mn1',
          definition: 'transistor_mosfet_nmos',
          x: 120,
          y: 140,
          parameters: {
            threshold_voltage: { value: { kind: 'scalar', amount: 2.1, unit: 'volt' } },
          },
        },
        {
          id: 'inner_block',
          definition: 'block',
          x: 260,
          y: 140,
          block: {
            name: 'pull-up',
            origin: { x: 260, y: 140 },
            nodes: [{ id: 'r1', definition: 'resistor', x: 0, y: 0 }],
            edges: [],
            ports: [],
          },
        },
      ],
      edges: [
        {
          id: 'w_inner',
          source: 'mn1',
          sourceHandle: 'terminal_drain',
          target: 'inner_block',
          targetHandle: 'port_1',
        },
      ],
      ports: [
        {
          id: 'port_1',
          label: 'mn1 · gate',
          side: 'left' as const,
          offset: 14,
          inner: { nodeId: 'mn1', handleId: 'terminal_gate' },
        },
      ],
    }
    const file = serializeCircuit(
      [{ id: 'block_1', position: { x: 100, y: 60 }, data: { definition: 'block', block } }],
      [],
    )
    const parsed = deserializeCircuit(JSON.stringify(file))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.file.nodes[0]?.block).toEqual(block)
  })

  test('an ordinary part saves WITHOUT a block field — nothing invented', () => {
    const file = serializeCircuit(nodes, edges)
    expect('block' in (file.nodes[0] ?? {})).toBe(false)
  })
})

describe('maxIdSuffix', () => {
  test('the drop counter resumes above loaded ids', () => {
    expect(maxIdSuffix([{ id: 'resistor_7' }, { id: 'led_12' }, { id: 'ground_001' }])).toBe(12)
    expect(maxIdSuffix([])).toBe(0)
  })
})

describe('junctions + curve subtool (S19-v3-61)', () => {
  test('a junction node and a curved wire (with its sweep size) survive the round trip', () => {
    const file = serializeCircuit(
      [
        {
          id: 'junction_3',
          position: { x: 40, y: 60 },
          data: { definition: 'junction' },
        },
      ],
      [
        {
          id: 'w9',
          source: 'junction_3',
          sourceHandle: 'tie',
          target: 'r1',
          targetHandle: 'terminal_a',
          data: {
            waypoints: [{ id: 'wp1', x: 80, y: 60 }],
            curved: true,
            curveRadius: 28,
          },
        },
      ],
    )
    const parsed = deserializeCircuit(JSON.stringify(file))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.file.nodes[0]?.definition).toBe('junction')
    expect(parsed.file.wires[0]?.curved).toBe(true)
    expect(parsed.file.wires[0]?.curveRadius).toBe(28)
    expect(parsed.file.wires[0]?.waypoints?.length).toBe(1)
  })

  test('a wire saves and restores its chosen gauge (drives R = ρ·L/A on load)', () => {
    const file = serializeCircuit(
      [],
      [
        {
          id: 'w1',
          source: 'a',
          sourceHandle: 'x',
          target: 'b',
          targetHandle: 'y',
          data: { gaugeAwg: 14 },
        },
      ],
    )
    const parsed = deserializeCircuit(JSON.stringify(file))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.file.wires[0]?.gaugeAwg).toBe(14)
  })

  test('a straight wire saves WITHOUT a curved flag or sweep size — nothing invented', () => {
    const file = serializeCircuit(
      [],
      [{ id: 'w1', source: 'a', sourceHandle: 'x', target: 'b', targetHandle: 'y' }],
    )
    expect('curved' in (file.wires[0] ?? {})).toBe(false)
    expect('curveRadius' in (file.wires[0] ?? {})).toBe(false)
    expect('gaugeAwg' in (file.wires[0] ?? {})).toBe(false)
  })
})
