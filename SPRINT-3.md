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
*[fill in when complete]*

### Item 2 — Triangle Wave block
*[fill in when complete]*

### Item 3 — Sawtooth Wave block
*[fill in when complete]*

### Item 4 — ADSR Envelope block
*[fill in when complete]*

### Item 5 — Project save/load (full state)
*[fill in when complete]*

### Item 6 — AI consultant chat sidebar
*[fill in when complete]*

### Item 7 — E2E demo
*[fill in when complete]*

### Item 8 — Sprint retrospective
*[fill in at end of sprint]*

---

## Retrospective (end of sprint)

**What went well:**
*[fill in]*

**What didn't:**
*[fill in]*

**What surprised me:**
*[fill in]*

**What changes Sprint 4:**
*[fill in]*
