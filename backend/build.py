"""
build.py — Graph -> Verilog -> FPGA bitstream pipeline (Sprint 6 Item 2+).

Reads a graph JSON from --in (the React Flow {nodes, edges} format) and,
depending on --target, produces one of:

    --target verilog        Just the generated Verilog source (.v file).
                            No external tools needed; uses Amaranth's
                            built-in `amaranth.back.verilog.convert()`.

    --target ice40          Full pipeline: Verilog -> Yosys synth ->
                            nextpnr-ice40 -> icepack -> .bin file.
                            Requires Yosys + nextpnr-ice40 + icestorm
                            on PATH (e.g. via the OSS CAD Suite tarball).

The ice40 target wraps the user's design with an iCEstick toplevel
that hooks the on-board 12 MHz clock to a sample-rate divider and
projects the 8-bit-signed audio onto a single 1-bit PWM output pin
the user can attach to a speaker (with a small RC filter).

Errors are emitted as JSON on stderr so the Electron side can parse
them into a friendly message:
    {"error": "...", "type": "ExceptionClassName"}
"""

from __future__ import annotations

import argparse
import datetime
import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from amaranth import Elaboratable, Module, Signal, signed  # noqa: E402
from amaranth.back import verilog  # noqa: E402

from synth import GraphTop, SAMPLE_RATE  # noqa: E402


# Lattice iCEstick board parameters.
ICESTICK_CLOCK_HZ = 12_000_000
ICESTICK_AUDIO_PIN = "B1"  # GPIO pin we route PWM to (see chipblocks.pcf)


class IcestickTop(Elaboratable):
    """Top-level wrapper for the iCEstick.

    Drops the user's GraphTop into a sync domain clocked at
    ICESTICK_CLOCK_HZ, divided down to the project sample rate. The
    Output block's audio_in (signed 8-bit) is fed into a 1-bit PWM
    modulator whose duty cycle tracks the audio amplitude, exposed as
    a single GPIO output the user can connect to a speaker (via a
    simple RC low-pass).

    For Sprint-6 v1 this is the simplest mapping that produces audible
    output on a real iCEstick. A future iteration could use a Sigma-
    Delta DAC for cleaner audio.
    """

    def __init__(self, graph: dict):
        self.inner = GraphTop(graph)
        # Single 1-bit GPIO output for PWM-modulated audio.
        self.audio_pin = Signal()

    def elaborate(self, platform):
        m = Module()
        m.submodules.inner = self.inner

        # Sample-rate divider: count clock ticks per audio sample.
        divider = ICESTICK_CLOCK_HZ // SAMPLE_RATE  # 12_000_000 / 44_100 ≈ 272
        sample_tick = Signal()
        sample_counter = Signal(range(divider))
        with m.If(sample_counter == divider - 1):
            m.d.sync += sample_counter.eq(0)
            m.d.comb += sample_tick.eq(1)
        with m.Else():
            m.d.sync += sample_counter.eq(sample_counter + 1)

        # Latch a new sample at the audio rate.
        # `inner.output_block.audio_in` is signed(8); convert to unsigned
        # 0..255 for PWM-amplitude comparison by adding 128.
        latched_sample = Signal(8)  # unsigned 0..255
        with m.If(sample_tick):
            audio_in_signed = self.inner.output_block.audio_in
            m.d.sync += latched_sample.eq((audio_in_signed + 128).as_unsigned())

        # PWM modulator: an 8-bit counter cycles 0..255 every 256 clock
        # ticks (~47 kHz at 12 MHz). PWM out is high while the counter
        # < latched_sample, giving a duty cycle proportional to amplitude.
        pwm_count = Signal(8)
        m.d.sync += pwm_count.eq(pwm_count + 1)
        m.d.comb += self.audio_pin.eq(pwm_count < latched_sample)

        return m


# iCEstick pin-constraint file. References the iCEstick HX1K's
# onboard 12 MHz oscillator and routes our audio_pin to GPIO B1
# (header J3, pin 1 — accessible on the breakout).
ICESTICK_PCF = """\
# iCEstick (iCE40HX-1k) constraints for ChipBlocks
# Onboard 12 MHz oscillator (Y1) is wired to global clock pin 21
set_io clk 21
# PWM-modulated audio output: GPIO header J3 pin 1 -> physical pad B1
set_io audio_pin 112
"""


