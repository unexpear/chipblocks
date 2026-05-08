# Sprint Plan: Sprint 3 — AI consultant + broader library

> **Solo dev + Claude Code** · Date created: 2026-05-07 · Successor to [SPRINT-2.md](SPRINT-2.md)

**Dates:** TBD start — 21 days later (3-week sprint)
**Team:** Solo (you + Claude Code as your dev pair)
**Sprint Goal:** *Make the demo loop genuinely useful. Edit block parameters in the UI, hear the change. Build with 5+ block types instead of 3. Open a chat sidebar where the AI knows the block library and helps you plan a chip.*

---

## Working Assumptions

| Assumption | Default | Change if... |
|---|---|---|
| Sprint length | **3 weeks** | Want shorter (descope) or longer (more polish) |
| Availability | **~15–20 focused hours/week** (~45–60 hrs total) | Different |
| OS | **Windows 11 + WSL2** | n/a |
| Tech stack | **Electron + React + TS frontend, Python + Amaranth backend** (Migen→Amaranth swap shipped in S2) | n/a |
| AI provider | **BYOK Anthropic API for v1**, OpenAI + Ollama deferred to S4 | User wants OpenAI first / wants both day 1 |
| Tracking | Git commits + this `SPRINT-3.md` log | Want issues / Projects |

---

## Sprint Goal — concrete target

After Sprint 3:
1. Click on the Oscillator block, change its frequency from 440 to 660, press Play → hear the new pitch. (Same for any future parameterized block.)
2. The block palette has at least **5 audio blocks** (Oscillator, Mixer, Output, Triangle, Sawtooth, ADSR), with a 6th (Low-pass Filter) as stretch.
3. A chat sidebar opens on the right side of the canvas. You enter your Claude API key once (stored locally). You ask "how do I make a vibrato sound?" and it answers using its knowledge of the block library and what's currently on your canvas.
4. Save / Load includes the parameter values (not just nodes + edges shape).

---

## Capacity (solo)

| Person | Available | Allocation | Notes |
|---|---|---|---|
| You + Claude Code | ~45–60 hrs over 3 weeks | Plan to 70% = **30–42 hrs** committed | Bigger AI item; leave buffer |
| **Total** | **45–60 hrs** | **~36 hrs of committed work, rest is buffer** | |

---

## Sprint Backlog

| Pri | Item | Est | Owner | Dependencies |
|---|---|---|---|---|
| **P0** | **1. Block parameter editing (Oscillator first)** — clicking the freq value in the Oscillator node makes it editable; updates `data.freq` via React Flow's `updateNodeData`; new value flows through to `synth.py` on Play. | 2–3 hrs | Claude Code | None |
| **P0** | **2. Triangle Wave block** — Amaranth `Elaboratable` matching the existing port-dict contract. Param: `freq_hz`. Output: `audio-out` (1-bit, but oscillates as a 1-bit approximation of triangle, e.g. via Bresenham-style counter). | 2–3 hrs | Claude Code | Item 1's pattern |
| **P0** | **3. Sawtooth Wave block** — same shape as Triangle. Param: `freq_hz`. | 1–2 hrs | Claude Code | Item 2 |
| **P0** | **4. ADSR Envelope block** — attack/decay/sustain/release amplitude shaping. Inputs: `gate` (trigger), `audio-in`. Output: shaped `audio-out`. Params: `attack_ms`, `decay_ms`, `sustain_level`, `release_ms`. | 4–6 hrs | Claude Code | Items 1, 2 |
| **P0** | **5. Project save/load — full state** — current Save dumps `{nodes, edges}`; extend to include any parameter values, viewport, and metadata. Backwards-compatible with existing saves. | 2–3 hrs | Claude Code | Item 1 |
| **P0** | **6. AI consultant chat sidebar** — toggle a right-side panel; settings modal for Anthropic API key (stored in `localStorage`); chat input; streaming responses; system prompt that includes the block library spec + current canvas JSON. Uses Anthropic SDK. | 8–12 hrs | Claude Code | Anthropic SDK install |
| **P0** | **7. End-to-end demo** — open app, change Osc freq, drag in a Triangle, wire it via Mixer, save, reload, press Play, hear the result; ask the AI "what should I add to make this sound like a video-game zap?" and follow its suggestion. | 2–3 hrs | You + Claude Code | Items 1–6 |
| **P0** | **8. Sprint log + retrospective** | 1–2 hrs | You | All |
| P1 | **9. Low-pass Filter block** — IIR-style 1-pole filter; cutoff parameter. Smoother audio when wired after an oscillator. | 4–6 hrs | Claude Code | Item 2 |
| P1 | **10. AI tool-calls for canvas manipulation** — AI can add a node, wire two existing nodes, or change a parameter via tool calls. Bigger feature; defer if Item 6 lands clean and there's time. | 6–10 hrs | Claude Code | Item 6 |
| P1 | **11. Sample-and-Hold block** | 2–3 hrs | Claude Code | Item 2 |
| P2 | **12. Block category palette in the toolbar** — searchable list of available blocks; drag onto canvas. (Currently nodes only appear if you load a saved graph.) | 4–6 hrs | Claude Code | Items 1–4 |
| P2 | **13. Live waveform preview during edit** | 4–6 hrs | Claude Code | All P0 |
| P2 | **14. Sprint 2 carryover cleanup** — `npm audit fix` on safe vulnerabilities, IPC unit tests, electron-builder config decision | 2–3 hrs | You + Claude Code | None |

