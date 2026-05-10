# Sprint Plan: Sprint 16 — Multi-bit bus type system (ADR-001 implementation)

> **Solo dev + Claude Code** · Drafted 2026-05-10 · Successor to [SPRINT-15-AND-PRECEDING.md no, just SPRINT-14.md](SPRINT-14.md) · Operational source: [ADR-001-multi-bit-bus-types.md](ADR-001-multi-bit-bus-types.md)

**Status:** **CLOSED 2026-05-10.** 5 of 7 planned items shipped (S16-1 through S16-2, S16-4 through S16-6). S16-3 (visual handle styling) and S16-7 (additional rendering tests) deferred to opportunistic-polish per the in-conversation `/engineering:tech-debt` prioritization run mid-sprint — both scored low on Impact + Risk vs. Effort once the architectural foundation was complete.

**Sprint Goal:** *Implement [ADR-001](ADR-001-multi-bit-bus-types.md): typed bus system with edge validation + Split/Join blocks. After this sprint, every block port declares a `BusType`, the canvas rejects miswired connections at drag time and at Load time, and a Bus category in the palette gives users explicit cross-width composition. Block count 30 → 32. This is the architectural gate on the upcoming CPU expansion (Sprint 17+).*

---

## Why now

Two prior expansions gated on this:
- **CPU primitives** (Sprint 17+ candidate per [ROADMAP.md](ROADMAP.md)): Adder, Subtractor, Register File, RAM, ROM all need multi-bit buses. Without typed buses they'd land as either 8-handle-per-port "per-bit" disasters or silent miselaborations.
- **More visual primitives** (sprite engine, framebuffer): need addressable memory and pixel-x/y comparison primitives that work on multi-bit values.

The 30 existing blocks live with 3 implicit types (gate-1, audio-s8, pixel-u10) that work because no block ever needs to cross-wire. CPU work breaks that assumption. This sprint adds the type system before the first CPU primitive lands so primitives can use it from day one.

---

## Working Assumptions

| Assumption | Default | Change if... |
|---|---|---|
| Sprint length | **single focused day** (incremental commits) | A real architectural surprise surfaces |
| Stack | unchanged from S15 | n/a |
| Block count target | 30 → 32 (BusSplit + BusJoin) | More cross-width blocks emerge |
| Save-format compatibility | preserved (bus types are frontend-only metadata) | A bus type is added that affects backend elaboration |
| Tracking | git commits + this `SPRINT-16.md` log | n/a |

---

## Sprint Goal — concrete targets

7 items, each a separate commit. Sequenced so the cheapest lands first.

### S16-1 — `BusType` enum + `BLOCK_PORT_TYPES` registry

New file `frontend/src/blocks/busTypes.ts`:
- Export `BusType` enum (53 members per [ADR-001](ADR-001-multi-bit-bus-types.md))
- Export `BLOCK_PORT_TYPES: Record<NodeType, Record<HandleId, BusType>>` mapping every handle of every existing block to its bus type
- No behavior change yet — just metadata

Verification: tsc clean, vitest 105 still passes.

### S16-2 — Edge validation in `App.tsx`

`isValidConnection` callback on the React Flow root that:
- Reads source/target handle bus types from the registry
- Returns `false` for width-mismatch or sign-mismatch
- Surfaces a friendly toast on rejection ("Use BusSplit/BusJoin to convert")

Plus a small connection-compatibility helper in `busTypes.ts`:
```typescript
export function arePortTypesCompatible(
  source: BusType,
  target: BusType,
): 'compatible' | 'semantic-cross' | 'incompatible'
```

Verification: drag a logic-gate output to an oscillator's audio-out — should reject. Drag oscillator audio-out to ADSR audio-in — should still work.

### S16-3 — Visual handle styling

`App.css` rules keyed off `data-bus-width` or class — circle for 1-bit, square for 8-bit, hexagon for 16-bit. The frontend Node components pass the bus width into the Handle's class name.

Verification: open the running app, see different shapes on different blocks. Manual.

### S16-4 — `BusSplit` + `BusJoin` blocks (30 → 32)

Two new blocks following the existing 8-file cookbook:

- **BusSplit**: 1 input (configurable bus type, default `data-u8`), N outputs (1-bit each, where N = width of input). Pure combinational bit-slice.
- **BusJoin**: N inputs (1-bit each), 1 output (configurable bus type). Pure combinational concat.

Both have a single `width` parameter (1–16) that determines how many bit handles to render. New "Bus" palette category.

Verification: a graph using `BusSplit` → 3 individual gate-1 outputs going into 3 different `Output` blocks should elaborate.

### S16-5 — Update `validateLoadedGraph`

