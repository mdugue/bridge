"""OSM trams → one layer per tile: the tracks, the overhead line's supports
and (plan 024 phase 3) the stop signs.

- **Tracks**: `railway=tram` ways (OSM maps every track as its own way;
  Dresden's are all `gauge=1450`, `electrified=contact_line`), each with the
  bed it runs in and the OSM `bridge` and `layer`. The bed is read every
  2 m from the committed class raster — `street` on the road and on the
  paved squares and yards (the built-up and path classes: Postplatz), `grass`
  (Dresden's *Rasengleis*) on farmland/meadow or vegetation (NDVI > 0.3),
  else `ballast` — smoothed along the track (a majority over 20 m, no bed
  shorter than 20 m), and the track is cut where it changes: one bed per
  whole chain put a kilometre of street track in ballast because a lawn or
  a square lay under a third of it. Fragments with the same properties are
  chained (1 m snap, as rail.py does) and cut at the tile edge: each tile
  draws its own stretch and the runtime samples the cross-tile ground, so
  the rails meet at the seam.
- **Supports**: the mapped `power=catenary_mast` points (each owned by one
  tile); a *span* wire from a mast across the tracks to the nearest mast on
  the other side (≤ 28 m), else an *arm* from the mast over the nearest
  track (≤ 10 m, reaching over a parallel second track). Where a track runs
  45 m from any mapped mast — the narrow streets, where Dresden hangs the
  wire from wall rosettes — a span every 30 m between the facades either
  side (the OSM building outlines, ≤ 15 m out; none where either side has
  no facade: nothing is invented). Each track carries `s`, the distances
  (m, along the drawn line) where a span or arm holds its contact wire, so
  the runtime sags the wire between them.

- **Stops** (phase 3): a `railway=tram_stop` node sits on the track (the
  stop position), so its "H" sign stands on the nearest OSM platform
  (`public_transport=platform` or `railway=platform`, ≤ 25 m) at the point
  nearest the stop, facing the track — not where a shelter or a bus stop's
  sign already stands (the committed furniture of the tile and of its
  neighbours across a seam, ≤ 8 m), one per 8 m (decided over every stop
  around the tile, written by the tile that owns the sign). A stop without
  a mapped platform gets no sign: nothing is invented.

Everything is decided on the tracks and masts within 30 m around the tile,
so a support on a seam is the same in both tiles; a span or arm is written
by the tile that owns its midpoint (a mast: its point).
"""

from __future__ import annotations

import json
import math
from collections import defaultdict

import numpy as np
import shapely
import shapely.ops
from PIL import Image

from .common import (
    OSM_ATTRIBUTION,
    Tile,
    column,
    feature,
    overlaps,
    owns,
    value_at,
    write_geojson,
)
from .osm import has_extract, read_osm, tag
from .rail import merge_lines

MARGIN_M = 30.0  # tracks and masts around the tile the supports are decided on
SAMPLE_M = 2.0
GRASS_NDVI = 0.3
ROAD, MEADOW = 7, 1  # class ids (landcover.py CLASSES)
PAVED = (4, 6)  # built-up (squares, yards) and path: a track there is set in paving
BED_WINDOW_M = 20.0  # the bed is the majority of the samples this long around a point
BED_MIN_M = 20.0  # a stretch of another bed shorter than this takes its neighbours'
BED_ORDER = ("street", "grass", "ballast")
SPAN_MAX_M = 28.0
ARM_MAX_M = 10.0
MAST_NEAR_M = 15.0  # a mast further from every tram track is the railway's
ARM_PAIR_M = 4.5  # a second track this much beyond the nearest shares its arm
ARM_OVERSHOOT_M = 0.3
NO_MAST_M = 45.0
ROSETTE_EVERY_M = 30.0
FACADE_MAX_M = 15.0
ROSETTE_DEDUP_M = 12.0
MAST_WHERE = 'other_tags LIKE \'%"power"=>"catenary_mast"%\''
STOP_WHERE = 'other_tags LIKE \'%"railway"=>"tram_stop"%\''
PLATFORM_WHERE = (
    'other_tags LIKE \'%"public_transport"=>"platform"%\' '
    'OR other_tags LIKE \'%"railway"=>"platform"%\''
)
PLATFORM_M = 25.0  # a stop's sign stands on a platform at most this far away
SIGN_DEDUP_M = 8.0  # one sign per stop: none near a shelter or another sign


