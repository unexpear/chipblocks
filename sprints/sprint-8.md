# v3 Sprint 8 — Silicon diodes / Schottky / Zener

> **Status:** Sprint plan, opened 2026-06-03 against master tip `4506b63`.
> **Predecessor:** v3 Sprint 7 added the first compound-semiconductor materials, first non-electrical behavior (emits_light), and the educational anchor circuit. Test count grew 45 → 52.
> **Scope:** add 3 more diode devices (silicon rectifier, Schottky, Zener) that exercise different junction physics. Tests whether the semiconductor pattern from Sprint 7 generalizes across material systems and operating modes. Stress-tests the implicit-PN-junction approach to surface whether pn_junction should promote to a separate interface kind in Sprint 9.

---

## Sprint goal

Sprint 7 landed one semiconductor device (LED on AlGaInP). Sprint 8 tests whether the pattern generalizes by adding three more diodes that each exercise different physics:

1. **Silicon PN-junction rectifier** — same PN-junction pattern as LED but on silicon. Different bandgap (1.12 eV indirect vs 1.9 eV direct), different forward voltage (~0.7V vs ~2.0V), no light emission (silicon's indirect bandgap makes radiative recombination inefficient). Tests whether the implicit-PN-junction approach extends cleanly to a second material system.

2. **Schottky metal-semiconductor diode** — fundamentally different junction physics. Composes a metal (aluminum) + an n-type semiconductor (silicon_n_type) rather than two doped semiconductors. **First device composing a metal with a semiconductor.** Lower forward voltage (~0.3V) and faster reverse recovery (no minority-carrier injection). Tests whether the pattern generalizes beyond PN junctions.

3. **Silicon Zener diode** — same PN structure as the rectifier but operated in reverse breakdown for voltage regulation. **First device whose primary mode is reverse-biased.** Introduces a new behavior (regulates_reverse_voltage) describing the Zener/avalanche breakdown clamp.

After this sprint, the catalog has 4 semiconductor devices (LED + 3 diodes) all using `acts_as_diode`. If the pattern holds cleanly, the §15 row promoting pn_junction to an interface kind becomes the natural Sprint 9 deliverable. If it doesn't, Sprint 8 surfaces what's missing.

---

## Non-goals (explicit)

- **No PN junction promotion to interface kind.** Captured in retro for Sprint 9 if Sprint 8 confirms the pattern needs it.
- **No schottky_junction as a separate interface kind.** Same — promotes once 2+ Schottky devices justify it.
- **No state-dependent behavior gating.** Zener uses both forward and reverse bias modes; rectifier uses one. The same future gating mechanism handles both. §15 carried.
- **No multi-junction devices (BJT, MOSFET).** Sprint 9+.
- **No fast-recovery / high-power / bridge rectifier devices.** Catalog expansion later.
- **No TVS diodes, varactors, varistors.** Different applications; future.
- **No update to the Sprint 7 educational anchor circuit.** Sprint 7's demo stays canonical; future sprints add new demo circuits when motivated (Zener regulator, rectifier bridge, etc.).
- **No UI, canvas, or physics engine.**
- **No teaching mode / walkthrough classes.** Deferred to post-canvas-sprint per user direction — lessons need the visual layer (schematic symbols + layout canvas) to be effective.

---

## Locked toolchain (inherited from Sprints 2-7)

Node 24 + npm + JSON Schema 2020-12 + Ajv 8 + Vitest + Biome 2 + TypeScript 6 strict. No new dev dependencies expected.

---

## Deliverables

```
fixtures/valid/
├── material-silicon-n-type.yaml             NEW — n-doped silicon
├── material-silicon-p-type.yaml             NEW — p-doped silicon
├── behavior-regulates-reverse-voltage.yaml  NEW — Zener-mode regulation
├── device-diode-silicon-rectifier.yaml      NEW — silicon PN rectifier
├── instance-diode-001.yaml                  NEW — 1N4001-class instance
├── device-diode-schottky-al-si.yaml         NEW — Schottky metal-semiconductor
├── instance-diode-002.yaml                  NEW — 1N5817-class instance
├── device-diode-zener-silicon.yaml          NEW — Si Zener regulator
└── instance-diode-003.yaml                  NEW — 5.1V Zener instance
```

OBJECT-MODEL.md updates expected only at retro time if Sprint 8 surfaces something new.

---

## Sub-commit sequence

| # | Commit | Scope |
|---|---|---|
| **S8-v3-1** | `sprints/sprint-8.md` | This plan. |
| **S8-v3-2** | 2 doped silicon materials | silicon_n_type + silicon_p_type. Same intrinsic bandgap as the Sprint 4 intrinsic silicon entry (1.12 eV indirect — silicon does NOT enable direct_bandgap). Doped resistivity orders of magnitude lower than intrinsic. Provenance from Ioffe NSM Archive + Sze. |
| **S8-v3-3** | `regulates_reverse_voltage` behavior | New behavior in the registry. Avalanche or Zener breakdown clamps reverse voltage at V_zener while conducting current. Cited from Sze + standard semiconductor physics references. Used by Zener (S8-v3-6). |
| **S8-v3-4** | `diode_silicon_rectifier` + instance | composition.uses [silicon_n_type, silicon_p_type]. Behaviors [acts_as_diode, conducts_current, has_resistance, produces_joule_heat]. Parameters: forward_voltage (~0.7V), max_forward_current, peak_inverse_voltage, reverse_recovery_time. Instance: 1N4001-class (1 A, 50 V PIV). |
| **S8-v3-5** | `diode_schottky_al_si` + instance | **First metal-semiconductor composition.** composition.uses [aluminum, silicon_n_type]. Same behaviors as PN diode but with parameter values reflecting Schottky physics: forward_voltage (~0.3V), faster reverse_recovery_time. Instance: 1N5817-class (1 A, 20 V PIV). |
| **S8-v3-6** | `diode_zener_silicon` + instance | composition.uses [silicon_n_type, silicon_p_type] (same as rectifier — Zener is a PN junction designed for controlled breakdown). Behaviors [acts_as_diode, regulates_reverse_voltage, conducts_current, has_resistance, produces_joule_heat]. Parameters: zener_voltage (the operating point), max_zener_current, knee_current. Instance: 5.1 V regulator-class. |
| **S8-v3-7** | Sprint 8 retro | Sub-commit log, lessons, new §15 rows. The PN-junction promotion question gets resolved (recommend Sprint 9 or hold) based on what duplication Sprint 8 exposed. |

---

## Verification discipline (zero-trust, same as Sprints 2-7)

- Silicon properties cited from Ioffe NSM Archive + Sze 'Physics of Semiconductor Devices' 3rd ed. + manufacturer datasheets (1N4001, 1N5817, 1N4733A class parts).
- Schottky physics cited from Sze + manufacturer technical notes (Vishay, ST Micro, ON Semi).
- Zener/avalanche breakdown cited from Sze + standard breakdown-voltage tables for the target zener_voltage.
- All three gates (`npm test`, `npx tsc --noEmit`, `npx biome check .`) green before each sub-commit.
- YAML descriptions with `:` get quoted (defensive habit through 5 sprints clean).

---

## Done criteria

- [ ] 2 doped silicon materials validate against definition.schema.json with cited provenance
- [ ] `regulates_reverse_voltage` behavior validates against behavior.schema.json
- [ ] 3 diode devices validate (rectifier, Schottky, Zener)
- [ ] 3 diode instances validate; cross-FK confirms zero errors on each (chosen materials enable required capabilities)
- [ ] `npm test` shows all tests passing (count grows from 52)
- [ ] `npx tsc --noEmit` clean
- [ ] `npx biome check .` clean
- [ ] Sprint retro written
- [ ] PN-junction-promotion decision documented in retro (Sprint 9 candidate or hold)

---

## Open questions deferred to Sprint 9+ (or later)

Likely surfaced by Sprint 8 and captured at retro time:

- **PN junction promotion to interface kind** — confirmed by Sprint 8's duplication or deferred further.
- **schottky_junction as a separate interface kind** — when 2+ Schottky devices exist.
- **State-dependent behavior gating** — forward-bias vs reverse-bias modes (carried).

Carried-forward §15 rows from prior sprints: default-resolution path, net model, `property_definition` registry, multi-version definitions, cross-pack dependencies, schema migration, stackup, preset/template, visual symbol library, auto-created interface UX, alloy composition-by-weight, behavior-derives-value, `min_count` enforcement, AV chains, trigger taxonomy enum, multi-pole switches, state-dependent behavior gating, multi-color LED catalog.

Post-canvas-sprint commitment: **teaching mode / walkthrough classes** (batteries, resistors, wire, switches as first four lessons). Per user direction, lessons need schematic symbols + layout canvas before they're useful — lands after canvas sprint.

---

## Sprint 8 opens here

Master tip when opened: `4506b63`. Sprint 7's semiconductor pattern is the immediate precedent — Sprint 8 stress-tests it with 3 more diode devices spanning different junction physics. The plan is content-only (no new schemas, no new kinds, one new behavior). Any gap surfaced is either fixed in-sprint or recorded as a §15 deferred question with a documented fallback.

---

## Sprint 8 retro (closed 2026-06-03)

### What landed

| Sub-commit | What |
|---|---|
| `cb5290f` | S8-v3-1: Sprint 8 plan opened |
| `3d03ed2` | S8-v3-2: 2 doped silicon materials (n-type + p-type) |
| `8597d58` | S8-v3-3: regulates_reverse_voltage behavior |
| `a08a9d1` | S8-v3-4: diode_silicon_rectifier device + instance (1N4001-class) |
| `bbf5978` | S8-v3-5: diode_schottky_al_si device + instance (1N5817-class — first metal-semiconductor composition) |
| `cdce8d6` | S8-v3-6: diode_zener_silicon device + instance (1N4733A-class — first regulates_reverse_voltage consumer) |
| (this) | S8-v3-7: retro — Sprint 8 closes |

### Done criteria — all met

- [x] 2 doped silicon materials validate against definition.schema.json with cited provenance from Ioffe NSM Archive + Sze
- [x] `regulates_reverse_voltage` behavior validates against behavior.schema.json
- [x] 3 diode devices validate (rectifier with PN-Si, Schottky with metal-semiconductor, Zener with PN-Si + regulates behavior)
- [x] 3 diode instances validate; cross-FK confirms zero errors on each (chosen materials exist and enable required capabilities)
- [x] `npm test` shows 61 tests passing (53 schema + 8 cross-FK, up from 52 at Sprint 7 close)
- [x] `npx tsc --noEmit` clean
- [x] `npx biome check .` clean
- [x] Sprint retro written
- [x] PN-junction-promotion decision documented in retro (recommendation: Sprint 9)

### Catalog after Sprint 8

| Layer | Sprint 7 close | Sprint 8 close |
|---|---|---|
| Material | 10 | **12** (+ silicon_n_type, silicon_p_type) |
| Shape | 2 | (unchanged) |
| Behavior | 9 | **10** (+ regulates_reverse_voltage) |
| Interface kind | 1 | (unchanged) |
| Primitive device | 6 | **9** (+ diode_silicon_rectifier, diode_schottky_al_si, diode_zener_silicon) |
| Instances | 9 | **12** (+ diode_001, diode_002, diode_003) |
| Active Variables | 2 | (unchanged) |
| Cross-FK error codes | 7 | (unchanged) |

### Lessons surfaced

1. **The doped-semiconductor pattern reproduces cleanly across material systems.** AlGaInP (Sprint 7) and silicon (Sprint 8) follow the identical shape — intrinsic base + n-doped + p-doped variants, each with its own properties and provenance. **General lesson:** the pattern scales; future material systems (InGaN, GaAs, SiC, GaN-on-Si) follow the same recipe.

2. **Metal-semiconductor composition worked without schema change.** Schottky's `composition.uses: [aluminum, silicon_n_type]` validated identically to PN-junction devices' `composition.uses: [silicon_n_type, silicon_p_type]`. Cross-FK doesn't yet distinguish "metal" from "semiconductor" in composition.uses — both are simply materials with the right kind. The distinction becomes enforceable when schottky_junction promotes to interface kind. **General lesson:** the composition.uses list is currently loose enough to admit any material combinations; structural typing (which-side-is-which) is the future enhancement.

3. **The same behavior covers different parameter regimes cleanly.** acts_as_diode powers LED (V_F ~2.0V, direct-bandgap photon emission), silicon rectifier (V_F ~0.7V, ~us recovery), Schottky (V_F ~0.32V, ~10ns recovery), and Zener forward mode. **The behavior describes the physics archetype; the parameters describe the specific characteristics.** This is the right shape — adding a new device type (faster Schottky, higher-power rectifier, special Zener) is a parameter-value change, not a new behavior. **General lesson:** keep behaviors physics-archetype-level; let parameters do device-specific work.

4. **The 3-device PN-junction-pattern test is conclusive.** LED + silicon rectifier + Zener all use `composition.uses: [<material>_n_type, <material>_p_type]`. The duplication is real and growing — when MOSFETs/BJTs land in Sprint 9+, each will have 2-3 of the same junction-composition incantations. **Recommendation: Sprint 9 promotes pn_junction to a first-class interface kind** with composition.requires { n_side: material must_enable [n_type_semiconductor]; p_side: material must_enable [p_type_semiconductor] }. The existing §15 row's trigger condition is met.

5. **Schottky deserves its own interface kind.** Metal-semiconductor junction physics is fundamentally different from PN. When 2+ Schottky devices exist (likely Sprint 9 or 10 — high-voltage Schottky on SiC, RF Schottky on GaAs), schottky_junction should land alongside pn_junction. **§15 row added** for this.

6. **regulates_reverse_voltage is the right shape for Zener.** Captures the deliberate operating-in-breakdown mode without conflating with acts_as_diode. The Zener uses BOTH behaviors honestly — acts_as_diode for forward/reverse-blocking-below-V_zener; regulates_reverse_voltage for reverse-conducting-at-V_zener. Same pattern will work for TVS diodes, voltage references (TL431 class), and gas-discharge tubes. **General lesson:** when a device has multiple distinct operating modes, each mode is its own behavior; the device lists all of them honestly.

7. **The YAML colon-in-description gotcha STILL keeps re-surfacing.** Third occurrence in Sprint 8 (S8-v3-6 — the Zener fixture's `zener_voltage` parameter had `voltages:` inside the description). Sprint 2's ref-in-default was the first; Sprint 4's Thevenin description was the second. The defensive quoting habit catches it after running tests, but it should be a permanent rule contributors are aware of upfront. **Recommendation:** add to CLAUDE.md code style section (or future CONTRIBUTING.md) when contributor docs land.

8. **State-dependent behavior gating is increasingly urgent.** Zener has THREE operating modes (forward conducting, reverse blocking below V_zener, reverse regulating above V_zener). Today all relevant behaviors are listed honestly-but-ungated. The §15 row from Sprint 6 grows in priority as devices with multiple modes (Zener, future MOSFETs, future TVS diodes, future flip-flops with set/reset modes) accumulate.

### New §15 rows added in this retro

One new deferred question surfaced; added to OBJECT-MODEL.md §15 alongside this retro:

- **Schottky junction as a separate interface kind.** Mirror of the existing PN junction row but for metal-semiconductor junctions. Lands when 2+ Schottky devices exist; brings distinct metal_side and semiconductor_side roles with appropriate must_enable constraints.

The existing **PN junction promotion row** from Sprint 7 retro has its trigger condition met. **Sprint 9 recommendation: promote pn_junction to interface kind** as the natural next step.

### Unresolved questions (still deferred per OBJECT-MODEL.md §15)

Carried forward from earlier sprints + Sprint 8 additions:

- Default-resolution path, net model, `property_definition` registry shape, multi-version definitions, cross-pack dependencies, schema migration story
- Stackup model, preset/template model, visual symbol library, auto-created interface UX pattern
- Alloy composition-by-weight schema field, behavior-derives-value pattern, `min_count` enforcement, AV → AV chains
- Trigger taxonomy as enum, multi-pole switches, state-dependent behavior gating (Sprint 8 raises urgency)
- PN junction as a separate interface kind (Sprint 7 row, **Sprint 8 confirms readiness — recommended for Sprint 9**)
- Multi-color LED catalog expansion
- **NEW: Schottky junction as a separate interface kind** (Sprint 9+ when 2+ Schottky devices exist)

Smaller items captured in retro notes only:
- Zener temperature coefficient parameter (refinement for precision references)
- BJT, MOSFET, JFET, IGBT (multi-junction or field-effect devices) — Sprint 9-10+
- High-voltage Schottky on SiC, RF Schottky on GaAs (catalog expansion)
- Forward-only diodes' state-dependent gating

Contributor-process item:
- **YAML colon-in-description rule** for CLAUDE.md code style section, when ready.

### What this unblocks

After Sprint 8 close:

- **PN junction promotion case is conclusive.** Three semiconductor devices use the same composition pattern; promoting pn_junction to interface kind in Sprint 9 reduces duplication AND makes the junction's physical role explicit.
- **Schottky pattern proven for metal-semiconductor composition.** Future metal-junction devices (other Schottky metals, metal contacts on different semiconductors, ohmic contacts) follow the established pattern.
- **The diode catalog covers the main use cases.** Silicon rectifier for AC-to-DC + freewheeling; Schottky for fast switching + low-loss; Zener for voltage regulation. These three cover most hobbyist and many production designs. Specialty diodes (LED, TVS, varactor, photodiode, laser diode) extend this base.
- **The semiconductor physics path is established.** Sprint 9's natural picks (BJT, MOSFET) reuse the doped-material + PN-junction patterns proven in Sprints 7-8. Multi-junction devices add complexity in terms of internal structure but not in terms of material modeling.

### Sprint 8 closed

All sub-commits land cleanly on master. 61 tests pass (53 schema + 8 cross-FK, ~3.6× Sprint 3's close of 17). The diode family is complete enough to cover most hobbyist designs. Sprint 9's natural picks: **PN junction promotion** (the schema refactor surfaced by Sprint 8), **BJT/MOSFET** (multi-junction devices), or **net model formalization** (validates the educational anchor circuit's connects:).
