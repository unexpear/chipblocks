# Sprint Plan: Sprint 17 — CPU primitives (ADR-002 implementation)

> **Solo dev + Claude Code** · Drafted + opened 2026-05-10 · Successor to [SPRINT-16.md](SPRINT-16.md) · Operational source: [ADR-002-cpu-primitives.md](ADR-002-cpu-primitives.md) (Accepted 2026-05-10)

**Status:** **CLOSED 2026-05-10.** All 7 planned tasks shipped in a single commit (`00a2902`). Sprint 17 was a single-shot agent dispatch — the 8-files-per-block cookbook is well-established enough that 4 new blocks + 1 Counter extension + worked example + doc updates landed cleanly without per-task commits. v0.1.0-alpha.6 release tag follows.

**Sprint Goal:** *Ship the 4 minimum-viable CPU primitives from ADR-002 — Adder, Register, RAM, ROM — at 8-bit data + 4-bit address. Block count 32 → 36. Plus a small Counter extension that exposes a raw `addr-u4` output (not just the centred 8-bit audio output it already has) so Counter can address ROM/RAM directly without a bus-conversion chain. After this sprint, a user can drag the 4 new primitives onto the canvas and wire a sequencer/lookup-table-style design that elaborates end-to-end on iCEBreaker.*

---

## Why now

ADR-001 (Sprint 16, alpha.5) shipped the typed bus system. Every CPU primitive can declare its port widths via `BLOCK_PORT_TYPES` and the validator catches miswiring at drag time. The architectural gate is gone.

ADR-002 (Accepted today) picks the v0.1 primitive set: 4 blocks plus a tiny extension to the existing Counter. Subtractor / Comparator / Shifter / Register File / 8-bit address space all explicitly deferred — Sprint 18+ adds them when the worked example surfaces what's missing.

The PRD's "1-core CPU on Tiny Tapeout silicon" use case becomes structurally buildable after this sprint. Not yet a *working* CPU — that needs more primitives (likely Comparator + Mux) plus an instruction-decoding pattern. But the data-path primitives that any CPU is built from will be in the palette.

---

## Working Assumptions

| Assumption | Default | Change if... |
|---|---|---|
| Sprint length | **single focused day** (4 blocks + 1 Counter extension + worked example) | Hidden complexity in the ROM array-parameter UX |
| Stack | unchanged from S16 | n/a |
| Block count target | 32 → 36 (Adder, Register, RAM, ROM) | Sub-decision lands more |
| Save-format | bumped to v2 only if ROM's array parameter requires it (probably not — JSON arrays already round-trip) | The Counter extension changes the existing handle id list — that's a renderer-side change but not a save-format one because saved graphs from alpha.5 don't reference the new addr-out handle |
| Tracking | git commits + this `SPRINT-17.md` log | n/a |

---

## Sprint Goal — concrete targets

### S17-1 — Counter extension: add `addr-out: addr-u4` port

The existing Counter block emits `audio-out: audio-s8` (centred 8-bit signed via `count - 64`). For ROM/RAM addressing we need the raw count as `addr-u4`. Add a second output port; preserve the existing `audio-out` so existing graphs don't break.

- `backend/blocks/counter.py` — add a new `addr_out` Signal, wire it as `count[:4]` (low 4 bits, naturally limited to max_value range when max_value ≤ 16).
- `frontend/src/blocks/CounterNode.tsx` — add the new handle below the existing audio-out, with `aria-label="Address output"`.
- `frontend/src/blocks/busTypes.ts` — extend `counter` entry: `'addr-out': 'addr-u4'`.

### S17-2 — Adder block

- Backend `backend/blocks/adder.py`. Combinational. Inputs: `in_a`, `in_b` (both `Signal(8)`). Output: `sum_out` (`Signal(9)` for carry).
- Frontend `AdderNode.tsx`.
- Backend test: `Constant(100) → in-a, Constant(50) → in-b`, assert `sum-out` reads 150.
- Frontend test: rendering.
- Registry: `adder: { 'in-a': 'data-u8', 'in-b': 'data-u8', 'sum-out': 'data-u9' }`.

### S17-3 — Register block

