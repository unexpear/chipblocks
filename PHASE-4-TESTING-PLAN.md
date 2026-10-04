# Phase 4 — Testing and preflight

Status: complete, verified 2026-09-19. Phase 3 was rechecked with 75 passing focused tests
and a passing typecheck before starting this phase. Phase 3 changes remain uncommitted.

## Findings and design constraints

- Saved digital tests already live on `BlockData.tests`, persist through circuit files,
  and run through `block-tests.ts` and the Trace inspector. Reuse this workflow.
- `runTrace` intentionally caps preview cycles at 256. A test must not silently accept
  that cap as proof of a longer requested run. It also exposes per-cycle settlement,
  which saved tests previously ignored.
- Canvas DC and transient adapters exist in `pipeline/solve-canvas.ts`; AC analysis
  exists in `ac-analysis.ts`. Do not build a second physics engine for test assertions.
- The Math view already reports per-net KCL residuals, including unavailable cases.
  Do not replace unavailable currents with zero or infer energy balance from summed
  unsigned device-power magnitudes.
- Structural connection groups do not prove conduction, support, or a valid reference.
  Preflight must distinguish these concepts and retain solver warnings.
- Current saved digital expectations are captured observations, not independent proof
  of correctness. Their provenance must remain explicit when manual/analytic expectations
  are introduced.

