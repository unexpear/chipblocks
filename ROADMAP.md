# ChipBlocks Roadmap

> **Last reviewed:** 2026-05-09 · **Format:** Now / Next / Later · **Cadence:** revisit at the end of each sprint
>
> This is the operational "what's next" document. The strategic vision lives in [PRD.md](PRD.md). Per-sprint plans + retrospectives live in [SPRINT-1.md](SPRINT-1.md) through [SPRINT-13.md](SPRINT-13.md). When this roadmap and the PRD disagree, the roadmap is more recent — but big disagreements should trigger a PRD update rather than silently drifting.

---

## Snapshot — where we actually are

- **13 sprints completed**, all closed cleanly with retrospectives. Most recent: Sprint 13 (block library expansion + CONTRIBUTING.md) on 2026-05-09.
- **v0.1.0-alpha installer built + verified locally**: `frontend/release/0.1.0/ChipBlocks_0.1.0.exe` (~93 MB, unsigned NSIS, Windows). Cross-platform CI (`.github/workflows/release.yml`) builds Mac DMG + Linux AppImage on tag push. Backend pytest 37/37 + frontend vitest 93/93 green on every push. Fresh-install smoke test passed on the developer's machine. **Not yet tagged on GitHub.**
- **0 external users** — the PRD's **(E) anyone-but-the-developer-using-it** metric. Capabilities + onboarding + accessibility are now genuinely launch-ready; the remaining gap is the user-action of pushing a release tag and posting the announcement drafts.
- **27 blocks** — well above the PRD's Phase 2 "10–15 blocks" range. Adds since the 2026-05-08 snapshot: Sine, Noise, Constant, FM voice, Multiply, Wavetable (S9); Bitcrusher + Delay (S13); Highpass + Bandpass filters (S13); AND / OR / XOR / NOT / Counter logic primitives (post-S13); VGA Timing / Color Bars / VGA Output visual blocks (post-S13).

---

## PRD phase reconciliation

| PRD Phase | Original target | Capabilities | Distribution / discoverability | Notes |
|---|---|---|---|---|
| **Phase 1 — Proof of Concept** | months 1–3 | **Done** (S1–S5) | n/a | 9 blocks + AI sidebar + WAV simulation. Beat the original "7 blocks" bar. |
| **Phase 2 — First External User** | months 3–6 | **Done** (S6–S13) | **Tag pending** | All 4 silicon targets shipping (iCEstick + TinyFPGA BX + iCEBreaker FPGA + Tiny Tapeout ASIC). 27 blocks (vs. 10–15 target), now including the VGA Timing / Color Bars / VGA Output trio that turns the iCEBreaker into a video chip. Onboarding starter graph + dismissible hint. WCAG 2.1 AA Tier 1 + Tier 2 done. CI + cross-platform release pipeline live. Installer + screenshot in repo. **Last gap:** user pushes the `v0.1.0-alpha` tag + posts the 4 announcement drafts. |
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

## Now — pending user-action launch gates

These remain blocked on the user; nothing more for autonomous polish to do until they happen.

| Pri | Item | Owner | Effort | Why now |
|---|---|---|---|---|
| **P0** (user) | Tag + push `v0.1.0-alpha`, attach the installer to the GitHub Release, verify CI built the Mac/Linux artifacts | User | 0.5 hrs | The actual **(E)**-unblocking action. Pushing tags + creating public releases is a user-authorization step. The release pipeline is wired up + tested; just needs the tag. |
| **P0** (user) | Post the 4 announcement drafts (r/synthdiy, r/FPGA, Hacker News, Hackaday tip line) | User | 0.5 hrs | Drafts live in [ANNOUNCEMENT-DRAFTS.md](ANNOUNCEMENT-DRAFTS.md). An untagged release nobody knows about isn't a release. |
| **P0** (user) | Enable GitHub Discussions on the repo | User | 5 min | A free Q&A surface for the first external users. |
| **P1** (user) | Submit the Hackaday writeup ([HACKADAY-WRITEUP.md](HACKADAY-WRITEUP.md)) | User | 15 min | PRD success metric (D) targets one feature within 90 days of launch. Cheap to send; cost of not sending is invisibility. |

**Sprint 14 is unscheduled.** Once the launch gates are through and there's external-user signal, the highest-leverage candidates are below ("Next").

---

## Next (Sprint 14+, candidates)

Once `v0.1.0-alpha` is tagged and at least one external user has tried it, these are the highest-leverage items. Order is not committed — pick based on whatever signal arrives first.

| Item | Effort | Reach | Confidence | Rationale |
|---|---|---|---|---|
| **MIDI input block + polyphony (2–4 voices)** | 1.5–2 sprints | hobbyist synth makers | High | The flagship domain is "audio/synth/retro-game chips." Without MIDI, the synth user can't play notes from a keyboard. Polyphony is what turns "interesting demo" into "actually usable instrument." Start with WebMIDI (renderer-side); defer USB-MIDI. |
| **More DSP blocks** — already shipped {wavetable, FM, delay, highpass, bandpass, bitcrusher, multiply}; remaining candidates: {chorus, distortion, comb filter, allpass, ring modulator variants} — *not* reverb (BRAM-bounded on iCE40) | 1 sprint each | all audio users | Med-High | Each block widens the design space. Pick by user request. |
| **Validation telemetry / manual eval script** | 0.5 sprint | catches AI-quality regressions | Med | Hits the Anthropic API with smoke-test queries and grades against expected substrings. First step toward the 30%-failure anti-metric. Cheap and reusable; deferred from S9-P1 because there were no AI-built graphs to evaluate yet. |
| **Code-signing certs** ($300–$700/yr) | 0.5 sprint config + ongoing | removes Win SmartScreen + Mac Gatekeeper warnings | High | The release.yml workflow already tolerates absence (`CSC_IDENTITY_AUTO_DISCOVERY: false`); adding signing is config-only once certs are acquired. Defer until a user actually complains about the warning. |

---

## Later

| Item | Effort | Why later |
|---|---|---|
| **ECP5 + Xilinx 7-Series support** | 1–2 sprints | PRD P0 for full release. ECP5 has fully-open toolchain (Trellis); Xilinx 7-Series is semi-open via prjxray. |
| **Auto-layout for AI-placed nodes** (ELK or dagre) | 0.5 sprint | UX polish; the rightward-jitter heuristic is good enough until users complain. |
| **vitest 4 + Vite 6 paired upgrade** | 0.5 sprint | Bundled deps refresh. The 87-test vitest suite gives us a forcing function; do this when next touching frontend infra. |
| **GitHub Actions Node 20 → Node 24 bump** | 1 hour | `actions/checkout@v4` + `actions/setup-node@v4` use Node 20 which GitHub deprecates 2026-09-16. Bump to v5. Tracked in [KNOWN-ISSUES.md](KNOWN-ISSUES.md). |
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

---

## Decision log — what changed in this update (2026-05-09)

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
