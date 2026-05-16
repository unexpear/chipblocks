#!/usr/bin/env python3
"""codegen-shuttles-backend.py — ADR-005 Phase 0 codegen for the fab platform.

Reads the four active fab manifests at the repo root:
    shuttles.yaml   (FPGA boards + ASIC shuttle tiers)
    pdks.yaml       (process nodes + cell libraries)
    packages.yaml   (physical packaging)
    flows.yaml      (build-flow toolchains)

Validates each against its sibling .schema.json, then emits a single
whole-file generated module at:

    backend/shuttles/_registry_gen.py

Containing the four manifest registries as Python dicts plus a small
ALIASES map for legacy --target argument aliases (today just
'ice40' -> 'icestick' from Sprint 6).

build.py + tinytapeout.py do NOT yet read from this module — S25-3 is
the production-code migration. This module exists in S25-2 as shadow
data, validated for fidelity against the current hardcoded constants
by backend/tests/test_fab_manifests.py.

Modes:
  --check (default) — byte-diff the generated content against the
                      existing _registry_gen.py and exit non-zero with
                      a unified diff if they diverge.
  --write           — overwrite _registry_gen.py with the generated
                      content. Used by `npm run codegen` after a
                      manifest edit.

Install (both MIT-licensed):
  pip install pyyaml jsonschema

Invocation:
  python3 scripts/codegen-shuttles-backend.py            # --check (default)
  python3 scripts/codegen-shuttles-backend.py --write    # regenerate
"""

from __future__ import annotations

import argparse
import difflib
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Manifests + their schemas this codegen reads from.
MANIFEST_FILES = ('shuttles', 'pdks', 'packages', 'flows')

# Target the codegen writes (single whole-file generated module).
TARGET = REPO_ROOT / 'backend' / 'shuttles' / '_registry_gen.py'

# Legacy aliases preserved from earlier sprints. Today only the
# Sprint 6 'ice40' -> 'icestick' alias matters; expand as needed.
ALIASES: dict[str, str] = {
    'ice40': 'icestick',
}


def _fail(msg: str, code: int = 2) -> 'None':
    sys.stderr.write(f'[codegen-shuttles-backend] {msg}\n')
    sys.exit(code)


def _load_all() -> dict[str, list[dict]]:
    """Load + validate all 4 active manifests. Returns a dict of name -> rows."""
    try:
        import yaml
        import jsonschema
    except ImportError as exc:
        _fail(
            f'missing dependency: {exc.name}. '
            'Install with `pip install pyyaml jsonschema`.'
        )

    out: dict[str, list[dict]] = {}
    for name in MANIFEST_FILES:
        manifest_path = REPO_ROOT / f'{name}.yaml'
        schema_path = REPO_ROOT / f'{name}.schema.json'
        if not manifest_path.exists():
            _fail(f'{name}.yaml not found at {manifest_path}')
        if not schema_path.exists():
            _fail(f'{name}.schema.json not found at {schema_path}')

        rows = yaml.safe_load(manifest_path.read_text(encoding='utf-8'))
        if rows is None:
            rows = []
        if not isinstance(rows, list):
            _fail(f'{name}.yaml must be a YAML array at top level')

        schema = json.loads(schema_path.read_text(encoding='utf-8'))
        validator = jsonschema.Draft7Validator(schema)
        errors = sorted(validator.iter_errors(rows), key=lambda e: list(e.absolute_path))
        if errors:
            sys.stderr.write(
                f'[codegen-shuttles-backend] {name}.yaml fails schema validation:\n'
            )
            for err in errors:
                path = '/'.join(str(p) for p in err.absolute_path) or '<root>'
                sys.stderr.write(f'  {path}: {err.message}\n')
            sys.exit(2)

        out[name] = rows

    return out


def _validate_fks(data: dict[str, list[dict]]) -> 'None':
    """Cross-manifest FK validation. Schema validation alone can't catch
    'shuttle row references a pdk that doesn't exist in pdks.yaml' — this
    function does that gap."""
    pdk_ids = {row['id'] for row in data['pdks']}
    package_ids = {row['id'] for row in data['packages']}
    flow_ids = {row['id'] for row in data['flows']}

    errors: list[str] = []
    for row in data['shuttles']:
        sid = row['id']
        if row.get('kind') == 'asic-shuttle':
            if row.get('pdk') not in pdk_ids:
                errors.append(
                    f"shuttles.yaml row '{sid}' references pdk "
                    f"'{row.get('pdk')}' not in pdks.yaml"
                )
            if row.get('package') not in package_ids:
                errors.append(
                    f"shuttles.yaml row '{sid}' references package "
                    f"'{row.get('package')}' not in packages.yaml"
                )
        if row.get('flow') not in flow_ids:
            errors.append(
                f"shuttles.yaml row '{sid}' references flow "
                f"'{row.get('flow')}' not in flows.yaml"
            )

    if errors:
        sys.stderr.write('[codegen-shuttles-backend] FK validation failed:\n')
        for e in errors:
            sys.stderr.write(f'  {e}\n')
        sys.exit(2)


