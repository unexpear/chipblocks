# ChipBlocks — Project Status

> Canonical implementation and verification snapshot. Last verified 2026-09-28.

This snapshot describes the current working tree, which already contained unrelated user
changes before this Phase 0 audit. It is the source of truth for measured gates and current
implementation status; the README, CLAUDE.md, PRD.md, and TOOLCHAIN-ROADMAP.md provide product
context and link here rather than carrying independent test-count claims.

## Verification gates

| Gate | Command | Result |
|---|---|---|
| Tests | npm test -- --maxWorkers=2 | PASS — 414 files / 5,931 tests (2026-09-28 Phase 5 timing/Trace gate; log `%TEMP%/chipblocks-phase5-final-gates.log`) |
| TypeScript | npm run typecheck | PASS |
| Production build | npm run build | PASS — 22 main, 2 preload, 1,744 renderer modules (after the 2026-09-28 test suite) |
| Biome | npm run lint | Previously recorded repository baseline: 60 errors and 2 warnings; Phase 5 scoped checks pass, not a claim of repository-wide cleanliness |

The passing test run includes non-fatal warnings emitted by existing UI and fixture tests. The
Biome failure is recorded as a baseline, not silently treated as clean; broad auto-formatting was
not run because the worktree contains unrelated changes.

## Phase 5 progress (incomplete)

Chip-timing 0 Hz footgun closed (2026-09-28): uncharacterized infinite delays no longer report `maxFrequency === 0`; hierarchical MOSFET-leaf descent reports a real finite Fmax when characterization succeeds. Trace overlay sizing uses parent-relative `min(640px, 100% - 32px)` containment; duplicate flex `minWidth` that blocked shrink was removed.

Reusable blocks now preserve typed contracts, expose contract and internal scalar-override editing,
validate saved structure, and retain versioned portable digital tests. The selected-block report
shows measured power coverage and the existing timing model's contained/cross-boundary path coverage.
Missing, stale, conflicting, failed, or unsettled results are not presented as valid power totals.
Power is explicitly a sum of available magnitudes, not signed net consumption or conservation proof.
Timing is not complete internal characterization; AC/transient support is not certified by this report.

September 23 verification includes 13 new reporting regressions, the complete test suite above,
typecheck, scoped lint, production build, and browser interactions for stale reports, conflicting
contracts, nested overrides, and a passing independently specified digital AND check. The browser
test initially found panel overlap at the smaller default viewport. The subsequent localized sizing
fix passed real-browser save/run checks at 1280×720 and containment checks at 800×600. Terminal-aware
validation now guards electrical test preparation, digital test execution and block reporting; all
built-in blocks pass its checks. That increment's full test/build gate passed. The subsequent live
DC/transient guard now returns a distinct invalid-circuit refusal, clears old measured values, and
checks known parameter units, declared cross-port contracts, external pins and flattened identity
collisions. Its full verification passed. A new internal-timing inspector expands nested combinational
gates, retains register boundaries, and requires explicit supply/load assumptions before producing
first-order RC estimates. Unknown models, inadequate bias, missing capacitance and exhausted traversal
budgets do not become zero-delay success. Its 56 targeted checks and typecheck pass; its full gate and
interactive checks remain pending, so the table describes the preceding completed run. Code/gates for timing honesty + Trace containment passed 2026-09-28. Remaining work: interactive Trace containment confirmation at narrow viewports, portable reuse/reload via native Electron persistence, and the final requirement audit. Parameter checks cover
finite typed values and units declared by device defaults, not exhaustive physical limits or every
optional model parameter. See PHASE-5-BLOCKS-PLAN.md for the checkpoint and measured scope.

## Physics truth pins

The physics authority is the implementation's equations, cited device data, standards, and
analytic/regression tests. The game audits are useful for editor UX, teaching, observability, and
debugging patterns only; they are not authorities for electrical behavior.

- Transformer transient core loss: the transient solver models core loss through the changing
  magnetic state, not as a fixed DC resistor. tests/transient-solver.test.ts pins both core loss
  draws nothing under steady DC and core loss draws real power under AC excitation.
- Perfect coupling: k = 1 is accepted consistently. The transient suite checks the turns ratio,
  while tests/ac-loss.test.ts checks the coupled-coil closed form and rejects only values outside
  the physical range.
