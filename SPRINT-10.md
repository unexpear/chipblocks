# Sprint Plan: Sprint 10 — Output completeness (multi-target build)

> **Solo dev + Claude Code** · Date created: 2026-05-08 · Successor to [SPRINT-9.md](SPRINT-9.md) · Operational source: [ROADMAP.md](ROADMAP.md) "Next" bucket

**Dates:** 2026-05-08 (single-session sprint — Sprint 9 launch carryforwards still pending user-action)
**Team:** Solo (you + Claude Code as your dev pair)
**Sprint Goal:** *"Full follow-through" on the translator from visual graph to fabricable output. The user picks a target — a home FPGA board to flash, or a Tiny Tapeout submission for real ASIC silicon — and ChipBlocks produces every file needed to send the design where it goes.*

---

## Why now

The user said it directly: *"we need a translator and the full follow through for at least what we cover that means all the files and stuff that would be needed to send it to be manufactured or to add to one of the home versions that you can do it with the desktop machine."*

After Sprint 6 we produced an iCEstick-flashable bitstream — that's *one* home FPGA. After Sprint 9 we had 15 blocks and a polished UI. What we didn't have:
- **Multiple home FPGA targets**. Someone with a TinyFPGA BX (a popular hobbyist board, USB-native, no external programmer) was out of luck.
- **An ASIC manufacturing path**. The PRD's Phase-2 also calls for a Tiny Tapeout submission package — the most accessible "real silicon" route. That's how non-technical makers actually get a custom chip without a $50K budget.

This sprint closes both.

---

## Sprint Goal — concrete target

After Sprint 10:

1. **Three output targets selectable from the Build button**: Lattice iCEstick (existing), TinyFPGA BX (new), Tiny Tapeout (new).
2. **TinyFPGA BX produces a flashable `.bin`** built with the same Yosys → nextpnr-ice40 → icepack chain, just a different chip family (LP8K instead of HX1K), package (CM81 instead of TQ144), clock (16 MHz vs 12 MHz), and a `tinyprog` flash command instead of `iceprog`.
3. **Tiny Tapeout produces a complete submission package** (`chipblocks-tt.zip`): `tt_top.v` wrapper module in TT's `tt_um_*` shape, `chipblocks_user.v` (the user's design), `info.yaml` with project metadata matching the current TT yaml_version 6 schema, `docs/info.md` describing the chip, and a user-facing `SUBMIT.md` with instructions for the next cohort.
4. **Build button is a popover**, not a single button. Each target has a one-line description ("flash with iceprog" / "flash with tinyprog" / "they fab the chip").
5. **The IPC contract is target-aware** — `window.chipblocks.build(graph, target)` instead of the old single-purpose `buildIce40(graph)`.

What we're NOT shipping in Sprint 10:
- **iCEBreaker / Upduino / HX8K-EVB**: more boards is mostly more `.pcf` files; deferred until users ask.
- **OpenLane / SkyWater 130nm full GDSII pipeline**: orders-of-magnitude bigger lift than Tiny Tapeout. Tiny Tapeout *is* the OpenLane/SkyWater path; they run the GDSII generation on their side after submission.
- **eFabless MPW shuttle / IHP / GF180MCU as separate targets**: Tiny Tapeout's flow already reaches Sky130 silicon. Other foundries are post-launch territory.
- **Real silicon flash verification**: still gated on the user owning a TinyFPGA BX or iCEstick.

---

## Capacity

| Person | Available | Allocation | Notes |
|---|---|---|---|
| You + Claude Code | one focused session | n/a | Single-session sprint; agents did most of the heavy lifting. |

---

## Sprint Backlog

