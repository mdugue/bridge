"""OSM way names → the lettering a map would carry, one layer per tile.

- **Labels** (`k: label`): per named way, merged with every way of the same
  name around the tile (a street is many OSM ways), anchors along its
  straightest stretches — a window of `len(name) × 4.2 m + 20 m` whose
  direction turns less than 20° — one per 450 m of street, each written by
  the tile that owns the window's middle, so a name across a seam is
  lettered once. Each anchor is the sub-polyline it lies on (the letters
  follow the curve), with the name and its class `c`: `main` (trunk to
  tertiary), `minor` (every other named way), `bridge` (the named bridge
  decks, DLM `NAM`, along the deck's long axis) or `square` (a named
  `place=square` or pedestrian area, across its long axis).
- **Ways** (`k: way`): every named street as merged lines cut at the tile
  edge (simplified to 1 m) — what the on-foot caption looks up.

Not `service` ways nor sidewalks (`footway=sidewalk`): they carry the
street's name twice.
"""

from __future__ import annotations

import json
import math
from collections import defaultdict

import shapely
import shapely.ops

from .common import OSM_ATTRIBUTION, Tile, column, feature, geometry_json, owns, write_geojson
from .osm import has_extract, read_osm, tag

MARGIN_M = 50.0
M_PER_CHAR = 4.2
LABEL_PAD_M = 20.0
MAX_TURN_DEG = 20.0
LABEL_EVERY_M = 450.0
LABEL_APART_M = 200.0
STEP_M = 5.0
MAIN = {"trunk", "primary", "secondary", "tertiary"}
SKIP = {"service", "proposed", "construction", "platform", "bus_stop", "corridor"}
WAY_SIMPLIFY_M = 1.0


def label_length(name: str) -> float:
    return len(name) * M_PER_CHAR + LABEL_PAD_M


def road_class(highway: str | None) -> str:
    base = (highway or "").removesuffix("_link")
    return "main" if base in MAIN else "minor"


def _bearings(line: shapely.LineString, s0: float, s1: float) -> list[float]:
    pts = [line.interpolate(s) for s in _steps(s0, s1)]
    return [
        math.degrees(math.atan2(b.x - a.x, b.y - a.y)) for a, b in zip(pts, pts[1:], strict=False)
    ]


def _steps(s0: float, s1: float) -> list[float]:
    n = max(int((s1 - s0) / STEP_M), 1)
    return [s0 + (s1 - s0) * i / n for i in range(n + 1)]


def turning(line: shapely.LineString, s0: float, s1: float) -> float:
    """How far the direction swings within [s0, s1] (degrees)."""
    bs = _bearings(line, s0, s1)
    if not bs:
        return 0.0
    unwrapped = [bs[0]]
    for b in bs[1:]:
        d = (b - unwrapped[-1] + 180.0) % 360.0 - 180.0
        unwrapped.append(unwrapped[-1] + d)
    return max(unwrapped) - min(unwrapped)


