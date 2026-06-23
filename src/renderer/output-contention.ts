import { type BlockPort, type DriveKind, isOutputDrive } from './blocks.ts'

/**
 * Output / driver-contention checks — the real "which outputs can be tied together" rules from logic
 * chips, microcontrollers, and shared buses.
 *
 * It runs on the CANVAS (block pins typed with a drive kind in the pinout editor + the wires between
 * them), BEFORE flattening, because it's the block PINS that carry the drive type. For each net — a
 * group of pins joined by wires — it gathers the OUTPUT pins and applies the textbook matrix:
 *
 *   - two+ outputs where ANY is push-pull → CONTENTION (error): one normal output drives high while
 *     another drives low = a dead short from the supply to ground. Only one push-pull per wire.
 *   - all open-collector / open-drain     → a wire-AND. Safe ONLY with a pull-up to the positive
 *     rail: we trace a resistor directly on the supply's + net AND, for indirect / multi-hop
 *     pull-ups, trust the solved bus voltage (a high bus = it is being pulled up). Neither → caution.
 *   - all tri-state                       → a shared bus. Only bad at the MOMENTS two are enabled at
 *     once, so we read each output's enable pin from the LIVE solved circuit (the `live` arg) and
 *     count how many are on: ≥2 on = real contention (error); enables unknown = caution.
 *   - one output + any inputs / passives  → fine (the normal case).
 *
 * Inputs and untyped pins never drive, so they never contend. One finding is returned per offending
 * net. Structural except for the tri-state enable levels, which come from the solve via `live`.
 */

export type ContentionCode =
  | 'output-contention'
  | 'open-collector-no-pullup'
  | 'tristate-contention'
  | 'tristate-bus'
  | 'mixed-output-bus'

export type ContentionFinding = {
  severity: 'error' | 'warning'
  code: ContentionCode
  message: string
  /** The output pins sharing the net — used to mark the involved blocks on the canvas. */
  pins: { nodeId: string; portId: string }[]
}

type NodeLike = { id: string; data?: { definition?: string; block?: { ports?: BlockPort[] } } }
type EdgeLike = {
  source: string
  sourceHandle?: string | null
  target: string
  targetHandle?: string | null
}

/** The live solved state a tri-state needs: each terminal's volts (keyed `${instId}/${terminal}`, the
 *  meter.tsx convention) + the logic threshold (≈ Vcc/2) that splits "high" from "low". */
export type LiveLevels = { terminalVoltages: ReadonlyMap<string, number>; threshold: number }

const SEP = ' '
export const endpointKey = (nodeId: string, handleId: string) => `${nodeId}${SEP}${handleId}`
export const nodeOfEndpoint = (endpoint: string) => endpoint.slice(0, endpoint.indexOf(SEP))
export const handleOfEndpoint = (endpoint: string) => endpoint.slice(endpoint.indexOf(SEP) + 1)

/** Union-find over wired endpoints → a rootOf() for any wired endpoint + the connected nets.
 *  Shared with the static-timing path tracer (timing-graph.ts), which walks these same nets. */
export function buildNets(edges: EdgeLike[]): {
  rootOf: (endpoint: string) => string | undefined
  groups: string[][]
} {
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    const p = parent.get(x)
    if (p === undefined || p === x) {
      parent.set(x, x)
      return x
    }
    const root = find(p)
    parent.set(x, root)
    return root
  }
  const union = (a: string, b: string) => {
    parent.set(find(a), find(b))
  }
  for (const e of edges) {
    if (!e.sourceHandle || !e.targetHandle) continue
    union(endpointKey(e.source, e.sourceHandle), endpointKey(e.target, e.targetHandle))
  }
  const groups = new Map<string, string[]>()
  for (const x of parent.keys()) {
    const root = find(x)
    const g = groups.get(root)
    if (g) g.push(x)
    else groups.set(root, [x])
  }
  const rootOf = (endpoint: string) => (parent.has(endpoint) ? find(endpoint) : undefined)
  return { rootOf, groups: [...groups.values()] }
}

/** enabled: true = driving now, false = high-Z now, undefined = can't tell (no enable set / no solve). */
type NetOutput = {
  nodeId: string
  portId: string
  drive: DriveKind
  enabled?: boolean
  /** The bus-voltage key (innerInstance/innerTerminal) for the live multi-hop pull-up check. */
  innerKey?: string
}

/**
 * Apply the driver-contention matrix to the output pins on ONE net. `hasPullUp` says whether a real
 * pull-up resistor to the positive rail was found (makes an open-collector bus safe); each tri-state
 * output carries its live `enabled` state. Returns null when there's no conflict.
 */
export function classifyNet(outputs: NetOutput[], hasPullUp = false): ContentionFinding | null {
  if (outputs.length < 2) return null
  const pins = outputs.map(({ nodeId, portId }) => ({ nodeId, portId }))
  const kinds = new Set(outputs.map((o) => o.drive))
  const n = outputs.length
  if (kinds.has('push_pull')) {
    return {
      severity: 'error',
      code: 'output-contention',
      message: `${n} outputs are wired together and at least one is a normal (push-pull) output — they fight: one drives high while another drives low, a dead short from the supply to ground. Only one push-pull output may drive a wire.`,
      pins,
    }
  }
  if (kinds.size === 1 && kinds.has('open_collector')) {
    if (hasPullUp) return null // a wire-AND WITH its pull-up — a correct design, no flag
    return {
      severity: 'warning',
      code: 'open-collector-no-pullup',
      message: `${n} open-collector / open-drain outputs share this wire (a wire-AND) with no pull-up resistor to the positive rail — the high level floats (it is undefined). Add a pull-up resistor.`,
      pins,
    }
  }
  if (kinds.size === 1 && kinds.has('tristate')) {
    const enabledNow = outputs.filter((o) => o.enabled === true).length
    if (enabledNow >= 2) {
      return {
        severity: 'error',
        code: 'tristate-contention',
        message: `${enabledNow} tri-state outputs are enabled (switched on) onto this bus at the same time — they fight, exactly like two normal outputs. Only one may be enabled at a time; the rest must be in high-Z.`,
        pins,
      }
    }
    if (outputs.some((o) => o.enabled === undefined)) {
      return {
        severity: 'warning',
        code: 'tristate-bus',
        message: `${n} tri-state outputs share this bus. Allowed, but only safe if exactly one is enabled at a time — set each output's enable pin (in the pinout editor) so this can be checked against the live circuit.`,
        pins,
      }
    }
    return null // every enable known and at most one on → safe in this state
  }
  return {
    severity: 'warning',
    code: 'mixed-output-bus',
    message: `${n} outputs of different open-bus types share this wire — make sure their drive types and pull-ups are compatible.`,
    pins,
  }
}

