/**
 * Mixed-signal co-simulation, step 2 — the digital→analog VIDEO bridge, proven in ISOLATION.
 *
 * No logic engine, no char-gen yet (the design's riskiest-assumption-first slice). A real CRT raster
 * world (anode EHT + X/Y sawtooth sweeps + a grid source + ground) is marched by solveTransient, and a
 * HARD-CODED checkerboard f(pixel,line) is injected onto the CRT grid each step via the step-1 hooks
 * (onStepBegin stashes the per-step grid voltage; externalSourceV returns it). We then read the beam
 * back exactly as the renderer does — crtSpotTrace → gridBrightness → per-point intensity — and assert
 * the intensity tracks the checkerboard with a full lit↔blank swing (iMax−iMin > 0.15, the raster
 * threshold). If this paints, every later step is "swap the hard-coded pattern for a real char-gen."
 */

import { describe, expect, test } from 'vitest'
import type { World } from '../src/cross-fk-validator.ts'
import { crtSpotTrace } from '../src/renderer/part-readings.ts'
import { solveTransient } from '../src/transient-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

// CRT defaults (renderer part-defaults.ts): cutoff −50 V → 0 V grid = full bright, −60 V = blanked.
const V_LIT = 0
const V_BLANK = -60

function crtRasterWorld(): World {
  const world: World = {
    definitions: new Map(),
    instances: new Map(),
    behaviors: new Map(),
    activeVariables: new Map(),
    nets: new Map(),
  }
  const net = (id: string, members: { instance: string; terminal: string }[], type?: string) =>
    world.nets.set(id, type ? { id, kind: 'net', type, members } : { id, kind: 'net', members })
  net('an', [
    { instance: 'VANODE', terminal: 'terminal_positive' },
    { instance: 'CRT', terminal: 'anode' },
  ])
  net('nx', [
    { instance: 'VX', terminal: 'terminal_positive' },
    { instance: 'CRT', terminal: 'x_deflect' },
  ])
  net('ny', [
    { instance: 'VY', terminal: 'terminal_positive' },
    { instance: 'CRT', terminal: 'y_deflect' },
  ])
  net('ng', [
    { instance: 'VGRID', terminal: 'terminal_positive' },
    { instance: 'CRT', terminal: 'grid' },
  ])
  net(
    'gnd',
    [
      { instance: 'CRT', terminal: 'cathode' },
      { instance: 'VANODE', terminal: 'terminal_negative' },
      { instance: 'VX', terminal: 'terminal_negative' },
      { instance: 'VY', terminal: 'terminal_negative' },
      { instance: 'VGRID', terminal: 'terminal_negative' },
    ],
    'ground',
  )
  world.instances.set('CRT', {
    id: 'CRT',
    kind_ref: 'primitive_device',
    definition: 'crt',
    parameters: {
      beam_current: scalar(0.0001, 'ampere'),
      grid_bias: scalar(-10, 'volt'),
      grid_cutoff_voltage: scalar(-50, 'volt'),
      deflection_sensitivity: scalar(0.02, '1/volt'),
      rated_anode_voltage: scalar(2000, 'volt'),
    },
    connects: [
      { net: 'an', terminal: 'anode', of: 'CRT' },
      { net: 'gnd', terminal: 'cathode', of: 'CRT' },
      { net: 'nx', terminal: 'x_deflect', of: 'CRT' },
      { net: 'ny', terminal: 'y_deflect', of: 'CRT' },
      { net: 'ng', terminal: 'grid', of: 'CRT' },
    ],
  })
  const r0 = scalar(0, 'ohm')
  const src = (
    id: string,
    pos: string,
    params: Record<string, { value?: unknown; ref?: string }>,
  ) =>
    world.instances.set(id, {
      id,
      kind_ref: 'primitive_device',
      definition: 'power_source',
      parameters: params,
      connects: [
        { net: pos, terminal: 'terminal_positive', of: id },
        { net: 'gnd', terminal: 'terminal_negative', of: id },
      ],
    })
  src('VANODE', 'an', { nominal_voltage: scalar(2000, 'volt'), internal_resistance: r0 })
  src('VX', 'nx', {
    nominal_voltage: scalar(0, 'volt'),
    ac_amplitude: scalar(50, 'volt'),
    frequency: scalar(480, 'hertz'),
    waveform: { value: 'sawtooth' },
    internal_resistance: r0,
  })
  src('VY', 'ny', {
    nominal_voltage: scalar(0, 'volt'),
    ac_amplitude: scalar(50, 'volt'),
    frequency: scalar(60, 'hertz'),
    waveform: { value: 'sawtooth' },
    internal_resistance: r0,
  })
  // VGRID's own waveform is irrelevant — externalSourceV forces it every step.
  src('VGRID', 'ng', { nominal_voltage: scalar(V_BLANK, 'volt'), internal_resistance: r0 })
  return world
}

const COLS = 8
const LINES = 8
const STEPS = COLS * LINES // an 8×8 field, one step per pixel
const checker = (k: number) => ((k % COLS) + Math.floor(k / COLS)) % 2 === 0

describe('co-sim video bridge in isolation (step 2)', () => {
  test('a hard-coded checkerboard on the grid paints a checkerboard of beam intensity', () => {
    const world = crtRasterWorld()
    let gridV = V_BLANK
    const result = solveTransient(world, {
      timeStep: 1 / 60 / STEPS,
      duration: 1 / 60,
      onStepBegin: (k) => {
        gridV = checker(k) ? V_LIT : V_BLANK
      },
      externalSourceV: (id) => (id === 'VGRID' ? gridV : undefined),
    })
    expect(result.status).toBe('solved')

    const { points } = crtSpotTrace(world, 'CRT', result.series)
    expect(points.length).toBe(STEPS + 1) // t=0 initial + STEPS march steps

    // Each march step's beam intensity tracks the checkerboard exactly (lit→1, blank→0).
    for (let k = 1; k <= STEPS; k++) {
      expect(points[k]?.i).toBeCloseTo(checker(k) ? 1 : 0, 6)
    }

    const intensities = points.map((p) => p.i)
    const swing = Math.max(...intensities) - Math.min(...intensities)
    expect(swing).toBeGreaterThan(0.15) // raster mode fires (not vector fallback)
  })

  test('the beam sweeps a real 2-D raster (X fast, Y slow) so the pattern has spatial extent', () => {
    const world = crtRasterWorld()
    let gridV = V_BLANK
    const result = solveTransient(world, {
      timeStep: 1 / 60 / STEPS,
      duration: 1 / 60,
      onStepBegin: (k) => {
        gridV = checker(k) ? V_LIT : V_BLANK
      },
      externalSourceV: (id) => (id === 'VGRID' ? gridV : undefined),
    })
    const { points } = crtSpotTrace(world, 'CRT', result.series)
    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    // The X (line) sweep ranges far wider than the Y (field) sweep within one field — a real raster.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.5)
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0)
  })
})
