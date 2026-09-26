"""OSM street furniture → one point layer per tile: benches, picnic tables,
litter bins, bicycle stands, bollards, post boxes, stop shelters and stop
signs, advertising columns, traffic signals, fire hydrants (the pillars,
and the sign plates of the underground ones), clocks and drinking
fountains.

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
`ownsPoint`), so an object on a seam stands once.

What stands in the carriageway on the map moves to the kerb: a traffic
signal mapped on the road (its stop line) stands at the kerb on the right
of the traffic it faces (`traffic_signals:direction` along the way through
the node), a hydrant sign whose hydrant lies in the lane at the nearest
kerb — the kerb read from the class raster. A bus stop without a shelter
gets the "H" sign, unless a shelter stands within 8 m. A clock on a pole
stands where it is mapped; a wall clock hangs on the nearest facade (the
OSM building outline, ≤ 3 m), else it is dropped, as are tower clocks (the
tower is the building model's) and sundials.

Playgrounds come the same way and only as mapped: the `leisure=playground`
outline as a Polygon (`k: playground`), and each piece of equipment OSM
lists (`playground=swing/slide/sandpit/climbingframe/…`) as a Point of its
kind — or, a sandpit drawn as an area, as its Polygon; a piece drawn as a
way stands at its midpoint, turned along it. A playground mapped without
its equipment stays an empty patch: none is invented."""

from __future__ import annotations

import json
import math
import re

import numpy as np
import shapely
from PIL import Image

from .common import OSM_ATTRIBUTION, Tile, feature, geometry_json, owns, write_geojson
from .osm import has_extract, read_osm, tag

BLOCKED = (5, 8)  # railway, water
# A way further than this (m) does not turn an object towards it.
FACE_M = 25.0
# Closer than this (m) an object stands on the way: it faces across it.
ON_WAY_M = 0.5
BENCH_M = (1.0, 8.0)  # a mapped bench way's length, clamped
MAX_HOOPS = 12
BOLLARD_M = (0.3, 3.0)  # a tagged bollard height, clamped
METAL = {"metal", "steel", "iron", "bronze", "cast_iron", "stainless_steel", "aluminium"}
SHELTER_DEDUP_M = 8.0  # a stop's bus_stop and platform nodes share one shelter
ROAD = 7  # the class raster's road (landcover.py CLASSES)
KERB_MAX_M = 15.0  # how far a signal or sign is moved to reach the kerb
KERB_STEP_M = 0.5
KERB_CLEAR_M = 0.6  # past the kerb line onto the pavement
WALL_CLOCK_M = 3.0  # a wall clock's facade is at most this far from its node
CARDINAL = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
            "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]  # fmt: skip
AMENITIES = {
    "bench": "bench",
    "waste_basket": "bin",
    "bicycle_parking": "bike",
    "post_box": "postbox",
}
POINT_WHERE = (
    "barrier = 'bollard' OR highway IN ('bus_stop', 'traffic_signals') "
    'OR other_tags LIKE \'%"amenity"=>"%\' '
    'OR other_tags LIKE \'%"leisure"=>"picnic_table"%\' '
    'OR other_tags LIKE \'%"public_transport"=>"platform"%\' '
    'OR other_tags LIKE \'%"advertising"=>"column"%\' '
    'OR other_tags LIKE \'%"emergency"=>"fire_hydrant"%\''
)
# Kinds without a front: they get no bearing.
ROUND = {"bollard", "bin", "column", "hydrant"}
HYDRANT = {"pillar": "hydrant", "underground": "hydrantsign"}
CLOCK = {"pole": "clock", "wall": "wallclock", "wall_mounted": "wallclock"}
# OSM `playground=*` → the equipment model the viewer stands (others dropped).
EQUIPMENT = {
    "swing": "swing",
    "basketswing": "swing",
    "slide": "slide",
    "sandpit": "sandpit",
    "climbingframe": "climb",
    "structure": "climb",
    "climbingwall": "climb",
    "springy": "springy",
    "spring_board": "springy",
    "seesaw": "seesaw",
    "roundabout": "roundabout",
    "playhouse": "playhouse",
}
EQUIPMENT_WHERE = 'other_tags LIKE \'%"playground"=>"%\''
MIN_PLAYGROUND_M2 = 20.0
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
    if highway == "traffic_signals":
        return "signal"
    if tag(other, "advertising") == "column":
        return "column"
    if tag(other, "emergency") == "fire_hydrant":
        return HYDRANT.get(tag(other, "fire_hydrant:type") or "")
    amenity = tag(other, "amenity")
    if amenity == "shelter":
        return "shelter" if tag(other, "shelter_type") == "public_transport" else None
    if highway == "bus_stop":
        return "shelter" if tag(other, "shelter") == "yes" else "stop"
    if tag(other, "public_transport") == "platform":
        return "shelter" if tag(other, "shelter") == "yes" else None
    if amenity == "bicycle_parking" and tag(other, "bicycle_parking") == "wall_loops":
        return None
    if amenity == "clock":
        if tag(other, "display") == "sundial":
            return None
        return CLOCK.get(tag(other, "support") or "")
    if amenity == "drinking_water":
        return "water"
    return AMENITIES.get(amenity or "")


