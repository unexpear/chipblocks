# v3 Sprint 4 — More content: foundation stress test

> **Status:** Sprint plan, opened 2026-06-03 against master tip `ce3cf82`.
> **Predecessor:** v3 Sprint 3 delivered the behavior registry + cross-FK validator. The model now has both shape-validation AND relationship-validation; foundation is solid but the catalog is thin (copper, wire, path).
> **Scope:** add 7 materials, 1 shape, 1 interface kind, 3 primitive devices, and 3 new behaviors. Stress-tests the foundation against real content that isn't just copper / wire / path. No UI, no physics engine, no Active Variables schema.

---

## Sprint goal

The foundation is solid in principle (schema + cross-FK validator green). What it hasn't done is *meet real content*. Sprint 4 adds enough new entries — across every layer the foundation reaches today — to surface any gap the schema missed.

Each new entry deliberately tests a different facet:

- **Solder materials** — first alloy entries. Test: does the schema handle alloys cleanly with just description + provenance, or does it need composition-by-weight?
- **FR4** — first composite (woven glass + epoxy). Test: does the multi-property material work with the unit/value-kind system?
- **Air** — first gas dielectric, first **unitless property** (ε_r ≈ 1.00059). Test: does the schema accept `unit: dimensionless`?
- **Nichrome** — first resistive alloy. Test: does the resistive-heating capability fit `enables` cleanly?
- **`plate` shape** — first 2D-area shape (existing `path` is 1D). Test: does `min_count: 2` composition for plates exercise correctly?
- **`solder_joint` interface kind** — first new interface kind. Test: does the existing interface validation cover material-bonded multi-surface joins?
- **`resistor`** — first primitive device using a non-conductor-as-conductor material role. Test: behavior-derives-value pattern (R = ρL/A).
- **`capacitor`** — first device with 2-of-same-kind role (2 plates + dielectric). Test: multi-role composition + first unitless property.
- **`power_source`** — first device with device-level provenance (`nominal_voltage`). Test: convention choice for device-level scalars.

After this sprint, the catalog has 8 materials, 2 shapes, 1 interface kind, 4 primitive devices, 6 behaviors. Every entry validates against schema + cross-FK with zero errors. Any gaps surfaced during the sprint are either patched in-sprint or recorded in OBJECT-MODEL.md §15 as deferred questions.

---

## Non-goals (explicit)

- **No `switch` primitive device** — stateful behavior is a real design topic; deferred to Sprint 5 along with relays/MOSFETs.
- **No LED** — semiconductor physics + photon emission deserve their own sprint (Sprint 5+).
- **No Active Variables schema** — `ref:` is demonstrated in fixtures today; the project-level variable registry has its own schema work (Sprint 5).
- **No net model formalization** — `connects:` stays ad-hoc per §15.
- **No board-level entries** — no PCB stackup, no real layout. FR4 lands as a material but no board uses it yet.
- **No UI / canvas / visual editor.**
- **No physics engine** — values are declared with provenance, not solved.
- **No solder alloy composition fields** — Sn63Pb37's "63% tin, 37% lead by weight" lives in `description` + `notes` for now. If this bites in Sprint 4, capture as §15 deferred.

---

## Locked toolchain (inherited from Sprints 2-3)

Node 24 + npm + JSON Schema 2020-12 + Ajv 8 + Vitest + Biome 2 + TypeScript 6 strict. No new dev dependencies expected.

---

## Deliverables

