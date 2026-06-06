# v3 Sprint 18 — Canvas MVP (the frontend lands)

> **Status:** Sprint plan, opened 2026-06-06 against master tip `8393294`.
> **Predecessor:** Sprint 17 closed terminal-name validation. 236 tests, 21 spec sections, 5 source modules — a deep logic/data foundation (schemas + cross-FK validator + DC solver + nonlinear solver + failure detector) with **no frontend**. Sprint 18 is the big pivot: the project gets an actual canvas.
> **Scope:** Stand up the **Electron + React + TypeScript** frontend (per CLAUDE.md's documented stack — user-confirmed Electron-from-start, 2026-06-06) with React Flow as the canvas engine and electron-vite as the build integration. Load the existing catalog fixtures, and **render the educational anchor circuit** as a schematic — first as labeled nodes, then with standard schematic symbols (per SCHEMATIC-SYMBOLS.md's commitment). Static render only: no interactivity, no solver overlay, no lenses (those are later canvas sprints).
>
> **Shell decision (2026-06-06):** the user chose Electron-from-start over a browser-first MVP, matching CLAUDE.md's stated stack. The renderer is still React + React Flow + Vite; Electron wraps it via electron-vite (main + preload + renderer processes).

---

## Sprint 18 goal in plain English

Everything built across Sprints 12–17 — the materials, devices, nets, the 69.36 mA solve, the overloaded-LED failure — has been invisible. It lives in YAML and TypeScript and test output. Sprint 18 makes it **visible**: load the anchor circuit and draw it on screen as a schematic, the way an electronics person would sketch it.

This is the first slice of Stage 5 of the simulation+visualization arc. It deliberately does the minimum that proves the hard part — standing up a real frontend in a repo that has been pure logic, and getting the catalog data to flow into a rendered canvas. Interactivity (drag, wire, place), the solver overlay (show the voltages + currents + the red overloaded LED), and visualization lenses are the *next* canvas sprints; they build on the pipeline this sprint establishes.

---

## After this sprint

1. **A runnable frontend** — `npm run dev` opens a Vite + React app in the browser showing the canvas. `npm run build` produces a static bundle.
2. **React Flow** (`@xyflow/react`, MIT) as the canvas engine — the intended canvas per CLAUDE.md, now real.
3. **Catalog → canvas pipeline** — the existing fixture YAML (devices, instances, nets) loads in the browser and becomes React Flow nodes (device instances) + edges (nets), reusing the same `loadWorld` shape the tests use.
4. **The educational anchor circuit renders** — battery → wire → switch → resistor → LED → wire → ground, drawn as a connected schematic.
5. **Standard schematic symbols** for the anchor circuit's device kinds (battery, switch, resistor, LED, ground; wire as an edge) — per SCHEMATIC-SYMBOLS.md's commitment to IEC 60617 / IEEE 315 conventions, not invented icons.
6. **License compliance** — the new deps (React, React-DOM, React Flow, Vite-as-direct-dep) added to THIRD-PARTY-LICENSES.md + NOTICE per the project's discipline.
7. **A new gate** — `npm run build` (the frontend compiles) joins tsc + vitest + biome.

---

## Non-goals (explicit, with reasons)

