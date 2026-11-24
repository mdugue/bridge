"""The type check's gate (typecheck.py, plan 089): findings are counted by
file and rule, and the counts only shrink."""

from __future__ import annotations

import typecheck

ROOT = typecheck.ROOT


def finding(message: str, file: str = "bake/a.py", line: int = 3, rule: str = "reportX"):
    return {
        "file": str(ROOT / file),
        "severity": "error",
        "message": message,
        "rule": rule,
        "range": {"start": {"line": line, "character": 0}},
    }


CHECKER = "pyright 1"
ONE = [finding('"x" is  possibly unbound\n  explained at length')]
BASELINE = typecheck.to_json(CHECKER, typecheck.fold(ONE))


def test_a_finding_is_counted_by_file_and_rule_never_by_line():
    assert BASELINE["findings"] == {"bake/a.py": {"reportX": 1}}
    moved = [finding('"x" is possibly unbound', line=40)]
    assert typecheck.check(BASELINE, CHECKER, moved, False)[0] == 0
    note = {**finding("a note"), "severity": "information"}
    assert typecheck.check(BASELINE, CHECKER, [*ONE, note], False)[0] == 0


def test_a_new_finding_fails_with_its_line():
    code, lines, new = typecheck.check(BASELINE, CHECKER, [*ONE, finding("new", line=6)], False)
    assert (code, new) == (1, None)
    assert "  bake/a.py: reportX: 2 (baseline 1)" in lines
    assert "    bake/a.py:7: new" in lines


def test_a_fixed_finding_is_a_stale_baseline_until_updated():
    code, lines, _ = typecheck.check(BASELINE, CHECKER, [], False)
    assert code == 1 and "stale" in lines[0]
    code, _, new = typecheck.check(BASELINE, CHECKER, [], True)
    assert (code, new) == (0, {"checker": CHECKER, "findings": {}})


def test_update_never_raises_unless_the_checker_moved():
    more = [*ONE, finding("new")]
    assert typecheck.check(BASELINE, CHECKER, more, True)[0] == 1
    code, _, new = typecheck.check(BASELINE, "pyright 2", more, True)
    assert code == 0 and new["checker"] == "pyright 2"
    assert typecheck.from_json(new) == typecheck.fold(more)