class Beds:
    """The committed class raster (and the NDVI raster, when the tile has
    one) the bed of a track is read from."""

    def __init__(self, tile: Tile) -> None:
        self.bounds = tile.bounds
        cls = tile.classes()
        if cls is None:
            raise FileNotFoundError(f"{tile.id}: no class raster — bake landcover first")
        self.cls = cls
        ndvi = tile.data / "dlm" / f"ndvi_{tile.id}.png"
        self.ndvi = np.asarray(Image.open(ndvi).convert("L")) if ndvi.exists() else None

    def _at(self, raster: np.ndarray, x: float, y: float) -> int | None:
        return value_at(raster, self.bounds, x, y)

    def sample_bed(self, x: float, y: float) -> str | None:
        """The bed under one point; None off the tile."""
        c = self._at(self.cls, x, y)
        if c is None:
            return None
        v = self._at(self.ndvi, x, y) if self.ndvi is not None else None
        if c == ROAD:
            return "street"
        if c == MEADOW or (v is not None and v > GRASS_NDVI * 255):
            return "grass"
        return "street" if c in PAVED else "ballast"

    def beds(self, line: shapely.LineString) -> list[tuple[shapely.LineString, str | None]]:
        """The line cut where its bed changes: [(piece, bed)], the bed None
        for a way seen only through the margin (no sample on the tile)."""
        n = max(int(line.length / SAMPLE_M), 1)
        raw = [
            self.sample_bed(*line.interpolate(i / n, normalized=True).coords[0])
            for i in range(n + 1)
        ]
        if all(b is None for b in raw):
            return [(line, None)]
        labels = smooth_beds(raw, max(int(BED_WINDOW_M / SAMPLE_M / 2), 1))
        labels = absorb_short(labels, max(int(BED_MIN_M / SAMPLE_M), 1))
        out = []
        i = 0
        while i < len(labels):
            j = i
            while j + 1 < len(labels) and labels[j + 1] == labels[i]:
                j += 1
            # cut halfway between the last sample of one bed and the first of the next
            a = 0.0 if i == 0 else (i - 0.5) / n
            b = 1.0 if j == len(labels) - 1 else (j + 0.5) / n
            piece = shapely.ops.substring(line, a, b, normalized=True)
            if piece.geom_type == "LineString" and piece.length > 0:
                out.append((piece, labels[i]))
            i = j + 1
        return out


def smooth_beds(raw: list[str | None], half: int) -> list[str]:
    """The majority bed within `half` samples either side of each (ties in
    BED_ORDER), ignoring samples off the tile."""
    out = []
    for i in range(len(raw)):
        near = [b for b in raw[max(0, i - half) : i + half + 1] if b is not None]
        if not near:
            near = [b for b in raw if b is not None]
        out.append(max(BED_ORDER, key=lambda b: (near.count(b), -BED_ORDER.index(b))))
    return out


def absorb_short(labels: list[str], min_run: int) -> list[str]:
    """Runs shorter than `min_run` samples take the bed of the longer
    neighbouring run, shortest first, until none is left (or one run)."""
    labels = list(labels)
    while True:
        runs = []
        i = 0
        while i < len(labels):
            j = i
            while j + 1 < len(labels) and labels[j + 1] == labels[i]:
                j += 1
            runs.append((i, j))
            i = j + 1
        short = [r for r in runs if r[1] - r[0] + 1 < min_run]
        if len(runs) == 1 or not short:
            return labels
        k = runs.index(min(short, key=lambda r: r[1] - r[0]))
        prev = runs[k - 1] if k > 0 else None
        nxt = runs[k + 1] if k + 1 < len(runs) else None
        side = max((r for r in (prev, nxt) if r is not None), key=lambda r: r[1] - r[0])
        bed = labels[side[0]]
        i0, i1 = runs[k]
        for m in range(i0, i1 + 1):
            labels[m] = bed


