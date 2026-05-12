# Sprint Plan: Sprint 19 — LD-focused accessibility audit + cluster of small fixes

> **Solo dev + Claude Code** · Drafted + opened 2026-05-10 · Successor to [SPRINT-18.md](SPRINT-18.md) · No ADR (small fixes only; LD audit is a separate evergreen doc at [ACCESSIBILITY-AUDIT-LD-2026-05-10.md](ACCESSIBILITY-AUDIT-LD-2026-05-10.md)).

**Status:** **CLOSED 2026-05-10.** 6 of 6 planned items shipped. Item 2 (ByteConstant block) is the lone block addition this sprint and brings the catalog from 40 → 41. The two remaining LD-audit items the sprint deliberately deferred (modal backdrop guard + error-toast timer redesign) carried into Sprint 20 since they pair nicely with the Register File doc bump.

**Sprint Goal:** *Layer the existing WCAG 2.1 AA audit with a learning-disability-focused pass — dyslexia, ADHD/executive function, autism/sensory, working memory, dyscalculia, slow processing — and land the trivial-fix cluster from that audit immediately. Plus one block-catalog addition (ByteConstant) to give the CPU domain a parameterless literal counterpart to the audio-domain Constant.*

---

## Why now

Sprint 18 closed the CPU-domain capability story (Reinterpret + Subtractor + Comparator + Mux). The pre-launch audit work outstanding from Sprint 12 (WCAG 2.1 AA) covered standard accessibility — perception, operability, keyboard nav, ARIA labels — but not the *cognitive* axis. ChipBlocks targets non-technical users; a non-technical user with attention drift, working-memory pressure, or sensory sensitivity will hit walls the WCAG checks don't surface.

Specifically: ChipBlocks already does much better than typical FOSS chip-design tools on cognitive accessibility (the typed-bus rejection toast names what to do next, `useValidatedNumber` gives plain-English range hints, `classify-backend-error` translates Python tracebacks into setup steps). But several findings *did* surface — three trivial fixes (`prefers-reduced-motion` media query, volume slider for ▶ Play, plain-language LD-aware AI prompt section) are the kind that "cost 5 minutes each and prevent a sensory-sensitive user from giving up after the first ▶ Play."

The block addition this sprint (ByteConstant) is a small but real gap: the audio-domain Constant emits `audio-s8`; the CPU domain has no equivalent literal source. Every existing CPU example wires a ROM with 16 copies of the same byte just to inject a constant — a heavy pattern for "the number 7." ByteConstant fixes that asymmetry.

---

## Working Assumptions

| Assumption | Default | Change if... |
|---|---|---|
| Sprint length | **single focused day** (audit doc + 5 small a11y fixes + 1 block + CI bumps) | Hidden complexity in any item |
| Stack | unchanged from S18 | n/a |
| Block count target | 40 → 41 (ByteConstant only) | n/a |
| LD audit format | new evergreen file at repo root, mirrors the May-8 WCAG audit | n/a |
| Tracking | git commits + this `SPRINT-19.md` log | n/a |

---

## Sprint Goal — concrete targets

### S19-1 — `prefers-reduced-motion` honoring across all animations

- Add a `@media (prefers-reduced-motion: reduce)` block in `frontend/src/App.css` that disables: spinner during synth/build, chat blinking cursor, error-toast slide-in, any keyframe transitions on hover.
- Add a vitest under `frontend/test/ld-a11y.test.tsx` that mounts the app with `matchMedia('(prefers-reduced-motion: reduce)')` mocked to `true` and asserts animation-name resolves to `none` on those classes.
- LD audit #1: WCAG 2.3.3 + autistic / vestibular users.

### S19-2 — ByteConstant block (CPU-domain literal source)

