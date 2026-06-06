# v3 Sprint 16 — Nonlinear DC solver (Shockley + Newton-Raphson + pnjlim)

> **Status:** Sprint plan, opened 2026-06-06 against master tip `5ee8989`.
> **Predecessor:** Sprint 15 closed failure-mode detection — the cross-sprint contract fires (`led-overloaded` at 3.5× on the anchor circuit). 201 tests, §19 spec, `src/failure-detector.ts`. Sprint 15's safety judgment used Sprint 14's fixed-V_F LED approximation and was honest about the limitation (§19.7).
> **Scope:** Replace the fixed-V_F LED model with the real **Shockley diode equation** solved via **Newton-Raphson iteration** with the **pnjlim** convergence aid. This is the accuracy upgrade deferred since Sprint 14 — the §15 "Nonlinear iterative DC solver" row. Closes that row.

---

## Sprint 16 goal in plain English

Sprint 14's solver treats an LED as a fixed 2.0 V drop no matter how much current flows. Real LEDs don't work that way — the voltage rises (slowly) as current increases, following an exponential curve (the Shockley equation). Sprint 16 implements the real curve.

The concrete result: the educational anchor circuit's LED current moves from the fixed-V_F approximation's **70.00 mA** to the physically-accurate **69.36 mA** (the LED settles at 2.064 V, not 2.0 V, at that current). The difference is small — about 0.9% — which is exactly why Sprint 15's safety judgment was robust: the `led-overloaded` failure still fires at 3.47× (vs 3.50×). Sprint 16 makes ChipBlocks **right for the right reason**.

The harder, deferred cases — circuits operating *near* a rating threshold where linear-vs-exponential disagreement flips the safety verdict — are now correctly handled.

---

## The physics (to be verified against canonical sources in S16-v3-2)

**Shockley diode equation:**

> I = I_s × (exp(V / (n · V_T)) − 1)

- `I_s` — reverse saturation current (derived per-LED, see below)
- `V` — voltage across the diode (anode − cathode)
- `n` — ideality factor (1 for ideal; ~1.5–2 for LEDs due to wide-bandgap recombination). New optional parameter, default 2.0.
- `V_T` — thermal voltage = kT/q ≈ **25.852 mV at 300 K** (verified: k = 1.380649e-23 J/K, q = 1.602176634e-19 C, both NIST CODATA exact)

**Deriving I_s from existing parameters.** Real LED datasheets give a forward voltage at a rated current, not I_s directly. ChipBlocks derives I_s from the LED's existing `forward_voltage` + `max_forward_current` (the calibration point) plus the ideality factor:

> I_s = I_F / (exp(V_F / (n · V_T)) − 1)

For led_001 (V_F = 2.0 V, I_F = 20 mA, n = 2): I_s ≈ 3.18e-19 A — physically reasonable for an LED.

**Newton-Raphson companion model.** The exponential is nonlinear, so it can't be stamped directly into the linear MNA matrix. At each iteration, the diode is linearized around its current guess voltage V_k into an equivalent conductance + current source:

> G_eq = dI/dV = (I_s / (n · V_T)) × exp(V_k / (n · V_T))
> I_eq = I(V_k) − G_eq × V_k

The diode stamps as G_eq (into the conductance matrix, like a resistor) in parallel with I_eq (into the source vector, like a current source). Then the linear system solves, producing new node voltages → new V_k → repeat.

**pnjlim convergence aid.** Without limiting, V_k can jump far enough that exp(V/(n·V_T)) overflows to Infinity. The SPICE pnjlim algorithm caps the per-iteration voltage change in the diode's steep region. Exact algorithm to be verified against canonical source (Qucs / ngspice / IEEE EMC "How SPICE Works") in S16-v3-2.

**Convergence criterion:** iterate until every diode's |V_k − V_{k−1}| < vntol (e.g., 1e-6 V) AND the current residual is small, or a max-iteration cap (e.g., 100) is hit → honest `did-not-converge` status.

---

## After this sprint

