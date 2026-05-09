# ChipBlocks block library

> **Last updated:** 2026-05-09 · Reference for the 24 blocks shipping in v0.1.0-alpha. The canonical implementation lives in [`backend/blocks/`](backend/blocks/) (Python + Amaranth HDL) and [`frontend/src/blocks/`](frontend/src/blocks/) (React + TypeScript node components). For how the renderer talks to the backend and how to add another block, see [ARCHITECTURE.md](ARCHITECTURE.md).

This document describes what each block does, what its inputs and outputs are, what its parameters mean, and roughly how it sounds. Blocks are 8-bit signed (–128..+127) at a 44.1 kHz sample rate. Audio handles carry signed 8-bit samples; gate / clock handles carry 1-bit signals. Edges are direction-checked by React Flow at edit time.

A note on parameter ranges: the React Flow node components enforce **musically sensible** ranges (e.g. an oscillator frequency is capped at 20–20 000 Hz). The Amaranth backends enforce only the **structurally necessary** lower bounds (frequency must be >= 1 Hz so the phase accumulator advances). Where the two differ, both are listed.

## Contents

### Sources

- [Oscillator (square)](#oscillator-square)
- [Triangle](#triangle)
- [Sawtooth](#sawtooth)
- [Sine](#sine)
- [Wavetable](#wavetable)
- [Noise](#noise)
- [Constant](#constant)

### Modulation and control

- [Gate](#gate)
- [ADSR envelope](#adsr-envelope)
- [Sample-and-hold](#sample-and-hold)
- [Multiply (ring modulator)](#multiply-ring-modulator)
- [FM voice](#fm-voice)

### Logic

- [AND](#and)
- [OR](#or)
- [XOR](#xor)
- [NOT](#not)
- [Counter](#counter)

### Filtering

- [Low-pass filter](#low-pass-filter)
- [High-pass filter](#high-pass-filter)
- [Band-pass filter](#band-pass-filter)

### Effects

- [Bitcrusher](#bitcrusher)
- [Delay](#delay)

### Mixing and routing

- [Mixer](#mixer)
- [Output](#output)

---

## Sources

### Oscillator (square)

Square-wave tone generator. Alternates between full-positive and full-negative every half period — the harshest and most harmonically rich of the four basic shapes. The default shape for "make a tone."

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `audio-out` | source | signed 8-bit audio | Square wave at `freq` Hz |

**Parameters**

| Name | Type | Range (frontend / backend) | Default | What it does |
|---|---|---|---|---|
| `freq` | integer Hz | 20–20 000 / >= 1 | 440 | Pitch of the square wave |

**Behavior.** A 16-bit phase accumulator advances by `step = 2^16 * freq / 44100` each clock cycle. The accumulator's high bit toggles at the configured frequency, giving an exact 50/50 duty cycle. Because the phase is 16-bit, frequencies that aren't integer divisors of the 44.1 kHz sample rate still play in tune — they just have small per-cycle period jitter that's inaudible at musical pitches.

**Common usage.** Wire `audio-out` straight into Output for the simplest possible "make a beep" patch, or feed it through a low-pass filter to soften the bright top end.

### Triangle

Triangle-wave source. Linearly ramps up and back down — much fewer high harmonics than a square wave, mellower and flute-like.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `audio-out` | source | signed 8-bit audio | Triangle wave at `freq` Hz |

**Parameters**

| Name | Type | Range (frontend / backend) | Default | What it does |
|---|---|---|---|---|
| `freq` | integer Hz | 20–20 000 / >= 1 | 440 | Pitch of the triangle wave |

**Behavior.** Same 16-bit phase-accumulator pattern as the Oscillator. The high 8 bits of the phase form a 0–255 ramp through one period; the first half of the ramp drives the output linearly from –128 up to +126, the second half drives it back down. The result is a symmetrical triangle.

**Common usage.** Stand-in for a "soft" oscillator — works well as the modulator side of an FM patch where a square would alias too aggressively.

### Sawtooth

Sawtooth-wave source. Ramps linearly from –128 up to +127, then snaps back to –128 at the start of each period. Brighter than a triangle, less coarse than a square — the classic synth-bass / lead sound.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `audio-out` | source | signed 8-bit audio | Sawtooth wave at `freq` Hz |

**Parameters**

| Name | Type | Range (frontend / backend) | Default | What it does |
|---|---|---|---|---|
| `freq` | integer Hz | 20–20 000 / >= 1 | 440 | Pitch of the sawtooth |

**Behavior.** Same 16-bit phase accumulator. The high 8 bits of the phase, reinterpreted as an unsigned 0–255 ramp, are mapped onto the signed –128..+127 range by subtracting 128. No edge smoothing, so the snap-back contains a lot of high-frequency energy — exactly what you want for a buzzy bass.

**Common usage.** Sawtooth into a low-pass filter is the canonical "subtractive synthesis" voice; modulating the cutoff with an ADSR gives the classic synth-pluck sound.

### Sine

Sine-wave source. The cleanest possible tone — pure fundamental, no harmonics. Useful as a sub-bass oscillator, a flute-like lead, or as the modulator in an FM patch.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `audio-out` | source | signed 8-bit audio | Sine wave at `freq` Hz |

**Parameters**

| Name | Type | Range (frontend / backend) | Default | What it does |
|---|---|---|---|---|
| `freq` | integer Hz | 20–20 000 / >= 1 | 440 | Pitch of the sine |

**Behavior.** 16-bit phase accumulator drives a 256-entry signed-8-bit lookup table. The table is precomputed at construction time from `math.sin`, so the hardware never runs trig at runtime — just an indexed table read. The 8-bit sample resolution audibly quantizes the sine at very low amplitudes, but at full scale it sounds clean.

**Common usage.** Pair with another sine an octave or fifth apart through a Mixer for chord drones, or use as a clean LFO into a Multiply for tremolo.

### Wavetable

A morphable single-cycle waveform source. Same phase accumulator + 256-entry lookup table as the Sine block, but with a `shape` parameter that picks between four preset tables — so you get four distinct timbres without needing four separate blocks.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `audio-out` | source | signed 8-bit audio | Selected shape at `freq` Hz |

**Parameters**

| Name | Type | Range (frontend / backend) | Default | What it does |
|---|---|---|---|---|
| `freq` | integer Hz | 20–20 000 / >= 1 | 440 | Pitch |
| `shape` | enum | `sine` \| `pulse_25` \| `ramp_up` \| `formant` | `sine` | Which lookup table to read |

**Shape table.**

| `shape` | Sound |
|---|---|
| `sine` | Same as the Sine block — pure fundamental |
| `pulse_25` | 25%-duty pulse: thinner and reedier than a 50% square |
| `ramp_up` | Same as the Sawtooth block |
| `formant` | A vowel-like timbre built from 1st + 2nd + 3rd harmonics in a fixed mix |

**Behavior.** Same 16-bit phase pattern as the other oscillators; the high 8 bits of the phase index a 256-entry signed-8-bit table that's selected at construction time. Switching `shape` rebuilds the synthesis at the next ▶ Play — there's no morphing during playback.

**Common usage.** Picking `formant` and pairing it with a slow Gate-driven ADSR is a quick path to vowel-like pad sounds without needing a separate formant filter.

### Noise

A pseudo-random 8-bit signed signal. Useful for snare drums, hi-hats, percussion textures, and as a noise source for sample-and-hold-style stepped modulation.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `audio-out` | source | signed 8-bit audio | New random sample each cycle |

**Parameters.** None.

**Behavior.** A 16-bit Galois LFSR (linear-feedback shift register — a small piece of hardware that produces a deterministic, repeating-but-very-long sequence of pseudo-random bits) with taps at bits 15, 13, 12, 10. The polynomial is maximal-length, so it cycles through all 65 535 nonzero states before repeating. The high 8 bits of the LFSR are reinterpreted as a signed sample, giving the full ±127 swing.

**Common usage.** Run noise through a Multiply with a fast-decay ADSR for snare-drum hits. Run it through a Sample-and-hold clocked by a slow Gate to get random-stepped melodic-ish modulation.

### Constant

Emits a fixed 8-bit signed value forever.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `audio-out` | source | signed 8-bit audio | Held at `value` |

**Parameters**

| Name | Type | Range (frontend / backend) | Default | What it does |
|---|---|---|---|---|
| `value` | integer | –128 to +127 / silently clamped to –128..+127 | 0 | The held output value |

**Behavior.** Combinational — no internal state. The output is wired directly to the literal `value` constant.

**Common usage.** Useful as a DC offset, a dummy "ground" input on a Mixer when you only have one source, an ADSR test stimulus (multiply by a constant +127 to see the envelope shape clearly), or a debugging probe.

---

## Modulation and control

### Gate

A 1-bit periodic pulse. Drives ADSR envelopes, sample-and-hold clocks, and anything else that wants a recurring trigger.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `gate-out` | source | 1-bit | High for `duty_pct`% of each period, low otherwise |

**Parameters**

| Name | Type | Range (frontend / backend) | Default | What it does |
|---|---|---|---|---|
| `rate_hz` | integer Hz | 1–1 000 / >= 1 | 4 | Pulses per second |
| `duty_pct` | integer % | 1–99 / 1–99 | 50 | Fraction of each period the gate is held high |

**Behavior.** A counter ticks once per sample. When it reaches `period - 1` (where `period = 44100 / rate_hz`), it wraps back to zero. The gate output is high while `count < period * duty_pct / 100`. Slow rates (1–20 Hz) drive musically-meaningful attack-decay-release cycles when wired to an ADSR.

**Common usage.** `Gate.gate-out -> ADSR.gate` is the standard pattern for getting a repeating note rhythm. Set `rate_hz` to a slow value (2–8 Hz) for synth-arpeggio territory.

### ADSR envelope

Attack / Decay / Sustain / Release amplitude shaper. On each rising edge of `gate`, the envelope ramps up to peak (Attack), drops down to a held level (Decay), holds there until `gate` falls (Sustain), then ramps back to silence (Release). Multiplied against the audio input.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `gate` | target | 1-bit | Rising edge triggers Attack; falling edge triggers Release |
| `audio-in` | target | signed 8-bit audio | The audio to be shaped |
| `audio-out` | source | signed 8-bit audio | `audio-in * envelope` |

**Parameters**

| Name | Type | Range (frontend / backend) | Default | What it does |
|---|---|---|---|---|
| `attack_ms` | integer ms | 1–5 000 / >= 1 | 10 | Time to ramp from silence up to peak |
| `decay_ms` | integer ms | 1–5 000 / >= 1 | 100 | Time to fall from peak down to sustain |
| `sustain_level` | integer | 0–127 / 0–127 | 80 | Held amplitude during Sustain |
| `release_ms` | integer ms | 1–5 000 / >= 1 | 200 | Time to ramp from sustain back to silence |

**Behavior.** A small five-state finite-state machine (IDLE → ATTACK → DECAY → SUSTAIN → RELEASE → IDLE) drives a 16-bit envelope accumulator. The high 8 bits of the accumulator are the amplitude scale 0–127 used as the multiplier. Step sizes are precomputed at construction so each phase takes the configured millisecond duration. The gate is edge-detected, so holding the gate high doesn't keep retriggering. While the envelope is in RELEASE, a new rising edge retriggers ATTACK from the current envelope level.

**Common usage.** `Oscillator -> ADSR(audio-in)` plus `Gate -> ADSR(gate)` plus `ADSR -> Output` is the smallest "playable note" patch. Short attack + short decay + zero sustain + short release gives a percussive pluck.

### Sample-and-hold

Captures the value at `audio-in` on each rising edge of `clock`, then holds that value at `audio-out` until the next rising edge. Output looks like a stair-step approximation of the input.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `audio-in` | target | signed 8-bit audio | Value to be sampled |
| `clock` | target | 1-bit | Rising edge captures a new sample |
| `audio-out` | source | signed 8-bit audio | Most-recently-sampled value |

**Parameters.** None.

**Behavior.** The clock is edge-detected so a held-high clock doesn't continually re-sample. On each rising edge, `audio-in` is registered into the output flop. Between edges, the output stays put.

**Common usage.** Feed Noise into `audio-in` and a slow Gate into `clock` for the classic random-stepped modulation source ("S&H pad" sound). Feed an Oscillator into `audio-in` with a slower clock to get a stair-stepped arpeggio.

### Multiply (ring modulator)

Combinational signed multiply: output is `(in_1 * in_2) >> 7`. Useful for ring modulation (multiplying two audio rates together for metallic, inharmonic timbres) and amplitude modulation (multiplying audio by a control envelope to vary loudness).

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `in-1` | target | signed 8-bit audio | First operand |
| `in-2` | target | signed 8-bit audio | Second operand |
| `audio-out` | source | signed 8-bit audio | `(in-1 * in-2) >> 7` |

**Parameters.** None.

**Behavior.** A signed 8 × signed 8 multiply produces a signed 16-bit intermediate (roughly ±16 129 for full-scale inputs). Right-shifting by 7 brings it back to signed 8-bit range. The operation is purely combinational, so there's no per-sample latency.

**Common usage.** Two oscillators at different frequencies into Multiply gives ring-modulator bell tones (the output contains the sum and difference of the input frequencies, no original tones). Oscillator + slow Sine into Multiply gives tremolo.

### FM voice

A self-contained two-operator FM voice. A modulator oscillator displaces a carrier oscillator's phase on every clock tick — the classic DX7-style frequency-modulation timbre. The output is taken as a square wave from the carrier's high bit, so the audible result is a square whose pitch wobbles at `modulator_freq` with depth set by `mod_depth`.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `audio-out` | source | signed 8-bit audio | FM-modulated square at `carrier_freq` |

**Parameters**

| Name | Type | Range (frontend / backend) | Default | What it does |
|---|---|---|---|---|
| `carrier_freq` | integer Hz | 20–20 000 / unbounded | 440 | Pitch of the carrier (the audible note) |
| `modulator_freq` | integer Hz | 20–20 000 / unbounded | 110 | How fast the carrier's pitch wobbles |
| `mod_depth` | integer | 0–127 / 0–127 | 64 | How wide the wobble swings |

**Behavior.** Two 16-bit phase accumulators run in parallel. The modulator advances by `mod_step = 2^16 * modulator_freq / 44100`. The carrier advances by `carrier_step + (modulator_phase[8:16] * mod_depth)` — the modulator's high 8 bits form the per-tick phase displacement added on top of the carrier's natural step. With `mod_depth = 0` the FM block degenerates to a plain square oscillator at `carrier_freq`.

**Common usage.** Carrier at the desired note pitch, modulator at a small integer ratio (2:1, 3:2, 5:4) gives bell, electric piano, and metallic tones. Modulator-much-greater-than-carrier gives noisy / metallic textures.

---

## Logic

### AND

Combinational 1-bit AND of two inputs. The simplest glue-logic primitive.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `in-1` | target | 1-bit | First operand |
| `in-2` | target | 1-bit | Second operand |
| `gate-out` | source | 1-bit | `in-1 & in-2` |

**Parameters.** None.

**Behavior.** Combinational — no internal state. The output is high only when both inputs are high.

**Common usage.** Combine two gate sources so an envelope only fires when both clocks are high — for example, a fast Gate AND-ed with a slow Gate gives a fast tick that stops between long beats.

### OR

Combinational 1-bit OR of two inputs.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `in-1` | target | 1-bit | First operand |
| `in-2` | target | 1-bit | Second operand |
| `gate-out` | source | 1-bit | `in-1 \| in-2` |

**Parameters.** None.

**Behavior.** Combinational — no internal state. The output is high whenever either input is high.

**Common usage.** Merge two gate sources so an envelope retriggers on either one — a regular tempo Gate OR-ed with a one-shot Gate gives "play on the beat, plus an extra hit on demand."

### XOR

Combinational 1-bit exclusive OR of two inputs.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `in-1` | target | 1-bit | First operand |
| `in-2` | target | 1-bit | Second operand |
| `gate-out` | source | 1-bit | `in-1 ^ in-2` |

**Parameters.** None.

**Behavior.** Combinational — no internal state. The output is high exactly when the inputs differ.

**Common usage.** XOR-ing a Gate with itself delayed by one cycle (using a Sample-and-hold or downstream NOT trick) gives a half-rate divider — the building block of frequency dividers and parity checkers.

### NOT

Combinational 1-bit inverter.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `gate-in` | target | 1-bit | Source signal |
| `gate-out` | source | 1-bit | `~gate-in` |

**Parameters.** None.

**Behavior.** Combinational — the output is the bit-flip of the input.

**Common usage.** Drive an envelope from the off-phase of a clock by passing a Gate through a NOT before wiring it to ADSR's `gate` input. Pairs with AND / OR to build the rest of the boolean primitives (`a NAND b = NOT(a AND b)`, etc.).

### Counter

Wrapping integer counter clocked by a 1-bit signal. Each rising edge of `clock` increments the count; when the count reaches `max_value` it wraps back to 0. The output exposes the count as a centred 8-bit signed sample so it can drive any audio-shaped target.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `clock` | target | 1-bit | Rising edge increments the count |
| `audio-out` | source | signed 8-bit audio | Current count minus 64 |

**Parameters**

| Name | Type | Range (frontend / backend) | Default | What it does |
|---|---|---|---|---|
| `max_value` | integer | 1–127 / 1–127 | 16 | Wrap point: counter cycles 0, 1, ..., max_value−1, then resets |

**Behavior.** The clock is edge-detected so a held-high clock doesn't continuously increment. Internally the counter is unsigned (0..max_value−1); the output subtracts 64 to map onto the signed −128..+127 audio bus, mirroring the same offset-by-half pattern used in the Sawtooth block.

**Common usage.** Drive a Counter with a slow Gate, run its `audio-out` into a Sample-and-hold's `audio-in`, and clock the S&H from the same Gate to build a stair-step sequencer. Pair with the boolean gates and a Sample-and-hold to build small state machines without leaving the canvas.

---

## Filtering

### Low-pass filter

Attenuates frequencies above `cutoff_hz`, lets lower frequencies through. This is a 1-pole IIR (infinite-impulse-response) filter — the simplest stable digital low-pass — using a single recursive averaging step.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `audio-in` | target | signed 8-bit audio | Source signal |
| `audio-out` | source | signed 8-bit audio | Smoothed signal |

**Parameters**

| Name | Type | Range (frontend / backend) | Default | What it does |
|---|---|---|---|---|
| `cutoff_hz` | integer Hz | 1–22 050 / >= 1 | 800 | The –3 dB corner: above this, content is increasingly attenuated |

**Behavior.** Implements `y[n] = (alpha * x[n] + (256 - alpha) * y[n-1]) >> 8`, where `alpha` is an 8-bit fixed-point scalar precomputed at construction time as `round(255 * (1 - exp(-2π * cutoff_hz / 44100)))`. Lower cutoff means a smaller `alpha`, which means the filter trusts its previous output more — heavier smoothing, more group delay (the signal arrives slightly late). 6 dB/octave roll-off (a "1-pole" / "single-pole" filter — gentle slope, not a brick-wall cutoff).

**Common usage.** The standard mellower-this-up tool. Stick one between a Sawtooth and Output to take the harsh top off. Modulate the cutoff by adding a Sample-and-hold or Multiply trick if you want filter sweeps (v0.1.0-alpha doesn't have a CV input on the filter — that's roadmap work).

### High-pass filter

Attenuates frequencies below `cutoff_hz`, lets higher frequencies through. The complement of the Low-pass: the math is `y = x - lowpass(x)`, so the two filters share a coefficient and tracking each other is automatic.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `audio-in` | target | signed 8-bit audio | Source signal |
| `audio-out` | source | signed 8-bit audio | High-pass-filtered signal |

**Parameters**

| Name | Type | Range (frontend / backend) | Default | What it does |
|---|---|---|---|---|
| `cutoff_hz` | integer Hz | 1–22 050 / >= 1 | 800 | The –3 dB corner: below this, content is increasingly attenuated |

**Behavior.** Internally runs the same 1-pole low-pass as the Low-pass block, then subtracts it from the input. The difference is saturated back to signed 8-bit range so a peak-to-peak input swing doesn't wrap around the audio bus. Same 6 dB/octave roll-off as the Low-pass.

**Common usage.** Removes DC offset and bass rumble. Setting a high cutoff (4 000+ Hz) leaves only the bright top end — useful for thin telephone-voice-style tones or for splitting a signal into low and high bands when paired with a matching Low-pass.

### Band-pass filter

Lets a frequency band centered on `center_hz` through, attenuates everything else. Bandwidth is fixed at one octave: the filter passes content from `center_hz / sqrt(2)` up to `center_hz * sqrt(2)`.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `audio-in` | target | signed 8-bit audio | Source signal |
| `audio-out` | source | signed 8-bit audio | Band-pass-filtered signal |

**Parameters**

| Name | Type | Range (frontend / backend) | Default | What it does |
|---|---|---|---|---|
| `center_hz` | integer Hz | 10–22 050 / >= 10 | 1 000 | Middle of the passband |

**Behavior.** A 1-pole high-pass at the lower edge feeding a 1-pole low-pass at the upper edge — i.e., a high-pass-then-low-pass cascade. Each stage is the same 1-pole IIR used in the Low-pass and High-pass blocks. A textbook state-variable band-pass would be tighter, but this implementation keeps the math identical to the other filters and is plenty for v0.1. The fixed 1-octave bandwidth was chosen so the block needs only one parameter — wide enough for telephone-voice / wah / formant-style sweeps without a second parameter.

**Common usage.** Feed Noise through a Band-pass at 1 000–3 000 Hz for a tuned-snare or hi-hat-ish percussion source. Several Band-passes in parallel at vowel formant frequencies give vowel-pad textures.

---

## Effects

### Bitcrusher

Reduces an 8-bit signal to a smaller effective bit depth by zeroing the lower bits. Classic lo-fi / retro-game crunch.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `audio-in` | target | signed 8-bit audio | Source signal |
| `audio-out` | source | signed 8-bit audio | Quantized signal |

**Parameters**

| Name | Type | Range (frontend / backend) | Default | What it does |
|---|---|---|---|---|
| `bits` | integer | 1–8 / 1–8 | 4 | Effective bit depth |

**Behavior.** A bit-mask `(-1 << (8 - bits)) & 0xFF` is precomputed at construction (e.g. `bits=4` gives mask `0xF0`, `bits=1` gives `0x80`, `bits=8` gives `0xFF`). The mask is AND-ed combinationally with the input — no internal state, no per-sample latency. At `bits=8` the block is a pass-through; at `bits=4–6` it's gentle bit reduction; at `bits=2–3` it's heavy crunch; at `bits=1` only the sign bit survives, so the output is a 1-bit comparator (square wave) regardless of input shape.

**Common usage.** Drop one between any oscillator and Output for instant 8-bit-NES vibe. Combine with a Delay for cassette-degradation textures.

### Delay

Fixed-length delay line. The output is the input shifted forward in time by `delay_samples` audio samples. At 44.1 kHz, 128 samples is about 2.9 ms (slap-back), 1 024 samples is about 23 ms.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `audio-in` | target | signed 8-bit audio | Source signal |
| `audio-out` | source | signed 8-bit audio | Source delayed by `delay_samples` cycles |

**Parameters**

| Name | Type | Range (frontend / backend) | Default | What it does |
|---|---|---|---|---|
| `delay_samples` | integer | 1–1 024 / 1–1 024 | 128 | Delay length in samples |

**Behavior.** A circular buffer in `amaranth.lib.memory.Memory` (block-RAM-backed when targeting iCE40 silicon). One pointer walks the buffer; on each cycle the asynchronously-read value (the slot `delay_samples` cycles old) becomes the output, then the current input synchronously overwrites that slot. 1 024 8-bit entries fit easily in a single iCE40 4 KB BRAM, which is why that's the cap. The buffer is zero-initialized, so the output is silent for the first `delay_samples` cycles after reset.

**Common usage.** Around 50 samples gives chorus thickening; 200–500 samples gives flange / slap-back. For an actual echo, loop the delay output back through a Multiply (by a constant <127 for feedback below unity) and a Mixer with the original — a small graph rather than a single block.

---

## Mixing and routing

### Mixer

Combines two 8-bit signed audio signals by averaging.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `in-1` | target | signed 8-bit audio | First source |
| `in-2` | target | signed 8-bit audio | Second source |
| `mix-out` | source | signed 8-bit audio | `(in-1 + in-2) / 2` |

**Parameters.** None.

**Behavior.** Combinational arithmetic right-shift on the sum keeps the result inside signed 8-bit range without clipping. (A direct sum of two int8 values would overflow into a 9-bit result; halving makes the operation lossless except for the bottom bit of each input.) For more than two sources, chain Mixers — e.g. a graph with three oscillators uses two Mixers feeding a third.

**Common usage.** Two oscillators detuned a few hertz apart through a Mixer gives chorus / "fat" oscillator sounds. Audio + sub-octave sine through a Mixer gives bass weight.

### Output

The audio sink. The simulation harness reads samples from the Output block's `audio-in` to produce the WAV that ▶ Play sends to your speakers, and the FPGA / Tiny Tapeout build paths read the same signal as the audible output of the synthesized chip.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `audio-in` | target | signed 8-bit audio | The signal that gets played / sent to the audio pin |

**Parameters.** None.

**Behavior.** No internal logic. The Output block is a marker that says "capture this signal as the audio output." Every working graph needs exactly one Output. Multiple Outputs in a graph aren't supported in v0.1.0-alpha — only the first one found is captured.

**Common usage.** The destination of every graph. The shortest possible useful patch is `Oscillator -> Output`.

---

## Adding a new block

This document is a reference, not a how-to. The file-by-file walkthrough for adding a 20th block lives in [ARCHITECTURE.md](ARCHITECTURE.md) under "Adding a new block" — eight files to touch, plus tests on both sides.
