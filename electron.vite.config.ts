import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'

// The packaged app loads its renderer over file://, where Electron can't set a
// response-header CSP (electron/main.ts covers the dev server's http origin with
// a header instead). So the shipped build carries its Content-Security-Policy as
// a <meta> tag, injected here at BUILD time only — in dev the tag is absent so
// Vite's inline HMR preamble isn't blocked. 'unsafe-inline' on style-src is
// required: the renderer is inline-styled throughout (scripts stay locked to
// 'self' — the bundle is a same-origin external file).
const PROD_CONTENT_SECURITY_POLICY =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:"

function injectProdCspMeta(): Plugin {
  return {
    name: 'chipblocks-inject-csp-meta',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: PROD_CONTENT_SECURITY_POLICY },
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

// electron-vite three-context build (Sprint 18 — sprints/sprint-18.md).
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
    // Emit the preload as CommonJS (preload.cjs), NOT ESM. A sandboxed renderer
    // (webPreferences.sandbox: true in electron/main.ts) loads its preload through
    // a CommonJS-only shim, so an ESM (.mjs) preload silently fails to run. The
    // only import is `electron`, which the sandbox shim resolves at runtime, so it
    // stays externalized (externalizeDepsPlugin) rather than bundled.
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: 'electron/preload.ts' },
      rollupOptions: { output: { format: 'cjs' } },
    },
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: { input: { index: 'src/renderer/index.html' } },
    },
    plugins: [react(), injectProdCspMeta()],
  },
})
