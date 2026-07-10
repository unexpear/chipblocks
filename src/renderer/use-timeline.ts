import type { Edge, Node } from '@xyflow/react'
import { type MutableRefObject, useCallback, useEffect, useMemo, useState } from 'react'
import type { World } from '../cross-fk-validator.ts'
import { fuseIsIntact, switchIsClosed } from '../dc-solver.ts'
import { solveTransientThermal } from '../electro-thermal.ts'
import { worldWithCastLight } from '../light.ts'
import type { TransientResult } from '../transient-solver.ts'
import { transientRan } from '../transient-solver.ts'
import { groundedComponent } from './canvas-to-world.ts'
import { computeFront } from './front-propagation.ts'
import type { FrontState } from './net-edge.tsx'
import { canvasWorld } from './pipeline/canvas-world.ts'
import { lightCastInputs } from './pipeline/solve-canvas.ts'
import { fastestSourceHz, scopeWindow } from './scope.tsx'
import { scopeRecordSteps } from './scope-scales.ts'
import { clampIndex, type FrameEdge, frameEdgeValues } from './timeline.ts'

/**
 * Timeline playback + the travelling-charge front (Sprint 22), lifted out of the Canvas component. The
 * timeline runs its OWN transient record (independent of the scope) and the playhead scrubs it: the
 * played-back instant becomes per-wire flow + voltage that the wires and the lens range follow WITHOUT
 * the physics re-solving. Front mode replaces the record with the spatial turn-on wave — computed from
 * the wire lengths + the net graph, out from the source nets — played as a synthetic series so the same
 * play / scrub / step controls drive it. Everything moved here VERBATIM; the couplings to the canvas —
 * the nodes/wires, the warm solved world, and the project ambient — are injected, so behaviour is
 * unchanged. `crtTraces` and the lens-state memo stay in App (both are shared with the scope / broader
 * canvas); this hook returns the `frameEdges` the lens range reads.
 */
