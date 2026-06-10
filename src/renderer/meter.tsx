import { useInternalNode, ViewportPortal } from '@xyflow/react'
import type { Instance, World } from '../cross-fk-validator.ts'
import { type Solution, solveDC } from '../dc-solver.ts'
import { readScalarParam } from '../instance-params.ts'
import { solveTransient } from '../transient-solver.ts'
import { scopeWindow } from './scope.tsx'

/**
 * Multimeter tool (S19-v3-53/54/55) — point measurements, the way a real meter
 * works: touch the red probe to one terminal and the black to another and read
 * the value BETWEEN them per the dial — V⎓ (DC volts; red alone reads against
 * ground, both probes on one part also reads its current), V~ (true-RMS AC
 * volts from a real time-domain run), Ω (powered-off resistance + continuity),
 * ⏵ (diode test: real test current, forward drop). Touching a wire clamps onto
 * it and reads its current — the clamp-meter move. A real clamp senses the
 * conductor's magnetic field without breaking the circuit, so reading current
 * with ZERO burden voltage is the genuine physics of that method (burden is a
 * series-insertion effect; Fluke clamp guidance, verified 2026-06-10). All
 * values are live solved data; an unwired terminal honestly reads "not
 * wired", never a fake 0.
 */

export type ProbeRef = { nodeId: string; handleId: string }

/**
 * Every wired terminal's solved voltage, keyed `nodeId/terminal`. Terminals
 * with no wire have no net in the solve and so no entry — the meter reports
 * them as not wired.
 */
export function terminalVoltages(world: World, solution: Solution): Map<string, number> {
  const volts = new Map<string, number>()
  if (solution.status !== 'solved') return volts
  for (const inst of world.instances.values()) {
    for (const connect of inst.connects ?? []) {
      const v = solution.nodes.get(connect.net)
      if (v !== undefined) volts.set(`${inst.id}/${connect.terminal}`, v)
    }
  }
  return volts
}

/** Each wired terminal's net id, keyed `nodeId/terminal` — for the Ω probes. */
export function terminalNets(world: World): Map<string, string> {
  const nets = new Map<string, string>()
  for (const inst of world.instances.values()) {
    for (const connect of inst.connects ?? []) {
      nets.set(`${inst.id}/${connect.terminal}`, connect.net)
    }
  }
  return nets
}

const OHM_TEST_SOURCE_ID = 'meter_ohm_test_source'
/**
 * Continuity indication threshold — Fluke 117 datasheet: "Beeper on < 20 Ω,
 * off > 250 Ω" (verified against the published datasheet 2026-06-10).
 */
export const CONTINUITY_OHMS = 20
/** Real handheld Ω ranges top out at 40 MΩ (Fluke 117); past 1 GΩ we show OL. */
const OVERLOAD_OHMS = 1e9
/**
 * Ω-mode test voltage. The DOCUMENTED real-meter behavior this reproduces:
 * semiconductor junctions read open/OL in resistance mode (Fluke's own diode
 * guidance), so in-circuit resistors measure without diodes conducting. Real
 * meters get there by current-limiting per range (Fluke 117 Ω spec: open
 * circuit < 2.7 V, short circuit < 350 µA — verified 2026-06-10); we get to
 * the same verified outcome with a source held below junction turn-on. For
 * linear elements R = V/I is identical under either rig — Ohm's law does not
 * depend on the test level.
 */
const OHM_TEST_VOLTS = 0.2
/**
 * The instrument's own source impedance, subtracted exactly from the reading
 * (a real meter handles its lead/source resistance the same way — REL zeroing).
 * Also what lets the meter read a dead short: an IDEAL test source directly
 * across an ideal short (closed switch = 0 V stamp) is a contradictory system;
 * with series resistance it solves cleanly and the short reads 0 Ω.
 */
const TEST_SOURCE_OHMS = 1
/**
 * Tiny shunt (1 pS — the SPICE GMIN scale; ngspice's `gshunt` remedy) from
 * every net to the reference so floating sections (transformer secondaries,
 * capacitor-isolated nodes) can't make the sub-solve singular. Shifts answers
 * by ~1e-7 Ω at canvas scales — far below display precision.
 */
const SHUNT_OHMS = 1e12

