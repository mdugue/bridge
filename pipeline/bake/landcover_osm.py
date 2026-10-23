"""OpenStreetMap → the same land-cover class raster, legend and hedge /
tree-row lines as the Basis-DLM bake (landcover.py), for providers that
publish no Basis-DLM in the AdV Shape profile (Hamburg: NAS only; Berlin: a
WFS). The client cannot tell the two apart: the classes and file names are
the same, only the source differs.

Two reads of the extract per tile — areas (`multipolygons`) and lines —
because GDAL's OSM driver scans the whole file for each. Later burns
overwrite earlier ones, water last. Unlike the DLM's areas, which tile the
ground, OSM nests them — a `landuse=residential` block encloses its grass
and its wood — so settlement burns first and the green inside it wins.
"""

from __future__ import annotations

import re

import numpy as np
import shapely

from .common import Tile, column, feature, geometry_json
from .osm import read_osm, read_ways, tag

AREAS = {
    1: {
        "landuse": {
            "meadow",
            "grass",
            "orchard",
            "vineyard",
            "village_green",
            "allotments",
            "cemetery",
        },
        "natural": {"grassland", "heath"},
    },
    2: {"landuse": {"forest"}, "natural": {"wood"}},
    3: {"natural": {"scrub"}},
    # The DLM's settlement areas include parks and sports grounds (sie02).
    4: {
        "landuse": {
            "residential",
            "commercial",
            "industrial",
            "retail",
            "construction",
            "garages",
            "religious",
            "education",
        },
        "leisure": {"park", "garden", "pitch", "playground", "sports_centre"},
    },
    5: {"landuse": {"railway"}},
    8: {"natural": {"water"}, "landuse": {"basin", "reservoir"}},
    9: {"landuse": {"farmland"}},  # arable (landcover.py ARABLE_VEG)
}
# Settlement first: OSM's green areas lie inside it (see the module doc).
BURN_ORDER = (4, 1, 9, 2, 3, 5, 6, 7, 8)
PATHS = {"footway", "path", "cycleway", "steps", "track", "bridleway", "pedestrian"}
# Road half-widths (m) by highway class when no `width` tag says otherwise.
ROAD_HALF_WIDTH = {
    "motorway": 10.0,
    "trunk": 8.0,
    "primary": 6.0,
    "secondary": 5.0,
    "tertiary": 4.0,
    "motorway_link": 4.0,
    "trunk_link": 4.0,
    "primary_link": 4.0,
    "secondary_link": 3.5,
    "residential": 3.0,
    "unclassified": 3.0,
    "living_street": 3.0,
    "service": 2.0,
}
WATERWAY_HALF_WIDTH = {"river": 10.0, "canal": 6.0, "stream": 1.0, "ditch": 0.5, "drain": 0.5}
AREA_COLUMNS = ["landuse", "natural", "leisure", "amenity", "building"]
LINE_COLUMNS = ["highway", "waterway", "railway", "barrier", "other_tags"]


def hidden_water(other_tags: str | None) -> bool:
    """Water out of sight: in a culvert or a tunnel (`read_ways` skips those
    lines already), or under a cover (`covered`) — not drawn, as the DLM's
    piped streams are not (`landcover.stream_buffers`)."""
    if tag(other_tags, "covered") not in (None, "no"):
        return True
    if tag(other_tags, "tunnel") not in (None, "no"):
        return True
    return tag(other_tags, "location") in ("underground", "indoor")


def _width(other_tags: str | None) -> float | None:
    num = re.search(r"\d*\.?\d+", tag(other_tags, "width") or "")
    return float(num.group()) if num else None


# A lane's width (m): a road whose `lanes` counts two or more and that has
# no `width` is that many lanes wide. One lane is a one-way street's count,
# which leaves its parking out: the class's width stands.
LANE_M = 3.25


def lanes(other_tags: str | None) -> int | None:
    """A way's `lanes` (both directions), or None."""
    num = re.match(r"\s*(\d+)", tag(other_tags, "lanes") or "")
    return int(num.group(1)) if num else None


# A one-way main road is mostly one carriageway of a dual one, each mapped
# apart: at its class's full width each half painted the whole road's
# width, the pair twice as wide as it is (Hamburg). Halved, not under 2 m.
DUAL = ("motorway", "trunk", "primary", "secondary", "tertiary")


def one_way(highway: str | None, other_tags: str | None) -> bool:
    """A way drives one way: its `oneway`, a motorway's implied one."""
    value = tag(other_tags, "oneway")
    return value in ("yes", "1", "true", "-1") or (highway == "motorway" and value != "no")


def _road_half(
    highway: str, width: float | None, n: int | None = None, oneway: bool = False
) -> float:
    if width:
        return width / 2
    if n and n >= 2:
        return n * LANE_M / 2
    half = ROAD_HALF_WIDTH[highway]
    return max(half / 2, 2.0) if oneway and highway in DUAL else half


# Rail on its own bed is railway land (5): a tram only where it does not
# run in the carriageway (`embedded`; the roads burn after it and cover the
# rest), and none but mainline rail on a bridge — the ground under a
# viaduct is what it is.
RAIL_HALF_WIDTH = {"rail": 2.5, "light_rail": 2.5, "subway": 2.5, "narrow_gauge": 2.0, "tram": 2.0}