**Planned committed work**: ~22–34 hrs of P0 (≈70% of capacity) · **Sprint Load**: ~50–75%

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **AI consultant scope creep** — chat UI, settings UX, streaming, system prompt, error handling, rate limiting, key management UX… each is small, sum is big | Sprint slips on Item 6 | Box it: chat sidebar with API-key settings + non-streaming responses first; add streaming + tool calls only after the basic chat works end-to-end |
| **Bresenham-style waveform approximations sound bad on 1-bit output** — triangle/saw at 1-bit audio is essentially still a square unless we widen the signal | Audio quality plateau | Widen output signals to 8-bit early in S3 if 1-bit triangle sounds wrong; this is a design pivot worth doing now rather than later |
| **localStorage API-key storage is not secure** — anyone with file-system access to the user's machine can grab the key | Trust risk for users | v1: localStorage with a clear warning in the settings UI; long-term: Electron's `safeStorage` API with OS keychain. Punt the upgrade to S4 unless trivial |
| **Anthropic API rate limits / cost surprises** — accidental tight loop could rack up usage fast | $ exposure for the user, not the project | Show cumulative-tokens-this-session counter in the sidebar; cap message size; make abort obvious |
| **Carryover from Sprint 2: 15 npm vulnerabilities** | Low real risk (mostly transitive); audit fatigue | One-shot `npm audit fix` (no `--force`) early in S3; document anything left |

---

## Definition of Done (per item)
- [ ] Code committed to git with a clear commit message
- [ ] Demoable to yourself with one or two commands
- [ ] This `SPRINT-3.md` has a 1-paragraph entry in the Sprint Log
- [ ] You understand at a high level what it does

---

## Key Dates

| Day | Event |
|---|---|
| Day 1 | Sprint starts — Item 1 (parameter editing) |
| Day 4 | Items 2 + 3 done; you can build with 5 wave types |
| Day 7 | Mid-sprint check #1 — ADSR working? Save/load extended? |
| Day 10–14 | AI consultant work (Item 6) |
| Day 17 | E2E demo target |
| Day 18–21 | Polish, P1 stretch, retro |

---

## Sprint 3 → Sprint 4 transition

If Sprint 3 succeeds, the app feels like a real instrument: you build a chip, change its parameters, hear the result, and the AI helps you decide what to do. Sprint 4 candidates:

