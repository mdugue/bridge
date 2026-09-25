"""OSM street furniture → one point layer per tile: benches, picnic tables,
litter bins, bicycle stands, bollards, post boxes and stop shelters.

Every object is a Point with its kind (`k`) and, where it has a front, the
compass bearing it faces (`a`, degrees clockwise from north). OSM seldom
says which way a bench looks (`direction`, on ~3 % of Dresden's), so an
untagged one faces the nearest way — a bench by a path looks onto it, a
stand's hoops and a shelter's open side turn to the street. A bench drawn
as a way stands at its midpoint along that way, the length it is mapped.

What the tags carry is kept, nothing else is invented: a bench's backrest
(`backrest=no` → `back: false`), a bicycle stand's capacity (two bikes to a
hoop, `n` hoops in a row). Wall loops are left out (they hang on a facade),
and so is anything indoors, underground, on the railway or water (the class
raster) or on a bridge deck (the terrain under it is the river). Each tile
writes only what it owns (west/south edges in, lib/city/tileset.ts
`ownsPoint`), so an object on a seam stands once."""

from __future__ import annotations

import json
import math
import re

import numpy as np
import shapely
from PIL import Image

from .common import OSM_ATTRIBUTION, Tile, feature, owns, write_geojson
from .osm import has_extract, read_osm, tag

BLOCKED = (5, 8)  # railway, water
# A way further than this (m) does not turn an object towards it.
FACE_M = 25.0
# Closer than this (m) an object stands on the way: it faces across it.
ON_WAY_M = 0.5
BENCH_M = (1.0, 8.0)  # a mapped bench way's length, clamped
MAX_HOOPS = 12
SHELTER_DEDUP_M = 8.0  # a stop's bus_stop and platform nodes share one shelter
CARDINAL = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
            "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]  # fmt: skip
AMENITIES = {
    "bench": "bench",
    "waste_basket": "bin",
    "bicycle_parking": "bike",
    "post_box": "postbox",
}
POINT_WHERE = (
    "barrier = 'bollard' OR highway = 'bus_stop' "
    'OR other_tags LIKE \'%"amenity"=>"%\' '
    'OR other_tags LIKE \'%"leisure"=>"picnic_table"%\' '
    'OR other_tags LIKE \'%"public_transport"=>"platform"%\''
)
BENCH_WAY_WHERE = 'other_tags LIKE \'%"amenity"=>"bench"%\''


def direction(value: str | None) -> float | None:
    """OSM `direction` (degrees or a compass point) → a bearing, else None."""
    if not value:
        return None
    value = value.strip().upper()
    if value in CARDINAL:
        return CARDINAL.index(value) * 22.5
    m = re.fullmatch(r"(-?\d+(?:\.\d+)?)", value)
    return float(m.group(1)) % 360 if m else None


def bearing(dx: float, dy: float) -> float:
    """The compass bearing (degrees clockwise from north) of an east/north step."""
    return math.degrees(math.atan2(dx, dy)) % 360


def kind_of(barrier: str | None, highway: str | None, other: str | None) -> str | None:
    """What a tagged OSM point is as street furniture, or None."""
    if barrier == "bollard":
        return "bollard"
    if tag(other, "leisure") == "picnic_table":
        return "picnic"
    amenity = tag(other, "amenity")
    if amenity == "shelter":
        return "shelter" if tag(other, "shelter_type") == "public_transport" else None
    if highway == "bus_stop" or tag(other, "public_transport") == "platform":
        return "shelter" if tag(other, "shelter") == "yes" else None
    if amenity == "bicycle_parking" and tag(other, "bicycle_parking") == "wall_loops":
        return None
    return AMENITIES.get(amenity or "")


def hidden(other: str | None) -> bool:
    """Indoors or below ground: nothing the street shows."""
    if tag(other, "indoor") == "yes" or tag(other, "location") in ("indoor", "underground"):
        return True
    level = tag(other, "level") or ""
    return level.startswith("-")


def hoops(capacity: str | None) -> int:
    """A stand's hoops: two bikes to one, at least one."""
    try:
        n = int(float(capacity or "2"))
    except ValueError:
        n = 2
    return max(1, min(MAX_HOOPS, math.ceil(n / 2)))


def facing(point: shapely.Point, ways: shapely.STRtree, lines: np.ndarray) -> float | None:
    """The bearing from a point to the nearest way within FACE_M; across that
    way where the point stands on it; None with no way near."""
    hit = ways.query_nearest(point, max_distance=FACE_M)
    if len(hit) == 0:
        return None
    line = lines[hit[0]]
    near = shapely.get_point(shapely.shortest_line(point, line), 1)
    dx, dy = near.x - point.x, near.y - point.y
    if math.hypot(dx, dy) >= ON_WAY_M:
        return bearing(dx, dy)
    # On the way: a quarter turn from its run there.
    s = line.project(near)
    a = line.interpolate(max(s - 1.0, 0.0))
    b = line.interpolate(min(s + 1.0, line.length))
    return (bearing(b.x - a.x, b.y - a.y) + 90.0) % 360


