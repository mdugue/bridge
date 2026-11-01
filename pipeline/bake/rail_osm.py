"""The rail layer from OSM: every track OSM maps, one by one, on every site
(rail.py `rails` draws the Basis-DLM's centrelines only where OSM has no
track near them), and where the provider publishes no Basis-DLM (Hamburg,
Berlin) the other three files rail.py writes from the DLM, from the site's
extract instead.

- rails: `railway` = rail, light_rail, subway, narrow_gauge (Hamburg's
  S-Bahn is `light_rail`, its U-Bahn `subway`; the trams are the tram
  layer's) and funicular (`steep`: a Standseilbahn or a Schrägaufzug climbs
  far past a railway's grade, and the build lays it on its own,
  lib/city/levels.ts `STEEP_GRADE`; no catenary), out of tunnels and off the
  underground (a way `covered` for more than 30 m runs under a lid or a
  building, and its rails would lie on the lid's top), with `tracks`,
  `electrified` (1 an overhead contact line, 2 a third rail: Hamburg's S-
  and U-Bahn), OSM's `bridge` and `layer` (the line levels prefer a deck on
  a bridge way, and cut through a lid over a way below ground,
  lib/city/levels.ts), the `gauge` where it is not standard, `paved` where
  the track is set in the paving (`embedded`, or a service track whose both
  sides are paved: a harbour's quays, a factory's yard — no ballast bed
  there), and `m`, the catenary masts OSM maps beside an overhead track —
  each way clipped to the tile, fragments of the same properties merged. A
  yard's every siding is its own way: the DLM's one centreline per line drew
  two tracks for fifteen at Dresden's Hauptbahnhof;
- ballast: those rails on the ground (not on a bridge, not paved), buffered
  by their bed width (4.5 m for one track, 4 m more for each further one);
- bridge decks: every way with a `bridge` tag on a road, path or railway
  (`highway`/`railway`, not a proposal), on its OSM `man_made=bridge`
  outline where it lies on one; else the buffers of the ways of one bridge
  — a carriageway, its pavements, a cycle track — merged into one deck at
  their `width` (or `lanes` × 3.25 m + 2 m, or the kind's width). The deck
  heights, the superstructure, the fairway clearance and Wikidata are
  rail.py's and bridge.py's, unchanged;
- platforms: rail.py's (OSM in either case);
- monorails (`monorails`), in the rails' file as features of their own
  (`mono`: "hanging" where the cars hang under the beam, Dresden's
  Schwebebahn, else "top"): no track, no bed, no deck — a beam over the
  ground with its foot's height per vertex (`bz`), and the viewer stands
  it on supports (rail-layer.ts).

What the DLM's centrelines know that OSM knows too (name, kind, tracks)
comes from the tags; the deck height is measured (DOM1 over the DGM ramp)
either way.
"""

from __future__ import annotations

import math
import re
from collections import defaultdict
from collections.abc import Callable

import numpy as np
import shapely

from .common import Tile, column, feature, label_line, value_at
from .osm import in_tunnel, read_osm, tag

RAILWAYS = ("rail", "light_rail", "subway", "narrow_gauge")
# A funicular (Standseilbahn, Schrägaufzug) is a track like a railway's,
# but steep: its features carry `steep` (the build's grade for it), and a
# deck it runs on is measured within STEEP_DECK_GRADE.
STEEP = ("funicular",)
TRACKED = RAILWAYS + STEEP
STEEP_DECK_GRADE = 1.0
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
    for g, _, other in tracked_ways(tile, margin, every):
        yield g, other


def tracked_ways(tile: Tile, margin: float = 0.001, every: bool = False):
    """(geometry, railway, other_tags) of `rail_ways`: the kind too."""
    kinds = ",".join(f"'{k}'" for k in TRACKED)
    geoms, fields = read_osm(
        tile, "lines", f"railway IN ({kinds})", ["railway", "other_tags"], margin=margin
    )
    for g, railway, other in zip(
        geoms, column(fields, "railway", geoms), column(fields, "other_tags", geoms), strict=True
    ):
        kind = railway or tag(other, "railway")
        if g is None or g.is_empty or kind not in TRACKED:
            continue
        if not every and not drawn(g, other):
            continue
        yield g, kind, other


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


def track_props(other: str | None, electrified: int, paved: bool, steep: bool = False) -> tuple:
    """A way's properties as a grouping key: tracks, electrified, bridge,
    layer, gauge, paved, steep."""
    return (
        tracks_of(other),
        electrified,
        1 if is_bridge(other) else 0,
        layer_of(other),
        gauge_of(other),
        1 if paved else 0,
        1 if steep else 0,
    )


