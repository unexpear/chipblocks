# ADR-006: Universal object model + 9-layer hierarchy + AI authority split

**Status:** Draft (2026-05-16) · For Sprint 2 implementation · **Deciders:** solo dev + Claude Code · The first ADR of the v2 ground-up direction; numbering continues from the v1 series (ADR-001 through ADR-005 live on `legacy/audio-synth-direction`).

> **Reading order.** This ADR locks the architectural foundation of the new direction: how a "block" is represented in code, how the 9 layers of abstraction relate, and where the line sits between the deterministic engine, the AI consultant, and the user. Subsequent ADRs cover specific manifests (materials, shapes, behaviors, devices), the AI provider adapter, the validator architecture, and the manufacturing-package compiler. None of those make sense without this one. Read RESET-PLAN.md + FINAL-STATE-VISION.md first if context is needed.

---

## Context

Three pressures converge to require this ADR before any further code lands on master:

1. **The reset is done.** Master is now `c8152bf` with the empty Electron + React + TypeScript shell. The new direction's first concrete artifact (a `materials.yaml` row, a UI palette listing primitive devices, a validator that runs against a graph) all depend on a settled data model that the rest of the codebase consumes. Authoring those artifacts without this ADR would lock in arbitrary decisions.

2. **The product principles need a structural expression.** RESET-PLAN.md states the three core principles — "AI assists, ChipBlocks validates, user approves"; "real blocks all the way down"; "free and open-source forever." Those are values; this ADR turns them into data shapes, type guarantees, and code-level boundaries.

3. **The legacy direction's lessons can be locked in.** The v1 audio-synth direction shipped 24 sprints of working code. Some patterns are clearly worth keeping (the manifest + codegen discipline from ADR-003; the typed-bus connection rules from ADR-001; the BYOK key storage; the IPC contract centralization). Others are clearly v1-specific (the flat `blocks.yaml`, the audio-domain bus types, the digital-only synthesis pipeline). This ADR explicitly inherits the survivors and replaces the rest.

**Why this matters to the user.** The user is non-technical and explicitly wants the foundation correct before any product features land. The previous direction did the inverse — shipped features first, then tried to refactor around them. Three principles were introduced mid-Sprint-24 because of that. The reset is a chance to lock the foundation up front; this ADR is that lock.

## Decision

Three coupled decisions, locked together because each makes less sense without the other two:

1. **Adopt a 9-layer abstraction hierarchy.** Every block in ChipBlocks lives at exactly one layer (`0` through `8`) — from raw materials at Layer 0 to full electronic systems at Layer 8. Blocks at each layer compose from blocks at lower layers. Higher layers are never composed of higher layers (you cannot have a "circuit made of systems"). The 9 layers are: Materials, Shapes, Interfaces, Behaviors, Primitive devices, Circuits, Assemblies, Boards/chips, Systems.

2. **Adopt a single universal object model** for every block on the canvas, at every layer. One YAML/JSON schema describes a resistor (Layer 4), an oscillator (Layer 5), an IC (Layer 6), and a phone (Layer 8) — they differ in their `layer` field and what they compose from internally, not in their data shape. This is the v2 successor to v1's `blocks.yaml` row format from ADR-003.

3. **Lock the AI authority split** at the type-system + architecture level. The deterministic engine owns physics, units, netlist correctness, simulation, and the manufacturing-package contents. The AI consultant owns explanations, suggestions, draft text, and never produces a manufacturing artifact. The user approves changes at the canvas + at release. Concretely: any output that lands in `releases/MyProject_Manufacturing_Release_v*.zip` must trace back to deterministic generators; no AI tool call ever writes a Gerber, GDS, BOM CSV, or schematic SVG directly.

None of these are radical separately. Together they prevent the most common failure modes of EDA tools at our scale: schema drift across product domains, AI authority slippage, and the trap of one-off block representations.

---

## The 9-layer abstraction stack

The user composes designs at any layer. They can drag a `power_source` (Layer 4) onto the canvas without ever seeing the Layer 0 silicon doping. They can descend into a `picorv32_cpu` (Layer 6) and see its Layer 4-5 composition. The hierarchy is the same vocabulary regardless of whether the user is making a circuit, a chip, or a full device.

### Layer 0 — Materials

The bottom. The atoms.

- **What lives here**: copper, aluminum, silicon (intrinsic, n-doped, p-doped), FR4, polyimide, ceramic (alumina), solder (Sn63Pb37, lead-free SAC), air, water, ferrite, air gap, photoresist.
- **Required fields per row**: `id`, `visual: { color, finish }`, plus a `properties` map holding `resistivity`, `permittivity_relative`, `permeability_relative`, `thermal_conductivity`, `density`, `melting_point`, `dielectric_strength` (where applicable). **Each property carries the full provenance fragment defined in [ADR-007](ADR-007-active-variables.md)** — `value`, `units`, `source { type, label, citation }`, `conditions` (where applicable; e.g., copper resistivity is temperature-dependent), `confidence`, `tolerance` (where applicable), `notes`. Material properties are first-class examples of "value with provenance"; they are not bare floats.
- **What's NOT at this layer**: any concept of "where" or "how big." A material is a substance, not a thing.
- **Manifest**: `materials.yaml` + `materials.schema.json` at repo root, codegen-generated, sourced from NIST + open PDKs (sky130, gf180).
- **First-sprint commitment**: 10-15 materials covering the LED-resistor-switch-power-source MVP plus the most common adjacent materials. Community will add more.

### Layer 1 — Shapes / regions

Pure geometry. A region of space filled with a material from L0.

- **What lives here**: `solid_region` (a 3D blob with material + dimensions), `thin_film`, `wire_path` (a 1D curve through 3D space with a cross-section), `plate` (a 2D extent with thickness), `gap` (the empty space between conductive regions), `layer` (a stratified 2D region in a PCB or chip), `hole`, `junction` (where two doped silicon regions meet — N/P/Schottky).
- **Required fields per row**: `id`, `kind` (one of the above), shape parameters (e.g., `dimensions: { radius_mm, length_mm }` for cylinders), `material` (FK to L0).
- **Coupling to L0**: every shape references one material. Same shape in different materials = different entry.
- **First-sprint commitment**: 5-7 shape kinds. Enough for the MVP slice.

