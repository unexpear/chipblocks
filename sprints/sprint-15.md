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
| **S15-v3-4** | Resistor overpower check | `I² × R > power_rating` → resistor-overpower. **Synthetic test only** — on the educational anchor circuit, 70 mA² × 100 Ω = 0.49 W, which is well under `resistor_001`'s declared `power_rating: 5 W` (10.2× headroom), so the check runs but does NOT fire there. The synthetic test uses an undersized resistor (e.g., 0.49 W in a 1/4 W part) to verify the check trips correctly. |
| **S15-v3-5** | LED reverse-breakdown check | `V_cathode − V_anode > reverse_breakdown_voltage` → led-reverse-breakdown. Synthetic test (reverse-bias the LED). Doesn't fire on the anchor circuit (LED is forward-biased there) — synthetic-only verification. |
| **S15-v3-6** | End-to-end on the educational anchor circuit | The full pipeline: load fixtures → cross-FK → solveDC → detectFailures → assert `led-overloaded` fires with measured 0.070 A, rated 0.020 A, ratio 3.5×. Also asserts that EXACTLY ONE failure fires — `resistor-overpower` does NOT fire (0.49 W << 5 W rating) and `led-reverse-breakdown` does NOT fire (LED forward-biased). The detector correctly stays silent about the safely-operating resistor. |
| **S15-v3-7** | Sprint 15 retro | Sub-commit log, lessons, new §15 rows (severity classification, automatic fix suggestion, wire ampacity, battery overcurrent, transient ratings). |

---

## Verification discipline (zero-trust, per Sprint 12-14 pattern)

- **Sign handling for current comparisons.** Per §18.6, branch currents have explicit signs. For LED forward-overload, compare `Math.abs(I_led)` against the rated max — the LED is overloaded whether the current flows + or − through it (though for a fixed-V_F model the LED current is always in the positive direction). For resistor-overpower, `I² × R` is sign-independent. For led-reverse-breakdown, the SIGN of `V_cathode − V_anode` matters (negative means forward-biased = no breakdown to check; positive means reverse-biased and potentially in breakdown).
- **Rating-parameter parsing is defensive.** A fixture missing the relevant rating parameter (e.g., an LED without `max_forward_current` declared) skips that check silently — the absence isn't itself a failure. A future "incomplete-rating" §15 row could catch missing ratings; Sprint 15 isn't trying to enforce ratings discipline.
- **Educational anchor circuit fires exactly one failure.** With 70 mA through a 20 mA LED, `led-overloaded` must fire with `measured: 0.07`, `rated: 0.02`, `ratio: 3.5`. The resistor dissipates 0.49 W in a 5 W part (declared on `instance-resistor-001.yaml`) so `resistor-overpower` does NOT fire — verified against the actual fixture value, not assumed. `led-reverse-breakdown` does NOT fire (LED forward-biased). The test asserts both the one firing failure AND the absence of the other two; this documents the cross-stage chain that's been the project's headline since Sprint 12 while keeping the detector honest about the safely-operating resistor.
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
2. **Resistor power_rating is generous on the existing fixture (RESOLVED during planning).** Verified directly: `instance-resistor-001.yaml` declares `power_rating: 5 W`. The anchor circuit dissipates only 0.49 W in it (10.2× headroom), so `resistor-overpower` runs but does NOT fire. This is why S15-v3-4's resistor test is synthetic-only — the real fixture's resistor is correctly sized. The end-to-end test (S15-v3-6) asserts exactly one failure (`led-overloaded`) and the absence of `resistor-overpower`. (Earlier plan drafts speculated a 1/4 W rating; the actual value was confirmed against the fixture before any code was written.)
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

---

## Sprint 15 retro (closed 2026-06-06)

### What landed

| Sub-commit | What |
|---|---|
| `c9a0c98` | S15-v3-1: Sprint 15 plan opened |
| `d29e418` | S15-v3-2: OBJECT-MODEL.md §19 — failure-mode detection spec |
| `73fb23e` | (correction) S15 docs: resistor-overpower claim fixed — anchor circuit fires ONE failure, not two (mid-Sprint check caught the wrong power_rating speculation) |
| `4d24aa3` | S15-v3-3: `src/failure-detector.ts` scaffold + `led-overloaded` — **the cross-sprint contract fires** |
| `8d2da62` | S15-v3-4: `resistor-overpower` — synthetic-fires; anchor circuit correctly silent (10.2× headroom) |
| `2548cdc` | (refactor) extract `readScalarParam` to shared `src/instance-params.ts` (was duplicated in dc-solver + failure-detector) |
| `fe44c25` | S15-v3-5: `led-reverse-breakdown` — the sign-dependent, node-voltage check |
| `b21f49f` | S15-v3-6: consolidated contract test + multi-failure synthetic + empty-world edge case |
| (this) | S15-v3-7: retro + new §15 rows — Sprint 15 closes |

### Done criteria — all met