| Pri | Item | Owner | Outcome |
|---|---|---|---|
| **P0** | **1. Refactor `build.py` to be board-profile-driven** — turn the iCEstick-specific constants/classes into a `FPGABoard` dataclass; preserve `--target ice40` as backward-compat alias for iCEstick. | Agent B | ✓ Done. Bitstream byte-identical to S6 baseline (32220 bytes for `examples/two-osc-mix.json` on iCEstick). |
| **P0** | **2. Add TinyFPGA BX as a second FPGA board** — LP8K, CM81 package, 16 MHz clock, `tinyprog`-flash instructions. | Agent B | ✓ Done. 135100-byte bitstream — 4.2× larger because LP8K has 6× the LCs. Works through the same Yosys → nextpnr-ice40 → icepack chain. |
| **P0** | **3. Tiny Tapeout submission package** — new `backend/tinytapeout.py` module emitting tt_top.v + chipblocks_user.v + info.yaml + docs/info.md + SUBMIT.md, bundled into `chipblocks-tt.zip`. Targets the current TT yaml_version 6 schema (TTSKY26a / TTGF26a cohorts). | Agent A | ✓ Done. 6187-byte zip with all 5 files. info.yaml round-trips through `yaml.safe_load`; tt_top.v parses through pyslang with zero errors. |
| **P0** | **4. Wire the TT path into `build.py main()`** — the agents independently both touched main(); needed manual integration to dispatch `--target tt` to the new `tinytapeout` module. | Manual | ✓ Done. End-to-end CLI test green: `python3 backend/build.py --in examples/two-osc-mix.json --out-dir /tmp/test --target tt` produces the expected bundle. |
| **P0** | **5. Plumb target through the IPC contract** — rename `window.chipblocks.buildIce40(graph)` → `build(graph, target)`; rename `build:ice40` IPC channel → `build:run` taking `{graph, target}`. Generic enough for the existing FPGA targets + the new TT path + future targets. | Manual | ✓ Done. Renamed in [preload/index.ts](frontend/electron/preload/index.ts), [main/ipc.ts](frontend/electron/main/ipc.ts), and the renderer's window.chipblocks declaration in [App.tsx](frontend/src/App.tsx). |
| **P0** | **6. Build button → target popover** — the toolbar's single "🔧 Build for FPGA" becomes "🔧 Build ▾" with a popover listing the 3 targets, each with a one-line description. Same UX pattern as the Examples popover. | Manual | ✓ Done. Three-entry popover wired into `handleBuild(target)` which calls `window.chipblocks.build(graph, target.id)` and downloads the per-target bundle filename (`chipblocks-fpga-icestick.zip` / `chipblocks-fpga-tinyfpga-bx.zip` / `chipblocks-tt.zip`). |
| **P0** | **7. Update vitest IPC contract tests** for the renamed API and the popover-mediated UI. | Manual | ✓ Done. 6/6 vitest passing in 6.5 s; the build-IPC tests now click the menu, then the iCEstick option, and assert `(graph, 'icestick')` is the call shape. |
| **P0** | **8. Verify nothing else broke** — pytest, vitest, dev server, TS check. | Manual | ✓ Done. 19/19 pytest passing in 62 s; 6/6 vitest passing in 6.5 s; `tsc --noEmit` clean; Vite dev server boots in ~870 ms. |
| **P0** | **9. Sprint retrospective** | Manual | ✓ Done (below). |

---

## Risks (resolved)

| Risk | Outcome |
|---|---|
| Two parallel agents both modify `build.py` (multi-board refactor + TT integration) and last-write wins. | Hit it. Agent B's NotImplementedError stub for `tt` overwrote Agent A's actual dispatch. Fix was a 3-line manual edit to wire `from tinytapeout import build_tinytapeout` into `main()`. Worth knowing for future parallel-agent sprints: provide an explicit API contract between agents and have one agent leave a clean seam, not a stub. |
| TT spec drift (yaml_version, top-module shape, pin layout). | Agent A web-fetched the current spec from `tt10-verilog-template` + `ttsky-verilog-template` (active 2026 cohorts). Targeted yaml_version 6. Confirmed pin layout `ui_in[7:0]`, `uo_out[7:0]`, `uio_in/out/oe[7:0]`, `ena`, `clk`, `rst_n`. Worth re-checking on each tape-out cohort before submission. |
| TT clock-rate mismatch. | **Real outstanding gap** — Agent A flagged that the TT wrapper doesn't currently include a sample-rate divider, so a design baked at 44.1 kHz will sound ~1133× too high when fabbed on a 50 MHz TT die. Documented in code + SUBMIT.md. **Fix before any user actually submits.** Carryforward into S11 or post-launch hotfix. |
| Backwards compat for the `--target ice40` CLI invocation (renderer still passed it as a literal until S10 Item 5). | Preserved as alias to `icestick`; bitstream byte-identical to S6. |

---

## Sprint Log

### Item 1 — Board-profile refactor (Agent B)
**✓ Done — 2026-05-08.** Replaced hard-coded iCEstick constants and `IcestickTop` class with an `@dataclass(frozen=True) FPGABoard` carrying `chip_family` / `package` / `clock_hz` / `clock_pin` / `audio_pin` / `pcf_template` / `flash_md_template`. Renamed `IcestickTop` → `BoardTop(graph, board)`; renamed `build_ice40` → `build_fpga(graph, out_dir, board)`. Bundle filename includes board id (`chipblocks-fpga-icestick.zip`) so multi-target builds in one out-dir don't clobber. Bitstream byte-identical to the S6 baseline.

