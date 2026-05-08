# Sprint Plan: Sprint 6 — FPGA bitstream output

> **Solo dev + Claude Code** · Date created: 2026-05-08 · Successor to [SPRINT-5.md](SPRINT-5.md)

**Dates:** TBD start — 28 days later (4-week sprint — bigger than the usual 3 because the toolchain is new ground)
**Team:** Solo (you + Claude Code as your dev pair)
**Sprint Goal:** *Produce a `.bin` bitstream from the current canvas that, when flashed to a real iCE40 dev board, plays the audio. The first time ChipBlocks output runs on real silicon — the [PRD Phase-2 milestone](PRD.md).*

---

## Working Assumptions

| Assumption | Default | Change if... |
|---|---|---|
| Sprint length | **4 weeks** (longer — new toolchain) | Want shorter / longer |
| Availability | **~15–20 focused hours/week** (~60–80 hrs total) | Different |
| Stack | unchanged from S5 | n/a |
| FPGA board | **Lattice iCEstick (iCE40HX-1k)** for v1 | A different board you actually own |
| Toolchain distribution | **OSS CAD Suite** (YosysHQ's all-in-one tarball) | Want to apt-install individual tools |
| Tracking | Git commits + this `SPRINT-6.md` log | Want issues |

---

## Sprint Goal — concrete target

After Sprint 6:
1. Build a basic graph (Oscillator → Output) on the canvas
2. Click a new **🔧 Build for FPGA** button in the toolbar
3. ~30–60 seconds of synthesis + place-and-route
4. Toast: "iCE40 bitstream ready (4.2 KB)"
5. Click Download → get a zip containing the `.bin` file, the generated Verilog source, the constraint file, and a README explaining how to flash via `iceprog`
6. (Bonus, with a real iCEstick on hand) `iceprog chipblocks.bin` → solder a pin to a speaker → hear the chip on real silicon

---

## Why iCE40 / iCEstick first

- **Fully open toolchain**: Yosys (synth) + nextpnr-ice40 (place-and-route) + icestorm (icepack/iceprog) — all permissively licensed (ISC). No vendor IP. No NDA. No closed-source tools in the build chain.
- **Cheap dev boards**: iCEstick is ~$30 and includes a USB-flashable iCE40HX-1k chip + onboard 12 MHz oscillator + 8 user GPIO. Good enough for audio at a kHz-level output rate.
- **Well-documented**: every step of the OSS chip-design ecosystem grew up around iCE40. Tutorials, reference designs, and pinout files are plentiful.
- **Amaranth's iCE40 platform support** is mature — the framework can target iCE40 directly via `amaranth.vendor.lattice.IcestickPlatform`-style classes, handling clock, reset, pin assignments.

A future sprint can target ECP5 (also fully open), Xilinx 7-Series (semi-open via prjxray), or a Tiny Tapeout submission package. iCEstick is the right v1.

---

## Capacity (solo)

| Person | Available | Allocation | Notes |
|---|---|---|---|
| You + Claude Code | ~60–80 hrs over 4 weeks | Plan to 70% = **42–56 hrs** committed | Largest sprint to date; new toolchain risk; leave generous buffer |

---

## Sprint Backlog

| Pri | Item | Est | Owner | Dependencies |
|---|---|---|---|---|
| **P0** | **1. Install + verify the OSS FPGA toolchain in WSL2** — download the YosysHQ OSS CAD Suite tarball, extract to `~/oss-cad-suite/`, source its environment, verify `yosys --version`, `nextpnr-ice40 --version`, `icepack -v`. Document the install path in `backend/README.md`. | 2–4 hrs | You + Claude Code | None |
| **P0** | **2. Generate Verilog from the canvas** — `synth.py` (or a new `build.py`) reads a graph, instantiates the same blocks as the audio path, but instead of running them in the simulator, emits Verilog via `amaranth.back.verilog.convert()`. Smoke test: any graph produces a parseable Verilog file. | 4–6 hrs | Claude Code | Item 1 |
| **P0** | **3. Wrap the design for the iCEstick** — top module that maps the graph's audio output to a board pin, hooks the 12 MHz onboard clock to the design's sync domain, and produces a sample at audio rate via a clock divider. Include a constraint file (`.pcf`) listing pin assignments. | 4–6 hrs | Claude Code | Item 2 |
| **P0** | **4. Synthesis + place-and-route + bitstream** — Python orchestration that chains Yosys (`synth_ice40 -json`) → nextpnr-ice40 (`-p board.pcf --asc out.asc`) → icepack (`out.asc out.bin`). Surface stderr + warnings cleanly so the user sees "your design uses 22% of the LUTs"-style feedback. | 6–10 hrs | Claude Code | Items 1, 3 |
| **P0** | **5. UI: 🔧 Build for FPGA button** — toolbar button next to ▶ Play. Click → IPC call to `build:ice40` → main process runs the chained pipeline (it's slow, so async with progress events) → on success, returns a zip URL → renderer prompts download. Reuses the spinner / cancel / error-toast UX from Sprint 2. | 4–6 hrs | Claude Code | Items 2–4 |
| **P0** | **6. Download bundle** — the zip contains: `chipblocks.bin` (the bitstream), `chipblocks.v` (the generated Verilog source for transparency), `chipblocks.pcf` (the constraint file), `BUILD.md` (auto-generated build report: utilization, timing, target board), `FLASH.md` (`iceprog chipblocks.bin` instructions plus a warning that the user must install `iceprog` separately and have an iCEstick connected). | 2–3 hrs | Claude Code | Items 4, 5 |
| **P0** | **7. End-to-end demo** — drag-build an Oscillator → Output graph, click Build for FPGA, get a 4 KB-class `.bin` in the zip, verify the Verilog source compiles cleanly when fed back through Yosys. The "real silicon" verification (actual flashing + audio out a speaker) requires the user to own an iCEstick; document as the final manual gate. | 2–3 hrs | You + Claude Code | Items 1–6 |
| **P0** | **8. Sprint retrospective** | 1–2 hrs | You | All |
| P1 | **9. Cached audio output in save format** (carryover from S4 + S5) | 3–4 hrs | Claude Code | None |
| P1 | **10. IPC layer regression test** (carryover from S3 + S5) | 2–4 hrs | Claude Code | None |
| P1 | **11. Build-report visibility in the chat panel** — when the AI asks "will this fit on an iCEstick?", a new tool `query_last_build` returns the last build report (utilization, timing, errors). Lets the consultant talk about hardware fit. | 3–5 hrs | Claude Code | Items 4–6 |
| P2 | **12. Second board target** — TinyFPGA BX (more common hobbyist board) or iCE40-HX8K-EVB. Mostly different `.pcf`. Don't ship in S6. | 2–4 hrs | Claude Code | Items 3, 4 |
| P2 | **13. Tape-out package output** — Tiny Tapeout submission shape. Real ASIC silicon (GF180 or SkyWater 130). Big lift; deserves its own sprint. | — | — | All |

**Planned committed work**: ~25–40 hrs of P0 (well under capacity at the 4-week budget) · **Sprint Load**: ~50–65%

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Toolchain install eats time** — OSS CAD Suite is ~700 MB; WSL2 download speeds vary; SHA verification optional but recommended | Item 1 slips into Day 2 | Time-box to 4 hours; if it stalls, fall back to apt-installed `yosys` + `nextpnr-ice40` + `fpga-icestorm` (older versions but functional) |
| **Amaranth `IcestickPlatform` doesn't support our 8-bit audio bus directly** — the framework handles 1-bit GPIO out of the box; mapping a signed(8) onto a single PWM pin may need a custom toplevel wrapper | Item 3 needs a small DSP shim (PWM modulator) | Use a 1-bit PWM output from a digital comparator: high N samples / low (period - N) samples per cycle, where N tracks the audio sample. Same approach as the Sprint-1-era oscillator. Lossy at 8-bit precision, but audible |
| **Place-and-route fails to fit** — iCE40HX-1k has only 1280 LUTs and 8 BRAMs; ADSR + multiple oscillators might tip it over | User can't build | Show utilization in the build report up front. If a graph doesn't fit, the build error is descriptive enough that the AI consultant can read it and suggest simplifications |
| **iCEstick flashing requires `iceprog` + a USB-connected board** — neither of which we ship | User can't actually verify on real silicon without separate setup | Document clearly in `FLASH.md`. The bitstream output is still useful for community sharing / submission to fab services even without a personal iCEstick |
| **Audio-rate clocking on a 12 MHz FPGA** — naive synth emits one sample per FPGA tick, which would be ~12 MHz audio. Need a divider down to 44.1 kHz | Audio sounds wrong on real silicon | Add a sample-rate divider in the iCEstick wrapper module; treat sample rate as a build-time constant the FPGA pipeline divides into the FPGA clock |

---

## Definition of Done (per item)
- [ ] Code committed to git with a clear commit message
- [ ] Demoable to yourself with one or two commands
- [ ] This `SPRINT-6.md` has a 1-paragraph entry in the Sprint Log
- [ ] You understand at a high level what it does

---

## Key Dates

| Day | Event |
|---|---|
| Day 1–3 | Items 1 + 2 (toolchain install, Verilog generation) |
| Day 4–7 | Item 3 (iCEstick wrapper + .pcf) |
| Day 8–14 | Item 4 (synthesis chain) |
| Day 15–18 | Items 5 + 6 (UI + download bundle) |
| Day 19–22 | Item 7 (E2E) + P1 stretch (cached audio, IPC tests) |
| Day 23–28 | Polish, retrospective |

---

## Sprint 6 → Sprint 7 transition

If Sprint 6 ships, ChipBlocks produces real-silicon-ready bitstreams. **Sprint 7 candidates:**

- **Tiny Tapeout submission package** (PRD's other Phase-2 path; produces an actual ASIC). Different from FPGA — submissions go to a fab, return weeks later as a chip in the mail.
- **A second FPGA target** — TinyFPGA BX or HX8K-EVB.
- **First public alpha release** — packaged installers, signed binaries, a proper landing page on `chipblocks.io` (or whatever domain we end up with), Hackaday writeup.
- **Major-version dep upgrades** (Electron 33→38, electron-builder 24→26, vitest 2→4) per [KNOWN-ISSUES.md](KNOWN-ISSUES.md).
- **Auto-layout for the canvas** so the AI's incremental additions don't pile to the right.

---

## Sprint Log

> Fill in as you go. One paragraph per completed item. Be honest about what didn't work.

### Item 1 — Install + verify the OSS FPGA toolchain
*[fill in when complete]*

### Item 2 — Generate Verilog from the canvas
*[fill in when complete]*

### Item 3 — Wrap the design for the iCEstick
*[fill in when complete]*

### Item 4 — Synthesis + PnR + bitstream pipeline
*[fill in when complete]*

### Item 5 — UI: Build for FPGA button
*[fill in when complete]*

### Item 6 — Download bundle
*[fill in when complete]*

### Item 7 — End-to-end demo
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

**What changes Sprint 7:**
*[fill in]*
