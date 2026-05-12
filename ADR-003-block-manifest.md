# ADR-003: Block manifest as the single source of truth for block metadata

**Status:** Proposed (2026-05-11) · **Deciders:** solo dev (you) + Claude Code · **Implements:** Sprint 21 (planned; opens after this ADR is accepted)

> Third project ADR. Builds on [ADR-001](ADR-001-multi-bit-bus-types.md) (typed bus system) and [ADR-002](ADR-002-cpu-primitives.md) (CPU primitive set). With 42 blocks shipping and three sprint retros in a row (S18 / S19 / S20) flagging the same trigger condition, the "8-files-per-block cookbook" has reached the end of its useful life. This ADR specifies the replacement: a single manifest row per block, with codegen producing the registries and tables on both sides of the wire.

## Context

Adding a new block today touches **9 files**, not the 8 the cookbook officially counts (the AI prompt at `frontend/src/ai/prompt.ts` is the silent ninth):

1. `backend/blocks/<name>.py` — Amaranth Elaboratable (custom logic, **stays hand-written**)
2. `backend/blocks/__init__.py` — import + `BLOCK_REGISTRY` dict entry + `__all__` list
3. `backend/synth.py` `_build_params()` — only if the block has parameters
4. `frontend/src/blocks/<Name>Node.tsx` — React component (custom UI, **stays hand-written**)
5. `frontend/src/blocks/index.ts` — import + `nodeTypes` map + `AppNode` union
6. `frontend/src/Palette.tsx` — `PALETTE` entry + `defaultDataForType` switch case
7. `frontend/src/blocks/busTypes.ts` — `BLOCK_PORT_TYPES` entry
8. `frontend/src/App.css` — `.block-<name>` border-color (and min-height for multi-handle blocks)
9. `frontend/src/ai/prompt.ts` — block list mention + tool-call schema description

Tests (`backend/tests/test_blocks.py`, `frontend/test/blocks.test.tsx`) and the user-facing reference doc (`BLOCKS.md`) also need updating but are out-of-scope for codegen — both are inherently hand-written.

The repeated pattern is now visibly causing harm:

- **ByteConstant (S19) was missed in 3 of 4 announcement drafts and the AI prompt's block list** — caught in the S20 doc pass, but it would have shipped wrong if S20 hadn't dusted off ANNOUNCEMENT-DRAFTS for an unrelated reason.
- **Every sprint since S17 spends ~30% of its effort on doc bumps** when adding a block. That's project hygiene cost paid out of feature time.
- **Uniform clusters pay the cookbook tax in full each time.** The 7 CPU primitives (Adder, Subtractor, Comparator, Mux, Register, RAM, Register File, ROM, ByteConstant — actually 9) share the same data-u8 shape; the 6 audio-effect blocks share the same audio-s8 in/out shape; the 4 boolean gates share the same gate-1 shape. Adding the *third* block in a cluster pays the same 9-file cost as the first.

The trigger condition documented in ROADMAP.md ("block #35 OR five-blocks-of-uniform-shape") was met in S18 and reaffirmed in S19 and S20. This ADR is the deferred response.

**Why this matters to the user.** The user is non-technical, runs ChipBlocks as a side project, and feels the doc-drift cost directly — "I have to remember to update 9 files when I add a block, and even Claude Code misses one sometimes." Cutting the per-block hand-edited surface from 9 files to ~2 (Amaranth + React component) means future block additions cost ~20% of today's effort and stop creating doc-drift bugs.

## Decision

**Adopt `blocks.yaml` at the repo root as the single source of truth for cross-cutting block metadata.** Each of the 42 blocks gets one row with columns for type / label / description / color / category / ports / parameters / componentPath / backendPath / tags. A pair of small permissively-licensed codegen scripts (one Node + one Python) reads the manifest and writes generated sections into the 7 cross-cutting files; the two **hand-written** files per block (the `.tsx` component and the `.py` Elaboratable) are referenced by path and never touched by codegen. **Generated files stay checked in**; a CI step re-runs codegen on every PR and fails if the working tree diverges. No pre-commit hook — the user shouldn't have to remember anything.

Block count stays at 42; behavior of every existing block is unchanged. The refactor is structural, not functional.

## Manifest shape

Each block row:

```yaml
- type: oscillator                       # React Flow node.type, BLOCK_REGISTRY key, busTypes key — one string everywhere
  label: Oscillator                      # palette + node title
  description: Square wave source        # palette tooltip
  color: '#4caf50'                       # palette swatch + App.css border-color
  category: source                       # palette grouping + BLOCKS.md TOC section
  componentPath: frontend/src/blocks/OscillatorNode.tsx   # reference only; codegen never reads it
  backendPath: backend/blocks/oscillator.py               # reference only; codegen never reads it
  backendClass: Oscillator               # the Python class symbol exported from that file
  ports:
    audio-out: { dir: source, bus: audio-s8 }
  parameters:
    freq:
      type: int
      min: 20
      max: 20000
      default: 440
      label: Frequency
      unit: Hz
      backendParam: freq_hz              # mapping for synth.py _build_params; omit if same as `freq`
      backendNeedsSampleRate: true       # synth.py adds sample_rate=SAMPLE_RATE to the kwargs
  cssMinHeight: null                     # only set for multi-handle blocks (e.g. VgaTiming 180px)
  tags: []                               # experimental | deprecated | future-proofing — empty for now
```

The 42 rows total ~600 lines of YAML — comparable in size to today's `BLOCK_PORT_TYPES` plus `PALETTE` plus `_build_params` combined, but with each fact stated exactly once.

**What is codegen-able vs hand-written:**

| Surface | Hand-written / codegen |
|---|---|
| `backend/blocks/<name>.py` (Elaboratable) | **Hand-written** — custom HDL logic per block |
| `frontend/src/blocks/<Name>Node.tsx` (React component) | **Hand-written** — custom UI per block |
| `backend/blocks/__init__.py` (imports + `BLOCK_REGISTRY` + `__all__`) | **Codegen** |
| `backend/synth.py` `_build_params()` | **Codegen** (a generated function called from a thin stable wrapper) |
| `frontend/src/blocks/index.ts` (imports + `nodeTypes` + `AppNode`) | **Codegen** |
| `frontend/src/blocks/busTypes.ts` `BLOCK_PORT_TYPES` only | **Codegen** (the enum / helpers stay hand-written) |
| `frontend/src/Palette.tsx` `PALETTE` + `defaultDataForType` only | **Codegen** (the React component stays hand-written) |
| `frontend/src/App.css` `.block-<name>` rules block | **Codegen** (delimited by marker comments) |
| `frontend/src/ai/prompt.ts` block-list section + tool-call schema | **Codegen** (delimited by marker comments) |
| `BLOCKS.md` TOC + block count | **Codegen** (TOC + count only; per-block prose stays hand-written) |
| Tests | **Hand-written** — out of scope |

## Manifest format — why YAML at repo root

Four options were considered:

- **TypeScript object** at `frontend/src/blocks/manifest.ts` — rich types, but Python codegen has to import a TS file. Either parse it as JS (fragile) or run a `tsc --emit json` build step (slow, adds tooling). Asymmetric: frontend has type-checked native access; backend has to do work.
- **Python data module** at `backend/blocks/manifest.py` — mirror of the TS option, same asymmetry in reverse.
- **JSON** at `blocks.json` — both sides read natively; trivial. But hand-editing JSON is unfriendly (no comments, no trailing commas, quoted keys). Three sprint retros said the user hand-edits docs; the manifest has to be hand-editable.
- **YAML** at `blocks.yaml` at the repo root — **chosen.** Both sides read natively (`js-yaml` for TS, `PyYAML` for Python — both MIT-licensed). Comments, no trailing-comma noise, quoted strings only where needed. Trades TS structural type-checking for a runtime JSON Schema validation step at codegen time. Schema lives next to the manifest as `blocks.schema.json`; codegen aborts on schema-violation with a friendly error.

YAML wins on **uniformity** (both languages read it the same way) and **hand-editability** (the user can read and tweak it directly). The lost TS-type-checking is replaced by a JSON Schema validator that catches the same errors at codegen time rather than at TS compile time.

## Codegen strategy

Two scripts, both MIT-permissively-licensed dependencies:

### `scripts/codegen-frontend.mjs` (Node, ~150 LOC)

- **Reads:** `blocks.yaml`, `blocks.schema.json`
- **Writes:** 5 generated sections inside hand-written files, delimited by:
  ```ts
  // @begin codegen blocks-registry — do not edit; generated from blocks.yaml
  ...
  // @end codegen blocks-registry
  ```
