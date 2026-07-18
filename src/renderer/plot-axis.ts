/**
 * Shared plot-axis helpers for the analysis panels' pure view modules (reflection-view, distortion-view,
 * sparam-view). Auto-ranging a dB / VSWR / gain axis is the same job in each — snap to a round step and pad to
 * a minimum span so a flat trace still gets a readable axis — so it lives here once instead of three copies.
 */
export const niceFloor = (value: number, step: number) => Math.floor(value / step) * step
export const niceCeil = (value: number, step: number) => Math.ceil(value / step) * step

/** Pad [min,max] to a minimum span, snapped to `step`, centered on the data. */
export function axisRange(
  min: number,
  max: number,
  step: number,
  minSpan: number,
): [number, number] {
  let lo = niceFloor(min, step)
  let hi = niceCeil(max, step)
  if (hi - lo < minSpan) {
    const mid = (lo + hi) / 2
    lo = niceFloor(mid - minSpan / 2, step)
    hi = niceCeil(mid + minSpan / 2, step)
  }
  return [lo, hi]
}