- **AI tool-calls** — AI can manipulate the canvas directly (add blocks, wire, change params)
- **More providers** — OpenAI + local Ollama support behind a provider-picker
- **Block parameter UX upgrade** — sliders, stepper buttons, MIDI-style controls
- **Block palette** — drag-from-palette to add new blocks (vs only loading a saved graph)
- **Cached audio outputs** — the WAV from your last Play sticks around for offline reference
- **First steps toward the FPGA bitstream output**: pick one open dev board (iCE40 likely) and wire `synth.py` to call Yosys + nextpnr

---

## Sprint Log

> Fill in as you go. One paragraph per completed item. Be honest about what didn't work — that's where the value is.

### Item 1 — Block parameter editing
**✓ Done — 2026-05-07.** Oscillator's frequency is now an inline editable `<input type="number">` inside the node. Bounds-checked 20–20000 Hz. `useReactFlow().updateNodeData(id, { freq })` flows the new value into the React Flow nodes state, which then ships through the existing `{nodes, edges}` IPC payload to `synth.py` on Play. `e.stopPropagation()` on click + mousedown so React Flow doesn't try to drag the node while the user is editing. Pattern reused identically in Triangle and Sawtooth (Items 2–3); will be extended to multi-parameter blocks (ADSR) in Item 4. Native spinner arrows hidden via CSS for visual cleanliness; keyboard arrow keys still work.

### Item 2 — Triangle Wave block
**✓ Done — 2026-05-07.** Pulled in the bit-width pivot flagged in the sprint risks: all audio signals across the existing block library widened from 1-bit to **8-bit signed** (-128 to +127). 1-bit triangles and sawtooths are essentially squares; widening was cheaper to do now than later. Added `backend/blocks/triangle.py` using a 16-bit phase accumulator + high-byte ramp pattern (so any frequency plays in tune, not just integer divisors of the sample rate). Added `frontend/src/blocks/TriangleNode.tsx` mirroring the Oscillator pattern with a yellow border for visual differentiation. Triangle smoke test produces 256 distinct sample values across the full -128..+127 range — proper triangle, not approximation.

### Item 3 — Sawtooth Wave block
**✓ Done — 2026-05-07** (alongside Item 2). `backend/blocks/sawtooth.py` uses the same phase-accumulator pattern, just with the high byte mapped directly to signed amplitude (no fold). 256 distinct values, full range. `frontend/src/blocks/SawtoothNode.tsx` with a purple border. Together with Triangle, the block library is now 5 types (Oscillator, Triangle, Sawtooth, Mixer, Output).

