/**
 * REFLECTION PANEL RENDER (analog-RF, increment 1 follow-up) — proves the panel actually RENDERS a reflection
 * end to end, not just that its maths is tested. It server-renders ReflectionPanel over a real wired World
 * (a Port across a mismatched load) and checks the output is the populated match view — the two axis titles,
 * a drawn curve, and the best-match summary with the impedance readout — and, separately, the empty-state
 * prompt when there is no port. Runs in CI (no Electron); createElement (not JSX) so it stays a .test.ts.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import type { World } from '../src/cross-fk-validator.ts'
import { ReflectionPanel } from '../src/renderer/reflection-panel.tsx'

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

/** A Port (p1) across a mismatched resistor to ground — a real reflection to draw. */
function portAcrossR(rOhm: number): World {
  const w = makeWorld()
  ensureNet(w, 'gnd', true)
  addPart(w, 'p1', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
    { net: 'in', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  addPart(w, 'rload', 'resistor', { resistance: scalar(rOhm, 'ohm') }, [
    { net: 'in', terminal: 'terminal_a' },
    { net: 'gnd', terminal: 'terminal_b' },
  ])
  return w
}

const noop = () => {}
const render = (world: World, port: string) =>
  renderToStaticMarkup(
    createElement(ReflectionPanel, {
      world,
      temperaturesC: new Map<string, number>(),
      light: false,
      onClose: noop,
      port,
      onPort: noop,
      picking: false,
      onPickToggle: noop,
    }),
  )

describe('ReflectionPanel renders', () => {
  test('a wired port draws the two-stack match view + the best-match summary', () => {
    const html = render(portAcrossR(150), 'p1') // 3:1 mismatch → a real, non-trivial reflection
    expect(html).toContain('return loss (dB)') // the top stack title
    expect(html).toContain('VSWR') // the bottom stack title
    expect(html).toContain('<polyline') // a curve was actually drawn
    expect(html).toContain('Best match') // the summary computed a reflection
    expect(html).toContain('Zin') // …with the complex input-impedance readout
    expect(html).toContain('Ω')
  })

  test('the Port dropdown lists the available port', () => {
    expect(render(portAcrossR(150), 'p1')).toContain('p1')
  })

  test('with no port it shows the empty-state prompt instead of a plot', () => {
    const html = render(makeWorld(), '')
    expect(html).toContain('Add a Port')
    expect(html).not.toContain('<polyline')
  })
})