def bridge_of(other: str | None) -> int:
    return 1 if (tag(other, "bridge") or "no") not in ("no", "") else 0


def layer_of(other: str | None) -> int:
    try:
        return int(tag(other, "layer") or 0)
    except ValueError:
        return 0


def tracks(tile: Tile, beds: Beds) -> list[tuple[shapely.LineString, dict]]:
    """Merged track lines (unclipped) with their properties."""
    geoms, fields = read_osm(tile, "lines", "railway = 'tram'", ["railway", "other_tags"])
    groups: dict[tuple, list] = defaultdict(list)
    fallback: dict[tuple, list] = defaultdict(list)
    for g, other in zip(geoms, column(fields, "other_tags", geoms), strict=True):
        for part in shapely.get_parts(g):
            if part.geom_type != "LineString" or part.length < 0.5:
                continue
            key = (bridge_of(other), layer_of(other))
            for piece, bed in beds.beds(part):
                coords = [(x, y) for x, y, *_ in piece.coords]
                if bed is None:
                    fallback[key].append(coords)  # margin only: its bed never shows
                else:
                    groups[(bed, *key)].append(coords)
    out = []
    for (bed, bridge, layer), lines in groups.items():
        for chain in merge_lines(lines):
            out.append((shapely.LineString(chain), {"bed": bed, "bridge": bridge, "layer": layer}))
    for (bridge, layer), lines in fallback.items():
        for chain in merge_lines(lines):
            out.append((shapely.LineString(chain), {"bed": None, "bridge": bridge, "layer": layer}))
    return out


def masts(tile: Tile, area: shapely.Polygon, track_tree: shapely.STRtree) -> list[shapely.Point]:
    """The catenary masts that serve a tram (the railway's own stand far
    from any tram track)."""
    geoms, _ = read_osm(tile, "points", MAST_WHERE, ["other_tags"])
    return [
        g
        for g in geoms
        if g.geom_type == "Point"
        and area.contains(g)
        and len(track_tree.query(g, predicate="dwithin", distance=MAST_NEAR_M)) > 0
    ]


def mast_spans(
    points: list[shapely.Point], track_tree: shapely.STRtree
) -> tuple[list[shapely.LineString], set[int]]:
    """Mast pairs across the tracks, shortest first, each mast in one pair."""
    candidates = []
    for i, a in enumerate(points):
        for j in range(i + 1, len(points)):
            d = a.distance(points[j])
            if d <= SPAN_MAX_M:
                candidates.append((d, i, j))
    used: set[int] = set()
    spans = []
    for _, i, j in sorted(candidates):
        if i in used or j in used:
            continue
        span = shapely.LineString([points[i], points[j]])
        if len(track_tree.query(span, predicate="intersects")) == 0:
            continue
        used.update((i, j))
        spans.append(span)
    return spans, used


def mast_arm(
    mast: shapely.Point, lines: list[shapely.LineString], track_tree: shapely.STRtree
) -> shapely.LineString | None:
    """An arm from the mast over the nearest track — over a parallel second
    one too when it lies just beyond."""
    near = []
    for k in track_tree.query(mast.buffer(ARM_MAX_M), predicate="intersects"):
        d = lines[k].distance(mast)
        if d <= ARM_MAX_M:
            near.append((d, k))
    if not near:
        return None
    near.sort()
    d0 = near[0][0]
    far = max((n for n in near if n[0] <= d0 + ARM_PAIR_M), key=lambda n: n[0])
    end = shapely.get_point(shapely.shortest_line(mast, lines[far[1]]), 1)
    dx, dy = end.x - mast.x, end.y - mast.y
    length = math.hypot(dx, dy)
    if length < 0.5:
        return None
    k = (length + ARM_OVERSHOOT_M) / length
    return shapely.LineString([(mast.x, mast.y), (mast.x + dx * k, mast.y + dy * k)])


