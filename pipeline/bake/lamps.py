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
or path deck holds it (furniture.py `Decks`, every tile's bridge file) and
either its nearest highway within ON_BRIDGE_M is a bridge (`bridge=*`) or
the ground below is water or railway. Before, those over water or a railway
were dropped and those over a meadow or a street stood under the deck on
the ground: Dresden's 36 (the Budapester Straße's and the Löbtauer Brücke's
over the tracks), Grimma's 11 (the Pöppelmannbrücke's, a footbridge's over
the Mulde). Under a rail deck, or beside a street the bridge spans, a lamp
lights the ground below and stays there."""

from __future__ import annotations

import math

import numpy as np
import shapely

from .common import OSM_ATTRIBUTION, Tile, feature, owns, write_geojson
from .furniture import BLOCKED, STREETS, Decks, Gate, way_bearing
from .osm import has_extract, read_osm, read_ways, tag

LAMP_H = 5.0  # a post's head (the viewer's lamp-layer.ts LAMP_H)
HUNG_H = 7.0  # a hung lamp's head over the street
HUNG = {"suspended", "wire", "catenary"}  # `support` / `lamp_mount` values
AXIS_M = 2.0  # an untagged lamp this close to a street's centre line may hang
UNTAGGED_REACH_M = 12.0  # ... when facades close both sides within this
TAGGED_REACH_M = 20.0  # a tagged hung lamp's wire reaches a facade this far
CORRIDOR_M = 2.5  # a facade counts within this either side of the wire's line
MAST_M = 6.0  # a mast with no kerb found stands this far out
WALL = {"wall", "wall_mounted"}  # `support` / `lamp_mount` values of a lamp on a facade
WALL_H = 3.5  # a wall lantern's head over the street (Meißen's Domplatz: at the first floor)
WALL_REACH_M = 1.5  # its facade within this of the node (OSM maps most on the outline)
WALL_OUT_M = 0.5  # its head stands this far out of the facade, on its bracket


def hung_tag(other: str | None) -> bool | None:
    """True when the tags hang the lamp, False when they stand it on
    something else (a pole, a wall, the ground), None when they say nothing."""
    values = [tag(other, "support"), tag(other, "lamp_mount")]
    if any(v in HUNG for v in values):
        return True
    return False if any(values) else None


def wall_tag(other: str | None) -> bool:
    """Whether the tags put the lamp on a wall (and not on a wire)."""
    values = [tag(other, "support"), tag(other, "lamp_mount")]
    return any(v in WALL for v in values) and not any(v in HUNG for v in values)


class Facades:
    """The OSM building outlines a lamp's wire or bracket is fixed to."""

    def __init__(self, tile: Tile) -> None:
        geoms, _ = read_osm(tile, "multipolygons", "building IS NOT NULL", ["building"])
        self.buildings = [g for g in geoms if g.geom_type in ("Polygon", "MultiPolygon")]
        self.walls = [g.boundary for g in self.buildings]
        self.tree = shapely.STRtree(self.walls) if self.walls else None
        self.inside = shapely.STRtree(self.buildings) if self.buildings else None

    def bracket(self, p: shapely.Point) -> tuple[list[float], shapely.Point] | None:
        """A wall lantern's facade point (the nearest outline within
        WALL_REACH_M) and its head, WALL_OUT_M out of it on the side no
        building covers; None without a facade there."""
        if self.tree is None or self.inside is None:
            return None
        hit = self.tree.query_nearest(p, max_distance=WALL_REACH_M)
        if len(hit) == 0:
            return None
        wall = self.walls[int(hit[0])]
        if wall.geom_type == "MultiLineString":
            wall = min(wall.geoms, key=p.distance)
        s = wall.project(p)
        q = wall.interpolate(s)
        a, b = wall.interpolate(max(s - 0.5, 0.0)), wall.interpolate(min(s + 0.5, wall.length))
        tx, ty = b.x - a.x, b.y - a.y
        n = math.hypot(tx, ty)
        if n == 0:
            return None
        for nx, ny in ((ty / n, -tx / n), (-ty / n, tx / n)):
            head = shapely.Point(q.x + nx * WALL_OUT_M, q.y + ny * WALL_OUT_M)
            if len(self.inside.query(head, predicate="within")) == 0:
                return [round(q.x, 2), round(q.y, 2)], head
        return None

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
    bracket = facades.bracket(p) if wall_tag(other) else None
    if bracket is not None:
        return bracket[1], {"h": WALL_H, "wall": bracket[0]}
    if on_road:
        kerb = gate.nearest_kerb(p)
        if kerb is None:
            return None
        p = kerb
    return p, {"h": round(lamp_height, 1)}


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
    gate = Gate(tile, Decks.of(tile))
    ways, lines = streets(tile)
    facades = Facades(tile)
    features, hung, on_walls, on_decks = [], 0, 0, 0
    for g, other in zip(geoms, fields["other_tags"], strict=True):
        deck = gate.deck(g)
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
        on_walls += "wall" in props
        features.append(
            feature({"type": "Point", "coordinates": [round(at.x, 1), round(at.y, 1)]}, props)
        )
    write_geojson(tile.out("dlm", f"lamps_{tile.id}.geojson"), features, tile.epsg, OSM_ATTRIBUTION)
    print(
        f"{tile.id}: {len(features)} lamps ({hung} hung across the street, {on_walls} on a"
        f" facade, {on_decks} on bridges)"
    )