def hidden(other: str | None) -> bool:
    """Indoors or below ground: nothing the street shows."""
    if tag(other, "indoor") == "yes" or tag(other, "location") in ("indoor", "underground"):
        return True
    level = tag(other, "level") or ""
    return level.startswith("-")


def bollard(other: str | None) -> dict:
    """A bollard's tagged height (m, clamped) and whether it is metal — the
    Stallhof's 1.46 m bronze columns are mapped as bollards."""
    props: dict = {}
    try:
        h = float((tag(other, "height") or "").split()[0])
        props["h"] = round(min(max(h, BOLLARD_M[0]), BOLLARD_M[1]), 2)
    except (ValueError, IndexError):
        pass
    if (tag(other, "material") or "") in METAL:
        props["metal"] = True
    return props


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

    def cls_at(self, x: float, y: float) -> int | None:
        """The class under a point, None off the tile's raster."""
        xmin, ymin, xmax, ymax = self.bounds
        if not (xmin <= x < xmax and ymin <= y < ymax):
            return None
        ch, cw = self.cls.shape
        c = min(int((x - xmin) / (xmax - xmin) * cw), cw - 1)
        r = min(int((ymax - y) / (ymax - ymin) * ch), ch - 1)
        return int(self.cls[r, c])

    def on_road(self, p: shapely.Point) -> bool:
        return self.cls_at(p.x, p.y) == ROAD

    def kerb_along(self, p: shapely.Point, deg: float) -> shapely.Point | None:
        """Walking from p towards the bearing, just past where the road ends."""
        dx, dy = math.sin(math.radians(deg)), math.cos(math.radians(deg))
        d = 0.0
        while d <= KERB_MAX_M:
            if self.cls_at(p.x + dx * d, p.y + dy * d) != ROAD:
                d += KERB_CLEAR_M
                return shapely.Point(p.x + dx * d, p.y + dy * d)
            d += KERB_STEP_M
        return None

    def nearest_kerb(self, p: shapely.Point) -> shapely.Point | None:
        """The nearest point off the road (16 directions), or None."""
        best = None
        for i in range(16):
            q = self.kerb_along(p, i * 22.5)
            if q is not None and (best is None or p.distance(q) < p.distance(best)):
                best = q
        return best

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


def way_bearing(p: shapely.Point, ways, lines) -> float | None:
    """The digitised direction of the way the point lies on (≤ 0.5 m)."""
    hit = ways.query_nearest(p, max_distance=ON_WAY_M)
    if len(hit) == 0:
        return None
    line = lines[hit[0]]
    s = line.project(p)
    a = line.interpolate(max(s - 1.0, 0.0))
    b = line.interpolate(min(s + 1.0, line.length))
    return bearing(b.x - a.x, b.y - a.y)


