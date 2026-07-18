/**
 * S-PARAMETER PANEL RENDER (analog-RF) — proves the panel RENDERS end to end, driving the real 2-port engine,
 * not just that its plot maths is unit-tested. It server-renders SParamPanel over a real wired 2-port (a series
 * resistor between two Ports) and checks the populated view — the two stack titles, drawn curves, and the
 * peak-|S21| summary — plus the empty-state prompt when there aren't two ports. Runs in CI (no Electron);
 * createElement (not JSX) so it stays a .test.ts.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import type { World } from '../src/cross-fk-validator.ts'
import { SParamPanel } from '../src/renderer/sparam-panel.tsx'

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
function port(world: World, id: string, sigNet: string) {
  addPart(world, id, 'reference_port', { reference_impedance: scalar(50, 'ohm') }, [
    { net: sigNet, terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
}

/** A series resistor between two Ports — a real 2-port with drawable S-parameters. */
function seriesTwoPort(): World {
  const w = makeWorld()
  ensureNet(w, 'gnd', true)
  port(w, 'p1', 'a')
  port(w, 'p2', 'b')
  addPart(w, 'rs', 'resistor', { resistance: scalar(50, 'ohm') }, [
    { net: 'a', terminal: 'terminal_a' },
    { net: 'b', terminal: 'terminal_b' },
  ])
  return w
}

const noop = () => {}
const render = (world: World, p1: string, p2: string) =>
  renderToStaticMarkup(
    createElement(SParamPanel, {
      world,
      temperaturesC: new Map<string, number>(),
      light: false,
      onClose: noop,
      port1: p1,
      onPort1: noop,
      port2: p2,
      onPort2: noop,
    }),
  )

describe('SParamPanel renders', () => {
  test('a wired 2-port draws the two-stack view + the peak-|S21| summary', () => {
    const html = render(seriesTwoPort(), 'p1', 'p2')
    expect(html).toContain('transmission (dB)') // the top stack title
    expect(html).toContain('match (dB)') // the bottom stack title
    expect(html).toContain('<polyline') // curves were drawn
    expect(html).toContain('Peak |S21|') // the summary computed a transmission peak
    expect(html).toContain('dB')
  })

  test('the Port dropdowns list the available ports', () => {
    const html = render(seriesTwoPort(), 'p1', 'p2')
    expect(html).toContain('p1')
    expect(html).toContain('p2')
  })

  test('with fewer than two ports it shows the empty-state prompt instead of a plot', () => {
    const html = render(makeWorld(), '', '')
    expect(html).toContain('Add two Ports')
    expect(html).not.toContain('<polyline')
  })
})
