"""
VCO block — voltage-controlled oscillator (square wave, 8-bit signed).

A square-wave audio source whose frequency is modulated by an
audio-rate input signal. The frequency at any given sample is

    freq = base_freq_hz + (freq_in × range / 128)

so the `freq-in` input signal (signed-8 audio sample, -128..+127)
sweeps the oscillator's pitch by ±`range` Hz around `base_freq_hz`.

Inputs:
- `freq-in`  — 8-bit signed audio sample driving the pitch modulation

Outputs:
- `audio-out` — 8-bit signed square wave at the dynamically-computed frequency

Parameters:
- `base_freq_hz` — center frequency in Hz, 20..20000 (default 440)
- `range`        — modulation depth in Hz per ±128 input (default 100)

Implementation: a 32-bit phase accumulator advances by a per-sample
step computed as `step_base + freq_in × step_per_unit`. The MSB of
the phase accumulator is read as the square-wave output. The
per-sample multiply is the cost compared to the static `oscillator`
block; on iCE40 this maps to a single SB_MAC16 DSP cell.

The step is clamped to a minimum of 1 to keep the phase advancing
even at very negative `freq_in` (which would otherwise try to push
the oscillator backwards / below DC). This means at extreme
negative modulation the pitch floors at near-silence rather than
running backwards — a safe, well-defined behavior.

Use cases this unlocks (not buildable with the static `oscillator`):
- Vibrato (slow LFO oscillator → VCO.freq-in → audible wobble)
- Pitch bend / glide
- Audio-rate FM (modulator oscillator → VCO.freq-in for full
  Yamaha-DX7-style frequency-modulation timbral variety)
- Theremin (continuous-pitch control)
- Sequenced melody (ROM/RAM-driven pitch lookup feeding VCO.freq-in)
- Karplus-Strong with audio-rate pitch perturbation
"""

from amaranth import Elaboratable, Module, Signal, signed, unsigned


class Vco(Elaboratable):
    """Voltage-controlled square-wave oscillator with audio-rate FM input."""

    def __init__(self, base_freq_hz: int = 440, range: int = 100, sample_rate: int = 44100):
        self.base_freq_hz = max(1, min(20000, int(base_freq_hz)))
        self.range = max(1, min(1000, int(range)))
        self.sample_rate = sample_rate

        # Phase-accumulator step at the base frequency. A 32-bit phase
        # gives fine pitch resolution (sample-rate / 2^32 ≈ 10 µHz per
        # step) so the integer-divided value lands close to the
        # configured base freq.
        self.step_base = (1 << 32) * self.base_freq_hz // self.sample_rate

        # Additional phase step per unit of freq_in. freq_in is signed
        # 8-bit (-128..+127); we want full +127 to add `range` Hz and
        # full -128 to subtract `range` Hz, so the per-unit increment
        # is range/128 Hz, scaled to phase units.
        self.step_per_unit = (1 << 32) * self.range // (self.sample_rate * 128)

        self.freq_in = Signal(signed(8))
        self.audio_out = Signal(signed(8))

        self.input_ports = {"freq-in": self.freq_in}
        self.output_ports = {"audio-out": self.audio_out}

    def elaborate(self, platform):
        m = Module()

        phase = Signal(unsigned(32))

        # Per-sample step = step_base + freq_in × step_per_unit.
        # step_per_unit is a positive Python int; freq_in is signed-8.
        # The multiplication produces a signed result; widen to fit
        # the worst-case range without overflow.
        step_signed = Signal(signed(34))
        m.d.comb += step_signed.eq(
            self.step_base + self.freq_in * self.step_per_unit
        )

        # Clamp the step to >= 1 so the phase always advances forward.
        # At extreme negative `freq_in`, step_signed can go below zero;
        # that would walk the phase backwards. Clamping to 1 keeps the
        # behavior musical (pitch floors at ~0 Hz rather than reversing).
        safe_step = Signal(unsigned(32))
        with m.If(step_signed > 0):
            m.d.comb += safe_step.eq(step_signed[:32])
        with m.Else():
            m.d.comb += safe_step.eq(1)

        m.d.sync += phase.eq(phase + safe_step)

        # Output: square wave from phase MSB.
        with m.If(phase[31]):
            m.d.comb += self.audio_out.eq(-128)
        with m.Else():
            m.d.comb += self.audio_out.eq(127)

        return m
