/**
 * board-fab-seed tests — the last link in the "reopen a saved board and get everything back" chain.
 *
 * A saved project carries the board's full fab setup (placements, hand-laid copper, stack-up, board
 * shape, drawing sheet, chip floorplan, ambient). The native File>Open restores all of it; the project
 * browser (Open / recent / template) instead seeds a NEW tab, whose useState initializers read
 * boardFabStateFromFile(project.loaded). Both paths now derive that state here, so this proves a
 * save → deserialize → seed round-trip keeps every field — closing the bug where a project opened via
 * the browser silently dropped its board state to the defaults.
 */

import { describe, expect, test } from 'vitest'
import { boardFabStateFromFile, placementsFromSaved } from '../src/renderer/board-fab-seed.ts'
import { EMPTY_CHIP_LAYOUT } from '../src/renderer/chip-layout.ts'
import { deserializeCircuit, serializeCircuit } from '../src/renderer/circuit-file.ts'
import { DEFAULT_STACKUP_OPTIONS } from '../src/renderer/pcb-stackup.ts'
import { DEFAULT_SHEET } from '../src/renderer/sheet-frame.tsx'
import { STANDARD_AMBIENT_C } from '../src/thermal-model.ts'

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
  },
]

describe('boardFabStateFromFile — the browser-Open tab seed', () => {
  test('a fresh/template project (no loaded file) seeds every field on its default', () => {
    const seed = boardFabStateFromFile(undefined)
    expect(seed.sheet).toBe(DEFAULT_SHEET)
    expect(seed.placements.size).toBe(0)
    expect(seed.chipLayout).toBe(EMPTY_CHIP_LAYOUT)
    expect(seed.ambient).toBe(STANDARD_AMBIENT_C)
    expect(seed.traces).toEqual([])
    expect(seed.vias).toEqual([])
    expect(seed.vScoredSides).toEqual([])
    expect(seed.boardProfile).toBeNull()
    expect(seed.stackup).toBe(DEFAULT_STACKUP_OPTIONS)
  })

  // THE load-bearing proof: a saved board with EVERY fab field set → serialize → deserialize (this is
  // exactly the project.loaded object the browser-Open path hands a new tab) → seed. Every field must
  // come back, or opening that board through the project browser would silently lose it.
  test('round-trips every board-fab field: save → deserialize → seed keeps all of it', () => {
    const ambient = 85
    const sheet = {
      size: 'A3' as const,
      orientation: 'portrait' as const,
      title: 'SpO2 Sensor',
      company: 'ChipBlocks',
      rev: 'B',
      date: '2026-06-24',
      comment: 'tutorial',
    }
    const placements = [
      { id: 'resistor_2', x: 12.5, y: -3, rotation: 90 as const },
      { id: 'power_source_1', x: 0, y: 0, rotation: 0 as const },
    ]
    const chipLayout = {
      overrides: [
        { id: 'cpu.alu.g0', x: 100, y: 0 },
        { id: 'cpu.pc.g3', x: 24, y: 90 },
      ],
      lens: 'module' as const,
      sourceSignature: 'sig-6152',
    }
    const traces = [
      {
        net: 'GND',
        widthMm: 0.25,
        layer: 'top',
        points: [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
        ],
      },
      {
        net: 'VCC',
        widthMm: 0.4,
        layer: 'bottom',
        points: [
          { x: 5, y: 0 },
          { x: 5, y: 8 },
          { x: 12, y: 8 },
        ],
      },
    ]
    const vias = [{ net: 'GND', at: { x: 5, y: 0 }, diameterMm: 0.6, drillMm: 0.4 }]
    const stackup = {
      thicknessMm: 2.0,
      copperWeight: 'two_oz',
      surfaceFinish: 'enig',
      copperLayers: 4,
    }
    const vScoredSides = ['top', 'left'] as const
    const boardProfile = {
      points: [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 15, y: 20 },
      ],
    }

    const saved = serializeCircuit(
      nodes,
      edges,
      ambient,
      sheet,
      placements,
      undefined, // userParts — seeded separately (mergeUserParts), not part of boardFab
      chipLayout,
      traces as never,
      vias as never,
      stackup as never,
      vScoredSides,
      boardProfile,
    )
    // JSON round-trip = what actually crosses disk before the browser-Open path deserializes it.
    const result = deserializeCircuit(JSON.stringify(saved))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const seed = boardFabStateFromFile(result.file)
    expect(seed.ambient).toBe(ambient)
    expect(seed.sheet).toEqual(sheet)
    expect([...seed.placements]).toEqual([
      ['resistor_2', { x: 12.5, y: -3, rotation: 90 }],
      ['power_source_1', { x: 0, y: 0, rotation: 0 }],
    ])
    expect(seed.chipLayout).toEqual(chipLayout)
    expect(seed.traces).toEqual(traces)
    expect(seed.vias).toEqual(vias)
    expect(seed.stackup).toEqual(stackup)
    expect(seed.vScoredSides).toEqual(['top', 'left'])
    expect(seed.boardProfile).toEqual(boardProfile)
  })

  test('the seed owns fresh copies — a tab mutating them never writes back into the loaded file', () => {
    const trace = {
      net: 'GND',
      widthMm: 0.25,
      layer: 'top',
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
      ],
    }
    const saved = serializeCircuit(
      nodes,
      edges,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [trace] as never,
    )
    const result = deserializeCircuit(JSON.stringify(saved))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const seed = boardFabStateFromFile(result.file)
    seed.traces.push({ net: 'X', widthMm: 1, layer: 'top', points: [] })
    seed.vScoredSides.push('bottom')
    // The loaded file's own arrays are untouched — later canvas edits can't corrupt project.loaded.
    expect(result.file.traces).toHaveLength(1)
  })
})

describe('placementsFromSaved', () => {
  test('drops entries with an invalid rotation, keeps the well-formed ones (insertion order)', () => {
    const map = placementsFromSaved([
      { id: 'good', x: 1, y: 2, rotation: 90 },
      { id: 'bad', x: 3, y: 4, rotation: 45 as never },
    ])
    expect([...map]).toEqual([['good', { x: 1, y: 2, rotation: 90 }]])
  })

  test('undefined → empty map', () => {
    expect(placementsFromSaved(undefined).size).toBe(0)
  })
})
