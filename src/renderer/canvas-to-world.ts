import type { Instance, Net, World } from '../cross-fk-validator.ts'

/**
 * Canvas → World (Sprint 19 S19-v3-21; resistive wires S19-v3-32). The verifiable
 * heart of the live re-solve: turn the canvas's nodes + wires into a solvable
 * World so a dropped, wired, or edited part actually changes the physics.
 *
 *  - Each node becomes a primitive_device instance (its definition + parameters).
 *  - Each wire is a REAL 2-terminal element. Instead of merging its two endpoints
 *    into one ideal node, each connection point (instance, terminal) becomes its
 *    own net and the wire is materialized as a `wire` instance between them,
 *    carrying its real series resistance (R = ρL/A, passed in from how it is
 *    drawn). So a wire drops a real I·R voltage in the solve — long/thin/loaded
 *    wires droop, exactly like the battery's internal resistance.
 *  - A connection point shared by several wires (a junction handle) is ONE net —
 *    the wires meet there. A net is `ground` when its component terminal belongs
 *    to a ground part, giving the solver its 0 V reference.
 *  - `resistanceOhms` absent ⇒ an ideal 0 Ω short (a bare-edge test wire stays
 *    ideal, so the solved physics is identical to a plain net merge).
 *
 * The wire instance id is `wire_<edgeId>` (or `wire_<n>` for an id-less edge), so
 * the canvas can read each wire's own solved branch current via `wireFlow`.
 *
 * solveDC reads only world.instances + world.nets, so the other maps are empty.
 */

export type CanvasNode = { id: string; definition: string; parameters?: Instance['parameters'] }
export type CanvasEdge = {
  id?: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  /**
   * Real series resistance of this wire in ohms (from its drawn length × the
   * conductor's ρ/A). Absent ⇒ an ideal 0 Ω short.
   */
  resistanceOhms?: number
}

const SEP = ' '
const pointKey = (instance: string, terminal: string) => `${instance}${SEP}${terminal}`
const scalarParam = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })

export function canvasToWorld(nodes: CanvasNode[], edges: CanvasEdge[]): World {
  const instances = new Map<string, Instance>()
  for (const node of nodes) {
    // A junction is a pure tie point, not an electrical element: every wire
    // touching its handle resolves to ONE net below (netForPoint), which is
    // the whole job — current passes through the shared net by KCL, with
    // nothing to stamp. So no instance is created for it.
    if (node.definition === 'junction') continue
    instances.set(node.id, {
      id: node.id,
      kind_ref: 'primitive_device',
      definition: node.definition,
      ...(node.parameters ? { parameters: node.parameters } : {}),
    })
  }
  const junctions = new Set(nodes.filter((n) => n.definition === 'junction').map((n) => n.id))

  const nets = new Map<string, Net>()
  const pointNet = new Map<string, string>()
  let netCount = 0

  // One net per distinct connection point. A handle shared by several wires
  // resolves to the same net (the junction), so the wires genuinely meet there.
  // The net is grounded iff its component terminal belongs to a ground part.
  const netForPoint = (instance: string, terminal: string): string => {
    const key = pointKey(instance, terminal)
    const existing = pointNet.get(key)
    if (existing !== undefined) return existing

    netCount += 1
    const id = `net_${netCount}`
    pointNet.set(key, id)
    const grounded = instances.get(instance)?.definition === 'ground'
    nets.set(id, {
      id,
      kind: 'net',
      members: [{ instance, terminal }],
      ...(grounded ? { type: 'ground' } : {}),
    })
    const inst = instances.get(instance)
    if (inst) {
      inst.connects ??= []
      inst.connects.push({ net: id, terminal, of: instance })
    }
    return id
  }

  let wireCount = 0
  const isEndpoint = (id: string) => instances.has(id) || junctions.has(id)
  for (const edge of edges) {
    if (!edge.sourceHandle || !edge.targetHandle) continue // need both terminals
    if (!isEndpoint(edge.source) || !isEndpoint(edge.target)) continue

    const netA = netForPoint(edge.source, edge.sourceHandle)
    const netB = netForPoint(edge.target, edge.targetHandle)
    wireCount += 1
    const wireId = edge.id ? `wire_${edge.id}` : `wire_${wireCount}`
    const resistance = edge.resistanceOhms

    instances.set(wireId, {
      id: wireId,
      kind_ref: 'primitive_device',
      definition: 'wire',
      // A real resistance ⇒ a real I·R drop; absent ⇒ an ideal 0 Ω short.
      ...(resistance !== undefined
        ? { parameters: { resistance: scalarParam(resistance, 'ohm') } }
        : {}),
      connects: [
        { net: netA, terminal: 'terminal_a', of: wireId },
        { net: netB, terminal: 'terminal_b', of: wireId },
      ],
    })
    nets.get(netA)?.members.push({ instance: wireId, terminal: 'terminal_a' })
    nets.get(netB)?.members.push({ instance: wireId, terminal: 'terminal_b' })
  }

  return {
    instances,
    nets,
    definitions: new Map(),
    behaviors: new Map(),
    activeVariables: new Map(),
  }
}

/**
 * The ground-connected part of a world (S19-v3-61). Free-floating sections —
 * possible now that wires can start and end in open space — have genuinely
 * UNDEFINED voltages relative to ground (and would make the solve singular),
 * so the display solve covers only what ground can reach; floating pieces sit
 * honestly idle instead of killing the whole canvas. The multimeter keeps the
 * FULL world: its Ω/capacitance rigs bring their own reference, so floating
 * sections measure fine there.
 *
 * Reachability walks elements: an instance whose ANY net is reached pulls all
 * its nets in. No ground at all returns the world unchanged (the solver's
 * no-ground status already reports that case honestly).
 */
export function groundedComponent(world: World): World {
  const groundNets = [...world.nets.values()].filter((n) => n.type === 'ground').map((n) => n.id)
  if (groundNets.length === 0) return world

  const reachedNets = new Set<string>(groundNets)
  const keptInstances = new Set<string>()
  let grew = true
  while (grew) {
    grew = false
    for (const inst of world.instances.values()) {
      if (keptInstances.has(inst.id)) continue
      const nets = (inst.connects ?? []).map((c) => c.net)
      if (nets.length === 0) continue
      if (!nets.some((n) => reachedNets.has(n))) continue
      keptInstances.add(inst.id)
      for (const n of nets) {
        if (!reachedNets.has(n)) {
          reachedNets.add(n)
          grew = true
        }
      }
    }
  }

  const instances = new Map([...world.instances].filter(([id]) => keptInstances.has(id)))
  const nets = new Map([...world.nets].filter(([id]) => reachedNets.has(id)))
  return { ...world, instances, nets }
}