### Item 2 — TinyFPGA BX (Agent B)
**✓ Done — 2026-05-08.** Added `TINYFPGA_BX = FPGABoard(...)` profile + a `tinyfpga-bx` entry in `--target` choices. Picked GPIO header pin A2 for audio output (unused by the bootloader, accessible from the user-pinned headers). Different FLASH.md template explaining `tinyprog -p chipblocks.bin` instead of iceprog. End-to-end build produces a 135,100-byte LP8K bitstream — 4.2× the iCEstick's 32,220 bytes, expected for the LP8K's larger bitstream layout.

### Item 3 — Tiny Tapeout submission package (Agent A)
**✓ Done — 2026-05-08.** New `backend/tinytapeout.py` exports `build_tinytapeout(graph, out_dir, project_name)` returning a dict of paths. Generates 5 files into `chipblocks-tt.zip` (6187 bytes for `examples/two-osc-mix.json`):

- `tt_top.v` (3694 bytes): wrapper in TT's `tt_um_chipblocks` module shape — `ui_in[7:0]`, `uo_out[7:0]`, `uio_*[7:0]`, `ena`, `clk`, `rst_n`. Drives 8-bit unsigned audio amplitude on `uo_out[7:0]` directly (256 levels, much higher fidelity than the iCEstick's 1-bit PWM). User attaches an external R-2R DAC for analog output.
- `chipblocks_user.v` (3051 bytes): the Amaranth-generated GraphTop, same shape as for the FPGA path.
- `info.yaml` (1042 bytes): yaml_version 6, project metadata + per-pin descriptions. Round-trips through `yaml.safe_load`.
- `docs/info.md` (2474 bytes): How it works / How to test / External hardware sections per TT spec.
- `SUBMIT.md` (3423 bytes): user-facing "what to do with this zip" — points at the current submission portal.

Targeted yaml_version 6 (current 2026 TTSKY26a + TTGF26a cohorts). Verified the Verilog parses cleanly through pyslang (MIT-licensed SystemVerilog parser). Added `pyyaml` to backend deps.

### Item 4 — TT integration into main() (manual)
**✓ Done — 2026-05-08.** Both agents had touched `build.py main()`, last-write-wins meant Agent B's NotImplementedError stub for `tt` overwrote Agent A's dispatch. Manually replaced with:

```python
if args.target == "tt":
    from tinytapeout import build_tinytapeout
    result = build_tinytapeout(graph, out_dir)
    print(f"[build] Tiny Tapeout submission ready: {result['bundle_path']}", flush=True)
    return 0
```

End-to-end CLI test confirmed working.

### Item 5 — IPC contract rename (manual)
**✓ Done — 2026-05-08.** Renamed `window.chipblocks.buildIce40(graph)` → `build(graph, target)` in [preload/index.ts](frontend/electron/preload/index.ts), and the IPC channel `build:ice40` → `build:run` (taking `{graph, target}`) in [main/ipc.ts](frontend/electron/main/ipc.ts). Main-process handler dispatches on target, builds the right `--target` flag for the build.py invocation, and reads the right bundle filename per target (`BUNDLE_FILENAMES` map). 30 s timeout for `tt` (sources-only); 120 s for FPGA targets (PnR can take a while).

### Item 6 — Build target popover (manual)
**✓ Done — 2026-05-08.** Replaced the single "🔧 Build for FPGA" toolbar button with a "🔧 Build ▾" popover (same component pattern as the Examples popover from S9). New `BUILD_TARGETS: BuildTargetOption[]` constant in [App.tsx](frontend/src/App.tsx) defines the three options with labels, descriptions, icons (🔧 for FPGA, 🚀 for TT), and per-target bundle filenames. Click → `handleBuild(target)` → builds, downloads, status text reflects target ("Bitstream ready" vs "Submission ready").

### Item 7 — Vitest update (manual)
**✓ Done — 2026-05-08.** The two build-IPC tests in [test/ipc-contract.test.ts](frontend/test/ipc-contract.test.ts) updated for the new API: mock `build` (not `buildIce40`); click "🔧 Build ▾" then "Lattice iCEstick"; assert call shape `(graph, 'icestick')`. Setup also updated to default-mock `build`. 6/6 tests pass in 6.5 s.

### Item 8 — Verification (manual)
**✓ Done — 2026-05-08.** Backend pytest: 19 passed in 62 s. Frontend vitest: 6 passed in 6.5 s. `tsc --noEmit`: clean. Vite dev server: ready in ~870 ms with no console errors. End-to-end CLI smokes: `--target ice40`, `--target tinyfpga-bx`, `--target tt` all produce the expected bundles.

### Item 9 — Sprint retrospective
**✓ Done — 2026-05-08.** Below.

---

## Retrospective