- Backend `backend/blocks/byte_constant.py`. Combinational. `data_out.eq(self.value)` with `value: int` parameter 0..255.
- Frontend `ByteConstantNode.tsx`. Zero input handles, one output (`data-out: data-u8`), one number input wired to `useValidatedNumber({ range: [0, 255] })`.
- Type id: `byteconstant`
- Palette category: appended to "Computation" group (CPU-domain literal — sits with Adder / Register / RAM / ROM).
- Border color `#37474f` (deepest in the slate ramp — reads as "CPU-domain literal," counterpart to Constant's `#9e9e9e` neutral grey).
- Backend test: instantiate with `value=42`, assert `data-out` resolves to 42 across a few cycles.
- BLOCK_PORT_TYPES: `byteconstant: { 'data-out': 'data-u8' }`

### S19-3 — Volume slider in toolbar (default 50%, persisted)

- Add a slider `<input type="range" min={0} max={100}>` in the toolbar's left half, between the Play button and the status text. Default 50, persisted to localStorage at `chipblocks:volume`.
- Wire to `audio.volume = slider / 100` before `audio.play()`.
- LD audit #3: prevents sudden-onset 8-bit square-wave-at-full-amplitude startle on first Play.

### S19-4 — AI prompt: plain-language LD-aware section

- Insert near the top of `STATIC_SYSTEM` (after the role line, before "About this app"): a "Plain-language defaults (LD-aware)" section with a do/don't table — `combinational` → `reacts immediately, no clock needed`, `1-pole IIR` → `one-stage filter that softens high notes`, `LFSR` → `random-sounding-but-deterministic numbers`, `data-u8 bus` → `8-bit unsigned number signal — values 0 to 255`, etc.
- Add: "If a response is running >120 words, end with: 'Want me to break this down further?' to give the user a graceful continuation handle."
- LD audit #4. Doesn't change the model's vocabulary in general, but explicitly grounds the LD-aware behavior so a request like "explain noise to me" gets the plain-language version by default.

### S19-5 — Persist last-build status

- New state `lastBuildResult: string | null` in App.tsx, persisted to localStorage at `chipblocks:lastBuild`. Set on successful build (Lattice / TinyFPGA / iCEBreaker / Tiny Tapeout) with a one-line summary including filename + size. Render under the transient `statusMessage` as a persistent line ("Last build: chipblocks-icebreaker.zip · 78 KB · 12:34").
- LD audit #5: slow-processing users currently lose the status when they click elsewhere; this gives them a stable place to look.

### S19-6 — GitHub Actions version bumps

- `.github/workflows/ci.yml` + `release.yml`: bump `checkout@v4 → v5`, `setup-node@v4 → v5`, `setup-python@v5 → v6`, `upload-artifact@v4 → v5`. Confirms green on next push.
- Out-of-scope here: any structural CI change (matrix expansion, new platform). Just version refreshes.

---

## Out of scope (deferred to S20)

- **Modal backdrop click guard** for Settings + About modals. Small change but coupled to S20's Register File work since both ship in alpha.9.
- **Error-toast auto-dismiss timer redesign** (6s → 12s or interaction-gated). Same rationale.
- **Single-letter parameter labels** (ADSR A/D/S/R, FM C/M/D, PixelRange a/b → 3-char labels). 30-min job; pushed to S20 alongside the modal/toast work to land as a coherent "LD audit second-wave" group.

---

## Sprint Log

**2026-05-10** — Sprint opens. Items dispatched to agents in two batches: the LD audit (read-only research → markdown memo) ran first; the 5 fix items shipped in a single commit cluster after the audit landed.

- **S19-1 ✅ prefers-reduced-motion media query** — `frontend/src/App.css` has the media block; 3 vitest cases under `frontend/test/ld-a11y.test.tsx`.
- **S19-2 ✅ ByteConstant block** — full 8-file cookbook. Palette swatch `#37474f`. Tests green (60 → 61 backend, 150 → 153 frontend).
- **S19-3 ✅ Volume slider** — toolbar slider, defaults to 50%, persists via `readStoredVolume()` helper.
- **S19-4 ✅ AI prompt LD-aware section** — `STATIC_SYSTEM` in `frontend/src/ai/prompt.ts` opens with a 7-row do/don't table.
- **S19-5 ✅ Last-build status** — `lastBuildResult` state, render line under transient status, persisted to localStorage.
- **S19-6 ✅ GitHub Actions bumps** — `.github/workflows/ci.yml` + `release.yml` on v5/v6 across the board.

**Block count:** 40 → 41 (ByteConstant added).
**Tests:** 60 + 2 skipped → 61 + 2 skipped (backend); 150 → 156 (frontend, +3 LD-a11y, +3 ByteConstant component tests).

---

## Retrospective

### What went well

- **The LD audit ran cheap.** Dispatching it as a single read-only research agent (no code-touching, just heuristic review against the WCAG 2.1 AA criteria the May-8 audit had already established) kept the cost low and the output focused. The memo at [ACCESSIBILITY-AUDIT-LD-2026-05-10.md](ACCESSIBILITY-AUDIT-LD-2026-05-10.md) became the actionable backlog for items S19-1..5.
- **"Trivial fix candidate" markers in the audit doc were the right hint.** Three of the five fixes were explicitly flagged as 5–10 min each in the audit. They landed as a single commit cluster with minimal review.
- **ByteConstant slotted in cleanly.** No surprises in the cookbook; the only non-obvious choice was border color, resolved by going one notch darker than Constant's neutral grey to read as "CPU-domain."

### What didn't

- **The modal backdrop + error-toast items lingered.** They were in the audit but didn't fit the "trivial-fix cluster" framing — both involve subtle behavioral changes (when does a backdrop click count? when does a toast timer reset?) that benefit from being thought through more carefully. Deferring to S20 is fine, but in retrospect this is the third sprint in a row that defers a "should be easy" interaction-design item; the framing is wrong if it keeps slipping.
- **No SPRINT-15.md exists.** The numbering jumps 14 → 16 — Sprint 15 was retroactively absorbed into Sprint 16's ADR-001 work, but the gap is visible. Sprint 19 is the second time this has happened (Sprint 14 retro mentioned "tech-debt items deferred to Sprint 15," then Sprint 16 opened in their place). If the project sticks with numbered sprints, the rename should happen at the time, not later.

### Surfacings — candidates for the next sprint

1. **Block-manifest refactor** is now overdue. SPRINT-18 retro flagged the trigger condition (block #35 OR five-blocks-of-uniform-shape) as met. We're now at 41 blocks; the 7 CPU primitives, 6 audio-effect blocks, and 4 boolean gates each share a uniform shape. The 8-files-per-block cost compounds. A `blocks/manifest.ts` row per block, codegens the registries on both sides — pay-once, save forever.
2. **The 5 deferred LD-audit items** (modal backdrop guard, error-toast timer, single-letter parameter labels, edge-rejection toast wording, ROM "Fill with…" picker) cluster into "LD audit second wave" — one focused sprint or carry-into-S20.
3. **Worked example for Register File-like sharing semantics** — the ByteConstant block makes the CPU examples cleaner (no more 16-element-ROM-of-constants pattern). Updating cpu-accumulator + cpu-counter-with-branch to use ByteConstant where they currently use single-value ROMs is a doc/example refresh, not a code change.
