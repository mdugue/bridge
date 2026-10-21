"""The rail layer from OSM: every track OSM maps, one by one, on every site
(rail.py `rails` draws the Basis-DLM's centrelines only where OSM has no
track near them), and where the provider publishes no Basis-DLM (Hamburg,
Berlin) the other three files rail.py writes from the DLM, from the site's
extract instead.

- rails: `railway` = rail, light_rail, subway, narrow_gauge (Hamburg's
  S-Bahn is `light_rail`, its U-Bahn `subway`; the trams are the tram
  layer's), out of tunnels and off the underground (a way `covered` for
  more than 30 m runs under a lid or a building, and its rails would lie on
  the lid's top), with `tracks`, `electrified` (1 an overhead contact line,
  2 a third rail: Hamburg's S- and U-Bahn), OSM's `bridge` and `layer` (the
  line levels prefer a deck on a bridge way, and cut through a lid over a
  way below ground, lib/city/levels.ts), the `gauge` where it is not
  standard, `paved` where the track is set in the paving (`embedded`, or a
  service track whose both sides are paved: a harbour's quays, a factory's
  yard — no ballast bed there), and `m`, the catenary masts OSM maps beside
  an overhead track — each way clipped to the tile, fragments of the same
  properties merged. A yard's every siding is its own way: the DLM's one
  centreline per line drew two tracks for fifteen at Dresden's Hauptbahnhof;
- ballast: those rails on the ground (not on a bridge, not paved), buffered
  by their bed width (4.5 m for one track, 4 m more for each further one);
- bridge decks: every way with a `bridge` tag on a road, path or railway
  (`highway`/`railway`, not a proposal), on its OSM `man_made=bridge`
  outline where it lies on one; else the buffers of the ways of one bridge
  — a carriageway, its pavements, a cycle track — merged into one deck at
  their `width` (or `lanes` × 3.25 m + 2 m, or the kind's width). The deck
  heights, the superstructure, the fairway clearance and Wikidata are
  rail.py's and bridge.py's, unchanged;
- platforms: rail.py's (OSM in either case).

What the DLM's centrelines know that OSM knows too (name, kind, tracks)
comes from the tags; the deck height is measured (DOM1 over the DGM ramp)
either way.
"""

from __future__ import annotations

import math
import re
from collections import defaultdict
from collections.abc import Callable

import shapely

from .common import Tile, column, feature, label_line, value_at
from .osm import in_tunnel, read_osm, tag

RAILWAYS = ("rail", "light_rail", "subway", "narrow_gauge")
PATHS = {"footway", "path", "cycleway", "pedestrian", "steps", "bridleway", "corridor"}
NOT_BUILT = {"proposed", "construction", "abandoned", "disused", "razed", "platform"}
BED_ONE, BED_MORE = 4.5, 4.0  # ballast bed width: one track, each further one (m)
LANE_M, VERGE_M = 3.25, 2.0
MIN_BRIDGE_M = 4.0  # shorter `bridge` ways are culverts and kerbs
# how far around the tile the networks are read for classifying decks (deg)
NETWORK_MARGIN = 0.012
# A way `covered` longer than this runs under a lid or a building (m): a
# shorter one passes under a footbridge or a canopy.
COVERED_MAX_M = 30.0
# Overhead lines and third rails (OSM `electrified`; `yes` says no more, and
# a German main line's is a contact line).
OVERHEAD = {"contact_line", "yes"}
THIRD_RAIL = {"rail", "4th_rail", "ground-level_power_supply"}
STANDARD_GAUGE = 1.435
# Paved track (no ballast bed): the class raster (landcover.ts ids) read
# SIDE_M either side of a service track — the built-up ground, a path, a
# road, a quay's water beside it — a majority over BED_WINDOW_M, no stretch
# shorter than BED_MIN_M. A main line runs on its bed whatever lies beside
# it (a residential street, a station forecourt): only `embedded` says
# otherwise there.
PAVED_CLASSES = {4, 6, 7}
WATER_CLASS = 8
SIDE_M = 4.0
BED_STEP_M = 4.0
BED_WINDOW_M = 20.0
BED_MIN_M = 20.0
SERVICE = {"spur", "siding", "yard"}
# A catenary mast (OSM `power=catenary_mast`) holds the overhead track
# nearest it, at most this far (m).
MAST_REACH_M = 12.0
MAST_WHERE = 'other_tags LIKE \'%"power"=>"catenary_mast"%\''


