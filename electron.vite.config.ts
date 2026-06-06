import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

// electron-vite three-context build (OBJECT-MODEL.md §22 — Sprint 18).
// main + preload are Node/Electron (deps kept external); renderer is the
// React + React Flow web app.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: 'electron/main.ts' },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: 'electron/preload.ts' },
    },
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: { input: { index: 'src/renderer/index.html' } },
    },
    plugins: [react()],
  },
})
