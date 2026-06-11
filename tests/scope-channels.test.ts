/**
 * Scope channel tests (S19-v3-77) — probed terminals become channels through
 * the same terminal→net lookup the multimeter uses; a probe whose terminal no
 * longer resolves is dropped, never invented.
 */

import { describe, expect, test } from 'vitest'
import { channelsForProbes } from '../src/renderer/scope.tsx'

describe('channelsForProbes', () => {
  const nets = new Map([
    ['led_001/anode', 'net_3'],
    ['led_001/cathode', 'net_5'],
    ['block_1/port_1', 'net_7'],
  ])
  const lookup = (key: string) => nets.get(key)

  test('each probed terminal becomes a labeled channel on its net', () => {
    const channels = channelsForProbes(
      [
        { nodeId: 'led_001', handleId: 'anode' },
        { nodeId: 'block_1', handleId: 'port_1' },
      ],
      lookup,
    )
    expect(channels).toEqual([
      { key: 'led_001/anode', label: 'led_001 · anode', net: 'net_3' },
      { key: 'block_1/port_1', label: 'block_1 · port 1', net: 'net_7' },
    ])
  })

  test('a probe on a deleted part is dropped, not invented', () => {
    const channels = channelsForProbes(
      [
        { nodeId: 'ghost', handleId: 'anode' },
        { nodeId: 'led_001', handleId: 'cathode' },
      ],
      lookup,
    )
    expect(channels.map((c) => c.key)).toEqual(['led_001/cathode'])
  })

  test('two probes on the same net stay two channels (overlapping traces are honest)', () => {
    const sameNet = (_: string) => 'net_1'
    const channels = channelsForProbes(
      [
        { nodeId: 'a', handleId: 'terminal_a' },
        { nodeId: 'b', handleId: 'terminal_b' },
      ],
      sameNet,
    )
    expect(channels.length).toBe(2)
  })
})
