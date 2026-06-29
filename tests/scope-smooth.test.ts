import { describe, expect, it } from 'vitest'
import { lanczos, sinc, smoothTrace } from '../src/renderer/scope-smooth.ts'

const parse = (s: string): { x: number; y: number }[] =>
  s
    .trim()
    .split(' ')
    .map((pair) => {
      const [x, y] = pair.split(',').map(Number)
      return { x: x ?? 0, y: y ?? 0 }
    })

describe('sin(x)/x reconstruction kernels', () => {
  it('sinc is 1 at 0 and 0 at every nonzero integer (the sample instants)', () => {
    expect(sinc(0)).toBe(1)
    for (const k of [1, 2, 3, 7]) expect(sinc(k)).toBeCloseTo(0, 12)
    expect(sinc(0.5)).toBeCloseTo(2 / Math.PI, 6) // sin(pi/2)/(pi/2)
  })

  it('lanczos windows the kernel to zero outside its support', () => {
    expect(lanczos(0, 6)).toBe(1)
    expect(lanczos(6, 6)).toBe(0)
    expect(lanczos(7, 6)).toBe(0)
    for (const k of [1, 2, 3, 4, 5]) expect(lanczos(k, 6)).toBeCloseTo(0, 12) // zero at inner nodes too
  })
})

describe('scope smoothTrace (display-only Lanczos sin(x)/x trace)', () => {
  const sine = (n: number, cycles: number) =>
    Array.from({ length: n }, (_, i) => ({
      t: i,
      v: Math.sin((i / (n - 1)) * cycles * 2 * Math.PI),
    }))

  it('upsamples a sparse trace into many more drawn vertices', () => {
    const pts = sine(16, 1)
    const out = parse(
      smoothTrace(
        pts,
        (p) => p.t * 10,
        (p) => p.v,
      ),
    )
    expect(out.length).toBeGreaterThan(pts.length * 4)
  })

  it('passes exactly through every real sample (kernel is zero at other sample instants)', () => {
    const pts = sine(16, 2)
    const factor = Math.min(12, Math.round(700 / pts.length)) // mirrors the impl
    // Pixel-scaled like the real scope (40 px/div × 100 px/unit); drawn points round to 0.1 px.
    const out = parse(
      smoothTrace(
        pts,
        (p) => p.t * 40,
        (p) => p.v * 100,
      ),
    )
    pts.forEach((real, k) => {
      const drawn = out[k * factor]
      expect(Math.abs((drawn?.x ?? 0) - real.t * 40)).toBeLessThan(0.06)
      expect(Math.abs((drawn?.y ?? 0) - real.v * 100)).toBeLessThan(0.06) // sits ON the real dot
    })
  })

  it('reconstructs a sine smoothly and bounded — mild Lanczos ring, not wild overshoot', () => {
    const pts = sine(24, 2)
    const ys = parse(
      smoothTrace(
        pts,
        (p) => p.t,
        (p) => p.v,
      ),
    ).map((p) => p.y)
    expect(Math.max(...ys)).toBeLessThan(1.25)
    expect(Math.min(...ys)).toBeGreaterThan(-1.25)
    let maxJump = 0
    for (let i = 1; i < ys.length; i++)
      maxJump = Math.max(maxJump, Math.abs((ys[i] ?? 0) - (ys[i - 1] ?? 0)))
    expect(maxJump).toBeLessThan(0.5) // consecutive vertices are close → smooth
  })

  it('leaves a constant (DC) trace perfectly flat — no ringing on a steady level', () => {
    const pts = Array.from({ length: 20 }, (_, i) => ({ t: i, v: 3 }))
    for (const p of parse(
      smoothTrace(
        pts,
        (q) => q.t,
        (q) => q.v,
      ),
    ))
      expect(p.y).toBeCloseTo(3, 6)
  })

  it('leaves an already-dense trace unchanged (one drawn vertex per real sample)', () => {
    const pts = Array.from({ length: 800 }, (_, i) => ({ t: i, v: Math.sin(i) }))
    expect(
      parse(
        smoothTrace(
          pts,
          (p) => p.t,
          (p) => p.v,
        ),
      ).length,
    ).toBe(800)
  })
})
