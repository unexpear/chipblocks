"""
HardSync block — slave sawtooth oscillator whose phase resets when its
`sync-in` master signal crosses zero (negative → non-negative).

The classic analog-synth "hard sync" trick: the slave oscillator runs
free at its own (typically higher) frequency, but every cycle of the
master forces the slave's phase back to zero. The slave's natural
period is interrupted partway through, snapping back to the start of
its sawtooth ramp. The interaction between master-period and slave's
natural period creates the harmonically rich "sync lead" sound used in
classic prog-rock and synthwave records (Van Halen "Jump", The Cars
"Let's Go", etc.).

Trigger detection: a positive-going zero-crossing on `sync-in` —
specifically, when the sign-bit transitions from 1 (negative) to 0
(non-negative). For any periodic master (sine / square / sawtooth /
triangle / LFO) this fires exactly once per cycle of the master.

Inputs:
- `sync-in` — 8-bit signed audio signal from the master oscillator

Outputs:
- `audio-out` — 8-bit signed sawtooth at the slave frequency, phase-
  reset by master's rising zero-crossings

Parameters:
- `freq_hz` — slave frequency in Hz (20..20000, default 660). 660 Hz
  is a perfect-fifth above the canonical 440 Hz master.

Implementation: a 16-bit phase accumulator advances by
`step = (2^16 * freq_hz) // sample_rate` per sample. A 1-bit `prev_sign`
register holds last cycle's MSB of `sync-in`; the combinational
`sync_pulse = prev_sign & ~sync_in[7]` is asserted when the sign just
transitioned 1 → 0 (negative → non-negative). When `sync_pulse` is
high the phase resets to 0 instead of advancing. Output is
`phase[8:16] - 128`, the standard sawtooth-from-phase formula.

Use cases this unlocks (not buildable from oscillator + multiply):
- Classic 1980s sync lead (440 Hz square → HardSync at 660 / 880 Hz)
- Inharmonic bell-like timbres (irrational master/slave ratios)
- Talk-box / vocal effects (slow master pulse + audio-rate slave)
- Polyrhythmic textures (master oscillator's period determines the
  rhythmic accent; slave's natural period determines pitch)
"""

from amaranth import Elaboratable, Module, Signal, signed


class HardSync(Elaboratable):
    """Slave sawtooth with phase-reset on rising zero-crossings of sync-in."""

    def __init__(self, freq_hz: int = 660, sample_rate: int = 44100):
        self.freq_hz = max(20, min(20000, int(freq_hz)))
        self.sample_rate = sample_rate

        self.sync_in = Signal(signed(8))
        self.audio_out = Signal(signed(8))

        self.input_ports = {"sync-in": self.sync_in}
        self.output_ports = {"audio-out": self.audio_out}

    def elaborate(self, platform):
        m = Module()

        # 16-bit phase accumulator (audio-rate; same pattern as Sawtooth).
        step = max(1, (1 << 16) * self.freq_hz // self.sample_rate)
        phase = Signal(16)

        # Track last-tick's sign-bit. The MSB of a signed(8) is 1 for
        # values -128..-1 and 0 for values 0..+127, so its transition
        # 1 -> 0 is exactly the rising zero-crossing we want.
        prev_sign = Signal(1)
        m.d.sync += prev_sign.eq(self.sync_in[7])

        # Sync trigger: was negative, now non-negative.
        sync_pulse = Signal(1)
        m.d.comb += sync_pulse.eq(prev_sign & ~self.sync_in[7])

        # Synchronous phase update: reset on trigger, otherwise advance.
        with m.If(sync_pulse):
            m.d.sync += phase.eq(0)
        with m.Else():
            m.d.sync += phase.eq(phase + step)

        # Sawtooth output: high 8 bits as 0..255, subtract 128 for signed.
        m.d.comb += self.audio_out.eq(phase[8:16] - 128)

        return m