### Layer 2 — Interfaces

Where shapes meet, or where the design exits to the outside world. The conduits.

- **What lives here**: `terminal` (an external connection point, the anchor for nets), `contact` (two L1 regions touching with near-zero resistance), `solder_joint` (a contact with reliability characteristics), `via` (a vertical contact through PCB or chip layers), `bond_wire` (the tiny wire from a die to a package), `connector_pin` (a pin on a chip package).
- **Required fields per row**: `id`, `kind`, parent shapes (FK to L1), special properties per kind (e.g., `solder_joint` has `solder_material` and `expected_lifetime_thermal_cycles`).
- **Why separate from L1**: a terminal has electrical role. Geometry alone doesn't. Keeping them distinct lets a shape exist without "knowing" it's a terminal yet.
- **First-sprint commitment**: 5-6 interface kinds. Covers MVP.

### Layer 3 — Behaviors

Abstract physical laws. Composable rules a primitive device adopts.

- **What lives here**: `conducts` (Ohm's law: V = IR), `resists` (Joule heating: P = I²R), `stores_charge` (capacitance: Q = CV), `stores_magnetic_energy` (inductance: V = L·di/dt), `switches` (state machine: open/closed/sometimes-throws), `insulates` (no current below breakdown), `heats` (temperature rises with dissipated power).
- **Required fields per row**: `id`, the physical law it implements, `parameters_required` (what params the device must supply, e.g., resistance), `evaluates` (the symbolic equation), `consequences` (other behaviors triggered — e.g., `resists` triggers `heats`).
- **Why a separate layer**: a resistor adopts {conducts, resists, heats}. A capacitor adopts {stores_charge, insulates}. A diode adopts {conducts (one direction, above Vf), insulates (other direction)}. The same behavior set can be reused across primitive devices.
- **First-sprint commitment**: 7-9 behaviors. The MVP slice needs about 5; future expansion is additive.

### Layer 4 — Primitive devices

The smallest functional unit the user explicitly names and reasons about. Composed from L0-L3.

- **What lives here**: `wire`, `resistor`, `capacitor`, `inductor`, `diode`, `led`, `transistor` (NMOS, PMOS, BJT), `switch`, `power_source`, `ground`. Eventually: photodiode, thermistor, varistor, fuse.
- **Required fields per row**: `id`, `composition` (the L0-L3 references that define it — a `resistor` is "resistive material + cylinder shape + 2 terminals + adopts {conducts, resists, heats}"), `parameters` (user-tunable values like `resistance_ohm`, `tolerance_pct`, `power_rating_W` — **each carries the [ADR-007 provenance fragment](ADR-007-active-variables.md)**: value, units, source, conditions, confidence, tolerance, notes), `failure_modes` (trigger conditions + effects).
- **Why this is where users start**: the MVP palette shows these. A "resistor" is one block; the user doesn't have to think about its composition unless they descend.
- **First-sprint commitment**: 8 devices (wire, resistor, capacitor, inductor, diode, led, switch, power_source). Plus a `ground` terminal. Other devices added per community contribution.

### Layer 5 — Circuits

Compositions of primitive devices (L4) plus other circuits (L5). The first layer at which users see emergent behavior.

- **What lives here**: voltage_divider, RC_filter, oscillator (Wien bridge, ring, relaxation, crystal), amplifier (common-emitter, op-amp non-inverting), AND gate (made of transistors), full adder, voltage regulator, LED driver circuit.
- **Required fields per row**: `id`, `composition` (graph of L4 + L5 nodes), `parameters`, `behavior` (the emergent properties — "voltage_divider implements a 2:1 V ratio when both R values match").
- **Manifest**: `circuits.yaml`. Lands in Sprint 5+ as community contributions or starter library.
- **First-sprint commitment**: None. The MVP slice uses only L4 devices.

### Layer 6 — Assemblies

Larger groupings: ICs (treated as black-box composition), sensor modules, motor drivers, IMUs.

- **What lives here**: IC packages (with internal composition optional — many ICs are opaque to the user), sensor modules (DHT22, MPU6050, BMP280), power modules, motor driver boards, display driver ICs (ST7789, SSD1306).
- **Why distinct from L5**: an L5 circuit is something you design from scratch. An L6 assembly is something you buy as a unit (or that's been pre-designed and you reuse). The user typically doesn't open up an L6 to see the L4-L5 inside; they trust the datasheet.
- **First-sprint commitment**: None. Land in Sprint 6+ as community contributions; existing chips can be reused via datasheet imports later.

### Layer 7 — Boards / chips

The physical substrate level. PCBs, motherboards, ASICs, FPGA dev boards.

- **What lives here**: PCB (with traces + layers + components on top), motherboard (a large PCB with many subsystems), ASIC die (silicon with many circuits/transistors), microcontroller dev board (PCB + MCU + supporting passives + connectors).
- **Required fields**: `id`, `physical_dimensions`, `layers` (for PCB: 1-, 2-, 4-, 8-layer; for chip: metal layer count), `components_placed` (the L4-L6 things mounted on it), `routing` (wire paths or traces).
- **Why distinct from L8**: a PCB is a building block; a system is the final product. A motherboard is on the boundary — it's an L7 unless it's the entire product (then L8).
- **First-sprint commitment**: None. Land in Phase 3 (months 6-12) per ROADMAP.md.

### Layer 8 — Systems

The top. Complete user-facing electronic things.

- **What lives here**: phone, smartwatch, robot, controller, charger, computer, drone, IoT sensor node, hearing aid, electric vehicle subsystem.
- **Required fields**: `id`, `boards_inside` (L7 components), `enclosure` (eventually integrating with mechanical CAD), `firmware`, `user_interactions`.
- **Why this is the top**: there's no "compound of systems" — a system that contains other systems is just a larger system at the same level. The hierarchy terminates here.
- **First-sprint commitment**: None. Land in Phase 4 (year 2+) per ROADMAP.md.

### Composition rules

The layered model enforces:

- A block at layer N can compose only from blocks at layers 0..(N-1). Strictly downward.
- A block can use itself as a composition member (recursive composition) only if the outer block is at a higher layer than the inner block. (A circuit can contain another circuit; a resistor cannot contain a resistor.)
- Layer 0 blocks (materials) cannot compose. They are atomic.
- Layer 0-3 blocks (materials, shapes, interfaces, behaviors) are typically not user-created on the canvas. They appear inside primitive devices when the user descends. They live in their respective manifests.
- Layer 4+ blocks (primitive devices through systems) are what the user drags onto the canvas.

The schema enforces this at codegen time. A `circuits.yaml` row with a `composition` referencing a Layer 7 ID fails schema validation.

---

## The universal object model

The data shape that every block uses, at every layer, in the canvas. This is the v2 successor to v1's `blocks.yaml` row schema (from legacy ADR-003).

### Minimum required fields

```yaml
# A single placed block on the canvas, or a single library row.
- id: <unique within scope>
  layer: 0..8                # which abstraction layer this block sits at
  type: <block type id>      # e.g. "resistor", "voltage_divider", "led"
  label: <user-visible name>
  parent: <id|null>          # the containing block, null at canvas top level
  position: { x, y }         # canvas coordinates; null for library entries

  ports:
    <port_id>:
      dir: in | out | inout
      signal: dc-voltage | dc-current | digital | optical | thermal | mechanical
      units: V | A | Ω | F | H | K | N | ...

  parameters:
    <param_id>:
      value: <number | string>
      units: <SI unit>
      tolerance: <pct or absolute>
      source: user | default | derived

  internal:                  # null if primitive at this layer
    nodes: [<child block ids>]
    nets:
      - id: <net id>
        members: [<port ref>, ...]

  behavior:                  # which L3 behaviors this block adopts
    [conducts, resists, stores_charge, ...]

  validation:                # the canonical place to read object-level health
    status: unknown | pass | warning | fail
    issues: [<warning/error objects>]

  notes: <user-editable freeform text>
```

### Field-by-field detail

#### `id`
Unique within the project (or the library, if this is a library entry). UUIDs internally; user-friendly labels separately.

#### `layer`
The abstraction layer (0 through 8). Determines which manifest the `type` is registered in, what the `composition` may reference, what render+inspector UI is shown.

#### `type`
The block-type id — e.g. `resistor` (Layer 4), `voltage_divider` (Layer 5), `picorv32` (Layer 6). Must exist in the manifest at the corresponding layer. Schema-validated.

#### `label`
User-friendly display name. Defaults to a sensible label per type but is user-editable. Doesn't affect compilation.

#### `parent`
The containing block's `id`, or `null` if this block is at the project's top-level canvas. Hierarchy tree-formed; cycles fail validation.

#### `position`
Canvas coordinates for rendering. Optional (null) for library rows that aren't placed yet.

#### `ports`
Map of port id → port descriptor. Every block has zero or more ports. A port has:
- **`dir`**: input, output, or bidirectional (for buses, power rails)
- **`signal`**: what kind of signal this port carries. Multi-domain — DC voltage, DC current, AC small-signal, digital logic, optical, thermal, mechanical force/position.
- **`units`**: the SI unit. Carries through validation; mismatched units fail (e.g., connecting a Volts port to an Amperes port).

#### `parameters`
Map of parameter id → value. Each parameter is either a **literal** (`{ value, units, tolerance, source }`) or a **reference to an active variable** (`{ ref: <variable-name> }`); the two forms are mutually exclusive. The reference form was added in [ADR-007](ADR-007-active-variables.md), which extends this universal object model with named, typed, project-scoped variables that any block parameter can target. Schema enforces the mutual exclusion; the deterministic engine resolves `ref:` against `parameters.yaml` via scope-chain lookup. See ADR-007 for the full semantics.

#### `internal`
The composition. If null, this block is primitive at its layer. Otherwise:
- **`nodes`**: list of child block ids living one layer down (or deeper for complex compositions like full ICs).
- **`nets`**: list of nets, each connecting ports across child blocks. A net is a set of port references that are electrically connected.

#### `behavior`
List of L3 behavior ids this block adopts. A `resistor` adopts `[conducts, resists, heats]`. Used by the validator to know what physics to evaluate.

#### `validation`
First-class object-level health. The UI reads `status` (one of `unknown` / `pass` / `warning` / `fail`) to render a status indicator on each canvas node. The `issues` array holds warning/error objects, each clickable to navigate the canvas to the source.

This field was added at the user's explicit request after RESET-PLAN.md's first draft (the planning conversation that led to the reset).

#### `notes`
Freeform user text. Never compiled, never validated. The user's working memory.

### What's NOT in the object model (and why)

A few fields explicitly excluded because they create more problems than they solve:

- **No `version` per block.** Library versioning is at the manifest level; saved-graph blocks reference library entries by `(type, layer)`. Per-block versioning would create the worst kind of drift surface (the user can't easily see what changed).
- **No `description`.** Block-type metadata (description, color, category, icon) lives in the manifest, not in the placed-block data. Avoids duplication and drift.
- **No AI-specific fields.** The AI consultant works alongside the data; it doesn't get hooks into the object model. If AI wants to suggest a change, it makes a tool call that proposes an edit to a specific field, and the user approves.
- **No `state` for time-domain analysis at v1.** Steady-state only at v1; when transient analysis lands, the model extends.

---

## AI authority split

The structural rule that prevents AI from accidentally becoming the engineering authority.

### The three roles

| Role | Owns | Examples | Failure mode if violated |
|---|---|---|---|
| **Deterministic engine** | Physics, units, netlist correctness, simulation, validation, DRC/LVS (when applicable), Gerber/GDS/BOM/schematic generation, the manufacturing release ZIP contents. | "Will this circuit work?" → KCL + KVL → numeric current/voltage/power. "Is the BOM right?" → walk the design tree, output components with quantities + part numbers. | If AI generates these → confidently wrong manufacturing artifacts → real money lost. |
| **AI consultant** | Explanations, suggestions, drafting (READMEs, comments, test plans, firmware skeletons, BOM notes, anomaly write-ups), AI-side workflow help. | "Why is my LED burning out?" → explains: current too high, resistance too low → suggests value. "Write a README for this design." → drafts text the user can edit. | If AI tries to validate physics → the validator becomes "AI plus a check" instead of "deterministic plus a help." Confidence erodes. |
| **User** | Approval of every change to the design. Final approval of every release. The arbiter when the AI and the engine disagree. | "Apply this AI-suggested wiring." → user must click Approve. "Submit this design for manufacture." → user must click Release. | Bypassing the user creates the most dangerous failure mode: the system runs without an arbiter. |

### Concrete enforcement points

How this split is enforced in code, not just in design philosophy:

1. **The validator does not call AI.** No `await ai.suggest(...)` inside `validate(graph)`. Validation produces deterministic pass/warning/fail with no AI involvement.

2. **The manufacturing release ZIP generator does not call AI.** Every file in the ZIP is produced by a generator with a specific shape:
   - `bom.csv` ← walks the design tree, outputs `(component_id, type, count, datasheet_url)`. No AI.
   - `schematic.svg` ← deterministic layout algorithm on the design tree. No AI.
   - `gerbers/*.gbr` ← deterministic PCB-layout-to-Gerber generation. No AI.
   - `gds/chip.gds` ← deterministic layout-to-GDS generation. No AI.
   - `validation-report.txt` ← validator output, deterministic. No AI.
   - `README.md` ← AI-drafted, BUT user-editable, BUT the README in the release ZIP is the user's final approved version. AI suggests; user approves; user's version ships.

3. **AI tool calls only edit the design; they don't validate or release.** The AI consultant has tool definitions like `add_block(type, position)`, `connect_ports(port_a, port_b)`, `set_parameter(block_id, param_id, value)`. It does NOT have a tool to mark a block's validation status, to write to the release ZIP, or to bypass user approval.

4. **No "AI confidence" override.** If the deterministic validator says a circuit will burn out, the AI cannot tell the user "actually it's fine." It can only suggest a fix and let the user approve the change that makes the validator pass.

5. **The AI prompt explicitly tells the model these rules.** The system prompt instructs: "You assist; ChipBlocks validates; the user approves. Never claim a circuit works unless the validator says so. Never produce a Gerber/GDS/BOM directly. Always propose changes via tool calls that the user reviews."

### Multi-provider + No-AI mode

Per ROADMAP.md and PRD.md, the AI provider is replaceable at the adapter level:
- **No-AI mode**: required at v1. The app is fully usable with zero AI calls. Every feature works.
- **BYOK Anthropic** + **BYOK OpenAI**: shipping at v1 (Sprint 6).
- **BYOK Gemini** + **Ollama / local model** + **custom endpoint**: post-v1.

The provider is selected in Settings; key storage is via `safeStorage` (one key per provider). The agentic chat loop is provider-agnostic at the abstraction layer; only the API-call adapter differs.

A separate ADR (probably ADR-008 once we've drafted the AI architecture in more detail) will cover the multi-provider adapter pattern. ADR-006 just locks the authority split at the data-model level.

---

## Project file format

The on-disk representation of a ChipBlocks project. Git-friendly, human-readable, two-deliverables-compatible.

### Directory layout

```
MyProject.chipblocks/
├── project.yaml                Top-level project metadata
├── design.yaml                 The universal object graph (all blocks + nets)
├── parameters.yaml             Tunable design parameters (variables, targets)
├── verification/
│   ├── checks.yaml             What checks to run
│   └── results/                Populated by Verify mode (gitignored cache)
├── exports/                    Generated working artifacts (cached, regeneratable)
│   ├── schematic.svg
│   ├── bom.csv
│   └── ...
├── releases/                   Versioned manufacturing release ZIPs (committed)
│   └── MyProject_Manufacturing_Release_v1.0.zip
├── docs/                       AI-drafted, user-editable
│   ├── README.md
│   ├── test-plan.md
│   └── ...
└── .chipblocks/                Internal cache (gitignored)
```

### File-by-file contract

**`project.yaml`** — top-level metadata:
```yaml
schema_version: 2                    # save format version; v2 = post-reset
name: MyProject
description: <user-supplied>
created: <ISO 8601>
modified: <ISO 8601>
author: <user-supplied>
license: MIT                         # or whatever the user chose
ai_provider_at_last_save: <id or "none">  # for reproducibility, not for trust
chipblocks_app_version: <version>
```

**`design.yaml`** — the universal object graph:
```yaml
# All blocks placed on the canvas, in flat list form. Hierarchical relationships
# expressed via the `parent` field on each block. Nets expressed inline within
# each composite block's `internal.nets` list.
blocks:
  - id: <uuid>
    layer: 4
    type: power_source
    label: Battery
    parent: null
    position: { x: 100, y: 100 }
    ports: { ... }
    parameters: { voltage_V: 9, capacity_mAh: 500 }
    behavior: [supplies_voltage]
    validation: { status: pass, issues: [] }
    notes: ""
  - id: <uuid>
    layer: 4
    type: resistor
    label: R1
    parent: null
    position: { x: 300, y: 100 }
    ports: { ... }
    parameters: { resistance_ohm: 470, tolerance_pct: 5 }
    behavior: [conducts, resists, heats]
    validation: { status: pass, issues: [] }
    notes: ""
  # ... more blocks

nets:                              # top-level nets (between top-level blocks)
  - id: <uuid>
    members:
      - { block: <battery_id>, port: positive }
      - { block: <r1_id>, port: terminal_a }
    # nets carry signal-type + units inherited from the connected ports;
    # mismatches fail validation
```

**`parameters.yaml`** — design parameters the user explicitly tunes:
```yaml
parameters:
  - id: target_led_current_mA
    value: 18
    units: mA
    notes: "Below LED max 20mA for headroom"
  - id: supply_voltage_V
    value: 9
    units: V
```

**`verification/checks.yaml`** — what to validate:
```yaml
checks:
  - id: kcl
    description: "Kirchhoff's current law at every node"
    enabled: true
  - id: kvl
    description: "Kirchhoff's voltage law around every loop"
    enabled: true
  - id: led_current_within_rating
    description: "Every LED's forward current ≤ rated max"
    enabled: true
```

**`exports/`** — populated by Verify + Release modes. Working artifacts. May be gitignored or committed at user discretion.

**`releases/`** — versioned manufacturing ZIPs. Each release is a single ZIP file named `<ProjectName>_Manufacturing_Release_v<X.Y>.zip`. Once released, the ZIP is immutable; new versions get new ZIPs.

**`docs/`** — AI-drafted text, user-editable. The README.md inside is what eventually ships in the manufacturing release.

**`.chipblocks/`** — gitignored. Internal cache, compiled SPICE intermediates, last-known-good results, etc.

### Why this shape

- **Git-friendly**: YAML at top level. Diffable. Mergeable (with some care around uuids).
- **Two-deliverables-compatible**: source (`design.yaml`, etc.) and releases (`releases/*.zip`) are clearly separated.
- **Human-readable**: a user can open `design.yaml` in any text editor and read what's in their design.
- **Roundtrip-safe**: load + save = no changes. (Test added per "Tests" section.)

---

## Save format versioning

The new direction starts at `schema_version: 2`. Save format v1 lives on `legacy/audio-synth-direction`.

### Version policy

- **Major version bumps** (1→2, 2→3): structural changes (different top-level schema). Migration code lives at `frontend/src/save-format/migrate-vN-to-vM.ts`.
- **Minor / additive changes**: additional optional fields. No version bump. Old saves still load.
- **Removing a required field**: version bump.

### v1 → v2 migration

**Not provided.** v1 saves are designed against the audio-synth `blocks.yaml`; v2 has no `blocks.yaml`. v1 saves point at block types that no longer exist. Migration would have to invent v2 equivalents, which isn't possible cleanly.

What v1 users get:
- The `legacy/audio-synth-direction` branch checked out → v1 saves work as before.
- The `v0.1.0-alpha.9-final` tag → same.
- The GitHub Releases page → alpha installers downloadable.

If a v1 user wants to recreate a design in v2, they re-author it. There are zero external users at the reset point, so this trade is free.

### v2 forward compatibility

The schema validator on load:
- **Same version** → load normally.
- **Older minor version** (e.g., `2.0` on a `2.1` app) → load; missing optional fields use defaults; status indicator warns "saved by an older version, may have lost recent features."
- **Newer minor version** (e.g., `2.2` on a `2.1` app) → load with warning "saved by a newer version, some fields ignored"; preserve unknown fields on resave to avoid data loss.
- **Different major version** → refuse to load. Display "this file is save format vX; this app only handles save format v2. See README for migration."

---

## Hierarchical composition + lazy expansion

The canvas can render designs of any size by only loading what's at the current level.

### Block groups vs primitives

- **Primitive at its layer**: `internal` is null. The block doesn't decompose further at this level. Examples: a `resistor` (Layer 4) is primitive at Layer 4 — it doesn't decompose into other Layer-4 blocks. (It DOES decompose into Layer 0-3 items when descended.)
- **Composite block (block group)**: `internal` is populated with the graph that defines it. Examples: a `voltage_divider` (Layer 5) decomposes into two `resistor` (Layer 4) blocks.

### Lazy rendering

When the user places a Layer-5 `voltage_divider` on a Layer-5 canvas, React Flow renders ONE node showing the divider's external ports (vin, vout, gnd). The two internal resistors do NOT render until the user double-clicks to descend.

When the user is inside the `voltage_divider`, the canvas is a Layer-4 view showing two resistors + the connecting net + the three boundary terminals.

Descending and ascending use the same UX metaphor as opening folders. There's a breadcrumb at the top of the canvas: `MyProject / VoltageDivider / R1`. The user can click any segment to return.

### Performance contract

- React Flow only ever renders the current view's nodes + edges. A design with 10,000 total blocks renders only the ~20 visible at the current zoom/abstraction level.
- The full graph is loaded into memory (typical project: hundreds to thousands of blocks; well within memory budget).
- Validation runs against the full graph regardless of what's visible. Warnings in nested blocks bubble up: if a deep block has a warning, the containing composite block's `validation.status` becomes `warning`, visible at the parent level.

---

## Validation status as first-class

Every block has `validation: { status, issues[] }` in its data shape. Three reasons:

1. **The UI needs object-level health indicators.** A red dot on a block with a problem, a green check on a passing block, a yellow exclamation on a warning. This data needs a stable place to live.

2. **Validation status bubbles up the hierarchy.** A Layer-5 voltage divider whose internal resistors burn out has a failed validation. The Layer-5 block displays the warning at its level too, so the user knows there's a problem without descending.

3. **Issues are clickable.** The `issues` array entries have `{ severity, message, source_block_id }`. Clicking an issue in the bottom panel navigates the canvas to `source_block_id` and highlights it.

### Status semantics

| `status` | Meaning |
|---|---|
| `unknown` | Validation hasn't run yet. Default for newly-placed blocks. |
| `pass` | All applicable checks passed. Component will operate within rating + spec. |
| `warning` | Operational, but with caveats (e.g., LED at 95% of max current — works, but no margin). |
| `fail` | The design has an error that should be fixed. (e.g., LED current exceeds max → burns out.) |

### When validation status updates

- **On every design change**: the validator re-runs against the changed subgraph. Status updates immediately on the affected blocks.
- **On project load**: full validation runs once.
- **On user request** (Verify button): full validation runs explicitly.

---

## Block-type extensibility — user-defined blocks are first-class

The universal object model and the 9-layer hierarchy do not restrict who authors block types. The user can drop entirely new block types into a project — not just compose graphs from the shipped library, but **define new block types that behave like every other block in the catalog**.

This works because every block type is a manifest row + a composition tree, regardless of who authored it. The same schema validates a shipped resistor and a user's custom 4-input mux. The same UI renders both. The validator treats both identically.

### Four origins for block types

| Origin | Where it lives | Lifecycle |
|---|---|---|
| **`builtin`** | Inside the ChipBlocks app bundle. Standard cells (L0-L2), foundational behaviors (L3), the small set of primitive devices (L4: wire, resistor, capacitor, etc.). Ships with every install. | Updated when ChipBlocks releases new versions; user cannot edit without forking the project. |
| **`community`** | Installed packages: `~/.chipblocks/libraries/<library-id>/`. Examples: `chipblocks-audio` (the inaugural starter library), `chipblocks-peripherals` (SPI/I²C/UART/...), `chipblocks-cpus`, `chipblocks-radios`. Each library is a GitHub repo the user clones / installs. | User installs and uninstalls libraries from a per-user catalog. Library updates are versioned; saved-graph references pin specific versions. |
| **`user-local`** | `~/.chipblocks/blocks/` on the user's machine. Custom block types the user authors and wants available across all their projects (e.g., "my favorite 8-bit-decoder layout"). | User-curated. Survives across project reloads + ChipBlocks updates. |
| **`project`** | `MyProject.chipblocks/blocks/` — custom block types defined inside one project, shipping with the project file. | Travels with the project; shared by `.chipblocks` zip / fork. Examples: project-specific subassemblies that don't make sense to publish broadly. |

Origin resolution at runtime walks: project → user-local → community → builtin (innermost wins, same shape as Active Variable scopes in ADR-007). A block type with the same `id` in multiple origins is resolved by the innermost origin; the user gets a "shadowing" warning so they know.

### Authoring a custom block type

Three workflows the user-facing UX supports:

1. **"Save selection as block group"** — the user draws a subgraph on the canvas, right-clicks selected nodes + connecting nets, picks "Save as block group." A dialog asks for: name + layer + origin (project / user-local) + external ports (auto-detected from the selection's boundary, user can rename/reorder). The block group is added to the relevant manifest + appears in the palette.

2. **"Author manifest row directly"** — power users edit a `blocks.yaml` (or per-origin equivalent) by hand, write the composition graph, run codegen. Same cookbook discipline as v1's ADR-003 block-authoring flow.

3. **"Import from library"** — install a community library; its block types appear in the palette under their library name. No authoring needed; the library's curator did the work.

All three paths produce identical-shape block types. The universal object model has no `origin: builtin` vs `origin: user-local` discriminator at the data layer; the discriminator lives at the manifest-loading layer.

### Constraints on user-authored block types

The same rules that apply to shipped blocks apply to user-authored ones:

- **Layer discipline**: a user-authored block at Layer N composes only from blocks at layers 0..(N-1). Schema enforces.
- **Real composition**: the composition must reference real lower-layer blocks. No black-box user blocks (the "no fake blocks" rule applies to user contributions too).
- **Named ports**: external ports must have names, signal types, and units. The block participates in net validation like any other block.
- **Sourced (when shipped)**: a user-local or project-scope block doesn't need a `source:` citation. A community library block intended for wider distribution does (per the "Defaults must be real-life-accurate" extension to ADR-007).
- **Validation propagates**: the validator treats user-authored blocks identically — their `validation: { status, issues }` field is populated by the same engine that handles shipped blocks.

### Discoverability

The palette UI groups blocks by origin so the user can find them:

```
Project blocks       (this project's custom blocks)
User-local blocks    (your blocks across all projects)
chipblocks-audio     (community library; if installed)
chipblocks-peripherals (community library; if installed)
Standard cells       (builtin; sky130_fd_sc_hd etc.)
Primitive devices    (builtin; wire / resistor / capacitor / ...)
```

Sections are collapsible. The user can favorite individual blocks; favorites appear in a "Quick access" section at the top.

### Versioning user-authored blocks

A custom block group has a `version:` field in its manifest row (default `0.1.0`). Saved-graph references to the block group pin a specific version (`type: my-mux@0.1.0`). If the user later edits the block group, the manifest version increments and saved graphs that referenced the old version load the old definition (preserved as a snapshot). This prevents the "I edited my custom block and now my old project is broken" failure mode.

For project-scope blocks, the version is also stored in the project file so the project is self-contained.

### Sprint phasing for extensibility

- **Sprint 2** (Layer 0-3 manifests): The infrastructure pattern is already in place — every manifest is `<name>.yaml` + `<name>.schema.json` + codegen. User-authored blocks reuse this pattern; nothing new at the schema-engine layer.
- **Sprint 3** (Layer 4 devices + universal object model): The save format includes both project-scope blocks (inline) and references to user-local / community / builtin blocks (by name + version). Save/load roundtrip test covers all four origins.
- **Sprint 4** (Canvas v1): The palette UI groups by origin. The "Save selection as block group" workflow is implemented for project-scope (Sprint 4's MVP); user-local + community origins are functional but UX-light at v1.
- **Sprint 5+** (validator, AI, etc.): Treat user-authored blocks identically to shipped blocks. No special cases.

This extensibility is the same architectural commitment that makes ADR-007's Active Variables a clean fit: the data model doesn't care who authored a thing, only that the thing conforms to the schema.

---

## Net / port / signal model

Carried forward as the v1 ADR-001 lesson: every connection between blocks is typed. Mismatched types fail at edit time, not at compile time.

### Signal-type registry

Defined in a new manifest `signals.yaml` (Sprint 2). Per signal type:
- `id`: e.g., `dc-voltage`
- `units`: e.g., `V`
- `description`: human prose
- `compatible_with`: other signal types this can connect to (e.g., `dc-voltage` is compatible with `dc-voltage`, NOT with `dc-current`).

v1 audio's bus types (`audio-s8`, `data-u8`, etc.) lived in a TypeScript union. v2 puts them in YAML, codegen-derived, with multi-domain support from day one.

### Initial signal-type set (Sprint 2)

| Signal type | Units | Notes |
|---|---|---|
| `dc-voltage` | V | DC potential difference |
| `dc-current` | A | DC current flow |
| `digital` | (boolean) | 0/1, no scalar units |
| `analog-voltage` | V | AC small-signal voltage (for future RF/audio work) |
| `optical` | (W) | Light power. For LEDs, photodiodes. |
| `thermal` | K, W | Temperature + heat flow |
| `mechanical-force` | N | Mechanical primitives (motors, switches) |
| `ground` | (special) | The reference. Every net has at most one ground. |

More added as needed (RF, charge, magnetic field, etc.). No exhaustive list at v1.

### Connection rules

- Same `id` on both ends → compatible, no warning.
- One side is the documented "compatible_with" of the other → compatible.
- Otherwise → rejected. The UI shows a red wire and a tooltip.

Same model as ADR-001 but multi-domain instead of audio-only.

---

## Phased implementation

### Sprint 1 (in flight): infrastructure + this ADR

- Empty Electron shell launches → **done at master c8152bf**
- New docs (README, CLAUDE.md, PRD, ROADMAP) → **done at master c8152bf**
- ADR-006 drafted → **this document**
- ADR-006 reviewed + approved → ⏳ pending user
- Sprint 1 retro → pending

### Sprint 2: Layer 0-3 manifests

Per ROADMAP.md and this ADR:

1. **`materials.yaml` + schema** (~10 materials)
2. **`shapes.yaml` + schema** (~5 shape kinds)
3. **`interfaces.yaml` + schema** (~5 interface kinds)
4. **`behaviors.yaml` + schema** (~7-9 behaviors)
5. **`signals.yaml` + schema** (~8 signal types)
6. Codegen scripts for each: one per manifest, Python + TypeScript outputs, codegen-drift CI checks
7. Validation tests: each manifest validates against its schema; FK references resolve cross-manifest

### Sprint 3: Layer 4 devices + universal object model + project file format

1. **`devices.yaml` + schema** (~8 primitive devices: wire, resistor, capacitor, inductor, diode, LED, switch, power_source)
2. **`OBJECT-MODEL.md`** — the canonical reference for the universal object model (this ADR's data-shape section, but as a living doc that may evolve)
3. **`PROJECT-FORMAT.md`** — the canonical reference for the `MyProject.chipblocks/` folder
4. **Save/load roundtrip test** — write an empty project, read it, write it, byte-identical

### Sprint 4: Canvas v1

1. Palette UI listing the 8 L4 devices
2. Drag-drop, wire-drawing, terminal-snap (per the 5 essentials)
3. Property inspector
4. Undo/redo
5. Save/load against the project format
6. **The validation field is rendered** — every block displays a status indicator

### Sprint 5: Steady-state validator

The deterministic engine, per the AI authority split. Detail in a future ADR (probably ADR-007 — validator architecture).

### Sprint 6: AI integration + manufacturing skeleton

Multi-provider AI adapter, BYOK, agentic loop with the tool definitions enforcing the authority split. Detail in a future ADR (probably ADR-008 — AI provider adapter).

---

## Tests and verification

Per the "always check, never assume" discipline that carries forward from v1:

1. **Schema validation tests** (Sprint 2+): every manifest row validates against its schema. New blocks in `devices.yaml` reference valid `materials.yaml` + `shapes.yaml` + `interfaces.yaml` + `behaviors.yaml` rows.

2. **FK resolution tests** (Sprint 2+): cross-manifest references resolve. A shape's `material` must exist in `materials.yaml`. A device's behaviors must all exist in `behaviors.yaml`.

3. **Save/load roundtrip test** (Sprint 3+): create a project, save it, load it, save it again, byte-identical. Catches the most common data-model bugs.

4. **Manifest-integrity dynamic tests** (Sprint 2+, pattern from v1 ADR-003): for each row in each manifest, three assertions: file at declared path exists, declared exports are importable/loadable, registered in the relevant runtime registry.

5. **Universal-object-model schema tests** (Sprint 3+): the object model has its own JSON schema. Every block, anywhere in the codebase, validates against it.

6. **AI authority gate tests** (Sprint 6+): the manufacturing release generator does not call any AI client. The release ZIP's contents trace to deterministic generators. Test by mocking the AI client → release still produces correct output.

7. **TypeScript compile + vitest runs** on every PR. Same CI discipline as v1's cookbook step 9.

---

## Consequences

**Becomes easier:**
- **Adding a new block at any layer is uniform.** Same data shape. Same manifest pattern. Same codegen discipline. No "audio block shape vs CPU block shape vs visual block shape" splits like v1 had.
- **Composing systems out of subsystems is natural.** A user's voltage divider becomes a component; a circuit becomes an assembly; an assembly becomes part of a board; etc. The hierarchy is the user's mental model.
- **Validation status is everywhere.** The UI always has a place to display health. The release pipeline always has a place to check "is this design known good."
- **AI integration won't slip.** Because the AI authority split is enforced at the type system level (no AI calls inside validator/release pipeline), the AI consultant can be improved/replaced/upgraded without affecting the trust of the manufacturing artifact.
- **Multi-domain physics is supported from day one.** Signal types include optical, thermal, mechanical — not just digital + analog. Future PCBs, sensor modules, motors are first-class.
- **Save format v2 is git-friendly + diffable.** YAML at the top level; designs are version-controllable; collaborative work via PR is realistic.

**Becomes harder:**
- **Schema authoring is real upfront work.** Sprint 2 has to author 5 manifests + schemas before Sprint 3 can have devices. That's ~1-2 weeks of careful work before any user-visible product feature.
- **The user has to understand "primitive vs composite" at some level.** Most users don't have to think about it (they drag a resistor; it works). Power users who descend into compositions need to understand.
- **Multi-domain signal typing is more code.** Compared to v1's audio-only buses, v2's signal types cover more domains and require more compatibility rules.
- **Validation status maintenance.** Every code path that changes the design must update the validation status. This is the kind of cross-cutting concern that's easy to forget. Mitigation: validation re-runs on every design change automatically; no manual "remember to invalidate" needed.

**To revisit when:**
- **The 9 layers feel wrong.** If a use case clearly doesn't fit any layer, add a layer or refactor. The 9-layer model is opinionated; don't ossify it.
- **The universal object model can't represent something important.** If a future device type needs a field that doesn't fit, extend the model. Schema additions are cheap.
- **A second AI provider's adapter shape conflicts with the first**, suggesting the multi-provider abstraction needs work. This is anticipated; the v1 lesson is that abstracting too early is also a bug.
- **Save format v3 is needed.** When there's a structural reason to break compatibility, do it cleanly; migration code lives in a single place.

---

## Alternatives considered

### Option A — Single flat block manifest (v1 approach)

Treat every block the same; no layer distinction. v1's `blocks.yaml` was this.

**Reject:** the audio-synth direction's `blocks.yaml` had to coexist with visual blocks (VGA), CPU primitives (data-u8), bus blocks (BusSplit), and effects (Multiply). These have completely different shapes; the universal flat shape forced gymnastics in the typed-bus system. v2 has even more diversity (materials at one end, full systems at the other). A flat shape doesn't scale.

### Option B — Different schema per block category (audio / visual / CPU / system / etc.)

Each domain has its own data shape.

**Reject:** maximum flexibility, maximum confusion. Users have to learn a different "block" for each domain. The codegen has to handle N schemas. Cross-domain composition (a sensor module in a chip in a board in a phone) becomes a nightmare of bridging different shapes. The layered model gives us domain-appropriate fields in a uniform shape.

### Option C — Skip the layered approach; just have "blocks" that contain other "blocks" recursively

Hierarchy without abstraction layers. A block has children blocks; no "layer" field.

**Reject:** loses the composition rules. Without layer tracking, the schema can't reject "a circuit made of systems" — the schema has no way to know what's what. Users get tangled designs that are technically valid but conceptually nonsense.

### Option D — Three abstraction layers instead of nine (e.g., "primitive / circuit / system")

Coarser-grained.

**Reject:** loses the natural pedagogy. Materials are not circuits. Behaviors are not devices. The 9 layers correspond to actual hierarchies in real electronics (and real curricula). Fewer layers means "what's a half-adder?" doesn't have a clean home.

### Option E — Defer the AI authority split to a code review rule rather than data-model enforcement

Just have a coding rule that says "don't call AI from the validator."

**Reject:** rules-by-convention erode. Someone (probably us, in a hurry) will eventually violate it. Encoding the split at the type-system level (separate modules, separate test surfaces, separate CI gates) makes the violation visible and fixable, not silent.

### Option F — Defer the layered architecture until after the MVP slice

Get LED + resistor + switch + power working first; refactor into layers later.

**Reject:** this is exactly what v1 did with audio blocks (and what the reset was caused by). The lesson: foundational decisions are easiest at the start, hardest mid-project, painful at the end. Layer it once, up front, while the surface is small.

---

## Action items — Sprint 2-3

Numbered for the implementation checklist. Each is one PR.

### Sprint 2 (Layer 0-3 manifests)

1. [ ] Draft `OBJECT-MODEL.md` at repo root — a living doc that mirrors this ADR's "Universal object model" section. Easier for new contributors to find than reading the full ADR.
2. [ ] Author `materials.yaml` + `materials.schema.json` (10-15 materials, citable sources)
3. [ ] Author `shapes.yaml` + `shapes.schema.json` (5-7 shape kinds)
4. [ ] Author `interfaces.yaml` + `interfaces.schema.json` (5-6 interface kinds)
5. [ ] Author `behaviors.yaml` + `behaviors.schema.json` (7-9 behaviors)
6. [ ] Author `signals.yaml` + `signals.schema.json` (8 signal types)
7. [ ] Write codegen scripts for each manifest (Python + TypeScript outputs)
8. [ ] Add codegen-drift CI checks for each
9. [ ] Manifest-integrity tests (FK resolution + file existence + import validity)
10. [ ] Sprint 2 retro

### Sprint 3 (Layer 4 devices + universal object model + project file format)

11. [ ] Author `devices.yaml` + `devices.schema.json` (8 primitive devices, each composing from L0-L3)
12. [ ] Codegen script for `devices.yaml`
13. [ ] Write the universal-object-model TypeScript types (mirror of the YAML/JSON schema)
14. [ ] Draft `PROJECT-FORMAT.md` at repo root — living doc for the project folder layout
15. [ ] Implement save/load for the project folder (no UI yet — just the file I/O + schema validation)
16. [ ] Save/load roundtrip test (write empty project, read, write, byte-identical)
17. [ ] Universal-object-model schema validation tests
18. [ ] Sprint 3 retro

---

## What this ADR does NOT lock

Deliberately deferred to future ADRs. Listed here so the boundary is explicit:

- **The validator architecture** (Sprint 5): how KCL/KVL/Ohm are computed, how the validation result is stored, how failure-mode evaluators are written. Future ADR — possibly ADR-007.
- **The AI provider adapter** (Sprint 6): exact multi-provider API shape, key-storage details, agentic loop iteration cap, tool definition list. Future ADR — possibly ADR-008.
- **The canvas / palette / inspector UX details** (Sprint 4): the 5 essentials are in RESET-PLAN.md but the specific render approach, the bottom-panel format, the drill-down animation are all to be decided during Sprint 4 implementation.
- **The manufacturing release ZIP contents** (Sprint 6): exactly which files go in, in what subfolder structure. Skeleton at v1 (BOM + schematic + README + validation report); full set at v2+.
- **The community library mechanism** (Phase 2): how `chipblocks-audio` or `chipblocks-peripherals` plug in. Per FINAL-STATE-VISION.md, "library installation" is per-user; the exact discovery + version-pinning mechanism is later work.
- **PCB / 3D / mechanical CAD integration** (Phase 3+): KiCad backend, FreeCAD integration, etc. Beyond v1 scope; ADR when motivated.
- **Specific failure-mode rules** (per-device, Sprint 3+): the schema accepts `failure_modes` arrays, but populating them with the right trigger conditions for each device is per-block content, not ADR scope.

---

## What this unblocks

After this ADR is approved and Sprints 2-3 land:

- **Sprint 4 has a stable foundation to build the canvas on.** Every block on the canvas has known data shape. Drag-drop knows what to instantiate. The inspector knows what to render.
- **Validator authoring is bounded** — Sprint 5 just has to walk the universal object graph and evaluate behaviors. No "what shape is this block?" handling per type.
- **Community contributions onramp** is the same as the v1 cookbook discipline: edit a manifest row, write the per-layer file, run codegen, commit.
- **The two-deliverables model has somewhere to live** — `MyProject.chipblocks/` folder for source, `releases/*.zip` for handoffs. Validated by save/load roundtrip from Sprint 3.
- **The AI consultant is structurally constrained** to suggest changes (via tool calls), not impose them. Trust is preserved.
