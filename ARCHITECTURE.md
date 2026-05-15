# ChipBlocks architecture

> **Last updated:** 2026-05-09 · Living doc; refresh when the data flow or process model changes materially. Strategic vision lives in [PRD.md](PRD.md); operational sprint plan lives in [ROADMAP.md](ROADMAP.md). This file describes how the *code* is shaped.

A solo-developer non-technical user is the contributor model. Optimize for "obvious where to make a change" over "extracted-for-reuse-but-spread-across-eight-files."

## High-level process model

```
┌────────────────────────────────────────────────────────────────────┐
│ Windows host                                                       │
│                                                                    │
│  ┌─────────────────────────────┐                                   │
│  │ Electron main process       │   Spawns                          │
│  │  (Node.js, dist-electron/)  │ ─────────► wsl.exe                │
│  │  - BrowserWindow lifecycle  │                                   │
│  │  - IPC handlers (synth /    │                                   │
│  │    build / ai)              │                                   │
│  │  - safeStorage (API key)    │                                   │
│  └─────────────────────────────┘                                   │
│              │                                                     │
│              │ contextBridge.exposeInMainWorld                     │
│              ▼                                                     │
│  ┌─────────────────────────────┐                                   │
│  │ Renderer process            │                                   │
│  │  (React 18, Vite bundle,    │                                   │
│  │   sandboxed, isolated)      │                                   │
│  │  - React Flow canvas        │                                   │
│  │  - Block components         │                                   │
│  │  - Chat sidebar (BYOK)      │                                   │
│  └─────────────────────────────┘                                   │
│                                                                    │
└─────────────────────────────────┼──────────────────────────────────┘
                                  │
                          wsl.exe -- bash backend/scripts/wsl-build-wrapper.sh ...
                                  │
┌─────────────────────────────────┼──────────────────────────────────┐
│ WSL2 Ubuntu                     ▼                                  │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ Backend (Python 3.12, ~/.local/lib/...)                       │  │
│  │                                                              │  │
│  │  backend/synth.py      Graph -> Amaranth -> Simulator -> WAV │  │
│  │  backend/build.py      Graph -> Amaranth -> Verilog          │  │
│  │   ├── --target verilog            (stops here)               │  │
│  │   ├── --target icestick           ─► Yosys ─► nextpnr ─►     │  │
│  │   │  / tinyfpga-bx                  icepack ─► .bin + zip    │  │
│  │   │  / icebreaker                                              │  │
│  │   └── --target tt                                             │  │
│  │       └─► backend/tinytapeout.py  (TT-shaped wrapper, info.  │  │
│  │           yaml, cocotb tb, LICENSE, SUBMIT.md → zip)         │  │
│  │                                                              │  │
│  │  Toolchain (separately installed, not bundled):              │  │
│  │   - Amaranth 0.5.8 + amaranth-yosys (PyPI)                   │  │
│  │   - YosysHQ OSS CAD Suite (~/oss-cad-suite/, only for FPGA)  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

The frontend never executes Python. The backend never sees a renderer event. Every interaction crosses one explicit IPC boundary (Electron main) and one process boundary (WSL2). Both are typed:

- The IPC contract lives at [`frontend/src/types/ipc.ts`](frontend/src/types/ipc.ts) — single source of truth for `window.chipblocks` + `window.ai`.
- The backend's CLI is its contract: argparse with explicit `--in`, `--out-dir`, `--target` choices.

## IPC surfaces

| Channel | Direction | Purpose |
|---|---|---|
| `synth:run` | renderer → main | Render the graph to a WAV via Amaranth's simulator. ~3 s for a few seconds of audio. |
| `synth:cancel` | renderer → main | SIGKILL the in-flight synth. |
| `build:run` | renderer → main | Build a target (`icestick` / `tinyfpga-bx` / `icebreaker` / `tt`). Spawns the WSL build wrapper. Returns the zip bytes. |
| `build:cancel` | renderer → main | SIGKILL the in-flight build. |
| `ai:save-key` / `:has-key` / `:clear-key` | renderer → main | API key lifecycle. Plaintext key never leaves main. Stored via `safeStorage` (DPAPI / Keychain / libsecret). |
| `ai:chat` | renderer → main | Stream a chat completion to Anthropic. Renderer gets `ai:chunk` / `ai:done` / `ai:error` events back. |
| `ai:cancel` | renderer → main | Abort an in-flight chat by id. |

The exposed bridges (`window.chipblocks`, `window.ai`) are deliberately narrow. We do **not** expose a generic `window.ipcRenderer` (the boilerplate did; we removed it in the v0.1.0-alpha security pass — broad bridges are an XSS-to-RCE chain).

## Renderer architecture

```
frontend/src/
├── App.tsx                    Top-level: toolbar + canvas + modals
├── main.tsx                   Vite entry; mounts <App>
├── App.css                    All styling (single file by design)
├── ErrorBoundary.tsx          Per-surface render-error fallback
├── types/ipc.ts               Single source of truth for IPC types
├── ai/prompt.ts               STATIC_SYSTEM + buildSystemBlocks +
│                              buildTools (the AI's brain)
├── blocks/
│   ├── index.ts               nodeTypes + AppNode union
│   ├── useValidatedNumber.ts  Shared number-input validation hook
│   └── *Node.tsx              One file per of the 48 block types
├── Palette.tsx                Left-side block palette + drag-and-drop
├── Chat.tsx                   AI consultant sidebar + agentic loop
├── SettingsModal.tsx          API key + model picker
├── AboutModal.tsx             Version / credits / keyboard shortcuts
└── examples.ts                Bundled example graphs (canonical at
                               examples/*.json; this is a TS mirror
                               for build-time bundling)
```

App.tsx is intentionally not split into a component tree. The state (nodes, edges, modals, popovers, build status) is shared across the toolbar, canvas, and modals; promoting it to React Flow's store + a couple of `useState` hooks is fine for a single-window app.

The Chat sidebar is the only large self-contained component. It owns the agentic loop (multi-iteration tool-call pump up to MAX_ITERATIONS) and the preview-and-apply confirmation modal for destructive AI tool calls.

## Adding a new block

Adding a block is a **3-file change** plus one command. Per [ADR-003](ADR-003-block-manifest.md), cross-cutting block metadata lives in `blocks.yaml` at repo root; two small codegen scripts (Node + Python) regenerate the seven cross-cutting registries from it. The two per-block files that contain real logic (the React component and the Amaranth Elaboratable) stay hand-written.

The 30-second version:

1. Add one row to [`blocks.yaml`](blocks.yaml).
2. Write `frontend/src/blocks/<Name>Node.tsx`.
3. Write `backend/blocks/<name>.py`.
4. `cd frontend && npm run codegen`.
5. Commit the manifest row, your two hand-written files, and the regenerated cross-cutting files together.

The deep version — including the 7 generated section names, edge cases for `cssMinHeight` / port naming / `backendNeedsSampleRate` / `intArray` parameters / the `tags` field, and the typical drift-failure shapes — lives in [BLOCKS-COOKBOOK.md](BLOCKS-COOKBOOK.md). That's the single canonical reference; this file just points at it.

Tests stay hand-written: `backend/tests/test_blocks.py` for a property-based behavior assertion, `frontend/test/blocks.test.tsx` for a render + parameter test. The manifest-integrity test files pick up your new row's 6 structural invariants automatically.

After landing, add a per-block section to [BLOCKS.md](BLOCKS.md) under the category heading that matches your manifest row's `category` field.

## Adding a new build target

The FPGA path is profile-driven. `backend/build.py` defines `@dataclass(frozen=True) FPGABoard` with `chip_family / package / clock_hz / clock_pin / audio_pin / pcf_template / flash_md_template`. To add another FPGA board:

1. Define a new `FPGABoard(...)` instance in `build.py`.
2. Register it in the `ALL_BOARDS` map and the `--target` argparse `choices`.
3. Add the new id to the `BuildTarget` union in `frontend/src/types/ipc.ts` (and the mirrored union in `frontend/electron/main/ipc.ts` + `frontend/electron/preload/index.ts`).
4. Add a `BuildTargetOption` entry in `frontend/src/App.tsx`'s `BUILD_TARGETS` array.
5. (Optional) update `frontend/electron-builder.json` if the new board needs a runtime resource we don't already ship.

The IPC handler doesn't need to know about new targets — it parses the produced bundle filename out of `build.py`'s `[bundle] <basename>` stdout marker.

The Tiny Tapeout path is fundamentally different (sources-only output, OpenLane runs on TT's side after submission) and lives in its own module: `backend/tinytapeout.py`. Adding a non-iCE40 ASIC path (eFabless MPW, IHP) would mirror tinytapeout.py's shape, not the FPGABoard shape.

### Visual graphs (VGA on iCEBreaker)

Graphs containing a `vgaoutput` block take a different code path inside `BoardTop`: the `EnableInserter`-driven sample-rate divider is skipped (VGA needs the pixel clock, not 44.1 kHz) and the 5 VGA signals from the user's `vgaoutput` block are routed straight to top-level Verilog ports. `build.py`'s `_graph_has_vga_output(graph)` helper drives both the wrapper-shape decision and the `.pcf` extension. Per-board VGA pin maps live as optional fields on the `FPGABoard` dataclass (`vga_pins`, `vga_pcf_template`, `vga_flash_md_section`); only the iCEBreaker has them populated in v0.1, since it's the only board with a documented standard PMOD VGA convention. v0.1 ships the 12 MHz / 320×240 mode (no PLL); the 25 MHz / 640×480 path with `SB_PLL40_CORE` is roadmap.

## AI consultant architecture

The renderer drives the agentic loop. Each user message:

1. Renderer assembles the chat request: system blocks (static prompt + per-turn canvas state), conversation history, tool definitions. The static prompt is `cache_control: ephemeral` — Anthropic's prompt cache absorbs ~90% of the input-token cost on subsequent turns.
2. Main process opens a streaming Anthropic chat call. Streams text chunks and emits `ai:chunk` events. On stop, emits `ai:done` with the final usage + any `tool_use` blocks the model produced.
3. Renderer applies tool calls via `canvasActions` (add_node / add_edge / update_node_params / delete_node / delete_edge). Destructive tools route through a confirm-preview modal; the user clicks Apply or Reject. Tool inputs are validated against the JSON schema (m4 from the security review).
4. If any tools were called, the renderer synthesizes a follow-up user message containing `tool_result` content blocks and goes again. Bounded by `MAX_ITERATIONS = 5` to prevent runaway loops.

Eval script at `scripts/eval-ai.ts` runs 7 representative queries against the live API and grades against expected substrings. Useful as a smoke test after prompt edits.

## Testing

```
backend/tests/        pytest, 217 tests + 2 skipped, ~110 s (as of S24-11)
  test_blocks.py             ~60 per-block property assertions (zero-crossing rate, accumulator round-trip, sign-reinterpretation pass-through, register-file independent-addr round-trip, shift left/right against Python's `<<`/`>>` with 9 spot cases, HardSync phase-reset-on-rising-zero-crossing, LFO sub-Hz rate_millihz, etc.) — covers all 48 blocks (5 visual + 3 bus-composition + 7 CPU primitives + Sprint 20 Register File + Sprint 22 Shifter + Sprint 24 audio-modulation family VCO/LFO/AudioSum/VCF/HardSync + Counter.addr-out, plus three pipeline smoke tests)
  test_synth_pipeline.py     9 end-to-end tests against examples/*.json (3 exercise the visual path: friendly-error rejection on ▶ Play, .pcf carries VGA pin assignments, and an end-to-end build of the color-bars graph through Yosys + nextpnr-ice40 + icepack to a real iCEBreaker bitstream — that one is skipped when OSS CAD Suite isn't on PATH)
  test_tinytapeout.py        8 TT bundle shape + info.yaml schema tests
  test_manifest.py           144 dynamic cases (48 blocks × 3 invariants) added in Sprint 21 + auto-extended: backendPath file exists, backendClass importable, registered in BLOCK_REGISTRY with matching __name__

frontend/test/        vitest, 321 tests, ~11 s (as of S24-11)
  ipc-contract.test.ts          renderer↔main IPC mock tests (synth/build/AI)
  blocks.test.tsx               block render + parameter editing + range validation (~96 tests across all 48 blocks)
  bus-types.test.ts             bus-type compatibility helper (29 tests covering the Sprint 16 typed-bus system)
  save-load.test.tsx            save/load roundtrip + m5 rejection paths
  examples-consistency.test.ts  examples.ts ↔ examples/*.json drift check (22 bundled graphs)
  classify-backend-error.test.ts friendly-error classifier (14 cases)
  ld-a11y.test.tsx              learning-disability accessibility checks
  manifest.test.ts              144 dynamic cases (48 blocks × 3 invariants) added in Sprint 21 + auto-extended: componentPath file exists, exports ${PascalCase}Node, registered in nodeTypes
```

**`npx tsc --noEmit` is a separate gate from `npm test`** and is REQUIRED before commit. vitest doesn't run the TypeScript compiler; CI runs both as distinct jobs. Caught in the S24-10 sub-Hz LFO commit (06474e6) which passed vitest locally but failed CI's `TypeScript check` step on a type-vs-examples mismatch. The hotfix at 8338164 + this note close the gap.

CI runs both suites on every push to master. The cross-platform installer build runs on tag push; verified end-to-end via a v0.0.0-test pre-flight.

## License posture

Permissive only. MIT for ChipBlocks itself; every shipped dependency is MIT/Apache 2.0/BSD/ISC/PSF. Copyleft tools (Yosys, nextpnr, icepack, OpenLane) are *invoked* as separately-installed user binaries, never bundled. Detailed policy + dependency table in [CREDITS.md](CREDITS.md).

## Pointers for future contributors

- **Sprint history**: [SPRINT-1.md](SPRINT-1.md) … [SPRINT-24.md](SPRINT-24.md) (note: no SPRINT-15.md — that slot renumbered into SPRINT-16). Each has a Sprint Log + Retrospective with the "what didn't work" notes that explain why the code is shaped the way it is.
- **Current backlog**: [ROADMAP.md](ROADMAP.md) — Now / Next / Later, plus the a11y workstream + tech-debt workstream.
- **Known issues**: [KNOWN-ISSUES.md](KNOWN-ISSUES.md) — deliberately deferred items with rationale.
- **Last accessibility audit**: [ACCESSIBILITY-AUDIT-2026-05-08.md](ACCESSIBILITY-AUDIT-2026-05-08.md) (Critical + Major tiers shipped, Minor polish tracked in ROADMAP).
