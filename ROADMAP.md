# ChipBlocks Roadmap

> **Last reviewed:** 2026-05-14 (mid-Sprint-24 strategic pivot) · **Format:** Now / Next / Later · **Cadence:** revisit at the end of each sprint
>
> This is the operational "what's next" document. The strategic vision lives in [PRD.md](PRD.md). Per-sprint plans + retrospectives live in [SPRINT-1.md](SPRINT-1.md) through [SPRINT-24.md](SPRINT-24.md) (note: SPRINT-15.md was renumbered to SPRINT-16.md; no file at the SPRINT-15 path). When this roadmap and the PRD disagree, the roadmap is more recent — but big disagreements should trigger a PRD update rather than silently drifting.

---

## Snapshot — where we actually are (2026-05-14)

- **23 sprints completed** + **Sprint 24 in flight at S24-11**, all closed sprints retrospected. Most recent close: Sprint 23 (historical chip-design example library) on 2026-05-12.
- **v0.1.0-alpha.9** is the live public release on the GitHub Release page (42 blocks; cross-platform installers built via `.github/workflows/release.yml`). Master is 6 blocks ahead at 48 (Shifter from S22; VCO + LFO + Audio Sum + VCF + HardSync from S24). No release tag for the master tip yet — a Sprint 24 close-out commit may bump to alpha.10.
- **0 external users** — the PRD's **(E) anyone-but-the-developer-using-it** metric. Capabilities are launch-ready; the gap is still user-action launch posts.
- **48 blocks** on master, **42 on alpha.9**. Adds since the 2026-05-09 snapshot above: Bus Split / Bus Join (S16); Adder / Register / RAM / ROM (S17, ADR-002); Subtractor / Comparator / Mux + Reinterpret (S18); ByteConstant (S19); Register File (S20); Shifter (S22, manifest acid test); VCO / LFO / Audio Sum / VCF / HardSync (S24, audio-modulation family).
- **Bundled examples: 21 in-tree** (+ 1 uncommitted: sync-lead.json). 4 historical-chip examples added in S23 (Atari Punk Console, FM bell, hi-hat, Karplus-Strong); 3 new + 3 revised in S24 (vibrato, filter-sweep, divider-clock-tree; revised Karplus-Strong + Atari Punk Console + vibrato).
- **Tests:** backend pytest **217 + 2 skipped**, frontend vitest **321**. Both suites run on every push to master via CI.

### Sprint 24 mid-sprint pivot (2026-05-14) — captured in [SPRINT-24.md](SPRINT-24.md)

Two project principles introduced after S24-11, reshaping the post-S24 roadmap:

1. **No fake blocks.** Every block in `blocks.yaml` must elaborate to real synthesizable Amaranth HDL. External physical devices (display panels, speakers, antennas, batteries) are chip pads / external connection points, not blocks. We build the controllers + drivers that live on our silicon (ST7789 LCD driver, PWM audio out, OOK transmitter), not the external things themselves.
2. **Modular fab platform** (pending [ADR-005](ADR-005-modular-fab-platform.md), draft pending). Apply the ADR-003 manifest pattern to the fab target itself. Eight extension points, each manifest-driven, each addable as 1 row + 1 adapter: `shuttles.yaml`, `pdks.yaml`, `cpu-cores.yaml`, `radios.yaml`, `buses.yaml`, `memories.yaml`, `packages.yaml`, `flows.yaml`. Third-party tools (eFabless Caravel, OpenLane, SkyWater MPW) are plumbing called via adapters — swappable, not in the trust boundary.

These principles fold directly into the **phone-class target** (smartwatch / 2005-feature-phone equivalent) that the post-S24 sprints work toward.

---

## PRD phase reconciliation

