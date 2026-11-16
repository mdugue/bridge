"""The bakes' type check against a baseline that only shrinks (plan 089).

Runs pyright over `bake/` (its settings: `[tool.pyright]` in
pyproject.toml), folds its findings to `{file: {rule: count}}` — no line
numbers, so an edit above a finding moves nothing — and compares them with
`typecheck-baseline.json`. It also counts the escapes in `bake/`: `type:
ignore` and `pyright: ignore` comments and calls of `typing.cast`.

- A count above the baseline, or a file or rule the baseline lacks: exit 1,
  with the findings of that file and rule and their lines.
- A count below it: exit 1 too — the baseline is stale; `--update` writes
  the lower counts, and refuses while any count would rise.

This file lives outside `bake/`, so no step's cache key reaches it
(`bake.step_cache.code_hash`). When the baseline is empty, delete it and
this file and let pyright's exit code be the gate.

    uv run python typecheck.py            # the gate (CI, bun run test:pipeline)
    uv run python typecheck.py --update   # write the lowered baseline
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import subprocess
import sys
from collections.abc import Iterable, Mapping
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BAKE = ROOT / "bake"
BASELINE = ROOT / "typecheck-baseline.json"

# A finding pyright files under no rule (a syntax error, an import cycle).
NO_RULE = "(no rule)"

Counts = dict[str, dict[str, int]]

_IGNORE = {
    "type: ignore": re.compile(r"#\s*type:\s*ignore\b"),
    "pyright: ignore": re.compile(r"#\s*pyright:\s*ignore\b"),
}


def fold(diagnostics: Iterable[Mapping], root: Path = ROOT) -> Counts:
    """Pyright's diagnostics (`--outputjson`'s `generalDiagnostics`) as
    `{file: {rule: count}}`, the file relative to `root` in POSIX form.
    An information is no finding; errors and warnings are."""
    out: Counts = {}
    for d in diagnostics:
        if d.get("severity") == "information":
            continue
        rule = d.get("rule") or NO_RULE
        f = _relative(d["file"], root)
        out.setdefault(f, {})
        out[f][rule] = out[f].get(rule, 0) + 1
    return out


def _relative(file: str, root: Path) -> str:
    p = Path(file)
    try:
        return p.resolve().relative_to(root).as_posix()
    except ValueError:
        return p.as_posix()


def escapes(sources: Mapping[str, str]) -> dict[str, int]:
    """How often the sources (`{file: text}`) silence the checker: the two
    ignore comments, and calls of `typing.cast` (a function of the bakes'
    own named `cast` is none)."""
    out = dict.fromkeys((*_IGNORE, "typing.cast"), 0)
    for text in sources.values():
        for name, pattern in _IGNORE.items():
            out[name] += len(pattern.findall(text))
        out["typing.cast"] += _casts(text)
    return out


def _casts(text: str) -> int:
    tree = ast.parse(text)
    names = {"typing", "typing_extensions"}
    bare: set[str] = set()
    modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module in names:
            bare |= {a.asname or a.name for a in node.names if a.name == "cast"}
        elif isinstance(node, ast.Import):
            modules |= {a.asname or a.name for a in node.names if a.name in names}
    n = 0
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        f = node.func
        if (isinstance(f, ast.Name) and f.id in bare) or (
            isinstance(f, ast.Attribute)
            and f.attr == "cast"
            and isinstance(f.value, ast.Name)
            and f.value.id in modules
        ):
            n += 1
    return n


def _flat(baseline: Mapping) -> dict[tuple[str, str], int]:
    """The baseline's counts keyed by (file, rule); the escapes under the
    file `escapes`."""
    out = {(f, r): n for f, rules in baseline["findings"].items() for r, n in rules.items()}
    out |= {("escapes", k): n for k, n in baseline["escapes"].items()}
    return out


def compare(
    baseline: Mapping, current: Mapping
) -> tuple[list[tuple[str, str, int, int]], list[tuple[str, str, int, int]]]:
    """(risen, fallen): each `(file, rule, baseline's count, current count)`,
    sorted. A file or rule the baseline lacks counts 0 there."""
    was, now = _flat(baseline), _flat(current)
    risen, fallen = [], []
    for key in sorted(was.keys() | now.keys()):
        a, b = was.get(key, 0), now.get(key, 0)
        if b > a:
            risen.append((*key, a, b))
        elif b < a:
            fallen.append((*key, a, b))
    return risen, fallen


def updated(baseline: Mapping, current: Mapping) -> dict:
    """The baseline lowered to the current counts. Raises ValueError while
    any count would rise: a baseline is never raised by hand or by tool."""
    risen, _ = compare(baseline, current)
    if risen:
        raise ValueError(", ".join(f"{f} {r} {a} -> {b}" for f, r, a, b in risen))
    return {
        "checker": current["checker"],
        "escapes": dict(sorted(current["escapes"].items())),
        "findings": {
            f: dict(sorted(rules.items())) for f, rules in sorted(current["findings"].items())
        },
    }


def _run_pyright() -> dict:
    """Pyright's JSON report over the bakes. Exit 0 or 1 is a report; more
    is pyright failing (a bad setting, a crash)."""
    p = subprocess.run(
        [sys.executable, "-m", "pyright", "--outputjson"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if p.returncode not in (0, 1):
        sys.exit(f"pyright failed ({p.returncode}):\n{p.stderr or p.stdout}")
    return json.loads(p.stdout)


def _sources() -> dict[str, str]:
    return {p.relative_to(ROOT).as_posix(): p.read_text() for p in sorted(BAKE.rglob("*.py"))}


def _report_risen(risen, diagnostics, sources) -> None:
    print("New type findings in bake/ — fix them; the baseline only shrinks:")
    for f, r, a, b in risen:
        print(f"\n{f}: {r}: {b} (baseline {a})")
        if f == "escapes":
            pattern = _IGNORE.get(r)
            for name, text in sources.items():
                for i, line in enumerate(text.splitlines(), 1):
                    if (pattern and pattern.search(line)) or (not pattern and "cast(" in line):
                        print(f"  {name}:{i}: {line.strip()}")
            continue
        for d in diagnostics:
            if _relative(d["file"], ROOT) == f and (d.get("rule") or NO_RULE) == r:
                s = d["range"]["start"]
                message = d["message"].replace("\n", " ")
                print(f"  {f}:{s['line'] + 1}:{s['character'] + 1}: {message}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--update", action="store_true", help="write the lowered baseline")
    args = ap.parse_args(argv)

    report = _run_pyright()
    diagnostics = report["generalDiagnostics"]
    sources = _sources()
    current = {
        "checker": f"pyright {report['version']}",
        "escapes": escapes(sources),
        "findings": fold(diagnostics),
    }
    baseline = json.loads(BASELINE.read_text())
    total = sum(n for rules in current["findings"].values() for n in rules.values())

    if args.update:
        try:
            new = updated(baseline, current)
        except ValueError as e:
            print(f"Refusing to raise the baseline: {e}")
            return 1
        BASELINE.write_text(json.dumps(new, indent=2) + "\n")
        print(f"Baseline written: {total} findings.")
        return 0

    risen, fallen = compare(baseline, current)
    if risen:
        _report_risen(risen, diagnostics, sources)
        if baseline["checker"] != current["checker"]:
            print(f"\n(The checker moved: {baseline['checker']} -> {current['checker']}.)")
        return 1
    if fallen:
        print("Fewer type findings than the baseline holds — the baseline is stale:")
        for f, r, a, b in fallen:
            print(f"  {f}: {r}: {a} -> {b}")
        print("Run `uv run python typecheck.py --update` and commit the baseline.")
        return 1
    print(f"Types: {total} findings in bake/, as the baseline holds.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
