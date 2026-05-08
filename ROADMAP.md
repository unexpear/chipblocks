# ChipBlocks Roadmap

> **Last reviewed:** 2026-05-08 · **Format:** Now / Next / Later · **Cadence:** revisit at the end of each sprint
>
> This is the operational "what's next" document. The strategic vision lives in [PRD.md](PRD.md). Per-sprint plans + retrospectives live in [SPRINT-1.md](SPRINT-1.md) through [SPRINT-8.md](SPRINT-8.md). When this roadmap and the PRD disagree, the roadmap is more recent — but big disagreements should trigger a PRD update rather than silently drifting.

---

## Snapshot — where we actually are

- **8 sprints completed**, all closed cleanly with retrospectives. Most recent: Sprint 8 (AI consultant grounding) on 2026-05-08.
- **v0.1.0-alpha installer built locally**: `frontend/release/0.1.0/ChipBlocks_0.1.0.exe` (93 MB, unsigned NSIS, Windows). Not yet tagged on GitHub. Not yet smoke-tested by anyone other than the developer.
- **0 external users** — the PRD's **(E) anyone-but-the-developer-using-it** metric, which the PRD calls "the single most important metric." Ahead of schedule on capabilities, behind schedule on distribution + onboarding.
- **9 audio blocks** — under the PRD's Phase 2 "10–15 blocks" lower bound. One block short.

---

## PRD phase reconciliation

| PRD Phase | Original target | Capabilities | Distribution / discoverability | Notes |
|---|---|---|---|---|
| **Phase 1 — Proof of Concept** | months 1–3 | **Done** (S1–S5) | n/a | 9 blocks + AI sidebar + WAV simulation. Beat the original "7 blocks" bar. |
| **Phase 2 — First External User** | months 3–6 | **Mostly done** (S6–S8) | **Not done** | iCE40 FPGA shipped early. Installer built, never released. 9/10 blocks. No onboarding. |
| **Phase 3 — Domain Expansion** | months 6–12 | Not started | Not started | Second domain (custom MCU or sensor), more FPGA targets, Tiny Tapeout. |
| **Phase 4 — Polish & Reach** | months 12–18 | Not started | Not started | Web version, classroom mode, marketplace. |
| **Phase 5 — General-purpose PCB** | months 18+ | Sibling project | Sibling project | Treated as a separate workstream when we get there. |
| **Phase 6 — High-complexity boards** | months 30+ | Sibling project | Sibling project | Likely paid-tier / partnership territory. |

**Phase 2 is the bottleneck.** Capabilities are *almost* there (one block + onboarding short of the bar). Distribution hasn't started.

---

## PRD anti-metrics — current state

These are the four "you have failed" signals from the PRD. Tracking them honestly:

| Anti-metric | Current status | What we need |
|---|---|---|
| AI consultant designs fail validation > ~30% of the time | **Unknown** (no telemetry) | A way to record validation pass/fail across AI-built graphs. Defer to S10+; cheap stub: a manual eval script. |
| New-user time-to-first-working-chip > 4 hours | **Likely failing** today (empty-canvas first launch, no tutorial, no starter graph) | A default starter graph + one-paragraph "click ▶ Play" hint. **Sprint 9 P0.** |
| Issue tracker dominated by "I can't figure out X" with no clear pattern | **N/A** (no users yet) | Becomes meaningful once (E) starts moving. |
| 6 months in, all designs in the wild are still by the developer | **N/A** (real-time clock has been ~1 day; sprints are compressed-time) | Becomes meaningful once we tag the alpha and start measuring. |

---

## Now (Sprint 9 — start of next sprint)

**Theme:** Make `v0.1.0-alpha` actually shippable to strangers. Half autonomous coding + half user-authorization actions.

