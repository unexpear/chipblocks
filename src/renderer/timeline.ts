/**
 * Timeline playback (Sprint 22) — pure helpers.
 *
 * The timeline does NOT re-solve. It plays back the transient the scope already
 * computed (its `series` of solved instants) and paints the live canvas at the
 * chosen instant: every wire's flow + voltage follows that frame, so you watch
 * the current rise, reverse, and settle — and see how a short or a wrong value
 * reshapes it — without the physics ever recomputing. The visuals read the
 * frame; the steady solve the meter/Math/worst-case use is untouched.
 *
 * One series point carries node voltages (`nodes`) and the per-terminal currents
 * the solve recorded (`currents`, keyed `instanceId/terminal`). A canvas wire is
 * the instance `wire_<edgeId>`; its recorded `terminal_a` current IS its branch
 * current (the a→b convention `wireFlow`/the DC `branches` map use), so the flow
 * arrow and magnitude come straight out of the frame with no guesswork.
 */

/** One solved instant — what a transient `series` point gives us. */
export type FramePoint = {
  nodes: Map<string, number>
  currents?: Map<string, number>
}

/** A wire's display values at one frame — the same fields `edgePhysics` puts on
 *  an edge from the steady solve, recomputed for the played-back instant. */
export type FrameEdge = {
  /** Current magnitude (amperes, ≥ 0). */
  amps: number
  /** Conventional current flows from the edge's source toward its target. */
  sourceToTarget: boolean
  /** True when this wire carries a live current at this instant. */
  carries: boolean
  /** The wire's two end potentials (volts) — drives the voltage lens + probe. */
  vSource: number | null
  vTarget: number | null
  /** The real I·R drop across the wire (magnitude, volts); null when idle. */
  drop: number | null
}

/** The wire endpoints' nets, per edge id — built once from the solved world. */
export type WireNets = Map<string, { netA: string | undefined; netB: string | undefined }>

const FLOOR_AMPS = 1e-12

/**
 * Per-edge display values at one frame. Mirrors `edgePhysics` exactly, but reads
 * the wire's branch current from the frame's recorded `terminal_a` current and
 * its end potentials from the frame's node voltages. The sign convention matches
 * `wireFlow(solution, wire, true)`: a positive branch flows terminal_a → b, so
 * with the edge's source on the positive (terminal_a) side, current runs
 * source → target while the branch is positive.
 */
export function frameEdgeValues(
  frame: FramePoint,
  edges: { id: string; data?: { ohms?: unknown } }[],
  wireNets: WireNets,
): Map<string, FrameEdge> {
  const out = new Map<string, FrameEdge>()
  for (const edge of edges) {
    const branch = frame.currents?.get(`wire_${edge.id}/terminal_a`) ?? 0
    const magnitude = Math.abs(branch)
    const carries = magnitude > FLOOR_AMPS
    const ohms = typeof edge.data?.ohms === 'number' ? edge.data.ohms : 0
    const nets = wireNets.get(edge.id)
    const vSource = nets?.netA !== undefined ? (frame.nodes.get(nets.netA) ?? null) : null
    const vTarget = nets?.netB !== undefined ? (frame.nodes.get(nets.netB) ?? null) : null
    out.set(edge.id, {
      amps: magnitude,
      sourceToTarget: branch >= 0,
      carries,
      vSource,
      vTarget,
      drop: carries ? magnitude * ohms : null,
    })
  }
  return out
}

/**
 * The voltage range and biggest current across a frame's wires — the inputs the
 * lens state derives vMin/vMax (voltage map) and the field contour level from.
 * Mirrors the steady lens-state memo's edge loop, reading the frame instead.
 */
export function frameLensRange(frameEdges: Map<string, FrameEdge>): {
  vMin: number
  vMax: number
  maxAbsAmps: number
} {
  let vMin = Number.POSITIVE_INFINITY
  let vMax = Number.NEGATIVE_INFINITY
  let maxAbsAmps = 0
  for (const fe of frameEdges.values()) {
    for (const v of [fe.vSource, fe.vTarget]) {
      if (typeof v === 'number') {
        if (v < vMin) vMin = v
        if (v > vMax) vMax = v
      }
    }
    if (fe.carries && fe.amps > maxAbsAmps) maxAbsAmps = fe.amps
  }
  if (!(vMax >= vMin)) {
    vMin = 0
    vMax = 0
  }
  return { vMin, vMax, maxAbsAmps }
}

/** Clamp a (possibly fractional) playhead to a valid integer series index. */
export function clampIndex(index: number, seriesLength: number): number {
  if (seriesLength <= 0) return 0
  return Math.min(seriesLength - 1, Math.max(0, Math.round(index)))
}
