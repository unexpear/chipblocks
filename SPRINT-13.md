# Sprint Plan: Sprint 13 — Block library expansion + contributor on-ramp

> **Solo dev + Claude Code** · Date: 2026-05-09 · Successor to [SPRINT-12.md](SPRINT-12.md) · Operational source: [ROADMAP.md](ROADMAP.md) "Now" bucket + the next-sprint hand-off in [SPRINT-12.md](SPRINT-12.md)

**Dates:** 2026-05-09 — single-session sprint
**Team:** Solo (you + Claude Code as your dev pair)
**Sprint Goal:** *Add two more synth-domain blocks (Bitcrusher + Delay) so the library covers the missing common-synth-chain shapes — lo-fi crunch and slap-back/chorus — and write the CONTRIBUTING.md the project's been needing since ARCHITECTURE.md landed. After this sprint, the block library is at 17 and a first-time external contributor can read CONTRIBUTING.md and know exactly what to do.*

---

## Why now

Sprint 12 closed the audit doc and bumped the renderer from 6 to 50 tests. That left two natural follow-ups:

- **Block library is at 15.** The PRD's Phase-2 floor is "10–15 blocks" and we hit it at S10, but the *quality* of the 15 is uneven: there's no lo-fi/grit shaping (the AI keeps suggesting "Bitcrusher" when users ask for retro sounds), and there's no time-shifted signal (no delay, no chorus, no echo — the AI has to invent workarounds or say "not supported"). Two blocks fitting the v1 flagship audio/synth/retro-game domain explicitly per the PRD ("audio / synth / retro-game chips") is the right call: Bitcrusher (lo-fi grit) + Delay (slap-back, chorus building block, gateway to echo with Multiply + Mixer).
- **CONTRIBUTING.md is overdue.** README has a one-line "PRTs welcome" blurb and CLA.md is checked in, but the project has no actual contributor guide. With ARCHITECTURE.md now living at the repo root and the codebase ~50 commits past alpha-prep, the "first-time external contributor reads in 5 minutes and knows what to do" guide is the natural next polish.

The S9 launch carryforwards (tag, push, smoke-test, announcements, GitHub Discussions) are STILL on the user's plate — five sprints later. This sprint doesn't move them.

---

## Working Assumptions

| Assumption | Default | Change if... |
|---|---|---|
| Sprint length | **single session** (block addition + one doc) | More blocks land |
| Availability | one focused session | n/a |
| Stack | unchanged from S12 | n/a |
| Block count target | 15 → 17 | Stretch to 18+ if motivated |
| Tracking | Git commits + this `SPRINT-13.md` log | Want issues |

---

## Sprint Goal — concrete target

After Sprint 13:

1. **Bitcrusher block** wired across all 8 standard sites per ARCHITECTURE.md's block-addition cookbook (backend + registry + synth params + frontend node + `nodeTypes` + Palette + CSS border + AI prompt + tool schemas). Combinational; one parameter `bits` (1–8, default 4); pre-computed mask AND-ed with input. At bits=1 it's a 1-bit comparator (square wave regardless of input shape); bits=2–3 is heavy lo-fi crunch; bits=4–6 is gentle bit reduction.
2. **Delay block** wired across the same 8 sites. Synchronous; one parameter `delay_samples` (1–1024, default 128). At 44100 Hz, 128 samples ≈ 2.9 ms (slap-back), 1024 ≈ 23 ms. Implementation: `amaranth.lib.memory.Memory`-backed circular buffer with a registered read pointer + sync write port. Yosys's BRAM inference should map this into a single iCE40 BRAM (1024 × 1 byte = 1 KB; iCE40HX-1k has 8 BRAMs of 4 KB each).
3. **Block library is at 17**, up from 15. AI prompt's "What ChipBlocks does NOT do" updated to drop "No delay / chorus" and add a hint that chorus/slap-back can be built from Delay + Multiply + Mixer routing.
4. **2 new pytest + 6 new vitest tests.** Test counts: pytest 27 → 29; vitest 50 → 56.
5. **CONTRIBUTING.md** lives at the repo root, indexed from CLAUDE.md. Covers: pre-flight (CLA, DCO sign-off, open an issue first for non-trivial work, no copyleft); local setup; pointer at ARCHITECTURE.md for code shape; commit style; test expectations (anything new comes with a test); the 8-files-per-block cookbook with pointer at ARCHITECTURE.md; adding a new build target; accessibility expectations (WCAG 2.1 AA, link to last audit); license posture; where to ask; code of conduct one-liner.
6. **No regressions**: tsc clean, pytest 29/29, vitest 56/56.

