/**
 * EVERY DRAWABLE PART IS PLACEABLE — the regression net for "a part we built to make the app work must
 * be reachable from the Add-Part picker." Twice now a fully-wired part (the UV LED, the Schottky diode)
 * had a symbol, solver support, and cited defaults but was missing from the palette list, so it could
 * never be placed. This test fails if that happens again: every id the app can draw a symbol for must be
 * reachable from the picker's sources (the built-in PARTS ∪ the catalog/user registry snapshot).
 *
 * Plus a functional check on the once-orphaned Schottky: placed with its SHIPPED defaults it must solve
 * and behave like a real Schottky — a lower forward drop (so more current) than a silicon PN diode.
 */
import { describe, expect, test } from 'vitest'
import { solveDC } from '../src/dc-solver.ts'
import { BUILTIN_BLOCKS } from '../src/renderer/builtin-blocks.ts'
import { type CanvasNode, canvasToWorld } from '../src/renderer/canvas-to-world.ts'
import { registerCatalogParts } from '../src/renderer/catalog-parts.ts'
import { APPLIANCE_PART_IDS, PARTS } from '../src/renderer/palette.tsx'
import { defaultParameters } from '../src/renderer/part-defaults.ts'
import { DRAWABLE_PART_IDS } from '../src/renderer/symbols.tsx'
import { getUserPartsSnapshot } from '../src/renderer/user-parts.ts'

registerCatalogParts()

// The wire is drawn by the wire TOOL, not placed as a node — the one drawable id that isn't a palette part.
const NOT_A_PALETTE_PART = new Set(['wire'])
const ANNOTATIONS = new Set([
  'net_label',
  'text_note',
  'text_box',
  'graphic_line',
  'graphic_rect',
  'graphic_circle',
])

function reachableFromPicker(): Set<string> {
  return new Set([...PARTS.map((p) => p.definition), ...getUserPartsSnapshot().map((p) => p.id)])
}

describe('every drawable part can be gotten from the Add-Part picker', () => {
  test('no orphans: every id with a schematic symbol is reachable (except the wire tool)', () => {
    const reachable = reachableFromPicker()
    const orphans = DRAWABLE_PART_IDS.filter(
      (id) => !NOT_A_PALETTE_PART.has(id) && !reachable.has(id),
    )
    expect(orphans, `drawable but unplaceable: ${orphans.join(', ')}`).toEqual([])
  })

  test('the two once-orphaned parts are now reachable', () => {
    const reachable = reachableFromPicker()
    expect(reachable.has('led_uv_algan')).toBe(true)
    expect(reachable.has('diode_schottky_al_si')).toBe(true)
  })
})

// A part is only truly placeable if BOTH placement paths (drag-drop AND the Add-Part list) know how to
// build it. They once diverged: the big composites (calculator, Verilog CPUs) lay out a whole appliance
// with a descendable brain via a dedicated function, but only drag-drop called it — the Add-Part list
// dropped a dead `calculator` device node that neither rendered nor simulated nor descended. Both paths
// now share the same appliance router; this guards that every built-in id resolves to a real handler.
describe('no built-in part places as a dead node', () => {
  const blocks = new Set(Object.keys(BUILTIN_BLOCKS)) // → descendable block node
  const appliances = new Set<string>(APPLIANCE_PART_IDS) // → lays out an appliance (descendable brain)
  const drawable = new Set(DRAWABLE_PART_IDS) // → a device with a schematic symbol
  const hasDefaults = (id: string) => Object.keys(defaultParameters(id) ?? {}).length > 0

  test('every PARTS id is a block, an appliance, or a real device — never an unknown dead node', () => {
    const dead = PARTS.map((p) => p.definition).filter(
      (id) =>
        !blocks.has(id) &&
        !appliances.has(id) &&
        !drawable.has(id) &&
        !ANNOTATIONS.has(id) &&
        !hasDefaults(id),
    )
    expect(dead, `these would place as dead device nodes: ${dead.join(', ')}`).toEqual([])
  })

  test('APPLIANCE_PART_IDS is exactly the placeable composites that need a layout function', () => {
    // Pins the appliance list down: a composite in PARTS that is neither a block nor a drawable device
    // MUST be an appliance (or it dead-nodes). If someone adds such a part without listing it here, this
    // fails — forcing them to wire a placer, the exact gap that bit the calculator.
    const needsPlacer = PARTS.map((p) => p.definition)
      .filter(
        (id) => !blocks.has(id) && !drawable.has(id) && !ANNOTATIONS.has(id) && !hasDefaults(id),
      )
      .sort()
    expect(needsPlacer).toEqual([...APPLIANCE_PART_IDS].sort())
  })
})

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

/** Battery(9 V) → 100 Ω → diode → back, ground on the return. Reused for both diode types. */
function diodeCurrent(definition: string): number {
  const nodes: CanvasNode[] = [
    {
      id: 'bat',
      definition: 'power_source',
      parameters: { nominal_voltage: scalar(9, 'volt'), internal_resistance: scalar(1, 'ohm') },
    },
    { id: 'r1', definition: 'resistor', parameters: { resistance: scalar(100, 'ohm') } },
    // placed with its SHIPPED defaults — this is what a user gets when they drop it from the picker
    { id: 'd1', definition, parameters: defaultParameters(definition) },
    { id: 'gnd', definition: 'ground' },
  ]
  const edges = [
    { source: 'bat', sourceHandle: 'terminal_positive', target: 'r1', targetHandle: 'terminal_a' },
    { source: 'r1', sourceHandle: 'terminal_b', target: 'd1', targetHandle: 'anode' },
    { source: 'd1', sourceHandle: 'cathode', target: 'bat', targetHandle: 'terminal_negative' },
    {
      source: 'gnd',
      sourceHandle: 'reference_terminal',
      target: 'bat',
      targetHandle: 'terminal_negative',
    },
  ]
  const solution = solveDC(canvasToWorld(nodes, edges))
  expect(solution.status).toBe('solved')
  return Math.abs(solution.branches.get('d1') ?? 0)
}

describe('the Schottky places-and-solves with real Schottky physics', () => {
  test('placed from its defaults it conducts MORE than a silicon diode (lower forward drop)', () => {
    const schottky = diodeCurrent('diode_schottky_al_si')
    const silicon = diodeCurrent('diode_silicon_rectifier')
    // both conduct in the tens of mA; the Schottky's lower V_F leaves more voltage for the resistor
    expect(schottky).toBeGreaterThan(0.05)
    expect(schottky).toBeGreaterThan(silicon)
  })
})