def signal_place(
    p: shapely.Point, other: str | None, gate: Gate, ways, lines
) -> tuple[shapely.Point, float | None] | None:
    """Where a traffic signal stands and which way its head looks. Mapped on
    the carriageway (at its stop line), it moves to the kerb on the right of
    the traffic it controls and faces that traffic; a signal off the road
    stands where it is, facing the nearest way."""
    along = way_bearing(p, ways, lines)
    towards = tag(other, "traffic_signals:direction")
    if along is not None and towards in ("forward", "backward") and gate.on_road(p):
        travel = along if towards == "forward" else (along + 180.0) % 360
        kerb = gate.kerb_along(p, (travel + 90.0) % 360)
        if kerb is not None:
            return kerb, (travel + 180.0) % 360
    if gate.on_road(p):
        kerb = gate.nearest_kerb(p)
        if kerb is None:
            return None
        p = kerb
    return p, facing(p, ways, lines)


class Facades:
    """The OSM building outlines a wall clock hangs on."""

    def __init__(self, tile: Tile) -> None:
        geoms, _ = read_osm(tile, "multipolygons", "building IS NOT NULL", ["building"])
        self.walls = [g.boundary for g in geoms if g.geom_type in ("Polygon", "MultiPolygon")]
        self.tree = shapely.STRtree(self.walls) if self.walls else None

    def hang(self, p: shapely.Point) -> tuple[shapely.Point, float] | None:
        """The facade point nearest p (≤ WALL_CLOCK_M) and the bearing out
        of the wall there."""
        if self.tree is None:
            return None
        hit = self.tree.query_nearest(p, max_distance=WALL_CLOCK_M)
        if len(hit) == 0:
            return None
        wall = self.walls[hit[0]]
        q = shapely.get_point(shapely.shortest_line(p, wall), 1)
        s = wall.project(q) if wall.geom_type == "LineString" else None
        if p.distance(q) > 0.05:
            out = bearing(p.x - q.x, p.y - q.y)
        elif s is not None:
            a, b = wall.interpolate(max(s - 0.5, 0)), wall.interpolate(min(s + 0.5, wall.length))
            out = (bearing(b.x - a.x, b.y - a.y) - 90.0) % 360
        else:
            return None
        return q, out


def _placed(
    k: str, g: shapely.Point, other: str | None, gate: Gate, ways, lines, facades
) -> tuple[shapely.Point, float | None] | None:
    """Where a point object stands and the bearing it faces (None: round)."""
    if k == "signal":
        return signal_place(g, other, gate, ways, lines)
    if k == "wallclock":
        return facades.hang(g) if facades is not None else None
    if k == "hydrantsign" and gate.on_road(g):
        kerb = gate.nearest_kerb(g)
        return (kerb, facing(kerb, ways, lines)) if kerb is not None else None
    if k in ROUND:
        return g, None
    a = direction(tag(other, "direction")) if k == "bench" else None
    return g, a if a is not None else facing(g, ways, lines)


def _props(k: str, other: str | None) -> dict:
    props: dict = {"k": k}
    if k == "bench" and tag(other, "backrest") == "no":
        props["back"] = False
    if k == "bike":
        props["n"] = hoops(tag(other, "capacity"))
    if k == "bollard":
        props.update(bollard(other))
    if k == "column" and tag(other, "lit") == "yes":
        props["lit"] = True
    return props


def _points(tile: Tile, gate: Gate, ways, lines) -> list[dict]:
    geoms, fields = read_osm(
        tile, "points", POINT_WHERE, ["barrier", "highway", "other_tags"], margin=0.0005
    )
    kinds = [
        kind_of(barrier, highway, other)
        for barrier, highway, other in zip(
            fields["barrier"], fields["highway"], fields["other_tags"], strict=True
        )
    ]
    facades = Facades(tile) if "wallclock" in kinds else None
    out, shelters, stops = [], [], []
    for g, k, other in zip(geoms, kinds, fields["other_tags"], strict=True):
        if k is None or hidden(other) or not gate.open(g):
            continue
        placed = _placed(k, g, other, gate, ways, lines, facades)
        if placed is None or not gate.open(placed[0]):
            continue
        at, a = placed
        if k == "shelter":
            if any(at.distance(s) < SHELTER_DEDUP_M for s in shelters):
                continue
            shelters.append(at)
        props = _props(k, other)
        if a is not None:
            props["a"] = round(a)
        feature_ = _point_feature(at, props)
        (stops if k == "stop" else out).append(feature_)
    # A stop sign only where no shelter stands (the shelter carries the sign).
    for f in stops:
        at = shapely.Point(f["geometry"]["coordinates"])
        if not any(at.distance(s) < SHELTER_DEDUP_M for s in shelters):
            out.append(f)
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