- **Electron IS in scope (user choice 2026-06-06).** The shell is Electron-from-start per CLAUDE.md's documented stack — main process + preload + renderer, wired via electron-vite. Packaging into a distributable installer (electron-builder) is NOT in scope; the MVP runs via `npm run dev` (electron-vite dev) and builds the renderer + main. Packaging is a later sprint.
- **No interactivity.** No drag-to-move, no place-component, no draw-a-wire, no right-click menus. The MVP renders the anchor circuit statically from the fixtures. Interactivity is the next canvas sprint — it needs the auto-created-interface UX + right-click-override §15 rows.
- **No solver overlay.** The canvas does NOT yet show node voltages, branch currents, or the red overloaded LED. That's the killer feature, but it's the *next* sprint (Sprint 19): the static render must be solid first. The solver (`solveDC`) + failure detector (`detectFailures`) are ready to consume when it lands.
- **No visualization lenses.** Voltage maps, current-flow animation, thermal hotspots — Stage 6, well after the canvas basics.
- **No canvas-only state persistence (`canvas/layout.yaml`).** The §15 auto-created-interface row reserves a separate file for position/lock/color. The MVP auto-lays-out the anchor circuit (fixed positions or a simple layout); persisting user-moved positions is deferred with interactivity.
- **No symbol library beyond the anchor circuit's kinds.** Only the device kinds the anchor circuit uses get symbols this sprint. The full IEC/IEEE symbol set (transistors, op-amps, etc.) lands as devices need them.
- **No new physics / logic.** Sprint 18 is pure presentation. The solver, validator, schemas, fixtures are untouched (except the loader is reused).

---

## Toolchain additions (all MIT — verified 2026-06-06)

| Dep | Version | License | Role |
|---|---|---|---|
| `electron` | 42.x | MIT | the desktop shell (main process + Chromium renderer) |
| `electron-vite` | 5.x | MIT | build integration — main / preload / renderer with Vite, dev + build |
| `react` | 19.2.x | MIT | UI framework (renderer) |
| `react-dom` | 19.2.x | MIT | DOM renderer |
| `@xyflow/react` (React Flow) | 12.11.x | MIT | the canvas engine |
| `vite` | 8.0.x | MIT | bundler under electron-vite (already a transitive dep via Vitest; now direct) |
| `@vitejs/plugin-react` | latest | MIT | React fast-refresh + JSX transform |
| `@types/react`, `@types/react-dom` | latest | MIT | types |

React Flow 12 supports React 18+; React 19 + Electron 42 compatibility verified during S18-v3-2 (the empty-canvas smoke). All MIT, on the permissive whitelist. NOTICE/THIRD-PARTY updates handled in S18-v3-2. electron-builder (packaging) is NOT added this sprint.

---

## Deliverables

```
package.json                                electron / electron-vite / react / react-dom /
                                            @xyflow/react / vite / @vitejs/plugin-react /
                                            @types/react(-dom); scripts: dev, build
electron.vite.config.ts                     NEW — electron-vite config (main / preload / renderer)
tsconfig.node.json / tsconfig.web.json      NEW — split configs: Node (main/preload/logic)
  (+ root tsconfig refs)                     vs DOM+JSX (renderer); existing Node config kept

electron/
├── main.ts                                 NEW — Electron main process; creates the window
└── preload.ts                              NEW — preload (contextBridge; minimal for the MVP)

src/renderer/
├── index.html                              NEW — renderer entry
├── main.tsx                                NEW — React entry, mounts the app
├── App.tsx                                 NEW — the canvas page
├── catalog-loader.ts                       NEW — load fixture YAML → World (Vite import)
├── world-to-flow.ts                        NEW — World → React Flow nodes + edges (PURE)
└── symbols/                                NEW — standard schematic symbol components
    ├── BatterySymbol.tsx
    ├── ResistorSymbol.tsx
    ├── LedSymbol.tsx
    ├── SwitchSymbol.tsx
    └── GroundSymbol.tsx

THIRD-PARTY-LICENSES.md + NOTICE            updated for the new deps

tests/
└── world-to-flow.test.ts                   NEW — the catalog→flow mapping is pure + testable
```

---

## Sub-commit sequence

