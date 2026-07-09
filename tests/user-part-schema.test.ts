/**
 * The user-part schema (user-made parts, slice 3). A persisted custom part is validated with the SAME
 * engine + strictness the catalog uses — ajv against a real JSON Schema. These tests (a) exercise the
 * schema directly on valid/invalid shapes, and (b) prove the hand-written runtime validator
 * (user-part-validate.ts, which runs at load time because the packaged app has no runtime ajv) AGREES
 * with the schema — so the two can never drift.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import AjvModule from 'ajv/dist/2020.js'
import addFormatsModule from 'ajv-formats'
import { describe, expect, test } from 'vitest'
import { validateUserPart } from '../src/renderer/user-part-validate.ts'

// biome-ignore lint/suspicious/noExplicitAny: CJS interop for Ajv default export
const Ajv = (AjvModule as any).default ?? AjvModule
// biome-ignore lint/suspicious/noExplicitAny: CJS interop for ajv-formats default export
const addFormats = (addFormatsModule as any).default ?? addFormatsModule

const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)
const validateSchema = ajv.compile(
  JSON.parse(readFileSync(join('schemas', 'user-part.schema.json'), 'utf-8')),
)

const valid = () => ({
  id: 'my_sensor',
  name: 'My Sensor',
  designatorPrefix: 'U',
  pins: [
    { id: 'in', name: 'IN', side: 'left', electrical: 'input' },
    { id: 'out', name: 'OUT', side: 'right', electrical: 'output' },
  ],
})

// A minimal valid internal circuit whose port ids match valid()'s pin ids (in/out) 1:1.
const validInternal = () => ({
  name: 'core',
  origin: { x: 0, y: 0 },
  nodes: [
    {
      id: 'r1',
      definition: 'resistor',
      x: 0,
      y: 0,
      parameters: { resistance: { value: { kind: 'scalar', amount: 100, unit: 'ohm' } } },
    },
  ],
  edges: [],
  ports: [
    {
      id: 'in',
      label: 'r1 · terminal_a',
      side: 'left',
      inner: { nodeId: 'r1', handleId: 'terminal_a' },
    },
    {
      id: 'out',
      label: 'r1 · terminal_b',
      side: 'right',
      inner: { nodeId: 'r1', handleId: 'terminal_b' },
    },
  ],
})

// Cases where the strict schema and the runtime validator MUST agree (no extra-key leniency involved).
const agreementCases: { label: string; part: unknown; ok: boolean }[] = [
  { label: 'a minimal valid part', part: valid(), ok: true },
  {
    label: 'a valid part with typed default values',
    part: {
      ...valid(),
      id: 'my_ic',
      parameters: { supply_voltage: { value: { kind: 'scalar', amount: 5, unit: 'V' } } },
    },
    ok: true,
  },
  {
    label: 'a valid part with a top/bottom pin',
    part: {
      ...valid(),
      pins: [{ id: 'clk', name: 'CLK', side: 'top', electrical: 'input' }],
    },
    ok: true,
  },
  {
    label: 'a valid part with a board footprint',
    part: { ...valid(), footprintId: 'R_0603_1608Metric' },
    ok: true,
  },
  { label: 'an empty footprint id', part: { ...valid(), footprintId: '' }, ok: false },
  {
    label: 'a valid part with a real behaviour (behavesAs)',
    part: {
      ...valid(),
      behavesAs: { definition: 'resistor', terminals: { terminal_a: 'in', terminal_b: 'out' } },
    },
    ok: true,
  },
  {
    label: 'a valid part with a real internal circuit',
    part: { ...valid(), internal: validInternal() },
    ok: true,
  },
  {
    label: 'BOTH behavesAs and internal (a part simulates one way, never both)',
    part: {
      ...valid(),
      behavesAs: { definition: 'resistor', terminals: { terminal_a: 'in', terminal_b: 'out' } },
      internal: validInternal(),
    },
    ok: false,
  },
  {
    label: 'an internal circuit with no ports (nothing to wire to)',
    part: { ...valid(), internal: { ...validInternal(), ports: [] } },
    ok: false,
  },
  {
    label: 'a NESTED sub-block with zero ports (grouped with no boundary wires — legal block data)',
    part: {
      ...valid(),
      internal: {
        ...validInternal(),
        nodes: [
          ...validInternal().nodes,
          {
            id: 'island',
            definition: 'block',
            x: 50,
            y: 50,
            block: {
              name: 'isolated',
              origin: { x: 0, y: 0 },
              nodes: [{ id: 'r9', definition: 'resistor', x: 0, y: 0 }],
              edges: [],
              ports: [],
            },
          },
        ],
      },
    },
    ok: true,
  },
  { label: 'missing name', part: { ...valid(), name: '' }, ok: false },
  { label: 'missing designator', part: { ...valid(), designatorPrefix: '' }, ok: false },
  { label: 'zero pins', part: { ...valid(), pins: [] }, ok: false },
  {
    label: 'a bad pin side',
    part: { ...valid(), pins: [{ id: 'a', name: 'A', side: 'nowhere', electrical: 'input' }] },
    ok: false,
  },
  {
    label: 'a bad electrical role',
    part: { ...valid(), pins: [{ id: 'a', name: 'A', side: 'left', electrical: 'magic' }] },
    ok: false,
  },
  {
    label: 'an id with capitals/spaces (not a slug)',
    part: { ...valid(), id: 'My Sensor' },
    ok: false,
  },
  {
    label: 'a non-scalar / NaN parameter amount',
    part: { ...valid(), parameters: { v: { value: { kind: 'scalar', amount: 'x', unit: 'V' } } } },
    ok: false,
  },
  {
    label: 'a param key with capitals',
    part: { ...valid(), parameters: { Vcc: { value: { kind: 'scalar', amount: 5, unit: 'V' } } } },
    ok: false,
  },
]

describe('user-part.schema.json (ajv, the same rigor as the catalog)', () => {
  for (const c of agreementCases) {
    test(`schema ${c.ok ? 'accepts' : 'rejects'}: ${c.label}`, () => {
      expect(validateSchema(c.part)).toBe(c.ok)
    })
  }

  test('the schema forbids unknown top-level keys (additionalProperties:false)', () => {
    expect(validateSchema({ ...valid(), bogus: 1 })).toBe(false)
  })
})

describe('validateUserPart (runtime) agrees with the schema', () => {
  for (const c of agreementCases) {
    test(`runtime ${c.ok ? 'accepts' : 'rejects'}: ${c.label}`, () => {
      expect(validateUserPart(c.part) !== null).toBe(c.ok)
    })
  }

  test('a valid part round-trips to a clean object', () => {
    expect(validateUserPart(valid())).toEqual(valid())
  })

  test('two pins sharing an id are rejected (would break wiring)', () => {
    const dup = {
      ...valid(),
      pins: [
        { id: 'p', name: 'A', side: 'left', electrical: 'passive' },
        { id: 'p', name: 'B', side: 'right', electrical: 'passive' },
      ],
    }
    expect(validateUserPart(dup)).toBeNull()
  })

  test('the runtime validator is lenient on UNKNOWN keys (forward-compat): it strips them', () => {
    // The schema is strict (rejects extras); the loader is deliberately lenient so a newer file still
    // loads its parts — it keeps only the known fields.
    const withExtra = { ...valid(), futureField: 42 }
    expect(validateSchema(withExtra)).toBe(false) // schema: strict
    expect(validateUserPart(withExtra)).toEqual(valid()) // loader: strips the extra, keeps the part
  })
})

describe('two documented rules the validator adds that JSON Schema cannot express (validator stricter)', () => {
  test('duplicate pin ids: schema accepts (uniqueItems can’t key on a field), validator rejects', () => {
    const dupIds = {
      ...valid(),
      pins: [
        { id: 'p', name: 'A', side: 'left', electrical: 'passive' },
        { id: 'p', name: 'B', side: 'right', electrical: 'passive' },
      ],
    }
    expect(validateSchema(dupIds)).toBe(true) // JSON Schema can't require per-id uniqueness
    expect(validateUserPart(dupIds)).toBeNull() // loader does — two terminals sharing an id break wiring
  })

  test('behavesAs mapping a terminal to a NON-existent pin: schema accepts, validator rejects', () => {
    // JSON Schema can't cross-reference the pins array; the runtime validator checks the pin exists.
    const badMap = {
      ...valid(),
      behavesAs: { definition: 'resistor', terminals: { terminal_a: 'ghost_pin' } },
    }
    expect(validateSchema(badMap)).toBe(true) // schema: terminals is a string→string map, 'ghost_pin' ok
    expect(validateUserPart(badMap)).toBeNull() // validator: 'ghost_pin' isn't a real pin id
  })

  test('behavesAs mapping two terminals to the SAME pin: schema accepts, validator rejects', () => {
    const shared = {
      ...valid(),
      behavesAs: { definition: 'resistor', terminals: { terminal_a: 'in', terminal_b: 'in' } },
    }
    expect(validateSchema(shared)).toBe(true) // schema: both values are strings, fine
    expect(validateUserPart(shared)).toBeNull() // validator: a pin can't be two terminals
  })

  test('an internal port id that is NOT a pin id: schema accepts, validator rejects (must be 1:1)', () => {
    const badPort = {
      ...valid(),
      internal: {
        ...validInternal(),
        ports: [
          { id: 'in', label: 'a', side: 'left', inner: { nodeId: 'r1', handleId: 'terminal_a' } },
          {
            id: 'ghost',
            label: 'b',
            side: 'right',
            inner: { nodeId: 'r1', handleId: 'terminal_b' },
          },
        ],
      },
    }
    expect(validateSchema(badPort)).toBe(true) // schema can't cross-reference the pins array
    expect(validateUserPart(badPort)).toBeNull() // validator: ports ↔ pins must match 1:1
  })

  test('an internal port exposing a NON-existent inner node: schema accepts, validator rejects', () => {
    const badInner = {
      ...valid(),
      internal: {
        ...validInternal(),
        ports: [
          { id: 'in', label: 'a', side: 'left', inner: { nodeId: 'nope', handleId: 'terminal_a' } },
          { id: 'out', label: 'b', side: 'right', inner: { nodeId: 'r1', handleId: 'terminal_b' } },
        ],
      },
    }
    expect(validateSchema(badInner)).toBe(true) // schema can't cross-reference the nodes array
    expect(validateUserPart(badInner)).toBeNull() // validator: a port must expose a real inner terminal
  })

  test('a non-finite param amount (1e400 → Infinity): schema accepts the number, validator rejects', () => {
    // JSON.parse('{"a":1e400}') === Infinity — a real number to JSON Schema, but poison downstream.
    const overflow = JSON.parse(
      `{"id":"my_sensor","name":"My Sensor","designatorPrefix":"U","pins":[{"id":"in","name":"IN","side":"left","electrical":"input"}],"parameters":{"v":{"value":{"kind":"scalar","amount":1e400,"unit":"V"}}}}`,
    )
    expect(validateSchema(overflow)).toBe(true)
    expect(validateUserPart(overflow)).toBeNull() // Number.isFinite guard
  })
})
