# v3 Sprint 7 — LED + semiconductor physics

> **Status:** Sprint plan, opened 2026-06-03 against master tip `6ee0d6c`.
> **Predecessor:** v3 Sprint 6 delivered the state-machine pattern + first stateful primitive (switch_spst_toggle). Test count grew 41 → 45.
> **Scope:** complete the canonical first-circuit (battery → wire → switch → resistor → LED → wire → battery) by adding the LED primitive. Requires the model's first compound-semiconductor materials, first non-electrical behavior (photon emission), and the first diode-action behavior. Closes with the educational anchor circuit as a real connected fixture.

---

## Sprint goal

After Sprint 6 the catalog has all components for the first-circuit-everyone-builds *except* the LED. Sprint 7 adds it — and along the way introduces semiconductor physics into the model:

1. **Doped semiconductor materials.** Today's catalog has only intrinsic silicon (Sprint 4). LEDs are made of compound semiconductors with deliberate n-type or p-type doping. Sprint 7 lands the first two doped variants — n-type and p-type AlGaInP (aluminum gallium indium phosphide), the canonical red-LED material.

2. **PN-junction physics as behaviors.** The model gets `acts_as_diode` (current flows in forward bias only) and `emits_light` (radiative recombination releases photons). The latter is the **first non-electrical behavior** in the registry.

3. **LED primitive device.** `led_red_algainp` composes the two AlGaInP variants. PN-junction structure is implicit (composition.uses both doped materials); pn_junction-as-interface-kind is deliberately deferred until multiple semiconductor devices exist.

4. **The educational anchor circuit.** A new connected fixture wires battery_9v_001 → wire_001 → switch_001 → resistor_001 → led_001 → wire_002 → battery_9v_001 (return) using the ad-hoc `connects:` syntax. First time the foundation expresses a complete real-world circuit.

This sprint completes the "real all the way down" demonstration for the simplest functional electronic circuit. Materials cited from NIST/Ioffe/Sze. Behaviors honest-declared (declarative, not evaluative — same pattern as everything else). LED's forward voltage and emission wavelength are parameters today; they derive from junction bandgap when the behavior-derives-value pattern (§15) lands.

---

## Non-goals (explicit)

- **No PN junction as a separate interface kind.** The LED composes both doped materials directly; the junction is implicit. PN-junction-as-interface lands when 2+ semiconductor devices exist and want to share the junction concept.
- **No multi-color LEDs.** Sprint 7 lands red AlGaInP only. Blue (InGaN), green (InGaN), IR (GaAs), UV (AlGaN), white (blue+phosphor) follow the same pattern in Sprint 8+ catalog expansion.
- **No silicon diodes, Schottky diodes, or Zener diodes.** Different junction materials with different reverse-breakdown characteristics; Sprint 8+.
- **No transistors (BJT, MOSFET).** Multi-junction devices with carrier injection or field-effect physics; Sprint 8+.
- **No state-dependent current modeling.** acts_as_diode declares "current flows one direction" without simulating forward/reverse bias states. State-dependent behavior gating (§15 deferred) handles this.
- **No quantitative doping concentration as a structured parameter.** Doped variants are separate materials with their own property values; specific doping levels live in description/notes for now.
- **No LED simulation.** The model declares the LED; nothing evaluates current/voltage/light output given inputs. Future simulator concern.
- **No phosphor coatings, beam patterns, viewing angles, or color temperatures.** Packaging-level concerns, not foundation.
- **No UI, canvas, or physics engine.**

---

## Locked toolchain (inherited from Sprints 2-6)

Node 24 + npm + JSON Schema 2020-12 + Ajv 8 + Vitest + Biome 2 + TypeScript 6 strict. No new dev dependencies expected.

---

## Deliverables

```
fixtures/valid/
├── material-aluminum-gallium-indium-phosphide-n-type.yaml   NEW — n-doped AlGaInP
├── material-aluminum-gallium-indium-phosphide-p-type.yaml   NEW — p-doped AlGaInP
├── behavior-acts-as-diode.yaml                              NEW — forward-bias-only conduction
├── behavior-emits-light.yaml                                NEW — radiative recombination (first non-electrical behavior)
├── device-led-red-algainp.yaml                              NEW — red LED primitive device
├── instance-led-001.yaml                                    NEW — specific 5mm red LED instance
├── instance-wire-002.yaml                                   NEW — return-path wire for the demo circuit
└── instance-wire-001.yaml + instance-switch-001.yaml + instance-resistor-001.yaml + instance-battery-9v-001.yaml + instance-led-001.yaml  UPDATED with connects: blocks wiring them in series
```

OBJECT-MODEL.md may gain a brief mention of semiconductors as a material category if needed — likely added at retro time only if a real concept needs documentation beyond what already exists.

---

## Sub-commit sequence