- Backend `backend/blocks/register.py`. Synchronous: `with m.If(write_enable): m.d.sync += stored.eq(data_in)`.
- Frontend `RegisterNode.tsx`.
- Backend test: drive `data-in=42`, pulse `write-enable`, verify `data-out` becomes 42 and stays.
- Registry: `register: { 'data-in': 'data-u8', 'write-enable': 'gate-1', 'data-out': 'data-u8' }`.

### S17-4 — RAM block

- Backend `backend/blocks/ram.py`. 16 cells × 8-bit, `amaranth.lib.memory.Memory` backed (same primitive Delay uses). Synchronous write gated by `write-enable`; combinational read on the current `addr`.
- Frontend `RAMNode.tsx`.
- Backend test: write 99 to addr=5, then read addr=5, assert data-out=99.
- Registry: `ram: { 'addr': 'addr-u4', 'data-in': 'data-u8', 'write-enable': 'gate-1', 'data-out': 'data-u8' }`.

### S17-5 — ROM block (the novel one)

- Backend `backend/blocks/rom.py`. Constructor takes `contents: list[int]` (validated 0–255 each, padded/truncated to 16 entries). Combinational lookup against the address.
- Frontend `ROMNode.tsx` — needs UI for the 16-byte array. **Recommended UX:** a single textarea where the user types comma-separated values like `"0, 1, 1, 2, 3, 5, 8, 13"`. The component parses, validates each is 0–255, pads with zeros to 16 entries, displays a parse error if malformed. Same `useValidatedNumber` energy but for an array.
- `synth.py _build_params`: parse `data.contents` as `list[int]`, default `[0] * 16` if missing.
- Backend test: instantiate `ROM(contents=[10, 20, 30, ...])`, drive each address, verify output. Use the existing pytest `wav_samples` pattern.
- Registry: `rom: { 'addr': 'addr-u4', 'data-out': 'data-u8' }`.

### S17-6 — Worked example: a buildable demo using the 4 primitives

The agent picks the concrete demo. **Constraint:** it must elaborate end-to-end on iCEBreaker (verified via the existing build pipeline) AND demonstrate at least 3 of the 4 new primitives composing meaningfully. Suggested shapes (any one is fine):

- **ROM-driven sequencer:** Gate (~4 Hz) → Counter.clock; Counter.addr-out → ROM.addr; ROM holds e.g. `[0, 64, 0, 127, 0, 64, 0, 127, ...]`; ROM.data-out is `data-u8` so it can't drive Output directly without a sign-reinterpret. Solution: wire ROM.data-out into an Adder with a Constant(-128) on the other input... wait, the Adder is `data-u8`-only. Hmm. The agent will need to find a clean compositional path or accept a small scope addition (one of: extend Output to accept `data-u8`; add a tiny `Reinterpret` block; ship the demo as a CPU-domain-internal test that pytest verifies but doesn't drive audio).
- **Adder accumulator:** Constant → Adder.in-a; Register → Adder.in-b; Adder.sum-out (truncated to 8 bits via BusSplit+BusJoin) → Register.data-in; Gate → Register.write-enable. Each clock pulse adds the constant to the running sum. Output stays in CPU domain (no audio); pytest verifies the accumulator increments correctly.
- **RAM round-trip test:** drive RAM with an explicit write pattern, then read it back via Counter; pytest asserts. No audio.

**Pragmatic call:** if the agent finds the audio-domain integration awkward, ship the example as a **CPU-domain-internal demo** verified by pytest only. Sprint 18 will likely add a Reinterpret block (`data-u8 → audio-s8` rename) when audio integration becomes worth the effort. Document the limitation in BLOCKS.md.

### S17-7 — Doc updates + tests

- `BLOCKS.md` — new "Computation" or "CPU" section with all 4 primitives plus a "How these compose" sub-section walking through the worked example.
- Doc count bumps 32 → 36 across: README, ROADMAP, CLAUDE, CONTRIBUTING, ARCHITECTURE, RELEASE-NOTES, ANNOUNCEMENT-DRAFTS (all 4 venues), HACKADAY-WRITEUP. Skip SPRINT-N retros (historical).
- AI prompt update: register the 4 new blocks in `frontend/src/ai/prompt.ts` with port descriptions; mention the typical "drive ROM with Counter.addr-out" pattern.
- Tests:
  - `backend/tests/test_blocks.py` — one property test per new block (specified in S17-2..5).
  - `frontend/test/blocks.test.tsx` — rendering tests for all 4 new + the modified Counter.
  - End-to-end test for the worked example (whatever shape it lands in).
