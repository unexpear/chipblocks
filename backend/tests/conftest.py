"""
Shared pytest fixtures for the ChipBlocks backend test suite.

Provides:
- `run_synth(graph)`: runs synth.synthesize on a graph dict and returns the
  raw WAV bytes (the same bytes synth.py would write to disk).
- `wav_samples(wav_bytes)`: strips the 44-byte WAV header and returns the
  16-bit signed-PCM samples as a list[int]. The bus is 8-bit signed but
  synth.write_wav promotes it to 16-bit (multiplied by SCALE=64).
- `examples_dir`: pathlib.Path to the repo-root `examples/` directory.
- `SAMPLE_RATE`: the project sample rate (44100 Hz) re-exported as a constant.

We make `import synth` and `from blocks import ...` work by adding the
`backend/` directory to sys.path here rather than configuring pytest's
rootdir or adding a pyproject.toml — keeps the test setup as light as
possible.
"""

from __future__ import annotations

import io
import struct
import sys
import wave
from pathlib import Path

import pytest

# Make `import synth` and `from blocks import ...` work regardless of where
# pytest is invoked from.
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import synth  # noqa: E402


SAMPLE_RATE = synth.SAMPLE_RATE
WAV_HEADER_BYTES = 44


def _samples_to_wav_bytes(samples: list[int]) -> bytes:
    """Replicate synth.write_wav, but return the bytes instead of writing a file."""
    SCALE = 64
    INT16_MIN, INT16_MAX = -32768, 32767
    pcm = [max(INT16_MIN, min(INT16_MAX, s * SCALE)) for s in samples]
    buf = io.BytesIO()
    with wave.open(buf, "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SAMPLE_RATE)
        f.writeframes(b"".join(struct.pack("<h", v) for v in pcm))
    return buf.getvalue()


@pytest.fixture
def run_synth():
    """Run synth.synthesize(graph) and return WAV bytes.

    `duration_s` accepts an int (synth.synthesize requires an int because
    it does `range(SAMPLE_RATE * duration_s)`). Default 1 keeps each test
    around 2-3 seconds; assertions tolerate this short window.
    """

    def _run(graph: dict, duration_s: int = 1) -> bytes:
        samples = synth.synthesize(graph, duration_s=int(duration_s))
        return _samples_to_wav_bytes(samples)

    return _run


@pytest.fixture
def wav_samples():
    """Strip the 44-byte WAV header and unpack signed-16-bit little-endian samples."""

    def _samples(wav_bytes: bytes) -> list[int]:
        body = wav_bytes[WAV_HEADER_BYTES:]
        return list(struct.unpack(f"<{len(body) // 2}h", body))

    return _samples


@pytest.fixture
def examples_dir() -> Path:
    """Path to the repo-root `examples/` directory."""
    return BACKEND_DIR.parent / "examples"