class Facades:
    """The OSM building outlines a rosette wire can be fixed to."""

    def __init__(self, tile: Tile) -> None:
        geoms, _ = read_osm(tile, "multipolygons", "building IS NOT NULL", ["building"])
        self.areas = [g for g in geoms if g.geom_type in ("Polygon", "MultiPolygon")]
        self.walls = [g.boundary for g in self.areas]
        self.tree = shapely.STRtree(self.walls) if self.walls else None
        self.area_tree = shapely.STRtree(self.areas) if self.areas else None

    def inside(self, p: shapely.Point) -> bool:
        if self.area_tree is None:
            return False
        return len(self.area_tree.query(p, predicate="within")) > 0

    def hit(self, p: shapely.Point, nx: float, ny: float) -> shapely.Point | None:
        """The nearest facade along the ray from p (≤ FACADE_MAX_M), or None."""
        if self.tree is None:
            return None
        ray = shapely.LineString([(p.x, p.y), (p.x + nx * FACADE_MAX_M, p.y + ny * FACADE_MAX_M)])
        best, best_d = None, math.inf
        for k in self.tree.query(ray, predicate="intersects"):
            for q in shapely.get_parts(ray.intersection(self.walls[k])):
                q = q if q.geom_type == "Point" else shapely.get_point(q, 0)
                d = p.distance(q)
                if 0.5 < d < best_d:
                    best, best_d = q, d
        return best