```
fixtures/valid/
├── material-aluminum.yaml             NEW — Al conductor, NIST/CRC values
├── material-silicon.yaml              NEW — intrinsic Si, semiconductor base
├── material-fr4.yaml                  NEW — woven-glass epoxy PCB substrate
├── material-nichrome.yaml             NEW — Ni-Cr resistive alloy
├── material-air.yaml                  NEW — gas dielectric, first unitless property (ε_r)
├── material-solder-sn63pb37.yaml      NEW — leaded eutectic solder, 183°C
├── material-solder-sac305.yaml        NEW — lead-free SAC solder, ~217°C
├── shape-plate.yaml                   NEW — 2D plate (capacitor plates, ground planes)
├── behavior-stores-charge.yaml        NEW — capacitor energy-storage behavior
├── behavior-has-capacitance.yaml      NEW — C = ε·A/d relationship
├── behavior-provides-emf.yaml         NEW — voltage-source behavior
├── interface-solder-joint.yaml        NEW — material-bonded join, first new interface kind
├── device-resistor.yaml               NEW — generic resistor, behavior-derives-value
├── device-capacitor.yaml              NEW — generic capacitor, 2 plates + dielectric
├── device-power-source.yaml           NEW — generic EMF source
├── instance-resistor-001.yaml         NEW — nichrome resistor instance
├── instance-capacitor-001.yaml        NEW — parallel-plate cap with air dielectric
├── instance-power-source-001.yaml     NEW — 9V battery instance
├── instance-solder-joint-001.yaml     NEW — solder_joint connecting two leads
└── (existing fixtures stay)
```

Any new invalid fixtures or test cases are added under `fixtures/invalid/` and `tests/` as gaps surface.

---

## Sub-commit sequence

| # | Commit | Scope |
|---|---|---|
| **S4-v3-1** | `sprints/sprint-4.md` | This plan. |
| **S4-v3-2** | 5 simple materials | aluminum, silicon, FR4, nichrome, air. Each with cited provenance (NIST, CRC Handbook, IEC, ASTM where applicable). Schema test extended to validate the new fixtures. |
| **S4-v3-3** | 2 solder materials | solder_sn63pb37 (IPC J-STD-006), solder_sac305 (IPC J-STD-006, RoHS context). Alloys carry description-only composition; if schema gap surfaces, decide in-sprint whether to add a field or defer per §15. |
| **S4-v3-4** | `plate` shape + 3 new behaviors | `plate` shape with `enables: [plate_role]` (mirrors `path`). Three behavior registry entries: stores_charge, has_capacitance (consequence: stores_charge), provides_emf. |
| **S4-v3-5** | `solder_joint` interface kind + instance | New interface definition with composition.requires (solder_material role + bonded_surfaces min_count: 2). One instance demonstrating two leads joined with SAC305. First new interface kind since the foundation existed. |
| **S4-v3-6** | `resistor` primitive device + instance | Generic resistor: composition.requires resistive_material + path geometry, parameters with `satisfies_role`, behaviors [conducts_current, has_resistance, produces_joule_heat] — all from the existing registry. Instance: nichrome resistor with declared resistance. |
| **S4-v3-7** | `capacitor` primitive device + instance | Generic capacitor: composition.requires 2 plates + dielectric material. Behaviors [stores_charge, has_capacitance]. Instance: parallel-plate cap with air dielectric. **First exercise of `min_count: 2` and unitless property (ε_r).** |
| **S4-v3-8** | `power_source` primitive device + instance | Generic EMF source: nominal_voltage as device-level property with provenance, internal_resistance, capacity. Behaviors [provides_emf, conducts_current]. Instance: 9V alkaline battery. **First device-level provenance — sets the convention.** |
| **S4-v3-9** | Sprint 4 retro | Sub-commit log, lessons, deferred questions still outstanding. New §15 rows committed alongside if gaps surfaced. |

---

## Verification discipline (zero-trust, same as Sprints 2-3)

- Every material value cited from a real source (NIST CODATA, IEC standard, ASTM, IPC, CRC Handbook, ASM Handbook). No invented numbers.
- Every alloy composition cited from IEC 61190 / IPC J-STD-006 (or equivalent), not from generic web sources.
- Every behavior law equation traceable to a textbook citation in `notes:` or `provenance:`.
- All three gates (`npm test`, `npx tsc --noEmit`, `npx biome check .`) green before each sub-commit.
- Any schema gap surfaced gets explicitly handled — either an in-sprint schema patch with its own sub-commit, or a §15 deferred row + a documented workaround in the affected fixture's `notes:`.

