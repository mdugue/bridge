"""The type check's baseline only shrinks: the comparison alone, on literal
reports (CI runs the checker itself)."""

from __future__ import annotations

from pathlib import Path

import pytest

import typecheck

ROOT = Path("/p")


def _report(findings: dict, escapes: dict | None = None) -> dict:
    return {
        "checker": "pyright 1.0",
        "escapes": escapes or {"type: ignore": 1},
        "findings": findings,
    }


def _diag(file: str, rule: str | None, severity: str = "error") -> dict:
    d = {"file": f"/p/{file}", "severity": severity, "message": "m", "range": {}}
    if rule:
        d["rule"] = rule
    return d


def test_findings_fold_to_file_and_rule_without_lines():
    folded = typecheck.fold(
        [
            _diag("bake/a.py", "reportX"),
            _diag("bake/a.py", "reportX"),
            _diag("bake/a.py", "reportY", "warning"),
            _diag("bake/b.py", None),
            _diag("bake/b.py", "reportX", "information"),
        ],
        ROOT,
    )
    assert folded == {
        "bake/a.py": {"reportX": 2, "reportY": 1},
        "bake/b.py": {typecheck.NO_RULE: 1},
    }


def test_a_raised_count_fails_and_names_the_file_and_rule():
    base = _report({"bake/a.py": {"reportX": 2}})
    risen, fallen = typecheck.compare(base, _report({"bake/a.py": {"reportX": 3}}))
    assert risen == [("bake/a.py", "reportX", 2, 3)]
    assert fallen == []


def test_a_file_or_rule_the_baseline_lacks_is_a_failure_not_a_pass():
    base = _report({"bake/a.py": {"reportX": 2}})
    risen, _ = typecheck.compare(
        base, _report({"bake/a.py": {"reportX": 2, "reportNew": 1}, "bake/new.py": {"reportX": 1}})
    )
    assert risen == [("bake/a.py", "reportNew", 0, 1), ("bake/new.py", "reportX", 0, 1)]


def test_a_lowered_count_is_stale():
    base = _report({"bake/a.py": {"reportX": 2, "reportY": 1}})
    risen, fallen = typecheck.compare(base, _report({"bake/a.py": {"reportX": 1}}))
    assert risen == []
    assert fallen == [("bake/a.py", "reportX", 2, 1), ("bake/a.py", "reportY", 1, 0)]


def test_an_escape_counts_like_a_finding():
    base = _report({}, {"type: ignore": 5})
    risen, _ = typecheck.compare(base, _report({}, {"type: ignore": 6}))
    assert risen == [("escapes", "type: ignore", 5, 6)]


def test_update_lowers_and_drops_what_is_gone():
    base = _report({"bake/a.py": {"reportX": 2, "reportY": 1}, "bake/b.py": {"reportX": 1}})
    new = typecheck.updated(base, _report({"bake/a.py": {"reportX": 1}}))
    assert new["findings"] == {"bake/a.py": {"reportX": 1}}


def test_update_never_raises():
    base = _report({"bake/a.py": {"reportX": 2}})
    with pytest.raises(ValueError, match="bake/a.py reportX 2 -> 3"):
        typecheck.updated(base, _report({"bake/a.py": {"reportX": 3}, "bake/b.py": {}}))
    with pytest.raises(ValueError, match="escapes"):
        typecheck.updated(base, _report({"bake/a.py": {"reportX": 1}}, {"type: ignore": 2}))


def test_escapes_count_ignore_comments_and_typing_casts_only():
    sources = {
        "a.py": "import typing\nx = typing.cast(int, y)  # type: ignore[assignment]\n",
        "b.py": "from typing import cast as c\nz = c(int, 1)  # pyright: ignore\n",
        # The bakes' own function named cast is no escape.
        "c.py": "def cast(tiles):\n    return tiles\nseen = cast([])\n",
    }
    assert typecheck.escapes(sources) == {"type: ignore": 1, "pyright: ignore": 1, "typing.cast": 2}
