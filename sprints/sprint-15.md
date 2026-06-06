# v3 Sprint 15 — Failure-mode detection (Stage 4 of the simulation+visualization arc)

> **Status:** Sprint plan, opened 2026-06-05 against master tip `945cb77`.
> **Predecessor:** Sprint 14 closed the linear DC solver MVP — the educational anchor circuit solves end-to-end with a 70 mA result at every series element. 175 tests, §18 DC solver model formalized, `src/dc-solver.ts` shipped.
> **Scope:** Compare the solver's computed branch currents and node voltages against each instance's declared rating parameters and fire structured failure errors when ratings are exceeded. **This is the "LED overloading and exploding" detection** the user has asked about since Sprint 12 — Sprint 15 is the sprint where it lands.

---

## Sprint 15 goal in plain English

Sprint 14 answers "what does this circuit do?" — 70 mA flows through the LED.
Sprint 15 answers "**is what it's doing safe?**" — that's 3.5× the LED's max rated current, the LED would be destroyed.

The mechanism is direct: walk every instance, read its rating parameters (`max_forward_current` on LEDs, `power_rating` on resistors, `reverse_breakdown_voltage` on LEDs), pull the corresponding solver result, compare, fire a structured failure with the offending values + tolerance + suggested fix.

The educational anchor circuit (9 V supply + 100 Ω + LED V_F=2 V) is the canonical triggering case. Sprint 15 fires `led-overloaded` on it with the explicit numbers: "led_001 conducts 70 mA, max is 20 mA, 3.5× over rated."

---

## After this sprint

1. New module: `src/failure-detector.ts` exporting `detectFailures(world: World, solution: Solution): Failure[]`.
2. **LED forward overload** — when `|I_led| > max_forward_current` → fires `led-overloaded` with the actual current, the rated max, and the ratio.
3. **LED reverse breakdown** — when `V_cathode − V_anode > reverse_breakdown_voltage` (i.e., LED is reverse-biased beyond rated breakdown) → fires `led-reverse-breakdown`.
4. **Resistor overpower** — when `I² × R > power_rating` → fires `resistor-overpower` with the actual dissipated power and the rated max.
5. **Structured Failure shape** documented in §19: code (enum), source (instance id), kind (which rating violated), measured (actual computed value), rated (limit), ratio (measured / rated when applicable), units, severity (`error` for Sprint 15 — all violations are errors; soft-warning classification is a §15 row).
6. **OBJECT-MODEL.md §19** — failure-mode detection spec; partially closes the §15 row "Nonlinear iterative DC solver (Shockley + Newton-Raphson + pnjlim)" by acknowledging that Sprint 15's safety checks are robust to the linear approximation's error (the 3.5× LED overshoot would fire either way).
7. **End-to-end on the educational anchor circuit** — the existing fixture is deliberately undersized to trigger; Sprint 15 confirms the full pipeline (YAML → cross-FK → solveDC → detectFailures → `led-overloaded`).

---

## Non-goals (explicit, with reasons)

- **No Shockley equation + Newton-Raphson + pnjlim.** The fixed-V_F current of 70 mA is accurate enough to flag the 3.5× overshoot — Shockley would give ~65-68 mA, which is still over the 20 mA rating. The qualitative safety judgment doesn't depend on switching to the exponential model. Shockley + Newton-Raphson stays a §15 row; it becomes its own sprint when borderline accuracy matters (e.g., a circuit operating *near* the edge where linear vs. exponential disagree).
- **No thermal failure modes.** "The resistor gets hot enough to discolor" requires a thermal model (heat conduction, ambient air, package thermal resistance). That's Stage 7 of the simulation arc — far out. Sprint 15 catches *electrical* overload via `I² R`; the thermal consequence is left as user inference.
- **No EMI / RF failure modes.** "This trace radiates like an antenna" needs the EM solver (Stage 8). Out of scope.
- **No wire ampacity check.** PCB traces and hookup wire have current-carrying limits (AWG-dependent). Could be added when fixtures move to higher currents.
- **No battery overcurrent / internal-resistance limits.** Real batteries sag under heavy load. Could be added when fixtures need it.
- **No switch contact ratings.** When SPDT / multi-pole switches land, contact-current limits become relevant. Out of scope for SPST + closed.
- **No severity classification (warning vs. error).** Sprint 15 reports all violations as errors. Soft warnings (e.g., "approaching 80% of rating") would be useful but need a separate design pass. **New §15 row added in the retro.**
- **No automatic suggested-fix generation.** "Use a 470 Ω resistor instead of 100 Ω" requires solving the inverse problem with a goal. Sprint 15 reports facts; the user picks the fix.
- **No transient (peak) ratings.** Some components have instantaneous peak ratings higher than continuous. DC-only solver means DC-only ratings comparison.
- **No new schema changes.** Rating parameters (`max_forward_current`, `power_rating`, `reverse_breakdown_voltage`) already exist on the relevant fixtures.

---

## Locked toolchain (inherited from Sprints 2-14)

