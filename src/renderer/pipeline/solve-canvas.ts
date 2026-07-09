/**
 * The canvas → solver orchestration + engine dispatch. Given the drawn nodes + edges, these adapters
 * lower the canvas to a World (canvas-world.ts), fold in cast light, run the right engine, and fold the
 * result back into the shapes the UI reads — wire currents, part health, readings, temperatures. The
 * DISPATCH (solveCanvasDispatch / solveTransientDispatch) reads the partition predicates (partition.ts)
 * to route: a purely-digital canvas to the fast 0/1 logic engine, an analog canvas to the transistor-
 * level solve, and a mixed canvas to the co-simulation that splits it at the logic↔analog boundary and
 * co-advances the two. Lifted verbatim out of App.tsx — UI-free (no React state); the component calls
 * solveCanvasDispatch / solveTransientDispatch / lightCastInputs.
 */

import { type Edge, MarkerType, type Node } from '@xyflow/react'
import type { Instance, World } from '../../cross-fk-validator.ts'
import type { Solution } from '../../dc-solver.ts'
import { solveTransientThermal } from '../../electro-thermal.ts'
import { readScalarParam } from '../../instance-params.ts'
import { type LightSource, worldWithCastLight } from '../../light.ts'
import { type RelayState, solveWithRelays } from '../../relay.ts'
import type { ShockleyDiodeState } from '../../shockley-diode.ts'
import { STANDARD_AMBIENT_C } from '../../thermal-model.ts'
import { solveTransient, type TransientResult } from '../../transient-solver.ts'
import {
  type BlockData,
  type CanvasEdgeLike as BlockEdgeLike,
  type CanvasNodeLike as BlockNodeLike,
  bubbleBlockHealth,
  type DriveKind,
} from '../blocks.ts'
import { type canvasToWorld, groundedComponent } from '../canvas-to-world.ts'
import { wireFlow } from '../edge-currents.ts'
import { canvasHealth, type NodeHealth } from '../health.ts'
import { digitalSeed, simulateLogic } from '../logic-sim.ts'
import { terminalVoltages } from '../meter.tsx'
import type { Point } from '../net-edge.tsx'
import type { LiveLevels } from '../output-contention.ts'
import { buildCrtTraces, type CrtSpot, type PartReading, partReadings } from '../part-readings.ts'
import type { DeviceNodeData } from '../symbols.tsx'
import { THEME } from '../theme.ts'
import { canvasWorld, userPartAliases } from './canvas-world.ts'
import { ANALOG_PASSIVE, classifyCanvas, findBridges, isLogicFidelity } from './partition.ts'

/** Wire colours: a live (current-carrying) wire vs an idle tap — lifted with edgePhysics from App.tsx. */
const CURRENT = THEME.accentBlue
const IDLE = THEME.textFaint

/** The declared drive of a logic block's port (push-pull / open-collector / tri-state / input) — what
 *  findBridges needs to tell whether a boundary pin drives the analog or reads it. undefined when the
 *  node isn't a block or the handle isn't one of its ports. */
const portDriveOf = (
  nodeById: Map<string, Node>,
  logicId: string,
  handle: string,
): DriveKind | undefined =>
  (nodeById.get(logicId)?.data as { block?: BlockData } | undefined)?.block?.ports.find(
    (p) => p.id === handle,
  )?.drive

/**
 * Physics-derived React Flow edge fields for one wire: the current arrow +
 * magnitude, its length + resistance, and the real I·R voltage drop — all read
 * from the wire's OWN solved branch (each canvas wire is now a real `wire_<edgeId>`
 * element in the solve, not an ideal merge), so a long / thin / loaded wire shows
 * a measurable drop.
 */