- FET/JFET high-frequency behavior: declared MOSFET gate capacitance is stamped into the AC
  answer. tests/ac-coverage.test.ts checks the expected capacitive reactance and that it is not
  reported as ignored loss.

## Current implementation checkpoints

- The in-app symbol editor is mounted through the user-part editor
  (src/renderer/App.tsx and src/renderer/user-part-editor.tsx).
- The footprint editor and board workspace are mounted; broader PCB/fabrication parity remains
  explicitly tracked in TOOLCHAIN-ROADMAP.md.
- The in-app transient solver is implemented; optional ngspice integration remains a future
  higher-fidelity path, as stated in PRD.md.
- The eight game audit documents are retained as design-reference findings, with no claim that
  reverse-engineered or observed game behavior is physically authoritative.
- In-app AI is not implemented and is not a shipped feature. No provider SDK, no API-key storage,
  no AI settings, no model call. Circuit explanations are the deterministic Why system
  (src/runtime-why.ts). The app never asks for an API key. BYOK multi-provider and selectable
  No-AI are deferred until an explicit product decision. Do not add a stub chat. Hosted or
  project-paid inference stays out of scope.

## Phase 0 outcome

The baseline is established, stale test counts are reconciled to 5,719, current app/editor claims
are documented, and the identified transformer, coupling, and AC gate-capacitance risks have
regression coverage. The remaining lint failure is a separate cleanup task and is not hidden by
this phase.

## Phase 1 outcome

The shared runtime contract in src/runtime-contracts.ts now defines stable block, net, terminal,
endpoint, subgraph, diagnostic, and event IDs; typed domains, units, port directions, terminal
roles, analysis states, runtime quantities, diagnostics, repair hints, and causal chains. Block
ports normalize into that contract, solver results carry shared analysis projections, timing reports
emit targeted repair diagnostics, and causal replay attaches trace/timeline events to source,
terminal, net, device-state, and diagnostic links. Net inspection exposes a typed runtime net with
canonical identity, endpoint roles, readings, state, and repair diagnostics. Focused coverage passes
in tests/runtime-contracts.test.ts, tests/net-inspector.test.ts, tests/causal-replay.test.ts, and
tests/static-timing.test.ts.

## Phase 2 outcome

The unified Why system in src/runtime-why.ts and src/runtime-contracts.ts now combines net
inspection, causal replay, run traces, timelines, scope and meter readings, timing reports,
solver warnings, and device-health diagnostics. Explanations preserve the causal path from
source through terminal, net, device state, and output or diagnostic; they identify the first
blocked hop, incompatible connection, missing driver or required input, contention sources,
unsupported-device location, overload, thermal, timing, solver, and measurement causes, and
offer select, connect, or inspect repair actions. Shared state transitions cover ready, active,
waiting, blocked, failed, and complete, and the Why panel is mounted in the relevant inspector,
replay, trace, timeline, scope, and timing views. Focused Phase 2 coverage passes in
tests/runtime-why.test.ts and the affected solver, inspector, replay, timing, meter, and health
suites; final repository gates are recorded above after completion.

## Phase 3 outcome

The Properties panel now shows a searchable Network overview when no device or wire is selected.
It lists wired nets using endpoint labels, source/output and input counts, passive and unknown
counts, recorded endpoint voltage ranges and coverage, maximum recorded wire current, and
per-device power and temperature readings. Missing measurements remain unavailable. Device
connection groups include isolated canvas objects; their membership is structural, not proof
of conduction or electrical support. Design-wide timing uses the existing timing report.

Users can select a group's devices, a net's wires, individual devices, or a wire-only path from
a source/output endpoint. Net and path traversal never joins two terminals through a device
body. Net, group, device, and terminal lists use 50-item pages. Regression tests cover
disconnected terminals, loops, isolated objects, deterministic ordering, partial measurements,
and panel rendering in tests/network-overview.test.ts.

Net and device-group names are now editable annotations, stored on member wires and devices
in optional version-1 circuit-file fields. Names normalize whitespace, discard malformed values,
and have a 120-character limit. Equal names never create an electrical connection. Merged nets
display distinct member names until the user reconciles them; split membership retains its
annotations. Save/load regression tests cover these fields and preserve existing connectivity.

