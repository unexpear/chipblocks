# Sprint Plan: Sprint 21 — Block manifest refactor (ADR-003 implementation)

> **Solo dev + Claude Code** · Drafted + opened 2026-05-12 · Successor to [SPRINT-20.md](SPRINT-20.md) · Implements [ADR-003](ADR-003-block-manifest.md). First sprint of the post-alpha.9 cycle.

**Status:** **CLOSED 2026-05-12.** Both phases of ADR-003 landed in a single session via 5 parallel agent dispatches plus targeted hand-edits. Block count unchanged at 42; behavior unchanged; per-block hand-edited surface dropped from 9 files to 3.

**Sprint Goal:** *Cut the per-block hand-edited surface from 9 files to 3 by landing the manifest refactor specced in ADR-003. Phase 0 (manifest + codegen scaffolding + byte-equality validation) + Phase 1 (cutover commit — markers + `_params_gen.py` + `synth.py` wrapper refactor) ship as one cohesive batch since the dirty-tree handoff between phases adds no value when both are reachable in a single focused session.*

---

## Why now

Three sprint retros in a row (S18 / S19 / S20) flagged the manifest refactor as the next sprint's biggest win. The trigger condition in ROADMAP.md ("block #35 OR five-blocks-of-uniform-shape") was met in S18 and reaffirmed twice. The doc-drift cost was visibly compounding — Sprint 19's ByteConstant addition missed 3 of 4 announcement drafts and the AI prompt's per-block list; caught by accident in Sprint 20's doc pass. Without structural change, the next quiet omission would ship unnoticed.

alpha.9 (Register File + LD audit second wave) landed cleanly with installers on the Release page. With the public release tagged, Sprint 21 opens against a stable baseline and a clean working tree — the conditions ADR-003's Phase 0 byte-equality validation requires.

---

## Working Assumptions

| Assumption | Default | Change if... |
|---|---|---|
| Sprint length | **single focused session** (~5 hours per ADR-003 budget) | Phase 1 cutover surfaces irreducible byte-equality issues |
| Stack | unchanged from S20 | n/a |
| Block count | 42 → 42 (structural refactor only, no new blocks) | n/a |
| Save-format | unchanged (manifest is a build-time artifact, not part of the wire format) | n/a |
| New deps | `js-yaml` + `ajv` (frontend devDeps) + `PyYAML` + `jsonschema` (backend deps) — all MIT | n/a |
| Tracking | git commits + this `SPRINT-21.md` log | n/a |

---

## Sprint Goal — concrete targets

Maps 1:1 to ADR-003 action items #1–#9.

### S21-1 — `blocks.yaml` + `blocks.schema.json` at repo root

- JSON Schema defines the row shape: required `type / label / description / color / category / componentPath / backendPath / backendClass / ports`; optional `parameters / cssMinHeight / cssMinWidth / tags`. Ports map handle id → `{dir, bus}` with bus constrained to the 53-member BusType enum from ADR-001.
- Manifest YAML: 42 rows in PALETTE order, populated from current state of `BLOCK_REGISTRY` + `BLOCK_PORT_TYPES` + `PALETTE` + `_build_params` + App.css block rules.
- Single source of truth going forward; codegen consumes it.

### S21-2 + S21-3 — Codegen scripts

- `scripts/codegen-frontend.mjs` (Node, MIT deps `js-yaml` + `ajv`). Writes 5 frontend target sections.
- `scripts/codegen-backend.py` (Python, MIT deps `PyYAML` + `jsonschema`). Writes 2 backend target sections + 1 whole-file new module (`_params_gen.py`).
- Both support `--check` (default; byte-diff vs target) and `--write` (insert markers + replace generated regions).
- `npm run codegen` script in `frontend/package.json` invokes both.

### S21-4 — Byte-equality validation pass (Phase 0 gate)

- Both scripts produce byte-equal output against existing target sections in `--check` mode. Iterate codegen templates until every diff is empty.
- Acceptable normalization in scope: reorder current target files to PALETTE order (canonical going forward).
- The AI prompt's rich per-block prose stays hand-written; codegen owns only structural facts (a new `# Block reference` section delimited by HTML-style markers).

### S21-5 — CI codegen-drift job

- New step in `.github/workflows/ci.yml`'s `frontend` job: `node scripts/codegen-frontend.mjs --check`.
- New step in the `backend` job: `python3 scripts/codegen-backend.py`.
- Fails the PR on any drift, with a unified diff in the CI log.
- `backend/requirements-dev.txt` pins `PyYAML>=6` + `jsonschema>=4`.

### S21-6 — Cutover commit (Phase 1)

- Implement `--write` mode in both codegen scripts (in-place section replacement bracketed by `@begin codegen <slot>` / `@end codegen <slot>` markers; whole-file write for `_params_gen.py`).
- Apply cutover: 10 marker pairs land across the 5 frontend + 2 backend in-place targets; `backend/blocks/_params_gen.py` is generated fresh.
- Refactor `synth.py`'s `_build_params` to a 3-line wrapper around `blocks._params_gen.build_params`. ~90 LOC of `if/elif` branches deleted.