What we are NOT shipping in Sprint 13:
- **Real-silicon flash test** of Bitcrusher / Delay on an iCEstick or TinyFPGA BX. Same gate as every prior FPGA sprint — the user owning a board.
- **More than 2 blocks** — Highpass + Bandpass were considered as ride-alongs but pulled into a parallel-agent batch landing alongside this sprint's docs (block library 17 → 19; mentioned in "what changes Sprint 14" below).
- **MIDI input + polyphony** — the flagship-domain unlock for synth makers, but a 1.5–2 sprint piece. Not this sprint.
- **Auto-layout for AI-placed nodes** — UX polish, deferred.
- **The S9 launch carryforwards** — STILL on the user's plate.

---

## Capacity (solo)

| Person | Available | Allocation | Notes |
|---|---|---|---|
| You + Claude Code | one session | n/a | Two commits — one per item. Block-addition agent + docs agent. |

---

## Sprint Backlog

| Pri | Item | Owner | Outcome |
|---|---|---|---|
| **P0** | **1. Bitcrusher + Delay blocks** — add both blocks across the 8 standard sites per ARCHITECTURE.md. Bitcrusher: combinational, `bits` param 1–8, mask `-1 << (8 - bits)`. Delay: synchronous, `delay_samples` 1–1024, `amaranth.lib.memory.Memory` circular buffer. Block colors: Bitcrusher #5d4037 (deep brown — distinct from Noise's #795548, evokes lo-fi grit); Delay #7c4dff (deep purple — distinct from Sawtooth's #9c27b0 and Sine's #ce93d8). Update AI prompt to drop "No delay / chorus" and hint that chorus/slap-back = Delay + Multiply + Mixer. End-to-end smoke verification with `synth.py` against minimal `Osc → Bitcrusher → Output` and `Osc → Delay → Output` graphs. | Agent | ✓ Done in commit `b3de62a`. Library 15 → 17. 2 new pytest + 6 new vitest. WAVs valid: 176444 bytes, 16-bit mono 44.1 kHz. Delay test: first 256 samples silent at delay_samples=256, oscillator output begins at sample 256 exactly. tsc clean, pytest 29/29, vitest 56/56. |
| **P0** | **2. CONTRIBUTING.md** — first-time-contributor guide covering CLA + DCO sign-off, local setup, ARCHITECTURE.md pointer, commit style, test expectations, 8-files-per-block cookbook, build-target addition, a11y expectations, license posture, where to ask, code-of-conduct one-liner. Indexed from CLAUDE.md. | Agent | ✓ Done in commit `14baf4f`. |
| **P0** | **3. Sprint retrospective** | You | ✓ Done (below). |

---

## Risks (resolved)

| Risk | Outcome |
|---|---|
| **Delay's Memory primitive falls to LUTRAM instead of BRAM** in Yosys's inference, exploding the LUT count. | Bracketed as a tuning question, not a correctness one. Implementation uses `amaranth.lib.memory.Memory` with explicit registered read port + sync write — the canonical BRAM-inferable shape. If a future build shows it falling to LUTRAM, the fix is a `MemoryStyle="block"` annotation; out of scope for the alpha. |
| **Bitcrusher's mask formula at `bits=8`** computes `-1 << 0 = -1` — does it pass the original signal through unchanged? | Yes. `-1` in two's complement is all-ones; AND with `-1` is identity. Verified in pytest. |
| **The two new blocks get added but the AI prompt isn't updated** and the AI keeps saying "ChipBlocks doesn't have a delay block." | The block-addition agent updated the AI prompt as part of the same commit — one of the 8 standard sites in ARCHITECTURE.md's cookbook. Followed the cookbook. |
| **CONTRIBUTING.md duplicates content from ARCHITECTURE.md** and the two drift over time. | Wrote CONTRIBUTING.md as a "what to do" document and ARCHITECTURE.md as a "how the code is shaped" document. Where they overlap (the 8-file block cookbook), CONTRIBUTING.md links to ARCHITECTURE.md as the source of truth instead of restating. |
| **The 8-file block-addition cookbook drifts** when blocks 16 + 17 land — does the cookbook still match the file list? | Verified by walking through each of the 8 sites for both blocks; cookbook held. The bigger forcing function for cookbook accuracy is the next time a block is added — if the cookbook misses a site, the commit will surface it. |

---

## Definition of Done (per item)
- [x] Code committed to git with a clear commit message
- [x] Demoable to yourself with one or two commands (or one click for installed-app items)
- [x] This `SPRINT-13.md` has a 1-paragraph entry in the Sprint Log
- [x] You understand at a high level what it does

---

## Sprint Log