Groups report recorded device power magnitudes, maximum temperature, minimum thermal
headroom, and measurement coverage, counting each device once. Power magnitudes explicitly
include both source delivery and device absorption: their sum is NOT net consumption or an
energy balance. The overview reports structural topology and existing output-contention
warnings without claiming an electrical safety verdict. Wire-current coverage and recorded
canvas-solve provenance are explicit; static timing is separate from live measurements.

Interactive renderer preview verified with the voltage-divider starter: group rename, net
rename, named-net search, and source-to-terminal wire selection opening the correct inspector.
The supply net showed 10 V, 500 µA, and full endpoint/current coverage; unavailable source
temperature stayed unavailable. This was a browser-hosted renderer, NOT a native Electron
save/reopen test. A final renderer check also verified that a renamed supply net survives an
explicit Solve with its 10 V and 500 µA readings unchanged. Final gates are recorded above.
Changed TypeScript/test files pass targeted Biome; repository-wide Biome remains
at the pre-existing 60 errors and 2 warnings.

Group summaries now include recorded endpoint voltage ranges, maximum wire-current magnitude,
coverage counts, and maximum finite static combinational delay from traced register paths
fully contained in that group. Cross-group timing paths are excluded, not attributed to an
arbitrary member. Recorded route length is summed with coverage; it is not a source-to-load
distance. Undeclared active-device pins remain unknown rather than being called passive;
authored pin input/output/power/passive declarations contribute to role counts.

