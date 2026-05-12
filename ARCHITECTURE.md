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
│   └── *Node.tsx              One file per of the 42 block types
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

Adding a block is a **3-file change** plus one command. Per [ADR-003](ADR-003-block-manifest.md), cross-cutting block metadata lives in a single manifest at the repo root, and two small scripts (Node + Python) generate the seven cross-cutting registries from it. The two per-block files that contain real logic (the React component and the Amaranth Elaboratable) stay hand-written.

### The three files you write

1. **`blocks.yaml` row** — one entry in the repo-root manifest. Type id, label, color, category, ports (handle id → bus type), parameters, and the paths to the two hand-written files. The schema lives in [`blocks.schema.json`](blocks.schema.json) next to it; codegen validates against the schema before writing anything. Copy a row of similar shape (an existing audio block for waveform sources, an existing CPU primitive for `data-u8` shapes, etc.) and edit.

2. **`frontend/src/blocks/<Name>Node.tsx`** — the React Flow node component. Mirror an existing block of similar shape: Oscillator for waveform sources, Mixer for combinational two-input, ADSR for multi-row parameter layout. Use the shared `useValidatedNumber` hook for any number inputs.

3. **`backend/blocks/<name>.py`** — the Amaranth Elaboratable (the chip-side logic). Constructor takes parameters as kwargs; `elaborate(self, platform)` returns the `Module`. Expose `input_ports` / `output_ports` dicts keyed by the same handle id strings used in the manifest row.

### Then run code generation

```
cd frontend
npm run codegen
```

This runs both scripts (Node for the frontend, Python for the backend). It validates `blocks.yaml` against the schema, then rewrites the seven generated sections. If the output is byte-identical to what's already on disk, the command exits 0 and you're done. If anything changed, it prints a unified diff and exits non-zero — that diff *is* your change, and you commit it alongside the three hand-written files.

The phrase "code generation" (or just "codegen") here means: a script reads `blocks.yaml` and writes structured code into seven specific places inside the seven cross-cutting files. The places are delimited by marker comments so you can see at a glance what's generated:

```
// @begin codegen blocks-registry — do not edit; generated from blocks.yaml
... generated content ...
// @end codegen blocks-registry
```

### The seven generated sections (you don't edit these)

| File | What's generated |
|---|---|
| `frontend/src/blocks/index.ts` | `import` lines for each component + `nodeTypes` map + `AppNode` union |
| `frontend/src/blocks/busTypes.ts` | `BLOCK_PORT_TYPES` dict (handle id → bus type per block) |
| `frontend/src/Palette.tsx` | `PALETTE` array + `defaultDataForType()` switch |
| `frontend/src/App.css` | `.block-<type>` border-color rules (plus `min-height` / `min-width` for multi-handle blocks) |
| `frontend/src/ai/prompt.ts` | structural per-block summary in `STATIC_SYSTEM` + tool-call schema enum |
| `backend/blocks/__init__.py` | `import` lines + `BLOCK_REGISTRY` dict + `__all__` list |
| `backend/blocks/_params_gen.py` | `build_params(node_type, data)` body (called from a 3-line stable wrapper in `synth.py`) |

The AI prompt's per-block prose (the paragraph or two that says when a block is useful) stays hand-written above the generated section — the generator only emits the structural summary and the tool-call schema.

### Tests stay hand-written

The manifest doesn't cover behavior, so the test suite is the place that asserts what the block actually does:

- **`backend/tests/test_blocks.py`** — add a property-based assertion for your block. Most existing tests check a basic round-trip (input pattern in, expected output pattern out).
- **`frontend/test/blocks.test.tsx`** — add a render + parameter-editing test case. The harness covers all manifest blocks via the manifest, so this is mostly per-block edge cases (e.g. ROM's textarea).

A separate small test (`frontend/test/manifest.test.ts` + `backend/tests/test_manifest.py`) asserts that every block in `blocks.yaml` maps to a real `.tsx` and `.py` file on disk with the declared exported symbol — catches the "manifest references a file that doesn't exist" failure mode.

### Reference doc

[`BLOCKS.md`](BLOCKS.md) is the user-facing per-block reference (ports, parameters, common-usage notes). It's hand-written. After landing a new block, add a new section under the right category heading. The category heading itself matches the `category` field in your manifest row.

### What CI catches

A single CI job called `codegen-drift` runs both scripts on every PR and fails if the working tree diverges from what the manifest would produce. Two common failure shapes:

- **You edited `blocks.yaml` and forgot `npm run codegen`.** CI fails with a diff showing the generated sections it would have written.
- **You hand-edited inside a `@begin codegen` / `@end codegen` region.** CI fails with the same diff in reverse — your edit gets rewritten away on the next codegen run, so the PR is rejected and you're nudged to put the change in the manifest instead.

A typical drift failure looks like:

```
FAIL: scripts/codegen-frontend.mjs reports drift in frontend/src/blocks/index.ts
--- a/frontend/src/blocks/index.ts
+++ b/frontend/src/blocks/index.ts  (regenerated from blocks.yaml)
@@ -47,6 +47,7 @@
 import { AndNode } from './AndNode';
 import { OrNode } from './OrNode';
 import { XorNode } from './XorNode';
+import { ShifterNode } from './ShifterNode';
```

The fix is always: `cd frontend && npm run codegen && git add -u`.

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
backend/tests/        pytest, 189 tests + 2 skipped, ~85 s
  test_blocks.py             47 per-block property assertions (zero-crossing rate, accumulator round-trip, sign-reinterpretation pass-through, register-file independent-addr round-trip, etc.) — covers all 42 blocks (including the 5 visual blocks, the 2 bus-composition blocks plus Reinterpret, the 7 CPU primitives Adder / Subtractor / Comparator / Mux / Register / RAM / ROM, the Sprint 20 Register File, the Counter.addr-out extension, plus a mixed-logic pipeline smoke test, a CPU-primitives pipeline smoke test that exercises Reinterpret end-to-end, and a Register File multi-port pipeline smoke)
  test_synth_pipeline.py     9 end-to-end tests against examples/*.json (3 exercise the visual path: friendly-error rejection on ▶ Play, .pcf carries VGA pin assignments, and an end-to-end build of the color-bars graph through Yosys + nextpnr-ice40 + icepack to a real iCEBreaker bitstream — that one is skipped when OSS CAD Suite isn't on PATH)
  test_tinytapeout.py        8 TT bundle shape + info.yaml schema tests
  test_manifest.py           126 dynamic cases (42 blocks × 3 invariants) added in Sprint 21: backendPath file exists, backendClass importable, registered in BLOCK_REGISTRY with matching __name__

frontend/test/        vitest, 287 tests, ~9 s
  ipc-contract.test.ts          renderer↔main IPC mock tests (synth/build/AI)
  blocks.test.tsx               block render + parameter editing + range validation (84 tests across all 42 blocks)
  registries-aligned.test.ts    cross-registry consistency lint — PALETTE / BLOCK_PORT_TYPES / nodeTypes / STATIC_SYSTEM all cover the same 42 blocks (catches the kind of drift that hit ByteConstant in Sprint 19; arguably redundant after Sprint 21's manifest landed, kept for now as belt-and-suspenders)
  bus-types.test.ts             bus-type compatibility helper (29 tests covering the Sprint 16 typed-bus system)
  save-load.test.tsx            save/load roundtrip + m5 rejection paths
  examples-consistency.test.ts  examples.ts ↔ examples/*.json drift check (now also covers color-bars.json)
  classify-backend-error.test.ts friendly-error classifier (14 cases)
  manifest.test.ts              126 dynamic cases (42 blocks × 3 invariants) added in Sprint 21: componentPath file exists, exports ${PascalCase}Node, registered in nodeTypes
```

CI runs both suites on every push to master. The cross-platform installer build runs on tag push; verified end-to-end via a v0.0.0-test pre-flight.

## License posture

Permissive only. MIT for ChipBlocks itself; every shipped dependency is MIT/Apache 2.0/BSD/ISC/PSF. Copyleft tools (Yosys, nextpnr, icepack, OpenLane) are *invoked* as separately-installed user binaries, never bundled. Detailed policy + dependency table in [CREDITS.md](CREDITS.md).

## Pointers for future contributors

- **Sprint history**: [SPRINT-1.md](SPRINT-1.md) … [SPRINT-13.md](SPRINT-13.md). Each has a Sprint Log + Retrospective with the "what didn't work" notes that explain why the code is shaped the way it is.
- **Current backlog**: [ROADMAP.md](ROADMAP.md) — Now / Next / Later, plus the a11y workstream + tech-debt workstream.
- **Known issues**: [KNOWN-ISSUES.md](KNOWN-ISSUES.md) — deliberately deferred items with rationale.
- **Last accessibility audit**: [ACCESSIBILITY-AUDIT-2026-05-08.md](ACCESSIBILITY-AUDIT-2026-05-08.md) (Critical + Major tiers shipped, Minor polish tracked in ROADMAP).
