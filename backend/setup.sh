#!/usr/bin/env bash
# setup.sh — one-time WSL2 Ubuntu setup for ChipBlocks backend.
# Installs Migen and LiteX to user-site (~/.local/) — no venv needed.
#
# Run from WSL2 Ubuntu (not Windows PowerShell):
#   cd /mnt/c/Users/micha/Desktop/chipzzzd/backend
#   bash setup.sh

set -e

echo "==> Installing Migen..."
pip3 install --user --break-system-packages migen

echo "==> Installing LiteX from git..."
pip3 install --user --break-system-packages git+https://github.com/enjoy-digital/litex.git

echo "==> Installing PyYAML (for Tiny Tapeout info.yaml emission)..."
# PyYAML is BSD-licensed and ships preinstalled on most Linux distros, but
# install explicitly so `--target tt` works on a fresh machine.
pip3 install --user --break-system-packages pyyaml

echo "==> Verifying imports..."
python3 -c 'import migen, litex, yaml; print("Migen + LiteX + PyYAML import OK")'

echo "==> Done."
echo "    Migen and LiteX are installed to ~/.local/lib/python*/site-packages/"
echo "    LiteX CLI tools (litex_sim, litex_term, etc.) are in ~/.local/bin/"
echo "    Add ~/.local/bin to PATH if you want to use them."
