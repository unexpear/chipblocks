# MATERIAL-SOURCES.md

> **What this is:** the contributor reference for [materials.yaml](materials.yaml) (Layer 0). Names which sources count as canonical for each material category, so every shipped value can be cited against named, accessible references — not pulled from memory or single-sourced.
>
> **Status:** living document. **Last verified 2026-05-18.** PDK landscape in particular is volatile (two major open PDKs got archived in April 2026); cite the verification date when leaning on an entry below.
>
> **Current-state note (2026-05-20):** `materials.yaml`, `provenance.schema.json`, and the per-material `*.schema.json` files don't currently exist on master — they were wiped in the second reset and return in v3 Sprint 2+. The phrasing below describes how the registry works *when populated*; the canonical-source guidance still applies. ADR-007 (referenced below) is marked HISTORICAL; its provenance-fragment shape is now described in [OBJECT-MODEL.md](OBJECT-MODEL.md) §9.
>
> **Why this exists:** every value in [materials.yaml](materials.yaml) carries the provenance fragment per [ADR-007](ADR-007-active-variables.md) — value + units + source + conditions + confidence + tolerance + notes. This doc says *which sources count as canonical* for each material category, and how to combine multiple sources so the shipped value is honest.

---

## The multi-source principle

A single source can be wrong, out of date, or subtly misapplied (different temperature assumption, alloy composition, process node). **The rule:** every shipped builtin material value should cite at least two independent canonical sources where they exist.

**Exceptions** (single-source is acceptable):
- Fundamental physical constants → NIST CODATA is canonical; no second source needed.
- Values where only one authoritative source exists → cite the single source AND mark confidence one tier lower than otherwise.

**The payoffs:**

| Sources... | ...result |
|---|---|
| Agree within ~5% | High confidence, narrow tolerance |
| Disagree 5-20% | The spread *becomes* the honest tolerance (`tolerance: { min, max, distribution }`) |
| Disagree >20% | Investigate before shipping. Either the conditions differ (document them), or one source is wrong (cite the more authoritative one and explain the discrepancy in `notes`). |
| Only one available | Confidence drops a tier; `notes` field flags the gap as cross-reference-needed |

---

## Per-category source combo

| Material category | Tier-A canonical sources | Tier-B cross-reference sources |
|---|---|---|
| **Fundamental physical constants** (elementary charge, Boltzmann, ε₀, μ₀) | NIST CODATA | — (single canonical justified) |
| **Conductor / metal resistivity + thermal** (Cu, Al, Au, Ag, Ni, W) | NIST + IEC standards (e.g., IEC 60028 for copper) | CRC Handbook of Chemistry and Physics; ASM Metals Handbook |
| **Semiconductor materials** (Si, Ge, GaAs, GaN, InP, SiC, doped Si) | Ioffe NSM Archive; Sze "Physics of Semiconductor Devices" 3rd ed. | IHP SG13G2 PDK (130nm SiGe BiCMOS); manufacturer datasheets (Wolfspeed for SiC, Qorvo for GaN, etc.) |
| **PCB / dielectric laminates** (FR4, polyimide, alumina, PTFE, low-k) | IPC-4101; IPC-TM-650 | Manufacturer datasheets — multi-vendor (Isola, Rogers, ITEQ, Panasonic, Taconic) because grades vary |
| **Solder alloys + assembly** (Sn63Pb37, SAC305, Sn99.3Cu0.7) | IPC J-STD-006; IEC 61190-1-3; IPC-A-610 (acceptability) | ASM Handbook Vol. 6 (Welding/Brazing/Soldering); alloy manufacturers (AIM, Indium, Kester) |
| **Resistive alloys** (carbon film, metal film / NiCr, ruthenium oxide, tantalum nitride) | Resistor industry handbooks (Vishay, KOA Speer technical notes) | CRC Handbook for bulk material; manufacturer datasheets for thick/thin-film parts |
| **Magnetic materials** (Mn-Zn / Ni-Zn ferrites, electrical steel, permalloy) | IEC 62317 (ferrite cores); IEC 60404 (magnetic materials) | Manufacturer datasheets (TDK, Murata, Ferroxcube, Magnetics Inc.) |
| **General engineering / specialty materials** (epoxies, phosphors, glasses, piezos) | MatNavi (NIMS Japan, free with registration) | ASM Engineered Materials Handbook; CRC Handbook |
| **Battery chemistries** (alkaline, Li-ion, Li-polymer, NiMH, lead-acid) | ANSI/IEC 60086 (primary); IEC 61960 (Li-ion secondary) | Manufacturer datasheets (Energizer, Duracell, Panasonic, Samsung SDI, LG Chem) |

---

## Open-PDK landscape (verified 2026-05-18)

Open Process Design Kits are useful as **cross-reference sources** for semiconductor + process-specific material values. The landscape shifted materially in April 2026 — two of the three major open PDKs got archived inside the same week. This snapshot is current as of mid-May 2026 and should be re-verified quarterly.

| PDK | Node + type | License | Status | Last activity | Use case |
|---|---|---|---|---|---|
| **IHP SG13G2** | 130nm SiGe BiCMOS | Apache 2.0 | ✓ Actively maintained | Release Mar 11 2026; 1,581 commits | The currently-maintained reference for 130nm process-specific values + SiGe HBT data |
| **SkyWater SKY130** | 130nm CMOS | Apache 2.0 | ⚠ **Archived Apr 18 2026** (read-only) | — | Historical/educational reference; first major no-strings open PDK. Structure of PDK files is canonical; values are alpha-quality. |
| **GF180MCU** | 180nm CMOS | Apache 2.0 | ⚠ **Archived Apr 22 2026** (read-only) | — | Historical/educational reference; archived 4 days after SkyWater. |
| **ASAP7** (Arizona State predictive) | 7nm predictive (academic) | Custom academic | Periodic updates | — | Predictive only; useful for sub-22nm references but NOT a real foundry kit |
| **FreePDK45** (NCSU) | 45nm predictive | Custom academic | Older but stable | — | Predictive academic reference for older nodes |

