# Sprint Plan: Sprint 12 — Major-tier polish + first real test coverage + ARCHITECTURE.md

> **Solo dev + Claude Code** · Date: 2026-05-08 · Successor to [SPRINT-11.md](SPRINT-11.md) · Operational source: [ROADMAP.md](ROADMAP.md) "Now" bucket + [ACCESSIBILITY-AUDIT-2026-05-08.md](ACCESSIBILITY-AUDIT-2026-05-08.md) Tier 2/3

**Dates:** 2026-05-08 (continuing) — into 2026-05-09. Single focused session, six commits across two days.
**Team:** Solo (you + Claude Code as your dev pair)
**Sprint Goal:** *Close out the WCAG 2.1 AA Major + Minor findings, ship the first real renderer test coverage, eliminate the last two structural smells from the tech-debt audit (BUNDLE_FILENAMES coordination + the `bash -c` shell surface in runBuild), and write the ARCHITECTURE.md that the project should have had since Sprint 5. After this sprint, the audit doc is substantively closed and the renderer has 50+ tests instead of 6.*

---

## Why now

Sprint 11 closed every Critical-tier audit finding. That left Tier 2 (Major) and Tier 3 (Minor) — the substantive UX gaps and the polish items, not the screen-reader-blockers. Tier 2 is real work: the palette is mouse-only, touch targets are too small for icon-only buttons, popovers can't be navigated with arrow keys, parameter inputs silently swallow out-of-range values. Tier 3 is mostly mechanical: block titles should be `<h3>`s, the Settings input should submit on Enter, etc.

In parallel, two other long-standing items were due:
- **Test coverage.** The renderer test suite has 6 IPC contract tests. That's not zero, but it's not real coverage either — block components have no rendering tests, save/load has no roundtrip tests, the examples-consistency invariant (TS module ↔ JSON files) has no enforcement. Bumping toward ~50 tests is the right level of investment for an alpha headed for external use.
- **Two structural smells from the tech-debt audit.** `BUNDLE_FILENAMES` in `ipc.ts` duplicates backend knowledge (will silently break if backend changes the bundle filename). `runBuild` uses `bash -c "<innerCmd>"` with shell-quoting on interpolated paths — correct today, fragile for any future change.
- **ARCHITECTURE.md.** Repeatedly deferred since Sprint 5. The project now has 14 blocks, 3 build targets, an AI consultant with a per-turn agentic loop, and zero "how is the code shaped" reference for a future external contributor (or me-six-months-from-now).

---

## Working Assumptions

| Assumption | Default | Change if... |
|---|---|---|
| Sprint length | **single session** spilling across midnight from May 8 → May 9 | More items surface mid-flight |
| Availability | one focused session | n/a |
| Stack | unchanged from S11 | n/a |
| Audit scope | Tier 2 (Major) + Tier 3 (Minor) — substantively closes the audit | n/a |
| Test target | 6 → ~50 tests on the renderer side | Stretch to integration tests if time |
| Tracking | Git commits + this `SPRINT-12.md` log | Want issues |

---

## Sprint Goal — concrete target

After Sprint 12:

1. **All Tier 2 (Major) audit findings closed**: O1 (palette keyboard), O7 (44×44 touch targets where practical), O6 (popover arrow-key nav), U3 (parameter error messaging), P1 (palette footer contrast).
2. **All Tier 3 (Minor) audit findings closed**: P4 (block titles as h3), P5 (block group roles), U4 (starter hint announces), U2 (Settings submits on Enter), O2 (document RF keyboard shortcuts in About modal), R7 (aria-describedby on confirm-preview).
3. **Frontend test count goes from 6 to 50** via T1 (33 block-component tests across all 15 blocks), T3 (4 save/load roundtrip tests), C3 partial (7 examples-consistency tests).
4. **C2 closed**: `BUNDLE_FILENAMES` map dropped; backend emits `[bundle] <basename>` stdout marker; IPC parser scans for it. Backend is sole source of truth for the bundle filename.
5. **M1 closed**: `runBuild` rewritten to argv-only spawn through a `wsl-build-wrapper.sh` shipped via electron-builder `extraResources`. Drop the `bash -c` shell-string surface entirely.
6. **ARCHITECTURE.md** lives at the repo root and is indexed from CLAUDE.md.
7. **No regressions**: tsc clean, pytest 19/19, vitest 50/50.

