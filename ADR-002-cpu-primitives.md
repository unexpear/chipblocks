# ADR-002: CPU primitive block set for Sprint 17

**Status:** Proposed (drafted 2026-05-10) · **Deciders:** solo dev (you) + Claude Code · **Implements:** Sprint 17 (to be opened)

> Second project ADR. Builds on [ADR-001](ADR-001-multi-bit-bus-types.md) (typed bus system, shipped in Sprint 16). With the bus-type infrastructure in place, every CPU primitive can declare its port widths cleanly and the validator catches miswiring. The remaining decisions are **which primitives, what shapes, and how programs get loaded into ROM.**

## Context

ChipBlocks now has 32 blocks across audio, logic, and visual domains. The PRD lists "glue-logic chip" and "1-core CPU on Tiny Tapeout silicon" as in-scope use cases, but neither is buildable today because:

- **No multi-bit arithmetic.** Multiply exists (8-bit signed), but no Adder, Subtractor, Comparator, or Shifter. Boolean gates (AND/OR/XOR/NOT) work on 1-bit signals only.
- **No memory primitives.** Delay has internal memory (`amaranth.lib.memory.Memory`) but it's transparent — no addressable read/write. There's no Register, RAM, or ROM block.
- **No way to load instructions.** Even if RAM and a Counter (program counter) existed, there's no mechanism to populate ROM with program bytes.

A v0.1 CPU needs enough primitives to build something like a SAP-1 (Simple-As-Possible) or a tiny accumulator machine — load instruction → execute → load next. The Tiny Tapeout target (iCE40UP5K, 5,280 LCs, 128 KB BRAM) fits an 8-bit CPU comfortably; people have shipped picoRV32 (32-bit RISC-V) on chips of this class, so an 8-bit accumulator machine is well within reach.

This ADR picks the v0.1 primitive set and the program-loading mechanism. Sprint 17 implements the ADR's choices.

## Decision

**Ship 4 new blocks** for Sprint 17, plus a worked example demonstrating an 8-bit accumulator machine on Tiny Tapeout silicon:

1. **Adder** — `data-u8 × 2 → data-u9` (8-bit unsigned + carry-out)
2. **Register** — single 8-bit register: `data-u8 in + gate-1 write-enable → data-u8 out`
3. **RAM** — `addr-u4 + data-u8 in + gate-1 write-enable → data-u8 out` (16-byte synchronous RAM)
4. **ROM** — `addr-u4 → data-u8 out` (16-byte combinational read-only memory; contents loaded from a `data` parameter as a JSON array of integers)

Block count goes 32 → 36. **ROM uses inline JSON-array initialization** (per the recommended option below — the program lives in `node.data.contents: number[]`, round-trips through save/load, AI-editable). **8-bit data + 4-bit address** as the v0.1 width pair (16-byte memory matches what fits cleanly on a single iCE40 BRAM and demonstrates the architecture without overwhelming the visual canvas).

Subtractor, Comparator, Shifter, full register file (16 × 8-bit), and 8-bit address space (256 bytes) are explicitly **deferred** to Sprint 18+. Each is small once the patterns from Sprint 17 are established; the deferral preserves single-sprint scope and lets the actual CPU example expose what's missing.

## Options Considered

### Option A — Maximum granularity (10+ blocks, 2–3 sprints)

Ship every primitive a real CPU might want: Adder, Subtractor, Comparator (==, <, >), ShiftLeft, ShiftRight, Mux, Decoder, Encoder, Register, Register File, RAM, ROM.

| Dimension | Assessment |
|---|---|
| Complexity | High |
| Cost (build effort) | 2–3 sprints |
| Cost (user UX) | Mixed — flexible for power users, overwhelming for "I just want to see a CPU work" |
| Scalability | Best long-term, no abstraction debt |

**Pros:** Every CPU pattern is buildable. No user ever has to compose a primitive from smaller ones.
**Cons:** 10+ blocks at once is a lot of cookbook surface. Risk of half-finished primitives if scope cut mid-sprint. The first user who wants a CPU just needs *enough* primitives, not all of them.

### Option B — Minimum viable CPU (4 blocks, 1 sprint) ✅ **Chosen**

