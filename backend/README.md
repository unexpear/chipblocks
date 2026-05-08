# ChipBlocks Backend

Python-based chip design and simulation pipeline. Runs in **WSL2 Ubuntu** (not Windows PowerShell).

## One-time setup

From a WSL2 Ubuntu shell:

```bash
cd /mnt/c/Users/micha/Desktop/chipzzzd/backend
bash setup.sh
```

This installs **Migen** (HDL library) and **LiteX** (chip-composition framework) to your user-site (`~/.local/`). No virtual environment required because the installs use `--user` and `--break-system-packages` to coexist with the Ubuntu system Python.

## Verify

```bash
python3 -c 'import migen, litex; print("backend OK")'
```

Should print `backend OK`.

## Running tests

The backend has a smoke-level pytest suite under `backend/tests/`. It wires small graphs through the full synth pipeline and asserts gross properties of the generated audio (zero-crossing counts, silence vs non-silence, filter attenuation, etc.) — not bit-exact sample values, which would over-specify the implementation.

One-time install of the dev requirements:

```bash
pip3 install --user --break-system-packages -r requirements-dev.txt
```

Run the suite from a WSL2 Ubuntu shell:

```bash
cd /mnt/c/Users/micha/Desktop/chipzzzd/backend
python3 -m pytest tests/ -v
```

Expected runtime is under a minute on a modern machine. The suite needs the same Amaranth install that `synth.py` uses — no extra system packages or simulators required.

## Quick test — run the PWM example

```bash
git clone --depth 1 https://github.com/litex-hub/fpga_101.git fpga_101
cd fpga_101/lab004
python3 pwm.py
ls *.vcd  # should produce pwm.vcd
```

`pwm.vcd` is a waveform dump (Value Change Dump). For ChipBlocks's licensing posture (permissive only — see [CREDITS.md](../CREDITS.md)), we don't recommend GTKWave (GPL-2.0) or Surfer (EUPL-1.2) as bundled viewers. For the audio domain, simulation output goes to a `.wav` file you can play directly. A permissive built-in waveform view is planned for later phases.

## FPGA toolchain (Sprint 6+)

For the **Build for FPGA** pipeline, ChipBlocks needs Yosys + nextpnr-ice40 + icepack on PATH inside WSL2. We use the [YosysHQ OSS CAD Suite](https://github.com/YosysHQ/oss-cad-suite-build/releases) — a single tarball with all the open-source FPGA tools (Yosys, nextpnr, project IceStorm, etc.). All ISC / MIT / Apache licensed.

### One-time install in WSL2

```bash
# Download (~700 MB) and extract:
mkdir -p ~/oss-cad-suite-dl
cd ~/oss-cad-suite-dl
URL=$(curl -s https://api.github.com/repos/YosysHQ/oss-cad-suite-build/releases/latest \
  | python3 -c 'import sys,json; print([a["browser_download_url"] for a in json.load(sys.stdin)["assets"] if "linux-x64" in a["name"] and a["name"].endswith(".tgz")][0])')
curl -L -o oss-cad-suite.tgz "$URL"
cd ~ && tar -xzf ~/oss-cad-suite-dl/oss-cad-suite.tgz
rm -rf ~/oss-cad-suite-dl
```

This installs to `~/oss-cad-suite/` (~2.4 GB after extract).

### Activating the toolchain

Each WSL2 shell that needs the FPGA tools should `source ~/oss-cad-suite/environment` first. The Electron main process invokes the build pipeline via:

```
wsl bash -c "source ~/oss-cad-suite/environment && python3 backend/build.py ..."
```

so it picks up the toolchain at every build.

If you'd rather have the toolchain on PATH in every shell, append to `~/.bashrc`:
```bash
[ -f ~/oss-cad-suite/environment ] && source ~/oss-cad-suite/environment
```

### Verify the install

```bash
source ~/oss-cad-suite/environment
yosys --version          # → Yosys 0.64+...
nextpnr-ice40 --version  # → "nextpnr-ice40" -- ... 0.10-...
icepack -h | head -1     # → Usage: ... icepack [options] ...
```

If those three work, `Build for FPGA` will run end-to-end.

## Reference: fpga_101

The [`litex-hub/fpga_101`](https://github.com/litex-hub/fpga_101) repo is cloned to `backend/fpga_101/` as a reference (gitignored — re-clone if missing). The [`lab004/pwm.py`](https://github.com/litex-hub/fpga_101/blob/master/lab004/pwm.py) example is our starting point for Sprint 1 Item 6 (PWM → playable WAV file).

## Planned layout

```
backend/
├── README.md           # this file
├── setup.sh            # one-time Migen + LiteX install
├── .gitignore
├── fpga_101/           # cloned reference (gitignored)
├── blocks/             # (Sprint 2+) Python block library matching frontend shapes
├── sim/                # (Sprint 2+) simulation runners
└── output/             # (Sprint 2+) WAV / RTL / bitstream outputs
```