What we are NOT shipping in Sprint 12:
- **prefers-reduced-motion / high-contrast mode / popover landmark roles** — out of scope for the alpha; revisit before any v0.2 cut.
- **Block library expansion** — no new blocks. Pure polish + coverage sprint.
- **AI agentic-loop integration tests (T2)** — too coupled to live API state to be worth automating for the alpha.
- **Block manifest refactor (A1)** — 8-files-per-block growing pains aren't bad enough yet to earn the fix.
- **The S9 launch carryforwards** — still pending user action.

---

## Capacity (solo)

| Person | Available | Allocation | Notes |
|---|---|---|---|
| You + Claude Code | one session, two days | n/a | Six commits across the session. Multiple parallel agents on the test-coverage + a11y Tier-2 + bundle-marker work. |

---

## Sprint Backlog

| Pri | Item | Owner | Outcome |
|---|---|---|---|
| **P0** | **1. a11y Tier 2** — O1 (palette keyboard alternative, refactor `<div draggable>` to `<button draggable>` with onClick fallback); O7 (44×44 touch targets where practical, with documented compromise on tight toolbar emoji buttons at 32×32); O6 (popover ArrowDown/Up/Home/End nav per APG menu pattern, applied to Build + Examples popovers); U3 (`useValidatedNumber` hook — keep literal text, show inline error message, snap-back on blur); P1 (palette footer #666 → #888 for 4.7:1 contrast). | Agent | ✓ Done in commit `7a1e512`. tsc clean, vitest 6/6 still passing. |
| **P0** | **2. T1 + T3 + C3 partial test coverage** — 33 block-component tests across all 15 blocks (renders without errors in `ReactFlowProvider`, has the right title text, has expected port counts, parameter inputs respond to userEvent.type, out-of-range typed values keep literal value AND show role="alert" range message, blur snaps back); 4 save/load roundtrip tests (Save → intercept Blob → parse v1 envelope; Load roundtrip; Load rejection on unknown block type; Load rejection on non-primitive data); 7 examples-consistency tests (one per bundled example, asserts `.nodes` and `.edges` match between `examples/<id>.json` and `frontend/src/examples.ts`). | Agent | ✓ Done in commit `53a4754`. Test count 6 → 50, all passing in ~10 s. ZERO drift detected across the 7 examples — the previous worry about silent drift between two sources of truth is no longer hypothetical. |
| **P0** | **3. C2 bundle-filename coordination** — drop the static `BUNDLE_FILENAMES` map in `ipc.ts`; emit `[bundle] <basename>` from `backend/build.py` (FPGA targets after `make_bundle`, TT target after `build_tinytapeout`); `findBundleFilename(stdout)` parses the marker. Backend becomes sole source of truth. | Agent | ✓ Done in commit `e0b1677`. tsc clean, vitest 50/50 (the existing IPC mock tests don't exercise this path). |
| **P0** | **4. M1 argv-only runBuild** — new `backend/scripts/wsl-build-wrapper.sh` (sources `~/oss-cad-suite/environment` if present, then `exec python3 "$@"`); ship via electron-builder `extraResources`; rewrite `runBuild` to spawn `wsl.exe -d Ubuntu -- bash <wrapperPath> <wslScriptPath> --in <wslJsonPath> --out-dir <wslOutDir> --target <target>` with no shell. Drop the `shellQuote` helper. | Agent | ✓ Done in commit `8da0359`. Verified end-to-end: real `--target verilog` produced 4717-byte Verilog; `--target icestick` produced full pipeline with `[bundle]` marker on stdout. |
| **P0** | **5. a11y Tier 3 polish** — P4 (block titles `<div>` → `<h3>` across all 15 blocks, with App.css resetting margin/font-size); P5 (block outer `<div>` wrapped with `role="group" aria-labelledby` pointing at per-instance heading id); U4 (starter hint `role="note"` → `role="status"`); U2 (wrap Settings key input + Save in `<form onSubmit={save}>`, Clear-stored-key OUTSIDE the form); O2 (Keyboard shortcuts section in AboutModal documenting RF defaults — Tab / Backspace-Delete / Cmd-drag / Space-drag / mouse-wheel); R7 (aria-describedby on AI confirm-preview Apply / Reject buttons). | Agent | ✓ Done in commit `06053a5`. Audit doc is now substantively closed. |
| **P0** | **6. ARCHITECTURE.md** — high-level process model (Electron main / sandboxed renderer / WSL2 / backend), IPC contract surfaces, renderer architecture, 8-file block-addition cookbook, build-target system, AI consultant architecture, testing layout, license posture pointer, pointers to other living docs. Indexed from CLAUDE.md. | Agent | ✓ Done in commit `11e08d0`. Living doc with last-updated date in header; refreshed when data flow or process model changes materially. |
| **P0** | **7. Sprint retrospective** | You | ✓ Done (below). |

---

## Risks (resolved)

| Risk | Outcome |
|---|---|
| **Two parallel agents both modify `ipc.ts`** — one for the BUNDLE_FILENAMES coordination (C2), one for the M1 argv-only rewrite. Last-write-wins erases work. | Hit it in a softer form. The two changes touch different sections of the same file but the M1 rewrite removed the `shellQuote` import that C2's parser didn't need either. Manual integration step needed: 5-line merge to keep both changes' surface intact. Same lesson as S10's parallel-agent collision: when two agents must touch the same file, one owns the file, the other delivers a separate module + a documented integration patch. |
| **The `useValidatedNumber` hook can't be called inside `.map()`** for multi-row blocks (ADSR, Gate, FM) due to rules-of-hooks. | Recognized mid-implementation. Solution: extract per-row inline `FieldRow` components that call the hook at their own top-level. Architectural overhead is small (3 components, ~20 lines each); the alternative was duplicating the hook's state into the parent component, which would have exploded complexity. |
| **Block-component tests render outside React Flow's store registration**, so `updateNodeData` calls no-op — does that break the test contract? | Documented as an explicit choice in the test commit. The hook still updates its local `displayValue` state, which is what the tests assert. Tests verify the hook's local-state contract, not the round-trip through React Flow's state — which is an integration concern out of scope for unit tests. The agent flagged this so future readers understand the seam. |
| **jsdom 26's Blob/File don't support `.text()`/`.arrayBuffer()`** — Save/Load tests can't read the saved Blob. | Stub `globalThis.Blob` / `globalThis.File` with `node:buffer` implementations for the test duration. Self-contained workaround, restored after each test. |
| **The `[bundle] <basename>` stdout marker collides with normal log output** — what if the build pipeline coincidentally prints a line starting with `[bundle]`? | `findBundleFilename` scans for the LAST matching line; backend emits the marker as the final line of a successful build. If the backend ever fails to emit one, the IPC handler returns "backend contract violation" rather than guessing. |
| **The wsl-build-wrapper.sh isn't packaged correctly** — fails to find the wrapper at runtime. | Verified post-build: file present at `resources/backend/scripts/wsl-build-wrapper.sh`, 1007 bytes, mode 0755 preserved. extraResources configuration mirrored from the existing `backend/` extraResource entry. |
| **The OSS CAD Suite source-time error gets swallowed by the wrapper** the way it was swallowed in the old `bash -c "source ... 2>/dev/null"`. | The wrapper checks `[[ -f ... ]]` before sourcing; pipefail-safe. Behavior parity confirmed: both old and new forms run python3 without OSS CAD Suite on PATH if the suite is missing — yosys/nextpnr fail at the right point with clear errors, not silently. |

---

## Definition of Done (per item)
- [x] Code committed to git with a clear commit message
- [x] Demoable to yourself with one or two commands (or one click for installed-app items)
- [x] This `SPRINT-12.md` has a 1-paragraph entry in the Sprint Log
- [x] You understand at a high level what it does

---

## Sprint Log

### Item 1 — a11y Tier 2 (palette keyboard, touch targets, popover arrows, parameter errors)
**✓ Done — 2026-05-08.** Commit `7a1e512`. **O1** refactored palette items from `<div draggable>` to `<button draggable>` so they're natively focusable and Enter/Space-activatable. New `onAddBlock(type)` prop on `<Palette>` wires to `canvasActions.addNode` in App.tsx, which uses the existing rightmost-X placement heuristic. `aria-label="Add ${label} block"` on each. Footer text updated to "Drag or click to add" to reflect the new keyboard path. Drag-and-drop unchanged. **O7** applied 44×44 touch targets to `.chat-icon-btn`, `.palette-toggle`, `.starter-hint-close` (each in its own header with vertical breathing room). The toolbar emoji buttons (⚙, ℹ) got 32×32 instead — the toolbar is a tight horizontal row alongside text buttons, and applying 44px there pushed the toolbar from ~32px to ~60px and made icon buttons visually dominant. Pragmatic compromise documented in CSS as a deviation from WCAG 2.5.5 ideal. The collapsed palette widened from 28px → 48px to fit the 44×44 toggle without overflow. **O6** new `handleMenuKeyDown` helper implements the APG menu pattern — ArrowDown/Up cycle with wrap, Home/End jump to extremes, focus auto-lands on the first item when popover opens (via `requestAnimationFrame` so it runs after React commits the DOM). Applied to Build and Examples popovers. Refs stored as sparse arrays since React mounts items asynchronously; filter to non-null before computing focus target. **U3** new `useValidatedNumber` hook — keeps the user's literal text input even when out of range, shows red-border + `role="alert"` aria-live="polite" message with the valid range, snaps back to the last committed value on blur if invalid. Applied across all 10 number-input blocks via inline `FieldRow` components for the multi-row ones (ADSR/Gate/FM) — needed because rules-of-hooks forbid calling the hook inside `.map()`. Behavior change: typing "30000" in oscillator freq no longer feels frozen. **P1** palette footer #666 → #888 on #141414 takes contrast from 3.6:1 to 4.7:1, clearing the AA threshold. Closes the only contrast failure from the audit. tsc clean, vitest 6/6.

### Item 2 — Test coverage (T1 + T3 + C3 partial)
**✓ Done — 2026-05-08.** Commit `53a4754`. Frontend test suite goes from 6 → 50 tests, all passing in ~10 s. **T1** 33 block-component tests across all 15 blocks: each renders without errors in `ReactFlowProvider`, has the right title text, has the expected port/handle counts. Components with parameter inputs render the correct initial value and respond to `userEvent.type` with the typed value reflected in `input.value`. Out-of-range inputs (e.g. typing 30000 in Oscillator freq when max is 20000) keep the literal value AND show a `role="alert"` message with the valid range — verifying the new `useValidatedNumber` hook from `7a1e512`. Blur after invalid input snaps back to the last committed value. **T3** 4 save/load roundtrip tests: Save renders `<App>`, clicks Save, intercepts Blob, parses JSON, asserts the v1 envelope shape (`version: 1, app: 'ChipBlocks', viewport, nodes, edges`) with the starter Oscillator + Output graph. Load roundtrip fires programmatically with a known-good envelope matching one of the bundled examples; asserts canvas state. Two rejection tests — unknown block type triggers the m5 security check + error toast; non-primitive data field is rejected with the right error. **C3 partial** 7 examples-consistency tests, one per `frontend/src/examples.ts` entry. Asserts the matching `examples/<id>.json` exists at the repo root and that the `.nodes` and `.edges` arrays match byte-for-byte. JSON envelope fields (version, app, savedAt, viewport) deliberately excluded since the TS module doesn't carry them. ZERO drift across all 7 examples (two-osc-mix, adsr-pulse, kick-drum, snare-drum, bass-lead, lofi-pad, arpeggio) — the previous worry about silent drift is no longer hypothetical, now caught by CI. Two infrastructure workarounds the agent flagged inline in commit message: jsdom 26 Blob/File stub and the React Flow store-registration seam.

### Item 3 — C2 bundle-filename coordination via stdout marker
**✓ Done — 2026-05-08.** Commit `e0b1677`. Closes the tech-debt audit's C2: "BUNDLE_FILENAMES in ipc.ts duplicates backend filename knowledge. If backend changes the bundle filename, IPC handler reads from the wrong path." `backend/build.py` emits a machine-readable `[bundle] <basename>` line as the last line of any successful build (FPGA targets after `make_bundle`, TT target after `build_tinytapeout`). Single trivial format chosen so the IPC parser doesn't need a JSON dependency on the backend's logging shape. `frontend/electron/main/ipc.ts` dropped the static `BUNDLE_FILENAMES` map; replaced with `findBundleFilename(stdout)` that scans for the last `[bundle] <basename>` line. If the backend ever fails to emit one (e.g. a future target is added but doesn't print one), the IPC handler returns a clean "backend contract violation" error rather than guessing wrong. Backend is now the sole source of truth for what the bundle filename is. Adding a new target only requires changes in `build.py` + `electron-builder.json`'s extraResources (if the new module is needed at runtime); the IPC handler stays unchanged. tsc clean, vitest 50/50 (existing IPC mock tests don't exercise this code path).

