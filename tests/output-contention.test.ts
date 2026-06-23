import { describe, expect, test } from 'vitest'
import type { BlockPort, DriveKind } from '../src/renderer/blocks.ts'
import { classifyNet, detectOutputContention } from '../src/renderer/output-contention.ts'

const out = (
  nodeId: string,
  portId: string,
  drive: 'push_pull' | 'open_collector' | 'tristate',
  enabled?: boolean,
) => (enabled === undefined ? { nodeId, portId, drive } : { nodeId, portId, drive, enabled })

describe('classifyNet — the real driver-contention matrix', () => {
  test('two push-pull outputs fight → contention error', () => {
    const f = classifyNet([out('a', 'o', 'push_pull'), out('b', 'o', 'push_pull')])
    expect(f?.severity).toBe('error')
    expect(f?.code).toBe('output-contention')
    expect(f?.pins).toHaveLength(2)
  })

  test('a push-pull mixed with anything still fights (push-pull wins the conflict)', () => {
    expect(classifyNet([out('a', 'o', 'push_pull'), out('b', 'o', 'open_collector')])?.code).toBe(
      'output-contention',
    )
    expect(classifyNet([out('a', 'o', 'push_pull'), out('b', 'o', 'tristate')])?.code).toBe(
      'output-contention',
    )
  })

  test('open-collector outputs with NO pull-up → caution (the high level floats)', () => {
    const f = classifyNet([out('a', 'o', 'open_collector'), out('b', 'o', 'open_collector')])
    expect(f?.severity).toBe('warning')
    expect(f?.code).toBe('open-collector-no-pullup')
  })

  test('open-collector outputs WITH a pull-up are safe (no finding)', () => {
    const both = [out('a', 'o', 'open_collector'), out('b', 'o', 'open_collector')]
    expect(classifyNet(both, true)).toBeNull()
  })

  test('tri-state outputs with unknown enables → caution', () => {
    const f = classifyNet([out('a', 'o', 'tristate'), out('b', 'o', 'tristate')])
    expect(f?.severity).toBe('warning')
    expect(f?.code).toBe('tristate-bus')
  })

  test('two tri-state outputs enabled at once → contention error', () => {
    const f = classifyNet([out('a', 'o', 'tristate', true), out('b', 'o', 'tristate', true)])
    expect(f?.severity).toBe('error')
    expect(f?.code).toBe('tristate-contention')
  })

  test('one tri-state enabled, the other off (both known) → safe, no flag', () => {
    expect(
      classifyNet([out('a', 'o', 'tristate', true), out('b', 'o', 'tristate', false)]),
    ).toBeNull()
  })

  test('mixed open-collector + tri-state → mixed-bus caution', () => {
    expect(classifyNet([out('a', 'o', 'open_collector'), out('b', 'o', 'tristate')])?.code).toBe(
      'mixed-output-bus',
    )
  })

  test('a single output never contends', () => {
    expect(classifyNet([out('a', 'o', 'push_pull')])).toBeNull()
    expect(classifyNet([])).toBeNull()
  })
})

