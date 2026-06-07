import { createContext } from 'react'
import type { World } from '../cross-fk-validator.ts'
import type { Solution } from '../dc-solver.ts'
import { detectFailures } from '../failure-detector.ts'

/**
 * Per-part health for the canvas (Sprint 19) — drives the success / failure
 * feedback. A part that exceeds a rating (per the §19 failure-detector) is
 * `failed` (it bursts on the canvas); an LED carrying current within its rating
 * is `lit` (it glows). Both come from the real solved currents + declared
 * ratings — never faked, per "real all the way down".
 */
export type NodeHealth = { lit?: boolean; failed?: boolean; note?: string }

const LED_DEFINITIONS = new Set(['led', 'led_uv_algan'])
/** 0.1 mA — above this an LED is visibly conducting (so: glowing). */
const LIT_FLOOR_AMPS = 1e-4

/** Map each instance id to its health, from a solved world. Empty if unsolved. */
export function canvasHealth(world: World, solution: Solution): Map<string, NodeHealth> {
  const health = new Map<string, NodeHealth>()
  if (solution.status !== 'solved') return health

  const failures = new Map(detectFailures(world, solution).map((f) => [f.source, f]))
  for (const inst of world.instances.values()) {
    const failure = failures.get(inst.id)
    if (failure) {
      health.set(inst.id, {
        failed: true,
        note: `${failure.ratio.toFixed(1)}× over ${failure.kind.replace(/_/g, ' ')}`,
      })
      continue
    }
    if (LED_DEFINITIONS.has(inst.definition)) {
      const current = Math.abs(solution.branches.get(inst.id) ?? 0)
      if (current > LIT_FLOOR_AMPS) health.set(inst.id, { lit: true })
    }
  }
  return health
}

/** Health by node id, read by each DeviceNode to render its glow / burst. */
export const HealthContext = createContext<Map<string, NodeHealth>>(new Map())