def rail_ways(tile: Tile, margin: float = 0.001, every: bool = False):
    """(geometry, other_tags) of the rails near the tile that are drawn:
    above ground, not in a tunnel or underground, not `covered` for longer
    than COVERED_MAX_M. `every`: all of them, tunnels too (what OSM maps
    where the DLM has a line)."""
    kinds = ",".join(f"'{k}'" for k in RAILWAYS)
    geoms, fields = read_osm(
        tile, "lines", f"railway IN ({kinds})", ["railway", "other_tags"], margin=margin
    )
    for g, railway, other in zip(
        geoms, column(fields, "railway", geoms), column(fields, "other_tags", geoms), strict=True
    ):
        if g is None or g.is_empty or (railway or tag(other, "railway")) not in RAILWAYS:
            continue
        if not every and not drawn(g, other):
            continue
        yield g, other


def drawn(g: shapely.Geometry, other: str | None) -> bool:
    """Whether a rail way is drawn: not in a tunnel (`location=underground`
    too), not `covered` for longer than COVERED_MAX_M."""
    if in_tunnel(other):
        return False
    return tag(other, "covered") in (None, "no") or g.length <= COVERED_MAX_M


def tracks_of(other: str | None) -> int:
    m = re.match(r"\d+", tag(other, "tracks") or "")
    return max(1, min(int(m.group()), 8)) if m else 1


def electrified_of(other: str | None) -> int | None:
    """1 an overhead contact line, 2 a third rail, 0 none; None untagged
    (the DLM's line beside it may know)."""
    value = tag(other, "electrified")
    if value is None:
        return None
    if value in THIRD_RAIL:
        return 2
    return 0 if value == "no" else 1


def is_bridge(other: str | None) -> bool:
    return tag(other, "bridge") not in (None, "no")


def layer_of(other: str | None) -> int:
    m = re.match(r"-?\d+", (tag(other, "layer") or "0").strip())
    return int(m.group()) if m else 0


def gauge_of(other: str | None) -> float:
    """The track gauge (m) OSM maps (`gauge` in mm), standard gauge when
    untagged or implausible."""
    m = re.match(r"\d+", (tag(other, "gauge") or "").strip())
    if not m or not 600 <= int(m.group()) <= 1700:
        return STANDARD_GAUGE
    return int(m.group()) / 1000


class Paving:
    """Where a track is set in the paving rather than on a ballast bed:
    OSM's `embedded` along the whole way, or along a service track (`service`
    spur, siding or yard; `usage=industrial`) wherever the class raster SIDE_M
    either side of it is paved (`PAVED_CLASSES`, or a quay's water on one
    side) — Hamburg's harbour spurs ran on 4.5 m of raised ballast across
    the quays. Never on a bridge or above the ground's level (`layer` > 0).
    Without a class raster every track is on its bed."""

    def __init__(self, tile: Tile) -> None:
        self.bounds = tile.bounds
        self.cls = tile.classes()

    def side(self, line: shapely.LineString, x: float, y: float) -> str | None:
        """'paved' or 'ballast' at a point of the line; None off the tile."""
        if self.cls is None:
            return None
        s = line.project(shapely.Point(x, y))
        a = line.interpolate(max(s - 1.0, 0.0))
        b = line.interpolate(min(s + 1.0, line.length))
        dx, dy = b.x - a.x, b.y - a.y
        n = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / n * SIDE_M, dx / n * SIDE_M
        sides = [value_at(self.cls, self.bounds, x + k * nx, y + k * ny) for k in (1, -1)]
        if any(c is None for c in sides):
            return None
        if all(c in PAVED_CLASSES | {WATER_CLASS} for c in sides) and any(
            c in PAVED_CLASSES for c in sides
        ):
            return "paved"
        return "ballast"

    def pieces(
        self, line: shapely.LineString, other: str | None
    ) -> list[tuple[shapely.LineString, bool]]:
        """The line cut where its bed changes: [(piece, paved)]."""
        if tag(other, "embedded") not in (None, "no"):
            return [(line, True)]
        service = tag(other, "service") in SERVICE or tag(other, "usage") == "industrial"
        # on a bridge or above the ground's level the class raster is the
        # street under the track (Dresden's Hauptbahnhof)
        raised = is_bridge(other) or layer_of(other) > 0
        if self.cls is None or not service or raised or line.length < BED_MIN_M:
            return [(line, False)]
        return [
            (piece, label == "paved")
            for piece, label in label_line(
                line,
                lambda x, y: self.side(line, x, y),
                step=BED_STEP_M,
                window=BED_WINDOW_M,
                min_run=BED_MIN_M,
                order=("ballast", "paved"),
            )
        ]


