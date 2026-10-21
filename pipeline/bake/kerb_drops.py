"""Where a kerb is lowered (the ground check's B14): stretches along the kerb
lines edges.py lays where OSM says the stone is lowered or flush. Without
them every kerb stood its full 12 cm (lib/city/kerbs.ts `KERB_HEIGHT`)
across every zebra, signal crossing and driveway.

A stretch is lowered (`LOWERED_H` over the road: a Bordabsenkung) or flush
(`FLUSH_H`):

- at a pedestrian crossing: a `highway=crossing` node on a carriageway (or
  a traffic signal tagged `crossing=*`) lowers the nearest kerb on either
  side where the perpendicular through it across the road meets one within
  CROSSING_REACH_M; a crossing way (`footway`, `cycleway` or `path` =
  `crossing`) lowers every kerb line it meets. CROSSING_HALF_M either side,
  lowered unless the crossing carries a `kerb=*` of its own; none for
  `crossing=no`.
- at a kerb node: `kerb=lowered|rolled` lowered, `kerb=flush|no` flush, on
  the nearest kerb line within NODE_REACH_M (the kerb line is the DLM's
  road edge, a metre or two off OSM's), CROSSING_HALF_M either side. A
  `kerb=raised|regular` node keeps its kerb: a crossing's or a driveway's
  stretch within NODE_REACH_M of it is not lowered.
- across a driveway (`service=driveway`, and a service way without a
  `service` tag: a yard's or a car park's gate — the DLM leaves both out
  of the carriageway, so its kerb runs across them): where it meets a kerb
  line, or ends within NODE_REACH_M of one, over half its `width` (else
  DRIVEWAY_W), at least CROSSING_HALF_M, either side.

Stretches closer than MERGE_GAP_M join (the lower height holds). They are
written on each kerb feature as `low: [[s0, s1, h], …]`, metres along the
line as written (the road on its left); the stone ramps back to its full
height over 0.5 m beyond each (kerbs.ts `RAMP_M`).
"""

from __future__ import annotations

import re

import numpy as np
import shapely

from .common import Tile, column
from .osm import has_extract, read_osm, read_ways, tag

LOWERED_H = 0.03  # m over the road
FLUSH_H = 0.0
CROSSING_HALF_M = 1.5
CROSSING_REACH_M = 15.0  # half a wide carriageway and its parking lane (m)
ON_ROAD_M = 2.0  # a crossing node this close to a carriageway's axis is on it
NODE_REACH_M = 3.0
DRIVEWAY_W = 3.0
MERGE_GAP_M = 1.0
KERB_KINDS = {"lowered": LOWERED_H, "rolled": LOWERED_H, "flush": FLUSH_H, "no": FLUSH_H}
FULL_KINDS = ("raised", "regular")
NODE_WHERE = (
    "highway = 'crossing' OR barrier = 'kerb' OR other_tags LIKE '%\"kerb\"=>%' "
    "OR (highway = 'traffic_signals' AND other_tags LIKE '%\"crossing\"=>%')"
)
CROSSING_WAYS = (
    "highway IN ('footway', 'cycleway', 'path') AND ("
    'other_tags LIKE \'%"footway"=>"crossing"%\' '
    'OR other_tags LIKE \'%"cycleway"=>"crossing"%\' '
    'OR other_tags LIKE \'%"path"=>"crossing"%\')'
)
DRIVEWAYS = (
    "highway = 'service' AND (other_tags IS NULL "
    "OR other_tags NOT LIKE '%\"service\"=>%' "
    'OR other_tags LIKE \'%"service"=>"driveway"%\')'
)

Drop = tuple[float, float, float, bool]  # from, to (m along), height, tagged so


class Kerbs:
    """The tile's kerb lines, searchable, and the stretches found on them."""

    def __init__(self, lines: list[shapely.LineString]) -> None:
        self.lines = lines
        self.tree = shapely.STRtree(lines) if lines else None
        self.drops: list[list[Drop]] = [[] for _ in lines]
        self.full: list[list[float]] = [[] for _ in lines]

    def lower(self, i: int, at: shapely.Point, half: float, h: float, tagged: bool) -> None:
        s = float(self.lines[i].project(at))
        self.drops[i].append((s - half, s + half, h, tagged))

    def nearest(self, at: shapely.Point, reach: float) -> int | None:
        if self.tree is None:
            return None
        hit = self.tree.query_nearest(at, max_distance=reach)
        return int(hit[0]) if len(hit) else None

    def crossed(self, way: shapely.Geometry) -> list[tuple[int, shapely.Point]]:
        """Each kerb line the way meets, and where."""
        if self.tree is None:
            return []
        out = []
        for i in self.tree.query(way, predicate="intersects"):
            for part in shapely.get_parts(shapely.intersection(way, self.lines[i])):
                at = part if isinstance(part, shapely.Point) else part.centroid
                out.append((int(i), at))
        return out


def kerb_kind(other_tags: str | None) -> float | None:
    """A node's or way's own kerb: its height over the road, None untagged."""
    return KERB_KINDS.get(tag(other_tags, "kerb") or "")


