/**
 * User-made parts, slice 3 — persistence into the project file. A custom part must survive a
 * save → reload round-trip, an older file (no user parts) must still load, and a malformed part must be
 * dropped without sinking the whole file (so a mostly-good project still opens).
 */
import { describe, expect, test } from 'vitest'
import {
  CIRCUIT_FILE_FORMAT,
  CIRCUIT_FILE_VERSION,
  deserializeCircuit,
  serializeCircuit,
} from '../src/renderer/circuit-file.ts'
import type { UserPart } from '../src/renderer/user-parts.ts'

const sensor: UserPart = {
  id: 'my_sensor',
  name: 'My Sensor',
  designatorPrefix: 'U',
  pins: [
    { id: 'in', name: 'IN', side: 'left', electrical: 'input' },
    { id: 'out', name: 'OUT', side: 'right', electrical: 'output' },
  ],
}
const poweredIc: UserPart = {
  id: 'my_ic',
  name: 'My IC',
  designatorPrefix: 'U',
  footprintId: 'DIP-8_W7.62mm', // a board footprint must survive the round-trip too (slice 4a)
  pins: [
    { id: 'a', name: 'A', side: 'left', electrical: 'passive' },
    { id: 'b', name: 'B', side: 'right', electrical: 'passive' },
  ],
  // a real behaviour must also survive the round-trip (slice 4b)
  behavesAs: { definition: 'resistor', terminals: { terminal_a: 'a', terminal_b: 'b' } },
  parameters: { supply_voltage: { value: { kind: 'scalar', amount: 5, unit: 'V' } } },
}

const roundTrip = (userParts: UserPart[]) => {
  // Place a node for each part so the (scoped) save actually writes it — a save only carries the parts
  // the circuit references.
  const nodes = userParts.map((p) => ({
    id: `n_${p.id}`,
    position: { x: 0, y: 0 },
    data: { definition: p.id },
  }))
  const file = serializeCircuit(nodes, [], undefined, undefined, undefined, userParts)
  const result = deserializeCircuit(JSON.stringify(file))
  if (!result.ok) throw new Error(`did not load: ${result.reason}`)
  return result.file
}

describe('serializeCircuit + deserializeCircuit carry user parts', () => {
  test('user parts survive a save → reload round-trip intact', () => {
    expect(roundTrip([sensor, poweredIc]).userParts).toEqual([sensor, poweredIc])
  })

  test('no user parts → the file omits the field entirely (clean older-style file)', () => {
    const file = serializeCircuit([], [], undefined, undefined, undefined, [])
    expect('userParts' in file).toBe(false)
    expect(roundTrip([]).userParts).toBeUndefined()
  })

  test('a file that predates user parts still loads (back-compat)', () => {
    const old = JSON.stringify({
      format: CIRCUIT_FILE_FORMAT,
      version: CIRCUIT_FILE_VERSION,
      nodes: [],
      wires: [],
    })
    const result = deserializeCircuit(old)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.file.userParts).toBeUndefined()
  })
})

describe('the file is scoped to parts THIS circuit uses (not the whole session registry)', () => {
  const nodeUsing = (definition: string) => ({
    id: `n_${definition}`,
    position: { x: 0, y: 0 },
    data: { definition },
  })

  test('only user parts referenced by a node are written (an unused one is left out)', () => {
    // sensor is on the canvas; poweredIc exists in the session but this circuit does not use it.
    const file = serializeCircuit([nodeUsing('my_sensor')], [], undefined, undefined, undefined, [
      sensor,
      poweredIc,
    ])
    expect(file.userParts).toEqual([sensor])
  })

  test('a user part used only INSIDE a block still gets written (recursive scan)', () => {
    const blockNode = {
      id: 'b1',
      position: { x: 0, y: 0 },
      data: {
        definition: 'block',
        block: {
          name: 'B',
          origin: { x: 0, y: 0 },
          nodes: [{ id: 'inner', definition: 'my_ic', x: 0, y: 0 }],
          edges: [],
          ports: [],
        },
      },
    }
    const file = serializeCircuit([blockNode], [], undefined, undefined, undefined, [
      sensor,
      poweredIc,
    ])
    expect(file.userParts).toEqual([poweredIc]) // the block's inner my_ic, not the unused sensor
  })
})

