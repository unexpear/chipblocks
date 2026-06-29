/**
 * sin(x)/x trace reconstruction — the smooth interpolation a real digital oscilloscope draws between
 * its samples. The scope records a circuit at a fixed time-step, so a zoomed-in window can hold only a
 * few of those samples; joining them with straight segments looks jagged. A real scope instead
 * reconstructs the underlying band-limited signal with a sin(x)/x (Whittaker–Shannon) kernel. We use the
 * Lanczos-windowed form so the reconstruction is finite and the edge ringing is tamed.
 *
 * This is DISPLAY ONLY: every cursor and measurement still reads the real samples, so nothing is
 * invented — the curve just passes smoothly through the real dots (and exactly through each one, since
 * the kernel is zero at every other sample instant). An already-dense trace is returned unchanged.
 */

/** sin(x)/x. The ideal (Whittaker–Shannon) reconstruction kernel; 1 at x=0. */
export function sinc(x: number): number {
  if (Math.abs(x) < 1e-12) return 1
  const px = Math.PI * x
  return Math.sin(px) / px
}

/** Lanczos window of the sinc kernel (support ±a) — a real scope's "sin(x)/x" interpolation, windowed. */
export function lanczos(x: number, a: number): number {
  const ax = Math.abs(x)
  if (ax < 1e-12) return 1
  if (ax >= a) return 0
  return sinc(x) * sinc(x / a)
}

/** Roughly how many drawn vertices a trace should have for a smooth curve at typical screen widths. */
export const TRACE_TARGET_VERTS = 700

/** Lanczos kernel half-width (samples each side that contribute to a reconstructed point). */
const LANCZOS_A = 6

/**
 * Reconstruct a time-domain trace as a smooth SVG `points` string. The samples are uniform in time
 * (fixed dt), so the screen-x is a uniform grid and we Lanczos-resample the screen-y across it. A trace
 * already at/above the target vertex count is returned as plain segments (it already reads smooth).
 */
export function smoothTrace<T>(arr: T[], getX: (p: T) => number, getY: (p: T) => number): string {
  const screen = arr.map((p) => ({ x: getX(p), y: getY(p) }))
  const n = screen.length
  const raw = () => screen.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  if (n < 4) return raw()
  const factor = Math.min(12, Math.round(TRACE_TARGET_VERTS / n))
  if (factor <= 1) return raw()
  const first = screen[0]
  const last = screen[n - 1]
  if (first === undefined || last === undefined) return raw()
  const out: string[] = []
  const M = (n - 1) * factor
  for (let i = 0; i <= M; i++) {
    const s = i / factor
    const lo = Math.max(0, Math.ceil(s - LANCZOS_A))
    const hi = Math.min(n - 1, Math.floor(s + LANCZOS_A))
    let num = 0
    let den = 0
    for (let k = lo; k <= hi; k++) {
      const w = lanczos(s - k, LANCZOS_A)
      const pk = screen[k]
      if (pk === undefined) continue
      num += pk.y * w
      den += w
    }
    const xPos = first.x + ((last.x - first.x) * s) / (n - 1)
    const nearest = screen[Math.round(s)]
    const yPos = den !== 0 ? num / den : (nearest?.y ?? 0)
    out.push(`${xPos.toFixed(1)},${yPos.toFixed(1)}`)
  }
  return out.join(' ')
}