| # | Commit | Scope |
|---|---|---|
| **S7-v3-1** | `sprints/sprint-7.md` | This plan. |
| **S7-v3-2** | 2 doped AlGaInP materials | aluminum_gallium_indium_phosphide_n_type + aluminum_gallium_indium_phosphide_p_type. Properties: bandgap_energy (~1.9 eV), density, intrinsic-vs-doped resistivity, thermal_conductivity. Provenance from Ioffe NSM Archive + Sze textbook. New capabilities introduced via enables lists (no schema change — capabilities are free strings): `semiconductor`, `n_type_semiconductor` or `p_type_semiconductor`, `direct_bandgap`. |
| **S7-v3-3** | 2 new behaviors | behavior-acts-as-diode.yaml + behavior-emits-light.yaml. First non-electrical behavior (emits_light). Both with cited laws (Shockley diode equation, Planck/de Broglie photon energy). |
| **S7-v3-4** | `device-led-red-algainp.yaml` | led_red_algainp definition. Specific variant (Sprint 6 naming lesson) because junction materials are part of identity. composition.uses both AlGaInP variants. Behaviors: [acts_as_diode, emits_light, conducts_current, has_resistance, produces_joule_heat]. Parameters: forward_voltage, peak_wavelength, max_forward_current, reverse_breakdown_voltage, viewing_angle_optional. |
| **S7-v3-5** | `instance-led-001.yaml` | Specific 5mm through-hole red LED — typical hobbyist part. Forward voltage 2.0V, peak wavelength 640nm, max forward current 20mA. |
| **S7-v3-6** | Educational anchor circuit | NEW `instance-wire-002.yaml` (return path). `connects:` blocks added to wire_001, switch_001, resistor_001, led_001, wire_002, battery_9v_001 wiring them in series. First time the foundation expresses a complete connected real-world circuit. |
| **S7-v3-7** | Sprint 7 retro | Sub-commit log, lessons, new §15 rows. |

---

## Verification discipline (zero-trust, same as Sprints 2-6)

- Every material value cited from real sources (Ioffe NSM Archive for semiconductor properties; Sze 'Physics of Semiconductor Devices' for textbook physics; manufacturer datasheets where applicable).
- Every behavior law traceable to a textbook citation in notes/provenance.
- All three gates (`npm test`, `npx tsc --noEmit`, `npx biome check .`) green before each sub-commit.
- YAML descriptions with `:` get quoted (Sprint 2 + Sprint 4 gotcha — three sprints clean now, discipline holding).

---

## Done criteria

- [ ] 2 doped AlGaInP materials validate against definition.schema.json with cited provenance
- [ ] 2 new behaviors validate against behavior.schema.json
- [ ] `device-led-red-algainp.yaml` validates with composition.uses + 5 behaviors
- [ ] `instance-led-001.yaml` validates; cross-FK confirms zero errors
- [ ] Educational anchor circuit fixture: all 6 instances (battery, 2 wires, switch, resistor, LED) carry consistent `connects:` blocks; the chain forms a complete loop
- [ ] Cross-FK validator reports zero errors on the loaded world
- [ ] `npm test` shows all tests passing (count grows from 45)
- [ ] `npx tsc --noEmit` clean
- [ ] `npx biome check .` clean
- [ ] Sprint retro written

---

## Open questions deferred to Sprint 8+ (or later)

Carried from earlier sprints + likely Sprint 7 surfacers:

- **PN junction as a separate interface kind** — defer until 2+ semiconductor devices exist.
- **Multi-color LEDs** — blue/green InGaN, IR GaAs, UV AlGaN, white LED via phosphor. Sprint 8+ catalog expansion.
- **Silicon diodes, Schottky, Zener** — different junctions/breakdown characteristics.
- **Transistors (BJT, MOSFET)** — multi-junction physics; Sprint 8+.
- **Forward voltage derivation** — V_F ≈ E_g/e; derivation requires behavior-derives-value (§15).
- **Wavelength derivation** — λ = hc/E_g; same pattern.
- **State-dependent behavior gating** (Sprint 6 retro) — forward vs reverse bias.
- **Quantitative doping concentration** — currently in description/notes; structured field deferred until consumer needs it.
- **Net model formalization** — `connects:` syntax remains ad-hoc; Sprint 7's circuit uses it but cross-FK doesn't enforce topology.

Carried-forward §15 rows from prior sprints: default-resolution path, `property_definition` registry, preset/template model, multi-version definitions, cross-pack dependencies, schema migration, stackup, visual symbol library, auto-created interface UX, alloy composition-by-weight, behavior-derives-value, `min_count` enforcement, AV chains, trigger taxonomy enum, multi-pole switches, state-dependent behavior gating.

---

## Sprint 7 opens here

Master tip when opened: `6ee0d6c`. Sprint 6's state-machine pattern + Sprint 4's content stress-test are the immediate precedents — Sprint 7 follows the content pattern (real materials with cited values + new device + instance) without adding new schema fields or new kinds. The PN-junction-as-implicit-composition + semiconductor capabilities via enables list are the simplest honest path. Any gap surfaced is either fixed in-sprint or recorded as a §15 deferred question with a documented fallback.
