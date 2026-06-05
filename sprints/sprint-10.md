# v3 Sprint 10 — Doped-semiconductor material foundations for multi-color LEDs

> **Status:** Sprint plan, opened 2026-06-05 against master tip `edc1e7c`.
> **Predecessor:** v3 Sprint 9 promoted pn_junction to a first-class interface kind and refactored 3 PN-junction devices to use it. Test count grew 62 → 63. The generic `led` device with red AlGaInP defaults now supports per-instance material overrides — but the catalog only has AlGaInP variants.
> **Scope:** add 3 new doped-semiconductor material systems (6 doped variants total) — InGaN, GaAs, AlGaN — that future sprints will use for blue/green/IR/UV LED instances and the eventual `led_uv_algan` separate device. Materials only this sprint; LED instances + UV device defer to a later sprint plan.

---

## Sprint goal

The generic `led` device from Sprint 9 can accept any direct-bandgap n_type + p_type material pair via parameter override. The catalog only has AlGaInP (red); to enable multi-color expansion, we need the doped variants for the other LED material systems.

Sprint 10 adds 3 material systems, each with n-type and p-type doped variants, matching industry SPICE/EDA conventions (one material entry per system; specific composition variation handled at the instance/device level via wavelength + forward voltage parameters):

- **InGaN** (Indium Gallium Nitride) — for blue + green LEDs. In fraction varies (~15% blue, ~30% green) but treated as one material system at the circuit-modeling layer.
- **GaAs** (Gallium Arsenide) — for IR LEDs (~880 nm). Also future Schottky variants on GaAs and high-frequency RF transistors.
- **AlGaN** (Aluminum Gallium Nitride) — for UV LEDs. Al fraction varies (low Al for ~365 nm near-UV, high Al for deep-UV down to ~210 nm).

The LED instances + UV LED device + white LED + heterostructure + laser diode questions are all deferred to a future sprint plan. Sprint 10 is materials-only.

---

## Non-goals (explicit)

- **No LED instances** — blue, green, IR instances defer to next sprint plan
- **No `led_uv_algan` device** — defers to next sprint plan (UV LED has lifetime + eye-safety caveats that justify a separate device)
- **No white LED** — phosphor-converted structure deferred per §15
- **No heterostructure / QW active-layer modeling** — deferred per §15
- **No laser diodes** — separate device kind, deferred per §15
- **No behavior-derives-value pattern** — user said "check before" — comes after the multi-color LED work
- **No UI / canvas / physics engine**

---

## Locked toolchain (inherited from Sprints 2-9)

Node 24 + npm + JSON Schema 2020-12 + Ajv 8 + Vitest + Biome 2 + TypeScript 6 strict. No new dev dependencies.

---

## Deliverables

```
fixtures/valid/
├── material-indium-gallium-nitride-n-type.yaml      NEW — n-doped InGaN
├── material-indium-gallium-nitride-p-type.yaml      NEW — p-doped InGaN
├── material-gallium-arsenide-n-type.yaml            NEW — n-doped GaAs
├── material-gallium-arsenide-p-type.yaml            NEW — p-doped GaAs
├── material-aluminum-gallium-nitride-n-type.yaml    NEW — n-doped AlGaN
└── material-aluminum-gallium-nitride-p-type.yaml    NEW — p-doped AlGaN
```

---

## Sub-commit sequence

| # | Commit | Scope |
|---|---|---|
| **S10-v3-1** | `sprints/sprint-10.md` | This plan. |
| **S10-v3-2** | InGaN n+p materials | Indium gallium nitride doped variants. Bandgap ~2.4-2.7 eV (direct, blue-to-green range). Used for blue + green LEDs (the single material system at SPICE/EDA modeling layer per Wikipedia LED reference verification 2026-06-05). Provenance Ioffe NSM Archive + Sze + Schubert "LEDs" textbook. |
| **S10-v3-3** | GaAs n+p materials | Gallium arsenide doped variants. Bandgap 1.42 eV (direct). Used for IR LEDs (~880 nm) and future GaAs Schottky / high-frequency transistors. Provenance Ioffe NSM Archive + Sze. |
| **S10-v3-4** | AlGaN n+p materials | Aluminum gallium nitride doped variants. Bandgap 3.4-6.0 eV depending on Al fraction (direct). Used for UV LEDs (365 nm near-UV down to ~210 nm deep-UV). Provenance Ioffe NSM Archive + recent UV-LED literature. |
| **S10-v3-5** | Sprint 10 retro | Sub-commit log, lessons. No new §15 rows expected unless something surfaces. |

---

## Verification discipline (zero-trust, same as Sprints 2-9)

- Material values cited from Ioffe NSM Archive + Sze "Physics of Semiconductor Devices" 3rd ed. + Schubert "Light-Emitting Diodes" 2nd ed. + manufacturer datasheets (Cree XLamp, Lumileds, Osram) where applicable.
- All three gates (`npm test`, `npx tsc --noEmit`, `npx biome check .`) green before each sub-commit.
- YAML descriptions with `:` get defensively quoted (Sprint 2/4/8 gotcha — discipline holds).
- Industry-standard claim: "InGaN as one material system for blue + green" verified directly against Wikipedia LED article (2026-06-05); other industry claims (SPICE PN-junction modeling, KiCad single LED symbol, IEC 62471 eye-safety standard) accepted as background knowledge — flagged for direct verification when canvas/export work needs them.

---

## Done criteria

- [ ] 6 new doped-semiconductor materials validate against definition.schema.json with cited provenance
- [ ] Each n-type variant enables [electrical_conduction, thermal_conduction, semiconductor, n_type_semiconductor, direct_bandgap]
- [ ] Each p-type variant enables [electrical_conduction, thermal_conduction, semiconductor, p_type_semiconductor, direct_bandgap]
- [ ] All bandgaps tagged direct (these are LED-suitable materials — unlike silicon which is indirect)
- [ ] `npm test` shows all tests passing (count grows from 63)
- [ ] `npx tsc --noEmit` clean
- [ ] `npx biome check .` clean
- [ ] Sprint retro written

---

## Open questions deferred to a future sprint

Captured by Sprint 9 §15 row additions plus pre-existing deferrals:

- **Blue + green + IR LED instances** of the generic `led` device with overridden materials (next sprint candidate; trivial parameter-override work once materials are in place)
- **`led_uv_algan` separate device + UV LED instance** (next sprint candidate; UV deserves its own device per Sprint 10 conversation)
- **White LED** (phosphor-converted) — §15 deferred
- **Heterostructure / QW active-layer modeling** — §15 deferred
- **Laser diodes** — §15 deferred
- **Behavior-derives-value pattern** — user said "check before"

Plus all carried §15 rows from prior sprints.

---

## Sprint 10 opens here

Master tip when opened: `edc1e7c`. Sprint 9's generic `led` + pn_junction interface + role-based composition is the contract Sprint 10 supplies materials for. The materials added here unlock the next sprint's LED instance work without scope creep this sprint. Industry-standard rationale verified directly against Wikipedia LED article (InGaN for blue+green; AlGaInP for red/orange/yellow; AlGaN for UV; GaAs for IR; white LED is structurally different via phosphor coating).