Node 24 + npm + JSON Schema 2020-12 + Ajv 8 + Vitest + Biome 2 + TypeScript 6 strict + mathjs 15.2.0. **No new dev dependencies.**

---

## Deliverables

```
OBJECT-MODEL.md
├── §19 NEW — Failure-mode detection            spec; placed after §18
└── §15 deferred row "Nonlinear iterative DC    partially acknowledged — Sprint 15's
     solver"                                     safety judgment is robust to the
                                                 linear approximation's error

src/
└── failure-detector.ts                         NEW — detectFailures(world, solution): Failure[]

tests/
└── failure-detector.test.ts                    NEW — synthetic + the educational anchor
                                                 circuit's deliberate 3.5× overshoot
```

No schema changes. No fixture changes (the existing fixtures already have the rating parameters Sprint 15 reads).

---

## Sub-commit sequence

| # | Commit | Scope |
|---|---|---|
| **S15-v3-1** | `sprints/sprint-15.md` | This plan. |
| **S15-v3-2** | OBJECT-MODEL.md §19 spec | Failure-mode detection model: Failure shape (code / source / kind / measured / rated / ratio / units / severity), the three Sprint 15 failure codes (led-overloaded / led-reverse-breakdown / resistor-overpower), how the detector consumes the Solution from §18, scope vs Sprint 16+ (Shockley accuracy, thermal, EMI, peak ratings). Partially acknowledges the §15 "Nonlinear iterative DC solver" row — Sprint 15's safety judgment is robust to the linear approximation. |
| **S15-v3-3** | `src/failure-detector.ts` scaffold + LED forward overload | Module skeleton + Failure type + detectFailures entry point. LED forward-overload check (`|I_led| > max_forward_current` → led-overloaded). Synthetic test plus the educational anchor circuit's 70 mA case. |
| **S15-v3-4** | Resistor overpower check | `I² × R > power_rating` → resistor-overpower. Synthetic test. For the educational anchor circuit, 70 mA² × 100 Ω = 0.49 W — likely under a 1/4 W (0.25 W) resistor rating, so this case ALSO triggers (resistor-overpower in addition to led-overloaded). Both Sprint 15 checks fire on the same circuit. |
| **S15-v3-5** | LED reverse-breakdown check | `V_cathode − V_anode > reverse_breakdown_voltage` → led-reverse-breakdown. Synthetic test (reverse-bias the LED). Doesn't fire on the anchor circuit (LED is forward-biased there) — synthetic-only verification. |
| **S15-v3-6** | End-to-end on the educational anchor circuit | The full pipeline: load fixtures → cross-FK → solveDC → detectFailures → assert `led-overloaded` fires with measured 0.070 A, rated 0.020 A, ratio 3.5×. Also asserts `resistor-overpower` (the 0.49 W computed dissipation likely exceeds whatever rating the fixture declares). |
| **S15-v3-7** | Sprint 15 retro | Sub-commit log, lessons, new §15 rows (severity classification, automatic fix suggestion, wire ampacity, battery overcurrent, transient ratings). |

---

## Verification discipline (zero-trust, per Sprint 12-14 pattern)

