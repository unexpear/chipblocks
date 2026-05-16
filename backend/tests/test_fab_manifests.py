"""
Fab manifests validation test (ADR-005, Sprint 25 Phase 0 step 1).

Eight manifests at the repo root describe the modular fab platform:
shuttles.yaml, pdks.yaml, packages.yaml, flows.yaml (the four active in
Phase 0) plus cpu-cores.yaml, radios.yaml, buses.yaml, memories.yaml
(the four deferred to S26-S31). Each has a sibling JSON Schema
(<name>.schema.json) defining row shape.

This test does the structural validation that schemas alone can do:
each manifest file parses as YAML, each manifest validates against its
schema, each FK reference (e.g. shuttles.yaml.pdk -> pdks.yaml.id)
resolves. Behavioral validation (e.g. does an FPGABoard adapter at the
referenced path actually export the right methods) is deferred to the
adapter-integrity tests that land alongside the build.py refactor in
Phase 0 step 5+.

The test tolerates manifests being missing — Phase 0 lands the
manifests one PR at a time, and during that interval some files may
not yet exist. When a manifest is absent we skip its assertions with a
clear reason. When all eight exist (CI on the closing Phase 0 commit
and forward) we assert against actual content.
"""

from __future__ import annotations

from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


# The 8 manifests + their schemas. Order matches ADR-005's listing order:
# active dimensions first (with rows in Phase 0), deferred ones last.
MANIFESTS = [
    ("shuttles", True),    # active in Phase 0
    ("pdks", True),
    ("packages", True),
    ("flows", True),
    ("cpu-cores", False),  # deferred — empty in Phase 0
    ("radios", False),
    ("buses", False),
    ("memories", False),
]


def _load_yaml(path: Path) -> list[dict] | None:
    if not path.is_file():
        return None
    try:
        import yaml  # PyYAML
    except ImportError as exc:
        pytest.fail(
            "PyYAML is required to read fab manifests — "
            f"run `pip install pyyaml`. (import error: {exc})"
        )
    with path.open("r", encoding="utf-8") as f:
        parsed = yaml.safe_load(f)
    # Allow a fully-empty YAML file (None) to mean empty array
    if parsed is None:
        return []
    if not isinstance(parsed, list):
        pytest.fail(
            f"{path.name} must be a YAML array at the top level; "
            f"got {type(parsed).__name__}."
        )
    return parsed


def _load_schema(path: Path) -> dict | None:
    if not path.is_file():
        return None
    import json
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


@pytest.mark.parametrize("name,active_in_phase_0", MANIFESTS)
def test_manifest_validates_against_schema(name: str, active_in_phase_0: bool) -> None:
    """Each fab manifest must parse as YAML + validate against its schema."""
    manifest_path = REPO_ROOT / f"{name}.yaml"
    schema_path = REPO_ROOT / f"{name}.schema.json"

    manifest = _load_yaml(manifest_path)
    schema = _load_schema(schema_path)

    if manifest is None and schema is None:
        pytest.skip(
            f"{name}.yaml and {name}.schema.json both absent — "
            "Phase 0 has not landed these yet."
        )
    if manifest is None:
        pytest.skip(f"{name}.yaml absent")
    if schema is None:
        pytest.skip(f"{name}.schema.json absent")

    try:
        import jsonschema  # MIT-licensed
    except ImportError as exc:
        pytest.fail(
            "jsonschema is required for fab-manifest validation — "
            f"run `pip install jsonschema`. (import error: {exc})"
        )

    try:
        jsonschema.validate(manifest, schema)
    except jsonschema.exceptions.ValidationError as exc:
        pytest.fail(
            f"{name}.yaml does not validate against {name}.schema.json: "
            f"{exc.message} (at path: {list(exc.absolute_path)})"
        )

    if active_in_phase_0:
        assert len(manifest) > 0, (
            f"{name}.yaml is marked active in Phase 0 but has 0 rows. "
            "Either populate the manifest or move it to the deferred list."
        )


def test_shuttles_fk_references_resolve() -> None:
    """Each shuttles.yaml row's pdk/package/flow fields must point at rows
    that actually exist in pdks.yaml / packages.yaml / flows.yaml."""
    shuttles = _load_yaml(REPO_ROOT / "shuttles.yaml")
    pdks = _load_yaml(REPO_ROOT / "pdks.yaml")
    packages = _load_yaml(REPO_ROOT / "packages.yaml")
    flows = _load_yaml(REPO_ROOT / "flows.yaml")

    if shuttles is None:
        pytest.skip("shuttles.yaml absent")

    pdk_ids = {row["id"] for row in (pdks or [])}
    package_ids = {row["id"] for row in (packages or [])}
    flow_ids = {row["id"] for row in (flows or [])}

    for row in shuttles:
        sid = row["id"]
        # FPGA boards don't reference pdks/packages — only asic-shuttle rows do.
        if row.get("kind") == "asic-shuttle":
            assert row.get("pdk") in pdk_ids, (
                f"shuttles.yaml row '{sid}' references pdk "
                f"'{row.get('pdk')}' which is not a row in pdks.yaml "
                f"(known pdks: {sorted(pdk_ids)})"
            )
            assert row.get("package") in package_ids, (
                f"shuttles.yaml row '{sid}' references package "
                f"'{row.get('package')}' which is not a row in packages.yaml"
            )
        # Every shuttle references a flow.
        assert row.get("flow") in flow_ids, (
            f"shuttles.yaml row '{sid}' references flow "
            f"'{row.get('flow')}' which is not a row in flows.yaml"
        )
