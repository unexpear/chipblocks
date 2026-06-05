# v3 Sprint 12 — Equation value kind formalized (declare + evaluate + dimension-check + rating-conflict-detect)

> **Status:** Sprint plan, opened 2026-06-05 against master tip `425922a`; pivoted after scan against OBJECT-MODEL.md §7.
> **Predecessor:** Sprint 11 closed multi-color LED expansion at 74 tests + the user's "check before behavior-derives-value" trigger fired. Sprint 12 picks up that trigger.
> **Scope shift after scan:** §7 already introduces `kind: equation` as a polymorphic value kind. Sprint 12 *formalizes* that kind's full schema, *implements* the evaluator + dimensional checking, and *adds* the cross-FK rating-conflict detector. The §15 deferred row called this "behavior-derives-value pattern"; the §16 spec resolves it under §7's existing equation-kind terminology.

---

## Sprint 12 goal in plain English

"Real values come from real physics." Instead of a resistor's resistance being a hardcoded number with provenance pointing at a datasheet, declare HOW it's computed: from the material's resistivity × the wire's length ÷ its cross-section area. ChipBlocks evaluates the formula at validation time, dimensionally checks the units come out right, and flags violations of any declared rating on the same property.

This is foundation-level. It's what makes "real blocks all the way down" load-bearing: downstream sprints (DC solver, etc.) consume derived values that carry their physical justification.

**Formulas are shipped with the catalog by maintainers, NOT authored by end users** — Core principle 1 plus §16.12 constraint. The end user never types a formula into a canvas.

---

## After this sprint

1. A property value of `kind: equation` (per §7) has a fully specified schema: `expression`, `inputs`, `output_unit`, optional `constants_used`, `conditions`, `provenance`, `notes`.
2. Inputs reference other properties via a structured path syntax (`material.resistivity`, `geometry.length`, etc.), or named physical constants (h, c, e, ε₀, etc.), or runtime variables.
3. The validator evaluates every `kind: equation` value automatically when loading an instance.
4. Dimensional analysis is automatic via mathjs's unit algebra: if the expression's output units don't match `output_unit`, validation fails with `derives-unit-mismatch`.
5. **Per-instance rating conflict check:** if an instance has a property X as `kind: equation` AND a `max_X` / `min_X` rating, the validator evaluates X and compares; violations surface `derives-violates-rating`.
6. Three first concrete cases land:
   - **Resistor R** — `ρ × L / A`
   - **LED λ** — `h × c / E_g`
   - **Capacitor C** — `ε₀ × ε_r × A / d`
7. §16 in OBJECT-MODEL.md fully specs equation kind; §15 "behavior-derives-value" row closes with §16 pointer.

---

## Non-goals (explicit)

- **No circuit-level failure detection.** LED overload from upstream current, voltage drops cascading through a divider — these need the DC solver (Sprint 14+). Sprint 12's check is **per-instance / per-property only**: derived value vs declared rating on the *same* instance.
- **No net model formalization.** `connects:` stays ad-hoc data. Sprint 13.
- **No DC solver.** Sprint 14.
- **No `input_variable` evaluation.** §7's equation example uses `T: { kind: input_variable, unit: kelvin }` for parametric forms like ρ(T). Sprint 12 evaluates ALL-CONCRETE-INPUTS equations only. `input_variable` case (parametric in temperature/frequency/etc.) is recognized in the schema but skipped at evaluation; lands when the DC solver needs it.
- **No visualization lenses.** Canvas first. Many sprints out.
- **No thermal solver / EMI.** Stages 7-8 of the arc.
- **No new physics behaviors.** Use existing behaviors; the `kind: equation` value is the new mechanism, not new behaviors.
- **No user-authored equations.** Per Core principle 1 + §16 constraint, formulas ship with the catalog.
- **No bulk replacement of static values.** Only the 3 first concrete cases get migrated to equation kind this sprint. Other devices keep declared values; equation kind is added device-by-device as the physics is captured.

---

## Locked toolchain

Existing: Node 24 + npm + JSON Schema 2020-12 + Ajv 8 + Vitest + Biome 2 + TypeScript 6 strict.

**New dependency: `mathjs`** (Apache-2.0 ✅, verified at github.com/josdejong/mathjs 2026-06-05; active — last push 2026-05-12, not archived). Apache-2.0 is on CLAUDE.md principle 4's permissive whitelist. License recorded in the S12-v3-3 commit message.

Why mathjs: ships a full unit-algebra system. `evaluate('5 ohm * 2 m / (0.001 m^2)')` returns a `Unit` object with simplified units; mismatched dimensions throw. Writing this from scratch is a multi-sprint detour. Permissive + active + canonical for this exact problem.

