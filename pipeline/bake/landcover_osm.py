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
from .osm import read_osm, tag

AREAS = {
    1: {
        "landuse": {"farmland", "meadow", "grass", "orchard", "vineyard", "village_green"},
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
            "cemetery",
            "garages",
            "religious",
            "education",
        },
        "leisure": {"park", "garden", "pitch", "playground", "sports_centre"},
    },
    5: {"landuse": {"railway"}},
    8: {"natural": {"water"}, "landuse": {"basin", "reservoir"}},
}
# Settlement first: OSM's green areas lie inside it (see the module doc).
BURN_ORDER = (4, 1, 2, 3, 5, 6, 7, 8)
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


def _width(other_tags: str | None) -> float | None:
    num = re.search(r"\d*\.?\d+", tag(other_tags, "width") or "")
    return float(num.group()) if num else None


def _area_class(values: dict[str, str | None]) -> int | None:
    for cls in (8, 5, 4, 3, 2, 1):  # the most specific first
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
    by_class: dict[int, list[shapely.Geometry]] = {c: [] for c in range(1, 9)}
    where = " OR ".join(f"{c} IS NOT NULL" for c in AREA_COLUMNS)
    geoms, fields = read_osm(tile, "multipolygons", where, AREA_COLUMNS)
    cols = {c: column(fields, c, geoms) for c in AREA_COLUMNS}
    for i, g in enumerate(geoms):
        cls = _area_class({c: cols[c][i] for c in AREA_COLUMNS})
        if cls is not None and g is not None:
            by_class[cls].append(g)

    rows: list[dict] = []
    where = (
        "highway IS NOT NULL OR waterway IS NOT NULL OR railway IS NOT NULL OR "
        "barrier = 'hedge' OR other_tags LIKE '%tree_row%'"
    )
    geoms, fields = read_osm(tile, "lines", where, LINE_COLUMNS)
    highway, waterway, railway, barrier, other = (column(fields, c, geoms) for c in LINE_COLUMNS)
    for i, g in enumerate(geoms):
        if g is None:
            continue
        width = _width(other[i])
        if barrier[i] == "hedge" or tag(other[i], "natural") == "tree_row":
            kind = "hedge" if barrier[i] == "hedge" else "treerow"
            rows += [feature(geometry_json(p), {"kind": kind}) for p in shapely.get_parts(g)]
        elif highway[i] in PATHS:
            by_class[6].append(shapely.buffer(g, width / 2 if width else 1.0))
        elif highway[i] in ROAD_HALF_WIDTH:
            by_class[7].append(
                shapely.buffer(g, width / 2 if width else ROAD_HALF_WIDTH[highway[i]])
            )
        elif waterway[i] in WATERWAY_HALF_WIDTH:
            half = width / 2 if width else WATERWAY_HALF_WIDTH[waterway[i]]
            by_class[8].append(shapely.buffer(g, half))
        elif railway[i] == "rail":
            by_class[5].append(shapely.buffer(g, 2.5))
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
    counts = np.bincount(raster.ravel(), minlength=9)
    return ", ".join(f"{c}:{counts[c] / raster.size:.0%}" for c in range(9) if counts[c])
