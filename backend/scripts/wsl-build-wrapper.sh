#!/usr/bin/env bash
# Wrapper invoked by the Electron main process to run backend/build.py
# inside WSL2 with the OSS CAD Suite environment sourced. Sources are
# silenced (the env file is normal Bash, not a TTY) and we exec into
# python3 so the wrapper's process exits with python's status.
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
set -euo pipefail
if [[ -f "$HOME/oss-cad-suite/environment" ]]; then
  # shellcheck disable=SC1091
  source "$HOME/oss-cad-suite/environment" >/dev/null 2>&1
fi
exec python3 "$@"