def emit_verilog(graph: dict, out_dir: Path) -> Path:
    """Run amaranth.back.verilog.convert() on the wrapped design."""
    top = IcestickTop(graph)
    out_dir.mkdir(parents=True, exist_ok=True)
    verilog_path = out_dir / "chipblocks.v"
    verilog_text = verilog.convert(
        top,
        ports=[top.audio_pin],
        # iCEstick toolchain expects modules without language extensions.
        emit_src=False,
    )
    verilog_path.write_text(verilog_text)
    return verilog_path


def run_step(name: str, args: list[str], cwd: Path) -> str:
    """Run one toolchain step. Returns combined stdout+stderr; raises on
    non-zero exit. The combined output goes into the build report."""
    proc = subprocess.run(
        args,
        cwd=str(cwd),
        capture_output=True,
        text=True,
        check=False,
    )
    out = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode != 0:
        raise RuntimeError(f"{name} failed (exit {proc.returncode}):\n{out[-2000:]}")
    return out


def build_ice40(graph: dict, out_dir: Path) -> dict:
    """Full iCE40 pipeline: Verilog -> Yosys synth -> nextpnr -> icepack."""
    # Verify required binaries are on PATH.
    for tool in ("yosys", "nextpnr-ice40", "icepack"):
        if shutil.which(tool) is None:
            raise RuntimeError(
                f"{tool!r} not found on PATH. "
                f"Install the OSS CAD Suite (https://github.com/YosysHQ/oss-cad-suite-build) "
                f"or `apt install yosys nextpnr-ice40 fpga-icestorm`."
            )

    out_dir.mkdir(parents=True, exist_ok=True)

    # 1. Verilog
    verilog_path = emit_verilog(graph, out_dir)
    pcf_path = out_dir / "chipblocks.pcf"
    pcf_path.write_text(ICESTICK_PCF)

    # 2. Yosys synth
    json_path = out_dir / "chipblocks.json"
    yosys_log = run_step(
        "yosys",
        [
            "yosys",
            "-q",
            "-p",
            f"synth_ice40 -top top -json {json_path.name}",
            verilog_path.name,
        ],
        cwd=out_dir,
    )

    # 3. nextpnr-ice40 (HX1K, on the iCEstick TQ144 package).
    # --pcf-allow-unconstrained lets us skip a pin assignment for the
    # auto-generated `rst` port that Amaranth emits — unused on the
    # iCEstick (no reset button wired in v1).
    asc_path = out_dir / "chipblocks.asc"
    nextpnr_log = run_step(
        "nextpnr-ice40",
        [
            "nextpnr-ice40",
            "--hx1k",
            "--package",
            "tq144",
            "--json",
            json_path.name,
            "--pcf",
            pcf_path.name,
            "--pcf-allow-unconstrained",
            "--asc",
            asc_path.name,
            "--quiet",
        ],
        cwd=out_dir,
    )

    # 4. icepack -> .bin
    bin_path = out_dir / "chipblocks.bin"
    icepack_log = run_step(
        "icepack",
        ["icepack", asc_path.name, bin_path.name],
        cwd=out_dir,
    )

    return {
        "verilog": str(verilog_path),
        "pcf": str(pcf_path),
        "json": str(json_path),
        "asc": str(asc_path),
        "bin": str(bin_path),
        "size_bytes": bin_path.stat().st_size,
        "yosys_log": yosys_log,
        "nextpnr_log": nextpnr_log,
        "icepack_log": icepack_log,
    }


# ---------------------------------------------------------------------------
# Bundle creation: zip the artifacts + auto-generated docs into a single file
# ---------------------------------------------------------------------------

FLASH_INSTRUCTIONS = """\
# Flashing chipblocks.bin to a Lattice iCEstick

## What you need

- A Lattice **iCEstick** (iCE40HX-1k dev board) — about $30 from Mouser, Digi-Key, or your favorite distributor.
- A small speaker or headphones.
- A simple RC filter (1 kΩ resistor + 100 nF capacitor) wired between the audio output pin and the speaker. The capacitor smooths the PWM into analog audio; the resistor protects the FPGA pin.
- The `iceprog` flashing tool. Install via:
  - **Ubuntu / Debian / WSL2:** `sudo apt install fpga-icestorm`
  - **Or via the OSS CAD Suite:** already included if you installed it for ChipBlocks itself.

## Steps

1. Plug the iCEstick into a USB port. It should enumerate as a USB device automatically (Windows: WinUSB driver via Zadig if needed; Linux: works out of the box).
2. Wire the audio:
    - **Pin B1** (header J3 pin 1 — top-left corner of the board) → 1 kΩ resistor → 100 nF capacitor → speaker positive
    - Speaker negative → any GND pin (header J3 pin 9–14 are all GND)
3. Flash the bitstream:
    ```bash
    iceprog chipblocks.bin
    ```
    The on-board LED blinks during programming. The chip starts running as soon as flashing finishes.
4. You should hear your chip through the speaker.

## Troubleshooting

- **`iceprog: can't find iCE FTDI USB device`** — make sure the board is plugged in. On Linux, you may need `sudo usermod -aG plugdev $USER` and log out/in for USB access.
- **Silent or noisy output** — check the RC filter values. PWM at 47 kHz needs a few kHz cutoff; 1 kΩ + 100 nF gives ~1.6 kHz. Higher capacitor values smooth more but attenuate high audio frequencies.
- **Pin numbering** — pin B1 is the top-left of the header J3 closest to the USB connector. See the [iCEstick reference](https://www.latticesemi.com/icestick) for the full pinout.
"""