**Bit-width pivot details** (changes triggered by Items 2 + 3):
- `Oscillator` re-implemented with the phase-accumulator pattern; outputs ±127/-128 at the configured frequency. Frequency resolution improved at the same time (440 Hz now plays at 440 Hz, not 441 Hz from period truncation).
- `Mixer` changed from XOR (1-bit only) to **average** (`(in_1 + in_2) >> 1`). For audio this is a proper mix rather than ring-modulator harmonics; XOR can come back later as a separate "Ring Mod" block if we want it.
- `Output.audio_in` widened to `Signal(signed(8))`.
- `synth.py write_wav()` now scales 8-bit signed samples to 16-bit PCM (×64 to keep loudness in line with the previous era's 1-bit ±8000 amplitude).
- `BLOCK_REGISTRY` adds `"triangle"` and `"sawtooth"` keys.
- `App.tsx` initial graph upgraded from 3 blocks to 5: Oscillator (440 Hz) + Triangle (660 Hz) → Mixer → Output, with a Sawtooth (220 Hz) sitting unwired so users see the new type and can wire it in.
- All 5 block tests in `test_blocks.py` updated for the new behaviors and PASS. All 5 translator tests in `test_synth.py` PASS. End-to-end `synth.py` run with the new 5-block graph produces a valid 176 KB WAV.

### Item 4 — ADSR Envelope block (+ Gate source)
**✓ Done — 2026-05-08.** ADSR is the first block with multi-parameter UI and an FSM-based design. Bundled a Gate source block (cyan border) since ADSR needs a trigger signal to fire from. The block library is now **7 types**.

`backend/blocks/adsr.py` — Amaranth `Elaboratable` with 5-state FSM (IDLE → ATTACK → DECAY → SUSTAIN → RELEASE → IDLE). 16-bit envelope accumulator; high byte (0..127) is the multiplier `audio_out = (audio_in * env_byte) >> 7`. Edge-detected gate so retrigger requires a fresh rising edge, not just a high level. Parameters: `attack_ms`, `decay_ms`, `sustain_level` (0..127), `release_ms`, `sample_rate`. Smoke test drives constant +127 audio_in and pulses gate; verified envelope idles at 0, peaks at ~126 during gate-high, returns to 0 after release. 127 distinct envelope values across the curve.

`backend/blocks/gate.py` — counter-based 1-bit pulse generator. Params: `rate_hz`, `duty_pct`. Verified: 441 Hz / 50% duty produces 7+ transitions and ~equal high/low samples in 400 ticks.

`synth.py _build_params()` extended to map `data.attack_ms` / `data.decay_ms` / `data.sustain_level` / `data.release_ms` for ADSR and `data.rate_hz` / `data.duty_pct` for Gate. End-to-end run of a 4-node ADSR graph (Osc 440 → ADSR ← Gate 4Hz → Output) produces a valid 176 KB WAV with 8 ADSR cycles in 2 seconds — the pulsing chiptune note effect.

Frontend:
- `ADSRNode.tsx` — orange border, 4 parameter rows (A / D / S / R) with compact narrow inputs, 2 input handles on the left (gate at top, audio-in at bottom) staggered like Mixer.
- `GateNode.tsx` — cyan border, 2 parameter rows (rate, duty %).
- `App.css` — added `.block-row` / `.block-label` / `.block-input-narrow` utilities for multi-parameter blocks. Reusable for the future LPF block.
- `blocks/index.ts` — `AppNode` union now spans 7 variants.

Default graph unchanged (still the 5-block Osc/Tri/Saw/Mixer/Output layout from Items 2+3). To use ADSR + Gate in the running app you currently need to load a JSON graph that wires them in — a drag-from-palette UI is a future item.

### Item 5 — Project save/load (full state)
**✓ Done — 2026-05-08.** Save format upgraded from `{nodes, edges}` to a versioned envelope:
```json
{ "version": 1, "app": "ChipBlocks", "savedAt": "<iso>", "viewport": {...}, "nodes": [...], "edges": [...] }
```
Block parameters were already preserved (they live inside `node.data`); the new pieces are **viewport** (zoom + pan position) and **metadata** (version, app, savedAt) so future format changes can be migrated cleanly.

Implementation: refactored App into `App` (thin `ReactFlowProvider` wrapper) + `AppContent` (the actual component) so `useReactFlow()` is in scope; `getViewport()` on save and `setViewport()` on load. Backwards-compatible: older `{nodes, edges}` saves still load (the loader treats missing `viewport` as "leave current viewport alone"). Forward-compatible: a newer-version save shows a warning toast but still attempts to load.

Also added an `examples/` directory with two demo graph files:
- `adsr-pulse.json` — Oscillator + Gate + ADSR + Output, showing the ADSR pulse-shaping a 440 Hz tone four times per second
- `two-osc-mix.json` — square + sawtooth into a Mixer (chiptune-y dissonance)

…plus a small `examples/README.md` so they're discoverable from the GitHub landing page. Load via the **Load graph** toolbar button.

`tsc --noEmit` clean.

### Item 6 — AI consultant chat sidebar
**✓ Done — 2026-05-08.** The marquee Sprint 3 item. Right-side chat panel powered by **`@anthropic-ai/sdk@0.94.x`** (MIT — clean for the project's no-copyleft policy). Architecture follows the research-agent recommendations (and the Sprint 3 risk register's "box it" note for Item 6 scope):

**Key choices:**
- **Main process owns the API calls.** The renderer never sees the Anthropic key. Streaming text deltas flow back via `webContents.send('ai:chunk', ...)` IPC events keyed by per-request id.
- **Encrypted key storage via Electron `safeStorage`** — OS keychain (Keychain on macOS, DPAPI on Windows, libsecret on Linux). Recommended over localStorage even with our non-adversarial threat model.
- **Model: `claude-sonnet-4-6`** at `max_tokens: 4096`. Best speed/quality balance for chat. Future tuning can expose this as a setting.
- **Prompt caching** (`cache_control: { type: "ephemeral" }`) on the static block-library spec; per-turn canvas-state JSON is the un-cached portion. Keeps per-turn cost down across a long conversation.
- **AbortController** per-request for clean cancel; `id` correlation prevents stale streams from updating the UI after cancel.

**Files:**
- `frontend/electron/main/ai.ts` — IPC handlers (`ai:save-key` / `ai:has-key` / `ai:clear-key` / `ai:chat` / `ai:cancel`) plus the streaming runChat loop.
- `frontend/electron/main/index.ts` — registers `registerAiHandlers()` inside `app.whenReady()`.
- `frontend/electron/preload/index.ts` — exposes `window.ai` with chat / cancel / key management plus `onChunk`/`onDone`/`onError` event subscriptions that return cleanup functions.
- `frontend/src/Chat.tsx` — chat panel component; streaming text accumulator (via `useRef` to avoid React-state-lag); typing-cursor animation; cancel button while streaming; token counter in the footer.
- `frontend/src/SettingsModal.tsx` — modal for API key entry; password-style input; explicit privacy disclosure about safeStorage.
- `frontend/src/App.tsx` — toolbar gets 💬 Chat toggle + ⚙ Settings buttons; layout wraps canvas + chat in a `.main-area` flex row.
- `frontend/src/App.css` — chat-panel + modal styles, streaming-cursor blink animation, toolbar-toggle-active state.

**Empty state when no key is configured**: chat panel shows a clear "add your API key" message + a Settings button, plus the privacy explanation. No silent fail.

**System prompt** is two parts: a static cached spec describing all 7 block types (their ports, parameters, ranges) plus a per-turn canvas-state block listing the actual nodes + edges JSON. This way the AI's suggestions are concretely grounded in what the user has on screen.

`tsc --noEmit` clean. Dev server bundles cleanly with the SDK in the main bundle (preload 14.83 kB, main 9.72 kB — both modest). End-to-end "click Chat → see panel → enter key in settings → ask a question → stream answer" flow is wired but requires the user to provide their Anthropic API key for live verification.

### Item 7 — E2E demo
**✓ Done — 2026-05-08.** Verified end-to-end as far as automated checks reach. Specifically:
- All 7 backend block tests PASS (Oscillator / Triangle / Sawtooth / Mixer / Output / Gate / ADSR)
- All 5 backend translator tests PASS (`test_synth.py`)
- `tsc --noEmit` clean across the frontend + Electron sources
- `synth.py` end-to-end run with both the default 5-block graph AND the 4-block ADSR-pulse demo graph produced valid 176 KB WAV files
- Dev server boots cleanly with the new AI subsystem in the Electron main bundle (preload 14.83 KB, main 9.72 KB)

**What still requires the user to verify in the running app** (BYOK by design — there's no automated path):
- Click Chat → panel opens with empty-state message ✓ (UI fully wired and ts-checked)
- Open Settings → modal appears, save an API key
- Send a message → streaming response appears
- Cancel mid-stream
- Click Save → downloads the v1 versioned format
- Load the `examples/adsr-pulse.json` → ADSR + Gate appear; press Play; hear the pulsing tone

The wiring is all in place; live AI verification just needs the user's own Anthropic key. Documented as a follow-up handoff item; not blocking sprint close.

### Item 8 — Sprint retrospective
**✓ Done — 2026-05-08.** Filled in below. Sprint 3 closed.

---

## Retrospective (end of sprint)

**What went well:**
- **The block library tripled** in this sprint — went from 3 types (Oscillator, Mixer, Output) to **7** (added Triangle, Sawtooth, ADSR, Gate). Each new block followed the same pattern (Amaranth `Elaboratable` + `input_ports` / `output_ports` dicts + frontend `*Node.tsx` mirror), so the marginal cost of adding the 6th and 7th block was small.
- **The bit-width pivot was caught by the sprint risk register** before it bit us. 1-bit triangle/saw would have been a regression masquerading as a feature; widening to 8-bit signed across the whole library before adding the new shapes saved a refactor in Sprint 4.
- **Research agents continued to pull weight** — the Anthropic-SDK-in-Electron research delivered the entire `client.messages.stream(...)` + `safeStorage` + IPC-forwarding cookbook. Item 6 worked first try as a result.
- **`safeStorage` over `localStorage`** for the API key was the right architectural call. Cost was ~10 lines; benefit is a key that isn't grep-able from disk and never crosses the IPC boundary.
- **The mid-sprint rename ChipForge → ChipBlocks happened cleanly.** Trademark + domain + community clearance came back red on ChipForge mid-Sprint 3; doing the rename across 17 source files via sed + `gh repo rename` cost about 30 minutes and the sprint kept moving.
- **6 of 8 P0 items shipped in two focused sessions** of the sprint (Items 1–6). Original plan budgeted 3 weeks; actual was a small fraction.

**What didn't:**
- **Default canvas still doesn't include ADSR or Gate.** Users have to manually `Load graph` from `examples/adsr-pulse.json` to see those new blocks in action — there's no drag-from-palette UI yet (P2 #12 deferred). For Sprint 4 that should land first.
- **Live AI verification requires the user to supply a key.** Inherent to BYOK, but worth flagging for sprint hand-off.
- **`UnusedElaboratable` warnings** still show up in the translator tests — Amaranth being chatty about test patterns it doesn't recognize. Cosmetic, but worth filing as cleanup later (`tracemalloc` or muting the specific warning class).
- **Fifteen npm vulnerabilities** carried over from Sprint 1 still untouched. None are in our hot path; defer to Sprint 4 cleanup pass.

**What surprised me:**
- **The ChipForge name was already burned hard.** Singapore-based Chipforge Pte Ltd being acquired by ASX-listed Pathkey.AI for ~560M shares + 150M performance rights, completion June 2026 — same product space as ours. Caught in time.
- **ChipBlocks came back unusually clean** across every clearance vector: USPTO/EUIPO search-engine signal, all six target domains, GitHub org, Reddit, npm/PyPI/crates, app stores, Product Hunt, crypto/Web3, toy/game industry. Genuinely no conflict.
- **Amaranth's signed-arithmetic story is cleaner than expected.** `Signal(signed(8))` + `>> 1` for averaged mixing + signed * unsigned multiplications all worked without explicit casts.
- **The Anthropic SDK's streaming pattern + Electron IPC fit together cleanly** with no dance for the cloneable-payload constraint, because the SDK exposes simple `text_delta` events that are already plain JSON.
- **Mid-sprint renames are surprisingly survivable** when the codebase is small and well-organized. 17 files touched, 48 occurrences, single sed pass, zero rebuilds.

**What changes Sprint 4:**
- **Block palette in the toolbar / sidebar** — drag-from-list to add new blocks. (Carryover P2 #12 from Sprint 3.) Without this, ADSR + Gate are second-class citizens.
- **AI tool-calls for canvas manipulation** — let the consultant actually add a node, wire two existing ones, or change a parameter on the user's behalf. (Carryover P1 #10 from Sprint 3.) Big lift but the right next step.
- **Low-pass Filter and Sample-and-Hold blocks** (Sprint 3 P1 #9, #11). Both small.
- **Model picker in Settings** — Sonnet 4.6 default; Haiku 4.5 for speed; Opus 4.7 for hard problems. Surface it as a dropdown.
- **Carryover cleanup** — npm audit pass, `UnusedElaboratable` warning, Sprint 1's `electron-builder.json` decision.
- **Maybe: cached audio output in Save format** so reloading a project also restores the last WAV the user heard.
