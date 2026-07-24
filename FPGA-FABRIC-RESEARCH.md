# FPGA-FABRIC-RESEARCH.md

> **This file is not a roadmap commitment.** It records how FPGAs work internally, how they evolved, and — the point of the doc — which FPGA fabrics are documented publicly in enough detail that ChipBlocks could model the actual fabric (LUTs, routing, configuration memory), not just the pinout, and potentially place-and-route or simulate a design onto it.
>
> **Status:** living document. Last verified **2026-07-24** via three research passes + a staging red-team + a code-grounded Stage-1 design workflow (see Verification log; the Stage-1 plan is Appendix A). The academic fundamentals are stable; vendor device numbers are current-generation and can move with new silicon.
>
> **Scope:** FPGA architecture + the open-source bitstream-documentation ecosystem, oriented at what ChipBlocks (first-principles, everything-real-and-cited) could realistically build. Closed families are noted only to explain why the open ones matter.
>
> **Why this doc exists:** ChipBlocks already ships the Lattice **iCE40UP5K-SG48** in the catalog as a pin-level assembly part, deliberately modeled as a black box at its terminals (`solver_status: defined_not_solved`) because "its behaviour is whatever bitstream you load into it, which is a design, not a device property." This doc asks whether that black box could become a **real, descendable, simulatable fabric**, and for which parts that is honest (i.e. documented, not faked).

---

## Purpose

ChipBlocks already has the middle of an FPGA-fabric flow: **Verilog→gates synthesis** (`verilog-synth.ts`), a **gate-level logic simulator** (`logic-sim.ts`), a **standard-cell place-and-route + LVS/DRC engine** (`cell-place.ts`, `chip-layout.ts`, `lvs.ts`, `cell-drc.ts`), layout export (`gds.ts`, `def.ts`, `lef.ts`, `oasis.ts`), and descend-into-blocks. An FPGA fabric is, mechanically, a *fixed* place-and-route target for that spine. The open question was never "can we build a place-and-route engine" (we have one) — it was "**is any real FPGA's fabric documented well enough to model without faking anything**." This doc records the answer.

---

## 1. Fundamentals — how an FPGA works (stable since the late 1990s)

An FPGA is a mesh of **look-up tables (LUTs)** joined by **programmable routing**, all held in **configuration memory**. A LUT is a truth table stored in memory cells: a *k*-input LUT holds **2ᵏ configuration bits** and can implement any function of *k* inputs. A LUT + flip-flop + carry bit form a "logic cell."

The load-bearing equations a fabric model needs (all from the academic canon, all high-confidence):

| Quantity | Result | Why it matters |
|---|---|---|
| LUT config bits | **2ᵏ** per *k*-LUT | Area is **exponential in k** → the reason 4-LUTs were area-optimal historically and modern parts use **fracturable 6-LUTs** (6 is where delay wins stop paying for area) |
| Cluster input pins | **I = (k/2)(N+1)** for *N* LUTs (→ **2N+2** for 4-LUTs) | Inputs are *shared* across a cluster, so far fewer pins than the naïve *k·N* keep ~98% of LUTs usable |
| Optimal sizing | **k = 4–6, N = 4–10** LUTs/cluster | Best area-delay product for cluster-based island fabric |
| Routing model | 2D mesh, fixed **channel width W**, connection-block flex **F_c,in / F_c,out**, switch-block flex **F_s = 3** | The classic island-style interconnect (disjoint/Wilton switch blocks) |

**Configuration memory** is the big architectural fork:

| Technology | Volatile? | Reprogram | ChipBlocks-relevant notes |
|---|---|---|---|
| **SRAM** (iCE40, most FPGAs) | Yes — lost at power-off | Unlimited | **Must reload from SPI flash / on-chip NVCM at every power-up** — this is exactly the sequencing our catalog fixture already documents |
| **Flash** (Microchip PolarFire) | No | Yes | Instant-on, lower standby power |
| **Antifuse** (legacy Actel) | No | **One-time** | Rad-hard, tamper-resistant, not reprogrammable |

The canonical modeling reference is **Betz, Rose & Marquardt, _Architecture and CAD for Deep-Submicron FPGAs_ (1999)** — it covers exactly the elements a from-scratch tool needs (cluster logic blocks, global + detailed routing, packing/placement/routing CAD), and the live open **VTR / VPR** flow still cites and implements it.

---

## 2. Historical evolution — how the old ones worked

