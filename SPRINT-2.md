# Sprint Plan: Sprint 2 — Integration

> **Solo dev + Claude Code** · Date created: 2026-05-07 · Successor to [SPRINT-1.md](SPRINT-1.md)

**Dates:** TBD start — 21 days later (3-week sprint, longer than Sprint 1's 2-week because integration scope is meatier)
**Team:** Solo (you + Claude Code as your dev pair)
**Sprint Goal:** *Demo end-to-end. Open the ChipForge app, drag oscillator → mixer → output, click Play, hear a chip you designed. The whole pipeline runs from one button click.*

---

## Working Assumptions

| Assumption | Default | Change if... |
|---|---|---|
| Sprint length | **3 weeks** | Want 2 weeks (descope) or 4 weeks (more polish) |
| Availability | **~15–20 focused hours/week** (~45–60 hrs total) | Different |
| OS | **Windows 11 + WSL2** | n/a |
| Tech stack | **Electron + React + TS frontend, Python + Migen/LiteX backend** | n/a |
| Tracking method | **Git commits + this `SPRINT-2.md` log** | Want issues / GitHub Projects |

---

## Sprint Goal — concrete demo target

After Sprint 2:
1. Open the ChipForge app
2. See the 3 demo blocks pre-wired (Oscillator → Mixer → Output) — same UI as Sprint 1
3. Click a new **Play** button in the toolbar
4. ~3-second loading state visible
5. Hear a 2-second tone come out of the speakers — the actual chip simulation, not pre-recorded
6. (Bonus) Edit a block parameter (e.g., Oscillator frequency), press Play again, hear the change

That is the "wow" moment. Everything in this sprint serves that demo.

---

## Capacity (solo)

| Person | Available | Allocation | Notes |
|---|---|---|---|
| You | ~45–60 hrs over 3 weeks | Plan to 70% = **30–42 hrs** committed | Bigger sprint, more risk — leave buffer |
| **Total** | **45–60 hrs** | **~36 hrs of committed work, rest is buffer** | |

---

## Sprint Backlog

| Pri | Item | Est | Owner | Dependencies |
|---|---|---|---|---|
| **P0** | **1. Electron ↔ Python IPC bridge** — main process spawns `wsl python3 <script>`, reads stdout / output WAV. Renderer ↔ main IPC channel `chip:simulate` taking graph JSON, returning WAV path. Handle stderr / errors / timeouts. | 4–6 hrs | Claude Code | None |
| **P0** | **2. Python implementations of 3 demo blocks** — `backend/blocks/oscillator.py` (square wave at given freq), `backend/blocks/mixer.py` (adds 2 signals), `backend/blocks/output.py` (captures to WAV). Migen modules. Individually testable. | 4–6 hrs | Claude Code | None |
| **P0** | **3. Graph → Migen translator** — `backend/translate.py` reads graph JSON (nodes + edges from React Flow), generates a Migen testbench composing the right blocks with the right wiring. Topological order; map source/target handles to module ports. **Hardcoded for the 3 demo block types in v1** (no general extensibility yet). | 6–8 hrs | Claude Code | Item 2 |
| **P0** | **4. "Play" button in UI** — adds button to toolbar next to Save/Load. Click → exports graph → IPC to Python → wait for WAV → play it (embed in `<audio>` element or invoke OS player). | 3–4 hrs | Claude Code | Items 1, 3 |
| **P0** | **5. Loading + error states** — spinner during simulation. Error toast with Python's stderr if it fails. Success indicator when audio is ready. Cancel button if simulation hangs. | 2–3 hrs | Claude Code | Item 4 |
| **P0** | **6. WSL2 ↔ Windows path handling** — convert `C:\...` to `/mnt/c/...` for WSL invocation. Pass paths cleanly. WAV output written to a known location both sides can see. | 2–4 hrs | Claude Code | Item 1 |
| **P0** | **7. End-to-end demo** — fresh launch, drag blocks, press Play, hear sound. Document rough edges in this Sprint Log. | 2–3 hrs | You + Claude Code | Items 1–6 |
| **P0** | **8. Sprint log + retrospective** | 1–2 hrs | You | All |
| P1 | **9. Block parameter editing** — change Oscillator frequency via UI, press Play, hear the new freq | 3–5 hrs | Claude Code | Items 2, 4 |
| P1 | **10. More than 3 blocks** — add Triangle Wave, Sawtooth, ADSR Envelope to the library | 4–8 hrs | Claude Code | Item 2 |
| P1 | **11. Save/load full project** — graph + last audio output cached | 2–3 hrs | Claude Code | Item 4 |
| P2 | **12. Live waveform preview during edit** | 4–6 hrs | Claude Code | All P0 |
| P2 | **13. Stereo / multi-track output** | 4–6 hrs | Claude Code | All P0 |
| P2 | **14. Cleanup carryover from Sprint 1** — `npm audit fix` for safe vulnerabilities, decide on `electron-builder.json` fate | 1–2 hrs | You + Claude Code | None |

**Planned committed work**: ~24–36 hrs of P0 (roughly capacity at 70% load) · **Sprint Load**: ~50–80%

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Electron ↔ WSL2 IPC is finicky** — calling `wsl.exe` from a packaged Electron app, handling stdin/stdout, dealing with line-ending differences | Could chew 4–8 hours of unexpected debugging | Prototype IPC standalone first (`wsl python3 -c 'print(1)'` and verify), then build up |
| **Translator scope creep** — "real" translator needs arbitrary block library, parameter passing, port type checks, error reporting. Full scope is huge | Sprint slips | For Sprint 2, **hardcode the 3 demo blocks**. Don't generalize yet. Generalization is a Sprint 3+ concern |
| **Performance** — Migen simulation takes seconds; total Play-to-audio loop might feel sluggish | Bad UX | Async with clear loading state. If > 5 seconds, profile. Acceptable for v1 if visible feedback exists |
| **Cross-boundary path bugs** (Windows ↔ WSL2) | Subtle, hard to debug | Be explicit. Always convert paths. Test paths with spaces |
| **Solo + non-technical reliance on Claude Code** for the IPC + translator code (the technical core) | If Claude Code struggles, sprint slips | Break each item into smaller pieces. Verify each piece works before the next. Keep commits small |
| **Burnout** — Sprint 1 was a big day | Quality drops, motivation drops | Take a break before starting Sprint 2. Acknowledge the win |

---

## Definition of Done (per item)
- [ ] Code committed to git with a clear commit message
- [ ] Demoable to yourself with one or two commands
- [ ] This `SPRINT-2.md` has a 1-paragraph entry in the Sprint Log
- [ ] You understand at a high level what it does

---

## Key Dates

| Day | Event |
|---|---|
| Day 1 | Sprint starts — IPC bridge groundwork (Item 1) |
| Day 5 | Mid-sprint check-in #1 — IPC working? Python blocks working? |
| Day 10 | Mid-sprint check-in #2 — translator producing valid Migen code? Play button wired? |
| Day 15 | E2E demo target — drag, press Play, hear sound |
| Day 18–21 | Polish, P1 stretch, retro |

---

## Sprint 2 → Sprint 3 transition

If Sprint 2 succeeds, you should be able to say:
- ✅ I have a desktop app where I drag blocks and hear chips I designed
- ✅ The graph → simulation → audio pipeline runs from one button click
- ✅ I understand how to add new blocks to the system

**Sprint 3** would be: **AI consultant integration** (the chat sidebar that knows the block library and helps users plan/design), plus **broaden the block library** (more audio blocks: triangle, saw, ADSR, filter), plus **basic save/load of full projects**. Targets the "8-bit Sound Chip Demo" v1 milestone from the PRD.

---

## Sprint Log

> Fill this in as you go. One paragraph per completed item. Be honest about what didn't work — that's where the value is.

### Item 1 — Electron ↔ Python IPC
*[fill in when complete]*

### Item 2 — Python block implementations
*[fill in when complete]*

### Item 3 — Graph → Migen translator
*[fill in when complete]*

### Item 4 — Play button
*[fill in when complete]*

### Item 5 — Loading + error states
*[fill in when complete]*

### Item 6 — Path handling
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

**What changes Sprint 3:**
*[fill in]*
