"""Compare two trees of baked files by content — the check that a port of a
bake, or a change to how the bakes read and write (plan 092), reproduces
what it replaces.

  uv run --project pipeline python scripts/eval/compare-bakes.py <a> <b>
      two folders (data/<site>, a dlm/ folder, a whole data/) or two files
      named as the same kind (`trees_<a>.geojson`, `trees_<b>.geojson`).
      Files are matched by their path below the folder, then compared a kind
      at a time:

      - a feature collection (.geojson): a feature is a row. Rows are
        matched by identity, the order in the file ignored; reported are the
        rows only in one side, the rows whose properties differ (and which),
        and the file's other members (attribution, crs, a legend).
      - a JSON file with a table in it (TABLES: the records a LoD2 object
        or a landmark has): a record is a row, matched the same way; the
        rest of the document is compared as its head.
      - CityJSON (.city.json): a city object is a row, its boundaries read
        as the vertices they index, so two files that number their vertices
        differently compare equal.
      - any other JSON: the whole document, keys unordered, arrays in order.
      - a raster (.png, .tif): size, bands and type, then cell by cell — how
        many cells differ and by how much. NaN equals NaN.
      - anything else: its bytes.

      Numbers are compared exactly; 1 and 1.0 are the same number (a reader
      in TypeScript cannot tell them apart), 0 and -0.0 are not (it can).
      A key that is null is not a key that is absent. A row's identity is
      what IDENTITY names for its kind, else its geometry; rows that share
      an identity are matched as a multiset.

      Where a row's place in its file is a key another file reads
      (POSITIONAL: the trees and their facts, a raster that holds a row's
      number), the rows are compared in place as well, whatever the flags.
      CityJSON vertices no boundary names are not compared.

      --kind K      only these kinds (repeat; a kind is the file's name
                    before its tile id: bridge, markings_low, lod2)
      --order       every kind's rows in place, and each row as it is
                    written: the order of its keys, 1 against 1.0 (the
                    build's bytes follow the file's order, ADR 0059)
      --examples N  how many differences to print a file (default 3)

  uv run --project pipeline python scripts/eval/compare-bakes.py --ref HEAD [path]
      the work tree's `path` (default data) against the same path at a git
      ref: what a re-bake changed. The raw downloads (`_raw/`) are no part
      of either side.

  uv run --project pipeline python scripts/eval/compare-bakes.py \\
      --rasters data/_raw/sn/lsc/33412_5656_2_sn data/_raw/lsc/derived/33412_5656_2_sn
      the laser-scan rasters of two folders (e.g. pipeline/bake/lsc.py against
      the PDAL-made ones): per band, how many cells differ and by how much
      (0.01 is let through: two programs' floats, not two runs of one).

Exit status 0 with "0 differences", 1 when anything differs or a file is in
one side only, 2 when a side or a file cannot be read. Not part of the app.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
import re
import subprocess
import sys
import tarfile
import tempfile
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
LSC_RASTERS = {
    "dtm_050.tif": "idw",
    "dsm_050.tif": "max",
    "nonground_count_050.tif": None,
    "nonground_multiecho_count_050.tif": None,
    "lowint_050.tif": "mean",
}

# What makes a feature the same feature. A kind listed here names its rows by
# these properties, and its geometry is then compared like any other value;
# every other kind has no name of its own, and a row is identified by its
# geometry. Measured over the committed sites for plan 092's inventory: only
# the plinths' `of` (one LoD2 object, one plinth) is unique in its file.
IDENTITY: dict[str, tuple[str, ...]] = {
    "plinths": ("of",),
}

# A JSON file's table: the member that holds its rows, and for a list of
# records the keys that name a row (none: the row's whole content). A map's
# rows are named by their keys.
TABLES: dict[str, tuple[str, tuple[str, ...]]] = {
    "osmbuild": ("objects", ()),
    "facades": ("buildings", ()),
    "shopfronts": ("buildings", ()),
    "windows": ("buildings", ()),
    "roofcolor": ("roofs", ()),
    "landmarks": ("landmarks", ("id",)),
    "markings": ("markings", ()),
    "sport": ("grounds", ()),
}

# The kinds whose rows another file names by their place (plan 092's
# inventory): `treefacts` is columns in the trees' order; `markings.png` and
# `sport.png` hold 1 + a row of their tables; `roofcolor` names the rows of
# `smallbuild` and `structures` (`scan`, `gaps`) and a building's parts in
# `roofs` by number; the build's solved levels go by the rows of `rail` and
# `tram`, the terrain study by the walls'. (The land cover's water bodies
# and `treefacts` itself are plain JSON, compared in order anyway.)
POSITIONAL = frozenset(
    {"trees", "markings", "sport", "smallbuild", "structures", "roofs", "rail", "tram", "walls"}
)

_KIND = re.compile(r"^(.*?)_\d")
_MISSING = object()


class Unreadable(Exception):
    """A file that is not what its name says."""


def kind_of(name: str) -> str:
    """`bridge_33392_5668_2_sn.geojson` → `bridge`; a file without a tile id
    is its own kind (`provenance`)."""
    m = _KIND.match(name)
    return m.group(1) if m else name.split(".")[0]


def canon(v: Any) -> Any:
    """A JSON value with every whole float as an int, so 1.0 equals 1 the
    way it does for a reader in TypeScript — but for negative zero, which
    that reader tells from 0."""
    if isinstance(v, float) and v.is_integer() and not (v == 0 and math.copysign(1, v) < 0):
        return int(v)
    if isinstance(v, dict):
        return {k: canon(x) for k, x in v.items()}
    if isinstance(v, list):
        return [canon(x) for x in v]
    return v


def text(v: Any, ordered: bool = False) -> str:
    """The canonical text of a value: equal values, equal text."""
    return json.dumps(canon(v), sort_keys=not ordered, ensure_ascii=False)


def paths(a: Any, b: Any, at: str = "") -> list[str]:
    """Where two JSON values differ: the paths, keys unordered, arrays in
    order."""
    if isinstance(a, dict) and isinstance(b, dict):
        out: list[str] = []
        for k in sorted(set(a) | set(b)):
            out += paths(a.get(k, _MISSING), b.get(k, _MISSING), f"{at}.{k}" if at else k)
        return out
    if isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        out = []
        for i, (x, y) in enumerate(zip(a, b, strict=True)):
            out += paths(x, y, f"{at}[{i}]")
        return out
    if a is _MISSING or b is _MISSING:
        return [at]
    return [] if text(a) == text(b) else [at]


@dataclass
class Report:
    """What one pair of files differs in."""

    notes: list[str] = field(default_factory=list)
    count: int = 0
    summary: str = ""

    def add(self, n: int, note: str) -> None:
        if n:
            self.count += n
            self.notes.append(note)


Row = tuple[str, Any, Any]  # identity, what is compared under it, the row as written


def compare_rows(
    a: list[Row],
    b: list[Row],
    rep: Report,
    what: str,
    order: bool,
    examples: int,
    in_place: bool = False,
):
    """Rows matched by identity; those that share one, as a multiset. With
    `in_place` (a positional kind) or `order`, the same row must also stand
    at the same place; with `order`, written the same way."""
    ga: dict[str, list[Any]] = defaultdict(list)
    gb: dict[str, list[Any]] = defaultdict(list)
    for k, v, _ in a:
        ga[k].append(v)
    for k, v, _ in b:
        gb[k].append(v)
    only_a: list[str] = []
    only_b: list[str] = []
    differ: list[str] = []
    keys: Counter[str] = Counter()
    for k in ga.keys() | gb.keys():
        xs, ys = _unmatched(ga.get(k, []), gb.get(k, []))
        for x, y in zip(xs, ys, strict=False):
            where = paths(x, y)
            keys.update(re.sub(r"\[\d+\]", "[]", p) for p in where)
            differ.append(f"{k[:80]}: {', '.join(where[:4])}")
        only_a += [k] * max(0, len(xs) - len(ys))
        only_b += [k] * max(0, len(ys) - len(xs))
    rep.add(len(only_a), f"{len(only_a)} {what} only in a, e.g. {_some(only_a, examples)}")
    rep.add(len(only_b), f"{len(only_b)} {what} only in b, e.g. {_some(only_b, examples)}")
    rep.add(
        len(differ),
        f"{len(differ)} {what} differ in {dict(keys.most_common(8))}, "
        f"e.g. {_some(differ, examples)}",
    )
    if (order or in_place) and not rep.count:
        pairs = list(zip(a, b, strict=True))
        moved = [i for i, (x, y) in enumerate(pairs) if text(x[2]) != text(y[2])]
        rep.add(
            len(moved),
            f"{len(moved)} {what} at another place in the file"
            + (" (a row's place is a key of this kind)" if in_place else "")
            + f", the first at row {moved[0] if moved else 0}",
        )
        if order and not moved:
            rewritten = sum(_written(x[2]) != _written(y[2]) for x, y in pairs)
            rep.add(
                rewritten,
                f"{rewritten} {what} written otherwise (their keys in another order, 1 for 1.0)",
            )
    rep.summary = f"{len(a)} → {len(b)} {what}"


def _written(v: Any) -> str:
    """A value as its file writes it, but for the white space."""
    return json.dumps(v, ensure_ascii=False)


def _unmatched(xs: list[Any], ys: list[Any]) -> tuple[list[Any], list[Any]]:
    """What is left of two lists once equal members are paired off."""
    left = Counter(text(x) for x in xs)
    right = Counter(text(y) for y in ys)
    by_text = {text(v): v for v in [*xs, *ys]}
    return (
        [by_text[t] for t in sorted((left - right).elements())],
        [by_text[t] for t in sorted((right - left).elements())],
    )


def _some(items: list[str], n: int) -> str:
    return "; ".join(sorted(items)[:n])


def _load(path: Path) -> Any:
    try:
        # `-0` is negative zero to a reader in TypeScript, as `-0.0` is
        return json.loads(path.read_text(), parse_int=lambda s: -0.0 if s == "-0" else int(s))
    except OSError as err:
        raise Unreadable(f"{path}: cannot be read ({err})") from err
    except (ValueError, UnicodeDecodeError) as err:
        raise Unreadable(f"{path}: not JSON ({err})") from err


def _head(a: dict, b: dict, without: str, rep: Report, order: bool) -> None:
    ha = {k: v for k, v in a.items() if k != without}
    hb = {k: v for k, v in b.items() if k != without}
    where = paths(ha, hb)
    rep.add(len(where), f"the head differs in {', '.join(where[:6])}")
    if order and not where and _written(ha) != _written(hb):
        rep.add(1, "the head is written otherwise (its keys in another order, 1 for 1.0)")


def feature_rows(doc: Any, kind: str, path: Path) -> list[Row]:
    if not isinstance(doc, dict) or not isinstance(doc.get("features"), list):
        raise Unreadable(f"{path}: not a feature collection")
    named = IDENTITY.get(kind)
    rows: list[Row] = []
    for i, f in enumerate(doc["features"]):
        ok = isinstance(f, dict) and isinstance(f.get("properties"), dict) and "geometry" in f
        if not ok:
            raise Unreadable(f"{path}: feature {i} lacks its geometry or its properties")
        if named:
            rows.append((text({k: f["properties"].get(k) for k in named}), f, f))
        else:
            rows.append((text(f["geometry"]), {k: v for k, v in f.items() if k != "geometry"}, f))
    return rows


def compare_geojson(a: Path, b: Path, kind: str, order: bool, examples: int) -> Report:
    da, db = _load(a), _load(b)
    rep = Report()
    compare_rows(
        feature_rows(da, kind, a),
        feature_rows(db, kind, b),
        rep,
        "features",
        order,
        examples,
        kind in POSITIONAL,
    )
    _head(da, db, "features", rep, order)
    return rep


def table_rows(doc: dict, member: str, named: tuple[str, ...], path: Path) -> list[Row]:
    table = doc.get(member)
    if isinstance(table, dict):
        return [(k, v, {k: v}) for k, v in table.items()]
    if isinstance(table, list):
        return [
            (text({k: r.get(k) for k in named}) if named and isinstance(r, dict) else text(r), r, r)
            for r in table
        ]
    raise Unreadable(f"{path}: no table `{member}`")


def city_rows(doc: dict, path: Path) -> list[Row]:
    """A city object with the vertices its boundaries index written out."""
    vertices = doc.get("vertices") if isinstance(doc, dict) else None
    objects = doc.get("CityObjects") if isinstance(doc, dict) else None
    if not isinstance(vertices, list) or not isinstance(objects, dict):
        raise Unreadable(f"{path}: not CityJSON")

    def solid(v: Any) -> Any:
        if isinstance(v, list):
            return [solid(x) for x in v]
        if isinstance(v, bool) or not isinstance(v, int) or not 0 <= v < len(vertices):
            raise Unreadable(f"{path}: a boundary names vertex {v!r} of {len(vertices)}")
        return vertices[v]

    rows: list[Row] = []
    for oid, obj in objects.items():
        if not isinstance(obj, dict) or not isinstance(obj.get("geometry", []), list):
            raise Unreadable(f"{path}: city object {oid} is not an object")
        geometry = [
            {**g, "boundaries": solid(g["boundaries"])}
            if isinstance(g, dict) and "boundaries" in g
            else g
            for g in obj.get("geometry", [])
        ]
        whole = {**obj, "geometry": geometry}
        rows.append((oid, whole, {oid: whole}))
    return rows


def compare_json(a: Path, b: Path, kind: str, order: bool, examples: int) -> Report:
    da, db = _load(a), _load(b)
    rep = Report()
    if a.name.endswith(".city.json"):
        compare_rows(city_rows(da, a), city_rows(db, b), rep, "city objects", order, examples)
        skip = ("CityObjects", "vertices")
        _head(
            {k: v for k, v in da.items() if k not in skip},
            {k: v for k, v in db.items() if k not in skip},
            "",
            rep,
            order,
        )
    elif kind in TABLES and isinstance(da, dict) and isinstance(db, dict):
        member, named = TABLES[kind]
        ta, tb = type(da.get(member)).__name__, type(db.get(member)).__name__
        rep.add(ta != tb, f"`{member}` is a {ta} in a and a {tb} in b")
        compare_rows(
            table_rows(da, member, named, a),
            table_rows(db, member, named, b),
            rep,
            member,
            order,
            examples,
            kind in POSITIONAL,
        )
        _head(da, db, member, rep, order)
    else:
        where = paths(da, db)
        rep.add(len(where), f"{len(where)} values differ: {', '.join(where[:examples])}")
        if order and not where and _written(da) != _written(db):
            rep.add(1, "written otherwise (keys in another order, 1 for 1.0)")
    return rep


def cells(path: Path) -> tuple[np.ndarray, str]:
    """A raster as (bands, rows, cols) and what else must agree: its type;
    a PNG's mode, palette and transparency; where a GeoTIFF lies, its
    no-data value and its bands' names."""
    try:
        if path.suffix == ".png":
            with Image.open(path) as im:
                a = np.asarray(im)
                palette = hashlib.sha256(bytes(im.getpalette() or [])).hexdigest()[:8]
                where = f"{im.mode} palette {palette} transparency {im.info.get('transparency')!r}"
            a = a[None] if a.ndim == 2 else np.moveaxis(a, 2, 0)
        else:
            with rasterio.open(path) as ds:
                a = ds.read()
                where = (
                    f"{ds.crs} {tuple(ds.transform)[:6]} nodata {ds.nodata} bands {ds.descriptions}"
                )
    except (OSError, ValueError, rasterio.errors.RasterioError) as err:
        raise Unreadable(f"{path}: not a raster ({err})") from err
    return a, f"{a.dtype} {where}"


