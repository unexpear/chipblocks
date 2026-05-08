# Sprint Plan: Sprint 2 — Integration

> **Solo dev + Claude Code** · Date created: 2026-05-07 · Successor to [SPRINT-1.md](SPRINT-1.md)

**Dates:** TBD start — 21 days later (3-week sprint, longer than Sprint 1's 2-week because integration scope is meatier)
**Team:** Solo (you + Claude Code as your dev pair)
**Sprint Goal:** *Demo end-to-end. Open the ChipBlocks app, drag oscillator → mixer → output, click Play, hear a chip you designed. The whole pipeline runs from one button click.*

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
1. Open the ChipBlocks app
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
**✓ Done — 2026-05-07.** Full bridge working end-to-end. Click Play in the toolbar → renderer calls `window.chipblocks.synth({nodes, edges})` → main spawns `wsl.exe -d Ubuntu -- python3 <wsl-path> --in <graph.json> --out <out.wav>` → script reads JSON, writes WAV → main reads WAV bytes via `fs.readFile`, sends back as ArrayBuffer over IPC → renderer creates a Blob URL and plays via `<audio>`. **Manually verified by clicking Play in the running app — heard the 440 Hz tone.** Patterns: `spawn` (never `exec`/`shell:true`), argv as array, `WSLENV=PYTHONIOENCODING/u:PYTHONUNBUFFERED/u`, JSON-on-stderr error parsing, 30s kill timeout. Implementation in `frontend/electron/main/ipc.ts`. **Items 4 (Play button) and 6 (Windows ↔ WSL path translation) closed in the same change** since they were tightly coupled. **Item 5 (loading + error states) partially done** via the inline `.toolbar-status` text — full spinner + toast UX still TODO.

### Item 2 — Python block implementations
**✓ Done — 2026-05-07.** Wrote three Amaranth `Elaboratable` classes in `backend/blocks/`:
- **`Oscillator`** (`oscillator.py`) — square-wave source. `freq_hz` + `sample_rate` parameters; output port `audio-out`.
- **`Mixer`** (`mixer.py`) — 2-input XOR mixer. Input ports `in-1`, `in-2`; output port `mix-out`. Combinational only (no `sync` domain).
- **`Output`** (`output.py`) — audio sink. Input port `audio-in`. No internal logic; the simulation harness samples `audio_in` to produce the WAV.

Each block exposes `input_ports` / `output_ports` dicts keyed by the React Flow handle id strings — this is the contract the Item 3 translator will consume to wire blocks together. Module-level `BLOCK_REGISTRY` in `blocks/__init__.py` maps graph node `type` strings to block classes.

**Switched Migen → Amaranth** while we were here. Amaranth 0.5.8 is the modern successor by the same maintainers (M-Labs); both BSD-2-Clause so licensing posture is unchanged. Cleaner API: `class X(Elaboratable)` + `def elaborate(self, platform)`, `m.d.sync` / `m.d.comb`, `with m.If(): ...` `with m.Else(): ...`. Updated `synth_stub.py` to use the new `Oscillator` block instead of an inline Migen `_SquareOsc` — same 176KB WAV output, verified manually.

Smoke tests in `backend/sim/test_blocks.py`: Oscillator (200 samples, 4 transitions = ~441Hz pattern), Mixer (XOR truth table matches), Output (passthrough verified). All PASS. **Gotcha logged**: Mixer + Output are purely combinational so their tests use `await ctx.delay(1e-9)` instead of `await ctx.tick()` (no sync domain to tick).

### Item 3 — Graph → Amaranth translator
**✓ Done — 2026-05-07.** Wrote `backend/synth.py` (`GraphTop` class + `synthesize()` + `write_wav()`). Replaces the earlier `synth_stub.py` (deleted). Architecture per the audit recommendation: **runtime composition, no codegen.** The translator reads the React Flow graph JSON, instantiates blocks from `BLOCK_REGISTRY` by `node.type`, and connects edges via `m.d.comb += tgt.input_ports[handle].eq(src.output_ports[handle])`. The first `Output` block found in the graph becomes the audio sink. Per-block parameter mapping is centralized in `_build_params()` (currently: oscillator's `data.freq` → `freq_hz`).

Updated `frontend/electron/main/ipc.ts` to point the spawn at `synth.py` instead of `synth_stub.py`.

Smoke tests in `backend/sim/test_synth.py`: 5 cases all PASS:
- **simple** (osc → mix.in-1 → out): 882 transitions in 1 sec = 440 Hz × 2 transitions/cycle ✓
- **direct** (osc 220Hz → out): 441 transitions = 220 Hz × 2 ✓
- **two-osc XOR** (440 + 660 → mix → out): 2165 transitions, complex waveform ✓
- **invalid: no Output block** → raises `ValueError("Graph has no Output block — nothing to sample.")` ✓
- **invalid: unknown block type** → raises `ValueError("Unknown block type: 'wat-is-this'. Known types: ['mixer', 'oscillator', 'output'])` ✓

Manual verification: ran `synth.py` with the IPC-payload-style graph (osc → mixer → output) and got a valid 176 KB / 2-second WAV. The full chain (React click → Electron IPC → wsl python3 synth.py → graph → Amaranth → WAV → blob URL → Audio play) is now wired end-to-end. **Item 7 (E2E demo verification) only requires a Play click in the running app to confirm.**

Edge cases handled:
- React Flow node ids with dashes get sanitized to valid Python identifiers (`block_xxx_yyy`) for `m.submodules`.
- Edges referencing missing nodes are skipped (rather than erroring) so the user can have orphan edges in flight while editing.
- Invalid handle names produce errors with the available alternatives listed.

### Item 4 — Play button
**✓ Done — 2026-05-07** (alongside Item 1). Button appears in the toolbar between the title and Save/Load. While in flight, button label flips to "Synthesizing…" and is disabled. Status text shown left of buttons (`Synthesizing…` → `Playing (172 KB)` → cleared on next click).

### Item 5 — Loading + error states
*[fill in when complete]*

### Item 6 — Path handling
**✓ Done — 2026-05-07** (alongside Item 1). `winToWsl()` in `frontend/electron/main/ipc.ts` converts `C:\foo\bar` → `/mnt/c/foo/bar` via regex on the drive letter + slash flip. The renderer never sees WSL paths — main translates on the way in (script + JSON + WAV paths) and reads the WAV via `fs.readFile` on the Windows path. Tested end-to-end with a temp dir under `%TEMP%\chipblocks-XXXXXX\` containing graph.json + out.wav.

### Item 7 — E2E demo
**✓ Done — 2026-05-07.** Full demo verified by hand in the running Electron app. Sequence confirmed end-to-end:
1. Click ▶ Play → status flips to spinner + "Synthesizing…" + Cancel button appears
2. ~3 seconds total (synth + playback): Electron main spawns `wsl python3 synth.py`, the script reads the IPC-supplied graph JSON, instantiates Oscillator + Mixer + Output blocks from `BLOCK_REGISTRY`, wires their ports per the React Flow edges, runs the Amaranth simulation, writes a 176 KB WAV
3. Status flips to "Playing (172 KB)" and the 440 Hz tone plays through the speakers
4. Cancel mid-synth: kills the wsl python3 process, clears UI, no error toast (cancellation isn't an error)
5. Block positions on the canvas don't matter — only wiring drives the audio (verified by dragging blocks before pressing Play)

**Item 7 closed; the wow demo works.** This is the moment Sprint 2 was designed around.

### Item 8 — Sprint retrospective
**✓ Done — 2026-05-07.** Filled in below. Sprint 2 closed; Sprint 3 plan TBD.

---

## Retrospective (end of sprint)

**What went well:**
- **Research agents pulled real weight again** — the Electron + WSL + Python IPC research delivered the entire `spawn('wsl.exe', [...])` + WSLENV + temp-file + JSON-on-stderr cookbook before I wrote a single line. Item 1 worked first try because of it. Same for the HDL audit agent that recommended Amaranth + runtime-composition; we ate both recommendations.
- **The IPC bridge ran first attempt.** No debug pass needed. That was the biggest unknown of the sprint and it just worked.
- **Migen → Amaranth swap was nearly free.** Same author, same license (BSD-2), and Amaranth's API is genuinely cleaner. Got the swap in mid-sprint without delaying anything.
- **Runtime composition > codegen** for the translator. We don't generate Migen/Amaranth source code; we instantiate block classes at simulation time and wire them via `m.d.comb`. ~150 lines of `synth.py` does the whole job. Codegen would have been many times more code and much more fragile.
- **All 5 translator smoke tests passed on first run.** The block-library contract (`input_ports` / `output_ports` dicts keyed by React Flow handle ids) made the translator cleanly mechanical.
- **Sprint 2 finished in one session.** Original plan was 3 weeks at ~15 hrs/week; actual was a single focused day. Solo + Claude Code + good research up front is fast.
- **License-policy lockdown landed cleanly mid-sprint** (the user-driven cleanup): permissive-only stance documented in PRD/CLAUDE/CREDITS without disrupting any sprint work.

**What didn't:**
- **Amaranth's testbench API needed `ctx.delay()` for combinational-only blocks**, not `ctx.tick()` — `add_clock("sync")` errors when no `sync` domain exists. Caught it on first test run; quick fix. Worth documenting in the block-author docs whenever those exist.
- **No real visual polish on the spinner / toast.** Functional, but not beautiful. Sprint 3 polish if we feel like it.
- **15 npm vulnerabilities still unaddressed** (carried from Sprint 1). Mostly transitive, low real risk; defer until we're closer to public release.
- **No tests for the Electron main IPC layer.** The Python translator is well-tested (test_synth.py), but `ipc.ts` (path translation, spawn args, error parsing) is verified only by the live demo. Worth adding unit tests in a future sprint.

**What surprised me:**
- **Amaranth 0.5.8 is on PyPI** and installable directly via `pip install --user --break-system-packages amaranth`. No litex_setup-style heavyweight install needed.
- **Amaranth's `Simulator.add_testbench` async pattern** is much nicer than Migen's generator-based testbenches. `await ctx.tick()` reads naturally; `samples.append(ctx.get(signal))` is obvious.
- **The full graph → audio pipeline survived first contact with reality with zero bugs.** I expected at least one round of "the WAV is silent" or "ports aren't wiring." Got neither.
- **The runtime-composition pattern means the translator is also the simulator harness** — there's no intermediate code-generation stage to debug. The whole thing fits in one mental model.
- **Cancellation worked first try.** Module-level `currentProc` + `wasCancelled` flag + SIGKILL was enough; no need for AbortController or per-request id maps yet.

**What changes Sprint 3:**
- Sprint 3 = **AI consultant integration** + **broader block library** + **project save/load improvements**. Specifically:
  - Chat sidebar that knows the block library (`BLOCK_REGISTRY` + per-block port specs) and the current canvas state (nodes + edges JSON), powered by BYOK Claude/GPT API
  - More audio blocks: triangle wave, sawtooth, ADSR envelope, low-pass filter, sample-and-hold — each a small Amaranth `Elaboratable` matching the existing port-dict contract
  - Block parameter editing in the UI (the deferred Sprint 2 P1 #9): change Oscillator freq → press Play → hear the change
  - Extend save/load to include cached audio output (so reloading a saved project doesn't require re-synth)
- Carry forward: npm audit cleanup, IPC unit tests, spinner/toast visual polish.
- The whole product is now demoable. Sprint 3 starts to make it _useful_.