1. New module: `src/diode-model.ts` — pure functions: `thermalVoltage(T)`, `deriveSaturationCurrent(V_F, I_F, n, V_T)`, `diodeCurrent(V, I_s, n, V_T)`, `diodeConductance(V, I_s, n, V_T)`, `companionModel(V, I_s, n, V_T) → {G_eq, I_eq}`, `pnjlim(V_new, V_old, n, V_T, I_s) → V_limited`.
2. **Newton-Raphson loop** wrapped around the existing linear MNA solve in `dc-solver.ts`. For circuits with no nonlinear elements, the linear fast-path is preserved (keeps Sprint 14's non-LED tests exact, and is faster).
3. **LED stamp changes** from fixed-V_F-voltage-source to Shockley-companion-model (conductance + current source). LEDs no longer consume an auxiliary current variable; they stamp like a resistor-with-a-current-source. Branch current is recomputed from the diode equation at the converged voltage.
4. **New optional parameter `ideality_factor`** on the LED device (default 2.0). Existing fixtures don't need it; it can be added per-instance for accuracy.
5. **Solution gains `iterations` + `converged` fields** (informational — how many NR iterations the solve took). New status value `did-not-converge`.
6. **OBJECT-MODEL.md §20** — nonlinear DC solver spec. Closes the §15 "Nonlinear iterative DC solver" row.
7. **The anchor-circuit result updates** from 70.00 mA to 69.36 mA across the affected Sprint 14 + Sprint 15 end-to-end tests — the accuracy upgrade made visible. `led-overloaded` still fires (3.47×).
8. **Ground reference port** — an explicit ground marker you place and wire to a net to designate it as the 0 V reference, using the standard schematic ground symbol (IEC 60617 / IEEE 315). Makes ground designation explicit and EDA-authentic (like dropping a GND symbol in KiCad) instead of relying on the abstract net `type: ground` tag. **Honest framing per the anti-placeholder rules:** ground is NOT a physical component (in real hardware it's a net — a copper pour/plane or chosen reference node), so the ground port is modeled as a **reference / connection-point marker**, not a fake primitive device with invented material properties. This fits CLAUDE.md's "external connection point, not a block" framing. The solver's ground detection (§18.2) gains a new precedence: a ground port's net wins; `type: ground` stays a backward-compatible fallback.

---

## Non-goals (explicit, with reasons)

- **No transistor models (BJT / MOSFET).** Diodes + LEDs only. Transistors are nonlinear too (Ebers-Moll, BSIM) but are a much larger modeling effort — their own multi-sprint arc. The diode companion-model machinery built here is the foundation they'll reuse.
- **No temperature dependence of V_T.** Fixed at 300 K (25.852 mV). Temperature sweep / self-heating is future work and pairs with the thermal solver (Stage 7). The `thermalVoltage(T)` function takes T as a parameter so the hook exists, but Sprint 16 always passes 300 K.
- **No advanced convergence aids (GMIN stepping, source stepping).** pnjlim handles the diode steep-region overflow, which covers the anchor circuit and typical hobby circuits. Pathological circuits that pnjlim can't converge return an honest `did-not-converge` status rather than a wrong answer. GMIN/source stepping is a §15 row for when a real circuit needs it.
- **No transient simulation.** DC operating point only, same as Sprint 14. The nonlinear solve finds the steady-state operating point; transient (Stage 5) is far out.
- **No automatic ideality-factor extraction.** Default 2.0 (typical for LEDs); optional per-instance parameter. Extracting n from a two-point datasheet measurement is future refinement.
- **No reverse-breakdown modeling in the curve.** The Shockley equation models forward + weak reverse (the −1 term gives −I_s in reverse). Avalanche breakdown at the rated reverse voltage is a separate regime; the §19 `led-reverse-breakdown` check (Sprint 15) already flags reverse-voltage violations structurally. Sprint 16 doesn't model the avalanche I-V curve.
- **No change to the failure detector.** It consumes branch currents; the Shockley currents flow into the existing §19 checks unchanged. Only the end-to-end test expectations shift (70 → 69.36 mA).

---

## Locked toolchain (inherited from Sprints 2-15)

Node 24 + npm + JSON Schema 2020-12 + Ajv 8 + Vitest + Biome 2 + TypeScript 6 strict + mathjs 15.2.0. **No new dev dependencies** — mathjs provides `exp`, `log`, and the linear-algebra ops already used by the Sprint 14 solver.

---

## Deliverables

```
OBJECT-MODEL.md
├── §20 NEW — Nonlinear DC solver               spec; placed after §19
├── §18.2 amendment — ground-detection          ground-port precedence + type:ground fallback
│    precedence
└── §15 deferred row "Nonlinear iterative        ✅ CLOSED — pointer to §20
     DC solver"

src/
├── diode-model.ts                              NEW — Shockley + companion model + pnjlim
├── dc-solver.ts                                EXTENDED — Newton-Raphson loop + LED companion
│                                               stamp + ground-port detection
└── cross-fk-validator.ts                       EXTENDED — recognize ground port kind (if needed)

tests/
├── diode-model.test.ts                         NEW — physics unit tests (verified by hand)
├── dc-solver.test.ts                           EXTENDED — NR convergence + anchor-circuit 69.36 mA
│                                               + ground-port detection precedence
└── (schema/cross-fk tests)                     EXTENDED — ground port fixture validates

fixtures/valid/
├── device-led.yaml                             ideality_factor parameter declared (optional)
├── device-ground.yaml                          NEW — ground reference port (connection-point marker)
├── instance-ground-001.yaml                    NEW — ground port wired to net_battery_neg
└── net-battery-neg.yaml                        UPDATED — membership gains the ground port
```

---

## Sub-commit sequence

| # | Commit | Scope |
|---|---|---|
| **S16-v3-1** | `sprints/sprint-16.md` | This plan. |
| **S16-v3-2** | OBJECT-MODEL.md §20 spec + physics verification | Full nonlinear-solver spec: Shockley equation, V_T derivation, I_s derivation from (V_F, I_F, n), Newton-Raphson companion model (G_eq, I_eq), pnjlim algorithm, convergence criteria, did-not-converge handling, linear fast-path. **Zero-trust physics verification** against canonical sources (Qucs technical docs / ngspice / IEEE EMC "How SPICE Works") — the Shockley equation, the companion-model formulas, and especially the exact pnjlim algorithm get verified before any code. Closes the §15 row with a §20 pointer. |
| **S16-v3-3** | `src/diode-model.ts` + physics unit tests | Pure functions: thermalVoltage, deriveSaturationCurrent, diodeCurrent, diodeConductance, companionModel, pnjlim. Each unit-tested with by-hand-computed expected values (V_T = 25.852 mV; I_s ≈ 3.18e-19 A for led_001's calibration; companion model at a known voltage). pnjlim tested for the overflow-prevention case (a large voltage jump gets limited). |
| **S16-v3-4** | Newton-Raphson loop in dc-solver | Wrap the linear MNA solve in an NR iteration. Pre-pass detects nonlinear elements (LEDs); if none, linear fast-path (Sprint 14 behavior preserved exactly). If present, NR loop: init diode voltages (warm start at forward_voltage) → stamp companion models → solve → update voltages with pnjlim → check convergence → repeat to convergence or max-iter. New Solution fields: iterations, converged; new status did-not-converge. Synthetic test: a simple diode+resistor circuit converges to the hand-computed operating point. |
| **S16-v3-5** | LED companion stamp + branch current + anchor-circuit update | Replace the fixed-V_F LED stamp with the companion-model stamp (conductance + current source, no aux variable). Recompute LED branch current from the diode equation at the converged voltage. **Update the affected end-to-end tests:** dc-solver anchor-circuit test 70.00 → 69.36 mA, LED node 2.0 → 2.064 V; failure-detector anchor-circuit test measured ≈ 0.0694, ratio ≈ 3.47 (still fires led-overloaded). Add `ideality_factor` to device-led.yaml. |
| **S16-v3-6** | Ground reference port + §18.2 amendment | New `ground` reference marker — a one-terminal connection-point object (NOT a fake physical primitive device — see honest framing in deliverable 8) that designates its connected net as the 0 V reference, carrying the standard schematic ground symbol id. OBJECT-MODEL.md §18.2 amended: ground-detection precedence becomes (1) `SolveOptions.ground` override → (2) net connected to a ground port → (3) net with `type: ground` (backward-compat fallback) → (4) no-ground. Add a ground port to the educational anchor circuit (connected to net_battery_neg, which already has `type: ground` — the two agree). Update net_battery_neg membership + the ground port's connects (bidirectional consistency holds). Solver + cross-FK tests for the new precedence. SCHEMATIC-SYMBOLS.md note on the ground symbol. |
| **S16-v3-7** | Sprint 16 retro + §15 closure | Sub-commit log, lessons, formal closure of the §15 "Nonlinear iterative DC solver" row (→ §20), new §15 rows (transistor nonlinear models, temperature-dependent V_T, GMIN/source stepping, dedicated rated-current parameter for I_s calibration, power-port family beyond ground — Vcc/Vdd rails). |

---

## Verification discipline (zero-trust, per Sprint 12-15 pattern)

- **Physics verified against canonical sources BEFORE code (S16-v3-2).** The Shockley equation, thermal voltage, companion-model formulas, and pnjlim algorithm each get checked against Qucs technical docs / ngspice source / IEEE EMC "How SPICE Works." CLAUDE.md already records a 2026-06-05 verification of the overall approach; Sprint 16 re-verifies the specific formulas it implements. pnjlim especially — it's a precise SPICE algorithm, easy to get subtly wrong.
- **By-hand operating-point math for every solver test.** The anchor-circuit Shockley result (69.36 mA, 2.064 V) was computed independently during planning via Newton's method on the KVL equation. Solver output must match within tolerance.
- **Convergence is real, not assumed.** Tests assert the NR loop actually converges (converged: true, iterations within a sane bound) — not just that it returns a number. A test with a deliberately hard circuit verifies did-not-converge fires honestly rather than returning a wrong answer.
- **pnjlim overflow prevention tested directly.** A unit test feeds pnjlim a voltage jump large enough to overflow exp() unlimited, and asserts the limited voltage keeps exp() finite.
- **The linear fast-path preserves Sprint 14 exactly.** Circuits with no nonlinear elements must produce identical results to Sprint 14 (the battery+resistor tests, etc. — unchanged). Only LED circuits get the NR treatment.
- **§19.7's claim confirmed.** Sprint 15 said the linear approximation's error doesn't change the safety verdict at meaningful overshoots. Sprint 16 proves it: 70.00 → 69.36 mA, led-overloaded still fires at 3.47×. The test that asserts this is the concrete validation of the cross-sprint accuracy claim.
- **All three gates green** before each sub-commit. No NUL-byte cruft (Sprint 13 lesson). Mid-Sprint check before the code-heavy commits.

---

## Done criteria

- [ ] OBJECT-MODEL.md §20 lands with the full nonlinear-solver spec + verified physics
- [ ] §15 "Nonlinear iterative DC solver" row marked ✅ CLOSED with §20 pointer
- [ ] `src/diode-model.ts` exports the Shockley + companion-model + pnjlim functions, each unit-tested against by-hand values
- [ ] `dc-solver.ts` runs Newton-Raphson for circuits with LEDs; linear fast-path for circuits without
- [ ] pnjlim prevents exp() overflow (tested directly)
- [ ] The anchor circuit converges to 69.36 mA / 2.064 V (matching by-hand math)
- [ ] `led-overloaded` still fires on the anchor circuit at ~3.47× (failure detector unchanged, end-to-end test updated)
- [ ] Sprint 14's non-LED tests unchanged (linear fast-path preserved)
- [ ] `did-not-converge` status returned honestly for non-converging circuits
- [ ] All tests pass (count grows from 201; expect ~220-235 at close)
- [ ] `npx tsc --noEmit` clean
- [ ] `npx biome check .` clean
- [ ] Sprint retro written
- [ ] New §15 rows added (transistor models, temperature-dependent V_T, GMIN/source stepping, rated-current calibration parameter)

---

## Risks called out

1. **pnjlim is a precise algorithm that's easy to get subtly wrong.** The SPICE pnjlim has specific branches (V_crit threshold, the log-limiting formula). Getting it slightly wrong can cause non-convergence or wrong answers that *look* plausible. Mitigation: verify against a canonical source in S16-v3-2; test the overflow-prevention case directly; cross-check the anchor-circuit result against the by-hand 69.36 mA.
2. **Newton-Raphson may not converge for some circuits.** Nonlinear solving can oscillate or diverge. Mitigation: max-iteration cap + honest did-not-converge status. The anchor circuit (single LED, well-behaved) converges fast; the risk is for future complex circuits, which return did-not-converge rather than a wrong number.
3. **The LED stamp change ripples into branch-current extraction.** Fixed-V_F LEDs got their current from the aux variable; Shockley LEDs compute it from the diode equation. The solver's branch-current code needs a per-element-type path. Mitigation: the companion-model approach is standard; tested against the hand-computed 69.36 mA.
4. **I_s calibration point ambiguity.** Deriving I_s from (forward_voltage, max_forward_current) assumes V_F is specified *at* max_forward_current. For led_001 (5 mm red, V_F = 2.0 V typically @ 20 mA) this holds, but it's not universally true. Mitigation: document the assumption in §20; add a §15 row for a dedicated "rated current at which V_F is specified" parameter. The small error this introduces doesn't change the qualitative result.
5. **Two existing end-to-end tests change their expected values.** Sprint 14's dc-solver anchor test (70 mA) and Sprint 15's failure-detector anchor test (0.07 A) update to the Shockley values. This is correct (accuracy upgrade) but must be done deliberately, not silently — the commit message explains the change and the by-hand math justifies the new numbers. NOT a regression; an accuracy improvement made visible.
6. **Floating-point conditioning near the exponential.** G_eq can be very large (steep diode), making the matrix stiff. Mitigation: pnjlim keeps voltages in a sane range; if conditioning becomes an issue, GMIN (a tiny parallel conductance) is the standard fix — noted as a §15 row if needed.

---

## Open questions deferred to later sprints

Carried forward from Sprint 15 close + new from Sprint 16 design:

- Default-resolution path, `property_definition` registry, multi-version definitions, cross-pack dependencies, schema migration
- Stackup model, preset/template model, visual symbol library, auto-created interface UX, right-click parameter override UX, keybindings settings page
- Alloy composition-by-weight, `min_count` enforcement, AV chains
- Trigger taxonomy enum, multi-pole switches, state-dependent behavior gating
- Schottky junction promotion
- White LED, heterostructure / QW active-layer modeling, laser diodes
- Parametric equation evaluation (`input_variable`) — natural caller is the solver; pairs with temperature-dependent V_T
- Device-level defaults-vs-rating check, geometry properties on shape definitions
- Terminal-name validation, bus / hierarchical / sub-net model, net-level Active Variables
- Switch state-machine integration, transient simulation, wire resistance modeling
- Failure severity classification, automatic fix suggestion, additional electrical failure modes, transient peak ratings
- **NEW from Sprint 16 design:** transistor nonlinear models (BJT Ebers-Moll, MOSFET — reuse the companion-model machinery); temperature-dependent V_T (pairs with thermal solver Stage 7); GMIN stepping / source stepping (hard-convergence aids beyond pnjlim); dedicated rated-current parameter for I_s calibration (decouple V_F's calibration current from max_forward_current)

Background-knowledge claims still flagged for verification:
- IEC 62471 risk-group classifications
- SPICE LED diode-model specifics (**now load-bearing — verified in S16-v3-2**)
- KiCad single-LED-symbol count

---

## Sprint 16 opens here

Master tip when opened: `5ee8989` (post-Sprint-15 close + verification). The 201 tests from Sprint 15 close are the floor; expect ~220-235 when Sprint 16 closes (~10-15 diode-model physics tests + NR convergence tests + the updated anchor-circuit end-to-end + did-not-converge edge case).

**Why this sprint matters:** Sprint 14 made the solver compute circuit behavior with a useful approximation; Sprint 16 makes it *physically accurate*. The LED I-V curve is the first real nonlinearity ChipBlocks models, and the companion-model + Newton-Raphson + pnjlim machinery is the foundation every future nonlinear device (transistors, more diode types) will reuse. It also closes the loop on Sprint 15's honesty: the linear approximation was good enough for the safety verdict, and now we can prove it.

Trigger to begin: user approval of this plan.