def compare_raster(a: Path, b: Path) -> Report:
    (x, wx), (y, wy) = cells(a), cells(b)
    rep = Report(summary=f"{x.shape[2]}×{x.shape[1]}, {x.shape[0]} band(s)")
    if x.shape != y.shape or wx != wy:
        rep.add(1, f"{x.shape} {wx} → {y.shape} {wy}")
        return rep
    # compared in their own type (a 64-bit integer does not fit a float);
    # the size of a difference is for the reader, and may be rounded
    differs = x != y
    if x.dtype.kind in "fc":
        differs &= ~(np.isnan(x) & np.isnan(y))
    fx, fy = x.astype(np.float64), y.astype(np.float64)
    for i in range(x.shape[0]):
        n = int(differs[i].sum())
        if n:
            d = np.abs(fx[i][differs[i]] - fy[i][differs[i]])
            largest = float(np.nanmax(d)) if not np.all(np.isnan(d)) else float("nan")
            r, c = (int(v[0]) for v in np.nonzero(differs[i]))
            rep.add(
                n,
                f"band {i + 1}: {n} cells differ (by up to {largest:g}), "
                f"e.g. row {r} col {c}: {x[i, r, c]} → {y[i, r, c]}",
            )
    return rep


def compare_file(a: Path, b: Path, order: bool = False, examples: int = 3) -> Report:
    kind = kind_of(a.name)
    if kind != kind_of(b.name) or a.name.split(".")[1:] != b.name.split(".")[1:]:
        # two files given by name: what a row is, and whether its place
        # counts, is the kind's — so both names must say the same kind
        raise Unreadable(f"{a.name} and {b.name} are not named as one kind")
    try:
        if a.suffix == ".geojson":
            return compare_geojson(a, b, kind, order, examples)
        if a.suffix == ".json":
            return compare_json(a, b, kind, order, examples)
    except (KeyError, TypeError, IndexError, AttributeError) as err:
        # a row that is not shaped as its kind: never a verdict
        raise Unreadable(f"{a.name}: not shaped as its kind ({type(err).__name__}: {err})") from err
    if a.suffix in (".png", ".tif", ".tiff"):
        return compare_raster(a, b)
    rep = Report()
    try:
        rep.add(a.read_bytes() != b.read_bytes(), "the bytes differ")
    except OSError as err:
        raise Unreadable(f"{a.name}: cannot be read ({err})") from err
    return rep


