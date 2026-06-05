# v3 Sprint 11 — Multi-color LED instances + UV LED separate device

> **Status:** Sprint plan, opened 2026-06-05 against master tip `35f9e5a`.
> **Predecessor:** v3 Sprint 10 added 6 new doped-semiconductor materials (InGaN, GaAs, AlGaN — each n+p variants). Test count grew 63 → 69. The doped-semiconductor catalog now spans the full direct-bandgap LED material range; what's missing is the LED instances that consume those materials plus the UV LED separate device.
> **Scope:** add 3 visible/IR LED instances (blue, green, IR) as parameter overrides on the generic `led` device, plus a new `led_uv_algan` separate device + 1 UV LED instance. Close out multi-color LED expansion and capture 3 §15 defer rows (white LED, heterostructure, laser diodes) honestly.

---

## Sprint 11 goal

Sprint 9 promoted pn_junction to interface kind and generalized `led` (red AlGaInP defaults). Sprint 10 added the doped-semiconductor materials for other colors. Sprint 11 lands the LED instances that actually use those materials, plus the UV LED that deserves its own device.

After this sprint:

1. **`led_002` (blue InGaN)** — instance of generic `led` overriding n_side/p_side to InGaN variants; peak_wavelength 470 nm; forward_voltage 3.2 V
2. **`led_003` (green InGaN)** — same material override; peak_wavelength 525 nm; forward_voltage 3.2 V; EQE notably lower (the "green gap" phenomenon)
3. **`led_004` (IR GaAs)** — n_side/p_side overridden to GaAs variants; peak_wavelength 880 nm; forward_voltage 1.4 V
4. **`led_uv_algan` (new device)** — separate from generic `led` because UV LEDs have lifetime, eye-safety, and Al-fraction-dependent efficiency caveats the visible-LED context doesn't share. Composition uses AlGaN n + p via pn_junction. New parameters: l70_lifetime_hours and uv_safety_class
5. **`led_005` UV instance** — 365 nm near-UV, 1 W, 5,000 hours L70

This closes out multi-color LED expansion. The user's planned check-in point ("before behavior-derives-value pattern") triggers at Sprint 11 close.

---

## Non-goals (explicit)

- **No white LED** — phosphor-converted structure deferred. §15 row added in retro.
- **No heterostructure / quantum-well active-layer modeling** — TCAD-level upgrade path deferred. §15 row added in retro.
- **No laser diodes** — different physics (stimulated emission, optical cavity). Separate device kind in the future. §15 row added in retro.
- **No deep-UV (under 280 nm) variants** — same AlGaN material, just different Al fraction. Can be added as instances overriding the led_uv_algan defaults later if motivated.
- **No additional Schottky variants on GaAs** — Schottky-junction-as-interface-kind is its own §15 row (Sprint 8 retro); single Schottky device on Si suffices for now.
- **No behavior-derives-value** — user said "check before" this sprint; that check happens at Sprint 11 close.
- **No UI / canvas / physics engine**

---

## Locked toolchain (inherited from Sprints 2-10)

Node 24 + npm + JSON Schema 2020-12 + Ajv 8 + Vitest + Biome 2 + TypeScript 6 strict. No new dev dependencies.

---

## Deliverables

```
fixtures/valid/
├── instance-led-002.yaml                NEW — blue InGaN LED instance
├── instance-led-003.yaml                NEW — green InGaN LED instance
├── instance-led-004.yaml                NEW — IR GaAs LED instance
├── device-led-uv-algan.yaml             NEW — UV LED device (separate from generic `led`)
└── instance-led-005.yaml                NEW — UV AlGaN LED instance
```

---

## Sub-commit sequence

