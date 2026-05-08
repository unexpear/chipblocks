# Announcement Drafts — v0.1.0-alpha

> Throwaway file. Delete after launch once each draft has been posted.

Each section below is a self-contained announcement for a different venue. Replace `[GitHub Release URL]` with the real link once the tag is pushed.

---

## Draft 1 — r/synthdiy

**Title:** I built an open-source app that lets you design synth chips by dragging blocks (no Verilog), simulate them, and build a real FPGA bitstream

**Body:**

Hi r/synthdiy. I'm a non-technical solo developer and I've been building a free open-source desktop app called ChipBlocks. The pitch: drag blocks onto a canvas (oscillator, mixer, ADSR, low-pass, sample-and-hold, noise, constant, output), wire them up, hit Play to hear the chip simulate through your speakers, then click "Build for FPGA" and get a real flashable bitstream for the $30 Lattice iCEstick.

Eleven blocks in this alpha. There's also an AI consultant in the sidebar (bring your own Anthropic API key) that can read your canvas, suggest blocks, and wire things up for you with a preview-and-confirm step.

Stack: Electron + React on the front, Python + Amaranth HDL on the back, Yosys + nextpnr + icepack for the FPGA pipeline. MIT-licensed, no GPL in the shipped product.

It's v0.1.0-alpha, Windows only this time (no Mac/Linux builds yet, no code-signing). Missing things you might want: no MIDI in, no polyphony, no reverb — all on the next-up list.

Repo + installer: [GitHub Release URL]

Feedback very welcome, especially from people who actually build synths.

---

## Draft 2 — r/FPGA

**Title:** ChipBlocks: visual block editor on top of the Yosys / nextpnr-ice40 / icepack flow, MIT-licensed

**Body:**

First alpha of ChipBlocks: a free open-source desktop app that puts a visual node-graph editor on top of the open iCE40 toolchain. You wire blocks (oscillator / mixer / ADSR / filter / S&H / noise / constant / output — eleven in this release) on a canvas, the backend translates the graph to Verilog via Amaranth HDL, and runs it through Yosys → nextpnr-ice40 → icepack to produce a flashable `.bin` for the Lattice iCEstick. There's also an audio simulation path that produces a WAV from the Amaranth design so you can hear it before flashing.

Target board this release: iCEstick (HX1k). ECP5 and second iCE40 boards are on the roadmap.

Frontend: Electron + React + TypeScript (React Flow). Backend: Python + Amaranth in WSL2 on Windows. Optional AI consultant — BYOK Anthropic, no telemetry. ChipBlocks itself is MIT and only redistributes permissively-licensed code (MIT / Apache 2.0 / BSD / ISC / PSF). OSS CAD Suite is invoked as separately-installed user tooling, not bundled.

Author is a non-technical solo dev working with Claude Code, so this is genuinely "make the open toolchain reachable for people who don't know what nextpnr means." v0.1.0-alpha — Windows only, no code-signing, no Tiny Tapeout wrapper yet, no second FPGA target.

Repo + installer: [GitHub Release URL]

Bug reports, PRs, board-support requests all welcome.

---

## Draft 3 — Hacker News (Show HN)

**Title:** Show HN: ChipBlocks – Drag-and-drop visual chip design that builds real FPGA bitstreams

**Body:**

ChipBlocks is a free open-source desktop app for designing custom chips by wiring visual blocks. Drop an oscillator, connect it to a mixer and an output, hit Play and hear the design simulate through your speakers, then build an iCE40 FPGA bitstream that runs on a $30 dev board.

First alpha covers audio / synth / retro-game chips — eleven blocks (oscillator, mixer, ADSR, gate, low-pass, sample-and-hold, output, noise, constant). MIT-licensed, ships only permissively-licensed code (MIT / Apache 2.0 / BSD / ISC). Pipeline is Amaranth HDL → Verilog → Yosys → nextpnr-ice40 → icepack.

There's an AI consultant in a sidebar that can read the canvas and edit it for you (with a preview-confirm step). BYOK — you supply an Anthropic API key. The project never pays AI bills on behalf of users.

Counterintuitively, I'm not a chip engineer. I'm a non-technical solo developer working with Claude Code, and the whole point is to make chip design reachable for people in that position. So the alpha is rough where you'd expect: Windows installer only, unsigned (SmartScreen warns; "More info" → "Run anyway"), no MIDI, no polyphony, no Mac/Linux builds.

[GitHub Release URL]

Happy to take questions.

---

## Draft 4 — Hackaday tip line

**Subject:** Tip: Visual chip-design app for non-engineers (MIT, BYOK AI, real FPGA bitstreams)

**Body:**

Hi Hackaday team,

ChipBlocks is a free open-source desktop app that lets non-engineers design custom chips by dragging visual blocks. The first alpha covers audio / synth / retro-game chips — eleven blocks in a node-graph editor, simulated audio output, plus a real iCE40 FPGA bitstream you can flash to a $30 Lattice iCEstick. There's an optional AI consultant (bring your own Anthropic API key) that can read the canvas and wire things up with a preview-confirm step.

It's MIT-licensed, ships only permissively-licensed code, and the author is a non-technical solo developer building with Claude Code — eating their own dog food, since the project's whole point is making custom silicon reachable for people who don't know Verilog. v0.1.0-alpha just tagged.

Repo + installer: [GitHub Release URL]

Happy to answer questions or send screenshots.
