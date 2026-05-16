import { describe, it, expect } from 'vitest'

// Sprint 2 sanity check: vitest is restored and runs. Real
// manifest-integrity tests follow in subsequent S2-* sub-commits.
describe('vitest restored', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