### Item 4 — M1 argv-only runBuild
**✓ Done — 2026-05-09.** Commit `8da0359`. Closes the M1 defensive item from the 2026-05-08 security review: `runBuild` used `bash -c "<innerCmd>"` with `shellQuote` on interpolated paths — correct today (no renderer-controlled value lands in the inner cmd) but fragile against any future addition that interpolates a graph-derived value without going through `shellQuote`. New `backend/scripts/wsl-build-wrapper.sh` (mode 0755) sources `~/oss-cad-suite/environment` if present (needed for FPGA builds; TT path is sources-only and works without it), then `exec python3 "$@"`. `set -euo pipefail`; the `[[ -f ... ]]` guard is necessary because pipefail would otherwise kill the script on a missing env file. New `frontend/electron-builder.json` extraResources entry ships the wrapper at `resources/backend/scripts/wsl-build-wrapper.sh` (verified post-build: file present at 1007 bytes, mode 0755). Rewrote `runBuild` to spawn argv-only: `spawn('wsl.exe', ['-d', 'Ubuntu', '--', 'bash', wrapperPath, wslScriptPath, '--in', wslJsonPath, '--out-dir', wslOutDir, '--target', target])`. No more bash -c. Every argv element is its own slot; node's spawn without `shell: true` does NOT invoke a shell, so embedded shell metacharacters in any argument can't escape into a command. Removed the `shellQuote` helper — only used inside the old runBuild. Verified end-to-end: real build through the wrapper produced 4717-byte Verilog (`--target verilog`); `--target icestick` produced the full pipeline output (yosys netlist, nextpnr asc, icepack bin, bundle zip) with the `[bundle]` marker on stdout for the IPC handler to parse. Subtle behavior parity with the old form: the old `source ... 2>/dev/null; python3 ...` swallowed source errors. The new wrapper checks the env file exists first, then sources cleanly. Both end up running python3 without OSS CAD Suite on PATH if the suite is missing — yosys/nextpnr fail at the right point with clear errors. tsc clean, vitest 50/50.

