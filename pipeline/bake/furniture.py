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
mapped; what is mapped in a street's lanes there moves across the axis to
the deck's edge (`ON_DECK_KERB`) — a traffic signal to its carriageway's
kerb on the right of the traffic it faces (the street's `width`, else its
class's half-width; the deck's edge where nearer) — and a wall clock hangs
on a facade within reach. Before, all of them were dropped, and later still the signals and
hydrant signs (eleven signals: Hamburg's six on the Altmann-, Kornhaus- and
Rentzelstraßenbrücke, Dresden's three, one on Munich's Maximiliansbrücke,
one in Leipzig).

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

A bench without a `direction` that has water (the class raster's) within
WATER_FACE_M on the side away from its way looks at the water instead
(`water_facing`), and so does a playground's piece without one.

A signalled pedestrian crossing (`highway=crossing` + `crossing=
traffic_signals`, or `crossing:signals=yes`) stands a pedestrian signal
(`pedsignal`, a 2.5 m post) at each kerb end of its crossing way — the
footway through the node, else straight across the road — its head looking
across at the far kerb (`_crossings`). A car signal facing its traffic on a
road of ARM_LANES lanes or more hangs its head on a mast arm over the lanes
(`arm`), and an approach with a junction within REPEATER_M past its stop
line repeats its signal on the far side of that junction, at the kerb on
the traffic's right (`repeater`). On a deck both keep to the kerb rule
there (`Decks.kerbside`). A road's carriageway is its `width`, else its
`lanes` (landcover_osm.LANE_M each), else its class's (half of it for
one carriageway of a dual main road, as the class raster paints it); where
the class raster's road reaches farther than KERB_MAX_M round a signal (a
square), the kerb is searched farther (`KERB_REACH_M`), and past that taken
from the way's carriageway.