function edgePhysics(
  edge: Edge,
  world: ReturnType<typeof canvasToWorld>,
  solution: Solution,
  lengthM: number,
  ohms: number,
  temperatures: Map<string, number>,
) {
  const flow = wireFlow(solution, `wire_${edge.id}`, true)
  // The wire's two end potentials, so the on-wire probe can read the interpolated
  // voltage (and accumulated drop) at any point the cursor rides to.
  const wireInst = world.instances.get(`wire_${edge.id}`)
  const netA = wireInst?.connects?.find((c) => c.terminal === 'terminal_a')?.net
  const netB = wireInst?.connects?.find((c) => c.terminal === 'terminal_b')?.net
  const vSource = netA !== undefined ? (solution.nodes.get(netA) ?? null) : null
  const vTarget = netB !== undefined ? (solution.nodes.get(netB) ?? null) : null
  const marker = { type: MarkerType.ArrowClosed, width: 16, height: 16, color: CURRENT }
  const arrowAtTarget = flow.carries && flow.sourceToTarget
  const arrowAtSource = flow.carries && !flow.sourceToTarget
  return {
    data: {
      amps: flow.carries ? flow.amps : null,
      lengthM,
      ohms,
      // Real solved drop across the wire (I·R); null when no current flows.
      drop: flow.carries ? flow.amps * ohms : null,
      vSource,
      vTarget,
      // The two ends sit on the parts they connect to, at those parts' solved
      // temperatures (ambient when a part runs cool / has no thermal model) — the
      // boundary conditions for the wire's hot-spot fin model.
      endTempA: temperatures.get(edge.source) ?? STANDARD_AMBIENT_C,
      endTempB: temperatures.get(edge.target) ?? STANDARD_AMBIENT_C,
    },
    style: {
      stroke: flow.carries ? CURRENT : IDLE,
      strokeWidth: flow.carries ? 1.6 : 1,
    },
    // Omit (not undefined) when absent — exactOptionalPropertyTypes.
    ...(arrowAtTarget ? { markerEnd: marker } : {}),
    ...(arrowAtSource ? { markerStart: marker } : {}),
  }
}

/** The light sources (positions + intensity) and every node's position, read off
 *  the canvas nodes — the inputs the casting pre-pass needs (light.ts). */
export function lightCastInputs(nodeList: Node[]): {
  sources: LightSource[]
  positions: Map<string, { x: number; y: number }>
} {
  const sources: LightSource[] = nodeList
    .filter((node) => (node.data as DeviceNodeData).definition === 'light_source')
    .map((node) => ({
      x: node.position.x,
      y: node.position.y,
      intensityCandela:
        readScalarParam(
          { parameters: (node.data as DeviceNodeData).parameters } as Instance,
          'luminous_intensity',
        ) ?? 0,
    }))
  const positions = new Map(nodeList.map((node) => [node.id, node.position]))
  return { sources, positions }
}

/**
 * Re-solve the canvas from scratch (S19-v3-23, the live re-solve): rebuild the
 * World from the current nodes + wires via `canvasToWorld`, run the DC solver,
 * and return both the refreshed wire currents/length/resistance AND each part's
 * health (lit / overstressed, from the §19 failure-detector). This is what makes
 * a dropped, wired, reconnected, edited, or toggled part change the currents +
 * the success/failure animations — the canvas, not a fixed loaded circuit, is the
 * source of truth. Manual routing (waypoints) is preserved across the re-solve.
 */
