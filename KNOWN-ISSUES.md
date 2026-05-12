# Known Issues

Tracked issues that haven't been fixed yet, with rationale for why they're deferred. Each entry has an owner action; when one of these is fixed, delete its entry rather than crossing it out.

## NPM advisories — five remaining (post-S9 dev-only growth)

| Direct dep | Current | Audit-suggested fix | Bump type | Why deferred |
|---|---|---|---|---|
| `electron` | `^38.0.0` | `electron@42+` | major | Advisories are around offscreen child windows, offscreen shared-texture release, clipboard image parsing, and named-window opener scoping. None of these surfaces are reached by ChipBlocks (no offscreen rendering, no clipboard reads, no `window.open` usage). |
| `vite` (transitive `esbuild`) | `^5.4.11` | `vite@8` | major | The esbuild dev-server CORS issue only affects an attacker who can reach the dev server. Vite binds `127.0.0.1:7777` (per `package.json#debug.env.VITE_DEV_SERVER_URL`); not reachable from outside the dev machine. |
| `jsdom` (transitive `whatwg-encoding`) | `^26.1.0` | (no fixed version yet) | — | Test-only dependency; the deprecated transitive doesn't ship in the runtime artifact. Re-check on the next jsdom release. |

**Action**: bundle into a future "deps refresh" sprint. Lower priority than user-facing work.

## vitest 4 + Vite 6 upgrade deferred

Sprint 7 took vitest 2→3 but stopped before vitest 4 because vitest 4 hard-requires Vite ≥ 6, and Vite 5→6 has its own breaking-change surface (`vite-plugin-electron` compatibility, the new `Environment API`, dropped Node-18 support).

**Action**: bundle vitest 3→4 + Vite 5→6 into a single dedicated upgrade sprint. The Sprint 9 IPC contract tests are now the first real renderer tests, so the upgrade has a forcing function — there's actual coverage to keep green.

## Electron-builder transitively pulls `7zip-bin` (LGPL-2.1)

Documented in [CREDITS.md](CREDITS.md). `7zip-bin` is build-time only — not present in the distributed runtime — so the LGPL terms don't apply to ChipBlocks' shipped binary. If `electron-builder` ever changes that, we'd need to revisit.

**Action**: monitor on every electron-builder major upgrade.

## Accessibility — Major / Minor findings against WCAG 2.1 AA

The four Critical-tier findings (P2 input labels, R3+R4 modal dialog semantics, O8 focus-visible, U1+U5 aria-live) and the P1 palette-footer contrast fix all shipped in Sprint 11 / Sprint 12. Tier 2 polish (palette keyboard nav, touch targets, popover arrows, parameter-error announcements) shipped in Sprint 12. The remaining ~14 Major / Minor items live in the audit doc and the ROADMAP a11y workstream.

Full audit + tiered remediation plan: [ACCESSIBILITY-AUDIT-2026-05-08.md](ACCESSIBILITY-AUDIT-2026-05-08.md) and [ROADMAP.md](ROADMAP.md).

**Action**: pick up incrementally as user-facing UI lands. None block launch.

## Block-manifest auto-discovery — **RESOLVED in Sprint 21**

Tech-debt item A1, originally surfaced in the `/engineering:system-design` review of 2026-05-09 (commits `5be6d05` + `4ec6e8b` + `be0aeca`). Three sprint retros in a row (S18 / S19 / S20) flagged the trigger condition; the deferred response landed in Sprint 21 per [ADR-003](ADR-003-block-manifest.md).

**Outcome**: `blocks.yaml` at the repo root is now the single source of truth for cross-cutting block metadata. Two codegen scripts (Node + Python) emit seven generated sections delimited by `@begin codegen` / `@end codegen` markers; CI's `codegen-drift` job catches hand-edits. Per-block hand-edited surface dropped from 9 files (the "8-file cookbook" plus the AI prompt) to 3 files (1 manifest row + 1 `.tsx` + 1 `.py`).

**See**: [ADR-003-block-manifest.md](ADR-003-block-manifest.md) for the design and [SPRINT-21.md](SPRINT-21.md) for the implementation log + retro.

## Multi-domain clock plumbing for mixed audio + visual graphs

Source: same `/engineering:system-design` review (2026-05-09). Surfaced when the 3 visual blocks landed alongside the 19 audio blocks.

`BoardTop.elaborate` (build.py around lines 402–475) has a top-level `if has_vga:` branch. The audio path inserts `EnableInserter(sample_tick)` around the inner `GraphTop`; the visual path runs the inner at full clock rate. Same inner graph, two different clock-rate behaviors decided by which sibling block exists.

A user graph that contains BOTH an `Output` block (audio at 44.1 kHz) AND a `VgaTiming` block (pixel clock at 12 MHz) has no coherent answer in the current shape. v0.1.0-alpha.3 tacitly disallows this: build.py's `has_vga` purely-graph-content detection downgrades the audio path silently. Sprint 14 P0 #3 makes that rejection **explicit** to close the silent-miselaboration window — but doesn't actually solve mixed-domain.

**Action**: proper fix is `m.d.audio` and `m.d.pixel` `ClockDomain`s in `BoardTop`, with a per-block `domain: str = "audio"` attribute. Audio subgraph runs in `m.d.audio` (gated by `EnableInserter(sample_tick)`); pixel subgraph runs in `m.d.pixel`. Cross-domain edges are explicit and synthesizable via Amaranth's `FFSynchronizer`. **Phase-3 deliverable** (per [ROADMAP.md](ROADMAP.md)) — 1+ sprint of investment for zero v0.1 user payoff. Trigger: first user actually asks to combine audio + visual on one chip.

## Logic-block input port naming asymmetric with NOT