### Item 5 — a11y Tier 3 polish
**✓ Done — 2026-05-09.** Commit `06053a5`. Closes the remaining Minor-tier audit items. **P4** all 15 block components: `<div className="block-title">` → `<h3 className="block-title">`. Screen-reader users can now nav between blocks via the heading-list shortcut (NVDA's H key, etc.). App.css resets `<h3>` margin to `0 0 4px 0` and font-size to `inherit` so visual layout is unchanged; existing `font-weight: bold` rule preserved. **P5** outer block `<div>` wrapped with `role="group" aria-labelledby` pointing at the heading. Per-instance id derived from React Flow's `id` prop (`block-${id}-title`) so multiple Oscillator instances on the same canvas don't collide. Mental SR trace: "Oscillator block, group, heading level 3 Oscillator, 440, spinbutton, Frequency in hertz" — reads as a coherent unit. **U4** starter hint banner `role="note"` → `role="status"` so it gets announced once when it appears; visual presentation unchanged. **U2** SettingsModal: wrapped New API key input + Save button in `<form onSubmit={...}>`. Enter while focused inside the input now submits. Clear-stored-key button is OUTSIDE the form (Enter shouldn't trigger Clear). **O2** AboutModal new "Keyboard shortcuts" section listing Tab / Backspace-Delete / Cmd-drag / Space-drag / mouse-wheel — closes the audit's documentation gap for users who don't know React Flow's defaults. **R7** Chat.tsx confirm-preview: `id` on the description paragraph + `aria-describedby` on Apply / Reject buttons. Screen-reader users hear the description as part of the button context. tsc clean, vitest 50/50. ACCESSIBILITY-AUDIT-2026-05-08.md is now substantively closed: all Critical (P2/R3/R4/O8/U1/U5) shipped in S11's `a5aab75`, all Major (O1/O7/O6/U3/P1/R1/R2/R5/R6) shipped in `7a1e512`, all Minor (P4/P5/U4/U2/O2/R7) shipped here. Remaining items (prefers-reduced-motion, high-contrast mode, popover landmark roles for SR navigation) are out-of-scope at the alpha stage or polish to revisit before any v0.2 cut.