function solveCanvas(
  nodeList: Node[],
  edgeList: Edge[],
  projectAmbientC?: number,
  routedGeoms?: Map<string, Point[]>,
): {
  edges: Edge[]
  health: Map<string, NodeHealth>
  readings: Map<string, PartReading>
  terminalVolts: Map<string, number>
  live: LiveLevels | undefined
  world: World
  solution: Solution
  temperaturesC: Map<string, number>
  thermalConverged: boolean
  relayStates: Map<string, RelayState>
  shockleyStates: Map<string, ShockleyDiodeState>
  relaysSettled: boolean
} {
  const { world: rawWorld, drawn, leadAliases } = canvasWorld(nodeList, edgeList, routedGeoms)
  // Light casting (S21-v3-8): a light_source part throws light onto the sensors
  // around it, falling off with distance (E = I/d²). Fold each sensor's incident
  // illuminance — its own ambient plus the cast from every source at its canvas
  // position — into the world before solving, so the sensor responds to the real,
  // position-dependent light. This is the ONE place canvas position carries physics.
  const { sources, positions } = lightCastInputs(nodeList)
  const world = worldWithCastLight(rawWorld, positions, sources)
  // Electro-thermal solve (stage 7): the electrical answer at the settled part
  // temperatures — hot parts drift, warm junctions drop, all fed back until the
  // fixed point. Readings/health recompute temperatures from this solution and
  // land on the same numbers (it IS the fixed point). Only the ground-connected
  // component is solved: a free-floating section's voltages are genuinely
  // undefined (and would be a singular matrix) — it sits idle instead of
  // killing the whole canvas. The meter still gets the FULL world.
  const solvable = groundedComponent(world)
  const thermal = solveWithRelays(
    solvable,
    projectAmbientC === undefined ? undefined : { projectAmbientC },
  )
  const solution = thermal.solution
  // Name what the strip set aside — the engine must explain itself ON SCREEN (the footer shows
  // solution warnings), not only to the test suite. Wires are connections and a ground symbol is a
  // net name, so only real wired parts are worth naming.
  if (solvable.instances.size < world.instances.size) {
    const dropped = [...world.instances.values()].filter(
      (inst) =>
        !solvable.instances.has(inst.id) &&
        inst.definition !== 'wire' &&
        inst.definition !== 'ground' &&
        (inst.connects?.length ?? 0) > 0,
    )
    if (dropped.length > 0) {
      const named =
        dropped
          .slice(0, 4)
          .map((inst) => inst.id)
          .join(', ') + (dropped.length > 4 ? ', …' : '')
      solution.warnings.push(
        `Separate circuit (${named}) has no path to ground — not solved. Ground it (or wire it to the grounded circuit) and it solves independently alongside the others.`,
      )
    }
  }
  const edges = edgeList.map((edge) => {
    const wire = drawn.get(edge.id) ?? { lengthM: 0, ohms: 0 }
    const physics = edgePhysics(
      edge,
      world,
      solution,
      wire.lengthM,
      wire.ohms,
      thermal.temperaturesC,
    )
    const existing = edge.data?.waypoints
    const waypoints = Array.isArray(existing) ? existing : undefined
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
      type: 'net',
      deletable: true,
      label: edge.label,
      // Re-solving recomputes PHYSICS — it must not touch what the user did.
      // Selection and the drawn shape (corners, curve flag, sweep size) are
      // user state and survive the rebuild verbatim.
      ...(edge.selected !== undefined ? { selected: edge.selected } : {}),
      ...physics,
      data: {
        ...physics.data,
        ...(waypoints ? { waypoints } : {}),
        ...(edge.data?.curved === true ? { curved: true } : {}),
        ...(typeof edge.data?.curveRadius === 'number'
          ? { curveRadius: edge.data.curveRadius }
          : {}),
        ...(typeof edge.data?.gaugeAwg === 'number' ? { gaugeAwg: edge.data.gaugeAwg } : {}),
        ...(typeof edge.data?.material === 'string' ? { material: edge.data.material } : {}),
      },
    }
  })
  // An internal part's failure also marks its block node (validation bubbles
  // up the hierarchy, per the object model — a failing source SECTION marks
  // its source the same way). The board ambient flows in so the over-temperature
  // check fires at the same temperature the solve and the thermocouple show, and
  // the settled temperatures keep a burned-open part red (its final solution
  // carries no current — the temperature that destroyed it is the evidence).
  const health = bubbleBlockHealth(
    canvasHealth(world, solution, projectAmbientC, thermal.temperaturesC),
  )
  // Probing a block's PORT or a multi-lead source's lead reads the real
  // terminal it stands for. Lead aliases land first: a block port may itself
  // point at a lead that the expansion re-homed.
  const terminalVolts = terminalVoltages(world, solution)
  for (const alias of leadAliases) {
    const inner = terminalVolts.get(alias.inner)
    if (inner !== undefined) terminalVolts.set(alias.outer, inner)
  }
  for (const alias of userPartAliases(nodeList)) {
    const inner = terminalVolts.get(alias.inner)
    if (inner !== undefined) terminalVolts.set(alias.outer, inner)
  }
  const supplyVolts = logicThreshold(world)
  return {
    edges,
    health,
    readings: partReadings(world, solution, thermal.temperaturesC),
    // Every wired terminal's live voltage — what the multimeter probes read.
    terminalVolts,
    // Tri-state enable levels for the output-contention check (undefined with no supply → no logic
    // threshold, so a tri-state bus stays a caution rather than a false pass/fail).
    live:
      supplyVolts === undefined
        ? undefined
        : { terminalVoltages: terminalVolts, threshold: supplyVolts },
    // The solved circuit itself — the meter's Ω mode re-solves it powered-off,
    // and the Math panel shows the equations behind this exact solution.
    world,
    solution,
    // The settled part temperatures — the Math panel narrates a hot resistor's
    // tempco drift with the SAME numbers the solve used.
    temperaturesC: thermal.temperaturesC,
    // Did the thermal loop settle? False = runaway — the Math panel flags the
    // temperatures below as a non-converged snapshot instead of an answer.
    thermalConverged: thermal.thermalConverged,
    // Each relay's resolved contact state (for the symbol) + whether the relay
    // loop settled (false = a buzzer/oscillator the Math panel flags).
    relayStates: thermal.relayStates,
    shockleyStates: thermal.shockleyStates,
    relaysSettled: thermal.relaysSettled,
  }
}

/**
 * Logic-fidelity solve (complexity-layer #1): a digital canvas resolved as 0/1 by the fast logic engine
 * instead of the slow per-MOSFET MNA. We still build the real world so each gate port maps to its real
 * net, but skip the Newton solve — `digitalSeed` pins every gate port to 0 or Vdd, and that IS the
 * answer at this layer. No currents, temperatures, or device health (those are transistor-fidelity facts
 * you see when you DESCEND into a gate). Falls back to the full solve if the canvas has no real gates.
 */
