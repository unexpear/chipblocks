# Third-Party Licenses

ChipBlocks depends on third-party software. This file lists each direct dependency, its license, copyright holder, source repository, and where to find the full license text. ChipBlocks complies with each license's redistribution requirements (preserving LICENSE files, preserving NOTICE content where present per Apache-2.0 §4(d), retaining attribution notices).

> **Last verified:** 2026-08-16 — vendored the first third-party **source code** (as opposed to data): 1801BM1's die-derived Intel 8080 core, **CC-BY 3.0**. See [Vendored source](#vendored-source-not-an-npm-dependency) below, and the **whitelist note** in that entry — CC-BY 3.0 is not one of the six licenses on CLAUDE.md principle 4's list and admitting it is the project lead's call, not an established precedent. Prior: 2026-07-17 — added `electron-builder` ^26.15.3 (MIT, dev-time-only packager) as the first new dependency since Sprint 18; verified MIT + no NOTICE + 0 production-dep vulnerabilities. Prior: 2026-07-05 — the board-road toolchain (footprint model, copper router, DRC, Gerber/Excellon writers, manufacturing ZIP) and the from-scratch 3-D board engine added **NO new dependencies** (all original TypeScript). Originally added during v3 Sprint 12 when `mathjs` brought the first NOTICE-bearing dependency.

---

## Direct dependencies (declared in `package.json`)

### Development tooling

#### TypeScript
- **Package:** `typescript` ^6.0.3
- **License:** Apache-2.0
- **Copyright:** Microsoft Corporation
- **Source:** <https://github.com/microsoft/TypeScript>
- **License text:** `node_modules/typescript/LICENSE.txt` after `npm install`
- **Third-party notices:** `node_modules/typescript/ThirdPartyNoticeText.txt` — 193 lines documenting third-party code TypeScript itself incorporates (DefinitelyTyped, Unicode, WebGL). **Not §4(d)-binding on ChipBlocks** because TypeScript is a dev-time-only tool: the compiler runs at build time and only its compiled JavaScript output would ship in the eventual Electron binary; TypeScript itself is never redistributed in ChipBlocks's product. Acknowledged here for audit honesty.
- **Usage tier:** dev-time only (build-time compiler; no runtime presence in shipped artifacts)

#### Vitest
- **Package:** `vitest` ^4.1.8
- **License:** MIT
- **Copyright:** Anthony Fu and contributors
- **Source:** <https://github.com/vitest-dev/vitest>
- **License text:** `node_modules/vitest/LICENSE.md` after `npm install`

#### jsdom
- **Package:** `jsdom` ^29.1.1
- **License:** MIT
- **Copyright:** Copyright (c) 2010 Elijah Insua
- **Source:** <https://github.com/jsdom/jsdom>
- **License text:** `node_modules/jsdom/LICENSE.txt` after `npm install`
- **NOTICE:** none (`ls node_modules/jsdom/NOTICE*` → absent)
- **Usage tier:** dev-time only — the Vitest environment for renderer tests that need a document (panel open/close, shared key bindings). Not shipped.

#### Biome
- **Package:** `@biomejs/biome` ^2.4.16
- **License:** MIT OR Apache-2.0 (dual — either grant satisfies)
- **Copyright:** Biomejs project contributors (with upstream Rome attribution preserved)
- **Source:** <https://github.com/biomejs/biome>
- **License text:** `node_modules/@biomejs/biome/LICENSE-MIT` + `LICENSE-APACHE` after `npm install`
- **Attribution preserved:** `ROME-LICENSE-MIT` (original Rome project)

#### Ajv
- **Package:** `ajv` ^8.20.0
- **License:** MIT
- **Copyright:** Evgeny Poberezkin
- **Source:** <https://github.com/ajv-validator/ajv>
- **License text:** `node_modules/ajv/LICENSE` after `npm install`

#### ajv-formats
- **Package:** `ajv-formats` ^3.0.1
- **License:** MIT
- **Copyright:** Evgeny Poberezkin and contributors
- **Source:** <https://github.com/ajv-validator/ajv-formats>
- **License text:** `node_modules/ajv-formats/LICENSE` after `npm install`

#### yaml
- **Package:** `yaml` ^2.9.0
- **License:** ISC
- **Copyright:** Eemeli Aro
- **Source:** <https://github.com/eemeli/yaml>
- **License text:** `node_modules/yaml/LICENSE` after `npm install`

#### @types/node
- **Package:** `@types/node` ^25.9.1
- **License:** MIT (DefinitelyTyped collective)
- **Copyright:** DefinitelyTyped contributors
- **Source:** <https://github.com/DefinitelyTyped/DefinitelyTyped>
- **License text:** `node_modules/@types/node/LICENSE` after `npm install`