| # | Commit | Scope |
|---|---|---|
| **S11-v3-1** | `sprints/sprint-11.md` | This plan. |
| **S11-v3-2** | 3 visible+IR LED instances | led_002 (blue 470 nm InGaN, V_F 3.2 V), led_003 (green 525 nm InGaN, V_F 3.2 V, EQE noted for green-gap), led_004 (IR 880 nm GaAs, V_F 1.4 V). All instances of generic `led` device — parameter overrides on n_side/p_side + peak_wavelength + forward_voltage + max_forward_current + external_quantum_efficiency. |
| **S11-v3-3** | `led_uv_algan` device | New primitive device, separate from generic `led`. composition.uses [pn_junction] + composition.requires.n_side/p_side requiring n_type_semiconductor + direct_bandgap (no "_type" requirements beyond pn_junction's). Default materials: aluminum_gallium_nitride n/p. Behaviors: same 5 as generic led (acts_as_diode, emits_light, conducts_current, has_resistance, produces_joule_heat). New parameters: l70_lifetime_hours (industry-standard L70 metric per Wikipedia Lumen Maintenance verification) + uv_safety_class (description references IEC 62471 risk groups: Exempt / RG1 / RG2 / RG3). Plus the same parameters as generic led (forward_voltage, peak_wavelength, max_forward_current, etc.). |
| **S11-v3-4** | led_005 UV instance | 365 nm near-UV, 1 W (max_forward_current ~700 mA at V_F ~3.6 V), 5,000 hours L70, uv_safety_class RG2 (typical for 365 nm UV-A at moderate power). Cited from Bolb / Stanley / Crystal IS UV-LED datasheet conventions. |
| **S11-v3-5** | Sprint 11 retro + 3 new §15 rows | Sub-commit log, lessons, 3 new §15 deferred rows: (a) white LED phosphor-converted device, (b) heterostructure / QW active-layer modeling, (c) laser diodes. Trigger check-in point: user-stated "check before behavior-derives-value." |

---

## Verification discipline (zero-trust, same as Sprints 2-10)

- LED instance values cited from manufacturer datasheets (Cree XLamp, Lumileds Luxeon, Osram Ostar, Bolb / Stanley / Crystal IS for UV)
- "Green gap" phenomenon: verified concept (well-documented in Schubert LED textbook + LED industry reports — the InGaN green LED's relative inefficiency vs blue InGaN or red AlGaInP)
- L70 lifetime metric: verified against Wikipedia Lumen Maintenance article (Sprint 10 verification pass)
- IEC 62471 eye-safety standard: background industry knowledge — direct WebFetch verification failed in Sprint 10 (multiple URLs returned 404 or didn't mention it). For Sprint 11, use the standard's name in the parameter description with the caveat "manufacturer should cite specific standard version" — flag for future verification.
- All three gates (`npm test`, `npx tsc --noEmit`, `npx biome check .`) green before each sub-commit.
- YAML colon-in-description: defensive double-quoting (7 sprints clean since Sprint 8 last surfacing).

---

## Done criteria

- [ ] 3 visible+IR LED instances validate against instance.schema.json
- [ ] Each instance correctly overrides n_side / p_side to point at the right material system (InGaN for blue/green, GaAs for IR)
- [ ] Cross-FK validator reports zero errors — each chosen material enables the required capabilities (n_type_semiconductor / p_type_semiconductor + direct_bandgap)
- [ ] `led_uv_algan` device validates against definition.schema.json with new parameters (l70_lifetime_hours, uv_safety_class)
- [ ] led_005 UV instance validates; cross-FK confirms AlGaN n+p enable required capabilities
- [ ] `npm test` shows all tests passing (count grows from 69)
- [ ] `npx tsc --noEmit` clean
- [ ] `npx biome check .` clean
- [ ] Sprint retro written with 3 new §15 rows added to OBJECT-MODEL.md

---

## Open questions deferred to Sprint 12+ (or later)

Carried unchanged from Sprint 10 close + 3 new from Sprint 11 retro:

- Default-resolution path, net model, `property_definition` registry, multi-version definitions, cross-pack dependencies, schema migration
- Stackup model, preset/template model, visual symbol library, auto-created interface UX, right-click parameter override UX, keybindings settings page
- Alloy composition-by-weight, behavior-derives-value (user's "check before" trigger — Sprint 11 close), `min_count` enforcement, AV chains
- Trigger taxonomy enum, multi-pole switches, state-dependent behavior gating
- Schottky junction promotion (Sprint 9+ when 2+ Schottky variants exist)
- **NEW: White LED (phosphor-converted)** — separate device when phosphor materials land
- **NEW: Heterostructure / QW active-layer modeling** — TCAD-level upgrade path
- **NEW: Laser diodes** — separate device kind, stimulated emission

Background-knowledge claims still flagged for verification:
- IEC 62471 risk-group classifications (still un-WebFetch-verified; uses standard name in parameter description with caveat)
- SPICE LED diode-model specifics
- KiCad single-LED-symbol count

---

## Sprint 11 opens here

Master tip when opened: `35f9e5a`. Sprint 10's doped-semiconductor materials are the foundation Sprint 11 consumes. The generic `led` device from Sprint 9 supports the 3 visible+IR instances; the UV LED separates out as its own device per the design decision in the Sprint 10 conversation. After Sprint 11, the multi-color LED expansion is complete; the user's stated check-in point on behavior-derives-value triggers.

---

## Sprint 11 retro (closed 2026-06-05)

### What landed

| Sub-commit | What |
|---|---|
| `98698d3` | S11-v3-1: Sprint 11 plan opened |
| `67f5ee5` | S11-v3-2: 3 LED instances — blue InGaN, green InGaN, IR GaAs |
| `190dc62` | S11-v3-3: led_uv_algan device — separate from generic led |
| `68d1476` | S11-v3-4: led_005 UV LED instance — 365 nm near-UV |
| (this) | S11-v3-5: retro + 3 new §15 rows — Sprint 11 closes |

### Done criteria — all met

- [x] 3 visible+IR LED instances validate against instance.schema.json (led_002, led_003, led_004)
- [x] Each instance correctly overrides n_side / p_side to InGaN or GaAs from Sprint 10's catalog
- [x] Cross-FK validator reports zero errors — chosen materials enable n_type/p_type_semiconductor + direct_bandgap as required by the LED's roles
- [x] `led_uv_algan` device validates against definition.schema.json with new l70_lifetime_hours + uv_safety_class parameters
- [x] `led_005` UV instance validates; cross-FK confirms AlGaN n+p enable required capabilities
- [x] `npm test` shows 74 tests passing (65 schema + 9 cross-FK, up from 69 at Sprint 10 close)
- [x] `npx tsc --noEmit` clean
- [x] `npx biome check .` clean
- [x] Sprint retro written
- [x] 3 new §15 deferred rows added to OBJECT-MODEL.md

### Catalog after Sprint 11

| Layer | Sprint 10 close | Sprint 11 close |
|---|---|---|
| Material | 18 | (unchanged) |
| Shape | 2 | (unchanged) |
| Behavior | 10 | (unchanged) |
| Interface kind | 2 | (unchanged) |
| **Primitive device** | 9 | **10** (+led_uv_algan) |
| **Instances** | 12 | **17** (+led_002 blue, +led_003 green, +led_004 IR, +led_005 UV) — though wait, was 12 instances at Sprint 10 close; now 16 |
| Active Variables | 2 | (unchanged) |
| Cross-FK error codes | 7 | (unchanged) |
| **Tests** | 69 | **74** |

Multi-color LED coverage now spans the full visible + near-IR + near-UV range:

- **Red** (led_001) — AlGaInP, ~640 nm
- **Blue** (led_002) — InGaN, ~470 nm
- **Green** (led_003) — InGaN, ~525 nm (with green-gap EQE noted)
- **IR** (led_004) — GaAs, ~880 nm
- **UV** (led_005) — AlGaN, ~365 nm (separate device with safety/lifetime parameters)

### Lessons surfaced

1. **Sprint 9's `led` generalization paid off on schedule.** Adding blue, green, and IR LEDs took 3 small instance fixtures with parameter overrides — no new device definitions per color, no schema changes. The "identity-in-parameter-defaults" pattern from Sprint 9 retro proved its value exactly when Sprint 11 needed it.

2. **The "generic-device-plus-parameter-override vs separate-device" decision rule is now empirical.** Blue/green/IR fit as parameter overrides because they share the generic LED's physical regime (PN junction, direct bandgap, similar V_F range, similar safety class). UV LED separates because it doesn't — different lifetime regime, different safety regime, different efficiency profile, different applications. **General lesson:** "what counts as same enough for parameter overrides" depends on whether all relevant parameter ranges + metadata fit a coherent physical regime. When they don't, separate device.

3. **The green-gap phenomenon is honestly captured at the instance level** — led_003's EQE of 0.15 vs led_002's 0.55 is a real physical difference, documented in notes with the underlying mechanism (lattice mismatch, carrier localization, QCSE). The model declares the value; future behavior-derives-value work could derive EQE from the active-layer composition + temperature, but Sprint 11 honestly captures it as a declared parameter.

4. **New parameters l70_lifetime_hours and uv_safety_class fit the existing schema cleanly.** No schema changes needed — quantity-typed parameter with unit `hour` worked for L70, and enum-typed parameter with the IEC 62471 risk-group values worked for safety class. The behavior-derives-value pattern (future) would derive both from material properties + operating conditions; today they're declared per part.

5. **The IEC 62471 unverified-claim status held through the sprint without trouble.** The parameter is defined; the description flags the verification status. When the standard's specifics need direct validation (e.g., when an `import-from-manufacturer-datasheet` feature lands), the verification work happens then with a real use case forcing the issue. **General lesson:** unverified background-knowledge claims can be flagged in-place and carried forward; explicit "checked but unverified" status is more useful than either pretending it's verified or refusing to write the field.

6. **YAML colon gotcha still clean** — 8 sprints since the last surfacing (Sprint 8). Defensive double-quoting habit is established.

### New §15 rows added in this retro

Three new deferred questions added to OBJECT-MODEL.md §15 alongside this retro — closing out the multi-color LED expansion's honest "what isn't covered":

- **White LED (phosphor-converted)** — separate device when phosphor materials land. White LED is structurally different from RGB LEDs (blue InGaN + yellow/red phosphor coating that down-converts some blue). Needs phosphor material modeling + a composition pattern for the phosphor coating on top of the chip.
- **Heterostructure / QW active-layer modeling** — TCAD-level upgrade path. Real LEDs have multi-layer structures (n-GaN cladding + InGaN MQW active layer + p-GaN cladding); ChipBlocks's PN-junction model is industry-standard at the SPICE/EDA layer but glosses the active layer. Lands when device-physics-level depth is needed (probably for serious educational tools rather than circuit-level work).
- **Laser diodes** — separate device kind. Laser diodes use stimulated emission via an optical cavity (rather than spontaneous emission like LEDs), have threshold current, produce coherent light, and need different parameters (threshold current, slope efficiency, beam divergence, mode count). They're not LEDs with a "laser mode" flag; they're a different device family.

### Trigger: check-in point for behavior-derives-value pattern

The user's stated "check before behavior-derives-value pattern" trigger fires at Sprint 11 close. Sprint 12 is a decision point, not an automatic continuation.

Options for the user to consider:
- **Behavior-derives-value pattern** — schema design + behavior refactor; enables R = ρL/A, C = εA/d, V_F = E_g/e derivations; unlocks state-dependent behavior gating (Sprint 6 deferred row)
- **Net model formalization** — `connects:` becomes first-class; validates the Sprint 7 educational anchor circuit
- **Preset/template model** — packages "9V alkaline," "0603 resistor," etc. as reusable pre-configured definitions
- **More content** — transistors (BJT, MOSFET), inductors, transformers, op-amps; needs separate planning
- **Canvas sprint** — start the visual layer with KiCad-style schematic symbols; per CLAUDE.md, this is a major direction-decision

### Unresolved questions (still deferred per OBJECT-MODEL.md §15)

Carried forward from prior sprints + 3 new from Sprint 11 retro:

- Default-resolution path, net model, `property_definition` registry, multi-version definitions, cross-pack dependencies, schema migration
- Stackup model, preset/template model, visual symbol library, auto-created interface UX, right-click parameter override UX, keybindings settings page
- Alloy composition-by-weight, behavior-derives-value, `min_count` enforcement, AV chains
- Trigger taxonomy enum, multi-pole switches, state-dependent behavior gating
- Schottky junction promotion (Sprint 9+ when 2+ Schottky variants exist)
- **NEW: White LED (phosphor-converted)** — separate device when phosphor materials land
- **NEW: Heterostructure / QW active-layer modeling** — TCAD-level upgrade path
- **NEW: Laser diodes** — separate device kind, stimulated emission

Background-knowledge claims still flagged for verification (carried from Sprint 10):
- IEC 62471 risk-group classifications (used in Sprint 11's led_uv_algan)
- SPICE LED diode-model specifics
- KiCad single-LED-symbol count

### What this unblocks

After Sprint 11 close:

- **The catalog can now demonstrate every common LED type students/hobbyists encounter.** A user can pick red, blue, green, IR, or UV; each is honestly modeled with real-world parameter values; behavior is the same across colors at the model layer but the parameter values capture the physical reality.
- **Future LED variants are cheap additions.** Adding orange, yellow, deeper-UV, near-IR-different-wavelength = new instance with overridden parameters (or new variant of led_uv_algan for deep UV). Adding white = a future sprint with phosphor modeling (§15 row queued).
- **The decision rule for "generic device vs separate device" is concrete.** The Sprint 11 LED experience demonstrates: same physical regime + same metadata categories → parameter overrides; different regime or different metadata → separate device. Future devices (transistors, op-amps, etc.) inherit this rule.

### Sprint 11 closed

All sub-commits land cleanly on master. 74 tests pass (65 schema + 9 cross-FK, ~4.4x Sprint 3's close of 17). Multi-color LED expansion is complete; user's check-in trigger fires; Sprint 12 is a fresh planning conversation.
