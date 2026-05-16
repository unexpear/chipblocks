import { defineConfig } from 'vitest/config'

// Sprint 2 minimal vitest setup. Tests live in frontend/test/.
// Manifest-integrity tests load the YAML manifests + JSON schemas
// from the repo root and validate via ajv.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    environment: 'node',
  },
})
