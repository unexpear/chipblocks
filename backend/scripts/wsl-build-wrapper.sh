#!/usr/bin/env bash
# Wrapper invoked by the Electron main process to run backend/build.py
# inside WSL2 with the OSS CAD Suite environment sourced. Sources are
# silenced (the env file is normal Bash, not a TTY) and we exec into
# python so the wrapper's process exits with python's status.
#
# Argument order:
#   $1   absolute path to backend/build.py inside WSL2
#   "$@" remaining args passed straight to build.py
#
# Why a wrapper instead of `bash -c "<innerCmd>"`? The previous shape
# interpolated path strings into a single command line, which only stays
# safe so long as every interpolation is run through shellQuote. A
# wrapper lets the Electron side use argv-only spawn — no shell parsing
# of caller-supplied values, so a future graph-derived argument can't
# escape into a command no matter how it's quoted.
#
# Why pin to /usr/bin/python3 instead of bare `python3`? Sourcing the
# OSS CAD Suite environment puts its bundled `py3bin/` first on PATH, so
# `python3` then resolves to OSS-CAD-Suite-Python (currently 3.11). That
# Python has amaranth baked into its site-packages but NOT pyyaml — so a
# Tiny Tapeout build would die at `import yaml` even though setup.sh
# installed pyyaml fine. Pinning to /usr/bin/python3 (system Python 3.12)
# uses the same interpreter setup.sh installed amaranth + pyyaml + migen
# + litex into via `pip install --user`. The OSS CAD Suite binaries
# (yosys, nextpnr-ice40, icepack) are still on PATH for build.py's
# subprocess calls — only the Python interpreter changes.
set -euo pipefail
if [[ -f "$HOME/oss-cad-suite/environment" ]]; then
  # shellcheck disable=SC1091
  source "$HOME/oss-cad-suite/environment" >/dev/null 2>&1
fi
exec /usr/bin/python3 "$@"
