# ChipBlocks block library

> **Last updated:** 2026-05-10 · Reference for the 40 blocks shipping in v0.1.0-alpha. The canonical implementation lives in [`backend/blocks/`](backend/blocks/) (Python + Amaranth HDL) and [`frontend/src/blocks/`](frontend/src/blocks/) (React + TypeScript node components). For how the renderer talks to the backend and how to add another block, see [ARCHITECTURE.md](ARCHITECTURE.md).

This document describes what each block does, what its inputs and outputs are, what its parameters mean, and roughly how it sounds (or looks). Audio blocks are 8-bit signed (–128..+127) at a 44.1 kHz sample rate. Audio handles carry signed 8-bit samples; gate / clock handles carry 1-bit signals; visual handles are short single-token names (`r`, `g`, `b`, `hsync`, `vsync`, `visible`, `x`, `y`) following the convention used in every open-source VGA core. Edges are direction-checked by React Flow at edit time.

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
- [Distortion](#distortion)

### Visual

- [VGA Timing](#vga-timing)
- [Color Bars](#color-bars)
- [Pixel Range](#pixel-range)
- [Solid Color](#solid-color)
- [VGA Output](#vga-output)

### Computation

- [Adder](#adder)
- [Subtractor](#subtractor)
- [Comparator](#comparator)
- [Mux](#mux)
- [Register](#register)
- [RAM](#ram)
- [ROM](#rom)

### Bus

- [Bus Split](#bus-split)
- [Bus Join](#bus-join)
- [Reinterpret](#reinterpret)

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

### Byte Constant

Emits a fixed 8-bit unsigned value forever. The CPU-domain counterpart to Constant — same combinational always-emit behaviour, but the output is `data-u8` (0..255) instead of `audio-s8` (-128..+127). Useful as a literal in CPU graphs: an `Adder.in-b` for "add a constant 1", a `Mux.in-a` for a fixed branch destination, or a `RAM.data-in` for a hard-wired write value.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `data-out` | source | 8-bit unsigned data | Held at `value` |

**Parameters**

| Name | Type | Range (frontend / backend) | Default | What it does |
|---|---|---|---|---|
| `value` | integer | 0 to 255 / silently clamped to 0..255 | 0 | The held output value |

**Behavior.** Combinational — no internal state. The output is wired directly to the literal `value` constant. Out-of-range constructor values are silently clamped (mirrors Constant's behavior).

**Common usage.** Hard-wired CPU literals — `ByteConstant(1) → Adder.in-b` for "increment by 1 per cycle", `ByteConstant(0) → RAM.data-in` paired with a `write-enable` pulse to clear a memory cell, or `ByteConstant(targetValue) → Comparator.in-b` for a branch-when-equal test.

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

Wrapping integer counter clocked by a 1-bit signal. Each rising edge of `clock` increments the count; when the count reaches `max_value` it wraps back to 0. Two outputs: an audio-shaped `audio-out` (count − 64, mapped onto the signed audio bus) and a raw `addr-out` (low 4 bits of the count, as an unsigned address bus) so the Counter can drive ROM or RAM addresses directly.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `clock` | target | 1-bit | Rising edge increments the count |
| `audio-out` | source | signed 8-bit audio | Current count minus 64 |
| `addr-out` | source | 4-bit unsigned address | Low 4 bits of the raw count — feeds ROM.addr / RAM.addr |

**Parameters**

| Name | Type | Range (frontend / backend) | Default | What it does |
|---|---|---|---|---|
| `max_value` | integer | 1–127 / 1–127 | 16 | Wrap point: counter cycles 0, 1, ..., max_value−1, then resets |

**Behavior.** The clock is edge-detected so a held-high clock doesn't continuously increment. Internally the counter is unsigned (0..max_value−1); `audio-out` subtracts 64 to map onto the signed −128..+127 audio bus (mirroring the offset-by-half pattern used in the Sawtooth block), and `addr-out` is a straight bit-slice of the unsigned count — when `max_value ≤ 16` it covers the full 0..15 range a 4-bit address bus encodes.

**Common usage.** Two patterns:

- *Stair-step sequencer:* Counter.audio-out → Sample-and-hold.audio-in (clocked by the same Gate that drives Counter.clock) → Output, for a quantized note sequence on the audio bus.
- *Program-counter for the CPU primitives:* Counter.addr-out → ROM.addr or → RAM.addr, walking the 16-entry memory one cell per clock pulse. This is the canonical way to wire a "program counter" in the Sprint 17 CPU primitive set.

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

### Distortion

Hard-clipping waveshaper. Saturates the input to ±`threshold` and rescales the result to fill the ±127 range, so the output stays loud — that's what gives overdrive its characteristic "all the way to the rails" energy. Classic guitar / synth-amp tone.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `audio-in` | target | signed 8-bit audio | Source signal |
| `audio-out` | source | signed 8-bit audio | Hard-clipped + rescaled signal |

**Parameters**

| Name | Type | Range (frontend / backend) | Default | What it does |
|---|---|---|---|---|
| `threshold` | integer | 1–127 / 1–127 | 32 | Clip point. Smaller = more clipping; at 127 the block is effectively pass-through |

**Behavior.** Combinational. The input is saturated to `[-threshold, +threshold]`, then multiplied by 127 and divided by `threshold` so the result spans the full signed-8-bit range. Both operations synthesise into a small fixed-coefficient unit on iCE40 — no per-sample latency, no internal state. At `threshold = 4` the output is essentially a square wave regardless of input shape; at `threshold = 64` the clipping is gentler and you can still hear the original shape underneath.

**Common usage.** Drop one between any oscillator and Output for instant overdriven-amp tone. `Sawtooth -> Distortion(threshold=16) -> Lowpass(cutoff_hz=2000) -> Output` gives the canonical "saw lead through a guitar amp" sound — clip it, then take the harshest top off with the low-pass.

---

## Visual

The three visual blocks turn ChipBlocks from "audio-only" into "audio or video." They drive a VGA monitor through the iCEBreaker FPGA's PMOD1B socket; the audio ▶ Play path doesn't render visuals — visual graphs need 🔧 Build → iCEBreaker and a flashed bitstream to produce a picture. A graph with a VGA Output but no audio Output fails ▶ Play with a friendly hint pointing to the build button.

The "first visual chip" demo (bundled as `examples/color-bars.json`) is VGA Timing → (visible / x → Color Bars) → Color Bars → VGA Output. Flash to an iCEBreaker, plug a VGA-PMOD into PMOD1B, attach a monitor, and you see eight vertical SMPTE color bars.

**iCEBreaker pin mapping (PMOD1B).** Per [`amaranth_boards/icebreaker.py`](https://github.com/amaranth-lang/amaranth-boards/blob/main/amaranth_boards/icebreaker.py)'s PMOD1B connector string `"43 38 34 31 - - 42 36 32 28 - -"` and the standard 1BitSquared / Digilent VGA-PMOD signal-to-pin convention:

| VGA signal | PMOD pin | Package pin |
|---|---|---|
| R0      | PMOD1B pin 1 | 43 |
| G0      | PMOD1B pin 2 | 38 |
| B0      | PMOD1B pin 3 | 34 |
| HSYNC   | PMOD1B pin 4 | 31 |
| VSYNC   | PMOD1B pin 7 | 42 |

**Resolution.** The VGA Timing block's counters are wired for the canonical 640×480 / 60 Hz raster (800 × 525 ticks per frame). v0.1 drives those counters directly from the iCEBreaker's 12 MHz oscillator without a PLL, which produces a 320×240 / 60 Hz mode at the same H/V cadence — still a perfectly valid VGA mode that virtually every monitor accepts. The full 640×480 raster needs a 25 MHz pixel clock from an SB_PLL40_CORE primitive; that's deferred so v0.1 can ship a known-working visual story now.

### VGA Timing

Generates standard VGA timing from the implicit pixel clock. The five outputs are the canonical signals every VGA pipeline needs.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `hsync` | source | 1-bit | Horizontal sync, active LOW (high during the visible / porch intervals, low during the 96-tick sync window) |
| `vsync` | source | 1-bit | Vertical sync, active LOW |
| `visible` | source | 1-bit | High during the 640×480 active area, low during all blanking and sync intervals |
| `x` | source | 10-bit unsigned | Pixel column 0..639 while `visible` is high (porch / sync values elsewhere — downstream blocks gate on `visible`) |
| `y` | source | 10-bit unsigned | Pixel row 0..479 while `visible` is high |

**Parameters.** None.

**Behavior.** Two counters: a horizontal counter walks 0..H_TOTAL−1 (800), and on each H wrap a vertical counter advances 0..V_TOTAL−1 (525). The `visible` output is `(h < 640) & (v < 480)`. Sync polarities are active-low — that's the VESA-DMT standard for 640×480 / 60 Hz.

**Common usage.** The leftmost block in every visual graph: feed `x` and `visible` into a pixel-generator block (Color Bars in v0.1) and route `hsync` / `vsync` straight through to VGA Output's matching inputs.

### Color Bars

8-vertical-stripe SMPTE color-bar test pattern — the canonical "is the chip alive?" image. Combinational: looks at the high three bits of `x` and emits a 1-bit-per-channel color from a small lookup.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `x` | target | 10-bit unsigned | Pixel column from VGA Timing |
| `visible` | target | 1-bit | When low, all channels are forced to 0 |
| `r` | source | 1-bit | Red channel |
| `g` | source | 1-bit | Green channel |
| `b` | source | 1-bit | Blue channel |

**Parameters.** None.

**Behavior.** Bits `[6:9]` of `x` (i.e. `x / 64`) form the bar index 0..7. We use 64-pixel-wide bars rather than the strict 1/8-of-640 = 80-pixel bars so the index falls out as a free bit-slice — cheaper on the iCE40 than a divide-by-80 ladder, and 8 × 64 = 512 pixels comfortably fills the 320-pixel active area v0.1 ships in 12 MHz / 320×240 mode. The bar palette is the standard SMPTE NTSC test pattern, left-to-right: white, yellow, cyan, green, magenta, red, blue, black. When `visible` is low (during VGA blanking / sync), all three channels are forced to 0 — that's required by VGA: any non-zero color signal during sync confuses the monitor's HSYNC/VSYNC separator.

**Common usage.** Pair it with VGA Timing for the canonical "first picture on a monitor" demo. Replacing Color Bars with a future user-built pixel-generator (sprite tiles, character ROMs, framebuffer reads) keeps the rest of the pipeline unchanged.

### Pixel Range

A 1-bit window comparator: emits high when the input pixel coordinate falls inside `[start, end]` and low otherwise. The foundation for drawing rectangles, vertical / horizontal stripes, and frames on a VGA monitor.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `pixel` | target | 10-bit unsigned | The x or y coordinate from VGA Timing |
| `inside` | source | 1-bit | High when `start <= pixel <= end` |

**Parameters**

| Name | Type | Range (frontend / backend) | Default | What it does |
|---|---|---|---|---|
| `start` | integer | 0–639 / 0–639 | 100 | Lower bound of the in-window range (inclusive) |
| `end` | integer | 0–639 / 0–639 | 200 | Upper bound of the in-window range (inclusive) |

**Resolution caveat.** v0.1's iCEBreaker path runs at 320×240 / 60 Hz on the bare 12 MHz oscillator. The `start` / `end` parameters cover the full 0–639 range used by the underlying 640×480 raster, so values above 320 (for x) or 240 (for y) are valid in the timing but won't paint anywhere visible until the 25 MHz / 640×480 path lands (deferred — needs an `SB_PLL40_CORE` primitive).

**Behavior.** Combinational. The `inside` output is `(pixel >= start) & (pixel <= end)`, both bounds inclusive. No internal state, no per-sample latency.

**Common usage.** `VGA Timing.x -> PixelRange.pixel`, then `PixelRange.inside -> VGA Output.r/g/b` (wire to all three for a white stripe, or to a single channel for a colored stripe) draws a vertical band. To draw a rectangle, use TWO PixelRange instances — one fed by `x`, one fed by `y` — AND-ed together (`AND.in-1 / AND.in-2 -> AND.gate-out -> VGA Output`). Bundle file: `examples/vga-stripe.json`.

### Solid Color

A constant 1-bit-per-channel RGB source. Lets you wire a fixed color into VGA Output without composing logic gates by hand. The 8 named colors match the SMPTE palette the Color Bars block produces.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `r` | source | 1-bit | Red channel constant |
| `g` | source | 1-bit | Green channel constant |
| `b` | source | 1-bit | Blue channel constant |

**Parameters**

| Name | Type | Range (frontend / backend) | Default | What it does |
|---|---|---|---|---|
| `color` | enum | `black` \| `red` \| `green` \| `blue` \| `yellow` \| `cyan` \| `magenta` \| `white` | `white` | Picks the fixed color |

**Behavior.** Combinational. The enum is mapped at construction time to literal 1-bit constants on each of the three output channels — the elaborated hardware is just three tied wires. No internal state.

**Common usage.** Wire `r` / `g` / `b` straight into VGA Output for a single-color screen. v0.1 has no visual mixer, so a "blue background with a red rectangle" patch needs a future block — for now, Solid Color is most useful as the standalone background for "is the chip alive?" smoke tests, or as a constant source for one of the three channels when another block (PixelRange, Color Bars) drives the others.

### VGA Output

The visual sink. Five inputs (R, G, B, HSYNC, VSYNC) routed to physical FPGA pins on the iCEBreaker's PMOD1B socket.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `r` | target | 1-bit | Red channel |
| `g` | target | 1-bit | Green channel |
| `b` | target | 1-bit | Blue channel |
| `hsync` | target | 1-bit | Horizontal sync |
| `vsync` | target | 1-bit | Vertical sync |

**Parameters.** None.

**Behavior.** No internal logic. The block is a marker that says "route these five 1-bit signals to the VGA pins." `build.py` looks for the presence of a VGA Output node and, when targeting the iCEBreaker, generates extra `set_io` lines in the .pcf binding each signal to its physical PMOD1B pad. The audio ▶ Play path doesn't render visuals: VGA Output blocks elaborate but contribute nothing to the WAV; a graph with VGA Output but no audio Output fails Play with a friendly "🔧 Build → iCEBreaker" hint.

**Common usage.** The destination of every visual graph. Mirror the audio Output's role: the shortest possible useful visual patch is VGA Timing → Color Bars → VGA Output (with the obvious wiring on `x` / `visible` / `hsync` / `vsync`).

---

## Computation

The seven CPU primitives — Adder, Subtractor, Comparator, Mux, Register, RAM, ROM — make up a data-path with conditional control. They work on 8-bit unsigned data (`data-u8`) and 4-bit unsigned addresses (`addr-u4`), so they compose with each other and with Counter's `addr-out` port. To drive audio from the CPU domain, route the output through the [Reinterpret](#reinterpret) block (in the [Bus](#bus) section): same 8 bits on the wire, sign reinterpreted from unsigned to signed.

v0.1 ships 8-bit data + 4-bit address (16-byte memory). The widths are chosen so the design fits cleanly on a single iCE40 BRAM and the visual canvas stays uncluttered. ADR-002 documents the choice and the still-deferred primitives (Shifter, Register File, 8-bit address space).

### Adder

Combinational 8-bit unsigned add. Outputs are the 8-bit low byte of the sum plus a 1-bit carry-out signal that fires when the unsigned add overflows past 255.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `in-a` | target | 8-bit unsigned data | First operand |
| `in-b` | target | 8-bit unsigned data | Second operand |
| `sum-out` | source | 8-bit unsigned data | Low 8 bits of `in_a + in_b` |
| `carry-out` | source | 1-bit | Set when the sum overflows past 255 |

**Parameters.** None.

**Behavior.** Pure combinational. The 9-bit intermediate is split into the 8-bit sum and the 1-bit carry so the sum can flow into another 8-bit-input block (Register, RAM, another Adder) without truncation, while the carry stays available on its own gate-1 line for cascading or overflow indicators. Yosys collapses the `+` into a ripple-carry chain that maps onto iCE40's `SB_CARRY` cells.

> **Scope note.** [ADR-002](ADR-002-cpu-primitives.md) originally specified a single 9-bit `sum-out` port. The split-shape lands in v0.1 because it composes more cleanly with the 8-bit data path the other CPU primitives use — pure-9-bit output would have required a BusSplit on every cascade.

**Common usage.** Pair with Register for the canonical accumulator pattern: Constant or ROM source → Adder.in-a; Register.data-out → Adder.in-b; Adder.sum-out → Register.data-in; Gate → Register.write-enable. Each pulse adds the source to the running sum. The carry-out can drive a status LED via BusSplit, or feed the carry-in of a wider add chain (Sprint 18+ when wider Adders exist).

### Subtractor

Combinational 8-bit unsigned subtract. Mirrors Adder's split-output shape: an 8-bit difference plus a 1-bit borrow-out flag.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `in-a` | target | 8-bit unsigned data | Minuend |
| `in-b` | target | 8-bit unsigned data | Subtrahend |
| `diff-out` | source | 8-bit unsigned data | Low 8 bits of `in_a - in_b` (mod 256) |
| `borrow-out` | source | 1-bit | Set when `in_a < in_b` (the unsigned subtract underflowed) |

**Parameters.** None.

**Behavior.** Pure combinational. The difference truncates to 8 bits — `20 - 50` reads as 226 (256 - 30) with borrow=1. Pair with Adder for "running difference" patterns or with Comparator for branching. Yosys collapses the `-` into the same SB_CARRY chain Adder uses, just in subtract mode.

**Common usage.** Mirror of the Adder accumulator: Constant or ROM source → Subtractor.in-a; Register.data-out → Subtractor.in-b; Subtractor.diff-out → Register.data-in. Each pulse subtracts the source from the running value, useful for countdown timers or running differences.

### Comparator

Combinational 8-bit unsigned compare with three flag projections of the same compare. One block, three outputs (eq / lt / gt) since splitting them across three blocks would clutter the canvas without adding expressive power, and all three are zero-cost projections of the internal compare.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `in-a` | target | 8-bit unsigned data | Left operand |
| `in-b` | target | 8-bit unsigned data | Right operand |
| `eq-out` | source | 1-bit | High when `in_a == in_b` |
| `lt-out` | source | 1-bit | High when `in_a < in_b` (unsigned) |
| `gt-out` | source | 1-bit | High when `in_a > in_b` (unsigned) |

**Parameters.** None.

**Behavior.** Pure combinational. The three flags are mutually exclusive — exactly one is high at any instant (eq when equal, lt when strictly less, gt when strictly greater).

**Common usage.** Pairs with Mux for branchable program control: feed Comparator.eq-out into Mux.select to pick between two data values based on whether the comparison was equal. The "counter that resets at a target" pattern is the canonical worked example (`examples/cpu-counter-with-branch.json`).

### Mux

2-to-1 multiplexer on 8-bit data. The minimum branching primitive: pick `in-a` when select is 0, `in-b` when select is 1.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `in-a` | target | 8-bit unsigned data | Picked when `select == 0` |
| `in-b` | target | 8-bit unsigned data | Picked when `select == 1` |
| `select` | target | 1-bit gate | The control line |
| `data-out` | source | 8-bit unsigned data | The chosen input |

**Parameters.** None.

**Behavior.** Pure combinational. Compiles to a one-hot AND/OR pair per output bit; on iCE40, an 8-bit Mux is 8 LUT4s.

**Common usage.** Conditional control without a state machine: pair Comparator + Mux for "if equal, take this value, otherwise take that value." A counter that resets at a target value uses Comparator(running == target).eq-out to drive Mux.select, picking between the incremented sum and 0 — that's a branchable program in two blocks.

### Register

Single 8-bit data register with synchronous write-enable. The store latches `data-in` on the clock edge whenever `write-enable` is high; otherwise it holds its current value.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `data-in` | target | 8-bit unsigned data | Value to latch |
| `write-enable` | target | 1-bit gate | High = capture data-in on the next edge |
| `data-out` | source | 8-bit unsigned data | The currently-stored value |

**Parameters.** None.

**Behavior.** Synchronous. On reset the store is zero. While write-enable is low the output holds whatever was last latched indefinitely.

**Common usage.** The Adder + Register accumulator pattern described above. Also useful as a "remember the last computed value" element wherever the rest of the graph needs to refer back to it — feed the output back through a Multiplexer-equivalent (built from boolean gates + BusJoin in v0.1) for a tiny scratchpad.

### RAM

16-byte synchronous read/write memory. 4-bit address selects one of 16 cells; combinational read on the current address (so reads come back the same cycle the address is presented); synchronous write gated by `write-enable`.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `addr` | target | 4-bit unsigned address | Selects cell 0..15 |
| `data-in` | target | 8-bit unsigned data | Value to write |
| `write-enable` | target | 1-bit gate | High = write data-in to cell `addr` on the next edge |
| `data-out` | source | 8-bit unsigned data | Combinational read of cell `addr` |

**Parameters.** None.

**Behavior.** Backed by `amaranth.lib.memory.Memory` (the same primitive Delay uses) zero-initialized at reset. Both write and read share the address port; on iCE40 the 16 × 8-bit array maps to a single BRAM (0.4% of one 4 KB block).

**Common usage.** Drive `addr` from Counter.addr-out so the RAM walks through 16 cells on a clock tick. Pair the write side with a Gate on `write-enable` to log values into successive cells; flip write-enable low and the same address sweep reads them back. The scratchpad half of the "ROM holds the program, RAM holds the working data" CPU pattern.

### ROM

16-byte combinational read-only memory. The `contents` parameter is a list of 16 integers (each 0..255), edited as comma-separated values in a textarea on the block. No write port — drive `addr` to read.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `addr` | target | 4-bit unsigned address | Selects cell 0..15 |
| `data-out` | source | 8-bit unsigned data | Combinational read of `contents[addr]` |

**Parameters**

| Name | Type | Range | Default | What it does |
|---|---|---|---|---|
| `contents` | list of integers | 16 entries, each 0..255 | `[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]` | The byte stored at each address |

The textarea accepts comma-separated values. Missing entries are zero-padded to 16; extra entries are truncated; out-of-range entries are clamped to 0..255 by the backend. The contents round-trip through Save/Load as a JSON array.

> **Scope note.** ROM is the first block in the library where the parameter is a list rather than a scalar. The textarea approach is deliberately simple; per-cell numeric inputs (16 individual fields) were considered and rejected because they're visually heavy and the comma-separated form is hand-editable and AI-tool-call-friendly.

**Behavior.** Combinational lookup against a Memory initialised at construction time from the contents. Yosys recognises constant-init memories and instances a single BRAM for the data.

**Common usage.** The "program" half of the CPU pattern. Wire Counter.addr-out → ROM.addr to step through the 16 bytes; ROM.data-out is your per-cycle byte, which feeds an Adder (for an accumulator), a Bus Split (for "drive an LED off bit N"), or any other 8-bit-input block. The canonical worked example is `examples/cpu-accumulator.json` (Load → Examples → CPU accumulator) — a ROM holding the first 8 Fibonacci numbers, fed into an Adder + Register accumulator and a parallel RAM scratchpad.

### How these compose

The `examples/cpu-accumulator.json` graph wires the data-path primitives plus the Counter extension and the Sprint 18 Reinterpret bridge into a single design:

```
Gate (100 Hz) ──► Counter.clock
                  Counter.addr-out ─┬─► ROM.addr
                                    └─► RAM.addr

ROM (Fibonacci) ─► Adder.in-a
Register.data-out ► Adder.in-b
Adder.sum-out ───► Register.data-in
Gate.gate-out ───► Register.write-enable
                   Register.data-out ─┬─► RAM.data-in
                                      │   RAM.write-enable ◄─ Gate.gate-out
                                      └─► Reinterpret.data-in
                                          Reinterpret.audio-out ─► Output.audio-in
```

Each clock pulse:
1. The Counter advances by 1, presenting the new address to ROM and RAM.
2. ROM emits the byte at that address; the Adder adds it to the running sum stored in the Register.
3. On the same clock edge, the Register latches the new sum, RAM writes the previous-cycle sum into the cell at the new address, and Reinterpret rewires the running sum onto the audio bus so the speaker hears the accumulator's motion as crackle.

The `examples/cpu-counter-with-branch.json` graph extends this with the Sprint 18 Comparator + Mux trio for conditional control. The Register holds a counter that increments by 1 each cycle, but Comparator detects when the running value equals a target (7 in the bundled example), and Mux picks between the incremented sum and 0 based on that flag — so the counter resets at 7 every time, producing a 0..7..0..7.. pattern audible as a saw-shaped buzz through Reinterpret.

---

## Bus

The three bus blocks are the explicit escape hatch for cross-width and cross-sign-class signal routing. The connection validator rejects edges where source and target ports carry different bus widths or sign classes; Bus Split, Bus Join, and Reinterpret are how you bridge the gap on purpose. Bus Split / Bus Join move data between an 8-bit bus and 8 individual 1-bit lines (cross-width); Reinterpret renames `data-u8` as `audio-s8` so the CPU domain can drive audio (cross-sign-class).

v0.1 fixes Bus Split / Bus Join at 8-bit width — wide enough for ~80% of cases, and the dynamic-handle-rendering needed for parameterized widths is a novel pattern worth waiting until the actual width requirements are clearer (Sprint 17's CPU primitives will probably want 8-bit + 16-bit). Configurable widths are roadmap.

### Bus Split

Fan a single 8-bit data bus out to 8 individual 1-bit signals. Pure combinational bit-slice — no internal state, no per-sample latency.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `bus-in` | target | 8-bit unsigned | The wide bus to split |
| `bit-0` | source | 1-bit | Least significant bit (`bus_in[0]`) |
| `bit-1` | source | 1-bit | `bus_in[1]` |
| `bit-2` | source | 1-bit | `bus_in[2]` |
| `bit-3` | source | 1-bit | `bus_in[3]` |
| `bit-4` | source | 1-bit | `bus_in[4]` |
| `bit-5` | source | 1-bit | `bus_in[5]` |
| `bit-6` | source | 1-bit | `bus_in[6]` |
| `bit-7` | source | 1-bit | Most significant bit (`bus_in[7]`) |

**Parameters.** None.

**Behavior.** Combinational. Each `bit-N` output is wired to the N-th bit of `bus-in`. `bit-0` is the LSB and `bit-7` is the MSB — same convention as Bus Join, so `BusSplit.bit-N → BusJoin.bit-N` in order is identity.

**Common usage.** Use it whenever a wide-bus output needs to drive several 1-bit-only inputs — for example, probing the LSB of a counter on a status LED, or splitting an ALU result into individual flag wires. This is also the block the connection-validator's friendly toast points users to ("Use a BusSplit (one wide bus → many 1-bit) or BusJoin (many 1-bit → one wide bus) to convert") when they try to wire mismatched widths.

### Bus Join

The inverse of Bus Split: collect 8 individual 1-bit signals and present them as a single 8-bit data bus. Pure combinational concatenation.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `bit-0` | target | 1-bit | Least significant bit |
| `bit-1` | target | 1-bit | |
| `bit-2` | target | 1-bit | |
| `bit-3` | target | 1-bit | |
| `bit-4` | target | 1-bit | |
| `bit-5` | target | 1-bit | |
| `bit-6` | target | 1-bit | |
| `bit-7` | target | 1-bit | Most significant bit |
| `bus-out` | source | 8-bit unsigned | `Cat(bit-0, bit-1, ..., bit-7)` |

**Parameters.** None.

**Behavior.** Combinational. The output is the LSB-first concatenation of the 8 input bits — `bus_out[0]` comes from `bit-0`, ..., `bus_out[7]` comes from `bit-7`. Mirror of Bus Split's ordering.

**Common usage.** Use it whenever several 1-bit outputs need to drive a wide-bus input — for example, hand-assembling an 8-bit register's input from individual flag computations, or composing an address bus from per-bit logic. Pairs naturally with Bus Split: `BusSplit → some 1-bit operations on each bit → BusJoin` is a common shape.

### Reinterpret

Pure no-op bridge from `data-u8` to `audio-s8`. Same 8 bits on the wire, different sign interpretation. The connection validator correctly rejects an implicit cross between sign classes (per ADR-001 — `data-u8` is unsigned 0..255, `audio-s8` is signed –128..+127), so this is the explicit "yes, I want that bit-level reinterpretation" escape hatch.

**Inputs / outputs**

| Handle id | Direction | Type | Notes |
|---|---|---|---|
| `data-in` | target | 8-bit unsigned data | The wire to reinterpret |
| `audio-out` | source | signed 8-bit audio | Same bits, viewed as signed |

**Parameters.** None.

**Behavior.** Pure combinational. Amaranth's `Signal.as_signed()` cast inserts no logic — Yosys collapses the connection to a wire. `data-in = 0` reads as `audio-out = 0`; `data-in = 128` reads as `audio-out = -128` (the high bit becomes the sign bit, classic 2's-complement reinterpretation).

**Common usage.** Wire a CPU-domain accumulator's running sum into Reinterpret.data-in, then Reinterpret.audio-out into Output.audio-in to make the accumulator audible. The LSBs of the running sum vary per cycle, so the reinterpreted audio carries the accumulator's motion as crackle / rhythmic noise — most intelligible at gate rates above ~50 Hz. The `examples/cpu-accumulator.json` graph shows this pattern end-to-end.

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