### Item 6 — ARCHITECTURE.md
**✓ Done — 2026-05-09.** Commit `11e08d0`. Living doc, last-updated date in the header. Covers the territory that PRD/ROADMAP/sprint-logs don't: high-level process model (Electron main / sandboxed renderer / WSL2 / backend) with the actual file layout; IPC contract surfaces (synth/build/AI channels, the deliberate not-exposing of generic `ipcRenderer` for security); renderer architecture (App.tsx not-split-by-design, Chat.tsx as the agentic-loop owner); the 8-file block-addition cookbook (with a pointer to the future block-manifest refactor item in tech-debt); build-target system (`FPGABoard` profiles, the TT divergence into `tinytapeout.py`); AI consultant architecture (cache_control on the system prompt, agentic loop with `MAX_ITERATIONS` bound, eval-ai script); testing layout (27 pytest + 50 vitest, what runs in CI vs not); license posture pointer (CREDITS.md is the canonical doc; ARCHITECTURE.md just notes "permissive only, copyleft tools invoked-not-bundled"); pointers to all the other living docs for context-shopping. Indexed from CLAUDE.md. Useful for the first external contributor (whenever that happens) and for me-six-months-from-now when the working memory of why things are shaped this way fades. Refreshed when data flow or process model changes materially — not on every sprint.

