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
import re
import shutil
import subprocess
import sys
import time
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


def run_step(name: str, args: list[str], cwd: Path) -> tuple[str, float]:
    """Run one toolchain step. Returns (combined stdout+stderr, wall-clock
    seconds); raises on non-zero exit. The combined output goes into the
    build report; the duration goes into the per-tool timing summary."""
    start = time.monotonic()
    proc = subprocess.run(
        args,
        cwd=str(cwd),
        capture_output=True,
        text=True,
        check=False,
    )
    duration = time.monotonic() - start
    out = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode != 0:
        raise RuntimeError(f"{name} failed (exit {proc.returncode}):\n{out[-2000:]}")
    return out, duration


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

    # 2. Yosys synth.
    # NB: don't pass `-q`. We parse the cell-count statistics from Yosys's
    # stdout for the BUILD.md utilisation report, and `-q` suppresses them.
    json_path = out_dir / "chipblocks.json"
    yosys_log, yosys_duration = run_step(
        "yosys",
        [
            "yosys",
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
    # NB: don't pass `--quiet`. The "Device utilisation" block and
    # "Max frequency for clock" lines we parse for BUILD.md only appear at
    # the default verbosity.
    asc_path = out_dir / "chipblocks.asc"
    nextpnr_log, nextpnr_duration = run_step(
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
        ],
        cwd=out_dir,
    )

    # 4. icepack -> .bin
    bin_path = out_dir / "chipblocks.bin"
    icepack_log, icepack_duration = run_step(
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
        "yosys_duration_s": yosys_duration,
        "nextpnr_log": nextpnr_log,
        "nextpnr_duration_s": nextpnr_duration,
        "icepack_log": icepack_log,
        "icepack_duration_s": icepack_duration,
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


def parse_utilization(yosys_out: str, nextpnr_out: str) -> dict:
    """Extract structured utilisation + timing info from raw tool stdout.

    Yosys gives us cell counts (SB_LUT4, SB_DFF*, SB_CARRY, etc.). nextpnr
    gives us LC / RAM / IO / global-buffer percentages and the achievable
    max frequency. Each piece is best-effort: if a field can't be parsed,
    it comes back as `None` and the BUILD.md template renders an em-dash.

    These regexes are nextpnr-ice40 / synth_ice40 specific. They were
    written against:
      - Yosys 0.64+197 (synth_ice40)
      - nextpnr-ice40 0.10-65
    Future tool releases may shift the wording; the per-field None
    fallback means a reformat won't break the whole report — just the
    field that moved.
    """
    info: dict = {
        "luts_used": None,
        "luts_avail": None,  # ICESTORM_LC total — not LUT4-specific
        "dffs_used": None,
        "dffs_avail": None,
        "lcs_used": None,
        "lcs_avail": None,
        "lcs_pct": None,
        "brams_used": None,
        "brams_avail": None,
        "ios_used": None,
        "ios_avail": None,
        "globals_used": None,
        "globals_avail": None,
        "max_freq_mhz": None,
        "target_freq_mhz": None,
        "timing_pass": None,
        "clock_name": None,
        "cell_counts": {},
    }

    # --- Yosys: cell counts -------------------------------------------------
    # synth_ice40 prints a "=== top ===" block at the very end with the final
    # cell breakdown. Grab everything from the LAST occurrence of "=== top ==="
    # up to the next "=== ... ===" header (or end of string).
    top_blocks = list(re.finditer(r"=== top ===", yosys_out))
    if top_blocks:
        start = top_blocks[-1].end()
        rest = yosys_out[start:]
        next_header = re.search(r"^===", rest, re.MULTILINE)
        block = rest[: next_header.start()] if next_header else rest
        # Inside the block, lines like "       70   SB_LUT4" are submodule cell
        # counts (3-space indent before name, multiple-space indent before count).
        for m in re.finditer(
            r"^\s+(?P<count>\d+)\s{2,}(?P<cell>SB_[A-Z0-9_]+)\s*$",
            block,
            re.MULTILINE,
        ):
            info["cell_counts"][m.group("cell")] = int(m.group("count"))

    # --- nextpnr: LUT / DFF breakdown --------------------------------------
    # Earlier in the run, nextpnr prints LC packing stats:
    #   Info:       15 LCs used as LUT4 only
    #   Info:       55 LCs used as LUT4 and DFF
    #   Info:        0 LCs used as DFF only
    #   Info:        9 LCs used as CARRY only
    # An LC contains both a LUT4 and a DFF; "used as LUT4 and DFF" counts as
    # both a LUT and a DFF. CARRY-only LCs use the carry chain hardware, not
    # the LUT4, so we don't count them as LUTs.
    luts_only = _grep_int(nextpnr_out, r"Info:\s+(\d+) LCs used as LUT4 only")
    luts_and_dff = _grep_int(nextpnr_out, r"Info:\s+(\d+) LCs used as LUT4 and DFF")
    dffs_only = _grep_int(nextpnr_out, r"Info:\s+(\d+) LCs used as DFF only")
    if luts_only is not None and luts_and_dff is not None:
        info["luts_used"] = luts_only + luts_and_dff
    if luts_and_dff is not None and dffs_only is not None:
        info["dffs_used"] = luts_and_dff + dffs_only

    # --- nextpnr: Device utilisation block ---------------------------------
    # Lines like:
    #   Info: 	         ICESTORM_LC:      76/   1280     5%
    #   Info: 	        ICESTORM_RAM:       0/     16     0%
    #   Info: 	               SB_IO:       3/     96     3%
    #   Info: 	               SB_GB:       2/      8    25%
    util_pat = re.compile(
        r"Info:\s+(?P<resource>[A-Z][A-Z0-9_]+):\s+(?P<used>\d+)\s*/\s*(?P<avail>\d+)\s+(?P<pct>\d+)%"
    )
    for m in util_pat.finditer(nextpnr_out):
        used = int(m.group("used"))
        avail = int(m.group("avail"))
        pct = int(m.group("pct"))
        resource = m.group("resource")
        if resource == "ICESTORM_LC":
            info["lcs_used"] = used
            info["lcs_avail"] = avail
            info["lcs_pct"] = pct
            # Use total LCs as the LUT/DFF pool. iCE40 LCs are a shared
            # LUT4+DFF resource, so this is the closest single "available"
            # number for both rows in the utilisation table.
            if info["luts_avail"] is None:
                info["luts_avail"] = avail
            if info["dffs_avail"] is None:
                info["dffs_avail"] = avail
        elif resource == "ICESTORM_RAM":
            info["brams_used"] = used
            info["brams_avail"] = avail
        elif resource == "SB_IO":
            info["ios_used"] = used
            info["ios_avail"] = avail
        elif resource == "SB_GB":
            info["globals_used"] = used
            info["globals_avail"] = avail

    # --- nextpnr: timing ---------------------------------------------------
    # "Info: Max frequency for clock 'NAME': N.NN MHz (PASS at Y.YY MHz)"
    # nextpnr prints this twice — once after placement, once after routing.
    # The post-routing number is the authoritative one; take the LAST match.
    freq_pat = re.compile(
        r"Info: Max frequency for clock '(?P<clk>[^']+)': "
        r"(?P<freq>\d+\.\d+) MHz \((?P<status>PASS|FAIL) at (?P<target>\d+\.\d+) MHz\)"
    )
    matches = list(freq_pat.finditer(nextpnr_out))
    if matches:
        m = matches[-1]
        info["clock_name"] = m.group("clk")
        info["max_freq_mhz"] = float(m.group("freq"))
        info["target_freq_mhz"] = float(m.group("target"))
        info["timing_pass"] = m.group("status") == "PASS"

    return info


def _grep_int(text: str, pattern: str) -> int | None:
    """First int captured by `pattern` in `text`, or None if no match."""
    m = re.search(pattern, text)
    return int(m.group(1)) if m else None


def _fmt_pct(used: int | None, avail: int | None) -> str:
    """Render `used / avail * 100` as "N%" or "—" when either is missing."""
    if used is None or avail is None or avail == 0:
        return "—"
    return f"{used / avail * 100:.0f}%"


def _fmt_or_dash(value) -> str:
    """Render `value` as a string, or em-dash when it's None."""
    return "—" if value is None else str(value)


def _fmt_duration(seconds: float | None) -> str:
    """Render a wall-clock duration as e.g. "1.04 s" or "(not measured)"."""
    if seconds is None:
        return "(not measured)"
    return f"{seconds:.2f} s"


def _generate_build_report(graph: dict, result: dict) -> str:
    """Auto-generate BUILD.md describing what was built and how it sized.

    The report has a structured summary up top (utilisation, timing, cell
    breakdown, bitstream metadata) followed by collapsible blocks of raw
    tool output for debugging. The collapsibles render in GitHub Markdown
    via <details> / <summary>; in plain-text viewers the user just sees
    everything inline."""
    n_nodes = len(graph.get("nodes", []))
    n_edges = len(graph.get("edges", []))
    block_types = sorted({n.get("type", "?") for n in graph.get("nodes", [])})
    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    util = parse_utilization(result.get("yosys_log", ""), result.get("nextpnr_log", ""))

    # Utilisation table rows.
    lut_row = (
        f"| LUTs (LC) | {_fmt_or_dash(util['luts_used'])} | "
        f"{_fmt_or_dash(util['luts_avail'])} | "
        f"{_fmt_pct(util['luts_used'], util['luts_avail'])} |"
    )
    dff_row = (
        f"| Flip-flops (DFF) | {_fmt_or_dash(util['dffs_used'])} | "
        f"{_fmt_or_dash(util['dffs_avail'])} | "
        f"{_fmt_pct(util['dffs_used'], util['dffs_avail'])} |"
    )
    lc_row = (
        f"| Logic cells (total) | {_fmt_or_dash(util['lcs_used'])} | "
        f"{_fmt_or_dash(util['lcs_avail'])} | "
        f"{_fmt_pct(util['lcs_used'], util['lcs_avail'])} |"
    )
    bram_row = (
        f"| BRAMs | {_fmt_or_dash(util['brams_used'])} | "
        f"{_fmt_or_dash(util['brams_avail'])} | "
        f"{_fmt_pct(util['brams_used'], util['brams_avail'])} |"
    )
    io_row = (
        f"| IOs | {_fmt_or_dash(util['ios_used'])} | "
        f"{_fmt_or_dash(util['ios_avail'])} | "
        f"{_fmt_pct(util['ios_used'], util['ios_avail'])} |"
    )
    gb_row = (
        f"| Global buffers | {_fmt_or_dash(util['globals_used'])} | "
        f"{_fmt_or_dash(util['globals_avail'])} | "
        f"{_fmt_pct(util['globals_used'], util['globals_avail'])} |"
    )

    # Timing summary.
    if util["max_freq_mhz"] is not None and util["target_freq_mhz"] is not None:
        pass_str = "**PASS** (target met)" if util["timing_pass"] else "**FAIL** (target NOT met)"
        timing_lines = (
            f"- Clock: `{util['clock_name'] or '?'}` "
            f"({util['target_freq_mhz']:.2f} MHz target)\n"
            f"- Max achievable frequency: {util['max_freq_mhz']:.2f} MHz — {pass_str}"
        )
    else:
        timing_lines = "- Timing data not parsed from nextpnr output (see raw log below)."

    # Cell breakdown — top 10 by count, descending.
    cell_counts = util.get("cell_counts", {})
    if cell_counts:
        top_cells = sorted(cell_counts.items(), key=lambda kv: -kv[1])[:10]
        cell_lines = "\n".join(f"- `{name}`: {count}" for name, count in top_cells)
        total_cells = sum(cell_counts.values())
        cell_lines += f"\n- **Total: {total_cells}**"
    else:
        cell_lines = "- (no cell counts parsed from Yosys output)"

    # Per-tool durations and versions.
    yosys_dur = _fmt_duration(result.get("yosys_duration_s"))
    nextpnr_dur = _fmt_duration(result.get("nextpnr_duration_s"))
    icepack_dur = _fmt_duration(result.get("icepack_duration_s"))

    # Last 2 KB of each tool's stdout — useful for debugging without
    # drowning the user in 1000+ lines of synth log.
    yosys_tail = result.get("yosys_log", "")[-2000:].strip()
    nextpnr_tail = result.get("nextpnr_log", "")[-2000:].strip()
    icepack_tail = result.get("icepack_log", "").strip() or "(no output)"

    return f"""\
# ChipBlocks FPGA Build Report

**Generated:** {timestamp}
**Target:** Lattice iCEstick (iCE40HX-1k, TQ144 package)
**Source graph:** {n_nodes} node{"s" if n_nodes != 1 else ""}, {n_edges} edge{"s" if n_edges != 1 else ""}
**Block types:** {", ".join(block_types) if block_types else "(none)"}

## Utilization

| Resource | Used | Available | % |
|---|---|---|---|
{lut_row}
{dff_row}
{lc_row}
{bram_row}
{io_row}
{gb_row}

LUTs and flip-flops both live inside iCE40 logic cells (LCs); the same LC can host one of each. The "Logic cells (total)" row is the underlying pool nextpnr reports against.

## Timing

{timing_lines}

## Cell breakdown (Yosys)

{cell_lines}

## Bitstream

- Output: `chipblocks.bin` ({result["size_bytes"]:,} bytes)
- Synth: Yosys `synth_ice40` — completed in {yosys_dur}
- PnR: nextpnr-ice40 — completed in {nextpnr_dur}
- Pack: icepack — completed in {icepack_dur}

## Files in this bundle

| File | What it is |
|---|---|
| `chipblocks.bin` | The compiled iCE40 bitstream. Flash to an iCEstick with `iceprog chipblocks.bin`. |
| `chipblocks.v` | The generated Verilog source. Output of `amaranth.back.verilog.convert()` on the visual graph. Included for transparency / debugging — you don't need to flash this. |
| `chipblocks.pcf` | Pin constraint file. Maps the Verilog top module's `clk` and `audio_pin` ports to physical iCEstick pins. |
| `BUILD.md` | This file. |
| `FLASH.md` | How to flash and wire for audio out. |

## Raw tool output

<details>
<summary>Yosys (last 2 KB of synth log)</summary>

```
{yosys_tail}
```
</details>

<details>
<summary>nextpnr-ice40 (last 2 KB of PnR log)</summary>

```
{nextpnr_tail}
```
</details>

<details>
<summary>icepack</summary>

```
{icepack_tail}
```
</details>
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
