# Phase 5 — Reliable reusable circuit blocks

Status: active again (2026-09-23). Phase 4 is complete; this phase is not yet verified complete.

## Scope and order

1. Validate persisted block structure and report hierarchy-specific failures.
2. Preserve and validate typed external ports and input/output contracts across reuse.
3. Add explicit, validated parameter overrides using existing typed values.
4. Connect hierarchy context, analysis support, and honest timing/power coverage to inspection.
5. Make reusable test cases survive block reuse, with versioned serialization and reload validation.
6. Verify targeted tests, typecheck, scoped lint, the full suite, build, and interactive workflows.

## Findings from the current code

- `blocks.ts` already defines domain, role, direction, and unit on ports; blocks flatten to real parts.
- `block-inspector.tsx` edits names, drive kind, placement, and simulation fidelity, but not the full typed contract.
- `block-viewer.tsx` already supports descent; extend its context rather than create a second hierarchy viewer.
- `circuit-file.ts` validates the outer file version and top-level node shape but does not inspect nested canvas blocks.
- `user-part-validate.ts` has a separate internal-circuit sanitizer that strips port contract metadata. Its documented terminal-catalog limitation must not be mistaken for successful semantic validation.
- Phase 4 supplies saved tests, isolated execution, stable probes, and explicit unsupported results; reuse these rather than invent a second test engine.

## Design boundaries

Borrow explicit contracts and reusable subgraphs from the game audits, not game physics. No queue abstraction replaces circuit equations. Missing measurements or unsupported models must never appear as passing analysis or zero power. Keep valid legacy block files readable. Avoid importing renderer components into the main-process file parser.

## Research

- TypeScript runtime narrowing: https://www.typescriptlang.org/docs/handbook/2/narrowing.html
- Vitest assertions: https://main.vitest.dev/api/expect
- JSON Schema enumerated values: https://json-schema.org/understanding-json-schema/reference/enum

## Verification record

The previous 5,828-test gate belongs to Phase 4, not these changes.

### Pause checkpoint — 2026-09-19

- Added `src/renderer/block-validation.ts`: import-pure structural checks with hierarchy-specific errors for malformed blocks, duplicate identities, dangling internal wires/ports, invalid port enums and enable references, and a 64-level recursion guard.
- Integrated these checks into `deserializeCircuit` for saved canvas blocks. This is structural validation, NOT full primitive-terminal, parameter, or cross-domain semantic validation.
- Added 11 regression cases in `tests/block-validation.test.ts`.
- Corrected the existing nested-block round-trip fixture: it previously connected to a nonexistent nested port. The negative case is now tested explicitly.
- Passed 71 targeted tests across block validation, circuit-file persistence, blocks, and simulation-test persistence. Typecheck and scoped lint passed before the final small enum-check tightening (which replaces coercion with an explicit string check). Rerun both on resume for that last edit.
- Started the full suite with two workers, then intentionally stopped it on the user's pause request. No full-suite result is claimed. Log: `%TEMP%/chipblocks-phase5-tests.log`. Build has not run for Phase 5.
- No commit or branch created. Existing uncommitted Phase 3/4 work and unrelated scratch files were preserved.

### Resume here

1. Recheck typecheck, scoped lint and the targeted tests after the final enum-check edit; check compatibility against built-in/legacy block structures.
2. Finish the structural-validation boundary (remaining optional fields, primitive-terminal semantic checks, and consistent handling of reusable user-part internals).
3. Fix contract loss: `user-part-draft.ts` `coreBlockData` drops typed port metadata, and `user-part-validate.ts` `cleanBlockCore` also strips it. Extend the writer, runtime validator, and `schemas/user-part.schema.json` together, with round-trip and behavioral tests. Existing tests intentionally assert power-kind stripping; revise only when the new contract semantics are established.
4. Continue the remaining numbered scope: parameter overrides, hierarchy inspection, honest per-block analysis summaries, reusable tests and versioning. These are NOT implemented by this checkpoint.
5. Run final gates sequentially: typecheck/scoped lint, full tests with two workers, then build; verify the interactive workflows. Do not claim Phase 5 complete until its entire scope is covered.

Other inspected foundations: `block-viewer.tsx` already has breadcrumb descent; `network-overview.ts` has measured power/timing coverage; `pipeline/partition.ts` already routes reusable internal-circuit parts through logic compatibility checks. Reuse them. No queue-based replacement for physics.

