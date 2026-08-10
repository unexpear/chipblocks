/**
 * THE "NO LOSS DECLARED" NOTICE — the honesty surface for the AC loss fix.
 *
 * The AC engine now reads whatever loss a part declares, and invents none where a part declares nothing. That
 * second half is only safe if the user is TOLD: a circuit of perfect reactances returns a return loss, a VSWR
 * and a Q that no physical circuit reaches, and the plot alone gives no hint why. This proves the sentence is
 * built correctly AND that all three AC panels (Bode, Reflection, S-parameters) actually render it — an
 * unrendered notice would be exactly the incomplete fix the engine change was made to avoid.
 * createElement (not JSX) so this stays a .test.ts, and server rendering so it runs in CI without Electron.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import type { World } from '../src/cross-fk-validator.ts'
import { acLossNoticeText } from '../src/renderer/ac-loss-notice.tsx'
import { BodePanel } from '../src/renderer/bode-panel.tsx'
import {
  defaultParameters,
  type Parameters as PartParameters,
} from '../src/renderer/part-defaults.ts'
import { ReflectionPanel } from '../src/renderer/reflection-panel.tsx'
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
  parameters: PartParameters,
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

/** A port driving a series coil into a shunt capacitor — both reactive, so both can declare loss or not. */
function lcWorld(coilOhms: number | null): World {
  const w = makeWorld()
  ensureNet(w, 'gnd', true)
  addPart(w, 'p1', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
    { net: 'in', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  addPart(
    w,
    'lser',
    'inductor',
    {
      inductance: scalar(1e-6, 'henry'),
      ...(coilOhms === null ? {} : { winding_resistance: scalar(coilOhms, 'ohm') }),
    },
    [
      { net: 'in', terminal: 'terminal_a' },
      { net: 'out', terminal: 'terminal_b' },
    ],
  )
  addPart(w, 'cshunt', 'capacitor', { capacitance: scalar(1e-10, 'farad') }, [
    { net: 'out', terminal: 'terminal_a' },
    { net: 'gnd', terminal: 'terminal_b' },
  ])
  addPart(w, 'p2', 'reference_port', { reference_impedance: scalar(50, 'ohm') }, [
    { net: 'out', terminal: 'terminal_positive' },
    { net: 'gnd', terminal: 'terminal_negative' },
  ])
  return w
}

describe('acLossNoticeText', () => {
  test('names every part solved as a perfect reactance', () => {
    const text = acLossNoticeText(lcWorld(null))
    expect(text).toContain('lser')
    expect(text).toContain('cshunt')
    expect(text).toContain('No loss declared')
    expect(text).toContain('better than any real part can')
  })

  test('names the parameters the loss would have to be declared through', () => {
    const text = acLossNoticeText(lcWorld(null)) ?? ''
    expect(text).toContain('winding_resistance')
    expect(text).toContain('esr')
    expect(text).toContain('dissipation_factor')
  })

  test('a part that declares its loss drops out of the sentence', () => {
    const text = acLossNoticeText(lcWorld(1.5)) ?? ''
    expect(text).not.toContain('lser')
    expect(text).toContain('cshunt')
  })

  test('a circuit where every reactive part declares its loss gets no notice at all', () => {
    const w = makeWorld()
    ensureNet(w, 'gnd', true)
    addPart(w, 'p1', 'power_source', { nominal_voltage: scalar(1, 'volt') }, [
      { net: 'in', terminal: 'terminal_positive' },
      { net: 'gnd', terminal: 'terminal_negative' },
    ])
    addPart(
      w,
      'lser',
      'inductor',
      { inductance: scalar(1e-6, 'henry'), winding_resistance: scalar(1.5, 'ohm') },
      [
        { net: 'in', terminal: 'terminal_a' },
        { net: 'gnd', terminal: 'terminal_b' },
      ],
    )
    expect(acLossNoticeText(w)).toBeNull()
  })

  test('a circuit with no reactive parts at all gets no notice', () => {
    const w = makeWorld()
    ensureNet(w, 'gnd', true)
    addPart(w, 'r1', 'resistor', { resistance: scalar(50, 'ohm') }, [
      { net: 'in', terminal: 'terminal_a' },
      { net: 'gnd', terminal: 'terminal_b' },
    ])
    expect(acLossNoticeText(w)).toBeNull()
  })

  test('a long list is truncated rather than filling the panel', () => {
    const w = makeWorld()
    ensureNet(w, 'gnd', true)
    for (let i = 0; i < 9; i++) {
      addPart(w, `c${i}`, 'capacitor', { capacitance: scalar(1e-9, 'farad') }, [
        { net: 'in', terminal: 'terminal_a' },
        { net: 'gnd', terminal: 'terminal_b' },
      ])
    }
    const text = acLossNoticeText(w) ?? ''
    expect(text).toContain('c5')
    expect(text).not.toContain('c6')
    expect(text).toContain('and 3 more')
  })
})

/**
 * PER-LOSS, AND A ZERO SOMEONE CHOSE vs A ZERO THAT SHIPPED. The notice used to ask only "does this part
 * declare ANY loss parameter", so a transformer that declared its core loss vanished from the sentence while
 * both its windings were solved as perfect copper. And its stated rule — "an explicit 0 counts as declared:
 * the user said ideal on purpose" — mislabelled the shipped transmission line, every loss term of which ships
 * as 0 with nobody having chosen anything.
 */
describe('acLossNoticeText names each missing loss, not just each part', () => {
  const transformer = (parameters: Record<string, { value: unknown }>): World => {
    const w = makeWorld()
    ensureNet(w, 'gnd', true)
    addPart(
      w,
      'tx',
      'transformer',
      {
        primary_inductance: scalar(0.1, 'henry'),
        secondary_inductance: scalar(10, 'henry'),
        coupling_coefficient: scalar(0.98, 'dimensionless'),
        ...parameters,
      },
      [
        { net: 'in', terminal: 'primary_a' },
        { net: 'gnd', terminal: 'primary_b' },
        { net: 'sa', terminal: 'secondary_a' },
        { net: 'gnd', terminal: 'secondary_b' },
      ],
    )
    return w
  }

  test('a transformer declaring only its core loss is still named for both windings', () => {
    const text = acLossNoticeText(transformer({ core_loss_resistance: scalar(200, 'ohm') })) ?? ''
    expect(text).toContain('tx (primary_resistance / secondary_resistance)')
    expect(text).not.toContain('core_loss_resistance')
  })

  test('a transformer declaring every loss falls silent', () => {
    expect(
      acLossNoticeText(
        transformer({
          primary_resistance: scalar(0.5, 'ohm'),
          secondary_resistance: scalar(50, 'ohm'),
          core_loss_resistance: scalar(200, 'ohm'),
        }),
      ),
    ).toBeNull()
  })

  test('a zero typed over a shipped value is the user saying "ideal", and is left alone', () => {
    // The inductor ships a real 32 Ω DCR, so a 0 there is a deliberate override — nothing to report.
    const w = makeWorld()
    ensureNet(w, 'gnd', true)
    addPart(
      w,
      'lser',
      'inductor',
      { inductance: scalar(1e-6, 'henry'), winding_resistance: scalar(0, 'ohm') },
      [
        { net: 'in', terminal: 'terminal_a' },
        { net: 'gnd', terminal: 'terminal_b' },
      ],
    )
    expect(acLossNoticeText(w)).toBeNull()
  })

  test('a zero that IS the shipped default is reported — nobody chose it', () => {
    // Every loss term of the shipped transmission line ships as 0. Calling that "the user meant ideal"
    // put words in their mouth; the line is lossless because it arrived that way.
    const w = makeWorld()
    ensureNet(w, 'gnd', true)
    addPart(w, 'tl', 'transmission_line', defaultParameters('transmission_line'), [
      { net: 'in', terminal: 'near_a' },
      { net: 'gnd', terminal: 'near_b' },
      { net: 'gnd', terminal: 'far_a' },
      { net: 'gnd', terminal: 'far_b' },
    ])
    const text = acLossNoticeText(w) ?? ''
    expect(text).toContain('tl (series_resistance / shunt_conductance / loss_tangent)')
    expect(text).toContain('SHIPPED with')
    expect(text).toContain('not by choice')
  })

  test('the shipped capacitor carries its datasheet tan δ, so it is not named', () => {
    const w = makeWorld()
    ensureNet(w, 'gnd', true)
    addPart(w, 'c1', 'capacitor', defaultParameters('capacitor'), [
      { net: 'in', terminal: 'terminal_a' },
      { net: 'gnd', terminal: 'terminal_b' },
    ])
    expect(acLossNoticeText(w)).toBeNull()
  })

  test('a part the AC solve LEFT OUT is named, with the reason', () => {
    const w = makeWorld()
    ensureNet(w, 'gnd', true)
    addPart(
      w,
      'tx',
      'transformer',
      {
        primary_inductance: scalar(1e-3, 'henry'),
        secondary_inductance: scalar(1e-3, 'henry'),
        coupling_coefficient: scalar(2, 'dimensionless'),
        primary_resistance: scalar(1, 'ohm'),
      },
      [
        { net: 'in', terminal: 'primary_a' },
        { net: 'gnd', terminal: 'primary_b' },
        { net: 'sa', terminal: 'secondary_a' },
        { net: 'gnd', terminal: 'secondary_b' },
      ],
    )
    const text = acLossNoticeText(w) ?? ''
    expect(text).toContain('tx is LEFT OUT of the AC solve entirely')
    expect(text).toContain('exceeds 1')
    expect(text).toContain('every loss it declares are absent')
  })

  test('a center-tapped transformer is solved now, so it is named only for what it lacks', () => {
    const w = makeWorld()
    ensureNet(w, 'gnd', true)
    addPart(w, 'ct', 'transformer_center_tapped', defaultParameters('transformer_center_tapped'), [
      { net: 'in', terminal: 'primary_a' },
      { net: 'gnd', terminal: 'primary_ct' },
      { net: 'pb', terminal: 'primary_b' },
      { net: 'sa', terminal: 'secondary_a' },
      { net: 'gnd', terminal: 'secondary_b' },
    ])
    // The shipped center-tapped default declares all three losses, and is no longer dropped.
    expect(acLossNoticeText(w)).toBeNull()
  })
})

const noop = () => {}

describe('all three AC panels render the notice', () => {
  test('the Reflection panel', () => {
    const html = renderToStaticMarkup(
      createElement(ReflectionPanel, {
        world: lcWorld(null),
        temperaturesC: new Map<string, number>(),
        light: false,
        onClose: noop,
        port: 'p1',
        onPort: noop,
        picking: false,
        onPickToggle: noop,
      }),
    )
    expect(html).toContain('No loss declared')
    expect(html).toContain('cshunt')
  })

  test('the Bode panel', () => {
    const html = renderToStaticMarkup(
      createElement(BodePanel, {
        world: lcWorld(null),
        temperaturesC: new Map<string, number>(),
        light: false,
        onClose: noop,
        outputNet: 'out',
        onOutputNet: noop,
        picking: false,
        onPickToggle: noop,
      }),
    )
    expect(html).toContain('No loss declared')
  })

  test('the S-parameter panel', () => {
    const html = renderToStaticMarkup(
      createElement(SParamPanel, {
        world: lcWorld(null),
        temperaturesC: new Map<string, number>(),
        light: false,
        onClose: noop,
        port1: 'p1',
        port2: 'p2',
        onPort1: noop,
        onPort2: noop,
      }),
    )
    expect(html).toContain('No loss declared')
  })

  test('a panel names only the parts that declared nothing', () => {
    const html = renderToStaticMarkup(
      createElement(ReflectionPanel, {
        world: lcWorld(1.5),
        temperaturesC: new Map<string, number>(),
        light: false,
        onClose: noop,
        port: 'p1',
        onPort: noop,
        picking: false,
        onPickToggle: noop,
      }),
    )
    // The coil declares 1.5 Ω, so only the capacitor is called out — the notice shrinks as parts get real.
    // Each part now carries the parameters behind ITS OWN missing loss, so a mixed list says which is which.
    expect(html).toContain('No loss declared for cshunt (esr / dissipation_factor) —')
    expect(html).not.toContain('lser')
  })
})
