# Sprint Plan: Sprint 3 — Primitive devices + cross-FK validator

> **Status:** HISTORICAL. Superseded by OBJECT-MODEL.md (2026-05-20) for active planning. Preserved as project history.

> Opened 2026-05-16, immediately after the Sprint 2 audit-cleanup commit (`4600f01`). This is the plan-only opening of Sprint 3; implementation has not started.
>
> **Scope intentionally narrowed** from the Sprint 2 retro's surfacing #1, which bundled `devices.yaml` + universal object model spec + project file format spec + save/load roundtrip. Sprint 3 now keeps **devices + cross-FK validator only**. Object model + project format defer (see Deferred section).

---

## Sprint goal

*Define primitive devices and prove cross-reference validation from devices → materials / shapes / interfaces / behaviors / signals / parameters. After Sprint 3, every primitive device in the catalog has a valid composition chain down to Layer 0 materials and Layer 3 behaviors, and the validator refuses to ship a `devices.yaml` that references anything missing.*

---

## Non-goals (explicit)

- No full circuit solver — Sprint 5 work
- No Ohm's law / KCL / KVL computation — schema validates structure only, not physics
- No canvas palette — Sprint 4 work; nothing ships to the palette unless cross-FK is green
- No manufacturing ZIP — Sprint 6 work
- No AI generation changes
- **No `ref:` form on parameter instance values yet.** `devices.yaml` lists parameter REQUIREMENTS at the blueprint level (e.g., "every resistor has a parameter named `resistance` of type `quantity` in `ohm`"); concrete instance values (`resistance: { value: 4700, units: ohm }` or `resistance: { ref: led_current_limit_R }`) come at instance-placement time in Sprint 4+
- No `OBJECT-MODEL.md` or `PROJECT-FORMAT.md` — defer to Sprint 3.5 or Sprint 4
- No save/load roundtrip — defer
- No inductor or diode — narrower 6-device set than the 8-device set in the Sprint 2 retro

---

## Device manifest shape (draft, locks at S3-1)

Each row in `devices.yaml` is the BLUEPRINT for a primitive device — what it composes from, what parameters it requires, what signals it speaks. Concrete instance values land at instance-placement time, not here.

```yaml
- id: resistor                                    # required, lowercase snake_case
  label: "Resistor"                                # required, human-readable
  layer: primitive_device                          # required, fixed enum: primitive_device

  # Composition references — every entry cross-FK validated against its target manifest
  materials:
    allowed: [carbon_film, metal_film, nichrome]   # materials.yaml IDs
  shapes:
    allowed: [cylinder, thin_film]                  # shapes.yaml IDs
  interfaces:
    required: { terminal: 2 }                       # interfaces.yaml ID → count
  behaviors:
    required: [conducts, resists, heats]            # behaviors.yaml IDs
  signals:
    compatible: [dc-voltage, dc-current]            # signals.yaml IDs (kebab-case)

  # Parameter blueprint — name + type + units for each runtime parameter
  parameters:
    required:
      - { name: resistance, type: quantity, units: ohm }
      - { name: power_rating, type: quantity, units: W }

  notes: "..."                                      # optional
```

### Open shape questions (S3-1 locks)

1. `interfaces.required`: map `{ id: count }` (as drafted) — or list `[{ kind: terminal, count: 2, role: a|b }]`? Map is simpler; list lets us name terminals (anode/cathode for LED). **Lean: start with map; LED in S3-6 forces the upgrade if needed.**
2. `parameters.required[*].type`: enum `quantity | string | enum | bool` to match `parameters.yaml`. Quantity requires `units`; enum requires `allowed`. **Lean: lock this form in S3-1.**
3. `materials.allowed`: array of IDs vs map (per-material parameter overrides)? **Lean: start with array; revisit if a device needs per-material defaults.**
4. `behaviors.required` order significance? **Lean: unordered set; behaviors are independent rules.**

---

## Primitive device seed set (implementation order)

| # | id | Why this order |
|---|---|---|
| 1 | `wire` | Every other device depends on conduction. Wrong here → muddy everywhere. |
| 2 | `resistor` | First device proving full materials/shapes/parameters composition. Forces `metal_film` + `nichrome` material entries (only `carbon_film` ships today). |
| 3 | `switch` | First device with state — adopts `switches` behavior. No new materials. |
| 4 | `power_source` | First voltage supply — adopts `supplies_voltage`. Forces a decision: battery as external object or as a material/component. |
| 5 | `LED` | First device with light emission — adopts `led_emits_light` + `conducts` + `insulates` + `heats`. Tests `optical` signal compatibility. May force the `interfaces.required` map → list upgrade for anode/cathode. |
| 6 | `capacitor` | First multi-material device (plate material + dielectric material). Tests composition with multiple materials. |