/**
 * The shared powered-off test rig behind Ω mode, the diode test, and the
 * capacitance test, built the way the real measurements work: every source's
 * EMF is set to zero while its internal resistance stays in place (the
 * textbook Thévenin rule), then a test source with the instrument's own series
 * resistance drives the probe pair. The BLACK probe is the solve's reference —
 * the meter brings its own, so a lone part on the bench measures fine with no
 * circuit ground.
 */
function poweredOffWorld(
  world: World,
  netA: string,
  netB: string,
  testVolts: number,
  testOhms: number,
): World {
  const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
  const instances = new Map<string, Instance>()
  for (const [id, inst] of world.instances) {
    if (inst.definition === 'power_source') {
      instances.set(id, {
        ...inst,
        parameters: {
          ...inst.parameters,
          nominal_voltage: scalar(0, 'volt'),
          ac_amplitude: scalar(0, 'volt'),
        },
      })
    } else {
      instances.set(id, inst)
    }
  }
  instances.set(OHM_TEST_SOURCE_ID, {
    id: OHM_TEST_SOURCE_ID,
    kind_ref: 'primitive_device',
    definition: 'power_source',
    parameters: {
      nominal_voltage: scalar(testVolts, 'volt'),
      internal_resistance: scalar(testOhms, 'ohm'),
    },
    connects: [
      { net: netA, terminal: 'terminal_positive', of: OHM_TEST_SOURCE_ID },
      { net: netB, terminal: 'terminal_negative', of: OHM_TEST_SOURCE_ID },
    ],
  } as Instance)
  let shuntCount = 0
  for (const netId of world.nets.keys()) {
    if (netId === netB) continue
    shuntCount += 1
    const id = `meter_shunt_${shuntCount}`
    instances.set(id, {
      id,
      kind_ref: 'primitive_device',
      definition: 'resistor',
      parameters: { resistance: scalar(SHUNT_OHMS, 'ohm') },
      connects: [
        { net: netId, terminal: 'terminal_a', of: id },
        { net: netB, terminal: 'terminal_b', of: id },
      ],
    } as Instance)
  }
  return { ...world, instances }
}

/**
 * Solved DC voltage ACROSS the probes (after the instrument's internal drop)
 * and the test current on the powered-off rig, or null when the solve fails.
 */
function poweredOffProbe(
  world: World,
  netA: string,
  netB: string,
  testVolts: number,
  testOhms: number,
): { volts: number; amps: number } | null {
  const testWorld = poweredOffWorld(world, netA, netB, testVolts, testOhms)
  const solution = solveDC(testWorld, { ground: netB })
  if (solution.status !== 'solved') return null
  return {
    volts: solution.nodes.get(netA) ?? 0,
    amps: Math.abs(solution.branches.get(OHM_TEST_SOURCE_ID) ?? 0),
  }
}

/**
 * Equivalent (Thévenin) resistance between two nets — Ω mode. R = V/I from the
 * probe-pair voltage and the real solved test current; the instrument's series
 * resistance drops before the probes, so no correction term is needed.
 *
 * Returns null for an open loop or > 1 GΩ (a real meter shows OL).
 */
export function equivalentResistance(world: World, netA: string, netB: string): number | null {
  if (netA === netB) return 0
  const probe = poweredOffProbe(world, netA, netB, OHM_TEST_VOLTS, TEST_SOURCE_OHMS)
  if (probe === null) return null
  if (probe.amps < OHM_TEST_VOLTS / OVERLOAD_OHMS) return null // open loop
  const ohms = probe.volts / probe.amps
  if (ohms > OVERLOAD_OHMS) return null // past any real handheld's range
  return Math.max(0, ohms) // float error on a dead short can land at -1e-16
}

/**
 * Diode-test compliance voltage and series resistance. Fluke 117 diode test
 * spec (verified 2026-06-10): open circuit < 2.7 V, short circuit < 1.2 mA,
 * display full scale 2.000 V. Ours is the same idea at slightly higher
 * compliance — 3.0 V through 2 kΩ (1.5 mA into a short) — so red/green LEDs
 * around 2 V read a real operating point where a 117's 2.000 V display would
 * already show OL. LEDs at or above ~3 V forward (blue, UV) honestly read OL
 * here too, as on any meter whose compliance sits below their forward drop.
 */
