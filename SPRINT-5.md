# Sprint Plan: Sprint 5 — Agentic AI + safer tools + cleanup

> **Solo dev + Claude Code** · Date created: 2026-05-08 · Successor to [SPRINT-4.md](SPRINT-4.md)

**Dates:** TBD start — 21 days later (3-week sprint)
**Team:** Solo (you + Claude Code as your dev pair)
**Sprint Goal:** *Make the AI consultant a real collaborator — multi-step agentic loop so it can see the result of each tool call and continue. Unlock destructive tools (delete_node, delete_edge) safely behind a preview-and-apply UI. Pay back the cleanup carry-forward (npm audit, UnusedElaboratable warnings).*

FPGA bitstream output (PRD Phase 2) gets its own dedicated sprint after this one — too big to share runway with the AI work.

---

## Working Assumptions

| Assumption | Default | Change if... |
|---|---|---|
| Sprint length | **3 weeks** | Want shorter / longer |
| Availability | **~15–20 focused hours/week** | Different |
| Stack | unchanged from S4 | n/a |
| Tracking | Git commits + this `SPRINT-5.md` log | Want issues / Projects |

---

## Sprint Goal — concrete target

After Sprint 5:
1. Ask the AI consultant: *"add a low-pass filter at 600 Hz between the oscillator and the output, and tell me what you ended up with."* It calls `add_node`, `add_edge`, `update_node_params` (and a future `delete_edge`), sees the results, then **describes the new state in a final text message**. (Today the loop ends after the first round of tool calls — the AI never sees the result.)
2. The AI tries to delete a node. A confirmation dialog appears: "AI wants to delete node X, which has 3 incoming edges. Apply / Reject." The user clicks one. (Today destructive tools aren't shipped at all.)
3. AI-added nodes appear next to related existing nodes (not at random coordinates).
4. Sprint 1's npm audit warnings are addressed; Amaranth's `UnusedElaboratable` warning in tests is silenced.

---

## Capacity (solo)

| Person | Available | Allocation | Notes |
|---|---|---|---|
| You + Claude Code | ~45–60 hrs over 3 weeks | Plan to 70% = **30–42 hrs** committed | Multi-step loop is the biggest individual item; leave buffer |

---

## Sprint Backlog

| Pri | Item | Est | Owner | Dependencies |
|---|---|---|---|---|
| **P0** | **1. Multi-step agentic loop** — after applying tool calls, send a synthetic user message with `tool_result` content blocks (one per `tool_use_id`) and keep streaming until `stop_reason: "end_turn"`. Cap iterations at 5 to prevent runaway loops. Requires reshaping `Chat.tsx`'s state into a separate `apiHistory` (full Anthropic content blocks) alongside the existing display-only `messages`. | 6–10 hrs | Claude Code | None |
| **P0** | **2. Smarter placement for AI-added nodes** — when `add_node` is called without an explicit position, place the new node near related blocks (a target node's right side if the AI is about to wire into it; a source node's right side if not). Falls back to current random behavior if no related nodes exist. | 2–3 hrs | Claude Code | Item 1 (uses tool-call payloads to find related nodes) |
| **P0** | **3. Preview-and-apply UI for destructive tools** — modal showing pending changes ("Delete node X (oscillator @ 440Hz)? It has 3 incoming edges that will also be removed.") with Apply / Reject. Then add `delete_node` and `delete_edge` tool definitions. | 4–6 hrs | Claude Code | Item 1 |
| **P0** | **4. Cleanup pass** — `npm audit fix` (no `--force`); document anything left in `KNOWN-ISSUES.md`. Mute Amaranth's `UnusedElaboratable` warnings in `test_synth.py` (filter the specific warning class). | 1–2 hrs | You + Claude Code | None |
| **P0** | **5. End-to-end demo** — fresh launch, ask AI to design a synth voice, watch it: (a) plan, (b) execute multi-step tool calls, (c) describe the result. | 1–2 hrs | You + Claude Code | Items 1–3 |
| **P0** | **6. Sprint log + retrospective** | 1 hr | You | All |
| P1 | **7. IPC layer regression test** — `winToWsl()`, `friendlyError()` parsing, and a smoke test that `synth:run` IPC handler returns `{ok: true, wavData}` for a known-good graph. (Carry-forward from Sprint 3.) | 2–4 hrs | Claude Code | None |
| P1 | **8. Cached audio output in save format** — extend save schema to include the last WAV (base64 in JSON) so reload restores it. Bumps schema version to 2. | 3–4 hrs | Claude Code | None |
| P2 | **9. FPGA bitstream — exploration only** — verify Yosys + nextpnr-ice40 install in WSL2; produce a Verilog file from the current canvas via `amaranth.back.verilog.convert()`; document what's actually involved before committing to it as a sprint marquee. **Don't ship in Sprint 5.** | 2–4 hrs | You | None |

**Planned committed work**: ~14–23 hrs of P0 (well under capacity) · **Sprint Load**: ~30–55%

The lower load is intentional — Item 1 is the unknown-unknown of this sprint and tends to expand once you start. P1 #7 and #8 are the natural next things if the sprint moves fast.

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Agentic loop diverges or runs away** — bad tool calls produce errors, AI tries to fix and makes it worse, user racks up tokens | Bad UX, bad bill | Hard cap at 5 iterations per turn; show iteration count in the chat footer; per-turn token counter; abort handle that breaks the loop, not just the current stream |
| **Conversation history gets confused with content blocks** — Anthropic API rejects mixed-format content arrays, or our `tool_use_id` ↔ `tool_result.tool_use_id` correlation breaks | Loop fails on first tool call | Test with the simplest possible flow first (one tool, one result), then expand. Use TypeScript discriminated unions for `ContentBlock` so the compiler catches mismatches |
| **Preview-and-apply gets in the way for non-destructive tools** | Users click Apply 100x, defeats the safety | Only show preview-and-apply for `delete_*` tools. `add_*` and `update_*` apply directly |
| **`useReactFlow` hook re-firing on every keystroke** — Item 2 will need to read the current `nodes` state when AI calls `add_node`, but that's stale-closure-prone | Tool calls use stale state | Read from a ref or pass current arrays each iteration of the agentic loop, not via closure |
| **Cleanup pass turns up real issues** — npm audit fix breaks something | Sprint slips | Run audit fix in a separate commit so it can be reverted in isolation; only `--force` if specifically needed (and with full test re-run) |

---

## Definition of Done (per item)
- [ ] Code committed to git with a clear commit message
- [ ] Demoable to yourself with one or two commands
- [ ] This `SPRINT-5.md` has a 1-paragraph entry in the Sprint Log
- [ ] You understand at a high level what it does

---

## Key Dates

| Day | Event |
|---|---|
| Day 1–4 | Item 1 (multi-step agentic loop) |
| Day 5–7 | Items 2 + 3 (placement, preview-apply) |
| Day 8 | Item 4 (cleanup) |
| Day 10 | E2E demo target |
| Day 12+ | P1 stretch (cached audio, IPC tests, FPGA exploration), retro |

---

## Sprint 5 → Sprint 6 transition

If Sprint 5 ships clean, the AI consultant becomes a genuine collaborator and the cleanup is paid back. **Sprint 6 should be the FPGA bitstream sprint** — pick iCE40 as the first target, chain `synth.py` to Amaranth's Verilog backend → Yosys → nextpnr-ice40 → icepack to produce a `.bin` file the user can flash to a real dev board. PRD Phase-2 territory; the first time ChipBlocks produces something that runs on real silicon. Probably 3-4 weeks of focused work.

---

## Sprint Log

> Fill in as you go. One paragraph per completed item. Be honest about what didn't work.

### Item 1 — Multi-step agentic loop
**✓ Done — 2026-05-08.** The Sprint 5 marquee. After applying tool calls, the AI now sees the results (as `tool_result` content blocks in a synthetic user message) and continues until it produces a text-only response — typically a confirmation of what just landed on the canvas.

Architecture:
- `Chat.tsx` reshaped: alongside the display-only `messages` array, an `apiHistoryRef` now tracks the API-format conversation including `tool_use` and `tool_result` content blocks. The two stay in sync but the API history is what gets sent on each iteration.
- `sendOneTurn(apiMessages)`: a Promise-based wrapper around the existing IPC chat call. Resolves with `{ text, toolCalls, usage }` once the main process emits `ai:done` for the matching request id. Routes streaming chunk events through three module-level refs (`onChunkRef` / `onDoneRef` / `onErrorRef`) so each call's listeners replace the previous ones cleanly.
- `runAgenticTurn(initialHistory)`: the loop body. Up to `MAX_ITERATIONS = 5` iterations of `sendOneTurn → apply tools → append tool_results → repeat`. Breaks when the model returns no tool calls.
- Hard cap (5 iterations) prevents runaway error-retry loops; the chat shows a final synthetic note when the cap is hit. The iteration count surfaces in the streaming-message header (`AI (step 3)`) so the user sees the loop is multi-step.
- Token totals accumulate across all iterations of a single user turn.

Content-block types are written as a TypeScript discriminated union (`TextBlock | ToolUseBlock | ToolResultBlock`), so the API request payload's shape gets compiler-enforced. Anthropic accepts both string and array content forms; the loop emits string content for text-only assistant messages and the array form whenever `tool_use` blocks are present.

System prompt updated: now mentions that the AI will receive `tool_result` blocks after tool calls and should plan further calls or write a final summary based on them. The behavioral hint at the bottom is "after multi-step tool sequences, end with a short text confirmation of what you did so the user knows where things landed."

`tsc --noEmit` clean. Existing single-turn behavior is a special case of the loop (one iteration, no tool calls).

### Item 2 — Smarter placement for AI-added nodes
**✓ Done — 2026-05-08.** When the AI calls `add_node` without an explicit `position`, the new node now lands just to the right of the existing rightmost node, at vertical position close to the average node `y` with a small random jitter (±40 px) to avoid stacking exactly on top of an existing node. Falls back to a fixed `(200, 200)` when the canvas is empty. Caller-supplied positions still win.

Implementation: `App.tsx`'s `canvasActions.addNode` now reads the live nodes via `useReactFlow().getNodes()` (rather than closing over a stale `nodes` snapshot — that was the previous random-position implementation's reason for being random). The dependency array on the `useMemo` adds `getNodes`, but `getNodes` is a stable reference returned by `useReactFlow()`, so this doesn't churn `canvasActions` per render.

Tradeoff acknowledged: this is a heuristic, not a layout engine. For complex multi-block AI sessions, blocks pile up to the right; the user can drag them. A proper auto-layout (e.g. ELK or dagre) is a future-sprint upgrade.

### Item 3 — Preview-and-apply for destructive tools
*[fill in when complete]*

### Item 4 — Cleanup pass
*[fill in when complete]*

### Item 5 — E2E demo
*[fill in when complete]*

### Item 6 — Sprint retrospective
*[fill in at end of sprint]*

---

## Retrospective (end of sprint)

**What went well:**
*[fill in]*

**What didn't:**
*[fill in]*

**What surprised me:**
*[fill in]*

**What changes Sprint 6:**
*[fill in]*
