# Sprint Plan: Sprint 14 — Architectural hygiene + a11y backport

> **Solo dev + Claude Code** · Drafted 2026-05-09 (PM) · Closed 2026-05-09 (PM, same session) · Successor to [SPRINT-13.md](SPRINT-13.md) · Operational source: in-conversation `/design:design-system` audit + `/engineering:system-design` review (2026-05-09)

**Status:** **CLOSED.** All 6 planned items shipped in 6 commits. CI green on master. No sprint-14 release tag — these were pure architectural cleanups, not user-visible features; v0.1.0-alpha.3 stays the live release.

**Dates:** TBD — single session expected (~1.5 days backend + ~1 hour frontend).
**Team:** Solo (user + Claude Code as dev pair).
**Sprint Goal:** *Take the four cheapest fixes the post-multi-domain audits found, plus backport the accessibility standard the visual-blocks agent established to the 10 older blocks that fell behind. After this sprint, the audio-vs-visual-vs-logic seams in synth.py + build.py + BoardTop are explicit rather than tacit, and every block in the library has the same Handle-level a11y as the newest three.*

---

## Why now

Two audits ran on 2026-05-09 right after v0.1.0-alpha.3 shipped (commits `5be6d05` + `4ec6e8b` + `be0aeca` — 5 logic blocks + iCEBreaker + 3 visual blocks). They independently surfaced the same pattern:

- The architecture **absorbed** the multi-domain expansion correctly (all 4 silicon targets build, the visual graph elaborates end-to-end on iCEBreaker, audio paths still work) — but it absorbed it via two band-aids that will compound if not narrowed: the `require_audio_output` flag on `GraphTop` and the `has_vga` branch in `BoardTop.elaborate`.
- Three of the agent-driven block additions skipped the Handle-level `aria-label` standard the visual-blocks agent applied. **10 blocks** are now behind the newest 3 on accessibility, in the same library, by the same project.

Neither finding blocks the v0.1.0-alpha.3 launch — the released installers are functional and the architecture works. They are the kind of cleanup that compounds when deferred and is cheap when fixed at 27 blocks / 4 silicon paths.

The S9 launch carryforwards (post the 4 announcement drafts, submit the Hackaday writeup) are still on the user's plate.

---

## Working Assumptions

| Assumption | Default | Change if... |
|---|---|---|
| Sprint length | **single session** | Larger refactor surfaces |
| Availability | one focused session | n/a |
| Stack | unchanged from S13 | n/a |
| Block count | stays at 27 (no new blocks this sprint) | A user request demands one |
| Save format | **stays at current SAVE_VERSION** | The opportunistic logic-block port rename ships, which would be a save-format-breaking change requiring a migration |
| Tracking | git commits + this `SPRINT-14.md` log | Want issues |

---

## Sprint Goal — concrete targets

### Backend architectural hygiene (P0)

Source: in-conversation `/engineering:system-design` review, 2026-05-09. All four are independent and each lands as a separate commit.

1. **Centralize `BuildTarget` union** — currently duplicated literally as `'icestick' | 'tinyfpga-bx' | 'icebreaker' | 'tt'` in 3 files: `frontend/src/types/ipc.ts:21`, `frontend/electron/main/ipc.ts:194`, `frontend/electron/preload/index.ts:16`. The 5th silicon target adds 3 places to drift. Fix: import `BuildTarget` from `frontend/src/types/ipc.ts` in the other two; verify `tsc --noEmit` is still clean. **~5 min.**

2. **Replace `require_audio_output: bool` with `output_kinds: set[str]`** — `GraphTop.__init__` (synth.py around line 118) currently carries a boolean flag whose only purpose is to suppress the "no Output block" raise in build.py's visual path. The 4th domain (e.g. UART/serial) will need a 3rd flag — flag soup. Replace with a small validator the caller composes itself: `validate_has_audio_output(graph)` in synth.py and `validate_has_any_output(graph, kinds={"output", "vgaoutput"})` in build.py. GraphTop drops the flag. **~30 lines.**

3. **Explicit reject of mixed audio + visual graphs** — currently a user can wire `Oscillator → Output` AND `VgaTiming → ColorBars → VgaOutput` in one graph; build.py silently downgrades audio (no `EnableInserter`, audio runs at 12 MHz) because `has_vga` is set purely on graph contents (build.py:386). Violates the "no silent miselaboration" requirement. Fix: explicit reject in `BoardTop.__init__` when both audio Output and VgaOutput exist, with the same friendly-error pattern synth.py already uses; mirror in the renderer's pre-Build check (the existing `validateLoadedGraph`). **~40 lines (backend + renderer).**

