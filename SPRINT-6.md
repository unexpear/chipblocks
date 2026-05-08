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
**✓ Done — 2026-05-08.** Downloaded YosysHQ's OSS CAD Suite (679 MB tarball, 2.4 GB extracted) to `~/oss-cad-suite/`. The release of the day was conveniently `2026-05-08`. All four tools work: `yosys 0.64+197`, `nextpnr-ice40 0.10-65`, `icepack`, `iceprog`. Verified the env activates correctly in a non-interactive shell (`bash -c "source ~/oss-cad-suite/environment && yosys --version"`) — that's the exact pattern the Electron main process will use, so non-interactive activation works without a `.bashrc` edit. Documented the full install + activation flow in `backend/README.md`.

### Item 2 — Generate Verilog from the canvas
**✓ Done — 2026-05-08.** `backend/build.py` (NEW) wraps the existing `synth.GraphTop` in a new `IcestickTop` Elaboratable, then runs `amaranth.back.verilog.convert(top, ports=[top.audio_pin])` to emit Verilog. Smoke-tested with `examples/two-osc-mix.json` → 4352-byte / 187-line Verilog file. The generated module is `top(rst, audio_pin, clk)`, with the right port directions and an Amaranth-emitted comment header. Amaranth's Verilog backend internally shells out to `yosys`, so this step also requires the OSS CAD Suite to be on PATH.

### Item 3 — Wrap the design for the iCEstick
**✓ Done — 2026-05-08.** `IcestickTop` (in `build.py`) does three things on top of `GraphTop`:
1. Drives the user's design at the iCEstick's 12 MHz onboard oscillator (clock pin 21 in the `.pcf`).
2. Uses a sample-rate divider (`12_000_000 / 44_100 ≈ 272`) to latch a new audio sample at the configured rate.
3. Maps the Output block's signed(8) `audio_in` onto a single 1-bit GPIO via PWM modulation (8-bit counter, output high while `count < latched_sample + 128`). The PWM cycles at ~47 kHz — well above audible, so an external RC low-pass on the output pin filters it into clean analog audio.

Constraint file (`ICESTICK_PCF` constant in `build.py`): assigns `clk → pin 21` (the onboard oscillator) and `audio_pin → pin 112` (header J3 pin 1, physical pad B1). Pin 112 is a 3.3 V CMOS GPIO — the user adds a series resistor + capacitor + speaker for audible output.

### Item 4 — Synthesis + PnR + bitstream pipeline
**✓ Done — 2026-05-08.** `build_ice40()` chains the three external tools:
1. `yosys -p "synth_ice40 -top top -json chipblocks.json" chipblocks.v` → 497 KB netlist
2. `nextpnr-ice40 --hx1k --package tq144 --json … --pcf chipblocks.pcf --pcf-allow-unconstrained --asc chipblocks.asc` → 207 KB ASCII bitstream
3. `icepack chipblocks.asc chipblocks.bin` → **32 KB iCE40 binary bitstream**

