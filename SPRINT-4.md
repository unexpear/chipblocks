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
*[fill in when complete]*

### Item 2 — Low-pass Filter block
*[fill in when complete]*

### Item 3 — Sample-and-Hold block
*[fill in when complete]*

### Item 4 — Model picker in Settings
*[fill in when complete]*

### Item 5 — AI tool-calls
*[fill in when complete]*

### Item 6 — E2E demo
*[fill in when complete]*

### Item 7 — Sprint retrospective
*[fill in at end of sprint]*

---

## Retrospective (end of sprint)

**What went well:**
*[fill in]*

**What didn't:**
*[fill in]*

**What surprised me:**
*[fill in]*

**What changes Sprint 5:**
*[fill in]*