def _generate_build_report(graph: dict, result: dict) -> str:
    """Auto-generate BUILD.md describing what was built and how it sized."""
    n_nodes = len(graph.get("nodes", []))
    n_edges = len(graph.get("edges", []))
    block_types = sorted({n.get("type", "?") for n in graph.get("nodes", [])})
    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    return f"""\
# ChipBlocks build report

**Built:** {timestamp}
**Target:** Lattice iCEstick (iCE40HX-1k, TQ144 package)
**Bitstream:** `chipblocks.bin` ({result["size_bytes"]:,} bytes)

## Source graph

- {n_nodes} block{"s" if n_nodes != 1 else ""}
- {n_edges} edge{"s" if n_edges != 1 else ""}
- Block types used: {", ".join(block_types) if block_types else "(none)"}

## Toolchain output

### Yosys (synthesis)

```
{result["yosys_log"][-2000:].strip()}
```

### nextpnr-ice40 (place-and-route)

```
{result["nextpnr_log"][-2000:].strip()}
```

### icepack (bitstream generation)

```
{result["icepack_log"].strip() or "(no output)"}
```

## Files in this bundle

| File | What it is |
|---|---|
| `chipblocks.bin` | The compiled iCE40 bitstream. Flash to an iCEstick with `iceprog chipblocks.bin`. |
| `chipblocks.v` | The generated Verilog source. Output of `amaranth.back.verilog.convert()` on the visual graph. Included for transparency / debugging — you don't need to flash this. |
| `chipblocks.pcf` | Pin constraint file. Maps the Verilog top module's `clk` and `audio_pin` ports to physical iCEstick pins. |
| `BUILD.md` | This file. |
| `FLASH.md` | How to flash and wire for audio out. |
"""


def make_bundle(out_dir: Path, graph: dict, result: dict) -> Path:
    """Pack the build artifacts + auto-generated docs into a single zip."""
    bundle_path = out_dir / "chipblocks-fpga.zip"
    build_md = _generate_build_report(graph, result)
    with zipfile.ZipFile(bundle_path, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(result["bin"], "chipblocks.bin")
        z.write(result["verilog"], "chipblocks.v")
        z.write(result["pcf"], "chipblocks.pcf")
        z.writestr("BUILD.md", build_md)
        z.writestr("FLASH.md", FLASH_INSTRUCTIONS)
    return bundle_path


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--in", dest="input_path", required=True)
    p.add_argument("--out-dir", dest="out_dir", required=True)
    p.add_argument(
        "--target",
        choices=["verilog", "ice40"],
        default="verilog",
        help="verilog: just emit the generated Verilog file. ice40: full pipeline through icepack.",
    )
    args = p.parse_args()

    with open(args.input_path, "r", encoding="utf-8") as f:
        graph = json.load(f)

    out_dir = Path(args.out_dir)
    n_nodes = len(graph.get("nodes", []))
    n_edges = len(graph.get("edges", []))
    print(f"[build] Graph: {n_nodes} nodes, {n_edges} edges; target={args.target}", flush=True)

    if args.target == "verilog":
        verilog_path = emit_verilog(graph, out_dir)
        print(f"[build] Wrote {verilog_path} ({verilog_path.stat().st_size} bytes)", flush=True)
        return 0

    # ice40
    result = build_ice40(graph, out_dir)
    bundle_path = make_bundle(out_dir, graph, result)
    print(
        f"[build] Wrote {result['bin']} ({result['size_bytes']} bytes)",
        flush=True,
    )
    print(f"[build] Bundle: {bundle_path} ({bundle_path.stat().st_size} bytes)", flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        sys.stderr.write(json.dumps({"error": str(e), "type": type(e).__name__}) + "\n")
        sys.exit(1)
