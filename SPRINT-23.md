# Sprint Plan: Sprint 23 — Historical chip-design example library

> **Solo dev + Claude Code** · Opened + closed 2026-05-12 (same-day, rolled forward from S22). Successor to [SPRINT-22.md](SPRINT-22.md). Six sub-sprints across seven commits. No new blocks — all the work was bundled example graphs based on historical, permissively-licensed (or patent-expired) chip designs, plus the supporting provenance/credits scaffolding. v0.1.0-alpha.9 stays the latest public release.

**Status:** **CLOSED 2026-05-12.** 7 commits, all green on CI. Block library unchanged at 43; bundled examples 14 → 18 (4 new historical chips); AI consultant gained a TOC entry for the open-chip library.

**Sprint Goal:** *Build the "open chip library" the Sprint 22 retro flagged. Research historical and permissively-licensed chip designs that map cleanly onto our 43-block library, package them as bundled examples, document provenance + licensing diligence in the canonical doc. The library should be a real value-add: drop-in templates for users plus manufacturing-ready documentation.*

---

## Working Assumptions

| Assumption | Default | Change if... |
|---|---|---|
| Sprint length | **single session** | one of the historical chips needs a block we don't have |
| Stack | unchanged from S22 | n/a |
| Block count | 43 → 43 (no new blocks) | a chip needs a new primitive |
| New blocks | none — examples only | n/a |
| Provenance bar | MIT / Apache 2.0 / BSD / ISC / CC0 / patent-expired / generic textbook | n/a |
| Release tag | none (alpha.9 stays current) | n/a |

---

## Sprint Log

**2026-05-12** — Sprint opens immediately after Sprint 22 closes.

- **S23 research ✅** Commit `8cf91f0`. Manufacturing-process technical drawing added at [`docs/MANUFACTURING-PROCESS.md`](docs/MANUFACTURING-PROCESS.md) — ISO 128/129 conventions, 7-stage block diagram (Design → HDL → Synth → P&R → Bitstream/Tape-out → Flash/Fab → Test), cross-sections of CMOS transistor + 5-metal-layer Sky130 stack + iCE40 LUT SRAM cell + exploded Tiny-Tapeout ASIC package. Also: open-chip-library research drafted as [`OPEN-CHIP-LIBRARY-RESEARCH.md`](OPEN-CHIP-LIBRARY-RESEARCH.md) — a sweep of candidate historical designs with provenance + licensing notes.

- **S23 prep ✅** Commits `f92af44` + `64904cc`. Doc scaffolding: `OPEN-CHIP-LIBRARY-PROVENANCE.md` (canonical reference for licensing diligence on every bundled historical example), CREDITS.md entries for the in-flight examples, examples-index restructured for category grouping, BLOCKS-COOKBOOK.md gained a "Contributing a bundled example" section covering acceptable licenses + attribution placement + pre-shipping checklist.

- **S23-1 ✅** Commit `181aa5e`. **Atari Punk Console** example added — Forrest M. Mims III, *Engineer's Notebook: Integrated Circuit Applications* (Radio Shack, 1980). 555-timer topology; the underlying 555 patent expired in 1988. Two interacting square-wave oscillators produce the canonical DIY-synth-101 burbling tone. Example count 14 → 15.

- **S23-2 ✅** Commit `6fedb95`. **FM bell** example added — Chowning, *Journal of the Audio Engineering Society* Vol. 21 No. 7 (1973). US patent 4,018,121 (Stanford) expired April 1994. Bell / electric-piano tone with long ringing decay — the sound of the FM-synth era. Example count 15 → 16.

- **S23-3 ✅** Commit `fd38e14`. **Hi-hat** example added. Standard analog-modular subtractive-synthesis (filtered noise + fast envelope), predating consumer electronics — no specific authorship to credit. Completes the kick + snare + hat drum trilogy already in the bundled examples. Example count 16 → 17.