---

## Cross-reference validation rules (load-bearing)

The new hard rule:

> **A device manifest fails if it references any missing material, shape, interface, behavior, signal, or parameter.**

Specifically, the cross-FK validator checks:

- Every `materials.allowed[i]` exists as an id in `materials.yaml`
- Every `shapes.allowed[i]` exists as an id in `shapes.yaml`
- Every key of `interfaces.required` exists as an id in `interfaces.yaml`
- Every `behaviors.required[i]` exists as an id in `behaviors.yaml`
- Every `signals.compatible[i]` exists as an id in `signals.yaml`

Soft (hint-only, not blocker): `parameters.required[i].name` MAY match a default Active Variable in `parameters.yaml`, but isn't required to — device parameters are device-specific (a resistor has `resistance`; `parameters.yaml` ships environmental/electrical defaults, not per-device defaults).

**Implementation:** extend `frontend/test/manifests.test.ts` with a `devices` describe block that runs the cross-FK check. No separate validator file. Optionally also wire cross-FK into `scripts/codegen-manifests.mjs` so the codegen step (and therefore the drift CI gate) fails on a broken reference — decided in S3-1.

**Negative-case test (S3-1):** a fixture `devices.yaml` snippet with a deliberately-typo'd material id must produce a clear failure message naming the missing reference.

---

## Implementation steps

