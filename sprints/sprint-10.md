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

---

## Sprint 10 retro (closed 2026-06-05)

### What landed

| Sub-commit | What |
|---|---|
| `4148bcb` | S10-v3-1: Sprint 10 plan opened |
| `458b5e7` | S10-v3-2: InGaN n+p materials — blue and green LED foundation |
| `610edb3` | S10-v3-3: GaAs n+p materials — IR LED and high-frequency electronics foundation |
| `cbf6d9d` | S10-v3-4: AlGaN n+p materials — UV LED foundation across UV-A to deep-UV |
| (this) | S10-v3-5: retro — Sprint 10 closes |

### Done criteria — all met

- [x] 6 new doped-semiconductor materials validate against definition.schema.json with cited provenance
- [x] Each n-type variant enables [electrical_conduction, thermal_conduction, semiconductor, n_type_semiconductor, direct_bandgap]
- [x] Each p-type variant enables [electrical_conduction, thermal_conduction, semiconductor, p_type_semiconductor, direct_bandgap]
- [x] All bandgaps tagged direct (LED-suitable — contrast with silicon's indirect 1.12 eV)
- [x] `npm test` shows 69 tests passing (60 schema + 9 cross-FK, up from 63 at Sprint 9 close)
- [x] `npx tsc --noEmit` clean
- [x] `npx biome check .` clean
- [x] Sprint retro written

### Catalog after Sprint 10

| Layer | Sprint 9 close | Sprint 10 close |
|---|---|---|
| **Material** | 12 | **18** (+6 doped semiconductors) |
| Shape | 2 | (unchanged) |
| Behavior | 10 | (unchanged) |
| Interface kind | 2 | (unchanged) |
| Primitive device | 9 | (unchanged) |
| Instances | 12 | (unchanged) |
| Active Variables | 2 | (unchanged) |
| Cross-FK error codes | 7 | (unchanged) |
| Tests | 63 | **69** |

The catalog now has direct-bandgap doped semiconductors covering the full visible + IR + UV LED range:

- AlGaInP (Sprint 7): red / orange / yellow (1.9 eV typical)
- InGaN (Sprint 10): blue / green (2.4-2.7 eV range — In fraction varies)
- GaAs (Sprint 10): near-IR (1.42 eV, ~870 nm)
- AlGaN (Sprint 10): UV-A through deep-UV (3.4-6.0 eV range — Al fraction varies)

### Lessons surfaced

1. **The doped-semiconductor pattern scales clean across material systems.** AlGaInP (Sprint 7), silicon (Sprint 8), InGaN + GaAs + AlGaN (Sprint 10) — same shape, same properties (bandgap + resistivity + density + thermal conductivity + carrier mobility), same enables-list pattern, same provenance discipline (Ioffe NSM Archive + Sze + Schubert). **General lesson:** the foundation's material pattern is mature; adding new material systems is incremental, not architectural.

2. **Industry-standard verification reshaped the design framing.** Pre-verification, I was calling the simplified PN-junction model a "simplification" — implying it falls short of "real" modeling. Direct verification against Wikipedia LED article showed this IS the industry standard at the SPICE/EDA circuit-modeling layer; heterostructure modeling lives at TCAD/device-physics layer (a different discipline entirely). **General lesson:** "follow industry standard" needs the layer to be specified — what's standard at circuit level isn't what's standard at device-physics level. Both are valid; ChipBlocks works at the circuit level with educational depth into materials.

3. **The p-type doping difficulty story is unique to III-nitrides and gets captured per-material.** Silicon p-type is straightforward (~3x resistivity vs n-type). GaAs p-type is well-behaved (~3-5x). InGaN p-type is 10-100x (deep Mg acceptor, ~170 meV). AlGaN p-type is 100-10,000x and effectively non-functional above x ~ 0.5 (Mg deepens to 500-600 meV). The catalog now carries this physical truth honestly per material — each variant's resistivity range + notes explain WHY p-type behaves as it does in that material system.

4. **Range-typed bandgap captures real composition variability.** InGaN and AlGaN both use `kind: range` for bandgap_energy (covering the In or Al fraction variation across LED-relevant compositions). AlGaInP and GaAs use `kind: condition_bound` with single scalar (these are typically used in narrower composition ranges). Same value-kind system, different value kinds picked for the physical reality. **General lesson:** the value-kind polymorphism from §7 keeps proving useful — different kinds fit different physical-modeling situations cleanly.

5. **Wikipedia verification has limits.** Material systems by color: verified cleanly. L70 lifetime metric: verified. IEC 62471 eye-safety standard + SPICE-LED-model specifics + KiCad single-LED-symbol claims: WebFetch verification failed (404s and missing-content responses on multiple URLs). These remain background-knowledge claims, flagged for direct verification when canvas/export work needs them. **General lesson:** zero-trust verification works for major claims; for finer details, sometimes the canonical source is paywalled (IEC) or not on Wikipedia and we have to be honest about which claims are background vs verified.

6. **YAML colon-in-description gotcha did NOT re-surface in Sprint 10.** Seven sprints clean (Sprint 5, 6, 7, 9, 10 fine; Sprint 8 caught one). Defensive double-quoting habit holds.

### New §15 rows added in this retro

**None.** Sprint 9's retro already added the §15 rows that Sprint 10 work would have surfaced (LED instances via overrides, led_uv_algan separate device, white LED, heterostructure, laser diodes, right-click UX, keybindings). Sprint 10 was pure content within the existing model; no new design questions emerged.

### Unresolved questions (still deferred per OBJECT-MODEL.md §15)

Carried unchanged from Sprint 9 close:
- Default-resolution path, net model, `property_definition` registry, multi-version definitions, cross-pack dependencies, schema migration
- Stackup model, preset/template model, visual symbol library, auto-created interface UX, right-click parameter override UX, keybindings settings page
- Alloy composition-by-weight, behavior-derives-value (user said 'check before' — comes after multi-color LED work), `min_count` enforcement, AV chains
- Trigger taxonomy enum, multi-pole switches, state-dependent behavior gating
- PN junction promotion (DONE in Sprint 9), Schottky junction promotion (Sprint 9+ when 2+ Schottky variants exist)
- White LED phosphor-converted (separate device when phosphor materials land)
- Heterostructure / QW active-layer modeling (TCAD-level upgrade path)
- Laser diodes (separate device kind, stimulated emission)
- Multi-color LED expansion — partially addressed by Sprint 10's materials; LED instances + UV separate device remain queued

Background-knowledge claims flagged for future direct verification:
- IEC 62471 eye-safety standard's specific risk-group classification — needed when `led_uv_algan` parameter `uv_safety_class` lands
- SPICE LED diode-model specifics — needed when KiCad export or SPICE compatibility becomes a real feature
- KiCad single-LED-symbol count — needed when canvas + EDA export lands

### What this unblocks

After Sprint 10 close:

- **Multi-color LED instance sprint is unblocked.** Blue / green / IR LED instances can be added as parameter overrides on the generic `led` device, picking n_side / p_side from InGaN / GaAs.
- **UV LED separate device is unblocked.** `led_uv_algan` can land when planned, using AlGaN n + p materials. It deserves its own device because of lifetime + eye-safety + Al-fraction-dependent efficiency caveats that the generic `led` doesn't share.
- **Future high-frequency electronics is unblocked.** GaAs n + p enable future HEMT, pHEMT, GaAs Schottky variants, GaAs solar cells.
- **The doped-semiconductor catalog is comprehensive for visible + near-IR + UV applications.** Adding more (deep-IR for telecom, SiC for power, GaN-on-Si for high-power) follows the same pattern when motivated.

### Sprint 10 closed

All sub-commits land cleanly on master. 69 tests pass (60 schema + 9 cross-FK, ~4x Sprint 3's close of 17). Sprint 10 was Sprint 9's natural follow-up — materials-only, no scope creep, no new design questions, the foundation pattern continuing to scale. Next sprint candidates: multi-color LED instances (small), led_uv_algan separate device (medium), behavior-derives-value (user said 'check before'), or net model formalization.
