import { useInternalNode, ViewportPortal } from '@xyflow/react'
import type { Instance, World } from '../cross-fk-validator.ts'
import { type Solution, solveDC } from '../dc-solver.ts'
import { solveTransient } from '../transient-solver.ts'
import { scopeWindow } from './scope.tsx'

/**
 * Multimeter tool (S19-v3-53/54/55) — point measurements, the way a real meter
 * works: touch the red probe to one terminal and the black to another and read
 * the value BETWEEN them per the dial — V⎓ (DC volts; red alone reads against
 * ground, both probes on one part also reads its current), V~ (true-RMS AC
 * volts from a real time-domain run), Ω (powered-off resistance + continuity),
 * ⏵ (diode test: real test current, forward drop). Touching a wire clamps onto
 * it and reads its current — the clamp-meter move. All values are live solved
 * data; an unwired terminal honestly reads "not wired", never a fake 0.
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
/** Continuity indication threshold — Fluke-117-class handhelds beep ≤ ~20 Ω. */
export const CONTINUITY_OHMS = 20
/** Real handheld Ω ranges top out around 40–60 MΩ; past 1 GΩ we show OL. */
const OVERLOAD_OHMS = 1e9
/**
 * Ω-mode test voltage. Real DMMs keep it BELOW junction turn-on (~0.6 V for
 * silicon) so in-circuit resistors measure correctly without forward-biasing
 * diodes — which is also why a diode honestly reads OL in Ω mode on a real
 * meter. R = V/I is exact for linear elements at any test voltage.
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
 * The shared powered-off test rig behind Ω mode and the diode test, built the
 * way the real measurements work: every source's EMF is set to zero while its
 * internal resistance stays in place (the textbook Thévenin rule), then a test
 * source with the instrument's own series resistance drives the probe pair.
 * The BLACK probe is the solve's reference — the meter brings its own, so a
 * lone part on the bench measures fine with no circuit ground.
 *
 * Returns the solved voltage ACROSS the probes (after the instrument's internal
 * drop) and the test current, or null when the sub-solve fails.
 */
function poweredOffProbe(
  world: World,
  netA: string,
  netB: string,
  testVolts: number,
  testOhms: number,
): { volts: number; amps: number } | null {
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

  const solution = solveDC({ ...world, instances }, { ground: netB })
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
 * Diode-test compliance voltage and series resistance. Handheld meters drive
 * roughly 0.5–1.5 mA with a few volts behind it — enough to read silicon
 * junctions (~0.6–0.7 V) and most LEDs at a real operating point. 3.0 V through
 * 2 kΩ gives 1.5 mA into a short; LEDs with forward voltage at or above ~3 V
 * (blue, UV) honestly read OL — exactly what lower-compliance real meters do.
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
 * honestly reads ~0 V~. The first third of the simulated window is discarded
 * so the start-up transient (capacitors charging from rest) doesn't pollute
 * the steady-state answer. Frequency comes from counting the AC waveform's
 * rising zero crossings — measured, not read off the source's label.
 *
 * Returns null when the time-domain solve can't run (its status tells why).
 */
export function acVoltsRms(
  world: World,
  netA: string,
  netB: string,
): { rms: number; hz: number | null } | null {
  const window = scopeWindow(world)
  const result = solveTransient(world, window)
  if (result.status !== 'solved' || result.series.length < 8) return null
  const settleTime = window.duration / 3
  const points = result.series.filter((p) => p.time >= settleTime)
  if (points.length < 4) return null
  const volts = points.map((p) => (p.nodes.get(netA) ?? 0) - (p.nodes.get(netB) ?? 0))
  const mean = volts.reduce((sum, v) => sum + v, 0) / volts.length
  const rms = Math.sqrt(volts.reduce((sum, v) => sum + (v - mean) ** 2, 0) / volts.length)

  // Frequency from mean crossings in BOTH directions — consecutive crossings of
  // a periodic wave are half-periods apart, so n crossings span (n−1)/2 periods.
  // Gated on real amplitude: a flat reading has no frequency to count.
  let crossings = 0
  let firstCrossing = -1
  let lastCrossing = -1
  for (let i = 1; i < volts.length; i++) {
    const before = (volts[i - 1] ?? 0) - mean
    const after = (volts[i] ?? 0) - mean
    if ((before <= 0 && after > 0) || (before >= 0 && after < 0)) {
      crossings += 1
      if (firstCrossing < 0) firstCrossing = i
      lastCrossing = i
    }
  }
  let hz: number | null = null
  if (rms >= 1e-3 && crossings >= 3 && lastCrossing > firstCrossing) {
    const firstTime = points[firstCrossing]?.time
    const lastTime = points[lastCrossing]?.time
    if (firstTime !== undefined && lastTime !== undefined && lastTime > firstTime) {
      hz = (crossings - 1) / (2 * (lastTime - firstTime))
    }
  }
  return { rms, hz }
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