const DIODE_TEST_VOLTS = 3.0
const DIODE_TEST_OHMS = 2000
/** Below this test current the junction isn't conducting — show OL. */
const DIODE_MIN_AMPS = 10e-6
/** Readings this close to the compliance voltage mean nothing conducted. */
const DIODE_OL_VOLTS = DIODE_TEST_VOLTS - 0.1

/**
 * Diode test (the ⏵ dial position) — push a real ~1 mA-class test current
 * red→black through the powered-off circuit and read the junction's forward
 * drop, the way a real meter checks a diode is alive and which way it points.
 * Reversed probes or an open/blown junction read OL (null).
 */
export function diodeTest(
  world: World,
  netA: string,
  netB: string,
): { volts: number; amps: number } | null {
  if (netA === netB) return null
  const probe = poweredOffProbe(world, netA, netB, DIODE_TEST_VOLTS, DIODE_TEST_OHMS)
  if (probe === null) return null
  if (probe.amps < DIODE_MIN_AMPS || probe.volts > DIODE_OL_VOLTS) return null
  return probe
}

/**
 * V~ mode — true-RMS AC volts between the probes, from a real time-domain run
 * of the LIVE circuit (sources on; this is the powered measurement). Like a
 * real DMM's V~ range the reading is AC-coupled: the mean (the DC level) is
 * subtracted and the RMS of what remains is displayed — a steady DC point
 * honestly reads ~0 V~ (the Fluke 117 datasheet states its AC volts ranges
 * are ac-coupled). The first third of the simulated window is discarded so
 * the start-up transient (capacitors charging from rest) doesn't pollute the
 * steady-state answer.
 *
 * Sampling follows the FASTEST source, not the display heuristic: the window
 * length tracks the slowest source, so a second fast source would otherwise
 * alias into a silently wrong RMS. We take ≥32 samples per fastest period;
 * when the sources span so many decades that one pass can't resolve both,
 * the meter refuses honestly ('span-too-wide') — a band-limited real meter
 * is out of range there too, it just rolls off instead of saying so.
 *
 * Returns null when the time-domain solve can't run (its status tells why).
 */
export function acVoltsRms(
  world: World,
  netA: string,
  netB: string,
): { rms: number; hz: number | null } | 'span-too-wide' | null {
  const window = scopeWindow(world)
  let fastestHz = 0
  for (const inst of world.instances.values()) {
    if (inst.definition !== 'power_source') continue
    const amplitude = readScalarParam(inst, 'ac_amplitude') ?? 0
    const frequency = readScalarParam(inst, 'frequency') ?? 0
    if (amplitude > 0 && frequency > fastestHz) fastestHz = frequency
  }
  const steps = Math.max(500, Math.ceil(window.duration * fastestHz * 32))
  if (steps > 20000) return 'span-too-wide'
  const result = solveTransient(world, {
    timeStep: window.duration / steps,
    duration: window.duration,
  })
  if (result.status !== 'solved' || result.series.length < 8) return null
  const settleTime = window.duration / 3
  const points = result.series.filter((p) => p.time >= settleTime)
  if (points.length < 4) return null
  const volts = points.map((p) => (p.nodes.get(netA) ?? 0) - (p.nodes.get(netB) ?? 0))
  const mean = volts.reduce((sum, v) => sum + v, 0) / volts.length
  const rms = Math.sqrt(volts.reduce((sum, v) => sum + (v - mean) ** 2, 0) / volts.length)

  // Frequency from band-transitions with hysteresis — the Schmitt-trigger
  // technique real counters use so ripple riding on the waveform can't
  // double-count a crossing: the band is ±10 % of the peak deviation, and an
  // excursion only counts after traversing the FULL band. The period comes
  // from SAME-direction events only (rising→rising or falling→falling),
  // which are spaced exactly one period apart for ANY periodic shape — a
  // half-wave-rectified hump included — so n of them span n−1 whole periods.
  // Both directions are tracked because a short analysis slice can clip one
  // direction's events at its edges. Ripple LARGER than the band still fools
  // the count — true of real handheld counters on strongly distorted signals
  // as well. Gated on real amplitude: a flat line has no frequency to count.
  const peak = volts.reduce((max, v) => Math.max(max, Math.abs(v - mean)), 0)
  const band = 0.1 * peak
  let state: 'high' | 'low' | 'between' = 'between'
  const rising = { count: 0, first: -1, last: -1 }
  const falling = { count: 0, first: -1, last: -1 }
  for (let i = 0; i < volts.length; i++) {
    const v = (volts[i] ?? 0) - mean
    const next: 'high' | 'low' | 'between' = v > band ? 'high' : v < -band ? 'low' : state
    const edge = state === 'low' && next === 'high' ? rising : null
    const fallEdge = state === 'high' && next === 'low' ? falling : null
    const hit = edge ?? fallEdge
    if (hit !== null) {
      hit.count += 1
      if (hit.first < 0) hit.first = i
      hit.last = i
    }
    state = next
  }
  const events = rising.count >= 2 ? rising : falling
  let hz: number | null = null
  if (rms >= 1e-3 && events.count >= 2 && events.last > events.first) {
    const firstTime = points[events.first]?.time
    const lastTime = points[events.last]?.time
    if (firstTime !== undefined && lastTime !== undefined && lastTime > firstTime) {
      hz = (events.count - 1) / (lastTime - firstTime)
    }
  }
  return { rms, hz }
}