def road_normal(at: shapely.Point, roads: shapely.STRtree | None) -> np.ndarray | None:
    """The unit normal of the carriageway the point lies on, None off one."""
    if roads is None:
        return None
    hit = roads.query_nearest(at, max_distance=ON_ROAD_M)
    if not len(hit):
        return None
    road = roads.geometries[int(hit[0])]
    s = road.project(at)
    a = np.asarray(road.interpolate(max(0.0, s - 1.0)).coords[0])
    b = np.asarray(road.interpolate(min(road.length, s + 1.0)).coords[0])
    d = b - a
    n = np.hypot(*d)
    return None if n == 0 else np.array([-d[1], d[0]]) / n


def crossing_node(kerbs: Kerbs, at: shapely.Point, h: float, roads) -> None:
    """A crossing on a carriageway: the nearest kerb either side across it."""
    n = road_normal(at, roads)
    if n is None:
        return
    p = np.asarray(at.coords[0])
    across = shapely.LineString([p - n * CROSSING_REACH_M, p + n * CROSSING_REACH_M])
    best: dict[int, tuple[float, int, shapely.Point]] = {}
    for i, hit in kerbs.crossed(across):
        off = float(np.dot(np.asarray(hit.coords[0]) - p, n))
        side = 1 if off > 0 else -1
        if side not in best or abs(off) < best[side][0]:
            best[side] = (abs(off), i, hit)
    for _, i, hit in best.values():
        kerbs.lower(i, hit, CROSSING_HALF_M, h, False)


def nodes(tile: Tile, kerbs: Kerbs, roads) -> None:
    geoms, fields = read_osm(tile, "points", NODE_WHERE, ["highway", "barrier", "other_tags"])
    kinds, tags = column(fields, "highway", geoms), column(fields, "other_tags", geoms)
    for at, highway, other in zip(geoms, kinds, tags, strict=True):
        if at is None:
            continue
        kerb = tag(other, "kerb")
        if kerb in FULL_KINDS:
            i = kerbs.nearest(at, NODE_REACH_M)
            if i is not None:
                kerbs.full[i].append(float(kerbs.lines[i].project(at)))
            continue
        h = kerb_kind(other)
        if highway in ("crossing", "traffic_signals"):
            if tag(other, "crossing") != "no":
                crossing_node(kerbs, at, LOWERED_H if h is None else h, roads)
        elif h is not None:
            i = kerbs.nearest(at, NODE_REACH_M)
            if i is not None:
                kerbs.lower(i, at, CROSSING_HALF_M, h, True)


def crossing_ways(tile: Tile, kerbs: Kerbs) -> None:
    geoms, fields = read_ways(tile, CROSSING_WAYS, ["highway", "other_tags"])
    for way, other in zip(geoms, column(fields, "other_tags", geoms), strict=True):
        if way is None or tag(other, "crossing") == "no" or tag(other, "kerb") in FULL_KINDS:
            continue
        h = kerb_kind(other)
        for i, at in kerbs.crossed(way):
            kerbs.lower(i, at, CROSSING_HALF_M, LOWERED_H if h is None else h, h is not None)


def half_width(other_tags: str | None) -> float:
    m = re.match(r"\s*(\d+(?:\.\d+)?)", tag(other_tags, "width") or "")
    w = float(m.group(1)) if m else DRIVEWAY_W
    return max(CROSSING_HALF_M, min(w, 2 * DRIVEWAY_W) / 2)


def driveways(tile: Tile, kerbs: Kerbs) -> None:
    geoms, fields = read_ways(tile, DRIVEWAYS, ["highway", "other_tags"])
    for way, other in zip(geoms, column(fields, "other_tags", geoms), strict=True):
        if way is None or (tag(other, "bridge") or "no") != "no":
            continue
        half = half_width(other)
        hits = kerbs.crossed(way)
        if not hits:
            for end in (shapely.Point(way.coords[0]), shapely.Point(way.coords[-1])):
                i = kerbs.nearest(end, NODE_REACH_M)
                if i is not None:
                    hits.append((i, end))
        for i, at in hits:
            kerbs.lower(i, at, half, LOWERED_H, False)


def merged(drops: list[Drop], full: list[float], length: float) -> list[list[float]]:
    """A line's stretches: those a full-kerb node vetoes left out, clipped to
    the line, the ones closer than MERGE_GAP_M joined at the lower height."""
    keep = [
        (max(0.0, a), min(length, b), h)
        for a, b, h, tagged in drops
        if tagged or not any(a - NODE_REACH_M <= s <= b + NODE_REACH_M for s in full)
    ]
    out: list[list[float]] = []
    for a, b, h in sorted(k for k in keep if k[1] > k[0]):
        if out and a <= out[-1][1] + MERGE_GAP_M:
            out[-1][1] = max(out[-1][1], b)
            out[-1][2] = min(out[-1][2], h)
        else:
            out.append([a, b, h])
    return [[round(a, 2), round(b, 2), round(h, 2)] for a, b, h in out]


def kerb_drops(
    tile: Tile, lines: list[shapely.LineString], roads: shapely.STRtree | None
) -> list[list[list[float]]]:
    """Per kerb line, its lowered stretches `[from, to, height]` (m along the
    line, m over the road); none without an OSM extract."""
    kerbs = Kerbs(lines)
    if lines and has_extract(tile, "the lowered kerbs (every kerb stands full)"):
        nodes(tile, kerbs, roads)
        crossing_ways(tile, kerbs)
        driveways(tile, kerbs)
    return [
        merged(d, f, line.length) for d, f, line in zip(kerbs.drops, kerbs.full, lines, strict=True)
    ]