| # | Commit | Scope |
|---|---|---|
| **S18-v3-1** | `sprints/sprint-18.md` | This plan. |
| **S18-v3-2** | Electron + React + electron-vite shell + "hello canvas" | Add electron / electron-vite / react / react-dom / @xyflow/react / vite / @vitejs/plugin-react / types. `electron.vite.config.ts`, split tsconfigs (Node for main/preload/logic, DOM+JSX for renderer; existing Node tsc gate stays green via refs). `electron/main.ts` creates a BrowserWindow loading the renderer; `electron/preload.ts` minimal contextBridge. `src/renderer/` renders an empty React Flow canvas with a background grid. `npm run dev` launches the Electron app; `npm run build` compiles main+renderer. Verify: launch + screenshot the empty canvas; confirm React 19 + React Flow 12 + Electron 42 mount together. THIRD-PARTY-LICENSES.md + NOTICE updated (license + NOTICE-file check per CLAUDE.md). New `build` gate. |
| **S18-v3-3** | Catalog → World loader + World → Flow mapping | `catalog-loader.ts` imports the fixture YAML (Vite `import.meta.glob` / `?raw`) and builds the same `World` shape the tests use. `world-to-flow.ts` is a PURE function: World → `{ nodes, edges }` (device instances → nodes; nets → edges between the instances they connect). Unit-tested in `world-to-flow.test.ts` (pure, runs under vitest — no DOM). |
| **S18-v3-4** | Render the anchor circuit (labeled nodes) | `App.tsx` loads the world, maps to flow, renders the 6 anchor-circuit instances as labeled React Flow nodes + the 6 nets as edges, with a simple deterministic layout. Each node shows its device kind + instance id. Verify: build + run + screenshot shows the connected circuit. (Labeled nodes are an honest scaffold — the standard symbols land in S18-v3-5, same sprint.) |
| **S18-v3-5** | Standard schematic symbols | Replace the labeled-box nodes with standard schematic symbols (SVG React components) for the anchor circuit's kinds: battery (long/short lines), resistor (IEC rectangle or IEEE zigzag), LED (triangle + bar + emission arrows), switch (hinged contact), ground (stacked decreasing lines). Wires stay edges. Per SCHEMATIC-SYMBOLS.md — standard conventions, not invented icons. Verify: screenshot shows a recognizable schematic. |
| **S18-v3-6** | Sprint 18 retro + §15 rows | Sub-commit log, lessons, new §15 rows (Electron wrapping; canvas interactivity; solver overlay as the next sprint; symbol library expansion). |

---

## Verification discipline (zero-trust, per Sprint 12-17 pattern)

- **The frontend actually renders — screenshot it.** A canvas that `vite build`s but renders garbage isn't done. Each render sub-commit (S18-v3-4, S18-v3-5) is verified by running the app and capturing a screenshot showing the expected circuit. "Builds" is necessary, not sufficient.
- **The existing gates stay green.** Adding React must not break `npx tsc --noEmit` (split tsconfig: Node logic vs DOM/JSX frontend), `vitest` (logic tests unaffected; the new `world-to-flow` test runs under it), or `biome` (handles .tsx). The `build` gate is additive.
- **The catalog→flow mapping is pure + tested.** `world-to-flow.ts` has no React/DOM dependency — it's a pure World → {nodes, edges} transform, unit-tested. The rendering layer (React components) is thin over it. This keeps the load-bearing logic testable without a DOM harness.
- **Reuse, don't fork, the loader.** The browser catalog loader builds the same `World` shape (`definitions`/`instances`/`behaviors`/`activeVariables`/`nets`) the cross-FK + solver tests use. No second source of truth for "what a world is."
- **License discipline holds.** Every new dep license-checked (all MIT, verified at npm) + NOTICE-file-checked + added to THIRD-PARTY-LICENSES.md, per CLAUDE.md.
- **Standard symbols, not invented icons.** S18-v3-5 honors SCHEMATIC-SYMBOLS.md: the symbols follow IEC 60617 / IEEE 315 conventions. Labeled-box nodes (S18-v3-4) are an explicitly-temporary scaffold superseded within the same sprint.
- **No NUL-byte cruft.** (Sprint 13 lesson.)

---

## Done criteria

