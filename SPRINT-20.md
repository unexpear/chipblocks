# Sprint Plan: Sprint 20 — Register File + LD audit second wave + alpha.9 readiness

> **Solo dev + Claude Code** · Drafted + opened 2026-05-10 · Successor to [SPRINT-19.md](SPRINT-19.md) · No ADR (single-block addition + small polish; the architectural pattern is well-trodden from S17/S18).

**Status:** **CLOSED 2026-05-10.** All planned items shipped. Block count 41 → 42 (Register File added). Pending user-action launch gates: commit the working tree as four focused commits + push the `v0.1.0-alpha.9` tag.

**Sprint Goal:** *Add the Register File block to close the "real CPU register-file shape" gap — same storage as RAM but with independent read and write address ports, so a single block exposes the canonical "fetch source operands, write destination" CPU pattern. Land the LD-audit second-wave items deferred from S19 (modal backdrop guard + error-toast timer redesign + parameter-label rewrites). Repoint launch drafts to alpha.9 so the release is ready when the user pushes the tag.*

---

## Why now

Sprint 19 left two LD-audit items in the "would benefit from more thought" pile (modal backdrop guard + error-toast timer redesign) plus the single-letter parameter labels. Sprint 20 is the right place to land them — none individually justifies a sprint, but the cluster does, and it pairs with one block addition (Register File) so the alpha.9 release covers both a capability story and an accessibility story.

Register File specifically: Sprint 17 / ADR-002 shipped the 4 minimum-viable CPU primitives at 8-bit data + 4-bit address, but RAM has a single shared `addr` port (read and write target the same cell each cycle). That works for sequential scratch storage, but it doesn't match how real CPU instruction sets address registers — an `add R1, R2, R3` instruction reads R2 and R3 *and* writes R1 in one cycle, decoded from three separate fields of the instruction word. The Register File block exposes that shape with independent `read-addr` and `write-addr` ports.

Cost is small: same `amaranth.lib.memory.Memory` primitive RAM uses, just two ports instead of one shared port. Same data-u8 + addr-u4 widths. The cookbook is well-trodden.

---

## Working Assumptions

| Assumption | Default | Change if... |
|---|---|---|
| Sprint length | **single focused day** (1 block + 1 worked example + 2 LD items + label rewrites + doc bumps + launch-draft repoint) | Hidden complexity in any item |
| Stack | unchanged from S19 | n/a |
| Block count target | 41 → 42 (Register File only) | n/a |
| Save-format | unchanged (Register File is parameterless) | n/a |
| Tracking | git commits + this `SPRINT-20.md` log | n/a |

---

## Sprint Goal — concrete targets

### S20-1 — Register File block (independent read / write addresses)

- Backend `backend/blocks/register_file.py`. 16 × 8-bit unsigned, zero-initialized. `amaranth.lib.memory.Memory(shape=unsigned(8), depth=16)` with one combinational read port (addressed by `read_addr`) and one synchronous write port (addressed by `write_addr`, gated by `write_enable`). Both ports independent.
- Frontend `RegisterFileNode.tsx`. 4 input handles (`read-addr`, `write-addr`, `data-in`, `write-enable`) via `handleTop(0..3)`; 1 output handle (`data-out`). Title "Reg File", body "16 × 8-bit".
- Type id: `registerfile`
- Palette category: "Computation" group. Border color `#1455a5` — one notch deeper than Register's `#1565c0` to read as "register file kin of Register."
- Backend test: write 42 → register 5, read register 5 returns 42. Then write 99 → register 10 *while* read-addr is still 5 — assert read still returns 42 (proves independent ports). Switch read-addr to 10, assert 99. Read register 3 (never written), assert 0.
- BLOCK_PORT_TYPES: `registerfile: { 'read-addr': 'addr-u4', 'write-addr': 'addr-u4', 'data-in': 'data-u8', 'write-enable': 'gate-1', 'data-out': 'data-u8' }`

### S20-2 — Worked example: `cpu-multiregister.json`