| PRD Phase | Original target | Capabilities | Distribution / discoverability | Notes |
|---|---|---|---|---|
| **Phase 1 — Proof of Concept** | months 1–3 | **Done** (S1–S5) | n/a | 9 blocks + AI sidebar + WAV simulation. Beat the original "7 blocks" bar. |
| **Phase 2 — First External User** | months 3–6 | **Done** (S6–S13) | **Tag pending** | All 4 silicon targets shipping (iCEstick + TinyFPGA BX + iCEBreaker FPGA + Tiny Tapeout ASIC). 42 blocks (vs. 10–15 target), now including the VGA Timing / Color Bars / Pixel Range / Solid Color / VGA Output visual quintet that turns the iCEBreaker into a video chip, the Distortion waveshaper for overdriven synth tones, the Bus Split / Bus Join blocks that bridge cross-width signal connections, the Adder / Subtractor / Comparator / Mux / Register / RAM / Register File / ROM CPU primitives + Counter.addr-out that make the PRD's "tiny CPU on Tiny Tapeout silicon" use case structurally buildable with branching, and the Reinterpret bridge so a CPU-domain accumulator drives audio. Onboarding starter graph + dismissible hint. WCAG 2.1 AA Tier 1 + Tier 2 done. CI + cross-platform release pipeline live. Installer + screenshot in repo. **Last gap:** user pushes the `v0.1.0-alpha` tag + posts the 4 announcement drafts. |
| **Phase 3 — Domain Expansion** | months 6–12 | **Partially started** (Tiny Tapeout + 2nd & 3rd FPGA boards shipped) | Not started | Remaining: second domain (custom MCU or sensor), ECP5/Xilinx FPGA targets. |
| **Phase 4 — Polish & Reach** | months 12–18 | Not started | Not started | Web version, classroom mode, marketplace. |
| **Phase 5 — General-purpose PCB** | months 18+ | Sibling project | Sibling project | Treated as a separate workstream when we get there. |
| **Phase 6 — High-complexity boards** | months 30+ | Sibling project | Sibling project | Likely paid-tier / partnership territory. |

**Phase 2 capability work is done; the bottleneck is the user-action launch gate.** Pushing the tag, posting the announcement drafts, and enabling Discussions are all that stands between the current state and the (E)-metric clock starting.

---

## PRD anti-metrics — current state

These are the four "you have failed" signals from the PRD. Tracking them honestly:

| Anti-metric | Current status | What we need |
|---|---|---|
| AI consultant designs fail validation > ~30% of the time | **Still unmeasured** (no telemetry) | A way to record validation pass/fail across AI-built graphs. Becomes meaningful once external users exist. The S9-planned manual eval script was deferred — cheap to add when there's a reason. |
| New-user time-to-first-working-chip > 4 hours | **Mitigated** | S9 shipped: default starter graph (Oscillator → Output) + dismissible "click ▶ Play to hear it" banner + 7 bundled examples + Help → About modal. The empty-canvas problem is closed. Real measurement still needs external users. |
| Issue tracker dominated by "I can't figure out X" with no clear pattern | **N/A** (no users yet) | Becomes meaningful once (E) starts moving. |
| 6 months in, all designs in the wild are still by the developer | **N/A** (real-time clock has been ~1 day; sprints are compressed-time) | Becomes meaningful once we tag the alpha and start measuring. |

---

## Accessibility workstream (added 2026-05-08)

[ACCESSIBILITY-AUDIT-2026-05-08.md](ACCESSIBILITY-AUDIT-2026-05-08.md) is the canonical reference. 23 findings against WCAG 2.1 AA, tiered:

| Tier | Items | Effort | Status |
|---|---|---|---|
| **Tier 1 — Critical** (4 items) | P2 (input labels), R3+R4 (dialog semantics + focus mgmt), O8 (focus-visible), U1+U5 (live regions) | ~1.5 hrs | ✅ **Done in Sprint 11.** All 4 plus the P1 contrast finding shipped. |
| **Tier 2 — Major** (12 items) | O1 (palette keyboard), O3/O4/O5 (Escape-everywhere), O7 (44px targets), R1 (aria-pressed/expanded), P1 (footer contrast), U3 (param error msgs), R2 (menuitem roles), and a few smaller items | ~4 hrs | ✅ **Done in Sprint 12.** Palette keyboard nav, touch targets, popover arrows, parameter-error announcements all shipped. |
| **Tier 3 — Minor** (7 items) | Block titles as headings, popover arrow-keys, form-wrap, prefers-reduced-motion, etc. | as time allows | **Open.** Pick up incrementally as user-facing UI lands. None block launch. |

**Re-audit triggers**: any new color in `App.css`, new modal/popover, new interactive block, new toolbar button, or before any `v0.2.0+` tag. Schedule manual NVDA + VoiceOver testing before that v0.2 cut — Claude's audit catches ~70% of issues; real AT testing catches the rest.

---

## Tech-debt workstream (added 2026-05-08)

Source: in-conversation tech-debt audit (2026-05-08). 30+ items across code / architecture / test / dependency / documentation / infrastructure debt. Tiered:

