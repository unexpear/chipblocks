# ChipBlocks — Project Status

> Canonical implementation and verification snapshot. Last verified 2026-09-14.

This snapshot describes the current working tree, which already contained unrelated user
changes before this Phase 0 audit. It is the source of truth for measured gates and current
implementation status; the README, CLAUDE.md, PRD.md, and TOOLCHAIN-ROADMAP.md provide product
context and link here rather than carrying independent test-count claims.

## Verification gates

| Gate | Command | Result |
|---|---|---|
| Tests | npm test | PASS — 397 test files, 5,719 tests |
| TypeScript | npm run typecheck | PASS |
| Production build | npm run build | PASS — main, preload, and renderer bundles |
| Biome | npm run lint | FAIL — 60 errors and 2 warnings in the current dirty worktree; no fixes were applied |

The passing test run includes non-fatal warnings emitted by existing UI and fixture tests. The
Biome failure is recorded as a baseline, not silently treated as clean; broad auto-formatting was
not run because the worktree contains unrelated changes.

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
