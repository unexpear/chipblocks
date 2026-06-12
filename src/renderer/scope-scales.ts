/**
 * Scope scales (S19-v3-78): timebase and volts-per-division, the two knobs of
 * a bench oscilloscope. The screen is a fixed graticule (10 divisions across,
 * 8 tall — the bench convention); the knobs say how much time one horizontal
 * division spans and how many volts one vertical division spans PER CHANNEL.
 * Knob stops follow the universal 1-2-5 sequence real scopes use.
 *
 * Honesty rule (same spirit as the multimeter's V~ sampling, meter.tsx): the
 * record must carry >= 32 samples per cycle of the FASTEST source, capped at
 * 20 000 steps total. A timebase slow enough to break that would alias — the
 * scope refuses and names the slowest honest setting instead of drawing a lie.
 */

export const H_DIVISIONS = 10
export const V_DIVISIONS = 8

/** Auto vertical fit fills this many of the 8 divisions (bench autoset ~80%). */
export const AUTO_FILL_DIVISIONS = 6.4

function oneTwoFive(minValue: number, maxValue: number): number[] {
  const values: number[] = []
  for (let exponent = -9; exponent <= 3; exponent++) {
    for (const mantissa of [1, 2, 5]) {
      const value = mantissa * 10 ** exponent
      if (value >= minValue * 0.999 && value <= maxValue * 1.001) values.push(value)
    }
  }
  return values
}

/** Timebase stops, seconds per division: 1 µs/div up to 1 s/div. */
export const TIMEBASES = oneTwoFive(1e-6, 1)

/** Vertical stops, volts per division: 1 mV/div up to 20 V/div. */
export const VOLTS_PER_DIV = oneTwoFive(1e-3, 20)

/**
 * One channel's vertical mapping: volts per division plus the voltage sitting
 * at screen center. The offset auto-centers on the channel's midpoint, then
 * the POSITION knob (S20-v3-10) slides the trace up (+) or down (−) by whole
 * fractions of a division — display placement only, the data is untouched,
 * exactly the second-most-used knob on a bench scope (it separates two
 * same-shape traces that would otherwise overlap). Auto scale fits the swing
 * into AUTO_FILL_DIVISIONS; a flat trace gets 0.125 V/div (the full screen
 * spans 1 V around it, matching the old flat-line view).
 */
export function transformFor(
  lo: number,
  hi: number,
  setting: number | 'auto',
  positionDivisions = 0,
): { voltsPerDiv: number; offsetVolts: number } {
  const midpoint = (lo + hi) / 2
  const swing = hi - lo
  const voltsPerDiv =
    setting !== 'auto' ? setting : swing > 1e-12 ? swing / AUTO_FILL_DIVISIONS : 1 / V_DIVISIONS
  // Moving the trace UP by p divisions = showing a voltage p·vdiv LOWER at
  // screen center.
  return { voltsPerDiv, offsetVolts: midpoint - positionDivisions * voltsPerDiv }
}

const SAMPLES_PER_CYCLE = 32
const MAX_STEPS = 20000
const MIN_STEPS = 1500

/**
 * Steps for the whole record (display floor 500 per window x 3 windows), or
 * the honest refusal when sampling the fastest source would blow the cap.
 */
export function scopeRecordSteps(
  recordSeconds: number,
  fastestSourceHz: number,
): number | 'span-too-wide' {
  const forSampling = Math.ceil(recordSeconds * fastestSourceHz * SAMPLES_PER_CYCLE)
  const steps = Math.max(MIN_STEPS, forSampling)
  return steps > MAX_STEPS ? 'span-too-wide' : steps
}

/**
 * The slowest timebase stop that still samples honestly — what the refusal
 * message tells the user to back off to. With no AC source every stop passes
 * (the floor of 1500 steps always fits), so the answer is the top of the list.
 */
export function slowestHonestTimebase(fastestSourceHz: number): number {
  for (let i = TIMEBASES.length - 1; i >= 0; i--) {
    const timebase = TIMEBASES[i] ?? 1
    if (scopeRecordSteps(timebase * H_DIVISIONS * 3, fastestSourceHz) !== 'span-too-wide')
      return timebase
  }
  return TIMEBASES[0] ?? 1e-6
}
