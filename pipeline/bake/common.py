"""What every bake shares: the tile, the canonical raw layout, reading vector
layers without geopandas, and the GeoJSON the viewer reads."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pyogrio.raw
import rasterio
import shapely
from PIL import Image
from rasterio.transform import from_bounds

OSM_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)"


@dataclass(frozen=True)
class Tile:
    """One site tile: its id (the file-name key), extent and CRS, and where
    its inputs and outputs live. The canonical raw layout is what an ingest
    adapter (ingest_sn.py) writes: `<raw>/{dgm1,dom1,dop}/<tile>.tif`,
    `<raw>/dlm/*.shp` (AdV Shape profile), `<raw>/osm/*.osm.pbf`."""

    id: str
    bounds: tuple[float, float, float, float]
    epsg: int
    raw: Path
    data: Path

    @property
    def size(self) -> tuple[float, float]:
        xmin, ymin, xmax, ymax = self.bounds
        return xmax - xmin, ymax - ymin

    def transform(self, px: int):
        """The affine transform of a px × px raster over the tile."""
        return from_bounds(*self.bounds, px, px)

    def raw_raster(self, product: str) -> Path:
        return self.raw / product / f"{self.id}.tif"

    @property
    def dlm(self) -> Path:
        return self.raw / "dlm"

    @property
    def dgm(self) -> Path:
        return self.data / "dgm" / f"dgm1_{self.id}_tiff" / f"dgm1_{self.id}.tif"

    def out(self, folder: str, name: str) -> Path:
        path = self.data / folder / name
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def has_dlm(self, what: str) -> bool:
        """Whether the Basis-DLM is there; if not, say what is skipped. A step
        without it leaves its committed files alone rather than emptying them."""
        if not any(self.dlm.glob("*.shp")):
            print(f"{self.id}: no Basis-DLM under {self.dlm} — skipping {what}")
            return False
        return True

    def classes(self, tile_id: str | None = None) -> np.ndarray | None:
        """The committed class raster (lib/city/landcover.ts ids, row 0 =
        north) of this tile or of `tile_id` beside it; None when it is not
        baked yet. Read with `value_at` / `pixel_of`."""
        path = self.data / "dlm" / f"landcover_{tile_id or self.id}.png"
        return np.asarray(Image.open(path).convert("L")) if path.exists() else None

    def neighbours(self) -> list[tuple[str, tuple[float, float, float, float]]]:
        """Every committed tile of the site (its DGM on disk), this one
        included, as (id, bounds): what a seam-aware step reads beyond its
        edge."""
        found = []
        for tif in sorted((self.data / "dgm").glob("dgm1_*_tiff/dgm1_*.tif")):
            tid = tif.stem.removeprefix("dgm1_")
            with rasterio.open(tif) as ds:
                b = ds.bounds
            found.append((tid, (b.left, b.bottom, b.right, b.top)))
        return found

    def osm_extract(self) -> Path | None:
        found = sorted((self.raw / "osm").glob("*.osm.pbf"), key=lambda p: p.stat().st_mtime)
        return found[-1] if found else None


def owns(bounds: tuple[float, float, float, float], x: float, y: float) -> bool:
    """Whether a tile owns the point: west and south edges in, east and north
    out, so a point on a seam belongs to exactly one tile (the viewer's
    `ownsPoint`, lib/city/tileset.ts)."""
    xmin, ymin, xmax, ymax = bounds
    return xmin <= x < xmax and ymin <= y < ymax


def overlaps(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> bool:
    """Whether two extents overlap (touching edges do not)."""
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def pixel_of(
    shape: tuple[int, ...], bounds: tuple[float, float, float, float], x: float, y: float
) -> tuple[int, int] | None:
    """The (row, column) of a raster of `shape` laid over `bounds` (row 0 =
    north) under a point; None off it (the half-open extent of `owns`)."""
    if not owns(bounds, x, y):
        return None
    xmin, ymin, xmax, ymax = bounds
    h, w = shape[0], shape[1]
    c = min(int((x - xmin) / (xmax - xmin) * w), w - 1)
    r = min(int((ymax - y) / (ymax - ymin) * h), h - 1)
    return r, c


def value_at(
    raster: np.ndarray, bounds: tuple[float, float, float, float], x: float, y: float
) -> int | None:
    """The raster's value under a point (see `pixel_of`); None off it."""
    at = pixel_of(raster.shape, bounds, x, y)
    return None if at is None else int(raster[at])


def read_layer(
    path: Path,
    bbox: tuple[float, float, float, float],
    where: str | None = None,
    columns: list[str] | None = None,
    layer: str | None = None,
) -> tuple[np.ndarray, dict[str, np.ndarray]]:
    """Features intersecting `bbox` (not clipped) as shapely geometries plus
    their attribute columns. Missing file → nothing."""
    if not path.exists():
        return np.array([], dtype=object), {}
    # An attribute filter only sees the columns that are read: with a
    # `where`, read them all unless the caller names some.
    wanted = columns if columns is not None else (None if where else [])
    meta, _, wkb, fields = pyogrio.raw.read(
        path, layer=layer, bbox=bbox, where=where, columns=wanted
    )
    geoms = shapely.from_wkb(wkb) if wkb is not None else np.array([], dtype=object)
    return geoms, dict(zip(meta["fields"], fields, strict=True))


def column(fields: dict[str, np.ndarray], name: str, geoms: np.ndarray) -> list:
    """One attribute column, or Nones when the layer has no such field —
    never shorter than the geometries it is zipped with."""
    values = fields.get(name)
    return list(values) if values is not None else [None] * len(geoms)


def crs_member(epsg: int) -> dict:
    return {"type": "name", "properties": {"name": f"urn:ogc:def:crs:EPSG::{epsg}"}}


def round_coords(coords, digits: int = 2):
    """Nested coordinate lists rounded (the committed files keep centimetres)."""
    if coords and isinstance(coords[0], (int, float)):
        return [round(float(c), digits) for c in coords[:2]]
    return [round_coords(c, digits) for c in coords]


def feature(geometry: dict, properties: dict | None = None) -> dict:
    return {"type": "Feature", "properties": properties or {}, "geometry": geometry}


def write_geojson(
    path: Path, features: list[dict], epsg: int, attribution: str | None = None
) -> None:
    """A FeatureCollection in the projected CRS (the viewer never reprojects),
    with the named-CRS member and, for OSM-derived data, the credit."""
    doc: dict = {"type": "FeatureCollection"}
    if attribution:
        doc["attribution"] = attribution
    doc["crs"] = crs_member(epsg)
    doc["features"] = features
    path.write_text(json.dumps(doc))


def geometry_json(geom: shapely.Geometry, digits: int = 2) -> dict:
    mapped = shapely.geometry.mapping(geom)
    return {"type": mapped["type"], "coordinates": round_coords(mapped["coordinates"], digits)}
