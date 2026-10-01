"""The rail layer from OSM, where the provider publishes no Basis-DLM
(Hamburg, Berlin): the same four files rail.py writes from the DLM, from
the site's extract instead.

- rails: `railway` = rail, light_rail, subway, narrow_gauge (Hamburg's
  S-Bahn is `light_rail`, its U-Bahn `subway`; the trams are the tram
  layer's), out of tunnels and off the underground, with `tracks` and
  `electrified` — each way clipped to the tile, fragments merged;
- ballast: those rails on the ground (not on a bridge), buffered by their
  bed width (4.5 m for one track, 4 m more for each further one);
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

import re
from collections import defaultdict

import shapely

from .common import Tile, column, feature
from .osm import in_tunnel, read_osm, tag

RAILWAYS = ("rail", "light_rail", "subway", "narrow_gauge")
PATHS = {"footway", "path", "cycleway", "pedestrian", "steps", "bridleway", "corridor"}
NOT_BUILT = {"proposed", "construction", "abandoned", "disused", "razed", "platform"}
BED_ONE, BED_MORE = 4.5, 4.0  # ballast bed width: one track, each further one (m)
LANE_M, VERGE_M = 3.25, 2.0
MIN_BRIDGE_M = 4.0  # shorter `bridge` ways are culverts and kerbs
# how far around the tile the networks are read for classifying decks (deg)
NETWORK_MARGIN = 0.012


def rail_ways(tile: Tile, margin: float = 0.001):
    """(geometry, other_tags) of the rails above ground near the tile."""
    kinds = ",".join(f"'{k}'" for k in RAILWAYS)
    geoms, fields = read_osm(
        tile, "lines", f"railway IN ({kinds})", ["railway", "other_tags"], margin=margin
    )
    for g, railway, other in zip(
        geoms, column(fields, "railway", geoms), column(fields, "other_tags", geoms), strict=True
    ):
        if g is None or g.is_empty or (railway or tag(other, "railway")) not in RAILWAYS:
            continue
        if in_tunnel(other) or tag(other, "location") == "underground":
            continue
        yield g, other


def tracks_of(other: str | None) -> int:
    m = re.match(r"\d+", tag(other, "tracks") or "")
    return max(1, min(int(m.group()), 8)) if m else 1


def electrified_of(other: str | None) -> int:
    return 0 if (tag(other, "electrified") or "no") == "no" else 1


def is_bridge(other: str | None) -> bool:
    return tag(other, "bridge") not in (None, "no")


def rails(tile: Tile) -> list[dict]:
    from .rail import merge_lines

    box = shapely.box(*tile.bounds)
    groups: dict[tuple[int, int], list] = defaultdict(list)
    for g, other in rail_ways(tile):
        key = (tracks_of(other), electrified_of(other))
        for part in shapely.get_parts(shapely.intersection(g, box)):
            if isinstance(part, shapely.LineString) and len(part.coords) >= 2:
                groups[key].append([(x, y) for x, y, *_ in part.coords])
    features = []
    for (tracks, electrified), lines in sorted(groups.items()):
        for chain in merge_lines(lines):
            features.append(
                feature(
                    {
                        "type": "LineString",
                        "coordinates": [[round(x, 2), round(y, 2)] for x, y in chain],
                    },
                    {"tracks": tracks, "electrified": electrified},
                )
            )
    return features


def ballast(tile: Tile) -> list[dict]:
    """The rails' beds on the ground, one non-overlapping surface."""
    beds = [
        shapely.buffer(g, (BED_ONE + BED_MORE * (tracks_of(other) - 1)) / 2, cap_style="flat")
        for g, other in rail_ways(tile)
        if not is_bridge(other)
    ]
    if not beds:
        return []
    area = shapely.intersection(shapely.union_all(beds), shapely.box(*tile.bounds))
    return [
        feature(shapely.geometry.mapping(p))
        for p in shapely.get_parts(area)
        if isinstance(p, shapely.Polygon) and p.area >= 1.0
    ]


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
