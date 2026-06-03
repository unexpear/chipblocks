# v3 Sprint 2 — JSON Schemas + Validation Fixtures

> **Status:** Sprint plan, opened 2026-05-20 against master tip `094ac48`.
> **Predecessor:** v3 Sprint 1 delivered [OBJECT-MODEL.md](../OBJECT-MODEL.md) — the canonical foundation spec. That doc is now the contract this sprint implements.
> **Scope:** write the JSON Schema 2020-12 files that implement OBJECT-MODEL.md, plus valid + invalid fixtures that prove the schema enforces every claim — including the five anti-placeholder rules. No UI, no validator engine, no `devices.yaml`, no project-file format.

---

## Sprint goal

Make the object model **machine-checkable**. After this sprint:

- A YAML file can be validated against `definition.schema.json` or `instance.schema.json` and either pass or fail with a clear reason.
- The five anti-placeholder rules in OBJECT-MODEL.md §12 are **enforced by the schema**, proven by fixtures that MUST fail validation.
- The model is no longer just prose — it's executable spec.

---

## Non-goals (explicit)

- No UI / canvas / visual editor
- No solver / validator engine (the *engine* that computes physics; this sprint is the *schema* that defines shapes)
- No `devices.yaml` or any actual content registry (the schema is the shape; content comes later)
- No project file format (the `MyProject.chipblocks/` folder spec)
- No AI integration
- No manufacturing pipeline
- **No CI** (per user call; tests run locally via `npm test`)
- No code beyond what's needed to run the schema + fixtures + tests

---

## Locked toolchain picks

Rationale lives in [TOOLING-RESEARCH-2026-05.md](../TOOLING-RESEARCH-2026-05.md). These picks are adopted here as the project's working toolchain; if any gets challenged later, write an ADR then to lock the answer durably (per the "no premature ADR" principle).

