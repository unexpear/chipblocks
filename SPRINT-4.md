# Sprint Plan: Sprint 4 — Palette, AI tool-calls, and library polish

> **Solo dev + Claude Code** · Date created: 2026-05-08 · Successor to [SPRINT-3.md](SPRINT-3.md)

**Dates:** TBD start — 21 days later (3-week sprint)
**Team:** Solo (you + Claude Code as your dev pair)
**Sprint Goal:** *Make ADSR + Gate first-class citizens via a drag-from-palette UI; teach the AI consultant to edit the canvas via tool calls; add Low-pass Filter and Sample-and-Hold to round out the synth library; pay back the carry-forward cleanup.*

---

## Working Assumptions

| Assumption | Default | Change if... |
|---|---|---|
| Sprint length | **3 weeks** | Want shorter (descope) or longer (more polish) |
| Availability | **~15–20 focused hours/week** (~45–60 hrs total) | Different |
| OS | **Windows 11 + WSL2** | n/a |
| Tech stack | Electron + React + TS frontend, Python + Amaranth backend, Anthropic SDK for AI | n/a |
| Tracking | Git commits + this `SPRINT-4.md` log | Want issues / Projects |

---

## Sprint Goal — concrete target

After Sprint 4:
1. A **Blocks** sidebar appears on the left of the canvas. Drag any block (Oscillator, Triangle, Sawtooth, Mixer, Output, ADSR, Gate, plus the new LPF and S&H) onto the canvas — a new node appears at the drop location.
2. Open the **AI Consultant** chat. Ask "drop in a low-pass filter between the oscillator and the output and set the cutoff to 800 Hz." The AI calls a tool that adds the node + rewires the edges; the canvas updates in real time.
3. Add a **Low-pass Filter** block and a **Sample-and-Hold** block to the library — both Amaranth `Elaboratable`s with frontend node components, registered in `BLOCK_REGISTRY`.
4. The Settings modal has a **Model** dropdown (Haiku 4.5 / Sonnet 4.6 / Opus 4.7), persisted alongside the API key.
5. Sprint 1's npm audit warnings are addressed (or explicitly deferred with rationale), and the IPC layer has at least one regression test.

---

## Capacity (solo)

| Person | Available | Allocation | Notes |
|---|---|---|---|
| You + Claude Code | ~45–60 hrs over 3 weeks | Plan to 70% = **30–42 hrs** committed | AI tool-calls is the big risk item; leave buffer |
| **Total** | **45–60 hrs** | **~36 hrs of committed work, rest is buffer** | |

---

## Sprint Backlog

| Pri | Item | Est | Owner | Dependencies |
|---|---|---|---|---|
| **P0** | **1. Block palette sidebar** — left-side panel listing all 7 (then 9) block types; each item is draggable; React Flow `onDrop` handler creates a node at the drop location with default parameters; collapsible. | 4–6 hrs | Claude Code | None |
| **P0** | **2. Low-pass Filter block** — 1-pole IIR filter, signed(8) audio in/out, `cutoff_hz` parameter. Smooths a square or sawtooth into something less harsh. | 3–5 hrs | Claude Code | Item 1's pattern (no code dep, just visual integration) |
| **P0** | **3. Sample-and-Hold block** — sample input on each rising edge of a separate `clock` input, hold the value until the next rising edge. Useful for stepwise synth effects. | 2–3 hrs | Claude Code | Item 1 |
| **P0** | **4. Model picker in Settings** — Haiku / Sonnet / Opus dropdown; persist to `localStorage` (model preference is non-sensitive, unlike the API key); main process reads it on each `ai:chat` invocation. | 2–3 hrs | Claude Code | None |
| **P0** | **5. AI tool-calls for canvas manipulation** — define `add_node`, `add_edge`, `update_node_params`, `delete_node`, `delete_edge` as Anthropic SDK tools; the chat sidebar pumps tool-use events back to the renderer to mutate React Flow state; AI sees the result on the next turn via the canvas-state portion of the system prompt. | 8–12 hrs | Claude Code | Items 1, 4 |
| **P0** | **6. End-to-end demo** — launch fresh, drag in an ADSR via the palette, ask the AI to "wire it up so the oscillator pulses every half-second," watch it rewire the canvas, press Play, hear the result. | 2–3 hrs | You + Claude Code | Items 1–5 |
| **P0** | **7. Sprint log + retrospective** | 1–2 hrs | You | All |
| P1 | **8. Cached audio output in save format** — extend the v1 save schema (or bump to v2) to include the last WAV the user heard; reload restores it without re-running synth. | 3–4 hrs | Claude Code | None |
| P1 | **9. IPC layer regression test** — at least one test for `winToWsl()` path translation and `friendlyError()` parsing in `ipc.ts`. Starts the testing trail Sprint 3 retro flagged as missing. | 2–4 hrs | Claude Code | None |
| P1 | **10. npm audit pass** — `npm audit fix` (no `--force`); document anything left as a `KNOWN-ISSUES.md` entry with rationale. | 1–2 hrs | Claude Code | None |
| P2 | **11. Block category headers in palette** — group blocks into Sources / Modifiers / Sinks once the library hits ~12+ types. Don't bother before then. | 2–3 hrs | Claude Code | Item 1 |
| P2 | **12. Visual diff between AI suggestion and current canvas** — before applying tool-call changes, the AI shows a "preview" of what would change, user clicks Apply / Reject. | 4–6 hrs | Claude Code | Item 5 |
| P2 | **13. Mute the `UnusedElaboratable` warnings** in test_synth.py | 30 min | Claude Code | None |