- **S23-4 ✅** Commit `24c294c`. **Karplus-Strong plucked string** example added — Karplus & Strong, *Computer Music Journal* Vol. 7 No. 2 (1983). US patents 4,649,783 + 4,622,877 (Stanford) expired 2004 / 2005. Plucked-string note with the canonical ringing decay — known issue logged: the bundled implementation uses a Mixer in the feedback loop, which halves amplitude per cycle and gives ~60 ms decay instead of the algorithmically-canonical ~500 ms. Documented in [`examples/README.md`](examples/README.md). Revision deferred to a sprint that adds the no-averaging audio-sum block. Example count 17 → 18.

- **S23-5 (skipped)** — slot reserved for a divider-clock-tree example. Deferred to Sprint 24 (landed as S24-7 with Karplus-Strong revision) because researching the textbook 74HC4040 binary-ripple-counter topology surfaced a richer worked-example design that wanted the Audio Sum block first.

- **S23-6 ✅** Commit `a9fbe3c`. AI consultant directory (table of contents) added to the renderer's STATIC_SYSTEM prompt. Lists the new historical-chip examples by canonical name (Atari Punk Console, FM bell, hi-hat, Karplus-Strong, etc.) so the AI knows the bundled library exists and can recommend examples by name when the user asks for guidance.

**Block count:** 43 → 43 (unchanged).
**Examples:** 14 → 18 (4 historical chips added; 1 deferred to S24).
**Tests:** vitest examples-consistency 14 → 18 dynamic cases (pulled from the registry; no hand-written test additions).
**Working tree at sprint close:** clean on origin/master = `a9fbe3c`.

---

## Retrospective

### What went well

- **The open-chip library has a working provenance discipline.** Each of the 4 new examples cites the original work (paper or book), the patent number where applicable, and the expiry year. The diligence doc + CREDITS.md scaffolding give later sprints a copy-paste template. No legal worry shipped.

- **Surfacing the Karplus-Strong decay artefact before users see it.** The bundled implementation visibly decayed in ~60 ms (audible click instead of a sustained note), which is the textbook gotcha of using a Mixer (averaging) in the feedback loop. Documenting it as a known limitation in `examples/README.md` rather than silently shipping a wrong-sounding example is the right move. The fix (an AudioSum block — no averaging) landed in Sprint 24.

- **The example library motivates new blocks.** The Karplus-Strong decay artefact directly motivated the Sprint 24 AudioSum block. The divider-clock-tree example wanted explicit per-bit tap selection (which we have via Bus Split + Counter.addr-out, but cleaner with a dedicated tree block). Examples are not just consumers of the library — they pull the library forward.

### What didn't

- **No S23-5.** Six sub-sprints planned, five shipped. The divider-clock-tree was researched but the implementation wanted the no-averaging Audio Sum block first — and chasing that turned into Sprint 24's opener. The five-of-six shipping is fine, but the lesson is: when a "small example" pulls in a new block, that's a sprint boundary, not a Sprint 23 leftover.

- **The Karplus-Strong shipping with the documented-known-bad decay** is a planning miss. The right move would have been to defer S23-4 by one sprint until AudioSum landed. Instead we shipped an example whose first audible cycle clicks and decays in ~60 ms — visible to users — and revised in Sprint 24 a few commits later. Next time: if an example needs a block that doesn't exist, push the example to the sprint that adds the block, even at the cost of breaking the sprint theme.

### Surfacings — candidates for the next sprint

1. **AudioSum block** (no-averaging audio summer) — needed to fix Karplus-Strong's decay. Single-sprint block. Landed as S24-5.

2. **Divider clock tree example** — textbook 74HC4040 binary ripple counter. Wants Audio Sum + per-bit tap selection via Bus Split + Counter.addr-out. Landed as S24-7.

3. **Audio-modulation block family** — Sprint 22 closed the manifest workflow; the cookbook is mature. The next obvious expansion is the audio-modulation primitives that make the example library richer: VCO (voltage-controlled oscillator), LFO (low-frequency oscillator), AudioSum, VCF (voltage-controlled filter). All canonical analog-synth blocks; all individually small. Run them through Sprint 24.