| Tier | Items | Effort | Status |
|---|---|---|---|
| **Sprint 11 batch** (5 items, ~1 hr) bundled with the a11y Tier-1 work | C1 (IPC contract centralization), DOC1 (README refresh for multi-target), D1 (pin amaranth + pyyaml), I4 (commit `package-lock.json`), A2 (renderer `ErrorBoundary`); plus I1 (CI workflow exercised) | ~1 hr code + ~5 min infra | ✅ **Done in Sprint 11.** All 5 shipped alongside the a11y Tier-1 work. |
| **Sprint 12 batch** (4 items, ~4 hrs) bundled with whatever Sprint 12's feature work is | C2 (BUNDLE_FILENAMES coordination), C3 (examples/ ↔ examples.ts dedup), T1 (frontend block-component tests, ~10 simple cases), T3 (save/load roundtrip test) | ~4 hrs | ✅ **Done in Sprint 12.** Plus 6 bonus tests via the Sprint 12 audit-fill (51 vitest at the end). |
| **Opportunistic** (~7 items) — only when motivated by a specific friction | A1 (block-manifest refactor — only when block growth slows), DOC2 (ARCHITECTURE.md ✅), DOC5 (BLOCKS.md ✅), C5/C6 (App.tsx/Chat.tsx file splits), T2 (AI agentic loop integration test) | varies | ARCHITECTURE.md shipped in S12; CONTRIBUTING.md in S13; BLOCKS.md added 2026-05-09. The rest stay opportunistic. |
| **Already deferred via [KNOWN-ISSUES.md](KNOWN-ISSUES.md)** | D2 (3 npm advisories), D3 (vitest 4 + Vite 6), D4 (7zip-bin LGPL), npm-audit growth, GitHub Actions Node 20 deprecation | varies | Bundled into a future "deps refresh" sprint. |
| **Sprint 14 batch** (4 backend hygiene + 2 frontend hygiene from the post-multi-domain audits, 2026-05-09) | Centralize `BuildTarget` (commit `1dc97be`), `require_audio_output` → caller-composed validators (`9f2c63a`), explicit reject of mixed audio + visual graphs (`24308fd`), split `BoardTop._elaborate_audio_only` / `_elaborate_vga` (`23391fe`), aria-label backport across all 24 non-visual blocks (`9ed4b9e`), `HANDLE_FIRST_PX` + `HANDLE_SPACING_PX` + `handleTop()` helper (`b4dfb13`) | ~1.5 days as predicted | ✅ **Done in Sprint 14.** All 6 items shipped. The aria-label backport went beyond the audit's named 10 to bring all 24 non-visual blocks to parity with the 3 visual ones — library now at 100% Handle-level a11y coverage. |
| **Multi-domain + manifest deferrals** (post-audit) | Block-manifest auto-discovery, multi-domain clock plumbing, peripheral abstraction, logic-block port-naming asymmetry, VGA 640×480 PLL | varies | All have explicit triggers documented in [KNOWN-ISSUES.md](KNOWN-ISSUES.md). |

**What's deliberately not on the list**: monitoring, distributed tracing, A/B testing, multi-region — building those before there's any user is debt-by-overengineering for a desktop-app alpha.

---

## Done — Sprint 9 through Sprint 13 (closed 2026-05-09)

The Sprint-9 plan ("make v0.1.0-alpha actually shippable") expanded into five sprints of polish + capability work. What shipped:

- **S9** ([retro](SPRINT-9.md)) — Onboarding starter graph + dismissible hint, 6 new blocks (Sine/Noise/Constant/FM/Multiply/Wavetable, taking the count from 9 → 15), Examples submenu, Help→About modal, GitHub Actions CI + cross-platform release pipeline (Win NSIS + Mac DMG + Linux AppImage), 19 backend pytest + 6 frontend vitest. Pre-written release notes + 4 announcement drafts.
- **S10** ([retro](SPRINT-10.md)) — Output completeness: TinyFPGA BX added as a second FPGA target, Tiny Tapeout submission package landed in canonical `ttsky-verilog-template` layout (drop-in ready for TTSKY26a + TTGF26a cohorts), structured BUILD.md utilization parsing.
- **S11** ([retro](SPRINT-11.md)) — Pre-public hardening: WCAG 2.1 AA Critical-tier accessibility (input labels, modal dialog semantics, focus-visible, aria-live), tech-debt batch (IPC types centralized, pinned backend deps, README refresh, package-lock committed, ErrorBoundary), renderer security (Load JSON validation, AI tool-call validation).
- **S12** ([retro](SPRINT-12.md)) — A11y Tier 2 (palette keyboard nav, touch targets, popover arrows, parameter-error announcements), test coverage explosion (6 → 50 vitest), bundle-filename coordination, argv-only build IPC via `wsl-build-wrapper.sh`, ARCHITECTURE.md.
- **S13** ([retro](SPRINT-13.md)) — Block library expansion (Bitcrusher + Delay + Highpass + Bandpass; library now 19 blocks) + CONTRIBUTING.md contributor on-ramp.

The single screenshot for the README (`docs/screenshots/starter-graph.png`) was captured on 2026-05-09 from a fresh-installed unpacked build. Interactive captures (Examples menu open, Build dropdown) were attempted but couldn't be reliably driven by computer-use clicks against the Electron renderer; one good non-interactive shot was kept.