#### electron-builder
- **Package:** `electron-builder` ^26.15.3 (with its core `app-builder-lib` ^26.15.3, also MIT)
- **License:** MIT
- **Copyright:** Copyright (c) 2015 Loopline Systems; maintained by Vladimir Krivosheev / electron-userland contributors
- **Source:** <https://github.com/electron-userland/electron-builder>
- **License text:** `node_modules/electron-builder/LICENSE` after `npm install`
- **NOTICE:** none (`ls node_modules/electron-builder/NOTICE*` → absent)
- **Usage tier:** dev-time only — packages the electron-vite `out/` build into a distributable at build time (`npm run package`); never present in the shipped runtime. `npm audit --omit=dev` reports **0 vulnerabilities**; the build-tool tree carries dev-only advisories (a `high` esbuild dev-server file-read on Windows) that do not reach the packaged app.

### Physics / math (Sprint 12+)

#### mathjs
- **Package:** `mathjs` 15.2.0
- **License:** **Apache-2.0** — NOTICE file preserved at project-root [NOTICE](NOTICE) per §4(d)
- **Copyright:** Copyright (C) 2013-2026 Jos de Jong
- **Source:** <https://github.com/josdejong/mathjs>
- **License text:** `node_modules/mathjs/LICENSE` after `npm install`
- **NOTICE text:** `node_modules/mathjs/NOTICE` (also reproduced in project-root NOTICE)
- **Used for:** expression parsing + dimensional unit checking in `src/equation-evaluator.ts` (per OBJECT-MODEL.md §16)

### Frontend / canvas (Sprint 18+)

All MIT; none ship a NOTICE file (verified 2026-06-06 via `ls node_modules/<pkg>/NOTICE*`). Runtime (`dependencies`): react, react-dom, @xyflow/react. Build/dev (`devDependencies`): electron, electron-vite, vite, @vitejs/plugin-react, @types/react, @types/react-dom.

| Package | Version | License | Role | Source |
|---|---|---|---|---|
| `react` | ^19.2 | MIT | UI framework (renderer) | <https://github.com/facebook/react> |
| `react-dom` | ^19.2 | MIT | DOM renderer | <https://github.com/facebook/react> |
| `@xyflow/react` (React Flow) | ^12.11 | MIT | canvas engine | <https://github.com/xyflow/xyflow> |
| `electron` | ^42.3 | MIT | desktop shell | <https://github.com/electron/electron> |
| `electron-vite` | ^5.0 | MIT | Electron + Vite build integration | <https://github.com/alex8088/electron-vite> |
| `vite` | ^7.3 | MIT | renderer bundler (pinned to 7 for electron-vite compat) | <https://github.com/vitejs/vite> |
| `@vitejs/plugin-react` | ^5.2 | MIT | React JSX + fast-refresh | <https://github.com/vitejs/vite-plugin-react> |
| `@types/react`, `@types/react-dom` | ^19 | MIT | types (DefinitelyTyped) | <https://github.com/DefinitelyTyped/DefinitelyTyped> |

**Electron's bundled components.** Electron itself is MIT, but it bundles Chromium (BSD-3-Clause + many sub-licenses) and Node.js (MIT). Electron ships a `LICENSES.chromium.html` enumerating all bundled third-party licenses. As of 2026-07-17 ChipBlocks packages a distributable via **electron-builder** (`npm run package`), which copies Electron's `LICENSE.electron.txt` + `LICENSES.chromium.html` into the packaged app (`dist/win-unpacked/`) per Electron's redistribution terms. No GPL/AGPL in the bundled set — Chromium and Node are permissive. The packaged app is UNSIGNED (no code-signing certificate configured); Windows SmartScreen will warn on first run until the user (or a future signing step) signs it.

---

## Transitive dependencies introduced by mathjs

All 9 transitive deps mathjs pulls in are MIT-licensed (verified 2026-06-05 via `node -e "require('./node_modules/<pkg>/package.json').license"`):

| Package | License | Author / Source |
|---|---|---|
| `@babel/runtime` | MIT | Babel contributors |
| `complex.js` | MIT | Robert Eisele |
| `decimal.js` | MIT | MikeMcl |
| `escape-latex` | MIT | Tyler Stewart |
| `fraction.js` | MIT | Robert Eisele |
| `javascript-natural-sort` | MIT | Jim Palmer |
| `seedrandom` | MIT | David Bau |
| `tiny-emitter` | MIT | Scott Corgan |
| `typed-function` | MIT | Jos de Jong |

All transitive LICENSE files available at `node_modules/<pkg>/LICENSE` after `npm install`.

---

## Other notable transitive deps (carried in pre-Sprint-12 audit)

