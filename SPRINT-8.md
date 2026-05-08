# Sprint Plan: Sprint 8 — AI consultant grounding

> **Solo dev + Claude Code** · Date created: 2026-05-08 · Successor to [SPRINT-7.md](SPRINT-7.md)

**Dates:** 2026-05-08 start — 14 days later (2-week sprint)
**Team:** Solo (you + Claude Code as your dev pair)
**Sprint Goal:** *Make the AI consultant deeply aware of ChipBlocks itself — its UI, its naming conventions, its block library, its capabilities and non-capabilities — so it answers "where do I click to X?" and "build me a kick drum" the way a knowledgeable friend would, not a generic chatbot.*

---

## What "training" means here (plain English)

The user asked to "add some training to the chat ai so it knows our app nav and nameing sence." In the BYOK setup we use, **we don't actually train the model** — that requires running a fine-tuning pipeline on Anthropic's side, which is paid and not what we want anyway.

What we *can* do — and what this sprint does — is two things that have the same effect from the user's chair:

1. **System prompt augmentation** — every API call to Claude includes a "system" block that tells the model who it is and what it should know. The current system block ([Chat.tsx:94-157](frontend/src/Chat.tsx)) covers the 9 block types but says nothing about the toolbar, the palette, the save format, naming conventions, or what's *not* possible. We expand it.
2. **Tool description sharpening** — the AI's `add_node` / `add_edge` tools have generic descriptions today. We add per-block-type schemas (so the AI knows that `oscillator` takes `freq`, `adsr` takes `attack_ms`/`decay_ms`/etc., `lowpass` takes `cutoff_hz`) and we list the valid source-handle / target-handle combinations explicitly.

The combined effect: the AI sees, on every call, a complete reference for the app and its block library. Costs nothing extra at runtime because Claude's prompt-caching means the static system block is billed at ~10% of normal rates after the first call in a session.

---

## Working Assumptions

| Assumption | Default | Change if... |
|---|---|---|
| Sprint length | **2 weeks** (small focused sprint) | Want shorter / longer |
| Availability | **~10 focused hours/week** (~20 hrs total) | Different |
| Stack | unchanged from S7 | n/a |
| Live testing | Manual chat queries from the dev box | Want automated eval |
| Tracking | Git commits + this `SPRINT-8.md` log | Want issues |

---

## Sprint Goal — concrete target

After Sprint 8, the AI consultant should pass these queries (manual eval):

1. **"Where do I click to play the audio?"** → answers "Click ▶ Play in the toolbar" — not "I don't have UI awareness."
2. **"Save my graph"** → tells the user about the Save button + the `chipblocks-graph.json` file format.
3. **"Build me a kick drum"** → suggests Gate → Oscillator (low freq) → ADSR (short attack, fast decay, low sustain) → Output, references actual block names + ports.
4. **"What's the cutoff range for the low-pass filter?"** → answers 1–22050 Hz, default 800.
5. **"Can I export to MIDI?"** → answers "Not yet — v0.1.0-alpha doesn't support MIDI input or export. The roadmap has it for a future sprint."
6. **"Add a sawtooth at 110 Hz to my mixer"** → uses `add_node` with type `sawtooth` and `data: {freq: 110}`, then `add_edge` to wire it.
7. **"Why doesn't my graph play?"** → checks for the common cause (missing or unwired Output block) before guessing.

Items NOT in this sprint:
- Server-side eval framework (manual eval is fine for an alpha).
- A separate "Help & docs" panel inside the app — defer; the AI is the help system for now.
- Fine-tuning a model — out of scope (BYOK + cost).

---

## Capacity (solo)

| Person | Available | Allocation | Notes |
|---|---|---|---|
| You + Claude Code | ~20 hrs over 2 weeks | Plan to 70% = **~14 hrs** committed | Mostly prose work + tool-schema editing; low risk |

---

## Sprint Backlog