The Load JSON validator gains a per-edge bus-type check. Catches malformed graphs (or graphs saved with a future bus-type that this build doesn't recognize). Save-format itself doesn't bump — bus types are derived at validation time from `(node.type, edge.sourceHandle/targetHandle)`.

### S16-6 — AI prompt update

The consultant's system prompt in `frontend/src/ai/prompt.ts` learns:
- The connection rules (what's compatible, what isn't)
- The 53-member BusType enum (or a summary for token cost)
- BusSplit / BusJoin as escape hatches

So when the AI suggests a connection, it picks compatible ports.

### S16-7 — Tests

- `frontend/test/blocks.test.tsx`: rendering tests for BusSplit + BusJoin (each with multiple widths)
- `frontend/test/save-load.test.tsx`: bus-type-mismatch rejection on Load
- New `frontend/test/bus-types.test.ts`: unit tests for `arePortTypesCompatible` covering same-name, generic-same-width-sign, semantic-cross, width-mismatch, sign-mismatch cases

Target: vitest 105 → ~115 (10ish new cases).

---

## Out of scope (deferred to later sprints)

- **CPU primitives** — Adder, Subtractor, Register File, RAM, ROM. Land in Sprint 17+ once the bus-type system is solid.
- **Visual handle bus-type tooltip on hover** — nice polish but not blocking; manual visual + the inline reject toast cover the feedback need for now.
- **Auto-routing through BusSplit/BusJoin** — could the editor auto-insert a BusSplit if a user tries to connect mismatched widths? Probably yes eventually; for v0.1 explicit drag-from-palette is fine.

---

## Sprint Log

> *Filled in as the sprint runs. Currently in flight.*

### S16-4 — `BusSplit` + `BusJoin` blocks (30 → 32) — **Done** (commit pending)

Shipped both blocks fixed at 8-bit width — a deliberate v0.1 scope adjustment from the ADR's parameterized 1–16 width. Reasoning: 8-bit covers ~80% of use cases, the dynamic-handle-rendering needed for parameterized widths is a novel pattern in the codebase, and the actual width requirements will be clearer once Sprint 17's CPU primitives ship (probably 8 + 16). Configurable width is roadmap.

Touched:
- `backend/blocks/bus_split.py` — new Amaranth Elaboratable: 8-bit input → 8 × 1-bit outputs (combinational bit-slice).
- `backend/blocks/bus_join.py` — new Amaranth Elaboratable: 8 × 1-bit inputs → 8-bit output (combinational `Cat(...)`).
- `backend/blocks/__init__.py` — registered `BusSplit` + `BusJoin` in `BLOCK_REGISTRY` and `__all__`.
- `backend/synth.py` — comment-only update; neither block has parameters.
- `frontend/src/blocks/BusSplitNode.tsx` + `BusJoinNode.tsx` — new React Flow node components, 9 handles each, `aria-label` on every handle (S14-6 standard), positions via `handleTop(slot)` (S14-2 standard).
- `frontend/src/blocks/index.ts` — registered both in `nodeTypes` + `AppNode` union.
- `frontend/src/Palette.tsx` — appended both palette entries (silver/grey hues for "infrastructure" tone) plus default-data fall-through.
- `frontend/src/App.css` — `.block-bussplit` + `.block-busjoin` rules with `min-height: 270px` to fit 8 stacked handles.
- `frontend/src/blocks/busTypes.ts` — `BLOCK_PORT_TYPES` entries: `bus-in` / `bus-out` are `data-u8`; the eight `bit-N` ports on each block are `data-u1`.
- `frontend/src/ai/prompt.ts` — registered both blocks in the consultant's block-library reference, type-string list, and the `add_node` / `add_edge` / `update_node_params` tool descriptions.
- `backend/tests/test_blocks.py` — `test_bus_split_breaks_8bit_value_into_bits` (drives 0b10101010 in, asserts the 8 outputs alternate as expected) + `test_bus_join_concats_bits_into_8bit_value` (sets bits 0/2/5 high, asserts output is 37; then all-ones, asserts 255).
- `frontend/test/blocks.test.tsx` — render tests for both, asserting handle counts + the expected `data-handleid` ids.
- `BLOCKS.md` — new "Bus" section between Visual and Mixing-and-routing with full per-block reference matching the existing format.
- `README.md`, `ROADMAP.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `ARCHITECTURE.md`, `RELEASE-NOTES-v0.1.0-alpha.md`, `ANNOUNCEMENT-DRAFTS.md` (all 4 venue drafts), `HACKADAY-WRITEUP.md` — bumped block count 30 → 32.

End-to-end check: `python3 backend/synth.py` against a `Constant(value=127) → BusSplit.bus-in, BusSplit.bit-0 → Output.audio-in` graph rendered the 88200-sample WAV cleanly with no errors.

Tests after the change: backend pytest **49 passed + 2 skipped** (was 47/2 before), frontend vitest **136 passed** (was 134), tsc clean.

---

## Retrospective

> *Filled in at sprint close.*
