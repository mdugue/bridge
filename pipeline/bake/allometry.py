"""A tree's height from its genus and trunk: the allometry the `trees` step
reads where a register records no height (Hamburg's records none) or an
OSM tree is tagged with a girth but no height.

Fitted on the registers that measure both (Dresden's Stadtbäume and
Leipzig's Baumkataster, ~74 000 trees with a height and a trunk diameter at
breast height that fit each other, `trees.plausible_trunk`) and shipped as a
small table, `tree_allometry.json`, so the bake never needs those registers
to read another city's. The fit, per genus with at least GENUS_MIN trees:

  1. the trees in DBH_EDGES classes (cm); in each class with at least
     BIN_MIN trees, the class's median trunk diameter and median height;
  2. those medians made non-decreasing along the trunk (pool-adjacent-
     violators, weighted by the classes' counts): a thicker trunk is never
     a lower tree, whatever a thin class's noise says;
  3. a height between two classes read off the line between their medians,
     one past the first or the last class held at that class's.

A genus with fewer trees takes its archetype's curve (tree_archetypes.py:
the small ornamentals' is lower than the round crowns'), a tree of no known
genus the curve of all trees. The table also carries what fills a crown or a
height where nothing else does: each archetype's median crown diameter over
height and each genus's median height (`crown_ratio`, `genus_h`) — the
sizes of an OSM tree in a city without a register.

Why not the surface model: Hamburg's DOM1 is matched from a leaf-off flight
(November) and reads its street trees low — ~40 % for young ones, 10–25 %
for mature ones (a 25–40 cm lime 9.7 m against 13 m in Saxony, where DOM1
is accurate to a median −0.5 m). The fit's own error is in the table's
`fit` member: fitted on one Saxon register, it reads the other's heights to
a median absolute error of about 2 m (see `validation`).

Refit with the registers cached (`bun run fetch dresden`, `… leipzig`):

  PYTHONPATH=pipeline uv run --project pipeline python -m bake.allometry \\
      <dresden spec.json> <leipzig spec.json> > pipeline/bake/tree_allometry.json
"""

from __future__ import annotations

import datetime
import json
import re
import statistics
import sys
from collections.abc import Iterable
from functools import cache
from pathlib import Path

TABLE = Path(__file__).with_name("tree_allometry.json")
# Trunk diameter classes (cm): 5 cm where most street trees are, wider past.
DBH_EDGES = (0, 5, 10, 15, 20, 25, 30, 35, 40, 50, 60, 70, 80, 100, 120, 150, 400)
BIN_MIN = 10  # trees a class needs to give a point
GENUS_MIN = 80  # trees a genus needs for a curve of its own
H_RANGE = (1.5, 40.0)  # the bake's (trees.py H_MIN, H_MAX)


def _isotonic(points: list[tuple[float, float, int]]) -> list[list[float]]:
    """(x, y, weight) sorted by x → [x, y] with y non-decreasing in x: the
    pool-adjacent-violators fit, each pooled block's x its weighted mean."""
    blocks: list[list[float]] = []  # [sum w·x, sum w·y, sum w]
    for x, y, w in points:
        blocks.append([w * x, w * y, float(w)])
        while len(blocks) > 1 and blocks[-2][1] / blocks[-2][2] > blocks[-1][1] / blocks[-1][2]:
            last = blocks.pop()
            for i in range(3):
                blocks[-1][i] += last[i]
    return [[round(b[0] / b[2], 1), round(b[1] / b[2], 2)] for b in blocks]


def curve(pairs: Iterable[tuple[float, float]]) -> list[list[float]] | None:
    """The fitted curve of (trunk cm, height m) pairs: [[dbh, h], …] by
    trunk, None when no class holds BIN_MIN of them."""
    bins: list[list[tuple[float, float]]] = [[] for _ in DBH_EDGES[1:]]
    for dbh, h in pairs:
        for i, top in enumerate(DBH_EDGES[1:]):
            if DBH_EDGES[i] <= dbh < top:
                bins[i].append((dbh, h))
                break
    points = [
        (statistics.median(d for d, _ in b), statistics.median(h for _, h in b), len(b))
        for b in bins
        if len(b) >= BIN_MIN
    ]
    return _isotonic(points) if points else None


def read_curve(points: list[list[float]], dbh: float) -> float:
    """The curve's height at `dbh`: between its points on the line, past
    either end held."""
    if dbh <= points[0][0]:
        return points[0][1]
    for (x0, y0), (x1, y1) in zip(points, points[1:], strict=False):
        if dbh <= x1:
            return y0 + (y1 - y0) * (dbh - x0) / (x1 - x0)
    return points[-1][1]


