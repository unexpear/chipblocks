"""
ADSR Envelope block — shapes an audio signal by an
Attack / Decay / Sustain / Release amplitude curve.

Inputs:
- `gate`     — 1-bit signal. Rising edge triggers Attack -> Decay -> Sustain.
               When gate falls, transitions to Release.
- `audio-in` — `Signal(signed(8))` — the audio to be shaped.

Output:
- `audio-out` — `Signal(signed(8))` — `audio_in` scaled by the envelope.

Parameters:
- `attack_ms`     — attack time in milliseconds (default 10)
- `decay_ms`      — decay time in milliseconds (default 100)
- `sustain_level` — sustain amplitude 0..127 (default 80)
- `release_ms`    — release time in milliseconds (default 200)
- `sample_rate`   — project sample rate (default 44100)
"""

from amaranth import Elaboratable, Module, Signal, signed


class ADSR(Elaboratable):
    """Attack / Decay / Sustain / Release envelope for 8-bit signed audio."""

    def __init__(
        self,
        attack_ms: int = 10,
        decay_ms: int = 100,
        sustain_level: int = 80,
        release_ms: int = 200,
        sample_rate: int = 44100,
    ):
        self.attack_ms = max(1, attack_ms)
        self.decay_ms = max(1, decay_ms)
        self.sustain_level = max(0, min(127, sustain_level))
        self.release_ms = max(1, release_ms)
        self.sample_rate = sample_rate

        self.gate = Signal()
        self.audio_in = Signal(signed(8))
        self.audio_out = Signal(signed(8))

        self.input_ports = {"gate": self.gate, "audio-in": self.audio_in}
        self.output_ports = {"audio-out": self.audio_out}

    def elaborate(self, platform):
        m = Module()

        # Time-in-samples for each ramp.
        attack_samples = max(1, self.attack_ms * self.sample_rate // 1000)
        decay_samples = max(1, self.decay_ms * self.sample_rate // 1000)
        release_samples = max(1, self.release_ms * self.sample_rate // 1000)

        # Envelope is a 16-bit accumulator. The high 8 bits (envelope[8:16])
        # are the amplitude scale 0..127 the audio multiplier sees.
        # Peak envelope = 127 << 8 = 32512; sustain = sustain_level << 8.
        ENV_PEAK = 127 << 8
        ENV_SUSTAIN = self.sustain_level << 8

        attack_step = max(1, ENV_PEAK // attack_samples)
        decay_step = max(1, max(1, ENV_PEAK - ENV_SUSTAIN) // decay_samples)
        release_step = max(1, max(1, ENV_SUSTAIN if ENV_SUSTAIN > 0 else ENV_PEAK) // release_samples)

        envelope = Signal(16)

        # Edge-detect the gate so we trigger on rising edge, not on level.
        prev_gate = Signal()
        m.d.sync += prev_gate.eq(self.gate)
        gate_rising = self.gate & ~prev_gate
        gate_falling = ~self.gate & prev_gate

        with m.FSM(init="IDLE"):
            with m.State("IDLE"):
                m.d.sync += envelope.eq(0)
                with m.If(gate_rising):
                    m.next = "ATTACK"

            with m.State("ATTACK"):
                with m.If(envelope >= ENV_PEAK - attack_step):
                    m.d.sync += envelope.eq(ENV_PEAK)
                    m.next = "DECAY"
                with m.Else():
                    m.d.sync += envelope.eq(envelope + attack_step)
                with m.If(gate_falling):
                    m.next = "RELEASE"

            with m.State("DECAY"):
                with m.If(envelope <= ENV_SUSTAIN + decay_step):
                    m.d.sync += envelope.eq(ENV_SUSTAIN)
                    m.next = "SUSTAIN"
                with m.Else():
                    m.d.sync += envelope.eq(envelope - decay_step)
                with m.If(gate_falling):
                    m.next = "RELEASE"

            with m.State("SUSTAIN"):
                m.d.sync += envelope.eq(ENV_SUSTAIN)
                with m.If(gate_falling):
                    m.next = "RELEASE"

            with m.State("RELEASE"):
                with m.If(envelope <= release_step):
                    m.d.sync += envelope.eq(0)
                    m.next = "IDLE"
                with m.Else():
                    m.d.sync += envelope.eq(envelope - release_step)
                with m.If(gate_rising):
                    m.next = "ATTACK"  # retrigger

        # Multiply audio_in by envelope's high byte (0..127), shifted back
        # to keep the result in signed(8) range.
        env_byte = Signal(8)
        m.d.comb += env_byte.eq(envelope[8:16])
        m.d.comb += self.audio_out.eq((self.audio_in * env_byte) >> 7)

        return m