export function useTimeline(deps: {
  nodes: Node[]
  edges: Edge[]
  solvedWorld: World
  projectAmbientRef: MutableRefObject<number>
}) {
  const { nodes, edges, solvedWorld, projectAmbientRef } = deps
  // Timeline playback (Sprint 22): the panel open + the playhead's position in the
  // scope's transient record (a possibly-fractional index while playing).
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [timelineIndex, setTimelineIndex] = useState(0)
  const [timelineResult, setTimelineResult] = useState<TransientResult | null>(null)
  // Travelling-charge front (Sprint 22): the spatial-propagation view toggle.
  const [frontMode, setFrontMode] = useState(false)

  // The wire endpoints' nets, built once from the solved world, let a played-back frame be turned
  // into per-wire flow + voltage.
  const wireNets = useMemo(() => {
    const map = new Map<string, { netA: string | undefined; netB: string | undefined }>()
    for (const inst of solvedWorld.instances.values()) {
      if (!inst.id.startsWith('wire_')) continue
      const netA = inst.connects?.find((c) => c.terminal === 'terminal_a')?.net
      const netB = inst.connects?.find((c) => c.terminal === 'terminal_b')?.net
      map.set(inst.id.slice('wire_'.length), { netA, netB })
    }
    return map
  }, [solvedWorld])
  // The played-back instant: a point in the scope's transient record chosen by the playhead.
  // null = timeline closed, so the canvas shows the steady solve.
  const playbackFrame = useMemo(() => {
    if (
      !timelineOpen ||
      frontMode ||
      timelineResult === null ||
      !transientRan(timelineResult.status)
    )
      return null
    const series = timelineResult.series
    if (series.length === 0) return null
    return series[clampIndex(timelineIndex, series.length)] ?? null
  }, [timelineOpen, frontMode, timelineResult, timelineIndex])
  // Per-wire display values at that instant — fed to the wires (FrameEdgeContext) and the
  // lens range (in App), so flow + voltage follow the playhead without the physics re-solving.
  const frameEdges = useMemo<Map<string, FrameEdge> | null>(
    () => (playbackFrame ? frameEdgeValues(playbackFrame, edges, wireNets) : null),
    [playbackFrame, edges, wireNets],
  )
  // Travelling-charge front (Sprint 22): the spatial turn-on wave. From the wire lengths + the
  // net graph (a part bridges its terminals instantly), out from the source nets — WHEN the
  // front first reaches every net + how it sweeps each wire.
  const frontData = useMemo(() => {
    const wires = edges.map((e) => ({
      id: e.id,
      netA: wireNets.get(e.id)?.netA,
      netB: wireNets.get(e.id)?.netB,
      lengthM: typeof e.data?.lengthM === 'number' ? e.data.lengthM : 0,
    }))
    const bridges: string[][] = []
    const sourceNets: string[] = []
    for (const inst of solvedWorld.instances.values()) {
      if (inst.id.startsWith('wire_')) continue
      const nets = (inst.connects ?? [])
        .map((c) => c.net)
        .filter((n): n is string => typeof n === 'string')
      if (inst.definition === 'power_source') {
        sourceNets.push(...nets)
        continue
      }
      // An open switch or a blown fuse stops the wave — those terminals don't bridge.
      const openSwitch =
        (inst.definition === 'switch_spst_toggle' || inst.definition === 'switch_spst_momentary') &&
        !switchIsClosed(inst)
      const blownFuse = inst.definition === 'fuse' && !fuseIsIntact(inst)
      if (!openSwitch && !blownFuse && nets.length >= 2) bridges.push(nets)
    }
    const result = computeFront({ wires, bridges, sourceNets })
    // Each part's first-arrival = the earliest the front reaches any of its terminals.
    const partArrival = new Map<string, number>()
    for (const inst of solvedWorld.instances.values()) {
      if (inst.id.startsWith('wire_')) continue
      let earliest = Number.POSITIVE_INFINITY
      for (const connect of inst.connects ?? []) {
        const a = result.arrival.get(connect.net)
        if (a !== undefined && a < earliest) earliest = a
      }
      partArrival.set(inst.id, earliest)
    }
    return { result, partArrival }
  }, [edges, wireNets, solvedWorld])
  // The front plays like a transient — a synthetic series of instants from 0 to the last
  // arrival — so the timeline panel's play / scrub / step drive it with no new controls.
  const frontSeries = useMemo<TransientResult>(() => {
    const max = frontData.result.maxTime
    if (!(max > 0)) {
      return {
        status: 'no-ground',
        series: [],
        ground: undefined,
        warnings: ['No source to send a front from — drop a battery and wire it up.'],
      }
    }
    const frames = 240
    const series = Array.from({ length: frames }, (_, k) => ({
      time: (k / (frames - 1)) * max,
      nodes: new Map<string, number>(),
      currents: new Map<string, number>(),
    }))
    return { status: 'solved', series, ground: undefined, warnings: [] }
  }, [frontData])
  // The front-time the playhead sits at (null when not in front mode) — drives the wire sweep.
  const frontState = useMemo<FrontState | null>(() => {
    if (!frontMode || !timelineOpen || frontSeries.series.length === 0) return null
    const point = frontSeries.series[clampIndex(timelineIndex, frontSeries.series.length)]
    return {
      time: point?.time ?? 0,
      wires: frontData.result.wires,
      partArrival: frontData.partArrival,
    }
  }, [frontMode, timelineOpen, timelineIndex, frontSeries, frontData])
  // The panel plays the transient normally, or the front sweep when front mode is on.
  const displayResult = frontMode ? frontSeries : timelineResult

  // The timeline runs its OWN transient record — independent of the scope, so opening the
  // timeline never pops the scope open (or leaves it lingering when closed). Same physics
  // and honest-sampling guard; it plays the whole record, so it uses the auto window.
  const runTimeline = useCallback(() => {
    const { sources, positions } = lightCastInputs(nodes)
    const world = groundedComponent(
      worldWithCastLight(canvasWorld(nodes, edges).world, positions, sources),
    )
    const auto = scopeWindow(world)
    const fastestHz = fastestSourceHz(world)
    const steps = scopeRecordSteps(auto.duration * 3, fastestHz)
    if (steps === 'span-too-wide') {
      setTimelineResult(null)
      return
    }
    const thermal = solveTransientThermal(world, {
      timeStep: (auto.duration * 3) / steps,
      duration: auto.duration * 3,
      projectAmbientC: projectAmbientRef.current,
    })
    setTimelineResult({
      ...thermal.result,
      warnings: [...thermal.result.warnings, ...thermal.warnings],
    })
  }, [nodes, edges, projectAmbientRef])
  // While the timeline is open it follows the circuit live: any edit re-runs the record.
  useEffect(() => {
    if (timelineOpen) runTimeline()
  }, [timelineOpen, runTimeline])

  return {
    timelineOpen,
    setTimelineOpen,
    timelineIndex,
    setTimelineIndex,
    frontMode,
    setFrontMode,
    frameEdges,
    frontState,
    displayResult,
  }
}
