/**
 * Static timing — the math that turns gate delays + a clock into "does this chip work at speed?".
 *
 * This is the dominant real-chip constraint (a circuit that simulates is not the same as a chip that
 * works at frequency). The equations here are the textbook sign-off relations, grounded in the
 * 2026-06-22 chip-design research pass:
 *
 *   SETUP (sets the max clock speed) — a register captures correct data only if the clock period
 *   covers the launch flop's clock-to-Q, the WORST-CASE combinational delay, the setup time, and the
 *   clock skew:
 *           T ≥ t_cq + t_logic,max + t_setup + t_skew          (Weste & Harris, "CMOS VLSI Design")
 *           f_max = 1 / T_min,   T_min = t_cq + t_logic,max + t_setup + t_skew
 *           setup slack = T − T_min            (negative = violation: too fast, the data isn't ready)
 *
 *   HOLD (independent of clock speed — can't be fixed by slowing down) — the FASTEST path must still
 *   arrive after the capture flop's hold window:
 *           t_cq + t_logic,min ≥ t_hold + t_skew
 *           hold slack = (t_cq + t_logic,min) − (t_hold + t_skew)        (negative = violation)
 *
 *   METASTABILITY (crossing clock domains) — a setup/hold violation can leave a flop hovering between
 *   0 and 1; the mean-time-between-failures is exponential in the settling time available:
 *           MTBF = e^(t_MET / C2) / (C1 · f_CLK · f_DATA)     (Intel/Altera WP-01082, verified)
 *
 * This module is pure (no canvas, no solve). It takes register-to-register timing paths with their
 * gate delays and reports the critical path, the max frequency, slack, and violations. A later rung
 * feeds it REAL gate delays (rcGateDelay, below) extracted from the actual circuit, and walks the
 * canvas to build the paths. Worst-case skew is charged against BOTH setup and hold (a deliberate
 * first-rung simplification — real skew helps one and hurts the other depending on direction).
 */

/** ln(2) — the 50%-crossing factor of a single-stage RC step response (t = ln(2)·R·C). */
export const LN2 = Math.log(2)

/** One register's (flip-flop's) timing, in seconds. */
export type RegisterTiming = {
  /** Clock-to-Q: launch delay from the clock edge to a valid output. */
  clockToQ: number
  /** Setup: data must be stable this long BEFORE the capturing edge. */
  setup: number
  /** Hold: data must be stable this long AFTER the capturing edge. */
  hold: number
}

/** One register-to-register combinational path. Delays in seconds. */
export type TimingPath = {
  /** Launch register id (for reporting). */
  from: string
  /** Capture register id (for reporting). */
  to: string
  /** Worst-case (longest) combinational delay along the path — sets the setup limit. */
  logicDelayMax: number
  /** Best-case (shortest) combinational delay — sets the hold limit. */
  logicDelayMin: number
  /** The gate ids on the path, in order — so the critical path can be highlighted on the canvas. */
  gates: string[]
}

/**
 * Propagation delay (s) of a gate driving an RC load — the 50%-crossing step response:
 *   t_pd = ln(2) · R · C
 * where R = the conducting transistor's on-resistance (Ω) and C = the load it drives (F: the fan-out
 * gates' input capacitance + the wire capacitance). Real R and C in → a real delay out; this is the
 * single-stage RC-delay model (the Elmore delay of one segment). Returns 0 for non-positive inputs.
 */
export function rcGateDelay(onResistanceOhms: number, loadCapacitanceFarads: number): number {
  if (onResistanceOhms <= 0 || loadCapacitanceFarads <= 0) return 0
  return LN2 * onResistanceOhms * loadCapacitanceFarads
}

/**
 * A MOSFET's channel on-resistance in the triode (linear) region: R_on ≈ 1 / (k · V_OV), where k is
 * the device transconductance parameter (A/V²) and V_OV = |V_GS − V_th| is the gate overdrive (V,
 * positive when on). Derived straight from the existing device model — at the 2N7000's k = 26 mA/V²
 * a 10 V gate (overdrive 7.9 V) gives ~4.9 Ω, reproducing the datasheet R_DS(on) ≤ 5 Ω. Returns
 * Infinity when the device is off (no overdrive) — an open switch with no drive strength.
 */
export function triodeOnResistance(transconductanceK: number, gateOverdrive: number): number {
  if (transconductanceK <= 0 || gateOverdrive <= 0) return Number.POSITIVE_INFINITY
  return 1 / (transconductanceK * gateOverdrive)
}

/** The capacitive load a gate output drives: the fan-out gates' input capacitances (C_iss) summed,
 *  plus the wire capacitance (F). This is the C in t_pd = ln2·R_on·C. */
export function loadCapacitance(fanoutInputCaps: number[], wireCapacitance: number): number {
  let total = wireCapacitance > 0 ? wireCapacitance : 0
  for (const c of fanoutInputCaps) if (c > 0) total += c
  return total
}