- **Sign handling for current comparisons.** Per §18.6, branch currents have explicit signs. For LED forward-overload, compare `Math.abs(I_led)` against the rated max — the LED is overloaded whether the current flows + or − through it (though for a fixed-V_F model the LED current is always in the positive direction). For resistor-overpower, `I² × R` is sign-independent. For led-reverse-breakdown, the SIGN of `V_cathode − V_anode` matters (negative means forward-biased = no breakdown to check; positive means reverse-biased and potentially in breakdown).
- **Rating-parameter parsing is defensive.** A fixture missing the relevant rating parameter (e.g., an LED without `max_forward_current` declared) skips that check silently — the absence isn't itself a failure. A future "incomplete-rating" §15 row could catch missing ratings; Sprint 15 isn't trying to enforce ratings discipline.
- **Educational anchor circuit fires the expected failures.** With 70 mA through a 20 mA LED, `led-overloaded` must fire with `measured: 0.07`, `rated: 0.02`, `ratio: 3.5`. With 0.49 W in a likely-1/4 W resistor, `resistor-overpower` must also fire. Both expectations encoded as explicit assertions; the test documents the cross-stage chain that's been the project's headline since Sprint 12.
- **By-hand math for synthetic test cases.** Each Sprint 15 unit test has the expected values computed by hand and documented in the test comment.
- **Linear vs. Shockley accuracy notes.** Each Sprint 15 failure check's spec entry notes whether the linear-vs.-exponential current difference could move the result across the rating threshold. For the LED at 3.5× overshoot it doesn't. For borderline cases that *would* move (e.g., 1.1× overshoot in the linear model that's actually 0.95× under Shockley), the Shockley sprint is the right fix — Sprint 15 documents the limitation.
- **All three gates green** (`npm test`, `npx tsc --noEmit`, `npx biome check .`) before each sub-commit.
- **YAML colon gotcha** — defensive double-quoting on any description with a colon (consistent record since Sprint 8).

---

## Done criteria

- [ ] OBJECT-MODEL.md §19 lands with the failure-mode detection model spec
- [ ] §15 "Nonlinear iterative DC solver" row partially acknowledged (Sprint 15's safety judgment is robust)
- [ ] `src/failure-detector.ts` exports `detectFailures(world: World, solution: Solution): Failure[]`
- [ ] Three failure codes implemented: `led-overloaded`, `led-reverse-breakdown`, `resistor-overpower`
- [ ] Synthetic unit tests for each failure code
- [ ] End-to-end test on the educational anchor circuit fires `led-overloaded` with the expected 0.070 A / 0.020 A / 3.5× values
- [ ] All tests pass (count grows from 175; expect ~195-210 at close)
- [ ] `npx tsc --noEmit` clean
- [ ] `npx biome check .` clean
- [ ] Sprint retro written
- [ ] At least 3 new §15 rows added (severity classification, automatic fix suggestion, additional failure modes like wire ampacity)

---

## Risks called out

1. **Rating-parameter naming convention.** Sprint 15 hardcodes lookups by parameter name (`max_forward_current`, `power_rating`, `reverse_breakdown_voltage`). If a future device declares its rating under a different name, the check silently skips. Mitigation: document the canonical names in §19; future schema work can validate ratings have canonical names.
2. **Resistor power_rating may not be on the existing fixture.** Looking at `instance-resistor-001.yaml`, the resistor has parameters for resistance and tolerance, but **may not declare `power_rating`**. If absent, `resistor-overpower` skips silently — which means the end-to-end test only fires `led-overloaded`. This is OK; the test should assert the LED check fires regardless, and optionally check the resistor power if the parameter is declared.
3. **Battery internal resistance might cause the 70 mA result to be slightly different.** The battery declares 1 Ω internal resistance per its notes. Sprint 14's solver doesn't currently model this (treats the battery as ideal). If it modeled internal resistance, the current would be (9) / (100 + 1) = 89 mA instead of 90 mA. For the anchor circuit (which has a LED forcing V_F = 2 V), the math becomes (9 - 2) / (100 + 1) = 69.3 mA instead of 70 mA. Either way, 3.5× overshoot stands. Not a Sprint 15 issue, but a note for future accuracy work.
4. **Sign convention for reverse-breakdown is subtle.** A reverse-biased LED has V_anode < V_cathode (negative V across the LED). The `reverse_breakdown_voltage` parameter is conventionally given as a positive number (e.g., 5 V). The check is `(V_cathode − V_anode) > reverse_breakdown_voltage`. Document this in the spec; explicit example in tests.

---

## Open questions deferred to later sprints

Carried forward from Sprint 14 close + new from Sprint 15 design:

- Default-resolution path, `property_definition` registry, multi-version definitions, cross-pack dependencies, schema migration
- Stackup model, preset/template model, visual symbol library, auto-created interface UX, right-click parameter override UX, keybindings settings page
- Alloy composition-by-weight, `min_count` enforcement, AV chains
- Trigger taxonomy enum, multi-pole switches, state-dependent behavior gating
- Schottky junction promotion
- White LED, heterostructure / QW active-layer modeling, laser diodes
- Parametric equation evaluation (`input_variable`)
- Device-level defaults-vs-rating check, geometry properties on shape definitions
- Terminal-name validation, bus / hierarchical / sub-net model, net-level Active Variables
- Nonlinear iterative DC solver (Shockley + Newton-Raphson + pnjlim — still deferred; Sprint 15's safety judgment doesn't require it)
- Switch state-machine integration, transient simulation, wire resistance modeling (Sprint 14 retro)
- **NEW from Sprint 15 design:** Severity classification (warning vs. error vs. info — soft thresholds like "approaching 80% of rating"); Automatic fix suggestion (inverse problem — "what resistor value would work?"); Wire ampacity check; Battery overcurrent / internal-resistance modeling; Switch contact ratings; Transient (peak) ratings; Thermal failure modes (needs thermal model — Stage 7); EMI failure modes (needs EM solver — Stage 8)

Background-knowledge claims still flagged for verification:
- IEC 62471 risk-group classifications
- SPICE LED diode-model specifics (becomes load-bearing when Shockley + Newton-Raphson actually lands)
- KiCad single-LED-symbol count

---

## Sprint 15 opens here

Master tip when opened: `945cb77` (post-Sprint-14 close — DC solver MVP shipped). The 175 tests from Sprint 14 close are the floor; expect ~195-210 when Sprint 15 closes (~5-8 failure-detector unit tests + the educational anchor circuit end-to-end + a few edge-case + missing-rating tests).

**Why this sprint matters:** Sprint 14 made the solver compute "what does the circuit do?" — Sprint 15 makes ChipBlocks compute "is that safe?". These two together are the headline value of an electronics design tool: tell me what's happening and tell me when something's wrong. The 70 mA / 20 mA case has been the cross-sprint contract since Sprint 12; Sprint 15 closes the loop.

Trigger to begin: user approval of this plan.
