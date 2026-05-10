# Sprint Plan: Sprint 18 — Bridge + conditional-control trio (closing Sprint 17 surfacings)

> **Solo dev + Claude Code** · Drafted + opened 2026-05-10 · Successor to [SPRINT-17.md](SPRINT-17.md) · No ADR (the design space is small enough that the Sprint 17 retro + the existing block patterns specify everything).

**Status:** **CLOSED 2026-05-10.** All 4 blocks + the worked examples + the doc updates landed in a single coherent change. No ADR needed; the 8-files-per-block cookbook is well-trodden enough that 4 more blocks fit the uniform shape with no surprises.

**Sprint Goal:** *Ship the 4 blocks that close the two specific surfacings from the Sprint 17 retrospective: a Reinterpret bridge for the `data-u8` ↔ `audio-s8` sign-class barrier, and the conditional-control trio (Subtractor, Comparator, Mux) needed for real instruction-decoding patterns. Block count 36 → 40. After this sprint, the CPU primitives can drive audio and the worked examples include a counter that resets at a target value — a branchable program in two new blocks.*

---

## Why now

Sprint 17 shipped the 4 minimum-viable CPU primitives (Adder, Register, RAM, ROM) at 8-bit data + 4-bit address. The retrospective called out two specific friction points:

1. **The data-u8 ↔ audio-s8 sign-class barrier.** Per ADR-001's correctly-strict sign-class rules, the validator rejects the cross. CPU primitives produce `data-u8`; audio Output expects `audio-s8`. There's no clean composition without a reinterpret block. Without it, every CPU-domain-to-audio-domain demo lives in its own silo.
2. **The accumulator demo can't branch.** Real instruction-decoding CPUs need conditional control — Comparator (to test running values against targets) and Mux (to pick between two data values based on a flag). Subtractor pairs naturally with Adder for completeness; the three together close the conditional-control trio.

These 4 blocks unblock two specific patterns: "drive a CPU accumulator into audio" (Reinterpret) and "build a counter that resets at a target value" (Comparator + Mux + Reinterpret). Both ship as bundled examples this sprint.

The block-manifest refactor's trigger condition (KNOWN-ISSUES item A1: "block #35 OR five-blocks-of-uniform-shape") is now met — Adder / Subtractor share the exact same shape, plus 7 of the 7 CPU primitives all fit a uniform `data-u8`-in / `data-u8`-or-flag-out pattern. This sprint deliberately doesn't take on the manifest refactor; it's a separate dedicated sprint. Just keep the 8-files-per-block pattern uniform across these 4 new blocks.

---

## Working Assumptions

| Assumption | Default | Change if... |
|---|---|---|
| Sprint length | **single focused day** (4 blocks + 1 worked example update + 1 new worked example + doc updates) | Hidden complexity in the conditional-control composition |
| Stack | unchanged from S17 | n/a |
| Block count target | 36 → 40 (Reinterpret, Subtractor, Comparator, Mux) | n/a |
| Save-format | unchanged (the 4 new blocks are all parameterless) | n/a |
| Tracking | git commits + this `SPRINT-18.md` log | n/a |

---

## Sprint Goal — concrete targets

### S18-1 — Reinterpret block (data-u8 → audio-s8 bridge)