def track_props(other: str | None, electrified: int, paved: bool) -> tuple:
    """A way's properties as a grouping key: tracks, electrified, bridge,
    layer, gauge, paved."""
    return (
        tracks_of(other),
        electrified,
        1 if is_bridge(other) else 0,
        layer_of(other),
        gauge_of(other),
        1 if paved else 0,
    )


def props_json(key: tuple) -> dict:
    """The feature properties of a grouping key (`track_props`)."""
    tracks, electrified, bridge, layer, gauge, paved = key
    out: dict = {"tracks": tracks, "electrified": electrified, "bridge": bridge}
    if layer:
        out["layer"] = layer
    if abs(gauge - STANDARD_GAUGE) > 0.01:
        out["g"] = gauge
    if paved:
        out["paved"] = 1
    return out


def rails(
    tile: Tile,
    electrified_near: Callable[[shapely.Geometry], int] | None = None,
) -> list[dict]:
    """The tile's tracks, one feature per chain of ways with the same
    properties (`track_props`), clipped to the tile. `electrified_near`
    says what an untagged way is (the DLM's line beside it); none: 0."""
    from .rail import merge_lines

    box = shapely.box(*tile.bounds)
    paving = Paving(tile)
    groups: dict[tuple, list] = defaultdict(list)
    for g, other in rail_ways(tile):
        electrified = electrified_of(other)
        if electrified is None:
            electrified = electrified_near(g) if electrified_near else 0
        for line in shapely.get_parts(g):
            if not isinstance(line, shapely.LineString) or line.length < 0.5:
                continue
            for piece, paved in paving.pieces(line, other):
                key = track_props(other, electrified, paved)
                for part in shapely.get_parts(shapely.intersection(piece, box)):
                    # (a sliver along the tile's edge is the neighbour's)
                    if isinstance(part, shapely.LineString) and part.length >= 0.5:
                        groups[key].append([(x, y) for x, y, *_ in part.coords])
    features = []
    for key, lines in sorted(groups.items()):
        for chain in merge_lines(lines):
            features.append(
                feature(
                    {
                        "type": "LineString",
                        "coordinates": [[round(x, 2), round(y, 2)] for x, y in chain],
                    },
                    props_json(key),
                )
            )
    return features


def claimed(tile: Tile, reach: float) -> shapely.Geometry | None:
    """Where OSM maps a track (every one, in tunnels too), grown by `reach`:
    the DLM's centreline there is OSM's tracks, drawn one by one (or a
    tunnel the DLM does not know)."""
    lines = [g for g, _ in rail_ways(tile, every=True)]
    return shapely.union_all([shapely.buffer(g, reach) for g in lines]) if lines else None


