import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Browser-only config for the renderer — lets the canvas run in a plain
// browser (fast dev iteration + preview/screenshot) WITHOUT launching the
// full Electron shell. The Electron build uses electron.vite.config.ts.
// Named vite.renderer.config.ts (not vite.config.ts) so Vitest's auto-config
// detection ignores it.
export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  server: { port: 5180 },
})
