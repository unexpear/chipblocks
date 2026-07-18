/**
 * DISTORTION PANEL RENDER (analog-RF) — proves the panel actually RENDERS end to end, driving the real
 * large-signal engine, not just that its plot maths is unit-tested. It server-renders DistortionPanel over a
 * real wired World and checks the populated view: the two stack titles (gain compression + harmonics), a drawn
 * compression curve, the harmonic bars, and the small-signal-gain / THD read-out — and, separately, the
 * empty-state prompt when there is nothing to drive. Runs in CI (no Electron); createElement (not JSX) so it
 * stays a .test.ts.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import type { World } from '../src/cross-fk-validator.ts'
import { DistortionPanel } from '../src/renderer/distortion-panel.tsx'

const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

function makeWorld(): World {
  return {
    definitions: new Map(),
    instances: new Map(),
    behaviors: new Map(),
    activeVariables: new Map(),
    nets: new Map(),
  }
}
function ensureNet(world: World, id: string, ground = false) {
  if (!world.nets.has(id)) {
    world.nets.set(id, {
      id,
      kind: 'net',
      ...(ground ? { type: 'ground' as const } : {}),
      members: [],
    })
  }
}
function addPart(
  world: World,
  id: string,
  definition: string,
  parameters: Record<string, { value: unknown }>,
  pins: { net: string; terminal: string }[],
) {
  world.instances.set(id, {
    id,
    kind_ref: 'primitive_device',
    definition,
    parameters,
    connects: pins.map((p) => ({ net: p.net, terminal: p.terminal, of: id })),
  })
  for (const p of pins) {
    ensureNet(world, p.net)
    world.nets.get(p.net)?.members.push({ instance: id, terminal: p.terminal })
  }
}

/** A resistive divider driven by a source — perfectly linear, so it draws a clean curve with no compression
 *  (a fast, deterministic World to render the populated panel without needing a transistor). */
function divider(): World {
  const w = makeWorld()
  ensureNet(w, 'gnd', true)
  addPart(w, 'vin', 'power_source', { nominal_voltage: scalar(0, 'volt') }, [
    { net: 'in', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  addPart(w, 'r1', 'resistor', { resistance: scalar(1000, 'ohm') }, [
    { net: 'in', terminal: 'terminal_a' },
    { net: 'out', terminal: 'terminal_b' },
  ])
  addPart(w, 'r2', 'resistor', { resistance: scalar(1000, 'ohm') }, [
    { net: 'out', terminal: 'terminal_a' },
    { net: 'gnd', terminal: 'terminal_b' },
  ])
  return w
}

const noop = () => {}
const render = (world: World, source: string, outputNet: string) =>
  renderToStaticMarkup(
    createElement(DistortionPanel, {
      world,
      temperaturesC: new Map<string, number>(),
      light: false,
      onClose: noop,
      source,
      onSource: noop,
      outputNet,
      picking: false,
      onPickToggle: noop,
    }),
  )

describe('DistortionPanel renders', () => {
  test('a driven output draws both stacks + the read-out', () => {
    const html = render(divider(), 'vin', 'out')
    expect(html).toContain('gain compression') // the top stack title
    expect(html).toContain('harmonics') // the bottom stack title
    expect(html).toContain('<polyline') // the compression curve was drawn
    expect(html).toContain('<rect') // the harmonic bars were drawn
    expect(html).toContain('Small-signal gain') // the read-out computed
    expect(html).toContain('THD')
  })

  test('a linear divider reports no compression (it never clips)', () => {
    const html = render(divider(), 'vin', 'out')
    expect(html).toContain('No 1-dB compression')
  })

  test('the drive-source dropdown lists the available source', () => {
    expect(render(divider(), 'vin', 'out')).toContain('vin')
  })

  test('with no source it shows the empty-state prompt instead of a plot', () => {
    const html = render(makeWorld(), '', '')
    expect(html).toContain('Add a source')
    expect(html).not.toContain('<polyline')
  })

  test('probing an undriven (grounded) net shows the empty prompt, not a contradictory read-out', () => {
    // A valid source is picked but the probed net is ground — pinned to 0 V, so the whole sweep reads no
    // output and there is no curve. The prompt must show ALONE; the gain/THD read-out must not render beneath it.
    const html = render(divider(), 'vin', 'gnd')
    expect(html).toContain('probe an output net') // the ready-but-no-signal prompt
    expect(html).not.toContain('Small-signal gain') // the read-out is suppressed
    expect(html).not.toContain('<polyline')
  })
})