---

## Deliverables

```
OBJECT-MODEL.md
├── §16 NEW — Equation value kind: full specification   placed after §15, before "How this doc evolves"
└── §15 deferred row "behavior-derives-value pattern"   marked ✅ CLOSED, pointer to §16

schemas/
└── (existing value schema files updated)                equation kind shape tightened

src/
├── equation-evaluator.ts                                NEW — mathjs wrapper: parse + evaluate + unit-check
└── cross-fk-validator.ts                                EXTENDED — equation-rating conflict check

tests/
├── equation-evaluator.test.ts                           NEW — formula parse, eval, unit-check, mismatch errors
└── equation-rating-conflict.test.ts                     NEW — derives-violates-rating cross-FK code

fixtures/valid/
├── device-resistor.yaml                                 UPDATED — R as kind: equation
├── device-capacitor.yaml                                UPDATED — C as kind: equation
└── (one LED variant)                                    UPDATED — λ as kind: equation

package.json
└── mathjs ^x.y.z added to dependencies
```

---

## Sub-commit sequence

| # | Commit | Scope |
|---|---|---|
| **S12-v3-1** | `sprints/sprint-12.md` | Plan opens (committed `a66dc6c`). |
| **S12-v3-2** | OBJECT-MODEL.md §16 spec + plan-shift retro + §15 closure | This commit. The §16 spec fully formalizes the `equation` value kind §7 introduced: field schema, input-spec types (constant / property_ref / input_variable), physical-constants table sourced from NIST CODATA 2022, evaluation semantics, dimensional check via mathjs, conflict-detection rule, anti-placeholder compatibility, first concrete cases, relation to §15. Also closes the §15 "behavior-derives-value" row with ✅ CLOSED + §16 pointer. Plan updated to reflect post-scan equation-kind terminology. |
| **S12-v3-3** | mathjs dependency + `equation-evaluator.ts` | `npm install mathjs` (Apache-2.0 in commit message). TypeScript wrapper that takes an `equation` value spec + a resolved instance context, parses the expression with mathjs, evaluates with unit-aware arithmetic, returns `{ amount, unit, conditions }`. Unit mismatches throw structured errors. Includes a smoke test (`evaluate('5 ohm * 2 m / (0.001 m^2)')` returns simplified ohms — verifies mathjs unit algebra works before depending on it). If broken, pivot to hand-written evaluator. |
| **S12-v3-4** | JSON schema tightening for `equation` value kind | The schema already permits `kind: equation` (per §7). Sprint 12 tightens the shape: required fields (`expression`, `inputs`, `output_unit`), input-spec discriminator (`constant` / `property_ref` / `input_variable`), constant-name validation, output-unit string validation. Schema tests cover both valid shapes and the rejection of incomplete equations. |
| **S12-v3-5** | Resistor R = ρL/A first case | Update `device-resistor.yaml` to declare R as `kind: equation` with inputs pulling from material.resistivity + geometry.length + geometry.cross_section_area. End-to-end test: schema accepts; evaluator computes the right value; units come out as Ω. Verified against Sze + CRC Handbook formula. |
| **S12-v3-6** | LED λ = hc/E_g + capacitor C = ε₀ε_r·A/d | Two more first cases. For LED: Planck constant 6.62607015 × 10⁻³⁴ J·s exact CODATA 2022 + speed of light 2.99792458 × 10⁸ m/s exact + active-material bandgap → λ in m, converted to nm. For capacitor: vacuum permittivity 8.8541878128 × 10⁻¹² F/m + relative permittivity from dielectric material + plate geometry → F. Tests for each; numerical sanity check (computed values land in expected order of magnitude). |
| **S12-v3-7** | Cross-FK conflict detection | Extension to `cross-fk-validator.ts`: **per-instance check** — when an instance has a property declared via `kind: equation` and the same instance (or its device) has a `max_X` / `min_X` rating on the same property name, evaluate the derived value using the instance's actual geometry/material/parameters and compare. Violations surface a new error code `derives-violates-rating`. Tests in `equation-rating-conflict.test.ts` — both passing and failing fixtures. Device-level "defaults-vs-rating" check deferred — first need device defaults guaranteed meaningful. |
| **S12-v3-8** | Sprint 12 retro | Sub-commit log, lessons surfaced, confirmation of §15 closure + any new §15 rows that surfaced during the sprint. |

---

## Verification discipline (zero-trust)