def equipment_kind(other: str | None) -> str | None:
    """OSM `playground=*` → the equipment kind, or None."""
    return EQUIPMENT.get(tag(other, "playground") or "")


def _outline(geom: shapely.Geometry) -> shapely.Polygon | None:
    """An area's largest part, holes dropped and simplified to 0.2 m."""
    if geom.geom_type == "MultiPolygon":
        geom = max(geom.geoms, key=lambda g: g.area)
    if geom.geom_type == "LineString" and geom.is_ring:
        geom = shapely.Polygon(geom.coords)
    if geom.geom_type != "Polygon":
        return None
    return shapely.Polygon(geom.exterior).simplify(0.2)


def _playgrounds(tile: Tile, gate: Gate) -> list[dict]:
    geoms, fields = read_osm(
        tile, "multipolygons", "leisure = 'playground'", ["leisure", "other_tags"], margin=0.0005
    )
    out = []
    for g, other in zip(geoms, fields["other_tags"], strict=True):
        area = _outline(g)
        if area is None or area.area < MIN_PLAYGROUND_M2 or hidden(other):
            continue
        if not gate.open(area.representative_point()):
            continue
        out.append(feature(geometry_json(area), {"k": "playground"}))
    return out


def _equipment_piece(g: shapely.Geometry, kind: str) -> tuple[shapely.Geometry, dict] | None:
    """Where a piece stands and how: a sandpit area as its outline, a way at
    its midpoint turned along it, anything else at its (representative) point."""
    closed = g.geom_type in ("Polygon", "MultiPolygon") or (
        g.geom_type == "LineString" and g.is_ring
    )
    if kind == "sandpit" and closed:
        area = _outline(g)
        return (area, {"k": kind}) if area is not None and area.area >= 1.0 else None
    if g.geom_type == "LineString" and not g.is_ring:
        a = g.interpolate(0.45, normalized=True)
        b = g.interpolate(0.55, normalized=True)
        mid = g.interpolate(0.5, normalized=True)
        return mid, {"k": kind, "a": round(bearing(b.x - a.x, b.y - a.y))}
    return (g if g.geom_type == "Point" else g.representative_point()), {"k": kind}


def _equipment(tile: Tile, gate: Gate) -> list[dict]:
    out = []
    for layer in ("points", "lines", "multipolygons"):
        geoms, fields = read_osm(tile, layer, EQUIPMENT_WHERE, ["other_tags"], margin=0.0005)
        for g, other in zip(geoms, fields["other_tags"], strict=True):
            kind = equipment_kind(other)
            if kind is None or hidden(other):
                continue
            piece = _equipment_piece(g, kind)
            if piece is None:
                continue
            geom, props = piece
            anchor = geom if geom.geom_type == "Point" else geom.representative_point()
            if not gate.open(anchor):
                continue
            a = direction(tag(other, "direction"))
            if a is not None:
                props["a"] = round(a)
            if geom.geom_type == "Point":
                out.append(_point_feature(geom, props))
            else:
                out.append(feature(geometry_json(geom), props))
    return out


def run(tile: Tile) -> None:
    if not has_extract(tile, "the street furniture"):
        return
    lines, _ = read_osm(tile, "lines", "highway IS NOT NULL", ["highway"], margin=0.001)
    lines = np.array([g for g in lines if g.geom_type == "LineString"], dtype=object)
    ways = shapely.STRtree(lines)
    gate = Gate(tile)
    features = (
        _points(tile, gate, ways, lines)
        + _bench_ways(tile, gate, ways, lines)
        + _playgrounds(tile, gate)
        + _equipment(tile, gate)
    )
    write_geojson(
        tile.out("dlm", f"furniture_{tile.id}.geojson"), features, tile.epsg, OSM_ATTRIBUTION
    )
    counts: dict[str, int] = {}
    for f in features:
        counts[f["properties"]["k"]] = counts.get(f["properties"]["k"], 0) + 1
    print(f"{tile.id}: street furniture and playgrounds {dict(sorted(counts.items()))}")