- **Targets:** `frontend/src/blocks/index.ts` (imports + `nodeTypes` + `AppNode`), `frontend/src/blocks/busTypes.ts` (`BLOCK_PORT_TYPES`), `frontend/src/Palette.tsx` (`PALETTE` + `defaultDataForType`), `frontend/src/App.css` (`.block-<name>` rules), `frontend/src/ai/prompt.ts` (block list + tool-call schema)
- **Deps:** `js-yaml` (MIT), `ajv` (MIT). Both already in the dev-dep universe of the React tooling; net add ~50 KB.

### `scripts/codegen-backend.py` (Python, ~120 LOC)

- **Reads:** same `blocks.yaml` + schema
- **Writes:** `backend/blocks/__init__.py` (imports + `BLOCK_REGISTRY` + `__all__`) and a new module `backend/blocks/_params_gen.py` whose `build_params(node_type, data)` is imported and called from `synth.py`'s `_build_params` (which becomes a 3-line stable wrapper).
- **Deps:** `PyYAML` (MIT), `jsonschema` (MIT). Both already on PyPI in the project's typical install footprint.

### Where codegen runs

**Generated files stay committed to git.** Anyone editing `blocks.yaml` re-runs `npm run codegen` (or the equivalent Python invocation), commits both the manifest change and the regenerated outputs, and pushes. A new CI job `codegen-drift` runs both scripts on the PR branch and `git diff --exit-code`s — fails the PR if the working tree diverges from manifest output.

**No pre-commit hook.** The user is non-technical; pre-commit hooks fail silently for users not on a dev machine and are a known support drag. CI catches drift; the user only needs to remember `npm run codegen` after editing `blocks.yaml`, and CLAUDE.md / CONTRIBUTING.md document this in one line.

This is identical in shape to how `tsc` / `vite build` work today — generated build artifacts could be regenerated, but they're not, because committing them keeps the dev loop fast.

## Phased migration plan

### Phase 0 — Manifest + codegen scaffolding (no behavior change)

- Add `blocks.yaml` populated from the current state of `BLOCK_REGISTRY` + `BLOCK_PORT_TYPES` + `PALETTE` + `_build_params` + App.css + the AI prompt. Author by hand, cross-check by eye against the existing tables.
- Add `blocks.schema.json` with the JSON-Schema definition of a row.
- Write `scripts/codegen-frontend.mjs` and `scripts/codegen-backend.py`. Each writes to a temp file first, byte-diffs against the live file, fails if non-empty.
- Run both scripts. **Assert byte-for-byte equality** with the current hand-written generated sections. Iterate the codegen templates until the diff is empty.
- Add CI `codegen-drift` job. Add `npm run codegen` script. Update CLAUDE.md / CONTRIBUTING.md one-liner.
- **No block file changes yet.** Everything still hand-written; manifest exists in parallel.
- **Estimate: 4 hours.** Mostly template-writing and chasing trailing whitespace / import ordering until the byte-diff is clean.

### Phase 1 — Cut over (single commit)

- Replace the hand-written generated sections in all 5 frontend files + 2 backend files with the codegen output (which now matches byte-for-byte from Phase 0). Add the marker comments delimiting generated regions.
- Run the full test suite: 161 frontend vitest + 63 backend pytest. Zero changes expected.
- **No pilot block.** Phase 0's byte-equality assertion is a stronger guarantee than migrating one block first: if the output matches all 42 blocks byte-for-byte, individual blocks need no separate validation.
- **Estimate: 1 hour.** Mechanical cut-over + test run.

### Phase 2 — Reap the savings (deferred to Sprint 22+, not part of Sprint 21)

- After Sprint 21 lands, every subsequent block addition uses the new path: edit `blocks.yaml` + write the `.tsx` + write the `.py`, run `npm run codegen`, commit. 9 files become 3.
- After two or three blocks land via the new path with no friction, retire the "8-file cookbook" sections in ARCHITECTURE.md and CONTRIBUTING.md; replace with "add-a-block under the manifest" walkthrough. **Doc-only**, ~30 min.

**Total Sprint 21 estimate: 5 hours.** (Phase 0 + Phase 1.) The S18 retro's 6-hour budget was right; this estimate fits inside it with a small buffer for the inevitable schema-edge-case discovery during template iteration.

## Tests and verification

The refactor is a structural reshuffle; behavior must be byte-identical.

