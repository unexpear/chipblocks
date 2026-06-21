import { SPEED_OF_LIGHT_M_S } from '../field-energy.ts'

/**
 * Travelling-charge front (Sprint 22) — the spatial turn-on wave.
 *
 * When a source is connected the signal does NOT fill the circuit at once: it
 * leaves the source terminals and runs down the wires at a finite speed,
 * reaching each part in the order the wire lengths dictate — a far bulb lights
 * LAST, when the front actually arrives, not the instant the switch closes
 * ("when does the bulb light"). This computes WHEN the front first reaches every
 * net, and how it sweeps along each wire, by a shortest-TIME walk (Dijkstra) out
 * from the source nets: a wire costs its length ÷ the signal speed; a part
 * bridges its own terminal nets instantly (its body is tiny next to the wire
 * runs). The timeline plays this back, slowed from nanoseconds to a watchable pace.
 *
 * Honest scope (v1): the leading edge / first-arrival time only; parts as instant
 * bridges; every wired path carries the front. Reflections off mismatched ends,
 * a part's own propagation, and elements that BLOCK the wave (an open switch, a
 * blown fuse) are refinements — today every drawn part passes the front through.
 */

/**
 * Velocity factor of an ordinary drawn wire: ~2/3 c — representative of typical
 * insulated hookup wire / cable. (Open wire in air runs faster, ~0.95 c; a PCB
 * trace slower, ~0.5–0.6 c — see the propagates-at-finite-speed behaviour and the
 * transmission-line part's own velocity_factor.) `c` is the one shared constant.
 */
export const WIRE_VELOCITY_FACTOR = 0.66

/** Time (seconds) for the front to run the length of a wire. */
export function wireDelaySeconds(lengthM: number): number {
  return Math.max(0, lengthM) / (SPEED_OF_LIGHT_M_S * WIRE_VELOCITY_FACTOR)
}

export type FrontWire = {
  id: string
  netA: string | undefined
  netB: string | undefined
  lengthM: number
}
export type FrontInput = {
  wires: FrontWire[]
  /** Each non-source part bridges its terminal nets instantly (the front passes through). */
  bridges: string[][]
  /** Nets energized at t = 0 — the source terminals the wave starts from. */
  sourceNets: string[]
}

/** How the front crosses one wire: when it enters, when it exits, from which end. */
export type WireFront = {
  entryTime: number
  exitTime: number
  delay: number
  /** True when the front enters from terminal_a's end (the earlier-reached end). */
  entryFromA: boolean
  /** False when the wire is on a floating section the front never reaches. */
  reached: boolean
}

export type FrontResult = {
  /** Net → first-arrival time of the front (seconds). */
  arrival: Map<string, number>
  /** Wire (edge) id → how the front sweeps it. */
  wires: Map<string, WireFront>
  /** When the last part is reached (seconds) — the full sweep duration. */
  maxTime: number
}

/**
 * First-arrival time of the front at every net, and its sweep across every wire.
 * A Dijkstra out from the source nets: wires cost length ÷ speed, part bridges
 * cost zero. Floating sections (never reached) come back with reached = false.
 */
export function computeFront(input: FrontInput): FrontResult {
  const adjacency = new Map<string, { net: string; cost: number }[]>()
  const link = (a: string, b: string, cost: number) => {
    if (!adjacency.has(a)) adjacency.set(a, [])
    if (!adjacency.has(b)) adjacency.set(b, [])
    adjacency.get(a)?.push({ net: b, cost })
    adjacency.get(b)?.push({ net: a, cost })
  }
  for (const wire of input.wires) {
    if (wire.netA === undefined || wire.netB === undefined) continue
    link(wire.netA, wire.netB, wireDelaySeconds(wire.lengthM))
  }
  for (const bridge of input.bridges) {
    for (let i = 0; i < bridge.length; i++) {
      for (let j = i + 1; j < bridge.length; j++) {
        const a = bridge[i]
        const b = bridge[j]
        if (a !== undefined && b !== undefined) link(a, b, 0)
      }
    }
  }

  const arrival = new Map<string, number>()
  const frontier: { net: string; t: number }[] = []
  for (const net of input.sourceNets) {
    if (!arrival.has(net)) {
      arrival.set(net, 0)
      frontier.push({ net, t: 0 })
    }
  }
  const settled = new Set<string>()
  while (frontier.length > 0) {
    let best = 0
    for (let i = 1; i < frontier.length; i++) {
      if ((frontier[i]?.t ?? 0) < (frontier[best]?.t ?? 0)) best = i
    }
    const current = frontier.splice(best, 1)[0]
    if (current === undefined || settled.has(current.net)) continue
    settled.add(current.net)
    for (const edge of adjacency.get(current.net) ?? []) {
      const next = current.t + edge.cost
      if (next < (arrival.get(edge.net) ?? Number.POSITIVE_INFINITY)) {
        arrival.set(edge.net, next)
        frontier.push({ net: edge.net, t: next })
      }
    }
  }

  const wires = new Map<string, WireFront>()
  let maxTime = 0
  for (const wire of input.wires) {
    const tA =
      wire.netA !== undefined
        ? (arrival.get(wire.netA) ?? Number.POSITIVE_INFINITY)
        : Number.POSITIVE_INFINITY
    const tB =
      wire.netB !== undefined
        ? (arrival.get(wire.netB) ?? Number.POSITIVE_INFINITY)
        : Number.POSITIVE_INFINITY
    const entryTime = Math.min(tA, tB)
    const reached = Number.isFinite(entryTime)
    const delay = wireDelaySeconds(wire.lengthM)
    const exitTime = reached ? entryTime + delay : Number.POSITIVE_INFINITY
    wires.set(wire.id, { entryTime, exitTime, delay, entryFromA: tA <= tB, reached })
    if (reached && exitTime > maxTime) maxTime = exitTime
  }
  for (const t of arrival.values()) {
    if (Number.isFinite(t) && t > maxTime) maxTime = t
  }
  return { arrival, wires, maxTime }
}

/** Fraction (0..1) the front has swept along a wire at front-time `t`, from its entry end. */
export function frontFraction(wire: WireFront, t: number): number {
  if (!wire.reached || t <= wire.entryTime) return 0
  if (wire.delay <= 0 || t >= wire.exitTime) return 1
  return (t - wire.entryTime) / wire.delay
}