def anchors(line: shapely.LineString, name: str) -> list[shapely.LineString]:
    """The straight windows a name is lettered on: one per LABEL_EVERY_M of
    line, each the straightest candidate nearest the middle of its share."""
    length = label_length(name)
    if line.length < length:
        return []
    count = max(1, int(line.length // LABEL_EVERY_M))
    share = line.length / count
    out = []
    for k in range(count):
        mid = (k + 0.5) * share
        best, best_d = None, math.inf
        s = max(k * share - length / 2, 0.0)
        while s + length <= min((k + 1) * share + length / 2, line.length):
            if turning(line, s, s + length) < MAX_TURN_DEG:
                d = abs(s + length / 2 - mid)
                if d < best_d:
                    best, best_d = s, d
            s += STEP_M
        if best is not None:
            out.append(shapely.ops.substring(line, best, best + length).simplify(0.5))
    return out


def streets(tile: Tile) -> dict[str, tuple[shapely.Geometry, str]]:
    """Every name's merged lines around the tile, and its class."""
    geoms, fields = read_osm(
        tile, "lines", "highway IS NOT NULL AND name IS NOT NULL", ["highway", "name", "other_tags"]
    )
    xmin, ymin, xmax, ymax = tile.bounds
    area = shapely.box(xmin - MARGIN_M, ymin - MARGIN_M, xmax + MARGIN_M, ymax + MARGIN_M)
    parts: dict[str, list] = defaultdict(list)
    classes: dict[str, str] = {}
    for g, highway, name, other in zip(
        geoms,
        column(fields, "highway", geoms),
        column(fields, "name", geoms),
        column(fields, "other_tags", geoms),
        strict=True,
    ):
        if not name or highway in SKIP or tag(other, "footway") == "sidewalk":
            continue
        clipped = g.intersection(area)
        if clipped.is_empty:
            continue
        parts[name].append(clipped)
        if road_class(highway) == "main" or name not in classes:
            classes[name] = road_class(highway)
    return {
        name: (shapely.line_merge(shapely.union_all(ps)), classes[name])
        for name, ps in parts.items()
    }


def _line_parts(g: shapely.Geometry) -> list[shapely.LineString]:
    return [p for p in shapely.get_parts(g) if p.geom_type == "LineString" and not p.is_empty]


def _label(line: shapely.LineString, name: str, cls: str) -> dict:
    return feature(geometry_json(line), {"k": "label", "name": name, "c": cls})


def street_labels(tile: Tile, named: dict) -> list[dict]:
    """The anchors the tile owns; a name lettered again within
    LABEL_APART_M of itself (the other carriageway, a fragment) is not."""
    out = []
    for name, (merged, cls) in sorted(named.items()):
        mids: list[shapely.Point] = []
        parts = sorted(_line_parts(merged), key=lambda p: -p.length)
        for part in parts:
            for window in anchors(part, name):
                mid = window.interpolate(0.5, normalized=True)
                if any(mid.distance(m) < LABEL_APART_M for m in mids):
                    continue
                mids.append(mid)
                if owns(tile.bounds, mid.x, mid.y):
                    out.append(_label(window, name, cls))
    return out


def street_ways(tile: Tile, named: dict) -> list[dict]:
    box = shapely.box(*tile.bounds)
    out = []
    for name, (merged, _) in sorted(named.items()):
        for part in _line_parts(merged.intersection(box)):
            if part.length >= 2.0:
                simple = part.simplify(WAY_SIMPLIFY_M)
                out.append(feature(geometry_json(simple), {"k": "way", "name": name}))
    return out


def axis_label(shape: shapely.Geometry, name: str) -> shapely.LineString:
    """A centred straight line along a shape's long axis, the name's length."""
    rect = shape.minimum_rotated_rectangle
    c = list(rect.exterior.coords)
    e1 = (c[1][0] - c[0][0], c[1][1] - c[0][1])
    e2 = (c[2][0] - c[1][0], c[2][1] - c[1][1])
    ux, uy = max((e1, e2), key=lambda e: math.hypot(*e))
    n = math.hypot(ux, uy) or 1.0
    ux, uy = ux / n, uy / n
    p = (
        shape.centroid
        if shape.geom_type != "LineString"
        else shape.interpolate(0.5, normalized=True)
    )
    half = label_length(name) / 2
    return shapely.LineString(
        [(p.x - ux * half, p.y - uy * half), (p.x + ux * half, p.y + uy * half)]
    )


def bridge_labels(tile: Tile) -> list[dict]:
    """The named bridge decks (the rail step's file), each name once: its
    largest deck on the tile."""
    path = tile.data / "dlm" / f"bridge_{tile.id}.geojson"
    if not path.exists():
        return []
    best: dict[str, shapely.Geometry] = {}
    for f in json.loads(path.read_text())["features"]:
        name = (f.get("properties") or {}).get("name")
        if not name:
            continue
        deck = shapely.geometry.shape(f["geometry"])
        if name not in best or deck.area > best[name].area:
            best[name] = deck
    out = []
    for name, deck in sorted(best.items()):
        c = deck.centroid
        if owns(tile.bounds, c.x, c.y):
            out.append(_label(axis_label(deck, name), name, "bridge"))
    return out


def square_labels(tile: Tile) -> list[dict]:
    where = (
        "name IS NOT NULL AND (place = 'square' OR other_tags LIKE '%\"highway\"=>\"pedestrian\"%')"
    )
    geoms, fields = read_osm(tile, "multipolygons", where, ["name", "place", "other_tags"])
    best: dict[str, shapely.Geometry] = {}
    for g, name in zip(geoms, column(fields, "name", geoms), strict=True):
        if name and g.area >= 400.0 and (name not in best or g.area > best[name].area):
            best[name] = g
    out = []
    for name, g in sorted(best.items()):
        p = g.representative_point()
        if owns(tile.bounds, p.x, p.y):
            out.append(_label(axis_label(g, name), name, "square"))
    return out


def run(tile: Tile) -> None:
    if not has_extract(tile, "the street names"):
        return
    named = streets(tile)
    squares = square_labels(tile)
    square_names = {f["properties"]["name"] for f in squares}
    # A square's streets carry its name too: the square letters it once.
    labels = [f for f in street_labels(tile, named) if f["properties"]["name"] not in square_names]
    features = labels + bridge_labels(tile) + squares + street_ways(tile, named)
    write_geojson(tile.out("dlm", f"names_{tile.id}.geojson"), features, tile.epsg, OSM_ATTRIBUTION)
    counts: dict[str, int] = defaultdict(int)
    for f in features:
        p = f["properties"]
        counts[p.get("c", p["k"])] += 1
    print(f"{tile.id}: names {dict(sorted(counts.items()))}")