def props_json(key: tuple) -> dict:
    """The feature properties of a grouping key (`track_props`)."""
    tracks, electrified, bridge, layer, gauge, paved, steep = key
    out: dict = {"tracks": tracks, "electrified": electrified, "bridge": bridge}
    if layer:
        out["layer"] = layer
    if abs(gauge - STANDARD_GAUGE) > 0.01:
        out["g"] = gauge
    if paved:
        out["paved"] = 1
    if steep:
        out["steep"] = 1
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
    for g, kind, other in tracked_ways(tile):
        steep = kind in STEEP
        electrified = 0 if steep else electrified_of(other)
        if electrified is None:
            electrified = electrified_near(g) if electrified_near else 0
        for line in shapely.get_parts(g):
            if not isinstance(line, shapely.LineString) or line.length < 0.5:
                continue
            for piece, paved in paving.pieces(line, other):
                key = track_props(other, electrified, paved, steep)
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
        if not f["properties"].get("bridge")
        and not f["properties"].get("paved")
        and not f["properties"].get("mono")
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
    if railway in TRACKED:
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


# A monorail's beam: its foot this far over the ground at the least (m) —
# over a hanging car's 3 m and the headroom below it, or under the beam a
# car rides on top of — sampled every BEAM_STEP_M, read over the whole
# chain of ways within MONORAIL_MARGIN (deg, ~3.5 km) around the tile: two
# neighbours agree on a chain that lies within it from both, as Dresden's
# 274 m Schwebebahn does (the only monorail of the sites). The upper hull
# spans the whole chain, right for a short line; a long one over hills
# would need its spans limited.
HANGING_CLEARANCE_M = 5.5
TOP_CLEARANCE_M = 4.5
BEAM_STEP_M = 2.0
MONORAIL_MARGIN = 0.05
# The beam leaves out samples while every one left out stays within this of
# the straight line that replaces it (in plan and in height, m).
BEAM_TOLERANCE_M = 0.02


def monorail_kind(other: str | None) -> str:
    return "hanging" if tag(other, "monorail") == "hanging" else "top"


def upper_hull(s: list[float], z: list[float]) -> list[float]:
    """The upper convex hull of the points (s, z), s ascending, read back at
    every s: a line stretched over posts of height z — straight across a
    hollow, bent only over a crest."""
    hull: list[int] = []
    for i in range(len(s)):
        while len(hull) >= 2:
            a, b = hull[-2], hull[-1]
            # b lies on or under the chord a→i: no corner of the hull
            if (z[b] - z[a]) * (s[i] - s[a]) <= (z[i] - z[a]) * (s[b] - s[a]):
                hull.pop()
            else:
                break
        hull.append(i)
    out = []
    k = 0
    for i in range(len(s)):
        while k + 1 < len(hull) - 1 and s[hull[k + 1]] <= s[i]:
            k += 1
        a, b = hull[k], hull[min(k + 1, len(hull) - 1)]
        t = 0.0 if s[b] == s[a] else (s[i] - s[a]) / (s[b] - s[a])
        out.append(z[a] + (z[b] - z[a]) * t)
    return out


def _off_chord(a, b, c) -> float:
    """How far b lies off the 3D chord a→c (m)."""
    ax, ay, az = c[0] - a[0], c[1] - a[1], c[2] - a[2]
    bx, by, bz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
    n = ax * ax + ay * ay + az * az
    t = 0.0 if n == 0 else max(0.0, min(1.0, (ax * bx + ay * by + az * bz) / n))
    return math.dist((bx, by, bz), (ax * t, ay * t, az * t))