function solveCanvasLogic(
  nodeList: Node[],
  edgeList: Edge[],
  projectAmbientC?: number,
  routedGeoms?: Map<string, Point[]>,
  state?: Map<string, boolean>,
): ReturnType<typeof solveCanvas> {
  const { world, leadAliases } = canvasWorld(nodeList, edgeList, routedGeoms)
  const seed = digitalSeed(
    nodeList as unknown as BlockNodeLike[],
    edgeList as unknown as BlockEdgeLike[],
    world,
    state,
  )
  if (seed === undefined) return solveCanvas(nodeList, edgeList, projectAmbientC, routedGeoms)
  const solution: Solution = {
    status: 'solved',
    nodes: seed,
    branches: new Map(),
    ground: undefined,
    warnings: [],
    iterations: 0,
    converged: true,
  }
  const terminalVolts = terminalVoltages(world, solution)
  for (const alias of leadAliases) {
    const inner = terminalVolts.get(alias.inner)
    if (inner !== undefined) terminalVolts.set(alias.outer, inner)
  }
  for (const alias of userPartAliases(nodeList)) {
    const inner = terminalVolts.get(alias.inner)
    if (inner !== undefined) terminalVolts.set(alias.outer, inner)
  }
  const supplyVolts = logicThreshold(world)
  const edges = edgeList.map(
    (edge) =>
      ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
        type: 'net',
        deletable: true,
        label: edge.label,
        ...(edge.selected !== undefined ? { selected: edge.selected } : {}),
        data: {
          ...(Array.isArray(edge.data?.waypoints) ? { waypoints: edge.data.waypoints } : {}),
          ...(edge.data?.curved === true ? { curved: true } : {}),
          ...(typeof edge.data?.curveRadius === 'number'
            ? { curveRadius: edge.data.curveRadius }
            : {}),
        },
      }) as Edge,
  )
  return {
    edges,
    health: new Map(),
    readings: new Map(),
    terminalVolts,
    live:
      supplyVolts === undefined
        ? undefined
        : { terminalVoltages: terminalVolts, threshold: supplyVolts },
    world,
    solution,
    temperaturesC: new Map(),
    thermalConverged: true,
    relayStates: new Map(),
    shockleyStates: new Map(),
    relaysSettled: true,
  }
}

/**
 * Mixed-fidelity solve — the hand-off (complexity-layer #3). A canvas with BOTH logic-tagged blocks and
 * real analog parts: the logic engine resolves the digital blocks to 0/1, and wherever a logic OUTPUT
 * drives a real analog load we splice in a real voltage source (0 or Vdd) at that wire, then run the full
 * analog solve on the rest. So a logic gate can drive a transistor stage or light an LED — the gate is
 * fast 0/1, the load is real physics, and the wire between carries an actual 5 V. BOTH directions work:
 * an analog node driving a logic INPUT is read back as a 0/1 (a virtual source in the logic view), and
 * the two solves ITERATE so each side sees the other's boundary values — combinational mixing settles in
 * a couple of passes (feedback loops are capped).
 */