Measurement reference: the [ngspice measurement documentation](https://ngspice.sourceforge.io/docs/ngspice-manual.pdf)
distinguishes measurements at specified coordinates, bounded-window statistics, and
integration. Follow that separation, not implicit extrapolation or unreported sampling.
The [Vitest 4 CLI](https://v4.vitest.dev/guide/cli) documents worker limits; use two workers
for full verification to avoid the earlier concurrent test/build memory exhaustion.

## Delivery sequence

1. Make digital tests fail closed for invalid requests, incomplete traces, unsettled
   cycles, and mismatched expectation coverage. Preserve valid existing saved tests.
2. Define a shared assertion/report model with analysis domain, units, target IDs,
   expected/actual values, tolerances, exact sample coordinates, formulas, provenance,
   and actionable failure descriptions. Missing or invalid data cannot pass.
3. Add adapters to existing DC, AC, transient, thermal, digital, and conservation
   results. Pin comparisons and sampling rules with analytic regression fixtures.
4. Add topology/support preflight and isolated simulation-copy execution. Prove that
   nested device parameters, circuit blocks, wires, and live digital state are unchanged.
5. Integrate authoring, saved expectations, reproducible reruns, and report drill-down
   into the app. Keep native circuit-file compatibility and preserve all existing tests.
6. Verify interactive workflows, persistence, full tests, typecheck, build, and scoped
   lint; record repository-wide lint separately. Complete only after acceptance below.

## Acceptance checklist

### Requirement evidence audit (verified)

The original Phase 4 list in the supplied Full Plan was re-read; no requirement was
replaced by a narrower deliverable. The evidence below covers implementation and
verification. Final gates completed against the frozen implementation: 407 files /
5,828 tests, typecheck, all 23 scoped source/test files, and production build pass.
Repository lint remains the separately recorded baseline failure (60 errors, 2 warnings).

| Requirement | Current authoritative evidence |
| --- | --- |
| Digital expected waveforms | `block-tests`, `simulation-test-import`, runner tests; actual Trace capture/import/two-cycle reports verified |
| Analog tolerances and DC assertions | `simulation-assertions` tolerance/window tests; real RC/DC adapters; interactive divider pass/fail |
| AC gain/phase/frequency | Analytic RC complex response and wrapped phase tests; stable-probe tests; interactive lossy-capacitor gain |
| Transient timing/settling | Real RC exponential, threshold and settling tests; explicit endpoint/bracket/window rules |
| Energy/KCL/power/conservation | Signed terminal current/power adapters, missing-data refusal, independent RC supply/heat/storage integrals |
| Thermal limits | Real settled 25.1 C test and failing 25.05 C upper bound; incomplete/missing temperature refusal |
| Unsupported warnings | DC unsupported status, AC omissions/ignored values, transient capacitor-loss refusal; actual UI warnings verified |
| Topology preflight | Missing/ambiguous reference, reciprocal membership, orphan/duplicate terminals, source shorts, disconnected islands, actionable targets |
| Physics correction regressions | Existing `transient-solver.test.ts` core-loss DC/AC and k=1 tests; `ac-loss.test.ts` perfect coupling; `ac-coverage.test.ts` MOSFET gate-capacitance response |
| Isolated previews | Runner tests compare complete live worlds/blocks/maps; canvas tests compare nested inputs and routes before/after; live analog preparation parity |
| Useful reports | Expected/actual, requested/measured coordinates, targets, formulas, provenance, repairs; UI pass/fail/unavailable/stale/navigation verified |
| Reproducibility/persistence | Versioned validation, no cached PASS, terminal-stable probes, five real disk/hydration/rerun tests; undo restored saved definitions interactively |

Save/template and staged-open/cancel wiring was also inspected in `App.tsx`; native
Electron dialog click-through was not performed. Browser-hosted renderer interaction
and real filesystem hydration/rerun tests are the verification evidence, not a claim
of native dialog automation. The user-facing workflow and exact model/sampling limits
are documented in [SIMULATION-TESTS.md](SIMULATION-TESTS.md).

### Canvas-input and independent-energy checkpoint (2026-09-19)

Code inspection found that the new preview lowered the canvas without the live
light-casting pass or automatic wire routes. `simulationTestWorld` now copies nodes,
edges, and routes, then reuses the existing lowering and light-casting calculations.
The panel receives the same route map/toggle as the live DC path, and route changes
invalidate previous reports. Two regressions compare the prepared instances/nets with
the actual analog dispatch, verify 350 lux at the fixture sensor and the existing
0.9144 m wire-length cap, and prove preparation/preview leave nested canvas data and
route geometry unchanged. This establishes analog input parity, not mixed-signal
dispatch parity; the latter still needs separate treatment.

An independent RC energy regression now checks signed source energy, resistor heat,
and capacitor stored-energy change against closed-form exponential solutions and
`C*(Vfinal^2 - Vinitial^2)/2`, rather than merely accepting a zero summed-power residual.
It integrates the recorded window at a 2 us step and declares a 4 nJ discretization
allowance. Reference: [OpenStax capacitor energy](https://openstax.org/books/college-physics-2e/pages/19-7-energy-stored-in-capacitors).
Nine adapter/preparation tests pass; the separate pipeline/panel run passed five tests.
Scoped lint and typecheck pass. Final full-suite verification remains pending.

### Interactive integration checkpoint (2026-09-19)

The mounted Tests and preflight panel was exercised in the actual renderer on a new
voltage-divider starter. Saving and running a 10 V source expectation reported
9.999144034407509 V, within the explicitly entered 0.001 V tolerance. Changing the
expectation to 9 V failed with expected/actual values, coordinate, formula, reference,
and repair guidance. This is a workflow check, not an independent solver validation.

An interactive regression exposed a stale PASS after editing its saved expectation.
Reports now retain their test definition and become visibly STALE when that definition
changes or is removed; target selection is disabled until rerun. Verified edit → stale,
rerun → current PASS, remove → stale, and undo → saved definition restored. Existing
circuit-change invalidation is preserved. The quick authoring menu now offers power
only for transient analysis and temperature only for DC, matching available adapters.
React state behavior was checked against https://react.dev/learn/state-as-a-snapshot.

The persistence/probe integration checkpoint passed 70 tests in five files. Following
the interactive correction, 31 tests in three focused suites pass; typecheck and scoped
panel lint pass. Native file-dialog save/load, all analysis workflows, copy fidelity to
canvas routing/light inputs, and final full gates still require verification. This
checkpoint does not complete Phase 4.

- [x] Digital expected waveforms with complete-cycle validation and useful failure reports.
- [x] Analog waveform tolerances and DC operating-point assertions.
- [x] AC gain, phase, and frequency assertions.
- [x] Transient timing and settling assertions, with resolution/coverage disclosed.
- [x] Energy, KCL, signed power, and conservation checks with explicit model limitations.
- [x] Thermal-limit assertions.
- [x] Unsupported-model warnings and topology preflight.
- [x] Regression fixtures for each physics correction tracked in PROJECT-STATUS.md.
- [x] Simulation-copy previews demonstrably leave the live design unchanged.
- [x] Expected/actual, exact cycle/time/frequency, affected blocks/nets, formulas,
      input provenance, and repair guidance visible in reports.
- [x] Saved-test roundtrip and interactive integration verified.
- [x] Final verification gates and remaining limitations accurately documented.

The checkpoints below are chronological history; pending work described at an earlier
checkpoint was subsequently addressed as recorded above and in the final checkpoint.

## First implementation checkpoint

Eight new failing cases reproduced digital-test validation gaps before fixes. The runner
now rejects invalid/capped cycle requests, non-finite/fractional digital inputs, extra
expected samples, incomplete traces, and unsettled cycles. Capture refuses invalid or
unsettled runs. New failure reasons appear in the existing Trace inspector.

The focused digital test and run-trace suites pass: 20 tests in two files, including
injected incomplete/unsettled trace regressions and real-gate expectation comparisons.
The three changed files pass scoped Biome. This is only the first checkpoint, not
completion of the unified system. Full-suite verification is in progress.

## Shared assertion checkpoint

`src/simulation-assertions.ts` now defines typed expectations and reports, including
units, exact coordinates, affected runtime targets, input/expectation provenance,
measurement formulas, warnings, and repair guidance. It evaluates exact point samples,
bounded sampled extrema, directed threshold crossings, sampled settling in an explicit
absolute band, and signed power integration. Near comparisons use
`absolute + relative * abs(expected)`; phase uses the shortest angular difference.
Empty suites, duplicate IDs, incompatible units, incomplete/unsupported analyses,
missing samples, invalid tolerances, and non-finite data cannot pass.

Point samples and window endpoints must exist exactly in the recorded data. This is
intentional: they are not silently interpolated or extrapolated. Only threshold-crossing
measurements interpolate, reporting their bracket. Settling is certified only through
the observed window and needs samples after entry; it is not a prediction of future
stability. Energy uses the signed trapezoidal integral over recorded power, not unsigned
part readings. References: [NumPy's trapezoidal-rule documentation](https://numpy.org/doc/stable/reference/generated/numpy.trapezoid.html)
and [MathWorks response-characteristic definitions](https://www.mathworks.com/help/control/ref/dynamicsystem.stepinfo.html).
Our settling band is explicitly absolute, not MathWorks' default relative step-size band.

`src/renderer/simulation-test-results.ts` adapts existing DC, AC, digital, and transient
results. DC KCL reuses the existing Math view; missing thermal values remain unavailable.
Transient KCL and signed power use recorded terminal currents. Missing terminal data
invalidates the sum rather than dropping a device. AC support/warnings must be supplied
by the runner; the adapter itself is not a support detector.

Verification: 24 tests pass across the shared assertion and analysis-adapter suites.
The integration fixture runs the actual DC, AC, transient, and digital engines. It
checks the RC charging waveform, crossing and settling times, KCL, signed source/load
power, integrated power residual, and exact-frequency AC gain/phase. The AC analytic
reference includes the existing solver's documented 1 nS ground shunt; no physics was
changed to force an idealized expectation to pass. Synthetic tests cover missing data,
unsupported analyses, thermal nonconvergence, units, tolerance boundaries, and phase wrap.

Still required: isolated execution and preflight, saved unified test definitions,
authoring/report UI and drill-down, independently checked stored-energy conservation,
thermal solver integration, physics-correction regression mapping, and final gates.
These modules are a tested foundation, not a claim that Phase 4 is shipped.

## Isolated runner and preflight checkpoint

`simulation-preflight.ts` checks ground-reference ambiguity, empty/mismatched identities,
duplicate terminals/members, reciprocal device/net records, missing terminals/nets,
unconnected devices, source shorts, and islands without a structural reference path.
Errors carry affected targets and repair instructions and stop the test before solving.
Structural reachability still does not certify conduction through device bodies.

`renderer/simulation-test-runner.ts` now runs DC, transient, and digital checks on deep
copies, retaining a separate input snapshot. It uses the existing relay/electro-thermal
and transient-thermal engines, refuses nonconverged results, carries solver warnings,
and captures the actual parameters/netlist/request in report provenance. Digital input
names and unsigned widths are checked; ignored or truncated stimuli cannot certify a run.
Copying uses the documented [Node structuredClone API](https://nodejs.org/docs/latest/api/globals.html#structuredclonevalue-options)
without transferring/detaching live objects. Copy failures refuse the run.

Ten isolated-run/preflight tests pass, including actual thermal-limit assertions,
unchanged nested world state, independent returned snapshots, deliberate mutation of
the digital engine's copies, unsupported DC devices, invalid requests, and repair targets.
Together with the assertion and adapter suites, 34 focused tests pass. Typecheck passes
at the preceding 33-test checkpoint; final gates will cover subsequent changes.

The earlier digital-validation full-suite run completed successfully: 399 files and
5,751 tests. It began before the new assertion/adapter/runner files were created and
does not count as their full-repository integration gate. AC isolated execution, canvas
snapshot integration, unified persistence/authoring/report UI, remaining conservation
fixtures, and final full verification are still required.

## AC and persistence checkpoint

Isolated AC execution now uses the existing DC/relay/thermal bias result, applies settled
relay and Shockley states only to its private world, and evaluates explicit frequencies
through the existing AC equations. `acTestResponse` exposes unknown-device omissions,
failed nonlinear model construction/bias, ignored declared values, ideal-loss assumptions,
and the 1 nS numerical shunt. Omissions/ignored values cannot certify a test. The existing
plotting APIs and their equations are unchanged. Exact zero gain is valid; its undefined
phase and non-finite decibel value remain unavailable rather than becoming invented numbers.

`simulation-test-suite.ts` defines and validates versioned saved test definitions for all
four analysis modes. Circuit files can serialize/deserialize them through an optional
`simulationTests` field without changing the v1 format. Validation rejects malformed or
duplicate tests instead of silently deleting requirements, strips cached/unknown fields,
and retains independent copies of run settings, expectations, units, and provenance.

Verification: the AC, AC coverage/loss/notice, isolated-run, circuit-file, and suite tests
passed 176 tests across seven files, followed by a passing typecheck. A subsequent zero-gain
edge-case addition passes with the runner/suite tests (27 tests). There are now 51 focused
tests across the four new Phase 4 test files. Full-suite and interactive gates remain pending.

Integration boundary at that checkpoint: this file-format support was not yet wired into Canvas
state or its save/open/template/undo/staged-load paths. Those paths must preserve the suite
before claiming persistence works in the app. Saved voltage probes also need endpoint-based
resolution so regenerating internal net IDs cannot silently retarget a test. The next work
was that app integration and a usable authoring/report interface, not another standalone engine.

## Existing digital waveform bridge checkpoint

The test bench now lists existing `BlockData.tests` and offers an explicit copy into
the unified suite, without removing or editing the originals. Each saved output/cycle
becomes an exact assertion, preserving waveform coverage and unsigned signal widths.
Incomplete/extra waveforms, missing/unknown outputs, and invalid input names or widths
are refused rather than silently importing a smaller passing subset. Imported
expectations disclose that legacy capture/manual origin was not recorded and do not
claim independent physical validation. Reimport uses a stable block/test identity.
The complete suite is validated before saving, including its total test-count limit.

Seven bridge tests cover unchanged originals, all-cycle assertions, JSON validation,
real-engine pass/fail reports, and six invalid coverage/input cases. Together with the
legacy runner, suite, and panel rendering tests, 32 tests pass in four files; scoped
lint passes. Interactive import and native file workflows still need verification.

Canvas state, save/template arguments, undo/redo, staged-load restoration, and stable
terminal probes are now implemented (see earlier interactive checkpoint). The old
integration boundary above records the earlier stage, not the current source state.
The broader integration test process is running; it began before this digital bridge
was added, so its coverage must be combined with these later focused checks or rerun.

## Disk reopening and regression gate checkpoint

Five new disk roundtrip tests use the real circuit writer, filesystem, loader, and
`circuitFileToFlow` hydration, then rerun the saved definitions against the reopened
design. DC, supported AC, transient, and imported digital checks retain their results;
an AC source with ignored internal resistance remains unavailable with its warning
after reopening. Deliberately obsolete net names are resolved through saved terminal
probes. A second save retains the definitions, and legacy block tests coexist unchanged
with imported unified waveforms. These tests verify the application data path, not a
native file-dialog click-through.

The broader integration run completed successfully: **405 test files / 5,810 tests**,
exit 0, 399.63 seconds (`chipblocks-phase4-integration-tests.log` in the temporary
directory). It started before the digital-import and disk-reopen tests existed; their
later focused results are separate evidence, not included in that count. The subsequent
typecheck, scoped persistence-test lint, and production build also pass (1,734 renderer
modules). Remaining interactive/fidelity checks are still pending; Phase 4 remains active.

## Bounded AC test execution checkpoint

AC test sweeps now share one deadline with their DC/relay/thermal bias solve and
small-signal operating-point construction. The test-only sweep refuses systems above
the existing MNA unknown-count ceiling before allocating its frequency matrix, and
checks time before each frequency and after the final solve. Expired, oversized, and
partial sweeps cannot certify any assertions as complete. Existing plotting APIs and
electrical stamps remain unchanged. This is cooperative interruption between matrix
solves, not a hard wall-clock responsiveness guarantee: a single synchronous
[mathjs LU solve](https://mathjs.org/docs/reference/functions/lusolve.html) cannot be
interrupted mid-call, and the shared ceiling was originally measured for the DC engine,
not a separate AC performance benchmark.

Three added regressions cover immediate timeout, pre-allocation size refusal, and a
partial sweep whose valid first sample must not imply completion. Runner, existing AC,
and disk-reopen suites pass **49 tests in three files**; typecheck passes. Repository
lint still reports **60 errors and 2 warnings**, the same counts as the recorded
baseline. No unrelated baseline fixes were made. A final full run is still required
after the remaining Phase 4 changes.

## Interactive digital and report-navigation checkpoint

Verified in the actual renderer using the Logic gates starter: capture an AND
both-high vector for two cycles in the existing Trace inspector, import it in Tests
and preflight, and run it. Both cycle reports show expected 1, actual 1, exact cycle,
zero tolerance, and the legacy-provenance caution. The import leaves the original
test available. Selecting affected parts opens the AND block properties.

That navigation exposed overly conservative freshness tracking: selecting a block
changed the node-array identity and marked the result stale even though no input
changed. Freshness now compares the persisted circuit inputs plus routed geometry,
not selection/render object identity. An added regression distinguishes selection and
rendered current values from physical position, parameters, and route changes. The
interactive rerun/navigation now preserves the current PASS. Saved-test definition
changes still invalidate results independently. Expected values render as value ±
tolerance or range rather than raw JSON.

The panel now explicitly distinguishes physical DC/AC/transient checks from isolated
cold-start digital checks. These are named-engine tests, not a replay of live mixed
canvas state or a mixed-signal timing certification. Twelve focused import/world/panel
tests pass; the preceding five-test freshness check and typecheck also pass. Remaining
AC/transient authoring interaction, final full gates, and acceptance reconciliation
are pending.

## Interactive AC/transient and capacitor-loss checkpoint

Exercised authoring, saved definitions, editing, and rerunning with the real RC starter
(R=1600 ohm, C=100 nF, 1 kHz). Its declared source resistance correctly made AC
unavailable. After explicitly making the verification source ideal, a lossless RC
expectation failed: the capacitor declares DF=0.2. Inspecting report inputs exposed
that assumption. Using the independently computed lossy-capacitor reference
`abs(ESR-jXc)/abs(R+ESR-jXc)`, with `ESR=DF/(2*pi*f*C)`, predicts
0.6511606338925713; the app reports 0.6511595795687185, passing a 0.00001 tolerance
for wires and Gmin. The relation is verified against the
[KEMET ceramics FAQ](https://www.kemet.com/en/us/capacitors/ceramic/ceramics-faq.html).
No physical equation was changed to make that comparison pass.

Time-response authoring at 0.00025 s initially returned 0.9999969320313039 V against
a 1 V sine-source reference. Further code inspection found the transient capacitor
model does not read declared ESR or dissipation factor, and the test report had not
disclosed that omission. The runner now emits an affected-capacitor diagnostic and
actionable guidance, marks the analysis unsupported, and refuses a passing test.
Interactive rerun confirmed NOT PASSED / unavailable with the explicit loss warning.
The earlier point value is therefore not evidence that this lossy transient circuit is
fully modeled. Two regressions pin both ignored parameter names; existing supported
transient and persistence checks remain green. Reports now keep the requested point
or window and source formula visible even when an actual value is unavailable.

Focused verification: **38 tests in three files**, typecheck, and scoped lint pass.
Final full gates and the requirement-by-requirement acceptance audit were still pending
at this checkpoint.

## Final completion checkpoint — 2026-09-19

- `npm test -- --maxWorkers=2`: exit 0, **407 files / 5,828 tests**, 660.69 seconds.
  Log: `%TEMP%/chipblocks-phase4-final-tests.log`. Includes all new assertion, runner,
  persistence, import, preparation and panel tests, plus the existing transformer,
  perfect-coupling, and gate-capacitance physics regressions.
- `npm run typecheck`: exit 0.
- Scoped Biome on all 23 Phase 4 source/test files: exit 0, no changes needed.
- `npm run build`: exit 0; main, preload, and 1,734-module renderer compiled.
- Full repository Biome summary: exit 1, **60 errors / 2 warnings**, unchanged baseline
  counts; listed fixture formatting and `resources/make-icon.mjs` import/format issues
  remain outside this change. Log: `%TEMP%/chipblocks-phase4-final-lint-summary.log`.
  The expanded diagnostic renderer was stopped after spending minutes generating a
  large unchanged fixture diff; the subsequent summary run completed in two seconds.

No solver equation was replaced to accommodate an expectation. Documented limitations
are exposed as model/support boundaries, not fabricated passing results. Advanced
multi-assertion editing currently uses validated JSON; native dialog automation and
live mixed-signal replay are not claimed. All original Phase 4 testing/preflight
requirements are implemented and verified within the named engines' explicit scope.
No commit was made. Unrelated existing files and lint failures were left untouched.
