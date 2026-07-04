import type { Instance, World } from './cross-fk-validator.ts'

/**
 * Multi-circuit support: a canvas can hold several independent circuits at once, and one of them
 * being unfinished must not kill the others. Electrically, a sub-circuit with no path to the ground
 * reference has no defined node voltages — in matrix terms it makes the WHOLE solve singular, so
 * before this pass a single floating resistor anywhere took down every healthy circuit on the
 * canvas. The fix is honest partitioning, not guessing: connected components are found over the
 * instance↔net graph (drawn wires are instances, so wired connectivity counts; every ground symbol
 * already shares one net, so separately-grounded circuits legitimately solve together as one
 * matrix, the EDA node-0 convention); components with no path to the identified ground are REMOVED
 * from the world the solver sees, each with a note naming its parts — never silently, never given
 * made-up voltages. Ground the floating circuit (or wire it to a grounded one) and it solves again.
 */
export function pruneFloatingCircuits(
  world: World,
  groundNetId: string,
): { world: World; notes: string[] } {
  // Union-find over net ids; every instance unites the nets its terminals touch. `find` is
  // iterative (walk to the root, then re-walk to compress) — a long series chain of nets builds an
  // O(N)-deep parent chain in drawing order, and a recursive find would blow the call stack at
  // chip-scale canvases, crashing the solve instead of solving it.
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let root = x
    for (let p = parent.get(root); p !== undefined && p !== root; p = parent.get(root)) root = p
    let cur = x
    while (cur !== root) {
      const next = parent.get(cur) as string
      parent.set(cur, root)
      cur = next
    }
    return root
  }
  const union = (a: string, b: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const netId of world.nets.keys()) if (!parent.has(netId)) parent.set(netId, netId)
  for (const inst of world.instances.values()) {
    const nets = (inst.connects ?? []).map((c) => c.net)
    for (let i = 1; i < nets.length; i++) {
      const a = nets[0]
      const b = nets[i]
      if (a !== undefined && b !== undefined) union(a, b)
    }
  }

  const groundRoot = find(groundNetId)
  const keptNets = new Map([...world.nets].filter(([id]) => find(id) === groundRoot))
  if (keptNets.size === world.nets.size) return { world, notes: [] }

  // Instances live with their nets; ones with no connects are catalog metadata, never stamped —
  // they stay so nothing downstream loses sight of them.
  const keptInstances = new Map<string, Instance>()
  const droppedByComponent = new Map<string, string[]>()
  for (const [id, inst] of world.instances) {
    const firstNet = inst.connects?.[0]?.net
    if (firstNet === undefined || find(firstNet) === groundRoot) {
      keptInstances.set(id, inst)
      continue
    }
    const root = find(firstNet)
    const list = droppedByComponent.get(root)
    if (list) list.push(id)
    else droppedByComponent.set(root, [id])
  }

  const notes: string[] = []
  for (const ids of droppedByComponent.values()) {
    // Drawn wires are connections, not parts — name the real parts of the floating circuit.
    const parts = ids.filter((id) => world.instances.get(id)?.definition !== 'wire')
    const named = parts.slice(0, 4).join(', ') + (parts.length > 4 ? ', …' : '')
    // "No path to the reference", not "has no ground": in a hand-built world with several
    // type:'ground' nets only the FIRST is the pinned reference, so a circuit on the second one is
    // unreachable-from-the-reference, not ungrounded — the note must not give wrong advice there.
    // (The canvas can't produce that case — every drawn ground symbol shares one net.)
    notes.push(
      `Separate circuit (${named.length > 0 ? named : ids[0]}) has no path to the solve's ground reference — not solved. Ground it (or wire it to the grounded circuit) and it solves independently alongside the others.`,
    )
  }
  return {
    world: {
      definitions: world.definitions,
      instances: keptInstances,
      behaviors: world.behaviors,
      activeVariables: world.activeVariables,
      nets: keptNets,
    },
    notes,
  }
}