/**
 * Capacitance test (the ⊣⊢ dial position). The real-meter method (Fluke,
 * verified 2026-06-10): charge the capacitor from a known source, measure the
 * resulting voltage, compute C = I·Δt/ΔV. Ours is the same identity with the
 * current integrated instead of held constant: C = Q/ΔV, Q = ∫i·dt. The test
 * level stays small so junctions don't conduct, same rationale as Ω mode.
 */
const CAP_TEST_VOLTS = 0.5
const CAP_TEST_OHMS = 10_000
/** Autorange windows, decade-stepped — simulated seconds are free. */
const CAP_WINDOWS = [1e-6, 1e-5, 1e-4, 1e-3, 1e-2, 1e-1, 1, 10, 100]
/** Settled when the probe voltage stops moving (0.3 % of the test voltage). */
const CAP_FLAT_VOLTS = 0.003 * CAP_TEST_VOLTS
/** Charged out when the test current has decayed to ≤ 2 % of its peak. */
const CAP_DECAY_RATIO = 0.02
/** Below ~50 pA peak nothing between the probes conducts at all. */
const CAP_OPEN_AMPS = 5e-11

export type CapacitanceResult =
  | { status: 'measured'; farads: number }
  | { status: 'parallel-leak' }
  | { status: 'over-range' }
  | { status: 'open' }
  | { status: 'failed' }

type ChargeWindow = {
  endVolts: number
  flat: boolean
  decayed: boolean
  endAmps: number
  peakAmps: number
  coulombs: number
  duration: number
}

/** One charge run: step the powered-off rig and integrate the real current. */
function runChargeWindow(
  testWorld: World,
  netA: string,
  netB: string,
  duration: number,
  steps: number,
): ChargeWindow | null {
  const result = solveTransient(testWorld, {
    ground: netB,
    timeStep: duration / steps,
    duration,
  })
  if (result.status !== 'solved' || result.series.length < 8) return null
  const series = result.series
  const probeVolts = series.map((p) => p.nodes.get(netA) ?? 0)
  // The test current follows from the source's Thévenin form: what the EMF
  // pushes minus what the probe node already sits at, over the known R.
  const amps = probeVolts.map((v) => (CAP_TEST_VOLTS - v) / CAP_TEST_OHMS)
  // Right-rectangle integration, NOT trapezoid: backward-Euler holds each
  // step's current at its end value, so this is the solver's own exact
  // integral — it telescopes to precisely C·ΔV for a capacitor at any step
  // size, where a trapezoid would carry a boundary error of i₀·Δt/2.
  let coulombs = 0
  for (let i = 1; i < amps.length; i++) {
    const dt = (series[i]?.time ?? 0) - (series[i - 1]?.time ?? 0)
    coulombs += (amps[i] ?? 0) * dt
  }
  const endVolts = probeVolts[probeVolts.length - 1] ?? 0
  const midVolts = probeVolts[Math.floor(probeVolts.length * 0.6)] ?? 0
  const endAmps = Math.abs(amps[amps.length - 1] ?? 0)
  const peakAmps = amps.reduce((max, a) => Math.max(max, Math.abs(a)), 0)
  return {
    endVolts,
    flat: Math.abs(endVolts - midVolts) < CAP_FLAT_VOLTS,
    decayed: endAmps <= CAP_DECAY_RATIO * peakAmps,
    endAmps,
    peakAmps,
    coulombs,
    duration,
  }
}