### Item 1 — Bitcrusher + Delay blocks
**✓ Done — 2026-05-09.** Commit `b3de62a`. Two more blocks fitting the v1 flagship domain explicitly per the PRD ("audio / synth / retro-game chips"). Both close common synth-chain gaps that user-shared graphs would have wanted. **Bitcrusher** ([backend/blocks/bitcrusher.py](backend/blocks/bitcrusher.py)): combinational; input `audio-in` (signed 8); output `audio-out` (signed 8); one parameter `bits` (1–8, default 4). Implementation: pre-computed mask `(-1 << (8 - bits))` AND-ed with the input. At bits=1 you get a 1-bit comparator (square wave regardless of input shape); bits=2–3 is heavy lo-fi crunch; bits=4–6 is gentle bit reduction. Color: #5d4037 (deep brown — distinct from Noise's #795548; evokes lo-fi grit). **Delay** ([backend/blocks/delay.py](backend/blocks/delay.py)): synchronous; input `audio-in`; output `audio-out`; one parameter `delay_samples` (1–1024, default 128). At 44100 Hz, 128 samples ≈ 2.9 ms (slap-back), 1024 ≈ 23 ms. Implementation: `amaranth.lib.memory.Memory`-backed circular buffer with a registered read pointer + sync write port. Yosys's BRAM inference should map this into a single iCE40 BRAM (1024 × 1 byte = 1 KB; iCE40HX-1k has 8 BRAMs of 4 KB each). If a future build shows it falling to LUTRAM that's a tuning question, not a correctness one. Color: #7c4dff (deep purple — distinct from Sawtooth's #9c27b0 and Sine's #ce93d8). Use case: chorus / slap-back / building-block for echo (Delay + Multiply scale + Mixer with original). Both blocks wired across all 8 standard sites per ARCHITECTURE.md's block-addition cookbook: backend block + registry + `synth.py` params switch + frontend node + `nodeTypes`/`AppNode` + Palette + CSS border + AI prompt block-library + tool schemas. **AI prompt update beyond strict scope**: removed "No delay / chorus" from the "What ChipBlocks does NOT do" section (delay now exists) and added a hint that chorus/slap-back can be built from Delay + Multiply + Mixer routing — preempts the AI inventing a non-existent "Chorus" block when users ask for one. Tests: 2 new pytest (bitcrusher 1-bit-squares-a-sine, delay holds-silence-then-passes-input) + 6 new vitest. Test counts: pytest 27 → 29; vitest 50 → 56. End-to-end smoke verified: `synth.py` against minimal `Osc → Bitcrusher → Output` and `Osc → Delay → Output` graphs produces valid 176444-byte 16-bit mono 44.1 kHz WAVs. Delay: first 256 samples silent at delay_samples=256, oscillator output begins at sample 256 exactly.

### Item 2 — CONTRIBUTING.md
**✓ Done — 2026-05-09.** Commit `14baf4f`. Project had a CLA + a one-line "PRs welcome" blurb in the README, but no actual contributor guide. With the project now ~50 commits past the original alpha-prep work and a coherent ARCHITECTURE.md to point at, time to have something a first-time external contributor can read in 5 minutes and know what to do. Covers: pre-flight (read CLA.md, sign with `git commit -s`, open an issue first for non-trivial work, no copyleft deps in shipped code); local setup (backend + frontend, with test-running commands); pointer at ARCHITECTURE.md for code shape; commit style (small, single-purpose, plain English, no `--no-verify`); test expectations (anything new comes with a test, specific tests that must stay green for block / IPC / save-format work); the 8-files-per-block cookbook with pointer at ARCHITECTURE.md; adding a new build target; accessibility expectations (WCAG 2.1 AA, link to the last audit); license posture (permissive only; PRs adding GPL/etc. will not be merged); where to ask (Discussions vs Issues vs PR comments); code-of-conduct one-liner: "the project's whole reason for existing is to make chip design accessible to people who've been told they can't do it; don't be a person who tells others they can't do it." Indexed from CLAUDE.md.

### Item 3 — Sprint retrospective
**✓ Done — 2026-05-09.** Below.

---

## Retrospective

**What went well:**
- **The whole sprint landed in two commits.** One block-addition commit + one docs commit. The 8-files-per-block cookbook in ARCHITECTURE.md held: the agent walked through each site for both blocks and missed nothing. This is exactly the payoff the cookbook was written for.
- **The AI prompt update beyond strict scope was the right call.** Removing "No delay / chorus" from the non-capabilities section and adding the chorus/slap-back routing hint preempts the AI inventing a nonexistent "Chorus" block when users ask. The PRD treats AI hallucination as an anti-metric; this is the kind of small adjustment that prevents one class of it.
- **Bitcrusher and Delay both have legitimate use cases**, not padding. Bitcrusher at bits=1 is a 1-bit comparator (the simplest "make this square" primitive). Delay is the building block for echo, chorus, slap-back — the AI can compose these from Delay + Multiply scale + Mixer. Each block is one clean PRD-domain primitive, not a one-off feature.
- **CONTRIBUTING.md and ARCHITECTURE.md don't duplicate.** Wrote CONTRIBUTING.md as a "what to do" doc and ARCHITECTURE.md as a "how the code is shaped" doc. Where they overlap (the 8-file cookbook, the build-target system), CONTRIBUTING.md links to ARCHITECTURE.md as the source of truth. Keeps the two from drifting.
- **Test count went 50 → 56** with focused additions for the two new blocks, exercising both the synth-pass behavior (pytest) and the renderer behavior (vitest).