- Update `BLOCK_PORT_TYPES` registry with all new entries + the Counter `addr-out` extension.
- `frontend/src/blocks/index.ts` — register all 4 new node types.
- `frontend/src/Palette.tsx` — append all 4 with sensible default data (ROM defaults to `contents: [0]*16`, others have no params).
- `frontend/src/App.css` — `.block-adder`, `.block-register`, `.block-ram`, `.block-rom` borders. Pick a distinct hue (cool blue / steel) for "computation" tone, distinct from audio (warm) / visual (purple) / logic (deep blue) / effects (orange) / bus (silver).

---

## Out of scope (deferred to Sprint 18+)

Per ADR-002:
- **Subtractor**, **Comparator**, **Shifter**, **Register File** — clean PR-sized additions once the Sprint 17 patterns are in.
- **8-bit address space** (256-byte RAM/ROM) — same Adder/Register pattern at wider widths; lands alongside parameterized BusSplit/BusJoin (S16-4 deferral).
- **Reinterpret blocks** for cross-bus-type composition — defer until the worked example needs them.
- **Single-ALU block (Option C from the ADR)** — only if users actually ask for it; the philosophical objection (hidden behavior in a parameter) stands until then.
- **Full instruction-decoding CPU** — needs Comparator + Mux primitives that S17 doesn't ship. The "8-bit Fibonacci accumulator" demo from the original ADR draft was over-scoped; revised to "data-path primitives demo" for v0.1.

---

## Sprint Log

| # | Commit | What | Notes |
|---|---|---|---|
| - | (uncommitted, staged for review) | S17-1: Counter extension — added `addr-out: addr-u4` second output port wired to the low 4 bits of the internal count. Backend + frontend + registry + test. Existing `audio-out` preserved so saved graphs from earlier alphas keep working. |
| - | (uncommitted, staged for review) | S17-2: Adder block — combinational 8-bit unsigned add with separate `sum-out: data-u8` and `carry-out: gate-1` outputs. **Scope adjustment from ADR-002:** the ADR originally specified a single 9-bit `sum-out`; the split-shape composes more cleanly with the 8-bit data path the other primitives use (no BusSplit needed to cascade two adders). |
| - | (uncommitted, staged for review) | S17-3: Register block — single 8-bit register with synchronous write-enable. Adder + Register form the accumulator pattern. |
| - | (uncommitted, staged for review) | S17-4: RAM block — 16 × 8-bit synchronous read/write memory via `amaranth.lib.memory.Memory` (same primitive Delay uses). Combinational read, gated synchronous write. |
| - | (uncommitted, staged for review) | S17-5: ROM block — 16-byte combinational ROM with a `contents: number[]` parameter. First block in the library where the parameter is a list; textarea UI with comma-separated parsing + inline validation errors. |
| - | (uncommitted, staged for review) | S17-6: Worked example `examples/cpu-accumulator.json` — Counter→ROM→Adder→Register loop with a parallel RAM scratchpad. Builds end-to-end on iCEBreaker (104,090-byte bitstream). The audio Output is wired to a silent Constant — the CPU primitives stay CPU-domain in v0.1; Sprint 18+ Reinterpret block can bridge to audio when worth the effort. |
| - | (uncommitted, staged for review) | S17-7: Doc + test updates — BLOCKS.md "Computation" section (Adder / Register / RAM / ROM + "How these compose" walkthrough), 32 → 36 across README / ROADMAP / CLAUDE / ARCHITECTURE / RELEASE-NOTES / ANNOUNCEMENT-DRAFTS / HACKADAY-WRITEUP. AI prompt registers all 4 new blocks + the Counter.addr-out extension and the canonical "Counter.addr-out → ROM.addr / RAM.addr" pattern. |

