import path from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Standalone test config: deliberately does NOT extend vite.config.ts
// because that file pulls in vite-plugin-electron, which doesn't make
// sense in a renderer-only test run (and tries to spawn Electron). We
// only need the React plugin so JSX/TSX files compile under Vitest.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.join(__dirname, 'src'),
    },
  },
  test: {
    root: __dirname,
    include: ['test/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./test/setup.ts'],
    testTimeout: 1000 * 29,
  },
})