| Concern | Pick | Why |
|---|---|---|
| Schema spec | **JSON Schema 2020-12** | Latest stable; supports `if/then/else`, `$defs`, `unevaluatedProperties`, dynamic refs. Per TOOLING-RESEARCH. |
| Validator library | **Ajv 8.x** (verified 8.20.0 on registry 2026-05-20) | De facto JSON Schema validator; JSON Schema 2020-12 supported. |
| Package manager | **npm** (Node 24's bundled v11.12.1) | Practical: pnpm via Corepack requires admin-level `enable` on Windows, which isn't available in this environment. npm works without setup. Revisit pnpm when (a) there's a real disk-savings need, (b) phantom-deps become a concern, or (c) Corepack `enable` becomes feasible. |
| Test runner | **Vitest** | Per TOOLING-RESEARCH. |
| Lint + format | **Biome 2.x** | Per TOOLING-RESEARCH; verified at biomejs.dev. |
| TypeScript flags | `strict` + `exactOptionalPropertyTypes` + `verbatimModuleSyntax` + `isolatedModules` (consider `noUncheckedIndexedAccess` as stricter opt-in) | Per TOOLING-RESEARCH; catches real bugs at the schema-walking surface. |
| Format | YAML for authoring (fixtures + future registries); JSON Schema validates the parsed-JSON-equivalent | OBJECT-MODEL.md examples are YAML; YAML→JSON conversion handled by the test runner. |

---

## Authoring environment (verified 2026-05-20)

- **Node v24.15.0** (current; supports type-stripping for `.ts` files natively)
- **npm v11.12.1**
- **Git** 2.53.0
- **OS:** Windows 11 with WSL2 available (Python tooling will run in WSL2 when it returns)

---

## Deliverables

```
schemas/
├── identity.schema.json         shared fragment — id / name / description / kind / origin
├── provenance.schema.json       shared fragment — source_type / title / citation / confidence
├── quantity.schema.json         shared fragment — value-kinds polymorphism (scalar / range / condition_bound / equation / curve / lookup_table / unknown_user_supplied)
├── support-status.schema.json   shared fragment — model_status × solver_status enums
├── definition.schema.json       composes fragments + definition-only fields
└── instance.schema.json         composes fragments + instance-only fields

fixtures/
├── valid/
│   ├── material-copper.yaml         a material definition with full provenance
│   ├── device-wire.yaml             the generic wire definition (composition.requires, satisfies_role params)
│   └── instance-wire-001.yaml       a copper-wire instance
└── invalid/
    ├── unknown-user-supplied-at-builtin.yaml    Rule 2 violation
    ├── missing-provenance-at-builtin.yaml        Rule 1 violation
    ├── ref-on-definition.yaml                    §13 hard rule violation (ref forbidden on definitions)
    ├── value-and-ref-on-same-param.yaml          §13 mutual-exclusion violation
    └── behavior-no-solver-status.yaml            Rule 4 violation (pass by absence)

tests/
└── schema.test.ts                runs Ajv + Vitest; asserts valid fixtures pass + invalid ones fail

package.json
package-lock.json
tsconfig.json
biome.json
vitest.config.ts
.gitignore                       updated to ignore node_modules/, dist/, .vitest-cache/
```

---

## Sub-commit sequence

| # | Commit | Scope |
|---|---|---|
| **S2-v3-1** | Node project shell + toolchain picks landed | `package.json` (deps pinned), `package-lock.json`, `tsconfig.json` (strict flags), `biome.json`, `vitest.config.ts`, `.gitignore` updates. `npm install` runs cleanly. No schemas yet. |
| **S2-v3-2** | Shared schema fragments | `schemas/identity.schema.json`, `provenance.schema.json`, `quantity.schema.json`, `support-status.schema.json`. The atoms. Each is independently well-formed. |
| **S2-v3-3** | `definition.schema.json` | Composes shared fragments via `$ref` + definition-only fields (composition.uses / requires, parameters with `default:`, behaviors, support, extensions). |
| **S2-v3-4** | `instance.schema.json` | Fragments + instance-only fields (`kind_ref`, `definition`, parameters with `value:` / `ref:`, `connects:`). |
| **S2-v3-5** | Valid fixtures + Vitest test runner | 3 positive fixtures; Vitest config; `tests/schema.test.ts` asserts they validate against the right schema. `npm test` passes. |
| **S2-v3-6** | Invalid fixtures + must-fail tests | 5 invalid fixtures (one per anti-placeholder rule violation); tests assert each fails validation with the expected schema violation. The anti-placeholder rules are now *enforceable*, not just *aspirational*. |
| **S2-v3-7** | Sprint retro | Sprint close + lessons; appended to this file or as `sprints/sprint-2-retro.md`. |

---

## Verification discipline (zero-trust)

The project's discipline ("always check, never assume") applied to this sprint:

- **Every dependency version** is verified against the npm registry (via `npm view <pkg> version`) **before** pinning in `package.json`.
- **Every JSON Schema 2020-12 keyword** used is verified against the spec, not pulled from memory.
- **Every fixture's expected outcome** (pass / fail) is verified by actually running Ajv against it before committing — no "should fail" claims without running it.
- **No "tests pass" claim** without showing the actual `npm test` output.
- **No "schema validates X" claim** without an actual Ajv invocation.

---

## Done criteria

- [ ] All 6 schema files exist, are well-formed JSON, and reference each other correctly via `$ref`
- [ ] All 8 fixture files exist and are well-formed YAML
- [ ] `npm install` runs cleanly on the locked deps
- [ ] `npm test` passes — Vitest reports valid fixtures pass + invalid fixtures fail with the expected schema violations
- [ ] `npx biome check .` passes (formatting + lint clean)
- [ ] `npx tsc --noEmit` passes (TypeScript strict flags happy)
- [ ] OBJECT-MODEL.md axiom + anti-placeholder rules are enforced by the schema (verified by the must-fail fixtures, not just claimed)
- [ ] Sprint retro written

---

## Open questions deferred to future sprints

- **`material_ref` / `shape_ref` exact value shape.** Sprint 2 picks a working shape (e.g., bare id like `value: copper`); the full parameter-type taxonomy still defers per OBJECT-MODEL.md §15.
- **Project file format** (the `MyProject.chipblocks/` folder schema) — separate from object schema; v3 Sprint 3+.
- **Cross-FK / role-satisfaction validation** (e.g., does copper actually `enables` electrical_conduction when a wire instance picks it?) — JSON Schema alone can't enforce this; needs a separate validator pass that walks the cross-references. Per OBJECT-MODEL.md §15 deferred row. Sprint 5 work or later.
- **Net model** (`connects:` syntax) — Sprint 2 uses the ad-hoc shape from OBJECT-MODEL.md §2 example; formalization deferred per §15.
- **CI return** — held per user call; revisit when there's a multi-contributor reason.

---

## Sprint 2 opens here

Master tip when opened: `094ac48`. The [OBJECT-MODEL.md](../OBJECT-MODEL.md) spec at that commit is the contract this sprint implements. **If the schema can't enforce something the doc claims, the doc is wrong and gets edited — not the schema.** The schema is the executable verification of the spec.

---

## Sprint 2 retro (closed 2026-05-20)

### What landed

| Sub-commit | What |
|---|---|
| `f3540dd` | Sprint plan opened |
| `da241b4` | S2-v3-1: Node project shell + locked toolchain (Ajv 8, Vitest, Biome, TypeScript 6, yaml; npm, not pnpm) |
| `b47edce` | S2-v3-2: four shared schema fragments (identity, provenance, quantity, support-status) |
| `10a06ce` | S2-v3-3: definition.schema.json with anti-placeholder Rule 1+2 enforcement via if/then on origin |
| `bd005fa` | S2-v3-4: instance.schema.json with §13 value/ref mutual exclusion |
| `ac7e3fa` | S2-v3-4b: param_value polymorphism refinement — supports bare-string ids for material_ref / shape_ref / object_ref / enum |
| `dbf9fe9` | S2-v3-5: 3 valid fixtures + Vitest test runner — first green test run |
| (this) | S2-v3-6: 5 invalid fixtures + must-fail tests — anti-placeholder rules now ENFORCED |
| (this) | S2-v3-7: this retro — Sprint 2 closes |

### Done criteria — all met

- [x] All 6 schema files exist, well-formed JSON, reference each other correctly via `$ref`
- [x] All 8 fixture files exist (3 valid + 5 invalid), well-formed YAML
- [x] `npm install` runs cleanly (56 packages, 0 vulnerabilities, ~8s)
- [x] `npm test` passes (8/8 tests: 3 valid validate, 5 invalid fail)
- [x] `npx biome check .` passes (clean)
- [x] `npx tsc --noEmit` passes (TS 6 strict flags happy)
- [x] OBJECT-MODEL.md axiom + anti-placeholder rules enforced (proven by must-fail fixtures)
- [x] Sprint retro written

### Lessons surfaced

1. **`param_value` polymorphism was missed in the initial schema draft.** First version of `definition.schema.json` typed parameter defaults as quantity-only, but OBJECT-MODEL.md §14 has `default.value: path` (a bare-string shape_ref) for the wire's geometry parameter. Caught when fixtures wouldn't validate. Added `param_value` and `param_value_strict` $defs in quantity.schema.json (S2-v3-4b). **General lesson:** parameter values are polymorphic by type (quantity / string for refs / number / bool); test fixtures surface this if the schema assumed quantity-only.

2. **Rule 1 was over-enforced initially.** First draft required provenance on parameter defaults at builtin origin. Spec actually says Rule 1 applies to `properties.*` (physical material properties), not `parameters.*.default`. A ref-typed default like `geometry: { default: { value: path } }` is structural, not a citable physical claim. Schema relaxed in S2-v3-5. **General lesson:** read the rule's scope carefully before enforcing — over-enforcement masquerades as strictness but actually contradicts the spec.

3. **YAML parsing gotcha: `ref:` inside an unquoted description.** Fixture `ref-in-definition-default.yaml` had `description: Demonstrates §13 violation — ref: in a definition's parameter default.` — YAML parser interpreted `ref:` mid-string as a new key. Fixed by quoting the description. **General lesson:** any YAML scalar value containing a colon-followed-by-space pattern needs quotes.

4. **Corepack `enable` requires admin on Windows.** Plan said pnpm; environment blocked it (EPERM on Program Files). Pivoted to npm in S2-v3-1 with a note in the sprint plan. **General lesson:** verify the environment supports a locked tool before committing the rest of the plan to it. Pragmatic substitution is fine when the rationale is documented.

5. **TypeScript strict + CJS interop friction.** Ajv 8 ships as CJS; the ESM default import in TS-strict mode forced `as any` with biome-ignore comments. Acceptable workaround; would be cleaner if Ajv published proper ESM. **General lesson:** TS strict can be friction at the library-interop layer; document the workaround in-line so future maintainers know why the `any` is there.

6. **`additionalProperties: false` is load-bearing.** Several anti-placeholder enforcements piggyback on `additionalProperties: false` (e.g., `ref:` rejection on definition defaults). **General lesson:** the closed-property-set pattern catches a lot of typos and rule violations for free; default to `additionalProperties: false` on every closed object.

### Unresolved questions (still deferred per OBJECT-MODEL.md §15)

- Behavior registry shape — where do behaviors like `conducts_current` actually live?
- `property_definition` registry shape
- Cross-FK / role-satisfaction validation — needs a separate validator pass beyond JSON Schema
- Net model — `connects:` is still ad-hoc per §2 example
- Project file format
- `material_ref` / `shape_ref` exact resolution rules
- Schema migration story
- Visual symbol library (per SCHEMATIC-SYMBOLS.md, deferred to canvas sprint)

### What this unblocks

After Sprint 2 close:
- The object model is no longer just prose — it's executable spec. Any future material/device entry can be checked against the schema mechanically.
- The anti-placeholder rules are real. A future contributor who tries to ship a builtin material without provenance gets a hard error at test time.
- The test runner is in place. v3 Sprint 3+ can extend tests/ with cross-FK validators and physics-engine tests as they land.
- The toolchain (Ajv, Vitest, Biome, TypeScript strict) is locked and proven. Future sprints inherit.

### Sprint 2 closed

All sub-commits land cleanly on master. All gates green. Foundation is now machine-checkable.