### Item 7 — Sprint retrospective
**✓ Done — 2026-05-09.** Below.

---

## Retrospective

**What went well:**
- **Six commits across one session-with-sleep — every one shipped clean.** No reverts, no follow-up fix commits. The pattern (clear audit doc → mechanical edits → tsc + vitest as gate) is repeatable; this is roughly the third sprint where it's held.
- **Test count 6 → 50 in a single commit.** That's the biggest single jump in coverage the project has had. The shape of the new tests (block-component renders + parameter behavior + save/load roundtrip + examples consistency) covers the parts of the renderer that *would* silently regress — the rest of the renderer is integration territory that's harder to test without a live React Flow store anyway.
- **C3's examples-consistency check found nothing.** Was bracing for at least one drift between `examples/<id>.json` and `frontend/src/examples.ts` since the project ships seven examples and they were authored at different times. Zero drift. The test is now the forcing function that prevents the next drift.
- **The `useValidatedNumber` hook was the right level of abstraction.** Long-standing UX issue ("typing 30000 in oscillator freq feels frozen") closed with one shared hook + an inline `FieldRow` adaptation for the multi-row blocks. The same hook gave T1's tests something concrete to assert against — out-of-range typed values keep the literal value AND show role="alert" — which is what makes the tests load-bearing rather than trivial.
- **The argv-only `runBuild` rewrite was a clean win.** Removed the entire `shellQuote` helper. The new wrapper script is 8 lines. The IPC handler is shorter. End-to-end behavior verified against real builds, not just unit tests.
- **ARCHITECTURE.md** existed for ~6 months by the end of the session — finally. The 8-file block-addition cookbook is the part most likely to pay off when an external contributor lands; the rest (process model, IPC contract, AI loop) is for me-six-months-from-now reading old code I forgot the shape of.