---

## Now — Sprint 25 kickoff (ADR-005 draft + `shuttles.yaml` materialisation)

Sprint 24 is rolling to close. The next sprint opens against the modular-fab principle — write [ADR-005](ADR-005-modular-fab-platform.md) (currently draft pending) along the 8-manifest lines captured in [SPRINT-24.md](SPRINT-24.md)'s mid-sprint pivot, then materialise the first manifest (`shuttles.yaml`) with the existing Tiny Tapeout slot (`tt-pico`) as row 1 — proving the pattern end-to-end on a target we already have, before any new shuttle tier ships.

| Pri | Item | Owner | Effort | Why now |
|---|---|---|---|---|
| **P0** | Draft [ADR-005 — Modular fab platform](ADR-005-modular-fab-platform.md) | Claude + user review | 0.5 sprint | Locks in the 8-manifest extension model + the socket-contract patterns. Without it, every post-S24 block adds extension-point sprawl rather than fitting into a documented slot. |
| **P0** | Materialise `shuttles.yaml` with `tt-pico` as row 1 | Claude | 0.5 sprint | Acid-test the manifest pattern against an existing target before adding new tiers. Mirrors the Sprint 22 Shifter acid test for ADR-003. |
| **P1** | Commit `examples/sync-lead.json` (uncommitted from S24-11 follow-on) | Claude | 5 min | Don't lose the demo example showcasing HardSync. Either lands clean-up in S24 close-out or carries into S25's first commit. |
| **P1** (user) | Decide which radio modulation is the default for the post-S25 silicon path: OOK (lean) vs. audio-FSK (teaching companion) vs. LoRa-CSS (ambitious) | User | 5 min | Affects S31 scope. Recommendation: OOK as default, audio-FSK as a teaching companion that reuses existing blocks, LoRa-CSS deferred. |
| **P2** (user) | Pre-existing launch-gate items still open: post announcements, enable Discussions, submit Hackaday writeup | User | 1 hr total | alpha.9 is on the GitHub Release page; the (E)-metric clock can start whenever the user wants. Not blocking anything technical. |

**Sprint 24 still rolling at S24-11** as of this update. Close-out + retro commit pending; will bump sprint counter to 24 closed at that point.

---

## Done — Sprint 14 (closed 2026-05-09 PM)

Surfaced by the post-multi-domain `/design:design-system` audit + `/engineering:system-design` review run right after v0.1.0-alpha.3 shipped. Six independent commits closing the seams the multi-domain expansion left behind. CI green on every commit; alpha.3 unchanged.

| # | Commit | Item |
|---|---|---|
| 1 | `1dc97be` | Centralize `BuildTarget` union (3 files → 1 canonical declaration) |
| 2 | `b4dfb13` | Extract `HANDLE_FIRST_PX` + `HANDLE_SPACING_PX` + `handleTop()` helper; migrate 10 block components |
| 3 | `9f2c63a` | Replace `GraphTop.require_audio_output: bool` with caller-composed `validate_has_audio_output(graph)` |
| 4 | `24308fd` | Explicit `reject_mixed_audio_and_visual(graph)` in `BoardTop` + renderer pre-Build mirror; new pytest test |
| 5 | `23391fe` | Split `BoardTop._elaborate_audio_only` / `_elaborate_vga` (pure refactor + dead-code removal); both verified end-to-end |
| 6 | `9ed4b9e` | aria-label backport: every Handle in every block (24 files; library now at 100% Handle-level coverage across all 27 blocks) |

Test counts after sprint: pytest **44 passed + 2 skipped** (was 43 + 2; +1 test for mixed-graph reject), vitest **98 passed**, tsc clean.

---

## Done — Sprint 15 through Sprint 24

Ten more sprints landed between the 2026-05-09 roadmap update and the 2026-05-14 strategic pivot. Per-sprint detail in the individual SPRINT-N.md retros. Headline summary:

- **S15** — renumbered into S16; no separate file at the SPRINT-15 path. [ADR-001](ADR-001-multi-bit-bus-types.md) drafted in this slot.
- **S16** ([retro](SPRINT-16.md)) — ADR-001 implementation: typed bus system + BusSplit / BusJoin cross-width composition blocks. 5 of 7 planned items shipped; 2 deferred per mid-sprint tech-debt prioritization.
- **S17** ([retro](SPRINT-17.md)) — [ADR-002](ADR-002-cpu-primitives.md) implementation: 4 CPU primitives (Adder / Register / RAM / ROM) + Counter.addr-out extension. Single-shot parallel-agent dispatch; all 7 tasks in one commit. Surfaced the data-u8 ↔ audio-s8 sign-class barrier as a Sprint 18 candidate.
- **S18** ([retro](SPRINT-18.md)) — 4 new blocks: Reinterpret bridge + Subtractor + Comparator + Mux. Closes both Sprint 17 retro surfacings (audio bridge + conditional-control trio for branchable programs).
- **S19** ([retro](SPRINT-19.md)) — LD-focused accessibility audit ([ACCESSIBILITY-AUDIT-LD-2026-05-10.md](ACCESSIBILITY-AUDIT-LD-2026-05-10.md)) + 6-item trivial-fix cluster (prefers-reduced-motion, volume slider, plain-language AI prompt section, last-build status persistence, GitHub Actions v5/v6 bumps, ByteConstant block 40 → 41).
- **S20** ([retro](SPRINT-20.md)) — Register File block 41 → 42 with independent read/write addresses + cpu-multiregister worked example + LD audit second wave (modal backdrop guard, error-toast 6s → 12s, single-letter label rewrites). Launch drafts repointed to alpha.9.
- **S21** ([retro](SPRINT-21.md)) — [ADR-003](ADR-003-block-manifest.md) implementation: block manifest at repo root + 2 codegen scripts. Per-block hand-edit surface 9 files → 3. +252 dynamic manifest-integrity test cases. First sprint with parallel-agent dispatch at peak (5 agents).
- **S22** ([retro](SPRINT-22.md)) — Manifest acid test (Shifter block 42 → 43 via the new manifest path), cookbook consolidation into [BLOCKS-COOKBOOK.md](BLOCKS-COOKBOOK.md), `registries-aligned.test.ts` deletion (structurally redundant post-manifest), AI prompt scope decision option C.
- **S23** ([retro](SPRINT-23.md)) — Historical chip-design example library: 4 new bundled examples (Atari Punk Console, FM bell, hi-hat, Karplus-Strong) with full licensing-provenance diligence ([OPEN-CHIP-LIBRARY-PROVENANCE.md](OPEN-CHIP-LIBRARY-PROVENANCE.md)) + manufacturing-process technical drawing ([`docs/MANUFACTURING-PROCESS.md`](docs/MANUFACTURING-PROCESS.md)) + AI consultant TOC entry for the open-chip library. No new blocks.
- **S24** ([in flight, log + pivot in SPRINT-24.md](SPRINT-24.md)) — Audio-modulation block family: 5 new blocks (VCO + LFO + Audio Sum + VCF + HardSync, 43 → 48) + 3 new examples + 3 example revisions + sub-1-Hz LFO via `rate_millihz` + HardSync rising-edge phase-reset. **Mid-sprint pivot at S24-11**: introduced the "no fake blocks" principle and the "modular fab platform" direction (8 manifests pending [ADR-005](ADR-005-modular-fab-platform.md)). Phone-class roadmap (S25 → S32) queued.

Block library: alpha.9 = 42 → master = 48 (+6 across S20-S24). Bundled examples: pre-S20 ≈ 12 → 21 in-tree at S24-11 (+1 uncommitted sync-lead.json). Tests: 44+2 pytest → 217+2 pytest; 98 vitest → 321 vitest.

---

## Next (Sprint 25-32 — phone-class roadmap)