**What went well:**
- **Two parallel agents handled ~75% of the sprint's coding work in ~10 minutes of wall time.** The board-profile refactor (Agent B) and the Tiny Tapeout submission package (Agent A) are both substantial pieces of work — Agent B touched 1 file with 200+ lines of changes; Agent A wrote a brand-new ~250-line module. Both delivered clean, tested code on the first try.
- **The TT spec research the agent did was thorough and current.** Agent A web-fetched the 2026 cohort templates (tt10/ttsky) rather than relying on training-data. yaml_version 6, the tt_um_* convention, the standard pin layout — all confirmed against live sources.
- **The board-profile refactor is the right level of abstraction.** Adding a third FPGA target later (iCEBreaker, Upduino, HX8K-EVB) is now ~30 lines of dataclass + a `.pcf` template — not a code rewrite.
- **The IPC rename was a 4-file change** (preload, main/ipc, App.tsx declaration, App.tsx call site, plus tests). Cleaner contract: `build(graph, target)` says what it does.
- **Backward compat preserved.** The CLI's `--target ice40` still works as alias for `--target icestick`; the bitstream is byte-identical to the S6 baseline. That keeps the still-running v0.1.0-alpha installer's IPC contract working until the next packaged build.

**What didn't:**
- **Two parallel agents both modified `build.py` and last-write-wins erased Agent A's TT dispatch.** Agent B's "NotImplementedError stub for the parallel agent" approach didn't survive when both were really trying to land working code. The fix was 3 lines but the integration step was an avoidable speed bump. Lesson: when two agents must touch the same file, give one ownership of the file and have the other deliver a separate module + a documented integration patch the first agent applies.
- **TT clock-rate gap is a real correctness issue, not a UX one.** Agent A flagged that the TT wrapper doesn't include a sample-rate divider, so audio designed at 44.1 kHz will be ~1133× too high in pitch on a real TT die at 50 MHz clock. Worth fixing before any user actually clicks submit. Currently documented in code + SUBMIT.md as "rebuild at the cohort's clock rate to retune," but the right fix is to bake a divider into the TT wrapper similar to the iCEstick wrapper.
- **No live silicon verification.** Same as every prior FPGA sprint — gated on the user owning a board (TinyFPGA BX in this case) + the correct toolchain. Bitstream bytes look right but real-flash test is a user gate.
- **Mac/Linux installer build pipeline didn't get exercised.** The CI workflow was added in S9 but no tag has been pushed to test it. Adding two new build targets (TinyFPGA BX, Tiny Tapeout) means the CI's "build" step has more code to run; first tag push will surface anything that broke.

**What surprised me:**
- **The TinyFPGA BX bitstream is 4.2× the iCEstick's** for the same graph. LP8K has 6× the LCs (7680 vs 1280), but the bitstream layout overhead doesn't scale linearly with that. Real-world consequence: the v0.1.0-alpha installer's per-target bundle is bigger when targeting LP8K, but still under 10 KB total for typical graphs.
- **TT's 8-bit parallel out is way better than the iCEstick's 1-bit PWM**, even though it requires more external hardware (R-2R DAC vs RC filter). 256 amplitude levels vs 1-bit duty-cycle modulation. If this gets fabbed and tested on a real TT chip, the audio quality should be a genuine step up from the FPGA path.
- **PyYAML is genuinely useful** for the kind of structured-output tooling we're building. Adding it to backend setup was a one-line config change (BSD-2 licensed, fits the no-copyleft policy, preinstalled in WSL2 Ubuntu 24.04).

**What changes Sprint 11:**
- ~~**Fix the TT clock-rate gap.**~~ **✓ Done in-sprint after the user pushed back: "the output should work in the already output form, the manufacturer should at most just need to quick check and slot it all in."** Closing the gap pulled in deeper research and ended up materially upgrading the TT bundle: 14-file canonical `ttsky-verilog-template` layout (src/, test/, docs/, info.yaml, README, LICENSE, .gitignore, plus a cocotb testbench), `EnableInserter`-based clock-gating in both the TT wrapper AND BoardTop (same bug, both places), `--project-name` CLI flag with auto-slug, info.yaml validated against `tt-support-tools/project_info.py`. Drop-in ready: TTSKY26a closes 2026-05-11 (3 days from sprint close); a user can submit today.
- **Sprint 9 launch carryforwards still pending user-action**: tag v0.1.0-alpha + push installers + screenshots + announcements + GitHub Discussions.
- **More candidate work** per ROADMAP "Next" / "Later":
  - MIDI input + polyphony (the flagship-domain unlock for synth makers)
  - More example graphs that use FM / Multiply / Wavetable
  - Auto-layout for AI-placed nodes
  - vitest 4 + Vite 6 paired upgrade
  - Iceberg / Upduino / HX8K-EVB as additional FPGA targets (each ~30 lines if a user asks)
- **Real-silicon test push** — if you acquire a TinyFPGA BX or iCEstick, that becomes Sprint 11's "real-flash gate."
