# Sprint Plan: Sprint 14 — Architectural hygiene + a11y backport

> **Solo dev + Claude Code** · Drafted 2026-05-09 · Successor to [SPRINT-13.md](SPRINT-13.md) · Operational source: in-conversation `/design:design-system` audit + `/engineering:system-design` review (2026-05-09)

**Status:** **PLANNED, NOT OPEN.** This file captures the next-sprint shape so Sprint 13's velocity carries forward; the user has not yet committed to opening the sprint. Per the v0.1.0-alpha.3 launch posture, the user-action launch gates (announcement posts, Hackaday submission) take priority — Sprint 14 starts whenever those land or whenever external-user signal calls for it.

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

> *Filled in as the sprint runs. Empty until opened.*

---

## Retrospective

> *Filled in at sprint close.*
