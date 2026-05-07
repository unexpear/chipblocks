"""
pwm_to_wav.py — run the lab004 PWM design in a Migen simulation,
sample the output per cycle, decimate to 44100 Hz, write a playable WAV.

Adapted from litex-hub/fpga_101/lab004/pwm.py.
The _PWM module is unchanged; only the testbench is rewritten to
produce audio-rate audio instead of a VCD trace.

Usage (from WSL2 Ubuntu):
    python3 pwm_to_wav.py

Produces `pwm.wav` in the current directory — drag into any audio
player to hear the square wave.
"""

from migen import *
import wave
import struct
import sys


# ---------------------------------------------------------------------------
# _PWM — same as the upstream module: counter compares against width/period,
# pwm = 1 while count < width, else 0. period must be > 0.
# ---------------------------------------------------------------------------
class _PWM(Module):
    def __init__(self, pwm):
        self.enable = enable = Signal()
        self.width = width = Signal(32)
        self.period = period = Signal(32)

        count = Signal(32)
        self.sync += [
            If(enable,
                If(count < width,
                    pwm.eq(1)
                ).Else(
                    pwm.eq(0)
                ),
                If(count == period - 1,
                    count.eq(0)
                ).Else(
                    count.eq(count + 1)
                )
            ).Else(
                count.eq(0),
                pwm.eq(0)
            )
        ]


# ---------------------------------------------------------------------------
# Audio config
# ---------------------------------------------------------------------------
SAMPLE_RATE = 44100        # Hz — standard CD audio
DURATION_S = 2             # seconds of audio
NOTE_HZ = 440              # frequency of the square wave (A4)

# We want each simulation tick to map to one audio sample, so the
# simulator's "clock" is conceptually SAMPLE_RATE Hz. Setting period to
# (SAMPLE_RATE / NOTE_HZ) gives us a square wave at NOTE_HZ.
PERIOD = SAMPLE_RATE // NOTE_HZ      # = 100 ticks per cycle for 441 Hz (close enough to 440)
WIDTH = PERIOD // 2                  # 50% duty -> clean square wave
TOTAL_TICKS = SAMPLE_RATE * DURATION_S


def main():
    pwm = Signal()
    dut = _PWM(pwm)
    samples = []

    def tb(dut):
        # Set up: enable PWM with the configured width/period
        yield dut.enable.eq(1)
        yield dut.width.eq(WIDTH)
        yield dut.period.eq(PERIOD)
        yield  # apply the values on the next cycle

        # Run one tick per audio sample, capturing the pwm signal each time
        for _ in range(TOTAL_TICKS):
            samples.append((yield pwm))
            yield

    print(f"Running simulation: {TOTAL_TICKS} ticks ({DURATION_S}s at {SAMPLE_RATE} Hz)...")
    run_simulation(dut, tb(dut))
    print(f"Captured {len(samples)} samples.")

    # Convert 1/0 PWM to signed 16-bit audio. Use modest amplitude so it's
    # not painfully loud through headphones.
    AMPLITUDE = 8000  # ~25% of int16 max (32767)
    pcm = [AMPLITUDE if s else -AMPLITUDE for s in samples]

    out_path = "pwm.wav"
    with wave.open(out_path, "wb") as f:
        f.setnchannels(1)        # mono
        f.setsampwidth(2)        # 16-bit
        f.setframerate(SAMPLE_RATE)
        f.writeframes(b"".join(struct.pack("<h", v) for v in pcm))

    print(f"Wrote {out_path}: {DURATION_S}s of {NOTE_HZ}Hz square wave at {SAMPLE_RATE}Hz / 16-bit mono.")


if __name__ == "__main__":
    sys.exit(main() or 0)
