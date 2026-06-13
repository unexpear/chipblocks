import { useInternalNode, ViewportPortal } from '@xyflow/react'
import type { Instance, World } from '../cross-fk-validator.ts'
import { type Solution, solveDC } from '../dc-solver.ts'
import { solveElectroThermal, solveTransientThermal } from '../electro-thermal.ts'
import { solveTransient } from '../transient-solver.ts'
import { fastestSourceHz, scopeWindow } from './scope.tsx'
import { measureSeries } from './waveform-measure.ts'

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
 * The test leads' own resistance (S20-v3-13), pair total including contact
 * resistance — a class value (quality leads measure tens of mΩ each; worn
 * tips and contact pressure push the pair toward a few hundred mΩ; medium
 * confidence, stated). A 2-wire ohmmeter measures THROUGH its leads, so
 * every Ω reading carries this — shorted probes read it directly, which is
 * exactly what the REL/zero workflow exists to subtract. The same 0.2 Ω
 * sits in series in every other two-probe mode too, where it is below
 * display resolution by arithmetic (0.2 Ω against the 10 MΩ voltmeter
 * input, the 2 kΩ diode rig, the 10 kΩ capacitance rig) and is therefore
 * not added there — an approximation stated, not hidden.
 */
export const LEAD_OHMS = 0.2

/**
 * Equivalent (Thévenin) resistance between two nets — Ω mode. R = V/I from the
 * probe-pair voltage and the real solved test current; the instrument's series
 * resistance drops before the probes, so no correction term is needed. The
 * LEADS are part of the measured loop (2-wire measurement): the displayed
 * value is R + LEAD_OHMS, and touching the probes together reads the leads
 * alone — the REL anchor.
 *
 * Returns null for an open loop or > 1 GΩ (a real meter shows OL).
 */