**The principle for ChipBlocks:** don't anchor Layer 0 on any single PDK. Cross-reference across the surviving active PDK + the historical archived ones + textbook sources + manufacturer datasheets. Where they agree → high confidence. Where they disagree → honest spread captured in tolerance.

---

## Verified canonical-source URLs (2026-05-18)

| Source | URL | Verified |
|---|---|---|
| NIST CODATA Fundamental Physical Constants | https://physics.nist.gov/cuu/Constants/ | ✓ 2022 values current; 2026 adjustment scheduled |
| Ioffe NSM Archive (semiconductor properties) | http://www.ioffe.ru/SVA/NSM/Semicond/ | ✓ Si/Ge/GaAs/GaN/InP/SiC/Diamond + alloys |
| MatNavi (NIMS Materials Database) | https://mits.nims.go.jp/en/ | ✓ Free with registration |
| IHP SG13G2 Open PDK | https://github.com/IHP-GmbH/IHP-Open-PDK | ✓ Active, Apache 2.0 |
| SkyWater SKY130 Open PDK | https://github.com/google/skywater-pdk | ⚠ Archived 2026-04-18 |
| GF180MCU Open PDK | https://github.com/google/gf180mcu-pdk | ⚠ Archived 2026-04-22 |
| IPC standards (paid, search portal) | https://shop.ipc.org/ | Cited by spec number (e.g., IPC-4101/126) |
| Yosys (Verilog synthesis, for chip-side context) | https://github.com/YosysHQ/yosys | ✓ ISC license, v0.65 (May 12 2026) |
| KiCad (EDA, for board-side context) | https://www.kicad.org/ | ✓ v10.0.3 (May 15 2026) |
| Awesome Open Source Hardware (aolofsson) | https://github.com/aolofsson/awesome-opensource-hardware | ✓ Curated list, 2.3k stars |
| CircuitSnips (KiCad schematics repository) | https://www.circuitsnips.com/ | ✓ 4000+ schematics, GitHub-sourced |
| kiip.ee (EDA tools directory) | https://kiip.ee/en/tools/ | ✓ Estonian-hosted EDA tools index |

**Could not verify on 2026-05-18:** OpenCores (https://opencores.org/) — fetch failed with `ECONNREFUSED`. Site may be down, unreachable, or in transition. Verify before citing.

---

## How to cite multiple sources in materials.yaml today

The current [provenance schema](provenance.schema.json) has a single `source` object per property. Until the schema upgrades to a `sources: [...]` array (see "Planned schema enhancement" below), multiple references go in the `citation` string separated by semicolons:

```yaml
resistivity:
  value: 1.68e-8
  units: ohm_meter
  source:
    type: standard
    label: "Copper resistivity at 20 C (annealed)"
    citation: "NIST CODATA 2018; IEC 60028 international annealed copper standard; CRC Handbook 102nd ed."
  conditions:
    temperature: { value: 20, units: degC }
  confidence: high
  tolerance: { min: 1.65e-8, max: 1.72e-8, distribution: normal }
```

**Each cited reference must be:**

- **Real** — verifiable URL, DOI, ISBN, or spec number
- **Reachable** — free access preferred; paid specs (IPC) OK if cited correctly with full spec number
- **Specific** — name the page, table, section, or revision when the source is large

**Forbidden:**

- Citing a source you haven't actually read or can't access
- Citing AI-generated content as a source (this doc itself is not a citable source — it points at the canonical ones)
- Vague citations like "engineering handbook" or "industry standard" without naming which one

---

## Planned schema enhancement (not yet adopted)

When the project has enough materials entries that programmatic cross-reference checking becomes useful, the provenance schema will upgrade from singular `source` to plural `sources`:

```yaml
sources:
  - type: standard
    label: "Copper resistivity at 20 C (annealed)"
    citation: "NIST CODATA 2018"
    url: "https://physics.nist.gov/cuu/Constants/"
  - type: standard
    label: "IACS reference"
    citation: "IEC 60028:1925"
    url: "https://shop.ipc.org/..."
  - type: reference
    label: "CRC Handbook"
    citation: "CRC Handbook 102nd ed., section 12-41"
    url: null
```

The semicolon convention used today is the placeholder. When the upgrade lands, a migration script splits existing strings into the array form.

This enhancement is queued for whichever sprint first needs a validator that checks "does every source actually resolve to a known reference?" — likely Sprint 5+ when the validator gets serious about reporting confidence to the user.

---

## When to revisit this doc

- **Quarterly** — re-verify URLs and PDK archive status. April 2026's PDK consolidation showed the landscape can shift fast.
- **When a contributor adds an entry citing a source not listed here** — either add the source as a new Tier-A/B reference, or push back if it isn't reachable or canonical.
- **When the schema upgrades** to `sources: [...]` — migrate the existing semicolon-citation strings and remove the "How to cite multiple sources today" section.
- **When a sprint adds a new material category** (e.g., piezoelectric materials, photonic materials) — extend the per-category table.

---

## What this doc does NOT do

- It does not enumerate every shipped material — that's [materials.yaml](materials.yaml).
- It does not lock specific values — values live in materials.yaml with full provenance.
- It does not cover Layer 1+ (shapes, interfaces, behaviors) — those layers have their own (currently smaller) sourcing concerns, captured inline in their notes fields.
- It does not pre-approve sources from training-data memory. Every source listed here was verified against its canonical URL on the date stamped above.
