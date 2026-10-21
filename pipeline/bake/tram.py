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
  45 m from any mapped mast a support every 30–40 m (where the track
  crosses a 30 m grid line along its run's main axis, so both tiles of a
  seam pick the same places): a span between the facades either side (the
  OSM building outlines, ≤ 15 m out — the narrow streets, where Dresden
  hangs the wire from wall rosettes); where a side has no facade, a side
  pole at the street's edge (`pole`: the first change of the class raster
  beyond the outermost track — past the kerb on a road, inside the edge of
  a lawn or paved bed — or 3 m beside the track where nothing changes in
  14 m: an open square, or a road so wide the tram has its own bed in it;
  a mapped street lamp within 3 m of that spot is taken as the pole, as
  the combined lamp and catenary masts stand), the span from pole to pole
  or facade, at most 40 m. Only where a double
  track's central strip is wider than 1.5 m (its spacing less the widest
  car, 2.65 m) does a centre pole stand between the tracks, an arm over
  each. Mapped masts are rare (Leipzig maps one, Munich none), and without
  these 62–83 % of the track had no support within 25 m. Each track
  carries `s`, the distances (m, along the drawn line) where a span or arm
  holds its contact wire, so the runtime sags the wire between them.

- **Stops** (phase 3): a `railway=tram_stop` node sits on the track (the
  stop position), so its "H" sign stands on the nearest OSM platform
  (`public_transport=platform` or `railway=platform`, ≤ 25 m) at the point
  nearest the stop, facing the track — never on a platform below the
  street (a tunnel, `location=underground`, a negative `layer` or `level`:
  Munich's U-Bahn platforms under its tram stops) or one that names its
  modes without the tram (`subway`, `train` or `bus` = yes alone: a
  station's platform beside the stop) — and not where a shelter or a bus stop's
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
import re
from collections import defaultdict
from dataclasses import dataclass, field

import numpy as np
import shapely
from PIL import Image

from .common import (
    OSM_ATTRIBUTION,
    Tile,
    column,
    feature,
    label_line,
    overlaps,
    owns,
    value_at,
    write_geojson,
)
from .osm import below_ground, has_extract, in_tunnel, read_osm, tag
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
ROSETTE_EVERY_M = 30.0  # the grid the supports stand on where no mast serves
FACADE_MAX_M = 15.0
ROSETTE_DEDUP_M = 12.0
# A support needs no second one this near along the street (a double
# track's other line crosses the same grid line a few metres on).
SUPPORT_DEDUP_M = ROSETTE_EVERY_M / 2
PAIR_M = 10.0  # a parallel track this near across shares the street's supports
CAR_CLEAR_M = 1.7  # half the widest car (1.33 m) and a margin: no pole nearer a track
CAR_ENVELOPE_M = 2.65  # the widest car (Dresden's NGT DXDD)
CENTRE_STRIP_M = 1.5  # a central strip wider than this takes a centre pole
EDGE_STEP_M = 0.5
EDGE_REACH_M = 14.0  # the street's edge is looked for this far past the outer track
POLE_PAST_EDGE_M = 0.5  # a side pole stands this far past the kerb (inside a bed's edge)
POLE_OPEN_M = 3.0  # on an open square: this far beside the outer track
POLE_SPAN_MAX_M = 40.0
LAMP_REUSE_M = 3.0  # a street lamp this near the pole's spot is the pole
STREET = (ROAD, 5)  # road and railway: a track in the street runs on to the kerb
MAST_WHERE = 'other_tags LIKE \'%"power"=>"catenary_mast"%\''
STOP_WHERE = 'other_tags LIKE \'%"railway"=>"tram_stop"%\''
PLATFORM_WHERE = (
    'other_tags LIKE \'%"public_transport"=>"platform"%\' '
    'OR other_tags LIKE \'%"railway"=>"platform"%\''
)
PLATFORM_M = 25.0  # a stop's sign stands on a platform at most this far away
TRAM_MODES = ("tram", "light_rail")  # a platform tagged so is the tram's
# a platform tagged with only these is another mode's
OTHER_MODES = ("bus", "train", "subway", "trolleybus", "monorail", "ferry")
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
        return label_line(
            line,
            self.sample_bed,
            step=SAMPLE_M,
            window=BED_WINDOW_M,
            min_run=BED_MIN_M,
            order=BED_ORDER,
        )


def bridge_of(other: str | None) -> int:
    return 1 if (tag(other, "bridge") or "no") not in ("no", "") else 0


def layer_of(other: str | None) -> int:
    try:
        return int(tag(other, "layer") or 0)
    except ValueError:
        return 0


def gauge_of(other: str | None) -> float | None:
    """The track gauge OSM maps (`gauge` in mm: Dresden 1450, Leipzig 1458,
    Munich 1435), in metres; None when untagged or implausible."""
    m = re.match(r"\d+", (tag(other, "gauge") or "").strip())
    if not m or not 600 <= int(m.group()) <= 1700:
        return None
    return int(m.group()) / 1000


def tracks(tile: Tile, beds: Beds) -> list[tuple[shapely.LineString, dict]]:
    """Merged track lines (unclipped) with their properties."""
    geoms, fields = read_osm(tile, "lines", "railway = 'tram'", ["railway", "other_tags"])
    groups: dict[tuple, list] = defaultdict(list)
    fallback: dict[tuple, list] = defaultdict(list)
    for g, other in zip(geoms, column(fields, "other_tags", geoms), strict=True):
        if in_tunnel(other):
            continue  # a tram tunnel is not drawn at street level
        for part in shapely.get_parts(g):
            if part.geom_type != "LineString" or part.length < 0.5:
                continue
            key = (bridge_of(other), layer_of(other), gauge_of(other))
            for piece, bed in beds.beds(part):
                coords = [(x, y) for x, y, *_ in piece.coords]
                if bed is None:
                    fallback[key].append(coords)  # margin only: its bed never shows
                else:
                    groups[(bed, *key)].append(coords)
    out = []
    for (bed, bridge, layer, gauge), lines in groups.items():
        for chain in merge_lines(lines):
            props = {"bed": bed, "bridge": bridge, "layer": layer, "gauge": gauge}
            out.append((shapely.LineString(chain), props))
    for (bridge, layer, gauge), lines in fallback.items():
        for chain in merge_lines(lines):
            props = {"bed": None, "bridge": bridge, "layer": layer, "gauge": gauge}
            out.append((shapely.LineString(chain), props))
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

    def hit(
        self, p: shapely.Point, nx: float, ny: float, reach: float = FACADE_MAX_M
    ) -> shapely.Point | None:
        """The nearest facade along the ray from p (≤ `reach`), or None."""
        if self.tree is None:
            return None
        ray = shapely.LineString([(p.x, p.y), (p.x + nx * reach, p.y + ny * reach)])
        best, best_d = None, math.inf
        for k in self.tree.query(ray, predicate="intersects"):
            for q in shapely.get_parts(ray.intersection(self.walls[k])):
                q = q if q.geom_type == "Point" else shapely.get_point(q, 0)
                d = p.distance(q)
                if 0.5 < d < best_d:
                    best, best_d = q, d
        return best


class Ground:
    """The site's class rasters around the tile, its own and its
    neighbours' (each read when first asked), and the street lamps on
    posts there: what a side pole's place is read from."""

    def __init__(self, tile: Tile, margin: float = MARGIN_M + EDGE_REACH_M + PAIR_M) -> None:
        xmin, ymin, xmax, ymax = tile.bounds
        near = (xmin - margin, ymin - margin, xmax + margin, ymax + margin)
        self.tile = tile
        self.tiles = [(tid, b) for tid, b in tile.neighbours() if overlaps(b, near)]
        if not any(tid == tile.id for tid, _ in self.tiles):
            self.tiles.append((tile.id, tile.bounds))
        self.rasters: dict[str, np.ndarray | None] = {}
        lamps = []
        for tid, _ in self.tiles:
            path = tile.data / "dlm" / f"lamps_{tid}.geojson"
            if not path.exists():
                continue
            for f in json.loads(path.read_text())["features"]:
                props, geom = f.get("properties") or {}, f.get("geometry") or {}
                if geom.get("type") != "Point" or "wire" in props or "wall" in props:
                    continue  # hung on a wire or a facade: no post to share
                x, y = geom["coordinates"][:2]
                if near[0] <= x <= near[2] and near[1] <= y <= near[3]:
                    lamps.append(shapely.Point(x, y))
        self.lamps = lamps
        self.lamp_tree = shapely.STRtree(lamps) if lamps else None

    def cls(self, x: float, y: float) -> int | None:
        """The class under a point, None off every baked tile."""
        for tid, b in self.tiles:
            if owns(b, x, y):
                if tid not in self.rasters:
                    self.rasters[tid] = self.tile.classes(tid)
                raster = self.rasters[tid]
                return None if raster is None else value_at(raster, b, x, y)
        return None

    def lamp_near(self, p: shapely.Point) -> shapely.Point | None:
        if self.lamp_tree is None:
            return None
        hit = self.lamp_tree.query_nearest(p, max_distance=LAMP_REUSE_M)
        return self.lamps[int(hit[0])] if len(hit) else None


def grid_stations(line: shapely.LineString, every: float = ROSETTE_EVERY_M) -> list[float]:
    """Where a line crosses a grid line every `every` m across its main
    axis (x for a segment running east–west, y north–south), as distances
    along it: 1–1.4 × `every` apart, and the same places whichever tile
    clipped the line, so both tiles of a seam pick the same supports. A
    station nearer than half `every` to the last (where the main axis
    turns) is dropped."""
    coords = [(x, y) for x, y, *_ in line.coords]
    out: list[float] = []
    d0 = 0.0
    for (ax, ay), (bx, by) in zip(coords[:-1], coords[1:], strict=True):
        seg = math.hypot(bx - ax, by - ay)
        if seg == 0:
            continue
        a, b = (ax, bx) if abs(bx - ax) >= abs(by - ay) else (ay, by)
        lo, hi = min(a, b), max(a, b)
        found = []
        for k in range(math.ceil(lo / every), math.floor(hi / every) + 1):
            t = (k * every - a) / (b - a)
            if 0 <= t < 1:  # half-open: a vertex's crossing counts once
                found.append(d0 + t * seg)
        for d in sorted(found):
            if not out or d - out[-1] >= every / 2:
                out.append(d)
        d0 += seg
    return out


@dataclass
class StreetSupports:
    """The supports where no mast serves: facade-to-facade spans
    (`rosettes`), spans with a side pole at either end or both (`spans`),
    the side and centre poles themselves and a centre pole's arms."""

    rosettes: list[shapely.LineString] = field(default_factory=list)
    spans: list[shapely.LineString] = field(default_factory=list)
    arms: list[shapely.LineString] = field(default_factory=list)
    poles: list[shapely.Point] = field(default_factory=list)

    def lines(self) -> list[shapely.LineString]:
        return self.rosettes + self.spans + self.arms


def _offsets(
    p: shapely.Point, nx: float, ny: float, track_lines: list[shapely.LineString], tree
) -> list[float]:
    """The tracks a street's cross-section through p meets within PAIR_M
    either side, as signed distances along (nx, ny) (0: p's own)."""
    cut = shapely.LineString(
        [(p.x - nx * PAIR_M, p.y - ny * PAIR_M), (p.x + nx * PAIR_M, p.y + ny * PAIR_M)]
    )
    out = {0.0}
    for k in tree.query(cut, predicate="intersects"):
        for q in shapely.get_parts(cut.intersection(track_lines[k])):
            if q.geom_type == "Point":
                d = round((q.x - p.x) * nx + (q.y - p.y) * ny, 2)
                if abs(d) > 0.5:
                    out.add(d)
    return sorted(out)


def _edge(ground: Ground, p: shapely.Point, nx: float, ny: float, outer: float) -> float | None:
    """How far along (nx, ny) from p a side pole stands beyond the outer
    track at `outer`: past the kerb where a street's road or railway class
    ends, inside the edge of a lawn or paved bed, and POLE_OPEN_M beside the
    track where nothing changes within EDGE_REACH_M — a square, a lawn, or
    a road so wide that the tram has its own bed in it, at whose edge the
    poles stand (Dresden's Hamburger Straße); None off the data."""
    base = ground.cls(p.x + nx * outer, p.y + ny * outer)
    if base is None:
        return None
    start = outer + CAR_CLEAR_M
    s = start
    while s <= outer + EDGE_REACH_M:
        c = ground.cls(p.x + nx * s, p.y + ny * s)
        if c is None:
            return None
        if c != base and not (base in STREET and c in STREET):
            if base in STREET:
                return s + POLE_PAST_EDGE_M
            return max(s - POLE_PAST_EDGE_M, start)
        s += EDGE_STEP_M
    return outer + POLE_OPEN_M


def _arm_to(pole: shapely.Point, line: shapely.LineString) -> shapely.LineString | None:
    """An arm from a pole over a track, ARM_OVERSHOOT_M past its axis."""
    end = shapely.get_point(shapely.shortest_line(pole, line), 1)
    dx, dy = end.x - pole.x, end.y - pole.y
    length = math.hypot(dx, dy)
    if length < 0.5:
        return None
    k = (length + ARM_OVERSHOOT_M) / length
    return shapely.LineString([(pole.x, pole.y), (pole.x + dx * k, pole.y + dy * k)])


class _Street:
    """One tile's street supports, decided station by station."""

    def __init__(self, lines, mast_points, facades: Facades, ground: Ground | None) -> None:
        self.track_lines = [line for line, _ in lines]
        self.tree = shapely.STRtree(self.track_lines)
        self.mast_tree = shapely.STRtree(mast_points) if mast_points else None
        self.facades = facades
        self.ground = ground
        self.out = StreetSupports()
        self.held: list[shapely.LineString] = []  # every support decided so far

    def served(self, p: shapely.Point) -> bool:
        if self.mast_tree is not None and len(self.mast_tree.query(p.buffer(NO_MAST_M))) > 0:
            return True
        return any(p.distance(h) < SUPPORT_DEDUP_M for h in self.held)

    def clear(self, q: shapely.Point) -> bool:
        """Whether a pole may stand at q: off the tracks, out of the houses."""
        if self.facades.inside(q):
            return False
        return len(self.tree.query(q, predicate="dwithin", distance=CAR_CLEAR_M)) == 0

    def pole_at(self, p, nx, ny, outer) -> shapely.Point | None:
        """The side pole on one side of the street (None where none fits)."""
        if self.ground is None:
            return None
        at = _edge(self.ground, p, nx, ny, outer)
        if at is None or self.facades.hit(p, nx, ny, reach=at) is not None:
            return None
        q = shapely.Point(p.x + nx * at, p.y + ny * at)
        lamp = self.ground.lamp_near(q)
        if lamp is not None and (lamp.x - p.x) * nx + (lamp.y - p.y) * ny > outer + CAR_CLEAR_M:
            q = lamp
        return q if self.clear(q) else None

    def centre(self, p, nx, ny, offsets) -> bool:
        """A centre pole between a double track whose central strip is wide
        enough, an arm over each; whether one stood."""
        if len(offsets) != 2 or offsets[1] - offsets[0] - CAR_ENVELOPE_M <= CENTRE_STRIP_M:
            return False
        mid = (offsets[0] + offsets[1]) / 2
        q = shapely.Point(p.x + nx * mid, p.y + ny * mid)
        if not self.clear(q):
            return False
        arms = []
        for k in self.tree.query(q.buffer(PAIR_M), predicate="intersects"):
            if self.track_lines[k].distance(q) <= (offsets[1] - offsets[0]) / 2 + 0.5:
                arm = _arm_to(q, self.track_lines[k])
                if arm is not None:
                    arms.append(arm)
        if not arms:
            return False
        self.out.poles.append(q)
        self.out.arms += arms
        self.held += arms
        return True

    def station(self, p: shapely.Point, nx: float, ny: float) -> None:
        offsets = _offsets(p, nx, ny, self.track_lines, self.tree)
        if self.ground is not None and self.centre(p, nx, ny, offsets):
            return
        anchors, poles = [], []
        for sign, outer in ((1, offsets[-1]), (-1, -offsets[0])):
            wall = self.facades.hit(p, nx * sign, ny * sign)
            if wall is not None:
                anchors.append(wall)
                continue
            pole = self.pole_at(p, nx * sign, ny * sign, outer)
            if pole is None:
                return
            anchors.append(pole)
            poles.append(pole)
        span = shapely.LineString(anchors)
        if poles and span.length > POLE_SPAN_MAX_M:
            return
        (self.out.spans if poles else self.out.rosettes).append(span)
        self.out.poles += poles
        self.held.append(span)


def street_supports(
    lines: list[tuple[shapely.LineString, dict]],
    mast_points: list[shapely.Point],
    facades: Facades,
    ground: Ground | None = None,
) -> StreetSupports:
    """The supports of the tracks no mast serves, one every grid station
    (`grid_stations`): facade to facade, else with side poles (or a centre
    pole) — the poles only when `ground` is given."""
    street = _Street(lines, mast_points, facades, ground)
    order = sorted(range(len(lines)), key=lambda i: lines[i][0].bounds)
    for i in order:
        line, props = lines[i]
        if props["bridge"] or props["layer"] < 0:
            continue
        for s in grid_stations(line):
            p = line.interpolate(s)
            if street.served(p) or facades.inside(p):
                continue
            a = line.interpolate(max(s - 1.0, 0.0))
            b = line.interpolate(min(s + 1.0, line.length))
            tx, ty = b.x - a.x, b.y - a.y
            t = math.hypot(tx, ty) or 1.0
            street.station(p, -ty / t, tx / t)
    return street.out


def rosette_spans(
    lines: list[tuple[shapely.LineString, dict]],
    mast_points: list[shapely.Point],
    facades: Facades,
) -> list[shapely.LineString]:
    """Facade-to-facade spans along the tracks no mast serves (the street
    supports without side poles)."""
    return street_supports(lines, mast_points, facades).rosettes


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
            if props.get("gauge"):
                p["g"] = props["gauge"]
            if tree is not None:
                s = _stations(part, supports, tree)
                if s:
                    p["s"] = s
            out.append(feature(_line_json(part), p))
    return out


def _point_json(p: shapely.Point) -> dict:
    return {"type": "Point", "coordinates": [round(p.x, 2), round(p.y, 2)]}


def supports(
    tile: Tile,
    lines: list[tuple[shapely.LineString, dict]],
    mast_points: list[shapely.Point],
    facades: Facades,
    ground: Ground | None = None,
) -> tuple[list[dict], list[shapely.LineString]]:
    """The support features this tile writes, and every support line around
    it (the contact wire hangs from those whichever tile draws them). The
    side and centre poles only with `ground` (`street_supports`)."""
    track_lines = [line for line, _ in lines]
    tree = shapely.STRtree(track_lines)
    spans, used = mast_spans(mast_points, tree)
    arms = []
    for i, m in enumerate(mast_points):
        if i not in used:
            arm = mast_arm(m, track_lines, tree)
            if arm is not None:
                arms.append(arm)
    street = street_supports(lines, mast_points, facades, ground)
    out = []
    for m in mast_points:
        if owns(tile.bounds, m.x, m.y):
            out.append(feature(_point_json(m), {"k": "mast"}))
    for pole in street.poles:
        if owns(tile.bounds, pole.x, pole.y):
            props: dict = {"k": "pole"}
            if ground is not None and any(pole.equals(q) for q in ground.lamps):
                props["lamp"] = 1
            out.append(feature(_point_json(pole), props))
    for kind, group in (("span", spans + street.spans), ("rosette", street.rosettes)):
        for span in group:
            mid = span.interpolate(0.5, normalized=True)
            if owns(tile.bounds, mid.x, mid.y):
                x = _crossings(span, track_lines, tree)
                out.append(feature(_line_json(span), {"k": kind, "x": x}))
    for arm in arms + street.arms:
        x0, y0 = arm.coords[0]
        if owns(tile.bounds, x0, y0):
            out.append(feature(_line_json(arm), {"k": "arm"}))
    return out, spans + arms + street.lines()


def tram_platform(other: str | None) -> bool:
    """Whether a platform can carry a tram stop's sign: not below the street
    (`osm.below_ground`: a tunnel, `location=underground`, a negative
    `layer` or `level` — Munich's U-Bahn platforms under Max-Weber-Platz),
    and not one that names its modes without the tram (`subway`, `train` or
    `bus` = yes alone: a station's or a bus stop's platform beside the tram
    stop). A platform that names no mode may be the tram's."""
    if below_ground(other):
        return False
    if any(tag(other, mode) == "yes" for mode in TRAM_MODES):
        return True
    return not any(tag(other, mode) == "yes" for mode in OTHER_MODES)


def platforms(tile: Tile) -> list[shapely.Geometry]:
    """The OSM platforms around the tile (points, lines, areas) a tram stop's
    sign may stand on (`tram_platform`)."""
    out = []
    for layer in ("points", "lines", "multipolygons"):
        cols = ["other_tags"] if layer == "multipolygons" else ["railway", "other_tags"]
        where = PLATFORM_WHERE
        if layer == "lines":
            where = f"railway = 'platform' OR {PLATFORM_WHERE}"
        geoms, fields = read_osm(tile, layer, where, cols)
        for g, other in zip(geoms, column(fields, "other_tags", geoms), strict=True):
            if not g.is_empty and tram_platform(other):
                out.append(g)
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
        if below_ground(other):
            continue  # a stop in a tunnel has no sign in the street above
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
    ground = Ground(tile)
    support_features, support_lines = supports(tile, lines, mast_points, Facades(tile), ground)
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