describe('detectOutputContention — building nets from the canvas wiring', () => {
  const block = (
    id: string,
    drive: DriveKind,
    portId = 'o',
  ): { id: string; data: { block: { ports: BlockPort[] } } } => ({
    id,
    data: {
      block: {
        ports: [
          {
            id: portId,
            label: portId,
            side: 'right',
            inner: { nodeId: 'x', handleId: 'y' },
            drive,
          },
        ],
      },
    },
  })

  test('two output pins WIRED together are flagged', () => {
    const nodes = [block('b1', 'push_pull'), block('b2', 'push_pull')]
    const edges = [{ source: 'b1', sourceHandle: 'o', target: 'b2', targetHandle: 'o' }]
    const found = detectOutputContention(nodes, edges)
    expect(found).toHaveLength(1)
    expect(found[0]?.code).toBe('output-contention')
    expect(found[0]?.pins).toHaveLength(2)
  })

  test('the same two outputs NOT wired together are fine', () => {
    const nodes = [block('b1', 'push_pull'), block('b2', 'push_pull')]
    expect(detectOutputContention(nodes, [])).toHaveLength(0)
  })

  test('an output wired only to an input is fine (the normal case)', () => {
    const nodes = [block('b1', 'push_pull'), block('b2', 'input', 'i')]
    const edges = [{ source: 'b1', sourceHandle: 'o', target: 'b2', targetHandle: 'i' }]
    expect(detectOutputContention(nodes, edges)).toHaveLength(0)
  })

  test('three outputs joined through a shared node all land on one finding', () => {
    const nodes = [
      block('b1', 'open_collector'),
      block('b2', 'open_collector'),
      block('b3', 'open_collector'),
    ]
    const edges = [
      { source: 'b1', sourceHandle: 'o', target: 'b2', targetHandle: 'o' },
      { source: 'b2', sourceHandle: 'o', target: 'b3', targetHandle: 'o' },
    ]
    const found = detectOutputContention(nodes, edges)
    expect(found).toHaveLength(1)
    expect(found[0]?.pins).toHaveLength(3)
    expect(found[0]?.code).toBe('open-collector-no-pullup')
  })

  test('an open-collector bus WITH a pull-up to the + rail is safe — no flag', () => {
    const nodes = [
      block('b1', 'open_collector'),
      block('b2', 'open_collector'),
      { id: 'rpull', data: { definition: 'resistor' } },
      { id: 'vcc', data: { definition: 'power_source' } },
    ]
    const edges = [
      { source: 'b1', sourceHandle: 'o', target: 'b2', targetHandle: 'o' },
      { source: 'b2', sourceHandle: 'o', target: 'rpull', targetHandle: 'terminal_a' },
      {
        source: 'rpull',
        sourceHandle: 'terminal_b',
        target: 'vcc',
        targetHandle: 'terminal_positive',
      },
    ]
    expect(detectOutputContention(nodes, edges)).toHaveLength(0)
  })

  test('a resistor to the − rail (a pull-DOWN, not a pull-up) does NOT make it safe', () => {
    const nodes = [
      block('b1', 'open_collector'),
      block('b2', 'open_collector'),
      { id: 'rpull', data: { definition: 'resistor' } },
      { id: 'vcc', data: { definition: 'power_source' } },
    ]
    const edges = [
      { source: 'b1', sourceHandle: 'o', target: 'b2', targetHandle: 'o' },
      { source: 'b2', sourceHandle: 'o', target: 'rpull', targetHandle: 'terminal_a' },
      {
        source: 'rpull',
        sourceHandle: 'terminal_b',
        target: 'vcc',
        targetHandle: 'terminal_negative',
      },
    ]
    expect(detectOutputContention(nodes, edges)[0]?.code).toBe('open-collector-no-pullup')
  })

  test('an open-collector bus the solver shows HIGH counts as pulled-up (multi-hop) → safe', () => {
    const nodes = [block('b1', 'open_collector'), block('b2', 'open_collector')]
    const edges = [{ source: 'b1', sourceHandle: 'o', target: 'b2', targetHandle: 'o' }]
    const live = {
      terminalVoltages: new Map([
        ['b1.x/y', 5],
        ['b2.x/y', 5],
      ]),
      threshold: 2.5,
    }
    expect(detectOutputContention(nodes, edges, live)).toHaveLength(0)
  })

  test('an open-collector bus the solver shows LOW (no pull-up confirmed) → caution', () => {
    const nodes = [block('b1', 'open_collector'), block('b2', 'open_collector')]
    const edges = [{ source: 'b1', sourceHandle: 'o', target: 'b2', targetHandle: 'o' }]
    const live = {
      terminalVoltages: new Map([
        ['b1.x/y', 0],
        ['b2.x/y', 0],
      ]),
      threshold: 2.5,
    }
    expect(detectOutputContention(nodes, edges, live)[0]?.code).toBe('open-collector-no-pullup')
  })

  const tristateBlock = (
    id: string,
    enableInnerNode: string,
  ): { id: string; data: { block: { ports: BlockPort[] } } } => ({
    id,
    data: {
      block: {
        ports: [
          {
            id: 'o',
            label: 'o',
            side: 'right',
            inner: { nodeId: 'buf', handleId: 'out' },
            drive: 'tristate',
            enable: { pin: 'en', activeHigh: true },
          },
          {
            id: 'en',
            label: 'en',
            side: 'left',
            inner: { nodeId: enableInnerNode, handleId: 't' },
            drive: 'input',
          },
        ],
      },
    },
  })
  const busEdge = [{ source: 'b1', sourceHandle: 'o', target: 'b2', targetHandle: 'o' }]

  test('two tri-state outputs both enabled (live) onto one bus → contention error', () => {
    const nodes = [tristateBlock('b1', 'g1'), tristateBlock('b2', 'g2')]
    const live = {
      terminalVoltages: new Map([
        ['b1.g1/t', 5],
        ['b2.g2/t', 5],
      ]),
      threshold: 2.5,
    }
    const found = detectOutputContention(nodes, busEdge, live)
    expect(found).toHaveLength(1)
    expect(found[0]?.code).toBe('tristate-contention')
  })

  test('only one tri-state enabled at a time (live) → safe, no flag', () => {
    const nodes = [tristateBlock('b1', 'g1'), tristateBlock('b2', 'g2')]
    const live = {
      terminalVoltages: new Map([
        ['b1.g1/t', 5],
        ['b2.g2/t', 0],
      ]),
      threshold: 2.5,
    }
    expect(detectOutputContention(nodes, busEdge, live)).toHaveLength(0)
  })

  test('without the live circuit state, a tri-state bus stays a caution', () => {
    const nodes = [tristateBlock('b1', 'g1'), tristateBlock('b2', 'g2')]
    expect(detectOutputContention(nodes, busEdge)[0]?.code).toBe('tristate-bus')
  })
})