function solveCanvasMixed(
  nodeList: Node[],
  edgeList: Edge[],
  projectAmbientC?: number,
  routedGeoms?: Map<string, Point[]>,
  state?: Map<string, boolean>,
): ReturnType<typeof solveCanvas> {
  const nodeById = new Map(nodeList.map((n) => [n.id, n]))
  const logicIds = new Set(nodeList.filter(isLogicFidelity).map((n) => n.id))
  let vdd = 5
  for (const n of nodeList) {
    const data = n.data as DeviceNodeData
    if (data.definition !== 'power_source') continue
    const amt = (
      data.parameters as { nominal_voltage?: { value?: { amount?: number } } } | undefined
    )?.nominal_voltage?.value?.amount
    if (typeof amt === 'number' && amt > vdd) vdd = amt
  }
  const ground = nodeList.find((n) => (n.data as DeviceNodeData).definition === 'ground')
  const supply = (volts: number) => ({
    nominal_voltage: { value: { kind: 'scalar', amount: volts, unit: 'volt' } },
    internal_resistance: { value: { kind: 'scalar', amount: 0, unit: 'ohm' } },
  })
  const isRealLoad = (id: string): boolean => {
    if (logicIds.has(id)) return false
    const def = (nodeById.get(id)?.data as DeviceNodeData | undefined)?.definition
    return def !== undefined && !ANALOG_PASSIVE.has(def)
  }
  // Classify each logic↔real-analog boundary by the logic pin's ROLE: an OUTPUT pin → the logic DRIVES
  // the analog (inject its 0/Vdd as a source); any other (input) pin → the analog DRIVES the logic (read
  // its level back as a 0/1). Then ITERATE the two solves so each side sees the other's boundary values —
  // a couple of passes settle combinational mixing (feedback loops are capped).
  type MixBoundary = {
    id: string
    logicId: string
    logicHandle: string
    analogId: string
    analogHandle: string
    output: boolean
  }
  const boundaries: MixBoundary[] = findBridges(edgeList, logicIds, isRealLoad, (id, handle) =>
    portDriveOf(nodeById, id, handle),
  ).map((b) => ({
    id: b.edgeId,
    logicId: b.logicId,
    logicHandle: b.logicHandle,
    analogId: b.analogId,
    analogHandle: b.analogHandle,
    output: b.output,
  }))
  const reverse = boundaries.filter((b) => !b.output) // analog → logic INPUT
  const reverseIds = new Set(reverse.map((b) => b.id))

  // analog→logic boundary id → the 0/1 the analog side currently drives into the logic.
  const atl = new Map<string, boolean>()
  let logic = simulateLogic(
    nodeList as unknown as BlockNodeLike[],
    edgeList as unknown as BlockEdgeLike[],
    state,
  )
  let solved = solveCanvas([], [], projectAmbientC, routedGeoms)
  for (let iter = 0; ; iter++) {
    // LOGIC VIEW: a virtual 0/Vdd source at each analog→logic boundary (so the logic input reads the
    // analog level), with the original boundary wire removed.
    const vsNodes: Node[] = []
    const vsEdges: Edge[] = []
    for (const b of reverse) {
      const vsId = `__vs_${b.id}`
      vsNodes.push({
        id: vsId,
        type: 'device',
        position: { x: 0, y: 0 },
        data: {
          definition: 'power_source',
          label: '',
          parameters: supply(atl.get(b.id) ? vdd : 0),
        },
      } as Node)
      vsEdges.push({
        id: `__vse_${b.id}`,
        type: 'net',
        source: vsId,
        sourceHandle: 'terminal_positive',
        target: b.logicId,
        targetHandle: b.logicHandle,
      } as Edge)
      if (ground) {
        vsEdges.push({
          id: `__vsg_${b.id}`,
          type: 'net',
          source: vsId,
          sourceHandle: 'terminal_negative',
          target: ground.id,
          targetHandle: 'reference_terminal',
        } as Edge)
      }
    }
    logic = simulateLogic(
      [...nodeList, ...vsNodes] as unknown as BlockNodeLike[],
      [...edgeList.filter((e) => !reverseIds.has(e.id)), ...vsEdges] as unknown as BlockEdgeLike[],
      state,
    )
    // ANALOG CANVAS: logic blocks removed; a real source at each logic→analog boundary (the logic
    // output's 0/Vdd); analog→logic wires dropped (the analog part drives its own pin, read below).
    const boundaryNodes: Node[] = []
    const analogEdges: Edge[] = []
    for (const e of edgeList) {
      const sL = logicIds.has(e.source)
      const tL = logicIds.has(e.target)
      if (sL && tL) continue
      if (!sL && !tL) {
        analogEdges.push(e)
        continue
      }
      if (!isRealLoad(sL ? e.target : e.source)) continue // logic↔passive (source/ground): drop
      if (reverseIds.has(e.id)) continue // analog→logic: read after, don't inject
      const v = logic.value(sL ? e.source : e.target, (sL ? e.sourceHandle : e.targetHandle) ?? '')
      const bsId = `__bs_${e.id}`
      boundaryNodes.push({
        id: bsId,
        type: 'device',
        position: { x: 0, y: 0 },
        data: { definition: 'power_source', label: '', parameters: supply(v ? vdd : 0) },
      } as Node)
      analogEdges.push(
        (sL
          ? { ...e, source: bsId, sourceHandle: 'terminal_positive' }
          : { ...e, target: bsId, targetHandle: 'terminal_positive' }) as Edge,
      )
      if (ground) {
        analogEdges.push({
          id: `__bsg_${e.id}`,
          type: 'net',
          source: bsId,
          sourceHandle: 'terminal_negative',
          target: ground.id,
          targetHandle: 'reference_terminal',
        } as Edge)
      }
    }
    solved = solveCanvas(
      [...nodeList.filter((n) => !logicIds.has(n.id)), ...boundaryNodes],
      analogEdges,
      projectAmbientC,
      routedGeoms,
    )
    // READ the analog level at each analog→logic boundary → next round's virtual-source bits.
    const next = new Map<string, boolean>()
    for (const b of reverse) {
      const av = solved.terminalVolts.get(`${b.analogId}/${b.analogHandle}`)
      if (av !== undefined) next.set(b.id, av >= vdd / 2)
    }
    const settled = next.size === atl.size && [...next].every(([k, v]) => atl.get(k) === v)
    atl.clear()
    for (const [k, v] of next) atl.set(k, v)
    if (settled || reverse.length === 0 || iter >= 4) break
  }
  // The digital side's own port voltages (0/Vdd), so the logic blocks read out too.
  const terminalVolts = new Map(solved.terminalVolts)
  for (const n of nodeList) {
    const block = isLogicFidelity(n) ? (n.data as { block?: BlockData }).block : undefined
    if (!block) continue
    for (const port of block.ports) {
      const v = logic.value(n.id, port.id)
      if (v !== undefined) terminalVolts.set(`${n.id}/${port.id}`, v ? vdd : 0)
    }
  }
  // Render ALL the original wires — the analog solve only knows the rewired subset.
  const edges = edgeList.map(
    (edge) =>
      ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
        type: 'net',
        deletable: true,
        label: edge.label,
        ...(edge.selected !== undefined ? { selected: edge.selected } : {}),
        data: {
          ...(Array.isArray(edge.data?.waypoints) ? { waypoints: edge.data.waypoints } : {}),
          ...(edge.data?.curved === true ? { curved: true } : {}),
          ...(typeof edge.data?.curveRadius === 'number'
            ? { curveRadius: edge.data.curveRadius }
            : {}),
        },
      }) as Edge,
  )
  return { ...solved, edges, terminalVolts }
}