### S21-7 — Manifest-integrity tests

- `frontend/test/manifest.test.ts` (vitest, dynamic — 42 blocks × 3 invariants = 126 cases): componentPath file exists, exports `${PascalCase}Node` symbol, is registered in `nodeTypes`.
- `backend/tests/test_manifest.py` (pytest, parametrized — 42 × 3 = 126 cases): backendPath module exists, exports `backendClass`, is registered in `BLOCK_REGISTRY`.
- Both graceful-skip when `blocks.yaml` is absent.

### S21-8 — Doc rewrites

- `ARCHITECTURE.md`: "8-file cookbook" → "3-file manifest walkthrough" (77 lines).
- `CONTRIBUTING.md`: external-contributor version (23 lines).
- `CLAUDE.md`: one-line "Adding a block" reminder in Conventions section.
- `KNOWN-ISSUES.md`: tech-debt item A1 marked resolved with pointer to ADR-003.

### S21-9 — Sprint retro

- This file.

---

## Sprint Log

**2026-05-12** — Sprint opens against the alpha.9 tip of master (commit 08c575a). Working tree clean.

Five parallel agent dispatches across the session, plus targeted hand-edits for the CI wiring and verification passes:

- **S21-1 ✅** Agent `a073755` authored [blocks.yaml](blocks.yaml) (22.6 KB, 42 rows, JSON-schema-valid). [blocks.schema.json](blocks.schema.json) (8 KB, ~180 lines) authored by hand to lock the row shape before the agent dispatched. Spot-checks of Counter (3 ports, audio-out + addr-out semantic-cross preserved), `not` (file `not_gate.py`, class `NotGate`, type id `not` — asymmetric naming survived), and ROM (`intArray` parameter with 16-zero default, `cssMinWidth: 200` for textarea layout) all clean.

- **S21-2 + S21-3 ✅** Agent `aa97a07` wrote both codegen scripts in parallel. Phase 0 sizes: `codegen-frontend.mjs` 509 LOC, `codegen-backend.py` 334 LOC. `npm run codegen` wired in `frontend/package.json`. `js-yaml` + `ajv` added as frontend devDependencies.

- **S21-7 ✅** Agent `a525617` wrote both manifest-integrity test files. 126 dynamic cases per side via `it.each` / `pytest.parametrize`. Frontend total: 161 → 287 (+126). Backend total: 63 → 189 + 2 skipped (+126). Both gracefully skip when `blocks.yaml` is missing.

- **S21-8 ✅** Agent `a6f57a7` rewrote the cookbook walkthrough across 4 files. The agent's 5 "future-proofing notes" (cssMinHeight examples, backend port-naming conventions, when to set `backendNeedsSampleRate`, the `intArray` parameter type, the `tags` field) are captured for a Sprint 22 BLOCKS.md addition.

- **S21-4 ✅** Agent `ad5da2e` drove the byte-equality iteration with two pre-made decisions baked into the brief: (a) reorder current files to PALETTE order — acceptable Phase-0-era normalization since "no behavior change" applies to runtime, not source-line ordering; (b) narrow AI prompt codegen scope to structural facts only — the rich per-block prose, LD do/don't table, common workflows, and "What ChipBlocks does NOT do" sections stay hand-written. Inserted a new `# Block reference` section in `STATIC_SYSTEM` delimited by HTML-style markers, leaving the original `# Block library` rich-prose section untouched verbatim. 11 of 12 fragments landed clean (`_params_gen.py` punted to S21-6 since the file doesn't exist yet).

- **S21-5 ✅** Hand-edited `.github/workflows/ci.yml` to add `codegen-drift` steps to both `frontend` and `backend` jobs. `backend/requirements-dev.txt` pinned to `PyYAML>=6` + `jsonschema>=4` so CI can install them.

- **S21-6 ✅** Agent `a5fc84a` implemented `--write` mode in both codegen scripts (`+161 LOC` frontend → 670 LOC; `+154 LOC` backend → 488 LOC). Applied cutover: 10 marker pairs landed (3 in `index.ts`, 1 in `busTypes.ts`, 2 in `Palette.tsx`, 1 in `App.css`, 3 in `__init__.py`); `_params_gen.py` generated fresh (3.5 KB whole-file). Refactored `synth.py`'s `_build_params` to a 3-line wrapper around `blocks._params_gen.build_params` — file dropped from 331 to 248 LOC (`-90/+7`).

- **S21-9 ✅** This retro.

**Block count:** 42 → 42 (structural refactor, no new blocks).
**Tests:** 161 → 287 frontend (+126 from manifest-integrity dynamic cases). 63 + 2 skipped → 189 + 2 skipped backend (+126 same shape).
**LOC delta of generated machinery vs. deleted hand-rolled machinery:** roughly net-positive (~+2.5 KB net across all 7 codegen-affected target files + 1158 LOC of codegen scripts vs. ~90 LOC of `_build_params` deleted) — paid once, saves ~6 files of touch per future block.

