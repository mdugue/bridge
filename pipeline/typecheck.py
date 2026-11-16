"""The bakes' type check against a baseline that only shrinks (plan 089).

Runs pyright over `bake/` (its settings: `[tool.pyright]` in
pyproject.toml) and keys every finding by its file, its rule, the function or
class it stands in and its message (whitespace folded) — never by line, so an
edit above a finding moves nothing, and a finding fixed in one place and
another added elsewhere in the same file is two changes, not none. The
escapes are findings too: `type: ignore` and `pyright: ignore` comments, a
`# pyright:` directive of any kind, `@no_type_check` and calls of
`typing.cast`, each keyed by file and symbol. The counts per key are held to
`typecheck-baseline.json`:

- a count above the baseline, or a key the baseline lacks: exit 1, with
  the findings of that key and their lines;
- a count below it: exit 1 too — the baseline is stale; `--update` writes
  the lower counts, and refuses while any count would rise (unless the
  checker's version changed: a bump goes in a PR of its own);
- pyright must have read every module of `bake/` and nothing else, and
  nothing may relax it (no `pyrightconfig.json`, no setting beyond the
  known ones in `[tool.pyright]`);
- `--against REF` (CI, on a pull request): the baseline may not hold a key
  or count that REF's baseline lacks, unless the pull request's
  description has a line `Typecheck-baseline-raise: <why>`.

This file lives outside `bake/`, so no step's cache key reaches it
(`bake.step_cache.code_hash`). When the baseline is empty, delete it and
this file and let pyright's exit code be the gate.

    uv run python typecheck.py                  # the gate (bun run test:pipeline)
    uv run python typecheck.py --update         # write the lowered baseline
    uv run python typecheck.py --against REF    # and no raise against REF (CI)
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import re
import subprocess
import sys
import tomllib
from collections.abc import Iterable, Mapping
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BAKE = ROOT / "bake"
BASELINE = ROOT / "typecheck-baseline.json"
BASELINE_PATH = "pipeline/typecheck-baseline.json"

# The settings `[tool.pyright]` may hold. Any other (a rule switched off, a
# looser mode, a wider ignore) would lower the counts without a fix.
SETTINGS = {
    "include": ["bake"],
    "pythonVersion": "3.12",
    "pythonPlatform": "Linux",
    "venvPath": ".",
    "venv": ".venv",
    "stubPath": "typings",
}

# A finding pyright files under no rule (a syntax error, an import cycle).
NO_RULE = "(no rule)"
ESCAPE = "escape: "
RAISE_LINE = re.compile(r"^\s*Typecheck-baseline-raise:\s*(\S.*)$", re.M | re.I)

# key: (file, rule, detail); detail is "symbol: message" for a finding and
# the symbol for an escape.
Key = tuple[str, str, str]
Counts = dict[Key, int]

_COMMENTS = {
    "type: ignore": re.compile(r"#\s*type:\s*ignore\b"),
    "pyright: ignore": re.compile(r"#\s*pyright:\s*ignore\b"),
    "pyright: directive": re.compile(r"#\s*pyright:\s*(?!ignore\b)\w"),
}


def normalise(message: str) -> str:
    """A message's first line (what follows explains it, and is long) with
    its whitespace folded and a line number it names replaced: what an
    unrelated edit does not move."""
    first = message.strip().splitlines()[0] if message.strip() else ""
    return re.sub(r"\bline \d+", "line N", " ".join(first.split()))


class Symbols:
    """The innermost function or class each line of a module stands in."""

    def __init__(self, text: str) -> None:
        self.spans: list[tuple[int, int, str]] = []
        self._walk(ast.parse(text), "")

    def _walk(self, node: ast.AST, prefix: str) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                name = f"{prefix}{child.name}"
                start = min([child.lineno, *(d.lineno for d in child.decorator_list)])
                self.spans.append((start, child.end_lineno or child.lineno, name))
                self._walk(child, f"{name}.")
            else:
                self._walk(child, prefix)

    def at(self, line: int) -> str:
        """The symbol of a 1-based line; `<module>` outside any."""
        best = "<module>"
        best_start = 0
        for start, end, name in self.spans:
            if start <= line <= end and start >= best_start:
                best, best_start = name, start
        return best


def fold(diagnostics: Iterable[Mapping], sources: Mapping[str, str], root: Path = ROOT) -> Counts:
    """Pyright's diagnostics (`--outputjson`'s `generalDiagnostics`) as
    counts per (file, rule, "symbol: message"), the file relative to `root`
    in POSIX form. An information is no finding; errors and warnings are."""
    symbols = {f: Symbols(t) for f, t in sources.items()}
    out: Counts = {}
    for d in diagnostics:
        if d.get("severity") == "information":
            continue
        key = _key(d, symbols, root)
        out[key] = out.get(key, 0) + 1
    return out


def _key(d: Mapping, symbols: Mapping[str, Symbols], root: Path) -> Key:
    f = _relative(d["file"], root)
    line = d.get("range", {}).get("start", {}).get("line", -1) + 1
    symbol = symbols[f].at(line) if f in symbols else "<module>"
    return (f, d.get("rule") or NO_RULE, f"{symbol}: {normalise(d['message'])}")


def _relative(file: str, root: Path) -> str:
    p = Path(file)
    try:
        return p.resolve().relative_to(root).as_posix()
    except ValueError:
        return p.as_posix()


def escapes(sources: Mapping[str, str]) -> Counts:
    """Every way the sources (`{file: text}`) silence the checker, per
    (file, "escape: kind", symbol): the ignore comments, a `# pyright:`
    directive, `@no_type_check` and calls of `typing.cast` (a function of
    the bakes' own named `cast` is none)."""
    out: Counts = {}

    def add(f: str, kind: str, symbol: str) -> None:
        key = (f, ESCAPE + kind, symbol)
        out[key] = out.get(key, 0) + 1

    for f, text in sources.items():
        symbols = Symbols(text)
        for i, line in enumerate(text.splitlines(), 1):
            for kind, pattern in _COMMENTS.items():
                for _ in pattern.findall(line):
                    add(f, kind, symbols.at(i))
        for kind, line in _typing_escapes(text):
            add(f, kind, symbols.at(line))
    return out


def _typing_escapes(text: str) -> list[tuple[str, int]]:
    """(kind, line) of each `typing.cast` call and `no_type_check` use."""
    tree = ast.parse(text)
    modules = {"typing", "typing_extensions"}
    wanted = {"cast": "typing.cast", "no_type_check": "no_type_check"}
    bare: dict[str, str] = {}
    aliases: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module in modules:
            bare |= {a.asname or a.name: wanted[a.name] for a in node.names if a.name in wanted}
        elif isinstance(node, ast.Import):
            aliases |= {a.asname or a.name for a in node.names if a.name in modules}
    found = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and node.id in bare and isinstance(node.ctx, ast.Load):
            found.append((bare[node.id], node.lineno))
        elif (
            isinstance(node, ast.Attribute)
            and node.attr in wanted
            and isinstance(node.value, ast.Name)
            and node.value.id in aliases
        ):
            found.append((wanted[node.attr], node.lineno))
    return found


def to_json(checker: str, counts: Counts) -> dict:
    """The baseline file: `{file: {rule: {detail: count}}}`, sorted."""
    findings: dict[str, dict[str, dict[str, int]]] = {}
    for (f, rule, detail), n in sorted(counts.items()):
        findings.setdefault(f, {}).setdefault(rule, {})[detail] = n
    return {"checker": checker, "findings": findings}


def from_json(baseline: Mapping) -> Counts:
    return {
        (f, rule, detail): n
        for f, rules in baseline["findings"].items()
        for rule, details in rules.items()
        for detail, n in details.items()
    }


def compare(was: Counts, now: Counts) -> tuple[list, list]:
    """(risen, fallen): each `(file, rule, detail, was, now)`, sorted. A
    key one side lacks counts 0 there."""
    risen, fallen = [], []
    for key in sorted(was.keys() | now.keys()):
        a, b = was.get(key, 0), now.get(key, 0)
        if b > a:
            risen.append((*key, a, b))
        elif b < a:
            fallen.append((*key, a, b))
    return risen, fallen


def updated(baseline: Mapping, checker: str, now: Counts) -> dict:
    """The baseline lowered to the current counts. Raises ValueError while
    any count would rise, unless the checker is another version than the
    baseline's (its bump moves counts both ways and goes in a PR of its own,
    which `--against` then holds to a stated reason)."""
    risen, _ = compare(from_json(baseline), now)
    if risen and checker == baseline["checker"]:
        raise ValueError("; ".join(_describe(r) for r in risen))
    return to_json(checker, now)


def check_settings(pyproject: Mapping, root_files: Iterable[str]) -> list[str]:
    """What relaxes the checker beyond the known settings."""
    problems = []
    settings = pyproject.get("tool", {}).get("pyright", {})
    if settings != SETTINGS:
        problems.append(f"[tool.pyright] is {settings}, not {SETTINGS}")
    if "pyrightconfig.json" in root_files:
        problems.append("pyrightconfig.json would override [tool.pyright]")
    return problems


def check_coverage(analysed: int, modules: int) -> list[str]:
    """Pyright must have read every module of bake/ (an `include` that
    misses would pass on an empty report)."""
    if analysed != modules:
        return [f"pyright analysed {analysed} files; bake/ has {modules} modules"]
    return []


def raise_reason(event: Mapping | None) -> str | None:
    """The reason a pull request gives for raising the baseline: a line
    `Typecheck-baseline-raise: …` in its description."""
    body = ((event or {}).get("pull_request") or {}).get("body") or ""
    m = RAISE_LINE.search(body)
    return m.group(1).strip() if m else None


def _describe(r) -> str:
    f, rule, detail, a, b = r
    return f"{f} {rule} [{detail}] {a} -> {b}"


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


def _base_baseline(ref: str) -> dict | None:
    """The baseline as `ref` has it; None where it has none yet."""
    p = subprocess.run(
        ["git", "show", f"{ref}:{BASELINE_PATH}"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    return json.loads(p.stdout) if p.returncode == 0 else None


def _event() -> dict | None:
    path = os.environ.get("GITHUB_EVENT_PATH")
    return json.loads(Path(path).read_text()) if path and Path(path).is_file() else None


def _report_risen(risen, diagnostics, symbols) -> None:
    print("New type findings in bake/ — fix them; the baseline only shrinks:")
    for r in risen:
        f, rule, detail, a, b = r
        print(f"\n{f}: {rule}: {detail}: {b} (baseline {a})")
        if rule.startswith(ESCAPE):
            continue
        for d in diagnostics:
            if _key(d, symbols, ROOT) == (f, rule, detail):
                s = d["range"]["start"]
                print(f"  {f}:{s['line'] + 1}:{s['character'] + 1}")


def _against(ref: str, baseline: Mapping) -> int:
    base = _base_baseline(ref)
    if base is None:
        print(f"(No baseline on {ref} yet: nothing to hold this one to.)")
        return 0
    risen, _ = compare(from_json(base), from_json(baseline))
    if not risen:
        return 0
    reason = raise_reason(_event())
    print(f"The baseline holds findings {ref}'s does not:")
    for r in risen:
        print(f"  {_describe(r)}")
    if reason:
        print(f"Allowed by the pull request: {reason}")
        return 0
    print("A baseline is lowered, never raised: fix the findings, or say why in")
    print("the pull request's description: `Typecheck-baseline-raise: <why>`.")
    return 1


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--update", action="store_true", help="write the lowered baseline")
    ap.add_argument("--against", metavar="REF", help="no raise against REF's baseline")
    args = ap.parse_args(argv)

    problems = check_settings(
        tomllib.loads((ROOT / "pyproject.toml").read_text()), os.listdir(ROOT)
    )
    report = _run_pyright()
    sources = _sources()
    problems += check_coverage(report["summary"]["filesAnalyzed"], len(sources))
    if problems:
        print("The type check does not cover the bakes as it must:")
        print("\n".join(f"  {p}" for p in problems))
        return 1

    diagnostics = report["generalDiagnostics"]
    checker = f"pyright {report['version']}"
    now = fold(diagnostics, sources) | escapes(sources)
    baseline = json.loads(BASELINE.read_text())
    total = sum(n for k, n in now.items() if not k[1].startswith(ESCAPE))

    if args.update:
        try:
            new = updated(baseline, checker, now)
        except ValueError as e:
            print(f"Refusing to raise the baseline: {e}")
            return 1
        BASELINE.write_text(json.dumps(new, indent=2, ensure_ascii=False) + "\n")
        print(f"Baseline written: {total} findings.")
        return 0

    risen, fallen = compare(from_json(baseline), now)
    if risen:
        _report_risen(risen, diagnostics, {f: Symbols(t) for f, t in sources.items()})
        if baseline["checker"] != checker:
            print(f"\n(The checker moved: {baseline['checker']} -> {checker}.)")
        return 1
    if fallen:
        print("Fewer type findings than the baseline holds — the baseline is stale:")
        print("\n".join(f"  {_describe(r)}" for r in fallen))
        print("Run `uv run python typecheck.py --update` and commit the baseline.")
        return 1
    if args.against and _against(args.against, baseline):
        return 1
    print(f"Types: {total} findings in bake/, as the baseline holds.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
