# OPEN-HARDWARE-ECOSYSTEM.md

> **This file is not a roadmap commitment.** It records external open-hardware projects and patterns that may become useful when ChipBlocks reaches higher-layer assemblies, CPUs, chiplets, boards, and manufacturing integrations.
>
> **Status:** living document. Last verified 2026-05-20. PDK and IP landscape is volatile (two open PDKs got archived in April 2026); cite the verification date when leaning on an entry.
>
> **Scope:** open / permissive / no-strings-attached hardware only. Closed-source tools mentioned only where they help explain why an open alternative matters.

---

## Purpose

ChipBlocks is open-source electronics design. The mature open-hardware ecosystem ChipBlocks's Layer 6 (assemblies — CPU cores, accelerators), Layer 7 (boards / chips), and chiplet integration patterns will eventually reference is small, mostly Apache 2.0, and shifts year-to-year. This doc tracks who's doing what so future contributors authoring Layer 6+ blocks have a verified pool to point at.

Nothing in this doc creates a Sprint 3–6 obligation. Earliest realistic relevance is Sprint 15+.

---

## License posture

| License family | Status for ChipBlocks community blocks |
|---|---|
| Apache 2.0 | ✓ Accepted (dominant in the open-hardware space) |
| MIT, BSD, ISC, CC0 | ✓ Accepted |
| CERN-OHL-P (Permissive) | ✓ Accepted (hardware-specific permissive) |
| Solderpad Hardware License (Apache 2.0 variant) | ✓ Accepted |
| CERN-OHL-W (Weakly reciprocal) | ⚠ Case-by-case |
| CERN-OHL-S (Strongly reciprocal) | ⚠ Probably reject — "GPL for hardware" |
| Custom permissive (e.g., Syntacore SHL) | ⚠ Case-by-case (read carefully) |
| GPL / AGPL / LGPL | ✗ Reject for shipped blocks (per CLAUDE.md core principle 4) |

This is the queued **ADR-010 candidate** — locks before the first community pack arrives.

---

## Open CPU / RISC-V IP