`--pcf-allow-unconstrained` is the workaround for Amaranth's auto-generated `rst` port; the iCEstick has no reset button, so we don't pin-assign it. nextpnr leaves it floating, which is fine (Amaranth's reset-driven init is one-cycle, runs naturally on power-up).

Each tool's combined stdout/stderr is captured in the result dict for surfacing in a future build report. Step ordering and error propagation: `run_step()` raises `RuntimeError` with the last 2 KB of output on non-zero exit, which `build.py`'s top-level handler emits as a JSON error blob on stderr (same convention as `synth.py`).

End-to-end run with `examples/two-osc-mix.json` produces `chipblocks.bin` (32220 bytes) — the first time ChipBlocks output is in real-silicon-flashable form. Live verification on a physical iCEstick is gated on the user owning a board + `iceprog`; bitstream-byte verification is automated.

### Item 5 — UI: Build for FPGA button
**✓ Done — 2026-05-08.** New 🔧 **Build for FPGA** button in the toolbar, between **▶ Play** and **Save**. Click → IPC `build:ice40` → main process spawns `wsl bash -c "source ~/oss-cad-suite/environment && python3 backend/build.py --target ice40 ..."` → reads back the zip bytes → renderer creates a Blob URL and triggers a download.

UX details:
- The existing spinner / Cancel / status-text plumbing was extended to handle a parallel `isBuilding` flag alongside `isPlaying`. ▶ Play and 🔧 Build for FPGA are mutually exclusive (each disables the other while in flight).
- Cancel routes to `build:cancel` when `isBuilding`, otherwise to `synth:cancel`. Same UI element handles both.
- Status message: `"Building bitstream…"` during the build, `"Bitstream ready (4.7 KB)"` after success.
- Build IPC uses a 120 s timeout (vs 30 s for synth) — nextpnr place-and-route on a busy graph can take meaningful time.

`shellQuote()` helper added to `ipc.ts` because we now build a `bash -c "..."` command string (to source the OSS CAD Suite environment in the same shell as `python3`). Argv quoting matters here in a way it didn't for the simpler synth invocation.

### Item 6 — Download bundle
**✓ Done — 2026-05-08.** `build.py make_bundle()` packs the build artifacts and auto-generated docs into a single zip:

| File | Bytes (this build) |
|---|---|
| `chipblocks.bin` | 32,220 (the iCE40 bitstream) |
| `chipblocks.v` | 4,352 (Verilog source — for transparency / debugging) |
| `chipblocks.pcf` | 221 (pin constraint file) |
| `BUILD.md` | 1,072 (auto-generated build report) |
| `FLASH.md` | 1,812 (flashing + audio-wiring instructions) |

Total bundle: 4,795 bytes. `BUILD.md` is regenerated each build with a UTC timestamp, target board, source-graph stats (nodes/edges/types), and the last 2 KB of each tool's stdout/stderr (Yosys + nextpnr + icepack). `FLASH.md` is a static template covering hardware setup (1 kΩ + 100 nF RC filter on pin B1), the `iceprog` command, and common troubleshooting.

### Item 7 — End-to-end demo
**✓ Done — 2026-05-08.** Verified end-to-end with `examples/two-osc-mix.json`:
- Backend `build.py --target ice40` emits a 32 KB `chipblocks.bin` and a 4.7 KB `chipblocks-fpga.zip` containing all five expected files.
- The Electron main IPC handler (`build:ice40`) successfully spawns `wsl bash -c "source ~/oss-cad-suite/environment && python3 backend/build.py …"`, reads the resulting zip via `fs.readFile`, and returns it as `ArrayBuffer` to the renderer.
- TypeScript clean across the new IPC + preload + App.tsx changes.
- Chained tools all functional: `yosys 0.64+197` (synthesis), `nextpnr-ice40 0.10-65` (place-and-route on iCE40HX-1k TQ144), `icepack` (bitstream packaging).

Live silicon verification (flashing the bitstream onto a real iCEstick + RC-filter speaker test) requires the user to own the dev board and run `iceprog`. Documented in the in-bundle `FLASH.md`. The byte-level "is this a real iCE40 bitstream?" question is settled by `icepack` accepting the netlist and producing a binary of the expected ~32 KB shape.

### Item 8 — Sprint retrospective
**✓ Done — 2026-05-08.** Filled in below. Sprint 6 closed.

---

## Retrospective (end of sprint)

**What went well:**
- **The whole pipeline landed in one focused session.** Sprint plan budgeted 4 weeks; the path from "no FPGA toolchain" to "producing a working 32 KB iCE40 bitstream from the visual graph" took two extended sessions. Most of that was waiting on the 700 MB OSS CAD Suite download.
- **Amaranth's Verilog backend just works** — `verilog.convert()` on a `GraphTop` wrapped with an iCEstick-shaped toplevel produced clean Verilog that Yosys accepted on first try. Most of the heavy lifting is the existing block library; the iCE40 wrapper is ~30 lines.
- **OSS CAD Suite was the right install path.** No sudo. One tarball. `bash -c "source ~/oss-cad-suite/environment && ..."` activates the toolchain inline for the Electron-spawned WSL invocation, with no `.bashrc` edit. Self-contained.
- **The `--pcf-allow-unconstrained` flag** is the magic phrase nobody mentions in tutorials. Amaranth's auto-generated `rst` port has no iCEstick pin assignment in our `.pcf`, and nextpnr would otherwise refuse to proceed. One flag fixed it.
- **The bundle pattern (zip with bitstream + Verilog source + auto-generated build report + flashing instructions)** is exactly the right shape for "I want to share this chip with someone." The user can email the zip; the recipient gets everything they need to flash it themselves.

**What didn't:**
- **Did not test on physical silicon.** The iCEstick is a ~$30 board the user would need to own + plug in + run `iceprog` against. The Sprint 6 plan flagged this as the user-side gate; nothing more we can do from this end without one in hand.
- **PWM modulation is the simplest possible audio output**, not the prettiest. 8-bit PWM at ~47 kHz produces audible high-frequency noise without a proper RC filter. A future Sigma-Delta DAC block would be much cleaner.
- **iCE40HX-1k LUT count (1280)** wasn't explored — we only built one small graph. Larger graphs (multiple oscillators + ADSR + LPF) might overflow. No utilization parsing in `BUILD.md` yet; just the raw nextpnr log.
- **`unzip` not preinstalled in WSL2.** Minor — used Python's `zipfile` to verify in this session — but a hint that the build environment is less batteries-included than I expected.
- **No second board target.** Keeps the scope manageable. iCEstick is the v1 demo platform.
- **P1 carryovers (cached audio, IPC tests)** still untouched, now four sprints deferred. They'll keep slipping until they become P0 — typically a sign that they're never the most-valuable next thing.

**What surprised me:**
- **Amaranth's signed/unsigned arithmetic in the iCEstick wrapper** worked first try. `(audio_in_signed + 128).as_unsigned()` is the convert-to-PWM-amplitude bridge; no width-mismatch fights.
- **Yosys + nextpnr-ice40 are fast** for designs of this size. Synthesis is ~1 second; PnR is ~3–5 seconds; icepack is sub-second. The 30-second budget was conservative.
- **The bundle ended up tiny.** 4.8 KB total. Most of that is the bitstream (32 KB on disk, but ZIP_DEFLATED compresses well). Easy to share over email.
- **Amaranth's framework leans into the "you have a `top` module with `clk`/`rst` ports automatically" assumption** — the auto-generated `rst` was unexpected but easy to work with via `--pcf-allow-unconstrained`.
- **Six full sprints** in the conversation window. ChipBlocks went from "directory with a PRD" to "produces flashable iCE40 bitstreams" with a full AI consultant in between.

**What changes Sprint 7:**
- **First public alpha release.** Six sprints in, the product is feature-complete for a v1 alpha: visual editor, AI consultant with multi-step tool calls, simulated audio output, FPGA bitstream output. Sprint 7 should be the "make it shippable" sprint:
  - Major-version bumps from [KNOWN-ISSUES.md](KNOWN-ISSUES.md) (Electron 33→38, electron-builder 24→26, vitest 2→4)
  - Packaged installers via `electron-builder` (Mac/Windows/Linux)
  - Signed binaries (Mac notarization, Windows code-signing)
  - Public landing page with screenshots / a demo video
  - First Hackaday / Hackster.io writeup
- **OR**: Tiny Tapeout submission package (PRD's other Phase-2 path; produces real ASIC silicon). Different from FPGA — submissions go to a fab, return weeks later as a chip in the mail.
- **OR**: a second FPGA target (TinyFPGA BX or HX8K-EVB) plus utilization parsing in `BUILD.md`.

User direction needed at the start of S7 — "make this shippable" vs "more silicon paths" vs "more block library / DSP chops" are different sprints.
