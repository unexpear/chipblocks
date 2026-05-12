# Sprint Plan: Sprint 22 — Manifest acid test + Sprint 21 retro surfacings

> **Solo dev + Claude Code** · Opened + closed 2026-05-12 (same session — Sprint 21 closed mid-session, and the four Sprint 21 surfacings were each small enough to roll forward immediately rather than pause). Successor to [SPRINT-21.md](SPRINT-21.md). All four sprint items closed; v0.1.0-alpha.9 stays the latest public release; master is one block ahead at 43 (Shifter).

**Status:** **CLOSED 2026-05-12.** Four sub-sprints across four commits, all green on CI. No release tag — the alpha.9 marker stays current; Sprint 22 is interior plumbing + one new block, nothing user-visible enough to warrant alpha.10 on its own.

**Sprint Goal:** *Cash the cheques from ADR-003. Use the manifest workflow to add a real block (acid test), then sweep up the four follow-on items from the Sprint 21 retro (deduplicate doc fragments, delete the now-redundant pre-manifest lint, decide the AI prompt scope, add a CLAUDE.md note about the npm lock-file lesson). Nothing speculative — every item directly defends a real cost flagged in the previous sprint's retro.*

---

## Working Assumptions

| Assumption | Default | Change if... |
|---|---|---|
| Sprint length | **single session** (~2-3 hours) | one of the four items surfaces an irreducible blocker |
| Stack | unchanged from S21 | n/a |
| Block count | 42 → 43 (Shifter — acid-test block) | n/a |
| New deps | none | n/a |
| Tracking | git commits + this `SPRINT-22.md` log | n/a |
| Release tag | none (alpha.9 stays current) | If users start asking for something Sprint 22 ships, retag alpha.10 |

---

## Sprint Goal — four concrete items

Maps 1:1 to the four candidates listed in [SPRINT-21.md](SPRINT-21.md)'s retro surfacings.

### S22-1 — Add a Shifter block (manifest acid test)

The Sprint 21 retro predicted: *"~20 min instead of historical ~2 h"* for a manifest-workflow block addition. Use a real new block (Shifter — combinational 8-bit unsigned logical shift by a constant amount, 1..7 bits, left or right) to measure that claim against reality.

### S22-2 — Delete `registries-aligned.test.ts`

The Sprint 20 cross-registry consistency lint became structurally redundant once Sprint 21's manifest landed — codegen guarantees the four frontend registries are all derived from `blocks.yaml`. The lint was a pre-manifest belt-and-suspenders guard against the kind of drift that hit ByteConstant in Sprint 19; that failure mode is no longer reachable.

### S22-3 — `BLOCKS-COOKBOOK.md` (doc fragmentation cleanup)

The "how to add a block" walkthrough was duplicated across ARCHITECTURE.md (77 lines) and CONTRIBUTING.md (23 lines), plus referenced from CLAUDE.md and the manifest schema's field descriptions. Consolidate into a single canonical reference at the repo root, link both upstream docs at it.

### S22-4 — AI prompt scope decision

Decide whether to: (A) delete the rich hand-written `# Block library` prose now that codegen owns the structural `# Block reference`, (B) fold structural details into the prose and delete the codegen section, (C) keep both with cookbook discipline, or (D) bigger pass — strip structural bullets from the prose, keep narrative-only + codegen separately.

---

## Sprint Log

