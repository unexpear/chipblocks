# v3 Sprint 12 — Behavior-derives-value pattern (declare + evaluate + dimension-check + rating-conflict-detect)

> **Status:** Sprint plan, opened 2026-06-05 against master tip `425922a`.
> **Predecessor:** Sprint 11 closed the multi-color LED expansion at 74 tests + the user's "check before behavior-derives-value" trigger fired. Sprint 12 picks up that trigger and adds the formula-declaration pattern that's been queued in §15 since Sprint 6.
> **Scope:** declare formulas like `R = ρ × L / A` on devices/behaviors + evaluate them at validation time + dimensionally check the units + flag where a derived value conflicts with a declared rating on the same device.

---

## Sprint 12 goal in plain English

"Real values come from real physics." Instead of declaring a resistor's resistance as a hardcoded number with provenance pointing at a datasheet, declare HOW the resistance is computed: from the material's resistivity × the wire's length ÷ its cross-section area. ChipBlocks evaluates the formula at validation time, checks the units come out right, and (if a max-rating is also declared) flags whether the computed value violates that rating.

This is foundation-level. It's what makes "real blocks all the way down" actually load-bearing: when a downstream sprint adds the DC solver (Sprint 14+), the solver consumes derived values that already carry their physical justification. Today's sprint locks the pattern; future sprints consume it.

**Formulas are shipped with the catalog by maintainers, NOT authored by end users.** This was the user's explicit clarification ("why would the user be writing a formula") — formulas are part of how ChipBlocks ships physics, not a feature surfaced to the canvas user.

---

## After this sprint

1. A device or behavior can declare a `derives:` block on any quantity-typed property: which other properties / material props / geometry it depends on, the expression to compute it, the output units, and the conditions under which the formula applies.
2. The validator evaluates every `derives:` formula automatically when loading a fixture.
3. Dimensional analysis is automatic: if the formula's output units don't match the property's declared units, validation fails with a clear error.
4. Per-device rating sanity: if a device both `derives:` X and declares `max_X` / `min_X` / `nominal_X` as a rating, the derived value gets compared and violations surface a new error code (`derives-violates-rating`).
5. Three first concrete cases land:
   - **Resistor** — `R = ρ × L / A` (resistivity × length ÷ cross-section area)
   - **LED** — `λ = h × c / E_g` (Planck × speed of light ÷ bandgap energy, the peak-emission wavelength approximation; canonical Planck-Einstein relation)
   - **Capacitor** — `C = ε₀ × ε_r × A / d` (vacuum permittivity × relative permittivity × plate area ÷ plate separation)

---

## Non-goals (explicit)

- **No circuit-level failure detection.** LED overload from upstream current, voltage drops cascading through a divider, etc. need the DC solver (Sprint 14+). Sprint 12's failure detection is **per-device only**: derived value vs declared rating on the same device. Cross-device dynamics deferred.
- **No net model formalization.** `connects:` stays ad-hoc data this sprint. Sprint 13.
- **No DC solver.** Sprint 14.
- **No visualization lenses.** Needs canvas first. Many sprints out.
- **No thermal solver / EMI.** Stages 7-8 of the simulation+visualization arc, much later.
- **No new physics behaviors.** Use existing behaviors; add `derives:` to existing value definitions.
- **No user-authored formulas.** Formulas ship with the catalog by maintainers per OBJECT-MODEL.md axiom + Core principle 1. The end user never types a formula into a canvas.
- **No replacement of all hardcoded values with formulas.** Only the 3 first cases get migrated this sprint. Other devices keep their declared values; future sprints add `derives:` as the physics is captured.

---

## Locked toolchain

Existing: Node 24 + npm + JSON Schema 2020-12 + Ajv 8 + Vitest + Biome 2 + TypeScript 6 strict.

**New dependency: `mathjs`** (Apache-2.0 ✅ verified at github.com/josdejong/mathjs 2026-06-05; active maintenance — last push 2026-05-12, not archived). Used for: expression parsing + dimensional unit checking. Apache-2.0 is on CLAUDE.md principle 4's permissive whitelist. License recorded in the S12-v3-3 commit message per CLAUDE.md "Every new dependency needs a license check."

Why mathjs: it ships a full unit-algebra system. `evaluate('5 ohm * 2 m / (0.001 m^2)')` returns a `Unit` object with simplified units; mismatched dimensions throw. Writing this from scratch in TypeScript would be a multi-sprint detour. Permissive license + active maintenance + canonical for this exact problem.

---

## Deliverables

