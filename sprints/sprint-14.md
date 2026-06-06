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

---

## Sprint 14 retro (closed 2026-06-05)

### What landed

| Sub-commit | What |
|---|---|
| `c0afd03` | S14-v3-1: Sprint 14 plan opened |
| `a44ee01` | S14-v3-2: OBJECT-MODEL.md §18 — DC solver model + §15 "Net behaviors / physics" row partially closed (linear case) |
| `dab354b` | S14-v3-3: `src/dc-solver.ts` scaffold — types + ground identification + node-index assignment + resistor stamps + mathjs lusolve smoke test (passed first-try, no pivot) |
| `32ddda6` | S14-v3-4: voltage source MNA extension — auxiliary current variables; matrix grows to (N+S)×(N+S); 9 V + 100 Ω end-to-end test produces node_a = 9 V |
| `cfb37c5` | S14-v3-5: LED fixed-V_F + closed switch + wire-as-short stamps via shared `findAndStampVoltageSource` helper; 9 V + 100 Ω + LED V_F=2 V end-to-end test |
| `3f0485c` | S14-v3-6: branch current extraction — Solution.branches populated; MNA's auxiliary current already in §18.6 convention (positive = enters positive terminal); no sign flips |
| `825cb59` | S14-v3-7: **the climax** — educational anchor circuit fixtures solve end-to-end → **70 mA result reported faithfully** at every series element + correct node voltages; pre-filter added on idle instances (catalog-example LEDs without connects) |
| (this) | S14-v3-8: retro + 4 new §15 rows — Sprint 14 closes |

### Done criteria — all met

- [x] OBJECT-MODEL.md §18 lands with the full DC solver model spec (10 subsections: Purpose / Ground convention / MNA construction / Per-element stamps / Solve mechanism / Solution shape / Scope: linear case / Anti-placeholder compatibility / First concrete case / Relation to §15)
- [x] §15 "Net behaviors / physics" deferred row partially closed (linear case linked to §18; nonlinear Newton-Raphson migrates to a new §15 row pointing at Sprint 15)
- [x] `src/dc-solver.ts` exports `solveDC(world, options?): Solution`
- [x] Per-element stamps implemented and unit-tested: resistor, voltage source, wire-as-short, LED (fixed-V_F), switch (ideal-short / open)
- [x] mathjs `lusolve` smoke test passes on a hand-built 2×2 + 3×3 system (precision 9)
- [x] End-to-end test on the educational anchor circuit fixtures (the real 6-instance + 6-net world on disk) produces the expected **70 mA** current at every series element + correct node voltages
- [x] Solution object shape documented in §18 and consumable by downstream sprints (Sprint 15 will read `branches.get(led_id)` and compare to `max_forward_current`)
- [x] All tests pass — **175** (up from 146 at Sprint 13 close, ~20% growth)
- [x] `npx tsc --noEmit` clean
- [x] `npx biome check .` clean (after two auto-format passes during S14-v3-3 and S14-v3-5)
- [x] Sprint retro written
- [x] 4 new §15 rows added: nonlinear iterative DC solver (Shockley + Newton-Raphson + pnjlim), switch state-machine integration, transient simulation, wire resistance modeling

### Catalog after Sprint 14

| | Sprint 13 close | Sprint 14 close |
|---|---|---|
| Material | 18 | (unchanged) |
| Shape | 2 | (unchanged) |
| Behavior | 10 | (unchanged) |
| Interface kind | 2 | (unchanged) |
| Primitive device | 10 | (unchanged) |
| Instances | 16 | (unchanged) |
| Active Variables | 2 | (unchanged) |
| Nets | 6 | (unchanged) |
| Schemas | 8 | (unchanged) |
| Object kinds with own schema | 5 | (unchanged) |
| Cross-FK error codes | 11 | (unchanged) |
| **Source modules** | 1 (`cross-fk-validator`) | **2** (+ `dc-solver`) |
| **Catalog spec sections (§16/§17/§18 added in Sprints 12/13/14)** | 17 | **18** |
| **Tests** | 146 | **175** (~20% growth) |
| **DC solver — what it answers** | none | "**what does this circuit do?**" — node voltages + branch currents for resistors + voltage sources + LEDs (fixed-V_F) + switches + wires |
| **`solveDC` integration with the catalog** | n/a | end-to-end on the educational anchor circuit fixtures — **70 mA + correct node voltages**, matching by-hand math to 1 part in 10⁹ |

### Lessons surfaced

