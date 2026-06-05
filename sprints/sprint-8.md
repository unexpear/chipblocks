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