def masts(tile: Tile, features: list[dict]) -> None:
    """The catenary masts OSM maps (`power=catenary_mast`), each on the
    overhead track nearest it (≤ MAST_REACH_M): the track's `m` gets
    [station along it, offset to its left] (m) per mast. The viewer stands
    the mapped ones and fills the gaps (app/_components/catenary-layer.ts).
    A mast near a tram track is the tram's (tram.py `masts`, which draws
    it): it holds no main line's wire."""
    from .tram import MAST_NEAR_M

    overhead = [
        (i, shapely.LineString(f["geometry"]["coordinates"]))
        for i, f in enumerate(features)
        if f["properties"].get("electrified") == 1
    ]
    if not overhead:
        return
    geoms, _ = read_osm(tile, "points", MAST_WHERE, ["other_tags"], margin=0.0)
    trams, _ = read_osm(tile, "lines", "railway = 'tram'", ["railway"])
    tram_tree = shapely.STRtree([g for g in trams if g is not None]) if len(trams) else None
    tree = shapely.STRtree([line for _, line in overhead])
    found: dict[int, list] = defaultdict(list)
    for p in geoms:
        if p is None or p.geom_type != "Point":
            continue
        if tram_tree is not None and len(
            tram_tree.query(p, predicate="dwithin", distance=MAST_NEAR_M)
        ):
            continue
        near = tree.query_nearest(p, max_distance=MAST_REACH_M)
        if len(near) == 0:
            continue
        i, line = overhead[int(near[0])]
        s = line.project(p)
        a = line.interpolate(max(s - 1.0, 0.0))
        b = line.interpolate(min(s + 1.0, line.length))
        on = line.interpolate(s)
        cross = (b.x - a.x) * (p.y - on.y) - (b.y - a.y) * (p.x - on.x)
        offset = math.copysign(p.distance(on), cross)
        found[i].append([round(s, 1), round(offset, 2)])
    for i, stations in found.items():
        features[i]["properties"]["m"] = sorted(stations)


def bed(line: shapely.Geometry, tracks: int) -> shapely.Geometry:
    """A line's ballast bed: BED_ONE wide for one track, BED_MORE more for
    each further one."""
    return shapely.buffer(line, (BED_ONE + BED_MORE * (tracks - 1)) / 2, cap_style="flat")


def beds(features: list[dict]) -> list[shapely.Geometry]:
    """The beds of the baked tracks on the ground: not on a bridge (OSM's
    tag; the DLM's lines carry none), not set in the paving."""
    return [
        bed(shapely.geometry.shape(f["geometry"]), f["properties"].get("tracks", 1))
        for f in features
        if not f["properties"].get("bridge") and not f["properties"].get("paved")
    ]


def polygons(area: shapely.Geometry) -> list[dict]:
    """An area's polygons of a square metre or more, as features."""
    return [
        feature(shapely.geometry.mapping(p))
        for p in shapely.get_parts(area)
        if isinstance(p, shapely.Polygon) and p.area >= 1.0
    ]


def ballast(tile: Tile, features: list[dict]) -> list[dict]:
    """The rails' beds on the ground (`beds`), one non-overlapping surface."""
    found = beds(features)
    if not found:
        return []
    return polygons(shapely.intersection(shapely.union_all(found), shapely.box(*tile.bounds)))


def width_of(other: str | None, kind: str) -> float | None:
    """A way's mapped width: `width`, else `lanes` × 3.25 m + verges."""
    m = re.match(r"\d+(\.\d+)?", (tag(other, "width") or "").strip())
    if m and 1.0 <= float(m.group()) <= 60.0:
        return float(m.group())
    lanes = re.match(r"\d+", tag(other, "lanes") or "")
    if lanes and kind == "road":
        return int(lanes.group()) * LANE_M + VERGE_M
    return None


def kind_of(highway: str | None, railway: str | None) -> str | None:
    if railway in RAILWAYS:
        return "rail"
    if not highway or highway in NOT_BUILT:
        return None
    return "path" if highway in PATHS else "road"


def level_of(other: str | None) -> int:
    m = re.match(r"-?\d+", tag(other, "layer") or "1")
    return int(m.group()) if m else 1


