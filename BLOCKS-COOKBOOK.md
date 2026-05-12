# ChipBlocks block cookbook

> **Single canonical reference** for adding a block. Implements the workflow specified by [ADR-003](ADR-003-block-manifest.md) (block manifest at repo root + codegen). Per-block descriptions live in [BLOCKS.md](BLOCKS.md); architectural context lives in [ARCHITECTURE.md](ARCHITECTURE.md); this file is the *how-to-add-a-block* walkthrough.

## The whole thing in 30 seconds

Adding a block is a **3-file change** plus one command:

| File | Status | What it contains |
|---|---|---|
| `blocks.yaml` | edit (add one row) | cross-cutting metadata: type, label, color, category, ports, parameters |
| `frontend/src/blocks/<Name>Node.tsx` | new file | React Flow node component (UI) |
| `backend/blocks/<name>.py` | new file | Amaranth Elaboratable (chip-side logic) |

Then:

```
cd frontend
npm run codegen
```

That regenerates 7 cross-cutting files from `blocks.yaml`. Commit the manifest row, your two hand-written files, and the regenerated outputs together. CI's `codegen-drift` job rejects PRs where the regenerated state diverges from what the manifest declares.

## Walkthrough

### 1. Read the schema

[`blocks.schema.json`](blocks.schema.json) locks the row shape. Required fields: `type`, `label`, `description`, `color`, `category`, `componentPath`, `backendPath`, `backendClass`, `ports`. Optional: `parameters`, `cssMinHeight`, `cssMinWidth`, `tags`. Ports map handle id to `{dir: source|target, bus: <BusType>}`. The 53-member `BusType` enum is in [ADR-001](ADR-001-multi-bit-bus-types.md).

### 2. Copy a similar row in `blocks.yaml`

Pick a block of similar shape and edit. Quick guide:

- **Audio source** (1 output, optional `freq`): copy `oscillator` / `triangle` / `sawtooth` / `sine` / `wavetable`.
- **Audio effect** (1 in, 1 out, optional int param): copy `bitcrusher` / `delay` / `distortion`.
- **Filter** (1 in, 1 out, `cutoff_hz`-style param): copy `lowpass` / `highpass` / `bandpass`.
- **Boolean gate** (1- or 2-bit in, 1-bit out, no params): copy `and` / `or` / `xor` / `not`.
- **CPU primitive** (8-bit unsigned data, combinational, no params): copy `adder` / `subtractor` / `comparator` / `mux`.
- **CPU primitive** (clocked, 8-bit data, write-enable): copy `register` / `ram` / `registerfile`.
- **Visual** (VGA-domain, short port names): copy `solidcolor` / `pixelrange`.
- **String-enum parameter** (like `solidcolor.color` or `wavetable.shape`): see the **String-enum parameters** edge case below.
- **List parameter** (only ROM today): see the **`intArray` parameter** edge case below.

### 3. Write `frontend/src/blocks/<Name>Node.tsx`

Mirror the corresponding component file of the row you copied. Use the shared `useValidatedNumber` hook for any number inputs (gives you displayValue, isInvalid, errorMessage, onChange, onBlur). For multi-handle layouts, use `handleTop(slot)` from `./handleSpacing` to position handles at `slot * 32 + 24` pixels.

### 4. Write `backend/blocks/<name>.py`

Mirror the corresponding `.py` file. The `Elaboratable` class:

- Takes parameters as constructor kwargs (snake_case Python names, may differ from the manifest's camelCase or hyphenated names via the `backendParam` field — see the **`backendParam` renames** edge case).
- Exposes `input_ports` and `output_ports` dicts keyed by the manifest's handle id strings (the kebab-case wire-format names, not the Python signal names).
- Implements `elaborate(self, platform)` returning a `Module`.

### 5. Run codegen

```
cd frontend
npm run codegen
```

This runs both codegen scripts. If the output matches what's on disk, it exits 0 — you're done. If anything changed, it prints a unified diff and exits non-zero. The diff *is* your change; commit the regenerated files alongside the three hand-written ones.

### 6. Add tests

Two test files stay hand-written:

- **`backend/tests/test_blocks.py`** — add a property-based assertion. Most existing tests drive specific input patterns and assert the output matches a Python reference computation.
- **`frontend/test/blocks.test.tsx`** — add a render + parameter-editing test. The harness covers basics; add per-block edge cases (e.g. ROM's textarea, range-violation error messages).

Two more test files validate the manifest itself and pick up your new row automatically — usually no edits needed:

- **`frontend/test/manifest.test.ts`** — 3 invariants per block (componentPath exists, exports `${PascalCase}Node`, registered in `nodeTypes`). +3 dynamic cases when you land your row.
- **`backend/tests/test_manifest.py`** — same 3 invariants on the backend side.

### 7. Add a `BLOCKS.md` section

After landing the block, add a description under the right category heading in [BLOCKS.md](BLOCKS.md). The category heading matches the `category` field in your manifest row.

### 8. Add a paragraph to `frontend/src/ai/prompt.ts` `# Block library`

The AI consultant has two parallel block-aware sections in its system prompt:

- **`# Block reference`** — codegen-driven structural facts (block header + port list + parameter list). Updated automatically by `npm run codegen`. Source of truth for "does this port exist?".
- **`# Block library`** — hand-written rich behavioral prose (what's the block for, when to use it, how it composes with others). Hand-edited. Source of truth for "what should I use this block for?".

When you add a block, codegen handles `# Block reference`. **Manually add a 2-4 sentence paragraph** to `# Block library` describing the block's purpose, parameters in their musical/usage context, and one common-pattern hint (e.g. "compose with Adder for tiny multipliers"). Place it in the same logical position as your manifest row (between subtractor and comparator for a new CPU primitive; after distortion for a new effect; etc.).

Without this paragraph the AI consultant still knows the block *exists* (from the codegen section) but can't recommend it well in "build me a kick drum" / "what should I use here?" queries. Sprint 22's Shifter addition surfaced this drift mode — the codegen section had Shifter; the prose section didn't until a follow-up commit added the paragraph.

If you forget this step, nothing CI-breaks — but the AI consultant gets worse at *that block specifically* until someone (often a sprint later) catches the gap. Cheaper to do it now than to drift.

## The 7 generated sections (you don't edit these)

Codegen owns these regions inside hand-written files. Each is bracketed by marker comments (TypeScript / JavaScript use `// @begin codegen <slot>` / `// @end codegen <slot>`; CSS uses `/* @begin … */`; Python uses `# @begin …`; the AI prompt uses `<!-- @begin … -->` since it lives inside a JS template literal):

| File | Generated section | What's in it |
|---|---|---|
| `frontend/src/blocks/index.ts` | `blocks-imports`, `node-types`, `app-node-union` | per-block imports + `nodeTypes` map + `AppNode` discriminated-union type |
| `frontend/src/blocks/busTypes.ts` | `block-port-types` | `BLOCK_PORT_TYPES` dict (handle id → bus type per block) |
| `frontend/src/Palette.tsx` | `palette-array`, `default-data-for-type` | `PALETTE` array + the `defaultDataForType()` switch |
| `frontend/src/App.css` | `block-rules` | `.block-<type>` border-color + `min-height` / `min-width` rules |
| `frontend/src/ai/prompt.ts` | `block-reference` | structural per-block summary in `STATIC_SYSTEM` (the rich behavioral prose stays hand-written above this section) |
| `backend/blocks/__init__.py` | `block-imports`, `block-registry`, `block-all` | per-block imports + `BLOCK_REGISTRY` dict + `__all__` list |
| `backend/blocks/_params_gen.py` | whole-file | `build_params(node_type, data)` body — `synth.py`'s `_build_params` is a 3-line wrapper around this |

## Edge cases & future-proofing

### `cssMinHeight` + `cssMinWidth` — when to set them

Most blocks render fine with the default block dimensions (a couple of right-side handles, one row of body content). Multi-handle blocks need explicit minimums or React Flow's handles overlap with the title / body / each other. Rule of thumb:

- **2 right-side outputs or fewer + ≤ 3 left-side inputs + zero or one parameter rows** → omit both fields (default is fine).
- **3+ handles on either side** → set `cssMinHeight` to `24 + 32 * (max_handle_count - 1) + 32` pixels (matches `handleTop()` spacing). Example: VgaTiming has 5 outputs at slots 0..4 → `cssMinHeight: 180`.
- **Multi-row parameter blocks** (ADSR has 4 number inputs, FM has 3) → set `cssMinWidth: 150` so the labels + inputs + units don't wrap.
- **ROM's textarea** is wider than a normal input → `cssMinWidth: 200`.
- **CPU primitives with 2 left + 2 right handles** (Adder, Subtractor) → `cssMinHeight: 110, cssMinWidth: 130` keeps everything aligned.

When unsure, mirror the closest existing block.

### Port-naming conventions

The handle id strings appear on the canvas (next to the handle dot), in the AI prompt's tool-call schema, and as keys in `BLOCK_PORT_TYPES`. Conventions by category:

| Category | Convention | Examples |
|---|---|---|
| Audio sources / effects / filters | kebab-case, `audio-` prefix | `audio-in`, `audio-out`, `mix-out` |
| Mixer + Multiply | numbered inputs | `in-1`, `in-2` |
| Gate / clock / control signals | kebab-case, semantic name | `gate-in`, `gate-out`, `clock`, `gate` |
| VGA visual blocks | short single-token | `r`, `g`, `b`, `hsync`, `vsync`, `visible`, `x`, `y`, `pixel`, `inside` |
| Bus composition | `bus-in` / `bus-out` for wide, `bit-N` for narrow | `bus-in`, `bit-0`, `bit-1`, …, `bit-7` |
| CPU primitives | `in-a`/`in-b` for operands, `<op>-out` for results | `in-a`, `in-b`, `sum-out`, `carry-out`, `diff-out`, `borrow-out`, `eq-out`, `lt-out`, `gt-out`, `data-out` |
| Register / RAM | `data-in`, `data-out`, `write-enable`, `addr` (or `read-addr` + `write-addr` for the file) | as listed |
| Reinterpret bridge | input keeps the source name, output keeps the target name | `data-in` → `audio-out` |

When adding a new block in an existing category, match the category's naming. When inventing a new category, pick names that hint at the domain (audio / video / address / data) and resist abbreviation — `addr-out` not `ao`.

### `backendNeedsSampleRate`

Some blocks need to know the audio sample rate (44 100 Hz) to compute phase-accumulator increments, ADSR-stage tick counts, or filter coefficients. Set this flag on parameters of those blocks; codegen-backend will emit `sample_rate=SAMPLE_RATE` as an additional kwarg to the constructor. Currently set on:

- All audio sources whose pitch depends on the sample rate: `oscillator`, `triangle`, `sawtooth`, `sine`, `wavetable`, `fm`.
- Envelope / clock blocks: `adsr` (attack/decay/release durations are ms), `gate` (rate is Hz).
- Filters: `lowpass`, `highpass`, `bandpass` (cutoff is Hz).

Blocks that are sample-rate-independent (`bitcrusher` quantizes bits; `delay` counts samples; `distortion` clips amplitudes; `noise` advances per cycle regardless; all CPU primitives) do NOT set this flag.

### `backendParam` renames

The manifest's parameter key is what the renderer stores in `node.data`. The backend constructor's kwarg name can differ if the Python convention diverges from the JSON one. Set `backendParam: <new_name>` to drive the rename. Today's renames:

- `oscillator.freq` (and friends) → `freq_hz` in Python (units explicit on the backend; bare `freq` on the JSON wire keeps existing graphs compatible).
- `wavetable.freq` → `freq_hz` (same).

When the manifest key already matches the Python convention, omit `backendParam`.

### The `intArray` parameter type

Only `rom.contents` uses this today. The manifest declares `type: intArray` with a default of an array of 16 zeros. The codegen knows to:

- Generate the React Flow textarea input (with the comma-separated parse / validate / render shape that ROMNode.tsx implements).
- Generate Python's `data.get("contents", [])` extraction + clamp-to-byte-range / pad-to-16 normalization.

If a second `intArray`-shaped block lands later (a wider ROM? a wavetable-as-data input?), the schema is already prepared; you just declare the same type. If you need a different list shape (different element width, different length), extend the schema in the same commit — keep one ADR per schema change.

### The `tags` field

Defined in the schema but **no UX yet**. Empty array `[]` is the current convention. When a tag system lands (badges in the palette for "experimental" / "deprecated" blocks, filters in the Examples menu, etc.), set the tag in the manifest row; codegen will pick it up. Until then, leaving the field empty is correct.

## What CI catches

A single CI job called `codegen-drift` runs both scripts on every PR and fails if the working tree diverges from what the manifest would produce. Two common failure shapes:

- **You edited `blocks.yaml` and forgot `npm run codegen`.** CI fails with a diff showing the generated sections it would have written.
- **You hand-edited inside a `@begin codegen` / `@end codegen` region.** CI fails with the same diff in reverse — your edit gets rewritten on the next codegen run, so the PR is rejected and you're nudged to put the change in the manifest instead.

A typical drift failure looks like:

```
FAIL: scripts/codegen-frontend.mjs reports drift in frontend/src/blocks/index.ts
--- a/frontend/src/blocks/index.ts
+++ b/frontend/src/blocks/index.ts  (regenerated from blocks.yaml)
@@ -47,6 +47,7 @@
 import { AndNode } from './AndNode';
 import { OrNode } from './OrNode';
 import { XorNode } from './XorNode';
+import { ShifterNode } from './ShifterNode';
```

The fix is always: `cd frontend && npm run codegen && git add -u`.

## Adjacent doc-discipline rules

- **`package-lock.json` must stay in sync with `package.json`.** CI's `npm ci` step rejects PRs where they don't. When a code change adds a frontend dependency, run `npm install` in the same commit. (Caught the Sprint 21 fixup commit `9c71bfb`: js-yaml + ajv landed in package.json without a regenerated lock file → CI red.)
- **`requirements-dev.txt` is similarly pinned.** Backend codegen dependencies (`PyYAML`, `jsonschema`) live there; add new backend deps via that file, not as bare `pip install` in the CI workflow.
- **Bump `BLOCKS.md`'s top-line block count when you add a row.** It's not codegen'd; it's a human-readable "shipping N blocks" line near the top of the file. Catches the eye in PRs.

## Contributing a bundled example

The cookbook above is for adding a new *block*. Adding a new *bundled example graph* in `examples/` is a parallel but smaller workflow. Each `.json` example is a "source file" the rest of the project compiles down to a real chip (FPGA bitstream or Tiny Tapeout submission), so example graphs are first-class shipping artefacts — they're loaded into the app on every release, exercised by the [examples-consistency test](../frontend/test/examples-consistency.test.ts), and read by the AI consultant for "show me an example of X" queries.

### What licences are acceptable for the underlying design

If your example is based on a specific published circuit / algorithm / chip, the underlying material must be in **one** of these categories:

| Category | Examples | What to check |
|---|---|---|
| **Permissively licensed source code** (MIT / Apache 2.0 / BSD-2/3 / ISC / CC0) | A Tiny Tapeout submission (default Apache 2.0); the SkyWater PDK; a permissively-tagged GitHub repo | Read the `LICENSE` file directly; don't trust GitHub's licence-detector heuristic |
| **Patent-expired technique** | Chowning FM (US 4,018,121 — expired 1994); Karplus-Strong (US 4,649,783, 4,622,877 — expired 2004/2005); the 555 timer (US 3,652,888 — expired 1988) | Cite the patent number + expiry date in `CREDITS.md`. Patent text itself is public domain |
| **Generic textbook technique** | Binary ripple-counter chains; subtractive-synthesis hi-hat; standard analog modular patches | No specific authorship to credit; flag as MEDIUM confidence in provenance research |
| **Public-domain primary source** | Forrest Mims's 1980 Radio Shack books (topology / facts not copyrightable, only specific schematic drawings); US government publications | Cite the source; reproduce facts only, not the original artwork |

**Disqualifying licences** (do NOT contribute examples derived from these — same rule as for new blocks):

- GPL / LGPL / AGPL — reciprocal licences would force ChipBlocks downstream
- CERN-OHL — "weak" copyleft variant, same incompatibility
- CC-BY-NC / CC-BY-ND / CC-BY-SA — non-commercial, no-derivatives, or share-alike clauses all conflict with our permissive shipping
- "Royalty-free" stock-content licences (VectorStock, Freepik free tier) — require attribution and prohibit redistribution as part of standalone products
- Anything without an explicit licence file — default copyright is "all rights reserved"

If you're not sure, ask via a draft PR before doing the work. The provenance research in [`OPEN-CHIP-LIBRARY-RESEARCH.md`](../OPEN-CHIP-LIBRARY-RESEARCH.md) and [`OPEN-CHIP-LIBRARY-PROVENANCE.md`](../OPEN-CHIP-LIBRARY-PROVENANCE.md) shows the level of citation chain expected for historical designs.

### The four files you touch

Adding an example graph is a **4-file change** plus one optional codegen run:

1. **`examples/<design-id>.json`** — the graph itself. The fastest path: open ChipBlocks, wire the design on the canvas, hit **Save**, move the downloaded file into `examples/`. Hand-edit only to set a stable `id` and `savedAt`.

2. **`frontend/src/examples.ts`** — add a new entry to the `EXAMPLES` array mirroring the JSON. The `examples-consistency` test diffs the TS entry against the JSON file on every CI run; they must agree on `nodes` and `edges` exactly. Order in the TS array matches order in the Load → Examples menu.

3. **`examples/README.md`** — add a row to the category table (or a new table if the design opens a new category). Cite the historical source if applicable.

4. **`CREDITS.md`** — only if the design has a specific historical source that requires (or merits) attribution. Use the existing "Starter chip designs" section as the template; one bullet per example.

If the example needs a **new block** that doesn't exist yet, that's a block-cookbook contribution — follow the full 8-step walkthrough above for the block, then ship the example as a follow-on commit.

### Pre-shipping checklist

Before opening a PR with a new example:

- [ ] Graph **plays cleanly via ▶ Play** (or builds cleanly via 🔧 Build → iCEBreaker for visual-only graphs)
- [ ] No connections rejected by the typed-bus validator (load the file once to confirm)
- [ ] All four files (`examples/<id>.json`, `examples.ts`, `examples/README.md`, optionally `CREDITS.md`) updated together in one commit
- [ ] Historical sources cited in `CREDITS.md` with **explicit licence / patent-expiry / textbook rationale** — not "open" or "free" by itself
- [ ] `cd frontend && npm test -- --run examples-consistency` passes locally
- [ ] If the example uses any new blocks added in the same PR, the block-cookbook checklist (above) is also satisfied

The bundled examples are the first thing many users see — they're effectively the project's curated demo reel — so the bar is higher than for user-side designs. Aim for one design per example, clearly named, with the historical / educational story documented up front.

## See also

- [ADR-003](ADR-003-block-manifest.md) — the architectural decision that produced this workflow.
- [BLOCKS.md](BLOCKS.md) — per-block reference (ports, parameters, behavior). Hand-written.
- [ARCHITECTURE.md](ARCHITECTURE.md) — overall code layout. Points back here for block-authoring details.
- [CONTRIBUTING.md](CONTRIBUTING.md) — external-contributor on-ramp. Points back here for the deep version.
- [SPRINT-21.md](SPRINT-21.md) — implementation log for ADR-003. Includes the byte-equality validation pass + parallel-agent-dispatch pattern that built this workflow.