def files_of(root: Path) -> dict[str, Path]:
    """Every file below `root` by its path there — through linked folders
    too (a site's folder may be a link into a store) —, but for the raw
    downloads and the step cache, which are no part of what a bake hands
    over."""
    if root.is_file():
        return {root.name: root}
    found = {}
    for folder, folders, names in os.walk(root, followlinks=True):
        folders[:] = sorted(d for d in folders if d not in ("_raw", ".bake-cache"))
        for name in sorted(names):
            path = Path(folder) / name
            found[str(path.relative_to(root))] = path
    return found


def compare_trees(
    a: Path,
    b: Path,
    kinds: set[str] | None = None,
    order: bool = False,
    examples: int = 3,
    out=sys.stdout,
) -> int:
    """Prints what differs; returns 0 (the same), 1 (differences) or 2 (a
    side or a file could not be read)."""
    if not a.exists() or not b.exists():
        print(f"no such folder: {a if not a.exists() else b}", file=out)
        return 2
    fa, fb = files_of(a), files_of(b)
    if a.is_file() and b.is_file():
        fb = {a.name: b}
    every = fa.keys() | fb.keys()
    names = sorted(n for n in every if not kinds or kind_of(Path(n).name) in kinds)
    unknown = sorted((kinds or set()) - {kind_of(Path(n).name) for n in every})
    if unknown or not names:
        print(
            f"no file of kind {', '.join(unknown)}" if unknown else "nothing to compare", file=out
        )
        return 2
    differences = 0
    differing = 0
    unreadable = 0
    for name in names:
        if name not in fa or name not in fb:
            print(f"{name}: only in {'a' if name in fa else 'b'}", file=out)
            differences += 1
            differing += 1
            continue
        try:
            rep = compare_file(fa[name], fb[name], order, examples)
        except Unreadable as err:
            print(f"{name}: unreadable — {err}", file=out)
            unreadable += 1
            continue
        if rep.count:
            differing += 1
            differences += rep.count
            print(f"{name}: {rep.summary}", file=out)
            for note in rep.notes:
                print(f"    {note}", file=out)
    print(
        f"{len(names)} files compared, {differing} differ: {differences} differences"
        + (f"; {unreadable} unreadable" if unreadable else ""),
        file=out,
    )
    return 2 if unreadable else 1 if differences else 0


