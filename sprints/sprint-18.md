# v3 Sprint 18 — Canvas MVP (the frontend lands)

> **Status:** Sprint plan, opened 2026-06-06 against master tip `8393294`.
> **Predecessor:** Sprint 17 closed terminal-name validation. 236 tests, 21 spec sections, 5 source modules — a deep logic/data foundation (schemas + cross-FK validator + DC solver + nonlinear solver + failure detector) with **no frontend**. Sprint 18 is the big pivot: the project gets an actual canvas.
> **Scope:** Stand up the frontend toolchain (Vite + React + TypeScript + React Flow), load the existing catalog fixtures into the browser, and **render the educational anchor circuit** as a schematic — first as labeled nodes, then with standard schematic symbols (per SCHEMATIC-SYMBOLS.md's commitment). Static render only: no interactivity, no solver overlay, no lenses (those are later canvas sprints).

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

- **No Electron yet.** CLAUDE.md's eventual target is Electron + React, but the MVP is a browser app (Vite + React). It's simpler to stand up, trivial to run + screenshot for verification, and the canvas logic is identical either way. Electron wrapping is a later, mechanical sprint. **New §15 row.**
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
| `react` | 19.2.x | MIT | UI framework |
| `react-dom` | 19.2.x | MIT | DOM renderer |
| `@xyflow/react` (React Flow) | 12.11.x | MIT | the canvas engine |
| `vite` | 8.0.x | MIT | frontend dev server + bundler (already a transitive dep via Vitest; now a direct dev dep) |
| `@vitejs/plugin-react` | latest | MIT | React fast-refresh + JSX transform for Vite |
| `@types/react`, `@types/react-dom` | latest | MIT | types |

React Flow 12 supports React 18+; React 19 compatibility verified during S18-v3-2. No new license *categories* — all MIT, on the permissive whitelist. NOTICE/THIRD-PARTY updates handled in S18-v3-2.

---

## Deliverables

```
package.json                                react / react-dom / @xyflow/react / vite /
                                            @vitejs/plugin-react / @types/react(-dom);
                                            scripts: dev, build, preview
index.html                                  NEW — Vite entry
vite.config.ts                              NEW — Vite + React plugin
tsconfig.app.json (+ tsconfig refs)         NEW — DOM + JSX config for the frontend
                                            (the existing Node tsconfig stays for src/ logic)

src/canvas/
├── main.tsx                                NEW — React entry, mounts the app
├── App.tsx                                 NEW — the canvas page
├── catalog-loader.ts                       NEW — load fixture YAML → World (browser)
├── world-to-flow.ts                        NEW — World → React Flow nodes + edges
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
| **S18-v3-2** | Frontend toolchain + "hello canvas" | Add react / react-dom / @xyflow/react / vite / @vitejs/plugin-react / types. `index.html`, `vite.config.ts`, `tsconfig.app.json` (+ project refs so the existing Node tsc gate stays green). `src/canvas/main.tsx` + `App.tsx` render an empty React Flow canvas with a background grid. `npm run build` succeeds; verify by building + screenshotting. THIRD-PARTY-LICENSES.md + NOTICE updated for the new deps (license + NOTICE-file check per CLAUDE.md). New `build` gate. |
| **S18-v3-3** | Catalog → World loader (browser) + World → Flow mapping | `catalog-loader.ts` imports the fixture YAML (Vite `?raw` / glob) and builds the same `World` shape the tests use. `world-to-flow.ts` is a PURE function: World → `{ nodes, edges }` (device instances → nodes; nets → edges between the instances they connect). Unit-tested in `world-to-flow.test.ts` (pure, runs under vitest — no DOM). |
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

- [ ] `npm run dev` serves the canvas; `npm run build` produces a bundle (both succeed)
- [ ] React Flow renders an empty canvas (S18-v3-2), then the anchor circuit (S18-v3-4)
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

1. **Standing up a frontend in a Node-only repo is the real work.** The existing `tsconfig.json` targets Node (no DOM, no JSX). Adding React needs a DOM+JSX config without breaking the existing `tsc --noEmit` gate over `src/` logic. Mitigation: project references — a `tsconfig.app.json` (DOM+JSX, covers `src/canvas/`) alongside the existing Node config; the root `tsc -b` checks both. Verified in S18-v3-2 before going further.
2. **React 19 + React Flow 12 compatibility.** React Flow 12 supports React 18+; React 19 is recent. Mitigation: the empty-canvas smoke (S18-v3-2) confirms they mount together before building on them. If incompatible, pin React 18.
3. **Loading YAML in the browser.** The tests read fixtures from disk via `node:fs`; the browser can't. Mitigation: Vite's `import.meta.glob` / `?raw` imports the fixture files at build time; the `yaml` package (already a dep) parses them. The loader is browser-specific but produces the identical `World` shape.
4. **Verification needs a running browser.** Confirming the render requires serving the app + screenshotting. Mitigation: run `vite dev`/`preview` in the background + use the preview/browser tooling to screenshot. If screenshotting isn't available, fall back to a DOM-snapshot test (render to a string + assert structure) — but a real screenshot is the goal.
5. **Scope creep toward interactivity.** A canvas invites "just add drag." Mitigation: the non-goals are explicit — static render only. Interactivity is a whole sprint with its own UX §15 rows.
6. **The "standard symbols not invented icons" commitment.** Labeled boxes (S18-v3-4) risk reading as invented icons. Mitigation: they're an explicit, same-sprint scaffold; S18-v3-5 replaces them with standard schematic symbols. The retro confirms the commitment is honored.

---

## Open questions deferred to later sprints

Carried forward from Sprint 17 close + new from Sprint 18 design:

- (all prior open §15 rows)
- **NEW from Sprint 18 design:** Electron wrapping (browser app → desktop app); canvas interactivity (drag / place / wire / right-click override — pairs with the auto-created-interface + right-click-override §15 rows); solver overlay on the canvas (node voltages, branch currents, red overloaded LED — the next canvas sprint, consuming solveDC + detectFailures); full schematic symbol library (beyond the anchor circuit's kinds); canvas-only state persistence (`canvas/layout.yaml` for positions/lock/color).

---

## Sprint 18 opens here

Master tip when opened: `8393294` (post-Sprint-17). The 236 tests from Sprint 17 close are the floor; expect a modest test bump (the pure `world-to-flow` mapping test) plus the new `build` gate. The headline deliverable is visual, not a test count: **the educational anchor circuit, rendered on a real canvas, with standard schematic symbols.**

**Why this sprint matters:** it's the pivot from an invisible foundation to a visible tool. Everything the project has built becomes something you can *see*. It deliberately scopes to the minimum that proves the toolchain + the catalog→canvas pipeline, so the high-value follow-ons (the solver overlay that paints the overloaded LED red; interactivity) build on a solid, tested base rather than a rushed one.

Trigger to begin: user approval of this plan.
