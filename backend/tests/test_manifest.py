"""
Manifest-integrity test (ADR-003, Sprint 21 Phase 0 step 7).

`blocks.yaml` at the repo root is the single source of truth for
cross-cutting block metadata once the Sprint-21 codegen lands. The JSON
Schema (`blocks.schema.json`) validates the *shape* of a row, but it
cannot catch the case where a row points at a Python file or class
symbol that doesn't actually exist — that's what this test is for.

Each row must satisfy three backend-side invariants:
  1. `backendPath` resolves to a real Python file under the repo root.
  2. `backendClass` is importable from the module that `backendPath`
     points at. Catches typos like `backendClass: Rom` when the file
     actually exports `ROM`.
  3. `backend/blocks/__init__.py`'s `BLOCK_REGISTRY` dict has the row's
     `type` as a key, and that key maps to a class whose `__name__`
     equals the manifest's `backendClass`. Catches the case where a
     manifest row is added but the hand-edited registry forgets it.

The test tolerates `blocks.yaml` being missing — Phase 0 has a sibling
agent authoring it in parallel. When the file is absent we skip the
suite with a clear reason. When it exists (CI + post-Phase-0 local
runs) we assert against its actual content.
"""

from __future__ import annotations

import importlib
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
MANIFEST_PATH = REPO_ROOT / "blocks.yaml"


def _load_manifest() -> list[dict] | None:
    """Return the manifest rows, or None if blocks.yaml does not exist."""
    if not MANIFEST_PATH.is_file():
        return None
    try:
        import yaml  # PyYAML
    except ImportError as exc:  # pragma: no cover — friendly bail-out path
        pytest.fail(
            "PyYAML is required to read blocks.yaml — run `pip install pyyaml` "
            f"in the backend environment. (import error: {exc})"
        )
    with MANIFEST_PATH.open("r", encoding="utf-8") as f:
        parsed = yaml.safe_load(f)
    if not isinstance(parsed, list):
        pytest.fail(
            f"blocks.yaml must be a YAML array of block rows; got {type(parsed).__name__}"
        )
    return parsed


_manifest = _load_manifest()
_rows: list[dict] = _manifest or []
_skip_reason = (
    None
    if _manifest is not None
    else f"blocks.yaml not present at {MANIFEST_PATH} — Phase 0 manifest authoring in flight"
)


def _row_id(row: dict) -> str:
    return str(row.get("type", "<unnamed>"))


@pytest.mark.skipif(_skip_reason is not None, reason=_skip_reason or "")
@pytest.mark.parametrize("row", _rows, ids=_row_id)
def test_backend_path_file_exists(row: dict) -> None:
    full_path = REPO_ROOT / row["backendPath"]
    assert full_path.is_file(), (
        f"manifest row '{row['type']}' points at {row['backendPath']} "
        f"but the file does not exist"
    )


@pytest.mark.skipif(_skip_reason is not None, reason=_skip_reason or "")
@pytest.mark.parametrize("row", _rows, ids=_row_id)
def test_backend_class_importable(row: dict) -> None:
    # backendPath like 'backend/blocks/register_file.py' -> module 'blocks.register_file'
    module_name = Path(row["backendPath"]).stem
    module = importlib.import_module(f"blocks.{module_name}")
    cls = getattr(module, row["backendClass"], None)
    assert cls is not None, (
        f"manifest row '{row['type']}' expects class {row['backendClass']!r} in "
        f"blocks.{module_name}, but that attribute does not exist on the module"
    )


@pytest.mark.skipif(_skip_reason is not None, reason=_skip_reason or "")
@pytest.mark.parametrize("row", _rows, ids=_row_id)
def test_block_registry_has_row(row: dict) -> None:
    from blocks import BLOCK_REGISTRY

    assert row["type"] in BLOCK_REGISTRY, (
        f"manifest row '{row['type']}' is not registered in BLOCK_REGISTRY "
        f"(backend/blocks/__init__.py) — was the hand-edited registry forgotten?"
    )
    cls = BLOCK_REGISTRY[row["type"]]
    assert cls.__name__ == row["backendClass"], (
        f"BLOCK_REGISTRY['{row['type']}'] maps to {cls.__name__!r}, but the "
        f"manifest declares backendClass: {row['backendClass']!r}"
    )
