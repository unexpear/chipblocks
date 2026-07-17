/**
 * Chip-level timing sign-off must descend into a hierarchical block. A CPU placed as a single block has all
 * its registers INSIDE it, so the raw top-level trace finds no register-to-register paths (it sees one block).
 * Flattening the design to gates + D flip-flops first — the same descent the silicon-area analysis does —
 * exposes the internal paths, so the chip view can report a real max clock. This guards that RTL→silicon
 * translation (found + fixed while promoting the Verilog CPU into the Chip workspace).
 */

import { expect, test } from 'vitest'
import { flattenBlocks } from '../src/renderer/blocks.ts'
import { isLogicGate } from '../src/renderer/logic-sim.ts'
import { flipFlopTiming, traceTimingPaths } from '../src/renderer/timing-graph.ts'
import { buildDemoCpu } from '../src/renderer/verilog-cpu-demo.ts'
import { analyzeTiming } from '../src/static-timing.ts'

test('chip timing descends into a hierarchical CPU block to find register-to-register paths', () => {
  const cpu = buildDemoCpu('t')
  const nodes = [{ id: 'cpu', position: { x: 0, y: 0 }, data: { definition: 'block', block: cpu } }]
  const opts = { supplyVoltage: 5, wireCapacitance: 5e-12, defaultInputCapacitance: 120e-12 }
  // Raw (the gap): the CPU is one block → no top-level register-to-register paths
  expect(traceTimingPaths(nodes as never, [] as never, opts).length).toBe(0)
  // Flattened to gates + D flip-flops (the fix): the internal flops become registers → real paths appear
  const flat = flattenBlocks(
    nodes as never,
    [] as never,
    (b) => isLogicGate(b) || b.name === 'D Flip-Flop',
  )
  const paths = traceTimingPaths(flat.nodes as never, flat.edges as never, opts)
  expect(paths.length).toBeGreaterThan(0)
  const report = analyzeTiming(paths, flipFlopTiming(5, opts), Number.POSITIVE_INFINITY, 0)
  expect(report.maxFrequency).toBeGreaterThan(0)
  expect(Number.isFinite(report.maxFrequency)).toBe(true) // a real clock ceiling, not "no limit"
})