def _sample(trees: Iterable[dict]) -> list[dict]:
    """The trees a fit reads: a height in the bake's range, a trunk that
    fits it (trees.py `plausible_trunk`, inlined: this module stays free of
    the bake's rasters)."""
    lo, hi = H_RANGE
    return [
        t
        for t in trees
        if t.get("h") and t.get("t") and lo <= t["h"] <= hi and t["t"] <= min(400, 15 * t["h"])
    ]


def fit(trees: Iterable[dict]) -> dict:
    """The table over register trees (trees.py records: `genus`,
    `archetype`, `h`, `t`, `d`)."""
    sample = _sample(trees)
    by_genus: dict[str, list[tuple[float, float]]] = {}
    by_arch: dict[int, list[tuple[float, float]]] = {}
    ratio: dict[int, list[float]] = {}
    heights: dict[str, list[float]] = {}
    for t in sample:
        pair = (t["t"], t["h"])
        if t["genus"]:
            by_genus.setdefault(t["genus"], []).append(pair)
            heights.setdefault(t["genus"], []).append(t["h"])
        by_arch.setdefault(t["archetype"], []).append(pair)
        if t.get("d"):
            ratio.setdefault(t["archetype"], []).append(t["d"] / t["h"])
    genus = {g: c for g, v in sorted(by_genus.items()) if len(v) >= GENUS_MIN and (c := curve(v))}
    arch = {str(a): c for a, v in sorted(by_arch.items()) if (c := curve(v))}
    return {
        "genus": genus,
        "archetype": arch,
        "all": curve((t["t"], t["h"]) for t in sample),
        "crown_ratio": {str(a): round(statistics.median(v), 3) for a, v in sorted(ratio.items())},
        "genus_h": {
            g: round(statistics.median(v), 1) for g, v in sorted(heights.items()) if len(v) >= 3
        },
        "n": len(sample),
    }


@cache
def table() -> dict:
    """The shipped table (`tree_allometry.json`)."""
    return json.loads(TABLE.read_text())


def height(genus: str, archetype: int, dbh: float, tab: dict | None = None) -> float:
    """A tree's height (m) from its genus, archetype and trunk diameter at
    breast height (cm): its genus's curve, else its archetype's, else all
    trees'."""
    tab = tab or table()
    points = tab["genus"].get(genus) or tab["archetype"].get(str(archetype)) or tab["all"]
    return read_curve(points, dbh)


def _errors(tab: dict, trees: list[dict]) -> dict:
    """How well `tab` reads the heights of `trees` (a register it was not
    fitted on): median absolute error, median error, and the same for the
    genus median it replaces."""
    err = [height(t["genus"], t["archetype"], t["t"], tab) - t["h"] for t in trees]
    base = [tab["genus_h"].get(t["genus"], 8.0) - t["h"] for t in trees]
    return {
        "n": len(err),
        "mae": round(statistics.median(abs(e) for e in err), 2),
        "bias": round(statistics.median(err), 2),
        "genus_median_mae": round(statistics.median(abs(e) for e in base), 2),
    }


def _register(spec_path: str) -> tuple[str, list[dict], str]:
    """A site's cached register trees (`bun run fetch` writes the cache)."""
    from .cadastre import register_of
    from .spec import parse
    from .trees import parse_trees

    spec = parse(Path(spec_path).read_text())
    out, retrieved = [], ""
    for tile in spec.tiles:
        raw_path = tile.raw / "trees" / f"{tile.id}.geojson"
        meta = tile.raw / "trees" / f"{tile.id}.meta.json"
        register = register_of(tile)
        if register is None or not raw_path.exists():
            continue
        out += parse_trees(json.loads(raw_path.read_text()), tile.bounds, register.fields)
        if meta.exists():
            retrieved = max(retrieved, json.loads(meta.read_text()).get("retrieved", ""))
    return spec.site, out, retrieved[:10]


def main(spec_paths: list[str]) -> None:
    registers = [_register(p) for p in spec_paths]
    tab = fit(t for _, trees, _ in registers for t in trees)
    validation = {}
    for site, trees, _ in registers:
        others = [t for s, ts, _ in registers if s != site for t in ts]
        if others:
            validation[site] = _errors(fit(others), _sample(trees))
    tab["fit"] = {
        "registers": {
            site: {"retrieved": day, "trees": len(_sample(trees))} for site, trees, day in registers
        },
        "fitted": datetime.date.today().isoformat(),
        "method": "pipeline/bake/allometry.py",
        "dbh_edges_cm": list(DBH_EDGES),
        "bin_min": BIN_MIN,
        "genus_min": GENUS_MIN,
        "validation": validation,
    }
    text = json.dumps(tab, indent=1, sort_keys=True)
    # one [dbh, h] pair a line, not one number
    sys.stdout.write(re.sub(r"\[\s+([-\d.]+),\s+([-\d.]+)\s+\]", r"[\1, \2]", text) + "\n")


if __name__ == "__main__":
    main(sys.argv[1:])