---

## Retrospective

### What went well

- **Parallel agent dispatch worked.** Five agents in flight at the peak (P1 + P2+P3 + P7 + P4 + P8) with zero collisions: each touched a non-overlapping set of files. The Sprint 20 rate-limit issue didn't recur. The model for this is: dispatch agents whose write targets are disjoint, and brief them on what's in flight elsewhere so they don't get stepped on.

- **The "two pre-made decisions" pattern unblocked P4.** Byte-equality iteration was the highest-risk task per the ADR (estimated 1+ hour of fiddly template tweaking). Pre-deciding (a) that reordering to PALETTE order is acceptable normalization and (b) that the AI prompt's rich prose stays hand-written meant the agent didn't burn time on architectural decisions it couldn't make autonomously. The agent shipped clean byte-equality across 11 of 12 fragments in one pass.

- **ADR-driven sprint shape.** Sprint 21 mapped 1:1 to ADR-003's 9 action items. The ADR called the LOC budget (`~150` frontend, `~120` backend codegen) optimistically (actuals 670 + 488); called the time budget (5 h) approximately right (~2 h elapsed across the agent runs). Future ADR-driven sprints should expect 3-4× the LOC estimate when codegen has many target sections.

- **Manifest-integrity tests via `describe.each` / `pytest.parametrize`.** 126 dynamic cases per side, +252 total across the test suite, all from ~106 LOC per file. The cost-per-assertion is essentially zero once the schema is locked. The pattern is reusable for any future "loop over a data file" invariant.

### What didn't

- **The AI prompt section was the longest tail.** Per the agent's report, anchor-based extraction over the rich-prose region was the trickiest part. The compromise (new `# Block reference` section + leave original prose alone) works but doubles the prompt's per-block surface from ~one paragraph each to one paragraph plus one structured bullet list each. The AI consultant still parses the rich prose; the structural section is mostly redundant. Worth revisiting in a future sprint: either delete the original prose now that the manifest is authoritative, or fold the structural section into the prose so the prompt isn't ~5 KB longer for nothing. Punted for now since "delete the prose" is a real-world AI-quality regression risk and "fold into prose" is more codegen template work.

- **`--write` mode wasn't designed in Phase 0.** Agent `aa97a07` left it as a stub. Agent `a5fc84a` implemented it during cutover (+315 LOC across both scripts). That's fine in retrospect — the iterative `--check` work in P4 informed what `--write` needed — but the ADR's "Phase 0 scaffolding" language implied `--write` would exist in stubs ready to wire. Worth tightening the next foundational ADR's language to "Phase N artifacts must be runnable, not skeleton-only."

- **Doc fragmentation across CLAUDE.md / ARCHITECTURE.md / CONTRIBUTING.md / BLOCKS.md / README.md.** Five places now mention the manifest workflow in slightly different framings. The S22 follow-up to add `cssMinHeight` / port-naming / `backendNeedsSampleRate` / `intArray` / `tags` field documentation will compound this — those notes belong in *one* place. The right home is probably a new top-level `BLOCKS-COOKBOOK.md` (or a section inside BLOCKS.md) that's the single canonical reference for "how to add a block." ARCHITECTURE.md and CONTRIBUTING.md would then just link there.

### Surfacings — candidates for the next sprint

1. **Sprint 22 follow-up: the 5 future-proofing notes from P8** (cssMinHeight examples, backend port-naming conventions, when to set `backendNeedsSampleRate`, the `intArray` parameter type, the `tags` field). Plus the docs-fragmentation item above. One focused doc-only sprint, ~1 hour.

2. **AI prompt scope second pass.** Now that the manifest is authoritative, decide whether to delete the hand-written rich prose (and let the AI work from the structured `# Block reference` section + the schema) or fold the structural section into the prose. Either path reduces the per-block surface back to one descriptor. Worth a measured decision — possibly with a quick eval against the existing `scripts/eval-ai.ts` 7-query smoke test to ensure neither path regresses consultant quality.

3. **Next block addition is the structural acid test.** The next time a new block gets added (Sprint 22's most likely candidate: a Shifter block to round out the data-path operations alongside Adder / Subtractor), the 3-file workflow should land in ~20 min total instead of the historical ~2 h. If it takes longer, the codegen has a friction point worth surfacing.

4. **Per-block-list CI lint replacement.** The S20 `registries-aligned.test.ts` was the temporary pre-manifest guard. Now that PALETTE / BLOCK_PORT_TYPES / nodeTypes / AI prompt are all codegen'd from the same manifest, the lint is structurally redundant. Worth a sentence-long PR to delete it (~5 min). Caught here so it doesn't become stale-test cruft.

5. **Hand-written cookbook deletion.** The "8-file cookbook" sections in older sprint docs (SPRINT-14 onwards reference the cookbook) are now historical artifacts. Not worth retrofitting — but the public-facing references in CLAUDE.md / CONTRIBUTING.md / ARCHITECTURE.md are already updated.