def beam_samples(
    line: shapely.LineString, ground: Callable[[float, float], float | None], clearance: float
) -> list[tuple[float, float, float]] | None:
    """(x, y, foot height) along a monorail: every BEAM_STEP_M and at its
    vertices, the upper hull of the ground plus the clearance, a sample left
    out while every one left out stays within BEAM_TOLERANCE_M of the line
    that replaces it. None where the ground is unknown along it."""
    stations = sorted(
        {i * BEAM_STEP_M for i in range(int(line.length // BEAM_STEP_M) + 1)}
        | {line.length}
        | {line.project(shapely.Point(c[:2])) for c in line.coords}
    )
    pts = [line.interpolate(d) for d in stations]
    heights = [ground(p.x, p.y) for p in pts]
    if any(h is None for h in heights):
        return None
    feet = upper_hull(stations, [h + clearance for h in heights])  # type: ignore[operator]
    out = [(p.x, p.y, z) for p, z in zip(pts, feet, strict=True)]
    keep = [0]
    for i in range(1, len(out) - 1):
        # out[i] goes while every sample since the last kept one stays near
        # the line from it to the next: checked against only its own chord,
        # the error left out over a long crest adds up
        a, c = out[keep[-1]], out[i + 1]
        if any(_off_chord(a, out[j], c) > BEAM_TOLERANCE_M for j in range(keep[-1] + 1, i + 1)):
            keep.append(i)
    keep.append(len(out) - 1)
    return [out[k] for k in keep]


def _clipped_beam(
    beam: list[tuple[float, float, float]], box, kind: str, tracks: int
) -> list[dict]:
    """A beam's pieces on the tile, each vertex with its foot's height."""
    plan = shapely.LineString([(x, y) for x, y, _ in beam])
    along = [plan.project(shapely.Point(x, y)) for x, y, _ in beam]
    feet = [z for *_, z in beam]

    def foot(d: float) -> float:
        k = max(0, min(len(along) - 2, int(np.searchsorted(along, d, side="right")) - 1))
        a, b = along[k], along[k + 1]
        t = 0.0 if b == a else max(0.0, min(1.0, (d - a) / (b - a)))
        return feet[k] + (feet[k + 1] - feet[k]) * t

    out = []
    for part in shapely.get_parts(shapely.intersection(plan, box)):
        if not isinstance(part, shapely.LineString) or part.length < 0.5:
            continue
        coords = [(x, y) for x, y, *_ in part.coords]
        out.append(
            feature(
                {
                    "type": "LineString",
                    "coordinates": [[round(x, 2), round(y, 2)] for x, y in coords],
                },
                {
                    "mono": kind,
                    "tracks": tracks,
                    "bz": [round(foot(plan.project(shapely.Point(c))), 2) for c in coords],
                },
            )
        )
    return out


def dgm_ground(tile: Tile, bounds) -> Callable[[float, float], float | None]:
    """The site's DGM1 over `bounds` (every tile's, so a beam across a seam
    reads the same ground from either side), as a height lookup."""
    from rasterio.transform import rowcol

    from .rail import mosaic

    dgm, transform = mosaic(sorted((tile.data / "dgm").glob("dgm1_*_tiff/dgm1_*.tif")), bounds)

    def at(x: float, y: float) -> float | None:
        if dgm is None:
            return None
        r, c = rowcol(transform, x, y)
        if not (0 <= r < dgm.shape[0] and 0 <= c < dgm.shape[1]):
            return None
        v = float(dgm[r, c])
        return None if math.isnan(v) else v

    return at


def monorails(tile: Tile) -> list[dict]:
    """The tile's monorails (`railway=monorail`, drawn as `drawn` says): one
    feature per chain of ways of one kind (`monorail_kind`) and `tracks`,
    the beam's line clipped to the tile with its foot's height per vertex
    (`bz`, `beam_samples` over the whole chain, on the DGM)."""
    from .rail import merge_lines

    geoms, fields = read_osm(
        tile, "lines", "railway = 'monorail'", ["other_tags"], margin=MONORAIL_MARGIN
    )
    groups: dict[tuple[str, int], list] = defaultdict(list)
    for g, other in zip(geoms, column(fields, "other_tags", geoms), strict=True):
        if g is None or g.is_empty or not drawn(g, other):
            continue
        key = (monorail_kind(other), tracks_of(other))
        for line in shapely.get_parts(g):
            if isinstance(line, shapely.LineString) and line.length >= 0.5:
                groups[key].append([(x, y) for x, y, *_ in line.coords])
    box = shapely.box(*tile.bounds)
    chains = [
        (kind, tracks, shapely.LineString(chain))
        for (kind, tracks), lines in sorted(groups.items())
        for chain in merge_lines(lines)
    ]
    chains = [c for c in chains if c[2].intersects(box)]
    if not chains:
        return []
    # one read of the DGM for every chain on the tile
    xmin, ymin, xmax, ymax = shapely.MultiLineString([c[2] for c in chains]).bounds
    ground = dgm_ground(tile, (xmin - 5, ymin - 5, xmax + 5, ymax + 5))
    features = []
    for kind, tracks, whole in chains:
        clearance = HANGING_CLEARANCE_M if kind == "hanging" else TOP_CLEARANCE_M
        beam = beam_samples(whole, ground, clearance)
        if beam is not None:
            features += _clipped_beam(beam, box, kind, tracks)
    return features
