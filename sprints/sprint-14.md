# v3 Sprint 14 — DC solver MVP (Stage 3 of the simulation+visualization arc)

> **Status:** Sprint plan, opened 2026-06-05 against master tip `3ae2ab5`.
> **Predecessor:** Sprint 13 closed the net model formalization (§17): nets are first-class objects with schema, validation, and bidirectional consistency. 146 tests, 11 cross-FK error codes. The educational anchor circuit is fully wired at the connectivity layer. Sprint 14 picks up Stage 3 of the simulation+visualization arc — for the first time computing what the circuit *does*, not just what's *connected*.
> **Scope:** A linear DC solver based on **Modified Nodal Analysis (MNA)** that handles resistors + voltage sources + ideal wires + a **fixed-V_F approximation** for LEDs/diodes. Single deterministic solve via mathjs's linear-algebra ops; no Newton-Raphson iteration this sprint. Outputs node voltages and branch currents for the full educational anchor circuit. Failure-mode detection (compare computed current against device max ratings) is Sprint 15.

---

## Sprint 14 goal in plain English

After this sprint, ChipBlocks can answer: "**What voltage is at each net, and what current flows through each component?**"

Today the validator catches structural problems (wrong materials, broken refs, mismatched nets) but doesn't compute anything physical. After Sprint 14, you can load the educational anchor circuit, run the solver, and get the answer a textbook would give:

> At 9 V supply, 100 Ω current-limit resistor, LED with V_F = 2.0 V → **current through circuit ≈ 70 mA**.

(Note: that's 3.5× the LED's 20 mA max rating. The fixture is deliberately undersized; Sprint 14's solver reports the 70 mA result faithfully, and Sprint 15's failure-mode check will surface the rating violation — "LED overloading" detection lands then.)

Stage 4 (Sprint 15) catches the safety problem; Stage 6 lenses (later) visualize the current flow. Sprint 14 is the foundation both consume.

---

## After this sprint

1. New module: `src/dc-solver.ts` exporting `solveDC(world: World): Solution`.
2. **MNA matrix construction** — walks `world.instances` + `world.nets` to build a conductance matrix G and source vector I. Each device kind contributes a "stamp" per the per-device model (§18.3 in the spec).
3. **Per-element models** (Sprint 14 scope):
   - **Resistor** — Ohm's law: stamps `1/R` into the appropriate G entries.
   - **Voltage source** (battery / power_source) — extends the MNA system with an auxiliary current variable (the standard MNA approach for ideal voltage sources, which have infinite conductance).
   - **Wire** — treated as a small-but-finite resistor based on the wire's material resistivity × length / cross-section area (the §16 equation evaluator computes this); for ideal wires the solver detects near-zero resistance and merges the two nets into one node.
   - **LED / diode** — **fixed-V_F approximation**. When the device is forward-biased (anode at higher net potential than cathode), treated as a voltage source equal to its declared `forward_voltage`. The full Shockley equation + Newton-Raphson lands in Sprint 15.
   - **Switch** — hardcoded to its initial state (closed for SPST). State-machine integration is a §15 row.
