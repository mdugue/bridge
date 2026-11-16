"""The type check's baseline only shrinks: the comparison, the keys, the
escapes and the guards, on literal inputs; `main` with the checker's report
given (CI runs the checker itself)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import typecheck

ROOT = Path("/p")

SOURCE = """\
def fetch(tile):
    return tile.credit


class Axis:
    def project(self, p):
        return p[0]
"""


def _diag(rule: str | None, line: int, message: str = "m", severity: str = "error") -> dict:
    d = {
        "file": "/p/bake/a.py",
        "severity": severity,
        "message": message,
        "range": {"start": {"line": line - 1, "character": 4}},
    }
    if rule:
        d["rule"] = rule
    return d


def _fold(diagnostics) -> dict:
    return typecheck.fold(diagnostics, {"bake/a.py": SOURCE}, ROOT)


def test_a_finding_is_keyed_by_file_rule_symbol_and_message_never_by_line():
    folded = _fold(
        [
            _diag("reportX", 2, '"credit" is not a known\n    attribute of "None"'),
            _diag("reportX", 2, '"credit" is not a known attribute of "None"'),
            _diag("reportY", 7, "first line\n  an elaboration that is not part of the key"),
            _diag(None, 1, "on line 12 something", "warning"),
            _diag("reportZ", 7, "an information is no finding", "information"),
        ]
    )
    assert folded == {
        ("bake/a.py", "reportX", 'fetch: "credit" is not a known attribute of "None"'): 1,
        ("bake/a.py", "reportX", 'fetch: "credit" is not a known'): 1,
        ("bake/a.py", "reportY", "Axis.project: first line"): 1,
        ("bake/a.py", typecheck.NO_RULE, "fetch: on line N something"): 1,
    }


def test_a_fixed_finding_and_a_new_one_in_the_same_file_and_rule_are_no_swap():
    was = _fold([_diag("reportOptionalMemberAccess", 2, "a of None")])
    now = _fold([_diag("reportOptionalMemberAccess", 7, "b of None")])
    risen, fallen = typecheck.compare(was, now)
    assert risen == [("bake/a.py", "reportOptionalMemberAccess", "Axis.project: b of None", 0, 1)]
    assert fallen == [("bake/a.py", "reportOptionalMemberAccess", "fetch: a of None", 1, 0)]


def test_a_raised_count_fails_and_a_lowered_one_is_stale():
    key = ("bake/a.py", "reportX", "f: m")
    assert typecheck.compare({key: 2}, {key: 3}) == ([(*key, 2, 3)], [])
    assert typecheck.compare({key: 2}, {key: 1}) == ([], [(*key, 2, 1)])


def test_update_lowers_and_drops_what_is_gone():
    a, b = ("bake/a.py", "reportX", "f: m"), ("bake/b.py", "reportX", "g: m")
    base = typecheck.to_json("pyright 1", {a: 2, b: 1})
    assert typecheck.from_json(typecheck.updated(base, "pyright 1", {a: 1})) == {a: 1}


def test_update_never_raises_unless_the_checker_moved():
    a = ("bake/a.py", "reportX", "f: m")
    base = typecheck.to_json("pyright 1", {a: 2})
    with pytest.raises(ValueError, match=r"bake/a.py reportX \[f: m\] 2 -> 3"):
        typecheck.updated(base, "pyright 1", {a: 3})
    assert typecheck.from_json(typecheck.updated(base, "pyright 2", {a: 3})) == {a: 3}


def test_escapes_are_every_way_to_silence_the_checker():
    sources = {
        "a.py": (
            "# pyright: reportOptionalMemberAccess=false\n"
            "import typing\n"
            "def f(y):\n"
            "    x = typing.cast(int, y)  # type: ignore[assignment]\n"
            "    return x  # pyright: ignore[reportReturnType]\n"
        ),
        "b.py": (
            "# pyright: basic\n"
            "from typing import cast as c, no_type_check\n"
            "@no_type_check\n"
            "def g():\n"
            "    return c(int, 1)\n"
        ),
        # The bakes' own function named cast is no escape.
        "c.py": "def cast(tiles):\n    return tiles\nseen = cast([])\n",
    }
    e = typecheck.ESCAPE
    assert typecheck.escapes(sources) == {
        ("a.py", e + "pyright: directive", "<module>"): 1,
        ("a.py", e + "typing.cast", "f"): 1,
        ("a.py", e + "type: ignore", "f"): 1,
        ("a.py", e + "pyright: ignore", "f"): 1,
        ("b.py", e + "pyright: directive", "<module>"): 1,
        ("b.py", e + "no_type_check", "g"): 1,
        ("b.py", e + "typing.cast", "g"): 1,
    }


def test_the_settings_may_not_relax_the_checker():
    good = {"tool": {"pyright": dict(typecheck.SETTINGS)}}
    assert typecheck.check_settings(good, ["pyproject.toml"]) == []
    loose = {"tool": {"pyright": {**typecheck.SETTINGS, "reportCallIssue": False}}}
    assert typecheck.check_settings(loose, [])
    assert typecheck.check_settings(good, ["pyrightconfig.json"])


def test_pyright_must_read_every_module():
    assert typecheck.check_coverage(83, 83) == []
    assert typecheck.check_coverage(0, 83)


def test_a_raise_against_the_base_needs_a_stated_reason():
    assert typecheck.raise_reason(None) is None
    assert typecheck.raise_reason({"pull_request": {"body": "no reason"}}) is None
    body = "Bump pyright.\n\nTypecheck-baseline-raise: pyright 1.1.415 reads numpy anew\n"
    assert typecheck.raise_reason({"pull_request": {"body": body}}) == (
        "pyright 1.1.415 reads numpy anew"
    )


@pytest.fixture
def run(tmp_path, monkeypatch):
    """`main` over a fake report and module set, its baseline in tmp_path."""
    baseline = tmp_path / "baseline.json"
    monkeypatch.setattr(typecheck, "BASELINE", baseline)
    monkeypatch.setattr(typecheck, "_sources", lambda: {"bake/a.py": SOURCE})

    def go(diagnostics, base, argv=(), analysed=1, against=None):
        report = {
            "version": "1",
            "summary": {"filesAnalyzed": analysed},
            "generalDiagnostics": [
                {**d, "file": str(typecheck.ROOT / d["file"][3:])} for d in diagnostics
            ],
        }
        monkeypatch.setattr(typecheck, "_run_pyright", lambda: report)
        monkeypatch.setattr(typecheck, "_base_baseline", lambda ref: against)
        baseline.write_text(json.dumps(base))
        return typecheck.main(list(argv))

    go.baseline = baseline
    return go


def test_main_passes_as_the_baseline_holds_and_fails_on_a_new_finding(run):
    one = [_diag("reportX", 2, "m")]
    base = typecheck.to_json("pyright 1", {("bake/a.py", "reportX", "fetch: m"): 1})
    assert run(one, base) == 0
    assert run([*one, _diag("reportX", 7, "m")], base) == 1
    assert run([], base) == 1  # stale


def test_main_fails_when_pyright_read_too_few_files(run):
    assert run([], typecheck.to_json("pyright 1", {}), analysed=0) == 1


def test_main_update_lowers_and_refuses_to_raise(run):
    base = typecheck.to_json("pyright 1", {("bake/a.py", "reportX", "fetch: m"): 1})
    assert run([], base, ["--update"]) == 0
    assert json.loads(run.baseline.read_text())["findings"] == {}
    assert run([_diag("reportX", 2, "m"), _diag("reportX", 2, "m")], base, ["--update"]) == 1


def test_main_against_fails_on_a_baseline_raised_by_hand(run, monkeypatch):
    key = ("bake/a.py", "reportX", "fetch: m")
    raised = typecheck.to_json("pyright 1", {key: 1})
    on_base = typecheck.to_json("pyright 1", {})
    monkeypatch.delenv("GITHUB_EVENT_PATH", raising=False)
    assert run([_diag("reportX", 2, "m")], raised, ["--against", "x"], against=on_base) == 1
    assert run([_diag("reportX", 2, "m")], raised, ["--against", "x"], against=raised) == 0
    assert run([_diag("reportX", 2, "m")], raised, ["--against", "x"], against=None) == 0


def test_main_against_allows_a_raise_the_pull_request_states(run, monkeypatch, tmp_path):
    key = ("bake/a.py", "reportX", "fetch: m")
    raised = typecheck.to_json("pyright 1", {key: 1})
    event = tmp_path / "event.json"
    event.write_text(json.dumps({"pull_request": {"body": "Typecheck-baseline-raise: a bump"}}))
    monkeypatch.setenv("GITHUB_EVENT_PATH", str(event))
    on_base = typecheck.to_json("pyright 1", {})
    assert run([_diag("reportX", 2, "m")], raised, ["--against", "x"], against=on_base) == 0