**2026-05-12** — Sprint opens immediately after Sprint 21 closes (same session). Working tree clean against master tip `5fa4c4f`-ancestor (Sprint 21's last commit).

- **S22-1 ✅** Commit `2a97ae1`. Added Shifter block: `blocks.yaml` row + `frontend/src/blocks/ShifterNode.tsx` + `backend/blocks/shifter.py` + `npm run codegen`. The 7 cross-cutting files regenerated cleanly with zero hand-edits. Added one backend unit test (9 spot cases against Python's `<<` / `>>`) + two frontend rendering tests + a BLOCKS.md section. Block count 42 → 43; tests 287 → 292 frontend, 189 → 193 backend. **Acid-test measurement:** ~45 min end-to-end vs. the predicted ~20 min. Most of the extra was authoring the BLOCKS.md prose paragraph (still hand-written by design) and the unit test (always hand-written). The 3-files-plus-codegen part of the workflow was ~8 min total. ADR-003's projection holds for the cross-cutting plumbing; future block additions where the BLOCKS.md prose can be terse should land closer to ~20 min.

- **S22-2 + S22-3 ✅** Commit `5fa4c4f`. Deleted `frontend/test/registries-aligned.test.ts` (-3 vitest cases: 292 → 289). Created [`BLOCKS-COOKBOOK.md`](BLOCKS-COOKBOOK.md) (~220 lines): the 30-second summary, 7-step walkthrough, 7 generated-section reference table, 5 edge-case sections (`cssMinHeight` examples, port-naming conventions, `backendNeedsSampleRate` triggers, `intArray` parameter type, the `tags` field), CI drift-failure shapes, package-lock discipline. Shrunk ARCHITECTURE.md's "Adding a new block" section 77 → 14 lines and CONTRIBUTING.md's 23 → 11 lines — both now link to BLOCKS-COOKBOOK.md for the deep version. CLAUDE.md gained a key-project-documents entry.

- **S22-4 ✅** Commit `aa86a5f`. AI prompt scope decision: option C (keep both, cookbook discipline) over A (delete prose), B (delete codegen), or D (bigger pass). Rationale walked through in the commit body: A regresses behavioral-context queries; B loses the codegen safety net (Sprint 22 P1's Shifter drift proves humans miss the prose update); D is the right long-term shape but ~43 paragraphs of careful editing — deferred to Sprint 23 with an `eval-ai.ts` measurement before/after. Fixed the immediate Shifter drift in the prose section (4-sentence paragraph added between subtractor and comparator); dropped the stale "(all 42 types)" count from the prose header in favor of pointing at the codegen-driven count; added a cookbook step 8 about updating the prose section when adding a block.

- **S22 lock-file note ✅** Folded into commit `2a97ae1`. CLAUDE.md Conventions section gained a one-line rule: *"Adding a frontend dependency: run `npm install` in the same commit. `package-lock.json` and `package.json` must stay in sync or CI's `npm ci` step rejects the PR."* Sprint 21's fixup commit `9c71bfb` cited as the canonical example.

**Block count:** 42 → 43.
**Tests:** 287 → 289 vitest (+2 Shifter rendering, +3 manifest-integrity dynamic, -3 from deleted registries-aligned). 189 + 2 skipped → 193 + 2 skipped backend (+1 Shifter unit, +3 manifest-integrity dynamic).
**Working tree at sprint close:** clean on origin/master = `aa86a5f`.

---

## Retrospective

### What went well

- **The manifest acid test passed.** Shifter landed via the 3-file workflow with codegen-output matching first-try on all 7 cross-cutting files. The ~45 min wall-clock time vs. the predicted ~20 min is honest — the gap is the BLOCKS.md prose and the unit test, both of which were always hand-written by ADR-003's design. The cookbook part of the work (the part Sprint 21 was meant to optimize) took ~8 min. **ADR-003's projection holds where it claimed.**

- **Sprint-on-sprint compounding.** Sprint 21's BLOCKS-COOKBOOK.md → Sprint 22's S22-3 doc consolidation → the cookbook is now a single canonical reference instead of three drift-prone copies. Sprint 21's manifest-integrity tests → Sprint 22's S22-2 deletion of the redundant pre-manifest lint. Sprint 21's codegen wiring → Sprint 22 P1's acid test confirms the wiring. Each sprint paid dividends inside the next; refactor sprints are not "wasted" sprints when the next sprint's first item validates them.

- **The AI prompt scope decision was driveable by analysis, not API spend.** The 7 eval-ai.ts queries map cleanly to specific prompt sections; only Q4 ("cutoff range") depends on the duplicated content, and both halves answer Q4 equally. No paid API run needed. Option C falls out of the analysis without burning the user's BYOK budget.

- **Sprint 22 P1's Shifter drift surfaced the cookbook gap immediately.** Sprint 21 P8's BLOCKS-COOKBOOK.md said *"add a BLOCKS.md section"* but said nothing about the AI prompt's `# Block library` prose. S22-1 missed the prose update; S22-4 caught it. Cookbook step 8 now closes the loop. **The same-sprint feedback was cheap to capture and hard-to-imagine without an acid test.**

### What didn't

- **The Shifter ~45 min was 2.25× the prediction.** The 25-min gap was mostly BLOCKS.md prose (~10 min) and the unit test (~10 min). The cookbook step 8 added in S22-4 adds another 5-10 min of work per block (the ai/prompt.ts # Block library paragraph). So a fair prediction for the next block addition is closer to **~35-40 min**, not 20. The ADR was optimistic on the parts it didn't own (tests, docs) but correct on the parts it did. Worth restating the prediction more honestly in Sprint 22's retro.

- **The S22-1 commit shipped a `bumped CLAUDE.md to 22 sprints in flight` line that's technically true but reads like the sprint already closed.** Sprint 22 was opened *in* the commit that bumped the counter. Cosmetic — the SPRINT-22.md file lands in this retro commit, fixing the reference shape. Worth flagging because Sprint 23 onwards should bump CLAUDE.md *in the retro commit* not in the first commit of the sprint.

- **No public-release tag.** alpha.9 stays current; Sprint 22's changes are interior (one extra block + doc consolidation + a quiet AI-prompt fix). The announcement drafts still cite 42 blocks and stay accurate against the published release. When a Sprint 23 brings something user-visible (Option D AI-prompt pass + an eval-ai.ts confirmation, or a chunk of the bundled-examples-from-historical-chips work), retag alpha.10.

### Surfacings — candidates for the next sprint

1. **AI prompt scope Option D pass** — strip the structural bullets from `# Block library`, keep narrative-only, codegen owns structural. ~43 paragraphs to edit. Wants an `eval-ai.ts` run before and after to confirm no quality regression. ~1-2 hours including the eval. The right long-term shape.

2. **Bundled-examples library from historical permissively-licensed chip designs.** The user flagged this as the Sprint 23+ project: research historical and permissively-licensed chip designs (no-strings; MIT / Apache / BSD / public-domain / patent-expired), pick the ones that map cleanly onto our 43-block library, package them as bundled examples like the current `examples/cpu-accumulator.json` / `cpu-multiregister.json`. The library should be a real value-add: drop-in templates for users plus manufacturing-ready documentation. Research dispatched as a separate workstream; plain-English report follows separately.

3. **eval-ai.ts measurement baseline.** Tied to #1 and to general consultant-quality monitoring. The script exists and is structurally ready; running it once now establishes a pre-Option-D baseline. Sprint 23's first concrete action.

4. **The next block addition will retest the cookbook end-to-end.** If a Shifter-shape block (combinational + 1-2 params + data-u8 in/out) lands in <30 min including the BLOCKS.md prose + ai/prompt.ts paragraph + unit test, the workflow's mature. If it slips above 45 min again, the cookbook has another gap.

5. **Sprint 23 docs sweep**: bump the test counts in CLAUDE.md and ARCHITECTURE.md when each commit lands, not in a separate trailing doc commit. This was tedious to chase across Sprints 21 and 22; the doc-counts-as-codegen idea (have the codegen scripts read the actual test count from pytest / vitest output and stamp it into CLAUDE.md / ARCHITECTURE.md) is worth a sprint half-hour. Even simpler — just delete the specific counts and leave the descriptive language ("a few hundred each side").
