"""Reading the site's OpenStreetMap extract (a Geofabrik `.osm.pbf`, never a
live API: the bake must be reproducible) through GDAL's OSM driver. Closed
ways arrive in `multipolygons` when they carry an area key, otherwise as
closed lines in `lines`; both are read."""

from __future__ import annotations

import re
from pathlib import Path

import numpy as np
import shapely
from pyproj import Transformer

from .common import Tile, read_layer


def _to_tile(tile: Tile):
    return Transformer.from_crs(4326, tile.epsg, always_xy=True)


def wgs84_bbox(tile: Tile, margin: float = 0.001) -> tuple[float, float, float, float]:
    back = Transformer.from_crs(tile.epsg, 4326, always_xy=True)
    xmin, ymin, xmax, ymax = tile.bounds
    lons, lats = back.transform([xmin, xmax, xmin, xmax], [ymin, ymin, ymax, ymax])
    return min(lons) - margin, min(lats) - margin, max(lons) + margin, max(lats) + margin


def has_extract(tile: Tile, what: str) -> bool:
    """Whether the site has an extract; if not, say what is skipped. A step
    without one leaves its committed file alone rather than emptying it."""
    if tile.osm_extract() is None:
        print(f"{tile.id}: no OSM extract at {tile.osm} — skipping {what} (`bun run fetch`)")
        return False
    return True


def read_osm(
    tile: Tile, layer: str, where: str, columns: list[str], margin: float = 0.001
) -> tuple[np.ndarray, dict[str, np.ndarray]]:
    """Features of one OSM layer near the tile (a `margin` in degrees around
    it), reprojected to the tile's CRS."""
    pbf = tile.osm_extract()
    if pbf is None:
        raise SystemExit(f"no OSM extract at {tile.osm} — run `bun run fetch`")
    geoms, fields = read_layer(
        Path(pbf), wgs84_bbox(tile, margin), where=where, columns=columns, layer=layer
    )
    project = _to_tile(tile)
    geoms = shapely.transform(
        geoms, lambda xy: np.column_stack(project.transform(xy[:, 0], xy[:, 1]))
    )
    return geoms, fields


def tag(other_tags: str | None, key: str) -> str | None:
    """A value from GDAL's `other_tags` hstore string."""
    if not other_tags:
        return None
    m = re.search(rf'"{re.escape(key)}"=>"([^"]*)"', other_tags)
    return m.group(1) if m else None


def in_tunnel(other_tags: str | None) -> bool:
    """A way in a tunnel or tagged underground. A line on a negative `layer`
    alone may run in an open cutting, so it does not count here."""
    if tag(other_tags, "tunnel") not in (None, "no", "building_passage"):
        return True
    return tag(other_tags, "location") == "underground"


def below_ground(other_tags: str | None) -> bool:
    """A feature under the street: in a tunnel, `location=underground`, or on
    a negative `layer` or `level` (a U-Bahn platform, a station's
    concourse). What is drawn on the terrain skips these — a subway drawn at
    street level reads as broken track (Munich's Marienplatz). A
    `building_passage` is at street level and stays."""
    if in_tunnel(other_tags):
        return True
    return any((tag(other_tags, k) or "").strip().startswith("-") for k in ("layer", "level"))