Source: in-conversation `/design:design-system` audit (2026-05-09) on the 27-block library.

AND, OR, XOR use `in-1`/`in-2` for their two 1-bit inputs and `gate-out` for the output. NOT uses `gate-in`/`gate-out`. The asymmetry — three gates that take "in-1/in-2 → gate-out" alongside one gate that takes "gate-in → gate-out" — creates a small mental tax for users routing logic-only patches.

**Why deferred**: handle ids appear in saved graph JSON edges (`{ source: 'and1', sourceHandle: 'gate-out', target: 'mixer1', targetHandle: 'in-1' }`). Renaming `in-1` / `in-2` on AND/OR/XOR to `gate-1` / `gate-2` (or any alternative) would break every saved graph that uses logic blocks. That requires a `SAVE_VERSION` bump + a migration in `loadGraph` to rewrite old handle ids to new ones. Cosmetic improvement, save-format-breaking change — not worth it in v0.1.

**Action**: bundle into the next save-format-breaking change (when there's another reason to bump `SAVE_VERSION`). Until then leave the asymmetry. Note in BLOCKS.md if confusion shows up in user reports.

## Counter outputs `audio-out` despite being a logic block

Source: same `/design:design-system` audit (2026-05-09).

The Counter block lives in the "Logic" palette category (alongside AND/OR/XOR/NOT) but exposes `audio-out` (8-bit signed) rather than `gate-out` (1-bit). This is **deliberate** — Counter outputs a multi-step value (the count, mapped onto 8-bit signed via the `count - 64` centring trick) — so a 1-bit gate-shaped output would lose the information. The block needs a wide output to be useful. The choice is documented in [BLOCKS.md](BLOCKS.md) on the Counter entry.

**Why noted here anyway**: when the next agent or external contributor adds a counter-like block, they may copy the pattern (1-bit-domain block with audio-shaped output) without thinking. Worth flagging so the convention is "logic blocks default to 1-bit; widen to audio-out only when the block carries multi-step state."

**Action**: no fix needed. Watch for accidental wider use of the pattern.

## Optional-peripheral abstraction (FPGABoard.vga_pins) deferred until peripheral #2

Source: same `/engineering:system-design` review (2026-05-09).

`FPGABoard` (build.py around line 93) is a frozen dataclass with three currently-optional fields: `vga_pins`, `vga_pcf_template`, `vga_flash_md_section`. Today only iCEBreaker has them set. `build_fpga` conditionally appends the VGA template when `vga_pcf_template is not None`. Works for one optional peripheral.

Adding a 2nd optional peripheral (audio jack PMOD, OLED PMOD, MIDI in, encoder PMOD) means another set of three fields plus another conditional append. At 4–5 peripherals, the dataclass is a lump.

**Why deferred**: pre-abstraction at peripheral #1 is overengineering. The shape that's likely right (`peripherals: list[Peripheral]` where each `Peripheral` carries its own pin-map + pcf-template + flash-md-section + presence-detector lambda) earns its keep at peripheral #2.

**Action**: when peripheral #2 ships, refactor in the same commit that adds it. Until then leave the inline `vga_*` fields.

## Random-jitter for AI-placed nodes is a heuristic, not a layout engine

`canvasActions.addNode` places new nodes to the right of the existing rightmost node with a small vertical jitter. For complex multi-block AI sessions, blocks tile to the right and the user has to drag for cleanup. A real auto-layout (e.g. ELK or dagre) would compute an actual graph layout.

**Action**: future-sprint upgrade. Low priority while the AI consultant is producing typical 1–4-node additions.

## Unsigned Windows / macOS / Linux installers trigger OS-level warnings

The v0.1.x alpha installers are unsigned (no code-signing certificate was used at build time). On first run:
- **Windows**: SmartScreen warns "Windows protected your PC"; user clicks "More info → Run anyway."
- **macOS**: Gatekeeper warns "ChipBlocks cannot be opened because Apple cannot check it for malicious software"; user right-clicks → Open → Open.
- **Linux** (AppImage): no warning — Linux trusts what the user runs.

**Action**: acquire a Windows EV/OV code-signing certificate ($150–$500/yr) and an Apple Developer ID ($99/yr), then set `CSC_LINK`/`CSC_KEY_PASSWORD` GitHub Actions secrets. The release.yml workflow already tolerates the absence (`CSC_IDENTITY_AUTO_DISCOVERY: false`); adding signing later is a configuration change, not a workflow rewrite. Deferred until there's any external user demand for it.

## Pure-combinational graphs raise an unhelpful error in synth.py

`Simulator.add_clock` requires at least one `m.d.sync` domain in the design. Graphs containing only combinational blocks (e.g. just a Constant → Output, or Constant → Multiply → Output) raise `Domain 'sync' is not present in simulation` — confusing for a non-technical user.

**Action**: synth.py should detect this case and inject a no-op synchronous primitive (or short-circuit with a friendlier error like "Your graph has no clocked elements; add a Gate or any waveform source to produce audio.") Surfaced as a wart by the Sprint 9 backend pytest work.

## Backend simulation duration is integer-second-only

`synth.synthesize(graph, duration_s: int)` constructs `range(SAMPLE_RATE * duration_s)` so sub-second renders aren't possible without code change. Tests use 1-second renders for speed, but a `duration_samples` kwarg would let tests render even shorter clips and shave the pytest runtime (currently ~54 s for 19 tests).

**Action**: small follow-up; one keyword arg + a default. Low priority.

## P1 carryforward — cached audio in save format (DROPPED)

After 6 sprints of deferral, formally dropped in Sprint 9 ROADMAP. Workaround: ship a `.wav` alongside the `.json` when sharing graphs, since saved files don't carry rendered audio. Re-promote if a user actually asks for it.