- Two Counter blocks at different `max_value` (16 / 4), both clocked by the same Gate (200 Hz). Counter A → RegisterFile.read-addr (full 16-cell sweep); Counter B → RegisterFile.write-addr (4-cell sweep) + ROM.addr.
- ROM contents: `[16, 48, 80, 112, 0, 0, ..., 0]` (a ramp in the first 4 cells, zeros elsewhere). ROM.data-out → RegisterFile.data-in.
- Gate → RegisterFile.write-enable (writes every cycle).
- RegisterFile.data-out → Reinterpret → Output.
- After settling, registers 0..3 hold (16, 48, 80, 112); registers 4..15 hold 0. The read sweep produces a 4-step ramp followed by 12 zero cells, audible as a ~12 Hz pattern with rhythmic character.
- Mirror entry in `frontend/src/examples.ts` so it appears in Load → Examples.
- Backend pipeline test `test_register_file_multiport_pipeline_runs` exercises the same graph end-to-end through synth.py.

### S20-3 — LD audit: modal backdrop click guard

- Track `hasInteracted: boolean` state in both `SettingsModal.tsx` and `AboutModal.tsx`. Flip to true on any keydown or pointer-down inside the modal content (via `onKeyDownCapture` + `onPointerDownCapture` on the modal `div`).
- Backdrop `onClick` becomes `onBackdropClick`: checks `e.target === e.currentTarget` AND `!hasInteracted`. If interacted, no-op. × button and Escape always close.
- LD audit autism/sensory finding: prevents a stim-prone tap outside the modal from losing a partial paste of an API key or reading position.

### S20-4 — LD audit: error-toast timer redesign

- `App.tsx` auto-dismiss effect: bump unclassified toasts from 6s → 12s. Classified setup errors stay at 20s (they include copy-paste content). Documented inline in a comment block at the call site.
- LD audit ADHD finding: 6s is too short for attention-drift re-reads; 12s gives ~3× the dwell.

### S20-5 — LD audit second-wave: single-letter parameter labels

- ADSR: A/D/S/R → Att/Dec/Sus/Rel (3-char readable forms; `aria-label` stays as full-word screen-reader text).
- FM: C/M/D → Car/Mod/Dep.
- PixelRange: was already `start`/`end` (the S19 audit memo had documented this incorrectly; the labels were explicit when checked).
- Frontend vitest assertions updated in lock-step.

### S20-6 — Doc count bumps + launch-draft repoint

- 41 → 42 across BLOCKS.md (top-line + Computation TOC), README.md, ROADMAP.md, CLAUDE.md, ARCHITECTURE.md, RELEASE-NOTES, ANNOUNCEMENT-DRAFTS (4 venues), HACKADAY-WRITEUP.
- 13 → 14 bundled examples in RELEASE-NOTES.
- Launch drafts repointed `v0.1.0-alpha.8` → `v0.1.0-alpha.9` (ANNOUNCEMENT-DRAFTS, HACKADAY-WRITEUP).
- BLOCKS.md gets a new "Register File" subsection in Computation with a "Register File vs RAM" explanation (independent vs shared address port — the architectural distinction that justifies the new block).
- AI prompt updated with Register File entry, RegisterFile usage patterns, addr-u4 list extension, and naming-conventions extension. Also picked up the ByteConstant entry that S19 added but didn't propagate into `STATIC_SYSTEM` — small Sprint 20 cleanup.

---

## Sprint Log