def _format_dict(rows: list[dict], indent: int = 4) -> str:
    """Emit a Python dict literal keyed by row['id'], with each row's
    fields preserved in insertion order. We use repr() for value
    formatting because every value in our manifests is a primitive
    (str / int / float / bool / list / dict of primitives) — repr is
    deterministic and stable."""
    pad = ' ' * indent
    body_pad = ' ' * (indent + 4)
    out_lines = ['{']
    for row in rows:
        key = row['id']
        out_lines.append(f"{pad}{key!r}: {{")
        for k, v in row.items():
            out_lines.append(f'{body_pad}{k!r}: {v!r},')
        out_lines.append(f"{pad}}},")
    out_lines.append(f"{' ' * (indent - 4)}}}")
    return '\n'.join(out_lines)


def _generate(data: dict[str, list[dict]]) -> str:
    """Build the full content of _registry_gen.py from the loaded manifests."""
    shuttles_dict = _format_dict(data['shuttles'])
    pdks_dict = _format_dict(data['pdks'])
    packages_dict = _format_dict(data['packages'])
    flows_dict = _format_dict(data['flows'])

    aliases_lines = [f"    {k!r}: {v!r}," for k, v in ALIASES.items()]
    aliases_body = '\n'.join(aliases_lines) if aliases_lines else ''

    return f'''# This file is generated by scripts/codegen-shuttles-backend.py from
# shuttles.yaml + pdks.yaml + packages.yaml + flows.yaml. Do not edit
# by hand. See ADR-005 (../../ADR-005-modular-fab-platform.md).
"""Generated fab-platform registry.

Four manifest registries (SHUTTLES, PDKS, PACKAGES, FLOWS) loaded from
the corresponding YAML files at repo root and validated against their
JSON Schemas at codegen time, plus an ALIASES map for legacy --target
argument names. Per ADR-005, this module is the single Python-side
source of truth for fab metadata.

S25-2 status: this module is shadow data — build.py + tinytapeout.py
still use their hardcoded constants. The matching test in
backend/tests/test_fab_manifests.py asserts that this generated module
agrees with those constants field-for-field. S25-3 swaps the
production code to consume from this module.
"""

# Shuttle registry: id -> dict of fields straight from shuttles.yaml.
SHUTTLES = {shuttles_dict}

# Legacy aliases — older --target argument values mapped to current
# shuttle ids. Sprint 6 introduced 'ice40' as an alias for 'icestick';
# we preserve it so existing scripts / docs keep working unchanged.
ALIASES = {{
{aliases_body}
}}

# PDK registry: id -> dict of fields straight from pdks.yaml.
PDKS = {pdks_dict}

# Package registry: id -> dict of fields straight from packages.yaml.
PACKAGES = {packages_dict}

# Build-flow registry: id -> dict of fields straight from flows.yaml.
FLOWS = {flows_dict}


def resolve_shuttle(target: str) -> dict | None:
    """Resolve a --target argument value to a shuttle row. Handles the
    legacy ALIASES map (e.g. 'ice40' -> 'icestick'). Returns None on
    unknown target — the caller is expected to friendly-error."""
    sid = ALIASES.get(target, target)
    return SHUTTLES.get(sid)
'''


def _do_check(generated: str) -> int:
    if not TARGET.exists():
        sys.stderr.write(
            f'[codegen-shuttles-backend] target not yet authored: {TARGET}\n'
            '  Run `python3 scripts/codegen-shuttles-backend.py --write` '
            'to create it.\n'
        )
        return 1

    current = TARGET.read_text(encoding='utf-8')
    if current == generated:
        print(f'ok   {TARGET.relative_to(REPO_ROOT)} (whole file)')
        print('\n[codegen-shuttles-backend] all targets match.')
        return 0

    sys.stderr.write(
        f'[codegen-shuttles-backend] DRIFT at {TARGET.relative_to(REPO_ROOT)}:\n'
    )
    for line in difflib.unified_diff(
        current.splitlines(keepends=True),
        generated.splitlines(keepends=True),
        fromfile=str(TARGET.relative_to(REPO_ROOT)),
        tofile=f'{TARGET.relative_to(REPO_ROOT)} (from manifests)',
    ):
        sys.stderr.write(line)
    return 1


def _do_write(generated: str) -> int:
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(generated, encoding='utf-8')
    print(f'write {TARGET.relative_to(REPO_ROOT)} (whole file)')
    print('\n[codegen-shuttles-backend] all targets written.')
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument(
        '--write', action='store_true',
        help='Overwrite the generated module. Default is --check (diff-only).',
    )
    args = parser.parse_args()

    data = _load_all()
    _validate_fks(data)
    generated = _generate(data)

    return _do_write(generated) if args.write else _do_check(generated)


if __name__ == '__main__':
    sys.exit(main())