**Test counts after S17:** pytest 56 passed + 2 skipped (was 49 + 2); vitest 144 passed (was 136); tsc clean.

---

## Retrospective

### What worked

- **Single-shot agent dispatch was the right move at this maturity level.** The 8-files-per-block cookbook is now well-trodden enough that the agent could implement 4 new blocks + a Counter extension + a worked example + doc updates in a single coherent change. Earlier sprints split work across multiple commits because the patterns were less established; this one landed cleanly as one commit (`00a2902`) with clear per-task attribution in the message + this Sprint Log. Bigger-batch dispatch is now appropriate.
- **ADR-002's worked-example flexibility paid off.** The plan said "the agent picks the concrete demo with the constraint that it must elaborate end-to-end on iCEBreaker AND demonstrate at least 3 of the 4 new primitives." The agent used 4 of 4 + the new Counter extension — better than mandated. This worked because the constraint was clear (composability + end-to-end build) without prescribing the shape.
- **Honest scope-deviation reporting.** The agent explicitly called out the Adder shape change (ADR's `data-u9` → shipped `data-u8` + `gate-1` carry) with reasoning, mirroring how Sprint 16's S16-4 noted the BusSplit parameterization deferral. This pattern — ADR specifies the ideal, sprint commits explicitly note pragmatic deltas — keeps the design rationale honest in git history.

### What surfaced

- **The data-u8 ↔ audio-s8 sign-class barrier is now a real friction.** Per ADR-001 the validator correctly rejects the cross. CPU primitives produce `data-u8` outputs; audio Output expects `audio-s8`. There's no clean composition without one of: a Reinterpret block (pure no-op rename of bus-type), a Subtractor block + a Constant(128) to convert unsigned to centered signed, or accepting that CPU and audio domains stay separate. Sprint 18 should address this head-on — Reinterpret is probably the right primitive (~20 LOC of Amaranth that's a no-op, ~30 LOC of TSX). Without it, every CPU-domain-to-audio-domain demo lives in its own silo.
- **`_run_block_sim` test helper has reached its limits.** None of the 7 new pytest tests could use the existing helper because it doesn't support driving inputs mid-simulation. Each test inlines ~10 LOC of Module + Simulator boilerplate. A `_run_block_with_inputs(block, driver_coro)` helper that takes an async function to drive inputs across simulation cycles would simplify a bunch of follow-on work. Tracked as opportunistic test-infra debt.
- **Tech-debt item A1 (block manifest) is approaching its trigger condition.** ADR-001's KNOWN-ISSUES entry says "trigger: block #35 OR five-blocks-of-uniform-shape." We're now at 36 blocks. Adder/Register both fit a uniform shape (`data-u8` in/out, ≤2 inputs, optional `gate-1` control). The next 1–2 blocks of similar shape (probably Subtractor + Comparator in Sprint 18) will trip the trigger; the manifest refactor is appropriate to start scoping.

### What we'd do differently

- **The original ADR-002 worked-example claim ("8-bit Fibonacci accumulator on Tiny Tapeout silicon") was over-scoped** for a sprint that doesn't ship Comparator + Mux. The revised SPRINT-17.md scope (any composing-3-of-4-primitives demo) was right; the lesson is that ADRs should describe the *eventual* deliverable but the sprint plan should reflect what's buildable with the *current* primitive set. ADR-002 stays Accepted but its "worked example" framing should be read as aspirational once the supporting primitives ship.
- **Pre-allocate the audio-domain bridge decision at ADR time, not at sprint time.** Knowing that `data-u8` ↔ `audio-s8` is a hard barrier per ADR-001, the question of "how does CPU output reach audio out?" should have been a sub-decision in ADR-002 itself. The agent had to discover the friction during implementation. Future ADRs that introduce new bus types or cross-domain primitives should call out the bridging story up front.

### Sprint 17 outcome

The 4 CPU primitives ship. Block count 36. The architectural path from "32-block visual chip designer" to "designs a tiny CPU on real silicon" is structurally complete — the data-path primitives are present; what's missing for a real instruction-decoding CPU is conditional control (Comparator, Mux), explicitly deferred to Sprint 18 per ADR-002. v0.1.0-alpha.6 tag follows.
