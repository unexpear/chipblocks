# ChipBlocks v0.1.0-alpha

ChipBlocks is a free, open-source desktop app that lets non-technical people design custom chips by wiring visual blocks — drag an oscillator, connect it to a mixer and an output, hear it through your speakers, then build a real iCE40 FPGA bitstream for a $30 dev board, a TinyFPGA BX bitstream, a 1BitSquared iCEBreaker bitstream, or a Tiny Tapeout submission package that goes to fab and comes back as an ASIC. This first alpha is for hobbyist synth builders, FPGA tinkerers, and anyone curious about silicon who doesn't want to learn Verilog first.

## What's in the alpha

- Visual node-graph editor with drag-from-palette, port-directional wiring, per-block parameter editors. WCAG 2.1 AA accessibility (keyboard navigation, focus indicators, screen-reader labels, live regions for status messages).
- **42 blocks**: Oscillator (square), Triangle, Sawtooth, Sine, Wavetable (4 shapes), Noise, Constant, Mixer, ADSR Envelope, Gate, Low-Pass / High-Pass / Band-Pass Filters, Sample-and-Hold, FM voice, Multiply (ring-mod / VCA), Bitcrusher, Delay, Distortion (hard-clipping waveshaper), AND / OR / XOR / NOT / Counter (digital logic), VGA Timing / Color Bars / Pixel Range / Solid Color / VGA Output (visual — turns a graph into a video chip on the iCEBreaker FPGA's PMOD1B header), Bus Split / Bus Join / Reinterpret (cross-width and sign-class composition: fan an 8-bit bus out to 8 individual 1-bit signals or concat back, or rename data-u8 to audio-s8 so the CPU domain drives audio), Adder / Subtractor / Comparator / Mux / Register / RAM / Register File / ROM (CPU primitives — 8-bit data + 4-bit address; the data-path of a tiny accumulator machine, now with conditional control so programs can branch, and a Register File with independent read and write address ports so a single block exposes the canonical "fetch two operands, write one back" CPU shape used by real instruction sets), Output. Per-block reference in [BLOCKS.md](BLOCKS.md).
- AI consultant in a chat sidebar — BYOK Anthropic. Reads the canvas, suggests blocks, can add or wire blocks for you with a preview-and-confirm step before destructive edits.
- ▶ Play: simulates the design via Amaranth, produces a 16-bit 44.1 kHz WAV that the app plays.
- 🔧 Build for **Lattice iCEstick**, **TinyFPGA BX**, or **1BitSquared iCEBreaker**: runs the graph through Yosys, nextpnr-ice40, and icepack into a flashable `.bin`. Bundle includes a `BUILD.md` utilization report so you know if your design fits.
- 🚀 Build for **Tiny Tapeout**: emits a 14-file submission package in canonical `ttsky-verilog-template` layout with a working cocotb testbench. Drop into the GitHub template, push, submit at [app.tinytapeout.com](https://app.tinytapeout.com/) — your design becomes real silicon on the next SkyWater 130 or GlobalFoundries 180 shuttle.
- Project save / load (versioned JSON). **14 bundled examples** in the Load → Examples menu (Two oscillators mixed, ADSR-shaped pulse, Kick drum, Snare drum, Bass lead, Lo-fi pad, Stair-stepped arpeggio, Echo, Lo-fi crunch, Color bars on a VGA monitor, White vertical stripe on a VGA monitor, CPU accumulator, Branchable counter, Register File multi-port), Help → About, and a default starter graph on first launch so the canvas is never empty.

## Install

1. Download the installer for your OS from the release assets below — `ChipBlocks_0.1.0.exe` (Windows NSIS), the `.dmg` (macOS), or the `.AppImage` (Linux).
2. Run it and click through.
3. Launch ChipBlocks from the Start Menu / Applications / your AppImage.

Unsigned-installer warnings on first run: Windows will say "Windows protected your PC" → "More info" → "Run anyway"; macOS will say "ChipBlocks cannot be opened" → right-click → Open → Open. Linux AppImages aren't gated. The installers are unsigned because we don't have code-signing certificates yet — see [KNOWN-ISSUES.md](KNOWN-ISSUES.md) for context.

## Backend setup

▶ Play and 🔧 Build run a Python backend in WSL2 (on Windows) or natively (on Mac/Linux). Setup is in [backend/README.md](backend/README.md). For the FPGA paths you'll also need the [YosysHQ OSS CAD Suite](https://github.com/YosysHQ/oss-cad-suite-build/releases) at `~/oss-cad-suite/` (~2.4 GB; kept external since many users only want the simulator). Tiny Tapeout submissions don't need a local OSS CAD Suite — the cohort's pipeline runs OpenLane on Sky130 or GF180.

## Not in this release

- No polyphony, no MIDI input, no reverb or chorus blocks.
- No code-signed binaries (hence the SmartScreen / Gatekeeper warnings).
- No auto-update.

## Coming next

Full plan in [ROADMAP.md](ROADMAP.md). Highest-leverage Next items: MIDI + polyphony for the synth use case, more DSP blocks (chorus, distortion, allpass), additional FPGA targets (ECP5 via Trellis, Xilinx 7-Series via prjxray), and code-signing certificates to remove the unsigned-installer warnings.

## Help and discussion

[GitHub Discussions](https://github.com/unexpear/chipblocks/discussions) for questions, bug reports, or sharing what you build.

## License and credits

MIT. Ships only permissively-licensed code. Full attributions and policy in [CREDITS.md](CREDITS.md).