| Pri | Item | Owner | Effort | Why now |
|---|---|---|---|---|
| **P0** | Default starter graph that loads on first launch (Oscillator → Output + a one-line "click ▶ Play to hear it" hint) | Claude Code | 1–2 hrs | Closes the 4-hour-onboarding anti-metric. Empty canvas is the worst first impression. |
| **P0** | Add 2 simple blocks to hit the Phase-2 10-block bar: **Noise** (random 8-bit signed) + **Constant** (a fixed value, useful for DC offsets and "scope-style" testing) | Claude Code | 2–3 hrs | Closes the 9 / 10–15 gap. Both are simple Amaranth elaboratables; they double the design space the AI can suggest. |
| **P0** | Examples submenu in the Load button — let users browse `examples/two-osc-mix.json` etc. without hunting in the repo | Claude Code | 1–2 hrs | Discoverability of working designs. Today the example graphs sit in the repo where users won't look. |
| **P0** | "Help → About" menu with version, credits, BYOK note, GitHub link | Claude Code | 1 hr | Standard polish. The PRD says "embedded in the app under Help → About" for credits — currently absent. |
| **P0** | Pre-write GitHub release notes in `RELEASE-NOTES-v0.1.0-alpha.md` | Claude Code | 0.5 hrs | Decouples drafting from the user-action of pushing the release tag. |
| **P0** | Pre-write announcement copy for r/synthdiy, r/FPGA, Hacker News, Hackaday tip line | Claude Code | 1 hr | An untagged release nobody knows about isn't a release. Pre-stage so the user just posts. |
| **P0** (user) | Tag + push `v0.1.0-alpha`, attach the installer to the release, post the announcements | User | 0.5 hrs | The actual **(E)**-unblocking action. Pushing tags + creating public releases is a user-authorization step. |
| **P0** (user) | Take 2–3 screenshots (canvas with multi-block graph, AI chat, build success toast); drop into `docs/screenshots/`; reference from README | User | 1 hr | Visual product needs visuals. Couldn't automate without a Playwright harness; not worth it for one-time alpha assets. |
| **P0** (user) | Smoke-test the S8 AI grounding with the 7 queries from `SPRINT-8.md` | User | 0.5 hrs | Verifies S8 actually shipped value. If AI fails any query, S10 has a prompt-iteration item. |
| **P0** (user) | Enable GitHub Discussions on the repo | User | 5 min | A free Q&A surface for the first external users. Replaces the Discord question for now. |
| P1 | Manual eval script — hits the Anthropic API with the 7 smoke-test queries and grades against expected substrings | Claude Code | 2–3 hrs | First step toward the validation-telemetry anti-metric. Cheap and reusable. |

**Total estimated effort:** ~7–11 hours of autonomous coding + ~3 hours of user actions. Same scope as a 2-week sprint at 70% allocation.

---

## Next (Sprints 10–12, ~6 weeks)

Once `v0.1.0-alpha` is tagged and at least one external user has tried it, these are the highest-leverage items.

| Item | Effort | Reach | Confidence | Rationale |
|---|---|---|---|---|
| **MIDI input block + polyphony (2–4 voices)** | 1.5–2 sprints | hobbyist synth makers | High | The flagship domain is "audio/synth/retro-game chips." Without MIDI, the synth user can't play notes from a keyboard. Polyphony is what turns "interesting demo" into "actually usable instrument." Start with WebMIDI (renderer-side); defer USB-MIDI. |
| **Hackaday / Hackster.io / r/synthdiy writeup submission** | 1–2 days | submitted; ~5% feature rate | Med | PRD success metric (D) targets one feature within 90 days of launch. Submit; hope for amplification. Doing this is cheap; the cost of *not* doing it is invisibility. |
| ~~**Mac + Linux installer build pipeline**~~ | — | — | — | **✓ Done in Sprint 9 post-launch prep.** `.github/workflows/release.yml` builds Windows NSIS + macOS DMG + Linux AppImage on tag push, attaches all three to the GitHub Release. Unsigned for alpha; signing is config-only when certs are acquired. **Untested until first tag push.** |
| **2 more DSP blocks: pick from {wavetable, FM, delay}** — *not* reverb (BRAM-bounded on iCE40) | 1 sprint | all audio users | Med-High | Each block widens the design space. Wavetable is highest-bang (table lookup is small + flexible); FM gives complex timbres for ~1 multiplier; delay opens up echo / chorus territory. |
| ~~**IPC layer regression test**~~ | — | — | — | **✓ Done in Sprint 9 post-launch prep.** 6 vitest tests covering synth/build/AI IPC contract boundaries. Plus 19 pytest tests for the backend (first real coverage). Both run in CI. |
| **Tiny Tapeout submission package** | 1.5 sprints | indie hardware founder persona | Low-Med | PRD's "real chips fabricated" lagging indicator. The bitstream pipeline already produces Verilog; need a Tiny Tapeout-shaped wrapper, tile-area constraints, cohort timing. **Check next submission window before committing.** |

---

## Later (Sprints 13+)