- [x] OBJECT-MODEL.md §19 lands with the failure-mode detection model spec (11 subsections)
- [x] §15 "Nonlinear iterative DC solver" row acknowledged (Sprint 15's safety judgment is robust to the linear approximation at meaningful overshoots — §19.7) but NOT closed (the row stays open for borderline cases)
- [x] `src/failure-detector.ts` exports `detectFailures(world, solution): Failure[]`
- [x] Three failure codes implemented + unit-tested: `led-overloaded`, `led-reverse-breakdown`, `resistor-overpower`
- [x] Synthetic unit tests for each failure code (fires + silent-within-rating + silent-at-boundary + silent-when-rating-missing + silent-when-value-missing)
- [x] End-to-end test on the educational anchor circuit fires `led-overloaded` with the expected 0.070 A / 0.020 A / 3.5× values
- [x] All tests pass — **201** (up from 175 at Sprint 14 close, ~15% growth)
- [x] `npx tsc --noEmit` clean
- [x] `npx biome check .` clean (after one auto-format pass in S15-v3-3)
- [x] Sprint retro written
- [x] New §15 rows added (severity classification, automatic fix suggestion, wire ampacity + battery overcurrent + switch contact ratings, transient peak ratings)

### Catalog after Sprint 15

| | Sprint 14 close | Sprint 15 close |
|---|---|---|
| Material / Shape / Behavior / Interface / Device / Instance / AV / Net | (unchanged) | (unchanged) |
| Schemas | 8 | (unchanged — no schema changes) |
| Object kinds with own schema | 5 | (unchanged) |
| Cross-FK error codes | 11 | (unchanged) |
| **Source modules** | 2 (`cross-fk-validator`, `dc-solver`) | **4** (+ `failure-detector`, + `instance-params` shared helper) |
| **Catalog spec sections** | 18 | **19** (+ §19 failure-mode detection) |
| **Failure codes** | 0 | **3** (led-overloaded / resistor-overpower / led-reverse-breakdown) |
| **Tests** | 175 | **201** (~15% growth) |
| **What ChipBlocks answers** | "what does the circuit do?" (§18) | "+ **is that safe?**" (§19) — flags overloaded LEDs, overpowered resistors, reverse-breakdown |

### Lessons surfaced

1. **The mid-Sprint check caught a real error before any code was written.** The §19 spec + plan both speculated the anchor circuit's resistor would trip `resistor-overpower`. Verifying against the actual fixture (`power_rating: 5 W`, not the assumed 1/4 W) showed it does NOT — the resistor has 10.2× headroom. Had S15-v3-4 and S15-v3-6 been written against the wrong speculation, the tests would have asserted a failure that never fires. **General lesson:** when a spec makes a numerical claim about test data, verify it against the actual data before writing tests. This is the third sprint running where the mid-Sprint check caught something (Sprint 12 path-syntax, Sprint 13 bidirectional, Sprint 15 power_rating).

2. **The corrected result is the better story.** "Exactly one failure fires — the overloaded LED — and the detector correctly stays silent about the safely-operating resistor" is a stronger demonstration than "two things are broken." A failure detector that cried wolf about a correctly-sized component would be worse than useless. The honest result showcases the detector's precision.

3. **Three failure checks, three different data sources.** `led-overloaded` reads branch current; `resistor-overpower` reads branch current + resistance (computes I²R); `led-reverse-breakdown` reads two node voltages. Implementing all three surfaced that the detector needs both halves of the Solution (`branches` AND `nodes`) and needs to walk instance connects to map terminals to nets. The §18 Solution shape had everything required — no solver changes needed.

4. **Missing ratings skip, they don't fail (the §19.8 honesty rule).** Every check returns null when its rating parameter is absent — the rating is "unknown," not "infinite," and not a failure. This matches the anti-placeholder principle: don't pretend to know what we don't know. A future "incomplete-rating" check could flag missing ratings as a separate concern, but conflating "no rating declared" with "rating exceeded" would be dishonest.

5. **The refactor mid-Sprint kept the code clean without over-engineering.** `readScalarParam` crossed the duplication threshold (2 files) in S15-v3-3. The verification pass flagged it; extracting to `instance-params.ts` was a clean mechanical win with zero behavior change. Doing it as a dedicated refactor commit (not folded into a feature commit) kept the history honest about what changed.

6. **Sprint 15 delivered the user's longest-standing ask.** Since Sprint 12, the user has wanted ChipBlocks to "catch the LED overloading and exploding." Sprint 15 is where that became a real error code firing end-to-end from catalog YAML. The 70 mA / 20 mA case has been the cross-sprint contract across four sprints (12 equation values → 13 nets → 14 solver → 15 detection); it now closes with a structured `led-overloaded` Failure. **General lesson:** a long-horizon feature delivered through composable foundation sprints lands more solidly than one rushed through — each layer was independently tested before the next consumed it.

### New §15 rows added in this retro

Four new deferred questions added to OBJECT-MODEL.md §15 alongside this retro:

- **Failure severity classification (warning / error / info).** Sprint 15 reports all violations as `severity: 'error'`. A richer model would distinguish soft thresholds (e.g., "approaching 80% of rating" = warning, "over rating" = error, "informational note" = info). Needs a design pass on the threshold model + how the UI surfaces each tier. Lands when the canvas needs to color-code failures by severity.
- **Automatic fix suggestion.** Sprint 15 reports facts ("70 mA exceeds 20 mA"); it doesn't suggest "use a 470 Ω resistor instead." That's an inverse problem — solve for the component value that brings the circuit within ratings, given a goal. Separate sprint; pairs naturally with an interactive canvas where the user can accept a suggested fix.
- **Additional electrical failure modes (wire ampacity, battery overcurrent, switch contact ratings).** Straightforward extensions of the same pattern (read computed value, compare to rating, fire). Each lands when fixtures move into the relevant regime — high-current traces for ampacity, heavy loads for battery sag, multi-pole switches for contact ratings.
- **Transient (peak) ratings.** Some components have instantaneous peak ratings higher than their continuous ratings (e.g., a 100 ms surge current). A DC solver computes only the operating point, so only continuous (DC) ratings can be checked. Transient peak ratings need transient simulation (Stage 5 of the sim arc) and land with it.

### Unresolved questions (still deferred per OBJECT-MODEL.md §15)

Carried forward from prior sprints + 4 new from Sprint 15 retro:

- Default-resolution path, `property_definition` registry, multi-version definitions, cross-pack dependencies, schema migration
- Stackup model, preset/template model, visual symbol library, auto-created interface UX, right-click parameter override UX, keybindings settings page
- Alloy composition-by-weight, `min_count` enforcement, AV chains
- Trigger taxonomy enum, multi-pole switches, state-dependent behavior gating
- Schottky junction promotion
- White LED, heterostructure / QW active-layer modeling, laser diodes
- Parametric equation evaluation (`input_variable`), device-level defaults-vs-rating check, geometry properties on shape definitions
- Terminal-name validation, bus / hierarchical / sub-net model, net-level Active Variables
- Nonlinear iterative DC solver (Shockley + Newton-Raphson + pnjlim — still deferred; Sprint 15's safety judgment is robust without it)
- Switch state-machine integration, transient simulation, wire resistance modeling
- **NEW from Sprint 15 retro:** failure severity classification (warning/error/info); automatic fix suggestion (inverse problem); additional electrical failure modes (wire ampacity, battery overcurrent, switch contact ratings); transient peak ratings

Background-knowledge claims still flagged for verification:
- IEC 62471 risk-group classifications
- SPICE LED diode-model specifics (load-bearing when Shockley + Newton-Raphson lands)
- KiCad single-LED-symbol count

### What this unblocks

After Sprint 15 close:

- **Stage 4 of the simulation+visualization arc is done.** ChipBlocks answers both "what does the circuit do?" (§18) and "is that safe?" (§19). The full pipeline — YAML → cross-FK → solveDC → detectFailures — runs end-to-end and flags the educational anchor circuit's overloaded LED with structured, exact-number failures.
- **The "AI assists, ChipBlocks validates, the user approves" principle is now demonstrable on real physics.** The deterministic engine catches a real safety problem (an LED that would be destroyed) without any AI involvement. This is the project's load-bearing principle made concrete: the engine owns correctness; the failure is computed, cited to exact values, and surfaced for the user to act on.
- **The canvas (a future sprint) has failures to visualize.** When the canvas renders the circuit, it can highlight the overloaded LED in red and show "70 mA — 3.5× over rating." The Failure objects carry every field the UI needs (source, measured, rated, ratio, units, severity).
- **Severity classification + fix suggestion become attractive next steps.** With the detection foundation in place, "warn at 80%, error at 100%" and "suggest a 470 Ω resistor" are natural follow-ups — each a focused sprint consuming the Sprint 15 Failure shape.
- **The Shockley + Newton-Raphson upgrade has a clear trigger.** Sprint 15 documents (§19.7) that the linear approximation is sufficient for meaningful overshoots but not for borderline cases (1.05× linear / 0.98× Shockley). When a fixture lands in that borderline band, the nonlinear solver sprint is the resolution — and the failure-detection layer consumes its more-accurate currents without any change.

### Sprint 15 closed

All sub-commits land cleanly on master. 201 tests pass (71 schema + 12 baseline cross-FK + 3 derives-violates-rating + 3 net cross-FK + 17 net-schema + 23 equation-schema + 20 equation-evaluator + 29 dc-solver + 26 failure-detector). The failure-mode detection layer is formalized, implemented, and integrated end-to-end. **The cross-sprint contract that's been alive since Sprint 12 — catch the LED overloading — is closed.** ChipBlocks now computes circuit behavior AND judges its safety, deterministically, with cited exact values. The user can pick the next direction at the Sprint 15+1 planning conversation: severity classification, the canvas (visualization), Shockley accuracy, more device types, or a different §15 row.
