<!-- DRAFT for Hackaday / Hackster.io submission. Delete after submission. -->

# ChipBlocks: Drag Blocks, Hear the Chip, Get a Real iCE40 Bitstream — or Send the Same Graph to Tiny Tapeout

Designing a custom chip currently costs $50K and a CS degree. [ChipBlocks](https://github.com/unexpear/chipblocks) — a free, open-source desktop app — lets you drag oscillators, envelopes, and filters onto a canvas, wire them up, click Play to hear the design, then pick one of three real-silicon outputs: a flashable `.bin` for a $30 Lattice iCEstick, a bitstream for the TinyFPGA BX, or a Tiny Tapeout submission package that becomes an actual ASIC on the next SkyWater 130nm or GlobalFoundries 180nm shuttle. The first public alpha is out now. It runs the same Yosys + nextpnr-ice40 + icepack pipeline that the open-FPGA crowd has been quietly perfecting for a decade — just behind a node-graph editor a non-engineer can actually use.

## The bottleneck isn't manufacturing

If you want a custom chip today, you have three options. Pay Cadence or Synopsys $50K to $1M per seat for tooling, hire a chip-design consultancy at $50K-$2M for a project, or bend your design around an off-the-shelf MCU that's 100x over-spec'd for what you actually need. Free academic alternatives — Yosys, Verilator, LiteX, OpenLane — are powerful, but they all assume you already know how to write Verilog and read a synthesis report.

Mature-node fabs (130nm and up) and FPGA dev boards have plenty of capacity. Tiny Tapeout will literally put your design on real silicon for around $300. The bottleneck for the long tail of inventors, makers, artists, and small hardware shops isn't fab capacity — it's the EDA toolchain and the years of training required to drive it. There's no tool that lets a non-technical person turn "I need a chip that does X" into a fabricable design.

That gap is what ChipBlocks targets. Not as a Cadence-killer for production SoCs at advanced nodes — that's not the point. It's for the person who wants a custom synth voice, a glue-logic chip for their product, or a retro-game video chip, and currently has no path at all.

## What the alpha actually does

The editor is React Flow on top of Electron, with a side palette of 19 audio blocks: square / triangle / sawtooth / sine oscillators plus a 4-shape wavetable, noise, constant, mixer, ADSR envelope, gate, sample-and-hold, multiply (ring modulator), FM voice, low-pass / high-pass / band-pass filters, bitcrusher, delay, output. Each block is a parameterized HDL module under the hood; the visual graph is just a friendly view of an Amaranth design. There's an AI consultant in a chat sidebar (BYOK Anthropic) that can read the canvas, suggest blocks, and even add or wire them for you, with a preview-and-confirm step before destructive edits.

Two big buttons live in the toolbar. Click ▶ Play and the Python backend translates the graph to Amaranth, simulates it, and hands the renderer a 16-bit 44.1 kHz WAV that plays through your speakers. Click 🔧 Build and a dropdown picks the silicon target:

- **Lattice iCEstick** — Verilog → Yosys → nextpnr-ice40 → icepack. About 30–60 seconds later, a zip with the flashable `.bin` for the $30 USB dev board.
- **TinyFPGA BX** — same flow targeting the iCE40LP-8K (USB-native, ~5x the LUTs of the iCEstick).
- **Tiny Tapeout** — emits a 14-file submission package in the canonical `ttsky-verilog-template` layout (src/, test/, docs/, info.yaml validated against `tt-support-tools/project_info.py`, plus a working cocotb testbench). Drop into the GitHub template, push, submit at [app.tinytapeout.com](https://app.tinytapeout.com/). Their flow runs OpenLane on Sky130 or GF180 and ships you a real ASIC chip months later.

## Worked example: a kick drum, in about a minute

Drag four blocks from the palette: **Gate**, **Sine** (set to 60 Hz), **ADSR**, **Output**. Wire them up:

- `Gate.gate-out` → `ADSR.gate`
- `Sine.audio-out` → `ADSR.audio-in`
- `ADSR.audio-out` → `Output.audio-in`

Open the ADSR's parameter panel and dial in the punch: attack 1 ms, decay 80 ms, sustain 0, release 0. Click ▶ Play. You'll hear the canonical thump-thump-thump of a sine kick drum, retriggered at whatever the Gate's rate is set to.

Now click 🔧 Build for FPGA. About thirty seconds later, a download fires: `chipblocks-fpga.zip`, around 5 KB on the wire. Inside:

- `chipblocks.bin` — the 32 KB iCE40 bitstream
- `chipblocks.v` — the Verilog source the graph generated, for transparency
- `chipblocks.pcf` — the iCEstick pin-constraint file
- `BUILD.md` — auto-generated build report (utilization, timing, the last 2 KB of each tool's stdout)
- `FLASH.md` — `iceprog chipblocks.bin` instructions plus a wiring diagram

Plug an iCEstick into USB. Run `iceprog chipblocks.bin`. Wire pin B1 through a 1 kΩ resistor and a 100 nF cap (the cheapest possible RC low-pass to filter out the PWM carrier) into a small speaker. Power-cycle the board. Your kick drum is now real silicon — Yosys took the Verilog, nextpnr packed the design into the iCE40HX-1k's 1280 LUTs, icepack spat out the binary. The same `.bin` pattern works for any graph you can build on the canvas.

## Under the hood

The stack leans hard on existing open-source work, all permissively licensed. The editor is [React Flow](https://reactflow.dev) (MIT) on Electron + Vite. The HDL backbone is [Amaranth](https://github.com/amaranth-lang/amaranth) (BSD-2) — `amaranth.back.verilog.convert()` does the heavy lifting from elaborated graph to Verilog. Synthesis, place-and-route, and bitstream packing are [Yosys](https://yosyshq.net/yosys/), [nextpnr-ice40](https://github.com/YosysHQ/nextpnr), and [icepack](https://github.com/YosysHQ/icestorm) from YosysHQ's [OSS CAD Suite](https://github.com/YosysHQ/oss-cad-suite-build) (all ISC). The AI sidebar uses the official [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript) (MIT). Everything in the shipped product is MIT / Apache-2.0 / BSD / ISC / PSF — no GPL, no AGPL, no LGPL bundled. Copyleft tools we considered and dropped (Icarus Verilog, GTKWave) are documented in [CREDITS.md](CREDITS.md). Future monetization stays on the table without a re-licensing fight.

## The AI consultant, honestly

The novel part isn't "an LLM in a hardware app" — it's that the consultant knows ChipBlocks' block library specifically, can read the graph state, and can call tools that mutate the canvas: add a node, wire two ports, tune a parameter. Ask it "I want a snare drum" and it can drop a Noise block, an ADSR, an Output, and wire them — with a preview dialog showing exactly what's about to change before it touches anything. Bring your own Anthropic key; nothing leaves your machine except the model calls, and there's no SaaS layer. It's a useful collaborator, not a magic wand — fancy multi-block designs still benefit from a human reviewing the result. But for "what block do I need for X" or "wire this up for me," it shaves real friction off the empty-canvas problem.

## Honest scope

This is an alpha and looks like one. Cross-platform CI builds Windows NSIS, Mac DMG, and Linux AppImage on tag push, but all three are unsigned for the alpha (SmartScreen / Gatekeeper will warn the first time — click "More info → Run anyway"). Audio output is 8-bit signed at 44.1 kHz; FPGA audio comes out as 1-bit PWM through an external RC filter. No MIDI input yet. No polyphony. No reverb or chorus blocks (reverb is BRAM-bound on the iCE40HX-1k, so it's waiting on a bigger FPGA target). The Python backend runs in WSL2 on Windows — that's a real install hurdle, and we're not pretending otherwise.

## What's next

MIDI input + polyphony are the highest-leverage next items — without them, the synth use case stops at "interesting demo." Beyond that: more DSP blocks (chorus, distortion, allpass), additional FPGA targets (ECP5 via Trellis, Xilinx 7-Series via prjxray), and code-signing certificates to remove the unsigned-installer warnings. Full plan in [ROADMAP.md](https://github.com/unexpear/chipblocks/blob/master/ROADMAP.md).

## Try it

Grab the installer for your OS from the [v0.1.0-alpha.1 GitHub Release](https://github.com/unexpear/chipblocks/releases/tag/v0.1.0-alpha.1) — Windows NSIS, macOS DMG, and Linux AppImage are all attached. Discussions are open at [github.com/unexpear/chipblocks/discussions](https://github.com/unexpear/chipblocks/discussions) — bug reports, questions, "look what I built" posts all welcome. The AI consultant is **bring-your-own-key** (Anthropic); there's no hosted inference, the project never pays AI bills on your behalf, and your designs never leave your machine except for the round-trips you make to Anthropic. If that's a deal-breaker, the Play and Build paths work fully without it — the AI is an assistant, not a dependency.

## Credits and sign-off

Built by a non-technical solo dev with [Claude Code](https://claude.com/claude-code) as a pair-programmer, on a "fine taking time" cadence. MIT licensed. The whole point is to make custom chip design accessible to people who currently have no path in — eating our own dog food. Repo and full docs at [github.com/unexpear/chipblocks](https://github.com/unexpear/chipblocks). PRs and issues welcome; CLA in the repo.

If you build something with it, or it breaks in an interesting way, we'd love to hear about it.
