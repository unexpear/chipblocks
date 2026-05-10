# ADR-001: Multi-bit bus type system for CPU/data-path expansion

**Status:** Accepted (2026-05-10) · **Deciders:** solo dev (you) + Claude Code · **Implements:** Sprint 16 ([SPRINT-16.md](SPRINT-16.md))

> First Architecture Decision Record in the project. Going forward, decisions that change the cross-cutting shape of the codebase (rather than adding a single block or a single feature) live as `ADR-NNN-<topic>.md` files at repo root, alongside the existing `ROADMAP.md` / `ARCHITECTURE.md` / `KNOWN-ISSUES.md` pattern. Smaller decisions stay in commit messages and SPRINT-N retros.

## Context

ChipBlocks currently has **3 implicit signal "types"** that work because the 30 existing blocks are domain-specific and rarely cross-wire:

| Implicit type | Width | Blocks that use it |
|---|---|---|
| Gate / sync | 1-bit | Gate, AND/OR/XOR/NOT, ADSR.gate, Sample-and-Hold.clock, hsync/vsync, visible, color channels (R/G/B), PixelRange.inside |
| Audio | 8-bit signed | Oscillator, Triangle, Sawtooth, Sine, Wavetable, Noise, Constant, Mixer, ADSR.audio, Multiply, all filters, Bitcrusher, Delay, Distortion, Counter.audio-out |
| Pixel coord | 10-bit unsigned | VgaTiming.x/y, ColorBars.x, PixelRange.pixel |

The "trust the user to wire compatible types" approach holds because no block today ever needs to mix domains — there's no scenario where wiring an audio-out into a hsync input makes sense, even though both are technically `Signal(N)`s.

**A 1-core CPU breaks this.** Every CPU primitive (Adder, Subtractor, Register File, RAM, ROM) operates on multi-bit data buses (8-bit data + 8-bit address minimum, more realistically 16-bit). All blocks in a CPU design carry the same shape signal — and that shape isn't audio, gate, or pixel-coord. Without a bus-type system, the user can:

- Wire a Register's `data-out` into an Audio Oscillator's `audio-out` and produce silent miselaboration
- Wire an 8-bit data bus into a 16-bit address bus and lose 8 bits silently
- Get incomprehensible Amaranth errors when widths mismatch deep in elaboration

This decision is the architectural gate on the CPU expansion path.

## Decision

**Add a typed bus system with explicit Split/Join blocks for cross-width composition.** Each Handle declares a `busType: BusType` where `BusType` is a discrete enum covering every width 1 through 16 (with both unsigned and signed variants where applicable, plus address-bus aliases for the practically-useful sizes, plus the existing 3 semantic types preserved as aliases). React Flow's `isValidConnection` callback rejects edges where source and target bus types don't match. Cross-bus moves go through explicit `BusSplit` (one N-bit → N 1-bits) and `BusJoin` (N 1-bits → one N-bit) blocks. Existing 30 blocks keep behaving as before; what changes is the new metadata declaration.

## Options Considered

### Option A — Per-bit handles (current pattern scaled up)

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low |
| Cost (build effort) | Trivial — no architecture change |
| Cost (user UX) | **Catastrophic** — an 8-bit Adder has 16 input handles + 8 output; a Register-File has dozens |
| Scalability | Doesn't survive past 4-bit blocks |

**Pros:** Zero infrastructure change. Gate-style 1-bit blocks already work this way.
**Cons:** Visual disaster. CPU designs with ~10+ blocks fan out to ~80+ handles. Unwirable in practice.

### Option B — Width-typed handles, no Split/Join

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium |
| Cost (build effort) | ~1 sprint — handle-type metadata + edge validator + frontend visual cue |
| Cost (user UX) | Good — clean visuals, errors-at-connect-time |
| Scalability | Limited — what if user wants to bit-slice a bus? |

**Pros:** Clean visual. Strong type safety. Catches mistakes at connect-time, not at build-time.
**Cons:** Provides no escape hatch. Users sometimes need bit slicing (e.g., "feed bit 0 of the data bus into a status LED"). Without Split/Join they have no way to do this.

### Option C — Width-typed handles + Split/Join blocks ✅ **Chosen**

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium |
| Cost (build effort) | ~1.5 sprints — Option B + 2 new blocks (BusSplit, BusJoin) + 1 example |
| Cost (user UX) | Good — clean default + explicit escape for power users |
| Scalability | Yes — generalizes to any N |

**Pros:** Same type safety as B. Adds explicit composability for the 5% of cases that need it. Aligns with the project's "drag, wire" philosophy: bit-slicing is itself a draggable block.
**Cons:** Two more blocks to maintain. Slightly more learning surface for new users.

### Option D — Width-typed + auto-coercion (silent truncate/zero-extend)

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium-high |
| Cost (build effort) | ~1.5 sprints |
| Cost (user UX) | **Bad** — silent data loss is the worst kind |
| Scalability | Yes |

