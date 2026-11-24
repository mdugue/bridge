"""The bakes' type check against a baseline that only shrinks (plan 089).

Runs pyright over `bake/` (its settings: `[tool.pyright]` in
pyproject.toml) and counts its findings per file and rule — never by line,
so an edit above a finding moves nothing (a finding fixed and another of
the same rule added in the same file is no change: the price of a baseline
a reviewer can read). The counts are held to `typecheck-baseline.json`:

- a count above the baseline, or a key the baseline lacks: exit 1, with the
  findings of that key and their lines;
- a count below it: exit 1 too — the baseline is stale; `--update` writes
  the lower counts, and refuses while any count would rise (unless the
  checker's version changed: a bump goes in a PR of its own);
- pyright must have read every module of `bake/`.

This file lives outside `bake/`, so no step's cache key reaches it
(`bake.step_cache.code_hash`). When the baseline is empty, delete it and
this file and let pyright's exit code be the gate.

    uv run python typecheck.py            # the gate (bun run test:pipeline)
    uv run python typecheck.py --update   # write the lowered baseline
"""

from __future__ import annotations

import json
import subprocess
import sys
from collections.abc import Iterable, Mapping
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BAKE = ROOT / "bake"
BASELINE = ROOT / "typecheck-baseline.json"

# A finding pyright files under no rule (a syntax error, an import cycle).
NO_RULE = "(no rule)"

Key = tuple[str, str]  # file, rule
Counts = dict[Key, int]


def key_of(d: Mapping, root: Path = ROOT) -> Key:
    """A diagnostic's key: its file relative to `root`, and its rule."""
    file = Path(d["file"])
    if file.is_absolute() and file.is_relative_to(root):
        file = file.relative_to(root)
    return (file.as_posix(), d.get("rule") or NO_RULE)


def fold(diagnostics: Iterable[Mapping], root: Path = ROOT) -> Counts:
    """Pyright's diagnostics (`--outputjson`'s `generalDiagnostics`) as
    counts per key. An information is no finding; errors and warnings are."""
    out: Counts = {}
    for d in diagnostics:
        if d.get("severity") != "information":
            out[key_of(d, root)] = out.get(key_of(d, root), 0) + 1
    return out


def to_json(checker: str, counts: Counts) -> dict:
    """The baseline file: `{file: {rule: count}}`, sorted."""
    findings: dict[str, dict[str, int]] = {}
    for (f, rule), n in sorted(counts.items()):
        findings.setdefault(f, {})[rule] = n
    return {"checker": checker, "findings": findings}


def from_json(baseline: Mapping) -> Counts:
    return {(f, rule): n for f, rules in baseline["findings"].items() for rule, n in rules.items()}


def compare(was: Counts, now: Counts) -> tuple[list, list]:
    """(risen, fallen): each `(file, rule, was, now)`, sorted. A
    key one side lacks counts 0 there."""
    risen, fallen = [], []
    for key in sorted(was.keys() | now.keys()):
        a, b = was.get(key, 0), now.get(key, 0)
        if b != a:
            (risen if b > a else fallen).append((*key, a, b))
    return risen, fallen


def check(baseline: Mapping, checker: str, diagnostics: list[Mapping], update: bool):
    """(exit code, report lines, the baseline to write or None)."""
    now = fold(diagnostics)
    risen, fallen = compare(from_json(baseline), now)
    describe = lambda r: f"  {r[0]}: {r[1]}: {r[3]} (baseline {r[2]})"  # noqa: E731
    if update:
        if risen and checker == baseline["checker"]:
            return 1, ["Refusing to raise the baseline:", *map(describe, risen)], None
        return 0, [f"Baseline written: {sum(now.values())} findings."], to_json(checker, now)
    if risen:
        lines = ["New type findings in bake/ — fix them; the baseline only shrinks:"]
        for r in risen:
            lines.append(describe(r))
            lines += [
                f"    {r[0]}:{d['range']['start']['line'] + 1}: {d['message'].splitlines()[0]}"
                for d in diagnostics
                if key_of(d) == r[:2]
            ]
        if baseline["checker"] != checker:
            lines.append(f"(The checker moved: {baseline['checker']} -> {checker}.)")
        return 1, lines, None
    if fallen:
        return (
            1,
            [
                "Fewer type findings than the baseline holds — the baseline is stale:",
                *map(describe, fallen),
                "Run `uv run python typecheck.py --update` and commit the baseline.",
            ],
            None,
        )
    return 0, [f"Types: {sum(now.values())} findings in bake/, as the baseline holds."], None


def main(argv: list[str]) -> int:
    if argv not in ([], ["--update"]):
        print("usage: typecheck.py [--update]")
        return 2
    p = subprocess.run(
        [sys.executable, "-m", "pyright", "--outputjson"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    # exit 0 or 1 is a report; more is pyright failing (a bad setting, a crash)
    if p.returncode not in (0, 1):
        sys.exit(f"pyright failed ({p.returncode}):\n{p.stderr or p.stdout}")
    report = json.loads(p.stdout)
    modules = len(list(BAKE.rglob("*.py")))
    if report["summary"]["filesAnalyzed"] != modules:
        # an `include` that misses would pass on an empty report
        print(f"pyright analysed {report['summary']['filesAnalyzed']} files; bake/ has {modules}")
        return 1
    code, lines, new = check(
        json.loads(BASELINE.read_text()),
        f"pyright {report['version']}",
        report["generalDiagnostics"],
        argv == ["--update"],
    )
    if new is not None:
        BASELINE.write_text(json.dumps(new, indent=2, ensure_ascii=False) + "\n")
    print("\n".join(lines))
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