4. **Split `BoardTop._elaborate_audio_only` and `_elaborate_vga`** — `BoardTop.elaborate` (build.py:402–475) has a top-level `if has_vga:` branch that's grown to ~80 lines with both branches mixed. Extract to two named helpers; `elaborate` stays ~10 lines and dispatches. Pure refactor; sets up Phase-3 multi-domain clock-domain plumbing later. **~20 lines (no behavior change).**

### Frontend a11y backport + design-system hygiene (P1)

Source: in-conversation `/design:design-system` audit, 2026-05-09. Score 82/100. The visual-blocks agent applied a stricter Handle-level `aria-label` standard than earlier agents; bring the rest of the library to parity.

5. **Add `aria-label` to all `<Handle>` elements in the 10 blocks that lack them** — `AndGateNode`, `OrGateNode`, `XorGateNode`, `NotGateNode`, `MixerNode`, `MultiplyNode`, `OutputNode`, `SampleAndHoldNode`, `NoiseNode`, `GateNode`. Pattern: `aria-label="[Signal name] [direction]"` (e.g., "First input", "Output gate") matching the `VgaTimingNode` / `ColorBarsNode` / `VgaOutputNode` precedent. **~30 lines across 10 files.**

6. **Extract `HANDLE_SPACING_PX = 32` constant** — currently implicit in `App.css` `.block-vgatiming` min-height + inline comments in TSX; magic number that future blocks will cargo-cult. Hoist to a shared constant and reference. **~5 min.**

### Out of scope (deferred to later sprints, tracked in [KNOWN-ISSUES.md](KNOWN-ISSUES.md))

- **Block-manifest auto-discovery** (kills the 8-files-per-block cookbook) — defer until ~block #35 OR until block-shape variance settles. Today VGA Timing has 5 outputs, Counter has clocked semantics, ADSR has multi-row UI — too much variance to freeze yet.
- **Multi-domain clock plumbing** — the proper fix to mixed audio + visual chips. Needs `m.d.audio` / `m.d.pixel` clock-domains and per-block `domain` tags in Amaranth. Phase-3 work; 1+ sprint of investment for zero v0.1 user payoff.
- **Logic-block port-naming asymmetry** — AND/OR/XOR use `in-1`/`in-2` for inputs but `gate-out` for output; NOT uses `gate-in`. Renaming breaks the save format → needs SAVE_VERSION bump + migration. Cosmetic; not worth a save-format-breaking change in v0.1.
- **`FPGABoard.peripherals: list[Peripheral]`** generalisation — defer until the 2nd optional PMOD peripheral lands (audio jack, OLED, MIDI, etc.). Pre-abstraction at peripheral #1 is overengineering.

---

## Sprint Log

Six commits in sequence on master, each one a single P0 or P1 item from the plan above. CI green on every commit.

| # | Commit | Item | Files | Notes |
|---|---|---|---|---|
| 1 | `1dc97be` | Centralize `BuildTarget` union | 2 | Type-only `import type { BuildTarget }` from `frontend/src/types/ipc` in both Electron-side files. ~5 min as predicted. |
| 2 | `b4dfb13` | Extract handle-spacing constants | 11 (+1 new) | New `frontend/src/blocks/handleSpacing.ts` exports `HANDLE_FIRST_PX = 24`, `HANDLE_SPACING_PX = 32`, `handleTop(slot)`. Migrated all 10 block components that had inline `top: 24/56/88/120/152` literals. Slot-index reads more clearly than absolute pixels. |
| 3 | `9f2c63a` | Replace `require_audio_output` flag with caller-side validator | 2 | New top-level `validate_has_audio_output(graph)` in `synth.py`. `GraphTop` constructor drops the parameter. `BoardTop` no longer passes `require_audio_output=not self.has_vga`. The 4th domain won't need a 3rd flag. |
| 4 | `24308fd` | Explicit reject of mixed audio + visual graphs | 3 (+1 test) | New `reject_mixed_audio_and_visual(graph)` in `build.py`. `BoardTop.__init__` calls it first. Renderer-side mirror in `App.tsx`'s `handleBuild` saves the WSL2 round trip. New pytest test covers the BoardTop reject path. Closes the silent-miselaboration window without doing the Phase-3 multi-domain refactor. |
| 5 | `23391fe` | Split `BoardTop._elaborate_audio_only` / `_elaborate_vga` | 1 | Pure refactor + dead-code removal: the "audio in a VGA graph" fallback branch is now unreachable thanks to S14-4's reject. Both build paths verified end-to-end on real iCEBreaker — both produce 104,090-byte bitstreams identical to pre-refactor. |
| 6 | `9ed4b9e` | aria-label on every Handle in every block | 24 | Went beyond the audit's named 10 to bring all 24 non-visual blocks to full parity with the 3 visual ones. Pattern matches the visual-block precedent: `aria-label="<Signal name> <direction>"`. Library now has 100% Handle-level aria-label coverage across all 27 blocks. |