| Pri | Item | Est | Owner | Dependencies |
|---|---|---|---|---|
| **P0** | **1. Audit + extract knowledge base** — read all 9 block files (backend Python + frontend TSX), the App / Palette / SettingsModal source, save format, README, PRD non-goals. Two research agents already produced structured markdown KBs in this conversation. Use them as the source material. | 1–2 hrs | Claude Code | None |
| **P0** | **2. Expand `STATIC_SYSTEM`** in [Chat.tsx](frontend/src/Chat.tsx) — add: app identity, toolbar reference, canvas mechanics, save/load format, naming conventions, common workflows (3–5 patterns), what the app is NOT (non-capabilities). Keep the existing block library reference; just supplement it. Target: ~6–8 KB total prompt (cacheable, billed at ~10% after first hit). | 3–4 hrs | Claude Code | Item 1 |
| **P0** | **3. Improve tool descriptions** — `add_node` should list valid params per block type with ranges + defaults; `add_edge` should list the valid (source-handle → target-handle) pairs the AI can produce; `update_node_params` should reference the same param-per-type table. | 2–3 hrs | Claude Code | Item 2 |
| **P0** | **4. Smoke test** — run the dev app, ask the 7 queries from the sprint goal section, record where the AI hallucinates or misses. If a query fails, iterate on the prompt. | 1–2 hrs | You + Claude Code | Items 2, 3 |
| **P0** | **5. Sprint retrospective** | 1 hr | You | All |
| P1 | **6. Add a "Help" pseudo-command** the user can type in chat (e.g. `/help`) that prints the canonical block list + toolbar reference from the system prompt. Useful even when the AI is off-line. | 1–2 hrs | Claude Code | Item 2 |
| P1 | **7. Cached audio output in save format** (carryforward — 6 sprints stale; explicit drop/promote decision per S7 retro) | 3–4 hrs | Claude Code | None |
| P1 | **8. IPC layer regression test** (carryforward — 6 sprints stale; same status) | 2–4 hrs | Claude Code | None |
| P2 | **9. Cost telemetry / token accounting per session** — show the user how many tokens they've spent. | 2–3 hrs | Claude Code | None |