### Resumed progress — 2026-09-23

- Rechecked the worktree and guidance. The prior turn made concrete progress (structural validation and regression evidence); no changes were assumed complete from memory.
- Rechecked the initial 71 targeted tests: passed. Fixed the outstanding formatter issue in the final enum guard.
- Reusable-part saving now copies kind, drive, domain, direction, role, unit, and tri-state enable contracts, including nested blocks. Reload validates these fields and refuses dangling enable references. Unknown legacy contracts remain absent rather than receiving invented defaults.
- Updated the strict JSON schema and runtime sanitizer together; added agreement and deep-copy round-trip tests.
- The live app contention check now attaches reusable internal circuits before inspecting their drivers, using the existing cached resolver. Regression tests compare original and saved/reloaded blocks for push-pull, open-collector, and tri-state behavior.
- Those regressions exposed an additional real reload failure: built-in transistor material parameters are named strings, while the reusable internal-circuit loader accepted only scalar quantities. Internal parameters now retain named string values alongside finite scalar quantities; the outer custom-part parameter contract remains unchanged. No physics values were substituted or dropped to make the tests pass.
- Latest targeted run: 128 tests passed across user-part schema, internal-circuit, and fidelity tests. Earlier targeted run: 151 passed before the new behavior regressions; those new regressions initially failed and exposed the reload issue above, which was then fixed and retested.
- The diagnostic full suite started before the last reload fix completed: 406 files passed, 2 failed; 5,849 tests passed and 4 failed. All four failures were the new reload regressions subsequently fixed and included in the passing 128-test targeted run. This mixed-edit run is NOT a final gate. Log: `%TEMP%/chipblocks-phase5-resume-tests.log`; session 90159 is terminal.
- Latest typecheck/scoped-lint command: terminal session 75660 completed successfully; typecheck and all 11 scoped files pass. Build and interactive checks remain pending.
- The fresh stable-tree full suite completed successfully: session 5539, **408 files / 5,853 tests passed**, 297.50 seconds. Log: `%TEMP%/chipblocks-phase5-contracts-tests.log`. This verifies the contract-persistence changes before the editor work below.

Next: finish validation and contract editing/domain semantics; then implement parameter overrides, per-block analysis summaries, reusable test portability and versioning. Preserve the original scope. Rerun a full final gate after the implementation stops changing. No commit made.

### Contract editor and diagnostic integration — 2026-09-23

- Added labeled domain, direction, role, and unit controls to the existing block inspector. Fields can be declared or cleared; an undeclared drive is no longer displayed as if the user selected input.
- Port patches preserve internal connections and use the existing undoable App callback. Contradictory drive/direction and non-tri-state enable declarations show explicit warnings. These declarations do not add domain conversion or solver support.
- Removing an enable pin clears references to that deleted pin, leaving tri-state enable status unknown rather than dangling or falsely enabled.
- Net inspection now attaches reusable circuits before inspecting contracts, as contention checking already does. Explicit source/load/passive roles appear in endpoint classification. A save/reload/instance-attachment regression proves electrical-to-thermal mismatches remain diagnosable.
- Added `block-contracts.ts` and six tests covering edits, clearing, immutable updates, persistence, visible labeled controls, and enable-pin removal. Latest targeted gate: **23 tests passed** across contract editing, net inspection, and reusable-part fidelity. Typecheck passed before the final enable-removal helper; a fresh sequential typecheck/lint/full-suite/build gate was launched afterward.
- React controlled-select behavior checked against https://react.dev/reference/react-dom/components/select . SSR is component evidence only; interactive browser verification remains required before Phase 5 completion.

Remaining: end-to-end analysis refusal for invalid contracts (warnings alone are not certification), full internal terminal/parameter validation, parameter overrides, hierarchy/analysis summaries, portable reusable tests, versioning, and final interactive verification. The full Phase 5 objective remains active.

Editor verification completed: terminal session **79276** exited successfully. Typecheck and scoped lint passed; **409 files / 5,860 tests passed** in 404.23 seconds; production build passed (21 main, 2 preload, 1,736 renderer modules). Log: `%TEMP%/chipblocks-phase5-editor-tests.log`. Prior sessions 5539 and 80701 are also complete.

### Per-instance internal parameter overrides — 2026-09-23