```
OBJECT-MODEL.md
└── §16 NEW — Behavior-derives-value pattern        full spec; placed after §15

schemas/
└── (existing files updated)                        derives: block added to quantity-typed property schema

src/
├── derives-evaluator.ts                            NEW — mathjs wrapper: parse + evaluate + unit-check
└── cross-fk-validator.ts                           EXTENDED — derived-vs-rating conflict check

tests/
├── derives-evaluator.test.ts                       NEW — formula parse, eval, unit-check, mismatch errors
└── derives-rating-conflict.test.ts                 NEW — derives-violates-rating cross-FK code

fixtures/valid/
├── device-resistor.yaml                            UPDATED — R uses derives:
├── device-capacitor.yaml                           UPDATED — C uses derives:
└── device-led.yaml (or one LED variant)            UPDATED — λ uses derives:

package.json
└── mathjs ^x.y.z added to dependencies
```

---

## Sub-commit sequence

| # | Commit | Scope |
|---|---|---|
| **S12-v3-1** | `sprints/sprint-12.md` | This plan. |
| **S12-v3-2** | OBJECT-MODEL.md §16 spec | The behavior-derives-value pattern's design: `derives:` block schema, input-ref syntax (which property of which composition role / material / geometry), expression DSL (arithmetic + physical constants like `h`, `c`, `e`, `ε₀`), output units, conditions, conflict-detection rule. Closes the §15 "behavior-derives-value" deferred row with a pointer to §16. |
| **S12-v3-3** | mathjs dependency + `derives-evaluator.ts` | `npm install mathjs` (Apache-2.0 in commit message). TypeScript wrapper that takes a `derives:` spec + a resolved fixture context, parses the expression with mathjs, evaluates with unit-aware arithmetic, returns `{ value, units, conditions }`. Unit mismatches throw a structured error. Includes a small smoke test (`evaluate('5 ohm * 2 m / (0.001 m^2)')` returns simplified ohms — verifies mathjs unit algebra works as expected before depending on it). |
| **S12-v3-4** | JSON schema `derives:` blocks | Allow `derives:` alongside `value:` on quantity-typed property definitions. Mutual-exclusion rule: a property has either `value:` or `derives:`, not both. Schema tests cover both shapes valid + the mutual-exclusion violation invalid. |
| **S12-v3-5** | Resistor R = ρL/A first case | Update `device-resistor.yaml` to derive R from the material's resistivity + length + cross-section area. End-to-end validation: schema accepts, evaluator computes the right value, units come out as Ω. Test in `derives-evaluator.test.ts`. Verified against textbook formula (Sze + CRC Handbook). |
| **S12-v3-6** | LED λ = hc/E_g + capacitor C = ε₀ε_rA/d | Two more first cases. Tests for each. For the LED: Planck constant (6.62607015 × 10⁻³⁴ J·s exact CODATA 2022, NIST-verified) + speed of light (2.99792458 × 10⁸ m/s exact) + GaN/InGaN bandgap → expected λ in m, converted to nm for display. For the capacitor: vacuum permittivity (8.8541878128 × 10⁻¹² F/m) + relative permittivity from dielectric material + plate area + plate separation → F. |
| **S12-v3-7** | Cross-FK conflict detection | Extension to `cross-fk-validator.ts`: when a device declares both `derives:X` and has `max_X` / `min_X` / `nominal_X`, evaluate the derived value with default geometry/material assumptions and compare. Violations surface a new error code `derives-violates-rating`. Tests in `derives-rating-conflict.test.ts` — both passing and failing fixtures. |
| **S12-v3-8** | Sprint 12 retro + §15 closure | Sub-commit log, lessons surfaced, formal closure of the §15 "behavior-derives-value" deferred row (pointer to §16), and any new §15 rows discovered during the sprint. |

---

## Verification discipline (zero-trust, per Sprint 11 pattern)

- **Formula correctness:** `R = ρL/A` is the canonical resistor equation (Sze + CRC Handbook); `C = ε₀ε_rA/d` is the parallel-plate capacitor formula (Sze + every EE textbook); `λ = hc/E` is the Planck-Einstein relation. **Planck constant verified at canonical source 2026-06-05** — NIST CODATA 2022: 6.62607015 × 10⁻³⁴ J·s, exact, no uncertainty.
- **mathjs unit-handling correctness:** S12-v3-3 includes a smoke test that confirms `evaluate('5 ohm * 2 m / (0.001 m^2)')` produces a simplified `ohm` result. If mathjs's unit algebra is broken or doesn't behave as expected, surface immediately and pivot (write-from-scratch evaluator instead) — do not paper over.
- **Per-formula dimensional check:** every formula's output units must equal the property's declared units. Resistance in Ω; capacitance in F; wavelength in m. All three independently verified before commit.
- **Numerical sanity check:** plug in real material values from existing fixtures and confirm the computed result lands in the expected order of magnitude (e.g., 1 cm of 100 μm² nichrome wire → some hundreds of mΩ; not 10⁻¹² Ω or 10⁻⁹ Ω).
- **All three gates green** (`npm test`, `npx tsc --noEmit`, `npx biome check .`) before each sub-commit.
- **YAML colon gotcha** — defensive double-quoting on any description field with a colon.
- **Material values for the test cases** — copper resistivity from `material-copper.yaml`'s provenance (already cited NIST); silicon/GaN bandgaps from existing semiconductor fixtures; air permittivity from `material-air.yaml`.