The pre-mathjs full transitive audit (deep-research 2026-06-05) found `lightningcss` (MPL-2.0) as a deeper transitive via Vite → Vitest. MPL-2.0 is file-level copyleft and is on the permissive whitelist (CLAUDE.md principle 4). See [LEGAL-CONSIDERATIONS.md](LEGAL-CONSIDERATIONS.md) §1 for the rationale.

The integration audit (2026-06-16) also noted `caniuse-lite` (CC-BY-4.0), carried transitively via browserslist → Vite. CC-BY-4.0 is a **content/data** license — it covers browser-support data tables, not software — and the package is build-time only (browserslist reads it while bundling the renderer); none of its data ships in the product. It is thus outside the code whitelist *by kind* rather than in violation of it. Noted here for an exhaustive accounting.

---

## Vendored data (not an npm dependency)

#### Project Trellis — ECP5 bitstream format + device geometry
- **What:** no vendored files. The ECP5 `.bit` container format implemented in `src/renderer/fpga-trellis-bit.ts` is **transcribed** from Project Trellis's `libtrellis/src/Bitstream.cpp` + `libtrellis/include/Bitstream.hpp` (the `FF FF BD B3` preamble, the `BitstreamCommand` opcode table, `update_crc16`/`finalise_crc16`/`check_crc16`, and the `LSC_PROG_INCR_RTI` frame loop). The ten-part ECP5 geometry table (`ECP5_DEVICES`: idcode, frames, bits-per-frame, pad bits) is transcribed from Project Trellis's device database `devices.json`.
- **License:** prjtrellis is **ISC**; the device database (prjtrellis-db) is **CC0-1.0** — both on CLAUDE.md principle 4's permissive whitelist.
- **Copyright:** Copyright (C) 2018 The Project Trellis Authors
- **Source:** <https://github.com/YosysHQ/prjtrellis> (format) and <https://github.com/YosysHQ/prjtrellis-db> (`devices.json`)
- **Vendored data files:** `fixtures/trellis-ecp5-LFE5U-25F-tilegrid.json` (2.8 MB — the LFE5U-25F tile grid) and ten per-tile-type bit databases `fixtures/trellis-ecp5-{PLC2,CIB,CIB_LR,CIB_EBR,CIB_DSP,TAP_DRIVE,PIOT0,PIOT1,PICT0,PICT1}-bits.db` (~290 kB total — the logic tile, the connection blocks, the clock taps and the IO tiles), both copied unmodified from prjtrellis-db so `src/renderer/fpga-trellis-tiles.ts` can map frames to tiles and decode SLICE LUT4s. **CC0-1.0** places these in the public domain and imposes no notice requirement; attribution is recorded here anyway.
- **Note:** the format itself (opcode values, a checksum polynomial, per-part frame counts, the tile bit-address convention) consists of interoperability FACTS, transcribed into original TypeScript rather than copied as code. Attribution is recorded here and in each module's header comment.

> **Scope note on Project IceStorm.** The ISC statement in each entry below is **per file**, and deliberately so.
> IceStorm's own README says *most* of the project is ISC — not all of it — so "IceStorm is ISC" is not a claim
> this project makes or relies on. Every file transcribed or vendored here was checked individually and carries an
> ISC header, which is reproduced verbatim alongside it. Anything else from that repository must be checked on its
> own terms before use.

