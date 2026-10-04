/**
 * Chip-level timing sign-off must descend into a hierarchical block. A CPU placed as a single block has all
 * its registers INSIDE it, so the raw top-level trace finds no register-to-register paths (it sees one block).
 * Flattening past composite combinational gates to MOSFET-level leaves + D flip-flops — the same descent
 * silicon-area analysis needs — exposes the internal paths so the chip view can report a real max clock.
 * Composite AND/OR/… must expand: characterizeGate only sees transistors, and uncharacterized gates must
 * not contribute a fake zero delay.
 */

import { expect, test } from 'vitest'
import { flattenBlocks } from '../src/renderer/blocks.ts'
import { flipFlopTiming, isChipTimingLeaf, traceTimingPaths } from '../src/renderer/timing-graph.ts'
import { buildDemoCpu } from '../src/renderer/verilog-cpu-demo.ts'
import { analyzeTiming } from '../src/static-timing.ts'

test('chip timing descends into a hierarchical CPU block to find register-to-register paths', () => {
  const cpu = buildDemoCpu('t')
  const nodes = [{ id: 'cpu', position: { x: 0, y: 0 }, data: { definition: 'block', block: cpu } }]
  const opts = { supplyVoltage: 5, wireCapacitance: 5e-12, defaultInputCapacitance: 120e-12 }
  // Raw (the gap): the CPU is one block → no top-level register-to-register paths
  expect(traceTimingPaths(nodes as never, [] as never, opts).length).toBe(0)
  // Flattened to MOSFET leaves + D flip-flops: internal flops become registers → real finite paths
  const flat = flattenBlocks(nodes as never, [] as never, isChipTimingLeaf)
  const paths = traceTimingPaths(flat.nodes as never, flat.edges as never, opts)
  expect(paths.length).toBeGreaterThan(0)
  expect(paths.every((path) => Number.isFinite(path.logicDelayMax) && path.logicDelayMax > 0)).toBe(
    true,
  )
  const report = analyzeTiming(paths, flipFlopTiming(5, opts), Number.POSITIVE_INFINITY, 0)
  expect(report.maxFrequency).toBeGreaterThan(0)
  expect(Number.isFinite(report.maxFrequency)).toBe(true) // a real clock ceiling, not "no limit"
})