- **The first FPGA — Xilinx XC2064 (1985):** 64 logic blocks (CLBs), each just **two 3-input LUTs + one register** — ~64 logic cells, **under 1,000 gates**, on a **2.5-micron** process that barely yielded. (Some secondary sources say 2.0 µm; Trimberger's peer-reviewed history says 2.5 µm.)
- **Trimberger's "Three Ages of FPGAs"** (Proc. IEEE 2015), the canonical periodization: **Age of Invention (1984–1991)** → **Age of Expansion (1992–1999)** → **Age of Accumulation (2000–2007)**. Across the third age the fabric stopped being homogeneous LUTs and became heterogeneous **"Platform FPGAs"** — hardened block RAM, multipliers, then whole processors, built from custom transistors beside the LUT sea.
- Lineages: Xilinx **XC4000 → Virtex → 7-series/UltraScale → Versal**; Altera/Intel **FLEX → Stratix → Agilex**; Lattice **iCE40 → ECP5 → Nexus/CertusPro**; Microchip/Actel **antifuse ProASIC → flash SmartFusion/PolarFire**. Devices after ~2015 postdate Trimberger's framing and were characterized here from primary vendor manuals.

---

## 3. Modern advancements — what's genuinely new

The real advances are **hardened blocks beside the LUT fabric**, not the fabric itself (all documented in primary vendor manuals):

- **AMD Versal ACAP** (TSMC **7 nm** FinFET): three engine classes on one die — **Scalar** (Arm Cortex-A72 + Cortex-R5F), **Adaptable** (the LUT programmable logic), and **Intelligent**, whose **AI Engines** are up to **400 VLIW+SIMD vector tiles** at ~1–1.2 GHz — each issuing up to seven ops per VLIW word and doing **8 FP32 (or 128 INT8) MACs/cycle**, stitched by an AXI4-Stream/AXI4-MM tile interconnect with accumulator cascade streams, interfacing to the PL and the on-chip NoC. A real vector-processor array, distinct from the LUT fabric.
- **Intel/Altera Agilex 5**: a hardened **AI Tensor block** whose core op is a **10-element dot product** per column (9 adds + 10 mults + 1 accumulate = 40 INT8 ops/column), using **block floating point** (shared common exponent) — genuinely new arithmetic.
- Plus the incremental-but-important: UltraRAM, PAM4 100G+ SerDes, embedded hard ARM (Zynq / SoC FPGAs), HBM in-package, chiplet / 2.5D packaging.

For ChipBlocks these hard blocks are model-able as *architecture* from vendor manuals, but **not** as a bitstream — see §4.

---

## 4. What is documented enough for us — the verdict

The crux. The open-source FPGA bitstream-documentation ecosystem has publicly reverse-engineered or documented a handful of real fabrics. Ranked by how realistically a from-scratch tool could model them:

### ① Lattice iCE40 — fully model-able, and we already ship it ✅
**Project IceStorm** openly reverse-engineered the entire fabric: tile grid, LUT/DFF/carry cells, and routing. The exact part we ship — the **iCE40UP5K** — has a documented **104,161-byte / 833,288-bit** bitstream image (shared die with the UP3K, so identical). The per-tile bit layout is published (clifford.at/icestorm). The reference toolchain — **Yosys** (synthesis), **nextpnr** (place-and-route), **IceStorm/icepack** (bitstream) — is **permissively licensed (ISC/MIT)**, so it fits our MIT / permissive-only rule (can bundle or reimplement from the open docs).

> **iCE40 tile/bitstream granularity — documented in [§4a](#4a) below.** The exact tile-grid geometry, per-tile config-bit matrix (54×16 = 864-bit logic tile, 16 LUT-init bits/cell, DFF/carry/routing-mux bits), and the concrete data a ChipBlocks fabric model would ingest are worked out there.

### ② Academic foundation — textbook-solid
**Betz/Rose/Marquardt (1999)** + the live **VTR / VPR** open flow give closed-form models and working place-and-route for exactly this island-style fabric. This is the blueprint independent of any vendor.

### ③ Backup open targets — real, ranked in §4b
**Project Trellis (Lattice ECP5)** and **Project X-Ray / prjxray (AMD/Xilinx 7-series)** are the natural #2 and #3 open targets, both driven by nextpnr / F4PGA — assessed and ranked in [§4b](#4b) below (short version: ECP5 is the natural step-up, both permissive-licensed; Xilinx-7 is the most capable but least mature).

### ④ Fully-open academic fabrics — the "no reverse-engineering" option
**OpenFPGA** and **FABulous** *generate* open eFPGA fabrics from scratch (Verilog + a PDK). These are the purest "everything real, nothing proprietary" targets — a fabric we would fully define — if we ever prefer defining a fabric over reverse-engineering a commercial part.

### ✗ Everything else — proprietary
UltraScale+ / Versal / Agilex / PolarFire fabric internals are **not publicly documented**. We can model their hard-block *architecture* from vendor manuals, but **cannot place-and-route or emit/parse a real bitstream**. The iCE40 is the one commercial part where the whole thing is honest — and it is the one we ship.

<a name="4a"></a>
### §4a — iCE40 tile / bitstream granularity

All numbers here are from the primary IceStorm docs (clifford.at/icestorm, prjicestorm.readthedocs.io), the `icebox`/`nextpnr-ice40` source, and were adversarially cross-checked (pass 2). The headline: the iCE40's fabric is **documented at exactly the granularity a from-scratch model needs**, in a machine-readable form, with only small opaque remainders.

**The bitstream is a grid of typed tiles, each a fixed bit-matrix.** The configuration block is **16 rows tall (B0–B15) for every tile type**; the width is the tile type's CRAM width:

| Tile type | Bit-matrix | Config-bit positions |
|---|---|---|
| **LOGIC** | 54 cols × 16 rows | **864** |
| **IO** | 18 × 16 | 288 |
| **RAM** (RAMB/RAMT) | 42 × 16 | 672 |

**The LOGIC tile is fully decoded.** Its 864 positions are function-typed in the published bit map — **16 LUT-init bits per logic cell** (the truth table), plus per-cell carry (`CarryInSet`/`cO`), DFF config (`NegClk`/`CEN`/`SR`/`AsyncSR`), and 4 cell-config bits; **8 logic cells per tile → 5280 LUTs total** (⇒ ~660 logic tiles on the UP5K). Bits whose function is still unknown are explicitly marked `?` — the opaque remainder is small and *labelled*, not hidden.

**Routing is human-readable, not opaque bits.** Muxes are encoded in the same tile matrix but exposed as `.buffer` / `.routing` statements naming source→destination wires — span-4 (`sp4_*`), span-12 (`sp12_*`), local tracks (`local_g*`), neighbourhood (`neigh_op_*`), and global/clock nets. The connectivity is the **largest** data component a model ingests.

**The whole fabric is one machine-readable database (the icebox chipdb `.txt`).** It declares everything a place-and-route + emitter needs: `.device NAME WIDTH HEIGHT NUM_NETS` (grid = `max_x+1 × max_y+1`), per-tile `.logic_tile X Y` / `.io_tile` / `.ramb_tile` / `.ramt_tile` / `.dsp0..3_tile` / `.ipcon_tile`, per-type `.<tile>_bits COLS ROWS`, `.net X Y wirename` (wire index table), `.buffer`/`.routing` (switches), plus `.ieren`, `.pins`, `.extra_cell` (IO-enable mapping, package pins, and special cells **PLL / MAC16 (DSP) / SPRAM / WARMBOOT**). `nextpnr-ice40` compiles this into a **binary chipdb** it loads at startup (bels/wires/pips per tile + packed connectivity); `icepack`/`iceunpack` round-trip `.bin`↔`.asc`, `icebram` swaps block-RAM contents, `icetime` does timing.

**UltraPlus (our UP5K) specifics.** The UP5K is an **UltraPlus** part, which IceStorm officially supports including its extras — **DSP (MAC16) tiles, IPConnect tiles (which replace IO on the left/right edges), internal oscillators, SPRAM, the RGB-LED driver, and hard IP** — all separately documented, not left opaque. **Honest caveat (the reason the pass-2 synthesis flagged two overclaims):** IceStorm reserves its explicit *"completely documented / bit-exact verified"* confidence for the older **1K/8K** parts; UltraPlus is framed as *"also supported,"* and the special blocks are less exhaustively documented than the core LUT/routing fabric. A research paper ("Stealing Maggie's Secrets", arXiv 2312.06195) found ~36 nets with missing source/destination in one device — so a handful of DB gaps exist. Net: **the core LUT + routing fabric is fully model-able; a bit-exact, hardware-loadable UP5K image would need the last few opaque/special-block bits nailed down first.**

**→ Data a ChipBlocks iCE40 fabric model would ingest, and roughly how much:** one device's **icebox chipdb** — the tile grid, the ~660 logic + IO + RAM + DSP/IPCON tile bit-matrices, the wire/net table, and the `.buffer`/`.routing` switch list. It's on the order of a **few MB of text per device** (the routing/connectivity dominates), already machine-readable, permissively licensed (ISC/MIT). Levels 1–2 of §5 (simulate + map onto fabric) need essentially all of it *except* bit-exact CRAM placement; Level 3 (emit/parse a real `.bin`) additionally needs every `?`/special-block bit resolved.

<a name="4b"></a>
### §4b — Backup targets: Trellis (ECP5) & prjxray (Xilinx-7)

| | **iCE40** (IceStorm) | **ECP5** (Trellis) | **Xilinx-7** (prjxray) |
|---|---|---|---|
| **Docs completeness** | Highest — core fabric fully decoded, small labelled `?` remainder | High — bit + routing docs for "almost all functionality"; **obscure DSP modes** the main gap; a few unknown tiles (`CIBTEST`, `MIB` prefix, CIB mapping) | Partial — **strong for small Artix (xc7a50t)**; 7-series/UltraScale/+ a stated *long-term* goal, incomplete beyond small parts |
| **Fabric complexity** | Smallest (LUT4 + simple routing + a little BRAM/DSP) | Medium — LUT4 slices + carry, distributed + block RAM, multipliers, PLLs, **SERDES (DCUs)** | Largest — 6-LUTs, DSP48, complex clocking, multi-die |
| **Device coverage** | UP5K + HX/LP1K–8K (LM/Ultra/UltraLite **not** supported) | **Full ECP5 range, 10 parts** incl. 5G SERDES (LFE5U/UM/UM5G-12/25/45/85F) | artix7 / kintex7 / zynq7 / spartan7 dirs; **only small parts route end-to-end** in practice |
| **Toolchain maturity** | Production (nextpnr-ice40, in F4PGA) — the SymbiFlow lead calls iCE40 *"fully done"* | Production (nextpnr-ecp5) | Least mature (nextpnr-xilinx = gatecat + openXC7 fork) |
| **License** | ISC / MIT ✓ | **ISC** ✓ | **Apache-2.0** ✓ |
| **Data shape** | icebox chipdb `.txt` (grid, tile bits, nets, buffer/routing) | prjtrellis-db (icebox-analog: tilegrid + tiles + bit db) | prjxray-db per-part (`tilegrid.json`, `segbits_*.db`, `tileconn.json`, ppips/mask) — `segbits` maps a feature → its exact bits |

**Ranked verdict for a from-scratch modeler:**
1. **iCE40 — clear first choice.** Smallest fabric, most complete + mature docs, permissive, and *it's the part we already ship*. Only real work: the last opaque/special-block bits if we ever want a bit-exact loadable image.
2. **ECP5 (Trellis) — the natural step-up.** Same permissive posture and a production nextpnr, with real SERDES/DSP/PLL if we outgrow the iCE40 — at the cost of a bigger fabric and a few documented-but-opaque corners.
3. **Xilinx-7 (prjxray) — most capable, least ready.** Granular `segbits` data and Apache-2.0, but the toolchain is the least mature and only small Artix parts route end-to-end; the hardest from-scratch target, worth watching but not a starting point.

---

## 5. ChipBlocks feasibility — can we simulate what's inside an FPGA?

Yes, for the iCE40 specifically. "Simulate what's inside an FPGA" is really **three capabilities**, easiest → hardest:

**Level 1 — simulate the configured logic (≈ done today).** A configured FPGA behaves, at the logic level, identically to the design loaded into it. We already synthesize a design to gates and run it in `logic-sim.ts`. Caveat: this shows *your gates*, not the FPGA's LUTs.

**Level 2 — simulate the design *mapped onto the real iCE40 fabric* (the "descend into the FPGA" feature).** Model the fabric from IceStorm's data, then pack/place/route the netlist onto real **LUT4 + DFF + carry** cells and tiles; descend to watch it run. Upgrades the part from black box (`defined_not_solved`) to a real, descendable device. *Timing needs a separate ingest:* the §4a chipdb carries topology, not delays — real numbers live in the `icetime` delay database, so until that is ingested the routed graph is reported **topology-only, timing not modeled** (never invented delays).

**Level 3 — the actual bitstream, both directions.**
- **Bitstream → simulation (the "update with the bitstream you load" direction):** parse an existing `.bin` (documented format) to recover which LUTs hold which truth tables + how routing is set, rebuild the netlist, simulate — reporting any undecodable `?`/opaque bits rather than silently dropping them. Depends only on the fabric model, not the design→LUT mapper, so it ships the "watch it run" payoff early.
- **Design → bit-exact hardware image:** the hardest, most data-gated direction, and — like the manufacturing ZIP — one where a *guessed* bit is a faked pass. Prefer proving it on the fully-documented HX1K/HX8K first, and/or wrapping the reference `icepack`/`nextpnr` (ISC/MIT) so the reference tool owns the exact bytes; a from-scratch emitter that defaults unknown UP5K bits must never be labelled a real loadable image.

**Honest caveats:** this is a **chapter-sized** effort (comparable to the Verilog bridge or the chip-physical chapter), **iCE40-only** (other families are proprietary), and Level 2 delivers the "see inside the FPGA" payoff at far lower cost than the bit-exact emit.

### Suggested staging (revised after the 2026-07-24 red-team of the original 3-stage plan — see Verification log)

The `generic → real fabric → bitstream` order is sound and each stage stands alone, but a 3-way adversarial review found the original wording under-scoped the front and over-fused the back. The corrected staging:

1. **Generic LUT fabric — a from-scratch *mini-VPR*, not a reuse.** This is where the two hardest new engines live: a **gates→*k*-LUT technology-mapper + packer** (we synthesize to *gates*, not LUTs — this covering step is new), and an **FPGA router over a routing-resource graph** (PathFinder-style negotiated congestion over pre-existing pips — a *different* algorithm from our standard-cell copper router; only `logic-sim` and general graph tooling actually transfer). Build the fabric as an explicit **wire/pip routing-resource graph** shaped to §4a's chipdb schema so Stage 2 is a data-load, not a rewrite. Label it a generic fabric, never a real device.
2. **Real iCE40 core (Stage 2a).** Data-load §4a's chipdb into the Stage-1 structures: **LOGIC** (864-bit tile, 16 LUT-init/cell, 8 cells/tile, ~660 tiles = 5280 LUTs) **+ IO + routing + basic BRAM**. Descend shows real tiles. Honest scope = LUT4 + DFF + carry (+ BRAM) designs; exclude the ~36 missing-src/dst nets and opaque tiles from the routing graph and report them unmodeled. This is *"the LUT+routing core of the UP5K,"* not yet the whole part.
3. **UltraPlus specials (Stage 2b).** MAC16 DSP, SPRAM, PLL, oscillators, RGB driver, **IPConnect edge tiles** (they *replace* IO on the left/right edges, so even correct edge-IO placement needs this), WARMBOOT. Model what's documented, report the rest unmodeled. Only after 2b can it claim *"the actual UP5K."*
4. **Bitstream parse (Stage 3a) — the headline payoff.** "Load a `.bin` and watch it run." Depends on Stage 2 only (**not** the Stage-1 mapper), so it's ~Stage-2 difficulty; decode documented LUT-init + `.buffer`/`.routing` bits, rebuild the netlist, simulate, and *count/report* undecodable bits.
5. **Bitstream emit (Stage 3b) — hardest, optional, data-gated.** Design → bit-exact image. Precondition: resolve every `?`/special-block bit (which the open ecosystem itself hasn't fully done for UltraPlus) — or wrap `icepack`/`nextpnr` and prove first on HX1K/HX8K. Treat the image like the manufacturing ZIP: engine-owned, bit-exact, never guessed.

---

## Sources (first pass, 2026-07-24 — 26 fetched, 25/25 claims verified, 0 refuted)

**Academic / architecture**
- Kuon, Tessier & Rose, _FPGA Architecture: Survey and Challenges_ (Found. & Trends 2008) — eecg.toronto.edu/~jayar/pubs/kuon/foundtrend08.pdf
- Ahmed & Rose, _The Effect of LUT and Cluster Size…_ (FPGA'00) — eecg.toronto.edu/~jayar/pubs/ahmed/fpga00.pdf
- Betz, Rose & Marquardt, _Architecture and CAD for Deep-Submicron FPGAs_ (1999) — link.springer.com/book/10.1007/978-1-4615-5145-4
- Trimberger, _Three Ages of FPGAs_ (Proc. IEEE 2015) — researchgate.net (…Three_Ages_of_FPGAs…)
- VTR / Verilog-to-Routing docs — docs.verilogtorouting.org/en/v9.0.0/zreferences/

**Vendor primary**
- AMD Versal AI Engine (AM009) — docs.amd.com/r/en-US/am009-versal-ai-engine
- AMD Versal DSP Engine (AM004) — docs.amd.com/r/en-US/am004-versal-dsp-engine
- Intel Agilex 5 Enhanced DSP / AI Tensor block brief (776602) — cdrdv2-public.intel.com/776602/…
- Lattice iCE40 Programming & Configuration (FPGA-TN-02001) — latticesemi.com/…/FPGA-TN-02001-…
- AMD logic-cell formula (support) — adaptivesupport.amd.com/s/question/…/logic-cell-formula

**Open-source toolchain / bitstream**
- Project IceStorm — clifford.at/icestorm/ , prjicestorm.readthedocs.io/en/latest/format.html , .../logic_tile.html , github.com/YosysHQ/icestorm
- nextpnr — github.com/YosysHQ/nextpnr
- Project Trellis (ECP5) — prjtrellis.readthedocs.io/
- Project X-Ray / prjxray (Xilinx-7) — github.com/f4pga/prjxray
- OpenFPGA — openfpga.readthedocs.io/
- FABulous — github.com/FPGA-Research-Manchester/FABulous
- Agilex D-series whitepaper (744047), eejournal "Inside Intel Agilex", arxiv 2301.13016, edn space-grade FPGA comparison, embedded.com FPGA configuration primer

**Pass 2 — granularity + backup targets (2026-07-24)**
- IceStorm bitstream format + logic tile — prjicestorm.readthedocs.io/en/latest/format.html , clifford.at/icestorm/format.html , clifford.at/icestorm/logic_tile.html , prjicestorm.readthedocs.io/…/ultraplus.html , the auto-generated Bit Docs (`_static/bitdocs-8k/`)
- icebox / nextpnr internals — github.com/YosysHQ/icestorm/blob/master/icebox/icebox_chipdb.py , github.com/YosysHQ/nextpnr/blob/master/ice40/chipdb.py , icestorm wiki "Adding support for new devices"
- Project Trellis (ECP5) — github.com/YosysHQ/prjtrellis , prjtrellis.readthedocs.io/…/architecture/tiles.html , github.com/SymbiFlow/prjtrellis-db , yosyshq.net/prjtrellis-db/ , FOSDEM'19 "Trellis and nextpnr" slides
- prjxray (Xilinx-7) — github.com/f4pga/prjxray-db , f4pga.readthedocs.io/projects/prjxray/…/introduction.html , …/dev_database/common/segbits.html , nextpnr-xilinx (gatecat/openXC7)
- iCE40 DB-gap corroboration — arXiv 2312.06195 "Stealing Maggie's Secrets"; SymbiFlow-lead open-FPGA-landscape survey (iCE40 vs ECP5 vs Xilinx-7 maturity)

---

## Verification log

- **2026-07-24 — pass 1 (high-level, run `w62cdcxjz`).** 109 agents, 6 search angles, 26 sources fetched, 106 claims extracted → **25 adversarially verified (3-vote), 0 refuted**, 14 synthesized findings, all high-confidence. Covered §1–§4. Scope gaps flagged: Trellis/prjxray/FABulous/OpenFPGA + the antifuse/flash families were not verified claim-by-claim; the per-tile iCE40 bit map was corroborated but not itemized → motivated pass 2.
- **2026-07-24 — pass 3 (staging red-team, run `wh8iski9p`).** 3 parallel adversarial critics (ordering/dependencies, scope/feasibility, everything-real honesty) attacked the original 3-stage §5 plan against this doc. Unanimous verdict: **ordering fundamentally correct, but `yes-with-refinements`.** Key corrections folded into §5: (1) Stage 1 is a from-scratch mini-VPR — the FPGA router + gates→LUT mapper are *new engines*, not a reuse of our standard-cell PnR (the "reuses synth + logic-sim + PnR" wording was over-optimistic); (2) build Stage 1 on an explicit routing-resource-graph so Stage 2 is a data-load; (3) Level-2 timing needs the `icetime` delay DB or must report "not modeled"; (4) split Stage 2 into documented core (2a) vs UltraPlus specials (2b); (5) split Stage 3 into parse (3a, cheap, ships the payoff, mapper-independent) vs bit-exact emit (3b, data-gated — prove on HX1K/8K and/or wrap icepack, treat like the manufacturing ZIP).
- **2026-07-24 — pass 2 (focused follow-up, run `wxb7gu093`).** 103 agents, 5 search angles, ~30 primary sources fetched (IceStorm/icebox/nextpnr, prjtrellis + prjtrellis-db, prjxray + prjxray-db + F4PGA, the FOSDEM'19 Trellis talk, the arXiv "Stealing Maggie's Secrets" iCE40 paper). Populated §4a (iCE40 granularity) + §4b (backup verdict). **Note:** the workflow's final *synthesis* agent failed (returned a placeholder "Test." with one trivial finding and wrongly refuted two "completely documented" overclaims); §4a/§4b were written from the **per-agent journal** (`…/wf_c77013d5-8cd/journal.jsonl`), where the individual searcher/verifier agents' primary-source findings were intact and self-consistent (e.g. the 54×16=864-bit logic tile was verbatim-confirmed on two independent primary sources). The two "refuted" claims were overclaims of *completeness* ("100% bit-exact for UP5K"), correctly down-weighted — captured here as the honest opaque-bits caveat, not as a contradiction of the fabric being documented.

---

## What this doc does NOT do

- It does **not** commit ChipBlocks to building an FPGA-fabric simulator — that's a chapter-sized decision for the project lead (§5).
- It does **not** cover analog/mixed-signal FPGA behaviour or PLL/transceiver electrical modeling.
- It does **not** replace the catalog fixture's cited electrical data for the iCE40UP5K — that remains the authority for the part at its terminals.

---

# Appendix A — Stage 1 (mini-VPR): design & increment plan

> Produced 2026-07-24 by an 11-agent design workflow (run `winduj35b`: 4 readers over the real modules, 6 component designers, 1 synthesizer), grounded in the actual `verilog-synth.ts` / `logic-sim.ts` / `cell-place.ts` code. Scopes **Stage 1 only** (the abstract-fabric mini-VPR; no vendor data). Code-grounded confirmation of the red-team point: `placeCells` is net-blind row-packing and our routers emit free-space geometry, so the LUT technology-mapper and the PathFinder router have no precursor.

## Stage 1 — design & increment plan

## Plain-English summary

Stage 1 builds a small, from-scratch FPGA CAD flow: take a digital design that ChipBlocks already synthesizes into logic gates, fold those gates into look-up tables (LUTs), arrange them on an abstract chip grid, wire them together over a fixed routing fabric, and then prove — by simulation — that the fabric computes the exact same thing the original gates did. The important honest finding is that **this is not "reusing the place-and-route we already have."** Two of the hardest engines in the whole chapter are secretly born here and exist nowhere in the codebase: a **gates→LUT technology mapper** and a **PathFinder-style FPGA router** over a routing-resource graph — a genuinely different algorithm class from our copper PCB/standard-cell routers. What *does* transfer is real and load-bearing: the gate netlist front-end (`flattenBlocks`), the fast 0/1 logic engine (`logic-sim.ts`), union-find net resolution, and the save/undo persistence pattern. We keep the fabric's data model shaped as a **generic superset of Project IceStorm's chipdb** so that Stage 2 (real iCE40 data) becomes a data-load, not a rewrite.

---

## 1. Reuse map — what transfers vs. what is genuinely new

| Concern | TRANSFERS (real module/type) | GENUINELY NEW | Verdict |
|---|---|---|---|
| **Netlist input** | `importVerilog()` → `ImportResult.block: BlockData`; `flattenBlocks(nodes, edges, isLogicGate)`; `GateInst`, `FlopInst` (`verilog-import.ts`) | — | Full reuse. The gate netlist is the *input*, already bit-blasted to scalar nets. |
| **Net resolution** | `buildNets` / `endpointKey` (`output-contention.ts`); `DisjointSet` (`lvs.ts`) | — | Full reuse (this becomes union-find's **3rd** consumer → trigger to extract a shared util). |
| **Logic simulation** | `stepLogic` / `compileLogic` / `CompiledLogic` / `characterizeBlock` (`logic-sim.ts`); the closed-switch conduction rule; `D_FLIPFLOP_BLOCK` | One small edit: a **per-instance LUT gate branch** whose `fn` closes over `2^k` config bits (`config[Σ inᵢ<<i]`) | Mostly reuse; one documented small engine edit. |
| **Gates → k-LUT mapping** | *(nothing)* | **Cut enumeration + priority-cut covering + truth-table synthesis** | **NEW ENGINE #1.** No cut/cover concept anywhere. |
| **Packing LUT+FF → clusters** | `FlopInst`, `D_FLIPFLOP_BLOCK` as the FF atom | **BLE formation + AAPack-style seed-and-attract clustering** under `I=⌈(k/2)(N+1)⌉` | NEW. No cluster/CLB model exists. |
| **Placement** | *Data-shape only:* `PlacedCell`/`Floorplan` discipline; `chipSignature` (FNV) | **Island grid + HPWL cost + VPR simulated annealing** | NEW. `placeCells` is net-blind row-packing — wrong algorithm class, cannot be "made FPGA-aware." |
| **Routing** | *A\* skeleton only* (open set + `gScore` + `cameFrom`) from `gridRouteAround` (`orthogonal-route.ts`), **re-pointed at the RRG** | **RRG data model + PathFinder negotiated congestion** (present + historical cost, rip-up-reroute, legality, Wmin) | **NEW ENGINE #2.** Our copper router is one-shot greedy free-space maze routing — opposite problem. |
| **Fabric data model (RRG + tile grid)** | `BlockData`/`BlockInnerNode` as the *authoring/descend container*; `BlockViewer` recursive drill | **`Rrg` (wires=nodes, pips=edges), typed-tile grid, island-fabric generator** — chipdb-superset | NEW. `BlockInnerEdge` is a point-to-point net, **cannot** express a routing resource; RRG lives *beside* BlockData. |
| **Equivalence check** | `characterizeBlock` + `simulateLogic` as the golden oracle; `weisfeilerLehmanMatch`/`findBijection` (`lvs.ts`) for structural check | **Miter-style co-sim harness + I/O correspondence map + mismatch localization** | Mostly reuse of oracles; the harness + port alignment are new. |
| **Persistence / undo / drift** | `ChipLayout`/`ChipCellOverride`/`sanitizeChipLayout`/`chipSignature` (`chip-layout.ts`) | A `FabricLayout` clone keyed by **stable grid-slot id** (not flatten-order cell id) | Near-clone reuse. |

**Settling the "not a reuse" point:** only *logic-sim* (LUT eval = one array lookup) and *generic graph tooling* (union-find, A\* skeleton, WL isomorphism) actually transfer. The two algorithm classes that define FPGA CAD — **technology mapping (cut covering)** and **negotiated-congestion routing over a fixed RRG** — have zero precursor. Our standard-cell placer (`cell-place.ts`) is net-blind; our routers (`pcb-route.ts`, `cell-polygons.ts`) generate free-space geometry rather than selecting pre-existing pips. Different inputs, different outputs, different core loops.

---

## 2. Architecture

### Data flow

```
Verilog ──importVerilog──► BlockData (gate netlist, already bit-blasted)
   │
   │ flattenBlocks(., ., isLogicGate) + buildNets   [REUSE]
   ▼
Boolean network (2-input gate cells + D-flops, PI/PO at ports & flop D/Q, power rails stripped)
   │
   ├─(1) TECH-MAP  ──►  LutNetlist { luts:KLut[], dffs:KDff[] }        [NEW ENGINE #1]
   │        cut enumeration → priority-cut covering → 2^k truth-table synth
   ▼
   ├─(2) PACK     ──►  PackResult { clusters:Cluster[] }               [NEW]
   │        BLE formation (LUT+FF) → seed-and-attract, legality I=⌈(k/2)(N+1)⌉
   ▼
   ├─(3) PLACE    ──►  Placement { slots:Map<clusterId,Slot> }         [NEW]
   │        island grid + HPWL cost → greedy hill-climb → VPR annealing
   ▼
   ├─(4) ROUTE    ──►  RouteResult { pipOn, routes, unrouted }         [NEW ENGINE #2]
   │        PathFinder negotiated congestion over the fixed RRG
   ▼
   └─(5) SIM+EQUIV ──► EquivResult { equivalent, mismatches }          [REUSE oracles]
            ON pip ⇒ union(src,dst)  →  compileLutFabric → stepLogic
            co-simulate vs golden gate netlist (characterizeBlock)
```

Steps (1)–(4) each read from and write to the **shared fabric data model**; step (5) binds the routed fabric to the existing logic engine and is the acceptance gate.

### Shared fabric data model (RRG + tile grid)

Two structures held **side by side**, never merged (the RRG is not a `BlockData.edges` list):

- **Tile grid** — `FabricDevice { width, height, arch, tiles: FabricTile[] }`, `FabricTile { x, y, kind:'logic'|'io'|'ram'|'dsp'|'empty', logic?:{ luts:LutBel[], ffs:FfBel[] } }`. Architecture knobs live in `FabricArch { k, n, clusterInputs, channelWidth W, fcIn, fcOut, fs, spanLengths }` — cited from research §1 (k=4–6, N=4–10, `I=⌈(k/2)(N+1)⌉`, `Fs=3`, island/Wilton switch blocks).
- **Routing-resource graph** — `Rrg { nodes:Map<id,WireNode>, edgesFrom, edgesTo }` with `WireNode { id, kind:'chanx'|'chany'|'opin'|'ipin'|'source'|'sink'|'local'|'span'|'global', x, y, span?, dir?, track? }` and `Pip { id, from, to, kind:'buffer'|'routing', configBits?:null }`. Mutable congestion state (`occ`/`cap`/`hist`/`pcost`) is kept **separate** from the immutable graph (mirrors `orthogonal-route.ts` purity discipline).

### The design choice that makes Stage 2 a data-load, not a rewrite

The RRG schema is deliberately a **generic superset of IceStorm's chipdb** (research §4a): wires-as-nodes / pips-as-edges, `.buffer` (directional) vs `.routing` (bidirectional) pip kinds, span-length tracks (`local`/`sp4`/`sp12` analogs), `Fc`/`Fs` connectivity. `Pip.configBits` is `null` in Stage 1 and is the **Stage-2 hook** for real CRAM bit coordinates. We validate this by shipping a `serializeChipdb`/`parseChipdb` round-trip that ingests a hand-written IceStorm-shaped `.device`/`.net`/`.buffer`/`.routing` snippet into the *same* Stage-1 types. Stage 2 (real iCE40) then just loads §4a's chipdb into these structures; Stage 3 (bitstream) fills `configBits`.

---

## 3. Increment sequence (cheapest proof-of-life first)

Each increment is independently verifiable; each has a one-line definition-of-done (DoD). Order deliberately front-loads the map+sim spine so the two hard engines land on top of a proven substrate.

**A. Substrate & sim spine (map → direct sim, before place/route)**

1. **Shared atom types.** `LutAtom`/`FfAtom`/`Atom`/`KLut`/`KDff`/`LutNetlist` in one module both mapper and packer import. *DoD: types compile; a hand-built `LutNetlist` fixture instantiates.*
2. **LUT-eval engine branch.** Add the per-instance LUT gate to `compileLogic`/`stepLogic` (`fn = config[Σ inᵢ<<i]`); teach `blockIsLogicCompatible`/`LOGIC_PASSIVE_DEFS` the `fpga_lut` element so it isn't silently dropped. *DoD: a single hand-configured 4-LUT returns its truth table over all 2⁴ inputs via `stepLogic`.*
3. **Trivial tech-map + equivalence gate.** Map each 2-input/1-input gate cell to its own LUT (synthesize `config[]` from that cell's `LogicSpec.fn`), pass `FlopInst` through as `KDff`, strip power rails. *DoD: for a synthesized full-adder/XOR-chain, `characterizeBlock(original)` === truth table of the emitted `LutNetlist` (the mandatory sim-equivalence oracle) — proving data model, net-id convention, DFF pass-through **before** any optimizer.*
4. **RRG types + island-fabric generator.** `generateFabric(arch)` builds a small W×H grid + synthesized RRG (channels of width W, `Fc` connection blocks, `Fs=3` switch blocks). *DoD: RRG integrity holds (every node reachable, fanout/fanin consistent, no dangling pip endpoints) on a 3×3, K=4, N=1, W=4 fabric.*
5. **chipdb-superset round-trip.** `serializeChipdb`/`parseChipdb`. *DoD: (a) generated fabric survives serialize→parse identical; (b) a hand-written IceStorm-shaped `.net`/`.buffer`/`.routing` snippet parses into the same types — schema proven a valid superset.*
6. **ON-pip → union sim bridge.** Adapter turning chosen pips into `union(src,dst)` seeds for `compileLogic`. *DoD: a hand-configured LUT + hand-chosen ON-pip set drives a load high through `stepLogic` — the router→sim seam works independent of any real router.*

**B. The tech-mapper optimizer (New Engine #1)**

7. **Cut enumeration.** Topological k-feasible priority cuts (cap C≈8/node, dominance prune). *DoD: cut sets match hand-computed cuts on a small DAG; no blow-up on a reconvergent fanout case.*
8. **Priority-cut covering + area-flow.** DAG covering (fanout-escaping node ⇒ own LUT root) + area-flow recovery pass. *DoD: LUT count drops vs. trivial cover on the full-adder, and the increment-3 equivalence oracle still passes.*

**C. Packing (New)**

9. **BLE formation.** Fuse LUT+FF when `FF.d === lut.output`. *DoD: `LUT.output===FF.d` ⇒ exactly one BLE, external inputs = LUT inputs, output = FF.q.*
10. **Seed-and-attract clustering.** Legality: `bles ≤ N`, distinct external inputs `≤ I`, single clock domain. *DoD: materialize clusters → `flattenBlocks` → `simulateLogic` equals the pre-pack truth table; `I`/`N` bounds asserted.*

**D. Placement (New)**

11. **HPWL cost + greedy hill-climb.** Net→block adjacency, `Σ q(n)·HPWL`, deterministic seeded swap-if-improves. *DoD: on a hand-computable 3×3 case, cost = analytic HPWL, every accepted swap matches a full recompute (catches stale-bbox bug), final beats random seed.*
12. **VPR simulated annealing.** Adaptive temperature + range-limit window (~0.44 acceptance). *DoD: seeded RNG, HPWL improves over the greedy result within asserted bounds; periodic full-recompute equals incremental running cost.*

**E. Routing (New Engine #2)**

13. **Single-net maze over RRG.** A\* skeleton re-pointed at `rrg.edgesFrom`, cost = pip base cost. *DoD: a 2-sink net on a hand-built 2×2 fabric returns a connected source→both-sinks RRG tree; lowered pips make `stepLogic` read both loads high.*
14. **PathFinder negotiated congestion.** Present cost `pn=(1+max(0,occ+1−cap)·pfac)`, historical `hn`, rip-up-reroute loop, converge when no node overused; report `unrouted` honestly (never fake a route). *DoD: a congested design routes legally at sufficient W; an under-provisioned W reports unrouted nets instead of looping; optional Wmin binary search reported.*

**F. Acceptance**

15. **End-to-end co-sim.** Full map→pack→place→route→sim on a real synthesized design; I/O correspondence map aligns original ports to fabric IO pins. *DoD: the Stage-1 acceptance test below passes.*

---

## 4. Stage-1 milestone / definition of done

**A mapped + placed + routed abstract LUT fabric co-simulates identically to the input gate netlist.**

Concretely: take a synthesized design ChipBlocks already produces (e.g. a full-adder, an XOR chain, and one small sequential design such as a counter or the SAP-1 register), run the complete flow, and assert:

- **Combinational designs:** exhaustive `2ⁿ` compare (n ≲ 18; else reported as *sampled*, not proven) between `characterizeBlock(originalBlock)` and the fabric's `compileLutFabric + stepLogic` output — `EquivResult.equivalent === true`, `method: 'exhaustive'`.
- **Sequential designs:** bounded co-simulation over a shared directed+random vector sequence for N clocks (matched reset), comparing outputs and every flop Q each cycle — reported honestly as *bounded*, not a proof.
- **Routing honesty:** any unrouted net leaves its LUT input undriven → LUT skipped → `undefined` output, which the equivalence engine treats as a **mismatch** (never coerced to 0).
- **Substrate honesty:** the RRG round-trips through the chipdb-superset serializer and ingests an IceStorm-shaped snippet unchanged.

Passing gates: `npx tsc --noEmit`, `npx biome check`, `npx vitest run`, `npm run build`.

---

## 5. Top risks & open questions for the project lead

**Risks**

- **Two brand-new algorithm engines, not one.** The cut-covering tech-mapper and the PathFinder router are the real cost of Stage 1; the earlier "it's mostly place-and-route reuse" framing was wrong. Cut enumeration is worst-case exponential (mitigated by capping priority cuts ≈8/node) and PathFinder can fail to converge (mitigated by hard iteration cap + honest unrouted reporting).
- **Silent-wrong-logic traps.** Union-find nets are *undirected* with no driver-vs-sink notion — two LUT outputs routed onto one wire merge silently; the router's `occ ≤ cap` legality check is the only guard, so it must be airtight and separately tested. Wrong input-bit→config-index mapping yields a plausible-but-wrong LUT — the sim-equivalence oracle must be **mandatory** on every mapper increment.
- **I/O correspondence is subtle.** Flattened nets are dot-namespaced and bit-blasted; constants are `XOR(x,x)` cells, not literals. The port alignment must be built from `portTarget` + declared port order, never name-matching, or equivalence compares the wrong nets (false pass/fail).
- **Schema lock-in.** If the Stage-1 RRG isn't a genuine chipdb superset (missing span-4/span-12 tracks, buffered-vs-pass pips, local-vs-global), Stage 2 becomes a rewrite — defeating the staging rationale. Validated by the IceStorm-snippet round-trip in increment 5.
- **Third union-find copy.** `DisjointSet` already exists in `lvs.ts` and `cell-polygons.ts`; Stage 1 is the third use — the codebase's own "three uses" rule says extract a shared graph util now.

**Open questions**

1. **k and N defaults?** Recommend **k=4, N=8** for Stage 1 (matches iCE40 LUT4, keeps `config[]` = 16 bits, cut enumeration cheap; k is a parameter so k=6 is a later config change). Confirm.
2. **Scope of the sequential acceptance case** — is a small counter/register sufficient, or should the SAP-1 CPU be a Stage-1 target? (SAP-1 stresses cut blow-up and router convergence — recommend deferring it to a follow-up.)
3. **Quality bar.** Stage 1 targets *correctness* (co-sim equivalence), not routed-wirelength or timing quality. Timing-driven placement/routing and a Wmin quality metric are explicitly out of scope — confirm that's acceptable.
4. **Where does the fabric live in the UI?** As a new `BlockData`-backed descendable level (tile-as-leaf to stay under `MAX_DESCEND_NODES=400`) with its own saved/undoable `FabricLayout`? Confirm parity expectations with board/chip levels.

---

## 6. Rough size

| Component | Size | Note |
|---|---|---|
| Shared atom types + LUT-eval engine branch | **S** | One small documented `compileLogic` edit + type module. |
| Tech-mapper (cuts + covering + truth-table synth) | **M** | Trivial-cover milestone is S; grows to L only if depth-optimal FlowMap is pursued over the priority-cut heuristic. |
| Packer (BLE + seed-and-attract) | **M** | Two greedy passes; sized up by input-pin absorption + clock-domain edge cases. |
| Fabric model (RRG + tile grid + generator + chipdb round-trip) | **M** | New substrate; excludes the two hard engines by design. |
| Placer (HPWL + hill-climb + SA) | **M** | Greedy starter is S; full VPR annealing schedule pushes to M. |
| Router (RRG + PathFinder) | **L** | The single largest piece: RRG generator + full negotiated-congestion loop from scratch. |
| Sim binding + equivalence check | **M** | Reuses oracles; new harness + I/O alignment + `compileLutFabric`. |
| **Stage 1 overall** | **L (heavy L, approaching XL)** | Two new algorithm-class engines + substrate + optimizer, all novel. |

**Versus prior chapters:** Stage 1 is **larger than the Verilog bridge** (which was mostly parsing + lowering onto the *existing* gate/logic engines — heavy reuse, no new algorithm class) and **comparable to or larger than chip-physical/mask** (which was also from-scratch — GDSII writer, Euler-path cell layout, scanline DRC, Gemini-LVS — but leaned on established, well-specified algorithms). Stage 1's distinguishing cost is that **two of its engines (cut-covering tech-mapping and negotiated-congestion routing) have no precursor anywhere in ChipBlocks and are different algorithm classes from everything shipped**, so the honest planning posture is: budget it like chip-physical, but expect the router increment (13–14) to be the true schedule driver.
