"""Compare freshly baked vegetation files with the committed ones — the check
that a port of a bake reproduces what it replaces.

  uv run --project pipeline python scripts/eval/compare-bakes.py [--ref HEAD]
      trees_/lowveg_/canopyx_<tile>.geojson under data/dresden/dlm against the same
      files at a git ref (default HEAD): features only in one of them,
      properties that differ, line lengths that moved. Order is ignored.

  uv run --project pipeline python scripts/eval/compare-bakes.py \\
      --rasters data/_raw/sn/lsc/33412_5656_2_sn data/_raw/lsc/derived/33412_5656_2_sn
      the laser-scan rasters of two folders (e.g. pipeline/bake/lsc.py against
      the PDAL-made ones): per band, how many cells differ and by how much.

Exit status 1 when anything differs. Not part of the app.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import rasterio
from shapely.geometry import shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[2]
KINDS = ("trees", "lowveg", "canopyx")
RASTERS = {
    "dtm_050.tif": "idw",
    "dsm_050.tif": "max",
    "nonground_count_050.tif": None,
    "nonground_multiecho_count_050.tif": None,
    "lowint_050.tif": "mean",
}


def at_ref(ref: str, path: str) -> dict | None:
    run = subprocess.run(
        ["git", "show", f"{ref}:{path}"], cwd=ROOT, capture_output=True, text=True, check=False
    )
    return json.loads(run.stdout) if run.returncode == 0 else None


def key(f: dict) -> str:
    return json.dumps(f["geometry"]["coordinates"])


def compare_points(old: dict, new: dict) -> list[str]:
    a = {key(f): f["properties"] for f in old["features"]}
    b = {key(f): f["properties"] for f in new["features"]}
    out = []
    if set(a) - set(b):
        out.append(f"{len(set(a) - set(b))} only in the committed file")
    if set(b) - set(a):
        out.append(f"{len(set(b) - set(a))} only in the new one")
    moved = [k for k in a if k in b and a[k] != b[k]]
    if moved:
        out.append(f"{len(moved)} with other properties, e.g. {a[moved[0]]} → {b[moved[0]]}")
    return out


def compare_lines(old: dict, new: dict) -> list[str]:
    ga = [shape(f["geometry"]) for f in old["features"]]
    gb = [shape(f["geometry"]) for f in new["features"]]
    ua = unary_union(ga).buffer(0.5) if ga else None
    ub = unary_union(gb).buffer(0.5) if gb else None
    lost = sum(g.difference(ub).length if ub else g.length for g in ga)
    added = sum(g.difference(ua).length if ua else g.length for g in gb)
    out = []
    if lost > 1 or added > 1:
        out.append(f"{lost:.0f} m only in the committed file, {added:.0f} m only in the new one")
    pa = sorted(
        (round(g.length), json.dumps(f["properties"], sort_keys=True))
        for g, f in zip(ga, old["features"], strict=True)
    )
    pb = sorted(
        (round(g.length), json.dumps(f["properties"], sort_keys=True))
        for g, f in zip(gb, new["features"], strict=True)
    )
    if pa != pb:
        diff = len(set(pa) ^ set(pb))
        out.append(f"{diff} hedges with another length or h/w/src")
    return out


def compare_files(ref: str) -> bool:
    same = True
    for path in sorted((ROOT / "data" / "dresden" / "dlm").glob("*.geojson")):
        kind = path.name.split("_")[0]
        if kind not in KINDS:
            continue
        rel = f"data/dresden/dlm/{path.name}"
        old = at_ref(ref, rel)
        new = json.loads(path.read_text())
        if old is None:
            print(f"{rel}: new (not at {ref})")
            same = False
            continue
        notes = compare_lines(old, new) if kind == "lowveg" else compare_points(old, new)
        if old.get("attribution") != new.get("attribution"):
            notes.append(f"attribution {old.get('attribution')!r} → {new.get('attribution')!r}")
        print(f"{rel}: {len(old['features'])} → {len(new['features'])} features", end="")
        print(" — identical" if not notes else "")
        for note in notes:
            print(f"    {note}")
        same &= not notes
    return same


def band(path: Path, desc: str | None) -> np.ndarray:
    with rasterio.open(path) as ds:
        i = list(ds.descriptions).index(desc) + 1 if desc else 1
        a = ds.read(i).astype(np.float64)
    a[a == -9999] = np.nan
    return a


def compare_rasters(a: Path, b: Path) -> bool:
    same = True
    for name, desc in RASTERS.items():
        x, y = band(a / name, desc), band(b / name, desc)
        both = ~np.isnan(x) & ~np.isnan(y)
        only = int(np.sum(np.isnan(x) != np.isnan(y)))
        d = np.abs(x[both] - y[both])
        p99 = float(np.percentile(d, 99)) if d.size else 0.0
        off = int(np.sum(d > 0.01))
        print(
            f"{name} [{desc or 'count'}]: {both.sum()} cells in both, {only} in one only; "
            f"{off} differ > 0.01 (p99 {p99:.3f}, max {d.max() if d.size else 0:.3f})"
        )
        same &= only == 0 and off == 0
    return same


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--ref", default="HEAD")
    p.add_argument("--rasters", nargs=2, type=Path, metavar=("NEW", "OLD"))
    args = p.parse_args()
    same = compare_rasters(*args.rasters) if args.rasters else compare_files(args.ref)
    sys.exit(0 if same else 1)


if __name__ == "__main__":
    main()