def rosette_spans(
    lines: list[tuple[shapely.LineString, dict]],
    mast_points: list[shapely.Point],
    facades: Facades,
) -> list[shapely.LineString]:
    """Facade-to-facade spans every 30 m along the tracks no mast serves."""
    mast_tree = shapely.STRtree(mast_points) if mast_points else None
    spans: list[shapely.LineString] = []
    mids: list[shapely.Point] = []
    for line, props in lines:
        if props["bridge"] or props["layer"] < 0:
            continue
        n = int(line.length // ROSETTE_EVERY_M)
        for i in range(n):
            s = (i + 0.5) * ROSETTE_EVERY_M
            p = line.interpolate(s)
            if mast_tree is not None and len(mast_tree.query(p.buffer(NO_MAST_M))) > 0:
                continue
            if facades.inside(p):
                continue
            a = line.interpolate(max(s - 1.0, 0.0))
            b = line.interpolate(min(s + 1.0, line.length))
            tx, ty = b.x - a.x, b.y - a.y
            t = math.hypot(tx, ty) or 1.0
            nx, ny = -ty / t, tx / t
            left, right = facades.hit(p, nx, ny), facades.hit(p, -nx, -ny)
            if left is None or right is None:
                continue
            mid = shapely.Point((left.x + right.x) / 2, (left.y + right.y) / 2)
            if any(mid.distance(m) < ROSETTE_DEDUP_M for m in mids):
                continue
            mids.append(mid)
            spans.append(shapely.LineString([left, right]))
    return spans


def _crossings(span: shapely.LineString, lines: list[shapely.LineString], tree) -> list[float]:
    """Where a span crosses the tracks, as fractions along it."""
    out = []
    for k in tree.query(span, predicate="intersects"):
        for q in shapely.get_parts(span.intersection(lines[k])):
            if q.geom_type == "Point":
                out.append(round(span.project(q, normalized=True), 3))
    return sorted(set(out))


def _line_json(line: shapely.LineString) -> dict:
    return {
        "type": "LineString",
        "coordinates": [[round(x, 2), round(y, 2)] for x, y, *_ in line.coords],
    }


def _stations(part: shapely.LineString, supports: list[shapely.LineString], tree) -> list[float]:
    s = []
    for k in tree.query(part, predicate="intersects"):
        for q in shapely.get_parts(part.intersection(supports[k])):
            if q.geom_type == "Point":
                s.append(round(part.project(q), 1))
    return sorted(set(s))


def track_features(
    tile: Tile,
    lines: list[tuple[shapely.LineString, dict]],
    supports: list[shapely.LineString],
) -> list[dict]:
    box = shapely.box(*tile.bounds)
    tree = shapely.STRtree(supports) if supports else None
    out = []
    for line, props in lines:
        if props["bed"] is None:
            continue
        for part in shapely.get_parts(line.intersection(box)):
            if part.geom_type != "LineString" or part.length < 1.0:
                continue
            p: dict = {"k": "track", "bed": props["bed"]}
            if props["bridge"]:
                p["bridge"] = 1
            if props["layer"]:
                p["layer"] = props["layer"]
            if tree is not None:
                s = _stations(part, supports, tree)
                if s:
                    p["s"] = s
            out.append(feature(_line_json(part), p))
    return out


def supports(
    tile: Tile,
    lines: list[tuple[shapely.LineString, dict]],
    mast_points: list[shapely.Point],
    facades: Facades,
) -> tuple[list[dict], list[shapely.LineString]]:
    """The support features this tile writes, and every support line around
    it (the contact wire hangs from those whichever tile draws them)."""
    track_lines = [line for line, _ in lines]
    tree = shapely.STRtree(track_lines)
    spans, used = mast_spans(mast_points, tree)
    arms = []
    for i, m in enumerate(mast_points):
        if i not in used:
            arm = mast_arm(m, track_lines, tree)
            if arm is not None:
                arms.append(arm)
    walls = rosette_spans(lines, mast_points, facades)
    out = []
    for m in mast_points:
        if owns(tile.bounds, m.x, m.y):
            out.append(
                feature(
                    {"type": "Point", "coordinates": [round(m.x, 2), round(m.y, 2)]}, {"k": "mast"}
                )
            )
    for kind, group in (("span", spans), ("rosette", walls)):
        for span in group:
            mid = span.interpolate(0.5, normalized=True)
            if owns(tile.bounds, mid.x, mid.y):
                x = _crossings(span, track_lines, tree)
                out.append(feature(_line_json(span), {"k": kind, "x": x}))
    for arm in arms:
        x0, y0 = arm.coords[0]
        if owns(tile.bounds, x0, y0):
            out.append(feature(_line_json(arm), {"k": "arm"}))
    return out, spans + walls + arms


def platforms(tile: Tile) -> list[shapely.Geometry]:
    """The OSM platforms around the tile (points, lines, areas)."""
    out = []
    for layer in ("points", "lines", "multipolygons"):
        cols = ["other_tags"] if layer == "multipolygons" else ["railway", "other_tags"]
        where = PLATFORM_WHERE
        if layer == "lines":
            where = f"railway = 'platform' OR {PLATFORM_WHERE}"
        geoms, _ = read_osm(tile, layer, where, cols)
        out += [g for g in geoms if not g.is_empty]
    return out


def nearest_on(p: shapely.Point, platform: shapely.Geometry) -> shapely.Point:
    """The point of a platform nearest p — on an area's edge, where the
    track runs."""
    if platform.geom_type in ("Polygon", "MultiPolygon"):
        platform = platform.boundary
    return shapely.get_point(shapely.shortest_line(p, platform), 1)


def taken(tile: Tile, margin: float = PLATFORM_M + SIGN_DEDUP_M) -> list[shapely.Point]:
    """Where the committed furniture already stands a shelter or a stop
    sign: the tile's own and, within `margin` of it, its neighbours' (each
    tile's furniture file holds only what it owns, so a shelter across the
    seam is in the neighbour's)."""
    xmin, ymin, xmax, ymax = tile.bounds
    near = (xmin - margin, ymin - margin, xmax + margin, ymax + margin)
    ids = [tile.id] + [tid for tid, b in tile.neighbours() if tid != tile.id and overlaps(b, near)]
    out = []
    for tid in ids:
        path = tile.data / "dlm" / f"furniture_{tid}.geojson"
        if not path.exists():
            continue
        for f in json.loads(path.read_text())["features"]:
            if f["properties"].get("k") not in ("shelter", "stop"):
                continue
            x, y = f["geometry"]["coordinates"][:2]
            if near[0] <= x <= near[2] and near[1] <= y <= near[3]:
                out.append(shapely.Point(x, y))
    return out


def stop_signs(tile: Tile, lines: list[tuple[shapely.LineString, dict]]) -> tuple[list[dict], int]:
    """The "H" signs of the tram stops the tile owns, and how many stops
    had no platform to stand one on."""
    geoms, fields = read_osm(tile, "points", STOP_WHERE, ["name", "other_tags"])
    plats = platforms(tile)
    plat_tree = shapely.STRtree(plats) if plats else None
    track_tree = shapely.STRtree([line for line, _ in lines])
    track_lines = [line for line, _ in lines]
    busy = taken(tile)
    out, bare = [], 0
    names = column(fields, "name", geoms)
    for g, name, other in zip(geoms, names, column(fields, "other_tags", geoms), strict=True):
        if g.geom_type != "Point" or tag(other, "railway") != "tram_stop":
            continue
        hit = plat_tree.query_nearest(g, max_distance=PLATFORM_M) if plat_tree is not None else []
        if len(hit) == 0:
            if owns(tile.bounds, g.x, g.y):
                bare += 1
            continue
        at = nearest_on(g, plats[hit[0]])
        if any(at.distance(p) < SIGN_DEDUP_M for p in busy):
            continue
        # every tile decides the signs around it alike, and writes its own
        busy.append(at)
        if not owns(tile.bounds, at.x, at.y):
            continue
        track = track_tree.query_nearest(at)
        props: dict = {"k": "stop"}
        if len(track):
            q = shapely.get_point(shapely.shortest_line(at, track_lines[track[0]]), 1)
            if at.distance(q) > 0.1:
                props["a"] = round(math.degrees(math.atan2(q.x - at.x, q.y - at.y))) % 360

        if name:
            props["name"] = name
        out.append(
            feature({"type": "Point", "coordinates": [round(at.x, 2), round(at.y, 2)]}, props)
        )
    return out, bare


def run(tile: Tile) -> None:
    if not has_extract(tile, "the trams"):
        return
    xmin, ymin, xmax, ymax = tile.bounds
    area = shapely.box(xmin - MARGIN_M, ymin - MARGIN_M, xmax + MARGIN_M, ymax + MARGIN_M)
    beds = Beds(tile)
    lines = []
    for line, props in tracks(tile, beds):
        for part in shapely.get_parts(line.intersection(area)):
            if part.geom_type == "LineString" and part.length >= 1.0:
                lines.append((part, props))
    if not lines:
        write_geojson(tile.out("dlm", f"tram_{tile.id}.geojson"), [], tile.epsg, OSM_ATTRIBUTION)
        print(f"{tile.id}: no trams")
        return
    mast_points = masts(tile, area, shapely.STRtree([line for line, _ in lines]))
    support_features, support_lines = supports(tile, lines, mast_points, Facades(tile))
    signs, bare = stop_signs(tile, lines)
    features = track_features(tile, lines, support_lines) + support_features + signs
    write_geojson(tile.out("dlm", f"tram_{tile.id}.geojson"), features, tile.epsg, OSM_ATTRIBUTION)
    counts: dict[str, int] = defaultdict(int)
    km: dict[str, float] = defaultdict(float)
    for f in features:
        p = f["properties"]
        counts[p["k"]] += 1
        if p["k"] == "track":
            km[p["bed"]] += shapely.LineString(f["geometry"]["coordinates"]).length / 1000
    beds_km = {k: round(v, 2) for k, v in sorted(km.items())}
    print(
        f"{tile.id}: trams {dict(sorted(counts.items()))}, track km by bed {beds_km}, "
        f"{bare} stops without a platform"
    )