**Pros:** Most lenient on the user — anything connects to anything.
**Cons:** Violates the project's "no silent miselaboration" principle (the same one Sprint 14 closed the audio-vs-VGA gap on). A user wires a 16-bit ALU output into an 8-bit register, the top 8 bits silently disappear, the design "works" but produces wrong numbers. Worst possible failure mode for a non-technical audience. **Hard reject.**

## Trade-off Analysis

The choice is really between B and C. A is unusable; D is dangerous.

**C wins on flexibility-without-cost.** BusSplit and BusJoin are 30-line Amaranth elaboratables (bit-slice into N 1-bit signals, or concat N 1-bits into a single N-bit signal). The cost of carrying them is negligible. They unblock the "advanced user wants to inspect one bit" scenario without weakening type safety. The visual canvas already has 30 blocks; 2 more in a "Bus" palette category isn't a meaningful surface increase.

B is acceptable as a first ship, with C as the natural follow-up if users hit the bit-slice wall. But shipping C from day one avoids a deprecation cycle (no users yet means no save-format compatibility cost).

**Constraint that picks C over B:** Tiny Tapeout designs frequently want to expose individual signals to specific output pins (debugging LEDs, scope probes). Without Split/Join, the user can't pull a single bit out of an 8-bit register to wire to a `tt_um` output pin. C doesn't just enable bit slicing; it enables **the concrete TT use case** of "this LED reflects bit 3 of the program counter."

## The `BusType` enumeration

```typescript
// frontend/src/blocks/busTypes.ts
//
// Semantic types are domain-tagged (gate-1, audio-s8, pixel-u10) — they
// distinguish "this 8-bit signal is audio" from "this 8-bit signal is
// CPU data" so the renderer can warn even when widths match. Generic
// types (data-uN, data-sN, addr-uN) are width-only — used for CPU /
// register-file / memory / ALU primitives.

export type BusType =
  // ─── 1-bit ───────────────────────────────────────────────────────
  | 'gate-1'         // SEMANTIC: gate / clock / sync / pulse. Existing.
  | 'data-u1'        // GENERIC 1-bit. Compatible with gate-1.

  // ─── 2-bit ───────────────────────────────────────────────────────
  | 'data-u2' | 'data-s2' | 'addr-u2'

  // ─── 3-bit ───────────────────────────────────────────────────────
  | 'data-u3' | 'data-s3' | 'addr-u3'

  // ─── 4-bit (nibble) ─────────────────────────────────────────────
  | 'data-u4' | 'data-s4' | 'addr-u4'

  // ─── 5-bit ───────────────────────────────────────────────────────
  | 'data-u5' | 'data-s5' | 'addr-u5'

  // ─── 6-bit ───────────────────────────────────────────────────────
  | 'data-u6' | 'data-s6' | 'addr-u6'

  // ─── 7-bit ───────────────────────────────────────────────────────
  | 'data-u7' | 'data-s7'

  // ─── 8-bit (byte) ───────────────────────────────────────────────
  | 'audio-s8'       // SEMANTIC: 8-bit signed audio sample. Existing.
  | 'data-u8' | 'data-s8' | 'addr-u8'

  // ─── 9-bit (carry-out from 8-bit add) ──────────────────────────
  | 'data-u9' | 'data-s9'

  // ─── 10-bit ──────────────────────────────────────────────────────
  | 'pixel-u10'      // SEMANTIC: VGA pixel coordinate. Existing.
  | 'data-u10' | 'data-s10'

  // ─── 11-bit ──────────────────────────────────────────────────────
  | 'data-u11' | 'data-s11'

  // ─── 12-bit (DAC, 4 KB address) ────────────────────────────────
  | 'data-u12' | 'data-s12' | 'addr-u12'

  // ─── 13-bit ──────────────────────────────────────────────────────
  | 'data-u13' | 'data-s13'

  // ─── 14-bit ──────────────────────────────────────────────────────
  | 'data-u14' | 'data-s14'

  // ─── 15-bit ──────────────────────────────────────────────────────
  | 'data-u15' | 'data-s15'

  // ─── 16-bit (word) ──────────────────────────────────────────────
  | 'data-u16' | 'data-s16' | 'addr-u16'
```

### Width × sign × purpose matrix