#### Project IceStorm — iCE40 chip databases (all six devices + fragments)
- **What:** genuine Lattice iCE40 chip-database data, generated by `icebox_chipdb.py`. The **full** chipdb for **every** iCE40 device is vendored — `fixtures/icebox-ice40-{384,1k,lm4k,u4k,5k,8k}-chipdb.txt` (~1.9 / 7.1 / 17.7 / 18.6 / 27.8 / 38.1 MB; the complete `.device` / `.net` / `.buffer` / `.routing` / `.logic_tile_bits` / … tables, line-endings normalised to LF) — so the FPGA flow can load a real vendor `.bin` for any iCE40 part and reconstruct + simulate the design (`src/renderer/fpga-icebox-load.ts`). Alongside them, four small verbatim fragments generated the same way: `fixtures/icebox-ice40-384-fragment.chipdb` (a `.device` line plus a few `.net` / `.buffer` / `.routing` blocks) proves the Stage-2 chipdb parser (`src/renderer/fpga-icebox.ts`) ingests genuine iCE40 data, not an invented format; `fixtures/icebox-ice40-384-routing-slice.chipdb` (nets 2246, 76, 122 and the two `.buffer` switches among them, each block copied byte-for-byte from the full device chipdb) is a connected routing slice proving the Stage-2 RRG bridge (`src/renderer/fpga-icebox-rrg.ts`) routes a real net and emits its real CRAM bits; `fixtures/icebox-ice40-384-logic-tile-bits.chipdb` (the verbatim `.logic_tile_bits` section — the per-cell LUT/flip-flop CRAM layout) proves the logic-cell bit model (`src/renderer/fpga-icebox-logic.ts`) encodes a real cell to its genuine CRAM positions; `fixtures/icebox-ice40-384-cell-to-cell.chipdb` (nets 39/1057/1121 and the two `.buffer` switches — a real intra-tile connection from `lutff_0/out` to `lutff_5/in_1`) proves the synthesizer (`src/renderer/fpga-icebox-synth.ts`) routes a placed netlist cell-to-cell into a full design bitstream.
- **License:** ISC (on CLAUDE.md principle 4's permissive whitelist)
- **Copyright:** Copyright (C) 2015 Claire Xenia Wolf \<claire@clairexen.net\>
- **Source:** <https://github.com/YosysHQ/icestorm> (`icebox/iceboxdb.py` + `icebox/icebox_chipdb.py`)
- **License text:** the full ISC notice — both the permission grant AND the warranty-disclaimer paragraph — is preserved verbatim in every vendored file's header comment — the full `icebox-ice40-384-chipdb.txt` and each fragment (as ISC requires — "the above copyright notice and this permission notice appear in all copies"). No separate LICENSE file is vendored. (The generated `.bin` bitstream fixtures under `fixtures/` — e.g. `icebox-ice40-384-routed.bin`, `-cells.bin`, `-1k-cells.bin`, and the vendor-toolchain builds `icebox-ice40-{384,1k}-vendor-xor5.bin` — are our own test artifacts produced with the ISC-licensed `icepack` tool, not vendored ISC source, so they carry no third-party notice. The same applies to `icebox-ice40-{384,1k}-vendor-xor5.icebox_vlog.v`: those are `icebox_vlog`'s recovery of OUR OWN design, kept beside each `.bin` as the oracle its test reads its expected numbers from.)
- **Usage tier:** dev-time/test only (test fixtures; not shipped in the product artifact).

