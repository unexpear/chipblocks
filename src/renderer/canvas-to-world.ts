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
 *    the wires meet there. EVERY ground part's terminal resolves to a SINGLE
 *    shared `ground` net — schematic convention: all ground symbols on a sheet
 *    are the same 0 V node — so the solver pins every grounded sub-circuit, not
 *    just the first one it finds (like a netlister assigning every GND symbol to
 *    node 0).
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

// NUL separates the two halves of a point key because it can't appear in any node id or
// terminal name (ids are auto-generated, block ids are '/'-namespaced, terminal names are
// fixed identifiers), so two distinct (instance, terminal) points can never key to the same
// string. A space could collide — ("a b","x") and ("a","b x") would both be "a b x", silently
// merging two nets and dropping a connection — and '/' is unsafe because block ids contain it.
const SEP = String.fromCharCode(0)
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
    // A light source is environmental, not electrical — it has no terminals and
    // carries no current. The casting pre-pass reads it from the canvas nodes
    // (positions + intensity); it never enters the circuit world.
    if (node.definition === 'light_source') continue
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
  // All ground symbols are the SAME node (0 V reference). The first grounded
  // terminal creates the one ground net; every later one reuses it, so two
  // ground parts on two otherwise-independent sub-circuits share one reference
  // and BOTH get pinned to 0 V. Without this, each ground made its own net and
  // the solver pinned only the first — the rest floated at an arbitrary offset.
  let groundNetId: string | undefined

  // One net per distinct connection point — except grounds, which all collapse
  // to the single shared net above. A handle shared by several wires resolves to
  // the same net (the junction), so the wires genuinely meet there.
  const netForPoint = (instance: string, terminal: string): string => {
    const key = pointKey(instance, terminal)
    const existing = pointNet.get(key)
    if (existing !== undefined) return existing

    const grounded = instances.get(instance)?.definition === 'ground'
    let id: string
    if (grounded && groundNetId !== undefined) {
      id = groundNetId
    } else {
      netCount += 1
      id = `net_${netCount}`
      if (grounded) groundNetId = id
    }
    pointNet.set(key, id)

    let net = nets.get(id)
    if (net === undefined) {
      net = { id, kind: 'net', members: [], ...(grounded ? { type: 'ground' } : {}) }
      nets.set(id, net)
    }
    net.members.push({ instance, terminal })

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