|        | Unsigned | Signed | Address | Semantic-tagged |
|---|---|---|---|---|
| 1-bit  | `data-u1` | (n/a) | — | `gate-1` |
| 2-bit  | `data-u2` | `data-s2` | `addr-u2` | — |
| 3-bit  | `data-u3` | `data-s3` | `addr-u3` | — |
| 4-bit  | `data-u4` | `data-s4` | `addr-u4` | — |
| 5-bit  | `data-u5` | `data-s5` | `addr-u5` | — |
| 6-bit  | `data-u6` | `data-s6` | `addr-u6` | — |
| 7-bit  | `data-u7` | `data-s7` | — | — |
| 8-bit  | `data-u8` | `data-s8` | `addr-u8` | `audio-s8` |
| 9-bit  | `data-u9` | `data-s9` | — | — |
| 10-bit | `data-u10`| `data-s10`| — | `pixel-u10` |
| 11-bit | `data-u11`| `data-s11`| — | — |
| 12-bit | `data-u12`| `data-s12`| `addr-u12`| — |
| 13-bit | `data-u13`| `data-s13`| — | — |
| 14-bit | `data-u14`| `data-s14`| — | — |
| 15-bit | `data-u15`| `data-s15`| — | — |
| 16-bit | `data-u16`| `data-s16`| `addr-u16`| — |

53 enum members total. Address-bus aliases only for practically-useful sizes (4 / 5 / 6 / 8 / 12 / 16 — the sizes a real CPU uses). Signed-1-bit omitted (-0..0 is just 0; gate-1 covers the 1-bit case). Address buses are always unsigned.

### Connection rules

The `isValidConnection` callback in `App.tsx` reads source and target handle bus types and applies these rules:

| Source | Target | Outcome |
|---|---|---|
| Same name both sides | (same) | ✅ Edge draws normally |
| Generic↔generic, same width + sign | e.g. `data-u8` ↔ `data-u8` | ✅ Edge draws normally |
| Semantic↔generic, same width + sign | e.g. `audio-s8` → `data-s8` | ⚠️ Edge draws **dashed**, optional toast: "audio sample → generic data; intentional?" |
| `gate-1` ↔ `data-u1` | (1-bit cross-tag) | ✅ Edge draws normally — these are functionally interchangeable |
| Width mismatch | e.g. `data-u8` → `data-u16` | ❌ Rejected; tooltip: "Use BusJoin to combine multiple smaller buses, or BusSplit to slice a wider one" |
| Sign mismatch | e.g. `data-u8` → `data-s8` | ❌ Rejected (different number ranges; user should pick one) |
| Address↔data, same width | e.g. `addr-u8` → `data-u8` | ⚠️ Dashed (semantic-cross — usually intentional, e.g. computing an address) |

## Consequences

**Becomes easier:**
- CPU primitives (Adder, Subtractor, Register File, RAM, ROM) declare port widths once. Frontend prevents miswiring.
- Handle styling can encode bus type visually — circle for 1-bit, square for 8-bit, hexagon for 16-bit. Users see compatibility before attempting to drag.
- Adding new bus types in the future (24-bit, 32-bit) is just an enum addition.

**Becomes harder:**
- Every existing block's port declarations need a `busType` annotation pass. Mechanical (~30 blocks × ~2 ports avg ≈ 60 metadata strings) but touches all 30 blocks. Lands as a single commit; save-format unchanged.
- The renderer's `validateLoadedGraph` gains a new check: every edge's source-handle bus type matches its target-handle bus type. Catches malformed loaded graphs early.
- The AI consultant prompt (`frontend/src/ai/prompt.ts`) needs updating so the consultant knows which blocks have which bus types when suggesting connections.

**To revisit when:**
- We hit a 32-bit CPU target (RISC-V on iCEBreaker is ~5,280 LCs of CPU; 32-bit data buses become real). The enum scales fine, but the visual handle stack on a 32-bit register would be cluttered if we don't add a "bus connector" rendering style different from per-bit.
- Phase 5 PCB tooling: PCB nets are a different kind of "wire" entirely. Not blocked, just unrelated.

## Action items — Sprint 16

Tracked in [SPRINT-16.md](SPRINT-16.md). Each lands as a single commit:

1. Add `BusType` enum to `frontend/src/blocks/busTypes.ts` + `BLOCK_PORT_TYPES` registry mapping all 30 existing blocks' handles to bus types.
2. React Flow `isValidConnection` callback in `App.tsx` that reads source/target handle bus types and rejects mismatches per the rules above.
3. Visual handle styling keyed off bus type — color or shape — surfaced in `App.css`.
4. Add 2 new blocks: **BusSplit** and **BusJoin** in a new "Bus" palette category. Both parameter-less; both are pure rewires. Block count 30 → 32.
5. Update `validateLoadedGraph` in `App.tsx` to reject edges with bus-type mismatches at Load time, not just at connect time.
6. Update AI prompt in `frontend/src/ai/prompt.ts` so the consultant knows about bus types when suggesting connections.
7. Add tests: rendering tests for BusSplit + BusJoin, save-load roundtrip with bus-type validation.

Total: ~1 sprint of focused work. No new tools. Save-format unchanged.

Sprint 17 onward (post-ADR-001): CPU primitives use the new typed buses. Adder declares `in: data-u8 × 2 → out: data-u9` (carry-out). Register File declares 16 ports of `data-u8`. RAM declares `addr: addr-u8, data-in: data-u8, data-out: data-u8, write-enable: gate-1`. The mechanical primitives become tractable because each port is unambiguous.