**2026-05-10** — Sprint opens with the dispatched-agent attempt failing fast on a rate limit at 8 tool calls (single-shot block addition is normally well within an agent's budget, but the Anthropic API was temporarily throttling). Pattern from S17 still works in principle; this run was unlucky.

- **S20-1 ✅ Register File block** — full 8-file cookbook done directly (cookbook is well-trodden enough that re-dispatching wasn't worth the round-trip). 16 cells, two ports. Backend test asserts the independent-port behavior end-to-end.
- **S20-2 ✅ cpu-multiregister example** — JSON + examples.ts mirror + backend pipeline smoke test. Tests green (62 + 2 skipped backend → 63 + 2; 156 frontend → 158).
- **S20-3 ✅ Modal backdrop guard** — `hasInteracted` pattern on Settings + About modals.
- **S20-4 ✅ Error-toast timer** — bumped 6s → 12s for unclassified.
- **S20-5 ✅ Single-letter labels** — dispatched as a separate agent (well-bounded mechanical change with assertion updates). Completed; ADSR + FM updated, PixelRange was already correct.
- **S20-6 ✅ Doc bumps + launch-draft repoint** — README, ROADMAP, CLAUDE, ARCHITECTURE, RELEASE-NOTES, ANNOUNCEMENT-DRAFTS, HACKADAY-WRITEUP, BLOCKS all on 42 blocks / 14 examples / alpha.9. AI prompt picked up Register File + ByteConstant in the same pass.

**Block count:** 41 → 42.
**Tests:** 62 + 2 skipped → 63 + 2 skipped (backend); 156 → 158 (frontend, +1 component test for RegisterFileNode, +1 examples-consistency for cpu-multiregister, +0 from label rewrites since they updated existing assertions).

---

## Retrospective

### What went well

- **The Register-File-vs-RAM distinction is genuinely useful, not just architectural neatness.** The "independent read and write addresses" framing makes the value clear to a non-technical reader: same storage, but the read and write don't have to point at the same register. That's how `add R1, R2, R3` works in real instruction sets — three separate fields, decoded in one cycle. The worked example (two Counters at different rates) demonstrates the value without needing a full instruction-decoder.
- **The 8-file cookbook is stable enough to run on rate-limited budgets.** When the dispatched agent failed at 8 tool calls, the cookbook was well-known enough that finishing by hand cost ~15 min, not a re-dispatch round-trip. This is the cookbook paying off.
- **The dispatched single-letter-label agent was the right shape for that work.** Mechanical change, assertion-updating in lock-step, single-pass test verification. Completed cleanly in one round.

### What didn't

- **Working-tree size at sprint close is bigger than ideal for a single commit.** 24 modifications + 3 new files spans 4 logically distinct units (Sprint 20 block, worked example + pipeline test, LD audit fixes, doc bumps + launch-draft repoint). Commit-splitting is straightforward but deferred — the user does the commits. Worth committing earlier next sprint to avoid the dirty-tree audit overhead.
- **The block-manifest refactor keeps getting pushed.** S18 retro flagged the trigger condition. S19 retro reaffirmed. S20 didn't take it on. The Register File addition this sprint was the *third* block in the same `data-u8` + `addr-u4` shape this year (RAM, ROM, Register File — they share a substantial fraction of the cookbook). The manifest refactor's cost-benefit is now well past break-even; Sprint 21 should make it the only thing.
- **ANNOUNCEMENT-DRAFTS.md was missing ByteConstant entirely** before this sprint started — it had been added in Sprint 19's block-count bump but the per-block list in three of the four announcement drafts didn't pick it up. Caught in the S20 doc-bump pass but it would have shipped wrong otherwise. Worth a CI lint that scans launch drafts against `PALETTE` / `BLOCK_REGISTRY` for any block not mentioned.

### Surfacings — candidates for the next sprint

1. **Block-manifest refactor (Sprint 21).** Now overdue twice. Spec it as a sprint of its own — a `blocks/manifest.ts` row per block (type, label, ports, params, color, description), codegens the registries on both sides. Drops future block additions from 8 files to ~2. Estimate 6h.
2. **Launch-draft / per-block-list CI lint.** A simple test that asserts every `PALETTE` entry is named in ANNOUNCEMENT-DRAFTS, HACKADAY-WRITEUP, README, RELEASE-NOTES. Caught one drift this sprint; the next time the launch drafts are dusty enough to miss something quieter (description text, naming style), the lint would flag it before launch.
3. **Documentation pass for the existing CPU examples.** Now that ByteConstant exists (S19) and Register File exists (S20), `cpu-accumulator.json` and `cpu-counter-with-branch.json` could be rewritten to use ByteConstant for their single-value constants (instead of 16-element ROMs of `[1, 1, ..., 1]`). That's a doc/example cleanup, not a code change, but it makes the CPU examples much clearer for the LD-audit target audience.