A 20,000-wire chain reproduced a recursive union-find stack overflow. An iterative root lookup
with path compression fixes it without changing union/root selection. The algorithm was
cross-checked against [Princeton's union-find reference](https://algs4.cs.princeton.edu/15uf/WeightedQuickUnionPathCompressionUF.java.html).
The regression checks net membership, structural groups, and a full wire path. A 1,000-terminal
rendering test checks bounded markup and paging controls. Browser interaction with the actual
overview component and 102 synthetic nets verified pages 1–50, 51–100, 101–102, the disabled
last-page Next button, and searching from the last page back to a matching first-page net.
This component test does not claim a 20,000-device full-canvas performance benchmark.

Final persistence checks now write a temporary circuit to disk, reopen it through deserialization,
run the actual App circuit-to-canvas hydration function, and save it again with identical names
and connectivity. This validates the changed save/load code without claiming a native-dialog test.
The integration review found that analog, logic, and mixed dispatch rebuilt wire data without
net names. All three paths now preserve normalized names; tests require successful solves and
identical terminal voltages with and without annotations. The four integration tests pass.

The overview's 16 focused tests now include authored input/output/power/passive/unknown roles,
contention mapping, and invalid timing coverage. A group maximum delay remains unavailable
if any included path has a negative or non-finite delay, with valid/total path counts displayed.
Priority is explicitly not assigned to electrical nets. Reachability currently means explicit
wire connectivity only, not propagation through a device or proof of conduction.

Phase 3 is complete against the Full Plan's network-inspection scope. The final acceptance audit
maps its requirements to the implementation and evidence:

| Requirement | Implementation and verification |
|---|---|
| Named net/subgraph summaries | Editable net and structural device-group annotations; merge/split, normalization, disk roundtrip, real App hydration, and all three solve dispatches covered |
| Driver/load/passive counts and topology | Declared endpoint roles, explicit unknowns, source-connected/no-source status, and existing contention findings; authored-pin and contention regressions |
| Electrical, power, timing, thermal summaries | Recorded readings and static timing with coverage and unavailable states; partial/non-finite data and unique-device aggregation tests |
| Connectivity and reachability | Explicit-wire net membership and wire paths; structural device groups separately labeled; disconnected, cyclic, isolated, and 20,000-wire cases |
| Priority and routing metadata | No invented electrical scheduling priority; recorded route-length coverage and existing per-wire routing/material/resistance inspector |
| Large-design aggregate view | Search and 50-item pagination for nets, groups, devices, and terminals; bounded 1,000-terminal render and interactive 102-net paging check |
| Terminal/device drill-down and optional paths | Endpoint identity buttons select their owning device; group/device/net selection and source-to-endpoint wire selection reuse existing inspectors |

The concurrent default-worker test/build attempt exhausted system memory (six worker errors
and a failed build process); it is NOT counted as passing. The subsequent full suite passed
all 5,741 tests in 399 files with two workers, and the standalone production build passed.
No test coverage was removed. Typecheck, targeted Biome on all 11 changed TypeScript/test
files, and whitespace checks passed. Full-repository Biome still has the separately recorded
pre-existing 60 errors and 2 warnings. Native file dialogs were not newly exercised, and the
large-chain regression is not a full-canvas rendering benchmark.

## Phase 4 complete — 2026-09-19

Unified saved DC, AC, transient, thermal, conservation, and digital checks are mounted
in Tools → Tests and preflight. Existing block waveforms can be imported without
altering their originals. Expectations include tolerance/range, exact point/window,
stable terminal probes, independent/captured provenance, affected targets, and repairs.
Previews copy live inputs, include routed wires and cast light, and refuse incomplete
or unsupported results. Transient capacitor ESR/dissipation-factor omissions now produce
explicit non-passing reports. Physics equations are unchanged.

Verified actual renderer authoring/reruns, expected failures, legacy waveform import,
report navigation, stale detection, and undo. Five disk/hydration/rerun regressions
cover supported and unsupported cases; native dialog click-through is not claimed.
Final full tests, typecheck, production build, and all 23 scoped files pass. Repository
lint remains the unrelated 60-error/2-warning baseline. No commit was made.

See [SIMULATION-TESTS.md](SIMULATION-TESTS.md) for usage and precise model/sampling limits,
and [PHASE-4-TESTING-PLAN.md](PHASE-4-TESTING-PLAN.md) for requirement evidence and gates.
Phase 5 is next; it has not been started by this goal.

### Historical Phase 4 checkpoints

Phase 3 was reverified before proceeding: 75 focused network, persistence, circuit-file,
and contention tests passed, and typecheck passed. The full gate table above records
the Phase 3 completion checkpoint at that time; the gate table now records the final Phase 4 run.

At the first checkpoint, Phase 4 was active; its requirement checklist and implementation sequence are in
[PHASE-4-TESTING-PLAN.md](PHASE-4-TESTING-PLAN.md). The first fix closes reproduced
false-pass paths in saved digital tests: invalid/truncated cycle requests, invalid numeric
inputs, extra expected samples, incomplete traces, and unsettled cycles. Failure reasons
are displayed in the Trace inspector. The digital test and trace suites pass 20 tests;
scoped lint passes. Full-suite verification of this checkpoint is in progress. The
unified system is not yet integrated into the app.

The shared assertion/report model and result adapters now have 24 passing focused tests.
They cover real-engine DC/AC/transient/digital results, explicit tolerances, exact sample
coordinates, sampled timing/settling, signed power integration, KCL, missing data, and
provenance. The RC AC reference accounts for the existing 1 nS numerical ground shunt.
Isolated execution, preflight, unified saved-test authoring/report UI, and final end-to-end
verification remain pending; see the Phase 4 plan for the full unchanged acceptance scope.

The first Phase 4 full-suite run (digital validation changes) completed: 399 files /
5,751 tests passed. Newer shared assertion and isolated-run modules were added after
that run started and are covered separately by 34 focused tests, not by that full count.
DC, transient, and digital test runs now use independent copies; topology preflight
stops invalid connectivity before solving. Actual thermal-limit checks and live-state
preservation pass focused regression tests. AC copy execution, app integration,
persistence, and remaining acceptance checks are still pending.

Isolated AC execution and optional circuit-file test definitions are now implemented and
covered by focused regressions. AC testing reports skipped/unknown models, invalid bias,
ignored declared values, ideal-loss assumptions, and numerical shunts without changing
the existing solver equations. Zero amplitude is testable without fabricating its phase.
The seven affected AC/persistence suites passed 176 tests; the subsequent zero-gain case
passed in the 27-test runner/suite check. Canvas suite state, save/open/undo integration,
stable endpoint-based probes, authoring/report UI, and final full verification are still
pending. File-format tests alone do not establish end-to-end app persistence.