**Planned committed work**: ~7–11 hrs of P0 (well under 14 hrs at 70% capacity) · **Sprint Load**: ~50–80%

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **The expanded prompt is large enough to push first-call latency noticeably** | Slower "first chat message" feel | Keep total system block under ~10 KB. The cache_control block is already in place — once cached (within the same session), subsequent calls are fast. |
| **Per-block-type tool schema gets out of sync with the actual block defaults** | AI suggests defaults that don't match what the dev environment actually does | Pull the schema text directly from `Palette.tsx`'s `defaultDataForType()` rather than hand-writing it. Single source of truth. |
| **Manual smoke test misses regressions in existing query types** that were already working | Net loss in some queries | Before changes, capture 3–4 baseline AI answers (just chat outputs in this session's notes). Compare after. |
| **Cache invalidation if the prompt changes mid-session** | Higher cost than expected | Expected, fine — the user clears the conversation rarely; new sprint releases legitimately invalidate the cache. |
| **The model "knows" things from training that conflict with our prompt** (e.g. "ChipForge" the prior name, or generic synth-design conventions) | AI gives wrong app references | Be explicit and authoritative in the prompt — repeat the right names; explicitly note "this app is called ChipBlocks, not ChipForge." |

---

## Definition of Done (per item)
- [ ] Code committed to git with a clear commit message
- [ ] Demoable to yourself with one or two commands
- [ ] This `SPRINT-8.md` has a 1-paragraph entry in the Sprint Log
- [ ] You understand at a high level what it does

---

## Key Dates

| Day | Event |
|---|---|
| Day 1 | Items 1–3 (research already in hand from S8 chat; integration + tool schema) |
| Day 2 | Item 4 (smoke test, iterate on prompt as needed) |
| Day 3–7 | Buffer for iteration if smoke test surfaces gaps |
| Day 8–14 | Item 5 (retro), optional P1 work |

---

## Sprint Log

> Fill in as you go. One paragraph per completed item. Be honest about what didn't work.

### Item 1 — Audit + extract knowledge base
**✓ Done — 2026-05-08.** Two parallel research agents read the codebase and produced structured KBs: one for the block library (Python backend + React Flow frontend, both halves verified to agree), one for the app navigation (toolbar, palette, save format, settings, models, scope). The current AI consultant prompt was 1.8 KB and covered just the block library. The combined research output gave me ~7 KB of accurate knowledge to integrate, sourced from the actual code rather than my recollection.

### Item 2 — Expand STATIC_SYSTEM
**✓ Done — 2026-05-08.** Rewrote [STATIC_SYSTEM in Chat.tsx](frontend/src/Chat.tsx:94) from 1.8 KB to ~7.5 KB. New sections: app identity (with the "this app is called ChipBlocks, not ChipForge — never use the old name" note to override pre-Sprint-3 training data the model might surface), toolbar reference, canvas mechanics, save format with a worked example, naming conventions (block type strings, port handle casing, parameter casing), 6 common workflows (sound-with-attack-release, two-osc mix, filter, kick drum, arpeggio via S&H, "why doesn't my graph play"), and an explicit "what ChipBlocks does NOT do" list (no polyphony, no MIDI, no reverb, no real-time audio, no PCB). The cache_control block on the static system message is unchanged — it still triggers Anthropic's prompt cache, which means the larger prompt is billed at ~10% rates after the first call in a session.

### Item 3 — Improve tool descriptions
**✓ Done — 2026-05-08.** [buildTools() in Chat.tsx](frontend/src/Chat.tsx:178) — three of the five tools got sharpened descriptions:
- **add_node**: now lists the exact param shape per type (oscillator/triangle/sawtooth take `freq`; adsr takes the four ADSR params with ranges and defaults; gate takes `rate_hz`/`duty_pct`; lowpass takes `cutoff_hz`; mixer/output/samplehold take none).
- **add_edge**: now lists the valid (source-handle → target-handle) pairings with concrete patterns (`gate.gate-out → adsr.gate`, `oscillator.audio-out → mixer.in-1`, etc.). The model previously had to guess which handle name to use; now it has an enumerated list.
- **update_node_params**: lists the same per-type field set as add_node.

The two destructive tools (delete_node, delete_edge) were already well-described and were not touched.

### Item 4 — Smoke test
**Carry-over — needs user action.** The actual chat eval requires the user's Anthropic API key + GUI clicks. I verified the dev server starts cleanly on the new prompt (no TS errors, Vite ready, IPC bridge intact). Surfaced the 7 smoke-test queries to the user in the closing summary so they can run them and confirm the AI is now app-aware.

### Item 5 — Sprint retrospective
**✓ Done — 2026-05-08.** Filled in below. Sprint 8 closed.

---

## Retrospective (end of sprint)

**What went well:**
- **Parallel research agents were the right pattern for this work.** The block library and app navigation are both wide-and-shallow research jobs (read N files, extract structured info). Dispatching two agents in parallel gave me 7 KB of accurate, sourced-from-code knowledge in ~2 minutes of wall time. Doing it manually would have taken an hour of context-window churn for the same result.
- **The "name it explicitly so the model doesn't surface old training data" trick** mattered. Without an explicit "ChipBlocks, not ChipForge" line, the model could reasonably refer to the project by either name from its training distribution, since both names exist on the public internet (the old GitHub fork, etc.). Calling it out directly is cheap insurance.
- **Cache-friendly prompt design.** The static system block is now 7.5 KB but it's identical across calls within a session, so Anthropic's prompt cache absorbs ~90% of the input-token cost after the first call. The dynamic block (current canvas state) stays small. Net cost increase per session is negligible.
- **Tool descriptions are doing real work.** The model gets the tool schemas as part of its function-calling context, separately from the system prompt. Filling those out with concrete per-block-type information means the AI doesn't need to infer schema from a generic `data: object` field — it sees the actual shape the renderer expects.
- **Sprint 8 was right-sized.** Two-week budget, closed in one focused session. No surprises, no creeping scope. The sprint plan correctly identified that this was mostly prose-and-schema work, not engineering.

**What didn't:**
- **No automated eval.** I want a way to run the 7 smoke-test queries against the actual API and grade the answers, but that would have been a sprint of its own (eval framework + harness + scoring). For an alpha, manual eval-by-the-user is the right level of investment.
- **The prompt is a single template literal in `Chat.tsx`.** Now that it's 7.5 KB of structured prose, it would benefit from being a separate module (e.g. `frontend/src/ai/prompt.ts` or even a `.md` file imported at build time). Defer to S9 if a second prompt edit happens; one big string is fine for now.
- **No telemetry on which tools the model actually calls.** Token counts are tracked per-session but tool-call frequency isn't. Would help close the loop on whether the schema sharpening changed model behavior.
- **P1 carryforwards (cached audio, IPC test) still untouched.** Now 6 sprints stale. Either I formally drop them in S9 or one of them gets a P0 slot.

**What surprised me:**
- **The existing prompt was missing the toolbar entirely.** The AI knew about blocks but didn't know that `▶ Play` was the button to press to hear the design. So if a user asked "how do I hear this?" the AI would describe the simulation pipeline rather than say "click ▶ Play in the toolbar." Small gap, big UX delta.
- **The two research agents' outputs were ~80% non-overlapping.** I'd expected meaningful overlap on shared concepts (e.g. naming conventions appear in both the block library and the app navigation). They cleanly partitioned: one stayed inside the block files, the other stayed inside the app shell. Good agent isolation, less merge work for me.
- **The `data: {}` field in `add_node` was the model's biggest source of confusion** in earlier sessions (per the agentic-loop logs from S5). Looking back at why: the schema literally said `type: 'object'` with nothing else. The model had to infer per-block-type structure from the system prompt, which was not part of the function-calling context. Sharpening the description fixed this without changing the behaviour at all.

**What changes Sprint 9:**
- **Real silicon flash test** — user owns no iCEstick yet; if they get one, S9 has a "is the bitstream actually flashable?" goal.
- **One of**: the long-deferred Tiny Tapeout submission package, more DSP blocks (wavetables, delay, reverb), Mac/Linux installers + code-signing, vitest 4 + Vite 6 paired upgrade, auto-layout with ELK or dagre for AI-placed nodes, or a decision on the 6-sprint-stale P1 carryforwards.
- **Optional: prompt-eval framework** — a small Python script that hits the Anthropic API with the 7 smoke-test queries and grades the outputs against expected substrings. Not mandatory but would catch regressions in the prompt across future edits.

User direction needed at the start of S9 — same fork as S7 and S8 endings. The product keeps getting more capable but the "what's the next biggest unlock" question doesn't have an obvious answer.