1. **Byte-equality assertion in Phase 0.** Both codegen scripts compare their output against the currently-checked-in file content and fail loudly on any diff. This is the canonical signal that codegen produces what's already shipping.
2. **Existing test suite passes unchanged.** 161 frontend vitest + 63 backend pytest. Zero edits to test files in either phase. If any test fails, the codegen is wrong.
3. **A new tiny test** at `frontend/test/manifest.test.ts` and `backend/tests/test_manifest.py` asserts: (a) every block in `blocks.yaml` maps to a real `.tsx` and `.py` file on disk at the declared path; (b) every `componentPath` exports a symbol matching the manifest's block name; (c) every `backendClass` exists as an importable class. Catches the "manifest references a file that doesn't exist" failure mode that the type system alone can't catch with YAML.
4. **Existing graph round-trip tests cover save-format compatibility.** No save-format changes, so existing roundtrip tests are sufficient.
5. **CI `codegen-drift` job is the long-term canary.** Anyone edits a generated file by hand, CI flags it. Anyone edits `blocks.yaml` without running codegen, CI flags it.

## Consequences

**Becomes easier:**
- Adding a new block: edit one row in `blocks.yaml` + write the `.tsx` + write the `.py`. 3 files instead of 9. Run `npm run codegen`. Commit both manifest + regenerated outputs.
- ByteConstant-style drift is structurally impossible: if a block isn't in the manifest, it doesn't exist in any registry; if it is, it's everywhere.
- The AI consultant's block list stays in lockstep with the actual catalog — no more "ANNOUNCEMENT-DRAFTS forgot ByteConstant" failure mode.
- Bulk renames / category-restructures become one-line edits in `blocks.yaml`.

**Becomes harder:**
- The manifest itself becomes a critical-path file. A YAML syntax error or a schema-rule violation blocks all codegen until fixed. The friendly-error work in the schema validator is what makes this acceptable — the user gets "row 23: missing required field `category`" not a stack trace.
- A new dependency on `js-yaml` + `ajv` (frontend) and `PyYAML` + `jsonschema` (backend). All MIT-licensed; all already-common in the respective ecosystems. Negligible footprint.
- One-time cost of writing the codegen templates. ~150 + ~120 LOC; tedious but mechanical.

