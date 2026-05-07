# Sprint Plan: Sprint 1 — Foundations

> **Solo dev + Claude Code** · Date created: 2026-05-07

**Dates:** TBD start — 14 days later
**Team:** Solo (you + Claude Code as your dev pair)
**Sprint Goal:** *Prove the three foundational pieces work in isolation on my machine: a working desktop app shell, a node-graph editor, and a LiteX-driven audio simulation. No integration yet — just confirm each piece is real before I try to glue them together.*

---

## Working Assumptions

| Assumption | Default | Change if... |
|---|---|---|
| Sprint length | **2 weeks** | Want 1-week (faster cadence) or 3-week (slower / more buffer) |
| Availability | **~15–20 focused hours/week** (~30–40 hrs total) | Full-time on it (more) or evenings/weekends (less) |
| OS | **Windows 11 + WSL2** (confirmed by user) | Building in pure Windows or pure Linux |
| Tech stack | **Electron + React + TypeScript + Python (LiteX)** | Want to swap any layer |
| Tracking method | **Git commits + this `SPRINT-1.md` log** | Want issues / GitHub Projects / Linear |

---

## Reference Material

- **[RESEARCH-litex-audio.md](RESEARCH-litex-audio.md)** — Concrete starting point for Items 5 & 6. Use [`litex-hub/fpga_101/lab004/pwm.py`](https://github.com/litex-hub/fpga_101/blob/master/lab004/pwm.py). Pure-Python simulation, no Verilator needed, ~40 LOC for the WAV writer. **Read this before starting Item 5.**

---

## Capacity (solo)

| Person | Available | Allocation | Notes |
|---|---|---|---|
| You | ~30–40 hrs over 2 weeks | Plan to 70% = **21–28 hrs** committed | Leave buffer — first-time setup of LiteX + Electron will eat hours |
| **Total** | **30–40 hrs** | **~24 hrs of committed work, rest is buffer** | |

---

## Sprint Backlog

| Pri | Item | Est | Owner | Dependencies |
|---|---|---|---|---|
| **P0** | **1. Project repo setup** — `git init`, folder structure (`/frontend`, `/backend`, `/docs`), commit initial files (PRD, SPRINT-1, CLAUDE, RESEARCH, .gitignore) | 1–2 hrs | You + Claude Code | None |
| **P0** | **2. Project brief for Claude Code (`CLAUDE.md`)** — summarize the PRD, tech stack decisions, conventions; loaded every Claude Code session so it has context | 1–2 hrs | You + Claude Code | Item 1 |
| **P0** | **3. Electron + React + TypeScript scaffold** — working desktop app that opens a window saying "ChipForge" with a basic React UI; `npm run dev` works | 2–3 hrs | Claude Code | Item 1 |
| **P0** | **4. React Flow demo with 3 nodes** — drag 3 blocks (Oscillator, Mixer, Output), wire them, save/load graph state to JSON file | 3–4 hrs | Claude Code | Item 3 |
| **P0** | **5. LiteX install + run `lab004/pwm.py` (in WSL2)** — install LiteX in WSL2 Ubuntu via official `litex_setup.py`, run the [fpga_101 PWM tutorial example](https://github.com/litex-hub/fpga_101/blob/master/lab004/pwm.py) confirmed by research as our starting design. See **RESEARCH-litex-audio.md**. | 1–3 hrs | You + Claude Code | None (parallel with 3, 4) |
| **P0** | **6. PWM example → playable WAV file** — gut the `lab004/pwm.py` testbench's VCD output. Replace with a ~40-line Python post-processor that samples `dut.pwm` per clock and writes a WAV via stdlib `wave`. PWM at audio rate IS a square wave — design is essentially done. **No Verilator. No FPGA.** See **RESEARCH-litex-audio.md**. | 2–4 hrs | Claude Code | Item 5 |
| **P0** | **7. Sprint log update** — append to this file: what was built, what worked, what didn't, what surprised you. This becomes the brief for Sprint 2 | 1–2 hrs | You | Items 3–6 |
| P1 | **8. Manual graph → LiteX translator (1 case)** — tiny Python script that takes a hardcoded 3-node JSON from item 4 and outputs a Migen/LiteX file that simulates correctly. Just to learn the mapping. | 4–6 hrs | Claude Code | Items 4, 6 |
| P2 | **9. Block schema sketch** — draft what a block definition JSON looks like (ports, parameters, LiteX code template). No code, just the design | 2–3 hrs | You | Item 8 |
| P2 | **10. Verilator standalone test** — confirm Verilator runs from command line in WSL2 and from Python. *Optional for Sprint 1 since the audio path doesn't need it.* | 1–2 hrs | You + Claude Code | None |

**Planned committed work**: ~11–20 hrs of P0 (well under capacity, simplified by audio research) · **Sprint Load**: ~40–60% of available hours

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **LiteX setup** can be finicky even in WSL2 | Could lose 4–8 hours debugging | Have Claude Code script the install with a `setup.sh`. **Fallback**: skip full LiteX, use bare Migen (`pip3 install migen`) per RESEARCH option #2 — still gets you to the WAV output. |
| **You're non-technical** and may get stuck reviewing what Claude Code did | Slowed pace, possible wrong-direction work | Keep this `SPRINT-1.md` log honest — note when you don't understand something so it can be revisited |
| **Scope creep** — temptation to "just connect React Flow → LiteX while I'm at it" | Sprint goal slips | Stick to "isolation first." Integration is Sprint 2's problem, not Sprint 1's |
| **Cross-boundary dev** (Windows host + WSL2 Linux) | File-path / line-ending / permission confusion | Project lives on Windows side at `C:\Users\micha\Desktop\chipzzzd\`. WSL2 accesses it via `/mnt/c/...` (slower but functional). Move into WSL2 home filesystem if performance becomes an issue mid-sprint. |
| **Claude Code regressions / outages** | Dead days | Have a "fallback day" plan: read LiteX docs, watch Tiny Tapeout videos, sketch block schemas on paper |

---

## Definition of Done (solo-adapted)

For each P0 item:
- [ ] Code committed to git with a clear commit message
- [ ] You can demo it to yourself by running one command (`npm run dev`, `python sim.py`, etc.)
- [ ] This `SPRINT-1.md` has a 1-paragraph note in the **Sprint Log** section about what was built and how to run it
- [ ] You understand at a high level *what* it does (not necessarily *how* — Claude Code handles the how)

---

## Key Dates

| Day | Event |
|---|---|
| Day 1 | Sprint starts — items 1, 2, 3 (setup + scaffold) |
| Day 4–5 | Mid-sprint check-in: Are items 1–4 done? If not, why? Recommit or descope |
| Day 8–10 | LiteX work (items 5, 6) — the hardest part |
| Day 12–13 | Documentation, P1/P2 if time |
| Day 14 | Sprint end — review log, decide what Sprint 2 looks like |

---

## Sprint 1 → Sprint 2 transition

At the end, you should be able to say:
- ✅ I have a desktop app that opens
- ✅ I have a node-graph editor I can drag / connect / save
- ✅ I have LiteX producing audible WAV output
- ✅ I understand (roughly) how a graph maps to LiteX code

If those four are true, **Sprint 2 = "wire them together"** — add the translator, integrate, get a single end-to-end "drag oscillator → press play → hear sound" loop working. That's the demo that proves the whole product concept.

---

## Sprint Log

> Fill this in as you go. One paragraph per completed item. Be honest about what didn't work — that's where the value is.

### Item 1 — Project repo setup
**✓ Done — 2026-05-07.** Repo initialized at `C:\Users\micha\Desktop\chipzzzd\`. Initial commit includes PRD.md, SPRINT-1.md, CLAUDE.md, RESEARCH-litex-audio.md, and .gitignore. Folder structure (`/frontend`, `/backend`, `/docs`) will be created when scaffolding starts in Item 3.

### Item 2 — `CLAUDE.md` brief
**✓ Done — 2026-05-07.** Saved at repo root. Loaded automatically by Claude Code in this directory. Captures vision, tech stack, conventions, environment notes (WSL2 for Python tooling), and pointers to PRD.md / SPRINT-1.md.

### Item 3 — Electron + React + TypeScript scaffold
**✓ Done — 2026-05-07.** Scaffolded from `electron-vite-react` boilerplate (MIT, cloned via `degit electron-vite/electron-vite-react`) into `frontend/`. Stack: Electron 33, React 18, TypeScript 5.4, Vite 5.4, Tailwind 3.4. Customized: window title and HTML `<title>` → "ChipForge"; `App.tsx` replaced with minimal landing + counter (HMR proof); removed auto-updater import and call from main process; removed boilerplate `.github/` CI templates, Chinese readme, sample `.txt` configs, and ~14 MB of marketing GIFs. `npm install` completed cleanly, `npx tsc --noEmit` passes. **To run**: `cd frontend && npm run dev` — opens an Electron window titled "ChipForge". Auto-updater UI files (`src/components/update/`, `electron/main/update.ts`) left in place but unused; can clean up later if desired.

### Item 4 — React Flow demo
**✓ Done — 2026-05-07.** Added `@xyflow/react@12.10.2` and built a working node-graph editor in `frontend/src/blocks/`. Three custom block components: **Oscillator** (audio-out), **Mixer** (in-1, in-2 → mix-out), **Output** (audio-in). Initial graph shows the three blocks pre-wired Osc → Mixer → Output. User can drag blocks, drag connections between handles, save the graph as a JSON file (browser download), and load a saved graph back via file input. CSS adjusted (stripped body's `place-items: center` from index.css; imported `@xyflow/react/dist/style.css` globally in main.tsx) so the canvas fills the Electron window. `nodeTypes` is hoisted to module scope per React Flow best practice. `tsc --noEmit` clean. **To run**: `cd frontend && npm run dev`.

### Item 5 — LiteX install + lab004/pwm.py
**✓ Done — 2026-05-07.** Installed in WSL2 Ubuntu (Python 3.12). Migen 0.9.2 and LiteX 2025.12 installed to user-site (`~/.local/`) via `pip3 install --user --break-system-packages` (Ubuntu 24.04's PEP 668 default blocks plain pip without a venv, and `python3.12-venv` requires sudo so we used the user-site escape hatch — works fine for our purposes). Cloned `litex-hub/fpga_101` to `backend/fpga_101/` (gitignored); ran `lab004/pwm.py` and got a 278KB `pwm.vcd` simulation output. Created `backend/README.md` and `backend/setup.sh` so the install is reproducible. **Note**: LiteX CLI tools (`litex_sim`, `litex_term`, etc.) installed to `~/.local/bin/` — not on PATH by default; we don't need them yet.

### Item 6 — PWM example → WAV
**✓ Done — 2026-05-07.** Wrote `backend/sim/pwm_to_wav.py` (~85 lines incl. comments) — adapts the upstream `_PWM` Migen module unchanged but rewrites the testbench to capture `pwm` per cycle, then writes a playable 16-bit mono PCM `.wav` via stdlib `wave` + `struct` (no extra deps). Configured for 2 seconds of 440 Hz square wave at 44100 Hz; `period = SAMPLE_RATE / NOTE_HZ = 100` ticks, `width = period/2` for 50% duty. Generated `pwm.wav` (176 KB, validated as `RIFF / WAVE audio / 16 bit / mono / 44100 Hz` by `file`). **To listen**: open `backend/sim/pwm.wav` in any media player. The WAV file is gitignored (binary output); regenerate with `python3 backend/sim/pwm_to_wav.py` from WSL2.

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

**What changes Sprint 2:**
*[fill in]*