1. **mathjs `lusolve` passed smoke first-try.** Same outcome as Sprint 12 (mathjs unit algebra) and Sprint 13 (no surprises). The hand-built matrix smoke test before depending on the library validated the load-bearing assumption with no pivot. **General lesson:** when a sprint's success depends on a library behaving as documented, the smoke test isn't ceremony — it's the load-bearing pivot decision, and it's cheap to run upfront.

2. **MNA sign convention came out clean.** Reasoning through the KCL stamp pattern carefully (sum-of-currents-out-of-node = 0) showed that the auxiliary current variable `x[N+s]` is **already** in the §18.6 convention (positive = current entering positive terminal). No post-extraction sign flips needed. **General lesson:** when adopting a standard mathematical formalism (here, MNA), the conventions usually compose cleanly — invent only what the standard doesn't already settle.

3. **Pre-filter on idle instances cleaned up the matrix.** The catalog-example LEDs (`led_002` … `led_005`) sitting in `fixtures/valid/` without `connects:` were initially being allocated auxiliary current variables that left zero rows in the matrix. The end-to-end test caught the resulting warnings + ill-conditioning. **General lesson:** when a check requires a specific shape (e.g., "exactly 2 connects"), filter at the entry point rather than handle the missing-shape case downstream.

4. **The 70 mA / 20 mA ratio is the cross-sprint contract.** Sprint 14 faithfully reports the 70 mA current; the LED's `max_forward_current` parameter says 20 mA. Sprint 15's failure-mode check will fire `led-overloaded` on exactly this case. The test asserting the 3.5× overshoot documents the contract so a regression in either sprint surfaces clearly. **General lesson:** when two sprints share an interface, write a test that verifies the **interface invariant** explicitly — not just the behavior of either side.

5. **Shared MNA stamp helper kept the code DRY.** When LED + closed switch + wire-as-short all turned out to be voltage-source-like elements with different terminal-name conventions, extracting `findAndStampVoltageSource` as a shared helper (parameterized by positive-terminal name, negative-terminal name, voltage value) collapsed three nearly-identical implementations into one. The Sprint 14 plan's "no premature abstraction" worried about doing this too early; in practice, three concrete uses justified the helper exactly.

6. **Sprint 14 was the smoothest sprint yet.** No major pivots, no documentation drift caught mid-flight, no compliance scaffolding to bolt on, no NUL-byte cruft, no fragile test precision. The accumulated discipline from Sprints 12 + 13 (scan before building, mid-Sprint check, dedup discipline, real-fixture examples, MNA-stamp citations to canonical sources) all stayed load-bearing. Less work to recover from mistakes because fewer mistakes happened. **General lesson:** sprint-to-sprint discipline compounds — the cost of "doing it right this time" pays down across future sprints.

7. **The solver gives "the right answer for the wrong reason" with the fixed-V_F approximation, and that's OK.** A real LED's V_F at 70 mA is higher than its V_F at 20 mA (Shockley equation), so the current at 9 V supply with 100 Ω would be slightly less than the linear approximation suggests. Sprint 14's solver reports 70 mA exactly; Sprint 15's Shockley + Newton-Raphson will produce a slightly different (more accurate) number — probably 65-68 mA. The 3.5× overshoot conclusion is unchanged either way. **General lesson:** an approximation can be useful precisely when its error is small relative to the decision it informs. Spending Sprint 14 on Newton-Raphson would have been over-engineering for the safety check Sprint 15 is going to do.

### New §15 rows added in this retro

Four new deferred questions added to OBJECT-MODEL.md §15 alongside this retro:

- **Nonlinear iterative DC solver (Shockley + Newton-Raphson + pnjlim).** Sprint 14's LED uses a fixed-V_F approximation; the real I-V relationship is exponential per the Shockley equation `I = I_s × (exp(V/V_T) − 1)`. Solving this requires linearizing around an operating point and iterating with Newton-Raphson, plus the **pnjlim** convergence aid that prevents diode voltage from oscillating across the exponential's steep region. Lands together with Sprint 15's failure-mode detection — both consume the per-instance current value, so accuracy upgrades and safety checks ship in the same sprint.
- **Switch state-machine integration.** Sprint 14 hardcodes all SPST switches as closed. The §6.5 state machine declares an `initial_state` (often `open` for safety); future state-aware solving would consult each switch's state and produce a stamp accordingly (closed = 0 V source / merge; open = no stamp). Pairs with the trigger-taxonomy and multi-pole-switch §15 rows from earlier sprints.
- **Transient simulation.** Sprint 14 is DC operating point only. Capacitors act as open circuits at DC, inductors as short circuits; the solver currently doesn't model time-dependent behavior. Real transient sim (the "what happens at the moment you flip the switch?" question) is far out — needs ODE integration, time-stepping, capacitor/inductor charge/flux models, possibly numerical-stiffness handling. Probably its own multi-sprint arc when it lands.
- **Wire resistance modeling.** Sprint 14 treats wires as ideal shorts (0 V sources). The §16 equation evaluator can compute R = ρ × L / A from material + geometry, but the IR drop on hookup wire at typical hobby currents (≤100 mA) is sub-mV. Modeling it gains accuracy only when fixtures move to higher currents (PCB power traces at 1 A+, long cable runs, high-frequency parasitic considerations). Lands when a fixture genuinely demands it.