#### Project IceStorm — the `.asc` TEXT chip-file grammar
- **What:** no vendored files. The grammar of the IceStorm text chip file implemented in `src/renderer/fpga-icebox-asc.ts` is **transcribed** from Project IceStorm's `icebox/icebox.py` `read_file` — its directive set (`.device`, `.comment`, `.warmboot`, `.io_tile` / `.logic_tile` / `.ramb_tile` / `.ramt_tile` / `.ipcon_tile` / `.dsp0-3_tile`, `.ram_data`, `.extra_bit`, `.sym`), its rule that a line beginning with `.` is always a directive, its sixteen-rows-per-tile block shape, and its handling of an unrecognised directive.
- **License:** ISC (on CLAUDE.md principle 4's permissive whitelist)
- **Copyright:** Copyright (C) 2015 Claire Xenia Wolf \<claire@clairexen.net\>
- **Source:** <https://github.com/YosysHQ/icestorm> (`icebox/icebox.py`)
- **Note:** the grammar consists of interoperability FACTS, transcribed into original TypeScript rather than copied as code.
- **Vendored data files:** none. The `.asc` fixtures — `fixtures/icebox-ice40-{384-dense,384-vendor-xor5,1k-carry-add4,1k-blockram}.asc` — are OUR OWN test artifacts: the first two are `icepack -u` renderings of the `.bin` files committed beside them, the last two are nextpnr-ice40's output for the Verilog sources committed beside them (`icebox-ice40-1k-{carry-add4,blockram}.v`). They are produced WITH the ISC-licensed tools, not copied FROM them, so they carry no third-party notice.
- **Usage tier:** dev-time/test only.

#### Project Oxide — the Lattice Nexus bitstream container format
- **What:** no vendored files. The Nexus `.bit` container implemented in `src/renderer/fpga-oxide-bit.ts` is **transcribed** from Project Oxide's `prjoxide` — `src/bitstream.rs` (the `FF 00` / `00 FF` / `00 FE` comment markers and the `FF FF BD B3` preamble, the command opcode set, `update_crc16` / `finalise_crc16`, `update_ecc` / `finalise_ecc` with the 14-bit `0x202D` frame-ECC polynomial, `parse_container`, `parse_bitstream` and `serialise_chip`) and `src/chip.rs` (`frame_addr_to_idx`, `get_bus_frame_size`, and the per-device TAP frame count). `NEXUS_DEVICES` in the same file, and the five-IDCODE refusal table `NEXUS_DEVICES` in `src/renderer/fpga-trellis-bit.ts`, hold the identifier numbers that tell a Nexus file from an ECP5 one — the two families share the `FF FF BD B3` marker, so only the chip's own number can separate them.
- **License:** ISC (on CLAUDE.md principle 4's permissive whitelist), per `license/LICENSE.prjoxide` in the oss-cad-suite distribution
- **Copyright:** Copyright (C) 2020-21 gatecat \<gatecat@ds0.me\>
- **Source:** <https://github.com/gatecat/prjoxide>
- **Note:** a file format and a chip's own identifier number are interoperability FACTS, not expression; the format is additionally published by the manufacturer in Lattice technical note FPGA-TN-02099, Appendix B. Transcribed into original TypeScript rather than copied as code.
- **Vendored data files:** all our own test artifacts, none copied from the project. `fixtures/oxide-nexus-lifcl40-counter.{bit,v,pdc}` (a small counter we wrote, synthesised with yosys + nextpnr-nexus and packed with `prjoxide pack`); `fixtures/nexus-lifcl40-xnor-dff-prod.bit` (the same design as `nexus-lifcl40-xnor-dff.bit` repacked for the PRODUCTION silicon revision, so the reader is checked against both LIFCL-40 identifier numbers and not only the engineering-sample one every open write-up quotes); `fixtures/nexus-lifcl40-xnor-dff-holes.bit` (that design with five named tiles' features deleted, the fixture the frame-index check reads); `fixtures/nexus-lifcl40-bram1k.bit` (a block-memory design, the only one carrying IP bus writes); `fixtures/nexus-lifcl17-{blank,metadata}.bit` (a second part, for a second frame geometry and for the header comment strings).
- **Usage tier:** dev-time/test only.

#### Project Apicula — the Gowin bitstream format + the GW1N-1 device database
- **What:** two things. (1) The Gowin `.fs` container implemented in `src/renderer/fpga-apicula-fs.ts` is **transcribed** from Apicula's `apycula/bslib.py` (`read_bitstream` — the `//` comment lines, the three preamble lines, the `0x10` options record with its compression bit, the `0x06` IDCODE record, the `0x3B` frame count, the `0xD2` record excluded from the checksum, the per-device frame padding, the `line[padding:-64]` frame content and the left-to-right row flip) and `apycula/crc16.py` (CRC-16/ARC, reflected 0x8005, initial value 0). `readGowinFsHeader` in the same file walks that same header to recognise a Gowin file, which is how the app tells a `.fs` from any other text file. (2) **Vendored data files:** `fixtures/gowin-gw1n1-{chipdb,pips,attributes,nodes}.json` are a **converted slice of Apicula's own GW1N-1 device database**, `apycula/GW1N-1.msgpack.xz` (LZMA-compressed MessagePack) in the oss-cad-suite distribution. The conversion re-encodes tuple keys as comma-joined strings, because JSON object keys must be strings; the values are otherwise unchanged. Measured against the packed database on 2026-08-03: the tile grid, the vendor command header, and the centre row/column are identical; the whole of `logicinfo` is identical; each tile type's switch map is identical to that type's `pips`; and all 963 wire-equivalence groups carry the same names and the same (row, column, wire) members, with Apicula's leading group-kind label dropped.
- **License:** **MIT** (on CLAUDE.md principle 4's permissive whitelist), per `license/LICENSE.apicula` in the oss-cad-suite distribution, read 2026-08-03. That file records the build source as `github.com/YosysHQ/apicula` at revision `dfb3c870235721bfbb9c5605cddf1c19e6762d59`. MIT asks that the copyright notice and permission notice travel with copies or substantial portions, which is what this entry is for — the device-database slice above is a substantial portion.
- **Copyright:** Copyright (c) 2019 Pepijn de Vos
- **Source:** <https://github.com/YosysHQ/apicula>
- **Note:** a file format and a checksum polynomial are interoperability FACTS, transcribed into original TypeScript rather than copied as code. The device database is not a fact of that kind — it is the project's own reverse-engineered work — so it is recorded here as vendored data, not as a transcription.
- **Other Gowin fixtures:** `fixtures/gowin-gw1n1-*.{fs,v,cst}` and the `-placement.json` / `-outputs.json` / `-muxes.json` / `-vectors.json` beside them are OUR OWN test artifacts — designs we wrote, synthesised with yosys + nextpnr-himbaechel, packed with `gowin_pack` and read back with `gowin_unpack`. Produced WITH the MIT-licensed tools, not copied FROM them, so they carry no third-party notice.
- **Usage tier:** dev-time/test only. The app reads these four files only when the user chooses them as a chip description; none of them is bundled in the shipped product.

#### prjoxide-db — the Lattice Nexus device database
- **What:** no vendored database files. Three things are read from it and **transcribed**. (1) Into `src/renderer/fpga-oxide-bit.ts`: the per-part frame geometry and identifier numbers in `devices.json` (frames, bits per frame, pad bits, ECC bits, max row/col, and the `variants` map that gives the LIFCL-40 its two numbers — `0x110F1043` production and `0x010F1043` engineering sample), read 2026-08-03. (2) Into `src/renderer/fpga-oxide-plc.ts`: the logic tile's own permanent wiring from `LIFCL/tiletypes/PLC.ron` — its 148 fixed connections (`conns`) and the 36 routing-multiplexer choices whose bit list is empty, i.e. the ones a blank device already makes. `fixtures/oxide-nexus-plc-fabric.json` is the same two lists extracted **verbatim**, and a test compares the table in source against it so a transcription slip cannot pass. (3) Also into `src/renderer/fpga-oxide-plc.ts`: the LIFCL-40 clock-region table, read out of the database with the project's own tool as `prjoxide bba-export LIFCL <constids.inc> out.bba`, labels `d0_branches`, `d0_spines`, `d0_hrows`, `d0_hr0_sc` and `d0_hr1_sc` — the seven branch segments a clock reaches with the tap column that drives each, the single spine row-span (rows 1 to 55, which is why a spine is identified by its column and carries no row), and the two horizontal rows with the spine columns each feeds. `fixtures/oxide-nexus-lifcl40-clock-regions.json` is that export's own numbers extracted **verbatim**, and a test compares the tables in source against it so a transcription slip cannot pass. Separately, `fixtures/oxide-nexus-lifcl40-tilegrid-slice.json` is a five-tile **verbatim slice** of `LIFCL/LIFCL-40/tilegrid.json` — the `start_frame` / `start_bit` / extent of the five tiles the frame-index test uses as its independent ground truth.
- **License:** **CC0-1.0** — a formal dedication to the public domain, imposing no notice requirement; recorded here anyway as this project's house rule. On CLAUDE.md principle 4's permissive whitelist.
- **Copyright:** dedicated to the public domain by the Project Oxide authors (gatecat and contributors)
- **Source:** <https://github.com/gatecat/prjoxide-db> (`COPYING` is the full CC0-1.0 text)
- **Usage tier:** dev-time/test only.

#### yosys — the Lattice Nexus logic-cell simulation model
- **What:** no vendored files. `src/renderer/fpga-oxide-netlist.ts` reconstructs a Nexus design's logic, and what a Nexus lookup table computes in ARITHMETIC mode is **transcribed** from yosys's own simulation model of the cell, `techlibs/nexus/cells_sim.v` (module `OXIDE_COMB`, and `CCU2` / `LUT4_3` beside it in `techlibs/lattice/cells_sim_nexus.v`): the carry unit's four equations `Z = LUT4(INIT,A,B,C,D)`, `Z3 = LUT4(INIT,A,B,C,0)`, `F = Z ^ (FCI & ~inject)`, `FCO = Z ? FCI : (Z3 & ~inject)`, the wide multiplexer `OFX = SEL ? F1 : F`, and the flip-flop's own `OXIDE_FF` behaviour (`CLKMUX` / `LSRMUX` / `CEMUX` inversion, `SRMODE` asynchronous versus set/reset-over-enable, `REGSET`, `LSRMODE PRLD`). Read 2026-08-03 from the oss-cad-suite distribution.
- **License:** ISC (on CLAUDE.md principle 4's permissive whitelist), per `license/LICENSE.yosys` in the oss-cad-suite distribution, read 2026-08-03. That file records the build source as `github.com/YosysHQ/yosys` at revision `9bc23d383f037b9a7b9f6cb6fe19ad4040b5e321`.
- **Copyright:** Copyright (C) 2012 - 2026 Claire Xenia Wolf \<claire@yosyshq.com\>; the Nexus cell library Copyright (C) 2018 gatecat \<gatecat@ds0.me\>
- **Source:** <https://github.com/YosysHQ/yosys>
- **Note:** what a manufacturer's logic cell computes is an interoperability FACT about the silicon, not expression; it is additionally implied by Lattice's own published `MODE`/`INJECT` settings. Transcribed into original TypeScript rather than copied as code, and reproduced here as four-input lookup tables rather than as the Verilog's own expressions.
- **Vendored data files:** all our own test artifacts, none copied from the project. `fixtures/nexus-lifcl40-{shiftreg-ce,asyncreset,mux4,counter16,negclk,active-low-enable,lutram,widemux-asym}.{v,fasm,bit}` and `-unpacked.fasm` beside each, plus `fixtures/oxide-nexus-lifcl40-counter{,-unpacked}.fasm` — designs we wrote, synthesised with yosys + nextpnr-nexus, packed with `prjoxide pack` and read back with `prjoxide unpack`. `fixtures/nexus-lifcl40-{doubleedge,doubleedge-router,clock-tied-low,preload,inverted-reset,unrouted-input,carry-injected,preset,raw-lut-read}.fasm` are those same designs with ONE setting changed and then run back through `prjoxide pack` + `unpack`, so each is a real bitstream readback rather than hand-written text. `fixtures/nexus-lifcl40-{oneclock-rows,fourclock}{,-unpacked}.fasm` with `.v` beside each are two more designs we wrote for the clock-region work — a 128-bit shift register on one clock, and four independent clocks — each packed and unpacked, and each verified to survive `unpack` → `pack` byte-identically. `fixtures/nexus-lifcl40-{spine-conflict,spine-duplicate,clock-loop}.fasm` are the one-clock design with a single routing arc added BY HAND (a second spine driving the same wire from a different source, the same arc repeated verbatim, and an arc pointing the clock network back at itself); no toolchain writes those, and they exist solely to fire the reader's refusals.
- **Usage tier:** dev-time/test only.

---

## Vendored source (not an npm dependency)

Everything in the section above is data — tables, grids, bitstream databases. The entry below is the first
third-party **source code** carried in this repository, and it is the only one. It is held to a stricter
standard accordingly: every claim here was checked at the upstream project itself, and the byte-identity was
measured with `git hash-object`, not assumed.

#### vm80a — the die-derived Intel 8080 core

- **What:** `fixtures/cpu8080-vm80a-core.v` — **vendored verbatim**, renamed only. It is 1801BM1's Verilog transcription of a decapped and photographed 580BM80A die (the Soviet replica of the Intel 8080A), recovered from the real gate-level topology rather than written from the datasheet. ChipBlocks imports it as 11,155 real parts and clocks it through a program (`tests/verilog-8080.test.ts`). **No line of it is modified.** Byte-identity measured 2026-08-16: `git hash-object fixtures/cpu8080-vm80a-core.v` → `d6783b99b65d36b6eafc8ef80349aa7d5a6bd938`, which is the blob SHA the GitHub API reports for upstream `org/rtl/vm80a.v` at `master`. The repository's `.gitattributes` (`* text=auto eol=lf`) keeps the file LF on every checkout, so that identity survives a Windows clone.
- **License:** **CC-BY 3.0 Unported** (Creative Commons Attribution 3.0). Verified 2026-08-16 by reading the upstream `license.md` (blob `e943acc41a0a5679655eecef34ab2c279c08e15c`, 18,498 bytes) — it is the full CC-BY 3.0 legal code. The file's own header states the same license and its URI, and header and repository license agree. **Note:** GitHub's API reports `spdx_id: NOASSERTION` for this repository purely because the file is named `license.md` rather than `LICENSE`; the text itself is unambiguous.
- **Copyright:** Copyright (c) 2014-2018 by 1801BM1@gmail.com (Viacheslav Ovsiienko, per the Signed-off-by line at repository HEAD `323535a13340c0211dae44a4b81debec8e61ad05`)
- **Source:** <https://github.com/1801BM1/vm80a> (file `org/rtl/vm80a.v`)
- **License text:** the full CC-BY 3.0 legal code is at <https://creativecommons.org/licenses/by/3.0/legalcode>; the URI required by §4(a) is carried in the vendored file's own header and repeated here. No separate license file is vendored.
- **NOTICE:** none — the upstream repository root holds `.gitattributes`, `clean.bat`, `license.md`, `readme.md` and the source directories, with no NOTICE file (listing read 2026-08-16). Nothing to carry into the project-root [NOTICE](NOTICE), which in any case is an Apache-2.0 §4(d) mechanism and not a CC-BY one.
- **How the CC-BY 3.0 obligations are met.** §4(a): the license URI travels with the copy (in the file header and in this entry), the notices referring to the license and to the disclaimer of warranties are intact, and ChipBlocks does **not** sublicense the work — this file stays CC-BY 3.0 inside an MIT repository, and the project's own [LICENSE](LICENSE) does not and cannot relicense it. §4(b) attribution: the Original Author is **1801BM1@gmail.com**, the title of the Work is **vm80a**, and the URI the licensor specifies is **<https://github.com/1801BM1/vm80a>** — recorded here, in the vendored file's header, in `fixtures/cpu8080-system.v`'s header, and in [CREDITS.md](CREDITS.md) alongside the project's other author credits, as §4(b) requires the credit to be at least as prominent as those. §3(b) does not apply: nothing is adapted, because the file is verbatim.
- **Do not strip the header.** The two-line copyright + license notice at the top of `fixtures/cpu8080-vm80a-core.v` is a license condition, not decoration. A linter, a formatter, or a "tidy the fixtures" pass that removes it puts the project out of compliance.
- **Whitelist note — an open decision for the project lead.** CLAUDE.md principle 4 lists MIT / Apache-2.0 / BSD / ISC / CC0 / MPL-2.0. **CC-BY 3.0 is none of them.** The nearest precedent in this file is `caniuse-lite` (CC-BY-4.0), admitted as outside the whitelist *by kind* rather than in violation of it — but that reasoning only half transfers: `caniuse-lite` is a data table, whereas this is source code. What does transfer is the usage tier (below), which is the same posture every FPGA fixture in this file already takes. Two further facts to weigh: CC-BY 3.0 grants **no patent license** (unlike Apache-2.0), and Creative Commons themselves recommend against applying CC licenses to software. The obligations above are all satisfiable and are satisfied; whether to admit a seventh license family is a policy call that belongs to the project lead.
- **Usage tier:** dev-time/test only. The file lives under `fixtures/`, is read by one Vitest file, and is **not bundled into the shipped Electron artifact** — nothing under `fixtures/` is. No CC-BY-licensed code ships in the product.
- **Refused from the same work:** `org/tbe/tb80a.v` and `org/tbe/config.h` (that project's own simulation harness — not needed, and `config.h` carries no in-file notice at all) and `org/rtl/de0/de0_top.v` (an Altera DE0 board top level with no bearing on this flow, also with no in-file notice). Machine-generated netlists synthesised **from** this core (yosys output, ~5.3 MB across several variants) are derivative works of it and were likewise kept out: they carry the same CC-BY obligation, contain no information the 32 KB of RTL does not, and are regenerable.

#### Arlet Ottens' verilog-6502 — REFUSED, not vendored

- **What:** nothing. Recorded here so the refusal is not re-litigated. A MOS 6502 core (`cpu.v` + `ALU.v`) was evaluated alongside the 8080 and **rejected on licensing**.
- **Why refused:** `ALU.v` has **no license from any primary source**. The upstream repository <https://github.com/Arlet/verilog-6502> has **no LICENSE file** (the GitHub API reports `license: null`; the root holds only `ALU.v`, `README.md`, `cpu.v`), the README contains no license statement, and `ALU.v` itself carries no copyright line and no grant — verified 2026-08-16 by fetching the raw upstream file. The only grant anywhere in that project is in `cpu.v`'s header, and it is textually scoped to that file ("keep this message"). With no license, default copyright applies and there is no permission to copy `ALU.v`. Anything synthesised from it (a flattened 6502 netlist) inherits the same problem.
- **Separately:** even `cpu.v`'s grant — "Feel free to use this code in any project (commercial or not), as long as you keep this message, and the copyright notice" — is permissive in substance but is a bespoke grant with no SPDX identifier, and so is not on CLAUDE.md principle 4's whitelist either.
- **What would unblock it:** the upstream author (Arlet Ottens, <arlet@c-scape.nl>) adding a LICENSE file, or confirming in writing that the `cpu.v` grant covers `ALU.v`. Nothing short of that.

---

## Dev-time vs runtime distinction

Apache-2.0 §4(d) obligations on ChipBlocks attach only to deps that travel with the shipped product. The audit distinguishes:

- **Dev-time-only deps** (TypeScript compiler, Biome linter, Vitest runner, Ajv schema-validator-at-test-time, etc.) — used during development and CI. None of these ship inside the eventual Electron binary; only their *output* (compiled JS, lint-clean source, passing tests) does. Apache-2.0 §4(d) doesn't bind ChipBlocks to surface their NOTICE content in the shipped product.
- **Runtime deps** (mathjs as of Sprint 12, plus any future deps required for the app's runtime behavior) — ship inside the binary. Their LICENSE + NOTICE content MUST travel with the distribution per §4(d).

Today every dep is in `devDependencies` per the schema-validator-at-dev-time pattern. Once an Electron runtime appears, deps split into actual `dependencies` (runtime) vs `devDependencies` (dev-time), and this section becomes the source of truth for which NOTICE content the shipped binary must surface.

---

## Compliance approach

For each new dependency added to the project:

1. **Verify the license** is on CLAUDE.md principle 4's permissive whitelist (MIT / Apache-2.0 / BSD / ISC / CC0 / MPL-2.0). Never GPL / AGPL bundled.
2. **Check the package for a NOTICE file:** `ls node_modules/<pkg>/NOTICE*`. If present, append the content to the project-root `NOTICE` file per Apache-2.0 §4(d).
3. **Add an entry to this file** (THIRD-PARTY-LICENSES.md) with license, copyright, source URL, and where to find the full license text.
4. **Record the license** in the commit message that adds the dependency (per CLAUDE.md "Every new dependency needs a license check").
5. **Sample the transitive deps** (`npm ls --all` or the per-package `license` field) for non-permissive surprises.

When the application ships as a binary (Electron, etc.), `LICENSE` + `NOTICE` + `THIRD-PARTY-LICENSES.md` MUST be bundled with the distribution and accessible to end users — typically via an in-app "About → Licenses" screen. The compliance scaffold here is ready for that ship.

---

## License of this file

This file is part of ChipBlocks and is licensed under MIT — see [LICENSE](LICENSE).