/**
 * Capacitance between the probes, measured the way a real meter does it:
 * powered-off circuit, capacitor starting DISCHARGED (the real procedure says
 * discharge before measuring — the sub-solve always starts there), a small
 * known test source charges the network, and C = Q/V from the real integrated
 * charge once the current has died out. The window autoranges across decades
 * until the charge curve fits, like a real meter hunting for its range.
 *
 * Honest refusals, same as the real instrument:
 *  - a resistive path in parallel keeps current flowing forever → no reading
 *    (real manuals say to free one leg of the capacitor first);
 *  - still charging past the 100 s window → over range;
 *  - nothing conducting at all → open (a bench meter shows ~0 there).
 */
export function capacitanceTest(world: World, netA: string, netB: string): CapacitanceResult {
  if (netA === netB) return { status: 'parallel-leak' } // shorted probes
  const testWorld = poweredOffWorld(world, netA, netB, CAP_TEST_VOLTS, CAP_TEST_OHMS)
  const runs: ChargeWindow[] = []
  for (const window of CAP_WINDOWS) {
    const coarse = runChargeWindow(testWorld, netA, netB, window, 120)
    if (coarse === null) return { status: 'failed' }
    runs.push(coarse)
    if (!(coarse.flat && coarse.decayed)) continue
    // The charge curve fits this window — re-run finer for the number (1200
    // steps keeps backward-Euler's systematic charge error under ~1 %).
    const fine = runChargeWindow(testWorld, netA, netB, window, 1200)
    if (fine === null) return { status: 'failed' }
    if (!fine.decayed) return { status: 'parallel-leak' }
    if (fine.peakAmps < CAP_OPEN_AMPS || fine.endVolts <= 0) return { status: 'open' }
    const farads = (fine.coulombs - fine.endAmps * fine.duration) / fine.endVolts
    return farads < 1e-12 ? { status: 'open' } : { status: 'measured', farads }
  }
  // Never settled cleanly. A leak plateaus (same end voltage every window); a
  // too-big capacitor keeps climbing decade after decade. Compare the last two.
  const last = runs[runs.length - 1]
  const prev = runs[runs.length - 2]
  if (last === undefined || prev === undefined) return { status: 'failed' }
  if (last.peakAmps < CAP_OPEN_AMPS) return { status: 'open' }
  const stillClimbing = last.endVolts > 2 * Math.max(prev.endVolts, 1e-12)
  return stillClimbing ? { status: 'over-range' } : { status: 'parallel-leak' }
}

/** A probe needle pinned to its terminal, riding along when the part moves. */
function ProbeMarker({ probe, color, label }: { probe: ProbeRef; color: string; label: string }) {
  const node = useInternalNode(probe.nodeId)
  if (!node) return null
  const handle = node.internals.handleBounds?.source?.find((h) => h.id === probe.handleId)
  if (!handle) return null
  const x = node.internals.positionAbsolute.x + handle.x + handle.width / 2
  const y = node.internals.positionAbsolute.y + handle.y + handle.height / 2
  return (
    <ViewportPortal>
      <div
        style={{
          position: 'absolute',
          transform: `translate(-50%, -100%) translate(${x}px, ${y - 5}px)`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          pointerEvents: 'none',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div
          style={{
            fontSize: 8,
            fontWeight: 700,
            color: '#fff',
            background: color,
            borderRadius: 3,
            padding: '1px 4px',
            marginBottom: 1,
          }}
        >
          {label}
        </div>
        <div style={{ color, fontSize: 11, lineHeight: 0.7 }}>▼</div>
      </div>
    </ViewportPortal>
  )
}

export const PROBE_RED = '#e0594f'
export const PROBE_BLACK = '#4a4f58'

/** Both probe needles (rendered inside the ReactFlow viewport). */
export function MeterProbes({
  red,
  black,
}: {
  red: ProbeRef | undefined
  black: ProbeRef | undefined
}) {
  return (
    <>
      {red ? <ProbeMarker probe={red} color={PROBE_RED} label="red" /> : null}
      {black ? <ProbeMarker probe={black} color={PROBE_BLACK} label="blk" /> : null}
    </>
  )
}
