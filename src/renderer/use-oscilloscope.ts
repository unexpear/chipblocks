import type { Edge, Node } from '@xyflow/react'
import {
  type MutableRefObject,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { World } from '../cross-fk-validator.ts'
import { solveTransientThermal } from '../electro-thermal.ts'
import { readScalarParam } from '../instance-params.ts'
import { worldWithCastLight } from '../light.ts'
import type { TransientResult } from '../transient-solver.ts'
import { transientRan } from '../transient-solver.ts'
import { groundedComponent } from './canvas-to-world.ts'
import { buildCrtTraces } from './part-readings.ts'
import { canvasWorld } from './pipeline/canvas-world.ts'
import { lightCastInputs } from './pipeline/solve-canvas.ts'
import {
  channelsForProbes,
  fastestSourceHz,
  type ScopeChannel,
  type ScopeProbe,
  scopeProbeKey,
  scopeWindow,
} from './scope.tsx'
import { extractXyPath, type FamilyStep, stepValues, withSourceVoltage } from './scope-family.ts'
import { H_DIVISIONS, scopeRecordSteps, slowestHonestTimebase } from './scope-scales.ts'
import type { Tool } from './toolbar.tsx'
import { formatEng } from './units.ts'

/**
 * The oscilloscope + curve tracer, lifted out of the Canvas component: the time-domain view's state
 * (probes S19-v3-77, timebase S19-v3-78, refusal, the frozen family dataset S20-v3-4), the runs
 * (runScope / runFamily — real electro-thermal transient solves S20-v3-5, honest-sampling guard,
 * never aliased), the live re-run while open, the probe-click handler (terminal volts, wire clamps
 * S19-v3-83, Alt+part currents S20-v3-3), and the channel resolution (part-current keys, wire-clamp
 * nets, terminal→net through the same lookup the multimeter uses). Everything moved here VERBATIM;
 * the couplings to the canvas — the active tool, the nodes/wires, the warm solved world, the shared
 * terminal→net lookup, the project ambient, and the CRT-trace sink — are injected, so behaviour is
 * unchanged.
 */
export function useOscilloscope(deps: {
  tool: Tool
  nodes: Node[]
  edges: Edge[]
  solvedWorld: World
  probeNets: ReadonlyMap<string, string>
  projectAmbientRef: MutableRefObject<number>
  setCrtTraces: (traces: ReturnType<typeof buildCrtTraces>) => void
}) {
  const { tool, nodes, edges, solvedWorld, probeNets, projectAmbientRef, setCrtTraces } = deps
  // Scope (time-domain view): run the canvas circuit through solveTransient over
  // an auto-picked window and show every node voltage as a waveform.
  const [scopeResult, setScopeResult] = useState<TransientResult | null>(null)
  // One display-window's duration — the trigger aligns sweeps inside the
  // 3-window record (set alongside each scope run).
  const [scopeWindowSec, setScopeWindowSec] = useState(1e-3)
  // Timebase knob (S19-v3-78): seconds per grid square, or 'auto' (the window
  // heuristic). Manual settings re-run the sim at the new window; a setting
  // too slow to sample the fastest source honestly is REFUSED, never aliased.
  const [scopeSecPerDiv, setScopeSecPerDiv] = useState<number | 'auto'>('auto')
  const [scopeAutoWindowSec, setScopeAutoWindowSec] = useState(1e-3)
  const [scopeRefusal, setScopeRefusal] = useState<string | null>(null)
  // Family curves (S20-v3-4): a FROZEN set of stepped-parameter runs — the
  // I-V family. Each trace is a real solver run with one source's voltage
  // overridden; the dataset stays until cleared or re-traced (re-running N
  // simulations on every edit would not be a live view, it would be a lag).
  const [scopeFamily, setScopeFamily] = useState<{
    steps: FamilyStep[]
    xChannel: ScopeChannel
    yChannel: ScopeChannel
    sourceId: string
    skipped: string[]
  } | null>(null)
  const [scopeFamilyNote, setScopeFamilyNote] = useState<string | null>(null)
  // Scope probes (S19-v3-77): the terminals the user clipped channels onto.
  // Only these plot — clipping where you care, like real scope leads.
  const [scopeProbes, setScopeProbes] = useState<ScopeProbe[]>([])

  const runScope = useCallback(() => {
    const { sources, positions } = lightCastInputs(nodes)
    const world = groundedComponent(
      worldWithCastLight(canvasWorld(nodes, edges).world, positions, sources),
    )
    const auto = scopeWindow(world)
    setScopeAutoWindowSec(auto.duration)
    const windowSec = scopeSecPerDiv === 'auto' ? auto.duration : scopeSecPerDiv * H_DIVISIONS
    setScopeWindowSec(windowSec)
    // The RECORD is three display-windows long (S19-v3-75): the trigger search
    // starts after the first (power-on transients settle), and a full window
    // always fits after the trigger point. Step spacing follows the FASTEST
    // source (≥32 samples/cycle, ≤20 000 steps — the multimeter's V~ honesty
    // rule); a timebase too slow to keep that is refused, never aliased.
    const fastestHz = fastestSourceHz(world)
    const steps = scopeRecordSteps(windowSec * 3, fastestHz)
    if (steps === 'span-too-wide') {
      const slowest = slowestHonestTimebase(fastestHz)
      setScopeRefusal(
        `${formatEng(windowSec / H_DIVISIONS, 's')}/div spans too much time to sample the ` +
          `${formatEng(fastestHz, 'Hz')} source honestly (the scope keeps at least 32 points ` +
          `per cycle, at most 20 000 steps — past that the trace would alias into a shape ` +
          `that was never there). Slowest honest setting for this circuit: ` +
          `${formatEng(slowest, 's')}/div.`,
      )
      return
    }
    setScopeRefusal(null)
    // Electro-thermal (S20-v3-5): the scope's simulation heats the parts by
    // the same lumped law the DC solve uses — the meter clamp and the scope
    // clamp now agree on the same wire. The thermal loop's own warnings
    // (runaway, out-of-range tempco) surface with the solver's.
    const thermal = solveTransientThermal(world, {
      timeStep: (windowSec * 3) / steps,
      duration: windowSec * 3,
      projectAmbientC: projectAmbientRef.current,
    })
    setScopeResult({
      ...thermal.result,
      warnings: [...thermal.result.warnings, ...thermal.warnings],
    })
    // CRT live traces (the spot's locus over this run) for any tube in the circuit — the inspector's
    // screen draws them instead of the single DC spot once the scope has run.
    setCrtTraces(buildCrtTraces(world, thermal.result.series))
  }, [nodes, edges, scopeSecPerDiv, projectAmbientRef, setCrtTraces])

  // Trace a family (S20-v3-4): one solver run per stepped value of the chosen
  // source's voltage, each run's settled (X, Y) path kept. The window and the
  // honest-sampling guard are computed ONCE from the base circuit — stepping
  // a DC value changes no frequency, so every run shares them. Failed steps
  // are reported by name, never faked.
  const runFamily = useCallback(
    (
      xChannel: ScopeChannel,
      yChannel: ScopeChannel,
      sourceId: string,
      from: number,
      to: number,
      count: number,
    ) => {
      const { sources, positions } = lightCastInputs(nodes)
      const baseWorld = groundedComponent(
        worldWithCastLight(canvasWorld(nodes, edges).world, positions, sources),
      )
      const auto = scopeWindow(baseWorld)
      const windowSec = scopeSecPerDiv === 'auto' ? auto.duration : scopeSecPerDiv * H_DIVISIONS
      const fastestHz = fastestSourceHz(baseWorld)
      const honestSteps = scopeRecordSteps(windowSec * 3, fastestHz)
      if (honestSteps === 'span-too-wide') {
        setScopeFamily(null)
        setScopeFamilyNote(
          `the timebase is too slow to sample the ${formatEng(fastestHz, 'Hz')} source honestly — ` +
            `pick a faster Horiz setting, then trace`,
        )
        return
      }
      const dt = (windowSec * 3) / honestSteps
      const traced: FamilyStep[] = []
      const skipped: string[] = []
      for (const value of stepValues(from, to, count)) {
        const stepped = withSourceVoltage(
          nodes as unknown as { id: string; data?: { parameters?: Record<string, unknown> } }[],
          sourceId,
          value,
        ) as unknown as Node[]
        // The light is unchanged across voltage steps — reuse the base sources.
        const world = groundedComponent(
          worldWithCastLight(canvasWorld(stepped, edges).world, positions, sources),
        )
        // Each family run heats its parts too — a high-gate step's curve is
        // traced at the temperature that step actually sustains.
        const result = solveTransientThermal(world, {
          timeStep: dt,
          duration: windowSec * 3,
          projectAmbientC: projectAmbientRef.current,
        }).result
        const label = `${sourceId} = ${formatEng(value, 'V')}`
        if (!transientRan(result.status)) {
          skipped.push(`${formatEng(value, 'V')}: ${result.status}`)
          continue
        }
        traced.push({
          value,
          label,
          path: extractXyPath(result.series, xChannel, yChannel, windowSec),
        })
      }
      setScopeFamily({ steps: traced, xChannel, yChannel, sourceId, skipped })
      setScopeFamilyNote(skipped.length > 0 ? `skipped — ${skipped.join(' · ')}` : null)
    },
    [nodes, edges, scopeSecPerDiv, projectAmbientRef],
  )

  // While the Scope is open it follows the circuit live: any edit (drop, wire,
  // value change, switch flip) re-runs the time simulation — same spirit as the
  // always-on DC re-solve. Closed scope costs nothing.
  const scopeOpen = scopeResult !== null || scopeRefusal !== null
  useEffect(() => {
    if (scopeOpen) runScope()
  }, [scopeOpen, runScope])

  // Clip / unclip a scope probe (S19-v3-77; clamps S19-v3-83; part currents
  // S20-v3-3): with the Scope open and the plain select tool, clicking a
  // terminal dot toggles a VOLTAGE channel there; clicking a WIRE clamps a
  // CURRENT channel around it; ALT+clicking a part's BODY clamps the part's
  // own recorded current (the curve tracer's Y axis). Plain body clicks stay
  // selection. Returns whether the click was consumed.
  const onScopeProbeClick = useCallback(
    (event: ReactMouseEvent): boolean => {
      if (!scopeOpen || tool !== 'select') return false
      const target = event.target as Element
      const toggle = (probe: ScopeProbe) => {
        const key = scopeProbeKey(probe)
        setScopeProbes((current) =>
          current.some((p) => scopeProbeKey(p) === key)
            ? current.filter((p) => scopeProbeKey(p) !== key)
            : [...current, probe],
        )
        event.stopPropagation()
      }
      if (event.altKey) {
        const nodeEl = target.closest?.('.react-flow__node') as HTMLElement | null
        const nodeId = nodeEl?.getAttribute('data-id')
        if (nodeId === null || nodeId === undefined) return false
        toggle({ kind: 'part', nodeId })
        return true
      }
      const handleEl = target.closest?.('.react-flow__handle') as HTMLElement | null
      if (handleEl !== null) {
        const nodeId = handleEl.dataset.nodeid
        const handleId = handleEl.dataset.handleid
        if (nodeId === undefined || handleId === undefined) return false
        toggle({ kind: 'terminal', nodeId, handleId })
        return true
      }
      const edgeEl = target.closest?.('.react-flow__edge')
      if (edgeEl !== null && edgeEl !== undefined) {
        const dataId = edgeEl.getAttribute('data-id')
        const testId = edgeEl.getAttribute('data-testid')
        const edgeId = dataId ?? (testId?.startsWith('rf__edge-') ? testId.slice(9) : null)
        if (edgeId === null) return false
        toggle({ kind: 'wire', edgeId })
        return true
      }
      return false
    },
    [scopeOpen, tool],
  )

  // Each probeable PART's recorded-current key (S20-v3-3): which terminal's
  // current the solver records as "the" device current, per definition —
  // fixed names where the device has them (anode, collector, drain, +), the
  // instance's own first connect for symmetric two-leads (so the label can
  // state the direction honestly). Parts with no recorded element current
  // (ground, junctions, expanded multi-lead sources, blocks) resolve to
  // nothing and the probe is dropped, never invented.
  const scopePartInfo = useMemo(() => {
    // Parts whose recorded current is anode→cathode (the transient solver records them at /anode):
    // the LED/diode family, the zener, and the latching thyristors (Shockley + the SCR's A-K path).
    const DIODES = new Set([
      'led',
      'led_uv_algan',
      'diode_silicon_rectifier',
      'diode_schottky_al_si',
      'diode_zener_silicon',
      'diode_laser',
      'diode_tunnel',
      'diode_shockley',
      'diode_varactor',
      'scr',
    ])
    const info = new Map<string, { currentKey: string; label: string }>()
    for (const inst of solvedWorld.instances.values()) {
      const id = inst.id
      if (DIODES.has(inst.definition)) {
        info.set(id, { currentKey: `${id}/anode`, label: `${id} · I(anode→cathode)` })
      } else if (inst.definition === 'power_source') {
        info.set(id, { currentKey: `${id}/terminal_positive`, label: `${id} · I(+→−)` })
      } else if (
        inst.definition === 'transistor_bjt_npn' ||
        inst.definition === 'transistor_bjt_pnp'
      ) {
        info.set(id, { currentKey: `${id}/collector`, label: `${id} · I(collector)` })
      } else if (
        inst.definition === 'transistor_mosfet_nmos' ||
        inst.definition === 'transistor_mosfet_pmos' ||
        inst.definition === 'transistor_jfet_n_channel' ||
        inst.definition === 'transistor_jfet_p_channel'
      ) {
        info.set(id, { currentKey: `${id}/drain`, label: `${id} · I(drain)` })
      } else if (inst.definition === 'diode_constant_current') {
        // A CRD is internally a JFET, so the solver records its current at the synthetic drain.
        info.set(id, { currentKey: `${id}/drain`, label: `${id} · I(anode→cathode)` })
      } else if (inst.definition === 'vacuum_diode') {
        info.set(id, { currentKey: `${id}/plate`, label: `${id} · I(plate→cathode)` })
      } else if (
        inst.definition === 'triode' ||
        inst.definition === 'tetrode' ||
        inst.definition === 'pentode'
      ) {
        info.set(id, { currentKey: `${id}/plate`, label: `${id} · I(plate)` })
      } else if (
        inst.definition === 'switch_spst_toggle' ||
        inst.definition === 'switch_spst_momentary'
      ) {
        info.set(id, { currentKey: `${id}/terminal_in`, label: `${id} · I(in→out)` })
      } else if (inst.definition === 'switch_spdt') {
        info.set(id, { currentKey: `${id}/common`, label: `${id} · I(common)` })
      } else if (inst.definition === 'potentiometer') {
        // The wiper current is the pot-specific quantity: ~0 in an unloaded
        // divider, nonzero as a rheostat or when the tap drives a load.
        info.set(id, { currentKey: `${id}/wiper`, label: `${id} · I(wiper)` })
      } else if (inst.definition === 'fuse') {
        info.set(id, { currentKey: `${id}/terminal_a`, label: `${id} · I(a→b)` })
      } else if (inst.definition === 'relay') {
        info.set(id, { currentKey: `${id}/coil_a`, label: `${id} · I(coil)` })
      } else if (
        inst.definition === 'transformer' ||
        inst.definition === 'transformer_center_tapped'
      ) {
        info.set(id, { currentKey: `${id}/primary_a`, label: `${id} · I(primary)` })
      } else if (
        inst.definition === 'resistor' ||
        inst.definition === 'thermistor' ||
        inst.definition === 'incandescent_bulb' ||
        inst.definition === 'photoresistor' ||
        inst.definition === 'capacitor' ||
        inst.definition === 'inductor' ||
        inst.definition === 'electromagnet' ||
        inst.definition === 'dc_motor' ||
        inst.definition === 'generator'
      ) {
        const c1 = inst.connects?.[0]
        const c2 = inst.connects?.[1]
        if (c1 === undefined || c2 === undefined) continue
        const short = (t: string) => t.replace(/^terminal_/, '')
        info.set(id, {
          currentKey: `${id}/${c1.terminal}`,
          label: `${id} · I(${short(c1.terminal)}→${short(c2.terminal)})`,
        })
      }
    }
    return info
  }, [solvedWorld])

  // Each drawn wire's two nets + real resistance, for the scope's clamps —
  // from the SAME world the solves use (wire instance ids are wire_<edgeId>).
  const scopeWireInfo = useMemo(() => {
    const info = new Map<string, { netA: string; netB: string; ohms: number; label: string }>()
    for (const edge of edges) {
      const inst = solvedWorld.instances.get(`wire_${edge.id}`)
      if (inst === undefined) continue
      const netA = inst.connects?.find((c) => c.terminal === 'terminal_a')?.net
      const netB = inst.connects?.find((c) => c.terminal === 'terminal_b')?.net
      const ohms = readScalarParam(inst, 'resistance') ?? 0
      if (netA === undefined || netB === undefined) continue
      info.set(edge.id, {
        netA,
        netB,
        ohms,
        label: `clamp · ${edge.source} → ${edge.target}`,
      })
    }
    return info
  }, [edges, solvedWorld])

  // The probed channels the Scope plots — terminals resolved through the same
  // terminal→net lookup the multimeter uses (block ports + lead taps
  // included); wire clamps through the wire-instance lookup.
  const scopeChannels = useMemo(
    () =>
      channelsForProbes(
        scopeProbes,
        (key) => probeNets.get(key),
        (edgeId) => scopeWireInfo.get(edgeId),
        (nodeId) => scopePartInfo.get(nodeId),
      ),
    [scopeProbes, probeNets, scopeWireInfo, scopePartInfo],
  )

  return {
    scopeResult,
    setScopeResult,
    scopeWindowSec,
    scopeSecPerDiv,
    setScopeSecPerDiv,
    scopeAutoWindowSec,
    scopeRefusal,
    setScopeRefusal,
    scopeFamily,
    setScopeFamily,
    scopeFamilyNote,
    setScopeFamilyNote,
    scopeProbes,
    setScopeProbes,
    scopeOpen,
    runScope,
    runFamily,
    onScopeProbeClick,
    scopeChannels,
  }
}