---

## Done criteria

- [ ] 7 new materials validate against `definition.schema.json` (cited provenance, condition-aware where applicable)
- [ ] `plate` shape validates and is used by capacitor composition
- [ ] 3 new behavior registry entries (stores_charge, has_capacitance, provides_emf) validate against `behavior.schema.json`
- [ ] `solder_joint` interface kind validates as a definition (kind: interface, layer: interface)
- [ ] 3 primitive devices validate (resistor, capacitor, power_source)
- [ ] 4 instances validate (resistor_001, capacitor_001, power_source_001, solder_joint_001)
- [ ] Cross-FK validator reports zero errors on all new fixtures
- [ ] No anti-placeholder rule violations — every built-in material property carries provenance + confidence
- [ ] `npm test` shows all schema + cross-FK tests passing (count grows from 17)
- [ ] `npx tsc --noEmit` clean
- [ ] `npx biome check .` clean
- [ ] Sprint retro written

---

## Known schema-gap candidates (will land in §15 if confirmed)

These are the gaps I expect Sprint 4 to surface. None block the sprint — each has a documented fallback.

1. **Alloy composition fields.** Sn63Pb37 = 63% tin, 37% lead by weight. Current model has no composition-by-weight field for materials. **Fallback:** describe in `description` + `notes`. **§15 row** if confirmed needed.

2. **Unitless properties.** Relative permittivity ε_r is dimensionless. The current `quantity.schema.json` may not accept `unit: dimensionless`. **Fallback:** patch schema to allow `unit: dimensionless` (or `unit: ratio`). **In-sprint fix** if surfaced — cheap.

3. **Device-level provenance convention.** `nominal_voltage` on `power_source` — is it `properties.nominal_voltage` (treated like a material property) or `parameters.nominal_voltage.default.value` (treated as the default for a tunable parameter)? **Sprint 4 picks the convention and documents it.**

4. **Behavior-derives-value pattern.** Resistor's actual resistance = ρ × length / area. Capacitor's actual capacitance = ε × A / d. Currently behaviors carry `evaluates:` (symbolic equation). **Sprint 4 tests whether `evaluates:` is enough, or whether a richer "derivation chain" is needed.** Likely enough for now; verify.

5. **`min_count: N` exercise.** Capacitor's "2 plates" role hasn't been exercised before. Sprint 4 verifies the cross-FK validator handles `min_count` correctly (it's in the type signature but may not have a test).

6. **Resistive-heating capability vs behavior.** Nichrome's resistive-heating is partly material capability (resistivity is high), partly device behavior (produces_joule_heat). Sprint 4 picks where each lives.

---

## Open questions deferred to Sprint 5+ (or later)

- **Switch / stateful devices** — state machine modeling pass; relays, MOSFETs follow same shape.
- **LED + semiconductor physics** — PN junction interface kind, photon emission behavior.
- **Active Variables schema** — first-class registry for project-level variables.
- **Net model formalization** — `connects:` stays ad-hoc; nets become first-class objects later.
- **`property_definition` registry shape** — what does "resistance" mean as a quantity concept?
- **Multi-version definitions** (Sprint 7+), cross-pack dependencies (Sprint 8+), schema migration story.
- **Stackup model** — needed when boards arrive.
- **Preset/template model** — packaged components like `0603 resistor` (existing §15 row).
- **Visual symbol library** — canvas sprint.
- **Auto-created interface UX pattern** — canvas sprint (existing §15 row).

---

## Sprint 4 opens here

Master tip when opened: `ce3cf82`. Sprint 3's behavior registry + cross-FK validator are the contract Sprint 4 builds on. Every new entry runs through schema validation + cross-FK before landing. Any gap surfaced is either fixed in-sprint with a new sub-commit, or recorded as a §15 deferred question with a documented fallback.