/**
 * MIXED-SIGNAL CO-SIMULATION — a logic-fidelity digital sub-circuit (a character generator) and an
 * analog transient circuit (a CRT) running TOGETHER over time, signals crossing the boundary every
 * step. The classic SPICE-plus-event-engine technique, here strictly one-way (digital → analog) for
 * the char-gen → CRT-grid video path, so there is no algebraic loop:
 *   • SPLIT the canvas at the logic↔analog boundary. The digital block stays at LOGIC fidelity (never
 *     flattened to its ~hundreds of transistors — that is the whole point: it dodges the scaling wall).
 *   • SPLICE a real voltage source (the gate's Thévenin output) onto each boundary net the digital side
 *     drives — here the CRT control grid (a high-impedance Z-axis input that draws ~no current back, so
 *     the digital decision is never loaded by the analog solve).
 *   • MARCH the BARE transient solver. At the TOP of each step the digital advances ONE pixel clock —
 *     a CLK-low then CLK-high logic solve over a persistent state map (one master-slave edge = one
 *     count) — and the video bit it produces is stashed as the grid voltage (lit = 0 V, blank = past
 *     cutoff). The analog step then solves with the grid held there, painting that pixel. Because the
 *     scan clock is derived from the step index, the glyph pixel and the beam position stay phase-locked.
 * Runs BARE solveTransient, NOT solveTransientThermal (the thermal wrapper re-marches the series, which
 * would re-clock the counters — and a logic-fidelity char-gen dissipates nothing in the CRT anyway).
 */