- Backend `backend/blocks/reinterpret.py`. Combinational. The Amaranth-level operation is `audio_out.eq(data_in.as_signed())` — same bits, different sign interpretation.
- Frontend `ReinterpretNode.tsx`. Single input handle `data-in: data-u8`, single output `audio-out: audio-s8`. No parameters. Tiny block; <30 LOC of TSX.
- Type id: `reinterpret`
- Palette category: appended to "Bus" group (alongside BusSplit / BusJoin — these are all bus-rewiring blocks).
- Backend test: drive `data-in=0`, assert `audio-out=0`; drive `data-in=128`, assert `audio-out=-128` (the high bit becomes the sign bit, classic 2's-complement reinterpretation). Plus a few in-between values to confirm the low 7 bits pass through.
- BLOCK_PORT_TYPES: `reinterpret: { 'data-in': 'data-u8', 'audio-out': 'audio-s8' }`

### S18-2 — Subtractor block (mirror Adder shape)

- Backend `backend/blocks/subtractor.py`. Combinational. `diff_out.eq(in_a - in_b)` truncated to 8 bits; `borrow_out.eq(in_a < in_b)`.
- Frontend `SubtractorNode.tsx`.
- Type id: `subtractor`
- Palette category: same "Computation" group as Adder.
- Backend test: `Constant(50) - Constant(20) → 30, borrow=0`; `Constant(20) - Constant(50) → 226 (mod 256), borrow=1`; equal operands → diff=0, borrow=0.
- Mirrors Adder's split-output shape (NOT the original ADR-002 single-output shape) — that's the actually-shipped pattern for the rest of the data path.
- BLOCK_PORT_TYPES: `subtractor: { 'in-a': 'data-u8', 'in-b': 'data-u8', 'diff-out': 'data-u8', 'borrow-out': 'gate-1' }`

### S18-3 — Comparator block (single block, 3 outputs)

- Backend `backend/blocks/comparator.py`. Combinational. Three outputs: `eq-out`, `lt-out`, `gt-out` (all 1-bit).
- Frontend `ComparatorNode.tsx`. 2 input handles + 3 output handles, stacked via `handleTop()`.
- Type id: `comparator`
- Palette category: "Computation"
- Backend test: drive `in-a=10, in-b=20` → eq=0, lt=1, gt=0. Then `in-a=20, in-b=10` → eq=0, lt=0, gt=1. Then equal values → eq=1, lt=0, gt=0.
- BLOCK_PORT_TYPES: `comparator: { 'in-a': 'data-u8', 'in-b': 'data-u8', 'eq-out': 'gate-1', 'lt-out': 'gate-1', 'gt-out': 'gate-1' }`

Note on naming: a single block with three outputs is intentional — same-shape operation (compare two 8-bit values), just different views of the result. Three separate Equals/Less/Greater blocks would be busier on the canvas with no expressive gain. The "no hidden behavior" principle applies to **runtime behavior switching** (e.g. ALU-with-op-parameter); a block whose outputs are all functions of the same inputs and that always produces all of them is fine.

### S18-4 — Mux block (2-to-1 multiplexer)

- Backend `backend/blocks/mux.py`. Combinational. `data_out.eq(Mux(select, in_b, in_a))` (Amaranth's built-in `Mux` helper).
- Frontend `MuxNode.tsx`. 3 input handles + 1 output, stacked via `handleTop()`.
- Type id: `mux`
- Palette category: "Computation" (the conditional-control story keeps it with the rest of the CPU primitives).
- Backend test: with `select=0`, drive different `in-a` values, assert `out` follows `in-a`. With `select=1`, assert `out` follows `in-b`.
- BLOCK_PORT_TYPES: `mux: { 'in-a': 'data-u8', 'in-b': 'data-u8', 'select': 'gate-1', 'data-out': 'data-u8' }`

### S18-5 — Worked example updates

- Modify `examples/cpu-accumulator.json`: pipe Register.data-out through Reinterpret → Output.audio-in so the accumulator now drives audio (the LSBs of the running sum become a sound).
- Add new `examples/cpu-counter-with-branch.json`: a counter that resets at a target value, demonstrating Comparator + Mux + Reinterpret = 3 of the 4 new blocks. Three ROMs supply `data-u8` constants (1 to increment, 7 as the reset target, 0 as the reset value); the `data-path` walks Counter→ROM→Adder→Mux→Register and Register→Comparator drives Mux.select.
- Verify both examples build end-to-end on iCEBreaker.

### S18-6 — Doc + test updates

- `BLOCKS.md` — Subtractor, Comparator, Mux added to "Computation"; Reinterpret added to "Bus". Updated "How these compose" walkthrough to include the Reinterpret bridge and the new branching shape.
- Doc count bumps 36 → 40 across: README, ROADMAP, CLAUDE, CONTRIBUTING, ARCHITECTURE, RELEASE-NOTES, ANNOUNCEMENT-DRAFTS (all 4 venues), HACKADAY-WRITEUP. Skipped SPRINT-N retros (historical).
- AI prompt update: registered all 4 new blocks in `frontend/src/ai/prompt.ts` with port descriptions; added the canonical "drive accumulator into audio via Reinterpret" and "Comparator + Mux for conditional reset" patterns.
- Tests:
  - `backend/tests/test_blocks.py` — one property test per new block (specified in S18-1..4); plus the existing CPU-accumulator pipeline smoke test was extended to include Reinterpret end-to-end (44 → 44 since Reinterpret folded into the existing pipeline test).
  - `frontend/test/blocks.test.tsx` — rendering tests for all 4 new blocks.

---

## Out of scope (deferred)

- **Block-manifest refactor (KNOWN-ISSUES item A1).** Trigger condition is met (block #36 + 5+ uniform-shape primitives) but it's a separate dedicated sprint. Just keep the 8-files-per-block pattern uniform across these 4 new blocks for now.
- **Shifter, Register File, 8-bit address space.** Per ADR-002's deferred list. Sprint 19+ candidates if user demand surfaces them.
- **A reinterpret-the-other-way block** (audio-s8 → data-u8). Not requested by any current pattern. The CPU-to-audio direction is the friction point flagged in the Sprint 17 retro; the reverse direction can land if a future use case needs it.
- **Wider Adder/Subtractor (16-bit data path).** Same Adder/Subtractor shape at wider widths; lands alongside parameterised BusSplit/BusJoin (S16-4 deferral).

---

## Sprint Log

| # | Commit | What | Notes |
|---|---|---|---|
| - | (uncommitted, staged for review) | S18-1: Reinterpret block — pure no-op bridge from `data-u8` to `audio-s8`, same 8 bits with sign reinterpreted. Closes the Sprint 17 retro's "audio-domain barrier" surfacing. Backend + frontend + registry + test. |
| - | (uncommitted, staged for review) | S18-2: Subtractor block — mirror Adder shape (`diff-out: data-u8`, `borrow-out: gate-1`). Combinational unsigned subtract; underflow sets borrow. |
| - | (uncommitted, staged for review) | S18-3: Comparator block — single block, three flag projections (`eq-out`, `lt-out`, `gt-out`). All combinational, all derived from the same internal compare. |
| - | (uncommitted, staged for review) | S18-4: Mux block — 2-to-1 multiplexer on 8-bit data, gated by a 1-bit select. The minimum branching primitive. |
| - | (uncommitted, staged for review) | S18-5: Worked examples — `examples/cpu-accumulator.json` extended to drive Reinterpret → Output for audible accumulator output (still builds at 104,090 bytes on iCEBreaker). Added `examples/cpu-counter-with-branch.json` demonstrating Comparator + Mux + Reinterpret = 3 of the 4 new blocks (also builds at 104,090 bytes on iCEBreaker). |
| - | (uncommitted, staged for review) | S18-6: Doc + test updates — BLOCKS.md "Computation" section gains Subtractor / Comparator / Mux, "Bus" section gains Reinterpret, "How these compose" walkthrough updated with Reinterpret + the branching shape. Doc count bumps 36 → 40 across README / ROADMAP / CLAUDE / CONTRIBUTING / ARCHITECTURE / RELEASE-NOTES / ANNOUNCEMENT-DRAFTS / HACKADAY-WRITEUP. AI prompt registers all 4 new blocks + the new "accumulator into audio" and "Comparator + Mux for conditional reset" patterns. |

**Test counts after S18:** pytest 60 passed + 2 skipped (was 56 + 2); vitest 150 passed (was 144); tsc clean.

---

## Retrospective

### What worked

- **Single-shot agent dispatch is now the default.** Sprint 17 was the first sprint to land 4 new blocks + a worked example + doc updates in a single coherent change; Sprint 18 confirmed it as the right move at this maturity level. The 8-files-per-block cookbook is uniform enough that 4 more blocks of similar shape fit cleanly without per-task commits — the lesson from Sprint 17's retro generalised.
- **The conditional-control trio composes naturally with the existing primitives.** Comparator + Mux + Register turned out to be the exact 3 blocks needed for a "counter that resets at a target value," which is the smallest interesting branchable program. The worked example is 11 nodes / 15 edges — visually busy but each block has a clear purpose. The fact that ROMs serve as the data-u8 constant providers (since there's no native data-u8 Constant block) is a small awkwardness that adds 3 nodes to the example — flagging this as a candidate for a Sprint 19+ "data-u8 Constant" companion to the existing audio-s8 Constant.
- **The Reinterpret block is exactly as small as predicted.** ~30 LOC of Amaranth (mostly the docstring and `as_signed()` call) and ~25 LOC of TSX. Pure no-op: Yosys collapses the connection to a wire. The Sprint 17 retro's prediction ("Reinterpret is probably the right primitive — ~20 LOC of Amaranth that's a no-op, ~30 LOC of TSX") was on the nose; the actual implementation matched.

### What surfaced

- **The block-manifest refactor's trigger condition is now firmly tripped.** ADR-001's KNOWN-ISSUES item A1 said "trigger: block #35 OR five-blocks-of-uniform-shape." We're now at 40 blocks. The 7 CPU primitives (Adder, Subtractor, Comparator, Mux, Register, RAM, ROM) all fit the same `data-u8`-in / `data-u8`-or-flag-out shape; the 6 audio-effect blocks fit the same `audio-s8`-in / `audio-s8`-out shape; the 4 boolean gates fit a 1-bit-in / 1-bit-out shape. The 8-files-per-block cost is paid 3+ times across each of these clusters. Sprint 19 should scope the manifest refactor: a single `blocks/manifest.ts` with rows for `[type, label, ports, params, color, description]` that auto-generates the registries on both sides. Estimate ~6 hours including tests and migration; defers all subsequent block additions to ~2-files-per-block.
- **The data-u8 Constant gap is real but small.** The branchable counter example needs three `data-u8` constants (1, 7, 0) for the increment / target / reset values. The cleanest workaround in v0.1 is "16-byte ROM with all entries equal to N" — works but adds 3 nodes to the canvas per constant. A `data-u8 Constant` block (mirror of the existing `audio-s8 Constant`, minimum 8 LOC of Amaranth) would simplify the example to 8 nodes. Sprint 19 candidate, low effort, high readability win.
- **The conditional-control story unlocks more example shapes.** The "counter that resets at a target" is the simplest demonstration; what's now structurally buildable but not yet shown: a tiny FSM (Register holds state, Comparator + Mux pick the next state from a ROM lookup), a clamped accumulator (Comparator detects overflow, Mux picks between sum and a saturation value), a sequencer with conditional branches (ROM holds program counter offsets, Mux picks between sequential advance and the offset). These are all worth bundling as examples in Sprint 19+ once the manifest refactor lands.

### What we'd do differently

- **The branching example's 3-ROM constant providers are clunky.** Each ROM block is 16 bytes of identical content just to expose a single value. The `data-u8` Constant gap surfaced above is the right fix; the example will simplify to 8 nodes once it lands. The current shape is shippable but an obvious Sprint 19 follow-up.
- **The Reinterpret-the-other-way direction (audio-s8 → data-u8) wasn't shipped.** Not flagged in Sprint 17, and no current pattern needs it. Worth noting as a "land it if a use case surfaces" item rather than letting the asymmetry persist forever — most likely use case is reading audio samples into the CPU domain for a delay-line scratchpad. Sprint 19+ if user demand surfaces it.

### Sprint 18 outcome

The 4 blocks ship. Block count 40. Both Sprint 17 surfacings closed: the data-u8 ↔ audio-s8 audio-bridge gap (Reinterpret), and the conditional-control trio for branchable programs (Subtractor, Comparator, Mux). The bundled examples include the canonical "drive accumulator into audio" pattern and the "counter that resets at a target value" pattern. Sprint 19 candidates surfaced: block-manifest refactor (KNOWN-ISSUES A1, trigger condition firmly tripped), `data-u8` Constant block, more bundled examples exercising the conditional-control story.