**To revisit when:**
- The 53-member `BusType` union grows to the point that JSON Schema validation of port types becomes meaningfully slow (unlikely — even at 200 members it's milliseconds).
- A block needs metadata not anticipated here (e.g. an "FPGA pin assignment" column when peripherals start landing). Adding a column is one schema edit + one codegen template addition; cheap.
- The hand-written `.tsx` + `.py` per block start showing their own boilerplate clusters worth abstracting. **Not anticipated** — those files genuinely contain custom logic that benefits from being explicit.

## Alternatives considered

### Option A — Filesystem auto-discovery (no manifest file)

Each `.tsx` / `.py` file exports its own metadata as constants (`export const BLOCK_TYPE = 'oscillator'`, etc.). Codegen globs the directory and reads the exports.

| Dimension | Assessment |
|---|---|
| Complexity | High (TS exports parsed in Node, Python exports parsed in Python — two parsers) |
| Cost (build effort) | ~2 sprints |
| Cost (user UX) | Mixed — adding a block is "write the file, that's it" but cross-block view requires opening 42 files |

**Reject:** loses the single-pane-of-glass view of all 42 blocks. The user's stated value is "I want one place to see what we have"; a manifest file delivers that, auto-discovery doesn't.

### Option B — TypeScript-as-source-of-truth (manifest.ts, codegen Python only)

Manifest lives in `frontend/src/blocks/manifest.ts` with real TS types. Python codegen reads it via a `tsc`-extracted JSON artifact.

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Cost (build effort) | ~1.5 sprints (the TS-to-JSON extract step is new tooling) |
| Cost (user UX) | Asymmetric — frontend has type-checked native access, backend goes through a build step |

**Reject:** the asymmetry creates two failure modes (TS compile error and Python codegen error) for one logical action. YAML keeps the failure mode singular.

### Option C — Don't refactor; live with the cookbook

Three sprint retros have flagged this as the right next move; not refactoring is the explicit alternative.

**Reject:** the doc-drift bug rate is rising (ByteConstant missed in S19, caught in S20; pattern likely to repeat). The cookbook tax is paid linearly with block count, and the roadmap calls for more blocks (Shifter, wider widths, peripherals). Cost compounds; pay it once now.

### Option D — Bigger refactor: also extract `.tsx` + `.py` shapes into a generator

Have the codegen also stamp out skeleton `.tsx` and `.py` files from the manifest, leaving the user to fill in the custom logic.

**Reject:** over-engineers. The `.tsx` and `.py` files contain genuine custom logic (HDL, React event handlers, layout decisions) that resist templating. A skeleton-stamping codegen would either be too prescriptive (limiting what blocks can do) or so flexible that it amounts to a literate-programming layer. The cost of writing those two files by hand is small and not what's hurting; the cost of the 7 cross-cutting files is what's hurting. Address the latter, leave the former alone.

## Action items — Sprint 21

Each lands as a single commit on a branch, in this order:

1. [ ] **`blocks.yaml` + `blocks.schema.json`** at repo root. 42 rows hand-authored from the current state of the codebase. Schema validates the row shape. ~600 lines of YAML + ~80 lines of schema.

2. [ ] **`scripts/codegen-frontend.mjs`** (Node, ~150 LOC). Reads `blocks.yaml`, writes 5 generated sections (delimited by marker comments) inside the 5 frontend target files. Initial run-mode is `--check` — fails with byte-diff if output would change anything. Dependencies: `js-yaml`, `ajv`.

3. [ ] **`scripts/codegen-backend.py`** (Python, ~120 LOC). Same shape for the 2 backend target files (`backend/blocks/__init__.py`, new `backend/blocks/_params_gen.py`). Synth.py becomes a 3-line wrapper around `_params_gen.build_params(node_type, data)`. Dependencies: `PyYAML`, `jsonschema`.

4. [ ] **Byte-equality validation pass.** Run both scripts in `--check` mode against the current tree. Iterate templates until both report zero diff. **This is the critical gate** — if Phase 0 ends with the codegen producing the same bytes as today, the cutover in step 6 is mechanical.

5. [ ] **CI `codegen-drift` job** in `.github/workflows/ci.yml`. Runs both scripts in `--check` mode on every PR; fails on drift. Add `npm run codegen` script to `frontend/package.json` that runs both. One-line documentation in CLAUDE.md and CONTRIBUTING.md: "after editing `blocks.yaml`, run `npm run codegen`."

6. [ ] **Cutover commit.** Replace the hand-written generated sections in the 7 target files with the codegen output. Add the `@begin codegen` / `@end codegen` marker comments. Run full test suite (161 vitest + 63 pytest). Zero test changes expected.

7. [ ] **Manifest-integrity test.** New `frontend/test/manifest.test.ts` + `backend/tests/test_manifest.py` (small, ~3 cases each): every block in the manifest references a real component file with the expected exported symbol. Test count rises 161 → 164 / 63 → 66.

8. [ ] **Doc bumps.** ARCHITECTURE.md and CONTRIBUTING.md: replace the "8-file cookbook" walkthrough with the manifest-based walkthrough. KNOWN-ISSUES.md and ROADMAP.md: mark tech-debt item A1 as resolved. CLAUDE.md: one-line `npm run codegen` reminder.

9. [ ] **Sprint retro.** SPRINT-21.md captures what surfaced. Most likely surfacing: an edge case in the AI prompt or App.css that the byte-equality check found.

**Estimated effort: 5 hours.** Highest risk in step 4 — the byte-equality validation. App.css's `.block-<name>` rules ordering and the AI prompt's free-form text sections are the two surfaces most likely to require fiddly template iteration. Plan for ~1 hour each on those two targets; the other 5 are mechanical.

## What this unblocks

After Sprint 21 lands:

- **Sprint 22+ block additions cost ~20% of today's effort.** A "Shifter" block becomes: 1 manifest row + 1 `.tsx` + 1 `.py` + 1 codegen run. The pending Shifter / Register File width-variant / 8-bit-address-RAM blocks all become cheap.
- **Doc lint becomes trivial.** A "every PALETTE entry is mentioned in ANNOUNCEMENT-DRAFTS" check (S20 retro candidate) is now just a YAML iteration over `blocks.yaml`.
- **The AI consultant's "what blocks exist" answer is structurally correct.** The block list inside the prompt is generated from the same source as the palette; the two cannot disagree.
- **Bulk operations are possible.** Changing the entire CPU-primitive cluster from `data-u8` to `data-u16` becomes a YAML find/replace + a codegen run, not a 9-file-per-block hand-edit.