function solveTransientCoSim(
  nodeList: Node[],
  edgeList: Edge[],
  options: { timeStep: number; duration: number },
): { result: TransientResult; traces: Map<string, { points: CrtSpot[]; brightness: number }> } {
  const nodeById = new Map(nodeList.map((n) => [n.id, n]))
  const defOf = (id: string) => (nodeById.get(id)?.data as DeviceNodeData | undefined)?.definition
  const logicIds = new Set(nodeList.filter(isLogicFidelity).map((n) => n.id))
  let vdd = 5
  for (const n of nodeList) {
    const amt = (
      (n.data as DeviceNodeData).parameters as
        | { nominal_voltage?: { value?: { amount?: number } } }
        | undefined
    )?.nominal_voltage?.value?.amount
    if (defOf(n.id) === 'power_source' && typeof amt === 'number' && amt > vdd) vdd = amt
  }
  const isRealLoad = (id: string) =>
    !logicIds.has(id) && defOf(id) !== undefined && !ANALOG_PASSIVE.has(defOf(id) as string)

  // BOUNDARIES: a logic OUTPUT pin wired to a real analog load — the digital→analog video crossing.
  // (The transient co-sim only splices the OUTPUT boundaries; the input-driving direction isn't modelled.)
  type Bridge = { edgeId: string; srcId: string; logicId: string; logicHandle: string }
  const bridges: Bridge[] = findBridges(edgeList, logicIds, isRealLoad, (id, handle) =>
    portDriveOf(nodeById, id, handle),
  )
    .filter((b) => b.output)
    .map((b) => ({
      edgeId: b.edgeId,
      srcId: `__grid_${b.edgeId}`,
      logicId: b.logicId,
      logicHandle: b.logicHandle,
    }))

  // SPLIT: the logic component = everything reachable from the logic blocks over non-bridge edges (the
  // char-gen + its clock/clear/V+ sources + the digital ground). Requires the analog + digital sides to
  // meet ONLY at the bridge (a separate analog ground — the real mixed-signal split-ground convention).
  const bridgeEdges = new Set(bridges.map((b) => b.edgeId))
  const adj = new Map<string, string[]>()
  const link = (a: string, b: string) => {
    const l = adj.get(a)
    if (l) l.push(b)
    else adj.set(a, [b])
  }
  for (const e of edgeList) {
    if (bridgeEdges.has(e.id)) continue
    link(e.source, e.target)
    link(e.target, e.source)
  }
  const logicComp = new Set<string>(logicIds)
  const queue = [...logicIds]
  while (queue.length > 0) {
    const id = queue.pop() as string
    for (const nb of adj.get(id) ?? [])
      if (!logicComp.has(nb)) {
        logicComp.add(nb)
        queue.push(nb)
      }
  }

  const analogNodesRaw = nodeList.filter((n) => !logicComp.has(n.id))
  const analogGround = analogNodesRaw.find((n) => defOf(n.id) === 'ground')
  const crtNode = analogNodesRaw.find((n) => defOf(n.id) === 'crt')
  const cutoff =
    (
      (crtNode?.data as DeviceNodeData | undefined)?.parameters as
        | { grid_cutoff_voltage?: { value?: { amount?: number } } }
        | undefined
    )?.grid_cutoff_voltage?.value?.amount ?? -50
  const V_LIT = 0
  const V_BLANK = 1.2 * cutoff // safely past cutoff → beam blanked (dark)

  // The spliced grid sources (the gate's real Thévenin output: a small output resistance; the grid is
  // high-Z so its exact value is immaterial). Their voltage is overridden each step by externalSourceV.
  const sv = (amount: number, unit = 'volt') => ({
    value: { kind: 'scalar' as const, amount, unit },
  })
  const spliceNodes: Node[] = bridges.map(
    (b) =>
      ({
        id: b.srcId,
        type: 'device',
        position: { x: 0, y: 0 },
        data: {
          definition: 'power_source',
          label: '',
          parameters: { nominal_voltage: sv(V_BLANK), internal_resistance: sv(200, 'ohm') },
        },
      }) as Node,
  )
  const analogEdges: Edge[] = []
  for (const e of edgeList) {
    if (bridgeEdges.has(e.id)) continue
    if (logicComp.has(e.source) || logicComp.has(e.target)) continue
    analogEdges.push(e)
  }
  for (const b of bridges) {
    const e = edgeList.find((x) => x.id === b.edgeId)
    if (e === undefined) continue
    const analogIsSource = !logicIds.has(e.source)
    const analogId = analogIsSource ? e.source : e.target
    const analogHandle = (analogIsSource ? e.sourceHandle : e.targetHandle) ?? ''
    analogEdges.push({
      id: `__ge_${b.edgeId}`,
      type: 'net',
      source: b.srcId,
      sourceHandle: 'terminal_positive',
      target: analogId,
      targetHandle: analogHandle,
    } as Edge)
    if (analogGround)
      analogEdges.push({
        id: `__gg_${b.edgeId}`,
        type: 'net',
        source: b.srcId,
        sourceHandle: 'terminal_negative',
        target: analogGround.id,
        targetHandle: 'reference_terminal',
      } as Edge)
  }

  const analogNodes = [...analogNodesRaw, ...spliceNodes]
  const { sources, positions } = lightCastInputs(analogNodes)
  const analogWorld = groundedComponent(
    worldWithCastLight(canvasWorld(analogNodes, analogEdges).world, positions, sources),
  )

  // The digital side runs through simulateLogic each step. Find its clock + clear sources (toggled in
  // the logic view by clock phase); the persistent state map is the flip-flops' memory across the run.
  const logicNodes = nodeList.filter((n) => logicComp.has(n.id))
  const logicEdges = edgeList.filter(
    (e) => !bridgeEdges.has(e.id) && logicComp.has(e.source) && logicComp.has(e.target),
  )
  const findSrcFor = (handle: string): string | undefined => {
    for (const e of edgeList) {
      if (logicIds.has(e.source) && e.sourceHandle === handle && defOf(e.target) === 'power_source')
        return e.target
      if (logicIds.has(e.target) && e.targetHandle === handle && defOf(e.source) === 'power_source')
        return e.source
    }
    return undefined
  }
  const clkSourceId = findSrcFor('clk')
  const clrSourceId = findSrcFor('clr')
  const state = new Map<string, boolean>()
  const setLevel = (ns: Node[], id: string | undefined, hi: boolean): Node[] =>
    id === undefined
      ? ns
      : ns.map((n) =>
          n.id === id
            ? ({
                ...n,
                data: { ...n.data, parameters: { nominal_voltage: sv(hi ? vdd : 0) } },
              } as Node)
            : n,
        )
  const logicSolve = (clkHigh: boolean, clrHigh: boolean) => {
    let ns = setLevel(logicNodes, clkSourceId, clkHigh)
    ns = setLevel(ns, clrSourceId, clrHigh)
    return simulateLogic(
      ns as unknown as BlockNodeLike[],
      logicEdges as unknown as BlockEdgeLike[],
      state,
    )
  }

  const stash = new Map<string, number>()
  const readVideo = (r: ReturnType<typeof simulateLogic>) => {
    for (const b of bridges)
      stash.set(b.srcId, r.value(b.logicId, b.logicHandle) === true ? V_LIT : V_BLANK)
  }
  // Reset the counters to a known top-left start (CLR = load 0), then sample pixel 0 for the t=0 frame.
  logicSolve(false, true)
  readVideo(logicSolve(true, true))

  const result = solveTransient(analogWorld, {
    timeStep: options.timeStep,
    duration: options.duration,
    onStepBegin: () => {
      logicSolve(false, false) // CLK low — the master grabs the next count
      readVideo(logicSolve(true, false)) // CLK high — Q updates; sample this pixel's video bit
    },
    externalSourceV: (id: string) => stash.get(id),
  })
  return { result, traces: buildCrtTraces(analogWorld, result.series) }
}