/**
 * A logic gate's propagation delay, entirely from real physics: t_pd = ln2 · R_on · C_load, with R_on
 * derived from the driving transistor's k and gate overdrive (triodeOnResistance) and C_load summed
 * from the fan-out gates' C_iss + wire C (loadCapacitance). Infinite when the driver is off.
 */
export function gatePropagationDelay(
  transconductanceK: number,
  gateOverdrive: number,
  fanoutInputCaps: number[],
  wireCapacitance: number,
): number {
  const rOn = triodeOnResistance(transconductanceK, gateOverdrive)
  if (!Number.isFinite(rOn)) return Number.POSITIVE_INFINITY
  return rcGateDelay(rOn, loadCapacitance(fanoutInputCaps, wireCapacitance))
}

export type SetupResult = {
  /** T_min = t_cq + t_logic,max + t_setup + t_skew (s). */
  minPeriod: number
  /** 1 / T_min (Hz) — the fastest this path can be clocked. */
  maxFrequency: number
  /** T − T_min at the given clock period (s); negative = setup violation. */
  slack: number
  violated: boolean
}

/** Setup check for one path at a given clock period. */
export function setupCheck(
  path: TimingPath,
  reg: RegisterTiming,
  clockPeriod: number,
  skew = 0,
): SetupResult {
  const minPeriod = reg.clockToQ + path.logicDelayMax + reg.setup + skew
  const slack = clockPeriod - minPeriod
  return {
    minPeriod,
    maxFrequency: minPeriod > 0 ? 1 / minPeriod : Number.POSITIVE_INFINITY,
    slack,
    violated: slack < 0,
  }
}

export type HoldResult = {
  /** (t_cq + t_logic,min) − (t_hold + t_skew) (s); negative = hold violation. */
  slack: number
  violated: boolean
}

/** Hold check for one path. Independent of the clock period — a violation can't be clocked away. */
export function holdCheck(path: TimingPath, reg: RegisterTiming, skew = 0): HoldResult {
  const slack = reg.clockToQ + path.logicDelayMin - (reg.hold + skew)
  return { slack, violated: slack < 0 }
}

/** The critical path = the register-to-register path with the largest setup-limiting delay. */
export function criticalPath(paths: TimingPath[]): TimingPath | undefined {
  let worst: TimingPath | undefined
  for (const p of paths) {
    if (worst === undefined || p.logicDelayMax > worst.logicDelayMax) worst = p
  }
  return worst
}

export type TimingReport = {
  /** The slowest path — what limits the clock. Undefined when there are no paths. */
  critical: TimingPath | undefined
  /** T_min set by the critical path (s). */
  minPeriod: number
  /** The whole design's max clock frequency (Hz) — limited by the critical path. */
  maxFrequency: number
  /** Setup slack of the critical path at the requested clock period (s). */
  setupSlack: number
  setupViolated: boolean
  /** Every path whose fastest route violates hold (these break at ANY clock speed). */
  holdViolations: TimingPath[]
}

/** Analyse a whole design: critical path, max frequency, setup slack at `clockPeriod`, hold failures. */
export function analyzeTiming(
  paths: TimingPath[],
  reg: RegisterTiming,
  clockPeriod: number,
  skew = 0,
): TimingReport {
  const critical = criticalPath(paths)
  const setup = critical ? setupCheck(critical, reg, clockPeriod, skew) : undefined
  const holdViolations = paths.filter((p) => holdCheck(p, reg, skew).violated)
  return {
    critical,
    minPeriod: setup?.minPeriod ?? 0,
    maxFrequency: setup?.maxFrequency ?? Number.POSITIVE_INFINITY,
    setupSlack: setup?.slack ?? Number.POSITIVE_INFINITY,
    setupViolated: setup?.violated ?? false,
    holdViolations,
  }
}

/**
 * Synchronizer mean-time-between-failures (s) for a clock-domain crossing:
 *   MTBF = e^(t_MET / C2) / (C1 · f_CLK · f_DATA)
 * t_MET = settling time available (s, the slack past clock-to-Q); C2 = the flop's metastability
 * resolution time-constant τ (s); C1 = a setup-window constant (s); f_CLK = capture clock (Hz);
 * f_DATA = asynchronous data toggle rate (Hz). Because t_MET sits in the exponent, every extra few·C2
 * of settling time multiplies the MTBF — the reason synchronizers add flip-flop stages.
 * (Intel/Altera WP-01082, adversarially verified 2026-06-22.)
 */
export function synchronizerMtbf(
  settlingTime: number,
  c2: number,
  c1: number,
  clockFrequency: number,
  dataFrequency: number,
): number {
  const denom = c1 * clockFrequency * dataFrequency
  if (c2 <= 0 || denom <= 0) return Number.POSITIVE_INFINITY
  return Math.exp(settlingTime / c2) / denom
}