| Project | License | Maturity | Notes |
|---|---|---|---|
| **lowRISC Ibex** | Apache 2.0 | ✓ Production-quality | 32-bit RISC-V core. Multi-tapeout. Used in OpenTitan + Google security chips. Verified [github.com/lowRISC/ibex](https://github.com/lowRISC/ibex). |
| **Syntacore SCR1** | Custom SHL (not Apache/MIT) | ✓ Silicon-proven | RV32I/E + RVM/RVC. License needs case-by-case review (per ADR-010 criteria). |
| **Tenstorrent Ocelot** (`riscv-ocelot`) | Apache 2.0 | Active research | Berkeley out-of-order machine with V-extension. 247★. Verified [github.com/tenstorrent](https://github.com/tenstorrent). |
| **Tenstorrent Ascalon / Ascalon-X** | IP licensing (transparent architecture) | Shipping in customer SoCs (LG, Hyundai reported 2026) | 8-wide decode OoO superscalar; ~21 SPECint2006/GHz per third-party reports. Reference architecture, not a downloadable HDL repo. |
| **Tenstorrent Babylon** | TBD | In development | Ascalon successor; reported 18-month cadence. Single-source claim; verify before depending. |
| **OpenHW Group CORE-V** (CV32E40P, CV32E40X, etc.) | Solderpad Hardware License (Apache 2.0 variant) | Production-targeted | Industry consortium-developed. Not independently verified this session; worth a future fetch. |
| **lowRISC Sunburst** | Apache 2.0 | ⚠ Research-stage (TODOs before tapeout) | CHERIoT-Ibex + OpenTitan peripheral integration. Useful as a reference *structure*, not a production SoC. |

---

## Open accelerator / AI hardware IP

| Project | License | Notes |
|---|---|---|
| **Tenstorrent TT-Metalium** (`tt-metal`) | Apache 2.0 | Low-level kernel programming model + TT-NN operator library. 1,453★. AI-side; not directly relevant to ChipBlocks's electronics-design focus but a useful precedent. |
| **Tenstorrent TT-Forge** | Apache 2.0 | MLIR-based compiler. Public beta. 224★. |
| **Tenstorrent TT-MLIR** | Apache 2.0 | MLIR compiler infrastructure. 271★. |
| **Tenstorrent Tensix AI cores** | Transparent IP (architecture open; HDL specifics via licensing) | Per [tenstorrent.com](https://tenstorrent.com/): *"Our IP is transparent, our architectures are open, and our software is open source."* |
| **Whisper** (Tenstorrent) | Apache 2.0 | RISC-V instruction-set simulator. Useful Sprint 15+ as validator reference. |

---

## Open chiplet / packaging ecosystems

| Project | License / Status | Notes |
|---|---|---|
| **Open Chiplet Atlas (OCA)** | Open specification (per Tenstorrent: *"no lock-ins or licensing fees"*) | Heterogeneous chiplet integration spec. Plug-and-play across vendors. Architectural pattern for ChipBlocks Layer 7 when chiplet-level assembly arrives. |
| **UCIe (Universal Chiplet Interconnect Express)** | Open spec, royalty-free | Industry consortium (Intel/AMD/Arm/etc.). Spec is open even though the consortium is closed. Real-world chiplet interconnect standard. |
| **Bunch of Wires (BoW)** | Open spec | Earlier open chiplet interconnect; UCIe has more momentum but BoW persists. |
| **CHERIoT** (security extension to RISC-V) | Open spec + Apache 2.0 reference impls | Capability-based hardware security model. Used in lowRISC Sunburst. Parallel discipline to ChipBlocks's provenance trail. |

---

## Open PDK / fab ecosystem

Cross-reference: see [MATERIAL-SOURCES.md](MATERIAL-SOURCES.md) for the verified open-PDK landscape snapshot (IHP SG13G2 actively maintained; SkyWater SKY130 + GF180MCU archived April 2026). Not duplicated here.

---

## Candidate ChipBlocks integrations (future, not current sprint)

| ChipBlocks layer | Open-hardware ecosystem reference | Earliest sprint |
|---|---|---|
| Layer 4 (primitive devices) | RISC-V instruction set as a behavior set (when devices.yaml reaches gates) | Sprint 8+ |
| Layer 6 (assemblies — CPU cores, accelerator cores) | Ibex / SCR1 / CORE-V / Ocelot / Ascalon as reference implementations | Sprint 15+ |
| Layer 7 (boards / chips) | OCA + UCIe chiplet architecture patterns; IHP SG13G2 PDK as a fabricable reference | Sprint 20+ |
| Cross-cutting (license validation) | Apache 2.0 / MIT / Solderpad / CERN-OHL-P whitelist enforced at community-pack install time | Sprint 6+ (ADR-010) |
| Tooling interop | Yosys (Verilog synthesis), Verilator (simulation), KiCad (PCB EDA) — already noted in TOOLING-RESEARCH-2026-05.md | Sprint 6+ |

---

## Not-current-sprint notes

- **Sprint 3** (devices + cross-FK validator): unaffected. Plan stable per commits 29f39e8 + a79064f.
- **Sprint 5** (steady-state validator): doesn't reach Layer 6+ work. No dependency on anything in this doc.
- **Sprint 6** (AI integration + manufacturing skeleton + first demo): the demo target is 5V battery → switch → R → LED. Nothing in this doc is relevant.
- **Sprint 15+**: Layer 6 assemblies (e.g., CPU cores) become authorable. This is where the open RISC-V IP pool above becomes a real reference.
- **Sprint 20+**: Layer 7 chiplet / SoC composition. OCA + UCIe patterns become relevant.

**Rule:** nothing in this doc is a dependency on any sprint earlier than 15. If a Sprint 3-9 design question seems to require something from here, the question is in the wrong place.

---

## Closed alternatives (context only, not catalogued)

For context — these exist in the closed-source landscape but are NOT in scope for ChipBlocks community-block acceptance:

- ARM cores (proprietary, royalty-bearing)
- NVIDIA CUDA + GPU IP (proprietary)
- Synopsys + Cadence EDA tools (commercial)
- Proprietary PDKs from TSMC, Samsung, Intel Foundry (NDA-required)

Mentioned only so contributors understand what "open" is competing against. Not catalogued because the doc's scope is open ecosystem.

---

## Verification log

| Date | What was verified | Method | Result |
|---|---|---|---|
| 2026-05-18 | lowRISC Ibex (Apache 2.0, production-quality) | WebFetch | ✓ Confirmed |
| 2026-05-18 | Syntacore SCR1 (license claim) | WebFetch | ⚠ Custom SHL, not Apache/MIT/CERN-OHL as originally claimed |
| 2026-05-18 | lowRISC Sunburst (production claim) | WebFetch | ⚠ Research-stage, not production-ready |
| 2026-05-20 | Tenstorrent GitHub org (license + repos) | WebFetch | ✓ All Apache 2.0; ocelot/tt-metal/tt-mlir/tt-forge/Whisper verified |
| 2026-05-20 | Tenstorrent homepage (open-source posture) | WebFetch | ✓ "transparent IP, open architectures, open software" verbatim |
| 2026-05-20 | Open Chiplet Atlas (OCA) | WebSearch | ⚠ Reported by news sources (SDxCentral); not independently fetched at canonical Tenstorrent spec page yet |

**Not yet verified at canonical source** (future fetch candidates):
- OpenHW Group CORE-V cores
- UCIe specification (current revision + license terms)
- CHERIoT reference implementation status
- Tenstorrent Ascalon HDL availability (the architecture is open per their homepage, but is the RTL actually downloadable?)

---

## When to revisit

- **Quarterly** — re-verify GitHub repo activity + license terms; flag any archive events (the April 2026 PDK consolidation showed how fast this can shift).
- **Before any Sprint 15+ planning starts** — full re-verification + fill the "not yet verified" gaps above.
- **When a contributor proposes a community pack referencing one of these projects** — verify the specific commit / version they're depending on, not just the project's general state.
- **When the queued ADR-010 (community-pack license whitelist) is drafted** — this doc's license posture table is the source of truth.

---

## What this doc does NOT do

- It does not commit ChipBlocks to integrating with any project listed.
- It does not catalog closed-source tools (mentioned only for context).
- It does not duplicate the open-PDK landscape (that's [MATERIAL-SOURCES.md](MATERIAL-SOURCES.md)).
- It does not duplicate the modern-toolchain research (that's [TOOLING-RESEARCH-2026-05.md](TOOLING-RESEARCH-2026-05.md)).
- It does not list every open RISC-V core or accelerator that exists — only those with production-grade evidence or active community momentum verified within the last few months.
