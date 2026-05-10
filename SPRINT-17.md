# Sprint Plan: Sprint 17 — CPU primitives (ADR-002 implementation)

> **Solo dev + Claude Code** · Drafted + opened 2026-05-10 · Successor to [SPRINT-16.md](SPRINT-16.md) · Operational source: [ADR-002-cpu-primitives.md](ADR-002-cpu-primitives.md) (Accepted 2026-05-10)

**Status:** **OPEN — in flight 2026-05-10.**

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

> *Filled in as the sprint runs. Currently in flight.*

---

## Retrospective

> *Filled in at sprint close.*
