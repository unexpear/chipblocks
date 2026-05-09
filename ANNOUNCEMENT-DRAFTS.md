# Announcement Drafts — v0.1.0-alpha

> Throwaway file. Delete after launch once each draft has been posted.

Each section below is a self-contained announcement for a different venue. The release URL has been substituted in (tag pushed 2026-05-09).

---

## Draft 1 — r/synthdiy

**Title:** I built an open-source app that lets you design synth chips by dragging blocks (no Verilog), simulate them, and build a real FPGA bitstream or a Tiny Tapeout ASIC submission

**Body:**

Hi r/synthdiy. I'm a non-technical solo developer and I've been building a free open-source desktop app called ChipBlocks. The pitch: drag blocks onto a canvas — square/triangle/sawtooth/sine oscillators, wavetable, noise, constant, mixer, ADSR, gate, sample-and-hold, multiply (ring mod), FM voice, low/high/band-pass filters, bitcrusher, delay, output — wire them up, hit Play to hear the chip simulate through your speakers, then click "Build" to get one of three things:

- A real flashable `.bin` for a $30 Lattice iCEstick FPGA
- A `.bin` for the TinyFPGA BX (the same flow but a bigger, USB-native iCE40 board)
- A complete Tiny Tapeout submission package — drop into the GitHub template, push, and your design becomes a real ASIC chip on the SkyWater 130nm or GlobalFoundries 180nm shuttle

19 blocks in this alpha. There's also an AI consultant in the sidebar (bring your own Anthropic API key) that can read your canvas, suggest blocks, and wire things up for you with a preview-and-confirm step.

Stack: Electron + React on the front, Python + Amaranth HDL on the back, Yosys + nextpnr + icepack for the FPGA pipeline. MIT-licensed, no GPL in the shipped product.

v0.1.0-alpha. CI builds Windows NSIS + Mac DMG + Linux AppImage on tag push (all unsigned, so SmartScreen / Gatekeeper will warn the first time). Missing things you might want: no MIDI in, no polyphony, no reverb — all on the next-up list.

Repo + installer: https://github.com/unexpear/chipblocks/releases/tag/v0.1.0-alpha.1

Feedback very welcome, especially from people who actually build synths.

---

## Draft 2 — r/FPGA

**Title:** ChipBlocks: visual block editor on top of the Yosys / nextpnr-ice40 / icepack flow, with a Tiny Tapeout submission path. MIT-licensed.

**Body:**

First alpha of ChipBlocks: a free open-source desktop app that puts a visual node-graph editor on top of the open iCE40 toolchain. You wire 19 blocks (oscillators in four shapes, wavetable, noise, constant, mixer, ADSR, gate, sample-and-hold, multiply, FM voice, low/high/band-pass filters, bitcrusher, delay, output) on a canvas, the backend translates the graph to Verilog via Amaranth HDL, and runs it through Yosys → nextpnr-ice40 → icepack to produce a flashable `.bin`. There's also an audio simulation path that produces a WAV from the Amaranth design so you can hear it before flashing.

Three real-silicon outputs in this release:

- Lattice iCEstick (iCE40HX-1k, ~$30) — 1280 LUTs, primary target
- TinyFPGA BX (iCE40LP-8k, ~$40) — 8x the LUTs, USB-native
- Tiny Tapeout submission package — 14-file bundle in canonical `ttsky-verilog-template` layout, includes a working cocotb testbench. Drop into the GitHub template, push, submit at app.tinytapeout.com — your design becomes real silicon on a SkyWater 130nm or GlobalFoundries 180nm shuttle.

ECP5 and Xilinx 7-Series are on the roadmap, no committed date.

Frontend: Electron + React + TypeScript (React Flow). Backend: Python + Amaranth in WSL2 on Windows. Optional AI consultant — BYOK Anthropic, no telemetry. ChipBlocks itself is MIT and only redistributes permissively-licensed code (MIT / Apache 2.0 / BSD / ISC / PSF). OSS CAD Suite is invoked as separately-installed user tooling, not bundled.

Author is a non-technical solo dev working with Claude Code, so this is genuinely "make the open toolchain reachable for people who don't know what nextpnr means." v0.1.0-alpha — CI builds Windows NSIS + Mac DMG + Linux AppImage; all unsigned for the alpha (SmartScreen / Gatekeeper warn).

Repo + installer: https://github.com/unexpear/chipblocks/releases/tag/v0.1.0-alpha.1

Bug reports, PRs, board-support requests all welcome.

---

## Draft 3 — Hacker News (Show HN)

**Title:** Show HN: ChipBlocks – Drag-and-drop visual chip design that builds real FPGA bitstreams or Tiny Tapeout ASIC submissions

**Body:**

ChipBlocks is a free open-source desktop app for designing custom chips by wiring visual blocks. Drop an oscillator, connect it to a mixer and an output, hit Play and hear the design simulate through your speakers, then build one of three things: an iCE40 bitstream for a $30 dev board, a TinyFPGA BX bitstream, or a Tiny Tapeout submission package that becomes a real ASIC on the next SkyWater 130 or GlobalFoundries 180 shuttle.

First alpha covers audio / synth / retro-game chips — 19 blocks across oscillators (square / triangle / sawtooth / sine / wavetable), modulation (gate, ADSR, sample-and-hold, multiply, FM voice), filtering (low/high/band-pass), effects (bitcrusher, delay), and routing (mixer, output, noise, constant). MIT-licensed, ships only permissively-licensed code (MIT / Apache 2.0 / BSD / ISC). Pipeline is Amaranth HDL → Verilog → Yosys → nextpnr-ice40 → icepack for the FPGA paths; Tiny Tapeout's flow runs OpenLane on Sky130 or GF180.

There's an AI consultant in a sidebar that can read the canvas and edit it for you (with a preview-confirm step). BYOK — you supply an Anthropic API key. The project never pays AI bills on behalf of users.

Counterintuitively, I'm not a chip engineer. I'm a non-technical solo developer working with Claude Code, and the whole point is to make chip design reachable for people in that position. So the alpha is rough where you'd expect: unsigned installers (SmartScreen / Gatekeeper warn the first time), no MIDI, no polyphony, no reverb. CI ships Win NSIS + Mac DMG + Linux AppImage on tag push.

https://github.com/unexpear/chipblocks/releases/tag/v0.1.0-alpha.1

Happy to take questions.

---

## Draft 4 — Hackaday tip line

**Subject:** Tip: Visual chip-design app for non-engineers (MIT, BYOK AI, real FPGA bitstreams + Tiny Tapeout ASIC submission)

**Body:**

Hi Hackaday team,

ChipBlocks is a free open-source desktop app that lets non-engineers design custom chips by dragging visual blocks. The first alpha covers audio / synth / retro-game chips — 19 blocks in a node-graph editor, simulated audio output, plus three real-silicon outputs: a flashable iCE40 bitstream for the $30 Lattice iCEstick, a bitstream for the TinyFPGA BX, and a Tiny Tapeout submission package that drops into the canonical `ttsky-verilog-template` layout (so the same graph can become a real ASIC on the next Sky130 or GF180 shuttle). There's an optional AI consultant (bring your own Anthropic API key) that can read the canvas and wire things up with a preview-confirm step.

It's MIT-licensed, ships only permissively-licensed code, and the author is a non-technical solo developer building with Claude Code — eating their own dog food, since the project's whole point is making custom silicon reachable for people who don't know Verilog. v0.1.0-alpha just tagged.

Repo + installer: https://github.com/unexpear/chipblocks/releases/tag/v0.1.0-alpha.1

Happy to answer questions or send screenshots.
