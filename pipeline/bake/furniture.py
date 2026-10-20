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
raster) or under a bridge deck (the terrain there is the river or the road
the bridge spans). Each tile writes only what it owns (west/south edges in,
lib/city/tileset.ts `ownsPoint`), so an object on a seam stands once.

A point object on a bridge stands on its deck (`deck`: the deck's top there,
m, which the viewer stands it on), by the lamps' rule (`Decks`): a drawn
road or path deck holds it and its nearest highway within ON_BRIDGE_M is a
bridge, or the ground below is water or railway. It stands where it is
mapped, but for what would stand in the lanes there (`OFF_DECK`). Before,
all of them were dropped.

What stands in the carriageway on the map moves to the kerb: a traffic
signal mapped on the road (its stop line) stands at the kerb on the right
of the traffic it faces (`traffic_signals:direction` along the way through
the node), a hydrant sign whose hydrant lies in the lane at the nearest
kerb — the kerb read from the class raster. So does a bench, bicycle
stand, bin, post box, column, stop or shelter mapped in a street's lanes
(the nearest way has a carriageway, `STREETS`); in a square, a pedestrian
zone or on a platform, which the class raster's road covers too, it stays
where it is mapped. A bus stop without a shelter
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
import shapely.geometry

from .bridge import STEP, Axis
from .common import (
    OSM_ATTRIBUTION,
    Tile,
    column,
    feature,
    geometry_json,
    owns,
    value_at,
    write_geojson,
)
from .osm import has_extract, read_osm, read_ways, tag

BLOCKED = (5, 8)  # railway, water
DECK_KINDS = ("road", "path")  # what stands on a bridge stands on these, never a rail deck
ON_BRIDGE_M = 15.0  # a piece's way: the nearest highway within this
LANES_M = 2.0  # on a deck, a lamp or kerbside piece this near a street's line is in its lanes
DECK_EDGE_IN_M = 0.4  # ... and stands at the deck's edge, this far in from it
SIDE_REACH_M = 60.0  # ... its side looked for at most this far across the axis (m)
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
# The ways with a carriageway (not footways, paths, platforms or tracks).
STREETS = (
    "motorway", "trunk", "primary", "secondary", "tertiary", "unclassified",
    "residential", "living_street", "service", "road",
    "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
)  # fmt: skip
# What stands beside a street, never in its lanes: mapped in the carriageway
# of the nearest way, it moves to the kerb (the class raster's road also
# covers squares, platforms and pedestrian zones, where things stand on it).
KERBSIDE = {"bench", "bike", "bin", "column", "picnic", "postbox", "shelter", "stop", "water"}
# Kinds without a front: they get no bearing.
ROUND = {"bollard", "bin", "column", "hydrant"}
# Never on a bridge deck: a signal (mapped at its stop line) and a hydrant's
# sign (on its lid) stand in the carriageway where OSM has them, and the
# kerb they move to is the class raster's, on a bridge the ground's below;
# a wall clock hangs on a facade, which no deck has.
OFF_DECK = {"signal", "hydrantsign", "wallclock"}
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


