"""
Tiny Tapeout submission-bundle tests.

These verify the bundle that --target tt produces is drop-in ready: the
correct file layout, info.yaml that satisfies tt-support-tools'
yaml_version 6 schema, a wrapper with the sample-rate divider, and no
placeholder text in docs/info.md (which tt-support-tools rejects).

The validation here mirrors tt-support-tools/project_info.py and
project_checks.py as of May 2026 (TTSKY26a / TTGF26a). If TT changes
its schema we'll need to update these expectations.
"""

from __future__ import annotations

import json
import zipfile
from pathlib import Path

import pytest
import yaml


@pytest.fixture
def two_osc_graph(examples_dir: Path) -> dict:
    """A tiny 4-block graph -- enough to exercise the full TT bundle path."""
    with open(examples_dir / "two-osc-mix.json", "r", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture
def tt_bundle(tmp_path: Path, two_osc_graph: dict) -> dict:
    """Build a TT bundle in a tmp_path and return the path dict."""
    from tinytapeout import build_tinytapeout

    return build_tinytapeout(
        two_osc_graph,
        tmp_path,
        project_name="test_chip",
        author="Test Author",
        description="A test chip for the unit-test suite.",
    )


def test_bundle_zip_has_canonical_layout(tt_bundle: dict):
    """The zip's internal file layout must match the upstream
    TinyTapeout/ttsky-verilog-template repo, so users can drop the zip
    contents on top of a fresh template clone and submit."""
    bundle_path: Path = tt_bundle["bundle_path"]
    with zipfile.ZipFile(bundle_path) as z:
        names = set(z.namelist())

    expected = {
        "src/tt_top.v",
        "src/chipblocks_user.v",
        "src/config.json",
        "info.yaml",
        "docs/info.md",
        "test/Makefile",
        "test/tb.v",
        "test/test.py",
        "test/requirements.txt",
        "test/tb.gtkw",
        "README.md",
        "LICENSE",
        ".gitignore",
        "SUBMIT.md",
    }
    missing = expected - names
    assert not missing, f"Bundle is missing canonical files: {missing}"


def test_info_yaml_satisfies_tt_schema(tt_bundle: dict):
    """info.yaml must satisfy the tt-support-tools yaml_version: 6
    schema. Empty title/author/description are explicitly rejected by
    project_info.py, so we check those non-empty too."""
    yaml_path: Path = tt_bundle["info_yaml_path"]
    data = yaml.safe_load(yaml_path.read_text())

    # yaml_version
    assert data.get("yaml_version") == 6, "yaml_version must be 6"

    # project section
    proj = data["project"]
    for required in (
        "title",
        "author",
        "description",
        "language",
        "tiles",
        "top_module",
        "source_files",
        "clock_hz",
    ):
        assert required in proj, f"info.yaml missing project.{required}"

    # Empty strings rejected by tt-support-tools.
    for nonempty in ("title", "author", "description", "language"):
        assert proj[nonempty] != "", (
            f"project.{nonempty} cannot be empty (tt-support-tools rejects)"
        )

    # Top module conventions.
    assert proj["top_module"].startswith("tt_um_"), (
        f"top_module {proj['top_module']!r} must start with tt_um_"
    )

    # source_files must be a list with at least one entry.
    assert isinstance(proj["source_files"], list)
    assert len(proj["source_files"]) > 0
    # Source files are bare names relative to src/, NOT prefixed paths.
    for sf in proj["source_files"]:
        assert "/" not in sf, f"source_files entry {sf!r} must be a bare filename"

    # Tiles is one of the allowed values.
    assert proj["tiles"] in {
        "1x1", "1x2", "2x2", "3x2", "4x2", "6x2", "8x2",
        "3x4", "4x4", "5x4", "6x4", "8x4",
    }

    # clock_hz must be a positive int (project_info.py requires int).
    assert isinstance(proj["clock_hz"], int)
    assert proj["clock_hz"] > 0

    # Pinout: all 24 keys (ui[0..7], uo[0..7], uio[0..7]) must be present,
    # even if blank. tt-support-tools rejects missing keys.
    pinout = data["pinout"]
    for prefix, count in [("ui", 8), ("uo", 8), ("uio", 8)]:
        for i in range(count):
            key = f"{prefix}[{i}]"
            assert key in pinout, f"info.yaml missing pinout.{key}"


def test_docs_info_md_has_no_placeholder_text(tt_bundle: dict):
    """tt-support-tools/project_checks.py rejects the submission if
    docs/info.md still contains the upstream template's placeholder
    strings. Make sure ours doesn't."""
    docs_path: Path = tt_bundle["docs_path"]
    text = docs_path.read_text()
    for placeholder in (
        "# How it works\n\nExplain how your project works",
        "# How to test\n\nExplain how to use your project",
    ):
        assert placeholder not in text, (
            f"docs/info.md contains template placeholder: {placeholder!r}"
        )


def test_wrapper_has_sample_rate_divider(tt_bundle: dict):
    """The tt_top.v wrapper must include a sample-rate divider that
    drives sample_enable, otherwise the audio runs ~1133× too fast on
    the real chip."""
    wrapper_path: Path = tt_bundle["wrapper_path"]
    text = wrapper_path.read_text()
    # The localparam picks the divider value at compile time.
    assert "TICKS_PER_SAMPLE" in text, (
        "Wrapper missing TICKS_PER_SAMPLE constant -- audio will run "
        "at chip clock rate, not audio sample rate"
    )
    # The wrapper must drive sample_enable on the inner module.
    assert ".sample_enable" in text, (
        "Wrapper not connecting sample_enable to inner module"
    )


def test_inner_verilog_has_sample_enable_port(tt_bundle: dict):
    """The Amaranth-emitted inner module must expose `sample_enable`
    for the wrapper to drive. Verifies EnableInserter is wiring through."""
    verilog_path: Path = tt_bundle["verilog_path"]
    text = verilog_path.read_text()
    assert "sample_enable" in text, (
        "Inner Verilog module is missing sample_enable port -- the "
        "EnableInserter is not wired correctly"
    )
    # And the gating must reach at least one always-block (where the
    # inner flip-flops live).
    assert "if (sample_enable)" in text, (
        "Inner Verilog has sample_enable port but no always-block "
        "actually gated by it"
    )


def test_top_module_is_unique_per_call(tmp_path: Path, two_osc_graph: dict):
    """When --project-name is not specified, each build should generate
    a unique top_module slug so two ChipBlocks users don't collide on
    the shuttle."""
    from tinytapeout import build_tinytapeout

    a = build_tinytapeout(two_osc_graph, tmp_path / "a")
    b = build_tinytapeout(two_osc_graph, tmp_path / "b")
    assert a["tt_module"] != b["tt_module"], (
        "Auto-generated top modules collided -- uniqueness suffix not working"
    )
    assert a["tt_module"].startswith("tt_um_chipblocks_"), a["tt_module"]


def test_explicit_project_name_overrides_slug(tmp_path: Path, two_osc_graph: dict):
    """When --project-name is supplied, the top module should reflect it."""
    from tinytapeout import build_tinytapeout

    result = build_tinytapeout(
        two_osc_graph, tmp_path, project_name="my_arpeggio_chip"
    )
    assert result["tt_module"] == "tt_um_my_arpeggio_chip", result["tt_module"]


def test_test_py_targets_correct_top_module(tt_bundle: dict):
    """The cocotb tb.v must instantiate our wrapper's actual module
    name -- not 'tt_um_example' from the upstream template."""
    tb_path: Path = tt_bundle["test_tb_v_path"]
    text = tb_path.read_text()
    assert tt_bundle["tt_module"] in text, (
        f"test/tb.v doesn't reference {tt_bundle['tt_module']!r}"
    )
    assert "tt_um_example" not in text, (
        "test/tb.v still references the upstream tt_um_example -- not customised"
    )
