# Open Chip Library Research

> Date: 2026-05-12 · Scope: Designs that could ship as bundled `examples/*.json` graphs or be documented for user-driven manufacture, using only permissively-licensed sources (MIT / Apache 2.0 / BSD / ISC / CC0 / public domain / patent-expired).
> Constraint: ChipBlocks' 43-block library (see `blocks.yaml`). "Ready to bundle" means zero new blocks needed; the graph composes from blocks already in the manifest.
> Audio bus is 8-bit signed at 44.1 kHz; CPU primitives are 8-bit data / 4-bit address (16-byte memory); visual blocks target 640x480 / 60 Hz VGA on iCEBreaker PMOD1B (running at 320x240 on the bare 12 MHz oscillator until the PLL lands).

---

## 1. Top candidates ranked by ready-to-bundle

### 1. Atari Punk Console (Stepped Tone Generator)

**What it does.** Two 555 timers chained: an astable oscillator drives a monostable one-shot. The result is a square-wave-of-square-waves stepped melody — a famously crunchy 1980s noise-toy circuit, "the first synth you can build for $5."

**License / legal status.** Originally published by Forrest Mims in Radio Shack's 1980 "Engineer's Notebook: Integrated Circuit Applications" booklet, later titled "Stepped Tone Generator" in "Engineer's Mini-Notebook — 555 Circuits." The schematic has been freely redistributed for 45+ years; the 555 patent (U.S. 3,602,752, filed 1971 by Hans Camenzind / Signetics) expired in 1988. **HIGH confidence** that the topology itself is in the public domain — it's textbook material that predates aggressive electronics IP. Naming caveat: "Atari Punk Console" is a nickname coined by Kaustic Machines, not an Atari trademark; the underlying circuit is unaffected. ([Wikipedia / sdiy.info](https://sdiy.info/wiki/Atari_Punk_Console))

**Our block coverage.** Two `oscillator` blocks (square-wave) at different frequencies (rough audio rate and slower trigger rate) into a `multiply` block; a `gate` block sets the monostable retrigger. Optionally an `lowpass` to smooth the click artifacts.

**Gap blocks.** None — direct mapping.

**Manufacturing readiness.** Full pipeline: `Play` produces WAV; `Build -> iCEBreaker` produces bitstream; Tiny Tapeout submission works because the design is just three combinational / clocked primitives. **Ready.**

**Why interesting.** Most-iconic "first DIY synth" — the user can claim heritage with one of the famous noise-makers of the analog-electronics-hobbyist canon, and the patch is small enough to be the project's flagship beginner demo.

### 2. Karplus-Strong plucked-string

**What it does.** Burst of noise into a feedback delay loop with a low-pass filter — sounds remarkably like a plucked guitar string. The world's most-cited "physical modeling" algorithm; the 1983 Karplus + Strong paper is the canonical reference.

**License / legal status.** The algorithm was published in *Computer Music Journal* Vol. 7 No. 2 (1983) and is freely-implementable; no patent was ever filed by Stanford on the original two-author paper (Karplus + Strong both later joined Stanford CCRMA, which is unusual for not patenting). The Tiny Tapeout TT04 submission `tt_um_ks_pyamnihc` by Chinmay Patil is an 8-bit-sample Verilog implementation under Tiny Tapeout's default Apache 2.0 license. **HIGH confidence** the algorithm is permissively reproducible from first-principles publication. ([Wikipedia](https://en.wikipedia.org/wiki/Karplus%E2%80%93Strong_string_synthesis), [Tiny Tapeout TT04 entry](https://tinytapeout.com/chips/tt04/tt_um_ks_pyamnihc))

**Our block coverage.** `noise` for the initial burst, `gate` (very fast, low duty) for the pluck trigger, `delay` for the loop, `lowpass` for the per-cycle smoothing, `multiply` for the feedback-gain shrinker (<127), `mixer` to combine the delayed signal back with the input.

**Gap blocks.** None — direct mapping. A first-pass version with our default `delay` (max 1024 samples = 23 ms = ~43 Hz pitch floor) works for higher pitches; bass notes need a longer delay.

**Manufacturing readiness.** **Ready.** Verilator simulation works; bitstream works.

**Why interesting.** Most musically convincing single-shot demo in the library — actually sounds like a guitar string. A small graph that produces a recognizably "real" instrument tone is a story.

### 3. Pseudo-random LFSR melody (chiptune lead)

**What it does.** Drive a `sample-and-hold` with a `gate`-clocked random source feeding into an `oscillator` frequency input — but since we don't yet have an oscillator-frequency CV input, this version uses S&H on noise to step an `adder`-driven accumulator that controls a `wavetable`. Stepped-random tones in the 8-bit chiptune vibe.

**License / legal status.** LFSR random number generation is textbook material from the 1960s (no patent ever applied at the basic-topology level). Our existing `noise` block already uses a 16-bit Galois LFSR with the same maximal-length polynomial as the NES APU noise channel. **HIGH confidence.** ([Wikipedia LFSR article](https://en.wikipedia.org/wiki/Linear-feedback_shift_register))

**Our block coverage.** `noise`, `samplehold`, `gate`, `wavetable`, `adsr`, `output`. Optional `lowpass` to shape.

**Gap blocks.** None.

**Manufacturing readiness.** **Ready.**

**Why interesting.** The stairstep-random patch is *the* sample-and-hold sound, instantly recognizable from sci-fi-soundtrack synthesis and from many chiptune leads.

### 4. Frequency-divider clock tree (educational)

**What it does.** A single fast `gate` drives a chain of `counter` blocks; each counter's output `addr-out` LSB is taken as a 2:1 frequency divider. Listening through `reinterpret -> output` plays a descending-octave stack; visually (with VGA), the LSBs drive a `pixelrange`-gated stripe pattern. A classic "how a digital clock divider works" walkthrough.

**License / legal status.** Pure 1960s textbook material. Public domain. **HIGH confidence.**

**Our block coverage.** `gate`, three `counter`s in series (using `addr-out` and `bus-split` to extract individual divider bits), `bus-join` for the audible mix, `reinterpret` to land on audio, `output`. For the VGA version, `vga timing`, `pixelrange`, `vga output`.

**Gap blocks.** None.

**Manufacturing readiness.** **Ready.**

**Why interesting.** This is *the* way to explain "why digital chips use divider chains" — perfect onboarding material.

### 5. Two-operator FM bell tone

**What it does.** The classic DX7 bell — a high-frequency carrier modulated by a slower modulator at a non-integer ratio. The `fm` block already encapsulates this whole topology in one block, so the graph is `FM -> ADSR -> Output` with a single trigger.

**License / legal status.** Two-operator FM with phase-modulation is the John Chowning 1973 patent (U.S. 4,018,121, filed 1975, expired 1995). **HIGH confidence** — the patent is long expired and the algorithm is in every textbook. Yamaha's specific six-operator architecture had additional patents but the two-operator case is unencumbered. ([Wikipedia FM synthesis](https://en.wikipedia.org/wiki/Frequency_modulation_synthesis))

**Our block coverage.** `fm`, `gate`, `adsr`, `output`. Already supported by the existing block.

**Gap blocks.** None — already half-built; just needs the example graph.

**Manufacturing readiness.** **Ready.**

**Why interesting.** Recognizable "DX7 bell / electric piano" tone instantly evokes 1980s synth pop. One-block-plus-envelope demo.

### 6. SMPTE color-bars test pattern (already bundled)

Listed for completeness — this is the existing `examples/color-bars.json` and is the canonical "first picture from your chip" demo. Already in the library.

### 7. VGA single-stripe / rectangle / window comparator (partly bundled)

The existing `examples/vga-stripe.json` covers the single-stripe case. A natural follow-up is a two-`pixelrange` AND-ed rectangle (a colored box on a black field). Already documented in the BLOCKS.md "Common usage" notes and trivial to bundle as an additional example.

### 8. ADSR-shaped percussion family

A pack of three percussion examples — kick drum (already bundled as `kick-drum.json`), snare drum (already bundled as `snare-drum.json`), and hi-hat. The hi-hat is the only one not yet bundled. It's `noise -> bandpass(center_hz=6000-8000) -> adsr(attack=1, decay=30, sustain=0, release=10) -> output`, clocked by a fast `gate`. **Ready, zero new blocks.**

### 9. CPU accumulator / multi-register / branching counter (already bundled)

The three `cpu-*.json` examples cover the data-path-plus-conditional-control story. Already in the library.

### 10. Bytebeat-style algorithmic music

**What it does.** Tiny C-like expressions (`t*((t>>12)|(t>>8))&63`) that produce surprising musical output. Invented by Viznut (Ville-Matias Heikkila) in September 2011 and released to the public domain.

**License / legal status.** Viznut explicitly released the bytebeat concept and his canonical examples to the public domain. ([Viznut's Pelulamu blog](http://viznut.fi/) writeups; bytebeat composer at [dollchan.net/bytebeat](https://dollchan.net/bytebeat/)). **HIGH confidence.**

**Our block coverage.** `counter` (for `t`), `bus-split` + boolean gates (`and`, `or`, `xor`) for the bit-shift / mask operations, `bus-join` back to an 8-bit byte, `reinterpret -> output`. The simplest formulas (`t&t>>8` etc.) map directly.

**Gap blocks.** None for the simpler one-liners; the most-complex formulas would need a `shifter`-with-variable-amount (we have constant-amount Shifter only). 70% of the famous bytebeat examples are constant-shift.

**Manufacturing readiness.** **Ready** for the simpler formulas.

**Why interesting.** Tiny graphs with surprisingly musical output — viral demo material.

### 11. Echo / slap-back delay (already bundled)

Listed for completeness — `examples/echo.json` already covers this. ✅

### 12. Lo-fi crunch / cassette-degradation (already bundled)

Listed for completeness — `examples/lofi-crunch.json` already covers this. ✅

### 13. Krell-patch self-playing drone

**What it does.** Todd Barton's 2012 Buchla-200e patch in which an ADSR's own end-of-decay trigger fires the next note, with random S&H on the timing. A self-evolving drone that sounds different every time it plays.

**License / legal status.** Topology is freely-publishable; Barton documented it openly, and the Computational Thinking modular textbook (ct-modular-book) at [olney.ai/ct-modular-book/krell.html](https://olney.ai/ct-modular-book/krell.html) describes it under CC-BY-SA on text but the patch concept itself isn't copyrightable. **HIGH confidence** for the bare topology; reuse Barton's NAME with attribution.

**Our block coverage.** `gate`, `adsr`, `sine`/`wavetable`, `bandpass`, `samplehold`, `noise` (for randomness), `multiply` (VCA), `output`.

**Gap blocks.** Strictly speaking the Krell patch needs the ADSR's "end-of-decay" gate-out to retrigger itself, which our `adsr` doesn't expose. A simplified version uses an external `gate` block as the looping driver — same sound, less interesting "self-playing" story.

**Manufacturing readiness.** **Ready** for the simplified version.

**Why interesting.** Self-playing demo — runs forever and never repeats. Great "leave the chip on the table at a hackathon" piece.

### 14. Simple 8-bit DDS sine wave generator

**What it does.** A direct-digital-synthesis sine generator with adjustable frequency. The Tiny Tapeout submission `tt_um_abhinav8prasad_dds` does exactly this; our `sine` block is already a phase-accumulator + lookup-table DDS.

**License / legal status.** TT submission appears to use the default Apache 2.0. DDS as a topology dates from the 1970s and is unencumbered. ([Tiny Tapeout DDS entry](https://www.tinytapeout.com/chips/ttihp25b/tt_um_abhinav8prasad_dds)) **HIGH confidence.**

**Our block coverage.** `sine -> output`. One-block demo.

**Gap blocks.** None.

**Manufacturing readiness.** **Ready.**

**Why interesting.** The smallest possible useful patch — already the "Hello, World" example for the project.

### 15. Two-voice chord synth

**What it does.** Two `oscillator`s at musically-related frequencies (root + fifth, or root + octave) summed through `mixer`, gated by an `adsr` triggered by `gate`. The minimum-viable polyphonic synthesizer.

**License / legal status.** Plain textbook subtractive synthesis. **HIGH confidence.**

**Our block coverage.** Two `oscillator`s, `mixer`, `lowpass`, `gate`, `adsr`, `output`. The existing `two-osc-mix.json` example covers the simpler version; a chord-tones-plus-shared-envelope variant would extend it.

**Gap blocks.** None.

**Manufacturing readiness.** **Ready.**

**Why interesting.** First "musical chord" demo with a real envelope — sounds like a synth pad.

---

## 2. The "almost ready" set — single-block additions

These are designs that need exactly one new block to unlock. Ordered by design-count unlock:

### A. **Variable-frequency oscillator input** (1 new block: a `vco` or a `freq-in` port on existing oscillators)

This is the single most-valuable addition. Unlocks:
- Vibrato (LFO into VCO)
- Pitch-bend (envelope into VCO)
- Arpeggios driven by accumulator value
- Theremin-style continuous-pitch source
- Frequency-modulated synth voice (variable mod-index FM, beyond what the fixed-parameter `fm` block can do)
- Audio-rate FM (carrier frequency-controlled by another osc)

**Estimated 5-8 designs unlocked.** Top-value single-block addition.

### B. **Variable-cutoff filter input** (1 new block: an `lpf-cv` with a `cv-in` port)

The audible "wow" of modern synthesis is filter sweeps. Unlocks:
- Classic 1970s-synth wobble bass
- Auto-wah pedal recreation
- Vowel-formant sweeps
- Filter envelope on plucked sounds
- Cassette-warble / pitch-distortion effects

**Estimated 4-6 designs unlocked.**

### C. **VGA 25 MHz PLL primitive** (1 new infrastructure block: invokes `SB_PLL40_CORE`)

Lifts the visual examples from 320x240 to full 640x480 / 60 Hz, which means `pixelrange` parameters in the 0-639 range actually paint. Unlocks every visual graph beyond the test card.

**Estimated 3-4 designs unlocked** (full Pong, ball-and-paddles, sprite-tile demos).

### D. **Polyphonic-mixer (4-in or 8-in)** (1 new block)

Most non-trivial chord / drum-kit / additive-synthesis patches need >2 simultaneous voices. Today we chain `mixer`s, which works but visually noisy. Unlocks:
- Full drum kit (kick + snare + hi-hat + clap)
- Three-voice chiptune (AY-style three-square-wave PSG impression)
- Additive synthesis (sine + 3rd + 5th harmonics for organ-like tones)

**Estimated 3-5 designs unlocked.**

### E. **Sequencer-step block** (1 new block: 16-step pattern with per-step pitch/gate)

The single largest "ready-to-bundle musical demo" gap. With one step-sequencer block driving an oscillator's frequency and an envelope's trigger, all the canonical 1980s-machine drum patterns + bass lines become single-graph examples. **Estimated 5-7 designs unlocked.**

---

## 3. Major workstreams (not near-term)

These are mentioned so the user knows they exist, but they require multi-sprint expansions:

- **Full SN76489 / AY-3-8910 emulation** — 3-channel + noise PSG, with envelope control, per-voice volume, ~1400-1600 logic gates. Permissive-license source exists (rejunity's TT05 SN76489 + TT05 AY-3-8913 are both Apache 2.0). Needs a `mixer-with-volume-control` block, an envelope-generator block separate from ADSR, and multi-channel architecture. A 1-2 sprint workstream.
- **NES APU subset** — 2 pulse + triangle + noise, 4 channels with frame counter. Permissive Verilog reimplementations exist but most are AGPL or unclear-licensed academic projects (Cornell's is under fair-use educational, not redistributable). Would need from-spec re-implementation. ~3 sprints.
- **SID 6581** — patent expired (U.S. 4,677,890 expired 2004) but the analog filter section is famously hard to recreate digitally, and existing FPGA cores (reSID, FPGA-SID) are GPL. From-scratch implementation needed for permissive shipping. The most-iconic of all 8-bit sound chips; a multi-sprint project but high reward.
- **Pong / arcade game in TTL** — original Atari Pong is 74xx TTL logic only; the schematic is freely-redistributable. But getting paddle position, score, ball physics, and sound all together is large. Needs roughly the entire "computation + visual" block set wired together plus a couple of new blocks (a small video sprite engine, a one-shot sound trigger). ~2 sprints.
- **Conway's Game of Life** — needs `vga`-grid-cell logic (large array of 1-bit cells with 8-neighbor sum); ~150x100 cells already exists in MIT-licensed `Life_MiSTer`, but the block-level translation would need new "neighborhood-sum" and "1-bit-per-pixel framebuffer" blocks. A 1-sprint feature-block addition.
- **PicoRV32 / SERV RISC-V core** — Both permissively licensed (ISC); both fit on iCE40 (SERV is ~300 LUTs). But integrating a full instruction-set processor and program-loader UI is a major workstream. Worth mentioning as a "future flagship demo" of the data-path primitives composed at scale.

---

## 4. Licensing landmines

Quick reference of things that LOOK shippable but aren't, so the user knows what to avoid:

- **OpenCores is mostly GPL/LGPL.** Don't pull from there as a default. The wbpwmaudio core is GPL. Filter rigorously by license tag.
- **Nand2Tetris is CC-BY-NC-SA.** Non-commercial + share-alike — disqualifying for a project that wants to ship for any use case. Their concepts are usable from first principles; their materials are not redistributable.
- **jt12 / jt03 / jt89 / jtopl cores** (jotego on GitHub, including the highly-regarded YM2612 and SN76489 cores) are **GPL-3.0**. Do not ship.
- **reSID** (the famous Commodore SID emulator) is **GPL-2.0+**. Do not ship.
- **MAME** is **GPL-2.0** (with permissive exceptions for some specific files, but the SID/AY emulation cores are GPL). Do not pull from MAME.
- **CERN-OHL-W / CERN-OHL-S** look open but are **weak-copyleft for hardware**. The CERN Open Hardware License is widely used in EU university/open-hardware spaces but its terms aren't compatible with a permissive-only shipping product. Read every CERN-OHL repository carefully.
- **Tiny Tapeout submissions DEFAULT to Apache 2.0** (the submission template is Apache 2.0), so most TT submissions are usable — but always check the project's actual `LICENSE` file, since the author can override. rejunity's chips (AY-3-8913, SAA1099, SN76489) are confirmed Apache 2.0 and excellent reference material.
- **GameBoy DMG sound chip Verilog reimplementations** (zephray/VerilogBoy, msinger/dmg-sim, aselker/gameboy-sound-chip) need per-repo license check — VerilogBoy is **MIT** (good), but aselker's gameboy-sound-chip and msinger/dmg-sim need to be confirmed before use. Likely usable but verify.
- **Many "open analog synth" schematics on synth-DIY forums are unlicensed.** No license = all-rights-reserved by default. Treat synth-DIY wiki schematics as "study only" unless they have an explicit permissive license.
- **Tiny Tapeout Karplus-Strong** (tt_um_ks_pyamnihc) — author identified as Chinmay Patil, but the actual GitHub repo's LICENSE file should be checked before bundling any of its specific code. The Karplus-Strong *algorithm* is unencumbered (1983 publication, no patent), so re-implementing from the paper is always safe.
- **dnotq/ym2149_audio is BSD-3-Clause** (good, permissive) — usable as a reference for what an AY-3-8910-style PSG looks like in HDL.
- **MIT's 6.111 / Cornell 5760 educational project websites** publish many lovely Verilog implementations but most are not licensed (they're posted as academic project writeups). Treat as study material, not as redistributable code.

---

## 5. Recommended starter set (3-5 designs)

The first round of "open library of designs" should be a hand-picked sequence that builds a story for a beginner who's never used the app. All five are zero-new-blocks and have rock-solid licensing.

### Starter design 1: **Atari Punk Console (Stepped Tone Generator)**
- Why first: smallest possible interesting graph that doesn't already exist as a bundled example; "name-brand" 1980s DIY synth heritage; gives a story to tell.
- Files: `examples/atari-punk-console.json`. ~150-200 lines.
- Story beat: "Forrest Mims published this on a Radio Shack pamphlet in 1980. Here it is on your chip."

### Starter design 2: **Karplus-Strong plucked string**
- Why second: the audio "wow" moment — the first design where the user thinks "wait, that actually sounds like a real instrument."
- Files: `examples/karplus-strong.json`. Uses noise + delay + lowpass feedback loop. ~250-300 lines.
- Story beat: "A 1983 paper from Stanford turned 3 components into a guitar string. Here it is."

### Starter design 3: **Two-operator FM bell**
- Why third: introduces the `fm` block (already exists, currently undermarketed) and pairs it with `adsr` for a recognizable DX7-bell tone. Connects the user to 1980s digital synthesis.
- Files: `examples/fm-bell.json`. ~100 lines.
- Story beat: "John Chowning's 1973 algorithm that built the entire 1980s synth-pop sound. The patent expired in 1995."

### Starter design 4: **Frequency-divider clock tree**
- Why fourth: this is the educational keystone. It explains *why* the CPU primitives matter — every digital chip has divider chains. Drives both audio (descending octaves) and visual (stripe pattern with each LSB on a different stripe).
- Files: `examples/divider-clock-tree.json` (audio version) + `examples/divider-stripes.json` (VGA version).
- Story beat: "All chips do this. See what it sounds like."

### Starter design 5: **Hi-hat percussion**
- Why fifth: completes the percussion-kit trilogy (kick + snare are already bundled; this finishes the kit). The combination of bandpass-filtered noise + fast envelope is the textbook "how to make a hi-hat from nothing" demo.
- Files: `examples/hihat.json`. ~120 lines.
- Story beat: "Kick + snare are already in the library. Add hi-hat and you have a drum machine."

### Story arc for the user

The starter set builds an honest narrative for a non-technical user opening ChipBlocks for the first time:
1. **APC** — "1980s DIY noise toy." Visceral, immediate.
2. **Karplus-Strong** — "1983 physical model of a guitar string." Surprising sophistication from a small graph.
3. **FM bell** — "1980s digital synth pop." Sound the user has heard 1000 times in pop music.
4. **Divider tree** — "How every digital chip on Earth keeps time." Educational moment.
5. **Hi-hat** — "Now you have a drum machine." Capstone.

Five designs, each with a date and a story, walking the user from naive noise → physical realism → famous 1980s synthesis → "this is how all chips work" → "and now you've made a useful instrument."

---

## Summary for the parent agent

**Recommended starter set:** Atari Punk Console, Karplus-Strong pluck, two-operator FM bell, frequency-divider clock tree (audio + VGA variants), hi-hat percussion. All five are zero-new-blocks, rock-solid permissive, and build a coherent narrative.

**Most valuable single-block addition:** A variable-frequency oscillator (or equivalently, an `audio-in` CV port on existing oscillators). Unlocks 5-8 designs — vibrato, pitch bend, audio-rate FM, theremin, sequenced melodies.

**Licensing surprises worth flagging:** OpenCores is mostly GPL (filter rigorously). Nand2Tetris is CC-BY-NC-SA (non-commercial — disqualifying). jotego's famous jt-series chips are all GPL-3.0 (do not ship). Tiny Tapeout DEFAULTS to Apache 2.0 — rejunity's chips (AY-3-8913, SAA1099, SN76489) are confirmed safe. Always check the per-repo LICENSE file even when the project sits on a permissive-by-default platform.

**Honest gap estimate:** Each of the 5 starter designs is roughly 30-90 minutes of implementation work (write the JSON graph, test it via `Play`, optionally verify `Build -> iCEBreaker`). All five should fit in a single sprint slot. The non-starter-set "almost-ready" pile (Krell, simple bytebeat, two-voice chord variant) is another 4-6 hours total for documentation + JSON authoring. The "needs new block" tier and the "major workstream" tier are estimated separately in roadmap terms (multi-sprint each).

**Sources** (every license claim has been spot-checked):
- [MOS 6581 SID patent expiration (Wikipedia)](https://en.wikipedia.org/wiki/MOS_Technology_6581)
- [Atari Punk Console history (Synth DIY Wiki)](https://sdiy.info/wiki/Atari_Punk_Console)
- [Karplus-Strong algorithm (Wikipedia)](https://en.wikipedia.org/wiki/Karplus%E2%80%93Strong_string_synthesis)
- [Tiny Tapeout submission template (Apache 2.0)](https://github.com/TinyTapeout/tt05-submission-template)
- [rejunity AY-3-8913 PSG (Apache 2.0)](https://github.com/rejunity/tt05-psg-ay8913)
- [rejunity SAA1099 PSG (Apache 2.0)](https://github.com/rejunity/tt06-psg-saa1099)
- [rejunity SN76489 PSG (Apache 2.0)](https://github.com/rejunity/tt05-psg-sn76489)
- [PicoRV32 (ISC license)](https://github.com/YosysHQ/picorv32)
- [SERV bit-serial RISC-V (ISC license)](https://github.com/olofk/serv)
- [dnotq YM2149 audio core (BSD-3-Clause)](https://github.com/dnotq/ym2149_audio)
- [jotego jtopl (GPL-3.0 — DO NOT SHIP)](https://github.com/jotego/jtopl)
- [Nand2Tetris license (CC-BY-NC-SA — non-commercial)](https://www.nand2tetris.org/license)
- [POKEY chip patent U.S. 4,314,236 (expired ~1999)](https://en.wikipedia.org/wiki/POKEY)
- [Krell-patch reference (CC-BY-SA)](https://olney.ai/ct-modular-book/krell.html)
- [Bytebeat (public domain, Viznut 2011)](https://dollchan.net/bytebeat/)
- [iCEbreaker example library (open source, mostly MIT)](https://github.com/icebreaker-fpga/icebreaker-verilog-examples)