class Decks:
    """The drawn road and path decks of every tile (a deck is drawn by the
    tile that owns its centre, so one over a seam may be a neighbour's), and
    the bridge ways, so a lamp or a bench on a bridge stands on its deck."""

    def __init__(
        self,
        decks: list[tuple[shapely.Geometry, Axis, list[float]]],
        ways: list[tuple[shapely.Geometry, bool]],
        streets: list[shapely.Geometry] | None = None,
    ) -> None:
        self.decks = decks
        self.tree = shapely.STRtree([d for d, _, _ in decks]) if decks else None
        self.ways = shapely.STRtree([g for g, _ in ways]) if ways else None
        self.bridge = np.array([b for _, b in ways], dtype=bool)
        self.streets = shapely.STRtree(streets) if streets else None

    @classmethod
    def of(cls, tile: Tile) -> Decks:
        decks = []
        for tid, _ in tile.neighbours():
            path = tile.data / "dlm" / f"bridge_{tid}.geojson"
            if not path.exists():
                continue
            for f in json.loads(path.read_text())["features"]:
                p = f.get("properties") or {}
                if p.get("kind") in DECK_KINDS and p.get("axis") and len(p.get("line") or []) >= 2:
                    deck = shapely.geometry.shape(f["geometry"])
                    decks.append((deck, Axis(p["axis"]), p["line"]))
        geoms, fields = read_ways(tile, "highway IS NOT NULL", ["highway", "other_tags"])
        kinds, tags = column(fields, "highway", geoms), column(fields, "other_tags", geoms)
        ways = [
            (g, (tag(t, "bridge") or "no") != "no")
            for g, t in zip(geoms, tags, strict=True)
            if g is not None
        ]
        streets = [g for g, k in zip(geoms, kinds, strict=True) if g is not None and k in STREETS]
        return cls(decks, ways, streets)

    def top(self, p: shapely.Point) -> float | None:
        """The deck's top at p (m, the viewer's `deckAt` over the deck's
        `line`), or None off every road and path deck."""
        if self.tree is None:
            return None
        for i in self.tree.query(p, predicate="within"):
            _, axis, line = self.decks[int(i)]
            s, _ = axis.project(p.x, p.y)
            t = min(max(s / STEP, 0.0), len(line) - 1)
            k = min(int(t), len(line) - 2)
            return line[k] + (line[k + 1] - line[k]) * (t - k)
        return None

    def on_bridge_way(self, p: shapely.Point) -> bool:
        """Whether p's nearest highway within ON_BRIDGE_M is a bridge."""
        if self.ways is None:
            return False
        near = self.ways.query_nearest(p, max_distance=ON_BRIDGE_M)
        return len(near) > 0 and bool(self.bridge[int(near[0])])

    def kerbside(self, p: shapely.Point) -> shapely.Point:
        """p, or — within LANES_M of a street's line, in its lanes — its
        deck's nearer side, DECK_EDGE_IN_M in from it, straight across the
        axis (never towards an end: that is the abutment, still the lanes).
        On the ground such a piece moves to the class raster's kerb; on a
        bridge that is the ground's below (the Schloßbrücke's lamp in
        Meißen, mapped on its lane)."""
        if self.tree is None or self.streets is None:
            return p
        if len(self.streets.query_nearest(p, max_distance=LANES_M)) == 0:
            return p
        for i in self.tree.query(p, predicate="within"):
            deck, axis, _ = self.decks[int(i)]
            s, off = axis.project(p.x, p.y)
            sides = [(_side(deck, axis, s, off, +1), +1), (_side(deck, axis, s, off, -1), -1)]
            edge, sign = min(sides, key=lambda e: abs(e[0] - off))
            if abs(edge - off) <= DECK_EDGE_IN_M:
                return p
            x, y = axis.points(s, edge - sign * DECK_EDGE_IN_M)
            return shapely.Point(float(x), float(y))
        return p

    def deck_under(self, p: shapely.Point, cls: int | None) -> float | None:
        """The top of the deck p stands on, or None: on the ground (`cls`,
        the class raster's there)."""
        top = self.top(p)
        if top is None:
            return None
        return top if cls in BLOCKED or self.on_bridge_way(p) else None


def _side(deck: shapely.Geometry, axis: Axis, s: float, off: float, sign: int) -> float:
    """The offset where the deck ends across its axis at station s, going
    from `off` towards `sign`: its outline's nearest crossing."""
    sx, sy = axis.points(s, off)
    start = shapely.Point(float(sx), float(sy))
    x, y = axis.points(s, off + sign * SIDE_REACH_M)
    hits = shapely.LineString([start, (float(x), float(y))]).intersection(deck.boundary)
    if hits.is_empty:
        return off + sign * SIDE_REACH_M
    return off + sign * start.distance(hits)


class Gate:
    """Where nothing is stood: off the tile's own ground, on the railway or
    water, on a bridge deck — but on a road or path deck, which `deck`
    finds when the gate is given the `decks`."""

    def __init__(self, tile: Tile, decks: Decks | None = None) -> None:
        self.bounds = tile.bounds
        self.on_decks = decks
        cls = tile.classes()
        if cls is None:
            raise FileNotFoundError(f"{tile.id}: no class raster — bake landcover first")
        self.cls = cls
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
        return value_at(self.cls, self.bounds, x, y)

    def deck(self, p: shapely.Point) -> float | None:
        """The top of the road or path deck p stands on, if the tile owns p
        (`Decks.deck_under`); None on the ground."""
        if self.on_decks is None or not owns(self.bounds, p.x, p.y):
            return None
        return self.on_decks.deck_under(p, self.cls_at(p.x, p.y))

    def on_deck(self, p: shapely.Point, kerbside: bool) -> tuple[shapely.Point, float] | None:
        """Where on its deck p stands and the deck's top there — out of the
        lanes to the deck's edge when `kerbside` (`Decks.kerbside`) — or
        None on the ground."""
        if self.deck(p) is None or self.on_decks is None:
            return None
        at = self.on_decks.kerbside(p) if kerbside else p
        top = self.on_decks.top(at)
        return None if top is None else (at, top)

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