**What didn't:**
- **Two parallel agents both modified `ipc.ts`** (one for the BUNDLE_FILENAMES coordination in C2, one for the M1 argv-only rewrite). Manual integration step needed. Same exact lesson as S10's parallel-agent collision on `build.py`. Two-data-points-now: when two agents must touch the same file, give one ownership of the file and have the other deliver a separate module + a documented integration patch the first agent applies. Going to apply this rule prospectively in S13+.
- **The block-component tests render outside React Flow's store registration** so `updateNodeData` calls no-op. The tests verify the hook's local-state contract, not the round-trip through React Flow. Documented in the commit message but worth saying out loud: this means a class of "input commits but doesn't persist" bugs would slip through the new tests. The right fix is integration tests with a real React Flow provider tree, but those are heavier than the alpha needs.
- **The `[bundle] <basename>` marker is a fragile contract** — not a typed protocol, just a string. If `build.py` ever logs something else starting with `[bundle]` (a "bundle in progress" message, say), the parser picks the wrong line. Mitigated by parsing the LAST matching line and emitting it only on success; a stronger fix is JSON-on-stdout, deferred until the contract grows beyond one field.
- **The toolbar emoji buttons (⚙, ℹ) are 32×32, not 44×44.** Documented in CSS as a deliberate WCAG 2.5.5 deviation. A future "all icon buttons promoted to 44×44 by reflowing the toolbar" pass would close this — out of scope for this sprint since reflowing the toolbar is its own design problem.
- **No fresh-install smoke test of the new behavior in the actually-installed app.** Same gap S11 flagged. The a11y polish + the argv-only `runBuild` rewrite + the bundle-marker change all change behavior the user sees; tsc + vitest only prove the renderer compiles + the unit-level contracts hold. Some classes of bug (packaged-app paths, OS-level focus behavior, real screen reader announcements) only appear when the installed app runs.

**What surprised me:**
- **The hook + FieldRow extraction for multi-row blocks** was less code than the parent-component-state alternative. Was prepared to deduplicate state into the parent (and complain about the rules-of-hooks); the FieldRow factor-out was 3 components and ~60 lines total, simpler than I expected.
- **The packaged `wsl-build-wrapper.sh` had its mode 0755 preserved through electron-builder's extraResources copy.** Was prepared to verify and patch with a postinstall step; turned out unnecessary on Windows (NTFS mode bits aren't really 0755 the way they are on Linux, but the script runs through `bash <wrapperPath>` not `<wrapperPath>` directly, so mode bits don't matter to launch).
- **The audit doc closed in two sprints.** S11 took Tier 1 + four Tier-2 ride-alongs; S12 took the rest of Tier 2 + all of Tier 3. Originally the plan was Tier 1 → S11, Tier 2 → S12, Tier 3 → "as time allows / Later." Tier 3 turned out to be ~1 hour of mechanical edits and slotting it in this sprint cost less than re-loading the audit doc into a future sprint. Worth noting for next-time-an-audit-lands estimation.

**What changes Sprint 13:**
- **Block library expansion.** Two new blocks fitting the v1 flagship audio/synth/retro-game domain. The natural picks are Bitcrusher (lo-fi crunch — 1-bit comparator at the extreme, gentle bit reduction in the middle) and Delay (slap-back, chorus building block, gateway to echo when combined with Multiply + Mixer). Both close common synth-chain gaps user-shared graphs would have wanted.
- **CONTRIBUTING.md.** Project's at ~50 commits past the original alpha-prep work and has a coherent ARCHITECTURE.md to point at. Time to have a "first-time external contributor reads in 5 minutes and knows what to do" guide.
- **Sprint 9 launch carryforwards** — STILL pending user action four sprints later. Tag, push, smoke-test, screenshots, S8 AI grounding manual eval, GitHub Discussions, announcement posts. The renderer and code shape are now ready; the only remaining gate is the user picking up the launch sequence.
- **More candidate work** if S13 closes early:
  - 2 more example graphs that exercise FM / Multiply / Wavetable
  - Auto-layout for AI-placed nodes (ELK or dagre)
  - vitest 4 + Vite 6 paired upgrade (now meaningful — actual coverage to keep green)
  - Iceberg / Upduino / HX8K-EVB as additional FPGA targets
  - Real-silicon test gate (if the user acquires a TinyFPGA BX or iCEstick)