describe('internal-circuit parts persist (slice 4b Model B)', () => {
  const subPart: UserPart = {
    id: 'my_sub',
    name: 'My Sub',
    designatorPrefix: 'U',
    pins: [
      { id: 'x', name: 'X', side: 'left', electrical: 'passive' },
      { id: 'y', name: 'Y', side: 'right', electrical: 'passive' },
    ],
    behavesAs: { definition: 'resistor', terminals: { terminal_a: 'x', terminal_b: 'y' } },
  }
  const moduleUsingSub: UserPart = {
    id: 'my_module',
    name: 'My Module',
    designatorPrefix: 'U',
    pins: [
      { id: 'a', name: 'A', side: 'left', electrical: 'passive' },
      { id: 'b', name: 'B', side: 'right', electrical: 'passive' },
    ],
    internal: {
      name: 'core',
      origin: { x: 0, y: 0 },
      nodes: [{ id: 's1', definition: 'my_sub', x: 0, y: 0 }],
      edges: [],
      ports: [
        { id: 'a', label: 's1 · x', side: 'left', inner: { nodeId: 's1', handleId: 'x' } },
        { id: 'b', label: 's1 · y', side: 'right', inner: { nodeId: 's1', handleId: 'y' } },
      ],
    },
  }

  test('an internal part survives the round-trip intact (the whole sub-circuit)', () => {
    expect(roundTrip([moduleUsingSub, subPart]).userParts).toEqual([moduleUsingSub, subPart])
  })

  test('the scoped save follows a module’s INTERNALS: its custom sub-parts are saved too', () => {
    // The canvas references ONLY my_module — but its internals use my_sub, which must land in the
    // file too, or the module would reload with an unresolvable black box inside.
    const file = serializeCircuit(
      [{ id: 'n1', position: { x: 0, y: 0 }, data: { definition: 'my_module' } }],
      [],
      undefined,
      undefined,
      undefined,
      [moduleUsingSub, subPart, sensor], // sensor is unrelated — must stay OUT
    )
    expect(file.userParts?.map((p) => p.id).sort()).toEqual(['my_module', 'my_sub'])
  })
})

describe('the Simulate-as choice (fidelity) persists', () => {
  test('an explicit transistor opt-out on a node survives the save → reload round-trip', () => {
    const nodes = [
      {
        id: 'm1',
        position: { x: 0, y: 0 },
        data: { definition: 'my_module', fidelity: 'transistor' as const },
      },
      { id: 'm2', position: { x: 0, y: 0 }, data: { definition: 'my_module' } },
    ]
    const file = serializeCircuit(nodes, [])
    const result = deserializeCircuit(JSON.stringify(file))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.file.nodes.find((n) => n.id === 'm1')?.fidelity).toBe('transistor')
    expect(result.file.nodes.find((n) => n.id === 'm2')?.fidelity).toBeUndefined() // untagged stays auto
  })
})

describe('malformed user parts are dropped, not fatal', () => {
  test('a broken part is filtered out; the good ones still load', () => {
    const file = {
      format: CIRCUIT_FILE_FORMAT,
      version: CIRCUIT_FILE_VERSION,
      nodes: [],
      wires: [],
      userParts: [
        sensor,
        { id: 'BadId With Spaces', name: 'x', designatorPrefix: 'U', pins: [] }, // invalid: id + no pins
        poweredIc,
      ],
    }
    const result = deserializeCircuit(JSON.stringify(file))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.file.userParts).toEqual([sensor, poweredIc])
  })

  test('a non-array userParts field is ignored (still loads)', () => {
    const file = {
      format: CIRCUIT_FILE_FORMAT,
      version: CIRCUIT_FILE_VERSION,
      nodes: [],
      wires: [],
      userParts: 'not-an-array',
    }
    const result = deserializeCircuit(JSON.stringify(file))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.file.userParts).toBeUndefined()
  })
})
