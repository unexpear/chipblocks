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
  pins: [{ id: 'vcc', name: 'VCC', side: 'top', electrical: 'power_in' }],
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
