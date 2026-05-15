# ADR-005: Modular fab platform — eight manifests + adapters for the chip-side build target

**Status:** Draft (2026-05-15) · For implementation in Sprint 25 · **Deciders:** solo dev (you) + Claude Code · Successor to [ADR-003](ADR-003-block-manifest.md) (which made block-addition manifest-driven); this ADR applies the same pattern one level up — to the *fab target itself*.

> Fifth project ADR. Builds on [ADR-001](ADR-001-multi-bit-bus-types.md) (typed bus system), [ADR-002](ADR-002-cpu-primitives.md) (CPU primitive set), and [ADR-003](ADR-003-block-manifest.md) (block manifest). Introduces the modular fab platform that the post-Sprint-24 phone-class roadmap requires. **Sibling ADR-004 (packaged CPU representation) is in the same draft slot** but covers a different concern — how a packaged CPU plugs into the system — and will reference this ADR's `cpu-cores.yaml` for its concrete realization.

## Context

The mid-Sprint-24 strategic pivot (full statement in [SPRINT-24.md](SPRINT-24.md)'s "Mid-sprint pivot" section) introduced two project principles:

1. **No fake blocks** — every block in `blocks.yaml` must elaborate to real synthesizable Amaranth HDL. External devices (display panels, speakers, antennas, batteries) are chip pads, not blocks. We make the controllers and drivers; the external thing isn't ours to model.
2. **Modular fab platform** — apply the ADR-003 manifest pattern to the fab target itself. Eight extension points, each manifest-driven, each addable as 1 row + 1 adapter without touching unrelated code.

The phone-class roadmap (S25 → S32) requires both. The audit captured in this session's earlier turn found ~20 hardcoded sites in `backend/build.py` (~970 LOC) and `backend/tinytapeout.py` (~950 LOC) that bake in iCE40-family / Sky130-PDK / OpenLane-flow / Caravel-wrapper / TT-cohort assumptions. Adding a second ASIC tier ("ChipBlocks Mini" at ~500×500 µm, "ChipBlocks Standard" at ~1 mm²) — let alone a different PDK (Gf180mcuB), a packaged CPU core (picorv32 or VexRiscv), or an on-chip radio modulator (OOK / audio-FSK / LoRa-CSS) — would compound those hardcoded sites linearly with each new tier.

**Why this matters to the user.** The user is non-technical, runs ChipBlocks as a side project, and has explicitly stated the goal "make our own version of Tiny Tapeout but with more and making it extendable so we can always add new stuff" (2026-05-14 conversation). The right interpretation isn't "one fixed shuttle bigger than TT" — it's "a platform where every dimension of the fab target is manifest-driven, addable as a single row, never a refactor." That matches the hacker-spirit of ADR-003's success: per-block hand-edited surface dropped from 9 files to 3, and the savings compounded sprint-on-sprint. The same pattern applied to the fab target should compound the same way over S25 → S32 and beyond.

The trigger condition is unambiguous: the phone-class roadmap is about to start adding peripherals (S26: SPI master / I²C master / UART / GPIO / PWM), display drivers (S27: ST7789), audio output (S28: PWM audio out), a packaged CPU (S29: picorv32), and a custom radio (S31: OOK + audio-FSK). Without this ADR landed first, every one of those sprints would either (a) hardcode its target assumptions in the same places `build.py` already does, doubling the technical debt, or (b) attempt a piecemeal refactor partway through, with no schema to anchor against. **Pay the structural cost once, up front, before the additive work begins.**

## Decision

**Adopt eight manifests at the repo root, each the single source of truth for one dimension of the fab platform.** Each manifest follows the ADR-003 pattern: a YAML file with one row per entity, a JSON Schema validator next to it, and per-manifest codegen that produces the cross-cutting registries and CLI surfaces. Adding a new entity (new shuttle tier, new PDK, new CPU core, new radio, new bus protocol, new memory backend, new package, new build flow) is **1 manifest row + 1 adapter** — never a refactor of unrelated code.

**Third-party tools are plumbing.** eFabless Caravel, OpenLane / LibreLane, SkyWater MPW, the Tiny Tapeout submission portal, picorv32 from Clifford Wolf, etc. — all called via thin adapter modules behind manifest-defined interfaces. ChipBlocks owns the schemas, the socket contracts, the codegen, and the adapters. Swapping out an upstream tool (eFabless changes its submission format, OpenLane gets superseded by LibreLane v2, etc.) becomes "rewrite one adapter," not "rewrite the build pipeline."

**No new functional capability ships with the ADR itself.** Like ADR-003 before it, the implementation is a structural reshuffle: every existing build path (iCEstick / TinyFPGA BX / iCEBreaker / Tiny Tapeout) must continue to work byte-identically through the new manifests. Phase 0 ends with `shuttles.yaml` containing one row (`tt-pico` = current Tiny Tapeout slot) and the existing `build.py` + `tinytapeout.py` reading from the manifest instead of from hardcoded constants. Behavior unchanged.

## The eight manifests

Each follows the same shape: `<dimension>.yaml` at repo root, `<dimension>.schema.json` next to it for validation, codegen producing the registries the rest of the codebase reads from.

### 1. `shuttles.yaml` — fab targets (FPGA boards + ASIC shuttle tiers)

One row per fab destination. Today three FPGA boards (iCEstick / TinyFPGA BX / iCEBreaker) and one ASIC tier (Tiny Tapeout). Tomorrow new tiers (ChipBlocks Mini / Standard) and new boards (ECP5 dev boards, MAX10, future open boards) land as new rows.

```yaml
# Example row — the existing Tiny Tapeout slot
- id: tt-pico
  label: "Tiny Tapeout (Pico — 1× tile)"
  kind: asic-shuttle              # asic-shuttle | fpga-board
  pdk: sky130A                    # FK into pdks.yaml
  package: caravel-mux            # FK into packages.yaml
  flow: openlane-tt               # FK into flows.yaml
  area:
    width_um: 150
    height_um: 170
    transistor_budget: 25000
  tiles: 1                        # 1, 2, 4 = chained tiles per design
  clock_hz: 50_000_000
  top_module_prefix: "tt_um_"     # mandatory wrapper prefix
  submission:
    portal: "https://app.tinytapeout.com"
    cohort: "TTGF26a"             # active cohort name; "TBD" if unknown
    cohort_closes: "2026-06-22"   # ISO date or "rolling"
  free_for_open_source: true
  estimated_cost_usd: 300
```

Adapter contract: `backend/shuttles/<id>.py` exports a `prepare_bundle(graph, build_dir) -> Path` function that emits the submission bundle for that shuttle.

### 2. `pdks.yaml` — process nodes + cell libraries

One row per PDK. Today only Sky130A is used (transitively via Tiny Tapeout); tomorrow Gf180mcuB and IHP-SG13G2 are obvious candidates as their open PDK status matures.

```yaml
- id: sky130A
  label: "SkyWater 130 nm Open PDK (variant A)"
  vendor: SkyWater
  feature_size_nm: 130
  cell_library: sky130_fd_sc_hd
  cell_library_path: "$(PDK_ROOT)/sky130A/libs.ref/sky130_fd_sc_hd/verilog/"
  pdk_root_env: PDK_ROOT
  default_pnr_tool: openlane
  default_density_target: 0.55
  open_source_license: "Apache-2.0"
  notes: |
    The PDK most ChipBlocks users will encounter (via Tiny Tapeout).
    Has BJT models suitable for analog radio frontends (planned S31 OOK).
```

Adapter contract: `backend/pdks/<id>.py` exports `cell_library_path()` and tool-specific config helpers.

### 3. `cpu-cores.yaml` — packaged CPU cores (deferred to S29)

One row per packaged CPU available as a drop-in block on the canvas. Manifest row references the upstream source repo + license + ChipBlocks-side adapter wrapper. **Distinct from `blocks.yaml`** because a packaged CPU isn't a hand-authored Elaboratable — it's imported open-source IP that we wrap and re-export. ADR-004 specifies the "CPU socket" interface that every cpu-cores entry must conform to.

```yaml
# Example row — picorv32 as the canonical RISC-V option
- id: picorv32
  label: "picorv32 — small RISC-V (RV32IMC)"
  isa: rv32imc
  source: "https://github.com/YosysHQ/picorv32"
  license: "ISC"
  socket: chipblocks-cpu-socket-v1
  size_estimate_luts: 750         # iCE40HX8K
  size_estimate_transistors: 15000 # Sky130 estimate
  notes: |
    Production-grade tiny RISC-V; widely used. ISC license is permissive
    and compatible with ChipBlocks' MIT posture. First cpu-cores entry.
```

Adapter contract: `backend/cpu_cores/<id>/` is a directory containing the wrapper Amaranth module + a copy of the upstream IP (vendored, with LICENSE intact).

### 4. `radios.yaml` — radio modulation schemes (deferred to S31)

One row per radio modulation block. Each conforms to the "Radio socket" — digital data stream + clock in, baseband signal out — so they're interchangeable in a phone-class design.

```yaml
# Example row — OOK (default for phone-class per the S24 pivot)
- id: ook-433mhz
  label: "OOK transmitter (433 MHz ISM band)"
  modulation: on-off-keying
  carrier_hz: 433_920_000
  bitrate_bps: 4800
  socket: chipblocks-radio-socket-v1
  size_estimate_luts: 80
  external_components:
    - "Sub-GHz RF transistor (~$0.10 BOM)"
    - "Quarter-wave whip antenna (~$0.20 BOM)"
  notes: |
    Simplest practical digital radio. The digital part fits in any tile;
    the RF analog stage is off-chip. Range 10-100m depending on antenna.
```

Adapter contract: `backend/radios/<id>.py` exports the modulator Amaranth block.

### 5. `buses.yaml` — on-chip bus protocols (between blocks)

One row per on-chip bus protocol. Today the system uses ad-hoc per-block conventions (Counter exposes `addr-out` for `addr-u4`, RAM has its own `addr` / `data-in` / `write-enable` shape, etc.). At packaged-CPU scale a real bus protocol — Wishbone, AXI-lite, APB, or our own minimal — is needed to wire CPU ↔ peripherals consistently.

```yaml
# Example row — Wishbone-classic, the simplest pragmatic choice
- id: wishbone-classic
  label: "Wishbone B4 (Classic)"
  source: "https://opencores.org/howto/wishbone"
  license: "public-domain"
  width_bits: 32
  addr_width_bits: 32
  features:
    - read-write
    - byte-enable
    - error-ack
  notes: |
    Industry-standard simple bus protocol. Public domain, no license
    encumbrance. Widely supported by open-source CPU cores including
    picorv32 (which speaks "picorv32 native memory interface" by default
    but has a Wishbone bridge layer in the upstream repo).
```

Adapter contract: `backend/buses/<id>.py` exports master + slave wrapper Elaboratables.

### 6. `memories.yaml` — memory backends

One row per memory configuration available. iCE40 BRAM, Sky130 SRAM macros, register file, external SPI flash (with our SPI master block), external SPI DRAM, etc. The blocks.yaml RAM block today is iCE40-BRAM-flavored; making it backend-pluggable lets a Standard-tier design use a real SRAM macro instead.

```yaml
# Example row — iCE40 BRAM (the existing default)
- id: ice40-bram-4kb
  label: "iCE40 BRAM (4 KB)"
  kind: on-chip-sram
  size_bytes: 4096
  data_width_bits: 8
  addr_width_bits: 12
  read_latency_cycles: 1
  pdk_compatible: [sky130A, ice40hx]
  notes: |
    The default for FPGA targets; one row of iCE40 BRAM = 4 KB.
    Existing RAM block today hardcodes this implicitly; making it
    explicit lets a Standard-tier design opt into a SkyWater SRAM macro.
```

Adapter contract: `backend/memories/<id>.py` exports a memory-controller wrapper.

### 7. `packages.yaml` — physical packaging

One row per physical chip package. DIP-40, QFN-32, BGA, Caravel-mux (Tiny Tapeout's pin-mux wrapper), bare die. Pin assignments + electrical specs live here.

```yaml
# Example row — Caravel mux (what TT chips actually live in)
- id: caravel-mux
  label: "eFabless Caravel multi-project pin-mux wrapper"
  upstream: "https://github.com/efabless/caravel"
  license: "Apache-2.0"
  total_pins: 38
  io_pins:
    ui_in: 8                       # dedicated inputs
    uo_out: 8                      # dedicated outputs
    uio: 8                         # bidirectional
    control: 14                    # clock, reset, management, etc.
  notes: |
    The standard wrapper for eFabless shuttle submissions. Tiny Tapeout
    designs go inside this wrapper as one mux-selected user-project tile.
```

### 8. `flows.yaml` — build flow toolchains

One row per end-to-end build toolchain. The existing iCE40 flow (Yosys + nextpnr-ice40 + icepack) is one entry; the OpenLane Sky130 flow is another; future LibreLane / Yosys-only / Edalize-managed flows are new rows.

```yaml
# Example row — the existing iCE40 path
- id: yosys-nextpnr-ice40
  label: "Yosys → nextpnr-ice40 → icepack"
  target_kind: fpga-bitstream
  tools:
    - { name: yosys,         min_version: "0.30", license: ISC }
    - { name: nextpnr-ice40, min_version: "0.7",  license: ISC }
    - { name: icepack,       min_version: "0.7",  license: ISC }
  utilization_parser: backend/flows/yosys_nextpnr_ice40_parser.py
  install_check: "yosys -V && nextpnr-ice40 --version && icepack -V"
  notes: |
    The fully-open FPGA bitstream flow. Permissively licensed all the
    way down. Existing build.py implementation; will be wrapped behind
    this manifest entry in Phase 0.
```

Adapter contract: `backend/flows/<id>.py` exports `run(graph, shuttle, build_dir) -> BundleResult` and a utilization parser.

## Socket contracts

Three of the eight manifests (`cpu-cores`, `radios`, `memories`) define plug-in points where ChipBlocks-side blocks must conform to a contract so the rest of the system can wire them up generically. Each socket is a versioned interface (e.g. `chipblocks-cpu-socket-v1`); breaking changes bump the version, manifest entries declare which version they conform to.

### CPU socket — `chipblocks-cpu-socket-v1`

A packaged CPU block must expose:
- `clk`, `rst` — standard Amaranth clock + reset
- `mem-bus` — a Wishbone-Classic master interface (instruction + data — Harvard or unified depending on the core)
- `irq` — N-bit interrupt input vector (N declared per row)
- `debug` — optional debug interface (JTAG or similar)
- A non-empty `instruction_memory_template` slot for embedding compiled programs at build time

ADR-004 specifies this socket fully; this ADR just reserves the slot.

### Radio socket — `chipblocks-radio-socket-v1`

A radio modulator block must expose:
- `data-in` — 1-bit digital data stream (data-u1)
- `clk-bit` — bit-rate clock (gate-1)
- `enable` — transmit enable (gate-1)
- `baseband-out` — modulated baseband signal that drives the RF analog frontend (single-bit gate-1 for OOK / FSK; multi-bit data-u8 for spread-spectrum / chirp)

### Memory socket — `chipblocks-memory-socket-v1`

A memory backend block must expose:
- `addr` — address bus (addr-uN, width declared per row)
- `data-in` — write data (data-uM, width declared per row)
- `data-out` — read data (data-uM, same width)
- `write-enable` — write strobe (gate-1)
- `read-enable` — read strobe (gate-1; can be tied high for always-on read)
- Optional `byte-enable` for word-wide entries

## Codegen strategy

**Per-manifest codegen scripts, NOT a single mega-script.** Each manifest has its own `scripts/codegen-<manifest>-frontend.mjs` and `scripts/codegen-<manifest>-backend.py` (where the manifest has frontend impact; some, like `flows.yaml`, are backend-only). The existing `scripts/codegen-frontend.mjs` and `scripts/codegen-backend.py` are renamed to `scripts/codegen-blocks-frontend.mjs` and `scripts/codegen-blocks-backend.py` for symmetry.

Top-level orchestrator: `npm run codegen` becomes a wrapper that runs all codegen scripts in dependency order:

```
1. codegen-pdks-{frontend,backend}          (no dependencies)
2. codegen-packages-{frontend,backend}      (no dependencies)
3. codegen-flows-backend                    (depends on pdks)
4. codegen-buses-{frontend,backend}         (no dependencies)
5. codegen-memories-{frontend,backend}      (depends on pdks)
6. codegen-shuttles-{frontend,backend}      (depends on pdks, packages, flows)
7. codegen-cpu-cores-{frontend,backend}     (depends on buses)
8. codegen-radios-{frontend,backend}        (depends on pdks)
9. codegen-blocks-{frontend,backend}        (unchanged from ADR-003)
```

Each script in `--check` mode aborts with friendly error on drift; in `--write` mode regenerates its targets. CI runs all in `--check` mode; the existing `codegen-drift` job grows N more sub-steps.

**Why per-manifest, not unified:** failure isolation. If `radios.yaml` has a YAML syntax error, the blocks codegen still works and the user can keep editing. A single mega-script would block all codegen on any one manifest's error. Per-manifest scripts also surface intent in the file system — anyone seeing `codegen-cpu-cores-backend.py` immediately knows it consumes `cpu-cores.yaml`.

## Phased migration plan

Sprint 25 lands Phase 0 + the first concrete row in `shuttles.yaml`. Phase 1 happens incrementally as the phone-class roadmap (S26–S31) adds new dimensions one at a time. Phase 2 is the long-term steady state.

### Phase 0 — Sprint 25 — Schemas + scripts + shuttles.yaml row 1 (no behavior change)

1. **Author the 8 manifest schemas** as `<manifest>.schema.json` at repo root. ~80 lines each, ~640 lines total. Use the existing `blocks.schema.json` as a template; one schema borrows roughly from the next.
2. **Create empty (zero-row) manifests** at repo root for the 7 not-yet-needed dimensions: `pdks.yaml`, `cpu-cores.yaml`, `radios.yaml`, `buses.yaml`, `memories.yaml`, `packages.yaml`, `flows.yaml`. Each has just a top-level comment + an empty array. Schema validates the empty case.
3. **`shuttles.yaml`** gets four rows: the three existing FPGA boards (iCEstick / TinyFPGA BX / iCEBreaker) plus `tt-pico` (current Tiny Tapeout slot). Each row authored to match what `build.py` and `tinytapeout.py` currently hardcode.
4. **`pdks.yaml`** gets one row (`sky130A`) referenced by `tt-pico`.
5. **`packages.yaml`** gets one row (`caravel-mux`) referenced by `tt-pico`.
6. **`flows.yaml`** gets two rows (`yosys-nextpnr-ice40` for FPGA bitstream, `openlane-tt` for Tiny Tapeout submission).
7. **Write the 4 codegen scripts** needed at this phase: `codegen-shuttles-{frontend,backend}.{mjs,py}`, `codegen-pdks-backend.py`, `codegen-packages-backend.py`, `codegen-flows-backend.py`. Frontend codegen for shuttles drives the `BuildTarget` TS union + the `BUILD_TARGETS` constant in `App.tsx`.
8. **Refactor `backend/build.py` `FPGABoard` + `ALL_BOARDS` to read from `shuttles.yaml`** via the codegen output. Same logical structure, sourced differently. Hardcoded VGA pin maps move into the manifest row's `peripherals` field.
9. **Refactor `backend/tinytapeout.py` `TT_CLOCK_HZ` / `TT_TOP_PREFIX` / cohort metadata / pinout assumptions** to read from the `tt-pico` shuttle row.
10. **Byte-equality validation pass.** Existing build artifacts for all four targets must match what they produce today, file-for-file. Iterate until clean.
11. **CI `codegen-drift` job extended** to cover the new scripts.
12. **Tests:** new `backend/tests/test_shuttles_manifest.py` + `frontend/test/shuttles-manifest.test.ts` mirror the existing block-manifest-integrity tests: every manifest row references files that exist + classes/symbols that import + adapter contract methods that exist. ~12 dynamic cases.

**Estimated effort: 1 sprint** (~5-8 hours). Highest risk in step 10 — the byte-equality validation for the four build paths. If the existing build outputs aren't perfectly reproducible from the manifest, the gap is friction-paid in step 8/9. Expected mitigation: keep the existing constants commented-out in build.py during the refactor, run a build before + after each step, byte-compare.

### Phase 1 — incremental as phone-class roadmap lands (S26 → S31)

Each subsequent phone-class sprint adds new rows to the relevant manifest as a natural byproduct of the sprint's main work:

- **S26 (bus protocols):** `buses.yaml` row `wishbone-classic` added (anticipating S29's CPU). Peripheral blocks (SPI / I²C / UART / GPIO / PWM) in `blocks.yaml` declare which `buses.yaml` entry they speak.
- **S27 (display + input):** new `peripherals` entries on the existing `tt-pico` / `icebreaker` shuttles for "ST7789 LCD + FT6236 touch on PMOD1B + buttons on PMOD2."
- **S28 (audio out + haptics):** PWM-audio + LED + vibration motor blocks declare their pad requirements.
- **S29 (packaged CPU):** ADR-004 lands; `cpu-cores.yaml` row 1 = `picorv32`; `backend/cpu_cores/picorv32/` vendored from upstream.
- **S30 (system glue):** Interrupt controller + timer + reset/clock manager become standard peripherals; `buses.yaml` may get an `apb` row for low-power peripheral bus.
- **S31 (radio):** `radios.yaml` rows 1-2 = `ook-433mhz` + `audio-fsk-bell-202`. Optional LoRa-CSS as row 3 if effort permits.

Each addition is **1 row + 1 adapter** per ADR's promise. No refactors.

### Phase 2 — long-term steady state (post-S32)

- **New shuttle tiers** (ChipBlocks Mini at 500×500 µm, Standard at 1 mm², Macro via tile-chaining) land as new `shuttles.yaml` rows once the partnership / MPW logistics with eFabless / SkyWater are arranged. Pre-row work is logistical, not technical.
- **Second PDK** (Gf180mcuB or IHP-SG13G2) lands as one `pdks.yaml` row plus per-cell-library adapter; blocks themselves don't change because Amaranth is technology-independent until elaboration.
- **Community-contributed CPU cores / radios / memory backends** become PRs that add one manifest row plus one adapter directory.

## Tests and verification

Mirroring the ADR-003 testing strategy at the new scope:

1. **Byte-equality assertion in Phase 0.** Every build target's output must match today's output byte-for-byte after the refactor. This is the canonical "we didn't break anything" gate.
2. **Existing test suites pass unchanged.** 217+2 backend pytest + 321 frontend vitest. Zero test edits in Phase 0. If any test fails, the refactor is wrong.
3. **New manifest-integrity tests** per manifest, mirroring the block-side pattern:
   - `backend/tests/test_shuttles_manifest.py` — every shuttle row references real files at declared paths, real classes at declared names, valid foreign keys into pdks / packages / flows. ~3 invariants × 4 rows = 12 dynamic cases at Phase 0; grows as rows are added.
   - `frontend/test/shuttles-manifest.test.ts` — every shuttle row's `id` appears in the codegen-generated `BuildTarget` union; every row's `label` appears in the `BUILD_TARGETS` UI list. ~2 invariants × 4 rows = 8 cases at Phase 0.
   - Same shape for pdks / packages / flows / buses / cpu-cores / radios / memories as they materialize.
4. **CI `codegen-drift` job** grows from 2 sub-steps (blocks frontend + blocks backend) to ~16 sub-steps (8 manifests × ~2 codegen scripts each). Runtime stays in the ~30 second range because each manifest is small.
5. **Schema-validation step in each codegen** aborts cleanly with friendly errors. "shuttles.yaml row 2: missing required field `pdk` — must reference a row in pdks.yaml" beats a stack trace.

**Test count delta projected:**
- Backend pytest: 217+2 → ~240+2 (+~23 dynamic across the 8 manifests once all populated; lower in Phase 0 since most manifests start empty)
- Frontend vitest: 321 → ~345 (similar growth)

## Consequences

**Becomes easier:**

- **Adding a new shuttle tier** is 1 row + 1 adapter; never touches `build.py`'s core logic. The user can opt into an organized MPW run for "ChipBlocks Standard" without that decision rippling through every build path.
- **Swapping a PDK** is one manifest row swap; blocks themselves don't change. Gf180mcuB support becomes a single sprint.
- **Adding a packaged CPU** is one `cpu-cores.yaml` row + one wrapper. Picorv32 today; VexRiscv, NeoRV32, even a 6502 tomorrow, each in a row.
- **Adding a radio** is one `radios.yaml` row + one modulator block. OOK today, audio-FSK alongside it, LoRa-CSS when motivated.
- **Build-tool upgrades** localize: if Yosys ships a breaking-changes release, only the `flows.yaml` row for `yosys-nextpnr-ice40` and its adapter need updating. The block library is untouched.
- **AI consultant** gains structured grounding about what's fab-able where. Today the AI knows about blocks; after this ADR it also knows about shuttles, PDKs, and what each shuttle can fit.

**Becomes harder:**

- **The codegen surface grows** from 2 scripts to ~16. Each is small (~80-150 LOC) and per-manifest, so failure is isolated, but the total LOC of codegen is real.
- **8 schemas to maintain**, each with its own edge cases. Mitigation: schemas are written once, then mostly evolve by adding optional fields. New required fields trigger a `kind: deprecated` rename + a migration path.
- **Foreign-key validation across manifests** (e.g. shuttle row references a pdk row that exists) is new test-side work. Mitigation: standardize the validation in a shared `scripts/codegen-fk.py` helper.
- **One-time cost of Phase 0.** Estimated 1 sprint of focused work. Higher than ADR-003's 5-hour budget because the surface is 8× larger; lower than 8×ADR-003 because the codegen pattern is reusable across all 8 manifests.

**To revisit when:**

- **The 8 dimensions feel wrong.** If a 9th obviously-distinct manifest becomes necessary (the candidate I flagged in the previous turn: `clocking.yaml` for PLLs / clock dividers / clock domains separate from PDK), add it. Manifests are themselves modular.
- **Foreign-key dependency between manifests becomes complex.** Today the DAG is linear (pdks ← flows ← shuttles); if it grows to be cyclic or layered, a real dependency-resolver becomes worth building.
- **A community contributor wants to add a row** but the schema constrains them in a way they don't like. Schema additions are cheap; schema changes are not. Be conservative about field types in the initial schemas (prefer `string` + freeform `notes:` over rigid enums) so future-proofing is additive.

## Alternatives considered

### Option A — Don't refactor; live with the hardcoded build paths

| Dimension | Assessment |
|---|---|
| Complexity | Zero (status quo) |
| Cost | Linear with new tier additions; ~1-2 sprints of band-aid per new shuttle |
| Future-proofing | Worst |

**Reject:** the phone-class roadmap explicitly demands "modular fab platform — we can always add new stuff" (user, 2026-05-14). Living with hardcoded build.py means every phone-class sprint pays the cost of fighting it. The compounding savings from ADR-003 (block-addition cost dropped ~80%) won't repeat at the fab-target level if the fab target stays hardcoded.

### Option B — Single mega-manifest (one big `platform.yaml`)

| Dimension | Assessment |
|---|---|
| Complexity | Lower codegen surface (1 script not 16) |
| Cost | Higher schema authoring (one giant schema) |
| Failure isolation | Worse — YAML error blocks all codegen |

**Reject:** mixed concerns in one file is hard to reason about. A user editing the radio section shouldn't risk breaking the build flow. Per-manifest separation is closer to how the user thinks about the dimensions.

### Option C — Plugin system (drop-in `.py` modules with decorators)

Each new fab dimension is added by dropping a Python module into a magic directory; module auto-registered via a decorator.

| Dimension | Assessment |
|---|---|
| Complexity | Highest (two registration systems — manifest + plugin loader) |
| Single-pane-of-glass | Lost — no central view of "what shuttles exist" |
| TypeScript-side codegen | Impossible (TS can't import Python plugins) |

**Reject:** same reason ADR-003 rejected filesystem auto-discovery. Solo dev + non-technical user benefits from "one place to look." Asymmetric language support (Python plugins, TypeScript codegen) creates twin failure modes.

### Option D — Build it incrementally per-manifest as each phone-class sprint demands

Don't author ADR-005 up front; let each sprint (S26 / S27 / S28...) introduce its own dimension's manifest as needed.

| Dimension | Assessment |
|---|---|
| Up-front cost | Lower (no Phase 0 sprint) |
| Compound cost | Higher (every sprint negotiates its own schema; cross-manifest FK conventions drift) |
| Risk of contradiction | High (S26's bus protocol may shape what S29's CPU socket can do; without the schema agreed up front, S26 may make decisions that constrain S29) |

**Reject:** the dimensions are coupled. CPU socket references bus protocol; shuttle references PDK + package + flow. Authoring the schemas all at once now, even if only `shuttles.yaml` gets a populated row in Sprint 25, avoids redesign work in S26-S31. Pay the structural cost up front when the design space is most flexible.

## Action items — Sprint 25

Each lands as a single commit on a branch, in this order:

1. [ ] **8 schema files** at repo root: `shuttles.schema.json`, `pdks.schema.json`, `cpu-cores.schema.json`, `radios.schema.json`, `buses.schema.json`, `memories.schema.json`, `packages.schema.json`, `flows.schema.json`. ~80 lines each, ~640 lines total. Each validates the row shape per Section "The eight manifests" above.

2. [ ] **`shuttles.yaml` with 4 rows** (`icestick`, `tinyfpga-bx`, `icebreaker`, `tt-pico`) authored from the current state of `build.py` / `tinytapeout.py`.

3. [ ] **`pdks.yaml` with 1 row** (`sky130A`), `packages.yaml` with 1 row (`caravel-mux`), `flows.yaml` with 2 rows (`yosys-nextpnr-ice40`, `openlane-tt`). The other 4 manifests (`cpu-cores.yaml`, `radios.yaml`, `buses.yaml`, `memories.yaml`) created with empty arrays + a top-of-file comment explaining the dimension; rows added in their respective phone-class sprints.

4. [ ] **8 codegen scripts** (`codegen-<dim>-{frontend,backend}.{mjs,py}`) at `scripts/`. Rename existing `codegen-frontend.mjs` → `codegen-blocks-frontend.mjs` and `codegen-backend.py` → `codegen-blocks-backend.py` for naming symmetry. Top-level `npm run codegen` wrapper runs all in dependency order.

5. [ ] **`build.py` refactor** — `FPGABoard` + `ALL_BOARDS` read from generated registry sourced from `shuttles.yaml` + `pdks.yaml` + `packages.yaml` + `flows.yaml`. Tool invocations read from `flows.yaml` adapters. Utilization parsing moved into `backend/flows/yosys_nextpnr_ice40_parser.py`.

6. [ ] **`tinytapeout.py` refactor** — `TT_CLOCK_HZ` / `TT_TOP_PREFIX` / pinout / cohort metadata read from the `tt-pico` shuttle row. Submission flow read from the `openlane-tt` flow row.

7. [ ] **Byte-equality validation pass.** For each of the 4 build targets, build a representative example graph before + after the refactor and verify byte-identical bundle output. Adjust until clean.

8. [ ] **Test additions** — `test_shuttles_manifest.py` + `test_shuttles_manifest.ts` and equivalents for the other manifests as their rows materialize. ~12 dynamic cases at Phase 0.

9. [ ] **CI `codegen-drift` job** extended to cover all 16 codegen scripts.

10. [ ] **Doc bumps** — CLAUDE.md core constraints (already done in mid-S24 pivot doc reconciliation); ARCHITECTURE.md gains a "Build target system" subsection pointing at this ADR; ROADMAP.md S25 row marked done; KNOWN-ISSUES.md cross-checked for any deferrals that this ADR closes.

11. [ ] **Sprint retro.** SPRINT-25.md captures what surfaced. Highest-likelihood surfacing: cross-manifest foreign-key validation (shuttle row references a pdk row that doesn't exist) needs a shared helper rather than per-script reimplementation.

**Estimated effort: 1 sprint (~5-8 hours).** Highest risk in step 7 — byte-equality validation across the FPGA bitstream + the Tiny Tapeout submission package. Both are deterministic given the same inputs but have surfaces (whitespace in info.yaml, ordering of pin assignments in .pcf, etc.) prone to incidental difference.

## What this unblocks

After Sprint 25 lands:

- **S26 onward becomes pure additive work.** Every phone-class block + new fab feature lands as 1 row + 1 adapter in the relevant manifest. No more "rewrite build.py to support X" sprints.
- **Adding ChipBlocks Mini / Standard tiers** is a few new rows in `shuttles.yaml` whenever the eFabless / SkyWater MPW logistics are arranged. No code changes; the manifest absorbs the new tiers.
- **Community contribution onramp shortens.** A first-time contributor adding a new CPU core or radio modulator follows the same 1-row + 1-adapter pattern; no need to learn the build pipeline internals.
- **The AI consultant gains structured knowledge of the platform.** Today the AI knows "iCE40 / TT" as keywords; after this ADR it can answer "which shuttle does my design fit on?" "what PDKs are available?" "what's the BOM cost for OOK vs LoRa?" because every dimension is enumerable from the manifests.

## Open questions for the user before kickoff

These aren't blockers for the ADR itself, but knowing the answers helps shape Phase 0:

1. **Default radio for S31** (asked in the prior turn; restating here for the record). Lean toward OOK; user has not yet confirmed.
2. **Naming for the shuttle tier names.** "Pico / Mini / Standard / Macro" is one option; "tt-pico / cb-mini / cb-standard / cb-macro" is another (the cb- prefix distinguishes "ChipBlocks-organized" from "Tiny Tapeout-organized"). My lean: `tt-pico` for the existing TT slot (it IS organized by TT), and `cb-mini` / `cb-standard` / `cb-macro` for future in-house tiers.
3. **CPU socket version naming.** `chipblocks-cpu-socket-v1` is verbose. Alternative: `cb-cpu-v1`. My lean: the full name in the manifest, shorthand in code.
4. **Whether `packages.yaml` is its own manifest or a sub-section of `shuttles.yaml`.** Today every shuttle has exactly one package. If that 1:1 holds, packaging could fold into the shuttle row. My lean: keep them separate from day one — anticipated 2nd cohort case is one shuttle (e.g. ChipBlocks Standard) offered in multiple package options (QFN-32 vs DIP-40 for hand-solderable vs PCB-mountable). Separation pays off when that lands.