- Added `block-parameters.ts` and `block-parameters.tsx`, mounted in Properties for canvas blocks AND reusable internal-circuit parts using the existing internal resolver.
- Users navigate internal hierarchy by node id, see the selected instance and parent path, and apply finite scalar overrides in the parameter's declared unit. Named-material, topology-changing terminal-count, and solver-derived values are intentionally not edited through this scalar control.
- The update copies only the selected ancestor path; the reusable library definition and other instances remain unchanged. The existing project serialization carries the overridden block snapshot. This is a per-instance snapshot, not a live-linked update to the library.
- Applying a value explicitly selects transistor fidelity, as stated in the UI, so physical parameter changes are not silently hidden by a fast logic approximation. Undo uses the existing checkpoint mechanism.
- Missing scalar entries offered from the actual catalog defaults are labeled as defaults NOT yet set on that part. A fixture correction confirmed the shipped resistor default is 470 ohms; tests use explicit 100-ohm source values where that is the intended circuit.
- Validation rejects nonfinite values, unit mismatches, missing paths/parameters, structural/derived keys, and the same negative magnitudes rejected by the existing `paramMin` part-inspector rule. It does not claim exhaustive device-model physical-limit validation.
- Eight new tests cover immutable nested editing, flattening, malformed input refusal, independent instances, file round-trip plus actual canvas hydration/rerun, and component markup. The real DC test measures about 45 mA through the overridden 200-ohm copy and 90 mA through the unchanged 100-ohm copy on an ideal 9 V supply, before and after reload.
- Research: https://react.dev/learn/updating-objects-in-state . Existing parameter defaults, scalar editor limits, flattening, library resolution and hydration code were inspected before implementation.
- Latest targeted validation: terminal session **74087** completed successfully: typecheck and **44 tests across 3 files pass**. A preceding typecheck caught missing result narrowing in the new hydration test; that test was fixed and the gate rerun.

Next: obtain the latest verification result, run full tests/build for the override changes, then finish contract/terminal validation and explicit blocked analysis paths, per-block support/timing/power summaries, portable tests and versioned block serialization. Interactive verification and the requirement-by-requirement completion audit still remain. No commit made; Phase 5 stays active.

Override verification completed: terminal session **78501** exited successfully. **410 files / 5,868 tests passed** in 354.01 seconds, followed by a successful production build (21 main, 2 preload, 1,738 renderer modules). Log: `%TEMP%/chipblocks-phase5-overrides-tests.log`. Session 74087 is also terminal.

### Versioned blocks and portable digital regressions — 2026-09-23