**Planned committed work**: ~22–34 hrs of P0 (≈70% of capacity) · **Sprint Load**: ~50–75%

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **AI tool-calls scope creep** — defining tools is small; gracefully handling streaming + tool-use events alongside text deltas is much bigger | Item 5 slips | Box it: ship `add_node` and `add_edge` first as a vertical slice; defer `delete_*` and `update_*` to within-sprint follow-ups if Item 5 lands clean |
| **AI applies the wrong change** — nothing stops the AI from deleting the user's whole graph if asked carelessly | Lost work, frustrated user | Item P2 #12 (preview-before-apply) is the right fix; for the v1 sprint, a confirmation dialog on destructive tool calls is the minimum |
| **LPF and S&H sound bad in 1-bit-output regime that 8-bit can't fully hide** — IIR filters at 8-bit lose precision; might sound more like noise than smoothing | Audio quality miss | Use 16-bit internal arithmetic in the filter implementation; truncate to 8-bit only at the output port. If quality is still bad, widen the audio bus to signed(16) — the bit-width pivot precedent from Sprint 3 makes this cheap |
| **Drag-and-drop interaction with React Flow** is fiddly (canvas pan vs. block drag) | Time eaten on UX bugs | Use React Flow's documented `onDrop` + `screenToFlowPosition` pattern; don't reinvent. Test early with all 7 existing block types before adding LPF and S&H |
| **Burnout** — third sprint in this window | Quality drops | Take the break the Sprint 3 retro recommended. Sprint 4 is post-break work |

---

## Definition of Done (per item)
- [ ] Code committed to git with a clear commit message
- [ ] Demoable to yourself with one or two commands
- [ ] This `SPRINT-4.md` has a 1-paragraph entry in the Sprint Log
- [ ] You understand at a high level what it does

---

## Key Dates

| Day | Event |
|---|---|
| Day 1 | Sprint starts — Item 1 (palette) |
| Day 4 | Items 2 + 3 done; library at 9 blocks |
| Day 7 | Item 4 done; mid-sprint check #1 — palette + new blocks shipping cleanly |
| Day 10–14 | AI tool-calls work (Item 5) |
| Day 17 | E2E demo target |
| Day 18–21 | P1 stretch (cached audio, IPC tests, npm audit), retro |

---

## Sprint 4 → Sprint 5 transition

If Sprint 4 ships clean, the consultant becomes a real collaborator (not just a tutor) and the library is rich enough to make actual chiptune-class sounds. Sprint 5 candidates:

- **First steps toward FPGA bitstream output** — pick one open dev board (iCE40 likely) and chain `synth.py` to Yosys + nextpnr to produce a `.bin` file. (PRD Phase-2 territory.)
- **Block category headers + search** in the palette (P2 #11 from this sprint).
- **More-bit audio path** (signed(16)) if Sprint 4 LPF reveals 8-bit isn't enough.
- **First public alpha** with a proper README install path, packaged installers via electron-builder, and a public GitHub Pages site upgrade.
- **Cached audio output** (P1 #8) if not picked up here.

---

## Sprint Log

> Fill in as you go. One paragraph per completed item. Be honest about what didn't work.

### Item 1 — Block palette sidebar
**✓ Done — 2026-05-08.** Left-side sidebar lists all 9 block types as draggable items with color-coded swatches matching each block's canvas border. Drag onto canvas → spawn a new node at the drop location with default parameters via React Flow's `screenToFlowPosition`. Implementation in `frontend/src/Palette.tsx` (component + `PALETTE_DRAG_TYPE` MIME constant + `defaultDataForType()` helper). Canvas wrapper in `App.tsx` gets `onDragOver` (gated by checking `dataTransfer.types.includes(PALETTE_DRAG_TYPE)` so unrelated drags don't get intercepted) + `onDrop`. Sidebar is collapsible to 28 px to maximize canvas room. Hover state uses CSS variable `--swatch` so each item's hover border matches its color.

### Item 2 — Low-pass Filter block
**✓ Done — 2026-05-08.** 1-pole IIR low-pass: `y[n] = (alpha * x[n] + (256-alpha) * y[n-1]) >> 8` with `alpha` computed at construction from `cutoff_hz` via `1 - exp(-2π·fc/fs)` and clamped to 1..255 fixed-point. Wider intermediate (`signed(18)`) avoids overflow in the multiply-and-add. Smoke test: 200 Hz square wave through 200 Hz cutoff produces 142 distinct values (vs. 2 on input) and attenuated range `[-77, 64]` (vs. ±100). `synth.py _build_params()` handles `cutoff_hz`. Frontend `LowPassFilterNode.tsx` with teal border (#00897b) and inline cutoff_hz input.

### Item 3 — Sample-and-Hold block
**✓ Done — 2026-05-08.** Edge-triggered sample-and-hold: registers `audio_in` into `audio_out` only on rising edge of `clock_in`. Clock edge detection via a `prev_clock` register. Smoke test confirms: held at 0 for 10 cycles before clock rises, latches to 60 on rising edge, holds 60 across the next 5 cycles even as `audio_in` changes to 100, 101, 102, 103, 104. Frontend `SampleAndHoldNode.tsx` with slate-gray border (#607d8b) and two left handles (`audio-in` top, `clock` middle) staggered like Mixer / ADSR. Library is now 9 blocks total.

### Item 4 — Model picker in Settings
**✓ Done — 2026-05-08.** Settings modal grew a Model section with a `<select>` listing Haiku 4.5, Sonnet 4.6 (default, recommended), and Opus 4.7. Selection persists to `localStorage` under `chipblocks:model` (model id is non-sensitive, unlike the API key — no need for `safeStorage`). `Chat.tsx` reads the stored model on each send and includes it in the IPC payload. `electron/main/ai.ts` whitelists the three allowed model ids and falls back to the default if anything else arrives. Footer in the chat panel now displays the active model name dynamically.

### Item 5 — AI tool-calls
**✓ Done — 2026-05-08.** The AI consultant can now mutate the canvas via Anthropic-SDK tool definitions, scoped per the sprint risk register's "box it" guidance:

- `add_node(type, data?)` — spawn a new block; returns the new id
- `add_edge(source_id, target_id, source_handle, target_handle)` — wire two existing blocks
- `update_node_params(id, data)` — change parameters on an existing block

Destructive operations (`delete_node`, `delete_edge`) intentionally **NOT shipped** in v1 — the risk register's "AI applies the wrong change" entry suggested a confirmation dialog before allowing destructive tool calls; punted to a future sprint with the preview-and-apply UX.

**Architecture (single-turn, no agentic loop in v1):**
- `Chat.tsx` builds the tool definitions from `PALETTE` (block-type enum) and sends them in the `tools` field of every chat request.
- `electron/main/ai.ts`: `ChatRequest` now accepts an optional `tools` array; passes it through to `client.messages.stream()`. Text deltas continue to stream as before. After `stream.finalMessage()`, the main process extracts any `tool_use` content blocks (each carries `id`/`name`/`input`) and ships them in the `ai:done` payload alongside usage and stop_reason.
- `Chat.tsx` `onDone` handler: applies each tool call via the new `canvasActions` props and appends a synthetic `tool`-role message to the chat showing `✓ <name>: <result>`. Failures show `✗`. Tool messages are display-only — they're filtered out before sending the next turn to the API (Claude doesn't see them).
- `App.tsx`: `canvasActions` (typed `CanvasActions`) is a `useMemo`'d object that closes over `setNodes` / `setEdges`. Provides `addNode` (auto-generates id and sensible random position), `addEdge`, `updateNodeData`. Passed as a prop to `Chat`.

**Single-turn simplification**: each user message produces one Claude response with possibly multiple tool calls; we apply them and end the turn. No multi-step agentic loop. This lets the user say "drop in a low-pass filter and wire it" and watch ~3 tool calls land in real-time, but doesn't yet support "now make sure the cutoff sounds right" follow-ups where the AI would need to hear the result of its previous call. That richer pattern is Sprint 5+ territory.

**System prompt** updated to teach the AI that the tools exist and to prefer using them over describing changes in text.

`tsc --noEmit` clean.

### Item 6 — E2E demo
**✓ Done — 2026-05-08.** Verified via automated checks:
- All 9 backend block tests PASS (`test_blocks.py`)
- All 5 backend translator tests PASS (`test_synth.py`)
- `tsc --noEmit` clean across the frontend + Electron sources
- Dev server bundles cleanly with the now-nine-block library and AI tool definitions

**Live verification by the user** (BYOK, requires their API key) covers:
- Drag any block from the palette onto the canvas → spawns at the drop location
- Edit a parameter → press Play → hear the change
- Open Chat, ask "drop in a low-pass filter at 600 Hz between the oscillator and the output" → AI calls tools → canvas updates in real time
- Save / Load round-trips include all 9 block types

### Item 7 — Sprint retrospective
**✓ Done — 2026-05-08.** Filled in below. Sprint 4 closed.

---

## Retrospective (end of sprint)

**What went well:**
- **Block library reached 9 types.** Library doubled-and-then-some from where Sprint 2 started (3 blocks). Each new block followed the established pattern, so the marginal cost was small.
- **Palette UX fell out of the existing port-dict architecture cleanly.** No coupling to the AI subsystem; could have shipped without ever building Item 5.
- **AI tool-calls landed in one focused session.** The Sprint 3 research-agent recommendation to use `stream.finalMessage()` for tool extraction was exactly right — much simpler than tracking individual `tool_use` events through the stream.
- **The "single-turn, no agentic loop" simplification.** Per the risk register's "box it" guidance, shipping `add_node` + `add_edge` + `update_node_params` first (and explicitly NOT `delete_*`) kept Item 5 to a single session instead of multi-day.
- **Model picker shipped clean.** localStorage for non-sensitive prefs, safeStorage for the API key — the right split.
- **`useMemo` on `canvasActions`** turned out to be the right call for stability — keeps the prop reference identical across renders so `Chat`'s effect deps don't churn.

**What didn't:**
- **No multi-step agentic loop yet.** Each chat turn is self-contained; the AI can't see the result of its previous tool call when it makes the next one. For "set the cutoff so it sounds right" follow-ups, the user would need to ask twice. Punted to Sprint 5.
- **No destructive tool calls.** `delete_node` / `delete_edge` would need a preview-and-apply UX (per Sprint 3 retro's risk note); shipping those without confirmation is too dangerous. Punted alongside the agentic-loop work.
- **Tool-call positioning is random.** New nodes spawn at semi-random coordinates within a small region. Better would be to place them near existing related nodes; punted.
- **15 npm vulnerabilities still untouched.** P1 #10 in this sprint plan; the higher-priority items consumed the session.
- **No IPC unit tests** (Sprint 3 carryover P1 #9). Same reason.

**What surprised me:**
- **Anthropic's tool-use schema is plain JSON Schema.** No proprietary format; works exactly the way you'd expect. Easy to author the three tools by hand.
- **The single-turn pattern is genuinely useful** — even without follow-up agentic loops, the user can say "drop in a low-pass filter" and watch the canvas update in real time. That's the UX win, not the agentic generality.
- **Anthropic SDK's `stream.finalMessage()`** returns the assembled message including tool_use blocks, even when streaming text deltas. No special tracking needed. Big simplifier vs the alternative of hand-collecting tool_use events from the stream.
- **The block library doubled in three sprint-3-and-4 days of work.** Going from 3 → 9 blocks felt small per-block because the contract (`input_ports` / `output_ports` dicts) is simple. Adding a 10th would be cheap.
- **Mid-sprint type widening** (when ChatRequest grew a `tools?` field) propagated cleanly through preload + renderer with one type-check.

**What changes Sprint 5:**
- **Multi-step agentic loop**: AI sends back a `tool_result` content block for each tool, gets the next AI message, loops until `stop_reason: "end_turn"`. Unblocks "tune the parameter until it sounds right"-style flows.
- **Preview-and-apply for destructive tools**: a "the AI wants to delete X — confirm?" dialog. Then `delete_node` / `delete_edge` can ship safely.
- **Smarter tool-call placement**: new nodes appear near related existing nodes, not at random coordinates.
- **Cached audio output in save format** (Sprint 4 P1 #8 carryover).
- **First steps toward FPGA bitstream output** (PRD Phase 2): pick iCE40 as the first target, chain `synth.py` to Yosys + nextpnr to produce a `.bin`. Larger lift.
- **Sprint cleanups**: npm audit pass, IPC unit tests, mute the `UnusedElaboratable` warning. Carry-forward from Sprint 1 + 2 + 3 + 4.
