/**
 * Mixed-signal co-simulation, step 6 — the WHOLE thing interleaved: the REAL character-generator logic
 * circuit (CHAR_GEN, fast logic engine) and the ANALOG CRT (transient MNA) co-simulated, the video bit
 * crossing the digital→analog boundary onto the CRT grid every step. This is exactly the loop
 * solveTransientCoSim runs (verified here at the engine level, since App.tsx can't be imported in the
 * test env): reset the counters, then each transient step advance the char-gen one pixel clock (a
 * CLK-low then CLK-high logic solve over a persistent state map) and stash its video as the grid
 * voltage; the analog step solves with the grid held there. We read the beam back with crtSpotTrace and
 * assert the intensity spells HELLO WORLD — phase-locked to the scan (each series point = pixel k).
 */

import { describe, expect, test } from 'vitest'
import type { World } from '../src/cross-fk-validator.ts'
import type { CanvasEdgeLike, CanvasNodeLike } from '../src/renderer/blocks.ts'
import { CHAR_GEN, charGenExpectedVideo } from '../src/renderer/builtin-blocks.ts'
import { simulateLogic } from '../src/renderer/logic-sim.ts'
import { crtSpotTrace } from '../src/renderer/part-readings.ts'
import { solveTransient } from '../src/transient-solver.ts'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
const V_LIT = 0
const V_BLANK = -60 // 1.2 × the −50 V cutoff → blanked

// ---- the ANALOG side: a CRT raster (anode + X/Y sweeps + a grid source the co-sim drives) ----
function crtWorld(): World {
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
  const src = (id: string, pos: string, params: Record<string, { value?: unknown }>) =>
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
  const saw = (amp: number, f: number) => ({
    nominal_voltage: scalar(0, 'volt'),
    ac_amplitude: scalar(amp, 'volt'),
    frequency: scalar(f, 'hertz'),
    waveform: { value: 'sawtooth' },
    internal_resistance: r0,
  })
  src('VX', 'nx', saw(50, 480)) // line sweep (8 lines × 60 Hz)
  src('VY', 'ny', saw(50, 60)) // field sweep
  src('VGRID', 'ng', {
    nominal_voltage: scalar(V_BLANK, 'volt'),
    internal_resistance: scalar(200, 'ohm'),
  })
  return world
}

// ---- the DIGITAL side: the real char-gen on the logic engine ----
const supply = (volts: number) => ({
  nominal_voltage: { value: { kind: 'scalar', amount: volts, unit: 'volt' } },
})
const dsrc = (id: string, volts: number): CanvasNodeLike => ({
  id,
  position: { x: 0, y: 0 },
  data: { definition: 'power_source', parameters: supply(volts) },
})
const w = (id: string, s: string, sh: string, t: string, th: string): CanvasEdgeLike => ({
  id,
  source: s,
  sourceHandle: sh,
  target: t,
  targetHandle: th,
})
function makeCharGen() {
  const state = new Map<string, boolean>()
  return (clkHigh: boolean, clrHigh: boolean) => {
    const nodes: CanvasNodeLike[] = [
      { id: 'CG', position: { x: 0, y: 0 }, data: { definition: 'block', block: CHAR_GEN } },
      { id: 'g', position: { x: 0, y: 0 }, data: { definition: 'ground' } },
      dsrc('vclk', clkHigh ? 5 : 0),
      dsrc('vclr', clrHigh ? 5 : 0),
      dsrc('vp', 5),
    ]
    const edges: CanvasEdgeLike[] = [
      w('e_clk', 'vclk', 'terminal_positive', 'CG', 'clk'),
      w('e_clr', 'vclr', 'terminal_positive', 'CG', 'clr'),
      w('e_vp', 'vp', 'terminal_positive', 'CG', 'v_dd'),
      w('e_gnd', 'CG', 'gnd', 'g', 'reference_terminal'),
      w('e_clkn', 'vclk', 'terminal_negative', 'g', 'reference_terminal'),
      w('e_clrn', 'vclr', 'terminal_negative', 'g', 'reference_terminal'),
      w('e_vpn', 'vp', 'terminal_negative', 'g', 'reference_terminal'),
    ]
    return simulateLogic(nodes, edges, state)
  }
}

describe('char-gen ⇄ CRT co-simulation (step 6)', () => {
  test('the digital video paints HELLO WORLD intensity on the analog tube, phase-locked', () => {
    const world = crtWorld()
    const logicSolve = makeCharGen()
    let gridV = V_BLANK
    const readVideo = (r: ReturnType<typeof simulateLogic>) => {
      gridV = r.value('CG', 'video') === true ? V_LIT : V_BLANK
    }
    // reset the counters to top-left, then sample pixel 0 for the t = 0 frame.
    logicSolve(false, true)
    readVideo(logicSolve(true, true))

    const STEPS = 264 // a couple of scanlines across all 16 char slots — the integration + sync proof
    const dt = 1 / 60 / 1024
    const result = solveTransient(world, {
      timeStep: dt,
      duration: dt * STEPS,
      onStepBegin: () => {
        logicSolve(false, false) // CLK low — master grabs the next count
        readVideo(logicSolve(true, false)) // CLK high — Q updates; sample this pixel's video
      },
      externalSourceV: (id) => (id === 'VGRID' ? gridV : undefined),
    })
    expect(result.status).toBe('solved')

    const { points } = crtSpotTrace(world, 'CRT', result.series)
    expect(points.length).toBe(STEPS + 1)

    // Each series point k corresponds to scan count k; the beam intensity must equal the glyph the
    // char-gen emits there — i.e. the digital and analog engines stayed locked across the whole run.
    let mismatches = 0
    let lit = 0
    for (let k = 0; k <= STEPS; k++) {
      const expected = charGenExpectedVideo(k % 8, Math.floor(k / 8) % 16, Math.floor(k / 128) % 8)
      if (Math.abs((points[k]?.i ?? -1) - expected) > 1e-6) mismatches++
      if (expected === 1) lit++
    }
    expect(mismatches).toBe(0)
    expect(lit).toBeGreaterThan(20) // real letters lit on the tube

    // The grid genuinely swung lit↔blank → CrtScreen rasters (no vector fallback).
    const ii = points.map((p) => p.i)
    expect(Math.max(...ii) - Math.min(...ii)).toBeGreaterThan(0.15)

    // And the beam actually swept a 2-D raster while the video played.
    const xs = points.map((p) => p.x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.5)
  }, 60000)
})