def way_bearing(p: shapely.Point, ways, lines, within: float = ON_WAY_M) -> float | None:
    """The digitised direction of the way the point lies on (≤ `within`)."""
    hit = ways.query_nearest(p, max_distance=within)
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


def on_street(p: shapely.Point, ways, streets: np.ndarray) -> bool:
    """Whether the way nearest p (within `FACE_M`) has a carriageway."""
    hit = ways.query_nearest(p, max_distance=FACE_M)
    return len(hit) > 0 and bool(streets[hit[0]])


def _placed(
    k: str, g: shapely.Point, other: str | None, gate: Gate, ways, lines, streets, facades
) -> tuple[shapely.Point, float | None] | None:
    """Where a point object stands and the bearing it faces (None: round)."""
    if k == "signal":
        return signal_place(g, other, gate, ways, lines)
    if k == "wallclock":
        return facades.hang(g) if facades is not None else None
    if k == "hydrantsign" and gate.on_road(g):
        kerb = gate.nearest_kerb(g)
        return (kerb, facing(kerb, ways, lines)) if kerb is not None else None
    if k in KERBSIDE and gate.on_road(g) and on_street(g, ways, streets):
        kerb = gate.nearest_kerb(g)
        if kerb is None:
            return None
        return kerb, None if k in ROUND else facing(kerb, ways, lines)
    return _as_mapped(k, g, other, ways, lines)


def _as_mapped(
    k: str, g: shapely.Point, other: str | None, ways, lines
) -> tuple[shapely.Point, float | None]:
    """Where it is mapped, facing its `direction` (a bench) or the nearest way."""
    if k in ROUND:
        return g, None
    a = direction(tag(other, "direction")) if k == "bench" else None
    return g, a if a is not None else facing(g, ways, lines)


def _stood(
    k: str, g: shapely.Point, other: str | None, gate: Gate, ways, lines, streets, facades
) -> tuple[shapely.Point, float | None, float | None] | None:
    """Where a point object stands, the bearing it faces and the top of the
    bridge deck it stands on (None: the ground). On a deck it stands where
    it is mapped, a kerbside piece mapped in a street's lanes at the deck's
    edge (the class raster's kerbs are the ground's below), and what would
    stand in the lanes there is left out (`OFF_DECK`)."""
    on = gate.on_deck(g, k in KERBSIDE)
    if on is not None:
        at, deck = on
        return None if k in OFF_DECK else (*_as_mapped(k, at, other, ways, lines), deck)
    if not gate.open(g):
        return None
    placed = _placed(k, g, other, gate, ways, lines, streets, facades)
    if placed is None or not gate.open(placed[0]):
        return None
    return (*placed, None)


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


def _points(tile: Tile, gate: Gate, ways, lines, streets) -> list[dict]:
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
        if k is None or hidden(other):
            continue
        stood = _stood(k, g, other, gate, ways, lines, streets, facades)
        if stood is None:
            continue
        at, a, deck = stood
        if k == "shelter":
            if any(at.distance(s) < SHELTER_DEDUP_M for s in shelters):
                continue
            shelters.append(at)
        props = _props(k, other)
        if a is not None:
            props["a"] = round(a)
        if deck is not None:
            props["deck"] = round(deck, 2)
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
        deck = gate.deck(mid)
        if deck is None and not gate.open(mid):
            continue
        props: dict = {"k": "bench", "a": round(a), "l": round(length, 1)}
        if tag(other, "backrest") == "no":
            props["back"] = False
        if deck is not None:
            props["deck"] = round(deck, 2)
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
    geoms, fields = read_ways(tile, "highway IS NOT NULL", ["highway"], margin=0.001)
    keep = [g.geom_type == "LineString" for g in geoms]
    lines = np.array([g for g, k in zip(geoms, keep, strict=True) if k], dtype=object)
    streets = np.array(
        [h in STREETS for h, k in zip(fields["highway"], keep, strict=True) if k], dtype=bool
    )
    ways = shapely.STRtree(lines)
    gate = Gate(tile, Decks.of(tile))
    features = (
        _points(tile, gate, ways, lines, streets)
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
