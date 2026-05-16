# Sprint Plan: Sprint 1 — Reset + new direction's foundation

> **Solo dev + Claude Code** · Opened + closed 2026-05-16 (single intense session — the reset itself + the ADR foundation + verification). The first sprint of the v2 ground-up direction. Successor to v1's [SPRINT-24.md on legacy/audio-synth-direction](https://github.com/unexpear/chipblocks/blob/legacy/audio-synth-direction/SPRINT-24.md).
>
> **Status: CLOSED 2026-05-16.** 5 commits, all green on CI. The audio-synth direction is formally handed off; the new direction has master, an ADR, and a working empty Electron shell.

---

## Sprint goal

*Execute the preservation + restart described in RESET-PLAN.md. Land the architectural foundation (ADR-006) before any product features are authored. Verify the empty shell launches.*

This sprint is structurally different from the 24 sprints on the legacy branch. Those built features; this one removed features and laid foundations. The work is invisible to anyone visiting the GitHub repo (master looks "empty") but it sets the structural shape of every later sprint.

---

## Working assumptions

| Assumption | Default | Change if... |
|---|---|---|
| Sprint length | **single intense session** (~6-8 hours; possibly 1-2 days wall-clock) | Either the planning surfaces an unforeseen blocker, or verification reveals problems |
| Stack | Electron + React + TypeScript + Vite (carried over from v1 infrastructure); React Flow for the canvas (deferred to Sprint 4); no backend in this sprint | n/a |
| Block count | **0** (the new direction's library starts empty) | n/a — Sprint 2-3 land Layer 0-4 manifests |
| New deps | none on the way in (deps were trimmed during reset) | n/a |
| Release tag | none | A retro-only sprint doesn't tag |

---

## Sprint log

**2026-05-16** — Sprint opens in continuity with the planning conversation that preceded it.

### Commit 1: `4d4b5d3` — Pre-reset planning docs

Two planning artifacts authored over the multi-day strategic conversation:

- **FINAL-STATE-VISION.md** (~300 lines): forward-looking complement to PRD.md, describing the final-state ChipBlocks identity (ground-up electronics builder), the 9-layer architecture, core vs community split, AI authority structure, two-deliverables model, modular fab platform.

- **RESET-PLAN.md** (~460 lines): operational execution plan. Preservation strategy (legacy/audio-synth-direction branch + v0.1.0-alpha.9-final tag), extraction strategy (what infrastructure survives), 6-sprint structure for the new direction, done criteria, open questions, operational mechanics.

Both committed on legacy master to document the reset's reasoning before any irreversible action.

### Commit 2: `07cb2c7` — Plan refinement

User pushed back on two phrasing issues in RESET-PLAN.md:
- "Point of no return" → softened to "formal handoff" (git tags don't destroy history; the genuine moment of effect is later when new commits land on main)
- Added an explicit "No deletion of legacy work" core principle at the top of RESET-PLAN.md, including the perpetual-accessibility guarantee for the legacy direction

Both edits committed on legacy master.

### Commit 3 (effectively): formal handoff (branch + tag, no commit)

After plan approval:
- Created `legacy/audio-synth-direction` branch at the master HEAD (07cb2c7)
- Created `v0.1.0-alpha.9-final` tag at the same SHA
- Pushed both to origin
- Verified all three refs (master, legacy branch, freeze tag) converged on 07cb2c7 locally + remotely

The formal handoff moment. Branch and tag preserve the audio-synth direction in perpetuity.

### Commit 4: `c8152bf` — The reset itself

The big mechanical reset. 251 files changed, +617/−36,677 lines.

- **Deleted** all v1 content from master: 48 backend blocks + 22 example graphs + 322 vitest tests + 227+2 pytest tests + 5 ADRs (001/002/003/005 + various drafts) + 23 sprint retros + 17 docs (BLOCKS, BLOCKS-COOKBOOK, ARCHITECTURE, CONTRIBUTING, CREDITS, KNOWN-ISSUES, OPEN-CHIP-LIBRARY-*, ANNOUNCEMENT-DRAFTS, HACKADAY-WRITEUP, NAME-LEGALITY, ACCESSIBILITY-AUDIT-*, RELEASE-NOTES, RESEARCH-litex-audio) + 18 manifest files (9 yaml + 9 schema) + the entire `backend/` + `examples/` + `docs/` + `scripts/` directories.

- **Replaced**: README.md, CLAUDE.md, PRD.md, ROADMAP.md with new v2 content. Reframed identity from "audio-synth chip-design tool" to "ground-up electronics builder."

- **Trimmed**: `frontend/electron/main/` (dropped AI + IPC + classify-error handlers; kept minimal BrowserWindow code). `frontend/electron/preload/` (dropped rich BYOK + AI bridges; kept minimal contextBridge stub). `frontend/src/` (deleted all v1 components; recreated minimal `App.tsx` + `main.tsx` + `index.css` + `vite-env.d.ts`). `frontend/package.json` (dropped @anthropic-ai/sdk + @testing-library/* + vitest + Tailwind + autoprefixer + jsdom + ajv + js-yaml + tsx; version bumped to 0.2.0-pre). `frontend/electron-builder.json` (dropped `extraResources` block referencing the removed backend). `.github/workflows/ci.yml` (kept only frontend TS check; dropped backend pytest + codegen-drift jobs).

- **Preserved**: `LICENSE`, `CLA.md`, `FINAL-STATE-VISION.md`, `RESET-PLAN.md`, `.gitignore`, `.github/workflows/release.yml`, `frontend/.gitignore`, `.npmrc`, `electron-builder.json`, `index.html`, `package.json` (trimmed), `package-lock.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `frontend/electron/electron-env.d.ts`, `frontend/electron/main/index.ts` (rewritten minimal), `frontend/electron/preload/index.ts` (rewritten minimal), `frontend/public/favicon.ico`.

Done on `main-reset-staging` branch first, verified the working tree, then fast-forward merged to master. `main-reset-staging` deleted after merge.

Push to origin completed. CI green on the minimal shell.

### Commit 5: `f301879` — ADR-006 draft

The architectural foundation: ~770 lines locking the three coupled decisions:

1. **9-layer abstraction hierarchy** (Materials → Shapes → Interfaces → Behaviors → Primitive devices → Circuits → Assemblies → Boards/chips → Systems). Strictly downward composition.

2. **Universal object model** — one data shape for every block at every layer: `id / layer / type / label / parent / position / ports / parameters / internal / behavior / validation / notes`. Validation is first-class.

3. **AI authority split** locked at architecture level — deterministic engine owns physics + manufacturing-package contents; AI owns explanations + draft text; user owns approval. The validator never calls AI; the release-ZIP generator never calls AI. Enforced via type-system + CI gates.

Plus: project file format spec (`MyProject.chipblocks/` folder layout), save format v2 versioning, hierarchical composition + lazy expansion, multi-domain signal typing, phased implementation map for Sprints 2-6, 18 numbered action items, 6 alternatives considered with explicit reject rationale, explicit "what this ADR does NOT lock" section.

CLAUDE.md + ROADMAP.md cross-refs updated in the same commit to point at the new ADR. CI green.

### Commit 6: `96b3a38` — package-lock.json sync

`npm install` after the dep trim removed ~2,680 lines from the lock file (transitively-dropped dependencies falling out). Committed to keep CI's `npm ci` step in sync with the trimmed `package.json`.

### Verification

End-of-sprint verification of all done criteria:

| Item | Result |
|---|---|
| Legacy preservation verified | ✅ `git checkout legacy/audio-synth-direction` reproduces alpha.9 (manual spot-check) |
| New main launches | ✅ `npm install` + `npx tsc --noEmit` + `npx vite build` all clean; `npm run dev` started Vite in 663ms on localhost:5173 + compiled the Electron preload (interactive Electron BrowserWindow display couldn't be verified from the non-interactive shell, but the bundle is valid and the BrowserWindow code is minimal Electron-standard) |
| ADR-006 drafted | ✅ at master f301879; 770 lines covering all three decisions + project file format + signals + phased implementation |
| CI green on minimal master | ✅ verified after each push; final state at 96b3a38 |
| Working tree clean | ✅ at sprint close |

---

## Block count

Was 48 on v1's master (alpha.9). Now **0** on v2's master — the new direction's library starts empty. The 48 audio blocks live preserved on `legacy/audio-synth-direction`.

Bundled examples: was 22; now 0. Same preservation.

Tests: was 549 (227 pytest + 322 vitest); now 0 (TS check is the only CI gate). Tests grow back as features land per ROADMAP.md.

Sprint count: 24 on v1 + 1 on v2 = 25 total sprints across both directions.

---

## Retrospective

### What went well

- **The plan-first discipline paid off.** Three planning docs (FINAL-STATE-VISION.md, RESET-PLAN.md, and the conversation transcript leading to ADR-006) accumulated before any irreversible action. The actual reset commit was mechanical — every deletion and every replacement was already decided. No "should I keep this?" pauses during execution.

- **The "no deletion of legacy work" principle held.** Nothing was lost. Every commit, every file, every test, every alpha release stays accessible. The `legacy/audio-synth-direction` branch is a literal alpha.9 snapshot. The freeze tag marks the formal handoff. The GitHub Releases page keeps all alpha.x installers downloadable. A future contributor curious about v1 can recover everything.

- **The "always check, never assume" discipline carried through.** Every commit verified locally before push. Every push watched on CI. Verification of the empty shell included `npm install` + `tsc` + `vite build` + `npm run dev` — four independent checks that the new minimal infrastructure works end-to-end.

- **The ADR-006 scope was right.** Big enough to lock the architectural foundation (the universal object model + 9 layers + AI authority split), small enough to not preempt later ADRs (validator architecture, AI provider adapter, canvas UX, manufacturing-package generator, community library mechanism are all explicitly deferred). The "what this ADR does NOT lock" section is the load-bearing discipline — saying no to scope creep at the ADR level.

- **Cross-ref updates landed in the same commit as the ADR.** CLAUDE.md + ROADMAP.md both reference ADR-006 immediately. No "doc drift between writing the ADR and updating the cross-refs."

- **The 5-commit shape of the sprint maps cleanly to the operational mechanics.** Plan (4d4b5d3 + 07cb2c7) → formal handoff (branch + tag, no commit) → reset (c8152bf) → ADR (f301879) → lock sync (96b3a38). Future contributors browsing the history can follow the reset's logic in order.

### What didn't

- **The "interactive verification" gap.** `npm run dev` was tested via timeout-then-kill, which confirmed the Vite server starts + compiles the preload, but didn't confirm the Electron BrowserWindow actually displays a window. That last step requires a real interactive display the harness can't see. The risk: there's some Electron-side issue (a runtime crash, a wrong path, a missing dependency) that vite-build can't catch and that wouldn't surface until the user runs the app on their machine. Mitigation: the user runs `npm install && npm run dev` once on their Windows desktop before Sprint 2 begins. If the window appears, Sprint 1 is fully closed.

- **`backend/` directory persisted as an untracked artifact.** The `git rm -r backend` removed all tracked backend files, but the user's local `.venv/` + `.pytest_cache/` + `fpga_101/` (a separately cloned repo) + `__pycache__/` subdirectories remained on disk. They're gitignored / not-tracked, so git's reporting is correct — but it shows `backend/` as an untracked directory in `git status` which is confusing. Future contributors who don't have the user's local Python env won't see this. No real impact; worth noting if Sprint 2's backend work re-creates `backend/`.

- **Vite's "Re-optimizing dependencies because lockfile has changed" message was emitted twice on the first `npm run dev`.** Because the lock file changed during sprint and Vite caches dependency optimization. Not a problem in practice — it just re-optimizes silently. Mention if Sprint 2 sees more of these warnings; could be a sign of dep instability.

- **CI is now intentionally minimal (only TS check).** This is the right state for a near-empty shell, but it means a regression in npm install or vite build wouldn't be caught by CI until they're added back as explicit steps (Sprint 4+ when vitest returns; Sprint 2+ when backend pytest returns). For now, manual verification per the cookbook discipline catches what CI doesn't. Worth restoring `npm run build` as a CI step in Sprint 4 so production-bundle validity is also CI-protected.

### Surfacings — candidates for Sprint 2 (and beyond)

The natural flow from this sprint into the next:

1. **Sprint 2 lands the Layer 0-3 manifests** per ADR-006's action items #2-#10. Five manifests (materials, shapes, interfaces, behaviors, signals) + their schemas + codegen scripts + manifest-integrity tests. Estimated 1 week of focused work.

2. **The `signals.yaml` addition surfaced during ADR-006 drafting.** Originally I planned 8 manifests; the ADR added `signals.yaml` as a 9th when writing the net/port/signal section. Multi-domain signal typing needs a place to live; an in-line TypeScript union won't scale (it didn't in v1's ADR-001 either). Decision: 9 manifests total post-Sprint 2.

3. **The `OBJECT-MODEL.md` + `PROJECT-FORMAT.md` living docs** should land in Sprint 2-3 to mirror the ADR's data-shape and project-folder sections. Easier-to-find references for new contributors than reading the full ADR. Pattern from v1: spec docs are easier to keep current than ADRs (ADRs capture decisions at a point in time; spec docs capture the current shape).

4. **Sprint 2 may want to add the codegen-drift CI check** for each new manifest. v1's CI had this for `blocks.yaml`; v2 needs it for `materials.yaml` + `shapes.yaml` + `interfaces.yaml` + `behaviors.yaml` + `signals.yaml`. The pattern is uniform per manifest. Worth extracting into a small helper script if 5+ manifests share the same drift-check shape.

5. **No interactive verification mechanism for the dev shell** is a structural gap. v1 had this via screenshot-on-demand. v2 might need a "headless visual smoke test" — e.g., Playwright launching Electron against the dev server, taking a screenshot, comparing against a golden. Defer until Sprint 4 (when the canvas has real visual content to verify).

6. **The CI workflow is now ahead of the project's needs.** Backend pytest job is removed; codegen-drift is removed. Both should come back as their respective features re-land (Sprint 2 for codegen-drift; Sprint 5 for backend pytest if backend re-emerges, otherwise later). Worth a one-line `// TODO Sprint N: restore X` in ci.yml so future-me remembers.

7. **The legacy branch should get a one-time pin annotation.** Currently `legacy/audio-synth-direction` is just a branch pointer. Adding a README.md on that branch at its tip saying "This branch is frozen; see master for the current direction" would help anyone who lands there via a stale link. **Action: edit on legacy branch, commit only there, don't propagate to master.** Defer to a 5-minute task in Sprint 2.

8. **Sprint 1 retro itself** is the last act of Sprint 1. The pattern of v1 (commit retro at sprint close) carries forward. Sprint 2 opens against the master tip that includes this retro.

---

## What this unblocks

After Sprint 1 closes:

- **Sprint 2 starts with a fully-locked foundation.** Every manifest authored in Sprint 2 fits the ADR-006 universal object model. No "what shape should this be?" decisions left over.

- **The legacy direction's continuity is verified.** Anyone who wanted the v1 ChipBlocks audio-synth tool can still get it. Zero external user impact (since there were zero external users, the cost was zero; the principle of preservation is the value).

- **The visual-editor problem is bounded by ADR-006.** Sprint 4 will build the canvas against the universal object model — not against ad-hoc per-block UX. The canvas knows what a "block" is regardless of layer.

- **The AI authority split is structurally enforced from the start.** AI integration in Sprint 6 will inherit the rule, not bolt it on. The release-ZIP generator (Sprint 6) will be deterministic from its first line of code.

- **The 6-sprint timeline to the first working demo (Sprint 6: LED + resistor + switch + power source end-to-end)** has a stable starting point. Estimated 8-13 weeks per RESET-PLAN.md's realistic timeline.

---

## Sprint 1 closes

5 commits on master. 1 ADR drafted. 1 branch + 1 tag preserve the legacy direction. ~1,200 lines of new docs (FINAL-STATE-VISION + RESET-PLAN + ADR-006 + new top-level docs). ~36,677 lines of v1 content preserved on the legacy branch.

**The new ChipBlocks has a foundation.** Sprint 2 opens against master tip `96b3a38` (or wherever the next commit lands once this retro is committed).