export function equivalentResistance(world: World, netA: string, netB: string): number | null {
  if (netA === netB) return LEAD_OHMS // shorted probes measure the leads
  const probe = poweredOffProbe(world, netA, netB, OHM_TEST_VOLTS, TEST_SOURCE_OHMS)
  if (probe === null) return null
  if (probe.amps < OHM_TEST_VOLTS / OVERLOAD_OHMS) return null // open loop
  const ohms = probe.volts / probe.amps
  if (ohms > OVERLOAD_OHMS) return null // past any real handheld's range
  return Math.max(0, ohms) + LEAD_OHMS // float error on a dead short can land at -1e-16
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
 * The voltmeter's input impedance (S20-v3-12) — a real DMM's V input is a
 * ~10 MΩ resistance to its common (Fluke 117 datasheet: input impedance
 * 10 MΩ; the 87V the same). Probing a point puts that resistance INTO the
 * circuit: invisible on stiff (kΩ-class) circuits, but on high-impedance
 * ones the meter itself bends the reading — the classic loading lesson.
 * Both V modes here measure through it for real: the reading comes from a
 * sub-solve of the circuit WITH the meter's input resistance connected.
 */
export const VOLTMETER_INPUT_OHMS = 10e6

const VOLTMETER_LOAD_ID = 'meter_input_impedance'

/** The world with the meter's 10 MΩ input connected between the probe nets. */
function withVoltmeterLoad(world: World, netRed: string, netBlack: string): World {
  const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
  const instances = new Map<string, Instance>(world.instances)
  instances.set(VOLTMETER_LOAD_ID, {
    id: VOLTMETER_LOAD_ID,
    kind_ref: 'primitive_device',
    definition: 'resistor',
    parameters: { resistance: scalar(VOLTMETER_INPUT_OHMS, 'ohm') },
    connects: [
      { net: netRed, terminal: 'terminal_a', of: VOLTMETER_LOAD_ID },
      { net: netBlack, terminal: 'terminal_b', of: VOLTMETER_LOAD_ID },
    ],
  } as Instance)
  return { ...world, instances }
}

/** The reference net a lone red probe measures against — the (deterministic
 *  first) ground-typed net, the same convention the solver itself uses. */
export function groundNetOf(world: World): string | undefined {
  const nets: string[] = []
  for (const net of world.nets.values()) {
    if (net.type === 'ground') nets.push(net.id)
  }
  return nets.sort()[0]
}

/**
 * The V⎓ measurement solve: the live circuit WITH the meter's input
 * resistance across the probes. Callers read the loaded node voltages (and
 * the through-part current convenience) from the returned solution — what
 * the meter displays IS what the loaded circuit does.
 *
 * Solved through the electro-thermal loop (S20-v3-17), NOT a cold solveDC:
 * the rest of the system (the clamp, the scope, the Properties/Math panels)
 * reports the warm operating point, so this live measurement must share that
 * one temperature too — otherwise the meter's own voltage dial would disagree
 * with its own current clamp by the self-heating drift. The meter's 10 MΩ
 * input carries no thermal rating, so it just sits in the network and the
 * loop heats the real circuit exactly as the main solve does.
 */
export function voltmeterSolve(world: World, netRed: string, netBlack: string): Solution | null {
  if (netRed === netBlack) return null
  const { solution } = solveElectroThermal(withVoltmeterLoad(world, netRed, netBlack))
  return solution.status === 'solved' ? solution : null
}

/**
 * V~ mode — true-RMS AC volts between the probes, from a real time-domain run
 * of the LIVE circuit (sources on; this is the powered measurement). Like a
 * real DMM's V~ range the reading is AC-coupled: the mean (the DC level) is
 * subtracted and the RMS of what remains is displayed — a steady DC point
 * honestly reads ~0 V~ (the Fluke 117 datasheet states its AC volts ranges
 * are ac-coupled). The first third of the simulated window is discarded so
 * the start-up transient (capacitors charging from rest) doesn't pollute the
 * steady-state answer. The measurement is taken THROUGH the meter's 10 MΩ
 * input (S20-v3-12) — high-impedance circuits sag here exactly as on V⎓.
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
function settledProbeSeries(
  world: World,
  netA: string,
  netB: string,
): { t: number; v: number }[] | 'span-too-wide' | null {
  const loaded = netA === netB ? world : withVoltmeterLoad(world, netA, netB)
  const window = scopeWindow(world)
  const fastestHz = fastestSourceHz(world)
  const steps = Math.max(500, Math.ceil(window.duration * fastestHz * 32))
  if (steps > 20000) return 'span-too-wide'
  // Through the transient electro-thermal loop (S20-v3-17), same as the scope —
  // V~ and MIN/MAX share the one warm operating point with every other live
  // instrument instead of reading a cold circuit.
  const { result } = solveTransientThermal(loaded, {
    timeStep: window.duration / steps,
    duration: window.duration,
  })
  if (result.status !== 'solved' || result.series.length < 8) return null
  const settleTime = window.duration / 3
  const points = result.series.filter((p) => p.time >= settleTime)
  if (points.length < 4) return null
  return points.map((p) => ({
    t: p.time,
    v: (p.nodes.get(netA) ?? 0) - (p.nodes.get(netB) ?? 0),
  }))
}

export function acVoltsRms(
  world: World,
  netA: string,
  netB: string,
): { rms: number; hz: number | null; duty: number | null } | 'span-too-wide' | null {
  const series = settledProbeSeries(world, netA, netB)
  if (series === 'span-too-wide' || series === null) return series
  // The RMS + Schmitt-hysteresis frequency math lives in waveform-measure.ts
  // (S19-v3-80) — one implementation shared with the scope's measurement
  // strip, so the two instruments can never disagree. Duty (S20-v3-16) rides
  // along from the same shared module: the fraction of each period spent
  // above the 50 % level.
  const measured = measureSeries(series)
  return { rms: measured.rmsAc, hz: measured.hz, duty: measured.dutyHigh }
}

/**
 * MIN/MAX/AVG (S20-v3-14) — what the button on a bench meter records while a
 * signal varies, read off the same settled time-domain record V~ uses: the
 * instantaneous extremes and the mean of the probe-pair voltage. On a steady
 * DC point all three agree; on a ripply or swinging point MIN/MAX bound the
 * excursion and AVG is the DC component. Measured through the meter's 10 MΩ
 * input like every voltage mode.
 */
export function dcExtremes(
  world: World,
  netA: string,
  netB: string,
): { min: number; max: number; avg: number } | 'span-too-wide' | null {
  const series = settledProbeSeries(world, netA, netB)
  if (series === 'span-too-wide' || series === null) return series
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let sum = 0
  for (const point of series) {
    if (point.v < min) min = point.v
    if (point.v > max) max = point.v
    sum += point.v
  }
  return { min, max, avg: sum / series.length }
}

/**
 * 6000-count display (S20-v3-16) — the Fluke 117 is a 6000-count meter: four
 * digits, the last quantized to the range's resolution (range/6000), ranges
 * stepping 6 / 60 / 600 per decade. The solver knows values to float
 * precision; a real display does not, and printing more digits than the
 * instrument class resolves would overstate the measurement. The eng prefix
 * follows the range the way the real display does (5999 Ω reads 5.999 kΩ).
 */
export const DISPLAY_COUNTS = 6000

const COUNT_PREFIXES: Record<number, string> = {
  '-12': 'p',
  '-9': 'n',
  '-6': 'µ',
  '-3': 'm',
  0: '',
  3: 'k',
  6: 'M',
  9: 'G',
}

export function displayCounts(value: number, unit: string): string {
  if (!Number.isFinite(value)) return `OL ${unit}`
  // Below any handheld range's resolution (and solver float dust) the real
  // display sits at zero — never scientific notation on a meter face.
  if (Math.abs(value) < 1e-9) return `0.000 ${unit}`
  const magnitude = Math.abs(value)
  const exponent = Math.ceil(Math.log10(magnitude / 6))
  const resolution = (6 * 10 ** exponent) / DISPLAY_COUNTS
  const quantized = Math.round(value / resolution) * resolution
  const prefixExp = 3 * Math.floor(exponent / 3)
  const decimals = 3 - (exponent - prefixExp)
  const scaled = quantized / 10 ** prefixExp
  const prefix = COUNT_PREFIXES[prefixExp] ?? `e${prefixExp}`
  return `${scaled.toFixed(decimals)} ${prefix}${unit}`
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

/**
 * Series ammeter (S20-v3-11, the A⎓ dial position) — the meter becomes a REAL
 * element of the live circuit: a small shunt resistance between the probes,
 * behind a fuse. That one honest mechanism gives all three behaviors of the
 * real instrument with no special cases:
 *  - the CORRECT procedure: open the circuit (flip a switch off, lift a wire)
 *    and bridge the gap with the probes — the loop's current now flows
 *    through the meter and is read exactly;
 *  - the BURDEN: the shunt drops a real voltage (I·R_shunt), so inserting the
 *    meter slightly changes the circuit it measures — the reason clamp meters
 *    exist (the wire clamp reads with zero burden; this jack pays it);
 *  - the FAMOUS MISTAKE: probes across a live source put the near-short shunt
 *    directly across it — the resulting current blows the fuse.
 *
 * Jack values are the Fluke 87V's published figures (the electronics meter the
 * research pointed at; our reference 117 has no mA range at all):
 *  - mA jack: burden 1.8 mV/mA → 1.8 Ω effective shunt (Fluke "Can you live
 *    with the burden?" article, which derives the same 1.8 Ω; verified
 *    2026-06-12), fused at 440 mA (Fluke 440 mA/1000 V fast fuse — the
 *    87V's mA/µA input fuse, Fluke product page, verified 2026-06-12).
 *  - 10 A jack: fused at 11 A (Fluke 11 A/1000 V fuse, verified 2026-06-12);
 *    shunt 0.03 Ω — class value (~30 mV/A burden), consistent with the
 *    published mA-range method; the exact A-input figure is not in the public
 *    datasheet (confidence medium, stated).
 *
 * Fuse model: a fast fuse carries its rating and opens above it. Sustained
 * current past the rating blows it here; the real I²t time dependence (brief
 * surges above rating that a fast fuse still rides out) is not modeled —
 * stated honestly. A blown fuse is an OPEN: the meter drops out of the
 * circuit entirely until replaced (the caller owns that state, like the
 * spare-fuse compartment in a real meter).
 */
export type AmmeterJack = 'milliamp' | 'amp'

export const AMMETER_JACKS: Record<
  AmmeterJack,
  { shuntOhms: number; fuseAmps: number; label: string }
> = {
  milliamp: { shuntOhms: 1.8, fuseAmps: 0.44, label: 'mA' },
  amp: { shuntOhms: 0.03, fuseAmps: 11, label: '10 A' },
}

const AMMETER_SHUNT_ID = 'meter_ammeter_shunt'

export type AmmeterResult =
  | { status: 'measured'; amps: number; burdenVolts: number }
  | { status: 'blew'; amps: number }
  | { status: 'failed' }

/**
 * Insert the meter's shunt between the probe nets of the LIVE circuit and
 * read the current through itself (red → black positive, like current
 * entering a real meter's A jack). Past the jack's fuse rating → 'blew',
 * carrying the current that did it for the display.
 */
export function seriesAmmeter(
  world: World,
  netRed: string,
  netBlack: string,
  jack: AmmeterJack,
): AmmeterResult {
  const spec = AMMETER_JACKS[jack]
  const scalar = (amount: number, unit: string) => ({ value: { kind: 'scalar', amount, unit } })
  const instances = new Map<string, Instance>(world.instances)
  instances.set(AMMETER_SHUNT_ID, {
    id: AMMETER_SHUNT_ID,
    kind_ref: 'primitive_device',
    definition: 'resistor',
    parameters: { resistance: scalar(spec.shuntOhms, 'ohm') },
    connects: [
      { net: netRed, terminal: 'terminal_a', of: AMMETER_SHUNT_ID },
      { net: netBlack, terminal: 'terminal_b', of: AMMETER_SHUNT_ID },
    ],
  } as Instance)
  // Through the electro-thermal loop (S20-v3-17): the inserted meter measures
  // the same warm circuit the clamp and panels do, so its current agrees with
  // theirs (minus its own honest burden) instead of reading a cold circuit.
  const { solution } = solveElectroThermal({ ...world, instances })
  if (solution.status !== 'solved') return { status: 'failed' }
  const amps = solution.branches.get(AMMETER_SHUNT_ID) ?? 0
  if (Math.abs(amps) > spec.fuseAmps) return { status: 'blew', amps }
  return { status: 'measured', amps, burdenVolts: amps * spec.shuntOhms }
}

/** A probe needle pinned to its terminal, riding along when the part moves.
 *  Shared by the meter's red/black leads and the Scope's channel probes. */
export function ProbeMarker({
  probe,
  color,
  label,
}: {
  probe: ProbeRef
  color: string
  label: string
}) {
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