### Unresolved questions (still deferred per OBJECT-MODEL.md §15)

Carried forward from prior sprints + 4 new from Sprint 14 retro:

- Default-resolution path, `property_definition` registry, multi-version definitions, cross-pack dependencies, schema migration
- Stackup model, preset/template model, visual symbol library, auto-created interface UX, right-click parameter override UX, keybindings settings page
- Alloy composition-by-weight, `min_count` enforcement (composition-role version), AV chains
- Trigger taxonomy enum, multi-pole switches, state-dependent behavior gating
- Schottky junction promotion
- White LED, heterostructure / QW active-layer modeling, laser diodes
- Parametric equation evaluation (`input_variable`) — natural caller is now the solver; pairs with Sprint 15 work
- Device-level defaults-vs-rating check, geometry properties on shape definitions
- Terminal-name validation, bus / hierarchical / sub-net model, net-level Active Variables
- **NEW from Sprint 14 retro:** nonlinear iterative DC solver (Sprint 15 target — pairs with failure-mode checks); switch state-machine integration; transient simulation (far out); wire resistance modeling (when fixtures demand it)

Background-knowledge claims still flagged for verification (carried from Sprint 10/11):
- IEC 62471 risk-group classifications
- SPICE LED diode-model specifics (now load-bearing for Sprint 15's Shockley implementation)
- KiCad single-LED-symbol count

### What this unblocks

After Sprint 14 close:

- **Stage 3 of the simulation+visualization arc is done (linear case).** ChipBlocks answers "what does this circuit do?" for the catalog of fixtures it ships. The full pipeline — YAML → cross-FK → solveDC → Solution — runs end-to-end on the educational anchor circuit and gives the load-bearing 70 mA result.
- **Sprint 15 (failure-mode detection, Stage 4) has its primary input.** The check is straightforward: for each instance with a `max_*` rating parameter, read the corresponding entry in `sol.branches`, and fire an error code (e.g., `led-overloaded`, `resistor-overcurrent`, `voltage-source-overload`) when `|current| > max_rating`. Implementation should land in 4-6 sub-commits; the test data already exists (the anchor circuit's deliberate 3.5× overshoot).
- **The §16 equation-evaluator pairs with the solver naturally.** When a resistor is declared with `resistance` as `kind: equation` (R = ρL/A), the solver currently reads from `parameters.resistance` directly. A small extension to call `evaluateEquation` when the value is an equation would close the loop: derived resistances flow into the solver automatically. Lands as a small follow-up commit when needed.
- **Future canvas can show real values.** When the canvas renders a node, it can display the solved voltage. When it renders a component, it can show the branch current. The Solution.nodes / branches maps are exactly the input the visualization lenses (Stage 6 of the simulation arc) need.
- **Catalog migration to equation-valued properties becomes attractive.** Sprint 12 added `kind: equation` to 3 fixtures (resistor R, LED λ, capacitor C). Sprint 14's solver consumes the resulting numerical values. Future sprints can confidently extend the catalog without worrying that derived values won't flow downstream.

### Sprint 14 closed

All sub-commits land cleanly on master. 175 tests pass (71 schema + 12 baseline cross-FK + 3 derives-violates-rating + 3 net cross-FK + 17 net-schema + 23 equation-schema + 20 equation-evaluator + 29 dc-solver — including the educational anchor circuit end-to-end). The linear DC solver MVP is formalized, implemented, and integrated end-to-end with the catalog. **Sprint 15 (failure-mode detection — Stage 4 of the simulation arc)** is the natural successor and now has the 70 mA result waiting to be flagged as a `led-overloaded` violation. The user can pick that or a different §15 row at the Sprint 14+1 planning conversation.