A litter bin's colour (`c`) is its own `colour` tag, else the site's —
when ≥ BIN_TAGGED of the city's bins are tagged and ≥ BIN_AGREE of those
agree (Hamburg's red) — in one of the tones the viewer draws; grey, the
model's own, is left unwritten.

Playgrounds come the same way and as mapped: the `leisure=playground`
outline as a Polygon (`k: playground`), and each piece of equipment OSM
lists (`playground=swing/slide/sandpit/climbingframe/…`) as a Point of its
kind — or, a sandpit drawn as an area, as its Polygon; a piece drawn as a
way stands at its midpoint, turned along it. A playground mapped without
its equipment stands what the surface model measures there (`src: "dom"`,
`_measured_equipment`): every blob of DOM1 − DGM1 from 1.2 to 4 m that is
no tree (low in the vegetation index, clear of anything taller and of the
canopy's trees) and no hedge or fence (PLAY_EDGE_M inside its outline) — a
long narrow one a swing across it, any other a climbing frame. None is
invented where nothing stands."""

from __future__ import annotations

import colorsys
import dataclasses
import functools
import json
import math
import re

import numpy as np
import rasterio
import shapely
import shapely.geometry
from PIL import Image
from rasterio.windows import from_bounds as window_from_bounds
from scipy import ndimage as ndi

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
from .landcover_osm import DUAL, LANE_M, ROAD_HALF_WIDTH, lanes, one_way
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
# ... and, where the road reaches farther all round (a square the class
# raster counts as road), how far it is searched before the way's
# carriageway gives the kerb
KERB_REACH_M = (KERB_MAX_M, 30.0)
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
# On a bridge deck these move out of a street's lanes to the deck's edge: the
# kerbside pieces, a signal (mapped at its stop line) and a hydrant's sign
# (on its lid). On the ground the latter two move to the class raster's
# kerb, which on a bridge is the ground's below — they were dropped there.
ON_DECK_KERB = KERBSIDE | {"signal", "hydrantsign"}
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
WATER = 8  # the class raster's water
WATER_FACE_M = 12.0  # water this near a bench, on its far side, is what it looks at
WATER_SIDE_DEG = 60.0  # ... within this of straight away from its way
# The pieces of a playground that have a front (the rest are round).
FRONTED = {"swing", "slide", "seesaw", "springy", "playhouse"}
# A signalled pedestrian crossing (a junction's signal node tagged so too).
CROSSING_WHERE = (
    "highway IN ('crossing', 'traffic_signals') AND ("
    'other_tags LIKE \'%"crossing"=>"traffic_signals"%\' '
    'OR other_tags LIKE \'%"crossing:signals"=>"yes"%\')'
)
PED_DEDUP_M = 2.5  # two pedestrian signals this close are one
ARM_LANES = 3  # a road this many lanes wide hangs its signal on a mast arm
REPEATER_M = 40.0  # a junction this far past a stop line has a far-side signal
JUNCTION_MIN_M = 2.0  # ... and at least this far (not the stop line's own node)
# The bins' colours: the tones the viewer draws (lib/city/furniture.ts), the
# tags that name them, and how many of a city's bins must be tagged, and
# agree, for their colour to be the city's.
BIN_TONES = ("red", "green", "blue", "orange", "yellow", "grey")
BIN_NAMES = {
    "red": "red", "darkred": "red", "dark_red": "red",
    "green": "green", "darkgreen": "green", "dark_green": "green",
    "lightgreen": "green", "light_green": "green",
    "blue": "blue", "darkblue": "blue", "dark_blue": "blue",
    "orange": "orange", "yellow": "yellow",
    "grey": "grey", "gray": "grey", "silver": "grey", "black": "grey", "white": "grey",
    "darkgrey": "grey", "dark_grey": "grey", "darkgray": "grey", "dark_gray": "grey",
    "anthracite": "grey", "metal": "grey", "burnished_metal": "grey",
    "stainless_steel": "grey",
}  # fmt: skip
BIN_TAGGED = 20
BIN_AGREE = 0.6
BIN_WHERE = 'other_tags LIKE \'%"amenity"=>"waste_basket"%\''
# Equipment measured in an empty playground (`_measured_equipment`).
PLAY_H = (1.2, 4.0)  # a blob's top (m)
PLAY_CELLS = (2, 40)  # its size (m², 1 m cells)
PLAY_TREE_M = 1.5  # a canopy tree this near is what it is
PLAY_EDGE_M = 1.0  # the hedge or fence round a playground: no blob this near its outline
PLAY_GREEN = 77  # the vegetation index's GREEN (canopy.py): NDVI 0.3
PLAY_LONG = 2.5  # a blob this many times longer than wide is a swing's frame
PLAY_MAX = 8  # pieces measured per playground at most


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


def bench_on_way(
    line: shapely.LineString, ways, lines, gate: Gate | None = None
) -> tuple[shapely.Point, float, float]:
    """A bench mapped as a way: its midpoint, the side of it facing the
    nearest path (the right-hand side without one) — the water's side
    where water lies beyond it, away from the path (`water_facing`) —, and
    its length."""
    mid = line.interpolate(0.5, normalized=True)
    a, b = line.interpolate(0.45, normalized=True), line.interpolate(0.55, normalized=True)
    along = bearing(b.x - a.x, b.y - a.y)
    right = (along + 90.0) % 360
    toward = facing(mid, ways, lines)
    water = water_facing(gate, mid, toward)
    if water is not None:
        toward = water
    if toward is not None and math.cos(math.radians(toward - right)) < 0:
        right = (right + 180.0) % 360
    return mid, right, min(max(line.length, BENCH_M[0]), BENCH_M[1])


def water_bearing(gate: Gate, p: shapely.Point) -> float | None:
    """The bearing of the nearest water within WATER_FACE_M (the class
    raster's, looked for in 16 directions, 1 m steps; the mean of the
    directions that meet it first), or None."""
    dirs = [(math.sin(math.radians(i * 22.5)), math.cos(math.radians(i * 22.5))) for i in range(16)]
    for d in np.arange(1.0, WATER_FACE_M + 0.5, 1.0):
        hit = [(dx, dy) for dx, dy in dirs if gate.cls_at(p.x + dx * d, p.y + dy * d) == WATER]
        if hit:
            return bearing(sum(h[0] for h in hit), sum(h[1] for h in hit))
    return None


def water_facing(gate: Gate | None, p: shapely.Point, toward: float | None) -> float | None:
    """The bearing to the water a bench or a playground's piece looks at:
    water within WATER_FACE_M on the side away from its nearest way
    (`toward`; within WATER_SIDE_DEG of straight away), on any side without
    a way near; else None."""
    if gate is None:
        return None
    w = water_bearing(gate, p)
    if w is None or toward is None:
        return w
    return w if abs((w - toward) % 360 - 180.0) <= WATER_SIDE_DEG else None


class Decks:
    """The drawn road and path decks of every tile (a deck is drawn by the
    tile that owns its centre, so one over a seam may be a neighbour's), and
    the bridge ways, so a lamp or a bench on a bridge stands on its deck."""

    def __init__(
        self,
        decks: list[tuple[shapely.Geometry, Axis, list[float]]],
        ways: list[tuple[shapely.Geometry, bool]],
        streets: list[shapely.Geometry] | None = None,
        halves: list[float] | None = None,
    ) -> None:
        self.decks = decks
        self.tree = shapely.STRtree([d for d, _, _ in decks]) if decks else None
        self.ways = shapely.STRtree([g for g, _ in ways]) if ways else None
        self.bridge = np.array([b for _, b in ways], dtype=bool)
        self.streets = shapely.STRtree(streets) if streets else None
        # each street's carriageway half-width (m; `carriageway_half`)
        self.halves = halves

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
        streets = [
            (g, carriageway_half(k, t))
            for g, k, t in zip(geoms, kinds, tags, strict=True)
            if g is not None and k in STREETS
        ]
        return cls(decks, ways, [g for g, _ in streets], [h for _, h in streets])

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

    def kerbside(
        self, p: shapely.Point, toward: float | None = None, kerb: bool = False
    ) -> shapely.Point:
        """p, or — within LANES_M of a street's line, in its lanes — its
        deck's nearer side, DECK_EDGE_IN_M in from it, straight across the
        axis (never towards an end: that is the abutment, still the lanes).
        With a bearing `toward`, the side that bearing points to instead (a
        signal's: the right of the traffic it faces). With `kerb`, no
        farther than the street's carriageway reaches, KERB_CLEAR_M on (a
        signal stands at the kerb, not by the parapet: a deck over a
        station's tracks is 30–46 m wide). On the ground such a piece moves
        to the class raster's kerb; on a bridge that is the ground's below
        (the Schloßbrücke's lamp in Meißen, mapped on its lane)."""
        if self.tree is None or self.streets is None:
            return p
        hit = self.streets.query_nearest(p, max_distance=LANES_M)
        if len(hit) == 0:
            return p
        for i in self.tree.query(p, predicate="within"):
            deck, axis, _ = self.decks[int(i)]
            s, off = axis.project(p.x, p.y)
            sides = [(_side(deck, axis, s, off, +1), +1), (_side(deck, axis, s, off, -1), -1)]
            if toward is None:
                edge, sign = min(sides, key=lambda e: abs(e[0] - off))
            else:
                edge, sign = sides[0] if _left_of(axis, s, toward) else sides[1]
            to = edge - sign * DECK_EDGE_IN_M
            if kerb:
                to = self._kerb(int(hit[0]), p, axis, sign, to)
            if sign * (to - off) <= 0:
                return p
            x, y = axis.points(s, to)
            return shapely.Point(float(x), float(y))
        return p

    def _kerb(self, i: int, p: shapely.Point, axis: Axis, sign: int, to: float) -> float:
        """The offset across the axis of street i's kerb on side `sign`,
        KERB_CLEAR_M on, where that comes before `to` (the deck's edge)."""
        if self.streets is None or self.halves is None:
            return to
        q = shapely.get_point(shapely.shortest_line(p, self.streets.geometries[i]), 1)
        _, at = axis.project(q.x, q.y)
        kerb = at + sign * (self.halves[i] + KERB_CLEAR_M)
        return min(to, kerb) if sign > 0 else max(to, kerb)

    def deck_under(self, p: shapely.Point, cls: int | None) -> float | None:
        """The top of the deck p stands on, or None: on the ground (`cls`,
        the class raster's there)."""
        top = self.top(p)
        if top is None:
            return None
        return top if cls in BLOCKED or self.on_bridge_way(p) else None


def carriageway_half(highway: str | None, other: str | None) -> float:
    """A street's carriageway half-width (m): its `width`, else its `lanes`
    where it counts two or more (landcover_osm.LANE_M each), else its
    class's (the OSM class raster's road, landcover_osm.ROAD_HALF_WIDTH;
    halved, not under 2 m, for one carriageway of a dual main road, as
    the class raster paints it)."""
    width = re.search(r"\d*\.?\d+", tag(other, "width") or "")
    if width and float(width.group()) > 0:
        return float(width.group()) / 2
    n = lanes(other)
    if n is not None and n >= 2:
        return n * LANE_M / 2
    half = ROAD_HALF_WIDTH.get(highway or "", 3.0)
    return max(half / 2, 2.0) if highway in DUAL and one_way(highway, other) else half


def _left_of(axis: Axis, s: float, deg: float) -> bool:
    """Whether a compass bearing points to the axis's left (+ offsets) at
    station s."""
    x0, y0 = axis.points(s, 0.0)
    x1, y1 = axis.points(s, 1.0)
    return (float(x1) - float(x0)) * math.sin(math.radians(deg)) + (
        float(y1) - float(y0)
    ) * math.cos(math.radians(deg)) > 0


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

    def on_deck(
        self, p: shapely.Point, kerbside: bool, toward: float | None = None, kerb: bool = False
    ) -> tuple[shapely.Point, float] | None:
        """Where on its deck p stands and the deck's top there — out of the
        lanes to the deck's edge when `kerbside` (`Decks.kerbside`, to the
        side the bearing `toward` points to when given, no farther than the
        carriageway's kerb with `kerb`) — or None on the ground."""
        if self.deck(p) is None or self.on_decks is None:
            return None
        at = self.on_decks.kerbside(p, toward, kerb) if kerbside else p
        top = self.on_decks.top(at)
        return None if top is None else (at, top)

    def on_road(self, p: shapely.Point) -> bool:
        return self.cls_at(p.x, p.y) == ROAD

    def kerb_along(
        self, p: shapely.Point, deg: float, reach: float = KERB_MAX_M
    ) -> shapely.Point | None:
        """Walking from p towards the bearing, just past where the road ends
        (within `reach`)."""
        dx, dy = math.sin(math.radians(deg)), math.cos(math.radians(deg))
        d = 0.0
        while d <= reach:
            if self.cls_at(p.x + dx * d, p.y + dy * d) != ROAD:
                d += KERB_CLEAR_M
                return shapely.Point(p.x + dx * d, p.y + dy * d)
            d += KERB_STEP_M
        return None

    def nearest_kerb(
        self, p: shapely.Point, reaches: tuple[float, ...] = (KERB_MAX_M,)
    ) -> shapely.Point | None:
        """The nearest point off the road (16 directions) within the first
        of `reaches` that finds one, or None."""
        for reach in reaches:
            best = None
            for i in range(16):
                q = self.kerb_along(p, i * 22.5, reach)
                if q is not None and (best is None or p.distance(q) < p.distance(best)):
                    best = q
            if best is not None:
                return best
        return None

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
    travel = signal_travel(p, other, ways, lines)
    if travel is not None and gate.on_road(p):
        kerb = gate.kerb_along(p, (travel + 90.0) % 360)
        if kerb is None:
            kerb = way_kerb(p, (travel + 90.0) % 360, ways, lines)
        if kerb is not None:
            return kerb, (travel + 180.0) % 360
    if gate.on_road(p):
        # a square the class raster counts as road: the way's kerb, else
        # the kerb searched farther (`KERB_REACH_M`)
        kerb = (
            gate.nearest_kerb(p)
            or way_kerb(p, None, ways, lines)
            or gate.nearest_kerb(p, KERB_REACH_M[1:])
        )
        if kerb is None:
            return None
        p = kerb
    return p, facing(p, ways, lines)


def signal_travel(p: shapely.Point, other: str | None, ways, lines) -> float | None:
    """The bearing of the traffic a signal controls: along the way through
    it by its `traffic_signals:direction`; None where that is not tagged."""
    along = way_bearing(p, ways, lines)
    towards = tag(other, "traffic_signals:direction")
    if along is None or towards not in ("forward", "backward"):
        return None
    return along if towards == "forward" else (along + 180.0) % 360


def way_kerb(p: shapely.Point, toward: float | None, ways, lines) -> shapely.Point | None:
    """The kerb of the way p lies on (≤ LANES_M) from its carriageway
    (`carriageway_half`), KERB_CLEAR_M on: on the side the bearing `toward`
    points to, else the nearer one — where the class raster shows no kerb
    in reach (a square). Needs the ways' tags (`Network`); None without."""
    net = _network(ways)
    if net is None:
        return None
    i = net.street_at(p, LANES_M)
    if i is None:
        return None
    line = lines[i]
    s = line.project(p)
    q = line.interpolate(s)
    along = net.bearing_at(i, q)
    left = (along - 90.0) % 360
    if toward is None:
        side = left if _side_of(q, p, left) else (left + 180.0) % 360
    else:
        side = left if math.cos(math.radians(toward - left)) > 0 else (left + 180.0) % 360
    out = net.halves[i] + KERB_CLEAR_M
    rad = math.radians(side)
    return shapely.Point(q.x + math.sin(rad) * out, q.y + math.cos(rad) * out)


def _side_of(q: shapely.Point, p: shapely.Point, deg: float) -> bool:
    """Whether p lies from q towards the bearing (or on q)."""
    rad = math.radians(deg)
    return (p.x - q.x) * math.sin(rad) + (p.y - q.y) * math.cos(rad) >= 0


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
    return _as_mapped(k, g, other, ways, lines, gate)


def _as_mapped(
    k: str, g: shapely.Point, other: str | None, ways, lines, gate: Gate | None = None
) -> tuple[shapely.Point, float | None]:
    """Where it is mapped, facing its `direction` (a bench) or the nearest
    way — a bench on the ground, the water beyond it (`water_facing`)."""
    if k in ROUND:
        return g, None
    a = direction(tag(other, "direction")) if k == "bench" else None
    if a is not None:
        return g, a
    toward = facing(g, ways, lines)
    water = water_facing(gate, g, toward) if k == "bench" else None
    return g, water if water is not None else toward


def _on_deck(
    k: str, g: shapely.Point, other: str | None, gate: Gate, ways, lines, facades
) -> tuple[shapely.Point, float | None, float | None] | None:
    """Where a point object a bridge deck holds stands, the bearing it faces
    and the deck's top there (None: the ground beside the bridge). It stands
    where it is mapped, but what would stand in the lanes there moves to the
    deck's edge (`ON_DECK_KERB`; the class raster's kerbs are the ground's
    below): a traffic signal facing its traffic to its carriageway's kerb on
    that traffic's right, as on the ground (`signal_place`), or the deck's
    edge where that comes first. A wall
    clock hangs on a facade within reach, as on the ground, over the deck
    where the deck holds that facade point; without one it is dropped."""
    if k == "wallclock":
        hung = facades.hang(g) if facades is not None else None
        if hung is None or gate.on_decks is None:
            return None
        return (*hung, gate.on_decks.top(hung[0]))
    toward = face = None
    if k == "signal":
        along = way_bearing(g, ways, lines)
        towards = tag(other, "traffic_signals:direction")
        if along is not None and towards in ("forward", "backward"):
            travel = along if towards == "forward" else (along + 180.0) % 360
            toward, face = (travel + 90.0) % 360, (travel + 180.0) % 360
    on = gate.on_deck(g, k in ON_DECK_KERB, toward, kerb=k == "signal")
    if on is None:
        return None
    at, deck = on
    if face is not None:
        return at, face, deck
    return (*_as_mapped(k, at, other, ways, lines), deck)


def _stood(
    k: str, g: shapely.Point, other: str | None, gate: Gate, ways, lines, streets, facades
) -> tuple[shapely.Point, float | None, float | None] | None:
    """Where a point object stands, the bearing it faces and the top of the
    bridge deck it stands on (None: the ground) — on a deck by `_on_deck`."""
    if gate.deck(g) is not None:
        placed = _on_deck(k, g, other, gate, ways, lines, facades)
        if placed is None or (placed[2] is None and not gate.open(placed[0])):
            return None
        return placed
    if not gate.open(g):
        return None
    placed = _placed(k, g, other, gate, ways, lines, streets, facades)
    if placed is None or not gate.open(placed[0]):
        return None
    return (*placed, None)


def _props(k: str, other: str | None, bins: str | None = None) -> dict:
    props: dict = {"k": k}
    if k == "bin":
        tone = bin_tone(tag(other, "colour")) or bins
        if tone is not None and tone != "grey":
            props["c"] = tone
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
    bins = site_bin_tone(tile) if "bin" in kinds else None
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
        props = _props(k, other, bins)
        if a is not None:
            props["a"] = round(a)
        if deck is not None:
            props["deck"] = round(deck, 2)
        if k == "signal":
            out.extend(_signal_extras(g, other, props, gate, ways, lines))
        feature_ = _point_feature(at, props)
        (stops if k == "stop" else out).append(feature_)
    # A stop sign only where no shelter stands (the shelter carries the sign).
    for f in stops:
        at = shapely.Point(f["geometry"]["coordinates"])
        if not any(at.distance(s) < SHELTER_DEDUP_M for s in shelters):
            out.append(f)
    return out


def _signal_extras(
    g: shapely.Point, other: str | None, props: dict, gate: Gate, ways, lines
) -> list[dict]:
    """What a car signal facing its traffic adds: its mast arm over a road
    of ARM_LANES lanes or more (`arm` on `props`), and its far-side
    repeater past a junction ahead (`repeater`)."""
    travel = signal_travel(g, other, ways, lines)
    net = _network(ways)
    if travel is None or net is None:
        return []
    i = net.street_at(g)
    if i is not None and net.lanes[i] >= ARM_LANES:
        props["arm"] = True
    far = repeater(g, travel, gate, ways, lines)
    if far is None:
        return []
    return [_point_feature(far, {"k": "signal", "a": round((travel + 180.0) % 360)})]


def repeater(p: shapely.Point, travel: float, gate: Gate, ways, lines) -> shapely.Point | None:
    """Where a signal's far-side repeater stands: past the first street that
    crosses its way within REPEATER_M ahead of the stop line (by that
    street's carriageway and a kerb's step), at the kerb on the right of the
    traffic — on the ground, on the tile's open ground; else None."""
    net = _network(ways)
    i = net.street_at(p) if net is not None else None
    if i is None:
        return None
    line = lines[i]
    s0 = line.project(p)
    sign = (
        1.0 if math.cos(math.radians(travel - (way_bearing(p, ways, lines) or 0.0))) > 0 else -1.0
    )
    ahead = net.junction_ahead(i, s0, sign)
    if ahead is None:
        return None
    s, half = ahead
    q = line.interpolate(s + sign * (half + KERB_CLEAR_M + 1.0))
    if gate.deck(q) is not None or not gate.on_road(q):
        return None
    right = (travel + 90.0) % 360
    kerb = gate.kerb_along(q, right) or way_kerb(q, right, ways, lines)
    return kerb if kerb is not None and gate.open(kerb) and gate.deck(kerb) is None else None


def _crossing_bearing(p: shapely.Point, net: Network) -> float | None:
    """Which way a crossing crosses its road at p: along the footway through
    it, else straight across the road; None off every way."""
    foot = net.footway_at(p)
    if foot is not None:
        return net.bearing_at(foot, p)
    road = net.street_at(p)
    return None if road is None else (net.bearing_at(road, p) + 90.0) % 360


def crossing_signals(
    p: shapely.Point, gate: Gate, ways, lines
) -> list[tuple[shapely.Point, float, float | None]]:
    """A signalled crossing's pedestrian signals: one at each kerb end of
    its crossing (`_crossing_bearing`), each looking across at the other
    (with the deck's top it stands on, None: the ground). On a deck the
    kerb is the carriageway's (`Gate.on_deck`), on the ground the class
    raster's, else the way's carriageway (`way_kerb`)."""
    net = _network(ways)
    c = _crossing_bearing(p, net) if net is not None else None
    if c is None:
        return []
    out = []
    for side in (c, (c + 180.0) % 360):
        looks = (side + 180.0) % 360
        if gate.deck(p) is not None:
            on = gate.on_deck(p, True, side, kerb=True)
            if on is not None:
                out.append((on[0], looks, on[1]))
            continue
        kerb = gate.kerb_along(p, side) if gate.on_road(p) else None
        if kerb is None:
            kerb = way_kerb(p, side, ways, lines)
        if kerb is not None and gate.open(kerb) and gate.deck(kerb) is None:
            out.append((kerb, looks, None))
    return out


def _crossings(tile: Tile, gate: Gate, ways, lines) -> list[dict]:
    """The pedestrian signals of every signalled crossing the tile owns."""
    geoms, fields = read_osm(tile, "points", CROSSING_WHERE, ["highway", "other_tags"])
    out: list[dict] = []
    stood: list[shapely.Point] = []
    for g, other in zip(geoms, fields["other_tags"], strict=True):
        if hidden(other) or not owns(tile.bounds, g.x, g.y):
            continue
        for at, a, deck in crossing_signals(g, gate, ways, lines):
            if any(at.distance(q) < PED_DEDUP_M for q in stood):
                continue
            stood.append(at)
            props: dict = {"k": "pedsignal", "a": round(a)}
            if deck is not None:
                props["deck"] = round(deck, 2)
            out.append(_point_feature(at, props))
    return out


def bin_tone(colour: str | None) -> str | None:
    """A bin's `colour` tag as one of BIN_TONES: a name (`BIN_NAMES`), or a
    hex colour by its hue (grey where it has little); None where neither."""
    value = (colour or "").strip().lower().replace(" ", "_").replace("-", "_")
    if value in BIN_NAMES:
        return BIN_NAMES[value]
    m = re.fullmatch(r"#([0-9a-f]{6})", value)
    if m is None:
        return None
    r, g, b = (int(m.group(1)[i : i + 2], 16) / 255 for i in (0, 2, 4))
    hue, light, sat = colorsys.rgb_to_hls(r, g, b)
    if sat < 0.25 or light < 0.12:
        return "grey"
    deg = hue * 360
    for top, tone in ((20, "red"), (45, "orange"), (70, "yellow"), (170, "green"), (260, "blue")):
        if deg < top:
            return tone
    return "red" if deg >= 330 else None


def site_bin_tone(tile: Tile) -> str | None:
    """The city's bin colour: the tone most of its tagged bins share, where
    BIN_TAGGED are tagged at least and BIN_AGREE of them agree; else None.
    Read over every tile of the site at once."""
    tiles = tile.neighbours() or [(tile.id, tile.bounds)]
    xmin = min(b[0] for _, b in tiles)
    ymin = min(b[1] for _, b in tiles)
    xmax = max(b[2] for _, b in tiles)
    ymax = max(b[3] for _, b in tiles)
    return _site_bin_tone(dataclasses.replace(tile, bounds=(xmin, ymin, xmax, ymax)))


@functools.cache
def _site_bin_tone(site: Tile) -> str | None:
    _, fields = read_osm(site, "points", BIN_WHERE, ["other_tags"], margin=0.0)
    tones = [bin_tone(tag(o, "colour")) for o in fields["other_tags"] if tag(o, "colour")]
    tones = [t for t in tones if t is not None]
    if len(tones) < BIN_TAGGED:
        return None
    best = max(BIN_TONES, key=tones.count)
    return best if tones.count(best) >= BIN_AGREE * len(tones) else None


def _bench_ways(tile: Tile, gate: Gate, ways, lines) -> list[dict]:
    geoms, fields = read_osm(tile, "lines", BENCH_WAY_WHERE, ["other_tags"], margin=0.0005)
    out = []
    for g, other in zip(geoms, fields["other_tags"], strict=True):
        if g.geom_type != "LineString" or tag(other, "amenity") != "bench" or hidden(other):
            continue
        mid, a, length = bench_on_way(g, ways, lines, gate)
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


def _equipment(tile: Tile, gate: Gate, ways=None, lines=None) -> list[dict]:
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
            if a is None and "a" not in props and kind in FRONTED and ways is not None:
                a = water_facing(gate, anchor, facing(anchor, ways, lines))
            if a is not None:
                props["a"] = round(a)
            if geom.geom_type == "Point":
                out.append(_point_feature(geom, props))
            else:
                out.append(feature(geometry_json(geom), props))
    return out


def _network(ways) -> Network | None:
    """The ways as a `Network` (which knows their tags), None as a plain
    STRtree."""
    return ways if isinstance(ways, Network) else None


class Network:
    """The tile's highway lines as an STRtree (`query_nearest`, `query`, as
    the helpers ask it) that also knows each line's carriageway: whether it
    has one (`STREETS`), its `lanes` and half-width (`carriageway_half`)."""

    def __init__(self, lines: np.ndarray, kinds: list, tags_: list) -> None:
        self.lines = lines
        self.tree = shapely.STRtree(lines)
        self.streets = np.array([k in STREETS for k in kinds], dtype=bool)
        self.lanes = np.array([lanes(t) or 0 for t in tags_], dtype=int)
        self.halves = np.array(
            [carriageway_half(k, t) for k, t in zip(kinds, tags_, strict=True)], dtype=float
        )

    def query_nearest(self, geom, **kw):
        return self.tree.query_nearest(geom, **kw)

    def query(self, geom, **kw):
        return self.tree.query(geom, **kw)

    def _nearest(self, p: shapely.Point, within: float, street: bool) -> int | None:
        hit = [int(i) for i in self.tree.query(p.buffer(within)) if self.streets[int(i)] == street]
        if not hit:
            return None
        best = min(hit, key=lambda i: self.lines[i].distance(p))
        return best if self.lines[best].distance(p) <= within else None

    def street_at(self, p: shapely.Point, within: float = ON_WAY_M) -> int | None:
        """The street (a carriageway) through p, within `within`."""
        return self._nearest(p, within, True)

    def footway_at(self, p: shapely.Point) -> int | None:
        """The way without a carriageway through p (a crossing's footway)."""
        return self._nearest(p, ON_WAY_M, False)

    def bearing_at(self, i: int, p: shapely.Point) -> float:
        """The digitised direction of line i at p."""
        line = self.lines[i]
        s = line.project(p)
        a = line.interpolate(max(s - 1.0, 0.0))
        b = line.interpolate(min(s + 1.0, line.length))
        return bearing(b.x - a.x, b.y - a.y)

    def junction_ahead(self, i: int, s0: float, sign: float) -> tuple[float, float] | None:
        """The first street crossing line i from station s0 on (towards
        `sign`), JUNCTION_MIN_M to REPEATER_M ahead: its station on i and
        its carriageway's half-width; None without one."""
        line = self.lines[i]
        best = None
        for j in self.tree.query(line, predicate="intersects"):
            j = int(j)
            if j == i or not self.streets[j]:
                continue
            for q in shapely.get_parts(line.intersection(self.lines[j])):
                if q.geom_type != "Point":
                    continue
                ahead = sign * (line.project(q) - s0)
                if JUNCTION_MIN_M <= ahead <= REPEATER_M and (best is None or ahead < best[0]):
                    best = (ahead, line.project(q), float(self.halves[j]))
        return None if best is None else (best[1], best[2])


def _measured_equipment(
    tile: Tile, gate: Gate, playgrounds: list[dict], equipment: list[dict]
) -> list[dict]:
    """In each playground OSM maps without equipment, the equipment the
    surface model shows (`src: "dom"`): every 8-connected blob of DOM1 −
    DGM1 within PLAY_H, PLAY_CELLS large, PLAY_EDGE_M inside the outline
    (a hedge or a fence lines it), that touches nothing taller, is low in
    the vegetation index (below PLAY_GREEN) and has no canopy tree within
    PLAY_TREE_M — the largest PLAY_MAX of them. A long narrow blob
    (PLAY_LONG) is a swing across it, any other a climbing frame."""
    dom = tile.raw_raster("dom1")
    if not tile.products.dom or not dom.exists() or not tile.dgm.exists():
        return []
    empty = []
    for f in playgrounds:
        area = shapely.geometry.shape(f["geometry"])
        if not any(
            area.covers(shapely.geometry.shape(e["geometry"]).representative_point())
            for e in equipment
        ):
            empty.append(area)
    if not empty:
        return []
    green = _green(tile)
    trees = _canopy_points(tile)
    out: list[dict] = []
    with rasterio.open(dom) as dsm, rasterio.open(tile.dgm) as dgm:
        for area in empty:
            ndom, origin = _ndom_window(dsm, dgm, area.bounds)
            if ndom is None:
                continue
            for x, y, props in play_blobs(ndom, origin, area, green, trees, tile.bounds):
                p = shapely.Point(x, y)
                if gate.open(p):
                    out.append(_point_feature(p, props))
    return out


def _ndom_window(dsm, dgm, bounds) -> tuple[np.ndarray | None, tuple[float, float]]:
    """DOM1 − DGM1 over `bounds` (+1 m, snapped to the 1 m grid), and its
    north-west corner; None off either raster."""
    xmin, ymin = math.floor(bounds[0]) - 1, math.floor(bounds[1]) - 1
    xmax, ymax = math.ceil(bounds[2]) + 1, math.ceil(bounds[3]) + 1
    try:
        top = dsm.read(
            1,
            window=window_from_bounds(xmin, ymin, xmax, ymax, dsm.transform),
            boundless=True,
            fill_value=np.nan,
        ).astype(np.float64)
        ground = dgm.read(
            1,
            window=window_from_bounds(xmin, ymin, xmax, ymax, dgm.transform),
            boundless=True,
            fill_value=np.nan,
        ).astype(np.float64)
    except (ValueError, rasterio.errors.RasterioIOError):
        return None, (xmin, ymax)
    if top.shape != ground.shape or top.size == 0:
        return None, (xmin, ymax)
    return top - ground, (float(xmin), float(ymax))


def _green(tile: Tile) -> np.ndarray | None:
    png = tile.out("dlm", f"ndvi_{tile.id}.png")
    return np.asarray(Image.open(png).convert("L")) if png.exists() else None


def _canopy_points(tile: Tile) -> shapely.STRtree | None:
    path = tile.out("dlm", f"canopy_{tile.id}.geojson")
    if not path.exists():
        return None
    pts = [
        shapely.Point(f["geometry"]["coordinates"][:2])
        for f in json.loads(path.read_text())["features"]
    ]
    return shapely.STRtree(pts) if pts else None


def play_blobs(
    ndom: np.ndarray,
    origin: tuple[float, float],
    area: shapely.Geometry,
    green: np.ndarray | None,
    trees: shapely.STRtree | None,
    bounds,
) -> list[tuple[float, float, dict]]:
    """The equipment one playground's surface shows (`_measured_equipment`):
    (x, y, properties) per blob, largest first."""
    west, north = origin
    rows, cols = ndom.shape
    xs, ys = np.meshgrid(west + np.arange(cols) + 0.5, north - np.arange(rows) - 0.5)
    inside = shapely.contains_xy(area.buffer(-PLAY_EDGE_M), xs, ys)
    h = np.nan_to_num(ndom, nan=0.0)
    tall = h > PLAY_H[1]
    labels, n = ndi.label((h >= PLAY_H[0]) & (h <= PLAY_H[1]) & inside, np.ones((3, 3), bool))
    found = []
    for k in range(1, n + 1):
        blob = labels == k
        size = int(blob.sum())
        if (
            not PLAY_CELLS[0] <= size <= PLAY_CELLS[1]
            or (ndi.binary_dilation(blob, np.ones((3, 3), bool)) & tall).any()
        ):
            continue
        bx, by = xs[blob], ys[blob]
        cx, cy = float(bx.mean()), float(by.mean())
        if green is not None and _greenness(green, bounds, bx, by) >= PLAY_GREEN:
            continue
        if trees is not None and len(trees.query(shapely.Point(cx, cy).buffer(PLAY_TREE_M))) > 0:
            continue
        found.append((size, cx, cy, _blob_props(bx, by, float(h[blob].max()))))
    found.sort(key=lambda b: -b[0])
    return [(x, y, props) for _, x, y, props in found[:PLAY_MAX]]


def _greenness(green: np.ndarray, bounds, xs: np.ndarray, ys: np.ndarray) -> float:
    """The mean vegetation index (0–255) under the cells."""
    xmin, ymin, xmax, ymax = bounds
    k = green.shape[0]
    c = np.clip(((xs - xmin) / (xmax - xmin) * k).astype(int), 0, k - 1)
    r = np.clip(((ymax - ys) / (ymax - ymin) * k).astype(int), 0, k - 1)
    return float(green[r, c].mean())


def _blob_props(xs: np.ndarray, ys: np.ndarray, top: float) -> dict:
    """A measured piece: a swing across a long narrow blob, else a climbing
    frame along its long axis."""
    pts = np.stack([xs - xs.mean(), ys - ys.mean()])
    if pts.shape[1] >= 2:
        w, v = np.linalg.eigh(np.cov(pts))
        axis = bearing(float(v[0, 1]), float(v[1, 1]))
        spread = np.sqrt(np.maximum(w, 0.0))
        long = spread[1] >= PLAY_LONG * max(spread[0], 0.3) and spread[1] * 3.5 >= 2.5
    else:
        axis, long = 0.0, False
    kind = "swing" if long and top >= 1.8 else "climb"
    a = (axis + 90.0) % 360 if kind == "swing" else axis
    return {"k": kind, "a": round(a), "src": "dom"}


def run(tile: Tile) -> None:
    if not has_extract(tile, "the street furniture"):
        return
    geoms, fields = read_ways(tile, "highway IS NOT NULL", ["highway", "other_tags"], margin=0.001)
    keep = [g.geom_type == "LineString" for g in geoms]
    lines = np.array([g for g, k in zip(geoms, keep, strict=True) if k], dtype=object)
    kinds = [h for h, k in zip(fields["highway"], keep, strict=True) if k]
    tags_ = [t for t, k in zip(fields["other_tags"], keep, strict=True) if k]
    streets = np.array([h in STREETS for h in kinds], dtype=bool)
    ways = Network(lines, kinds, tags_)
    gate = Gate(tile, Decks.of(tile))
    playgrounds = _playgrounds(tile, gate)
    equipment = _equipment(tile, gate, ways, lines)
    features = (
        _points(tile, gate, ways, lines, streets)
        + _crossings(tile, gate, ways, lines)
        + _bench_ways(tile, gate, ways, lines)
        + playgrounds
        + equipment
        + _measured_equipment(tile, gate, playgrounds, equipment)
    )
    write_geojson(
        tile.out("dlm", f"furniture_{tile.id}.geojson"), features, tile.epsg, OSM_ATTRIBUTION
    )
    counts: dict[str, int] = {}
    for f in features:
        counts[f["properties"]["k"]] = counts.get(f["properties"]["k"], 0) + 1
    print(f"{tile.id}: street furniture and playgrounds {dict(sorted(counts.items()))}")
