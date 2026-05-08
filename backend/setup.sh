#!/usr/bin/env bash
# setup.sh — one-time WSL2 Ubuntu setup for ChipBlocks backend.
# Installs Migen and LiteX to user-site (~/.local/) — no venv needed.
#
# Run from WSL2 Ubuntu (not Windows PowerShell):
#   cd /mnt/c/Users/micha/Desktop/chipzzzd/backend
#   bash setup.sh

set -e

echo "==> Installing Amaranth (HDL frontend) and amaranth-yosys (Yosys fallback)..."
# Pinned for reproducibility across user installs and CI.
pip3 install --user --break-system-packages 'amaranth==0.5.8' amaranth-yosys

echo "==> Installing PyYAML (for Tiny Tapeout info.yaml emission)..."
pip3 install --user --break-system-packages 'pyyaml==6.0.2'

echo "==> Installing Migen + LiteX (legacy; kept for fpga_101 reference scripts)..."
pip3 install --user --break-system-packages migen
pip3 install --user --break-system-packages git+https://github.com/enjoy-digital/litex.git

echo "==> Verifying imports..."
python3 -c 'import amaranth, yaml, migen, litex; print("Amaranth + PyYAML + Migen + LiteX import OK")'

echo "==> Done."
echo "    Migen and LiteX are installed to ~/.local/lib/python*/site-packages/"
echo "    LiteX CLI tools (litex_sim, litex_term, etc.) are in ~/.local/bin/"
echo "    Add ~/.local/bin to PATH if you want to use them."