def bench_on_way(line: shapely.LineString, ways, lines) -> tuple[shapely.Point, float, float]:
    """A bench mapped as a way: its midpoint, the side of it facing the
    nearest path (the right-hand side without one), and its length."""
    mid = line.interpolate(0.5, normalized=True)
    a, b = line.interpolate(0.45, normalized=True), line.interpolate(0.55, normalized=True)
    along = bearing(b.x - a.x, b.y - a.y)
    right = (along + 90.0) % 360
    toward = facing(mid, ways, lines)
    if toward is not None and math.cos(math.radians(toward - right)) < 0:
        right = (right + 180.0) % 360
    return mid, right, min(max(line.length, BENCH_M[0]), BENCH_M[1])


class Gate:
    """Where nothing is stood: off the tile's own ground, on the railway or
    water, on a bridge deck."""

    def __init__(self, tile: Tile) -> None:
        self.bounds = tile.bounds
        self.cls = np.asarray(Image.open(tile.out("dlm", f"landcover_{tile.id}.png")).convert("L"))
        bridge = tile.out("dlm", f"bridge_{tile.id}.geojson")
        decks = []
        if bridge.exists():
            decks = [
                shapely.geometry.shape(f["geometry"])
                for f in json.loads(bridge.read_text())["features"]
            ]
        self.decks = shapely.STRtree(decks) if decks else None

    def open(self, p: shapely.Point) -> bool:
        x, y = p.x, p.y
        if not owns(self.bounds, x, y):
            return False
        xmin, ymin, xmax, ymax = self.bounds
        ch, cw = self.cls.shape
        c = min(int((x - xmin) / (xmax - xmin) * cw), cw - 1)
        r = min(int((ymax - y) / (ymax - ymin) * ch), ch - 1)
        if self.cls[r, c] in BLOCKED:
            return False
        return self.decks is None or len(self.decks.query(p, predicate="intersects")) == 0


def _point_feature(p: shapely.Point, props: dict) -> dict:
    return feature({"type": "Point", "coordinates": [round(p.x, 2), round(p.y, 2)]}, props)


def _points(tile: Tile, gate: Gate, ways, lines) -> list[dict]:
    geoms, fields = read_osm(
        tile, "points", POINT_WHERE, ["barrier", "highway", "other_tags"], margin=0.0005
    )
    out, shelters = [], []
    for g, barrier, highway, other in zip(
        geoms, fields["barrier"], fields["highway"], fields["other_tags"], strict=True
    ):
        k = kind_of(barrier, highway, other)
        if k is None or hidden(other) or not gate.open(g):
            continue
        if k == "shelter":
            if any(g.distance(s) < SHELTER_DEDUP_M for s in shelters):
                continue
            shelters.append(g)
        props: dict = {"k": k}
        if k not in ("bollard", "bin"):
            a = direction(tag(other, "direction")) if k == "bench" else None
            a = a if a is not None else facing(g, ways, lines)
            if a is not None:
                props["a"] = round(a)
        if k == "bench" and tag(other, "backrest") == "no":
            props["back"] = False
        if k == "bike":
            props["n"] = hoops(tag(other, "capacity"))
        out.append(_point_feature(g, props))
    return out


def _bench_ways(tile: Tile, gate: Gate, ways, lines) -> list[dict]:
    geoms, fields = read_osm(tile, "lines", BENCH_WAY_WHERE, ["other_tags"], margin=0.0005)
    out = []
    for g, other in zip(geoms, fields["other_tags"], strict=True):
        if g.geom_type != "LineString" or tag(other, "amenity") != "bench" or hidden(other):
            continue
        mid, a, length = bench_on_way(g, ways, lines)
        if not gate.open(mid):
            continue
        props: dict = {"k": "bench", "a": round(a), "l": round(length, 1)}
        if tag(other, "backrest") == "no":
            props["back"] = False
        out.append(_point_feature(mid, props))
    return out


def run(tile: Tile) -> None:
    if not has_extract(tile, "the street furniture"):
        return
    lines, _ = read_osm(tile, "lines", "highway IS NOT NULL", ["highway"], margin=0.001)
    lines = np.array([g for g in lines if g.geom_type == "LineString"], dtype=object)
    ways = shapely.STRtree(lines)
    gate = Gate(tile)
    features = _points(tile, gate, ways, lines) + _bench_ways(tile, gate, ways, lines)
    write_geojson(
        tile.out("dlm", f"furniture_{tile.id}.geojson"), features, tile.epsg, OSM_ATTRIBUTION
    )
    counts: dict[str, int] = {}
    for f in features:
        counts[f["properties"]["k"]] = counts.get(f["properties"]["k"], 0) + 1
    print(f"{tile.id}: street furniture {dict(sorted(counts.items()))}")