def at_ref(ref: str, path: str, into: Path) -> Path:
    """`path` as it is at a git ref, unpacked under `into`."""
    run = subprocess.run(["git", "archive", ref, "--", path], cwd=ROOT, capture_output=True)
    if run.returncode != 0:
        raise Unreadable(f"{path} at {ref}: {run.stderr.decode().strip()}")
    with tarfile.open(fileobj=io.BytesIO(run.stdout)) as tar:
        tar.extractall(into, filter="data")
    return into / path


def band(path: Path, desc: str | None) -> np.ndarray:
    try:
        with rasterio.open(path) as ds:
            i = list(ds.descriptions).index(desc) + 1 if desc else 1
            a = ds.read(i).astype(np.float64)
    except (OSError, ValueError, rasterio.errors.RasterioError) as err:
        raise Unreadable(f"{path}: no raster with a band {desc or 1} ({err})") from err
    a[a == -9999] = np.nan
    return a


def compare_lsc_rasters(a: Path, b: Path) -> bool:
    same = True
    for name, desc in LSC_RASTERS.items():
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


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n")[0])
    p.add_argument("sides", nargs="*", type=Path, metavar="PATH")
    p.add_argument("--ref")
    p.add_argument("--rasters", nargs=2, type=Path, metavar=("NEW", "OLD"))
    p.add_argument("--kind", action="append")
    p.add_argument("--order", action="store_true")
    p.add_argument("--examples", type=int, default=3)
    args = p.parse_args(argv)
    kinds = set(args.kind) if args.kind else None
    if args.rasters:
        try:
            return 0 if compare_lsc_rasters(*args.rasters) else 1
        except Unreadable as err:
            print(err)
            return 2
    if args.ref or not args.sides:
        if len(args.sides) > 1:
            p.error("--ref takes one path")
        path = str(args.sides[0]) if args.sides else "data"
        ref = args.ref or "HEAD"
        with tempfile.TemporaryDirectory() as tmp:
            try:
                old = at_ref(ref, path, Path(tmp))
            except Unreadable as err:
                print(err)
                return 2
            print(f"a: {path} at {ref}; b: the work tree")
            return compare_trees(old, ROOT / path, kinds, args.order, args.examples)
    if len(args.sides) != 2:
        p.error("two folders, or --ref REF [path]")
    return compare_trees(args.sides[0], args.sides[1], kinds, args.order, args.examples)


if __name__ == "__main__":
    sys.exit(main())