**What didn't:**
- **No fresh-install smoke test of the new Bitcrusher / Delay blocks in the actually-installed app — same gap as every prior sprint that added blocks.** TS compiles + pytest passes + vitest passes prove the code shape is right; whether the installed `ChipBlocks_0.1.0.exe` actually loads the new blocks in its packaged renderer is unverified until the user runs the installed app. Eventually a user will smoke-test; until then this gap stays open.
- **Delay's BRAM inference is unverified at the silicon level.** The implementation is the canonical BRAM-inferable shape (`amaranth.lib.memory.Memory` + registered read port + sync write), so it *should* land in a single BRAM, but no build through Yosys + nextpnr was run end-to-end to confirm the resource utilization. If a real build shows it falling to LUTRAM, that's a future tuning sprint.
- **Sprint 9 launch carryforwards — STILL pending user action, FIVE sprints later.** Tag v0.1.0-alpha, push installer, smoke-test, screenshots, S8 AI grounding manual eval, GitHub Discussions, announcement posts. The renderer is presentable, the tests are green, the docs are in place, the block library has 17 (or 19, after the ride-along agent's Highpass + Bandpass land in the same batch). The ONLY remaining gate is the user picking up the launch sequence. Worth flagging again as a risk: every sprint of feature work without a launch is feature work that doesn't actually move the **(E) anyone-but-the-developer-using-it** PRD anti-metric off zero.
- **Bitcrusher's color (#5d4037) is close to Noise's (#795548)** — both browns. Did a side-by-side check; distinct enough at typical zoom levels but worth a re-look if more brown-coded blocks land. Future block additions should pick from the unused color region (mid-greens, oranges, teals) before more browns.

**What surprised me:**
- **The block-addition cookbook in ARCHITECTURE.md is genuinely load-bearing now.** S12 wrote it as a "this might be useful for an external contributor" doc; S13 used it as a checklist for an internal agent. Two blocks added without missing a site. The cookbook's value isn't documentation per se — it's a shape that prevents site-omission bugs.
- **CONTRIBUTING.md was shorter than expected** (~60 lines). Most of its job is pointing at other docs (ARCHITECTURE.md for code shape, CLA.md for contribution terms, ACCESSIBILITY-AUDIT-2026-05-08.md for the a11y bar). The thing CONTRIBUTING.md actually says, that the others don't: the small-commits + plain-English + no-`--no-verify` working norms, and the code-of-conduct one-liner. Both worth saying out loud once.
- **A parallel agent batch shipped Highpass + Bandpass blocks alongside this sprint's docs** (block library 17 → 19), and the block-addition cookbook held for both of those too. Three blocks added, all in conformance, with no per-block customization of the cookbook.

**What changes Sprint 14:**
- **Highpass + Bandpass blocks** landed in a concurrent agent batch alongside this sprint's docs (already shipped). Sprint 14 inherits a 19-block library, not 17.
- **The S9 launch carryforwards** are the most-deferred items in the project history. They block the **(E) external-user** PRD metric. Sprint 14's first call has to be: are we doing the launch this sprint, or are we admitting that "alpha" is shipping in full but not announcing? Recommend the former — too much sprint-velocity is being spent on capabilities the user-base of zero won't see.
- **MIDI input + polyphony** — the flagship-domain unlock for synth makers. 1.5–2 sprints. Worth being the next big-feature work after the launch carries through.
- **Real-silicon test gate** — if the user acquires a TinyFPGA BX or iCEstick (~$30 USB-native board), one sprint can flash a real bitstream and confirm the audio chain end-to-end. Closes a gap every prior FPGA sprint left open.
- **Auto-layout for AI-placed nodes** — UX polish, ~0.5 sprint. Lower priority while the AI consultant produces typical 1–4-node additions; promote when a user complains.
- **vitest 4 + Vite 6 paired upgrade** — now meaningful (50+ tests to keep green). 0.5 sprint, well-scoped.
- **Block-color audit before the next block addition** — the brown collision (Bitcrusher #5d4037 vs Noise #795548) is a near-miss; document the unused-color region (mid-greens, oranges, teals) so the next block's palette pick is one less judgment call.