| # | Commit | Scope |
|---|---|---|
| **S3-1** | `devices.schema.json` + cross-FK validator infra | Schema for the device-manifest shape (no rows yet). Cross-FK validator helper. Negative-case test (typo'd FK fails with clear message). Shape questions above locked. |
| **S3-2** | `wire` | First device row. References `wire_path` shape, 2 terminals, `conducts` behavior, dc-voltage/dc-current/digital signal compatibility. |
| **S3-3** | `resistor` + materials growth | Adds `metal_film` and `nichrome` to `materials.yaml` (full provenance per Sprint 2 rule). Resistor row references all 3 resistive materials. |
| **S3-4** | `switch` | Adopts `switches` + `conducts` (closed) + `insulates` (open). |
| **S3-5** | `power_source` | Adopts `supplies_voltage`. Resolves battery-as-material vs battery-as-external decision. |
| **S3-6** | `LED` | Adopts `led_emits_light` + `conducts` + `insulates` + `heats` + optical signal compatibility. May upgrade `interfaces.required` to list form for anode/cathode. |
| **S3-7** | `capacitor` | First multi-material device (plate conductor + dielectric). May add shape/interface clarifications. |
| **S3-8** | `SPRINT-3.md` retro | Sprint 3 closes. |

---

## Done criteria

- [ ] `devices.yaml` validates against `devices.schema.json`
- [ ] All FK references in `devices.yaml` resolve to entries in their target manifest (cross-FK passes)
- [ ] Generated TS module `_generated/devices.ts` is drift-clean (`npm run codegen` passes)
- [ ] `npx tsc --noEmit` passes
- [ ] `npm test` passes (existing 47 + new devices-block tests)
- [ ] Each primitive device row has at least one material, one shape, one interface kind, one behavior, one signal-compatibility entry, one parameter
- [ ] Negative-case test: a fixture with a typo'd material id fails the cross-FK validator with a message naming the missing reference
- [ ] CI drift check still passes
- [ ] All 6 primitive devices in the canonical seed set are present and resolve cleanly

---

## Manual checks (eyeball)

- `frontend/src/manifests/_generated/devices.ts` is well-formed and imports cleanly
- `import { devices } from '@/manifests'` resolves with the right `DevicesManifest` type
- Each device row reads correctly when printed (no obvious typo, no missing field)
- Citations for any new materials added in S3-3 are real (per Sprint 2 rule)

---

## Canonical end-to-end demo (target enabled by Sprint 3)

Sprint 3 doesn't ship the demo — Sprint 5's validator + Sprint 6's canvas do. But every device row authored in this sprint is written with this circuit in mind, because it's the load-bearing test case for the entire 9-layer stack:

```
[battery 5V] ── [switch] ── [resistor R] ── [LED] ── back to battery
```

The textbook current-limiting calculation the Sprint 5 validator will run, derived from KVL (`V_source = V_R + V_forward`) and Ohm (`V_R = I × R`):

```
R = (V_source - V_forward) / I
```

### Every term already has a home in the manifests

| Symbol | Source in ChipBlocks |
|---|---|
| `V_source` | `power_source.voltage` parameter (declared in S3-5) ← can ref Active Variable `default_supply_5v` (cited to USB-IF 2.0 §7.2.4) |
| `V_forward` | `LED.forward_voltage` parameter required by [`led_emits_light`](behaviors.yaml) behavior (declared in S3-6) |
| `I` | Active Variable `target_max_led_current = 20 mA` (already in [parameters.yaml](parameters.yaml), cited to Cree/Kingbright/OSRAM 5mm THT LED datasheets) |
| `R` | `resistor.resistance` parameter required by [`conducts`](behaviors.yaml) behavior (declared in S3-3) |

### Concrete number with shipped defaults

- `V_source = 5.0 V` (USB rail, cited)
- `V_forward = 2.0 V` (typical red LED, cited datasheet entered in S3-6)
- `I = 0.020 A` (20 mA, cited)
- **`R = (5.0 − 2.0) / 0.020 = 150 Ω`**

### What the Sprint 5 validator should do with this circuit

1. Compute `R_recommended = 150 Ω`
2. Flag any user-placed `R < ~120 Ω` as **"current exceeds LED max — failure mode"** (red error)
3. Flag any user-placed `R > ~300 Ω` as **"current below visible threshold — warning"** (yellow warn)
4. Show the cross-FK chain resolving end-to-end: `power_source → switch → resistor → LED`, each device's behaviors firing, each parameter typed and cited

### Why this matters for Sprint 3 specifically

Every device authored this sprint must declare the right behaviors, parameters, and FK references for the demo to compute. If the Sprint 5 validator can't reach R = 150 Ω end-to-end from real shipped data using only the Sprint 3 device rows, something in the manifests is wrong. The cross-FK validator at S3-1 catches *name resolution* bugs; this canonical demo is what catches *semantic composition* bugs.

Devices in Sprint 3 that this demo depends on (in author order):
- `wire` (S3-2) — terminals + `conducts` behavior; closes the loop
- `resistor` (S3-3) — `conducts` + `resists` behaviors, `resistance` + `power_rating` parameters
- `switch` (S3-4) — `switches` + `conducts` (closed) + `insulates` (open) behaviors
- `power_source` (S3-5) — `supplies_voltage` behavior, `voltage` parameter
- `LED` (S3-6) — `led_emits_light` + `conducts` + `insulates` + `heats` behaviors, `forward_voltage` + `max_forward_current` + `wavelength` parameters

`capacitor` (S3-7) isn't in the demo — it's rounding out the seed set for completeness.

---

## Risks

| Risk | Mitigation |
|---|---|
| L0-L3 manifests need to grow to support the device set (metal_film, nichrome, battery materials, etc.) | Plan: expand `materials.yaml` inline with each device's commit (S3-3 adds metal_film + nichrome). Don't pre-add materials we don't need; let device authoring force the additions. |
| Device manifest shape decisions lock into bad defaults | S3-1 closes the shape with the simplest viable form; later device rows surface what's missing and force the upgrade. Specifically, the LED in S3-6 is the forcing function for `interfaces.required` map vs list. |
| Cross-FK validator becomes slow or complex | Keep it simple: Set lookups, O(N) per device. The catalog is tiny (6 devices × ~5 FK arrays each). |
| Sprint 2 retro promised 8 devices; Sprint 3 ships 6 | Inductor + diode deferred. Not load-bearing for the Sprint 6 demo target (LED + resistor + switch + power_source). |
| `parameters.required` blueprint shape collides with `parameters.yaml`'s variable shape | Two distinct things: devices.yaml says "this device REQUIRES a parameter named X of type Y"; parameters.yaml says "the project has a default variable named X with value Y". Same key names allowed; different schemas; different purposes. |
| Battery-as-material vs battery-as-external decision in S3-5 ripples through later sprints | Lean: battery is a `power_source` device with `supplies_voltage` behavior; the chemistry (alkaline / lithium / NiMH) is a `parameter` of the instance, not a Layer-0 material entry. Revisit if S5 validator needs per-chemistry discharge curves. |

---

## Deferred to Sprint 3.5 / Sprint 4

- `OBJECT-MODEL.md` — universal object model spec doc (per ADR-006)
- `PROJECT-FORMAT.md` — project file format spec (the `MyProject.chipblocks/` folder)
- Save/load roundtrip test (file I/O + schema validation; no UI yet)
- The `ref:` form on instance parameters (`resistance: { ref: led_current_limit_R }`)
- Inductor + diode device entries (rounds out the original 8-device set)
- Python-side mirror of devices manifest (if/when backend Python returns)

---

## Sprint 3 opens

Master tip `4600f01`. Working tree clean. Gates green: tsc clean, vitest 47/47, codegen drift clean. The L0-L3 manifests are populated + validated; Sprint 3 builds Layer 4 on top.

Implementation does not start until this plan is committed.
