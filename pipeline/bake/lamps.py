"""OSM street lamps → lamp points: a lamp on its post, or one hung on a wire
across the street. Dropped where the class raster says railway or water —
unless it stands on a drawn bridge (`deck`, below).
Each tile writes only the lamps it owns (west and south edges in, east and
north out — lib/city/tileset.ts `ownsPoint`), so a lamp on a seam stands
once when both tiles are dressed.

Many of the old town streets are lit by lamps hung on a wire between the
facades (Dresden's Äußere Neustadt: Alaunstraße, Louisenstraße, …). OSM
maps them in the carriageway, where a post would stand in the traffic. A
lamp is hung (`wire`: its two ends, `h`: the head's height) when

- its tags say so: `support` or `lamp_mount` = `suspended`/`wire`; the wire
  runs across the street to the facade on each side, or — where no facade
  stands within `TAGGED_REACH_M` — to a mast at the kerb (`masts`), or
- untagged (no `support`, no `lamp_mount`), it stands in the carriageway
  within `AXIS_M` of a street's centre line and facades close both sides
  of it within `UNTAGGED_REACH_M`: a street lit from above, as OSM tags it
  on only a few percent of such lamps.

Any other lamp in the carriageway (a post the class raster's road covers,
or mapped on the way) moves to the nearest kerb, as the street furniture's
signals do (furniture.py `Gate`); off the road it stands where it is.

A lamp on a bridge stands on its deck (`deck`: the deck's top there, m,
which the viewer stands the post on). It is on the bridge when a drawn road
or path deck holds it (`Decks`, every tile's bridge file) and either its
nearest highway within ON_BRIDGE_M is a bridge (`bridge=*`) or the ground
below is water or railway. Before, those over water or a railway were
dropped and those over a meadow or a street stood under the deck on the
ground: Dresden's 36 (the Budapester Straße's and the Löbtauer Brücke's
over the tracks), Grimma's 11 (the Pöppelmannbrücke's, a footbridge's over
the Mulde). Under a rail deck, or beside a street the bridge spans, a lamp
lights the ground below and stays there."""

from __future__ import annotations

import json
import math

import numpy as np
import shapely
import shapely.geometry

from .bridge import STEP, Axis
from .common import OSM_ATTRIBUTION, Tile, column, feature, owns, write_geojson
from .furniture import BLOCKED, STREETS, Gate, way_bearing
from .osm import has_extract, read_osm, read_ways, tag

LAMP_H = 5.0  # a post's head (the viewer's lamp-layer.ts LAMP_H)
HUNG_H = 7.0  # a hung lamp's head over the street
HUNG = {"suspended", "wire", "catenary"}  # `support` / `lamp_mount` values
AXIS_M = 2.0  # an untagged lamp this close to a street's centre line may hang
UNTAGGED_REACH_M = 12.0  # ... when facades close both sides within this
TAGGED_REACH_M = 20.0  # a tagged hung lamp's wire reaches a facade this far
CORRIDOR_M = 2.5  # a facade counts within this either side of the wire's line
MAST_M = 6.0  # a mast with no kerb found stands this far out
DECK_KINDS = ("road", "path")  # a lamp stands on these decks, never on a rail one
ON_BRIDGE_M = 15.0  # a lamp's way: the nearest highway within this


def hung_tag(other: str | None) -> bool | None:
    """True when the tags hang the lamp, False when they stand it on
    something else (a pole, a wall, the ground), None when they say nothing."""
    values = [tag(other, "support"), tag(other, "lamp_mount")]
    if any(v in HUNG for v in values):
        return True
    return False if any(values) else None


class Facades:
    """The OSM building outlines a lamp's wire is fixed to."""

    def __init__(self, tile: Tile) -> None:
        geoms, _ = read_osm(tile, "multipolygons", "building IS NOT NULL", ["building"])
        self.walls = [g.boundary for g in geoms if g.geom_type in ("Polygon", "MultiPolygon")]
        self.tree = shapely.STRtree(self.walls) if self.walls else None

    def across(self, p: shapely.Point, deg: float, reach: float) -> float | None:
        """How far from p, towards the bearing, the nearest facade stands
        within a corridor `CORRIDOR_M` either side of that line, or None
        within `reach`. A corridor, not a ray, so a gateway or a passage
        right where the lamp hangs still finds the facade beside it."""
        if self.tree is None:
            return None
        dx, dy = math.sin(math.radians(deg)), math.cos(math.radians(deg))
        nx, ny = dy, -dx  # across the corridor
        c = CORRIDOR_M
        box = shapely.Polygon(
            [
                (p.x + nx * c, p.y + ny * c),
                (p.x + nx * c + dx * reach, p.y + ny * c + dy * reach),
                (p.x - nx * c + dx * reach, p.y - ny * c + dy * reach),
                (p.x - nx * c, p.y - ny * c),
            ]
        )
        best = None
        for i in self.tree.query(box, predicate="intersects"):
            part = self.walls[i].intersection(box)
            if part.is_empty:
                continue
            coords = shapely.get_coordinates(part)
            along = (coords[:, 0] - p.x) * dx + (coords[:, 1] - p.y) * dy
            d = float(along.min())
            if d > 0.5 and (best is None or d < best):
                best = d
        return best