Adder, Register, RAM, ROM. Subtractor composed from Adder + a NOT-bus pattern (or deferred). Multiplier already exists. Comparator deferred (can compose from Subtractor + sign-bit check). Shifter deferred (nibble-shift via BusSplit + BusJoin re-ordering). No Register File — start with a single Register and build a 4-register file from 4 instances + a 2-bit address mux.

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Cost (build effort) | 1 sprint (~4 blocks × the now-well-established 8-file cookbook) |
| Cost (user UX) | Strong — a small kit users can wrap their heads around |
| Scalability | Good — Sprint 18+ adds primitives as the worked example surfaces what's missing |

**Pros:** Ships in one sprint. Minimum surface area, every block is genuinely needed for the worked example. Deferred primitives become obvious when the example exposes what's awkward to compose.
**Cons:** Subtraction requires 2's-complement composition (tricky for non-technical users). Comparators less convenient. Single Register means a 4-register file is 4 blocks + addressing logic — visually busier than a one-block solution would be.

### Option C — Single configurable ALU (4 blocks, 1 sprint, different shape)

ALU (op parameter ∈ {add, sub, and, or, xor, eq, lt, shl, shr}), Register File (16 × 8-bit, addressed), RAM, ROM.

| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Cost (build effort) | 1 sprint |
| Cost (user UX) | Mixed — single block is convenient but op-as-parameter is a hidden state |
| Scalability | OK — adding new ops is just an enum extension |

**Pros:** One ALU block instead of N. Register File built-in saves the address-mux composition burden.
**Cons:** "ALU op = parameter" hides what's happening — the visual graph just shows "ALU"; what op? Need to click in. Conflicts with the project's "wire blocks together to see the design" philosophy. Also: a 16-port Register File is visually huge (32 handles for separate read/write ports), and the addressing semantic gets weird in a node-graph paradigm.

## Trade-off analysis — Option B vs C

The choice is really between B and C. A is too much for one sprint; both B and C ship in one sprint but in different shapes.