- [ ] `npm run dev` launches the Electron app showing the canvas; `npm run build` compiles main + renderer (both succeed)
- [ ] React Flow renders an empty canvas inside the Electron window (S18-v3-2), then the anchor circuit (S18-v3-4)
- [ ] The catalog→World→Flow pipeline loads the real fixtures in the browser
- [ ] `world-to-flow.ts` is pure + unit-tested
- [ ] The 6 anchor-circuit instances + 6 nets render as a connected schematic
- [ ] Standard schematic symbols for the anchor circuit's device kinds (S18-v3-5)
- [ ] Screenshots verify the render at S18-v3-4 + S18-v3-5
- [ ] The existing gates stay green: `npx tsc --noEmit`, `vitest`, `npx biome check .`
- [ ] New `build` gate passes
- [ ] New deps in THIRD-PARTY-LICENSES.md + NOTICE
- [ ] All tests pass (count grows from 236 with the world-to-flow test)
- [ ] Sprint retro written
- [ ] New §15 rows (Electron; interactivity; solver overlay; symbol expansion)

---

## Risks called out

1. **Standing up Electron + React in a Node-only repo is the real work.** The existing `tsconfig.json` targets Node (no DOM, no JSX). The Electron split is three contexts: main (Node), preload (Node-ish), renderer (DOM+JSX). Mitigation: electron-vite handles the three-context build; split tsconfigs (Node for main/preload/logic, DOM+JSX for renderer) keep the existing `tsc --noEmit` gate green via project refs. Verified in S18-v3-2 before going further.
2. **React 19 + React Flow 12 + Electron 42 compatibility.** All recent. Mitigation: the empty-canvas smoke (S18-v3-2) confirms they mount together before building on them. If incompatible, pin React 18.
3. **Loading YAML in the renderer.** The tests read fixtures from disk via `node:fs`; the renderer is a sandboxed Chromium page. Mitigation: Vite's `import.meta.glob` / `?raw` imports the fixture files at build time (they're bundled into the renderer); the `yaml` package (already a dep) parses them. The loader produces the identical `World` shape. (No need for IPC-to-main file reads for the MVP — the fixtures bundle.)
4. **Verifying an Electron render is harder than a browser one.** The renderer is still a web page, so its content (React Flow canvas) can be verified by pointing the dev server at a browser + the preview tooling. The Electron shell wrapping is verified by launching the app (`npm run dev`) on the user's Windows desktop and screenshotting via computer-use. Both paths used: renderer content via browser preview, shell via desktop screenshot.
5. **Scope creep toward interactivity.** A canvas invites "just add drag." Mitigation: the non-goals are explicit — static render only. Interactivity is a whole sprint with its own UX §15 rows.
6. **The "standard symbols not invented icons" commitment.** Labeled boxes (S18-v3-4) risk reading as invented icons. Mitigation: they're an explicit, same-sprint scaffold; S18-v3-5 replaces them with standard schematic symbols. The retro confirms the commitment is honored.

---

## Open questions deferred to later sprints

Carried forward from Sprint 17 close + new from Sprint 18 design:

- (all prior open §15 rows)
- **NEW from Sprint 18 design:** Electron packaging into a distributable installer (electron-builder — the shell runs this sprint, packaging is later); canvas interactivity (drag / place / wire / right-click override — pairs with the auto-created-interface + right-click-override §15 rows); solver overlay on the canvas (node voltages, branch currents, red overloaded LED — the next canvas sprint, consuming solveDC + detectFailures); full schematic symbol library (beyond the anchor circuit's kinds); canvas-only state persistence (`canvas/layout.yaml` for positions/lock/color).

---

## Sprint 18 opens here

Master tip when opened: `8393294` (post-Sprint-17). The 236 tests from Sprint 17 close are the floor; expect a modest test bump (the pure `world-to-flow` mapping test) plus the new `build` gate. The headline deliverable is visual, not a test count: **the educational anchor circuit, rendered on a real canvas, with standard schematic symbols.**

**Why this sprint matters:** it's the pivot from an invisible foundation to a visible tool. Everything the project has built becomes something you can *see*. It deliberately scopes to the minimum that proves the toolchain + the catalog→canvas pipeline, so the high-value follow-ons (the solver overlay that paints the overloaded LED red; interactivity) build on a solid, tested base rather than a rushed one.

Trigger to begin: user approval of this plan.