def _end(
    p: shapely.Point, deg: float, reach: float, facades: Facades, gate: Gate
) -> tuple[list[float], bool]:
    """One end of a tagged lamp's wire: the facade, or a mast at the kerb."""
    dx, dy = math.sin(math.radians(deg)), math.cos(math.radians(deg))
    d = facades.across(p, deg, reach)
    if d is not None:
        return [round(p.x + dx * d, 2), round(p.y + dy * d, 2)], False
    kerb = gate.kerb_along(p, deg) if gate.on_road(p) else None
    at = kerb if kerb is not None else shapely.Point(p.x + dx * MAST_M, p.y + dy * MAST_M)
    return [round(at.x, 2), round(at.y, 2)], True


def hang(p: shapely.Point, tagged: bool, ways, lines, facades: Facades, gate: Gate) -> dict | None:
    """A hung lamp's wire and masts, or None when it does not hang."""
    along = way_bearing(p, ways, lines, AXIS_M if not tagged else TAGGED_REACH_M)
    if along is None:
        return None
    left, right = (along - 90.0) % 360, (along + 90.0) % 360
    if not tagged:
        reach = UNTAGGED_REACH_M
        a, b = facades.across(p, left, reach), facades.across(p, right, reach)
        if a is None or b is None:
            return None
    ends = [_end(p, deg, TAGGED_REACH_M, facades, gate) for deg in (left, right)]
    props: dict = {"h": HUNG_H, "wire": [ends[0][0], ends[1][0]]}
    if any(mast for _, mast in ends):
        props["masts"] = [ends[0][1], ends[1][1]]
    return props


def place(
    p: shapely.Point,
    other: str | None,
    ways,
    lines,
    facades: Facades,
    gate: Gate,
    lamp_height: float = LAMP_H,
) -> tuple[shapely.Point, dict] | None:
    """Where a lamp stands (or hangs) and its properties, or None (dropped)."""
    tagged = hung_tag(other)
    on_road = gate.on_road(p)
    if tagged or (tagged is None and on_road):
        props = hang(p, bool(tagged), ways, lines, facades, gate)
        if props is not None:
            return p, props
    if on_road:
        kerb = gate.nearest_kerb(p)
        if kerb is None:
            return None
        p = kerb
    return p, {"h": round(lamp_height, 1)}


class Decks:
    """The drawn road and path decks of every tile (a deck is drawn by the
    tile that owns its centre, so one over a seam may be a neighbour's), and
    the bridge ways, so a lamp on a bridge stands on its deck."""

    def __init__(
        self,
        decks: list[tuple[shapely.Geometry, Axis, list[float]]],
        ways: list[tuple[shapely.Geometry, bool]],
    ) -> None:
        self.decks = decks
        self.tree = shapely.STRtree([d for d, _, _ in decks]) if decks else None
        self.ways = shapely.STRtree([g for g, _ in ways]) if ways else None
        self.bridge = np.array([b for _, b in ways], dtype=bool)

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
        tags = column(fields, "other_tags", geoms)
        ways = [
            (g, (tag(t, "bridge") or "no") != "no")
            for g, t in zip(geoms, tags, strict=True)
            if g is not None
        ]
        return cls(decks, ways)

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

    def deck_under(self, p: shapely.Point, cls: int | None) -> float | None:
        """The top of the deck p stands on, or None: on the ground (`cls`,
        the class raster's there)."""
        top = self.top(p)
        if top is None:
            return None
        return top if cls in BLOCKED or self.on_bridge_way(p) else None


def standable(p: shapely.Point, gate: Gate) -> bool:
    """The tile's own, and not on the railway or water (a lamp on a bridge
    deck stands over the river's class, and is left to the bridge)."""
    return owns(gate.bounds, p.x, p.y) and gate.cls_at(p.x, p.y) not in (None, *BLOCKED)


def streets(tile: Tile) -> tuple[shapely.STRtree, np.ndarray]:
    where = "highway IN (" + ", ".join(f"'{s}'" for s in STREETS) + ")"
    geoms, _ = read_ways(tile, where, ["highway"], margin=0.001)
    lines = np.array([g for g in geoms if g.geom_type == "LineString"], dtype=object)
    return shapely.STRtree(lines), lines


def run(tile: Tile, lamp_height: float = LAMP_H) -> None:
    if not has_extract(tile, "the lamps"):
        return
    if tile.classes() is None:
        print(f"{tile.id}: no class raster — skipping the lamps")
        return
    # A small margin, so the reprojected bbox cannot clip a lamp on the edge.
    geoms, fields = read_osm(
        tile, "points", "highway = 'street_lamp'", ["highway", "other_tags"], margin=0.0005
    )
    gate = Gate(tile)
    ways, lines = streets(tile)
    facades = Facades(tile)
    decks = Decks.of(tile)
    features, hung, on_decks = [], 0, 0
    for g, other in zip(geoms, fields["other_tags"], strict=True):
        deck = decks.deck_under(g, gate.cls_at(g.x, g.y)) if owns(gate.bounds, g.x, g.y) else None
        if deck is not None:
            on_decks += 1
            props = {"h": round(lamp_height, 1), "deck": round(deck, 2)}
            features.append(
                feature({"type": "Point", "coordinates": [round(g.x, 1), round(g.y, 1)]}, props)
            )
            continue
        if not standable(g, gate):
            continue
        placed = place(g, other, ways, lines, facades, gate, lamp_height)
        if placed is None or not standable(placed[0], gate):
            continue
        at, props = placed
        hung += "wire" in props
        features.append(
            feature({"type": "Point", "coordinates": [round(at.x, 1), round(at.y, 1)]}, props)
        )
    write_geojson(tile.out("dlm", f"lamps_{tile.id}.geojson"), features, tile.epsg, OSM_ATTRIBUTION)
    print(
        f"{tile.id}: {len(features)} lamps ({hung} hung across the street, {on_decks} on bridges)"
    )