**B wins on philosophical alignment with ChipBlocks's "drag, wire, build" pitch.** The whole point of the project is that the visual graph IS the design — what you see is what you get. An ALU block with a hidden op-parameter contradicts that: the same block can mean "add" or "subtract" depending on a setting the user has to remember to check. That's the same kind of cognitive load that "1 block can hide arbitrary behavior" introduces, and the project has been deliberately avoiding it (Counter has one parameter and it's just `max_value`, not a behavior switch).

B's Adder is unambiguously an adder. Subtraction is composed: Adder + invert-and-add-1, which IS what subtraction is at the gate level. That's pedagogically honest in a way "ALU.op = sub" isn't.

**C wins on visual compactness.** Single ALU vs 5 small blocks reduces canvas clutter. But the rebuttal: the 5 small blocks are mostly NOT used in the same graph. A typical 8-bit CPU has one Adder, not five small ALU primitives. Compactness isn't actually saved — what saves compactness is shipping fewer primitives (Option B), not consolidating them.

**Constraint that picks B:** the worked example. Sprint 17's deliverable is "an 8-bit accumulator machine running on Tiny Tapeout silicon." That example uses Adder + Register + RAM + ROM + existing Counter (PC) + existing logic gates. Doesn't need a Comparator (single test instruction skipped), doesn't need a Shifter, doesn't need a full Register File. Option B ships exactly what the example uses.

## ROM loading — sub-decision

ROM needs program bytes. Options:

### ROM-A — Inline hex string parameter

```json
{ "type": "rom", "data": { "contents_hex": "DEADBEEF..." } }
```

**Pros:** Compact JSON. Familiar from x86 assembly listings.
**Cons:** Hex parsing in the renderer (more code, more validation surface). User has to mentally convert byte-by-byte when reading. Doesn't compose well with the AI's tool-call pattern (AI would have to emit a hex string).

### ROM-B — JSON array of integers ✅ **Chosen**

```json
{ "type": "rom", "data": { "contents": [222, 173, 190, 239, ...] } }
```

**Pros:** Renderer just validates `Array<number>` shape; no parsing. AI can emit `update_node_params({contents: [...]})`. Hand-editable. Round-trips through save/load without surprises. Numbers up to 255 are read directly.
**Cons:** Slightly verbose for long programs (a 16-byte ROM is `[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]`). Hex would be denser.

**Recommendation: ROM-B, with a v0.2 enhancement that accepts both `contents` (numbers) and `contents_hex` (string) — automatically prefer the latter if present.** v0.1 ships the JSON-array version only.

### ROM-C — Separate file upload

User clicks "Load ROM..." in the block's UI; binary file gets stored in localStorage or a per-graph asset bucket.

**Pros:** Familiar pattern from game engines (assets vs code).
**Cons:** Save format complication (assets need to live somewhere). Doesn't round-trip cleanly through plain JSON. Renderer would need new file-handling code in Electron main. Scope creep.

**Reject:** save-format complication outweighs the ergonomics benefit at v0.1. Reconsider when ROM sizes exceed ~256 bytes (which is far past v0.1).

### ROM-D — Generated from a sub-graph

A separate "ROM contents" tab where the user drags Constant blocks to define each byte.

**Pros:** Maximally graph-native; very on-brand.
**Cons:** A 16-byte ROM is 16 Constants on a sub-canvas. A 256-byte ROM would be unmanageable. Sub-graphs themselves are a feature we don't have yet — this would require building a sub-graph system before any CPU primitives could ship. Massive scope expansion.

**Reject:** the cost dwarfs the benefit. Sub-graphs are a Phase-4+ feature in their own right.

## Width choice — sub-decision

Why 8-bit data + 4-bit address (16-byte memory)?

- **8-bit data** is the smallest interesting CPU width — fits one byte, one ASCII character, one signed audio sample. Matches the existing audio bus convention. Smaller (4-bit) is too cramped to do anything useful; larger (16-bit) doubles every primitive's port count and the visual canvas gets crowded.
- **4-bit address (16 bytes)** is enough to demonstrate the architecture without overwhelming the canvas. A 16-byte program can run a Fibonacci accumulator (~10 instructions), a "blink an LED in a pattern" sequencer (~5 instructions), or a "count to 10 and halt" demo (~6 instructions). 256 bytes (8-bit address) is the obvious next step but adds a `BusSplit`/`BusJoin` to every memory wiring.
- **Single iCE40 BRAM** holds 4 KB; a 16-byte RAM uses ~0.4% of one BRAM. Trivially fits on every supported FPGA target.
- **Sprint 18+ scales up:** once the worked example is real, widening to 8-bit address (256-byte memory) is mechanical — the same Adder + Register + RAM + ROM blocks parameterized to wider widths.

## Consequences

**Becomes easier:**
- Sprint 17 has one focused deliverable: the 8-bit accumulator machine.
- Each new primitive is shaped exactly like one of the existing 32 blocks (8-file cookbook, BLOCK_PORT_TYPES entry, Amaranth Elaboratable). No novel patterns.
- ADR-001's typed-bus system catches every CPU-primitive miswiring at drag time.

**Becomes harder:**
- 4-bit address means a "real" CPU example tops out at 16 bytes of code + data combined. Big enough for "compute Fibonacci" or "blink in a pattern," not big enough for "interpret an instruction set with operands." Sprint 18 will want 8-bit address.
- Single Register (no Register File) means a multi-register design uses N Register blocks + AND-gate addressing. Visually busy; pedagogically clear. Tradeoff lands on the right side for v0.1 but a Register File block is a clear Sprint-18 candidate.
- ROM bytes live in the saved JSON. Large programs would bloat the file. At 16 bytes, a fully-populated ROM adds ~80 bytes to the JSON — negligible.

**To revisit when:**
- The worked example surfaces a primitive that's awkward to compose (e.g., a 4-byte right-shift for division — would be ugly via BusSplit + BusJoin manual rotation).
- Users hit the 16-byte program limit and want a real CPU. Sprint 18 widens to 8-bit address.
- A community contribution wants to add a Subtractor or Comparator — those are clean follow-on PRs against the patterns established in Sprint 17.

## Action items — Sprint 17

Each lands as a single commit:

1. [ ] **Adder block**: backend `backend/blocks/adder.py` (Amaranth combinational `out.eq(in_a + in_b)` with 9-bit output for carry), frontend `AdderNode.tsx`, registry entry `adder: { 'in-a': 'data-u8', 'in-b': 'data-u8', 'sum': 'data-u9' }`. Backend test: `Constant(100) + Constant(50) → 150 / 0`.

2. [ ] **Register block**: backend `register.py` (synchronous: `with m.If(write_enable): m.d.sync += stored.eq(data_in)`), frontend `RegisterNode.tsx`, registry `register: { 'data-in': 'data-u8', 'write-enable': 'gate-1', 'data-out': 'data-u8' }`. Backend test: write 42 on a clock edge, verify data-out reads 42 thereafter.

3. [ ] **RAM block**: backend `ram.py` (4-bit address × 8-bit cells × 16 entries via `amaranth.lib.memory.Memory`; combinational read on the current address, synchronous write gated by write_enable), frontend `RAMNode.tsx`, registry `ram: { 'addr': 'addr-u4', 'data-in': 'data-u8', 'write-enable': 'gate-1', 'data-out': 'data-u8' }`. Backend test: write 99 to addr=5, then read addr=5, verify data-out=99.

4. [ ] **ROM block**: backend `rom.py` (combinational lookup against a `contents: list[int]` constructor parameter, padded/truncated to 16 entries), frontend `ROMNode.tsx` with a `contents` field (array of integer 0–255 inputs, 16 of them, validated), registry `rom: { 'addr': 'addr-u4', 'data-out': 'data-u8' }`. Backend test: instantiate ROM with `[10, 20, 30, ...]`, read each address, verify each.

5. [ ] **Worked example: 8-bit Fibonacci accumulator** in `examples/cpu-fibonacci.json`. Build a tiny program that: ROM holds Fibonacci program; Counter is the program counter; RAM holds intermediate values; Register holds accumulator; output drives an iCE40 LED via a BusSplit. Verify end-to-end on iCEBreaker.

6. [ ] **`BLOCKS.md`** new "CPU" or "Computation" section with all 4 primitives + a "How to build a CPU from these" sub-section walking through the worked example.

7. [ ] **Doc count bumps** 32 → 36 across the usual files (README, ROADMAP, CLAUDE, CONTRIBUTING, ARCHITECTURE, RELEASE-NOTES, ANNOUNCEMENT-DRAFTS, HACKADAY-WRITEUP).

8. [ ] **Tests:**
   - `backend/tests/test_blocks.py`: one property test per new block (specified in items 1–4 above).
   - `frontend/test/blocks.test.tsx`: rendering tests for all 4.
   - New `backend/tests/test_cpu_example.py`: end-to-end test that the Fibonacci example synthesizes to a non-zero WAV (Output drives the LSB of the accumulator, audio path proves the CPU is executing).

9. [ ] **Sprint retro** in `SPRINT-17.md` capturing what surfaced. Likely candidates for the "what's missing" list: Subtractor, Comparator, Register File, 8-bit address.

10. [ ] **Tag `v0.1.0-alpha.6`** with the 4 new blocks + worked example.

Total estimated effort: ~1 focused sprint. The 8-file cookbook is now well-trodden (S13 / S15 / post-S15 / S16-4 all followed it cleanly). The novel piece is the ROM block's `contents` parameter — first ChipBlocks block where the parameter is an array, not a scalar. Worth landing carefully but not architecturally hard.

## Sprint 18+ candidates exposed by this ADR

Concrete next-up items the ADR explicitly defers:

- **Subtractor** (`data-u8 × 2 → data-s9`) — once users want a Comparator-via-subtract pattern.
- **Comparator** (`data-u8 × 2 → gate-1`) — equality / less-than / greater-than as 3 separate small blocks or one with an op-enum.
- **Shifter** (`data-u8 + data-u3 → data-u8`) — left/right by N bits.
- **Register File** (16 × 8-bit, addressed) — visual compactness win once 4+ Register instances start cluttering canvases.
- **8-bit address space** (256-byte RAM/ROM) — same Adder/Register pattern at wider width; Sprint 16's deferred parameterized-width BusSplit/BusJoin lands alongside.
- **Single-ALU block (Option C)** — only if users actually ask for it; the philosophical objection (hidden behavior) stands until then.

Each is a clean PR-sized addition once Sprint 17's primitives ship.