def bridge_lines(tile: Tile) -> list[tuple]:
    """(geometry, name, kind, width, level) of every bridge way on the tile."""
    geoms, fields = read_osm(
        tile,
        "lines",
        "(highway IS NOT NULL OR railway IS NOT NULL) AND other_tags LIKE '%\"bridge\"=>%'",
        ["highway", "railway", "name", "other_tags"],
        margin=0.0,
    )
    box = shapely.box(*tile.bounds)
    out = []
    for g, highway, railway, name, other in zip(
        geoms,
        column(fields, "highway", geoms),
        column(fields, "railway", geoms),
        column(fields, "name", geoms),
        column(fields, "other_tags", geoms),
        strict=True,
    ):
        if g is None or g.is_empty or not is_bridge(other) or in_tunnel(other):
            continue
        kind = kind_of(highway, railway)
        if kind is None or g.length < MIN_BRIDGE_M:
            continue
        if not g.intersects(box):
            continue
        label = tag(other, "bridge:name") or name or None
        out.append((g, label, kind, width_of(other, kind), level_of(other)))
    return out


def footprints(tile: Tile) -> list:
    """The OSM bridge outlines (`man_made=bridge` areas) on the tile."""
    geoms, _ = read_osm(tile, "multipolygons", "man_made = 'bridge'", ["man_made"], margin=0.0)
    box = shapely.box(*tile.bounds)
    return [g for g in geoms if g is not None and not g.is_empty and g.intersects(box)]


def networks(tile: Tile) -> dict[str, list]:
    """The rail, road and path centrelines around the tile, for classifying
    an outline no way runs on (rail.py `Ground.classify`)."""
    geoms, fields = read_osm(
        tile,
        "lines",
        "highway IS NOT NULL OR railway IS NOT NULL",
        ["highway", "railway"],
        margin=NETWORK_MARGIN,
    )
    out: dict[str, list] = {"rail": [], "road": [], "path": []}
    for g, highway, railway in zip(
        geoms, column(fields, "highway", geoms), column(fields, "railway", geoms), strict=True
    ):
        kind = kind_of(highway, railway)
        if g is not None and kind in out:
            out[kind].append(g)
    return out


# A passage under a deck (bridge.py `way_passages`) is as wide as the way
# it opens, plus a margin: its mapped `width`, else its `lanes` (3.2 m
# each), else a footway's 2.5 m or its class's carriageway.
PASSAGE_LANE_HALF = 1.6
PASSAGE_PATH_HALF = 1.25
PASSAGE_MARGIN = 0.5
FOOTWAYS = PATHS - {"pedestrian"}


def passage_half(highway: str | None, other: str | None) -> float:
    """The half-width a passage under a deck opens for a way (m)."""
    from .landcover_osm import ROAD_HALF_WIDTH

    m = re.match(r"\d+(\.\d+)?", (tag(other, "width") or "").strip())
    if m and 1.0 <= float(m.group()) <= 60.0:
        return float(m.group()) / 2 + PASSAGE_MARGIN
    lanes = re.match(r"\d+", tag(other, "lanes") or "")
    if lanes and 1 <= int(lanes.group()) <= 10:
        return int(lanes.group()) * PASSAGE_LANE_HALF + PASSAGE_MARGIN
    if highway in FOOTWAYS:
        return PASSAGE_PATH_HALF + PASSAGE_MARGIN
    return ROAD_HALF_WIDTH.get(highway or "", 3.0) + PASSAGE_MARGIN


def under_ways(tile: Tile) -> list[tuple[shapely.Geometry, float]]:
    """The highways a deck may pass over, around the tile: every way on the
    ground (no `bridge`, not in a tunnel, built), with its passage
    half-width (`passage_half`)."""
    geoms, fields = read_osm(
        tile, "lines", "highway IS NOT NULL", ["highway", "other_tags"], margin=NETWORK_MARGIN
    )
    out = []
    for g, highway, other in zip(
        geoms, column(fields, "highway", geoms), column(fields, "other_tags", geoms), strict=True
    ):
        if g is None or g.is_empty or highway in NOT_BUILT or is_bridge(other) or in_tunnel(other):
            continue
        if highway == "steps":
            continue  # a flight climbs the bank to the bridge, it passes under nothing
        out.append((g, passage_half(highway, other)))
    return out