Test counts after sprint:
- backend pytest: 44 passed + 2 skipped (was 43 + 2 — added 1 test for mixed-graph reject)
- frontend vitest: 98 passed (unchanged; the renderer-side reject is a 4-line guard not worth a vitest at this scale)
- tsc: clean

End-to-end verification on real OSS CAD Suite hardware pipeline (post-S14-5):
- `examples/two-osc-mix.json` → iCEBreaker: 104,090-byte bitstream + 7,057-byte zip ✓
- `examples/color-bars.json` → iCEBreaker: 104,090-byte bitstream + 7,692-byte zip ✓

---

## Retrospective

### What worked

- **Audit-first ordering.** Doing `/design:design-system` and `/engineering:system-design` in the same session as v0.1.0-alpha.3's launch surfaced the seams while they were still cheap to fix. Each item was 5 min to ~40 lines; doing them now while only 2 callers depend on each shape is much cheaper than waiting until the 4th domain ships and the band-aids have compounded.
- **Six small commits, not one big one.** Every item had its own commit with its own test green. If signal had shifted at any point, we could have stopped after S14-1 (5 min in) or S14-3 (~30 min in) with consistent state.
- **Going beyond the audit on aria-labels.** The audit named 10 blocks. Doing all 24 was the same kind of work and avoided leaving a future agent to revisit the same files. Library-wide consistency is the real goal; the audit's count was a floor not a ceiling.
- **Catching dead code in S14-5.** The "audio in a VGA graph" fallback branch in `BoardTop` was only reachable via the path S14-4 had just made explicitly impossible. Removing it in the same sprint as the reject keeps the architectural narrative coherent.

### What surfaced

- **The block component file structure is now ready for the manifest refactor.** Six commits' worth of mechanical edits across 24 files is exactly the kind of change that wants a single block-manifest format — adding aria-label took 24 file edits because each block component lists its handles inline. Tracked as KNOWN-ISSUES item; trigger remains "block #35 OR five-blocks-of-uniform-shape." S14 didn't touch this; correctly so.
- **The test suite still doesn't cover the wsl-build-wrapper.sh script directly.** S14-3 changed how the wrapper is invoked (no flag from BoardTop) and S14-5 changed BoardTop's elaboration shape, but both rely on pytest catching regressions through the existing `test_icebreaker_full_pipeline_against_example`. A direct wrapper test (mocking OSS CAD Suite environment with a fake `python3` shim) would catch the v0.1.0-alpha bug class earlier. Not done in S14; flagged for a future sprint.
- **`SAVE_VERSION` bump didn't happen.** The audit's logic-block port-naming asymmetry (AND/OR/XOR `in-1`/`in-2` vs NOT `gate-in`) requires a save-format-breaking change. Deliberately deferred to KNOWN-ISSUES; bundle with the next save-format-breaking change. S14 explicitly didn't touch this.

### What we'd do differently

- **The audit reports were great inputs.** Both `/design:design-system` and `/engineering:system-design` produced specific, file-and-line-cited findings. Future audits should feed sprints directly the same way — write the SPRINT-N.md plan from the audit output, then execute.
- **TSX file-by-file Reads are slow.** S14-6 (aria-label backport) would've been faster as a single batched read of all 24 files via a script, then 24 Edit calls. The "Read first or Edit fails" guard makes batched edits across many files chatty.

### Sprint 14 outcome

The two band-aid seams the audit named (`require_audio_output` flag; `has_vga` branch with mixed-graph silent downgrade) are gone. Block-library a11y is at parity. The 8-files-per-block tech-debt and the multi-domain clock plumbing remain explicitly deferred with documented triggers. Capability surface is unchanged — alpha.3 stays the live release.