/**
 * Transient sibling of solveCanvasDispatch. A canvas with BOTH a logic-fidelity block AND a real analog
 * load (the char-gen + the CRT) → the mixed-signal CO-SIMULATION; otherwise the unchanged analog path
 * (build the world + solveTransientThermal). Returns a TransientResult + the CRT beam traces either way,
 * so every transient entry point (scope, CRT demos, timeline) can route through one function.
 */
export function solveTransientDispatch(
  nodeList: Node[],
  edgeList: Edge[],
  options: { timeStep: number; duration: number; projectAmbientC?: number },
): { result: TransientResult; traces: Map<string, { points: CrtSpot[]; brightness: number }> } {
  if (classifyCanvas(nodeList) === 'mixed') return solveTransientCoSim(nodeList, edgeList, options)
  // 'analog' and 'logic' both take the analog transient path — there is no logic-only transient engine.
  const { sources, positions } = lightCastInputs(nodeList)
  const world = groundedComponent(
    worldWithCastLight(canvasWorld(nodeList, edgeList).world, positions, sources),
  )
  const thermal = solveTransientThermal(world, options)
  return { result: thermal.result, traces: buildCrtTraces(world, thermal.result.series) }
}

/** Pick the solve engine from the blocks' fidelity tags (complexity-layer system): no logic tags → the
 *  full transistor solve; logic tags + a real analog load (an analog device or a transistor-tagged block)
 *  → the mixed hand-off; logic tags driving only digital sources → the fast logic engine. */
export function solveCanvasDispatch(
  nodeList: Node[],
  edgeList: Edge[],
  projectAmbientC?: number,
  routedGeoms?: Map<string, Point[]>,
  state?: Map<string, boolean>,
): ReturnType<typeof solveCanvas> {
  switch (classifyCanvas(nodeList)) {
    case 'analog':
      return solveCanvas(nodeList, edgeList, projectAmbientC, routedGeoms)
    case 'logic':
      return solveCanvasLogic(nodeList, edgeList, projectAmbientC, routedGeoms, state)
    case 'mixed':
      return solveCanvasMixed(nodeList, edgeList, projectAmbientC, routedGeoms, state)
  }
}

/** The logic high/low threshold (≈ Vcc/2) for the tri-state enable check — half the largest power
 *  source voltage. Undefined when there's no supply (then enable levels can't be judged → caution). */
function logicThreshold(world: World): number | undefined {
  let vcc = 0
  for (const inst of world.instances.values()) {
    if (inst.definition !== 'power_source') continue
    const v = Math.abs(readScalarParam(inst, 'nominal_voltage') ?? 0)
    if (v > vcc) vcc = v
  }
  return vcc > 0 ? vcc / 2 : undefined
}