Post-S24 strategic pivot direction (captured in [SPRINT-24.md](SPRINT-24.md)'s "Mid-sprint pivot" section). Build toward a fab-able **smartwatch / 2005-feature-phone equivalent** on iCE40 + a handful of external chips (~$30 BOM). Every block synthesizable — no fakery. Fab target manifest-driven per the modular-fab principle.

| Sprint | Theme | New blocks / manifests | Notes |
|---|---|---|---|
| **S25** | ADR-005 draft + `shuttles.yaml` materialisation | `shuttles.yaml` (row 1: `tt-pico` = existing Tiny Tapeout slot) | Acid-tests the manifest pattern against an existing fab target before any new tier ships. Mirrors Sprint 22's Shifter acid test for ADR-003. |
| **S26** | Bus protocols (first wave of synthesizable peripherals) | SPI master, I²C master, UART, GPIO, PWM blocks | Foundation. Unlocks every external-chip driver that follows. |
| **S27** | Display + input | ST7789 LCD driver block, button matrix scanner block, capacitive touch (FT6236) protocol block | Smartwatch-class display + tactile input path. |
| **S28** | Audio out + haptics | PWM audio out (real silicon, not just sim), class-D driver, LED driver, vibration motor driver | Output side. |
| **S29** | ADR-004 packaged CPU + `cpu-cores.yaml` + picorv32 | `cpu-cores.yaml` (row 1: picorv32 wrapper conforming to the CPU socket interface) | The big one. Open ADR question: package the CPU as a single block, or expose primitives + composition? Probably both, with the packaged path as default. |
| **S30** | System glue | Interrupt controller, timer, reset/clock manager | Required to make the CPU + peripherals actually run a program. |
| **S31** | Radio (digital part) | OOK transmitter (default), audio-FSK modem (teaching companion), optional LoRa-style CSS | Default radio choice per user decision (P1 item in "Now" section). |
| **S32** | Toy-phone integration | Example graph wiring all of the above into one fab-able design | First Standard-tile design; first "phone-shaped" demo. |

Eight sprints to a fab-able toy phone. Every block real silicon. Every fab-target row in `shuttles.yaml`.

**Items deferred but not dropped** (carry forward into post-S32 sprints unless user signal pulls them back):

| Item | Effort | Why deferred (not dropped) |
|---|---|---|
| **MIDI input block + polyphony** | 1.5-2 sprints | Was the headline post-alpha.9 next-item in the 2026-05-09 plan. Hobbyist synth-maker reach is real. Slots into the post-phone roadmap as a domain expansion once the phone target ships. |
| **More DSP blocks** (chorus, comb filter, allpass, ring-mod variants) | 1 sprint each | Always 1 sprint apart. Pick by user request. The Sprint 24 audio-modulation family already closed VCO + LFO + AudioSum + VCF + HardSync; remaining DSP candidates fit cleanly when motivation arrives. |
| **More visual blocks** (sprite engine, framebuffer, character generator, SB_PLL40_CORE for 640×480) | 1 sprint each | Visual story is "draw color bars" today; the phone roadmap's ST7789 LCD driver is a meaningful step. Sprite + framebuffer are bigger lifts that need a fixed display target. |
| **Validation telemetry / `eval-ai.ts` measurement baseline** | 0.5 sprint | Same rationale as the original 2026-05-09 listing. Cheap when motivated. |
| **Code-signing certs** | 0.5 sprint config + cost | No external complaints yet; defer until someone trips the SmartScreen warning. |

---

## Later

| Item | Effort | Why later |
|---|---|---|
| **ECP5 + Xilinx 7-Series support** | 1–2 sprints | PRD P0 for full release. ECP5 has fully-open toolchain (Trellis); Xilinx 7-Series is semi-open via prjxray. |
| **Auto-layout for AI-placed nodes** (ELK or dagre) | 0.5 sprint | UX polish; the rightward-jitter heuristic is good enough until users complain. |
| **vitest 4 + Vite 6 paired upgrade** | 0.5 sprint | Bundled deps refresh. The 98-test vitest suite gives us a forcing function; do this when next touching frontend infra. |
| **GitHub Actions Node 20 → Node 24 bump** | 1 hour | `actions/checkout@v4` + `actions/setup-node@v4` + `actions/setup-python@v5` use Node 20 which GitHub deprecates 2026-09-16. Tracked in [KNOWN-ISSUES.md](KNOWN-ISSUES.md). |
| **Block-manifest auto-discovery** (kills the 8-files-per-block cookbook) | 1 sprint | The right-shape refactor is per-block `BLOCK_TYPE` + `PARAM_SCHEMA` + `DESCRIPTION` constants discovered via filesystem glob. Trigger: block #35 OR five consecutive blocks fitting the same shape. Today's block-shape variance (VGA Timing has 5 outputs, Counter has clocked semantics, ADSR has multi-row UI) is too high to freeze. Tracked in [KNOWN-ISSUES.md](KNOWN-ISSUES.md). |
| **Multi-domain clock plumbing** (mixed audio + visual chips) | 1+ sprint | Proper fix to `BoardTop`'s `has_vga` band-aid: explicit `m.d.audio` / `m.d.pixel` `ClockDomain`s with per-block `domain` attribute. Phase-3 deliverable. Trigger: first user who actually wants a chip that sings AND shows. |
| **VGA at 640×480 (PLL configuration)** | 0.5 sprint | Ship 320×240 today via the bare 12 MHz oscillator; 640×480 needs `SB_PLL40_CORE` configured to multiply 12 MHz → 25.175 MHz. Roadmap when a user wants higher resolution. |
| **Cached audio in save format** (carryforward) | 0.5 sprint | **Dropped.** Long stale. Workaround: include a `.wav` alongside the `.json` when sharing. If a user complains, promote. |
| **Reverb block** | 1 sprint | iCE40HX-1k has only 8 BRAMs; quality reverb is BRAM-bound. Revisit when we have a higher-end FPGA target with more memory. |
| **Web version** | 4–6 sprints | PRD P1. Big lift (cloud workers for synthesis). Defer until there's clear demand. |
| **Phase 3 second domain** (custom MCU or sensor) | 4–6 sprints | PRD Phase 3 deliverable. Wait until audio domain has external users + community blocks before opening a second front. |
| **Phase 5 PCB tooling** | sibling project | PRD's "essentially a second full product." Treat as a separate workstream when we get there. |
| **Phase 6 motherboards / RAM / DDR5** | sibling project | PRD acknowledges this is multi-year, may need partnerships. |

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **The (E) metric stays at 0 indefinitely** because the user-action launch gates (tag push, announcements) don't happen | High | The four pending user-action items above are the bottleneck. Capabilities are launch-ready; the only thing left is the user pushing the tag. |
| **MIDI block complexity** (USB-MIDI + WebMIDI + native MIDI all have different surfaces) | Med | Start with WebMIDI (renderer-side, simplest). Defer USB-MIDI to Phase 3+. |
| **Tiny Tapeout cohort timing** — submissions are quarterly; missing one is 3 months added latency | Low-Med | TTSKY26a closed 2026-05-11 (already past for the alpha-launch cohort); TTGF26a closes 2026-06-22. |
| **Solo-dev burnout** (PRD-flagged risk) | Med | Plan sustainable pacing. Don't pile on. Use Discussions for community accountability once enabled. |
| **AI consultant validation pass rate is unmeasured** | Low-Med | First step is a manual eval script — listed in "Next" but deferred until there are AI-built graphs from external users to evaluate. |
| **Multi-agent code-additions accumulate seam debt faster than refactoring catches up** | Med | The post-multi-domain audits (2026-05-09) found two band-aid seams (`require_audio_output`, `has_vga` branch) shipped during the visual-blocks expansion. Sprint 14 narrows them while there are still only 2 callers each. If the next 2-3 expansions don't pause for hygiene the debt compounds. |

---

## Decision log — what changed in this update (2026-05-14, mid-Sprint-24 pivot)

Captured the strategic re-framing from Sprint 24's mid-sprint conversation. Two project principles + a phone-class roadmap + two pending ADRs.

- **"No fake blocks" principle added to [CLAUDE.md](CLAUDE.md) Core Constraints + this roadmap's snapshot.** Every block must elaborate to real synthesizable Amaranth HDL. External devices (displays, speakers, antennas, batteries) are chip pads / external connection points, not blocks. The "B-tier black-box diagram" approach explored mid-conversation was rejected. The right mental model: we build controllers + drivers (ST7789 LCD driver, PWM audio out, OOK transmitter), not the external things.
- **"Modular fab platform" direction announced.** Apply ADR-003's manifest pattern to the fab target itself. Eight extension points: `shuttles.yaml`, `pdks.yaml`, `cpu-cores.yaml`, `radios.yaml`, `buses.yaml`, `memories.yaml`, `packages.yaml`, `flows.yaml`. ADR-005 to be drafted in Sprint 25 along these lines.
- **Phone-class roadmap (S25 → S32) replaces the prior "Sprint 15+" candidate list.** Target is a smartwatch / 2005-feature-phone equivalent — fab-able on iCE40 + a handful of external chips (~$30 BOM). 7 sprints of peripheral + system-glue work + 1 sprint of integration. NOT a 2026 smartphone — voice calls, broadband, integrated WiFi/BT/GPS, cameras, AMOLED, LPDDR are all out of scope; documented explicitly in SPRINT-24.md and the SPRINT-24 mid-sprint pivot section here.
- **Modem replacement decided in principle:** custom on-chip radio (OOK / audio-FSK / LoRa-CSS) replaces the cellular modem we can't fab. Default leans OOK (simplest, fully fab-able, fits Pico tier); audio-FSK shipped as a teaching companion that reuses existing blocks; LoRa-CSS deferred. Final choice is a P1 user decision in the "Now" section.
- **MIDI block + polyphony pushed from "Next" to post-phone deferred-items list.** Still real reach; just downstream of the phone-class target. Not dropped.
- **Pre-existing launch-gate user-action items moved from "Now" P0 to "Now" P2.** alpha.9 is on the GitHub Release page; the (E)-metric clock can start whenever the user wants. These items are still real but no longer block the project's technical roadmap.
- **Stale "0 external users" framing unchanged.** PRD anti-metric (E) is still N/A by clock; no real-time-passed measurement yet.

### Earlier decision log (2026-05-09 PM)

Post-multi-domain audit pass after v0.1.0-alpha.3 shipped (added 5 logic blocks + iCEBreaker + 3 visual blocks; 19 → 27 blocks, 3 → 4 silicon paths).

- **Sprint 14 drafted as architectural hygiene + a11y backport.** Plan in [SPRINT-14.md](SPRINT-14.md). Six items, ~1.5 days total. Independently surfaced by `/design:design-system` audit and `/engineering:system-design` review. Not yet open — the launch-gate user actions still take priority.
- **Five new deferrals added to KNOWN-ISSUES.md with explicit triggers**: block-manifest auto-discovery (trigger: block #35 OR five-blocks-of-uniform-shape), multi-domain clock plumbing (trigger: first user wanting audio + visual on one chip), peripheral abstraction (trigger: peripheral #2 ships), logic-block port-naming asymmetry (trigger: next save-format-breaking change), counter's `audio-out` semantic crossing (no fix; convention note).
- **"Next" split into Sprint 14 (drafted) and Sprint 15+ (candidates).** The 4 cheap backend hygiene fixes plus 2 frontend hygiene items are now their own bucket distinct from the larger product items (MIDI, more DSP, more visual blocks).
- **"Later" added 3 entries from the audit**: block-manifest auto-discovery (1 sprint), multi-domain clock plumbing (1+ sprint), VGA 640×480 PLL configuration (0.5 sprint).
- **Risks list extended**: "Multi-agent code-additions accumulate seam debt faster than refactoring catches up" added as a Med-severity risk surfaced by the audits — Sprint 14 is the explicit mitigation.

### Earlier decision log (2026-05-09 AM)

Snapshot refresh after Sprint 13 closed. Decisions made vs. just bumping numbers:

- **Sprint 9–13 collapsed into a single "Done" section.** Five sprints worth of plans were inline-pending in the prior version; recapping each plan was noise. The retros carry the detail.
- **PRD Phase 2 promoted to "Done (capability)" with the user-action launch gate as the explicit remaining bottleneck.** The earlier framing ("Mostly done, one block + onboarding short") is no longer accurate — capabilities, accessibility, packaging, screenshots, and CI are all done. The only thing standing between current state and external users is the user pushing the tag.
- **Tiny Tapeout reclassified again — now Done.** S10 shipped the 14-file canonical layout with cocotb testbench; Active cohort TTSKY26a closed 2026-05-11 (already past), TTGF26a closes 2026-06-22.
- **More-DSP-blocks line item updated to reflect what's already shipped.** Wavetable/FM/Delay/Highpass/Bandpass/Bitcrusher/Multiply all done; remaining candidates narrowed to chorus / distortion / comb filter / allpass / ring-mod variants.
- **The 4-hour onboarding anti-metric flipped from "Likely failing" to "Mitigated."** Starter graph + dismissible hint + 7 examples + Help→About all shipped in S9. Real measurement still needs external users.
- **Risks list trimmed.** Three of the eight prior risks (E-metric blocked on tag-push, fresh-install smoke test, empty-canvas first launch) have either been closed or have explicit mitigations now wired up. The remaining 5 are honest open exposures.

### Earlier decision log (2026-05-08)

- **Sprint 9 reframed from "user-action carryforwards only" to "release polish + onboarding."** The PRD's 4-hour-onboarding anti-metric and the 9/10-block gap were real problems missed at the time. Adding a default starter graph + 2 simple blocks (Noise + Constant) + an examples menu turned a half-sprint of user-action items into a balanced sprint.
- **IPC regression test flipped from "drop" to "promote alongside the CI sprint."** Same infrastructure as cross-platform CI; marginal extra effort.
- **Reverb pushed from "Next" to "Later."** iCE40HX-1k BRAM constraints make a quality reverb hard on the current FPGA target.
- **Mac/Linux installers reclassified from "0.5 sprint config edit" to "0.5–1 sprint of GitHub Actions cross-platform CI."** The dev box is Windows-only; can't build cross-platform without CI or a different machine.
- **Hackaday writeup reframed from "100k+ readers reach" to "submitted; ~5% feature rate."** More honest about distribution outcome uncertainty.

---

## How to update this doc

- **End of each sprint:** revisit the Now / Next / Later split. Move completed Now items to the relevant sprint retro; pull the next-most-valuable item from Next into Now.
- **When something material changes** (new user feedback, dependency slip, major realization in a sprint retro): update the Risks section and the relevant Now/Next/Later bucket. Note the change in the Decision log.
- **Don't change the roadmap for every piece of new information.** Have a threshold for change. Aim for one update per sprint.
- **Keep the format stable.** Now / Next / Later, plus PRD phase reconciliation, plus risks. Avoid letting this doc grow into a wishlist — every item should have an effort estimate and a "why now" rationale.
- **When the PRD and this doc disagree** at the strategic level (not just per-sprint scope), update the PRD too. Don't let them silently drift.