4. **Ground reference** — one net designated as ground (V = 0). Default: the net with `type: ground` (the educational anchor circuit's `net_battery_neg`). Configurable per solve call.
5. **Linear solve** — mathjs's `lusolve` on the assembled `Gx = I` system.
6. **Solution object** — per-net voltage (relative to ground) + per-instance branch current. Structured, easy to consume by downstream sprints (Sprint 15 failure-mode checks; eventually canvas visualization lenses).
7. **OBJECT-MODEL.md §18** — solver model spec; closes the §15 row about "net behaviors / physics (KVL, KCL, electrical consistency)" partially (linear case only; nonlinear iterative case stays open for Sprint 15).
8. **End-to-end test** — load the educational anchor circuit, solve, verify the result matches by-hand math: 70 mA through every component, 9 V at battery_pos, 7 V at switch_resistor (after the 0 V switch drop), 2 V at resistor_led (above ground), 0 V at battery_neg.

---

## Non-goals (explicit, with reasons)

- **No Newton-Raphson iteration.** The Shockley exponential diode equation needs iterative solving with convergence aids (pnjlim algorithm). Sprint 14 uses fixed-V_F instead — a well-established first-order engineering approximation. Sprint 15 adds the exponential model alongside the failure-mode checks that need accurate currents at the edge of safe operating area.
- **No state-dependent switches.** Switches stay hardcoded to their initial state (SPST defaults to closed). Per-state-conductance integration with the §6.5 state machine is a §15 row.
- **No transient simulation.** Only the DC operating point. Capacitors act as open circuits at DC, inductors as short circuits — the solver applies these limits but doesn't track voltage/current vs. time. Transient (Stage 5 of the simulation arc) is far out.
- **No tolerance analysis or Monte Carlo.** Single deterministic solve with nominal component values. Statistical / worst-case analysis is a separate future direction.
- **No temperature dependence.** Room-temperature values only. Parametric equations using `input_variable: T` (§16 input_variable + Sprint 12's deferred row) stay deferred — when temperature dependence comes online, the solver becomes the natural caller passing T.
- **No failure-mode detection.** Sprint 14 reports what the math says (e.g., 70 mA through the LED). Comparing that against the LED's `max_forward_current: 0.020 A` and surfacing a safety error is Sprint 15's job — it consumes Sprint 14's Solution as input.
- **No multi-supply circuits beyond what falls out free.** The solver design handles N voltage sources, but the test circuit has just one. Multi-supply test fixtures land if/when a use case appears.
- **No visualization.** Solver returns the Solution object; no canvas overlay, no value rendering. Stage 6 visualization lenses are well after the canvas sprint.
- **No power dissipation rollup yet.** Solver computes V and I per element; P = V·I is trivially derived downstream when failure-mode checks need it. Sprint 15.
- **No AC small-signal analysis.** Linear DC operating point only.

---

## Locked toolchain (inherited from Sprints 2-13)

Node 24 + npm + JSON Schema 2020-12 + Ajv 8 + Vitest + Biome 2 + TypeScript 6 strict + mathjs 15.2.0. **No new dev dependencies** — mathjs already provides `lusolve`, `matrix`, `multiply`, `subtract`, `inv` for the linear algebra. License compliance scaffold (NOTICE + THIRD-PARTY-LICENSES.md) covers the mathjs use already; nothing new to bundle.

---

## Deliverables

```
OBJECT-MODEL.md
├── §18 NEW — DC solver model                  spec; placed after §17
└── §15 deferred row "Net behaviors / physics" partially closed (linear case done;
                                                nonlinear Newton-Raphson stays open)

src/
└── dc-solver.ts                                NEW — MNA + linear solve + per-element stamps

tests/
└── dc-solver.test.ts                           NEW — unit tests (per-element stamps,
                                                ground-reference choice, the educational
                                                anchor circuit end-to-end, edge cases)
```

No schema changes. No fixture changes (the existing circuit is the solver's first test target).

---

## Sub-commit sequence

| # | Commit | Scope |
|---|---|---|
| **S14-v3-1** | `sprints/sprint-14.md` | This plan. |
| **S14-v3-2** | OBJECT-MODEL.md §18 spec | Full spec for the DC solver model: purpose, ground reference convention, MNA matrix structure, per-element stamps (resistor, voltage source, wire, LED fixed-V_F, switch ideal), solve mechanism, Solution shape, scope boundaries vs. Sprint 15 (Newton-Raphson) and Sprint 13 (cross-FK structural checks). §15 row partial closure with §18 pointer (the linear case only). |
| **S14-v3-3** | `src/dc-solver.ts` scaffold + linear-element stamps | Solver module with World ingestion, ground-reference identification (default = net with type: ground), per-net node-number assignment, conductance matrix builder for resistors only. Smoke test verifies mathjs's lusolve produces correct output for a tiny 2-node R+R divider built by hand. |
| **S14-v3-4** | Voltage-source MNA extension | Add the modified portion of MNA: voltage sources extend the system with auxiliary current variables (one per source). Test: simple voltage-source-then-resistor circuit produces expected V and I. |
| **S14-v3-5** | LED fixed-V_F + Switch ideal-short + Wire near-zero-resistance | LED treated as voltage source (V = forward_voltage) when forward-biased; SPST switch treated as 0Ω short (closed state, hardcoded); wire treated as a small resistor computed from its material+geometry via §16 evaluator, OR merged-net treatment for ideal wires. |
| **S14-v3-6** | Solution shape + per-instance branch currents | Once node voltages are solved, walk instances to compute each branch's current (V_diff / R for resistors; the auxiliary current variable for voltage sources/LEDs/wires). Returns structured Solution: `{ nodes: Map<netId, voltage>, branches: Map<instanceId, current> }`. |
| **S14-v3-7** | End-to-end educational anchor circuit test | Full integration: load valid world, run solver, verify the 70 mA / node-voltage results match by-hand math within tolerance. This is the load-bearing "Sprint 14 actually does the thing" test. |
| **S14-v3-8** | Sprint 14 retro + §15 partial closure | Sub-commit log, lessons, formal partial-closure of the §15 "Net behaviors / physics" row (linear case done in §18; nonlinear Newton-Raphson + Shockley equation tracked as a NEW §15 row pointing at Sprint 15). New §15 rows for switch state-conductance integration; transient simulation; AC small-signal. |

---

## Verification discipline (zero-trust, per Sprint 12 / 13 pattern)

- **MNA stamp correctness verified against canonical references.** Each per-element stamp matches the standard form in published MNA tutorials (Ho/Ruehli/Brennan 1975, Qucs technical docs, IEEE EMC Society "How SPICE Works"). No invention — same stamps every SPICE implementation uses.
- **Ground reference handling tested in isolation.** A circuit with no `type: ground` net must error explicitly (or fall back to a documented default); a circuit with multiple `type: ground` nets uses the first deterministically.
- **mathjs lusolve correctness smoke-tested.** Tiny hand-checkable circuit verifies mathjs's linear-algebra ops produce the expected solution before the bigger anchor circuit depends on them. If broken, pivot to numeric.js or hand-written Gaussian elimination — same pattern as Sprint 12's mathjs-unit-algebra smoke test.
- **By-hand math for the educational anchor circuit.** 9 V supply, 100 Ω resistor, LED V_F = 2.0 V → I = (9 − 2) / 100 = 70 mA. Node voltages: net_battery_pos = 9 V, net_wire1_switch ≈ 9 V (wire drop tiny), net_switch_resistor ≈ 9 V (switch closed, zero drop), net_resistor_led = 2 V (after 7 V resistor drop), net_led_wire2 ≈ 0 V (above ground), net_battery_neg = 0 V (ground reference). The solver result must match within tolerance.
- **Wire resistance from material+geometry.** wire_001 / wire_002 each have a copper material + path geometry. The §16 equation evaluator can compute their resistance (R = ρL/A). For typical hookup wire (e.g., 10 cm of 22 AWG copper), R ≈ 5 mΩ — tiny but nonzero. Treat as a resistor with this value. If geometry isn't available for evaluation, fall back to a "merge nets" treatment (the wire makes its two endpoint nets electrically identical).
- **All three gates green** (`npm test`, `npx tsc --noEmit`, `npx biome check .`) before each sub-commit.
- **Bidirectional consistency invariant from §17 must hold.** The solver builds its node map from `world.nets`; if a net's members don't match an instance's connects, the solver gracefully errors (or the cross-FK validator catches it first — running the solver presumes a clean cross-FK pass).
- **No silent regressions in cross-FK or schema tests.** Adding the solver doesn't touch existing validation; if any prior test breaks, that's a real regression worth investigating before commit.

---

## Done criteria

- [ ] OBJECT-MODEL.md §18 lands with the full DC solver model spec
- [ ] §15 "Net behaviors / physics" deferred row partially closed (linear case linked to §18; nonlinear case migrated to a new §15 row pointing at Sprint 15)
- [ ] `src/dc-solver.ts` exports `solveDC(world: World, options?: SolveOptions): Solution`
- [ ] Per-element stamps implemented and unit-tested: resistor, voltage source, wire, LED (fixed-V_F), switch (ideal-short / open)
- [ ] mathjs lusolve smoke test passes on a hand-checkable 2-resistor divider
- [ ] End-to-end test on the educational anchor circuit produces the expected 70 mA current + node voltages within tolerance
- [ ] Solution object shape documented in §18 and consumable by downstream sprints
- [ ] All tests pass (count grows from 146; expect ~165-180 at close)
- [ ] `npx tsc --noEmit` clean
- [ ] `npx biome check .` clean
- [ ] Sprint retro written
- [ ] At least 3 new §15 rows added: nonlinear iterative solver (Shockley + Newton-Raphson + pnjlim), switch state-machine integration, transient simulation

---

## Risks called out

1. **MNA matrix construction is intricate.** Getting the stamps right — including the sign conventions for voltage sources' auxiliary current variables — is the load-bearing thing. Mitigation: validate each stamp on a 1-2-node hand-checkable test BEFORE assembling the full circuit. Cite the canonical MNA paper for every nontrivial stamp pattern.
2. **mathjs lusolve might surprise.** Specific quirks (sparse vs. dense, singular-matrix handling, return shape) could cause issues. Smoke test in S14-v3-3 before depending on it. If broken, swap to `mathjs.inv() × I` or write a small Gaussian elimination — same decision tree as Sprint 12's mathjs-unit-algebra pivot.
3. **Wire resistance vs. ideal-wire trade-off.** Wires with computed R ≈ 5 mΩ may produce numerical noise (very small numbers in matrix → conditioning issues). Alternative: treat ideal wires as net-merging (both endpoint nets collapse to one node). Decision in S14-v3-5 — likely net-merging for simplicity.
4. **Ground reference assumption.** Defaulting to the net with `type: ground` works for the educational anchor circuit but may not generalize. Document the choice; allow override via SolveOptions.
5. **LED forward-bias detection.** Fixed-V_F treatment requires knowing the LED is forward-biased before solving. In Sprint 14's single-source, no-feedback circuit, the LED is unambiguously forward-biased. Real circuits could violate this. Document the assumption; flag it.
6. **The 70 mA result is unsafe in real life.** The Sprint 14 solver will faithfully report 70 mA through an LED rated 20 mA max. This is the right behavior — the solver computes; Sprint 15 catches safety. Be ready for the test result to look "wrong" until Sprint 15 contextualizes it. Sprint 14 retro should acknowledge this.

---

## Open questions deferred to later sprints

Carried forward from Sprint 13 close + new from Sprint 14 design:

- Default-resolution path, `property_definition` registry, multi-version definitions, cross-pack dependencies, schema migration
- Stackup model, preset/template model, visual symbol library, auto-created interface UX, right-click parameter override UX, keybindings settings page
- Alloy composition-by-weight, `min_count` enforcement (composition-role version), AV chains
- Trigger taxonomy enum, multi-pole switches, state-dependent behavior gating (becomes more pressing once the solver wants to model switch states)
- Schottky junction promotion
- White LED, heterostructure / QW active-layer modeling, laser diodes
- Parametric equation evaluation (`input_variable`) — natural caller is the solver, lands together with temperature-dependence work
- Device-level defaults-vs-rating check, geometry properties on shape definitions
- Terminal-name validation, bus / hierarchical / sub-net model, net-level Active Variables (Sprint 13 retro additions)
- **NEW from Sprint 14 design:** nonlinear iterative DC solver (Shockley diode + Newton-Raphson + pnjlim convergence — Sprint 15); switch state-conductance integration with §6.5 state machine; transient simulation (huge — far out); AC small-signal analysis; multi-supply / multi-grounded circuits

Background-knowledge claims still flagged for verification (carried from Sprint 10/11):
- IEC 62471 risk-group classifications
- SPICE LED diode-model specifics
- KiCad single-LED-symbol count

---

## Sprint 14 opens here

Master tip when opened: `3ae2ab5` (post-Sprint-13 NUL-purge audit fix). The 146 tests from Sprint 13 close are the floor; expect ~165-180 when Sprint 14 closes (~10-15 dc-solver unit tests + the educational anchor circuit end-to-end test + a small number of edge-case + error-path tests).

Trigger to begin: user approval of this plan.
