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

## Accessibility — 23 findings against WCAG 2.1 AA (2026-05-08 audit)

Full audit at [ACCESSIBILITY-AUDIT-2026-05-08.md](ACCESSIBILITY-AUDIT-2026-05-08.md). The four critical-tier items here are flagged as standalone entries because they're individually actionable and worth tracking; the rest of the 23 are tracked inside the audit doc and the ROADMAP a11y workstream.

### Critical-tier findings (block real users; ship in S11 P0)

- **P2 — Block parameter inputs have no programmatic labels.** ADSR's "A/D/S/R" abbreviations, oscillator frequency, lowpass cutoff, etc. are visual-only. Screen readers announce "440, spinbutton" with no context. Fix: `aria-label` on each `<input>` across the 10 block-node TSX files. ~14 inputs total.
- **R3+R4 — Modals lack `role="dialog"` + `aria-modal` + focus management.** All three modals (Settings, About, AI confirm-preview) are missing the basic dialog semantics. SettingsModal has Escape-close but the others don't. Fix: ~30 lines per modal.
- **O8 — No visible focus indicator on most focusable elements.** `App.css` has `:focus` on inputs but not on buttons / palette items / dropdown items. Browser default focus rings on the dark theme are weak/invisible. Fix: single global `*:focus-visible { outline: 2px solid #6ec1ff; outline-offset: 2px; }` rule.
- **U1+U5 — Status messages don't announce to AT.** "Synthesizing…", "Bitstream ready (4.7 KB)", new chat-streaming messages aren't in `aria-live` regions. Long async work finishes silently for screen-reader users. Fix: `role="status" aria-live="polite"` on `.toolbar-status` + `aria-live="polite"` on `.chat-messages`.

### Color-contrast finding (single failure)

- **P1 — Palette footer "Drag onto canvas" text** at `#666 on #141414` ≈ 3.6:1, fails AA's 4.5:1 normal-text threshold. Fix: bump to `#888` for ~4.7:1, or upgrade to large/bold to qualify under the 3:1 large-text rule. One-line CSS edit.

**Action**: address Critical-tier in Sprint 11 P0 (~1.5 hrs total; bundled into one commit). Major / Minor items tracked in ROADMAP.md a11y workstream and the audit doc.

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