- Added the import-pure `block-persistence.ts`: version 1 block writing, legacy unversioned reading, refusal to downgrade unsupported future block versions, a bounded hierarchy walk, and strict saved digital-test shape validation. Trace and persistence share the same 256-cycle limit.
- Canvas-block serialization and referenced reusable-part internals now write versions recursively. The runtime loader and JSON schema accept version 1 and legacy blocks; unsupported future canvas blocks return a path-specific error. Invalid reusable definitions are rejected by the existing user-part validator (the project loader's existing malformed-user-part filtering behavior is unchanged).
- Saved digital test definitions now survive save-as-part, nested reuse, project save/reload, and attachment to a new instance id. Cached success/report fields are not written as test definitions. Execution still rechecks the current signals, bit widths, complete waveform coverage and settlement through the existing Phase 4 runner.
- The test bench and trace picker now resolve reusable-part internals, not just explicit canvas block data. Saving a trace test on a reusable instance creates a local block snapshot rather than changing the library.
- The test bench subscribes to the existing stable user-part store. Test input signatures include the referenced library definitions, so changing a used definition or its saved expectations invalidates an old report rather than leaving a stale pass looking current.
- These portable tests are digital regression cases, not independent analog-physics validation. Existing project-level electrical tests remain available; no analog fixture format is invented here.
- Added 16 persistence regressions plus a schema/runtime agreement case. An initial 180-test targeted gate passed; a later legacy round-trip assertion required updating to include the newly written version marker. Latest validation session **48054** completed successfully: typecheck and **39 tests across 5 files** passed, covering persistence, freshness, bench and main-process imports.
- Sources: https://json-schema.org/understanding-json-schema/reference/const ; https://json-schema.org/understanding-json-schema/reference/array ; https://react.dev/reference/react/useSyncExternalStore . Main-process parser imports remain free of runtime renderer dependencies.

Remaining Phase 5 work: finish internal/contract semantic validation and explicit analysis refusal where invalid or unsupported; implement honest per-block analysis support and timing/power summaries; verify hierarchy/override/test UI interactions; then rerun final gates and audit every requirement. No commit made. Goal remains active.

Live verification: terminal session **88640**. All 16 scoped lint files passed; full tests write `%TEMP%/chipblocks-phase5-portable-tests.log`, then build runs only on success. Poll this existing handle on continuation; keep code unchanged until it finishes. Session 48054 is terminal.

### Paused at user request — 2026-09-23

- Phase 5 is incomplete. No implementation edits were made after starting the portable-test full verification gate. Session 88640 was still running when checked at this pause; its full-test/build result is not yet verified. The already-started verification may finish while the goal is paused.
- Last completed full verification: 410 files / 5,868 tests and production build passed for parameter overrides. Latest portable-test changes have passing typecheck, 39 targeted tests and 16-file scoped lint, but still need the running full-gate result.
- Next resume action: inspect session 88640 and `%TEMP%/chipblocks-phase5-portable-tests.log`; do not restart a live gate or claim an unobserved pass.
- Next implementation: honest per-block analysis status and measured power/timing summaries. Research inspected `network-overview.ts`, `part-readings.ts`, `static-timing.ts` and App state. Reuse measured coverage, distinguish absent data from zero, never label absolute-power sums as signed consumption, exclude stale/failed readings, and avoid double-counting nested blocks. Inspect App timing calculation and flattened-id membership before coding.
- Then finish primitive-terminal/contract semantic validation and explicit blocked/unsupported analysis paths, interactive hierarchy/override/test verification, final sequential gates and the requirement-by-requirement documentation audit.
- All existing changes remain uncommitted and preserved. No new goal work should start until the user resumes.

### Resumed: block analysis reporting — 2026-09-23

- The user resumed with “do it.” Prior verification session 88640 completed successfully: 411 files / 5,885 tests and production build (22 main, 2 preload, 1,739 renderer modules). That session is terminal.
- Added `block-analysis.ts` and its Properties-panel component. Exact recursively enumerated leaf identities select power readings; parent aggregates and similarly prefixed unrelated instances are excluded. Ambiguous flattened identities and conflicting port contracts suppress the report.
- A solve-input signature covers serialized circuit inputs, referenced reusable definitions, route geometry and ambient temperature. Stale/missing solves, unsupported/failed status and unsettled electrical/thermal/relay results suppress numeric summaries. The component subscribes to library changes. No additional solver or physics model was introduced.
- Power reporting shows finite-reading coverage and explicitly labels the sum as magnitudes, not net consumption or an energy balance. Zero is retained only when actually measured. Fast logic with no power readings displays unavailable rather than zero.
- Timing reporting filters existing paths by exact hierarchy membership, excludes crossing paths, rejects nonfinite/inconsistent delay ranges and never invents Fmax. The current top-level path tracer does not characterize arbitrary internal hierarchy: this is explicitly labeled incomplete coverage, not a completed timing-support implementation. App timing now resolves reusable internals before tracing.
- Added 13 reporting regressions. Typecheck and 37 targeted tests passed. Scoped Biome passed for all four touched code/test files after removing non-null assertions from test fixtures.
- Browser verification used an isolated Edge session and a disposable Logic gates project: selected AND showed 0/6 power readings under fast logic; turning off Always on and editing a drive produced a stale warning; input direction with push-pull drive produced a conflict in both report and inspector, still suppressed after Solve. Corrected the contract, navigated AND / inv_tpl_AND / nmos_tpl_AND, changed threshold from 2.1 V to 2.2 V, applied and solved: full physical-fidelity reading coverage was 6/6 and magnitude sum 0.0041458 W. This number is observed output, not an independent physics benchmark.
- Created and ran an AND both-low digital check using the Boolean truth-table reference: expected 0, actual 0, PASS. The default viewport had an existing panel-overlap obstruction at Save check; resizing to 1920×1080 exposed the control. Keep this UI issue open; do not report all layouts verified. Browser console had a missing favicon and existing React Flow getNodesBounds warnings, no observed application crash. Screenshot: `%TEMP%/chipblocks-phase5-analysis.png`. The test browser and own development server were closed.
- Latest stable-tree gate, session 20379, completed successfully: **412 files / 5,898 tests**, 330.20 seconds, followed by production build (22 main, 2 preload, 1,741 renderer modules). Log: `%TEMP%/chipblocks-phase5-analysis-tests.log`. Typecheck, scoped lint and `git diff --check` passed. No verification process remains live.
- Research: https://react.dev/learn/you-might-not-need-an-effect ; https://vite.dev/guide/api-javascript.html#createserver . Existing networkDeviceSummary, partReadings, flattenBlocks and traceTimingPaths were inspected before implementation; no new physical equations were assumed.

Next: finish primitive-terminal and contract/domain semantic validation with consistent blocked/unsupported execution paths; extend per-block internal timing/support beyond the existing top-level tracer without fabricating coverage; address the observed test-panel overlap; complete portable reuse/reload interactive checks and the final requirement audit. Phase 5 remains incomplete. All changes are uncommitted; preserve prior phases and unrelated scratch files.

### Terminal-aware test validation and contained test-panel layout — 2026-09-23

- Previous goal turn was progress: block reports, measured gates and browser evidence changed the worktree and the next action. This continuation inspected the current files before changing them.
- Added `block-semantics.ts`, using the same known terminal definitions and configurable source terminals as the editor, but refusing to treat generic fallback drawing pins as validated device terminals. Checks cover both ends of internal wires, exposed primitive terminals, nested paths, contradictory drive/direction/enable declarations, and unsupported thermal/magnetic/mechanical port connections in this electrical block model.
- Applied these checks before electrical test-world lowering and before digital test execution; invalid inputs produce an explicit preparation error or failed test finding rather than passing signals. Block reports use the same checks. This is not yet a complete live-dispatch refusal implementation, nor exhaustive parameter/unit validation; those remain required.
- Seven regressions include **every entry in BUILTIN_BLOCKS**, all of which pass the new semantic checks, plus bad primitive terminals, nested bad wire ends, unknown definitions, configurable source taps, unsupported domains and digital contract refusal. Prior 56 targeted tests passed; the new semantic and test-bench run passed 9 tests. Typecheck and 9-file scoped lint passed before the full gate started.
- Diagnosed the test panel sizing against its actual containing canvas: viewport-relative max-width plus content-box padding could exceed the available parent space. Changed max-width to parent-relative sizing with border-box, and gave its forms scoped grid layout with shrinkable inputs. No global dock stacking rules were changed.
- Browser verification on the real renderer: at **1280×720**, saved and ran an AND both-low test through ordinary clicks, yielding PASS; the panel bounds stayed inside its parent and scrollWidth equaled clientWidth. At **800×600**, panel clientWidth and scrollWidth were both 538 pixels, left edge 244 versus parent left 228, confirming no horizontal spill. Screenshot: `%TEMP%/chipblocks-phase5-layout-1280.png`. Own browser and dev server are closed. Existing React Flow warnings and favicon 404 remain unrelated.
- Layout research: https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Positioned_layout/Stacking_context . Local dock-grid and test-panel source were inspected before the localized sizing change.
- Full stable-tree verification is running in **session 17896**, confirmed live after browser verification. Log: `%TEMP%/chipblocks-phase5-semantics-tests.log`; build follows only if tests pass. Poll this exact session rather than restarting, and keep code unchanged until the result is known.

Next implementation after that gate: consistent live DC/transient refusal for semantically invalid blocks (without confusing partial unsupported-element solves with a refusal), parameter/unit and cross-port domain checks, and internal timing/support coverage. Final portable reuse/reload browser checks and requirement audit still remain. No commit; Phase 5 is not complete.

### Live refusal and typed-connection checks — 2026-09-23

- Previous turn was progress plus a verified wait. Session 17896 completed successfully: **413 files / 5,905 tests**, 492.26 seconds, and production build (22 main, 2 preload, 1,742 renderer modules). The old session is terminal.
- Live DC and transient dispatch now validate raw block structure before resolving internals, then validate resolved block semantics before selecting any engine. Refusal uses the new `invalid-circuit` status, distinct from a partial `unsupported-element` solve. Runtime analysis is blocked, the headline says Not simulated, DC did-run is false, DC refusal is true, and transient did-run is false.
- Refusal produces no readings, terminal voltages, samples or simulation iterations. It clears previously derived wire readings/arrows while preserving user connection/routing metadata and sequential input state. Block health names the reason. Tests verify immutability and no simulated values for both live dispatch paths, including malformed structure and logic fidelity.
- Structural load validation now checks finite rotation and internal parameter value shapes: finite scalars with nonempty units, or string values. Empty annotation text remains valid. Semantic validation compares declared scalar units/types against actual device defaults; it does not invent conversions or claim exhaustive physical-range/optional-parameter validation.
- Shared connected-net checks reject contradictory declared units/domains across multiple wire hops, including junctions, and reject an exposed nested port that contradicts its inner contract. Unknown/undeclared units are not invented. External wires referencing nonexistent block pins and colliding flattened identities now refuse live execution too. The electrical test-world path uses the same connection checks.
- A new configurable-source test initially used `dimensionless`; the actual default declares `count`. Corrected the fixture to the verified canonical unit and reran; no engine value was changed to accommodate it.
- Verification: typecheck passed. An 89-test run covered semantics, structural validation, portability, reusable internal solving, overrides and digital/electrical tests. Latest post-identity-change targeted run passed **43 tests / 4 files**; all built-in blocks also pass the expanded semantics checks. Ten-file scoped Biome and `git diff --check` pass.
- New stable-tree full tests/build are running in **session 39490**; log `%TEMP%/chipblocks-phase5-live-validation-tests.log`. Poll this exact handle, and do not change implementation while it runs. No browser or preview server remains from the earlier UI check.

Remaining: internal per-block timing/support coverage (current summary still consumes top-level paths); browser confirmation of new live-refusal UI plus portable reuse/save/reload; final scope audit and full gates. These are not waived by targeted passes. No commit; Phase 5 remains incomplete.

### Internal timing estimates — 2026-09-23

- Previous turn was implementation progress. Polled the exact live verification handle without restarting: session 39490 completed successfully, **413 files / 5,913 tests**, 377.05 seconds, then production build (22 main, 2 preload, 1,742 renderer modules). The session is terminal.
- Inspected the existing timing tracer and found that uncharacterized hierarchical gates could contribute zero delay. `gateDelay` now returns unavailable/infinite delay when resistance or load cannot be characterized, and traversal no longer defaults a missing gate delay to zero. Explicit port directions/drives now take precedence over legacy output-name heuristics. Existing timing tests remain passing.
- Added `block-timing.ts` and a mounted internal-timing inspector beneath the selected block's analysis report. It expands nested combinational compositions into actual gate objects while keeping clocked blocks as register boundaries. Reports carry full instance-qualified gate/register identities, individual reference-load estimates, actual internal register-to-register combinational paths, coverage/refusal reasons and assumptions.
- The UI starts with blank supply/load/wire inputs and unchecked external-port unloading. It requires explicit positive common supply/reference input capacitance, nonnegative per-output wire capacitance, and confirmation that external ports are unloaded. Changing the block or assumptions hides the old numbers behind a STALE message. This is a deliberately configured first-order estimate, not a live transient result, certified timing sign-off or maximum clock rate.
- Gate reference estimates use one stated reference load plus wire capacitance; path delays instead use actual internal fanout capacitances and the declared fallback for uncharacterized receiving register inputs. These different quantities are not summed interchangeably. Register clock-to-Q/setup/hold/skew, external loading, asynchronous feedback and clock-domain behavior are explicitly excluded. Unsupported primitives, missing transistor data, insufficient overdrive or partial capacitance data are not treated as ideal gates.
- Bounded analysis: at most 2,048 flattened gate/register objects and 10,000 traversal visits; exceeding a bound yields an explicit refusal, not a truncated path set presented as complete.
- Added 13 tests, including a nested two-inverter pipeline checked against independently evaluated ln(2)RC with explicit test parameters (25 ohm equivalent resistance and known gate/load capacitances), immutable input preservation, nonstandard typed register port names, missing data/underdrive, incomplete capacitance, unsupported analog blocks, required assumptions and traversal refusal. A test-only optional-property type mismatch was corrected without weakening types. Latest session 72919 completed: **typecheck and 56 tests across 4 files pass**. Five-file scoped lint and prior diff whitespace checks pass. No full suite/build has run on this newest increment yet.
- References: https://courses.cs.umbc.edu/graduate/CMPE640/Fall12/cpatel2/lectures/lect12_inverter.pdf (first-order CMOS RC model); https://react.dev/reference/react-dom/components/input (controlled assumptions form). Existing characterization code and its physical limits were inspected before reuse.

Next: verify the timing form and stale/refusal states in the browser; verify the live invalid-circuit display and saved reusable-part/test reload workflow; perform the original-scope completion audit and final full/type/lint/build gates. No processes from this turn remain running. No commit; Phase 5 remains incomplete until those checks and any resulting fixes are complete.

### Personal-library compatibility checkpoint — 2026-09-23

- Original Phase 5 scope was re-read from the supplied full plan. The final audit found that the personal-library envelope remained version 3, whose older reader strips newly added block metadata before rewriting the entire library. The existing updateUserLibrary path refuses unreadable envelope versions, so a version bump is required to protect new data from old builds.
- Library writes now use version 4; versions 1–3 remain readable. Internal blocks are recursively versioned using the existing shared serializer, which refuses unsupported future block versions instead of downgrading them. No native user library was edited during testing.
- Added migration and rewrite regressions for typed contracts, saved tests, immutable source data and future-version save refusal. The first test fixture mistakenly used scalar-unit spelling V for a port, whose actual enum is volt; corrected the fixture to the verified port type. All 37 library/portable-block tests, typecheck, two-file scoped lint and whitespace checks now pass.
- Research: the existing library versioning contract, older-reader sanitization and App read-modify-write guard were inspected; JSON Schema object-property behavior was checked at https://json-schema.org/understanding-json-schema/reference/object . Schema validation is not assumed to perform migrations.
- Full sequential test/build verification is running in terminal session **41755**. Log: `%TEMP%/chipblocks-phase5-library-v4-tests.log`. Poll this handle without restarting; do not change implementation while the gate runs.
- Browser session `phase5-final` is open on the preview at http://127.0.0.1:5187/; own Vite server is terminal session **72336**. Browser-open session 2877 has completed. New timing/refusal controls and portable reuse/reload still need interactive checks. Native persistence uses the Electron bridge, absent in this web preview; do not equate a browser-only check with native disk persistence.

Phase 5 remains active and incomplete. Next: observe the full gate, finish interactive checks and audit the remaining load/version boundaries before declaring completion. Preserve all uncommitted work from prior phases.

### Chip-timing honesty and Trace containment - 2026-09-28

- Root cause of Session 41755 `tests/chip-timing.test.ts` failure (`maxFrequency` got 0): IEEE/JS `1/Infinity === 0`. When a critical path or flip-flop timing used an uncharacterized infinite delay, `setupCheck` / `analyzeTiming` could report a measured **0 Hz** ceiling instead of refusing. Hierarchical CPU descent already flattens past composite gates to MOSFET leaves + D flip-flops (`isChipTimingLeaf`) so characterized paths get real finite RC delays; that alone is not enough if register/path timing is infinite.
- Fix (honest, not fabricated): `setupCheck` only emits `1/T_min` when `T_min` is finite and positive; otherwise max frequency is unbounded/`Infinity` (UI shows "-") and never 0. `analyzeTiming` treats non-finite/negative register `clockToQ`/`setup`/`hold` or critical `logicDelayMax` as `blocked` with an `uncharacterized-delay` diagnostic. No positive frequency is invented.
- Trace panel overlap at smaller windows: replaced fixed `width: 640` / prior `100vw` sizing with `width: min(640px, calc(100% - 32px))` + parent-relative `maxWidth`, removed a duplicate `minWidth: 130` that defeated flex shrink, and added `.cb-trace-panel` containment helpers. Simulation test bench got the same `min()` width hardening.
- Targeted timing gates: chip-timing, static-timing (including the new 0 Hz regression), timing-graph, and block-timing all pass.
- Scope audit of prior Phase 5 work: typed ports/contracts, overrides, hierarchy analysis, versioned block + library v4 serialization, semantic refusal paths, and portable tests remain in tree. Remaining non-code gap: interactive browser confirmation of Trace containment, timing/refusal UI, and native portable reuse/reload (Electron bridge) — cannot be certified from this headless turn alone.

Final sequential gate (2026-09-28): typecheck PASS; scoped Biome on touched files PASS; full suite **414 files / 5,931 tests** PASS (`npm test -- --maxWorkers=2`, ~372 s); production build PASS (22 main / 2 preload / 1,744 renderer). Log: `%TEMP%/chipblocks-phase5-final-gates.log`.

Phase 5 implementation scope for typed contracts, overrides, hierarchy/analysis/timing honesty, portable tests, and versioned serialization is in tree and gated. Still open for Mike: interactive Trace containment at a narrow window, timing/refusal UI smoke, and native portable reuse/reload (Electron bridge). No commit made; prior Phase 3–5 WIP preserved.