def rail_half(railway: str | None, other_tags: str | None) -> float | None:
    """The half-width a rail way burns as railway land, None for none."""
    half = RAIL_HALF_WIDTH.get(railway or "")
    if half is None or railway == "rail":
        return half
    if tag(other_tags, "bridge") not in (None, "no"):
        return None
    if railway == "tram" and tag(other_tags, "embedded") not in (None, "no"):
        return None
    return half


def road_buffers(tile: Tile) -> list[shapely.Geometry]:
    """The roads the class raster burns as road (7): each carriageway on
    the ground (`read_ways`) at its `width`, else its `lanes` (LANE_M
    each), else at its class's half-width (halved one way, `DUAL`)."""
    kinds = ", ".join(f"'{k}'" for k in ROAD_HALF_WIDTH)
    geoms, fields = read_ways(tile, f"highway IN ({kinds})", ["highway", "other_tags"])
    return [
        shapely.buffer(g, _road_half(h, _width(other), lanes(other), one_way(h, other)))
        for g, h, other in zip(
            geoms,
            column(fields, "highway", geoms),
            column(fields, "other_tags", geoms),
            strict=True,
        )
        if g is not None and h in ROAD_HALF_WIDTH
    ]


def _area_class(values: dict[str, str | None]) -> int | None:
    for cls in (8, 5, 4, 3, 2, 9, 1):  # the most specific first
        for key, wanted in AREAS[cls].items():
            if values.get(key) in wanted:
                return cls
    # Old towns have few landuse polygons: what is built or run by an
    # amenity (schools, hospitals, car parks) reads as settlement, like the
    # DLM's sie02 areas that cover every block.
    if values.get("building") or values.get("amenity"):
        return 4
    return None


def burn_order(tile: Tile) -> tuple[list[tuple[int, list[shapely.Geometry]]], list[dict]]:
    """(class id, geometries) in burn order, and the veg-row features."""
    by_class: dict[int, list[shapely.Geometry]] = {c: [] for c in range(1, 10)}
    where = " OR ".join(f"{c} IS NOT NULL" for c in AREA_COLUMNS)
    geoms, fields = read_osm(tile, "multipolygons", where, [*AREA_COLUMNS, "other_tags"])
    cols = {c: column(fields, c, geoms) for c in AREA_COLUMNS}
    hidden = [hidden_water(t) for t in column(fields, "other_tags", geoms)]
    for i, g in enumerate(geoms):
        cls = _area_class({c: cols[c][i] for c in AREA_COLUMNS})
        if cls is not None and g is not None and not (cls == 8 and hidden[i]):
            by_class[cls].append(g)

    rows: list[dict] = []
    # The tree rows only: OSM's hedges are lowveg.py's (drawn there at their
    # measured height); as veg rows too, every one was drawn twice.
    where = (
        "highway IS NOT NULL OR waterway IS NOT NULL OR railway IS NOT NULL OR "
        "other_tags LIKE '%tree_row%'"
    )
    geoms, fields = read_ways(tile, where, LINE_COLUMNS)
    highway, waterway, railway, _, other = (column(fields, c, geoms) for c in LINE_COLUMNS)
    for i, g in enumerate(geoms):
        if g is None:
            continue
        width = _width(other[i])
        if tag(other[i], "natural") == "tree_row":
            rows += [feature(geometry_json(p), {"kind": "treerow"}) for p in shapely.get_parts(g)]
        elif highway[i] in PATHS:
            by_class[6].append(shapely.buffer(g, width / 2 if width else 1.0))
        elif highway[i] in ROAD_HALF_WIDTH:
            half = _road_half(highway[i], width, lanes(other[i]), one_way(highway[i], other[i]))
            by_class[7].append(shapely.buffer(g, half))
        elif waterway[i] in WATERWAY_HALF_WIDTH:
            if not hidden_water(other[i]):
                half = width / 2 if width else WATERWAY_HALF_WIDTH[waterway[i]]
                by_class[8].append(shapely.buffer(g, half))
        elif (half := rail_half(railway[i], other[i])) is not None:
            by_class[5].append(shapely.buffer(g, half))
    order = [(c, by_class[c]) for c in BURN_ORDER]
    # Clip the veg rows to the tile, like the DLM bake's bbox read.
    box = shapely.box(*tile.bounds)
    rows = [
        feature(geometry_json(p), f["properties"])
        for f in rows
        for p in shapely.get_parts(shapely.intersection(shapely.geometry.shape(f["geometry"]), box))
        if isinstance(p, shapely.LineString) and not p.is_empty
    ]
    return order, rows


def parks(tile: Tile) -> list[shapely.Geometry]:
    """Parks, gardens and cemeteries: where the canopy may plant trees besides
    forest and copse (the DLM's AX_SportFreizeitUndErholungsflaeche)."""
    where = "leisure IN ('park','garden') OR landuse IN ('cemetery','recreation_ground')"
    geoms, _ = read_osm(tile, "multipolygons", where, ["leisure", "landuse"])
    return [g for g in geoms if g is not None]


def stats(raster: np.ndarray) -> str:
    counts = np.bincount(raster.ravel(), minlength=10)
    return ", ".join(f"{c}:{counts[c] / raster.size:.0%}" for c in range(10) if counts[c])