---

## Done criteria

- [ ] OBJECT-MODEL.md §16 lands with the full `derives:` spec
- [ ] mathjs ^x.y.z installed; Apache-2.0 license noted in commit message; `package.json` shows the new dep
- [ ] `derives-evaluator.ts` evaluates expressions with unit-aware arithmetic; smoke test passes
- [ ] JSON schema allows `derives:` on quantity-typed properties; mutual-exclusion with `value:` enforced
- [ ] At least 3 fixtures use `derives:` — resistor R, one LED λ, capacitor C
- [ ] Cross-FK validator catches derived-vs-rating conflicts; new error code `derives-violates-rating` documented
- [ ] All tests pass (count grows from 74)
- [ ] `npx tsc --noEmit` clean
- [ ] `npx biome check .` clean
- [ ] Sprint retro written
- [ ] §15 "behavior-derives-value" row formally closed with §16 pointer

---

## Risks called out before opening

1. **mathjs unit algebra may surprise.** Some unit systems handle e.g. `ohm * m^-1` differently than expected. Mitigation: smoke test in S12-v3-3 before depending on it. If broken, fall back to a hand-written evaluator with named physical constants and a small dimensional-algebra checker.
2. **The conflict-detection comparison needs "default" geometry/material values.** A resistor's R depends on L and A, which are instance-level not device-level. For the device-level rating check, use the device's *default* parameters. If no defaults exist, skip the check (don't fail) and surface a warning. Decided this way in the spec, not in code.
3. **Mutual exclusion of `value:` vs `derives:`** — a device might want both: `value:` as the nominal datasheet value AND `derives:` as the from-physics computation. The spec needs to either pick one or define semantics for both (e.g., declared `value:` wins for display, `derives:` runs as a consistency check). **Decided in S12-v3-2.** Leading approach: `derives:` is primary if present; `value:` is allowed as override only with a `reason:` field explaining why measured/declared differs from derived (e.g., contact resistance not in the formula).
4. **Constants come from physics, not the catalog.** Planck constant, speed of light, vacuum permittivity, electron charge — these are universal constants, not material properties. The `derives-evaluator.ts` ships them as named bindings (`h`, `c`, `epsilon_0`, `e`) sourced from NIST CODATA 2022, cited in code comments.
5. **Sprint scope feels right-sized.** Wider than initial proposal (added evaluation + dimensional checking + rating-conflict detection) but stays inside foundation-spec discipline: no circuit topology, no solver, no UI. ~8 sub-commits, similar shape to Sprints 8/10/11.

---

## Open questions deferred to later sprints

Carried forward from Sprint 11 close (will be re-listed in Sprint 12 retro):

- Default-resolution path, net model (Sprint 13 candidate), `property_definition` registry, multi-version definitions, cross-pack dependencies, schema migration
- Stackup model, preset/template model, visual symbol library, auto-created interface UX, right-click parameter override UX, keybindings settings page
- Alloy composition-by-weight, `min_count` enforcement, AV chains
- Trigger taxonomy enum, multi-pole switches, state-dependent behavior gating
- Schottky junction promotion (when 2+ Schottky variants exist)
- White LED (phosphor-converted), heterostructure / QW active-layer modeling, laser diodes (Sprint 11 retro additions)

Background-knowledge claims still flagged for verification (carried from Sprint 10/11):
- IEC 62471 risk-group classifications (Sprint 11 uv_safety_class parameter)
- SPICE LED diode-model specifics
- KiCad single-LED-symbol count

---

## Sprint 12 opens here

Master tip when opened: `425922a` (post-doc-hardening: MPL-2.0 whitelist + KiCad-style errata language). The 74 tests from Sprint 11 close are the floor; expect ~85-95 tests when Sprint 12 closes (smoke tests for evaluator, schema tests for `derives:`, cross-FK tests for the new error code, fixture tests for the 3 first cases).

Trigger to begin: user approval of this plan.
