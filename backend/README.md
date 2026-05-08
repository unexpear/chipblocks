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

## Quick test — run the PWM example

```bash
git clone --depth 1 https://github.com/litex-hub/fpga_101.git fpga_101
cd fpga_101/lab004
python3 pwm.py
ls *.vcd  # should produce pwm.vcd
```

`pwm.vcd` is a waveform dump (Value Change Dump). For ChipBlocks's licensing posture (permissive only — see [CREDITS.md](../CREDITS.md)), we don't recommend GTKWave (GPL-2.0) or Surfer (EUPL-1.2) as bundled viewers. For the audio domain, simulation output goes to a `.wav` file you can play directly. A permissive built-in waveform view is planned for later phases.

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