| Item | Effort | Why later |
|---|---|---|
| **Code-signing certs** (Windows EV cert + Apple Developer ID) | 0.5 sprint + $300–$700/yr | Removes SmartScreen friction. Defer until either a user complains or distribution warrants it. |
| **Second FPGA target** (TinyFPGA BX or HX8K-EVB) | 0.5 sprint | Mostly a different `.pcf`. Worth shipping to broaden hobbyist hardware compat once one user asks. |
| **ECP5 + Xilinx 7-Series support** | 1–2 sprints | PRD P0 for full release. ECP5 has fully-open toolchain (Trellis); Xilinx 7-Series is semi-open via prjxray. |
| **Auto-layout for AI-placed nodes** (ELK or dagre) | 0.5 sprint | UX polish; the rightward-jitter heuristic is good enough until users complain. |
| **vitest 4 + Vite 6 paired upgrade** | 0.5 sprint | Bundled deps refresh. Wait until we have actual tests before this is meaningful (the IPC regression test in S10–S12 starts that). |
| **Cached audio in save format** (carryforward) | 0.5 sprint | **Dropped.** 6 sprints stale. Workaround: include a `.wav` alongside the `.json` when sharing. If a user complains, promote. |
| **Reverb block** | 1 sprint | iCE40HX-1k has only 8 BRAMs; quality reverb is BRAM-bound. Revisit when we have a higher-end FPGA target with more memory. |
| **Web version** | 4–6 sprints | PRD P1. Big lift (cloud workers for synthesis). Defer until there's clear demand. |
| **Validation telemetry dashboard** (closes the 30%-failure anti-metric loop) | 1 sprint | Needs a non-trivial number of AI-built graphs to be meaningful. Defer until we have any. |
| **Phase 3 second domain** (custom MCU or sensor) | 4–6 sprints | PRD Phase 3 deliverable. Wait until audio domain has external users + community blocks before opening a second front. |
| **Phase 5 PCB tooling** | sibling project | PRD's "essentially a second full product." Treat as a separate workstream when we get there. |
| **Phase 6 motherboards / RAM / DDR5** | sibling project | PRD acknowledges this is multi-year, may need partnerships. |

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **The (E) metric stays at 0 indefinitely** because the v0.1.0-alpha release sits in `frontend/release/` instead of on GitHub | High | Sprint 9 closes this with the tag + announcement work. |
| **The installed app's full feature path doesn't actually work end-to-end on a fresh user's machine** — never tested install → click Play → hear sound from a clean Windows VM | Med-High | Sprint 9 should include a fresh-install smoke test before the public release tag. The user already did dev-mode smoke testing; install-mode is unverified. |
| **Empty-canvas first launch loses non-technical users in 30 seconds** | Med | Default starter graph in Sprint 9. |
| **Hackaday writeup gets ignored** because the alpha is too rough | Med | Ship Mac/Linux installers + screenshots + onboarding before pitching. Better to delay than launch poorly. |
| **MIDI block complexity** (USB-MIDI + WebMIDI + native MIDI all have different surfaces) | Med | Start with WebMIDI (renderer-side, simplest). Defer USB-MIDI to Phase 3+. |
| **Tiny Tapeout cohort timing** — submissions are quarterly; missing one is 3 months added latency | Low-Med | Check the next submission window before committing the sprint that targets it. |
| **Solo-dev burnout at month 9** (PRD-flagged risk; 3 months out from now) | Med | Plan sustainable pacing. Sprint 9's 2-week cadence is right. Don't pile on. Use the Discord/Discussions for community accountability. |
| **AI consultant validation pass rate is unmeasured** | Low-Med | First step is the Sprint 9 P1 manual eval script. |

---

## Decision log — what changed in this update (2026-05-08)

This is the first roadmap update. Decisions made vs. naive defaults:

- **Sprint 9 reframed from "user-action carryforwards only" to "release polish + onboarding."** The PRD's 4-hour-onboarding anti-metric and the 9/10-block gap are real problems that I'd missed. Adding a default starter graph + 2 simple blocks (Noise + Constant) + an examples menu turns a half-sprint of user-action items into a balanced sprint.
- **IPC regression test flipped from "drop" to "promote alongside the CI sprint."** Same infrastructure as cross-platform CI; marginal extra effort. Reverses an earlier "drop" call I made when reviewing the 6-sprint-stale carryforwards.
- **Cached audio in save format stays dropped.** 6 sprints stale + a clean workaround (ship `.wav` alongside `.json`).
- **Reverb pushed from "Next" to "Later."** iCE40HX-1k BRAM constraints make a quality reverb hard on the current FPGA target. Revisit with a memory-richer target.
- **Tiny Tapeout reclassified from "1 sprint" to "1.5 sprints + cohort wait."** Earlier estimate was too aggressive about how much of the existing iCE40 pipeline transfers.
- **Mac/Linux installers reclassified from "0.5 sprint config edit" to "0.5–1 sprint of GitHub Actions cross-platform CI."** The dev box is Windows-only; can't build cross-platform without CI or a different machine.
- **Hackaday writeup reframed from "100k+ readers reach" to "submitted; ~5% feature rate."** More honest about distribution outcome uncertainty.

---

## How to update this doc

- **End of each sprint:** revisit the Now / Next / Later split. Move completed Now items to the relevant sprint retro; pull the next-most-valuable item from Next into Now.
- **When something material changes** (new user feedback, dependency slip, major realization in a sprint retro): update the Risks section and the relevant Now/Next/Later bucket. Note the change in the Decision log.
- **Don't change the roadmap for every piece of new information.** Have a threshold for change. Aim for one update per sprint.
- **Keep the format stable.** Now / Next / Later, plus PRD phase reconciliation, plus risks. Avoid letting this doc grow into a wishlist — every item should have an effort estimate and a "why now" rationale.
- **When the PRD and this doc disagree** at the strategic level (not just per-sprint scope), update the PRD too. Don't let them silently drift.