/** Is this tri-state output enabled right now? Reads its enable pin's solved level from `live`. */
function tristateEnabled(
  ports: BlockPort[],
  blockNodeId: string,
  enable: { pin: string; activeHigh: boolean },
  live: LiveLevels,
): boolean | undefined {
  const enablePort = ports.find((p) => p.id === enable.pin)
  if (enablePort === undefined) return undefined
  // The enable pin's inner terminal becomes world instance `${blockNodeId}.${innerNode}`, terminal
  // `innerHandle` (the flattenBlocks namespacing) — the meter.tsx terminalVoltages key.
  const key = `${blockNodeId}.${enablePort.inner.nodeId}/${enablePort.inner.handleId}`
  const level = live.terminalVoltages.get(key)
  if (level === undefined) return undefined
  return enable.activeHigh ? level > live.threshold : level < live.threshold
}

/** Walk the canvas nets and return every output-contention finding (empty when all is well). */
export function detectOutputContention(
  nodes: NodeLike[],
  edges: EdgeLike[],
  live?: LiveLevels,
): ContentionFinding[] {
  const outputInfo = new Map<
    string,
    { drive: DriveKind; enabled: boolean | undefined; innerKey: string }
  >()
  for (const node of nodes) {
    const ports = node.data?.block?.ports
    if (!ports) continue
    for (const port of ports) {
      if (!isOutputDrive(port.drive)) continue
      const enabled =
        port.drive === 'tristate' && port.enable && live
          ? tristateEnabled(ports, node.id, port.enable, live)
          : undefined
      const innerKey = `${node.id}.${port.inner.nodeId}/${port.inner.handleId}`
      outputInfo.set(endpointKey(node.id, port.id), { drive: port.drive, enabled, innerKey })
    }
  }
  if (outputInfo.size === 0) return []

  const { rootOf, groups } = buildNets(edges)
  const defOf = new Map(nodes.map((n) => [n.id, n.data?.definition]))

  // Positive rails: the nets carrying a power source's + terminal — the only place a pull-up pulls to.
  const positiveRailRoots = new Set<string>()
  for (const node of nodes) {
    if (node.data?.definition !== 'power_source') continue
    const root = rootOf(endpointKey(node.id, 'terminal_positive'))
    if (root !== undefined) positiveRailRoots.add(root)
  }

  // Resistor endpoints grouped by resistor — a pull-up is a resistor bridging a bus net to a + rail.
  const resistorEndpoints = new Map<string, string[]>()
  for (const group of groups) {
    for (const endpoint of group) {
      if (defOf.get(nodeOfEndpoint(endpoint)) !== 'resistor') continue
      const list = resistorEndpoints.get(nodeOfEndpoint(endpoint))
      if (list) list.push(endpoint)
      else resistorEndpoints.set(nodeOfEndpoint(endpoint), [endpoint])
    }
  }

  const netHasPullUp = (netRoot: string): boolean => {
    if (positiveRailRoots.size === 0) return false
    for (const endpoints of resistorEndpoints.values()) {
      const roots = endpoints.map((e) => rootOf(e)).filter((r): r is string => r !== undefined)
      if (roots.includes(netRoot) && roots.some((r) => r !== netRoot && positiveRailRoots.has(r))) {
        return true
      }
    }
    return false
  }

  const findings: ContentionFinding[] = []
  for (const group of groups) {
    const outputs: NetOutput[] = []
    for (const endpoint of group) {
      const info = outputInfo.get(endpoint)
      if (info === undefined) continue
      const output: NetOutput = {
        nodeId: nodeOfEndpoint(endpoint),
        portId: handleOfEndpoint(endpoint),
        drive: info.drive,
        innerKey: info.innerKey,
      }
      if (info.enabled !== undefined) output.enabled = info.enabled
      outputs.push(output)
    }
    if (outputs.length < 2) continue
    const first = group[0]
    const root = first === undefined ? undefined : rootOf(first)
    let pullUp = root !== undefined && netHasPullUp(root)
    if (!pullUp && live !== undefined) {
      // Indirect / multi-hop pull-up: the structural trace only sees a resistor sitting DIRECTLY on
      // the supply's + net. Trust the SOLVER for the rest — an open-collector output can only pull
      // LOW, so a bus that actually sits at logic HIGH must be pulled up (however many hops away).
      // Only the pure open-collector branch of classifyNet acts on this.
      const innerKey = outputs.map((o) => o.innerKey).find((k) => k !== undefined)
      const busVolts = innerKey === undefined ? undefined : live.terminalVoltages.get(innerKey)
      if (busVolts !== undefined && busVolts >= live.threshold) pullUp = true
    }
    const finding = classifyNet(outputs, pullUp)
    if (finding) findings.push(finding)
  }
  return findings
}
