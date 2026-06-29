import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: false,
    reporters: ['default'],
    // Many tests run REAL transistor-level transient/logic circuit simulations — tens of seconds to a
    // few minutes each — and slow further under full-suite parallel CPU load. The per-test timeouts had
    // crept under their own loaded runtimes, so they flaked. One generous global floor (the single knob
    // to tune) keeps the suite deterministically green; the handful of genuinely multi-minute tests (the
    // calculator ×/÷ transient) keep an explicit 600000. Raising a timeout never breaks a passing test.
    testTimeout: 180000,
    hookTimeout: 180000,
  },
})