- **Formula correctness:** `R = ρL/A` is canonical (Sze + CRC Handbook); `C = ε₀ε_rA/d` is parallel-plate (Sze + every EE textbook); `λ = hc/E` is Planck-Einstein. **Planck constant verified 2026-06-05 at NIST CODATA 2022: 6.62607015 × 10⁻³⁴ J·s, exact.** Other physical constants verified at S12-v3-2 against the same NIST source.
- **mathjs unit-handling correctness:** S12-v3-3's smoke test confirms `evaluate('5 ohm * 2 m / (0.001 m^2)')` produces simplified ohms. If mathjs's unit algebra is broken or behaves differently than expected, pivot to hand-written evaluator — do not paper over.
- **Per-formula dimensional check:** every formula's output units must equal the property's declared `output_unit`. Resistance in Ω; capacitance in F; wavelength in m (with downstream nm conversion). All three independently verified before commit.
- **Numerical sanity check:** plug real material values from existing fixtures, confirm computed result lands in expected order of magnitude (1 cm of 100 μm² nichrome → hundreds of mΩ, not 10⁻¹² Ω).
- **All three gates green** (`npm test`, `npx tsc --noEmit`, `npx biome check .`) before each sub-commit.
- **YAML colon gotcha** — defensive double-quoting on any description with a colon.
- **Material values for the test cases** — copper resistivity from `material-copper.yaml`'s NIST-cited provenance; semiconductor bandgaps from existing fixtures; air permittivity from `material-air.yaml`.

---

## Done criteria

- [ ] OBJECT-MODEL.md §16 lands fully specifying the equation value kind
- [ ] §15 "behavior-derives-value pattern" row marked ✅ CLOSED with §16 pointer
- [ ] mathjs installed; Apache-2.0 license noted in commit message; `package.json` shows the new dep
- [ ] `equation-evaluator.ts` evaluates expressions with unit-aware arithmetic; smoke test passes
- [ ] JSON schema for `equation` value kind tightened per §16
- [ ] At least 3 fixtures use `kind: equation` — resistor R, one LED λ, capacitor C
- [ ] Cross-FK validator catches equation-vs-rating conflicts; new error code `derives-violates-rating` documented
- [ ] All tests pass (count grows from 74)
- [ ] `npx tsc --noEmit` clean
- [ ] `npx biome check .` clean
- [ ] Sprint retro written

---

## Risks called out

1. **mathjs unit algebra may surprise.** Specific unit-system quirks (ohm·m vs ohm × m formatting, electron-volt as energy unit, etc.) could cause evaluator surprises. Mitigation: smoke test in S12-v3-3 before depending on it. If broken, fall back to hand-written evaluator with named physical constants and a small dimensional-algebra checker. Decision tree clearly stated.
2. **Per-instance check requires real instance data.** The rating check needs actual L, A, material — not device defaults. If an instance lacks any input, skip the check and surface a warning (don't fail). The instance-without-full-inputs case is rare in real fixtures but possible during catalog development.
3. **§7's `input_variable` case is parametric, not directly evaluable.** Sprint 12 implements all-concrete-inputs equations; equations with `input_variable` (parametric in temperature, frequency, etc.) are recognized but not evaluated this sprint. The temperature-dependent resistivity example in §7 falls in this category. §16 makes the distinction explicit.

---

## Open questions deferred to later sprints

Carried forward from Sprint 11 close (will be re-listed in Sprint 12 retro):

- Default-resolution path, net model (Sprint 13), `property_definition` registry, multi-version definitions, cross-pack dependencies, schema migration
- Stackup model, preset/template model, visual symbol library, auto-created interface UX, right-click parameter override UX, keybindings settings page
- Alloy composition-by-weight, `min_count` enforcement, AV chains
- Trigger taxonomy enum, multi-pole switches, state-dependent behavior gating
- Schottky junction promotion (when 2+ Schottky variants exist)
- White LED (phosphor-converted), heterostructure / QW active-layer modeling, laser diodes (Sprint 11 retro additions)
- **NEW from §16 spec:** parametric equation evaluation with `input_variable` (when DC solver needs it); device-level "defaults-vs-rating" conflict check (when defaults are guaranteed meaningful)

Background-knowledge claims still flagged for verification (carried from Sprint 10/11):
- IEC 62471 risk-group classifications (Sprint 11 uv_safety_class parameter)
- SPICE LED diode-model specifics
- KiCad single-LED-symbol count

---

## Sprint 12 opens here

Master tip when opened: `425922a` (post-doc-hardening: MPL-2.0 whitelist + KiCad-style errata language). Plan committed `a66dc6c` as S12-v3-1. Plan pivot from "new `derives:` block" → "tighten existing §7 `equation` value kind" lands in S12-v3-2 alongside the §16 spec. The 74 tests from Sprint 11 close are the floor; expect ~85-95 when Sprint 12 closes.
